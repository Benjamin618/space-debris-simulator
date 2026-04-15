from __future__ import annotations

from dataclasses import dataclass, field
import math

from src.sim.classification import ClassificationEstimate


@dataclass(slots=True)
class TrackingConfig:
    process_variance: float = 12.0
    measurement_variance: float = 18.0
    initial_measurement_variance: float = 36.0


@dataclass(slots=True)
class DetectionRecord:
    x: float
    y: float
    estimated_category: str


class KalmanAxis:
    def __init__(self, position: float, measurement_variance: float) -> None:
        self.position = position
        self.velocity = 0.0
        self.p00 = measurement_variance
        self.p01 = 0.0
        self.p10 = 0.0
        self.p11 = measurement_variance

    def predict(self, dt: float, process_variance: float) -> None:
        self.position += self.velocity * dt

        q00 = 0.25 * dt * dt * dt * dt * process_variance
        q01 = 0.5 * dt * dt * dt * process_variance
        q11 = dt * dt * process_variance

        p00 = self.p00 + dt * (self.p10 + self.p01) + dt * dt * self.p11 + q00
        p01 = self.p01 + dt * self.p11 + q01
        p10 = self.p10 + dt * self.p11 + q01
        p11 = self.p11 + q11

        self.p00 = p00
        self.p01 = p01
        self.p10 = p10
        self.p11 = p11

    def update(self, measurement: float, measurement_variance: float) -> None:
        innovation = measurement - self.position
        covariance = self.p00 + measurement_variance
        gain_position = self.p00 / covariance
        gain_velocity = self.p10 / covariance

        self.position += gain_position * innovation
        self.velocity += gain_velocity * innovation

        p00 = (1.0 - gain_position) * self.p00
        p01 = (1.0 - gain_position) * self.p01
        p10 = self.p10 - gain_velocity * self.p00
        p11 = self.p11 - gain_velocity * self.p01

        self.p00 = p00
        self.p01 = p01
        self.p10 = p10
        self.p11 = p11


@dataclass(slots=True)
class Track:
    object_name: str
    config: TrackingConfig
    axis_x: KalmanAxis
    axis_y: KalmanAxis
    age: float = 0.0
    time_since_update: float = 0.0
    last_range: float = 0.0
    last_bearing_deg: float = 0.0
    estimated_category: str = "unknown"
    confidence: float = 0.0
    observation_quality: float = 0.0
    observation_label: str = "low"
    last_truth_category: str | None = None
    last_detection_x: float = 0.0
    last_detection_y: float = 0.0
    detection_history: list[DetectionRecord] = field(default_factory=list, repr=False)

    @classmethod
    def from_detection(
        cls,
        object_name: str,
        *,
        detection_x: float,
        detection_y: float,
        detection_range: float,
        detection_bearing_deg: float,
        classification: ClassificationEstimate,
        config: TrackingConfig,
    ) -> Track:
        track = cls(
            object_name=object_name,
            config=config,
            axis_x=KalmanAxis(detection_x, config.initial_measurement_variance),
            axis_y=KalmanAxis(detection_y, config.initial_measurement_variance),
            last_range=detection_range,
            last_bearing_deg=detection_bearing_deg,
            last_detection_x=detection_x,
            last_detection_y=detection_y,
        )
        track.update_classification(classification)
        track.push_detection(detection_x, detection_y, classification.estimated_category)
        return track

    @property
    def x(self) -> float:
        return self.axis_x.position

    @property
    def y(self) -> float:
        return self.axis_y.position

    @property
    def vx(self) -> float:
        return self.axis_x.velocity

    @property
    def vy(self) -> float:
        return self.axis_y.velocity

    @property
    def sigma(self) -> float:
        return math.sqrt(max(self.axis_x.p00 + self.axis_y.p00, 1.0))

    def predict(self, dt: float) -> None:
        self.age += dt
        self.time_since_update += dt
        self.axis_x.predict(dt, self.config.process_variance)
        self.axis_y.predict(dt, self.config.process_variance)

    def apply_detection(
        self,
        *,
        detection_x: float,
        detection_y: float,
        detection_range: float,
        detection_bearing_deg: float,
        classification: ClassificationEstimate,
    ) -> None:
        self.axis_x.update(detection_x, self.config.measurement_variance)
        self.axis_y.update(detection_y, self.config.measurement_variance)
        self.time_since_update = 0.0
        self.last_range = detection_range
        self.last_bearing_deg = detection_bearing_deg
        self.last_detection_x = detection_x
        self.last_detection_y = detection_y
        self.update_classification(classification)
        self.push_detection(detection_x, detection_y, classification.estimated_category)

    def update_classification(self, classification: ClassificationEstimate) -> None:
        self.estimated_category = classification.estimated_category
        self.confidence = classification.confidence
        self.observation_quality = classification.observation_quality
        self.observation_label = classification.observation_label
        self.last_truth_category = classification.true_category

    def push_detection(self, x: float, y: float, estimated_category: str) -> None:
        self.detection_history.append(
            DetectionRecord(
                x=x,
                y=y,
                estimated_category=estimated_category,
            )
        )
        if len(self.detection_history) > 5:
            self.detection_history.pop(0)


class TrackManager:
    def __init__(self, config: TrackingConfig | None = None) -> None:
        self.config = config or TrackingConfig()
        self._tracks: dict[str, Track] = {}

    @property
    def tracks(self) -> list[Track]:
        return sorted(self._tracks.values(), key=lambda track: math.hypot(track.x, track.y))

    def reset(self) -> None:
        self._tracks.clear()

    def predict(self, dt: float) -> None:
        for track in self._tracks.values():
            track.predict(dt)

    def apply_detection(
        self,
        *,
        object_name: str,
        detection_x: float,
        detection_y: float,
        detection_range: float,
        detection_bearing_deg: float,
        classification: ClassificationEstimate,
    ) -> None:
        if object_name not in self._tracks:
            self._tracks[object_name] = Track.from_detection(
                object_name,
                detection_x=detection_x,
                detection_y=detection_y,
                detection_range=detection_range,
                detection_bearing_deg=detection_bearing_deg,
                classification=classification,
                config=self.config,
            )
            return

        self._tracks[object_name].apply_detection(
            detection_x=detection_x,
            detection_y=detection_y,
            detection_range=detection_range,
            detection_bearing_deg=detection_bearing_deg,
            classification=classification,
        )
