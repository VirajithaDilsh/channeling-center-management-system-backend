"""Random Forest Regression & Weekday-Average fallback for Doctor Appointment Demand Forecasting."""

from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any, Optional

import numpy as np
from sklearn.ensemble import RandomForestRegressor

DEFAULT_WINDOW_DAYS = 90
MIN_HISTORY_DAYS = 14
FEATURE_LAG_START = 14
MIN_RF_TOTAL_DAYS = 35  # 14 lag days + >= 14 train days + >= 7 holdout days

MODEL_RF = "random_forest"
MODEL_BASELINE = "weekday_average_baseline"
LABEL_RF = "Random Forest"
LABEL_BASELINE = "Baseline Fallback"


def _parse_ymd(value: Any) -> Optional[date]:
    if not isinstance(value, str):
        return None
    parts = value.strip().split("-")
    if len(parts) != 3:
        return None
    try:
        return date(int(parts[0]), int(parts[1]), int(parts[2]))
    except ValueError:
        return None


def _to_non_negative_int(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num) or num < 0:
        return None
    return int(round(num))


def build_demand_features_for_index(
    dates: list[date],
    values: list[float],
    idx: int,
) -> list[float]:
    """
    Build leak-free time-series features for target index `idx` using ONLY
    observations strictly before `idx` (indices < idx).
    Historical doctor availability is NOT used because historical Schedule
    snapshots are unavailable/unknown.
    """
    if idx < FEATURE_LAG_START:
        raise ValueError(f"idx ({idx}) must be >= {FEATURE_LAG_START}")

    target_date = dates[idx]
    day_of_week = float(target_date.weekday())
    month = float(target_date.month)

    lag_1 = float(values[idx - 1])
    lag_7 = float(values[idx - 7])
    lag_14 = float(values[idx - 14])

    roll_7 = sum(values[idx - 7 : idx]) / 7.0
    roll_14 = sum(values[idx - 14 : idx]) / 14.0
    w30_start = max(0, idx - 30)
    roll_30 = sum(values[w30_start:idx]) / float(idx - w30_start)
    trend_7_vs_30 = roll_7 - roll_30

    return [
        day_of_week,
        month,
        lag_1,
        lag_7,
        lag_14,
        roll_7,
        roll_14,
        roll_30,
        trend_7_vs_30,
    ]


def _compute_metrics(actuals: list[float], preds: list[float]) -> tuple[float, float]:
    arr_a = np.asarray(actuals, dtype=float)
    arr_p = np.asarray(preds, dtype=float)
    errors = arr_a - arr_p
    mae = float(np.mean(np.abs(errors)))
    rmse = float(np.sqrt(np.mean(errors ** 2)))
    return round(mae, 4), round(rmse, 4)


def _weekday_average_prior(dates: list[date], values: list[float], idx: int) -> float:
    """Mean of prior observations (< idx) sharing the same weekday as dates[idx]."""
    wd = dates[idx].weekday()
    same_wd = [values[j] for j in range(idx) if dates[j].weekday() == wd]
    if same_wd:
        return sum(same_wd) / float(len(same_wd))
    return sum(values[:idx]) / float(idx) if idx > 0 else 0.0


