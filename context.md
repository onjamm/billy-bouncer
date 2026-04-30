# Billy Bouncer — Project Context

A western-themed endless vertical jumper built entirely inside a single `index.html` using Phaser 3. No build tools, no bundler, no framework. The full game logic, rendering, audio synthesis, and UI live in one self-contained file that opens directly in a browser or deploys to Vercel.

---

## Stack

| Layer | Tech |
|---|---|
| Game engine | Phaser 3.90.0 (CDN) |
| Physics | Arcade (built into Phaser) |
| Rendering | Phaser Graphics API (procedural) + PNG sprites for Billy |
| Audio | Web Audio API synthesized in code — no audio files |
| Leaderboard backend | Vercel Serverless Function (`/api/leaderboard.mjs`) |
| Leaderboard storage | Upstash Redis (sorted set via `@upstash/redis`) |
| Deployment | Vercel (static + one serverless function) |
| Env vars needed | `KV_REST_API_URL`, `KV_REST_API_TOKEN` |

---

## File Map

```
index.html              ← the entire game (all scenes, logic, audio, UI)
api/leaderboard.mjs     ← GET scores / POST new score to Redis
assets/characters/
  bandit/               ← active sprite set: south.png, east.png, west.png
  bandit-v1/, bandit-v2/← archived previous sprite iterations
  keepsakes/            ← og procedural menu crop (reference only)
docs/
  billy-bouncer-gameplay.png ← README screenshot
.tmp/legacy-index.html  ← old procedural-only version before PNG sprites
```

---

## Game Architecture

### Scenes

**`MenuScene`** (`super("menu")`)
- Bouncing bandit preview on a platform
- OUTLAWS leaderboard panel (top 3, fetched from `/api/leaderboard`)
- Tilt permission button on iOS (`ENABLE TILT`)
- Transitions to `GameScene` on tap/space, passes `motionGranted` flag

**`GameScene`** (`super("game")`)
- All gameplay: platforms, enemies, pickups, combat, scoring
- Leaderboard name prompt (DOM element) shown on new personal best
- Game-over overlay with `RIDE AGAIN` (restart) and `SALOON` (back to menu)
- Transitions back to `MenuScene` or restarts itself

### Coordinate System

Game canvas is always **480 × 800** logical pixels. Rendered via `Phaser.Scale.FIT` + `CENTER_BOTH` — the canvas CSS-scales to fill the viewport while Phaser translates pointer coordinates back to game pixels. **Both `width`/`height` must appear in the `scale` config block**, not just the root config, or `displayScale` miscalculates on mobile and all hit detection breaks.

The camera scrolls upward following Billy. World Y decreases as altitude increases. `pointer.x/y` are in screen-space (correct for `scrollFactor(0)` UI elements). `pointer.worldX/worldY` account for camera scroll and are used for in-game targeting (shooting).

### Altitude System

Altitude = how far Billy has climbed (positive feet, increasing as world Y decreases). Used to drive difficulty scaling, visual themes, and enemy weighting.

| Altitude | Theme | Enemy mix |
|---|---|---|
| 0–1000 ft | Parchment / desert | Snake-heavy |
| 1000–3000 ft | Mesa dusk | Balanced |
| 3000–5000 ft | Lantern-lit dark | Heavy/UFO rising |
| 5000+ ft | Deep indigo night | UFO-heavy |

### Platform Table (`PLATFORM_TABLE`)

Each band defines: ceiling altitude, platform types allowed, gap ranges, and probabilities. Types: `normal`, `movingH`, `movingV`, `fragile`, `vanishing`, `exploding`. Springs can mount on any platform.

### Enemy Weights

`ENEMY_WEIGHTS_LOW` (< 3500 ft): snakes 48%, vultures 22%, heavies 18%, UFOs 12%  
`ENEMY_WEIGHTS_HIGH` (≥ 3500 ft): snakes 20%, vultures 25%, heavies 26%, UFOs 29%

---

## Key Constants (tuning reference)

