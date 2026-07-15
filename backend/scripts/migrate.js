const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "..", "..", ".env"),
  override: true,
});

const fs = require("fs");
const db = require("../config/db");

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "..", "postgres", "migrations");

async function ensureMigrationsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getAppliedMigrations() {
  const result = await db.query(`SELECT name FROM schema_migrations`);
  return new Set(result.rows.map((row) => row.name));
}

async function runMigrations() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();

  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip (already applied): ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations(name) VALUES ($1)`, [file]);
      await client.query("COMMIT");
      console.log(`applied: ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`failed: ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log("All migrations applied.");
}

runMigrations()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err.message);
    process.exit(1);
  });
