#!/bin/sh
# Creates the LocalStack resources rusuh-core needs for a real local test.
# Runs once (one-shot container `localstack-init`). Idempotent: every create
# is guarded so re-running the container does not fail.
#
# Queues (naming: rusuh-<env>-<name>, env = local):
#   rusuh-local-admission    queue -> core (admission events, ADR-0021/0023)
#   rusuh-local-empty-slot   core -> queue (empty-slot events, ADR-0022/0023)
#   rusuh-local-otp          auth -> notification (OTP email jobs, LLD-04 §2)
#   rusuh-local-email        core -> notification (e-ticket / expired, LLD-04 §2)
# Each queue has its own DLQ (redrive after 3 receives).
# S3 bucket: rusuh-local-tickets (e-ticket PDFs, notification-module).
# SES identity: noreply@rusuh-tiket.web.id (notification SES_FROM_EMAIL).
set -eu

ENDPOINT="${AWS_ENDPOINT_URL:-http://localstack:4566}"
REGION="${AWS_DEFAULT_REGION:-ap-southeast-3}"

# Wait for LocalStack to answer (the container already waits for healthy,
# but the SQS API can lag a few seconds behind the health endpoint).
for i in $(seq 1 30); do
  if aws --endpoint-url "$ENDPOINT" --region "$REGION" sqs list-queues >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

create_queue() {
  name="$1"
  dlq="$2"
  if aws --endpoint-url "$ENDPOINT" --region "$REGION" sqs get-queue-url --queue-name "$name" >/dev/null 2>&1; then
    echo "queue exists: $name"
    return
  fi
  # DLQ first (no redrive on the DLQ itself).
  aws --endpoint-url "$ENDPOINT" --region "$REGION" sqs create-queue \
    --queue-name "$dlq" >/dev/null
  dlq_arn=$(aws --endpoint-url "$ENDPOINT" --region "$REGION" sqs get-queue-attributes \
    --queue-url "$ENDPOINT/000000000000/$dlq" \
    --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)
  aws --endpoint-url "$ENDPOINT" --region "$REGION" sqs create-queue \
    --queue-name "$name" \
    --attributes "{\"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"$dlq_arn\\\",\\\"maxReceiveCount\\\":3}\", \"VisibilityTimeout\": \"30\"}" >/dev/null
  echo "queue created: $name (DLQ $dlq, maxReceiveCount 3)"
}

create_queue rusuh-local-admission rusuh-local-admission-dlq
create_queue rusuh-local-empty-slot rusuh-local-empty-slot-dlq
create_queue rusuh-local-otp rusuh-local-otp-dlq
create_queue rusuh-local-email rusuh-local-email-dlq

# S3 bucket for ticket PDFs.
if aws --endpoint-url "$ENDPOINT" --region "$REGION" s3api head-bucket --bucket rusuh-local-tickets >/dev/null 2>&1; then
  echo "bucket exists: rusuh-local-tickets"
else
  aws --endpoint-url "$ENDPOINT" --region "$REGION" s3api create-bucket \
    --bucket rusuh-local-tickets --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  echo "bucket created: rusuh-local-tickets"
fi

# SES sender identity (LocalStack accepts it; nothing is really delivered).
if aws --endpoint-url "$ENDPOINT" --region "$REGION" ses list-identities --query 'Identities' --output text 2>/dev/null | grep -q "noreply@rusuh-tiket.web.id"; then
  echo "SES identity exists: noreply@rusuh-tiket.web.id"
else
  aws --endpoint-url "$ENDPOINT" --region "$REGION" ses verify-email-identity \
    --email-address noreply@rusuh-tiket.web.id >/dev/null
  echo "SES identity verified: noreply@rusuh-tiket.web.id"
fi

echo "localstack-init done."
