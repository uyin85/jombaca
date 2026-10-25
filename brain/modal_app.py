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
    .pip_install("playwright==1.47.0")
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
