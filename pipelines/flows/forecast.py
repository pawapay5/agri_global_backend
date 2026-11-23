"""Monthly retrain + forecast for every active country (after prices, FX and weather are fresh)."""

from __future__ import annotations

from prefect import flow, get_run_logger, task

from agriprice_ml import train

from .common import db, run_log
from .fx import fx_daily
from .weather import weather_monthly


@task(retries=1, retry_delay_seconds=600, timeout_seconds=3 * 3600)
def train_country(country: str, promote: str) -> dict:
    return train.run(country, promote)


@flow(name="forecast-monthly")
def forecast_monthly(promote: str = "auto", refresh_inputs: bool = True) -> list[dict]:
    log = get_run_logger()
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT iso2 FROM countries WHERE active ORDER BY iso2")
        countries = [r[0] for r in cur.fetchall()]
    results = []
    if refresh_inputs:
        fx_daily()
    for c in countries:
        with run_log("forecast-monthly", c) as stats:
            if refresh_inputs:
                weather_monthly(c)
            res = train_country(c, promote)
            stats.update(res)
            results.append(res)
            log.info("%s: %s", c, res)
    return results


if __name__ == "__main__":
    forecast_monthly()
