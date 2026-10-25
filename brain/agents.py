"""Agen-agen Jom Baca. Setiap agen: baca keadaan HQ → fikir (LLM) → tulis tindakan ke HQ (dengan pengawal).

Gelung self-improve:
  1. Setiap post/varian/emel dijejak hingga ke jualan (klik → lead → jualan).
  2. Bandit (Thompson sampling) memilih sudut kandungan & varian laman jualan yang menang.
  3. Agen Reflect setiap malam menulis "pelajaran" berbukti ke memori, bersarakan yang salah,
     dan mengemas kini tambahan prompt agen lain (versi disimpan, boleh dimatikan di admin).
  4. Semua agen membaca memori + pelan CEO + arahan pemilik sebelum bertindak.
"""
import datetime as dt
import json
import os
import random
import re
import urllib.request

from .llm import ask_json

MYT = dt.timezone(dt.timedelta(hours=8))

GUARDRAILS = """PERATURAN WAJIB (jangan langgar):
- Semua teks untuk pelanggan dalam Bahasa Malaysia standard (BUKAN Bahasa Indonesia: guna "kereta" bukan "mobil", "boleh" bukan "bisa", "percuma" bukan "gratis"). Santai, mesra ibu bapa Malaysia. Campuran sedikit English dibenarkan jika natural.
- JANGAN reka testimoni, ulasan, nama pelanggan, statistik atau angka jualan palsu. Jangan dakwa "1000 ibu bapa sudah beli" kecuali angka itu ada dalam data.
- JANGAN janji keputusan pasti ("dijamin boleh baca dalam 7 hari"). Guna bahasa realistik ("ramai anak mula lancar bila konsisten 10 minit sehari").
- JANGAN dakwa produk merawat/menyembuhkan autisme, disleksia atau apa-apa keadaan. Hanya "mesra" / "ada mod khas untuk".
- Kecemasan/had masa hanya jika benar (kupon sebenar dengan tarikh tamat sebenar).
- Tiada politik, isu agama sensitif, kandungan menakutkan, atau memalukan anak. Hormati privasi kanak-kanak: jangan minta ibu bapa kongsi gambar/nama penuh anak.
- Jangan spam. Nilai dahulu, jual kemudian (kira-kira 70% kandungan bernilai, 30% promosi).
"""

PRODUCT_BRIEF = """PRODUK: Jom Baca! Pro: aplikasi web (PWA) belajar membaca Bahasa Melayu untuk anak 4 hingga 8 tahun, suku kata demi suku kata.
Harga {price} sekali bayar, akses seumur hidup (harga minimum selepas diskaun {floor}). 3 tahap pertama percuma di {site}/app/
Ciri: {features}
Maskot: Momo, monyet comel coklat (telinga bulat, muka krim, pipi merah jambu).
Pautan jualan: gunakan placeholder {{LINK}} (sistem akan tukar kepada pautan jejak). Pautan cuba percuma: {site}/app/
"""


def now_myt():
    return dt.datetime.now(MYT)


def brief(st):
    p = st["product"]
    return PRODUCT_BRIEF.format(price=p["price"], floor=p["floor"], site=p["site"], features="; ".join(p["features"]))


def memory_block(st, agent):
    ls = st.get("learnings", [])
    owner = [l for l in ls if l.get("agent") == "azrin"]
    rest = [l for l in ls if l.get("agent") != "azrin"][:25]
    out = []
    if owner:
        out.append("ARAHAN PEMILIK (Azrin), keutamaan tertinggi:\n" + "\n".join(f"- {l['text']}" for l in owner))
    if rest:
        out.append("MEMORI / PELAJARAN TERBUKTI (id, skor):\n" + "\n".join(f"- [#{l['id']} s{l['score']}] {l['text']} (bukti: {l.get('evidence') or '-'})" for l in rest))
    plans = st.get("plans") or []
    today = now_myt().date().isoformat()
    plan = next((p for p in plans if p.get("day") == today), None)
    if plan:
        d = (plan.get("directives") or {}).get(agent)
        out.append(f"PELAN CEO HARI INI: fokus = {plan.get('focus', '-')}" + (f"\nARAHAN CEO UNTUK ANDA: {d}" if d else ""))
    if st.get("prompt_addendum"):
        out.append("PANDUAN YANG TELAH DIPELAJARI UNTUK PERANAN ANDA:\n" + st["prompt_addendum"])
    return "\n\n".join(out) or "(Belum ada memori. Ini permulaan, cuba pelbagai pendekatan dan ukur.)"


def compact(obj, n=6000):
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    return s if len(s) <= n else s[:n] + "…"


