# Error Codes — rusuh-core

> **Reference for frontend code-to-message conversion.** Every API error in
> rusuh-core is rendered as RFC 9457 Problem JSON with a stable machine `code`.
> The frontend should map `code` (not HTTP status, not `title`) to a user-facing
> message. `detail` carries the human-readable explanation for the specific
> failure; `type` is a Problem URI and is not a message. Some responses carry
> extra members (`attemptsLeft`, `retryAfter`, `categoryId`, `traceId`).

## Response shape

```json
{
  "type": "https://api.rusuh.id/problems/not-found",
  "title": "Not found",
  "status": 404,
  "code": "NOT_FOUND",
  "detail": "Booking RSH-26-084731 not found",
  "traceId": "9f1c2a…"
}
```

Notes on the shape:

- `code` is always present and is the stable key for the frontend mapping.
- `status` mirrors the HTTP status.
- `detail` is free text (English or Indonesian, depending on the service) — show
  it as a fallback, but do not key messages off it.
- `type` is inconsistent across services today: core uses
  `https://api.rusuh.id/problems/<kebab-code>`, while auth, officer and admin
  use `about:blank`. Do not parse `type`.
- `traceId` (request correlation id) is present when the request carried one.

## Master table

| Code                       | HTTP | Meaning (what happened / what the user did wrong)                                                                                                                                | Used by                     |
| -------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| BAD_REQUEST                | 400  | The request body failed validation or is malformed JSON.                                                                                                                         | auth                        |
| VALIDATION_FAILED          | 400  | A request field failed validation (Joi) or the JSON body is malformed.                                                                                                           | core, officer, admin        |
| UNAUTHORIZED               | 401  | The account token is missing, invalid or expired; the OTP challenge belongs to a different device; or the refresh token is missing/invalid. Re-login / request a new code.       | auth, core, officer, admin  |
| ADMISSION_INVALID          | 403  | The admission token is missing, expired, does not match the booking, or was already consumed. The user must go back to the waiting room and rejoin the queue.                    | core                        |
| FORBIDDEN                  | 403  | The authenticated account does not have the role required for this endpoint (officer/admin).                                                                                     | officer, admin              |
| NOT_FOUND                  | 404  | The requested booking, event, ticket or category does not exist.                                                                                                                 | auth*, core, officer, admin |
| QUANTITY_OVER_RESERVATION  | 409  | The requested ticket quantity exceeds the admission's `max_tickets`.                                                                                                             | core                        |
| DUPLICATE_NIK              | 409  | The same NIK appears more than once in one order.                                                                                                                                | core                        |
| NIK_SEAT_TAKEN             | 409  | The NIK already holds 3 seats for this event (BR-01, max 3 per NIK per event).                                                                                                   | core                        |
| CATEGORY_SOLD_OUT          | 409  | The ticket category has no stock left.                                                                                                                                           | core                        |
| BOOKING_NOT_HELD           | 409  | The booking is not in a held state for the requested step (e.g. starting payment on a booking that is no longer held).                                                           | core                        |
| BOOKING_NOT_PAID           | 409  | **Defined, never thrown** (see below). Intended for operations that require a paid booking.                                                                                      | core (defined only)         |
| NOT_CANCELLABLE            | 409  | **Defined, never thrown** (see below). The booking cannot be cancelled; the cancel endpoint is not in v1.                                                                        | core (defined only)         |
| ATTENDEE_NOT_VALIDATED     | 409  | An attendee has no validation token, or the token is expired / for a different event. The attendee must be validated (NIK) first.                                                | core                        |
| ACCOUNT_HAS_ACTIVE_BOOKING | 409  | The account already has an active booking for this event (one active slot per customer per event).                                                                               | core                        |
| WRONG_CODE                 | 409  | The OTP code is wrong. The response carries `attemptsLeft`.                                                                                                                      | auth                        |
| CONFLICT                   | 409  | **Defined, never thrown** (see below). Generic conflict placeholder in the auth error map.                                                                                       | auth (defined only)         |
| TOO_MANY_REQUESTS          | 429  | Too many OTP code requests; the cooldown has not elapsed. The response carries `retryAfter` (seconds).                                                                           | auth                        |
| RATE_LIMITED               | 429  | Attendee validation is rate-limited (3 attempts per minute per field per order). The response carries `retryAfter: 60`.                                                          | core                        |
| QUEUE_CLOSED               | 410  | **Defined, never thrown by rusuh-core** (see below). The queue for the event is closed.                                                                                          | — (defined only)            |
| MISSED                     | 410  | **Defined, never thrown by rusuh-core** (see below). The user's turn was missed (60 s claim window elapsed).                                                                     | — (defined only)            |
| EXPIRED                    | 410  | **Defined, never thrown as an error by rusuh-core** (see below). The booking/admission has expired.                                                                              | — (defined only)            |
| CHALLENGE_EXPIRED          | 410  | The OTP challenge is missing, already used, or past its expiry. Request a new code.                                                                                              | auth                        |
| CHALLENGE_LOCKED           | 410  | Too many wrong OTP attempts; the challenge is locked. Request a new code.                                                                                                        | auth                        |
| NIK_INVALID                | 422  | The NIK failed format or Dukcapil verification (gating: BLOCK — the user cannot proceed to hold).                                                                                | core                        |
| DUKCAPIL_UNAVAILABLE       | 503  | The Dukcapil verification service is unreachable (circuit breaker open). Retry later.                                                                                            | core                        |
| SERVICE_UNAVAILABLE        | 503  | A downstream service is unavailable: OTP sending failed, token verification is down, NIK decryption/KMS is down, the database is not configured, or the queue admin API is down. | auth, officer, admin        |
| INTERNAL_ERROR             | 500  | An unexpected server error.                                                                                                                                                      | auth, core, admin           |
| TIKET_TIDAK_DITEMUKAN      | 404  | The ticket code/ID was not found.                                                                                                                                                | officer                     |
| TIKET_SUDAH_DIGUNAKAN      | 409  | **Defined, never thrown** (see below). The ticket was already used; re-scanning is idempotent and returns 200 with the original scan instead.                                    | officer (defined only)      |
| TIKET_TIDAK_BERLAKU        | 409  | The ticket was scanned outside its event date.                                                                                                                                   | officer                     |

