"""AgriPrice forecasting package (weekly panel)."""

QUANTILES = (0.1, 0.5, 0.9)
# Public horizons are in months (contract); the model works on weeks.
HORIZON_WEEKS = {1: 4, 3: 13, 6: 26}
HORIZONS = tuple(HORIZON_WEEKS)
MODEL_NAME = "price-quantile-gbm"

# Guardrails: no forecast is better than a misleading one.
MIN_HISTORY_WEEKS = 26
MAX_STALENESS_DAYS = 21
MAX_BACKTEST_MAPE = 25.0
