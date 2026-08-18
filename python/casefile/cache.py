"""Caching infrastructure — ports src/lib/cache.ts, src/lib/redis.ts, src/lib/hash.ts.

Preserves the exact cache-key semantics and TTL values from the TypeScript
implementation so the Python pipeline can share (or at least stay compatible
with) the existing Upstash Redis cache.
"""

import hashlib
import json
import os
from typing import Any, Optional

try:
    from upstash_redis import Redis
except ImportError:  # pragma: no cover - only hit before dependencies are installed

    class Redis:  # type: ignore[no-redef]
        def __init__(self, *args: Any, **kwargs: Any):
            raise RuntimeError(
                "upstash-redis is not installed. Run: pip install -r requirements.txt"
            )


# TTL values in seconds (mirrors src/lib/cache.ts).
class CACHE_TTL:
    source: int = 60 * 60 * 24 * 3  # 3 days
    extract: int = 60 * 60 * 24 * 3  # 3 days
    search: int = 60 * 60 * 24  # 1 day
    overview: int = 60 * 60 * 24  # 1 day


def hash_key(input: str) -> str:
    """SHA-256 hex digest — mirrors src/lib/hash.ts."""
    return hashlib.sha256(input.encode("utf-8")).hexdigest()


def get_redis() -> Redis:
    """Return a configured Upstash Redis client (reads env vars)."""
    url = os.environ.get("UPSTASH_REDIS_REST_URL")
    token = os.environ.get("UPSTASH_REDIS_REST_TOKEN")

    if not url or not token:
        raise RuntimeError(
            "Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN environment variables"
        )

    return Redis(url=url, token=token)


class Cache:
    """Thin wrapper around Upstash Redis with get/set helpers.

    Mimics the `redis.get<T>()` / `redis.set(key, value, {ex: ttl})` API from
    `@upstash/redis` used throughout the TypeScript codebase.
    """

    def __init__(self, client: Optional[Redis] = None):
        self._client = client

    def _get_client(self) -> Redis:
        if self._client is None:
            self._client = get_redis()
        return self._client

    def get(self, key: str) -> Optional[Any]:
        """Return the JSON-decoded value at key, or None if missing/invalid."""
        try:
            value = self._get_client().get(key)
        except Exception:
            return None
        if value is None:
            return None
        try:
            # upstash-redis returns the raw string for GET; JSON-decode it to
            # match the TypeScript @upstash/redis client's auto-decoding behavior.
            if isinstance(value, str):
                return json.loads(value)
            return value
        except Exception:
            return None

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        """Set key to JSON-encoded value with optional TTL (seconds)."""
        try:
            if ttl is not None:
                self._get_client().set(key, value, ex=ttl)
            else:
                self._get_client().set(key, value)
        except Exception:
            # Caching is non-fatal: failures never break the pipeline.
            pass


# Module-level default cache instance.
cache = Cache()