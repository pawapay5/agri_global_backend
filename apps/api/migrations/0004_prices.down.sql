-- migrate:no-transaction
DROP TABLE IF EXISTS aggregate_watermarks;
DROP MATERIALIZED VIEW IF EXISTS price_weekly;
DROP MATERIALIZED VIEW IF EXISTS price_daily;
DROP TABLE IF EXISTS price_observations;
DROP TABLE IF EXISTS price_import_batches;
