# Forecast service

Small FastAPI app that forecasts monthly revenue. It receives a monthly series from the Node API and never connects to the database.

- `POST /forecast` (header `X-API-Key`) body `{ "points": [{"month":"2026-01","value":1000}], "horizon": 1|3, "currentMonth": "2026-10" }`
- `GET /health`
- Models compared by chronological backtest: last value (baseline), 3-month average, linear trend, ridge on lags, last year's same month. Lowest backtest error wins; ties go to the simpler model.
- Refuses with `insufficient_data` below 6 complete months (12 for `horizon` 3).

Run and test: see `docs/AI-FEATURES.md` ("Local setup"). Tests: `.venv/bin/python -m pytest`.
