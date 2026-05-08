#!/usr/bin/env bash
# Live-workshop helper: cleanly switch the working tree to a stage branch.
# Usage: ./switch-stage.sh <stage> [--copy]
#   where <stage> is one of:
#     1, 1-done, 2, 2-done, 3, 3-done, 4, 4-done, 5 (or canonical)
#   or a full branch name like stage/2-build-run-clean.
#   no args -> interactive arrow-key picker.
#   --copy: also pipe the prompt to the macOS clipboard via pbcopy.
#
# Why: between acts the working tree may have agent edits, the simulator
# DerivedData may be cached against the previous act's source, and the
# XcodeBuildMCP server resolves projectPath against this repo's cwd at
# tool-call time. Working in the main repo (not a worktree) keeps that
# resolution coherent. This script discards uncommitted edits, switches
# branch, wipes DerivedData so the next build runs cold, and prints the
# verbatim prompt to paste into Claude Code for that act.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel)"
cd "${REPO_ROOT}"

copy_to_clipboard="false"

# Full-screen arrow-key TTY picker. Sets $PICKED_INDEX to selected zero-based
# index, or -1 on quit. The picker fully repaints on each keypress (cursor home
# + clear-to-end) so it stays in place. Done-acts and the previous prompt area
# are passed in via globals: $DONE_INDICES (space-separated) and $LAST_PROMPT.
arrow_pick() {
    local title="$1"; shift
    local start_sel="$1"; shift
    local options=("$@")
    local n=${#options[@]}
    local sel=$start_sel
    if [[ $sel -lt 0 || $sel -ge $n ]]; then sel=0; fi
    local key

    tput civis >&2

    cleanup() { tput cnorm >&2; }
    trap 'cleanup; trap - INT; exit 130' INT

    while true; do
        {
            tput cup 0 0
            tput ed
            printf '\e[1m%s\e[0m\n\n' "$title"
            for i in "${!options[@]}"; do
                local style="" marker="    "
                if [[ $i -eq $sel ]]; then
                    style=$'\e[1;36m'; marker="  ▶ "
                elif [[ " $DONE_INDICES " == *" $i "* ]]; then
                    style=$'\e[2m'; marker="  ✓ "
                fi
                printf '%s%s%s\e[0m\n' "$style" "$marker" "${options[$i]}"
            done
            if [[ -n "$LAST_PROMPT" ]]; then
                printf '\n\e[2m─── last prompt (already copied to clipboard) ───\e[0m\n'
                printf '\e[36m%s\e[0m\n' "$LAST_PROMPT"
            fi
        } >&2

        IFS='' read -rsn1 key
        case "$key" in
            $'\x1b')
                read -rsn2 -t 0.01 key 2>/dev/null || true
                case "$key" in
                    '[A') sel=$(( (sel - 1 + n) % n )) ;;
                    '[B') sel=$(( (sel + 1) % n )) ;;
                esac
                ;;
            '')          break ;;       # Enter
            q|Q)         sel=-1; break ;;
        esac
    done

    cleanup
    trap - INT
    PICKED_INDEX=$sel
}

print_prompt() {
    case "$prompt_kind" in
        act1)
            cat <<'EOF'
Show me the current XcodeBuildMCP session defaults for this project.
EOF
            ;;
        act2)
            cat <<'EOF'
Build and run the Weather app on the iPhone 17 Pro simulator with --mock-weather-api.
EOF
            ;;
        act3)
            cat <<'EOF'
The "Severe weather alerts" toggle in Settings doesn't seem to do anything. Make it work — when alerts are enabled and the current condition is severe (thunderstorms or heavy rain), the user should see an alert banner near the top of the screen.
EOF
            ;;
        act4)
            cat <<'EOF'
Attach the debugger to the Weather app, then browse each saved location and confirm the forecast loads cleanly.
EOF
            ;;
        act5)
            cat <<'EOF'
(canonical app starting branch — the live host runs the Sentry act on top of this. No agent prompt here; Act 5 is owned by the separate host.)
EOF
            ;;
        reference)
            cat <<'EOF'
(reference solution branch — no prompt; narrate over the diff if the live act fails)
EOF
            ;;
        unknown)
            cat <<'EOF'
(unknown branch — see PROMPTS.md for the canonical prompts)
EOF
            ;;
    esac
}

