from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import datetime
import json
from pathlib import Path

from src.eval.telemetry import TelemetryRecorder
from src.sim.scenario import build_world
from src.utils.config import ScenarioConfig, parse_scenario_config


@dataclass(slots=True)
class BatchRunResult:
    base_scenario: str
    variant_name: str
    coefficient: float
    duration_s: float
    frames: int
    run_dir: Path
    generated_config_path: Path
    summary: dict[str, object]


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


def build_uniform_coefficient_config(
    raw_config: dict[str, object],
    *,
    coefficient: float,
) -> dict[str, object]:
    coefficient = max(0.0, min(1.0, coefficient))
    config_copy = json.loads(json.dumps(raw_config))
    truth_dynamics = config_copy.setdefault("truth_dynamics", {})
    truth_dynamics["default_coefficient_range"] = [coefficient, coefficient]

    for obj in config_copy.get("objects", []):
        obj["second_order_coefficient"] = coefficient

    return config_copy


def run_batch_analysis(
    *,
    config_paths: list[Path],
    coefficients: list[float],
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
        scan_rate_deg_s = float(raw_config.get("radar", {}).get("scan_rate_deg_s", 40.8))
        effective_duration_s = duration_s
        if effective_duration_s is None:
            effective_duration_s = (360.0 / scan_rate_deg_s) * radar_turns
        fps = int(raw_config["window"]["fps"])
        frame_count = max(1, int(round(effective_duration_s * fps)))

        for coefficient in coefficients:
            variant_raw = build_uniform_coefficient_config(raw_config, coefficient=coefficient)
            variant_name = f"{base_name}_coef_{coefficient:0.2f}".replace(".", "_")
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

    return analysis_dir


def _write_batch_summary(path: Path, results: list[BatchRunResult]) -> None:
    fieldnames = [
        "base_scenario",
        "variant_name",
        "coefficient",
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
                        "duration_s": f"{result.duration_s:.2f}",
                        "frames": result.frames,
                        **row,
                    }
                )

    if fieldnames is None:
        fieldnames = ["base_scenario", "variant_name", "coefficient", "duration_s", "frames"]

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
                "run_dir": str(result.run_dir),
                "generated_config_path": str(result.generated_config_path),
                "summary": result.summary,
            }
        )
    for items in grouped.values():
        items.sort(key=lambda item: float(item["coefficient"]))
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
        scenario_results.sort(key=lambda item: item.coefficient)
        lines.append(f"## {base_scenario}")
        lines.append("")
        lines.append("| Coefficient | Mean position RMSE | Mean velocity RMSE | Total detections | Tracked objects |")
        lines.append("| --- | ---: | ---: | ---: | ---: |")
        for result in scenario_results:
            metrics = result.summary["metrics"]
            lines.append(
                "| "
                f"{result.coefficient:.2f} | "
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
                        f"- `coef={result.coefficient:.2f}` -> position RMSE `{current_rmse:.3f}` "
                        f"({ratio:.2f}x baseline)"
                    )
                else:
                    lines.append(
                        f"- `coef={result.coefficient:.2f}` -> position RMSE `{current_rmse:.3f}`"
                    )
            lines.append("")

        best = min(scenario_results, key=lambda item: float(item.summary["metrics"]["mean_position_rmse"]))
        worst = max(scenario_results, key=lambda item: float(item.summary["metrics"]["mean_position_rmse"]))
        lines.append("### Key observation")
        lines.append("")
        lines.append(
            f"- Lowest mean position RMSE: `{best.coefficient:.2f}` -> "
            f"`{float(best.summary['metrics']['mean_position_rmse']):.3f}`"
        )
        lines.append(
            f"- Highest mean position RMSE: `{worst.coefficient:.2f}` -> "
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
