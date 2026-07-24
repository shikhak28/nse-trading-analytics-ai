const { KiteTicker } = require("kiteconnect");
const redis = require("../config/redis");
const authService = require("./auth.service");
const kite = require("../config/kite");
const db = require("../config/db");

const TICK_CHANNEL = "market:ticks";
const SUBSCRIPTION_CONTROL_CHANNEL = "market:subscriptions";
const TOKEN_CHECK_INTERVAL_MS = 30000;
// Circuit limits aren't in the WebSocket tick at all (Kite's ticker binary
// protocol / the kiteconnect npm package's parser has no circuit fields --
// verified against node_modules/kiteconnect/dist/lib/ticker.js). They're
// only available from the REST Quote API, so they're fetched separately on
// this interval instead of arriving with every tick. Circuit bands rarely
// change intraday (mainly on a revision after a stock hits circuit), so a
// few-minute lag here is fine.
const CIRCUIT_LIMIT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
// Kite's REST endpoints cap batched instruments per request.
const CIRCUIT_LIMIT_BATCH_SIZE = 500;

let ticker = null;
let tokenInUse = null;

// symbol -> { instrumentToken, exchange, refcount }. Refcounted so multiple
// browser clients watching the same symbol only cause one Kite subscription,
// and it isn't dropped until the last interested client goes away.
const interest = new Map();
const tokenToSymbol = new Map();

function toIsoString(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

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
        upper_circuit_limit: tick.upper_circuit_limit ?? null,
        lower_circuit_limit: tick.lower_circuit_limit ?? null,
        // Kite's own tick timestamp (when the exchange generated it), not
        // when our server received it -- exchange_timestamp is only present
        // in full mode; last_trade_time is the next-best Kite-provided time.
        // Falls back to our own receipt time only if neither is present.
        updated_at: toIsoString(tick.exchange_timestamp) ?? toIsoString(tick.last_trade_time) ?? new Date().toISOString(),
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

function chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches upper/lower circuit limits via Kite's REST Quote API (the only
 * place they're available -- see the CIRCUIT_LIMIT_REFRESH_INTERVAL_MS
 * comment above) and merges just those two fields into each symbol's
 * existing quote:{symbol} Redis hash, without touching the live tick fields
 * already there.
 */
async function refreshCircuitLimits(symbols) {
    if (symbols.length === 0) {
        return;
    }

    const accessToken = await authService.loadAccessToken();
    if (!accessToken) {
        return;
    }
    kite.setAccessToken(accessToken);

    const keyToSymbol = new Map(symbols.map(({ symbol, exchange }) => [`${exchange}:${symbol}`, symbol]));
    const batches = chunk([...keyToSymbol.keys()], CIRCUIT_LIMIT_BATCH_SIZE);

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const quotes = await kite.getQuote(batch);
        const pipeline = redis.pipeline();
        for (const key of batch) {
            const symbol = keyToSymbol.get(key);
            const quote = quotes[key];
            if (!symbol || !quote || quote.upper_circuit_limit == null) {
                continue;
            }
            // Circuit limits are usually quoted to traders as "% band from
            // previous close" (e.g. a 5% or 10% band) rather than the raw
            // rupee figure -- prevClose is that day's ohlc.close, same as
            // what change_percent is already computed against elsewhere.
            const prevClose = quote.ohlc?.close;
            const upperPercent = prevClose > 0 ? ((quote.upper_circuit_limit - prevClose) / prevClose) * 100 : null;
            const lowerPercent = prevClose > 0 ? ((quote.lower_circuit_limit - prevClose) / prevClose) * 100 : null;
            pipeline.hset(`quote:${symbol}`, {
                upper_circuit_limit: quote.upper_circuit_limit,
                lower_circuit_limit: quote.lower_circuit_limit,
                ...(upperPercent !== null && { upper_circuit_percent: upperPercent.toFixed(2) }),
                ...(lowerPercent !== null && { lower_circuit_percent: lowerPercent.toFixed(2) }),
            });
        }
        await pipeline.exec();

        // Stay well clear of Kite's quote-endpoint rate limit when there's
        // more than one batch to go (e.g. subscribeAllTracked's ~2400 symbols).
        if (i < batches.length - 1) {
            await sleep(1000);
        }
    }
}

function refreshAllTrackedCircuitLimits() {
    const symbols = [...interest.entries()].map(([symbol, { exchange }]) => ({ symbol, exchange }));
    refreshCircuitLimits(symbols).catch((err) =>
        console.error("[live-ticker] periodic circuit-limit refresh failed:", err.message)
    );
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

// skipCircuitFetch: true for bulk callers (subscribeAllTracked) -- firing an
// individual REST call per symbol there would mean ~2400 quote requests at
// once and blow through Kite's rate limit; those instead do one batched
// refreshCircuitLimits() call after the whole loop.
function subscribeSymbol(symbol, instrumentToken, exchange = "NSE", { skipCircuitFetch = false } = {}) {
    const existing = interest.get(symbol);
    if (existing) {
        existing.refcount += 1;
        console.log(`[live-ticker] +interest ${symbol} (refcount ${existing.refcount})`);
        return;
    }

    const token = Number(instrumentToken);
    interest.set(symbol, { instrumentToken: token, exchange, refcount: 1 });
    tokenToSymbol.set(token, symbol);
    console.log(`[live-ticker] new interest in ${symbol} (token ${token})`);

    if (ticker?.connected()) {
        ticker.subscribe([token]);
        ticker.setMode(ticker.modeFull, [token]);
    }

    if (!skipCircuitFetch) {
        // Circuit limits for a brand-new symbol shouldn't wait for the next
        // periodic sweep -- fetch immediately so the dashboard isn't blank on
        // first view.
        refreshCircuitLimits([{ symbol, exchange }]).catch((err) =>
            console.error(`[live-ticker] circuit-limit fetch failed for ${symbol}:`, err.message)
        );
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
            const { action, symbol, instrumentToken, exchange } = JSON.parse(message);
            if (action === "subscribe") {
                subscribeSymbol(symbol, instrumentToken, exchange);
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
    setInterval(refreshAllTrackedCircuitLimits, CIRCUIT_LIMIT_REFRESH_INTERVAL_MS);
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
    const result = await db.query(`SELECT exchange, symbol, instrument_token FROM companies`);
    for (const row of result.rows) {
        subscribeSymbol(row.symbol, row.instrument_token, row.exchange, { skipCircuitFetch: true });
    }
    console.log(`[live-ticker] permanently subscribed to ${result.rows.length} tracked companies for depth capture`);

    // One batched circuit-limit fetch for everything just subscribed (chunked
    // internally by refreshCircuitLimits), instead of the periodic sweep's
    // first run being the only source -- that could otherwise be up to
    // CIRCUIT_LIMIT_REFRESH_INTERVAL_MS before circuit limits appear at all
    // after a fresh startup.
    refreshAllTrackedCircuitLimits();
}

module.exports = { start, subscribeSymbol, unsubscribeSymbol, subscribeAllTracked };
