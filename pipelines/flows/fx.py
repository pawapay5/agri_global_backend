"""Daily FX: stores LOCAL→USD rates (USD per 1 unit of local currency) for every known currency."""

from __future__ import annotations

from datetime import datetime, timezone

from prefect import flow, get_run_logger, task

from .common import db, http, run_log

SOURCE_URL = "https://open.er-api.com/v6/latest/USD"


def to_local_usd(usd_based: dict[str, float], currencies: list[str]) -> dict[str, float]:
    """open.er-api gives units-of-X per 1 USD; we store USD per 1 X."""
    return {c: 1.0 / usd_based[c] for c in currencies if c != "USD" and usd_based.get(c)}


@task(retries=3, retry_delay_seconds=60)
def fetch() -> tuple[str, dict[str, float]]:
    with http() as c:
        r = c.get(SOURCE_URL)
        r.raise_for_status()
        j = r.json()
    if j.get("result") != "success":
        raise RuntimeError(f"fx source error: {j.get('error-type')}")
    day = datetime.fromtimestamp(j["time_last_update_unix"], tz=timezone.utc).date().isoformat()
    return day, j["rates"]


@flow(name="fx-daily")
def fx_daily() -> dict:
    log = get_run_logger()
    with run_log("fx-daily") as stats:
        day, rates = fetch()
        with db() as conn, conn.cursor() as cur:
            cur.execute("SELECT code FROM currencies")
            currencies = [r[0] for r in cur.fetchall()]
            out = to_local_usd(rates, currencies)
            for code, rate in out.items():
                cur.execute(
                    """INSERT INTO fx_rates (base, quote, rate, rate_date, source) VALUES (%s, 'USD', %s, %s, 'open_er_api')
                       ON CONFLICT (base, quote, rate_date) DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source""",
                    (code, rate, day))
            conn.commit()
        stats.update(date=day, currencies=len(out))
        log.info("stored %d FX rates for %s", len(out), day)
        return stats


if __name__ == "__main__":
    fx_daily()
