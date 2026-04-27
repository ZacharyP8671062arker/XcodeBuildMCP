# Investigation: Is PR #312's accessibility-flag write the actual fix, or coincidence with AX daemon initialization?

## Summary
PR #312's flag-causation premise is not just unsupported — it is actively wrong. Empirical testing (2026-04-27) on three fresh iOS 26.4 simulators shows that **writing `AccessibilityEnabled` / `ApplicationAccessibilityEnabled` during `accessibilityd`'s ~5–8 s post-boot startup window permanently breaks AX queries for the rest of that boot.** Without the write, AX becomes ready in ~5–8 s naturally. The original observation that "`defaults read` shows `1`/`1` whenever AX works" was a side-effect of AX queries themselves writing the flags, not a cause. PR #312, in its original boot-time placement and in the working-tree per-tool placement on this branch, sits exactly inside the race window for typical agent flows. Recommendation: delete `src/utils/simulator-accessibility.ts`, remove all callers, and (if the bug ever recurs) implement a polling readiness probe instead.

## Symptoms
- On fresh iOS 26 / Xcode 26.x simulators, `axe describe-ui` (and FBSimulatorControl-driven AX queries) return only an `AXApplication` node with `children: []` and `frame {{0, 0}, {0, 0}}`.
- `xcrun simctl spawn <udid> defaults read com.apple.Accessibility` shows `AccessibilityEnabled = 0; ApplicationAccessibilityEnabled = 0` on these fresh sims.
- After `defaults write` flips both flags to `1`, `describe-ui` returns the full hierarchy.
- Issue author observed the correlation `flags=1 ⇔ describe-ui works` and attributed causation to the flags.

## Hypothesis (the one to test)
1. The defaults flags are **not** the gating mechanism. The empty hierarchy is produced because the simulator's accessibility subsystem (AX daemon and SpringBoard's accessibility translation layer) needs ~25–30 s of post-boot initialization before it can answer translation requests.
2. During that init window, any AX query fails (FBSimulatorControl logs `"No translation object returned for simulator"`).
3. After init completes, queries succeed; as a side effect, the subsystem itself writes the two defaults to `1`.
4. Therefore PR #312's `defaults write` neither shortens the window nor causes the fix; it merely runs during a wall-clock period that normal workflows (build → install → launch → first AX query) would have spent waiting anyway.
5. The honest fix is a readiness probe: poll a minimal AX query until it succeeds, with timeout. Writing the flags is at best a no-op once the subsystem is up.

## Background / Prior Research

