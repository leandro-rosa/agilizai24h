#!/usr/bin/env python3
"""Regenerates public/brand/contour.svg and contour-surface.svg.

Not a hand-drawn wave: a scalar field made of several Gaussian bumps,
contoured with marching squares. That combination is what produces the
manual's actual look (thin organic lines interfering with each other
across the whole frame, several spiral centers) - see the back cover in
../../../docs/manual-da-marca/. Hand-drawn blob shapes were tried twice
and rejected for not resembling the reference image; re-run this instead
of hand-tuning bezier paths if the pattern ever needs to change.

Usage: python3 scripts/generate-contour-pattern.py
Requires: numpy (only).
"""

import random

import numpy as np

W, H = 1400, 800
GX, GY = 140, 80  # grid resolution for the scalar field
SEED = 7

OUT_DIR = "public/brand"


def build_field():
    # Legacy `random`, not `np.random.default_rng`: the shipped SVGs were
    # generated with `random.seed(7)` + `random.uniform`, and switching RNG
    # implementations (even with the same seed value) changes every draw -
    # keep this exact call sequence or a re-run stops matching what's live.
    random.seed(SEED)
    np.random.seed(SEED)
    xs = np.linspace(0, W, GX)
    ys = np.linspace(0, H, GY)
    X, Y = np.meshgrid(xs, ys)
    field = np.zeros_like(X)

    # Scattered bump centers, loosely echoing the reference photo's swirl
    # clusters (top-left, a broad center-right one, bottom-left, etc).
    centers = [
        (120, 90, 260, 1.0),
        (420, 260, 340, 0.75),
        (900, 180, 420, 1.15),
        (1300, 120, 260, 0.6),
        (220, 620, 320, 1.1),
        (700, 700, 380, 0.7),
        (1150, 620, 300, 0.85),
        (60, 400, 220, 0.5),
    ]
    for (cx, cy, sigma, amp) in centers:
        # Elongate/rotate each bump so contours aren't perfectly circular.
        angle = random.uniform(0, np.pi)
        ex = random.uniform(0.8, 1.4)
        ca, sa = np.cos(angle), np.sin(angle)
        dx, dy = X - cx, Y - cy
        rx = dx * ca + dy * sa
        ry = (-dx * sa + dy * ca) * ex
        d2 = (rx**2 + ry**2) / (sigma**2)
        field += amp * np.exp(-d2)

    return field, xs, ys


def interp(p1, v1, p2, v2, level):
    t = 0.5 if v2 == v1 else (level - v1) / (v2 - v1)
    return (p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1]))


# Edge-pair table for the 16 marching-squares cases (index = tl*8+tr*4+br*2+bl).
# Cases 5/10 are the ambiguous saddle points - always resolved the same way
# here, which is fine for decorative line art.
CASE_TABLE = {
    0: [], 15: [],
    1: [("left", "bottom")],
    2: [("bottom", "right")],
    3: [("left", "right")],
    4: [("top", "right")],
    5: [("top", "left"), ("bottom", "right")],
    6: [("top", "bottom")],
    7: [("top", "left")],
    8: [("top", "left")],
    9: [("top", "bottom")],
    10: [("top", "right"), ("left", "bottom")],
    11: [("top", "right")],
    12: [("left", "right")],
    13: [("bottom", "right")],
    14: [("left", "bottom")],
}


def marching_squares(field, xs, ys, level):
    segments = []
    for j in range(GY - 1):
        for i in range(GX - 1):
            tl, tr = (xs[i], ys[j]), (xs[i + 1], ys[j])
            bl, br = (xs[i], ys[j + 1]), (xs[i + 1], ys[j + 1])
            vtl, vtr, vbr, vbl = field[j, i], field[j, i + 1], field[j + 1, i + 1], field[j + 1, i]
            idx = ((vtl > level) << 3) | ((vtr > level) << 2) | ((vbr > level) << 1) | (vbl > level)

            edges = {
                "top": lambda: interp(tl, vtl, tr, vtr, level),
                "right": lambda: interp(tr, vtr, br, vbr, level),
                "bottom": lambda: interp(bl, vbl, br, vbr, level),
                "left": lambda: interp(tl, vtl, bl, vbl, level),
            }
            for a, b in CASE_TABLE[idx]:
                segments.append((edges[a](), edges[b]()))
    return segments


def segments_to_path_d(segments):
    return " ".join(f"M{x1:.1f},{y1:.1f} L{x2:.1f},{y2:.1f}" for (x1, y1), (x2, y2) in segments)


def build_contour_paths(field, xs, ys, n_levels=13):
    fmin, fmax = field.min(), field.max()
    levels = np.linspace(fmin + (fmax - fmin) * 0.06, fmax - (fmax - fmin) * 0.04, n_levels)
    paths = []
    for lvl in levels:
        segs = marching_squares(field, xs, ys, lvl)
        if segs:
            paths.append(segments_to_path_d(segs))
    return paths


def write_svg(path_ds, stroke, opacity, stroke_width, comment, filename):
    # No accented characters and no literal "--" anywhere in the comment:
    # an SVG used as background-image/<img> is parsed as strict XML, and
    # both break that parse silently (see DESIGN.md's ".brand-canvas" gotcha).
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" fill="none">' % (W, H),
        f"<!-- {comment} -->",
    ]
    for d in path_ds:
        parts.append(f'<path d="{d}" stroke="{stroke}" stroke-width="{stroke_width}" stroke-opacity="{opacity}" fill="none"/>')
    parts.append("</svg>")
    with open(f"{OUT_DIR}/{filename}", "w") as f:
        f.write("\n".join(parts) + "\n")
    print(f"wrote {OUT_DIR}/{filename} ({len(path_ds)} contour levels)")


def main():
    field, xs, ys = build_field()
    paths = build_contour_paths(field, xs, ys)

    write_svg(
        paths, stroke="#E91E8C", opacity=0.20, stroke_width=2.6,
        comment=(
            "Padrao topografico da marca (prancha 07), gerado por "
            "scripts/generate-contour-pattern.py - nao editar a mao, "
            "regenerar. Usado por .brand-canvas sobre o token background "
            "neutro (creme ou carvao); o token brand-magenta e o mesmo "
            "hex nos dois temas."
        ),
        filename="contour.svg",
    )
    write_svg(
        paths, stroke="#FFF4E6", opacity=0.32, stroke_width=2.6,
        comment=(
            "Mesma geometria de contour.svg, traco creme translucido em "
            "vez de magenta - camada que entra sobre o gradiente escuro "
            "ja solido de .brand-surface, onde a versao magenta se "
            "perderia por estar na mesma familia de cor do fundo."
        ),
        filename="contour-surface.svg",
    )


if __name__ == "__main__":
    main()
