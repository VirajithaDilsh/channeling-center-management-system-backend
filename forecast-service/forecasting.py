"""Monthly revenue forecasting with chronological backtesting.

Pure functions only (no I/O) so they are easy to test. Candidate models are
deliberately simple: with a clinic's monthly revenue there are rarely enough
points to justify anything complex, and the backtest decides, not assumptions.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression, Ridge

MIN_MONTHS = 6          # below this we refuse to forecast
MIN_MONTHS_3 = 12       # below this a 3-month horizon is not offered
MIN_TRAIN = 3
MIN_FOLDS = 3
LAGS = 3
SEASON = 12


@dataclass
class Prepared:
    series: pd.Series          # complete months only, PeriodIndex[M]
    dropped_partial: bool
    leading_zero_months: int


def prepare(points: list[dict], current_month: str | None) -> Prepared:
    """points: [{month: 'YYYY-MM', value: float}]. Drops the incomplete current
    month, fills gaps with zero (a month with no closed sessions earned 0) and
    trims zero months before the first revenue."""
    s = pd.Series({pd.Period(p["month"], "M"): float(p["value"]) for p in points}).sort_index()
    dropped = False
    if current_month is not None:
        cm = pd.Period(current_month, "M")
        if cm in s.index:
            s = s.drop(cm)
            dropped = True
    if s.empty:
        return Prepared(s, dropped, 0)
    s = s.reindex(pd.period_range(s.index.min(), s.index.max(), freq="M"), fill_value=0.0)
    nz = np.flatnonzero(s.to_numpy() != 0)
    if nz.size == 0:
        return Prepared(s.iloc[0:0], dropped, len(s))
    lead = int(nz[0])
    return Prepared(s.iloc[lead:], dropped, lead)


# ---- candidate models: fn(train: ndarray, h: int) -> ndarray(h) ----------------

def m_naive(train, h):
    return np.repeat(train[-1], h)


def m_mean3(train, h):
    return np.repeat(train[-3:].mean(), h)


def m_linear(train, h):
    y = train[-12:]
    x = np.arange(len(y)).reshape(-1, 1)
    lr = LinearRegression().fit(x, y)
    return lr.predict(np.arange(len(y), len(y) + h).reshape(-1, 1))


def m_ridge_lags(train, h):
    if len(train) < LAGS + 4:
        raise ValueError("too short")
    X = np.array([train[i - LAGS:i] for i in range(LAGS, len(train))])
    y = train[LAGS:]
    scale = max(float(np.abs(train).mean()), 1.0)
    model = Ridge(alpha=1.0).fit(X / scale, y / scale)
    hist = list(train[-LAGS:])
    out = []
    for _ in range(h):
        nxt = float(model.predict(np.array(hist[-LAGS:]).reshape(1, -1) / scale)[0] * scale)
        out.append(nxt)
        hist.append(nxt)
    return np.array(out)


def m_seasonal_naive(train, h):
    if len(train) < SEASON:
        raise ValueError("too short")
    return np.array([train[len(train) - SEASON + (i % SEASON)] for i in range(h)])


# Ordered simplest first: ties in backtest error go to the simpler model.
MODELS = {
    "naive": (m_naive, 1),
    "moving_average_3": (m_mean3, 3),
    "linear_trend": (m_linear, 4),
    "ridge_lags": (m_ridge_lags, LAGS + 4),
    "seasonal_naive": (m_seasonal_naive, SEASON),
}


def backtest(values: np.ndarray, h: int) -> dict[str, dict]:
    """Expanding-window, h-step-ahead backtest. Error per origin is averaged
    over the h steps. All models are scored on the SAME origins so the
    comparison is fair: the origin list starts at the longest history any
    included model needs, and models that would leave fewer than MIN_FOLDS
    folds are dropped (most data-hungry first)."""
    n = len(values)
    names = list(MODELS)
    while names:
        start = max(MIN_TRAIN, *(MODELS[k][1] for k in names))
        origins = list(range(start, n - h + 1))
        if len(origins) >= MIN_FOLDS:
            break
        names.remove(max(names, key=lambda k: MODELS[k][1]))
    else:
        return {}
    results = {}
    for name in names:
        fn = MODELS[name][0]
        errs, sq, act_sum = [], [], 0.0
        for t in origins:
            pred = np.clip(fn(values[:t], h), 0, None)
            act = values[t:t + h]
            errs.append(np.abs(pred - act).mean())
            sq.append(((pred - act) ** 2).mean())
            act_sum += float(np.abs(act).mean())
        mae = float(np.mean(errs))
        results[name] = {
            "mae": mae,
            "rmse": math.sqrt(float(np.mean(sq))),
            "wape": mae * len(errs) / act_sum if act_sum else None,
            "folds": len(errs),
        }
    return results


def detect_outliers(s: pd.Series) -> list[dict]:
    v = s.to_numpy()
    if len(v) < 6:
        return []
    med = np.median(v)
    mad = np.median(np.abs(v - med))
    if mad == 0:
        return []
    z = 0.6745 * (v - med) / mad
    return [{"month": str(s.index[i]), "value": float(v[i]), "robustZ": round(float(z[i]), 2)}
            for i in np.flatnonzero(np.abs(z) > 3.5)]


def forecast(points: list[dict], horizon: int, current_month: str | None) -> dict:
    prep = prepare(points, current_month)
    s = prep.series
    n = len(s)
    quality = {
        "monthsUsed": n,
        "firstMonth": str(s.index[0]) if n else None,
        "lastMonth": str(s.index[-1]) if n else None,
        "droppedPartialMonth": prep.dropped_partial,
        "leadingZeroMonthsTrimmed": prep.leading_zero_months,
        "zeroMonths": int((s == 0).sum()) if n else 0,
        "outliers": detect_outliers(s) if n else [],
        "warnings": [],
    }
    if quality["zeroMonths"]:
        quality["warnings"].append("Some months had no closed sessions and were treated as zero revenue.")
    if quality["outliers"]:
        quality["warnings"].append("Unusual months were detected; they were kept in the data, so forecasts may be affected.")

    def insufficient(msg):
        return {"status": "insufficient_data", "message": msg, "horizon": horizon,
                "model": None, "forecast": [], "validation": None, "dataQuality": quality}

    if n < MIN_MONTHS:
        return insufficient(f"Only {n} complete month(s) of revenue are available; at least {MIN_MONTHS} are needed for a forecast that can be validated.")
    if horizon > 1 and n < MIN_MONTHS_3:
        return insufficient(f"A {horizon}-month forecast needs at least {MIN_MONTHS_3} complete months; {n} are available. A 1-month forecast can be requested instead.")

    values = s.to_numpy(dtype=float)
    scores = backtest(values, horizon)
    if "naive" not in scores:
        return insufficient("Not enough history to backtest even the baseline forecast.")
    best = min(scores, key=lambda k: (round(scores[k]["mae"], 6), list(MODELS).index(k)))
    fn = MODELS[best][0]
    pred = np.clip(fn(values, horizon), 0, None)
    sigma = scores[best]["rmse"]
    last = s.index[-1]
    out = []
    for i, p in enumerate(pred, start=1):
        out.append({
            "month": str(last + i),
            "value": round(float(p), 2),
            "lower": round(max(0.0, float(p) - 1.28 * sigma), 2),
            "upper": round(float(p) + 1.28 * sigma, 2),
        })
    base = scores["naive"]["mae"]
    return {
        "status": "ok",
        "message": None,
        "horizon": horizon,
        "model": best,
        "forecast": out,
        "validation": {
            "method": f"expanding-window backtest, {horizon}-step ahead",
            "folds": scores[best]["folds"],
            "mae": round(scores[best]["mae"], 2),
            "rmse": round(scores[best]["rmse"], 2),
            "wape": None if scores[best]["wape"] is None else round(scores[best]["wape"], 4),
            "baselineModel": "naive",
            "baselineMae": round(base, 2),
            "beatsBaseline": best != "naive" and scores[best]["mae"] < base,
            "candidates": {k: {"mae": round(v["mae"], 2), "wape": None if v["wape"] is None else round(v["wape"], 4)}
                           for k, v in scores.items()},
            "intervalNote": "Range is approximate (about 80%), derived from backtest error.",
        },
        "dataQuality": quality,
    }
