"""RAG database access — ports src/lib/rag/db.ts.

Lazy PostgreSQL connection pool for Supabase/pgvector using `psycopg`
(v3). Reads DATABASE_URL from the environment, same as the TypeScript
implementation.
"""

import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover - only hit before dependencies are installed
    psycopg = None  # type: ignore[assignment]


_pool: Any = None


def _get_connection() -> Any:
    """Return a connection from the lazy pool."""
    global _pool
    if psycopg is None:
        raise RuntimeError(
            "psycopg is not installed. Run: pip install -r requirements.txt"
        )

    connection_string = os.environ.get("DATABASE_URL")
    if not connection_string:
        raise RuntimeError(
            "Missing DATABASE_URL environment variable (RAG database connection)"
        )

    if _pool is None:
        _pool = psycopg_pool_from_env(connection_string)

    return _pool.connection()


def psycopg_pool_from_env(connection_string: str) -> Any:
    """Create a psycopg_pool.ConnectionPool from a DATABASE_URL.

    Strips Supabase-specific query parameters (e.g. `pgbouncer=true`) that
    the Node.js `pg` client accepts but `psycopg` does not understand.
    """
    from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

    from psycopg_pool import ConnectionPool

    parts = urlsplit(connection_string)
    # Keep only query params psycopg understands (e.g. sslmode).
    allowed_params = {"sslmode", "ssl", "connect_timeout"}
    query_params = [
        (k, v) for k, v in parse_qsl(parts.query) if k in allowed_params
    ]
    clean_url = urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(query_params), parts.fragment)
    )

    pool = ConnectionPool(conninfo=clean_url, min_size=1, max_size=5, kwargs={"prepare_threshold": None}, open=False)
    pool.open()
    return pool


def query(text: str, params: Optional[list[Any]] = None) -> list[dict[str, Any]]:
    """Run a query and return rows as dicts."""
    with _get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(text, params or [])
            rows = cur.fetchall()
            return [dict(r) for r in rows]


def query_one(
    text: str, params: Optional[list[Any]] = None
) -> Optional[dict[str, Any]]:
    """Run a query and return the first row (or None)."""
    rows = query(text, params)
    return rows[0] if rows else None


def execute(text: str, params: Optional[list[Any]] = None) -> None:
    """Run an execute statement (INSERT/UPDATE/DELETE)."""
    with _get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(text, params or [])


def close_pool() -> None:
    """Close the pool (call at process exit)."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None