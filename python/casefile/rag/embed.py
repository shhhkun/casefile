"""RAG embeddings — ports src/lib/rag/embed.ts.

Generates local embeddings using the `sentence-transformers` package
(Python equivalent of Transformers.js). Uses the same embedding model
(`all-MiniLM-L6-v2`, 384-dim) as the TypeScript reference.
"""

import logging

logger = logging.getLogger(__name__)

# Model ID used to *load* the weights from Hugging Face Hub
# (sentence-transformers resolves this repo).
EMBEDDING_MODEL_LOAD_ID = "sentence-transformers/all-MiniLM-L6-v2"

# Canonical model identifier stored in rag_embeddings.model and used in
# retrieval filters. This is the SAME string across TS and Python so
# cross-language ingestion/retrieval works. The model weights are identical
# (all-MiniLM-L6-v2, 384-dim) — only the module-loading ID differs per.
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
EMBEDDING_DIMENSIONS = 384

_model = None


def _get_model():
    """Return the module-level singleton embedding model."""
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer(EMBEDDING_MODEL_LOAD_ID)
    return _model


def warmup() -> None:
    """Eagerly load the embedding model.

    Called at server startup so the first `/analyze` request does not
    pay the model-loading cost. Safe to call multiple times — the
    module-level singleton is reused.
    """
    _get_model()


def embed_text(text: str) -> list[float]:
    """Generate a single normalized embedding vector for the given text."""
    model = _get_model()
    vector = model.encode(text, normalize_embeddings=True)
    return [float(v) for v in vector]


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for multiple texts in a single batched call."""
    if not texts:
        return []
    model = _get_model()
    vectors = model.encode(texts, normalize_embeddings=True)
    return [[float(v) for v in vec] for vec in vectors]