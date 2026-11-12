# @rusuh/auth-service

Account service: passwordless email+OTP login, account JWT (Ed25519), opaque
refresh tokens. Part of the `rusuh-core` monorepo. Same boilerplate as
`rusuh-mock` (Express + CommonJS, Jest + Supertest, ESLint airbnb-base +
Prettier).

## Run

```sh
npm ci
npm start          # PORT=8081 by default
npm run check      # format + lint + tests + coverage
```

Without `DATABASE_URL` / `VALKEY_URL` / `SQS_QUEUE_URL` the service runs on
in-memory adapters (no Postgres, Valkey, or AWS needed). Apply
`db/migrations/001_auth.sql` to provision the Postgres schema.

## Endpoints (prefix `/v1/`, contract `rusuh-documentation/api/openapi.yaml`)

| Method & path               | Auth   | Purpose                                                   |
| --------------------------- | ------ | --------------------------------------------------------- |
| `POST /v1/auth/otp`         | —      | Send a one-time code (202 + `challengeId`)                |
| `POST /v1/auth/otp/request` | —      | Alias of `/otp` (LLD-01 path)                             |
| `POST /v1/auth/otp/verify`  | —      | Verify the code → Session (login or register)             |
| `POST /v1/auth/refresh`     | —      | Rotate the refresh token → new Session                    |
| `POST /v1/auth/logout`      | Bearer | Revoke the refresh family + denylist the access jti (204) |
| `GET /v1/me`                | Bearer | My profile                                                |
| `GET /v1/auth/profile`      | Bearer | Alias of `/me` (LLD-01 path)                              |
| `PUT /v1/auth/profile`      | Bearer | Complete/update the profile (name only, no NIK)           |
| `POST /v1/auth/email-change` | Bearer | Start an email change (a code to the old and new address) |
| `POST /v1/auth/email-change/verify` | Bearer | Confirm with both codes; swaps the account email |

Errors are RFC 9457 Problem JSON (`{type, title, status, code, detail, ...}`):
400 `BAD_REQUEST`, 401 `UNAUTHORIZED`, 409 `WRONG_CODE` (with `attemptsLeft`),
410 `CHALLENGE_EXPIRED` / `CHALLENGE_LOCKED`, 429 `TOO_MANY_REQUESTS`.

## Design (LLD-01, decisions 5–6 Nov 2026)

- Registration = email + OTP, then name only. **No NIK on the account** (D17
  corrected): NIK lives only per ticket in core-module.
- OTP: 6 digits, HMAC-SHA256 + device-bound (ADR-0006), single-use, 10 min
  expiry, 60 s resend cooldown, 3 sends per email per 10 min, 5 attempts.
- Access JWT: Ed25519, 15 min, claims `sub/iat/exp/jti/kid`, no event claim.
  Verified locally via `@rusuh/auth` (Q43).
- Refresh: opaque `rt_…`, SHA-256 hash in DB, 7 days per family (rotation does
  not extend it), reuse revokes the whole family (Q44, ADR-0025).
- Logout: revoke the refresh family + `denylist:{jti}` in Valkey, TTL =
  remaining token life (Q42). Valkey down → fail-closed 503.
- OTP email is enqueued to SQS for notification-module (Q34); auth never
  calls SES directly.
- Security headers + CORS: `helmet()` (defaults) and `cors()` are mounted in
  `createApp` before any route. CORS origins come from `CORS_ORIGINS`
  (comma-separated env var); default is
  `https://rusuh-tiket.web.id,https://www.rusuh-tiket.web.id,http://localhost:3000,http://localhost:5173`.

## Notes for the openapi.yaml sync (no breaking changes made here)

- `WRONG_CODE` is returned with **409** (LLD-01 + `@rusuh/contracts`), but the
  yaml documents it under a `400` response — the yaml should move it to `409`.
- The yaml path is `/auth/otp` (canonical here); `/auth/otp/request` is kept
  as an alias for the LLD-01 path.
- `GET /v1/me` is canonical (yaml); `PUT /v1/auth/profile` (name update) and
  the `/auth/otp` `consentVersion` leniency (optional here, required in the
  yaml) are not yet in the yaml — they need adding.
- The yaml `Session.accessToken` example shows an `evt` claim; the account
  JWT carries no event claim (ADR-0021/0025).

## Layout (Onion / Clean Architecture)

```
src/
  alias.js                 @ -> src alias (monorepo-safe, see the file)
  app.js / server.js       Express app + HTTP server (entry points)
  container.js             COMPOSITION ROOT: builds deps from config
  test-helpers.js          test app builder (in-memory adapters)
  domain/                  CENTER: pure business logic, no I/O
    otp.js                 OTP rules (code, HMAC, constants)
    ports/                 adapter contracts (JSDoc typedefs):
                           store, mailer, token-service, denylist, logger
  application/             use cases (depend on domain ports only)
    otp/                   request + verify (HMAC, device-bound, rate limits)
    session/               refresh (rotation + reuse) + logout
    profile/               getMe + update (name only)
    health/                liveness + readiness
    shared/                api-error (Problem JSON), issue-session
  infrastructure/          adapters (implement the domain ports)
    config/environment.js  env vars (DATABASE_URL, VALKEY_URL, SQS_QUEUE_URL, ...)
    persistence/           Postgres (pg) + in-memory repository
    cache/                 jti denylist (ioredis) + in-memory
    messaging/             SQS OTP job + in-memory
    tokens/                Ed25519 sign/verify (via @rusuh/auth)
  presentation/            HTTP (outer): controllers, routes, validation,
                           middleware (auth Bearer JWT, error-handler)
  platform/common.js       logger shim (injected by the composition root;
                           presentation never imports platform/ directly)
db/migrations/001_auth.sql Postgres schema (accounts, profiles, otp_codes,
                           refresh_tokens, access_tokens, audit_log)
```

Dependency rule (enforced by `npm run check:boundaries`, see
`scripts/check-boundaries.js`): domain imports only node built-ins +
`@rusuh/contracts`; application imports domain + contracts + npm;
infrastructure imports domain + application (ports) + `@rusuh/auth` +
`@rusuh/observability` + npm; presentation imports application + domain +
contracts + npm — never infrastructure/ and never platform/ (the platform
shim is injected by the composition root).
