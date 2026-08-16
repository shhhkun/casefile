"""RAG data types — ports src/lib/rag/types.ts."""

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict


class RagSource(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    url: str
    sourceType: str  # "youtube" | "article"
    title: Optional[str] = None
    sourceText: str
    extractedMeta: Optional[dict[str, Any]] = None
    ingestedAt: str
    expiresAt: str


class RagChunk(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    sourceId: str
    chunkIndex: int
    text: str
    charStart: Optional[int] = None
    charEnd: Optional[int] = None
    tokenCount: Optional[int] = None


class RagEmbedding(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    chunkId: str
    model: str
    dimensions: int
    vector: list[float]


class RetrievedChunk(BaseModel):
    model_config = ConfigDict(extra="ignore")

    chunkId: str
    sourceId: str
    sourceUrl: str
    sourceType: str  # "youtube" | "article"
    chunkIndex: int
    text: str
    similarity: float


class IngestInput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    url: str
    sourceType: str  # "youtube" | "article"
    title: Optional[str] = None
    sourceText: str
    extractedMeta: Optional[dict[str, Any]] = None
    expiresAt: Optional[str] = None  # ISO timestamp


class IngestResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    sourceId: str
    chunkCount: int
    reused: bool


class FetchedSource(BaseModel):
    model_config = ConfigDict(extra="ignore")

    url: str
    sourceType: str  # "youtube" | "article"
    title: Optional[str] = None
    sourceText: str