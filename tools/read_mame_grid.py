"""Read the 13-column arcade brick grid straight off a MAME frame."""
import sys
from PIL import Image
from collections import Counter

PAL = {
    (255, 255, 255): "W", (255, 143, 0): "O", (0, 255, 255): "C", (0, 255, 0): "G",
    (255, 0, 0): "R", (0, 0, 255): "B", (255, 0, 255): "P", (255, 255, 0): "Y",
    (157, 157, 157): "S", (210, 210, 210): "S",
    (255, 136, 0): "O", (0, 112, 255): "B", (241, 241, 241): "W",
}

def read(path, ox=8, oy=0, cols=13, rows=32):
    im = Image.open(path).convert("RGB")
    px = im.load()
    W, H = im.size
    out = []
    for r in range(rows):
        y0 = oy + r * 8
        if y0 + 7 > H:
            break
        line = ""
        for c in range(cols):
            x0 = ox + c * 16
            block = [px[x0 + x, y0 + y] for y in range(7) for x in range(15)]
            col, n = Counter(block).most_common(1)[0]
            line += PAL.get(col, ".") if n > 60 else "."
        out.append(line)
    return out

for p in sys.argv[1:]:
    print(f"===== {p} =====")
    g = read(p)
    for i, line in enumerate(g):
        if line.strip("."):
            print(f"  {i:2d} {line}")
