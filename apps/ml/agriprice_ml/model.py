"""Global per-horizon quantile GBMs, rolling-origin CV vs a seasonal-naive baseline, guardrails, SHAP, model cards."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

import lightgbm as lgb
import numpy as np
import pandas as pd
import shap
import xgboost as xgb

from . import HORIZON_WEEKS, HORIZONS, MAX_BACKTEST_MAPE, MAX_STALENESS_DAYS, MIN_HISTORY_WEEKS, QUANTILES
from .features import CATEGORICAL_FEATURES, FEATURES, I18N_KEYS, add_target_encoding

LGB_PARAMS = dict(n_estimators=400, learning_rate=0.03, num_leaves=31, min_child_samples=20, subsample=0.8,
                  subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, verbose=-1)
XGB_PARAMS = dict(n_estimators=400, learning_rate=0.03, max_depth=5, subsample=0.8, colsample_bytree=0.8,
                  tree_method="hist", enable_categorical=True)


def confidence_label(interval_width_pct: float, mape: float | None) -> str:
    if mape is None or not np.isfinite(mape):
        return "medium" if interval_width_pct <= 25 else "low"
    if interval_width_pct <= 20 and mape <= 10:
        return "high"
    if interval_width_pct <= 40 and mape <= 20:
        return "medium"
    return "low"


def enforce_monotone(q10, q50, q90):
    s = np.sort(np.vstack([q10, q50, q90]), axis=0)
    return s[0], s[1], s[2]


def _rows(df: pd.DataFrame, h: int) -> pd.DataFrame:
    return df.dropna(subset=[f"y_{h}", "lag_1w"])


@dataclass
class HorizonModel:
    """One global model per horizon: LightGBM quantiles (0.1/0.5/0.9) with an XGBoost median challenger blended in."""
    horizon: int
    lgb_q: dict = field(default_factory=dict)
    xgb_med: xgb.XGBRegressor | None = None
    te_train: pd.DataFrame | None = None

    def _enc(self, X: pd.DataFrame) -> pd.DataFrame:
        return add_target_encoding(self.te_train, X, self.horizon)[FEATURES]

    def fit(self, train: pd.DataFrame) -> "HorizonModel":
        d = _rows(train, self.horizon)
        self.te_train = d[["market_id", "region_code", f"y_{self.horizon}"]].copy()
        X, y = self._enc(d), d[f"y_{self.horizon}"]
        for q in QUANTILES:
            m = lgb.LGBMRegressor(objective="quantile", alpha=q, **LGB_PARAMS)
            m.fit(X, y, categorical_feature=CATEGORICAL_FEATURES)
            self.lgb_q[q] = m
        self.xgb_med = xgb.XGBRegressor(objective="reg:quantileerror", quantile_alpha=0.5, **XGB_PARAMS)
        self.xgb_med.fit(X, y)
        return self

    def predict(self, rows: pd.DataFrame):
        X = self._enc(rows)
        q50 = 0.5 * self.lgb_q[0.5].predict(X) + 0.5 * self.xgb_med.predict(X)
        return enforce_monotone(self.lgb_q[0.1].predict(X), q50, self.lgb_q[0.9].predict(X))

    def explain(self, rows: pd.DataFrame):
        X = self._enc(rows)
        ex = shap.TreeExplainer(self.lgb_q[0.5])
        return float(np.atleast_1d(ex.expected_value)[0]), np.asarray(ex.shap_values(X)), X


def fit_all(df: pd.DataFrame) -> dict[int, HorizonModel]:
    return {h: HorizonModel(h).fit(df) for h in HORIZONS}


def seasonal_naive(df: pd.DataFrame, origin_rows: pd.DataFrame, h: int) -> np.ndarray:
    """Seasonal-naive forecast of price[t+h]: the series' price 52 weeks before the target, else last value."""
    wks = HORIZON_WEEKS[h]
    lookup = df.set_index(["series_id", "week"])["price"]
    out = []
    for sid, wk, p0 in zip(origin_rows["series_id"], origin_rows["week"], origin_rows["price"]):
        key = (sid, wk + pd.Timedelta(weeks=wks - 52))
        out.append(float(lookup.get(key, p0)))
    return np.array(out)


def rolling_origin_cv(df: pd.DataFrame, n_origins: int = 8, step_weeks: int = 4, min_train_weeks: int = 52) -> pd.DataFrame:
    """Origins every `step_weeks`; train on rows whose target is fully observed before the origin (no leakage)."""
    weeks = sorted(df["week"].unique())
    rows = []
    for h in HORIZONS:
        wks = HORIZON_WEEKS[h]
        last = pd.Timestamp(weeks[-1])
        eligible = [pd.Timestamp(w) for w in weeks[min_train_weeks:] if pd.Timestamp(w) + pd.Timedelta(weeks=wks) <= last]
        origins = eligible[::-1][::step_weeks][:n_origins][::-1]
        for T in origins:
            train = df[df["week"] <= T - pd.Timedelta(weeks=wks)]
            if len(_rows(train, h)) < 100:
                continue
            test = _rows(df[df["week"] == T], h)
            if test.empty:
                continue
            m = HorizonModel(h).fit(train)
            q10, q50, q90 = m.predict(test)
            p0 = test["price"].to_numpy(float)
            actual = p0 * np.exp(test[f"y_{h}"].to_numpy(float))
            pred = p0 * np.exp(q50)
            base = seasonal_naive(df, test, h)
            rows.append(pd.DataFrame({
                "series_id": test["series_id"].to_numpy(), "horizon": h, "origin": T,
                "ape": np.abs(pred - actual) / actual * 100,
                "sape": 200 * np.abs(pred - actual) / (np.abs(pred) + np.abs(actual)),
                "base_ape": np.abs(base - actual) / actual * 100,
                "covered": (actual >= p0 * np.exp(q10)) & (actual <= p0 * np.exp(q90)),
            }))
    cols = ["series_id", "horizon", "origin", "ape", "sape", "base_ape", "covered"]
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame(columns=cols)


