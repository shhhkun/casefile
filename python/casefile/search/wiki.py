"""Wikipedia search — ports src/lib/wiki.ts.

Searches Wikipedia via the action=query API, scores candidates with
rank/keyword/name weighting, and fetches the REST summary for the top result.
"""

import logging

import httpx

from ..cache import CACHE_TTL, cache, hash_key
from ..types import CachedWikiResult, ExtractedCase, ScoredCandidate
from .queries import generate_wiki_query

logger = logging.getLogger(__name__)

WIKI_SEARCH_URL = "https://en.wikipedia.org/w/api.php"
WIKI_SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/"


def _calculate_wiki_score(
    title: str,
    snippet: str,
    rank: int,
    keywords: list[str],
    refinement_names: list[str],
) -> float:
    """Score a Wikipedia search result (mirrors src/lib/wiki.ts)."""
    rank_score = 1.0 if rank == 0 else 0.7 if rank == 1 else 0.4

    title_lower = title.lower()
    snippet_lower = snippet.lower()

    keyword_matched = sum(
        1
        for k in keywords
        if k.lower() in title_lower or k.lower() in snippet_lower
    )
    keyword_score = min(keyword_matched / max(len(keywords), 1), 1.0)

    name_matched = sum(
        1
        for n in refinement_names
        if n.lower() in title_lower or n.lower() in snippet_lower
    )
    name_score = min(name_matched / max(len(refinement_names), 1), 1.0)

    score = rank_score * 0.6 + keyword_score * 0.2 + name_score * 0.2
    return round(score * 100) / 100


def search_wikipedia(
    extracted: ExtractedCase,
    refinement_names: list[str] | None = None,
) -> CachedWikiResult:
    """Search Wikipedia; return candidates + summary/url/thumbnail for the top result."""
    refinement_names = refinement_names or []
    query = generate_wiki_query(extracted, refinement_names)
    logger.info("Wikipedia query: %s", query)

    key = f"wikipedia{hash_key(query)}"
    cached = cache.get(key)
    if cached is not None:
        logger.info("Search (Wikipedia) HIT")
        return CachedWikiResult(**cached)

    empty_result = CachedWikiResult(candidates=[], summary=None, url=None, thumbnail=None)

    try:
        search_params = {
            "action": "query",
            "list": "search",
            "srsearch": query,
            "srlimit": "3",
            "format": "json",
            "origin": "*",
        }

        search_res = httpx.get(
            WIKI_SEARCH_URL,
            params=search_params,
            timeout=20.0,
        )
    except Exception as err:
        logger.error("Wikipedia search failed: %s", err)
        return empty_result

    if search_res.status_code >= 400:
        logger.error("Wikipedia search failed: %d", search_res.status_code)
        return empty_result

    search_data = search_res.json()
    search_results = (search_data.get("query", {}).get("search") or [])[:3]
    logger.info(
        "Wikipedia results: %s",
        [r.get("title") for r in search_results],
    )

    if not search_results:
        return empty_result

    candidates: list[ScoredCandidate] = []
    for i, r in enumerate(search_results):
        title = r.get("title") or ""
        candidates.append(
            ScoredCandidate(
                title=title,
                source="wikipedia",
                score=_calculate_wiki_score(
                    title,
                    r.get("snippet") or "",
                    i,
                    extracted.keywords or [],
                    refinement_names,
                ),
                snippet=r.get("snippet") or "",
                url=f"https://en.wikipedia.org/wiki/{_quote(title)}",
            )
        )

    # Fetch summary for the top result only.
    try:
        top_title = _quote(search_results[0].get("title") or "")
        summary_res = httpx.get(f"{WIKI_SUMMARY_URL}{top_title}", timeout=20.0)
    except Exception as err:
        logger.error("Wikipedia summary fetch failed: %s", err)
        return CachedWikiResult(
            candidates=candidates, summary=None, url=None, thumbnail=None
        )

    if summary_res.status_code >= 400:
        return CachedWikiResult(
            candidates=candidates, summary=None, url=None, thumbnail=None
        )

    summary_data = summary_res.json()

    result = CachedWikiResult(
        candidates=candidates,
        summary=summary_data.get("extract") if summary_data else None,
        url=(
            summary_data.get("content_urls", {}).get("desktop", {}).get("page")
            if summary_data
            else None
        ),
        thumbnail=(
            summary_data.get("thumbnail", {}).get("source")
            if summary_data
            else None
        ),
    )

    cache.set(key, result.model_dump(), CACHE_TTL.search)
    logger.info("Search (Wikipedia) cache MISS")

    return result


def _quote(text: str) -> str:
    """URL-encode a title for use in a path segment."""
    from urllib.parse import quote

    return quote(text, safe="")