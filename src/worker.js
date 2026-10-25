/**
 * JOM BACA HQ: "badan" sistem jualan auto.
 * Satu Cloudflare Worker: laman jualan + app (static assets), API lesen, checkout ToyyibPay,
 * leads, affiliate, tracking, A/B (Thompson sampling), auto-post sosial, emel nurture,
 * dan API untuk "otak" (agen AI di Modal / GitHub Actions / Hermes).
 */
import CORE from "./content/core.json";
import ADMIN_HTML from "./admin.html";

const MYT = 8 * 3600e3;
const DAY = 86400e3;
const now = () => Date.now();
const mytDay = (t = now()) => new Date(t + MYT).toISOString().slice(0, 10);
const mytHour = (t = now()) => new Date(t + MYT).getUTCHours();
const daysAgo = n => mytDay(now() - n * DAY);
const J = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...h } });
const bad = (m, s = 400) => J({ ok: false, error: m }, s);
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
const rnd = (n = 16) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, "0")).join("");
const parseJ = (s, d) => { try { const v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } };
const rm = sen => "RM" + (sen % 100 ? (sen / 100).toFixed(2) : String(sen / 100));
const cleanPhone = p => { let d = String(p || "").replace(/\D/g, ""); if (d.startsWith("0")) d = "6" + d; if (d && !d.startsWith("60") && d.length <= 10) d = "60" + d; return d.length >= 10 && d.length <= 13 ? d : ""; };
const okEmail = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(String(e || ""));

/* ------------------------------------------------------------------ */
/* Skema D1 (auto-migrate, tak perlu jalankan SQL manual)              */
/* ------------------------------------------------------------------ */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS stats(day TEXT, k TEXT, n INTEGER DEFAULT 0, PRIMARY KEY(day,k))`,
  `CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, tok TEXT, created INTEGER, name TEXT, email TEXT, phone TEXT, amount INTEGER, coupon TEXT, ref TEXT, src TEXT, vids TEXT, status TEXT, billcode TEXT, pay_url TEXT, paid_at INTEGER, license TEXT, note TEXT)`,
  `CREATE TABLE IF NOT EXISTS licenses(key TEXT PRIMARY KEY, order_id TEXT, email TEXT, name TEXT, created INTEGER, devices TEXT DEFAULT '[]', status TEXT DEFAULT 'active')`,
  `CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER, name TEXT, email TEXT, phone TEXT, child_age TEXT, src TEXT, ref TEXT, vids TEXT, score INTEGER DEFAULT 0, stage TEXT DEFAULT 'new', wa_msg TEXT, notes TEXT, unsub INTEGER DEFAULT 0, bought INTEGER DEFAULT 0, contacted INTEGER DEFAULT 0, updated INTEGER)`,
  `CREATE INDEX IF NOT EXISTS leads_email ON leads(email)`,
  `CREATE INDEX IF NOT EXISTS leads_phone ON leads(phone)`,
  `CREATE TABLE IF NOT EXISTS affiliates(code TEXT PRIMARY KEY, token TEXT, name TEXT, email TEXT, phone TEXT, handle TEXT, payout TEXT, rate INTEGER, status TEXT DEFAULT 'active', created INTEGER, buyer INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS commissions(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, order_id TEXT, amount INTEGER, status TEXT DEFAULT 'pending', created INTEGER, paid_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS variants(id INTEGER PRIMARY KEY AUTOINCREMENT, slot TEXT, text TEXT, status TEXT DEFAULT 'live', views INTEGER DEFAULT 0, leads INTEGER DEFAULT 0, conv INTEGER DEFAULT 0, created INTEGER, agent TEXT)`,
  `CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER, platform TEXT, angle TEXT, hook TEXT, body TEXT, media_url TEXT, flow_id INTEGER, scheduled_at INTEGER, status TEXT, posted_at INTEGER, ext_id TEXT, clicks INTEGER DEFAULT 0, leads INTEGER DEFAULT 0, sales INTEGER DEFAULT 0, error TEXT, agent TEXT)`,
  `CREATE INDEX IF NOT EXISTS posts_due ON posts(status, scheduled_at)`,
  `CREATE TABLE IF NOT EXISTS flow_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER, account TEXT, title TEXT, angle TEXT, prompt TEXT, caption TEXT, platforms TEXT, credits INTEGER, status TEXT DEFAULT 'queued', video_url TEXT, done_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS emails(id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER, lead_id INTEGER, to_email TEXT, subject TEXT, html TEXT, send_at INTEGER, status TEXT DEFAULT 'queued', sent_at INTEGER, kind TEXT, clicks INTEGER DEFAULT 0, error TEXT)`,
  `CREATE INDEX IF NOT EXISTS emails_due ON emails(status, send_at)`,
  `CREATE TABLE IF NOT EXISTS learnings(id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER, agent TEXT, text TEXT, evidence TEXT, score REAL DEFAULT 1, status TEXT DEFAULT 'active')`,
  `CREATE TABLE IF NOT EXISTS plans(day TEXT PRIMARY KEY, json TEXT, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS agent_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, agent TEXT, status TEXT, summary TEXT, error TEXT, llm TEXT)`,
  `CREATE TABLE IF NOT EXISTS agent_prompts(id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT, addendum TEXT, created INTEGER, active INTEGER DEFAULT 1, reason TEXT)`,
  `CREATE TABLE IF NOT EXISTS angles(name TEXT PRIMARY KEY, description TEXT, posts INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, leads INTEGER DEFAULT 0, sales INTEGER DEFAULT 0, status TEXT DEFAULT 'active', created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS packs(id TEXT PRIMARY KEY, title TEXT, en TEXT, icon TEXT, items TEXT, status TEXT, created INTEGER, agent TEXT, note TEXT)`,
  `CREATE TABLE IF NOT EXISTS coupons(code TEXT PRIMARY KEY, pct INTEGER DEFAULT 0, off INTEGER DEFAULT 0, expires INTEGER, max_uses INTEGER DEFAULT 0, used INTEGER DEFAULT 0, note TEXT, created INTEGER, agent TEXT)`,
  `CREATE TABLE IF NOT EXISTS testimonials(id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER, name TEXT, text TEXT, status TEXT DEFAULT 'pending')`,
  `CREATE TABLE IF NOT EXISTS claims(agent TEXT, slot TEXT, ts INTEGER, PRIMARY KEY(agent, slot))`,
  `CREATE TABLE IF NOT EXISTS tester_subs(id INTEGER PRIMARY KEY AUTOINCREMENT, lic TEXT, created INTEGER, updated INTEGER, usage_key TEXT, usage_size INTEGER, testi_key TEXT, testi_size INTEGER, summary TEXT, consent_review INTEGER DEFAULT 0, pub_parent INTEGER DEFAULT 0, pub_child INTEGER DEFAULT 0, status TEXT DEFAULT 'draft', reason TEXT, reviewed_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS proposals(id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER, agent TEXT, kind TEXT, title TEXT, body TEXT, status TEXT DEFAULT 'open')`,
];
const SCHEMA_V = "5";

const DEFAULTS = {
  brand: "Jom Baca!",
  price_sen: "2000",
  floor_sen: "1500",            // harga paling rendah selepas diskaun (pengawal agen)
  aff_rate_pct: "40",           // komisen affiliate % (RM8 untuk RM20)
  guarantee_days: "0",          // 0 = tak papar jaminan. Tetapkan 7 jika anda sanggup refund 7 hari
  auto_post: "1",
  auto_variants: "1",
  auto_publish_packs: "1",
  auto_coupons: "1",
  max_posts_day: "10",
  daily_sales_target: "5",
  flow_accounts: "A,B,C",
  flow_credits_month: "1000",
  flow_cost: "20",              // kredit per video Veo (Fast). Ubah ikut Flow semasa
  wa_number: "",                // no WhatsApp sokongan, cth 60123456789
  support_email: "",
  email_from: "",               // cth: Jom Baca <hello@domainanda.com>
  email_reply_to: "",           // balasan pelanggan pergi ke sini (cth Gmail anda) jika alamat penghantar tiada peti masuk
  toyyib_sandbox: "0",          // 1 = guna ToyyibPay sandbox (dev.toyyibpay.com) untuk ujian
  manual_pay_text: "Pembayaran dalam talian sedang disediakan. Kami akan hubungi anda melalui WhatsApp untuk melengkapkan pembelian.",
  promo: "",                    // JSON {code,label,until}
  aff_swipe: "[]",
  max_devices: "3",            // had peranti setiap lesen
  tester_slots: "10",           // bilangan tempat Program Pengguji Awal
  tester_open: "1",             // 1 = pendaftaran pengguji dibuka
  tester_trial_days: "10",      // tempoh Pro percubaan pengguji sebelum video diluluskan
  video_keep_days: "90",        // video pengguji dipadam selepas N hari (kecuali ada izin siar)
  tg_alerts: "1",               // 1 = Pengawas hantar amaran Telegram
  nurture_tpl: "",
};

const SEED_VARIANTS = {
  headline: [
    "Anak dah kenal huruf tapi masih belum boleh membaca? Mulakan dengan suku kata, 10 minit sehari.",
    "Dari 'a, i, u' ke baca cerita sendiri, dengan aplikasi yang mendengar anak membaca.",
    "Sebelum masuk Darjah 1, pastikan anak boleh membaca. Belajar di rumah, 10 minit sehari.",
  ],
  sub: [
    "Jom Baca! ajar Bahasa Melayu suku kata demi suku kata. Anak sebut, aplikasi dengar dan beri bintang. Sesuai 4 hingga 8 tahun, termasuk anak autisme dan disleksia.",
    "40 tahap ikut pola suku kata KV, KVK dan KVKK seperti di sekolah, dari huruf hingga soalan pemahaman. Misi Harian 10 minit dan laporan kemajuan untuk ibu bapa. Bayar sekali, guna selamanya.",
  ],
  cta: ["Dapatkan Jom Baca Pro", "Ya, saya mahu anak saya membaca", "Mula sekarang, RM20 sahaja"],
};
const SEED_ANGLES = [
  ["kenal_huruf_tak_baca", "Anak kenal huruf tapi belum boleh gabung jadi bacaan; suku kata ialah jambatan"],
  ["darjah_satu", "Persediaan sebelum masuk Darjah 1 / tadika; ibu bapa risau anak ketinggalan"],
  ["screen_time_berfaedah", "Tukar screen time kosong jadi 10 minit belajar membaca"],
  ["ibu_bekerja", "Ibu bapa sibuk: rutin 10 minit selepas makan malam, app yang membimbing"],
  ["kos_tuisyen", "Bandingkan kos kelas tuisyen membaca vs RM20 sekali bayar"],
  ["autisme_disleksia", "Mod Tenang & Baca Dulu untuk anak autisme/disleksia; guru pemulihan"],
  ["demo_app", "Tunjuk app sebenar: anak sebut, bintang muncul, gambar jadi 3D"],
  ["tips_membaca", "Tips nilai: cara ajar suku kata di rumah (kandungan percuma, bina kepercayaan)"],
  ["cikgu_tadika", "Cikgu tadika / guru pemulihan guna untuk kelas: profil murid & bahan cetak"],
];

const NURTURE_DEFAULT = [
  { d: 0, s: "Jadual Suku Kata percuma untuk {child} 🎁", b: "<p>Hai {name},</p><p>Terima kasih! Ini <b>Jadual Suku Kata</b> yang boleh dicetak dan ditampal di dinding:</p><p><a href=\"{magnet}\">👉 Buka &amp; cetak Jadual Suku Kata</a></p><p>Cara guna: tunjuk satu baris sehari (contoh: ba, bi, bu, be, bo), sebut bersama-sama, kemudian minta {child} cari suku kata itu dalam buku.</p><p>Nak cuba cara yang lebih seronok? Aplikasi <b>Jom Baca!</b> boleh dicuba percuma, dan ia <i>mendengar</i> anak membaca:</p><p><a href=\"{app}\">👉 Cuba Jom Baca percuma</a></p>" },
  { d: 1, s: "Kenapa anak 'tahu huruf' tapi masih tak boleh membaca?", b: "<p>Hai {name},</p><p>Ramai anak boleh sebut A, B, C tetapi bila jumpa perkataan <i>bola</i>, mereka tersekat. Sebabnya: membaca Bahasa Melayu bergantung pada <b>suku kata</b> (bo + la), bukan nama huruf.</p><p>Sebab itu Jom Baca! bermula dengan vokal, kemudian suku kata KV, baru perkataan dan ayat. Setiap langkah kecil, dan anak dapat bintang setiap kali berjaya.</p><p><a href=\"{app}\">👉 Cuba 3 tahap pertama percuma</a></p>" },
  { d: 3, s: "Rutin 10 minit yang anak tunggu-tunggu", b: "<p>Hai {name},</p><p>Rahsia anak cepat membaca bukan sesi panjang, tetapi <b>sedikit setiap hari</b>.</p><ul><li>🎯 <b>Misi Hari Ini</b>: 10 minit, campuran item baharu + item yang anak masih lemah</li><li>🔥 Streak harian supaya anak nak sambung esok</li><li>🖨️ Kad imbas, lembaran kerja &amp; sijil untuk dicetak</li><li>👨‍👩‍👧 Laporan kemajuan untuk ibu bapa</li></ul><p>Semua 40 tahap + pek cerita baharu setiap minggu dalam <b>Jom Baca Pro</b>, {price} sekali bayar.</p><p><a href=\"{buy}\">👉 Dapatkan Jom Baca Pro</a></p>" },
  { d: 5, s: "Soalan ibu bapa: sesuai untuk anak autisme / disleksia?", b: "<p>Hai {name},</p><p>Ya. Jom Baca! ada <b>Mod Tenang</b> (tanpa animasi &amp; bunyi kuat), <b>jadual visual Dulu → Kemudian</b>, dan <b>Mod Baca Dulu</b> dengan huruf besar untuk disleksia. Ibu bapa juga boleh tandakan jawapan betul sendiri jika anak belum bertutur jelas.</p><p>Suara anak tidak dirakam atau disimpan.</p><p><a href=\"{buy}\">👉 Lihat apa yang ada dalam Pro</a></p>" },
  { d: 7, s: "Kod khas untuk {child}: tamat 48 jam ⏳", b: "<p>Hai {name},</p><p>Sebagai terima kasih kerana mencuba Jom Baca!, ini kod diskaun khas untuk anda:</p><p style=\"font-size:22px\"><b>{coupon}</b></p><p>Kod ini hanya sah selama <b>48 jam</b> dan sekali guna.</p><p><a href=\"{buy_coupon}\">👉 Guna kod sekarang</a></p>" },
];

let migrated = false;
async function migrate(env) {
  if (migrated) return;
  const v = await env.DB.prepare("SELECT v FROM settings WHERE k='schema_v'").first().catch(() => null);
  if (!v || v.v !== SCHEMA_V) {
    await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
    const add = [["licenses", "expires INTEGER"], ["licenses", "kind TEXT DEFAULT 'paid'"], ["licenses", "fails INTEGER DEFAULT 0"], ["licenses", "phone TEXT"], ["testimonials", "rating INTEGER"], ["testimonials", "kind TEXT"], ["testimonials", "lic TEXT"], ["testimonials", "consent INTEGER DEFAULT 0"], ["orders", "pay_url TEXT"], ["flow_jobs", "caption TEXT"], ["flow_jobs", "platforms TEXT"], ["emails", "clicks INTEGER DEFAULT 0"], ["leads", "updated INTEGER"]];
    for (const [t, c] of add) await env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN ${c}`).run().catch(() => {});
    await env.DB.prepare("INSERT OR REPLACE INTO settings(k,v) VALUES('schema_v',?)").bind(SCHEMA_V).run();
    const sec = await env.DB.prepare("SELECT v FROM settings WHERE k='lic_secret'").first();
    if (!sec) await env.DB.prepare("INSERT INTO settings(k,v) VALUES('lic_secret',?)").bind(rnd(32)).run();
    const nv = await env.DB.prepare("SELECT COUNT(*) n FROM variants").first();
    if (!nv.n) {
      const st = env.DB.prepare("INSERT INTO variants(slot,text,created,agent) VALUES(?,?,?,'seed')");
      await env.DB.batch(Object.entries(SEED_VARIANTS).flatMap(([s, arr]) => arr.map(t => st.bind(s, t, now()))));
    }
    const na = await env.DB.prepare("SELECT COUNT(*) n FROM angles").first();
    if (!na.n) {
      const st = env.DB.prepare("INSERT INTO angles(name,description,created) VALUES(?,?,?)");
      await env.DB.batch(SEED_ANGLES.map(([n, d]) => st.bind(n, d, now())));
    }
  }
  migrated = true;
}

