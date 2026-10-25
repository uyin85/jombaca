"""Sumber tunggal kurikulum Jom Baca! (40 tahap, ikut pola suku kata KV → KVK → KVKK).

Perkataan, ayat dan soalan di sini ditulis sendiri. Urutan pola suku kata ialah kaedah umum
pengajaran bacaan Bahasa Melayu di Malaysia.

Format item:
  "suku|emoji|petunjuk|con-toh"     huruf / suku kata dengan perkataan contoh
  "su-ku-ka-ta🙂"                    perkataan (suku kata dipisah '-'), emoji di hujung
  "ayat biasa😀"                     ayat
  "?soalan|betul|salah1|salah2|emoji|teks sebutan(pilihan)"   soalan pilihan (main bunyi / pemahaman)

Jalankan:  python3 tools/curriculum.py   → kemas kini src/content/core.json & public/app/index.html
"""
import json
import os
import re

FREE_N = 6  # tahap percuma: Huruf (5) + Suku kata KV: a

S = []  # [tajuk bahagian, warna, [tahap...]]


def sec(title, color):
    S.append([title, color, []])


def lv(name, en, icon, items):
    S[-1][2].append([name, en, icon, items])


# ------------------------------------------------------------------ 1. Huruf
sec("Huruf", "c1")
lv("Huruf vokal", "Vowels", "🔤", ["a|🐔|a untuk ayam|a-yam", "i|🐟|i untuk ikan|i-kan", "u|🐍|u untuk ular|u-lar", "e|🍎|e untuk epal|e-pal", "o|🍊|o untuk oren|o-ren"])
lv("Huruf kecil (1)", "Small letters 1", "🔡", ["b|⚽|b untuk bola|bo-la", "c|☕|c untuk cawan|ca-wan", "d|🎲|d untuk dadu|da-du", "f|📁|f untuk fail|fa-il", "g|🐘|g untuk gajah|ga-jah", "h|🐯|h untuk harimau|ha-ri-mau", "j|☝️|j untuk jari|ja-ri", "k|🐴|k untuk kuda|ku-da", "l|🕯️|l untuk lilin|li-lin"])
lv("Huruf kecil (2)", "Small letters 2", "🔡", ["m|👁️|m untuk mata|ma-ta", "n|🍍|n untuk nanas|na-nas", "p|☂️|p untuk payung|pa-yung", "r|🏠|r untuk rumah|ru-mah", "s|🥛|s untuk susu|su-su", "t|🎩|t untuk topi|to-pi", "w|🪁|w untuk wau|wau", "y|🦈|y untuk yu|yu", "z|🦒|z untuk zirafah|zi-ra-fah"])
lv("Huruf besar", "Capital letters", "🔠", ["A|🐔|A besar, a kecil|a-yam", "B|⚽|B besar, b kecil|bo-la", "C|☕|C besar, c kecil|ca-wan", "I|🐟|I besar, i kecil|i-kan", "K|🐴|K besar, k kecil|ku-da", "M|👁️|M besar, m kecil|ma-ta", "S|🥛|S besar, s kecil|su-su", "U|🐍|U besar, u kecil|u-lar"])
lv("Huruf keliru: b d p", "Tricky letters b d p", "🔍", ["b|⚽|b untuk bola|bo-la", "d|🎲|d untuk dadu|da-du", "p|☂️|p untuk payung|pa-yung", "b|📕|b untuk buku|bu-ku", "d|🦖|d untuk dinosaur|di-no-sa-ur", "p|🍌|p untuk pisang|pi-sang", "m|👁️|m untuk mata|ma-ta", "n|🍍|n untuk nanas|na-nas"])

