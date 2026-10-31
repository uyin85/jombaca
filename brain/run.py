"""Pelancar agen.

  python -m brain.run tick                 jalankan agen yang dijadualkan untuk jam ini (guna claim, selamat dijalankan dari banyak tempat)
  python -m brain.run agent social         jalankan satu agen sekarang (abaikan jadual)
  python -m brain.run all                  jalankan semua agen sekali (ujian)
  BRAIN_DRY=1 ...                          cetak tindakan tanpa menulis ke HQ
"""
import os
import re
import sys
import traceback

from .agents import AGENTS, SCHEDULE, now_myt
from .hq import HQ


def run_agent(hq, name):
    try:
        st = hq.state(name)
        summary, model = AGENTS[name](hq, st)
        print(f"✓ {name}: {summary} [{model}]")
        hq.write("run", name, status="ok", summary=summary, llm=model)
        return True
    except Exception as e:  # noqa: BLE001
        err = f"{type(e).__name__}: {e}\n{traceback.format_exc()[-1500:]}"
        print(f"✗ {name}: {err}")
        try:
            hq.write("run", name, status="error", summary="", error=err)
        except Exception:  # noqa: BLE001
            pass
        return False


def tick(hq=None):
    hq = hq or HQ()
    n = now_myt()
    try:  # isyarat "saya hidup" untuk Pengawas, walaupun tiada agen dijadualkan jam ini
        hb = hq.write("heartbeat", "brain", via="github" if os.environ.get("GITHUB_ACTIONS") else "modal")
        if hb.get("media_test"):
            media_test(exit_after=False)
        if hb.get("audio_jobs"):
            audio_jobs(hq, hb["audio_jobs"])
    except Exception as e:  # noqa: BLE001
        print("heartbeat gagal:", e)
    ran = []
    for name, (hours, days) in SCHEDULE.items():
        if days is not None and n.weekday() not in days:
            continue
        for h in hours:
            if 0 <= n.hour - h <= 2:  # tetingkap 3 jam untuk kejar larian yang terlepas
                slot = f"{n.date().isoformat()}-{h:02d}"
                try:
                    claimed = hq.claim(name, slot)
                except Exception as e:  # noqa: BLE001
                    # Jangan hentikan seluruh tick jika HQ tidak boleh dihubungi.
                    # Slot tidak ditandakan berjaya; GitHub Actions/Modal boleh cuba lagi.
                    print(f"claim gagal {name} ({slot}): {type(e).__name__}: {e}")
                    continue
                if claimed:
                    ok = run_agent(hq, name)
                    ran.append(name if ok else name + "(gagal)")
                    if not ok:  # lepaskan slot supaya larian seterusnya (dalam tetingkap 3 jam) cuba semula
                        try:
                            hq.write("unclaim", name, slot=slot)
                        except Exception as e:  # noqa: BLE001
                            print("unclaim gagal:", e)
    print(f"tick {n.isoformat()}: {ran or 'tiada agen dijadualkan'}")
    return ran


