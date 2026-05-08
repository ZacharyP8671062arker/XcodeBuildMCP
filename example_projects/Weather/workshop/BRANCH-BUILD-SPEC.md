# Workshop Branch Build Spec

Hand-off doc for a coding agent that will produce the demo branches and patches
for the Sentry XcodeBuildMCP workshop on Tuesday.

**Companion docs (read first):**
- `workshop-runbook.md` (repo root) — describes the workshop flow, acts, prompts, and recordings. This spec implements its "Stage branches" section.
- `example_projects/Weather/workshop/WORKSHOP-QA.md` — Q&A talking points. Currently references an older demo plan; do **not** rewrite it as part of this work, but flag if anything contradicts the runbook.

---

## Context

The Atmos Weather example app at `example_projects/Weather/` is the demo project for a 60-minute workshop. The workshop has four acts, each independently bootable from its own git branch. This spec defines those branches, the planted bugs/features per branch, and a `build-stages.sh` driver script that recreates them all from `.patch` files.

End deliverable:

- Branch `workshop/base` pinned to today's `main`.
- Eight `stage/*` branches off `workshop/base`, each containing a specific planted state.
- `example_projects/Weather/workshop/patches/` populated with one `.patch` per stage.
- `example_projects/Weather/workshop/build-stages.sh` that recreates all stage branches from the patches.
- `example_projects/Weather/workshop/README.md` documenting the workflow.

---

## Constraints

- Read `CLAUDE.md` at the repo root before doing anything. Follow it strictly.
- **Never commit unless the user explicitly asks.** This spec describes what to commit; the user will run the commit, or will tell you to commit. Default: stage changes, show diffs, await confirmation.
- No emojis in commits, branch names, file content, PR descriptions, or chat output.
- No `any` types; follow project TypeScript/Swift conventions.
- Use the project's existing Swift idioms — match `OSLog` usage, `accessibilityIdentifier` placement, `AppLog` channels.
- **Do not modify any code outside `example_projects/Weather/`** unless this spec explicitly calls for it.
- The repo is case-insensitive on macOS but the on-disk path is `example_projects/Weather/` (capital W). Use that exact case in all references.

---

## Branching strategy

```
main
 └── workshop/base                       (pinned anchor; tagged workshop/base-2026-05-08)
       ├── stage/1-build-run-clean       (compile error in SunMiniCard.swift)
       ├── stage/2-feature-start         (clean; alertsEnabled toggle is dead)
       ├── stage/2-feature-done          (alerts banner wired; reference solution)
       ├── stage/3-bug-planted           (Reykjavík search-pool entry crashes on selection)
       ├── stage/3-bug-fixed             (planted bug + fix; reference solution)
       ├── stage/4-no-sentry             (real backend, no Sentry SDK installed)
       ├── stage/4b-sentry-prewired      (real backend + Sentry installed; live-wizard fallback)
       └── stage/5-end-to-end            (same as 4b; backend has 500 plant — backend changes are out of scope here)
```

Every stage branch is one squashed commit off `workshop/base`. Every stage produces one `.patch` file via `git format-patch workshop/base..stage/N --stdout > workshop/patches/N-name.patch`.

`stage/5-end-to-end` is structurally identical to `stage/4b-sentry-prewired`. Implement as a separate branch pointing at the same commit content (so the runbook can switch between them without confusion). The actual backend 500 plant lives in a separate backend repository and is **out of scope** for this work.

---

## Stage 0 — Bootstrap

Create the anchor branch and the workshop scaffolding.

### Tasks

1. Confirm `git status` is clean. If not, stop and ask the user.
2. Tag current `main` HEAD as `workshop/base-2026-05-08` and create branch `workshop/base` from it.
3. Create directory `example_projects/Weather/workshop/patches/`.
4. Create `example_projects/Weather/workshop/build-stages.sh` with the contents specified in the appendix below.
5. Create `example_projects/Weather/workshop/README.md` with the contents specified in the appendix below.
6. **Do not commit yet.** Show the user the new files and the branch state, then await instruction.

### Verification

```
git branch | grep -E '(workshop/base|main)'
ls example_projects/Weather/workshop/
test -x example_projects/Weather/workshop/build-stages.sh
```

### ▶ Prompt

