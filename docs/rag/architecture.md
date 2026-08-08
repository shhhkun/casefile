# CaseFile RAG Architecture

This document describes the current CaseFile pipeline and where a Retrieval-Augmented Generation (RAG) layer could be introduced. It is based on the actual state of the repository (as of commit `c06e082`). It distinguishes between what CaseFile currently does, what would change for RAG, and what remains an open decision.

---

## 1. Current CaseFile Pipeline

CaseFile is a single-page Next.js app with one API endpoint (`POST /api/analyze`) that processes a URL synchronously through six stages. There are no user accounts, no document history, and no persistent data store beyond TTL-based Redis caching.

### 1.1 Stage Overview

```
User URL
   │
   ▼
1. Source Extraction (sourceContent)
   │  YouTube → youtube-transcript
   │  Article → Cheerio HTML scrape
   ▼
2. Metadata Extraction (extractCase)          → Groq LLM (JSON)
   ▼
3. Parallel External Search                   → CourtListener + Wikipedia
   ▼
4. Candidate Resolution (resolveCase)         → Groq LLM (JSON)
   ▼
5. Evidence Assembly (fetchEvidence)
   ▼
6. Overview Generation (generateOverview)     → Groq LLM (JSON)
   │
   ▼
CaseAnalysis JSON → UI (PromptCard / SourceCard)
```

### 1.2 Detailed Stage Breakdown

#### Stage 1 — Source Extraction (`src/lib/source.ts`)

- Detects if a URL is a YouTube URL (`isYoutubeUrl`) or a regular article.
- **YouTube:** calls `extractTranscript(url)` (`src/lib/transcript.ts`), which uses the `youtube-transcript` package. Returns a single space-joined transcript string. Explicit error mapping for disabled/unavailable/rate-limited transcripts.
- **Article:** calls `extractArticle(url)` (`src/lib/article.ts`), which fetches the HTML with a browser User-Agent, removes `script/style/nav/footer/header`, and extracts `body` text with `cheerio`.
- **Output type:** `ExtractedContent { sourceType, title, text, url }`.
- **Caching:** writes `source:{url}` to Upstash Redis with a 3-day TTL (`CACHE_TTL.source`).

#### Stage 2 — Metadata Extraction (`src/lib/extract.ts`)

- Calls the Groq LLM with a system prompt ("You are a legal case identifier") and the transcript/article text **truncated to the first 12,000 characters**.
- Produces structured `ExtractedCase` JSON:
  - `caseName`, `defendant`, `victim`, `crimeType`, `jurisdiction`, `state`, `approximateYear`, `keywords[]`, `confidence`.
- Notes in the prompt that names from speech-to-text may be noisy; location/year/crime/keywords are treated as the most reliable signals.
- **Caching:** writes `extract:{url}` with a 3-day TTL (`CACHE_TTL.extract`).

#### Stage 3 — Parallel External Search

Runs two searches concurrently via `Promise.all`:

**CourtListener** (`src/lib/search.ts`):

- `generateQueries(extracted, refinementNames)` (`src/lib/queries.ts`) produces an ordered list of tiered queries:
  - Tier 0: quoted refinement names
  - Tier 1: unquoted refinement names
  - Tier 2: quoted defendant + state
  - Tier 3: quoted defendant alone
  - Tier 4: quoted victim alone
  - Tier 5: quoted both last names
  - Tier 6: quoted defendant last + state
  - Tier 7: crime type + state (name-independent)
  - Tier 8: keywords only (broadest fallback)
- Each query hits `https://www.courtlistener.com/api/rest/v4/search/`.
- Results are scored as `tierScore * 0.75 + normalizedApiScore * 0.25`.
- Only the top 3 unique candidates are kept.
- **Caching:** per-query key `courtlistener:{sha256(query)}`, 1-day TTL.

**Wikipedia** (`src/lib/wiki.ts`):

- `generateWikiQuery(extracted, refinementNames)` builds a single free-text search query.
- Hits the Wikipedia `action=query` search API (`srlimit=3`).
- Scores candidates as `rankScore * 0.6 + keywordScore * 0.2 + nameScore * 0.2`.
- Fetches the REST summary (`page/summary`) for the top result only.
- **Caching:** key `wikipedia:{sha256(query)}`, 1-day TTL, storing candidates, summary, url, thumbnail.

**Name refinement** (`src/lib/queries.ts`):

- Uses Jaro-Winkler similarity (threshold 0.84) against the `natural` package to match user-provided refinement names to extracted defendant/victim.

#### Stage 4 — Candidate Resolution (`src/lib/resolve.ts`)

- Takes the top 3 candidates (by score) from the aggregated CourtListener + Wikipedia results.
- Calls the Groq LLM with the extracted signals and candidate titles/snippets/metadata, asking it to pick the best match and return `{ selectedIndex, confidence, reasoning }`.
- On LLM parse failure, falls back to the highest-scored candidate.
- **Caching:** key `resolve:{url}`, 1-day TTL.

