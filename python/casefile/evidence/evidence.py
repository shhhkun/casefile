"""Evidence Assembly — ports src/lib/evidence.ts.

Combines extracted case info, original text, Wikipedia summary, CourtListener
snippet, and RAG-retrieved chunks into an Evidence object for the overview
generation stage. Runs active RAG cleanup, reuses unexpired sources, and is
additive + non-fatal if RAG fails.
"""

import json
import logging
from typing import Any, Optional

from ..rag import (
    delete_expired_sources,
    fetch_courtlistener_source,
    fetch_wikipedia_source,
    find_reusable_source,
    ingest_source,
    retrieve_chunks,
)
from ..rag.types import IngestInput, RetrievedChunk
from ..types import ExtractedCase

logger = logging.getLogger(__name__)


class Evidence:
    """The evidence object passed to overview generation."""

    def __init__(self) -> None:
        self.caseInfo: Optional[dict[str, str | None]] = None
        self.originalText: Optional[str] = None
        self.wikipedia: Optional[dict[str, str]] = None
        self.courtlistener: Optional[dict[str, str | None]] = None
        self.ragChunks: list[RetrievedChunk] = []

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a dict for JSON prompt embedding."""
        return {
            "caseInfo": self.caseInfo,
            "originalText": self.originalText,
            "wikipedia": self.wikipedia,
            "courtlistener": self.courtlistener,
            "ragChunks": [c.model_dump() for c in self.ragChunks],
        }


class SearchContext:
    """Preserved #1 search results from the search stage (for RAG ingestion)."""

    def __init__(self) -> None:
        self.courtlistener: Optional[dict[str, str | None]] = None
        self.wikipedia: Optional[dict[str, str | None]] = None


def _limit_text(text: str, max_chars: int) -> str:
    """Limit text to first 60% + last 40% of maxChars (mirrors evidence.ts)."""
    if len(text) <= max_chars:
        return text

    head = int(max_chars * 0.6)
    tail = int(max_chars * 0.4)

    return text[:head] + "\n\n[Middle omitted]\n\n" + text[-tail:]


def _build_rag_query(extracted: ExtractedCase) -> str:
    """Build a retrieval query string from extracted case signals."""
    parts = [
        extracted.caseName,
        extracted.defendant,
        extracted.victim,
        extracted.crimeType,
        extracted.jurisdiction,
        extracted.state,
        extracted.approximateYear,
        *(extracted.keywords or []),
    ]
    return " ".join(p for p in parts if p)


def _ingest_external_source(
    label: str,
    source_url: str,
    fetch_fn,
    extracted_meta: dict[str, Any],
) -> None:
    """Ingest an external source, reusing existing unexpired sources."""
    existing = find_reusable_source(source_url)

    if existing:
        logger.info(
            "RAG: %s source reused - %s (%d chunks)",
            label,
            source_url,
            existing["chunkCount"],
        )
        return

    # Only hit the external API when the source is not already cached.
    source = fetch_fn()

    if not source:
        logger.error("RAG: %s source unavailable for %s; skipping", label, source_url)
        return

    try:
        result = ingest_source(
            IngestInput(
                url=source.url,
                sourceType=source.sourceType,
                title=source.title,
                sourceText=source.sourceText,
                extractedMeta=extracted_meta,
            )
        )
        logger.info(
            "RAG: %s %s - %s; %d chunks",
            label,
            source.url,
            "reused existing source" if result.reused else "ingested new source",
            result.chunkCount,
        )
    except Exception as err:
        logger.error("RAG: %s ingest failed for %s: %s", label, source.url, err)


def fetch_evidence(
    extracted: ExtractedCase,
    original_text: str,
    search_context: Optional[SearchContext] = None,
) -> Evidence:
    """Assemble evidence from source text, search results, and RAG."""
    evidence = Evidence()
    evidence.caseInfo = {
        "caseName": extracted.caseName,
        "defendant": extracted.defendant,
        "victim": extracted.victim,
        "crimeType": extracted.crimeType,
        "jurisdiction": extracted.jurisdiction,
        "state": extracted.state,
        "approximateYear": extracted.approximateYear,
    }
    evidence.originalText = _limit_text(original_text, 14000)

    logger.info("Evidence caseInfo: %s", json.dumps(evidence.caseInfo, indent=2))

    # Wikipedia: use the concise summary as narrative/contextual evidence.
    wiki = search_context.wikipedia if search_context else None
    if wiki and wiki.get("title"):
        evidence.wikipedia = {
            "title": wiki["title"],
            "text": _limit_text(wiki.get("summary") or "", 6000),
            "url": wiki.get("url") or "",
        }

    # CourtListener: preserve the top search result's snippet.
    court = search_context.courtlistener if search_context else None
    if court and court.get("title"):
        evidence.courtlistener = {
            "title": court["title"],
            "text": court.get("snippet") or "",
            "url": court.get("url") or "",
            "court": court.get("court"),
            "dateFiled": court.get("dateFiled"),
        }

    # RAG: ingest the full underlying documents of the top search results and
    # retrieve relevant chunks. Additive and non-fatal.
    try:
        delete_expired_sources()

        extracted_meta = {
            "caseName": extracted.caseName,
            "defendant": extracted.defendant,
            "victim": extracted.victim,
            "crimeType": extracted.crimeType,
            "jurisdiction": extracted.jurisdiction,
            "state": extracted.state,
            "approximateYear": extracted.approximateYear,
            "keywords": extracted.keywords,
            "confidence": extracted.confidence,
        }

        # Top CourtListener result (opinion).
        if court and court.get("clusterId"):
            cluster_id = court["clusterId"]
            _ingest_external_source(
                "CourtListener",
                court.get("url") or "",
                lambda ci=cluster_id: fetch_courtlistener_source(ci),
                extracted_meta,
            )

        # Top Wikipedia result (full article).
        if wiki and wiki.get("title"):
            _ingest_external_source(
                "Wikipedia",
                wiki.get("url") or "",
                lambda t=wiki["title"], u=wiki.get("url") or "": fetch_wikipedia_source(t, u),
                extracted_meta,
            )

        # Retrieve relevant chunks.
        query_text = _build_rag_query(extracted)

        if query_text:
            chunks = retrieve_chunks(query_text, top_k=3)
            evidence.ragChunks = chunks

            logger.info("RAG: retrieved %d chunks", len(chunks))
            for index, chunk in enumerate(chunks, start=1):
                logger.info("===== RAG CHUNK %d =====", index)
                logger.info(chunk.model_dump())
                logger.info("===== END RAG CHUNK %d =====", index)
    except Exception as err:
        logger.error("RAG retrieval failed: %s", err)

    return evidence