def system_for(role, st, agent):
    return f"""Anda ialah {role} dalam pasukan AI yang menjalankan perniagaan produk digital "Jom Baca!" di Malaysia.
OBJEKTIF UTAMA PASUKAN: tambah jualan SETIAP HARI secara beretika dan mampan.

{brief(st)}
{GUARDRAILS}
{memory_block(st, agent)}

Masa sekarang (MYT): {st['now_myt']}
Balas dengan SATU objek JSON sahaja, ikut skema yang diminta."""


def metrics_summary(st):
    m = st["metrics"]
    t, w = m["today"], m["last7"]
    rate = lambda a, b: f"{100 * a / b:.1f}%" if b else "-"
    return {
        "hari_ini": {k: t[k] for k in ("lp_view", "lead", "checkout", "sale", "rev")},
        "7_hari": {k: w[k] for k in ("lp_view", "cta_click", "lead", "checkout", "sale", "rev", "app:open", "app:paywall", "app:buy_click", "post_click", "ref_click", "email_click")},
        "kadar_7_hari": {"lawatan→lead": rate(w["lead"], w["lp_view"]), "lawatan→jualan": rate(w["sale"], w["lp_view"]), "checkout→jualan": rate(w["sale"], w["checkout"]), "paywall_app→klik_beli": rate(w["app:buy_click"], w["app:paywall"])},
        "harian_14": [{"d": x["day"][5:], "lawat": x["lp_view"], "lead": x["lead"], "jual": x["sale"]} for x in m["daily"]],
        "sasaran_jualan_sehari": st["settings"]["daily_sales_target"],
    }


# ---------------------------------------------------------------- bandit sudut
def attach_media(hq, st, rows):
    """Lukis gambar/video untuk post dan lampirkan media_url. IG tanpa media dibuang."""
    from . import media
    ok = media.available()
    host = re.sub(r"^https?://", "", str(st["product"].get("site") or "")).rstrip("/")
    nv = ni = 0
    out = []
    for r in rows:
        v = r.pop("_visual", None)
        pf = r["platform"]
        if isinstance(v, dict) and pf in ("tiktok", "reels") and v.get("type") != "none":
            v["type"] = "video"
        if pf == "instagram" and (not isinstance(v, dict) or v.get("type") not in ("image", "video")):
            v = {**(v if isinstance(v, dict) else {}), "type": "image"}
        spec = media.clean_spec(v, r.get("hook")) if ok else None
        if spec and spec["type"] == "video" and nv >= MAX_VIDEOS:
            spec["type"] = "image"
        if spec and spec["type"] == "image" and ni >= MAX_IMAGES:
            spec = None
        url = media.make(spec, host, hq) if spec else None
        if url:
            r["media_url"] = url
            nv += spec["type"] == "video"
            ni += spec["type"] == "image"
        if pf == "instagram" and not url:
            continue
        out.append(r)
    print(f"media: {nv} video, {ni} gambar")
    return out


def angle_mix(st, n_slots, explore=0.3):
    angles = [a for a in st["angles"] if a.get("status") == "active"]
    if not angles:
        return []
    picks = []
    for _ in range(n_slots):
        if random.random() < explore:
            picks.append("__explore__")
            continue
        best, bs = None, -1
        for a in angles:
            r = a.get("leads", 0) + 4 * a.get("sales", 0) + 0.1 * a.get("clicks", 0)
            s = random.betavariate(1 + r, 1 + max(0, a.get("posts", 0) - r) + 1)
            if s > bs:
                best, bs = a["name"], s
        picks.append(best)
    return picks


SLOTS = {  # (jam, minit) MYT
    "threads": [(8, 30), (12, 30), (15, 30), (20, 30), (21, 45)],
    "facebook": [(9, 0), (13, 0), (20, 0)],
    "telegram": [(19, 30)],
    "tiktok": [(12, 0), (20, 0)],
    "reels": [(20, 30)],
    "instagram": [(12, 15), (19, 45)],
}
MAX_VIDEOS, MAX_IMAGES = 3, 6


def plan_slots(st):
    integ = st["integrations"]
    maxd = st["settings"]["max_posts_day"]
    want = {"threads": 4 if integ.get("threads") else 2, "facebook": 2 if integ.get("facebook") else 1, "telegram": 1 if integ.get("tg_channel") else 0, "tiktok": 2, "reels": 1, "instagram": 2 if integ.get("instagram") else 0}
    n = now_myt()
    out = []
    for pf, k in want.items():
        times = SLOTS[pf][: min(k, maxd)]
        for h, mi in times:
            t = n.replace(hour=h, minute=mi, second=0, microsecond=0)
            if t < n + dt.timedelta(minutes=20):
                t += dt.timedelta(days=1)
            out.append((pf, t))
    out.sort(key=lambda x: x[1])
    return out


