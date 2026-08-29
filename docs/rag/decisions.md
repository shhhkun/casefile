# CaseFile RAG — Architectural Decisions

This document captures the architectural decisions for the CaseFile RAG layer. It is based on the actual state of the repository (as of commit `f5dc249`) and distinguishes between what CaseFile currently does, what the RAG layer will add, and what remains an open question requiring experimentation.

---

## 1. Free-to-Operate Constraint

### 1.1 The Constraint

CaseFile must remain entirely free to operate. The architecture must not introduce **mandatory paid API usage** or **mandatory paid infrastructure costs**. Where an approach has usage limits, free-tier restrictions, or would eventually require payment at a realistic CaseFile scale, this must be made explicit.

**Immediate consequence:** The presence of the `openai` package in `package.json` is **not** a reason to favor OpenAI embeddings. OpenAI embeddings require a paid API key. This is flagged as a cost trap, not a convenience. The `openai` package is currently unused in any code path.

### 1.2 Cost Evaluation Framework

Every option below is evaluated against three questions:

1. **Is it free today?** (initial cost)
2. **Does it remain free at realistic CaseFile scale?** (sustained cost)
3. **What is the operational cost?** (latency, maintenance, complexity)

---

## 2. Settled Architecture: Shared Persistent-but-Expiring Knowledge Base

### 2.1 The Decision

CaseFile uses a **shared, persistent-but-expiring knowledge base** for RAG. This is the settled architecture, not a proposal.

- The application remains **stateless**: no user accounts, no authentication, no per-user knowledge bases. All users contribute to and retrieve from the same shared corpus, matching the existing stateless design of the application.
- The knowledge base is **bounded with TTLs** so it does not grow indefinitely.
- Repeated analysis of the same URL **reuses previously processed RAG data** rather than re-fetching, re-chunking, and re-embedding it.

### 2.2 Alternatives Considered (and Why They Were Not Chosen)

**Per-request in-memory RAG** — each request embeds its own chunks and searches only within that request's data, discarding everything after the response.

- Rejected because it would re-extract, re-chunk, and re-embed the same source on every submission, provide no cross-source retrieval, and waste redundant LLM/embedding work.
- It would also ignore CaseFile's existing Redis TTL caching pattern, which is designed to reuse work across requests.

**Per-user knowledge bases** — rejected because the application has no user accounts or authentication by design. A shared corpus is the natural fit for the stateless model.

### 2.3 The Settled Stack

| Layer                         | Technology                                                                  |
| ----------------------------- | --------------------------------------------------------------------------- |
| LLM inference                 | **Groq** (`openai/gpt-oss-120b`)                                            |
| Embeddings                    | **Transformers.js** (`@huggingface/transformers`) + local open-source model |
| Persistent RAG knowledge base | **Supabase PostgreSQL + pgvector**                                          |
| Application cache             | **Upstash Redis** (TTL-based)                                               |
| Deployment                    | **Vercel**                                                                  |

### 2.4 Implementation Status

The RAG storage/retrieval layer is **implemented** as real CaseFile code under `src/lib/rag/` (types, db, chunk, embed, fetch, ingest, retrieve, cleanup, index), with a pgvector migration (`supabase/migrations/0001_rag_init.sql`) and a development entry point (`scripts/rag-demo.ts`).

**Integration into `/api/analyze`:** RAG is now wired into the Evidence Assembly stage (`src/lib/evidence.ts`). The #1 CourtListener and #1 Wikipedia search results are preserved as pipeline metadata (`SearchContext`) in `src/app/api/analyze/route.ts` and passed to `fetchEvidence`, which ingests them through the existing `ingestSource` layer and retrieves relevant chunks via `retrieveChunks` (`topK: 3`). Retrieved chunks are added to the `Evidence` object as `ragChunks`, making them available to the overview-generation stage without modifying its prompt or model.

**RAG source material (implemented):** RAG ingests the **full underlying documents** of the top search results, not the search snippets/summaries and not the user's original URL:

- **CourtListener:** the selected search result is an opinion cluster. `fetchCourtListenerSource` (`src/lib/rag/fetch.ts`) resolves the cluster via the Clusters API to its `sub_opinions`, fetches the first opinion through the Opinions API, prefers `html_with_citations`, and normalizes it to readable text (Cheerio) before passing it to `ingestSource`. The `cluster_id` is preserved from the search stage (`search.ts` → `SearchContext`). The Clusters/Opinions requests are authenticated with `COURTLISTENER_API_TOKEN` from `.env.local`.
- **Wikipedia:** `fetchWikipediaSource` (`src/lib/rag/fetch.ts`) fetches the full article via the MediaWiki REST `with_html` endpoint and normalizes the HTML to readable text before passing it to `ingestSource`.

The normal evidence (Wikipedia summary, CourtListener snippet) is preserved unchanged for the existing pipeline. Missing/failed full-document retrieval is non-fatal — that source is skipped and RAG continues with whatever remains.

**External fetching is separated from evidence orchestration.** `fetch.ts` owns all external full-document fetching (CourtListener Clusters/Opinions, Wikipedia `with_html`) and returns a normalized `FetchedSource`. `evidence.ts` orchestrates: it runs `deleteExpiredSources()` first, then for each source checks `findReusableSource` (a cheap DB query for an existing **unexpired** source) **before** calling the external fetch. This avoids unnecessary CourtListener/Wikipedia requests — and the expensive chunking/embedding that follows — when a valid source already exists in the knowledge base. Expired sources are actively removed through the existing cascading cleanup mechanism rather than accumulating.

Implementation verification:

- `npm run typecheck` — passes (no type errors).
- `npm run lint` — passes (no lint errors).
- `npm run db:migrate` — applies the pgvector schema + HNSW index to Supabase (verified).
- `npm run rag:demo` — proves the full path: chunking → local embedding → Supabase persistence → pgvector retrieval (cross-source + current-source) → dedup/reuse (verified).
- E2E tests (`npm test`) — error-path tests pass; full-pipeline tests require external API access (Groq, CourtListener, Wikipedia) and timeout in environments without valid API keys.

---

## 3. Decision: Embeddings — Locked In

### 3.1 The Decision

Use **local embeddings via Transformers.js (`@huggingface/transformers`)** as the initial embedding implementation.

- **Model:** an open-source local embedding model such as `all-MiniLM-L6-v2` (384-dim). Transformers.js defaults to fp32 weights (`onnx/model.onnx`, ~90 MB); CaseFile pins `dtype: "q8"` to load the int8 quantized variant (`onnx/model_quantized.onnx`, ~23 MB), cutting the in-process model footprint ~4x without changing the stored embedding model id. Unless repository investigation gives a strong reason to choose another small model.
- **Requirement:** zero API cost and no external embedding-service dependency.
- **Explicitly not used:** OpenAI embeddings. The existing `openai` package is unrelated and does not influence this decision.

### 3.2 Options Evaluated (for the record)

#### Option 1 — Local embeddings via Transformers.js — **CHOSEN**

- Runs models like `all-MiniLM-L6-v2` (~23M params, 384-dim) or `bge-small-en-v1.5` (~130M params, 384-dim) entirely in Node.js. With Transformers.js the fp32 `onnx/model.onnx` is ~90 MB; CaseFile loads the int8 quantized `onnx/model_quantized.onnx` (~23 MB) via `dtype: "q8"`.
- **Free today:** Yes — zero API cost, runs in-process.
- **Free at realistic scale:** Yes — no quotas, no rate limits.
- **Operational cost:** Cold-start latency on Vercel serverless. Model weights load on first invocation after a cold start. Mitigations:
  - Reuse the model across warm invocations (module-level singleton).
  - Accept first-request latency (a few seconds) after a cold start.
  - Use a smaller model (`all-MiniLM-L6-v2`) to minimize weight load.

#### Option 2 — FastEmbed (Qdrant, ONNX-based)

- **Free today:** Yes — local, ONNX models.
- **Free at realistic scale:** Yes.
- **Operational cost:** Similar to Transformers.js — cold-start weight loading. Different API surface.
- **Verdict:** Viable alternative; Transformers.js chosen because it is more widely used and has better serverless documentation.

