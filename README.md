# Space Debris Sandbox

Milestone 1 delivers a clean 2D real-time simulation for a computer vision portfolio project inspired by satellite perception and space debris monitoring.

## Features

- 2D animated scene with an ego satellite and multiple moving objects
- Object classes with dedicated colors and labels
- Real-time loop powered by `pygame`
- Simple kinematics with wrap-around world boundaries
- Scenario configuration loaded from a JSON file
- Visual UI with legend, object list, frame rate, and controls

## Run

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

## Controls

- `Space`: pause / resume
- `G`: toggle grid
- `L`: toggle labels
- `V`: toggle velocity vectors
- `T`: toggle trails
- `Esc`: quit

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