```js
// Canvas
GAME_W = 480, GAME_H = 800

// Player physics
GRAVITY = 1400
JUMP_VELOCITY = -680          // auto-jump on landing
PLAYER_SPEED = 340            // horizontal
PLAYER_BODY_W = 28, PLAYER_BODY_H = 46  // physics hitbox

// Combat
PELLET_SPEED = 980
SHOT_COOLDOWN = 500           // ms between shots
MAX_PELLETS = 3               // on screen at once

// Power-up durations (ms)
JETPACK_MS = 3000
ROCKET_MS = 1500
PROPELLER_MS = 1800

// Boost velocities
PLATFORM_SPRING_VELOCITY = -1300
PICKUP_SPRING_VELOCITY = -1600
ROCKET_VELOCITY = -2200
BOOTS_VELOCITY = -1360, BOOTS_BOUNCES = 6

// Medal thresholds (ft)
BRONZE = 20,000  SILVER = 50,000  GOLD = 100,000

// Bandit sprite scale
BANDIT_MENU_SCALE = 2.2
BANDIT_GAME_SCALE = 2.2
BANDIT_SPRITE_ORIGIN_Y = 0.62   // anchor at ~lower-torso so feet sit on platforms
```

---

## Bandit Sprite

Three directional PNGs loaded as Phaser textures:
- `south.png` — neutral/idle (facing camera)
- `east.png` — moving right
- `west.png` — moving left

`getBanditTextureKeyForState(state)` picks the variant based on `vx`. `syncBanditSprite()` applies position, scale, and flash alpha each frame. The sprite sits in front of an invisible Arcade physics rectangle that drives all collision.

---

## Leaderboard API (`/api/leaderboard.mjs`)

- **GET `/api/leaderboard`** — returns top 3 unique-by-name scores as `{ ok, entries: [{name, score}] }`
- **POST `/api/leaderboard`** — body `{ name, score }` — deduplicates by name (keeps best), trims board to 200 entries max
- Name sanitized server-side: uppercase, alphanumeric + space/period/apostrophe/hyphen, max 12 chars
- `canUseOnlineLeaderboard()` in the client gates all leaderboard calls to `http:` or `https:` protocols only
- Score submission only triggers when the new score beats the locally stored `billy_bouncer_last_submitted`

---

## Mobile Input Notes

Mobile touch goes through Phaser's pointer system. A few things that have bitten this project:

- **`touch-action: none` on the canvas** is required in CSS — without it some browsers swallow touch events for scroll/zoom before Phaser sees them.
- **`width`/`height` in the `scale` config** (not just root config) — required for Phaser 3.60+ to compute `displayScale` correctly on mobile. Missing this makes `pointer.x/y` report CSS pixels instead of game pixels, breaking all hit detection on smaller screens.
- **`this.scale.refresh()`** is called in `revealGameOverOverlay()` — forces fresh canvas bounds after the leaderboard keyboard closes and shifts the viewport on mobile.
- **`pointerup` scene handler** mirrors `pointerdown` for the game-over overlay — catches taps on mobile browsers where `pointerdown` coordinates are stale right after a viewport resize.
- Tilt controls use `DeviceOrientationEvent` / `DeviceMotionEvent`. iOS 13+ requires explicit `DeviceMotionEvent.requestPermission()` — gated by `needsExplicitTiltPermission()`. The `ENABLE TILT` DOM button in the menu handles this flow; result is passed as `motionGranted` into `GameScene`.

---

## Audio

`AudioEngine` class wraps the Web Audio API. All sounds are synthesized at runtime — no audio files. Categories: jump, land, shoot, hit, game-over, pickup, powerup, coin. `audio.unlock()` is called on first user gesture (required by browsers). `audio.stopAll()` on scene shutdown.

---

## localStorage Keys

| Key | Value |
|---|---|
| `billy_bouncer_best` | Personal best score (ft) |
| `billy_bouncer_handle` | Last-used leaderboard name |
| `billy_bouncer_last_submitted` | Last score submitted to board |

---

## Running Locally

No install needed. Just open `index.html` in Chrome, or:

```bash
python -m http.server 3000
# then visit http://localhost:3000
```

Leaderboard won't work locally unless `KV_REST_API_URL` + `KV_REST_API_TOKEN` are set and the Vercel dev server is running (`vercel dev`).

Live deployment: **https://billy-bouncer.vercel.app**
