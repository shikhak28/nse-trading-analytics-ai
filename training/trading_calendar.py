"""NSE trading-day calendar, backed by shared/nse_holidays.json (the same file
the frontend reads, so the cron and the Predictions page agree on what a
trading day is).

Usage as a cron guard -- exits 1 on weekends/holidays so the `&&` chain
after it (build_dataset -> predict -> verify -> rank) is skipped:
    python trading_calendar.py
"""

import datetime as dt
import json
import sys
from pathlib import Path

HOLIDAYS_PATH = Path(__file__).resolve().parent.parent / "shared" / "nse_holidays.json"


def load_holidays():
    raw = json.loads(HOLIDAYS_PATH.read_text())
    return {
        dt.date.fromisoformat(day)
        for key, days in raw.items()
        if not key.startswith("_")
        for day in days
    }


def is_trading_day(day, holidays=None):
    holidays = load_holidays() if holidays is None else holidays
    return day.weekday() < 5 and day not in holidays


def main():
    today = dt.date.today()
    holidays = load_holidays()
    if str(today.year) not in json.loads(HOLIDAYS_PATH.read_text()):
        print(f"[trading_calendar] WARNING: no NSE holiday list for {today.year} in {HOLIDAYS_PATH}", file=sys.stderr)
    if not is_trading_day(today, holidays):
        print(f"[trading_calendar] {today} is not an NSE trading day -- skipping pipeline")
        sys.exit(1)
    print(f"[trading_calendar] {today} is a trading day")


if __name__ == "__main__":
    main()
