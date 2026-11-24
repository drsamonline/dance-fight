#!/usr/bin/env node
/* Combat maths and round pacing for Dance Fight.
 *
 * The rig, the calibration and the beat grid all have gates; the fight itself
 * had none. Damage, the combo curve, the grade multipliers and the difficulty
 * scaling only ever answered to feel, which means a change to one of them could
 * make Hard easier than Easy and nothing would say so.
 *
 * This lifts the shipped FIGHT-LIB block (pure maths, no DOM) plus the DIFFS and
 * MOVES tables out of the page and runs a *model* of a round against them: two
 * fighters, reach, wind-ups, guards, and a synthetic player whose on-beat rate
 * is a parameter. It is a model, not the shipped AI — it is here to hold the
 * maths and the pacing, not to claim it plays like a person.
 *
 *   node tools/fight-check.mjs [path/to/index.html]
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
  if (cond) console.log("PASS " + name);
  else {
    failed++;
    console.log("FAIL " + name + (detail ? "  — " + detail : ""));
  }
}
const summary = () => {
  console.log(`\n${checks - failed}/${checks} checks passed`);
  process.exit(failed ? 1 : 0);
};

const html = readFileSync(file, "utf8");

/* The marked block, verbatim. */
function fightLib() {
  const start = html.indexOf("/* ==== FIGHT-LIB START ====");
  const end = html.indexOf("/* ==== FIGHT-LIB END ==== */");
  if (start < 0 || end < 0) throw new Error("FIGHT-LIB block is missing");
  return html.slice(start, end);
}

/* A module-level object literal (`var MOVES = {...};`), braces balanced. */
function objectLiteral(name) {
  const at = html.indexOf("var " + name + " = {");
  if (at < 0) throw new Error("missing " + name);
  const open = html.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) return html.slice(at, i + 1) + ";";
    }
  }
  throw new Error("unbalanced " + name);
}

let lib, DIFFS, MOVES;
try {
  const out = runInNewContext(
    fightLib() + "\n" + objectLiteral("DIFFS") + "\n" + objectLiteral("MOVES") +
    "\n;({hitDamage, hitScore, comboMultiplier, hitstunFor, GRADE_DMG, DIFFS, MOVES});",
    {}
  );
  Object.assign(globalThis, out);
  lib = out;
  DIFFS = out.DIFFS;
  MOVES = out.MOVES;
} catch (err) {
  ok("the fight block is present in " + file, false, String(err));
  summary();
}
ok("the fight block is present in " + file, true);
ok("every move has damage, reach and a hit window",
   Object.keys(MOVES).every((k) => MOVES[k].dmg > 0 && MOVES[k].reach > 0 && MOVES[k].from < MOVES[k].to),
   Object.keys(MOVES).join(","));
ok("all three difficulties are present",
   !!DIFFS.easy && !!DIFFS.normal && !!DIFFS.hard, Object.keys(DIFFS).join(","));

/* ---- 1. the grade multipliers are the game's advertised promise ---------- */
{
  const jab = MOVES.jab;
  const off = lib.hitDamage(jab, 0, "off", false, false, 0);
  const great = lib.hitDamage(jab, 0, "great", false, false, 0);
  const perfect = lib.hitDamage(jab, 0, "perfect", false, false, 0);
  ok("no combo: a PERFECT is worth exactly 1.6x", perfect === Math.round(jab.dmg * 1.6),
     perfect + " vs " + Math.round(jab.dmg * 1.6));
  ok("no combo: a GREAT sits between off and PERFECT", great > off && great < perfect,
     [off, great, perfect].join(" / "));
  ok("a blocked hit is worth 22%", Math.round(jab.dmg * 0.22) === lib.hitDamage(jab, 0, "off", true, false, 0));
  ok("the combo multiplier caps at 12 hits (1.84x)", Math.abs(lib.comboMultiplier(40) - 1.84) < 1e-9,
     String(lib.comboMultiplier(40)));
  ok("the combo multiplier starts at 1", lib.comboMultiplier(0) === 1);
  ok("the rival's difficulty scales its damage, not the player's",
     lib.hitDamage(jab, 0, "off", false, true, DIFFS.hard.dmg) > lib.hitDamage(jab, 0, "off", false, false, DIFFS.hard.dmg),
     "enemy damage was not scaled");
  const s1 = lib.hitScore(10, "off", 0);
  const s2 = lib.hitScore(10, "perfect", 0);
  ok("score follows damage and grade", s2 > s1 && s1 > 0, s1 + " / " + s2);
}

