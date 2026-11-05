# rusuh-core

Node.js monorepo for the rusuh ticket-booking backend (tender evaluation).
Services: auth, core, payment, notification, officer, admin (Go queue lives in
`rusuh-queue`, owned by David).

## Stack

Express + CommonJS JavaScript (same boilerplate as `rusuh-mock`), npm workspaces,
Jest + Supertest, ESLint (airbnb-base) + Prettier, Husky + lint-staged.

## Layout

```
apps/           one deployable per module (each with src/, tests, Dockerfile)
  auth/         account: passwordless email+OTP, account JWT, refresh tokens
  core/         transaction: events, booking, Valkey hold, tickets, sweeper
  payment/      Midtrans Snap wrapper, webhook + Get Status confirmation
  notification/ SQS consumer, SES email (OTP, e-ticket, expired)
  officer/      gate operations (ticket lookup, mark used)
  admin/        backoffice (events, categories, CAP, fees, refund flags)
packages/
  contracts/    shared error codes (RFC 9457 Problem), Joi schemas, constants
  auth/         shared account-JWT verification (Ed25519) — @rusuh/auth
  observability/ structured JSON logging, correlation IDs, metrics hooks
```

## Commands

```sh
npm ci            # install all workspaces
npm run check     # prettier + eslint + tests (all workspaces)
npm run test      # jest, all workspaces
```

Per-service: `cd apps/<name> && npm run check` (format + lint + tests + coverage).

## Design sources

- `rusuh-documentation`: ADR-0001–0026, `api/openapi.yaml` (living contract),
  `architecture/hld-rusuh-core.md`, `architecture/lld-01`–`lld-06`, `architecture/arsitektur-rusuh-core.md`.
- Decisions log: `keputusan-diskusi-rusuh-core-2026-10-27.md` (goals workspace).
- Queue-module (Go) is David's domain; this repo only implements the Node modules
  and the inter-service contracts (admission events via SQS, empty-slot events).
