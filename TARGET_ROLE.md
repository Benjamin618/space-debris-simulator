# Target Role Alignment

This repository is intended to demonstrate fit for an Astroscale AIV Engineer - Computer Vision & GNC position.

## Skills To Reflect

- CV algorithm validation mindset
- GNC validation mindset
- test planning and scenario design
- reproducibility and traceability
- simulation architecture
- data interpretation and uncertainty awareness
- clear technical documentation

## What The Repository Should Signal

A reviewer should quickly see:

- the project is more than a visual toy
- sensing and truth are intentionally separated
- estimation and classification are not conflated
- the author understands uncertainty and revisit-driven tracking
- the codebase is structured for incremental validation work

## Why V2 Matters For This Role

The V2 radar tracking sandbox maps well to the target role because it shows:

- `CV mindset`
  classification confidence degrades with observation quality
- `GNC mindset`
  relative state tracking is updated from noisy measurements rather than ground truth
- `AIV / validation mindset`
  the scenario is configurable, seeded, and architected as a chain of truth -> sensing -> estimation -> interpretation

The Python core strengthens that story further because the sensing, tracking, and classification logic is now visible in a backend-style engineering form rather than only in the browser demo.

## Honest Limits

V2 does not claim:

- orbital mechanics fidelity
- full flight software realism
- trained onboard vision models
- operational navigation readiness

Instead, it demonstrates a credible engineering sandbox and the right validation instincts.
