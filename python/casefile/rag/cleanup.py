"""RAG cleanup — ports src/lib/rag/cleanup.ts.

Deletes expired sources and their cascading chunks/embeddings.
`rag_chunks` and `rag_embeddings` have ON DELETE CASCADE FK constraints,
so deleting expired sources automatically removes all associated RAG data.
Returns the number of sources deleted.
"""

import logging

from .db import query

logger = logging.getLogger(__name__)


def delete_expired_sources() -> int:
    """Delete expired sources and cascading chunks/embeddings."""
    rows = query(
        """WITH deleted AS (
           DELETE FROM rag_sources
           WHERE expires_at <= now()
           RETURNING id
         )
         SELECT COUNT(*)::text AS count FROM deleted"""
    )

    return int(rows[0]["count"]) if rows else 0