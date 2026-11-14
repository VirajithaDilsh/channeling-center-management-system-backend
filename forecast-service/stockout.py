"""Random Forest Regression & Moving Average fallback forecasting for medicine stock-out."""

from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any, Optional

import numpy as np
from sklearn.ensemble import RandomForestRegressor

DEFAULT_WINDOW_DAYS = 90
MIN_HISTORY_DAYS = 7
FEATURE_LAG_START = 14
MIN_RF_TOTAL_DAYS = 35  # 14 lag days + >= 14 train days + >= 7 holdout days
MA_BASELINE_WINDOW = 30

MODEL_RF = "random_forest"
MODEL_MA = "moving_average"
LABEL_RF = "Random Forest Regression (ML)"
LABEL_MA = "Moving Average (Fallback)"


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


def _to_non_negative_float(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num) or num < 0:
        return None
    return num


def _classify_risk(
    *,
    current_stock: float,
    reorder_level: float,
    is_expired: bool,
    days_until_stockout: Optional[float],
) -> str:
    if is_expired or current_stock <= 0:
        return "CRITICAL"
    if days_until_stockout is not None and days_until_stockout <= 7:
        return "CRITICAL"
    if (days_until_stockout is not None and days_until_stockout <= 14) or (
        reorder_level > 0 and current_stock <= reorder_level
    ):
        return "HIGH"
    if days_until_stockout is not None and days_until_stockout <= 30:
        return "MEDIUM"
    return "LOW"


def build_features_for_index(
    dates: list[date],
    values: list[float],
    idx: int,
) -> list[float]:
    """
    Build time-series features for target index `idx` using ONLY values strictly
    before `idx` (indices < idx), preventing any future data leakage.
    Requires `idx >= FEATURE_LAG_START` (14).
    """
    if idx < FEATURE_LAG_START:
        raise ValueError(f"idx ({idx}) must be >= {FEATURE_LAG_START}")

    target_date = dates[idx]
    day_of_week = float(target_date.weekday())
    day_of_month = float(target_date.day)

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
        day_of_month,
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


