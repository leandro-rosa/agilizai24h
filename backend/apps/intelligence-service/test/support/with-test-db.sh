#!/usr/bin/env bash
# Runs a command against a THROWAWAY Postgres: a container created here, migrated from scratch and
# removed on exit. It is never the operator's running database — test data must not share a database
# with real data.
#
# usage: with-test-db.sh <command...>     (DATABASE_URL is set for the command)
set -Eeuo pipefail

command -v docker >/dev/null 2>&1 || { echo "with-test-db.sh: docker is required" >&2; exit 1; }
[ "$#" -gt 0 ] || { echo "usage: with-test-db.sh <command...>" >&2; exit 2; }

name="agiliz-intelligence-test-postgres-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT INT TERM

# Port 0 on the host: Docker picks a free one, so nothing collides with the real Postgres (5446).
docker run -d --rm --name "$name" \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=intelligence_test \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null

port="$(docker port "$name" 5432/tcp | head -n1 | sed 's/.*://')"

for _ in $(seq 1 80); do
  docker exec "$name" psql -U test -d intelligence_test -tAc 'select 1' >/dev/null 2>&1 && break
  sleep 0.5
done
sleep 1 # the official image restarts the server once after initialising

export DATABASE_URL="postgresql://test:test@127.0.0.1:${port}/intelligence_test"
export WITH_KAFKA_BROKERS=false
npx prisma migrate deploy
"$@"