/* ---- 2. a round model -----------------------------------------------------
   Two fighters in a 920-unit arena. Each thinks, closes, commits to a move and
   resolves it inside the move's hit window. The player's accuracy is the chance
   that a thrown move is graded PERFECT; the rest are split GREAT and OFF. */
const dt = 1 / 60;
function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const ARENA = { lo: 180, hi: 1100 };
const clamp = (v) => Math.max(ARENA.lo, Math.min(ARENA.hi, v));

function runRound({ diff, accuracy, seed, guard = 0.28 }) {
  const rnd = seeded(seed);
  const D = DIFFS[diff];
  let php = 100, ehp = 100, px = 478, ex = 806;
  let pThink = 0.3, eThink = 0.7;
  let pAtk = null, eAtk = null, pStun = 0, eStun = 0, pBlock = 0, eBlock = 0;
  let pCombo = 0, eCombo = 0, perfects = 0, t = 0;
  let pMove = null, eMove = null, pFrame = 0, eFrame = 0, pHit = false, eHit = false;

  const roll = () => {
    const r = rnd();
    if (r < accuracy) return "perfect";
    if (r < accuracy + (1 - accuracy) * 0.45) return "great";
    return "off";
  };
  const startP = (m) => {
    pAtk = m; pFrame = 0; pHit = false;
    pMove = roll();
  };
  const startE = (m) => { eAtk = m; eFrame = 0; eHit = false; };

  while (t < 240 && php > 0 && ehp > 0) {
    t += dt;
    if (pStun > 0) pStun -= dt;
    if (eStun > 0) eStun -= dt;
    if (pBlock > 0) pBlock -= dt;
    if (eBlock > 0) eBlock -= dt;

    // ---- player
    if (!pAtk && pStun <= 0 && pBlock <= 0) {
      pThink -= dt;
      if (pThink <= 0) {
        pThink = 0.34 + rnd() * 0.28;
        const dist = Math.abs(ex - px);
        const pick = dist <= 120 ? ["jab", "upper"][rnd() < 0.55 ? 0 : 1]
                   : dist <= 145 ? "kick" : null;
        // A human is not a spacing machine: some turns are spent stepping rather
        // than throwing, and the guard roll is its own die.
        if (pick && rnd() < 0.82) startP(MOVES[pick]);
        else px += Math.sign(ex - px) * 235 * dt;
        if (rnd() < guard && dist < 150) pBlock = 0.3;
      }
      px = clamp(px);
    }
    if (pAtk) {
      pFrame += dt;
      if (!pHit && pFrame >= pAtk.from && pFrame <= pAtk.to && Math.abs(ex - px) < pAtk.reach) {
        pHit = true;
        const blocked = eBlock > 0;
        const dmg = lib.hitDamage(pAtk, pCombo, pMove, blocked, false, 0);
        ehp = Math.max(0, ehp - dmg);
        if (pMove === "perfect") perfects++;
        if (!blocked) eCombo++; else eCombo = 0;
        eStun = blocked ? 0 : lib.hitstunFor(pAtk);
      }
      if (pFrame >= pAtk.dur) pAtk = null;
    }

    // ---- rival
    if (!eAtk && eStun <= 0 && eBlock <= 0) {
      eThink -= dt;
      if (eThink <= 0) {
        const aggro = D.aggro + Math.min(0.3, t * 0.02);
        eThink = (0.34 + rnd() * (0.62 - aggro * 0.3)) * D.think;
        const dist = Math.abs(px - ex);
        if (dist > 165) ex += Math.sign(px - ex) * 150 * D.speed * dt;
        else if (dist <= 116) startE(rnd() < 0.55 ? MOVES.jab : MOVES.upper);
        else if (dist <= 140) startE(MOVES.kick);
        else ex += Math.sign(px - ex) * 150 * D.speed * dt;
        if (dist < 150 && rnd() < D.guard) eBlock = 0.35;
      }
      ex = clamp(ex);
    }
    if (eAtk) {
      eFrame += dt;
      if (!eHit && eFrame >= eAtk.from && eFrame <= eAtk.to && Math.abs(px - ex) < eAtk.reach) {
        eHit = true;
        const blocked = pBlock > 0;
        const dmg = lib.hitDamage(eAtk, eCombo, "off", blocked, true, D.dmg);
        php = Math.max(0, php - dmg);
        if (!blocked) { eCombo++; pStun = lib.hitstunFor(eAtk); } else eCombo = 0;
      }
      if (eFrame >= eAtk.dur) eAtk = null;
    }
  }
  return { win: ehp <= 0 && php > 0, draw: ehp <= 0 && php <= 0, t, perfects, php, ehp };
}

