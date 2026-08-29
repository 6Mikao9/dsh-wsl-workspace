#!/usr/bin/env bash
# Compatibility verification of dsh-wsl-workspace against specific
# @deepseek-ai/dsh releases (the DSH-Store fixed-Commit evidence).
#
# Everything runs isolated: DSH_HOME is redirected to a fresh temp tree and
# each instance gets its own port, so the live installation is never touched.
# For every version the script records:
#   1. install   — `dsh plugin --profile web add dsh-wsl-workspace` succeeds
#   2. start     — the web server boots with the plugin and the plugin's
#                  POST /wsl-workspace/api answers (route registered)
#   3. uninstall — `dsh plugin --profile web remove dsh-wsl-workspace`
#                  succeeds and the route disappears after a re-boot
# A version is "compatible" only when all three hold; the verdict lines are
# appended to <base>/verdicts.txt and every log is kept under <base>.
#
#   scripts/verify-dsh-compat.sh 0.1.0-rc.8 0.1.1-rc.1 0.1.1-rc.2
set -uo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <dsh-version> [more versions...]" >&2
  exit 2
fi

BASE="${TEMP:-/tmp}/dsh-compat-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BASE"
PORT="${COMPAT_PORT:-3091}"
PLUGIN_API="http://127.0.0.1:${PORT}/wsl-workspace/api"
WEB_URL="http://127.0.0.1:${PORT}/"

wait_http() { # wait_http <url> <expected-substring> <tries>
  local url="$1" expect="$2" tries="${3:-60}"
  for _ in $(seq 1 "$tries"); do
    local body
    body="$(curl -s --max-time 2 "$url" 2>/dev/null || true)"
    if [ -n "$body" ] && printf '%s' "$body" | grep -q "$expect"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

api_code() { # api_code <method> <params-json>
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST "$PLUGIN_API" \
    -H 'Content-Type: application/json' \
    -d "{\"method\":\"$1\",\"params\":$2}" 2>/dev/null || echo 000
}

for VERSION in "$@"; do
  echo "=============================================================="
  echo " verifying @deepseek-ai/dsh@$VERSION"
  echo "=============================================================="
  WORK="$BASE/$VERSION"
  mkdir -p "$WORK/pkg" "$WORK/dsh-home"
  DSH_HOME="$(cygpath -w "$WORK/dsh-home")"
  export DSH_HOME

  echo "[install] npm i @deepseek-ai/dsh@$VERSION"
  if ! (cd "$WORK/pkg" \
        && npm init -y >/dev/null 2>&1 \
        && npm i "@deepseek-ai/dsh@$VERSION" --no-audit --no-fund >/dev/null 2>&1); then
    echo "  ✖ harness installation failed"
    echo "$Version INSTALL_FAIL unknown" >> "$BASE/verdicts.txt"
    continue
  fi
  BIN="$WORK/pkg/node_modules/@deepseek-ai/dsh/lib/bin.js"

  echo "[install] dsh plugin --profile web add dsh-wsl-workspace"
  if ! node "$BIN" plugin --profile web add dsh-wsl-workspace > "$WORK/plugin-add.log" 2>&1; then
    echo "  ✖ plugin add failed (see $WORK/plugin-add.log)"
    echo "$VERSION PLUGIN_ADD_FAIL unknown" >> "$BASE/verdicts.txt"
    continue
  fi
  grep -q 'dsh-wsl-workspace' "$WORK/dsh-home/profiles/web/package.json" \
    && echo "  ✔ profile manifest carries the plugin"

  echo "[start] booting web on :$PORT"
  node "$BIN" web --port "$PORT" > "$WORK/boot-with-plugin.log" 2>&1 &
  SERVER_PID=$!
  if ! wait_http "$WEB_URL" '<!DOCTYPE html\|<!doctype html\|html' 60; then
    echo "  ✖ server did not serve the web UI"
    kill "$SERVER_PID" 2>/dev/null
    echo "$VERSION BOOT_FAIL unknown" >> "$BASE/verdicts.txt"
    continue
  fi
  echo "  ✔ web UI is up"
  CODE="$(api_code listDistros '{}')"
  if [ "$CODE" = "200" ]; then
    echo "  ✔ plugin route answers 200 (plugin loaded and registered)"
  else
    echo "  ✖ plugin route answered $CODE (expected 200)"
    kill "$SERVER_PID" 2>/dev/null
    echo "$VERSION ROUTE_FAIL unknown" >> "$BASE/verdicts.txt"
    continue
  fi
  grep -i 'dsh-wsl-workspace.*\(error\|fail\)' "$WORK/boot-with-plugin.log" \
    && echo "  ✖ plugin errors found in the boot log" \
    && { kill "$SERVER_PID" 2>/dev/null; echo "$VERSION LOG_ERRORS unknown" >> "$BASE/verdicts.txt"; continue; }
  echo "  ✔ no plugin errors in the boot log"
  kill "$SERVER_PID" 2>/dev/null
  wait "$SERVER_PID" 2>/dev/null
  sleep 2

  echo "[uninstall] dsh plugin --profile web remove dsh-wsl-workspace"
  if ! node "$BIN" plugin --profile web remove dsh-wsl-workspace > "$WORK/plugin-remove.log" 2>&1; then
    echo "  ✖ plugin remove failed (see $WORK/plugin-remove.log)"
    echo "$VERSION REMOVE_FAIL unknown" >> "$BASE/verdicts.txt"
    continue
  fi
  echo "  ✔ removed"
  node "$BIN" web --port "$PORT" > "$WORK/boot-without-plugin.log" 2>&1 &
  SERVER_PID=$!
  if ! wait_http "$WEB_URL" '<!DOCTYPE html\|<!doctype html\|html' 60; then
    echo "  ✖ server did not come back after removal"
    kill "$SERVER_PID" 2>/dev/null
    echo "$VERSION REBOOT_FAIL unknown" >> "$BASE/verdicts.txt"
    continue
  fi
  CODE="$(api_code listDistros '{}')"
  if [ "$CODE" != "200" ]; then
    echo "  ✔ plugin route gone after removal ($CODE) — clean uninstall"
    echo "$VERSION PASS compatible" >> "$BASE/verdicts.txt"
  else
    echo "  ✖ plugin route still present after removal"
    echo "$VERSION REMOVE_INCOMPLETE unknown" >> "$BASE/verdicts.txt"
  fi
  kill "$SERVER_PID" 2>/dev/null
  wait "$SERVER_PID" 2>/dev/null
done

echo "=============================================================="
echo " verdicts ($BASE/verdicts.txt):"
cat "$BASE/verdicts.txt"