#### Option 3 — Free-tier embedding APIs (HuggingFace Inference API, Google Gemini free tier)

- **Free today:** Yes, via free tiers.
- **Free at realistic scale:** **No — both have quotas and rate limits.** HuggingFace free tier is rate-limited; Google Gemini free tier has RPM/day quotas. At a realistic CaseFile scale (a growing shared knowledge base with repeat analyses), these would eventually throttle.
- **Verdict:** Not chosen as the primary implementation. Could serve as a config-driven fallback in the future if cold-start becomes unacceptable, with explicit rate-limit caveats.

#### Option 4 — OpenAI embeddings (`text-embedding-3-small`)

- **Free today:** **No.** Requires a paid API key. The `openai` package is already a dependency, but this is a cost trap.
- **Verdict:** Rejected — violates the free-to-operate constraint outright.

#### Option 5 — Ollama (local service)

- **Free today:** Yes — fully local.
- **Free at realistic scale:** Yes.
- **Operational cost:** Requires a separately running Ollama service. Awkward for a Vercel/serverless deployment where a background daemon cannot run persistently. Only viable on a self-hosted Node server.
- **Verdict:** Documented but not viable for the Vercel deployment.

### 3.3 Operational Tradeoff (accepted, not a decision)

The Vercel cold-start/memory tradeoff is an **operational consideration**, not an open decision. Mitigation is a module-level model singleton and use of the smallest adequate model.

---

## 4. Decision: Vector Storage / Search — Locked In

### 4.1 The Decision

Use **Supabase hosted PostgreSQL + pgvector** as the dedicated persistent vector/RAG store. The separation is intentional:

- **Upstash Redis** → temporary application/cache data only (`cache:*` keys).
- **Supabase/Postgres + pgvector** → chunks, embeddings, and RAG metadata.

Supabase is acceptable **because the RAG architecture must remain free to operate**. The free-tier/storage/compute constraints and the point at which the architecture might need reconsideration are documented below. **Supabase is not replaced merely because a paid option could scale further.**

### 4.2 Relational Schema

The RAG database is designed around a proper relational schema, not Redis-style URL key/value blobs:

- `sources` — id, url (unique dedup key), source_type, title, source_text, extracted_meta (JSONB), ingested_at, expires_at
- `chunks` — id, source_id (FK, ON DELETE CASCADE), chunk_index, text, char_start, char_end, token_count
- `embeddings` — id, chunk_id (FK, ON DELETE CASCADE), model, dimensions, vector (pgvector column)

See `architecture.md` §2.3 for the full schema.

### 4.3 Similarity Search in the Database

- **Locked in:** pgvector similarity search in the database, not retrieving every embedding into application memory and manually calculating cosine similarity.
- Retrieval uses the `<=>` (cosine distance) operator with an `ORDER BY ... LIMIT k` query, so search happens in Postgres using vector indexing/search mechanisms. This keeps retrieval semantically based as the corpus grows and avoids an O(n) application-side scan of every embedding.

### 4.4 Indexing Strategy

Two pgvector index types are relevant:

- **HNSW** — graph-based approximate index. No periodic rebuild required; good recall; build cost grows with corpus size. Appropriate for datasets in the low millions of rows. At CaseFile's expected corpus size (hundreds to low-thousands of chunks), HNSW is the appropriate default.
- **IVFFlat** — partition-based approximate index. Requires a periodic `REBUILD` as the corpus grows (the initial `lists` value is sized at index creation). Cheaper to build than HNSW but needs maintenance.

**Recommendation:** Use **HNSW** as the default for CaseFile's expected corpus size. IVFFlat is a viable lower-memory alternative but adds rebuild maintenance. Exact index choice and tuning parameters remain an open decision (see §10).

### 4.5 Supabase Free-Tier Constraints

