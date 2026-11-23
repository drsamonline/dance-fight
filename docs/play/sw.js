/* Dance Fight — offline shell.
 *
 * The whole game is one HTML file, so "offline support" is three assets and a
 * fallback. Network-first: a fresh copy is always preferred when there is a
 * connection, and the cached copy is what the player gets on a train.
 *
 * The cache is named after the version in the script URL. The page registers
 * "sw.js?v=<build>" and this worker takes its cache name from that query, so a
 * new build installs a worker with an empty cache instead of serving the
 * previous build's HTML out of the old one for the rest of the session. A
 * navigation is fetched with no-store for the same reason: the HTTP cache must
 * not answer for the network.
 */
var VER = "1";
try { VER = new URL(self.location.href).searchParams.get("v") || "1"; } catch (e) {}
var CACHE = "dance-fight-" + VER.replace(/[^0-9A-Za-z._-]/g, "");
var ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon.png", "./icon.svg"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // addAll fails the whole install if one icon is missing, so add singly
      return Promise.all(ASSETS.map(function (url) {
        return c.add(url).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      // Every version but this one: the old shell cannot come back.
      return Promise.all(keys.filter(function (k) {
        return k.indexOf("dance-fight-") === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  var opts = req.mode === "navigate" ? { cache: "no-store" } : undefined;

  e.respondWith(
    fetch(req, opts).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        if (req.mode === "navigate") return caches.match("./index.html");
        return new Response("offline", { status: 503, statusText: "offline" });
      });
    })
  );
});
