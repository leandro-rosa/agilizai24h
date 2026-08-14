#!/bin/sh
# Runs once when the localstack container becomes ready (mounted at
# /etc/localstack/init/ready.d/ — see backend/docker-compose.yaml). Creates
# the bucket quote-api's S3Service uploads to; idempotent (safe if the
# bucket already exists from a previous run against the same volume).
set -eu

awslocal s3 mb "s3://${AWS_S3_BUCKET:-quote-uploads}" 2>/dev/null || true
