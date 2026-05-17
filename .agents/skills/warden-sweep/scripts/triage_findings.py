#!/usr/bin/env python3
"""Triage findings from warden-sweep reports.

This script reads extracted findings and applies severity-based triage logic
to prioritize which findings should become GitHub issues, be auto-patched,
or be dismissed based on configurable thresholds.
"""

import argparse
import sys
from pathlib import Path
from typing import Any

# Add scripts directory to path for shared utilities
sys.path.insert(0, str(Path(__file__).parent))
from _utils import read_json, write_json, read_jsonl, write_jsonl

# Severity ordering for comparison
SEVERITY_ORDER = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}

# Default triage thresholds
DEFAULT_ISSUE_THRESHOLD = "medium"   # Create issues for medium and above
DEFAULT_PATCH_THRESHOLD = "high"     # Auto-patch high and above
DEFAULT_DISMISS_BELOW = "low"        # Dismiss anything below low (i.e., info only)


def severity_rank(severity: str) -> int:
    """Return numeric rank for a severity string."""
    return SEVERITY_ORDER.get(severity.lower(), -1)


def triage_finding(
    finding: dict[str, Any],
    issue_threshold: str,
    patch_threshold: str,
    dismiss_below: str,
) -> dict[str, Any]:
    """Apply triage logic to a single finding.

    Returns the finding with an added 'triage' dict containing:
      - action: 'patch' | 'issue' | 'monitor' | 'dismiss'
      - reason: human-readable explanation
    """
    sev = finding.get("severity", "info").lower()
    rank = severity_rank(sev)

    if rank < severity_rank(dismiss_below):
        action = "dismiss"
        reason = f"Severity '{sev}' is below dismiss threshold '{dismiss_below}'"
    elif rank >= severity_rank(patch_threshold):
        action = "patch"
        reason = f"Severity '{sev}' meets auto-patch threshold '{patch_threshold}'"
    elif rank >= severity_rank(issue_threshold):
        action = "issue"
        reason = f"Severity '{sev}' meets issue-creation threshold '{issue_threshold}'"
    else:
        action = "monitor"
        reason = f"Severity '{sev}' is below issue threshold '{issue_threshold}'; monitor only"

    return {
        **finding,
        "triage": {
            "action": action,
            "reason": reason,
        },
    }


def triage_all(
    findings: list[dict[str, Any]],
    issue_threshold: str,
    patch_threshold: str,
    dismiss_below: str,
) -> list[dict[str, Any]]:
    """Triage a list of findings and return annotated results."""
    return [
        triage_finding(f, issue_threshold, patch_threshold, dismiss_below)
        for f in findings
    ]


def print_summary(triaged: list[dict[str, Any]]) -> None:
    """Print a concise triage summary to stdout."""
    counts: dict[str, int] = {"patch": 0, "issue": 0, "monitor": 0, "dismiss": 0}
    for f in triaged:
        action = f.get("triage", {}).get("action", "monitor")
        counts[action] = counts.get(action, 0) + 1

    print("\nTriage Summary")
    print("=" * 30)
    for action, count in counts.items():
        print(f"  {action:<10}: {count}")
    print(f"  {'total':<10}: {sum(counts.values())}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Triage warden-sweep findings and annotate with recommended actions."
    )
    parser.add_argument(
        "--findings",
        required=True,
        help="Path to findings JSONL file produced by extract_findings.py",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Path to write triaged findings JSONL",
    )
    parser.add_argument(
        "--issue-threshold",
        default=DEFAULT_ISSUE_THRESHOLD,
        choices=list(SEVERITY_ORDER.keys()),
        help="Minimum severity to create a GitHub issue (default: %(default)s)",
    )
    parser.add_argument(
        "--patch-threshold",
        default=DEFAULT_PATCH_THRESHOLD,
        choices=list(SEVERITY_ORDER.keys()),
        help="Minimum severity to trigger auto-patch (default: %(default)s)",
    )
    parser.add_argument(
        "--dismiss-below",
        default=DEFAULT_DISMISS_BELOW,
        choices=list(SEVERITY_ORDER.keys()),
        help="Dismiss findings below this severity (default: %(default)s)",
    )
    args = parser.parse_args()

    findings_path = Path(args.findings)
    if not findings_path.exists():
        print(f"ERROR: Findings file not found: {findings_path}", file=sys.stderr)
        sys.exit(1)

    findings = read_jsonl(findings_path)
    print(f"Loaded {len(findings)} findings from {findings_path}")

    triaged = triage_all(
        findings,
        issue_threshold=args.issue_threshold,
        patch_threshold=args.patch_threshold,
        dismiss_below=args.dismiss_below,
    )

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_jsonl(output_path, triaged)
    print(f"Wrote {len(triaged)} triaged findings to {output_path}")

    print_summary(triaged)


if __name__ == "__main__":
    main()
