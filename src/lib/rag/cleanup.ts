import { query } from "./db";

/**
 * Delete expired sources and their cascading chunks/embeddings.
 *
 * `rag_chunks` and `rag_embeddings` have ON DELETE CASCADE FK constraints,
 * so deleting expired sources automatically removes all associated RAG data.
 *
 * Returns the number of sources deleted.
 */
export async function deleteExpiredSources(): Promise<number> {
  const rows = await query<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM rag_sources
       WHERE expires_at <= now()
       RETURNING id
     )
     SELECT COUNT(*)::text AS count FROM deleted`,
  );

  return Number(rows[0]?.count ?? 0);
}