def series_metrics(bt: pd.DataFrame) -> pd.DataFrame:
    if bt.empty:
        return pd.DataFrame(columns=["series_id", "horizon", "mape", "smape", "baseline_mape", "coverage", "n_folds"])
    return (bt.groupby(["series_id", "horizon"])
              .agg(mape=("ape", "mean"), smape=("sape", "mean"), baseline_mape=("base_ape", "mean"), coverage=("covered", "mean"), n_folds=("ape", "size"))
              .reset_index())


def global_metrics(bt: pd.DataFrame) -> dict:
    out: dict = {}
    for h in HORIZONS:
        b = bt[bt.horizon == h]
        if b.empty:
            continue
        out |= {f"mape_h{h}": float(b.ape.median()), f"smape_h{h}": float(b.sape.median()),
                f"coverage_h{h}": float(b.covered.mean()), f"baseline_mape_h{h}": float(b.base_ape.median())}
    return out


def beats_baseline(metrics: dict) -> bool:
    """Promotion gate: median MAPE below the seasonal-naive baseline, averaged over the horizons evaluated."""
    hs = [h for h in HORIZONS if f"mape_h{h}" in metrics and f"baseline_mape_h{h}" in metrics]
    if not hs:
        return False
    return float(np.mean([metrics[f"mape_h{h}"] for h in hs])) < float(np.mean([metrics[f"baseline_mape_h{h}"] for h in hs]))


def guardrails(history_weeks: int, last_observed: pd.Timestamp, as_of: pd.Timestamp, mape_by_h: dict[int, float | None]) -> tuple[list[str], dict[int, str]]:
    """Run-level reasons (whole forecast withheld) and per-horizon reasons."""
    run: list[str] = []
    if history_weeks < MIN_HISTORY_WEEKS:
        run.append("insufficient_history")
    if (as_of - last_observed).days > MAX_STALENESS_DAYS:
        run.append("stale_data")
    per_h = {h: "backtest_mape_above_25" for h, m in mape_by_h.items() if m is not None and m > MAX_BACKTEST_MAPE}
    return run, per_h


def _clean(v):
    if v is None or isinstance(v, str):
        return v
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    return round(f, 4) if np.isfinite(f) else None


def top_contributions(shap_row: np.ndarray, x_row: pd.Series, price_now: float, k: int = 7) -> list[dict]:
    """Top-k SHAP drivers. Log-ratio SHAP × current price ≈ contribution in price per kg (first-order)."""
    contrib = dict(zip(FEATURES, shap_row.astype(float)))
    contrib["season"] = contrib.pop("month_sin", 0.0) + contrib.pop("month_cos", 0.0)
    total = sum(abs(v) for v in contrib.values()) or 1.0
    ranked = sorted(contrib.items(), key=lambda kv: abs(kv[1]), reverse=True)[:k]
    return [{
        "feature": name, "i18nKey": I18N_KEYS.get(name, f"forecast.feature.{name}"),
        "value": None if name == "season" else _clean(x_row.get(name)),
        "contribution": round(phi * price_now, 6), "sharePct": round(abs(phi) / total * 100, 2), "direction": "up" if phi >= 0 else "down",
    } for name, phi in ranked]


def insight_key(change_pct: float) -> str:
    return "forecast.insight.up" if change_pct >= 2 else "forecast.insight.down" if change_pct <= -2 else "forecast.insight.flat"


def model_card(*, version: str, country: str, panel: pd.DataFrame, metrics: dict, promoted: bool, n_forecasts: int, n_suppressed: int) -> dict:
    return {
        "name": "price-quantile-gbm", "version": version, "country": country, "createdAt": datetime.now(timezone.utc).isoformat(),
        "intendedUse": "Indicative 1/3/6-month wholesale/retail price ranges per market and region, to support selling and planting decisions. Not a guarantee of future prices.",
        "model": "Global LightGBM quantile regressors (P10/P50/P90) per horizon on weekly log price ratios; the P50 is blended with an XGBoost median.",
        "training": {"series": int(panel["series_id"].nunique()), "weeks": int(panel["week"].nunique()),
                     "from": str(pd.Timestamp(panel["week"].min()).date()), "to": str(pd.Timestamp(panel["week"].max()).date())},
        "features": FEATURES,
        "evaluation": {"method": "rolling-origin CV (8 origins, 4-week step), seasonal-naive baseline", **metrics},
        "promoted": promoted, "promotionRule": "median MAPE across horizons below the seasonal-naive baseline",
        "guardrails": {"minHistoryWeeks": MIN_HISTORY_WEEKS, "maxStalenessDays": MAX_STALENESS_DAYS, "maxBacktestMapePct": MAX_BACKTEST_MAPE},
        "output": {"forecasts": n_forecasts, "suppressedSeries": n_suppressed},
        "limitations": ["Sparse or irregular series are withheld (insufficient data).", "Shocks such as policy changes, conflict or disease outbreaks are not modelled.",
                        "Weather inputs are regional monthly aggregates."],
    }