- **Storage:** Supabase free tier provides 500 MB database storage. Given ~384-dim vectors per chunk and text chunks, the realistic capacity is well beyond CaseFile's near-term needs (a few thousand chunks).
- **Compute:** Free-tier projects can pause after 1 week of inactivity; unpausing is automatic on the next request but adds latency.
- **Connections:** connection limits apply; use the transaction-mode pooler (`DATABASE_URL`, port 6543) for normal traffic and the session-mode pooler (`DIRECT_URL`, port 5432) for migrations — both already configured in `.env.local`.
- **Reconsideration point:** if the corpus grows such that storage, compute pause latency, or connection limits become a real constraint, the architecture would need reconsideration. This is a future scenario, not a current concern, and is not a reason to adopt a paid service speculatively.

### 4.6 Options Evaluated (for the record)

#### Supabase + pgvector — **CHOSEN**

- **Free today:** Yes — Supabase free tier.
- **Free at realistic scale:** Yes for CaseFile's expected corpus; constraints documented above.
- **Operational cost:** New database dependency; network reachable from Vercel; migration management.

#### Upstash Redis + brute-force cosine similarity — **REJECTED**

- Would store embeddings in Redis and compute similarity in application code.
- **Free today:** Yes.
- **Free at realistic scale:** Unclear — the Upstash **500k commands/month** free-tier limit would be consumed by reading every embedding into application memory per retrieval, which is the O(n) scan the pgvector approach avoids.
- Also conflicts with the architectural separation: Redis is the cache, not the knowledge base.
- **Verdict:** Rejected — the O(n) application-side scan does not scale and turns Redis into an additional retrieval layer.

#### Upstash Vector — **REJECTED**

- Integrates with the existing Upstash account; has a free tier.
- **Free at realistic scale:** **Not guaranteed.** Upstash Vector is a paid service beyond the free tier. Free-tier limits (storage/requests) would eventually be hit as the knowledge base grows.
- **Verdict:** Flagged: free-tier only, paid at scale. Not chosen.

#### pgvector on Neon (alternative Postgres host) — **NOT CHOSEN**

- Neon free tier exists and offers pgvector.
- **Verdict:** Supabase was chosen over Neon because Supabase is the configured Postgres provider in `.env.local` and the free tier is sufficient. No concrete incompatibility with Neon was found; this is a config/infrastructure preference, not a technical blocker.

#### SQLite + `sqlite-vec` / LanceDB / `hnswlib-node` (local embedded) — **REJECTED**

- Free and local, but Vercel's serverless filesystem is ephemeral and effectively read-only. These only work on a self-hosted Node server.
- **Verdict:** Incompatible with the current Vercel deployment.

---

## 5. Decision: Chunking — Baseline Locked In, Strategy Modular

### 5.1 The Decision

Use **token-based chunking as the initial baseline**. The implemented default (`chunkText` in `src/lib/rag/chunk.ts`) is **300 tokens with 50-token overlap**, reduced from the original 512–1024 token target during development to keep retrieved chunks compact for the LLM context budget.

- Chunking is kept **modular** because this is one of the genuinely open areas.
- CaseFile primarily processes human-written articles, transcripts, and eventually CourtListener legal opinions, so **preserving semantic boundaries is important**.
- A future improvement could use **paragraph/section-aware chunking** where appropriate, rather than assuming arbitrary fixed character boundaries are ideal.
- **LLM-based semantic chunking is not introduced** unless a demonstrated benefit exists, since it would add unnecessary inference cost and complexity.

### 5.2 Current State

- `extractCase` truncates source text to the first 12,000 chars.
- `fetchEvidence` truncates `originalText` to 14,000 chars using head (60%) + tail (40%) — the middle is dropped entirely.
- The RAG module (`src/lib/rag/chunk.ts`) implements token-based chunking with overlap (`chunkText`), used by `ingestSource`. It is now wired into the `/api/analyze` pipeline via Evidence Assembly (see §12).

### 5.3 Open Sub-Decisions (see §10)

- Exact chunk size and overlap.
- Whether/when to move to paragraph/section-aware chunking for articles, transcripts, and legal opinions.

---

## 6. Decision: TTL / Lifecycle — Configurable Retention

### 6.1 The Decision

The knowledge base is **persistent across requests but temporary over time**. Use a TTL/expiration policy so old documents, chunks, and embeddings eventually disappear.

