# CaseFile RAG — Architectural Decisions

This document captures the major architectural decisions that would need to be made to introduce a Retrieval-Augmented Generation (RAG) layer into CaseFile. It is based on the actual state of the repository and distinguishes between what CaseFile currently does, what would change for RAG, and what remains an open question.

---

## 1. Free-to-Operate Constraint

### 1.1 The Constraint

CaseFile must remain entirely free to operate. The architecture must not introduce **mandatory paid API usage** or **mandatory paid infrastructure costs**. Where an approach has usage limits, free-tier restrictions, or would eventually require payment at a realistic CaseFile scale, this must be made explicit.

**Immediate consequence:** The presence of the `openai` package in `package.json` is **not** a reason to favor OpenAI embeddings. OpenAI embeddings require a paid API key. This is flagged as a cost trap, not a convenience. The `openai` package is currently unused in any code path anyway.

### 1.2 Cost Evaluation Framework

Every option below is evaluated against three questions:

1. **Is it free today?** (initial cost)
2. **Does it remain free at realistic CaseFile scale?** (sustained cost)
3. **What is the operational cost?** (latency, maintenance, complexity)

---

## 2. Primary Architectural Decision: Per-Request vs. Shared Knowledge Base

### 2.1 Approach A — Per-Request In-Memory RAG (baseline, not recommended)

**What it does:** Each request embeds its own chunks and searches only within that request's data. Everything is discarded after the response is returned.

**Pros:**

- Zero infrastructure.
- Zero persistence concerns.
- No cross-request data management.
- No privacy/isolation questions.

**Cons:**

- Every request re-extracts, re-chunks, and re-embeds the same source, even when the identical URL is submitted repeatedly.
- No cross-source retrieval — related cases or previously analyzed material contribute nothing.
- Ignores CaseFile's existing Redis TTL caching pattern, which is designed to reuse work across requests.
- Redundant LLM/embedding work on repeat submissions.
- Does not improve LLM context beyond the current head/tail truncation approach.

**Verdict:** Rejected as the primary design. It fails to leverage CaseFile's existing caching philosophy and wastes work.

### 2.2 Approach B — Shared Persistent-but-Expiring Knowledge Base (recommended)

**What it does:** A central store that all requests contribute to and retrieve from, with TTL expiration bounding its size. This is an extension of CaseFile's existing Redis TTL caching philosophy — transforming a per-response cache into a shared retrieval corpus.

**Pros:**

- Reuses previously processed sources: repeat submissions skip fetch, chunking, embedding, and (usually) LLM extraction.
- Cross-source retrieval: analyzing a second video about the same case can retrieve chunks from the first.
- Better LLM context: the model sees retrieved relevant chunks instead of the current head/tail truncation.
- Self-bounded: Redis TTL naturally expires old content.
- Aligns with the existing stateless design — no user accounts, no auth, one shared corpus.
- Zero new infrastructure: extends the existing Upstash Redis.

**Cons:**

- Requires new Redis keys and a `kb:sources` index.
- Cross-request data means content from one user's analysis surfaces in another's (matches current stateless, shared-cache design).
- Requires a decision on retrieval scope (see §7).

**Verdict:** Recommended. It directly aligns with CaseFile's stateless, Redis-cached, free-to-operate design.

---

## 3. Decision: Embedding Provider

### 3.1 Options Evaluated

#### Option 1 — Local embeddings via `@huggingface/transformers` (Transformers.js) — **RECOMMENDED**

- Runs models like `all-MiniLM-L6-v2` (~23M params, 384-dim, ~25 MB) or `bge-small-en-v1.5` (~130M params, 384-dim) entirely in Node.js.
- **Free today:** Yes — zero API cost, runs in-process.
- **Free at realistic scale:** Yes — no quotas, no rate limits, no customer.
- **Operational cost:** Cold-start latency on Vercel serverless. Model weights (~25–90 MB) must load on first invocation after a cold start. Mitigations:
  - Reuse the model across warm invocations (module-level singleton).
  - Accept first-request latency (a few seconds) after a cold start.
  - Use a smaller model (`all-MiniLM-L6-v2`) to minimize weight load.
- **Verdict:** Best fit for the free-to-operate constraint. The cold-start is the main tradeoff.

#### Option 2 — Free-tier embedding APIs (HuggingFace Inference API, Google Gemini free tier)

