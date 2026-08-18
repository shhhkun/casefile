"""Tests for query generation / name refinement (ports src/lib/queries.ts)."""

from casefile.search.queries import generate_queries, generate_wiki_query
from casefile.types import ExtractedCase


def _make_extracted(**overrides) -> ExtractedCase:
    defaults = {
        "caseName": None,
        "defendant": "John Doe",
        "victim": "Jane Smith",
        "crimeType": "Murder",
        "jurisdiction": None,
        "state": "Maryland",
        "approximateYear": "1999",
        "keywords": ["homicide", "trial"],
        "confidence": "high",
    }
    defaults.update(overrides)
    return ExtractedCase(**defaults)


def test_generate_queries_tier_order():
    ec = _make_extracted()
    queries = generate_queries(ec)

    assert queries, "should produce at least one query"
    assert '"John Doe"' in queries
    assert '"Jane Smith"' in queries
    assert '"John Doe" AND Maryland' in queries
    assert "Murder AND Maryland" in queries
    assert "homicide AND trial" in queries


def test_generate_queries_with_refinements():
    ec = _make_extracted()
    queries = generate_queries(ec, ["Jon Doe"])

    assert any('"Jon Doe"' in q for q in queries), "refined name should be used"


def test_generate_wiki_query():
    ec = _make_extracted()
    q = generate_wiki_query(ec)
    assert "John Doe" in q
    assert "Jane Smith" in q
    assert "Maryland" in q
    assert "1999" in q
    assert "Murder" in q


def test_generate_queries_no_names():
    ec = _make_extracted(defendant=None, victim=None)
    queries = generate_queries(ec)
    assert "Murder AND Maryland" in queries


def test_apply_refinements_trusts_order_when_no_names():
    ec = _make_extracted(defendant=None, victim=None)
    from casefile.search.queries import apply_refinements

    defendant, victim, remaining = apply_refinements(ec, ["Alice", "Bob", "Carol"])
    assert defendant == "Alice"
    assert victim == "Bob"
    assert remaining == ["Carol"]