# Eclipse Survivors — Realism + 60fps Plan

## Context

The game plays end-to-end and the HUD/overlay polish landed last cycle. The remaining gap is **the playfield itself**: every entity is drawn each frame from raw `ctx.arc`/`ctx.fillRect` primitives with hard-coded hex colors and `ctx.shadowBlur` glow. The arena floor is solid `#070914` with a thin teal grid; there is no lighting, no shadowing, no parallax, no projectile trails, and no animated environment — so the canvas reads "tech demo," not "live ritual arena."

At the same time, the engine has measurable allocation and collision overhead that will become a 60fps problem the moment we add visual cost:

- **~3,000 `Math.hypot` collision tests/frame at endgame** (50 enemies × 60 player projectiles, brute-force) in `src/game/GameEngine.ts:343-405`.
- **400–700 fresh `Vector` objects/frame** from `enemies.map(spread)`, `particles.map(spread)`, `weapons.map(spread)` (twice), `damageTexts.map(spread)`, and the gem remap loop.
- **`shadowBlur` is set per-entity per frame** for every enemy, projectile, gem, player — the slowest 2D-canvas operation in Chromium.
- **No FPS counter, no instrumentation** — we're flying blind.

**Goal:** keep the existing neon/eclipse aesthetic but make the arena feel **dimensional, atmospheric, and physically lit**, while the engine holds a steady 60fps with 100+ entities on screen. User chose "deepen the neon look" + "perf first" — so this plan front-loads a measured perf foundation, then layers procedurally-rendered visual upgrades on top of it. **No external art assets.** Everything is procedural canvas drawing, baked once into offscreen `<canvas>` sprite caches and blitted per frame.

## Goals

1. Hold a stable **60fps** through the boss fight (300s mark, ≥50 enemies + ≥200 particles + ≥60 projectiles).
2. Replace flat geometric primitives with a **dimensional**, lit, atmospheric look while keeping the existing palette.
3. Make every change **measurable** (FPS overlay + frame-time budget panel in dev mode).
4. **Zero new runtime dependencies.** Pure canvas2D + offscreen-canvas trick.

## Non-goals

- Audio (separate plan).
- Sprite-art assets / external images (requires an artist).
- WebGL / WebGPU / shader pipeline (overkill, locks us out of mobile).
- Gameplay/balance changes — we're not touching `state.ts`, `upgrades.ts`, `weapons.ts` numerics, or the difficulty curve.
- Boss HP bar (deferred from previous plan, still deferred).

## Files to modify

| File | Phase | Change |
|------|-------|--------|
| `src/game/perf.ts` *(new)* | 1 | Frame timer + ring-buffer FPS / update / render budgets, exposed via a singleton |
| `src/components/FpsOverlay.tsx` *(new)* | 1 | Tiny dev-only HUD reading the perf singleton; toggled by `?debug=1` query |
| `src/game/collisions.ts` | 1 | Add `circlesOverlapSq`, `distanceSq`; mark `Math.hypot` versions deprecated for hot paths |
| `src/game/spatialGrid.ts` *(new)* | 1 | Uniform grid (cell ≈ 96px) with `insert(id, x, y)` / `query(x, y, r) → ids[]` / `clear()` |
| `src/game/GameEngine.ts` | 1, 3, 4 | Convert hot loops to mutate-in-place; thread the spatial grid through projectile/enemy/gem collision; cache `getUnlockedWeapons`; new render order with sprite-cache calls |
| `src/game/enemies.ts` | 1 | `updateEnemies` mutates in place (no `.map(spread)`) |
| `src/game/particles.ts` | 1, 4 | Mutate in place, swap-and-pop removal; **particle pool**; new particle kinds (spark, smoke, magic) |
| `src/game/weapons.ts` | 1 | Cache `getUnlockedWeapons` result, invalidate on weapons-array mutation |
| `src/game/sprites.ts` *(new)* | 2 | Build & cache offscreen-canvas sprites for player, each enemy type, each projectile kind, each gem rarity. Re-baked once on init |
| `src/game/lighting.ts` *(new)* | 2 | Build cached radial-light gradients (player aura, projectile glow, gem shimmer) as image bitmaps |
| `src/game/floor.ts` *(new)* | 3 | Bake an arena-floor texture (3200×2400 offscreen) once at engine start: dust noise + ritual circle + subtle grid + corner sigils |
| `src/game/starfield.ts` *(new)* | 3 | Two-layer parallax starfield, baked into two offscreen canvases of differing resolutions, scrolled at 0.15× and 0.4× of camera |
| `src/game/trails.ts` *(new)* | 3 | Ring-buffer projectile trails (last N positions per projectile) drawn as a fading polyline with additive blend |
| `src/game/types.ts` | minor | Add `trail?: Vector[]` to `Projectile`, `kind?: 'spark' \| 'smoke' \| 'magic' \| 'death'` to `Particle` |
| `src/components/GameCanvas.tsx` | 1, 4 | Mount `FpsOverlay`; pass perf timer into engine; smooth-camera lerp lives here only as a render-time read |

