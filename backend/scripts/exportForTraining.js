const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const fs = require("fs/promises");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

// Same v17 binary used by postgresBackup.job.js -- this machine's default
// `pg_dump` on PATH is v12, which can't dump a v17 server's custom format
// reliably.
const PG_DUMP_BIN = "/usr/lib/postgresql/17/bin/pg_dump";
const EXPORT_DIR = path.resolve(__dirname, "..", "..", "training", "exports");

// Candles only -- no depth_snapshots, that data isn't part of the training
// pipeline yet (see project design doc: depth history too short to be
// useful right now).
const TABLES = ["companies", "historical_prices"];

function timestampedFilename() {
    const iso = new Date().toISOString().replace(/[:.]/g, "-");
    return `candles_${iso}.dump`;
}

async function exportForTraining() {
    await fs.mkdir(EXPORT_DIR, { recursive: true });

    const filename = timestampedFilename();
    const filePath = path.join(EXPORT_DIR, filename);

    const tableArgs = TABLES.flatMap((table) => ["-t", table]);

    await execFileAsync(PG_DUMP_BIN, [
        "-h", process.env.DB_HOST,
        "-p", process.env.DB_PORT,
        "-U", process.env.DB_USER,
        "-d", process.env.DB_NAME,
        ...tableArgs,
        "-Fc",
        "-f", filePath,
    ], {
        env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD },
    });

    const stat = await fs.stat(filePath);
    console.log(`Wrote ${filePath} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`Copy this to the training machine, e.g.:`);
    console.log(`  scp "${filePath}" <training-host>:~/`);
    console.log(`Then on the training machine:`);
    console.log(`  pg_restore -h <host> -p <port> -U <user> -d <db> --data-only --disable-triggers "${filename}"`);
}

exportForTraining()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Export failed:", err.message);
        process.exit(1);
    });
