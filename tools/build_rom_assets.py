"""Build generated/arkanoid_rom_assets.js from YOUR arcade ROMs.

The replica (arkanoid_classic.html) draws with the real arcade graphics when this file
exists, and falls back to its hand-drawn look when it does not. The output is derived
from Taito's copyrighted ROM data, so it is generated locally and git-ignored - it must
not be committed or published.

Inputs : roms/arkanoid.zip             (MAME romset 'arkanoid')
         tools/mame/arcade_rip.txt     (tools/mame/rip_all.lua: VRAM of every round)
Output : generated/arkanoid_rom_assets.js

What goes in:
  palette      the 512 colours of the three 4-bit PROMs
  tiles        all 4096 8x8 tiles, pre-rotated to the player's orientation (3 bits/px)
  screens      per background (the four that cycle with the round, plus DOH) the empty
               playfield as a 28x32 tilemap: HUD labels, walls, wall shadows, background
  bricks       brick colour code -> (left tile, right tile, colour)
  shadow       background colour -> its darker "shadow" colour

Self-checking: every ripped round is rebuilt from screens + bricks + the shadow rule
(a brick darkens the background cell one tile right and one tile down) and compared
with the arcade's real VRAM cell by cell. Any difference aborts the build.
"""
import base64
import json
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arcade_gfx import ROOT, Hardware  # noqa: E402

RIP = os.path.join(ROOT, "tools", "mame", "arcade_rip.txt")
TITLE = os.path.join(ROOT, "tools", "mame", "title_vram.txt")   # tools/mame/vram_dump.lua, frame 700
OUT_DIR = os.path.join(ROOT, "generated")
OUT = os.path.join(OUT_DIR, "arkanoid_rom_assets.js")

COLS, ROWS = 28, 32          # player-oriented tilemap
DOH_ROUND = 33
PLAYFIELD = [(c, r) for r in range(3, ROWS) for c in range(1, COLS - 1)]


def brick_code(b):
    """Arcade brick byte -> the project's colour code (1-8 colours, 9 silver, 10 gold)."""
    if b == 0:
        return 0
    if b == 0xFF:
        return 10
    if b & 3 == 3:
        return 9
    return (b >> 2) + 1


def cell(vram, c, r):
    """(tile code, colour) of player-oriented cell (c, r)."""
    tx, ty = r, 29 - c
    o = (ty * 32 + tx) * 2
    a, lo = vram[o], vram[o + 1]
    return ((a & 7) << 8) + lo, a >> 3


def parse_rip(path):
    rounds = {}
    pat = re.compile(r"=== ROUND (\d+) ===\n(.*?)=== END ===\nSPEED (\w+)\nINDEX (\w+)\n"
                     r"CTRL (\w+)\nVRAM (\w+)", re.S)
    for m in pat.finditer(open(path).read()):
        grid = [[int(v, 16) for v in ln.split()] for ln in m.group(2).strip().splitlines()]
        rounds[int(m.group(1))] = {
            "grid": grid, "speed": int(m.group(3), 16), "index": int(m.group(4), 16),
            "ctrl": int(m.group(5), 16), "vram": bytes.fromhex(m.group(6)),
        }
    if not rounds:
        raise SystemExit(f"ABORT: no rounds in {path} - run tools/mame/rip_all.lua first")
    return rounds


def brick_cells(R):
    """{(c, r): brick byte} in player tile coordinates (each brick covers two cells)."""
    out = {}
    for r, row in enumerate(R["grid"]):
        if r < 3:
            continue                     # rows 0-2 of the RAM window alias other state
        for g, b in enumerate(row):
            if b:
                out[(1 + 2 * g, r)] = b
                out[(2 + 2 * g, r)] = b
    return out


def bg_id(n):
    return 4 if n == DOH_ROUND else (n - 1) & 3


