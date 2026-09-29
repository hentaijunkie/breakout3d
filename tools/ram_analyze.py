"""Locate the brick grid and the round variable in Arkanoid arcade RAM."""
import os
import re
from collections import Counter

def load(path):
    ram = {}
    for line in open(path):
        m = re.match(r"^([0-9a-f]{4}) ([0-9a-f]{64})$", line.strip())
        if not m:
            continue
        base = int(m.group(1), 16)
        blob = bytes.fromhex(m.group(2))
        for i, b in enumerate(blob):
            ram[base + i] = b
    return ram

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mame")
r1 = load(os.path.join(HERE, "ram_r1.txt"))      # tools/mame/dump.lua, MAMEMODE=r1
d7 = load(os.path.join(HERE, "ram_demo.txt"))    # tools/mame/dump.lua, MAMEMODE=demo
print(f"bytes: r1={len(r1)} demo={len(d7)}")
addrs = sorted(set(r1) & set(d7))

# ---------- 1. brick grid: look for repeating 13-wide structure ----------
# Round 1 is 6 rows x 13 cols. Row-major -> 13 identical bytes in a row, six times.
print("\n=== windows with >=4 runs of 13 identical bytes (row-major, stride 13) ===")
lo, hi = min(addrs), max(addrs)
for start in range(lo, hi - 78):
    try:
        w = [r1[start + i] for i in range(78)]
    except KeyError:
        continue
    runs = [w[k * 13:(k + 1) * 13] for k in range(6)]
    good = sum(1 for x in runs if len(set(x)) == 1 and x[0] != 0)
    if good >= 4:
        print(f"  {start:04x}: " + " | ".join(
            f"{x[0]:02x}x13" if len(set(x)) == 1 else "mixed" for x in runs))

# Column-major -> the 6-colour sequence repeated 13 times.
print("\n=== windows that look column-major (period 6, repeated) ===")
for start in range(lo, hi - 78):
    try:
        w = [r1[start + i] for i in range(78)]
    except KeyError:
        continue
    if all(w[i] == w[i % 6] for i in range(78)) and len(set(w[:6])) >= 4:
        print(f"  {start:04x}: base={[f'{v:02x}' for v in w[:6]]}")

# ---------- 2. round variable: differs between the two dumps ----------
print("\n=== bytes that differ, small values (round-variable candidates) ===")
cand = [a for a in addrs
        if r1[a] != d7[a] and r1[a] in (0, 1) and d7[a] in (5, 6, 7, 8)]
print(f"  {len(cand)} candidates: " + ", ".join(f"{a:04x}(r1={r1[a]},demo={d7[a]})" for a in cand[:40]))

# ---------- 3. how much differs at all ----------
diff = [a for a in addrs if r1[a] != d7[a]]
print(f"\ntotal differing bytes: {len(diff)} of {len(addrs)}")
# Regions that are identical are probably ROM mirrors / unused
same_runs = []
i = 0
while i < len(addrs):
    j = i
    while j < len(addrs) and r1[addrs[j]] == d7[addrs[j]]:
        j += 1
    if j - i > 200:
        same_runs.append((addrs[i], addrs[j - 1], j - i))
    i = max(j, i + 1)
print("large identical regions:", [f"{a:04x}-{b:04x}({n})" for a, b, n in same_runs])
