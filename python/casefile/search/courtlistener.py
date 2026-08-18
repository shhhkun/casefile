"""CourtListener search — ports src/lib/search.ts.

Runs tiered queries against the CourtListener v4 search API, combines
results with tier/API-score weighting, deduplicates, and caches per-query
results in Redis.
"""

import logging

import httpx

from ..cache import CACHE_TTL, cache, hash_key
from ..types import ExtractedCase, ScoredCandidate
from .queries import generate_queries

logger = logging.getLogger(__name__)

COURTLISTENER_SEARCH_URL = "https://www.courtlistener.com/api/rest/v4/search/"

TIER_BASE_SCORES: dict[int, float] = {
    0: 1.0,  # quoted refinement names
    1: 0.95,  # unquoted refinement names
    2: 0.88,  # quoted defendant + state
    3: 0.82,  # quoted defendant alone
    4: 0.75,  # quoted victim alone
    5: 0.68,  # quoted both last names
    6: 0.6,  # quoted defendant last + state
    7: 0.45,  # crime type + state
    8: 0.3,  # keywords only
}


def search_courtlistener(
    extracted: ExtractedCase,
    refinement_names: list[str] | None = None,
) -> list[ScoredCandidate]:
    """Search CourtListener with tiered queries; return top-3 unique candidates."""
    refinement_names = refinement_names or []
    queries = generate_queries(extracted, refinement_names)
    candidates: list[ScoredCandidate] = []
    seen_ids: set[str] = set()

    for i, query in enumerate(queries):
        params = {"q": query, "type": "o", "order_by": "score desc"}

        try:
            key = f"courtlistener:{hash_key(query)}"
            cached = cache.get(key)

            if cached is not None:
                results = cached
                logger.info("Search (CourtListener) HIT")
            else:
                response = httpx.get(
                    COURTLISTENER_SEARCH_URL,
                    params=params,
                    headers={"Accept": "application/json"},
                    timeout=20.0,
                )

                if response.status_code >= 400:
                    continue

                data = response.json()
                results = (data.get("results") or [])[:3]

                cache.set(key, results, CACHE_TTL.search)
                logger.info("Search (CourtListener) cache MISS")
                logger.info(
                    'CourtListener tier %d: "%s" -> %d results',
                    i,
                    query,
                    len(results),
                )
        except Exception as err:
            logger.error('CourtListener query failed: "%s"', query, exc_info=err)
            continue

        for r in results:
            result_id = str(r.get("id", ""))
            if result_id in seen_ids:
                continue
            seen_ids.add(result_id)

            api_score = float(r.get("score") or 0.0)
            normalized_api_score = min(api_score / 20, 1.0)
            tier_score = TIER_BASE_SCORES.get(i, 0.3)
            combined_score = tier_score * 0.75 + normalized_api_score * 0.25

            absolute_url = r.get("absolute_url") or ""
            candidates.append(
                ScoredCandidate(
                    title=r.get("caseName") or "",
                    source="courtlistener",
                    score=round(combined_score * 100) / 100,
                    url=f"https://www.courtlistener.com{absolute_url}",
                    snippet=r.get("snippet") or "",
                    metadata={
                        "court": r.get("court") or "",
                        "dateFiled": r.get("dateFiled") or "",
                        "cluster_id": str(r.get("cluster_id") or ""),
                    },
                )
            )

        if len(candidates) >= 3:
            break

    candidates.sort(key=lambda c: c.score, reverse=True)
    return candidates[:3]