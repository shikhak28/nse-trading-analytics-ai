-- Replaces stuffing the Zerodha access token into the generic app_settings
-- key/value blob with a proper users + broker_tokens model. Single-tenant
-- app: `users` normally holds exactly one row (the account owner), but is
-- kept as a real table with a surrogate key for a clean FK target and
-- because the Profile page needs somewhere to read owner info from.

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    broker_user_id VARCHAR(64) UNIQUE NOT NULL,
    user_name TEXT,
    email TEXT,
    broker VARCHAR(32) NOT NULL DEFAULT 'zerodha',
    connected_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS broker_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    token_type VARCHAR(32) NOT NULL DEFAULT 'bearer',
    generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    is_valid BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Main access pattern: "give me the current valid token", newest first.
CREATE INDEX IF NOT EXISTS idx_broker_tokens_active
    ON broker_tokens(user_id, is_valid, generated_at DESC);

-- Backfill: carry over a legacy token from app_settings if one is present,
-- so an already-connected deployment isn't forced to re-login purely
-- because of this migration.
DO $$
DECLARE
    legacy_token TEXT;
    owner_id INTEGER;
BEGIN
    SELECT value INTO legacy_token
    FROM app_settings
    WHERE key = 'kite_access_token' AND value IS NOT NULL AND value <> '';

    IF legacy_token IS NOT NULL THEN
        INSERT INTO users (broker_user_id, broker, connected_at)
        VALUES ('legacy-unknown', 'zerodha', NOW())
        ON CONFLICT (broker_user_id) DO NOTHING;

        SELECT id INTO owner_id FROM users WHERE broker_user_id = 'legacy-unknown';

        INSERT INTO broker_tokens (user_id, access_token, is_valid, generated_at)
        VALUES (owner_id, legacy_token, TRUE, NOW());
    END IF;
END $$;
