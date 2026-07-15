const db = require("../config/db");

async function upsertCompanies(companies) {
  if (!Array.isArray(companies) || companies.length === 0) {
    return;
  }

  const values = [];
  const placeholders = [];

  companies.forEach((company, index) => {
    const offset = index * 6;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`
    );
    values.push(
      company.symbol,
      company.company_name,
      company.exchange,
      company.instrument_token,
      company.segment,
      company.exchange_token
    );
  });

  const query = `
    INSERT INTO companies(symbol, company_name, exchange, instrument_token, segment, exchange_token)
    VALUES ${placeholders.join(", ")}
    ON CONFLICT (exchange, symbol) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      instrument_token = EXCLUDED.instrument_token,
      segment = EXCLUDED.segment,
      exchange_token = EXCLUDED.exchange_token,
      updated_at = NOW()
  `;

  await db.query(query, values);
}

const PARAMS_PER_CANDLE = 9;
// Postgres caps bound parameters at 65535 per query. A single minute-interval
// sync chunk (60 days) can return ~22,500 candles -- well past that limit --
// so rows are inserted in pages instead of one giant multi-row INSERT.
const MAX_CANDLES_PER_INSERT = 1000;

async function saveHistoricalPrices(symbol, interval, candles, instrumentToken = null, exchange = "NSE") {
  if (!Array.isArray(candles) || candles.length === 0) {
    return;
  }

  const PARAMS_PER_CANDLE_WITH_EXCHANGE = PARAMS_PER_CANDLE + 1;

  for (let start = 0; start < candles.length; start += MAX_CANDLES_PER_INSERT) {
    const page = candles.slice(start, start + MAX_CANDLES_PER_INSERT);

    const values = [];
    const placeholders = [];

    page.forEach((candle, index) => {
      const offset = index * PARAMS_PER_CANDLE_WITH_EXCHANGE;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10})`
      );
      values.push(
        exchange.toUpperCase(),
        symbol.toUpperCase(),
        interval,
        new Date(candle.date),
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
        instrumentToken
      );
    });

    const query = `
      INSERT INTO historical_prices(
        exchange,
        symbol,
        interval,
        candle_timestamp,
        open,
        high,
        low,
        close,
        volume,
        instrument_token
      ) VALUES ${placeholders.join(", ")}
      ON CONFLICT (exchange, symbol, interval, candle_timestamp) DO UPDATE SET
        open = EXCLUDED.open,
        high = EXCLUDED.high,
        low = EXCLUDED.low,
        close = EXCLUDED.close,
        volume = EXCLUDED.volume,
        instrument_token = EXCLUDED.instrument_token,
        updated_at = NOW()
    `;

    await db.query(query, values);
  }
}

/**
 * List companies, optionally filtered by a search term (matched against
 * symbol/name via the pg_trgm indexes), joined with each company's most
 * recent stored daily candle via a LATERAL join -- one query, no N+1.
 */
async function getCompanies({ search, exchange, limit = 5000, offset = 0 } = {}) {
  const values = [];
  const conditions = [];

  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(c.company_name ILIKE $${values.length} OR c.symbol ILIKE $${values.length})`);
  }

  if (exchange) {
    values.push(exchange.toUpperCase());
    conditions.push(`c.exchange = $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  values.push(limit, offset);
  const limitIndex = values.length - 1;
  const offsetIndex = values.length;

  const result = await db.query(`
    SELECT c.symbol,
           c.company_name,
           c.exchange,
           c.instrument_token,
           c.segment,
           c.exchange_token,
           c.updated_at,
           hp.open AS last_open,
           hp.high AS last_high,
           hp.low AS last_low,
           hp.close AS last_close,
           hp.volume AS last_volume,
           hp.candle_timestamp AS last_candle_at
    FROM companies c
    LEFT JOIN LATERAL (
      SELECT open, high, low, close, volume, candle_timestamp
      FROM historical_prices
      WHERE historical_prices.exchange = c.exchange
        AND historical_prices.symbol = c.symbol
        AND historical_prices.interval = 'day'
        -- Without a bound here, Postgres can't prune historical_prices'
        -- monthly partitions and fans this subquery out across all of them
        -- per company row (49 partitions x thousands of companies = the
        -- query hanging for hours once BSE tripled the company count). A
        -- company's latest day candle is always recent, so it's safe to
        -- only look at the last 2 months.
        AND candle_timestamp >= (NOW() - INTERVAL '2 months')
      ORDER BY candle_timestamp DESC
      LIMIT 1
    ) hp ON TRUE
    ${where}
    ORDER BY c.symbol ASC
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
  `, values);

  return result.rows;
}

