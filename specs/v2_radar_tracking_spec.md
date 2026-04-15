# V2 Radar Tracking Sandbox Spec

## Objective

Evolve the project from an omniscient animation into a technically credible validation sandbox for an Astroscale AIV Engineer - Computer Vision & GNC portfolio.

V2 introduces a full perception-style loop:

- truth-world simulation
- ego-centric radar sensing with a rotating beam
- noisy `range` / `bearing` measurements
- per-object Kalman tracking
- vision-style classification kept separate from tracking
- explicit confidence degradation with observation distance

## Why This Matters

This version is meant to demonstrate more than rendering:

- CV validation mindset: imperfect sensing, class uncertainty, observation quality
- GNC validation mindset: relative state estimation, track maintenance, motion prediction
- reproducibility: scenario-driven seeded behavior
- engineering quality: explicit separation between truth, sensing, estimation, and interpretation

## Scope

### In Scope

- preserve the current web mission sandbox and truth view
- add a radar panel centered on ego
- add a rotating radar beam and beam-gated detections
- add seeded noisy radar measurements
- add one Kalman track per debris object
- add a simulated vision classifier based on object size and observation quality
- display estimated class and confidence independently from track state
- update root documentation to explain architecture and assumptions

### Out of Scope

- second-order debris dynamics
- ego state estimation
- true onboard camera rendering
- CNN training
- multi-sensor fusion
- advanced multi-hypothesis data association

## Functional Definition

### Truth Layer

The truth world remains the source of real object state:

- ego truth state
- debris truth state
- object physical size
- object true category

The truth view can continue to use colors because it is an analyst-facing visualization, not the sensor input.

### Radar Sensor Layer

The radar is modeled in an ego-centered relative frame with:

- `max_range`
- `scan_rate_deg_s`
- `beam_width_deg`
- `range_noise_std`
- `bearing_noise_std_deg`
- `seed`

A detection occurs only when:

- the object is within max range
- the object lies inside the instantaneous beam sector

Each detection yields:

- timestamp
- measured range
- measured bearing

### Tracking Layer

Each debris object owns one Kalman track in V2.

Track state:

- `x`
- `vx`
- `y`
- `vy`

Tracking behavior:

- predict every frame
- update only when a radar detection is available
- keep track age and time since last update
- surface uncertainty through covariance-derived display cues

### Classification Layer

Classification is intentionally separate from Kalman tracking.

Inputs:

- object physical size
- current object distance
- observation quality derived from distance
- seeded classification noise

Outputs:

- estimated class
- confidence
- observation quality label

The design goal is to communicate that tracking answers "where is it moving?" while classification answers "what do I think it is?"

## UI

### Truth View

The main canvas continues to show:

- world truth state
- ego and debris motion
- trails
- mission interaction feedback

### Radar View

The radar panel shows:

- ego at the center
- radar range rings
- rotating beam
- detection blips
- estimated tracks
- uncertainty cue

### Console / Lists

Track readouts should expose:

- track id
- range
- bearing
- estimated class
- confidence
- track age
- update freshness

## Configuration Additions

Each object should gain:

- `true_category`
- `physical_size`

Each scenario should gain:

- `radar`
- `classification`

Example object fields:

```json
{
  "name": "DEB-A",
  "object_class": "dangerous_debris",
  "true_category": "hazard_debris",
  "physical_size": 1.4,
  "radius": 10.0,
  "position": [250.0, 160.0],
  "velocity": [42.0, 18.0]
}
```

## Assumptions

- 2D sandbox, not orbital mechanics
- constant-velocity truth dynamics in V2
- ego truth known exactly
- radar is the only explicit sensor in V2
- classification is simulated and documented as such
- colors are only for human-readable truth visualization

## Success Criteria

V2 is successful when:

- the radar beam visibly gates detections
- estimated tracks persist between sensor updates
- class confidence drops intuitively as distance grows
- the architecture clearly separates truth, sensing, estimation, and classification
- the documentation explains the technical rationale honestly and clearly

## Planned Deliverables

- scenario schema extension
- radar and classification config
- radar panel in the web app
- per-object Kalman tracking
- simulated classification confidence logic
- updated `README.md`, `CONTEXT.md`, `TARGET_ROLE.md`, and `TODO.md`