def _train_and_validate_rf(
    dates: list[date],
    values: list[float],
) -> tuple[Optional[RandomForestRegressor], dict[str, Any]]:
    """
    Chronologically split supervised rows into train + holdout, compare
    RandomForestRegressor against the 30-day Moving Average baseline using
    MAE and RMSE, and select RF only when it matches or beats the baseline.
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
            "selectedModel": MODEL_MA,
        }

    indices = list(range(FEATURE_LAG_START, n))
    X_all = [build_features_for_index(dates, values, idx) for idx in indices]
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

    # Chronological Moving Average baseline on the exact same holdout days
    ma_preds = []
    for idx in val_indices:
        start = max(0, idx - MA_BASELINE_WINDOW)
        ma_preds.append(sum(values[start:idx]) / float(idx - start))

    rf_mae, rf_rmse = _compute_metrics(y_val, rf_preds)
    ma_mae, ma_rmse = _compute_metrics(y_val, ma_preds)

    rf_wins = rf_mae <= ma_mae and rf_rmse <= ma_rmse
    selected = MODEL_RF if rf_wins else MODEL_MA

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
        "reason": None if rf_wins else "Random Forest did not outperform Moving Average baseline on holdout MAE/RMSE.",
        "holdoutDays": holdout_size,
        "rfMae": rf_mae,
        "rfRmse": rf_rmse,
        "baselineMae": ma_mae,
        "baselineRmse": ma_rmse,
        "selectedModel": selected,
    }


def predict_medicine_stockout(
    item: dict[str, Any],
    *,
    as_of_date: date,
    horizon_days: int = 30,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> dict[str, Any]:
    """Predict daily medicine consumption and stock-out metrics for one batch."""
    medicine_id = str(item.get("medicineId", ""))
    raw_stock = _to_non_negative_float(item.get("currentStock"))
    current_stock = raw_stock if raw_stock is not None else 0.0
    raw_reorder = _to_non_negative_float(item.get("reorderLevel"))
    reorder_level = raw_reorder if raw_reorder is not None else 0.0
    is_expired = bool(item.get("isExpired", False))

    warnings: list[str] = []
    if is_expired:
        warnings.append("This batch is expired and cannot be dispensed.")

    history = item.get("history") or []
    daily_totals: dict[date, float] = {}
    invalid_points = 0

    for entry in history:
        if not isinstance(entry, dict):
            invalid_points += 1
            continue
        parsed_day = _parse_ymd(entry.get("date"))
        qty = _to_non_negative_float(entry.get("qty"))
        if parsed_day is None or qty is None:
            invalid_points += 1
            continue
        # Exclude today's incomplete day or future dates
        if parsed_day >= as_of_date:
            continue
        daily_totals[parsed_day] = daily_totals.get(parsed_day, 0.0) + qty

    if invalid_points > 0:
        warnings.append(f"Ignored {invalid_points} invalid historical record(s).")

    window_end = as_of_date - timedelta(days=1)
    window_start = as_of_date - timedelta(days=window_days)
    in_window = {d: q for d, q in daily_totals.items() if window_start <= d <= window_end}
    observed_days_provided = len(in_window)

    if observed_days_provided < MIN_HISTORY_DAYS:
        risk = "CRITICAL" if (is_expired or current_stock <= 0) else (
            "HIGH" if (reorder_level > 0 and current_stock <= reorder_level) else None
        )
        return {
            "medicineId": medicine_id,
            "currentStock": round(current_stock, 2),
            "reorderLevel": round(reorder_level, 2),
            "isExpired": is_expired,
            "predictionStatus": "insufficient_data",
            "modelUsed": MODEL_MA,
            "modelLabel": LABEL_MA,
            "methodType": "statistical_moving_average",
            "estimatedDailyConsumption": None,
            "estimatedDaysUntilStockOut": 0.0 if current_stock <= 0 else None,
            "estimatedStockOutDate": as_of_date.isoformat() if current_stock <= 0 else None,
            "daysUntilReorderThreshold": 0.0 if current_stock <= reorder_level else None,
            "riskLevel": risk,
            "dailyForecast": [],
            "validation": None,
            "message": f"Insufficient historical dispensing data (at least {MIN_HISTORY_DAYS} days required).",
            "dataQuality": {
                "windowDays": window_days,
                "daysObserved": observed_days_provided,
                "missingDaysFilled": 0,
                "invalidPointsIgnored": invalid_points,
                "warnings": warnings,
            },
        }

    # Build contiguous daily series from earliest observed date in window to window_end
    earliest_day = min(in_window.keys())
    span_days = min(window_days, max((window_end - earliest_day).days + 1, observed_days_provided))
    series_start = window_end - timedelta(days=span_days - 1)
    dates = [series_start + timedelta(days=i) for i in range(span_days)]
    values = [float(in_window.get(d, 0.0)) for d in dates]

    missing_days_filled = max(0, span_days - observed_days_provided)
    if missing_days_filled > 0:
        warnings.append(f"Filled {missing_days_filled} missing historical date(s) with 0 consumption.")

    total_consumed = sum(values)
    if total_consumed == 0:
        warnings.append("No dispensing activity observed in the historical window.")
        rf_model = None
        validation = {
            "method": "chronological_holdout",
            "evaluated": False,
            "reason": "Zero observed consumption in historical window.",
            "holdoutDays": 0,
            "rfMae": None,
            "rfRmse": None,
            "baselineMae": None,
            "baselineRmse": None,
            "selectedModel": MODEL_MA,
        }
    else:
        rf_model, validation = _train_and_validate_rf(dates, values)

    use_rf = rf_model is not None
    model_used = MODEL_RF if use_rf else MODEL_MA
    model_label = LABEL_RF if use_rf else LABEL_MA
    method_type = "machine_learning_random_forest" if use_rf else "statistical_moving_average"

    # Generate multi-step daily consumption forecast for `horizon_days`
    future_consumptions: list[float] = []
    if use_rf:
        ext_dates = list(dates)
        ext_values = list(values)
        for step in range(horizon_days):
            f_date = as_of_date + timedelta(days=step)
            ext_dates.append(f_date)
            idx = len(ext_values)
            feats = build_features_for_index(ext_dates, ext_values, idx)
            pred = max(0.0, float(rf_model.predict([feats])[0]))
            pred = round(pred, 4)
            ext_values.append(pred)
            future_consumptions.append(pred)
    else:
        ma_window = min(len(values), MA_BASELINE_WINDOW)
        ma_rate = round(sum(values[-ma_window:]) / float(ma_window), 4)
        future_consumptions = [max(0.0, ma_rate) for _ in range(horizon_days)]

    estimated_daily = round(sum(future_consumptions) / float(horizon_days), 4)

    # Project remaining stock day-by-day (no replenishment assumed)
    daily_forecast: list[dict[str, Any]] = []
    remaining = float(current_stock)
    days_until_stockout: Optional[float] = None
    stockout_date: Optional[str] = None
    days_until_reorder: Optional[float] = 0.0 if current_stock <= reorder_level else None

    if current_stock <= 0:
        days_until_stockout = 0.0
        stockout_date = as_of_date.isoformat()
        days_until_reorder = 0.0

    for step, cons in enumerate(future_consumptions):
        f_date = as_of_date + timedelta(days=step)
        prev_remaining = remaining
        remaining = max(0.0, round(remaining - cons, 2))
        daily_forecast.append({
            "date": f_date.isoformat(),
            "predictedConsumption": round(cons, 4),
            "predictedRemainingStock": remaining,
        })

        if days_until_stockout is None and prev_remaining > 0 and remaining <= 0 and cons > 0:
            frac = prev_remaining / cons
            days_until_stockout = round(step + frac, 1)
            stockout_date = f_date.isoformat()

        if days_until_reorder is None and prev_remaining > reorder_level and remaining <= reorder_level and cons > 0:
            frac = (prev_remaining - reorder_level) / cons
            days_until_reorder = round(step + frac, 1)

    # If stock does not run out within the forecast horizon, do NOT invent a stockout date,
    # but still provide projected days remaining when average daily demand > 0 so the UI
    # can show "Beyond horizon" + projected days.
    if days_until_stockout is None and current_stock > 0 and estimated_daily > 0:
        days_until_stockout = round(current_stock / estimated_daily, 1)
        if days_until_reorder is None and current_stock > reorder_level:
            days_until_reorder = round((current_stock - reorder_level) / estimated_daily, 1)

    risk_level = _classify_risk(
        current_stock=current_stock,
        reorder_level=reorder_level,
        is_expired=is_expired,
        days_until_stockout=days_until_stockout,
    )

    return {
        "medicineId": medicine_id,
        "currentStock": round(current_stock, 2),
        "reorderLevel": round(reorder_level, 2),
        "isExpired": is_expired,
        "predictionStatus": "ok",
        "modelUsed": model_used,
        "modelLabel": model_label,
        "methodType": method_type,
        "estimatedDailyConsumption": estimated_daily,
        "estimatedDaysUntilStockOut": days_until_stockout,
        "estimatedStockOutDate": stockout_date,
        "daysUntilReorderThreshold": days_until_reorder,
        "riskLevel": risk_level,
        "dailyForecast": daily_forecast,
        "validation": validation,
        "message": None,
        "dataQuality": {
            "windowDays": span_days,
            "daysObserved": observed_days_provided,
            "missingDaysFilled": missing_days_filled,
            "invalidPointsIgnored": invalid_points,
            "horizonDays": horizon_days,
            "warnings": warnings,
        },
    }


def predict_stockout_batch(
    medicines: list[dict[str, Any]],
    *,
    horizon_days: int = 30,
    as_of_date_str: Optional[str] = None,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> dict[str, Any]:
    """Run stock-out predictions for a batch of medicines."""
    parsed_as_of = _parse_ymd(as_of_date_str) if as_of_date_str else None
    as_of_date = parsed_as_of or date.today()

    predictions = [
        predict_medicine_stockout(
            item,
            as_of_date=as_of_date,
            horizon_days=horizon_days,
            window_days=window_days,
        )
        for item in medicines
    ]

    rf_count = sum(1 for p in predictions if p.get("modelUsed") == MODEL_RF)
    batch_model = MODEL_RF if rf_count > 0 else MODEL_MA

    return {
        "asOfDate": as_of_date.isoformat(),
        "horizonDays": horizon_days,
        "windowDays": window_days,
        "modelUsed": batch_model,
        "methodType": "machine_learning_random_forest" if rf_count > 0 else "statistical_moving_average",
        "predictions": predictions,
    }
