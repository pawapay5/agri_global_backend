"""Nightly per-country flow:
ingest → clean → aggregate → features/train → rolling-origin backtest → promote if it beats seasonal naive
→ batch predict (with guardrails) → SHAP → write forecasts + explanations → notify the API (cache warm + alert sweep).
"""

from __future__ import annotations

from datetime import date, timedelta

import psycopg
from prefect import flow, get_run_logger, task

from agriprice_ml import train

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
def aggregate(days: int = 120) -> None:
    # CALL refresh_continuous_aggregate can't run inside a transaction block.
    with psycopg.connect(DSN, autocommit=True) as conn:
        start, end = date.today() - timedelta(days=days), date.today() + timedelta(days=1)
        conn.execute("CALL refresh_continuous_aggregate('price_daily', %s, %s)", (start, end))
        conn.execute("CALL refresh_continuous_aggregate('price_weekly', %s, %s)", (start - timedelta(days=7), end + timedelta(days=7)))


@task(timeout_seconds=4 * 3600)
def train_predict(country: str, promote: str) -> dict:
    return train.run(country, promote)  # writes forecasts + explanations and notifies the API


@flow(name="nightly-country")
def nightly(country: str = "GH", promote: str = "auto") -> dict:
    log = get_run_logger()
    today = date.today()
    with run_log("nightly-country", country) as stats:
        fx_daily()
        if today.weekday() == 0:  # WFP publishes monthly; a weekly pull is plenty
            stats["wfp"] = wfp_prices(country)
        if today.day == 2:
            stats["weather"] = weather_monthly(country)
        stats["dq"] = clean(country)
        aggregate()
        stats["train"] = train_predict(country, promote)
        log.info("%s nightly: %s", country, stats["train"])
        return stats


@flow(name="nightly-all")
def nightly_all(promote: str = "auto") -> list[dict]:
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT iso2 FROM countries WHERE active ORDER BY iso2")
        countries = [r[0] for r in cur.fetchall()]
    return [nightly(c, promote) for c in countries]


if __name__ == "__main__":
    nightly_all()
