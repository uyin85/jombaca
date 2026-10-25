// Ujian Program Pengguji & kawalan perkongsian lesen. Guna: node tests/lesen.mjs http://127.0.0.1:8787 (ADMIN_KEY=admintest)
const B = process.argv[2]; let fails = 0;
const H = { "content-type": "application/json" }, A = { "x-admin-key": "admintest" };
const req = async (m, p, body, h = {}) => { const r = await fetch(B + p, { method: m, headers: { ...H, ...h }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { s: r.status, j }; };
const ok = (c, m, x) => { if (!c) { fails++; console.log("❌", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } else console.log("✅", m); };
const act = (a, o = {}) => req("POST", "/api/admin/act", { a, ...o }, A);

await act("setting_set", { k: "tester_slots", v: "2" });
let r = await req("GET", "/api/tester"); ok(r.j.open && r.j.left === 2, "tester status 2 tempat", r.j);
r = await req("POST", "/api/tester", { name: "Puan Aina", email: "aina.t@example.com", phone: "0123000001", child_age: "5 tahun", needs: "Autisme" }); ok(!r.j.ok, "tolak tanpa persetujuan", r.j);
r = await req("POST", "/api/tester", { name: "Puan Aina", email: "aina.t@example.com", phone: "0123000001", child_age: "5 tahun", needs: "Autisme", agree: true }); ok(r.j.ok && r.j.key && r.j.left === 1, "pengguji 1 dapat lesen", r.j);
const key = r.j.key;
r = await req("POST", "/api/tester", { name: "Aina lagi", email: "aina.t@example.com", phone: "0199999999", agree: true }); ok(!r.j.ok, "tolak emel berulang", r.j);
r = await req("POST", "/api/tester", { name: "Cikgu Ros", email: "ros.t@example.com", phone: "0123000002", agree: true }); ok(r.j.ok && r.j.left === 0, "pengguji 2 (tempat terakhir)", r.j);
r = await req("POST", "/api/tester", { name: "Ketiga", email: "tiga@example.com", phone: "0123000003", agree: true }); ok(!r.j.ok && /penuh/.test(r.j.error), "tolak bila penuh", r.j);
r = await req("GET", "/api/tester"); ok(!r.j.open && r.j.left === 0, "status penuh", r.j);
r = await req("GET", "/api/admin/list?t=emails", null, A); ok(r.j.rows.some(e => e.kind === "tester_fb" && e.send_at > Date.now() + 6 * 864e5), "emel maklum balas hari ke-7 dijadualkan");
// had peranti 3
const toks = [];
for (let i = 1; i <= 3; i++) { r = await req("POST", "/api/license/activate", { key, device: "dev-" + i }); toks.push(r.j.token); ok(r.j.ok, "aktif peranti " + i); }
r = await req("POST", "/api/license/activate", { key, device: "dev-4" }); ok(!r.j.ok && r.j.limit, "peranti ke-4 ditolak (had 3)", r.j);
r = await req("POST", "/api/license/activate", { key, device: "dev-1" }); ok(r.j.ok, "peranti sedia ada masih boleh aktif semula");
r = await req("GET", "/api/admin/list?t=licenses", null, A); const L = r.j.rows.find(x => x.key === key); ok(L && L.kind === "tester" && L.devices === 3 && L.fails === 1, "lesen: jenis tester, 3 peranti, 1 cubaan gagal", L);
r = await req("POST", "/api/license/reset-request", { key }); ok(r.j.ok, "permintaan reset (respons sama walau kod salah)");
r = await req("POST", "/api/license/reset-request", { key: "JB-SALAH" }); ok(r.j.ok, "permintaan reset kod salah tak dedahkan apa-apa");
r = await req("GET", "/api/license/reset?k=" + key + "&s=salah"); ok(String(r.j).includes("tidak sah"), "reset dengan tandatangan salah ditolak");
r = await req("GET", "/api/content", null, { "x-lic": toks[0] }); ok(r.s === 200 && r.j.levels, "kandungan untuk peranti sah");
await act("lic_reset", { key });
r = await req("GET", "/api/content", null, { "x-lic": toks[0] }); ok(r.s === 403 && r.j.removed, "peranti dikeluarkan hilang akses", r.j);
await act("lic_status", { key, status: "revoked" });
r = await req("POST", "/api/license/activate", { key, device: "dev-9" }); ok(!r.j.ok, "lesen dibatalkan tak boleh aktif");
await act("lic_status", { key, status: "active" });
// testimoni
r = await req("POST", "/api/testimonial", { text: "pendek", name: "x" }); ok(!r.j.ok, "testimoni terlalu pendek ditolak");
r = await req("POST", "/api/testimonial", { text: "Anak saya suka kumpul bintang dan dah boleh baca bola, buku.", name: "Puan Aina, Kajang", rating: 5, consent: true, key }); ok(r.j.ok, "testimoni pengguji dihantar");
r = await req("POST", "/api/testimonial", { text: "Suara kurang jelas di telefon saya, tolong baiki.", name: "Ibu X", rating: 3, consent: false }); ok(r.j.ok, "maklum balas tanpa izin dihantar");
r = await req("GET", "/api/admin/list?t=testimonials", null, A);
const tt = r.j.rows.find(x => x.consent === 1), tn = r.j.rows.find(x => x.consent === 0);
ok(tt && tt.kind === "tester" && tt.rating === 5, "testimoni ditanda tester + rating", tt);
await act("testimonial_status", { id: tt.id, status: "approved" });
r = await req("GET", "/api/lp"); ok(r.j.testimonials.length === 1 && r.j.testimonials[0].kind === "tester", "laman jualan papar testimoni dengan jenis", r.j.testimonials);
ok(!r.j.testimonials.some(x => x.text.includes("kurang jelas")), "maklum balas tanpa izin tidak disiarkan");
await act("setting_set", { k: "tester_slots", v: "10" });
console.log(fails ? `\n${fails} GAGAL` : "\nSEMUA LULUS");
