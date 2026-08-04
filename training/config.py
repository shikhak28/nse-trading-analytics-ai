import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env", override=True)

DB_HOST = os.environ["DB_HOST"]
DB_PORT = int(os.environ["DB_PORT"])
DB_NAME = os.environ["DB_NAME"]
DB_USER = os.environ["DB_USER"]
DB_PASSWORD = os.environ["DB_PASSWORD"]

FEATURE_SET_VERSION = "v1"

# 'eod'      -> feature snapshot as-of day t-1's close, predicting day t's
#               own intraday (open->close) return. Answers "which stocks
#               outperform today", decided before today's open.
# 'next_day' -> feature snapshot as-of day t's close, predicting day t+1's
#               close-to-close return. The "predict tomorrow" baseline.
HORIZONS = ["eod", "next_day"]

TARGET_LABELS = {
    "eod": ["eod_return"],
    "next_day": ["next_day_return", "p_move_up_2pct", "p_move_down_2pct"],
}

ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"
CACHE_DIR = Path(__file__).resolve().parent / "cache"
EXPORTS_DIR = Path(__file__).resolve().parent / "exports"
