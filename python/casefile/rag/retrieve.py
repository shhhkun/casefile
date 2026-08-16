"""RAG retrieval — ports src/lib/rag/retrieve.ts.

Retrieves the top-k semantically similar chunks for a query using pgvector
similarity search. The search happens in the database using the HNSW index
on the embeddings vector column.
"""

import logging
from typing import Optional

from .db import query
from .embed import EMBEDDING_MODEL, embed_text
from .ingest import vector_literal
from .types import RetrievedChunk

logger = logging.getLogger(__name__)


def retrieve_chunks(
    query_text: str,
    top_k: int = 5,
    source_id: Optional[str] = None,
    exclude_source_id: Optional[str] = None,
) -> list[RetrievedChunk]:
    """Retrieve the top-k semantically similar chunks for a query."""
    # Generate the query embedding locally (no external API).
    query_vector = embed_text(query_text)
    vector_lit = vector_literal(query_vector)

    # SQL uses %s placeholders (psycopg v3 style). The vector appears twice
    # (once in SELECT for similarity, once in ORDER BY).
    conditions = ["s.expires_at > now()", "e.model = %s"]
    params: list[object] = [EMBEDDING_MODEL]

    if source_id:
        conditions.append("s.id = %s")
        params.append(source_id)
    if exclude_source_id:
        conditions.append("s.id <> %s")
        params.append(exclude_source_id)

    sql = f"""
        SELECT e.chunk_id::text AS chunk_id,
               c.source_id::text AS source_id,
               s.url AS source_url,
               s.source_type AS source_type,
               c.chunk_index AS chunk_index,
               c.text AS text,
               1 - (e.vector <=> %s::vector) AS similarity
        FROM rag_embeddings e
        JOIN rag_chunks c ON c.id = e.chunk_id
        JOIN rag_sources s ON s.id = c.source_id
        WHERE {' AND '.join(conditions)}
        ORDER BY e.vector <=> %s::vector
        LIMIT %s"""

    # Placeholder order in SQL:
    #   %s (SELECT vector) -> vector_lit
    #   %s (model)         -> EMBEDDING_MODEL  (already in params[0])
    #   %s (source_id)     -> (if present)
    #   %s (exclude)       -> (if present)
    #   %s (ORDER vector)  -> vector_lit
    #   %s (LIMIT)         -> top_k
    params = [vector_lit] + params + [vector_lit, top_k]

    rows = query(sql, params)  # type: ignore[arg-type]

    return [
        RetrievedChunk(
            chunkId=r["chunk_id"],
            sourceId=r["source_id"],
            sourceUrl=r["source_url"],
            sourceType=r["source_type"],
            chunkIndex=r["chunk_index"],
            text=r["text"],
            similarity=float(r["similarity"]),
        )
        for r in rows
    ]