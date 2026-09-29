/**
 * Renders every arcade round with drawArkanoidBrick() (arkanoid_bricks.js - what the
 * replica draws bricks with when it has no ROM graphics, and what the Neon/3D colours
 * come from) into a flat list of fill operations, so tools/verify_all_rounds.py can diff
 * them against the real MAME screenshots.
 *
 *   node tools/emit_expected_pixels.js
 *
 * Output: tools/expected_pixels.txt, one line per fill  ->  round x y w h #rrggbb
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = ['arkanoid_bricks.js', 'arkanoid_levels_arcade.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');

const ops = [];
const ctx = {
  _f: '#000',
  set fillStyle(v) { this._f = v; },
  get fillStyle() { return this._f; },
  fillRect(x, y, w, h) { ops.push([x, y, w, h, this._f]); },
};

const env = new Function(src + ';return {L: ARKANOID_ARCADE_LEVELS, draw: drawArkanoidBrick};')();

const out = [];
env.L.forEach((grid, i) => {
  const round = i + 1;
  ops.length = 0;
  grid.forEach((row, r) => row.forEach((code, c) => {
    if (code) env.draw(ctx, 8 + c * 16, r * 8, code);
  }));
  for (const [x, y, w, h, col] of ops) out.push(`${round} ${x} ${y} ${w} ${h} ${col}`);
});
fs.writeFileSync(path.join(__dirname, 'expected_pixels.txt'), out.join('\n'));
console.log(`wrote ${out.length} fill ops for ${env.L.length} rounds`);
