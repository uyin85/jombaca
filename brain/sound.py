"""Bunyi video Jom Baca: muzik latar kanak-kanak + kesan bunyi, disintesis sendiri (tiada lagu luar,
tiada isu hak cipta, tiada servis luar). Python standard sahaja.

tl (saat): hook_end, demo_end, total, tiles (bilangan kotak), word_at (bila perkataan bercantum).
"""
import math
import random
import struct
import wave

SR = 44100
TAU = 2 * math.pi


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


class Track:
    def __init__(self, secs):
        self.n = int(secs * SR) + 1
        self.buf = [0.0] * self.n

    def add(self, t0, dur, fn, gain=1.0):
        """fn(t) -> sampel; t ialah masa sejak t0."""
        i0 = max(0, int(t0 * SR))
        i1 = min(self.n, int((t0 + dur) * SR))
        b = self.buf
        for i in range(i0, i1):
            b[i] += gain * fn((i - i0) / SR)


def marimba(f, decay=7.0):
    def fn(t):
        a = min(1.0, t / 0.004)
        return a * (math.sin(TAU * f * t) * math.exp(-t * decay) + 0.25 * math.sin(TAU * 4 * f * t) * math.exp(-t * decay * 3))
    return fn


def bass(f):
    def fn(t):
        a = min(1.0, t / 0.01)
        return a * (math.sin(TAU * f * t) + 0.3 * math.sin(TAU * 2 * f * t)) * math.exp(-t * 3.0)
    return fn


def shaker(rng):
    state = [0.0]

    def fn(t):
        x = rng.uniform(-1, 1)
        hp = x - state[0]
        state[0] = x * 0.6
        return hp * math.exp(-t * 55)
    return fn


def pop(f0):
    def fn(t):
        f = f0 * (1 + 0.6 * min(1.0, t / 0.08))
        return math.sin(TAU * f * t) * math.exp(-t * 28) * min(1.0, t / 0.002)
    return fn


def bell(f):
    parts = [(1.0, 1.0, 2.2), (2.76, 0.45, 4.0), (5.4, 0.25, 7.0)]

    def fn(t):
        return min(1.0, t / 0.003) * sum(a * math.sin(TAU * f * r * t) * math.exp(-t * d) for r, a, d in parts)
    return fn


def sparkle(f):
    def fn(t):
        return math.sin(TAU * f * t) * math.exp(-t * 22) * (0.6 + 0.4 * math.sin(TAU * 18 * t))
    return fn


def whoosh(rng, dur):
    state = [0.0]

    def fn(t):
        x = rng.uniform(-1, 1)
        k = 0.05 + 0.5 * (t / dur)  # penapis makin terang
        state[0] += k * (x - state[0])
        env = math.sin(math.pi * min(1.0, t / dur))
        return state[0] * env
    return fn


CHORDS = [(60, 64, 67), (55, 59, 62), (57, 60, 64), (53, 57, 60)]  # C G Am F
PATTERNS = [
    [0, 1, 2, 1, 3, 2, 1, None],
    [0, None, 2, 1, 0, 2, 3, 2],
    [2, 1, 0, None, 1, 2, 3, None],
    [0, 2, 1, 2, 0, None, 2, 3],
]


def music(tr, total, rng):
    beat = 0.5  # 120 BPM
    pat = rng.choice(PATTERNS)
    t, ci = 0.0, 0
    while t < total:
        ch = CHORDS[ci % 4]
        tones = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[0] + 24]
        tr.add(t, 1.2, bass(midi(ch[0] - 24)), 0.55)
        tr.add(t + 2 * beat, 1.0, bass(midi(ch[0] - 24)), 0.45)
        for k, idx in enumerate(pat):
            if idx is not None:
                tr.add(t + k * beat / 2, 0.55, marimba(midi(tones[idx])), 0.32)
            if k % 2 == 1:
                tr.add(t + k * beat / 2, 0.06, shaker(rng), 0.05)
        t += 4 * beat
        ci += 1


def render(tl, out_wav, seed=None):
    rng = random.Random(seed)
    total = tl["total"]
    mus, sfx = Track(total), Track(total)
    music(mus, total, rng)
    # kesan bunyi ikut animasi (masa sama seperti video_html)
    sfx.add(0.0, 0.45, whoosh(rng, 0.45), 0.35)
    n = max(1, tl.get("tiles", 2))
    base = [midi(72), midi(76), midi(79), midi(84)]
    for i in range(n):
        sfx.add(tl["hook_end"] * 0.55 + i * 0.35, 0.25, pop(base[i % 4]), 0.55)
    w = tl["word_at"]
    for j, m in enumerate((84, 88, 91)):
        sfx.add(w + j * 0.06, 1.4, bell(midi(m)), 0.28)
    for j, f in enumerate((2093, 2637, 3136)):
        sfx.add(w + 0.4 + j * 0.12, 0.35, sparkle(f), 0.30)
    d = tl["demo_end"]
    sfx.add(d, 0.4, marimba(midi(79), 5), 0.6)
    sfx.add(d + 0.16, 0.9, marimba(midi(84), 4), 0.7)
    # campur: muzik perlahan di bawah kesan bunyi, fade masuk/keluar
    out = []
    peak = 1e-9
    for i in range(mus.n):
        t = i / SR
        fade = min(1.0, t / 0.4) * min(1.0, max(0.0, (total - t) / 0.9))
        v = mus.buf[i] * 0.55 * fade + sfx.buf[i]
        out.append(v)
        peak = max(peak, abs(v))
    g = 0.89 / peak
    with wave.open(out_wav, "wb") as wv:
        wv.setnchannels(1)
        wv.setsampwidth(2)
        wv.setframerate(SR)
        wv.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, v * g)) * 32767)) for v in out))
    return out_wav
