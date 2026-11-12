-- 003: account authorization role for admin-service.
-- Existing accounts remain regular users; promotion is an explicit database action.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_role_check;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_role_check CHECK (role IN ('user', 'officer', 'admin'));