- **Free today:** Yes, via free tiers.
- **Free at realistic scale:** **No — both have quotas and rate limits.** HuggingFace free tier is rate-limited; Google Gemini free tier has RPM/day quotas. At a realistic CaseFile scale (a growing shared knowledge base with repeat analyses), these would eventually throttle.
- **Operational cost:** No cold-start (external API), but adds a network dependency and quota monitoring.
- **Verdict:** Acceptable as a stopgap, but explicitly flagged as throttling at scale. Not recommended as the long-term choice.

#### Option 3 — OpenAI embeddings (`text-embedding-3-small`)

- **Free today:** **No.** Requires a paid API key. The `openai` package is already a dependency, but this is a cost trap.
- **Free at realistic scale:** No.
- **Operational cost:** Low (simple API), but monetization is the blocker.
- **Verdict:** Rejected — violates the free-to-operate constraint outright.

#### Option 4 — Ollama (local service)

- **Free today:** Yes — fully local.
- **Free at realistic scale:** Yes.
- **Operational cost:** Requires a separately running Ollama service. This is awkward for a Vercel/serverless deployment where you cannot run a background daemon. Only viable on a self-hosted Node server.
- **Verdict:** Documented but not recommended for the Vercel deployment.

#### Option 5 — FastEmbed (Qdrant, ONNX-based)

- **Free today:** Yes — local, ONNX models.
- **Free at realistic scale:** Yes.
- **Operational cost:** Similar to Transformers.js — cold-start weight loading. Different API surface.
- **Verdict:** Viable alternative to Transformers.js; both are acceptable. Transformers.js is more widely used and has better serverless docs.

### 3.2 Recommendation

Use `@huggingface/transformers` with a small model like `all-MiniLM-L6-v2`. Accept and document the cold-start tradeoff. Keep a free-tier API (HuggingFace) as an optional config-driven fallback if cold-start becomes unacceptable — but note its rate limits.

---

## 4. Decision: Vector Storage / Search

### 4.1 Options Evaluated

#### Option 1 — Upstash Redis + brute-force cosine similarity — **RECOMMENDED**

- **What it is:** Store embeddings as arrays in existing Upstash Redis keys (`embeddings:{url}`). Compute cosine similarity in application code during retrieval.
- **Free today:** Yes — Upstash Redis has a free tier, and the existing dependency is already in use.
- **Free at realistic scale:** Depends on corpus size. At CaseFile's realistic scale (a handful of sources per day, each producing ~10–50 chunks → a few thousand total vectors), brute-force cosine similarity over a few thousand 384-dim vectors is trivially fast (milliseconds) in application code. No vector database needed.
- **Operational cost:** Low. No new infrastructure. Compute is O(n·d) per query, where n = active chunks and d = embedding dims; at thousands of vectors this is negligible.
- **Verdict:** Best fit for free-to-operate + serverless + existing-stack alignment.

#### Option 2 — Upstash Vector

- Integrates with the existing Upstash account. Has a free tier.
- **Free at realistic scale:** **Not guaranteed.** Upstash Vector is a paid service beyond the free tier. Free-tier limits (storage/requests) would eventually be hit as the knowledge base grows.
- **Verdict:** Flagged: free-tier only, paid at scale. Not recommended given the constraint.

#### Option 3 — pgvector (Neon / Supabase free tier)

- Postgres hosting with free tiers exists (Neon, Supabase).
- **Free at realistic scale:** Free tiers have limits (storage, compute time, pause behavior). This adds a second database dependency and infrastructure that CaseFile doesn't currently have.
- **Verdict:** Adds complexity and eventual-cost risk. Not recommended.

#### Option 4 — SQLite + `sqlite-vec` / LanceDB / `hnswlib-node` (local embedded)

- Free and local, but Vercel's serverless filesystem is ephemeral and effectively read-only. These only work on a self-hosted Node server.
- **Verdict:** Documented but incompatible with the current Vercel deployment.

#### Option 5 — Per-request in-memory index

- Free, but no cross-request reuse (Approach A). Rejected in §2.1.

### 4.2 Recommendation

Use **brute-force cosine similarity** over embeddings stored in the existing Upstash Redis. This keeps the architecture free, serverless-compatible, and consistent with the current stack. A dedicated vector store (Upstash Vector, pgvector) is only warranted if the corpus grows beyond a few thousand chunks — at which point free-tier constraints should be reevaluated.

---

## 5. Decision: Chunking Strategy

### 5.1 Current State

