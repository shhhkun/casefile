# CaseFile — TypeScript to Python Pipeline Migration

This document is the practical, repo-specific migration plan for moving CaseFile's analysis pipeline from TypeScript/Next.js to Python. It documents the current pipeline, what will eventually move to Python, how RAG/database/caching fit into the target architecture, how Next.js will interact with the Python pipeline, likely dependencies, migration phases, and important risks/open questions.

The existing TypeScript implementation remains the **reference implementation** and stays fully intact throughout the migration.

---

## 1. Current Pipeline (TypeScript — Reference Implementation)

CaseFile is a single-page Next.js app with one API endpoint (`POST /api/analyze`) that processes a URL synchronously through five stages. There are no user accounts, no document history, and no persistent data store beyond TTL-based Redis caching and the RAG knowledge base in Supabase/pgvector.

### 1.1 Stage Overview

```
User URL
   │
   ▼
1. Source Extraction (sourceContent)          src/source/source.ts
   │  YouTube → youtube-transcript            src/source/transcript.ts
   │  Article → Cheerio HTML scrape           src/source/article.ts
   ▼
2. Metadata Extraction (extractCase)          src/extract/extract.ts
   │  → Groq LLM (JSON) — ExtractedCase
   ▼
3. Parallel External Search                   src/search/courtlistener.ts + src/search/wiki.ts
   │  CourtListener (tiered queries)          src/search/queries.ts
   │  Wikipedia (free-text query)
   ▼
4. Evidence Assembly (fetchEvidence)          src/evidence/evidence.ts
   │  → includes RAG ingestion + retrieval    src/rag/*
   ▼
5. Overview Generation (generateOverview)     src/overview/overview.ts
   │  → Groq LLM (JSON) — CaseOverview
   ▼
CaseAnalysis JSON → UI (PromptCard / SourceCard)
```

### 1.2 Detailed Stage Breakdown

#### Stage 1 — Source Extraction (`src/source/source.ts`)

- Detects if a URL is a YouTube URL (`isYoutubeUrl`) or a regular article.
- **YouTube:** calls `extractTranscript(url)` (`src/source/transcript.ts`), which uses the `youtube-transcript` package. Returns a single space-joined transcript string. Explicit error mapping for disabled/unavailable/rate-limited transcripts.
- **Article:** calls `extractArticle(url)` (`src/source/article.ts`), which fetches the HTML with a browser User-Agent, removes `script/style/nav/footer/header`, and extracts `body` text with `cheerio`.
- **Output type:** `ExtractedContent { sourceType, title, text, url }`.
- **Caching:** writes `cache:source:{hash(url)}` to Upstash Redis with a 3-day TTL (`CACHE_TTL.source`).

#### Stage 2 — Metadata Extraction (`src/extract/extract.ts`)

- Calls the Groq LLM with a system prompt ("You are a legal case identifier") and the transcript/article text **truncated to the first 12,000 characters**.
- Produces structured `ExtractedCase` JSON:
  - `caseName`, `defendant`, `victim`, `crimeType`, `jurisdiction`, `state`, `approximateYear`, `keywords[]`, `confidence`.
- Notes in the prompt that names from speech-to-text may be noisy; location/year/crime/keywords are treated as the most reliable signals.
- **Caching:** writes `cache:extract:{hash(url)}` with a 3-day TTL (`CACHE_TTL.extract`).

#### Stage 3 — Parallel External Search

Runs two searches concurrently via `Promise.all`:

**CourtListener** (`src/search/courtlistener.ts`):

- `generateQueries(extracted, refinementNames)` (`src/search/queries.ts`) produces an ordered list of tiered queries:
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

**Wikipedia** (`src/search/wiki.ts`):

- `generateWikiQuery(extracted, refinementNames)` builds a single free-text search query.
- Hits the Wikipedia `action=query` search API (`srlimit=3`).
- Scores candidates as `rankScore * 0.6 + keywordScore * 0.2 + nameScore * 0.2`.
- Fetches the REST summary (`page/summary`) for the top result only.
- **Caching:** key `cache:wikipedia:{hash(query)}`, 1-day TTL, storing candidates, summary, url, thumbnail.

