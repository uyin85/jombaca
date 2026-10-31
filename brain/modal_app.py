"""Otak Jom Baca di Modal.com (kredit percuma $30 sebulan, kos sebenar biasanya < $1 sebulan).

Deploy (tanpa CLI di laptop): GitHub Actions → workflow "Deploy otak ke Modal".
Secret Modal bernama "jombaca" mesti mengandungi: HQ_URL, BRAIN_KEY, GEMINI_API_KEY
(pilihan: ANTHROPIC_API_KEY, OPENAI_COMPAT_BASE/KEY/MODEL, GITHUB_TOKEN, GITHUB_REPO).
"""
import modal

app = modal.App("jombaca-brain")
# Imej termasuk Chromium (Playwright) + ffmpeg untuk melukis kad gambar & video hook (muzik disintesis sendiri).
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "fonts-noto-color-emoji", "fonts-dejavu-core")
    .pip_install("playwright==1.47.0", "edge-tts==7.3.1")
    .run_commands("playwright install --with-deps chromium")
    .env({"JB_FONTS": "/opt/jbfonts"})
    .add_local_dir("brain/fonts", remote_path="/opt/jbfonts")
    .add_local_python_source("brain")
)
secret = modal.Secret.from_name("jombaca")


@app.function(image=image, secrets=[secret], schedule=modal.Cron("5 * * * *"), timeout=1500, memory=2048)
def hourly_tick():
    """Setiap jam pada minit ke-5: jalankan agen yang dijadualkan (waktu Malaysia)."""
    from brain.run import tick
    tick()


@app.function(image=image, secrets=[secret], timeout=1500, memory=2048)
def run_agent(name: str):
    """Jalankan satu agen secara manual: modal run brain/modal_app.py::run_agent --name social"""
    from brain.hq import HQ
    from brain.run import run_agent as ra
    return ra(HQ(), name)


@app.function(image=image, secrets=[secret], timeout=120, memory=512)
def network_probe():
    """Diagnostik baca-sahaja: DNS, IPv4/IPv6 dan HTTPS Modal -> Cloudflare HQ."""
    import os
    import socket
    import urllib.error
    import urllib.request
    from urllib.parse import urlsplit

    url = os.environ.get("HQ_URL", "").strip().rstrip("/")
    key = os.environ.get("BRAIN_KEY", "")
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or not key:
        raise RuntimeError("HQ_URL (https) atau BRAIN_KEY tiada/salah dalam Modal Secret jombaca")

    host, port = parsed.hostname, parsed.port or 443
    print(f"[NET] HQ host={host} port={port}; token tidak dipaparkan")
    try:
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError as e:
        raise RuntimeError(f"DNS HQ gagal: {type(e).__name__}: {e}") from e

    seen = set()
    for family, kind, proto, _canonical, address in addresses:
        if (family, address[0]) in seen or len(seen) >= 8:
            continue
        seen.add((family, address[0]))
        label = "IPv6" if family == socket.AF_INET6 else "IPv4"
        try:
            with socket.socket(family, kind, proto) as sock:
                sock.settimeout(4)
                sock.connect(address)
            print(f"[NET] {label} TCP {address[0]}:{port} OK")
        except OSError as e:
            print(f"[NET] {label} TCP {address[0]}:{port} GAGAL: {type(e).__name__}: {e}")

    def check(label, target, headers=None):
        request = urllib.request.Request(target, headers=headers or {})
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                print(f"[NET] {label}: HTTP {response.status}")
                return response.status == 200
        except urllib.error.HTTPError as e:
            print(f"[NET] {label}: HTTP {e.code} (rangkaian dapat dicapai)")
            return False
        except (urllib.error.URLError, OSError) as e:
            print(f"[NET] {label}: GAGAL {type(e).__name__}: {e}")
            return False

    public_ok = check("internet umum", "https://example.com")
    hq_ok = check(
        "Cloudflare HQ",
        url + "/api/brain/state?agent=network-probe",
        {"x-brain-key": key, "user-agent": "jombaca-brain/2.0"},
    )
    print(f"[NET] keputusan: internet={public_ok}, hq={hq_ok}")
    if not hq_ok:
        raise RuntimeError("Modal tidak dapat mengesahkan API HQ. Semak log DNS/TCP/HTTP di atas.")
    return {"internet": public_ok, "hq": hq_ok}
