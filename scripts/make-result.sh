#!/usr/bin/env bash
# Воспроизводит порядок из TASK.md и сохраняет ответ daily-totals в result.json:
#   чистая БД → сервис → POST /sync → вебхуки → GET daily-totals.
# Использование: scripts/make-result.sh [порт сервиса, по умолчанию 3000]
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${1:-${PORT:-3000}}"
CUSTOMER="${CUSTOMER:-c_7}"
FROM="${FROM:-2026-03-27}"
TO="${TO:-2026-03-31}"
OUT="${OUT:-result.json}"
LOG="$(mktemp -t orders-aggregator.XXXXXX)"

echo "→ чистая БД и внешний API"
docker compose down -v --remove-orphans >/dev/null 2>&1 || true
docker compose up -d >/dev/null
until docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do sleep 0.5; done
until curl -sf "http://localhost:4000/customers/${CUSTOMER}" >/dev/null 2>&1; do sleep 0.5; done
sleep 1 # initdb перезапускает postgres после create-test-db.sql

echo "→ сервис на :${PORT} (лог: ${LOG})"
PORT="$PORT" npm run --silent start >"$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
until curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; do
  kill -0 $SERVER_PID 2>/dev/null || { cat "$LOG"; exit 1; }
  sleep 0.5
done

echo "→ POST /sync"
curl -sf -X POST "http://localhost:${PORT}/sync"; echo

echo "→ вебхуки"
docker compose run --rm orders-api webhooks --target "http://host.docker.internal:${PORT}/webhooks/order" 2>/dev/null

echo "→ daily-totals ${CUSTOMER} ${FROM}..${TO} → ${OUT}"
curl -sf "http://localhost:${PORT}/customers/${CUSTOMER}/daily-totals?from=${FROM}&to=${TO}" >"$OUT"
cat "$OUT"; echo
