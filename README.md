# Jom Baca! Pro + Sistem Jualan Auto Multi-Agen

Satu sistem lengkap yang menjual **Jom Baca! Pro** (RM20) setiap hari:

- **Produk** dinaik taraf: 40 tahap ikut pola KV → KVK → KVKK (seperti di sekolah), mod Autisme / Disleksia / Ketik Jawapan, ujian penempatan & kelancaran, Misi Harian, Ruang Ibu Bapa, Pusat Cetak, 5 profil, offline, pek cerita mingguan, lesen.
- **HQ** (Cloudflare Worker + D1): laman jualan dengan A/B automatik, checkout ToyyibPay, lesen, leads, affiliate, auto-post, emel nurture, papan admin.
- **Otak** (8 agen AI di Modal + GitHub Actions, boleh disambung ke Hermes): merancang, menulis kandungan, video Flow, promo, follow-up lead, affiliate, produk, dan **belajar daripada data setiap malam**.

```
                     ┌───────────────────────── OTAK (Modal cron setiap jam / GitHub Actions sandaran) ─────────────────────────┐
                     │  06:00 CEO → 07:00 Social → 08:00 Creative → 09:00 Marketing → 10:00 & 19:00 Leads → 23:00 Reflect       │
                     │  Isnin 11:00 Affiliate · Rabu 14:00 Product        LLM: Gemini (percuma) · Claude · Hermes (pilihan)    │
                     └───────────────▲──────────────────────────────────────────────────────────────┬───────────────────────────┘
                          baca state │                                                               │ tulis tindakan (berpengawal)
┌────────────────────────────────────┴───────────────────────────────────────────────────────────────▼───────────────────────────┐
│ HQ: Cloudflare Worker + D1                                                                                                     │
│  /            laman jualan (A/B Thompson sampling, promo, kupon)   /app/   Jom Baca Pro (PWA)                                  │
│  /api/checkout → ToyyibPay → callback → lesen + emel + komisen     /admin  papan pemuka & "Tugas Saya"                        │
│  /s/:id /r/:kod /b/:sumber /e/:id  pautan jejak → atribusi jualan ke post, sudut, varian, affiliate, emel                     │
│  cron 15 min: auto-post Threads/FB/Telegram · emel nurture · ringkasan Telegram 22:00                                          │
└──────────────▲──────────────────────────────────────────────▲─────────────────────────────────────────▲───────────────────────┘
               │ Google Flow (3 akaun): /api/flow/next & done  │ Hermes Agent (Telegram): skill jombaca-hq │ Anda: 15 min sehari
```

## Bagaimana sistem "self-improve"

| Gelung | Apa yang berlaku | Automatik? |
|---|---|---|
| **A/B laman jualan** | Setiap lawatan pilih headline/sub/CTA guna Thompson sampling. Yang menghasilkan lebih lead dan jualan lebih kerap dipapar. Agen Marketing bersarakan varian kalah (p_best < 5%, ≥150 paparan) dan cipta pencabar baharu. | Ya |
| **Sudut kandungan** | Setiap post ada pautan jejak `/s/ID`. Klik, lead dan jualan dikreditkan kepada post dan sudutnya. Agen Social pilih sudut guna bandit (70% eksploit, 30% cuba sudut baharu). Reflect jeda sudut yang gagal. | Ya |
| **Memori pasukan** | Reflect (23:00) baca data, tulis *pelajaran berbukti*, naikkan skor yang berulang, bersarakan yang salah. Semua agen baca memori ini setiap kali bertindak. | Ya |
| **Prompt berkembang** | Reflect boleh menulis semula panduan prompt agen Social/Marketing/Creative bila ada bukti. Versi lama disimpan; boleh dimatikan di admin. | Ya |
| **Produk** | Telemetri tanpa nama (tahap mana anak tersangkut, perkataan paling sukar, kadar paywall → beli). Agen Product tulis pek cerita mingguan (disemak keselamatan oleh LLM kedua) dan cadangan ciri (juga sebagai GitHub Issue). | Pek: ya. Kod: anda lulus |
| **Emel nurture** | Klik setiap emel dijejak. Setiap Ahad agen Marketing menulis semula 5 template berdasarkan data. | Ya |
| **Arahan anda** | Admin → 🧠 Otak AI → "Arahan pemilik". Ia keutamaan tertinggi untuk semua agen. | Anda |

