import base64, hashlib, hmac, json, time

import numpy as np
import pandas as pd
import pytest
from fastapi import HTTPException

from agriprice_ml import HORIZON_WEEKS
from agriprice_ml.app import verify_admin_jwt
from agriprice_ml.features import FEATURES, add_target_encoding, build_features, nearby_spread
from agriprice_ml.model import (beats_baseline, confidence_label, enforce_monotone, fit_all, global_metrics, guardrails, insight_key, model_card,
                                rolling_origin_cv, seasonal_naive, series_metrics, top_contributions)
from agriprice_ml.store import regularise
from agriprice_ml.train import predict_series

WEEKS = pd.date_range("2023-01-02", periods=130, freq="W-MON")


def _series(i, weeks, lat, lng, market=True, rng=None, end_offset=0):
    rng = rng or np.random.default_rng(i)
    rows = []
    for t, w in enumerate(weeks[: len(weeks) - end_offset]):
        season = 1 + 0.15 * np.sin(2 * np.pi * (w.day_of_year / 365.25 - 0.2))
        rows.append({"series_id": f"m:mkt{i}:com{i % 2}:wholesale" if market else f"r:reg{i}:com{i % 2}:wholesale", "commodity_code": f"c{i % 2}", "price_type": "wholesale",
                     "region_code": f"R{i % 3}", "market_id": f"mkt{i}" if market else None, "market_type": "wholesale", "lat": lat, "lng": lng,
                     "week": w, "price": (5 + i) * season * 1.001 ** t * np.exp(rng.normal(0, 0.02)),
                     "precip_mm": 100 + 60 * np.sin(2 * np.pi * w.month / 12), "precip_normal_mm": 100.0, "temp_mean_c": 27 + np.sin(w.month),
                     "fx_local_usd": 0.08 * 0.999 ** t, "holiday_days": 1 if w.month == 12 and w.day <= 7 else 0,
                     "harvest_months": [8, 9], "lean_months": [5, 6], "last_obs": w})
    return rows


@pytest.fixture(scope="module")
def panel() -> pd.DataFrame:
    """Synthetic test fixture: 6 market series (two close clusters) with seasonality, trend and noise."""
    coords = [(6.69, -1.62), (6.75, -1.60), (7.58, -1.93), (7.60, -1.90), (9.40, -0.85), (9.42, -0.84)]
    return pd.DataFrame([r for i, (la, ln) in enumerate(coords) for r in _series(i, WEEKS, la, ln)])


@pytest.fixture(scope="module")
def feat(panel):
    return build_features(panel)


def test_weekly_features_have_no_target_leakage(feat):
    s = feat[feat.series_id == feat.series_id.iloc[0]].reset_index(drop=True)
    k = HORIZON_WEEKS[1]
    np.testing.assert_allclose(s["y_1"].iloc[:-k].to_numpy(), s["lag_4w"].iloc[k:].to_numpy(), rtol=1e-9)
    assert s["y_6"].iloc[-HORIZON_WEEKS[6]:].isna().all()
    assert set(FEATURES).issubset(feat.columns)
    assert feat["holiday_week"].max() == 1 and feat["is_lean_season"].isin([0, 1]).all()


def test_nearby_spread_only_within_radius(feat):
    # c0 markets are mkt0, mkt2, mkt4 (~100+ km apart); mkt1 is close to mkt0 but trades c1.
    df = feat.copy()
    ns = nearby_spread(df, radius_km=20)
    assert ns[df.market_id == "mkt0"].isna().all()  # mkt1 is close but a different commodity (c1)
    ns_far = nearby_spread(df, radius_km=500)
    assert ns_far[df.market_id == "mkt0"].notna().any()


def test_target_encoding_uses_training_rows_only(feat):
    train = feat[feat.week < WEEKS[60]]
    test = feat[feat.week >= WEEKS[60]].copy()
    test["y_1"] = 99.0  # poisoned future targets must not affect the encoding
    enc = add_target_encoding(train, test, 1)
    assert enc["te_market"].abs().max() < 1


def test_regularise_fills_short_gaps_only():
    p = pd.DataFrame({"series_id": "a", "commodity_code": "c", "week": pd.to_datetime(["2024-01-01", "2024-01-08", "2024-01-29", "2024-03-04"]), "price": [10.0, 11, 14, 20]})
    r = regularise(p, max_gap=2).set_index("week")["price"]
    assert np.isfinite(r["2024-01-15"]) and np.isfinite(r["2024-01-22"])
    assert np.isnan(r["2024-02-12"])


