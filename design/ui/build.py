#!/usr/bin/env python3
"""Inline the token/component CSS into each preview page and expand
@wave / @fret / @neck / @circle macros into real SVG. Each card must render
standalone."""
import math
import pathlib
import random
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).parent
SRC, DIST = ROOT / "src", ROOT / "dist"
CSS = (SRC / "tokens.css").read_text() + "\n" + (SRC / "components.css").read_text()

STEM_VAR = {"vocals": "--ds-vocals", "drums": "--ds-drums",
            "bass": "--ds-bass", "other": "--ds-other", "mix": "--ds-text-2"}


def waveform(stem, w, h, seed, density=0.55):
    """Deterministic peak envelope, drawn as a mirrored filled path."""
    rnd = random.Random(seed)
    n, mid, amp = int(w / 2), h / 2, h / 2 - 1
    # per-stem character: drums spiky, bass smooth and fat, vocals gappy
    char = {"drums": (0.15, 3.2), "bass": (0.75, 1.0), "vocals": (0.35, 1.8),
            "other": (0.55, 1.4), "mix": (0.6, 1.2)}.get(stem, (0.5, 1.5))
    smooth, spike = char
    env, prev = [], 0.4
    for i in range(n):
        target = rnd.random() ** (1 / spike)
        prev = prev * smooth + target * (1 - smooth)
        # musical macro-shape: bars swell and dip
        macro = 0.62 + 0.38 * math.sin(i / n * math.pi * 7.5) ** 2
        # vocals drop out in places
        gate = 0.0 if (stem == "vocals" and math.sin(i / n * math.pi * 3.1) < -0.45) else 1.0
        env.append(max(0.02, prev * macro * density * gate))
    top = " ".join(f"{i*2},{mid-e*amp:.1f}" for i, e in enumerate(env))
    bot = " ".join(f"{i*2},{mid+e*amp:.1f}" for i, e in reversed(list(enumerate(env))))
    var = STEM_VAR.get(stem, "--ds-text-2")
    return (f'<svg viewBox="0 0 {w} {h}" preserveAspectRatio="none" aria-hidden="true">'
            f'<polygon points="{top} {bot}" fill="var({var})" opacity=".85"/></svg>')


NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
SCALES = {"minor": [0, 2, 3, 5, 7, 8, 10], "major": [0, 2, 4, 5, 7, 9, 11],
          "minor_pent": [0, 3, 5, 7, 10]}
TUNING = {"bass": [43, 38, 33, 28], "guitar": [64, 59, 55, 50, 45, 40]}


def fretboard(inst, root, scale, frets=12, w=880):
    strings = TUNING[inst]
    rootpc = NAMES.index(root)
    degs = SCALES[scale]
    nut, right, top = 44, 18, 26
    fw = (w - nut - right) / frets
    sh = 42
    h = top + sh * (len(strings) - 1) + 34
    o = [f'<svg viewBox="0 0 {w} {h}" aria-hidden="true">']
    # fret wires
    for f in range(frets + 1):
        x = nut + fw * f
        col, wd = ("var(--ds-text-2)", 4) if f == 0 else ("var(--ds-border-strong)", 1.5)
        y2 = top + sh * (len(strings) - 1) + 8
        o.append(
            f'<line x1="{x:.1f}" y1="{top-8}" x2="{x:.1f}" y2="{y2}" '
            f'stroke="{col}" stroke-width="{wd}"/>'
        )
    # inlays
    for f in (3, 5, 7, 9, 12):
        if f > frets:
            continue
        x = nut + fw * (f - 0.5)
        o.append(
            f'<text x="{x:.1f}" y="{h-10}" fill="var(--ds-text-3)" font-size="13" '
            f'font-family="ui-monospace,monospace" text-anchor="middle">{f}</text>'
        )
    # strings + notes
    for si, base in enumerate(strings):
        y = top + sh * si
        o.append(
            f'<line x1="{nut}" y1="{y}" x2="{w-right}" y2="{y}" '
            f'stroke="var(--ds-border-strong)" stroke-width="{1+si*0.55:.1f}"/>'
        )
        o.append(
            f'<text x="{nut-14}" y="{y+5}" fill="var(--ds-text-3)" font-size="13" '
            f'font-family="ui-monospace,monospace" text-anchor="middle">{NAMES[base%12]}</text>'
        )
        for f in range(frets + 1):
            pc = (base + f) % 12
            deg = (pc - rootpc) % 12
            if deg not in degs:
                continue
            x = nut + (fw * 0.5 if f == 0 else fw * (f - 0.5))
            if f == 0:
                x = nut - 0 + fw * 0.5
            isroot = deg == 0
            fill = "var(--ds-bass)" if isroot else "var(--ds-raised)"
            stroke = "var(--ds-bass)"
            txt = "var(--ds-ground)" if isroot else "var(--ds-text)"
            o.append(
                f'<circle cx="{x:.1f}" cy="{y}" r="14" fill="{fill}" '
                f'stroke="{stroke}" stroke-width="2"/>'
            )
            o.append(
                f'<text x="{x:.1f}" y="{y+5}" fill="{txt}" font-size="13" font-weight="700" '
                f'font-family="ui-sans-serif,sans-serif" text-anchor="middle">{NAMES[pc]}</text>'
            )
    o.append("</svg>")
    return "".join(o)


