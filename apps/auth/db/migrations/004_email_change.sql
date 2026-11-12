-- Email-change challenges (openapi.yaml startEmailChange/verifyEmailChange).
-- One row holds both OTP hashes: old-address code and new-address code.
CREATE TABLE IF NOT EXISTS email_change_challenges (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  new_email TEXT NOT NULL,
  old_code_hash TEXT NOT NULL,
  new_code_hash TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'id',
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_change_account_created ON email_change_challenges (account_id, created_at DESC);