async function settings(env) {
  const { results } = await env.DB.prepare("SELECT k,v FROM settings").all();
  const s = { ...DEFAULTS };
  for (const r of results) s[r.k] = r.v;
  return s;
}
const setSetting = (env, k, v) => env.DB.prepare("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, String(v)).run();
function siteUrl(env, s, req) {
  if (env.SITE_URL) return env.SITE_URL.replace(/\/$/, "");
  if (req) return new URL(req.url).origin;
  return (s && s.site_url) || "";
}

async function bump(env, pairs, day = mytDay()) {
  if (!pairs.length) return;
  const st = env.DB.prepare("INSERT INTO stats(day,k,n) VALUES(?,?,?) ON CONFLICT(day,k) DO UPDATE SET n=n+excluded.n");
  await env.DB.batch(pairs.map(([k, n]) => st.bind(day, clip(k, 120), n == null ? 1 : n)));
}
async function statSum(env, keys, from, to = mytDay()) {
  const q = `SELECT k, SUM(n) n FROM stats WHERE day>=? AND day<=? AND k IN (${keys.map(() => "?").join(",")}) GROUP BY k`;
  const { results } = await env.DB.prepare(q).bind(from, to, ...keys).all();
  const o = Object.fromEntries(keys.map(k => [k, 0]));
  for (const r of results) o[r.k] = r.n;
  return o;
}

/* ------------------------------------------------------------------ */
/* Thompson sampling untuk A/B laman jualan                            */
/* ------------------------------------------------------------------ */
function randn() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function gamma(a) {
  if (a < 1) return gamma(a + 1) * Math.pow(Math.random(), 1 / a);
  const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) { let x, v; do { x = randn(); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = Math.random(); if (u < 1 - 0.0331 * x ** 4) return d * v; if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; }
}
const betaS = (a, b) => { const x = gamma(a), y = gamma(b); return x / (x + y); };
const reward = v => Math.min(v.views, v.leads + 4 * v.conv);
const sampleV = v => betaS(1 + reward(v), 1 + Math.max(0, v.views - reward(v)));
function pickVariants(rows) {
  const by = {};
  for (const r of rows) (by[r.slot] = by[r.slot] || []).push(r);
  const out = {};
  for (const [slot, arr] of Object.entries(by)) {
    let best = null, bs = -1;
    for (const v of arr) { const s = sampleV(v); if (s > bs) { bs = s; best = v; } }
    out[slot] = { id: best.id, text: best.text };
  }
  return out;
}
function probBest(rows, n = 400) {
  const by = {}, win = {};
  for (const r of rows) (by[r.slot] = by[r.slot] || []).push(r);
  for (const arr of Object.values(by)) {
    for (let i = 0; i < n; i++) { let b = null, bs = -1; for (const v of arr) { const s = sampleV(v); if (s > bs) { bs = s; b = v.id; } } win[b] = (win[b] || 0) + 1; }
  }
  return rows.map(r => ({ ...r, p_best: +((win[r.id] || 0) / n).toFixed(3), rate: r.views ? +(reward(r) / r.views).toFixed(4) : 0 }));
}

/* ------------------------------------------------------------------ */
/* Harga & kupon                                                       */
/* ------------------------------------------------------------------ */
async function priceFor(env, s, code) {
  const base = +s.price_sen, floor = Math.min(base, +s.floor_sen);
  let amount = base, coupon = null;
  if (code) {
    const c = await env.DB.prepare("SELECT * FROM coupons WHERE code=?").bind(clip(code, 30).toUpperCase()).first();
    if (c && (!c.expires || c.expires > now()) && (!c.max_uses || c.used < c.max_uses)) {
      const disc = c.off ? c.off : Math.round(base * (c.pct || 0) / 100);
      amount = Math.max(floor, base - disc);
      if (amount < base) coupon = { code: c.code, expires: c.expires || null, save_label: rm(base - amount) };
    }
  }
  return { base, amount, coupon };
}

/* ------------------------------------------------------------------ */
/* Lesen                                                               */
/* ------------------------------------------------------------------ */
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 32);
}
async function licSecret(env) { if (env.LICENSE_SECRET) return env.LICENSE_SECRET; const r = await env.DB.prepare("SELECT v FROM settings WHERE k='lic_secret'").first(); return r.v; }
function newKey() { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const b = crypto.getRandomValues(new Uint8Array(12)); let s = ""; for (let i = 0; i < 12; i++) { s += A[b[i] % A.length]; if (i % 4 === 3 && i < 11) s += "-"; } return "JB-" + s; }
async function verifyLicToken(env, tok) {
  const [key, dev, sig] = String(tok || "").split(".");
  if (!key || !dev || !sig) return null;
  if (sig !== await hmac(await licSecret(env), key + "|" + dev)) return null;
  const lic = await env.DB.prepare("SELECT * FROM licenses WHERE key=?").bind(key).first();
  if (lic) lic._devOk = parseJ(lic.devices, []).includes(dev);
  return lic;
}
async function serveR2(env, k, req, cache) {
  const head = await env.MEDIA.head(k); if (!head) return new Response("not found", { status: 404 });
  const rg = /bytes=(\d+)-(\d*)/.exec(req.headers.get("range") || "");
  const size = head.size, start = rg ? Math.min(+rg[1], Math.max(0, size - 1)) : 0, end = rg && rg[2] ? Math.min(+rg[2], size - 1) : size - 1;
  const hd = { "content-type": head.httpMetadata?.contentType || "application/octet-stream", "accept-ranges": "bytes", "cache-control": cache, "content-length": String(end - start + 1) };
  if (req.method === "HEAD") return new Response(null, { headers: { ...hd, "content-length": String(size) } });
  const obj = await env.MEDIA.get(k, rg ? { range: { offset: start, length: end - start + 1 } } : undefined);
  if (rg) hd["content-range"] = `bytes ${start}-${end}/${size}`;
  return new Response(obj.body, { status: rg ? 206 : 200, headers: hd });
}
async function vidUrl(env, site, objKey, mins = 120) {
  const e = now() + mins * 60e3;
  return `${site}/api/vid?k=${encodeURIComponent(objKey)}&e=${e}&s=${(await hmac(await licSecret(env), "vid|" + objKey + "|" + e)).slice(0, 20)}`;
}
const trialLeft = lic => lic && lic.expires ? Math.max(0, Math.ceil((lic.expires - now()) / DAY)) : null;
async function resetSig(env, key) { return (await hmac(await licSecret(env), "reset|" + key)).slice(0, 16); }
function maskKey(k) { return String(k || "").slice(0, 8) + "••••"; }
async function contentPack(env) {
  const { results } = await env.DB.prepare("SELECT id,title,en,icon,items FROM packs WHERE status='live' ORDER BY created").all();
  return { v: 1, levels: CORE.levels, packs: results.map(p => ({ id: p.id, title: p.title, en: p.en, icon: p.icon, items: parseJ(p.items, []) })) };
}

/* ------------------------------------------------------------------ */
/* Emel (Brevo atau Resend) & Telegram                                 */
/* ------------------------------------------------------------------ */
function emailWrap(s, inner, unsub) {
  return `<!doctype html><html><body style="margin:0;background:#f6f3ff;font-family:Arial,Helvetica,sans-serif;color:#2b2350"><div style="max-width:560px;margin:0 auto;padding:20px"><div style="background:#fff;border-radius:16px;padding:22px;font-size:16px;line-height:1.55">${inner}</div><p style="font-size:12px;color:#8a84a8;text-align:center">${s.brand} · Belajar membaca suku kata demi suku kata${unsub ? ` · <a href="${unsub}" style="color:#8a84a8">berhenti langgan</a>` : ""}</p></div></body></html>`;
}
async function sendEmail(env, s, to, subject, html) {
  const from = s.email_from || "";
  const m = from.match(/^(.*)<(.+)>$/);
  const fromName = m ? m[1].trim() : s.brand, fromEmail = m ? m[2].trim() : from, rt = okEmail(s.email_reply_to) ? s.email_reply_to.trim() : "";
  if (env.BREVO_API_KEY && fromEmail) {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ sender: { name: fromName, email: fromEmail }, to: [{ email: to }], subject, htmlContent: html, ...(rt ? { replyTo: { email: rt } } : {}) }) });
    if (!r.ok) throw new Error("brevo " + r.status + " " + (await r.text()).slice(0, 200));
    return true;
  }
  if (env.RESEND_API_KEY && fromEmail) {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" }, body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to: [to], subject, html, ...(rt ? { reply_to: rt } : {}) }) });
    if (!r.ok) throw new Error("resend " + r.status + " " + (await r.text()).slice(0, 200));
    return true;
  }
  throw new Error("emel belum disetup (BREVO_API_KEY/RESEND_API_KEY + email_from)");
}
async function tg(env, text, chat) {
  const id = chat || env.TELEGRAM_CHAT_ID;
  if (!env.TELEGRAM_BOT_TOKEN || !id) return false;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: id, text: clip(text, 4000), parse_mode: "HTML", disable_web_page_preview: true }) }).catch(() => null);
  return !!(r && r.ok);
}
async function unsubSig(env, id) { return (await hmac(await licSecret(env), "unsub|" + id)).slice(0, 12); }

