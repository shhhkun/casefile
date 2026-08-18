"""Pipeline orchestration — ports src/app/api/analyze/route.ts.

Runs the full analysis pipeline: source extraction -> metadata extraction ->
parallel search -> evidence assembly -> overview generation. Returns a
CaseAnalysis object matching the existing Next.js API contract.
"""

import logging
import time
from typing import Optional

from ..evidence.evidence import SearchContext, fetch_evidence
from ..extract.extract import extract_case
from ..overview.overview import generate_overview
from ..search.courtlistener import search_courtlistener
from ..search.wiki import search_wikipedia
from ..source.source import source_content
from ..types import CaseAnalysis

logger = logging.getLogger(__name__)


def analyze(
    url: str,
    refinement_names: Optional[list[str]] = None,
    model: str = "",
) -> CaseAnalysis:
    """Run the full analysis pipeline for a URL.

    Mirrors the flow in src/app/api/analyze/route.ts:
      1. Source extraction
      2. Metadata extraction (LLM)
      3. Parallel external search (CourtListener + Wikipedia)
      4. Evidence assembly (includes RAG ingestion + retrieval)
      5. Overview generation (LLM)
    """
    refinement_names = refinement_names or []
    model = model or ""

    analyze_start = time.perf_counter()

    # Step 1: source content from URL (YouTube or article).
    source_start = time.perf_counter()
    logger.info("Analyze: extracting content from URL")
    content = source_content(url)
    source_time = time.perf_counter() - source_start

    logger.info("Analyze: source type: %s", content.sourceType)
    logger.info("Analyze: content length: %d", len(content.text))

    # Step 2: extract case signals.
    extract_start = time.perf_counter()
    extracted = extract_case(content.text, model, url)
    extract_time = time.perf_counter() - extract_start

    logger.info("Analyze: extracted: %s", extracted.model_dump_json(indent=2))

    # Step 3: parallel search.
    search_start = time.perf_counter()
    logger.info("Analyze: running parallel search")
    court_results = search_courtlistener(extracted, refinement_names)
    wiki_result = search_wikipedia(extracted, refinement_names)
    search_time = time.perf_counter() - search_start

    logger.info("Analyze: court candidates: %d", len(court_results))
    logger.info("Analyze: wiki candidates: %d", len(wiki_result.candidates))

    # Aggregate and sort candidates for the UI and RAG ingestion.
    all_candidates = list(court_results) + list(wiki_result.candidates)
    all_candidates.sort(key=lambda c: c.score, reverse=True)

    logger.info("Analyze: total candidates: %d", len(all_candidates))

    # Preserve the #1 CourtListener and #1 Wikipedia search results as
    # pipeline metadata for Evidence Assembly (RAG).
    search_context = SearchContext()

    if court_results:
        top_court = court_results[0]
        search_context.courtlistener = {
            "title": top_court.title,
            "url": top_court.url or "",
            "snippet": top_court.snippet or "",
            "court": (top_court.metadata or {}).get("court"),
            "dateFiled": (top_court.metadata or {}).get("dateFiled"),
            "clusterId": (top_court.metadata or {}).get("cluster_id"),
        }

    if wiki_result.candidates and wiki_result.summary:
        top_wiki = wiki_result.candidates[0]
        search_context.wikipedia = {
            "title": top_wiki.title,
            "url": wiki_result.url or top_wiki.url or "",
            "summary": wiki_result.summary,
        }

    # Step 5: fetch evidence (includes RAG ingestion + retrieval).
    evidence = fetch_evidence(extracted, content.text, search_context)

    # Step 6: generate case overview.
    overview_start = time.perf_counter()
    overview = generate_overview(evidence, model, url)
    overview_time = time.perf_counter() - overview_start

    analysis = CaseAnalysis(
        extracted=extracted,
        originalExtracted=extracted.model_copy(deep=True),
        candidates=all_candidates,
        wikiSummary=wiki_result.summary,
        wikiUrl=wiki_result.url,
        wikiThumbnail=wiki_result.thumbnail,
        refinementNames=refinement_names,
        sourceType=content.sourceType,
        sourceTitle=content.title,
        overview=overview,
    )

    analyze_end = time.perf_counter()

    logger.info("Source completed in %.0f ms", source_time * 1000)
    logger.info("Extract completed in %.0f ms", extract_time * 1000)
    logger.info("Search completed in %.0f ms", search_time * 1000)
    logger.info("Overview completed in %.0f ms", overview_time * 1000)
    logger.info(
        "Analyze (API) completed in %.0f ms",
        (analyze_end - analyze_start) * 1000,
    )

    return analysis