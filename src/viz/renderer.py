from __future__ import annotations

from dataclasses import dataclass
import math
import os
import random

import pygame

from src.sim.entities import SpaceObject
from src.sim.geometry import relative_position
from src.sim.world import SimulationWorld
from src.utils.config import ScenarioConfig


BACKGROUND = (5, 10, 24)
PANEL_BACKGROUND = (11, 18, 34)
PANEL_ACCENT = (34, 48, 76)
GRID_COLOR = (40, 57, 89)
TEXT_PRIMARY = (229, 236, 255)
TEXT_MUTED = (148, 163, 184)
WORLD_FRAME = (67, 84, 118)
STAR_COLOR = (255, 255, 255)
TRAIL_ALPHA = 95
RADAR_RING = (108, 97, 48)
RADAR_BEAM = (255, 214, 102, 36)
RADAR_BEAM_EDGE = (255, 214, 102)
RADAR_MEASURE = (255, 214, 102)
TRACK_COLOR = (86, 214, 255)
UNCERTAINTY = (255, 255, 255, 30)
WORLD_RADAR_RING = (255, 214, 102, 72)


@dataclass(slots=True)
class WorldViewport:
    origin_x: int
    origin_y: int
    width: int
    height: int
    scale: float


@dataclass(slots=True)
class DesktopLayout:
    truth_rect: pygame.Rect
    radar_truth_rect: pygame.Rect
    radar_rect: pygame.Rect
    telemetry_rect: pygame.Rect
    sidebar_rect: pygame.Rect


@dataclass(slots=True)
class DetectionLogEntry:
    sim_time: float
    object_name: str
    measured_range: float
    measured_bearing_deg: float
    estimated_category: str


@dataclass(slots=True)
class RadarTruthEcho:
    x: float
    y: float
    estimated_category: str
    ttl: float
    max_ttl: float


