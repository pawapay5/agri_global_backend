import numpy as np
import pandas as pd
import pytest

from agriprice_ml.features import FEATURES, build_features
from agriprice_ml.model import (
    confidence_label, enforce_monotone, fit_all, insight_key, series_metrics, top_contributions, walk_forward_backtest,
)
from agriprice_ml.store import regularise
from agriprice_ml.train import forecast_latest


@pytest.fixture(scope="module")
def panel() -> pd.DataFrame:
    """Synthetic test fixture: 8 series × 48 months with a lean-season peak, trend and noise."""
    rng = np.random.default_rng(42)
    months = pd.date_range("2022-01-01", periods=48, freq="MS")
    rows = []
    for s in range(8):
        level = 5 + s
        for i, m in enumerate(months):
            season = 1 + 0.15 * np.sin(2 * np.pi * (m.month - 3) / 12)
            price = level * season * (1.005 ** i) * np.exp(rng.normal(0, 0.03))
            rows.append({
                "series_id": f"m:mkt{s}:com{s % 3}:wholesale", "commodity_code": f"c{s % 3}", "region_code": f"R{s % 4}",
                "market_type": "wholesale", "price_type": "wholesale", "month": m, "price": price,
                "precip_mm": 100 + 80 * np.sin(2 * np.pi * m.month / 12), "precip_normal_mm": 100.0, "temp_mean_c": 27.0,
                "fx_local_usd": 0.08 * (0.99 ** i), "harvest_months": [8, 9], "lean_months": [5, 6],
            })
    return pd.DataFrame(rows)


def test_features_have_no_target_leakage(panel):
    f = build_features(panel)
    s = f[f.series_id == f.series_id.iloc[0]].reset_index(drop=True)
    # y_1 at t equals log(p[t+1]/p[t]); lag_1m at t+1 equals the same quantity.
    np.testing.assert_allclose(s["y_1"].iloc[:-1].to_numpy(), s["lag_1m"].iloc[1:].to_numpy(), rtol=1e-9)
    assert s["y_6"].iloc[-6:].isna().all()
    assert set(FEATURES).issubset(f.columns)
    assert f["months_to_harvest"].between(0, 11).all()


def test_regularise_fills_short_gaps_only():
    p = pd.DataFrame({"series_id": "a", "commodity_code": "c", "month": pd.to_datetime(["2024-01-01", "2024-02-01", "2024-05-01", "2024-09-01"]),
                      "price": [10.0, 11.0, 14.0, 20.0]})
    r = regularise(p, max_gap=2).set_index("month")["price"]
    assert len(r) == 9
    assert np.isfinite(r["2024-03-01"]) and np.isfinite(r["2024-04-01"])  # 2-month gap filled
    assert np.isnan(r["2024-06-01"])  # 3-month gap left missing


def test_confidence_labels():
    assert confidence_label(15, 8) == "high"
    assert confidence_label(15, 15) == "medium"
    assert confidence_label(60, 5) == "low"
    assert confidence_label(15, None) == "medium"  # no track record → never high
    assert confidence_label(30, None) == "low"


def test_enforce_monotone():
    a, b, c = enforce_monotone(np.array([0.2, -0.1]), np.array([0.1, 0.0]), np.array([0.0, 0.1]))
    assert (a <= b).all() and (b <= c).all()


def test_backtest_and_forecast_end_to_end(panel):
    f = build_features(panel)
    bt = walk_forward_backtest(f, n_origins=3, min_train_months=24)
    assert not bt.empty and set(bt.horizon.unique()) == {1, 3, 6}
    m = series_metrics(bt)
    assert (m.mape >= 0).all() and m.coverage.between(0, 1).all()
    # The synthetic series is smooth: 1-month MAPE should be well under 15%.
    assert m[m.horizon == 1].mape.median() < 15

    models = fit_all(f)
    out = forecast_latest(f, models, m)
    assert len(out) == panel.series_id.nunique()
    for fc in out:
        assert [h["h"] for h in fc["horizons"]] == [1, 3, 6]
        for h in fc["horizons"]:
            assert h["p10"] <= h["p50"] <= h["p90"]
            assert h["confidence"] in {"high", "medium", "low"}
            assert h["mape"] is not None
            assert 1 <= len(h["features"]) <= 7
            assert sum(x["sharePct"] for x in h["features"]) <= 100.01
            assert all(x["i18nKey"].startswith("forecast.feature.") for x in h["features"])


def test_top_contributions_merges_season():
    phi = np.zeros(len(FEATURES))
    phi[FEATURES.index("month_sin")] = 0.02
    phi[FEATURES.index("month_cos")] = 0.01
    phi[FEATURES.index("lag_1m")] = -0.05
    x = pd.Series({f: 0.0 for f in FEATURES})
    out = top_contributions(phi, x, price_now=10.0, k=7)
    names = [o["feature"] for o in out]
    assert names[0] == "lag_1m" and "season" in names and "month_sin" not in names
    assert out[0]["direction"] == "down" and out[0]["contribution"] == pytest.approx(-0.5)
    assert out[0]["sharePct"] == pytest.approx(62.5)


def test_insight_key():
    assert insight_key(5) == "forecast.insight.up"
    assert insight_key(-3) == "forecast.insight.down"
    assert insight_key(1) == "forecast.insight.flat"
