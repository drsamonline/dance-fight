#!/usr/bin/env node
/* Every move, both fighters, and a check that neither arm disappears.
 *
 * The far arm is drawn behind the torso; only its rim light separates it from
 * the near-black stage. That fix was eyeballed in two frames of the finisher,
 * which is not a proof: a pose buried in the torso is a dark limb on a dark
 * body, and the figure reads one-armed. This samples every move — the blended
 * pose the game actually resolves, groove plus keyframe — and measures how much
 * of the far arm is left visible once everything drawn after it is laid over
 * the top. It then writes a strip of every move with both fighters so the result
 * can be looked at, not just trusted.
 *
 *   node tools/frame-strip.mjs [path/to/index.html] [out.svg]
 *
 * Exits non-zero if any sampled pose swallows an arm.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || resolve(here, "../docs/play/index.html");
const out = process.argv[3] || resolve(here, "../docs/assets/moves.svg");

const html = readFileSync(file, "utf8");
const start = html.indexOf("/* ==== RIG-LIB START ====");
const end = html.indexOf("/* ==== RIG-LIB END ==== */");
if (start < 0 || end < start) {
  console.error("rig block markers not found in " + file);
  process.exit(1);
}
const block = html.slice(html.indexOf("*/", start) + 2, html.lastIndexOf("/*", end));
const sandbox = {};
runInNewContext(block + "\n;({BODY, rig, basePose, idlePose, MOVES, poseAtKeys, lerpPose, blendPose});", sandbox);
const { BODY, rig, basePose, idlePose, MOVES, poseAtKeys, blendPose } = sandbox;

/* ---- the silhouette the far arm has to survive --------------------------- */

// Copied from the page: the torso every torso pass shares. Kept here rather
// than extracted because the shape is built with canvas calls; the constants
// are the part that can drift, so they are asserted against the page below.
const TORSO = { hip: 14.6, waist: 11.8, chest: 17.4, sh: 19.5, H: BODY.torso + 6 };
for (const [k, v] of Object.entries(TORSO)) {
  const m = html.match(new RegExp(`var TORSO = \\{[^}]*\\b${k}:\\s*([\\d.]+)`));
  if (m && Math.abs(parseFloat(m[1]) - v) > 1e-9) {
    console.error(`TORSO.${k} is ${m[1]} in the page but ${v} here — update the check`);
    process.exit(1);
  }
}

function torsoPoly(R) {
  const p = R.pelvis, d = R.dir, q = R.perp, H = TORSO.H;
  const pt = (t, w) => [p[0] + d[0] * H * t + q[0] * w, p[1] + d[1] * H * t + q[1] * w];
  const aF = pt(-0.06, TORSO.hip), aB = pt(-0.06, -TORSO.hip);
  const wF = pt(0.34, TORSO.waist), wB = pt(0.34, -TORSO.waist);
  const cF = pt(0.78, TORSO.chest), cB = pt(0.78, -TORSO.chest);
  const sF = pt(1.0, TORSO.sh), sB = pt(1.0, -TORSO.sh);
  const nF = [R.neck[0] + q[0] * 3.5, R.neck[1] + q[1] * 3.5];
  const nB = [R.neck[0] - q[0] * 3.5, R.neck[1] - q[1] * 3.5];
  const pts = [];
  const quad = (a, c, b, n = 12) => {
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
                u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
    }
  };
  pts.push(aF);
  quad(aF, wF, cF);
  pts.push(sF);
  quad(sF, nF, nB);
  quad(nB, sB, cB);
  quad(cB, wB, aB);
  quad(aB, [p[0] - d[0] * H * 0.16, p[1] - d[1] * H * 0.16], aF);
  return pts;
}

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const wAt = (wa, wb, bulge, t) =>
  wa + (wb - wa) * t + bulge * Math.pow(Math.sin(Math.PI * t), 1.5);

