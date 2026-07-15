function average(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Wilder's RSI over the full candle series, returning only the latest value.
 * Needs at least period+1 candles; returns null if there isn't enough data.
 */
function calculateRSI(candles, period = 14) {
    if (candles.length < period + 1) {
        return null;
    }

    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = Number(candles[i].close) - Number(candles[i - 1].close);
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < candles.length; i++) {
        const diff = Number(candles[i].close) - Number(candles[i - 1].close);
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) {
        return 100;
    }

    const relativeStrength = avgGain / avgLoss;
    return 100 - 100 / (1 + relativeStrength);
}

/**
 * Simple moving average of closing price over the most recent `period` candles.
 */
function calculateSMA(candles, period = 20) {
    if (candles.length < period) {
        return null;
    }

    const closes = candles.slice(-period).map((candle) => Number(candle.close));
    return average(closes);
}

/**
 * "Increasing volume" interpreted as: average volume over the most recent
 * `days` window is higher than the `days` window before it -- a trend, not
 * a (rare) requirement that every single day beats the last.
 */
function isVolumeIncreasing(candles, days = 10) {
    if (candles.length < days * 2) {
        return false;
    }

    const recent = candles.slice(-days).map((candle) => Number(candle.volume));
    const prior = candles.slice(-days * 2, -days).map((candle) => Number(candle.volume));

    return average(recent) > average(prior);
}

/**
 * Breakout: today's close above the prior N-day high, on volume at least
 * 1.5x the prior N-day average -- a standard, simple breakout heuristic.
 */
function detectBreakout(candles, lookbackDays = 20) {
    if (candles.length < lookbackDays + 1) {
        return { isBreakout: false };
    }

    const window = candles.slice(-lookbackDays - 1, -1);
    const today = candles[candles.length - 1];

    const priorHigh = Math.max(...window.map((candle) => Number(candle.high)));
    const avgVolume = average(window.map((candle) => Number(candle.volume)));
    const todayClose = Number(today.close);
    const todayVolume = Number(today.volume);
    const volumeRatio = avgVolume > 0 ? todayVolume / avgVolume : 0;

    return {
        isBreakout: todayClose > priorHigh && volumeRatio >= 1.5,
        priorHigh,
        todayClose,
        volumeRatio: Number(volumeRatio.toFixed(2)),
    };
}

module.exports = {
    calculateRSI,
    calculateSMA,
    isVolumeIncreasing,
    detectBreakout,
};