# ---------- @neck: the Theory tab's general-purpose neck (D-19) ----------
# Unlike @fret it takes any tuning, a fret window (start/frets), label modes,
# explicit positions and per-position markers, so one macro draws scale boards,
# 5-fret voicing cards, quiz states and the weak-spot heatmap.
FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"]
SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]
INTERVALS = ["R", "♭2", "2", "♭3", "3", "4", "♭5", "5", "♭6", "6", "♭7", "7"]
NECK_TUNING = {"bass4": [43, 38, 33, 28], "bass5": [43, 38, 33, 28, 23],
               "guitar": [64, 59, 55, 50, 45, 40], "guitar-dropd": [64, 59, 55, 50, 45, 38]}
NECK_SCALES = SCALES | {"major_pent": [0, 2, 4, 7, 9], "blues": [0, 3, 5, 6, 7, 10],
                        "dorian": [0, 2, 3, 5, 7, 9, 10], "none": []}
NECK_INLAYS = (3, 5, 7, 9, 12, 15, 17, 19, 21, 24)


def _pos(spec):
    """'4:0,3:2' -> {(4, 0), (3, 2)}; string 0 is the highest string (top row)."""
    return {tuple(int(v) for v in p.split(":")) for p in spec.split(",") if p}


def _marks(spec):
    """'0:0:ok,3:4:wrong' -> {(0, 0): 'ok', (3, 4): 'wrong'}"""
    out = {}
    for p in filter(None, spec.split(",")):
        s, f, kind = p.split(":")
        out[(int(s), int(f))] = kind
    return out


def _heat(spec):
    """'2:7:.9,2:8:.2' -> {(2, 7): 0.9, ...}; weakness 0 (strong) .. 1 (weak)."""
    out = {}
    for p in filter(None, spec.split(",")):
        s, f, v = p.split(":")
        out[(int(s), int(f))] = float(v)
    return out