function inCapsule(x, y, a, b, wa, wb, bulge, pad = 0) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy || 1;
  let t = ((x - a[0]) * dx + (y - a[1]) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const r = wAt(wa, wb, bulge, t) + pad;
  return (x - (a[0] + dx * t)) ** 2 + (y - (a[1] + dy * t)) ** 2 <= r * r;
}

// The head, as it covers the far arm: skull, hair and headband, in the same
// rotated frame drawHead() builds.
const HAIR = [
  [-14.8, 3.4], [-10.0, -6.4], [-5.0, -1.2], [-1.8, -8.8], [3.2, -2.8],
  [5.8, -9.4], [10.2, -4.4], [11.0, -10.2], [16.0, -6.6], [10.6, -21.4],
  [-3.8, -17.4], [-17.6, -11.6],
];

function occluders(pose, R, near) {
  const shape = [];
  const poly = torsoPoly(R);
  shape.push((x, y) => inPoly(x, y, poly));

  // hips: the rounded mass the thighs grow out of
  const ang = Math.atan2(R.neck[1] - R.pelvis[1], R.neck[0] - R.pelvis[0]) - Math.PI / 2;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const hx = R.pelvis[0], hy = R.pelvis[1] + 2;
  shape.push((x, y) => {
    const dx = x - hx, dy = y - hy;
    return Math.abs(dx * ca + dy * sa) <= 16.2 && Math.abs(-dx * sa + dy * ca) <= 11.7;
  });

  // neck capsule
  shape.push((x, y) => inCapsule(x, y, R.neck,
    [R.neck[0] + R.dir[0] * 7, R.neck[1] + R.dir[1] * 7], 6.2, 6.6, 0, 1.7));

  // head: skull ellipse, hair mass, headband
  const h = R.head;
  const tilt = ((pose.headT || 0) + (pose.lean || 0) * 0.2) * Math.PI / 180;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  shape.push((x, y) => {
    const dx = x - h[0], dy = y - h[1];
    const lx = dx * ct + dy * st, ly = -dx * st + dy * ct;
    if ((lx / 17.5) ** 2 + ((ly + 1) / 19.5) ** 2 <= 1) return true;
    if (lx >= -17 && lx <= 17.5 && ly >= -13.5 && ly <= -6.8) return true;
    return inPoly(lx, ly, HAIR);
  });

  // the near side is drawn after the far arm, so it covers it too
  shape.push((x, y) => inCapsule(x, y, near.leg.hip, near.leg.kn, 13.2, 9.6, 1.7, 1.9));
  shape.push((x, y) => inCapsule(x, y, near.leg.kn, near.leg.an, 10.0, 6.8, 2.1, 1.9));
  shape.push((x, y) => inCapsule(x, y, near.arm.sh, near.arm.el, 10.0, 8.0, 1.3, 1.9));
  shape.push((x, y) => inCapsule(x, y, near.arm.el, near.arm.wr, 8.0, 6.0, 1.5, 1.9));
  const hr = near.arm.ang * Math.PI / 180;
  shape.push((x, y) => inCapsule(x, y, near.arm.wr,
    [near.arm.wr[0] + Math.sin(hr) * 11, near.arm.wr[1] + Math.cos(hr) * 11], 4.0, 5.4, 0, 1.9));
  return shape;
}

/* ---- the measurement ----------------------------------------------------- */

