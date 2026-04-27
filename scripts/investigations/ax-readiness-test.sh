#!/usr/bin/env bash
# Falsification test for PR #312's flag-causation hypothesis vs.
# the AX-subsystem-warm-up timing hypothesis.
#
# Creates a throwaway iOS 26 simulator, runs four scenarios, and prints
# a results table. Total runtime ~10 minutes for the default 3-trial run.
#
# Requirements: axe (cameroncooke/axe), jq, an iOS 26+ runtime.

set -uo pipefail

# ---- Configuration --------------------------------------------------------

RUNTIME_ID="${RUNTIME_ID:-$(xcrun simctl list runtimes --json | jq -r '
  .runtimes[]
  | select(.name | test("iOS 26"))
  | .identifier' | head -n1)}"
DEVICE_TYPE="${DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17}"
TRIALS="${TRIALS:-3}"
MAX_WAIT_S="${MAX_WAIT_S:-120}"
POLL_INTERVAL_S="${POLL_INTERVAL_S:-1}"
LOG_DIR="${LOG_DIR:-/tmp/ax-readiness-$(date +%Y%m%d-%H%M%S)}"

mkdir -p "$LOG_DIR"
echo "Logs: $LOG_DIR"
echo "Runtime: $RUNTIME_ID"
echo "Device type: $DEVICE_TYPE"
echo

if [[ -z "$RUNTIME_ID" || "$RUNTIME_ID" == "null" ]]; then
  echo "ERROR: no iOS 26 runtime found. Set RUNTIME_ID explicitly." >&2
  exit 1
fi
command -v axe >/dev/null || { echo "ERROR: axe not on PATH" >&2; exit 1; }
command -v jq  >/dev/null || { echo "ERROR: jq not on PATH"  >&2; exit 1; }

# ---- Helpers --------------------------------------------------------------

