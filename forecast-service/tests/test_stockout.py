import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from stockout import predict_medicine_stockout, predict_stockout_batch  # noqa: E402


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

    def test_moving_average_and_reorder_threshold(self):
        # 30 days of 5 units/day -> daily=5.0; stock=50, reorder=20
        # daysUntilStockOut = 10.0, daysUntilReorderThreshold = 6.0, risk=HIGH
        result = predict_medicine_stockout(
            {
                "medicineId": "med-1",
                "currentStock": 50,
                "reorderLevel": 20,
                "isExpired": False,
                "history": make_history(self.as_of, [5] * 30),
            },
            as_of_date=self.as_of,
            horizon_days=30,
        )
        self.assertEqual(result["predictionStatus"], "ok")
        self.assertEqual(result["modelUsed"], "moving_average_30d")
        self.assertEqual(result["methodType"], "statistical_moving_average")
        self.assertEqual(result["estimatedDailyConsumption"], 5.0)
        self.assertEqual(result["estimatedDaysUntilStockOut"], 10.0)
        self.assertEqual(result["estimatedStockOutDate"], "2026-11-24")
        self.assertEqual(result["daysUntilReorderThreshold"], 6.0)
        self.assertEqual(result["riskLevel"], "HIGH")

    def test_zero_consumption_days_included(self):
        # 30 days: 15 days of 4 units, 15 days of 0 units -> avg = 2.0/day
        history = make_history(self.as_of, [4 if i % 2 == 0 else 0 for i in range(30)])
        result = predict_medicine_stockout(
            {
                "medicineId": "med-zero-days",
                "currentStock": 100,
                "reorderLevel": 10,
                "isExpired": False,
                "history": history,
            },
            as_of_date=self.as_of,
        )
        self.assertEqual(result["predictionStatus"], "ok")
        self.assertEqual(result["estimatedDailyConsumption"], 2.0)
        self.assertEqual(result["estimatedDaysUntilStockOut"], 50.0)
        self.assertEqual(result["riskLevel"], "LOW")

    def test_zero_observed_consumption(self):
        result = predict_medicine_stockout(
            {
                "medicineId": "med-no-usage",
                "currentStock": 40,
                "reorderLevel": 10,
                "isExpired": False,
                "history": make_history(self.as_of, [0] * 30),
            },
            as_of_date=self.as_of,
        )
        self.assertEqual(result["predictionStatus"], "ok")
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
        )
        self.assertEqual(result["predictionStatus"], "insufficient_data")
        self.assertIsNone(result["estimatedDailyConsumption"])
        self.assertIsNone(result["estimatedDaysUntilStockOut"])
        self.assertIsNone(result["estimatedStockOutDate"])

    def test_zero_stock_is_critical(self):
        result = predict_medicine_stockout(
            {
                "medicineId": "med-oos",
                "currentStock": 0,
                "reorderLevel": 10,
                "isExpired": False,
                "history": make_history(self.as_of, [3] * 30),
            },
            as_of_date=self.as_of,
        )
        self.assertEqual(result["predictionStatus"], "ok")
        self.assertEqual(result["estimatedDaysUntilStockOut"], 0.0)
        self.assertEqual(result["estimatedStockOutDate"], "2026-11-14")
        self.assertEqual(result["daysUntilReorderThreshold"], 0.0)
        self.assertEqual(result["riskLevel"], "CRITICAL")

    def test_expired_medicine_is_critical_with_warning(self):
        result = predict_medicine_stockout(
            {
                "medicineId": "med-exp",
                "currentStock": 500,
                "reorderLevel": 10,
                "isExpired": True,
                "history": make_history(self.as_of, [1] * 30),
            },
            as_of_date=self.as_of,
        )
        self.assertEqual(result["riskLevel"], "CRITICAL")
        self.assertTrue(result["isExpired"])
        self.assertTrue(any("expired" in w.lower() for w in result["dataQuality"]["warnings"]))

    def test_missing_dates_and_invalid_quantities_handled(self):
        # 10 valid dates spread across a 12-day span (2 missing days filled with 0) + invalid entries
        history = [
            {"date": (self.as_of - timedelta(days=12)).isoformat(), "qty": 12},
            {"date": (self.as_of - timedelta(days=10)).isoformat(), "qty": 12},
            {"date": (self.as_of - timedelta(days=8)).isoformat(), "qty": 12},
            {"date": (self.as_of - timedelta(days=7)).isoformat(), "qty": 12},
            {"date": (self.as_of - timedelta(days=6)).isoformat(), "qty": 12},
            {"date": (self.as_of - timedelta(days=5)).isoformat(), "qty": 0},
            {"date": (self.as_of - timedelta(days=4)).isoformat(), "qty": 0},
            {"date": (self.as_of - timedelta(days=3)).isoformat(), "qty": 0},
            {"date": (self.as_of - timedelta(days=2)).isoformat(), "qty": 0},
            {"date": (self.as_of - timedelta(days=1)).isoformat(), "qty": 0},
            {"date": "not-a-date", "qty": 5},
            {"date": (self.as_of - timedelta(days=1)).isoformat(), "qty": -99},
            {"date": self.as_of.isoformat(), "qty": 999},  # today excluded
        ]
        result = predict_medicine_stockout(
            {
                "medicineId": "med-dirty",
                "currentStock": 50,
                "reorderLevel": 10,
                "isExpired": False,
                "history": history,
            },
            as_of_date=self.as_of,
        )
        self.assertEqual(result["predictionStatus"], "ok")
        self.assertEqual(result["dataQuality"]["invalidPointsIgnored"], 2)
        self.assertEqual(result["dataQuality"]["missingDaysFilled"], 2)
        # Total = 60 over 12-day span -> 5.0/day
        self.assertEqual(result["estimatedDailyConsumption"], 5.0)

    def test_batch_keeps_batches_separate(self):
        batch = predict_stockout_batch(
            [
                {
                    "medicineId": "batch-a",
                    "currentStock": 20,
                    "reorderLevel": 5,
                    "isExpired": False,
                    "history": make_history(self.as_of, [4] * 30),
                },
                {
                    "medicineId": "batch-b",
                    "currentStock": 200,
                    "reorderLevel": 10,
                    "isExpired": False,
                    "history": make_history(self.as_of, [2] * 30),
                },
            ],
            horizon_days=14,
            as_of_date_str="2026-11-14",
        )
        self.assertEqual(len(batch["predictions"]), 2)
        self.assertEqual(batch["predictions"][0]["medicineId"], "batch-a")
        self.assertEqual(batch["predictions"][0]["riskLevel"], "CRITICAL")
        self.assertEqual(batch["predictions"][1]["medicineId"], "batch-b")
        self.assertEqual(batch["predictions"][1]["riskLevel"], "LOW")


if __name__ == "__main__":
    unittest.main()