\* `NOT_FOUND` in auth is only the generic status map entry (used to render
plain 404s); auth's business logic does not throw it for a missing resource.

**Totals: 31 distinct codes.** 24 are thrown by at least one rusuh-core app;
7 are defined but never thrown (listed below).

## Per-service notes

### auth (`apps/auth`)

- OTP flow codes: `WRONG_CODE` (with `attemptsLeft`), `CHALLENGE_EXPIRED`,
  `CHALLENGE_LOCKED`, `TOO_MANY_REQUESTS` (with `retryAfter`).
- Session codes: `UNAUTHORIZED` (refresh token missing/invalid, OTP challenge
  bound to another device), `SERVICE_UNAVAILABLE` (OTP send failed, token
  verification down).
- Request validation: `BAD_REQUEST` (Joi validation, malformed JSON).
- Generic map only: `NOT_FOUND`, `CONFLICT`, `INTERNAL_ERROR`.

### core (`apps/core`)

- The largest set (18 repo codes + 5 core extras). Admission: `ADMISSION_INVALID`.
- Booking/hold: `QUANTITY_OVER_RESERVATION`, `DUPLICATE_NIK`, `NIK_SEAT_TAKEN`,
  `CATEGORY_SOLD_OUT`, `BOOKING_NOT_HELD`, `ATTENDEE_NOT_VALIDATED`,
  `ACCOUNT_HAS_ACTIVE_BOOKING`, `NIK_INVALID`, `DUKCAPIL_UNAVAILABLE`.
- Validation/rate-limit: `VALIDATION_FAILED` (also the fallback for any Boom 400
  and for malformed JSON), `RATE_LIMITED` (validateAttendee).
- Auth: `UNAUTHORIZED` (missing/invalid account token), `NOT_FOUND`.
- Fallback: any Boom 404 renders as `NOT_FOUND`; anything else unexpected
  renders as `INTERNAL_ERROR`.

### payment (`apps/payment`)

- **No repo error codes.** The public Midtrans webhook always answers 200,
  even for an invalid signature or malformed body (webhook hardening, Q45) —
  the failure is logged + alerted, never returned to the caller. Internal Snap
  input errors are plain Boom 400s without a machine code, and unknown routes
  are plain Boom 404s. The frontend therefore never needs to map a payment
  error code.

### notification (`apps/notification`)

- **No public endpoints and no error codes.** It is an SQS consumer only;
  failures are retried / dead-lettered, not returned to a caller.

### officer (`apps/officer`)

- Ticket codes: `TIKET_TIDAK_DITEMUKAN`, `TIKET_TIDAK_BERLAKU`
  (`TIKET_SUDAH_DIGUNAKAN` is defined but never thrown — see below).
- Auth/role: `UNAUTHORIZED`, `FORBIDDEN` (wrong role for officer endpoints).
- Infra: `SERVICE_UNAVAILABLE` (NIK decryption/KMS down, database not configured).
- Validation: `VALIDATION_FAILED`.

### admin (`apps/admin`)

