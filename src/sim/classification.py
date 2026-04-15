from __future__ import annotations

from dataclasses import dataclass
import random

from src.sim.entities import SpaceObject


@dataclass(slots=True)
class ClassificationEstimate:
    estimated_category: str
    confidence: float
    observation_quality: float
    observation_label: str
    true_category: str


@dataclass(slots=True)
class ClassificationConfig:
    full_quality_range: float = 140.0
    degraded_quality_range: float = 340.0
    min_confidence: float = 0.24
    max_confidence: float = 0.95
    ambiguity_noise_scale: float = 0.38


class VisionClassifier:
    def __init__(
        self,
        config: ClassificationConfig | None = None,
        *,
        seed: int = 42,
    ) -> None:
        self.config = config or ClassificationConfig()
        self._rng = random.Random(seed)

    def classify(
        self,
        obj: SpaceObject,
        *,
        distance: float,
    ) -> ClassificationEstimate:
        quality = self._observation_quality(distance)
        noise_amplitude = (1.0 - quality) * self.config.ambiguity_noise_scale
        apparent_size = float(obj.physical_size) + self._rng.uniform(-noise_amplitude, noise_amplitude)
        estimated_category = self._classify_size(apparent_size)

        confidence_span = self.config.max_confidence - self.config.min_confidence
        threshold_distance = min(
            abs(apparent_size - 0.75),
            abs(apparent_size - 2.1),
        )
        boundary_boost = max(0.0, min(threshold_distance / 0.45, 1.0))
        confidence = self.config.min_confidence + confidence_span * (0.35 + 0.65 * quality) * (
            0.45 + 0.55 * boundary_boost
        )
        confidence = max(self.config.min_confidence, min(confidence, self.config.max_confidence))

        return ClassificationEstimate(
            estimated_category=estimated_category,
            confidence=confidence,
            observation_quality=quality,
            observation_label=self._quality_label(quality),
            true_category=str(obj.true_category),
        )

    def _observation_quality(self, distance: float) -> float:
        if distance <= self.config.full_quality_range:
            return 1.0
        if distance >= self.config.degraded_quality_range:
            return 0.2

        ratio = (distance - self.config.full_quality_range) / (
            self.config.degraded_quality_range - self.config.full_quality_range
        )
        return max(0.2, min(1.0 - ratio * 0.8, 1.0))

    @staticmethod
    def _classify_size(apparent_size: float) -> str:
        if apparent_size >= 2.1:
            return "hazard_debris"
        if apparent_size >= 0.75:
            return "target_debris"
        return "neutral_debris"

    @staticmethod
    def _quality_label(quality: float) -> str:
        if quality >= 0.74:
            return "high"
        if quality >= 0.48:
            return "medium"
        return "low"
