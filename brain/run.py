"""Pelancar agen.

  python -m brain.run tick                 jalankan agen yang dijadualkan untuk jam ini (guna claim, selamat dijalankan dari banyak tempat)
  python -m brain.run agent social         jalankan satu agen sekarang (abaikan jadual)
  python -m brain.run all                  jalankan semua agen sekali (ujian)
  BRAIN_DRY=1 ...                          cetak tindakan tanpa menulis ke HQ
"""
import os
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
        hq.write("heartbeat", "brain", via="github" if os.environ.get("GITHUB_ACTIONS") else "modal")
    except Exception as e:  # noqa: BLE001
        print("heartbeat gagal:", e)
    ran = []
    for name, (hours, days) in SCHEDULE.items():
        if days is not None and n.weekday() not in days:
            continue
        for h in hours:
            if 0 <= n.hour - h <= 2:  # tetingkap 3 jam untuk kejar larian yang terlepas
                slot = f"{n.date().isoformat()}-{h:02d}"
                if hq.claim(name, slot):
                    run_agent(hq, name)
                    ran.append(name)
    print(f"tick {n.isoformat()}: {ran or 'tiada agen dijadualkan'}")
    return ran


def media_test():
    """Jana 1 gambar + 1 video contoh, muat naik, hantar pautan ke Telegram. Tiada post dibuat."""
    from . import media
    hq = HQ()
    host = hq.url.split("//", 1)[-1]
    if not media.available():
        hq.write("notify", "brain", text="🧪 Ujian media GAGAL: Playwright/ffmpeg tiada di persekitaran ini.")
        sys.exit(1)
    img = media.make(media.clean_spec({"type": "image", "headline": "Anak kenal huruf tapi masih tak boleh membaca?", "sub": "Rahsianya: gabung suku kata.", "tiles": ["bo", "la"], "word": "bola"}), host, hq)
    vid = media.make(media.clean_spec({"type": "video", "headline": "10 minit sehari, anak boleh baca perkataan pertama", "tiles": ["ku", "cing"], "word": "kucing"}), host, hq)
    hq.write("notify", "brain", text=f"🧪 Ujian media (tiada post dibuat)\nGambar: {img or 'GAGAL'}\nVideo: {vid or 'GAGAL'}")
    print("gambar:", img, "video:", vid)
    sys.exit(0 if img and vid else 1)


def main(argv):
    if not argv or argv[0] == "tick":
        tick()
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
