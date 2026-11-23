-- Marketplace, orders, payments, double-entry ledger, payouts, disputes.
-- Customer funds stay in the licensed PSP's settlement account; the ledger tracks
-- who those funds belong to, and payouts and refunds are executed by the PSP.

CREATE TABLE seller_profiles (
  user_id             uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name        text NOT NULL,
  bio                 text,
  country_iso2        char(2) NOT NULL REFERENCES countries(iso2),
  region_id           uuid REFERENCES regions(id),
  location            geography(Point, 4326),
  kyc_status          text NOT NULL DEFAULT 'none' CHECK (kyc_status IN ('none','pending','verified','rejected')),
  kyc_provider_ref    text,
  verified_at         timestamptz,
  rating_avg          numeric(3,2),
  rating_count        int NOT NULL DEFAULT 0,
  response_time_mins  int,                         -- median first-response time in conversations (rolling 30 days)
  -- {"pickup": {"enabled": true}, "standard": {"enabled": true, "fee": "15.00", "days": 3}, "express": {...}}
  delivery_settings   jsonb NOT NULL DEFAULT '{"pickup": {"enabled": true}}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER seller_profiles_updated BEFORE UPDATE ON seller_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE listings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id            uuid NOT NULL REFERENCES seller_profiles(user_id) ON DELETE CASCADE,
  country_iso2         char(2) NOT NULL REFERENCES countries(iso2),
  type                 text NOT NULL CHECK (type IN ('product','service')),
  service_kind         text CHECK (service_kind IN ('transport','storage','input_supply')),
  category_id          uuid REFERENCES commodity_categories(id),
  commodity_id         uuid REFERENCES commodities(id),
  title                text NOT NULL,
  description          text,
  price_per_unit       numeric(18,4) NOT NULL CHECK (price_per_unit > 0),
  currency             char(3) NOT NULL REFERENCES currencies(code),
  unit_code            text NOT NULL REFERENCES units(code),
  price_per_kg_local   numeric(18,6),               -- for market-average comparison (products only)
  quantity             numeric(18,3) NOT NULL CHECK (quantity >= 0),
  min_order_qty        numeric(18,3) NOT NULL DEFAULT 1 CHECK (min_order_qty > 0),
  low_stock_threshold  numeric(18,3),
  quality_grade        text CHECK (quality_grade IN ('A','B','C','ungraded')),
  harvest_date         date,
  region_id            uuid REFERENCES regions(id),
  location             geography(Point, 4326),
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','low_stock','sold_out','removed')),
  price_flag           text CHECK (price_flag IN ('far_above_market','far_below_market')),
  price_deviation_pct  real,
  search               tsvector GENERATED ALWAYS AS (to_tsvector('simple', immutable_unaccent(title || ' ' || coalesce(description, '')))) STORED,
  published_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (type = 'product' OR service_kind IS NOT NULL)
);
CREATE TRIGGER listings_updated BEFORE UPDATE ON listings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX listings_search_idx ON listings USING gin (search);
CREATE INDEX listings_browse_idx ON listings (country_iso2, status, published_at DESC);
CREATE INDEX listings_location_idx ON listings USING gist (location);
CREATE INDEX listings_seller_idx ON listings (seller_id);

CREATE TABLE listing_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  position      smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
  variants      jsonb NOT NULL,                     -- {"thumb": key, "medium": key, "large": key}
  width         int,
  height        int,
  sha256        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, position)
);

CREATE TABLE favourites (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id  uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE offers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id       uuid REFERENCES offers(id),       -- counter-offer chain
  from_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quantity        numeric(18,3) NOT NULL CHECK (quantity > 0),
  price_per_unit  numeric(18,4) NOT NULL CHECK (price_per_unit > 0),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected','countered','expired','withdrawn','used')),
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offers_buyer_idx ON offers (buyer_id, created_at DESC);
CREATE INDEX offers_seller_idx ON offers (seller_id, created_at DESC);

CREATE TABLE cart_items (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id  uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  quantity    numeric(18,3) NOT NULL CHECK (quantity > 0),
  offer_id    uuid REFERENCES offers(id),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE checkouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency    char(3) NOT NULL,
  total       numeric(18,2) NOT NULL,
  idempotency_key text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_id, idempotency_key)
);