/* ------------------------------------------------------------------ */
/* Leads                                                               */
/* ------------------------------------------------------------------ */
async function upsertLead(env, d, stage) {
  const email = okEmail(d.email) ? String(d.email).toLowerCase().trim() : "";
  const phone = cleanPhone(d.phone);
  if (!email && !phone) return null;
  let row = null;
  if (email) row = await env.DB.prepare("SELECT * FROM leads WHERE email=?").bind(email).first();
  if (!row && phone) row = await env.DB.prepare("SELECT * FROM leads WHERE phone=?").bind(phone).first();
  const rank = { new: 0, lead: 1, checkout: 2, customer: 3 };
  if (row) {
    const st = (rank[stage] || 0) > (rank[row.stage] || 0) ? stage : row.stage;
    await env.DB.prepare("UPDATE leads SET name=COALESCE(NULLIF(?,''),name), email=COALESCE(NULLIF(?,''),email), phone=COALESCE(NULLIF(?,''),phone), child_age=COALESCE(NULLIF(?,''),child_age), stage=?, updated=? WHERE id=?")
      .bind(clip(d.name, 60), email, phone, clip(d.child_age, 20), st, now(), row.id).run();
    return { id: row.id, isNew: false, email: email || row.email, name: d.name || row.name };
  }
  const r = await env.DB.prepare("INSERT INTO leads(created,name,email,phone,child_age,src,ref,vids,stage,score,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .bind(now(), clip(d.name, 60), email, phone, clip(d.child_age, 20), clip(d.src, 40), clip(d.ref, 30), JSON.stringify((d.vids || []).slice(0, 6)), stage, stage === "checkout" ? 60 : 20, now()).run();
  return { id: r.meta.last_row_id, isNew: true, email, name: d.name };
}
async function queueNurture(env, leadId, email) {
  if (!email) return;
  const tpl = NURTURE_DEFAULT;
  const st = env.DB.prepare("INSERT INTO emails(created,lead_id,to_email,send_at,kind) VALUES(?,?,?,?,?)");
  await env.DB.batch(tpl.map((t, i) => st.bind(now(), leadId, email, now() + t.d * DAY + (i ? 2 * 3600e3 : 0), "nurture:" + i)));
}
async function attribute(env, src, field) {
  const m = /^p(\d+)$/.exec(src || "");
  if (!m) return [];
  const post = await env.DB.prepare("SELECT id, angle FROM posts WHERE id=?").bind(+m[1]).first();
  if (!post) return [];
  const out = [env.DB.prepare(`UPDATE posts SET ${field}=${field}+1 WHERE id=?`).bind(post.id)];
  if (post.angle) out.push(env.DB.prepare(`UPDATE angles SET ${field}=${field}+1 WHERE name=?`).bind(post.angle));
  return out;
}
async function variantBump(env, vids, field) {
  const ids = (Array.isArray(vids) ? vids : parseJ(vids, [])).map(Number).filter(Boolean).slice(0, 6);
  return ids.map(id => env.DB.prepare(`UPDATE variants SET ${field}=${field}+1 WHERE id=?`).bind(id));
}

/* ------------------------------------------------------------------ */
/* Pembayaran (ToyyibPay) & penghantaran lesen                         */
/* ------------------------------------------------------------------ */
const TOY_LIVE = "https://toyyibpay.com", TOY_DEV = "https://dev.toyyibpay.com";
function toyCfg(env, s, forceSandbox) {
  const sb = forceSandbox != null ? forceSandbox : (s && s.toyyib_sandbox === "1") || env.TOYYIB_SANDBOX === "1";
  return sb ? { host: TOY_DEV, secret: env.TOYYIB_SANDBOX_SECRET, cat: env.TOYYIB_SANDBOX_CATEGORY, sandbox: true } : { host: TOY_LIVE, secret: env.TOYYIB_SECRET, cat: env.TOYYIB_CATEGORY, sandbox: false };
}
const toyCfgForOrder = (env, o) => toyCfg(env, null, String(o.pay_url || "").startsWith(TOY_DEV));
async function toyCreateBill(tc, o, site) {
  const f = new URLSearchParams({
    userSecretKey: tc.secret, categoryCode: tc.cat,
    billName: "Jom Baca Pro", billDescription: "Lesen Jom Baca Pro seumur hidup " + o.id,
    billPriceSetting: "1", billPayorInfo: "1", billAmount: String(o.amount),
    billReturnUrl: `${site}/terima-kasih?o=${o.id}&t=${o.tok}`, billCallbackUrl: `${site}/api/pay/toyyib`,
    billExternalReferenceNo: o.id, billTo: clip(o.name || "Pelanggan", 60), billEmail: o.email, billPhone: o.phone || "0100000000",
    billExpiryDays: "3", billPaymentChannel: "2",
  });
  const r = await fetch(tc.host + "/index.php/api/createBill", { method: "POST", body: f });
  const t = await r.text();
  const j = parseJ(t, null);
  if (Array.isArray(j) && j[0] && j[0].BillCode) return j[0].BillCode;
  throw new Error("ToyyibPay: " + t.slice(0, 200));
}
async function toyPaid(tc, billcode, amount) {
  if (!tc.secret) return false;
  const f = new URLSearchParams({ billCode: billcode, userSecretKey: tc.secret });
  const r = await fetch(tc.host + "/index.php/api/getBillTransactions", { method: "POST", body: f });
  const j = parseJ(await r.text(), []);
  return Array.isArray(j) && j.some(x => String(x.billpaymentStatus) === "1" && Math.round(parseFloat(x.billpaymentAmount) * 100) >= amount);
}
function slugCode(name) { const b = String(name || "kawan").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "").slice(0, 10) || "kawan"; return b + (Math.floor(Math.random() * 900) + 100); }
async function newAffiliate(env, d, buyer) {
  let code = d.code;
  for (let i = 0; i < 5 && !code; i++) { const c = slugCode(d.name); if (!await env.DB.prepare("SELECT 1 FROM affiliates WHERE code=?").bind(c).first()) code = c; }
  const token = rnd(12);
  const s = await settings(env);
  await env.DB.prepare("INSERT INTO affiliates(code,token,name,email,phone,handle,payout,rate,created,buyer) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(code, token, clip(d.name, 60), d.email || "", cleanPhone(d.phone), clip(d.handle, 80), clip(d.payout, 120), +s.aff_rate_pct, now(), buyer ? 1 : 0).run();
  return { code, token };
}
async function fulfill(env, orderId, via) {
  const o = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(orderId).first();
  if (!o || o.status === "paid") return o;
  const s = await settings(env), site = siteUrl(env, s);
  const key = newKey();
  const upd = await env.DB.prepare("UPDATE orders SET status='paid', paid_at=?, license=?, note=? WHERE id=? AND status!='paid'").bind(now(), key, clip(via, 40), o.id).run();
  if (!upd.meta.changes) return o;
  const isTest = /sandbox/.test(via || "");  // jualan ujian: jangan masuk statistik, komisen atau pembelajaran agen
  const ops = [env.DB.prepare("INSERT INTO licenses(key,order_id,email,name,created,kind,phone) VALUES(?,?,?,?,?,?,?)").bind(key, o.id, o.email, o.name, now(), isTest ? "test" : "paid", o.phone || null)];
  let aff = await env.DB.prepare("SELECT code, token FROM affiliates WHERE email=?").bind(o.email).first();
  if (!aff) aff = await newAffiliate(env, { name: o.name, email: o.email, phone: o.phone }, true);
  if (!isTest && o.ref && o.ref !== aff.code) {
    const ra = await env.DB.prepare("SELECT * FROM affiliates WHERE code=? AND status='active'").bind(o.ref).first();
    if (ra && ra.email !== o.email) ops.push(env.DB.prepare("INSERT INTO commissions(code,order_id,amount,created) VALUES(?,?,?,?)").bind(ra.code, o.id, Math.round(o.amount * (ra.rate || +s.aff_rate_pct) / 100), now()));
  }
  if (!isTest) {
  if (o.coupon) ops.push(env.DB.prepare("UPDATE coupons SET used=used+1 WHERE code=?").bind(o.coupon));
  ops.push(env.DB.prepare("UPDATE leads SET bought=1, stage='customer', updated=? WHERE email=? OR (phone!='' AND phone=?)").bind(now(), o.email, o.phone || "-"));
  ops.push(env.DB.prepare("UPDATE emails SET status='cancelled' WHERE status='queued' AND kind LIKE 'nurture:%' AND to_email=?").bind(o.email));
  ops.push(...await variantBump(env, o.vids, "conv"), ...await attribute(env, o.src, "sales"));
  }
  await env.DB.batch(ops);
  const pairs = isTest ? [["test_sale"]] : [["sale"], ["rev", o.amount]];
  if (!isTest && o.src) pairs.push(["src:" + o.src + ":sale"]);
  if (!isTest && o.ref) pairs.push(["ref:" + o.ref + ":sale"]);
  await bump(env, pairs);
  const app = `${site}/app/?lesen=${key}`;
  const html = emailWrap(s, `<p>Hai ${o.name || ""},</p><p>Terima kasih! Pembelian <b>Jom Baca Pro</b> anda berjaya. 🎉</p><p>Kod lesen anda:</p><p style="font-size:22px;font-weight:bold;letter-spacing:2px">${key}</p><p><a href="${app}" style="display:inline-block;background:#17b26a;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:bold">👉 Buka Jom Baca Pro</a></p><p>Lesen boleh digunakan pada 3 peranti. Jika tukar telefon, gunakan pautan reset dalam emel notifikasi peranti. Pada peranti lain, buka ${site}/app/ → 👑 → "Sudah beli?" dan masukkan kod di atas.</p><p><b>Bonus:</b> anda kini affiliate Jom Baca. Kongsi pautan ini dan dapat komisen setiap jualan:<br>${site}/r/${aff.code}</p><p>Papan affiliate anda: ${site}/affiliate?code=${aff.code}&k=${aff.token}</p>`);
  await sendEmail(env, s, o.email, (isTest ? "[UJIAN] " : "") + "Lesen Jom Baca Pro anda: " + key, html).catch(e => env.DB.prepare("INSERT INTO emails(created,to_email,subject,html,send_at,status,kind,error) VALUES(?,?,?,?,?,?,?,?)").bind(now(), o.email, "Lesen Jom Baca Pro anda: " + key, html, now() + 600e3, "queued", "license", String(e.message || e)).run());
  await tg(env, (isTest ? "🧪 <b>Jualan UJIAN (sandbox)</b>, tidak dikira dalam statistik.\n" : "") + `💰 <b>Jualan!</b> ${rm(o.amount)} · ${o.name || "-"}\nSumber: ${o.src || "-"} · Ref: ${o.ref || "-"} · Kupon: ${o.coupon || "-"}`);
  return { ...o, status: "paid", license: key };
}

/* ------------------------------------------------------------------ */
/* Auto-post sosial                                                    */
/* ------------------------------------------------------------------ */
const AUTO_PLATFORMS = ["threads", "facebook", "telegram", "instagram"];
function postText(p, site) { return String(p.body || "").replace(/\{LINK\}/g, `${site}/s/${p.id}`); }
async function postThreads(env, p, text) {
  const base = `https://graph.threads.net/v1.0/${env.THREADS_USER_ID}`;
  const tk = env.THREADS_TOKEN;
  if (p.status === "processing" && p.ext_id) {
    const st = await fetch(`https://graph.threads.net/v1.0/${p.ext_id}?fields=status,error_message&access_token=${encodeURIComponent(tk)}`).then(r => r.json()).catch(() => ({}));
    if (st.status === "ERROR" || st.status === "EXPIRED") throw new Error("threads media " + JSON.stringify(st).slice(0, 200));
    if (st.status && st.status !== "FINISHED") return { id: p.ext_id, done: false };
    const r = await fetch(`${base}/threads_publish`, { method: "POST", body: new URLSearchParams({ creation_id: p.ext_id, access_token: tk }) });
    const j = await r.json(); if (!j.id) throw new Error("threads publish " + JSON.stringify(j).slice(0, 200)); return { id: j.id, done: true };
  }
  const isVid = /\.(mp4|mov|webm)(\?|$)/i.test(p.media_url || ""), isImg = /\.(png|jpe?g|webp)(\?|$)/i.test(p.media_url || "");
  const f = new URLSearchParams({ media_type: isVid ? "VIDEO" : isImg ? "IMAGE" : "TEXT", text: clip(text, 500), access_token: tk });
  if (isVid) f.set("video_url", p.media_url); if (isImg) f.set("image_url", p.media_url);
  const r = await fetch(`${base}/threads`, { method: "POST", body: f });
  const j = await r.json(); if (!j.id) throw new Error("threads create " + JSON.stringify(j).slice(0, 200));
  if (isVid) return { id: j.id, done: false };
  const r2 = await fetch(`${base}/threads_publish`, { method: "POST", body: new URLSearchParams({ creation_id: j.id, access_token: tk }) });
  const j2 = await r2.json(); if (!j2.id) { return { id: j.id, done: false }; }
  return { id: j2.id, done: true };
}
async function igResolve(env, s) {
  const pid = s.fb_page_id, tk = s.fb_page_token; if (!pid || !tk) return null;
  const j = await fetch(`https://graph.facebook.com/v21.0/${pid}?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(tk)}`).then(r => r.json()).catch(() => ({}));
  const ig = j.instagram_business_account;
  if (!ig || !ig.id) { await setSetting(env, "ig_checked", now()); return null; }
  await setSetting(env, "ig_user_id", ig.id); await setSetting(env, "ig_username", ig.username || "");
  return ig;
}
async function postInstagram(env, p, text) {
  const G = `https://graph.facebook.com/v21.0`, tk = env.FB_PAGE_TOKEN, ig = env.IG_USER_ID;
  const call = async (path, params, method = "POST") => {
    const u = `${G}/${path}`, f = new URLSearchParams({ ...params, access_token: tk });
    const r = method === "GET" ? await fetch(`${u}?${f}`) : await fetch(u, { method, body: f });
    return r.json();
  };
  if (p.status === "processing" && p.ext_id) {
    const st = await call(p.ext_id, { fields: "status_code,status" }, "GET");
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new Error("instagram media " + JSON.stringify(st).slice(0, 200));
    if (st.status_code !== "FINISHED") return { id: p.ext_id, done: false };
    const pub = await call(`${ig}/media_publish`, { creation_id: p.ext_id });
    if (!pub.id) throw new Error("instagram publish " + JSON.stringify(pub).slice(0, 200)); return { id: pub.id, done: true };
  }
  const isVid = /\.(mp4|mov)(\?|$)/i.test(p.media_url || ""), isImg = /\.(png|jpe?g)(\?|$)/i.test(p.media_url || "");
  if (!isVid && !isImg) throw new Error("Instagram perlukan gambar atau video");
  const c = await call(`${ig}/media`, isVid ? { media_type: "REELS", video_url: p.media_url, caption: clip(text, 2100), share_to_feed: "true" } : { image_url: p.media_url, caption: clip(text, 2100) });
  if (!c.id) throw new Error("instagram create " + JSON.stringify(c).slice(0, 200));
  return { id: c.id, done: false };
}
async function postFacebook(env, p, text) {
  const isVid = /\.(mp4|mov|webm)(\?|$)/i.test(p.media_url || "");
  const url = isVid ? `https://graph.facebook.com/v21.0/${env.FB_PAGE_ID}/videos` : `https://graph.facebook.com/v21.0/${env.FB_PAGE_ID}/feed`;
  const f = new URLSearchParams({ access_token: env.FB_PAGE_TOKEN });
  if (isVid) { f.set("file_url", p.media_url); f.set("description", text); } else f.set("message", text);
  const r = await fetch(url, { method: "POST", body: f }); const j = await r.json();
  if (!j.id) throw new Error("facebook " + JSON.stringify(j).slice(0, 200)); return { id: j.id, done: true };
}
async function postTelegram(env, p, text) {
  const isVid = /\.(mp4|mov|webm)(\?|$)/i.test(p.media_url || "");
  const m = isVid ? "sendVideo" : "sendMessage";
  const body = isVid ? { chat_id: env.TELEGRAM_CHANNEL_ID, video: p.media_url, caption: clip(text, 1000) } : { chat_id: env.TELEGRAM_CHANNEL_ID, text: clip(text, 4000) };
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.ok) throw new Error("telegram " + JSON.stringify(j).slice(0, 200)); return { id: String(j.result.message_id), done: true };
}
function withSocial(env, s) {
  if (!s) return env;
  return { ...env, THREADS_USER_ID: env.THREADS_USER_ID || s.threads_user_id || "", THREADS_TOKEN: env.THREADS_TOKEN || s.threads_token || "", FB_PAGE_ID: env.FB_PAGE_ID || s.fb_page_id || "", FB_PAGE_TOKEN: env.FB_PAGE_TOKEN || s.fb_page_token || "", IG_USER_ID: env.IG_USER_ID || s.ig_user_id || "" };
}
const TH_API = "https://graph.threads.net";
async function threadsConnect(env, token) {
  token = String(token || "").trim(); if (!token) throw new Error("Tampal token Threads dahulu.");
  let tk = token, exp = 0, exchanged = false;
  if (env.THREADS_APP_SECRET) {
    const j = await fetch(`${TH_API}/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(env.THREADS_APP_SECRET)}&access_token=${encodeURIComponent(token)}`).then(r => r.json()).catch(() => ({}));
    if (j.access_token) { tk = j.access_token; exp = now() + (+j.expires_in || 60 * 86400) * 1000; exchanged = true; }
  }
  const me = await fetch(`${TH_API}/v1.0/me?fields=id,username&access_token=${encodeURIComponent(tk)}`).then(r => r.json()).catch(() => ({}));
  if (!me.id) throw new Error("Token Threads tidak sah: " + JSON.stringify(me.error || me).slice(0, 200));
  for (const [k, v] of [["threads_token", tk], ["threads_user_id", me.id], ["threads_username", me.username || ""], ["threads_token_refreshed", now()], ["threads_token_exp", exp || (now() + 60 * DAY)]]) await setSetting(env, k, v);
  return { ok: true, username: me.username, exchanged };
}
async function threadsRefresh(env, s) {
  if (!s.threads_token || now() - +(s.threads_token_refreshed || 0) < 7 * DAY) return;
  const j = await fetch(`${TH_API}/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(s.threads_token)}`).then(r => r.json()).catch(() => ({}));
  if (!j.access_token) { console.log("threads refresh", JSON.stringify(j).slice(0, 200)); return; }
  await setSetting(env, "threads_token", j.access_token); await setSetting(env, "threads_token_refreshed", now());
  await setSetting(env, "threads_token_exp", now() + (+j.expires_in || 60 * 86400) * 1000);
}
async function fbConnect(env, token, pageName) {
  token = String(token || "").trim(); if (!token) throw new Error("Tampal token Facebook dahulu.");
  const G = "https://graph.facebook.com/v21.0";
  let ut = token;
  if (env.FB_APP_ID && env.FB_APP_SECRET) {
    const j = await fetch(`${G}/oauth/access_token?grant_type=fb_exchange_token&client_id=${env.FB_APP_ID}&client_secret=${encodeURIComponent(env.FB_APP_SECRET)}&fb_exchange_token=${encodeURIComponent(token)}`).then(r => r.json()).catch(() => ({}));
    if (j.access_token) ut = j.access_token;
  }
  const acc = await fetch(`${G}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(ut)}`).then(r => r.json()).catch(() => ({}));
  const pages = acc.data || [];
  if (!pages.length) throw new Error("Tiada Page ditemui untuk token ini. Pastikan kebenaran pages_manage_posts dan pages_read_engagement dipilih. " + (acc.error ? acc.error.message : ""));
  const pg = pages.find(p => pageName && p.name.toLowerCase().includes(String(pageName).toLowerCase())) || pages[0];
  for (const [k, v] of [["fb_page_id", pg.id], ["fb_page_token", pg.access_token], ["fb_page_name", pg.name], ["fb_long", ut !== token ? "1" : "0"]]) await setSetting(env, k, v);
  const ig = await igResolve(env, { fb_page_id: pg.id, fb_page_token: pg.access_token }).catch(() => null);
  return { ok: true, page: pg.name, pages: pages.map(p => p.name), long_lived: ut !== token, ig: ig ? ig.username : "" };
}
function canAuto(env, platform) {
  if (platform === "threads") return !!(env.THREADS_USER_ID && env.THREADS_TOKEN);
  if (platform === "facebook") return !!(env.FB_PAGE_ID && env.FB_PAGE_TOKEN);
  if (platform === "instagram") return !!(env.IG_USER_ID && env.FB_PAGE_TOKEN);
  if (platform === "telegram") return !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHANNEL_ID);
  return false;
}
async function publishDue(env, s) {
  if (!s.ig_user_id && s.fb_page_token && now() - +(s.ig_checked || 0) > 6 * 3600e3) { const ig = await igResolve(env, s).catch(() => null); if (ig) { s.ig_user_id = ig.id; s.ig_username = ig.username; } }
  env = withSocial(env, s);
  const site = siteUrl(env, s);
  const { results } = await env.DB.prepare("SELECT * FROM posts WHERE status IN ('scheduled','processing') AND scheduled_at<=? ORDER BY scheduled_at LIMIT 4").bind(now()).all();
  let n = 0;
  for (const p of results) {
    if (!AUTO_PLATFORMS.includes(p.platform) || !canAuto(env, p.platform) || s.auto_post !== "1") {
      await env.DB.prepare("UPDATE posts SET status='manual' WHERE id=?").bind(p.id).run(); continue;
    }
    if (p.status === "processing" && now() - p.scheduled_at < 60e3) continue;
    try {
      const text = p.platform === "instagram" ? String(p.body || "").replace(/\{LINK\}/g, "👉 pautan di bio") : postText(p, site);
      const res = p.platform === "threads" ? await postThreads(env, p, text) : p.platform === "facebook" ? await postFacebook(env, p, text) : p.platform === "instagram" ? await postInstagram(env, p, text) : await postTelegram(env, p, text);
      if (res.done) { await env.DB.prepare("UPDATE posts SET status='posted', posted_at=?, ext_id=?, error=NULL WHERE id=?").bind(now(), res.id, p.id).run(); n++; }
      else await env.DB.prepare("UPDATE posts SET status='processing', ext_id=? WHERE id=?").bind(res.id, p.id).run();
    } catch (e) {
      await env.DB.prepare("UPDATE posts SET status='failed', error=? WHERE id=?").bind(clip(e.message || e, 400), p.id).run();
    }
  }
  if (n) await bump(env, [["posted", n]]);
}

