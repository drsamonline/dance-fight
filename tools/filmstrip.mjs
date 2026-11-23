#!/usr/bin/env node
/* Motion capture for the README, without a browser or a video encoder.
 *
 * Extracts the same pure rig block as tools/rig-check.mjs, samples the
 * Body-Roll Finisher at 14 points through its 1.05 s, and writes an animated
 * SVG. Every frame is drawn from the game's own joint angles, so the clip is
 * the rig rather than an artist's impression of it, and it stays editable and
 * tiny (a few KB) instead of being a GIF nobody can regenerate.
 *
 *   node tools/filmstrip.mjs [path/to/index.html] [out.svg]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || resolve(here, "../docs/play/index.html");
const out = process.argv[3] || resolve(here, "../docs/assets/finisher.svg");

const html = readFileSync(file, "utf8");
const start = html.indexOf("/* ==== RIG-LIB START ====");
const end = html.indexOf("/* ==== RIG-LIB END ==== */");
if (start < 0 || end < start) {
  console.error("rig block markers not found in " + file);
  process.exit(1);
}
const block = html.slice(html.indexOf("*/", start) + 2, html.lastIndexOf("/*", end));
const sandbox = {};
runInNewContext(block + "\n;({rig, poseAtKeys, MOVES});", sandbox);
const { rig, poseAtKeys, MOVES } = sandbox;

const move = MOVES.fin;
const FRAMES = 14;
const CYCLE = move.dur;
const W = 960, H = 400;

const n = (v) => Math.round(v * 10) / 10;
const pts = (arr) => arr.map((p) => n(p[0]) + "," + n(p[1])).join(" ");

const INK = "#0b0416";
const CYAN = "#35dff6";
const CYAN_DARK = "#0a7c9c";
const MAGENTA = "#ff4fd8";

function limb(a, b, w, fill) {
  return `<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}" stroke="${INK}" stroke-width="${w + 3.4}" stroke-linecap="round"/>` +
    `<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}" stroke="${fill}" stroke-width="${w}" stroke-linecap="round"/>`;
}

function frame(pose) {
  const R = rig(pose, 1);
  const parts = [];
  parts.push(limb(R.legB.hip, R.legB.kn, 10, CYAN_DARK), limb(R.legB.kn, R.legB.an, 8, CYAN_DARK));
  parts.push(limb(R.legF.hip, R.legF.kn, 11, CYAN), limb(R.legF.kn, R.legF.an, 8.5, CYAN));
  parts.push(limb(R.pelvis, R.neck, 23, CYAN));
  parts.push(limb(R.armB.sh, R.armB.el, 8, CYAN_DARK), limb(R.armB.el, R.armB.wr, 6.5, CYAN_DARK));
  parts.push(limb(R.armF.sh, R.armF.el, 8.5, CYAN), limb(R.armF.el, R.armF.wr, 7, CYAN));
  parts.push(`<circle cx="${n(R.head[0])}" cy="${n(R.head[1])}" r="15" fill="${CYAN}" stroke="${INK}" stroke-width="3"/>`);
  parts.push(`<circle cx="${n(R.head[0] - 1)}" cy="${n(R.head[1] - 8)}" r="8" fill="${MAGENTA}" opacity="0.9"/>`);
  parts.push(`<circle cx="${n(R.armF.wr[0])}" cy="${n(R.armF.wr[1])}" r="4.4" fill="${MAGENTA}"/>`);
  return parts.join("");
}

// Discrete keyTimes: every frame owns exactly one slice of the cycle, so the
// clip plays in order at whatever tempo the viewer's browser runs at.
const groups = [];
for (let i = 0; i < FRAMES; i++) {
  const prog = i / (FRAMES - 1);
  const pose = poseAtKeys(move.keys, prog).pose;
  const values = [];
  const times = [];
  for (let k = 0; k <= FRAMES; k++) {
    values.push(k === i ? 1 : 0);
    times.push(Math.round((k / FRAMES) * 10000) / 10000);
  }
  const svg = frame(pose);
  groups.push(
    `<g opacity="0">` +
    `<animate attributeName="opacity" values="${values.join(";")}" keyTimes="${times.join(";")}" ` +
    `calcMode="discrete" dur="${CYCLE}s" repeatCount="indefinite"/>` +
    `<g transform="translate(480,330) scale(0.62)">${svg}</g>` +
    `</g>`
  );
  void i;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="The Body-Roll Finisher: the game's rig sampled through a 720° spin">
  <defs>
    <radialGradient id="bg" cx="50%" cy="30%" r="80%">
      <stop offset="0" stop-color="#2a0645"/>
      <stop offset="1" stop-color="#0a0116"/>
    </radialGradient>
    <linearGradient id="rule" x1="0" x2="1">
      <stop offset="0" stop-color="#37e6ff"/><stop offset="0.6" stop-color="#ff4fd8"/><stop offset="1" stop-color="#ffd23f"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <ellipse cx="480" cy="352" rx="120" ry="12" fill="#000" opacity="0.45"/>
  <g font-family="'Trebuchet MS', system-ui, sans-serif" text-anchor="middle">
    <text x="480" y="40" fill="#ff9dd8" font-size="15" letter-spacing="4">BODY-ROLL FINISHER</text>
    <text x="480" y="62" fill="#ffffff" font-size="12" letter-spacing="2" opacity="0.55">720° · 1.05 s · 14 poses from the game's own rig</text>
  </g>
  ${groups.join("\n  ")}
  <rect x="0" y="${H - 4}" width="${W}" height="4" fill="url(#rule)" opacity="0.8"/>
</svg>
`;

writeFileSync(out, svg);
console.log(`wrote ${out} — ${FRAMES} poses, ${(svg.length / 1024).toFixed(1)} KB`);
