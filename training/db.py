import math

import numpy as np
import psycopg2
import psycopg2.extras
import pandas as pd

from config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD


def _json_safe(value):
    """Recursively convert numpy scalars and NaN/Infinity to plain JSON-safe
    Python values -- json.dumps emits the literal `NaN` for float('nan'),
    which Postgres' jsonb parser rejects as invalid input."""
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return None if not math.isfinite(value) else float(value)
    if isinstance(value, np.ndarray):
        return _json_safe(value.tolist())
    return value


def get_connection():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD,
    )


def fetch_df(sql, params=None):
    with get_connection() as conn:
        return pd.read_sql(sql, conn, params=params)


def fetch_all_symbols(exchange=None):
    sql = "SELECT exchange, symbol FROM companies"
    params = None
    if exchange:
        sql += " WHERE exchange = %s"
        params = (exchange,)
    sql += " ORDER BY exchange, symbol"
    return fetch_df(sql, params)


def fetch_daily_candles(exchange, symbol):
    return fetch_df(
        """
        SELECT candle_timestamp, open, high, low, close, volume
        FROM historical_prices
        WHERE exchange = %s AND symbol = %s AND interval = 'day'
        ORDER BY candle_timestamp ASC
        """,
        (exchange, symbol),
    )


def upsert_features(rows):
    """rows: list of dicts with exchange, symbol, feature_timestamp, horizon,
    feature_set_version, features (dict, gets JSON-encoded)."""
    if not rows:
        return
    import json

    sql = """
        INSERT INTO features (exchange, symbol, feature_timestamp, horizon, feature_set_version, features)
        VALUES %s
        ON CONFLICT (exchange, symbol, feature_timestamp, horizon, feature_set_version)
        DO UPDATE SET features = EXCLUDED.features
    """
    values = [
        (
            r["exchange"], r["symbol"], r["feature_timestamp"], r["horizon"],
            r["feature_set_version"], json.dumps(_json_safe(r["features"])),
        )
        for r in rows
    ]
    with get_connection() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, values, template="(%s,%s,%s,%s,%s,%s::jsonb)")
        conn.commit()


def insert_model_version(row):
    sql = """
        INSERT INTO model_versions
            (model_name, horizon, target_label, algorithm, version_tag,
             artifact_path, feature_set_version, train_window_start, train_window_end,
             status, metrics)
        VALUES (%(model_name)s, %(horizon)s, %(target_label)s, %(algorithm)s, %(version_tag)s,
                %(artifact_path)s, %(feature_set_version)s, %(train_window_start)s, %(train_window_end)s,
                %(status)s, %(metrics)s)
        RETURNING id
    """
    import json

    params = {**row, "metrics": json.dumps(_json_safe(row["metrics"]))}
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            model_version_id = cur.fetchone()[0]
        conn.commit()
    return model_version_id


def insert_training_run(row):
    sql = """
        INSERT INTO training_runs
            (model_version_id, started_at, finished_at, hyperparameters,
             train_rows, val_rows, val_metrics, status)
        VALUES (%(model_version_id)s, %(started_at)s, %(finished_at)s, %(hyperparameters)s,
                %(train_rows)s, %(val_rows)s, %(val_metrics)s, %(status)s)
    """
    import json

    params = {
        **row,
        "hyperparameters": json.dumps(_json_safe(row["hyperparameters"])),
        "val_metrics": json.dumps(_json_safe(row["val_metrics"])),
    }
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()


def fetch_production_model(horizon, target_label):
    df = fetch_df(
        """
        SELECT * FROM model_versions
        WHERE horizon = %s AND target_label = %s AND status = 'production'
        ORDER BY trained_at DESC LIMIT 1
        """,
        (horizon, target_label),
    )
    return df.iloc[0] if len(df) else None


def insert_predictions(rows):
    if not rows:
        return
    sql = """
        INSERT INTO predictions
            (exchange, symbol, predicted_at, horizon, target_label, model_version_id,
             predicted_value, predicted_low, predicted_high, confidence, explanation)
        VALUES %s
        ON CONFLICT (exchange, symbol, predicted_at, horizon, target_label, model_version_id)
        DO NOTHING
    """
    import json

    values = [
        (
            r["exchange"], r["symbol"], r["predicted_at"], r["horizon"], r["target_label"],
            r["model_version_id"], r["predicted_value"], r.get("predicted_low"),
            r.get("predicted_high"), r.get("confidence"),
            json.dumps(_json_safe(r["explanation"])) if r.get("explanation") is not None else None,
        )
        for r in rows
    ]
    with get_connection() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(
                cur, sql, values,
                template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)",
            )
        conn.commit()


def fetch_unverified_predictions(horizon):
    return fetch_df(
        """
        SELECT p.id, p.exchange, p.symbol, p.predicted_at, p.horizon, p.target_label,
               p.predicted_value
        FROM predictions p
        LEFT JOIN prediction_verification v
            ON v.prediction_id = p.id AND v.checkpoint = p.horizon
        WHERE p.horizon = %s AND v.id IS NULL
        """,
        (horizon,),
    )


def insert_verifications(rows):
    if not rows:
        return
    sql = """
        INSERT INTO prediction_verification
            (prediction_id, prediction_predicted_at, checkpoint, actual_value, error,
             signal_hit, realized_return)
        VALUES %s
        ON CONFLICT (prediction_id, checkpoint) DO NOTHING
    """
    values = [
        (
            r["prediction_id"], r["prediction_predicted_at"], r["checkpoint"],
            r["actual_value"], r["error"], r["signal_hit"], r["realized_return"],
        )
        for r in rows
    ]
    with get_connection() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, values)
        conn.commit()


def fetch_predictions_for_date(date, target_label, horizon="next_day"):
    return fetch_df(
        """
        SELECT id, exchange, symbol, predicted_at, predicted_value
        FROM predictions
        WHERE predicted_at::date = %s AND horizon = %s AND target_label = %s
        """,
        (date, horizon, target_label),
    )


def insert_rankings(rows):
    if not rows:
        return
    sql = """
        INSERT INTO daily_rankings
            (ranking_date, category, rank, exchange, symbol, prediction_id, prediction_predicted_at, score)
        VALUES %s
        ON CONFLICT (ranking_date, category, rank) DO NOTHING
    """
    values = [
        (
            r["ranking_date"], r["category"], r["rank"], r["exchange"], r["symbol"],
            r["prediction_id"], r["prediction_predicted_at"], r["score"],
        )
        for r in rows
    ]
    with get_connection() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, values)
        conn.commit()
