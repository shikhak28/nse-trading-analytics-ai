"""Shared evaluation metrics -- used by train.py per walk-forward fold and by
any future shadow-vs-production comparison. Accuracy/RMSE alone are
deliberately not the headline metrics here: IC and a naive top-decile
backtest are what tell you whether a signal is actually investable (see
design doc §3).
"""

import numpy as np
import pandas as pd
from scipy.stats import spearmanr


def information_coefficient(y_true, y_pred):
    if len(y_true) < 2:
        return np.nan
    ic, _ = spearmanr(y_true, y_pred)
    return ic


def brier_score(y_true, y_pred_proba):
    return float(np.mean((np.asarray(y_pred_proba) - np.asarray(y_true)) ** 2))


def calibration_table(y_true, y_pred_proba, n_bins=10):
    df = pd.DataFrame({"y": y_true, "p": y_pred_proba})
    df["bucket"] = pd.qcut(df["p"], q=min(n_bins, df["p"].nunique()), duplicates="drop")
    return df.groupby("bucket", observed=True).agg(
        predicted_mean=("p", "mean"), actual_rate=("y", "mean"), n=("y", "size"),
    ).reset_index()


def top_decile_backtest(dates, symbols, y_true_return, y_pred_score):
    """Naive long-only strategy: each date, go long the top decile by
    predicted score, equal-weighted, hold for the label's return window.
    Returns Sharpe / max drawdown / profit factor of the resulting daily
    strategy-return series. This is a sanity backtest, not
    execution-realistic (no costs/slippage) -- see design doc §18.
    """
    df = pd.DataFrame({
        "date": dates, "symbol": symbols, "ret": y_true_return, "score": y_pred_score,
    })

    daily_returns = []
    for date, group in df.groupby("date"):
        if len(group) < 10:
            continue
        cutoff = group["score"].quantile(0.9)
        top = group[group["score"] >= cutoff]
        if len(top) == 0:
            continue
        daily_returns.append(top["ret"].mean())

    if not daily_returns:
        return {"sharpe": np.nan, "max_drawdown": np.nan, "profit_factor": np.nan, "n_days": 0}

    returns = pd.Series(daily_returns)
    sharpe = (returns.mean() / returns.std()) * np.sqrt(252) if returns.std() > 0 else np.nan

    cumulative = (1 + returns).cumprod()
    running_max = cumulative.cummax()
    drawdown = (cumulative - running_max) / running_max
    max_drawdown = drawdown.min()

    gains = returns[returns > 0].sum()
    losses = -returns[returns < 0].sum()
    profit_factor = gains / losses if losses > 0 else np.nan

    return {
        "sharpe": float(sharpe) if pd.notna(sharpe) else None,
        "max_drawdown": float(max_drawdown) if pd.notna(max_drawdown) else None,
        "profit_factor": float(profit_factor) if pd.notna(profit_factor) else None,
        "n_days": len(returns),
    }
