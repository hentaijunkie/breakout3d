/**
 * ARKANOID (arcade, Taito 1986) - game rules reverse engineered from the Z80 program ROM
 * (a75-01-1.ic17 + a75-11.ic16). Every table below was read from the ROM at the address
 * next to it; tools/verify_arcade_tables.py re-reads the ROM and checks them byte by byte.
 * docs/ARCADE_RE.md explains the routines these come from.
 *
 * NOTE: an earlier version of this project used tables from the MSX port's disassembly.
 * None of them exist in the arcade ROM - the arcade's ball model is different.
 *
 * Coordinates. The arcade monitor is mounted sideways, so the game logic works in the
 * hardware's "native" sprite coordinates:
 *   nx  sprite byte 0 = the player's Y (grows downward)
 *   s1  sprite byte 1 = the player's X + 16 (a sprite spans x = s1-16 .. s1-1)
 * The ball graphic is the top-left 5x4 of its 16x8 sprite, so its left edge is s1-16.
 */

// --- Direction -----------------------------------------------------------------------
// A ball (or enemy) moves along one of 32 directions D, clockwise from straight up:
// quadrant D>>3 = 0 up-right, 1 down-right, 2 down-left, 3 up-left.

/** 0x126A: D & 15 -> speed classes (high nibble vertical, low nibble horizontal). */
const ARK_DIR_NIBBLES = [0xf0, 0xf1, 0xf5, 0xf7, 0xff, 0x7f, 0x5f, 0x1f,
                         0x0f, 0x1f, 0x5f, 0x7f, 0xff, 0xf7, 0xf5, 0xf1];
/** 0x127A: quadrant -> flags; bit 0 = moving up (nx decreasing), bit 1 = moving left. */
const ARK_QUADRANT_FLAGS = [1, 0, 2, 3];

/**
 * 0x1223 and 0x1227..0x124E: per-axis step tables, one per speed class (1, 5, 7, other).
 * Bytes 0-1 hold four 4-bit phase masks, bytes 2-9 signed corrections. A class moves
 * a fraction of the base step: 1 -> 1/4, 5 -> 1/2, 7 -> 3/4, f -> 1.
 */
