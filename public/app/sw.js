/* Jom Baca! service worker: boleh guna offline. Naikkan VERSI bila app dikemas kini. */
const VERSI = "jb-v2.5.0";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-180.png", "./icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSI).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { mode: u.startsWith("http") ? "cors" : "same-origin" })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSI).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.pathname.startsWith("/api/")) return; // API sentiasa terus ke rangkaian
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(VERSI).then(x => x.put("./index.html", c)); return r; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  const ok = url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/.test(url.host);
  if (!ok) return;
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) { const c = r.clone(); caches.open(VERSI).then(x => x.put(req, c)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