// Widest unoccluded slice across the far arm, and how much of it is left. A
// limb that reads is one with a slice wider than the dark outline it carries
// (1.9 px each side) plus the rim (3.6), so ~2.5 px of actual colour.
function armVisibility(pose) {
  const cs = Math.cos(((pose.spin || 0) * Math.PI) / 180);
  const depth = Math.abs(cs);
  const flip = cs < 0;
  const R = rig(pose, depth);
  const far = flip ? R.armF : R.armB;
  const near = flip ? { arm: R.armB, leg: R.legB } : { arm: R.armF, leg: R.legF };
  const occ = occluders(pose, R, near);
  const bones = [
    [far.sh, far.el, 9.4, 7.6, 1.2],
    [far.el, far.wr, 7.6, 5.8, 1.4],
  ];

  const hiddenAt = (x, y) => {
    for (const f of occ) if (f(x, y)) return true;
    return false;
  };

  let bestSlice = 0;
  let area = 0;
  for (const [a, b, wa, wb, bulge] of bones) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const cx = a[0] + dx * t, cy = a[1] + dy * t;
      const r = wAt(wa, wb, bulge, t) + 3.6;   // outermost: rim light edge
      let run = 0, runMax = 0;
      for (let o = -r; o <= r; o += 0.5) {
        if (hiddenAt(cx + nx * o, cy + ny * o)) run = 0;
        else runMax = Math.max(runMax, (run += 0.5));
      }
      bestSlice = Math.max(bestSlice, runMax);
      // area, coarse but monotone: count the strip between -r and +r
      for (let o = -r; o <= r; o += 1) {
        if (!hiddenAt(cx + nx * o, cy + ny * o)) area += 1 * (L / 24);
      }
    }
  }
  return { slice: bestSlice, area, R, far };
}

/* ---- sample the game's actual poses -------------------------------------- */

const STEPS = 40;      // through the move
const PHASES = 16;     // the groove runs on its own clock, so sweep it
const MIN_SLICE = 2.5;
const MIN_AREA = 40;
let failed = 0;
const report = [];

function withSpin(pose, spin) {
  pose.spin = spin;
  return pose;
}

for (const name of Object.keys(MOVES)) {
  const m = MOVES[name];
  let worst = { slice: 1e9, area: 1e9, prog: 0, phase: 0, dir: 0 };
  for (let i = 0; i <= STEPS; i++) {
    const prog = i / STEPS;
    const k = poseAtKeys(m.keys, prog);
    for (let ph = 0; ph < PHASES; ph++) {
      for (const dir of [-1, 0, 1]) {
        // the game blends the move over the groove rather than replacing it,
        // and the groove keeps its own phase while the move plays
        const base = idlePose(ph / PHASES, (i + ph) % 4 === 0 ? 1 : 0, dir);
        const pose = blendPose(base, k.pose, k.w);
        const v = armVisibility(withSpin(pose, k.spin));
        if (v.slice < worst.slice || (v.slice === worst.slice && v.area < worst.area)) {
          worst = { slice: v.slice, area: v.area, prog, phase: ph / PHASES, dir };
        }
      }
    }
  }
  const bad = worst.slice < MIN_SLICE || worst.area < MIN_AREA;
  if (bad) failed++;
  report.push({ name, ...worst, bad });
  console.log(`${bad ? "FAIL" : "PASS"} ${name.padEnd(6)} worst at move ${worst.prog.toFixed(2)}, ` +
    `groove ${worst.phase.toFixed(2)}, dir ${worst.dir}: visible slice ` +
    `${worst.slice.toFixed(2)}px, area ${worst.area.toFixed(0)}px²`);
}

// The groove alone is reachable between moves and during a shuffle.
(function () {
  let worst = { slice: 1e9, area: 1e9, ph: 0 };
  for (let i = 0; i < 180; i++) {
    const ph = i / 180;
    for (const dir of [-1, 0, 1]) {
      const pose = idlePose(ph, i % 4 === 0 ? 1 : 0, dir);
      const v = armVisibility(withSpin(pose, 0));
      if (v.slice < worst.slice) worst = { slice: v.slice, area: v.area, ph, dir };
    }
  }
  const bad = worst.slice < MIN_SLICE || worst.area < MIN_AREA;
  if (bad) failed++;
  console.log(`${bad ? "FAIL" : "PASS"} ${"groove".padEnd(6)} worst phase ${worst.ph.toFixed(3)}, ` +
    `dir ${worst.dir}: visible slice ${worst.slice.toFixed(2)}px, area ${worst.area.toFixed(0)}px²`);
})();

