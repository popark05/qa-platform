import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to run migrations");
const pool = new Pool({ connectionString });
const migrationDirectory = fileURLToPath(new URL("../../db/migrations/", import.meta.url));

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS qa_schema_migration (
    version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const alreadyApplied = await pool.query("SELECT 1 FROM qa_schema_migration WHERE version = $1", [file]);
    if (alreadyApplied.rowCount) continue;
    const sql = await readFile(join(migrationDirectory, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO qa_schema_migration (version) VALUES ($1)", [file]);
      await client.query("COMMIT");
      process.stdout.write(`Applied ${file}\\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