- **The exact TTL is configurable**, not permanently fixed at 3 days.
- The current 3-day Redis source cache is a **reference point**, but RAG retention should be chosen based on storage usage, retrieval usefulness, and Supabase free-tier limits.

### 6.2 Implementation

- Each `sources` row carries an `expires_at` timestamp.
- Expired documents and their associated chunks/embeddings are removed safely:
  - `chunks` and `embeddings` have `ON DELETE CASCADE` from `sources`, so deleting an expired source automatically removes all associated RAG data.
  - **Active cleanup (implemented):** `fetchEvidence` calls `deleteExpiredSources()` (`src/lib/rag/cleanup.ts`) before ingestion, so expired rows are removed through the existing cascading cleanup mechanism on every analysis. This keeps the knowledge base bounded without requiring a separate scheduled job.
  - A **scheduled cleanup job** (cron/edge function) remains a possible future addition for environments where the active cleanup is insufficient.

### 6.3 Open Sub-Decisions

- Exact TTL/retention period (configurable; see §10).
- Whether TTLs differ by source type (e.g., YouTube transcript vs. article) — an optimization, not a requirement.

---

## 7. Decision: Retrieval Scope — Current-Source Priority + Cross-Source Supplement

### 7.1 The Decision

- **Current-source receive priority.** The source being analyzed is always the primary context.
- **Cross-source retrieval supplements.** Related/corroborating context from the shared knowledge base is added as secondary context.
- **External search remains part of the system.** CourtListener/Wikipedia keyword search stays; RAG is initially **additive**, not a replacement for those external sources.

### 7.2 Interaction with CourtListener / Wikipedia

- The existing external keyword search is **unchanged**.
- Internal retrieval is **additive**: it augments the `Evidence` object passed to `generateOverview` alongside the existing Wikipedia summary and CourtListener snippet.
- The RAG layer provides internal context; CourtListener/Wikipedia provides external/legal context. They complement, not replace, each other.

### 7.3 Future Stages (explicit decisions, not assumptions)

Retrieval could eventually improve more than `generateOverview`:

- **`extractCase`** may benefit from retrieved context instead of the raw 12,000-char truncation.

These remain **explicit future decisions** and are not assumed in the current implementation plan.

---

## 8. Redis: Cache-Only, Namespaced, Respecting Free-Tier Limits

### 8.1 The Decision

Keep Redis cache keys conceptually separated from RAG storage. Prefer simple namespaces:

```
cache:source:{hash}
cache:extract:{hash}
cache:overview:{hash}
cache:courtlistener:{hash}
cache:wikipedia:{hash}
```

The exact key structure is implementation-specific, but the architectural distinction is fixed:

**Redis is the cache. Supabase/pgvector is the knowledge base.**

### 8.2 Upstash Free-Tier Constraint

The existing Upstash Redis **500k commands/month** free-tier limit is explicitly acknowledged:

- RAG must not cause unnecessary Redis reads/writes.
- Redis is **never** used as a vector store or retrieval layer.
- All RAG data (chunks, embeddings, metadata) lives in Supabase/pgvector.

---

## 9. Vercel / Serverless Deployment Fit

### 9.1 What Works

- **Supabase Postgres + pgvector:** reachable over the network from Vercel; similarity search happens in the database, keeping serverless functions compute-light.
- **Upstash Redis (REST):** serverless-compatible, cache-only, already in use.
- **No local filesystem dependency:** all RAG data lives in Postgres; cache lives in Redis.

### 9.2 Operational Tradeoff: Local Embeddings Cold-Start

- Transformers.js loads model weights on first use. For `all-MiniLM-L6-v2`, CaseFile loads the int8 quantized variant (`onnx/model_quantized.onnx`, ~23 MB) via `dtype: "q8"` rather than the default fp32 (`onnx/model.onnx`, ~90 MB).
- On Vercel, each cold start reloads the model into memory, adding seconds of latency to the first request.
- Warm invocations reuse the module-level model instance.
- `embedTexts` runs inference in bounded sequential batches of 16 chunks so a long document's chunk embeddings never create one large in-memory batch.

Mitigations (accepted as operational, not a decision):

