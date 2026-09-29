/**
 * Replays a MAME recording (tools/mame/autoplay.lua) through arkanoid_arcade_engine.js
 * and compares the two games frame by frame, over the whole recording.
 *
 *   node tools/verify_engine_replay.js <autoplay log> [--verbose]
 *
 * The engine's state is loaded from the arcade's RAM (balls, Vaus, speed, hit counter,
 * bricks, capsule, laser shots, score) and both games then run on the same inputs: the
 * spinner delta and the button the arcade saw. After every frame the balls, speed,
 * Vaus, score, capsule, shots and the whole brick grid are compared.
 *
 * Enemies are only modelled in the engine, so a divergence next to an enemy (a ball or
 * a shot hitting one) is expected: the tool re-loads the state and carries on. Anything
 * else is reported as a failure. The engine is also re-synced after each death and
 * round change, since the intros are not part of the comparison.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = { console, Math };
vm.createContext(ctx);
for (const f of ['arkanoid_arcade.js', 'arkanoid_levels_arcade.js', 'arkanoid_arcade_engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const Game = vm.runInContext('ArkanoidArcadeGame', ctx);

const logPath = process.argv[2];
const verbose = process.argv.includes('--verbose');
if (!logPath) { console.error('usage: node tools/verify_engine_replay.js <log> [--verbose]'); process.exit(2); }

// --- parse ---------------------------------------------------------------------------
const frames = [];
for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
  if (line[0] !== 'F') continue;
  const p = line.split(' ');
  const m = /d(-?\d+)b(\d)/.exec(p[7]);
  if (!p[9]) { console.error('this recording has no brick grid - record it again with tools/mame/autoplay.lua'); process.exit(2); }
  frames.push({
    n: +p[1], spr: Buffer.from(p[2], 'hex'), c4: Buffer.from(p[3], 'hex'),
    c6: Buffer.from(p[4], 'hex'), ed: Buffer.from(p[5], 'hex'), ef: Buffer.from(p[6], 'hex'),
    delta: +m[1], button: +m[2], en: Buffer.from(p[8], 'hex'), grid: Buffer.from(p[9], 'hex')
  });
}
const R = (f, a) => {
  if (a >= 0xc430 && a <= 0xc4fd) return f.c4[a - 0xc430];
  if (a >= 0xc4fe && a <= 0xc56f) return f.en[a - 0xc4fe];
  if (a >= 0xc650 && a <= 0xc67f) return f.c6[a - 0xc650];
  if (a >= 0xed60 && a <= 0xed8f) return f.ed[a - 0xed60];
  if (a >= 0xef60 && a <= 0xef6f) return f.ef[a - 0xef60];
  throw new Error('address not recorded: ' + a.toString(16));
};
const bcd = b => (b >> 4) * 10 + (b & 15);
const scoreOf = f => (bcd(R(f, 0xc4d7)) * 10000 + bcd(R(f, 0xc4d8)) * 100 + bcd(R(f, 0xc4d9))) * 10;
const BALLS = [[0xc46b, 0xc43d, 0xc4a5], [0xc46c, 0xc449, 0xc4a9], [0xc46d, 0xc455, 0xc4ad]];
const SHOTS = [[0xc665, 0xc4b9], [0xc667, 0xc485]];

// --- load the engine from the arcade's RAM ------------------------------------------------
// Ball 1's frame counter (0xc442) only advances while the main game loop is running; it
// stands still through intros, deaths and round changes.
const playing = (f, prev) => R(f, 0xc46b) && R(f, 0xc442) !== R(prev, 0xc442);

function canSync(f, prev) {
  return playing(f, prev) && !(R(f, 0xc463) & 0x80) && R(f, 0xed72) < 32 &&
         R(f, 0xef62) === 0 && !R(f, 0xc4ce);
}

function load(g, f) {
  g.round = R(f, 0xed72) + 1;
  g.isDoh = false;
  g.doh = null;
  g.phase = 'play';
  g.t = 1000;
  g.enemies = [];
  g.enemyTimer = 1e9;
  g.lives = R(f, 0xed71);
  g.extraAwarded = R(f, 0xef6a);
  g.score = scoreOf(f);
  g.speedLevel = R(f, 0xc462);
  g.hitCounter = R(f, 0xef63);
  g.catchOffset = R(f, 0xc47a);
  g.multiball = R(f, 0xc469);
  g.pGiven = R(f, 0xc474) === 7;
  g.c658 = R(f, 0xc658) & 0x7f;
  g.c659 = R(f, 0xc659);
  g.bricks.set(f.grid);
  g.bricksLeft = R(f, 0xed83);
  g.portal = { open: false, t: 0 };
  g.escape = null;
  const v = g.vaus;
  v.right = R(f, 0xc43a); v.left = R(f, 0xc43b);
  v.mode = R(f, 0xc465); v.target = R(f, 0xc463) & 0x7f; v.trans = null;
  v.mid = v.mode === 2 ? R(f, 0xc4ba) : null;
  BALLS.forEach(([act, o, s], i) => {
    const b = g.balls[i];
    b.active = !!R(f, act);
    Object.assign(b, {
      flags: R(f, o), nib: R(f, o + 1), level: R(f, o + 2), d: R(f, o + 3),
      ctr5: R(f, o + 5), ctr6: R(f, o + 6), ix7: R(f, o + 7), ix8: R(f, o + 8),
      ix9: R(f, o + 9), ix10: R(f, o + 10), hold: R(f, o + 11), nx: R(f, s), s1: R(f, s + 1)
    });
  });
  if (R(f, 0xc658) & 0x80) {
    const q = R(f, 0xc65b) | (R(f, 0xc65c) << 8);
    g.capsule = { type: R(f, 0xc658) & 0x7f, nx: R(f, q), s1: R(f, q + 1),
                  frame: R(f, 0xc662), timer: R(f, 0xc661) };
  } else {
    g.capsule = null;
  }
  SHOTS.forEach(([st, sp], i) => {
    const s = g.shots[i], flags = R(f, st);
    s.active = !!(flags & 0x80);
    s.impact = flags & 0x40 ? R(f, st + 1) + 1 : 0;
    s.nx = R(f, sp); s.s1 = R(f, sp + 1);
  });
  g.buttonState = false;
  g.fireEvent = !(R(f, 0xc4c0) & 1);
}

// --- compare ---------------------------------------------------------------------------
function compare(g, f) {
  const want = {}, got = {};
  BALLS.forEach(([act, o, s], i) => {
    const on = !!R(f, act);
    want[`ball${i + 1}`] = on ? `${R(f, s)},${R(f, s + 1)} D${R(f, o + 3)}` : 'off';
    const b = g.balls[i];
    got[`ball${i + 1}`] = b.active ? `${b.nx},${b.s1} D${b.d}` : 'off';
  });
  want.level = R(f, 0xc462); got.level = g.speedLevel;
  want.hits = R(f, 0xef63); got.hits = g.hitCounter;
  want.vaus = `${R(f, 0xc43a)}/${R(f, 0xc43b)}`; got.vaus = `${g.vaus.right}/${g.vaus.left}`;
  want.score = scoreOf(f); got.score = g.score;
  want.bricks = R(f, 0xed83); got.bricks = g.bricksLeft;
  let gridDiff = -1;
  for (let i = 0; i < f.grid.length; i++) if (f.grid[i] !== g.bricks[i]) { gridDiff = i; break; }
  want.grid = 'same';
  got.grid = gridDiff < 0 ? 'same' : `cell ${gridDiff}: ${g.bricks[gridDiff]} vs ${f.grid[gridDiff]}`;
  if (R(f, 0xc658) & 0x80) {
    const q = R(f, 0xc65b) | (R(f, 0xc65c) << 8);
    want.capsule = `${R(f, 0xc658) & 0x7f}@${R(f, q)},${R(f, q + 1)}`;
  } else want.capsule = '-';
  got.capsule = g.capsule ? `${g.capsule.type}@${g.capsule.nx},${g.capsule.s1}` : '-';
  SHOTS.forEach(([st, sp], i) => {
    const fl = R(f, st);
    want[`shot${i + 1}`] = fl & 0x80 ? `${R(f, sp)},${R(f, sp + 1)}${fl & 0x40 ? '*' : ''}` : '-';
    const s = g.shots[i];
    got[`shot${i + 1}`] = s.active ? `${s.nx},${s.s1}${s.impact ? '*' : ''}` : '-';
  });
  const diff = Object.keys(want).filter(k => String(want[k]) !== String(got[k]));
  return { want, got, diff };
}

/** Is an enemy (or an enemy explosion) near a ball, a laser shot or the Vaus? */
function enemyNear(f) {
  const pts = [];
  BALLS.forEach(([act, , s]) => { if (R(f, act)) pts.push([R(f, s), R(f, s + 1)]); });
  SHOTS.forEach(([st, sp]) => { if (R(f, st) & 0x80) pts.push([R(f, sp), R(f, sp + 1)]); });
  pts.push([0xe8, R(f, 0xc43a)]);
  for (let i = 0; i < 16; i++) {
    const nx = f.spr[4 * i], s1 = f.spr[4 * i + 1], at = f.spr[4 * i + 2], cd = f.spr[4 * i + 3];
    const code = cd + ((at & 3) << 8);
    if (!((code >= 0x12a && code <= 0x17f) || (code >= 0x1be && code <= 0x1c7))) continue;
    if (pts.some(([pnx, ps1]) => Math.abs(pnx - nx) < 28 && Math.abs(ps1 - s1) < 40)) return true;
  }
  return false;
}