**Name refinement** (`src/search/queries.ts`):

- Uses Jaro-Winkler similarity (threshold 0.84) against the `natural` package to match user-provided refinement names to extracted defendant/victim.

#### Stage 4 — Evidence Assembly (`src/evidence/evidence.ts`)

- Always includes:
  - Structured `caseInfo` (the extracted signals).
  - `originalText`: the source text **truncated to 14,000 chars using a head (60%) + tail (40%) strategy** — middle is dropped.
- **Wikipedia:** the top Wikipedia search result's concise summary is included as narrative/contextual evidence (truncated to 6,000 chars) when available.
- **CourtListener:** the top CourtListener search result's snippet is preserved as a lightweight evidence layer; the full opinion is ingested into RAG and retrieved as relevant chunks.
- **RAG:** ingests the full underlying documents of the top search results (CourtListener opinion + Wikipedia article) and retrieves relevant chunks (`topK: 3`), added as `ragChunks`.
- Logs approximate token counts for each evidence section.

#### Stage 5 — Overview Generation (`src/overview/overview.ts`)

- Calls the Groq LLM with the full `Evidence` object serialized into the prompt.
- Instructs the model to output structured JSON: `summary`, `timeline[]`, `people[]`, `legalOutcome`, `faq[]`.
- Post-processes to strip markdown code fences.
- **Caching:** key `cache:overview:{hash(url)}`, 1-day TTL.

### 1.3 RAG Layer (`src/rag/`)

| File          | Purpose                                                                                                                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`    | RAG data types (`RagSource`, `RagChunk`, `RagEmbedding`, `RetrievedChunk`, `IngestInput`, `IngestResult`, `FetchedSource`)                                                                                                                    |
| `db.ts`       | Lazy pg Pool for Supabase Postgres + pgvector (`DATABASE_URL` from `.env`); `query`/`queryOne` helpers; `withTransaction` for atomic multi-statement transactions                                                                             |
| `chunk.ts`    | Token-based chunking with overlap (`chunkText`; default 300 tokens / 50 overlap)                                                                                                                                                              |
| `embed.ts`    | Transformers.js local embeddings (`embedText` / `embedTexts`; module-level model singleton; `all-MiniLM-L6-v2`, 384-dim). `EMBEDDING_MODEL` is the canonical DB-storage string; `EMBEDDING_MODEL_LOAD_ID` is the HF repo used to load weights |
| `fetch.ts`    | External full-document fetching: CourtListener cluster → opinion (`html_with_citations`) and Wikipedia full article (`with_html`); normalizes HTML → readable text (`FetchedSource`)                                                          |
| `ingest.ts`   | Ensures a URL's content is chunked + embedded and stored in Supabase/pgvector; `findReusableSource` checks for an existing unexpired source before chunking/embedding. Batched multi-row INSERTs wrapped in a single `withTransaction`        |
| `retrieve.ts` | pgvector similarity query (`retrieveChunks`); current-source priority + cross-source supplement                                                                                                                                               |
| `cleanup.ts`  | Deletes expired sources (`ON DELETE CASCADE` removes chunks/embeddings)                                                                                                                                                                       |
| `index.ts`    | Barrel export for the RAG module                                                                                                                                                                                                              |

### 1.4 Supporting Infrastructure

| File                                    | Purpose                                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`                      | Shared TypeScript types (`ExtractedCase`, `ScoredCandidate`, `CaseAnalysis`, `ExtractedContent`, `CaseOverview`, cache types) |
| `src/cache/cache.ts`                      | TTL constants (`source`: 3d, `extract`: 3d, `search`: 1d, `overview`: 1d)                                                     |
| `src/cache/redis.ts`                      | Upstash Redis client (`@upstash/redis`)                                                                                       |
| `src/cache/hash.ts`                       | SHA-256 hashing for cache keys                                                                                                |
| `src/errors.ts`                     | `SourceError` with HTTP status code                                                                                           |
| `src/app/api/analyze/route.ts`          | The single API endpoint orchestrating all 5 stages                                                                            |
| `supabase/migrations/0001_rag_init.sql` | pgvector schema: `rag_sources`, `rag_chunks`, `rag_embeddings` + HNSW index                                                   |
| `scripts/rag-demo.ts`                   | Development entry point proving storage → embedding → retrieval                                                               |
| `scripts/rag-evaluation.ts`             | RAG retrieval evaluation (Recall@3, Precision@3, MRR)                                                                         |
| `evaluation/queries.json`               | Evaluation query set                                                                                                          |