const batch = (diff, accuracy, n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(runRound({ diff, accuracy, seed: 9001 + i * 37 }));
  const wins = out.filter((r) => r.win).length / n;
  const avg = out.reduce((a, r) => a + r.t, 0) / n;
  const stuck = out.filter((r) => r.t >= 240).length;
  return { wins, avg, stuck, out };
};

/* ---- 3. every round resolves, and difficulty means something ------------- */
{
  const easy = batch("easy", 0.45, 120);
  const normal = batch("normal", 0.45, 120);
  const hard = batch("hard", 0.45, 120);
  ok("every simulated round resolves (no softlock or stalemate)", easy.stuck + normal.stuck + hard.stuck === 0,
     easy.stuck + normal.stuck + hard.stuck + " rounds hit the time limit");
  ok("Easy is easier than Normal", easy.wins > normal.wins,
     "easy " + easy.wins.toFixed(2) + " vs normal " + normal.wins.toFixed(2));
  ok("Normal is easier than Hard", normal.wins > hard.wins,
     "normal " + normal.wins.toFixed(2) + " vs hard " + hard.wins.toFixed(2));
  // Easy should be forgiving, not unlosable. A player who barely touches the beat
  // has to be able to lose it, or the setting is decoration.
  const easySloppy = batch("easy", 0.15, 120);
  ok("Easy is not a guaranteed win even at 15% timing", easySloppy.wins < 0.99,
     easySloppy.wins.toFixed(2) + " win rate at 15% accuracy");
  ok("Hard is not a guaranteed loss", hard.wins > 0.05, hard.wins.toFixed(2));
  ok("a normal round lasts between 5 and 120 seconds",
     normal.avg > 5 && normal.avg < 120, normal.avg.toFixed(1) + " s average");
}

/* ---- 4. accuracy pays, and the grade tiers actually reach the score ------ */
{
  const sloppy = batch("normal", 0.15, 120);
  const sharp = batch("normal", 0.75, 120);
  ok("better timing wins more rounds", sharp.wins > sloppy.wins,
     sloppy.wins.toFixed(2) + " -> " + sharp.wins.toFixed(2));
  const perfects = sharp.out.reduce((a, r) => a + r.perfects, 0);
  ok("PERFECT hits actually happen in the model", perfects > 0, String(perfects));
  const scoring = batch("normal", 0.75, 20).out[0];
  ok("a resolved round has a winner or a double KO", scoring.win || scoring.draw || scoring.t < 240,
     JSON.stringify(scoring));
}

summary();