// --- run -------------------------------------------------------------------------------
const g = new Game({ rng: () => 0.5 });
g.newGame();
let synced = false, compared = 0, segments = 0, enemyStops = 0, longest = 0, run = 0;
const failures = [];
for (let i = 2; i < frames.length; i++) {
  const f = frames[i], prev = frames[i - 1];
  if (!synced) {
    if (canSync(f, prev)) { load(g, f); synced = true; segments++; run = 0; }
    continue;
  }
  const c658 = R(f, 0xc658), p658 = R(prev, 0xc658);
  // (A laser frees its capsule within the same frame, so bit 7 may already be set.)
  g.rollCapsule = () => ((c658 & 0x7f) !== (p658 & 0x7f) ? c658 & 0x7f : 0);
  g.step({ delta: f.delta, button: prev.button === 1 });
  // Transitions the comparison does not cover: re-sync once play resumes.
  if (R(f, 0xed72) !== R(prev, 0xed72) || R(f, 0xef62) || !playing(f, prev) || R(f, 0xc4ce) ||
      g.phase !== 'play') {
    synced = false;
    continue;
  }
  compared++;
  run++;
  longest = Math.max(longest, run);
  const r = compare(g, f);
  if (!r.diff.length) continue;
  if (enemyNear(f) || enemyNear(prev)) {
    enemyStops++;
    if (verbose) console.log(`frame ${f.n}: enemy contact (${r.diff.join(', ')}) - re-sync`);
  } else {
    failures.push({ frame: f.n, r });
    if (verbose || failures.length <= 5) {
      console.log(`\nDIFFERENCE at arcade frame ${f.n}:`);
      for (const k of Object.keys(r.want)) {
        console.log(`  ${k.padEnd(8)} arcade ${String(r.want[k]).padStart(18)}  engine ` +
                    `${String(r.got[k]).padStart(18)}${r.diff.includes(k) ? '   <--' : ''}`);
      }
    }
  }
  synced = false;
}
console.log(`\ncompared ${compared} frames of play in ${segments} synced segments ` +
            `(longest unbroken run: ${longest} frames)`);
console.log(`re-synced after ${enemyStops} enemy contacts (enemies are modelled, not exact)`);
console.log(`unexplained differences: ${failures.length}`);
process.exit(failures.length ? 1 : 0);
