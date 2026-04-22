from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import datetime
import json
import math
from pathlib import Path
import random
from statistics import median
from typing import Any, Iterable

from src.eval.telemetry import TelemetryRecorder
from src.sim.scenario import build_world
from src.utils.config import ScenarioConfig, parse_scenario_config


@dataclass(slots=True)
class BatchRunResult:
    base_scenario: str
    variant_name: str
    coefficient: float
    scan_rate_deg_s: float
    seed: int
    duration_s: float
    frames: int
    run_dir: Path
    generated_config_path: Path
    summary: dict[str, object]


DETECTION_INDEX_BUCKETS: tuple[tuple[str, int | None, int | None], ...] = (
    ("1", 1, 1),
    ("2-3", 2, 3),
    ("4-6", 4, 6),
    ("7+", 7, None),
)

RANGE_BUCKETS: tuple[tuple[str, float, float | None], ...] = (
    ("0-150", 0.0, 150.0),
    ("150-250", 150.0, 250.0),
    ("250-350", 250.0, 350.0),
    ("350+", 350.0, None),
)

INIT_SKIP_DETECTIONS = 5
TRUTH_PATH_SAMPLE_SECONDS = 0.25


def run_headless_scenario(
    *,
    config: ScenarioConfig,
    scenario_name: str,
    output_root: Path,
    duration_s: float,
    config_path: Path | None = None,
) -> tuple[Path, dict[str, object]]:
    world = build_world(config)
    recorder = TelemetryRecorder(
        output_root=output_root,
        scenario_name=scenario_name,
        config=config,
        config_path=config_path,
    )
    world.telemetry_recorder = recorder

    dt = 1.0 / max(1, config.window.fps)
    frame_count = max(1, int(round(duration_s * config.window.fps)))
    for _ in range(frame_count):
        world.update(dt)

    run_dir = recorder.finalize(world)
    summary_path = run_dir / "run_summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    return run_dir, summary


def build_variant_config(
    raw_config: dict[str, object],
    *,
    coefficient: float,
    scan_rate_deg_s: float | None = None,
    seed: int | None = None,
) -> dict[str, object]:
    coefficient = max(0.0, min(1.0, coefficient))
    config_copy = json.loads(json.dumps(raw_config))
    truth_dynamics = config_copy.setdefault("truth_dynamics", {})
    truth_dynamics["default_coefficient_range"] = [coefficient, coefficient]
    if scan_rate_deg_s is not None:
        config_copy.setdefault("radar", {})["scan_rate_deg_s"] = float(scan_rate_deg_s)
    if seed is not None:
        config_copy.setdefault("world", {})["seed"] = int(seed)
        config_copy.setdefault("radar", {})["seed"] = int(seed) + 101
        truth_dynamics["coefficient_seed"] = int(seed) + 202
        _randomize_object_positions(config_copy, seed=int(seed))

    for obj in config_copy.get("objects", []):
        obj["second_order_coefficient"] = coefficient

    return config_copy


def _randomize_object_positions(config_copy: dict[str, object], *, seed: int) -> None:
    objects = config_copy.get("objects", [])
    if not isinstance(objects, list) or not objects:
        return

    ego_position = config_copy.get("ego", {}).get("position", [0.0, 0.0])
    ego_x = float(ego_position[0])
    ego_y = float(ego_position[1])
    world = config_copy.get("world", {})
    world_width = float(world.get("width", 1600.0))
    world_height = float(world.get("height", 900.0))
    rng = random.Random(seed + 303)
    placed: list[tuple[float, float]] = []

    category_ranges = {
        "dangerous_debris": (250.0, 335.0),
        "collectable_debris": (180.0, 290.0),
        "neutral_object": (130.0, 230.0),
    }

    for obj in objects:
        object_class = str(obj.get("object_class", "neutral_object"))
        min_radius, max_radius = category_ranges.get(object_class, (160.0, 300.0))

        candidate_x = float(obj.get("position", [ego_x, ego_y])[0])
        candidate_y = float(obj.get("position", [ego_x, ego_y])[1])
        for _ in range(32):
            angle = rng.uniform(0.0, 2.0 * 3.141592653589793)
            radius = rng.uniform(min_radius, max_radius)
            candidate_x = (ego_x + radius * math.cos(angle)) % world_width
            candidate_y = (ego_y + radius * math.sin(angle)) % world_height
            if all(math.hypot(candidate_x - px, candidate_y - py) >= 110.0 for px, py in placed):
                break

        obj["position"] = [round(candidate_x, 3), round(candidate_y, 3)]
        placed.append((candidate_x, candidate_y))


