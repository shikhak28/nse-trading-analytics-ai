-- Days whose predictions must not count anywhere (accuracy, verification,
-- signal report card). On these days the candle sync wasn't running, so
-- predict.py re-scored the previous day's data: every stock's prediction is
-- an exact copy of the day before (checked 2026-11-11 -- 100% of
-- next_day_return / eod_return values equal the previous day's). predict.py
-- now refuses to score symbols without that day's candle, so new rows
-- should only be needed for a future incident.

CREATE TABLE IF NOT EXISTS invalid_prediction_days (
    day DATE PRIMARY KEY,
    reason TEXT NOT NULL
);

INSERT INTO invalid_prediction_days (day, reason)
SELECT d::date, 'stale candles: exact copy of previous day''s predictions'
FROM unnest(ARRAY[
    '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-05',
    '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14',
    '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-21', '2026-10-22',
    '2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29',
    '2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05',
    '2026-11-06'
]) AS d
ON CONFLICT (day) DO NOTHING;
