# Structured xcodebuild events plan

## Goal

Move every xcodebuild-backed tool in XcodeBuildMCP to a single structured streaming pipeline.

That pipeline must:

- parse xcodebuild output into structured events in real time
- stream those events immediately instead of waiting for command completion
- drive human-readable streaming output for MCP and CLI text mode
- drive streamed JSONL output for CLI JSON mode
- support manifest-driven next steps at the end of the stream

The source of truth is the structured event stream, not formatted text.

## Current status

As of March 20, 2026:

- shared xcodebuild event types, parser, run-state layer, and renderer set exist
- simulator, device, and macOS pure build tools use the pending pipeline model
- `build_run_macos` and `build_run_sim` are fully migrated to the canonical single-pipeline pattern
- CLI JSONL streaming exists for pipeline-backed tools
- MCP human-readable output is buffered from the same renderer family
- all error events (file-located and non-file) are grouped and rendered consistently

The remaining migration work is `build_run_device` and any test tool cleanup.

## Architecture principle

One model, one pipeline. Tools do not own rendering or formatting. They emit structured events into a shared pipeline, and the shared renderer family produces all user-visible output.

- CLI is a pure stream consumer
- MCP buffers the same streamed human-readable output and returns it in one final chunk
- there is no second presentation path that re-renders or replays final text after the stream

The only runtime difference is the output sink:

- CLI sink: stdout/stderr
- MCP sink: in-memory buffer returned as `ToolResponse.content`

Not the rendering logic.

## Requirements

These are requirements, not nice-to-haves.

### 1. All xcodebuild-derived tools use the same model

This applies to all tools whose primary execution path is xcodebuild-derived, including:

- simulator build tools
- simulator test tools
- device build tools
- device test tools
- macOS build tools
- macOS test tools
- any other tool that surfaces xcodebuild phases, warnings, errors, or summaries

### 2. Streaming is required

Tools must emit output as soon as they have meaningful state to report.

They should also emit an immediate startup event/output block before xcodebuild produces its first meaningful line. In most cases that startup output should echo the important input parameters so the caller can immediately see what is being attempted.

We do not want to wait until the end of execution and then dump a final result.

This matters for:

- agent responsiveness
- long-running builds
- package resolution visibility
- compile phase visibility
- test execution visibility
- reducing timeouts and dead-air during execution

### 3. MCP output changes too

The plan does require changing the output shape used by xcodebuild-backed MCP tools.

We do not need to preserve the current human-readable MCP output contract for these tools.

The MCP API contract is still the same:

- same tools
- same arguments
- same MCP transport

But the streamed output content from xcodebuild-backed tools can and should change.

### 4. CLI JSON output is streamed JSONL

CLI JSON output should be one mode only:

- streamed JSONL

We do not need multiple JSON modes like:

- final JSON blob
- JSON events
- NDJSON as a separate concept

For this plan, CLI JSON output means line-delimited streamed JSON events.

### 5. MCP remains human-readable

MCP should keep receiving human-readable streamed output.

It does not need a JSON mode.

The important point is that the human-readable MCP output must now be rendered from the same structured event stream that powers CLI JSONL and CLI text mode.

### 6. We are not building a full-screen UI

We are not building a full-screen terminal application.

The target is the hybrid streaming approach we already used successfully for the simulator test tool:

- live transient status updates where appropriate
- durable streamed lines for warnings, errors, failures, and summaries
- clear final summary output

Visual parity with Flowdeck matters less than data-model parity and responsiveness.

## Desired behavior

All xcodebuild-backed tools should expose the same kind of live milestones and diagnostics.

Examples:

- tool starts -> stream an immediate scoped start event with the key input params
- package resolution starts -> stream a structured status event
- compiling starts -> stream a structured status event
- warning found -> stream a structured warning event
- compiler error found -> stream a structured error event
- tests begin -> stream a structured status event
- test progress changes -> stream a structured progress event
- test failure found -> stream a structured failure event
- run completes -> stream a structured summary event
- next steps available -> stream a final next-steps event or final rendered next-steps block

## Output modes

## MCP mode

MCP mode should receive streamed human-readable output rendered from the structured event stream.

That includes:

- milestones
- warnings
- errors
- test progress
- summaries
- final next steps

## CLI text mode

CLI text mode should render the same stream into terminal-friendly output.

