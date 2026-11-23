

from __future__ import annotations

import numpy as np
import pandas as pd

from . import HORIZONS

NUMERIC_FEATURES = [
    "lag_1m", "lag_3m", "lag_12m", "rolling_mean_3m", "rolling_std_3m", "momentum_1m",
    "month_sin", "month_cos", "months_to_harvest", "is_lean_season",
    "rainfall_30d", "rainfall_anomaly_90d", "temp_mean_30d",
    "fx_local_usd", "fx_change_3m", "fuel_price",
    "regional_spread", "national_mean_ratio",
]
CATEGORICAL_FEATURES = ["commodity", "region", "market_type"]
FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES

# Feature → i18n key used by the API/clients. month_sin/cos are merged into one "season" driver.
I18N_KEYS = {f: f"forecast.feature.{f}" for f in FEATURES}
I18N_KEYS["season"] = "forecast.feature.month_sin"


def _months_until(month: int, targets: list[int] | None) -> float:
    if not targets:
        return np.nan
    return float(min((t - month) % 12 for t in targets))


def build_features(panel: pd.DataFrame) -> pd.DataFrame:
    """Returns the panel with feature columns and y_{h} targets (NaN where the future is unknown)."""
    df = panel.sort_values(["series_id", "month"]).copy()
    df["month"] = pd.to_datetime(df["month"])
    g = df.groupby("series_id", group_keys=False)

    logp = np.log(df["price"].astype(float))
    df["_logp"] = logp
    # Lags are expressed relative to the current price (log ratio), so they're scale-free.
    for k, name in ((1, "lag_1m"), (3, "lag_3m"), (12, "lag_12m")):
        df[name] = df["_logp"] - g["_logp"].shift(k)
    roll_mean = g["_logp"].transform(lambda s: s.rolling(3, min_periods=2).mean())
    df["rolling_mean_3m"] = df["_logp"] - roll_mean
    df["rolling_std_3m"] = g["_logp"].transform(lambda s: s.diff().rolling(3, min_periods=2).std())
    df["momentum_1m"] = g["_logp"].diff() - g["_logp"].diff().shift(1)

    m = df["month"].dt.month
    df["month_sin"] = np.sin(2 * np.pi * m / 12)
    df["month_cos"] = np.cos(2 * np.pi * m / 12)
    harvest = df.get("harvest_months", pd.Series([None] * len(df), index=df.index))
    lean = df.get("lean_months", pd.Series([None] * len(df), index=df.index))
    df["months_to_harvest"] = [_months_until(mm, h) for mm, h in zip(m, harvest)]
    df["is_lean_season"] = [float(mm in l) if isinstance(l, (list, tuple, np.ndarray)) and len(l) else np.nan for mm, l in zip(m, lean)]

    # Weather: monthly precipitation and anomaly (3-month window, relative to normal).
    precip = df.get("precip_mm")
    if precip is not None:
        df["rainfall_30d"] = precip
        normal = df.get("precip_normal_mm")
        p3 = g["precip_mm"].transform(lambda s: s.rolling(3, min_periods=1).sum())
        n3 = g["precip_normal_mm"].transform(lambda s: s.rolling(3, min_periods=1).sum()) if normal is not None else np.nan
        df["rainfall_anomaly_90d"] = (p3 - n3) / n3.replace(0, np.nan) if normal is not None else np.nan
    else:
        df["rainfall_30d"] = np.nan
        df["rainfall_anomaly_90d"] = np.nan
    df["temp_mean_30d"] = df.get("temp_mean_c", np.nan)

    fx = df.get("fx_local_usd")
    df["fx_local_usd"] = fx if fx is not None else np.nan
    df["fx_change_3m"] = g["fx_local_usd"].transform(lambda s: np.log(s) - np.log(s.shift(3))) if fx is not None else np.nan
    df["fuel_price"] = df.get("fuel_price", np.nan)

    # Cross-sectional context: this series vs. the same commodity elsewhere in the same month.
    grp = df.groupby(["commodity_code", "price_type", "month"]) if "price_type" in df else df.groupby(["commodity_code", "month"])
    nat_mean = grp["_logp"].transform("mean")
    df["national_mean_ratio"] = df["_logp"] - nat_mean
    df["regional_spread"] = grp["_logp"].transform(lambda s: s.max() - s.min() if len(s) > 1 else np.nan)

    for c, src in (("commodity", "commodity_code"), ("region", "region_code"), ("market_type", "market_type")):
        df[c] = df[src].astype("category") if src in df else pd.Categorical(["unknown"] * len(df))

    for h in HORIZONS:
        df[f"y_{h}"] = g["_logp"].shift(-h) - df["_logp"]
    return df.drop(columns=["_logp"])