**Pengawal** (tak boleh dilanggar agen): harga tak boleh bawah `floor_sen` (lalai RM15), maks 1 promo setiap 4 hari, had post sehari, tiada testimoni atau angka palsu, tiada dakwaan rawatan autisme/disleksia, Bahasa Malaysia (bukan Indonesia), varian hanya dibersarakan bila cukup data.

## Kos

| Komponen | Pelan | Kos |
|---|---|---|
| Cloudflare Workers + D1 (+R2 pilihan) | Free | RM0 (100k permintaan/hari, D1 5GB) |
| Gemini API | Free tier (AI Studio) | RM0. Agen guna kira-kira 8 panggilan sehari |
| Modal | Starter, kredit $30/bulan | RM0. Cron setiap jam guna < $1 sebulan |
| GitHub Actions | Free | RM0 |
| Brevo (emel) | Free | RM0 (300 emel/hari) |
| ToyyibPay | Ikut transaksi | Caj FPX kecil setiap jualan |
| Claude API / Hermes via OpenRouter | Pilihan | Ikut guna. Tidak wajib |

> Nota: langganan **Gemini Pro** dan **Claude.ai** tidak termasuk kredit API. Kunci Gemini API percuma diambil berasingan di AI Studio.

## ⚡ Cara pantas: Quick Edit (5 minit, tanpa GitHub)

D1 `jombaca` (skema & data awal sudah dimasukkan) dan R2 `jombaca-media` **sudah dicipta** dalam akaun Cloudflare anda.

1. Dashboard → **Workers & Pages → Create → Create Worker** → nama `jombaca` → Deploy.
2. **Edit code** → padam semua → tampal isi `dist/jombaca-worker.js` → **Deploy**.
3. Worker → **Settings → Bindings → Add**:
   - D1 database: nama pemboleh ubah `DB` → pilih `jombaca`
   - R2 bucket: nama pemboleh ubah `MEDIA` → pilih `jombaca-media`
4. **Settings → Triggers → Cron Triggers → Add** → `*/15 * * * *`
5. **Settings → Variables and Secrets** → tambah Secret `ADMIN_KEY` dan `BRAIN_KEY` (dan yang lain bila sedia, lihat langkah 3 hingga 7 di bawah).
6. Buka `https://jombaca.uyin-85.workers.dev/admin` ✅

Bila kod dikemas kini: jalankan `node tools/build-quickedit.mjs` (atau minta Claude) dan tampal semula `dist/jombaca-worker.js`.

---

## Setup langkah demi langkah melalui GitHub (deploy auto setiap kali kod berubah)

### 1. GitHub
1. Cipta repo baharu (cth `jombaca-system`, **private**).
2. Muat naik semua fail dalam folder ini (Add file → Upload files, seret seluruh folder).

### 2. Cloudflare (HQ)
1. D1 dan R2 sudah dicipta dan ID sudah dalam `wrangler.toml`. Jika Worker `jombaca` sudah dibuat melalui Quick Edit, padam dahulu atau guna nama lain.
2. Dashboard → **Workers & Pages → Create → Import a repository** → pilih repo → Deploy. Jadual pangkalan data dicipta automatik pada permintaan pertama.
3. Worker → **Settings → Variables and Secrets → Add** (jenis *Secret*):
   - `ADMIN_KEY`: kata laluan admin (panjang & rawak)
   - `BRAIN_KEY`: kunci untuk agen (rawak, cth 40 aksara)
   - `FLOW_KEY`: kunci untuk sambungan Google Flow (pilihan)
4. Buka `https://jombaca.uyin-85.workers.dev/admin` → masukkan ADMIN_KEY. ✅