# ------------------------------------------------------------------ 2. Suku kata & perkataan terbuka
sec("Suku Kata KV & Perkataan Terbuka", "c2")
lv("Suku kata KV: a", "Syllables CV: a", "🅰️", ["ba|🧺|ba untuk bakul|ba-kul", "ca|☕|ca untuk cawan|ca-wan", "da|🍃|da untuk daun|da-un", "ga|🐘|ga untuk gajah|ga-jah", "ka|👟|ka untuk kasut|ka-sut", "la|🪰|la untuk lalat|la-lat", "ma|👁️|ma untuk mata|ma-ta", "na|🍍|na untuk nanas|na-nas", "pa|☂️|pa untuk payung|pa-yung", "ra|👑|ra untuk raja|ra-ja", "sa|🥬|sa untuk sayur|sa-yur", "ta|✋|ta untuk tangan|ta-ngan"])
lv("Suku kata KV: i", "Syllables CV: i", "ℹ️", ["bi|👄|bi untuk bibir|bi-bir", "ci|🦎|ci untuk cicak|ci-cak", "di|🦖|di untuk dinosaur|di-no-sa-ur", "gi|🦷|gi untuk gigi|gi-gi", "hi|👃|hi untuk hidung|hi-dung", "ji|🏘️|ji untuk jiran|ji-ran", "ki|🥝|ki untuk kiwi|ki-wi", "li|🕯️|li untuk lilin|li-lin", "mi|🍜|mi untuk mihun|mi-hun", "pi|🍌|pi untuk pisang|pi-sang", "si|🐌|si untuk siput|si-put", "ti|🐭|ti untuk tikus|ti-kus"])
lv("Suku kata KV: u", "Syllables CV: u", "⛎", ["bu|🌙|bu untuk bulan|bu-lan", "cu|👶|cu untuk cucu|cu-cu", "du|💰|du untuk duit|du-it", "gu|🍬|gu untuk gula|gu-la", "hu|🌧️|hu untuk hujan|hu-jan", "ku|🐴|ku untuk kuda|ku-da", "lu|🕳️|lu untuk lubang|lu-bang", "mu|😀|mu untuk muka|mu-ka", "nu|🦜|nu untuk nuri|nu-ri", "pu|🏝️|pu untuk pulau|pu-lau", "ru|🏠|ru untuk rumah|ru-mah", "su|🥛|su untuk susu|su-su", "tu|🧕|tu untuk tudung|tu-dung"])
lv("Suku kata KV: e", "Syllables CV: e", "📧", ["be|🍚|be untuk beras|be-ras", "ce|🍒|ce untuk ceri|ce-ri", "de|🏛️|de untuk dewan|de-wan", "ge|🥛|ge untuk gelas|ge-las", "he|🦅|he untuk helang|he-lang", "ke|🪑|ke untuk kerusi|ke-ru-si", "le|🐝|le untuk lebah|le-bah", "me|🟥|me untuk merah|me-rah", "ne|👵|ne untuk nenek|ne-nek", "pe|⛵|pe untuk perahu|pe-ra-hu", "se|🐜|se untuk semut|se-mut", "te|🥚|te untuk telur|te-lur"])
lv("Suku kata KV: o", "Syllables CV: o", "⭕", ["bo|⚽|bo untuk bola|bo-la", "co|🍫|co untuk coklat|co-klat", "do|🤲|do untuk doa|do-a", "go|🦍|go untuk gorila|go-ri-la", "ho|🏨|ho untuk hotel|ho-tel", "ko|📦|ko untuk kotak|ko-tak", "lo|🚚|lo untuk lori|lo-ri", "mo|🏍️|mo untuk motor|mo-tor", "no|🎵|no untuk nota|no-ta", "po|🌳|po untuk pokok|po-kok", "ro|🍞|ro untuk roti|ro-ti", "so|🦑|so untuk sotong|so-tong", "to|🎩|to untuk topi|to-pi", "yo|🪀|yo untuk yoyo|yo-yo"])
lv("Perkataan KV+KV (1)", "CV+CV words 1", "🧩", ["bo-la⚽", "bu-ku📕", "ba-ju👕", "ro-ti🍞", "ma-ta👁️", "ka-ki🦶", "ku-da🐴", "sa-tu1️⃣", "da-du🎲", "to-pi🎩"])
lv("Perkataan KV+KV (2)", "CV+CV words 2", "🧩", ["ke-ju🧀", "mu-ka😀", "pa-ku📌", "ba-tu🪨", "ja-ri☝️", "ku-ku💅", "ko-pi☕", "te-bu🎋", "pe-ta🗺️", "bi-ji🌰", "pi-pi😊", "gi-gi🦷"])
lv("Perkataan KV+KV (3)", "CV+CV words 3", "🧩", ["ta-li🪢", "la-gu🎵", "ha-ti❤️", "ro-da🛞", "so-fa🛋️", "ke-ra🐒", "ba-ta🧱", "ko-ta🏙️", "pa-ha🦵", "bu-lu🪶", "lo-ri🚚", "gu-la🍬"])
lv("Main bunyi", "Sound games", "👂", [
    "?Buang 'bo' daripada 'bola'. Tinggal apa?|la|bo|ba|⚽|Buang bo daripada bola. Tinggal apa?",
    "?Buang 'ku' daripada 'buku'. Tinggal apa?|bu|ku|ba|📕|Buang ku daripada buku. Tinggal apa?",
    "?ba + ju = ?|baju|biji|buju|👕|ba, tambah ju, jadi apa?",
    "?ma + ta = ?|mata|kata|meta|👁️|ma, tambah ta, jadi apa?",
    "?Berapa suku kata dalam 'kereta'?|3|2|4|🚗|Berapa suku kata dalam kereta? Tepuk tangan sambil sebut.",
    "?Berapa suku kata dalam 'roti'?|2|1|3|🍞|Berapa suku kata dalam roti?",
    "?Tukar 'ba' dalam 'batu' kepada 'ra'. Jadi apa?|ratu|batu|rata|👑|Tukar ba dalam batu kepada ra. Jadi apa?",
    "?Perkataan mana bermula dengan 'ku'?|kuda|bola|mata|🐴|Perkataan mana bermula dengan bunyi ku?",
    "?Perkataan mana berakhir dengan 'pi'?|topi|tali|baju|🎩|Perkataan mana berakhir dengan bunyi pi?",
])
lv("Perkataan V+KV", "V+CV words", "🔥", ["a-pi🔥", "u-bi🍠", "i-bu👩", "i-ni👇", "i-tu👉"])
lv("Perkataan KV+KV+KV", "CV+CV+CV words", "🚗", ["ke-re-ta🚗", "ka-me-ra📷", "ba-te-ri🔋", "ra-di-o📻", "ke-ru-si🪑", "pe-ra-hu⛵", "ke-la-pa🥥", "to-ma-to🍅", "pe-li-ta🪔", "go-ri-la🦍"])