def neck(inst="bass4", root="A", scale="none", degs=None, frets=12, start=1, w=1000,
         label="name", flats=False, window=None, only=None, marks=None, heat=None,
         sh=40, dot=14, lefty=False):
    strings = NECK_TUNING[inst]
    rootpc = NAMES.index(root.replace("♯", "#")) if root.replace("♯", "#") in NAMES else FLAT_NAMES.index(root)
    degset = set(degs if degs is not None else NECK_SCALES[scale])
    names = FLAT_NAMES if flats else SHARP_NAMES
    marks, heat = marks or {}, heat or {}
    opn = start == 1  # the open-string column only exists when the nut is in view
    nut, right, top = (66 if opn else 40), 18, 24
    end = start + frets - 1
    fw = (w - nut - right) / frets
    h = top + sh * (len(strings) - 1) + 32

    def fx(f):
        return nut - 22 if f == 0 else nut + fw * (f - start + 0.5)

    tf = f' transform="translate({w} 0) scale(-1 1)"' if lefty else ""
    o = [f'<svg viewBox="0 0 {w} {h}" aria-hidden="true"><g{tf}>']
    if window:
        x1, x2 = nut + fw * (window[0] - start), nut + fw * (window[1] - start + 1)
        o.append(f'<rect x="{x1:.1f}" y="{top-14}" width="{x2-x1:.1f}" height="{sh*(len(strings)-1)+28}" '
                 f'rx="8" fill="var(--ds-accent)" opacity=".08" stroke="var(--ds-accent)" stroke-opacity=".45"/>')
    for (si, f), v in heat.items():
        col = "var(--ds-error)" if v >= .5 else "var(--ds-ok)"
        op = .12 + .38 * (abs(v - .5) * 2)
        o.append(f'<rect x="{nut+fw*(f-start)+2:.1f}" y="{top+sh*si-sh/2+2:.1f}" width="{fw-4:.1f}" '
                 f'height="{sh-4}" rx="4" fill="{col}" opacity="{op:.2f}"/>')
    for f in range(frets + 1):
        x = nut + fw * f
        col, wd = ("var(--ds-text-2)", 4) if (f == 0 and opn) else ("var(--ds-border-strong)", 1.5)
        o.append(f'<line x1="{x:.1f}" y1="{top-8}" x2="{x:.1f}" y2="{top+sh*(len(strings)-1)+8}" '
                 f'stroke="{col}" stroke-width="{wd}"/>')
    for f in range(start, end + 1):
        if f in NECK_INLAYS or (f == start and not opn):
            x = nut + fw * (f - start + .5)
            flip = f' transform="translate({2*x:.1f} 0) scale(-1 1)"' if lefty else ""
            o.append(f'<text x="{x:.1f}" y="{h-6}" fill="var(--ds-text-3)" font-size="13" '
                     f'font-family="ui-monospace,monospace" text-anchor="middle"{flip}>{f}</text>')
    for si, base in enumerate(strings):
        y = top + sh * si
        o.append(f'<line x1="{nut}" y1="{y}" x2="{w-right}" y2="{y}" '
                 f'stroke="var(--ds-border-strong)" stroke-width="{1+si*0.5:.1f}"/>')
        flip = ' transform="translate(28 0) scale(-1 1)"' if lefty else ""
        o.append(f'<text x="14" y="{y+5}" fill="var(--ds-text-3)" font-size="13" '
                 f'font-family="ui-monospace,monospace" text-anchor="middle"{flip}>{SHARP_NAMES[base % 12]}</text>')
        for f in ([0] if opn else []) + list(range(start, end + 1)):
            pc = (base + f) % 12
            deg = (pc - rootpc) % 12
            mk = marks.get((si, f))
            if mk is None and (deg not in degset or (only is not None and (si, f) not in only)):
                continue
            if mk == "mute":
                o.append(f'<text x="{fx(f):.1f}" y="{y+5}" fill="var(--ds-text-3)" font-size="15" font-weight="700" '
                         f'text-anchor="middle">✕</text>')
                continue
            x = fx(f)
            dim = window and not (window[0] <= f <= window[1])
            isroot = deg == 0
            fill = "var(--ds-bass)" if isroot else "var(--ds-raised)"
            stroke, txt, op, dash = "var(--ds-bass)", ("var(--ds-ground)" if isroot else "var(--ds-text)"), 1, ""
            text = {"name": names[pc], "interval": INTERVALS[deg], "none": ""}[label]
            if dim:  # outside the position window: faded, but the label stays legible
                op, txt = .28, "var(--ds-text-3)"
            if mk == "accent":  # the one to act on now: a lit control is chrome (U-01)
                fill, stroke, txt = "var(--ds-accent)", "var(--ds-accent)", "var(--ds-on-accent)"
                o.append(f'<circle cx="{x:.1f}" cy="{y}" r="{dot+6}" fill="var(--ds-accent)" opacity=".22"/>')
            elif mk == "hollow":
                fill, stroke, txt, dash = "var(--ds-ground)", "var(--ds-text-3)", "var(--ds-text-3)", ' stroke-dasharray="4 3"'
            elif mk == "ok":
                fill, stroke, txt = "var(--ds-ok)", "var(--ds-ok)", "var(--ds-ground)"
            elif mk == "wrong":
                fill, stroke, txt, text = "var(--ds-ground)", "var(--ds-error)", "var(--ds-error)", "✕"
            elif mk == "q":
                fill, stroke, txt, text = "var(--ds-ground)", "var(--ds-accent)", "var(--ds-accent)", "?"
            elif mk and mk.startswith("n"):  # play-order number
                text = mk[1:]
            o.append(f'<circle cx="{x:.1f}" cy="{y}" r="{dot}" fill="{fill}" stroke="{stroke}" '
                     f'stroke-width="2"{dash} opacity="{op}"/>')
            if text:
                ttf = f' transform="translate({2*x:.1f} 0) scale(-1 1)"' if lefty else ""
                o.append(f'<text x="{x:.1f}" y="{y+4.5}" fill="{txt}" font-size="{12 if len(text) > 1 else 13}" '
                         f'font-weight="700" font-family="ui-sans-serif,sans-serif" text-anchor="middle" '
                         f'opacity="{1 if dim else op}"{ttf}>{text}</text>')
    o.append("</g></svg>")
    return "".join(o)


