# CaseFile RAG Architecture

This document describes the current CaseFile pipeline and the intended Retrieval-Augmented Generation (RAG) architecture. It is based on the actual state of the repository (as of commit `f5dc249`). It distinguishes between what CaseFile currently does, what the RAG layer will add, and what remains an open decision.

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
- **Caching:** writes `cache:source:{hash(url)}` to Upstash Redis with a 3-day TTL (`CACHE_TTL.source`).

#### Stage 2 — Metadata Extraction (`src/lib/extract.ts`)

- Calls the Groq LLM with a system prompt ("You are a legal case identifier") and the transcript/article text **truncated to the first 12,000 characters**.
- Produces structured `ExtractedCase` JSON:
  - `caseName`, `defendant`, `victim`, `crimeType`, `jurisdiction`, `state`, `approximateYear`, `keywords[]`, `confidence`.
- Notes in the prompt that names from speech-to-text may be noisy; location/year/crime/keywords are treated as the most reliable signals.
- **Caching:** writes `cache:extract:{hash(url)}` with a 3-day TTL (`CACHE_TTL.extract`).

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
- **Caching:** per-query key `cache:courtlistener:{hash(query)}`, 1-day TTL.

**Wikipedia** (`src/lib/wiki.ts`):

- `generateWikiQuery(extracted, refinementNames)` builds a single free-text search query.
- Hits the Wikipedia `action=query` search API (`srlimit=3`).
- Scores candidates as `rankScore * 0.6 + keywordScore * 0.2 + nameScore * 0.2`.
- Fetches the REST summary (`page/summary`) for the top result only.
- **Caching:** key `cache:wikipedia:{hash(query)}`, 1-day TTL, storing candidates, summary, url, thumbnail.

**Name refinement** (`src/lib/queries.ts`):

- Uses Jaro-Winkler similarity (threshold 0.84) against the `natural` package to match user-provided refinement names to extracted defendant/victim.

#### Stage 4 — Candidate Resolution (`src/lib/resolve.ts`)

- Takes the top 3 candidates (by score) from the aggregated CourtListener + Wikipedia results.
- Calls the Groq LLM with the extracted signals and candidate titles/snippets/metadata, asking it to pick the best match and return `{ selectedIndex, confidence, reasoning }`.
- On LLM parse failure, falls back to the highest-scored candidate.
- **Caching:** key `cache:resolve:{hash(url)}`, 1-day TTL.

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
- **Caching:** key `cache:overview:{hash(url)}`, 1-day TTL.

### 1.3 Aggregate Flow in `src/app/api/analyze/route.ts`

The route:

1. Parses `{ url, refinementNames, model }` from the request body.
2. Runs Stage 1 → 6 sequentially (except Stage 3 which runs CourtListener + Wikipedia in parallel).
3. Assembles a `CaseAnalysis` object containing `extracted`, `resolved`, `candidates`, `wikiSummary`, `wikiUrl`, `wikiThumbnail`, `refinementNames`, `sourceType`, `sourceTitle`, and `overview`.
4. Returns the JSON to the client.
5. Logs per-stage timing.

### 1.4 Caching Summary (existing)

| Key pattern                         | TTL    | Written by    |
| ----------------------------------- | ------ | ------------- |
| `cache:source:{hash(url)}`          | 3 days | `source.ts`   |
| `cache:extract:{hash(url)}`         | 3 days | `extract.ts`  |
| `cache:courtlistener:{hash(query)}` | 1 day  | `search.ts`   |
| `cache:wikipedia:{hash(query)}`     | 1 day  | `wiki.ts`     |
| `cache:resolve:{hash(url)}`         | 1 day  | `resolve.ts`  |
| `cache:overview:{hash(url)}`        | 1 day  | `overview.ts` |

All via Upstash Redis (`src/lib/redis.ts`). TTLs defined in `src/lib/cache.ts`.

### 1.5 External Dependencies

- **Groq API** (`groq-sdk`): LLM calls for extraction, resolution, and overview generation. Uses `GROQ_API_KEY`.
- **CourtListener API** (public REST): legal search.
- **Wikipedia API** (public REST): search + summary.
- **YouTube Transcript** (`youtube-transcript` package): video transcripts.
- **Cheerio**: HTML article extraction.
- **`natural`**: Jaro-Winkler name matching.
- **Upstash Redis** (`@upstash/redis`): caching only.
- **`openai`** package: present in `package.json` but **not currently used in any code path** (no imports found in `src/`). It is unrelated to the RAG architecture and does not influence the embedding decision.

