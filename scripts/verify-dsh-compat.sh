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
# What `plugin add` installs: by default the registry package name (maintainer
# release flow). CI points PLUGIN_REF at a locally built tarball so an
# unpublished commit is never tested against an older published artifact.
PLUGIN_NAME="dsh-wsl-workspace"
PLUGIN_REF="${PLUGIN_REF:-$PLUGIN_NAME}"

wait_ready() { # wait_ready <boot-log> [tries] — the web server answers HTTP at all.
  # Readiness is liveness, not auth: 0.2.0-rc gates `/` behind a browser
  # token handshake (401 anonymous, 303 → ./ with the query dropped), so an
  # HTML-content probe can never settle. The plugin's own health is asserted
  # separately by api_code below; here any HTTP response counts.
  local tries="${2:-60}" code
  for _ in $(seq 1 "$tries"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 2 "$WEB_URL" 2>/dev/null)"
    code="${code:-000}"
    if [ "$code" != "000" ]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

api_code() { # api_code <method> <params-json>
  # curl already prints 000 for a failed connect with -w; only default the
  # never-printed case (curl died before writing) — otherwise the caller
  # reads "000000".
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 5 -X POST "$PLUGIN_API" \
    -H 'Content-Type: application/json' \
    -d "{\"method\":\"$1\",\"params\":$2}" 2>/dev/null)"
  printf '%s' "${code:-000}"
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

  echo "[install] dsh plugin --profile web add $PLUGIN_REF"
  if ! node "$BIN" plugin --profile web add "$PLUGIN_REF" > "$WORK/plugin-add.log" 2>&1; then
    echo "  ✖ plugin add failed (see $WORK/plugin-add.log)"
    echo "$VERSION PLUGIN_ADD_FAIL unknown" >> "$BASE/verdicts.txt"
    continue
  fi
  grep -q 'dsh-wsl-workspace' "$WORK/dsh-home/profiles/web/package.json" \
    && echo "  ✔ profile manifest carries the plugin"

  echo "[start] booting web on :$PORT"
  node "$BIN" web --port "$PORT" --no-open > "$WORK/boot-with-plugin.log" 2>&1 &
  SERVER_PID=$!
  if ! wait_ready "$WORK/boot-with-plugin.log" 60; then
    echo "  ✖ server did not serve the web UI"
    kill "$SERVER_PID" 2>/dev/null
    echo "$VERSION BOOT_FAIL unknown" >> "$BASE/verdicts.txt"
    continue
  fi
  echo "  ✔ web UI is up"
  # the plugin route registers while the server is still coming up — poll
  # for its 200 instead of taking one shot that races plugin loading
  CODE=000
  for _ in $(seq 1 20); do
    CODE="$(api_code listDistros '{}')"
    [ "$CODE" = "200" ] && break
    sleep 2
  done
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
  node "$BIN" web --port "$PORT" --no-open > "$WORK/boot-without-plugin.log" 2>&1 &
  SERVER_PID=$!
  if ! wait_ready "$WORK/boot-without-plugin.log" 60; then
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

# The verdicts are the contract: only `PASS compatible` is green. Without
# this exit the caller always saw rc 0 — the frame-1 compat matrix was
# three PLUGIN_ADD_FAIL lines under a green checkmark.
if [ ! -s "$BASE/verdicts.txt" ]; then
  echo "verify-dsh-compat: RED — verdicts.txt is empty (no version reached a verdict)" >&2
  exit 1
fi
if grep -qv ' PASS compatible$' "$BASE/verdicts.txt"; then
  echo "verify-dsh-compat: RED — at least one verdict is not 'PASS compatible'" >&2
  exit 1
fi
echo "verify-dsh-compat: OK — $(wc -l < "$BASE/verdicts.txt") verdict(s), all PASS compatible"
