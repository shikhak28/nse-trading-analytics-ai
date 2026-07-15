const redis = require("../config/redis");
const marketService = require("../services/market.service");
const depthSnapshotService = require("../services/depthSnapshot.service");

// NSE trading hours, IST, weekdays. Computed via Intl rather than the
// server's local timezone (this box runs in KST during development --
// Asia/Kolkata must be resolved explicitly regardless of where this
// actually runs).
function getIstParts(date) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        hour12: false,
        weekday: "short",
        hour: "numeric",
        minute: "numeric",
    }).formatToParts(date);

    const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return {
        weekday: lookup.weekday,
        hour: Number(lookup.hour),
        minute: Number(lookup.minute),
    };
}

function isWithinMarketHours(date = new Date()) {
    const { weekday, hour, minute } = getIstParts(date);
    if (weekday === "Sat" || weekday === "Sun") {
        return false;
    }
    const minutesSinceMidnight = hour * 60 + minute;
    return minutesSinceMidnight >= 9 * 60 + 15 && minutesSinceMidnight <= 15 * 60 + 30;
}

function toLevel(depthSide, index) {
    const level = depthSide?.[index];
    return {
        price: level?.price ?? null,
        qty: level?.quantity ?? null,
        orders: level?.orders ?? null,
    };
}

function buildRow(company, snapshotTimestamp, cached, depth) {
    const buy = [0, 1, 2, 3, 4].map((i) => toLevel(depth?.buy, i));
    const sell = [0, 1, 2, 3, 4].map((i) => toLevel(depth?.sell, i));

    return {
        exchange: company.exchange,
        symbol: company.symbol,
        snapshot_timestamp: snapshotTimestamp,
        ltp: cached.ltp ?? null,
        buy1_price: buy[0].price, buy1_qty: buy[0].qty, buy1_orders: buy[0].orders,
        buy2_price: buy[1].price, buy2_qty: buy[1].qty, buy2_orders: buy[1].orders,
        buy3_price: buy[2].price, buy3_qty: buy[2].qty, buy3_orders: buy[2].orders,
        buy4_price: buy[3].price, buy4_qty: buy[3].qty, buy4_orders: buy[3].orders,
        buy5_price: buy[4].price, buy5_qty: buy[4].qty, buy5_orders: buy[4].orders,
        sell1_price: sell[0].price, sell1_qty: sell[0].qty, sell1_orders: sell[0].orders,
        sell2_price: sell[1].price, sell2_qty: sell[1].qty, sell2_orders: sell[1].orders,
        sell3_price: sell[2].price, sell3_qty: sell[2].qty, sell3_orders: sell[2].orders,
        sell4_price: sell[3].price, sell4_qty: sell[3].qty, sell4_orders: sell[3].orders,
        sell5_price: sell[4].price, sell5_qty: sell[4].qty, sell5_orders: sell[4].orders,
        total_buy_quantity: cached.total_buy_quantity ?? null,
        total_sell_quantity: cached.total_sell_quantity ?? null,
    };
}

/**
 * Runs every minute (see depthWorker.js's cron); no-ops itself outside NSE
 * market hours rather than fighting cron's minute-range syntax to encode
 * an exact 9:15-15:30 window. Reads whatever depth is currently cached in
 * Redis (populated continuously by liveTicker.service.js's handleTicks,
 * for every company thanks to subscribeAllTracked() at worker startup) --
 * does not call Kite directly, so this has no interaction with the
 * historical-data rate limit at all.
 */
async function processDepthSnapshot() {
    const now = new Date();
    if (!isWithinMarketHours(now)) {
        return { skipped: true, reason: "outside_market_hours" };
    }

    const companies = await marketService.getCompanies({ limit: 10000 });
    const rows = [];

    for (const company of companies) {
        const cached = await redis.hgetall(`quote:${company.symbol}`);
        if (!cached || !cached.depth) {
            continue;
        }

        let depth;
        try {
            depth = JSON.parse(cached.depth);
        } catch {
            continue;
        }

        rows.push(buildRow(company, now, cached, depth));
    }

    const saved = await depthSnapshotService.saveSnapshots(rows);
    console.log(`[depth-snapshot] saved ${saved} of ${companies.length} tracked companies (rest had no cached depth yet)`);

    return { saved, tracked: companies.length };
}

module.exports = { processDepthSnapshot, isWithinMarketHours };
