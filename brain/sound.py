"""Bunyi video Jom Baca: muzik latar kanak-kanak + kesan bunyi, disintesis sendiri (tiada lagu luar,
tiada isu hak cipta, tiada servis luar). Python standard sahaja.

Muzik dirawak setiap video: tempo, progresi kord, corak melodi, alat (marimba/glockenspiel/pluck) dan kunci.
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


def glock(f):
    def fn(t):
        return min(1.0, t / 0.002) * (math.sin(TAU * f * t) * math.exp(-t * 5) + 0.4 * math.sin(TAU * 3 * f * t) * math.exp(-t * 12))
    return fn


def pluck(f):
    def fn(t):
        a = min(1.0, t / 0.003)
        return a * sum(math.sin(TAU * f * k * t) / k for k in (1, 2, 3, 4)) * math.exp(-t * 6) * 0.7
    return fn


def tick():
    def fn(t):
        return math.sin(TAU * 1500 * t) * math.exp(-t * 60) + 0.5 * math.sin(TAU * 2400 * t) * math.exp(-t * 90)
    return fn


PROGS = [[(60, 64, 67), (55, 59, 62), (57, 60, 64), (53, 57, 60)],  # C G Am F
         [(60, 64, 67), (53, 57, 60), (55, 59, 62), (60, 64, 67)],  # C F G C
         [(57, 60, 64), (53, 57, 60), (60, 64, 67), (55, 59, 62)],  # Am F C G
         [(60, 64, 67), (57, 60, 64), (53, 57, 60), (55, 59, 62)]]  # C Am F G
PATTERNS = [
    [0, 1, 2, 1, 3, 2, 1, None],
    [0, None, 2, 1, 0, 2, 3, 2],
    [2, 1, 0, None, 1, 2, 3, None],
    [0, 2, 1, 2, 0, None, 2, 3],
    [3, 2, 1, 0, 1, None, 2, None],
    [0, 0, 2, None, 1, 1, 3, None],
]
INSTRUMENTS = {"marimba": marimba, "glock": glock, "pluck": pluck}


def music(tr, total, rng):
    bpm = rng.choice([100, 112, 120, 128])
    beat = 60 / bpm
    prog = rng.choice(PROGS)
    pat = rng.choice(PATTERNS)
    inst = INSTRUMENTS[rng.choice(list(INSTRUMENTS))]
    key = rng.choice([-3, -2, 0, 2, 3, 5])
    t, ci = 0.0, 0
    while t < total:
        ch = [n + key for n in prog[ci % 4]]
        tones = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[0] + 24]
        tr.add(t, 1.2, bass(midi(ch[0] - 24)), 0.55)
        tr.add(t + 2 * beat, 1.0, bass(midi(ch[0] - 24)), 0.45)
        for k, idx in enumerate(pat):
            if idx is not None:
                tr.add(t + k * beat / 2, 0.55, inst(midi(tones[idx])), 0.30)
            if k % 2 == 1:
                tr.add(t + k * beat / 2, 0.06, shaker(rng), 0.05)
        t += 4 * beat
        ci += 1
    return {"bpm": bpm, "inst": inst.__name__, "key": key}


def render(tl, out_wav, seed=None):
    """tl = {"total": saat, "events": [(masa, jenis, [indeks])]}; jenis: whoosh, pop, bell, sparkle, tick, tada."""
    rng = random.Random(seed)
    total = tl["total"]
    mus, sfx = Track(total), Track(total)
    music(mus, total, rng)
    base = [midi(72), midi(76), midi(79), midi(84)]
    for e in tl["events"]:
        at, kind = e[0], e[1]
        i = e[2] if len(e) > 2 else 0
        if kind == "whoosh":
            sfx.add(at, 0.45, whoosh(rng, 0.45), 0.35)
        elif kind == "pop":
            sfx.add(at, 0.25, pop(base[i % 4]), 0.55)
        elif kind == "bell":
            for j, m in enumerate((84, 88, 91)):
                sfx.add(at + j * 0.06, 1.4, bell(midi(m)), 0.28)
        elif kind == "sparkle":
            for j, f in enumerate((2093, 2637, 3136)):
                sfx.add(at + j * 0.12, 0.35, sparkle(f), 0.30)
        elif kind == "tick":
            sfx.add(at, 0.12, tick(), 0.45)
        elif kind == "tada":
            sfx.add(at, 0.4, marimba(midi(79), 5), 0.6)
            sfx.add(at + 0.16, 0.9, marimba(midi(84), 4), 0.7)
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