---

## 2. Intended RAG Architecture

### 2.1 Core Architecture

CaseFile uses a **shared, persistent-but-expiring knowledge base** for RAG.

- The application remains **stateless**: no user accounts, no authentication, no per-user knowledge bases. All users contribute to and retrieve from the same shared corpus.
- The knowledge base is **bounded with TTLs** so it does not grow indefinitely.
- Repeated analysis of the same URL **reuses previously processed RAG data** rather than re-fetching, re-chunking, and re-embedding it.

The stack is:

| Layer                         | Technology                                                                  |
| ----------------------------- | --------------------------------------------------------------------------- |
| LLM inference                 | **Groq** (`openai/gpt-oss-120b`)                                            |
| Embeddings                    | **Transformers.js** (`@huggingface/transformers`) + local open-source model |
| Persistent RAG knowledge base | **Supabase PostgreSQL + pgvector**                                          |
| Application cache             | **Upstash Redis** (TTL-based)                                               |
| Deployment                    | **Vercel**                                                                  |

### 2.2 Storage Separation

**Redis is the cache. Supabase/pgvector is the knowledge base.**

- **Upstash Redis** holds only temporary application/cache data, namespaced under `cache:*`:
  - `cache:source:{hash}`
  - `cache:extract:{hash}`
  - `cache:resolve:{hash}`
  - `cache:overview:{hash}`
  - `cache:courtlistener:{hash}`
  - `cache:wikipedia:{hash}`
- **Supabase PostgreSQL + pgvector** holds all RAG data: chunks, embeddings, and RAG metadata.

The exact key structure is implementation-specific, but the architectural distinction is fixed: **Redis is never used as a vector store or retrieval layer.**

This separation also respects the Upstash Redis **500k commands/month** free-tier limit. RAG must not cause unnecessary Redis reads/writes or turn Redis into an additional retrieval layer.

### 2.3 Relational Schema (Supabase / pgvector)

The RAG database is designed around a proper relational schema, not Redis-style URL key/value blobs.

```
sources
├── id              uuid PK
├── url             text UNIQUE NOT NULL        -- source identity / dedup key
├── source_type     text NOT NULL               -- 'youtube' | 'article'
├── title           text
├── source_text     text NOT NULL               -- extracted source text
├── extracted_meta  jsonb                       -- ExtractedCase signals (caseName, defendant, victim, crimeType, jurisdiction, state, approximateYear, keywords, confidence)
├── ingested_at     timestamptz NOT NULL DEFAULT now()
└── expires_at      timestamptz NOT NULL        -- TTL / retention

chunks
├── id              uuid PK
├── source_id       uuid FK → sources.id ON DELETE CASCADE
├── chunk_index     int NOT NULL                -- ordering/position within the source
├── text            text NOT NULL
├── char_start      int                         -- position info (optional)
├── char_end        int                         -- position info (optional)
└── token_count     int                         -- optional, for context budgeting

embeddings
├── id              uuid PK
├── chunk_id        uuid FK → chunks.id ON DELETE CASCADE
├── model           text NOT NULL               -- embedding model name (e.g. 'all-MiniLM-L6-v2')
├── dimensions      int NOT NULL                -- e.g. 384
└── vector          vector(384) NOT NULL        -- pgvector column
```

Key design points:

- **`sources.url` is the dedup key.** If a source row exists and has not expired, ingestion is skipped and stored chunks/embeddings are reused.
- **`chunks` and `embeddings` cascade-delete with their source**, so expiring a document safely removes all associated RAG data.
- **`extracted_meta` JSONB** stores the extracted case signals for metadata filtering during retrieval (e.g., filter by state, crime type, or keywords) without a separate table.
- **`expires_at`** drives the TTL/lifecycle policy (see §2.6).

### 2.4 Embeddings

