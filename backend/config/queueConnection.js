const IORedis = require("ioredis");

// BullMQ requires maxRetriesPerRequest: null on the connection it's given.
const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
});

module.exports = connection;
