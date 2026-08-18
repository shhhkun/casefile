"""Source extraction module — YouTube transcripts and article scraping."""

from .article import extract_article
from .source import is_youtube_url, source_content
from .transcript import extract_transcript

__all__ = ["source_content", "is_youtube_url", "extract_transcript", "extract_article"]