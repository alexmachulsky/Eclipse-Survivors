# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> See also [AGENTS.md](AGENTS.md) for an extended module table and pitfalls list. **Caveat:** AGENTS.md predates the content-registry refactor and the LAN ship — it still calls LAN "WIP" and points weapon/passive logic at `weapons.ts`/`content.ts`. When the two disagree, this file wins.

## Commands

```bash
npm run dev          # start Vite dev server
npm run build        # type-check all three TS configs then vite build + server build
npm test             # run all Vitest tests once
npm run test:watch   # run tests in watch mode
```

> Note: `.gitignore` ignores `*.md` except `!README.md` and `!CLAUDE.md` — those two are tracked, so a fresh clone carries them. Everything else (`docs/`, **`AGENTS.md`**, agent spec/plan files) is disk-only and won't commit without `-f`.

Run a single test file:
```bash
npx vitest run src/game/gameLogic.test.ts
```

Run tests matching a name pattern:
```bash
npx vitest run -t "spatial grid"
```

Server commands:
```bash
npm run build:server   # build the WebSocket server (vite --ssr)
npm run start:server   # run the WebSocket server (node --import tsx)
```

Docker:
```bash
docker compose up -d --build   # serve at http://127.0.0.1:5176/
```

**Always start the app using `docker compose up -d --build`** — do not use `npm run dev` to run the app.

There is no separate lint step — `npm run build` runs `tsc --noEmit` on `tsconfig.json`, `tsconfig.node.json`, and `tsconfig.server.json` to catch type errors.

Debug mode: append `?debug` to the URL in the browser to show a live FPS overlay.

### CI / merge flow

`.github/workflows/pr-auto-merge.yml` runs `npm run build` + `npm test` on every PR, then enables **squash auto-merge** — a PR merges itself once those two checks pass, with no human approval gate. So a green build+test is the bar for landing; make sure both pass locally before pushing. Code review is intentionally **not** in CI; it's expected to be run locally (the workflow comment documents a Codex command) before pushing.

## Architecture

### Engine / React split

All mutable game state lives inside `GameEngine` (`src/game/GameEngine.ts`). React is used only for HTML overlays (HUD, menus, upgrade picker). The split works like this:

- `GameCanvas` (`src/components/GameCanvas.tsx`) owns the `requestAnimationFrame` loop. Each frame it calls `engine.update(dt)` then `engine.render(ctx)` on the HTML5 canvas.
- `App` (`src/App.tsx`) holds `engineRef` and subscribes to `GameSnapshot` — a plain object extracted by `engine.getSnapshot()`. Snapshots are pushed into React state at ≤20 Hz from the animation loop (more frequently via direct calls on user actions like pause).
- React never touches `GameState` directly; it only reads `GameSnapshot` and calls the engine's command methods — core: `startRun`, `pause`/`resume`/`togglePause`, `selectUpgrade`, `setMovement`, `setMouse`, `setViewSize`, `setPerformanceMode`, `dash`; solo-only agency: `rerollChoices`, `banishChoice`, `lockChoice`; plus `debugLevelUp`/`debugOpenChest`/`debugSpawn*` in debug mode.

### Game loop

`update(dt)` runs all simulation logic in a fixed order: time tracking and screen-shake decay → player movement and dash → run-director events and objectives → enemy spawning, health pickups, weapon firing, and enemy AI (all gated while a cinematic plays) → projectile movement → combat resolution → gem/pickup/reward-chest collection → effect decay → end-state check.

`render(ctx)` draws the world by translating the canvas to `(shakeOffset.x - viewport.x, shakeOffset.y - viewport.y)` so all draw calls use world coordinates directly.

### State mutation rules

