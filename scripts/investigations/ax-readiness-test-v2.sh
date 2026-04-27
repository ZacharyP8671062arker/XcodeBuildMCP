#!/usr/bin/env bash
# v2: tighter T+0 anchor + delayed-write characterization.
#
# T+0 = "simctl bootstatus -b returned AND com.apple.SpringBoard is in
# launchctl list AND a defaults read round-trip works".
#
# Tests:
#   A           — natural readiness (no write)
#   B@<delay>   — write flags <delay>s after T+0, then poll for AX
#   C           — passive defaults observation, no AX queries, no writes
#
# Default config picks scenarios that decide the falsifying questions
# (B@0 confirms the regression, B@15 confirms it's a race not a permanent
# break, C confirms subsystem self-writes the flags).

set -uo pipefail

RUNTIME_ID="${RUNTIME_ID:-$(xcrun simctl list runtimes --json | jq -r '
  .runtimes[]
  | select(.name | test("iOS 26"))
  | .identifier' | head -n1)}"
DEVICE_TYPE="${DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17}"
MAX_WAIT_S="${MAX_WAIT_S:-90}"
POLL_INTERVAL_S="${POLL_INTERVAL_S:-1}"
PASSIVE_DURATION_S="${PASSIVE_DURATION_S:-45}"
PASSIVE_INTERVAL_S="${PASSIVE_INTERVAL_S:-2}"
LOG_DIR="${LOG_DIR:-/tmp/ax-readiness-v2-$(date +%Y%m%d-%H%M%S)}"

mkdir -p "$LOG_DIR"
SUMMARY="$LOG_DIR/SUMMARY.txt"
: > "$SUMMARY"

log() { echo "$@" | tee -a "$SUMMARY"; }

log "Logs:        $LOG_DIR"
log "Runtime:     $RUNTIME_ID"
log "Device:      $DEVICE_TYPE"
log "MAX_WAIT_S:  $MAX_WAIT_S"
log

if [[ -z "$RUNTIME_ID" || "$RUNTIME_ID" == "null" ]]; then
  echo "ERROR: no iOS 26 runtime found." >&2; exit 1
fi
command -v axe >/dev/null || { echo "ERROR: axe not on PATH" >&2; exit 1; }
command -v jq  >/dev/null || { echo "ERROR: jq not on PATH"  >&2; exit 1; }

# ---- Helpers --------------------------------------------------------------

ax_ready() {
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
  local udid=$1 ax app
  ax=$(xcrun simctl spawn "$udid" defaults read com.apple.Accessibility AccessibilityEnabled 2>/dev/null | tr -d '[:space:]')
  app=$(xcrun simctl spawn "$udid" defaults read com.apple.Accessibility ApplicationAccessibilityEnabled 2>/dev/null | tr -d '[:space:]')
  echo "ax=${ax:-missing} app=${app:-missing}"
}

write_flags() {
  local udid=$1
  xcrun simctl spawn "$udid" defaults write com.apple.Accessibility AccessibilityEnabled -bool true 2>/dev/null
  xcrun simctl spawn "$udid" defaults write com.apple.Accessibility ApplicationAccessibilityEnabled -bool true 2>/dev/null
}

springboard_up() {
  local udid=$1
  xcrun simctl spawn "$udid" launchctl list 2>/dev/null | grep -q 'com.apple.SpringBoard' || return 1
  # Round-trip a defaults read to confirm cfprefsd is responsive.
  xcrun simctl spawn "$udid" defaults read .GlobalPreferences AppleLanguages >/dev/null 2>&1 || return 1
  return 0
}

create_fresh_sim() {
  local name=$1
  xcrun simctl create "$name" "$DEVICE_TYPE" "$RUNTIME_ID"
}

boot_and_anchor() {
  # Boots the sim, waits for bootstatus, then waits for SpringBoard + cfprefsd.
  # Returns when both are confirmed up. Echoes seconds spent past bootstatus on stderr.
  local udid=$1 logf=$2
  xcrun simctl boot "$udid" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1
  echo "[boot] bootstatus returned" >> "$logf"
  local extra_start=$(date +%s)
  local waited=0
  until springboard_up "$udid"; do
    if (( waited > 60 )); then
      echo "[boot] WARNING: springboard never came up within 60s after bootstatus" >> "$logf"
      break
    fi
    sleep 1; waited=$(( $(date +%s) - extra_start ))
  done
  echo "[boot] SpringBoard up after extra ${waited}s" >> "$logf"
}

shutdown_delete() {
  local udid=$1
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  xcrun simctl delete "$udid"  >/dev/null 2>&1 || true
}

