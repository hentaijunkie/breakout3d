"""Diff the brick renderer against real MAME frames, for all 32 arcade rounds, both ways.

Pipeline:
    node tools/emit_expected_pixels.js     # renders every round with drawArkanoidBrick()
    python tools/verify_all_rounds.py      # compares those fills to snap/rip/*.png

Two checks per round:
  1. every pixel the renderer paints (black gap fills aside) has the MAME frame's colour;
  2. every brick cell of the playfield agrees: a cell the MAME frame shows as a brick
     must be painted, and a painted cell must be a brick on screen. Check 1 alone would
     pass a table with bricks missing - which is how the gold bricks once went unnoticed.
"""
import glob
import os
import sys
from collections import Counter, defaultdict

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
EXPECTED = os.path.join(HERE, "expected_pixels.txt")
SNAP = os.path.join(HERE, "..", "snap", "rip")
ROUNDS = 32

# Arcade brick colours as MAME renders them (all three shades of silver and gold).
BRICK_COLOURS = {
    (241, 241, 241), (255, 143, 0), (0, 255, 255), (0, 255, 0), (255, 0, 0), (0, 112, 255),
    (255, 0, 255), (255, 255, 0), (210, 210, 210), (157, 157, 157), (143, 143, 143),
    (224, 210, 0), (188, 174, 0), (157, 143, 0),
}

if not os.path.exists(EXPECTED):
    sys.exit("run  node tools/emit_expected_pixels.js  first")
by_round = defaultdict(list)
for line in open(EXPECTED):
    r, x, y, w, h, col = line.split()
    by_round[int(r)].append((int(x), int(y), int(w), int(h), col))

shots = sorted(glob.glob(os.path.join(SNAP, "*.png")))
if len(shots) < ROUNDS:
    sys.exit(f"need {ROUNDS} MAME screenshots in {SNAP} (tools/mame/rip_all.lua), found {len(shots)}")


def rgb(s):
    return (int(s[1:3], 16), int(s[3:5], 16), int(s[5:7], 16))


pixels = pixel_bad = cells = cell_bad = 0
worst = []
for rnd in range(1, ROUNDS + 1):
    im = Image.open(shots[rnd - 1]).convert("RGB")
    px = im.load()

    # 1. Pixels: later fills paint over earlier ones, so resolve each to its final colour.
    final = {}
    for x, y, w, h, col in by_round[rnd]:
        if col == "#000000":
            continue
        c = rgb(col)
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                final[(xx, yy)] = c
    miss = sum(1 for (x, y), c in final.items() if px[x, y] != c)
    pixels += len(final)
    pixel_bad += miss

    # 2. Cells: a cell is a brick if its 15x7 face is mostly one brick colour.
    painted = {(x, y) for x, y, w, h, col in by_round[rnd] if w == 15 and h == 7}
    wrong = 0
    for row in range(3, 21):
        for c in range(13):
            x0, y0 = 8 + 16 * c, 8 * row
            face = Counter(px[x0 + i, y0 + j] for j in range(7) for i in range(15))
            top, n = face.most_common(1)[0]
            on_screen = top in BRICK_COLOURS and n > 60
            cells += 1
            if on_screen != ((x0, y0) in painted):
                wrong += 1
    cell_bad += wrong
    if miss or wrong:
        worst.append((rnd, miss, wrong))

print(f"pixels compared: {pixels}   mismatches: {pixel_bad}")
print(f"cells compared : {cells}   mismatches: {cell_bad}")
if worst:
    print("rounds with mismatches (round, pixels, cells):")
    for w in worst[:10]:
        print("  ", w)
    sys.exit(1)
print("PASS - every painted pixel and every brick cell matches the MAME frame")
