#!/usr/bin/env python3
"""
run_sweep.py — Orchestrator for the full Warden sweep pipeline.

Runs each pipeline stage in order:
  1. extract_findings  — parse build/test logs into structured findings
  2. triage_findings   — assign severity + disposition to each finding
  3. generate_report   — produce summary markdown + report JSON
  4. find_reviewers    — identify relevant code owners / authors
  5. create_issue      — open a GitHub issue with the final report

Usage:
    python run_sweep.py [--log-dir <path>] [--output-dir <path>] [--dry-run]
"""

import argparse
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Local imports (all scripts live in the same directory)
# ---------------------------------------------------------------------------
from _utils import run_cmd, write_json, read_json
import extract_findings
import triage_findings
import generate_report
import find_reviewers
import create_issue

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
DEFAULT_LOG_DIR = "logs"
DEFAULT_OUTPUT_DIR = "warden-output"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the full Warden sweep pipeline."
    )
    parser.add_argument(
        "--log-dir",
        default=DEFAULT_LOG_DIR,
        help=f"Directory containing .jsonl build/test log files (default: {DEFAULT_LOG_DIR})",
    )
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help=f"Directory where pipeline artefacts are written (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip the GitHub issue creation step (useful for local testing)",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip stages whose output files already exist in --output-dir",
    )
    return parser.parse_args()


def stage(name: str) -> None:
    """Print a clearly visible stage header to stdout."""
    bar = "=" * 60
    print(f"\n{bar}")
    print(f"  STAGE: {name}")
    print(f"{bar}")


def elapsed(start: float) -> str:
    secs = time.monotonic() - start
    return f"{secs:.1f}s"


def main() -> int:
    args = parse_args()

    log_dir = Path(args.log_dir)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    findings_path = out_dir / "findings.jsonl"
    triaged_path = out_dir / "triaged.jsonl"
    report_json_path = out_dir / "report.json"
    report_md_path = out_dir / "report.md"
    reviewers_path = out_dir / "reviewers.json"

    pipeline_start = time.monotonic()

    # ------------------------------------------------------------------
    # 1. Extract findings
    # ------------------------------------------------------------------
    stage("1 / 5 — extract_findings")
    t = time.monotonic()
    if args.skip_existing and findings_path.exists():
        print(f"  [skip] {findings_path} already exists")
    else:
        count = extract_findings.main(
            log_dir=str(log_dir),
            output_path=str(findings_path),
        )
        print(f"  Extracted {count} finding(s) → {findings_path}  ({elapsed(t)})")

    # ------------------------------------------------------------------
    # 2. Triage findings
    # ------------------------------------------------------------------
    stage("2 / 5 — triage_findings")
    t = time.monotonic()
    if args.skip_existing and triaged_path.exists():
        print(f"  [skip] {triaged_path} already exists")
    else:
        stats = triage_findings.main(
            input_path=str(findings_path),
            output_path=str(triaged_path),
        )
        triage_findings.print_summary(stats)
        print(f"  Triaged findings → {triaged_path}  ({elapsed(t)})")

    # ------------------------------------------------------------------
    # 3. Generate report
    # ------------------------------------------------------------------
    stage("3 / 5 — generate_report")
    t = time.monotonic()
    if args.skip_existing and report_json_path.exists():
        print(f"  [skip] {report_json_path} already exists")
    else:
        generate_report.main(
            input_path=str(triaged_path),
            report_json=str(report_json_path),
            report_md=str(report_md_path),
        )
        print(f"  Report written → {report_md_path}  ({elapsed(t)})")

    # ------------------------------------------------------------------
    # 4. Find reviewers
    # ------------------------------------------------------------------
    stage("4 / 5 — find_reviewers")
    t = time.monotonic()
    if args.skip_existing and reviewers_path.exists():
        print(f"  [skip] {reviewers_path} already exists")
    else:
        reviewers = find_reviewers.main(
            findings_path=str(triaged_path),
            output_path=str(reviewers_path),
        )
        print(f"  Found {len(reviewers)} reviewer(s) → {reviewers_path}  ({elapsed(t)})")

    # ------------------------------------------------------------------
    # 5. Create GitHub issue
    # ------------------------------------------------------------------
    stage("5 / 5 — create_issue")
    t = time.monotonic()
    if args.dry_run:
        print("  [dry-run] Skipping GitHub issue creation.")
    else:
        issue_url = create_issue.main(
            report_json=str(report_json_path),
            report_md=str(report_md_path),
            reviewers_path=str(reviewers_path),
        )
        print(f"  Issue created → {issue_url}  ({elapsed(t)})")

    # ------------------------------------------------------------------
    # Done
    # ------------------------------------------------------------------
    print(f"\n✅  Warden sweep complete in {elapsed(pipeline_start)}.")
    print(f"   Artefacts in: {out_dir.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
