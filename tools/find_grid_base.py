"""Pin down the brick-grid base address and the byte -> colour mapping."""
import os
import re

def load(path):
    ram = {}
    for line in open(path):
        m = re.match(r"^([0-9a-f]{4}) ([0-9a-f]{64})$", line.strip())
        if m:
            base = int(m.group(1), 16)
            for i, b in enumerate(bytes.fromhex(m.group(2))):
                ram[base + i] = b
    return ram

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mame")
r1 = load(os.path.join(HERE, "ram_r1.txt"))      # tools/mame/dump.lua, MAMEMODE=r1
d7 = load(os.path.join(HERE, "ram_demo.txt"))    # tools/mame/dump.lua, MAMEMODE=demo
W = 13

# Round 7 exactly as read off the screen (grid rows 7..20, 13 columns).
DEMO = [
    ".....YYP.....", "....YYPPB....", "...YYPPBBR...", "...YPPBBRR...",
    "..YPPBBRRGG..", "..PPBBRRGGC..", "..PBBRRGGCC..", "..BBRRGGCCO..",
    "..BRRGGCCOO..", "..RRGGCCOOW..", "...GGCCOOW...", "...GCCOOWW...",
    "....COOWW....", ".....OWW.....",
]

def rows(ram, base, n):
    return [[ram.get(base + r * W + c, 0) for c in range(W)] for r in range(n)]

# Find base B such that the demo grid's occupancy matches DEMO at grid rows 7..20.
print("=== searching for grid base ===")
best = []
for B in range(0xec00, 0xef00):
    g = rows(d7, B, 28)
    ok = True
    for i, line in enumerate(DEMO):
        row = g[7 + i]
        for c in range(W):
            if (line[c] != ".") != (row[c] != 0):
                ok = False
                break
        if not ok:
            break
    if ok:
        best.append(B)
print("bases matching the demo occupancy:", [f"{b:04x}" for b in best])

for B in best[:3]:
    print(f"\n=== base {B:04x} ===")
    # colour mapping from the demo
    mapping = {}
    g = rows(d7, B, 28)
    for i, line in enumerate(DEMO):
        for c in range(W):
            if line[c] != ".":
                mapping.setdefault(g[7 + i][c], set()).add(line[c])
    print("  demo byte -> letters:", {f"{k:02x}": "".join(sorted(v)) for k, v in sorted(mapping.items())})

    # round 1 should be six full rows at grid rows 7..12
    g1 = rows(r1, B, 28)
    print("  round 1 rows 5..14:")
    for r in range(5, 15):
        print(f"    {r:2d} " + " ".join(f"{v:02x}" for v in g1[r]))

print("\n=== round variable ===")
for a in (0xed72,):
    print(f"  {a:04x}: r1={r1[a]}  demo={d7[a]}")
