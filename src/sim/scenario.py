from __future__ import annotations

from src.sim.classification import ClassificationConfig as RuntimeClassificationConfig
from src.sim.classification import VisionClassifier
from src.sim.entities import SpaceObject
from src.sim.radar import RadarConfig as RuntimeRadarConfig
from src.sim.radar import RadarSensor
from src.sim.tracking import TrackManager
from src.sim.tracking import TrackingConfig as RuntimeTrackingConfig
from src.sim.world import SimulationWorld
from src.utils.config import ScenarioConfig


def build_world(config: ScenarioConfig) -> SimulationWorld:
    style_map = config.class_styles

    ego_style = style_map[config.ego.object_class]
    ego = SpaceObject(
        name=config.ego.name,
        object_class=config.ego.object_class,
        color=ego_style.color,
        radius=config.ego.radius,
        x=config.ego.position[0],
        y=config.ego.position[1],
        vx=config.ego.velocity[0],
        vy=config.ego.velocity[1],
        is_ego=True,
        label=ego_style.label,
        true_category=config.ego.true_category,
        physical_size=config.ego.physical_size,
    )

    objects = []
    for object_config in config.objects:
        style = style_map[object_config.object_class]
        objects.append(
            SpaceObject(
                name=object_config.name,
                object_class=object_config.object_class,
                color=style.color,
                radius=object_config.radius,
                x=object_config.position[0],
                y=object_config.position[1],
                vx=object_config.velocity[0],
                vy=object_config.velocity[1],
                label=style.label,
                true_category=object_config.true_category,
                physical_size=object_config.physical_size,
            )
        )

    classifier = VisionClassifier(
        RuntimeClassificationConfig(
            full_quality_range=config.classification.full_quality_range,
            degraded_quality_range=config.classification.degraded_quality_range,
            min_confidence=config.classification.min_confidence,
            max_confidence=config.classification.max_confidence,
            ambiguity_noise_scale=config.classification.ambiguity_noise_scale,
        ),
        seed=config.radar.seed,
    )
    radar_sensor = RadarSensor(
        RuntimeRadarConfig(
            max_range=config.radar.max_range,
            scan_rate_deg_s=config.radar.scan_rate_deg_s,
            beam_width_deg=config.radar.beam_width_deg,
            range_noise_std=config.radar.range_noise_std,
            bearing_noise_std_deg=config.radar.bearing_noise_std_deg,
            seed=config.radar.seed,
        ),
        classifier=classifier,
    )
    track_manager = TrackManager(
        RuntimeTrackingConfig(
            process_variance=config.tracking.process_variance,
            measurement_variance=config.tracking.measurement_variance,
            initial_measurement_variance=config.tracking.initial_measurement_variance,
        )
    )

    return SimulationWorld(
        width=config.world.width,
        height=config.world.height,
        ego=ego,
        objects=objects,
        radar_sensor=radar_sensor,
        track_manager=track_manager,
    )
