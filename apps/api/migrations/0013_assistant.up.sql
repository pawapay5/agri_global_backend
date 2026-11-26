-- Farmer assistant: questions and answers in the farmer's language and in English, plus the exact figures used.
-- Messages are kept 90 days (see the nightly purge in AssistantService) and deleted with the user.
CREATE TABLE assistant_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language    text NOT NULL CHECK (language IN ('eng','twi','fat','ewe','gaa','dag')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_conversations_user_idx ON assistant_conversations (user_id, updated_at DESC);

CREATE TABLE assistant_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language         text NOT NULL,
  input_mode       text NOT NULL CHECK (input_mode IN ('text','voice')),
  question         text NOT NULL,
  question_en      text NOT NULL,
  answer           text NOT NULL,
  answer_en        text NOT NULL,
  facts            jsonb NOT NULL DEFAULT '[]',
  numbers_preserved boolean NOT NULL DEFAULT true,
  model            text,
  input_tokens     int,
  output_tokens    int,
  audio_key        text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_messages_conv_idx ON assistant_messages (conversation_id, created_at);
CREATE INDEX assistant_messages_created_idx ON assistant_messages (created_at);
