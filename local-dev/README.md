# Local real-test setup

A real local test — not a smoke test. Postgres, Valkey, and LocalStack
(SQS + SES + S3) run in Docker. The Dukcapil mock and six rusuh-core apps run
on the host, so you can edit code and restart them like a normal Node developer.

## What runs where

| Piece                                                                                 | Where              | Replaces           |
| ------------------------------------------------------------------------------------- | ------------------ | ------------------ |
| Postgres 16 (`rusuh-postgres`, :5432)                                                 | Docker             | RDS Postgres       |
| Valkey 7.2 (`rusuh-valkey`, :6379)                                                    | Docker             | ElastiCache Valkey |
| LocalStack 3.8.1 (`rusuh-localstack`, :4566)                                          | Docker             | SQS + SES + S3     |
| Dukcapil mock (`rusuh-mock`, :18082)                                                  | Host (`npm start`) | real Dukcapil      |
| auth :8081, core :8082, payment :8083, notification :8084, officer :8085, admin :8086 | Host (`npm start`) | —                  |

LocalStack resources (created by the one-shot `localstack-init` container):
SQS queues `rusuh-local-admission`, `rusuh-local-empty-slot`,
`rusuh-local-otp`, `rusuh-local-email` (each with its own DLQ,
`maxReceiveCount` 3), S3 bucket `rusuh-local-tickets`, SES identity
`noreply@rusuh-tiket.web.id`. Nothing is really delivered — LocalStack
captures the emails.

No local replacement is needed for Midtrans (use the sandbox keys),
KMS (a random 32-byte key in `.env` stands in for the envelope key, D24),
or CloudWatch/X-Ray (logs are JSON on stdout).

## Quick start

```sh
# 0. Docker Desktop running. Clone rusuh-mock next to rusuh-core,
#    then start its Dukcapil mock on the host in a separate terminal:
cd ../rusuh-mock/service-dukcapil && PORT=18082 npm start

# 1. Start Docker infrastructure (Postgres, Valkey, LocalStack)
cd ../../rusuh-core && docker compose -f local-dev/docker-compose.yml up -d

# 2. Write apps/*/.env (local URLs + generated keys; never committed)
bash local-dev/setup-env.sh

# 3. Fill the Midtrans sandbox keys in apps/payment/.env
#    (MIDTRANS_SERVER_KEY + MIDTRANS_CLIENT_KEY, merchant 'edy').
#    Server key is backend-only — never commit it.

# 4. Start the apps (one terminal each, or one at a time)
cd apps/auth && npm start         # 8081
cd apps/core && npm start         # 8082
cd apps/payment && npm start      # 8083
cd apps/notification && npm start # 8084
cd apps/officer && npm start      # 8085
cd apps/admin && npm start        # 8086
```

## First end-to-end run

1. `POST /v1/auth/otp` with your email, then `POST /v1/auth/otp/verify`
   with the code. The code is **not** in a real inbox — LocalStack captures
   the SES email. Read it back from LocalStack's internal SES store:
   `curl -s http://localhost:4566/_aws/ses | python3 -m json.tool`
   (the message body contains the 6-digit code). Note: the OTP code is
   deliberately never written to any service log, so the SES capture is
   the only place to read it in a real-test run. If that endpoint returns
   nothing on your LocalStack version, tell me and I will add a dev-only
   debug endpoint to the auth module instead.
2. Create an event + categories via the admin API
   (`POST /v1/admin/events`), or insert one directly into Postgres
   (`events` + `categories` tables) — the admin module is the supported path.
3. Walk the journey: events → attendees/validate (NIK `3171010101900001`,
   a synthetic Dukcapil-mock NIK — the mock verifies format only, so any
   format-valid 16-digit NIK passes) → bookings → payment (Snap sandbox) →
   webhook → tickets → officer scan.

## Notes and limits

- Postgres init scripts (`postgres-init/`) run **once**, on first start
  (empty volume). They are the modules' own schemas
  (`CREATE TABLE IF NOT EXISTS`): auth `001_auth.sql`, core `schema.sql`,
  payment `schema.sql`. To re-apply after a schema change, run them by hand:
  `psql "postgres://rusuh:rusuh-dev@localhost:5432/rusuh" -f <file>`.
- `setup-env.sh` never overwrites an existing `apps/*/.env` (use `--force`).
  It generates fresh keys every run with `--force`, which invalidates
  tokens issued under the old keys — expected for local dev.
- `PATCH /v1/admin/events/:id/queue` answers 503 until the queue service
  (rusuh-queue) runs — that proxy is out of scope for this setup.
- The queue-related SQS values (visibility timeout 30 s, `maxReceiveCount`
  3, stale-claim threshold 5 min) are still **Usulan** (LLD-04 §6,
  §10.1–2) — tune them in `localstack-init.sh` when the team confirms.
- To stop: `docker compose -f local-dev/docker-compose.yml down`.
  Add `-v` to wipe all local data (Postgres, Valkey, LocalStack).