No changes to `App.tsx`, `Hud.tsx`, `OverlayScreens.tsx`, `UpgradeScreen.tsx`, `state.ts` (state shape stays compatible), or `upgrades.ts`.

---

## Phase 1 — Perf foundation (must land before Phase 2)

**Why first:** every visual upgrade in Phases 2–4 is paid for in frame time. We need (a) a number to optimize against, (b) headroom in the update step, (c) cheap collision so projectile count can grow, and (d) a sprite-cache pattern that makes "richer entities" cost the same as the current cheap entities.

### 1.1 Instrumentation (`src/game/perf.ts` + `src/components/FpsOverlay.tsx`)

Singleton with three rolling 120-sample ring buffers: `frameMs`, `updateMs`, `renderMs`. API:

```ts
perf.beginFrame() / perf.endFrame()
perf.beginUpdate() / perf.endUpdate()
perf.beginRender() / perf.endRender()
perf.summary() // { fps, p50Frame, p95Frame, updateP50, renderP50 }
```

Calls inserted in `GameCanvas.tsx:57-70` around `engine.update` and `engine.render`. `FpsOverlay` is a tiny absolutely-positioned div (top-right), polls `perf.summary()` at 4Hz, renders only when `location.search.includes('debug=1')` so production builds are clean. **Acceptance:** an overlay reading `60fps · upd 1.2ms · ren 3.4ms` is visible after `?debug=1`.

### 1.2 Squared-distance collisions (`src/game/collisions.ts`)

Add:

```ts
export function circlesOverlapSq(a: Vector, ar: number, b: Vector, br: number): boolean {
  const dx = a.x - b.x, dy = a.y - b.y, r = ar + br;
  return dx*dx + dy*dy <= r*r;
}
export function distanceSq(a: Vector, b: Vector): number {
  const dx = a.x - b.x, dy = a.y - b.y; return dx*dx + dy*dy;
}
```

