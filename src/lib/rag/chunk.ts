import { RagChunk } from "./types";

export interface ChunkOptions {
  /** Target chunk size in tokens. Defaults to 300. */
  chunkSize?: number;
  /** Overlap between chunks in tokens. Defaults to 50. */
  overlap?: number;
}

// Simple whitespace-based tokenizer. This is a baseline approximation;
// a proper tokenizer can be swapped in without changing the chunking API.
function tokenize(text: string): string[] {
  return text.match(/\S+/g) ?? [];
}

/**
 * Token-based chunking with overlap.
 *
 * Splits text into chunks of approximately `chunkSize` tokens with
 * `overlap` tokens of context carried between adjacent chunks. This is
 * the baseline strategy; paragraph/section-aware chunking can replace
 * this function later without changing the rest of the RAG pipeline.
 */
export function chunkText(
  text: string,
  options: ChunkOptions = {},
): Omit<RagChunk, "id" | "sourceId">[] {
  const chunkSize = options.chunkSize ?? 300;
  const overlap = options.overlap ?? 50;

  if (chunkSize <= 0) {
    throw new Error("chunkSize must be greater than 0");
  }
  if (overlap < 0 || overlap >= chunkSize) {
    throw new Error("overlap must be >= 0 and < chunkSize");
  }

  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return [];
  }

  const chunks: Omit<RagChunk, "id" | "sourceId">[] = [];
  const step = chunkSize - overlap;

  // Reconstruct character offsets from token positions.
  let charOffset = 0;
  const tokenCharStarts: number[] = [];
  for (const token of tokens) {
    const idx = text.indexOf(token, charOffset);
    tokenCharStarts.push(idx);
    charOffset = idx + token.length;
  }

  for (let start = 0; start < tokens.length; start += step) {
    const end = Math.min(start + chunkSize, tokens.length);
    const chunkTokens = tokens.slice(start, end);
    const chunkText = chunkTokens.join(" ");

    const charStart = tokenCharStarts[start];
    const lastTokenEnd = tokenCharStarts[end - 1] + tokens[end - 1].length;
    const charEnd = end < tokens.length ? lastTokenEnd : text.length;

    chunks.push({
      chunkIndex: chunks.length,
      text: chunkText,
      charStart,
      charEnd,
      tokenCount: chunkTokens.length,
    });

    if (end >= tokens.length) break;
  }

  return chunks;
}
