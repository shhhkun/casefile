"""Article extraction — ports src/lib/article.ts.

Fetches an article URL, removes noise elements, and extracts the page title
and body text using BeautifulSoup (Python equivalent of Cheerio).
"""

import logging

from ..errors import SourceError

logger = logging.getLogger(__name__)

# Match the browser User-Agent / Accept headers from the TypeScript implementation.
# Note: Wikipedia and other sites block requests with minimal User-Agent strings
# and also block Python's httpx TLS fingerprint. We use curl_cffi which
# impersonates a real browser's TLS fingerprint (Chrome) to avoid 403s.
try:
    from curl_cffi import requests as curl_requests
except ImportError:  # pragma: no cover - only hit before dependencies are installed
    curl_requests = None  # type: ignore[assignment]

_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_ACCEPT = (
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
)
_ACCEPT_LANGUAGE = "en-US,en;q=0.9"
_ACCEPT_ENCODING = "gzip, deflate, br"
_CONNECTION = "keep-alive"

# HTML elements removed as noise (mirrors src/lib/article.ts).
_NOISE_SELECTORS = ["script", "style", "nav", "footer", "header"]


def extract_article(url: str) -> "ArticleResult":
    """Fetch and extract title + text from an article URL."""
    logger.info("Article: fetching URL: %s", url)

    if curl_requests is None:
        raise SourceError(
            "curl_cffi is not installed. Run: pip install curl_cffi",
            500,
        )

    try:
        response = curl_requests.get(
            url,
            headers={
                "User-Agent": _USER_AGENT,
                "Accept": _ACCEPT,
                "Accept-Language": _ACCEPT_LANGUAGE,
                "Accept-Encoding": _ACCEPT_ENCODING,
                "Connection": _CONNECTION,
            },
            impersonate="chrome",
            allow_redirects=True,
            timeout=30.0,
        )
    except Exception as err:
        logger.exception("Article fetch failed: %s", err)
        raise SourceError("Invalid URL.", 400)

    if response.status_code >= 400:
        raise SourceError(
            f"Failed to fetch URL: {response.status_code} {response.reason_phrase}",
            400,
        )

    html = response.text
    logger.info("Article: HTML length: %d", len(html))

    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")

        # Remove obvious noise.
        for selector in _NOISE_SELECTORS:
            for element in soup.select(selector):
                element.decompose()

        title_tag = soup.find("title")
        title = title_tag.get_text() if title_tag else None

        body = soup.find("body")
        text = ""
        if body is not None:
            text = " ".join(body.get_text().split())

        logger.info("Article: extracted title: %s", title)
        logger.info("Article: text length: %d", len(text))

        return ArticleResult(title=title, text=text)
    except ImportError:
        raise SourceError(
            "beautifulsoup4 is not installed. Run: pip install -r requirements.txt",
            500,
        )


class ArticleResult:
    """Simple result container for article extraction."""

    def __init__(self, title: str | None, text: str):
        self.title = title
        self.text = text