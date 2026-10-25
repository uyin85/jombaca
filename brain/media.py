"""Penjana media Jom Baca: kad gambar (1080x1350) dan video hook (1080x1920, 9:16).

Cara: templat HTML berjenama (kotak suku kata berwarna seperti dalam app) dirakam oleh Chromium
(Playwright). Video dirakam frame demi frame dan dicantum dengan ffmpeg, beserta muzik latar
kanak-kanak dan kesan bunyi yang disintesis sendiri (brain/sound.py). Tiada AI imej, jadi ejaan
sentiasa tepat. Kos RM0.

Kepelbagaian: beberapa templat gambar & video (agen pilih ikut prestasi), latar, bentuk kotak,
palet warna dan muzik dirawak setiap kali, supaya penonton tak bosan.

Jika Playwright/ffmpeg tiada, available() pulang False dan agen post teks sahaja.
"""
import html
import json
import os
import random
import re
import shutil
import subprocess
import tempfile

W_IMG, H_IMG = 1080, 1350
W_VID, H_VID = 1080, 1920
FPS = 30
LAST = {"audio": ""}  # status bunyi larian terakhir (untuk laporan)
FONT_DIRS = [os.environ.get("JB_FONTS", ""), os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")]

# Templat yang agen boleh pilih. Medan: headline (semua), sub, tiles+word, emoji, points[3], before/after, words[3-4] ("bo-la").
IMAGE_TEMPLATES = {
    "soalan": "Soalan besar yang menyentuh ibu bapa + contoh suku kata. Medan: headline, sub, tiles, word",
    "tips": "3 tips ringkas bernombor. Medan: headline, points (3 ayat pendek ≤ 45 aksara)",
    "teka": "Teka perkataan: emoji besar + suku kata pertama, selebihnya '?'. Medan: headline, emoji, tiles, word",
    "banding": "Sebelum vs Selepas. Medan: headline, before (≤ 60 aksara), after (≤ 60 aksara)",
    "cabaran": "Cabaran baca: 3-4 perkataan dipecah suku kata. Medan: headline, words (cth ['bo-la','ku-cing','ma-ta'])",
}
VIDEO_TEMPLATES = {
    "bina": "Suku kata muncul satu-satu lalu bercantum jadi perkataan. Medan: headline, sub, tiles, word",
    "teka": "Emoji muncul, kiraan 3-2-1, jawapan didedahkan. Medan: headline, emoji, tiles, word",
    "tips": "3 tips muncul satu per satu. Medan: headline, points (3 ayat ≤ 45 aksara)",
    "pantas": "Cabaran baca pantas: perkataan muncul satu-satu dengan pemasa. Medan: headline, words (3-4, cth ['bo-la','ku-cing'])",
}

THEMES = [  # (latar atas, latar bawah, warna sorotan)
    ("#e4f3ff", "#bfe3ff", "#2f7df6"),
    ("#fff4d6", "#ffe39a", "#e08a00"),
    ("#e3f8ee", "#bdeed6", "#12955a"),
    ("#ffe9ee", "#ffc9d4", "#d9344f"),
    ("#efe8ff", "#d8c8ff", "#7a3ff2"),
    ("#e6fbff", "#b8eef7", "#0b8fa8"),
]
TILE_COLS = ["#ef3f5c", "#2f7df6", "#17b26a", "#f5a000", "#8a4dff"]
PATTERNS = ["dots", "grid", "confetti", "waves", "plain"]
RADII = ["22%", "50%", "12%", "30% 30% 30% 8%"]


def _font(name):
    for d in FONT_DIRS:
        if d and os.path.exists(os.path.join(d, name)):
            return "file://" + os.path.join(d, name)
    return None


def available():
    if not shutil.which("ffmpeg"):
        return False
    try:
        import playwright.sync_api  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return True


def _fontface():
    out = []
    for fam, f, w in [("JBDisplay", "Fredoka-600.woff2", "300 700"), ("JBBody", "Atkinson-400.woff2", "400"), ("JBBody", "Atkinson-700.woff2", "700")]:
        u = _font(f)
        if u:
            out.append(f"@font-face{{font-family:{fam};src:url('{u}');font-weight:{w};}}")
    return "\n".join(out)


# ---------------------------------------------------------------- pengesahan
def _txt(v, n):
    return re.sub(r"\s+", " ", str(v or "")).strip()[:n]


def _syl(word):
    """'ku-cing' → ['ku','cing'] jika sah, else None."""
    parts = [p for p in re.sub(r"[^a-z\-]", "", str(word).lower()).split("-") if p]
    return parts if parts and all(1 <= len(p) <= 4 for p in parts) and len(parts) <= 4 else None


def clean_spec(v, fallback_hook=""):
    """Sahkan spesifikasi visual daripada LLM. Pulang dict atau None. Templat yang tak lengkap jatuh ke asas."""
    if not isinstance(v, dict):
        return None
    kind = str(v.get("type", "")).lower()
    if kind not in ("image", "video"):
        return None
    headline = _txt(v.get("headline") or fallback_hook, 90)
    if not headline:
        return None
    tiles = [re.sub(r"[^a-z]", "", str(t).lower()) for t in (v.get("tiles") or [])][:4]
    tiles = [t for t in tiles if 1 <= len(t) <= 4]
    word = re.sub(r"[^a-z]", "", str(v.get("word") or "").lower())
    if not tiles or "".join(tiles) != word:
        tiles, word = [], ""
    points = [_txt(p, 60) for p in (v.get("points") or []) if _txt(p, 60)][:3]
    words = [w for w in (_syl(x) for x in (v.get("words") or [])) if w][:4]
    emoji = _txt(v.get("emoji"), 8)
    spec = {"type": kind, "headline": headline, "sub": _txt(v.get("sub"), 110), "tiles": tiles, "word": word,
            "emoji": emoji, "points": points, "words": words, "before": _txt(v.get("before"), 70), "after": _txt(v.get("after"), 70)}
    t = str(v.get("template") or "").lower()
    ok = {
        "soalan": True, "bina": True,
        "tips": len(points) == 3,
        "teka": bool(emoji and tiles),
        "banding": bool(spec["before"] and spec["after"]),
        "cabaran": len(words) >= 3, "pantas": len(words) >= 3,
    }
    valid = IMAGE_TEMPLATES if kind == "image" else VIDEO_TEMPLATES
    if t not in valid or not ok.get(t):
        t = "soalan" if kind == "image" else "bina"
    spec["template"] = t
    return spec


# ---------------------------------------------------------------- gaya
def _style(rng):
    a, b, acc = rng.choice(THEMES)
    return {"a": a, "b": b, "acc": acc, "pattern": rng.choice(PATTERNS), "radius": rng.choice(RADII), "tilt": rng.choice([0, -2, 2])}


def _bg_css(st):
    a, b, acc, p = st["a"], st["b"], st["acc"], st["pattern"]
    base = f"linear-gradient(170deg,{a} 0%,#ffffff 48%,{b} 100%)"
    over = {
        "dots": f"radial-gradient(circle,{acc}22 6px,transparent 7px) 0 0/64px 64px,",
        "grid": f"linear-gradient({acc}14 2px,transparent 2px) 0 0/72px 72px,linear-gradient(90deg,{acc}14 2px,transparent 2px) 0 0/72px 72px,",
        "waves": f"radial-gradient(120% 60px at 50% 0,transparent 58px,{acc}18 60px,transparent 64px) 0 0/180px 120px,",
        "confetti": "", "plain": "",
    }[p]
    return f"background:{over}{base};"


def _confetti(st, rng, w, h, n=14):
    if st["pattern"] != "confetti":
        return ""
    out = []
    for _ in range(n):
        s = rng.randint(26, 64)
        out.append(f'<i style="position:absolute;left:{rng.randint(0, w - s)}px;top:{rng.randint(0, h - s)}px;width:{s}px;height:{s}px;border-radius:{rng.choice(["30%", "50%", "8px"])};background:{rng.choice(TILE_COLS)};opacity:.16;transform:rotate({rng.randint(-30, 30)}deg)"></i>')
    return "".join(out)


def _tile(t, size, i, st, extra=""):
    fs = int(size * (0.56 if len(t) <= 2 else 0.44 if len(t) == 3 else 0.36))
    return f'<span class="tile" {extra} style="background:{TILE_COLS[i % len(TILE_COLS)]};width:{size}px;height:{size}px;font-size:{fs}px;border-radius:{st["radius"]}">{html.escape(t)}</span>'


def _tiles(tiles, size, st, plus=True, at=None, step=0.35):
    out = []
    for i, t in enumerate(tiles):
        a = f'data-at="{at + i * step:.2f}" data-anim="pop"' if at is not None else ""
        out.append(_tile(t, size, i, st, a))
        if plus and i < len(tiles) - 1:
            out.append(f'<span class="op" {a}>+</span>')
    return "".join(out)


def _word(tiles, extra=""):
    return f'<div class="word" {extra}>' + "".join(f'<span style="color:{TILE_COLS[i % len(TILE_COLS)]}">{html.escape(t)}</span>' for i, t in enumerate(tiles)) + "</div>"


def _brand():
    return '<div class="brand">Jom <span class="tile b" style="background:#ef3f5c">Ba</span><span class="tile b" style="background:#2f7df6">ca</span><span style="color:#17b26a">!</span></div>'


BASE_CSS = """
*{box-sizing:border-box;margin:0}
body{font-family:JBBody,'Atkinson Hyperlegible',system-ui,sans-serif;color:#2b2350;position:relative;overflow:hidden}
.tile{display:inline-flex;align-items:center;justify-content:center;color:#fff;font-family:JBDisplay,system-ui,sans-serif;font-weight:600;box-shadow:inset 0 -0.07em 0 rgba(0,0,0,.18),0 6px 0 rgba(43,35,80,.10)}
.op{font:600 64px/1 JBDisplay,system-ui;color:#5d5780;margin:0 14px}
.brand{display:flex;align-items:center;gap:12px;font:600 54px/1 JBDisplay,system-ui}
.brand .tile.b{width:66px;height:66px;font-size:36px;border-radius:22%}
.url{font:700 34px/1 JBBody,system-ui;background:#fff;border-radius:999px;padding:16px 30px;box-shadow:0 3px 0 rgba(43,35,80,.08)}
.row{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:10px}
.word{font:600 120px/1 JBDisplay,system-ui;letter-spacing:3px;text-align:center}
.card{background:#fff;border-radius:34px;padding:34px 38px;box-shadow:0 8px 0 rgba(43,35,80,.07)}
.pt{display:grid;grid-template-columns:96px 1fr;gap:26px;align-items:center;font-size:inherit;line-height:1.25}
.card{font-size:44px}
.pt .tile{width:96px;height:96px;font-size:54px}
.emo{font-size:260px;line-height:1;text-align:center}
.lbl{font:600 40px/1 JBDisplay,system-ui;margin-bottom:16px}
"""


def _hsize(h, big):
    n = len(h)
    return big if n <= 40 else int(big * 0.84) if n <= 65 else int(big * 0.72)


# ---------------------------------------------------------------- gambar
def _image_main(spec, st):
    t = spec["template"]
    if t == "tips":
        return '<div class="card" style="display:grid;gap:30px">' + "".join(
            f'<div class="pt">{_tile(str(i + 1), 96, i, st)}<span>{html.escape(p)}</span></div>' for i, p in enumerate(spec["points"])) + "</div>"
    if t == "teka":
        shown = [spec["tiles"][0]] + ["?"] * (len(spec["tiles"]) - 1)
        return f'<div style="display:grid;gap:30px;justify-items:center"><div class="emo">{html.escape(spec["emoji"])}</div><div class="row">{_tiles(shown, 170, st, plus=False)}</div><div style="font:600 40px JBDisplay,system-ui;color:#5d5780">Jawapan dalam kapsyen 👇</div></div>'
    if t == "banding":
        return (f'<div style="display:grid;gap:22px"><div class="card"><div class="lbl" style="color:#d9344f">😟 Sebelum</div><div style="font-size:44px;line-height:1.3">{html.escape(spec["before"])}</div></div>'
                f'<div style="text-align:center;font:600 70px/1 JBDisplay;color:{st["acc"]}">⬇</div>'
                f'<div class="card"><div class="lbl" style="color:#12955a">😊 Selepas</div><div style="font-size:44px;line-height:1.3">{html.escape(spec["after"])}</div></div></div>')
    if t == "cabaran":
        return '<div style="display:grid;gap:28px;justify-items:center">' + "".join(
            f'<div class="row">{_tiles(w, 118, st, plus=False)}</div>' for w in spec["words"]) + \
            '<div style="font:600 42px JBDisplay,system-ui;color:#5d5780">⏱️ Berapa saat anak anda ambil?</div></div>'
    if spec["tiles"]:
        return f'<div style="display:grid;gap:18px;justify-items:center"><div class="row">{_tiles(spec["tiles"], 190, st)}</div>{_word(spec["tiles"])}</div>'
    return ""


def image_html(spec, site_host, rng=None):
    rng = rng or random.Random()
    st = _style(rng)
    sub = f'<p style="font-size:38px;line-height:1.35;color:#5d5780;margin-top:24px">{html.escape(spec["sub"])}</p>' if spec["sub"] and spec["template"] == "soalan" else ""
    big = 92 if spec["template"] in ("soalan",) else 74
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{_fontface()}{BASE_CSS}
html,body{{width:{W_IMG}px;height:{H_IMG}px}}
body{{{_bg_css(st)}display:flex;flex-direction:column;justify-content:space-between;padding:80px 76px 76px}}
h1{{font:600 {_hsize(spec["headline"], big)}px/1.08 JBDisplay,system-ui;letter-spacing:-.5px;margin-top:48px;transform:rotate({st["tilt"] / 4}deg)}}
</style></head><body>{_confetti(st, rng, W_IMG, H_IMG)}
<div style="position:relative">{_brand()}<h1>{html.escape(spec["headline"])}</h1>{sub}</div>
<div style="position:relative">{_image_main(spec, st)}</div>
<div style="position:relative;display:flex;justify-content:space-between;align-items:center"><span class="url">{html.escape(site_host)}</span><span style="font:600 34px JBDisplay,system-ui;color:#5d5780">⭐⭐⭐</span></div>
</body></html>"""


# ---------------------------------------------------------------- video
def _video_stage(spec, st, t0):
    """Pulang (html_tengah, peristiwa_bunyi, masa_tamat_demo). t0 = bila demo bermula."""
    t = spec["template"]
    ev = []
    if t == "teka":
        tiles = spec["tiles"]
        ev.append((t0, "whoosh"))
        h = f'<div class="emo" style="font-size:330px" data-at="{t0:.2f}" data-anim="zoom">{html.escape(spec["emoji"])}</div>'
        cd = ""
        for k, n in enumerate((3, 2, 1)):
            at = t0 + 0.9 + k * 0.8
            cd += f'<div class="cd" data-at="{at:.2f}" data-until="{at + 0.7:.2f}" data-anim="pop">{n}</div>'
            ev.append((at, "tick"))
        rv = t0 + 0.9 + 2.4
        h += f'<div style="position:relative;height:200px;width:100%">{cd}<div class="row" style="position:absolute;inset:0">{_tiles(tiles, 180, st, plus=False, at=rv, step=0.12)}</div></div>'
        h += _word(tiles, f'data-at="{rv + 0.5:.2f}" data-anim="pop"')
        ev += [(rv + i * 0.12, "pop", i) for i in range(len(tiles))] + [(rv + 0.5, "bell"), (rv + 0.9, "sparkle")]
        return h, ev, rv + 2.0
    if t == "tips":
        h = f'<div class="card" style="display:grid;gap:40px;width:920px;font-size:50px" data-at="{max(0, t0 - 0.4):.2f}" data-anim="rise">'
        for i, p in enumerate(spec["points"]):
            at = t0 + i * 1.5
            h += f'<div class="pt" data-at="{at:.2f}" data-anim="rise">{_tile(str(i + 1), 96, i, st)}<span>{html.escape(p)}</span></div>'
            ev.append((at, "pop", i))
        return h + "</div>", ev, t0 + 3 * 1.5 + 0.6
    if t == "pantas":
        h = '<div style="display:grid;gap:34px;justify-items:center">'
        for i, w in enumerate(spec["words"]):
            at = t0 + i * 1.1
            h += f'<div class="row" data-at="{at:.2f}" data-anim="pop">{_tiles(w, 165, st, plus=False)}</div>'
            ev.append((at, "pop", i))
        end = t0 + len(spec["words"]) * 1.1
        h += f'<div class="timer" style="font:600 64px JBDisplay,system-ui;color:{st["acc"]}" data-at="{t0:.2f}" data-anim="fade">⏱️ <span id="sec">0.0</span>s</div></div>'
        ev.append((end, "bell"))
        return h, ev, end + 0.9
    tiles = spec["tiles"] or ["ba", "ca"]  # bina
    h = f'<div class="row">{_tiles(tiles, 230, st, at=t0, step=0.35)}</div>'
    wa = t0 + len(tiles) * 0.35 + 0.5
    h += _word(tiles, f'data-at="{wa:.2f}" data-anim="pop" style="font-size:150px"')
    h += f'<div style="font-size:76px;letter-spacing:12px;text-align:center" data-at="{wa + 0.4:.2f}" data-anim="pop">⭐⭐⭐</div>'
    ev += [(t0 + i * 0.35, "pop", i) for i in range(len(tiles))] + [(wa, "bell"), (wa + 0.4, "sparkle")]
    return h, ev, wa + 1.8


def video_build(spec, site_host, rng=None):
    rng = rng or random.Random()
    st = _style(rng)
    hook_end = round(min(4.0, max(2.6, 2.2 + len(spec["headline"]) / 40)), 2)
    stage, ev, demo_end = _video_stage(spec, st, hook_end)
    total = round(demo_end + 2.6, 2)
    ev = [(0.0, "whoosh")] + ev + [(demo_end, "tada")]
    sub = f'<p style="font-size:44px;line-height:1.35;color:#5d5780;margin-top:28px" data-at="0.5" data-anim="rise">{html.escape(spec["sub"])}</p>' if spec["sub"] and spec["template"] == "bina" else ""
    page = f"""<!doctype html><html><head><meta charset="utf-8"><style>{_fontface()}{BASE_CSS}
html,body{{width:{W_VID}px;height:{H_VID}px}}
body{{{_bg_css(st)}}}
.top{{position:absolute;left:80px;right:80px;top:150px}}
h1{{font:600 {_hsize(spec["headline"], 100)}px/1.1 JBDisplay,system-ui;margin-top:64px;letter-spacing:-.5px}}
.stage{{position:absolute;left:0;right:0;top:820px;display:grid;justify-items:center;gap:36px}}
.cd{{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:600 190px/1 JBDisplay,system-ui;color:{st["acc"]}}}
.cta{{position:absolute;left:80px;right:80px;bottom:170px;display:grid;justify-items:center;gap:30px;text-align:center}}
.cta b{{font:600 72px/1.15 JBDisplay,system-ui}}
.bar{{position:absolute;left:0;bottom:0;height:14px;background:{st["acc"]}}}
</style></head><body>{_confetti(st, rng, W_VID, H_VID, 18)}
<div class="top" data-at="0" data-anim="rise">{_brand()}<h1>{html.escape(spec["headline"])}</h1>{sub}</div>
<div class="stage">{stage}</div>
<div class="cta" data-at="{demo_end:.2f}" data-anim="rise"><b>Cuba 6 tahap percuma</b><span class="url">{html.escape(site_host)}</span></div>
<div class="bar" id="bar"></div>
<script>
const TOTAL={total}, T0={hook_end};
const ease=t=>t<0?0:t>1?1:1-Math.pow(1-t,3);
const els=[...document.querySelectorAll('[data-at]')];
function seek(t){{
  for(const el of els){{
    const at=+el.dataset.at, un=el.dataset.until?+el.dataset.until:1e9, k=el.dataset.anim||'rise';
    const e=Math.min(ease((t-at)/0.45), 1-ease((t-un)/0.25));
    el.style.opacity=Math.max(0,e);
    el.style.transform=k==='pop'?`scale(${{0.5+0.5*e}})`:k==='zoom'?`scale(${{0.3+0.7*e}}) rotate(${{(1-e)*-12}}deg)`:k==='fade'?'none':`translateY(${{(1-e)*60}}px)`;
  }}
  const s=document.getElementById('sec'); if(s) s.textContent=Math.max(0,t-T0).toFixed(1);
  document.getElementById('bar').style.width=(Math.min(1,t/TOTAL)*100)+'%';
}}
window.seek=seek; seek(0);
</script></body></html>"""
    return page, {"total": total, "events": ev}


# ---------------------------------------------------------------- render
def render_image(spec, site_host, out, rng=None):
    from playwright.sync_api import sync_playwright
    with tempfile.TemporaryDirectory() as tmp:
        page_file = os.path.join(tmp, "card.html")
        open(page_file, "w", encoding="utf-8").write(image_html(spec, site_host, rng))
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={"width": W_IMG, "height": H_IMG})
            pg.goto("file://" + page_file)
            pg.evaluate("document.fonts.ready")
            pg.wait_for_timeout(150)
            pg.screenshot(path=out, type="png")
            b.close()
    return out


def render_video(spec, site_host, out, rng=None):
    from playwright.sync_api import sync_playwright
    rng = rng or random.Random()
    with tempfile.TemporaryDirectory() as tmp:
        page, tl = video_build(spec, site_host, rng)
        page_file = os.path.join(tmp, "vid.html")
        open(page_file, "w", encoding="utf-8").write(page)
        silent = os.path.join(tmp, "silent.mp4")
        n = int(tl["total"] * FPS)
        ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", silent], stdin=subprocess.PIPE)
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={"width": W_VID, "height": H_VID})
            pg.goto("file://" + page_file)
            pg.evaluate("document.fonts.ready")
            for i in range(n):
                pg.evaluate(f"seek({i / FPS})")
                ff.stdin.write(pg.screenshot(type="jpeg", quality=88))
            b.close()
        ff.stdin.close()
        ff.wait(timeout=300)
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", silent]
        try:
            from . import sound
            wav = sound.render(tl, os.path.join(tmp, "bunyi.wav"), seed=rng.random())
            cmd += ["-i", wav, "-map", "0:v", "-map", "1:a"]
            LAST["audio"] = "muzik+sfx"
        except Exception as e:  # noqa: BLE001
            print("bunyi gagal, guna trek senyap:", repr(e))
            LAST["audio"] = f"GAGAL: {e!r}"[:300]
            cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono"]
        cmd += ["-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", out]
        subprocess.run(cmd, check=True, timeout=300)
    return out


def make(spec, site_host, hq):
    """Jana media dan muat naik ke HQ. Pulang URL awam atau None."""
    if not spec or not available():
        return None
    ext, ctype = ("mp4", "video/mp4") if spec["type"] == "video" else ("png", "image/png")
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "m." + ext)
        try:
            (render_video if spec["type"] == "video" else render_image)(spec, site_host, out)
            return hq.upload(out, ctype)
        except Exception as e:  # noqa: BLE001
            print("media gagal:", e)
            return None
