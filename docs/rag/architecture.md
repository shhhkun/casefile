# CaseFile RAG Architecture

This document describes the current CaseFile pipeline and the intended Retrieval-Augmented Generation (RAG) architecture. It is based on the actual state of the repository (as of commit `f5dc249`). It distinguishes between what CaseFile currently does, what the RAG layer will add, and what remains an open decision.

---

## 1. Current CaseFile Pipeline

CaseFile is a single-page Next.js app with one API endpoint (`POST /api/analyze`) that processes a URL synchronously through five stages. There are no user accounts, no document history, and no persistent data store beyond TTL-based Redis caching.

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
4. Evidence Assembly (fetchEvidence)          → includes RAG ingestion + retrieval
   ▼
5. Overview Generation (generateOverview)     → Groq LLM (JSON)
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

#### Stage 4 — Evidence Assembly (`src/lib/evidence.ts`)

- Always includes:
  - Structured `caseInfo` (the extracted signals).
  - `originalText`: the source text **truncated to 14,000 chars using a head (60%) + tail (40%) strategy** — middle is dropped.
- **Wikipedia:** the top Wikipedia search result's concise summary is included as narrative/contextual evidence (truncated to 6,000 chars) when available.
- **CourtListener:** the top CourtListener search result's snippet is preserved as a lightweight evidence layer; the full opinion is ingested into RAG and retrieved as relevant chunks.
- **RAG:** ingests the full underlying documents of the top search results (CourtListener opinion + Wikipedia article) and retrieves relevant chunks (`topK: 3`), added as `ragChunks`.
- Logs approximate token counts for each evidence section.

#### Stage 5 — Overview Generation (`src/lib/overview.ts`)

- Calls the Groq LLM with the full `Evidence` object serialized into the prompt.
- Instructs the model to output structured JSON: `summary`, `timeline[]`, `people[]`, `legalOutcome`, `faq[]`.
- Post-processes to strip markdown code fences.
- **Caching:** key `cache:overview:{hash(url)}`, 1-day TTL.

### 1.3 Aggregate Flow in `src/app/api/analyze/route.ts`

The route:

1. Parses `{ url, refinementNames, model }` from the request body.
2. Runs Stage 1 → 5 sequentially (except Stage 3 which runs CourtListener + Wikipedia in parallel).
3. Assembles a `CaseAnalysis` object containing `extracted`, `originalExtracted`, `candidates`, `wikiSummary`, `wikiUrl`, `wikiThumbnail`, `refinementNames`, `sourceType`, `sourceTitle`, and `overview`.
4. Returns the JSON to the client.
5. Logs per-stage timing.

### 1.4 Caching Summary (existing)

| Key pattern                         | TTL    | Written by    |
| ----------------------------------- | ------ | ------------- |
| `cache:source:{hash(url)}`          | 3 days | `source.ts`   |
| `cache:extract:{hash(url)}`         | 3 days | `extract.ts`  |
| `cache:courtlistener:{hash(query)}` | 1 day  | `search.ts`   |
| `cache:wikipedia:{hash(query)}`     | 1 day  | `wiki.ts`     |
| `cache:overview:{hash(url)}`        | 1 day  | `overview.ts` |

All via Upstash Redis (`src/lib/redis.ts`). TTLs defined in `src/lib/cache.ts`.

### 1.5 External Dependencies

- **Groq API** (`groq-sdk`): LLM calls for extraction and overview generation. Uses `GROQ_API_KEY`.
- **CourtListener API** (public REST): legal search + full-opinion fetching (Clusters/Opinions endpoints, authenticated via `COURTLISTENER_API_TOKEN`).
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
- **Model:** an open-source local embedding model such as `all-MiniLM-L6-v2` (384-dim). Transformers.js defaults to fp32 weights (`onnx/model.onnx`, ~90 MB); CaseFile pins `dtype: "q8"` to load the int8 quantized variant (`onnx/model_quantized.onnx`, ~23 MB), cutting the in-process model footprint ~4x without changing the stored embedding model id. Unless repository investigation gives a strong reason to choose another small model.
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
  - **Active cleanup (implemented):** `fetchEvidence` calls `deleteExpiredSources()` (`src/lib/rag/cleanup.ts`) before ingestion, so expired rows are removed through the existing cascading cleanup mechanism on every analysis. This keeps the knowledge base bounded without requiring a separate scheduled job.
  - A scheduled cleanup job (e.g., a cron/edge function) remains a possible future addition for environments where the active cleanup is insufficient; `ON DELETE CASCADE` removes their chunks and embeddings automatically.

