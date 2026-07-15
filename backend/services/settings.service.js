const db = require("../config/db");
async function getSetting(key) {
    const result = await db.query(
        `
        SELECT value
        FROM app_settings
        WHERE key = $1
        `,
        [key]
    );

    if (result.rows.length === 0) {
        return null;
    }

    return result.rows[0].value;
}

async function setSetting(key, value) {
    await db.query(
        `
        INSERT INTO app_settings(key, value, updated_at)
        VALUES($1, $2, NOW())
        ON CONFLICT(key)
        DO UPDATE
        SET
            value = EXCLUDED.value,
            updated_at = NOW()
        `,
        [key, value]
    );
}

module.exports = {
    getSetting,
    setSetting
};