```
Bootstrap the workshop scaffolding per BRANCH-BUILD-SPEC.md "Stage 0".

1. Verify git status is clean.
2. Tag main as workshop/base-2026-05-08, create branch workshop/base from it.
3. Create example_projects/Weather/workshop/patches/ (empty dir, add a .gitkeep).
4. Create example_projects/Weather/workshop/build-stages.sh per the spec's appendix.
5. Create example_projects/Weather/workshop/README.md per the spec's appendix.
6. Do not commit. Show me git status and the new files. Await my next instruction.
```

---

## Stage 1 — `stage/1-build-run-clean`

Plant a single, obvious Swift compile error so the agent on stage demonstrates the build → fix → re-run loop.

### Tasks

1. From `workshop/base`, branch `stage/1-build-run-clean`.
2. Edit `example_projects/Weather/Weather/Views/Sections/SunMiniCard.swift`. On the `Text(primaryTime)` call (currently around line 14), remove the closing `)`. Result:
   ```swift
   Text(primaryTime
       .font(.system(size: 22, weight: .light))
   ```
   This produces a parser-level error like "expected ')' in expression list" at line 15. Single-character fix, isolated to one file, no behavioral risk.
3. Build to confirm the error fires:
   ```bash
   ./build/cli.js simulator build --scheme Weather --destination "platform=iOS Simulator,name=iPhone 17 Pro" 2>&1 | tail -30
   ```
   Expected: build fails with the missing-paren error pointing at SunMiniCard.swift.
4. Stage the change. **Do not commit yet** — show the user, await confirmation.
5. After commit (when user instructs): `git format-patch workshop/base..stage/1-build-run-clean --stdout > example_projects/Weather/workshop/patches/1-build-run-clean.patch`.

### Verification (post-fix)

When the user fixes the paren and rebuilds, the app should launch under `--mock-weather-api` with no other errors. Default location renders.

### Notes

- Do **not** introduce a second error elsewhere. One error only.
- Do **not** modify any other file. The error must be the only diff vs `workshop/base`.

### ▶ Prompt