1. Use the smallest adequate model (`all-MiniLM-L6-v2`).
2. Load the int8 quantized weights (`dtype: "q8"`) instead of fp32.
3. Cache the model instance at module scope (idiomatic for serverless warm reuse).
4. Bound the embedding inference batch size (16 chunks).
5. Accept first-request latency as a documented operational cost.

### 9.3 Supabase Free-Tier Operational Notes

- Free-tier projects may pause after 1 week of inactivity; the next request auto-unpauses with added latency.
- Connection limits apply; use the pooler (`DATABASE_URL`, port 6543) for normal traffic and `DIRECT_URL` (port 5432) for migrations — both already configured in `.env.local`.

### 9.4 Configuration

Supabase connection details are read from the existing `.env.local`:

- `DATABASE_URL`
- `DIRECT_URL`

CourtListener full-opinion fetching (`src/lib/rag/fetch.ts`) additionally requires `COURTLISTENER_API_TOKEN` in `.env.local` to authenticate the Clusters/Opinions API requests.

The implementation uses the existing `.env` configuration rather than hardcoding credentials.

---

## 10. Open Decisions

These are the genuinely unresolved items that require experimentation:

1. **Exact embedding model** — `all-MiniLM-L6-v2` is the default; another small open-source model may be chosen based on retrieval quality.
2. **Exact chunk size/overlap** — implemented default is 300 tokens / 50 overlap; exact values need empirical validation.
3. **Paragraph/section-aware chunking improvements** — whether/when to move beyond fixed token boundaries for articles, transcripts, and CourtListener opinions.
4. **pgvector index choice/tuning** — HNSW vs. IVFFlat, and index parameters, at CaseFile's expected corpus size.
5. **Exact TTL/retention period** — configurable; chosen based on storage usage, retrieval usefulness, and Supabase limits.
6. **Which pipeline stages consume retrieved context beyond `generateOverview`** — `extractCase` is a candidate but not assumed.
7. **Retrieval top-k/context limits and ranking strategy** — how many chunks, how much context budget, and how current-source vs. cross-source results are ranked/combined.

---

## 11. Summary of Decisions

| Layer                         | Decision                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Architecture                  | Shared persistent-but-expiring knowledge base; stateless app                                              |
| LLM inference                 | **Groq** (`openai/gpt-oss-120b`)                                                                          |
| Embeddings                    | **Transformers.js** (`@huggingface/transformers`) + local open-source model (`all-MiniLM-L6-v2` default)  |
| Persistent RAG knowledge base | **Supabase PostgreSQL + pgvector** — relational schema, HNSW index default                                |
| Retrieval                     | pgvector similarity search in the database (`<=>` + `ORDER BY ... LIMIT k`)                               |
| Chunking                      | Token-based chunking, 300-token default with 50-token overlap (modular; paragraph/section-aware later)    |
| TTL / lifecycle               | Configurable `expires_at`; cascade deletion; active cleanup via `deleteExpiredSources()` before ingestion |
| Retrieval scope               | Current-source priority + top-k cross-source supplement; external search remains additive                 |
| Application cache             | **Upstash Redis** — cache-only, `cache:*` namespaces, respecting 500k commands/month                      |
| Deployment                    | **Vercel** — cold-start accepted as operational consideration                                             |
| Free-to-operate               | No mandatory paid API or infrastructure                                                                   |

These decisions keep CaseFile free to operate, align with its existing stateless architecture, maintain a clear separation between caching and RAG storage, and are proportional to its current scale.

---

## 12. Decision: RAG Integration — Evidence Assembly Containment

### 12.1 The Decision

RAG ingestion and retrieval are **contained entirely within the Evidence Assembly stage** (`src/lib/evidence.ts`). No RAG logic is introduced into metadata extraction or any earlier LLM stage.

### 12.2 Rationale

