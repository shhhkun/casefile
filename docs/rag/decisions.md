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

The first RAG storage/retrieval integration is **implemented** on the `feat/rag` branch as real CaseFile code under `src/lib/rag/` (types, db, chunk, embed, ingest, retrieve, cleanup, index), with a pgvector migration (`supabase/migrations/0001_rag_init.sql`) and a development entry point (`scripts/rag-demo.ts`). It is **not yet wired into `/api/analyze`** — that remains a separate integration step.

Implementation verification (run locally):

- `npm run db:migrate` — applies the pgvector schema + HNSW index to Supabase (verified).
- `npm run rag:demo` — proves the full path: chunking → local embedding → Supabase persistence → pgvector retrieval (cross-source + current-source) → dedup/reuse (verified).

**Implementation deviation discovered during work:** the `DATABASE_URL` / `DIRECT_URL` values in `.env.local` contained an unencoded `@` inside the password, which broke pg connection-string parsing. The password is now URL-encoded (`%2Ftx%21hmjL%40Y_ia9X`) in both connection strings. The actual Supabase password was **not** changed.

---

## 3. Decision: Embeddings — Locked In

### 3.1 The Decision

Use **local embeddings via Transformers.js (`@huggingface/transformers`)** as the initial embedding implementation.

- **Model:** an open-source local embedding model such as `all-MiniLM-L6-v2` (384-dim, ~25 MB) unless repository investigation gives a strong reason to choose another small model.
- **Requirement:** zero API cost and no external embedding-service dependency.
- **Explicitly not used:** OpenAI embeddings. The existing `openai` package is unrelated and does not influence this decision.

### 3.2 Options Evaluated (for the record)

#### Option 1 — Local embeddings via Transformers.js — **CHOSEN**

- Runs models like `all-MiniLM-L6-v2` (~23M params, 384-dim, ~25 MB) or `bge-small-en-v1.5` (~130M params, 384-dim) entirely in Node.js.
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

Use **token-based chunking as the initial baseline**, approximately 512–1024 tokens with overlap.

- Chunking is kept **modular** because this is one of the genuinely open areas.
- CaseFile primarily processes human-written articles, transcripts, and eventually CourtListener legal opinions, so **preserving semantic boundaries is important**.
- A future improvement could use **paragraph/section-aware chunking** where appropriate, rather than assuming arbitrary fixed character boundaries are ideal.
- **LLM-based semantic chunking is not introduced** unless a demonstrated benefit exists, since it would add unnecessary inference cost and complexity.

### 5.2 Current State

- `extractCase` truncates source text to the first 12,000 chars.
- `fetchEvidence` truncates `originalText` to 14,000 chars using head (60%) + tail (40%) — the middle is dropped entirely.
- The RAG module (`src/lib/rag/chunk.ts`) implements token-based chunking with overlap (`chunkText`), used by `ingestSource`. It is not yet wired into the `/api/analyze` pipeline.

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
  - A **lazy cleanup** query can run during retrieval (e.g., `DELETE FROM sources WHERE expires_at < now()`), and/or
  - A **scheduled cleanup job** (cron/edge function) can delete expired sources periodically.

### 6.3 Open Sub-Decisions

- Exact TTL/retention period (configurable; see §10).
- Whether TTLs differ by source type (e.g., YouTube transcript vs. article) — an optimization, not a requirement.

---

## 7. Decision: Retrieval Scope — Current-Source Priority + Cross-Source Supplement

### 7.1 The Decision

- **Current-source chunks receive priority.** The source being analyzed is always the primary context.
- **Cross-source retrieval supplements.** Related/corroborating context from the shared knowledge base is added as secondary context.
- **External search remains part of the system.** CourtListener/Wikipedia keyword search stays; RAG is initially **additive**, not a replacement for those external sources.

### 7.2 Interaction with CourtListener / Wikipedia

- The existing external keyword search is **unchanged**.
- Internal retrieval is **additive**: it augments the `Evidence` object passed to `generateOverview` alongside the existing Wikipedia summary and CourtListener snippet.
- The RAG layer provides internal context; CourtListener/Wikipedia provides external/legal context. They complement, not replace, each other.

