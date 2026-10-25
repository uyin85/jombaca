"""Klien API Jom Baca HQ (Cloudflare Worker)."""
import json
import os
import urllib.request

UA = "jombaca-brain/2.0"


class HQ:
    def __init__(self, url=None, key=None, dry=None):
        self.url = (url or os.environ["HQ_URL"]).rstrip("/")
        self.key = key or os.environ["BRAIN_KEY"]
        self.dry = bool(int(os.environ.get("BRAIN_DRY", "0"))) if dry is None else dry
        self.log = []

    def _req(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, method=method, headers={"content-type": "application/json", "x-brain-key": self.key, "user-agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())

    def state(self, agent):
        return self._req("GET", f"/api/brain/state?agent={agent}")

    def claim(self, agent, slot):
        if self.dry:
            return True
        return self._req("POST", "/api/brain/claim", {"agent": agent, "slot": slot}).get("ok", False)

    def write(self, kind, agent, **data):
        payload = {"kind": kind, "agent": agent, **data}
        self.log.append(payload)
        if self.dry:
            print(f"[DRY] write {kind}: {json.dumps(payload, ensure_ascii=False)[:600]}")
            return {"ok": True, "dry": True}
        return self._req("POST", "/api/brain/write", payload)

    def upload(self, path, content_type):
        """Muat naik gambar/video ke R2 melalui HQ. Pulang URL awam."""
        if self.dry:
            print(f"[DRY] upload {path} ({os.path.getsize(path)} bait)")
            return "https://example.com/dry." + path.rsplit(".", 1)[-1]
        with open(path, "rb") as f:
            data = f.read()
        req = urllib.request.Request(self.url + "/api/brain/media", data=data, method="POST", headers={"content-type": content_type, "x-brain-key": self.key, "user-agent": UA})
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode()).get("url")
