from __future__ import annotations

import csv
from dataclasses import asdict
from datetime import datetime
import json
import math
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
        self._detection_index = 0
        self._object_detection_counts: dict[str, int] = {}

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
                "detection_index",
                "object_detection_index",
                "object_name",
                "true_category",
                "measured_range",
                "measured_bearing_deg",
                "measured_x",
                "measured_y",
                "truth_world_x",
                "truth_world_y",
                "truth_world_vx",
                "truth_world_vy",
                "truth_abs_speed",
                "truth_rel_x",
                "truth_rel_y",
                "truth_rel_vx",
                "truth_rel_vy",
                "truth_range",
                "truth_bearing_deg",
                "truth_ax",
                "truth_ay",
                "max_acceleration",
                "angular_rate",
                "second_order_coefficient",
                "turn_sign",
                "phase_x",
                "phase_y",
                "estimated_category",
                "confidence",
                "track_status",
                "est_x",
                "est_y",
                "est_vx",
                "est_vy",
                "sigma_x",
                "sigma_y",
                "position_error",
                "velocity_error",
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
        object_lookup = {obj.name: obj for obj in world.objects}
        track_lookup = {track.object_name: track for track in world.tracks}
        for detection in world.recent_detections:
            self._detection_index += 1
            self._object_detection_counts[detection.object_name] = (
                self._object_detection_counts.get(detection.object_name, 0) + 1
            )
            obj = object_lookup[detection.object_name]
            track = track_lookup.get(detection.object_name)
            truth_rel_x, truth_rel_y = relative_position(
                reference_x=world.ego.x,
                reference_y=world.ego.y,
                target_x=obj.x,
                target_y=obj.y,
                world_width=world.width,
                world_height=world.height,
            )
            truth_rel_vx = obj.vx - world.ego.vx
            truth_rel_vy = obj.vy - world.ego.vy
            truth_range = math.hypot(truth_rel_x, truth_rel_y)
            truth_bearing_deg = 0.0
            if truth_range > 0.0:
                truth_bearing_deg = math.degrees(math.atan2(truth_rel_y, truth_rel_x))
                truth_bearing_deg %= 360.0
            truth_ax, truth_ay = obj.current_acceleration()
            position_error = 0.0
            velocity_error = 0.0
            track_status = ""
            est_x = est_y = est_vx = est_vy = sigma_x = sigma_y = 0.0
            if track is not None:
                position_error = ((truth_rel_x - track.x) ** 2 + (truth_rel_y - track.y) ** 2) ** 0.5
                velocity_error = ((truth_rel_vx - track.vx) ** 2 + (truth_rel_vy - track.vy) ** 2) ** 0.5
                track_status = track.track_status
                est_x = track.x
                est_y = track.y
                est_vx = track.vx
                est_vy = track.vy
                sigma_x = track.sigma_x
                sigma_y = track.sigma_y
            self._detections_writer.writerow(
                {
                    "time": f"{world.sim_time:.6f}",
                    "detection_index": self._detection_index,
                    "object_detection_index": self._object_detection_counts[detection.object_name],
                    "object_name": detection.object_name,
                    "true_category": obj.true_category,
                    "measured_range": f"{detection.measured_range:.6f}",
                    "measured_bearing_deg": f"{detection.measured_bearing_deg:.6f}",
                    "measured_x": f"{detection.measured_x:.6f}",
                    "measured_y": f"{detection.measured_y:.6f}",
                    "truth_world_x": f"{obj.x:.6f}",
                    "truth_world_y": f"{obj.y:.6f}",
                    "truth_world_vx": f"{obj.vx:.6f}",
                    "truth_world_vy": f"{obj.vy:.6f}",
                    "truth_abs_speed": f"{obj.speed:.6f}",
                    "truth_rel_x": f"{truth_rel_x:.6f}",
                    "truth_rel_y": f"{truth_rel_y:.6f}",
                    "truth_rel_vx": f"{truth_rel_vx:.6f}",
                    "truth_rel_vy": f"{truth_rel_vy:.6f}",
                    "truth_range": f"{truth_range:.6f}",
                    "truth_bearing_deg": f"{truth_bearing_deg:.6f}",
                    "truth_ax": f"{truth_ax:.6f}",
                    "truth_ay": f"{truth_ay:.6f}",
                    "max_acceleration": f"{obj.max_acceleration:.6f}",
                    "angular_rate": f"{obj.angular_rate:.6f}",
                    "second_order_coefficient": f"{obj.second_order_coefficient:.6f}",
                    "turn_sign": f"{obj.turn_sign:.1f}",
                    "phase_x": f"{obj.phase_x:.6f}",
                    "phase_y": f"{obj.phase_y:.6f}",
                    "estimated_category": detection.classification.estimated_category,
                    "confidence": f"{detection.classification.confidence:.6f}",
                    "track_status": track_status,
                    "est_x": f"{est_x:.6f}",
                    "est_y": f"{est_y:.6f}",
                    "est_vx": f"{est_vx:.6f}",
                    "est_vy": f"{est_vy:.6f}",
                    "sigma_x": f"{sigma_x:.6f}",
                    "sigma_y": f"{sigma_y:.6f}",
                    "position_error": f"{position_error:.6f}",
                    "velocity_error": f"{velocity_error:.6f}",
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
