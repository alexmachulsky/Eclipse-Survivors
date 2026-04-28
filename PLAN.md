Create a complete browser-based “Survivor-style action roguelike” game inspired by Vampire Survivors / bullet-heaven games.

Use:
- React + TypeScript
- Vite
- HTML5 Canvas for rendering
- No backend
- No external game engine
- Keyboard + mouse support

Game concept:
A top-down arena survival game where the player moves around, enemies spawn endlessly, weapons auto-fire, the player collects XP gems, levels up, chooses upgrades, survives waves, and fights a boss.

Core gameplay requirements:
1. Player
   - Top-down movement with WASD / arrow keys
   - Smooth movement
   - Health bar
   - Invulnerability flash after taking damage
   - Player faces mouse direction
   - Basic stats: max health, speed, damage, attack rate, pickup radius

2. Enemies
   - Enemies spawn outside the screen and move toward the player
   - Multiple enemy types:
     - slow basic enemy
     - fast low-health enemy
     - tank enemy
     - ranged enemy that shoots projectiles
   - Enemy difficulty increases over time
   - Enemies drop XP gems

3. Combat
   - Weapons auto-fire
   - Start with a basic projectile weapon
   - Add at least 4 weapons:
     - magic bolt
     - spinning orbit weapon
     - area pulse
     - piercing arrow
   - Projectiles should collide with enemies
   - Damage numbers should appear briefly

4. Level-up system
   - Player collects XP gems
   - When XP reaches the threshold, pause gameplay and show 3 random upgrade cards
   - Upgrades can improve:
     - damage
     - attack speed
     - movement speed
     - max health
     - pickup radius
     - unlock or upgrade weapons
   - Selecting an upgrade resumes the game

5. Roguelike run structure
   - Timer-based survival run
   - Game starts easy and becomes harder every 30 seconds
   - Boss spawns at 5 minutes
   - Win condition: defeat the boss
   - Lose condition: player health reaches 0
   - Show Game Over / Victory screen with stats:
     - time survived
     - enemies defeated
     - level reached
     - upgrades collected

6. UI
   - Main menu
   - In-game HUD:
     - health bar
     - XP bar
     - current level
     - timer
     - kill count
     - current weapons
   - Pause menu
   - Level-up upgrade screen
   - Game Over screen
   - Victory screen

7. Visual style
   - Simple but polished 2D neon/dark fantasy style
   - Smooth animations
   - Screen shake on hit
   - Particle effects when enemies die
   - XP gems should glow
   - Boss should look visually different

8. Code quality
   - Organize the project cleanly
   - Use separate files/modules for:
     - game loop
     - player
     - enemies
     - weapons
     - projectiles
     - upgrades
     - collisions
     - particles
     - UI components
     - game state/types
   - Use TypeScript types/interfaces
   - Keep logic readable and commented where useful
   - Make the game easy to extend with more weapons/enemies/upgrades

9. Balancing
   - Make the game immediately playable
   - The first minute should be easy
   - Difficulty should ramp up gradually
   - Level-ups should happen often enough to feel rewarding
   - Weapons should feel different from each other

10. Deliverables
   - Generate all necessary files
   - Include package.json scripts:
     - npm install
     - npm run dev
     - npm run build
   - Make sure the game runs without errors
   - Include a short README with controls and how to run the game

Important:
Do not create placeholder-only code.
Implement the actual playable game.
Focus on a polished MVP that can be expanded later.
