# Changelog

## Unreleased

- **The manifest refusals are a test, not a habit.** `record` and `claim` refuse split provenance between
  byte-identical files, a locked repo and reclassifying a protected entry, each overridable by `--force` —
  but that was only ever checked by hand in throwaway clones. `tools/test-manifest.py` now builds a repo per
  case, drives the shipped command line, and asserts the exit code and that a refused run leaves
  `MANIFEST.json` byte-identical, so a refusal that stops refusing fails a check instead of a generator.
- **Both arms survive every move, and read as arms.** The far arm's rim light was only ever checked in two frames
  of the finisher. `tools/frame-strip.mjs` samples every move against the groove — the pose the game actually
  resolves — and measures how much of the far arm is left once the torso, head and near limbs are drawn over it;
  it writes the whole set to `docs/assets/moves.svg` with both fighters. A 3 px rim sliver is not a readable arm,
  so it now demands a 7 px lit band and 160 px² of visible far arm, and measures the body with the same
  `SHAPE`/`TORSO` table the canvas draws from rather than a copy that can drift. That caught the Spinning Kick's
  wind-up and the Body-Roll Uppercut's recovery hanging the far arm inside the torso at profile: both now keep
  the back arm clear, and every sampled pose passes with a visible band of both arms.
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
- **Hits are judged at the keypress, not the frame.** Judgement used to read the playhead when the
  animation loop consumed the key, which quantises every hit to the frame rate — up to ±16 ms at 30 fps,
  a fifth of the window. A press now carries the audio-clock instant it happened (from the event's own
  `timeStamp`), so a slow device judges the same hit as a fast one.
- **GREAT is a real grade.** A hit between the PERFECT window and ~2.2× it is GREAT: 1.15× damage, still
  builds the combo, and says so in cyan. A `Strict` setting halves the window for rhythm veterans.
- **A timing report at the end of every round.** Each landed hit's signed distance from the beat becomes
  a 21-bar histogram and a median — "you land late" — with one button to apply it to the offset. The same
  median is live in the pause sheet.
- **Drift is mapped, not assumed.** Analysis now fits `t = a + b·k + c·k²` to the onsets. A
  machine-quantised song keeps the single grid the tests verify; a ramp or a live kit gets the tempo map,
  so bar 200 is as locked as bar 2. `beat-check` synthesises a 120→132 BPM ramp to prove it.
- **The drop is a game event.** Analysis reports the track's first sustained swell; when the playhead
  reaches it the rival presses for eight seconds, the meter jumps and the arena flashes (inside the flash
  limit). A track that never lifts reports no drop.
- **The rival attacks on the grid.** Its wind-ups are quantised to the next beat, so the fight reads as
  choreography instead of a second metronome — and blocking a beat-timed hit pays more meter.
- **Half / double time.** The tune panel can halve or double the grid's period, for the very common case
  of a track that locked to the right pulse at the wrong level.
- **Per-track memory.** A track's grid is keyed by file name and size, the file itself is kept in
  IndexedDB, and the start screen offers the last one back in one tap. Bests are per track too, so a song
  is a level. Six are kept, oldest evicted.
- **Rehearsal.** Loop four or eight bars from the first beat, at 0.75× or 0.5× with the pitch intact. The
  judgement window follows the rate, so practice transfers to full speed. `Esc` leaves, `P` pauses.
- **A real pause.** `P` stops the clock, the playhead and the rival — the context is suspended — with the
  offset slider live in the sheet. It used to only mute the music while the fight carried on behind it.
- **Remappable keys, limited flashes, haptics, safe areas.** Every action can be rebound (AZERTY, Dvorak,
  one hand); `Limited` caps the strobe and removes the white frame for photosensitivity; PERFECT hits buzz
  on Android; the HUD respects notches and home bars; combos and the result are announced to a live
  region for screen readers.
- **Analysis runs in a worker.** The DSP is pure, so the worker is built from the same function by
  stringifying it — one file, one copy of the algorithm — and the samples are handed over as a transferred
  mono mixdown. A long track no longer hitches the tab, and a browser that refuses the worker falls back
  to the same function inline.
- **Two more dependency-free checks.** `tools/fight-check.mjs` extracts the pure FIGHT-LIB maths plus the
  move and difficulty tables and simulates rounds: every round resolves, Easy < Normal < Hard, a sloppy
  player can still lose on Easy, and a normal round lasts 5–120 s. `tools/ver-check.mjs` fails when
  `APP_VER` stops matching the changelog's unreleased state, when the numeric version falls behind
  `VERSION`, or when the worker stops deriving its cache from `?v=`.

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
- **Both arms are always visible.** The far arm and leg were shaded like the near side and sank into the
  arena's near-black background, so a figure mid-turn read as a one-armed figure. The far side now carries a
  rim light, and its shoulder socket sits just outside the torso edge, so it has air to be seen in.
- **One exit from a round, one road back from the worker.** Pause, rehearsal and quit each cleared their own
  subset of the loop, the slowed rate and the pause sheet — which is how a track too short to loop left the
  page in rehearsal state on the start screen. They now clear through `leaveRoundMode()`, and the three
  copies of the inline-analysis fallback are one `inline()` that cannot run twice.

## 1.0.0 — 2026-10-25

- **Licence: PolyForm Noncommercial 1.0.0.** Every repository now carries the canonical text
  from polyformproject.org with the Required Notice line, and the four places a repo states
  its licence agree: LICENSE, the SPDX headers, the README and package.json.
- **The public demo is the app.** A build now fails if `docs/play/index.html` is not the app,
  because a demo running older code is two code paths for one program.