That includes:

- Clack-driven transient progress updates where useful
- durable diagnostics and summaries
- final next steps

## CLI JSON mode

CLI JSON mode should emit structured JSONL.

Each line is one event.

Example:

```json
{"type":"status","operation":"TEST","stage":"RESOLVING_PACKAGES","message":"Resolving Package Graph...","timestamp":"2026-03-17T08:27:34.175Z"}
{"type":"status","operation":"TEST","stage":"COMPILING","message":"Compiling...","timestamp":"2026-03-17T08:27:39.834Z"}
{"type":"status","operation":"TEST","stage":"RUN_TESTS","message":"Running tests...","timestamp":"2026-03-17T08:28:41.875Z"}
{"type":"test-progress","operation":"TEST","completed":7,"failed":0,"skipped":0,"timestamp":"2026-03-17T08:28:50.101Z"}
{"type":"summary","operation":"TEST","status":"FAILED","totalTests":21,"passedTests":20,"failedTests":1,"skippedTests":0,"durationMs":28080,"timestamp":"2026-03-17T08:28:59.000Z"}
```

## Architecture design

The architecture should be explicitly layered.

## Concrete architecture flow

This section describes the architecture using the actual components that exist in the codebase today.

The important shape is:

- one ordered event stream
- one run-state / aggregation layer
- one renderer family
- different sinks only at the end

The flow is linear until rendering:

```text
tool logic
-> startBuildPipeline(...)
-> XcodebuildPipeline
-> parser + run-state
-> ordered structured events
-> renderer fork
-> MCP buffer or CLI stdout
```

More concretely:

1. tool logic creates the pipeline with `startBuildPipeline(...)` from `src/utils/xcodebuild-pipeline.ts`
2. `startBuildPipeline(...)` creates an `XcodebuildPipeline` and emits the initial `start` event
3. raw `xcodebuild` stdout/stderr chunks are sent into `createXcodebuildEventParser(...)` from `src/utils/xcodebuild-event-parser.ts`
4. the parser emits structured events into `createXcodebuildRunState(...)` from `src/utils/xcodebuild-run-state.ts`
5. tool-owned events such as preflight, app-path, install, launch, and post-build errors also enter that same run-state through `pipeline.emitEvent(...)`
6. run-state dedupes, orders, aggregates, and forwards each accepted event to the configured renderers
7. renderers consume the same event stream:
   - `src/utils/renderers/mcp-renderer.ts`
   - `src/utils/renderers/cli-text-renderer.ts`
   - `src/utils/renderers/cli-jsonl-renderer.ts`
8. at finalize time, the pipeline emits the final summary and final next-steps event in the same stream order

### Mermaid diagram

```mermaid
flowchart LR
    A[Tool logic<br/>build_sim / build_run_sim / test_sim / etc.] --> B[startBuildPipeline<br/>src/utils/xcodebuild-pipeline.ts]

    B --> C[XcodebuildPipeline<br/>src/utils/xcodebuild-pipeline.ts]

    C --> D[createXcodebuildEventParser<br/>src/utils/xcodebuild-event-parser.ts]
    C --> E[createXcodebuildRunState<br/>src/utils/xcodebuild-run-state.ts]

    F[xcodebuild stdout/stderr] --> D
    G[tool-emitted events<br/>pipeline.emitEvent(...)] --> E

    D --> E

    E --> H[ordered structured event stream]

    H --> I[MCP renderer<br/>src/utils/renderers/mcp-renderer.ts]
    H --> J[CLI text renderer<br/>src/utils/renderers/cli-text-renderer.ts]
    H --> K[CLI JSONL renderer<br/>src/utils/renderers/cli-jsonl-renderer.ts]

    I --> L[mcpRenderer.getContent()]
    L --> M[ToolResponse.content]

    J --> N[process.stdout text stream]
    K --> O[process.stdout JSONL stream]
```

### Event order within one run

Within a single xcodebuild-backed tool run, the desired event order is:

```text
start
-> parsed xcodebuild milestones / diagnostics / progress
-> tool-emitted post-build notices or errors
-> summary
-> next-steps
```

That ordering matters because:

- summaries must describe the final known run state
- next steps must be rendered from the same shared stream
- MCP and CLI should differ only in sink behavior, not in event order or formatting ownership