ax_ready() {
  # Returns 0 if axe describe-ui returns a hierarchy with non-empty children OR non-zero frame.
  local udid=$1
  local out
  out=$(axe describe-ui --udid "$udid" 2>/dev/null) || return 1
  echo "$out" | jq -e '
    (if type == "array" then .[0] else . end) as $r
    | (($r.children // []) | length > 0)
      or (($r.frame.size.width // 0) > 0)
      or (($r.frame.width // 0) > 0)
  ' >/dev/null 2>&1
}

read_flags() {
  # Prints "ax=<0|1|missing> app=<0|1|missing>"
  local udid=$1
  local ax app
  ax=$(xcrun simctl spawn "$udid" defaults read com.apple.Accessibility AccessibilityEnabled 2>/dev/null | tr -d '[:space:]') || ax=missing
  app=$(xcrun simctl spawn "$udid" defaults read com.apple.Accessibility ApplicationAccessibilityEnabled 2>/dev/null | tr -d '[:space:]') || app=missing
  echo "ax=${ax:-missing} app=${app:-missing}"
}

write_flags() {
  local udid=$1
  xcrun simctl spawn "$udid" defaults write com.apple.Accessibility AccessibilityEnabled -bool true 2>/dev/null
  xcrun simctl spawn "$udid" defaults write com.apple.Accessibility ApplicationAccessibilityEnabled -bool true 2>/dev/null
}

create_fresh_sim() {
  local name=$1
  local udid
  udid=$(xcrun simctl create "$name" "$DEVICE_TYPE" "$RUNTIME_ID")
  echo "$udid"
}

boot_and_wait() {
  local udid=$1
  xcrun simctl boot "$udid" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1
}

shutdown_delete() {
  local udid=$1
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  xcrun simctl delete "$udid"  >/dev/null 2>&1 || true
}

# Poll AX readiness; print T_ready in seconds (or "never").
# Records flag snapshots at T+0 and T_ready.
measure_ready() {
  local udid=$1 label=$2 trial=$3 write_at_t0=$4
  local logf="$LOG_DIR/${label}-trial${trial}.log"
  local start now elapsed flags_t0 flags_ready
  start=$(date +%s)

  flags_t0=$(read_flags "$udid")
  echo "[$label/$trial] T+0 flags: $flags_t0" | tee -a "$logf"

  if [[ "$write_at_t0" == "yes" ]]; then
    write_flags "$udid"
    echo "[$label/$trial] T+0 wrote flags" | tee -a "$logf"
  fi

  while true; do
    now=$(date +%s); elapsed=$(( now - start ))
    if ax_ready "$udid"; then
      flags_ready=$(read_flags "$udid")
      echo "[$label/$trial] READY at T+${elapsed}s flags: $flags_ready" | tee -a "$logf"
      echo "$elapsed"
      return 0
    fi
    if (( elapsed > MAX_WAIT_S )); then
      flags_ready=$(read_flags "$udid")
      echo "[$label/$trial] NEVER READY within ${MAX_WAIT_S}s flags: $flags_ready" | tee -a "$logf"
      echo "never"
      return 1
    fi
    if (( elapsed % 5 == 0 )); then
      echo "[$label/$trial] T+${elapsed}s flags: $(read_flags "$udid")" | tee -a "$logf"
    fi
    sleep "$POLL_INTERVAL_S"
  done
}

# Test C: passive observation; record defaults every 5s for MAX_WAIT_S, never query AX, never write.
measure_passive() {
  local udid=$1 trial=$2
  local logf="$LOG_DIR/C-passive-trial${trial}.log"
  local start=$(date +%s)
  local elapsed
  while true; do
    elapsed=$(( $(date +%s) - start ))
    echo "[C/$trial] T+${elapsed}s flags: $(read_flags "$udid")" | tee -a "$logf"
    if (( elapsed >= MAX_WAIT_S )); then break; fi
    sleep 5
  done
  # Now poll AX to see if it's ready at T+MAX_WAIT_S
  if ax_ready "$udid"; then
    echo "[C/$trial] AX ready at T+${MAX_WAIT_S}s (post-passive observation)" | tee -a "$logf"
  else
    echo "[C/$trial] AX still empty at T+${MAX_WAIT_S}s" | tee -a "$logf"
  fi
}

# ---- Tests ----------------------------------------------------------------

declare -a A_RESULTS B_RESULTS

run_test_A() {
  echo "=== Test A: natural readiness, no flag write ($TRIALS trials) ==="
  for i in $(seq 1 "$TRIALS"); do
    local udid
    udid=$(create_fresh_sim "ax-test-A-$i")
    echo "Created $udid"
    boot_and_wait "$udid"
    local t
    t=$(measure_ready "$udid" "A" "$i" "no")
    A_RESULTS+=("$t")
    shutdown_delete "$udid"
  done
}

run_test_B() {
  echo "=== Test B: immediate flag write at T+0 ($TRIALS trials) ==="
  for i in $(seq 1 "$TRIALS"); do
    local udid
    udid=$(create_fresh_sim "ax-test-B-$i")
    echo "Created $udid"
    boot_and_wait "$udid"
    local t
    t=$(measure_ready "$udid" "B" "$i" "yes")
    B_RESULTS+=("$t")
    shutdown_delete "$udid"
  done
}

run_test_C() {
  echo "=== Test C: passive defaults observation (1 trial) ==="
  local udid
  udid=$(create_fresh_sim "ax-test-C")
  echo "Created $udid"
  boot_and_wait "$udid"
  measure_passive "$udid" "1"
  shutdown_delete "$udid"
}

run_test_D() {
  echo "=== Test D: warm-sim control (1 trial) ==="
  local udid
  udid=$(create_fresh_sim "ax-test-D")
  echo "Created $udid"
  boot_and_wait "$udid"
  echo "Warming sim by waiting ${MAX_WAIT_S}s..."
  sleep "$MAX_WAIT_S"
  echo "Warm. Now measuring AX response time."
  local start now
  start=$(date +%s)
  if ax_ready "$udid"; then
    now=$(date +%s)
    echo "[D/1] Warm sim AX response: $((now - start))s (expected ~0s)" | tee "$LOG_DIR/D-warm.log"
  else
    echo "[D/1] WARM SIM STILL NOT READY — investigate" | tee "$LOG_DIR/D-warm.log"
  fi
  shutdown_delete "$udid"
}

# ---- Main -----------------------------------------------------------------

run_test_A
run_test_B
run_test_C
run_test_D

# ---- Results --------------------------------------------------------------

echo
echo "=== Results ==="
echo "A (no write): ${A_RESULTS[*]}"
echo "B (write@T0): ${B_RESULTS[*]}"
echo "Logs: $LOG_DIR"
echo
echo "Decision rules:"
echo "  - If B ≈ A (within 5s): timing hypothesis wins, PR #312 helper is doing nothing."
echo "  - If B << A (e.g. B<2s, A>20s): flag hypothesis wins, PR #312 is correct."
echo "  - If A never finishes but B does: flag hypothesis wins definitively."
echo "  - Test C: scan logs for AccessibilityEnabled going 0→1 without any write."
