const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const fs = require("fs/promises");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const PG_RESTORE_BIN = "/usr/lib/postgresql/17/bin/pg_restore";

// Restores a .dump file produced on the training machine (via its own
// `pg_dump -t model_versions -t training_runs -t predictions
// -t prediction_verification -Fc`) into this machine's DB, so the local API
// can serve what got predicted+verified remotely. Run
// `npm run migrate` here first so the target tables/partitions already
// exist -- this only restores data, it never creates schema.
//
// Usage: node scripts/importPredictions.js /path/to/predictions_2026-07-28.dump
async function importPredictions() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error("Usage: node scripts/importPredictions.js <dump-file-path>");
        process.exit(1);
    }

    await fs.access(filePath);

    await execFileAsync(PG_RESTORE_BIN, [
        "-h", process.env.DB_HOST,
        "-p", process.env.DB_PORT,
        "-U", process.env.DB_USER,
        "-d", process.env.DB_NAME,
        "--data-only",
        "--disable-triggers",
        "--no-owner",
        filePath,
    ], {
        env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD },
    });

    console.log(`Restored ${filePath} into ${process.env.DB_NAME}.`);
}

importPredictions()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Import failed:", err.message);
        process.exit(1);
    });
