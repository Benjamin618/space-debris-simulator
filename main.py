from __future__ import annotations

import argparse
from pathlib import Path

from src.eval import TelemetryRecorder
from src.sim.scenario import build_world
from src.utils.config import load_scenario_config
from src.viz.renderer import SimulationApp


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the space debris sandbox visual simulation.",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("config/scenario_default.json"),
        help="Path to a JSON scenario file.",
    )
    parser.add_argument(
        "--max-frames",
        type=int,
        default=None,
        help="Optional frame budget, useful for quick checks in headless mode.",
    )
    parser.add_argument(
        "--export-run",
        action="store_true",
        help="Export telemetry and metrics for the run under outputs/runs.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("outputs/runs"),
        help="Output root used when --export-run is enabled.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    scenario_config = load_scenario_config(args.config)
    world = build_world(scenario_config)
    recorder = None
    if args.export_run:
        recorder = TelemetryRecorder(
            output_root=args.output_dir,
            scenario_name=args.config.stem,
            config=scenario_config,
            config_path=args.config,
        )
        world.telemetry_recorder = recorder
    app = SimulationApp(config=scenario_config, world=world)
    result = app.run(max_frames=args.max_frames)
    if recorder is not None:
        recorder.finalize(world)
    return result


if __name__ == "__main__":
    raise SystemExit(main())