console.log(`\n${failed === 0 ? "every sampled pose keeps both arms visible" : failed + " pose groups swallow an arm"}`);

/* ---- the strip ----------------------------------------------------------- */

const n = (v) => Math.round(v * 10) / 10;
const polyPts = (pts) => pts.map((p) => n(p[0]) + "," + n(p[1])).join(" ");

const PALS = {
  player: { coat: "#35dff6", coatLo: "#0a7c9c", pants: "#3c4290", pantsLo: "#1f2456",
            trim: "#ff4fd8", glove: "#ff4fd8", hair: "#251244", skin: "#f4c39b", rim: "#a6f7ff" },
  rival:  { coat: "#ff9a3c", coatLo: "#a8490a", pants: "#4e2039", pantsLo: "#2c101e",
            trim: "#ff2b5c", glove: "#ff2b5c", hair: "#28070f", skin: "#dda578", rim: "#ffdcad" },
};

function limb(a, b, wa, wb, bulge, fill, pal, rim) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const side = (e) => {
    const top = [], bot = [];
    for (let i = 0; i <= 7; i++) {
      const t = i / 7, w = wAt(wa, wb, bulge, t) + e;
      top.push([a[0] + ux * L * t + nx * w, a[1] + uy * L * t + ny * w]);
      bot.push([a[0] + ux * L * t - nx * w, a[1] + uy * L * t - ny * w]);
    }
    return `<path d="M${top.map((p) => n(p[0]) + " " + n(p[1])).join("L")}L${bot.reverse().map((p) => n(p[0]) + " " + n(p[1])).join("L")}Z" fill="${fill}"/>` +
      `<circle cx="${n(a[0])}" cy="${n(a[1])}" r="${n(wa + e)}" fill="${fill}"/>` +
      `<circle cx="${n(b[0])}" cy="${n(b[1])}" r="${n(wb + e)}" fill="${fill}"/>`;
  };
  let s = "";
  if (rim) s += side(3.6).replaceAll(`fill="${fill}"`, `fill="${pal.rim}"`);
  s += side(1.9).replaceAll(`fill="${fill}"`, `fill="#0b0416"`);
  s += side(0);
  return s;
}

function figure(pose, facing, pal) {
  const cs = Math.cos(((pose.spin || 0) * Math.PI) / 180);
  const depth = Math.abs(cs);
  const flip = cs < 0;
  const wf = 0.62 + 0.38 * depth;
  const sx = facing * wf * (flip ? -1 : 1);
  const R = rig(pose, depth);
  const near = flip ? { arm: R.armB, leg: R.legB } : { arm: R.armF, leg: R.legF };
  const far = flip ? { arm: R.armF, leg: R.legF } : { arm: R.armB, leg: R.legB };
  const away = cs < -0.12;
  const parts = [];

  parts.push(limb(far.leg.hip, far.leg.kn, 12.4, 9.2, 1.6, pal.pantsLo, pal, pal.rim));
  parts.push(limb(far.leg.kn, far.leg.an, 9.4, 6.6, 2.0, pal.pantsLo, pal, pal.rim));
  parts.push(limb(far.arm.sh, far.arm.el, 9.4, 7.6, 1.2, pal.coatLo, pal, pal.rim));
  parts.push(limb(far.arm.el, far.arm.wr, 7.6, 5.8, 1.4, pal.coatLo, pal, pal.rim));

  parts.push(limb(near.leg.hip, near.leg.kn, 13.2, 9.6, 1.7, pal.pants, pal, null));
  parts.push(limb(near.leg.kn, near.leg.an, 10.0, 6.8, 2.1, pal.pants, pal, null));
  parts.push(`<rect x="${n(R.pelvis[0] - 14.5)}" y="${n(R.pelvis[1] - 8)}" width="29" height="20" rx="7" fill="${pal.pants}" stroke="#0b0416" stroke-width="2.5"/>`);

  const torso = torsoPoly(R);
  parts.push(`<path d="M${polyPts(torso)}Z" fill="${pal.coat}" stroke="#0b0416" stroke-width="3"/>`);

  // neck
  parts.push(limb(R.neck, [R.neck[0] + R.dir[0] * 7, R.neck[1] + R.dir[1] * 7], 6.2, 6.6, 0, pal.skin, pal, null));
  // head
  parts.push(`<circle cx="${n(R.head[0])}" cy="${n(R.head[1])}" r="15" fill="${away ? pal.hair : pal.skin}" stroke="#0b0416" stroke-width="2.5"/>`);
  parts.push(`<path d="M${polyPts(HAIR.map(([x, y]) => [R.head[0] + x, R.head[1] + y]))}Z" fill="${pal.hair}"/>`);

  parts.push(limb(near.arm.sh, near.arm.el, 10.0, 8.0, 1.3, pal.coat, pal, null));
  parts.push(limb(near.arm.el, near.arm.wr, 8.0, 6.0, 1.5, pal.coat, pal, null));
  parts.push(`<circle cx="${n(near.arm.wr[0])}" cy="${n(near.arm.wr[1])}" r="5" fill="${pal.glove}"/>`);

  return `<g transform="scale(${n(sx * 0.6)},${n(0.6)})">${parts.join("")}</g>`;
}

