-- rusuh-core Postgres schema (D10). Run once at deploy (migrations follow).
-- Booking states: SELECTION, PAYMENT_PENDING, PAID, EXPIRED, CANCELLED.
-- NIK is stored in three forms (D24): masked, HMAC blind index, ciphertext.
-- Raw NIK never reaches this database.

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subtitle TEXT,
  format TEXT,
  venue TEXT NOT NULL,
  venue_short TEXT,
  city TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  starts_at TIMESTAMPTZ NOT NULL,
  doors_open_at TIMESTAMPTZ,
  sale_opens_at TIMESTAMPTZ,
  waiting_room_opens_at TIMESTAMPTZ,
  sale_ends_at TIMESTAMPTZ,
  state TEXT NOT NULL DEFAULT 'coming_soon',
  capacity INTEGER NOT NULL DEFAULT 0,
  sold_out_at TIMESTAMPTZ,
  image_url TEXT,
  event_code TEXT NOT NULL,
  cap_tier INTEGER,
  cap INTEGER,
  infra_cap INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  category_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(event_id),
  name TEXT NOT NULL,
  description TEXT,
  seating TEXT NOT NULL DEFAULT 'standing',
  entry_gate TEXT,
  price INTEGER NOT NULL,
  total INTEGER NOT NULL,
  category_code TEXT NOT NULL,
  almost_sold_out_threshold INTEGER,
  PRIMARY KEY (event_id, category_id)
);

CREATE TABLE IF NOT EXISTS bookings (
  booking_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(event_id),
  account_id TEXT NOT NULL,
  admission_token TEXT NOT NULL,
  slot_id TEXT,
  status TEXT NOT NULL DEFAULT 'SELECTION',
  expires_at TIMESTAMPTZ,
  payment_expires_at TIMESTAMPTZ,
  order_code TEXT NOT NULL,
  price JSONB NOT NULL DEFAULT '{}'::jsonb,
  attendees JSONB NOT NULL DEFAULT '[]'::jsonb,
  tickets JSONB NOT NULL DEFAULT '[]'::jsonb,
  snap_token TEXT,
  paid_at TIMESTAMPTZ,
  payment_method TEXT,
  refund_required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active booking per admission token (LLD-02 §5.1, second line of defence).
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_per_admission
  ON bookings (admission_token) WHERE status IN ('SELECTION', 'PAYMENT_PENDING');
CREATE INDEX IF NOT EXISTS bookings_due_idx ON bookings (expires_at)
  WHERE status IN ('SELECTION', 'PAYMENT_PENDING');
CREATE INDEX IF NOT EXISTS bookings_account_idx ON bookings (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tickets (
  ticket_id TEXT PRIMARY KEY,
  ticket_code TEXT NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(booking_id),
  event_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  seating TEXT NOT NULL DEFAULT 'standing',
  entry_gate TEXT,
  holder_name TEXT NOT NULL,
  nik_masked TEXT NOT NULL,
  nik_hmac TEXT NOT NULL,
  nik_ciphertext TEXT NOT NULL,
  qr_payload TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tickets_booking_idx ON tickets (booking_id);

CREATE TABLE IF NOT EXISTS nik_backstop (
  event_id TEXT NOT NULL,
  nik_hmac TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, nik_hmac)
);

CREATE TABLE IF NOT EXISTS category_ticket_seq (
  event_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, category_id)
);

CREATE TABLE IF NOT EXISTS email_log (
  booking_id TEXT NOT NULL,
  type TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (booking_id, type)
);

CREATE TABLE IF NOT EXISTS callback_log (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  transaction_id TEXT,
  transaction_status TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_attempts (
  order_id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(booking_id),
  attempt INTEGER NOT NULL,
  snap_token TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  booking_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
