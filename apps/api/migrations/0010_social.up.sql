-- Messaging, moderation, community.

CREATE TABLE conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2     char(2) NOT NULL REFERENCES countries(iso2),
  listing_id       uuid REFERENCES listings(id) ON DELETE SET NULL,
  order_id         uuid REFERENCES orders(id) ON DELETE SET NULL,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  last_message_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_members (
  conversation_id    uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_delivered_at  timestamptz,
  last_read_at       timestamptz,
  muted              boolean NOT NULL DEFAULT false,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user_idx ON conversation_members (user_id);

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  kind             text NOT NULL CHECK (kind IN ('text','image','offer','system')),
  body             text,
  -- image: {"variants": {...}}, offer: {"offerId": "...", "listingId": "...", "quantity": "...", "pricePerUnit": "..."}
  payload          jsonb NOT NULL DEFAULT '{}',
  client_id        text,                              -- client-generated id for idempotent sends
  flags            text[] NOT NULL DEFAULT '{}',      -- e.g. scam_off_platform_payment
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, sender_id, client_id)
);
CREATE INDEX messages_conv_idx ON messages (conversation_id, created_at DESC, id DESC);

CREATE TABLE user_blocks (
  blocker_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

-- One moderation queue for everything users can report or the system auto-flags.
CREATE TABLE moderation_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type   text NOT NULL CHECK (target_type IN ('listing','message','post','comment','user','price')),
  target_id     uuid NOT NULL,
  reporter_id   uuid REFERENCES users(id) ON DELETE SET NULL,   -- NULL = automatic
  reason        text NOT NULL,
  details       text,
  signals       jsonb NOT NULL DEFAULT '{}',                    -- classifier scores, matched patterns
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  action        text CHECK (action IN ('hide','remove','warn_user','suspend_user','none')),
  decided_by    uuid REFERENCES users(id),
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_items_open_idx ON moderation_items (status, created_at) WHERE status = 'open';
CREATE UNIQUE INDEX moderation_items_one_report ON moderation_items (target_type, target_id, reporter_id) WHERE reporter_id IS NOT NULL;

ALTER TABLE users ADD COLUMN suspended_at timestamptz, ADD COLUMN suspended_reason text;

CREATE TABLE posts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_iso2          char(2) NOT NULL REFERENCES countries(iso2),
  type                  text NOT NULL CHECK (type IN ('price_update','market_news','tip','question')),
  body                  text NOT NULL,
  commodity_id          uuid REFERENCES commodities(id),
  market_id             uuid REFERENCES markets(id),
  region_id             uuid REFERENCES regions(id),
  location              geography(Point, 4326),
  price                 jsonb,                 -- {"amount": "...", "currency": "GHS", "unit": "kg", "priceType": "retail"}
  price_observation_id  uuid,                  -- crowd observation created for price_update posts
  photos                jsonb NOT NULL DEFAULT '[]',
  status                text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','pending_review','hidden','removed')),
  accepted_comment_id   uuid,
  comment_count         int NOT NULL DEFAULT 0,
  reaction_count        int NOT NULL DEFAULT 0,
  share_count           int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (type <> 'price_update' OR (commodity_id IS NOT NULL AND market_id IS NOT NULL AND price IS NOT NULL))
);
CREATE TRIGGER posts_updated BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX posts_feed_idx ON posts (country_iso2, created_at DESC) WHERE status = 'visible';
CREATE INDEX posts_author_idx ON posts (author_id, created_at DESC);
CREATE INDEX posts_location_idx ON posts USING gist (location);

CREATE TABLE comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES comments(id) ON DELETE CASCADE,
  body        text NOT NULL,
  status      text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','removed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_post_idx ON comments (post_id, created_at);
ALTER TABLE posts ADD CONSTRAINT posts_accepted_comment_fk FOREIGN KEY (accepted_comment_id) REFERENCES comments(id) ON DELETE SET NULL;

CREATE TABLE reactions (
  post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('like','helpful','insightful')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE follows (
  follower_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows (followee_id);

CREATE TABLE reputation_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,              -- post_created, answer_accepted, reaction_received, price_approved, ...
  points      int NOT NULL,
  ref_id      uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, ref_id)          -- each source event counts once
);
CREATE INDEX reputation_events_user_idx ON reputation_events (user_id, created_at DESC);

CREATE TABLE badges (
  code  text PRIMARY KEY,
  name  jsonb NOT NULL,
  description jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO badges (code, name, description) VALUES
  ('weekly_top_contributor', '{"en":"Weekly top contributor"}', '{"en":"Most reputation earned in a week in your country"}'),
  ('trusted_reporter', '{"en":"Trusted price reporter"}', '{"en":"25 or more approved price reports"}'),
  ('helpful_answerer', '{"en":"Helpful answerer"}', '{"en":"10 or more accepted answers"}');

CREATE TABLE user_badges (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_code  text NOT NULL REFERENCES badges(code),
  period      text NOT NULL DEFAULT 'all',  -- e.g. 2026-W47 for weekly badges
  awarded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_code, period)
);