CREATE TABLE orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_id        uuid NOT NULL REFERENCES checkouts(id),
  buyer_id           uuid NOT NULL REFERENCES users(id),
  seller_id          uuid NOT NULL REFERENCES users(id),
  country_iso2       char(2) NOT NULL REFERENCES countries(iso2),
  category_id        uuid REFERENCES commodity_categories(id),
  currency           char(3) NOT NULL,
  status             text NOT NULL DEFAULT 'pending_payment' CHECK (status IN
                       ('pending_payment','paid_in_escrow','accepted','in_transit','delivered','completed','cancelled','disputed','refunded')),
  subtotal           numeric(18,2) NOT NULL,
  delivery_fee       numeric(18,2) NOT NULL DEFAULT 0,
  commission         numeric(18,2) NOT NULL DEFAULT 0,
  total              numeric(18,2) NOT NULL,
  payment_method     text NOT NULL CHECK (payment_method IN ('momo','card','pay_on_delivery')),
  delivery_option    text NOT NULL CHECK (delivery_option IN ('pickup','standard','express')),
  delivery_address   jsonb,
  state_deadline_at  timestamptz,                   -- when the current state times out
  version            int NOT NULL DEFAULT 0,        -- optimistic concurrency
  paid_at            timestamptz,
  accepted_at        timestamptz,
  shipped_at         timestamptz,
  delivered_at       timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (buyer_id <> seller_id)
);
CREATE TRIGGER orders_updated BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX orders_buyer_idx ON orders (buyer_id, created_at DESC);
CREATE INDEX orders_seller_idx ON orders (seller_id, created_at DESC);
CREATE INDEX orders_deadline_idx ON orders (state_deadline_at) WHERE status NOT IN ('completed','cancelled','refunded');

CREATE TABLE order_items (
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  listing_id      uuid NOT NULL REFERENCES listings(id),
  offer_id        uuid REFERENCES offers(id),
  title           text NOT NULL,
  quantity        numeric(18,3) NOT NULL,
  unit_code       text NOT NULL,
  price_per_unit  numeric(18,4) NOT NULL,
  line_total      numeric(18,2) NOT NULL,
  PRIMARY KEY (order_id, listing_id)
);

CREATE TABLE order_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status  text,
  to_status    text NOT NULL,
  actor_id     uuid,
  actor_role   text NOT NULL CHECK (actor_role IN ('buyer','seller','admin','system')),
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id, id);

CREATE TABLE reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reviewer_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating       smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, reviewer_id)
);
CREATE INDEX reviews_seller_idx ON reviews (seller_id, created_at DESC);

-- ── payments ──
CREATE TABLE payment_methods (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    text NOT NULL CHECK (provider IN ('paystack','flutterwave','hubtel')),
  type        text NOT NULL CHECK (type IN ('card','momo')),
  token       text NOT NULL,                        -- PSP authorization/token only; never a PAN or PIN
  label       text NOT NULL,                        -- e.g. "VISA •••• 4242", "MTN •••• 567"
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, token)
);

CREATE TABLE payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders(id),
  payer_id      uuid NOT NULL REFERENCES users(id),
  provider      text NOT NULL CHECK (provider IN ('paystack','flutterwave','hubtel','cash')),
  method        text NOT NULL CHECK (method IN ('momo','card','pay_on_delivery')),
  network       text CHECK (network IN ('mtn','telecel','airteltigo')),
  reference     text NOT NULL UNIQUE,               -- our reference sent to the PSP
  provider_ref  text,
  amount        numeric(18,2) NOT NULL CHECK (amount > 0),
  currency      char(3) NOT NULL,
  status        text NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated','pending','succeeded','failed','refunded','partially_refunded')),
  refunded      numeric(18,2) NOT NULL DEFAULT 0,
  payer_msisdn_enc text,                            -- AES-GCM; only needed for MoMo refunds via transfer (Hubtel)
  failure_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER payments_updated BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX payments_order_idx ON payments (order_id);

-- Double-entry ledger. Amounts are positive; direction says which side.
CREATE TABLE ledger_accounts (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code      text NOT NULL UNIQUE,                   -- e.g. escrow:GHS, seller:<uuid>:GHS, psp_clearing:paystack:GHS, platform_fees:GHS
  kind      text NOT NULL CHECK (kind IN ('psp_clearing','escrow','seller','buyer','platform_fees','cash_on_delivery')),
  -- asset = debit-normal, liability/revenue = credit-normal
  normal    text NOT NULL CHECK (normal IN ('debit','credit')),
  currency  char(3) NOT NULL,
  owner_id  uuid
);