def ts(t):
    return int(t.timestamp() * 1000)


# ---------------------------------------------------------------- agen
def agent_ceo(hq, st):
    sys = system_for("CEO / Ketua Strategi", st, "ceo")
    user = f"""Tugas: semak prestasi dan tulis PELAN HARI INI untuk setiap agen, supaya jualan hari ini mencapai/melepasi sasaran.

METRIK: {compact(metrics_summary(st))}
SUDUT KANDUNGAN (prestasi): {compact(st['angles'], 2500)}
VARIAN LAMAN JUALAN: {compact([{k: v[k] for k in ('id', 'slot', 'views', 'leads', 'conv', 'p_best')} for v in st['variants']], 1500)}
TUGASAN MENUNGGU PEMILIK: {compact(st['todo'])}
INTEGRASI AKTIF: {compact(st['integrations'])}
LARIAN AGEN TERKINI (perhati ralat): {compact([{k: r[k] for k in ('agent', 'status', 'error')} for r in st['runs'][:12]], 1500)}
PROMO SEMASA: {compact(st['settings'].get('promo'))}
PELAN SEMALAM: {compact(st['plans'][:1], 1500)}

Agen yang ada: social (post harian), creative (video Google Flow), marketing (A/B laman jualan, promo kupon, emel), leads (mesej WhatsApp lead panas), affiliate (bahan & rekrut affiliate), product (pek cerita mingguan & cadangan produk), reflect (analisis malam).

Skema JSON:
{{"plan": {{"focus": "satu ayat fokus hari ini", "why": "berdasarkan data apa", "sales_target_today": nombor,
  "directives": {{"social": "...", "creative": "...", "marketing": "...", "leads": "...", "affiliate": "...", "product": "..."}},
  "owner_tasks": ["tugasan konkrit untuk Azrin hari ini, maks 4, paling berimpak dahulu"]}},
 "learnings": [{{"text": "pelajaran baharu jika data menunjukkan sesuatu yang jelas", "evidence": "angka"}}],
 "telegram": "ringkasan pagi untuk Azrin, maks 900 aksara, guna emoji ringkas, sebut angka semalam & 3 tugasan utama"}}"""
    out, model = ask_json(sys, user, "smart", 0.6)
    plan = out.get("plan") or {}
    hq.write("plan", "ceo", day=now_myt().date().isoformat(), plan=plan)
    if out.get("learnings"):
        hq.write("learnings", "ceo", rows=out["learnings"][:3])
    if out.get("telegram"):
        hq.write("notify", "ceo", text="☀️ " + out["telegram"] + f"\n{st['product']['site']}/admin")
    return f"Pelan: {plan.get('focus', '-')}", model


