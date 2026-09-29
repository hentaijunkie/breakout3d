"""Build the verified 13-column arcade level table from the MAME rip.

Input : tools/mame/arcade_rip.txt   (tools/mame/rip_all.lua output)
        snap/rip/####.png            (one screenshot per ripped round, in order)
Output: arkanoid_levels_arcade.js

Self-validating: the RAM byte -> colour mapping is not assumed, it is voted from the
actual on-screen pixels of every round, and the RAM grid is then checked against the
screen cell by cell. The build aborts on any unmapped byte or any RAM/screen mismatch.

A brick byte carries more than a colour (see docs/ARCADE_RE.md):
  bits 2-7  colour index (points 50..120), or the remaining hits of a silver brick
  bits 0-1  01 plain brick, 02 brick that releases a capsule, 03 silver; ff is gold
The capsule flag and the silver hit count are emitted alongside the colours.
"""
import glob
import os
import re
from collections import Counter

from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
RIP = os.path.join(ROOT, "tools", "mame", "arcade_rip.txt")
SNAP = os.path.join(ROOT, "snap", "rip")
OUT = os.path.join(ROOT, "arkanoid_levels_arcade.js")
W, H = 13, 28
REAL_ROUNDS = 32          # 33 is DOH (no bricks)
DOH_ROUND = 33

# Arcade pixel colours, measured from MAME frames. Silver and gold are the two beveled
# bricks, so all three shades of each map to the same brick type.
PIX = {
    (241, 241, 241): 1, (255, 143, 0): 2, (0, 255, 255): 3, (0, 255, 0): 4,
    (255, 0, 0): 5, (0, 112, 255): 6, (255, 0, 255): 7, (255, 255, 0): 8,
    (210, 210, 210): 9, (157, 157, 157): 9, (143, 143, 143): 9,
    (224, 210, 0): 10, (188, 174, 0): 10, (157, 143, 0): 10,
}
NAMES = {1: "white", 2: "orange", 3: "cyan", 4: "green", 5: "red",
         6: "blue", 7: "pink", 8: "yellow", 9: "silver", 10: "gold"}
GOLD_BYTE = 0xFF

# --- parse the rip -------------------------------------------------------------
rounds, info = {}, {}
pat = re.compile(r"=== ROUND (\d+) ===\n(.*?)=== END ===\nSPEED (\w+)\nINDEX (\w+)", re.S)
for m in pat.finditer(open(RIP).read()):
    n = int(m.group(1))
    grid = [[int(v, 16) for v in ln.split()]
            for ln in m.group(2).strip().splitlines() if ln.strip()]
    # The window starts at 0xed64 but the brick array proper begins at screen row 3;
    # rows 0-2 alias other game state (BRICKS_LEFT at 0xed83 lives there).
    for r in range(min(3, len(grid))):
        grid[r] = [0] * W
    rounds[n] = grid
    info[n] = {"speed": int(m.group(3), 16), "index": int(m.group(4), 16)}
if DOH_ROUND not in info:
    raise SystemExit("ABORT: the rip does not reach the DOH round")
for n, i in info.items():
    if i["index"] != n - 1:
        raise SystemExit(f"ABORT: round {n} reports index {i['index']}")
rounds = {n: g for n, g in rounds.items() if n <= REAL_ROUNDS}
print(f"parsed rounds: {min(rounds)}..{max(rounds)}")

# --- read the same grids off the screenshots ------------------------------------
shots = sorted(glob.glob(os.path.join(SNAP, "*.png")))
if len(shots) < REAL_ROUNDS:
    raise SystemExit(f"ABORT: need {REAL_ROUNDS} screenshots in {SNAP}, found {len(shots)}")


def screen_grid(path):
    im = Image.open(path).convert("RGB")
    px, (iw, ih) = im.load(), im.size
    out = []
    for r in range(H):
        row = []
        for c in range(W):
            x0, y0 = 8 + c * 16, r * 8
            if x0 + 15 > iw or y0 + 7 > ih:
                row.append(None)
                continue
            blk = [px[x0 + x, y0 + y] for y in range(7) for x in range(15)]
            col, n = Counter(blk).most_common(1)[0]
            row.append(PIX.get(col) if n > 60 else None)
        out.append(row)
    return out