def test_seasonal_naive_uses_same_week_last_year(feat):
    row = feat[(feat.series_id == feat.series_id.iloc[0]) & (feat.week == WEEKS[70])]
    target = WEEKS[70] + pd.Timedelta(weeks=4 - 52)
    expected = feat[(feat.series_id == row.series_id.iloc[0]) & (feat.week == target)]["price"].iloc[0]
    assert seasonal_naive(feat, row, 1)[0] == pytest.approx(expected)


def test_guardrails():
    asof = pd.Timestamp("2026-06-30")
    assert guardrails(20, asof, asof, {1: 5.0}) == (["insufficient_history"], {})
    assert guardrails(60, asof - pd.Timedelta(days=30), asof, {1: 5.0})[0] == ["stale_data"]
    assert guardrails(60, asof, asof, {1: 10.0, 3: 30.0, 6: None}) == ([], {3: "backtest_mape_above_25"})


def test_promotion_gate():
    assert beats_baseline({"mape_h1": 8, "baseline_mape_h1": 10, "mape_h3": 12, "baseline_mape_h3": 11})
    assert not beats_baseline({"mape_h1": 12, "baseline_mape_h1": 10})
    assert not beats_baseline({})


def test_helpers():
    assert confidence_label(15, 8) == "high" and confidence_label(15, None) == "medium"
    a, b, c = enforce_monotone(np.array([0.2]), np.array([0.0]), np.array([0.1]))
    assert a[0] <= b[0] <= c[0]
    assert insight_key(5) == "forecast.insight.up"
    phi = np.zeros(len(FEATURES)); phi[FEATURES.index("lag_1w")] = -0.05; phi[FEATURES.index("month_sin")] = 0.02
    out = top_contributions(phi, pd.Series({f: 0.0 for f in FEATURES}), 10.0)
    assert out[0]["feature"] == "lag_1w" and "season" in [o["feature"] for o in out]


def test_cv_predict_and_guardrails_end_to_end(panel):
    short = pd.DataFrame(_series(7, WEEKS[-20:], 5.6, -0.2))                     # 20 weeks of history
    stale = pd.DataFrame(_series(8, WEEKS, 5.1, -1.2, end_offset=6))             # last data 6 weeks ago
    full = pd.concat([panel, short, stale], ignore_index=True)
    f = build_features(full)
    bt = rolling_origin_cv(f, n_origins=2, step_weeks=8, min_train_weeks=40)
    m = series_metrics(bt)
    assert {"mape", "smape", "baseline_mape", "coverage"}.issubset(m.columns) and (m.smape >= 0).all()
    gm = global_metrics(bt)
    assert {"mape_h1", "smape_h1", "coverage_h1", "baseline_mape_h1"}.issubset(gm)
    models = fit_all(f)
    out = {o["market_id"]: o for o in predict_series(f, models, m, as_of=WEEKS[-1] + pd.Timedelta(days=2))}
    assert out["mkt7"]["status"] == "insufficient_data" and "insufficient_history" in out["mkt7"]["suppression"]["run"]
    assert out["mkt8"]["status"] == "insufficient_data" and "stale_data" in out["mkt8"]["suppression"]["run"]
    ok = [o for o in out.values() if o["status"] == "available"]
    assert ok
    for o in ok:
        for h in o["horizons"]:
            assert h["p10"] <= h["p50"] <= h["p90"]
            assert 1 <= len(h["features"]) <= 7
            assert h["mape"] is None or h["mape"] <= 25
    card = model_card(version="v", country="GH", panel=full, metrics=gm, promoted=True, n_forecasts=len(out), n_suppressed=2)
    assert card["guardrails"]["minHistoryWeeks"] == 26 and card["evaluation"]["mape_h1"] == gm["mape_h1"]


def _jwt(payload: dict, secret: str) -> str:
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()  # noqa: E731
    h, p = enc({"alg": "HS256", "typ": "at+jwt"}), enc(payload)
    sig = base64.urlsafe_b64encode(hmac.new(secret.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    return f"{h}.{p}.{sig}"


def test_admin_jwt_verification():
    good = {"sub": "u", "role": "admin", "iss": "agriprice", "aud": "agriprice-api", "exp": time.time() + 60}
    assert verify_admin_jwt(_jwt(good, "s" * 40), "s" * 40)["role"] == "admin"
    with pytest.raises(HTTPException) as e:
        verify_admin_jwt(_jwt({**good, "role": "farmer"}, "s" * 40), "s" * 40)
    assert e.value.status_code == 403
    for bad in (_jwt(good, "x" * 40), _jwt({**good, "exp": time.time() - 1}, "s" * 40), "a.b"):
        with pytest.raises(HTTPException):
            verify_admin_jwt(bad, "s" * 40)
