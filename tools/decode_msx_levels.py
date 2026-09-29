"""Decode MSX Arkanoid levels from the annotated disassembly.

level_maps.asm   -> 17 bytes per level (136 bits, 132 used = 11 cols x 12 rows)
level_colors.asm -> one nibble-value byte per *present* brick, reading order
"""
import json
import os

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

BASE = os.path.join(ROOT, "arkanoid_msx_disasm") + os.sep
OUT = os.path.join(ROOT, "tools", "out") + os.sep     # build_msx_levels.py reads it from here
os.makedirs(OUT, exist_ok=True)

def parse_db(path):
    out = []
    with open(BASE + path) as f:
        for line in f:
            s = line.strip()
            if not s.startswith("db "):
                continue
            for p in s[3:].split(";")[0].split(","):
                p = p.strip()
                if not p:
                    continue
                if p.endswith("h"):
                    p = "0x" + p[:-1]
                out.append(int(p, 16))
    return out

maps = parse_db("level_maps.asm")
colors = parse_db("level_colors.asm")
actions_raw = parse_db("compressed_brick_actions_per_level.asm")

COLS, ROWS, CELLS, STRIDE = 11, 12, 132, 17
NLEV = len(maps) // STRIDE
print(f"maps={len(maps)}B stride={STRIDE} -> {NLEV} levels; colors={len(colors)}B")

ci = 0
levels = []
for li in range(NLEV):
    chunk = maps[li * STRIDE:(li + 1) * STRIDE]
    bits = [(chunk[i // 8] >> (7 - i % 8)) & 1 for i in range(CELLS)]
    grid = [[0] * COLS for _ in range(ROWS)]
    for idx in range(CELLS):
        if bits[idx]:
            grid[idx // COLS][idx % COLS] = (colors[ci] if ci < len(colors) else 99) + 1
            ci += 1
    levels.append(grid)
print(f"colors consumed {ci} / {len(colors)}  (delta {len(colors)-ci})")

# --- RLE "brick actions": low nibble = run length, high nibble = value, 0xFF = end of level
actions = []
cur = []
for v in actions_raw[64:]:          # skip the two 32-entry pointer tables (dw parsed separately)
    if v == 0xFF:
        actions.append(cur)
        cur = []
        continue
    cur.extend([(v >> 4)] * (v & 0x0F))
if cur:
    actions.append(cur)
acts = [a for a in actions if len(a) == CELLS]
print(f"action tables decoded: {len(actions)} raw, {len(acts)} with exactly 132 entries")

# --- consistency check: bitmask presence vs. nonzero action
mismatch = 0
for li in range(min(len(acts), NLEV)):
    flat = [levels[li][r][c] for r in range(ROWS) for c in range(COLS)]
    for i in range(CELLS):
        if (flat[i] != 0) != (acts[li][i] != 0):
            mismatch += 1
print(f"bitmask vs action-table cell mismatches: {mismatch} / {CELLS*min(len(acts),NLEV)}")

SYM = ".WOCGRBPYSg"   # 0 empty,1 white,2 orange,3 cyan,4 green,5 red,6 blue,7 pink,8 yellow,9 silver,10 gold
def show(g, title):
    print(title)
    for row in g:
        print("  " + "".join(SYM[v] if 0 <= v < len(SYM) else "?" for v in row))

for i in range(6):
    show(levels[i], f"--- Round {i+1} ---")
show(levels[31], "--- Round 32 ---")

json.dump(levels, open(OUT + "levels_truth.json", "w"))
json.dump(acts, open(OUT + "actions.json", "w"))
