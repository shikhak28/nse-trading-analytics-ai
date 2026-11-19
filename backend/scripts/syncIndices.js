// Manually sync NIFTY 50 / NIFTY BANK / INDIA VIX daily candles into
// index_prices (first run backfills 3 years). Usage: node scripts/syncIndices.js
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const { syncIndices } = require("../services/indexSync.service");

syncIndices()
    .then((summary) => {
        console.log(summary);
        process.exit(0);
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
