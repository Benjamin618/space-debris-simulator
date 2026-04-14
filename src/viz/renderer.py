from __future__ import annotations

import asyncio
from dataclasses import dataclass
import math
import random

import pygame

from src.sim.entities import SpaceObject
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


@dataclass(slots=True)
class WorldViewport:
    origin_x: int
    origin_y: int
    width: int
    height: int
    scale: float


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

    async def run(self, max_frames: int | None = None) -> int:
        pygame.init()
        pygame.display.set_caption(self.config.window.title)

        self.screen = pygame.display.set_mode(
            (self.config.window.width, self.config.window.height)
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

            assert self.screen is not None
            self._draw(self.screen)
            pygame.display.flip()

            frame_count += 1
            if max_frames is not None and frame_count >= max_frames:
                break

            # Browser builds need to yield back to the event loop every frame.
            await asyncio.sleep(0)

        pygame.quit()
        return 0

    def _handle_events(self) -> bool:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return False
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
        viewport = self._compute_viewport()
        panel_rect = pygame.Rect(
            self.config.window.width - self.config.ui.side_panel_width,
            0,
            self.config.ui.side_panel_width,
            self.config.window.height,
        )

        self._draw_star_field(surface, viewport)
        if self.config.ui.show_grid:
            self._draw_grid(surface, viewport)

        pygame.draw.rect(
            surface,
            WORLD_FRAME,
            pygame.Rect(viewport.origin_x, viewport.origin_y, viewport.width, viewport.height),
            width=2,
            border_radius=10,
        )

        for obj in self.world.all_objects:
            if self.config.ui.show_trails:
                self._draw_trail(surface, viewport, obj)

        for obj in self.world.all_objects:
            self._draw_object(surface, viewport, obj)

        self._draw_panel(surface, panel_rect)

    def _compute_viewport(self) -> WorldViewport:
        render_width = self.config.window.width - self.config.ui.side_panel_width - 40
        render_height = self.config.window.height - 40
        scale = min(
            render_width / self.world.width,
            render_height / self.world.height,
        )
        width = int(self.world.width * scale)
        height = int(self.world.height * scale)
        origin_x = 20 + (render_width - width) // 2
        origin_y = 20 + (render_height - height) // 2
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
            (self.config.window.width, self.config.window.height),
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

    def _draw_panel(self, surface: pygame.Surface, rect: pygame.Rect) -> None:
        assert self.title_font is not None
        assert self.body_font is not None
        assert self.small_font is not None

        pygame.draw.rect(surface, PANEL_BACKGROUND, rect)
        pygame.draw.line(surface, PANEL_ACCENT, rect.topleft, rect.bottomleft, width=2)

        title = self.title_font.render("Mission Console", True, TEXT_PRIMARY)
        surface.blit(title, (rect.x + 20, rect.y + 20))

        status = "PAUSED" if self.is_paused else "RUNNING"
        fps = self.clock.get_fps() if self.clock is not None else 0.0
        info_lines = [
            f"Status       {status}",
            f"Sim time     {self.world.sim_time:6.1f} s",
            f"Frame rate   {fps:6.1f} FPS",
            f"Objects      {len(self.world.all_objects):6d}",
            f"World size   {int(self.world.width)} x {int(self.world.height)}",
        ]

        y = rect.y + 80
        for line in info_lines:
            text = self.small_font.render(line, True, TEXT_PRIMARY)
            surface.blit(text, (rect.x + 20, y))
            y += 24

        y += 12
        subtitle = self.body_font.render("Legend", True, TEXT_PRIMARY)
        surface.blit(subtitle, (rect.x + 20, y))
        y += 34

        for class_name, style in self.config.class_styles.items():
            pygame.draw.circle(surface, style.color, (rect.x + 30, y + 8), 7)
            legend = self.small_font.render(
                f"{style.label} ({class_name})",
                True,
                TEXT_MUTED,
            )
            surface.blit(legend, (rect.x + 48, y))
            y += 28

        y += 10
        subtitle = self.body_font.render("Entities", True, TEXT_PRIMARY)
        surface.blit(subtitle, (rect.x + 20, y))
        y += 34

        for obj in self.world.all_objects:
            speed_text = self.small_font.render(
                f"{obj.name:<8} {obj.speed:6.1f} px/s",
                True,
                obj.color,
            )
            surface.blit(speed_text, (rect.x + 20, y))
            y += 22

        y = rect.bottom - 110
        controls_title = self.body_font.render("Controls", True, TEXT_PRIMARY)
        surface.blit(controls_title, (rect.x + 20, y))
        y += 34
        controls = [
            "Space  pause / resume",
            "G      toggle grid",
            "L      toggle labels",
            "V      toggle vectors",
            "T      toggle trails",
            "Esc    quit",
        ]
        for line in controls:
            text = self.small_font.render(line, True, TEXT_MUTED)
            surface.blit(text, (rect.x + 20, y))
            y += 22
