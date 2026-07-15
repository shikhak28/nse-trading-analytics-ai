const path = require("path");
const fs = require("fs/promises");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const BACKUP_DIR = "/mnt/d/postgres-backups";
const PG_DUMP_BIN = "/usr/lib/postgresql/17/bin/pg_dump";
// Daily backups, keep the last 14 (~2 weeks) -- pruned oldest-first so the
// external drive doesn't fill up unattended.
const RETENTION_COUNT = 14;

function timestampedFilename() {
    const iso = new Date().toISOString().replace(/[:.]/g, "-");
    return `stockdb_${iso}.dump`;
}

/**
 * Dumps the live database to the external SSD (mounted at /mnt/d) as a
 * pg_dump custom-format file -- a single sequential write, not the
 * random-I/O pattern that corrupted the earlier loop-mounted-image attempt
 * at hosting Postgres directly on this drive. This is backup-only; the
 * live database stays where it is.
 */
async function processPostgresBackup() {
    await fs.mkdir(BACKUP_DIR, { recursive: true });

    const filename = timestampedFilename();
    const filePath = path.join(BACKUP_DIR, filename);

    await execFileAsync(PG_DUMP_BIN, [
        "-h", process.env.DB_HOST,
        "-p", process.env.DB_PORT,
        "-U", process.env.DB_USER,
        "-d", process.env.DB_NAME,
        "-Fc",
        "-f", filePath,
    ], {
        env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD },
    });

    const stat = await fs.stat(filePath);
    console.log(`[postgres-backup] wrote ${filename} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

    const pruned = await pruneOldBackups();
    if (pruned.length > 0) {
        console.log(`[postgres-backup] pruned ${pruned.length} old backup(s): ${pruned.join(", ")}`);
    }

    return { file: filename, sizeBytes: stat.size, pruned };
}

async function pruneOldBackups() {
    const entries = await fs.readdir(BACKUP_DIR);
    const backups = entries.filter((name) => name.startsWith("stockdb_") && name.endsWith(".dump")).sort();

    if (backups.length <= RETENTION_COUNT) {
        return [];
    }

    const toDelete = backups.slice(0, backups.length - RETENTION_COUNT);
    for (const name of toDelete) {
        await fs.unlink(path.join(BACKUP_DIR, name));
    }
    return toDelete;
}

module.exports = { processPostgresBackup };
