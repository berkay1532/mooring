-- Mooring indexer v1 schema. Idempotent: every statement is CREATE ... IF NOT EXISTS,
-- so `npm run db:migrate` can run on every deploy and the test harness loads it into PGlite.
-- Amounts are USDC base units (7 decimals) kept as numeric(30,0); they are strings in the API.

CREATE TABLE IF NOT EXISTS cards (
  card            text PRIMARY KEY,
  owner           text NOT NULL,
  label           text,
  factory         text,
  created_ledger  integer,
  created_tx      text,
  created_at      timestamptz,
  tracked_by      text NOT NULL DEFAULT 'factory' CHECK (tracked_by IN ('factory', 'manual')),
  backfilled_at   timestamptz
);
CREATE INDEX IF NOT EXISTS cards_owner_idx ON cards (owner);

CREATE TABLE IF NOT EXISTS card_events (
  event_id  text PRIMARY KEY,
  card      text NOT NULL REFERENCES cards (card),
  kind      text NOT NULL,
  ledger    integer NOT NULL,
  tx_hash   text,
  ts        timestamptz NOT NULL,
  payload   jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS card_events_card_ledger_idx ON card_events (card, ledger DESC, event_id DESC);

CREATE TABLE IF NOT EXISTS payments (
  event_id      text PRIMARY KEY,
  card          text NOT NULL REFERENCES cards (card),
  direction     text NOT NULL CHECK (direction IN ('out', 'in')),
  counterparty  text NOT NULL,
  amount        numeric(30,0) NOT NULL,
  ledger        integer NOT NULL,
  tx_hash       text,
  ts            timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_card_ledger_idx ON payments (card, ledger DESC, event_id DESC);

CREATE TABLE IF NOT EXISTS merchant_labels (
  card         text NOT NULL REFERENCES cards (card),
  pay_to       text NOT NULL,
  name         text NOT NULL,
  url          text NOT NULL,
  verified_at  timestamptz NOT NULL,
  PRIMARY KEY (card, pay_to)
);

CREATE TABLE IF NOT EXISTS indexer_state (
  id             integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cursor         text,
  last_ledger    integer,
  last_tick      timestamptz,
  tick_lock      timestamptz,
  backfill_done  boolean NOT NULL DEFAULT false
);
INSERT INTO indexer_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