/* ------------------------------------------------------------------ */
/* Penghantaran emel nurture                                           */
/* ------------------------------------------------------------------ */
function fill(t, v) { return String(t).replace(/\{(\w+)\}/g, (m, k) => v[k] != null ? v[k] : m); }
async function sendDueEmails(env, s) {
  if (!(env.BREVO_API_KEY || env.RESEND_API_KEY) || !s.email_from) return;
  const site = siteUrl(env, s);
  const { results } = await env.DB.prepare("SELECT e.*, l.name lname, l.unsub, l.bought, l.child_age FROM emails e LEFT JOIN leads l ON l.id=e.lead_id WHERE e.status='queued' AND e.send_at<=? ORDER BY e.send_at LIMIT 20").bind(now()).all();
  const tpl = parseJ(s.nurture_tpl, null) || NURTURE_DEFAULT;
  const price = rm((await priceFor(env, s, null)).amount);
  for (const e of results) {
    try {
      if (e.kind === "tester_fb") {
        const done = await env.DB.prepare("SELECT 1 FROM licenses l WHERE l.email=? AND l.kind='tester' AND (l.expires IS NULL OR EXISTS (SELECT 1 FROM tester_subs t WHERE t.lic=l.key AND t.status IN ('pending','approved')))").bind(e.to_email).first();
        if (done) { await env.DB.prepare("UPDATE emails SET status='skipped' WHERE id=?").bind(e.id).run(); continue; }
      }
      if (e.lead_id && (e.unsub || (e.bought && String(e.kind).startsWith("nurture")))) { await env.DB.prepare("UPDATE emails SET status='skipped' WHERE id=?").bind(e.id).run(); continue; }
      let subject = e.subject, html = e.html;
      const unsub = e.lead_id ? `${site}/api/unsub?l=${e.lead_id}&s=${await unsubSig(env, e.lead_id)}` : "";
      if (!html && String(e.kind).startsWith("nurture:")) {
        const i = +e.kind.split(":")[1]; const t = tpl[i] || NURTURE_DEFAULT[i]; if (!t) throw new Error("tiada template " + i);
        let coupon = "";
        if (/\{coupon\}|\{buy_coupon\}/.test(t.b + t.s)) {
          coupon = "MAMA" + e.lead_id + rnd(1).toUpperCase();
          await env.DB.prepare("INSERT OR IGNORE INTO coupons(code,off,expires,max_uses,note,created,agent) VALUES(?,?,?,?,?,?,?)").bind(coupon, 300, now() + 2 * DAY, 1, "nurture lead " + e.lead_id, now(), "worker").run();
        }
        const L = (u) => `${site}/e/${e.id}?u=${encodeURIComponent(u)}`;
        const v = { name: (e.lname || "").split(" ")[0] || "ibu/ayah", child: "anak anda", price, coupon,
          app: L(`${site}/app/`), buy: L(`${site}/?src=e${e.id}#beli`), magnet: L(`${site}/kad-percuma`), buy_coupon: L(`${site}/?src=e${e.id}&kupon=${coupon}#beli`) };
        subject = fill(t.s, v); html = emailWrap(s, fill(t.b, v), unsub);
      }
      await sendEmail(env, s, e.to_email, subject, html);
      await env.DB.prepare("UPDATE emails SET status='sent', sent_at=?, subject=? WHERE id=?").bind(now(), clip(subject, 200), e.id).run();
    } catch (err) {
      await env.DB.prepare("UPDATE emails SET status='failed', error=? WHERE id=?").bind(clip(err.message || err, 300), e.id).run();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Ringkasan metrik (untuk admin & otak AI)                            */
/* ------------------------------------------------------------------ */
async function series(env, keys, days) {
  const from = daysAgo(days - 1);
  const { results } = await env.DB.prepare(`SELECT day,k,n FROM stats WHERE day>=? AND k IN (${keys.map(() => "?").join(",")})`).bind(from, ...keys).all();
  const out = [];
  for (let i = days - 1; i >= 0; i--) { const d = daysAgo(i); const row = { day: d }; keys.forEach(k => row[k] = 0); out.push(row); }
  const idx = Object.fromEntries(out.map((r, i) => [r.day, i]));
  for (const r of results) if (idx[r.day] != null) out[idx[r.day]][r.k] = r.n;
  return out;
}
const FUNNEL = ["lp_view", "cta_click", "lead", "checkout", "sale", "rev", "app:open", "app:paywall", "app:buy_click", "post_click", "ref_click", "email_click"];
async function overview(env) {
  const s = await settings(env);
  const [today, d7, d28, ser] = await Promise.all([statSum(env, FUNNEL, mytDay()), statSum(env, FUNNEL, daysAgo(6)), statSum(env, FUNNEL, daysAgo(27)), series(env, ["lp_view", "lead", "sale", "rev", "app:open"], 28)]);
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
  const [manual, hot, payouts, props, flowQ, failed] = await Promise.all([
    q("SELECT COUNT(*) n FROM posts WHERE status='manual'"),
    q("SELECT COUNT(*) n FROM leads WHERE bought=0 AND contacted=0 AND phone!='' AND (stage='checkout' OR score>=60)"),
    q("SELECT COUNT(*) n, COALESCE(SUM(amount),0) amt FROM commissions WHERE status='pending'"),
    q("SELECT COUNT(*) n FROM proposals WHERE status='open'"),
    q("SELECT COUNT(*) n FROM flow_jobs WHERE status='queued'"),
    q("SELECT COUNT(*) n FROM posts WHERE status='failed' AND created>?", now() - 3 * DAY),
  ]);
  const plan = await env.DB.prepare("SELECT * FROM plans ORDER BY day DESC LIMIT 1").first();
  return { health: await health(env, s), s: { price_sen: s.price_sen, daily_sales_target: s.daily_sales_target, guarantee_days: s.guarantee_days, site_url: s.site_url }, today, d7, d28, series: ser,
    todo: { manual_posts: manual.n, hot_leads: hot.n, payouts: payouts.n, payout_amt: payouts.amt, proposals: props.n, flow_queue: flowQ.n, failed_posts: failed.n },
    plan: plan ? { day: plan.day, ...parseJ(plan.json, {}) } : null,
    integrations: { toyyibpay: !!(env.TOYYIB_SECRET && env.TOYYIB_CATEGORY), toyyib_sandbox: s.toyyib_sandbox === "1" && !!(env.TOYYIB_SANDBOX_SECRET && env.TOYYIB_SANDBOX_CATEGORY), email: !!((env.BREVO_API_KEY || env.RESEND_API_KEY) && s.email_from), telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID), threads: canAuto(withSocial(env, s), "threads"), facebook: canAuto(withSocial(env, s), "facebook"), threads_user: s.threads_username || "", fb_page: s.fb_page_name || "", instagram: !!(s.ig_user_id && s.fb_page_token), ig_user: s.ig_username || "", tg_channel: canAuto(env, "telegram"), brain: !!env.BRAIN_KEY, r2: !!env.MEDIA } };
}
async function brainState(env, agent) {
  const s = await settings(env);
  const ov = await overview(env);
  const all = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then(r => r.results);
  const month = mytDay().slice(0, 7);
  const [posts, angles, vars, leadsHot, leadsNew, affTop, flowUse, flowQ, packs, learnings, plans, runs, props, prompt, itemStats, appEv, coupons, emailStats] = await Promise.all([
    all("SELECT id,platform,angle,hook,substr(body,1,280) body,status,scheduled_at,posted_at,clicks,leads,sales FROM posts WHERE created>? ORDER BY id DESC LIMIT 80", now() - 10 * DAY),
    all("SELECT * FROM angles ORDER BY sales DESC, leads DESC, clicks DESC"),
    all("SELECT id,slot,text,status,views,leads,conv,created FROM variants WHERE status='live'"),
    all("SELECT id,name,phone,email,child_age,stage,score,src,created,contacted,wa_msg FROM leads WHERE bought=0 AND unsub=0 ORDER BY (stage='checkout') DESC, score DESC, created DESC LIMIT 25"),
    env.DB.prepare("SELECT COUNT(*) n FROM leads WHERE created>?").bind(now() - DAY).first(),
    all(`SELECT a.code, a.name, a.handle, a.buyer, COUNT(c.id) sales FROM affiliates a LEFT JOIN commissions c ON c.code=a.code AND c.status!='void' GROUP BY a.code ORDER BY sales DESC LIMIT 15`),
    all("SELECT account, COALESCE(SUM(credits),0) used, COUNT(*) n FROM flow_jobs WHERE substr(datetime(created/1000,'unixepoch','+8 hours'),1,7)=? AND status!='cancelled' GROUP BY account", month),
    all("SELECT id,account,title,status FROM flow_jobs WHERE status IN ('queued','taken') ORDER BY id DESC LIMIT 20"),
    all("SELECT id,title,status,created,json_array_length(items) n FROM packs ORDER BY created DESC LIMIT 20"),
    all("SELECT id,agent,text,evidence,score FROM learnings WHERE status='active' ORDER BY score DESC, id DESC LIMIT 40"),
    all("SELECT day,json FROM plans ORDER BY day DESC LIMIT 3"),
    all("SELECT ts,agent,status,summary,error FROM agent_runs ORDER BY id DESC LIMIT 20"),
    all("SELECT id,agent,kind,title,status FROM proposals ORDER BY id DESC LIMIT 15"),
    env.DB.prepare("SELECT addendum, created FROM agent_prompts WHERE agent=? AND active=1 ORDER BY id DESC LIMIT 1").bind(agent || "").first(),
    all("SELECT k, SUM(n) n FROM stats WHERE day>=? AND k LIKE 'it:%' GROUP BY k", daysAgo(13)),
    all("SELECT k, SUM(n) n FROM stats WHERE day>=? AND k LIKE 'app:%' GROUP BY k ORDER BY n DESC LIMIT 60", daysAgo(6)),
    all("SELECT code,pct,off,expires,max_uses,used,note FROM coupons WHERE (expires IS NULL OR expires>?) AND (max_uses=0 OR used<max_uses) AND code NOT LIKE 'MAMA%' LIMIT 10", now()),
    all("SELECT kind, COUNT(*) sent, COALESCE(SUM(clicks),0) clicks FROM emails WHERE status='sent' AND created>? GROUP BY kind ORDER BY sent DESC LIMIT 20", now() - 30 * DAY),
  ]);
  const it = {};
  for (const r of itemStats) { const m = /^it:(.+):(t|k)$/.exec(r.k); if (m) { it[m[1]] = it[m[1]] || { t: 0, k: 0 }; it[m[1]][m[2]] = r.n; } }
  const hardest = Object.entries(it).filter(([, v]) => v.t >= 8).map(([t, v]) => ({ item: t, tries: v.t, ok_rate: +(v.k / v.t).toFixed(2) })).sort((a, b) => a.ok_rate - b.ok_rate).slice(0, 20);
  const credits = +s.flow_credits_month;
  const flowBudget = s.flow_accounts.split(",").map(a => a.trim()).filter(Boolean).map(a => { const u = flowUse.find(x => x.account === a) || { used: 0, n: 0 }; return { account: a, used: u.used, left: Math.max(0, credits - u.used), videos_left: Math.floor(Math.max(0, credits - u.used) / +s.flow_cost) }; });
  const dim = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  return {
    now_myt: new Date(now() + MYT).toISOString().replace("Z", "+08:00"), agent,
    product: { name: s.brand, price: rm(+s.price_sen), floor: rm(+s.floor_sen), aff_rate_pct: +s.aff_rate_pct, guarantee_days: +s.guarantee_days, site: siteUrl(env, s), levels: CORE.n_levels || 40, items: CORE.n_items || 360, free_levels: CORE.free,
      features: [`${CORE.n_levels || 40} tahap dalam 7 bahagian, ikut pola suku kata yang digunakan di sekolah Malaysia: huruf (vokal, huruf kecil & besar, huruf keliru b/d/p) → suku kata KV → perkataan terbuka → KVK → KVKK → vokal berganding, diftong, ng/ny/kh/sy, konsonan bergabung → kata kerja & imbuhan → ayat, cerita & soalan pemahaman`, "Pengecaman suara: anak sebut, app dengar, 3 kali betul = bintang & gambar 3D", "Mod Ketik Jawapan untuk anak belum bertutur / sebutan belum jelas", "Permainan bunyi (kesedaran fonologi): buang/tukar/gabung suku kata, kira suku kata", "Ujian penempatan 2 minit & ujian kelancaran 1 minit (perkataan betul seminit) dengan graf kemajuan", "Kuiz dengar & pilih setiap tahap", "Misi Harian 10 minit + streak", "Ruang Ibu Bapa: laporan, minit, ketepatan, item lemah", "Pusat Cetak: kad imbas, lembaran kerja, sijil, laporan, pelan 30 hari", "5 profil anak, 3 peranti, offline (PWA)", "Onboarding pilih mod: Biasa / Autisme / Disleksia / Kedua-dua / Belum bertutur", "Mod Tenang & pemasa rehat (autisme), fon Atkinson/Lexend, latar krim, suara perlahan (disleksia)", "Pek cerita baharu setiap minggu", "Telur menetas → koleksi haiwan & maskot"] },
    settings: { auto_post: s.auto_post, auto_variants: s.auto_variants, auto_publish_packs: s.auto_publish_packs, auto_coupons: s.auto_coupons, max_posts_day: +s.max_posts_day, daily_sales_target: +s.daily_sales_target, promo: parseJ(s.promo, null), flow_cost: +s.flow_cost },
    metrics: { today: ov.today, last7: ov.d7, last28: ov.d28, daily: ov.series.slice(-14) }, todo: ov.todo, integrations: ov.integrations, health: ov.health,
    posts, angles, variants: probBest(vars), leads: { new_24h: leadsNew.n, hot: leadsHot }, affiliates: affTop, coupons,
    flow: { budget: flowBudget, days_left_in_month: dim - +mytDay().slice(8, 10) + 1, queue: flowQ },
    app: { events_7d: appEv, hardest_items: hardest }, packs, learnings, plans: plans.map(p => ({ day: p.day, ...parseJ(p.json, {}) })), runs, proposals: props,
    prompt_addendum: prompt ? prompt.addendum : "", email_stats: emailStats.map(e => ({ ...e, kind: String(e.kind).replace(/^abandon:.*/, "abandon") })), nurture_tpl: parseJ(s.nurture_tpl, null) || NURTURE_DEFAULT, aff_swipe: parseJ(s.aff_swipe, []),
  };
}

/* ------------------------------------------------------------------ */
/* Tulisan daripada otak AI (dengan pengawal)                          */
/* ------------------------------------------------------------------ */
const PLATFORMS = ["threads", "facebook", "telegram", "tiktok", "reels", "shorts", "instagram", "wa_status"];
async function brainWrite(env, kind, d, agent) {
  const s = await settings(env);
  const A = clip(agent || d.agent || "brain", 30);
  const rows = Array.isArray(d.rows) ? d.rows.slice(0, 40) : [];
  switch (kind) {
    case "heartbeat": { await setSetting(env, "brain_seen", now()); await setSetting(env, "brain_seen_by", clip(d.via, 20) || "-"); const mt = s.media_test_req === "1"; if (mt) await setSetting(env, "media_test_req", "0"); return { ok: true, media_test: mt }; }
    case "run": {
      await env.DB.prepare("INSERT INTO agent_runs(ts,agent,status,summary,error,llm) VALUES(?,?,?,?,?,?)").bind(now(), A, clip(d.status, 20), clip(d.summary, 4000), clip(d.error, 2000), clip(d.llm, 60)).run();
      return { ok: true };
    }
    case "posts": {
      const day0 = now() - (now() + MYT) % DAY;
      const cnt = await env.DB.prepare("SELECT platform, COUNT(*) n FROM posts WHERE scheduled_at>=? AND scheduled_at<? GROUP BY platform").bind(day0, day0 + 2 * DAY).all();
      const per = Object.fromEntries(cnt.results.map(r => [r.platform, r.n]));
      const max = +s.max_posts_day * 2; const st = env.DB.prepare("INSERT INTO posts(created,platform,angle,hook,body,media_url,flow_id,scheduled_at,status,agent) VALUES(?,?,?,?,?,?,?,?,?,?)");
      const ins = []; let skipped = 0;
      for (const r of rows) {
        const pf = String(r.platform || "").toLowerCase(); if (!PLATFORMS.includes(pf) || !r.body) { skipped++; continue; }
        if ((per[pf] || 0) >= max) { skipped++; continue; } per[pf] = (per[pf] || 0) + 1;
        let at = +r.scheduled_at || Date.parse(r.scheduled_at || "") || now() + 3600e3; if (at < now()) at = now() + 600e3;
        ins.push(st.bind(now(), pf, clip(r.angle, 40), clip(r.hook, 200), clip(r.body, 3000), clip(r.media_url, 500) || null, r.flow_id || null, at, AUTO_PLATFORMS.includes(pf) ? "scheduled" : "manual_wait", A));
      }
      if (ins.length) await env.DB.batch(ins);
      const angles = [...new Set(rows.map(r => clip(r.angle, 40)).filter(Boolean))];
      if (angles.length) await env.DB.batch(angles.map(a => env.DB.prepare("INSERT INTO angles(name,description,created) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET posts=posts").bind(a, "", now())));
      for (const a of angles) await env.DB.prepare("UPDATE angles SET posts=(SELECT COUNT(*) FROM posts WHERE angle=?) WHERE name=?").bind(a, a).run();
      return { ok: true, inserted: ins.length, skipped };
    }
    case "flow": {
      const st = await brainState(env, A); const budget = Object.fromEntries(st.flow.budget.map(b => [b.account, b.left]));
      const cost = +s.flow_cost; const ins = [];
      for (const r of rows) {
        let acc = r.account && budget[r.account] != null ? r.account : Object.entries(budget).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (!acc || budget[acc] < cost) continue; budget[acc] -= cost;
        ins.push(env.DB.prepare("INSERT INTO flow_jobs(created,account,title,angle,prompt,caption,platforms,credits) VALUES(?,?,?,?,?,?,?,?)").bind(now(), acc, clip(r.title, 120), clip(r.angle, 40), typeof r.prompt === "string" ? clip(r.prompt, 8000) : JSON.stringify(r.prompt).slice(0, 8000), clip(r.caption, 2000), JSON.stringify(r.platforms || ["tiktok", "reels", "threads"]), cost));
      }
      if (ins.length) await env.DB.batch(ins);
      return { ok: true, inserted: ins.length };
    }
    case "variants": {
      if (s.auto_variants !== "1") return { ok: false, error: "auto_variants off" };
      const ops = [];
      for (const id of (d.retire || []).slice(0, 6)) ops.push(env.DB.prepare("UPDATE variants SET status='retired' WHERE id=? AND (SELECT COUNT(*) FROM variants v2 WHERE v2.slot=variants.slot AND v2.status='live')>2").bind(+id));
      for (const r of rows.slice(0, 6)) if (["headline", "sub", "cta"].includes(r.slot) && r.text) ops.push(env.DB.prepare("INSERT INTO variants(slot,text,created,agent) VALUES(?,?,?,?)").bind(r.slot, clip(r.text, r.slot === "sub" ? 400 : 160), now(), A));
      for (const op of ops) await op.run();
      return { ok: true, changed: ops.length };
    }
    case "learnings": {
      const ops = rows.filter(r => r.text).map(r => env.DB.prepare("INSERT INTO learnings(created,agent,text,evidence,score) VALUES(?,?,?,?,?)").bind(now(), A, clip(r.text, 500), clip(r.evidence, 500), +r.score || 1));
      for (const id of (d.retire || []).slice(0, 20)) ops.push(env.DB.prepare("UPDATE learnings SET status='retired' WHERE id=?").bind(+id));
      for (const r of (d.rescore || []).slice(0, 20)) ops.push(env.DB.prepare("UPDATE learnings SET score=? WHERE id=?").bind(+r.score || 1, +r.id));
      if (ops.length) await env.DB.batch(ops);
      return { ok: true };
    }
    case "plan": {
      await env.DB.prepare("INSERT INTO plans(day,json,created) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET json=excluded.json, created=excluded.created").bind(clip(d.day || mytDay(), 10), JSON.stringify(d.plan || {}).slice(0, 20000), now()).run();
      return { ok: true };
    }
    case "angles": {
      const ops = rows.filter(r => r.name).map(r => env.DB.prepare("INSERT INTO angles(name,description,status,created) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET description=COALESCE(NULLIF(excluded.description,''),description), status=excluded.status").bind(clip(r.name, 40), clip(r.description, 300), r.status === "paused" ? "paused" : "active", now()));
      if (ops.length) await env.DB.batch(ops);
      return { ok: true };
    }
    case "leads": {
      const ops = rows.filter(r => r.id).map(r => env.DB.prepare("UPDATE leads SET score=COALESCE(?,score), wa_msg=COALESCE(?,wa_msg), notes=COALESCE(?,notes), updated=? WHERE id=?").bind(r.score != null ? +r.score : null, r.wa_msg ? clip(r.wa_msg, 700) : null, r.notes ? clip(r.notes, 300) : null, now(), +r.id));
      if (ops.length) await env.DB.batch(ops);
      return { ok: true, updated: ops.length };
    }
    case "pack": {
      const items = (d.items || []).map(x => clip(x, 200)).filter(x => /^[a-z .,!'-]+/i.test(x)).slice(0, 12);
      if (items.length < 4 || !d.title) return { ok: false, error: "pek tidak sah" };
      const id = "pk" + mytDay().replace(/-/g, "") + rnd(2);
      await env.DB.prepare("INSERT INTO packs(id,title,en,icon,items,status,created,agent,note) VALUES(?,?,?,?,?,?,?,?,?)").bind(id, clip(d.title, 40), clip(d.en, 40), clip(d.icon, 8) || "✨", JSON.stringify(items), s.auto_publish_packs === "1" && d.safe ? "live" : "review", now(), A, clip(d.note, 500)).run();
      return { ok: true, id };
    }
    case "proposals": {
      const ops = rows.filter(r => r.title).map(r => env.DB.prepare("INSERT INTO proposals(created,agent,kind,title,body) VALUES(?,?,?,?,?)").bind(now(), A, clip(r.kind || "idea", 20), clip(r.title, 160), clip(r.body, 3000)));
      if (ops.length) await env.DB.batch(ops);
      return { ok: true };
    }
    case "prompt": {
      if (!d.target) return { ok: false, error: "target?" };
      await env.DB.prepare("UPDATE agent_prompts SET active=0 WHERE agent=?").bind(clip(d.target, 30)).run();
      if (d.addendum) await env.DB.prepare("INSERT INTO agent_prompts(agent,addendum,created,reason) VALUES(?,?,?,?)").bind(clip(d.target, 30), clip(d.addendum, 1500), now(), clip(d.reason, 400)).run();
      return { ok: true };
    }
    case "coupon": {
      if (s.auto_coupons !== "1") return { ok: false, error: "auto_coupons off" };
      const base = +s.price_sen, floor = +s.floor_sen;
      const off = Math.min(base - floor, Math.max(0, d.off ? +d.off : Math.round(base * (+d.pct || 0) / 100)));
      if (!off || !d.code) return { ok: false, error: "diskaun tidak sah" };
      const hrs = Math.min(72, Math.max(6, +d.hours || 48));
      const code = clip(d.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
      await env.DB.prepare("INSERT OR REPLACE INTO coupons(code,off,expires,max_uses,note,created,agent) VALUES(?,?,?,?,?,?,?)").bind(code, off, now() + hrs * 3600e3, +d.max_uses || 0, clip(d.note, 200), now(), A).run();
      if (d.promo) await setSetting(env, "promo", JSON.stringify({ code, label: clip(d.label || `Guna kod ${code}, jimat ${rm(off)}`, 120), until: now() + hrs * 3600e3 }));
      return { ok: true, code, off, until: now() + hrs * 3600e3 };
    }
    case "settings": {
      const allow = ["nurture_tpl", "aff_swipe"];
      for (const [k, v] of Object.entries(d.set || {})) if (allow.includes(k)) await setSetting(env, k, typeof v === "string" ? v : JSON.stringify(v));
      return { ok: true };
    }
    case "notify": { return { ok: await tg(env, clip(d.text, 3900)) }; }
    case "aff_broadcast": {
      const { results } = await env.DB.prepare("SELECT code, token, name, email FROM affiliates WHERE status='active' AND email!='' LIMIT 500").all();
      const site = siteUrl(env, s);
      const st = env.DB.prepare("INSERT INTO emails(created,to_email,subject,html,send_at,kind) VALUES(?,?,?,?,?,?)");
      const ops = results.map(a => st.bind(now(), a.email, clip(d.subject, 150), emailWrap(s, fill(clip(d.html, 8000), { name: (a.name || "").split(" ")[0] || "rakan", link: `${site}/r/${a.code}`, dash: `${site}/affiliate?code=${a.code}&k=${a.token}` }), ""), now() + 60e3, "aff"));
      for (let i = 0; i < ops.length; i += 50) await env.DB.batch(ops.slice(i, i + 50));
      return { ok: true, queued: ops.length };
    }
    default: return { ok: false, error: "kind tidak dikenali: " + kind };
  }
}

/* ------------------------------------------------------------------ */
/* Router HTTP                                                          */
/* ------------------------------------------------------------------ */
const APP_EVENTS = new Set(["open", "lvl_start", "lvl_done", "paywall", "buy_click", "act_ok", "act_fail", "mission_start", "mission_done", "print", "parent_open", "profile_add", "cert", "onboard", "placement_start", "placement", "fluency_start", "fluency", "rest", "lic_removed", "reset_req"]);
const LP_EVENTS = new Set(["cta_click", "form_open", "scroll50", "demo_click", "lead_form_open", "wa_click", "faq_open", "demo_play"]);

async function handle(req, env, ctx) {
  const url = new URL(req.url), p = url.pathname, M = req.method;
  if (M === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,x-brain-key,x-admin-key,x-flow-key,x-lic", "access-control-allow-methods": "GET,POST,OPTIONS" } });
  const needsDb = p.startsWith("/api/") || p.startsWith("/s/") || p.startsWith("/r/") || p.startsWith("/e/") || p === "/admin" || p.startsWith("/m/") || p.startsWith("/b/");
  if (!needsDb) return env.ASSETS.fetch(req);
  await migrate(env);
  const body = async () => { try { return await req.json(); } catch (e) { try { return JSON.parse(await req.text()); } catch (e2) { return {}; } } };

  /* ---- pautan jejak ---- */
  if (p.startsWith("/s/")) {
    const id = +p.slice(3);
    const post = id ? await env.DB.prepare("SELECT id, platform, angle FROM posts WHERE id=?").bind(id).first() : null;
    if (post) { ctx.waitUntil(Promise.all([env.DB.prepare("UPDATE posts SET clicks=clicks+1 WHERE id=?").bind(id).run(), post.angle ? env.DB.prepare("UPDATE angles SET clicks=clicks+1 WHERE name=?").bind(post.angle).run() : null, bump(env, [["post_click"], ["src:p" + id + ":click"]])])); }
    return Response.redirect(`${url.origin}/?src=p${id}&utm_source=${post ? post.platform : "x"}`, 302);
  }
  if (p.startsWith("/r/")) {
    const code = clip(decodeURIComponent(p.slice(3)), 30).toLowerCase();
    ctx.waitUntil(bump(env, [["ref_click"], ["ref:" + code + ":click"]]));
    return Response.redirect(`${url.origin}/?ref=${encodeURIComponent(code)}`, 302);
  }
  if (p.startsWith("/b/")) {
    const src = clip(p.slice(3).replace(/[^a-z0-9_]/gi, ""), 20).toLowerCase() || "bio";
    ctx.waitUntil(bump(env, [["src:" + src + ":click"]]));
    return Response.redirect(`${url.origin}/?src=${src}`, 302);
  }
  if (p.startsWith("/e/")) {
    const id = +p.slice(3); const u = url.searchParams.get("u") || "/";
    const dest = u.startsWith(url.origin) || u.startsWith("/") ? u : url.origin;
    if (id) ctx.waitUntil(Promise.all([env.DB.prepare("UPDATE emails SET clicks=clicks+1 WHERE id=?").bind(id).run(), bump(env, [["email_click"]])]));
    return Response.redirect(dest.startsWith("/") ? url.origin + dest : dest, 302);
  }
  if (p.startsWith("/m/") && env.MEDIA) {
    const mk = decodeURIComponent(p.slice(3));
    if (!mk.startsWith("v/")) return new Response("not found", { status: 404 });
    return serveR2(env, mk, req, "public, max-age=31536000");
  }
  if (p === "/api/vid" && env.MEDIA) {
    const k = url.searchParams.get("k") || "", e = +url.searchParams.get("e") || 0;
    if (!k.startsWith("tester/") || e < now() || url.searchParams.get("s") !== (await hmac(await licSecret(env), "vid|" + k + "|" + e)).slice(0, 20)) return new Response("Pautan tamat atau tidak sah", { status: 403 });
    return serveR2(env, k, req, "private, no-store");
  }
  if (p === "/admin") return new Response(ADMIN_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

  /* ---- API awam ---- */
  if (p === "/api/lp" && M === "GET") {
    const s = await settings(env);
    if (!s.site_url && !env.SITE_URL) ctx.waitUntil(setSetting(env, "site_url", url.origin));
    let code = url.searchParams.get("kupon") || "";
    const promo = parseJ(s.promo, null);
    if (!code && promo && promo.until > now()) code = promo.code;
    const pr = await priceFor(env, s, code);
    const out = { price_sen: pr.amount, price_label: rm(pr.amount), base_label: rm(pr.base), coupon: pr.coupon, promo: promo && promo.until > now() && pr.coupon && pr.coupon.code === promo.code ? promo : null, guarantee_days: +s.guarantee_days, wa: s.wa_number, sandbox: s.toyyib_sandbox === "1" };
    if (url.searchParams.get("lite")) return J(out);
    const { results: vs } = await env.DB.prepare("SELECT id,slot,text,views,leads,conv FROM variants WHERE status='live'").all();
    out.v = pickVariants(vs);
    const { results: ts } = await env.DB.prepare("SELECT name,text,rating,kind FROM testimonials WHERE status='approved' ORDER BY id DESC LIMIT 6").all();
    out.testimonials = ts;
    const paid = await env.DB.prepare("SELECT COUNT(*) n FROM orders WHERE status='paid' AND COALESCE(note,'') NOT LIKE '%sandbox%'").first();
    out.buyers = paid.n >= 20 ? paid.n : null;
    const src = clip(url.searchParams.get("src"), 40);
    ctx.waitUntil(Promise.all([env.DB.batch(Object.values(out.v).map(v => env.DB.prepare("UPDATE variants SET views=views+1 WHERE id=?").bind(v.id))), bump(env, [["lp_view"], ...(src ? [["src:" + src + ":view"]] : [])])]));
    return J(out);
  }
  if (p === "/api/t" && M === "POST") {
    const d = await body(); const e = String(d.e || "");
    if (LP_EVENTS.has(e)) ctx.waitUntil(bump(env, [[e]]));
    return J({ ok: true });
  }
  if (p === "/api/ev" && M === "POST") {
    const d = await body(); const pairs = [];
    for (const [n, x] of (Array.isArray(d.ev) ? d.ev : []).slice(0, 60)) {
      if (!APP_EVENTS.has(n)) continue;
      pairs.push(["app:" + n]);
      if ((n === "lvl_done" || n === "lvl_start") && x && x.l) pairs.push([`app:${n}:${+x.l}`]);
      if (n === "paywall" && x && x.s) pairs.push(["app:paywall:" + clip(x.s, 30)]);
      if (n === "print" && x && x.k) pairs.push(["app:print:" + clip(x.k, 10)]);
      if (n === "onboard" && x && x.m) pairs.push(["app:onboard:" + clip(x.m, 12)]);
      if (n === "placement" && x && x.t) pairs.push(["app:placement:" + (+x.t)]);
    }
    for (const r of (Array.isArray(d.it) ? d.it : []).slice(0, 80)) {
      const t = clip(String(r[0] || "").toLowerCase().replace(/[^a-z ]/g, ""), 40); if (!t) continue;
      pairs.push(["it:" + t + ":t", Math.min(50, +r[1] || 0)], ["it:" + t + ":k", Math.min(50, +r[2] || 0)]);
    }
    if (pairs.length) ctx.waitUntil(bump(env, pairs.slice(0, 200)));
    return J({ ok: true });
  }
  if (p === "/api/lead" && M === "POST") {
    const d = await body();
    if (d.hp) return J({ ok: true });
    if (!okEmail(d.email) && !cleanPhone(d.phone)) return bad("Sila isi emel atau no. telefon yang sah.");
    const l = await upsertLead(env, d, "lead");
    if (!l) return bad("Maklumat tidak sah.");
    if (l.isNew) {
      const ops = [...await variantBump(env, d.vids, "leads"), ...await attribute(env, d.src, "leads")];
      if (ops.length) await env.DB.batch(ops);
      const pairs = [["lead"]]; if (d.src) pairs.push(["src:" + clip(d.src, 40) + ":lead"]); if (d.ref) pairs.push(["ref:" + clip(d.ref, 30) + ":lead"]);
      await bump(env, pairs);
      if (l.email) await queueNurture(env, l.id, l.email);
      ctx.waitUntil(tg(env, `🧲 Lead baharu: ${clip(d.name, 40) || "-"} · ${d.phone ? "📱" : ""}${d.email ? "📧" : ""} · src ${d.src || "-"}`));
    }
    return J({ ok: true, magnet: "/kad-percuma" });
  }
  if (p === "/api/checkout" && M === "POST") {
    const d = await body();
    if (d.hp) return bad("x");
    const email = String(d.email || "").toLowerCase().trim(), phone = cleanPhone(d.phone), name = clip(String(d.name || "").trim(), 60);
    if (!name) return bad("Sila isi nama.");
    if (!okEmail(email)) return bad("Sila isi emel yang sah (lesen dihantar ke emel).");
    if (!phone) return bad("Sila isi no. telefon yang sah.");
    const s = await settings(env), site = siteUrl(env, s, req);
    if (!s.site_url && !env.SITE_URL) ctx.waitUntil(setSetting(env, "site_url", url.origin));
    const pr = await priceFor(env, s, d.coupon);
    const o = { id: "JB" + Date.now().toString(36).toUpperCase() + rnd(2).toUpperCase(), tok: rnd(10), name, email, phone, amount: pr.amount, coupon: pr.coupon ? pr.coupon.code : null, ref: clip(String(d.ref || "").toLowerCase(), 30) || null, src: clip(d.src, 40) || null, vids: JSON.stringify((d.vids || []).slice(0, 6)) };
    await env.DB.prepare("INSERT INTO orders(id,tok,created,name,email,phone,amount,coupon,ref,src,vids,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending')").bind(o.id, o.tok, now(), o.name, o.email, o.phone, o.amount, o.coupon, o.ref, o.src, o.vids).run();
    const lead = await upsertLead(env, { ...d, name, email, phone }, "checkout");
    const pairs = [["checkout"]]; if (o.src) pairs.push(["src:" + o.src + ":checkout"]);
    await bump(env, pairs);
    if (lead && lead.isNew) { const ops = await variantBump(env, d.vids, "leads"); if (ops.length) await env.DB.batch(ops); }
    let payUrl;
    const tc = toyCfg(env, s);
    if (tc.secret && tc.cat) {
      try { const code = await toyCreateBill(tc, o, site); payUrl = tc.host + "/" + code; await env.DB.prepare("UPDATE orders SET billcode=?, pay_url=? WHERE id=?").bind(code, payUrl, o.id).run(); }
      catch (e) { ctx.waitUntil(bump(env, [["pay_error"]])); await tg(env, "⚠️ ToyyibPay" + (tc.sandbox ? " (sandbox)" : "") + " gagal: " + e.message); return bad("Gerbang pembayaran sedang bermasalah. Cuba sebentar lagi atau hubungi kami di WhatsApp.", 502); }
    } else {
      payUrl = `${site}/terima-kasih?o=${o.id}&t=${o.tok}`;
      ctx.waitUntil(tg(env, `🧾 Pesanan manual (ToyyibPay belum disetup): ${o.name} · ${o.phone} · ${rm(o.amount)} · ${o.id}`));
    }
    await env.DB.prepare("INSERT INTO emails(created,lead_id,to_email,subject,html,send_at,kind) VALUES(?,?,?,?,?,?,?)").bind(now(), lead ? lead.id : null, email, "Pembayaran Jom Baca Pro anda belum selesai",
      emailWrap(s, `<p>Hai ${name.split(" ")[0]},</p><p>Kami nampak anda hampir mendapatkan <b>Jom Baca Pro</b>, tetapi pembayaran belum selesai.</p><p><a href="${payUrl}">👉 Sambung pembayaran (${rm(o.amount)})</a></p><p>Ada masalah? Balas emel ini${s.wa_number ? ` atau WhatsApp kami: https://wa.me/${s.wa_number}` : ""}.</p>`, ""), now() + 3600e3, "abandon:" + o.id).run();
    return J({ ok: true, url: payUrl, order: o.id, manual: !(tc.secret && tc.cat), sandbox: tc.sandbox });
  }
  if (p === "/api/pay/toyyib" && M === "POST") {
    const f = await req.formData().catch(() => null);
    if (!f) return new Response("bad", { status: 400 });
    const orderId = String(f.get("order_id") || ""), status = String(f.get("status") || ""), billcode = String(f.get("billcode") || "");
    const o = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(orderId).first();
    if (!o || o.billcode !== billcode) return new Response("unknown", { status: 404 });
    const tc = toyCfgForOrder(env, o);
    if (status === "1" && await toyPaid(tc, billcode, o.amount)) await fulfill(env, o.id, tc.sandbox ? "toyyibpay-sandbox" : "toyyibpay");
    return new Response("OK");
  }
  if (p === "/api/order" && M === "GET") {
    const o = await env.DB.prepare("SELECT * FROM orders WHERE id=? AND tok=?").bind(url.searchParams.get("o") || "", url.searchParams.get("t") || "").first();
    if (!o) return bad("Pesanan tidak dijumpai", 404);
    let cur = o;
    if (o.status !== "paid" && o.billcode && await toyPaid(toyCfgForOrder(env, o), o.billcode, o.amount).catch(() => false)) cur = await fulfill(env, o.id, String(o.pay_url || "").startsWith(TOY_DEV) ? "toyyibpay-sandbox-return" : "toyyibpay-return");
    const s = await settings(env);
    const out = { status: cur.status, name: cur.name, amount: rm(cur.amount), pay_url: cur.status === "paid" ? null : cur.pay_url, manual_text: !o.billcode ? s.manual_pay_text : null, wa: s.wa_number };
    if (cur.status === "paid") {
      const aff = await env.DB.prepare("SELECT code, token FROM affiliates WHERE email=?").bind(cur.email).first();
      Object.assign(out, { license: cur.license, app_url: `/app/?lesen=${cur.license}`, aff: aff ? aff.code : null, aff_k: aff ? aff.token : null });
    }
    return J(out);
  }
  if (p === "/api/license/activate" && M === "POST") {
    const d = await body(); const key = clip(String(d.key || "").toUpperCase().replace(/\s/g, ""), 30), dev = clip(String(d.device || "").replace(/[^a-z0-9-]/gi, ""), 60);
    if (!key || !dev) return bad("Kod atau peranti tidak sah.");
    const lic = await env.DB.prepare("SELECT * FROM licenses WHERE key=?").bind(key).first();
    if (!lic) return J({ ok: false, error: "Kod lesen tidak dijumpai. Semak semula (contoh: JB-ABCD-EFGH-JKLM)." });
    if (lic.status !== "active") return J({ ok: false, error: "Lesen ini tidak aktif. Hubungi kami." });
    if (lic.expires && lic.expires < now()) return J({ ok: false, expired: true, upload: `/pengguji-hantar?k=${encodeURIComponent(key)}`, error: "Tempoh percubaan pengguji sudah tamat. Hantar 2 video anda untuk unlock Jom Baca Pro seumur hidup." });
    const devs = parseJ(lic.devices, []), s = await settings(env), maxD = Math.max(1, +s.max_devices || 3), site = siteUrl(env, s, req);
    if (!devs.includes(dev)) {
      if (devs.length >= maxD) {
        const fails = (lic.fails || 0) + 1;
        await env.DB.prepare("UPDATE licenses SET fails=? WHERE key=?").bind(fails, key).run();
        if (fails === 3 || fails % 10 === 0) ctx.waitUntil(tg(env, `⚠️ Lesen ${maskKey(key)} (${lic.name || "-"}) cuba diaktifkan pada peranti ke-${devs.length + 1} sebanyak ${fails} kali. Mungkin dikongsi. Semak di /admin → Jualan → Lesen.`));
        return J({ ok: false, limit: true, error: `Lesen ini sudah digunakan pada ${maxD} peranti (had maksimum). Pemilik lesen boleh keluarkan peranti lama melalui pautan reset yang dihantar ke emel pembelian.` });
      }
      devs.push(dev); await env.DB.prepare("UPDATE licenses SET devices=? WHERE key=?").bind(JSON.stringify(devs), key).run();
      if (devs.length > 1 && okEmail(lic.email)) {
        const link = `${site}/api/license/reset?k=${encodeURIComponent(key)}&s=${await resetSig(env, key)}`;
        ctx.waitUntil(sendEmail(env, s, lic.email, `Jom Baca Pro diaktifkan pada peranti baharu (${devs.length}/${maxD})`, emailWrap(s, `<p>Hai ${lic.name || ""},</p><p>Lesen Jom Baca Pro anda (${maskKey(key)}) baru sahaja diaktifkan pada <b>peranti ke-${devs.length}</b> daripada had ${maxD} peranti.</p><p>Jika itu anda atau keluarga anda, abaikan emel ini.</p><p>Jika <b>bukan</b> anda, atau anda mahu keluarkan peranti lama (contoh: tukar telefon), tekan pautan ini. Semua peranti akan dikeluarkan dan anda perlu aktifkan semula pada peranti anda sendiri:</p><p><a href="${link}">👉 Keluarkan semua peranti</a></p>`, "")).catch(() => {}));
      }
    }
    const aff = await env.DB.prepare("SELECT code, token FROM affiliates WHERE email=?").bind(lic.email).first();
    return J({ ok: true, trial_days: trialLeft(lic), token: `${key}.${dev}.${await hmac(await licSecret(env), key + "|" + dev)}`, name: lic.name, aff: aff ? aff.code : "", aff_k: aff ? aff.token : "", pack: await contentPack(env) });
  }
  if (p === "/api/license/reset" && M === "GET") {
    const key = clip(url.searchParams.get("k"), 30), sg = url.searchParams.get("s") || "";
    const page = (h, m) => new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body style="font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px;color:#2b2350"><h2>${h}</h2><p>${m}</p><p><a href="/app/">Buka Jom Baca</a></p></body>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (!key || sg !== await resetSig(env, key)) return page("Pautan tidak sah", "Pautan reset ini tidak sah atau sudah rosak.");
    const r = await env.DB.prepare("UPDATE licenses SET devices='[]', fails=0 WHERE key=?").bind(key).run();
    if (!r.meta.changes) return page("Lesen tidak dijumpai", "");
    ctx.waitUntil(tg(env, `🔄 Pemilik lesen ${maskKey(key)} reset semua peranti.`));
    return page("✅ Semua peranti dikeluarkan", "Peranti lain tidak lagi boleh guna lesen ini. Buka Jom Baca pada peranti anda dan masukkan semula kod lesen (👑 → Sudah beli?).");
  }
  if (p === "/api/license/reset-request" && M === "POST") {
    const d = await body(); const key = clip(String(d.key || "").toUpperCase().replace(/\s/g, ""), 30);
    const lic = key ? await env.DB.prepare("SELECT * FROM licenses WHERE key=?").bind(key).first() : null;
    if (lic && okEmail(lic.email)) {
      const s = await settings(env), site = siteUrl(env, s, req);
      const link = `${site}/api/license/reset?k=${encodeURIComponent(key)}&s=${await resetSig(env, key)}`;
      await sendEmail(env, s, lic.email, "Pautan reset peranti Jom Baca Pro", emailWrap(s, `<p>Hai ${lic.name || ""},</p><p>Ada permintaan untuk keluarkan peranti daripada lesen anda (${maskKey(key)}). Jika itu anda, tekan pautan ini:</p><p><a href="${link}">👉 Keluarkan semua peranti</a></p><p>Jika bukan anda, abaikan emel ini. Lesen anda selamat.</p>`, "")).catch(() => {});
    }
    return J({ ok: true, msg: "Jika kod itu sah, pautan reset telah dihantar ke emel pemilik lesen." });
  }
  if (p === "/api/content" && M === "GET") {
    const lic = await verifyLicToken(env, req.headers.get("x-lic"));
    if (!lic) return J({ ok: false, error: "token" }, 401);
    if (lic.status !== "active") return J({ ok: false, revoked: true }, 403);
    if (!lic._devOk) return J({ ok: false, revoked: true, removed: true }, 403);
    if (lic.expires && lic.expires < now()) return J({ ok: false, revoked: true, expired: true, key: lic.key }, 403);
    return J({ ...(await contentPack(env)), trial_days: trialLeft(lic) });
  }
  if (p === "/api/aff/signup" && M === "POST") {
    const d = await body(); if (d.hp) return J({ ok: true });
    const email = String(d.email || "").toLowerCase().trim();
    if (!clip(d.name, 60).trim() || !okEmail(email)) return bad("Sila isi nama dan emel yang sah.");
    const s = await settings(env), site = siteUrl(env, s, req);
    const ex = await env.DB.prepare("SELECT code, token FROM affiliates WHERE email=?").bind(email).first();
    if (ex) {
      await sendEmail(env, s, email, "Pautan papan affiliate Jom Baca anda", emailWrap(s, `<p>Ini pautan papan affiliate anda:</p><p><a href="${site}/affiliate?code=${ex.code}&k=${ex.token}">${site}/affiliate?code=${ex.code}&k=${ex.token}</a></p>`, "")).catch(() => {});
      return J({ ok: true, existing: true, msg: "Emel ini sudah berdaftar. Kami telah hantar semula pautan papan affiliate ke emel anda." });
    }
    const a = await newAffiliate(env, { ...d, email }, false);
    await sendEmail(env, s, email, "Selamat datang, affiliate Jom Baca!", emailWrap(s, `<p>Hai ${clip(d.name, 40)},</p><p>Pautan affiliate anda: <b>${site}/r/${a.code}</b></p><p>Papan affiliate (simpan pautan ini): <a href="${site}/affiliate?code=${a.code}&k=${a.token}">${site}/affiliate?code=${a.code}&k=${a.token}</a></p>`, "")).catch(() => {});
    ctx.waitUntil(tg(env, `🤝 Affiliate baharu: ${clip(d.name, 40)} (${clip(d.handle, 60)})`));
    return J({ ok: true, code: a.code, k: a.token });
  }
  if (p === "/api/aff/me" && M === "GET") {
    const a = await env.DB.prepare("SELECT * FROM affiliates WHERE code=? AND token=?").bind(url.searchParams.get("code") || "", url.searchParams.get("k") || "").first();
    if (!a) return bad("Pautan tidak sah", 404);
    const s = await settings(env), site = siteUrl(env, s, req);
    const st = await env.DB.prepare("SELECT k, SUM(n) n FROM stats WHERE k IN (?,?,?) GROUP BY k").bind(`ref:${a.code}:click`, `ref:${a.code}:lead`, `ref:${a.code}:sale`).all();
    const m = Object.fromEntries(st.results.map(r => [r.k.split(":")[2], r.n]));
    const c = await env.DB.prepare("SELECT status, COUNT(*) n, COALESCE(SUM(amount),0) amt FROM commissions WHERE code=? GROUP BY status").bind(a.code).all();
    const recent = await env.DB.prepare("SELECT amount, status, created FROM commissions WHERE code=? ORDER BY id DESC LIMIT 10").bind(a.code).all();
    const lb = await env.DB.prepare("SELECT a.name, COUNT(c.id) n FROM commissions c JOIN affiliates a ON a.code=c.code WHERE c.created>? AND c.status!='void' GROUP BY c.code ORDER BY n DESC LIMIT 5").bind(now() - 30 * DAY).all();
    const link = `${site}/r/${a.code}`;
    const swipe = parseJ(s.aff_swipe, []).map(x => ({ ...x, text: String(x.text || "").replace(/\{LINK\}/g, link) }));
    return J({ ok: true, name: a.name, code: a.code, link, rate: a.rate, payout: a.payout, clicks: m.click || 0, leads: m.lead || 0, sales: m.sale || 0, comm: c.results, recent: recent.results, leaderboard: lb.results.map(r => ({ name: String(r.name || "").split(" ")[0], n: r.n })), swipe, price: rm(+s.price_sen), per_sale: rm(Math.round(+s.price_sen * a.rate / 100)) });
  }
  if (p === "/api/aff/payout" && M === "POST") {
    const d = await body();
    const r = await env.DB.prepare("UPDATE affiliates SET payout=? WHERE code=? AND token=?").bind(clip(d.payout, 120), clip(d.code, 30), clip(d.k, 40)).run();
    return J({ ok: !!r.meta.changes });
  }
  if (p === "/api/testimonial" && M === "POST") {
    const d = await body(); if (d.hp) return J({ ok: true });
    const text = clip(String(d.text || "").trim(), 800);
    if (text.length < 10) return bad("Sila tulis sekurang-kurangnya satu ayat.");
    const key = clip(String(d.key || "").toUpperCase(), 30);
    const lic = key ? await env.DB.prepare("SELECT kind FROM licenses WHERE key=?").bind(key).first() : null;
    const kind = lic ? (lic.kind || "paid") : "public";
    await env.DB.prepare("INSERT INTO testimonials(created,name,text,rating,kind,lic,consent) VALUES(?,?,?,?,?,?,?)").bind(now(), clip(d.name, 50), text, Math.max(1, Math.min(5, +d.rating || 5)), kind, lic ? key : null, d.consent ? 1 : 0).run();
    ctx.waitUntil(tg(env, `💬 Maklum balas baharu ${"⭐".repeat(Math.max(1, Math.min(5, +d.rating || 5)))} (${kind}${d.consent ? ", boleh disiarkan" : ", JANGAN siar"}):\n${clip(text, 400)}\n— ${clip(d.name, 50)}\nLulus di /admin → Produk`));
    return J({ ok: true });
  }
  if (p === "/api/tester" && M === "GET") {
    const s = await settings(env);
    const n = await env.DB.prepare("SELECT COUNT(*) n FROM licenses WHERE kind='tester'").first();
    const left = Math.max(0, +s.tester_slots - n.n);
    return J({ open: s.tester_open === "1" && left > 0, left, slots: +s.tester_slots });
  }
  if (p === "/api/tester" && M === "POST") {
    const d = await body(); if (d.hp) return J({ ok: true });
    const s = await settings(env), site = siteUrl(env, s, req);
    const email = String(d.email || "").toLowerCase().trim(), phone = cleanPhone(d.phone), name = clip(String(d.name || "").trim(), 60);
    if (!name || !okEmail(email) || !phone) return bad("Sila isi nama, emel dan no. telefon yang sah.");
    if (!d.agree) return bad("Sila tandakan persetujuan untuk memberi maklum balas.");
    if (s.tester_open !== "1") return bad("Pendaftaran pengguji sudah ditutup. Terima kasih atas minat anda!");
    const dup = await env.DB.prepare("SELECT key FROM licenses WHERE email=? OR (phone IS NOT NULL AND phone=?)").bind(email, phone).first();
    if (dup) return bad("Emel atau nombor ini sudah mempunyai lesen Jom Baca Pro.");
    const n = await env.DB.prepare("SELECT COUNT(*) n FROM licenses WHERE kind='tester'").first();
    if (n.n >= +s.tester_slots) return bad("Maaf, semua tempat pengguji sudah penuh.");
    const key = newKey(), days = Math.max(3, +s.tester_trial_days || 10), exp = now() + days * DAY;
    await env.DB.prepare("INSERT INTO licenses(key,order_id,email,name,created,kind,phone,expires) VALUES(?,?,?,?,?,'tester',?,?)").bind(key, null, email, name, now(), phone, exp).run();
    const lead = await upsertLead(env, { name, email, phone, child_age: d.child_age, src: "pengguji" }, "lead");
    if (lead) await env.DB.prepare("UPDATE leads SET stage='tester', notes=? WHERE id=?").bind(clip(`Pengguji. Keperluan: ${d.needs || "-"}`, 300), lead.id).run();
    const up = `${site}/pengguji-hantar?k=${encodeURIComponent(key)}`;
    const html = emailWrap(s, `<p>Hai ${name.split(" ")[0]},</p><p>Terima kasih kerana menyertai <b>Program Pengguji Awal Jom Baca!</b> 🎉</p><p>Kod lesen Pro <b>percubaan ${days} hari</b> anda:</p><p style="font-size:22px;font-weight:bold;letter-spacing:2px">${key}</p><p><a href="${site}/app/?lesen=${key}" style="display:inline-block;background:#17b26a;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:bold">👉 Buka Jom Baca Pro</a></p><p><b>Untuk unlock Pro seumur hidup</b>, sebelum ${days} hari tamat:</p><ol><li>Guna bersama anak sekurang-kurangnya 10 minit sehari.</li><li>Rakam <b>video 1</b>: anak sedang guna app (30 hingga 90 saat). Rakam skrin dan tangan anak sudah cukup, muka anak tidak perlu ditunjukkan.</li><li>Rakam <b>video 2</b>: testimoni anda sendiri (30 hingga 60 saat). Ceritakan pengalaman sebenar.</li><li>Muat naik kedua-dua video di sini: <a href="${up}">${up}</a></li></ol><p>Kami akan semak dan luluskan dalam masa 1 hingga 2 hari bekerja.</p>`, "");
    await sendEmail(env, s, email, "Lesen Pengguji Jom Baca Pro anda: " + key, html).catch(() => {});
    const remind = (dd, subj, msg) => env.DB.prepare("INSERT INTO emails(created,lead_id,to_email,subject,html,send_at,kind) VALUES(?,?,?,?,?,?,?)").bind(now(), lead ? lead.id : null, email, subj, emailWrap(s, `<p>Hai ${name.split(" ")[0]},</p>${msg}<p><a href="${up}" style="display:inline-block;background:#17b26a;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:bold">📹 Muat naik video</a></p>`, ""), now() + dd * DAY, "tester_fb").run();
    await remind(Math.max(1, days - 3), "Jom Baca: masa untuk rakam video pengguji 📹", `<p>Tempoh percubaan Pro anda tinggal <b>3 hari</b>. Untuk unlock Pro seumur hidup, muat naik 2 video: anak sedang guna app, dan testimoni anda.</p><p>Tip: buat <b>Ujian Kelancaran 1 minit</b> dalam Ruang Ibu Bapa dan sebut angkanya dalam video testimoni.</p>`);
    await remind(Math.max(1, days - 1), "Tinggal 1 hari: unlock Jom Baca Pro seumur hidup", `<p>Tempoh percubaan Pro anda <b>tamat esok</b>. Muat naik 2 video anda hari ini supaya akses Pro tidak terputus.</p>`);
    ctx.waitUntil(tg(env, `🧪 Pengguji baharu (${n.n + 1}/${s.tester_slots}): ${name} · ${phone} · anak ${clip(d.child_age, 20) || "-"} · ${clip(d.needs, 60) || "-"} · percubaan ${days} hari`));
    return J({ ok: true, key, app: `/app/?lesen=${key}`, upload: `/pengguji-hantar?k=${encodeURIComponent(key)}`, days, left: +s.tester_slots - n.n - 1 });
  }
  if (p.startsWith("/api/tester/")) {
    const key = clip(String(url.searchParams.get("k") || "").toUpperCase(), 30);
    const lic = key ? await env.DB.prepare("SELECT * FROM licenses WHERE key=? AND kind='tester'").bind(key).first() : null;
    if (!lic) return bad("Kod pengguji tidak sah.", 404);
    let sub = await env.DB.prepare("SELECT * FROM tester_subs WHERE lic=? ORDER BY id DESC LIMIT 1").bind(key).first();
    const s = await settings(env), site = siteUrl(env, s, req);
    if (p === "/api/tester/me" && M === "GET") {
      const st = !lic.expires ? "approved" : sub && sub.status === "pending" ? "pending" : lic.expires < now() ? "expired" : "trial";
      return J({ ok: true, name: lic.name, status: st, days_left: trialLeft(lic), sub: sub ? { status: sub.status, reason: sub.reason, usage: !!sub.usage_key, testi: !!sub.testi_key } : null, r2: !!env.MEDIA });
    }
    if (!lic.expires) return bad("Lesen ini sudah diluluskan sebagai Pro seumur hidup. Terima kasih! 🎉");
    if (sub && sub.status === "pending") return bad("Video anda sedang disemak. Kami akan maklumkan melalui emel.");
    if (!sub || sub.status !== "draft") {
      const r = await env.DB.prepare("INSERT INTO tester_subs(lic,created,updated,status) VALUES(?,?,?,'draft')").bind(key, now(), now()).run();
      sub = { id: r.meta.last_row_id, status: "draft" };
    }
    if (p === "/api/tester/upload" && M === "POST") {
      if (!env.MEDIA) return bad("Storan video belum disediakan. Hubungi kami.", 500);
      const type = url.searchParams.get("type") === "testi" ? "testi" : "usage";
      const ct = (req.headers.get("content-type") || "").toLowerCase(), len = +req.headers.get("content-length") || 0;
      if (!ct.startsWith("video/")) return bad("Fail mesti video (mp4, mov, webm).");
      if (len > 95 * 1024 * 1024) return bad("Video terlalu besar (maksimum 95MB). Rakam lebih pendek atau hantar melalui WhatsApp dahulu untuk dimampatkan.");
      const ext = (ct.split("/")[1] || "mp4").replace(/[^a-z0-9]/g, "").replace("quicktime", "mov").slice(0, 5) || "mp4";
      const objKey = `tester/${key}/${type}-${Date.now().toString(36)}.${ext}`;
      const put = await env.MEDIA.put(objKey, req.body, { httpMetadata: { contentType: ct } });
      const old = type === "testi" ? sub.testi_key : sub.usage_key;
      if (old) ctx.waitUntil(env.MEDIA.delete(old).catch(() => {}));
      await env.DB.prepare(`UPDATE tester_subs SET ${type === "testi" ? "testi_key=?, testi_size=?" : "usage_key=?, usage_size=?"}, updated=? WHERE id=?`).bind(objKey, put ? put.size : len, now(), sub.id).run();
      return J({ ok: true, type, size: put ? put.size : len });
    }
    if (p === "/api/tester/submit" && M === "POST") {
      const d = await body();
      const cur = await env.DB.prepare("SELECT * FROM tester_subs WHERE id=?").bind(sub.id).first();
      if (!cur.usage_key || !cur.testi_key) return bad("Sila muat naik kedua-dua video dahulu.");
      if (!d.consent_review) return bad("Sila tandakan izin untuk semakan video.");
      await env.DB.prepare("UPDATE tester_subs SET summary=?, consent_review=1, pub_parent=?, pub_child=?, status='pending', updated=? WHERE id=?").bind(clip(d.summary, 800), d.pub_parent ? 1 : 0, d.pub_child ? 1 : 0, now(), sub.id).run();
      await env.DB.prepare("UPDATE licenses SET expires=MAX(expires, ?) WHERE key=?").bind(now() + 3 * DAY, key).run();
      ctx.waitUntil(tg(env, `📹 <b>Video pengguji untuk disemak</b>: ${lic.name}\nIzin siar: ibu bapa ${d.pub_parent ? "✓" : "✗"} · anak ${d.pub_child ? "✓" : "✗"}\n${clip(d.summary, 300)}\n${site}/admin → 🧪 Pengguji`));
      if (okEmail(lic.email)) ctx.waitUntil(sendEmail(env, s, lic.email, "Video pengguji anda diterima 📹", emailWrap(s, `<p>Hai ${String(lic.name || "").split(" ")[0]},</p><p>Terima kasih! Kedua-dua video anda sudah kami terima dan akan disemak dalam 1 hingga 2 hari bekerja. Akses Pro percubaan anda dilanjutkan 3 hari sementara menunggu semakan.</p>`, "")).catch(() => {}));
      return J({ ok: true });
    }
    return bad("?", 404);
  }
  if (p === "/api/unsub" && M === "GET") {
    const id = +url.searchParams.get("l");
    if (id && url.searchParams.get("s") === await unsubSig(env, id)) {
      await env.DB.batch([env.DB.prepare("UPDATE leads SET unsub=1 WHERE id=?").bind(id), env.DB.prepare("UPDATE emails SET status='cancelled' WHERE lead_id=? AND status='queued'").bind(id)]);
      return new Response("<meta charset=utf-8><body style='font-family:sans-serif;padding:40px;text-align:center'><h2>Anda telah berhenti melanggan.</h2><p>Maaf mengganggu. Anda tidak akan menerima emel promosi lagi.</p></body>", { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("Pautan tidak sah", { status: 400 });
  }

  /* ---- Flow (Google Flow / Veo) ---- */
  if (p.startsWith("/api/flow/") || p === "/api/media") {
    const k = req.headers.get("x-flow-key") || url.searchParams.get("key");
    if (!k || (k !== env.FLOW_KEY && k !== env.BRAIN_KEY)) return bad("unauthorized", 401);
    if (p === "/api/flow/next") {
      const acc = url.searchParams.get("account");
      const j = await env.DB.prepare(`SELECT * FROM flow_jobs WHERE status='queued' ${acc ? "AND account=?" : ""} ORDER BY id LIMIT 1`).bind(...(acc ? [acc] : [])).first();
      if (!j) return J({ ok: true, job: null });
      await env.DB.prepare("UPDATE flow_jobs SET status='taken' WHERE id=?").bind(j.id).run();
      return J({ ok: true, job: { ...j, prompt: parseJ(j.prompt, j.prompt), platforms: parseJ(j.platforms, []) } });
    }
    if (p === "/api/flow/done" && M === "POST") {
      const d = await body(); const j = await env.DB.prepare("SELECT * FROM flow_jobs WHERE id=?").bind(+d.id).first();
      if (!j) return bad("job?", 404);
      if (d.status === "failed") { await env.DB.prepare("UPDATE flow_jobs SET status='failed', done_at=? WHERE id=?").bind(now(), j.id).run(); return J({ ok: true }); }
      await env.DB.prepare("UPDATE flow_jobs SET status='done', video_url=?, done_at=? WHERE id=?").bind(clip(d.video_url, 500), now(), j.id).run();
      const pf0 = parseJ(j.platforms, ["tiktok", "reels", "threads"]), pf = /\.mp4(\?|$)/i.test(d.video_url || "") && !pf0.includes("instagram") ? [...pf0, "instagram"] : pf0; const h = mytHour();
      const at = now() + ((h < 20 ? 20 - h : 24 - h + 20) * 3600e3);
      const st = env.DB.prepare("INSERT INTO posts(created,platform,angle,hook,body,media_url,flow_id,scheduled_at,status,agent) VALUES(?,?,?,?,?,?,?,?,?,?)");
      await env.DB.batch(pf.filter(x => PLATFORMS.includes(x)).map((x, i) => st.bind(now(), x, j.angle, j.title, j.caption || j.title, clip(d.video_url, 500), j.id, at + i * 900e3, AUTO_PLATFORMS.includes(x) ? "scheduled" : "manual_wait", "flow")));
      return J({ ok: true });
    }
    if (p === "/api/media" && M === "POST") {
      if (!env.MEDIA) return bad("R2 MEDIA belum di-bind", 400);
      const key = "v/" + mytDay() + "/" + rnd(6) + "." + (url.searchParams.get("ext") || "mp4").replace(/[^a-z0-9]/g, "");
      await env.MEDIA.put(key, req.body, { httpMetadata: { contentType: req.headers.get("content-type") || "video/mp4" } });
      return J({ ok: true, url: `${url.origin}/m/${key}` });
    }
    return bad("?", 404);
  }

  /* ---- Otak AI ---- */
  if (p.startsWith("/api/brain/")) {
    if (!env.BRAIN_KEY || req.headers.get("x-brain-key") !== env.BRAIN_KEY) return bad("unauthorized", 401);
    if (p === "/api/brain/state") return J(await brainState(env, url.searchParams.get("agent") || ""));
    if (p === "/api/brain/claim" && M === "POST") {
      const d = await body();
      const r = await env.DB.prepare("INSERT OR IGNORE INTO claims(agent,slot,ts) VALUES(?,?,?)").bind(clip(d.agent, 30), clip(d.slot, 40), now()).run();
      return J({ ok: !!r.meta.changes });
    }
    if (p === "/api/brain/media" && M === "POST") {
      if (!env.MEDIA) return bad("R2 tiada", 500);
      const ct = (req.headers.get("content-type") || "").toLowerCase();
      const ext = { "image/png": "png", "image/jpeg": "jpg", "video/mp4": "mp4" }[ct];
      if (!ext) return bad("jenis media tidak disokong");
      if (+req.headers.get("content-length") > 95 * 1024 * 1024) return bad("terlalu besar");
      const mk = `v/b/${mytDay()}/${Date.now().toString(36)}${rnd(4)}.${ext}`;
      await env.MEDIA.put(mk, req.body, { httpMetadata: { contentType: ct } });
      const s = await settings(env);
      return J({ ok: true, key: mk, url: `${siteUrl(env, s, req)}/m/${mk}` });
    }
    if (p === "/api/brain/write" && M === "POST") { const d = await body(); return J(await brainWrite(env, d.kind, d, d.agent)); }
    return bad("?", 404);
  }

  /* ---- Admin ---- */
  if (p.startsWith("/api/admin/")) {
    if (!env.ADMIN_KEY || req.headers.get("x-admin-key") !== env.ADMIN_KEY) return bad("unauthorized", 401);
    const s = await settings(env);
    if (!s.site_url && !env.SITE_URL) ctx.waitUntil(setSetting(env, "site_url", url.origin));
    if (p === "/api/admin/overview") return J(await overview(env));
    if (p === "/api/admin/list") {
      const t = url.searchParams.get("t"), f = url.searchParams.get("f") || "";
      const Q = {
        posts: f === "manual" ? "SELECT * FROM posts WHERE status IN ('manual','manual_wait') ORDER BY scheduled_at LIMIT 100" : "SELECT * FROM posts ORDER BY COALESCE(posted_at, scheduled_at) DESC LIMIT 150",
        leads: f === "hot" ? "SELECT * FROM leads WHERE bought=0 AND unsub=0 AND phone!='' ORDER BY contacted ASC, (stage='checkout') DESC, score DESC, created DESC LIMIT 100" : "SELECT * FROM leads ORDER BY id DESC LIMIT 200",
        orders: "SELECT id,created,name,email,phone,amount,coupon,ref,src,status,paid_at,license,note FROM orders ORDER BY created DESC LIMIT 200",
        licenses: "SELECT key,name,email,kind,status,created,expires,json_array_length(devices) devices,fails FROM licenses ORDER BY created DESC LIMIT 300",
        testers: "SELECT l.key, l.name, l.email, l.phone, l.created, l.expires, l.status lic_status, t.id sub_id, t.status, t.usage_key, t.usage_size, t.testi_key, t.testi_size, t.summary, t.pub_parent, t.pub_child, t.reason, t.updated FROM licenses l LEFT JOIN tester_subs t ON t.id=(SELECT MAX(id) FROM tester_subs WHERE lic=l.key) WHERE l.kind='tester' ORDER BY (t.status='pending') DESC, l.created DESC LIMIT 100",
        affiliates: "SELECT a.code,a.name,a.email,a.phone,a.handle,a.payout,a.rate,a.status,a.buyer,a.created,(SELECT COUNT(*) FROM commissions c WHERE c.code=a.code AND c.status!='void') sales,(SELECT COALESCE(SUM(amount),0) FROM commissions c WHERE c.code=a.code AND c.status='pending') owed FROM affiliates a ORDER BY sales DESC, created DESC LIMIT 200",
        commissions: "SELECT c.*, a.name, a.payout FROM commissions c LEFT JOIN affiliates a ON a.code=c.code ORDER BY c.status='pending' DESC, c.id DESC LIMIT 200",
        variants: "SELECT * FROM variants ORDER BY status='live' DESC, slot, id DESC LIMIT 100",
        flow: "SELECT * FROM flow_jobs ORDER BY id DESC LIMIT 100",
        packs: "SELECT * FROM packs ORDER BY created DESC LIMIT 50",
        learnings: "SELECT * FROM learnings ORDER BY status='active' DESC, score DESC, id DESC LIMIT 100",
        proposals: "SELECT * FROM proposals ORDER BY status='open' DESC, id DESC LIMIT 100",
        testimonials: "SELECT * FROM testimonials ORDER BY id DESC LIMIT 100",
        coupons: "SELECT * FROM coupons WHERE code NOT LIKE 'MAMA%' OR used>0 ORDER BY created DESC LIMIT 100",
        runs: "SELECT * FROM agent_runs ORDER BY id DESC LIMIT 100",
        emails: "SELECT id,created,lead_id,to_email,subject,send_at,status,sent_at,kind,clicks,error FROM emails ORDER BY id DESC LIMIT 150",
        angles: "SELECT * FROM angles ORDER BY sales DESC, leads DESC, clicks DESC",
        prompts: "SELECT * FROM agent_prompts ORDER BY id DESC LIMIT 50",
        plans: "SELECT * FROM plans ORDER BY day DESC LIMIT 14",
        settings: "SELECT * FROM settings WHERE k NOT IN ('lic_secret','schema_v','threads_token','fb_page_token','threads_token_refreshed','threads_token_exp','threads_user_id','fb_page_id','fb_long','ig_user_id','ig_checked','media_test_req','brain_seen','brain_seen_by') AND k NOT LIKE 'wd:%'",
        app: "SELECT k, SUM(n) n FROM stats WHERE day>=date('now','-13 day') AND (k LIKE 'app:%' OR k LIKE 'src:%' OR k LIKE 'ref:%') GROUP BY k ORDER BY n DESC LIMIT 200",
      };
      if (!Q[t]) return bad("t?");
      let rows = (await env.DB.prepare(Q[t]).all()).results;
      if (t === "variants") rows = probBest(rows.filter(r => r.status === "live")).concat(rows.filter(r => r.status !== "live"));
      if (t === "testers") { const site = siteUrl(env, s, req); for (const r of rows) { r.days_left = trialLeft(r); if (r.usage_key) r.usage_url = await vidUrl(env, site, r.usage_key); if (r.testi_key) r.testi_url = await vidUrl(env, site, r.testi_key); } }
      if (t === "settings") { const m = Object.fromEntries(rows.map(r => [r.k, r.v])); rows = Object.keys(DEFAULTS).map(k => ({ k, v: m[k] != null ? m[k] : DEFAULTS[k], default: DEFAULTS[k] })); }
      return J({ rows });
    }
    if (p === "/api/admin/act" && M === "POST") {
      const d = await body(); const a = d.a; const id = d.id;
      const run = (sql, ...b) => env.DB.prepare(sql).bind(...b).run();
      switch (a) {
        case "post_update": await run("UPDATE posts SET body=COALESCE(?,body), status=COALESCE(?,status), scheduled_at=COALESCE(?,scheduled_at), media_url=COALESCE(?,media_url) WHERE id=?", d.body ?? null, d.status ?? null, d.scheduled_at ?? null, d.media_url ?? null, +id); break;
        case "post_manual_done": await run("UPDATE posts SET status='posted', posted_at=?, ext_id=? WHERE id=?", now(), clip(d.url, 300), +id); break;
        case "post_text": { const pp = await env.DB.prepare("SELECT * FROM posts WHERE id=?").bind(+id).first(); return J({ ok: true, text: postText(pp, siteUrl(env, s, req)) }); }
        case "order_paid": await fulfill(env, id, d.test ? "manual-sandbox-test" : "manual-admin"); break;
        case "order_refund": {
          const o = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first(); if (!o) return bad("?");
          await env.DB.batch([env.DB.prepare("UPDATE orders SET status='refunded' WHERE id=?").bind(id), env.DB.prepare("UPDATE licenses SET status='revoked' WHERE order_id=?").bind(id), env.DB.prepare("UPDATE commissions SET status='void' WHERE order_id=? AND status='pending'").bind(id)]);
          await bump(env, [["refund"], ["rev", -o.amount]]); break;
        }
        case "lic_reset": await run("UPDATE licenses SET devices='[]', fails=0 WHERE key=?", clip(d.key, 30)); break;
        case "threads_connect": return J(await threadsConnect(env, d.token).catch(e => ({ ok: false, error: e.message })));
        case "fb_connect": return J(await fbConnect(env, d.token, d.page).catch(e => ({ ok: false, error: e.message })));
        case "media_test_req": await setSetting(env, "media_test_req", "1"); break;
        case "ig_resolve": { const ig = await igResolve(env, s); return J(ig ? { ok: true, username: ig.username } : { ok: false, error: "Akaun IG belum dipautkan ke Page ini, atau token tiada kebenaran instagram_basic." }); }
        case "social_disconnect": for (const k of d.p === "fb" ? ["fb_page_id", "fb_page_token", "fb_page_name", "ig_user_id", "ig_username", "ig_checked"] : ["threads_token", "threads_user_id", "threads_username", "threads_token_exp"]) await run("DELETE FROM settings WHERE k=?", k); break;
        case "tester_approve": {
          const t = await env.DB.prepare("SELECT t.*, l.email, l.name FROM tester_subs t JOIN licenses l ON l.key=t.lic WHERE t.id=?").bind(+id).first(); if (!t) return bad("?");
          await env.DB.batch([env.DB.prepare("UPDATE licenses SET expires=NULL, status='active' WHERE key=?").bind(t.lic), env.DB.prepare("UPDATE tester_subs SET status='approved', reviewed_at=? WHERE id=?").bind(now(), t.id)]);
          if (t.pub_parent && t.summary) await run("INSERT INTO testimonials(created,name,text,rating,kind,lic,consent,status) VALUES(?,?,?,?,?,?,?,'pending')", now(), clip(t.name, 50), clip(t.summary, 800), 5, "tester", t.lic, 1);
          const site = siteUrl(env, s, req);
          if (okEmail(t.email)) await sendEmail(env, s, t.email, "Tahniah! Jom Baca Pro anda kini seumur hidup 🎉", emailWrap(s, `<p>Hai ${String(t.name || "").split(" ")[0]},</p><p>Video anda sudah diluluskan. Terima kasih banyak atas bantuan anda! 💚</p><p>Lesen <b>${t.lic}</b> kini <b>Pro seumur hidup</b>. Jika app pernah tamat tempoh, buka semula pautan ini:</p><p><a href="${site}/app/?lesen=${t.lic}" style="display:inline-block;background:#17b26a;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:bold">👉 Buka Jom Baca Pro</a></p>`, "")).catch(() => {});
          break;
        }
        case "tester_reject": {
          const t = await env.DB.prepare("SELECT t.*, l.email, l.name FROM tester_subs t JOIN licenses l ON l.key=t.lic WHERE t.id=?").bind(+id).first(); if (!t) return bad("?");
          await run("UPDATE tester_subs SET status='rejected', reason=?, reviewed_at=? WHERE id=?", clip(d.reason, 400), now(), t.id);
          await run("UPDATE licenses SET expires=MAX(COALESCE(expires,0), ?) WHERE key=?", now() + 3 * DAY, t.lic);
          const site = siteUrl(env, s, req);
          if (okEmail(t.email)) await sendEmail(env, s, t.email, "Jom Baca: video pengguji perlu dihantar semula", emailWrap(s, `<p>Hai ${String(t.name || "").split(" ")[0]},</p><p>Terima kasih atas video anda. Kami perlukan sedikit perubahan sebelum boleh meluluskan:</p><p><i>${clip(d.reason, 400) || "Video kurang jelas."}</i></p><p>Anda ada 3 hari lagi untuk muat naik semula:</p><p><a href="${site}/pengguji-hantar?k=${encodeURIComponent(t.lic)}">📹 Muat naik semula</a></p>`, "")).catch(() => {});
          break;
        }
        case "tester_extend": await run("UPDATE licenses SET expires=? WHERE key=? AND kind='tester'", now() + (+d.days || 7) * DAY, clip(d.key, 30)); break;
        case "tester_delvid": {
          const t = await env.DB.prepare("SELECT * FROM tester_subs WHERE id=?").bind(+id).first(); if (!t) return bad("?");
          if (env.MEDIA) for (const k of [t.usage_key, t.testi_key]) if (k) await env.MEDIA.delete(k).catch(() => {});
          await run("UPDATE tester_subs SET usage_key=NULL, testi_key=NULL WHERE id=?", t.id); break;
        }
        case "lic_status": await run("UPDATE licenses SET status=? WHERE key=?", d.status === "revoked" ? "revoked" : "active", clip(d.key, 30)); break;
        case "comm_paid": for (const cid of (d.ids || [id])) await run("UPDATE commissions SET status='paid', paid_at=? WHERE id=?", now(), +cid); break;
        case "aff_status": await run("UPDATE affiliates SET status=?, rate=COALESCE(?,rate) WHERE code=?", d.status, d.rate ?? null, id); break;
        case "variant_status": await run("UPDATE variants SET status=? WHERE id=?", d.status, +id); break;
        case "variant_add": await run("INSERT INTO variants(slot,text,created,agent) VALUES(?,?,?,'admin')", d.slot, clip(d.text, 400), now()); break;
        case "pack_status": await run("UPDATE packs SET status=? WHERE id=?", d.status, id); break;
        case "learning_status": await run("UPDATE learnings SET status=? WHERE id=?", d.status, +id); break;
        case "learning_add": await run("INSERT INTO learnings(created,agent,text,evidence,score) VALUES(?,?,?,?,3)", now(), "azrin", clip(d.text, 500), "arahan pemilik"); break;
        case "proposal_status": await run("UPDATE proposals SET status=? WHERE id=?", d.status, +id); break;
        case "testimonial_add": await run("INSERT INTO testimonials(created,name,text,status) VALUES(?,?,?,'approved')", now(), clip(d.name, 40), clip(d.text, 600)); break;
        case "testimonial_status": await run("UPDATE testimonials SET status=? WHERE id=?", d.status, +id); break;
        case "coupon_add": await run("INSERT OR REPLACE INTO coupons(code,pct,off,expires,max_uses,note,created,agent) VALUES(?,?,?,?,?,?,?,'admin')", clip(d.code, 20).toUpperCase(), +d.pct || 0, +d.off || 0, d.hours ? now() + d.hours * 3600e3 : null, +d.max_uses || 0, clip(d.note, 200), now()); break;
        case "coupon_del": await run("DELETE FROM coupons WHERE code=?", id); break;
        case "setting_set": if (!(d.k in DEFAULTS)) return bad("kunci?"); await setSetting(env, d.k, d.v); break;
        case "lead_update": await run("UPDATE leads SET stage=COALESCE(?,stage), contacted=COALESCE(?,contacted), notes=COALESCE(?,notes), updated=? WHERE id=?", d.stage ?? null, d.contacted ?? null, d.notes ?? null, now(), +id); break;
        case "flow_update": await run("UPDATE flow_jobs SET status=COALESCE(?,status), video_url=COALESCE(?,video_url) WHERE id=?", d.status ?? null, d.video_url ?? null, +id); break;
        case "prompt_off": await run("UPDATE agent_prompts SET active=0 WHERE id=?", +id); break;
        case "tick": await cron(env); break;
        case "test_email": await sendEmail(env, s, d.to, "Ujian emel Jom Baca HQ", emailWrap(s, "<p>Emel berfungsi ✅</p>", "")); break;
        case "test_tg": return J({ ok: await tg(env, "✅ Telegram Jom Baca HQ berfungsi") });
        default: return bad("aksi?");
      }
      return J({ ok: true });
    }
    return bad("?", 404);
  }
  return bad("not found", 404);
}

/* ------------------------------------------------------------------ */
/* Pengawas: semak kesihatan sistem & amaran Telegram (tanpa spam)     */
/* ------------------------------------------------------------------ */
async function health(env, s) {
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
  const h = mytHour(), out = [];
  const add = (name, ok, detail, fix) => out.push({ name, ok, detail, fix });
  const lastRun = await q("SELECT MAX(ts) t FROM agent_runs");
  const seen = Math.max(+(s.brain_seen || 0), lastRun && lastRun.t || 0);
  const age = seen ? (now() - seen) / 3600e3 : null;
  add("Otak AI (Modal/GitHub)", !env.BRAIN_KEY ? null : age != null && age < 2.5, age == null ? "Belum pernah berjalan" : `Kali terakhir hidup ${age < 1 ? Math.round(age * 60) + " minit" : age.toFixed(1) + " jam"} lalu${s.brain_seen_by ? " (" + s.brain_seen_by + ")" : ""}`, "Semak Modal (app jombaca-brain) atau GitHub Actions 'Otak Jom Baca'.");
  const errs = await q("SELECT COUNT(*) n, GROUP_CONCAT(agent, ', ') a FROM agent_runs WHERE status!='ok' AND ts>?", now() - 6 * 3600e3);
  add("Ralat agen (6 jam)", errs.n < 2, errs.n ? `${errs.n} ralat: ${errs.a}` : "Tiada", "Lihat /admin → 🧠 Otak AI → Larian agen.");
  const em = await q("SELECT COUNT(*) n, MAX(error) e FROM emails WHERE status='failed' AND created>?", now() - DAY);
  add("Emel (24 jam)", em.n < 3, em.n ? `${em.n} gagal: ${clip(em.e, 120)}` : "OK", "Semak BREVO_API_KEY dan email_from.");
  const ps = await q("SELECT COUNT(*) n, MAX(error) e FROM posts WHERE status='failed' AND created>?", now() - DAY);
  add("Auto-post (24 jam)", ps.n < 2, ps.n ? `${ps.n} gagal: ${clip(ps.e, 120)}` : "OK", "Token Threads/FB mungkin tamat.");
  const st = await statSum(env, ["pay_error", "err_500"], mytDay());
  add("Pembayaran (hari ini)", st.pay_error < 2, st.pay_error ? `${st.pay_error} ralat ToyyibPay` : "OK", "Semak TOYYIB_SECRET / TOYYIB_CATEGORY.");
  add("Ralat pelayan (hari ini)", st.err_500 < 5, st.err_500 ? `${st.err_500} ralat. Terakhir: ${clip(s.last_err, 140)}` : "OK", "Hantar mesej ralat ini kepada Claude.");
  add("Mod sandbox", s.toyyib_sandbox !== "1", s.toyyib_sandbox === "1" ? "MASIH AKTIF: pembeli sebenar tak boleh bayar" : "Mati (live)", "Tetapan → toyyib_sandbox = 0.");
  if (s.threads_token) { const dl = (+(s.threads_token_exp || 0) - now()) / DAY; add("Token Threads", dl > 7, `@${s.threads_username || "?"} · tamat dalam ${Math.max(0, Math.floor(dl))} hari`, "Sambung semula di /admin → ⚙️ Tetapan → Media sosial."); }
  const pend = await q("SELECT COUNT(*) n, MIN(updated) t FROM tester_subs WHERE status='pending'");
  add("Video pengguji menunggu", !(pend.n && now() - pend.t > DAY), pend.n ? `${pend.n} menunggu semakan` : "Tiada", "/admin → 🧪 Pengguji.");
  const pay = { live: !!(env.TOYYIB_SECRET && env.TOYYIB_CATEGORY), mail: !!((env.BREVO_API_KEY || env.RESEND_API_KEY) && s.email_from), tgok: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) };
  add("Kunci ToyyibPay live", pay.live, pay.live ? "Ada" : "Tiada: pesanan masuk mod manual", "Tambah secret TOYYIB_SECRET & TOYYIB_CATEGORY.");
  add("Emel & Telegram", pay.mail && pay.tgok, `Emel ${pay.mail ? "✓" : "✗"} · Telegram ${pay.tgok ? "✓" : "✗"}`, "Lihat README langkah 4 & 5.");
  return out;
}
async function watchdog(env, s) {
  if (s.tg_alerts === "0") return;
  const bad = (await health(env, s)).filter(c => c.ok === false && !/^(Kunci ToyyibPay|Emel & Telegram)/.test(c.name));
  const nowT = now(), send = [];
  for (const c of bad) {
    const k = "wd:" + c.name, last = +(s[k] || 0), every = c.name === "Mod sandbox" ? 3 : 6;
    if (nowT - last > every * 3600e3) { send.push(c); await setSetting(env, k, nowT); }
  }
  if (send.length) await tg(env, "🛡️ <b>Pengawas Jom Baca</b>\n" + send.map(c => `⚠️ <b>${c.name}</b>: ${c.detail}\n   ➜ ${c.fix}`).join("\n") + `\n${siteUrl(env, s)}/admin`);
}

/* ------------------------------------------------------------------ */
/* Cron setiap 15 minit                                                */
/* ------------------------------------------------------------------ */
async function cron(env) {
  await migrate(env);
  const s = await settings(env);
  await env.DB.prepare("UPDATE posts SET status='manual' WHERE status='manual_wait' AND scheduled_at<=?").bind(now() + 3 * 3600e3).run();
  await publishDue(env, s).catch(e => console.log("publish", e));
  await sendDueEmails(env, s).catch(e => console.log("email", e));
  const h = mytHour(), m = new Date().getUTCMinutes();
  if (h === 22 && m < 15) {
    const t = await statSum(env, ["lp_view", "lead", "checkout", "sale", "rev"], mytDay());
    const manual = await env.DB.prepare("SELECT COUNT(*) n FROM posts WHERE status='manual'").first();
    const hot = await env.DB.prepare("SELECT COUNT(*) n FROM leads WHERE bought=0 AND contacted=0 AND phone!='' AND (stage='checkout' OR score>=60)").first();
    await tg(env, `📊 <b>Ringkasan hari ini</b>\nJualan: ${t.sale} (${rm(t.rev)}) / sasaran ${s.daily_sales_target}\nLawatan: ${t.lp_view} · Lead: ${t.lead} · Checkout: ${t.checkout}\n📌 Post manual menunggu: ${manual.n}\n📱 Lead panas untuk WhatsApp: ${hot.n}\n${siteUrl(env, s)}/admin`);
  }
  if (m < 15) await watchdog(env, s).catch(e => console.log("watchdog", e));
  if (h === 3 && m < 15) {
    await threadsRefresh(env, s).catch(e => console.log("threads refresh", e));
    await env.DB.prepare("DELETE FROM claims WHERE ts<?").bind(now() - 30 * DAY).run();
    if (env.MEDIA) {
      const keep = Math.max(7, +s.video_keep_days || 90) * DAY;
      const { results } = await env.DB.prepare("SELECT * FROM tester_subs WHERE (usage_key IS NOT NULL OR testi_key IS NOT NULL) AND ((status='rejected' AND reviewed_at<?) OR (status='approved' AND reviewed_at<? AND pub_parent=0 AND pub_child=0) OR (status='draft' AND updated<?))").bind(now() - 30 * DAY, now() - keep, now() - keep).all();
      for (const t of results) { for (const k of [t.usage_key, t.testi_key]) if (k) await env.MEDIA.delete(k).catch(() => {}); await env.DB.prepare("UPDATE tester_subs SET usage_key=NULL, testi_key=NULL WHERE id=?").bind(t.id).run(); }
    }
  }
}

export default {
  async fetch(req, env, ctx) {
    try { return await handle(req, env, ctx); }
    catch (e) {
      console.log("ERR", e && e.stack || e);
      ctx.waitUntil(Promise.all([bump(env, [["err_500"]]), setSetting(env, "last_err", new Date().toISOString() + " " + new URL(req.url).pathname + " " + clip(e && e.message || e, 300))]).catch(() => {}));
      return bad("Ralat pelayan: " + (e && e.message || e), 500);
    }
  },
  async scheduled(ev, env, ctx) { ctx.waitUntil(cron(env)); },
};
