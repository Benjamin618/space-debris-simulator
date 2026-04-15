# Space Debris Sandbox

Portfolio project aimed at demonstrating relevant engineering instincts for an Astroscale AIV Engineer - Computer Vision & GNC role.

The repository now contains:

- a desktop `pygame` milestone that renders the truth scene
- a web `canvas` V2 sandbox with a truth view and an ego-centric radar/tracking view

## Why This Project Exists

This is not intended to be just a visual animation.

The goal is to show a validation-oriented mindset through a small but structured simulation stack:

- truth-world simulation
- explicit sensing assumptions
- noisy measurements
- state estimation
- classification uncertainty
- reproducible scenario configuration

That aligns more closely with AIV-style work than a purely omniscient demo.

## Current Architecture

### Desktop Python

- [main.py](C:\Users\benja\DS_projects\space-debris-sandbox\main.py) loads a JSON scenario and launches the `pygame` renderer
- [src/utils/config.py](C:\Users\benja\DS_projects\space-debris-sandbox\src\utils\config.py) parses desktop scenario files
- [src/sim/](C:\Users\benja\DS_projects\space-debris-sandbox\src\sim) contains basic world and object propagation
- [src/viz/renderer.py](C:\Users\benja\DS_projects\space-debris-sandbox\src\viz\renderer.py) renders the truth scene

### Web V2

- [web/index.html](C:\Users\benja\DS_projects\space-debris-sandbox\web\index.html) hosts the dual-panel interface
- [web/app.js](C:\Users\benja\DS_projects\space-debris-sandbox\web\app.js) contains:
  - truth-world motion and mission logic
  - ego-centric radar sensing
  - per-object Kalman tracking
  - simulated classification based on object size and observation quality
- [web/config/](C:\Users\benja\DS_projects\space-debris-sandbox\web\config) stores seeded scenarios and radar/classification parameters

## Web V2 Overview

The web sandbox separates five ideas that are often mixed together in small demos:

1. `Truth`
   Objects move in the world with known ground-truth state.
2. `Radar sensing`
   A rotating beam revisits targets and produces noisy `range` / `bearing` observations.
3. `Tracking`
   Each detected debris object owns a Kalman track with state `(x, vx, y, vy)` in an ego-relative frame.
4. `Classification`
   A separate vision-style estimator infers object category from physical size and observation quality.
5. `Visualization`
   The left panel shows truth; the right panel shows what the ego-centered sensing/tracking stack currently believes.

## What V2 Demonstrates

- `Computer vision validation mindset`
  Classification confidence drops with distance rather than staying artificially certain.
- `GNC validation mindset`
  Relative state tracks persist between radar revisits and are updated only by measurements.
- `Reproducibility`
  Radar noise and scenario behavior are seeded through JSON config.
- `Engineering quality`
  Truth, sensing, estimation, and interpretation are kept conceptually separate.

## Important Assumptions

V2 is intentionally simplified and documents those simplifications honestly:

- 2D sandbox, not orbital mechanics
- constant-velocity debris motion in V2
- ego truth state treated as perfectly known
- one explicit sensor model: radar
- classification is simulated, not learned with a CNN
- colors are only for the analyst-facing truth display

Those assumptions are deliberate so the project stays readable and portfolio-friendly while still demonstrating relevant engineering structure.

## Releases

- `v0.1.0-m1`
  Desktop milestone 1 truth-scene animation
- `v0.2.0-web-v1`
  Initial web mission loop with player/greedy control, scoring, and mission management
- `current working state`
  Web V2 radar tracking sandbox

## Run The Desktop App

Use the workspace virtual environment:

```powershell
venv\Scripts\python.exe main.py
```

Run a different scenario file:

```powershell
venv\Scripts\python.exe main.py --config config\scenario_default.json
```

Quick headless smoke test:

```powershell
$env:SDL_VIDEODRIVER='dummy'
venv\Scripts\python.exe main.py --max-frames 5
```

## Run The Web App

Start a static server from [web](C:\Users\benja\DS_projects\space-debris-sandbox\web):

```powershell
cd web
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Web Controls

- `Mode`
  `Player` for discrete piloting, `Greedy` for the simple autonomy baseline
- `Arrows`
  Issue one player command at a time in `Player` mode
- `Space`
  Pause / resume
- `G`
  Toggle world grid
- `L`
  Toggle labels
- `V`
  Toggle velocity vectors
- `T`
  Toggle trails
- `R`
  Restart mission

## Scenario Content

Web scenarios now contain:

- world and UI parameters
- ego control and mission scoring parameters
- radar sensing parameters
- tracking tuning parameters
- classification confidence parameters
- per-object truth metadata such as `true_category` and `physical_size`

## Spec

The V2 design intent is captured in:

- [specs/v2_radar_tracking_spec.md](C:\Users\benja\DS_projects\space-debris-sandbox\specs\v2_radar_tracking_spec.md)

## Next Directions

Likely post-V2 steps:

- richer relative-motion models
- second-order or maneuvering debris dynamics
- explicit telemetry export
- camera-style synthetic observations
- more realistic track management and data association
