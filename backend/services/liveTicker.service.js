const { KiteTicker } = require("kiteconnect");
const redis = require("../config/redis");
const authService = require("./auth.service");
const db = require("../config/db");

const TICK_CHANNEL = "market:ticks";
const SUBSCRIPTION_CONTROL_CHANNEL = "market:subscriptions";
const TOKEN_CHECK_INTERVAL_MS = 30000;

let ticker = null;
let tokenInUse = null;

// symbol -> { instrumentToken, refcount }. Refcounted so multiple browser
// clients watching the same symbol only cause one Kite subscription, and it
// isn't dropped until the last interested client goes away.
const interest = new Map();
const tokenToSymbol = new Map();

function buildTickPayload(tick, symbol) {
    return {
        symbol,
        ltp: tick.last_price,
        open: tick.ohlc?.open ?? null,
        high: tick.ohlc?.high ?? null,
        low: tick.ohlc?.low ?? null,
        close: tick.ohlc?.close ?? null,
        volume: tick.volume_traded ?? null,
        change_percent: typeof tick.change === "number" ? tick.change : null,
        // Only present in full mode (see startWithToken -- ticker.modeFull).
        // 5-level order book: { buy: [{price,quantity,orders}, ...5], sell: [...5] }.
        depth: tick.depth ?? null,
        total_buy_quantity: tick.total_buy_quantity ?? null,
        total_sell_quantity: tick.total_sell_quantity ?? null,
        updated_at: new Date().toISOString(),
    };
}

async function handleTicks(ticks) {
    if (!Array.isArray(ticks) || ticks.length === 0) {
        return;
    }

    const pipeline = redis.pipeline();
    for (const tick of ticks) {
        const symbol = tokenToSymbol.get(tick.instrument_token);
        if (!symbol) {
            continue;
        }

        const payload = buildTickPayload(tick, symbol);
        // Redis hashes only hold flat string/number fields -- depth is a
        // nested object, so it's JSON-encoded for the hash and read back out
        // wherever the cached snapshot is served (see marketSocket.js).
        pipeline.hset(`quote:${symbol}`, { ...payload, depth: JSON.stringify(payload.depth) });
        pipeline.publish(TICK_CHANNEL, JSON.stringify(payload));
    }

    await pipeline.exec();
}

function resubscribeAll() {
    if (!ticker?.connected()) {
        return;
    }

    const tokens = [...tokenToSymbol.keys()];
    if (tokens.length === 0) {
        return;
    }

    ticker.subscribe(tokens);
    ticker.setMode(ticker.modeFull, tokens);
}

function startWithToken(accessToken) {
    ticker = new KiteTicker({
        api_key: process.env.KITE_API_KEY,
        access_token: accessToken,
    });

    ticker.autoReconnect(true, 50, 5);

    ticker.on("connect", () => {
        console.log("[live-ticker] connected to Zerodha");
        resubscribeAll();
    });
    ticker.on("ticks", handleTicks);
    ticker.on("disconnect", (err) => console.log("[live-ticker] disconnected:", err?.message));
    ticker.on("error", (err) => console.error("[live-ticker] error:", err?.message));
    ticker.on("reconnect", (count, delay) => console.log(`[live-ticker] reconnecting (attempt ${count}, in ${delay}ms)`));
    ticker.on("noreconnect", () => console.error("[live-ticker] gave up reconnecting; will retry once a fresh token is available"));

    ticker.connect();
}

/**
 * Called periodically: (re)connects when a valid token appears, tears down
 * when it disappears, and reconnects with a fresh token after a re-login.
 * Zerodha tokens have no refresh flow, so "the token changed" is the only
 * signal we get -- polling loadAccessToken() is the simplest reliable way
 * to notice it.
 */
async function ensureRunning() {
    const accessToken = await authService.loadAccessToken();

    if (!accessToken) {
        if (ticker) {
            ticker.disconnect();
            ticker = null;
            tokenInUse = null;
        }
        return;
    }

    if (accessToken !== tokenInUse) {
        if (ticker) {
            ticker.disconnect();
        }
        tokenInUse = accessToken;
        startWithToken(accessToken);
    }
}

function subscribeSymbol(symbol, instrumentToken) {
    const existing = interest.get(symbol);
    if (existing) {
        existing.refcount += 1;
        console.log(`[live-ticker] +interest ${symbol} (refcount ${existing.refcount})`);
        return;
    }

    const token = Number(instrumentToken);
    interest.set(symbol, { instrumentToken: token, refcount: 1 });
    tokenToSymbol.set(token, symbol);
    console.log(`[live-ticker] new interest in ${symbol} (token ${token})`);

    if (ticker?.connected()) {
        ticker.subscribe([token]);
        ticker.setMode(ticker.modeFull, [token]);
    }
}

function unsubscribeSymbol(symbol) {
    const existing = interest.get(symbol);
    if (!existing) {
        return;
    }

    existing.refcount -= 1;
    if (existing.refcount > 0) {
        return;
    }

    interest.delete(symbol);
    tokenToSymbol.delete(existing.instrumentToken);
    console.log(`[live-ticker] no more interest in ${symbol}, dropping subscription`);

    if (ticker?.connected()) {
        ticker.unsubscribe([existing.instrumentToken]);
    }
}

async function listenForSubscriptionRequests() {
    const subscriber = redis.duplicate();
    await subscriber.subscribe(SUBSCRIPTION_CONTROL_CHANNEL);

    subscriber.on("message", (_channel, message) => {
        try {
            const { action, symbol, instrumentToken } = JSON.parse(message);
            if (action === "subscribe") {
                subscribeSymbol(symbol, instrumentToken);
            } else if (action === "unsubscribe") {
                unsubscribeSymbol(symbol);
            }
        } catch (err) {
            console.error("[live-ticker] bad subscription control message:", err.message);
        }
    });

    console.log("[live-ticker] listening for subscription requests");
}

function start() {
    listenForSubscriptionRequests();
    ensureRunning();
    setInterval(ensureRunning, TOKEN_CHECK_INTERVAL_MS);
}

/**
 * Holds a permanent refcounted subscription open for every tracked company,
 * independent of the on-demand dashboard subscriptions above -- needed so
 * ticks (with depth, since the ticker runs in full mode) keep landing in
 * Redis's quote:{symbol} hash continuously for the minute-by-minute depth
 * snapshot job, not just for whichever symbols someone happens to be
 * scrolled to on the Dashboard right now.
 */
async function subscribeAllTracked() {
    const result = await db.query(`SELECT symbol, instrument_token FROM companies`);
    for (const row of result.rows) {
        subscribeSymbol(row.symbol, row.instrument_token);
    }
    console.log(`[live-ticker] permanently subscribed to ${result.rows.length} tracked companies for depth capture`);
}

module.exports = { start, subscribeSymbol, unsubscribeSymbol, subscribeAllTracked };
