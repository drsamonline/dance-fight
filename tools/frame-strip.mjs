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
 * Every dimension it measures with — torso, hips, neck, head and limb widths —
 * is read from the SHAPE/TORSO table in the game's own rig block, so changing
 * the body changes the check.
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
runInNewContext(block +
  "\n;({BODY, TORSO, SHAPE, rig, basePose, idlePose, MOVES, poseAtKeys, lerpPose, blendPose});",
  sandbox);
const { TORSO, SHAPE, rig, idlePose, MOVES, poseAtKeys, blendPose } = sandbox;

/* ---- the silhouette the far arm has to survive --------------------------- */

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

// A drawn path, as a polygon plus the reach of its outline. Points are tested
// against the polygon and against the stroke band around its edge, so a shape
// covers exactly what the canvas would cover.
function pathTest(poly, outline) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
  }
  const pad = outline / 2;
  return (x, y) => {
    if (x < x0 - pad || x > x1 + pad || y < y0 - pad || y > y1 + pad) return false;
    if (inPoly(x, y, poly)) return true;
    if (pad <= 0) return false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j][0], ay = poly[j][1], bx = poly[i][0], by = poly[i][1];
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy || 1;
      let t = ((x - ax) * dx + (y - ay) * dy) / L2;
      t = Math.max(0, Math.min(1, t));
      if ((x - (ax + dx * t)) ** 2 + (y - (ay + dy * t)) ** 2 <= pad * pad) return true;
    }
    return false;
  };
}

const cubicTo = (p0, c, n = 8) => {
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * c[0] + 3 * u * t * t * c[2] + t * t * t * c[4],
      u * u * u * p0[1] + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5],
    ]);
  }
  return pts;
};

const quadTo = (p0, c, n = 8) => {
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([
      u * u * p0[0] + 2 * u * t * c[0] + t * t * c[2],
      u * u * p0[1] + 2 * u * t * c[1] + t * t * c[3],
    ]);
  }
  return pts;
};

/* The head, as drawHead() lays it out: skull, hair and headband in the head's
 * own rotated frame, scaled by the same turn-dependent amount the page uses. */
function headOccluders(pose, R, depth) {
  const H = SHAPE.head;
  const wf = 0.62 + 0.38 * depth;
  const kx = Math.min(1.2, 0.9 / wf);
  const sx = H.scale * kx, sy = H.scale;
  const tilt = ((pose.headT || 0) + (pose.lean || 0) * 0.2) * Math.PI / 180;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const toWorld = (x, y) => {
    const lx = x * sx, ly = y * sy;
    return [R.head[0] + lx * ct - ly * st, R.head[1] + lx * st + ly * ct];
  };

  // skull: the cubic path the page fills and strokes
  let p0 = H.skull[0];
  const skull = [];
  for (let i = 1; i < H.skull.length; i++) {
    const seg = H.skull[i];
    skull.push(...cubicTo(p0, seg));
    p0 = [seg[4], seg[5]];
  }

  // hair: two quadratic sweeps and the spiky fringe
  const hair = [];
  let q = H.hair.start;
  for (const arc of H.hair.arcs) {
    hair.push(...quadTo(q, arc));
    q = [arc[2], arc[3]];
  }
  hair.push(...H.hair.fringe);

  const b = H.band;
  const band = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];

  return [
    pathTest(skull.map((p) => toWorld(p[0], p[1])), 3),
    pathTest(hair.map((p) => toWorld(p[0], p[1])), 2.4),
    pathTest(band.map((p) => toWorld(p[0], p[1])), 0),
  ];
}

