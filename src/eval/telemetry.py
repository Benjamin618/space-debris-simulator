from __future__ import annotations

import csv
from dataclasses import asdict
from datetime import datetime
import json
from pathlib import Path
from typing import TYPE_CHECKING, TextIO

from src.sim.geometry import relative_position

if TYPE_CHECKING:
    from src.sim.world import SimulationWorld
    from src.utils.config import ScenarioConfig


class TelemetryRecorder:
    def __init__(
        self,
        *,
        output_root: Path,
        scenario_name: str,
        config: ScenarioConfig,
        config_path: Path | None = None,
    ) -> None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_name = scenario_name.replace(" ", "_")
        self.run_dir = output_root / f"{timestamp}_{safe_name}"
        self.run_dir.mkdir(parents=True, exist_ok=True)

        self._scenario_name = scenario_name
        self._config = config
        self._config_path = str(config_path) if config_path is not None else None
        self._finalized = False

        self._truth_file, self._truth_writer = self._open_csv(
            self.run_dir / "truth.csv",
            [
                "time",
                "object_name",
                "second_order_coefficient",
                "truth_world_x",
                "truth_world_y",
                "truth_world_vx",
                "truth_world_vy",
                "truth_rel_x",
                "truth_rel_y",
                "truth_rel_vx",
                "truth_rel_vy",
            ],
        )
        self._detections_file, self._detections_writer = self._open_csv(
            self.run_dir / "detections.csv",
            [
                "time",
                "object_name",
                "measured_range",
                "measured_bearing_deg",
                "measured_x",
                "measured_y",
                "estimated_category",
                "confidence",
            ],
        )
        self._tracks_file, self._tracks_writer = self._open_csv(
            self.run_dir / "tracks.csv",
            [
                "time",
                "object_name",
                "track_status",
                "est_x",
                "est_y",
                "est_vx",
                "est_vy",
                "sigma_x",
                "sigma_y",
                "time_since_update",
                "last_range",
                "last_bearing_deg",
            ],
        )

    @staticmethod
    def _open_csv(path: Path, fieldnames: list[str]) -> tuple[TextIO, csv.DictWriter]:
        file_handle = path.open("w", encoding="utf-8", newline="")
        writer = csv.DictWriter(file_handle, fieldnames=fieldnames)
        writer.writeheader()
        return file_handle, writer

    def record_step(self, world: SimulationWorld) -> None:
        self._write_truth(world)
        self._write_detections(world)
        self._write_tracks(world)
        self._flush_files()

    def _write_truth(self, world: SimulationWorld) -> None:
        for obj in world.objects:
            truth_rel_x, truth_rel_y = relative_position(
                reference_x=world.ego.x,
                reference_y=world.ego.y,
                target_x=obj.x,
                target_y=obj.y,
                world_width=world.width,
                world_height=world.height,
            )
            self._truth_writer.writerow(
                {
                    "time": f"{world.sim_time:.6f}",
                    "object_name": obj.name,
                    "second_order_coefficient": f"{obj.second_order_coefficient:.6f}",
                    "truth_world_x": f"{obj.x:.6f}",
                    "truth_world_y": f"{obj.y:.6f}",
                    "truth_world_vx": f"{obj.vx:.6f}",
                    "truth_world_vy": f"{obj.vy:.6f}",
                    "truth_rel_x": f"{truth_rel_x:.6f}",
                    "truth_rel_y": f"{truth_rel_y:.6f}",
                    "truth_rel_vx": f"{(obj.vx - world.ego.vx):.6f}",
                    "truth_rel_vy": f"{(obj.vy - world.ego.vy):.6f}",
                }
            )

    def _write_detections(self, world: SimulationWorld) -> None:
        for detection in world.recent_detections:
            self._detections_writer.writerow(
                {
                    "time": f"{world.sim_time:.6f}",
                    "object_name": detection.object_name,
                    "measured_range": f"{detection.measured_range:.6f}",
                    "measured_bearing_deg": f"{detection.measured_bearing_deg:.6f}",
                    "measured_x": f"{detection.measured_x:.6f}",
                    "measured_y": f"{detection.measured_y:.6f}",
                    "estimated_category": detection.classification.estimated_category,
                    "confidence": f"{detection.classification.confidence:.6f}",
                }
            )

    def _write_tracks(self, world: SimulationWorld) -> None:
        for track in world.tracks:
            self._tracks_writer.writerow(
                {
                    "time": f"{world.sim_time:.6f}",
                    "object_name": track.object_name,
                    "track_status": track.track_status,
                    "est_x": f"{track.x:.6f}",
                    "est_y": f"{track.y:.6f}",
                    "est_vx": f"{track.vx:.6f}",
                    "est_vy": f"{track.vy:.6f}",
                    "sigma_x": f"{track.sigma_x:.6f}",
                    "sigma_y": f"{track.sigma_y:.6f}",
                    "time_since_update": f"{track.time_since_update:.6f}",
                    "last_range": f"{track.last_range:.6f}",
                    "last_bearing_deg": f"{track.last_bearing_deg:.6f}",
                }
            )

    def _flush_files(self) -> None:
        self._truth_file.flush()
        self._detections_file.flush()
        self._tracks_file.flush()

    def finalize(self, world: SimulationWorld) -> Path:
        if self._finalized:
            return self.run_dir

        summary = {
            "scenario_name": self._scenario_name,
            "window_title": self._config.window.title,
            "config_path": self._config_path,
            "world": {
                "width": world.width,
                "height": world.height,
                "sim_time": world.sim_time,
            },
            "radar": asdict(self._config.radar),
            "tracking": asdict(self._config.tracking),
            "classification": asdict(self._config.classification),
            "truth_dynamics": asdict(self._config.truth_dynamics),
            "objects": [
                {
                    "name": obj.name,
                    "true_category": obj.true_category,
                    "second_order_coefficient": obj.second_order_coefficient,
                }
                for obj in world.objects
            ],
            "metrics": world.metrics_summary,
        }

        summary_path = self.run_dir / "run_summary.json"
        summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

        self._truth_file.close()
        self._detections_file.close()
        self._tracks_file.close()
        self._finalized = True
        return self.run_dir
