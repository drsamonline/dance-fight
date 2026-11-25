#!/usr/bin/env python3
"""manifest-gate.py — fail CI when MANIFEST.json disagrees with the commit.

`tools/manifest.py check` short-circuits hand- and agent-class entries to
"protected" (exit 4) before it ever compares shas, so a protected file can
drift for months without the check ever saying so. This gate runs the check on
every path recorded in MANIFEST.json and decides for itself:

  clean      -> pass
  protected  -> pass only when manifest, HEAD and worktree blobs are identical
  anything   -> fail (unrecorded, deleted, uncommitted, committed-drift, locked,
                new)

Run from the repo root; exit 0 means the manifest matches the checkout.
"""
from __future__ import annotations

import json
import subprocess
import sys

MANIFEST = "MANIFEST.json"
CHECK = "tools/manifest.py"
PASS_STATUSES = {"clean", "protected"}
# manifest.py's own verdict codes; anything else is a hard error, not a verdict.
VERDICT_CODES = {0, 3, 4}


def repo_root() -> str:
    r = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("manifest-gate: not a git checkout")
    return r.stdout.strip()


def manifest_paths(root: str) -> list[str]:
    with open(f"{root}/{MANIFEST}", encoding="utf-8") as fh:
        data = json.load(fh)
    paths = list(data.get("files", {}))
    if not paths:
        sys.exit(f"manifest-gate: {MANIFEST} records no paths")
    return paths


def run_check(root: str, paths: list[str]) -> tuple[int, list[dict]]:
    r = subprocess.run([sys.executable, CHECK, "check", *paths],
                       capture_output=True, text=True, cwd=root)
    if r.returncode not in VERDICT_CODES:
        sys.exit(f"manifest-gate: {CHECK} failed (exit {r.returncode}):\n{r.stderr}")
    rows = []
    for line in r.stdout.splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return r.returncode, rows


def main() -> int:
    root = repo_root()
    paths = manifest_paths(root)
    _, rows = run_check(root, paths)

    seen = {row["path"] for row in rows}
    missing = [p for p in paths if p not in seen]
    failures: list[str] = []

    if missing:
        failures.append(f"check reported nothing for: {', '.join(missing)}")

    for row in rows:
        path = row["path"]
        status = row.get("status")
        m, c, w = row.get("manifest_sha"), row.get("committed_sha"), row.get("worktree_sha")
        if status not in PASS_STATUSES:
            failures.append(f"{path}: {status}")
            continue
        if m is None or c is None or w is None:
            failures.append(f"{path}: {status} but a sha is missing "
                            f"(manifest={m}, committed={c}, worktree={w})")
            continue
        if not (m == c == w):
            failures.append(f"{path}: {status} entry does not match the checkout "
                            f"(manifest={m[:12]}, committed={c[:12]}, worktree={w[:12]})")

    checked = len(rows)
    if failures:
        print(f"manifest-gate: {len(failures)} problem(s) across {checked} manifest path(s)",
              file=sys.stderr)
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        print("Record the current blobs with `python3 tools/manifest.py record "
              "--class <class> --producer <who> <paths>` in the same commit as the "
              "change they describe.", file=sys.stderr)
        return 1

    print(f"manifest-gate: {checked} manifest path(s) match the checkout")
    return 0


if __name__ == "__main__":
    sys.exit(main())
