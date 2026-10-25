
  <script>
  /* ===== JOM BACA v2: mod tekan jawapan, soalan pilihan, fon & latar, pemasa rehat, onboarding, ujian penempatan & kelancaran ===== */
  (function () {
    const CUR = window.JB_CURR;
    const ev = (n, d) => { try { JB.ev(n, d); } catch (e) {} };
    const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const shuffle = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
    const COLS = ["#ef3f5c", "#2f7df6", "#17b26a"];
    const colored = w => w.split(" ").map(word => word.split("-").map((s, i) => `<span style="color:${COLS[i % 3]}">${esc(s)}</span>`).join("")).join(" ");
    const dkey = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

    document.querySelectorAll("[data-jb=pro_n]").forEach(e => e.textContent = CUR.core - CUR.free);
    document.querySelectorAll("[data-jb=items]").forEach(e => e.textContent = Math.floor(CUR.items / 10) * 10);

    /* ---------- Fon & warna latar ---------- */
    const _ac = applyCfg;
    applyCfg = function () {
      _ac();
      const b = document.body.classList;
      b.toggle("f-lexend", CFGS.font === "lexend"); b.toggle("f-atk", CFGS.font === "atk");
      ["cream", "blue", "yellow"].forEach(c => b.toggle("bg-" + c, CFGS.bg === c));
    };
    applyCfg();

    /* ---------- Mod tekan jawapan & soalan pilihan ---------- */
    const tb = document.createElement("div"); tb.id = "tapBox"; $("word").insertAdjacentElement("afterend", tb);
    const labelOf = it => it.mcq ? it.correct : (it.w ? it.rawText : it.display);
    function distractors(it, n) {
      const mine = labelOf(it), out = [], longMine = mine.length > 14;
      const pools = [LV[L] && LV[L][3], L > 0 && LV[L - 1][3], LV[L + 1] && LV[L + 1][3]].filter(p => p && p.length);
      for (const pool of pools) for (const r of shuffle(pool.slice())) {
        if (r[0] === "?") continue;
        const lb = labelOf(parseRawItem(r));
        if (lb !== mine && !out.includes(lb) && (lb.length > 14) === longMine) out.push(lb);
        if (out.length >= n) return out;
      }
      return out;
    }
    let tapLock = false;
    function renderTap() {
      const it = item(); tapLock = false;
      const opts = it.mcq ? shuffle(it.opts.slice()) : shuffle([labelOf(it), ...distractors(it, 2)]);
      tb.className = "on" + (opts.some(o => o.length > 10) ? " one" : opts.length === 2 ? " two" : "");
      tb.innerHTML = "";
      const right = it.mcq ? it.correct : labelOf(it);
      opts.forEach(o => { const b = document.createElement("button"); b.className = "tapo"; b.textContent = o; b.onclick = () => pick(b, o === right, it); tb.appendChild(b); });
    }
    function pick(btn, okk, it) {
      if (tapLock || inQuiz) return; tapLock = true;
      const atL = L, atI = idx;
      logT(it.target, ["(tekan) " + btn.textContent], okk);
      if (okk) {
        btn.classList.add("correct");
        if (it.mcq) ok = Math.max(ok, 2);
        good();
        if (ok < 3) setTimeout(() => { if (!inQuiz && L === atL && idx === atI) renderTap(); }, 900);
      } else {
        btn.classList.add("wrong"); bad(false);
        setTimeout(() => { btn.classList.remove("wrong"); tapLock = false; }, 800);
      }
    }
    const _show = show;
    show = function () {
      _show();
      const it = item(), tapMode = it.mcq || !!CFGS.tap;
      $("mic").style.display = tapMode ? "none" : "";
      if (it.mcq) {
        const parts = it.q.split("\n"), qst = parts.pop(), psg = parts.join(" ");
        $("word").className = "mcq";
        $("word").innerHTML = (psg ? `<span class="psg">${esc(psg)}</span>` : "") + `<span class="qst">${esc(qst)}</span>`;
        $("clue").textContent = ""; $("gd").textContent = "";
        setPic(it.e);
        say(psg ? "Baca cerita 👀 kemudian tekan jawapan 👇" : "Dengar soalan 👂 kemudian tekan jawapan 👇");
        if (CFGS.readfirst && !psg) setTimeout(demo, 450);
      } else if (CFGS.tap) {
        say("Dengar 👂 kemudian tekan jawapan yang betul 👇 (3 kali)");
      }
      if (tapMode) renderTap(); else { tb.className = ""; tb.innerHTML = ""; }
    };
    const _demo = demo;
    demo = async function () {
      const it = !inQuiz && item();
      if (it && it.mcq) { const my = ++dtok; try { speechSynthesis.cancel(); } catch (e) {} await playOne("", it.speakText); return my === dtok; }
      return _demo();
    };
    $("say").onclick = () => demo(); $("fallback-emoji").onclick = () => demo();
    let mcqDone = false;
    const _sq = startQuiz;
    startQuiz = function () {
      if (LV[L] && LV[L][3].length && LV[L][3].every(r => r[0] === "?")) { mcqDone = true; finishQuiz(); return; }
      tb.className = ""; _sq();
    };
    $("qzBtn").onclick = () => startQuiz();
    const _fq2 = finishQuiz;
    finishQuiz = function () {
      _fq2(); tb.className = ""; tb.innerHTML = "";
      if (mcqDone) { $("word").innerHTML = "Tahap selesai! 🎉"; mcqDone = false; }
    };

    /* ---------- Pemasa rehat ---------- */
    let sessSec = 0, restShown = false, lastAct = Date.now();
    ["pointerdown", "keydown"].forEach(e => addEventListener(e, () => { lastAct = Date.now(); }, { passive: true }));
    setInterval(() => {
      if (!CFGS.timer || restShown) return;
      const learning = $("start").style.display === "none" && $("map").style.display !== "flex" && document.visibilityState === "visible" && Date.now() - lastAct < 90000;
      if (!learning) return;
      sessSec += 5;
      if (sessSec >= CFGS.timer * 60) {
        restShown = true; dtok++; auto = false;
        try { speechSynthesis.cancel(); } catch (e) {}
        if (busy) stopSess();
        $("restMsg").textContent = "Hebat! Kamu sudah belajar " + CFGS.timer + " minit. Rehat dulu, kita sambung lagi nanti.";
        $("restOv").classList.add("on"); ev("rest");
      }
    }, 5000);
    const endRest = () => { $("restOv").classList.remove("on"); sessSec = 0; restShown = false; };
    $("restDone").onclick = () => { endRest(); $("start").style.display = "flex"; };
    $("restMore").onclick = () => JB.openGate(endRest);

    /* ---------- Onboarding ---------- */
    const PRESET = {
      biasa: { calm: false, auto: true, accept: false, sched: false, readfirst: false, bigtext: false, tap: false, font: "", bg: "", rate: 1, timer: 0 },
      autisme: { calm: true, auto: false, accept: true, sched: true, timer: 10 },
      disleksia: { bigtext: true, font: "atk", bg: "cream", rate: 0.75 },
      ketik: { tap: true, auto: false, accept: true },
    };
    function applyMode(m) {
      const cfg = Object.assign({}, PRESET.biasa);
      (m === "kedua" ? ["autisme", "disleksia"] : [m]).forEach(p => Object.assign(cfg, PRESET[p] || {}));
      Object.assign(CFGS, cfg); PS.set("cfgs", JSON.stringify(CFGS)); applyCfg();
    }
    JB.applyMode = applyMode;
    let onbMode = "biasa";
    document.querySelectorAll("#onbModes .chip2").forEach(b => b.onclick = () => {
      document.querySelectorAll("#onbModes .chip2").forEach(x => x.classList.toggle("sel", x === b)); onbMode = b.dataset.m;
    });
    function renameProfile(name) {
      try {
        const P = JSON.parse(localStorage.getItem("jb_profiles") || "[]"), p = P.find(x => x.id === PS.id);
        if (p && name) { p.name = name; localStorage.setItem("jb_profiles", JSON.stringify(P)); const w = $("whoBtn"); if (w) w.textContent = p.av + " " + name + " · tukar"; }
      } catch (e) {}
    }
    const profs0 = JSON.parse(localStorage.getItem("jb_profiles") || "[]"), me = profs0.find(x => x.id === PS.id);
    if (!PS.get("onb") && !(+PS.get("stars")) && !(+PS.get("unl"))) {
      if (me && !/^Anak \d+$/.test(me.name)) $("onbName").value = me.name;
      $("onbOv").classList.add("on");
    }
    $("onbNext").onclick = () => {
      renameProfile($("onbName").value.trim().slice(0, 20));
      applyMode(onbMode); PS.set("onb", "1"); ev("onboard", { m: onbMode });
      $("onb1").style.display = "none"; $("onb2").style.display = "flex";
    };
    $("onbTest").onclick = () => { $("onbOv").classList.remove("on"); startPlacement(); };
    $("onbSkip").onclick = () => $("onbOv").classList.remove("on");

    /* ---------- Ujian penempatan ---------- */
    const CHECK = [["Suku kata KV: a", "ba"], ["Perkataan KV+KV (1)", "bo-la"], ["Perkataan KV+KV+KV", "ke-re-ta"], ["Perkataan KVK", "bas"], ["Perkataan KV+KVK", "ku-cing"], ["Perkataan KVK+KVK", "gun-ting"], ["Perkataan KVKK", "bank"], ["Vokal berganding", "la-ut"], ["ng ny kh sy", "bu-nga"], ["Imbuhan ber-", "ber-la-ri"], ["Bina ayat mudah", "saya suka makan roti"]];
    const lvIdx = n => LV.findIndex(l => l[0] === n);
    function startPlacement() {
      let k = 0; ev("placement_start");
      $("plOv").classList.add("on");
      const step = () => {
        if (k >= CHECK.length) return result(Math.max(0, lvIdx("Cerita 2 Ayat")));
        const [nm, w] = CHECK[k];
        $("plBody").innerHTML = `<div class="plstep">Perkataan ${k + 1} daripada ${CHECK.length}. Minta anak baca dengan kuat. Jangan bantu.</div><div class="plw">${colored(w)}</div>
          <div class="row" style="justify-content:center"><button class="btn2 grn" id="plYes">✅ Boleh baca</button><button class="btn2 red" id="plNo">❌ Belum boleh</button></div>`;
        $("plYes").onclick = () => { k++; step(); };
        $("plNo").onclick = () => result(k === 0 ? 0 : Math.max(0, lvIdx(nm)));
      };
      const result = target => {
        const proLock = target >= CUR.free && !JB.isPro();
        $("plBody").innerHTML = `<div style="font-size:48px">🎯</div><p style="margin:0;font-size:18px">Cadangan: mula di <b>Tahap ${target + 1}: ${esc(LV[target][0])}</b></p>
          ${proLock ? `<p class="muted" style="margin:0">Tahap ini dalam Jom Baca Pro. Versi percuma ada ${CUR.free} tahap pertama.</p>` : ""}
          <div class="row" style="justify-content:center">${proLock ? `<button class="btn2 grn" id="plPro">👑 Lihat Pro</button><button class="btn2 alt" id="plFree">Guna tahap percuma dulu</button>` : `<button class="big" id="plGo">Mula di sini</button>`}</div>`;
        ev("placement", { t: target + 1 });
        const go = t => { if (t > unl) { unl = t; sv(); } $("plOv").classList.remove("on"); if ($("start").style.display !== "none") $("go").click(); else maps(); };
        if (proLock) { $("plPro").onclick = () => { go(target); JB.openPay("placement"); }; $("plFree").onclick = () => go(Math.min(target, CUR.free - 1)); }
        else $("plGo").onclick = () => go(target);
      };
      step();
    }
    JB.startPlacement = startPlacement;

    /* ---------- Ujian kelancaran 1 minit ---------- */
    function flPool() {
      const maxI = JB.isPro() ? CUR.core : CUR.free, upto = Math.min(maxI, Math.max(unl + 1, 6), LV.length), words = [];
      for (let i = 0; i < upto; i++) for (const r of LV[i][3]) {
        if (r[0] === "?") continue;
        const it = parseRawItem(r), t = it.w ? it.rawText : it.display;
        if (/\s/.test(t) || t.length > 12 || words.includes(t)) continue;
        words.push(t);
      }
      return shuffle(words.slice(-60)).slice(0, 40);
    }
    function startFluency() {
      const words = flPool();
      $("flOv").classList.add("on"); ev("fluency_start");
      if (words.length < 8) { $("flBody").innerHTML = `<p>Belum cukup perkataan. Habiskan beberapa tahap dahulu.</p>`; return; }
      let mode = "ready", left = 60, t0 = 0, timer = null; const errs = new Set();
      const help = { ready: "Anak baca perkataan dari kiri ke kanan, baris demi baris. Ibu bapa tekan perkataan yang <b>salah</b> dibaca.", run: "Tekan perkataan yang salah dibaca…", last: "Masa tamat! Tekan perkataan <b>terakhir</b> yang anak baca." };
      $("flBody").innerHTML = `<div id="flTime">60</div><p id="flHelp" style="margin:0">${help.ready}</p><div id="flGrid">${words.map((w, i) => `<button class="flw" data-i="${i}">${esc(w)}</button>`).join("")}</div><button class="big" id="flGo">▶ Mula</button>`;
      const stopToLast = () => { clearInterval(timer); mode = "last"; $("flHelp").innerHTML = help.last; $("flGo").style.display = "none"; };
      $("flGo").onclick = () => {
        if (mode === "ready") {
          mode = "run"; t0 = Date.now(); $("flHelp").innerHTML = help.run; $("flGo").textContent = "⏹ Anak sudah habis baca";
          timer = setInterval(() => {
            if (!$("flOv").classList.contains("on")) { clearInterval(timer); return; }
            left = Math.max(0, 60 - Math.floor((Date.now() - t0) / 1000)); $("flTime").textContent = left;
            if (!left) stopToLast();
          }, 250);
        } else if (mode === "run") stopToLast();
      };
      $("flGrid").onclick = e => {
        const b = e.target.closest(".flw"); if (!b) return; const i = +b.dataset.i;
        if (mode === "run") { errs.has(i) ? errs.delete(i) : errs.add(i); b.classList.toggle("err"); }
        else if (mode === "last") {
          b.classList.add("last");
          const secs = Math.max(10, Math.min(60, (Date.now() - t0) / 1000)), right = i + 1 - [...errs].filter(x => x <= i).length;
          const wcpm = Math.max(0, Math.round(right * 60 / secs));
          const hist = JSON.parse(PS.get("flu") || "[]"), prev = hist.length ? hist[hist.length - 1].w : null;
          hist.push({ d: dkey(new Date()), w: wcpm }); PS.set("flu", JSON.stringify(hist.slice(-20)));
          ev("fluency", { w: wcpm });
          setTimeout(() => {
            $("flBody").innerHTML = `<div style="font-size:52px">📈</div><div id="flTime">${wcpm}</div><p style="margin:0;font-size:18px">perkataan betul seminit</p>
              ${prev != null ? `<p style="margin:0">${wcpm > prev ? "🎉 Naik " + (wcpm - prev) + " berbanding ujian lepas (" + prev + ")" : wcpm === prev ? "Sama seperti ujian lepas (" + prev + ")" : "Ujian lepas: " + prev + ". Biasa naik turun, teruskan latihan harian."}</p>` : ""}
              <p class="muted" style="margin:0">Ulang ujian ini seminggu sekali pada waktu yang sama untuk lihat kemajuan sebenar.</p>
              <button class="big" id="flClose">Selesai</button>`;
            $("flClose").onclick = () => $("flOv").classList.remove("on");
          }, 500);
        }
      };
    }
    JB.startFluency = startFluency;

    /* ---------- Kad dalam Ruang Ibu Bapa ---------- */
    JB.onParent = function () {
      let c = $("pFlu");
      if (!c) { c = document.createElement("div"); c.className = "pcard"; c.id = "pFlu"; $("pKpis").parentNode.insertAdjacentElement("afterend", c); }
      const hist = JSON.parse(PS.get("flu") || "[]").slice(-8), mx = Math.max(10, ...hist.map(h => h.w));
      c.innerHTML = `<h3>📈 Kelancaran &amp; penempatan</h3><p class="muted" style="margin-top:0">Ujian kelancaran 1 minit: berapa perkataan anak baca dengan betul dalam seminit. Buat seminggu sekali.</p>
        ${hist.length ? `<div class="flbars">${hist.map(h => `<div><span>${h.w}</span><i style="height:${Math.round(100 * h.w / mx)}%"></i><span>${h.d.slice(5)}</span></div>`).join("")}</div>` : `<p class="muted">Belum ada rekod.</p>`}
        <div class="row" style="margin-top:8px"><button class="btn2" id="pFl">⏱️ Ujian kelancaran</button><button class="btn2 alt" id="pPl">🧭 Ujian penempatan</button></div>`;
      $("pFl").onclick = () => { $("parOv").classList.remove("on"); startFluency(); };
      $("pPl").onclick = () => { $("parOv").classList.remove("on"); startPlacement(); };
    };
  })();
  </script>
