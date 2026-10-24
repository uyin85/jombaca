// Bina satu fail Worker (dist/jombaca-worker.js) yang mengandungi semua laman awam,
// supaya boleh ditampal terus dalam Cloudflare Dashboard → Quick Edit (tanpa wrangler).
// Guna: node tools/build-quickedit.mjs
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pub = path.join(root, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const files = {};
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    const ext = path.extname(f), rel = "/" + path.relative(pub, p).split(path.sep).join("/");
    const bin = ext === ".png";
    files[rel] = [TYPES[ext] || "application/octet-stream", bin ? fs.readFileSync(p).toString("base64") : fs.readFileSync(p, "utf8"), bin ? 1 : 0];
  }
})(pub);
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist", "_assets.gen.js"), "export default " + JSON.stringify(files) + ";\n");
fs.writeFileSync(path.join(root, "dist", "_entry.js"), `
import worker from "../src/worker.js";
import FILES from "./_assets.gen.js";
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
function serve(req) {
  const url = new URL(req.url); let p = decodeURIComponent(url.pathname);
  if (p.endsWith(".html") && p !== "/index.html" && p !== "/app/index.html") { const clean = p.slice(0, -5); return Response.redirect(url.origin + clean + url.search, 307); }
  if (!p.endsWith("/") && !FILES[p] && FILES[p + "/index.html"]) return Response.redirect(url.origin + p + "/" + url.search, 307);
  const f = FILES[p] || FILES[p + ".html"] || (p.endsWith("/") ? FILES[p + "index.html"] : null);
  if (!f) return new Response("Tidak dijumpai", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const html = f[0].startsWith("text/html");
  return new Response(f[2] ? b64(f[1]) : f[1], { headers: { "content-type": f[0], "cache-control": html || p.endsWith("sw.js") ? "no-cache" : "public, max-age=86400" } });
}
const ASSETS = { fetch: req => serve(req) };
export default {
  fetch(req, env, ctx) { return worker.fetch(req, Object.assign(Object.create(env), { ASSETS }), ctx); },
  scheduled(ev, env, ctx) { return worker.scheduled(ev, env, ctx); },
};
`);
await build({
  entryPoints: [path.join(root, "dist", "_entry.js")], bundle: true, format: "esm", platform: "neutral",
  outfile: path.join(root, "dist", "jombaca-worker.js"), loader: { ".html": "text", ".json": "json" }, legalComments: "none",
  banner: { js: "// Jom Baca HQ: fail tunggal untuk Cloudflare Quick Edit. Jana oleh tools/build-quickedit.mjs. Jangan edit terus; edit src/ dan bina semula." },
});
fs.rmSync(path.join(root, "dist", "_assets.gen.js")); fs.rmSync(path.join(root, "dist", "_entry.js"));
console.log("dist/jombaca-worker.js", fs.statSync(path.join(root, "dist", "jombaca-worker.js")).size, "bait");
