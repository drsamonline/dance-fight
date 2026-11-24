#!/usr/bin/env node
/* App version drift for Dance Fight.
 *
 * The service worker names its cache after the build in its own URL, so the
 * stale-cache bug that shipped once cannot come back — unless APP_VER is not
 * bumped. That is a one-line human step, and a forgotten one silently freezes
 * every returning player on the previous build. This gate makes the step
 * explicit: an unreleased tree must say so, a clean changelog must not.
 *
 * It also checks that the worker still derives its cache from the query string,
 * because that is the mechanism the whole defence rests on.
 *
 *   node tools/ver-check.mjs [repo root]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] || resolve(here, "..");

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

const html = readFileSync(resolve(root, "docs/play/index.html"), "utf8");
const sw = readFileSync(resolve(root, "docs/play/sw.js"), "utf8");
const version = readFileSync(resolve(root, "VERSION"), "utf8").trim();
const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");

const m = html.match(/var APP_VER = "([^"]+)";/);
ok("the page declares APP_VER", !!m, m ? m[1] : "missing");
if (!m) summary();
const appVer = m[1];

ok("APP_VER looks like a version", /^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/.test(appVer), appVer);

/* Unreleased work is marked as such; a released tree must not be. */
const unreleasedBlock = (changelog.split(/^## /m)[1] || "");
const hasUnreleased = /^Unreleased/m.test(unreleasedBlock) &&
  /(^|\n)- /.test(unreleasedBlock.replace(/^Unreleased[^\n]*\n/, ""));
ok("APP_VER says -unreleased exactly when the changelog has unreleased entries",
   hasUnreleased ? /-unreleased$/.test(appVer) : !/-unreleased$/.test(appVer),
   "changelog unreleased=" + hasUnreleased + ", APP_VER=" + appVer);

/* The numeric part must be at least the released VERSION, never behind it. */
const nums = (s) => s.split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
const [a1, a2, a3] = nums(appVer);
const [v1, v2, v3] = nums(version);
const cmp = a1 - v1 || a2 - v2 || a3 - v3;
ok("APP_VER is not behind VERSION (" + version + ")", cmp >= 0, appVer + " < " + version);

/* A bump has to be a real bump: the page must not reuse the released number as
   "unreleased", or every unreleased build would share one cache. */
ok("an unreleased build is ahead of the released VERSION", !hasUnreleased || cmp > 0,
   "APP_VER " + appVer + " vs VERSION " + version);

/* ---- the mechanism ------------------------------------------------------- */
ok("the page registers the worker with the version in its URL",
   /sw\.js\?v=" \+ encodeURIComponent\(APP_VER\)/.test(html),
   "registration is not versioned");
ok("the worker reads the version from its own URL",
   /searchParams\.get\("v"\)/.test(sw), "sw.js does not parse ?v=");
ok("the worker names its cache after that version",
   /"dance-fight-" \+ VER/.test(sw), "cache name is not derived from VER");
ok("the worker only prunes its own caches",
   /indexOf\("dance-fight-"\) === 0/.test(sw) || /startsWith\("dance-fight-"\)/.test(sw),
   "pruning is not scoped to dance-fight-*");
ok("navigations bypass the HTTP cache", /cache:\s*"no-store"/.test(sw), "no no-store navigation");

summary();
