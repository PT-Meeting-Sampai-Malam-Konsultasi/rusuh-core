-- Midtrans redirect URL returned with the snap token by POST /bookings/:id/payment.
-- Apply: psql "$DATABASE_URL" -f apps/core/db/migrations/003_booking_redirect_url.sql
-- Safe to run twice. Apply before deploying the core release that writes it.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS redirect_url TEXT;
