"""Prediction explainability via SHAP. Explains an existing prediction's
feature attribution -- it does not (and shouldn't) speak to whether the
prediction turns out correct; that's what prediction_verification is for.

Classification models here are CalibratedClassifierCV wrapping LGBMClassifier
(see train.py's fit_classifier) -- SHAP's TreeExplainer can't explain the
calibration wrapper directly, so we unwrap to the first fold's underlying
LightGBM estimator. Calibration is a monotonic rescaling of the probability,
so the underlying tree's feature attribution direction/ranking stays valid
even though calibration itself isn't explained.
"""

import shap

FEATURE_LABELS = {
    "ret_1": "1-day return",
    "log_ret_1": "1-day log return",
    "ret_5": "5-day return",
    "ret_20": "20-day return",
    "gap_pct": "Opening gap",
    "roll_mean_5": "5-day price average",
    "roll_std_5": "5-day volatility",
    "roll_mean_20": "20-day price average",
    "roll_std_20": "20-day volatility",
    "atr_14": "Average True Range (14)",
    "rsi_14": "RSI momentum",
    "macd": "MACD",
    "macd_signal": "MACD signal line",
    "macd_hist": "MACD histogram trend",
    "adx_14": "Trend strength (ADX)",
    "vwap_dist_20": "Distance from VWAP",
    "bb_percent_b_20": "Bollinger Band position",
    "momentum_10": "10-day momentum",
    "realized_vol_20": "Realized volatility",
    "price_acceleration": "Price acceleration",
    "trend_slope_20": "20-day trend slope",
    "trend_r2_20": "20-day trend consistency",
    "volume_ratio_1": "Volume vs previous day",
    "volume_ratio_20": "Volume vs 20-day average",
    "breakout_4pct": "4% breakout on rising volume",
    "range_expansion_3": "Day's range expansion",
    "close_location": "Close position in day's range",
    "above_sma_50": "Price vs 50-day average",
    "market_ret_1": "Overall market move",
    "breadth_above_50dma": "Market breadth",
    "sector_strength_5": "Sector strength",
    "stock_vs_sector_5": "Stock vs its sector",
    "green_streak": "Days in a row up or down",
    "dist_high_20": "Distance from 20-day high",
    "dist_high_52w": "Distance from 52-week high",
    "volume_trend_5_20": "Recent volume vs usual",
    "up_down_volume_10": "Volume on up days vs down days",
}

TOP_K = 3


def _unwrap_classifier(model):
    return model.calibrated_classifiers_[0].estimator


def build_explainer(model, is_classification):
    try:
        base_model = _unwrap_classifier(model) if is_classification else model
        return shap.TreeExplainer(base_model)
    except Exception as err:
        print(f"  [explain] could not build SHAP explainer, skipping explanations: {err}")
        return None


def _phrase(feature, contribution):
    label = FEATURE_LABELS.get(feature, feature)
    if contribution >= 0:
        return f"{label} is supporting this move"
    return f"{label} is weighing against this move"


def compute_shap_batch(explainer, X):
    """One SHAP call for the whole batch (all symbols for this target) rather
    than one call per row -- TreeExplainer supports batched input directly and
    it's meaningfully faster than looping. Returns None on any failure so
    callers can skip explanations for this target without crashing predict.py.
    """
    if explainer is None:
        return None
    try:
        shap_values = explainer.shap_values(X)
        # Classifiers: shap_values is [class0_array, class1_array] -- we want
        # the positive-class (index 1) contribution. Regressors: a single array.
        return shap_values[1] if isinstance(shap_values, list) else shap_values
    except Exception as err:
        print(f"  [explain] failed to compute SHAP values, leaving explanations null: {err}")
        return None


def top_features_for_row(row, shap_row_values, columns):
    if shap_row_values is None:
        return None

    contributions = list(zip(columns, shap_row_values))
    contributions.sort(key=lambda pair: abs(pair[1]), reverse=True)
    top = contributions[:TOP_K]

    return {
        "topFeatures": [
            {
                "feature": feature,
                "value": float(row[feature]),
                "contribution": float(contribution),
                "phrase": _phrase(feature, contribution),
            }
            for feature, contribution in top
        ]
    }
