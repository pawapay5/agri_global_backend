"""Nightly per-country training: features → rolling-origin CV vs seasonal naive → promote → batch predict → SHAP → persist.

    python -m agriprice_ml.train --country GH [--promote auto|always|never]
"""

from __future__ import annotations

import argparse
import logging
import os
from datetime import datetime, timezone

import httpx
import numpy as np
import pandas as pd
import psycopg

from . import HORIZON_WEEKS, HORIZONS
from .features import FEATURES, build_features
from .model import (LGB_PARAMS, XGB_PARAMS, beats_baseline, confidence_label, fit_all, global_metrics, guardrails, insight_key, model_card,
                    rolling_origin_cv, series_metrics, top_contributions)
from .store import country_currency, load_models, load_panel, production_version, save_models, save_run, target_date

log = logging.getLogger("agriprice.train")


def predict_series(feat: pd.DataFrame, models, metrics: pd.DataFrame, as_of: pd.Timestamp | None = None) -> list[dict]:
    """Latest-row forecasts per series with guardrails applied. Suppressed series/horizons are still returned (with reasons)."""
    as_of = as_of or pd.Timestamp(datetime.now(timezone.utc).date())
    latest = feat.sort_values("week").groupby("series_id").tail(1)
    history = feat.dropna(subset=["price"]).groupby("series_id")["week"].count()
    mape = {(r.series_id, int(r.horizon)): float(r.mape) for r in metrics.itertuples()}
    usable = latest.dropna(subset=["lag_1w"])
    preds = {}
    if len(usable):
        for h, m in models.items():
            q10, q50, q90 = m.predict(usable)
            base, sv, X = m.explain(usable)
            preds[h] = (q10, q50, q90, base, sv, X)
    pos = {sid: i for i, sid in enumerate(usable["series_id"])}

    out = []
    for r in latest.itertuples(index=False):
        row = r._asdict()
        sid = row["series_id"]
        kind, ref, commodity_id, price_type = sid.split(":")
        last_obs = pd.Timestamp(row["last_obs"]).tz_localize(None) if row.get("last_obs") is not None else pd.Timestamp(row["week"])
        run_r, h_r = guardrails(int(history.get(sid, 0)), last_obs.normalize(), as_of, {h: mape.get((sid, h)) for h in HORIZONS})
        if sid not in pos:
            run_r = sorted(set(run_r) | {"insufficient_history"})
        p0 = float(row["price"])
        horizons = []
        if not run_r:
            i = pos[sid]
            for h in HORIZONS:
                if h in h_r:
                    continue
                q10, q50, q90, base, sv, X = preds[h]
                p10, p50, p90 = (p0 * float(np.exp(v[i])) for v in (q10, q50, q90))
                width = (p90 - p10) / p50 * 100 if p50 > 0 else float("inf")
                change = (p50 - p0) / p0 * 100
                m_ = mape.get((sid, h))
                horizons.append({
                    "h": h, "target": target_date(row["week"], HORIZON_WEEKS[h]), "p10": round(p10, 6), "p50": round(p50, 6), "p90": round(p90, 6),
                    "mape": round(m_, 3) if m_ is not None else None, "width": round(width, 3), "confidence": confidence_label(width, m_),
                    "base": base, "features": top_contributions(sv[i], X.iloc[i], p0), "insight_key": insight_key(change),
                    "insight_params": {"pct": f"{abs(change):.0f}", "months": h},
                })
        status = "available" if horizons else "insufficient_data"
        out.append({
            "commodity_id": commodity_id, "market_id": ref if kind == "m" else None, "region_id": ref if kind == "r" else None, "price_type": price_type,
            "as_of": pd.Timestamp(row["week"]).date(), "latest": round(p0, 6), "horizons": horizons, "status": status,
            "suppression": {"run": run_r if run_r else ([] if horizons else ["backtest_mape_above_25"]), **{str(h): v for h, v in h_r.items()}},
            "history_weeks": int(history.get(sid, 0)), "last_observed": last_obs.date(),
        })
    return out


def run(country: str, promote: str = "auto", dsn: str | None = None, notify: bool = True) -> dict:
    dsn = dsn or os.environ.get("DATABASE_URL", "postgresql://agriprice:agriprice@localhost:5432/agriprice")
    with psycopg.connect(dsn) as conn:
        currency = country_currency(conn, country)
        panel = load_panel(conn, country)
        if panel.empty:
            log.warning("no price history for %s", country)
            return {"country": country, "series": 0}
        feat = build_features(panel)
        bt = rolling_origin_cv(feat)
        per_series = series_metrics(bt)
        metrics = global_metrics(bt)
        candidate_ok = beats_baseline(metrics)
        do_promote = promote == "always" or (promote == "auto" and candidate_ok)
        version = datetime.now(timezone.utc).strftime("%Y.%m.%d-%H%M") + f"-{country.lower()}"

        models = fit_all(feat)
        save_models(version, models)
        prod = production_version(conn, country)
        serving = models if do_promote else (load_models(prod) if prod else None)
        forecasts = predict_series(feat, serving, per_series) if serving else []
        n_supp = sum(1 for f in forecasts if f["status"] != "available")
        card = model_card(version=version, country=country, panel=panel, metrics=metrics, promoted=do_promote, n_forecasts=len(forecasts), n_suppressed=n_supp)
        params = {"lgb": LGB_PARAMS, "xgb": {k: v for k, v in XGB_PARAMS.items() if k != "enable_categorical"}, "horizon_weeks": HORIZON_WEEKS}
        run_id = _mlflow(version, params, metrics, card, country)
        mv = save_run(conn, country=country, currency=currency, version=version, mlflow_run_id=run_id, features=FEATURES, params=params, metrics=metrics,
                      per_series=per_series, forecasts=forecasts, promote=do_promote, card=card, write_forecasts=bool(serving))
        log.info("%s: model %s promoted=%s beats_baseline=%s forecasts=%d suppressed=%d", country, version, do_promote, candidate_ok, len(forecasts), n_supp)
    if notify and serving:
        _notify(country, version if do_promote else prod, len(forecasts))
    return {"country": country, "model_version_id": mv, "version": version, "promoted": do_promote, "beatsBaseline": candidate_ok,
            "series": len(forecasts), "suppressed": n_supp, "metrics": metrics}


def _notify(country: str, version: str | None, n: int) -> None:
    api, token = os.environ.get("API_INTERNAL_URL", "http://localhost:3001"), os.environ.get("ML_SERVICE_TOKEN")
    if not token:
        log.warning("ML_SERVICE_TOKEN not set; skipping API notification")
        return
    try:
        httpx.post(f"{api}/internal/forecasts/refreshed", json={"country": country, "modelVersion": version, "series": n},
                   headers={"Authorization": f"Bearer {token}"}, timeout=15).raise_for_status()
    except Exception as e:  # notifying must not fail the training run
        log.warning("API notification failed: %s", e)


def _mlflow(version: str, params: dict, metrics: dict, card: dict, country: str) -> str | None:
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
            mlflow.log_dict(card, "model_card.json")
            return r.info.run_id
    except Exception as e:
        log.warning("mlflow logging failed: %s", e)
        return None


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--country", required=True)
    ap.add_argument("--promote", choices=["auto", "always", "never"], default="auto")
    a = ap.parse_args()
    print(run(a.country.upper(), a.promote))
