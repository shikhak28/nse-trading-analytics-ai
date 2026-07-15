-- Storage for the AI Trading Agent (Phase 5): conversation turns and any
-- analysis it produces, so results can be listed/audited later without
-- recomputation. See backend/agent/ once Phase 5 lands.

CREATE TABLE IF NOT EXISTS agent_conversations (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL,
    role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    content TEXT,
    tool_calls JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Main access pattern: load a session's turns in order.
CREATE INDEX IF NOT EXISTS idx_agent_conversations_session
    ON agent_conversations(session_id, created_at);

CREATE TABLE IF NOT EXISTS agent_analysis_results (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER REFERENCES agent_conversations(id) ON DELETE SET NULL,
    query_text TEXT NOT NULL,
    result_type VARCHAR(64),
    result_json JSONB,
    symbols_involved TEXT[],
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_analysis_created
    ON agent_analysis_results(created_at DESC);