const COLS = 10;
const ROWS = Object.keys(MOVES).length;
const CW = 300, CH = 290;
const W = COLS * CW, H = ROWS * CH + 54;

const cells = [];
Object.keys(MOVES).forEach((name, row) => {
  const m = MOVES[name];
  for (let col = 0; col < COLS; col++) {
    const prog = col / (COLS - 1);
    const k = poseAtKeys(m.keys, prog);
    const pose = blendPose(idlePose(prog * 0.8, col % 4 === 0 ? 1 : 0, 0), k.pose, k.w);
    pose.spin = k.spin;
    const cx = col * CW + CW / 2;
    const cy = 54 + row * CH + CH * 0.54;
    // both fighters, facing each other, in the move's real pose
    cells.push(`<g transform="translate(${cx - 68},${cy})">${figure(pose, 1, PALS.player)}</g>`);
    cells.push(`<g transform="translate(${cx + 68},${cy})">${figure(pose, -1, PALS.rival)}</g>`);
  }
  cells.push(`<text x="12" y="${54 + row * CH + 22}" fill="#ff9dd8" font-size="13" letter-spacing="3">${m.name.toUpperCase()}</text>`);
  cells.push(`<line x1="0" y1="${54 + (row + 1) * CH}" x2="${W}" y2="${54 + (row + 1) * CH}" stroke="#ffffff" stroke-opacity="0.12"/>`);
});
for (let col = 0; col < COLS; col++) {
  cells.push(`<line x1="${(col + 1) * CW}" y1="54" x2="${(col + 1) * CW}" y2="${H}" stroke="#ffffff" stroke-opacity="0.06"/>`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Every Dance Fight move sampled through its animation, player and rival, with the far arm's rim light">
  <defs>
    <radialGradient id="bg" cx="50%" cy="20%" r="90%">
      <stop offset="0" stop-color="#2a0645"/><stop offset="1" stop-color="#0a0116"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="12" y="28" fill="#ff9dd8" font-size="16" letter-spacing="4">EVERY MOVE · PLAYER + RIVAL</text>
  <text x="12" y="46" fill="#ffffff" font-size="11" opacity="0.55">the game's own blended poses, ${COLS} frames per move · far side carries the rim light</text>
  ${cells.join("\n  ")}
</svg>
`;

writeFileSync(out, svg);
console.log(`wrote ${out} — ${ROWS} moves × ${COLS} frames, both fighters, ${(svg.length / 1024).toFixed(1)} KB`);
process.exit(failed ? 1 : 0);