# Run a measure: write_at = "no" | "T+Ns" (e.g. "T+5s")
# Returns: integer T_ready or "never"
measure_ready() {
  local udid=$1 label=$2 trial=$3 write_at=$4
  local logf="$LOG_DIR/${label}-trial${trial}.log"
  local start=$(date +%s)
  local now elapsed write_delay=-1
  local wrote=0

  if [[ "$write_at" =~ ^T\+([0-9]+)s$ ]]; then
    write_delay="${BASH_REMATCH[1]}"
  fi

  echo "[$label/$trial] T+0 flags: $(read_flags "$udid")" | tee -a "$logf" >/dev/null

  while true; do
    now=$(date +%s); elapsed=$(( now - start ))

    if (( wrote == 0 )) && (( write_delay >= 0 )) && (( elapsed >= write_delay )); then
      write_flags "$udid"
      wrote=1
      echo "[$label/$trial] T+${elapsed}s WROTE flags" | tee -a "$logf" >/dev/null
    fi

    if ax_ready "$udid"; then
      echo "[$label/$trial] READY at T+${elapsed}s flags: $(read_flags "$udid")" | tee -a "$logf" >/dev/null
      echo "$elapsed" > "$LOG_DIR/${label}-trial${trial}.result"
      return 0
    fi
    if (( elapsed > MAX_WAIT_S )); then
      echo "[$label/$trial] NEVER READY within ${MAX_WAIT_S}s flags: $(read_flags "$udid")" | tee -a "$logf" >/dev/null
      echo "never" > "$LOG_DIR/${label}-trial${trial}.result"
      return 1
    fi
    if (( elapsed % 5 == 0 )); then
      echo "[$label/$trial] T+${elapsed}s flags: $(read_flags "$udid")" | tee -a "$logf" >/dev/null
    fi
    sleep "$POLL_INTERVAL_S"
  done
}

# Test C: never query AX, never write. Just sample defaults.
measure_passive() {
  local udid=$1 trial=$2
  local logf="$LOG_DIR/C-passive-trial${trial}.log"
  local start=$(date +%s)
  local elapsed
  while true; do
    elapsed=$(( $(date +%s) - start ))
    echo "[C/$trial] T+${elapsed}s flags: $(read_flags "$udid")" | tee -a "$logf" >/dev/null
    if (( elapsed >= PASSIVE_DURATION_S )); then break; fi
    sleep "$PASSIVE_INTERVAL_S"
  done
  if ax_ready "$udid"; then
    echo "[C/$trial] AX ready at T+${elapsed}s (post-passive)" | tee -a "$logf" >/dev/null
    echo "ready" > "$LOG_DIR/C-trial${trial}.result"
  else
    echo "[C/$trial] AX still empty at T+${elapsed}s" | tee -a "$logf" >/dev/null
    echo "empty" > "$LOG_DIR/C-trial${trial}.result"
  fi
}

# ---- Scenarios ------------------------------------------------------------

run_scenario_ready() {
  local label=$1 write_at=$2 trial=$3 sim_name=$4
  log
  log "=== $label trial $trial — write_at=$write_at ==="
  local udid
  udid=$(create_fresh_sim "$sim_name")
  echo "Created $udid" | tee -a "$SUMMARY"
  boot_and_anchor "$udid" "$LOG_DIR/${label}-trial${trial}.log"
  measure_ready "$udid" "$label" "$trial" "$write_at"
  shutdown_delete "$udid"
}

run_scenario_passive() {
  local trial=$1 sim_name=$2
  log
  log "=== C passive trial $trial ==="
  local udid
  udid=$(create_fresh_sim "$sim_name")
  echo "Created $udid" | tee -a "$SUMMARY"
  boot_and_anchor "$udid" "$LOG_DIR/C-trial${trial}.log"
  measure_passive "$udid" "$trial"
  shutdown_delete "$udid"
}

# ---- Run ------------------------------------------------------------------

# Baseline: 2 trials of natural readiness
run_scenario_ready "A"     "no"    1 "ax-v2-A1"
run_scenario_ready "A"     "no"    2 "ax-v2-A2"

# B@0: regression confirmation (2 trials)
run_scenario_ready "B0"    "T+0s"  1 "ax-v2-B0-1"
run_scenario_ready "B0"    "T+0s"  2 "ax-v2-B0-2"

# B@15: write well after AX is ready — does write still break AX?
run_scenario_ready "B15"   "T+15s" 1 "ax-v2-B15-1"
run_scenario_ready "B15"   "T+15s" 2 "ax-v2-B15-2"

# C: passive observation
run_scenario_passive 1 "ax-v2-C1"

# ---- Summary --------------------------------------------------------------

log
log "===== RESULTS ====="
for label in A B0 B15; do
  for trial in 1 2; do
    f="$LOG_DIR/${label}-trial${trial}.result"
    if [[ -f "$f" ]]; then
      log "$label trial $trial: $(cat "$f")"
    fi
  done
done
for trial in 1; do
  f="$LOG_DIR/C-trial${trial}.result"
  if [[ -f "$f" ]]; then
    log "C  trial $trial: $(cat "$f") (passive observation)"
  fi
done
log
log "Decision rules:"
log "  A always finishes quickly      → AX warmup is short and writes-free."
log "  B0 always 'never'              → write@T+0 breaks AX (race against accessibilityd)."
log "  B15 always finishes ~ A        → write@T+15s harmless (post-init), confirms race."
log "  C ends with flags=1 (no write) → subsystem self-writes the flags."