def build():
    hw = Hardware()
    rounds = parse_rip(RIP)
    print(f"rounds ripped: {min(rounds)}..{max(rounds)}")

    # --- brick tiles ---------------------------------------------------------------
    bt = defaultdict(Counter)
    for R in rounds.values():
        for (c, r), b in brick_cells(R).items():
            if c % 2 == 1:
                bt[brick_code(b)][(cell(R["vram"], c, r), cell(R["vram"], c + 1, r))] += 1
    bricks = {}
    for code, cnt in sorted(bt.items()):
        ((lt, lc), (rt, rc)), _ = cnt.most_common(1)[0]
        if lc != rc:
            raise SystemExit(f"ABORT: brick {code} halves use different colours")
        bricks[code] = [lt, rt, lc]
    print("brick tiles:", bricks)

    # --- an empty playfield per background -------------------------------------------
    screens, shadow_of = {}, {}
    lives = defaultdict(lambda: [Counter(), Counter()])
    for b in range(5):
        rs = [n for n in rounds if bg_id(n) == b]
        if not rs:
            continue
        seen = defaultdict(Counter)
        for n in rs:
            R = rounds[n]
            bc = brick_cells(R)
            covered = set(bc) | {(c + 1, r + 1) for (c, r) in bc}
            for r in range(ROWS):
                for c in range(COLS):
                    t = cell(R["vram"], c, r)
                    # Every round was ripped with 3 lives: the two spare-Vaus icons fill
                    # row 31, columns 1-4. The replica draws them live.
                    if r == 31 and 1 <= c <= 4:
                        lives[b][c % 2][t] += 1
                    elif (c, r) not in covered:
                        seen[(c, r)][t] += 1
        inner = Counter()
        for (c, r), cn in seen.items():
            if 1 < c < COLS - 1 and 3 < r < 31:
                for (_, col), k in cn.items():
                    inner[col] += k
        normal = inner.most_common(1)[0][0]

        codes, colours = [0] * (COLS * ROWS), [0] * (COLS * ROWS)
        hidden = []
        for r in range(ROWS):
            for c in range(COLS):
                if seen[(c, r)]:
                    (t, col), _ = seen[(c, r)].most_common(1)[0]
                    codes[r * COLS + c], colours[r * COLS + c] = t, col
                else:
                    hidden.append((c, r))
        # Cells under a brick in every round of this background: the patterns repeat, so
        # take the tile from a visible cell one pattern period away.
        for (c, r) in hidden:
            t = None
            for pc in range(0, 9):
                for pr in range(0, 9):
                    if not (pc or pr):
                        continue
                    # The period only has to hold around the cell: DOH's face, for one,
                    # breaks the pattern in the middle of its screen.
                    ok = all(codes[rr * COLS + cc] == codes[(rr + pr) * COLS + cc + pc]
                             for rr in range(max(4, r - 8), min(30, r + 1) - pr)
                             for cc in range(max(1, c - 4), min(COLS - 1, c + 5) - pc)
                             if (cc, rr) not in hidden and (cc + pc, rr + pr) not in hidden)
                    if not ok:
                        continue
                    for k in range(-4, 5):
                        cc, rr = c + k * pc, r + k * pr
                        if 0 < cc < COLS - 1 and 3 < rr < 31 and (cc, rr) not in hidden:
                            t = codes[rr * COLS + cc]
                            break
                    if t is not None:
                        break
                if t is not None:
                    break
            if t is None:
                raise SystemExit(f"ABORT: background {b} cell {c},{r} never visible")
            codes[r * COLS + c], colours[r * COLS + c] = t, normal
        sh = Counter(colours[r * COLS + 1] for r in range(4, 30)).most_common(1)[0][0]
        for (c, r) in hidden:                    # the walls shade column 1 and row 3
            if c == 1 or r == 3:
                colours[r * COLS + c] = sh
        screens[b] = {"codes": codes, "colors": colours, "normal": normal}
        shadow_of[normal] = sh
        print(f"background {b}: rounds {rs}, colour {normal} -> shadow {sh}, "
              f"{len(hidden)} cells inferred from the pattern period")

    # The replica writes the score digits and the blinking 1UP itself.
    for s in screens.values():
        for c in range(COLS):
            for r, blank in ((0, c < 8), (1, True)):
                if blank:
                    s["codes"][r * COLS + c], s["colors"][r * COLS + c] = 0x20, 0

    # --- validation: rebuild every round's playfield and diff with the arcade ---------
    bad = 0
    for n, R in rounds.items():
        s = screens[bg_id(n)]
        bc = brick_cells(R)
        for (c, r) in PLAYFIELD:
            if r == 31 and c <= 4:
                continue                  # life icons
            if (c, r) in bc:
                code = brick_code(bc[(c, r)])
                want = (bricks[code][0 if c % 2 == 1 else 1], bricks[code][2])
            else:
                t, col = s["codes"][r * COLS + c], s["colors"][r * COLS + c]
                if (c - 1, r - 1) in bc and col == s["normal"]:
                    col = shadow_of[s["normal"]]
                want = (t, col)
            got = cell(R["vram"], c, r)
            if got != want:
                bad += 1
                if bad <= 10:
                    print(f"  round {n} cell {c},{r}: built {want} arcade {got}")
    print(f"playfield cells rebuilt vs arcade VRAM: {bad} mismatches")
    if bad:
        raise SystemExit("ABORT: the tile model does not reproduce the arcade")

    R1 = rounds[1]
    life = {}
    for b, v in lives.items():
        (lt, lc), _ = v[1].most_common(1)[0]
        (rt, rc), _ = v[0].most_common(1)[0]
        life[str(b)] = [lt, rt, lc]
    print("life icons per background:", life)

    # The title screen (ARKANOID logo, credits), as the attract mode draws it.
    if os.path.exists(TITLE):
        vram = bytes.fromhex(re.search(r"VRAM (\w+)", open(TITLE).read()).group(1))
        t = {"codes": [], "colors": []}
        for r in range(ROWS):
            for c in range(COLS):
                code, col = cell(vram, c, r)
                if r == 1 or (r == 0 and c < 8) or r == 31:
                    code, col = 0x20, 0          # score, 1UP and CREDIT are drawn live
                t["codes"].append(code)
                t["colors"].append(col)
        screens["title"] = t

    # --- emit ------------------------------------------------------------------------
    rot = bytearray()
    for t in range(4096):
        px = hw.tiles[t]
        # player pixel (x, y) is native pixel (column y, row 7 - x)
        rot.extend(px[(7 - x) * 8 + y] for y in range(8) for x in range(8))
    packed = bytes((rot[i] << 4) | rot[i + 1] for i in range(0, len(rot), 2))
    pal = bytes(v for rgb in hw.palette for v in rgb)

    data = {
        "version": 1,
        "palette": base64.b64encode(pal).decode(),
        "tiles": base64.b64encode(packed).decode(),
        "screens": {str(k): v for k, v in screens.items()},
        "shadow": {str(k): v for k, v in shadow_of.items()},
        "bricks": {str(k): v for k, v in bricks.items()},
        "life": life,
        "palbank": {"round": (R1["ctrl"] >> 6) & 1,
                    "doh": (rounds[DOH_ROUND]["ctrl"] >> 6) & 1 if DOH_ROUND in rounds else 1},
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, "w") as f:
        f.write("// GENERATED by tools/build_rom_assets.py from roms/arkanoid.zip.\n")
        f.write("// Derived from Taito's copyrighted ROM data: local use only, never commit or publish.\n")
        f.write("window.ARKANOID_ROM = " + json.dumps(data, separators=(",", ":")) + ";\n")
    print(f"wrote {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    build()
