from __future__ import annotations

from dataclasses import dataclass
import math

from src.sim.geometry import relative_position


@dataclass(slots=True)
class ObjectMetricAccumulator:
    samples: int = 0
    detection_count: int = 0
    position_error_sq_sum: float = 0.0
    velocity_error_sq_sum: float = 0.0
    position_error_sum: float = 0.0
    velocity_error_sum: float = 0.0
    max_position_error: float = 0.0
    time_since_update_sum: float = 0.0


class MetricsAccumulator:
    def __init__(self) -> None:
        self._objects: dict[str, ObjectMetricAccumulator] = {}

    def record_detections(self, detections: list[object]) -> None:
        for detection in detections:
            metrics = self._objects.setdefault(detection.object_name, ObjectMetricAccumulator())
            metrics.detection_count += 1

    def record_world_state(self, world: object) -> None:
        track_map = {track.object_name: track for track in world.tracks}
        for obj in world.objects:
            track = track_map.get(obj.name)
            if track is None:
                continue

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

            position_error = math.hypot(truth_rel_x - track.x, truth_rel_y - track.y)
            velocity_error = math.hypot(truth_rel_vx - track.vx, truth_rel_vy - track.vy)

            metrics = self._objects.setdefault(obj.name, ObjectMetricAccumulator())
            metrics.samples += 1
            metrics.position_error_sq_sum += position_error * position_error
            metrics.velocity_error_sq_sum += velocity_error * velocity_error
            metrics.position_error_sum += position_error
            metrics.velocity_error_sum += velocity_error
            metrics.max_position_error = max(metrics.max_position_error, position_error)
            metrics.time_since_update_sum += track.time_since_update

    def build_summary(self) -> dict[str, object]:
        per_object: dict[str, dict[str, float | int]] = {}
        total_samples = 0
        total_detections = 0
        total_position_sq = 0.0
        total_velocity_sq = 0.0
        max_position_rmse = 0.0
        max_velocity_rmse = 0.0

        for object_name, metrics in sorted(self._objects.items()):
            if metrics.samples > 0:
                position_rmse = math.sqrt(metrics.position_error_sq_sum / metrics.samples)
                velocity_rmse = math.sqrt(metrics.velocity_error_sq_sum / metrics.samples)
                mean_position_error = metrics.position_error_sum / metrics.samples
                mean_velocity_error = metrics.velocity_error_sum / metrics.samples
                mean_time_since_update = metrics.time_since_update_sum / metrics.samples
            else:
                position_rmse = 0.0
                velocity_rmse = 0.0
                mean_position_error = 0.0
                mean_velocity_error = 0.0
                mean_time_since_update = 0.0

            per_object[object_name] = {
                "samples": metrics.samples,
                "detection_count": metrics.detection_count,
                "position_rmse": position_rmse,
                "velocity_rmse": velocity_rmse,
                "mean_position_error": mean_position_error,
                "mean_velocity_error": mean_velocity_error,
                "max_position_error": metrics.max_position_error,
                "mean_time_since_update": mean_time_since_update,
            }

            total_samples += metrics.samples
            total_detections += metrics.detection_count
            total_position_sq += metrics.position_error_sq_sum
            total_velocity_sq += metrics.velocity_error_sq_sum
            max_position_rmse = max(max_position_rmse, position_rmse)
            max_velocity_rmse = max(max_velocity_rmse, velocity_rmse)

        if total_samples > 0:
            mean_position_rmse = math.sqrt(total_position_sq / total_samples)
            mean_velocity_rmse = math.sqrt(total_velocity_sq / total_samples)
        else:
            mean_position_rmse = 0.0
            mean_velocity_rmse = 0.0

        return {
            "tracked_object_count": len(per_object),
            "total_samples": total_samples,
            "total_detections": total_detections,
            "mean_position_rmse": mean_position_rmse,
            "mean_velocity_rmse": mean_velocity_rmse,
            "max_position_rmse": max_position_rmse,
            "max_velocity_rmse": max_velocity_rmse,
            "per_object": per_object,
        }
