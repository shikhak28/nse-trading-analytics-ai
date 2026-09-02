-- Depth data persistence has been removed entirely -- confirmed unused by
-- the ML prediction pipeline (training/ never reads depth_snapshots), and
-- the only other consumer (dailyMovers.service.js's top_bid/top_sell
-- leaderboard) has been updated to drop that computation.
--
-- DROP CASCADE not needed: dropping the partitioned parent table
-- automatically drops all its child partitions (they're dependent objects),
-- same as any other partitioned-table teardown.
--
-- Live depth (the real-time order-book feed via Kite's ticker, cached in
-- Redis and streamed over socket.io -- see liveTicker.service.js) is
-- completely separate from this table and is NOT affected by this migration.
--
-- SAFETY: only run this after taking a full pg_dump backup. This is
-- irreversible without one.

DROP TABLE IF EXISTS depth_snapshots;
