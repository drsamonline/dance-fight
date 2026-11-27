#!/usr/bin/env python3
"""test-manifest.py — the refusals in tools/manifest.py, made permanent.

`record` and `claim` both refuse the same four things: split provenance for
byte-identical files, a locked repository, and reclassifying a protected entry,
each overridable by an explicit --force. Those rules were verified by hand in
throwaway clones, so a refactor could reopen one of them and nothing would say
so until a generator wrote through it.

Every case below builds a throwaway git repo, copies in the shipped
tools/manifest.py, and drives its real command line. No dependencies, no
network, deterministic: the same tool always produces the same verdict.

    python3 tools/test-manifest.py
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOL = HERE / "manifest.py"

checks = 0
failed = 0
repos: list[Path] = []


def ok(name: str, cond: bool, detail: str = "") -> None:
    global checks, failed
    checks += 1
    if cond:
        print("PASS " + name)
    else:
        failed += 1
        print("FAIL " + name + ("  — " + detail if detail else ""))


def make_repo() -> Path:
    """A committed repo with two byte-identical files and one unique file."""
    repo = Path(tempfile.mkdtemp(prefix="manifest-test-"))
    repos.append(repo)
    (repo / "tools").mkdir()
    shutil.copy2(TOOL, repo / "tools" / "manifest.py")
    (repo / "twin-a.txt").write_text("identical bytes\n", encoding="utf-8")
    (repo / "twin-b.txt").write_text("identical bytes\n", encoding="utf-8")
    (repo / "solo.txt").write_text("unique bytes\n", encoding="utf-8")
    git = ["git", "-C", str(repo)]
    subprocess.run(git + ["init", "-q"], check=True)
    commit(repo)
    return repo


def commit(repo: Path) -> None:
    git = ["git", "-C", str(repo), "-c", "user.email=t@t", "-c", "user.name=t",
           "-c", "commit.gpgsign=false"]
    subprocess.run(git + ["add", "-A"], check=True, capture_output=True)
    subprocess.run(git + ["commit", "-qm", "fixture"], check=True, capture_output=True)


def run(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "tools/manifest.py", *args],
                          cwd=repo, capture_output=True, text=True)


def manifest(repo: Path) -> dict:
    p = repo / "MANIFEST.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def snapshot(repo: Path) -> bytes | None:
    """Raw MANIFEST.json bytes, or None when it does not exist yet.

    Byte equality is the point: a refused run that rewrites the file at all has
    bumped `updated`, which is exactly the spurious diff this guards against.
    """
    p = repo / "MANIFEST.json"
    return p.read_bytes() if p.exists() else None


def entry(repo: Path, path: str) -> dict:
    return manifest(repo).get("files", {}).get(path, {})


def refused(r: subprocess.CompletedProcess, code: int, need: str = "") -> bool:
    return r.returncode == code and need in r.stderr


# ---- record: split provenance ---------------------------------------------

def test_record_split_class() -> None:
    repo = make_repo()
    run(repo, "record", "twin-a.txt", "--class", "hand", "--producer", "human")
    before = snapshot(repo)
    r = run(repo, "record", "twin-b.txt", "--class", "generated", "--producer", "human")
    ok("record: refuses a class split between byte-identical files",
       refused(r, 3, "byte-identical to twin-a.txt"), r.stderr.strip())
    ok("record: a refused split does not rewrite MANIFEST.json",
       snapshot(repo) == before)
    ok("record: a refused split leaves the path unrecorded",
       "twin-b.txt" not in manifest(repo).get("files", {}))


def test_record_split_producer() -> None:
    repo = make_repo()
    run(repo, "record", "twin-a.txt", "--class", "generated", "--producer", "agent")
    before = snapshot(repo)
    r = run(repo, "record", "twin-b.txt", "--class", "generated", "--producer", "human")
    ok("record: refuses a producer split between byte-identical files",
       refused(r, 3, "byte-identical to twin-a.txt"), r.stderr.strip())
    ok("record: a refused producer split does not rewrite MANIFEST.json",
       snapshot(repo) == before)


def test_record_matching_twin() -> None:
    repo = make_repo()
    run(repo, "record", "twin-a.txt", "--class", "generated", "--producer", "agent@raster")
    r = run(repo, "record", "twin-b.txt", "--class", "generated", "--producer", "agent@raster")
    ok("record: accepts a twin with the same class and producer",
       r.returncode == 0 and entry(repo, "twin-b.txt").get("producer") == "agent@raster",
       r.stderr.strip())


def test_record_split_force() -> None:
    repo = make_repo()
    run(repo, "record", "twin-a.txt", "--class", "hand", "--producer", "human")
    r = run(repo, "record", "twin-b.txt", "--class", "generated", "--producer", "agent", "--force")
    ok("record: --force overrides the split-provenance refusal",
       r.returncode == 0 and entry(repo, "twin-b.txt").get("class") == "generated",
       r.stderr.strip())


# ---- record: protected classes and partial runs ---------------------------

def test_record_protected() -> None:
    repo = make_repo()
    run(repo, "record", "solo.txt", "--class", "hand", "--producer", "human")
    before = snapshot(repo)
    r = run(repo, "record", "solo.txt", "--class", "generated", "--producer", "agent")
    ok("record: refuses to overwrite a protected class",
       refused(r, 4, "class=hand"), r.stderr.strip())
    ok("record: a protected refusal does not rewrite MANIFEST.json",
       snapshot(repo) == before and entry(repo, "solo.txt").get("class") == "hand")


def test_record_protected_force() -> None:
    repo = make_repo()
    run(repo, "record", "solo.txt", "--class", "canonical", "--producer", "agent")
    r = run(repo, "record", "solo.txt", "--class", "generated", "--producer", "agent", "--force")
    ok("record: --force overrides the protected-class refusal",
       r.returncode == 0 and entry(repo, "solo.txt").get("class") == "generated",
       r.stderr.strip())


def test_record_partial() -> None:
    repo = make_repo()
    run(repo, "record", "twin-a.txt", "--class", "hand", "--producer", "human")
    r = run(repo, "record", "twin-b.txt", "solo.txt", "--producer", "agent")
    files = manifest(repo).get("files", {})
    ok("record: a partly refused run keeps the recorded path and reports the refusal",
       r.returncode == 3 and "solo.txt" in files and "twin-b.txt" not in files,
       f"exit {r.returncode}: {r.stderr.strip()}")


# ---- claim: split provenance ---------------------------------------------

def test_claim_split() -> None:
    repo = make_repo()
    run(repo, "record", "twin-a.txt", "--class", "hand", "--producer", "human")
    before = snapshot(repo)
    r = run(repo, "claim", "twin-b.txt", "--as", "generated")
    ok("claim: refuses a class split between byte-identical files",
       refused(r, 3, "byte-identical to twin-a.txt"), r.stderr.strip())
    ok("claim: a refused split does not rewrite MANIFEST.json",
       snapshot(repo) == before and "twin-b.txt" not in manifest(repo).get("files", {}))


def test_claim_split_force() -> None:
    repo = make_repo()
    run(repo, "record", "twin-a.txt", "--class", "hand", "--producer", "human")
    r = run(repo, "claim", "twin-b.txt", "--as", "generated", "--force")
    ok("claim: --force overrides the split-provenance refusal",
       r.returncode == 0 and entry(repo, "twin-b.txt").get("class") == "generated",
       r.stderr.strip())


# ---- claim: lock and protected classes -----------------------------------

def test_claim_locked() -> None:
    repo = make_repo()
    run(repo, "lock", "--reason", "test")
    before = snapshot(repo)
    r = run(repo, "claim", "solo.txt", "--as", "hand")
    ok("claim: refuses while the repo is locked", refused(r, 4, "repo is locked"),
       r.stderr.strip())
    ok("claim: a locked refusal does not rewrite MANIFEST.json",
       snapshot(repo) == before)


def test_claim_locked_force() -> None:
    repo = make_repo()
    run(repo, "lock", "--reason", "test")
    r = run(repo, "claim", "solo.txt", "--as", "hand", "--force")
    ok("claim: --force overrides the repo lock",
       r.returncode == 0 and entry(repo, "solo.txt").get("class") == "hand",
       r.stderr.strip())


def test_claim_canonical() -> None:
    repo = make_repo()
    run(repo, "record", "solo.txt", "--class", "canonical", "--producer", "agent")
    before = snapshot(repo)
    r = run(repo, "claim", "solo.txt", "--as", "generated")
    ok("claim: refuses to downgrade a canonical entry",
       refused(r, 4, "class=canonical"), r.stderr.strip())
    ok("claim: a canonical refusal does not rewrite MANIFEST.json",
       snapshot(repo) == before and entry(repo, "solo.txt").get("class") == "canonical")


def test_claim_canonical_force() -> None:
    repo = make_repo()
    run(repo, "record", "solo.txt", "--class", "canonical", "--producer", "agent")
    r = run(repo, "claim", "solo.txt", "--as", "generated", "--force")
    ok("claim: --force overrides the canonical refusal",
       r.returncode == 0 and entry(repo, "solo.txt").get("class") == "generated",
       r.stderr.strip())


def test_claim_same_class() -> None:
    repo = make_repo()
    run(repo, "record", "solo.txt", "--class", "hand", "--producer", "human")
    r = run(repo, "claim", "solo.txt", "--as", "hand")
    ok("claim: re-claiming a protected entry at the same class still works",
       r.returncode == 0 and entry(repo, "solo.txt").get("class") == "hand",
       r.stderr.strip())


def test_claim_promote() -> None:
    repo = make_repo()
    run(repo, "record", "solo.txt", "--class", "generated", "--producer", "agent")
    r = run(repo, "claim", "solo.txt", "--as", "hand")
    ok("claim: promoting a generated entry to hand needs no --force",
       r.returncode == 0 and entry(repo, "solo.txt").get("producer") == "human",
       r.stderr.strip())


# ---- check: the exit codes the refusals share ----------------------------

def test_check_codes() -> None:
    repo = make_repo()
    unrecorded = run(repo, "check", "solo.txt")
    run(repo, "record", "solo.txt", "--class", "hand", "--producer", "human", "--force")
    protected = run(repo, "check", "solo.txt")
    ok("check: an unrecorded path exits 3", unrecorded.returncode == 3,
       f"exit {unrecorded.returncode}")
    ok("check: a protected path exits 4", protected.returncode == 4,
       f"exit {protected.returncode}")

    repo2 = make_repo()
    run(repo2, "record", "solo.txt", "--producer", "agent")
    commit(repo2)
    clean = run(repo2, "check", "solo.txt")
    ok("check: a recorded, committed path exits 0", clean.returncode == 0,
       f"exit {clean.returncode}: {clean.stdout.strip()}")


def main() -> int:
    try:
        test_record_split_class()
        test_record_split_producer()
        test_record_matching_twin()
        test_record_split_force()
        test_record_protected()
        test_record_protected_force()
        test_record_partial()
        test_claim_split()
        test_claim_split_force()
        test_claim_locked()
        test_claim_locked_force()
        test_claim_canonical()
        test_claim_canonical_force()
        test_claim_same_class()
        test_claim_promote()
        test_check_codes()
    finally:
        for repo in repos:
            shutil.rmtree(repo, ignore_errors=True)

    print(f"\n{checks - failed}/{checks} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
