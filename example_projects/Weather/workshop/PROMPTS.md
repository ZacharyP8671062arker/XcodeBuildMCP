# Workshop prompts

Canonical stripped-down prompts for each act. Paste verbatim into Claude Code
during the live demo — these mirror what a real workshop attendee would
naturally type, with no foreknowledge of where the bugs live or what the fix
shape is.

The agent has to discover the problem from the prompt + the running app +
LLDB / UI automation. That's the whole demo.

Branch and short-form numbering match act numbering. Each act has a `start`
branch (the live state) and a `done` reference branch the host can fall back
to if the agent derails.

---

## Act 1 — Setup XcodeBuildMCP

Branch: `stage/1-setup-start`
Run: `./workshop/switch-stage.sh 1`

```
Show me the current XcodeBuildMCP session defaults for this project.
```

Host-led: the host installs XcodeBuildMCP in Claude Code and creates the
project's `.xcodebuildmcp/config.yaml`. The start branch is `base` minus the
config file, so the host can demonstrate the install picking up an
unconfigured project. Once the config is in place, paste the prompt above —
the agent runs `session_show_defaults` and the audience sees the workshop's
defaults come back (Weather.xcodeproj, scheme Weather, iPhone 17 Pro,
`com.sentry.weather.Weather`). That proves the config was loaded.

The done state (`./workshop/switch-stage.sh 1-done`, which switches to
`base`) ships the config pre-filled. Use this if the host wants to skip the
live config-writing step.

---

## Act 2 — Build & run loop

Branch: `stage/2-build-run-clean`
Run: `./workshop/switch-stage.sh 2`

```
Build and run the Weather app on the iPhone 17 Pro simulator with --mock-weather-api.
```

The build will fail with a Swift compile error. The agent has to read the
diagnostic, locate the file, fix it, and rebuild — implicit in "build and run".
No "there's a bug somewhere" hint.

---

## Act 3 — Adding a feature: alerts toggle

Branch: `stage/3-feature-start`
Run: `./workshop/switch-stage.sh 3`

```
The "Severe weather alerts" toggle in Settings doesn't seem to do anything. Make it work — when alerts are enabled and the current condition is severe (thunderstorms or heavy rain), the user should see an alert banner near the top of the screen.
```

Frames the work as a user complaint plus a feature description. The agent has
to discover that `alertsEnabled` is currently bound but unconsumed, design the
banner component (matching the existing `WeatherLoadingBanner` visual style is
on them to spot), thread the state through, and verify by toggling in the
running simulator.

If the agent designs something wildly off-spec, fall back to `stage/3-feature-done`
as the reference solution.

---

## Act 4 — Frontend runtime crash (LLDB)

Branch: `stage/4-bug-planted`
Run: `./workshop/switch-stage.sh 4`

```
Attach the debugger to the Weather app, then browse each saved location and confirm the forecast loads cleanly.
```

The agent will tap through the saved locations one by one. The default
(San Francisco) loads fine. The crash fires the moment Reykjavík is selected:
the API returns `windDirectionDegrees: 360`, the iOS `WindDirection` model
asserts `degrees < 360` (half-open range), and the precondition trap fires.

The bug is **not** discoverable from iOS-side code review alone — every iOS
file uses `0..<360` consistently. The agent has to attach LLDB at the trap
site, inspect the `dto` value, see `windDirectionDegrees == 360`, and then
realize the API contract is `0...360` (closed) while the model assumes
`0..<360` (half-open). The fix is a contract translation in the DTO mapper.

Stack frame: `WeatherClientDTOs.swift` inside `CurrentWeather.init(dto:)`,
called from `WeatherReport.init(dto:)`. LLDB will show
`dto.windDirectionDegrees = 360` and `id = "weather-current-loc-is-reykjavik"`.

If the agent can't reproduce within ~90s, nudge gently:

```
Try Reykjavík specifically.
```

If still stuck, `stage/4-bug-fixed` is the reference solution. The fix
re-introduces a guard `(0...360).contains(...)` and normalizes `360 → 0`
before constructing `WindDirection`.

---

## Act 5 — Sentry end-to-end

Branch: `stage/5-canonical`
Run: `./workshop/switch-stage.sh 5`

The canonical app: `base` + the Act 3 alerts banner. Act 4's "fix" is identical
to base, so it adds no net diff — the canonical is just the working app with the
new feature folded in.

The canonical branch is intentionally clean of any Sentry wiring. Installing
the SDK, pointing the production `WeatherAPIConfiguration.baseURL` at the
workshop backend URL, and exercising the planted backend crash are all the
*live* work of Act 5 — owned by the separate host.

The backend service, its Sentry instrumentation, and the planted bug live
outside this repo.

No prompt here — when the host hands off to Act 5, attendees see this app
running cleanly and watch the host wire up Sentry on top.
