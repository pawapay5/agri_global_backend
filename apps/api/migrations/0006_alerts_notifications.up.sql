CREATE TABLE alerts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commodity_id            uuid NOT NULL REFERENCES commodities(id),
  market_id               uuid REFERENCES markets(id),
  region_id               uuid REFERENCES regions(id),
  country_iso2            char(2) NOT NULL REFERENCES countries(iso2),
  price_type              text NOT NULL DEFAULT 'wholesale' CHECK (price_type IN ('retail','wholesale','farm_gate')),
  condition               text NOT NULL CHECK (condition IN ('above','below','pct_change')),
  threshold               numeric(18,6) NOT NULL,
  threshold_currency      char(3),
  threshold_unit          text REFERENCES units(code),
  -- threshold normalised to per-kg local currency at creation time (null for pct_change)
  threshold_per_kg_local  numeric(18,6),
  pct_window_days         smallint NOT NULL DEFAULT 7 CHECK (pct_window_days BETWEEN 1 AND 90),
  channels                text[] NOT NULL CHECK (cardinality(channels) > 0
                            AND channels <@ ARRAY['push','email','sms','whatsapp','in_app']),
  cooldown_hours          smallint NOT NULL DEFAULT 24 CHECK (cooldown_hours BETWEEN 1 AND 168),
  active                  boolean NOT NULL DEFAULT true,
  -- edge-trigger state: we only fire on a transition into the condition
  last_state              boolean,
  last_triggered_at       timestamptz,
  trigger_count           int NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (condition = 'pct_change' OR threshold_per_kg_local IS NOT NULL)
);
CREATE TRIGGER alerts_updated BEFORE UPDATE ON alerts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX alerts_user_idx ON alerts (user_id);
CREATE INDEX alerts_series_idx ON alerts (commodity_id, price_type) WHERE active;

CREATE TABLE alert_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id           uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commodity_id       uuid NOT NULL REFERENCES commodities(id),
  market_id          uuid REFERENCES markets(id),
  condition          text NOT NULL,
  observed_value     numeric(18,6) NOT NULL,     -- per kg local
  threshold          numeric(18,6) NOT NULL,
  change_pct         real,
  direction          text NOT NULL CHECK (direction IN ('above','below')),
  -- idempotency: one event per alert per evaluated aggregate bucket
  dedupe_key         text NOT NULL UNIQUE,
  delivered_channels text[] NOT NULL DEFAULT '{}',
  suppressed_reason  text CHECK (suppressed_reason IN ('quiet_hours')),
  triggered_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alert_events_user_idx ON alert_events (user_id, triggered_at DESC);
CREATE INDEX alert_events_alert_idx ON alert_events (alert_id, triggered_at DESC);

CREATE TABLE notification_preferences (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  categories       jsonb NOT NULL DEFAULT '{}',
  quiet_start      time,
  quiet_end        time,
  timezone         text,
  whatsapp_number  text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    text NOT NULL CHECK (category IN ('price_alert','market_update','weather','system','weekly_insight')),
  template_key text,
  title       text NOT NULL,
  body        text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  dedupe_key  text UNIQUE,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_inbox_idx ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id, category) WHERE read_at IS NULL;

CREATE TABLE notification_templates (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key       text NOT NULL,
  channel   text NOT NULL CHECK (channel IN ('push','email','sms','whatsapp','in_app')),
  locale    text NOT NULL,
  subject   text,
  body      text NOT NULL,           -- {{mustache}} placeholders
  provider_template text,            -- e.g. WhatsApp approved template name
  UNIQUE (key, channel, locale)
);

CREATE TABLE notification_deliveries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id      uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel              text NOT NULL CHECK (channel IN ('push','email','sms','whatsapp','in_app')),
  provider             text NOT NULL,
  status               text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed','bounced','skipped')),
  provider_message_id  text,
  attempts             smallint NOT NULL DEFAULT 0,
  last_error           text,
  sent_at              timestamptz,
  delivered_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, channel)
);
CREATE INDEX notification_deliveries_provider_idx ON notification_deliveries (provider, provider_message_id);
