CREATE TABLE IF NOT EXISTS stock_ticks (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20),
    price NUMERIC,
    volume NUMERIC,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS companies (
    symbol VARCHAR(32) PRIMARY KEY,
    company_name TEXT,
    exchange VARCHAR(32),
    instrument_token VARCHAR(64),
    segment VARCHAR(64),
    exchange_token VARCHAR(64),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS historical_prices (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(32) NOT NULL,
    instrument_token VARCHAR(64) NOT NULL,
    interval VARCHAR(32) NOT NULL,
    candle_timestamp TIMESTAMP NOT NULL,
    open NUMERIC,
    high NUMERIC,
    low NUMERIC,
    close NUMERIC,
    volume NUMERIC,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(symbol, interval, candle_timestamp)
);