class SimulationApp:
    def __init__(self, config: ScenarioConfig, world: SimulationWorld) -> None:
        self.config = config
        self.world = world
        self.is_paused = False
        self.screen: pygame.Surface | None = None
        self.clock: pygame.time.Clock | None = None
        self.title_font: pygame.font.Font | None = None
        self.body_font: pygame.font.Font | None = None
        self.small_font: pygame.font.Font | None = None
        self.star_field: list[tuple[int, int, int]] = []
        self.detection_log: list[DetectionLogEntry] = []
        self.radar_truth_echoes: dict[str, RadarTruthEcho] = {}

    def run(self, max_frames: int | None = None) -> int:
        pygame.init()
        os.environ.setdefault("SDL_VIDEO_WINDOW_POS", "40,40")
        pygame.display.set_caption(self.config.window.title)

        self.screen = pygame.display.set_mode(
            (self.config.window.width, self.config.window.height),
            pygame.RESIZABLE,
        )
        self.clock = pygame.time.Clock()
        self.title_font = pygame.font.SysFont("Segoe UI Semibold", 28)
        self.body_font = pygame.font.SysFont("Segoe UI", 18)
        self.small_font = pygame.font.SysFont("Consolas", 16)
        self.star_field = self._generate_star_field()

        frame_count = 0
        running = True
        while running:
            dt = self.clock.tick(self.config.window.fps) / 1000.0
            running = self._handle_events()
            if not self.is_paused:
                self.world.update(dt)
                self._ingest_radar_state(dt)

            assert self.screen is not None
            self._draw(self.screen)
            pygame.display.flip()

            frame_count += 1
            if max_frames is not None and frame_count >= max_frames:
                break

        pygame.quit()
        return 0

    def _handle_events(self) -> bool:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return False
            if event.type == pygame.VIDEORESIZE:
                self.screen = pygame.display.set_mode(
                    (max(1180, event.w), max(760, event.h)),
                    pygame.RESIZABLE,
                )
            if event.type == pygame.KEYDOWN:
                if event.key == pygame.K_ESCAPE:
                    return False
                if event.key == pygame.K_SPACE:
                    self.is_paused = not self.is_paused
                if event.key == pygame.K_g:
                    self.config.ui.show_grid = not self.config.ui.show_grid
                if event.key == pygame.K_l:
                    self.config.ui.show_labels = not self.config.ui.show_labels
                if event.key == pygame.K_v:
                    self.config.ui.show_vectors = not self.config.ui.show_vectors
                if event.key == pygame.K_t:
                    self.config.ui.show_trails = not self.config.ui.show_trails
        return True

    def _draw(self, surface: pygame.Surface) -> None:
        surface.fill(BACKGROUND)
        layout = self._compute_layout(surface.get_width(), surface.get_height())
        self._draw_world_panel(
            surface,
            layout.truth_rect,
            title="True Vision",
            show_ranges=True,
            filtered_to_radar=False,
            show_legend=True,
        )
        self._draw_world_panel(
            surface,
            layout.radar_truth_rect,
            title="Radar-Accessible Truth",
            show_ranges=True,
            filtered_to_radar=True,
            show_legend=False,
        )
        self._draw_radar_panel(surface, layout.radar_rect)
        self._draw_telemetry_panel(surface, layout.telemetry_rect)
        self._draw_sidebar_panel(surface, layout.sidebar_rect)

    def _compute_layout(self, window_width: int, window_height: int) -> DesktopLayout:
        gap = 14
        margin = 20
        sidebar_width = max(220, min(260, int(window_width * 0.17)))
        content_width = window_width - margin * 2 - sidebar_width - gap * 2
        content_height = window_height - margin * 2 - gap

        left_width = content_width // 2
        right_width = content_width - left_width

        top_height = content_height // 2
        bottom_height = content_height - top_height

        truth_rect = pygame.Rect(margin, margin, left_width, top_height)
        radar_truth_rect = pygame.Rect(margin, truth_rect.bottom + gap, left_width, bottom_height)
        radar_rect = pygame.Rect(truth_rect.right + gap, margin, right_width, top_height)
        telemetry_rect = pygame.Rect(radar_rect.x, radar_rect.bottom + gap, right_width, bottom_height)
        sidebar_rect = pygame.Rect(telemetry_rect.right + gap, margin, sidebar_width, content_height)
        return DesktopLayout(
            truth_rect=truth_rect,
            radar_truth_rect=radar_truth_rect,
            radar_rect=radar_rect,
            telemetry_rect=telemetry_rect,
            sidebar_rect=sidebar_rect,
        )

    def _ingest_radar_state(self, dt: float) -> None:
        fade_rate = dt
        expired: list[str] = []
        for name, echo in self.radar_truth_echoes.items():
            echo.ttl -= fade_rate
            if echo.ttl <= 0.0:
                expired.append(name)
        for name in expired:
            self.radar_truth_echoes.pop(name, None)

        for detection in self.world.recent_detections:
            self.detection_log.append(
                DetectionLogEntry(
                    sim_time=self.world.sim_time,
                    object_name=detection.object_name,
                    measured_range=detection.measured_range,
                    measured_bearing_deg=detection.measured_bearing_deg,
                    estimated_category=detection.classification.estimated_category,
                )
            )
            self.detection_log = self.detection_log[-18:]

            source = next((obj for obj in self.world.objects if obj.name == detection.object_name), None)
            if source is not None:
                self.radar_truth_echoes[detection.object_name] = RadarTruthEcho(
                    x=source.x,
                    y=source.y,
                    estimated_category=detection.classification.estimated_category,
                    ttl=5.0,
                    max_ttl=5.0,
                )

    def _draw_world_panel(
        self,
        surface: pygame.Surface,
        rect: pygame.Rect,
        *,
        title: str,
        show_ranges: bool,
        filtered_to_radar: bool,
        show_legend: bool,
    ) -> None:
        assert self.title_font is not None
        assert self.body_font is not None

        panel_surface = pygame.Surface((rect.width, rect.height))
        panel_surface.fill((12, 20, 38))
        pygame.draw.rect(panel_surface, PANEL_ACCENT, panel_surface.get_rect(), width=1, border_radius=14)

        title_surface = self.title_font.render(title, True, TEXT_PRIMARY)
        panel_surface.blit(title_surface, (12, 10))

        content_rect = pygame.Rect(12, 52, rect.width - 24, rect.height - 64)
        viewport = self._compute_viewport(content_rect)

        if not filtered_to_radar:
            self._draw_star_field(panel_surface, viewport)
        if self.config.ui.show_grid:
            self._draw_grid(panel_surface, viewport)

        pygame.draw.rect(
            panel_surface,
            WORLD_FRAME,
            pygame.Rect(viewport.origin_x, viewport.origin_y, viewport.width, viewport.height),
            width=2,
            border_radius=10,
        )

        if show_ranges:
            self._draw_world_radar_ranges(panel_surface, viewport)

        if filtered_to_radar:
            self._draw_radar_truth_mask(panel_surface, viewport)
            self._draw_radar_truth_echoes(panel_surface, viewport)
            visible_objects = [self.world.ego]
            visible_objects.extend(self._visible_radar_objects())
            for obj in visible_objects:
                self._draw_object(panel_surface, viewport, obj)
        else:
            for obj in self.world.all_objects:
                if self.config.ui.show_trails:
                    self._draw_trail(panel_surface, viewport, obj)
            for obj in self.world.all_objects:
                self._draw_object(panel_surface, viewport, obj)

        if show_legend:
            self._draw_truth_legend(panel_surface)

        surface.blit(panel_surface, rect.topleft)

    def _compute_viewport(self, target_rect: pygame.Rect) -> WorldViewport:
        render_width = target_rect.width
        render_height = target_rect.height
        scale = min(
            render_width / self.world.width,
            render_height / self.world.height,
        )
        width = int(self.world.width * scale)
        height = int(self.world.height * scale)
        origin_x = target_rect.x + (render_width - width) // 2
        origin_y = target_rect.y + (render_height - height) // 2
        return WorldViewport(
            origin_x=origin_x,
            origin_y=origin_y,
            width=width,
            height=height,
            scale=scale,
        )

    def _world_to_screen(self, viewport: WorldViewport, x: float, y: float) -> tuple[int, int]:
        screen_x = viewport.origin_x + int(x * viewport.scale)
        screen_y = viewport.origin_y + int(y * viewport.scale)
        return screen_x, screen_y

    def _generate_star_field(self) -> list[tuple[int, int, int]]:
        rng = random.Random(self.config.world.seed)
        stars = []
        for _ in range(self.config.world.star_count):
            stars.append(
                (
                    rng.randint(0, int(self.world.width)),
                    rng.randint(0, int(self.world.height)),
                    rng.randint(1, 3),
                )
            )
        return stars

    def _draw_star_field(self, surface: pygame.Surface, viewport: WorldViewport) -> None:
        for x, y, radius in self.star_field:
            px, py = self._world_to_screen(viewport, x, y)
            pygame.draw.circle(surface, STAR_COLOR, (px, py), radius)

    def _draw_world_radar_ranges(self, surface: pygame.Surface, viewport: WorldViewport) -> None:
        if self.world.radar_sensor is None:
            return

        center = self._world_to_screen(viewport, self.world.ego.x, self.world.ego.y)
        max_range = self.world.radar_sensor.config.max_range
        overlay = pygame.Surface((surface.get_width(), surface.get_height()), pygame.SRCALPHA)

        for ring_index in range(1, 5):
            world_radius = max_range * ring_index / 4
            screen_radius = int(world_radius * viewport.scale)
            if screen_radius <= 0:
                continue
            pygame.draw.circle(
                overlay,
                WORLD_RADAR_RING,
                center,
                screen_radius,
                width=2,
            )

        surface.blit(overlay, (0, 0))

    def _draw_radar_truth_mask(self, surface: pygame.Surface, viewport: WorldViewport) -> None:
        if self.world.radar_sensor is None:
            return

        center = self._world_to_screen(viewport, self.world.ego.x, self.world.ego.y)
        max_range_px = int(self.world.radar_sensor.config.max_range * viewport.scale)
        beam_angle = math.radians(self.world.radar_sensor.scan_angle_deg)
        half_beam = math.radians(self.world.radar_sensor.config.beam_width_deg / 2.0)

        overlay = pygame.Surface((surface.get_width(), surface.get_height()), pygame.SRCALPHA)
        viewport_rect = pygame.Rect(viewport.origin_x, viewport.origin_y, viewport.width, viewport.height)
        pygame.draw.rect(overlay, (4, 8, 18, 190), viewport_rect)

        polygon = [center]
        segments = 24
        for index in range(segments + 1):
            interp = index / segments
            angle = (beam_angle - half_beam) + (2.0 * half_beam * interp)
            polygon.append(
                (
                    center[0] + int(math.cos(angle) * max_range_px),
                    center[1] + int(math.sin(angle) * max_range_px),
                )
            )
        pygame.draw.polygon(overlay, (255, 214, 102, 0), polygon)
        pygame.draw.polygon(overlay, (255, 214, 102, 58), polygon, width=2)
        surface.blit(overlay, (0, 0))

    def _draw_radar_truth_echoes(self, surface: pygame.Surface, viewport: WorldViewport) -> None:
        overlay = pygame.Surface((surface.get_width(), surface.get_height()), pygame.SRCALPHA)
        for echo in self.radar_truth_echoes.values():
            alpha_ratio = max(0.0, min(1.0, echo.ttl / echo.max_ttl))
            color = self._category_color(echo.estimated_category)
            point = self._world_to_screen(viewport, echo.x, echo.y)
            base_radius = self._radar_truth_echo_radius(echo.estimated_category)
            radius = max(4, int(base_radius * (0.55 + 0.45 * alpha_ratio)))
            pygame.draw.circle(
                overlay,
                (*color, int(90 + 130 * alpha_ratio)),
                point,
                radius,
                width=0,
            )
            pygame.draw.circle(
                overlay,
                (*color, int(180 * alpha_ratio)),
                point,
                radius + 4,
                width=1,
            )
        surface.blit(overlay, (0, 0))

    def _draw_grid(self, surface: pygame.Surface, viewport: WorldViewport) -> None:
        spacing = self.config.world.grid_spacing
        x = 0.0
        while x <= self.world.width:
            start = self._world_to_screen(viewport, x, 0)
            end = self._world_to_screen(viewport, x, self.world.height)
            pygame.draw.line(surface, GRID_COLOR, start, end, width=1)
            x += spacing

        y = 0.0
        while y <= self.world.height:
            start = self._world_to_screen(viewport, 0, y)
            end = self._world_to_screen(viewport, self.world.width, y)
            pygame.draw.line(surface, GRID_COLOR, start, end, width=1)
            y += spacing

    def _draw_trail(
        self,
        surface: pygame.Surface,
        viewport: WorldViewport,
        obj: SpaceObject,
    ) -> None:
        if len(obj.trail) < 2:
            return

        trail_surface = pygame.Surface(
            (surface.get_width(), surface.get_height()),
            pygame.SRCALPHA,
        )

        points = [self._world_to_screen(viewport, x, y) for x, y in obj.trail]
        for start, end in zip(points, points[1:]):
            if abs(start[0] - end[0]) > viewport.width * 0.5:
                continue
            if abs(start[1] - end[1]) > viewport.height * 0.5:
                continue
            pygame.draw.line(
                trail_surface,
                (*obj.color, TRAIL_ALPHA),
                start,
                end,
                width=2,
            )
        surface.blit(trail_surface, (0, 0))

    def _draw_object(
        self,
        surface: pygame.Surface,
        viewport: WorldViewport,
        obj: SpaceObject,
    ) -> None:
        center = self._world_to_screen(viewport, obj.x, obj.y)
        radius = max(4, int(obj.radius * viewport.scale))

        if obj.is_ego:
            self._draw_satellite(surface, center, radius, obj.heading_rad, obj.color)
        else:
            pygame.draw.circle(surface, obj.color, center, radius)
            pygame.draw.circle(surface, (255, 255, 255), center, radius, width=1)

        if self.config.ui.show_vectors and obj.speed > 0.1:
            end = (
                center[0] + int(obj.vx * viewport.scale * 0.8),
                center[1] + int(obj.vy * viewport.scale * 0.8),
            )
            pygame.draw.line(surface, obj.color, center, end, width=2)

        if self.config.ui.show_labels:
            assert self.small_font is not None
            label = f"{obj.name} [{obj.object_class}]"
            label_surface = self.small_font.render(label, True, TEXT_PRIMARY)
            label_rect = label_surface.get_rect(midbottom=(center[0], center[1] - radius - 6))
            surface.blit(label_surface, label_rect)

    def _draw_satellite(
        self,
        surface: pygame.Surface,
        center: tuple[int, int],
        radius: int,
        heading: float,
        color: tuple[int, int, int],
    ) -> None:
        tip = (
            center[0] + int(math.cos(heading) * radius * 1.6),
            center[1] + int(math.sin(heading) * radius * 1.6),
        )
        left = (
            center[0] + int(math.cos(heading + 2.45) * radius * 1.2),
            center[1] + int(math.sin(heading + 2.45) * radius * 1.2),
        )
        right = (
            center[0] + int(math.cos(heading - 2.45) * radius * 1.2),
            center[1] + int(math.sin(heading - 2.45) * radius * 1.2),
        )
        pygame.draw.polygon(surface, color, (tip, left, right))
        pygame.draw.polygon(surface, (255, 255, 255), (tip, left, right), width=2)

    def _draw_radar_panel(self, surface: pygame.Surface, rect: pygame.Rect) -> None:
        assert self.body_font is not None
        assert self.small_font is not None

        pygame.draw.rect(surface, (15, 26, 47), rect, border_radius=14)
        pygame.draw.rect(surface, PANEL_ACCENT, rect, width=1, border_radius=14)

        title = self.title_font.render("Radar / Tracks", True, TEXT_PRIMARY)
        surface.blit(title, (rect.x + 12, rect.y + 10))

        if self.world.radar_sensor is None:
            return

        radar_square = pygame.Rect(rect.x + 12, rect.y + 52, rect.width - 24, rect.height - 64)
        center = radar_square.center
        radius = min(radar_square.width, radar_square.height) // 2 - 8

        for ring_index in range(1, 5):
            pygame.draw.circle(
                surface,
                RADAR_RING,
                center,
                max(8, int(radius * ring_index / 4)),
                width=1,
            )

        pygame.draw.line(surface, RADAR_RING, (center[0] - radius, center[1]), (center[0] + radius, center[1]), width=1)
        pygame.draw.line(surface, RADAR_RING, (center[0], center[1] - radius), (center[0], center[1] + radius), width=1)

        beam_surface = pygame.Surface((surface.get_width(), surface.get_height()), pygame.SRCALPHA)
        half_beam = math.radians(self.world.radar_sensor.config.beam_width_deg / 2)
        beam_angle = math.radians(self.world.radar_sensor.scan_angle_deg)
        beam_points = [
            center,
            (
                center[0] + int(math.cos(beam_angle - half_beam) * radius),
                center[1] + int(math.sin(beam_angle - half_beam) * radius),
            ),
            (
                center[0] + int(math.cos(beam_angle + half_beam) * radius),
                center[1] + int(math.sin(beam_angle + half_beam) * radius),
            ),
        ]
        pygame.draw.polygon(beam_surface, RADAR_BEAM, beam_points)
        surface.blit(beam_surface, (0, 0))
        pygame.draw.line(
            surface,
            RADAR_BEAM_EDGE,
            center,
            (
                center[0] + int(math.cos(beam_angle) * radius),
                center[1] + int(math.sin(beam_angle) * radius),
            ),
            width=2,
        )

        for track in self.world.tracks:
            self._draw_track_radar(surface, center, radius, track)

        pygame.draw.circle(surface, TRACK_COLOR, center, 6)
        pygame.draw.circle(surface, (255, 255, 255), center, 6, width=2)

        status_text = self.small_font.render(
            f"beam {self.world.radar_sensor.scan_angle_deg:6.1f} deg  detections {self.world.radar_sensor.last_detection_count:d}",
            True,
            TEXT_MUTED,
        )
        surface.blit(status_text, (rect.x + 12, rect.bottom - 24))
        self._draw_radar_legend(surface, rect)

    def _draw_track_radar(
        self,
        surface: pygame.Surface,
        center: tuple[int, int],
        radius: int,
        track: object,
    ) -> None:
        if self.world.radar_sensor is None:
            return

        scale = radius / self.world.radar_sensor.config.max_range

        for index, detection in enumerate(track.detection_history):
            age_ratio = (index + 1) / len(track.detection_history)
            detection_color = self._category_color(detection.estimated_category)
            point = (
                center[0] + int(detection.x * scale),
                center[1] + int(detection.y * scale),
            )
            square_size = max(2, int(2 + age_ratio * 3))
            pygame.draw.rect(
                surface,
                detection_color,
                pygame.Rect(
                    point[0] - square_size,
                    point[1] - square_size,
                    square_size * 2,
                    square_size * 2,
                ),
                width=0,
            )
            if index > 0:
                previous = track.detection_history[index - 1]
                previous_point = (
                    center[0] + int(previous.x * scale),
                    center[1] + int(previous.y * scale),
                )
                pygame.draw.line(
                    surface,
                    (*RADAR_MEASURE[:3],),
                    previous_point,
                    point,
                    width=1,
                )

        estimate_point = (
            center[0] + int(track.x * scale),
            center[1] + int(track.y * scale),
        )
        category_color = self._category_color(track.estimated_category)
        pygame.draw.line(surface, category_color, (estimate_point[0] - 4, estimate_point[1]), (estimate_point[0] + 4, estimate_point[1]), width=2)
        pygame.draw.line(surface, category_color, (estimate_point[0], estimate_point[1] - 4), (estimate_point[0], estimate_point[1] + 4), width=2)

        sigma_major_px = max(4, min(int((3 * math.sqrt(max(track.axis_x.p00, 1.0)) / self.world.radar_sensor.config.max_range) * radius), 50))
        sigma_minor_px = max(3, min(int((3 * math.sqrt(max(track.axis_y.p00, 1.0)) / self.world.radar_sensor.config.max_range) * radius), 28))
        ellipse_rect = pygame.Rect(
            estimate_point[0] - sigma_major_px,
            estimate_point[1] - sigma_minor_px,
            sigma_major_px * 2,
            sigma_minor_px * 2,
        )
        pygame.draw.ellipse(surface, (200, 208, 220), ellipse_rect, width=1)

    def _is_object_visible_to_radar(self, obj: SpaceObject) -> bool:
        if self.world.radar_sensor is None:
            return True

        relative_x, relative_y = relative_position(
            reference_x=self.world.ego.x,
            reference_y=self.world.ego.y,
            target_x=obj.x,
            target_y=obj.y,
            world_width=self.world.width,
            world_height=self.world.height,
        )
        distance = math.hypot(relative_x, relative_y)
        if distance > self.world.radar_sensor.config.max_range:
            return False

        bearing_deg = math.degrees(math.atan2(relative_y, relative_x)) % 360.0
        delta = (bearing_deg - self.world.radar_sensor.scan_angle_deg + 540.0) % 360.0 - 180.0
        return abs(delta) <= self.world.radar_sensor.config.beam_width_deg / 2.0

    def _visible_radar_objects(self) -> list[SpaceObject]:
        return [obj for obj in self.world.objects if self._is_object_visible_to_radar(obj)]

    @staticmethod
    def _radar_truth_echo_radius(category: str) -> int:
        if category == "hazard_debris":
            return 14
        if category == "target_debris":
            return 10
        return 6

    def _draw_truth_legend(self, surface: pygame.Surface) -> None:
        assert self.small_font is not None

        legend_rect = pygame.Rect(surface.get_width() - 180, 10, 168, 92)
        pygame.draw.rect(surface, (10, 16, 32), legend_rect, border_radius=10)
        pygame.draw.rect(surface, PANEL_ACCENT, legend_rect, width=1, border_radius=10)
        title = self.small_font.render("Legend", True, TEXT_PRIMARY)
        surface.blit(title, (legend_rect.x + 10, legend_rect.y + 8))

        entries = [
            ("Neutral", self._category_color("neutral_debris")),
            ("Collectable", self._category_color("target_debris")),
            ("Dangerous", self._category_color("hazard_debris")),
        ]
        y = legend_rect.y + 34
        for label, color in entries:
            pygame.draw.circle(surface, color, (legend_rect.x + 16, y + 6), 5)
            text = self.small_font.render(label, True, TEXT_MUTED)
            surface.blit(text, (legend_rect.x + 28, y - 2))
            y += 18

    def _draw_radar_legend(self, surface: pygame.Surface, rect: pygame.Rect) -> None:
        assert self.small_font is not None

        legend_rect = pygame.Rect(rect.right - 170, rect.y + 58, 158, 78)
        pygame.draw.rect(surface, (10, 16, 32), legend_rect, border_radius=10)
        pygame.draw.rect(surface, PANEL_ACCENT, legend_rect, width=1, border_radius=10)
        title = self.small_font.render("Legend", True, TEXT_PRIMARY)
        surface.blit(title, (legend_rect.x + 10, legend_rect.y + 8))

        square = pygame.Rect(legend_rect.x + 12, legend_rect.y + 30, 10, 10)
        pygame.draw.rect(surface, RADAR_MEASURE, square)
        square_text = self.small_font.render("square = measure", True, TEXT_MUTED)
        surface.blit(square_text, (legend_rect.x + 30, legend_rect.y + 26))

        pygame.draw.line(surface, TRACK_COLOR, (legend_rect.x + 17, legend_rect.y + 48), (legend_rect.x + 17, legend_rect.y + 60), width=2)
        pygame.draw.line(surface, TRACK_COLOR, (legend_rect.x + 11, legend_rect.y + 54), (legend_rect.x + 23, legend_rect.y + 54), width=2)
        cross_text = self.small_font.render("cross = track", True, TEXT_MUTED)
        surface.blit(cross_text, (legend_rect.x + 30, legend_rect.y + 48))

    @staticmethod
    def _category_color(category: str) -> tuple[int, int, int]:
        if category == "hazard_debris":
            return (255, 107, 107)
        if category == "target_debris":
            return (255, 214, 102)
        return (134, 239, 172)

    def _draw_telemetry_panel(self, surface: pygame.Surface, rect: pygame.Rect) -> None:
        assert self.title_font is not None
        assert self.body_font is not None
        assert self.small_font is not None

        pygame.draw.rect(surface, PANEL_BACKGROUND, rect, border_radius=14)
        pygame.draw.rect(surface, PANEL_ACCENT, rect, width=1, border_radius=14)

        title = self.title_font.render("Radar Log", True, TEXT_PRIMARY)
        surface.blit(title, (rect.x + 20, rect.y + 18))
        log_rect = pygame.Rect(rect.x + 18, rect.y + 60, rect.width - 36, rect.height - 78)
        pygame.draw.rect(surface, (14, 23, 42), log_rect, border_radius=10)
        pygame.draw.rect(surface, PANEL_ACCENT, log_rect, width=1, border_radius=10)

        y = log_rect.y + 12
        log_bottom_limit = log_rect.bottom - 12
        logs = self.detection_log[-12:]
        if not logs:
            empty_text = self.small_font.render("Waiting for radar revisit...", True, TEXT_MUTED)
            surface.blit(empty_text, (log_rect.x + 12, y + 4))
        else:
            for entry in reversed(logs):
                if y + 34 > log_bottom_limit:
                    break
                color = self._category_color(entry.estimated_category)
                track_text = self.small_font.render(
                    f"{entry.object_name:<8} {entry.estimated_category:<14}",
                    True,
                    color,
                )
                surface.blit(track_text, (log_rect.x + 12, y))
                y += 18

                meta = self.small_font.render(
                    f"t={entry.sim_time:5.1f}s  brg {entry.measured_bearing_deg:6.1f}  rng {entry.measured_range:6.1f}",
                    True,
                    TEXT_MUTED,
                )
                surface.blit(meta, (log_rect.x + 12, y))
                y += 18

    def _draw_sidebar_panel(self, surface: pygame.Surface, rect: pygame.Rect) -> None:
        assert self.title_font is not None
        assert self.body_font is not None
        assert self.small_font is not None

        pygame.draw.rect(surface, PANEL_BACKGROUND, rect, border_radius=14)
        pygame.draw.rect(surface, PANEL_ACCENT, rect, width=1, border_radius=14)

        title = self.title_font.render("Status", True, TEXT_PRIMARY)
        surface.blit(title, (rect.x + 18, rect.y + 18))

        status = "PAUSED" if self.is_paused else "RUNNING"
        fps = self.clock.get_fps() if self.clock is not None else 0.0
        lines = [
            f"Status   {status}",
            f"Time     {self.world.sim_time:5.1f}s",
            f"FPS      {fps:5.1f}",
            f"Objects  {len(self.world.all_objects):5d}",
        ]
        if self.world.radar_sensor is not None:
            lines.extend(
                [
                    f"Beam     {self.world.radar_sensor.scan_angle_deg:5.1f}",
                    f"Width    {self.world.radar_sensor.config.beam_width_deg:5.1f}",
                    f"Hits     {self.world.radar_sensor.last_detection_count:5d}",
                ]
            )

        y = rect.y + 68
        for line in lines:
            text = self.small_font.render(line, True, TEXT_PRIMARY)
            surface.blit(text, (rect.x + 18, y))
            y += 22

        y += 8
        controls_title = self.body_font.render("Controls", True, TEXT_PRIMARY)
        surface.blit(controls_title, (rect.x + 18, y))
        y += 30
        controls = [
            "Space  pause",
            "G      grid",
            "L      labels",
            "V      vectors",
            "T      trails",
            "Esc    quit",
        ]
        for line in controls:
            text = self.small_font.render(line, True, TEXT_MUTED)
            surface.blit(text, (rect.x + 18, y))
            y += 20
