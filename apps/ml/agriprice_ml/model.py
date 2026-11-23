"""Quantile models, walk-forward backtest, confidence labels and SHAP explanations."""

from __future__ import annotations

from dataclasses import dataclass, field

import lightgbm as lgb
import numpy as np
import pandas as pd
import shap
import xgboost as xgb

from . import HORIZONS, QUANTILES
from .features import CATEGORICAL_FEATURES, FEATURES, I18N_KEYS

LGB_PARAMS = dict(n_estimators=400, learning_rate=0.03, num_leaves=31, min_child_samples=20, subsample=0.8,
                  subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, verbose=-1)
XGB_PARAMS = dict(n_estimators=400, learning_rate=0.03, max_depth=5, subsample=0.8, colsample_bytree=0.8,
                  tree_method="hist", enable_categorical=True)


def confidence_label(interval_width_pct: float, mape: float | None) -> str:
    """high: tight interval AND good track record. Without a track record, never 'high'."""
    if mape is None or not np.isfinite(mape):
        return "medium" if interval_width_pct <= 25 else "low"
    if interval_width_pct <= 20 and mape <= 10:
        return "high"
    if interval_width_pct <= 40 and mape <= 20:
        return "medium"
    return "low"


def enforce_monotone(q10: np.ndarray, q50: np.ndarray, q90: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Quantile crossing fix: sort each row's three predictions."""
    s = np.sort(np.vstack([q10, q50, q90]), axis=0)
    return s[0], s[1], s[2]


def _xy(df: pd.DataFrame, h: int) -> tuple[pd.DataFrame, pd.Series]:
    d = df.dropna(subset=[f"y_{h}", "lag_1m"])
    return d[FEATURES], d[f"y_{h}"]


@dataclass
class HorizonModel:
    horizon: int
    lgb_q: dict[float, lgb.LGBMRegressor] = field(default_factory=dict)
    xgb_med: xgb.XGBRegressor | None = None

    def fit(self, X: pd.DataFrame, y: pd.Series) -> "HorizonModel":
        for q in QUANTILES:
            m = lgb.LGBMRegressor(objective="quantile", alpha=q, **LGB_PARAMS)
            m.fit(X, y, categorical_feature=CATEGORICAL_FEATURES)
            self.lgb_q[q] = m
        self.xgb_med = xgb.XGBRegressor(objective="reg:quantileerror", quantile_alpha=0.5, **XGB_PARAMS)
        self.xgb_med.fit(X, y)
        return self

    def predict(self, X: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        q10 = self.lgb_q[0.1].predict(X)
        q90 = self.lgb_q[0.9].predict(X)
        # Ensemble the median: LightGBM and XGBoost errors are only partly correlated.
        q50 = 0.5 * self.lgb_q[0.5].predict(X) + 0.5 * self.xgb_med.predict(X)
        return enforce_monotone(q10, q50, q90)

    def explain(self, X: pd.DataFrame) -> tuple[float, np.ndarray]:
        """SHAP values of the LightGBM median model (log-ratio space)."""
        explainer = shap.TreeExplainer(self.lgb_q[0.5])
        values = explainer.shap_values(X)
        base = float(np.atleast_1d(explainer.expected_value)[0])
        return base, np.asarray(values)


def fit_all(df: pd.DataFrame) -> dict[int, HorizonModel]:
    out = {}
    for h in HORIZONS:
        X, y = _xy(df, h)
        out[h] = HorizonModel(h).fit(X, y)
    return out


def walk_forward_backtest(df: pd.DataFrame, n_origins: int = 6, min_train_months: int = 24) -> pd.DataFrame:
    months = sorted(df["month"].unique())
    rows = []
    for h in HORIZONS:
        origins = [m for m in months[min_train_months:] if (pd.Timestamp(m) + pd.DateOffset(months=h)) <= pd.Timestamp(months[-1])]
        for T in origins[-n_origins:]:
            T = pd.Timestamp(T)
            cutoff = T - pd.DateOffset(months=h)
            train = df[df["month"] <= cutoff]
            X, y = _xy(train, h)
            if len(X) < 50:
                continue
            m = HorizonModel(h).fit(X, y)
            test = df[(df["month"] == T)].dropna(subset=[f"y_{h}", "lag_1m"])
            if test.empty:
                continue
            q10, q50, q90 = m.predict(test[FEATURES])
            p0 = test["price"].to_numpy(float)
            actual = p0 * np.exp(test[f"y_{h}"].to_numpy(float))
            pred = p0 * np.exp(q50)
            rows.append(pd.DataFrame({
                "series_id": test["series_id"].to_numpy(), "horizon": h, "origin": T,
                "ape": np.abs(pred - actual) / actual * 100,
                "covered": (actual >= p0 * np.exp(q10)) & (actual <= p0 * np.exp(q90)),
            }))
    if not rows:
        return pd.DataFrame(columns=["series_id", "horizon", "origin", "ape", "covered"])
    return pd.concat(rows, ignore_index=True)


def series_metrics(bt: pd.DataFrame) -> pd.DataFrame:
    """Per-series, per-horizon MAPE and P10–P90 coverage."""
    if bt.empty:
        return pd.DataFrame(columns=["series_id", "horizon", "mape", "coverage", "n_folds"])
    return (bt.groupby(["series_id", "horizon"])
              .agg(mape=("ape", "mean"), coverage=("covered", "mean"), n_folds=("ape", "size"))
              .reset_index())


def top_contributions(shap_row: np.ndarray, x_row: pd.Series, price_now: float, k: int = 7) -> list[dict]:

    contrib = dict(zip(FEATURES, shap_row.astype(float)))
    season = contrib.pop("month_sin", 0.0) + contrib.pop("month_cos", 0.0)
    contrib["season"] = season
    total = sum(abs(v) for v in contrib.values()) or 1.0
    ranked = sorted(contrib.items(), key=lambda kv: abs(kv[1]), reverse=True)[:k]
    out = []
    for name, phi in ranked:
        out.append({
            "feature": name,
            "i18nKey": I18N_KEYS.get(name, f"forecast.feature.{name}"),
            "value": None if name == "season" else _clean(x_row.get(name)),
            "contribution": round(phi * price_now, 6),
            "sharePct": round(abs(phi) / total * 100, 2),
            "direction": "up" if phi >= 0 else "down",
        })
    return out


def _clean(v):
    """JSON-safe feature value: rounded float, category label, or None."""
    if v is None:
        return None
    if isinstance(v, str):
        return v
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    return round(f, 4) if np.isfinite(f) else None


def insight_key(change_pct: float) -> str:
    if change_pct >= 2:
        return "forecast.insight.up"
    if change_pct <= -2:
        return "forecast.insight.down"
    return "forecast.insight.flat"
