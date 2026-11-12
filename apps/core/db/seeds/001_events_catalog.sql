-- Event catalogue seed: the 5 events of the Home mockup (Desktop 1440).
-- Idempotent: safe to re-run; rows are upserted by primary key.
-- Requires the core schema (apps/core/src/infrastructure/persistence/schema.sql).
--
-- Provenance. Taken from the mockup: name, subtitle, format, venue, city,
-- starts_at and the "Mulai Rp" prices. Everything else is an ASSUMPTION and
-- must be confirmed before this runs on production: capacity (except Samudra,
-- from the openapi example), doors, sale windows, and the stock of the Langit
-- Sore and Rimba categories. Samudra's sale window comes from the openapi example.
-- All events are seeded coming_soon, so sold_out_at stays NULL (Deru's sold-out
-- badge in the mockup is not reproduced).
-- Deru and Kelana have no category rows on purpose: the mockup shows no price
-- for them, and priceFrom is derived from the cheapest category (null here).
-- Kelana starts at 19.00 WITA (UTC+8), hence its Asia/Makassar timezone.
--
-- image_url follows https://cdn.rusuh.id/events/{eventId}/hero.jpg (host TBD,
-- see the CDN domain decision); files live in db/seed-assets/events/{eventId}/.

BEGIN;

-- Dates are written once per event as (starts, doors, sale opens, waiting room
-- opens, sale ends) in UTC. The image URL is derived from the event id.
WITH catalogue (
  event_id, name, subtitle, format, venue, venue_short, city, timezone,
  starts_at, doors_open_at, sale_opens_at, waiting_room_opens_at, sale_ends_at,
  capacity, event_code
) AS (
  VALUES
    ('evt_2026_gbk', 'Samudra', 'Tur Gelombang 2026', 'Tour', 'Stadion Utama GBK', 'GBK', 'Jakarta', 'Asia/Jakarta',
     '2026-12-12T12:00:00Z', '2026-12-12T10:00:00Z', '2026-11-14T03:00:00Z', '2026-11-14T02:30:00Z',
     '2026-11-20T16:59:59Z', 12000, 'SMD'),
    ('evt_2027_lsr', 'Langit Sore', 'Senja Panjang Live', 'Live', 'Stadion Kridosono', 'Kridosono', 'Yogyakarta',
     'Asia/Jakarta', '2027-01-09T11:30:00Z', '2027-01-09T09:30:00Z', '2026-10-30T03:00:00Z',
     '2026-10-30T02:30:00Z', '2027-01-08T16:59:59Z', 8000, 'LSR'),
    ('evt_2026_rmb', 'Rimba', 'Pesta Akar 2026', 'Festival', 'GOR Saparua', 'Saparua', 'Bandung', 'Asia/Jakarta',
     '2026-11-22T09:00:00Z', '2026-11-22T07:00:00Z', '2026-11-01T03:00:00Z', '2026-11-01T02:30:00Z',
     '2026-11-21T16:59:59Z', 5000, 'RMB'),
    ('evt_2026_dru', 'Deru', 'Malam Mesin', 'Live', 'Jatim Expo', 'Jatim Expo', 'Surabaya', 'Asia/Jakarta',
     '2026-12-04T13:00:00Z', '2026-12-04T11:00:00Z', '2026-11-01T03:00:00Z', '2026-11-01T02:30:00Z',
     '2026-12-03T16:59:59Z', 12000, 'DRU'),
    ('evt_2026_kln', 'Kelana', 'Tur Pulau', 'Tour', 'Lapangan Puputan', 'Puputan', 'Denpasar', 'Asia/Makassar',
     '2026-10-31T11:00:00Z', '2026-10-31T09:00:00Z', '2026-10-01T03:00:00Z', '2026-10-01T02:30:00Z',
     '2026-10-29T16:59:59Z', 6000, 'KLN')
)
INSERT INTO events (
  event_id, name, subtitle, format, venue, venue_short, city, timezone,
  starts_at, doors_open_at, sale_opens_at, waiting_room_opens_at, sale_ends_at,
  state, capacity, image_url, event_code
)
SELECT
  event_id, name, subtitle, format, venue, venue_short, city, timezone,
  starts_at::timestamptz, doors_open_at::timestamptz, sale_opens_at::timestamptz,
  waiting_room_opens_at::timestamptz, sale_ends_at::timestamptz,
  'coming_soon', capacity, 'https://cdn.rusuh.id/events/' || event_id || '/hero.jpg', event_code
FROM catalogue
ON CONFLICT (event_id) DO UPDATE SET
  (name, subtitle, format, venue, venue_short, city, timezone, starts_at, doors_open_at, sale_opens_at,
   waiting_room_opens_at, sale_ends_at, state, capacity, sold_out_at, image_url, event_code, updated_at) =
  (EXCLUDED.name, EXCLUDED.subtitle, EXCLUDED.format, EXCLUDED.venue, EXCLUDED.venue_short, EXCLUDED.city,
   EXCLUDED.timezone, EXCLUDED.starts_at, EXCLUDED.doors_open_at, EXCLUDED.sale_opens_at,
   EXCLUDED.waiting_room_opens_at, EXCLUDED.sale_ends_at, EXCLUDED.state, EXCLUDED.capacity, NULL,
   EXCLUDED.image_url, EXCLUDED.event_code, NOW());

-- Samudra keeps the three categories of the in-memory seed (store.js); only
-- Tribun changes from 750.000 to 450.000 to match the mockup's "Mulai Rp 450.000".
INSERT INTO categories (
  category_id, event_id, name, description, seating, entry_gate, price, total, category_code
) VALUES
  ('cat_vip', 'evt_2026_gbk', 'VIP', 'Duduk · depan panggung', 'seated', 'Gerbang 1', 3500000, 500, 'VIP'),
  ('cat_festival_b', 'evt_2026_gbk', 'Festival B', 'Berdiri · di belakang Festival A', 'standing', 'Gerbang 5', 1500000, 8000, 'FB'),
  ('cat_tribune', 'evt_2026_gbk', 'Tribun', 'Duduk · tribun atas', 'seated', 'Gerbang 9', 450000, 3500, 'TRB'),
  ('cat_festival', 'evt_2027_lsr', 'Festival', 'Berdiri · depan panggung', 'standing', 'Gerbang 1', 325000, 8000, 'FES'),
  ('cat_festival', 'evt_2026_rmb', 'Festival', 'Berdiri · area terbuka', 'standing', 'Gerbang 1', 275000, 5000, 'FES')
ON CONFLICT (event_id, category_id) DO UPDATE SET
  (name, description, seating, entry_gate, price, total, category_code) =
  (EXCLUDED.name, EXCLUDED.description, EXCLUDED.seating, EXCLUDED.entry_gate, EXCLUDED.price,
   EXCLUDED.total, EXCLUDED.category_code);

-- Existing production event "Way Back Home": only the broken image link is fixed.
UPDATE events
SET image_url = 'https://cdn.rusuh.id/events/evt_2026_wbh/hero.jpg', updated_at = NOW()
WHERE event_id = 'evt_2026_wbh';

COMMIT;
