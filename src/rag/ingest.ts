import { queryOne, withTransaction } from "./db";
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

  // Step 4: persist — source, chunks, and embeddings in a single transaction.
  const expiresAt =
    input.expiresAt ?? new Date(Date.now() + DEFAULT_RAG_TTL_DAYS * 86400000);

  return withTransaction(async (tq, tq1) => {
    const source = await tq1<{ id: string }>(
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

    // Batch-insert all chunks in a single multi-row INSERT.
    const chunkValues = chunks
      .map(
        (_, i) =>
          `($1, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5}, $${i * 5 + 6})`,
      )
      .join(", ");

    const chunkParams: unknown[] = [source.id];
    for (const c of chunks) {
      chunkParams.push(
        c.chunkIndex,
        c.text,
        c.charStart,
        c.charEnd,
        c.tokenCount,
      );
    }

    const chunkRows = await tq<{ id: string; chunk_index: number }>(
      `INSERT INTO rag_chunks (source_id, chunk_index, text, char_start, char_end, token_count)
       VALUES ${chunkValues}
       RETURNING id, chunk_index`,
      chunkParams,
    );

    if (chunkRows.length !== chunks.length) {
      throw new Error(
        `Inserted ${chunkRows.length} chunks, expected ${chunks.length} for source: ${input.url}`,
      );
    }

    // Batch-insert all embeddings in a single multi-row INSERT.
    const embedValues = chunkRows
      .map(
        (_, i) =>
          `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}::vector)`,
      )
      .join(", ");

    const embedParams: unknown[] = [];
    for (let i = 0; i < chunkRows.length; i++) {
      // pgvector expects the vector literal as a string like '[0.1,0.2,...]'.
      const vectorLiteral =
        "[" + embeddings[i].map((v) => v.toString()).join(",") + "]";
      embedParams.push(
        chunkRows[i].id,
        EMBEDDING_MODEL,
        EMBEDDING_DIMENSIONS,
        vectorLiteral,
      );
    }

    await tq(
      `INSERT INTO rag_embeddings (chunk_id, model, dimensions, vector)
       VALUES ${embedValues}`,
      embedParams,
    );

    return {
      sourceId: source.id,
      chunkCount: chunks.length,
      reused: false,
    };
  });
}
