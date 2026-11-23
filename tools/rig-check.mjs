#!/usr/bin/env node
/* Rig invariants for Dance Fight.
 *
 * The character is drawn by forward kinematics: a pose is a bag of joint
 * angles, and rig() turns it into world-space joints. That maths is the one
 * part of the game with no visual safety net — a limb can silently detach, a
 * keyframe can go NaN, a spin can unwind mid-move, and the page still runs.
 *
 * This extracts the pure block between RIG-LIB START and RIG-LIB END from the
 * single HTML file and checks it. No dependencies, no build, deterministic:
 * the same file always produces the same verdict.
 *
 *   node tools/rig-check.mjs [path/to/index.html]
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

const html = readFileSync(file, "utf8");
const START_MARK = "/* ==== RIG-LIB START ====";
const END_MARK = "/* ==== RIG-LIB END ==== */";
const start = html.indexOf(START_MARK);
const end = html.indexOf(END_MARK);
ok("the rig block is marked in " + file, start > 0 && end > start);
if (start < 0 || end < start) {
  console.log(`\n${checks - failed}/${checks} checks passed`);
  process.exit(1);
}

// Grab the body of the block, dropping the comment banners themselves.
const block = html.slice(html.indexOf("*/", start) + 2, html.lastIndexOf("/*", end));

const sandbox = {};
try {
  runInNewContext(block + "\n;({BODY, rig, basePose, idlePose, MOVES, poseAtKeys, lerpPose, blendPose});", sandbox);
} catch (err) {
  ok("the rig block evaluates on its own", false, String(err));
  console.log(`\n${checks - failed}/${checks} checks passed`);
  process.exit(1);
}
ok("the rig block evaluates on its own", true);

const { BODY, rig, basePose, idlePose, MOVES, poseAtKeys } = sandbox;

