const IORedis = require("ioredis");

const client = new IORedis(process.env.REDIS_URL || "redis://localhost:6379");

client.on("error", (err) => {
    console.error("Redis error:", err.message);
});

module.exports = client;
