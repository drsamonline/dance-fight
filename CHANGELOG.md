# Changelog

## Unreleased

- **A tempo-independent judgement window.** The PERFECT window was a fraction of a beat (17%), so it was
  ~170 ms wide at 60 BPM and ~57 ms at 180 BPM — the same move counted as in time on a slow track and late
  on a fast one. It is now 80 ms of real time at any tempo, clamped to 8–26% of a beat, so "on beat" means
  the same thing all night.
- **Silent intros are skipped.** A count-in, a fade-up or an empty bar before the first beat is measured
  during analysis and reported ("first beat at 0:04"); playback starts there instead of making the player
  dance to silence, and the beat grid still lines up because the playhead adds the skip back.
- **The latency offset seeds itself.** On a device's first run the offset now starts from the audio
  context's own output-latency measurement instead of zero, with a toast saying so. A stored offset is
  never overwritten, and six taps still refine it.
- **An audio-state check.** The warning banner now names which silence it is — a suspended context, no
  source at all, or a dead signal — and tapping it restarts a track that stopped, not just the unlock.
  `window.danceFightAudio()` returns the same snapshot for anything that needs to ask.
- **A versioned offline cache.** The service worker names its cache after the build in its own URL, so a
  new build installs a fresh worker with an empty cache instead of serving the last build's HTML out of
  the old one; navigations are fetched with `no-store`, and an already-controlled page reloads once when
  the new worker takes over.
- **A fourth dependency-free check.** `tools/beat-check.mjs` lifts the shipped `analyzeBuffer` out of the
  page and runs it against synthesised tracks with a known tempo, first beat and silent intro: exact
  tempo at 100/120/150 BPM, the grid on the real first beat, intros measured rather than treated as beat
  one, silence and sub-two-second clips refused instead of guessed.

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
- **A track dropped mid-round actually starts.** Loading a file while the practice groove or another track
  was already playing swapped in the new beat grid but never started the new audio, so the fight danced on
  in silence and unmuting could not bring it back; the analysed buffer now goes straight to the bus.
- **Mute really mutes.** The sound button drops the level on the master bus instead of stopping playback,
  so muting no longer freezes the beat: the dance, the beat pulse and a calibrated latency offset all keep
  working with the sound off, and a muted run is no longer reported as "no sound coming through".
- **Three dependency-free checks.** `tools/rig-check.mjs` (skeleton invariants extracted from the page),
  `tools/calib-check.mjs` (the shipped calibration and judgement maths driven with a fake clock) and
  `tools/contrast.py` (WCAG ratios read from the shipped CSS). All three exit non-zero.
- **README.** The run instructions now point at `docs/play/index.html` (the old `open index.html` opened a
  file that no longer exists), and the finisher has a generated motion strip.

## 1.0.0 — 2026-10-25

- **Licence: PolyForm Noncommercial 1.0.0.** Every repository now carries the canonical text
  from polyformproject.org with the Required Notice line, and the four places a repo states
  its licence agree: LICENSE, the SPDX headers, the README and package.json.
- **The public demo is the app.** A build now fails if `docs/play/index.html` is not the app,
  because a demo running older code is two code paths for one program.
