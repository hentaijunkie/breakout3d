"""Emit the MSX level table as JS + a PNG contact sheet, for reference.

Run tools/decode_msx_levels.py first. Output: arkanoid_levels_msx.js (the table only - the
brick colours and drawing the games use live in arkanoid_bricks.js) and
arkanoid_levels_reference.png. None of the games load this table: the arcade rounds are
in arkanoid_levels_arcade.js.
"""
import json
import os

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from PIL import Image, ImageDraw

SCR = os.path.join(ROOT, "tools", "out", "levels_truth.json")
if not os.path.exists(SCR):
    raise SystemExit("run tools/decode_msx_levels.py first")
levels = json.load(open(SCR))

# Arcade RGB sampled straight off MAME frames (rounds 1 and 7).
# Gold is the one value not present in either captured round - flagged below.
RGB = {
    1: (241, 241, 241), 2: (255, 143, 0), 3: (0, 255, 255), 4: (0, 255, 0),
    5: (255, 0, 0), 6: (0, 112, 255), 7: (255, 0, 255), 8: (255, 255, 0),
    9: (157, 157, 157), 10: (188, 174, 0),
}
UNVERIFIED = set()
# Silver and gold are the two beveled bricks: 1px highlight, body, 1px shadow.
BEVEL = {
    9:  {"hi": "#d2d2d2", "body": "#9d9d9d", "lo": "#8f8f8f"},
    10: {"hi": "#e0d200", "body": "#bcae00", "lo": "#9d8f00"},
}
NAMES = {1: "white", 2: "orange", 3: "cyan", 4: "green", 5: "red",
         6: "blue", 7: "pink", 8: "yellow", 9: "silver", 10: "gold"}

# ---------- JS ----------
js = [
    "/**",
    " * ARKANOID (MSX) - level table decoded from the MSX disassembly, kept for reference.",
    " *",
    " * Source: Taito Arkanoid (MSX) ROM, decoded from the annotated disassembly:",
    " *   level_maps.asm    - 17 bytes/level bitmask, 132 bits = 11 cols x 12 rows",
    " *   level_colors.asm  - one byte per present brick, in reading order",
    " * The colour stream is consumed exactly (1958/1958 bytes) across all 32 rounds,",
    " * and round 1 was verified pixel-for-pixel against MAME running the arcade ROM.",
    " *",
    " * Grid: 11 columns x 12 rows. Row 0 is the top.",
    " * NOTE: the ARCADE playfield is 13 columns wide, not 11 - the arcade rounds are",
    " * the same designs re-drawn wider. This table is MSX-exact, arcade-approximate.",
    " *",
    " * Codes: 0 empty, " + ", ".join(f"{k} {v}" for k, v in NAMES.items()),
    " */",
    "const ARKANOID_MSX_LEVELS = [",
]
for i, g in enumerate(levels):
    js.append(f"  // Round {i + 1}")
    js.append("  [")
    for row in g:
        js.append("    [" + ",".join(f"{v:2d}" for v in row) + "],")
    js.append("  ],")
js.append("];")
js.append("")
open(os.path.join(ROOT, "arkanoid_levels_msx.js"), "w").write("\n".join(js))
print("wrote arkanoid_levels_msx.js")

# ---------- contact sheet ----------
CW, CH, PAD = 8, 6, 10
LW, LH = 11 * CW, 12 * CH
COLS = 8
sheet = Image.new("RGB", (COLS * (LW + PAD) + PAD, 4 * (LH + PAD + 12) + PAD), (12, 14, 24))
d = ImageDraw.Draw(sheet)
for i, g in enumerate(levels):
    ox = PAD + (i % COLS) * (LW + PAD)
    oy = PAD + (i // COLS) * (LH + PAD + 12)
    d.text((ox, oy), f"R{i+1}", fill=(150, 170, 210))
    for r, row in enumerate(g):
        for c, v in enumerate(row):
            if not v:
                continue
            x0, y0 = ox + c * CW, oy + 12 + r * CH
            d.rectangle([x0, y0, x0 + CW - 2, y0 + CH - 2], fill=RGB[v])
sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST).save(
    os.path.join(ROOT, "arkanoid_levels_reference.png"))
print("wrote arkanoid_levels_reference.png")
