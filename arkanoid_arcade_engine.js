/**
 * ARKANOID arcade engine - the Taito ROM's game logic, one arcade frame per step().
 *
 * This is a port of the Z80 routines documented in docs/ARCADE_RE.md, working in the
 * hardware's own coordinates and integer arithmetic (see arkanoid_arcade.js for the
 * coordinate system and the ROM tables). It has no DOM: arkanoid_classic.html draws it,
 * and tools/verify_engine_replay.js replays MAME recordings through it.
 *
 * What is exact and what is not:
 *   exact       ball movement, speed levels and speed-ups, Vaus zones, wall/ceiling/brick
 *               bounces, brick hits (silver, gold), scoring, capsule drop and type rule,
 *               capsule fall and catch, Laser, Enlarge, Catch, Slow, Break, Disruption,
 *               Player, extra lives, round timing, death timing
 *   modelled    enemy movement (spawn doors, timing, speed and animation are the ROM's;
 *               the path-finding is a simplified version) and the DOH fight
 */
(function (global) {
  'use strict';

  // Uses the globals of arkanoid_arcade.js and arkanoid_levels_arcade.js by name.
  const GRID_W = 13, GRID_H = 18;          // brick grid: 13 columns, screen rows 3..20

  // --- Sprite codes (all taken from MAME traces of the running game) -------------------
  const SPR = {
    ball: [0x1b8, 12],
    vausR: 0xf2, vausL: 0xf3, vausMid: 0xbe,
    shadowColor: 8,
    appear: [[0xe8, 9, 10], [0xea, 9, 5], [0xec, 12, 5], [0xee, 11, 5], [0xf0, 10, 5]],
    dying: [[0x106, 9, 5], [0x108, 12, 10]],
    laserShot: [0x1bd, 25],
    enemyBoom: [0x1be, 0x1c0, 0x1c2, 0x1c4, 0x1c6],
    text: { round: [0x1d8, 0x1d9, 0x1da], ready: [0x1de, 0x1df, 0x1e0],
            gameOver: [0x1d4, 0x1d5, 0x1d6, 0x1d7] }
  };
  // 0x0E40: the Vaus body cycles through these colours, one step every 12 frames.
  const VAUS_GLOW = [9, 10, 11, 12, 11, 10];
  // Death explosion: [first code, columns, frames]; 3 rows of sprites each.
  const EXPLOSION = [[0x10a, 2, 6], [0x110, 3, 8], [0x119, 3, 10], [0x122, 3, 12]];
  // Enemy types by (round - 1) & 3: 16x16 (two stacked sprites), animation frames and
  // the frames each one shows; the third kind also cycles colours 13-15 every 40 frames.
  const ENEMY_TYPES = [
    { first: 0x170, frames: 8, period: 6, colors: [18] },
    { first: 0x15a, frames: 11, period: 6, colors: [17] },
    { first: 0x12a, frames: 8, period: 4, colors: [13, 14, 15] },
    { first: 0x146, frames: 10, period: 6, colors: [16] }
  ];
  // Round timing, frames from the round being built (measured on the arcade).
  const T = { roundText: 33, readyText: 63, textOff: 112, vausAppear: 113, ballAppear: 149 };

  const EMPTY = 0, GOLD = 0xff;
  const DOH_POINTS = 1000;                 // modelled: the DOH fight is not ripped yet

  function digitSprite(d) { return d <= 5 ? 0x1ca + d : 0x1d0 + (d - 6); }

  /** Colour code (1-10) + capsule flag + silver strength -> the arcade's brick byte. */
  function brickByte(code, capsule, silverHits) {
    if (!code) return EMPTY;
    if (code === 10) return GOLD;
    if (code === 9) return ((silverHits - 1) << 2) | 3;
    return ((code - 1) << 2) | (capsule ? 2 : 1);
  }
  /** Arcade brick byte -> colour code 1-10 (the tile to draw). */
  function brickCode(b) {
    if (!b) return 0;
    if (b === GOLD) return 10;
    if ((b & 3) === 3) return 9;
    return (b >> 2) + 1;
  }

  function newBall() {
    return { active: false, nx: 0, s1: 0, d: 2, flags: 1, nib: 0xf5, level: 0,
             ctr5: 0, ctr6: 0, hold: 0, ix7: 0, ix8: 0, ix9: 0, ix10: 0 };
  }

  class ArkanoidArcadeGame {
    constructor(opts) {
      opts = opts || {};
      this.rng = opts.rng || Math.random;
      this.startLives = opts.lives || 3;
      this.hiScore = opts.hiScore || 50000;
      this.sounds = [];
      this.phase = 'title';
      this.frame = 0;
      this.score = 0;
      this.round = 1;
      this.lives = 0;
      this.bricks = new Uint8Array(GRID_W * GRID_H);
      this.shine = new Uint8Array(GRID_W * GRID_H);
      this.balls = [newBall(), newBall(), newBall()];
      this.shots = [{ active: false, impact: 0, nx: 0, s1: 0 }, { active: false, impact: 0, nx: 0, s1: 0 }];
      this.enemies = [];
      this.doors = [{ state: 0, t: 0 }, { state: 0, t: 0 }];
      this.portal = { open: false, t: 0 };
      this.fireEvent = false;
    }

    // ------------------------------------------------------------------ game flow ----
    newGame() {
      this.score = 0;
      this.lives = this.startLives;
      this.extraAwarded = 0;
      this.round = 1;
      this.buildRound();
    }

    buildRound() {
      const info = arkanoidRoundInfo(this.round);
      this.bricks.fill(EMPTY);
      this.shine.fill(0);
      this.isDoh = this.round % 33 === 0;
      if (!this.isDoh) {
        const i = (this.round - 1) % 32;
        const g = ARKANOID_ARCADE_LEVELS[i], k = ARKANOID_ARCADE_CAPSULES[i];
        for (let r = 3; r < g.length && r - 3 < GRID_H; r++) {
          for (let c = 0; c < GRID_W; c++) {
            this.bricks[(r - 3) * GRID_W + c] = brickByte(g[r][c], k[r][c], info.silverHits);
          }
        }
      }
      this.bricksLeft = 0;
      for (const b of this.bricks) if (b && b !== GOLD) this.bricksLeft++;
      this.roundStartSpeed = info.speed;
      this.background = info.background;
      this.doh = this.isDoh ? { hp: 16, hit: 0, mouth: 0, t: 0, shots: [] } : null;
      this.startLife(true);
    }

    /** 0x05B5: everything a new life (or a new round) resets. */
    startLife(newRound) {
      this.phase = 'intro';
      this.t = 0;
      this.speedLevel = this.roundStartSpeed;          // 0xc462
      this.hitCounter = 0;                             // 0xef63
      this.vaus = { right: 0x80, left: 0x70, mid: null, mode: 0, target: 0, trans: null,
                    glow: 0, glowTimer: -1 };
      this.introShadow = true;
      this.balls.forEach(b => Object.assign(b, newBall()));
      this.shots.forEach(s => { s.active = false; s.impact = 0; });
      this.capsule = null;
      this.c658 = 0;                                   // pending / last capsule type
      this.c659 = 0;                                   // last capsule caught
      this.capsuleCell = 0;
      this.pGiven = false;                             // 0xc474
      this.inputDelta = 0;
      this.multiball = 0;                              // 0xc469
      this.splitPending = false;
      this.portal = { open: false, t: 0 };
      this.enemies = [];
      this.enemyTimer = this.firstEnemyDelay();
      this.doors.forEach(d => { d.state = 0; d.t = 0; });
      this.escape = null;
      this.fireEvent = false;
      this.catchOffset = 0;
    }

    firstEnemyDelay() {
      // Measured: enemies appear ~135 frames into most rounds, ~1950 in a few.
      const late = [1, 10, 12, 18, 29];
      return late.indexOf(((this.round - 1) % 32) + 1) >= 0 ? 1950 : 135;
    }

    addScore(points) {
      this.score += points;
      while (this.score >= arkNextExtraLife(this.extraAwarded)) {
        this.extraAwarded++;
        this.lives++;
        this.sounds.push('life');
      }
      if (this.score > this.hiScore) this.hiScore = this.score;
    }

    // ------------------------------------------------------------------ one frame ----
    /**
     * input.delta:  Vaus movement in pixels this frame (the spinner reading)
     * input.button: the fire button's state this frame
     * input.start:  start a game from the title / game over
     *
     * 0x165E: the game latches the button port whenever it changes. Pressing leaves a
     * pending "fire" that stays until something consumes it (a held ball, a laser slot)
     * or the button is released - so a press made while both shots are busy still fires
     * as soon as a slot frees up.
     */
    step(input) {
      input = input || {};
      this.sounds.length = 0;
      this.frame++;
      const button = !!(input.button || input.fire);
      if (button !== this.buttonState) this.fireEvent = button;
      this.buttonState = button;

      if (this.phase === 'title' || this.phase === 'gameover') {
        if (this.phase === 'gameover' && this.t < 400) this.t++;
        if (input.start || (this.fireEvent && this.phase === 'title')) {
          this.fireEvent = false;
          this.newGame();
        }
        return;
      }
      this.t++;
      this.animateShine();
      this.animateDoors();

      if (this.phase === 'intro') return this.stepIntro(input);
      if (this.phase === 'dying') return this.stepDying();
      if (this.phase === 'clear') {
        this.stepPlay(input);
        if (this.t >= 25) this.nextRound();
        return;
      }
      if (this.phase === 'escape') return this.stepEscape();
      this.stepPlay(input);
    }

    stepIntro(input) {
      if (this.t === T.ballAppear) {
        const b = this.balls[0];
        Object.assign(b, newBall(), { active: true, nx: 0xe4, s1: this.vaus.right, d: 2,
                                      hold: 0x78, ix7: 0xe4, ix8: this.vaus.right });
        b.ix9 = b.ix7; b.ix10 = b.ix8;
        this.catchOffset = 0;
      }
      if (this.t > T.ballAppear) {
        this.phase = 'play';
        this.stepPlay(input);
      }
    }

    nextRound() {
      this.round++;
      this.buildRound();
    }

    stepPlay(input) {
      if (this.introShadow && (this.t >= T.ballAppear + 2 || this.phase !== 'play')) this.introShadow = false;
      this.inputDelta = Math.max(-127, Math.min(127, Math.round(input.delta || 0)));
      // 0x09BF, at the top of the game loop: a Disruption caught last frame splits now.
      if (this.splitPending) { this.splitPending = false; this.split(); }
      // 0x512C runs the lasers first and the capsule after, so a capsule freed by a
      // laser appears on the same frame; one freed by a ball waits for the next.
      this.updateShots();
      this.updateCapsule();
      this.updateBalls();
      this.updateVausMode();
      this.checkBallsLost();
      if (this.phase !== 'play' && this.phase !== 'clear') return;
      this.moveVaus(this.inputDelta);
      this.updateEnemies();
      if (this.doh) this.updateDoh();
      if (this.phase === 'play' && this.bricksLeft <= 0 && !this.isDoh) {
        this.phase = 'clear';
        this.t = 0;
      }
    }

    // ------------------------------------------------------------------ balls --------
    updateBalls() {
      // 0x0888: balls 3 and 2 are processed before ball 1, and only ball 1 carries the
      // speed-up check. Empty slots are compacted downwards.
      for (let i = 2; i >= 0; i--) {
        const b = this.balls[i];
        if (!b.active) continue;
        b.level = this.speedLevel;
        if (i === 0) {
          const need = ARK_SPEEDUP_HITS[this.speedLevel];
          if (this.hitCounter >= need && (b.d < 8 || b.d >= 0x18)) {
            this.hitCounter = 0;
            if (this.speedLevel < ARK_SPEED_MAX) this.speedLevel++;
            b.d = arkSpeedupNudge(b.d);
          }
        }
        this.updateBall(b, i);
        this.brickCollision(b);
      }
      const [b1, b2, b3] = this.balls;
      if (!b2.active && b3.active) { Object.assign(b2, b3); b3.active = false; }
      if (!b1.active && b2.active) { Object.assign(b1, b2); b2.active = false; }
      if (this.multiball === 2 && this.balls.filter(b => b.active).length === 1) {
        this.multiball = 0;
      }
    }

    /** 0x10CA */
    updateBall(b, slot) {
      b.level = arkMoveLevel(b.level, b.d);
      if (b.hold > 0) {
        // The frame the timer runs out still holds; the ball leaves on the next one.
        b.hold--;
        if (b.hold === 0) this.sounds.push('launch');
        b.s1 = (this.vaus.right - this.catchOffset) & 0xff;
        if (this.fireEvent) {
          this.fireEvent = false;
          b.hold = 0;
          this.sounds.push('launch');
        } else {
          b.level = 0;
        }
      }
      this.moveObject(b);
      this.vausCollision(b);
      this.enemyCollision(b);
    }

    /** 0x114A: per-axis integer steps from the direction's speed classes. */
    moveObject(b) {
      const dir = arkDirection(b.d);
      b.flags = dir.flags;
      b.nib = dir.nib;
      let dx = arkAxisStep(b.nib & 15, b.level, b.ctr5, b.ctr6);
      if (b.flags & 2) dx = (-dx) & 0xff;
      b.ix8 = (b.s1 + dx) & 0xff;
      b.s1 = b.ix8;
      let dy = arkAxisStep(b.nib >> 4, b.level, b.ctr5, b.ctr6);
      if (b.flags & 1) dy = (-dy) & 0xff;
      b.ix7 = (b.nx + dy) & 0xff;
      b.nx = b.ix7;
      b.ctr5 = (b.ctr5 + 1) & 0xff;
      if (b.level !== 1 || (b.ctr5 & 1)) b.ctr6 = (b.ctr6 & 0xf0) | ((b.ctr6 + 1) & 0x0f);
    }

    /** 0x1318 (Vaus) falling through to 0x141B (walls and ceiling). */
    vausCollision(b) {
      const v = this.vaus;
      if (!(b.ctr6 & 0x80) && b.nx >= 0xe4 && b.nx < 0xec) {
        const hit = arkVausHit(b.s1, v.right, v.left);
        if (hit) {
          b.ctr6 |= 0x80;
          b.d = hit.d;
          // A Vaus swung hard (16+ spinner counts this frame) drags the ball 3 px along.
          const spin = this.inputDelta;
          if (Math.abs(spin) >= 16) b.s1 = (b.s1 + (spin < 0 ? -3 : 3)) & 0xff;
          this.sounds.push('vaus');
          if (this.c659 === 3 && b.hold === 0) {
            b.hold = ARK_VAUS.catchTimer;
            this.catchOffset = (v.right - b.s1) & 0xff;
            b.s1 = (b.s1 + (hit.side === 'left' ? 3 : -3)) & 0xff;
            b.nx = 0xe4;
            this.sounds.push('catch');
          }
          return;
        }
      }
      // Walls: a side bounce ends the check; otherwise the ceiling is tested.
      if (b.s1 <= 0x1c) {
        if (b.d & 0x10) { b.d = arkBounceLeft(b.d); this.bounced(b); return; }
      } else if (b.s1 > 0xe0) {
        if (!(b.d & 0x10)) { b.d = arkBounceRight(b.d); this.bounced(b); return; }
      }
      if (b.nx <= 0x1c) {
        const floor = ARK_CEILING_SPEED[(this.round - 1) % 34] || 0;
        if (this.speedLevel < floor) this.speedLevel = floor;
        const q = b.d & 0x18;
        if (q === 0 || q === 0x18) { b.d = arkBounceCeiling(b.d); this.bounced(b); }
      }
    }

    bounced(b) {
      b.ctr6 &= 0x7f;
      this.hitCounter = (this.hitCounter + 1) & 0xff;
      b.hold = 0;
      this.sounds.push('wall');
    }

    /**
     * 0x12D1: a ball touching an enemy destroys it. Grazing its top or bottom flips the
     * ball vertically (0x14BA); hitting the middle band sends it downward.
     */
    enemyCollision(b) {
      for (const e of this.enemies) {
        if (e.dying) continue;
        const bx = b.s1 - 16, by = b.nx, ex = e.s1 - 16, ey = e.nx;
        if (bx + 4 < ex || bx > ex + 15 || by + 3 < ey || by > ey + 15) continue;
        let nd = arkMirror(b.d);
        const cy = by + 2;
        if (cy >= ey + 4 && cy <= ey + 11) nd = (nd & 0x10) ? (nd & ~0x08) : (nd | 0x08);
        b.d = nd & 0x1f;
        b.ctr6 &= 0x7f;
        this.killEnemy(e);
      }
    }

    /** 0x56C0: brick collisions by the cell boundaries the ball crossed this frame. */
    brickCollision(b) {
      let e = 0;
      // 0x56DB rows
      let l = b.ix7;
      const c = l & 0xf8;
      if ((b.ix9 & 0xf8) !== c) {
        e |= 1;
        l = (b.flags & 1) ? c + 8 : (c - 3) & 0xff;
      }
      b.ix9 = l;
      // 0x5700 columns
      let h = b.ix8;
      const a8 = h & 0xf8;
      if (a8 !== 0 && a8 !== 0xf8) {
        const o = b.ix10 & 0xf8;
        if (o !== a8 && (((o & 0x18) ^ (a8 & 0x18)) !== 0x18)) {
          e |= 2;
          h = (b.flags & 2) ? a8 + 8 : (a8 - 2) & 0xff;
        }
      }
      b.ix10 = h;

      const cell = this.cellAt(b.ix7, b.ix8);
      if (e === 3) {
        if (cell < 0) return this.noBrick(b);
        const q = (b.d >> 2) & 6;
        const offs = [[13, -1], [-13, -1], [-13, 1], [13, 1]][q >> 1];
        const n0 = cell + offs[0], n1 = cell + offs[1];
        const has = n => n >= 0 && n < GRID_W * GRID_H && this.bricks[n] !== EMPTY;
        let f = 0;
        if (has(n0)) f |= 2;
        if (has(n1)) f |= 1;
        if (f === 0) {
          if (!this.hitBrick(cell)) return this.noBrick(b);
          return this.cornerHit(b);
        }
        if (f === 3) {
          this.hitBrick(n1);
          this.hitBrick(n0);
          return this.cornerHit(b);
        }
        if (f & 1) {
          if (!this.hitBrick(n1)) return this.noBrick(b);
          return this.rowHit(b);
        }
        if (!this.hitBrick(n0)) return this.noBrick(b);
        return this.columnHit(b);
      }
      if (e & 1) {
        if (cell < 0 || !this.hitBrick(cell)) return this.noBrick(b);
        return this.rowHit(b);
      }
      if (e & 2) {
        if (cell < 0 || !this.hitBrick(cell)) return this.noBrick(b);
        return this.columnHit(b);
      }
      return this.noBrick(b);
    }

    noBrick(b) { b.ix9 = b.ix7; b.ix10 = b.ix8; }
    rowHit(b) {                                  // 0x5776
      b.nx = b.ix9;
      b.ix10 = b.s1;
      b.d = arkReflectRow(b.d);
      b.ctr6 &= 0x7f;
    }
    columnHit(b) {                               // 0x574C
      b.ix9 = b.nx;
      b.s1 = b.ix10;
      b.d = arkReflectColumn(b.d);
      b.ctr6 &= 0x7f;
    }
    cornerHit(b) {                               // 0x581E
      b.d = arkReverse(b.d);
      b.nx = b.ix9;
      b.s1 = b.ix10;
      b.ctr6 &= 0x7f;
    }

    /** 0x46D7: brick cell under a native point, or -1. */
    cellAt(nx, s1) {
      if (s1 < 0x18) return -1;
      const col = (s1 - 0x18) >> 4;
      if (col >= GRID_W) return -1;
      if (nx < 0x18) return -1;
      const row = (nx - 0x18) >> 3;
      if (row > 0x11) return -1;
      return row * GRID_W + col;
    }

    /** 0x5854: hit the brick in `cell`. Returns false if the cell is empty. */
    hitBrick(cell) {
      const b = this.bricks[cell];
      if (b === EMPTY) return false;
      if (b === GOLD) {
        this.startShine(cell);
        this.sounds.push('metal');
        this.hitCounter = (this.hitCounter + 1) & 0xff;
        return true;
      }
      if ((b & 3) === 3) {
        this.startShine(cell);
        const left = (b & 0xfc) - 4;
        if (left >= 0) {
          this.bricks[cell] = left | 3;
          this.sounds.push('metal');
          this.hitCounter = (this.hitCounter + 1) & 0xff;
          return true;
        }
      } else if ((b & 2) && this.multiball !== 2 && !this.capsule) {
        // 0x5916: 0xc658 holds the pending type (or the last caught one at rest); the
        // capsule appears next frame if it differs from the last caught (0xc659).
        const t = this.rollCapsule();
        if (t) {
          if (t === 7) this.pGiven = true;
          this.c658 = t;
          this.capsuleCell = cell;
        }
      }
      // 0x5994: destroy
      this.sounds.push('brick');
      const code = brickCode(b);
      this.addScore(code === 9 ? arkSilverPoints(((this.round - 1) % 32) + 1)
                               : ARK_BRICK_POINTS[code - 1]);
      this.bricks[cell] = EMPTY;
      this.shine[cell] = 0;
      this.bricksLeft--;
      this.hitCounter = (this.hitCounter + 1) & 0xff;
      return true;
    }

    /** The capsule type for a flagged brick; tools replace this to replay recordings. */
    rollCapsule() {
      return arkCapsuleRoll(Math.floor(this.rng() * 8), this.score, this.c658, this.pGiven);
    }

    startShine(cell) { if (!this.shine[cell]) this.shine[cell] = 1; }

    /** Silver/gold hit flash: tiles +2,+4,..,+10 for 3 frames each, then back. */
    animateShine() {
      for (let i = 0; i < this.shine.length; i++) {
        if (!this.shine[i]) continue;
        this.shine[i]++;
        if (this.shine[i] > 15) this.shine[i] = 0;
      }
    }

    /** The tile offset (0 or 2..10) a silver/gold brick shows right now. */
    shineOffset(cell) {
      const s = this.shine[cell];
      return s ? 2 + 2 * Math.min(4, Math.floor((s - 1) / 3)) : 0;
    }

    checkBallsLost() {
      for (const b of this.balls) if (b.active && b.nx >= 0xf8) b.active = false;
      if (this.phase === 'play' && !this.balls.some(b => b.active)) this.die();
    }

    die() {
      this.phase = 'dying';
      this.t = 0;
      this.capsule = null;
      this.shots.forEach(s => { s.active = false; s.impact = 0; });
      this.sounds.push('death');
    }

    stepDying() {
      // Measured: 11 frames still, 5 + 10 frames of flashing, a 36-frame explosion,
      // then the lives counter drops at +145 and the round restarts.
      this.updateEnemies();
      if (this.t === 145) {
        this.lives--;
        if (this.lives <= 0) {
          this.phase = 'gameover';
          this.t = 0;
          return;
        }
        this.startLife(false);
        this.t = T.roundText - 11;
      }
    }

    // ------------------------------------------------------------------ Vaus ---------
    /**
     * 0x0CA8: the Vaus moves by the spinner delta. Reaching the right limit takes the
     * clamping path even with a zero delta, and that path is where an open Break gate
     * lets the Vaus out.
     */
    moveVaus(d) {
      const v = this.vaus;
      if (this.escape) return;
      let shift, clampedRight = false;
      if (d >= 0) {
        if (v.right + d < ARK_VAUS.rightMax) shift = d;
        else { shift = ARK_VAUS.rightMax - v.right; clampedRight = true; }
      } else {
        shift = v.left + d < ARK_VAUS.leftMin ? ARK_VAUS.leftMin - v.left : d;
      }
      v.right += shift;
      v.left += shift;
      if (v.mid != null) v.mid += shift;
      if (clampedRight && this.portal.open && this.phase === 'play') this.startEscape();
    }

    /** 0x0B34: Laser and Enlarge transformations, step by step. */
    updateVausMode() {
      const v = this.vaus;
      if (++v.glowTimer >= 12) { v.glowTimer = 0; v.glow = (v.glow + 1) % VAUS_GLOW.length; }
      if (!v.trans) {
        if (v.mode === v.target) return;
        const to = v.mode !== 0 ? 0 : v.target;
        const kind = v.mode | to;                   // 1 laser, 2 enlarge, 3 catch
        const delay = [0, 3, 1, 0][kind];
        v.trans = { to, kind, step: 0, delay, wait: delay };
        if (to === 2) this.sounds.push('enlarge');
        return;
      }
      const tr = v.trans;
      if (tr.wait > 0) { tr.wait--; return; }
      tr.wait = tr.delay;
      if (tr.kind === 1) {
        tr.step++;
        if (tr.step >= 10) this.endTransition();
      } else if (tr.kind === 2) {
        if (tr.to === 2) {
          if (tr.step === 0) v.mid = v.right - 8;
          v.right++; v.left--;
        } else {
          if (tr.step === 7) v.mid = null;
          v.right--; v.left++;
        }
        if (v.right >= ARK_VAUS.rightMax) { v.right--; v.left--; if (v.mid != null) v.mid--; }
        else if (v.left < ARK_VAUS.leftMin) { v.right++; v.left++; if (v.mid != null) v.mid++; }
        tr.step++;
        if (tr.step >= 8) this.endTransition();
      } else {
        this.endTransition();
      }
    }

    endTransition() {
      const v = this.vaus;
      v.mode = v.trans.to;
      v.trans = null;
    }

    /**
     * Laser Vaus animation frame 0..9 (0 = normal shape). A step draws its frame and
     * then advances the counter, so the frame on screen is the previous step's.
     */
    laserFrame() {
      const v = this.vaus;
      if (v.trans && v.trans.kind === 1) {
        const shown = Math.max(0, v.trans.step - 1);
        return v.trans.to ? shown : (v.trans.step === 0 ? 9 : 9 - shown);
      }
      return v.mode === 1 ? 9 : 0;
    }

    // ------------------------------------------------------------------ capsules -----
    /** 0x512C / 0x527F / 0x5329: spawn, fall one pixel a frame, catch. */
    updateCapsule() {
      if (!this.capsule && this.c658 !== this.c659) {
        const row = Math.floor(this.capsuleCell / GRID_W), col = this.capsuleCell % GRID_W;
        this.capsule = { type: this.c658, nx: row * 8 + 0x18, s1: col * 16 + 0x18,
                         frame: 0, timer: 0x0a };
        return;                                  // the spawn frame only places it
      }
      const c = this.capsule;
      if (!c) return;
      if (--c.timer <= 0) {
        c.frame = (c.frame + 1) & 7;
        c.timer = c.frame === 5 ? 15 : 7;
      }
      c.nx++;
      if (c.nx >= 0xf8) { this.capsule = null; this.c658 = this.c659; return; }
      const v = this.vaus;
      if (c.nx >= 0xe2 && c.nx < 0xec && c.s1 <= v.right + 4 && c.s1 > v.left - 4) {
        this.capsule = null;
        this.catchCapsule(c.type);
      }
    }

    /** 0x5386 and the handlers at 0x5474. */
    catchCapsule(t) {
      this.balls[0].hold = 0;
      if (this.c659 === 1) this.shots.forEach(s => { s.active = false; s.impact = 0; });
      this.c658 = this.c659 = t;
      this.addScore(ARK_POINTS.capsule);
      this.sounds.push('capsule');
      const v = this.vaus;
      switch (t) {
        case 1: this.multiball = 0; v.target = 1; break;
        case 2: this.multiball = 0; v.target = 2; break;
        case 3: this.multiball = 0; v.target = 3; break;
        case 4: this.multiball = 0; v.target = 0; this.speedLevel = arkSlowLevel(this.speedLevel); break;
        case 5: this.multiball = 0; v.target = 0; this.openPortal(); break;
        case 6: v.target = 0; this.multiball = 2; this.splitPending = true; break;
        case 7: v.target = 0; this.multiball = 0; this.lives++; this.sounds.push('life'); break;
      }
    }

    /** 0x0A19: Disruption. */
    split() {
      const b1 = this.balls[0];
      if (!b1.active) return;
      const dirs = arkDisruptionDirections(b1.d);
      for (let i = 1; i < 3; i++) {
        Object.assign(this.balls[i], b1, { d: dirs[i] });
      }
    }

    openPortal() {
      this.portal = { open: true, t: 0 };
      this.sounds.push('portal');
    }

    startEscape() {
      this.phase = 'escape';
      this.t = 0;
      this.escape = { bonus: 0 };
      this.balls.forEach(b => { b.active = false; });
      this.capsule = null;
      this.shots.forEach(s => { s.active = false; s.impact = 0; });
      this.sounds.push('escape');
    }

    /** 0x0D15: the Vaus slides out through the gate, then 100 x 100 points. */
    stepEscape() {
      const v = this.vaus;
      if (v.right < 0xf8 || v.left < 0xf8) {
        if (v.right < 0xf8) v.right++;
        if (v.left < 0xf8) v.left++;
        if (v.mid != null && v.mid < 0xf8) v.mid++;
        return;
      }
      if (this.escape.bonus < 100) {
        this.escape.bonus++;
        this.addScore(100);
        return;
      }
      this.nextRound();
    }

    // ------------------------------------------------------------------ lasers -------
    /**
     * 0x5140: two shot slots; each shot is two beams 12 px apart moving 5 px a frame.
     * A shot that hits a brick, an enemy or the ceiling stays where it is for 11 frames
     * showing its impact (0x525D) and keeps its slot busy meanwhile.
     */
    updateShots() {
      for (const s of this.shots) {
        if (s.impact) {
          if (++s.impact > 11) { s.impact = 0; s.active = false; }
          continue;
        }
        if (s.active) {
          s.nx -= 5;
          if (s.nx < 0x18) { s.impact = 1; continue; }
          for (const e of this.enemies) {
            if (e.dying || s.impact) continue;
            if (e.s1 - 6 < s.s1 && s.s1 < e.s1 + 0x12 && e.nx - 3 < s.nx && s.nx < e.nx + 0x0d) {
              this.killEnemy(e);
              s.impact = 1;
            }
          }
          if (s.impact) continue;
          let hit = false;
          const c1 = this.cellAt(s.nx, s.s1), c2 = this.cellAt(s.nx, s.s1 + 12);
          if (c1 >= 0 && this.hitBrick(c1)) hit = true;
          if (c2 >= 0 && this.hitBrick(c2)) hit = true;
          if (hit) s.impact = 1;
        } else if (this.vaus.mode === 1 && !this.vaus.trans && this.fireEvent) {
          this.fireEvent = false;
          s.active = true;
          s.impact = 0;
          s.nx = 0xe3;
          s.s1 = this.vaus.right - 8;
          this.sounds.push('laser');
        }
      }
    }

    /** Laser sprite: the moving shot, then its two impact frames. */
    shotSprite(s) {
      return SPR.laserShot[0] - (s.impact >= 6 ? 2 : s.impact >= 1 ? 1 : 0);
    }

    // ------------------------------------------------------------------ enemies ------
    /**
     * Modelled after the ROM's behaviour: up to three at once, entering through the two
     * doors in the top wall (s1 0x40 and 0xB0), moving at speed level 1 (1/2 px a frame)
     * with a 6-frame animation. They drift down, slide along the top of the brick
     * formation until they find a way through, then wander over the Vaus.
     */
    updateEnemies() {
      if (this.isDoh || this.phase === 'intro') return;
      if (this.phase === 'play' && --this.enemyTimer <= 0) {
        const alive = this.enemies.filter(e => !e.dying).length;
        if (alive < 3) this.spawnEnemy();
        this.enemyTimer = this.enemies.length >= 3 ? 60 : 20 + Math.floor(this.rng() * 400);
      }
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        e.anim++;
        if (e.dying) {
          if (++e.dying > 30) this.enemies.splice(i, 1);
          continue;
        }
        if (e.entering > 0) { e.entering--; e.nx = Math.min(e.nx + 1, 0x18); continue; }
        this.steerEnemy(e);
        e.ctr++;
        if (e.ctr & 1) {
          e.nx += e.vy;
          e.s1 += e.vx;
        }
        if (e.s1 < 0x1c) { e.s1 = 0x1c; e.vx = 1; }
        if (e.s1 > 0xe0) { e.s1 = 0xe0; e.vx = -1; }
        // Touching the Vaus destroys the enemy (0x0ABE).
        if (e.nx >= 0xd9 && e.nx < 0xf0 && e.s1 > this.vaus.right - 0x20 && e.s1 <= this.vaus.right) {
          this.killEnemy(e);
        }
        if (e.nx >= 0xf8) this.enemies.splice(i, 1);
      }
    }

    spawnEnemy() {
      const door = this.rng() < 0.5 ? 0 : 1;
      this.doors[door].state = 1;
      this.doors[door].t = 0;
      this.enemies.push({ nx: 0x10, s1: door ? 0xb0 : 0x40, vx: 0, vy: 1, ctr: 0, anim: 0,
                          entering: 20, dying: 0, mode: 'descend', turn: 0 });
    }

    /** Brick-aware wandering: down when the way is clear, sideways otherwise. */
    steerEnemy(e) {
      const blocked = (nx, s1) => {
        const c1 = this.cellAt(nx, s1 - 12), c2 = this.cellAt(nx, s1 - 2);
        return (c1 >= 0 && this.bricks[c1]) || (c2 >= 0 && this.bricks[c2]);
      };
      const below = blocked(e.nx + 17, e.s1);
      if (e.nx < 0xb8) {
        if (!below) { e.vy = 1; e.vx = e.nx < 0x40 ? 0 : e.vx; return; }
        e.vy = 0;
        if (!e.vx) e.vx = this.rng() < 0.5 ? -1 : 1;
        if (blocked(e.nx + 8, e.s1 + e.vx * 10)) e.vx = -e.vx;
        return;
      }
      if (++e.turn > 90) {
        e.turn = 0;
        e.vx = this.rng() < 0.5 ? -1 : 1;
        e.vy = this.rng() < 0.7 ? 1 : 0;
      }
      if (!e.vx) e.vx = 1;
    }

    killEnemy(e) {
      if (e.dying) return;
      e.dying = 1;
      this.addScore(ARK_POINTS.enemy);
      this.sounds.push('enemy');
    }

    animateDoors() {
      for (const d of this.doors) {
        if (!d.state) continue;
        d.t++;
        if (d.state === 1 && d.t >= 20 + 27) { d.state = 2; d.t = 0; }
        else if (d.state === 2 && d.t >= 20) { d.state = 0; d.t = 0; }
      }
      if (this.portal.open) this.portal.t++;
    }

    /** Door tile frame: 0 closed .. 5 open. */
    doorFrame(i) {
      const d = this.doors[i];
      if (d.state === 1) return Math.min(5, 1 + Math.floor(d.t / 4));
      if (d.state === 2) return Math.max(0, 4 - Math.floor(d.t / 4));
      return 0;
    }

    // ------------------------------------------------------------------ DOH ----------
    /** Modelled: DOH takes 16 hits and spits projectiles at the Vaus. */
    updateDoh() {
      const d = this.doh;
      if (!d || d.hp <= 0) return;
      d.t++;
      if (d.hit > 0) d.hit--;
      // DOH occupies the tile area x 72..151, y 56..151 (s1 88..168, nx 56..152).
      for (const b of this.balls) {
        if (!b.active || d.hit) continue;
        if (b.nx + 3 >= 56 && b.nx <= 151 && b.s1 - 12 >= 72 && b.s1 - 16 <= 151) {
          const fromSide = b.nx > 60 && b.nx < 146;
          b.d = fromSide ? arkReflectColumn(b.d) : arkReflectRow(b.d);
          b.ctr6 &= 0x7f;
          d.hp--;
          d.hit = 8;
          this.sounds.push('doh');
          if (d.hp <= 0) { this.addScore(DOH_POINTS); this.phase = 'clear'; this.t = 0; }
        }
      }
      if (d.t % 90 === 0 && d.shots.length < 3) {
        d.shots.push({ nx: 150, s1: 0x80, vx: Math.sign(this.vaus.right - 8 - 0x80) });
      }
      for (let i = d.shots.length - 1; i >= 0; i--) {
        const s = d.shots[i];
        s.nx += 2;
        if (d.t & 1) s.s1 += s.vx;
        if (s.nx >= 0xe2 && s.nx < 0xec && s.s1 <= this.vaus.right + 4 && s.s1 > this.vaus.left - 4) {
          d.shots.splice(i, 1);
          this.balls.forEach(b => { b.active = false; });
          this.die();
          return;
        }
        if (s.nx >= 0xf8) d.shots.splice(i, 1);
      }
    }

    // ------------------------------------------------------------------ output -------
    /** The sprites of this frame as the arcade would place them: {code, color, nx, s1}. */
    sprites() {
      const out = [];
      const put = (code, color, nx, s1) => out.push({ code, color, nx: nx & 0xff, s1: s1 & 0xff });
      const v = this.vaus;
      const glow = VAUS_GLOW[v.glow];

      if (this.phase === 'intro') {
        if (this.t >= T.roundText && this.t < T.textOff) {
          SPR.text.round.forEach((c, i) => put(c, 0, 176, 96 + 16 * i));
          const r = this.round;
          if (r >= 10) put(digitSprite(Math.floor(r / 10) % 10), 0, 176, 136);
          put(digitSprite(r % 10), 0, 176, 144);
        }
        if (this.t >= T.readyText && this.t < T.textOff) {
          SPR.text.ready.forEach((c, i) => put(c, 0, 192, 108 + 16 * i));
        }
        if (this.t >= T.vausAppear) {
          let k = this.t - T.vausAppear, idx = 0;
          while (idx < SPR.appear.length && k >= SPR.appear[idx][2]) { k -= SPR.appear[idx][2]; idx++; }
          if (idx < SPR.appear.length) {
            const [code, col] = SPR.appear[idx];
            if (idx >= 4) { put(0xee, 8, 0xec, v.right + 4); put(0xef, 8, 0xec, v.left + 4); }
            put(code, col, 0xe8, v.right);
            put(code + 1, col, 0xe8, v.left);
          } else {
            this.vausSprites(put, glow);
          }
        }
      } else if (this.phase === 'dying') {
        const t = this.t;
        if (t < 11) this.vausSprites(put, glow);
        else if (t < 26) {
          const [code, col] = t < 16 ? SPR.dying[0] : SPR.dying[1];
          put(code, col, 0xe8, v.right); put(code + 1, col, 0xe8, v.left);
        } else if (t < 62) {
          let k = t - 26, idx = 0;
          while (idx < EXPLOSION.length - 1 && k >= EXPLOSION[idx][2]) { k -= EXPLOSION[idx][2]; idx++; }
          const [first, cols] = EXPLOSION[idx];
          const s0 = cols === 2 ? v.left : v.left - 8;
          let code = first;
          for (let cx = 0; cx < cols; cx++) {
            for (let ry = 0; ry < 3; ry++) put(code++, 9, 0xe0 + 8 * ry, s0 + 16 * cx);
          }
        }
      } else if (this.phase === 'gameover') {
        SPR.text.gameOver.forEach((c, i) => put(c, 0, 176, 80 + 16 * i));
      } else if (this.phase !== 'title') {
        this.vausSprites(put, glow);
      }

      if (this.capsule) {
        const c = this.capsule;
        const [base, col] = ARK_CAPSULE_SPRITES[c.type];
        put(base + c.frame, 8, c.nx + 2, c.s1 + 2);
        put(base + c.frame, col, c.nx, c.s1);
      }
      for (const s of this.shots) if (s.active) put(this.shotSprite(s), SPR.laserShot[1], s.nx, s.s1);
      for (const b of this.balls) if (b.active) put(SPR.ball[0], SPR.ball[1], b.nx, b.s1);
      for (const e of this.enemies) this.enemySprites(put, e);
      if (this.doh) for (const s of this.doh.shots) put(0x2b1 + ((this.doh.t >> 2) & 3), 15, s.nx, s.s1);
      return out;
    }

    vausSprites(put, glow) {
      const v = this.vaus;
      const lf = this.laserFrame();
      const r = SPR.vausR + 2 * lf, l = SPR.vausL + 2 * lf;
      // Right after it materialises the Vaus keeps colour 10 and its shadow keeps the
      // last appearing frame, until the game loop takes over two frames after the ball.
      const settling = this.introShadow && this.t < T.ballAppear + 2;
      // 0x0BCE: during the Laser transformation the Vaus is drawn in colour 9, and 12 on
      // frame 7; otherwise it glows.
      const col = settling ? 10 : (v.trans && v.trans.kind === 1) ? (lf === 7 ? 12 : 9) : glow;
      put(settling ? 0xee : r, 8, 0xec, v.right + 4);
      put(settling ? 0xef : l, 8, 0xec, v.left + 4);
      if (v.mid != null) put(SPR.vausMid, 8, 0xec, v.mid + 4);
      put(r, col, 0xe8, v.right);
      put(l, col, 0xe8, v.left);
      if (v.mid != null) put(SPR.vausMid, col, 0xe8, v.mid);
    }

    enemySprites(put, e) {
      const type = ENEMY_TYPES[(this.round - 1) & 3];
      if (e.dying) {
        const k = SPR.enemyBoom[Math.min(4, Math.floor(e.dying / 6))];
        put(k, 19, e.nx, e.s1); put(k + 1, 19, e.nx + 8, e.s1);
        return;
      }
      const f = Math.floor(e.anim / type.period) % type.frames;
      const color = type.colors[Math.floor(e.anim / 40) % type.colors.length];
      put(type.first + 2 * f, color, e.nx, e.s1);
      put(type.first + 2 * f + 1, color, e.nx + 8, e.s1);
    }

    /** Brick tile for a grid cell: null when empty, else { code, shine }. */
    brickAt(cell) {
      const b = this.bricks[cell];
      if (!b) return null;
      return { code: brickCode(b), shine: this.shineOffset(cell) };
    }
  }

  ArkanoidArcadeGame.GRID_W = GRID_W;
  ArkanoidArcadeGame.GRID_H = GRID_H;
  ArkanoidArcadeGame.brickByte = brickByte;
  ArkanoidArcadeGame.brickCode = brickCode;
  global.ArkanoidArcadeGame = ArkanoidArcadeGame;
})(typeof window !== 'undefined' ? window : globalThis);
