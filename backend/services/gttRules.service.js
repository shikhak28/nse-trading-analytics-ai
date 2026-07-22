const db = require("../config/db");

const RULE_FIELDS = [
    "name",
    "rule_type",
    "transaction_type",
    "direction",
    "percent_offset",
    "target_percent",
    "stoploss_percent",
    "order_type",
    "product",
];

async function listRules(userId) {
    const result = await db.query(`SELECT * FROM gtt_rules WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
    return result.rows;
}

async function createRule(userId, fields) {
    const values = RULE_FIELDS.map((field) => fields[field] ?? null);
    const result = await db.query(
        `INSERT INTO gtt_rules(user_id, ${RULE_FIELDS.join(", ")})
         VALUES ($1, ${RULE_FIELDS.map((_, i) => `$${i + 2}`).join(", ")})
         RETURNING *`,
        [userId, ...values]
    );
    return result.rows[0];
}

async function updateRule(id, fields) {
    const setClauses = RULE_FIELDS.map((field, i) => `${field} = $${i + 2}`);
    const values = RULE_FIELDS.map((field) => fields[field] ?? null);
    const result = await db.query(
        `UPDATE gtt_rules SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id, ...values]
    );
    return result.rows[0];
}

async function deleteRule(id) {
    await db.query(`DELETE FROM gtt_rules WHERE id = $1`, [id]);
}

module.exports = { listRules, createRule, updateRule, deleteRule };
