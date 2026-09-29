"""Checks every constant in arkanoid_arcade.js against the arcade program ROM.

    python tools/verify_arcade_tables.py

Reads a75-01-1.ic17 + a75-11.ic16 from roms/arkanoid.zip, evaluates arkanoid_arcade.js
with node, and compares each table with the bytes at the address its comment cites.
Also checks the instructions that hold single constants (speed cap, ceiling rows, extra
life steps, capsule and escape bonuses), so a wrong claim about the ROM fails here.
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arcade_gfx import ROOT, load_roms  # noqa: E402

rom = load_roms()["main"]
src = os.path.join(ROOT, "arkanoid_arcade.js")
js = r"""
const fs = require('fs');
const M = new Function(fs.readFileSync(process.argv[1], 'utf8') + `;return {
  nib: ARK_DIR_NIBBLES, quad: ARK_QUADRANT_FLAGS, phase: ARK_PHASE_BITS, steps: ARK_STEP_TABLES,
  hits: ARK_SPEEDUP_HITS, max: ARK_SPEED_MAX, ceiling: ARK_CEILING_SPEED,
  zones: ARK_VAUS_ZONE_LIMITS, left: ARK_VAUS_DIR_LEFT, right: ARK_VAUS_DIR_RIGHT,
  points: ARK_BRICK_POINTS, caps: ARK_CAPSULE_SPRITES, bonus: ARK_POINTS,
  silver: Array.from({length: 32}, (_, i) => arkSilverPoints(i + 1)),
  lives: [arkNextExtraLife(0), arkNextExtraLife(1), arkNextExtraLife(2), arkNextExtraLife(3)],
  vaus: ARK_VAUS
};`)();
console.log(JSON.stringify(M));
"""
M = json.loads(subprocess.check_output(["node", "-e", js, src], text=True))

fail = []


def check(name, got, want):
    ok = list(got) == list(want)
    print(f"  {'ok ' if ok else 'BAD'} {name}")
    if not ok:
        fail.append(f"{name}: js {list(got)} rom {list(want)}")


def rom_bytes(a, n):
    return list(rom[a:a + n])


def expect_code(addr, hexbytes, what):
    want = bytes.fromhex(hexbytes.replace(" ", ""))
    got = rom[addr:addr + len(want)]
    ok = got == want
    print(f"  {'ok ' if ok else 'BAD'} {what} @ {addr:04x}")
    if not ok:
        fail.append(f"{what} @ {addr:04x}: rom {got.hex()} want {want.hex()}")


def bcd(b):
    return (b >> 4) * 10 + (b & 15)


print("tables")
check("direction nibbles 0x126A", M["nib"], rom_bytes(0x126A, 16))
check("quadrant flags 0x127A", M["quad"], rom_bytes(0x127A, 4))
check("phase bits 0x1223", M["phase"], rom_bytes(0x1223, 4))
for nib, addr in (("1", 0x1227), ("5", 0x1231), ("7", 0x123B), ("15", 0x1245)):
    check(f"step table class {nib} 0x{addr:04X}", M["steps"][nib], rom_bytes(addr, 10))
check("speed-up hits 0x094C", M["hits"], rom_bytes(0x094C, 16))
check("ceiling speed 0x1462", M["ceiling"], rom_bytes(0x1462, 34))
check("Vaus zone limits 0x140C", M["zones"], rom_bytes(0x140C, 3))


def dir_table(ptr_table):
    ptrs = [rom[ptr_table + 2 * i] | (rom[ptr_table + 2 * i + 1] << 8) for i in range(3)]
    return [rom[p + 4] for p in ptrs]            # centre, middle, edge (b = 1, 2, 3)


check("Vaus left directions 0x140F", [M["left"]["centre"], M["left"]["middle"], M["left"]["edge"]],
      dir_table(0x140F))
check("Vaus right directions 0x1415", [M["right"]["centre"], M["right"]["middle"], M["right"]["edge"]],
      dir_table(0x1415))
check("brick points 0x5A63", M["points"], [bcd(rom[0x5A63 + 2 * i]) * 10 for i in range(8)])
check("silver points 0x5A73", M["silver"],
      [(bcd(rom[0x5A73 + 2 * i]) + 100 * bcd(rom[0x5A74 + 2 * i])) * 10 for i in range(32)])
caps = [rom[0x5319 + 2 * i:0x531B + 2 * i] for i in range(7)]
check("capsule sprites 0x5319", [M["caps"][str(t)][0] for t in range(1, 8)],
      [0x180 + c[1] for c in caps])
check("capsule colours 0x5319", [M["caps"][str(t)][1] for t in range(1, 8)], [c[0] for c in caps])

print("instructions")
expect_code(0x11C3, "fe 01 20 05 11 27 12 18 15 fe 05 20 05 11 31 12 18 0c fe 07 20 05 11 3b 12 18 03 11 45 12",
            "speed class -> step table dispatch")
expect_code(0x091E, "3a 62 c4 fe 0e 30 04 3c 32 62 c4", f"speed level capped at {M['max']}")
if M["max"] != 14:
    fail.append("speed max")
expect_code(0x10D8, "dd 7e 02 c6 02 fe 0f 38 02 3e 0e", "shallow directions move 2 levels faster")
expect_code(0x0916, "fe 18 38 42", "speed-up only while moving up")
expect_code(0x1321, "fe e4 da 1b 14 fe ec d2 1b 14", "Vaus contact rows 0xE4..0xEB")
expect_code(0x141E, "3e 1c ba 38 0d", "left wall at s1 <= 0x1C")
expect_code(0x1430, "3e e0 ba 30 0d", "right wall at s1 > 0xE0")
expect_code(0x1442, "3e 1c bb 38 72", "ceiling at nx <= 0x1C")
expect_code(0x542E, "d6 02 d8 c8 32 62 c4", "Slow capsule: level - 2, never below 1")
expect_code(0x53DD, "11 00 01 cd 23 27", f"capsule bonus {M['bonus']['capsule']}")
expect_code(0x0DA1, "06 64 11 10 00 cd 23 27", f"escape bonus {M['bonus']['escape']} (100 x 100)")
expect_code(0x27F5, "fe 01 20 04 3e 40 18 02 3e 60", "extra lives: +40,000 then +60,000")
check("extra life thresholds", M["lives"], [20000, 60000, 120000, 180000])
expect_code(0x13CC, "3e 78 dd 77 0b", f"Catch holds the ball {M['vaus']['catchTimer']} frames")
expect_code(0x0cd0, "fe 16", "Vaus left limit s1 0x16")
expect_code(0x0ce7, "3e d9", "Vaus right limit s1 0xD9")
expect_code(0x593A, "3a 66 ef a7 ed 5f 20 01 7e", "capsule type = ld a,r (its Z flag skips the score read)")
expect_code(0x5944, "e6 07 28 4c b8 20 02 3e 06", "capsule type & 7; 0 = none; repeat -> Disruption")
expect_code(0x5963, "7e e1 cb 3f cb 3f cb 3f cb 3f e6 07", "B/P re-roll from the score's hundreds digit")

if fail:
    print("\nFAIL:\n  " + "\n  ".join(fail))
    sys.exit(1)
print("\nPASS - arkanoid_arcade.js matches the arcade ROM")
