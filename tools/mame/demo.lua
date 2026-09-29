local frame = 0
emu.register_frame_done(function()
  frame = frame + 1
  if frame >= 1430 and frame <= 1600 and frame % 10 == 0 then
    manager.machine.video:snapshot()
  end
  if frame > 1620 then manager.machine:exit() end
end)
