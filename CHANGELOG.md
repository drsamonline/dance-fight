# Changelog

## Unreleased

- **Latency calibration.** Tap the pad six times along with the groove and the median offset becomes the
  judgement window, so hits land where the player actually hears the beat. Also draggable by hand
  (−200…+200 ms), stored locally, and defaulting to zero so nothing changes for a player who never
  touches it.
- **A synthesised practice groove.** Kick, snare, hats and bass generated live at 100/120/128/140 BPM, with
  an exact beat grid, so the game has real audio and real rhythm with no file loaded.
- **Tempo re-lock.** `R` or the corner button re-analyses the next few bars and re-fits the grid from the
  playhead, for tracks that drift or a set that changes tempo.
- **Analysis progress.** The beat analysis now hands the main thread back between stages and reports
  through a bar under the drop zone instead of freezing silently.
- **Personal bests, difficulty and a share card.** Score, combo, perfects and wins persist on the device;
  the rival has Easy/Normal/Hard settings and telegraphs its wind-ups and guards; the end screen draws the
  result to a PNG.
- **Reduced motion and muted play.** `prefers-reduced-motion` drops shake, screen flash and trail ghosts;
  an optional pulse along the top of the screen marks every beat with the sound off.
- **Portrait framing.** Portrait now crops the empty sides of the arena and frames the dancers instead of
  shrinking the whole 16:9 stage into the window.
- **Installable and offline.** A web manifest and a network-first service worker cache the game and its
  icons.
- **Two dependency-free checks.** `tools/rig-check.mjs` (skeleton invariants extracted from the page) and
  `tools/contrast.py` (WCAG ratios read from the shipped CSS). Both exit non-zero.
- **README.** The run instructions now point at `docs/play/index.html` (the old `open index.html` opened a
  file that no longer exists), and the finisher has a generated motion strip.

## 1.0.0 — 2026-10-25

- **Licence: PolyForm Noncommercial 1.0.0.** Every repository now carries the canonical text
  from polyformproject.org with the Required Notice line, and the four places a repo states
  its licence agree: LICENSE, the SPDX headers, the README and package.json.
- **The public demo is the app.** A build now fails if `docs/play/index.html` is not the app,
  because a demo running older code is two code paths for one program.
