-- Periodic (minute-level, market-hours-only) order-book depth snapshots.
-- Zerodha has no historical-depth API -- depth is inherently a live-only
-- concept -- so this only ever captures data going forward from whenever
-- the depth-snapshot job starts running, sourced from the live WebSocket
-- ticks already flowing through liveTicker.service.js (full mode).
--
-- Column-based (not JSON) per an earlier sizing discussion: JSON repeats
-- field names ("price"/"quantity"/"orders") 10 times per row, which is
-- meaningfully larger than fixed numeric columns at this volume.
--
-- Partitioned by month, same pattern as historical_prices (see migrations
-- 007/008) -- this table is expected to reach tens of millions of rows too.

CREATE SEQUENCE IF NOT EXISTS depth_snapshots_id_seq;

CREATE TABLE depth_snapshots (
    id BIGINT NOT NULL DEFAULT nextval('depth_snapshots_id_seq'),
    exchange VARCHAR(16) NOT NULL,
    symbol VARCHAR(32) NOT NULL,
    snapshot_timestamp TIMESTAMP NOT NULL,
    ltp NUMERIC,
    buy1_price NUMERIC, buy1_qty INTEGER, buy1_orders INTEGER,
    buy2_price NUMERIC, buy2_qty INTEGER, buy2_orders INTEGER,
    buy3_price NUMERIC, buy3_qty INTEGER, buy3_orders INTEGER,
    buy4_price NUMERIC, buy4_qty INTEGER, buy4_orders INTEGER,
    buy5_price NUMERIC, buy5_qty INTEGER, buy5_orders INTEGER,
    sell1_price NUMERIC, sell1_qty INTEGER, sell1_orders INTEGER,
    sell2_price NUMERIC, sell2_qty INTEGER, sell2_orders INTEGER,
    sell3_price NUMERIC, sell3_qty INTEGER, sell3_orders INTEGER,
    sell4_price NUMERIC, sell4_qty INTEGER, sell4_orders INTEGER,
    sell5_price NUMERIC, sell5_qty INTEGER, sell5_orders INTEGER,
    total_buy_quantity BIGINT,
    total_sell_quantity BIGINT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, snapshot_timestamp),
    UNIQUE (exchange, symbol, snapshot_timestamp),
    CONSTRAINT fk_depth_snapshots_exchange_symbol
        FOREIGN KEY (exchange, symbol) REFERENCES companies(exchange, symbol)
        ON DELETE CASCADE
) PARTITION BY RANGE (snapshot_timestamp);

ALTER SEQUENCE depth_snapshots_id_seq OWNED BY depth_snapshots.id;

-- This month, next month, and one buffer month -- unlike historical_prices
-- there's no multi-year backfill here, so no need to pre-create years of
-- partitions. Extending forward monthly should become a small recurring
-- maintenance task once this is running.
DO $$
DECLARE
    start_month DATE := date_trunc('month', now())::date;
    end_month DATE := date_trunc('month', now() + interval '3 months')::date;
    cursor DATE := start_month;
    partition_name TEXT;
BEGIN
    WHILE cursor < end_month LOOP
        partition_name := 'depth_snapshots_' || to_char(cursor, 'YYYY_MM');
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF depth_snapshots FOR VALUES FROM (%L) TO (%L)',
            partition_name, cursor, cursor + interval '1 month'
        );
        cursor := cursor + interval '1 month';
    END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS depth_snapshots_default
    PARTITION OF depth_snapshots DEFAULT;
