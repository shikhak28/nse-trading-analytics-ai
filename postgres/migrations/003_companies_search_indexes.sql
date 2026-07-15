-- Fast search/filter across 2000+ companies (Dashboard requirement) and a
-- proper index on instrument_token, which is looked up on every historical
-- sync call. pg_trgm gives fuzzy/partial-name matching without a separate
-- search engine.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_companies_instrument_token
    ON companies(instrument_token);

CREATE INDEX IF NOT EXISTS idx_companies_name_trgm
    ON companies USING GIN (company_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_companies_symbol_trgm
    ON companies USING GIN (symbol gin_trgm_ops);
