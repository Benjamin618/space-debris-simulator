# Space Debris Sandbox

Portfolio project for satellite perception: a modular 2D simulation for debris dynamics, tracking, and autonomous decision-making.

The repository currently includes:

- a desktop Milestone 1 simulation in Python with `pygame`
- a web V1 in plain `canvas` and JavaScript for lightweight deployment

## Features

- 2D animated scene with an ego satellite and multiple moving objects
- Object classes with dedicated colors and labels
- Real-time loop powered by `pygame`
- Simple kinematics with wrap-around world boundaries
- Scenario configuration loaded from a JSON file
- Visual UI with legend, object list, frame rate, and controls
- Canvas web demo with matching scene logic and keyboard controls
- Web metrics for battery, mission score, collected debris, and avoided threats

## Desktop Run

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

## Web Run

The web app is a static site inside `web/`.

Start a local static server from that folder:

```powershell
cd web
python -m http.server 8080
```

Then open `http://localhost:8080`.

For deployment, publish the contents of `web/` on GitHub Pages, Netlify, or Cloudflare Pages.

## Controls

- `Space`: pause / resume
- `G`: toggle grid
- `L`: toggle labels
- `V`: toggle velocity vectors
- `T`: toggle trails
- `Esc`: quit

Web:

- mission duration capped at `3 minutes`
- `Mode`: `Player` by default, switchable to `Greedy`
- `Arrows`: issue one pilot action at a time inside the centered control frame in `Player` mode
- same direction repeatedly: speed levels `20 -> 40 -> 80 px/s`
- opposite arrow to current motion: stop ego
- one piloting action is allowed every `1.0 s`
- `Greedy`: avoid nearby `dangerous_debris`, otherwise move toward the closest `collectable_debris`
- battery consumption exists even at rest, with an extra cost proportional to the square of ego speed
- mission score combines collected targets, avoided threats, missed-threat penalties, and a sobriety bonus
- a mission summary overlay appears at the end with score, duration, energy use, and restart action
- `Space`: pause / resume
- `G`: toggle grid
- `L`: toggle labels
- `V`: toggle velocity vectors
- `T`: toggle trails
- `R`: restart mission

## Scenario file

The default scenario lives in `config/scenario_default.json`.

Main sections:

- `window`: window size, FPS, title
- `world`: simulation dimensions, grid spacing, stars, random seed
- `ui`: overlay toggles and side panel width
- `class_styles`: labels and RGB colors per class
- `ego`: ego satellite definition
- `objects`: list of moving scene objects

Each object uses:

```json
{
  "name": "DEB-A",
  "object_class": "dangerous_debris",
  "radius": 10.0,
  "position": [250.0, 160.0],
  "velocity": [42.0, 18.0]
}
```

The web demo ships with self-contained copies in `web/config/`.