def _neck_args(argstr):
    kw = {}
    for tok in argstr.split():
        k, v = tok.split("=", 1)
        if k in ("frets", "start", "w", "sh", "dot"):
            kw[k] = int(v)
        elif k in ("flats", "lefty"):
            kw[k] = v == "1"
        elif k == "degs":
            kw[k] = [int(d) for d in v.split(",") if d]
        elif k == "window":
            kw[k] = tuple(int(d) for d in v.split("-"))
        elif k == "only":
            kw[k] = _pos(v)
        elif k == "marks":
            kw[k] = _marks(v)
        elif k == "heat":
            kw[k] = _heat(v)
        else:
            kw[k] = v
    return neck(**kw)


# ---------- @circle: circle of fifths, one key lit, its neighbours outlined ----------
CIRCLE_MAJ = ["C", "G", "D", "A", "E", "B", "F♯", "D♭", "A♭", "E♭", "B♭", "F"]
CIRCLE_MIN = ["Am", "Em", "Bm", "F♯m", "C♯m", "G♯m", "D♯m", "B♭m", "Fm", "Cm", "Gm", "Dm"]
SIGNATURES = ["no sharps or flats", "1 sharp · F♯", "2 sharps", "3 sharps", "4 sharps", "5 sharps",
              "6 sharps", "5 flats", "4 flats", "3 flats", "2 flats", "1 flat · B♭"]


def circle(key="C", size=300):
    lit = CIRCLE_MAJ.index(key)
    cx = cy = size / 2
    o = [f'<svg viewBox="0 0 {size} {size}" width="{size}" height="{size}" aria-hidden="true">']
    for r, fill in ((size/2-4, "var(--ds-surface)"), (size/2-54, "var(--ds-raised)"), (size/2-100, "var(--ds-ground)")):
        o.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke="var(--ds-border-strong)"/>')
    for i in range(12):
        a = math.radians(i * 30 - 90)
        state = "on" if i == lit else ("near" if (i - lit) % 12 in (1, 11) else None)
        for r, lab, fs, rad, major in ((size/2-29, CIRCLE_MAJ[i], 17, 19, True), (size/2-77, CIRCLE_MIN[i], 13, 17, False)):
            x, y = cx + r * math.cos(a), cy + r * math.sin(a)
            col = "var(--ds-text-2)" if major else "var(--ds-text-3)"
            if state == "on" and major:
                o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rad}" fill="var(--ds-accent)"/>')
                col = "var(--ds-on-accent)"
            elif state:
                o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rad}" fill="none" stroke="var(--ds-accent)" stroke-width="1.5"/>')
                col = "var(--ds-text)"
            o.append(f'<text x="{x:.1f}" y="{y+5:.1f}" text-anchor="middle" font-size="{fs}" font-weight="700" '
                     f'fill="{col}" font-family="ui-sans-serif,sans-serif">{lab}</text>')
    o.append(f'<text x="{cx}" y="{cy-4}" text-anchor="middle" font-size="15" font-weight="700" fill="var(--ds-text)" '
             f'font-family="ui-sans-serif,sans-serif">{key} major</text>'
             f'<text x="{cx}" y="{cy+16}" text-anchor="middle" font-size="12" fill="var(--ds-text-3)" '
             f'font-family="ui-sans-serif,sans-serif">{SIGNATURES[lit]}</text></svg>')
    return "".join(o)