- `extractCase` truncates source text to the first 12,000 chars.
- `fetchEvidence` truncates `originalText` to 14,000 chars using head (60%) + tail (40%) — the middle is dropped entirely.
- No chunking exists today.

### 5.2 Options Evaluated

#### Option 1 — Token-based chunking (recommended baseline)

- Split text into chunks of ~512–1024 tokens with ~50-token overlap.
- Simple, deterministic, easy to implement.
- Overlap preserves context across chunk boundaries, which matters for speech-to-text transcripts (no sentence structure) and long article text.
- **Verdict:** Recommended as the default.

#### Option 2 — Fixed-character chunking

- Split on character count (e.g., 2000–4000 chars) with overlap.
- Simpler than token-based but may split mid-sentence.
- **Verdict:** Acceptable fallback; token-based is preferred.

#### Option 3 — Semantic chunking (LLM-based)

- Use an LLM to identify semantically coherent sections.
- Higher quality boundaries but adds LLM cost and latency — contradicts the free/simple goals at current scale.
- **Verdict:** Documented; not recommended at current scale.

### 5.3 Recommendation

Start with token-based chunking at ~1024 tokens with ~100-token overlap. Chunk size is tunable and should be validated empirically (see §10 Open Questions).

---

## 6. Decision: TTL / Expiration Policy

### 6.1 Extend Existing TTLs

| New key                   | TTL        | Rationale                                                                       |
| ------------------------- | ---------- | ------------------------------------------------------------------------------- |
| `chunks:{url}`            | 3 days     | Matches `source:{url}` TTL — the chunk corpus expires with its source.          |
| `embeddings:{url}`        | 3 days     | Matches `source:{url}` TTL — embeddings are derived from source content.        |
| `meta:{url}`              | 3 days     | Matches source TTL.                                                             |
| `kb:sources` (sorted set) | per-member | Member score = expiry timestamp; pruning removes expired URLs before retrieval. |

### 6.2 Expiration Semantics

- Redis native TTL handles per-key expiration. No custom GC needed for the per-URL keys.
- The `kb:sources` sorted set requires a pruning step during retrieval: read members, drop those whose score (expiry timestamp) has passed, and remove them from the set.
- The knowledge base is therefore self-bounded: it never grows beyond what was ingested in the last 3 days (assuming steady ingestion rate).

### 6.3 Open Question

- Should TTLs differ between source types (YouTube transcript vs. article)? A 1-hour YouTube video's transcript vs. a Wikipedia article page are different content sizes. Keeping all at 3 days is simpler; adjusting per source type is an optimization.

---

## 7. Decision: Retrieval Scope

### 7.1 Current State

- Retrieval is entirely external: CourtListener + Wikipedia keyword search (Stage 3).
- No internal/document-level retrieval exists.

### 7.2 Options Evaluated

#### Option 1 — Cross-source retrieval (recommended)

- Query embeddings across all active (non-expired) sources in the knowledge base.
- Surfaces related cases, prior context, or corroborating material from previously analyzed content.
- When a user analyzes multiple videos about the same case, the LLM gets context beyond the current source.
- **Verdict:** Recommended — this is the core value of a shared knowledge base.

#### Option 2 — Current-source-only retrieval

- Only retrieve from the current URL's own chunks.
- Simpler, no cross-contamination, but misses the shared-knowledge-base benefit.
- **Verdict:** Rejected as the primary mode (defeats the shared KB purpose), but current-source chunks should always be included with highest priority.

#### Option 3 — Hybrid (recommended for the actual implementation)

- Always include current-source chunks as top-priority context.
- Add top-k cross-source chunks as supplementary context.
- Deduplicate overlapping content (e.g., same chunk appearing from both).
- **Verdict:** This is the recommended implementation.

### 7.3 Interaction with CourtListener / Wikipedia

- The existing external keyword search is **unchanged**.
- Internal retrieval is **additive**: it augments the `Evidence` object passed to `generateOverview` alongside the existing Wikipedia summary and CourtListener snippet.
- The RAG layer provides internal context; CourtListener/Wikipedia provides external/legal context. They complement, not replace, each other.
- Open question: should retrieved internal chunks also influence the `resolveCase` step (candidate selection)? Currently resolution only uses extract + external candidates. Feasible but adds scope.

---

## 8. Impact on LLM Context and Redundant Work

### 8.1 Improving LLM Context

