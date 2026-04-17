from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
import math


def _wrap_coordinate(value: float, limit: float) -> float:
    if limit <= 0:
        return value
    return value % limit


@dataclass(slots=True)
class SpaceObject:
    name: str
    object_class: str
    color: tuple[int, int, int]
    radius: float
    x: float
    y: float
    vx: float
    vy: float
    is_ego: bool = False
    label: str | None = None
    true_category: str | None = None
    physical_size: float | None = None
    second_order_coefficient: float = 0.0
    max_acceleration: float = 0.0
    angular_rate: float = 0.0
    phase_x: float = 0.0
    phase_y: float = 0.0
    turn_sign: float = 1.0
    trail: deque[tuple[float, float]] = field(
        default_factory=lambda: deque(maxlen=90),
        repr=False,
    )
    motion_time: float = 0.0

    def __post_init__(self) -> None:
        if self.true_category is None:
            if self.object_class == "dangerous_debris":
                self.true_category = "hazard_debris"
            elif self.object_class == "collectable_debris":
                self.true_category = "target_debris"
            elif self.object_class == "ego":
                self.true_category = "ego_vehicle"
            else:
                self.true_category = "neutral_debris"

        if self.physical_size is None:
            if self.true_category == "hazard_debris":
                self.physical_size = 3.0
            elif self.true_category == "target_debris":
                self.physical_size = 1.5
            elif self.true_category == "ego_vehicle":
                self.physical_size = 1.8
            else:
                self.physical_size = 0.35

        self.trail.append((self.x, self.y))

    @property
    def speed(self) -> float:
        return math.hypot(self.vx, self.vy)

    @property
    def heading_rad(self) -> float:
        if self.speed < 1e-6:
            return -math.pi / 2
        return math.atan2(self.vy, self.vx)

    @property
    def position(self) -> tuple[float, float]:
        return self.x, self.y

    @property
    def velocity(self) -> tuple[float, float]:
        return self.vx, self.vy

    def update(self, dt: float, world_width: float, world_height: float) -> None:
        if (not self.is_ego) and self.second_order_coefficient > 0.0 and self.max_acceleration > 0.0:
            self.motion_time += dt
            acceleration_scale = self.max_acceleration * self.second_order_coefficient
            modulation = 0.82 + 0.18 * math.sin(self.angular_rate * self.motion_time + self.phase_x)
            effective_acceleration = acceleration_scale * modulation
            speed = max(self.speed, 1e-6)
            normal_x = -self.turn_sign * self.vy / speed
            normal_y = self.turn_sign * self.vx / speed
            ax = effective_acceleration * normal_x
            ay = effective_acceleration * normal_y
            self.vx += ax * dt
            self.vy += ay * dt

        self.x = _wrap_coordinate(self.x + self.vx * dt, world_width)
        self.y = _wrap_coordinate(self.y + self.vy * dt, world_height)
        self.trail.append((self.x, self.y))
