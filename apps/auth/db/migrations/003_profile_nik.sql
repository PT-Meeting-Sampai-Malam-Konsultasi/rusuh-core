--- ADR-0031: the account profile may store the holder's own NIK (optional).
--- Encrypted at rest (AES-256-GCM, same key as core-module) + masked for
--- display. Only the masked form is ever returned by the API.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS nik_ciphertext TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS nik_masked TEXT;
