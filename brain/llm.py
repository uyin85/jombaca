"""Penghala LLM: Gemini (percuma), Claude (Anthropic API), Hermes / mana-mana endpoint serasi OpenAI.

Tier:
  smart: tugasan strategik (CEO, Social, Creative, Marketing, Reflect)
  fast:  tugasan ringan (skor lead, semakan keselamatan)

Pemboleh ubah persekitaran:
  GEMINI_API_KEY             kunci percuma dari https://aistudio.google.com/apikey
  GEMINI_MODEL_SMART         lalai: gemini-flash-latest
  GEMINI_MODEL_FAST          lalai: gemini-flash-lite-latest
  ANTHROPIC_API_KEY          (pilihan) Claude API, berbayar ikut guna
  ANTHROPIC_MODEL            lalai: claude-sonnet-5-5
  OPENAI_COMPAT_BASE         (pilihan) cth https://openrouter.ai/api/v1 atau Nous Portal
  OPENAI_COMPAT_KEY
  OPENAI_COMPAT_MODEL        cth nousresearch/hermes-4-70b
  LLM_SMART_ORDER            lalai: anthropic,compat,gemini
  LLM_FAST_ORDER             lalai: gemini,compat,anthropic
"""
import json
import os
import re
import time
import urllib.error
import urllib.request

UA = "jombaca-brain/2.0"


def _post(url, body, headers, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json", "user-agent": UA, **headers}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _get(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers={"user-agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def parse_json(text):
    """Ambil objek JSON daripada jawapan LLM (tahan pagar ``` dan teks tambahan)."""
    if isinstance(text, (dict, list)):
        return text
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t, flags=re.S)
    try:
        return json.loads(t)
    except Exception:
        pass
    for open_c, close_c in (("{", "}"), ("[", "]")):
        s = t.find(open_c)
        e = t.rfind(close_c)
        if s != -1 and e > s:
            try:
                return json.loads(t[s:e + 1])
            except Exception:
                continue
    raise ValueError("LLM tidak memulangkan JSON yang sah: " + t[:300])


_gemini_models = None


def _gemini_pick(tier):
    """Jika model lalai tiada (404), cari model flash yang tersedia untuk kunci ini."""
    global _gemini_models
    key = os.environ["GEMINI_API_KEY"]
    if _gemini_models is None:
        try:
            data = _get(f"https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key={key}")
            _gemini_models = [m["name"].split("/", 1)[1] for m in data.get("models", []) if "generateContent" in m.get("supportedGenerationMethods", [])]
        except Exception:
            _gemini_models = []
    want = "flash-lite" if tier == "fast" else "flash"
    cands = [m for m in _gemini_models if want in m and "tts" not in m and "image" not in m and "live" not in m and (tier == "fast" or "lite" not in m)]
    cands.sort(key=lambda m: ("preview" in m or "exp" in m, [-int(x) if x.isdigit() else 0 for x in re.findall(r"\d+", m)]))
    return cands[0] if cands else None


def call_gemini(system, user, tier, temperature):
    key = os.environ["GEMINI_API_KEY"]
    model = os.environ.get("GEMINI_MODEL_FAST" if tier == "fast" else "GEMINI_MODEL_SMART") or ("gemini-flash-lite-latest" if tier == "fast" else "gemini-flash-latest")
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"temperature": temperature, "responseMimeType": "application/json", "maxOutputTokens": 8192},
    }
    for attempt in range(2):
        try:
            d = _post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}", body, {})
            parts = d["candidates"][0]["content"]["parts"]
            return "".join(p.get("text", "") for p in parts), "gemini:" + model
        except urllib.error.HTTPError as e:
            if e.code == 404 and attempt == 0:
                alt = _gemini_pick(tier)
                if alt and alt != model:
                    model = alt
                    continue
            raise


def call_anthropic(system, user, tier, temperature):
    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5")
    if tier == "fast":
        model = os.environ.get("ANTHROPIC_MODEL_FAST", "claude-haiku-5-5")
    d = _post("https://api.anthropic.com/v1/messages", {
        "model": model, "max_tokens": 8000, "temperature": temperature, "system": system,
        "messages": [{"role": "user", "content": user + "\n\nBalas dengan JSON sahaja."}],
    }, {"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"})
    return "".join(b.get("text", "") for b in d.get("content", [])), "claude:" + model


def call_compat(system, user, tier, temperature):
    base = os.environ["OPENAI_COMPAT_BASE"].rstrip("/")
    model = os.environ.get("OPENAI_COMPAT_MODEL_FAST" if tier == "fast" else "OPENAI_COMPAT_MODEL") or os.environ.get("OPENAI_COMPAT_MODEL", "nousresearch/hermes-4-70b")
    d = _post(base + "/chat/completions", {
        "model": model, "temperature": temperature, "max_tokens": 8000,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user + "\n\nBalas dengan JSON sahaja."}],
    }, {"authorization": "Bearer " + os.environ["OPENAI_COMPAT_KEY"]})
    return d["choices"][0]["message"]["content"], "compat:" + model


PROVIDERS = {
    "gemini": (lambda: bool(os.environ.get("GEMINI_API_KEY")), call_gemini),
    "anthropic": (lambda: bool(os.environ.get("ANTHROPIC_API_KEY")), call_anthropic),
    "compat": (lambda: bool(os.environ.get("OPENAI_COMPAT_BASE") and os.environ.get("OPENAI_COMPAT_KEY")), call_compat),
}


def available():
    return [k for k, (ok, _) in PROVIDERS.items() if ok()]


def ask_json(system, user, tier="smart", temperature=0.8):
    """Panggil LLM ikut susunan keutamaan, jatuh ke penyedia seterusnya jika gagal. Pulang (dict, nama_model)."""
    if os.environ.get("BRAIN_FAKE_LLM"):
        from . import fake_llm
        return fake_llm.answer(system, user), "fake"
    order = os.environ.get("LLM_FAST_ORDER" if tier == "fast" else "LLM_SMART_ORDER") or ("gemini,compat,anthropic" if tier == "fast" else "anthropic,compat,gemini")
    errors = []
    for name in [x.strip() for x in order.split(",") if x.strip()]:
        if name not in PROVIDERS or not PROVIDERS[name][0]():
            continue
        for attempt in range(2):
            try:
                text, used = PROVIDERS[name][1](system, user, tier, temperature)
                return parse_json(text), used
            except urllib.error.HTTPError as e:
                msg = e.read().decode(errors="ignore")[:300]
                errors.append(f"{name} HTTP {e.code}: {msg}")
                if e.code in (429, 500, 502, 503, 529) and attempt == 0:
                    time.sleep(8)
                    continue
                break
            except Exception as e:  # noqa: BLE001
                errors.append(f"{name}: {e}")
                if attempt == 0 and "JSON" in str(e):
                    continue
                break
    raise RuntimeError("Semua LLM gagal: " + " | ".join(errors) if errors else "Tiada LLM disetup. Tetapkan GEMINI_API_KEY (percuma).")
