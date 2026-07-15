# Entity-Relationship Diagram

Reflects the schema as of migration `008_add_exchange_identity.sql`. Renders automatically on GitHub and in VSCode (with a Mermaid preview extension).

```mermaid
erDiagram
    USERS ||--o{ BROKER_TOKENS : "has"
    COMPANIES ||--o{ HISTORICAL_PRICES : "has candles"
    AGENT_CONVERSATIONS ||--o{ AGENT_ANALYSIS_RESULTS : "produced"

    USERS {
        serial id PK
        varchar broker_user_id UK
        text user_name
        text email
        varchar broker "default 'zerodha'"
        timestamp connected_at
        timestamp created_at
        timestamp updated_at
    }

    BROKER_TOKENS {
        serial id PK
        integer user_id FK
        text access_token
        varchar token_type "default 'bearer'"
        timestamp generated_at
        timestamp expires_at
        boolean is_valid
        timestamp created_at
        timestamp updated_at
    }

    COMPANIES {
        varchar exchange PK "NSE"
        varchar symbol PK
        text company_name
        varchar instrument_token
        varchar segment
        varchar exchange_token
        timestamp updated_at
    }

    HISTORICAL_PRICES {
        bigint id PK
        varchar exchange FK "composite with symbol"
        varchar symbol FK
        varchar instrument_token
        varchar interval "day or minute"
        timestamp candle_timestamp PK "partition key, monthly range"
        numeric open
        numeric high
        numeric low
        numeric close
        numeric volume
        timestamp created_at
        timestamp updated_at
    }

    AGENT_CONVERSATIONS {
        serial id PK
        varchar session_id
        varchar role "user, assistant, or tool"
        text content
        jsonb tool_calls
        timestamp created_at
    }

    AGENT_ANALYSIS_RESULTS {
        serial id PK
        integer conversation_id FK "nullable, ON DELETE SET NULL"
        text query_text
        varchar result_type
        jsonb result_json
        text_array symbols_involved
        timestamp created_at
    }

    APP_SETTINGS {
        varchar key PK
        text value
        timestamp updated_at
    }
```

## Notes

- **`COMPANIES`**: primary key is the composite `(exchange, symbol)` — trading symbols aren't globally unique (e.g. `RELIANCE` trades on both NSE and BSE under the same tradingsymbol with different `instrument_token`s), so identity requires both columns together (added in migration `008`).
- **`HISTORICAL_PRICES`**: partitioned by month on `candle_timestamp` (see `007_partition_historical_prices.sql`) — ~49 partitions covering roughly 3 years back to 1 year forward, plus a `DEFAULT` catch-all partition. The FK to `COMPANIES` is also composite: `(exchange, symbol)`. Unique constraint is `(exchange, symbol, interval, candle_timestamp)` — one row per candle per symbol per exchange per interval (day/minute).
- **`AGENT_ANALYSIS_RESULTS.conversation_id`** is nullable with `ON DELETE SET NULL` rather than `CASCADE` — deleting a conversation doesn't destroy the analysis history it produced.
- **`APP_SETTINGS`** is a legacy key/value table (predates `USERS`/`BROKER_TOKENS`) — migration `001` migrates any existing Kite access token out of it, but the table itself isn't dropped.
- **`schema_migrations`** (tracking table created by `backend/scripts/migrate.js`, not shown above) just records which migration files have run — not part of the application's data model.
