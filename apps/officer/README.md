# @rusuh/officer-service

Officer service: gate operations (ticket lookup, NIK reveal after scan, mark used,
attendee list). Part of the `rusuh-core` monorepo. Same boilerplate as `rusuh-mock`
(Express + CommonJS, Jest + Supertest, ESLint airbnb-base + Prettier).

## Endpoints (officer role only, account JWT)

| Method | Path                                    | Description                                                                            |
| ------ | --------------------------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/v1/officer/tickets/:ticketId`         | Lookup by ticket id (`tk_…`) or public code (`SMD-FB-04827`, the QR). Masked NIK only. |
| POST   | `/v1/officer/tickets/:ticketId/scan`    | Scan: reveals the full NIK **and** marks the ticket used (one step). Body `{ gate? }`. |
| GET    | `/v1/officer/events/:eventId/attendees` | Attendees of an event, masked NIK, paginated (`?page=&limit=`).                        |

Auth: `Authorization: Bearer <account JWT>` (Ed25519, verified locally with
`@rusuh/auth`). The officer role is resolved server-side from `accounts.role`
(LLD-05 §2), never from JWT claims. Missing/invalid token → 401 `UNAUTHORIZED`;
wrong role → 403 `FORBIDDEN`.

## Behaviour

- **Masked before scan, full after scan.** Lookup and the attendee list return
  `nikMasked` (`3171 •••• •••• 0001`, D15) only. A successful scan returns
  `nikFull` (the officer compares it with the holder's KTP).
- **Idempotent mark-used.** A repeat scan of an already-used ticket returns the
  SAME result (200, original `usedAt`/`usedBy`), not an error — but the repeat
  is still written to the audit log (`SCAN_REJECTED`, fraud signal).
- **Atomic check-and-mark** (D15): `UPDATE … WHERE status='unused'` — exactly one
  officer wins when two scan the same QR at once.
- **Gate warning.** If the scan `gate` differs from the ticket's expected gate,
  the response carries `gateWarning` but the mark-used is still allowed (LLD-05 §4.1).
- **Event date.** A scan outside the event's date returns 409 `TIKET_TIDAK_BERLAKU` (LLD-05 §4.2).
- **Audit.** Every scan writes `NIK_REVEALED` + `TICKET_MARKED_USED` (or
  `SCAN_REJECTED` for a repeat / out-of-date scan) to `audit_log` with the
  masked NIK only — the full NIK is NEVER written to the audit log or the
  operational log (D18, LLD-05 §3.2).
- **KMS.** NIK decryption failure returns 503, no bypass (LLD-05 §4.3).

## Error codes

Repo Problem schema (RFC 9457). `UNAUTHORIZED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404, unknown event), `TIKET_TIDAK_DITEMUKAN` (404, unknown ticket),
`TIKET_SUDAH_DIGUNAKAN` (409 — defined but not returned: mark-used is
idempotent, see above), `TIKET_TIDAK_BERLAKU` (409), `SERVICE_UNAVAILABLE`
(503, DB/KMS not configured or decrypt failed), `VALIDATION_FAILED` (400).

## Deviations from LLD-05 (to confirm with the team)

- **One-step scan.** LLD-05 §4.1 separates reveal (`POST /officer/scans`) from
  mark-used (`POST /officer/tickets/:code/mark-used`) so a wrong-person scan
  does not consume the ticket. This service merges them into a single
  `POST /officer/tickets/:id/scan` (per the story brief): a successful scan
  reveals the full NIK and marks the ticket used. The separate reveal endpoint
  is not implemented.
- **Idempotent repeat scan.** LLD-05 §4.1 returns 409 `TIKET_SUDAH_DIGUNAKAN`
  on a second scan; this service returns 200 with the same result (per the
  story brief) and still audits the repeat.
- **`GET /officer/events/:id/attendees`** is not in LLD-05 §4 (added by the
  story brief); it is implemented here.

## Gaps / follow-ups (yaml sync + other branches)

- **openapi.yaml has no `/officer/*` endpoints at all.** The three endpoints
  above (and the codes `TIKET_TIDAK_DITEMUKAN`, `TIKET_SUDAH_DIGUNAKAN`,
  `TIKET_TIDAK_BERLAKU`, `FORBIDDEN`, `SERVICE_UNAVAILABLE`) must be added to
  `api/openapi.yaml` (ErrorCode enum + Officer tag) in the yaml sync step.
  The `/tickets` and `/tickets/{ticketId}` endpoints in the yaml are
  customer-facing (core.booking, masked NIK) and are NOT this module.
- **Monorepo module-alias.** In the npm-workspaces monorepo the hoisted
  `module-alias` reads the ROOT `package.json` (no `_moduleAliases`) instead
  of this app's, so `@/…` requires fail at runtime. Fixed here by registering
  the alias explicitly in `src/server.js` and `src/app.js`
  (`require('module-alias').addAlias('@', __dirname)`). Every app needs the
  same fix (or a root-level fix).
- **Valkey jti denylist not wired.** Token verification covers signature +
  expiry + audience/issuer; the logout denylist lookup (Valkey, Q42) is a
  TODO in `src/infrastructure/auth-provider.js` (no Valkey client in this
  module yet).
- **KMS envelope.** NIK decryption uses a local 32-byte key
  (`NIK_ENCRYPTION_KEY`, dev/test stand-in). Production must use the KMS
  envelope (D24); the ciphertext format is identical.
- **Assumed tickets schema** (owned by core-module, LLD-02). The officer reads:
  `tickets(id, public_code, booking_id, event_id, category_id, category_name,
gate, seating, holder_name, nik_masked, nik_hmac, nik_cipher, status,
used_at, used_by, issued_at)`, `events(id, name, date)`,
  `accounts(id, email, role)`, `audit_log(id, created_at, actor_account_id,
actor_role, action, ticket_id, booking_id, event_id, nik_masked, details)`.
  The core story branch must create these columns (or the officer's SQL must
  be adjusted to the real schema).

## Run

```sh
npm ci            # from the repo root (installs all workspaces)
npm start         # PORT=8085 by default
npm run check     # format + lint + tests + coverage
```

Tests run without a live database (in-memory stores + injected auth). Set
`DATABASE_URL` for the Postgres store; without it the officer endpoints fail
closed with 503 `SERVICE_UNAVAILABLE` (health endpoints still work).