### 1.5 External Dependencies (TypeScript)

- **Groq API** (`groq-sdk`): LLM calls for extraction and overview generation. Uses `GROQ_API_KEY`.
- **CourtListener API** (public REST): legal search + full-opinion fetching (Clusters/Opinions endpoints, authenticated via `COURTLISTENER_API_TOKEN`).
- **Wikipedia API** (public REST): search + summary.
- **YouTube Transcript** (`youtube-transcript` package): video transcripts.
- **Cheerio**: HTML article extraction.
- **`natural`**: Jaro-Winkler name matching.
- **Upstash Redis** (`@upstash/redis`): caching only.
- **`@huggingface/transformers`** + **`onnxruntime-node`**: local embeddings.
- **`pg`**: PostgreSQL client for Supabase/pgvector.

---

## 2. Target Architecture: Python Pipeline

### 2.1 What Moves to Python

The **entire analysis pipeline** (Stages 1–5) will eventually move to Python. This includes:

| Stage                  | TypeScript Module                                                  | Python Module (planned)     |
| ---------------------- | ------------------------------------------------------------------ | --------------------------- |
| 1. Source Extraction   | `src/source/source.ts`, `src/source/transcript.ts`, `src/source/article.ts` | `python/casefile/source/`   |
| 2. Metadata Extraction | `src/extract/extract.ts`                                               | `python/casefile/extract/`  |
| 3. External Search     | `src/search/courtlistener.ts`, `src/search/wiki.ts`, `src/search/queries.ts`       | `python/casefile/search/`   |
| 4. Evidence Assembly   | `src/evidence/evidence.ts`                                              | `python/casefile/evidence/` |
| 5. Overview Generation | `src/overview/overview.ts`                                              | `python/casefile/overview/` |
| RAG layer              | `src/rag/*`                                                    | `python/casefile/rag/`      |
| Types                  | `src/types.ts`                                                 | `python/casefile/types.py`  |
| Cache                  | `src/cache/cache.ts`, `src/cache/redis.ts`, `src/cache/hash.ts`          | `python/casefile/cache.py`  |
| Errors                 | `src/errors.ts`                                                | `python/casefile/errors.py` |
| Pipeline orchestration | `src/app/api/analyze/route.ts`                                     | `python/casefile/pipeline/` |

### 2.2 What Stays in TypeScript/Next.js

- **UI layer** — React components (`PromptCard`, `SourceCard`, `Dropdown`, etc.) and the Next.js app shell.
- **API route** — `POST /api/analyze` remains the entry point. It will proxy to the Python pipeline rather than orchestrating stages itself.
- **Deployment** — Vercel remains the deployment target for the Next.js app.

### 2.3 How Next.js Interacts with the Python Pipeline

The interaction model is a **service boundary** between Next.js and Python. The Next.js API route becomes a thin proxy that:

1. Receives `{ url, refinementNames, model }` from the client.
2. Forwards the request to the Python pipeline service.
3. Returns the `CaseAnalysis` JSON response.

The Python pipeline is exposed as an HTTP service. Options for deployment:

- **Option A — Separate Python service (FastAPI/uvicorn):** Deployed as a standalone service (e.g., on Railway, Render, Fly.io, or a VPS). Next.js calls it via HTTP. This is the most flexible and allows Python to own the full pipeline.
- **Option B — Serverless function (AWS Lambda / Vercel Python functions):** Python runs as a serverless function. Simpler deployment but cold-start and memory constraints apply (especially for embedding models).
- **Option C — Sidecar/embedded:** Python runs as a subprocess from Next.js. Not recommended for production but useful for local development.

**Recommended:** Option A (separate FastAPI service) for the initial migration, with Option B as a future consideration. The Python service exposes a single endpoint (e.g., `POST /analyze`) that mirrors the current `/api/analyze` contract.

