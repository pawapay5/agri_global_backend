from flows.fx import to_local_usd
from flows.wfp_prices import transform
from flows.weather import monthly


def test_fx_inverts_usd_based_rates():
    out = to_local_usd({"USD": 1, "GHS": 15.5, "EUR": 0.92}, ["USD", "GHS", "EUR", "XYZ"])
    assert set(out) == {"GHS", "EUR"}
    assert abs(out["GHS"] - 1 / 15.5) < 1e-12


def test_wfp_transform_maps_and_reports():
    rows = [
        {"date": "#date", "market": "#loc+market+name"},
        {"date": "2025-03-15", "market": "Techiman", "commodity": "Maize", "unit": "100 KG", "pricetype": "Wholesale", "currency": "GHS", "price": "1250", "priceflag": "actual"},
        {"date": "2025-03-15", "market": "Nowhere", "commodity": "Maize", "unit": "100 KG", "pricetype": "Wholesale", "currency": "GHS", "price": "1", "priceflag": "actual"},
        {"date": "2025-03-15", "market": "Techiman", "commodity": "Caviar", "unit": "KG", "pricetype": "Retail", "currency": "GHS", "price": "1", "priceflag": "actual"},
        {"date": "2025-03-15", "market": "Techiman", "commodity": "Maize", "unit": "Sack", "pricetype": "Retail", "currency": "GHS", "price": "1", "priceflag": "actual"},
        {"date": "2025-03-15", "market": "Techiman", "commodity": "Maize", "unit": "KG", "pricetype": "Retail", "currency": "GHS", "price": "13", "priceflag": "forecast"},
        {"date": "2024-01-15", "market": "Techiman", "commodity": "Maize", "unit": "KG", "pricetype": "Retail", "currency": "GHS", "price": "9", "priceflag": "actual"},
    ]
    out, skipped = transform(rows, {"techiman": "techiman"}, {"maize": "maize_white"}, {"100 KG": "bag_100kg", "KG": "kg"},
                             {"Wholesale": "wholesale", "Retail": "retail"}, since="2025-01-01")
    assert len(out) == 1
    assert out[0] | {} == {**out[0], "market_code": "techiman", "commodity_code": "maize_white", "unit": "bag_100kg", "price_type": "wholesale", "amount": "1250.0000"}
    assert out[0]["source_ref"].startswith("wfp:2025-03-15:techiman:maize:100 KG:wholesale")
    assert skipped == {"unmapped_market": 1, "unmapped_commodity": 1, "unmapped_unit": 1, "not_actual": 1, "before_since": 1}


def test_weather_monthly_aggregates_and_skips_partial_months():
    days = [f"2024-01-{d:02d}" for d in range(1, 32)] + ["2024-02-01", "2024-02-02"]
    m = monthly({"time": days, "precipitation_sum": [1.0] * len(days), "temperature_2m_mean": [27.0] * len(days)})
    assert len(m) == 1
    assert m.iloc[0]["precip_mm"] == 31.0 and m.iloc[0]["temp_mean_c"] == 27.0