# ------------------------------------------------------------------ 3. KVK
sec("Suku Kata Tertutup (KVK)", "c4")
lv("Perkataan KVK", "CVC words", "🚌", ["bas🚌", "jam⏰", "kek🍰", "pen🖊️", "tin🥫", "sup🍲", "kad💳", "van🚐", "bot🚤", "lif🛗", "pin📍", "jus🧃"])
lv("Suku kata KVK", "CVC syllables", "🔒", ["bin|⭐|bin untuk bintang|bin-tang", "lam|💡|lam untuk lampu|lam-pu", "pin|🚪|pin untuk pintu|pin-tu", "kun|🔑|kun untuk kunci|kun-ci", "sam|🛶|sam untuk sampan|sam-pan", "gun|✂️|gun untuk gunting|gun-ting", "pan|🐼|pan untuk panda|pan-da", "ban|🛏️|ban untuk bantal|ban-tal", "bom|🚒|bom untuk bomba|bom-ba", "pen|✏️|pen untuk pensel|pen-sel", "kam|🏡|kam untuk kampung|kam-pung", "sen|🥄|sen untuk senduk|sen-duk"])
lv("Perkataan V+KVK", "V+CVC words", "☁️", ["a-wan☁️", "i-kan🐟", "u-lar🐍", "a-yam🐔", "i-tik🦆", "u-dang🦐", "o-rang🧍", "a-nak👶", "u-bat💊", "a-sap💨"])
lv("Perkataan KV+KVK", "CV+CVC words", "🚢", ["ka-pal🚢", "bu-lan🌙", "ta-man🌳", "ke-bun🌱", "pi-sang🍌", "ru-mah🏠", "ku-cing🐱", "ke-tam🦀", "ma-lam🌃", "ka-sut👟", "se-mut🐜", "ti-kus🐭"])
lv("Perkataan KVK+KV", "CVC+CV words", "💡", ["lam-pu💡", "bom-ba🚒", "pin-tu🚪", "kun-ci🔑", "pas-ta🍝", "kan-ta🔍", "pan-da🐼", "sen-ja🌆"])
lv("Perkataan KVK+KVK", "CVC+CVC words", "✂️", ["sam-pan🛶", "gun-ting✂️", "kam-pung🏡", "pen-sel✏️", "rum-put🌿", "sen-duk🥄", "ban-tal🛏️", "bin-tang⭐"])
lv("Tiga suku kata dengan KVK", "3 syllables with CVC", "🚲", ["ba-si-kal🚲", "ma-ka-nan🍱", "se-ko-lah🏫", "te-le-fon📱", "ke-la-war🦇", "bu-la-tan⭕", "kom-pu-ter💻", "sem-bi-lan9️⃣", "cen-da-wan🍄", "pem-ba-ris📏", "jam-ba-tan🌉", "sem-bu-nyi🙈"])

