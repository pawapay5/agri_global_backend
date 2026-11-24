"""Database I/O for the weekly forecasting pipeline, plus model artifact persistence."""

from __future__ import annotations

import json
import os
from datetime import date

import joblib
import numpy as np
import pandas as pd
import psycopg

MODEL_DIR = os.environ.get("MODEL_DIR", os.path.join(os.path.dirname(__file__), "..", "models"))

PANEL_SQL = """
WITH m AS (
  SELECT 'm:' || w.market_id || ':' || w.commodity_id || ':' || w.price_type AS series_id,
         w.commodity_id, w.market_id, NULL::uuid AS region_id, w.price_type, region_ancestor_at_level(w.region_id, 1) AS region1_id,
         w.bucket::date AS week, (sum(w.sum_kg_local) / sum(w.n))::float8 AS price, max(w.last_observed_at) AS last_obs
  FROM price_weekly w WHERE w.country_iso2 = %(country)s GROUP BY 1, 2, 3, 5, 6, 7
), r AS (
  SELECT 'r:' || region_ancestor_at_level(w.region_id, 1) || ':' || w.commodity_id || ':' || w.price_type AS series_id,
         w.commodity_id, NULL::uuid AS market_id, region_ancestor_at_level(w.region_id, 1) AS region_id, w.price_type,
         region_ancestor_at_level(w.region_id, 1) AS region1_id, w.bucket::date AS week, (sum(w.sum_kg_local) / sum(w.n))::float8 AS price, max(w.last_observed_at) AS last_obs
  FROM price_weekly w WHERE w.country_iso2 = %(country)s AND w.region_id IS NOT NULL GROUP BY 1, 2, 4, 5, 6, 7
)
SELECT s.*, c.code AS commodity_code, rg.code AS region_code, coalesce(mk.type, 'region') AS market_type,
       ST_Y(mk.location::geometry) AS lat, ST_X(mk.location::geometry) AS lng
FROM (SELECT * FROM m UNION ALL SELECT * FROM r) s
JOIN commodities c ON c.id = s.commodity_id
LEFT JOIN regions rg ON rg.id = s.region1_id
LEFT JOIN markets mk ON mk.id = s.market_id
"""

EXOG = {
    "weather": "SELECT wm.region_id AS region1_id, wm.month, wm.precip_mm, wm.precip_normal_mm, wm.temp_mean_c FROM weather_monthly wm JOIN regions r ON r.id = wm.region_id WHERE r.country_iso2 = %(country)s",
    "fx": """SELECT date_trunc('week', f.rate_date)::date AS week, avg(f.rate)::float8 AS fx_local_usd
             FROM fx_rates f JOIN countries c ON c.currency = f.base AND f.quote = 'USD' WHERE c.iso2 = %(country)s GROUP BY 1""",
    "fuel": "SELECT month, value AS fuel_price FROM macro_monthly WHERE country_iso2 = %(country)s AND indicator = 'fuel_pump_price'",
    "calendar": "SELECT commodity_id, region_id AS region1_id, harvest_months, lean_months FROM crop_calendars WHERE country_iso2 = %(country)s",
    "holidays": "SELECT date_trunc('week', day)::date AS week, count(*)::int AS holiday_days FROM holidays WHERE country_iso2 = %(country)s GROUP BY 1",
}


def _frame(conn, sql: str, params: dict) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return pd.DataFrame(cur.fetchall(), columns=[d.name for d in cur.description])


def regularise(panel: pd.DataFrame, max_gap: int = 2) -> pd.DataFrame:
    """Contiguous weekly index per series; interpolate (log space) only runs of <= max_gap missing weeks."""
    out = []
    static = [c for c in panel.columns if c not in ("week", "price", "last_obs")]
    for _, g in panel.groupby("series_id"):
        g = g.set_index("week").sort_index()
        g = g.reindex(pd.date_range(g.index.min(), g.index.max(), freq="W-MON"))
        logp = np.log(g["price"].astype(float))
        miss = logp.isna()
        run_len = miss.groupby((miss != miss.shift()).cumsum()).transform("sum")
        g["price"] = np.exp(logp.where(~miss | (run_len > max_gap), logp.interpolate(limit_area="inside")))
        g[static] = g[static].ffill().bfill()
        g.index.name = "week"
        out.append(g.reset_index())
    return pd.concat(out, ignore_index=True) if out else panel


def load_panel(conn, country: str) -> pd.DataFrame:
    p = _frame(conn, PANEL_SQL, {"country": country})
    if p.empty:
        return p
    p["week"] = pd.to_datetime(p["week"])
    last_obs = p.groupby("series_id")["last_obs"].max()
    p = regularise(p.drop(columns=["last_obs"]))
    p["last_obs"] = p["series_id"].map(last_obs)
    p["month"] = p["week"].dt.to_period("M").dt.to_timestamp()

    w = _frame(conn, EXOG["weather"], {"country": country})
    if not w.empty:
        w["month"] = pd.to_datetime(w["month"])
        p = p.merge(w, on=["region1_id", "month"], how="left")
    fx = _frame(conn, EXOG["fx"], {"country": country})
    if not fx.empty:
        fx["week"] = pd.to_datetime(fx["week"])
        p = p.merge(fx, on="week", how="left")
        p["fx_local_usd"] = p.groupby("series_id")["fx_local_usd"].ffill()
    fuel = _frame(conn, EXOG["fuel"], {"country": country})
    if not fuel.empty:
        fuel["month"] = pd.to_datetime(fuel["month"])
        p = p.merge(fuel, on="month", how="left")
    hol = _frame(conn, EXOG["holidays"], {"country": country})
    if not hol.empty:
        hol["week"] = pd.to_datetime(hol["week"])
        p = p.merge(hol, on="week", how="left")
    cal = _frame(conn, EXOG["calendar"], {"country": country})
    if not cal.empty:
        reg = {(r.commodity_id, r.region1_id): r for r in cal.itertuples() if r.region1_id is not None}
        nat = {r.commodity_id: r for r in cal.itertuples() if r.region1_id is None}
        keys = p[["commodity_id", "region1_id"]].drop_duplicates()
        pick = lambda r, col: getattr(reg.get((r.commodity_id, r.region1_id)) or nat.get(r.commodity_id) or object(), col, None)  # noqa: E731
        keys["harvest_months"] = [pick(r, "harvest_months") for r in keys.itertuples()]
        keys["lean_months"] = [pick(r, "lean_months") for r in keys.itertuples()]
        p = p.merge(keys, on=["commodity_id", "region1_id"], how="left")
    return p.dropna(subset=["price"]).reset_index(drop=True)


