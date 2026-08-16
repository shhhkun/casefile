"""RAG module — ports src/lib/rag/index.ts."""

from .cleanup import delete_expired_sources
from .chunk import chunk_text
from .embed import EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embed_text, embed_texts
from .fetch import fetch_courtlistener_source, fetch_wikipedia_source
from .ingest import DEFAULT_RAG_TTL_DAYS, find_reusable_source, ingest_source
from .retrieve import retrieve_chunks
from .types import (
    FetchedSource,
    IngestInput,
    IngestResult,
    RagChunk,
    RagEmbedding,
    RagSource,
    RetrievedChunk,
)

__all__ = [
    "delete_expired_sources",
    "chunk_text",
    "embed_text",
    "embed_texts",
    "EMBEDDING_MODEL",
    "EMBEDDING_DIMENSIONS",
    "fetch_courtlistener_source",
    "fetch_wikipedia_source",
    "DEFAULT_RAG_TTL_DAYS",
    "find_reusable_source",
    "ingest_source",
    "retrieve_chunks",
    "RagSource",
    "RagChunk",
    "RagEmbedding",
    "RetrievedChunk",
    "IngestInput",
    "IngestResult",
    "FetchedSource",
]