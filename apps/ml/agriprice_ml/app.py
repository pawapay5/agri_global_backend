"""ML service (internal network). Apps read stored forecasts; these endpoints are for ops and ad-hoc admin use.

  GET  /healthz
  GET  /models                 (service token)
  POST /train/{country}        (service token)
  POST /predict, POST /explain (admin JWT: the same HS256 access token the API issues, role=admin)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import threading
import time

import pandas as pd
import psycopg
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from . import HORIZONS, train
from .features import build_features
from .store import load_models, load_panel, production_version

app = FastAPI(title="AgriPrice ML", version="1.2.0")
_lock = threading.Lock()


def _dsn() -> str:
    return os.environ.get("DATABASE_URL", "postgresql://agriprice:agriprice@localhost:5432/agriprice")


def require_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.environ.get("ML_SERVICE_TOKEN")
    if not expected or not authorization or not hmac.compare_digest(authorization, f"Bearer {expected}"):
        raise HTTPException(status_code=401, detail="unauthorized")


def _b64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def verify_admin_jwt(token: str, secret: str, now: float | None = None) -> dict:
    """HS256 verification matching the API's access tokens (iss=agriprice, aud=agriprice-api, typ=at+jwt)."""
    try:
        h, p, sig = token.split(".")
        header, payload = json.loads(_b64(h)), json.loads(_b64(p))
    except Exception as e:
        raise HTTPException(status_code=401, detail="token_invalid") from e
    if header.get("alg") != "HS256":
        raise HTTPException(status_code=401, detail="token_invalid")
    expected = hmac.new(secret.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(expected, _b64(sig)):
        raise HTTPException(status_code=401, detail="token_invalid")
    now = now or time.time()
    aud = payload.get("aud")
    if payload.get("exp", 0) < now or payload.get("iss") != os.environ.get("JWT_ISSUER", "agriprice") or (aud != "agriprice-api" and "agriprice-api" not in (aud or [])):
        raise HTTPException(status_code=401, detail="token_invalid")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="admin_required")
    return payload


def require_admin(authorization: str | None = Header(default=None)) -> dict:
    secret = os.environ.get("JWT_ACCESS_SECRET")
    if not secret or not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="unauthorized")
    return verify_admin_jwt(authorization[7:], secret)


class SeriesRequest(BaseModel):
    country: str = Field(pattern=r"^[A-Z]{2}$")
    commodity_id: str
    market_id: str | None = None
    region_id: str | None = None
    price_type: str = Field(default="wholesale", pattern=r"^(retail|wholesale|farm_gate)$")


def _series_forecast(req: SeriesRequest, explain: bool) -> dict:
    if not (req.market_id or req.region_id):
        raise HTTPException(status_code=422, detail="market_id or region_id required")
    sid = f"m:{req.market_id}:{req.commodity_id}:{req.price_type}" if req.market_id else f"r:{req.region_id}:{req.commodity_id}:{req.price_type}"
    with psycopg.connect(_dsn()) as conn:
        version = production_version(conn, req.country)
        models = load_models(version) if version else None
        if not models:
            raise HTTPException(status_code=404, detail="no production model for this country")
        panel = load_panel(conn, req.country)
        with conn.cursor() as cur:
            cur.execute("""SELECT b.horizon_months, b.mape FROM backtest_metrics b JOIN model_versions m ON m.id = b.model_version_id
                           WHERE m.version = %s AND b.commodity_id = %s AND b.market_id IS NOT DISTINCT FROM %s::uuid AND b.region_id IS NOT DISTINCT FROM %s::uuid AND b.price_type = %s""",
                        (version, req.commodity_id, req.market_id, None if req.market_id else req.region_id, req.price_type))
            bm = pd.DataFrame([(sid, h, m) for h, m in cur.fetchall()], columns=["series_id", "horizon", "mape"])
    if panel.empty or sid not in set(panel["series_id"]):
        return {"status": "insufficient_data", "reasons": ["no_history"], "modelVersion": version}
    # Features need cross-sectional context (nearby spread), so build on the commodity's panel, then pick the series.
    commodity_code = panel.loc[panel["series_id"] == sid, "commodity_code"].iloc[0]
    feat = build_features(panel[panel["commodity_code"] == commodity_code])
    f = next(x for x in train.predict_series(feat[feat["series_id"] == sid], models, bm))
    out = {"status": f["status"], "reasons": f["suppression"].get("run", []), "modelVersion": version, "asOf": str(f["as_of"]), "latest": f["latest"],
           "historyWeeks": f["history_weeks"], "horizons": [{k: v for k, v in h.items() if explain or k not in ("features", "base")} for h in f["horizons"]],
           "suppressedHorizons": {k: v for k, v in f["suppression"].items() if k != "run"}}
    return out


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "horizons": list(HORIZONS)}


@app.get("/models", dependencies=[Depends(require_token)])
def models(limit: int = 20) -> list[dict]:
    with psycopg.connect(_dsn()) as conn, conn.cursor() as cur:
        cur.execute("SELECT id, version, status, metrics, model_card, trained_at FROM model_versions ORDER BY trained_at DESC LIMIT %s", (min(limit, 100),))
        return [{"id": str(r[0]), "version": r[1], "status": r[2], "metrics": r[3], "modelCard": r[4], "trainedAt": r[5].isoformat()} for r in cur.fetchall()]


@app.post("/train/{country}", dependencies=[Depends(require_token)])
def retrain(country: str, promote: str = "auto") -> dict:
    if promote not in ("auto", "always", "never"):
        raise HTTPException(status_code=422, detail="promote must be auto|always|never")
    if not _lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="training already running")
    try:
        return train.run(country.upper(), promote, _dsn())
    finally:
        _lock.release()


@app.post("/predict")
def predict(req: SeriesRequest, _: dict = Depends(require_admin)) -> dict:
    return _series_forecast(req, explain=False)


@app.post("/explain")
def explain(req: SeriesRequest, _: dict = Depends(require_admin)) -> dict:
    return _series_forecast(req, explain=True)
