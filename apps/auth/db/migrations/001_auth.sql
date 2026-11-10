-- Auth-module schema (LLD-01 §3). All timestamps UTC (D20).
-- Apply: psql "$DATABASE_URL" -f db/migrations/001_auth.sql

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT UNIQUE NOT NULL,
  profile_complete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  name TEXT,
  locale TEXT NOT NULL DEFAULT 'id',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- OTP challenges (ADR-0006: HMAC + device-bound, hash only, single-use).
CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  device_id TEXT,
  full_name TEXT,
  locale TEXT NOT NULL DEFAULT 'id',
  purpose TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_codes_email_created ON otp_codes (email, created_at DESC);

-- Opaque refresh tokens (Q44: SHA-256 hash only, rotation + reuse detection).
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  device_label TEXT,
  current_access_jti TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_account ON refresh_tokens (account_id);

-- Access-token jti -> family mapping (logout revokes the family, Q42).
CREATE TABLE IF NOT EXISTS access_tokens (
  jti TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Audit trail (LLD-01 §10; separate from CloudWatch operational logs).
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_account ON audit_log (account_id, created_at DESC);

-- Idempotent migration for databases created before the id defaults existed.
-- The Postgres store inserts without id (RETURNING *), so the defaults above
-- must also exist on pre-existing tables. gen_random_uuid() is built-in since
-- PostgreSQL 13 (no pgcrypto extension needed). Safe to re-run.
ALTER TABLE accounts ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE otp_codes ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE refresh_tokens ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