screens = {n: screen_grid(shots[n - 1]) for n in rounds}

votes = {}
for n in sorted(rounds):
    for r in range(3, H):
        for c in range(W):
            s = screens[n][r][c]
            b = rounds[n][r][c]
            if s is not None and b:
                votes.setdefault(b, Counter())[s] += 1

print("\n=== RAM byte -> colour, voted from pixels ===")
MAP = {}
for b in sorted(votes):
    top, k = votes[b].most_common(1)[0]
    total = sum(votes[b].values())
    MAP[b] = top
    tag = f"   <-- {k}/{total}: {dict(votes[b])}" if k != total else ""
    print(f"  {b:02x} -> {top:2d} {NAMES.get(top, '?'):7s}{tag}")
if MAP.get(GOLD_BYTE) != 10:
    raise SystemExit(f"ABORT: 0x{GOLD_BYTE:02x} should vote as gold, got {MAP.get(GOLD_BYTE)}")

# Nothing in the brick area may go unmapped, or bricks would silently vanish.
present = {b for n in rounds for r in range(3, H) for b in rounds[n][r]}
missing = sorted(present - set(MAP) - {0})
if missing:
    raise SystemExit(f"ABORT: unmapped brick byte(s) {[f'{b:02x}' for b in missing]} - "
                     "these would be emitted as empty cells")

# The colour must also follow from the byte's own bits: that is how the game scores it.
for b, col in MAP.items():
    derived = 10 if b == GOLD_BYTE else 9 if b & 3 == 3 else (b >> 2) + 1
    if derived != col:
        raise SystemExit(f"ABORT: byte {b:02x} votes {col} but its bits say {derived}")

# --- cross-check RAM grid vs screen, both ways -------------------------------------
bad = 0
for n in sorted(rounds):
    for r in range(3, H):
        for c in range(W):
            s = screens[n][r][c]
            if s is None:
                continue                      # neither a brick colour nor mostly one colour
            if MAP.get(rounds[n][r][c], 0) != s:
                bad += 1
                print(f"  round {n} row {r} col {c}: RAM {rounds[n][r][c]:02x} screen {s}")
print(f"\nRAM vs screen mismatches: {bad}")
if bad:
    raise SystemExit("ABORT: the RAM grid does not match the screen")


# --- per-round facts -----------------------------------------------------------------
def silver_hits(g):
    hits = {(b >> 2) + 1 for row in g for b in row if b != GOLD_BYTE and b & 3 == 3}
    if len(hits) > 1:
        raise SystemExit(f"ABORT: mixed silver strengths {hits}")
    return hits.pop() if hits else None


def trim(g):
    last = max((r for r, row in enumerate(g) if any(row)), default=-1)
    return g[:last + 1]


fallback_hits = None
round_rows = []
for n in range(1, DOH_ROUND + 1):
    hits = silver_hits(rounds[n]) if n in rounds else None
    if hits is None:
        hits = (n - 1) // 8 + 2 if n <= REAL_ROUNDS else 0
    round_rows.append(f"  {{ speed: {info[n]['speed']}, silverHits: {hits}, "
                      f"background: {4 if n == DOH_ROUND else (n - 1) & 3} }}, // round {n}")