def agent_social(hq, st):
    slots = plan_slots(st)
    mix = angle_mix(st, len(slots))
    jobs = [{"slot": i, "platform": pf, "time": t.strftime("%a %H:%M"), "angle": a} for i, ((pf, t), a) in enumerate(zip(slots, mix))]
    top_posts = sorted([p for p in st["posts"] if p.get("status") == "posted"], key=lambda p: (p.get("sales", 0), p.get("leads", 0), p.get("clicks", 0)), reverse=True)
    sys = system_for("Pengurus Media Sosial & Copywriter", st, "social")
    user = f"""Tulis SATU post untuk setiap slot di bawah. Angle "__explore__" bermaksud cuba sudut BAHARU yang belum pernah diuji (cipta nama snake_case & huraian).

SLOT: {compact(jobs, 3000)}
SUDUT SEDIA ADA: {compact([{k: a[k] for k in ('name', 'description', 'posts', 'clicks', 'leads', 'sales')} for a in st['angles']], 2500)}
POST TERBAIK SEBELUM INI (tiru struktur yang berjaya, jangan salin): {compact(top_posts[:5], 2000)}
POST TERKINI (elak ulang hook yang sama): {compact([p['hook'] for p in st['posts'][:20]], 1500)}

Panduan platform:
- threads: ≤ 450 aksara. Hook baris pertama yang buat ibu bapa berhenti scroll. Separuh post letak {{LINK}} di hujung, separuh lagi tiada pautan (nilai/soalan untuk engagement).
- facebook: 400 hingga 900 aksara, cerita/tips + CTA dengan {{LINK}}.
- telegram: tips ringkas + {{LINK}}.
- instagram: kapsyen 300 hingga 800 aksara + 5 hingga 8 hashtag. JANGAN letak {{LINK}} (IG tak boleh klik pautan); tulis "pautan di bio". WAJIB ada visual.
- tiktok / reels: SKRIP VIDEO 20 hingga 40 saat untuk dirakam/diedit oleh Azrin (rakaman skrin app + suara latar, atau klip Flow). Format body:
  HOOK (0-3s): ...\\nBABAK: 1) ... 2) ... 3) ...\\nTEKS ATAS SKRIN: ...\\nSUARA LATAR: ...\\nKAPSYEN: ... #hashtag (5 hingga 8 hashtag Malaysia relevan)\\nCTA: "Link di bio"

Skema JSON:
{{"posts": [{{"slot": nombor, "angle": "nama_sudut", "hook": "baris pertama", "body": "teks penuh"}}],
 "new_angles": [{{"name": "snake_case", "description": "huraian ringkas"}}]}}

VISUAL (pilihan, letak dalam setiap post sebagai "visual"): sistem akan lukis gambar/video berjenama secara automatik.
{{"type": "image" atau "video" atau "none", "headline": "ayat besar pada gambar, maksimum 70 aksara, Bahasa Melayu baku, boleh sama dengan hook", "sub": "ayat kecil pilihan, maksimum 100 aksara", "tiles": ["suku","kata"], "word": "sukukata"}}
- tiles = perkataan ringkas yang dipecah ikut suku kata BETUL, huruf kecil (cth ["bo","la"] → "bola", ["ku","cing"] → "kucing", ["ma","ta"] → "mata"). Gabungan tiles MESTI sama dengan word. Jika tak pasti, beri [] dan "".
- Panduan: instagram WAJIB image/video; threads & facebook kira-kira separuh guna image; tiktok/reels guna video; maksimum 3 video sehari."""
    out, model = ask_json(sys, user, "smart", 0.9)
    by = {j["slot"]: j for j in jobs}
    rows = []
    for p in out.get("posts", []):
        j = by.get(p.get("slot"))
        if not j or not p.get("body"):
            continue
        pf, t = slots[j["slot"]]
        body = p["body"].strip()
        if pf == "threads" and len(body) > 490:
            body = body[:470].rsplit(" ", 1)[0] + (" {LINK}" if "{LINK}" in body else "")
        if pf == "instagram":
            body = body.replace("{LINK}", "pautan di bio")
        rows.append({"platform": pf, "angle": re.sub(r"[^a-z0-9_]", "", (p.get("angle") or j["angle"] or "umum").lower())[:40] or "umum", "hook": p.get("hook", "")[:200], "body": body, "scheduled_at": ts(t), "_visual": p.get("visual")})
    rows = attach_media(hq, st, rows)
    if out.get("new_angles"):
        hq.write("angles", "social", rows=out["new_angles"][:3])
    r = hq.write("posts", "social", rows=rows)
    return f"{len(rows)} post dijadualkan ({r.get('inserted', '?')} diterima)", model


