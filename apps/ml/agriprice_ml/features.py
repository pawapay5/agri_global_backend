"""Weekly feature engineering.

Input panel: one row per (series_id, week) with
  series_id, commodity_code, price_type, region_code, market_id (None for region series), market_type, lat, lng,
  week (Monday, Timestamp), price (per kg, local currency) and optional exogenous columns:
  precip_mm, precip_normal_mm, temp_mean_c, fx_local_usd, fuel_price, harvest_months, lean_months, holiday_days.

Targets: y_<h> = log(price[t + weeks(h)] / price[t]) for public horizons h in months (1, 3, 6 → 4, 13, 26 weeks).
Target encodings of market and region are added at fit time (model.py) from training rows only.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import HORIZON_WEEKS

LAGS = (1, 2, 4, 8, 12)
NUMERIC_FEATURES = [
    *[f"lag_{k}w" for k in LAGS],
    "roll_mean_4w", "roll_mean_12w", "roll_std_4w", "roll_std_12w",
    "month_sin", "month_cos", "months_to_harvest", "is_lean_season", "is_harvest_season",
    "nearby_spread", "rain_anomaly", "temp_anomaly",
    "fx_change_4w", "fx_change_12w", "fuel_change_12w",
    "holiday_week", "holiday_next_2w",
    "te_market", "te_region",
]
CATEGORICAL_FEATURES = ["commodity", "market_type"]
FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES
TE_FEATURES = ("te_market", "te_region")

I18N_KEYS = {f: f"forecast.feature.{f}" for f in FEATURES}
I18N_KEYS["season"] = "forecast.feature.month_sin"

NEARBY_KM = 100.0


def _months_until(month: int, targets) -> float:
    if targets is None or (hasattr(targets, "__len__") and len(targets) == 0):
        return np.nan
    return float(min((int(t) - month) % 12 for t in targets))


def _in(month: int, months) -> float:
    if months is None or (hasattr(months, "__len__") and len(months) == 0):
        return np.nan
    return float(month in set(int(m) for m in months))


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = p2 - p1, np.radians(lng2) - np.radians(lng1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


def nearby_spread(df: pd.DataFrame, radius_km: float = NEARBY_KM) -> pd.Series:
    """log price minus the mean log price of other markets within radius (same commodity, price type, week)."""
    out = pd.Series(np.nan, index=df.index)
    m = df[df["market_id"].notna() & df["lat"].notna() & df["lng"].notna()]
    for (_, _), g in m.groupby(["commodity_code", "price_type"]):
        mk = g.drop_duplicates("market_id")[["market_id", "lat", "lng"]].reset_index(drop=True)
        if len(mk) < 2:
            continue
        d = haversine_km(mk["lat"].to_numpy()[:, None], mk["lng"].to_numpy()[:, None], mk["lat"].to_numpy()[None, :], mk["lng"].to_numpy()[None, :])
        neigh = {mk.at[i, "market_id"]: set(mk.loc[(d[i] <= radius_km) & (d[i] > 0), "market_id"]) for i in range(len(mk))}
        for _, wk in g.groupby("week"):
            lp = dict(zip(wk["market_id"], wk["_logp"]))
            for idx, mid in zip(wk.index, wk["market_id"]):
                vals = [lp[n] for n in neigh.get(mid, ()) if n in lp]
                if vals:
                    out.at[idx] = lp[mid] - float(np.mean(vals))
    return out


def build_features(panel: pd.DataFrame) -> pd.DataFrame:
    df = panel.sort_values(["series_id", "week"]).copy()
    df["week"] = pd.to_datetime(df["week"])
    for c in ("market_id", "lat", "lng"):
        if c not in df:
            df[c] = None if c == "market_id" else np.nan
    df["_logp"] = np.log(df["price"].astype(float))
    g = df.groupby("series_id", group_keys=False)

    for k in LAGS:
        df[f"lag_{k}w"] = df["_logp"] - g["_logp"].shift(k)
    for w in (4, 12):
        df[f"roll_mean_{w}w"] = df["_logp"] - g["_logp"].transform(lambda s, w=w: s.rolling(w, min_periods=max(2, w // 2)).mean())
        df[f"roll_std_{w}w"] = g["_logp"].transform(lambda s, w=w: s.diff().rolling(w, min_periods=max(2, w // 2)).std())

    m = df["week"].dt.month
    df["month_sin"] = np.sin(2 * np.pi * m / 12)
    df["month_cos"] = np.cos(2 * np.pi * m / 12)
    harvest = df["harvest_months"] if "harvest_months" in df else pd.Series([None] * len(df), index=df.index)
    lean = df["lean_months"] if "lean_months" in df else pd.Series([None] * len(df), index=df.index)
    df["months_to_harvest"] = [_months_until(mm, h) for mm, h in zip(m, harvest)]
    df["is_harvest_season"] = [_in(mm, h) for mm, h in zip(m, harvest)]
    df["is_lean_season"] = [_in(mm, l) for mm, l in zip(m, lean)]

    df["nearby_spread"] = nearby_spread(df)

    if "precip_mm" in df and "precip_normal_mm" in df:
        df["rain_anomaly"] = df["precip_mm"] / df["precip_normal_mm"].replace(0, np.nan) - 1
    else:
        df["rain_anomaly"] = np.nan
    if "temp_mean_c" in df:
        # Temperature normal = same calendar month mean for the region within the panel's history.
        normal = df.groupby([df.get("region_code", pd.Series("", index=df.index)), m])["temp_mean_c"].transform("mean")
        df["temp_anomaly"] = df["temp_mean_c"] - normal
    else:
        df["temp_anomaly"] = np.nan

    for col, out, k in (("fx_local_usd", "fx_change_4w", 4), ("fx_local_usd", "fx_change_12w", 12), ("fuel_price", "fuel_change_12w", 12)):
        if col in df and df[col].notna().any():
            lv = np.log(df[col].astype(float))
            df[out] = lv - lv.groupby(df["series_id"]).shift(k)
        else:
            df[out] = np.nan

    hol = df["holiday_days"].fillna(0) if "holiday_days" in df else pd.Series(0, index=df.index)
    df["holiday_week"] = (hol > 0).astype(float)
    nxt = hol.groupby(df["series_id"]).shift(-1).fillna(0) + hol.groupby(df["series_id"]).shift(-2).fillna(0)
    df["holiday_next_2w"] = (nxt > 0).astype(float)

    df["commodity"] = df["commodity_code"].astype("category")
    df["market_type"] = df.get("market_type", pd.Series("region", index=df.index)).fillna("region").astype("category")
    df["te_market"] = np.nan
    df["te_region"] = np.nan

    for h, wks in HORIZON_WEEKS.items():
        df[f"y_{h}"] = g["_logp"].shift(-wks) - df["_logp"]
    return df


def add_target_encoding(train: pd.DataFrame, apply_to: pd.DataFrame, h: int, smoothing: float = 20.0) -> pd.DataFrame:
    """Smoothed mean of the training target per market and per region. Fit on training rows only (no leakage)."""
    y = train[f"y_{h}"]
    mu = float(y.mean()) if y.notna().any() else 0.0
    out = apply_to.copy()
    for key, col in (("market_id", "te_market"), ("region_code", "te_region")):
        if key not in train:
            out[col] = mu
            continue
        stats = train.dropna(subset=[f"y_{h}"]).groupby(key)[f"y_{h}"].agg(["sum", "count"])
        enc = (stats["sum"] + smoothing * mu) / (stats["count"] + smoothing)
        out[col] = out[key].map(enc).astype(float).fillna(mu)
    return out
