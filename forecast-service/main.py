import hmac
import os
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from forecasting import forecast

app = FastAPI(title="Revenue forecast service", docs_url=None, redoc_url=None)

API_KEY = os.environ.get("FORECAST_API_KEY", "")


def check_key(x_api_key: Optional[str] = Header(default=None)):
    # Fail closed: the service refuses to run unauthenticated unless explicitly opted out for local dev.
    if not API_KEY:
        if os.environ.get("FORECAST_ALLOW_NO_AUTH") == "1":
            return
        raise HTTPException(503, "Service not configured: set FORECAST_API_KEY")
    if not x_api_key or not hmac.compare_digest(x_api_key, API_KEY):
        raise HTTPException(401, "Invalid API key")


class Point(BaseModel):
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    value: float = Field(ge=-1e12, le=1e12)


class ForecastRequest(BaseModel):
    points: list[Point] = Field(max_length=120)
    horizon: int = Field(default=1, ge=1, le=3)
    currentMonth: Optional[str] = Field(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$")

    @field_validator("points")
    @classmethod
    def unique_months(cls, v):
        if len({p.month for p in v}) != len(v):
            raise ValueError("duplicate months")
        return v


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/forecast", dependencies=[Depends(check_key)])
def post_forecast(req: ForecastRequest):
    return forecast([p.model_dump() for p in req.points], req.horizon, req.currentMonth)
