#!/usr/bin/env python3
"""Contrast gate for Dance Fight.

The game's theme block repaints every bare button with the accent colour, and
the ink for that surface has to be named explicitly. That is exactly the kind of
pairing that silently regresses: a colour gets tweaked, everything still looks
fine on the author's monitor, and one label drops under WCAG AA.

So this reads the shipped CSS, pulls the actual values out of it, and computes
the ratios. It is deliberately narrow — the handful of foreground/background
pairs the game actually paints — and it exits non-zero, so it can gate a commit.

    python3 tools/contrast.py [path/to/index.html]

No dependencies. Exits 0 when every pair passes, 1 otherwise.
"""
import re
import sys
from pathlib import Path

MIN_TEXT = 4.5    # WCAG AA, normal text
MIN_LARGE = 3.0   # WCAG AA, large text / non-text UI

HEX = re.compile(r"#([0-9a-fA-F]{6})\b")


def rgb(value, where):
    m = re.fullmatch(r"#([0-9a-fA-F]{6})", value.strip())
    if not m:
        raise SystemExit(f"{where}: expected a #rrggbb colour, got {value!r}")
    n = int(m.group(1), 16)
    return ((n >> 16) & 255, (n >> 8) & 255, n & 255)


def luminance(c):
    def channel(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(x) for x in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def rules(css):
    """Selector text -> declarations, for the simple flat rules in this file."""
    out = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
        out.append((m.group(1).strip(), m.group(2)))
    return out


def main():
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/play/index.html")
    if not path.exists():
        print(f"FAIL cannot find {path}")
        return 1
    html = path.read_text(encoding="utf-8")

    m = re.search(r'<style id="app-theme">(.*?)</style>', html, re.S)
    if not m:
        print("FAIL no <style id=\"app-theme\"> block in " + str(path))
        return 1
    # comments sit between rules and would otherwise be swallowed into the
    # following selector by the flat parser, so drop them first
    css = re.sub(r"/\*.*?\*/", "", m.group(1), flags=re.S)
    parsed = rules(css)

    def theme_vars(name):
        for sel, body in parsed:
            if sel == f'html[data-theme="{name}"]':
                acc = re.search(r"--acc:\s*(#[0-9a-fA-F]{6})", body)
                if acc:
                    return acc.group(1)
        return None

    def ink_rule(needle):
        for sel, body in parsed:
            if needle in sel and re.search(r"color:\s*#[0-9a-fA-F]{6}", body) and "button" in sel:
                return re.search(r"color:\s*(#[0-9a-fA-F]{6})", body).group(1), sel
        return None, None

    fallback = None
    for sel, body in parsed:
        if "button" in sel and "background" in body:
            fb = re.search(r"--acc,\s*(#[0-9a-fA-F]{6})", body)
            if fb:
                fallback = fb.group(1)
                break

    dark_acc = theme_vars("dark")
    light_acc = theme_vars("light")
    dark_ink, dark_sel = ink_rule('html[data-theme="dark"]')
    plain_ink, plain_sel = ink_rule("html:not([data-theme])")
    light_ink, light_sel = ink_rule('html[data-theme="light"]')

    problems = []

    def check(label, fg, bg, need, where):
        fgc, bgc = rgb(fg, label), rgb(bg, label)
        r = ratio(fgc, bgc)
        status = "PASS" if r >= need else "FAIL"
        print(f"{status} {label}: {fg} on {bg} = {r:.2f}:1 (needs {need}:1)")
        if r < need:
            problems.append(f"{label} ({where}) is {r:.2f}:1, needs {need}:1")

    # 1. the button repaint, in each of the three theme states
    if not plain_ink or not fallback:
        problems.append("could not find the unthemed button ink/fallback pair")
        print("FAIL unthemed button: ink or accent fallback missing from the CSS")
    else:
        check("button ink, no data-theme", plain_ink, fallback, MIN_TEXT, plain_sel)
    if not dark_ink or not dark_acc:
        problems.append("could not find the dark-theme button ink/accent pair")
        print("FAIL dark button: ink or --acc missing from the CSS")
    else:
        check("button ink, dark theme", dark_ink, dark_acc, MIN_TEXT, dark_sel)
    if not light_ink or not light_acc:
        problems.append("could not find the light-theme button ink/accent pair")
        print("FAIL light button: ink or --acc missing from the CSS")
    else:
        check("button ink, light theme", light_ink, light_acc, MIN_TEXT, light_sel)

    # 2. the HUD's coloured labels on the arena's near-black background
    stage = "#05010d"
    hud = {
        "player nameplate": "#63f7ff",
        "rival nameplate": "#ff9d4d",
        "move callout": "#ff4fd8",
        "on-beat tag": "#ffd23f",
        "hint text": "#b8fbff",
    }
    for label, colour in hud.items():
        check(label, colour, stage, MIN_LARGE, "HUD")

    print()
    if problems:
        print(f"{len(problems)} contrast problem(s):")
        for p in problems:
            print(" - " + p)
        return 1
    print("all contrast pairs pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