def media_test(exit_after=True):
    """Jana 1 gambar + 1 video contoh, muat naik, lapor ke HQ (Larian agen) & Telegram. Tiada post dibuat."""
    import shutil
    import tempfile
    from . import media
    hq = HQ()
    try:
        host = re.sub(r"^https?://", "", hq.state("media-test")["product"]["site"]).rstrip("/")
    except Exception:  # noqa: BLE001
        host = hq.url.split("//", 1)[-1]
    res, errs = {}, []
    env = f"ffmpeg={bool(shutil.which('ffmpeg'))} fonts={media._font('Fredoka-600.woff2')}"
    specs = {"gambar": {"type": "image", "headline": "Anak kenal huruf tapi masih tak boleh membaca?", "sub": "Rahsianya: gabung suku kata.", "tiles": ["bo", "la"], "word": "bola"},
             "video": {"type": "video", "headline": "10 minit sehari, anak boleh baca perkataan pertama", "tiles": ["ku", "cing"], "word": "kucing"}}
    for name, v in specs.items():
        try:
            spec = media.clean_spec(v)
            with tempfile.TemporaryDirectory() as tmp:
                ext, ct = ("mp4", "video/mp4") if spec["type"] == "video" else ("png", "image/png")
                out = f"{tmp}/t.{ext}"
                (media.render_video if spec["type"] == "video" else media.render_image)(spec, host, out)
                res[name] = hq.upload(out, ct)
        except BaseException:  # noqa: BLE001
            errs.append(f"{name}: {traceback.format_exc()[-1500:]}")
    ok = len(res) == 2
    summary = f"{env} bunyi={media.LAST['audio']}\n" + "\n".join(f"{k}: {v}" for k, v in res.items())
    hq.write("run", "media-test", status="ok" if ok else "error", summary=summary, error="\n".join(errs))
    hq.write("notify", "brain", text="🧪 Ujian media (tiada post dibuat)\n" + summary + ("\n⚠️ " + "\n".join(e[-300:] for e in errs) if errs else ""))
    print(summary, errs)
    if exit_after:
        sys.exit(0 if ok else 1)
    return ok


def curriculum_units():
    """Semua suku kata & perkataan dalam 40 tahap (tahap percuma dalam app + tahap Pro dalam core.json)."""
    import json as _j
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    page = open(os.path.join(root, "public/app/index.html"), encoding="utf-8").read()
    i = page.index("const LV = [") + len("const LV = ")
    free, _ = _j.JSONDecoder().raw_decode(page[i:])
    core = _j.load(open(os.path.join(root, "src/content/core.json"), encoding="utf-8"))
    units = set()

    def word(w):
        parts = [p for p in w.strip().lower().split("-") if p]
        if parts and all(re.fullmatch(r"[a-z]+", p) for p in parts):
            units.update(parts)
            units.add("".join(parts))
    for lv in free + core["levels"]:
        for it in lv[3]:
            if it.startswith("?"):
                continue
            if "|" in it:
                t, _e, _c, w = (it.split("|") + ["", "", "", ""])[:4]
                if len(t) > 1 and re.fullmatch(r"[a-z]+", t.lower()):
                    units.add(t.lower())
                if w:
                    word(w)
            else:
                m = re.match(r"^([a-z .,!-]+)", it, re.I)
                ws = (m.group(1).strip() if m else "").split()
                if len(ws) <= 4:
                    for x in ws:
                        word(x.strip(".,!"))
    return sorted(u for u in units if len(u) > 1)


def audio_jobs(hq, jobs):
    """Jana audio huruf dengan suara neural ms-MY (edge-tts) dan muat naik ke R2."""
    import asyncio
    import tempfile
    try:
        import edge_tts
    except Exception as e:  # noqa: BLE001
        print("edge-tts tiada:", e)
        return
    done, errs = 0, []
    with tempfile.TemporaryDirectory() as tmp:
        for j in jobs[:600]:
            f = f"{tmp}/{j['key']}.mp3"
            if j.get("variants"):
                alts = []
                t = j["text"]
                spells = [t, t + "h"]
                if "e" in t:
                    spells += [t.replace("e", "ê"), t.replace("e", "ə")]
                for sp in spells:
                    for vname, vid in (("Yasmin", "ms-MY-YasminNeural"), ("Osman", "ms-MY-OsmanNeural"), ("Gadis", "id-ID-GadisNeural")):
                        g = f"{tmp}/{j['key']}-{len(alts)}.mp3"
                        try:
                            asyncio.run(edge_tts.Communicate(sp, vid, rate="-10%").save(g))
                            if os.path.getsize(g) > 800:
                                alts.append({"u": hq.upload(g, "audio/mpeg"), "l": f"{vname} · \"{sp}\""})
                        except Exception:  # noqa: BLE001
                            pass
                try:
                    hq.write("audio_alt", "brain", key=j["key"], alts=alts)
                    done += 1
                except Exception as e:  # noqa: BLE001
                    errs.append(f"{j['key']} varian: {e}")
                continue
            try:
                asyncio.run(edge_tts.Communicate(j["text"], j.get("voice") or "ms-MY-YasminNeural", rate="-10%").save(f))
                url = hq.upload(f, "audio/mpeg")
                hq.write("audio_unit" if j.get("unit") else "audio", "brain", key=j["key"], url=url)
                done += 1
            except Exception as e:  # noqa: BLE001
                errs.append(f"{j['key']}: {type(e).__name__}: {str(e)[:160]}")
    hq.write("run", "audio", status="ok" if not errs else "error", summary=f"{done} audio huruf dijana", error="\n".join(errs)[:1900])


