CREATE TABLE organisations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  country_iso2  char(2) REFERENCES countries(iso2),
  type          text NOT NULL CHECK (type IN ('agency','ngo','cooperative','research','company','government')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  citext UNIQUE,
  phone                  text UNIQUE,
  email_verified_at      timestamptz,
  phone_verified_at      timestamptz,
  password_hash          text,
  full_name              text,
  avatar_url             text,
  role                   text NOT NULL DEFAULT 'farmer'
                         CHECK (role IN ('farmer','trader','consumer','researcher','student','policymaker','enumerator','admin','org_admin')),
  country_iso2           char(2) NOT NULL REFERENCES countries(iso2),
  organisation_id        uuid REFERENCES organisations(id),
  totp_secret_enc        text,         -- AES-256-GCM, see FieldCipher
  totp_pending_enc       text,
  totp_enabled_at        timestamptz,
  password_changed_at    timestamptz,
  deletion_requested_at  timestamptz,
  deletion_scheduled_at  timestamptz,
  last_login_at          timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX users_deletion_due_idx ON users (deletion_scheduled_at) WHERE deletion_scheduled_at IS NOT NULL;

CREATE TABLE oauth_identities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    text NOT NULL CHECK (provider IN ('google','apple','facebook')),
  subject     text NOT NULL,
  email       citext,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);
CREATE INDEX oauth_identities_user_idx ON oauth_identities (user_id);

CREATE TABLE devices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id  text NOT NULL,
  platform         text NOT NULL CHECK (platform IN ('android','ios','web')),
  name             text,
  app_version      text,
  push_token       text,
  last_ip          inet,
  user_agent       text,
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, installation_id)
);
CREATE INDEX devices_push_idx ON devices (user_id) WHERE push_token IS NOT NULL AND revoked_at IS NULL;

-- Rotating refresh tokens. A token is single-use; presenting a used token
-- (reuse) revokes its whole family.
CREATE TABLE refresh_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       uuid REFERENCES devices(id) ON DELETE CASCADE,
  family_id       uuid NOT NULL,
  parent_id       uuid REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  token_hash      bytea NOT NULL UNIQUE,  -- sha256(token)
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  revoked_at      timestamptz,
  revoked_reason  text,
  ip              inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_active_idx ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

CREATE TABLE recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz
);
CREATE INDEX recovery_codes_user_idx ON recovery_codes (user_id) WHERE used_at IS NULL;

CREATE TABLE user_preferences (
  user_id             uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  locale              text,
  currency            char(3) REFERENCES currencies(code),
  unit                text REFERENCES units(code),
  theme               text NOT NULL DEFAULT 'system' CHECK (theme IN ('system','light','dark')),
  default_region_id   uuid REFERENCES regions(id) ON DELETE SET NULL,
  default_price_type  text NOT NULL DEFAULT 'wholesale' CHECK (default_price_type IN ('retail','wholesale','farm_gate')),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE farming_profiles (
  user_id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  crop_ids             uuid[] NOT NULL DEFAULT '{}',
  farm_size            numeric(12,3) CHECK (farm_size IS NULL OR farm_size >= 0),
  area_unit            text CHECK (area_unit IN ('ha','acre','m2','plot')),
  farming_type         text CHECK (farming_type IN ('subsistence','commercial','mixed','organic','irrigated','rainfed')),
  region_id            uuid REFERENCES regions(id) ON DELETE SET NULL,
  years_of_experience  smallint CHECK (years_of_experience BETWEEN 0 AND 80),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_interests (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  commodity_ids  uuid[] NOT NULL DEFAULT '{}',
  market_ids     uuid[] NOT NULL DEFAULT '{}',
  topics         text[] NOT NULL DEFAULT '{}',
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE saved_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       text NOT NULL,
  point       geography(Point, 4326) NOT NULL,
  region_id   uuid REFERENCES regions(id) ON DELETE SET NULL,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_locations_user_idx ON saved_locations (user_id);
CREATE UNIQUE INDEX saved_locations_one_default ON saved_locations (user_id) WHERE is_default;

-- Append-only consent ledger. Current state = latest row per (user, type).
CREATE TABLE consents (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('terms','privacy','marketing','data_sharing_research','location','sms_alerts','whatsapp_alerts')),
  granted     boolean NOT NULL,
  version     text NOT NULL,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_user_type_idx ON consents (user_id, type, created_at DESC);

-- Security / admin audit trail. Hypertable so it can be retained and compressed cheaply.
CREATE TABLE audit_log (
  at          timestamptz NOT NULL DEFAULT now(),
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_id    uuid,
  action      text NOT NULL,
  entity      text,
  entity_id   text,
  ip          inet,
  user_agent  text,
  request_id  text,
  data        jsonb NOT NULL DEFAULT '{}'
);
SELECT create_hypertable('audit_log', by_range('at', INTERVAL '30 days'));
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id, at DESC);