**Running the service locally** (use `python -m uvicorn` — the `uvicorn` CLI script may not be on `PATH` when installed into a user site-packages Scripts directory):

```bash
cd python
python -m uvicorn casefile.api.server:app --reload
```

For a hosted web-service environment, the app binds to `0.0.0.0` and reads `$PORT` (see `python/casefile/api/server.py`).

### 2.4 How RAG/Database/Caching Fit In

The existing architecture decisions (documented in `docs/rag/architecture.md` and `docs/rag/decisions.md`) remain valid:

- **Supabase PostgreSQL + pgvector** remains the RAG knowledge base. Python connects via `psycopg` or `asyncpg` and issues the same pgvector queries.
- **Upstash Redis** remains the application cache. Python connects via `redis` or `upstash-redis` client.
- **The schema is unchanged.** No database migration is needed for the Python migration itself.
- **Embeddings:** Python can use `sentence-transformers` (PyTorch) or `transformers` (HuggingFace) with the same `all-MiniLM-L6-v2` model. This is a natural fit for Python's AI/ML ecosystem.
- **LLM calls:** Python uses the `groq` SDK (or `openai` SDK with Groq's OpenAI-compatible endpoint) for extraction and overview generation.

### 2.5 Proposed Python Dependencies

| Library                     | Purpose                             | TypeScript Equivalent       |
| --------------------------- | ----------------------------------- | --------------------------- |
| `fastapi` + `uvicorn`       | HTTP service framework              | Next.js API route           |
| `httpx`                     | Async HTTP client for external APIs | `fetch`                     |
| `groq`                      | Groq LLM API client                 | `groq-sdk`                  |
| `sentence-transformers`     | Local embeddings                    | `@huggingface/transformers` |
| `psycopg` (v3) or `asyncpg` | PostgreSQL + pgvector               | `pg`                        |
| `redis` or `upstash-redis`  | Redis cache client                  | `@upstash/redis`            |
| `beautifulsoup4`            | HTML parsing/extraction             | `cheerio`                   |
| `youtube-transcript-api`    | YouTube transcript extraction       | `youtube-transcript`        |
| `jellyfish` or `rapidfuzz`  | Jaro-Winkler name matching          | `natural`                   |
| `pydantic`                  | Data validation / types             | TypeScript interfaces       |
| `pytest`                    | Testing                             | Playwright tests            |
| `python-dotenv`             | Environment configuration           | `dotenv`                    |

---

## 3. Migration Phases

### Phase 0 — Planning & Scaffolding (Complete)

- [x] Document the migration plan (`docs/python/migration.md`).
- [x] Create the `python/` scaffold with module files mirroring the TypeScript pipeline.
- [x] Define the Python package structure and dependency list (`python/pyproject.toml`).
- [x] Set up Python environment tooling (`pyproject.toml`, `python/.env.example`).
- [x] Add unit tests (`python/tests/`) for types, cache, queries, and the FastAPI service.
- [x] Update `src/app/api/analyze/route.ts` to proxy to the Python service (with TypeScript fallback).

> **Note:** This scaffolding phase has produced a complete, runnable Python port of all five pipeline stages plus the RAG layer, exposed via a FastAPI service. The Next.js `/api/analyze` route now proxies to the Python service when `PYTHON_SERVICE_URL` is set, falling back to the TypeScript reference implementation otherwise. See `python/pyproject.toml` for the full dependency list and `python/.env.example` for required environment variables.

### Phase 1 — Types & Core Infrastructure (Complete)

- [x] Port `types.ts` → `python/casefile/types.py` (Pydantic models).
- [x] Port `errors.ts` → `python/casefile/errors.py`.
- [x] Port `cache.ts`, `redis.ts`, `hash.ts` → `python/casefile/cache.py`.
- [x] Port `rag/db.ts` → `python/casefile/rag/db.py`.
- [x] **Verification:** Unit tests for types, errors, and cache key generation.

### Phase 2 — Source Extraction (Complete)

- [x] Port `source.ts`, `transcript.ts`, `article.ts` → `python/casefile/source/`.
- [x] **Verification:** Extract content from a known YouTube URL and article URL; compare output with TypeScript reference.

### Phase 3 — Metadata Extraction (Complete)

- [x] Port `extract.ts` → `python/casefile/extract/`.
- [x] **Verification:** Run extraction on known transcripts; compare `ExtractedCase` JSON with TypeScript reference.

### Phase 4 — External Search (Complete)

- [x] Port `queries.ts`, `search.ts`, `wiki.ts` → `python/casefile/search/`.
- [x] **Verification:** Run CourtListener and Wikipedia searches; compare candidates and scores with TypeScript reference.

### Phase 5 — RAG Layer (Complete)

- [x] Port `rag/chunk.ts`, `rag/embed.ts`, `rag/fetch.ts`, `rag/ingest.ts`, `rag/retrieve.ts`, `rag/cleanup.ts` → `python/casefile/rag/`.
- [x] **Verification:** Run the RAG demo equivalent; verify chunking, embedding, ingestion, and retrieval against the existing Supabase schema.

### Phase 6 — Evidence Assembly & Overview (Complete)

- [x] Port `evidence.ts` → `python/casefile/evidence/`.
- [x] Port `overview.ts` → `python/casefile/overview/`.
- [x] **Verification:** Run the full pipeline end-to-end; compare `CaseAnalysis` JSON with TypeScript reference.

### Phase 7 — Service Integration (Complete)

- [x] Create the FastAPI service (`python/casefile/api/server.py`).
- [x] Update `src/app/api/analyze/route.ts` to proxy to the Python service.
- [x] **Verification:** End-to-end test through the Next.js UI.

### Phase 8 — Cutover & Cleanup (Deferred — Fallback Retained)

- [ ] Feature-flag the Python pipeline behind an environment variable.
- [ ] Run parallel comparison (TypeScript vs. Python) on a test corpus.
- [ ] Once Python output matches TypeScript reference, switch the default to Python.
- [ ] Retire the TypeScript pipeline modules (keep as reference).

> **Note:** The Python pipeline is fully functional and verified end-to-end. However, the TypeScript fallback is intentionally retained as the default when `PYTHON_SERVICE_URL` is not set. The cutover is deferred until a parallel comparison on a test corpus confirms output parity.

### Known Issues & Fixes (Debugging Session)

The following issues were found and fixed while bringing the Python pipeline to a working state. They are documented here for reference.

#### 1. Upstash Redis `get()` returns raw JSON strings (not auto-decoded)

**Symptom:** `AttributeError: 'str' object has no attribute 'get'` in `source.py` on cache HIT.

**Root cause:** The TypeScript `@upstash/redis` client auto-decodes JSON on `get()`, but the Python `upstash-redis` client returns the raw string. The `Cache.get()` method in `python/casefile/cache.py` incorrectly assumed auto-decoding.

**Fix:** Explicitly `json.loads()` the string value in `Cache.get()`. This affects all cache consumers (source, extract, search, overview).

#### 2. `UnboundLocalError: cannot access local variable '_pool'`

**Symptom:** `UnboundLocalError: cannot access local variable '_pool' where it is not associated with a value` in `rag/db.py`.

**Root cause:** `_get_connection()` assigns to `_pool`, making Python treat it as a local variable. The `if _pool is None` check then fails because the local hasn't been assigned yet.

**Fix:** Added `global _pool` at the top of `_get_connection()`.

#### 3. `PoolClosed: the pool 'pool-1' is not open yet`

**Symptom:** `PoolClosed` error when querying the database.

**Root cause:** The `psycopg_pool.ConnectionPool` was created with `open=False` but never explicitly opened. The TS reference uses `new Pool(...)` which auto-opens.

**Fix:** Call `pool.open()` after creating the pool.

#### 4. `invalid URI query parameter: "pgbouncer"`

**Symptom:** `psycopg` rejects the Supabase `DATABASE_URL` with `invalid URI query parameter: "pgbouncer"`.

**Root cause:** The Supabase `DATABASE_URL` includes `?pgbouncer=true`, which the Node.js `pg` client accepts but `psycopg` does not understand.

**Fix:** Strip unsupported query parameters from the connection string in `psycopg_pool_from_env()`, keeping only psycopg-compatible ones (`sslmode`, `ssl`, `connect_timeout`).

#### 5. Cross-language RAG retrieval returns 0 chunks (embedding model string mismatch)

**Symptom:** TypeScript ingests a source, Python cannot retrieve it (0 chunks), and vice versa. Both implementations recognize the chunks but the retrieval filter matches nothing.

**Root cause:** The `EMBEDDING_MODEL` string differed between implementations — TS used `"Xenova/all-MiniLM-L6-v2"` while Python used `"sentence-transformers/all-MiniLM-L6-v2"`. Both use the same underlying model weights, but the `model` column in `rag_embeddings` stored the implementation-specific string. Retrieval filters on `e.model = <EMBEDDING_MODEL>`, so cross-language retrieval matched nothing.

**Fix:** Unified `EMBEDDING_MODEL` to the canonical `"all-MiniLM-L6-v2"` in both `src/rag/embed.ts` and `python/casefile/rag/embed.py`. Separated the model-loading ID from the DB-storage ID:

- `EMBEDDING_MODEL_LOAD_ID` — the HF repo used to load weights (`Xenova/all-MiniLM-L6-v2` for TS, `sentence-transformers/all-MiniLM-L6-v2` for Python)
- `EMBEDDING_MODEL` — the canonical string stored in `rag_embeddings.model` (same across both)

#### 6. `'_GeneratorContextManager' object has no attribute 'close'`

**Symptom:** `AttributeError: '_GeneratorContextManager' object has no attribute 'close'` during RAG ingestion.

**Root cause:** `_get_connection()` in `python/casefile/rag/db.py` returns a **context manager** from `psycopg_pool`, not the raw connection. The `with_transaction()` helper was calling `.close()` directly on the context manager.

**Fix:** Updated `with_transaction()` to use the same `with _get_connection() as conn:` pattern that `query()`, `query_one()`, and `execute()` use. The `with` block properly enters the pool's context manager to check the connection out (and back into) the pool.

#### 7. `the last operation didn't produce records (command status: INSERT 0 1)`

**Symptom:** `psycopg.ProgrammingError: the last operation didn't produce records` during RAG ingestion of `rag_embeddings`.

**Root cause:** The transaction-scoped `tq()` helper in `with_transaction()` **unconditionally calls `fetchall()`** after every `cur.execute()`. The `rag_embeddings` INSERT has no `RETURNING` clause, so calling `fetchall()` on a statement that produces no rows raises this error.

**Fix:** Added a third transaction-scoped helper `te()` (execute) to `with_transaction()` that runs INSERT/UPDATE/DELETE statements without calling `fetchall()`. Updated `ingest.py` to use `te()` for the `rag_embeddings` INSERT (which has no `RETURNING`), while `tq()`/`tq1()` continue to be used for queries that return rows (source and chunk INSERT ... RETURNING).

#### 8. RAG ingestion dedup URL mismatch (CourtListener)

**Symptom:** CourtListener sources were re-fetched and re-ingested on every request even when already in the knowledge base.

**Root cause:** `findReusableSource()` was checked against the **search result URL** but `ingestSource()` stored the **fetched source URL** (which can differ for CourtListener — the search result URL vs. the resolved opinion URL).

**Fix:** Added a second dedup check in `ingestExternalSource()` (both `src/evidence/evidence.ts` and `python/casefile/evidence/evidence.py`) using the actual fetched `source.url` to avoid unnecessary external fetches and re-ingestion.

#### 9. RAG ingestion runtime optimization (batched inserts + transaction)

**Change:** Replaced the per-chunk insert loop (2N+1 DB round trips) with batched multi-row INSERTs wrapped in a single transaction:

- **TypeScript (`src/rag/ingest.ts`):** Multi-row `INSERT ... VALUES (...), (...)` for all chunks and all embeddings, wrapped in `withTransaction()` from `src/rag/db.ts`. Reduces round trips from 2N+1 to ~3.
- **Python (`python/casefile/rag/ingest.py`):** Single-row `INSERT ... RETURNING` per chunk (reliable with psycopg v3) and `te()` for embeddings, all inside `with_transaction()`. Preserves atomicity and reduces per-statement commit overhead.

---

## 4. Risks & Open Questions

### 4.1 Risks

| Risk                        | Impact                                                                                                                                                                      | Mitigation                                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Embedding model parity**  | Python `sentence-transformers` and TypeScript `@huggingface/transformers` may produce slightly different vectors for the same model, affecting retrieval similarity scores. | Use the same model (`all-MiniLM-L6-v2`); verify retrieval results are comparable. If exact parity is needed, use the same ONNX runtime in both. |
| **LLM output variance**     | Groq LLM responses are non-deterministic; extraction and overview output may differ between runs.                                                                           | Use low temperature (0.1–0.2) as in the current implementation; compare structural output, not exact text.                                      |
| **Deployment complexity**   | Adding a Python service introduces a new deployment target and operational surface.                                                                                         | Start with a simple FastAPI service; document deployment; consider serverless later.                                                            |
| **Cold-start latency**      | Python embedding models (PyTorch) have larger cold-start latency than Transformers.js.                                                                                      | Use `sentence-transformers` with ONNX backend or `fastembed` for lighter loading; consider model caching.                                       |
| **Rate limits**             | CourtListener and Wikipedia API rate limits apply regardless of language.                                                                                                   | Preserve the existing Redis caching strategy.                                                                                                   |
| **Redis key compatibility** | Python must generate the same cache keys as TypeScript to reuse cached data.                                                                                                | Port `hash.ts` (SHA-256) exactly; verify key format matches.                                                                                    |
| **pgvector query parity**   | Python must issue the same SQL queries to the same schema.                                                                                                                  | Port the SQL queries verbatim; verify against the existing Supabase schema.                                                                     |

### 4.2 Open Questions

1. **Service deployment target** — Where will the Python service run? (Railway, Render, Fly.io, VPS, serverless?)
2. **Embedding library choice** — `sentence-transformers` (PyTorch) vs. `fastembed` (ONNX) vs. `transformers` (HuggingFace)? Trade-off: model loading speed vs. ecosystem maturity.
3. **Async vs. sync** — Should the Python pipeline use `async` (FastAPI-native) or `sync` (simpler, easier to port)? The current TypeScript pipeline is fully async.
4. **Cache key compatibility** — Should Python reuse the exact same Redis keys as TypeScript (to share cache), or use a separate namespace during migration?
5. **LLM client** — Use the `groq` SDK directly, or the `openai` SDK with Groq's OpenAI-compatible endpoint? The latter is more portable.
6. **Testing strategy** — Should Python have its own test suite, or should the existing Playwright E2E tests be extended to cover the Python service?
7. **Feature flagging** — How should the cutover be managed? Environment variable, config flag, or A/B comparison?
8. **YouTube transcript library** — `youtube-transcript-api` is the Python equivalent of `youtube-transcript`. Verify it handles the same error cases (disabled, unavailable, rate-limited, etc.).
9. **HTML extraction parity** — `beautifulsoup4` may extract slightly different text than `cheerio` for the same HTML. Verify article text extraction is comparable.
10. **Jaro-Winkler parity** — `jellyfish` and `rapidfuzz` may implement Jaro-Winkler slightly differently than `natural`. Verify name refinement produces the same results.

---

## 5. Reference Implementation

The TypeScript implementation in `src/` remains the **reference implementation** throughout the migration. It is not modified or deleted. The Python implementation is developed against it, with output compared stage-by-stage.

Key reference files:

- `src/app/api/analyze/route.ts` — pipeline orchestration
- `src/source/source.ts`, `src/source/transcript.ts`, `src/source/article.ts` — Stage 1
- `src/extract/extract.ts` — Stage 2
- `src/search/courtlistener.ts`, `src/search/wiki.ts`, `src/search/queries.ts` — Stage 3
- `src/evidence/evidence.ts` — Stage 4
- `src/overview/overview.ts` — Stage 5
- `src/rag/*` — RAG layer
- `src/types.ts`, `src/cache/cache.ts`, `src/cache/redis.ts`, `src/cache/hash.ts`, `src/errors.ts` — supporting infrastructure
