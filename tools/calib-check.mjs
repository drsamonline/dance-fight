#!/usr/bin/env node
/* Calibration and judgement maths for Dance Fight.
 *
 * The latency offset is the one number a player sets by feel, and nothing on
 * screen would look wrong if it were inverted, off by a sign, or computed from
 * the mean instead of the median. A wrong offset just makes every hit miss.
 *
 * This pulls the shipped isOnBeat / beatFractionNow / medianOf / applyOffset /
 * tapCalibrate functions out of the single HTML file and drives them with a
 * fake audio clock. No dependencies, no build, deterministic: the same file
 * always produces the same verdict.
 *
 *   node tools/calib-check.mjs [path/to/index.html]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || resolve(here, "../docs/play/index.html");

let checks = 0;
let failed = 0;
function ok(name, cond, detail) {
  checks++;
  if (cond) {
    console.log("PASS " + name);
  } else {
    failed++;
    console.log("FAIL " + name + (detail ? "  — " + detail : ""));
  }
}
const summary = () => {
  console.log(`\n${checks - failed}/${checks} checks passed`);
  process.exit(failed ? 1 : 0);
};

const html = readFileSync(file, "utf8");

/* Copy one named function out of the page, braces balanced. */
function extract(name) {
  const start = html.indexOf("function " + name + "(");
  if (start < 0) throw new Error("missing function " + name);
  const open = html.indexOf("{", start);
  let depth = 0;
  for (let j = open; j < html.length; j++) {
    if (html[j] === "{") depth++;
    else if (html[j] === "}") {
      depth--;
      if (depth === 0) return html.slice(start, j + 1);
    }
  }
  throw new Error("unbalanced " + name);
}

let src;
try {
  src = ["isOnBeat", "beatFractionNow", "medianOf", "applyOffset", "tapCalibrate"].map(extract).join("\n");
} catch (err) {
  ok("the calibration functions are present in " + file, false, String(err));
  summary();
}
ok("the calibration functions are present in " + file, true);

/* ---- stubs and fake clock ---------------------------------------------------
   The page's own functions run unmodified; only the world around them is fake:
   a playhead the test moves by hand, and the handful of globals they touch. */
const PERIOD = 0.46875; // 128 BPM
let pos = 0; // seconds on the audio clock
const settings = { offsetMs: 0, difficulty: "normal", cue: false, bpm: 128 };
const beat = { phase: 0 };
const grid = { current: { period: PERIOD, phase: 0, bpm: 128 } };
let toasts = [];
let saves = 0;

const factory = new Function(
  "settings",
  "beat",
  "beatGridRef",
  "clock",
  "playing",
  `
  var beatGrid = beatGridRef.current;
  var SET_KEY = "k";
  var calibTaps = [];
  function playbackPos() { return clock.pos(); }
  function currentBPM() { return 128; }
  function saveStore() { clock.save(); }
  function syncTuneUI() {}
  function toast(m) { clock.toast(m); }
  function startSynth() {}
  var document = { getElementById: function () { return null; } };
  ${src}
  return {
    onBeat: isOnBeat, frac: beatFractionNow, tap: tapCalibrate,
    get taps() { return calibTaps; }, reset: function () { calibTaps = []; }
  };
`
);

let g;
try {
  g = factory(settings, beat, grid, {
    pos: () => pos,
    save: () => { saves++; },
    toast: (m) => toasts.push(m),
  }, true);
} catch (err) {
  ok("the calibration functions evaluate on their own", false, String(err));
  summary();
}
ok("the calibration functions evaluate on their own", true);

const setMs = (ms) => { pos = ms / 1000; };
const onBeat = (ms) => { setMs(ms); return g.onBeat(); };
const reset = () => { settings.offsetMs = 0; g.reset(); toasts = []; };

