-- Rips every round in one run: brick grid, full video RAM and the round's speed.
--
-- Mechanism: 0xed83 is BRICKS_LEFT (verified: 78 on round 1, 98 on the attract demo,
-- which match the brick counts exactly). Zeroing it makes the game clear the round and
-- build the next one, so we can walk the whole table without playing.
--
-- Per round it waits 118 frames - the "ROUND n / READY" text is gone and no enemy has
-- come out of the doors yet - then dumps:
--   the 13x28 window at 0xed64 (brick bytes, incl. capsule and silver-hit bits),
--   VRAM 0xe000-0xe7ff (background, walls, shadows, HUD) and CTRL (bank register),
--   0xc462 (ball speed level the round starts at) and 0xed72 (round index),
-- and takes a snapshot. The ball is launched by the game after its hold timer, but we
-- clear the round before it can reach the bottom, so no life is ever lost.
--
--   DUMPFILE   output path (default tools/mame/arcade_rip.txt)
local BRICKS_LEFT, GRID, W, H = 0xed83, 0xed64, 13, 28
local OUT = os.getenv("DUMPFILE") or "tools/mame/arcade_rip.txt"
local F, frame, mem = {}, 0, nil
local state, wait, round = "boot", 0, 1
local MAX_ROUNDS = 33
local ctrl, tap = 0, nil
local fh = assert(io.open(OUT, "w"))

local function hex(lo, hi)
  local t = {}
  for a = lo, hi do t[#t + 1] = string.format("%02x", mem:read_u8(a)) end
  return table.concat(t)
end

local function dump(n)
  fh:write("=== ROUND " .. n .. " ===\n")
  for r = 0, H - 1 do
    local t = {}
    for c = 0, W - 1 do t[#t + 1] = string.format("%02x", mem:read_u8(GRID + r * W + c)) end
    fh:write(table.concat(t, " ") .. "\n")
  end
  fh:write("=== END ===\n")
  fh:write(string.format("SPEED %02x\nINDEX %02x\nCTRL %02x\n", mem:read_u8(0xc462), mem:read_u8(0xed72), ctrl))
  fh:write("VRAM " .. hex(0xe000, 0xe7ff) .. "\n")
  fh:flush()
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 30 then
    for _, p in pairs(manager.machine.ioport.ports) do
      for n, f in pairs(p.fields) do F[n] = f end
    end
    mem = manager.machine.devices[":maincpu"].spaces["program"]
    tap = mem:install_write_tap(0xd008, 0xd008, "ctrl", function(offset, data, mask) ctrl = data end)
  end
  if frame < 40 then return end

  if frame >= 300 and frame < 700 then F["Coin 1"]:set_value(((frame-300)%40)<8 and 1 or 0) end
  if frame >= 750 and frame < 800 then F["1 Player Start"]:set_value(1)
  elseif frame == 800 then F["1 Player Start"]:set_value(0) end
  if frame < 1300 then return end

  if state == "boot" then state, wait = "settle", 118 end

  if state == "settle" then
    wait = wait - 1
    if wait <= 0 then
      local n = mem:read_u8(BRICKS_LEFT)
      dump(round)
      manager.machine.video:snapshot()
      if n > 0 and round < MAX_ROUNDS then
        mem:write_u8(BRICKS_LEFT, 0)
        state, wait = "advance", 400
      else
        fh:close()
        manager.machine:exit()
      end
    end

  elseif state == "advance" then
    wait = wait - 1
    if mem:read_u8(BRICKS_LEFT) > 0 or (round == MAX_ROUNDS - 1 and wait < 200) then
      round = round + 1
      state, wait = "settle", 118
    elseif wait <= 0 then
      fh:write("-- stalled after round " .. round .. "\n")
      fh:close()
      manager.machine:exit()
    end
  end
end)
