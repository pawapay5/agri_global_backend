"""Nightly per-country flow:
ingest → clean → aggregate → features/train → rolling-origin backtest → promote if it beats seasonal naive
→ batch predict (with guardrails) → SHAP → write forecasts + explanations → notify the API (cache warm + alert sweep).

Training runs inside the `ml` service when ML_SERVICE_URL is set (production): models live on that service's
/models volume, and the next run loads the current production model from there. Without ML_SERVICE_URL (local
development) it trains in-process.
"""

from __future__ import annotations

import os
from datetime import date, timedelta

import httpx
import psycopg
from prefect import flow, get_run_logger, task

from .common import DSN, db, run_log
from .fx import fx_daily
from .weather import weather_monthly
from .wfp_prices import wfp_prices

DQ_SQL = {
    # Rows that slipped past review for too long are listed for moderators (they don't enter aggregates until approved).
    "stale_pending": "SELECT count(*) FROM price_observations WHERE country_iso2 = %(c)s AND status IN ('pending','flagged') AND created_at < now() - interval '14 days'",
    # Same market/commodity/day/price from different submissions with >3x spread: worth a look.
    "intraday_spread": """SELECT count(*) FROM (SELECT market_id, commodity_id, price_type, date_trunc('day', observed_at) d
                          FROM price_observations WHERE country_iso2 = %(c)s AND status = 'approved' AND observed_at > now() - interval '8 days'
                          GROUP BY 1,2,3,4 HAVING max(price_per_kg_local) > 3 * min(price_per_kg_local)) x""",
    "fx_missing_today": "SELECT (count(*) = 0)::int FROM fx_rates f JOIN countries c ON c.currency = f.base WHERE c.iso2 = %(c)s AND f.rate_date >= current_date - 3",
}


@task
def clean(country: str) -> dict:
    with db() as conn, conn.cursor() as cur:
        out = {}
        for k, q in DQ_SQL.items():
            cur.execute(q, {"c": country})
            out[k] = int(cur.fetchone()[0])
        # Hard data errors that validation should have stopped: reject so they never reach a model.
        cur.execute("""UPDATE price_observations SET status = 'rejected', review_reason = 'dq_nonpositive'
                       WHERE country_iso2 = %(c)s AND status <> 'rejected' AND (price_per_kg_local <= 0 OR price_per_kg_usd <= 0)""", {"c": country})
        out["rejected_nonpositive"] = cur.rowcount
        conn.commit()
    return out


@task(retries=2, retry_delay_seconds=120)
def aggregate(days: int | None = 120) -> None:
    """Refreshes the daily/weekly continuous aggregates. days=None refreshes all history: needed after a backfill,
    because the automatic policies only cover the last 120 (daily) / 180 (weekly) days."""
    # CALL refresh_continuous_aggregate can't run inside a transaction block.
    with psycopg.connect(DSN, autocommit=True) as conn:
        if days is None:
            conn.execute("CALL refresh_continuous_aggregate('price_daily', NULL, NULL)")
            conn.execute("CALL refresh_continuous_aggregate('price_weekly', NULL, NULL)")
            return
        start, end = date.today() - timedelta(days=days), date.today() + timedelta(days=1)
        conn.execute("CALL refresh_continuous_aggregate('price_daily', %s, %s)", (start, end))
        conn.execute("CALL refresh_continuous_aggregate('price_weekly', %s, %s)", (start - timedelta(days=7), end + timedelta(days=7)))


@task(timeout_seconds=4 * 3600)
def train_predict(country: str, promote: str) -> dict:
    url = os.environ.get("ML_SERVICE_URL")
    if url:
        # The ml service holds the model volume and a training lock (409 if a run is already going).
        r = httpx.post(f"{url.rstrip('/')}/train/{country}", params={"promote": promote},
                       headers={"Authorization": f"Bearer {os.environ['ML_SERVICE_TOKEN']}"}, timeout=4 * 3600)
        if r.status_code == 409:
            return {"skipped": "training already running"}
        r.raise_for_status()
        return r.json()
    from agriprice_ml import train  # local development only: heavy ML deps aren't in the pipelines image
    return train.run(country, promote)  # writes forecasts + explanations and notifies the API


def _has_source(country: str, code: str) -> bool:
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM data_sources WHERE code = %s AND active", (code,))
        return cur.fetchone() is not None


@flow(name="nightly-country")
def nightly(country: str = "GH", promote: str = "auto", full: bool = False) -> dict:
    """full=True (first run after deploy, or by hand) pulls WFP and weather regardless of the day and refreshes the
    aggregates over all history, so a historical backfill reaches the model in the same run."""
    log = get_run_logger()
    today = date.today()
    wfp_source = f"wfp_hdx_{country.lower()}"
    with run_log("nightly-country", country) as stats:
        fx_daily()
        if (full or today.weekday() == 0) and _has_source(country, wfp_source):  # WFP publishes monthly; weekly is plenty
            stats["wfp"] = wfp_prices(country, source_code=wfp_source)
        if full or today.day == 2:
            stats["weather"] = weather_monthly(country)
        stats["dq"] = clean(country)
        aggregate(None if full else 120)
        stats["train"] = train_predict(country, promote)
        log.info("%s nightly: %s", country, stats["train"])
        return stats


@flow(name="nightly-all")
def nightly_all(promote: str = "auto", full: bool = False) -> list[dict]:
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT iso2 FROM countries WHERE active ORDER BY iso2")
        countries = [r[0] for r in cur.fetchall()]
    return [nightly(c, promote, full) for c in countries]


if __name__ == "__main__":
    nightly_all()
