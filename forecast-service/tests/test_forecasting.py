import os
import sys

import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from forecasting import forecast, prepare  # noqa: E402


def months(start_year, n):
    out = []
    for i in range(n):
        out.append(f"{start_year + i // 12}-{i % 12 + 1:02d}")
    return out


def pts(values, start_year=2024):
    return [{"month": m, "value": v} for m, v in zip(months(start_year, len(values)), values)]


def test_too_little_data_refuses():
    r = forecast(pts([100, 120, 130]), 1, None)
    assert r["status"] == "insufficient_data" and r["forecast"] == []
    assert "at least 6" in r["message"]


def test_three_month_needs_twelve():
    r = forecast(pts([100 + 5 * i for i in range(8)]), 3, None)
    assert r["status"] == "insufficient_data"
    assert forecast(pts([100 + 5 * i for i in range(8)]), 1, None)["status"] == "ok"


def test_linear_growth_picks_trend_model_and_beats_baseline():
    r = forecast(pts([1000 + 100 * i for i in range(18)]), 3, None)
    assert r["status"] == "ok"
    assert r["model"] in ("linear_trend", "ridge_lags")
    assert r["validation"]["beatsBaseline"] is True
    assert r["forecast"][0]["value"] == pytest.approx(1000 + 100 * 18, rel=0.02)
    assert r["forecast"][0]["month"] == "2025-07"


def test_seasonal_series_selects_seasonal_naive():
    base = [1000, 800, 900, 1200, 1500, 1100, 900, 950, 1300, 1600, 1000, 700]
    r = forecast(pts(base * 3), 1, None)
    assert r["model"] == "seasonal_naive"
    assert r["forecast"][0]["value"] == pytest.approx(base[0])


def test_partial_current_month_is_excluded():
    v = [1000 + 50 * i for i in range(10)]
    data = pts(v)
    cur = data[-1]["month"]
    data[-1]["value"] = 1  # incomplete month looks like a crash
    r = forecast(data, 1, cur)
    assert r["dataQuality"]["droppedPartialMonth"] is True
    assert r["dataQuality"]["monthsUsed"] == 9
    assert r["forecast"][0]["value"] > 1000


def test_gaps_filled_with_zero_and_flagged():
    data = pts([100, 110, 120, 130, 140, 150, 160, 170])
    del data[3]
    p = prepare(data, None)
    assert len(p.series) == 8 and p.series.iloc[3] == 0
    r = forecast(data, 1, None)
    assert r["dataQuality"]["zeroMonths"] == 1
    assert r["dataQuality"]["warnings"]


def test_leading_zero_months_trimmed():
    r = forecast(pts([0, 0, 0, 500, 520, 540, 560, 580, 600, 620]), 1, None)
    assert r["dataQuality"]["leadingZeroMonthsTrimmed"] == 3
    assert r["dataQuality"]["monthsUsed"] == 7


def test_outlier_flagged_not_removed():
    v = [1000, 1020, 990, 1010, 5000, 1005, 995, 1015]
    r = forecast(pts(v), 1, None)
    assert [o["value"] for o in r["dataQuality"]["outliers"]] == [5000.0]
    assert r["dataQuality"]["monthsUsed"] == 8


def test_forecast_never_negative():
    r = forecast(pts([1000 - 90 * i for i in range(11)]), 3, None)
    assert all(f["value"] >= 0 and f["lower"] >= 0 for f in r["forecast"])


def test_all_zero_series():
    assert forecast(pts([0] * 12), 1, None)["status"] == "insufficient_data"


# ---- API ----
def client(monkeypatch, key="secret"):
    import main
    monkeypatch.setattr(main, "API_KEY", key)
    return TestClient(main.app)


BODY = {"points": pts([1000 + 10 * i for i in range(10)]), "horizon": 1}


def test_api_requires_key(monkeypatch):
    c = client(monkeypatch)
    assert c.post("/forecast", json=BODY).status_code == 401
    assert c.post("/forecast", json=BODY, headers={"X-API-Key": "nope"}).status_code == 401
    assert c.post("/forecast", json=BODY, headers={"X-API-Key": "secret"}).status_code == 200


def test_api_fails_closed_without_key(monkeypatch):
    monkeypatch.delenv("FORECAST_ALLOW_NO_AUTH", raising=False)
    assert client(monkeypatch, key="").post("/forecast", json=BODY).status_code == 503


def test_api_validation(monkeypatch):
    c = client(monkeypatch)
    h = {"X-API-Key": "secret"}
    assert c.post("/forecast", json={**BODY, "horizon": 9}, headers=h).status_code == 422
    assert c.post("/forecast", json={"points": [{"month": "2024-13", "value": 1}]}, headers=h).status_code == 422
    dup = {"points": [{"month": "2024-01", "value": 1}] * 2}
    assert c.post("/forecast", json=dup, headers=h).status_code == 422
    assert c.get("/health").status_code == 200
