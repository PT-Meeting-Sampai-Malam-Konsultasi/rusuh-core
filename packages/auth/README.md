# @rusuh/auth

Shared account-JWT verification (Q43, Ed25519). Every Node module verifies the
account token locally with `verifyAccountToken()` — no hot-path call to
auth-module. The Go queue-module mirrors the same rules by contract + test
vector.

Claims: `sub` (account id), `iat`, `exp`, `jti`, `kid`. No event claim.
Access TTL 15 minutes; refresh is opaque, 7 days (ADR-0025).
