from __future__ import annotations

from dataclasses import dataclass

from src.sim.entities import SpaceObject


@dataclass(slots=True)
class SimulationWorld:
    width: float
    height: float
    ego: SpaceObject
    objects: list[SpaceObject]
    sim_time: float = 0.0

    @property
    def all_objects(self) -> list[SpaceObject]:
        return [self.ego, *self.objects]

    def update(self, dt: float) -> None:
        self.sim_time += dt
        for obj in self.all_objects:
            obj.update(dt, self.width, self.height)

    def class_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for obj in self.all_objects:
            counts[obj.object_class] = counts.get(obj.object_class, 0) + 1
        return counts
