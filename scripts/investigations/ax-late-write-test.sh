#!/usr/bin/env bash
# Test E: confirm AX is ready, THEN write flags, THEN re-verify.
# Answers: does writing the flags break AX even after warmup, or is the
# break specifically a race against accessibilityd's startup?

set -o pipefail

RUNTIME_ID="${RUNTIME_ID:-$(xcrun simctl list runtimes --json | jq -r '
  .runtimes[] | select(.name | test("iOS 26")) | .identifier' | head -n1)}"
DEVICE_TYPE="${DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17}"
LOG_DIR="${LOG_DIR:-/tmp/ax-late-write-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$LOG_DIR"

ax_ready() {
  axe describe-ui --udid "$1" 2>/dev/null | jq -e '
    (if type == "array" then .[0] else . end) as $r
    | (($r.children // []) | length > 0)
      or (($r.frame.size.width // 0) > 0)
      or (($r.frame.width // 0) > 0)
  ' >/dev/null 2>&1
}
read_flags() {
  local ax app
  ax=$(xcrun simctl spawn "$1" defaults read com.apple.Accessibility AccessibilityEnabled 2>/dev/null | tr -d '[:space:]')
  app=$(xcrun simctl spawn "$1" defaults read com.apple.Accessibility ApplicationAccessibilityEnabled 2>/dev/null | tr -d '[:space:]')
  echo "ax=${ax:-missing} app=${app:-missing}"
}

run_trial() {
  set +u
  local trial=$1 logf="$LOG_DIR/E-trial${trial}.log"
  local udid
  udid=$(xcrun simctl create "ax-late-$trial" "$DEVICE_TYPE" "$RUNTIME_ID")
  echo "Created $udid" | tee "$logf"
  xcrun simctl boot "$udid" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1
  echo "[boot] bootstatus returned" | tee -a "$logf"

  local start=$(date +%s) elapsed
  while true; do
    elapsed=$(( $(date +%s) - start ))
    if ax_ready "$udid"; then
      echo "[E/$trial] AX ready at T+${elapsed}s flags: $(read_flags "$udid")" | tee -a "$logf"
      break
    fi
    if (( elapsed > 30 )); then
      echo "[E/$trial] FAIL: AX not ready within 30s, aborting trial" | tee -a "$logf"
      xcrun simctl shutdown "$udid" >/dev/null 2>&1
      xcrun simctl delete "$udid" >/dev/null 2>&1
      return 1
    fi
    sleep 1
  done

  sleep 5
  echo "[E/$trial] T+$((elapsed+5))s pre-write check: $(ax_ready "$udid" && echo READY || echo EMPTY) flags: $(read_flags "$udid")" | tee -a "$logf"

  echo "[E/$trial] writing flags now..." | tee -a "$logf"
  xcrun simctl spawn "$udid" defaults write com.apple.Accessibility AccessibilityEnabled -bool true 2>/dev/null
  xcrun simctl spawn "$udid" defaults write com.apple.Accessibility ApplicationAccessibilityEnabled -bool true 2>/dev/null

  for delay in 1 3 5 10; do
    sleep $delay
    elapsed=$(( $(date +%s) - start ))
    local status
    status=$(ax_ready "$udid" && echo READY || echo EMPTY)
    echo "[E/$trial] T+${elapsed}s post-write+${delay}s: $status flags: $(read_flags "$udid")" | tee -a "$logf"
  done

  xcrun simctl shutdown "$udid" >/dev/null 2>&1
  xcrun simctl delete "$udid" >/dev/null 2>&1
}

run_trial 1
run_trial 2

echo
echo "Logs: $LOG_DIR"
