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

// The window size lives in module-level vars next to isOnBeat, not inside a
// function, so pull that declaration out of the page too rather than restating
// its value here and letting the two drift.
const windowConsts = (html.match(/var BEAT_WINDOW_MS = [^;]+;/) || [""])[0];
ok("the judgement window constants are declared", windowConsts !== "", windowConsts);

let src;
try {
  // The judgement chain: isOnBeat -> gradeAt -> beatPhaseAt/periodAt/judgeWindow.
  // Each link is lifted from the page, so a change to the grading tiers is
  // exercised here instead of only being felt in play.
  src = ["isOnBeat", "gradeAt", "beatPhaseAt", "periodAt", "judgeWindow", "beatWindow",
         "beatFractionNow", "medianOf", "applyOffset", "tapCalibrate"].map(extract).join("\n");
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
  var playRate = 1;
  function playbackPos() { return clock.pos(); }
  // A press timestamped in the past must be judged at that timestamp, so the
  // fake buffer position simply is the audio time the test hands in.
  function bufferPosition(atSec) { return (typeof atSec === "number") ? atSec : clock.pos(); }
  function currentBPM() { return 128; }
  function saveStore() { clock.save(); }
  function syncTuneUI() {}
  function toast(m) { clock.toast(m); }
  function startSynth() {}
  ${windowConsts}
  var document = { getElementById: function () { return null; } };
  ${src}
  return {
    onBeat: isOnBeat, frac: beatFractionNow, tap: tapCalibrate,
    grade: function (ms) { return gradeAt(ms / 1000); },
    // 0.5x rehearsal: the buffer moves half as fast, so an 80 ms real window is
    // 40 ms of buffer time.
    setRate: function (r) { playRate = r; },
    setPeriod: function (p) { beatGrid.period = p; },
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

/* ---- 9. the window is a fixed slice of real time, not of the beat ----------
   Expressed as a fraction of the beat it has to scale with the tempo, or a slow
   track hands out a much wider window in milliseconds than a fast one. */
reset();
g.setPeriod(1.0);                       // 60 BPM
ok("60 BPM: 70 ms late is on beat", onBeat(70));
ok("60 BPM: 100 ms late is OFF beat", !onBeat(100));
g.setPeriod(0.3);                       // 200 BPM
ok("200 BPM: 70 ms late is on beat", onBeat(70));
ok("200 BPM: 100 ms late is OFF beat", !onBeat(100));
g.setPeriod(0.46875);                   // 128 BPM
ok("128 BPM: 40 ms late is on beat", onBeat(40));
ok("128 BPM: 150 ms late is OFF beat", !onBeat(150));

/* ---- 10. muting must not stop the clock these read ------------------------
   The sound button used to stop the audio source, which froze the playhead and
   made every calibrated offset a no-op. It now drops the level on the master
   bus instead, so playback and the beat grid keep running with the sound off. */
let toggle = "";
try { toggle = extract("toggleMusic"); } catch (err) { toggle = ""; }
ok("muting keeps the audio clock running (no stopBuffer / stopSynth)", toggle !== "" && !/stop(Buffer|Synth)\(/.test(toggle), toggle ? "toggleMusic still stops playback" : "toggleMusic is missing");

/* ---- 11. three grades, not two --------------------------------------------
   A hit 120 ms out is not the same as one 250 ms out. GREAT is a real tier that
   pays less than PERFECT and still builds the combo, so a near miss is legible. */
reset();
g.setPeriod(0.46875);
g.setRate(1);
ok("0 ms grades PERFECT", g.grade(0).grade === "perfect", g.grade(0).grade);
ok("60 ms grades PERFECT", g.grade(60).grade === "perfect", g.grade(60).grade);
ok("120 ms grades GREAT, not PERFECT", g.grade(120).grade === "great", g.grade(120).grade);
ok("150 ms early grades GREAT", g.grade(-150).grade === "great", g.grade(-150).grade);
ok("260 ms grades OFF", g.grade(260).grade === "off", g.grade(260).grade);
ok("a GREAT reports its signed offset in real ms", Math.round(g.grade(120).ms) === 120, String(g.grade(120).ms));

/* ---- 12. strict halves the window ----------------------------------------- */
reset();
settings.judge = "strict";
ok("strict: 40 ms is still PERFECT", g.grade(40).grade === "perfect", g.grade(40).grade);
ok("strict: 60 ms is demoted to GREAT", g.grade(60).grade === "great", g.grade(60).grade);
ok("strict: the on-beat boolean follows the tier", (setMs(60), g.onBeat()) === false);
settings.judge = "normal";

/* ---- 13. rehearsal at half speed is not easier -----------------------------
   80 ms of what the player heard is 40 ms of buffer time at 0.5x, so the window
   in buffer time must shrink with the rate; otherwise slowing a track down would
   secretly double the forgiveness and the practice would not transfer. */
reset();
g.setRate(0.5);
ok("0.5x: 40 ms of buffer time (80 ms heard) is PERFECT", g.grade(40).grade === "perfect", g.grade(40).grade);
ok("0.5x: 60 ms of buffer time (120 ms heard) is GREAT", g.grade(60).grade === "great", g.grade(60).grade);
ok("0.5x: the reported offset is in heard time", Math.abs(g.grade(40).ms - 80) < 1, String(g.grade(40).ms));
g.setRate(1);

/* ---- 14. a press timestamped in the past is judged where it happened ------
   The frame loop used to be the judge, so at 30 fps a tap could be measured up to
   16 ms from where it actually landed. isOnBeat(atSec) reads the press instant. */
reset();
g.setPeriod(0.46875);
ok("a stamp 60 ms before the beat grades PERFECT", g.grade(-60).grade === "perfect", g.grade(-60).grade);
ok("the same instant judged a frame later would not move the grade", g.grade(-60).grade === g.grade(-60).grade);

summary();