- Resource: `NOT_FOUND` (booking/event not found).
- Role: `FORBIDDEN` (admin role required).
- Downstream: `SERVICE_UNAVAILABLE` (queue admin API down).
- Validation: `VALIDATION_FAILED`. Fallback: `INTERNAL_ERROR`.

## Defined but never thrown (7 codes)

These exist in a code registry but no rusuh-core app throws them today. Do not
map them to a user-facing message until they are thrown; if the frontend ever
receives one, treat it as an unexpected error and log it.

| Code                  | Registry                       | Why it is never thrown                                                                                                                                                                                                        |
| --------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NOT_CANCELLABLE       | `@rusuh/contracts` ERROR_CODES | The cancel endpoint is not in v1 (`POST /v1/core/bookings/{id}/cancel` is marked NON-V1).                                                                                                                                     |
| BOOKING_NOT_PAID      | core `EXTRA_CODES`             | Defined for operations that require a paid booking; no call site throws it yet.                                                                                                                                               |
| CONFLICT              | auth `GENERIC_CODES`           | Generic 409 placeholder in the auth status map; no call site throws it.                                                                                                                                                       |
| QUEUE_CLOSED          | `@rusuh/contracts` ERROR_CODES | Queue-domain 410 code; the queue service (Go) is the one that closes a queue. Confirm with the queue team whether it throws this code.                                                                                        |
| MISSED                | `@rusuh/contracts` ERROR_CODES | Queue-domain 410 code (missed turn, 60 s claim window); same as above.                                                                                                                                                        |
| EXPIRED               | `@rusuh/contracts` ERROR_CODES | Never thrown as an error by rusuh-core. Note: `EXPIRED` also exists as a booking _status_ and as a notification email-log _type_ — those are not error codes. The 410 error code's thrower is TBD (likely the queue service). |
| TIKET_SUDAH_DIGUNAKAN | officer `OFFICER_ERROR_CODES`  | Re-scanning an already-used ticket is idempotent: it returns 200 with the original `usedAt`/`usedBy` instead of an error.                                                                                                     |

## Internal codes (not frontend-facing)

| Code        | Where                                   | Meaning                                                                            |
| ----------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| STOK_KURANG | core Valkey Lua `check-and-hold` return | Stock insufficient; the use case maps it to `CATEGORY_SOLD_OUT` before responding. |
| KUOTA_NIK   | core Valkey Lua `check-and-hold` return | NIK quota exceeded; the use case maps it to `NIK_SEAT_TAKEN` before responding.    |

These never leave the service — the frontend must never see them.

## Known gaps (to fix before the frontend mapping is final)

1. **OpenAPI enum sync:** `TIKET_TIDAK_DITEMUKAN`, `TIKET_SUDAH_DIGUNAKAN`,
   `TIKET_TIDAK_BERLAKU`, `FORBIDDEN` and `SERVICE_UNAVAILABLE` are not yet in
   the `openapi.yaml` `ErrorCode` enum (flagged in
   `apps/officer/src/domain/errors.js` and `apps/admin/src/domain/errors.js`).
   `VALIDATION_FAILED` is in the enum.
2. **`type` URI inconsistency:** core renders
   `https://api.rusuh.id/problems/<kebab-code>`; auth, officer and admin render
   `about:blank`. The frontend must not parse `type`.
3. **Queue-service codes:** `QUEUE_CLOSED`, `MISSED` and the 410 `EXPIRED` error
   code are defined in the shared contracts but their thrower is the queue
   service (Go, separate repo). Confirm the exact codes and statuses with the
   queue team before mapping them.
4. **Two generic names for the same thing:** auth uses `BAD_REQUEST` (400) for
   request validation while core/officer/admin use `VALIDATION_FAILED` (400);
   auth uses `TOO_MANY_REQUESTS` (429) while core uses `RATE_LIMITED` (429).
   The frontend mapping must include both names for each meaning.
5. **Dead definitions:** the 7 codes in "Defined but never thrown" should either
   gain a throw site or be removed before the evaluation presentation — an
   unused code in the registry invites a question nobody can answer.

## Sources

- `packages/contracts/src/errors.js` — `ERROR_CODES` (18 codes).
- `apps/core/src/domain/problem.js` — `EXTRA_CODES` (5 codes).
- `apps/auth/src/application/shared/api-error.js` — `GENERIC_CODES` (7 codes).
- `apps/officer/src/domain/errors.js` — `OFFICER_ERROR_CODES` (5 codes).
- `apps/admin/src/domain/errors.js` — `VALIDATION_FAILED` / `FORBIDDEN` /
  `SERVICE_UNAVAILABLE` renderings.
- Throw sites verified by grep across all six apps (production code only).