- **Locked in:** local embeddings using **Transformers.js** (`@huggingface/transformers`).
- **Model:** an open-source local embedding model such as `all-MiniLM-L6-v2` (384-dim, ~25 MB) unless repository investigation gives a strong reason to choose another small model.
- **Requirement:** zero API cost and no external embedding-service dependency.
- **Explicitly not used:** OpenAI embeddings. The existing `openai` package is unrelated and does not influence this decision.
- **Operational consideration:** on Vercel serverless, model weights load on cold start, adding latency to the first request after a cold invocation. Mitigations: module-level model singleton for warm reuse, smallest adequate model, and accepting first-request latency as a documented operational cost.

### 2.5 Vector Retrieval

- **Locked in:** pgvector similarity search in the database, not application-side brute-force cosine similarity.
- Retrieval issues a pgvector query such as:

  ```sql
  SELECT c.id, c.text, c.source_id, s.url, s.source_type,
         1 - (e.vector <=> $query_vector) AS similarity
  FROM embeddings e
  JOIN chunks c ON c.id = e.chunk_id
  JOIN sources s ON s.id = c.source_id
  WHERE s.expires_at > now()
    AND e.model = $embedding_model
  ORDER BY e.vector <=> $query_vector
  LIMIT $top_k;
  ```

- Similarity search happens **in the database** using vector indexing/search mechanisms, so retrieval remains semantically based as the corpus grows.
- **Indexing strategy:** an HNSW or IVFFlat index on the `embeddings.vector` column. For CaseFile's expected corpus size (hundreds to low-thousands of chunks), **HNSW** is the appropriate default: it requires no periodic rebuild, offers good recall, and its build cost is negligible at this scale. IVFFlat is a cheaper alternative but requires periodic rebuilds as the corpus grows. Exact index choice/tuning remains an open decision (see §4).

### 2.6 TTL / Lifecycle

- The knowledge base is **persistent across requests but temporary over time**.
- Each `sources` row carries an `expires_at` timestamp. Expired documents, and their cascading chunks/embeddings, are removed.
- **The exact TTL is configurable**, not permanently fixed at 3 days. The current 3-day Redis source cache is a reference point, but RAG retention should be chosen based on storage usage, retrieval usefulness, and Supabase free-tier limits.
- **Cleanup strategy:** expired rows are cleaned up safely via:
  - A lazy cleanup query during retrieval (e.g., `DELETE FROM sources WHERE expires_at < now()` before or alongside a search), and/or
  - A scheduled cleanup job (e.g., a cron/edge function) that deletes expired sources; `ON DELETE CASCADE` removes their chunks and embeddings automatically.

### 2.7 Proposed Module Additions

```
src/lib/
  ingest.ts      → ensures a URL's content is chunked + embedded and stored in Supabase/pgvector (skips if already ingested and unexpired)
  chunk.ts       → token-based chunking with overlap (modular; see §2.8)
  embed.ts       → Transformers.js local embedding; vector creation
  retrieve.ts    → pgvector similarity query; top-k chunk retrieval (current-source priority + cross-source supplement)
  supabase.ts    → Supabase/pgvector client (connection from .env, no hardcoded credentials)
```

### 2.8 Chunking

- **Baseline:** token-based chunking, approximately 512–1024 tokens with overlap.
- **Modular by design:** chunking is one of the genuinely open areas. CaseFile primarily processes human-written articles, transcripts, and eventually CourtListener legal opinions, so preserving semantic boundaries matters.
- **Future improvement:** paragraph/section-aware chunking where appropriate, rather than assuming arbitrary fixed character boundaries are ideal.
- **Explicitly not introduced:** LLM-based semantic chunking, unless a demonstrated benefit exists — it would add unnecessary inference cost and complexity.

### 2.9 Components That Would Change (Existing)

| File                           | Change                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `src/lib/types.ts`             | Add `Chunk`, `EmbeddingMetadata`, `RetrievedChunk`, and knowledge-base-related types.                        |
| `src/lib/cache.ts`             | Namespace cache keys under `cache:*`; keep TTL constants.                                                    |
| `src/lib/source.ts`            | Optionally call `ingest.ts` after writing `cache:source:{hash}` (or defer to route orchestration).           |
| `src/lib/evidence.ts`          | Replace the head/tail truncation of `originalText` with retrieved chunks (see §2.10).                        |
| `src/lib/overview.ts`          | Accept retrieved context in the prompt alongside (or instead of) truncated raw text.                         |
| `src/app/api/analyze/route.ts` | Add an ingestion + retrieval step between search/resolution and overview generation.                         |
| `src/lib/extract.ts`           | (Future decision) Consider feeding retrieved chunks to extraction instead of the raw 12,000-char truncation. |
| `src/lib/resolve.ts`           | (Future decision) Consider feeding retrieved context to candidate resolution.                                |

