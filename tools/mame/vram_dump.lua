-- Dumps the arcade's video state next to a snapshot, so tools/arcade_gfx.py can
-- re-render the frame from ROM graphics and check it against MAME pixel for pixel.
--
--   MAMEMODE   demo | game          (game inserts a credit and starts 1P)
--   DUMPFRAMES comma-separated frame numbers to dump (default: a spread)
--   DUMPFILE   output path (default: tools/mame/vram_dump.txt)
--
-- Per frame it writes: the last value written to 0xd008 (gfx/palette bank, flips),
-- videoram 0xe000-0xe7ff, spriteram 0xe800-0xe83f and work RAM 0xe840-0xefff.
local MODE = os.getenv("MAMEMODE") or "demo"
local OUT = os.getenv("DUMPFILE") or "tools/mame/vram_dump.txt"
local want = {}
for n in string.gmatch(os.getenv("DUMPFRAMES") or "1500,1600,1700,1800", "%d+") do
  want[tonumber(n)] = true
end
local last = 0
for n in pairs(want) do if n > last then last = n end end

local F, frame, mem, ctrl, tap = {}, 0, nil, 0, nil
local fh = assert(io.open(OUT, "w"))

local function hex(lo, hi)
  local t = {}
  for a = lo, hi do t[#t + 1] = string.format("%02x", mem:read_u8(a)) end
  return table.concat(t)
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 30 then
    for _, p in pairs(manager.machine.ioport.ports) do
      for n, f in pairs(p.fields) do F[n] = f end
    end
    mem = manager.machine.devices[":maincpu"].spaces["program"]
    tap = mem:install_write_tap(0xd008, 0xd008, "ctrl", function(offset, data, mask)
      ctrl = data
    end)
  end
  if frame < 40 then return end

  if MODE == "game" then
    if frame >= 300 and frame < 700 then F["Coin 1"]:set_value(((frame - 300) % 40) < 8 and 1 or 0) end
    if frame >= 750 and frame < 800 then F["1 Player Start"]:set_value(1)
    elseif frame == 800 then F["1 Player Start"]:set_value(0) end
  end

  if want[frame] then
    manager.machine.video:snapshot()
    fh:write(string.format("=== FRAME %d ===\n", frame))
    fh:write(string.format("CTRL %02x\n", ctrl))
    fh:write("VRAM " .. hex(0xe000, 0xe7ff) .. "\n")
    fh:write("SPR " .. hex(0xe800, 0xe83f) .. "\n")
    fh:write("RAM " .. hex(0xe840, 0xefff) .. "\n")
    fh:flush()
  end
  if frame > last then
    fh:close()
    manager.machine:exit()
  end
end)
