const db = require("../config/db");

/**
 * Create/update the account owner from a Kite Connect session response.
 * Single-tenant app: this table normally holds exactly one row.
 */
async function upsertUserFromSession(session) {
    const brokerUserId = session.user_id || "unknown";

    const result = await db.query(
        `
        INSERT INTO users(broker_user_id, user_name, email, broker, connected_at, updated_at)
        VALUES ($1, $2, $3, 'zerodha', NOW(), NOW())
        ON CONFLICT (broker_user_id) DO UPDATE SET
            user_name = EXCLUDED.user_name,
            email = EXCLUDED.email,
            connected_at = NOW(),
            updated_at = NOW()
        RETURNING id, broker_user_id, user_name, email, broker, connected_at
        `,
        [brokerUserId, session.user_name || null, session.email || null]
    );

    return result.rows[0];
}

async function getUser() {
    const result = await db.query(
        `SELECT id, broker_user_id, user_name, email, broker, connected_at FROM users ORDER BY id ASC LIMIT 1`
    );

    return result.rows[0] || null;
}

module.exports = {
    upsertUserFromSession,
    getUser,
};