def save_models(version: str, models: dict) -> str:
    os.makedirs(MODEL_DIR, exist_ok=True)
    path = os.path.join(MODEL_DIR, f"{version}.joblib")
    joblib.dump(models, path)
    return path


def load_models(version: str) -> dict | None:
    path = os.path.join(MODEL_DIR, f"{version}.joblib")
    return joblib.load(path) if os.path.exists(path) else None


def production_version(conn, country: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute("SELECT version FROM model_versions WHERE name = 'price-quantile-gbm' AND status = 'production' AND version LIKE %s", (f"%-{country.lower()}",))
        r = cur.fetchone()
    return r[0] if r else None


def save_run(conn, *, country: str, currency: str, version: str, mlflow_run_id: str | None, features: list[str], params: dict, metrics: dict,
             per_series: pd.DataFrame, forecasts: list[dict], promote: bool, card: dict, write_forecasts: bool) -> str:
    with conn.transaction(), conn.cursor() as cur:
        baseline = {k: v for k, v in metrics.items() if k.startswith("baseline_")}
        cur.execute(
            """INSERT INTO model_versions (name, version, mlflow_run_id, algorithm, feature_names, params, metrics, baseline_metrics, model_card, status)
               VALUES ('price-quantile-gbm', %s, %s, 'lightgbm-quantile+xgboost-median', %s, %s, %s, %s, %s, 'candidate') RETURNING id""",
            (version, mlflow_run_id, features, json.dumps(params), json.dumps(metrics), json.dumps(baseline), json.dumps(card, default=str)))
        mv_id = cur.fetchone()[0]
        for r in per_series.itertuples():
            kind, sid, commodity_id, price_type = r.series_id.split(":")
            cur.execute(
                """INSERT INTO backtest_metrics (model_version_id, commodity_id, market_id, region_id, price_type, horizon_months, mape, smape, baseline_mape, coverage_p10_p90, n_folds)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (mv_id, commodity_id, sid if kind == "m" else None, sid if kind == "r" else None, price_type, int(r.horizon),
                 float(r.mape), float(r.smape), float(r.baseline_mape), float(r.coverage), int(r.n_folds)))
        if promote:
            cur.execute("UPDATE model_versions SET status = 'archived' WHERE name = 'price-quantile-gbm' AND status = 'production' AND version LIKE %s", (f"%-{country.lower()}",))
            cur.execute("UPDATE model_versions SET status = 'production' WHERE id = %s", (mv_id,))
        if write_forecasts:
            prod_id = mv_id if promote else None
            if prod_id is None:
                cur.execute("SELECT id FROM model_versions WHERE name = 'price-quantile-gbm' AND status = 'production' AND version LIKE %s", (f"%-{country.lower()}",))
                row = cur.fetchone()
                prod_id = row[0] if row else mv_id
            for f in forecasts:
                cur.execute("""UPDATE forecast_runs SET is_latest = false WHERE is_latest AND commodity_id = %s AND price_type = %s
                               AND market_id IS NOT DISTINCT FROM %s::uuid AND region_id IS NOT DISTINCT FROM %s::uuid""",
                            (f["commodity_id"], f["price_type"], f["market_id"], f["region_id"]))
                cur.execute(
                    """INSERT INTO forecast_runs (model_version_id, commodity_id, market_id, region_id, country_iso2, price_type, as_of_date, currency, latest_actual_kg_local,
                         status, suppression, history_weeks, last_observed_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (prod_id, f["commodity_id"], f["market_id"], f["region_id"], country, f["price_type"], f["as_of"], currency, f["latest"],
                     f["status"], json.dumps(f["suppression"]), f["history_weeks"], f["last_observed"]))
                fid = cur.fetchone()[0]
                for h in f["horizons"]:
                    cur.execute("""INSERT INTO forecast_points (forecast_id, horizon_months, target_date, p10, p50, p90, backtest_mape, interval_width_pct, confidence)
                                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                                (fid, h["h"], h["target"], h["p10"], h["p50"], h["p90"], h["mape"], h["width"], h["confidence"]))
                    cur.execute("""INSERT INTO forecast_explanations (forecast_id, horizon_months, base_value, features, insight_key, insight_params) VALUES (%s,%s,%s,%s,%s,%s)""",
                                (fid, h["h"], h["base"], json.dumps(h["features"]), h["insight_key"], json.dumps(h["insight_params"])))
    return str(mv_id)


def country_currency(conn, country: str) -> str:
    with conn.cursor() as cur:
        cur.execute("SELECT currency FROM countries WHERE iso2 = %s", (country,))
        r = cur.fetchone()
    if not r:
        raise ValueError(f"unknown country {country}")
    return r[0]


def target_date(week: pd.Timestamp, weeks: int) -> date:
    return (pd.Timestamp(week) + pd.Timedelta(weeks=weeks)).date()