const ARK_PHASE_BITS = [0x01, 0x02, 0x04, 0x08];
const ARK_STEP_TABLES = {
  1: [0x15, 0x7f, 0x00, 0xff, 0xfe, 0xfd, 0xfd, 0xfc, 0xfb, 0xfa],
  5: [0x5f, 0x5f, 0x00, 0xff, 0xff, 0xfe, 0xfe, 0xfd, 0xfd, 0xfc],
  7: [0x75, 0x1f, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xfe],
  15: [0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
};

/**
 * 0x11BF: pixels an object moves along one axis this frame.
 *   nibble  the axis' speed class (0, 1, 5, 7 or f)
 *   level   speed level L; the base step is L/2 px, odd levels alternating frames
 *   ctr5    the object's frame counter (ix+5)
 *   ctr6    the object's phase counter (ix+6, low 2 bits used)
 */
function arkAxisStep(nibble, level, ctr5, ctr6) {
  nibble &= 15;
  if (!nibble) return 0;
  const t = ARK_STEP_TABLES[nibble] || ARK_STEP_TABLES[15];
  let c = level >> 1;
  if ((level & 1) && (ctr5 & 1)) c++;
  if (!c) return 0;
  const i = (c - 1) & 3;
  const mask = (i & 1) ? (t[i >> 1] & 15) : (t[i >> 1] >> 4);
  let v = (c + (t[c + 1] << 24 >> 24)) & 0xff;
  if (!(ARK_PHASE_BITS[ctr6 & 3] & mask)) v = (v - 1) & 0xff;
  return v;
}

/** 0x124F: flags and speed nibbles for a direction. */
function arkDirection(d) {
  return { flags: ARK_QUADRANT_FLAGS[(d >> 3) & 3], nib: ARK_DIR_NIBBLES[d & 15] };
}

/** 0x14BA: mirror D inside its half-plane and flip bit 3 (the helper every bounce uses). */
function arkMirror(d) {
  let a = ((-d) & 7) | (d & 0x18);
  return a ^ 0x08;
}
/** Left wall (0x1423): only when moving left; ends up moving right. */
function arkBounceLeft(d)   { return (d & 0x10) ? (arkMirror(d) & ~0x10) : d; }
/** Right wall (0x1435): only when moving right; ends up moving left. */
function arkBounceRight(d)  { return (d & 0x10) ? d : (arkMirror(d) | 0x10); }
/** Ceiling (0x1484): only when moving up (quadrants 0 and 3); ends up moving down. */
function arkBounceCeiling(d) {
  const q = d & 0x18;
  if (q !== 0 && q !== 0x18) return d;
  const a = arkMirror(d);
  return (a & 0x10) ? (a & ~0x08) : ((a | 0x08) & ~0x10);
}
/** Brick hit across a row boundary (0x5782): vertical reflection. */
function arkReflectRow(d)    { return ((-d) & 0x0f) | (d & 0x10); }
/** Brick hit across a column boundary (0x5758): horizontal reflection. */
function arkReflectColumn(d) { return (-d) & 0x1f; }
/** Corner hit (0x581E): straight back. */
function arkReverse(d)       { return d ^ 0x10; }

// --- Speed ---------------------------------------------------------------------------

/**
 * 0x094C: hits needed at each speed level before the ball speeds up. The hit counter
 * (0xef63) counts bricks broken, silver/gold hits and wall/ceiling bounces; once it
 * reaches the threshold for the current level, the next frame the ball is moving up the
 * level rises by one (max 14), the counter resets and the direction is nudged a step
 * toward the diagonal.
 */
const ARK_SPEEDUP_HITS = [0x00, 0x19, 0x19, 0x23, 0x23, 0x2d, 0x3c, 0x50,
                          0x78, 0x8c, 0xa0, 0xb4, 0xc8, 0xdc, 0xf0, 0xff];
const ARK_SPEED_MAX = 14;

/**
 * 0x1462: touching the ceiling raises the speed level to at least this, per round
 * (index = round - 1; 0 = no effect). This is the famous "ball speeds up after it
 * reaches the top" rule.
 */
const ARK_CEILING_SPEED = [7, 7, 8, 0, 7, 7, 7, 0, 7, 5, 7, 7, 8, 6, 7, 5, 7,
                           7, 7, 0, 7, 0, 0, 0, 0, 7, 8, 7, 0, 7, 0, 0, 0, 0];

/** 0x10D0: near-horizontal directions (D & 15 in 6..10) move two levels faster. */
function arkMoveLevel(level, d) {
  const i = d & 15;
  return (i >= 6 && i <= 10) ? Math.min(level + 2, ARK_SPEED_MAX) : level;
}

/** 0x0929: the direction nudge that comes with a speed-up. */
function arkSpeedupNudge(d) {
  const b = d & 7;
  return (d & 0x18) | ((b & 4) ? b - 1 : b + 1);
}

/** 0x542B: the Slow capsule drops the level by two, but never to zero. */
function arkSlowLevel(level) {
  return level - 2 >= 1 ? level - 2 : level;
}

// --- Vaus ----------------------------------------------------------------------------

/**
 * 0x1318: where the ball lands on the Vaus decides its new direction. Distances are
 * measured from the nearer end of the Vaus: under 3 px is the edge, under 8 px the
 * middle, anything else the centre. Directions (0x13EE..0x140E, entry 4 of each):
 *   centre 63.4 deg, middle 36.9 deg, edge 26.6 deg above the horizontal.
 */
const ARK_VAUS_ZONE_LIMITS = [0x03, 0x08, 0x1e];               // 0x140C
const ARK_VAUS_DIR_LEFT = { edge: 0x1a, middle: 0x1b, centre: 0x1e };
const ARK_VAUS_DIR_RIGHT = { edge: 0x06, middle: 0x05, centre: 0x02 };

/**
 * Ball s1 against the Vaus sprites. `right` is the right-hand Vaus sprite's s1 (0xc43a),
 * `left` the left-hand one's (0xc43b). Returns { d, side, zone } or null for a miss.
 */
function arkVausHit(s1, right, left) {
  const b = right + 12 - s1;                  // distance from the right end
  if (b < 0) return null;
  if (left - 4 - s1 >= 0) return null;
  const a = s1 - left + 4;                    // distance from the left end
  const side = a < b ? 'left' : 'right';
  const dist = a < b ? a : b;
  const zone = dist < ARK_VAUS_ZONE_LIMITS[0] ? 'edge' : dist < ARK_VAUS_ZONE_LIMITS[1] ? 'middle' : 'centre';
  const d = (side === 'left' ? ARK_VAUS_DIR_LEFT : ARK_VAUS_DIR_RIGHT)[zone];
  return { d, side, zone };
}

/**
 * The same zones for renderers with their own geometry: `p` is where the ball met the
 * Vaus, 0 = left end .. 1 = right end; `span` the arcade width it stands for (32, or 48
 * when enlarged).
 */
function arkVausZoneAt(p, span) {
  const a = Math.max(1, Math.min(span, Math.round(p * span)));
  const b = span - a;
  const side = a < b ? 'left' : 'right';
  const dist = Math.min(a, b);
  const zone = dist < ARK_VAUS_ZONE_LIMITS[0] ? 'edge' : dist < ARK_VAUS_ZONE_LIMITS[1] ? 'middle' : 'centre';
  return { d: (side === 'left' ? ARK_VAUS_DIR_LEFT : ARK_VAUS_DIR_RIGHT)[zone], side, zone };
}

/** Vaus geometry in s1 units: normal 32 px (two sprites), Enlarge 48 px (three). */
const ARK_VAUS = { y: 0xe8, rightMax: 0xd9, leftMin: 0x16, catchTimer: 0x78 };

// --- Bricks and score ----------------------------------------------------------------

/** 0x5A63: points by colour (white..yellow). Stored /10 in BCD on the arcade. */
const ARK_BRICK_POINTS = [50, 60, 70, 80, 90, 100, 110, 120];
/** 0x5A73: a silver brick is worth 50 x round. Gold is indestructible and scores 0. */
function arkSilverPoints(round) { return 50 * round; }
/** Silver hits per round (brick byte bits 2-7 + 1): 2, 3, 4, 5 every 8 rounds. */
function arkSilverHits(round) { return Math.floor((round - 1) / 8) + 2; }

const ARK_POINTS = {
  capsule: 1000,        // 0x53DD: every capsule caught
  enemy: 100,           // measured on MAME: +100 for each enemy the ball destroys
  escape: 10000         // 0x0DA1: leaving through the Break gate, 100 x 100
};

/** 0x27F9: extra lives at 20,000, 60,000 and then every 60,000 points. */
function arkNextExtraLife(awarded) {
  return awarded === 0 ? 20000 : 60000 * awarded;
}

// --- Capsules ------------------------------------------------------------------------

/** 0x5474: capsule type -> effect. The letters are the ones printed on the sprites. */
const ARK_CAPSULE_TYPES = {
  1: { letter: 'L', name: 'LASER' },
  2: { letter: 'E', name: 'ENLARGE' },
  3: { letter: 'C', name: 'CATCH' },
  4: { letter: 'S', name: 'SLOW' },
  5: { letter: 'B', name: 'BREAK' },
  6: { letter: 'D', name: 'DISRUPTION' },
  7: { letter: 'P', name: 'PLAYER' }
};
/** 0x5319: capsule sprite (first of 8 animation frames) and colour, per type. */
const ARK_CAPSULE_SPRITES = {
  1: [0x190, 0x13], 2: [0x198, 0x13], 3: [0x188, 0x14], 4: [0x180, 0x14],
  5: [0x1a8, 0x15], 6: [0x1a0, 0x15], 7: [0x1b0, 0x0c]
};
/** Colours of the capsules as the palette renders them (for the non-ROM renderers). */
const ARK_CAPSULE_RGB = {
  L: '#ff0000', E: '#0070ff', C: '#00ff00', S: '#ff8f00', B: '#ff00ff', D: '#00ffff', P: '#9d9d9d'
};

/**
 * 0x5916: the capsule a breaking brick releases. Only bricks flagged in the round data
 * release one, never while a capsule is already falling, and never during Disruption.
 *
 * The TYPE is `ld a,r` - the Z80's refresh register, i.e. effectively random - kept to
 * 3 bits (0x593E; the `and a` before it is dead, `ld a,r` sets the flag the jump tests):
 *
 *   t = random 0-7                               -> 0 means no capsule
 *   t equals the capsule last caught             -> Disruption instead
 *   t is B or P (the rare ones)                  -> re-roll from the hundreds digit of
 *       the score (0xc4d9 high nibble): 0 -> no capsule; equals the last one ->
 *       Disruption; P when a P already came this life -> Enlarge
 *
 * `random07` is 0-7, `score` the score before the brick's own points, `last` the type
 * of the last capsule (0 if none), `pGiven` whether a P already dropped this life.
 * Returns 0-7. With a uniform random value each common type comes ~15-17% of the time,
 * B and P 2.5% each (1 in 4 rolls is re-rolled, then 1 digit in 10), none 17.5%.
 */
function arkCapsuleRoll(random07, score, last, pGiven) {
  let t = random07 & 7;
  if (!t) return 0;
  if (t === last) return 6;
  if (t === 5 || t === 7) {
    t = Math.floor(score / 100) % 10 & 7;
    if (!t) return 0;
    if (t === last) return 6;
    if (t === 7 && pGiven) return 2;
  }
  return t;
}

/** Letter-based helper for the free-form renderers (Neon, 3D). */
function arkCapsuleLetter(rng, score, lastLetter, pGiven) {
  const last = Object.keys(ARK_CAPSULE_TYPES).find(k => ARK_CAPSULE_TYPES[k].letter === lastLetter);
  const t = arkCapsuleRoll(Math.floor(rng() * 8), score, last ? +last : 0, pGiven);
  return t && t !== (last ? +last : 0) ? ARK_CAPSULE_TYPES[t].letter : null;
}

/**
 * 0x0A36: Disruption turns one ball into three sharing its position, on directions
 * D-1, D and D+1 (skipping the exactly vertical/horizontal ones).
 */
function arkDisruptionDirections(d) {
  let a = d - 1;
  if (!(a & 7)) a += 2;
  let b = d + 1;
  if (!(b & 7)) b -= 2;
  return [d, a & 0x1f, b & 0x1f];
}

// --- Helpers for the free-form renderers ----------------------------------------------

/**
 * Average velocity of a ball on direction d at speed level L, in arcade pixels per
 * frame, as (vx, vy) in the player's orientation (+y down). The arcade moves in integer
 * steps; renderers that move smoothly use this average and get the same speed.
 */
function arkVelocity(d, level) {
  const { flags, nib } = arkDirection(d);
  const K = { 0: 0, 1: 0.25, 5: 0.5, 7: 0.75, 15: 1 };
  const base = arkMoveLevel(level, d) / 2;
  const vy = (K[nib >> 4] || 0) * base * ((flags & 1) ? -1 : 1);
  const vx = (K[nib & 15] || 0) * base * ((flags & 2) ? -1 : 1);
  return { vx, vy };
}

/** Frames per second of the arcade's video timing (MAME: 59.185606 Hz). */
const ARK_FPS = 59.185606;
