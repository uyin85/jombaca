const B = process.argv[2]; let fails = 0;
const H = { "content-type": "application/json" };
const req = async (m, p, body, h = {}) => { const r = await fetch(B + p, { method: m, headers: { ...H, ...h }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { s: r.status, j, loc: r.headers.get("location") }; };
const ok = (c, m, x) => { if (!c) { fails++; console.log("❌", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } else console.log("✅", m); };
const A = { "x-admin-key": "admintest" }, BR = { "x-brain-key": "braintest" };

let r = await req("GET", "/api/lp?src=p1"); ok(r.j.v && r.j.v.headline, "lp variants");
const vids = Object.values(r.j.v).map(v => v.id);
// brain: posts first so /s/ works
r = await req("POST", "/api/brain/write", { kind: "posts", agent: "social", rows: [{ platform: "threads", angle: "darjah_satu", hook: "h", body: "Test post {LINK}", scheduled_at: Date.now() - 1000 }, { platform: "tiktok", angle: "demo_app", hook: "h2", body: "skrip tiktok", scheduled_at: Date.now() + 3600e3 }] }, BR);
ok(r.j.ok && r.j.inserted === 2, "brain posts", r.j);
r = await req("GET", "/s/1"); ok(r.s === 302 && r.loc.includes("src=p1"), "post click redirect", r);
r = await req("POST", "/api/lead", { name: "Aina", phone: "012-3456789", email: "aina@example.com", child_age: "5 tahun", src: "p1", vids }); ok(r.j.ok, "lead", r.j);
r = await req("POST", "/api/lead", { name: "Aina", phone: "0123456789", email: "aina@example.com" }); ok(r.j.ok, "lead dedupe");
// affiliate signup
r = await req("POST", "/api/aff/signup", { name: "Cikgu Ros", email: "ros@example.com", phone: "0191112222", handle: "@cikguros" }); ok(r.j.ok && r.j.code, "aff signup", r.j);
const aff = r.j;
r = await req("GET", "/r/" + aff.code); ok(r.s === 302, "ref redirect");
// coupon via brain
r = await req("POST", "/api/brain/write", { kind: "coupon", code: "GAJI", pct: 50, hours: 24, promo: true, label: "Promo gaji" }, BR); ok(r.j.ok && r.j.off === 500, "coupon floor respected (off=500)", r.j);
r = await req("GET", "/api/lp?lite=1"); ok(r.j.price_label === "RM15" && r.j.promo, "promo price RM15", r.j);
// checkout
r = await req("POST", "/api/checkout", { name: "Aina Binti Ali", email: "aina@example.com", phone: "0123456789", coupon: "GAJI", ref: aff.code, src: "p1", vids }); ok(r.j.ok && r.j.manual, "checkout manual mode", r.j);
const url = new URL(r.j.url); const o = url.searchParams.get("o"), t = url.searchParams.get("t");
r = await req("GET", `/api/order?o=${o}&t=${t}`); ok(r.j.status === "pending" && r.j.manual_text, "order pending");
r = await req("GET", `/api/order?o=${o}&t=bad`); ok(r.s === 404, "order bad token 404");
r = await req("POST", "/api/admin/act", { a: "order_paid", id: o }, A); ok(r.j.ok, "admin mark paid", r.j);
r = await req("GET", `/api/order?o=${o}&t=${t}`); ok(r.j.status === "paid" && r.j.license && r.j.aff, "order paid w/ license", r.j);
const key = r.j.license;
r = await req("POST", "/api/license/activate", { key, device: "dev-1" }); ok(r.j.ok && r.j.token && r.j.pack.levels.length === 28, "activate + pack", { ok: r.j.ok, n: r.j.pack && r.j.pack.levels.length, e: r.j.error });
const tok = r.j.token;
for (let i = 2; i <= 5; i++) await req("POST", "/api/license/activate", { key, device: "dev-" + i });
r = await req("POST", "/api/license/activate", { key, device: "dev-6" }); ok(!r.j.ok, "device limit 5");
r = await req("GET", "/api/content", null, { "x-lic": tok }); ok(r.j.levels && r.j.levels.length === 28, "content with token");
r = await req("GET", "/api/content", null, { "x-lic": tok.slice(0, -2) + "xx" }); ok(r.s === 401, "content bad token 401");
// telemetry
r = await req("POST", "/api/ev", { iid: "x", ev: [["open", 0], ["lvl_done", { l: 3 }], ["paywall", { s: "map" }], ["evil", 0]], it: [["ba", 5, 2], ["bo", 4, 4]] }); ok(r.j.ok, "telemetry");
// pack
r = await req("POST", "/api/brain/write", { kind: "pack", agent: "product", title: "Cerita Pasar Malam", en: "Night market", icon: "🏮", items: ["ibu ke pasar malam. ibu beli sate🍢", "adik suka air tebu. air tebu sejuk🥤", "ayah beli roti john. roti itu sedap🥖", "kami balik rumah. kami sangat gembira🏠"], safe: true }, BR);
ok(r.j.ok, "pack write", r.j);
r = await req("GET", "/api/content", null, { "x-lic": tok }); ok(r.j.packs && r.j.packs.length === 1, "pack live in content");
// flow
r = await req("POST", "/api/brain/write", { kind: "flow", agent: "creative", rows: [{ title: "Monyet ajar bo-la", angle: "demo_app", prompt: { scenes: [1] }, caption: "Caption {LINK}", platforms: ["tiktok", "threads"] }] }, BR); ok(r.j.ok && r.j.inserted === 1, "flow job", r.j);
r = await req("GET", "/api/flow/next?account=A", null, { "x-flow-key": "flowtest" }); ok(r.j.job && r.j.job.prompt.scenes, "flow next", r.j);
const jid = r.j.job && r.j.job.id;
r = await req("POST", "/api/flow/done", { id: jid, video_url: "https://example.com/v.mp4" }, { "x-flow-key": "flowtest" }); ok(r.j.ok, "flow done -> posts");
// brain state
r = await req("GET", "/api/brain/state?agent=ceo", null, BR); ok(r.j.metrics && r.j.metrics.today.sale === 1 && r.j.app.hardest_items, "brain state", { sale: r.j.metrics && r.j.metrics.today, hard: r.j.app && r.j.app.hardest_items });
ok(r.j.flow.budget[0].used === 20, "flow budget used", r.j.flow.budget);
ok(r.j.variants.some(v => v.conv === 1), "variant conv attributed");
ok(r.j.angles.find(a => a.name === "darjah_satu").sales === 1, "angle sale attributed", r.j.angles);
r = await req("POST", "/api/brain/claim", { agent: "ceo", slot: "2026-10-25" }, BR); ok(r.j.ok, "claim 1");
r = await req("POST", "/api/brain/claim", { agent: "ceo", slot: "2026-10-25" }, BR); ok(!r.j.ok, "claim 2 rejected");
for (const k of ["learnings", "plan", "proposals", "prompt", "leads", "variants", "settings", "run", "angles"]) {
  const body = { kind: k, agent: "test", rows: [{ text: "x", title: "t", id: 1, score: 80, wa_msg: "hai", slot: "headline", name: "baru" }], plan: { focus: "x" }, target: "social", addendum: "Guna ayat pendek", retire: [], set: { aff_swipe: [{ platform: "WhatsApp", text: "Cuba {LINK}" }] }, status: "ok", summary: "s" };
  r = await req("POST", "/api/brain/write", body, BR); ok(r.j.ok, "brain write " + k, r.j);
}
r = await req("GET", `/api/aff/me?code=${aff.code}&k=${aff.k}`); ok(r.j.ok && r.j.sales === 1 && r.j.swipe[0].text.includes("/r/" + aff.code), "aff dashboard", r.j);
// admin
r = await req("GET", "/api/admin/overview", null, A); ok(r.j.today && r.j.today.sale === 1, "admin overview");
for (const t of ["posts", "leads", "orders", "affiliates", "commissions", "variants", "flow", "packs", "learnings", "proposals", "testimonials", "coupons", "runs", "emails", "angles", "prompts", "plans", "settings", "app"]) { r = await req("GET", "/api/admin/list?t=" + t, null, A); ok(Array.isArray(r.j.rows), "admin list " + t, r.j); }
r = await req("GET", "/api/admin/list?t=commissions", null, A); ok(r.j.rows[0] && r.j.rows[0].amount === 600, "commission 40% of RM15 = 600", r.j.rows[0]);
r = await req("POST", "/api/admin/act", { a: "tick" }, A); ok(r.j.ok, "cron tick");
r = await req("GET", "/api/admin/list?t=posts", null, A); console.log("   post statuses:", r.j.rows.map(p => p.platform + ":" + p.status).join(", "));
r = await req("GET", "/api/admin/overview", null, {}); ok(r.s === 401, "admin auth required");
r = await req("GET", "/api/brain/state", null, { "x-brain-key": "no" }); ok(r.s === 401, "brain auth required");
r = await req("POST", "/api/admin/act", { a: "order_refund", id: o }, A);
r = await req("GET", "/api/content", null, { "x-lic": tok }); ok(r.s === 403 && r.j.revoked, "refund revokes license");
for (const pth of ["/", "/app/", "/terima-kasih", "/affiliate", "/kad-percuma", "/privasi", "/admin", "/site.css", "/app/sw.js"]) { const x = await fetch(B + pth); ok(x.status === 200, "page " + pth + " " + x.status); }
console.log(fails ? `\n${fails} GAGAL` : "\nSEMUA LULUS");
