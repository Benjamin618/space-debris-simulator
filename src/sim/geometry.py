from __future__ import annotations

import math


def shortest_axis_delta(reference: float, target: float, size: float) -> float:
    if size <= 0:
        return target - reference

    delta = target - reference
    half_size = size / 2
    if delta > half_size:
        return delta - size
    if delta < -half_size:
        return delta + size
    return delta


def relative_position(
    reference_x: float,
    reference_y: float,
    target_x: float,
    target_y: float,
    world_width: float,
    world_height: float,
) -> tuple[float, float]:
    return (
        shortest_axis_delta(reference_x, target_x, world_width),
        shortest_axis_delta(reference_y, target_y, world_height),
    )


def relative_distance(
    reference_x: float,
    reference_y: float,
    target_x: float,
    target_y: float,
    world_width: float,
    world_height: float,
) -> float:
    dx, dy = relative_position(
        reference_x=reference_x,
        reference_y=reference_y,
        target_x=target_x,
        target_y=target_y,
        world_width=world_width,
        world_height=world_height,
    )
    return math.hypot(dx, dy)
