"""Penjana media Jom Baca: kad gambar (1080x1350) dan video hook (1080x1920, 9:16).

Cara: templat HTML berjenama (kotak suku kata berwarna seperti dalam app) dirakam oleh Chromium
(Playwright). Video dirakam frame demi frame dan dicantum dengan ffmpeg, beserta suara latar
Bahasa Melayu (edge-tts, ms-MY) jika tersedia. Tiada AI imej, jadi ejaan sentiasa tepat. Kos RM0.

Jika Playwright/ffmpeg tiada (cth. persekitaran ujian), available() pulang False dan agen
terus post teks sahaja.
"""
import asyncio
import html
import json
import os
import re
import shutil
import subprocess
import tempfile

W_IMG, H_IMG = 1080, 1350
W_VID, H_VID = 1080, 1920
FPS = 30
LAST = {"tts": ""}  # status suara larian terakhir (untuk laporan)
VOICE = os.environ.get("JB_TTS_VOICE", "ms-MY-YasminNeural")
FONT_DIRS = [os.environ.get("JB_FONTS", ""), os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")]

THEMES = [  # (latar atas, latar bawah, warna sorotan)
    ("#e4f3ff", "#bfe3ff", "#2f7df6"),
    ("#fff4d6", "#ffe39a", "#e08a00"),
    ("#e3f8ee", "#bdeed6", "#12955a"),
    ("#ffe9ee", "#ffc9d4", "#d9344f"),
    ("#efe8ff", "#d8c8ff", "#7a3ff2"),
]
TILE_COLS = ["#ef3f5c", "#2f7df6", "#17b26a", "#f5a000", "#8a4dff"]


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


def clean_spec(v, fallback_hook=""):
    """Sahkan spesifikasi visual daripada LLM. Pulang dict atau None."""
    if not isinstance(v, dict):
        return None
    kind = str(v.get("type", "")).lower()
    if kind not in ("image", "video"):
        return None
    headline = re.sub(r"\s+", " ", str(v.get("headline") or fallback_hook or "")).strip()[:90]
    if not headline:
        return None
    tiles = [re.sub(r"[^a-z]", "", str(t).lower()) for t in (v.get("tiles") or [])][:4]
    tiles = [t for t in tiles if 1 <= len(t) <= 4]
    word = re.sub(r"[^a-z]", "", str(v.get("word") or "").lower())
    if not tiles or "".join(tiles) != word:
        tiles, word = [], ""
    sub = re.sub(r"\s+", " ", str(v.get("sub") or "")).strip()[:110]
    return {"type": kind, "headline": headline, "tiles": tiles, "word": word, "sub": sub, "theme": abs(hash(headline)) % len(THEMES)}


def _tiles_html(tiles, size):
    return "".join(f'<span class="tile" style="background:{TILE_COLS[i % len(TILE_COLS)]};width:{size}px;height:{size}px;font-size:{int(size * (0.56 if len(t) <= 2 else 0.44 if len(t) == 3 else 0.36))}px">{html.escape(t)}</span>' + ('<span class="op">+</span>' if i < len(tiles) - 1 else "") for i, t in enumerate(tiles))


def _word_html(tiles):
    return "".join(f'<span style="color:{TILE_COLS[i % len(TILE_COLS)]}">{html.escape(t)}</span>' for i, t in enumerate(tiles))


BASE_CSS = """
*{box-sizing:border-box;margin:0}
body{font-family:JBBody,'Atkinson Hyperlegible',system-ui,sans-serif;color:#2b2350}
.tile{display:inline-flex;align-items:center;justify-content:center;color:#fff;font-family:JBDisplay,system-ui,sans-serif;font-weight:600;border-radius:22%;box-shadow:inset 0 -0.07em 0 rgba(0,0,0,.18),0 6px 0 rgba(43,35,80,.10)}
.op{font:600 64px/1 JBDisplay,system-ui;color:#5d5780;margin:0 14px}
.brand{display:flex;align-items:center;gap:12px;font:600 54px/1 JBDisplay,system-ui}
.brand .tile{width:66px;height:66px;font-size:36px}
.url{font:700 34px/1 JBBody,system-ui;background:#fff;border-radius:999px;padding:16px 30px;box-shadow:0 3px 0 rgba(43,35,80,.08)}
"""


def _brand():
    return '<div class="brand">Jom <span class="tile" style="background:#ef3f5c">Ba</span><span class="tile" style="background:#2f7df6">ca</span><span style="color:#17b26a">!</span></div>'


def image_html(spec, site_host):
    a, b, acc = THEMES[spec["theme"]]
    hl = html.escape(spec["headline"])
    demo = ""
    if spec["tiles"]:
        demo = f'<div class="demo"><div class="eq">{_tiles_html(spec["tiles"], 190)}</div><div class="word">{_word_html(spec["tiles"])}</div></div>'
    sub = f'<p class="sub">{html.escape(spec["sub"])}</p>' if spec["sub"] else ""
    size = 96 if len(spec["headline"]) <= 40 else 80 if len(spec["headline"]) <= 65 else 68
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{_fontface()}{BASE_CSS}
html,body{{width:{W_IMG}px;height:{H_IMG}px}}
body{{background:linear-gradient(170deg,{a} 0%,#ffffff 48%,{b} 100%);display:flex;flex-direction:column;justify-content:space-between;padding:84px 80px 80px}}
h1{{font:600 {size}px/1.08 JBDisplay,system-ui;letter-spacing:-.5px}}
h1 em{{font-style:normal;color:{acc}}}
.sub{{font-size:38px;line-height:1.35;color:#5d5780;margin-top:26px}}
.demo{{display:grid;justify-items:center;gap:18px}}
.eq{{display:flex;align-items:center}}
.word{{font:600 110px/1 JBDisplay,system-ui;letter-spacing:3px}}
.foot{{display:flex;justify-content:space-between;align-items:center}}
</style></head><body>
<div>{_brand()}<h1 style="margin-top:56px">{hl}</h1>{sub}</div>
{demo}
<div class="foot"><span class="url">{html.escape(site_host)}</span><span style="font:600 34px JBDisplay,system-ui;color:#5d5780">⭐⭐⭐</span></div>
</body></html>"""


def video_html(spec, site_host, tl):
    """tl: masa (saat) setiap bahagian: hook_end, demo_end, total."""
    a, b, acc = THEMES[spec["theme"]]
    tiles = spec["tiles"] or ["ba", "ca"]
    word = "".join(tiles)
    size = 104 if len(spec["headline"]) <= 40 else 88 if len(spec["headline"]) <= 65 else 74
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{_fontface()}{BASE_CSS}
html,body{{width:{W_VID}px;height:{H_VID}px;overflow:hidden}}
body{{background:linear-gradient(170deg,{a} 0%,#ffffff 50%,{b} 100%);position:relative}}
.top{{position:absolute;left:80px;right:80px;top:150px}}
h1{{font:600 {size}px/1.1 JBDisplay,system-ui;margin-top:70px;letter-spacing:-.5px}}
.sub{{font-size:44px;line-height:1.35;color:#5d5780;margin-top:30px}}
.stage{{position:absolute;left:0;right:0;top:900px;display:grid;justify-items:center;gap:40px}}
.eq{{display:flex;align-items:center}}
.word{{font:600 150px/1 JBDisplay,system-ui;letter-spacing:4px}}
.stars{{font-size:76px;letter-spacing:12px}}
.cta{{position:absolute;left:80px;right:80px;bottom:170px;display:grid;justify-items:center;gap:30px;text-align:center}}
.cta b{{font:600 72px/1.15 JBDisplay,system-ui}}
.bar{{position:absolute;left:0;bottom:0;height:14px;background:{acc}}}
</style></head><body>
<div class="top" id="top">{_brand()}<h1 id="hl">{html.escape(spec["headline"])}</h1>{('<p class="sub" id="sub">' + html.escape(spec["sub"]) + '</p>') if spec["sub"] else ''}</div>
<div class="stage"><div class="eq" id="eq">{_tiles_html(tiles, 230)}</div><div class="word" id="word">{_word_html(tiles)}</div><div class="stars" id="stars">⭐⭐⭐</div></div>
<div class="cta" id="cta"><b>Cuba 6 tahap percuma</b><span class="url">{html.escape(site_host)}</span></div>
<div class="bar" id="bar"></div>
<script>
const TL={json.dumps(tl)};
const ease=t=>t<0?0:t>1?1:1-Math.pow(1-t,3);
const pieces=[...document.querySelectorAll('#eq > *')];
function seek(t){{
  const hl=document.getElementById('hl'), top=document.getElementById('top');
  const k=ease(t/0.6); top.style.opacity=k; top.style.transform=`translateY(${{(1-k)*60}}px)`;
  pieces.forEach((el,i)=>{{const s=TL.hook_end*0.55+i*0.35, e=ease((t-s)/0.4); el.style.opacity=e; el.style.transform=`scale(${{0.6+0.4*e}})`;}});
  const ws=TL.hook_end+ (TL.demo_end-TL.hook_end)*0.45, we=ease((t-ws)/0.5);
  const w=document.getElementById('word'); w.style.opacity=we; w.style.transform=`scale(${{0.7+0.3*we}})`;
  const st=document.getElementById('stars'); const se=ease((t-ws-0.4)/0.5); st.style.opacity=se;
  const c=document.getElementById('cta'), ce=ease((t-TL.demo_end)/0.5); c.style.opacity=ce; c.style.transform=`translateY(${{(1-ce)*50}}px)`;
  document.getElementById('bar').style.width=(Math.min(1,t/TL.total)*100)+'%';
}}
window.seek=seek; seek(0);
</script></body></html>"""


async def _tts(text, out):
    import edge_tts  # noqa: WPS433
    await edge_tts.Communicate(text, VOICE, rate="-5%").save(out)


def _say(text, out):
    """Suara ms-MY: cuba edge-tts dahulu, jika gagal guna Google (gTTS, bahasa 'ms'). Pulang nama enjin."""
    err = None
    try:
        asyncio.run(_tts(text, out))
        if os.path.getsize(out) > 1000:
            return "edge"
    except Exception as e:  # noqa: BLE001
        err = e
    try:
        from gtts import gTTS
        gTTS(text, lang="ms").save(out)
        if os.path.getsize(out) > 1000:
            return "gtts"
    except Exception as e2:  # noqa: BLE001
        raise RuntimeError(f"edge: {err!r} | gtts: {e2!r}") from e2
    raise RuntimeError(f"edge: {err!r} | gtts: fail kosong")


def _dur(path):
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path], capture_output=True, text=True, timeout=30)
        return float(r.stdout.strip())
    except Exception:  # noqa: BLE001
        return 0.0


def _voice(spec, tmp):
    """Pulang [(fail, mula_saat)] dan tl. Gagal → tiada suara, masa lalai."""
    tiles = spec["tiles"] or ["ba", "ca"]
    parts = [spec["headline"], ". ".join(tiles) + ". " + "".join(tiles) + "!", "Cuba enam tahap percuma. Pautan di bio."]
    files, engines = [], []
    try:
        for i, t in enumerate(parts):
            f = os.path.join(tmp, f"v{i}.mp3")
            engines.append(_say(t, f))
            files.append((f, _dur(f)))
    except Exception as e:  # noqa: BLE001
        print("tts gagal, video tanpa suara:", repr(e))
        LAST["tts"] = f"GAGAL: {type(e).__name__}: {str(e)[:300]}"
        files = []
    else:
        LAST["tts"] = f"ok {'/'.join(sorted(set(engines)))} ({len(files)} klip, {sum(d for _, d in files):.1f}s)"
    d = [x[1] for x in files] if files else [0, 0, 0]
    hook_end = max(3.0, d[0] + 0.6)
    demo_end = hook_end + max(3.2, d[1] + 0.8)
    total = demo_end + max(2.6, d[2] + 0.6)
    starts = [0.3, hook_end + 0.2, demo_end + 0.2]
    return [(f, s) for (f, _), s in zip(files, starts)], {"hook_end": round(hook_end, 2), "demo_end": round(demo_end, 2), "total": round(total, 2)}


def render_image(spec, site_host, out):
    from playwright.sync_api import sync_playwright
    with tempfile.TemporaryDirectory() as tmp:
        page_file = os.path.join(tmp, "card.html")
        open(page_file, "w", encoding="utf-8").write(image_html(spec, site_host))
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={"width": W_IMG, "height": H_IMG})
            pg.goto("file://" + page_file)
            pg.evaluate("document.fonts.ready")
            pg.wait_for_timeout(150)
            pg.screenshot(path=out, type="png")
            b.close()
    return out


def render_video(spec, site_host, out):
    from playwright.sync_api import sync_playwright
    with tempfile.TemporaryDirectory() as tmp:
        voices, tl = _voice(spec, tmp)
        page_file = os.path.join(tmp, "vid.html")
        open(page_file, "w", encoding="utf-8").write(video_html(spec, site_host, tl))
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
        if voices:
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", silent]
            for f, _ in voices:
                cmd += ["-i", f]
            delays = "".join(f"[{i + 1}:a]adelay={int(s * 1000)}|{int(s * 1000)}[a{i}];" for i, (_, s) in enumerate(voices))
            mix = "".join(f"[a{i}]" for i in range(len(voices)))
            cmd += ["-filter_complex", f"{delays}{mix}amix=inputs={len(voices)}:normalize=0,apad[aout]", "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", out]
        else:  # trek audio senyap supaya diterima IG/Threads
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", silent, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-c:v", "copy", "-c:a", "aac", "-shortest", "-movflags", "+faststart", out]
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
