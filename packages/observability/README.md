# @rusuh/observability

Structured JSON logging + correlation IDs for the rusuh-core Node modules
(Q40). Logs go to CloudWatch; traces to X-Ray (OTel SDK deferred). Rules:
JSON lines, `booking_id`/`request_id` correlation, NIK masked (4+4), no
tokens/OTP/secrets in logs. Audit trail lives in Postgres, separate from
operational logs.