### 2.10 Intended Retrieval Flow

The RAG layer improves CaseFile's LLM context; it does not duplicate the existing external search.

```
Source extraction
   → document/chunk ingestion
   → local embeddings (Transformers.js)
   → store in Supabase/pgvector
   → retrieve semantically relevant chunks (pgvector)
   → combine retrieved context with CaseFile's existing extracted metadata
     and CourtListener/Wikipedia evidence
   → send the resulting context to Groq (openai/gpt-oss-120b) for inference
```

Concretely, the pipeline becomes:

```
User URL
   │
   ▼
1. Source Extraction (sourceContent)          [unchanged]
   │
   ▼
2. Ingest (NEW: ingest.ts)                     → chunk + embed + store in Supabase/pgvector (skip if already ingested)
   │
   ▼
3. Metadata Extraction (extractCase)           [unchanged for now; may consume retrieved context in the future]
   │
   ▼
4. Parallel External Search                     [unchanged — CourtListener + Wikipedia]
   │
   ▼
5. Candidate Resolution (resolveCase)           [unchanged for now; may consume retrieved context in the future]
   │
   ▼
6. Evidence Assembly (fetchEvidence)
      • NEW: retrieval via retrieve.ts          → top-k chunks from pgvector
      • current-source chunks get priority
      • cross-source chunks supplement (related/corroborating context)
      • existing Wikipedia summary / CourtListener snippet   [unchanged]
   ▼
7. Overview Generation (generateOverview)       [prompt now receives retrieved context]
   │
   ▼
CaseAnalysis JSON → UI
```

### 2.11 Retrieval Scope

- **Current-source chunks receive priority.** The source being analyzed is always the primary context.
- **Cross-source retrieval supplements.** Related/corroborating context from the shared knowledge base is added as secondary context.
- **External search remains.** CourtListener/Wikipedia keyword search stays part of the system. RAG is initially **additive**, not a replacement for those external sources.
- **Future stages:** retrieval could eventually improve more than `generateOverview` — `extractCase` and `resolveCase` may benefit from retrieved context. These remain explicit future decisions, not assumptions.

---

## 3. Deployment Considerations

- **Vercel/serverless fit:** Supabase Postgres is reachable over the network (via `DATABASE_URL`/`DIRECT_URL` from `.env.local`); pgvector queries run in the database, keeping serverless functions compute-light. Upstash Redis remains REST-based and cache-only.
- **Local-embedding cold start:** Transformers.js model weights (~25 MB for `all-MiniLM-L6-v2`) load on first use after a cold start. Mitigations: module-level singleton, smallest adequate model, accept first-request latency.
- **Supabase free tier:** storage and compute limits apply. The architecture must stay within free-tier constraints; the point at which the architecture needs reconsideration is documented in `decisions.md`.
- **Configuration:** Supabase connection details are read from the existing `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `DIRECT_URL`). No credentials are hardcoded.

---

## 4. Open Decisions

These are the genuinely unresolved items that require experimentation:

1. **Exact embedding model** — `all-MiniLM-L6-v2` is the default; another small open-source model may be chosen based on retrieval quality.
2. **Exact chunk size/overlap** — token-based 512–1024 with overlap is the baseline; exact values need empirical validation.
3. **Paragraph/section-aware chunking improvements** — whether/when to move beyond fixed token boundaries for articles, transcripts, and CourtListener opinions.
4. **pgvector index choice/tuning** — HNSW vs. IVFFlat, and index parameters, at CaseFile's expected corpus size.
5. **Exact TTL/retention period** — configurable; chosen based on storage usage, retrieval usefulness, and Supabase limits.
6. **Which pipeline stages consume retrieved context beyond `generateOverview`** — `extractCase` and `resolveCase` are candidates but not assumed.
7. **Retrieval top-k/context limits and ranking strategy** — how many chunks, how much context budget, and how current-source vs. cross-source results are ranked/combined.
