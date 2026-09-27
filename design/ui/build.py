#!/usr/bin/env python3
"""Inline the token/component CSS into each preview page and expand
@wave / @fret macros into real SVG. Each card must render standalone."""
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


WAVE = re.compile(r"<!--@wave\s+(\w+)\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+([\d.]+))?-->")
FRET = re.compile(r"<!--@fret\s+(\w+)\s+([A-G]#?)\s+(\w+)(?:\s+(\d+))?-->")


def expand(t):
    t = WAVE.sub(lambda m: waveform(m[1], int(m[2]), int(m[3]), int(m[4]),
                                    float(m[5]) if m[5] else 0.55), t)
    t = FRET.sub(lambda m: fretboard(m[1], m[2], m[3], int(m[4]) if m[4] else 12), t)
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
