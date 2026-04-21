# Analysis V1 Data Contract

## Objective

Define the precomputed files that the future `Analysis` page will consume.

The goal is to avoid parsing heavy CSV files in the web client.
The batch pipeline should produce compact JSON views that already match the page structure.

Output folder:

- `outputs/analysis/<timestamp>_v3_batch_analysis/analysis_v1/`

## File Set

Analysis V1 consumes the following files:

1. `manifest.json`
2. `overview.json`
3. `runs.json`
4. `objects.json`
5. `trend_detection_index.json`
6. `trend_range.json`
7. `trend_coefficient.json`
8. `object_trajectories.json`

## 1. manifest.json

Purpose:

- declare the bundle version
- expose available filters
- list the files that belong to the bundle
- restate the analysis questions

Expected shape:

```json
{
  "version": "1.0",
  "generated_at": "2026-04-21T10:15:00",
  "truth_path_sample_seconds": 0.25,
  "questions": [
    "Does tracking improve after several radar detections?",
    "Does tracking degrade as truth-dynamics non-linearity increases?",
    "How does target range affect position and velocity errors?"
  ],
  "filters": {
    "base_scenarios": ["scenario_analysis_minimal"],
    "coefficients": [0.0, 0.7],
    "object_names": ["COL-A", "DEB-A", "NEU-A"],
    "true_categories": ["hazard_debris", "neutral_debris", "target_debris"]
  },
  "files": {
    "overview": "overview.json",
    "runs": "runs.json",
    "objects": "objects.json",
    "trend_detection_index": "trend_detection_index.json",
    "trend_range": "trend_range.json",
    "trend_coefficient": "trend_coefficient.json",
    "object_trajectories": "object_trajectories.json"
  }
}
```

## 2. overview.json

Purpose:

- populate summary cards
- restate experiment scope
- provide short notes for the page intro

Expected fields:

- `summary_cards`
- `experiment`
- `notes`

`summary_cards` entries:

- `key`
- `label`
- `value`
- `unit`

## 3. runs.json

Purpose:

- populate the run comparison table

One row per run.

Expected fields:

- `base_scenario`
- `variant_name`
- `coefficient`
- `duration_s`
- `frames`
- `max_acceleration`
- `angular_rate`
- `tracked_object_count`
- `total_samples`
- `total_detections`
- `tracking_mean_position_rmse`
- `tracking_mean_velocity_rmse`
- `max_position_rmse`
- `max_velocity_rmse`
- `post_update_samples`
- `post_update_position_rmse`
- `post_update_velocity_rmse`
- `post_update_mean_position_error`
- `post_update_mean_velocity_error`
- `post_update_median_position_error`
- `post_update_median_velocity_error`
- `run_dir`
- `generated_config_path`

## 4. objects.json

Purpose:

- populate the per-object analysis table

One row per object per run.

Expected fields:

- `base_scenario`
- `variant_name`
- `coefficient`
- `object_name`
- `true_category`
- `second_order_coefficient`
- `samples`
- `detection_count`
- `tracking_position_rmse`
- `tracking_velocity_rmse`
- `tracking_mean_position_error`
- `tracking_mean_velocity_error`
- `max_position_error`
- `mean_time_since_update`
- `post_update_samples`
- `post_update_position_rmse`
- `post_update_velocity_rmse`
- `post_update_mean_position_error`
- `post_update_mean_velocity_error`
- `post_update_median_position_error`
- `post_update_median_velocity_error`

## 5. trend_detection_index.json

Purpose:

- answer whether tracking improves after several detections

Aggregation:

- grouped by `base_scenario`
- grouped by `coefficient`
- grouped by detection index bucket

Detection index buckets:

- `1`
- `2-3`
- `4-6`
- `7+`

Expected fields:

- `base_scenario`
- `coefficient`
- `bucket_label`
- `sample_count`
- `mean_position_error`
- `median_position_error`
- `mean_velocity_error`
- `median_velocity_error`
- `mean_truth_range`

## 6. trend_range.json

Purpose:

- answer how range influences position and velocity errors

Aggregation:

- grouped by `base_scenario`
- grouped by `coefficient`
- grouped by range bucket

Range buckets:

- `0-150`
- `150-250`
- `250-350`
- `350+`

Expected fields:

- `base_scenario`
- `coefficient`
- `bucket_label`
- `sample_count`
- `mean_position_error`
- `median_position_error`
- `mean_velocity_error`
- `median_velocity_error`
- `mean_detection_index`
- `mean_truth_range`

## 7. trend_coefficient.json

Purpose:

- compare runs as non-linearity increases

One row per run/coefficient.

Expected fields:

- `base_scenario`
- `variant_name`
- `coefficient`
- `max_acceleration`
- `angular_rate`
- `tracked_object_count`
- `total_detections`
- `tracking_mean_position_rmse`
- `tracking_mean_velocity_rmse`
- `post_update_position_rmse`
- `post_update_velocity_rmse`
- `mean_position_error`
- `mean_velocity_error`
- `median_position_error`
- `median_velocity_error`
- `mean_truth_range`

## 8. object_trajectories.json

Purpose:

- support a selected-object trajectory panel in the `Analysis` page
- let a user compare truth, radar detections, and post-update estimated positions for one run/object

One row per object per run.

Expected fields:

- `base_scenario`
- `variant_name`
- `coefficient`
- `object_name`
- `true_category`
- `second_order_coefficient`
- `truth_path`
- `measured_points`
- `estimated_path`
- `detection_meta`
- `post_update_position_rmse`
- `post_update_velocity_rmse`
- `detection_count`

Point conventions:

- `truth_path` uses ego-relative truth positions sampled from `truth.csv`
- `measured_points` use detection-time radar measurements in ego-relative coordinates
- `estimated_path` uses post-update estimated positions at detection instants
- `detection_meta` keeps the per-detection range and error context
- `truth_path` is intentionally downsampled for web consumption; it is not a full frame-by-frame export

## Data Conventions

- distances are in the same simulation units used by the sandbox
- `position` metrics refer to ego-relative position
- `velocity` metrics refer to ego-relative velocity
- `tracking_*` metrics come from the run/object summaries and are evaluated on all simulation updates where a track exists
- `post_update_*` metrics are evaluated only at radar detection instants, immediately after the estimate has integrated the measurement
- trend tables are derived from per-detection rows in `detections.csv` and are therefore post-update by construction

## V1 Scope Limits

The contract intentionally does not include:

- full raw trajectories
- every covariance sample
- chart-ready time series per frame
- CV-specific confusion analysis

Those can be added later in V2/V4 of the analysis layer if needed.
