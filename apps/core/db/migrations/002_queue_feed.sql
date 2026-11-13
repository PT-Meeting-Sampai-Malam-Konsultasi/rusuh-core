-- Booking events for the queue (BR-06-C1, ADR-0013, api/events/booking.v1.schema.json).
-- Apply: psql "$DATABASE_URL" -f apps/core/db/migrations/002_queue_feed.sql
-- Safe to run twice. Apply before deploying the core release that writes these.

-- The queue's device (the admission token's sub), carried on booking.v1 events.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS device_id TEXT;

-- Written in the same statement as the booking status change; the relay sends
-- unsent rows to stream:booking and stamps sent_at.
CREATE TABLE IF NOT EXISTS booking_outbox (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('booking.held', 'booking.paid', 'booking.expired')),
  booking_id TEXT NOT NULL REFERENCES bookings (booking_id),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS booking_outbox_unsent_idx ON booking_outbox (created_at, id) WHERE sent_at IS NULL;
