"""RAG ingestion — ports src/lib/rag/ingest.ts.

Ingests a source document into the RAG knowledge base (chunk + embed +
persist in Supabase/pgvector), reusing existing unexpired sources when
present. Reads DATABASE_URL from the environment.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from .chunk import chunk_text
from .db import query_one, with_transaction
from .embed import EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embed_texts
from .types import IngestInput, IngestResult

logger = logging.getLogger(__name__)

# Default retention period for RAG sources (mirrors src/lib/rag/ingest.ts).
DEFAULT_RAG_TTL_DAYS = 3

# Note: Uses the exact table names from the existing migration
# (rag_sources, rag_chunks, rag_embeddings) — schema unchanged.


def find_reusable_source(url: str) -> Optional[dict[str, Any]]:
    """Return an existing unexpired source row + chunk count, or None."""
    existing = query_one(
        """SELECT id
           FROM rag_sources
           WHERE url = %s
             AND expires_at > now()""",
        [url],
    )

    if not existing:
        return None

    chunk_count_row = query_one(
        """SELECT COUNT(*)::text AS count
           FROM rag_chunks
           WHERE source_id = %s""",
        [existing["id"]],
    )

    return {
        "sourceId": existing["id"],
        "chunkCount": int(chunk_count_row["count"] or 0) if chunk_count_row else 0,
    }


def vector_literal(values: list[float]) -> str:
    """Format a list of floats as a pgvector literal string."""
    return "[" + ",".join(str(v) for v in values) + "]"


def ingest_source(input: IngestInput) -> IngestResult:
    """Ingest a source document into the RAG knowledge base.

    Steps:
      1. If the source URL is already ingested and unexpired, reuse existing data.
      2. Chunk the source text using token-based chunking.
      3. Generate local embeddings for each chunk.
      4. Persist the source, chunks, and embeddings in Supabase/pgvector.
    """
    # Step 1: dedup — reuse existing unexpired source if present.
    existing = find_reusable_source(input.url)
    if existing:
        return IngestResult(
            sourceId=str(existing["sourceId"]),
            chunkCount=existing["chunkCount"],
            reused=True,
        )

    # Step 2: chunk the source text.
    chunks = chunk_text(input.sourceText)
    if not chunks:
        raise ValueError(f"No chunks produced for source: {input.url}")

    # Step 3: embed all chunks.
    chunk_texts = [c["text"] for c in chunks]  # type: ignore[arg-type]
    embeddings = embed_texts(chunk_texts)

    if len(embeddings) != len(chunks):
        raise ValueError(
            f"Embedding count ({len(embeddings)}) does not match chunk count ({len(chunks)})"
        )

    # Step 4: persist — source, chunks, and embeddings in a single transaction.
    expires_at = input.expiresAt or (
        datetime.now(timezone.utc) + timedelta(days=DEFAULT_RAG_TTL_DAYS)
    ).isoformat()

    def _persist(tq, tq1, te) -> IngestResult:
        source = tq1(
            """INSERT INTO rag_sources (url, source_type, title, source_text, extracted_meta, expires_at)
               VALUES (%s, %s, %s, %s, %s::jsonb, %s)
               RETURNING id""",
            [
                input.url,
                input.sourceType,
                input.title,
                input.sourceText,
                (
                    __import__("json").dumps(input.extractedMeta)
                    if input.extractedMeta
                    else None
                ),
                expires_at,
            ],
        )

        if not source:
            raise RuntimeError(f"Failed to insert source: {input.url}")

        # Insert chunks and embeddings inside the transaction. Single-row
        # INSERT ... RETURNING is reliable with psycopg v3 (multi-row VALUES
        # + RETURNING can fail with "last operation didn't produce records").
        chunk_ids: list[str] = []
        for c in chunks:
            chunk_row = tq1(
                """INSERT INTO rag_chunks (source_id, chunk_index, text, char_start, char_end, token_count)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                [
                    source["id"],
                    c["chunkIndex"],
                    c["text"],
                    c["charStart"],
                    c["charEnd"],
                    c["tokenCount"],
                ],
            )
            if not chunk_row:
                raise RuntimeError(
                    f"Failed to insert chunk {c['chunkIndex']} for source: {input.url}"
                )
            chunk_ids.append(str(chunk_row["id"]))

        for i, chunk_id in enumerate(chunk_ids):
            te(
                """INSERT INTO rag_embeddings (chunk_id, model, dimensions, vector)
                   VALUES (%s, %s, %s, %s::vector)""",
                [
                    chunk_id,
                    EMBEDDING_MODEL,
                    EMBEDDING_DIMENSIONS,
                    vector_literal(embeddings[i]),
                ],
            )

        return IngestResult(
            sourceId=str(source["id"]),
            chunkCount=len(chunks),
            reused=False,
        )

    return with_transaction(_persist)


# In-memory check cache for tests/simulation: not used by the pipeline itself.
def _reset_pool_for_tests() -> None:
    from . import db

    db.close_pool()