## 1. xcodebuild execution layer

Responsibility:

- launch xcodebuild
- stream stdout/stderr chunks as they arrive
- support single-phase and multi-phase execution
- attach command context such as operation type and phase

Examples:

- `build`
- `test`
- `build-for-testing`
- `test-without-building`

This layer should not format user-facing output.

It should only execute commands and feed chunks into the parser pipeline.

## 2. structured event parser layer

Responsibility:

- consume stdout/stderr incrementally
- parse lines into semantic events
- emit events immediately when they are recognized
- combine parser-derived events with tool-emitted startup/context events

This is the core of the system.

It should understand:

- package resolution milestones
- compile/link milestones
- build warnings/errors
- test start
- test case progress
- test failures
- totals and summaries
- multi-phase continuation rules

This is where phase-aware behavior belongs.

For example, in a two-phase simulator test run:

- phase 1 may emit `RESOLVING_PACKAGES` and `COMPILING`
- phase 2 may continue directly into `RUN_TESTS`
- the parser/state model should avoid regressing the visible timeline back to an earlier stage unless the new run genuinely restarted

## 3. shared run-state / aggregation layer

Responsibility:

- maintain the current known state of the run
- dedupe and order milestones
- aggregate progress counts
- group failures and diagnostics
- compute final summary information
- retain enough state for end-of-run rendering

This layer exists so that renderers do not need to reconstruct state themselves.

Examples of tracked state:

- current operation
- echoed input params / initial tool context
- latest stage
- seen milestones
- warnings/errors
- discovered tests
- completed/failed/skipped counts
- failure details by target/test
- wall-clock duration
- final success/failure state

## 4. renderer layer

Responsibility:

- consume structured events plus shared run-state
- produce mode-specific output

Renderers required:

### MCP human-readable renderer

- turns events into streamed text blocks/items for MCP responses
- remains human-readable
- appends manifest-driven next steps at the end
- buffers the rendered stream so the final `ToolResponse.content` is just the captured stream output
- does not maintain a separate final formatting path

### CLI text renderer

- turns events into streamed terminal output
- uses Clack where transient updates help
- writes durable diagnostics as normal lines
- appends next steps at the end
- is the only text presentation path for CLI xcodebuild-backed tools
- does not rely on final `ToolResponse.content` replay

### CLI JSONL renderer

- serializes each structured event as one JSON line
- does not invent a separate event model
- appends next steps as structured final events or final rendered line events, depending on the chosen schema

## 5. tool integration layer

Responsibility:

- tool decides what command(s) to run
- tool provides context such as platform, build vs test, selectors, preflight data
- tool selects the shared xcodebuild execution pipeline
- tool does not own custom raw parsing logic

This is the layer where simulator/device/macOS differences belong.

## Canonical reference pattern to copy

The canonical reference implementations are:

- `src/mcp/tools/macos/build_run_macos.ts` — simplest build-and-run (no simulator/device steps)
- `src/mcp/tools/simulator/build_run_sim.ts` — build-and-run with simulator post-build steps (boot, install, launch)

Use these files as templates for remaining build-and-run migrations. Do not invent new patterns.

### Concrete API reference

#### Functions to use

| Function | Module | Purpose |
|---|---|---|
| `startBuildPipeline` | `src/utils/xcodebuild-pipeline.ts` | Create pipeline, emit start event |
| `executeXcodeBuildCommand` | `src/utils/build/index.ts` | Run xcodebuild with pipeline attached |
| `createPendingXcodebuildResponse` | `src/utils/xcodebuild-output.ts` | Return a pending response (ALL return paths) |
| `emitPipelineNotice` | `src/utils/xcodebuild-output.ts` | Emit post-build progress into pipeline |
| `emitPipelineError` | `src/utils/xcodebuild-output.ts` | Emit post-build failure into pipeline |
| `formatToolPreflight` | `src/utils/build-preflight.ts` | Format the front-matter preflight block |

#### Functions NOT to use in migrated tools

These are transitional helpers from the old architecture. Do not use them in newly migrated tools:

