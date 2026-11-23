DROP FUNCTION IF EXISTS set_updated_at();
DROP FUNCTION IF EXISTS jsonb_text_values(jsonb);
DROP FUNCTION IF EXISTS immutable_unaccent(text);
-- Extensions are left installed on purpose: dropping postgis/timescaledb on a shared
-- database is destructive beyond this schema. Drop manually if really required.
