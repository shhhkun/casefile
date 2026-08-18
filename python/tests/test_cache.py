"""Tests for caching infrastructure (ports src/lib/cache.ts + hash.ts)."""

from casefile.cache import CACHE_TTL, Cache, hash_key


def test_hash_key_sha256():
    # SHA-256 of "hello" is a well-known value.
    assert hash_key("hello") == (
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    )


def test_hash_key_different_inputs():
    assert hash_key("a") != hash_key("b")


def test_cache_ttl_values():
    assert CACHE_TTL.source == 60 * 60 * 24 * 3  # 3 days
    assert CACHE_TTL.extract == 60 * 60 * 24 * 3  # 3 days
    assert CACHE_TTL.search == 60 * 60 * 24  # 1 day
    assert CACHE_TTL.overview == 60 * 60 * 24  # 1 day


def test_cache_get_without_client_returns_none():
    """Cache.get should return None without a configured Redis client."""
    # Make sure the auto-initialized client doesn't throw during get.
    c = Cache(client=None)
    # Monkeypatch _get_client to raise (no Redis available in test).
    def _no_redis():
        raise RuntimeError("No Redis")

    c._get_client = _no_redis  # type: ignore[assignment]
    assert c.get("missing") is None


def test_cache_get_json_decodes_string():
    """Cache.get should JSON-decode the raw string returned by upstash-redis."""
    c = Cache(client=None)

    class FakeRedis:
        def get(self, key):
            return '{"sourceType": "article", "title": "Test", "text": "Hello", "url": "https://example.com"}'

    c._client = FakeRedis()  # type: ignore[assignment]
    result = c.get("source:https://example.com")
    assert result == {
        "sourceType": "article",
        "title": "Test",
        "text": "Hello",
        "url": "https://example.com",
    }


def test_cache_get_returns_non_string_as_is():
    """Cache.get should return non-string values (e.g. ints) unchanged."""
    c = Cache(client=None)

    class FakeRedis:
        def get(self, key):
            return 42

    c._client = FakeRedis()  # type: ignore[assignment]
    assert c.get("some:int") == 42


def test_cache_get_invalid_json_returns_none():
    """Cache.get should return None for invalid JSON strings."""
    c = Cache(client=None)

    class FakeRedis:
        def get(self, key):
            return "not-json"

    c._client = FakeRedis()  # type: ignore[assignment]
    assert c.get("bad:key") is None