### 2.7 Implemented RAG Modules

The RAG storage/retrieval layer is implemented as real production-oriented CaseFile code under `src/lib/rag/` (established on this branch, **now integrated into `/api/analyze` via Evidence Assembly**):

```
src/lib/rag/
  types.ts     → RAG data types (RagSource, RagChunk, RagEmbedding, RetrievedChunk, IngestInput, IngestResult, FetchedSource)
  db.ts        → lazy pg Pool for Supabase Postgres + pgvector (DATABASE_URL from .env); query/queryOne helpers
  chunk.ts     → token-based chunking with overlap (chunkText; modular — see §2.8)
  embed.ts     → Transformers.js local embeddings (embedText / embedTexts; module-level model singleton; loads int8 quantized weights via dtype:"q8"; embedTexts runs bounded sequential batches of 16 chunks)
  fetch.ts     → external full-document fetching: CourtListener cluster → opinion (html_with_citations) and Wikipedia full article (with_html); normalizes HTML → readable text (FetchedSource)
  ingest.ts    → ensures a URL's content is chunked + embedded and stored in Supabase/pgvector; findReusableSource checks for an existing unexpired source before chunking/embedding (skips expensive work when reusable)
  retrieve.ts  → pgvector similarity query (retrieveChunks); current-source priority + cross-source supplement
  cleanup.ts   → deletes expired sources (ON DELETE CASCADE removes chunks/embeddings)
  index.ts     → barrel export for the RAG module
```

Supporting files:

```
supabase/migrations/0001_rag_init.sql   → enables pgvector; creates rag_sources / rag_chunks / rag_embeddings + HNSW index
scripts/run-migrations.ts                → applies the migration via DIRECT_URL/DATABASE_URL (npm run db:migrate)
scripts/rag-demo.ts                      → development/test entry point proving storage → embedding → retrieval (npm run rag:demo)
```

The schema and migration are applied (verified against Supabase); the demo exercises ingestion (multi-chunk), local embedding, pgvector retrieval (cross-source + current-source), and dedup/reuse.

### 2.8 Chunking

- **Baseline (implemented):** token-based chunking with a default chunk size of **300 tokens** and **50-token overlap** (`chunkText` in `src/lib/rag/chunk.ts`). The original 512–1024 token baseline was reduced during development to keep retrieved chunks compact for the LLM context budget.
- **Modular by design:** chunking is one of the genuinely open areas. CaseFile primarily processes human-written articles, transcripts, and eventually CourtListener legal opinions, so preserving semantic boundaries matters.
- **Future improvement:** paragraph/section-aware chunking where appropriate, rather than assuming arbitrary fixed character boundaries are ideal.
- **Explicitly not introduced:** LLM-based semantic chunking, unless a demonstrated benefit exists — it would add unnecessary inference cost and complexity.

### 2.9 Components That Changed (Implemented)

