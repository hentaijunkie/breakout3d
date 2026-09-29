local F, frame = {}, 0
local function grab()
  for _, port in pairs(manager.machine.ioport.ports) do
    for name, f in pairs(port.fields) do F[name] = f end
  end
end
local function hold(n, a, b)
  if frame >= a and frame < b then F[n]:set_value(1)
  elseif frame == b then F[n]:set_value(0) end
end
emu.register_frame_done(function()
  frame = frame + 1
  if frame == 30 then grab() end
  if frame < 40 then return end
  hold("Coin 1", 300, 360)
  hold("1 Player Start", 420, 470)
  if frame > 520 and (frame % 240) < 10 then F["P1 Button 1"]:set_value(1)
  elseif frame > 520 then F["P1 Button 1"]:set_value(0) end
  if frame > 500 and frame % 25 == 0 then manager.machine.video:snapshot() end
  if frame > 1400 then manager.machine:exit() end
end)