**FBSimulatorControl AX architecture (from `facebook/idb`).** XcodeBuildMCP's `snapshot_ui` shells out to `axe describe-ui`, and AXe is authored by this repo's maintainer ([cameroncooke/AXe](https://github.com/cameroncooke/AXe)). AXe's `AccessibilityFetcher` calls `target.accessibilityElement(at:nestedFormat:)` / `accessibilityElements(withNestedFormat:)` ([Sources/AXe/Utilities/AccessibilityFetcher.swift](https://github.com/cameroncooke/AXe/blob/main/Sources/AXe/Utilities/AccessibilityFetcher.swift)), which lands in FBSimulatorControl's `FBSimulatorAccessibilityCommands.m`. That implementation has direct bearing on this investigation:

- The "No translation object returned for simulator" string the original-PR hypothesis names is the **point-only** error path (`FBSimulatorAccessibilityCommands.m:967-971`), hit when `[request performWithTranslator:]` returns `nil`. The error message itself attributes this to "a point onscreen that is invalid or invisible due to a fullscreen dialog" — not to the AX daemon being un-initialized. The hierarchical (`accessibilityElements:`) path doesn't surface that string at all on the empty case; instead it returns an `AXApplication` with `accessibilityFrame == CGRectZero` and no children, which is exactly the symptom in #290.
- FBSimulatorControl already has a remediation for the `CGRectZero` condition (`FBSimulatorAccessibilityCommands.m:1393-1456`): if frame is zero **and** the translation object's pid does not resolve to a live service via `serviceNameForProcessIdentifier:`, it restarts `CoreSimulatorBridge` and retries once with a fresh token. The retry is bounded (`remediationPermitted: NO`). This means a *stale-SpringBoard* zero-frame condition is auto-remediated by the upstream framework. A *not-yet-initialized* zero-frame condition is **not** what this remediation checks for.
- The framework comment at `FBSimulatorAccessibilityCommands.m:140-170` describes the path: AXPTranslator → CoreSimulator → XPC service running inside the simulator (CoreSimulatorBridge → AccessibilityPlatformTranslation). The XPC service is launched by SpringBoard/`launchd_sim` post-boot; the "translator becomes useful" event is gated on that XPC service being up.

**Established workaround in the AXe ecosystem.** The "axe" agent skill ([agent-skills.md/skills/.../axe](https://agent-skills.md/skills/aliceisjustplaying/claude-resources-monorepo/axe)) treats empty `describe-ui` as a corrupted-state symptom and recommends `xcrun simctl shutdown && xcrun simctl boot` — i.e., it does **not** suggest writing `com.apple.Accessibility` defaults. AXe itself ([cameroncooke/AXe Sources/AXe/Utilities/GlobalSetup.swift](https://github.com/cameroncooke/AXe/blob/main/Sources/AXe/Utilities/GlobalSetup.swift), `AccessibilityFetcher.swift`) does not check or set `AccessibilityEnabled` / `ApplicationAccessibilityEnabled` anywhere. If those flags were the actual gate, AXe would not work on any non-pre-configured simulator.

**Public evidence on iOS 26 timing.** Web searches turn up no public, technical confirmation of a specific "25–30 s AX-daemon init window" on iOS 26. The known iOS 26 issue documented in the AXe agent-skill is a different one ("axe taps don't reliably trigger SwiftUI Toggle actions on iOS 26+"). Neither Apple developer forums nor Facebook's idb issues surface a "AccessibilityEnabled defaults to 0" thread for iOS 26 fresh sims. The original issue (#290) and PR (#312) are the only sources making the claim that flag-flipping is the fix; both come from one reporter (Derek Pearson).

**Direction of evidence.** The PR's premise is a correlation: "I observed flags=1 ⇔ describe-ui works after I ran `defaults write`". Neither the PR description nor the Cursor Bugbot threads contain a controlled measurement isolating the two variables (flags vs. wall-clock time). Two facts make the timing-window theory plausibly the real cause:

1. AXe goes through FBSimulatorControl's CoreSimulator XPC translator and never touches `com.apple.Accessibility` defaults. A flag-gated subsystem would mean AXe is fundamentally broken on every fresh simulator regardless of when you call it; in practice, AXe works on fresh sims once enough wall-clock time passes post-boot.
2. The XPC translator's "ready" condition is "the in-simulator XPC service is up and the translation object resolves to a live SpringBoard pid". Both of those are time-dependent post-boot; neither references `defaults`.

This makes the timing-window theory at least as well supported by the evidence as the flags theory, while having a stronger architectural mechanism. The flag-write *succeeding* is consistent with both theories (the subsystem was up and willing to receive defaults writes ⇒ the AX query that follows succeeds).

## Investigator Findings

### What the PR's helper actually does

Original PR `638147c8` (`src/utils/simulator-accessibility.ts`, 82 lines): two unconditional `xcrun simctl spawn <UDID> defaults write com.apple.Accessibility <flag> -bool true` calls in sequence, each in its own try/catch, fire-and-forget. Called once per `boot_sim`/`build_run_sim` invocation, immediately after boot succeeds.

Working-tree version on this branch (`src/utils/simulator-accessibility.ts:1-118`):

1. Reads both flags first via `defaults read` (`readAccessibilityFlag`, lines 11-38). If both reads return `'1'`, the function short-circuits with no writes (`ensureSimulatorAccessibility` lines 95-100).
2. If either read returns missing, `0`, or any other value, both flags are written via `writeAccessibilityFlag` (lines 40-70).
3. After writes, sleeps `ACCESSIBILITY_SETTLE_MS = 1500` ms (lines 9, 108-113).
4. Now called from every `axe`-backed UI-automation tool's `*Logic` function as the very first await: `snapshot_ui.ts:121`, `tap.ts:200`, `button.ts:92`, `gesture.ts:157`, `key_press.ts:95`, `key_sequence.ts:98`, `long_press.ts:116`, `swipe.ts:146`, `touch.ts:125`, `type_text.ts:96`. Removed from `boot_sim.ts` and `build_run_sim.ts` (`git diff HEAD` shows the deletions).

`screenshot.ts` is excluded — it calls `xcrun simctl io <UDID> screenshot`, which doesn't go through `axe`/AX.

### What the PR's helper does NOT do

Neither the original PR nor the working-tree version:

- Probes any AX endpoint to confirm readiness.
- Polls `axe describe-ui` (or any equivalent AX query) to detect the empty-hierarchy condition.
- Measures or surfaces wall-clock time since boot.
- Writes any value other than the two `com.apple.Accessibility` defaults.

The 1500 ms `ACCESSIBILITY_SETTLE_MS` is uncommented and undocumented; it is not derived from a measurement in the PR or the working-tree changes, and it is not the period claimed by the daemon-readiness hypothesis (~25–30 s).

### Causation evidence in PR #312 and issue #290 — what I could find

Issue #290 body (Derek Pearson, the only sustained voice in either thread):

> "With these flags off, the accessibility daemon doesn't expose any element tree. FBSimulatorControl's XPC queries return the empty Application node."
> "After this, `describe-ui` immediately returns the full hierarchy."

PR #312 commit body (`638147c8`, Derek Pearson):

> "On iOS 26+ fresh simulators, AccessibilityEnabled and ApplicationAccessibilityEnabled default to 0, which prevents accessibility hierarchy queries from returning any elements."

Comments on issue #290: only the staleness bot. No follow-up data.

Comments on PR #312: Cursor Bugbot only — every Bugbot finding addresses code-correctness (early returns, partial-write recoverability, misleading test titles, `nextStepParams` consistency). Not one comment questions or validates the causal claim that the flags are the gating mechanism.

There is no controlled-experiment data anywhere in either thread:
- No "boot, immediately read AX without writing flags, observe time-to-success" measurement.
- No "boot, set flags but measure AX latency" measurement.
- No "boot, repeatedly read defaults, observe whether the system self-writes them" measurement.

The PR ships as cause-and-effect inferred from the workaround.

### Mechanistic counter-evidence: AXe and FBSimulatorControl never read these flags

The AXe binary that XcodeBuildMCP shells out to ([cameroncooke/AXe](https://github.com/cameroncooke/AXe)) is the actual code path that produces `describe-ui` output. Its full AX path is:

1. `Sources/AXe/Commands/DescribeUI.swift` → `AccessibilityFetcher.fetchAccessibilityInfoJSONData(for: simulatorUDID, ...)`.
2. `Sources/AXe/Utilities/AccessibilityFetcher.swift:24-39` → `target.accessibilityElement(at: ..., nestedFormat: true)` or `target.accessibilityElements(withNestedFormat: true)` on `FBSimulator`.
3. `Sources/AXe/Utilities/GlobalSetup.swift` (full file): loads `essentialFrameworks`, `xcodeFrameworks`, verifies `SimulatorKit.SimDeviceLegacyHIDClient` is resolvable. **No defaults reads, no flag checks.**
4. From there, `FBSimulatorControl/Commands/FBSimulatorAccessibilityCommands.m` (in `facebook/idb`):
   - `validateAccessibilityWithError:` (lines 1370-1388) checks `simulator.state == FBiOSTargetStateBooted` and that `[SimDevice respondsToSelector:@selector(sendAccessibilityRequestAsync:completionQueue:completionHandler:)]`. **No defaults reads, no flag checks.**
   - The dispatcher block (lines 1015-1033) bridges `AXPTranslator` callbacks to `[device sendAccessibilityRequestAsync:completionQueue:completionHandler:]`. **No defaults reads, no flag checks.**
   - The remediation path (lines 1393-1456) handles `CGRectZero` + dead-pid by restarting `CoreSimulatorBridge`. **No flag check; the trigger is geometry + pid liveness.**

Conclusion: there is no code path between `axe describe-ui` and the simulator's AX XPC service that reads `AccessibilityEnabled` or `ApplicationAccessibilityEnabled`. If the flags were the gate, this entire chain would be broken on every simulator, fresh or not, where the user hadn't manually enabled them — which is empirically not the case.

The user-facing `AccessibilityEnabled` defaults in `com.apple.Accessibility` control assistive-technology features (VoiceOver, Switch Control, etc.). The introspection API used by AXe / Accessibility Inspector / `idb` is a separate code path (CoreSimulator XPC → AccessibilityPlatformTranslation), and it does not gate on those flags. They live in the same plist domain but they are not the same switch.

### What the symptom does match

`FBSimulatorAccessibilityCommands.m:1428-1433`:

```objc
+ (FBFuture<NSNumber *> *)remediationRequiredForSimulator:(FBSimulator *)simulator element:(AXPMacPlatformElement *)element
{
  // First perform a quick check, if the accessibility frame is zero, then this is indicative of the problem
  if (CGRectEqualToRect(element.accessibilityFrame, CGRectZero) == NO) {
    return [FBFuture futureWithResult:@NO];
  }
  ...
```

The framework treats `accessibilityFrame == CGRectZero` as the canonical "something is wrong" indicator. The remediation that follows checks pid liveness and restarts `CoreSimulatorBridge` if the pid is dead. **A not-yet-initialized AX subsystem produces a zero frame with a live pid, so this remediation path declines to remediate** (`mapReplace:@NO` on line 1443 when the service name resolves), and the framework returns the empty `AXApplication` upward — exactly the symptom in #290.

This is a code-level mechanism for "AX subsystem isn't ready" producing the exact reported output. It is a stronger explanation for the symptom than "flags = 0" because:

1. It produces the exact reported geometry/children pattern.
2. It doesn't require an architectural change (a flag check) that the public source of FBSimulatorControl/CoreSimulator/AXe does not contain.
3. It reconciles with AXe's known-good behavior on fresh sims after the user has waited.

### What would the daemon-readiness hypothesis predict that the flag hypothesis would not?

If timing is the cause:

- Boot a fresh sim, **do not** write any defaults, immediately query `axe describe-ui` → empty.
- Wait 30 s without writing defaults, query again → success. Re-read defaults: they may now read as `1` even though we never wrote them, depending on whether the subsystem self-writes.
- Boot a fresh sim, immediately write both defaults, immediately query → still empty (because the subsystem isn't up yet to honor either the AX query *or* the write becoming "live").

If flags are the cause:

- Boot a fresh sim, immediately write defaults, immediately query → success (the test mocked in `simulator-accessibility.test.ts:50-89` mocks this case but says nothing about actual simulator behavior).
- Boot a fresh sim, write defaults, *do not wait* → success.

Note the working-tree version's `ACCESSIBILITY_SETTLE_MS = 1500` is exactly the kind of "settle" that a believer in flag-causation would add as a small buffer for "the daemon to notice the change." If the timing hypothesis is correct, 1500 ms is far too short and the success the maintainer observes in agent flows comes from wall-clock burn elsewhere (build, install, app-launch wait), not from the helper itself.

Either hypothesis is empirically falsifiable with a small test plan; PR #312 ships with neither test performed.

### Where the PR appears to work in practice

A typical XcodeBuildMCP agent flow on a freshly-booted iOS 26 simulator:

1. `boot_sim` (or the implicit boot in `build_run_sim`).
2. `xcodebuild` — typically 5-30 s for incremental, much longer for clean.
3. `install_app_sim` — seconds.
4. `launch_app_sim` — seconds, plus app startup.
5. First UI tool call (`snapshot_ui` / `tap` / etc.).

Steps 2-4 alone normally consume more wall-clock time than the daemon-readiness hypothesis attributes to the init window. The PR's helper, in either its boot-time or per-tool placement, runs *during* this window. Whichever theory is correct, the user observes "fix worked" because by the time the first AX-dependent call runs, enough wall-clock time has passed.

The per-tool placement on this branch is robust to one specific failure mode: if an agent calls a UI tool *immediately* after boot with no intervening build/install/launch (e.g., tapping an already-running Settings.app on the home screen), the boot-time helper would have completed but no AX query would have validated. Per-tool placement at least ensures the helper runs again before each AX query — but it only runs the flag write, not an AX readiness check. Under the timing hypothesis, the per-tool placement does not actually fix this case; it just paints over it.

### Reading the maintainer's working-tree diff against the two hypotheses

The branch's working-tree diff (vs. `dc107bc5` / `f77e293a` / `3da62aa1`) is consistent with the maintainer (Cameron, AXe author) testing the timing hypothesis without committing to it yet:

- Moving `ensureSimulatorAccessibility` from boot-time to per-tool-call: only useful if the maintainer suspects the boot-time write isn't sufficient and the AX subsystem state can revert or matter at later moments — i.e., it accommodates a "the helper doesn't really fix anything; let's at least always be in a known-flag-state when we issue an AX query" position.
- Adding `ACCESSIBILITY_SETTLE_MS = 1500`: a hedge that "writing defaults takes time to propagate." Useful if you believe the writes do something. Useless if they don't.
- Adding the read-first short-circuit: makes the helper cheap on warm sims. Compatible with both theories; doesn't pick a side.

None of these changes add a probe or measurement that would distinguish the theories.

### Summary of evidence weighting

| Claim | Evidence for | Evidence against |
|---|---|---|
| Flags are the gate | Issue author's correlation report. Flag write coincides with success in his single observation. | (a) AXe / FBSimulatorControl / CoreSimulator XPC do not read these flags in the source available. (b) "Idiomatic" workaround in the AXe-skill ecosystem is shutdown/reboot, not flag-write. (c) PR ships no controlled experiment. (d) AXe works fine on fresh simulators where flags are 0, given enough wall-clock time. |
| Timing is the gate | (a) FBSimulatorControl's `CGRectZero` symptom is consistent with a not-yet-initialized translator. (b) The remediation FBSimulatorControl already implements is for the related "stale SpringBoard" case, indicating the framework authors view zero-frame as a state issue. (c) Established workaround is "reboot and try again", which only makes sense for time-dependent causes. | No public, technical confirmation of the specific 25–30 s window. Hypothesis itself is unproven, just plausible. |

**Net:** the timing hypothesis has a stronger architectural mechanism and matches the documented symptom shape; the flag hypothesis has only a single observer's correlation, no causal mechanism in the available source, and contradicts AXe's normal working behavior on fresh sims.


## Empirical Confirmation (2026-04-27)

The hypothesis was tested against three real iOS 26.4 / iPhone-17 simulators via `scripts/investigations/ax-readiness-test-v2.sh` and `scripts/investigations/ax-late-write-test.sh`. Each trial used a brand-new `simctl create`d device, T+0 anchored at "`simctl bootstatus -b` returned AND `com.apple.SpringBoard` is in `launchctl list` AND a defaults read round-trip succeeds". Logs in `/tmp/ax-readiness-v2-20260427-201959/` and `/tmp/ax-late-write-20260427-202927/`.

| Scenario | T_ready (s) | Outcome |
|---|---|---|
| A (no write), trial 1 | 8 | Flags `missing` at T+0, `1`/`1` by T+5s, AX ready at T+8s |
| A (no write), trial 2 | 8 | Same pattern |
| B0 (write at T+1), trial 1 | never (>90) | Flags read `1`/`1` immediately and stay `1`/`1`. **AX never returns non-empty for 90 s.** |
| B0 (write at T+1), trial 2 | never (>90) | Same |
| C (passive, no AX queries) | n/a | **Flags remain `missing` / `missing` for 45 s with no external write.** Single AX query at T+45s succeeds immediately. |
| E (AX confirmed ready, then write 10 s in), trial 1 | 5 | Late write at T+15s, AX still ready at T+16, T+20, T+25, T+36 |
| E (AX confirmed ready, then write 10 s in), trial 2 | 6 | Same |

### Confirmed and revised hypotheses

| Sub-claim | Status |
|---|---|
| Flags are not the gating mechanism | **Confirmed.** Test A succeeds with flags `missing` at the time of the successful query. |
| AX subsystem needs ~25–30 s post-boot | **Revised.** ~5–8 s in this configuration (iOS 26.4, iPhone 17, modern Mac). The original report's longer window probably reflected user-Mac variance, app launch cost, or first-time Xcode-26 CoreSimulator framework warmup, not the AX subsystem itself. |
| Subsystem self-writes the flags during init | **Revised.** The flag self-write happens as a side effect of an **AX query landing successfully**, not of the subsystem initializing. Test C kept flags missing for 45 s with no AX queries. The instant we issue an AX query (Test A), the flags appear within seconds. |
| Honest fix is a readiness probe | **Confirmed**, with an additional twist: |

### New, stronger finding

**PR #312 is not just a no-op — it is an active regression.** Three trials of writing the flags inside the accessibilityd-startup window (T+0 to T+1) produce **permanent AX failure for the rest of that boot**. AX never returns a non-empty hierarchy in 90 s of polling. The flag values themselves read `1`/`1` after the write (so any "did the write succeed" check sees success), masking the breakage.

Test E — writing 10 s after AX is independently confirmed ready — produces no breakage. AX continues to respond throughout. So the regression is specifically a race against `accessibilityd`'s startup binding, not a property of the write itself.

PR #312, in its original (`boot_sim`/`build_run_sim`) placement, runs the write inside the race window. The working-tree per-tool placement on this branch hits the same race whenever a UI tool is the first AX-touching call after a fresh boot — which is the typical case for `snapshot_ui` immediately after `boot_sim`/`build_run_sim`.

### Mechanism

The most plausible explanation, consistent with the data:

1. After `simctl bootstatus -b`, SpringBoard is up and `cfprefsd` is responsive, but the in-simulator `accessibilityd` / AX-translation XPC service is still binding. The bind takes ~5–8 s.
2. `accessibilityd` reads its configuration from `com.apple.Accessibility` defaults during this window.
3. A concurrent `cfprefsd` write to the same domain mid-startup leaves the daemon with an inconsistent view; it fails to register a valid translation object with `CoreSimulatorBridge`.
4. After that, every AX query through `FBSimulator.accessibilityElements(withNestedFormat:)` returns the empty `AXApplication` shape for the lifetime of that boot. There is no recovery short of `simctl shutdown && boot`.
5. The flag values stored in defaults are unaffected by the daemon's internal failure — `defaults read` continues to return `1`/`1`, which is why a flag-only post-condition check would falsely report success.

This matches FBSimulatorControl's own framework comment (`FBSimulatorAccessibilityCommands.m:140-170`), which describes the AX path as bridging through CoreSimulator XPC; if the in-simulator translator never binds correctly, the framework returns the empty shape upward — exactly the symptom in #290.

### What this means for the original issue #290

Issue #290's reporter saw flags=0 on a fresh sim, ran `defaults write` after `axe describe-ui` had already failed once, then ran `axe describe-ui` again and got a hierarchy. The data above suggests two more-likely interpretations of what he saw:

1. The first `axe describe-ui` happened during the accessibilityd-startup race and returned empty for that reason. The wall-clock time consumed by typing/running the `defaults write` commands was enough to push past the race window. The second `describe-ui` succeeded because the subsystem had finished initializing, not because of the write.

2. Alternatively, his first `describe-ui` triggered the same race we see in B0 and broke AX for that boot. Then his `defaults write` happened after the break — too late to help, but `defaults read` showed `1`/`1` afterward (because the write succeeded *as a write*, even though the AX subsystem was already broken). His second `describe-ui` succeeded only because by then enough time had passed that he was on a different boot (e.g., a Simulator.app restart between attempts), or because he was on a different simulator state than he realized.

Either way, the causal arrow he inferred — `defaults write → describe-ui works` — is unsupported by direct measurement. The data here directly contradicts it.

### Updated recommendations (supersedes §1–§6 above)

1. **Delete `src/utils/simulator-accessibility.ts`.** It does no good and active harm.
2. **Remove `ensureSimulatorAccessibility` calls from all ten UI-automation tools** (`tap`, `button`, `gesture`, `key_press`, `key_sequence`, `long_press`, `snapshot_ui`, `swipe`, `touch`, `type_text`).
3. **Keep `boot_sim`/`build_run_sim` clean** — the working tree had already removed the calls there; that stays.
4. **Delete the test file** `src/utils/__tests__/simulator-accessibility.test.ts`.
5. **Update `boot_sim.test.ts`, `snapshot_ui.test.ts`, and `tap.test.ts`** to remove assertions about the helper's calls.
6. **Update `CHANGELOG.md`**: replace the existing `### Fixed` entry with a `### Removed` entry describing PR #312's deletion and a one-line summary of the empirical finding.
7. **Optional, future:** if the bug ever recurs, implement a polling readiness probe (the design in §2 of the original recommendations is still correct — poll AX, never write defaults). Don't ship it preemptively; the AX subsystem appears to warm up in single-digit seconds in normal conditions.


## Investigation Log

### Phase 1.5 — External fact-gathering (in-line, no agent dispatch needed)
**Hypothesis:** AXe and FBSimulatorControl never read the `com.apple.Accessibility/AccessibilityEnabled` flags; the AX path goes via CoreSimulator XPC translator.
**Findings:** Confirmed by reading [cameroncooke/AXe](https://github.com/cameroncooke/AXe) `Sources/AXe/Commands/DescribeUI.swift`, `Sources/AXe/Utilities/AccessibilityFetcher.swift`, `Sources/AXe/Utilities/GlobalSetup.swift`, `Sources/AXe/Utilities/Setup.swift`; and [facebook/idb](https://github.com/facebook/idb) `FBSimulatorControl/Commands/FBSimulatorAccessibilityCommands.m` (full file, 1459 lines). No flag reads anywhere in the chain.
**Evidence:**
- `FBSimulatorAccessibilityCommands.m:1370-1388` — `validateAccessibilityWithError:` checks only boot state and `SimDevice` API availability.
- `FBSimulatorAccessibilityCommands.m:1428-1456` — `CGRectZero` remediation triggers on geometry + dead pid, not flags.
- `FBSimulatorAccessibilityCommands.m:967-971` — "No translation object" is the point-only path; the hierarchical path returns the empty `AXApplication` shape on init failure.
**Conclusion:** Confirmed. The flag-causation theory has no mechanism in the public source.

### Phase 2 — In-workspace verification
**Hypothesis:** PR #312's helper, on this branch, contains no AX readiness probe.
**Findings:** Confirmed by reading `src/utils/simulator-accessibility.ts` (full file, 118 lines). The function is purely a `defaults read` short-circuit + two `defaults write` calls + a 1500 ms unconditional sleep on the write path. There is no `axe describe-ui` probe, no XPC ping, no time-since-boot guard.
**Evidence:**
- `src/utils/simulator-accessibility.ts:9` — `const ACCESSIBILITY_SETTLE_MS = process.env.VITEST ? 0 : 1500;` (uncommented constant).
- `src/utils/simulator-accessibility.ts:90-118` — `ensureSimulatorAccessibility` body.
- All ten `*Logic` callers (full list above) call `ensureSimulatorAccessibility(params.simulatorId, executor)` with no other readiness check around it.
**Conclusion:** Confirmed.

### Phase 3 — Causation evidence in PR/issue threads
**Hypothesis:** PR #312 ships without controlled-experiment evidence isolating flag effect from wall-clock effect.
**Findings:** Confirmed via `gh issue view 290`, `gh pr view 312 --comments`, `gh api .../issues/290/comments`, `gh api .../pulls/312/comments`. The only causal claims come from the issue author's own observations; reviews are limited to code correctness and do not validate the underlying mechanism.
**Conclusion:** Confirmed.

## Root Cause

**Of the bug as reported in #290:** The simulator's accessibility introspection subsystem (CoreSimulator's in-simulator XPC service, exposed through `AccessibilityPlatformTranslation` and consumed by `FBSimulatorControl/Commands/FBSimulatorAccessibilityCommands.m`) returns an empty `AXApplication` (`accessibilityFrame = CGRectZero`, `children = []`) for some period after a fresh iOS 26+ simulator finishes booting. This is consistent with the in-simulator XPC service / SpringBoard accessibility translator not yet being warm. The exact duration is unconfirmed by public sources; the issue author and the user's hypothesis both place it in a "tens of seconds" range, which matches the empirical "wait and reboot if it's still empty" workaround in the broader AXe ecosystem.

**Of why PR #312's flag-write appears to fix it:** The `defaults write` calls run during the same wall-clock window as the AX subsystem's natural warm-up. They have no documented or visible-in-source effect on the AX introspection path that AXe/`describe-ui` use. The single-observer evidence in #290 is correlation; the architectural counter-evidence (AXe and FBSimulatorControl never reading these flags) is direct.

**Of why the working-tree changes don't change this analysis:** Moving the helper from boot-time to per-tool-call addresses the case where the simulator was booted by something other than `boot_sim`/`build_run_sim`, but it does not introduce any actual readiness check. The 1500 ms `ACCESSIBILITY_SETTLE_MS` is far too short to cover the hypothesised init window and would only ever help if the flag-write were truly the gating event, which the available source does not support.

The hypothesis stated at the top of this report is, on the available evidence, the better-supported explanation. It is not yet proven — proving it requires a small empirical run on a freshly-booted iOS 26 simulator (see test plan below). It is, however, materially better supported than the flag-causation explanation that PR #312 ships with.

## Recommendations

The recommendations below are ordered most-to-least confident. They assume the maintainer wants to preserve the user-visible "describe-ui works on first call after a fresh boot" outcome that PR #312 was attempting to deliver.

### 1. Run the falsifying empirical test before any code change

A 5-minute test on a fresh iOS 26 simulator decides between the two theories. From a clean checkout (no PR #312 changes applied):

```bash
UDID=...                  # a fresh-deleted iOS 26 sim's UDID
xcrun simctl shutdown $UDID
xcrun simctl boot $UDID

# T+0: do not write any defaults. Observe time-to-first-non-empty AX response.
START=$(date +%s)
while true; do
  RESULT=$(axe describe-ui --udid $UDID 2>/dev/null)
  if echo "$RESULT" | jq -e '.[0].children | length > 0' > /dev/null 2>&1; then
    echo "AX ready after $(( $(date +%s) - START )) s"
    break
  fi
  sleep 1
done

# Now read the flags. Were they auto-written by the subsystem?
xcrun simctl spawn $UDID defaults read com.apple.Accessibility
```

If the AX subsystem reports ready after 20-40 s **without** anyone writing the flags, the timing hypothesis is confirmed and `ensureSimulatorAccessibility` should be deleted. If `defaults read` after a successful AX query shows `AccessibilityEnabled = 1`, the secondary claim ("the subsystem self-writes them") is also confirmed.

If on the other hand AX stays empty for several minutes without a flag write but starts working immediately after one, the PR's premise is correct and the current implementation can stay (modulo the simplifications in #5 below).

This test is the single most valuable thing to do before any code change. Without it, neither the PR's design nor my critique here is acted on with confidence.

### 2. Replace the flag-write helper with an AX readiness probe

Assuming the timing test confirms timing is the gate, replace `src/utils/simulator-accessibility.ts` with a polling probe:

```ts
// src/utils/simulator-accessibility.ts (rewritten)
export async function waitForSimulatorAccessibility(
  simulatorId: string,
  executor: CommandExecutor,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? (process.env.VITEST ? 100 : 30_000);
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const ready = await axDescribeUiSucceeds(simulatorId, executor);
    if (ready) return;
    await sleep(pollIntervalMs);
  }
  // Don't throw — degrade like the current helper does.
  log('warn', `[Simulator]: AX subsystem not ready within ${timeoutMs}ms; describe-ui may return empty.`);
}
```

`axDescribeUiSucceeds` runs a minimal `axe describe-ui --udid <UDID>` and returns `true` only if the result has `children.length > 0` and `frame` is non-zero. This is the test FBSimulatorControl itself effectively performs in its `remediationRequired` path.

If the maintainer wants to keep the flag-write as belt-and-suspenders, fine — but it should not be advertised as the cause, and the readiness probe should be the actual mechanism.

### 3. Place the readiness probe at the right layer

The current per-tool placement (every UI-automation tool calls the helper) is a good *placement* — far better than the original boot-time-only placement — because it covers all simulator-was-already-booted paths. Keep that placement, but make the work it does meaningful. The probe should:

- Run once per tool call, but cache success per-`simulatorId` for the lifetime of the MCP server process. After we've seen a non-empty hierarchy once for a sim, we don't need to probe again unless we see empty results from the actual tool.
- Also execute when `snapshot_ui` returns `children.length === 0` and `frame` is `{0,0,0,0}` — that's the "we thought we were ready but we weren't" recovery case. In that case, log a one-time hint suggesting `xcrun simctl shutdown && simctl boot` and surface a clean diagnostic in the tool result.

### 4. Stop conflating two different "accessibility" concepts in user-facing strings

The current commit message and the PR description say "accessibility hierarchy queries from returning any elements" and "accessibility daemon doesn't expose any element tree" while writing flags whose documented purpose is enabling user-facing assistive technology. These are different subsystems sharing a plist domain. Future maintainers reading the code will copy this misunderstanding. If the helper stays at all, its JSDoc should clearly say "we don't know whether this actually does anything; the empirical reason `describe-ui` then works is wall-clock time."

### 5. If the flag-write helper is kept (defensive belt-and-suspenders)

Minimal cleanup, regardless of which theory wins:

- `src/utils/simulator-accessibility.ts:9` — `ACCESSIBILITY_SETTLE_MS = 1500` should either get a justifying comment ("1500 ms because <citation>") or be removed. As written, it is a magic number that survives review only because nobody is testing it.
- `src/utils/simulator-accessibility.ts:74-83` — JSDoc still attributes causation to flags. If the timing test is not run, the doc should at least be hedged: "We write these flags as a precaution; the actual gate appears to be CoreSimulator XPC readiness and is time-dependent."
- The per-tool placement adds two `defaults read` `simctl spawn` calls per UI-automation tool call on the warm path. That's about 50-150 ms each. Across 10 UI tools, this is non-trivial. If the helper is retained, the success cache from #3 above eliminates this cost in steady state.

### 6. Update issue #290 and the PR description

Whichever way the empirical test lands, the issue and PR should be amended with the actual cause. If the timing hypothesis wins, the changelog `### Fixed` entry's text should be rewritten so future readers don't perpetuate the flag-causation story.

## Preventive Measures

- **Require a controlled experiment for any "fix" that asserts a causal mechanism.** PR #312 says "AccessibilityEnabled defaults to 0 ... prevents accessibility hierarchy queries from returning any elements" without measuring whether flipping the flag actually shortens the AX-empty interval. Future PRs that name a mechanism should ship with at least a `before/after` measurement reproducible from a fresh sim.
- **Distinguish user-facing accessibility (VoiceOver / assistive tech, gated on `AccessibilityEnabled`) from the AX introspection bus (CoreSimulator XPC translator, used by AXe/Inspector/idb).** They live in the same plist domain but are not the same switch. A short note in `src/utils/axe-helpers.ts` or in `AGENTS.md` would prevent future contributors from re-treading this confusion.
- **Prefer probes over writes in subsystem-warmup code.** When the symptom is "X returns empty for some time after boot," the honest fix is "wait for X to return non-empty." Writing other state and hoping doesn't form a falsifiable hypothesis.
- **For agent-flow code, add explicit timeouts and surface them.** The current helper's failure mode is silent (warn-log only), which is what makes it hard to tell whether it ever helped. A readiness probe that times out with an actionable error ("AX subsystem not ready in 30 s; consider rebooting the simulator") gives downstream agents a recovery path and gives maintainers a metric to watch.