function occluders(pose, R, near, depth) {
  const L = SHAPE.outline;
  const shape = [(x, y) => inPoly(x, y, torsoPoly(R))];

  // hips: the rounded mass the thighs grow out of, drawn at the pelvis + drop
  const hips = SHAPE.hips;
  const ang = Math.atan2(R.neck[1] - R.pelvis[1], R.neck[0] - R.pelvis[0]) - Math.PI / 2;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const hx = R.pelvis[0], hy = R.pelvis[1] + hips.drop;
  const halfW = hips.w / 2 + 1.5, halfH = hips.h / 2 + 1.5;
  shape.push((x, y) => {
    const dx = x - hx, dy = y - hy;
    return Math.abs(dx * ca + dy * sa) <= halfW && Math.abs(-dx * sa + dy * ca) <= halfH;
  });

  // neck capsule
  const N = SHAPE.neck;
  shape.push((x, y) => inCapsule(x, y, R.neck,
    [R.neck[0] + R.dir[0] * N.len, R.neck[1] + R.dir[1] * N.len], N.wa, N.wb, 0, L));

  shape.push(...headOccluders(pose, R, depth));

  // the near side is drawn after the far arm, so it covers it too
  const NS = SHAPE.near;
  shape.push((x, y) => inCapsule(x, y, near.leg.hip, near.leg.kn, NS.legHip[0], NS.legHip[1], NS.legHip[2], L));
  shape.push((x, y) => inCapsule(x, y, near.leg.kn, near.leg.an, NS.legKn[0], NS.legKn[1], NS.legKn[2], L));
  shape.push((x, y) => inCapsule(x, y, near.arm.sh, near.arm.el, NS.armSh[0], NS.armSh[1], NS.armSh[2], L));
  shape.push((x, y) => inCapsule(x, y, near.arm.el, near.arm.wr, NS.armEl[0], NS.armEl[1], NS.armEl[2], L));
  const hr = near.arm.ang * Math.PI / 180;
  shape.push((x, y) => inCapsule(x, y, near.arm.wr,
    [near.arm.wr[0] + Math.sin(hr) * NS.hand * 2.2, near.arm.wr[1] + Math.cos(hr) * NS.hand * 2.2],
    NS.hand * 0.74, NS.hand, 0, L));
  return shape;
}

/* ---- the measurement ----------------------------------------------------- */

// Widest unoccluded slice across the far arm, and how much of it is left. An
// arm that reads has a lit band clear of the torso, well past the limb's own
// dark outline (outline px each side) and its rim — see MIN_SLICE.
function armVisibility(pose) {
  const cs = Math.cos(((pose.spin || 0) * Math.PI) / 180);
  const depth = Math.abs(cs);
  const flip = cs < 0;
  const R = rig(pose, depth);
  const far = flip ? R.armF : R.armB;
  const near = flip ? { arm: R.armB, leg: R.legB } : { arm: R.armF, leg: R.legF };
  const occ = occluders(pose, R, near, depth);
  const F = SHAPE.far;
  const bones = [
    [far.sh, far.el, F.armSh[0], F.armSh[1], F.armSh[2]],
    [far.el, far.wr, F.armEl[0], F.armEl[1], F.armEl[2]],
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
      const r = wAt(wa, wb, bulge, t) + SHAPE.rim;   // outermost: rim light edge
      let run = 0, runMax = 0;
      for (let o = -r; o <= r; o += 0.5) {
        if (hiddenAt(cx + nx * o, cy + ny * o)) {
          run = 0;
        } else {
          run += 0.5;
          runMax = Math.max(runMax, run);
          area += 0.5 * (L / 24);
        }
      }
      bestSlice = Math.max(bestSlice, runMax);
    }
  }
  return { slice: bestSlice, area };
}

/* ---- sample the game's actual poses -------------------------------------- */

const STEPS = 40;      // through the move
const PHASES = 16;     // the groove runs on its own clock, so sweep it
// A readable arm is one with a lit band of real width, not the 3 px sliver a
// buried limb leaves behind its own outline and rim.
const MIN_SLICE = 7;
const MIN_AREA = 160;
let failed = 0;

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
  console.log(`${bad ? "FAIL" : "PASS"} ${name.padEnd(6)} worst at move ${worst.prog.toFixed(2)}, ` +
    `groove ${worst.phase.toFixed(2)}, dir ${worst.dir}: visible slice ` +
    `${worst.slice.toFixed(2)}px, area ${worst.area.toFixed(0)}px²`);
}

