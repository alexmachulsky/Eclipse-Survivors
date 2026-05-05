# Eclipse Survivors

A browser-based, top-down survivors-like action roguelike. Hold the line through a 12-minute run, evolve your arsenal, and break the boss before the eclipse breaks you. Single-player or LAN co-op.

## Features

- **Auto-firing arsenal** — 4 weapons (Magic Bolt, Astral Orbit, Area Pulse, Piercing Arrow) with 4 paired evolutions unlocked through level-ups and chest rewards.
- **Run director** — escalating waves across 3 acts, scheduled elites, rift objectives, and a boss finale at the 12-minute mark.
- **Player agency on level-up** — reroll, banish, and lock cards instead of being stuck with bad rolls.
- **Eclipse Shards** — meta-currency earned every run, persisted in the browser. (Spend tree shipping in a follow-up slice.)
- **LAN multiplayer** — drop-in co-op over a server-authoritative WebSocket; share XP and revive downed teammates.
- **Performance-aware rendering** — dynamic glow scaling and a fallback "lite" enemy pass keep the frame rate at 60 fps as the screen fills with hundreds of entities.

## Quick start

The recommended way to run the app is via Docker — the host port is fixed so the URL is stable across rebuilds.

```bash
docker compose up -d --build
```

App: http://127.0.0.1:5176/

For local development without Docker:

```bash
npm install
npm run dev   # vite dev server
```

## Controls

| Action | Input |
|---|---|
| Move | `WASD` or arrow keys |
| Aim / facing | Mouse position |
| Pause | `Esc` or the pause button |
| Debug FPS overlay | Append `?debug` to the URL |

Weapons fire automatically. Walk over XP gems to level up; choose an upgrade card on each level-up. Survive 12 minutes and beat the Night Lich to win the run.

## Tech stack

- **React 18** + **TypeScript 5** for the UI shell and HUD overlays.
- **Vite 8** for the dev server and production bundle.
- **HTML5 Canvas** for all in-game rendering — engine and React are kept strictly separate (engine owns simulation + drawing; React only mirrors a snapshot).
- **Vitest 4** with a manual canvas stub for unit tests; no jsdom.
- **`ws`** for the LAN multiplayer server (a pure TypeScript `GameSim` runs authoritatively on the server and is shared with the client engine).
- **Docker + nginx** for deployment, plus a sidecar Node container running the WebSocket server.

## Development

```bash
npm test               # run the full Vitest suite once
npm run test:watch     # vitest in watch mode
npm run build          # type-check (3 tsconfigs) + vite build + server build
npm run build:server   # build only the WebSocket server
npm run start:server   # run the WebSocket server (node --import tsx)
```

Run a single test file:

```bash
npx vitest run src/game/gameLogic.test.ts
```

Run tests by name:

```bash
npx vitest run -t "spatial grid"
```

There is no separate lint step — `npm run build` runs `tsc --noEmit` against the three project TS configs and is the canonical type-check.

## Project structure

```
src/
  game/                    Engine, simulation, content (no React, no DOM)
    GameEngine.ts            requestAnimationFrame loop, update + render
    GameSim.ts               Pure-TS multiplayer simulation (server + client)
    state.ts, types.ts       Single source of truth for game shape
    content/                 Data-driven registries
      weapons.registry.ts      Each weapon owns its fire(ctx) function
      passives.registry.ts     Each passive owns its apply(player) function
      evolutions.registry.ts   Weapon + passive pairings
    rewards.ts, runDirector.ts, enemies.ts, weapons.ts, ...
    persistence.ts, wallet.ts  localStorage: run history + Eclipse Shards
  components/              React HUD, menus, overlays
  App.tsx                  Top-level shell; subscribes to GameSnapshot
server/
  index.ts                 WebSocket multiplayer server (uses GameSim)
docker-compose.yml         Two services: web (nginx) + multiplayer (node)
```

For a deeper architecture overview, see [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md) (engine/React split, performance hot-path rules, extension checklists for adding new content).

## LAN multiplayer

From the main menu, click **LAN Multiplayer** → either **Create** a room (you'll get a room code) or **Join** with a code. Joiners share the host's run; XP, kills, and end-state are global. Downed players can be revived by standing next to them.

The multiplayer server runs in a separate container (`survival-multiplayer`) reachable through the same nginx reverse proxy at `/ws`. For LAN play across machines, expose the host port `5176` on your local network.

## License

Private project — not currently licensed for redistribution.