def agent_creative(hq, st):
    fb = st["flow"]
    total_left = sum(b["videos_left"] for b in fb["budget"])
    n = max(0, min(5, total_left // max(1, fb["days_left_in_month"])))
    queued = len([q for q in fb["queue"] if q["status"] == "queued"])
    n = max(0, n - queued // 2)
    if n == 0:
        return f"Tiada video baharu (baki {total_left} video, {queued} dalam giliran)", "-"
    winners = sorted(st["angles"], key=lambda a: (a.get("sales", 0), a.get("leads", 0), a.get("clicks", 0)), reverse=True)[:4]
    sys = system_for("Pengarah Kreatif Video (Google Flow / Veo)", st, "creative")
    user = f"""Cipta {n} konsep video pendek untuk dijana di Google Flow (Veo). Setiap klip Veo ≈ 8 saat; satu konsep = satu klip yang kuat sebagai hook, Azrin akan sambung dengan rakaman skrin app di CapCut.

SUDUT BERPRESTASI: {compact(winners, 1500)}
Bajet: {compact(fb['budget'])}

Peraturan kreatif:
- JANGAN jana kanak-kanak manusia realistik. Guna watak 3D animasi: Momo si monyet (maskot), haiwan comel, objek bercakap, atau tangan dewasa memegang telefon.
- Gaya: animasi 3D ala filem kartun, warna cerah pastel, pencahayaan lembut. 9:16 menegak.
- Dialog dalam Bahasa Malaysia, pendek, jelas (Veo boleh jana suara). Contoh: Momo menyebut "bo… la… BOLA!" dan bola melantun.
- Teks atas skrin JANGAN diharap dijana Veo (selalu salah eja). Letak dalam "overlay_text" untuk ditambah di CapCut.
- Hook visual dalam 1 saat pertama.

Skema JSON:
{{"videos": [{{"title": "tajuk ringkas", "angle": "nama_sudut",
  "prompt": {{"aspect_ratio": "9:16", "duration_sec": 8, "style": "...", "characters": [{{"name": "...", "look": "..."}}], "setting": "...", "action": "babak demi babak dalam 8 saat", "camera": "...", "lighting": "...", "dialogue": [{{"speaker": "...", "line_ms": "..."}}], "audio": "muzik/kesan bunyi", "negative": "realistic children, text, watermark, logo"}},
  "overlay_text": ["teks 1", "teks 2"],
  "caption": "kapsyen post dengan hook + CTA + {{LINK}} + hashtag",
  "platforms": ["tiktok", "reels", "threads"]}}]}}"""
    out, model = ask_json(sys, user, "smart", 0.9)
    rows = []
    for v in out.get("videos", [])[:n]:
        pr = v.get("prompt") or {}
        if v.get("overlay_text"):
            pr["overlay_text_for_editor"] = v["overlay_text"]
        rows.append({"title": v.get("title", "Video"), "angle": v.get("angle", ""), "prompt": pr, "caption": v.get("caption", ""), "platforms": [p for p in v.get("platforms", ["tiktok", "reels"]) if p in ("tiktok", "reels", "shorts", "threads", "facebook", "telegram", "instagram")]})
    r = hq.write("flow", "creative", rows=rows)
    return f"{r.get('inserted', len(rows))} kerja video Flow dalam giliran", model


def agent_leads(hq, st):
    hot = [l for l in st["leads"]["hot"] if not l.get("contacted")][:20]
    if not hot:
        return "Tiada lead panas", "-"
    site = st["product"]["site"]
    sys = system_for("Pegawai Hubungan Pelanggan (WhatsApp)", st, "leads")
    user = f"""Untuk setiap lead, beri skor kebarangkalian beli (0 hingga 100) dan tulis mesej WhatsApp PERIBADI yang Azrin akan hantar sendiri.

LEAD: {compact(hot, 5000)}
(stage 'checkout' = sudah isi borang bayar tetapi belum bayar. Paling panas.)

Panduan mesej:
- Maks 350 aksara. Mesra, macam manusia, bukan robot. Sebut nama jika ada. Sebut umur anak jika ada.
- Tujuan: bantu, jawab keraguan, ajak cuba percuma ({site}/app/) atau sambung beli ({site}/?src=wa#beli).
- Untuk 'checkout': tanya jika ada masalah semasa bayar (FPX/kad) dan tawar bantuan.
- Satu mesej sahaja, tiada tekanan, tiada janji palsu.

Skema JSON: {{"leads": [{{"id": nombor, "score": nombor, "wa_msg": "...", "notes": "sebab skor, ringkas"}}]}}"""
    out, model = ask_json(sys, user, "fast", 0.7)
    rows = [{"id": l["id"], "score": max(0, min(100, int(l.get("score", 50)))), "wa_msg": l.get("wa_msg", "")[:700], "notes": l.get("notes", "")[:300]} for l in out.get("leads", []) if l.get("id")]
    hq.write("leads", "leads", rows=rows)
    return f"{len(rows)} lead diskor & mesej WhatsApp disediakan", model


def agent_marketing(hq, st):
    # Pengawal deterministik: bersarakan varian kalah yang cukup data
    by_slot = {}
    for v in st["variants"]:
        by_slot.setdefault(v["slot"], []).append(v)
    retire = [v["id"] for vs in by_slot.values() if len(vs) > 2 for v in vs if v["views"] >= 150 and v["p_best"] < 0.05]
    need = {s: max(0, 3 - (len(vs) - len([v for v in vs if v["id"] in retire]))) for s, vs in by_slot.items()}
    for s in ("headline", "sub", "cta"):
        need.setdefault(s, 3)
    n = now_myt()
    promo = st["settings"].get("promo") or {}
    promo_recent = promo and promo.get("until", 0) > (n.timestamp() - 4 * 86400) * 1000
    m = metrics_summary(st)
    weekly = n.weekday() == 6
    sys = system_for("Pengurus Pemasaran & Pakar Conversion", st, "marketing")
    user = f"""Tugas hari ini:
A) Tulis varian pencabar baharu untuk laman jualan (A/B Thompson sampling) bagi slot yang perlukan: {compact(need)}.
B) Putuskan sama ada buat PROMO kupon hari ini. {"Promo baru sahaja dibuat dalam 4 hari lepas, JANGAN buat promo." if promo_recent else "Boleh buat jika data menyokong."}
{"C) Hari Ahad: tulis semula 5 template emel nurture berdasarkan statistik klik." if weekly else ""}

VARIAN SEMASA (p_best = kebarangkalian terbaik): {compact(st['variants'], 3000)}
METRIK: {compact(m)}
TARIKH: {n.strftime('%A %d %B %Y')} (gaji biasanya 25 hingga 28 hb; cuti sekolah, Hari Guru, Merdeka, cuti umum = peluang promo)
STATISTIK EMEL 30 HARI: {compact(st.get('email_stats', []), 1200)}
{"TEMPLATE NURTURE SEMASA: " + compact(st['nurture_tpl'], 5000) if weekly else ""}

Panduan varian: headline ≤ 110 aksara; sub ≤ 300 aksara; cta ≤ 40 aksara. Uji idea yang BERBEZA (kesakitan, impian, bukti, harga, keperluan khas), bukan sekadar tukar perkataan.
Panduan promo: diskaun 10% hingga 25% atau RM2 hingga RM5, tempoh 24 hingga 72 jam, ada sebab sebenar (cth: "Promo Gaji"). Harga tidak boleh bawah {st['product']['floor']}.

Skema JSON:
{{"variants": [{{"slot": "headline|sub|cta", "text": "..."}}],
 "promo": {{"create": true/false, "code": "HURUFBESAR", "pct": nombor atau null, "off_sen": nombor atau null, "hours": nombor, "label": "teks banner", "reason": "..."}},
 "nurture_tpl": [{{"d": hari_selepas_daftar, "s": "subjek", "b": "html ringkas guna {{name}} {{child}} {{app}} {{buy}} {{magnet}} {{price}} {{coupon}} {{buy_coupon}}"}}] atau null,
 "notes": "ringkasan keputusan"}}"""
    out, model = ask_json(sys, user, "smart", 0.85)
    rows = [v for v in out.get("variants", []) if v.get("slot") in need and need[v["slot"]] > 0][:6]
    if rows or retire:
        hq.write("variants", "marketing", rows=rows, retire=retire)
    summary = [f"{len(rows)} varian baharu, {len(retire)} dibersarakan"]
    pr = out.get("promo") or {}
    if pr.get("create") and not promo_recent and pr.get("code"):
        r = hq.write("coupon", "marketing", code=pr["code"], pct=pr.get("pct") or 0, off=pr.get("off_sen") or 0, hours=pr.get("hours") or 48, label=pr.get("label", ""), promo=True, note=pr.get("reason", ""))
        summary.append(f"promo {pr['code']}: {r}")
    tpl = out.get("nurture_tpl")
    if weekly and isinstance(tpl, list) and len(tpl) >= 5 and all(isinstance(t, dict) and t.get("s") and t.get("b") for t in tpl[:5]):
        tpl = [{"d": int(t.get("d", i)), "s": t["s"][:150], "b": t["b"][:4000]} for i, t in enumerate(tpl[:5])]
        hq.write("settings", "marketing", set={"nurture_tpl": tpl})
        summary.append("template nurture dikemas kini")
    return "; ".join(summary) + ". " + (out.get("notes") or "")[:300], model


def agent_affiliate(hq, st):
    sys = system_for("Pengurus Program Affiliate", st, "affiliate")
    user = f"""Tugas mingguan:
1) Tulis 5 bahan promosi siap-guna (swipe) untuk affiliate: 2 WhatsApp status/mesej, 1 Threads, 1 Facebook, 1 skrip TikTok ringkas. Guna {{LINK}} untuk pautan affiliate mereka.
2) Tulis emel mingguan kepada semua affiliate: tips + bahan baharu + motivasi. Guna {{name}}, {{link}}, {{dash}}.
3) Cadangkan 3 cara merekrut affiliate baharu (profil sasaran seperti cikgu tadika, guru pemulihan, ibu influencer kecil, kumpulan FB ibu bapa) berserta templat DM yang sopan untuk Azrin hantar sendiri.

AFFILIATE TERATAS: {compact(st['affiliates'], 1500)}
SUDUT YANG MENANG: {compact(sorted(st['angles'], key=lambda a: (a.get('sales', 0), a.get('leads', 0)), reverse=True)[:5], 1200)}
Komisen: {st['product']['aff_rate_pct']}% setiap jualan {st['product']['price']}.

Skema JSON:
{{"swipe": [{{"platform": "...", "text": "..."}}],
 "broadcast": {{"subject": "...", "html": "<p>...</p>"}},
 "recruit": [{{"title": "...", "body": "siapa, di mana cari, templat DM"}}]}}"""
    out, model = ask_json(sys, user, "smart", 0.8)
    sw = [s for s in out.get("swipe", []) if s.get("text")][:6]
    if sw:
        hq.write("settings", "affiliate", set={"aff_swipe": sw})
    b = out.get("broadcast") or {}
    q = 0
    if b.get("subject") and b.get("html") and st["affiliates"]:
        q = hq.write("aff_broadcast", "affiliate", subject=b["subject"], html=b["html"]).get("queued", 0)
    rec = [{"kind": "recruit", "title": r.get("title", "Rekrut affiliate")[:150], "body": r.get("body", "")} for r in out.get("recruit", [])[:3]]
    if rec:
        hq.write("proposals", "affiliate", rows=rec)
    return f"{len(sw)} swipe, emel ke {q} affiliate, {len(rec)} idea rekrut", model


ITEM_RE = re.compile(r"^([a-z][a-z .,']*[a-z.])\s*([^\x00-\x7f].*)$")


def agent_product(hq, st):
    hard = st["app"]["hardest_items"][:12]
    existing = [p["title"] for p in st["packs"]]
    sys = system_for("Pengurus Produk & Penulis Kurikulum Bacaan Kanak-kanak", st, "product")
    user = f"""Tugas mingguan:
1) Tulis PEK CERITA BAHARU (6 hingga 8 item) untuk bahagian "Pek Cerita Baharu" dalam app.
   Format SETIAP item (sama seperti kurikulum sedia ada): huruf kecil sahaja, 2 atau 3 ayat sangat pendek dipisah titik, perkataan 2 hingga 3 suku kata yang biasa, kemudian SATU emoji di hujung tanpa ruang.
   Contoh: "ini kucing saya. nama dia comel🐱", "ali ada bola. dia bermain di padang⚽"
   Tema: kehidupan harian kanak-kanak Malaysia (pasar malam, hari raya, sekolah, taman, pantai, kampung). Elak tema yang sudah ada: {existing}
   Masukkan perkataan yang anak masih lemah jika sesuai: {[h['item'] for h in hard]}
2) Analisis data penggunaan app dan funnel, cadang 1 hingga 3 penambahbaikan produk yang paling mungkin TAMBAH JUALAN (cth: paywall, onboarding, tahap yang anak tersangkut).

TELEMETRI APP 7 HARI: {compact(st['app']['events_7d'], 2500)}
ITEM PALING SUKAR (ok_rate rendah): {compact(hard, 1200)}
METRIK: {compact(metrics_summary(st)['7_hari'])}

Skema JSON:
{{"pack": {{"title": "≤ 24 aksara", "en": "English title", "icon": "emoji", "items": ["..."]}},
 "proposals": [{{"title": "...", "body": "masalah (dengan angka), cadangan, cara ukur kejayaan"}}]}}"""
    out, model = ask_json(sys, user, "smart", 0.8)
    msg = []
    pk = out.get("pack") or {}
    items = [i.strip().lower() for i in pk.get("items", []) if isinstance(i, str)]
    items = [i for i in items if ITEM_RE.match(i) and len(i) <= 100][:8]
    if len(items) >= 4 and pk.get("title"):
        review, _ = ask_json("Anda penyemak kandungan kanak-kanak & ejaan Bahasa Malaysia yang teliti. Balas JSON sahaja.",
                             f"""Semak pek bacaan untuk kanak-kanak 4 hingga 8 tahun di Malaysia.
ITEM: {json.dumps(items, ensure_ascii=False)}
Semak: (1) sesuai & selamat untuk kanak-kanak, (2) ejaan Bahasa Malaysia betul (bukan Indonesia), (3) ayat ringkas & mudah dibaca, (4) emoji sesuai.
Skema: {{"safe": true/false, "fixed_items": ["senarai item yang dibetulkan, format sama"], "issues": ["..."]}}""", "fast", 0.2)
        fixed = [i.strip().lower() for i in (review.get("fixed_items") or items) if isinstance(i, str) and ITEM_RE.match(i.strip().lower())]
        if len(fixed) >= 4:
            items = fixed[:8]
        r = hq.write("pack", "product", title=pk["title"][:40], en=pk.get("en", "")[:40], icon=pk.get("icon", "✨")[:8], items=items, safe=bool(review.get("safe")), note="; ".join(review.get("issues", []))[:400])
        msg.append(f"pek '{pk['title']}' ({'live' if review.get('safe') else 'perlu semakan'}): {r.get('id', r)}")
    props = [{"kind": "feature", "title": p.get("title", "")[:150], "body": p.get("body", "")} for p in out.get("proposals", [])[:3] if p.get("title")]
    if props:
        hq.write("proposals", "product", rows=props)
        msg.append(f"{len(props)} cadangan produk")
        gh_issue(props)
    return "; ".join(msg) or "tiada output", model


def gh_issue(props):
    """Jika GITHUB_TOKEN & GITHUB_REPO ditetapkan, cadangan produk juga dibuka sebagai GitHub Issue."""
    tok, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPO")
    if not tok or not repo or os.environ.get("BRAIN_DRY") == "1":
        return
    for p in props:
        try:
            req = urllib.request.Request(f"https://api.github.com/repos/{repo}/issues", method="POST",
                                         data=json.dumps({"title": "[Agen Produk] " + p["title"], "body": p["body"] + "\n\n_Dicadang automatik oleh agen Produk Jom Baca._", "labels": ["agen-produk"]}).encode(),
                                         headers={"authorization": "Bearer " + tok, "accept": "application/vnd.github+json", "user-agent": "jombaca-brain"})
            urllib.request.urlopen(req, timeout=30).read()
        except Exception as e:  # noqa: BLE001
            print("github issue gagal:", e)


def agent_reflect(hq, st):
    posted = [p for p in st["posts"] if p.get("status") == "posted"]
    top = sorted(posted, key=lambda p: (p.get("sales", 0), p.get("leads", 0), p.get("clicks", 0)), reverse=True)[:6]
    bottom = sorted(posted, key=lambda p: (p.get("clicks", 0), p.get("leads", 0)))[:6]
    sys = system_for("Penganalisis Data & Jurulatih Pasukan (self-improvement)", st, "reflect")
    user = f"""Tugas malam: belajar daripada data hari ini supaya esok pasukan lebih baik menjana jualan.

METRIK: {compact(metrics_summary(st))}
SUDUT: {compact(st['angles'], 2500)}
POST TERBAIK: {compact(top, 2500)}
POST TERLEMAH: {compact(bottom, 1500)}
VARIAN: {compact(st['variants'], 2000)}
STATISTIK EMEL: {compact(st.get('email_stats', []), 800)}
LARIAN AGEN (ralat?): {compact([{k: r[k] for k in ('agent', 'status', 'summary', 'error')} for r in st['runs'][:16]], 2500)}
MEMORI SEDIA ADA (dengan id): {compact(st['learnings'], 4000)}

Peraturan:
- Pelajaran baharu MESTI ada bukti angka. Jika data terlalu sedikit (cth < 30 klik), tulis hipotesis untuk diuji, skor rendah (0.5).
- Bersarakan pelajaran yang bercanggah dengan data baharu. Naikkan skor (maks 5) yang terbukti berulang kali. Jangan bersarakan arahan pemilik (agent=azrin).
- Kemas kini panduan prompt (≤ 900 aksara) untuk agen social, marketing atau creative HANYA jika ada bukti jelas; panduan baharu menggantikan yang lama, jadi masukkan semua perkara penting.
- Jeda sudut kandungan yang ≥ 6 post tetapi 0 lead.

Skema JSON:
{{"new_learnings": [{{"text": "...", "evidence": "...", "score": 0.5 hingga 3}}],
 "retire_ids": [id],
 "rescore": [{{"id": id, "score": nombor}}],
 "prompt_updates": [{{"target": "social|marketing|creative", "addendum": "...", "reason": "..."}}],
 "angles": [{{"name": "...", "status": "paused|active"}}],
 "summary": "3 ayat: apa berlaku hari ini, kenapa, apa ubah esok"}}"""
    out, model = ask_json(sys, user, "smart", 0.4)
    owner_ids = {l["id"] for l in st["learnings"] if l.get("agent") == "azrin"}
    hq.write("learnings", "reflect", rows=out.get("new_learnings", [])[:5], retire=[i for i in out.get("retire_ids", []) if i not in owner_ids][:10], rescore=out.get("rescore", [])[:10])
    for u in out.get("prompt_updates", [])[:2]:
        if u.get("target") in ("social", "marketing", "creative") and u.get("addendum"):
            hq.write("prompt", "reflect", target=u["target"], addendum=u["addendum"][:1500], reason=u.get("reason", ""))
    ang = [a for a in out.get("angles", []) if a.get("name")]
    if ang:
        hq.write("angles", "reflect", rows=[{"name": a["name"], "description": "", "status": a.get("status", "active")} for a in ang[:5]])
    return (out.get("summary") or "")[:600], model


AGENTS = {
    "ceo": agent_ceo,
    "social": agent_social,
    "creative": agent_creative,
    "marketing": agent_marketing,
    "leads": agent_leads,
    "affiliate": agent_affiliate,
    "product": agent_product,
    "reflect": agent_reflect,
}

# Jadual (waktu Malaysia). weekdays: 0=Isnin … 6=Ahad, None = setiap hari
SCHEDULE = {
    "ceo": ([6], None),
    "social": ([7], None),
    "creative": ([8], None),
    "marketing": ([9], None),
    "leads": ([10, 19], None),
    "affiliate": ([11], [0]),
    "product": ([14], [2]),
    "reflect": ([23], None),
}
