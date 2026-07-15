-- Referential integrity between historical_prices and companies. Backfill
-- any symbols that have price history but no companies row (can happen from
-- earlier ad-hoc syncs) before the constraint is added, so this migration
-- doesn't fail on existing data.

INSERT INTO companies (symbol, company_name, exchange, instrument_token, segment, exchange_token)
SELECT DISTINCT hp.symbol, hp.symbol, 'NSE', hp.instrument_token, '', ''
FROM historical_prices hp
LEFT JOIN companies c ON c.symbol = hp.symbol
WHERE c.symbol IS NULL
ON CONFLICT (symbol) DO NOTHING;

ALTER TABLE historical_prices
    ADD CONSTRAINT fk_historical_prices_symbol
    FOREIGN KEY (symbol) REFERENCES companies(symbol)
    ON DELETE CASCADE;
