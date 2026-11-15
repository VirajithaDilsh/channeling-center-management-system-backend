import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from appointment_demand import (  # noqa: E402
    build_demand_features_for_index,
    predict_doctor_demand,
)


def make_history(as_of: date, counts: list[int]) -> list[dict]:
    n = len(counts)
    start = as_of - timedelta(days=n)
    return [
        {"date": (start + timedelta(days=i)).isoformat(), "count": c}
        for i, c in enumerate(counts)
    ]


class TestAppointmentDemand(unittest.TestCase):
    def setUp(self):
        self.as_of = date(2026, 11, 15)

    def test_feature_engineering_no_future_leakage(self):
        start = self.as_of - timedelta(days=30)
        dates = [start + timedelta(days=i) for i in range(30)]
        values_a = [float(i % 7 + 1) for i in range(30)]
        values_b = list(values_a)
        values_b[20] = 999.0
        values_b[28] = 888.0

        self.assertEqual(
            build_demand_features_for_index(dates, values_a, 20),
            build_demand_features_for_index(dates, values_b, 20),
        )

    def test_random_forest_and_7_14_horizons(self):
        start = self.as_of - timedelta(days=90)
        # Non-linear trend + weekday pattern over 90 days
        counts = [
            int(2 + (i // 15) + (6 if (start + timedelta(days=i)).weekday() in (0, 2, 4) else 0))
            for i in range(90)
        ]
        res7 = predict_doctor_demand(
            doctor_id="doc-1",
            as_of_date_str="2026-11-15",
            horizon_days=7,
            window_days=90,
            history=make_history(self.as_of, counts),
        )
        res14 = predict_doctor_demand(
            doctor_id="doc-1",
            as_of_date_str="2026-11-15",
            horizon_days=14,
            window_days=90,
            history=make_history(self.as_of, counts),
        )
        self.assertEqual(res7["predictionStatus"], "ok")
        self.assertEqual(len(res7["dailyPredictions"]), 7)
        self.assertEqual(len(res14["dailyPredictions"]), 14)
        self.assertEqual(res7["historicalAvailabilityStatus"], "unknown")
        self.assertTrue(res7["validation"]["evaluated"])
        for pt in res14["dailyPredictions"]:
            self.assertIsInstance(pt["rawPredictedDemand"], int)
            self.assertGreaterEqual(pt["rawPredictedDemand"], 0)

    def test_fallback_to_weekday_baseline_when_short_history(self):
        # 21 days: >= 14 min history, < 35 RF min days -> Baseline Fallback
        res = predict_doctor_demand(
            doctor_id="doc-short",
            as_of_date_str="2026-11-15",
            horizon_days=7,
            window_days=90,
            history=make_history(self.as_of, [4] * 21),
        )
        self.assertEqual(res["predictionStatus"], "ok")
        self.assertEqual(res["modelUsed"], "weekday_average_baseline")
        self.assertEqual(res["modelLabel"], "Baseline Fallback")
        self.assertFalse(res["validation"]["evaluated"])
        self.assertTrue(all(p["rawPredictedDemand"] == 4 for p in res["dailyPredictions"]))

    def test_insufficient_history(self):
        res = predict_doctor_demand(
            doctor_id="doc-tiny",
            as_of_date_str="2026-11-15",
            horizon_days=7,
            window_days=90,
            history=make_history(self.as_of, [3] * 8),
        )
        self.assertEqual(res["predictionStatus"], "insufficient_data")
        self.assertEqual(res["dailyPredictions"], [])

    def test_zero_demand_history(self):
        res = predict_doctor_demand(
            doctor_id="doc-zero",
            as_of_date_str="2026-11-15",
            horizon_days=7,
            window_days=90,
            history=make_history(self.as_of, [0] * 30),
        )
        self.assertEqual(res["predictionStatus"], "ok")
        self.assertEqual(res["modelUsed"], "weekday_average_baseline")
        self.assertTrue(all(p["rawPredictedDemand"] == 0 for p in res["dailyPredictions"]))


if __name__ == "__main__":
    unittest.main()

