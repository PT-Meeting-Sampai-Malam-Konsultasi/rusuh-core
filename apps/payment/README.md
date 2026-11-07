# payment-service (rusuh-core)

The payment-module of rusuh-core (ADR-0008, LLD-03). Hosts the Midtrans
Snap payment page (sandbox) and confirms payments via the Midtrans
HTTP notification webhook + Get Status API.

- Port: **8083** (default).
- Stack: Express + CommonJS, same boilerplate as rusuh-mock.
- Public endpoint (the ONLY one in this module):
  `POST /v1/webhooks/midtrans` — Midtrans HTTP notification.
- Internal functions (used by core-module via internal call; no extra
  public routes): `createSnapTransaction`, `confirmViaGetStatus`,
  `expireOrder` (see `src/application/`).

## How it works

### Attempts

One row per ATTEMPT in `payment_orders`. `order_id` =
`{booking_id}-{attempt}` (attempt = existing attempts for the booking + 1).
Each attempt has its own `snap_token`. `snap_start_time` is inherited from
attempt 1 (so the expiry window is always booking creation + 10 min).

Re-creating a Snap transaction = a NEW attempt. The old attempt's token is
**NOT** revoked (it stays payable until P+10); the first settlement wins.
Snap creation failure leaves the order in state `created` (no payment row
is created).

### Expiry (no grace buffer — ADR-0026)

`expiry = { start_time: booking created_at, unit: minutes, duration: 10 }`.
Payment not arrived by P+10 fails and the stock is released by the
core-module sweeper. A late settlement after expiry NEVER resurrects the
booking (ADR-0009): the booking stays EXPIRED, the payment is recorded
with `paid_after_expiry = true` + `refund_required = true`, flagged for
admin review. The refund itself is out of scope.

### Webhook pipeline (LLD-03 §5.1)

1. Parse the JSON body (64 KB limit — oversize → 200, no state change).
2. Verify `signature_key = SHA512(order_id + status_code + gross_amount +
ServerKey)` FIRST, constant-time compare. Invalid → **200** + log +
   alert (Q45: no 401, no stack trace).
3. Dedup via `UNIQUE(transaction_id)` + `confirmed` flag: same
   transaction + same status + `confirmed=true` → duplicate, 200 stop.
   Different status → progression UPDATE. Same status but
   `confirmed=false` → process again.
4. Amount pre-check: the webhook `gross_amount` must equal the server
   total for the order. Mismatch → 200, no transition, log + alert.
5. Confirm EVERY webhook via `GET /v2/{order_id}/status` (Get Status).
   The Get Status response (status + gross_amount) is authoritative, NOT
   the webhook payload. Retries: max 3× with exponential backoff; still
   failing → **500** + alert + manual recovery. Get Status 404 → anomaly,
   log + alert, 200, no state change.
6. Amount re-check against the Get Status gross_amount.
7. Upsert the attempt + update the order (idempotent).
8. Map the status:
   - `settlement` / `capture` with fraud status `accept` →
     `notifyPaymentResult` to core-module (idempotent; core guards the
     transition). If core says the booking already expired →
     `PAID_AFTER_EXPIRY` (see above).
   - `expire` → notify core (the timeout path).
   - `pending`, `deny`, `cancel`, `failure`, `refund` → record only
     (a failed ATTEMPT is not a failed booking — the booking is only
     failed when the 10-minute hold expires).
9. Always answer 200 (except the Get Status / core-callback 500 cases);
   the Midtrans retry policy depends on it.

Redirect `finish` / `unfinish` / `error` is NOT confirmation — only the
webhook (confirmed by Get Status) settles a payment. The wrapper page
(event, breakdown, countdown, theme; web via `redirect_url`/`snap.js`,
mobile via system tab + one-time handoff code in the URL fragment +
return via App Link) is FE work — this module only returns
`redirect_url` + `snap_token`.

## Store

- Default: in-memory store (`PAYMENT_STORE=memory`, or when no
  `DATABASE_URL` is set) — tests and local runs need no live database.