- Sub-modules (`enemies.ts`, `player.ts`, `projectiles.ts`, etc.) receive slices of state and return new values — they do not mutate `GameState` directly. Only `GameEngine` writes results back.
- Never import `GameState` or `GameEngine` into a sub-module. Pass only what the function needs.
- **`update(dt)` is simulation-only** — no canvas API calls, no DOM access.
- **`render(ctx)` is rendering-only** — no mutation of `GameState`, and no `this.rng()` (one known wart: `drawRangedEnemy` jitters with `this.rng()` for a pre-fire wobble — don't add more, since consuming RNG during render couples the sequence to frame count).
- All randomness in `update()` must go through `this.rng` (or the `rng` argument passed to sub-modules), not `Math.random()`.

### Game state

`GameState` (`src/game/types.ts`) is a single flat object — `types.ts` is the single source of truth for all interfaces and union types. `createInitialGameState` (`src/game/state.ts`) is the canonical source for default values — arena size (3200×2400), starting player stats, starting weapon loadout.

### Run director

`runDirector.ts` drives timed events — elites, objectives, and the boss — via `collectRunDirectorEvents()`. The run is 720 seconds total. Acts: Act 1 (<210s), Act 2 (210–480s), Act 3 (480–720s). The timing constants (`RUN_LENGTH_SECONDS`, `ELITE_SCHEDULE = [150, 330, 510, 645]`, `OBJECTIVE_SCHEDULE = [270, 480, 630]`) live in `content.ts`, not `runDirector.ts`. Never spawn elites/bosses directly from game logic; use the run director or `debugSpawn*` methods for testing.

### Rendering performance

Two mechanisms keep the frame rate at 60 fps:

1. **Performance mode** — `GameCanvas` samples FPS every 250 ms. If it falls below 58 fps for two consecutive windows it calls `engine.setPerformanceMode(true)`, which disables all glow effects and swaps each enemy's detailed sprite for a pre-rendered lite variant (`spriteGroup.lite` in `renderAssets.ts`). Performance mode turns off again after 16 consecutive windows at ≥59.5 fps.

2. **Dynamic glow scale** — Even outside performance mode, `glowScale` is set to 0 (≥90 entities), 0.35 (55–89 entities), or 1.0 (<55 entities) each frame. The `setGlow()` helper multiplies `shadowBlur` by `glowScale` internally and drops the shadow color when the result is 0, so most `setGlow()` calls are unconditional — use it instead of assigning `ctx.shadowBlur` directly. Per-entity hot paths (particles, damage texts) additionally guard with `if (!this.fastRender)`, where `fastRender = performanceMode || glowScale === 0`.

### HUD bars (CSS)

Meter bar-fill rules must use the direct-child combinator (`.health-meter > span`, `.xp-meter > span`, `.boss-health-meter > span`). The descendant selector also matches the inline `.meter-divider` / `.meter-max` / `.meter-suffix` spans inside `<strong>`, painting them with the bar's gradient.

### Performance hot-path rules

- Use `circlesOverlapSq` / `distanceSq` from `collisions.ts` in loops — **not** `Math.hypot` or `distance`.
- Avoid allocating new objects inside `update()` and `resolveCombat()` — filter arrays in-place or reuse existing objects.
- Always cap `dt` to `0.05` before passing to sub-modules to prevent physics tunneling on tab wake-up. `GameEngine` additionally scales by `state.timeScale` first — `Math.min(0.05, dt * timeScale)` — to drive the brief level-up slow-mo (`timeScale` drops to `0.35` on level-up and ramps back to `1.0`).

### Render assets

`GameCanvas` calls `engine.preloadRenderAssets()` on mount — this must happen before the first render frame. All sprite sheets are generated to offscreen canvases in `renderAssets.ts` and cached for the lifetime of the engine.

### Background rendering

`CosmicLayers` (`src/game/cosmic.ts`) holds three pre-baked offscreen `HTMLCanvasElement`s (far nebula tile, mid star tile, floor tile) plus an array of `TwinkleStar` objects. They are created once lazily in `ensureCosmic()` and **never recreated on viewport resize** — the tiles are larger than the viewport.

### Collision broadphase

`SpatialGrid` (`src/game/spatialGrid.ts`) partitions enemies into 96-px cells. Before processing player projectiles each frame, enemies are re-inserted into the grid; each projectile only checks candidates from overlapping cells. The grid must be rebuilt each frame before resolving projectile collisions. The rebuild lives inside `resolveCombat()` → `resolvePlayerProjectiles()`, which runs *after* all movement — so the grid is frame-local. Don't reuse `enemyGrid` for queries earlier in `update()`; it would be stale from the previous frame (build a separate grid or brute-force those).

### Weapons

Five weapons: `magic-bolt` (auto-aimed bolt), `orbit` (rotating blades that resolve hits directly), `area-pulse` (expanding ring), `piercing-arrow` (long-range, multi-pierce), `homing-missile` (Seeker Missile — slow muzzle speed, tracks via the projectile's `homingTurnRate` field). Only `magic-bolt` is unlocked at game start; the rest are offered as level-up upgrades. `orbit` **and** `area-pulse` resolve their hits directly in the engine loop without creating `Projectile` objects — both declare `fire: () => []` in the registry, and `GameEngine` special-cases them instead of going through the normal projectile path.

Weapons, passives, and evolutions live in data-driven registries under `src/game/content/`: `weapons.registry.ts` (each entry owns its `fire(ctx)` function), `passives.registry.ts` (each entry owns `apply(player)`), `evolutions.registry.ts` (each entry declares the weapon/passive pairing and level requirements). `WeaponId`, `PassiveId`, and `EvolutionId` are `string` aliases — the registries are the source of truth for valid ids.

**Watch the naming overlap:** the `content/` **directory** holds the behavior registries above, but a separate `content.ts` **file** holds the *display/metadata* layer — `PASSIVES` (the `name`/`description`/`maxLevel` shown on level-up cards), `STAT_UPGRADES`/`RARE_STAT_UPGRADES`, and the run-director schedule constants. So a passive is split across two files: `createPassiveChoices` (`rewards.ts`) reads its card text from `content.ts`, while `applyUpgrade` runs its effect from the registry. The two passive lists must stay in sync — `gameLogic.test.ts` asserts they share ids and `maxLevel`.

### Dash

`src/game/dash.ts` is a pure-function module that owns dash math: `tickDashCooldown`, `startDash`, `tickDashMotion`, `resolveDashHits`, `tryQueueDash`, `consumeDashQueue`. It has no engine import — the engine and `GameSim` both call these functions and write results back to `Player.dash`. Dash multipliers (`dashDamageMult`, `dashRechargeMult`, `dashChargeBonus`) are mutated by passives in `passives.registry.ts` and read back by `dash.ts` through the player. To add a new dash-affecting passive, add an entry to the passive registry that mutates one of those three multiplier fields — no engine changes needed. Input: `Space` in solo (handled in `GameCanvas.tsx` via `engine.dash()`), and the edge-triggered `dashHeld` field on `PlayerCommand` in LAN (handled in `GameSim.updatePlayers`). Server is authoritative — `startDash` returns null when guards fail (no charges, already dashing, zero direction). Render-only state (`dashTrail`) lives on the engine class, not `GameState`. Dash input is buffered: `tryQueueDash` arms a one-shot `queued` flag only within the last `DASH_CONFIG.queueWindow` (0.08 s) of an active dash, and `consumeDashQueue` fires it the frame that dash ends. Preserve the `tickDashCooldown` → `tickDashMotion` → `consumeDashQueue` ordering — reordering it or changing the `dt` handling there breaks rapid-dash feel.

### Upgrade agency (reroll / banish / lock)

Solo runs only — LAN is intentionally unchanged this slice. `GameState.agency` tracks `rerolls` (default 2, `maxRerolls`) and `locks` (default 1, `maxLocks`) — both refill to their max on **every** level-up — plus `banishes` (default 1), a fixed per-run budget that has **no** `maxBanishes` field and is never refilled. Don't "fix" that asymmetry by adding per-level banish restoration; it's deliberate. `bannedUpgradeIds` and `lockedSlot` live on `GameState`; `bannedUpgradeIds` persists across level-ups, `lockedSlot` resets on `selectUpgrade`. Engine commands: `rerollChoices()`, `banishChoice(index)`, `lockChoice(index)` — all no-op outside the `levelUp` phase. `createUpgradeChoices` accepts `bannedIds` and an optional `preserveCard` (locked card always lands in slot 0 after a reroll).

### Persistence

`persistence.ts` stores run history to `localStorage` under key `eclipse-survivors:run-history` (best + last run records). `wallet.ts` stores the Eclipse Shards ledger under key `eclipse-survivors:wallet` (current balance + lifetime earned). The engine credits shards exactly once on the `gameOver`/`victory` phase transition via `creditWallet()`; reward formula in `calculateRunReward()`.

> **Branding note:** the player-facing product is "Space Raiders" (see `index.html`), but the codebase predates that rebrand — `localStorage` keys (`eclipse-survivors:*`), the package name (`survival-roguelike`), and internal "Eclipse Survivors" references are intentionally unchanged. Do **not** rename the `localStorage` keys to match the brand; that would orphan every existing player's saved wallet and run history.

### LAN multiplayer

`src/game/GameSim.ts` is the pure-simulation class (no canvas/DOM) that runs the authoritative game on the WebSocket server (`server/index.ts`, using `ws`). **`GameSim` and `GameEngine` are separate, parallel implementations that never import each other** — `GameSim` is referenced only by `server/index.ts` and tests; `GameEngine` is the browser engine. They are kept in lockstep through the shared pure functions in `simulation.ts` (see below), *not* through code reuse. On the client, LAN runs do not simulate: `LanGameCanvas` (wired in `App.tsx`) reuses `GameEngine` purely as a **renderer**, feeding each server snapshot in via `engine.loadMultiplayerState(...)`. Do not introduce canvas/DOM imports into `GameSim.ts` — it must stay pure TypeScript with no browser globals.

`src/game/simulation.ts` holds the spawn-pack, objective-curse, and on-kill passive (Bloodlust, Adrenal Surge) math as pure functions that **both** `GameEngine` and `GameSim` call — keeping the solo and authoritative sims in lockstep is what prevents multiplayer desync. Like `GameSim.ts`, it must stay pure (no canvas/DOM/module-level mutable state) and route all randomness through the caller-supplied `rng`. Mind the deliberate mutation asymmetry in that module: `applyCurseToEnemy` returns a **new** enemy (used for fresh spawns), while `applyCurseToExistingEnemies` / `relieveCurseFromExistingEnemies` mutate the live array **in place** (applied/peeled when an objective resolves). Don't unify them — the spawn path must stay copy-on-write while the on-resolve path is an in-place sweep.

### Tests

Tests run under Vitest with `environment: 'node'` (no jsdom). The canvas API is manually stubbed via `installCanvasStub()` for tests that exercise rendering paths.

- Game logic: `src/game/gameLogic.test.ts`; dash math: `src/game/dash.test.ts`; HUD-update throttle: `src/components/hudThrottle.test.ts`.
- Server tests in `server/`: `originPolicy.test.ts` (WS origin allowlist), `security.test.ts` (rate limiting, payload caps), `multiRoom.test.ts` (room lifecycle), `dash.test.ts` (server-authoritative dash).

### Extending the game

**New enemy type:** Add type to `EnemyType` union in `types.ts` → add blueprint in `enemies.ts` → add render logic in `GameEngine.ts` → weight into `chooseEnemyType()` in `enemies.ts`. (Enemies still use a string-literal union; only weapons/passives/evolutions moved to registries.)

**New weapon:** Add an entry to `WEAPONS` in `src/game/content/weapons.registry.ts` (id, metadata, `fire(ctx)` returning `Projectile[]`) → register the weapon in `state.ts:createStartingWeapons()` with `unlocked: false`. The level-up roller in `rewards.ts:createWeaponChoices` reads from the live `Weapon[]`, so no extra card wiring is needed. `WeaponId` is `string` — do not edit `types.ts`. If the weapon resolves hits directly instead of spawning projectiles (like `orbit`/`area-pulse`), return `[]` from `fire` and add the hit-resolution branch in the `GameEngine` firing loop.

**New passive:** Two places (see the registry-vs-`content.ts` note under "Weapons"). (1) Add the `apply(player)` behavior to `PASSIVES` in `src/game/content/passives.registry.ts` — `applyUpgrade` dispatches through the registry, no per-passive branching. (2) Add matching card metadata (`name`, `description`, `maxLevel`) to the `PASSIVES` array in `src/game/content.ts` — `createPassiveChoices` builds the level-up card from this. Skip (2) and the passive never appears as a card; skip (1) and the card has no effect; the sync test fails if ids or `maxLevel` diverge. To pair as an evolution, add an entry to `EVOLUTIONS` in `src/game/content/evolutions.registry.ts` with `weaponId`, `passiveId`, and the level requirements.

## Style

TypeScript with ES imports, two-space indentation, semicolons, single quotes. PascalCase for React components and exported classes; camelCase for functions and variables; kebab-case string IDs for game content (`magic-bolt`, `void-core`). Prefer explicit interfaces and union types in `src/game/types.ts`. Concise imperative commits with Conventional Commit prefixes: `feat:`, `refactor:`, `chore:`, `fix:`.
