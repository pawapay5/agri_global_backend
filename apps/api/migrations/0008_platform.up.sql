-- Reports, billing, content, support, public API keys, SMS/USSD.

CREATE TABLE short_links (
  code         text PRIMARY KEY,                -- base62, 8 chars
  target_type  text NOT NULL CHECK (target_type IN ('report','listing','post')),
  target_id    uuid NOT NULL,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE report_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('crop_price','market_analysis','forecast','regional','custom')),
  format       text NOT NULL CHECK (format IN ('pdf','xlsx','csv')),
  params       jsonb NOT NULL,                  -- {country, commodityIds, marketIds, regionIds, from, to, priceType, currency, unit, locale, sections}
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  object_key   text,
  bytes        bigint,
  error        text,
  short_code   text REFERENCES short_links(code) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
CREATE INDEX report_jobs_user_idx ON report_jobs (user_id, created_at DESC);

-- ── billing ──
CREATE TABLE plans (
  code          text PRIMARY KEY CHECK (code IN ('free','premium','organisation')),
  name          jsonb NOT NULL,
  -- {"GHS": {"monthly": "25.00", "yearly": "250.00"}, "USD": {...}}
  prices        jsonb NOT NULL DEFAULT '{}',
  -- {"forecast_horizons":[1,3,6], "alerts_max":50, "reports_per_month":20, "report_formats":["pdf","xlsx","csv"], "api_daily_quota":0, "export_insights":true, ...}
  entitlements  jsonb NOT NULL,
  -- provider product ids: {"revenuecat":"premium", "stripe":"price_...", "paystack":"PLN_...", "flutterwave":"..."}
  provider_ids  jsonb NOT NULL DEFAULT '{}',
  sort_order    int NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true
);

CREATE TABLE subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES users(id) ON DELETE CASCADE,
  organisation_id       uuid REFERENCES organisations(id) ON DELETE CASCADE,
  plan_code             text NOT NULL REFERENCES plans(code),
  provider              text NOT NULL CHECK (provider IN ('revenuecat','paystack','flutterwave','stripe','manual')),
  provider_ref          text NOT NULL,
  status                text NOT NULL CHECK (status IN ('trialing','active','past_due','cancelled','expired')),
  current_period_end    timestamptz,
  cancel_at_period_end  boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_ref),
  CHECK (user_id IS NOT NULL OR organisation_id IS NOT NULL)
);
CREATE TRIGGER subscriptions_updated BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX subscriptions_user_idx ON subscriptions (user_id) WHERE status IN ('trialing','active','past_due');
CREATE INDEX subscriptions_org_idx ON subscriptions (organisation_id) WHERE status IN ('trialing','active','past_due');

-- Idempotency store for every inbound webhook (billing, payments).
CREATE TABLE webhook_events (
  provider      text NOT NULL,
  event_id      text NOT NULL,
  kind          text NOT NULL,                  -- billing | payments
  type          text,
  payload       jsonb NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  error         text,
  PRIMARY KEY (provider, event_id)
);

-- ── content ──
CREATE TABLE success_stories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2  char(2) REFERENCES countries(iso2),
  title         jsonb NOT NULL,
  body          jsonb NOT NULL,
  person_name   text,
  person_role   text,
  region_id     uuid REFERENCES regions(id),
  image_key     text,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE faqs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2  char(2) REFERENCES countries(iso2),
  category      text NOT NULL,
  question      jsonb NOT NULL,
  answer        jsonb NOT NULL,
  sort_order    int NOT NULL DEFAULT 0,
  published     boolean NOT NULL DEFAULT true
);

CREATE TABLE help_articles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  country_iso2  char(2) REFERENCES countries(iso2),
  title         jsonb NOT NULL,
  body          jsonb NOT NULL,                 -- markdown per locale
  tags          text[] NOT NULL DEFAULT '{}',
  published_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Feature flags and app config. country_iso2 NULL = global default; a country row overrides it.
CREATE TABLE app_config (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2  char(2) REFERENCES countries(iso2),
  key           text NOT NULL,                  -- e.g. min_app_version.android, flag.marketplace
  value         jsonb NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_config_uq ON app_config (key, coalesce(country_iso2, '--'));

-- ── support ──
CREATE TABLE support_tickets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category      text NOT NULL CHECK (category IN ('account','prices','payments','marketplace','technical','other')),
  subject       text NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved','closed')),
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  order_id      uuid,
  helpdesk_ref  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER support_tickets_updated BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX support_tickets_user_idx ON support_tickets (user_id, created_at DESC);

CREATE TABLE support_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  from_staff   boolean NOT NULL DEFAULT false,
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  rating      smallint CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  context     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE issue_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  kind         text NOT NULL CHECK (kind IN ('bug','wrong_price','wrong_market','crash','other')),
  description  text NOT NULL,
  screen       text,
  app_version  text,
  device       jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','triaged','fixed','wont_fix')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── public data API ──
CREATE TABLE api_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id  uuid REFERENCES organisations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  prefix           text NOT NULL UNIQUE,         -- shown to the user, e.g. ak_live_3f9a1c2b
  key_hash         bytea NOT NULL UNIQUE,        -- sha256(secret); the secret is shown once
  scopes           text[] NOT NULL DEFAULT '{prices:read,forecasts:read,markets:read}',
  last_used_at     timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_owner_idx ON api_keys (owner_id);

CREATE TABLE api_usage_daily (
  key_id  uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  day     date NOT NULL,
  calls   int NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, day)
);

-- ── SMS / USSD ──
CREATE TABLE sms_inbound (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL,
  provider_ref text,
  from_hash    text NOT NULL,                    -- HMAC of the sender number; raw numbers aren't logged
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  text         text NOT NULL,
  command      text,
  reply        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_ref)
);