def _circle_args(argstr):
    kw = dict(tok.split("=", 1) for tok in argstr.split())
    return circle(kw.get("key", "C"), int(kw.get("size", 300)))


# ---------- @tabstaff: the Tab screen's transcribed bass line (D-21) ----------
# A 4-line staff on the shared time axis: highest string on top, as on every neck
# (U-13). A note is a fret chip whose left edge is its onset, with a tail to where it
# ends; transcription is not quantised, so neither is the drawing. Kinds (U-16):
#   n    transcribed note, bass hue
#   now  sounding at the playhead, accent
#   u    unsure (low confidence): same hue at 40 %, fret number gets a "?"
#   o    substituted (here: raised an octave, below the open E): warn ring + "↑8"
# Dense notes (as tabStaffPainter.ts): a chip narrows to the room before the next note on
# its string, its label steps down 17 -> 13 -> 11 px (the "?" goes first), and a thin
# ground-coloured edge keeps touching chips apart.
TAB_STRINGS = ["G", "D", "A", "E"]
TAB_SIZES = (17, 13, 11)


def _tab_fit(text, width):
    return next((s for s in TAB_SIZES if len(text) * s * 0.6 + 4 <= width), None)


def _tab_notes(spec):
    """'17:0:1.5:3:3,17:2:1:2:5:now' -> [(bar, onset, dur, string, fret, kind)]"""
    out = []
    for p in filter(None, spec.split(",")):
        f = p.split(":")
        kind = f[5] if len(f) > 5 else "n"
        out.append((int(f[0]), float(f[1]), float(f[2]), int(f[3]), int(f[4]), kind))
    return out


def tabstaff(w=1200, ppb=280, start=1.0, bpb=4, notes="", part="lane", sh=40):
    top = 30
    h = top * 2 + sh * (len(TAB_STRINGS) - 1)
    if part == "head":
        o = [f'<svg width="200" height="{h}" viewBox="0 0 200 {h}" aria-hidden="true" style="display:block">']
        for si, name in enumerate(TAB_STRINGS):
            o.append(f'<text x="184" y="{top+sh*si+6}" text-anchor="end" font-size="17" font-weight="600" '
                     f'fill="var(--ds-text-3)" font-family="ui-sans-serif,sans-serif">{name}</text>')
        o.append("</svg>")
        return "".join(o)

    def bx(bar, beat=0.0):
        return (bar + beat / bpb - start) * ppb

    o = [f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" '
         f'aria-label="Bass tab, {len(TAB_STRINGS)} strings" style="display:block">']
    first = int(math.floor(start))
    last = int(math.ceil(start + w / ppb))
    for bar in range(first, last + 1):
        for beat in range(bpb):
            x = bx(bar, beat)
            if 0 <= x <= w:
                col, wd = ("var(--ds-border-strong)", 2) if beat == 0 else ("var(--ds-border)", 1)
                o.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{top-14}" y2="{top+sh*3+14}" '
                         f'stroke="{col}" stroke-width="{wd}"/>')
    for si in range(len(TAB_STRINGS)):
        y = top + sh * si
        o.append(f'<line x1="0" x2="{w}" y1="{y}" y2="{y}" stroke="var(--ds-text-3)" '
                 f'stroke-width="{1.4+si*0.6:.1f}"/>')
    parsed = _tab_notes(notes)
    nxt, seen = [None] * len(parsed), {}
    for i in range(len(parsed) - 1, -1, -1):
        nxt[i] = seen.get(parsed[i][3])
        seen[parsed[i][3]] = bx(parsed[i][0], parsed[i][1])
    for i, (bar, onset, dur, si, fret, kind) in enumerate(parsed):
        x, end, y = bx(bar, onset), bx(bar, onset + dur), top + sh * si
        full = f"{fret}?" if kind == "u" else str(fret)
        room = float("inf") if nxt[i] is None else nxt[i] - x - 2
        cw = max(14, min(max(30, 14 + 11 * len(full)), room))
        size = _tab_fit(full, cw)
        label = full if size else str(fret)
        size = size or _tab_fit(label, cw) or 11
        rx = min(7, cw / 3)
        fill, txt, op = "var(--ds-bass)", "var(--ds-ground)", 1
        if kind == "now":
            fill, txt = "var(--ds-accent)", "var(--ds-on-accent)"
        if kind == "u":
            op, txt = .4, "var(--ds-text)"
        if end > x + cw:
            o.append(f'<line x1="{x+cw:.1f}" x2="{end-3:.1f}" y1="{y}" y2="{y}" stroke="{fill}" '
                     f'stroke-width="6" stroke-linecap="round" opacity="{.55*op:.2f}"/>')
        if kind == "now":
            o.append(f'<rect x="{x-6:.1f}" y="{y-20}" width="{cw+12}" height="40" rx="10" '
                     f'fill="var(--ds-accent)" opacity=".22"/>')
        ring = ' stroke="var(--ds-warn)" stroke-width="3"' if kind == "o" else ""
        o.append(f'<rect x="{x:.1f}" y="{y-14}" width="{cw:.1f}" height="28" rx="{rx:.1f}" fill="{fill}" '
                 f'opacity="{op}"/>')
        o.append(f'<rect x="{x:.1f}" y="{y-14}" width="{cw:.1f}" height="28" rx="{rx:.1f}" fill="none" '
                 f'stroke="var(--ds-ground)" stroke-width="1.5"/>')
        if ring:
            o.append(f'<rect x="{x:.1f}" y="{y-14}" width="{cw:.1f}" height="28" rx="{rx:.1f}" fill="none"{ring}/>')
            o.append(f'<text x="{x+cw/2:.1f}" y="{y-19}" text-anchor="middle" font-size="13" font-weight="700" '
                     f'fill="var(--ds-warn)" font-family="ui-monospace,monospace">↑8</text>')
        o.append(f'<text x="{x+cw/2:.1f}" y="{y+size*0.35:.1f}" text-anchor="middle" font-size="{size}" font-weight="700" '
                 f'fill="{txt}" font-family="ui-monospace,monospace">{label}</text>')
    o.append("</svg>")
    return "".join(o)


