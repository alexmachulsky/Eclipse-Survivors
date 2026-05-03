# Eclipse Survivors

A browser-based Survivor-style action roguelike built with React, TypeScript, Vite, and HTML5 Canvas.

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal.

## Docker

```bash
docker compose up -d --build
```

The app is served at `http://127.0.0.1:5176/`. The host port is fixed in `docker-compose.yml`, so rebuilds keep the same URL.

## Build

```bash
npm run build
```

## Test

```bash
npm test
```

## Controls

- Move: `WASD` or arrow keys
- Aim/facing: mouse position
- Pause: `Esc` or the pause button

Weapons fire automatically. Collect XP gems, choose upgrades on level-up, survive the escalating waves, and defeat the boss that appears at 5 minutes.
