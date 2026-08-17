import { Pool } from "pg";

// Lazy pool so module imports don't create a connection before
// environment configuration (e.g., dotenv in scripts) has run.
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "Missing DATABASE_URL environment variable (RAG database connection)",
      );
    }

    pool = new Pool({
      connectionString,
      max: 5,
    });
  }
  return pool;
}

export async function query<T extends Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

export async function queryOne<T extends Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Execute a callback inside a database transaction.
 * Commits on success, rolls back on error.
 *
 * The callback receives transaction-scoped `query` and `queryOne` helpers
 * that share the same connection (so all statements run in one transaction).
 */
export async function withTransaction<T>(
  fn: (q: typeof query, q1: typeof queryOne) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const tq = async <R extends Record<string, unknown>>(
      text: string,
      params?: unknown[],
    ): Promise<R[]> => {
      const result = await client.query(text, params);
      return result.rows as R[];
    };
    const tq1 = async <R extends Record<string, unknown>>(
      text: string,
      params?: unknown[],
    ): Promise<R | null> => {
      const rows = await tq<R>(text, params);
      return rows[0] ?? null;
    };
    const result = await fn(tq as typeof query, tq1 as typeof queryOne);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
