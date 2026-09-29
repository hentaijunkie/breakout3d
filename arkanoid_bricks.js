/**
 * ARKANOID brick visuals, shared by the three versions and by the pixel tests.
 *
 * Colours are the arcade palette as MAME renders it (the 4-bit PROM values through the
 * board's resistor ladder, see tools/arcade_gfx.py). Geometry was measured from MAME
 * frames: a brick cell is 16 x 8 px and the brick fills 15 x 7 of it.
 *   - coloured bricks (1-8): a FLAT 15x7 rectangle of the solid colour.
 *   - silver (9) and gold (10) have a 1 px bevel: highlight on row 0 and column 0,
 *     shadow on row 6 and column 14.
 *   - column 15 and row 7 of the cell are the black gap between bricks.
 * Codes: 1 white, 2 orange, 3 cyan, 4 green, 5 red, 6 blue, 7 pink, 8 yellow,
 *        9 silver, 10 gold.
 */
const ARKANOID_BRICK_RGB = {
  1: '#f1f1f1', 2: '#ff8f00', 3: '#00ffff', 4: '#00ff00', 5: '#ff0000',
  6: '#0070ff', 7: '#ff00ff', 8: '#ffff00', 9: '#9d9d9d', 10: '#bcae00'
};

/** The two beveled bricks. Everything else is flat. */
const ARKANOID_BRICK_BEVEL = {
  9: { hi: '#d2d2d2', body: '#9d9d9d', lo: '#8f8f8f' },
  10: { hi: '#e0d200', body: '#bcae00', lo: '#9d8f00' }
};

/** Draws one brick cell (16x8, gap included) at arcade scale. */
function drawArkanoidBrick(ctx, x, y, code) {
  const bevel = ARKANOID_BRICK_BEVEL[code];
  if (bevel) {
    ctx.fillStyle = bevel.hi;   ctx.fillRect(x, y, 15, 7);
    ctx.fillStyle = bevel.body; ctx.fillRect(x + 1, y + 1, 13, 5);
    ctx.fillStyle = bevel.lo;
    ctx.fillRect(x, y + 6, 15, 1);
    ctx.fillRect(x + 14, y, 1, 7);
  } else {
    ctx.fillStyle = ARKANOID_BRICK_RGB[code];
    ctx.fillRect(x, y, 15, 7);
  }
  ctx.fillStyle = '#000000';
  ctx.fillRect(x + 15, y, 1, 8);
  ctx.fillRect(x, y + 7, 16, 1);
}
