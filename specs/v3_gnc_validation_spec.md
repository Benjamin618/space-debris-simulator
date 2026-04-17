# V3 GNC Validation Spec

## Objective

Evolve the project from a visible perception-and-tracking sandbox into a technically credible GNC validation sandbox.

V3 keeps the existing radar and Kalman structure, but intentionally introduces a controlled mismatch:

- truth dynamics become bounded second-order motion
- the Kalman estimator remains first-order constant velocity
- telemetry is exported for offline analysis
- tracking performance is quantified with RMSE-style metrics

The core question for V3 is:

"How does a first-order tracker degrade when the real target dynamics become second-order?"

## Why This Matters

This release is aimed at the Astroscale AIV Engineer - CV & GNC target role by emphasizing:

- GNC validation mindset: model mismatch, estimator limits, quantitative evaluation
- reproducibility: scenario-driven runs with explicit coefficients
- engineering quality: separated truth, sensing, estimation, and evaluation layers
- testability: exported telemetry and deterministic scenario comparison

V3 is intentionally GNC-first.
Classification remains present, but it is not the primary development axis of this release.

## Scope

### In Scope

- keep the current Python and web V2 behavior as the baseline
- add bounded second-order truth dynamics for all debris objects
- keep the Kalman model unchanged at first-order constant velocity
- add telemetry export per run
- compute tracking metrics from truth vs estimate
- compare performance as the second-order coefficient increases
- optionally add simple track lifecycle status
- update documentation to explain the validation intent

### Out of Scope

- redesign of the classifier
- CNN or learned CV models
- camera simulation overhaul
- multi-sensor fusion
- orbital mechanics realism
- advanced data association
- ego state estimation uncertainty

## Functional Definition

### Truth Dynamics Layer

All non-ego debris follow bounded second-order motion.

The goal is not high-fidelity orbital motion.
The goal is to create a controlled and explainable mismatch relative to the tracker model.

Recommended form:

```text
ax = max_acceleration * second_order_coefficient * sin(omega * t + phi_x)
ay = max_acceleration * second_order_coefficient * cos(omega * t + phi_y)
```

State propagation:

- `vx += ax * dt`
- `vy += ay * dt`
- `x += vx * dt`
- `y += vy * dt`

Design constraints:

- acceleration remains bounded
- motion stays smooth and readable
- each object gets its own phase offsets

### Estimation Layer

The Kalman estimator remains unchanged in structure.

Track state:

- `x`
- `vx`
- `y`
- `vy`

Tracking behavior:

- predict each frame
- update only when radar detections are available
- keep uncertainty and update freshness

This is deliberate:
V3 is valuable precisely because truth is order 2 while estimation still assumes order 1.

### Radar Layer

Radar sensing remains the same as V2:

- beam-gated detections
- `range` and `bearing`
- seeded noise
- rotating ego-centric scan

This keeps the experiment clean.
The main variable of interest is truth dynamics mismatch, not a simultaneous sensor redesign.

### Evaluation Layer

V3 adds a formal evaluation layer to compare:

- truth position vs estimated position
- truth velocity vs estimated velocity
- detection availability vs track freshness

The most important output is not the animation itself, but the ability to quantify estimator performance over a complete run.

## Scenario Parameters

Each scenario gains a new block:

```json
"truth_dynamics": {
  "model": "second_order_bounded",
  "second_order_coefficient": 0.25,
  "max_acceleration": 2.0,
  "angular_rate": 0.35
}
```

Rules:

- `second_order_coefficient` is bounded in `[0.0, 1.0]`
- `max_acceleration` limits the motion amplitude
- `angular_rate` controls how quickly the acceleration vector evolves

Recommended reference scenarios:

- `coef = 0.00`
- `coef = 0.25`
- `coef = 0.50`
- `coef = 0.75`

These runs should keep radar and tracking settings fixed so performance changes can be attributed to truth-model mismatch.

## Telemetry Export

V3 should export run artifacts under a deterministic output folder, for example:

- `outputs/runs/<timestamp>_<scenario>/`

Recommended files:

### `truth.csv`

Fields:

- `time`
- `object_name`
- `truth_x`
- `truth_y`
- `truth_vx`
- `truth_vy`
- `second_order_coefficient`

### `detections.csv`

Fields:

- `time`
- `object_name`
- `measured_range`
- `measured_bearing_deg`
- `measured_x`
- `measured_y`
- `estimated_category`
- `confidence`

### `tracks.csv`

Fields:

