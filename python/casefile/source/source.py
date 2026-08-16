"""Source extraction — ports src/lib/source.ts.

Detects whether a URL is a YouTube video or a regular article, extracts the
transcript / article text, and caches the result in Upstash Redis with the
same key format and TTL as the TypeScript reference implementation.
"""

import logging

from ..cache import CACHE_TTL, cache
from ..errors import SourceError
from ..types import ExtractedContent
from .article import extract_article
from .transcript import extract_transcript

logger = logging.getLogger(__name__)

_YOUTUBE_HOSTS = {
    "www.youtube.com",
    "youtube.com",
    "youtu.be",
    "m.youtube.com",
}


def is_youtube_url(url: str) -> bool:
    """Return True if the URL points to a YouTube video."""
    try:
        from urllib.parse import urlparse

        return urlparse(url).hostname in _YOUTUBE_HOSTS
    except Exception:
        return False


def source_content(url: str) -> ExtractedContent:
    """Extract normalized content from a URL (YouTube transcript or article).

    Caching: uses the same `cache:{url}` key that would be written by
    `src/lib/source.ts` (key = `source:${url}`) with CACHE_TTL.source.
    """
    logger.info("Source extracted: URL: %s", url)

    key = f"source:{url}"
    cached = cache.get(key)
    if cached is not None:
        logger.info("Source cache HIT")
        cached["text"] = cached.get("text", "")
        cached["url"] = cached.get("url", url)
        return ExtractedContent(**cached)

    if is_youtube_url(url):
        logger.info("Source extracted: routing to transcript extractor")
        transcript = extract_transcript(url)
        logger.info("Source extracted: transcript length: %d", len(transcript))

        result = ExtractedContent(
            sourceType="youtube",
            title=None,
            text=transcript,
            url=url,
        )
        cache.set(key, result.model_dump(), CACHE_TTL.source)
        logger.info("Source cache MISS")
        return result

    logger.info("Source extracted: routing to article extractor")
    article = extract_article(url)

    logger.info("Source extracted: article title: %s", article.title)
    logger.info("Source extracted: article text length: %d", len(article.text))

    result = ExtractedContent(
        sourceType="article",
        title=article.title,
        text=article.text,
        url=url,
    )
    cache.set(key, result.model_dump(), CACHE_TTL.source)
    logger.info("Source cache MISS")

    return result