### 3. Pembayaran: ToyyibPay
1. Daftar di toyyibpay.com → cipta **Category** → salin *Category Code* dan *User Secret Key*.
2. Tambah secret `TOYYIB_SECRET` dan `TOYYIB_CATEGORY`.
3. Uji dahulu: daftar di dev.toyyibpay.com, guna kunci sandbox, dan set `TOYYIB_SANDBOX = "1"` dalam `wrangler.toml`. Buat satu pembelian ujian. Tukar kembali ke `"0"` bila sedia.
4. Sebelum ToyyibPay disetup, pesanan masuk sebagai "manual": anda dapat notifikasi Telegram, dan boleh tekan **Tanda dibayar** di admin → Jualan untuk hantar lesen.

### 4. Emel: Brevo (percuma)
1. Daftar brevo.com → **Senders** → sahkan emel pengirim.
2. SMTP & API → cipta API key → secret `BREVO_API_KEY`.
3. Admin → Tetapan → `email_from` = `Jom Baca <emel@yang-disahkan>` → Simpan → "Hantar emel ujian".

### 5. Telegram (notifikasi kepada anda)
1. Telegram → @BotFather → `/newbot` → salin token → secret `TELEGRAM_BOT_TOKEN`.
2. Hantar apa-apa mesej kepada bot anda, kemudian dapatkan chat ID anda (cth melalui @userinfobot) → secret `TELEGRAM_CHAT_ID`.
3. (Pilihan) Saluran Telegram untuk auto-post: tambah bot sebagai admin saluran → secret `TELEGRAM_CHANNEL_ID` (cth `@jombaca`).

### 6. Otak AI
1. Kunci Gemini percuma: https://aistudio.google.com/apikey
2. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `HQ_URL` = `https://jombaca.<subdomain>.workers.dev`
   - `BRAIN_KEY` = sama seperti di Cloudflare
   - `GEMINI_API_KEY`
   - (pilihan) `ANTHROPIC_API_KEY` untuk copy berkualiti lebih tinggi daripada Claude
   - (pilihan) `OPENAI_COMPAT_BASE`, `OPENAI_COMPAT_KEY`, `OPENAI_COMPAT_MODEL` untuk model Hermes 4 melalui OpenRouter/Nous Portal
   - (pilihan) `GH_ISSUES_TOKEN`: token GitHub supaya cadangan produk dari Modal dibuka sebagai Issue
3. **Modal**: daftar modal.com → Settings → API Tokens → New token → tambah GitHub secrets `MODAL_TOKEN_ID` dan `MODAL_TOKEN_SECRET`.
4. GitHub → **Actions → "Deploy otak ke Modal" → Run workflow**. Ia salin rahsia ke Modal dan deploy cron setiap jam.
5. Uji: Actions → **"Otak Jom Baca" → Run workflow** → agent = `ceo`. Semak admin → 🧠 Otak AI → Larian agen.

GitHub Actions juga menjalankan otak setiap jam sebagai sandaran. Selamat dijalankan serentak dengan Modal kerana setiap agen "claim" slotnya di HQ dan hanya berjalan sekali.

### 7. Auto-post (pilihan, satu demi satu)
- **Threads**: aplikasi Meta dengan Threads API → `THREADS_USER_ID`, `THREADS_TOKEN` (token tahan lama).
- **Facebook Page**: `FB_PAGE_ID`, `FB_PAGE_TOKEN` (Page access token).
- Tanpa kunci ini, post platform itu masuk ke **Tugas Saya** untuk anda salin dan tampal.
- TikTok/Reels/Shorts sentiasa manual (skrip disediakan). Letak pautan bio `https://…/b/tiktok`, `/b/reels`, `/b/shorts` supaya jualan dijejak.

### 8. Google Flow (3 akaun)
- Agen Creative mengisi giliran video setiap pagi ikut baki kredit (`flow_credits_month` 1000 × 3 akaun, `flow_cost` 20 kredit/video; ubah di Tetapan ikut harga Flow semasa).
- **Manual**: Admin → 🎬 Flow → Salin prompt → jana di Flow → muat turun → muat naik ke tempat awam (R2/Drive) → "Siap (URL)". Post auto dijadualkan.
- **Auto** (sambungan Chrome / flow-mcp anda): `GET /api/flow/next?account=A` dengan header `x-flow-key`, kemudian `POST /api/flow/done {"id":..,"video_url":".."}`. Dengan R2 di-bind sebagai `MEDIA`, video boleh dimuat naik terus: `POST /api/media` (badan = fail mp4).
- Watak dijana sebagai animasi (Momo si monyet), bukan kanak-kanak sebenar. Teks atas skrin ditambah di CapCut (`overlay_text_for_editor`).

