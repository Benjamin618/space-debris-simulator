# Analysis V1 Page Spec

## Objective

Provide a first external-facing analysis page that turns V3 batch outputs into readable validation evidence.

This page is not a live simulation page.
It is the place where a viewer understands what the exported runs say about tracker behavior.

## Role in the App

Recommended navigation order:

1. `Overview`
2. `Concepts`
3. `Live Demo`
4. `Analysis`
5. `Key Findings`

`Analysis` sits between:

- the live sandbox experience
- the final engineering conclusions

## Primary Questions

Analysis V1 should answer three questions:

1. Does tracking improve after several radar detections?
2. Does tracking degrade as truth-dynamics non-linearity increases?
3. How does target range affect position and velocity errors?

These are deliberately limited.
V1 should be structured and readable before it becomes feature-rich.

## Page Structure

### 1. Analysis Overview

Top-level context for the current batch:

- analyzed base scenarios
- coefficients compared
- run count
- total detections
- mean position RMSE
- mean velocity RMSE

This block should also restate the core experiment:

`truth order 2 / Kalman order 1`

### 2. Run Comparison

One row per run.

Fields:

- base scenario
- variant name
- coefficient
- duration
- max acceleration
- angular rate
- tracked object count
- total detections
- post-update position RMSE
- post-update velocity RMSE

The V1 page should prioritize post-update metrics so that compared errors are evaluated at a similar estimator state.

This is the first place where a viewer compares conditions.

### 3. Per-Object Analysis

One row per object per run.

Fields:

- object name
- true category
- coefficient
- detection count
- post-update position RMSE
- post-update velocity RMSE
- post-update mean position error
- post-update mean velocity error
- mean time since update

This section helps show whether some debris are harder to track than others.

### 4. Detection-Level Trends

This is the main evidence block for V1.

It should show:

- error vs detection index bucket
- error vs range bucket
- error vs coefficient

These views are detection-only and therefore naturally aligned with post-measurement estimator updates.

V1 can remain table-first.
Interactive charts can come later.

### 5. Analyst Notes

A short text block explaining:

- what appears plausible
- what is still tentative
- what limits remain in the experiment

This avoids the page looking like a raw metric dump.

## V1 UX Principles

- keep the page sober and engineering-oriented
- prefer summary cards plus tables
- keep filters simple
- avoid too many simultaneous charts
- make bucket labels explicit and human-readable

## Filters Needed in V1

Minimum useful filters:

- base scenario
- coefficient
- object name
- true category

## Data Requirements

Analysis V1 expects precomputed JSON outputs from the batch pipeline, not raw CSV parsing in the browser.

The page should consume:

- `manifest.json`
- `overview.json`
- `runs.json`
- `objects.json`
- `trend_detection_index.json`
- `trend_range.json`
- `trend_coefficient.json`

These files are defined in:

- [analysis_v1_data_contract.md](/C:/Users/benja/DS_projects/space-debris-sandbox/specs/analysis_v1_data_contract.md)

## Success Criteria

Analysis V1 is successful if:

- an external viewer understands that multiple runs were compared
- the three main analysis questions are visible immediately
- the viewer can inspect both run-level and object-level performance
- the page clearly supports later conclusions in `Key Findings`
