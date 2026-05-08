# Workshop — Weather demo branches

Run all commands from `example_projects/Weather/`. Prompts live in `PROMPTS.md`.

## One-time setup

    ./workshop/build-stages.sh

## Per act

Run the picker (no args) and pick an act with arrow keys:

    ./workshop/switch-stage.sh

Or pass a short form directly:

    ./workshop/switch-stage.sh 1     # Act 1 (setup XcodeBuildMCP, no config yet)
    ./workshop/switch-stage.sh 2     # Act 2 (build & run, planted typo)
    ./workshop/switch-stage.sh 3     # Act 3 (feature add, start)
    ./workshop/switch-stage.sh 4     # Act 4 (runtime crash, planted)
    ./workshop/switch-stage.sh 5     # Act 5 (Sentry handoff, canonical)

If an act derails, switch to the done state and narrate over the diff:

    ./workshop/switch-stage.sh 1-done   # Act 1 fallback (config.yaml present)
    ./workshop/switch-stage.sh 2-done   # Act 2 fallback (no typo)
    ./workshop/switch-stage.sh 3-done   # Act 3 fallback (feature wired)
    ./workshop/switch-stage.sh 4-done   # Act 4 fallback (bug fixed)
