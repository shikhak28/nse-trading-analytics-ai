// Sends the pick images (one per list) on WhatsApp, once per prediction day.
//   node scripts/sendDailyPicks.js              on a trading-day morning: the previous evening's picks, if not sent yet
//   node scripts/sendDailyPicks.js --day 2026-11-27 --force
//   node scripts/sendDailyPicks.js --dry-run    only write the PNG
// Recipients: WHATSAPP_TO in .env, comma-separated numbers with country code.
// Run from cron at 12:00 KST / 8:30 AM IST on weekdays, before the market
// opens (see deploy/training-cron.txt).
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });
const db = require("../config/db");
const { getDailyPicks, pipelineDone } = require("../services/dailyPicks.service");
const { renderPicksPngs } = require("../services/picksImage");

const OUT_DIR = path.resolve(__dirname, "..", "daily-picks");

function arg(name) {
    const i = process.argv.indexOf(name);
    return i === -1 ? undefined : process.argv[i + 1];
}

// Is `date` (YYYY-MM-DD) an NSE trading day? Weekends and shared/nse_holidays.json.
function isTradingDay(date) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) return false;
    const holidays = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "shared", "nse_holidays.json"), "utf8"));
    return !(holidays[date.slice(0, 4)] || []).includes(date);
}

// The newest prediction day before today: the morning run sends the
// predictions made the previous trading evening, for today's session.
async function latestPredictionDay(today) {
    const { rows } = await db.query(`SELECT max(ranking_date)::text AS day FROM daily_rankings WHERE ranking_date < $1::date`, [today]);
    return rows[0].day;
}

async function main() {
    const today = new Date().toISOString().slice(0, 10);
    if (!arg("--day") && !isTradingDay(today)) return; // no session today, nothing to send
    const day = arg("--day") || (await latestPredictionDay(today));
    if (!day) return;
    const dryRun = process.argv.includes("--dry-run");
    const force = process.argv.includes("--force");
    const marker = path.join(OUT_DIR, `${day}.sent`);

    if (!dryRun && !force && fs.existsSync(marker)) return;
    if (!(await pipelineDone(day))) {
        if (dryRun || force) console.log(`No finished predictions for ${day}.`);
        return;
    }

    const picks = await getDailyPicks({ day, n: 5 });
    const images = renderPicksPngs(picks);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const img of images) fs.writeFileSync(path.join(OUT_DIR, `${day}-${img.key}.png`), img.png);
    console.log(`[daily-picks] ${day}: wrote ${images.map((i) => `${i.key}=${i.count}`).join(", ")} in ${OUT_DIR}`);
    if (dryRun) return;

    const numbers = (process.env.WHATSAPP_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!numbers.length) throw new Error("WHATSAPP_TO is not set in .env");
    const { sendImages } = require("../services/whatsapp");
    const messages = images.map((img) => ({ png: img.png, caption: `${img.title} (${day})` }));
    const { sent, failed } = await sendImages(numbers, messages);
    fs.writeFileSync(marker, `${new Date().toISOString()} sent=${sent.join(",")} failed=${failed.map((f) => f.number).join(",")}\n`);
    for (const f of failed) console.error(`[daily-picks] ${day}: could not send to ${f.number}: ${f.error}`);
    console.log(`[daily-picks] ${day}: sent ${messages.length} image(s) to ${sent.length} number(s)`);
}

main()
    .then(() => db.end?.())
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(`[daily-picks] failed: ${err.message}`);
        process.exit(1);
    });
