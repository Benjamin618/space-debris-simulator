from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
import sys

from src.sim.scenario import build_world
from src.utils.config import load_scenario_config
from src.viz.renderer import SimulationApp


async def async_main() -> int:
    if sys.platform == "emscripten":
        args = argparse.Namespace(
            config=Path("config/scenario_default.json"),
            max_frames=None,
        )
    else:
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
        args = parser.parse_args()

    scenario_config = load_scenario_config(args.config)
    world = build_world(scenario_config)
    app = SimulationApp(config=scenario_config, world=world)
    return await app.run(max_frames=args.max_frames)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(async_main()))