- Postgres: set `DATABASE_URL` (or `PAYMENT_STORE=postgres`). Schema in
  `src/infrastructure/persistence/schema.sql` (`payment_orders`,
  `payment_attempts`, `callback_log`; `UNIQUE(transaction_id)`).
  The Postgres store is implemented but was NOT tested against a live
  database in this VM (none available).

## Core-module contract (assumed, to be implemented by core-module)

`POST {CORE_INTERNAL_URL}/internal/payments/notify` (LLD-02 §5), header
`x-service-credential: {CORE_SERVICE_CREDENTIAL}`, body:

```json
{
  "booking_id": "bk_01",
  "order_id": "bk_01-1",
  "transaction_id": "8c2f…",
  "transaction_status": "settlement",
  "payment_type": "gopay",
  "gross_amount": "250000"
}
```

Response (JSON): `{ "booking_status": "PAID", "action_taken": "paid" }`.
`action_taken` may also be `paid_after_expiry` (booking already expired —
the payment module records PAID_AFTER_EXPIRY and does NOT resurrect).
The endpoint must be idempotent (same `transaction_id` twice → same
response).

The core-module also owns the public `/payments/{bookingId}` endpoints
(GET, POST `/snap`, GET `/status`) — they delegate to this module's
`createSnapTransaction` internally.

## Configuration

See `.env.example`. The important ones:

- `MIDTRANS_SERVER_KEY` — backend-only. Without it the app still starts
  (health only); the webhook route is NOT mounted and signatures fail
  closed.
- `MIDTRANS_SNAP_BASE_URL` / `MIDTRANS_API_BASE_URL` — sandbox by
  default.
- `CORE_INTERNAL_URL` / `CORE_SERVICE_CREDENTIAL` — where to notify.
- `GET_STATUS_MAX_RETRIES` (default 3), `GET_STATUS_RETRY_BASE_MS`
  (default 200), `CORE_NOTIFY_MAX_RETRIES` (3), `CORE_NOTIFY_TIMEOUT_MS`
  (5000), `WEBHOOK_BODY_LIMIT_BYTES` (65536).

## Running

```bash
npm install            # from the repo root
npm start              # from apps/payment
npm run check          # prettier + eslint + tests + coverage (must pass)
```

## Tests

79 tests, 11 suites (`npm run check` green): signature verification
(incl. tampered amounts), dedup cases (duplicate / progression /
unconfirmed-retry), `order_id` format, expiry (P+10 from attempt 1),
PAID_AFTER_EXPIRY, Get Status retry / 404 / failure → 500, expireOrder
(412 ignored), and supertest route tests (valid → 200 + core called,
invalid signature → 200, duplicate → 200, malformed JSON → 200,
oversize → 200, Get Status failure → 500, core failure → 500,
service throws → 500, unknown route → 404, health ok).

## Known contract deltas (openapi.yaml — for the parent to reconcile)

1. `/payments/{bookingId}/snap` says a new method "expires the live
   attempt first" — implemented per LLD-03 §4.4: the old attempt token is
   NOT revoked, stays payable until P+10, first settlement wins.
2. Snap expiry: openapi says "60 s before the hold ends" — implemented
   per LLD-03 §4: duration 10 min from `start_time` = booking created_at
   (P+10).
3. Webhook invalid signature: openapi says 401 — implemented per LLD-03
   §5.1 step 4 / Q45: 200 + log + alert.
4. `/payments/{bookingId}` GET, `/payments/{bookingId}/snap` POST,
   `/payments/{bookingId}/status` GET are core-module public endpoints
   (not built here — core delegates to `createSnapTransaction`).
5. `POST /internal/payments/notify` is a contract assumption — core
   must implement it (see above).
6. The wrapper page is FE work — no backend route built for it.
7. Get Status 404 before a method is chosen is NORMAL (Q26) — only an
   anomaly when it follows a valid webhook.
