-- Dumps main-CPU RAM once, at DUMP_FRAME. Set MODE via the MAMEMODE env var:
--   demo -> no input, dumps while the attract demo plays (Round 7)
--   r1   -> inserts a credit and dumps on Round 1
local MODE = os.getenv("MAMEMODE") or "demo"
local DUMP_FRAME = (MODE == "demo") and 1560 or 1450
local F, frame, mem = {}, 0, nil
local LO, HI = 0xc000, 0xefff

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 30 then
    for _, p in pairs(manager.machine.ioport.ports) do
      for n, f in pairs(p.fields) do F[n] = f end
    end
    mem = manager.machine.devices[":maincpu"].spaces["program"]
  end
  if frame < 40 then return end

  if MODE == "r1" then
    if frame >= 300 and frame < 700 then F["Coin 1"]:set_value(((frame - 300) % 40) < 8 and 1 or 0) end
    if frame >= 750 and frame < 800 then F["1 Player Start"]:set_value(1)
    elseif frame == 800 then F["1 Player Start"]:set_value(0) end
  end

  if frame == DUMP_FRAME then
    manager.machine.video:snapshot()
    print("=== DUMP " .. MODE .. " ===")
    for base = LO, HI, 32 do
      local t = {}
      for a = base, base + 31 do t[#t + 1] = string.format("%02x", mem:read_u8(a)) end
      print(string.format("%04x %s", base, table.concat(t)))
    end
    print("=== END ===")
  end
  if frame > DUMP_FRAME + 40 then manager.machine:exit() end
end)