def _tabstaff_args(argstr):
    kw = dict(tok.split("=", 1) for tok in argstr.split())
    for k in ("w", "ppb", "bpb", "sh"):
        if k in kw:
            kw[k] = int(kw[k])
    if "start" in kw:
        kw["start"] = float(kw["start"])
    return tabstaff(**kw)


TABSTAFF = re.compile(r"<!--@tabstaff\s+(.*?)-->")
NECK = re.compile(r"<!--@neck\s+(.*?)-->")
CIRCLE = re.compile(r"<!--@circle\s+(.*?)-->")

WAVE = re.compile(r"<!--@wave\s+(\w+)\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+([\d.]+))?-->")
FRET = re.compile(r"<!--@fret\s+(\w+)\s+([A-G]#?)\s+(\w+)(?:\s+(\d+))?-->")


def expand(t):
    t = WAVE.sub(lambda m: waveform(m[1], int(m[2]), int(m[3]), int(m[4]),
                                    float(m[5]) if m[5] else 0.55), t)
    t = FRET.sub(lambda m: fretboard(m[1], m[2], m[3], int(m[4]) if m[4] else 12), t)
    t = NECK.sub(lambda m: _neck_args(m[1]), t)
    t = TABSTAFF.sub(lambda m: _tabstaff_args(m[1]), t)
    t = CIRCLE.sub(lambda m: _circle_args(m[1]), t)
    return t


def main():
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)
    n = 0
    for p in sorted((SRC / "pages").rglob("*.html")):
        t = p.read_text()
        if "/* @inject */" not in t:
            sys.exit(f"{p}: missing /* @inject */ marker")
        if not t.lstrip().startswith("<!-- @dsCard"):
            sys.exit(f"{p}: missing first-line @dsCard marker")
        out = DIST / p.relative_to(SRC / "pages")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(expand(t.replace("/* @inject */", CSS)))
        n += 1
    print(f"built {n} pages -> {DIST}")


if __name__ == "__main__":
    main()
