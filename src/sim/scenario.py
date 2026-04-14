from __future__ import annotations

from src.sim.entities import SpaceObject
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
            )
        )

    return SimulationWorld(
        width=config.world.width,
        height=config.world.height,
        ego=ego,
        objects=objects,
    )
