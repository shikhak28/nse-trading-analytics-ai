const redis = require("../config/redis");
const { processDailyEodSync } = require("../jobs/dailyEodSync.job");
const { historicalSyncQueue } = require("../queues");

// Jobs that failed only because the old token had expired. BullMQ silently
// ignores re-adding a jobId that still exists, even as failed, so these must
// be removed or their symbols would be skipped by the new sync.
const TOKEN_ERROR = /access_token|api_key|TokenException/i;

// The scheduled EOD sync runs at 4:30 PM IST and needs a valid Kite token.
// A login after that time used to mean the day's candles never arrived, so
// the 6 PM predictions had nothing to score. A login now starts the same
// sync itself. It is skipped during market hours, when today's daily candle
// isn't final yet; the 4:30 PM schedule covers those logins.
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const MARKET_WINDOW_START = 9 * 60; // 09:00 IST
const EOD_SYNC_TIME = 16 * 60 + 30; // 16:30 IST, same as daily-eod-sync
const ONCE_PER_DAY_TTL_SECONDS = 6 * 3600;

function istParts(now) {
    const ist = new Date(now.getTime() + IST_OFFSET_MS);
    return {
        day: ist.toISOString().slice(0, 10),
        weekday: ist.getUTCDay(),
        minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
    };
}

function shouldCatchUp(now = new Date()) {
    const { weekday, minutes } = istParts(now);
    const isWeekday = weekday >= 1 && weekday <= 5;
    return !(isWeekday && minutes >= MARKET_WINDOW_START && minutes < EOD_SYNC_TIME);
}

// Fire-and-forget from the login callback. A second login the same IST day
// doesn't enqueue again; sync jobs resume from each symbol's last candle anyway.
async function catchUpAfterLogin(now = new Date()) {
    if (!shouldCatchUp(now)) return;

    const key = `login-eod-sync:${istParts(now).day}`;
    const firstToday = await redis.set(key, "1", "EX", ONCE_PER_DAY_TTL_SECONDS, "NX");
    if (!firstToday) return;

    const removed = await removeTokenFailures();
    const { enqueued } = await processDailyEodSync();
    console.log(`[login-catch-up] cleared ${removed} token-failed job(s), enqueued EOD sync for ${enqueued} companies`);
}

async function removeTokenFailures() {
    const failed = await historicalSyncQueue.getFailed(0, -1);
    const tokenFailures = failed.filter((job) => TOKEN_ERROR.test(job.failedReason || ""));
    await Promise.all(tokenFailures.map((job) => job.remove()));
    return tokenFailures.length;
}

module.exports = { catchUpAfterLogin, shouldCatchUp };
