const db = require("../config/db");

/**
 * Store a freshly issued Zerodha access token, invalidating whatever was
 * active before it. Zerodha tokens have no refresh flow -- a new one only
 * ever arrives via a fresh OAuth login.
 */
async function saveToken(userId, accessToken) {
    await db.query(
        `UPDATE broker_tokens SET is_valid = FALSE, updated_at = NOW() WHERE user_id = $1 AND is_valid = TRUE`,
        [userId]
    );

    await db.query(
        `INSERT INTO broker_tokens(user_id, access_token, is_valid, generated_at) VALUES ($1, $2, TRUE, NOW())`,
        [userId, accessToken]
    );
}

async function getActiveToken() {
    const result = await db.query(
        `SELECT access_token FROM broker_tokens WHERE is_valid = TRUE ORDER BY generated_at DESC LIMIT 1`
    );

    return result.rows[0]?.access_token || null;
}

/**
 * Flip the active token invalid -- used both for explicit logout and when a
 * Kite API call comes back with an auth failure (expired/invalidated token).
 */
async function invalidateActiveToken() {
    await db.query(`UPDATE broker_tokens SET is_valid = FALSE, updated_at = NOW() WHERE is_valid = TRUE`);
}

/**
 * Metadata about the most recent token (regardless of validity) -- for the
 * Profile page's token-status display.
 */
async function getLatestTokenMeta() {
    const result = await db.query(
        `SELECT is_valid, generated_at FROM broker_tokens ORDER BY generated_at DESC LIMIT 1`
    );

    return result.rows[0] || null;
}

module.exports = {
    saveToken,
    getActiveToken,
    invalidateActiveToken,
    getLatestTokenMeta,
};
