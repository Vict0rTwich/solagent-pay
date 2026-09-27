-- SolAgent Pay payment server: PostgreSQL schema for DatabaseInvoiceStore (SOLAGENT_STORE=postgres).
-- Apply once per database, and again after upgrades (every statement is idempotent):
--   psql "$DATABASE_URL" -f web/db/schema.sql
--
-- Times are unix milliseconds (BIGINT), like the JSON store, except block_time (unix seconds).
-- The constraints are part of the correctness story, not decoration: settlements.signature is what makes
-- "one transfer settles one invoice" hold across instances, and auth_nonces.nonce is what makes a
-- sign-in nonce single-use.

CREATE TABLE IF NOT EXISTS invoices (
  reference            TEXT PRIMARY KEY,
  id                   TEXT NOT NULL,
  network              TEXT NOT NULL,
  kind                 TEXT NOT NULL CHECK (kind IN ('invoice', 'link')),
  recipient            TEXT NOT NULL,
  mint                 TEXT,            -- SPL mint; NULL for native SOL
  token                TEXT NOT NULL,
  amount               TEXT NOT NULL,
  memo                 TEXT NOT NULL,
  payment_url          TEXT NOT NULL,
  created_at           BIGINT NOT NULL,
  expires_at           BIGINT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'expired', 'canceled')),
  paid_at              BIGINT,
  signature            TEXT UNIQUE,
  block_time           BIGINT,
  canceled_at          BIGINT,
  expired_at           BIGINT,
  issue                JSONB,
  duplicate_signatures TEXT[] NOT NULL DEFAULT '{}',
  UNIQUE (network, recipient, id),
  CHECK ((status = 'paid') = (signature IS NOT NULL))
);

-- Databases created before SOL invoices had mint NOT NULL.
ALTER TABLE invoices ALTER COLUMN mint DROP NOT NULL;

-- Product orders and cNFT receipts. `product` is what the product said when it was ordered (title, description,
-- image), so a receipt names what was bought even after the product changes. `receipt` is the buyer's cNFT and its
-- retry bookkeeping (status, owner, mintAddress, attempts, nextAttemptAt, ...), queued in the transaction that
-- marks the invoice paid.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS product_id    TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS product       JSONB;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payer         TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issue_receipt BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt       JSONB;

CREATE INDEX IF NOT EXISTS invoices_open ON invoices (expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS invoices_orders ON invoices (recipient, network, created_at DESC) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoices_receipts_due ON invoices (paid_at) WHERE receipt->>'status' = 'pending';

-- Product listings. A product's Blink creates an order (an invoice above) per purchase; archived products stay,
-- because their orders name them.
CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  network     TEXT NOT NULL,
  merchant    TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  image       TEXT,             -- https URL; NULL uses the generated token icon
  amount      TEXT NOT NULL,
  mint        TEXT,             -- SPL mint; NULL for native SOL
  created_at  BIGINT NOT NULL,
  archived_at BIGINT
);

CREATE INDEX IF NOT EXISTS products_on_sale ON products (merchant, network, created_at DESC) WHERE archived_at IS NULL;

-- One transfer settles one invoice, ever. Claimed with INSERT ... ON CONFLICT DO NOTHING in the transaction
-- that marks the invoice paid.
CREATE TABLE IF NOT EXISTS settlements (
  signature TEXT PRIMARY KEY,
  reference TEXT NOT NULL REFERENCES invoices (reference)
);

-- Last invoice number per "<network>:<recipient>", bumped with an atomic upsert.
CREATE TABLE IF NOT EXISTS invoice_sequences (
  sequence_key TEXT PRIMARY KEY,
  last_number  INTEGER NOT NULL
);

-- Webhook outbox. A deliverer leases an event by moving next_attempt_at ahead (FOR UPDATE SKIP LOCKED).
CREATE TABLE IF NOT EXISTS webhook_events (
  id              TEXT PRIMARY KEY,
  reference       TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'failed', 'skipped')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at      BIGINT NOT NULL,
  next_attempt_at BIGINT NOT NULL,
  delivered_at    BIGINT,
  last_error      TEXT
);

CREATE INDEX IF NOT EXISTS webhook_events_due ON webhook_events (created_at) WHERE status = 'pending';

-- Spent Sign-In with Solana nonces, kept until their sign-in request would have expired anyway.
CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce      TEXT PRIMARY KEY,
  expires_at BIGINT NOT NULL
);

-- Sessions ended by sign-out before their expiry.
CREATE TABLE IF NOT EXISTS revoked_sessions (
  id         TEXT PRIMARY KEY,
  expires_at BIGINT NOT NULL
);

-- Merchant API keys. Only the SHA-256 of a key is kept; the key itself is shown once, at creation.
CREATE TABLE IF NOT EXISTS api_keys (
  id              TEXT PRIMARY KEY,
  merchant        TEXT NOT NULL,
  name            TEXT NOT NULL,
  environment     TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  hash            TEXT NOT NULL UNIQUE,
  preview         TEXT NOT NULL,
  daily_cap_cents BIGINT NOT NULL CHECK (daily_cap_cents > 0),
  created_at      BIGINT NOT NULL,
  last_used_at    BIGINT,
  revoked_at      BIGINT
);

CREATE INDEX IF NOT EXISTS api_keys_merchant ON api_keys (merchant, created_at DESC);

-- USDC cents of invoices each key created per UTC day, checked against the key's cap with one conditional upsert.
CREATE TABLE IF NOT EXISTS api_key_volume (
  key_id TEXT NOT NULL,
  day    BIGINT NOT NULL,
  cents  BIGINT NOT NULL,
  PRIMARY KEY (key_id, day)
);

-- A paid invoice unlocks one HTTP 402-gated request, ever: the primary key is what makes redemption single-use.
CREATE TABLE IF NOT EXISTS invoice_redemptions (
  reference   TEXT PRIMARY KEY,
  key_id      TEXT NOT NULL,
  redeemed_at BIGINT NOT NULL
);
