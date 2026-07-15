const db = require("../config/db");

async function appendMessage(sessionId, role, content, toolCalls = null) {
    await db.query(
        `INSERT INTO agent_conversations(session_id, role, content, tool_calls) VALUES ($1, $2, $3, $4)`,
        [sessionId, role, content, toolCalls ? JSON.stringify(toolCalls) : null]
    );
}

async function getHistory(sessionId, limit = 50) {
    const result = await db.query(
        `SELECT role, content, tool_calls, created_at
         FROM agent_conversations
         WHERE session_id = $1
         ORDER BY created_at ASC
         LIMIT $2`,
        [sessionId, limit]
    );

    return result.rows;
}

module.exports = { appendMessage, getHistory };
