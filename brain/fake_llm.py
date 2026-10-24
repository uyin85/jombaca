"""LLM palsu untuk ujian paip tanpa kunci API (BRAIN_FAKE_LLM=1)."""
import json
import re


def answer(system, user):
    system = system.split("\n", 1)[0]
    if "CEO" in system:
        return {"plan": {"focus": "Tolak lead checkout ke jualan", "why": "ujian", "sales_target_today": 5, "directives": {"social": "Fokus darjah_satu", "leads": "WhatsApp semua checkout"}, "owner_tasks": ["WhatsApp 3 lead panas"]}, "learnings": [{"text": "Ujian pelajaran CEO", "evidence": "1 jualan"}], "telegram": "Selamat pagi! Ujian ringkasan."}
    if "Media Sosial" in system:
        slots = json.loads(re.search(r"SLOT: (\[.*?\])\n", user).group(1))
        return {"posts": [{"slot": s["slot"], "angle": s["angle"] if s["angle"] != "__explore__" else "rutin_malam", "hook": f"Hook {s['slot']}", "body": f"Post ujian {s['platform']} {{LINK}}"} for s in slots], "new_angles": [{"name": "rutin_malam", "description": "Rutin membaca selepas makan malam"}]}
    if "Kreatif" in system:
        return {"videos": [{"title": "Momo sebut bola", "angle": "demo_app", "prompt": {"aspect_ratio": "9:16", "action": "Momo sebut bo-la"}, "overlay_text": ["bo", "la", "bola"], "caption": "Anak suka! {LINK} #jombaca", "platforms": ["tiktok", "threads"]}] * 5}
    if "WhatsApp" in system:
        ids = [int(x) for x in re.findall(r'"id":(\d+)', user)]
        return {"leads": [{"id": i, "score": 70, "wa_msg": "Hai! Ada apa-apa saya boleh bantu?", "notes": "ujian"} for i in ids]}
    if "Pemasaran" in system:
        return {"variants": [{"slot": "headline", "text": "Headline ujian baharu"}], "promo": {"create": True, "code": "UJIAN10", "pct": 10, "hours": 24, "label": "Promo ujian", "reason": "ujian"}, "nurture_tpl": None, "notes": "ok"}
    if "Affiliate" in system:
        return {"swipe": [{"platform": "WhatsApp", "text": "Cuba ni {LINK}"}], "broadcast": {"subject": "Bahan minggu ini", "html": "<p>Hai {name}, pautan: {link}</p>"}, "recruit": [{"title": "Cikgu tadika", "body": "DM templat"}]}
    if "penyemak kandungan" in system:
        return {"safe": True, "fixed_items": None, "issues": []}
    if "Kurikulum" in system:
        return {"pack": {"title": "Cerita Pantai", "en": "Beach", "icon": "🏖️", "items": ["kami pergi ke pantai. air laut biru🌊", "adik buat istana pasir. istana itu besar🏰", "ayah beli air kelapa. air itu manis🥥", "kami nampak ketam. ketam itu lari🦀"]}, "proposals": [{"title": "Paywall lebih awal", "body": "ujian"}]}
    if "Penganalisis" in system:
        return {"new_learnings": [{"text": "Post dengan soalan dapat lebih klik", "evidence": "ujian", "score": 0.5}], "retire_ids": [], "rescore": [], "prompt_updates": [{"target": "social", "addendum": "Mulakan dengan soalan.", "reason": "ujian"}], "angles": [], "summary": "Ujian reflect."}
    return {}