| Function | Why not |
|---|---|
| `finalizeBuildPhase` | Finalizes pipeline too early; build-and-run tools must keep the pipeline open through post-build steps |
| `createPostBuildError` | Appends content after pipeline finalization; use `emitPipelineError` + `createPendingXcodebuildResponse` instead |
| `appendStructuredEvents` | Appends events after finalization; emit events into the pipeline before finalization instead |
| `createCompletionStatusEvent` | Creates a status event outside the pipeline; use `tailEvents` in `createPendingXcodebuildResponse` instead |
| `finalizeBuildPipelineResult` | Old finalization path; use `createPendingXcodebuildResponse` which defers finalization to `postProcessToolResponse` |

### Canonical shape

For a normal build-and-run tool, the pattern to copy is:

1. call `startBuildPipeline(...)`
2. run `executeXcodeBuildCommand(..., started.pipeline)`
3. if build fails, return `createPendingXcodebuildResponse(started, buildResult, { errorFallbackPolicy: 'if-no-structured-diagnostics' })`
4. keep the same pipeline open for post-build steps
5. emit post-build progress with `emitPipelineNotice(...)` using `code: 'build-run-step'`
6. emit post-build failures with `emitPipelineError(...)` using `Failed to <action>: <detail>` message format
7. do not append success/error text after pipeline finalization
8. do not create a second status/completion event path outside the pipeline
9. return one `createPendingXcodebuildResponse(...)` with `tailEvents` for the success footer
10. let the shared finalization path own summary and final next-steps ordering

### Pending response lifecycle

The tool never finalizes the pipeline directly. Instead:

1. tool returns `createPendingXcodebuildResponse(started, response, options)` — this stores the pipeline in `_meta.pendingXcodebuild`
2. `postProcessToolResponse` in `src/runtime/tool-invoker.ts` detects the pending state via `isPendingXcodebuildResponse`
3. it resolves manifest-driven next-step templates against the response's `nextStepParams`
4. it calls `finalizePendingXcodebuildResponse` which finalizes the pipeline, emitting summary + tail events + next-steps in correct order
5. the finalized pipeline content becomes the final `ToolResponse.content`

Key options on `createPendingXcodebuildResponse`:

- `errorFallbackPolicy: 'if-no-structured-diagnostics'` — for build failures, only include raw xcodebuild output if the parser found no structured errors (avoids duplicating errors that are already in the grouped block)
- `tailEvents` — events emitted after the summary but before next-steps (used for the `build-run-result` footer notice)

### Minimal pseudocode pattern

```ts
const started = startBuildPipeline({
  operation: 'BUILD',
  toolName: 'build_run_<platform>',
  params: { scheme, configuration, platform, preflight: preflightText },
  message: preflightText,
});

const buildResult = await executeXcodeBuildCommand(..., started.pipeline);
if (buildResult.isError) {
  return createPendingXcodebuildResponse(started, buildResult, {
    errorFallbackPolicy: 'if-no-structured-diagnostics',
  });
}

// Post-build steps: emit notices for progress, errors for failures
emitPipelineNotice(started, 'BUILD', 'Resolving app path', 'info', {
  code: 'build-run-step',
  data: { step: 'resolve-app-path', status: 'started' },
});
// ... resolve ...
emitPipelineNotice(started, 'BUILD', 'App path resolved', 'success', {
  code: 'build-run-step',
  data: { step: 'resolve-app-path', status: 'succeeded', appPath },
});

emitPipelineNotice(started, 'BUILD', 'Launching app', 'info', {
  code: 'build-run-step',
  data: { step: 'launch-app', status: 'started', appPath },
});
// ... launch ...

if (!launchResult.success) {
  emitPipelineError(started, 'BUILD', `Failed to launch app ${appPath}: ${launchResult.error}`);
  return createPendingXcodebuildResponse(started, { content: [], isError: true });
}

return createPendingXcodebuildResponse(
  started,
  { content: [], isError: false, nextStepParams: { ... } },
  {
    tailEvents: [{
      type: 'notice',
      timestamp: new Date().toISOString(),
      operation: 'BUILD',
      level: 'success',
      message: 'Build & Run complete',
      code: 'build-run-result',
      data: { scheme, platform, target, appPath, bundleId, launchState: 'requested' },
    }],
  },
);
```

### Post-build step notices

Post-build workflow steps use structured `notice` events with specific codes:

**`build-run-step` notices** — drive transient CLI progress and durable MCP output:

```ts
emitPipelineNotice(started, 'BUILD', 'Resolving app path', 'info', {
  code: 'build-run-step',
  data: { step: 'resolve-app-path', status: 'started' },
});
```

