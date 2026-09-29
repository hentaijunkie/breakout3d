/**
 * Runs arkanoid_classic.html's own script (engine + the no-ROM renderer) against a
 * recording 2D-canvas mock, and checks that Round 1 is painted where the MAME frame has it.
 *
 *   node tools/verify_classic.js
 *
 * The ROM renderer is checked pixel by pixel in the browser instead
 * (tools/verify_replica_pixels.html), since it needs the generated ROM assets.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'arkanoid_classic.html'), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const gameSrc = inline[inline.length - 1];

// --- a minimal browser ----------------------------------------------------------------
const ops = [];
const ctx2d = new Proxy({ _fill: '#000' }, {
  get(t, p) {
    if (p === 'fillRect') return (x, y, w, h) => ops.push({ x, y, w, h, c: t._fill });
    if (p === 'fillStyle') return t._fill;
    if (p in t) return t[p];
    return () => {};
  },
  set(t, p, v) { if (p === 'fillStyle') t._fill = v; else t[p] = v; return true; }
});
const el = () => ({ style: {}, textContent: '', addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 224, height: 256 }) });
const canvas = Object.assign(el(), { width: 224, height: 256, getContext: () => ctx2d });
const els = { screen: canvas };
const context = {
  innerWidth: 1000, innerHeight: 1000, ARKANOID_ROM: null, addEventListener() {}, console, Math, JSON, Object, Array, Number, String, Set, Map, Uint8Array, Int32Array,
  document: {
    getElementById: id => (els[id] = els[id] || el()),
    addEventListener() {}, hidden: false, createElement: () => el()
  },
  location: { search: '' },
  localStorage: { getItem: () => null, setItem() {} },
  performance: { now: () => 0 },
  requestAnimationFrame() {},
  getComputedStyle: () => ({})
};
context.globalThis = context.window = context;      // as in a browser, window is the global
vm.createContext(context);
for (const f of ['arkanoid_arcade.js', 'arkanoid_levels_arcade.js', 'arkanoid_bricks.js', 'arkanoid_arcade_engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f });
}
vm.runInContext(gameSrc, context, { filename: 'arkanoid_classic.html' });

const debug = context.window.arkanoidDebug;
if (!debug) throw new Error('the page did not expose arkanoidDebug');
debug.run(1, { start: true });
ops.length = 0;
debug.run(40);                               // Round 1 intro: bricks on screen
console.log('canvas size:', canvas.width + 'x' + canvas.height);

// Bricks are the 15x7 rects. A silver brick paints its highlight as the 15x7 base and
// lays the body on top, so the visible body colour is the 13x5 rect at +1,+1.
const bricks = ops.filter(o => o.w === 15 && o.h === 7).map(o => {
  const body = ops.find(p => p.x === o.x + 1 && p.y === o.y + 1 && p.w === 13 && p.h === 5);
  return body ? { ...o, c: body.c } : o;
});
const xs = [...new Set(bricks.map(o => o.x))].sort((a, b) => a - b);
const ys = [...new Set(bricks.map(o => o.y))].sort((a, b) => a - b);
console.log('brick columns x:', xs.join(','));
console.log('brick rows y   :', ys.join(','));

const byRow = {};
for (const b of bricks) (byRow[b.y] = byRow[b.y] || []).push(b);

// Measured on the MAME frame of Round 1.
const fail = [];
if (canvas.width !== 224 || canvas.height !== 256) fail.push('screen must be 224x256');
if (ys[0] !== 56) fail.push('round 1 top brick row must be y=56, got ' + ys[0]);
if (xs[0] !== 8 || xs.length !== 13) fail.push('13 columns from x=8 expected');
if (xs.some((x, i) => i && x - xs[i - 1] !== 16)) fail.push('column pitch must be 16');
if (ys.some((y, i) => i && y - ys[i - 1] !== 8)) fail.push('row pitch must be 8');
const expect = ['#9d9d9d', '#ff0000', '#ffff00', '#0070ff', '#ff00ff', '#00ff00'];
ys.forEach((y, i) => {
  const got = byRow[y][0].c;
  if (got !== expect[i]) fail.push(`row ${i} colour ${got} != arcade ${expect[i]}`);
  if (byRow[y].length !== 13) fail.push(`row ${i} has ${byRow[y].length} bricks, want 13`);
});

console.log('\n' + (fail.length ? 'FAIL:\n  ' + fail.join('\n  ') : 'PASS - Round 1 is painted where the MAME frame has it'));
process.exit(fail.length ? 1 : 0);
