-- Adds the administrative metadata required by the shared core/admin event model.
-- Safe on existing databases provisioned before the admin service used core tables.
ALTER TABLE events ADD COLUMN IF NOT EXISTS infra_cap INTEGER;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS almost_sold_out_threshold INTEGER;
