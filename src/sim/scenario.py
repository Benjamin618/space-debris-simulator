from __future__ import annotations

import random

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
    coefficient_rng = random.Random(config.truth_dynamics.coefficient_seed)
    coefficient_min = max(0.0, min(1.0, config.truth_dynamics.default_coefficient_range[0]))
    coefficient_max = max(0.0, min(1.0, config.truth_dynamics.default_coefficient_range[1]))
    if coefficient_max < coefficient_min:
        coefficient_min, coefficient_max = coefficient_max, coefficient_min

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
    for index, object_config in enumerate(config.objects):
        style = style_map[object_config.object_class]
        second_order_coefficient = object_config.second_order_coefficient
        if second_order_coefficient is None:
            second_order_coefficient = coefficient_rng.uniform(coefficient_min, coefficient_max)
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
                second_order_coefficient=second_order_coefficient,
                max_acceleration=config.truth_dynamics.max_acceleration,
                angular_rate=config.truth_dynamics.angular_rate,
                phase_x=0.9 * index + 0.3,
                phase_y=1.3 * index + 1.1,
                turn_sign=1.0 if index % 2 == 0 else -1.0,
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
        truth_dynamics=config.truth_dynamics,
    )
