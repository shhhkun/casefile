import { query } from "./db";
import { embedText, EMBEDDING_MODEL } from "./embed";
import { RetrievedChunk } from "./types";

export interface RetrieveOptions {
  /** Number of chunks to retrieve. Defaults to 5. */
  topK?: number;
  /** Only retrieve from this specific source id. */
  sourceId?: string;
  /** Exclude this source id from cross-source retrieval. */
  excludeSourceId?: string;
}

/**
 * Retrieve the top-k semantically similar chunks for a query using
 * pgvector similarity search. The search happens in the database using
 * the HNSW index on the embeddings vector column.
 */
export async function retrieveChunks(
  queryText: string,
  options: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const topK = options.topK ?? 5;

  // Generate the query embedding locally (no external API).
  const queryVector = await embedText(queryText);
  const vectorLiteral =
    "[" + queryVector.map((v) => v.toString()).join(",") + "]";

  const conditions = [`s.expires_at > now()`, `e.model = $2`];
  const params: unknown[] = [vectorLiteral, EMBEDDING_MODEL];

  let paramIndex = 3;
  if (options.sourceId) {
    conditions.push(`s.id = $${paramIndex}`);
    params.push(options.sourceId);
    paramIndex++;
  }
  if (options.excludeSourceId) {
    conditions.push(`s.id <> $${paramIndex}`);
    params.push(options.excludeSourceId);
    paramIndex++;
  }

  const sql = `
    SELECT e.chunk_id::text AS chunk_id,
           c.source_id::text AS source_id,
           s.url AS source_url,
           s.source_type AS source_type,
           c.chunk_index AS chunk_index,
           c.text AS text,
           1 - (e.vector <=> $1::vector) AS similarity
    FROM rag_embeddings e
    JOIN rag_chunks c ON c.id = e.chunk_id
    JOIN rag_sources s ON s.id = c.source_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY e.vector <=> $1::vector
    LIMIT $${paramIndex}`;

  params.push(topK);

  const rows = await query<{
    chunk_id: string;
    source_id: string;
    source_url: string;
    source_type: "youtube" | "article";
    chunk_index: number;
    text: string;
    similarity: number;
  }>(sql, params);

  return rows.map((r) => ({
    chunkId: r.chunk_id,
    sourceId: r.source_id,
    sourceUrl: r.source_url,
    sourceType: r.source_type,
    chunkIndex: r.chunk_index,
    text: r.text,
    similarity: r.similarity,
  }));
}
