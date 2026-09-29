-- Captures the gold brick's animation cycle.
-- Advances to a round that contains gold bricks (round 3), then snapshots a burst of
-- consecutive frames so the palette cycle can be sampled off the pixels.
local BRICKS_LEFT = 0xed83
local TARGET = 3
local F, frame, mem = {}, 0, nil
local state, wait, round = "boot", 0, 1
local shots = 0

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 30 then
    for _, p in pairs(manager.machine.ioport.ports) do
      for n, f in pairs(p.fields) do F[n] = f end
    end
    mem = manager.machine.devices[":maincpu"].spaces["program"]
  end
  if frame < 40 then return end
  if frame >= 300 and frame < 700 then F["Coin 1"]:set_value(((frame-300)%40)<8 and 1 or 0) end
  if frame >= 750 and frame < 800 then F["1 Player Start"]:set_value(1)
  elseif frame == 800 then F["1 Player Start"]:set_value(0) end
  if frame < 1300 then return end

  if state == "boot" then state, wait = "settle", 60 end

  if state == "settle" then
    wait = wait - 1
    if wait <= 0 then
      if round == TARGET then
        state, wait = "predelay", 240
        print("-- reached round " .. round .. ", capturing frames")
      elseif mem:read_u8(BRICKS_LEFT) > 0 then
        mem:write_u8(BRICKS_LEFT, 0)
        state, wait = "advance", 240
      end
    end

  elseif state == "advance" then
    wait = wait - 1
    if mem:read_u8(BRICKS_LEFT) > 0 then
      round = round + 1
      state, wait = "settle", 90
    elseif wait <= 0 then
      print("-- stalled"); manager.machine:exit()
    end

  elseif state == "predelay" then
    wait = wait - 1
    if wait <= 0 then
      state = "shoot"
      print("-- round " .. round .. " fully drawn, capturing frames")
    end

  elseif state == "shoot" then
    -- one snapshot per frame for two seconds: any cycle shorter than that is captured
    manager.machine.video:snapshot()
    shots = shots + 1
    if shots >= 120 then manager.machine:exit() end
  end
end)