Available step names are defined in `BuildRunStepName` in `src/types/xcodebuild-events.ts`:

- `resolve-app-path` — resolving the built app bundle path
- `resolve-simulator` — resolving simulator UUID from name
- `boot-simulator` — booting the simulator
- `install-app` — installing the app on simulator/device
- `extract-bundle-id` — extracting the bundle ID from the app
- `launch-app` — launching the app

To add new step names: extend `BuildRunStepName` in `src/types/xcodebuild-events.ts` and add the label in `formatBuildRunStepLabel` in `src/utils/renderers/event-formatting.ts`.

**`build-run-result` notice** — drives the execution-derived footer:

```ts
{
  type: 'notice',
  code: 'build-run-result',
  data: { scheme, platform, target, appPath, bundleId, launchState: 'requested' },
}
```

This renders as the tree-formatted footer after the summary. Only include execution-derived values (appPath, bundleId, processId). Do not repeat front-matter values (scheme, platform, configuration).

### Error message format convention

All post-build error messages emitted via `emitPipelineError` must use the format:

```
Failed to <action>: <detail>
```

Examples:

- `Failed to get app path to launch: Could not extract app path from build settings.`
- `Failed to boot simulator: Device not found`
- `Failed to install app on simulator: Permission denied`
- `Failed to launch app /path/to/MyApp.app: App crashed on launch`

Do not use `Error <doing thing>:` or other ad-hoc formats.

### Rules to preserve when copying this pattern

- keep the pipeline open until the tool genuinely knows the final state
- all user-visible post-build progress must become structured events
- use the pipeline as the only user-visible output path
- do not preserve legacy append/replay helpers “just in case”
- if a tool needs extra context, emit it as an event instead of formatting text later
- the tool function signature is `(params, executor) => Promise<ToolResponse>` — no `executeXcodeBuildCommandFn` injection parameter

## Locked human-readable output contract

The current `build_run_macos` CLI/MCP presentation is now the formatting contract to preserve.

This is not a suggestion. Future xcodebuild-backed build-and-run tools should copy this output structure unless there is a clear, user-approved reason to differ.

### Canonical success and failure flows

For xcodebuild-backed tools that follow the canonical human-readable contract, the output order is now locked.

Successful runs must render:

1. front matter
2. runtime state and durable diagnostics
3. summary
4. execution-derived footer
5. next steps

Failed runs must render:

1. front matter
2. runtime state and/or grouped diagnostics
3. summary

Failed structured xcodebuild runs must not render next steps.

### Canonical `build_run_macos` example

Happy path shape:

```text
🚀 Build & Run

  Scheme: MCPTest
  Project: example_projects/macOS/MCPTest.xcodeproj
  Configuration: Debug
  Platform: macOS

› Linking

✅ Build succeeded. (⏱️ 6.8s)
✅ Build & Run complete

  └ App Path: /tmp/xcodebuildmcp-macos-cli/Build/Products/Debug/MCPTest.app

Next steps:
1. Interact with the launched app in the foreground
```

Sad path — compiler error:

```text
🚀 Build & Run

  Scheme: MCPTest
  Project: example_projects/macOS/MCPTest.xcodeproj
  Configuration: Debug
  Platform: macOS

› Linking

Compiler Errors (1):

  ✗ unterminated string literal
    example_projects/macOS/MCPTest/ContentView.swift:16:18

❌ Build failed. (⏱️ 4.0s)
```

Sad path — non-file error (e.g. wrong scheme name, destination not found):

```text
🚀 Build & Run

  Scheme: CalculatorAPp
  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace
  Configuration: Debug
  Platform: iOS Simulator
  Simulator: iPhone 17

Errors (1):

  ✗ The workspace named "CalculatorApp" does not contain a scheme named "CalculatorAPp".

❌ Build failed. (⏱️ 2.7s)
```

Sad path — multi-line error (e.g. destination specifier not found):

```text
🚀 Build & Run

  Scheme: CalculatorApp
  Workspace: example_projects/iOS_Calculator/CalculatorApp.xcworkspace
  Configuration: Debug
  Platform: iOS Simulator
  Simulator: iPhone 22

Errors (1):

  ✗ Unable to find a device matching the provided destination specifier:
    { platform:iOS Simulator, name:iPhone 22, OS:latest }

❌ Build failed. (⏱️ 60.7s)
```

