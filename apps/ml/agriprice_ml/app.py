

from __future__ import annotations

import os
import threading

import psycopg
from fastapi import Depends, FastAPI, Header, HTTPException

from . import train

app = FastAPI(title="AgriPrice ML", version="1.0.0")
_lock = threading.Lock()


def _dsn() -> str:
    return os.environ.get("DATABASE_URL", "postgresql://agriprice:agriprice@localhost:5432/agriprice")


def require_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.environ.get("ML_SERVICE_TOKEN")
    if not expected or authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/models", dependencies=[Depends(require_token)])
def models(limit: int = 20) -> list[dict]:
    with psycopg.connect(_dsn()) as conn, conn.cursor() as cur:
        cur.execute("SELECT id, version, status, metrics, trained_at FROM model_versions ORDER BY trained_at DESC LIMIT %s", (min(limit, 100),))
        return [{"id": str(r[0]), "version": r[1], "status": r[2], "metrics": r[3], "trainedAt": r[4].isoformat()} for r in cur.fetchall()]


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