def run_batch_analysis(
    *,
    config_paths: list[Path],
    coefficients: list[float],
    scan_rates_deg_s: list[float] | None,
    seeds: list[int] | None,
    duration_s: float | None,
    radar_turns: float,
    output_root: Path,
) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    analysis_dir = output_root / f"{timestamp}_v3_batch_analysis"
    runs_dir = analysis_dir / "runs"
    configs_dir = analysis_dir / "generated_configs"
    analysis_dir.mkdir(parents=True, exist_ok=True)
    runs_dir.mkdir(parents=True, exist_ok=True)
    configs_dir.mkdir(parents=True, exist_ok=True)

    results: list[BatchRunResult] = []
    for config_path in config_paths:
        raw_config = json.loads(config_path.read_text(encoding="utf-8"))
        base_name = config_path.stem
        fps = int(raw_config["window"]["fps"])
        base_scan_rate_deg_s = float(raw_config.get("radar", {}).get("scan_rate_deg_s", 40.8))
        effective_scan_rates = scan_rates_deg_s or [base_scan_rate_deg_s]
        effective_seeds = seeds or [int(raw_config.get("world", {}).get("seed", 1))]
        slowest_scan_rate_deg_s = min(effective_scan_rates)
        shared_duration_s = duration_s
        if shared_duration_s is None:
            shared_duration_s = (360.0 / slowest_scan_rate_deg_s) * radar_turns

        for scan_rate_deg_s in effective_scan_rates:
            effective_duration_s = shared_duration_s
            frame_count = max(1, int(round(effective_duration_s * fps)))

            for seed in effective_seeds:
                for coefficient in coefficients:
                    variant_raw = build_variant_config(
                        raw_config,
                        coefficient=coefficient,
                        scan_rate_deg_s=scan_rate_deg_s,
                        seed=seed,
                    )
                    variant_name = (
                        f"{base_name}_coef_{coefficient:0.2f}_scan_{scan_rate_deg_s:0.1f}_seed_{seed}"
                    ).replace(".", "_")
                    variant_config_path = configs_dir / f"{variant_name}.json"
                    variant_config_path.write_text(json.dumps(variant_raw, indent=2), encoding="utf-8")

                    config = parse_scenario_config(variant_raw)
                    run_dir, summary = run_headless_scenario(
                        config=config,
                        scenario_name=variant_name,
                        output_root=runs_dir,
                        duration_s=effective_duration_s,
                        config_path=variant_config_path,
                    )
                    results.append(
                        BatchRunResult(
                            base_scenario=base_name,
                            variant_name=variant_name,
                            coefficient=coefficient,
                            scan_rate_deg_s=scan_rate_deg_s,
                            seed=seed,
                            duration_s=effective_duration_s,
                            frames=frame_count,
                            run_dir=run_dir,
                            generated_config_path=variant_config_path,
                            summary=summary,
                        )
                    )

    _write_batch_summary(analysis_dir / "batch_summary.csv", results)
    _write_object_summary(analysis_dir / "object_summary.csv", results)
    _write_detections_merged(analysis_dir / "detections_merged.csv", results)
    _write_comparison_json(analysis_dir / "comparison.json", results)
    _write_analysis_report(analysis_dir / "analysis_report.md", results)
    _write_analysis_v1_bundle(analysis_dir / "analysis_v1", results)

    return analysis_dir


