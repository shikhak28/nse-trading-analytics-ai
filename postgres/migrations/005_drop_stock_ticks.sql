-- stock_ticks was a leftover from the old Finnhub demo prototype
-- (backend/marketCollector.js, removed). Live quotes now live in Redis
-- (quote:{symbol} hashes, see backend/services/liveTicker.service.js) --
-- persisting every tick to Postgres would be wasted IO for ephemeral data.

DROP TABLE IF EXISTS stock_ticks;
