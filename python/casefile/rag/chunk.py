"""RAG chunking — ports src/lib/rag/chunk.ts.

Token-based chunking with overlap. Uses a simple whitespace tokenizer
(this matches the TypeScript baseline; a proper tokenizer can be swapped
in later without changing the chunking API).
"""

import re
from typing import Optional

_CHUNK_SIZE_DEFAULT = 300
_OVERLAP_DEFAULT = 50


def _tokenize(text: str) -> list[str]:
    return re.findall(r"\S+", text)


def chunk_text(
    text: str,
    chunk_size: int = _CHUNK_SIZE_DEFAULT,
    overlap: int = _OVERLAP_DEFAULT,
) -> list[dict[str, Optional[int] | str]]:
    """Split text into overlapping token-based chunks.

    Returns a list of dicts with keys:
      chunkIndex, text, charStart, charEnd, tokenCount
    (matching src/lib/rag/chunk.ts chunkText output).
    """
    if chunk_size <= 0:
        raise ValueError("chunkSize must be greater than 0")
    if overlap < 0 or overlap >= chunk_size:
        raise ValueError("overlap must be >= 0 and < chunkSize")

    tokens = _tokenize(text)
    if not tokens:
        return []

    chunks: list[dict[str, Optional[int] | str]] = []
    step = chunk_size - overlap

    # Reconstruct character offsets from token positions.
    char_offset = 0
    token_char_starts: list[int] = []
    for token in tokens:
        idx = text.index(token, char_offset)
        token_char_starts.append(idx)
        char_offset = idx + len(token)

    start = 0
    while start < len(tokens):
        end = min(start + chunk_size, len(tokens))
        chunk_tokens = tokens[start:end]
        chunk_text_str = " ".join(chunk_tokens)

        char_start = token_char_starts[start]
        last_token_end = token_char_starts[end - 1] + len(tokens[end - 1])
        char_end = last_token_end if end < len(tokens) else len(text)

        chunks.append(
            {
                "chunkIndex": len(chunks),
                "text": chunk_text_str,
                "charStart": char_start,
                "charEnd": char_end,
                "tokenCount": len(chunk_tokens),
            }
        )

        if end >= len(tokens):
            break

        start += step

    return chunks