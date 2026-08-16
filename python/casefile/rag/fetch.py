"""External full-document fetching — ports src/lib/rag/fetch.ts.

Fetches and normalizes the full underlying documents of top search results:
- CourtListener cluster -> opinion (via Clusters/Opinions APIs)
- Wikipedia full article (via with_html endpoint)
"""

import logging
import os
import re

import httpx

from .types import FetchedSource

logger = logging.getLogger(__name__)

COURTLISTENER_API_BASE = "https://www.courtlistener.com/api/rest/v4"
WIKI_WITH_HTML_URL = "https://en.wikipedia.org/w/rest.php/v1/page"


def html_to_text(html: str) -> str:
    """Convert HTML to readable text, removing noise elements."""
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")

        # Remove obvious noise / metadata blocks.
        for selector in ["script", "style", "nav", "footer", "header", "aside", "form"]:
            for element in soup.select(selector):
                element.decompose()

        body = soup.find("body")
        if body is None:
            return ""
        return " ".join(body.get_text().split())
    except ImportError:
        # Fallback: strip tags with regex (best effort).
        text = re.sub(r"<[^>]+>", " ", html)
        return " ".join(text.split())


def fetch_courtlistener_source(cluster_id: str) -> FetchedSource | None:
    """Resolve a CourtListener cluster to its underlying opinion and normalize text."""
    token = os.environ.get("COURTLISTENER_API_TOKEN")
    if not token:
        logger.error("COURTLISTENER_API_TOKEN is not configured")
        return None

    try:
        # 1. Resolve the cluster to its underlying opinion URL.
        cluster_res = httpx.get(
            f"{COURTLISTENER_API_BASE}/clusters/{cluster_id}/",
            headers={
                "Accept": "application/json",
                "Authorization": f"Token {token}",
            },
            timeout=20.0,
        )

        if cluster_res.status_code >= 400:
            logger.error(
                "CL: cluster fetch failed (%d) for %s",
                cluster_res.status_code,
                cluster_id,
            )
            return None

        cluster = cluster_res.json()
        sub_opinions = cluster.get("sub_opinions") or []
        first_opinion_url = sub_opinions[0] if sub_opinions else None

        if not first_opinion_url:
            logger.error("CL: no sub_opinions found for cluster %s", cluster_id)
            return None

        # 2. Fetch the actual opinion record.
        opinion_res = httpx.get(
            first_opinion_url,
            headers={
                "Accept": "application/json",
                "Authorization": f"Token {token}",
            },
            timeout=20.0,
        )

        if opinion_res.status_code >= 400:
            logger.error(
                "CL: opinion fetch failed (%d) for %s",
                opinion_res.status_code,
                first_opinion_url,
            )
            return None

        opinion = opinion_res.json()

        # CourtListener recommends html_with_citations for opinion text.
        html = opinion.get("html_with_citations") or opinion.get("html") or ""

        if not html:
            logger.error("CL: opinion %s has no usable HTML text", first_opinion_url)
            return None

        source_text = html_to_text(html)

        if not source_text:
            logger.error(
                "CL: opinion %s produced empty normalized text", first_opinion_url
            )
            return None

        absolute_url = opinion.get("absolute_url") or ""
        url = (
            f"https://www.courtlistener.com{absolute_url}"
            if absolute_url
            else first_opinion_url
        )

        return FetchedSource(
            url=url,
            sourceType="article",
            title=(
                cluster.get("case_name")
                or cluster.get("case_name_full")
                or "CourtListener Opinion"
            ),
            sourceText=source_text,
        )
    except Exception as err:
        logger.error("CL: full-text fetch failed for cluster %s: %s", cluster_id, err)
        return None


def fetch_wikipedia_source(title: str, url: str) -> FetchedSource | None:
    """Fetch and normalize a full Wikipedia article."""
    try:
        from urllib.parse import quote

        encoded_title = quote(title, safe="")

        res = httpx.get(
            f"{WIKI_WITH_HTML_URL}/{encoded_title}/with_html",
            headers={"Accept": "text/html"},
            timeout=20.0,
        )

        if res.status_code >= 400:
            logger.error(
                "WP: with_html fetch failed (%d) for %s", res.status_code, title
            )
            return None

        data = res.json()
        html = data.get("html") or ""

        if not html:
            logger.error("WP: empty HTML returned for %s", title)
            return None

        source_text = html_to_text(html)

        if not source_text:
            logger.error("WP: %s produced empty normalized text", title)
            return None

        return FetchedSource(
            url=url,
            sourceType="article",
            title=data.get("title") or title,
            sourceText=source_text,
        )
    except Exception as err:
        logger.error("WP: full-text fetch failed for %s: %s", title, err)
        return None