def voice_test():
    """Uji enjin suara dari pelayan: edge-tts (Microsoft ms-MY) dan gTTS (Google ms). Lapor ke HQ."""
    import asyncio
    import tempfile
    hq = HQ()
    out = []
    with tempfile.TemporaryDirectory() as tmp:
        for voice in ("ms-MY-YasminNeural", "ms-MY-OsmanNeural"):
            try:
                import edge_tts
                f = f"{tmp}/{voice}.mp3"
                asyncio.run(edge_tts.Communicate("eff. bi. si. jei. kei. zek.", voice).save(f))
                out.append(f"edge {voice}: ok {os.path.getsize(f)} bait")
                url = hq.upload(f, "audio/mpeg") if hasattr(hq, "upload") else ""
                out.append(f"  {url}")
            except BaseException as e:  # noqa: BLE001
                out.append(f"edge {voice}: GAGAL {type(e).__name__}: {str(e)[:300]}")
        try:
            from gtts import gTTS
            f = f"{tmp}/g.mp3"
            gTTS("eff. bi. si.", lang="ms").save(f)
            out.append(f"gtts: ok {os.path.getsize(f)} bait")
        except BaseException as e:  # noqa: BLE001
            out.append(f"gtts: GAGAL {type(e).__name__}: {str(e)[:300]}")
    txt = "\n".join(out)
    print(txt)
    hq.write("run", "voice-test", status="ok", summary=txt[:3900])


def main(argv):
    if not argv or argv[0] == "tick":
        tick()
    elif argv[0] == "agent" and len(argv) > 1 and argv[1] == "audio-now":
        hq = HQ()
        try:  # daftar semua suku kata & perkataan kurikulum (fail repo) supaya dijana
            r = hq.write("audio_units_add", "brain", keys=curriculum_units())
            print("unit audio:", r)
        except Exception as e:  # noqa: BLE001
            print("senarai unit gagal:", e)
        audio_jobs(hq, hq.write("audio_jobs", "brain").get("jobs", []))
    elif argv[0] == "agent" and len(argv) > 1 and argv[1] == "cfai-test":
        from .llm import call_cfai, parse_json
        hq = HQ()
        try:
            text, model = call_cfai("Anda penulis iklan Bahasa Malaysia. Balas JSON sahaja.", 'Tulis 1 hook Threads tentang anak belajar membaca suku kata. Skema: {"hook": "..."}', "smart", 0.7)
            out = f"{model}: {parse_json(text)}"
            st = "ok"
        except Exception as e:  # noqa: BLE001
            out, st = f"{type(e).__name__}: {e}", "error"
        print(out)
        hq.write("run", "cfai-test", status=st, summary=out[:1500])
    elif argv[0] == "agent" and len(argv) > 1 and argv[1] == "voice-test":
        voice_test()
    elif argv[0] == "agent" and len(argv) > 1 and argv[1] == "media-test":
        media_test()
    elif argv[0] == "agent" and len(argv) > 1:
        ok = run_agent(HQ(), argv[1])
        sys.exit(0 if ok else 1)
    elif argv[0] == "all":
        hq = HQ()
        for name in AGENTS:
            run_agent(hq, name)
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