# ------------------------------------------------------------------ 4. KVKK
sec("Suku Kata KVKK", "c6")
lv("Perkataan KVKK", "CVCC words", "🏦", ["bank🏦", "golf⛳", "teks📝", "zink🏚️"])
lv("Perkataan dengan KVKK", "Words with CVCC", "🛂", ["re-sort🏖️", "kon-sert🎤", "pas-port🛂", "im-port📦", "eks-port🚢"])

# ------------------------------------------------------------------ 5. Bunyi khas
sec("Bunyi Khas", "c7")
lv("Vokal berganding", "Vowel pairs", "💧", ["a-ir💧", "la-ut🌊", "bu-ah🍎", "da-un🍃", "ma-in⚽", "du-it💰", "ka-in🧣", "ti-up🌬️"])
lv("Diftong ai au oi", "Diphthongs", "🏖️", ["pan-tai🏖️", "ker-bau🐃", "ke-dai🏪", "pi-sau🔪", "pu-lau🏝️", "su-ngai🏞️", "gu-lai🍛", "ha-ri-mau🐯", "ka-loi🐟"])
lv("ng ny kh sy", "Digraphs", "🌸", ["bu-nga🌸", "nya-muk🦟", "khe-mah⛺", "syam-pu🧴", "si-nga🦁", "pe-nyu🐢", "kang-ga-ru🦘", "ma-ngga🥭", "akh-bar📰", "nya-nyi🎤"])
lv("Konsonan bergabung", "Consonant blends", "🚜", ["kli-nik🏥", "dra-ma🎭", "trak🚛", "skru🔩", "blok🧱", "glob🌍", "ste-sen🚉", "trak-tor🚜"])

CORE_PATH = os.path.join(os.path.dirname(__file__), "..", "src", "content", "core.json")
APP_PATH = os.path.join(os.path.dirname(__file__), "..", "public", "app", "index.html")


def load_old_core():
    return json.load(open(CORE_PATH, encoding="utf-8"))