| File                           | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/rag/fetch.ts`         | **New module.** External full-document fetching, separated from evidence orchestration: `fetchCourtListenerSource(clusterId)` resolves a cluster → opinion via the Clusters/Opinions APIs (token-authenticated, prefers `html_with_citations`) and `fetchWikipediaSource(title, url)` fetches the full article via `with_html`. Both normalize HTML → readable text and return `FetchedSource \| null`.                                                                                                                                                                                                                                                                                                              |
| `src/lib/rag/ingest.ts`        | Added `findReusableSource(url)` — a cheap DB check for an existing **unexpired** source before chunking/embedding. `ingestSource` reuses existing chunks/embeddings when a valid source exists, avoiding expensive external fetching, chunking, and embedding.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/lib/evidence.ts`          | Added `SearchContext` interface, `ragChunks` field on `Evidence`, and RAG ingestion + retrieval logic in `fetchEvidence`. RAG ingestion now uses the **full underlying documents** of the top search results: CourtListener cluster → opinion (`html_with_citations` → readable text) and Wikipedia article (`with_html` → readable text). Retrieval uses `topK: 3`. Runs `deleteExpiredSources()` before ingestion so expired sources are actively cleaned up, then checks `findReusableSource` **before** any external fetch (avoiding unnecessary CourtListener/Wikipedia requests when a valid source already exists). The per-source ingest/fetch flow is factored into a shared `ingestExternalSource` helper. |
| `src/app/api/analyze/route.ts` | Capture #1 CourtListener and #1 Wikipedia search results as `SearchContext` and pass to `fetchEvidence`. Preserves the top CourtListener `cluster_id` so Evidence Assembly can resolve it to the underlying opinion. No other pipeline changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/lib/search.ts`            | Preserves `cluster_id` from CourtListener search results into candidate metadata.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/lib/types.ts`             | Added `cluster_id` to `CachedCourtListenerResult`; removed `ResolvedCase` interface and `resolved` field from `CaseAnalysis` (resolution stage removed).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/lib/cache.ts`             | Removed `resolve` TTL key (resolution stage removed). RAG uses Supabase/pgvector, not Redis.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/lib/source.ts`            | No changes — RAG ingestion is deferred to Evidence Assembly, not source extraction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/lib/overview.ts`          | No changes — `ragChunks` are included in the `Evidence` object, which is already serialized into the prompt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/lib/extract.ts`           | No changes (future decision).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/lib/resolve.ts`           | **Removed from active pipeline.** The LLM-based case resolution stage was removed; `resolve.ts` is retained as an inactive legacy module. Search results are now treated as evidence/RAG candidates directly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### 2.10 Implemented Retrieval Flow

The RAG layer improves CaseFile's LLM context; it does not duplicate the existing external search.

**Deviation from the originally intended flow:** RAG ingestion was originally planned to occur immediately after Source Extraction (Stage 2), ingesting the user's original source URL. The implemented design instead keeps RAG **entirely within Evidence Assembly** (Stage 4) and ingests the **top CourtListener and top Wikipedia search results** — not the user's original URL. This keeps the existing pipeline conceptually unchanged and avoids introducing RAG into metadata extraction or any earlier LLM stage.

**Removal of the resolution stage:** The LLM-based case resolution stage (`resolveCase`) was removed from the active pipeline. Search results are no longer "resolved" into a single canonical case; instead they are treated as available evidence/RAG candidates. Wikipedia provides concise narrative context when available, and CourtListener provides legal source material for RAG retrieval.

```
User URL
   │
   ▼
1. Source Extraction (sourceContent)          [unchanged]
   │
   ▼
2. Metadata Extraction (extractCase)           [unchanged]
   │
   ▼
3. Parallel External Search                     [unchanged — CourtListener + Wikipedia]
   │
   ▼
4. Evidence Assembly (fetchEvidence)
      • Wikipedia concise summary / CourtListener snippet   [evidence from search results]
      • NEW: preserve #1 CourtListener (with cluster_id) + #1 Wikipedia results as SearchContext
      • NEW: deleteExpiredSources() — actively clean up expired sources before ingestion
      • NEW: for each source, check findReusableSource (cheap DB query) BEFORE any external fetch — reuse existing unexpired source when present
      • NEW: only if no reusable source: resolve CourtListener cluster → opinion (html_with_citations) / fetch Wikipedia full article (with_html); normalize HTML → readable text
      • NEW: ingest full documents via ingestSource → chunk + embed + store in Supabase/pgvector (max 2 sources)
      • NEW: retrieve via retrieveChunks (topK: 3) → chunks from pgvector
      • NEW: ragChunks added to Evidence object (additive, non-fatal)
   ▼
5. Overview Generation (generateOverview)       [unchanged — receives ragChunks via Evidence JSON]
   │
   ▼
CaseAnalysis JSON → UI
```

### 2.11 Retrieval Scope (Implemented)

