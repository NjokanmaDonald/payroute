-- PayRoute Initial Schema Migration
-- Double-entry bookkeeping: every balance change creates two ledger entries

BEGIN;

-- ============================================================
-- ACCOUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Multi-currency balances: one row per account+currency pair.
-- `balance` = available funds (excludes locked).
-- `locked_balance` = funds reserved for in-flight payments.
-- A constraint ensures neither goes negative at the DB level.
CREATE TABLE IF NOT EXISTS account_balances (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id),
  currency       CHAR(3) NOT NULL,
  balance        NUMERIC(20, 6) NOT NULL DEFAULT 0,
  locked_balance NUMERIC(20, 6) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, currency),
  CONSTRAINT balance_non_negative        CHECK (balance >= 0),
  CONSTRAINT locked_balance_non_negative CHECK (locked_balance >= 0)
);

-- ============================================================
-- FX QUOTES
-- ============================================================
-- Quotes are snapshotted at request time and locked to the transaction.
-- expires_at enforces a TTL (typically 30 seconds for FX).
CREATE TABLE IF NOT EXISTS fx_quotes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_currency      CHAR(3) NOT NULL,
  destination_currency CHAR(3) NOT NULL,
  rate                 NUMERIC(20, 8) NOT NULL,
  expires_at           TIMESTAMPTZ NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fx_quotes_expires_at ON fx_quotes(expires_at);

-- ============================================================
-- IDEMPOTENCY KEYS
-- ============================================================
-- Stores the first response for each idempotency key so identical
-- retries return the same result without re-executing the operation.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  response_status INT NOT NULL,
  response_body   JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_key ON idempotency_keys(idempotency_key);

-- ============================================================
-- TRANSACTIONS
-- ============================================================
-- Status machine: initiated -> processing -> completed | failed | reversed
-- provider_reference is set once the downstream provider accepts the job.
CREATE TABLE IF NOT EXISTS transactions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference            VARCHAR(50) UNIQUE NOT NULL,
  sender_account_id    UUID NOT NULL REFERENCES accounts(id),
  recipient_name       VARCHAR(255) NOT NULL,
  recipient_country    CHAR(2) NOT NULL,
  recipient_currency   CHAR(3) NOT NULL,
  source_currency      CHAR(3) NOT NULL,
  source_amount        NUMERIC(20, 6) NOT NULL,
  destination_amount   NUMERIC(20, 6) NOT NULL,
  fx_rate              NUMERIC(20, 8) NOT NULL,
  fx_quote_id          UUID REFERENCES fx_quotes(id),
  status               VARCHAR(20) NOT NULL DEFAULT 'initiated',
  provider_reference   VARCHAR(255),
  idempotency_key      VARCHAR(255),
  failure_reason       TEXT,
  initiated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_at        TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  failed_at            TIMESTAMPTZ,
  reversed_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_status CHECK (status IN ('initiated','processing','completed','failed','reversed')),
  CONSTRAINT source_amount_positive      CHECK (source_amount > 0),
  CONSTRAINT destination_amount_positive CHECK (destination_amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_transactions_status        ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_sender        ON transactions(sender_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_provider_ref  ON transactions(provider_reference);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at    ON transactions(created_at DESC);

-- ============================================================
-- TRANSACTION STATUS HISTORY (timeline / audit log)
-- ============================================================
CREATE TABLE IF NOT EXISTS transaction_status_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  from_status    VARCHAR(20),
  to_status      VARCHAR(20) NOT NULL,
  reason         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_status_history_txn ON transaction_status_history(transaction_id);

-- ============================================================
-- LEDGER ENTRIES (double-entry bookkeeping)
-- ============================================================
-- Every financial event creates exactly TWO entries that sum to zero:
--   Debit  (amount < 0): money leaves an account
--   Credit (amount > 0): money enters an account
--
-- entry_type values:
--   'debit'             - funds leave sender on payment initiation
--   'credit'            - funds arrive at recipient on completion
--   'reversal_credit'   - compensating credit to sender on failure
--   'fx_fee'            - FX spread (future use)
CREATE TABLE IF NOT EXISTS ledger_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  account_id     UUID NOT NULL REFERENCES accounts(id),
  currency       CHAR(3) NOT NULL,
  amount         NUMERIC(20, 6) NOT NULL,
  entry_type     VARCHAR(30) NOT NULL,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_entry_type CHECK (entry_type IN ('debit','credit','reversal_credit','fx_fee'))
);

CREATE INDEX IF NOT EXISTS idx_ledger_transaction ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account     ON ledger_entries(account_id);

-- ============================================================
-- WEBHOOK EVENTS (raw log — written before processing)
-- ============================================================
-- All inbound webhooks are persisted first. If processing crashes,
-- the raw event can be replayed. processing_status tracks outcome.
CREATE TABLE IF NOT EXISTS webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_reference VARCHAR(255),
  raw_headers       JSONB NOT NULL,
  raw_body          TEXT NOT NULL,
  signature         VARCHAR(512),
  processing_status VARCHAR(20) NOT NULL DEFAULT 'received',
  processing_error  TEXT,
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_webhook_status CHECK (processing_status IN ('received','processed','failed','ignored'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_ref ON webhook_events(provider_reference);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at   ON webhook_events(created_at DESC);

-- ============================================================
-- SYSTEM LEDGER ACCOUNT (float / suspense account)
-- ============================================================
-- Required for double-entry: when we debit a sender we credit
-- a suspense account, and vice versa on settlement.
INSERT INTO accounts (id, business_name, email)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'PayRoute System Float',
  'system@payroute.internal'
) ON CONFLICT DO NOTHING;

INSERT INTO account_balances (account_id, currency, balance)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'NGN', 0),
  ('00000000-0000-0000-0000-000000000001', 'USD', 0),
  ('00000000-0000-0000-0000-000000000001', 'GBP', 0),
  ('00000000-0000-0000-0000-000000000001', 'EUR', 0)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED: Demo accounts for testing
-- ============================================================
INSERT INTO accounts (id, business_name, email) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Acme Imports Ltd',     'acme@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Global Traders Co',    'global@example.com'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Sunrise Exporters',    'sunrise@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO account_balances (account_id, currency, balance) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'NGN', 5000000.00),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'USD', 0.00),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'NGN', 10000000.00),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'USD', 500.00),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'NGN', 2500000.00),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'EUR', 0.00)
ON CONFLICT DO NOTHING;

COMMIT;