// The groove alone is reachable between moves and during a shuffle.
(function () {
  let worst = { slice: 1e9, area: 1e9, ph: 0, dir: 0 };
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

console.log(`\nneed a lit band of ${MIN_SLICE}px and ${MIN_AREA}px² of far arm on every frame`);
console.log(failed === 0 ? "every sampled pose keeps both arms visible" : failed + " pose groups swallow an arm");

/* ---- the strip ----------------------------------------------------------- */

const n = (v) => Math.round(v * 10) / 10;
const polyPts = (pts) => pts.map((p) => n(p[0]) + "," + n(p[1])).join(" ");

const PALS = {
  player: { coat: "#35dff6", coatLo: "#0a7c9c", pants: "#3c4290", pantsLo: "#1f2456",
            trim: "#ff4fd8", glove: "#ff4fd8", hair: "#251244", skin: "#f4c39b", rim: "#a6f7ff" },
  rival:  { coat: "#ff9a3c", coatLo: "#a8490a", pants: "#4e2039", pantsLo: "#2c101e",
            trim: "#ff2b5c", glove: "#ff2b5c", hair: "#28070f", skin: "#dda578", rim: "#ffdcad" },
};

function limb(a, b, w, fill, pal, rim) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const side = (e) => {
    const top = [], bot = [];
    for (let i = 0; i <= 7; i++) {
      const t = i / 7, ww = wAt(w[0], w[1], w[2], t) + e;
      top.push([a[0] + ux * L * t + nx * ww, a[1] + uy * L * t + ny * ww]);
      bot.push([a[0] + ux * L * t - nx * ww, a[1] + uy * L * t - ny * ww]);
    }
    return `<path d="M${top.map((p) => n(p[0]) + " " + n(p[1])).join("L")}L${bot.reverse().map((p) => n(p[0]) + " " + n(p[1])).join("L")}Z" fill="${fill}"/>` +
      `<circle cx="${n(a[0])}" cy="${n(a[1])}" r="${n(w[0] + e)}" fill="${fill}"/>` +
      `<circle cx="${n(b[0])}" cy="${n(b[1])}" r="${n(w[1] + e)}" fill="${fill}"/>`;
  };
  let s = "";
  if (rim) s += side(SHAPE.rim).replaceAll(`fill="${fill}"`, `fill="${pal.rim}"`);
  s += side(SHAPE.outline).replaceAll(`fill="${fill}"`, `fill="#0b0416"`);
  s += side(0);
  return s;
}

// the head, drawn from the same skull/hair/band paths the canvas uses
function headSvg(pose, R, depth, pal, away) {
  const H = SHAPE.head;
  const wf = 0.62 + 0.38 * depth;
  const kx = Math.min(1.2, 0.9 / wf);
  const tilt = (pose.headT || 0) + (pose.lean || 0) * 0.2;
  const skull = "M" + H.skull[0].join(" ") + H.skull.slice(1)
    .map((c) => "C" + c.join(" ")).join("") + "Z";
  const hair = "M" + H.hair.start.join(" ") + H.hair.arcs
    .map((a) => "Q" + a.join(" ")).join("") +
    H.hair.fringe.map((p) => "L" + p.join(" ")).join("") + "Z";
  const b = H.band;
  return `<g transform="translate(${n(R.head[0])},${n(R.head[1])}) rotate(${n(tilt)}) ` +
    `scale(${n(H.scale * kx)},${n(H.scale)})">` +
    `<path d="${skull}" fill="${away ? pal.hair : pal.skin}" stroke="#0b0416" stroke-width="3"/>` +
    `<path d="${hair}" fill="${pal.hair}" stroke="#0b0416" stroke-width="2.4"/>` +
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${pal.trim}"/></g>`;
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
  const F = SHAPE.far, NS = SHAPE.near;
  const parts = [];

  parts.push(limb(far.leg.hip, far.leg.kn, F.legHip, pal.pantsLo, pal, pal.rim));
  parts.push(limb(far.leg.kn, far.leg.an, F.legKn, pal.pantsLo, pal, pal.rim));
  parts.push(limb(far.arm.sh, far.arm.el, F.armSh, pal.coatLo, pal, pal.rim));
  parts.push(limb(far.arm.el, far.arm.wr, F.armEl, pal.coatLo, pal, pal.rim));

  parts.push(limb(near.leg.hip, near.leg.kn, NS.legHip, pal.pants, pal, null));
  parts.push(limb(near.leg.kn, near.leg.an, NS.legKn, pal.pants, pal, null));
  const hp = SHAPE.hips;
  parts.push(`<rect x="${n(R.pelvis[0] + hp.x)}" y="${n(R.pelvis[1] + hp.drop + hp.y)}" ` +
    `width="${hp.w}" height="${hp.h}" rx="${hp.r}" fill="${pal.pants}" stroke="#0b0416" stroke-width="2.5"/>`);

  parts.push(`<path d="M${polyPts(torsoPoly(R))}Z" fill="${pal.coat}" stroke="#0b0416" stroke-width="3"/>`);

  const N = SHAPE.neck;
  parts.push(limb(R.neck, [R.neck[0] + R.dir[0] * N.len, R.neck[1] + R.dir[1] * N.len],
    [N.wa, N.wb, 0], pal.skin, pal, null));
  parts.push(headSvg(pose, R, depth, pal, away));

  parts.push(limb(near.arm.sh, near.arm.el, NS.armSh, pal.coat, pal, null));
  parts.push(limb(near.arm.el, near.arm.wr, NS.armEl, pal.coat, pal, null));
  parts.push(`<circle cx="${n(near.arm.wr[0])}" cy="${n(near.arm.wr[1])}" r="${n(NS.hand - 0.4)}" fill="${pal.glove}"/>`);

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