- `time`
- `object_name`
- `track_status`
- `est_x`
- `est_y`
- `est_vx`
- `est_vy`
- `sigma_x`
- `sigma_y`
- `time_since_update`
- `last_range`
- `last_bearing_deg`

### `run_summary.json`

Contents:

- scenario name
- radar parameters
- tracking parameters
- truth dynamics parameters
- object-level metrics
- global metrics

## Metrics

V3 should compute the following at minimum.

### Instantaneous Errors

- `position_error = sqrt((truth_x - est_x)^2 + (truth_y - est_y)^2)`
- `velocity_error = sqrt((truth_vx - est_vx)^2 + (truth_vy - est_vy)^2)`

### Per-Object Metrics

- `position_rmse`
- `velocity_rmse`
- `mean_position_error`
- `max_position_error`
- `mean_time_since_update`
- `detection_count`

### Global Metrics

- `mean_position_rmse`
- `mean_velocity_rmse`
- `max_position_rmse`
- `max_velocity_rmse`
- `total_detections`
- `confirmed_track_count` if track lifecycle is enabled

Primary engineering conclusion expected from V3:

- low RMSE when `second_order_coefficient = 0`
- increasing RMSE as `second_order_coefficient` increases

## Track Lifecycle

Track lifecycle is optional but recommended in V3.

Suggested states:

- `tentative`
- `confirmed`
- `stale`
- `dropped`

Suggested rules:

- become `confirmed` after `N` detections
- become `stale` after a freshness timeout
- become `dropped` after a longer timeout

This is not the main V3 objective, but it improves the credibility of exported telemetry and status displays.

## UI Impact

The live demo should only receive light updates.

Recommended additions:

- show the active `second_order_coefficient`
- optionally show track lifecycle state
- optionally show current or final RMSE summary

V3 is not a UI-heavy release.
Its main deliverables are telemetry and quantitative analysis.

## Implementation Plan

### 1. Config Schema

Modify:

- `config/scenario_default.json`
- `config/scenario_custom.json`
- `src/utils/config.py`

Tasks:

- add `truth_dynamics` config parsing
- validate and clamp `second_order_coefficient`
- keep backward compatibility with V2 scenarios

### 2. Truth Dynamics

Modify:

- `src/sim/entities.py`
- `src/sim/world.py`
- `src/sim/scenario.py`

Tasks:

- add per-object phase terms for bounded second-order motion
- keep ego behavior simple
- propagate debris with smooth acceleration
- expose the active truth dynamics parameters in the world model

### 3. Tracking Status

Modify:

- `src/sim/tracking.py`

Tasks:

- add `track_status`
- add detection counters
- expose `sigma_x` and `sigma_y`
- optionally add confirmation and stale logic

### 4. Telemetry Export

Create:

- `src/eval/__init__.py`
- `src/eval/telemetry.py`

Tasks:

- create run output folder
- write `truth.csv`
- write `detections.csv`
- write `tracks.csv`
- finalize `run_summary.json`

### 5. Metrics Computation

Create:

- `src/eval/metrics.py`

Tasks:

- compute instantaneous truth-vs-estimate errors
- aggregate per-object RMSE
- aggregate global RMSE
- provide a clean summary structure for JSON export and UI display

### 6. Live Demo Hooks

Modify:

- `src/viz/renderer.py`

Tasks:

- display the active second-order coefficient
- optionally show track lifecycle state
- optionally display a compact metrics summary

### 7. Documentation

Modify:

- `README.md`
- `CONTEXT.md`
- `TARGET_ROLE.md`
- `TODO.md`

Tasks:

- explain why V3 is GNC-first
- explain the truth order 2 / tracker order 1 mismatch
- explain how exported telemetry supports validation
- explain what conclusions the user should draw from the run summary

## Acceptance Criteria

V3 is successful when:

- a run can be executed with `second_order_coefficient = 0.0`
- a run can be executed with non-zero second-order coefficients
- telemetry files are written successfully
- per-object and global RMSE are computed without ambiguity
- RMSE increases in a readable way as the coefficient increases
- the live app remains usable and visually coherent
- the documentation explains the engineering rationale clearly

## Deliverables

- bounded second-order truth dynamics
- unchanged first-order Kalman tracking
- telemetry export layer
- metrics computation layer
- multi-coefficient scenarios
- updated desktop display for V3 context
- updated docs

## Expected Portfolio Message

V3 should support the following honest conclusion:

"This release evaluates how a constant-velocity relative-motion tracker degrades when the real target motion becomes second-order, and quantifies that degradation through exported telemetry and RMSE-based metrics."
