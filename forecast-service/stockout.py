"""Statistical Moving Average Daily Consumption forecasting for medicine stock-out."""

from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any, Optional

DEFAULT_WINDOW_DAYS = 30
MIN_HISTORY_DAYS = 7
MODEL_USED = "moving_average_30d"
METHOD_TYPE = "statistical_moving_average"


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


def predict_medicine_stockout(
    item: dict[str, Any],
    *,
    as_of_date: date,
    horizon_days: int = 30,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> dict[str, Any]:
    """Predict stock-out metrics for a single medicine batch using a statistical moving average."""
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
        # Exclude today's incomplete day or future dates if passed inadvertently
        if parsed_day >= as_of_date:
            continue
        daily_totals[parsed_day] = daily_totals.get(parsed_day, 0.0) + qty

    if invalid_points > 0:
        warnings.append(f"Ignored {invalid_points} invalid historical record(s).")

    # Build the complete historical window ending yesterday (as_of_date - 1)
    window_end = as_of_date - timedelta(days=1)
    window_start = as_of_date - timedelta(days=window_days)

    # Filter to points inside [window_start, window_end]
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
            "modelUsed": MODEL_USED,
            "methodType": METHOD_TYPE,
            "estimatedDailyConsumption": None,
            "estimatedDaysUntilStockOut": 0.0 if current_stock <= 0 else None,
            "estimatedStockOutDate": as_of_date.isoformat() if current_stock <= 0 else None,
            "daysUntilReorderThreshold": 0.0 if current_stock <= reorder_level else None,
            "riskLevel": risk,
            "message": f"Insufficient historical dispensing data (at least {MIN_HISTORY_DAYS} days required).",
            "dataQuality": {
                "windowDays": window_days,
                "daysObserved": observed_days_provided,
                "missingDaysFilled": 0,
                "invalidPointsIgnored": invalid_points,
                "warnings": warnings,
            },
        }

    # Fill any missing calendar dates inside the span [earliest_in_window .. window_end] with 0
    earliest_day = min(in_window.keys())
    span_days = (window_end - earliest_day).days + 1
    effective_days = min(window_days, max(span_days, observed_days_provided))
    missing_days_filled = max(0, effective_days - observed_days_provided)
    if missing_days_filled > 0:
        warnings.append(f"Filled {missing_days_filled} missing historical date(s) with 0 consumption.")

    total_consumed = sum(in_window.values())
    estimated_daily = round(total_consumed / effective_days, 4)

    if total_consumed == 0:
        warnings.append("No dispensing activity observed in the historical window.")

    if current_stock <= 0:
        days_until_stockout: Optional[float] = 0.0
        stockout_date: Optional[str] = as_of_date.isoformat()
        days_until_reorder: Optional[float] = 0.0
    elif estimated_daily <= 0:
        days_until_stockout = None
        stockout_date = None
        days_until_reorder = 0.0 if current_stock <= reorder_level else None
    else:
        days_until_stockout = round(current_stock / estimated_daily, 1)
        stockout_date = (as_of_date + timedelta(days=math.ceil(days_until_stockout))).isoformat()
        if current_stock <= reorder_level:
            days_until_reorder = 0.0
        else:
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
        "modelUsed": MODEL_USED,
        "methodType": METHOD_TYPE,
        "estimatedDailyConsumption": estimated_daily,
        "estimatedDaysUntilStockOut": days_until_stockout,
        "estimatedStockOutDate": stockout_date,
        "daysUntilReorderThreshold": days_until_reorder,
        "riskLevel": risk_level,
        "message": None,
        "dataQuality": {
            "windowDays": effective_days,
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
    """Run moving-average stock-out predictions for a batch of medicines."""
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

    return {
        "asOfDate": as_of_date.isoformat(),
        "horizonDays": horizon_days,
        "windowDays": window_days,
        "modelUsed": MODEL_USED,
        "methodType": METHOD_TYPE,
        "predictions": predictions,
    }

