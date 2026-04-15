from __future__ import annotations

from dataclasses import dataclass
import math
import random

from src.sim.classification import ClassificationEstimate, VisionClassifier
from src.sim.entities import SpaceObject
from src.sim.geometry import relative_position


@dataclass(slots=True)
class RadarConfig:
    max_range: float = 360.0
    scan_rate_deg_s: float = 40.8
    beam_width_deg: float = 14.0
    range_noise_std: float = 4.0
    bearing_noise_std_deg: float = 1.6
    seed: int = 42


@dataclass(slots=True)
class RadarDetection:
    object_name: str
    measured_range: float
    measured_bearing_deg: float
    measured_x: float
    measured_y: float
    classification: ClassificationEstimate


class RadarSensor:
    def __init__(
        self,
        config: RadarConfig | None = None,
        *,
        classifier: VisionClassifier,
    ) -> None:
        self.config = config or RadarConfig()
        self.classifier = classifier
        self.scan_angle_deg = 0.0
        self.last_detection_count = 0
        self._rng = random.Random(self.config.seed)
        self._last_detection_times: dict[str, float] = {}

    def reset(self) -> None:
        self.scan_angle_deg = 0.0
        self.last_detection_count = 0
        self._rng = random.Random(self.config.seed)
        self._last_detection_times.clear()

    def scan(self, world: object, *, dt: float) -> list[RadarDetection]:
        self.scan_angle_deg = self._normalize_angle(self.scan_angle_deg + self.config.scan_rate_deg_s * dt)
        revisit_interval_s = (360.0 / self.config.scan_rate_deg_s) * 0.82

        detections: list[RadarDetection] = []
        for obj in world.objects:
            relative_x, relative_y = relative_position(
                reference_x=world.ego.x,
                reference_y=world.ego.y,
                target_x=obj.x,
                target_y=obj.y,
                world_width=world.width,
                world_height=world.height,
            )
            distance = math.hypot(relative_x, relative_y)
            if distance > self.config.max_range:
                continue

            bearing_deg = self._normalize_angle(math.degrees(math.atan2(relative_y, relative_x)))
            if abs(self._angular_difference(self.scan_angle_deg, bearing_deg)) > self.config.beam_width_deg / 2:
                continue

            last_detection_time = self._last_detection_times.get(obj.name)
            if last_detection_time is not None and (world.sim_time - last_detection_time) < revisit_interval_s:
                continue

            measured_range = max(0.0, distance + self._gaussian_noise(self.config.range_noise_std))
            measured_bearing_deg = self._normalize_angle(
                bearing_deg + self._gaussian_noise(self.config.bearing_noise_std_deg)
            )
            measured_bearing_rad = math.radians(measured_bearing_deg)
            measured_x = math.cos(measured_bearing_rad) * measured_range
            measured_y = math.sin(measured_bearing_rad) * measured_range
            classification = self.classifier.classify(obj, distance=distance)

            detections.append(
                RadarDetection(
                    object_name=obj.name,
                    measured_range=measured_range,
                    measured_bearing_deg=measured_bearing_deg,
                    measured_x=measured_x,
                    measured_y=measured_y,
                    classification=classification,
                )
            )
            self._last_detection_times[obj.name] = world.sim_time

        self.last_detection_count = len(detections)
        return detections

    def _gaussian_noise(self, std: float) -> float:
        if std <= 0:
            return 0.0
        return self._rng.gauss(0.0, std)

    @staticmethod
    def _normalize_angle(angle_deg: float) -> float:
        return angle_deg % 360.0

    @classmethod
    def _angular_difference(cls, from_deg: float, to_deg: float) -> float:
        delta = cls._normalize_angle(to_deg) - cls._normalize_angle(from_deg)
        if delta > 180.0:
            delta -= 360.0
        elif delta < -180.0:
            delta += 360.0
        return delta
