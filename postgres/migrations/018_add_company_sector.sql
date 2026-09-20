-- Sector/industry classification per company, for filtering on the
-- Predictions page (jewellery, oil, defence, energy, textile, etc. --
-- under NSE's own sector-tier names). No existing source carries this
-- (Kite's instrument dump doesn't include it) -- populated via a one-time
-- manual import (backend/scripts/importSectorData.js) from NSE's official
-- industry classification data. Nullable: coverage from the import may not
-- be 100% (new listings, symbol mismatches) -- NULL just means
-- "uncategorized", not an error state.

ALTER TABLE companies ADD COLUMN sector VARCHAR(64);
ALTER TABLE companies ADD COLUMN industry VARCHAR(128);

CREATE INDEX idx_companies_sector ON companies (sector);
