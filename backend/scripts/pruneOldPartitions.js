const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });
const db = require("../config/db");

// One-time retention cleanup: drops historical_prices/features partitions
// older than 1 year back from today, ahead of the AWS migration (less data
// to move, smaller ongoing DB). NOT wired into any scheduler -- this is a
// single manual cleanup per the user's explicit choice, not an ongoing job.
//
// Dropping a partition (DROP TABLE on the child) is a metadata-only
// operation -- instant, unlike a row-by-row DELETE FROM.
//
// SAFETY: defaults to a dry run. Only actually drops anything when passed
// --confirm, and only ever after a full pg_dump backup exists -- this is
// irreversible without one.

const PARENT_TABLES = ["historical_prices", "features"];
const PARTITION_NAME_RE = /^(.+)_(\d{4})_(\d{2})$/;

function monthsAgo(n) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - n);
    return d;
}

async function getPartitions(parentTable) {
    const result = await db.query(
        `SELECT c.relname
         FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
         WHERE i.inhparent = $1::regclass
         ORDER BY c.relname`,
        [parentTable]
    );
    return result.rows.map((r) => r.relname);
}

function classifyPartitions(parentTable, names, cutoff) {
    const toDrop = [];
    const kept = [];

    for (const name of names) {
        const match = name.match(PARTITION_NAME_RE);
        if (!match) {
            // e.g. the "_default" catch-all partition -- never touch it.
            kept.push(name);
            continue;
        }
        const [, , year, month] = match;
        const partitionStart = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
        if (partitionStart < cutoff) {
            toDrop.push(name);
        } else {
            kept.push(name);
        }
    }

    return { toDrop, kept };
}

async function main() {
    const confirm = process.argv.includes("--confirm");
    const cutoff = monthsAgo(12);

    console.log(`Retention cutoff: partitions starting before ${cutoff.toISOString().slice(0, 7)} will be dropped.`);
    console.log(confirm ? "Mode: LIVE -- partitions will actually be dropped.\n" : "Mode: DRY RUN -- nothing will be dropped. Pass --confirm to execute.\n");

    for (const parentTable of PARENT_TABLES) {
        const names = await getPartitions(parentTable);
        const { toDrop, kept } = classifyPartitions(parentTable, names, cutoff);

        console.log(`${parentTable}: ${names.length} partition(s) total, ${toDrop.length} to drop, ${kept.length} kept.`);
        for (const name of toDrop) {
            console.log(`  ${confirm ? "DROPPING" : "would drop"}: ${name}`);
            if (confirm) {
                await db.query(`DROP TABLE IF EXISTS ${name}`);
            }
        }
        console.log("");
    }

    console.log(confirm ? "Done." : "Dry run complete -- rerun with --confirm to actually drop these (only after taking a backup).");
    process.exit(0);
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