### 7.3 Future Stages (explicit decisions, not assumptions)

Retrieval could eventually improve more than `generateOverview`:

- **`extractCase`** may benefit from retrieved context instead of the raw 12,000-char truncation.
- **`resolveCase`** may benefit from retrieved context in candidate selection.

These remain **explicit future decisions** and are not assumed in the current implementation plan.

---

## 8. Redis: Cache-Only, Namespaced, Respecting Free-Tier Limits

### 8.1 The Decision

Keep Redis cache keys conceptually separated from RAG storage. Prefer simple namespaces:

```
cache:source:{hash}
cache:extract:{hash}
cache:resolve:{hash}
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

- Transformers.js loads model weights (~25 MB for `all-MiniLM-L6-v2`) on first use.
- On Vercel, each cold start reloads the model into memory, adding seconds of latency to the first request.
- Warm invocations reuse the module-level model instance.

Mitigations (accepted as operational, not a decision):

1. Use the smallest adequate model (`all-MiniLM-L6-v2`).
2. Cache the model instance at module scope (idiomatic for serverless warm reuse).
3. Accept first-request latency as a documented operational cost.

### 9.3 Supabase Free-Tier Operational Notes

- Free-tier projects may pause after 1 week of inactivity; the next request auto-unpauses with added latency.
- Connection limits apply; use the pooler (`DATABASE_URL`, port 6543) for normal traffic and `DIRECT_URL` (port 5432) for migrations — both already configured in `.env.local`.

### 9.4 Configuration

Supabase connection details are read from the existing `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `DATABASE_URL`
- `DIRECT_URL`

The implementation uses the existing `.env` configuration rather than hardcoding credentials.

---

## 10. Open Decisions

These are the genuinely unresolved items that require experimentation:

1. **Exact embedding model** — `all-MiniLM-L6-v2` is the default; another small open-source model may be chosen based on retrieval quality.
2. **Exact chunk size/overlap** — token-based 512–1024 with overlap is the baseline; exact values need empirical validation.
3. **Paragraph/section-aware chunking improvements** — whether/when to move beyond fixed token boundaries for articles, transcripts, and CourtListener opinions.
4. **pgvector index choice/tuning** — HNSW vs. IVFFlat, and index parameters, at CaseFile's expected corpus size.
5. **Exact TTL/retention period** — configurable; chosen based on storage usage, retrieval usefulness, and Supabase limits.
6. **Which pipeline stages consume retrieved context beyond `generateOverview`** — `extractCase` and `resolveCase` are candidates but not assumed.
7. **Retrieval top-k/context limits and ranking strategy** — how many chunks, how much context budget, and how current-source vs. cross-source results are ranked/combined.

---

## 11. Summary of Decisions

| Layer                         | Decision                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Architecture                  | Shared persistent-but-expiring knowledge base; stateless app                                             |
| LLM inference                 | **Groq** (`openai/gpt-oss-120b`)                                                                         |
| Embeddings                    | **Transformers.js** (`@huggingface/transformers`) + local open-source model (`all-MiniLM-L6-v2` default) |
| Persistent RAG knowledge base | **Supabase PostgreSQL + pgvector** — relational schema, HNSW index default                               |
| Retrieval                     | pgvector similarity search in the database (`<=>` + `ORDER BY ... LIMIT k`)                              |
| Chunking                      | Token-based 512–1024 tokens with overlap (modular; paragraph/section-aware later)                        |
| TTL / lifecycle               | Configurable `expires_at`; cascade deletion; lazy + scheduled cleanup                                    |
| Retrieval scope               | Current-source priority + top-k cross-source supplement; external search remains additive                |
| Application cache             | **Upstash Redis** — cache-only, `cache:*` namespaces, respecting 500k commands/month                     |
| Deployment                    | **Vercel** — cold-start accepted as operational consideration                                            |
| Free-to-operate               | No mandatory paid API or infrastructure                                                                  |

These decisions keep CaseFile free to operate, align with its existing stateless architecture, maintain a clear separation between caching and RAG storage, and are proportional to its current scale.