/* ---- 1. raw judgement window, offset 0 ------------------------------------ */
reset();
ok("offset 0: 0 ms is on beat", onBeat(0));
ok("offset 0: 40 ms late is on beat", onBeat(40));
ok("offset 0: 150 ms late is OFF beat", !onBeat(150));
ok("offset 0: 60 ms early is on beat", onBeat(-60));
ok("offset 0: 150 ms early is OFF beat", !onBeat(-150));

/* ---- 2. late taps calibrate positive, and then land ----------------------- */
reset();
for (let i = 0; i < 6; i++) { setMs(150); g.tap(); }
ok("late taps -> offset ~+150", settings.offsetMs === 150, "got " + settings.offsetMs);
ok("calibrated: the same 150 ms late tap is now on beat", onBeat(150));
ok("calibrated: 130 ms late is still on beat (window 150 +- 80)", onBeat(130));
ok("calibrated: 400 ms late is still OFF beat", !onBeat(400));
ok("calibrated: 40 ms late is outside the shifted window", !onBeat(40));
ok("calibrated: 200 ms early is outside it too", !onBeat(-200));

/* ---- 3. early taps calibrate negative, and then land ---------------------- */
reset();
for (let i = 0; i < 6; i++) { setMs(-100); g.tap(); }
ok("early taps -> offset ~-100", settings.offsetMs === -100, "got " + settings.offsetMs);
ok("calibrated: the same 100 ms early tap is now on beat", onBeat(-100));
ok("calibrated: 160 ms late is OFF beat", !onBeat(160));

/* ---- 4. wrap-around: a tap just BEFORE the beat reads early, not late ----- */
reset();
const justBefore = (PERIOD - 0.009) * 1000; // 9 ms before the next beat
for (let i = 0; i < 6; i++) { setMs(justBefore); g.tap(); }
ok("a tap 9 ms before the beat -> offset ~-10", settings.offsetMs === -10, "got " + settings.offsetMs);
ok("calibrated: that tap lands on beat", onBeat(justBefore));
ok("calibrated: a tap just AFTER the beat lands on beat", onBeat(0.002 * 1000));

/* ---- 5. median, not mean: one stray tap must not swing it ----------------- */
reset();
[150, 150, 150, 900, -900].forEach((ms) => { setMs(ms); g.tap(); });
ok("a stray outlier is ignored (median)", settings.offsetMs === 150, "got " + settings.offsetMs);

/* ---- 6. never calibrate on fewer than four taps --------------------------- */
reset();
setMs(150); g.tap();
setMs(150); g.tap();
ok("2 taps leave the offset alone", settings.offsetMs === 0);
ok("2 taps ask for more", /more/.test(toasts[toasts.length - 1] || ""), toasts.join(" | "));

/* ---- 7. the +-200 ms clamp ------------------------------------------------ */
reset();
for (let i = 0; i < 6; i++) { setMs(215); g.tap(); }
ok("215 ms late clamps to +200", settings.offsetMs === 200, "got " + settings.offsetMs);
ok("clamped: 215 ms late lands inside the window", onBeat(215));
ok("clamped: 420 ms late misses", !onBeat(420));

/* ---- 8. past half a beat reads as EARLY (nearest beat), documented -------- */
reset();
for (let i = 0; i < 6; i++) { setMs(240); g.tap(); }
ok("240 ms late at 128 BPM reads as early (-200)", settings.offsetMs === -200, "got " + settings.offsetMs);

/* ---- 9. muting must not stop the clock these read -------------------------
   The sound button used to stop the audio source, which froze the playhead and
   made every calibrated offset a no-op. It now drops the level on the master
   bus instead, so playback and the beat grid keep running with the sound off. */
let toggle = "";
try { toggle = extract("toggleMusic"); } catch (err) { toggle = ""; }
ok("muting keeps the audio clock running (no stopBuffer / stopSynth)", toggle !== "" && !/stop(Buffer|Synth)\(/.test(toggle), toggle ? "toggleMusic still stops playback" : "toggleMusic is missing");

summary();
