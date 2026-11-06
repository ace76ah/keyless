#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
export HOME="$TMP/home"
export KEYLESS_PASSPHRASE="e2e-test-passphrase-not-for-production"
export KEYLESS_SECRET="sk-e2e-vault-only-secret"
export KEYLESS_AUTO_CONFIRM="yes"
mkdir -p "$HOME/.keyless"

DAEMON_PID=""
PROXY_PID=""
cleanup() {
  [[ -f "$HOME/.keyless/proxy.pid" ]] && kill "$(cat "$HOME/.keyless/proxy.pid")" 2>/dev/null || true
  [[ -f "$HOME/.keyless/daemon.pid" ]] && kill "$(cat "$HOME/.keyless/daemon.pid")" 2>/dev/null || true
  [[ -n "$PROXY_PID" ]] && kill "$PROXY_PID" 2>/dev/null || true
  [[ -n "$DAEMON_PID" ]] && kill "$DAEMON_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

cd "$ROOT"
KEYLESS="$ROOT/bin/keyless.mjs"
SOCKET="$HOME/.keyless/daemon.sock"
VAULT="$HOME/.keyless/vault.json"
AUDIT="$HOME/.keyless/audit.log"
PORT="${KEYLESS_E2E_PORT:-18787}"

echo "[1/8] Initialize vault"
node --experimental-strip-types "$KEYLESS" init --vault "$VAULT"

echo "[2/8] Add OpenAI credential"
node --experimental-strip-types "$KEYLESS" add openai --provider openai --vault "$VAULT"

echo "[3/8] Start daemon (grant command uses daemon IPC)"
node --experimental-strip-types "$KEYLESS" daemon start --vault "$VAULT" --socket "$SOCKET" --audit "$AUDIT"
DAEMON_PID="$(cat "$HOME/.keyless/daemon.pid")"

echo "[4/8] Create approved project grant"
GRANT_OUTPUT="$(node --experimental-strip-types "$KEYLESS" grant openai --provider openai --methods POST --paths /v1/chat/completions --socket "$SOCKET")"
printf '%s\n' "$GRANT_OUTPUT" | sed -E 's/(PROJECT_TOKEN=).*/\1[redacted]/'
TOKEN="$(printf '%s\n' "$GRANT_OUTPUT" | sed -n 's/^PROJECT_TOKEN=//p')"
[[ -n "$TOKEN" ]] || { echo "grant did not return a token" >&2; exit 1; }

echo "[5/8] Start proxy with deterministic mocked upstream"
node --experimental-strip-types "$KEYLESS" proxy start --socket "$SOCKET" --port "$PORT" --mock-upstream
for _ in $(seq 1 20); do [[ -f "$HOME/.keyless/proxy.pid" ]] && break; sleep 0.05; done
PROXY_PID="$(cat "$HOME/.keyless/proxy.pid")"
for _ in $(seq 1 50); do
  if curl -sS -o /dev/null "http://127.0.0.1:$PORT/c/unknown/health" 2>/dev/null; then break; fi
  sleep 0.1
done

echo "[6/8] Valid token reaches mocked upstream"
GOOD="$(curl -sS -o "$TMP/good.json" -w '%{http_code}' \
  -X POST "http://127.0.0.1:$PORT/c/openai/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"model":"test"}')"
[[ "$GOOD" == "200" ]] || { cat "$TMP/good.json"; echo "expected 200, got $GOOD"; exit 1; }
grep -q '"credentialInjected":true' "$TMP/good.json"

echo "[7/8] Invalid token is rejected"
BAD="$(curl -sS -o "$TMP/bad.json" -w '%{http_code}' \
  -X POST "http://127.0.0.1:$PORT/c/openai/v1/chat/completions" \
  -H 'Authorization: Bearer klp_v1_invalid-token-material-long-enough' \
  -H 'Content-Type: application/json' -d '{"model":"test"}')"
[[ "$BAD" == "401" ]] || { cat "$TMP/bad.json"; echo "expected 401, got $BAD"; exit 1; }

echo "[8/8] Verify audit trail"
node --experimental-strip-types "$KEYLESS" log --file "$AUDIT" > "$TMP/log.txt"
grep -q 'verified (2 events)' "$TMP/log.txt"
cat "$TMP/log.txt"

echo "E2E PASSED"