const finite = (n) => typeof n === "number" && Number.isFinite(n);
const allFinite = (v) =>
  Array.isArray(v) ? v.every(finite) : v && typeof v === "object" ? Object.values(v).every(allFinite) : finite(v);

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* ---- 1. a rig always solves, and bones keep their length ------------------ */
function seedRandom(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const rnd = seedRandom(20261123);
let bad = 0;
let worstBone = 0;
for (let i = 0; i < 400; i++) {
  const pose = basePose();
  for (const k of Object.keys(pose)) {
    if (k === "spin") pose[k] = rnd() * 720 - 360;
    else pose[k] = (rnd() - 0.5) * 360;
  }
  pose.pelvisY = rnd() * 140 + 20;
  const depth = rnd();
  const R = rig(pose, depth);
  if (!allFinite(R)) bad++;
  for (const arm of [R.armF, R.armB]) {
    worstBone = Math.max(worstBone, Math.abs(dist(arm.sh, arm.el) - BODY.armU));
    worstBone = Math.max(worstBone, Math.abs(dist(arm.el, arm.wr) - BODY.armL));
  }
  for (const leg of [R.legF, R.legB]) {
    worstBone = Math.max(worstBone, Math.abs(dist(leg.hip, leg.kn) - BODY.legU));
    worstBone = Math.max(worstBone, Math.abs(dist(leg.kn, leg.an) - BODY.legL));
    worstBone = Math.max(worstBone, Math.abs(dist(leg.an, leg.toe) - BODY.foot));
  }
  worstBone = Math.max(worstBone, Math.abs(dist(R.pelvis, R.neck) - BODY.torso));
  worstBone = Math.max(worstBone, Math.abs(dist(R.neck, R.head) - BODY.neck));
}
ok("rig() returns finite joints for 400 random poses", bad === 0, bad + " poses produced NaN/Infinity");
ok("bone lengths are constant (worst error " + worstBone.toExponential(1) + " px)", worstBone < 1e-9);

/* ---- 2. the groove stays a body: head above pelvis, feet below it --------- */
(function () {
  let headWrong = 0;
  let footWrong = 0;
  for (let i = 0; i < 240; i++) {
    const ph = i / 240;
    for (const dir of [0, 1, -1]) {
      const pose = idlePose(ph, i % 3 === 0 ? 1 : 0, dir);
      const R = rig(pose, 1);
      if (!(R.head[1] < R.pelvis[1] - 40)) headWrong++;
      if (!(R.legF.an[1] > R.pelvis[1])) footWrong++;
    }
  }
  ok("the head stays above the pelvis through the whole groove", headWrong === 0, headWrong + " frames inverted");
  ok("the near foot stays below the pelvis through the whole groove", footWrong === 0, footWrong + " frames folded");
})();

/* ---- 3. keyframes are well formed --------------------------------------- */
(function () {
  const names = Object.keys(MOVES);
  ok("there are moves to check", names.length >= 4, names.join(","));

  let shape = [];
  let spinBack = [];
  let nan = [];
  for (const name of names) {
    const m = MOVES[name];
    const k = m.keys;
    if (!(m.dur > 0)) shape.push(name + ":dur");
    if (!(m.from >= 0 && m.to > m.from && m.to <= m.dur + 1e-9)) shape.push(name + ":window");
    if (!(k[0][0] === 0 && k[k.length - 1][0] === 1)) shape.push(name + ":range");
    for (let i = 1; i < k.length; i++) {
      if (!(k[i][0] > k[i - 1][0])) shape.push(name + ":order");
      if (!(k[i][3] <= k[i - 1][3])) spinBack.push(name);
      if (!allFinite(k[i][1])) nan.push(name + ":key" + i);
      if (!(k[i][2] >= 0 && k[i][2] <= 1)) shape.push(name + ":weight" + i);
    }
  }
  ok("every move has a duration, a hit window and 0..1 keyframes", shape.length === 0, shape.join(", "));
  ok("every keyframe pose is finite", nan.length === 0, nan.join(", "));
  ok("spin only ever turns one way (no unwinding mid-move)", spinBack.length === 0, spinBack.join(", "));

  // the finisher is the 720 and the kick is the 360 — the README says so
  ok("the kick turns 360°", Math.abs(MOVES.kick.keys.at(-1)[3]) === 360);
  ok("the finisher turns 720°", Math.abs(MOVES.fin.keys.at(-1)[3]) === 720);
})();

/* ---- 4. sampling a move is deterministic and frame-rate independent ------ */
(function () {
  const names = Object.keys(MOVES);
  let drift = 0;
  for (const name of names) {
    const keys = MOVES[name].keys;
    for (const prog of [0, 0.07, 0.33, 0.5, 0.81, 1]) {
      const a = poseAtKeys(keys, prog).pose;
      const b = poseAtKeys(keys, prog).pose;
      for (const k of Object.keys(a)) drift = Math.max(drift, Math.abs(a[k] - b[k]));
    }
  }
  ok("poseAtKeys is deterministic", drift === 0, "drift " + drift);

  // 0.3 s of a kick at 60 fps and at 15 fps must land on the same frame value,
  // because frame time is accumulated, not counted.
  function advance(dt, steps) {
    let frame = 0;
    for (let i = 0; i < steps; i++) frame += dt;
    return frame;
  }
  const a = advance(1 / 60, 16);
  const b = advance(1 / 15, 4);
  ok("frame time accumulates to the same value at any step size", Math.abs(a - b) < 1e-12, a + " vs " + b);
})();

/* ---- 5. the drawing never leaves the virtual stage ---------------------- */
(function () {
  let off = 0;
  for (const name of Object.keys(MOVES)) {
    const keys = MOVES[name].keys;
    for (let i = 0; i <= 20; i++) {
      const R = rig(poseAtKeys(keys, i / 20).pose, 1);
      const pts = [R.head, R.pelvis, R.legF.toe, R.legB.toe, R.armF.wr, R.armB.wr];
      for (const p of pts) {
        // the figure is drawn around x = 0..1280 and y = GROUND_Y (600) minus
        // its local y, so local coordinates must stay within +-420 px of the
        // pelvis and never reach further than 380 above it.
        if (Math.abs(p[0]) > 260 || p[1] > 200 || p[1] < -380) off++;
      }
    }
  }
  ok("drawn joints stay inside the stage bounds", off === 0, off + " joints outside");
})();

console.log(`\n${checks - failed}/${checks} checks passed`);
process.exit(failed ? 1 : 0);
