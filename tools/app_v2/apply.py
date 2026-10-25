"""Pasang Jom Baca v2 ke public/app/index.html (sekali sahaja; gagal jika corak tak dijumpai)."""
import os
import sys

D = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(D, "..", "..", "public", "app", "index.html")
s = open(APP, encoding="utf-8").read()
if "JOM BACA v2" in s:
    sys.exit("v2 sudah dipasang")


def rep(old, new, n=1):
    global s
    c = s.count(old)
    if c != n:
        sys.exit(f"corak {c}x (jangka {n}): {old[:90]!r}")
    s = s.replace(old, new)


R = lambda f: open(os.path.join(D, f), encoding="utf-8").read()

# Fon tambahan (disleksia)
rep('family=Fredoka:wght@500;600;700&display=swap" rel="stylesheet">\n',
    'family=Fredoka:wght@500;600;700&display=swap" rel="stylesheet">\n  <link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Lexend:wght@400;600;700&display=swap" rel="stylesheet">\n')
# CSS
rep("  </style>\n</head>", R("pro2.css") + "    #gateOv { z-index: 55; }\n  </style>\n</head>")
# Tetapan baharu
rep('<button class="qz-btn" id="p_dys" style="padding:8px 14px">📖 Disleksia (baca dulu)</button></div>',
    '<button class="qz-btn" id="p_dys" style="padding:8px 14px">📖 Disleksia</button><button class="qz-btn" id="p_tap" style="padding:8px 14px">🤫 Belum bertutur</button></div>')
rep('<label><input type="checkbox" id="s_big"><span>Huruf besar dan jarak luas<small>Tekan huruf atau suku kata untuk dengar bunyinya.</small></span></label>',
    '<label><input type="checkbox" id="s_big"><span>Huruf besar dan jarak luas<small>Tekan huruf atau suku kata untuk dengar bunyinya.</small></span></label>\n'
    '    <label><input type="checkbox" id="s_tap"><span>Mod Pilih Jawapan<small>Untuk anak yang belum bertutur atau sebutan belum jelas: anak dengar, kemudian tekan jawapan. Mikrofon tidak digunakan.</small></span></label>\n'
    '    <div class="srow"><b>Fon</b><select id="s_font"><option value="">Biasa (Fredoka)</option><option value="atk">Atkinson Hyperlegible (b, d, p jelas)</option><option value="lexend">Lexend (mudah dibaca)</option></select></div>\n'
    '    <div class="srow"><b>Warna latar</b><select id="s_bg"><option value="">Putih</option><option value="cream">Krim</option><option value="blue">Biru lembut</option><option value="yellow">Kuning lembut</option></select></div>\n'
    '    <div class="srow"><b>Kelajuan suara</b><select id="s_rate"><option value="0.75">Perlahan</option><option value="1">Biasa</option><option value="1.15">Laju</option></select></div>\n'
    '    <div class="srow"><b>Pemasa rehat</b><select id="s_timer"><option value="0">Tiada</option><option value="5">5 minit</option><option value="10">10 minit</option><option value="15">15 minit</option><option value="20">20 minit</option></select></div>')
rep('let CFGS = { calm: false, auto: true, accept: false, sched: false, reward: "🧸", readfirst: false, bigtext: false };',
    'let CFGS = { calm: false, auto: true, accept: false, sched: false, reward: "🧸", readfirst: false, bigtext: false, tap: false, font: "", bg: "", rate: 1, timer: 0 };')
rep('$("s_big").checked = CFGS.bigtext; renderWeak();',
    '$("s_big").checked = CFGS.bigtext; $("s_tap").checked = !!CFGS.tap; $("s_font").value = CFGS.font || ""; $("s_bg").value = CFGS.bg || ""; $("s_rate").value = String(CFGS.rate || 1); $("s_timer").value = String(CFGS.timer || 0); renderWeak();')
rep('bigtext: $("s_big").checked }; try { PS.set("cfgs"',
    'bigtext: $("s_big").checked, tap: $("s_tap").checked, font: $("s_font").value, bg: $("s_bg").value, rate: +$("s_rate").value || 1, timer: +$("s_timer").value || 0 }; try { PS.set("cfgs"')
rep('$("p_aut").onclick = () => { $("s_calm").checked = true; $("s_auto").checked = false; $("s_acc").checked = true; $("s_sch").checked = true; };',
    '$("p_aut").onclick = () => { $("s_calm").checked = true; $("s_auto").checked = false; $("s_acc").checked = true; $("s_sch").checked = true; $("s_timer").value = "10"; };')