def _train_and_validate_rf(
    dates: list[date],
    values: list[float],
) -> tuple[Optional[RandomForestRegressor], dict[str, Any]]:
    """
    Chronologically split supervised rows into train + holdout (no shuffling),
    compare RandomForestRegressor against the historical weekday-average baseline
    on MAE and RMSE, and select RF only when it matches or beats the baseline.
    """
    n = len(values)
    if n < MIN_RF_TOTAL_DAYS:
        return None, {
            "method": "chronological_holdout",
            "evaluated": False,
            "reason": f"Requires at least {MIN_RF_TOTAL_DAYS} days for RF validation (got {n}).",
            "holdoutDays": 0,
            "rfMae": None,
            "rfRmse": None,
            "baselineMae": None,
            "baselineRmse": None,
            "selectedModel": MODEL_BASELINE,
        }

    indices = list(range(FEATURE_LAG_START, n))
    X_all = [build_demand_features_for_index(dates, values, idx) for idx in indices]
    y_all = [float(values[idx]) for idx in indices]

    usable = len(indices)
    holdout_size = max(7, min(14, usable // 4))
    split_pos = usable - holdout_size

    X_train, y_train = X_all[:split_pos], y_all[:split_pos]
    X_val, y_val = X_all[split_pos:], y_all[split_pos:]
    val_indices = indices[split_pos:]

    rf_val = RandomForestRegressor(
        n_estimators=100,
        max_depth=6,
        min_samples_leaf=2,
        random_state=42,
    )
    rf_val.fit(X_train, y_train)
    rf_preds = [max(0.0, float(p)) for p in rf_val.predict(X_val)]

    baseline_preds = [_weekday_average_prior(dates, values, idx) for idx in val_indices]

    rf_mae, rf_rmse = _compute_metrics(y_val, rf_preds)
    base_mae, base_rmse = _compute_metrics(y_val, baseline_preds)

    rf_wins = rf_mae <= base_mae and rf_rmse <= base_rmse
    selected = MODEL_RF if rf_wins else MODEL_BASELINE

    model_final: Optional[RandomForestRegressor] = None
    if rf_wins:
        model_final = RandomForestRegressor(
            n_estimators=100,
            max_depth=6,
            min_samples_leaf=2,
            random_state=42,
        )
        model_final.fit(X_all, y_all)

    return model_final, {
        "method": "chronological_holdout",
        "evaluated": True,
        "reason": None if rf_wins else "Random Forest did not outperform weekday-average baseline on holdout MAE/RMSE.",
        "holdoutDays": holdout_size,
        "rfMae": rf_mae,
        "rfRmse": rf_rmse,
        "baselineMae": base_mae,
        "baselineRmse": base_rmse,
        "selectedModel": selected,
    }


def predict_doctor_demand(
    *,
    doctor_id: str,
    as_of_date_str: Optional[str] = None,
    horizon_days: int = 7,
    window_days: int = DEFAULT_WINDOW_DAYS,
    history: list[dict[str, Any]],
) -> dict[str, Any]:
    """Predict daily net appointment demand for a single doctor over `horizon_days`."""
    parsed_as_of = _parse_ymd(as_of_date_str) if as_of_date_str else None
    as_of_date = parsed_as_of or date.today()

    daily_counts: dict[date, int] = {}
    invalid_points = 0

    for entry in history:
        if not isinstance(entry, dict):
            invalid_points += 1
            continue
        parsed_day = _parse_ymd(entry.get("date"))
        count = _to_non_negative_int(entry.get("count"))
        if parsed_day is None or count is None:
            invalid_points += 1
            continue
        if parsed_day >= as_of_date:
            continue
        daily_counts[parsed_day] = daily_counts.get(parsed_day, 0) + count

    window_end = as_of_date - timedelta(days=1)
    window_start = as_of_date - timedelta(days=window_days)
    in_window = {d: c for d, c in daily_counts.items() if window_start <= d <= window_end}
    observed_days = len(in_window)

    warnings: list[str] = []
    if invalid_points > 0:
        warnings.append(f"Ignored {invalid_points} invalid historical record(s).")

    if observed_days < MIN_HISTORY_DAYS:
        return {
            "doctorId": str(doctor_id),
            "asOfDate": as_of_date.isoformat(),
            "horizonDays": horizon_days,
            "predictionStatus": "insufficient_data",
            "modelUsed": MODEL_BASELINE,
            "modelLabel": LABEL_BASELINE,
            "roundingMethod": "round_non_negative_int",
            "historicalAvailabilityStatus": "unknown",
            "validation": None,
            "dailyPredictions": [],
            "message": f"Insufficient historical appointment data (at least {MIN_HISTORY_DAYS} days required, got {observed_days}).",
            "dataQuality": {
                "windowDays": window_days,
                "daysObserved": observed_days,
                "missingDaysFilled": 0,
                "invalidPointsIgnored": invalid_points,
                "warnings": warnings,
            },
        }

    earliest_day = min(in_window.keys())
    span_days = min(window_days, max((window_end - earliest_day).days + 1, observed_days))
    series_start = window_end - timedelta(days=span_days - 1)
    dates = [series_start + timedelta(days=i) for i in range(span_days)]
    values = [float(in_window.get(d, 0)) for d in dates]

    missing_days_filled = max(0, span_days - observed_days)
    if missing_days_filled > 0:
        warnings.append(f"Filled {missing_days_filled} missing historical date(s) with 0.")

    total_hist = sum(values)
    if total_hist == 0:
        warnings.append("No historical Scheduled/Completed appointments observed in window.")
        rf_model = None
        validation = {
            "method": "chronological_holdout",
            "evaluated": False,
            "reason": "Zero historical appointment demand in window.",
            "holdoutDays": 0,
            "rfMae": None,
            "rfRmse": None,
            "baselineMae": None,
            "baselineRmse": None,
            "selectedModel": MODEL_BASELINE,
        }
    else:
        rf_model, validation = _train_and_validate_rf(dates, values)

    use_rf = rf_model is not None
    model_used = MODEL_RF if use_rf else MODEL_BASELINE
    model_label = LABEL_RF if use_rf else LABEL_BASELINE

    daily_predictions: list[dict[str, Any]] = []
    if use_rf:
        ext_dates = list(dates)
        ext_values = list(values)
        for step in range(horizon_days):
            f_date = as_of_date + timedelta(days=step)
            ext_dates.append(f_date)
            idx = len(ext_values)
            feats = build_demand_features_for_index(ext_dates, ext_values, idx)
            raw_float = max(0.0, float(rf_model.predict([feats])[0]))
            raw_int = int(round(raw_float))
            ext_values.append(raw_float)
            daily_predictions.append({
                "date": f_date.isoformat(),
                "rawPredictedDemand": raw_int,
                "rawPredictedFloat": round(raw_float, 2),
            })
    else:
        # Weekday-average baseline over historical series
        wd_buckets: dict[int, list[float]] = {wd: [] for wd in range(7)}
        for d, v in zip(dates, values):
            wd_buckets[d.weekday()].append(v)
        overall_mean = total_hist / float(len(values)) if values else 0.0

        for step in range(horizon_days):
            f_date = as_of_date + timedelta(days=step)
            bucket = wd_buckets[f_date.weekday()]
            raw_float = max(0.0, (sum(bucket) / float(len(bucket))) if bucket else overall_mean)
            raw_int = int(round(raw_float))
            daily_predictions.append({
                "date": f_date.isoformat(),
                "rawPredictedDemand": raw_int,
                "rawPredictedFloat": round(raw_float, 2),
            })

    return {
        "doctorId": str(doctor_id),
        "asOfDate": as_of_date.isoformat(),
        "horizonDays": horizon_days,
        "predictionStatus": "ok",
        "modelUsed": model_used,
        "modelLabel": model_label,
        "roundingMethod": "round_non_negative_int",
        "historicalAvailabilityStatus": "unknown",
        "validation": validation,
        "dailyPredictions": daily_predictions,
        "message": None,
        "dataQuality": {
            "windowDays": span_days,
            "daysObserved": observed_days,
            "missingDaysFilled": missing_days_filled,
            "invalidPointsIgnored": invalid_points,
            "warnings": warnings,
        },
    }

