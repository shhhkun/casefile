"""Tests for shared Pydantic types (ports src/lib/types.ts)."""

from casefile.types import (
    CaseAnalysis,
    CaseOverview,
    CachedWikiResult,
    ExtractedCase,
    ScoredCandidate,
)


def test_extracted_case_defaults():
    ec = ExtractedCase()
    assert ec.caseName is None
    assert ec.defendant is None
    assert ec.victim is None
    assert ec.keywords == []
    assert ec.confidence == "low"


def test_extracted_case_roundtrip():
    data = {
        "caseName": "State v. Clark",
        "defendant": "Hadden Irving Clark",
        "victim": "Laura Houghteling",
        "crimeType": "Murder",
        "jurisdiction": "Montgomery County",
        "state": "Maryland",
        "approximateYear": "1999",
        "keywords": ["homicide", "cold case"],
        "confidence": "high",
    }
    ec = ExtractedCase(**data)
    dumped = ec.model_dump()
    assert dumped["caseName"] == "State v. Clark"
    assert dumped["confidence"] == "high"
    assert dumped["keywords"] == ["homicide", "cold case"]


def test_scored_candidate():
    sc = ScoredCandidate(
        title="Test Case",
        source="courtlistener",
        score=0.85,
        url="https://example.com",
        snippet="snippet",
        metadata={"court": "MD", "cluster_id": "123"},
    )
    assert sc.score == 0.85
    assert sc.metadata["cluster_id"] == "123"


def test_case_overview_defaults():
    co = CaseOverview()
    assert co.summary == ""
    assert co.timeline == []
    assert co.people == []
    assert co.legalOutcome == ""
    assert co.faq == []


def test_case_analysis_roundtrip():
    ca = CaseAnalysis(
        extracted=ExtractedCase(),
        originalExtracted=ExtractedCase(),
        candidates=[],
        refinementNames=[],
        sourceType="article",
    )
    dumped = ca.model_dump()
    assert dumped["sourceType"] == "article"
    assert dumped["wikiSummary"] is None
    assert dumped["overview"]["summary"] == ""


def test_cached_wiki_result():
    result = CachedWikiResult(
        candidates=[], summary=None, url=None, thumbnail=None
    )
    assert result.candidates == []
    assert result.summary is None