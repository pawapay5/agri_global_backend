from __future__ import annotations

import argparse
import logging
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import psycopg

from . import HORIZONS
from .features import FEATURES, build_features
from .model import LGB_PARAMS, XGB_PARAMS, confidence_label, fit_all, insight_key, series_metrics, top_contributions, walk_forward_backtest
from .store import country_currency, load_panel, month_end, save_run

log = logging.getLogger("agriprice.train")


def forecast_latest(feat: pd.DataFrame, models, metrics: pd.DataFrame) -> list[dict]:
    latest = feat.sort_values("month").groupby("series_id").tail(1).dropna(subset=["lag_1m"])
    if latest.empty:
        return []
    mape_lookup = {(r.series_id, int(r.horizon)): float(r.mape) for r in metrics.itertuples()}
    X = latest[FEATURES]
    per_h = {}
    for h, m in models.items():
        q10, q50, q90 = m.predict(X)
        base, sv = m.explain(X)
        per_h[h] = (q10, q50, q90, base, sv)

    out = []
    for i, row in enumerate(latest.itertuples(index=False)):
        r = row._asdict()
        p0 = float(r["price"])
        kind, sid, commodity_id, price_type = r["series_id"].split(":")
        horizons = []
        for h in HORIZONS:
            q10, q50, q90, base, sv = per_h[h]
            p10, p50, p90 = (p0 * float(np.exp(v[i])) for v in (q10, q50, q90))
            width = (p90 - p10) / p50 * 100 if p50 > 0 else float("inf")
            mape = mape_lookup.get((r["series_id"], h))
            change = (p50 - p0) / p0 * 100
            horizons.append({
                "h": h, "target": month_end(pd.Timestamp(r["month"]), h),
                "p10": round(p10, 6), "p50": round(p50, 6), "p90": round(p90, 6),
                "mape": round(mape, 3) if mape is not None else None, "width": round(width, 3),
                "confidence": confidence_label(width, mape),
                "base": base, "features": top_contributions(sv[i], X.iloc[i], p0),
                "insight_key": insight_key(change), "insight_params": {"pct": f"{abs(change):.0f}", "months": h},
            })
        out.append({
            "commodity_id": commodity_id, "market_id": sid if kind == "m" else None, "region_id": sid if kind == "r" else None,
            "price_type": price_type, "as_of": pd.Timestamp(r["month"]).date(), "latest": round(p0, 6), "horizons": horizons,
        })
    return out


def run(country: str, promote: str = "auto", dsn: str | None = None) -> dict:
    dsn = dsn or os.environ.get("DATABASE_URL", "postgresql://agriprice:agriprice@localhost:5432/agriprice")
    with psycopg.connect(dsn) as conn:
        currency = country_currency(conn, country)
        panel = load_panel(conn, country)
        if panel.empty:
            log.warning("no series with enough history for %s; nothing to train", country)
            return {"country": country, "series": 0}
        feat = build_features(panel)
        bt = walk_forward_backtest(feat)
        per_series = series_metrics(bt)
        metrics = {f"mape_h{h}": float(bt.loc[bt.horizon == h, "ape"].median()) for h in HORIZONS if (bt.horizon == h).any()}
        metrics |= {f"coverage_h{h}": float(bt.loc[bt.horizon == h, "covered"].mean()) for h in HORIZONS if (bt.horizon == h).any()}
        models = fit_all(feat)
        forecasts = forecast_latest(feat, models, per_series)

        version = datetime.now(timezone.utc).strftime("%Y.%m.%d-%H%M") + f"-{country.lower()}"
        params = {"lgb": LGB_PARAMS, "xgb": {k: v for k, v in XGB_PARAMS.items() if k != "enable_categorical"}, "horizons": list(HORIZONS)}
        run_id = _mlflow_log(version, params, metrics, country)

        do_promote = promote == "always" or (promote == "auto" and _beats_production(conn, metrics))
        mv = save_run(conn, country=country, currency=currency, version=version, mlflow_run_id=run_id, features=FEATURES,
                      params=params, metrics=metrics, per_series=per_series, forecasts=forecasts, promote=do_promote)
        log.info("model %s: %d series, metrics=%s, promoted=%s", version, len(forecasts), metrics, do_promote)
        return {"country": country, "model_version_id": mv, "version": version, "series": len(forecasts), "metrics": metrics, "promoted": do_promote}


def _beats_production(conn: psycopg.Connection, metrics: dict) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT metrics FROM model_versions WHERE name = 'price-quantile-gbm' AND status = 'production'")
        row = cur.fetchone()
    if not row:
        return True
    prod = (row[0] or {}).get("mape_h1")
    cand = metrics.get("mape_h1")
    return cand is not None and (prod is None or cand <= prod + 0.5)


def _mlflow_log(version: str, params: dict, metrics: dict, country: str) -> str | None:
    uri = os.environ.get("MLFLOW_TRACKING_URI")
    if not uri:
        return None
    try:
        import mlflow
        mlflow.set_tracking_uri(uri)
        mlflow.set_experiment(f"agriprice-forecast-{country.lower()}")
        with mlflow.start_run(run_name=version) as r:
            mlflow.log_params({"lgb_n_estimators": params["lgb"]["n_estimators"], "lgb_lr": params["lgb"]["learning_rate"], "country": country})
            mlflow.log_metrics({k: v for k, v in metrics.items() if np.isfinite(v)})
            return r.info.run_id
    except Exception as e:  # tracking must never block forecasting
        log.warning("mlflow logging failed: %s", e)
        return None


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--country", required=True)
    ap.add_argument("--promote", choices=["auto", "always", "never"], default="auto")
    a = ap.parse_args()
    print(run(a.country.upper(), a.promote))
