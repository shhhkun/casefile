"""External search module — CourtListener and Wikipedia."""

from .courtlistener import search_courtlistener
from .queries import generate_queries, generate_wiki_query
from .wiki import search_wikipedia

__all__ = [
    "search_courtlistener",
    "search_wikipedia",
    "generate_queries",
    "generate_wiki_query",
]