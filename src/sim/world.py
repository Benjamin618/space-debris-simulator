from __future__ import annotations

from dataclasses import dataclass, field

from src.sim.radar import RadarDetection, RadarSensor
from src.sim.entities import SpaceObject
from src.sim.tracking import Track, TrackManager


@dataclass(slots=True)
class SimulationWorld:
    width: float
    height: float
    ego: SpaceObject
    objects: list[SpaceObject]
    radar_sensor: RadarSensor | None = None
    track_manager: TrackManager | None = None
    sim_time: float = 0.0
    recent_detections: list[RadarDetection] = field(default_factory=list, repr=False)

    @property
    def all_objects(self) -> list[SpaceObject]:
        return [self.ego, *self.objects]

    def update(self, dt: float) -> None:
        self.sim_time += dt
        for obj in self.all_objects:
            obj.update(dt, self.width, self.height)

        if self.track_manager is not None:
            self.track_manager.predict(dt)

        if self.radar_sensor is not None and self.track_manager is not None:
            self.recent_detections = self.radar_sensor.scan(self, dt=dt)
            for detection in self.recent_detections:
                self.track_manager.apply_detection(
                    object_name=detection.object_name,
                    detection_x=detection.measured_x,
                    detection_y=detection.measured_y,
                    detection_range=detection.measured_range,
                    detection_bearing_deg=detection.measured_bearing_deg,
                    classification=detection.classification,
                )

    def class_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for obj in self.all_objects:
            counts[obj.object_class] = counts.get(obj.object_class, 0) + 1
        return counts

    @property
    def tracks(self) -> list[Track]:
        if self.track_manager is None:
            return []
        return self.track_manager.tracks
