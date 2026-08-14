import { query, queryOne } from "./db";
import { chunkText, ChunkOptions } from "./chunk";
import { embedTexts, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "./embed";
import { IngestInput, IngestResult } from "./types";

// Default retention period for RAG sources. This is configurable and
// should be tuned based on storage usage and retrieval usefulness.
// The existing Redis source cache TTL (3 days) is the reference point.
export const DEFAULT_RAG_TTL_DAYS = 3;

export interface ExistingRagSource {
  sourceId: string;
  chunkCount: number;
}

export async function findReusableSource(
  url: string,
): Promise<ExistingRagSource | null> {
  const existing = await queryOne<{ id: string }>(
    `SELECT id
     FROM rag_sources
     WHERE url = $1
       AND expires_at > now()`,
    [url],
  );

  if (!existing) {
    return null;
  }

  const chunkCount = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM rag_chunks
     WHERE source_id = $1`,
    [existing.id],
  );

  return {
    sourceId: existing.id,
    chunkCount: Number(chunkCount?.count ?? 0),
  };
}

/**
 * Ingest a source document into the RAG knowledge base.
 *
 * Steps:
 *   1. If the source URL is already ingested and unexpired, reuse existing data.
 *   2. Chunk the source text using token-based chunking.
 *   3. Generate local embeddings for each chunk.
 *   4. Persist the source, chunks, and embeddings in Supabase/pgvector.
 *
 * Returns the source id, number of chunks, and whether data was reused.
 */
export async function ingestSource(
  input: IngestInput,
  chunkOptions?: ChunkOptions,
): Promise<IngestResult> {
  // Step 1: dedup — reuse existing unexpired source if present.
  const existing = await findReusableSource(input.url);

  if (existing) {
    return {
      sourceId: existing.sourceId,
      chunkCount: existing.chunkCount,
      reused: true,
    };
  }

  // Step 2: chunk the source text.
  const chunks = chunkText(input.sourceText, chunkOptions);
  if (chunks.length === 0) {
    throw new Error(`No chunks produced for source: ${input.url}`);
  }

  // Step 3: embed all chunks.
  const embeddings = await embedTexts(chunks.map((c) => c.text));

  if (embeddings.length !== chunks.length) {
    throw new Error(
      `Embedding count (${embeddings.length}) does not match chunk count (${chunks.length})`,
    );
  }

  // Step 4: persist — source, chunks, and embeddings in a transaction.
  const expiresAt =
    input.expiresAt ?? new Date(Date.now() + DEFAULT_RAG_TTL_DAYS * 86400000);

  const source = await queryOne<{ id: string }>(
    `INSERT INTO rag_sources (url, source_type, title, source_text, extracted_meta, expires_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id`,
    [
      input.url,
      input.sourceType,
      input.title ?? null,
      input.sourceText,
      input.extractedMeta ? JSON.stringify(input.extractedMeta) : null,
      expiresAt.toISOString(),
    ],
  );

  if (!source) {
    throw new Error(`Failed to insert source: ${input.url}`);
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    const chunkRow = await queryOne<{ id: string }>(
      `INSERT INTO rag_chunks (source_id, chunk_index, text, char_start, char_end, token_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        source.id,
        chunk.chunkIndex,
        chunk.text,
        chunk.charStart,
        chunk.charEnd,
        chunk.tokenCount,
      ],
    );

    if (!chunkRow) {
      throw new Error(
        `Failed to insert chunk ${chunk.chunkIndex} for source: ${input.url}`,
      );
    }

    // pgvector expects the vector literal as a string like '[0.1,0.2,...]'.
    const vectorLiteral =
      "[" + embeddings[i].map((v) => v.toString()).join(",") + "]";

    await query(
      `INSERT INTO rag_embeddings (chunk_id, model, dimensions, vector)
       VALUES ($1, $2, $3, $4::vector)`,
      [chunkRow.id, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, vectorLiteral],
    );
  }

  return {
    sourceId: source.id,
    chunkCount: chunks.length,
    reused: false,
  };
}
