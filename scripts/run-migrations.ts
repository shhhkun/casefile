import { readFileSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import * as dotenv from "dotenv";

// Load .env.local for DATABASE_URL / DIRECT_URL.
dotenv.config({ path: join(process.cwd(), ".env.local") });

async function main() {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DIRECT_URL or DATABASE_URL in .env.local");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });

  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/0001_rag_init.sql"),
    "utf8",
  );

  try {
    await pool.query("BEGIN");
    await pool.query(sql);
    await pool.query("COMMIT");
    console.log("Migration applied successfully.");
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