rep('$("p_dys").onclick = () => { $("s_rf").checked = true; $("s_big").checked = true; };',
    '$("p_dys").onclick = () => { $("s_big").checked = true; $("s_font").value = "atk"; $("s_bg").value = "cream"; $("s_rate").value = "0.75"; };\n'
    '    $("p_tap").onclick = () => { $("s_tap").checked = true; $("s_auto").checked = false; $("s_acc").checked = true; };')
# Kelajuan suara
rep('u.rate = txt.length > 25 ? 0.9 : 0.85;', 'u.rate = (txt.length > 25 ? 0.9 : 0.85) * ((typeof CFGS !== "undefined" && CFGS.rate) || 1);')
# Huruf besar dipapar seperti asal (A, B…), bukan huruf kecil
rep('<span class="syl s0" style="margin-right:0">${it.target}</span>', '<span class="syl s0" style="margin-right:0">${it.rawText}</span>')
# Soalan pilihan (main bunyi & pemahaman)
rep('    function parseRawItem(r) {\n',
    '    function parseMCQ(r) {\n'
    '      const p = r.slice(1).split("|"), q = p[0], correct = p[1], wrong = p.slice(2, 4).filter(Boolean);\n'
    '      const tgt = correct.toLowerCase().replace(/[^a-z0-9]/g, "") || "x";\n'
    '      return { mcq: true, q, correct, opts: [correct, ...wrong], rawText: correct, words: [correct], wordSyllables: [[correct]], parts: [correct], e: p[4] || "❓", c: "", w: "", display: correct, speakText: p[5] || q.replace(/\\n/g, ". "), target: tgt };\n'
    '    }\n'
    '    function parseRawItem(r) {\n      if (r[0] === "?") return parseMCQ(r);\n')
# pro.js: kurikulum dinamik
rep('    const CORE_N = 31, FREE_N = 3, MAX_PROF = 5;\n', '    const CUR = window.JB_CURR || { free: 3, core: 31, sections: [] };\n    const CORE_N = CUR.core, FREE_N = CUR.free, MAX_PROF = 5;\n')
rep('    const SECTIONS = [[0, 12, "Bunyi & Suku Kata", "c1"], [12, 21, "Perkataan", "c2"], [21, 26, "Kata Kerja & Imbuhan", "c4"], [26, 31, "Ayat & Cerita", "c3"]];\n', '    const SECTIONS = CUR.sections;\n')
rep('Anda guna versi percuma (3 tahap). Buka 28 tahap lagi,', 'Anda guna versi percuma (${FREE_N} tahap). Buka ${CORE_N - FREE_N} tahap lagi,')
rep('<div class="muted">28 tahap lagi, pek cerita mingguan, pusat cetak penuh, 5 profil.</div>', '<div class="muted">${CORE_N - FREE_N} tahap lagi, pek cerita mingguan, pusat cetak penuh, ujian kelancaran, 5 profil.</div>')
rep('      $("gateOv").classList.remove("on"); openParent(gateNext);', '      $("gateOv").classList.remove("on"); if (typeof gateNext === "function") gateNext(); else openParent(gateNext);')
rep('    $("gateOk").onclick = gateGo;', '    JB.openGate = openGate;\n    $("gateOk").onclick = gateGo;')
rep('      } else $("pAff").style.display = "none";\n', '      } else $("pAff").style.display = "none";\n      if (JB.onParent) JB.onParent();\n')
rep('if (LV[i][3].length) opts.push(', 'if (LV[i][3].length && LV[i][3][0][0] !== "?") opts.push(')
# Paywall
rep('<li>✅ <b>28 tahap lagi</b>: suku kata → perkataan → imbuhan → ayat → cerita (290+ item)</li>',
    '<li>✅ <b><span data-jb="pro_n">34</span> tahap lagi</b>: suku kata KV → KVK → KVKK → bunyi khas → imbuhan → ayat → pemahaman (<span data-jb="items">360</span>+ item)</li>')
rep('<li>✅ Mod Autisme &amp; Disleksia</li>',
    '<li>✅ Mod Autisme, Disleksia &amp; <b>Pilih Jawapan</b> untuk anak belum bertutur</li>\n      <li>✅ <b>Ujian penempatan</b> &amp; <b>ujian kelancaran 1 minit</b> dengan graf kemajuan</li>')
# HTML overlay + skrip v2
rep('  <div id="toast"></div>\n', '  <div id="toast"></div>\n' + R("pro2.html"))
rep('</body>\n</html>', R("pro2.js") + '</body>\n</html>')
open(APP, "w", encoding="utf-8").write(s)
print("v2 dipasang", len(s))