# Resolve a short form / branch name into $branch and $prompt_kind globals.
resolve_branch() {
    case "$1" in
        1)            branch="stage/1-setup-start";       prompt_kind="act1" ;;
        1-done)       branch="base";                      prompt_kind="reference" ;;
        2)            branch="stage/2-build-run-clean";   prompt_kind="act2" ;;
        2-done)       branch="base";                      prompt_kind="reference" ;;
        3)            branch="stage/3-feature-start";     prompt_kind="act3" ;;
        3-done)       branch="stage/3-feature-done";      prompt_kind="reference" ;;
        4)            branch="stage/4-bug-planted";       prompt_kind="act4" ;;
        4-done)       branch="stage/4-bug-fixed";         prompt_kind="reference" ;;
        5|canonical)  branch="stage/5-canonical";         prompt_kind="act5" ;;
        base)                      branch="$1"; prompt_kind="reference" ;;
        stage/1-setup-start)       branch="$1"; prompt_kind="act1" ;;
        stage/2-build-run-clean)   branch="$1"; prompt_kind="act2" ;;
        stage/3-feature-start)     branch="$1"; prompt_kind="act3" ;;
        stage/3-feature-done)      branch="$1"; prompt_kind="reference" ;;
        stage/4-bug-planted)       branch="$1"; prompt_kind="act4" ;;
        stage/4-bug-fixed)         branch="$1"; prompt_kind="reference" ;;
        stage/5-canonical)         branch="$1"; prompt_kind="act5" ;;
        stage/*)      branch="$1"; prompt_kind="unknown" ;;
        *)
            echo "error: unknown stage '$1'" >&2
            return 1 ;;
    esac
}

# Switch the working tree to $branch, wipe DerivedData, print the prompt,
# and optionally copy to clipboard. Reads $branch, $prompt_kind, $copy_to_clipboard.
do_act() {
    if ! git rev-parse --verify "$branch" >/dev/null 2>&1; then
        echo "error: branch '$branch' does not exist." >&2
        echo "run ./workshop/build-stages.sh first." >&2
        return 1
    fi

    if [[ -d .git/rebase-apply || -d .git/rebase-merge ]]; then
        echo "error: in-progress rebase or git am detected." >&2
        echo "run 'git am --abort' or 'git rebase --abort' first." >&2
        return 1
    fi

    echo "=== switching to $branch ==="

    # Discard any uncommitted edits AND untracked files from the previous act
    # so git switch is clean. `git checkout` only handles tracked modifications;
    # `git clean -fd` removes untracked files (e.g. a config.yaml the host wrote
    # during Act 1) without touching gitignored build output.
    if [[ -n "$(git status --porcelain example_projects/Weather/)" ]]; then
        echo "discarding uncommitted changes from the previous act."
        git checkout -- example_projects/Weather/
        git clean -fd example_projects/Weather/ >/dev/null
        git reset HEAD --quiet 2>/dev/null || true
    fi

    git switch "$branch"

    # Wipe DerivedData for this workspace so the next build is cold and reliable.
    # XcodeBuildMCP's `clean` only runs `xcodebuild clean` which doesn't touch
    # DerivedData; rm -rf is the only way to force a true cold rebuild.
    local derived="$HOME/Library/Developer/XcodeBuildMCP/workspaces"
    if [[ -d "$derived" ]]; then
        local found
        found=$(find "$derived" -maxdepth 3 -type d -name 'Weather-*' 2>/dev/null || true)
        if [[ -n "$found" ]]; then
            echo "wiping DerivedData:"
            echo "$found" | sed 's/^/  /'
            echo "$found" | xargs rm -rf
        fi
    fi

    echo "done. on $branch with cold DerivedData."

    local prompt_text
    prompt_text="$(print_prompt)"

    echo
    echo "----- prompt to paste into Claude Code -----"
    echo "$prompt_text"
    echo "--------------------------------------------"

    if [[ "$copy_to_clipboard" == "true" ]]; then
        if command -v pbcopy >/dev/null 2>&1; then
            printf "%s" "$prompt_text" | pbcopy
            echo "(copied to clipboard via pbcopy)"
        else
            echo "(--copy requested but pbcopy not found; prompt left in stdout only)" >&2
        fi
    fi
}

if [[ $# -ge 1 ]]; then
    raw="$1"
    if [[ "${2:-}" == "--copy" ]]; then
        copy_to_clipboard="true"
    fi
    resolve_branch "$raw"
    do_act
else
    options=(
        "Act 1 — setup XcodeBuildMCP    (no config.yaml yet)"
        "Act 1 done                      (config.yaml present)"
        "Act 2 — build & run            (planted typo)"
        "Act 2 done                      (no typo)"
        "Act 3 — feature add             (start)"
        "Act 3 done                      (feature wired)"
        "Act 4 — runtime crash           (planted)"
        "Act 4 done                      (bug fixed)"
        "Act 5 — Sentry handoff          (canonical)"
    )
    shorts=(1 1-done 2 2-done 3 3-done 4 4-done 5)

    # Enter the alternate screen buffer so the picker doesn't pollute scrollback.
    # On exit (clean or signal) restore the original screen and cursor.
    tput smcup 2>/dev/null || true
    trap 'tput rmcup 2>/dev/null || true; tput cnorm 2>/dev/null || true' EXIT

    DONE_INDICES=""
    LAST_PROMPT=""
    last_pick=0
    copy_to_clipboard="true"  # default-on in interactive mode; pbcopy is harmless if no prompt

    while true; do
        arrow_pick "Pick an act (↑/↓ Enter, q to exit):" "$last_pick" "${options[@]}"
        if [[ $PICKED_INDEX -lt 0 ]]; then
            break
        fi
        raw="${shorts[$PICKED_INDEX]}"
        last_pick=$PICKED_INDEX
        case " $DONE_INDICES " in
            *" $PICKED_INDEX "*) ;;
            *) DONE_INDICES="${DONE_INDICES}${PICKED_INDEX} " ;;
        esac

        # Briefly leave the alt screen so the host can see what the script does
        # (branch switch, DerivedData wipe). Re-enter alt screen before redrawing.
        tput rmcup 2>/dev/null || true

        resolve_branch "$raw"
        if do_act; then
            LAST_PROMPT="$(print_prompt)"
        else
            LAST_PROMPT=""
        fi

        echo
        read -r -p "press Enter to return to the picker (q + Enter to exit): " next
        if [[ "$next" =~ ^[qQ] ]]; then
            trap - EXIT
            tput cnorm 2>/dev/null || true
            exit 0
        fi
        tput smcup 2>/dev/null || true
    done

    trap - EXIT
    tput rmcup 2>/dev/null || true
    tput cnorm 2>/dev/null || true
fi