- **RAG sources are the full underlying documents of the top search results, not the snippets/summaries, and not the user's original source.** For CourtListener, the selected cluster is resolved to its underlying opinion via the Clusters/Opinions APIs and `html_with_citations` is normalized to readable text. For Wikipedia, the full article is fetched via the MediaWiki REST `with_html` endpoint and normalized to readable text. The user's original URL is **not** ingested. The normal evidence (snippet/summary) is preserved unchanged.
- **At most 2 external full documents** are ingested per analysis: the #1 CourtListener opinion + the #1 Wikipedia article.
- **Existing unexpired sources are reused.** Before any external fetch, `findReusableSource` checks the knowledge base for an existing unexpired source row. If found, the expensive external fetch, chunking, and embedding are skipped entirely and the stored chunks/embeddings are reused. This is especially important for CourtListener, whose Clusters/Opinions endpoints are token-authenticated and rate-limited.
- **Expired sources are actively cleaned up.** `fetchEvidence` calls `deleteExpiredSources()` before ingestion, so expired rows (and their cascading chunks/embeddings) are removed through the existing cleanup mechanism rather than accumulating.
- **Missing/failed full-document retrieval is non-fatal.** If the opinion/article cannot be fetched or normalized, that source is skipped and RAG continues with whatever remains.
- **Retrieval is additive.** Retrieved chunks are added to the `Evidence` object as `ragChunks` and serialized into the overview prompt alongside existing evidence. The overview-generation prompt/model is **not** modified.
- **Non-fatal.** If RAG ingestion or retrieval fails (e.g., database unavailable, embedding model fails to load), normal evidence assembly still succeeds. The `ragChunks` field is simply left empty.
- **External search remains.** CourtListener/Wikipedia keyword search stays part of the system. RAG is additive, not a replacement.
- **Future stages:** retrieval could eventually improve more than `generateOverview` — `extractCase` may benefit from retrieved context. This remains an explicit future decision, not an assumption.

---

## 3. Deployment Considerations

- **Vercel/serverless fit:** Supabase Postgres is reachable over the network (via `DATABASE_URL`/`DIRECT_URL` from `.env.local`); pgvector queries run in the database, keeping serverless functions compute-light. Upstash Redis remains REST-based and cache-only.
- **Local-embedding cold start:** Transformers.js model weights load on first use after a cold start. CaseFile loads the int8 quantized variant (`onnx/model_quantized.onnx`, ~23 MB for `all-MiniLM-L6-v2`) via `dtype: "q8"` rather than the default fp32 (`onnx/model.onnx`, ~90 MB). Embeddings are computed in bounded sequential batches of 16 chunks to cap peak inference memory. Mitigations: module-level singleton, quantized model, bounded inference batching, accept first-request latency.
- **Supabase free tier:** storage and compute limits apply. The architecture must stay within free-tier constraints; the point at which the architecture needs reconsideration is documented in `decisions.md`.
- **Configuration:** Supabase connection details are read from the existing `.env.local` (`DATABASE_URL`, `DIRECT_URL`). CourtListener full-opinion fetching requires `COURTLISTENER_API_TOKEN` in `.env.local` (used by `fetch.ts` to authenticate Clusters/Opinions API requests). No credentials are hardcoded.

---

## 4. Open Decisions

These are the genuinely unresolved items that require experimentation:

1. **Exact embedding model** — `all-MiniLM-L6-v2` is the default; another small open-source model may be chosen based on retrieval quality.
2. **Exact chunk size/overlap** — token-based 512–1024 with overlap is the baseline; exact values need empirical validation.
3. **Paragraph/section-aware chunking improvements** — whether/when to move beyond fixed token boundaries for articles, transcripts, and CourtListener opinions.
4. **pgvector index choice/tuning** — HNSW vs. IVFFlat, and index parameters, at CaseFile's expected corpus size.
5. **Exact TTL/retention period** — configurable; chosen based on storage usage, retrieval usefulness, and Supabase limits.
6. **Which pipeline stages consume retrieved context beyond `generateOverview`** — `extractCase` is a candidate but not assumed.
7. **Retrieval top-k/context limits and ranking strategy** — how many chunks, how much context budget, and how current-source vs. cross-source results are ranked/combined.