#### Stage 5 — Evidence Assembly (`src/lib/evidence.ts`)

- Always includes:
  - Structured `caseInfo` (the extracted signals).
  - `originalText`: the source text **truncated to 14,000 chars using a head (60%) + tail (40%) strategy** — middle is dropped.
- If the resolved candidate is Wikipedia: fetches `page/summary`, includes extract truncated to 6,000 chars.
- If the resolved candidate is CourtListener: reuses the search snippet as the evidence layer (no full-text fetch).
- Logs approximate token counts for each evidence section.

#### Stage 6 — Overview Generation (`src/lib/overview.ts`)

- Calls the Groq LLM with the full `Evidence` object serialized into the prompt.
- Instructs the model to output structured JSON: `summary`, `timeline[]`, `people[]`, `legalOutcome`, `faq[]`.
- Post-processes to strip markdown code fences.
- **Caching:** key `overview:{url}`, 1-day TTL.

### 1.3 Aggregate Flow in `src/app/api/analyze/route.ts`

The route:

1. Parses `{ url, refinementNames, model }` from the request body.
2. Runs Stage 1 → 6 sequentially (except Stages 3 which run CourtListener + Wikipedia in parallel).
3. Assembles a `CaseAnalysis` object containing `extracted`, `resolved`, `candidates`, `wikiSummary`, `wikiUrl`, `wikiThumbnail`, `refinementNames`, `sourceType`, `sourceTitle`, and `overview`.
4. Returns the JSON to the client.
5. Logs per-stage timing.

### 1.4 Caching Summary (existing)

| Key pattern                     | TTL    | Written by    |
| ------------------------------- | ------ | ------------- |
| `source:{url}`                  | 3 days | `source.ts`   |
| `extract:{url}`                 | 3 days | `extract.ts`  |
| `courtlistener:{sha256(query)}` | 1 day  | `search.ts`   |
| `wikipedia:{sha256(query)}`     | 1 day  | `wiki.ts`     |
| `resolve:{url}`                 | 1 day  | `resolve.ts`  |
| `overview:{url}`                | 1 day  | `overview.ts` |

All via Upstash Redis (`src/lib/redis.ts`). TTLs defined in `src/lib/cache.ts`.

### 1.5 External Dependencies

- **Groq API** (`groq-sdk`): LLM calls for extraction, resolution, and overview generation. Uses `GROQ_API_KEY`.
- **CourtListener API** (public REST): legal search.
- **Wikipedia API** (public REST): search + summary.
- **YouTube Transcript** (`youtube-transcript` package): video transcripts.
- **Cheerio**: HTML article extraction.
- **`natural`**: Jaro-Winkler name matching.
- **Upstash Redis** (`@upstash/redis`): caching only.
- **`openai`** package: present in `package.json` but **not currently used in any code path** (no imports found in `src/`).

---

## 2. Proposed RAG Layer

### 2.1 Architectural Approach

Two approaches are documented and contrasted in depth in `decisions.md`. Summary:

- **Approach A — Per-request in-memory RAG (baseline, not recommended):** Each request embeds its own chunks and searches only within that request's data. No cross-request reuse. Re-extracts/re-embeds identical sources on every submission.
- **Approach B — Shared persistent-but-expiring knowledge base (recommended):** A central store that all requests contribute to and retrieve from, with TTL expiration bounding its size. This extends CaseFile's existing Redis TTL caching philosophy from a per-response cache into a shared retrieval corpus.

The remainder of this document describes Approach B.

### 2.2 What Gets Persisted

| Data                   | Redis key          | TTL        | Notes                                                                                                              |
| ---------------------- | ------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Raw source content     | `source:{url}`     | 3 days     | Already exists today.                                                                                              |
| Extracted case signals | `extract:{url}`    | 3 days     | Already exists today.                                                                                              |
| Chunks                 | `chunks:{url}`     | 3 days     | Array of `{ index, text, charStart, charEnd }`.                                                                    |
| Embeddings             | `embeddings:{url}` | 3 days     | Array of vectors aligned by chunk index.                                                                           |
| Document metadata      | `meta:{url}`       | 3 days     | `{ sourceType, title, url, ingestedAt, extracted signals }`.                                                       |
| Knowledge-base index   | `kb:sources`       | per-member | Redis sorted set; member = URL, score = expiry timestamp. Used to enumerate active sources and prune expired ones. |

### 2.3 Duplicate Recognition and Reuse

- **URL is the primary dedup key.**
- If `chunks:{url}` + `embeddings:{url}` exist → skip chunking and embedding entirely; reuse stored artifacts.
- If `source:{url}` exists but `chunks:{url}` does not (e.g., content cached before RAG existed) → chunk and embed from the cached source text without re-fetching the URL.
- If `extract:{url}` exists → skip LLM extraction (already current behavior).
- Result: repeat submissions of the same URL become near-free (no fetch, no LLM extraction, no chunking, no embedding).

### 2.4 TTL/Expiration Policy

