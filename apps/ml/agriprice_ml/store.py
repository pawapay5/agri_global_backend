from __future__ import annotations

import json
from datetime import date

import numpy as np
import pandas as pd
import psycopg

PANEL_SQL = """
WITH m AS (
  SELECT 'm:' || w.market_id || ':' || w.commodity_id || ':' || w.price_type AS series_id,
         w.commodity_id, w.market_id, NULL::uuid AS region_id, w.price_type, w.country_iso2,
         region_ancestor_at_level(w.region_id, 1) AS region1_id,
         date_trunc('month', w.bucket)::date AS month,
         sum(w.sum_kg_local) / sum(w.n) AS price
  FROM price_weekly w
  WHERE w.country_iso2 = %(country)s
  GROUP BY 1, 2, 3, 5, 6, 7, 8
), r AS (
  SELECT 'r:' || region_ancestor_at_level(w.region_id, 1) || ':' || w.commodity_id || ':' || w.price_type AS series_id,
         w.commodity_id, NULL::uuid AS market_id, region_ancestor_at_level(w.region_id, 1) AS region_id, w.price_type, w.country_iso2,
         region_ancestor_at_level(w.region_id, 1) AS region1_id,
         date_trunc('month', w.bucket)::date AS month,
         sum(w.sum_kg_local) / sum(w.n) AS price
  FROM price_weekly w
  WHERE w.country_iso2 = %(country)s AND w.region_id IS NOT NULL
  GROUP BY 1, 2, 4, 5, 6, 7, 8
)
SELECT s.*, c.code AS commodity_code, rg.code AS region_code, coalesce(mk.type, 'region') AS market_type
FROM (SELECT * FROM m UNION ALL SELECT * FROM r) s
JOIN commodities c ON c.id = s.commodity_id
LEFT JOIN regions rg ON rg.id = s.region1_id
LEFT JOIN markets mk ON mk.id = s.market_id
"""

EXOG_SQL = {
    "weather": "SELECT region_id AS region1_id, month, precip_mm, precip_normal_mm, temp_mean_c FROM weather_monthly wm JOIN regions r ON r.id = wm.region_id WHERE r.country_iso2 = %(country)s",
    "fx": """SELECT date_trunc('month', f.rate_date)::date AS month, avg(f.rate)::float8 AS fx_local_usd
             FROM fx_rates f JOIN countries c ON c.currency = f.base AND f.quote = 'USD' WHERE c.iso2 = %(country)s GROUP BY 1""",
    "fuel": "SELECT month, value AS fuel_price FROM macro_monthly WHERE country_iso2 = %(country)s AND indicator = 'fuel_pump_price'",
    "calendar": """SELECT DISTINCT ON (cc.commodity_id, coalesce(cc.region_id::text, '*')) cc.commodity_id, cc.region_id AS region1_id,
                          cc.harvest_months, cc.lean_months FROM crop_calendars cc WHERE cc.country_iso2 = %(country)s""",
}


def _frame(conn: psycopg.Connection, sql: str, params: dict) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d.name for d in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


def regularise(panel: pd.DataFrame, max_gap: int = 2) -> pd.DataFrame:
    """Reindex each series to contiguous months; interpolate gaps of up to `max_gap` months (in log space)."""
    out = []
    static = [c for c in panel.columns if c not in ("month", "price")]
    for sid, g in panel.groupby("series_id"):
        g = g.set_index("month").sort_index()
        idx = pd.date_range(g.index.min(), g.index.max(), freq="MS")
        g = g.reindex(idx)
        g["price"] = np.exp(np.log(g["price"].astype(float)).interpolate(limit=max_gap, limit_area="inside"))
        g[static] = g[static].ffill().bfill()
        g.index.name = "month"
        out.append(g.reset_index())
    return pd.concat(out, ignore_index=True) if out else panel


