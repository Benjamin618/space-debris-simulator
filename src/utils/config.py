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
    true_category: str | None = None
    physical_size: float | None = None
    second_order_coefficient: float | None = None


@dataclass(slots=True)
class RadarConfig:
    max_range: float
    scan_rate_deg_s: float
    beam_width_deg: float
    range_noise_std: float
    bearing_noise_std_deg: float
    seed: int


@dataclass(slots=True)
class TrackingConfig:
    process_variance: float
    measurement_variance: float
    initial_measurement_variance: float


@dataclass(slots=True)
class ClassificationConfig:
    full_quality_range: float
    degraded_quality_range: float
    min_confidence: float
    max_confidence: float
    ambiguity_noise_scale: float


@dataclass(slots=True)
class TruthDynamicsConfig:
    model: str
    max_acceleration: float
    angular_rate: float
    coefficient_seed: int
    default_coefficient_range: Point2D


@dataclass(slots=True)
class ScenarioConfig:
    window: WindowConfig
    world: WorldConfig
    ui: UIConfig
    class_styles: dict[str, ClassStyle]
    ego: ObjectConfig
    objects: list[ObjectConfig]
    radar: RadarConfig
    tracking: TrackingConfig
    classification: ClassificationConfig
    truth_dynamics: TruthDynamicsConfig


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
        true_category=str(raw["true_category"]) if "true_category" in raw else None,
        physical_size=float(raw["physical_size"]) if "physical_size" in raw else None,
        second_order_coefficient=(
            max(0.0, min(1.0, float(raw["second_order_coefficient"])))
            if "second_order_coefficient" in raw
            else None
        ),
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
        radar=RadarConfig(
            max_range=float(raw.get("radar", {}).get("max_range", 360.0)),
            scan_rate_deg_s=float(raw.get("radar", {}).get("scan_rate_deg_s", 40.8)),
            beam_width_deg=float(raw.get("radar", {}).get("beam_width_deg", 14.0)),
            range_noise_std=float(raw.get("radar", {}).get("range_noise_std", 4.0)),
            bearing_noise_std_deg=float(raw.get("radar", {}).get("bearing_noise_std_deg", 1.6)),
            seed=int(raw.get("radar", {}).get("seed", 42)),
        ),
        tracking=TrackingConfig(
            process_variance=float(raw.get("tracking", {}).get("process_variance", 12.0)),
            measurement_variance=float(raw.get("tracking", {}).get("measurement_variance", 18.0)),
            initial_measurement_variance=float(
                raw.get("tracking", {}).get("initial_measurement_variance", 36.0)
            ),
        ),
        classification=ClassificationConfig(
            full_quality_range=float(raw.get("classification", {}).get("full_quality_range", 140.0)),
            degraded_quality_range=float(
                raw.get("classification", {}).get("degraded_quality_range", 340.0)
            ),
            min_confidence=float(raw.get("classification", {}).get("min_confidence", 0.24)),
            max_confidence=float(raw.get("classification", {}).get("max_confidence", 0.95)),
            ambiguity_noise_scale=float(
                raw.get("classification", {}).get("ambiguity_noise_scale", 0.38)
            ),
        ),
        truth_dynamics=TruthDynamicsConfig(
            model=str(raw.get("truth_dynamics", {}).get("model", "second_order_bounded")),
            max_acceleration=float(raw.get("truth_dynamics", {}).get("max_acceleration", 2.0)),
            angular_rate=float(raw.get("truth_dynamics", {}).get("angular_rate", 0.35)),
            coefficient_seed=int(raw.get("truth_dynamics", {}).get("coefficient_seed", raw["world"]["seed"])),
            default_coefficient_range=_as_point(
                raw.get("truth_dynamics", {}).get("default_coefficient_range", [0.2, 0.8])
            ),
        ),
    )