These examples are the template for future xcodebuild-backed tool UX.

### 1. Front matter is a durable section

The start/preflight block is durable and emitted once at the beginning of the run.

Its shape is:

1. one blank line before the heading
2. a heading line such as `🚀 Build & Run`
3. one blank line after the heading
4. indented detail lines such as scheme, project/workspace, configuration, platform

Those values are request/preflight values.

They belong in front matter, not in the final footer.

### 2. There is one visual boundary before runtime state

After front matter, there is one blank-line boundary before the runtime state begins.

For CLI text mode, that means the first active phase update must not be butted directly against the last front-matter detail line.

For MCP, the same sections are buffered in the same order. MCP does not get a different formatting model; it just buffers the rendered sections instead of streaming them live to stdout.

### 3. Interactive CLI runtime state is transient

In interactive CLI text mode:

- active phases use Clack-driven replace-in-place updates
- active build/test steps should not be emitted as a sequence of durable milestone lines while they are still in progress

Examples:

- `Compiling...`
- `Linking...`
- `Resolving app path...`
- `Launching app...`

This is the runtime-state area of the UI, not the durable log area.

### 4. Durable lines are reserved for lasting information

Durable streamed lines are appropriate for:

- warnings
- errors
- test failures
- completed workflow checkpoints when we want the final stream to retain them
- final summary
- final footer
- next steps

They are not the default for active phase updates in interactive CLI mode.

### 5. The final footer is execution-derived only

The footer after the summary should contain only values learned or confirmed during execution.

Examples of acceptable footer fields:

- app path
- bundle ID
- app ID
- process ID
- other runtime identifiers only if they were genuinely discovered during the run

Examples of fields that must not be repeated in the footer if they were already shown in front matter:

- scheme
- project/workspace path
- configuration
- platform
- target labels that are just restating the selected platform/context

This also means we should prefer showing concrete derived values directly in the footer instead of relegating them to hints or next steps when the tool already knows them.

For example:

- if the tool resolved the built app path, show it in the footer
- do not keep a redundant "get app path" next step just to restate a value we already computed

In other words:

- front matter = requested configuration
- runtime state = currently active work
- footer = execution-derived result data
- next steps = remaining actions the user may want to take next

### 6. Next steps are always last

The human-readable order for a completed run is:

1. front matter
2. runtime state / diagnostics
3. summary
4. execution-derived footer
5. next steps

Nothing should render after next steps for that run.

### 7. MCP uses the same semantics

MCP does not get a different presentation contract.

The only difference is the sink:

- CLI text writes live to stdout
- MCP buffers the same rendered sections into `ToolResponse.content`

That means formatting decisions should still be made once in the shared formatter/renderer family.

MCP is downstream of the same human-readable event stream contract. It does not justify different section ordering, different footer contents, or different sad-path formatting.

### 8. All errors get the same grouped rendering

ALL error events are grouped and rendered as a structured block before the summary, regardless of whether they are file-located compiler errors or non-file errors (toolchain, scheme-not-found, tool-emitted).

The renderers batch ALL error events and flush them as a single grouped section when the summary event arrives. There is no separate "immediate render" path for non-file errors.

Heading rules:

- If any error in the group has a file location: `Compiler Errors (N):`
- Otherwise: `Errors (N):`

Each error renders as:

- `  ✗ <message>` (first line)
- `    <location>` (if file-located)
- `    <continuation>` (if multi-line message, each subsequent line indented)

### 9. Error event `message` field must not include severity prefix

The `message` field on error events must contain the diagnostic text only, without `error:` or `fatal error:` prefix. The renderer adds the appropriate prefix when needed.

- Correct: `message: "unterminated string literal"`
- Wrong: `message: "error: unterminated string literal"`

The `rawLine` field preserves the original xcodebuild output verbatim. The parser (`parseBuildErrorDiagnostic` in `src/utils/xcodebuild-line-parsers.ts`) strips the severity prefix from `message` but keeps `rawLine` intact.

The parser also accumulates indented continuation lines after a build error into the same error event's `message` (newline-separated). This handles multi-line xcodebuild errors like destination-not-found.

### 10. JSON mode is not part of this contract