async function getStoredHistoricalPrices(symbol, interval = "day", from, to, exchange = "NSE") {
  const values = [exchange.toUpperCase(), symbol.toUpperCase(), interval];
  let where = `exchange = $1 AND symbol = $2 AND interval = $3`;

  if (from) {
    values.push(new Date(from));
    where += ` AND candle_timestamp >= $${values.length}`;
  }

  if (to) {
    values.push(new Date(to));
    where += ` AND candle_timestamp <= $${values.length}`;
  }

  const result = await db.query(`
    SELECT exchange,
           symbol,
           instrument_token,
           interval,
           candle_timestamp AS date,
           open,
           high,
           low,
           close,
           volume
    FROM historical_prices
    WHERE ${where}
    ORDER BY candle_timestamp ASC
  `, values);

  return result.rows.map((row) => ({
    exchange: row.exchange,
    symbol: row.symbol,
    instrument_token: row.instrument_token,
    interval: row.interval,
    date: row.date.toISOString(),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
  }));
}

async function getStoredHistoricalSummary(limit = 50) {
  const result = await db.query(`
    SELECT exchange,
           symbol,
           interval,
           COUNT(*) AS count,
           MIN(candle_timestamp) AS first_candle,
           MAX(candle_timestamp) AS last_candle
    FROM historical_prices
    -- Same partition-pruning lesson as getCompanies' LATERAL join: with no
    -- time bound, this GROUP BY has to sequentially scan every monthly
    -- partition (all ~58M rows) just to find the 50 most-recently-synced
    -- symbols, which took 27s+ once the backfill filled out most partitions.
    -- "Recently synced" only ever needs to look at recent candles, so
    -- bounding this makes it fast again -- count/first_candle end up scoped
    -- to the window too, which is fine for this "recently synced" display
    -- (it's not used anywhere as an exact lifetime total).
    WHERE candle_timestamp >= (NOW() - INTERVAL '2 months')
    GROUP BY exchange, symbol, interval
    ORDER BY last_candle DESC
    LIMIT $1
  `, [limit]);

  return result.rows.map((row) => ({
    exchange: row.exchange,
    symbol: row.symbol,
    interval: row.interval,
    count: Number(row.count),
    first_candle: row.first_candle?.toISOString(),
    last_candle: row.last_candle?.toISOString(),
  }));
}

/**
 * Most recent stored candle timestamp for a symbol/interval, used to resume
 * an interrupted or incremental sync instead of always re-fetching the full
 * 3-year range.
 */
async function getLastCandleTimestamp(symbol, interval = "day", exchange = "NSE") {
  const result = await db.query(
    `SELECT MAX(candle_timestamp) AS last_candle FROM historical_prices WHERE exchange = $1 AND symbol = $2 AND interval = $3`,
    [exchange.toUpperCase(), symbol.toUpperCase(), interval]
  );

  return result.rows[0]?.last_candle || null;
}

async function getCompaniesBySymbols(symbols, exchange = "NSE") {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return [];
  }

  const result = await db.query(
    `SELECT exchange, symbol, instrument_token FROM companies WHERE exchange = $1 AND symbol = ANY($2)`,
    [exchange.toUpperCase(), symbols.map((symbol) => symbol.toUpperCase())]
  );

  return result.rows;
}

module.exports = {
  upsertCompanies,
  saveHistoricalPrices,
  getCompanies,
  getCompaniesBySymbols,
  getStoredHistoricalPrices,
  getStoredHistoricalSummary,
  getLastCandleTimestamp,
};