CREATE TABLE ledger_transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('payment_captured','escrow_release','refund','payout','payout_reversal','adjustment')),
  reference   text NOT NULL UNIQUE,                 -- idempotency (e.g. capture:<payment_id>)
  order_id    uuid REFERENCES orders(id),
  payment_id  uuid REFERENCES payments(id),
  payout_id   uuid,
  memo        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id  uuid NOT NULL REFERENCES ledger_transactions(id),
  account_id      uuid NOT NULL REFERENCES ledger_accounts(id),
  direction       text NOT NULL CHECK (direction IN ('debit','credit')),
  amount          numeric(18,2) NOT NULL CHECK (amount > 0),
  currency        char(3) NOT NULL
);
CREATE INDEX ledger_entries_account_idx ON ledger_entries (account_id, id);
CREATE INDEX ledger_entries_tx_idx ON ledger_entries (transaction_id);

-- Every transaction must balance per currency, and entries are immutable.
CREATE OR REPLACE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bad record;
BEGIN
  SELECT currency, sum(CASE direction WHEN 'debit' THEN amount ELSE -amount END) AS diff
    INTO bad FROM ledger_entries WHERE transaction_id = NEW.transaction_id GROUP BY currency
    HAVING sum(CASE direction WHEN 'debit' THEN amount ELSE -amount END) <> 0 LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'ledger transaction % unbalanced in % by %', NEW.transaction_id, bad.currency, bad.diff; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

CREATE OR REPLACE FUNCTION ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ledger entries are append-only; post a reversing transaction instead'; END $$;
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

CREATE VIEW ledger_balances AS
SELECT a.id AS account_id, a.code, a.kind, a.currency, a.owner_id,
       coalesce(sum(CASE WHEN e.direction = a.normal THEN e.amount ELSE -e.amount END), 0)::numeric(18,2) AS balance
FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
GROUP BY a.id;

CREATE TABLE commission_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2  char(2) NOT NULL REFERENCES countries(iso2),
  category_id   uuid REFERENCES commodity_categories(id),
  listing_type  text CHECK (listing_type IN ('product','service')),
  rate_pct      numeric(5,2) NOT NULL CHECK (rate_pct BETWEEN 0 AND 50),
  min_fee       numeric(18,2) NOT NULL DEFAULT 0,
  max_fee       numeric(18,2),
  active        boolean NOT NULL DEFAULT true
);

CREATE TABLE payout_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type               text NOT NULL CHECK (type IN ('momo','bank')),
  provider           text NOT NULL CHECK (provider IN ('paystack','flutterwave','hubtel')),
  recipient_code     text NOT NULL,                 -- PSP transfer-recipient token
  label              text NOT NULL,                 -- masked account, e.g. "MTN •••• 567"
  network            text,
  is_default         boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payout_accounts_default ON payout_accounts (user_id) WHERE is_default;

CREATE TABLE payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     uuid NOT NULL REFERENCES users(id),
  account_id    uuid NOT NULL REFERENCES payout_accounts(id),
  amount        numeric(18,2) NOT NULL CHECK (amount > 0),
  currency      char(3) NOT NULL,
  status        text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','pending_review','approved','processing','paid','failed','rejected')),
  provider      text NOT NULL,
  provider_ref  text,
  reviewed_by   uuid REFERENCES users(id),
  review_note   text,
  failure_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER payouts_updated BEFORE UPDATE ON payouts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX payouts_seller_idx ON payouts (seller_id, created_at DESC);

CREATE TABLE disputes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL UNIQUE REFERENCES orders(id),
  opened_by   uuid NOT NULL REFERENCES users(id),
  reason      text NOT NULL CHECK (reason IN ('not_received','not_as_described','damaged','wrong_quantity','other')),
  description text NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','resolved')),
  -- {"outcome": "refund_buyer"|"release_seller"|"split", "refundAmount": "...", "note": "..."}
  resolution  jsonb,
  decided_by  uuid REFERENCES users(id),
  decided_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dispute_evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id   uuid NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  uploaded_by  uuid NOT NULL REFERENCES users(id),
  object_key   text,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reconciliation_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL,
  day         date NOT NULL,
  status      text NOT NULL CHECK (status IN ('matched','mismatched','failed')),
  matched     int NOT NULL DEFAULT 0,
  mismatched  int NOT NULL DEFAULT 0,
  details     jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, day)
);