def _write_batch_summary(path: Path, results: list[BatchRunResult]) -> None:
    fieldnames = [
        "base_scenario",
        "variant_name",
        "coefficient",
        "scan_rate_deg_s",
        "seed",
        "duration_s",
        "frames",
        "max_acceleration",
        "angular_rate",
        "tracked_object_count",
        "total_samples",
        "total_detections",
        "mean_position_rmse",
        "mean_velocity_rmse",
        "max_position_rmse",
        "max_velocity_rmse",
        "run_dir",
        "generated_config_path",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for result in results:
            metrics = result.summary["metrics"]
            truth_dynamics = result.summary["truth_dynamics"]
            writer.writerow(
                {
                    "base_scenario": result.base_scenario,
                    "variant_name": result.variant_name,
                    "coefficient": f"{result.coefficient:.2f}",
                    "scan_rate_deg_s": f"{result.scan_rate_deg_s:.2f}",
                    "seed": result.seed,
                    "duration_s": f"{result.duration_s:.2f}",
                    "frames": result.frames,
                    "max_acceleration": truth_dynamics["max_acceleration"],
                    "angular_rate": truth_dynamics["angular_rate"],
                    "tracked_object_count": metrics["tracked_object_count"],
                    "total_samples": metrics["total_samples"],
                    "total_detections": metrics["total_detections"],
                    "mean_position_rmse": f"{metrics['mean_position_rmse']:.6f}",
                    "mean_velocity_rmse": f"{metrics['mean_velocity_rmse']:.6f}",
                    "max_position_rmse": f"{metrics['max_position_rmse']:.6f}",
                    "max_velocity_rmse": f"{metrics['max_velocity_rmse']:.6f}",
                    "run_dir": str(result.run_dir),
                    "generated_config_path": str(result.generated_config_path),
                }
            )


def _write_object_summary(path: Path, results: list[BatchRunResult]) -> None:
    fieldnames = [
        "base_scenario",
        "variant_name",
        "coefficient",
        "scan_rate_deg_s",
        "seed",
        "object_name",
        "samples",
        "detection_count",
        "position_rmse",
        "velocity_rmse",
        "mean_position_error",
        "mean_velocity_error",
        "max_position_error",
        "mean_time_since_update",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for result in results:
            per_object = result.summary["metrics"]["per_object"]
            for object_name, metrics in sorted(per_object.items()):
                writer.writerow(
                    {
                        "base_scenario": result.base_scenario,
                        "variant_name": result.variant_name,
                        "coefficient": f"{result.coefficient:.2f}",
                        "scan_rate_deg_s": f"{result.scan_rate_deg_s:.2f}",
                        "seed": result.seed,
                        "object_name": object_name,
                        "samples": metrics["samples"],
                        "detection_count": metrics["detection_count"],
                        "position_rmse": f"{metrics['position_rmse']:.6f}",
                        "velocity_rmse": f"{metrics['velocity_rmse']:.6f}",
                        "mean_position_error": f"{metrics['mean_position_error']:.6f}",
                        "mean_velocity_error": f"{metrics['mean_velocity_error']:.6f}",
                        "max_position_error": f"{metrics['max_position_error']:.6f}",
                        "mean_time_since_update": f"{metrics['mean_time_since_update']:.6f}",
                    }
                )


def _write_detections_merged(path: Path, results: list[BatchRunResult]) -> None:
    fieldnames: list[str] | None = None
    merged_rows: list[dict[str, object]] = []

    for result in results:
        detection_path = result.run_dir / "detections.csv"
        with detection_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            if fieldnames is None:
                fieldnames = [
                    "base_scenario",
                    "variant_name",
                    "coefficient",
                    "scan_rate_deg_s",
                    "seed",
                    "duration_s",
                    "frames",
                    *reader.fieldnames,
                ]
            for row in reader:
                merged_rows.append(
                    {
                        "base_scenario": result.base_scenario,
                        "variant_name": result.variant_name,
                        "coefficient": f"{result.coefficient:.2f}",
                        "scan_rate_deg_s": f"{result.scan_rate_deg_s:.2f}",
                        "seed": result.seed,
                        "duration_s": f"{result.duration_s:.2f}",
                        "frames": result.frames,
                        **row,
                    }
                )

    if fieldnames is None:
        fieldnames = [
            "base_scenario",
            "variant_name",
            "coefficient",
            "scan_rate_deg_s",
            "seed",
            "duration_s",
            "frames",
        ]

    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(merged_rows)


def _write_comparison_json(path: Path, results: list[BatchRunResult]) -> None:
    grouped: dict[str, list[dict[str, object]]] = {}
    for result in results:
        grouped.setdefault(result.base_scenario, []).append(
            {
                "variant_name": result.variant_name,
                "coefficient": result.coefficient,
                "scan_rate_deg_s": result.scan_rate_deg_s,
                "seed": result.seed,
                "run_dir": str(result.run_dir),
                "generated_config_path": str(result.generated_config_path),
                "summary": result.summary,
            }
        )
    for items in grouped.values():
        items.sort(key=lambda item: (float(item["coefficient"]), float(item["scan_rate_deg_s"]), int(item["seed"])))
    path.write_text(json.dumps(grouped, indent=2), encoding="utf-8")


def _write_analysis_report(path: Path, results: list[BatchRunResult]) -> None:
    grouped: dict[str, list[BatchRunResult]] = {}
    for result in results:
        grouped.setdefault(result.base_scenario, []).append(result)

    lines: list[str] = [
        "# V3 Batch Analysis",
        "",
        "This report compares constant-velocity Kalman tracking performance across multiple bounded second-order truth-dynamics levels.",
        "",
    ]

    for base_scenario, scenario_results in sorted(grouped.items()):
        scenario_results.sort(key=lambda item: (item.coefficient, item.scan_rate_deg_s, item.seed))
        lines.append(f"## {base_scenario}")
        lines.append("")
        lines.append("| Coefficient | Scan rate | Seed | Mean position RMSE | Mean velocity RMSE | Total detections | Tracked objects |")
        lines.append("| --- | ---: | ---: | ---: | ---: | ---: | ---: |")
        for result in scenario_results:
            metrics = result.summary["metrics"]
            lines.append(
                "| "
                f"{result.coefficient:.2f} | "
                f"{result.scan_rate_deg_s:.1f} | "
                f"{result.seed:d} | "
                f"{metrics['mean_position_rmse']:.3f} | "
                f"{metrics['mean_velocity_rmse']:.3f} | "
                f"{metrics['total_detections']} | "
                f"{metrics['tracked_object_count']} |"
            )
        lines.append("")

        baseline = next((item for item in scenario_results if abs(item.coefficient - 0.0) < 1e-9), None)
        if baseline is not None:
            baseline_rmse = float(baseline.summary["metrics"]["mean_position_rmse"])
            lines.append("### Position RMSE relative to baseline")
            lines.append("")
            for result in scenario_results:
                current_rmse = float(result.summary["metrics"]["mean_position_rmse"])
                if baseline_rmse > 0:
                    ratio = current_rmse / baseline_rmse
                    lines.append(
                        f"- `coef={result.coefficient:.2f}`, `scan={result.scan_rate_deg_s:.1f} deg/s`, `seed={result.seed}` -> position RMSE `{current_rmse:.3f}` "
                        f"({ratio:.2f}x baseline)"
                    )
                else:
                    lines.append(
                        f"- `coef={result.coefficient:.2f}`, `scan={result.scan_rate_deg_s:.1f} deg/s`, `seed={result.seed}` -> position RMSE `{current_rmse:.3f}`"
                    )
            lines.append("")

        best = min(scenario_results, key=lambda item: float(item.summary["metrics"]["mean_position_rmse"]))
        worst = max(scenario_results, key=lambda item: float(item.summary["metrics"]["mean_position_rmse"]))
        lines.append("### Key observation")
        lines.append("")
        lines.append(
            f"- Lowest mean position RMSE: `coef={best.coefficient:.2f}`, `scan={best.scan_rate_deg_s:.1f}`, `seed={best.seed}` -> "
            f"`{float(best.summary['metrics']['mean_position_rmse']):.3f}`"
        )
        lines.append(
            f"- Highest mean position RMSE: `coef={worst.coefficient:.2f}`, `scan={worst.scan_rate_deg_s:.1f}`, `seed={worst.seed}` -> "
            f"`{float(worst.summary['metrics']['mean_position_rmse']):.3f}`"
        )
        lines.append("")

    lines.extend(
        [
            "## Outputs",
            "",
            "- `batch_summary.csv`: scenario-level metrics ready for plots",
            "- `object_summary.csv`: per-object metrics for deeper analysis",
            "- `detections_merged.csv`: all detection-level records merged into one analysis table",
            "- `comparison.json`: structured data for future web analysis pages",
            "- `runs/`: raw telemetry exports for each generated run",
            "",
        ]
    )

    path.write_text("\n".join(lines), encoding="utf-8")


def _write_analysis_v1_bundle(path: Path, results: list[BatchRunResult]) -> None:
    path.mkdir(parents=True, exist_ok=True)

    overview = _build_analysis_overview(results)
    runs = _build_run_rows(results)
    objects = _build_object_rows(results)
    detection_index = _build_detection_index_trend_rows(results)
    range_rows = _build_range_trend_rows(results)
    coefficient_rows = _build_coefficient_trend_rows(results)
    object_trajectories = _build_object_trajectories(results)

    manifest = {
        "version": "1.0",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "post_update_rmse_after_init_skip": INIT_SKIP_DETECTIONS,
        "truth_path_sample_seconds": TRUTH_PATH_SAMPLE_SECONDS,
        "questions": [
            "Does tracking improve after several radar detections?",
            "Does tracking degrade as truth-dynamics non-linearity increases?",
            "How does target range affect position and velocity errors?",
        ],
        "filters": {
            "base_scenarios": sorted({result.base_scenario for result in results}),
            "coefficients": sorted({round(result.coefficient, 6) for result in results}),
            "scan_rates_deg_s": sorted({round(result.scan_rate_deg_s, 6) for result in results}),
            "seeds": sorted({int(result.seed) for result in results}),
            "object_names": sorted({row["object_name"] for row in objects}),
            "true_categories": sorted({row["true_category"] for row in objects}),
        },
        "files": {
            "overview": "overview.json",
            "runs": "runs.json",
            "objects": "objects.json",
            "trend_detection_index": "trend_detection_index.json",
            "trend_range": "trend_range.json",
            "trend_coefficient": "trend_coefficient.json",
            "object_trajectories": "object_trajectories.json",
        },
    }

    _write_json(path / "manifest.json", manifest)
    _write_json(path / "overview.json", overview)
    _write_json(path / "runs.json", runs)
    _write_json(path / "objects.json", objects)
    _write_json(path / "trend_detection_index.json", detection_index)
    _write_json(path / "trend_range.json", range_rows)
    _write_json(path / "trend_coefficient.json", coefficient_rows)
    _write_json(path / "object_trajectories.json", object_trajectories)


def _build_analysis_overview(results: list[BatchRunResult]) -> dict[str, Any]:
    total_detections = sum(int(result.summary["metrics"]["total_detections"]) for result in results)
    total_samples = sum(int(result.summary["metrics"]["total_samples"]) for result in results)
    mean_position_rmse = _mean(
        float(result.summary["metrics"]["mean_position_rmse"]) for result in results
    )
    mean_velocity_rmse = _mean(
        float(result.summary["metrics"]["mean_velocity_rmse"]) for result in results
    )
    post_update_run_rows = _build_run_rows(results)
    mean_post_update_position_rmse = _mean(
        float(row["post_update_position_rmse"]) for row in post_update_run_rows
    )
    mean_post_update_velocity_rmse = _mean(
        float(row["post_update_velocity_rmse"]) for row in post_update_run_rows
    )
    mean_post_update_position_rmse_after_init = _mean(
        float(row["post_update_position_rmse_after_init"]) for row in post_update_run_rows
    )
    mean_post_update_velocity_rmse_after_init = _mean(
        float(row["post_update_velocity_rmse_after_init"]) for row in post_update_run_rows
    )
    durations = [float(result.duration_s) for result in results]
    return {
        "summary_cards": [
            {"key": "runs_compared", "label": "Runs Compared", "value": len(results), "unit": "runs"},
            {
                "key": "total_detections",
                "label": "Total Detections",
                "value": total_detections,
                "unit": "detections",
            },
            {
                "key": "mean_post_update_position_rmse",
                "label": "Post-update Position RMSE",
                "value": _round(mean_post_update_position_rmse),
                "unit": "m",
            },
            {
                "key": "mean_post_update_velocity_rmse",
                "label": "Post-update Velocity RMSE",
                "value": _round(mean_post_update_velocity_rmse),
                "unit": "m/s",
            },
            {
                "key": "mean_post_update_position_rmse_after_init",
                "label": f"Position RMSE ({INIT_SKIP_DETECTIONS}+)",
                "value": _round(mean_post_update_position_rmse_after_init),
                "unit": "m",
            },
            {
                "key": "mean_post_update_velocity_rmse_after_init",
                "label": f"Velocity RMSE ({INIT_SKIP_DETECTIONS}+)",
                "value": _round(mean_post_update_velocity_rmse_after_init),
                "unit": "m/s",
            },
        ],
        "experiment": {
            "base_scenarios": sorted({result.base_scenario for result in results}),
            "coefficients": sorted({round(result.coefficient, 6) for result in results}),
            "scan_rates_deg_s": sorted({round(result.scan_rate_deg_s, 6) for result in results}),
            "seeds": sorted({int(result.seed) for result in results}),
            "durations_s": sorted({round(duration, 6) for duration in durations}),
            "total_detections": total_detections,
            "total_samples": total_samples,
            "tracking_mean_position_rmse": _round(mean_position_rmse),
            "tracking_mean_velocity_rmse": _round(mean_velocity_rmse),
            "post_update_rmse_after_init_skip": INIT_SKIP_DETECTIONS,
        },
        "notes": [
            "Summary cards prioritize post-update metrics computed only at radar detection instants, where estimates are compared at a consistent measurement-update stage.",
            "Truth dynamics use bounded second-order motion while the Kalman tracker remains first-order constant velocity.",
            "Range buckets are expressed in ego-centric radar distance, not world-frame distance.",
        ],
    }


def _build_run_rows(results: list[BatchRunResult]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for result in sorted(results, key=lambda item: (item.base_scenario, item.coefficient, item.scan_rate_deg_s, item.seed)):
        metrics = result.summary["metrics"]
        truth_dynamics = result.summary["truth_dynamics"]
        detection_stats = _build_detection_stats_for_run(result)
        rows.append(
            {
                "base_scenario": result.base_scenario,
                "variant_name": result.variant_name,
                "coefficient": _round(result.coefficient),
                "scan_rate_deg_s": _round(result.scan_rate_deg_s),
                "seed": int(result.seed),
                "duration_s": _round(result.duration_s),
                "frames": result.frames,
                "max_acceleration": _round(float(truth_dynamics["max_acceleration"])),
                "angular_rate": _round(float(truth_dynamics["angular_rate"])),
                "tracked_object_count": int(metrics["tracked_object_count"]),
                "total_samples": int(metrics["total_samples"]),
                "total_detections": int(metrics["total_detections"]),
                "tracking_mean_position_rmse": _round(float(metrics["mean_position_rmse"])),
                "tracking_mean_velocity_rmse": _round(float(metrics["mean_velocity_rmse"])),
                "max_position_rmse": _round(float(metrics["max_position_rmse"])),
                "max_velocity_rmse": _round(float(metrics["max_velocity_rmse"])),
                "post_update_samples": int(detection_stats["samples"]),
                "post_update_position_rmse": _round(detection_stats["position_rmse"]),
                "post_update_velocity_rmse": _round(detection_stats["velocity_rmse"]),
                "post_update_mean_position_error": _round(detection_stats["mean_position_error"]),
                "post_update_mean_velocity_error": _round(detection_stats["mean_velocity_error"]),
                "post_update_median_position_error": _round(detection_stats["median_position_error"]),
                "post_update_median_velocity_error": _round(detection_stats["median_velocity_error"]),
                "post_update_samples_after_init": int(detection_stats["samples_after_init"]),
                "post_update_position_rmse_after_init": _round(detection_stats["position_rmse_after_init"]),
                "post_update_velocity_rmse_after_init": _round(detection_stats["velocity_rmse_after_init"]),
                "run_dir": str(result.run_dir),
                "generated_config_path": str(result.generated_config_path),
            }
        )
    return rows


def _build_object_rows(results: list[BatchRunResult]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for result in sorted(results, key=lambda item: (item.base_scenario, item.coefficient, item.scan_rate_deg_s, item.seed)):
        object_meta = {
            entry["name"]: entry for entry in result.summary.get("objects", [])
        }
        per_object = result.summary["metrics"]["per_object"]
        per_object_detection_stats = _build_detection_stats_by_object(result)
        for object_name, metrics in sorted(per_object.items()):
            meta = object_meta.get(object_name, {})
            detection_stats = per_object_detection_stats.get(object_name, _empty_detection_stats())
            rows.append(
                {
                    "base_scenario": result.base_scenario,
                    "variant_name": result.variant_name,
                    "coefficient": _round(result.coefficient),
                    "scan_rate_deg_s": _round(result.scan_rate_deg_s),
                    "seed": int(result.seed),
                    "object_name": object_name,
                    "true_category": meta.get("true_category", ""),
                    "second_order_coefficient": _round(
                        float(meta.get("second_order_coefficient", result.coefficient))
                    ),
                    "samples": int(metrics["samples"]),
                    "detection_count": int(metrics["detection_count"]),
                    "tracking_position_rmse": _round(float(metrics["position_rmse"])),
                    "tracking_velocity_rmse": _round(float(metrics["velocity_rmse"])),
                    "tracking_mean_position_error": _round(float(metrics["mean_position_error"])),
                    "tracking_mean_velocity_error": _round(float(metrics["mean_velocity_error"])),
                    "max_position_error": _round(float(metrics["max_position_error"])),
                    "mean_time_since_update": _round(float(metrics["mean_time_since_update"])),
                    "post_update_samples": int(detection_stats["samples"]),
                    "post_update_position_rmse": _round(detection_stats["position_rmse"]),
                    "post_update_velocity_rmse": _round(detection_stats["velocity_rmse"]),
                    "post_update_mean_position_error": _round(detection_stats["mean_position_error"]),
                    "post_update_mean_velocity_error": _round(detection_stats["mean_velocity_error"]),
                    "post_update_median_position_error": _round(detection_stats["median_position_error"]),
                    "post_update_median_velocity_error": _round(detection_stats["median_velocity_error"]),
                    "post_update_samples_after_init": int(detection_stats["samples_after_init"]),
                    "post_update_position_rmse_after_init": _round(detection_stats["position_rmse_after_init"]),
                    "post_update_velocity_rmse_after_init": _round(detection_stats["velocity_rmse_after_init"]),
                }
            )
    return rows


def _build_detection_index_trend_rows(results: list[BatchRunResult]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, float, float, int, str], dict[str, Any]] = {}
    for result, row in _iter_detection_rows(results):
        bucket_label = _bucket_detection_index(int(row["object_detection_index"]))
        key = (result.base_scenario, result.coefficient, result.scan_rate_deg_s, result.seed, bucket_label)
        group = groups.setdefault(
            key,
            {
                "base_scenario": result.base_scenario,
                "coefficient": result.coefficient,
                "scan_rate_deg_s": result.scan_rate_deg_s,
                "seed": result.seed,
                "bucket_label": bucket_label,
                "sample_count": 0,
                "position_errors": [],
                "velocity_errors": [],
                "truth_ranges": [],
            },
        )
        group["sample_count"] += 1
        group["position_errors"].append(float(row["position_error"]))
        group["velocity_errors"].append(float(row["velocity_error"]))
        group["truth_ranges"].append(float(row["truth_range"]))
    return _finalize_detection_trend_rows(groups.values())


def _build_range_trend_rows(results: list[BatchRunResult]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, float, float, int, str], dict[str, Any]] = {}
    for result, row in _iter_detection_rows(results):
        bucket_label = _bucket_range(float(row["truth_range"]))
        key = (result.base_scenario, result.coefficient, result.scan_rate_deg_s, result.seed, bucket_label)
        group = groups.setdefault(
            key,
            {
                "base_scenario": result.base_scenario,
                "coefficient": result.coefficient,
                "scan_rate_deg_s": result.scan_rate_deg_s,
                "seed": result.seed,
                "bucket_label": bucket_label,
                "sample_count": 0,
                "position_errors": [],
                "velocity_errors": [],
                "detection_indices": [],
                "truth_ranges": [],
            },
        )
        group["sample_count"] += 1
        group["position_errors"].append(float(row["position_error"]))
        group["velocity_errors"].append(float(row["velocity_error"]))
        group["detection_indices"].append(float(row["object_detection_index"]))
        group["truth_ranges"].append(float(row["truth_range"]))

    rows: list[dict[str, Any]] = []
    for group in sorted(
        groups.values(),
        key=lambda item: (item["base_scenario"], item["coefficient"], item["scan_rate_deg_s"], item["seed"], _range_bucket_index(item["bucket_label"]))):
        rows.append(
            {
                "base_scenario": group["base_scenario"],
                "coefficient": _round(float(group["coefficient"])),
                "scan_rate_deg_s": _round(float(group["scan_rate_deg_s"])),
                "seed": int(group["seed"]),
                "bucket_label": group["bucket_label"],
                "sample_count": int(group["sample_count"]),
                "mean_position_error": _round(_mean(group["position_errors"])),
                "median_position_error": _round(median(group["position_errors"])),
                "mean_velocity_error": _round(_mean(group["velocity_errors"])),
                "median_velocity_error": _round(median(group["velocity_errors"])),
                "mean_detection_index": _round(_mean(group["detection_indices"])),
                "mean_truth_range": _round(_mean(group["truth_ranges"])),
            }
        )
    return rows


def _build_coefficient_trend_rows(results: list[BatchRunResult]) -> list[dict[str, Any]]:
    detection_groups: dict[tuple[str, float, float, int], dict[str, Any]] = {}
    for result, row in _iter_detection_rows(results):
        key = (result.base_scenario, result.coefficient, result.scan_rate_deg_s, result.seed)
        group = detection_groups.setdefault(
            key,
            {
                "position_errors": [],
                "velocity_errors": [],
                "position_errors_after_init": [],
                "velocity_errors_after_init": [],
                "truth_ranges": [],
            },
        )
        group["position_errors"].append(float(row["position_error"]))
        group["velocity_errors"].append(float(row["velocity_error"]))
        if int(row["object_detection_index"]) > INIT_SKIP_DETECTIONS:
            group["position_errors_after_init"].append(float(row["position_error"]))
            group["velocity_errors_after_init"].append(float(row["velocity_error"]))
        group["truth_ranges"].append(float(row["truth_range"]))

    rows: list[dict[str, Any]] = []
    for result in sorted(results, key=lambda item: (item.base_scenario, item.coefficient, item.scan_rate_deg_s, item.seed)):
        metrics = result.summary["metrics"]
        detection_group = detection_groups.get((result.base_scenario, result.coefficient, result.scan_rate_deg_s, result.seed), {})
        rows.append(
            {
                "base_scenario": result.base_scenario,
                "variant_name": result.variant_name,
                "coefficient": _round(result.coefficient),
                "scan_rate_deg_s": _round(result.scan_rate_deg_s),
                "seed": int(result.seed),
                "max_acceleration": _round(float(result.summary["truth_dynamics"]["max_acceleration"])),
                "angular_rate": _round(float(result.summary["truth_dynamics"]["angular_rate"])),
                "tracked_object_count": int(metrics["tracked_object_count"]),
                "total_detections": int(metrics["total_detections"]),
                "tracking_mean_position_rmse": _round(float(metrics["mean_position_rmse"])),
                "tracking_mean_velocity_rmse": _round(float(metrics["mean_velocity_rmse"])),
                "post_update_position_rmse": _round(_rmse_from_errors(detection_group.get("position_errors", []))),
                "post_update_velocity_rmse": _round(_rmse_from_errors(detection_group.get("velocity_errors", []))),
                "post_update_position_rmse_after_init": _round(
                    _rmse_from_errors(detection_group.get("position_errors_after_init", []))
                ),
                "post_update_velocity_rmse_after_init": _round(
                    _rmse_from_errors(detection_group.get("velocity_errors_after_init", []))
                ),
                "mean_position_error": _round(_mean(detection_group.get("position_errors", []))),
                "mean_velocity_error": _round(_mean(detection_group.get("velocity_errors", []))),
                "median_position_error": _round(_median_or_zero(detection_group.get("position_errors", []))),
                "median_velocity_error": _round(_median_or_zero(detection_group.get("velocity_errors", []))),
                "mean_truth_range": _round(_mean(detection_group.get("truth_ranges", []))),
            }
        )
    return rows


def _build_object_trajectories(results: list[BatchRunResult]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for result in sorted(results, key=lambda item: (item.base_scenario, item.coefficient, item.scan_rate_deg_s, item.seed)):
        truth_by_object: dict[str, list[dict[str, float]]] = {}
        truth_path = result.run_dir / "truth.csv"
        with truth_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                truth_by_object.setdefault(row["object_name"], []).append(
                    {
                        "time": _round(float(row["time"])),
                        "x": _round(float(row["truth_rel_x"])),
                        "y": _round(float(row["truth_rel_y"])),
                        "vx": _round(float(row["truth_rel_vx"])),
                        "vy": _round(float(row["truth_rel_vy"])),
                    }
                )
        for object_name, truth_points in list(truth_by_object.items()):
            truth_by_object[object_name] = _downsample_truth_path(truth_points)

        detections_by_object: dict[str, dict[str, list[dict[str, float]]]] = {}
        detection_path = result.run_dir / "detections.csv"
        with detection_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                object_name = row["object_name"]
                bucket = detections_by_object.setdefault(
                    object_name,
                    {"measured": [], "estimated": [], "meta": []},
                )
                bucket["measured"].append(
                    {
                        "time": _round(float(row["time"])),
                        "index": int(row["object_detection_index"]),
                        "x": _round(float(row["measured_x"])),
                        "y": _round(float(row["measured_y"])),
                    }
                )
                bucket["estimated"].append(
                    {
                        "time": _round(float(row["time"])),
                        "index": int(row["object_detection_index"]),
                        "x": _round(float(row["est_x"])),
                        "y": _round(float(row["est_y"])),
                    }
                )
                bucket["meta"].append(
                    {
                        "time": _round(float(row["time"])),
                        "index": int(row["object_detection_index"]),
                        "truth_x": _round(float(row["truth_rel_x"])),
                        "truth_y": _round(float(row["truth_rel_y"])),
                        "range": _round(float(row["truth_range"])),
                        "position_error": _round(float(row["position_error"])),
                        "velocity_error": _round(float(row["velocity_error"])),
                    }
                )

        objects_meta = {entry["name"]: entry for entry in result.summary.get("objects", [])}
        object_rows = [row for row in _build_object_rows([result])]
        object_metrics = {row["object_name"]: row for row in object_rows}

        for object_name, truth_points in sorted(truth_by_object.items()):
            detection_bundle = detections_by_object.get(
                object_name,
                {"measured": [], "estimated": [], "meta": []},
            )
            metrics = object_metrics.get(object_name, {})
            meta = objects_meta.get(object_name, {})
            rows.append(
                {
                    "base_scenario": result.base_scenario,
                    "variant_name": result.variant_name,
                    "coefficient": _round(result.coefficient),
                    "scan_rate_deg_s": _round(result.scan_rate_deg_s),
                    "seed": int(result.seed),
                    "object_name": object_name,
                    "true_category": meta.get("true_category", ""),
                    "second_order_coefficient": _round(
                        float(meta.get("second_order_coefficient", result.coefficient))
                    ),
                    "truth_path": truth_points,
                    "measured_points": detection_bundle["measured"],
                    "estimated_path": detection_bundle["estimated"],
                    "detection_meta": detection_bundle["meta"],
                    "post_update_position_rmse": metrics.get("post_update_position_rmse", 0.0),
                    "post_update_velocity_rmse": metrics.get("post_update_velocity_rmse", 0.0),
                    "post_update_position_rmse_after_init": metrics.get("post_update_position_rmse_after_init", 0.0),
                    "post_update_velocity_rmse_after_init": metrics.get("post_update_velocity_rmse_after_init", 0.0),
                    "detection_count": metrics.get("detection_count", len(detection_bundle["measured"])),
                }
            )
    return rows


def _finalize_detection_trend_rows(groups: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for group in sorted(
        groups,
        key=lambda item: (
            item["base_scenario"],
            item["coefficient"],
            item["scan_rate_deg_s"],
            item["seed"],
            _detection_bucket_index(item["bucket_label"]),
        ),
    ):
        rows.append(
            {
                "base_scenario": group["base_scenario"],
                "coefficient": _round(float(group["coefficient"])),
                "scan_rate_deg_s": _round(float(group["scan_rate_deg_s"])),
                "seed": int(group["seed"]),
                "bucket_label": group["bucket_label"],
                "sample_count": int(group["sample_count"]),
                "mean_position_error": _round(_mean(group["position_errors"])),
                "median_position_error": _round(median(group["position_errors"])),
                "mean_velocity_error": _round(_mean(group["velocity_errors"])),
                "median_velocity_error": _round(median(group["velocity_errors"])),
                "mean_truth_range": _round(_mean(group["truth_ranges"])),
            }
        )
    return rows


def _iter_detection_rows(results: list[BatchRunResult]) -> Iterable[tuple[BatchRunResult, dict[str, str]]]:
    for result in results:
        detection_path = result.run_dir / "detections.csv"
        with detection_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                yield result, row


def _build_detection_stats_for_run(result: BatchRunResult) -> dict[str, float]:
    position_errors: list[float] = []
    velocity_errors: list[float] = []
    position_errors_after_init: list[float] = []
    velocity_errors_after_init: list[float] = []
    for _, row in _iter_detection_rows([result]):
        position_errors.append(float(row["position_error"]))
        velocity_errors.append(float(row["velocity_error"]))
        if int(row["object_detection_index"]) > INIT_SKIP_DETECTIONS:
            position_errors_after_init.append(float(row["position_error"]))
            velocity_errors_after_init.append(float(row["velocity_error"]))
    return _finalize_detection_stats(
        position_errors,
        velocity_errors,
        position_errors_after_init,
        velocity_errors_after_init,
    )


def _build_detection_stats_by_object(result: BatchRunResult) -> dict[str, dict[str, float]]:
    grouped: dict[str, dict[str, list[float]]] = {}
    for _, row in _iter_detection_rows([result]):
        entry = grouped.setdefault(
            row["object_name"],
            {
                "position_errors": [],
                "velocity_errors": [],
                "position_errors_after_init": [],
                "velocity_errors_after_init": [],
            },
        )
        entry["position_errors"].append(float(row["position_error"]))
        entry["velocity_errors"].append(float(row["velocity_error"]))
        if int(row["object_detection_index"]) > INIT_SKIP_DETECTIONS:
            entry["position_errors_after_init"].append(float(row["position_error"]))
            entry["velocity_errors_after_init"].append(float(row["velocity_error"]))

    return {
        object_name: _finalize_detection_stats(
            values["position_errors"],
            values["velocity_errors"],
            values["position_errors_after_init"],
            values["velocity_errors_after_init"],
        )
        for object_name, values in grouped.items()
    }


def _finalize_detection_stats(
    position_errors: list[float],
    velocity_errors: list[float],
    position_errors_after_init: list[float],
    velocity_errors_after_init: list[float],
) -> dict[str, float]:
    if not position_errors or not velocity_errors:
        return _empty_detection_stats()
    return {
        "samples": len(position_errors),
        "position_rmse": _rmse_from_errors(position_errors),
        "velocity_rmse": _rmse_from_errors(velocity_errors),
        "mean_position_error": _mean(position_errors),
        "mean_velocity_error": _mean(velocity_errors),
        "median_position_error": _median_or_zero(position_errors),
        "median_velocity_error": _median_or_zero(velocity_errors),
        "samples_after_init": len(position_errors_after_init),
        "position_rmse_after_init": _rmse_from_errors(position_errors_after_init),
        "velocity_rmse_after_init": _rmse_from_errors(velocity_errors_after_init),
    }


def _empty_detection_stats() -> dict[str, float]:
    return {
        "samples": 0,
        "position_rmse": 0.0,
        "velocity_rmse": 0.0,
        "mean_position_error": 0.0,
        "mean_velocity_error": 0.0,
        "median_position_error": 0.0,
        "median_velocity_error": 0.0,
        "samples_after_init": 0,
        "position_rmse_after_init": 0.0,
        "velocity_rmse_after_init": 0.0,
    }


def _bucket_detection_index(index: int) -> str:
    for label, start, end in DETECTION_INDEX_BUCKETS:
        if start is None:
            continue
        if end is None and index >= start:
            return label
        if end is not None and start <= index <= end:
            return label
    return DETECTION_INDEX_BUCKETS[-1][0]


def _bucket_range(distance: float) -> str:
    for label, lower, upper in RANGE_BUCKETS:
        if upper is None and distance >= lower:
            return label
        if lower <= distance < upper:
            return label
    return RANGE_BUCKETS[-1][0]


def _detection_bucket_index(label: str) -> int:
    for index, (bucket_label, _, _) in enumerate(DETECTION_INDEX_BUCKETS):
        if bucket_label == label:
            return index
    return len(DETECTION_INDEX_BUCKETS)


def _range_bucket_index(label: str) -> int:
    for index, (bucket_label, _, _) in enumerate(RANGE_BUCKETS):
        if bucket_label == label:
            return index
    return len(RANGE_BUCKETS)


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _downsample_truth_path(points: list[dict[str, float]]) -> list[dict[str, float]]:
    if len(points) <= 2:
        return points

    sampled: list[dict[str, float]] = [points[0]]
    last_kept_time = float(points[0]["time"])

    for point in points[1:-1]:
        point_time = float(point["time"])
        if point_time - last_kept_time >= TRUTH_PATH_SAMPLE_SECONDS:
            sampled.append(point)
            last_kept_time = point_time

    if sampled[-1] is not points[-1]:
        sampled.append(points[-1])
    return sampled


def _mean(values: Iterable[float]) -> float:
    values_list = list(values)
    if not values_list:
        return 0.0
    return sum(values_list) / len(values_list)


def _median_or_zero(values: Iterable[float]) -> float:
    values_list = list(values)
    if not values_list:
        return 0.0
    return float(median(values_list))


def _rmse_from_errors(values: Iterable[float]) -> float:
    values_list = list(values)
    if not values_list:
        return 0.0
    return (_mean(value * value for value in values_list)) ** 0.5


def _round(value: float, digits: int = 6) -> float:
    return round(float(value), digits)