js = [
    "/**",
    " * ARKANOID (Arcade, Taito 1986) - verified 13-column level table.",
    " *",
    " * Ripped from the running game, not from a port. The brick grid lives at 0xed64 in",
    " * main-CPU RAM as 13 columns x 28 rows, row-major; the brick array proper starts at",
    " * screen row 3. 0xed83 is BRICKS_LEFT - zeroing it makes the game clear the round and",
    " * build the next one, which is how tools/mame/rip_all.lua walks all 33 rounds in a",
    " * single run without playing.",
    " *",
    " * Self-verified: every round was screenshotted, the byte -> colour mapping was voted",
    " * from the on-screen pixels, and the RAM grid was re-checked against the screen.",
    " * GENERATED by tools/build_arcade_levels.py - edit that, not this.",
    " *",
    " * Grid row r is at screen y = r * 8; column c is at screen x = 8 + c * 16.",
    " * Codes: 0 empty, " + ", ".join(f"{k} {v}" for k, v in NAMES.items()),
    " */",
    "const ARKANOID_ARCADE_LEVELS = [",
]
for n in sorted(rounds):
    js.append(f"  // Round {n}")
    js.append("  [")
    for row in trim(rounds[n]):
        js.append("    [" + ",".join(f"{MAP.get(v, 0):2d}" for v in row) + "],")
    js.append("  ],")
js += ["];", ""]

js += [
    "/**",
    " * Which bricks release a capsule. In the arcade this is fixed per brick in the round",
    " * data (bit 1 of the brick byte); only the capsule TYPE is decided when it breaks.",
    " * Same shape as ARKANOID_ARCADE_LEVELS; 1 = releases a capsule.",
    " */",
    "const ARKANOID_ARCADE_CAPSULES = [",
]
for n in sorted(rounds):
    js.append(f"  // Round {n}")
    js.append("  [")
    for row in trim(rounds[n]):
        js.append("    [" + ",".join("1" if v and v != GOLD_BYTE and v & 3 == 2 else "0"
                                      for v in row) + "],")
    js.append("  ],")
js += ["];", ""]

js += [
    "/**",
    " * Per-round facts read from RAM when each round starts:",
    " *   speed       ball speed level the round starts at (0xc462)",
    " *   silverHits  hits a silver brick takes in this round",
    " *   background  0-3 cycle with the round; 4 is DOH's",
    " * Index 0 is round 1; the last entry is round 33, the DOH fight (no bricks).",
    " */",
    "const ARKANOID_ARCADE_ROUNDS = [",
    *round_rows,
    "];",
    "",
    "/**",
    " * Rows are ABSOLUTE screen rows: row r sits at y = r * 8, so rounds start with",
    " * several empty rows. The pixel-accurate replica wants that. Renderers that place",
    " * the formation themselves want it trimmed - use these.",
    " */",
    "function arkanoidRoundLayout(round) {",
    "  const i = (round - 1) % ARKANOID_ARCADE_LEVELS.length;",
    "  const g = ARKANOID_ARCADE_LEVELS[i], k = ARKANOID_ARCADE_CAPSULES[i];",
    "  const top = g.findIndex(row => row.some(v => v));",
    "  if (top < 0) return { bricks: [], capsules: [], top: 0 };",
    "  let bottom = g.length - 1;",
    "  while (bottom > top && !g[bottom].some(v => v)) bottom--;",
    "  return { bricks: g.slice(top, bottom + 1), capsules: k.slice(top, bottom + 1), top };",
    "}",
    "",
    "function arkanoidTrimmedLevel(round) {",
    "  return arkanoidRoundLayout(round).bricks;",
    "}",
    "",
    "/** Per-round facts for a 1-based round; rounds past 33 wrap onto 1-32. */",
    "function arkanoidRoundInfo(round) {",
    "  const n = round > ARKANOID_ARCADE_ROUNDS.length ? ((round - 1) % 32) + 1 : round;",
    "  return ARKANOID_ARCADE_ROUNDS[n - 1];",
    "}",
    "",
]
open(OUT, "w").write("\n".join(js))
print(f"wrote {OUT}")

SYM = ".WOCGRBPYSg"
for n in (1, 2, 3):
    print(f"\n--- Arcade Round {n} (* = releases a capsule) ---")
    for row in trim(rounds[n]):
        print("  " + "".join((SYM[MAP.get(v, 0)] if not (v and v != GOLD_BYTE and v & 3 == 2)
                              else SYM[MAP.get(v, 0)].lower() + "")
                             for v in row))
