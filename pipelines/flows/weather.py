"""Monthly weather history per region (Open-Meteo ERA5 archive at the region centroid) → weather_monthly.

precip_normal_mm is the same-calendar-month mean over the loaded window (default 10 years).
That is a short reference period, so it is stored alongside the raw values and can be recomputed.
"""

from __future__ import annotations

from datetime import date

import pandas as pd
from prefect import flow, get_run_logger, task

from .common import db, http, run_log

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"


def monthly(daily: dict) -> pd.DataFrame:
    """Daily Open-Meteo payload → monthly precip sum, mean temperature and per-month normal."""
    d = pd.DataFrame({"date": pd.to_datetime(daily["time"]), "precip": daily["precipitation_sum"], "temp": daily["temperature_2m_mean"]})
    d = d.dropna()
    m = d.groupby(d["date"].dt.to_period("M")).agg(precip_mm=("precip", "sum"), temp_mean_c=("temp", "mean"), days=("precip", "size")).reset_index()
    m = m[m["days"] >= 25]  # skip partial months
    m["month"] = m["date"].dt.to_timestamp()
    m["precip_normal_mm"] = m.groupby(m["month"].dt.month)["precip_mm"].transform("mean")
    return m[["month", "precip_mm", "precip_normal_mm", "temp_mean_c"]]


@task(retries=3, retry_delay_seconds=30)
def fetch(lat: float, lng: float, start: str, end: str) -> dict:
    with http() as c:
        r = c.get(ARCHIVE, params={"latitude": f"{lat:.4f}", "longitude": f"{lng:.4f}", "start_date": start, "end_date": end,
                                   "daily": "precipitation_sum,temperature_2m_mean", "timezone": "UTC"})
        r.raise_for_status()
        return r.json()["daily"]


@flow(name="weather-monthly")
def weather_monthly(country: str = "GH", years: int = 10) -> dict:
    log = get_run_logger()
    end = date.today().replace(day=1)
    start = date(end.year - years, end.month, 1)
    with run_log("weather-monthly", country) as stats:
        with db() as conn, conn.cursor() as cur:
            cur.execute("""SELECT id, ST_Y(centroid::geometry), ST_X(centroid::geometry) FROM regions
                           WHERE country_iso2 = %s AND level = 1 AND centroid IS NOT NULL""", (country,))
            regions = cur.fetchall()
            n = 0
            for rid, lat, lng in regions:
                m = monthly(fetch(lat, lng, start.isoformat(), end.isoformat()))
                for r in m.itertuples():
                    cur.execute(
                        """INSERT INTO weather_monthly (region_id, month, precip_mm, precip_normal_mm, temp_mean_c, source)
                           VALUES (%s, %s, %s, %s, %s, 'open-meteo-era5')
                           ON CONFLICT (region_id, month) DO UPDATE SET precip_mm = EXCLUDED.precip_mm,
                             precip_normal_mm = EXCLUDED.precip_normal_mm, temp_mean_c = EXCLUDED.temp_mean_c""",
                        (rid, r.month.date(), float(r.precip_mm), float(r.precip_normal_mm), float(r.temp_mean_c)))
                    n += 1
            conn.commit()
        stats.update(regions=len(regions), rows=n)
        log.info("weather: %d region-months for %s", n, country)
        return stats


if __name__ == "__main__":
    weather_monthly()
