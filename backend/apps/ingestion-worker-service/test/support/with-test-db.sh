#!/usr/bin/env bash
# Runs a command against a THROWAWAY Postgres: a container that is created here, migrated from
# scratch, and removed on exit. It is never the operator's running database — synthetic and test
# data must not share a database with real data.
#
# usage: with-test-db.sh <command...>
set -Eeuo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "with-test-db.sh: docker is required" >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  echo "usage: with-test-db.sh <command...>" >&2
  exit 2
fi

name="agiliz-ingestion-test-postgres-$$"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# Port 0 on the host: Docker picks a free one, so nothing collides with the real Postgres (5438).
docker run -d --rm --name "$name" \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=ingestion_test \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null

port="$(docker port "$name" 5432/tcp | head -n1 | sed 's/.*://')"

ready=0
for _ in $(seq 1 80); do
  if docker exec "$name" psql -U test -d ingestion_test -tAc 'select 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.5
done

if [ "$ready" -ne 1 ]; then
  echo "with-test-db.sh: the throwaway Postgres did not become ready" >&2
  exit 1
fi

# The official image restarts the server once after initialising.
sleep 1

export INTEGRATION_DATABASE_URL="postgresql://test:test@127.0.0.1:${port}/ingestion_test"

DATABASE_URL="$INTEGRATION_DATABASE_URL" npx prisma migrate deploy
"$@"
