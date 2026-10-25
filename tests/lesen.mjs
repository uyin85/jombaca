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
// ---- aliran video pengguji
const raw = (m, p, buf, ct) => fetch(B + p, { method: m, headers: { "content-type": ct }, body: buf }).then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) }));
r = await req("GET", "/api/admin/list?t=licenses", null, A); const L2 = r.j.rows.find(x => x.key === key); ok(L2.expires > Date.now() + 9 * 864e5 && L2.expires < Date.now() + 11 * 864e5, "lesen pengguji tamat dalam 10 hari", L2);
r = await req("GET", "/api/tester/me?k=" + key); ok(r.j.ok && r.j.status === "trial" && r.j.days_left === 10, "status percubaan 10 hari", r.j);
r = await req("GET", "/api/tester/me?k=JB-AAAA-BBBB-CCCC"); ok(r.s === 404, "kod salah ditolak");
r = await raw("POST", `/api/tester/upload?k=${key}&type=usage`, new Uint8Array(10), "image/png"); ok(!r.j.ok, "bukan video ditolak", r.j);
r = await req("POST", "/api/tester/submit?k=" + key, { consent_review: true, summary: "x" }); ok(!r.j.ok && /kedua-dua/.test(r.j.error), "hantar tanpa video ditolak", r.j);
const vbuf = new Uint8Array(200000).map((_, i) => i % 251);
r = await raw("POST", `/api/tester/upload?k=${key}&type=usage`, vbuf, "video/mp4"); ok(r.j.ok && r.j.size === 200000, "video 1 dimuat naik", r.j);
r = await raw("POST", `/api/tester/upload?k=${key}&type=testi`, vbuf.slice(0, 150000), "video/quicktime"); ok(r.j.ok, "video 2 dimuat naik", r.j);
r = await req("GET", "/api/tester/me?k=" + key); ok(r.j.sub && r.j.sub.usage && r.j.sub.testi && r.j.sub.status === "draft", "draf ada 2 video", r.j);
r = await req("POST", "/api/tester/submit?k=" + key, { summary: "Anak saya suka sangat, dah boleh baca bola dan buku.", pub_parent: true }); ok(!r.j.ok, "tanpa izin semakan ditolak", r.j);
r = await req("POST", "/api/tester/submit?k=" + key, { summary: "Anak saya suka sangat, dah boleh baca bola dan buku.", consent_review: true, pub_parent: true }); ok(r.j.ok, "video dihantar untuk semakan", r.j);
r = await req("GET", "/api/tester/me?k=" + key); ok(r.j.status === "pending", "status menunggu semakan", r.j);
r = await raw("POST", `/api/tester/upload?k=${key}&type=usage`, vbuf, "video/mp4"); ok(!r.j.ok, "tak boleh muat naik semasa semakan", r.j);
r = await req("GET", "/api/admin/list?t=testers", null, A); let T = r.j.rows.find(x => x.key === key);
ok(T && T.status === "pending" && T.usage_url && T.testi_url && T.pub_parent === 1, "admin nampak pengguji + pautan video", T);
const priv = T.usage_url.replace(/^https?:\/\/[^/]+/, "");
let vr = await fetch(B + priv); ok(vr.status === 200 && (await vr.arrayBuffer()).byteLength === 200000, "video peribadi boleh dimainkan melalui pautan bertandatangan");
vr = await fetch(B + priv, { headers: { range: "bytes=100-199" } }); const vb = new Uint8Array(await vr.arrayBuffer());
ok(vr.status === 206 && vb.length === 100 && vb[0] === 100 % 251 && vr.headers.get("content-range") === "bytes 100-199/200000", "sokongan Range (seek video)", [vr.status, vb.length, vr.headers.get("content-range")]);
vr = await fetch(B + priv.replace(/s=[^&]+/, "s=salah")); ok(vr.status === 403, "tandatangan salah ditolak");
const objKey = decodeURIComponent(/k=([^&]+)/.exec(priv)[1]);
vr = await fetch(B + "/m/" + encodeURIComponent(objKey)); ok(vr.status === 404, "video pengguji TIDAK boleh dibuka melalui /m/ awam");
// tolak, kemudian hantar semula, kemudian lulus
await act("tester_reject", { id: T.sub_id, reason: "Suara anak tak jelas" });
r = await req("GET", "/api/tester/me?k=" + key); ok(r.j.status === "trial" && r.j.sub.status === "rejected" && /tak jelas/.test(r.j.sub.reason), "ditolak dengan sebab, boleh hantar semula", r.j);
r = await raw("POST", `/api/tester/upload?k=${key}&type=usage`, vbuf, "video/mp4"); ok(r.j.ok, "muat naik semula selepas ditolak");
r = await raw("POST", `/api/tester/upload?k=${key}&type=testi`, vbuf, "video/mp4");
r = await req("POST", "/api/tester/submit?k=" + key, { summary: "Lepas 8 hari anak saya dah boleh baca ayat pendek sendiri. Terbaik.", consent_review: true, pub_parent: true, pub_child: false }); ok(r.j.ok, "hantar semula");
r = await req("GET", "/api/admin/list?t=testers", null, A); T = r.j.rows.find(x => x.key === key);
await act("tester_approve", { id: T.sub_id });
r = await req("GET", "/api/tester/me?k=" + key); ok(r.j.status === "approved", "diluluskan", r.j);
r = await req("GET", "/api/admin/list?t=licenses", null, A); ok(r.j.rows.find(x => x.key === key).expires === null, "lesen jadi seumur hidup (tiada tarikh tamat)");
r = await req("GET", "/api/admin/list?t=testimonials", null, A); ok(r.j.rows.some(x => x.lic === key && /ayat pendek/.test(x.text) && x.status === "pending"), "testimoni draf dicipta (izin siar ibu bapa)");
r = await req("POST", "/api/tester/submit?k=" + key, { consent_review: true }); ok(!r.j.ok && /seumur hidup/.test(r.j.error), "tiada lagi muat naik selepas lulus");
// pengguji kedua: percubaan tamat
r = await req("GET", "/api/admin/list?t=licenses", null, A); const k2 = r.j.rows.find(x => x.kind === "tester" && x.key !== key).key;
r = await req("POST", "/api/license/activate", { key: k2, device: "d-x" }); ok(r.j.ok && r.j.trial_days === 10, "aktif pengguji 2, baki 10 hari", r.j); const tk2 = r.j.token;
r = await req("GET", "/api/content", null, { "x-lic": tk2 }); ok(r.s === 200 && r.j.trial_days === 10, "kandungan beri baki hari");
await act("tester_extend", { key: k2, days: -1 });
r = await req("GET", "/api/content", null, { "x-lic": tk2 }); ok(r.s === 403 && r.j.expired, "kandungan disekat bila percubaan tamat", r.j);
r = await req("POST", "/api/license/activate", { key: k2, device: "d-y" }); ok(!r.j.ok && r.j.expired && r.j.upload.includes(k2), "aktivasi tamat beri pautan muat naik", r.j);
r = await req("GET", "/api/tester/me?k=" + k2); ok(r.j.status === "expired", "status tamat", r.j);
r = await raw("POST", `/api/tester/upload?k=${k2}&type=usage`, vbuf, "video/mp4"); ok(r.j.ok, "tamat pun masih boleh muat naik video");
await act("tester_extend", { key: k2, days: 10 });
// pengawas
r = await req("GET", "/api/admin/overview", null, A); ok(Array.isArray(r.j.health) && r.j.health.length >= 8, "kad kesihatan Pengawas", r.j.health && r.j.health.map(h => h.name));
r = await req("GET", "/api/admin/list?t=settings", null, A); ok(!r.j.rows.some(x => /^wd:/.test(x.k)), "kunci dalaman Pengawas tersembunyi");
await act("setting_set", { k: "tester_slots", v: "10" });
console.log(fails ? `\n${fails} GAGAL` : "\nSEMUA LULUS");
