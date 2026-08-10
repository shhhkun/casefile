-- Enable pgvector extension
create extension if not exists vector;

-- RAG sources: one row per ingested source document
create table if not exists rag_sources (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  source_type text not null check (source_type in ('youtube', 'article')),
  title text,
  source_text text not null,
  extracted_meta jsonb,
  ingested_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- RAG chunks: token-based chunks of a source document
create table if not exists rag_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references rag_sources(id) on delete cascade,
  chunk_index int not null,
  text text not null,
  char_start int,
  char_end int,
  token_count int,
  unique (source_id, chunk_index)
);

-- RAG embeddings: pgvector embeddings for each chunk
create table if not exists rag_embeddings (
  id uuid primary key default gen_random_uuid(),
  chunk_id uuid not null references rag_chunks(id) on delete cascade,
  model text not null,
  dimensions int not null,
  vector vector(384) not null
);

-- Index for similarity search (HNSW, appropriate for CaseFile's expected corpus size)
create index if not exists rag_embeddings_vector_idx
  on rag_embeddings
  using hnsw (vector vector_cosine_ops);

-- Index for filtering by model during retrieval
create index if not exists rag_embeddings_model_idx
  on rag_embeddings (model);

-- Index for expiring sources
create index if not exists rag_sources_expires_at_idx
  on rag_sources (expires_at);