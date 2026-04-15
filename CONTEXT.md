# Project Context

## Project

Repository: `space-debris-simulator`

This project is a portfolio artifact intended to demonstrate fit for an Astroscale AIV Engineer - Computer Vision & GNC role.

## Core Goal

Build a technically credible simulation sandbox that showcases:

- relative motion thinking
- sensing and estimation structure
- validation-oriented engineering
- reproducibility
- clear documentation of assumptions and limits

## Evolution So Far

### V1 baseline

- local animation of an ego satellite and debris
- truth scene visible at all times
- desktop and web visual demos

### V2 direction

The project now moves beyond omniscient animation by separating:

- truth-world state
- radar sensing
- noisy measurements
- Kalman tracking
- classification confidence

This structure now exists in two forms:

- a web demo for visual communication
- a Python core for readable engineering logic

This shift is important because the target role is closer to algorithm validation and test design than to visualization alone.

## Portfolio Positioning

The repository should communicate:

- structured engineering judgment
- explicit perception and tracking assumptions
- measurable, explainable behavior
- extensibility toward more advanced CV/GNC validation work

## Current V2 Message

The web sandbox is now intended to show:

- a truth view for analyst interpretation
- an ego-centric radar view for sensed and estimated state
- beam-gated radar detections with noise
- one track per debris object using a Kalman model
- vision-style classification kept separate from the tracker

## Constraints

- keep the project portfolio-friendly
- preserve working demos while improving realism
- favor clarity and modularity over overbuilding
- document simplifications honestly instead of hiding them

## Known Simplifications In V2

- 2D sandbox
- constant-velocity debris motion
- perfect ego truth state
- simulated classification rather than trained ML
- no orbital dynamics yet
- no multi-sensor fusion yet

## Why These Simplifications Are Acceptable

They keep the project understandable while still demonstrating the architectural separation that matters for AIV validation work:

- what is true
- what is measured
- what is estimated
- what is inferred

## Resume Point After V2

Likely next steps after stabilizing V2:

- telemetry export and regression-style metrics
- richer motion models
- camera-like synthetic observations
- more advanced track management
