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

Usage:
    python3 tools/manifest-gate.py            # every tracked file
    python3 tools/manifest-gate.py <paths...> # named paths instead, to spot-check

Coverage: the manifest is meant to describe every tracked file. The default run
compares `git ls-files` against MANIFEST.json and fails on any tracked path the
manifest does not record, so a new file cannot slip in unrecorded. The single
exemption is MANIFEST.json itself, which is the one file no manifest can hold a
sha for without changing that sha.

Run from the repo root; exit 0 means the manifest matches the checkout. A
malformed MANIFEST.json is reported as a one-line failure, not a traceback.
"""
from __future__ import annotations

import json
import subprocess
import sys
from typing import NoReturn

MANIFEST = "MANIFEST.json"
CHECK = "tools/manifest.py"
PASS_STATUSES = {"clean", "protected"}
# The manifest cannot record a sha for itself: writing the sha would change the
# sha. Every other tracked path must be recorded, so this is the only exemption.
EXEMPT = frozenset({MANIFEST})
# manifest.py's own verdict codes; anything else is a hard error, not a verdict.
VERDICT_CODES = {0, 3, 4}
# Why a path failed, so the log says what to fix without reading manifest.py.
NOTES = {
    "unrecorded": "exists in the checkout but has no MANIFEST.json entry",
    "deleted": "recorded, but missing from the checkout",
    "uncommitted": "worktree differs from HEAD",
    "committed-drift": "committed blob differs from the recorded sha",
    "locked": "repo or path is locked",
    "new": "absent from the checkout, so there is nothing to compare",
}


def die(msg: str) -> NoReturn:
    sys.exit(f"manifest-gate: {msg}")


def repo_root() -> str:
    r = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        die("not a git checkout")
    return r.stdout.strip()


def manifest_paths(root: str) -> list[str]:
    path = f"{root}/{MANIFEST}"
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        die(f"no {MANIFEST} at the repo root")
    except json.JSONDecodeError as exc:
        die(f"{MANIFEST} is not valid JSON "
            f"(line {exc.lineno}, column {exc.colno}: {exc.msg})")
    if not isinstance(data, dict):
        die(f"{MANIFEST} must be a JSON object, got {type(data).__name__}")
    files = data.get("files")
    if not isinstance(files, dict):
        die(f'{MANIFEST} has no "files" object')
    paths = list(files)
    if not paths:
        die(f"{MANIFEST} records no paths")
    return paths


def run_check(root: str, paths: list[str]) -> tuple[int, list[dict]]:
    r = subprocess.run([sys.executable, CHECK, "check", *paths],
                       capture_output=True, text=True, cwd=root)
    if r.returncode not in VERDICT_CODES:
        die(f"{CHECK} failed (exit {r.returncode}):\n{r.stderr}")
    rows = []
    for line in r.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            die(f"{CHECK} printed a line that is not JSON: {line[:120]}")
    return r.returncode, rows


def tracked_files(root: str) -> list[str]:
    r = subprocess.run(["git", "-C", root, "ls-files", "-z"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        die(f"git ls-files failed (exit {r.returncode}): {r.stderr.strip()}")
    return [p for p in r.stdout.split("\0") if p]


def short(sha) -> str:
    return "none" if sha is None else str(sha)[:12]


def main(argv: list[str] | None = None) -> int:
    root = repo_root()
    named = list(sys.argv[1:] if argv is None else argv)
    if named:
        paths = named
    else:
        paths = manifest_paths(root)
        recorded = set(paths)
        # Unrecorded tracked files are handed to check too, so they are reported
        # as "unrecorded" in the same words as any other failure.
        paths += [p for p in tracked_files(root)
                  if p not in recorded and p not in EXEMPT]
    _, rows = run_check(root, paths)

    seen = {row.get("path") for row in rows}
    missing = [p for p in paths if p not in seen]
    failures: list[str] = []

    if missing:
        failures.append(f"check reported nothing for: {', '.join(missing)}")

    for row in rows:
        path = row.get("path", "<unnamed row>")
        status = row.get("status")
        m, c, w = row.get("manifest_sha"), row.get("committed_sha"), row.get("worktree_sha")
        note = NOTES.get(status)
        if status not in PASS_STATUSES:
            failures.append(f"{path}: {status}" + (f" — {note}" if note else ""))
            continue
        if m is None or c is None or w is None:
            failures.append(f"{path}: {status} but a sha is missing "
                            f"(manifest={short(m)}, committed={short(c)}, "
                            f"worktree={short(w)})")
            continue
        if not (m == c == w):
            failures.append(f"{path}: {status} entry does not match the checkout "
                            f"(manifest={short(m)}, committed={short(c)}, "
                            f"worktree={short(w)})")

    checked = len(rows)
    if failures:
        print(f"manifest-gate: {len(failures)} problem(s) across {checked} checked path(s)",
              file=sys.stderr)
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        print("Record the current blobs with `python3 tools/manifest.py record "
              "--class <class> --producer <who> <paths>` in the same commit as the "
              "change they describe.", file=sys.stderr)
        return 1

    print(f"manifest-gate: {checked} path(s) match the checkout")
    return 0


if __name__ == "__main__":
    sys.exit(main())
