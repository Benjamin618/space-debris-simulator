from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path


Color = tuple[int, int, int]
Point2D = tuple[float, float]


@dataclass(slots=True)
class WindowConfig:
    width: int
    height: int
    fps: int
    title: str


@dataclass(slots=True)
class WorldConfig:
    width: float
    height: float
    boundary_mode: str
    grid_spacing: float
    star_count: int
    seed: int


@dataclass(slots=True)
class UIConfig:
    show_grid: bool
    show_labels: bool
    show_vectors: bool
    show_trails: bool
    side_panel_width: int


@dataclass(slots=True)
class ClassStyle:
    label: str
    color: Color


@dataclass(slots=True)
class ObjectConfig:
    name: str
    object_class: str
    radius: float
    position: Point2D
    velocity: Point2D


@dataclass(slots=True)
class ScenarioConfig:
    window: WindowConfig
    world: WorldConfig
    ui: UIConfig
    class_styles: dict[str, ClassStyle]
    ego: ObjectConfig
    objects: list[ObjectConfig]


def _as_color(values: list[int]) -> Color:
    if len(values) != 3:
        raise ValueError(f"Expected an RGB triplet, got {values!r}")
    return int(values[0]), int(values[1]), int(values[2])


def _as_point(values: list[float]) -> Point2D:
    if len(values) != 2:
        raise ValueError(f"Expected a 2D point, got {values!r}")
    return float(values[0]), float(values[1])


def _parse_object(raw: dict[str, object]) -> ObjectConfig:
    return ObjectConfig(
        name=str(raw["name"]),
        object_class=str(raw["object_class"]),
        radius=float(raw["radius"]),
        position=_as_point(raw["position"]),
        velocity=_as_point(raw["velocity"]),
    )


def load_scenario_config(path: str | Path) -> ScenarioConfig:
    config_path = Path(path)
    raw = json.loads(config_path.read_text(encoding="utf-8"))

    class_styles = {
        class_name: ClassStyle(
            label=str(style["label"]),
            color=_as_color(style["color"]),
        )
        for class_name, style in raw["class_styles"].items()
    }

    return ScenarioConfig(
        window=WindowConfig(
            width=int(raw["window"]["width"]),
            height=int(raw["window"]["height"]),
            fps=int(raw["window"]["fps"]),
            title=str(raw["window"]["title"]),
        ),
        world=WorldConfig(
            width=float(raw["world"]["width"]),
            height=float(raw["world"]["height"]),
            boundary_mode=str(raw["world"]["boundary_mode"]),
            grid_spacing=float(raw["world"]["grid_spacing"]),
            star_count=int(raw["world"]["star_count"]),
            seed=int(raw["world"]["seed"]),
        ),
        ui=UIConfig(
            show_grid=bool(raw["ui"]["show_grid"]),
            show_labels=bool(raw["ui"]["show_labels"]),
            show_vectors=bool(raw["ui"]["show_vectors"]),
            show_trails=bool(raw["ui"]["show_trails"]),
            side_panel_width=int(raw["ui"]["side_panel_width"]),
        ),
        class_styles=class_styles,
        ego=_parse_object(raw["ego"]),
        objects=[_parse_object(item) for item in raw["objects"]],
    )
