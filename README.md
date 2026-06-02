# Space Raiders

A browser-based, top-down survivors-like action roguelike. Hold the line through a 12-minute run, evolve your arsenal, and break the boss before the eclipse breaks you. Single-player or LAN co-op.

## Features

- **Auto-firing arsenal** — 5 weapons (Magic Bolt, Astral Orbit, Area Pulse, Piercing Arrow, Seeker Missile) with 5 paired evolutions unlocked through level-ups and chest rewards.
- **Run director** — escalating waves across 3 acts, scheduled elites, rift objectives, and a boss finale at the 12-minute mark.
- **Player agency on level-up** — reroll the three-card draw (2× per level-up), banish a card for the rest of the run (1× per run), or lock a card so a reroll can't replace it (1× per level-up). No more being stuck with bad rolls. *(Solo runs; LAN uses the standard draw.)*
- **LAN multiplayer** — drop-in co-op over a server-authoritative WebSocket; share kills and revive downed teammates.
- **Eclipse Shards** — a meta-currency earned at the end of every run and saved in your browser. Currently earn-only; a way to spend them is planned for a later update.
- **Performance-aware rendering** — dynamic glow scaling and a fallback "lite" enemy pass keep the frame rate at 60 fps as the screen fills with hundreds of entities.

## Requirements

- **Docker + Docker Compose** — the recommended way to run the app.
- **Node.js 20.19+** (or 22+) — only needed for local development without Docker; the Docker build itself uses Node 22.
- A modern browser with HTML5 Canvas and WebSocket support.

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
| Dash | `Space` |
| Pause | `Esc` or the pause button |
| Debug FPS overlay | Append `?debug` to the URL |

Weapons fire automatically. Dash (`Space`) is a quick burst with brief invulnerability and has 2 charges that recharge over time. Walk over XP gems to level up and choose an upgrade card on each level-up. Survive 12 minutes and beat the Night Lich to win the run.

## Gameplay loop

A run lasts **12 minutes** (720 seconds) across three acts of rising pressure:

- **Act 1** (0–3:30) — opening waves; the first scheduled elite.
- **Act 2** (3:30–8:00) — denser spawns plus timed **rift objectives**: capture them to keep the arena's curse in check; miss them and surviving enemies grow faster and hit harder (curses stack, up to a cap).
- **Act 3** (8:00–12:00) — peak waves leading into the **Night Lich** boss at the 12-minute mark.

Kills drop XP gems; collect them to level up and pick an upgrade card — a new weapon, an evolution, a passive, or a stat boost. Scheduled **elites** arrive at 2:30 / 5:30 / 8:30 / 10:45 and **rift objectives** at 4:30 / 8:00 / 10:30. Defeat the Night Lich to clear the run; win or lose, you bank **Eclipse Shards** based on how far you got.

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
    rewards.ts, runDirector.ts, enemies.ts, weapons.ts, simulation.ts, ...
    persistence.ts, wallet.ts  localStorage: run history + Eclipse Shards
  components/              React HUD, menus, overlays
  App.tsx                  Top-level shell; subscribes to GameSnapshot
server/
  index.ts                 WebSocket multiplayer server (uses GameSim)
docker-compose.yml         Two services: survival (nginx) + multiplayer (node)
```

For a deeper architecture overview, see [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md) (engine/React split, performance hot-path rules, extension checklists for adding new content).

## LAN multiplayer

From the main menu, click **LAN Multiplayer** → either **Create** a room (you'll get a room code) or **Join** with a code. Joiners share the host's run; kills and end-state are global, but each player collects XP individually. Downed players can be revived by standing next to them.

**Playing across machines on the same network:**

1. On the host, start the app (`docker compose up -d --build`) and find the machine's LAN IP — `hostname -I` / `ip addr` (Linux), `ipconfig` (Windows), or `ifconfig` (macOS), e.g. `192.168.1.50`.
2. Each player opens `http://<host-ip>:5176/` in a browser on the same network.
3. One player clicks **Create** to get a room code; the others **Join** with it.
4. If joiners can't connect, make sure the host's firewall allows inbound TCP on port `5176`.

The multiplayer server runs in a separate container (`survival-multiplayer`) reachable through the same nginx reverse proxy at `/ws`.

## Troubleshooting

- **Port 5176 already in use** — another process or a previous container is holding it. Stop the old stack with `docker compose down`, or change the host side of the `5176:8080` mapping in `docker-compose.yml`.
- **Code changes aren't showing up** — the Docker image is built, not live-mounted. Rebuild with `docker compose up -d --build` after editing source.
- **`npm run build` fails** — there's no separate lint step, so a red build is usually a type error; `npm run build` runs `tsc --noEmit` across the three tsconfigs. Run it locally to see the exact failure.
- **LAN peers can't join** — confirm everyone is on the same network and the host's firewall allows port `5176` (see above).

## License

Private project — not currently licensed for redistribution.