- **Today:** the LLM in `generateOverview` receives a truncated head/tail slice of the source + Wikipedia summary + CourtListener snippet. The middle of a long video/transcript is dropped entirely.
- **With RAG:** the LLM receives the most relevant chunks of the current source (semantically selected) plus top-k chunks from related sources. Information in the middle of a long transcript becomes retrievable.

### 8.2 Reducing Redundant Work

| Stage          | Today (repeat same URL) | With RAG (repeat same URL)     |
| -------------- | ----------------------- | ------------------------------ |
| Fetch source   | cached                  | cached (same)                  |
| LLM extraction | cached                  | cached (same)                  |
| Chunking       | n/a                     | skipped (chunks cache hit)     |
| Embedding      | n/a                     | skipped (embeddings cache hit) |
| LLM resolution | cached                  | cached (same)                  |
| LLM overview   | cached                  | cached (same)                  |

The only real difference for repeat URLs is that `chunks` and `embeddings` are added to the already-cached data. The bigger win is cross-source: related sources share context, improving quality without additional LLM calls.

---

## 9. Vercel / Serverless Deployment Fit

### 9.1 What Works

- **Upstash Redis (REST):** serverless-compatible, already in use.
- **Brute-force cosine similarity:** compute-light at thousands of vectors; runs fine in a serverless function.
- **No local filesystem dependency:** all data lives in Redis.

### 9.2 The Tension: Local Embeddings Cold-Start

- `@huggingface/transformers` loads model weights (~25–90 MB) on first use.
- On Vercel, each cold start reloads the model into memory, adding seconds of latency to the first request.
- Warm invocations reuse the module-level model instance.

**Mitigations (not mutually exclusive):**

1. Use the smallest adequate model (`all-MiniLM-L6-v2`, ~25 MB).
2. Cache the model instance at module scope (already idiomatic for serverless warm reuse).
3. Accept first-request latency as a documented operational cost.
4. Config-driven fallback to a free-tier embedding API (HuggingFace) for deployments where cold-start is unacceptable — with explicit rate-limit caveats.

### 9.3 What to Avoid

- Local file-based vector stores (SQLite, LanceDB, HNSW files) — incompatible with Vercel's read-only/ephemeral filesystem.
- Paid vector services at current scale — violates free-to-operate.
- Server-bound embedding daemons (Ollama) — cannot run persistently on Vercel.

---

## 10. Open Questions

1. **Chunk size and overlap** — What values maximize retrieval quality for speech-to-text transcripts (no sentence structure) vs. long-form articles? Needs empirical evaluation against the existing test suite and/or a small corpus.
2. **Should `extractCase` consume retrieved chunks?** Currently it truncates raw text to 12,000 chars. Using retrievable context could improve extraction of noisy names, but changes the extraction behavior and cache semantics. Requires its own decision.
3. **Should retrieval influence `resolveCase`?** Currently resolution uses only extracted signals + external candidates. Adding internal retrieved context is feasible but expands scope.
4. **Source-type-specific TTLs** — Should YouTube transcripts expire faster than articles? Or keep uniform 3-day TTL for simplicity?
5. **Cold-start acceptance** — Is a few-seconds cold-start on first request acceptable? If not, the free-tier API fallback (with rate-limit caveats) becomes the embedded option.
6. **Corpus growth bounds** — At what point does brute-force cosine similarity become too slow over Redis-stored embeddings? Likely tens of thousands of chunks; crossing this threshold is when a dedicated vector store (paid) or local-lossless alternative must be reconsidered.

---

## 11. Summary of Recommendations

| Decision        | Recommendation                                                              |
| --------------- | --------------------------------------------------------------------------- |
| Architecture    | **Approach B** — shared persistent-but-expiring knowledge base              |
| Embeddings      | **Local Transformers.js** (`all-MiniLM-L6-v2`); free-tier API as a fallback |
| Vector search   | **Brute-force cosine over Upstash Redis** embeddings                        |
| Chunking        | **Token-based**, ~1024 tokens, ~100-token overlap                           |
| TTL             | **3 days** for chunks/embeddings/meta; `kb:sources` sorted-set pruning      |
| Retrieval scope | **Hybrid**: current-source chunks (priority) + top-k cross-source chunks    |
| External search | **Unchanged** — RAG is additive                                             |
| Serverless      | **Compatible** — accept cold-start; avoid local-file vector stores          |

These recommendations keep CaseFile free to operate, align with its existing Redis/stateless architecture, minimize new dependencies, and are proportional to its current scale.