- Add `chunks`, `embeddings`, and `meta` entries to `CACHE_TTL` (all 3 days, matching `source`).
- Maintain a `kb:sources` Redis sorted set where each member's score is its expiry timestamp; retrieval prunes expired members before querying.
- Redis native TTL keeps the knowledge base self-bounded — it never grows indefinitely.
- The knowledge base naturally carries the same lifecycle as the existing source cache: a source, its chunks, and its embeddings all expire together after 3 days.

### 2.5 Proposed Module Additions

```
src/lib/
  ingest.ts      → ensures a URL's content is chunked + embedded, stores to Redis
  chunk.ts       → splits extracted text into overlapping chunks
  embed.ts       → local embedding (Transformers.js) or free-tier API; vector creation
  vector.ts      → brute-force cosine similarity over Redis-stored embeddings
  retrieve.ts    → top-k chunk retrieval for a query, cross-source + current-source
```

No new database or external service is required: Upstash Redis remains the only data layer, extended with chunk/embedding/meta keys.

### 2.6 Components That Would Change (Existing)

| File                           | Change                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `src/lib/types.ts`             | Add `Chunk`, `EmbeddingMetadata`, `RetrievedChunk`, and knowledge-base-related types.                                 |
| `src/lib/source.ts`            | Optionally call `ingest.ts` after writing `source:{url}` (or defer to route orchestration).                           |
| `src/lib/cache.ts`             | Add `chunks`, `embeddings`, `meta` TTL constants.                                                                     |
| `src/lib/evidence.ts`          | Replace the head/tail truncation of `originalText` with retrieved chunks (see §2.7).                                  |
| `src/lib/overview.ts`          | Accept retrieved context in the prompt alongside (or instead of) truncated raw text.                                  |
| `src/app/api/analyze/route.ts` | Add an ingestion + retrieval step between search/resolution and overview generation.                                  |
| `src/lib/extract.ts`           | (Optional) Consider feeding retrieved chunks to extraction instead of the raw 12,000-char truncation (open decision). |

### 2.7 Integration Point in the Pipeline

The RAG layer slots into the existing flow with minimal disruption:

```
User URL
   │
   ▼
1. Source Extraction (sourceContent)          [unchanged]
   │
   ▼
2. Ingest (NEW: ingest.ts)                     → chunk + embed + store (skip if cached)
   │
   ▼
3. Metadata Extraction (extractCase)           [unchanged; may optionally use retrieved context]
   │
   ▼
4. Parallel External Search                     [unchanged]
   │
   ▼
5. Candidate Resolution (resolveCase)           [unchanged]
   │
   ▼
6. Evidence Assembly (fetchEvidence)
      • NEW: retrieval via retrieve.ts          → top-k chunks from KB (cross-source + current)
      • existing Wikipedia summary / CourtListener snippet   [unchanged]
   ▼
7. Overview Generation (generateOverview)       [prompt now receives retrieved context]
   │
   ▼
CaseAnalysis JSON → UI
```

### 2.8 Retrieval Scope and Context Injection

- **Primary: cross-source retrieval.** When a new source is analyzed, query embeddings across all active (non-expired) sources in the knowledge base. This surfaces related cases, prior context, or corroborating material from previously analyzed content.
- **Secondary: current-source retrieval.** Always include the current source's own chunks as the highest-priority context.
- **Hybrid with external search:** The existing CourtListener/Wikipedia retrieval remains untouched. Internal retrieval is additive — it augments the `Evidence` object passed to `generateOverview` alongside the existing Wikipedia summary and CourtListener snippet.
- **Context benefit:** Instead of the current head/tail truncation (60% head / 40% tail), the LLM sees the relevant portions of the source plus cross-source context.

---

## 3. Deployment Considerations

- **Vercel/serverless fit:** Upstash Redis is REST-based and works on serverless functions. Brute-force cosine similarity over small vector sets (hundreds to a few thousand chunks) is compute-light. No local filesystem dependency.
- **Local-embedding cold start:** Running `@huggingface/transformers` embeddings in-process adds cold-start latency (model weights ~25–90 MB must load). Mitigations: reuse the model across warm invocations, or accept first-request latency. This is the primary tradeoff of the free/local embedding choice (see `decisions.md`).
- **Alternative:** A free-tier embedding API (HuggingFace Inference API, Google Gemini free tier) avoids cold-start but has rate limits that would eventually throttle at realistic scale — flagged explicitly in `decisions.md`.
- **Paid services (flagged, not recommended):** Upstash Vector, pgvector hosting, OpenAI embeddings — all would violate the free-to-operate constraint at scale.

---

## 4. Open Decisions

See `decisions.md` for the full treatment. Notable open items:

1. Embedding provider choice (local Transformers.js vs. free-tier API vs. alternatives).
2. Vector search implementation (brute-force cosine vs. a dedicated index) given expected corpus size.
3. Chunk size and overlap.
4. Whether `extractCase` should consume retrieved chunks instead of raw truncated text.
5. Cold-start mitigation strategy on Vercel.
