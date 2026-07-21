const redis = require("../config/redis");
const marketService = require("../services/market.service");

const TICK_CHANNEL = "market:ticks";
const SUBSCRIPTION_CONTROL_CHANNEL = "market:subscriptions";

/**
 * Relays live ticks from Redis (published by the worker's KiteTicker
 * connection -- see services/liveTicker.service.js) to browsers via
 * Socket.io rooms, and relays browser subscribe/unsubscribe intent back to
 * the worker over a Redis control channel. This lets multiple API server
 * instances share one Kite ticker connection without needing them to talk
 * to each other directly.
 */
function attach(io) {
    const subscriber = redis.duplicate();
    subscriber.subscribe(TICK_CHANNEL);
    subscriber.on("message", (channel, message) => {
        if (channel !== TICK_CHANNEL) {
            return;
        }
        try {
            const tick = JSON.parse(message);
            io.to(tick.symbol).emit("tick", tick);
        } catch (err) {
            console.error("[realtime] bad tick payload:", err.message);
        }
    });

    io.on("connection", (socket) => {
        socket.on("subscribe", async (rawSymbol) => {
            const symbol = String(rawSymbol || "").toUpperCase();
            if (!symbol) {
                return;
            }

            socket.join(symbol);

            const [company] = await marketService.getCompaniesBySymbols([symbol]);
            if (!company?.instrument_token) {
                return;
            }

            await redis.publish(
                SUBSCRIPTION_CONTROL_CHANNEL,
                JSON.stringify({ action: "subscribe", symbol, instrumentToken: company.instrument_token })
            );

            const cached = await redis.hgetall(`quote:${symbol}`);
            if (cached && Object.keys(cached).length > 0) {
                
                let depth = null;
                try {
                    depth = cached.depth ? JSON.parse(cached.depth) : null;
                } catch {
                    depth = null;
                }
                socket.emit("tick", { ...cached, depth });
            }
        });

        socket.on("unsubscribe", (rawSymbol) => {
            const symbol = String(rawSymbol || "").toUpperCase();
            if (!symbol) {
                return;
            }
            socket.leave(symbol);
            redis.publish(SUBSCRIPTION_CONTROL_CHANNEL, JSON.stringify({ action: "unsubscribe", symbol }));
        });

        // "disconnecting" (not "disconnect") fires before Socket.io clears
        // socket.rooms -- by the time "disconnect" fires, rooms are already
        // empty and there'd be nothing left to unsubscribe.
        socket.on("disconnecting", () => {
            const symbols = [...socket.rooms].filter((room) => room !== socket.id);
            for (const symbol of symbols) {
                redis.publish(SUBSCRIPTION_CONTROL_CHANNEL, JSON.stringify({ action: "unsubscribe", symbol }));
            }
        });
    });

    console.log("[realtime] socket.io market relay attached");
}

module.exports = { attach };
