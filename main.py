from __future__ import annotations

import asyncio


async def async_main() -> int:
    import sys
    from pathlib import Path
    from src.sim.scenario import build_world
    from src.utils.config import load_scenario_config
    from src.viz.renderer import SimulationApp

    if sys.platform == "emscripten":
        config_path = Path("config/scenario_default.json")
        max_frames = None
    else:
        import argparse

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
        config_path = args.config
        max_frames = args.max_frames

    scenario_config = load_scenario_config(config_path)
    world = build_world(scenario_config)
    app = SimulationApp(config=scenario_config, world=world)
    return await app.run(max_frames=max_frames)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(async_main()))