### 9. Hermes Agent (pilihan): "berbual dengan syarikat anda"
1. Pasang Hermes Agent (https://hermes-agent.nousresearch.com), sambung ke Telegram.
2. Salin folder `hermes/skills/jombaca-hq` ke folder skills Hermes. Tetapkan `HQ_URL` dan `BRAIN_KEY` dalam persekitaran Hermes.
3. Tanya di Telegram: *"Macam mana jualan minggu ni?"*, *"Buat promo Hari Guru 20% 48 jam"*, *"Ingat: jangan guna perkataan genius."*
4. Hermes boleh guna Modal sebagai terminal backend dan cron terbina dalamnya untuk laporan malam.

---

## Rutin harian anda (15 hingga 20 minit)

Buka **/admin → ✅ Tugas Saya**:
1. **Post manual**: 2 hingga 3 skrip TikTok/Reels. Rakam skrin app + suara anda, atau guna klip Flow. Tekan "Sudah post".
2. **Lead panas**: tekan WhatsApp (mesej sudah ditulis agen), hantar secara peribadi, tekan "Tanda dihubungi".
3. **Cadangan agen**: terima atau tolak.
4. **🧪 Pengguji**: tonton 2 video yang dihantar, tekan Luluskan (jadi Pro seumur hidup) atau Tolak dengan sebab.
5. Mingguan: bayar komisen affiliate (Affiliate → Tanda dibayar).

**🛡️ Pengawas** dalam Worker menyemak sistem setiap jam (otak AI berhenti, ralat agen, emel/post gagal, ralat bayaran, ralat pelayan, sandbox tertinggal, video pengguji menunggu) dan menghantar amaran Telegram. Status penuh di kad atas /admin → Ringkasan. Matikan dengan tetapan `tg_alerts = 0`.

Pagi 06:00 anda terima pelan CEO di Telegram, dan 22:00 ringkasan jualan.

## Agen & jadual (waktu Malaysia)

| Agen | Bila | Tugas |
|---|---|---|
| CEO | 06:00 setiap hari | Semak data, tetapkan fokus & arahan setiap agen, tugasan untuk anda, ringkasan Telegram |
| Social | 07:00 | Post hari ini (Threads, FB, Telegram auto; skrip TikTok/Reels), pilih sudut guna bandit |
| Creative | 08:00 | Konsep video Google Flow ikut baki kredit 3 akaun |
| Marketing | 09:00 (Ahad + emel) | Varian A/B, promo kupon (berpengawal), template emel nurture |
| Leads | 10:00 & 19:00 | Skor lead, tulis mesej WhatsApp peribadi |
| Affiliate | Isnin 11:00 | Bahan swipe, emel affiliate, idea rekrut |
| Product | Rabu 14:00 | Pek cerita baharu (semakan keselamatan), cadangan ciri |
| Reflect | 23:00 | Analisis, pelajaran, kemas kini prompt, jeda sudut gagal |

## Corong jualan

1. Kandungan (agen + anda) → pautan jejak → **laman jualan** (demo suku kata interaktif, A/B).
2. Belum sedia? → **Jadual Suku Kata percuma** (lead magnet) → 5 emel nurture (hari 0, 1, 3, 5, 7; hari ke-7 kupon peribadi RM3, 48 jam) + mesej WhatsApp daripada anda.
3. Cuba app percuma (3 tahap) → paywall bila habis → beli.
4. Checkout tak selesai → emel peringatan selepas 1 jam + masuk senarai WhatsApp panas.
5. Pembeli → lesen + **auto jadi affiliate** (40% komisen) → pembeli kongsi → jualan baharu.

## Fail

```
public/                 laman awam (static assets)
  index.html            laman jualan
  app/                  Jom Baca! Pro (PWA): index.html, sw.js, manifest, ikon
  terima-kasih.html     lesen selepas bayar
  affiliate.html        daftar & papan affiliate
  kad-percuma.html      lead magnet: Jadual Suku Kata
  privasi.html          privasi & terma (semak & sesuaikan)
src/worker.js           HQ: API, pembayaran, cron, auto-post, emel
src/admin.html          papan admin
src/content/core.json   28 tahap Pro (tidak didedahkan secara awam; dihantar selepas lesen sah)
brain/                  agen AI (Python stdlib) + modal_app.py
hermes/skills/          skill untuk Hermes Agent
.github/workflows/      otak setiap jam + deploy ke Modal
```

## Nota jujur

- **Trafik awal datang daripada anda.** Sistem ini menggandakan apa yang berfungsi, tetapi perlukan kandungan dan pengedaran pada minggu-minggu pertama (TikTok, kumpulan FB ibu bapa, cikgu tadika). Jangkakan 2 hingga 4 minggu untuk agen mengumpul data yang cukup sebelum A/B dan bandit benar-benar "pandai".
- **"Nilai RM1,000"** di laman jualan ialah *anggaran nilai* setiap komponen, berbanding kos tuisyen sebenar. Ubah angka di `public/index.html` jika anda rasa perlu. Jangan papar "harga asal" yang tidak pernah dikenakan.
- **Jaminan wang dikembalikan** dimatikan secara lalai (`guarantee_days = 0`). Hidupkan hanya jika anda sanggup refund; ia biasanya menaikkan kadar tukar.
- **Pengecaman suara** paling baik di Chrome. Safari/iOS terhad, tetapi butang "tandakan betul" dan kuiz tetap berfungsi.
- **WhatsApp**: sistem *tidak* menghantar WhatsApp secara pukal (risiko akaun disekat). Agen menulis mesej, anda hantar secara peribadi.
- **PDPA**: borang lead ada kotak persetujuan dan setiap emel ada pautan berhenti langgan. Semak `privasi.html`.
- **Google Flow 3 akaun**: semak terma Google tentang penggunaan berbilang akaun percuma.
- **Lesen**: 28 tahap Pro hanya dihantar dari server selepas lesen disahkan (HMAC), had 5 peranti, refund membatalkan lesen.
- Testimoni di laman jualan hanya muncul selepas anda masukkan testimoni **sebenar** di admin → Produk.

## Ujian tempatan (untuk pembangun)

```bash
npm install && printf 'ADMIN_KEY=a\nBRAIN_KEY=b\n' > .dev.vars && npx wrangler dev
HQ_URL=http://127.0.0.1:8787 BRAIN_KEY=b BRAIN_FAKE_LLM=1 python -m brain.run all   # paip agen tanpa kunci LLM
HQ_URL=http://127.0.0.1:8787 BRAIN_KEY=b BRAIN_DRY=1 GEMINI_API_KEY=... python -m brain.run agent social   # LLM sebenar, tanpa menulis
```

## Log perubahan

- **v2.4 (26 Okt 2026):** agen Sosial kini melukis **kad gambar** (1080×1350) dan **video hook** (1080×1920, suara ms-MY) secara automatik di Modal (Chromium + ffmpeg, templat berjenama, tiada AI imej). Auto-post ke **Instagram** (gambar & Reels) melalui token FB Page. Threads & FB Page disambung dengan tampal token di /admin → Tetapan → Media sosial.
- **v2.3 (25 Okt 2026):** pengguji dapat Pro percubaan 10 hari dan wajib muat naik 2 video (anak guna app + testimoni) di /pengguji-hantar; pemilik semak & luluskan di /admin → 🧪 Pengguji. Video disimpan peribadi dalam R2 (pautan bertandatangan, dipadam auto selepas `video_keep_days`). Pengawas sistem + amaran Telegram.
- **v2.2:** program 10 pengguji awal, had 3 peranti setiap lesen, reset peranti melalui emel, testimoni dengan izin.
- **v2.1 (25 Okt 2026):** kurikulum 40 tahap ikut pola KV → KVK → KVKK, mod Autisme/Disleksia/Ketik Jawapan, permainan bunyi, soalan pemahaman, ujian penempatan & kelancaran.
- **v2.0.1:** pembetulan Bahasa Melayu (sapi → satu, jidar → jiran, dll.), suara ms-MY diutamakan.
- **v2.0:** Jom Baca Pro + HQ + otak multi-agen.