CLI JSON mode remains streamed JSONL of the structured event stream.

It should not be changed to mirror the human-readable section formatting.

## Expected deviations for tools that do more than build-and-run

Not every xcodebuild-backed tool is identical. Some tools need controlled deviations from the canonical build-and-run pattern.

### Test tools

Primary example:

- `src/utils/test-common.ts`

Test tools differ because they often need:

- `operation: 'TEST'` instead of `BUILD`
- test discovery events
- test progress events
- test failure events
- multi-phase execution such as `build-for-testing` then `test-without-building`
- minimum-stage continuation rules between phases

Those are valid deviations, but they should still preserve the same architectural rules:

- same parser layer
- same run-state layer
- same renderer family
- same single finalization ownership
- same summary -> next-steps ordering

What should differ for tests is event content and execution shape, not presentation ownership.

### Pure build tools

Examples:

- `src/mcp/tools/simulator/build_sim.ts`
- `src/mcp/tools/device/build_device.ts`
- `src/mcp/tools/macos/build_macos.ts`
- `src/mcp/tools/utilities/clean.ts`

These are simpler than the canonical build-and-run tool because they do not have install/launch steps.

Their valid simplification is:

- xcodebuild phase only
- no post-build notices beyond what is needed
- return pending response with manifest-driven next-step params

They still follow the same finalization contract.

### More complex build-and-run tools

Migrated examples:

- `src/mcp/tools/simulator/build_run_sim.ts` — simulator build-and-run (fully migrated)

Remaining:

- `build_run_device`

These need extra steps compared with `build_run_macos`, such as:

- simulator/device lookup
- boot/install/launch sequencing
- bundle ID extraction
- platform-specific next-step params

Those are valid workflow differences. They are handled by emitting more `build-run-step` notices into the same pipeline. They are not valid reasons to introduce a second output path, late content append logic, tool-specific final rendering, or replay of already-streamed output.

The correct adaptation is:

- keep the same pipeline structure
- emit more `notice` events with `code: 'build-run-step'` for each post-build step
- emit `error` events via `emitPipelineError` for post-build failures
- include execution-derived values in the `build-run-result` tail event
- finalize once at the end

## Event model

We need one shared event model that works for build and test tools.

Example direction:

```ts
type XcodebuildEvent =
  | {
      type: 'start';
      operation: 'BUILD' | 'TEST';
      toolName: string;
      params: Record<string, unknown>;
      message: string;
      timestamp: string;
    }
  | {
      type: 'status';
      operation: 'BUILD' | 'TEST';
      stage:
        | 'RESOLVING_PACKAGES'
        | 'COMPILING'
        | 'LINKING'
        | 'RUN_TESTS'
        | 'PREPARING_TESTS'
        | 'ARCHIVING'
        | 'COMPLETED'
        | 'UNKNOWN';
      message: string;
      timestamp: string;
    }
  | {
      type: 'warning';
      operation: 'BUILD' | 'TEST';
      message: string;
      location?: string;
      rawLine: string;
      timestamp: string;
    }
  | {
      type: 'error';
      operation: 'BUILD' | 'TEST';
      message: string;
      location?: string;
      rawLine: string;
      timestamp: string;
    }
  | {
      type: 'test-discovery';
      operation: 'TEST';
      total: number;
      tests: string[];
      truncated: boolean;
      timestamp: string;
    }
  | {
      type: 'test-progress';
      operation: 'TEST';
      completed: number;
      failed: number;
      skipped: number;
      timestamp: string;
    }
  | {
      type: 'test-failure';
      operation: 'TEST';
      target?: string;
      suite?: string;
      test?: string;
      message: string;
      location?: string;
      durationMs?: number;
      timestamp: string;
    }
  | {
      type: 'summary';
      operation: 'BUILD' | 'TEST';
      status: 'SUCCEEDED' | 'FAILED';
      totalTests?: number;
      passedTests?: number;
      failedTests?: number;
      skippedTests?: number;
      durationMs?: number;
      timestamp: string;
    }
  | {
      type: 'next-steps';
      steps: Array<{
        label?: string;
        tool?: string;
        workflow?: string;
        cliTool?: string;
        params?: Record<string, string | number | boolean>;
      }>;
      timestamp: string;
    };
```

The exact names can change, but the model needs these properties:

- shared across tools
- streamable
- usable by both human-readable and JSONL renderers
- expressive enough for current simulator test behavior and future build behavior

## Rollout plan

## Phase 1: define the shared event and run-state model

Deliverables:

- shared event types
- shared aggregated run-state/report types
- shared emitter/collector interfaces

Exit criteria:

- build and test use cases both fit the model
- multi-phase test execution fits the model cleanly

## Phase 2: factor current simulator test parsing into the shared pipeline

Deliverables:

- simulator test path emits shared events
- CLI text output is rendered from those events
- CLI JSON output emits JSONL from those events
- MCP human-readable output is rendered from those events

Exit criteria:

- simulator test no longer has a renderer-first architecture
- current simulator test UX is preserved or improved

## Phase 3: migrate xcodebuild-backed build tools

Deliverables:

- simulator build tools use the same event pipeline
- macOS build tools use the same event pipeline
- device build tools use the same event pipeline
- warnings/errors/milestones are consistent across them

Exit criteria:

- build tools stream live milestones and diagnostics
- CLI text and CLI JSONL stay in sync because they share the same source events

## Phase 4: migrate remaining test tools

Deliverables:

- device test tools use the shared event pipeline
- macOS test tools use the shared event pipeline
- grouped summaries and failure rendering are shared where possible

Exit criteria:

- no xcodebuild-backed test tool maintains a separate raw parsing stack

## Phase 5: remove legacy duplicated formatting paths

Deliverables:

- old ad hoc parser/formatter branches removed
- output logic reduced to shared renderers
- next steps still appended through manifest-driven logic at stream end

Exit criteria:

- xcodebuild-backed tools share one parsing model and one rendering model family

## Testing strategy

## Unit tests

- raw line to event parsing
- milestone ordering and dedupe
- warning/error parsing
- test-progress parsing
- failure parsing
- multi-phase continuation behavior

## Integration tests

- simulator build streams expected milestones
- simulator test streams expected milestones and failures
- CLI JSON mode emits valid JSONL in correct order
- MCP mode renders the same underlying run semantics in human-readable form

## Benchmark checks

Keep using the simulator benchmark harness to compare:

- wall-clock duration
- time to first streamed milestone
- time to first streamed test progress
- parity of surfaced information vs Flowdeck

## Design constraints

To keep this practical:

- no separate parser per tool unless the raw source is genuinely different
- no renderer-specific parsing logic
- no multiple JSON mode variants
- no buffering until completion when meaningful events are already known
- no attempt to preserve old MCP human-readable output shape for xcodebuild-backed tools

## Status against rollout phases

### Phase 1: define the shared event and run-state model

Status: complete

### Phase 2: factor current simulator test parsing into the shared pipeline

Status: complete

### Phase 3: migrate xcodebuild-backed build tools

Status: mostly complete

Notes:

- pure build tools (simulator, device, macOS, clean) all use the pending pipeline model
- `build_run_macos` and `build_run_sim` are fully migrated to the canonical single-pipeline pattern
- `build_run_device` still needs migration

### Phase 4: migrate remaining test tools

Status: mostly complete

Notes:

- simulator, device, and macOS test flows are on the shared pipeline
- the remaining work is mainly cleanup, consistency, and removing transitional replay behavior

### Phase 5: remove legacy duplicated formatting paths

Status: in progress

Notes:

- pure build, clean, and two build-and-run flows no longer depend on final replay/re-render formatting
- CLI final printing no-ops for fully migrated xcodebuild responses
- once `build_run_device` is migrated, the transitional helpers (`finalizeBuildPhase`, `createPostBuildError`, `appendStructuredEvents`, `createCompletionStatusEvent`) can be deleted

## Recommended immediate next steps

1. migrate `build_run_device` using the same canonical pattern as `build_run_sim`
2. delete transitional helpers once no tools depend on them
3. finish any remaining test tool cleanup

## Success criteria

This work is successful when:

- all xcodebuild-backed tools stream output as they learn new information
- MCP human-readable output and CLI text output are both rendered from the same structured source events
- CLI JSON mode streams JSONL from those same source events
- package resolution, compiling, warnings, errors, test progress, failures, and summaries are consistently surfaced across tools
- next steps are still appended at the end through manifest-driven logic
- future Flowdeck parity work happens by improving one shared event pipeline, not many separate formatter paths
