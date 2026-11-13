# @rusuh/admin-service

Admin service: backoffice (events, categories, CAP, fees, refund flags).

Part of the `rusuh-core` monorepo. Same boilerplate as `rusuh-mock`
(Express + CommonJS, Jest + Supertest, ESLint airbnb-base + Prettier).

## Run

```sh
npm ci
npm start          # PORT=8086 by default
npm run check      # format + lint + tests + coverage
```

## Endpoints (all under /v1/admin/*, admin role only)

Auth: account JWT (email+OTP, auth-module) in `Authorization: Bearer`.
The role is read from the database, never from a JWT claim (LLD-05 §2).
Errors are RFC 9457 Problem JSON (repo contract, `api/openapi.yaml`).

| Method & path                    | Purpose                                                                  |
| -------------------------------- | ------------------------------------------------------------------------ |
| GET /v1/admin/events             | List events (with CAP fields)                                            |
| POST /v1/admin/events            | Create event + categories (status `draft`)                               |
| GET /v1/admin/events/:id         | Event detail                                                             |
| PUT /v1/admin/events/:id         | Update event (price/total only while `draft`)                            |
| GET /v1/admin/events/:id/cap     | CAP + slot stats `{cap_tier, cap, effective_cap, infra_cap, slots}`      |
| PUT /v1/admin/events/:id/cap     | Set CAP (`cap >= 0`; `cap = 0` = pause; tier 1/3/10 computes from stock) |
| GET /v1/admin/events/:id/stats   | CAP + slot stats                                                         |
| GET /v1/admin/config/fees        | Fee config                                                               |
| PUT /v1/admin/config/fees        | Update fee config                                                        |
| GET /v1/admin/bookings/:id       | Booking detail (NIK always masked)                                       |
| GET /v1/admin/refund-flags       | Refund flags, read-only (ADR-0009)                                       |
| PATCH /v1/admin/events/:id/queue | Pause/resume/close the queue (proxies to the queue admin API)            |
| GET /v1/admin/users              | List accounts by role                                                    |

## CAP (LLD-05 §5.2, CAP final v1)

- Effective CAP = min(chosen cap, infra cap). Infra cap = load-test breaking
  point x 0.75. Tier (1x/3x/10x) is a shortcut: a tier without an explicit
  cap computes total stock x multiplier and saves it.
- `cap = 0` is PAUSE (no new admission; pause = cap=0, item 13, 6 Nov).
  Negative cap is rejected (400).
- CAP lives in the event model (Postgres), never in Valkey (model event,
  ADR-0022). Core uses the effective CAP to compute empty slots.
  Changing CAP works even when Valkey is down.
- Slot stats come from core (Postgres booking states), not from Valkey and
  not from a queue stats endpoint: `held` = tickets in PAYMENT_PENDING
  bookings, `sold` = tickets in PAID bookings,
  `available = total - held - sold` (ticket units).

## Fees (structure decided 1 Nov, LLD-05 §5.3)

total = subtotal + platform fee + admin fee + tax1 + tax2, where tax1 is
PPN 11% x platform fee and tax2 defaults to 0 (label "Pajak Lainnya").
`admin_fee: null` means TBD (no official Midtrans tariff yet) and counts
as 0. A fee change only applies to new bookings.

## Data & config

- Store: Postgres when `DATABASE_URL` is set, otherwise the in-memory
  store (tests + local dev). The Postgres store implements the same
  interface (LLD-05 §3 tables) but is not integration-tested here — it
  needs a live database to verify.
- `AUTH_PUBLIC_KEY_JWK` (single JWK or `{"keys": [...]}`) or
  `AUTH_JWKS_URL` (published by auth-module). Unset = every token rejected
  (fail-closed).
- `QUEUE_ADMIN_URL` / `QUEUE_ADMIN_TOKEN`: the queue-module admin API
  (private port) for PATCH .../queue. Unset = 503 SERVICE_UNAVAILABLE.
- Every admin mutation is written to `audit_log` (DB) and to the
  operational log with masked NIK (Q40).

## Security

- `helmet` (default settings) sets the security headers on every
  response (`x-content-type-options: nosniff`, `x-frame-options`,
  `strict-transport-security`, …). This is a JSON API — no HTML is
  rendered, so the defaults are fine.
- `cors` allows only the origins in `CORS_ORIGINS` (comma-separated).
  Default when unset/empty: `https://rusuh-tiket.web.id`,
  `https://www.rusuh-tiket.web.id`, `http://localhost:3000`,
  `http://localhost:5173`.

## Design

- LLD: `rusuh-documentation/architecture/lld-05-officer-admin.md` (§5–§6)
- Contract: `rusuh-documentation/api/openapi.yaml` (Admin tag)
- Decisions: `keputusan-diskusi-rusuh-core-2026-10-27.md` (D18, CAP final v1,
  fee structure, item 13 pause, Q20 threshold)

## Known gaps (see the story-branch report)

- Most admin endpoints are NOT in `openapi.yaml` yet (only
  PATCH .../queue, GET /admin/refund-flags and POST
  /admin/incidents/ttl-freeze are defined there) — implemented here per
  LLD-05; the yaml sync is a separate step.
- The yaml `ErrorCode` enum has no FORBIDDEN (403) or generic 503 code;
  this service renders `FORBIDDEN` / `SERVICE_UNAVAILABLE` for those.
- The yaml `adminAuth` (SSO operator token) is the queue admin API's auth;
  this backoffice API uses the account JWT + DB role and proxies to the
  queue with the operator token.
- Not in this story: POST /v1/admin/users, PUT /v1/admin/users/:id/role,
  POST /v1/admin/bookings/:id/reveal-nik, GET /v1/admin/review-queue,
  GET /v1/admin/audit-log, POST .../open-sale / .../close-sale,
  PUT .../categories/:catId/threshold, POST /admin/incidents/ttl-freeze.
