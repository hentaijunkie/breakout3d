-- Per-frame trace of spriteram and work RAM during a real game, for reverse engineering.
--
--   TRACEFILE   output path
--   TRACEFROM   first frame to log (default 1300)
--   TRACETO     last frame to log  (default 1900)
--   LAUNCHAT    frame at which to press the button (default 1350)
--   AUTOPLAY    1 = keep the Vaus under the ball by rewriting its X in RAM
--   VAUSX       RAM address of the Vaus X (hex), needed by AUTOPLAY
--   BALLSPR     spriteram offset of the ball sprite (decimal), needed by AUTOPLAY
--   WATCH       hex range "lo-hi": also log every write there with the CPU PC that did it
--
-- Lines: "F <frame> <spr hex> <c000-c7ff hex> <e840-efff hex>"
--        "W <frame> <pc> <addr> <data>"          (WATCH)
local OUT = assert(os.getenv("TRACEFILE"), "TRACEFILE not set")
local FROM = tonumber(os.getenv("TRACEFROM") or "1300")
local TO = tonumber(os.getenv("TRACETO") or "1900")
local LAUNCH = tonumber(os.getenv("LAUNCHAT") or "1350")
local AUTOPLAY = os.getenv("AUTOPLAY") == "1"
local VAUSX = tonumber(os.getenv("VAUSX") or "0", 16)
local BALLSPR = tonumber(os.getenv("BALLSPR") or "0")
local WATCH = os.getenv("WATCH")
local COIN_AT = tonumber(os.getenv("COINAT") or "300")

local F, frame, mem, cpu = {}, 0, nil, nil
local taps = {}
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
    cpu = manager.machine.devices[":maincpu"]
    mem = cpu.spaces["program"]
    if WATCH then
      local lo, hi = WATCH:match("(%x+)-(%x+)")
      taps[#taps + 1] = mem:install_write_tap(tonumber(lo, 16), tonumber(hi, 16), "watch", function(offset, data, mask)
        if frame >= FROM and frame <= TO then
          fh:write(string.format("W %d %04x %04x %02x ix=%04x iy=%04x\n", frame,
            cpu.state["PC"].value, offset, data, cpu.state["IX"].value, cpu.state["IY"].value))
        end
      end)
    end
    if AUTOPLAY then
      taps[#taps + 1] = mem:install_write_tap(VAUSX, VAUSX, "vaus", function(offset, data, mask)
        if frame < LAUNCH + 5 then return data end
        local bx = mem:read_u8(0xe800 + BALLSPR)
        return math.max(0, math.min(255, bx))
      end)
    end
  end
  if frame < 40 then return end

  if frame >= COIN_AT and frame < COIN_AT + 400 then
    F["Coin 1"]:set_value(((frame - COIN_AT) % 40) < 8 and 1 or 0)
  end
  if frame >= COIN_AT + 450 and frame < COIN_AT + 500 then F["1 Player Start"]:set_value(1)
  elseif frame == COIN_AT + 500 then F["1 Player Start"]:set_value(0) end
  if frame >= LAUNCH and frame < LAUNCH + 10 then F["P1 Button 1"]:set_value(1)
  elseif frame == LAUNCH + 10 then F["P1 Button 1"]:set_value(0) end

  if frame >= FROM and frame <= TO then
    fh:write(string.format("F %d %s %s %s\n", frame, hex(0xe800, 0xe83f), hex(0xc000, 0xc7ff), hex(0xe840, 0xefff)))
  end
  if frame > TO then
    fh:close()
    manager.machine:exit()
  end
end)
