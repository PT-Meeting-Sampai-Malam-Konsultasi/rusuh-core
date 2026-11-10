# @rusuh/notification-service

Notification service: SQS consumer, SES email (OTP, e-ticket, expired).

Part of the `rusuh-core` monorepo. Same boilerplate as `rusuh-mock`
(Express + CommonJS, Jest + Supertest, ESLint airbnb-base + Prettier).

## What it does

This module has **no public endpoints** (LLD-04, ADR-0017). It is a worker:
it long-polls two SQS queues and sends email through SES — the single email
pipeline for the whole system. Auth-module never calls SES directly; core
never sends email inline.

- `rusuh-otp` — OTP codes (latency-sensitive; visibility 30s, maxReceive 3).
- `rusuh-email` — e-ticket (FR-22) + expired (FR-23) (visibility 60s, maxReceive 5).
- Each queue has its own DLQ. A failed send leaves the message for SQS
  redelivery; after `maxReceiveCount` it moves to the DLQ + alert (NFR-10:
  a failing email never cancels a transaction).

Dedup: `email_log` UNIQUE(booking_id, type) with the claim pattern
(claimed / duplicate-sent / in-flight / stale-reclaim / failed re-claim).
OTP does not use `email_log` (every OTP request is a new code). Delivery is
at-least-once by design: a crash between SES accept and the `sent` update
may resend the same email (a duplicate is cheaper than a lost ticket).

E-ticket PDFs are fetched from S3 and attached via SES SendRawEmail; a
presigned download link is also included in the body. A ticket whose PDF
cannot be fetched is never sent without its attachment — the job fails
for SQS redelivery instead.

## Run

```sh
npm ci
npm start          # PORT=8084 by default
npm run check      # format + lint + tests + coverage
```

The HTTP server only serves health endpoints (`GET /sys/ping`,
`/health/live`, `/health/ready`). The worker starts in the background
alongside it; graceful shutdown finishes in-flight messages first.
Set `WORKER_ENABLED=false` to run HTTP-only, or leave the SQS queue URLs
empty (worker disabled, health still serves).

Security: `helmet()` (default settings) sets the security headers on every
response, and `cors()` restricts cross-origin access to `CORS_ORIGINS`
(comma-separated; empty = the default production domains plus local dev
frontends, see `.env.example`). This service has no public endpoints, so
CORS has no practical effect here — the wiring is kept consistent with the
other services.

## Configuration

See `.env.example`. Production must set `SQS_OTP_QUEUE_URL`,
`SQS_EMAIL_QUEUE_URL`, `DATABASE_URL` (email_log), `S3_TICKET_BUCKET`,
`SES_FROM_EMAIL` (verified domain + DKIM) and `ADMIN_EMAIL`. SES production
access is required before go-live (sandbox: 200/day, verified addresses only).

## Design

- LLD: `rusuh-documentation/architecture/lld-04-notification-module.md`
- Contract: `rusuh-documentation/api/openapi.yaml` (no endpoints for this module)
- Decisions: Q27, Q34, Point 6, NFR-10, D11, D15