def load_panel(conn: psycopg.Connection, country: str, min_months: int = 24) -> pd.DataFrame:
    p = _frame(conn, PANEL_SQL, {"country": country})
    if p.empty:
        return p
    p["month"] = pd.to_datetime(p["month"])
    p["price"] = p["price"].astype(float)
    p = regularise(p)
    counts = p.dropna(subset=["price"]).groupby("series_id")["month"].count()
    p = p[p["series_id"].isin(counts[counts >= min_months].index)]

    w = _frame(conn, EXOG_SQL["weather"], {"country": country})
    if not w.empty:
        w["month"] = pd.to_datetime(w["month"])
        p = p.merge(w, on=["region1_id", "month"], how="left")
    fx = _frame(conn, EXOG_SQL["fx"], {"country": country})
    if not fx.empty:
        fx["month"] = pd.to_datetime(fx["month"])
        p = p.merge(fx, on="month", how="left")
    fuel = _frame(conn, EXOG_SQL["fuel"], {"country": country})
    if not fuel.empty:
        fuel["month"] = pd.to_datetime(fuel["month"])
        p = p.merge(fuel, on="month", how="left")

    cal = _frame(conn, EXOG_SQL["calendar"], {"country": country})
    if not cal.empty:
        national = cal[cal["region1_id"].isna()].set_index("commodity_id")
        regional = cal[cal["region1_id"].notna()].set_index(["commodity_id", "region1_id"])
        def pick(row, col):
            key = (row["commodity_id"], row["region1_id"])
            if key in regional.index:
                return list(regional.loc[key, col])
            if row["commodity_id"] in national.index:
                return list(national.loc[row["commodity_id"], col])
            return None
        keys = p[["commodity_id", "region1_id"]].drop_duplicates()
        keys["harvest_months"] = keys.apply(lambda r: pick(r, "harvest_months"), axis=1)
        keys["lean_months"] = keys.apply(lambda r: pick(r, "lean_months"), axis=1)
        p = p.merge(keys, on=["commodity_id", "region1_id"], how="left")
    return p.dropna(subset=["price"]).reset_index(drop=True)


def save_run(conn: psycopg.Connection, *, country: str, currency: str, version: str, mlflow_run_id: str | None, features: list[str],
             params: dict, metrics: dict, per_series: pd.DataFrame, forecasts: list[dict], promote: bool) -> str:
    """One transaction: model version, per-series backtests, latest forecasts (+ explanations)."""
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """INSERT INTO model_versions (name, version, mlflow_run_id, algorithm, feature_names, params, metrics, status)
               VALUES ('price-quantile-gbm', %s, %s, 'lightgbm+xgboost', %s, %s, %s, 'candidate') RETURNING id""",
            (version, mlflow_run_id, features, json.dumps(params), json.dumps(metrics)))
        mv_id = cur.fetchone()[0]
        for r in per_series.itertuples():
            kind, sid, commodity_id, price_type = r.series_id.split(":")
            cur.execute(
                """INSERT INTO backtest_metrics (model_version_id, commodity_id, market_id, region_id, price_type, horizon_months, mape, coverage_p10_p90, n_folds)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (mv_id, commodity_id, sid if kind == "m" else None, sid if kind == "r" else None, price_type, int(r.horizon),
                 float(r.mape), float(r.coverage), int(r.n_folds)))
        if promote:
            cur.execute("UPDATE model_versions SET status = 'archived' WHERE name = 'price-quantile-gbm' AND status = 'production'")
            cur.execute("UPDATE model_versions SET status = 'production' WHERE id = %s", (mv_id,))
        for f in forecasts:
            cur.execute(
                """UPDATE forecast_runs SET is_latest = false WHERE is_latest AND commodity_id = %s AND price_type = %s
                     AND market_id IS NOT DISTINCT FROM %s::uuid AND region_id IS NOT DISTINCT FROM %s::uuid""",
                (f["commodity_id"], f["price_type"], f["market_id"], f["region_id"]))
            cur.execute(
                """INSERT INTO forecast_runs (model_version_id, commodity_id, market_id, region_id, country_iso2, price_type, as_of_date, currency, latest_actual_kg_local)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                (mv_id, f["commodity_id"], f["market_id"], f["region_id"], country, f["price_type"], f["as_of"], currency, f["latest"]))
            fid = cur.fetchone()[0]
            for h in f["horizons"]:
                cur.execute(
                    """INSERT INTO forecast_points (forecast_id, horizon_months, target_date, p10, p50, p90, backtest_mape, interval_width_pct, confidence)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (fid, h["h"], h["target"], h["p10"], h["p50"], h["p90"], h["mape"], h["width"], h["confidence"]))
                cur.execute(
                    """INSERT INTO forecast_explanations (forecast_id, horizon_months, base_value, features, insight_key, insight_params)
                       VALUES (%s, %s, %s, %s, %s, %s)""",
                    (fid, h["h"], h["base"], json.dumps(h["features"]), h["insight_key"], json.dumps(h["insight_params"])))
    return str(mv_id)


def country_currency(conn: psycopg.Connection, country: str) -> str:
    with conn.cursor() as cur:
        cur.execute("SELECT currency FROM countries WHERE iso2 = %s", (country,))
        row = cur.fetchone()
    if not row:
        raise ValueError(f"unknown country {country}")
    return row[0]


def month_end(d: pd.Timestamp, h: int) -> date:
    return (d + pd.DateOffset(months=h)).date()