```
Implement Stage 1 of BRANCH-BUILD-SPEC.md.

1. From workshop/base, create branch stage/1-build-run-clean.
2. In example_projects/Weather/Weather/Views/Sections/SunMiniCard.swift, on the
   Text(primaryTime) line (~line 14), remove the closing ")" so the line reads
   `Text(primaryTime` followed by the .font modifier on the next line.
3. Confirm the build fails with a parser error pointing at this file.
4. Show me git diff. Do not commit. Await instruction.

After I confirm and you commit, run:
  git format-patch workshop/base..stage/1-build-run-clean --stdout \
    > example_projects/Weather/workshop/patches/1-build-run-clean.patch
```

---

## Stage 2a — `stage/2-feature-start`

Clean baseline for the "add a feature" act. The `alertsEnabled` toggle is bound but unconsumed (this is already true on `workshop/base`, so this branch is essentially a copy of base with a single discoverability marker).

### Tasks

1. From `workshop/base`, branch `stage/2-feature-start`.
2. In `example_projects/Weather/Weather/Models/WeatherModels.swift`, on the line `var alertsEnabled = true` inside `WeatherUnits`, add a trailing comment:
   ```swift
   var alertsEnabled = true   // TODO: not yet wired into UI
   ```
   This is the only change. Acts as a low-noise hint for any agent that grep-walks the file looking for unfinished work, while still preserving the "discover the bug yourself" demo dynamic.
3. Verify the app builds and runs cleanly under mock.
4. Stage, show diff, await commit instruction.
5. After commit: capture patch as `2-feature-start.patch`.

### Notes

- Resist the urge to wire `alertsEnabled` partway here. The whole point of Act II is the agent doing it on stage.
- Keep diff to one line of comment.

### ▶ Prompt

```
Implement Stage 2a of BRANCH-BUILD-SPEC.md.

1. From workshop/base, create branch stage/2-feature-start.
2. In example_projects/Weather/Weather/Models/WeatherModels.swift, append the
   comment "// TODO: not yet wired into UI" to the line declaring
   `var alertsEnabled = true` inside WeatherUnits. Single-line change.
3. Build and run under --mock-weather-api to confirm clean launch.
4. Show me git diff. Do not commit. Await instruction.

After I confirm and you commit, capture the patch as
example_projects/Weather/workshop/patches/2-feature-start.patch.
```

---

## Stage 2b — `stage/2-feature-done`

Reference implementation of the alerts banner. Used as a fallback if the live agent goes off-script during Act II.

### Tasks

1. From `workshop/base`, branch `stage/2-feature-done`.
2. Wire up `alertsEnabled` so that when ON **and** the current condition is `.thunderstorms` or `.heavyRain`, a "Severe weather alert" banner displays near the top of the main screen.

   Implementation outline (the agent has freedom on exact placement, but follow the spirit):

   - Add a new SwiftUI view, e.g. `WeatherAlertBanner`, modeled on the existing `WeatherLoadingBanner` in `ContentView.swift`. Use the same capsule shape, `.ultraThinMaterial`-adjacent background, white text, leading icon `exclamationmark.triangle.fill`, label "Severe weather alert".
   - Display logic: visible when `units.alertsEnabled && (current.condition == .thunderstorms || current.condition == .heavyRain)`. Suppressed otherwise.
   - Mount as a sibling overlay in `ContentView.body`, aligned `.top`, padded so it sits below the loading banner (don't collide with the existing `WeatherLoadingBanner`).
   - Add `.accessibilityIdentifier("weather.alertBanner")` for UI automation testability.
   - Add an `AppLog.app.notice(...)` line on first display (single-shot, not on every render) — match the project's logging idiom.
3. Verify by selecting the New Orleans default location (which is `.thunderstorms` per the mock fixtures): banner shows. Toggle "Severe weather alerts" off in the Settings sheet: banner hides. Toggle on: banner returns.
4. Stage, show diff, await commit instruction.
5. After commit: capture patch as `2-feature-done.patch`.

### Notes

- Prefer the smallest sensible diff. Don't refactor surrounding code.
- Don't add any new dependencies. Pure SwiftUI + project-internal types only.
- Match the visual language of `WeatherLoadingBanner` so the banner looks native to the app.

### ▶ Prompt

```
Implement Stage 2b of BRANCH-BUILD-SPEC.md.

1. From workshop/base, create branch stage/2-feature-done.
2. Wire up the alertsEnabled toggle so a "Severe weather alert" banner displays
   near the top of the main screen when:
     units.alertsEnabled == true
     AND current.condition is .thunderstorms or .heavyRain
   Suppress the banner otherwise.
3. Implement WeatherAlertBanner as a SwiftUI view modelled on
   WeatherLoadingBanner (same capsule shape, white text, leading
   exclamationmark.triangle.fill icon). Mount as an overlay aligned .top in
   ContentView, padded below the existing loading banner.
4. Add accessibilityIdentifier "weather.alertBanner".
5. Verify behaviour by:
   - Building and running under --mock-weather-api.
   - Selecting New Orleans (default location, .thunderstorms scenario) — banner
     should show.
   - Toggling Severe weather alerts off in Settings — banner should hide.
6. Show me git diff. Do not commit. Await instruction.

After I confirm and you commit, capture the patch as
example_projects/Weather/workshop/patches/2-feature-done.patch.
```

---

## Stage 3a — `stage/3-bug-planted`

Plant a runtime crash that requires LLDB to diagnose. The Reykjavík search-pool entry produces a wind direction of 360°, which violates `WindDirection.init`'s precondition `degrees >= 0 && degrees < 360`. The default-list Reykjavík entry stays unaffected.

### Tasks

1. From `workshop/base`, branch `stage/3-bug-planted`.
2. Edit `example_projects/Weather/Weather/Services/MockWeatherDTOFactories.swift`:
   - Add a new `MockWeatherScenario` case `.subarctic`.
   - Add a `CurrentWeatherDTO.mock(for: .subarctic)` factory variant. Base it on the `.night` factory but set `wind_direction_degrees = 360.0`. Also vary the temperature/condition so it visually reads "Reykjavík at night" — clear-night, wind ~25 km/h, temp ~3°C — and importantly is **distinguishable from the `.night` scenario** so the bug is reproducible only via this code path.
   - Update `scenarioByLocationID` to map `loc-is-capital-reykjavik` (the search-pool entry on line ~37) from `.night` to `.subarctic`. Leave `loc-is-reykjavik` (the default-list entry on line ~21) unchanged.
   - If `HourlyForecastDTO.mockForecast(for:)` and `DailyForecastDTO.mockForecast(for:)` need a case for `.subarctic`, add ones that mirror `.night`.
3. Build and run under `--mock-weather-api`. Confirm:
   - Default location (San Francisco) loads cleanly.
   - Default-list Reykjavík (open Locations sheet, tap Reykjavík at the top) loads cleanly — `.night` scenario, no crash.
   - **Search "Reykja", tap the result labelled "Reykjavík, Capital Region, Iceland" → app crashes** with the precondition message about wind direction.
4. Stage, show diff, await commit instruction.
5. After commit: capture patch as `3-bug-planted.patch`.

### Notes

- The crash must fire **only** for `loc-is-capital-reykjavik`, not for any other location. Verify by also tapping Tokyo, Paris, London from search — none should crash.
- Do **not** modify `WindDirection.init` or any other model code. The bug must live in the data, not the validation, so the agent's code-only read can't find it.
- Do **not** add any logging hint that points at the bug. The Swift runtime crash message is the only signal.

### ▶ Prompt

```
Implement Stage 3a of BRANCH-BUILD-SPEC.md.

1. From workshop/base, create branch stage/3-bug-planted.
2. In example_projects/Weather/Weather/Services/MockWeatherDTOFactories.swift:
   - Add a new MockWeatherScenario case `.subarctic`.
   - Add a CurrentWeatherDTO.mock(for: .subarctic) variant that mirrors `.night`
     but sets wind_direction_degrees = 360.0.
   - Map `loc-is-capital-reykjavik` (search-pool Reykjavík) from `.night` to
     `.subarctic` in scenarioByLocationID. Leave `loc-is-reykjavik` (default
     list) untouched.
   - If HourlyForecastDTO.mockForecast(for:) or DailyForecastDTO.mockForecast(for:)
     are scenario-switched, add `.subarctic` cases that mirror `.night`.
3. Build and run under --mock-weather-api. Confirm:
   - SF default loads cleanly.
   - Default-list Reykjavík (top of Locations sheet) loads cleanly.
   - Searching "Reykja" and tapping "Reykjavík, Capital Region, Iceland"
     crashes with a precondition failure on wind direction.
   - Tokyo, Paris, London via search load cleanly (no regression).
4. Do NOT modify WindDirection.init or add any logging hint. The bug lives in
   data only.
5. Show me git diff. Do not commit. Await instruction.

After I confirm and you commit, capture the patch as
example_projects/Weather/workshop/patches/3-bug-planted.patch.
```

---

## Stage 3b — `stage/3-bug-fixed`

Reference fix for the wind-360 crash. Branches off `stage/3-bug-planted` (not `workshop/base`) so the diff captures only the fix.

### Tasks

1. From `stage/3-bug-planted`, branch `stage/3-bug-fixed`.
2. Apply the fix at the **DTO mapper** layer (preferred over relaxing the model precondition). In `example_projects/Weather/Weather/Services/WeatherClientDTOs.swift` (or wherever the DTO → `WindDirection` conversion happens — find via `git grep WindDirection`), normalize the input via `truncatingRemainder(dividingBy: 360)` before constructing `WindDirection`. Handle negatives too (add 360 if negative, then mod again).
3. Add a unit test in `example_projects/Weather/WeatherTests/` that pins behaviour for inputs `360.0`, `720.0`, `-10.0`, and `0.0`. Use the existing test idioms (XCTest or Swift Testing — match what's already there).
4. Build and run. Confirm:
   - The Reykjavík search → tap flow now succeeds. Wind direction renders as 0° (or whatever the normalized output is).
   - All other locations still work.
   - Tests pass: `./build/cli.js simulator test --scheme Weather`.
5. Stage, show diff, await commit instruction.
6. After commit: capture patch as `3-bug-fixed.patch`. **Note** the patch is taken vs `workshop/base`, so it includes both the plant *and* the fix:
   ```
   git format-patch workshop/base..stage/3-bug-fixed --stdout \
     > example_projects/Weather/workshop/patches/3-bug-fixed.patch
   ```

### Notes

- Do **not** modify `WindDirection.init`'s precondition. The model invariant is correct; only the DTO mapper should normalize.
- Test names should be descriptive: e.g., `testWindDirectionNormalizesThreeSixtyToZero`.

### ▶ Prompt

```
Implement Stage 3b of BRANCH-BUILD-SPEC.md.

1. From stage/3-bug-planted, create branch stage/3-bug-fixed.
2. Find the DTO -> WindDirection conversion (likely in
   example_projects/Weather/Weather/Services/WeatherClientDTOs.swift).
   Normalize wind_direction_degrees with truncatingRemainder(dividingBy: 360),
   handling negatives correctly, before constructing WindDirection.
3. Do NOT modify WindDirection.init's precondition.
4. Add a unit test in example_projects/Weather/WeatherTests/ pinning behaviour
   for 360.0, 720.0, -10.0, and 0.0. Match existing test idioms.
5. Build and run. Confirm Reykjavík search -> tap now succeeds. Run tests.
6. Show me git diff. Do not commit. Await instruction.

After I confirm and you commit, capture the patch (vs workshop/base, not vs
stage/3-bug-planted) as example_projects/Weather/workshop/patches/3-bug-fixed.patch.
```

---

## Stage 4 — `stage/4-no-sentry`

App points at the real backend (no `--mock-weather-api`), no Sentry SDK installed. Used for the live `sentry-wizard` demo.

### Tasks

1. From `workshop/base`, branch `stage/4-no-sentry`.
2. Edit `example_projects/Weather/Weather/Services/WeatherAPIClient.swift`. The current `WeatherAPIConfiguration.production.baseURL` is `https://api.atmosweather.example/v1`. Replace with the real backend URL once known. **For now, leave the placeholder and add a clearly-marked TODO** so the user can swap it in immediately before the workshop:
   ```swift
   static let production = WeatherAPIConfiguration(
       // TODO[workshop]: replace with deployed backend URL before the demo
       baseURL: URL(string: "https://api.atmosweather.example/v1")!
   )
   ```
3. Confirm the app builds. (It will fail at runtime when fetching against the placeholder URL, which is expected — Stage 4 demos the wizard install, not the backend behaviour.)
4. Stage, show diff, await commit instruction.
5. After commit: capture patch as `4-no-sentry.patch`.

### Notes

- The user will edit this URL by hand on the morning of the workshop. Don't try to parameterize via env var or build setting — keep it stupid-simple.
- Do not install Sentry on this branch. The whole point is to start without it.

### ▶ Prompt

```
Implement Stage 4 of BRANCH-BUILD-SPEC.md.

1. From workshop/base, create branch stage/4-no-sentry.
2. In example_projects/Weather/Weather/Services/WeatherAPIClient.swift, leave
   the placeholder production base URL but add a comment line above it:
     // TODO[workshop]: replace with deployed backend URL before the demo
3. Confirm the app builds. (It will fail at runtime fetching the placeholder
   URL — expected, do not "fix" this.)
4. Show me git diff. Do not commit. Await instruction.

After I confirm and you commit, capture the patch as
example_projects/Weather/workshop/patches/4-no-sentry.patch.
```

---

## Stage 4b — `stage/4b-sentry-prewired`

Sentry Cocoa SDK installed in the iOS app, ready as a fallback if `sentry-wizard` misbehaves on stage.

### Tasks

1. From `stage/4-no-sentry`, branch `stage/4b-sentry-prewired`.
2. Install Sentry. Prefer **Swift Package Manager** (Sentry's recommended path):
   - Add `https://github.com/getsentry/sentry-cocoa.git` as a Swift package dependency on the `Weather` target. Constraint: "Up to Next Major" from the latest 8.x release.
   - In `example_projects/Weather/Weather/WeatherApp.swift`, add a Sentry init in the `App.init()` method:
     ```swift
     import Sentry
     // ... inside init() ...
     SentrySDK.start { options in
         options.dsn = "https://example-placeholder@sentry.io/0" // TODO[workshop]: replace
         options.tracesSampleRate = 1.0
         options.enableAutoPerformanceTracing = true
         options.attachScreenshot = true
         options.attachViewHierarchy = true
     }
     ```
   - Add a Run Script build phase to upload dSYMs. Use Sentry's standard recipe — see https://docs.sentry.io/platforms/apple/guides/ios/dsym/ . Keep the auth token as a placeholder (`TODO[workshop]`).
3. **Try `sentry-wizard` first** (`npx @sentry/wizard@latest -i ios`). It may handle steps 2.1–2.3 cleanly. If it does, accept its output and move on. If it produces unexpected diffs or interactive prompts the agent can't answer, fall back to manual SPM install.
4. Build and confirm the app launches. Sentry will log warnings about the placeholder DSN — that's fine.
5. Stage, show diff, await commit instruction.
6. After commit: capture patch (vs `workshop/base`, not vs `stage/4-no-sentry`) as `4b-sentry-prewired.patch`.

### Notes

- The patch will be large (project file, Package.resolved, Sentry init code, build phase). That's OK.
- Do not commit `Package.resolved` to git unless the project already commits it. Check `.gitignore`.
- Don't enable session replay or any debug-only features that bloat startup.

### ▶ Prompt

```
Implement Stage 4b of BRANCH-BUILD-SPEC.md.

1. From stage/4-no-sentry, create branch stage/4b-sentry-prewired.
2. Install Sentry Cocoa SDK on the Weather target via Swift Package Manager
   (https://github.com/getsentry/sentry-cocoa.git, "Up to Next Major" from
   latest 8.x).
3. Add SentrySDK.start { options in ... } in WeatherApp.swift's init(). Use
   placeholder DSN "https://example-placeholder@sentry.io/0" with a
   TODO[workshop] comment. Enable performance tracing, screenshot attach,
   view hierarchy attach.
4. Add a Sentry dSYM upload build phase per Sentry's standard recipe, with
   placeholder auth token.
5. Try `npx @sentry/wizard@latest -i ios` first; accept its output if clean.
   Fall back to manual SPM install if not.
6. Build, confirm app launches.
7. Show me git diff. Do not commit. Await instruction.

After I confirm and you commit, capture the patch (vs workshop/base) as
example_projects/Weather/workshop/patches/4b-sentry-prewired.patch.
```

---

## Stage 5 — `stage/5-end-to-end`

Same content as `stage/4b-sentry-prewired`. Separate branch so the runbook can switch into it cleanly during Act IV beat 2 onwards. The backend 500 plant is **out of scope** here (lives in the backend repo).

### Tasks

1. Create `stage/5-end-to-end` pointing at the same commit as `stage/4b-sentry-prewired`:
   ```
   git checkout -b stage/5-end-to-end stage/4b-sentry-prewired
   ```
2. No further changes.
3. Capture patch:
   ```
   git format-patch workshop/base..stage/5-end-to-end --stdout \
     > example_projects/Weather/workshop/patches/5-end-to-end.patch
   ```
   This will be byte-identical to `4b-sentry-prewired.patch`.

### Notes

- Yes, this is intentionally a duplicate. The runbook treats them as separate so each act can fail independently. Don't try to "optimize" by symlinking or aliasing.

### ▶ Prompt

```
Implement Stage 5 of BRANCH-BUILD-SPEC.md.

1. From stage/4b-sentry-prewired, create branch stage/5-end-to-end. No content
   changes. They point at the same commit content intentionally.
2. Capture patch:
     git format-patch workshop/base..stage/5-end-to-end --stdout \
       > example_projects/Weather/workshop/patches/5-end-to-end.patch
3. Show me the resulting branch list. Done.
```

---

## Final verification

After all stages are built, run this verification:

```bash
# Branch hygiene
git branch | grep -E '^\s+(workshop/base|stage/(1|2-feature-(start|done)|3-bug-(planted|fixed)|4-no-sentry|4b-sentry-prewired|5-end-to-end))'

# Patches present
ls example_projects/Weather/workshop/patches/

# build-stages.sh executable
test -x example_projects/Weather/workshop/build-stages.sh

# Each stage builds (or fails as expected)
for branch in stage/1-build-run-clean stage/2-feature-start stage/2-feature-done \
              stage/3-bug-planted stage/3-bug-fixed stage/4-no-sentry \
              stage/4b-sentry-prewired stage/5-end-to-end; do
  echo "=== $branch ==="
  git checkout "$branch"
  ./build/cli.js simulator build --scheme Weather \
    --destination "platform=iOS Simulator,name=iPhone 17 Pro" 2>&1 | tail -5
done
```

Expected outcomes:

| Branch | Build outcome | Runtime outcome |
|---|---|---|
| `stage/1-build-run-clean` | **Fails** (planted compile error in SunMiniCard.swift) | n/a |
| `stage/2-feature-start` | Passes | Clean launch, alerts toggle is dead |
| `stage/2-feature-done` | Passes | Alerts banner shows for thunderstorms when toggle on |
| `stage/3-bug-planted` | Passes | Crashes when searching "Reykja" → tap "Reykjavík, Capital Region" |
| `stage/3-bug-fixed` | Passes | All locations work, tests pass |
| `stage/4-no-sentry` | Passes | Crashes/errors at runtime against placeholder URL — expected |
| `stage/4b-sentry-prewired` | Passes | Same as 4 plus Sentry SDK loaded |
| `stage/5-end-to-end` | Passes | Identical to 4b |

End by checking out `workshop/base` and showing the user the final branch list + patches dir.

---

## Appendix A — `build-stages.sh`

Place at `example_projects/Weather/workshop/build-stages.sh`. Make executable.

```bash
#!/usr/bin/env bash
# Recreate all workshop stage branches from patches.
# Run from the repo root. Idempotent: deletes existing stage branches first.

set -euo pipefail

PATCHES_DIR="example_projects/Weather/workshop/patches"

if ! git rev-parse --verify workshop/base >/dev/null 2>&1; then
    echo "error: branch workshop/base does not exist. Create it first." >&2
    exit 1
fi

stages=(
    "1-build-run-clean"
    "2-feature-start"
    "2-feature-done"
    "3-bug-planted"
    "3-bug-fixed"
    "4-no-sentry"
    "4b-sentry-prewired"
    "5-end-to-end"
)

for stage in "${stages[@]}"; do
    branch="stage/${stage}"
    patch="${PATCHES_DIR}/${stage}.patch"

    if [[ ! -f "${patch}" ]]; then
        echo "skip: ${branch} (no patch at ${patch})"
        continue
    fi

    echo "=== rebuilding ${branch} from ${patch} ==="
    git branch -D "${branch}" 2>/dev/null || true
    git checkout -b "${branch}" workshop/base
    git am "${patch}"
done

git checkout workshop/base
echo "done. all stage branches rebuilt from ${PATCHES_DIR}/"
```

Note: `git format-patch` produces patches in `git am` format (with author/date/subject), so `git am` is the right replay command, not `git apply`.

---

## Appendix B — `README.md`

Place at `example_projects/Weather/workshop/README.md`.

```markdown
# Workshop — Weather demo branches

Eight git branches that prime the Weather example app for the Sentry workshop on Tuesday. See `../../../workshop-runbook.md` for the workshop flow and `BRANCH-BUILD-SPEC.md` for how the branches were built.

## Branches

All branched off `workshop/base` (pinned anchor). To switch acts:

| Act | Branch |
|---|---|
| Act I — Build & run | `stage/1-build-run-clean` |
| Act II — Feature add (start) | `stage/2-feature-start` |
| Act II — Feature add (reference) | `stage/2-feature-done` |
| Act III — Runtime crash (planted) | `stage/3-bug-planted` |
| Act III — Runtime crash (reference fix) | `stage/3-bug-fixed` |
| Act IV — Sentry install (start) | `stage/4-no-sentry` |
| Act IV — Sentry install (fallback) | `stage/4b-sentry-prewired` |
| Act IV — End-to-end trace | `stage/5-end-to-end` |

## Rebuilding from patches

If a branch gets corrupted or you tweak a patch:

    ./build-stages.sh

Run from the repo root. Recreates all `stage/*` branches off `workshop/base`.

## Pre-workshop config

Before the demo:

- Edit `Weather/Services/WeatherAPIClient.swift` on `stage/4-no-sentry`, `stage/4b-sentry-prewired`, `stage/5-end-to-end` — replace the placeholder backend URL.
- Replace the placeholder Sentry DSN in `Weather/WeatherApp.swift` on `stage/4b-sentry-prewired` and `stage/5-end-to-end`.
- Replace the placeholder dSYM auth token in the build phase script.

Look for `TODO[workshop]` markers — those are all the placeholders.
```

---

## Order of execution

Run stages in this order. Stop and confirm with the user between each.

1. Stage 0 (bootstrap)
2. Stage 1
3. Stage 2a → Stage 2b
4. Stage 3a → Stage 3b
5. Stage 4 → Stage 4b → Stage 5
6. Final verification

If anything is ambiguous, stop and ask. Don't improvise on the planted bugs — they're calibrated to the workshop's narrative.