- **Minimal pipeline disruption:** The existing CaseFile pipeline (Source Extraction → Metadata Extraction → Search → Evidence Assembly → Overview) remains conceptually unchanged. The only pipeline-level adjustment is preserving the #1 CourtListener and #1 Wikipedia search results as `SearchContext` metadata for Evidence Assembly.
- **No ingestion of the user's original URL:** The user's original source is not ingested into the RAG knowledge base. Instead, the **full underlying documents** of the top search results (the CourtListener opinion and the Wikipedia article) are ingested as external corroborating sources.
- **Additive and non-fatal:** RAG retrieval augments the `Evidence` object with `ragChunks` but does not replace existing evidence. If RAG fails (database unavailable, embedding model fails to load), normal evidence assembly still succeeds.
- **No overview-generation changes:** The `ragChunks` field is included in the `Evidence` object, which is already serialized into the overview prompt via `JSON.stringify(evidence)`. The overview-generation prompt and model are not modified.

### 12.3 Implementation Details

- **`SearchContext` type** (`src/lib/evidence.ts`): Captures the #1 CourtListener result (`title`, `url`, `snippet`, `court`, `dateFiled`, `clusterId`) and #1 Wikipedia result (`title`, `url`, `summary`) from the search stage.
- **Route wiring** (`src/app/api/analyze/route.ts`): After search, the #1 results are extracted from `courtResults[0]` and `wikiResult.candidates[0]` + `wikiResult.summary`, assembled into a `SearchContext`, and passed to `fetchEvidence`. The top CourtListener `cluster_id` is preserved so Evidence Assembly can resolve it to the underlying opinion.
- **External full-document fetching** (`src/lib/rag/fetch.ts`): A dedicated module owns all external full-document retrieval, separated from evidence orchestration:
  - **CourtListener:** `fetchCourtListenerSource(clusterId)` resolves the cluster via the Clusters API to its `sub_opinions`; the first opinion is fetched via the Opinions API, preferring `html_with_citations`, then normalized to readable text (Cheerio). Authenticated with `COURTLISTENER_API_TOKEN`.
  - **Wikipedia:** `fetchWikipediaSource(title, url)` fetches the full article via the MediaWiki REST `with_html` endpoint and normalizes the HTML to readable text (Cheerio).
  - Both return a normalized `FetchedSource` or `null` (non-fatal on failure).
- **Dedup-before-fetch** (`src/lib/evidence.ts`): Before any external fetch, `findReusableSource` (`src/lib/rag/ingest.ts`) checks the knowledge base for an existing **unexpired** source row. If found, the external fetch, chunking, and embedding are skipped entirely and the stored chunks/embeddings are reused. This is especially important for CourtListener, whose Clusters/Opinions endpoints are token-authenticated and rate-limited.
- **Active cleanup** (`src/lib/evidence.ts`): `fetchEvidence` calls `deleteExpiredSources()` before ingestion, so expired sources (and their cascading chunks/embeddings) are actively removed through the existing cleanup mechanism.
- **Ingest** (`src/lib/evidence.ts`): The full CourtListener opinion text and full Wikipedia article text are ingested via the existing `ingestSource` function. At most 2 external sources are ingested per analysis. The existing URL deduplication and TTL behavior is reused. Missing/failed full-document retrieval is non-fatal — that source is skipped.
- **Retrieve** (`src/lib/evidence.ts`): A retrieval query is built from the extracted case signals (caseName, defendant, victim, crimeType, jurisdiction, state, approximateYear, keywords). The existing `retrieveChunks` function is called with `topK: 3` to retrieve relevant chunks from the knowledge base.
- **Non-fatal error handling:** Both ingestion and retrieval are wrapped in try/catch blocks. Per-source ingestion errors are caught individually; overall RAG errors are caught at the block level. The `ragChunks` field is left empty if RAG fails.

### 12.4 Deviation from Originally Intended Flow

The originally intended flow (architecture.md §2.10) planned RAG ingestion immediately after Source Extraction (Stage 2), ingesting the user's original source URL. The implemented design instead:

1. Defers all RAG logic to Evidence Assembly (Stage 4).
2. Ingests the **full underlying documents** of the top search results (not the user's original URL, and not the snippets/summaries) as RAG sources.
3. Preserves search results as pipeline metadata (`SearchContext`, including the CourtListener `cluster_id`) without altering candidate resolution.