def build():
    old = load_old_core()
    old_levels = old["levels"] if old.get("free") == 3 else None
    if old_levels is None and "imbuhan" in old:
        verbs, sentences = old["imbuhan"], old["ayat"]
    else:
        # dari kurikulum lama (31 tahap): kata kerja & imbuhan = tahap 22-26, ayat & cerita = 27-31
        verbs, sentences = old_levels[18:23], old_levels[23:28]
    sec("Kata Kerja & Imbuhan", "c8")
    for l in verbs:
        lv(*l[:4])
    sec("Ayat, Cerita & Pemahaman", "c3")
    for l in sentences:
        nm = {"Ayat lengkap": "Bina ayat mudah"}.get(l[0], l[0])
        lv(nm, l[1], l[2], l[3])
    lv("Bacaan & pemahaman", "Reading comprehension", "🧠", [
        "?siti ada seekor kucing. kucing itu berwarna putih.\nApakah warna kucing Siti?|putih|hitam|kuning|🐱",
        "?ayah pergi ke kedai. ayah membeli roti dan susu.\nApakah yang ayah beli?|roti dan susu|nasi dan ayam|buku dan pensel|🛒",
        "?hari ini hujan lebat. adik tidak bermain di luar.\nKenapa adik tidak bermain di luar?|hari hujan|adik sakit|hari sudah malam|🌧️",
        "?abang bangun awal. dia memakai baju sekolah. abang berjalan ke sekolah.\nKe mana abang pergi?|ke sekolah|ke pasar|ke pantai|🏫",
        "?nenek tinggal di kampung. rumah nenek dekat sungai.\nDi mana rumah nenek?|dekat sungai|dekat bandar|dekat kedai|🏡",
        "?ibu memasak nasi goreng. kami makan bersama-sama.\nSiapakah yang memasak?|ibu|ayah|kakak|🍳",
    ])
    return verbs, sentences


def check(levels):
    """Semakan format & ejaan asas."""
    bad = []
    banned = {"sapi", "bisa", "gratis", "mobil", "sepeda", "apel", "telepon", "jidar", "dian", "ramarama", "kola", "baterai"}
    for name, _, _, items in levels:
        assert len(items) >= 4, f"{name}: perlu ≥4 item untuk kuiz"
        for it in items:
            if it.startswith("?"):
                parts = it[1:].split("|")
                assert len(parts) >= 5, f"MCQ salah format: {it}"
                continue
            words = re.findall(r"[a-zA-Z]+", it.split("|")[0] if "|" in it else it)
            for w in words:
                if w.lower() in banned:
                    bad.append((name, it))
    assert not bad, f"Perkataan dilarang: {bad}"


def main():
    verbs, sentences = build()
    levels, sections, i = [], [], 0
    for title, color, lvls in S:
        sections.append([i, i + len(lvls), title, color])
        levels.extend(lvls)
        i += len(lvls)
    check(levels)
    n_items = sum(len(l[3]) for l in levels)
    core = {"free": FREE_N, "levels": levels[FREE_N:], "imbuhan": verbs, "ayat": sentences, "n_levels": len(levels), "n_items": n_items, "sections": sections}
    json.dump(core, open(CORE_PATH, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    app = open(APP_PATH, encoding="utf-8").read()
    free = levels[:FREE_N]
    ph = [[l[0], l[1], l[2], [], {"pro": 1, "n": len(l[3])}] for l in levels[FREE_N:]]
    curr = {"free": FREE_N, "core": len(levels), "items": n_items, "sections": sections}
    new_lv = "    const LV = " + json.dumps(free, ensure_ascii=False) + ".concat(" + json.dumps(ph, ensure_ascii=False) + ");\n    window.JB_CURR = " + json.dumps(curr, ensure_ascii=False) + ";"
    app, n = re.subn(r"    const LV = \[.*?\]\.concat\(\[.*?\]\);(\n    window\.JB_CURR = \{.*?\};)?", lambda m: new_lv, app, count=1, flags=re.S)
    assert n == 1, "blok LV tidak dijumpai"
    open(APP_PATH, "w", encoding="utf-8").write(app)
    print(f"{len(levels)} tahap, {n_items} item, {FREE_N} percuma, {len(sections)} bahagian")
    for s in sections:
        print("  ", s)


if __name__ == "__main__":
    main()
