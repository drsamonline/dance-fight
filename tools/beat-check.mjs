#!/usr/bin/env node
/* Beat analysis for Dance Fight.
 *
 * The offline analysis is the foundation under everything rhythmic: the dance
 * phase, the beat pulse and the PERFECT window are all read off the grid it
 * produces. Every way it can be wrong is silent — a tempo that is twice the
 * truth, a phase half a beat out, an intro treated as the first beat — and the
 * game still runs, it just never feels right.
 *
 * This lifts the shipped analyzeBuffer out of the single HTML file and drives it
 * with synthetic tracks whose tempo, first beat and intro are known exactly.
 * No dependencies, no build, deterministic: the same file always produces the
 * same verdict.
 *
 *   node tools/beat-check.mjs [path/to/index.html]
 */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
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
      if (depth === 0) {
        // keep the `async` in front of the name, or the body cannot await
        const lead = html.slice(Math.max(0, start - 6), start) === "async " ? start - 6 : start;
        return html.slice(lead, j + 1);
      }
    }
  }
  throw new Error("unbalanced " + name);
}

let analyze;
try {
  const src = extract("analyzeBuffer");
  // The page's only outside dependency is tickUI(), the promise that hands the
  // main thread back between stages. Here it is a resolved promise.
  const out = runInNewContext(
    "function tickUI() { return Promise.resolve(); }\n" + src + "\n;({analyzeBuffer});",
    {}
  );
  analyze = out.analyzeBuffer;
} catch (err) {
  ok("analyzeBuffer is present in " + file, false, String(err));
  summary();
}
ok("analyzeBuffer is present in " + file, true);

/* ---- synthetic tracks -----------------------------------------------------
   A kick is a decaying 55 Hz sine — exactly the band the analyser low-passes
   to. A quiet noise floor gives the flux something to rise from, the same way
   a real recording never sits at absolute zero. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function makeBuffer({ bpm = 120, seconds = 8, start = 0.05, intro = 0, sr = 44100, silent = false }) {
  const n = Math.floor(seconds * sr);
  const data = new Float32Array(n);
  const period = 60 / bpm;
  const kicks = [];
  if (!silent) {
    const rnd = seeded(20261123);
    for (let i = 0; i < n; i++) data[i] = (rnd() - 0.5) * 0.006;
    for (let t = intro + start; t < seconds - 0.15; t += period) {
      kicks.push(t);
      const from = Math.floor(t * sr);
      const len = Math.floor(0.18 * sr);
      for (let i = 0; i < len && from + i < n; i++) {
        const x = i / sr;
        data[from + i] += Math.sin(2 * Math.PI * 55 * x) * Math.exp(-x * 18) * 0.9;
      }
    }
  }
  return {
    sampleRate: sr,
    duration: seconds,
    length: n,
    numberOfChannels: 1,
    getChannelData: () => data,
    kicks,
    period,
  };
}

/* How far a returned grid phase sits from a known beat, in milliseconds, with
   the circular distance taken so a phase just before the first beat is not
   scored as a whole beat out. */
function gridErrMs(phase, start, period) {
  const d = start - phase;
  return Math.abs(d - Math.round(d / period) * period) * 1000;
}

const run = (opts) => analyze(makeBuffer(opts), () => {});

/* ---- 1. the tempo is recovered at the tempos the game advertises -------- */
for (const bpm of [100, 120, 150]) {
  const r = await run({ bpm });
  ok(bpm + " BPM is detected exactly", !!r && r.bpm === bpm, r ? "got " + r.bpm : "no grid");
  ok(bpm + " BPM: the grid lands on the first beat",
     !!r && gridErrMs(r.phase, 0.05, 60 / bpm) < 30,
     r ? gridErrMs(r.phase, 0.05, 60 / bpm).toFixed(1) + " ms out" : "no grid");
  ok(bpm + " BPM: a track that starts on the beat reports no intro", !!r && r.intro === 0,
     r ? "intro " + r.intro : "no grid");
}

/* ---- 2. the phase follows the track, not a fixed assumption ------------- */
{
  const r = await run({ bpm: 120, start: 0.37 });
  ok("a first beat off the zero point is found where it actually is",
     !!r && gridErrMs(r.phase, 0.37, r.period) < 30,
     r ? gridErrMs(r.phase, 0.37, r.period).toFixed(1) + " ms out" : "no grid");
}

/* ---- 3. every kick in the track agrees with the returned grid ----------- */
{
  const track = makeBuffer({ bpm: 128 });
  const r = await analyze(track, () => {});
  const worst = r
    ? Math.max(...track.kicks.map((t) => gridErrMs(r.phase, t, r.period)))
    : Infinity;
  ok("every kick sits within one hop of the grid", worst < 25,
     isFinite(worst) ? worst.toFixed(1) + " ms worst" : "no grid");
}

/* ---- 4. a silent intro is measured, and the grid still fits the beat ---- */
{
  const r = await run({ bpm: 120, intro: 2.0, start: 0.05 });
  ok("a two-second lead-in is reported as an intro",
     !!r && r.intro > 1.9 && r.intro < 2.15, r ? "intro " + r.intro : "no grid");
  ok("the intro does not move the grid off the beat",
     !!r && gridErrMs(r.phase, 2.05, 60 / 120) < 35,
     r ? gridErrMs(r.phase, 2.05, 60 / 120).toFixed(1) + " ms out" : "no grid");
}

/* ---- 5. material it cannot use is refused, not guessed ------------------ */
{
  const short = await run({ seconds: 1.2 });
  ok("a clip under two seconds returns no grid", short === null, JSON.stringify(short));
  const silent = await run({ silent: true });
  ok("silence returns no grid", silent === null, JSON.stringify(silent));
}

/* ---- 6. the same input always gives the same grid ----------------------- */
{
  const opts = { bpm: 140 };
  const a = await run(opts);
  const b = await run(opts);
  ok("analysis is deterministic", JSON.stringify(a) === JSON.stringify(b),
     JSON.stringify(a) + " vs " + JSON.stringify(b));
}

summary();
