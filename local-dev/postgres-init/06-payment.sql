-- rusuh-core payment-module schema (Postgres, LLD-03 §3).
-- Apply once per environment (migrations run by the deploy pipeline, not the app).
-- Times are UTC in the DB (D20); the API returns +07:00 (ISO 8601).

CREATE TABLE IF NOT EXISTS payment_orders (
  order_id        TEXT PRIMARY KEY,
  booking_id      TEXT NOT NULL,
  attempt         INTEGER NOT NULL,
  gross_amount    INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'created',
  snap_start_time TIMESTAMPTZ NOT NULL,
  payment_type    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_booking_id ON payment_orders (booking_id);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id                 BIGSERIAL PRIMARY KEY,
  order_id           TEXT NOT NULL,
  booking_id         TEXT NOT NULL,
  transaction_id     TEXT NOT NULL UNIQUE,
  transaction_status TEXT NOT NULL,
  confirmed          BOOLEAN NOT NULL DEFAULT false,
  payment_type       TEXT,
  gross_amount       INTEGER,
  raw_payload        JSONB,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_order_id ON payment_attempts (order_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_booking_id ON payment_attempts (booking_id);

CREATE TABLE IF NOT EXISTS callback_log (
  id                 BIGSERIAL PRIMARY KEY,
  order_id           TEXT,
  booking_id         TEXT,
  signature_valid    BOOLEAN NOT NULL,
  transaction_status TEXT,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_callback_log_order_id ON callback_log (order_id);
