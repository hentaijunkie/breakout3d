-- Plays a real game by itself and logs everything needed to reverse engineer and to
-- validate the replica frame by frame.
--
-- The Vaus is steered by rewriting the spinner value the main CPU stores at 0xc47c:
-- the game computes delta = new - previous (0xc461) and moves the Vaus by it, so we hand
-- it the delta that puts the Vaus under the lowest falling ball. The offset under the
-- ball cycles so every deflection zone gets exercised.
--
--   LOGFILE     output path (required)
--   FRAMES      how many frames to play after the start (default 20000)
--   INVINCIBLE  1 = never lose the ball (keeps the Vaus locked under it), default 1
--   FIRE        1 = press the button every 20 frames (lasers, catch release), default 1
--   POKE        "addr=val,addr=val@frame;..." one-shot RAM pokes, e.g. "c658=02@1500"
--   KEEPLIVES   1 = top the lives back up to 3 (to reach later rounds)
--   SKIPAT      N = zero BRICKS_LEFT every N frames, so the game moves to the next round
--
-- Log lines, one per frame:
--   F <frame> <spriteram> <c430-c4ff> <c650-c67f> <ed60-ed8f> <ef60-ef6f> d<delta>b<button>
--     <c4fe-c56f enemies> <ed8b-ee74 brick grid, 13 x 18>
--   V <frame> <offset>=<byte> ...          videoram bytes that changed this frame
local OUT = assert(os.getenv("LOGFILE"), "LOGFILE not set")
local FRAMES = tonumber(os.getenv("FRAMES") or "20000")
local INVINCIBLE = (os.getenv("INVINCIBLE") or "1") == "1"
local FIRE = (os.getenv("FIRE") or "1") == "1"
local KEEPLIVES = os.getenv("KEEPLIVES") == "1"          -- top the lives back up to 3
local SKIPAT = tonumber(os.getenv("SKIPAT") or "0")      -- clear the round every N frames
if SKIPAT == 0 then SKIPAT = nil end
local POKES = {}
for spec in string.gmatch(os.getenv("POKE") or "", "[^;]+") do
  local list, at = spec:match("(.+)@(%d+)")
  local t = {}
  for a, v in string.gmatch(list, "(%x+)=(%x+)") do t[#t + 1] = { tonumber(a, 16), tonumber(v, 16) } end
  POKES[tonumber(at)] = t
end

local START = 1300
local F, frame, mem = {}, 0, nil
local taps = {}
local fh = assert(io.open(OUT, "w"))
local vram_prev = {}
-- u = Vaus right sprite s1 (0xc43a) minus ball s1 at the moment of contact. The Vaus
-- catches the ball for -12 <= u <= 19; the ROM's zones are edge (u <= -10 or >= 18),
-- middle (-9..-5, 13..17) and centre (-4..12). Cycling through these hits every zone.
local offsets = { 0, 8, -7, 15, -11, 18, 4, -3 }
local off_i, last_hits = 1, -1
local seen_delta, seen_button = 0, 0
local BALLS = { { 0xc46b, 0xc4a5, 0xc43d }, { 0xc46c, 0xc4a9, 0xc449 }, { 0xc46d, 0xc4ad, 0xc455 } }
local hist = { {}, {}, {} }              -- s1 at the end of the last two frames, per ball

local function hex(lo, hi)
  local t = {}
  for a = lo, hi do t[#t + 1] = string.format("%02x", mem:read_u8(a)) end
  return table.concat(t)
end

-- The lowest active ball: its s1 predicted to the moment it next meets the Vaus, its
-- native x, and whether it is travelling up. The spinner is read before the ball moves,
-- and the Vaus collision uses the Vaus of the previous frame, so the ball will have
-- moved twice by the time our new Vaus position matters.
local function lowest_ball()
  local best, bs, up = -1, nil, false
  for i, s in ipairs(BALLS) do
    if mem:read_u8(s[1]) ~= 0 then
      local nx = mem:read_u8(s[2])
      local h = hist[i]
      local cur = h[2] or mem:read_u8(s[2] + 1)
      local v = (h[1] and h[2]) and (h[2] - h[1]) or 0
      if nx > best and nx < 0xf0 then
        best, bs, up = nx, cur + 2 * v, (mem:read_u8(s[3]) & 1) == 1
      end
    end
  end
  return bs, best, up
end

-- s1 of the falling capsule, or nil.
local function falling_capsule()
  if (mem:read_u8(0xc658) & 0x80) == 0 then return nil end
  local p = mem:read_u8(0xc65b) + 256 * mem:read_u8(0xc65c)
  if p < 0xc47d or p > 0xc4bc then return nil end
  local nx = mem:read_u8(p)
  if nx < 0x60 or nx >= 0xec then return nil end
  return mem:read_u8(p + 1)
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 30 then
    for _, p in pairs(manager.machine.ioport.ports) do
      for n, f in pairs(p.fields) do F[n] = f end
    end
    mem = manager.machine.devices[":maincpu"].spaces["program"]
    taps[#taps + 1] = mem:install_write_tap(0xc47c, 0xc47c, "spinner", function(offset, data, mask)
      if frame < START then return data end
      local prev = mem:read_u8(0xc461)
      local s, nx, up = lowest_ball()
      local cap = falling_capsule()
      local delta = 0
      if s then
        local hits = mem:read_u8(0xc476)
        if hits ~= last_hits then
          last_hits = hits
          off_i = off_i % #offsets + 1
        end
        local target = s + offsets[off_i]
        -- Go for a capsule only while the ball is safely on its way up.
        if cap and up and nx < 0xb0 then target = cap + 8 end
        delta = target - mem:read_u8(0xc43a)
        -- The game reads the delta as a signed byte: beyond +-127 it would wrap around.
        local lim = INVINCIBLE and 120 or 12
        delta = math.max(-lim, math.min(lim, delta))
      end
      seen_delta = delta
      return (prev + delta) & 0xff
    end)
    for i = 0xe000, 0xe7ff do vram_prev[i] = -1 end
  end
  if frame < 40 then return end

  if frame >= 300 and frame < 700 then F["Coin 1"]:set_value(((frame - 300) % 40) < 8 and 1 or 0) end
  if frame >= 750 and frame < 800 then F["1 Player Start"]:set_value(1)
  elseif frame == 800 then F["1 Player Start"]:set_value(0) end

  local b = 0
  if FIRE and frame >= START and (frame % 20) < 4 then b = 1 end
  F["P1 Button 1"]:set_value(b)
  seen_button = b

  for i, s in ipairs(BALLS) do
    if mem:read_u8(s[1]) ~= 0 then
      hist[i][1], hist[i][2] = hist[i][2], mem:read_u8(s[2] + 1)
    else
      hist[i] = {}
    end
  end
  if KEEPLIVES and frame >= START and mem:read_u8(0xed71) < 3 then mem:write_u8(0xed71, 3) end
  if SKIPAT and frame >= START and (frame - START) % SKIPAT == SKIPAT - 1 then
    mem:write_u8(0xed83, 0)              -- BRICKS_LEFT = 0: the game clears the round
  end

  if POKES[frame] then
    for _, p in ipairs(POKES[frame]) do mem:write_u8(p[1], p[2]) end
  end

  if frame >= START - 200 then
    fh:write(string.format("F %d %s %s %s %s %s d%db%d %s %s\n", frame, hex(0xe800, 0xe83f), hex(0xc430, 0xc4ff),
      hex(0xc650, 0xc67f), hex(0xed60, 0xed8f), hex(0xef60, 0xef6f), seen_delta, seen_button,
      hex(0xc4fe, 0xc56f), hex(0xed8b, 0xee74)))
    local ch = {}
    for a = 0xe000, 0xe7ff do
      local v = mem:read_u8(a)
      if v ~= vram_prev[a] then
        ch[#ch + 1] = string.format("%03x=%02x", a - 0xe000, v)
        vram_prev[a] = v
      end
    end
    if #ch > 0 then fh:write("V " .. frame .. " " .. table.concat(ch, " ") .. "\n") end
  end

  if frame > START + FRAMES then
    fh:close()
    manager.machine:exit()
  end
end)
