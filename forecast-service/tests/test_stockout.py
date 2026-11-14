import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from stockout import (  # noqa: E402
    build_features_for_index,
    predict_medicine_stockout,
    predict_stockout_batch,
)


def make_history(as_of: date, values: list[float]) -> list[dict]:
    """Builds daily history ending yesterday (as_of - 1)."""
    n = len(values)
    start = as_of - timedelta(days=n)
    return [
        {"date": (start + timedelta(days=i)).isoformat(), "qty": v}
        for i, v in enumerate(values)
    ]


class TestStockoutPrediction(unittest.TestCase):
    def setUp(self):
        self.as_of = date(2026, 11, 14)

    def test_feature_engineering_no_future_leakage(self):
        start = self.as_of - timedelta(days=30)
        dates = [start + timedelta(days=i) for i in range(30)]
        values_a = [float(i + 1) for i in range(30)]
        values_b = list(values_a)
        # Mutate target day and future days; features at idx=20 must stay identical
        values_b[20] = 9999.0
        values_b[25] = 8888.0

        feats_a = build_features_for_index(dates, values_a, 20)
        feats_b = build_features_for_index(dates, values_b, 20)
        self.assertEqual(feats_a, feats_b)
        self.assertEqual(len(feats_a), 9)

    def test_random_forest_selected_on_weekly_pattern_with_90_days(self):
        # Strong day-of-week seasonality over 90 days: RF captures weekday pattern better than 30d flat MA
        start = self.as_of - timedelta(days=90)
        pattern = [10.0, 2.0, 2.0, 12.0, 2.0, 18.0, 0.0]
        values = [pattern[(start + timedelta(days=i)).weekday()] for i in range(90)]
        result = predict_medicine_stockout(
            {
                "medicineId": "med-rf",
                "currentStock": 80,
                "reorderLevel": 20,
                "isExpired": False,
                "history": make_history(self.as_of, values),
            },
            as_of_date=self.as_of,
            horizon_days=14,
            window_days=90,
        )
        self.assertEqual(result["predictionStatus"], "ok")
        self.assertEqual(result["modelUsed"], "random_forest")
        self.assertEqual(result["modelLabel"], "Random Forest Regression (ML)")
        self.assertTrue(result["validation"]["evaluated"])
        self.assertLessEqual(result["validation"]["rfMae"], result["validation"]["baselineMae"])
        self.assertLessEqual(result["validation"]["rfRmse"], result["validation"]["baselineRmse"])
        self.assertEqual(len(result["dailyForecast"]), 14)
        self.assertIsNotNone(result["estimatedStockOutDate"])

    def test_fallback_to_moving_average_when_below_35_days(self):
        # 25 days is enough for MA (>=7) but below MIN_RF_TOTAL_DAYS (35)
        result = predict_medicine_stockout(
            {
                "medicineId": "med-ma-short",
                "currentStock": 50,
                "reorderLevel": 20,
                "isExpired": False,
                "history": make_history(self.as_of, [5] * 25),
            },
            as_of_date=self.as_of,
            horizon_days=30,
            window_days=90,
        )
        self.assertEqual(result["predictionStatus"], "ok")
        self.assertEqual(result["modelUsed"], "moving_average")
        self.assertEqual(result["modelLabel"], "Moving Average (Fallback)")
        self.assertFalse(result["validation"]["evaluated"])
        self.assertEqual(result["estimatedDailyConsumption"], 5.0)
        self.assertEqual(result["estimatedDaysUntilStockOut"], 10.0)
        # Forecast starts on as_of_date (2026-11-14); 10 days of 5/day reaches 0 on 2026-11-23
        self.assertEqual(result["estimatedStockOutDate"], "2026-11-23")
        self.assertEqual(result["daysUntilReorderThreshold"], 6.0)
        self.assertEqual(result["riskLevel"], "HIGH")
        self.assertEqual(len(result["dailyForecast"]), 30)
        first_zero = next(
            (pt for pt in result["dailyForecast"] if pt["predictedRemainingStock"] <= 0),
            None,
        )
        self.assertIsNotNone(first_zero)
        self.assertEqual(first_zero["date"], result["estimatedStockOutDate"])

    def test_beyond_horizon_does_not_invent_stockout_date(self):
        result = predict_medicine_stockout(
            {
                "medicineId": "med-beyond",
                "currentStock": 200,
                "reorderLevel": 10,
                "isExpired": False,
                "history": make_history(self.as_of, [2] * 30),
            },
            as_of_date=self.as_of,
            horizon_days=14,
            window_days=90,
        )
        self.assertEqual(result["predictionStatus"], "ok")
        self.assertIsNone(result["estimatedStockOutDate"])
        self.assertEqual(result["estimatedDaysUntilStockOut"], 100.0)
        self.assertEqual(result["riskLevel"], "LOW")

    def test_zero_observed_consumption(self):
        result = predict_medicine_stockout(
            {
                "medicineId": "med-no-usage",
                "currentStock": 40,
                "reorderLevel": 10,
                "isExpired": False,
                "history": make_history(self.as_of, [0] * 40),
            },
            as_of_date=self.as_of,
            window_days=90,
        )
        self.assertEqual(result["predictionStatus"], "ok")
        self.assertEqual(result["modelUsed"], "moving_average")
        self.assertEqual(result["estimatedDailyConsumption"], 0.0)
        self.assertIsNone(result["estimatedDaysUntilStockOut"])
        self.assertIsNone(result["estimatedStockOutDate"])
        self.assertIsNone(result["daysUntilReorderThreshold"])
        self.assertEqual(result["riskLevel"], "LOW")

    def test_insufficient_data_returns_no_prediction(self):
        result = predict_medicine_stockout(
            {
                "medicineId": "med-short",
                "currentStock": 50,
                "reorderLevel": 10,
                "isExpired": False,
                "history": make_history(self.as_of, [5, 5, 5]),
            },
            as_of_date=self.as_of,
            window_days=90,
        )
        self.assertEqual(result["predictionStatus"], "insufficient_data")
        self.assertIsNone(result["estimatedDailyConsumption"])
        self.assertIsNone(result["estimatedDaysUntilStockOut"])
        self.assertIsNone(result["estimatedStockOutDate"])
        self.assertEqual(result["dailyForecast"], [])

    def test_zero_stock_and_expired_handling(self):
        oos = predict_medicine_stockout(
            {
                "medicineId": "med-oos",
                "currentStock": 0,
                "reorderLevel": 10,
                "isExpired": False,
                "history": make_history(self.as_of, [3] * 20),
            },
            as_of_date=self.as_of,
            window_days=90,
        )
        self.assertEqual(oos["estimatedDaysUntilStockOut"], 0.0)
        self.assertEqual(oos["estimatedStockOutDate"], "2026-11-14")
        self.assertEqual(oos["riskLevel"], "CRITICAL")

        exp = predict_medicine_stockout(
            {
                "medicineId": "med-exp",
                "currentStock": 500,
                "reorderLevel": 10,
                "isExpired": True,
                "history": make_history(self.as_of, [1] * 20),
            },
            as_of_date=self.as_of,
            window_days=90,
        )
        self.assertEqual(exp["riskLevel"], "CRITICAL")
        self.assertTrue(any("expired" in w.lower() for w in exp["dataQuality"]["warnings"]))

    def test_batch_keeps_batches_separate(self):
        batch = predict_stockout_batch(
            [
                {
                    "medicineId": "batch-a",
                    "currentStock": 20,
                    "reorderLevel": 5,
                    "isExpired": False,
                    "history": make_history(self.as_of, [4] * 20),
                },
                {
                    "medicineId": "batch-b",
                    "currentStock": 200,
                    "reorderLevel": 10,
                    "isExpired": False,
                    "history": make_history(self.as_of, [2] * 20),
                },
            ],
            horizon_days=14,
            as_of_date_str="2026-11-14",
            window_days=90,
        )
        self.assertEqual(len(batch["predictions"]), 2)
        self.assertEqual(batch["predictions"][0]["medicineId"], "batch-a")
        self.assertEqual(batch["predictions"][1]["medicineId"], "batch-b")


if __name__ == "__main__":
    unittest.main()
