-- 002: OTP request no longer carries a full name.
-- The name is set AFTER the session exists, via PUT /v1/auth/profile
-- (profile = name only, D17; login asks for email only). The column is
-- dropped so stale clients cannot smuggle a name through the challenge.
ALTER TABLE otp_codes DROP COLUMN IF EXISTS full_name;
