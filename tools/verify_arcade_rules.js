/**
 * Behavioural checks of the rule functions in arkanoid_arcade.js. The tables themselves
 * are checked against the ROM by tools/verify_arcade_tables.py, and the whole engine
 * against MAME recordings by tools/verify_engine_replay.js; this covers the functions the
 * free-form versions (Neon, 3D) use directly.
 *
 *   node tools/verify_arcade_rules.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { Math };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'arkanoid_arcade.js'), 'utf8'), ctx);
const A = new Proxy({}, { get: (t, name) => vm.runInContext(name, ctx) });

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

// 1. Per-axis steps: averaged over the phase counter they are the class fraction of L/2.
const FRACTION = { 1: 0.25, 5: 0.5, 7: 0.75, 15: 1 };
for (const [cls, frac] of Object.entries(FRACTION)) {
  for (let level = 2; level <= 16; level += 2) {
    let sum = 0;
    for (let ctr6 = 0; ctr6 < 4; ctr6++) sum += A.arkAxisStep(+cls, level, 0, ctr6);
    const avg = sum / 4, want = frac * level / 2;
    check(Math.abs(avg - want) < 1e-9, `class ${cls} level ${level}: ${avg} px/frame, want ${want}`);
  }
}
// Odd levels alternate between the two neighbouring even ones.
for (let level = 3; level <= 15; level += 2) {
  let sum = 0;
  for (let ctr5 = 0; ctr5 < 2; ctr5++) for (let ctr6 = 0; ctr6 < 4; ctr6++) sum += A.arkAxisStep(15, level, ctr5, ctr6);
  check(Math.abs(sum / 8 - level / 2) < 1e-9, `odd level ${level} averages ${sum / 8}`);
}

// 2. Directions and bounces.
for (let d = 0; d < 32; d++) {
  const up = (d & 0x18) === 0 || (d & 0x18) === 0x18, left = !!(d & 0x10);
  const { flags } = A.arkDirection(d);
  check(!!(flags & 1) === up && !!(flags & 2) === left, `direction ${d} flags ${flags}`);
  if (left) check(!(A.arkBounceLeft(d) & 0x10), `left wall ${d} still moving left`);
  if (!left) check(!!(A.arkBounceRight(d) & 0x10), `right wall ${d} still moving right`);
  if (up) {
    const c = A.arkBounceCeiling(d);
    check(!((c & 0x18) === 0 || (c & 0x18) === 0x18), `ceiling ${d} -> ${c} still moving up`);
    // (Axis-aligned directions, d & 7 == 0, never occur for a ball: the ROM's own
    // arithmetic turns them sideways here.)
    if (d & 7) check(A.arkDirection(c).nib === A.arkDirection(d).nib, `ceiling ${d} changed the slope`);
  }
  check(A.arkReflectRow(A.arkReflectRow(d)) === d, `row reflection of ${d} is not an involution`);
  check(A.arkReflectColumn(A.arkReflectColumn(d)) === d, `column reflection of ${d} is not an involution`);
  check(A.arkReverse(A.arkReverse(d)) === d, `reverse of ${d}`);
}
for (const d of [2, 5, 6, 26, 27, 30, 14, 18]) {
  for (const n of A.arkDisruptionDirections(d)) {
    check(n & 7, `Disruption from ${d} gave the axis-aligned direction ${n}`);
  }
}

// 3. The free-form Vaus zones agree with the arcade's s1 test on a 32 px Vaus.
const right = 0x80, left = 0x70;
for (let s1 = left - 3; s1 <= right + 12; s1++) {
  const arcade = A.arkVausHit(s1, right, left);
  const a = s1 - left + 4;
  const free = A.arkVausZoneAt(a / 32, 32);
  check(arcade && arcade.d === free.d, `s1 ${s1}: arcade ${arcade && arcade.d} free-form ${free.d}`);
}
check(A.arkVausHit(left - 4, right, left) === null && A.arkVausHit(right + 13, right, left) === null,
      'Vaus catches outside its span');

// 4. Capsule rule.
let seen = {};
for (let r = 0; r < 8; r++) for (let hundreds = 0; hundreds < 10; hundreds++) {
  const t = A.arkCapsuleRoll(r, hundreds * 100, 0, false);
  seen[t] = (seen[t] || 0) + 1;
  check(t >= 0 && t <= 7, `roll gave ${t}`);
}
check(A.arkCapsuleRoll(0, 0, 0, false) === 0, 'random 0 must mean no capsule');
check(A.arkCapsuleRoll(3, 0, 3, false) === 6, 'repeating the last capsule must give Disruption');
check(A.arkCapsuleRoll(7, 700, 0, true) === 2, 'a second P in one life must become Enlarge');
check(A.arkCapsuleRoll(5, 500, 0, false) === 5, 'B re-rolled onto 5 stays B');

// 5. Speed and score helpers.
check(A.arkSlowLevel(6) === 4 && A.arkSlowLevel(2) === 2 && A.arkSlowLevel(1) === 1, 'Slow capsule');
check(A.arkMoveLevel(6, 8) === 8 && A.arkMoveLevel(6, 2) === 6 && A.arkMoveLevel(14, 8) === 14, 'shallow boost');
check([0, 1, 2, 3].map(A.arkNextExtraLife).join() === '20000,60000,120000,180000', 'extra lives');
check(A.arkSilverPoints(12) === 600 && A.arkSilverHits(9) === 3, 'silver bricks');

if (fail.length) {
  console.log('FAIL:\n  ' + fail.slice(0, 20).join('\n  '));
  process.exit(1);
}
console.log('PASS - arkanoid_arcade.js rules behave as the ROM routines do');
