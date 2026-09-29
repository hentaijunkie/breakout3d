"""Arcade Arkanoid video hardware, re-implemented from the ROMs.

Decodes the three 3bpp character ROMs and the three 4-bit colour PROMs straight out of
roms/arkanoid.zip, and renders a frame from a videoram/spriteram dump taken with
tools/mame/vram_dump.lua. `python tools/arcade_gfx.py verify <dump> <snapdir>` re-renders
every dumped frame and diffs it against the MAME snapshot taken on the same frame.

Hardware model (Taito A75 board):
  gfx       4096 tiles of 8x8, 3 bitplanes; a75-05 is bit 2, a75-04 bit 1, a75-03 bit 0
  palette   512 entries, R/G/B from a75-07/08/09, 4 bits each on a resistor ladder
  tilemap   32x32, 2 bytes per cell at 0xe000: attr (colour<<3 | code bits 8-10), code
  sprites   16 x 4 bytes at 0xe800: x, 248-y, attr (colour<<3 | code bits 8-9), code.
            Each sprite is two stacked tiles, 2*code at y-8 and 2*code+1 at y.
  0xd008    bit 5 gfx bank (+2048 tiles), bit 6 palette bank (+32 colours)
  screen    256x224 (rows 16-239 visible), mounted rotated: the player sees 224x256
"""
import os
import sys
import zipfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
ROMZIP = os.path.join(ROOT, "roms", "arkanoid.zip")

NTILES = 4096
VIS_TOP, VIS_BOTTOM = 16, 240          # visible native rows


def load_roms(path=ROMZIP):
    with zipfile.ZipFile(path) as z:
        get = lambda n: z.read(n)
        return {
            "planes": [get("a75-03.ic64"), get("a75-04.ic63"), get("a75-05.ic62")],
            "prom": [get("a75-07.ic24"), get("a75-08.ic23"), get("a75-09.ic22")],
            "main": get("a75-01-1.ic17") + get("a75-11.ic16"),
        }


def decode_tiles(planes):
    """tiles[t] is a 64-entry list of 3-bit pixel values, row-major."""
    p0, p1, p2 = planes
    tiles = []
    for t in range(NTILES):
        px = []
        for y in range(8):
            a, b, c = p0[t * 8 + y], p1[t * 8 + y], p2[t * 8 + y]
            for x in range(8):
                s = 7 - x
                px.append(((a >> s) & 1) | (((b >> s) & 1) << 1) | (((c >> s) & 1) << 2))
        tiles.append(px)
    return tiles


def _level(n):
    # Resistor-ladder weights; they reproduce every brick colour sampled from MAME
    # (e.g. silver body 0b1001 -> 143+14 = 157 = #9d).
    return (n & 1) * 0x0E + ((n >> 1) & 1) * 0x1F + ((n >> 2) & 1) * 0x43 + ((n >> 3) & 1) * 0x8F


def decode_palette(prom):
    r, g, b = prom
    return [(_level(r[i] & 15), _level(g[i] & 15), _level(b[i] & 15)) for i in range(512)]


class Hardware:
    def __init__(self, path=ROMZIP):
        roms = load_roms(path)
        self.tiles = decode_tiles(roms["planes"])
        self.palette = decode_palette(roms["prom"])
        self.main = roms["main"]

    def render_native(self, vram, spr, ctrl):
        """Returns a 256x256 list-of-rows of RGB tuples in the unrotated orientation."""
        gfxbank = (ctrl >> 5) & 1
        palbank = (ctrl >> 6) & 1
        flipx, flipy = ctrl & 1, (ctrl >> 1) & 1
        W = H = 256
        idx = [[0] * W for _ in range(H)]      # palette index per pixel

        for ty in range(32):
            for tx in range(32):
                o = (ty * 32 + tx) * 2
                attr, lo = vram[o], vram[o + 1]
                code = lo + ((attr & 7) << 8) + 2048 * gfxbank
                col = ((attr & 0xF8) >> 3) + 32 * palbank
                tile = self.tiles[code & (NTILES - 1)]
                for y in range(8):
                    row = idx[ty * 8 + y]
                    for x in range(8):
                        row[tx * 8 + x] = col * 8 + tile[y * 8 + x]

        for o in range(0, 64, 4):
            sx = spr[o]
            sy = 248 - spr[o + 1]
            if flipx: sx = 248 - sx
            if flipy: sy = 248 - sy
            attr = spr[o + 2]
            code = spr[o + 3] + ((attr & 3) << 8) + 1024 * gfxbank
            col = ((attr & 0xF8) >> 3) + 32 * palbank
            for half, dy in ((0, sy + (8 if flipy else -8)), (1, sy)):
                tile = self.tiles[(2 * code + half) & (NTILES - 1)]
                for y in range(8):
                    for x in range(8):
                        v = tile[(7 - y if flipy else y) * 8 + (7 - x if flipx else x)]
                        if v == 0:
                            continue
                        X, Y = sx + x, dy + y
                        if 0 <= X < W and 0 <= Y < H:
                            idx[Y][X] = col * 8 + v
        return idx

    def to_image(self, idx):
        """Crops to the visible area and rotates to the 224x256 orientation the player sees."""
        from PIL import Image
        vis = idx[VIS_TOP:VIS_BOTTOM]
        im = Image.new("RGB", (256, len(vis)))
        im.putdata([self.palette[v] for row in vis for v in row])
        return im.transpose(Image.Transpose.ROTATE_270)


def parse_dump(path):
    frames, cur = [], None
    for line in open(path):
        line = line.rstrip("\n")
        if line.startswith("=== FRAME"):
            cur = {"frame": int(line.split()[2])}
            frames.append(cur)
        elif cur is not None and " " in line:
            k, v = line.split(" ", 1)
            cur[k] = bytes.fromhex(v) if k != "CTRL" else int(v, 16)
    return frames


def verify(dump, snapdir):
    from PIL import Image
    hw = Hardware()
    shots = sorted(f for f in os.listdir(snapdir) if f.endswith(".png"))
    frames = parse_dump(dump)
    bad_total = 0
    for f, shot in zip(frames, shots):
        im = hw.to_image(hw.render_native(f["VRAM"], f["SPR"], f["CTRL"]))
        ref = Image.open(os.path.join(snapdir, shot)).convert("RGB")
        if im.size != ref.size:
            print(f"frame {f['frame']}: size {im.size} vs {ref.size}")
            bad_total += 1
            continue
        a, b = im.load(), ref.load()
        bad = sum(1 for y in range(im.size[1]) for x in range(im.size[0]) if a[x, y] != b[x, y])
        bad_total += bad
        print(f"frame {f['frame']} vs {shot}: {bad} mismatching pixels")
        if bad:
            im.save(os.path.join(snapdir, "render_" + shot))
    return bad_total


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "verify":
        sys.exit(1 if verify(sys.argv[2], sys.argv[3]) else 0)
    print(__doc__)
