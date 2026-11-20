-- Payment attempt counter, used to build the Midtrans order id ({bookingId}-{attempt}).
-- Apply: psql "$DATABASE_URL" -f apps/core/db/migrations/004_booking_payment_attempt.sql
-- Safe to run twice. Apply before deploying the core release that writes it.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 0;
