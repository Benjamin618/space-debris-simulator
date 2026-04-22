from __future__ import annotations

import argparse
from pathlib import Path

from src.eval import run_batch_analysis


def _parse_coefficients(raw: str) -> list[float]:
    values = []
    for chunk in raw.split(","):
        text = chunk.strip()
        if not text:
            continue
        values.append(float(text))
    if not values:
        raise ValueError("At least one coefficient must be provided.")
    return values


def _parse_float_list(raw: str) -> list[float]:
    values = []
    for chunk in raw.split(","):
        text = chunk.strip()
        if not text:
            continue
        values.append(float(text))
    if not values:
        raise ValueError("At least one float value must be provided.")
    return values


def _parse_int_list(raw: str) -> list[int]:
    values = []
    for chunk in raw.split(","):
        text = chunk.strip()
        if not text:
            continue
        values.append(int(text))
    if not values:
        raise ValueError("At least one integer seed must be provided.")
    return values


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run V3 batch analysis over multiple scenario/coefficient combinations.",
    )
    parser.add_argument(
        "--config",
        type=Path,
        action="append",
        default=None,
        help="Scenario config to include in the batch. Can be provided multiple times.",
    )
    parser.add_argument(
        "--coefficients",
        type=str,
        default="0.0,0.25,0.5,0.75",
        help="Comma-separated second-order coefficient sweep.",
    )
    parser.add_argument(
        "--scan-rates",
        type=str,
        default=None,
        help="Optional comma-separated radar scan-rate sweep in deg/s.",
    )
    parser.add_argument(
        "--seeds",
        type=str,
        default=None,
        help="Optional comma-separated seed sweep applied to world/radar/dynamics generation.",
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=None,
        help="Optional run duration in seconds for each generated scenario. If omitted, duration is derived from --radar-turns.",
    )
    parser.add_argument(
        "--radar-turns",
        type=float,
        default=10.0,
        help="Target number of radar rotations per run when --duration is not provided.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("outputs/analysis"),
        help="Directory where batch analysis outputs will be created.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config_paths = args.config or [Path("config/scenario_default.json")]
    coefficients = _parse_coefficients(args.coefficients)
    scan_rates = _parse_float_list(args.scan_rates) if args.scan_rates else None
    seeds = _parse_int_list(args.seeds) if args.seeds else None
    analysis_dir = run_batch_analysis(
        config_paths=config_paths,
        coefficients=coefficients,
        scan_rates_deg_s=scan_rates,
        seeds=seeds,
        duration_s=args.duration,
        radar_turns=args.radar_turns,
        output_root=args.output_dir,
    )
    print(f"Batch analysis written to: {analysis_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
