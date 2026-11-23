"""Shared helpers for Prefect flows."""

from __future__ import annotations

import json
import os
from contextlib import contextmanager

import httpx
import psycopg

DSN = os.environ.get("DATABASE_URL", "postgresql://agriprice:agriprice@localhost:5432/agriprice")
API = os.environ.get("API_INTERNAL_URL", "http://localhost:3001")
USER_AGENT = "AgriPrice-Pipelines/1.0"


def db() -> psycopg.Connection:
    return psycopg.connect(DSN, autocommit=False)


@contextmanager
def run_log(flow: str, country: str | None = None):
    """Records the flow run in pipeline_runs (status, stats, error)."""
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO pipeline_runs (flow, country_iso2) VALUES (%s, %s) RETURNING id", (flow, country))
            run_id = cur.fetchone()[0]
        conn.commit()
        stats: dict = {}
        try:
            yield stats
        except Exception as e:
            with conn.cursor() as cur:
                cur.execute("UPDATE pipeline_runs SET status = 'failed', finished_at = now(), stats = %s, error = %s WHERE id = %s",
                            (json.dumps(stats, default=str), str(e)[:2000], run_id))
            conn.commit()
            raise
        with conn.cursor() as cur:
            cur.execute("UPDATE pipeline_runs SET status = 'succeeded', finished_at = now(), stats = %s WHERE id = %s",
                        (json.dumps(stats, default=str), run_id))
        conn.commit()


def http() -> httpx.Client:
    return httpx.Client(timeout=60, headers={"User-Agent": USER_AGENT}, follow_redirects=True)


def api_token(client: httpx.Client) -> str:
    """Service account login (an admin user without TOTP, credentials from the secret store)."""
    r = client.post(f"{API}/v1/auth/login", json={"email": os.environ["PIPELINE_SERVICE_EMAIL"], "password": os.environ["PIPELINE_SERVICE_PASSWORD"]})
    r.raise_for_status()
    body = r.json()
    if body.get("status") != "authenticated":
        raise RuntimeError("pipeline service account must not have MFA enabled")
    return body["tokens"]["accessToken"]
