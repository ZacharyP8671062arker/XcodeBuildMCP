#!/usr/bin/env python3
"""Deduplicate findings across multiple sweep runs.

This script reads findings from the extracted JSONL output and removes
duplicate entries based on a stable fingerprint derived from the finding's
location, rule, and message. It preserves the highest-severity occurrence
when duplicates exist and writes a deduplicated findings file.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path
from typing import Any

# Allow running from the repo root or directly
sys.path.insert(0, str(Path(__file__).parent))
from _utils import read_jsonl, write_json, write_jsonl


SEVERITY_RANK: dict[str, int] = {
    "critical": 5,
    "high": 4,
    "medium": 3,
    "low": 2,
    "info": 1,
    "unknown": 0,
}


def fingerprint(finding: dict[str, Any]) -> str:
    """Return a stable hex fingerprint for a finding.

    The fingerprint is derived from:
    - rule_id  (the lint / static-analysis rule that fired)
    - file path (relative, to survive directory moves)
    - start line number
    - short message text (first 120 chars, lowercased)

    This is intentionally coarse so that trivial reformatting of a
    message does not create a new fingerprint.
    """
    rule_id = str(finding.get("rule_id") or finding.get("check_id") or "")
    path = str(finding.get("path") or finding.get("file") or "")
    line = str(finding.get("line") or finding.get("start", {}).get("line") or "0")
    message = (finding.get("message") or finding.get("extra", {}).get("message") or "")[:120].lower()

    raw = "|".join([rule_id, path, line, message])
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def severity_value(finding: dict[str, Any]) -> int:
    """Return numeric severity so we can keep the worst duplicate."""
    sev = (
        finding.get("severity")
        or finding.get("extra", {}).get("severity")
        or "unknown"
    ).lower()
    return SEVERITY_RANK.get(sev, 0)


def deduplicate(findings: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """Deduplicate *findings* and return (unique_findings, duplicate_count).

    When two findings share the same fingerprint the one with the higher
    severity is kept. Ties are broken by keeping the first occurrence.
    """
    seen: dict[str, dict[str, Any]] = {}
    duplicates = 0

    for finding in findings:
        fp = fingerprint(finding)
        if fp not in seen:
            # Annotate with the fingerprint so downstream scripts can use it
            seen[fp] = {**finding, "fingerprint": fp}
        else:
            duplicates += 1
            existing_sev = severity_value(seen[fp])
            new_sev = severity_value(finding)
            if new_sev > existing_sev:
                seen[fp] = {**finding, "fingerprint": fp}

    return list(seen.values()), duplicates


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Deduplicate warden-sweep findings.",
    )
    parser.add_argument(
        "input",
        nargs="+",
        type=Path,
        help="One or more JSONL findings files produced by extract_findings.py.",
    )
    parser.add_argument(
        "--output-jsonl",
        type=Path,
        default=Path("findings_deduped.jsonl"),
        help="Where to write the deduplicated JSONL (default: findings_deduped.jsonl).",
    )
    parser.add_argument(
        "--output-summary",
        type=Path,
        default=Path("dedup_summary.json"),
        help="Where to write a JSON summary of deduplication stats.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    all_findings: list[dict[str, Any]] = []
    for path in args.input:
        if not path.exists():
            print(f"[warn] input file not found, skipping: {path}", file=sys.stderr)
            continue
        batch = read_jsonl(path)
        print(f"[info] loaded {len(batch)} findings from {path}")
        all_findings.extend(batch)

    if not all_findings:
        print("[warn] no findings loaded — nothing to deduplicate.", file=sys.stderr)
        return 0

    unique, duplicate_count = deduplicate(all_findings)

    write_jsonl(args.output_jsonl, unique)
    print(
        f"[info] {len(all_findings)} total → {len(unique)} unique "
        f"({duplicate_count} duplicates removed) → {args.output_jsonl}"
    )

    summary = {
        "total_input": len(all_findings),
        "unique": len(unique),
        "duplicates_removed": duplicate_count,
        "input_files": [str(p) for p in args.input],
        "output_jsonl": str(args.output_jsonl),
    }
    write_json(args.output_summary, summary)
    print(f"[info] summary written to {args.output_summary}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