Replace `circlesOverlap` and `distance` in **hot paths only**:
- `GameEngine.ts:343-405` (3 collision loops)
- `GameEngine.ts:429-462` (gem magnet distance check — keep `Math.sqrt` only when computing direction, otherwise compare squared)
- `enemies.ts:120` (kite/slow check — only the comparison; direction still needs the normalized vector but that's already hot enough that we should compute `len = sqrt(lenSq)` once and reuse).

**Acceptance:** no behavior change in `gameLogic.test.ts` (6/6 still pass). `Math.hypot` calls in `GameEngine.ts` drop to ≤ 1 in steady state (only orbit-weapon angle math).

### 1.3 Spatial grid (`src/game/spatialGrid.ts`)

Uniform grid keyed by `cellX,cellY` → `number[]` (entity indices, not ids — using indices avoids string hashing). Cell size **96px** (matches existing visual grid spacing and is ≥ 2× the largest enemy radius except boss). Single shared instance owned by `GameEngine`.

Per-tick lifecycle in `GameEngine.update`:
1. `grid.clear()`
2. For each enemy, `grid.insert(i, e.position.x, e.position.y, e.radius)` — inserts index into every cell the bounding box touches.
3. Collision step queries `grid.query(p.x, p.y, p.radius)` and tests only those candidates.

Expected at endgame (50 enemies, 60 projectiles): drops collision tests from ~3,000 to ~150–300 (≈10× fewer). `query` returns a borrowed `number[]` (re-used across calls — caller MUST consume before next query, documented in module).

**Acceptance:** projectile-vs-enemy collision step's `perf.beginUpdate`/`endUpdate` slice drops by ≥ 60% at the 200s mark. Test added in `gameLogic.test.ts`: spawn 200 enemies, 50 projectiles, assert hit count matches the brute-force reference.

### 1.4 Mutate-in-place updates

Replace these `.map(spread)` patterns with mutation, since these collections are owned by `GameEngine.state` and **never read concurrently** (single-threaded JS, no React subscription mid-update):

- `enemies.ts:114-136` `updateEnemies` → `for (let i=0; i<enemies.length; i++) { ... mutate enemy in place }`. No allocation per enemy.
- `particles.ts:49-64` `updateParticles` → in-place + **swap-and-pop** for dead particles (`particles[i] = particles[--last]; particles.length = last`). No `.map`, no `.filter`.
- `GameEngine.ts:215-218` weapon cooldown decrement → simple `for` loop, mutate `weapon.cooldown` directly.
- `GameEngine.ts:220-253` weapon-fire pass → split into two functions: a read-only "should fire?" pass and a mutating "spawn & reset cooldown" pass. No re-allocation of the weapons array.
- `GameEngine.ts:480-489` damage-text update → in-place + swap-and-pop.
- `GameEngine.ts:429-462` gem update → mutate `gem.position` directly when magnetized; remove dead gems via swap-and-pop.

**Acceptance:** in dev with the FPS overlay, "update" budget at 50-enemy / 200-particle steady state drops to ≤ 1.5ms (Chrome on a modern laptop); no allocations inside the update tick visible in DevTools allocation timeline (sample 5s, expect < 50KB allocated).

### 1.5 Particle pool (`src/game/particles.ts`)

Class-light pool with two arrays:
```
const pool: Particle[] = [];      // recycled instances
const live: Particle[] = state.particles; // game-visible
acquire(): Particle              // pop from pool or {} if empty
release(p: Particle): void       // push back
```

`createDeathParticles` calls `acquire()` instead of object literals; the swap-and-pop in `updateParticles` calls `release(deadParticle)`. Pool capacity capped at 600 (releases beyond that are dropped to GC). With ~400-particle peak, pool stabilizes after ~1s.

**Acceptance:** killing the boss (48-particle burst) does not cause a visible GC pause in the perf overlay (no `frameMs` spike > 25ms in the 0.5s following the burst).

### 1.6 Snapshot cache (`src/game/weapons.ts`, `GameEngine.ts:162-178`)

`getUnlockedWeapons` is called every snapshot (20Hz) and re-filters the weapons array. Cache the result:

```ts
let cachedUnlocked: Weapon[] | null = null;
export function getUnlockedWeapons(weapons: Weapon[]): Weapon[] {
  if (cachedUnlocked && cachedUnlocked.length === <expected>) return cachedUnlocked; // see invalidation
  cachedUnlocked = weapons.filter(w => !w.locked);
  return cachedUnlocked;
}
export function invalidateUnlockedCache() { cachedUnlocked = null; }
```

Call `invalidateUnlockedCache()` from the two sites that mutate weapons: upgrade selection (`GameEngine.ts:applyUpgrade` — currently around line 290) and engine reset/`startRun`. Snapshot creation in `getSnapshot` no longer spreads `stats` — emit it as `{ ...this.state.stats, level: ..., timeSurvived: ... }` only when stats actually changed (cheap shallow check) or, simpler, return the same `stats` reference and let React's snapshot setter do the diff.

**Acceptance:** no GC blip when the snapshot fires; snapshot cost in `perf.summary` ≤ 0.05ms.

### Phase 1 verification

- `npm test` — existing 6 + 1 new spatial-grid test, all green.
- `npm run dev`, append `?debug=1` to URL — overlay shows `≥58fps` after 60s of survive-and-shoot at the busiest the game gets pre-Phase-2 (allocation drop is the only target here).
- Chrome DevTools Performance recording, 10s at the 90s mark: no `Major GC` events; `Idle` ≥ 60% of frame time (i.e. we're sitting on 6+ms of headroom for Phases 2–4 to consume).

---

## Phase 2 — Sprite cache & lighting

**Why now:** with mutate-in-place + grid in place, we have ~6ms of free render budget. The single biggest visual upgrade we can make per ms is to replace per-frame `ctx.arc + shadowBlur` rendering with **pre-rendered, multi-pass sprite cards** drawn with a single `drawImage`. `shadowBlur` costs roughly 0.5–2ms per call in Chromium — the engine currently invokes it ~200 times/frame.

### 2.1 Offscreen sprite cache (`src/game/sprites.ts`)

For each entity-kind+state, build an OffscreenCanvas (or HTMLCanvasElement fallback for older browsers — feature-detect) once at engine init. Each sprite is drawn with three layered passes onto its own canvas, then blitted as a single image:

```
Pass A — outer glow:     radial-gradient alpha 0.35 → 0, 1.6× radius
Pass B — body:           solid fill + subtle inner-radial highlight (top-left)
Pass C — rim light:      thin stroke at top-left arc, alpha 0.6
```

Builds:
- `playerSprite` (one card, 64×64 with 32px padding for glow)
- `enemySprites['basic'|'fast'|'tank'|'ranged'|'boss']` (5 cards; boss is 192×192)
- `enemyHitSprites[type]` (white-overlay variant for `hitFlash > 0`, blitted on top with `globalAlpha = hitFlash / 0.12`)
- `projectileSprites['bolt'|'arrow'|'pulse'|'enemy-bullet'|'boss-bullet']`
- `gemSprites['common'|'rare'|'boss']`

Each sprite "card" includes a small built-in **drop shadow** (dark ellipse beneath, 80% width, 30% height, alpha 0.5, gaussian-falloff via radial gradient). This is what gives entities a sense of standing on a surface — the single highest-value realism move.

Render path becomes:
```ts
ctx.drawImage(enemySprites[e.type], e.position.x - half, e.position.y - half);
if (e.hitFlash > 0) ctx.drawImage(enemyHitSprites[e.type], ...); // alpha-blended
```

**Rotation:** for `fast`, `tank`, `ranged` (already rotated today via `drawPolygon(elapsed*k)`), wrap `drawImage` with `save / translate / rotate / restore`. Cost is minimal because the sprite itself is the slow part. Boss eye-positions and outer-ring animation (`drawBoss`) stay procedural on top of the cached body — only the body gets cached.

**Memory:** 5 enemy sprites + 5 hit variants + 5 projectile + 3 gem ≈ 18 OffscreenCanvases × ~10KB = 180KB total. Negligible.

**Acceptance:** render-tree node count stays the same, but `perf.summary().renderP50` drops from current (~3.5ms estimate) to ≤ 1.8ms at endgame load.

### 2.2 Drop the per-frame `shadowBlur`

After 2.1, `shadowBlur` survives only inside the cached sprite-build pass (one-time, free). All in-loop `ctx.shadowBlur = ...` / `ctx.shadowColor = ...` lines in `GameEngine.ts` (`drawEnemies`, `drawProjectiles`, `drawGems`, `drawPlayer`, `drawBoss`, `drawOrbitWeapon`) are removed. The visual glow is now baked into the sprite's outer-glow pass.

### 2.3 Cached light layers (`src/game/lighting.ts`)

Three reusable pre-rendered radial gradients as ImageBitmaps:
- `playerAura` — 320px wide, soft cyan, alpha 0.18 at center → 0 at edge. Drawn at the **start** of the world-space render pass, centered on the player, with `globalCompositeOperation = 'lighter'`. Casts a soft pool of light on the floor that follows the player.
- `gemShimmer` — 64px, alpha 0.4 → 0, color matches gem. Drawn under each gem, additive.
- `projectileGlow` — 48px (bolt), 32px (arrow), 96px (pulse) — additive halo behind projectile.

These are large (300px) blits, but they're one `drawImage` each — cheap. Only the player aura is per-frame; gem/projectile glows are part of their sprite cards.

**Acceptance:** the player visibly carries light into dark areas of the floor; the floor texture (Phase 3) is darker outside the aura radius and brighter inside, giving local contrast.

---

## Phase 3 — Atmosphere & environment

**Why now:** sprite cache and lighting give us entities that *look* solid; phase 3 gives them a *world*.

### 3.1 Animated floor (`src/game/floor.ts`)

Bake **once at engine init**: a 3200×2400 OffscreenCanvas containing the arena floor:
- Base fill: `#070914` (matches today)
- Layer 1: ~2000 dust specks (1–2px, alpha 0.06, color `#1f4963`) at random world positions — pre-rendered noise.
- Layer 2: a faint 96px grid (matches existing) but with **two opacity tiers** — major lines (every 4th, alpha 0.18) vs minor (alpha 0.08).
- Layer 3: a large **ritual circle** at world center (radius 480) — two concentric circles, 12 evenly-spaced runes (small filled diamonds) on the outer ring, faint cyan stroke alpha 0.14. This anchors the player visually to a "place."
- Layer 4: 4 corner sigils (radius 96) at the four arena corners, alpha 0.2.
- Layer 5: an outer-edge vignette inside the arena (radial gradient from `transparent` at center to `rgba(0,0,0,0.6)` at the arena bounds) — gives the floor a "lit center, dark periphery" feel.

In `GameEngine.drawArena`, replace the current per-frame `strokeRect`+grid loop with a **single** `ctx.drawImage(floorTexture, 0, 0)`. Cost: ~0.2ms vs current ~1.5ms, plus the floor now has visible texture.

### 3.2 Two-layer parallax starfield (`src/game/starfield.ts`)

The existing backdrop (lines 533-548 of `GameEngine.ts`) is a static gradient. Replace with:
- Background: same gradient, drawn once into the backdrop offscreen.
- Far stars: 200 stars on a 1280×720 offscreen canvas (1px-2px white dots, alpha 0.4-0.8), drawn at `(viewport.x * 0.15, viewport.y * 0.15)` modulo canvas size — gives slow parallax.
- Near stars: 80 stars on a 1280×720 offscreen, larger (2-3px) and brighter, drawn at `(viewport.x * 0.4, viewport.y * 0.4)`.
- Drift: add a slow elapsed-time offset (`elapsed * 4` for far, `elapsed * 12` for near) so stars drift even when the player stands still.

This is what sells "the arena is in the middle of a void." Cost: 2 `drawImage` calls/frame.

### 3.3 Projectile trails (`src/game/trails.ts` + `types.ts`)

Add `trail?: Vector[]` (ring buffer, capped at 8 entries) to `Projectile`. On each `updateProjectiles` step, push the previous position; when buffer exceeds N, overwrite oldest. In `drawProjectiles`, render each trail as a fading polyline:

```ts
ctx.globalCompositeOperation = 'lighter';
for (let i = 1; i < trail.length; i++) {
  ctx.globalAlpha = i / trail.length;
  ctx.strokeStyle = projectileColor;
  ctx.lineWidth = projectile.radius * (i / trail.length);
  ctx.beginPath();
  ctx.moveTo(trail[i-1].x, trail[i-1].y);
  ctx.lineTo(trail[i].x, trail[i].y);
  ctx.stroke();
}
```

Trails kept only on bolt + arrow (the long-range weapons). Pulse and orbit don't have trails (they're already large/static). Enemy bullets get a shorter (4-frame) trail.

**Acceptance:** at 60fps, 60 trailing projectiles + their 8-segment trails render in ≤ 1.0ms.

### 3.4 New particle kinds (`src/game/particles.ts`)

Currently only "death" particles exist. Add three additional kinds, all using the pool from Phase 1:
- **Spark** — small (1-2px), bright, fast (240-380 px/s), short life (0.18s), additive blend. Spawned 3-5 per projectile-vs-enemy hit.
- **Smoke** — medium (4-8px), color desaturated (`#1f2937` → `#0b0f17` over life), slow (40-90 px/s), longer life (0.7-1.2s), `globalAlpha` falloff. Spawned 2-3 per enemy death.
- **Magic** — small (2-3px), per-weapon color, additive, drift upward and fade. Spawned 2-3 per projectile spawn (a faint puff at the muzzle).

Particle render branches on `kind`; the new kinds are still circles but with different blend mode + fade curves. Sparks and magic use `'lighter'` composite for the bright additive look.

**Acceptance:** killing 5 enemies in a row produces a layered visual: bright sparks on hits, smoke trail post-death, plus the existing colored death burst.

---

## Phase 4 — Polish & feel

### 4.1 Smooth camera (`src/game/GameEngine.ts:getViewport`)

Today the viewport snaps to the player. Add a smoothed camera target:

```ts
// in GameState: cameraPosition: Vector (initialized to player spawn)
// in update():
const targetX = this.state.player.position.x;
const targetY = this.state.player.position.y;
this.state.cameraPosition.x += (targetX - this.state.cameraPosition.x) * Math.min(1, dt * 8);
this.state.cameraPosition.y += (targetY - this.state.cameraPosition.y) * Math.min(1, dt * 8);
```

`getViewport` reads `cameraPosition` instead of `player.position`. This adds ~50ms of motion lag — barely perceptible but transforms quick direction changes from "hard cut" to "slight glide." Plus a **lookahead**: bias `cameraPosition` toward the aim direction by 40px (`mouseDirection × 40`). Frees the player up to see what they're shooting at.

### 4.2 Hit/death feedback

- **Hit pause**: when the player takes damage, set `engine.timeScale = 0.4` for 0.06s (trivial in `update`: multiply `dt` by `timeScale`, decay scale back to 1). Feels meaty without being jarring.
- **Damage flash**: thin red full-screen vignette (already exists) intensifies briefly on player hit (raise alpha from 0 to 0.4 over 0.1s, decay over 0.4s).
- **Level-up ring**: when phase transitions to `levelUp`, spawn a one-shot expanding ring particle from the player (radius 0 → 220 over 0.45s, stroke fades alpha 0.7 → 0). Adds a "boon arrival" cue under the boon picker.

### 4.3 Player animation

In sprite-cache build (Phase 2), the player sprite is static. Add a **second** player sprite variant — `playerSpriteThruster` — with a thruster flame baked into the rear-bottom. When `input.movement` is non-zero, blit this variant rotated to face the movement direction (independent of the cannon's mouse-aim rotation, which keeps the cannon detail).

### 4.4 Eclipse breath

Subtle global rhythm: slowly cycle `viewport`-anchored backdrop hue by ±3% over a 6s sin curve. Just enough to make the screen feel "alive." Implementation: multiply `globalAlpha` of a single full-screen `#1a0e30` rect (alpha 0–0.06) at the end of `drawBackdrop`.

---

## Phase budgets (all on 1280×720, mid-range laptop, Chromium)

| Phase | Update | Render | Total | Headroom (16.6ms) |
|------|-------:|-------:|------:|-----------------:|
| Today (estimate) | ~3.0 | ~3.5 | ~6.5 | ~10 |
| After Phase 1 | ~1.3 | ~3.5 | ~4.8 | ~12 |
| After Phase 2 | ~1.3 | ~1.8 | ~3.1 | ~13.5 |
| After Phase 3 | ~1.5 | ~3.5 | ~5.0 | ~11.5 |
| After Phase 4 | ~1.6 | ~3.7 | ~5.3 | ~11.3 |

So the final result has both **richer visuals** *and* more headroom than today.

---

## Verification (end-to-end)

Per-phase verification is listed inline. Final cumulative checks:

1. `npm run build` — TypeScript strict pass, vite build succeeds, no new deps in `package.json`.
2. `npm test` — existing 6 vitest tests + new spatial-grid test all green.
3. `npm run dev`, open `http://localhost:5173/?debug=1`:
   - Title screen drift visible, no jank.
   - FPS overlay reads `≥59fps` consistently from t=0 through t=120s on a clean run.
   - Floor shows the ritual circle, runes, dust, vignette.
   - Player aura visible as a soft cyan pool on the floor; entities cast soft drop shadows.
   - Projectiles leave fading trails.
   - Killing an enemy produces sparks → smoke layered on top of the existing colored death burst.
   - Camera glides slightly behind the player on direction change; biases toward the aim direction.
   - Boss spawn (or play to t=300) maintains `≥58fps` with overlay verification; the same 5-enemy kill-streak test produces no GC stutter visible in the overlay.
4. `?debug=1` removed → no overlay visible, no perf logging in console.
5. Resize window 600×400 → 1920×1080: floor + parallax + lighting all scale correctly; sprite cards re-rebuilt only on first resize (DPR-aware).
6. Chrome DevTools Performance recording, 10s at 200s mark: no `Major GC`, `Idle` ≥ 60%.

## Critical files to read before starting each phase

| Phase | Read first |
|------|----|
| 1 | `src/game/GameEngine.ts:111-181` (update/render driver), `src/game/GameEngine.ts:343-462` (collision + gem update), `src/game/particles.ts`, `src/game/enemies.ts:114-136`, `src/components/GameCanvas.tsx:57-70` |
| 2 | `src/game/GameEngine.ts:621-696` (drawEnemies, drawProjectiles, drawBoss), `src/game/GameEngine.ts:704-780` (drawPlayer, drawGems, drawOrbitWeapon) |
| 3 | `src/game/GameEngine.ts:533-569` (drawBackdrop, drawArena), `src/game/state.ts:1-95` (state shape — confirm trail field can be added without test breakage) |
| 4 | `src/game/GameEngine.ts:135-148` (camera transform site), `src/game/GameEngine.ts:78-95` (input + mouseWorld) |

## Out of scope (deliberately deferred)

- WebGL/WebGPU pipeline.
- External art assets (sprite sheets, fonts beyond Inter, pixel-art characters).
- Audio cues.
- Boss HP bar across the top of the screen (still requires a `state.ts` shape change — small follow-up).
- Reroll/skip on the boon picker.
- A scoring/grade system.
- Mobile touch controls.
