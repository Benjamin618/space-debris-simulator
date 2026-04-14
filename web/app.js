const SCENARIOS = {
  default: "./config/scenario_default.json",
  custom: "./config/scenario_custom.json",
};

const COLORS = {
  worldFrame: "#435476",
  controlFrame: "rgba(86, 214, 255, 0.72)",
  grid: "rgba(64, 87, 137, 0.85)",
  textPrimary: "#edf3ff",
  textMuted: "#9fb1cf",
  trailAlpha: 0.4,
};

function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function shortestAxisDelta(from, to, size) {
  const delta = to - from;
  const halfSize = size / 2;
  if (delta > halfSize) {
    return delta - size;
  }
  if (delta < -halfSize) {
    return delta + size;
  }
  return delta;
}

function rgbaFromRgb(rgb, alpha) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

class SpaceObject {
  constructor(config, style, isEgo = false) {
    this.name = config.name;
    this.objectClass = config.object_class;
    this.radius = config.radius;
    this.color = style.color;
    this.label = style.label;
    this.isEgo = isEgo;
    this.reset(config);
  }

  reset(config) {
    this.x = config.position[0];
    this.y = config.position[1];
    this.vx = config.velocity[0];
    this.vy = config.velocity[1];
    this.trail = [[this.x, this.y]];
    this.active = true;
    this.inThreatZone = false;
    this.avoided = false;
  }

  update(dt, worldWidth, worldHeight) {
    this.x = (this.x + this.vx * dt + worldWidth) % worldWidth;
    this.y = (this.y + this.vy * dt + worldHeight) % worldHeight;
    this.trail.push([this.x, this.y]);
    if (this.trail.length > 90) {
      this.trail.shift();
    }
  }

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }

  get headingRad() {
    if (this.speed < 1e-6) {
      return -Math.PI / 2;
    }
    return Math.atan2(this.vy, this.vx);
  }
}

class SimulationWorld {
  constructor(config) {
    this.width = config.world.width;
    this.height = config.world.height;
    this.simTime = 0;
    this.classStyles = config.class_styles;
    this.egoControl = {
      speedLevels: config.ego_control?.speed_levels ?? [20, 40, 80],
      frameRatio: config.ego_control?.frame_ratio ?? 0.4,
      showFrame: config.ego_control?.show_frame ?? true,
      actionIntervalMs: config.ego_control?.action_interval_ms ?? 1000,
      batteryCapacity: config.ego_control?.battery_capacity ?? 100,
      batteryDrainScale: config.ego_control?.battery_drain_scale ?? 0.0002,
      collectPadding: config.ego_control?.collect_radius_padding ?? 10,
      threatRadius: config.ego_control?.threat_radius ?? 180,
      threatClearRadius: config.ego_control?.threat_clear_radius ?? 240,
      collisionPadding: config.ego_control?.collision_padding ?? 8,
    };
    this.mission = {
      durationLimitS: config.mission?.duration_limit_s ?? 180,
      collectedPoints: config.mission?.collected_points ?? 12,
      avoidedPoints: config.mission?.avoided_points ?? 4,
      missedPenalty: config.mission?.missed_penalty ?? 18,
      sobrietyBonusMax: config.mission?.sobriety_bonus_max ?? 20,
    };
    this.ego = new SpaceObject(config.ego, this.classStyles[config.ego.object_class], true);
    this.objects = config.objects.map((item) => new SpaceObject(item, this.classStyles[item.object_class]));
    this.controlBounds = this.computeControlBounds();
    this.egoDirection = this.resolveInitialDirection();
    this.egoSpeedLevelIndex = this.resolveInitialSpeedLevelIndex();
    this.battery = this.egoControl.batteryCapacity;
    this.metrics = {
      collected: 0,
      avoided: 0,
      missed: 0,
    };
    this.missionEnded = false;
    this.missionEndReason = null;
  }

  get allObjects() {
    return [this.ego, ...this.activeObjects];
  }

  get activeObjects() {
    return this.objects.filter((object) => object.active);
  }

  get currentEgoSpeed() {
    if (this.egoDirection === null || this.egoSpeedLevelIndex < 0 || this.battery <= 0) {
      return 0;
    }

    return this.egoControl.speedLevels[this.egoSpeedLevelIndex] ?? 0;
  }

  get energyUsed() {
    return this.egoControl.batteryCapacity - this.battery;
  }

  get sobrietyBonus() {
    return Math.round((this.battery / this.egoControl.batteryCapacity) * this.mission.sobrietyBonusMax);
  }

  get score() {
    return (
      this.metrics.collected * this.mission.collectedPoints
      + this.metrics.avoided * this.mission.avoidedPoints
      - this.metrics.missed * this.mission.missedPenalty
      + this.sobrietyBonus
    );
  }

  computeControlBounds() {
    const frameWidth = this.width * this.egoControl.frameRatio;
    const frameHeight = this.height * this.egoControl.frameRatio;
    return {
      minX: (this.width - frameWidth) / 2,
      maxX: (this.width + frameWidth) / 2,
      minY: (this.height - frameHeight) / 2,
      maxY: (this.height + frameHeight) / 2,
      width: frameWidth,
      height: frameHeight,
    };
  }

  resolveInitialDirection() {
    if (this.ego.vx > 0) {
      return "right";
    }
    if (this.ego.vx < 0) {
      return "left";
    }
    if (this.ego.vy > 0) {
      return "down";
    }
    if (this.ego.vy < 0) {
      return "up";
    }
    return null;
  }

  resolveInitialSpeedLevelIndex() {
    const speed = Math.hypot(this.ego.vx, this.ego.vy);
    if (speed < 1e-6) {
      return -1;
    }

    const exactMatchIndex = this.egoControl.speedLevels.findIndex((level) => Math.abs(level - speed) < 1e-6);
    if (exactMatchIndex >= 0) {
      return exactMatchIndex;
    }

    return this.egoControl.speedLevels.findIndex((level) => level >= speed);
  }

  stopEgo() {
    this.egoDirection = null;
    this.egoSpeedLevelIndex = -1;
    this.ego.vx = 0;
    this.ego.vy = 0;
  }

  setEgoMotion(direction, speedLevelIndex) {
    if (direction === null || speedLevelIndex < 0 || this.battery <= 0) {
      this.stopEgo();
      return;
    }

    this.egoDirection = direction;
    this.egoSpeedLevelIndex = clamp(speedLevelIndex, 0, this.egoControl.speedLevels.length - 1);
  }

  applyPlayerAction(direction) {
    const oppositeDirections = {
      up: "down",
      down: "up",
      left: "right",
      right: "left",
    };

    if (this.battery <= 0) {
      this.stopEgo();
      return;
    }

    if (this.egoDirection !== null && oppositeDirections[direction] === this.egoDirection) {
      this.stopEgo();
      return;
    }

    if (this.egoDirection === direction) {
      this.egoSpeedLevelIndex = clamp(this.egoSpeedLevelIndex + 1, 0, this.egoControl.speedLevels.length - 1);
      return;
    }

    this.egoDirection = direction;
    this.egoSpeedLevelIndex = 0;
  }

  update(dt) {
    if (this.missionEnded) {
      return;
    }

    this.simTime += dt;
    this.updateEgo(dt);
    for (const object of this.activeObjects) {
      object.update(dt, this.width, this.height);
    }
    this.evaluateInteractions();
    this.evaluateMissionState();
  }

  updateEgo(dt) {
    let vx = 0;
    let vy = 0;
    const speed = this.currentEgoSpeed;

    if (this.egoDirection === "up") {
      vy = -speed;
    } else if (this.egoDirection === "down") {
      vy = speed;
    } else if (this.egoDirection === "left") {
      vx = -speed;
    } else if (this.egoDirection === "right") {
      vx = speed;
    }

    this.ego.vx = vx;
    this.ego.vy = vy;
    this.ego.x = clamp(this.ego.x + vx * dt, this.controlBounds.minX, this.controlBounds.maxX);
    this.ego.y = clamp(this.ego.y + vy * dt, this.controlBounds.minY, this.controlBounds.maxY);
    this.ego.trail.push([this.ego.x, this.ego.y]);
    if (this.ego.trail.length > 90) {
      this.ego.trail.shift();
    }

    this.consumeBattery(speed, dt);
  }

  consumeBattery(speed, dt) {
    if (this.battery <= 0) {
      return;
    }

    const idleDrain = (this.egoControl.batteryCapacity / this.mission.durationLimitS) * dt;
    const motionDrain = speed * speed * this.egoControl.batteryDrainScale * dt;
    this.battery = Math.max(0, this.battery - idleDrain - motionDrain);
    if (this.battery <= 0) {
      this.stopEgo();
    }
  }

  evaluateInteractions() {
    for (const object of this.activeObjects) {
      const deltaX = shortestAxisDelta(this.ego.x, object.x, this.width);
      const deltaY = shortestAxisDelta(this.ego.y, object.y, this.height);
      const distance = Math.hypot(deltaX, deltaY);

      if (object.objectClass === "collectable_debris") {
        const collectRadius = this.ego.radius + object.radius + this.egoControl.collectPadding;
        if (distance <= collectRadius) {
          object.active = false;
          this.metrics.collected += 1;
        }
        continue;
      }

      if (object.objectClass !== "dangerous_debris") {
        continue;
      }

      const collisionRadius = this.ego.radius + object.radius + this.egoControl.collisionPadding;
      if (distance <= collisionRadius) {
        object.active = false;
        if (!object.avoided) {
          this.metrics.missed += 1;
        }
        continue;
      }

      if (!object.inThreatZone && distance <= this.egoControl.threatRadius) {
        object.inThreatZone = true;
      } else if (object.inThreatZone && !object.avoided && distance >= this.egoControl.threatClearRadius) {
        object.avoided = true;
        object.active = false;
        this.metrics.avoided += 1;
      }
    }
  }

  evaluateMissionState() {
    if (this.simTime >= this.mission.durationLimitS) {
      this.endMission("Time limit reached");
      return;
    }

    if (this.battery <= 0) {
      this.endMission("Battery depleted");
      return;
    }

    const remainingTargets = this.activeObjects.filter((object) =>
      object.objectClass === "collectable_debris" || object.objectClass === "dangerous_debris");
    if (remainingTargets.length === 0) {
      this.endMission("Objectives completed");
    }
  }

  endMission(reason) {
    if (this.missionEnded) {
      return;
    }

    this.missionEnded = true;
    this.missionEndReason = reason;
    this.stopEgo();
  }
}

class CanvasSimulationApp {
  constructor() {
    this.canvas = document.getElementById("sim-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.pauseButton = document.getElementById("pause-button");
    this.resetButton = document.getElementById("reset-button");
    this.missionRestartButton = document.getElementById("mission-restart-button");
    this.modeSelect = document.getElementById("mode-select");
    this.scenarioSelect = document.getElementById("scenario-select");
    this.statusBadge = document.getElementById("status-badge");
    this.missionSummary = {
      root: document.getElementById("mission-summary"),
      title: document.getElementById("mission-summary-title"),
      reason: document.getElementById("mission-summary-reason"),
      score: document.getElementById("mission-summary-score"),
      duration: document.getElementById("mission-summary-duration"),
      energy: document.getElementById("mission-summary-energy"),
      sobriety: document.getElementById("mission-summary-sobriety"),
      collected: document.getElementById("mission-summary-collected"),
      avoided: document.getElementById("mission-summary-avoided"),
      missed: document.getElementById("mission-summary-missed"),
    };

    this.stats = {
      status: document.getElementById("stat-status"),
      time: document.getElementById("stat-time"),
      fps: document.getElementById("stat-fps"),
      objects: document.getElementById("stat-objects"),
      worldSize: document.getElementById("stat-world-size"),
      scenario: document.getElementById("stat-scenario"),
      mode: document.getElementById("stat-mode"),
      command: document.getElementById("stat-command"),
      egoState: document.getElementById("stat-ego-state"),
      egoSpeed: document.getElementById("stat-ego-speed"),
      battery: document.getElementById("stat-battery"),
      energyUsed: document.getElementById("stat-energy-used"),
      collected: document.getElementById("stat-collected"),
      avoided: document.getElementById("stat-avoided"),
      missed: document.getElementById("stat-missed"),
      sobriety: document.getElementById("stat-sobriety"),
      score: document.getElementById("stat-score"),
    };

    this.legendList = document.getElementById("legend-list");
    this.entityList = document.getElementById("entity-list");

    this.currentScenarioKey = "default";
    this.currentMode = "player";
    this.config = null;
    this.world = null;
    this.starField = [];
    this.isPaused = false;
    this.showGrid = true;
    this.showLabels = true;
    this.showVectors = true;
    this.showTrails = true;
    this.lastFrameTime = null;
    this.lastPanelRefresh = 0;
    this.frameCounter = 0;
    this.fps = 0;
    this.fpsSampleTime = 0;
    this.nextPilotActionTime = 0;
  }

  async init() {
    this.bindEvents();
    await this.loadScenario(this.currentScenarioKey);
    requestAnimationFrame((timestamp) => this.frame(timestamp));
  }

  bindEvents() {
    this.pauseButton.addEventListener("click", () => {
      this.isPaused = !this.isPaused;
      this.syncStatusUI();
    });

    this.resetButton.addEventListener("click", () => {
      this.resetScenario();
    });

    this.missionRestartButton.addEventListener("click", () => {
      this.resetScenario();
    });

    this.scenarioSelect.addEventListener("change", async (event) => {
      await this.loadScenario(event.target.value);
    });

    this.modeSelect.addEventListener("change", (event) => {
      this.setControlMode(event.target.value, { syncSelect: false, resetMotion: true });
    });

    window.addEventListener("keydown", async (event) => {
      if (event.repeat) {
        return;
      }

      if (this.currentMode === "player" && event.key === "ArrowUp") {
        this.issuePlayerAction("up");
      } else if (this.currentMode === "player" && event.key === "ArrowDown") {
        this.issuePlayerAction("down");
      } else if (this.currentMode === "player" && event.key === "ArrowLeft") {
        this.issuePlayerAction("left");
      } else if (this.currentMode === "player" && event.key === "ArrowRight") {
        this.issuePlayerAction("right");
      }

      if (event.code === "Space") {
        event.preventDefault();
        this.isPaused = !this.isPaused;
        this.syncStatusUI();
      } else if (event.key === "g" || event.key === "G") {
        this.showGrid = !this.showGrid;
      } else if (event.key === "l" || event.key === "L") {
        this.showLabels = !this.showLabels;
      } else if (event.key === "v" || event.key === "V") {
        this.showVectors = !this.showVectors;
      } else if (event.key === "t" || event.key === "T") {
        this.showTrails = !this.showTrails;
      } else if (event.key === "r" || event.key === "R") {
        this.resetScenario();
      } else if (event.key === "1") {
        this.scenarioSelect.value = "default";
        await this.loadScenario("default");
      } else if (event.key === "2") {
        this.scenarioSelect.value = "custom";
        await this.loadScenario("custom");
      }
    });

    window.addEventListener("resize", () => this.resizeCanvas());
  }

  async loadScenario(key) {
    const response = await fetch(SCENARIOS[key]);
    if (!response.ok) {
      throw new Error(`Unable to load scenario: ${SCENARIOS[key]}`);
    }

    this.currentScenarioKey = key;
    this.config = await response.json();
    this.world = new SimulationWorld(this.config);
    this.starField = this.generateStarField();
    this.isPaused = false;
    this.showGrid = this.config.ui.show_grid;
    this.showLabels = this.config.ui.show_labels;
    this.showVectors = this.config.ui.show_vectors;
    this.showTrails = this.config.ui.show_trails;
    this.lastFrameTime = null;
    this.frameCounter = 0;
    this.fps = 0;
    this.fpsSampleTime = performance.now();
    this.nextPilotActionTime = 0;
    this.renderLegend();
    this.setControlMode(this.currentMode, { syncSelect: true, resetMotion: true });
    this.hideMissionSummary();
    this.syncStatusUI();
    this.resizeCanvas();
    this.refreshSidebar(true);
  }

  resetScenario() {
    if (!this.config) {
      return;
    }
    this.world = new SimulationWorld(this.config);
    this.isPaused = false;
    this.lastFrameTime = null;
    this.nextPilotActionTime = 0;
    this.setControlMode(this.currentMode, { syncSelect: true, resetMotion: true });
    this.hideMissionSummary();
    this.syncStatusUI();
    this.refreshSidebar(true);
  }

  generateStarField() {
    const random = mulberry32(this.config.world.seed);
    const stars = [];
    for (let index = 0; index < this.config.world.star_count; index += 1) {
      stars.push({
        x: random() * this.config.world.width,
        y: random() * this.config.world.height,
        radius: 1 + Math.floor(random() * 3),
      });
    }
    return stars;
  }

  resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
  }

  frame(timestamp) {
    requestAnimationFrame((nextTimestamp) => this.frame(nextTimestamp));
    if (!this.world) {
      return;
    }

    if (this.lastFrameTime === null) {
      this.lastFrameTime = timestamp;
    }

    const elapsed = clamp((timestamp - this.lastFrameTime) / 1000, 0, 0.05);
    this.lastFrameTime = timestamp;

    if (!this.isPaused) {
      if (this.currentMode === "greedy") {
        this.applyGreedyControl();
      }
      this.world.update(elapsed);
      if (this.world.missionEnded) {
        this.isPaused = true;
        this.showMissionSummary();
        this.syncStatusUI();
      }
    }

    this.frameCounter += 1;
    if (timestamp - this.fpsSampleTime >= 500) {
      this.fps = (this.frameCounter * 1000) / (timestamp - this.fpsSampleTime);
      this.frameCounter = 0;
      this.fpsSampleTime = timestamp;
    }

    this.draw();
    if (timestamp - this.lastPanelRefresh > 180) {
      this.refreshSidebar();
      this.lastPanelRefresh = timestamp;
    }
  }

  computeViewport() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const padding = 22;
    const renderWidth = width - padding * 2;
    const renderHeight = height - padding * 2;
    const scale = Math.min(renderWidth / this.world.width, renderHeight / this.world.height);
    const worldPixelWidth = this.world.width * scale;
    const worldPixelHeight = this.world.height * scale;
    const originX = padding + (renderWidth - worldPixelWidth) / 2;
    const originY = padding + (renderHeight - worldPixelHeight) / 2;
    return { originX, originY, width: worldPixelWidth, height: worldPixelHeight, scale };
  }

  worldToScreen(viewport, x, y) {
    return {
      x: viewport.originX + x * viewport.scale,
      y: viewport.originY + y * viewport.scale,
    };
  }

  draw() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const viewport = this.computeViewport();

    this.ctx.clearRect(0, 0, width, height);
    this.drawBackground(width, height);
    this.drawStars(viewport);
    if (this.showGrid) {
      this.drawGrid(viewport);
    }

    this.ctx.strokeStyle = COLORS.worldFrame;
    this.ctx.lineWidth = 2;
    this.roundRect(viewport.originX, viewport.originY, viewport.width, viewport.height, 18, false, true);

    if (this.world.egoControl.showFrame) {
      this.drawControlFrame(viewport);
    }

    if (this.showTrails) {
      for (const object of this.world.allObjects) {
        this.drawTrail(viewport, object);
      }
    }

    for (const object of this.world.allObjects) {
      this.drawObject(viewport, object);
    }
  }

  drawBackground(width, height) {
    const gradient = this.ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#061021");
    gradient.addColorStop(1, "#030712");
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.fillStyle = "rgba(86, 214, 255, 0.06)";
    this.ctx.beginPath();
    this.ctx.arc(width * 0.14, height * 0.12, width * 0.16, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = "rgba(255, 214, 102, 0.05)";
    this.ctx.beginPath();
    this.ctx.arc(width * 0.84, height * 0.1, width * 0.14, 0, Math.PI * 2);
    this.ctx.fill();
  }

  drawStars(viewport) {
    this.ctx.fillStyle = "#ffffff";
    for (const star of this.starField) {
      const point = this.worldToScreen(viewport, star.x, star.y);
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, star.radius, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  drawGrid(viewport) {
    this.ctx.strokeStyle = COLORS.grid;
    this.ctx.lineWidth = 1;
    for (let x = 0; x <= this.world.width; x += this.config.world.grid_spacing) {
      const start = this.worldToScreen(viewport, x, 0);
      const end = this.worldToScreen(viewport, x, this.world.height);
      this.ctx.beginPath();
      this.ctx.moveTo(start.x, start.y);
      this.ctx.lineTo(end.x, end.y);
      this.ctx.stroke();
    }

    for (let y = 0; y <= this.world.height; y += this.config.world.grid_spacing) {
      const start = this.worldToScreen(viewport, 0, y);
      const end = this.worldToScreen(viewport, this.world.width, y);
      this.ctx.beginPath();
      this.ctx.moveTo(start.x, start.y);
      this.ctx.lineTo(end.x, end.y);
      this.ctx.stroke();
    }
  }

  drawControlFrame(viewport) {
    const bounds = this.world.controlBounds;
    const topLeft = this.worldToScreen(viewport, bounds.minX, bounds.minY);
    const width = bounds.width * viewport.scale;
    const height = bounds.height * viewport.scale;

    this.ctx.save();
    this.ctx.strokeStyle = COLORS.controlFrame;
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([8, 8]);
    this.roundRect(topLeft.x, topLeft.y, width, height, 14, false, true);
    this.ctx.restore();
  }

  drawTrail(viewport, object) {
    if (object.trail.length < 2) {
      return;
    }

    this.ctx.strokeStyle = rgbaFromRgb(object.color, COLORS.trailAlpha);
    this.ctx.lineWidth = 2;
    for (let index = 0; index < object.trail.length - 1; index += 1) {
      const start = this.worldToScreen(viewport, object.trail[index][0], object.trail[index][1]);
      const end = this.worldToScreen(viewport, object.trail[index + 1][0], object.trail[index + 1][1]);
      if (Math.abs(start.x - end.x) > viewport.width * 0.5) {
        continue;
      }
      if (Math.abs(start.y - end.y) > viewport.height * 0.5) {
        continue;
      }
      this.ctx.beginPath();
      this.ctx.moveTo(start.x, start.y);
      this.ctx.lineTo(end.x, end.y);
      this.ctx.stroke();
    }
  }

  drawObject(viewport, object) {
    const point = this.worldToScreen(viewport, object.x, object.y);
    const radius = Math.max(4, object.radius * viewport.scale);

    if (object.isEgo) {
      this.drawSatellite(point, radius, object.headingRad, object.color);
    } else {
      this.ctx.fillStyle = `rgb(${object.color.join(",")})`;
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }

    if (this.showVectors && object.speed > 0.1) {
      this.ctx.strokeStyle = `rgb(${object.color.join(",")})`;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(point.x, point.y);
      this.ctx.lineTo(
        point.x + object.vx * viewport.scale * 0.8,
        point.y + object.vy * viewport.scale * 0.8,
      );
      this.ctx.stroke();
    }

    if (this.showLabels) {
      this.ctx.fillStyle = COLORS.textPrimary;
      this.ctx.font = '13px "IBM Plex Sans", sans-serif';
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "bottom";
      this.ctx.fillText(`${object.name} [${object.objectClass}]`, point.x, point.y - radius - 8);
    }
  }

  drawSatellite(point, radius, heading, color) {
    const polygon = [
      [point.x + Math.cos(heading) * radius * 1.6, point.y + Math.sin(heading) * radius * 1.6],
      [point.x + Math.cos(heading + 2.45) * radius * 1.2, point.y + Math.sin(heading + 2.45) * radius * 1.2],
      [point.x + Math.cos(heading - 2.45) * radius * 1.2, point.y + Math.sin(heading - 2.45) * radius * 1.2],
    ];

    this.ctx.fillStyle = `rgb(${color.join(",")})`;
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.96)";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(polygon[0][0], polygon[0][1]);
    this.ctx.lineTo(polygon[1][0], polygon[1][1]);
    this.ctx.lineTo(polygon[2][0], polygon[2][1]);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
  }

  renderLegend() {
    this.legendList.innerHTML = "";
    for (const [className, style] of Object.entries(this.config.class_styles)) {
      const item = document.createElement("div");
      item.className = "legend-item";
      item.innerHTML = `
        <div class="legend-label">
          <span class="swatch" style="background: rgb(${style.color.join(",")})"></span>
          <span>${style.label}</span>
        </div>
        <span class="entity-meta">${className}</span>
      `;
      this.legendList.appendChild(item);
    }
  }

  setControlMode(mode, options = {}) {
    const { syncSelect = true, resetMotion = false } = options;
    const nextMode = mode === "greedy" ? "greedy" : "player";
    this.currentMode = nextMode;

    if (syncSelect && this.modeSelect) {
      this.modeSelect.value = nextMode;
    }

    if (!this.world) {
      return;
    }

    this.nextPilotActionTime = this.world.simTime;

    if (nextMode === "player" && resetMotion) {
      this.world.stopEgo();
    }

    if (nextMode === "greedy") {
      this.applyGreedyControl();
    }

    this.syncStatusUI();
    this.refreshSidebar(true);
  }

  applyGreedyControl() {
    if (!this.world || this.world.battery <= 0 || this.world.missionEnded) {
      return;
    }

    if (this.world.simTime + 1e-6 < this.nextPilotActionTime) {
      return;
    }

    const nextCommand = this.chooseGreedyCommand();
    if (nextCommand !== null) {
      this.world.setEgoMotion(nextCommand.direction, nextCommand.speedLevelIndex);
      this.nextPilotActionTime = this.world.simTime + this.world.egoControl.actionIntervalMs / 1000;
    }
  }

  chooseGreedyCommand() {
    const ego = this.world.ego;
    let nearestDanger = null;
    let nearestCollectable = null;

    for (const object of this.world.activeObjects) {
      const deltaX = shortestAxisDelta(ego.x, object.x, this.world.width);
      const deltaY = shortestAxisDelta(ego.y, object.y, this.world.height);
      const distance = Math.hypot(deltaX, deltaY);
      const candidate = { object, deltaX, deltaY, distance };

      if (object.objectClass === "dangerous_debris") {
        if (nearestDanger === null || distance < nearestDanger.distance) {
          nearestDanger = candidate;
        }
      } else if (object.objectClass === "collectable_debris") {
        if (nearestCollectable === null || distance < nearestCollectable.distance) {
          nearestCollectable = candidate;
        }
      }
    }

    const escapeRadius = Math.min(this.world.controlBounds.width, this.world.controlBounds.height) * 0.38;
    if (nearestDanger !== null && nearestDanger.distance <= escapeRadius) {
      return {
        direction: this.resolveAxisDirection(-nearestDanger.deltaX, -nearestDanger.deltaY),
        speedLevelIndex: this.world.egoControl.speedLevels.length - 1,
      };
    }

    if (nearestCollectable !== null) {
      return {
        direction: this.resolveAxisDirection(nearestCollectable.deltaX, nearestCollectable.deltaY),
        speedLevelIndex: this.resolveGreedySpeedLevel(nearestCollectable.distance),
      };
    }

    return null;
  }

  resolveGreedySpeedLevel(distance) {
    if (distance >= this.world.egoControl.threatClearRadius) {
      return this.world.egoControl.speedLevels.length - 1;
    }
    if (distance >= this.world.egoControl.threatRadius * 0.6) {
      return Math.min(1, this.world.egoControl.speedLevels.length - 1);
    }
    return 0;
  }

  // The greedy controller stays intentionally simple: one axis at a time,
  // avoid nearby dangerous debris first, otherwise head toward the closest collectable.
  resolveAxisDirection(deltaX, deltaY) {
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
      return this.world.egoDirection ?? "right";
    }

    if (Math.abs(deltaX) >= Math.abs(deltaY)) {
      return deltaX >= 0 ? "right" : "left";
    }

    return deltaY >= 0 ? "down" : "up";
  }

  issuePlayerAction(direction) {
    if (!this.world || this.currentMode !== "player" || this.world.missionEnded) {
      return;
    }

    if (this.world.battery <= 0 || this.world.simTime + 1e-6 < this.nextPilotActionTime) {
      return;
    }

    this.world.applyPlayerAction(direction);
    this.nextPilotActionTime = this.world.simTime + this.world.egoControl.actionIntervalMs / 1000;
    this.refreshSidebar(true);
  }

  showMissionSummary() {
    if (!this.world?.missionEnded) {
      return;
    }

    this.missionSummary.title.textContent = "Mission Complete";
    this.missionSummary.reason.textContent = this.world.missionEndReason ?? "Mission ended";
    this.missionSummary.score.textContent = `${this.world.score}`;
    this.missionSummary.duration.textContent = `${Math.min(this.world.simTime, this.world.mission.durationLimitS).toFixed(1)} s`;
    this.missionSummary.energy.textContent = `${this.world.energyUsed.toFixed(1)}%`;
    this.missionSummary.sobriety.textContent = `+${this.world.sobrietyBonus}`;
    this.missionSummary.collected.textContent = `${this.world.metrics.collected}`;
    this.missionSummary.avoided.textContent = `${this.world.metrics.avoided}`;
    this.missionSummary.missed.textContent = `${this.world.metrics.missed}`;
    this.missionSummary.root.hidden = false;
  }

  hideMissionSummary() {
    this.missionSummary.root.hidden = true;
  }

  refreshSidebar(force = false) {
    if (!this.world) {
      return;
    }

    const commandCooldown = Math.max(0, this.nextPilotActionTime - this.world.simTime);
    const egoState = this.world.missionEnded && this.world.missionEndReason !== null
      ? this.world.missionEndReason
      : this.world.battery <= 0
      ? "Battery depleted"
      : this.world.egoDirection === null
      ? "Stopped"
      : `Moving ${this.world.egoDirection}`;
    const egoSpeed = this.world.currentEgoSpeed;

    this.stats.status.textContent = this.world.missionEnded
      ? "Mission Complete"
      : this.isPaused
      ? "Paused"
      : "Running";
    this.stats.time.textContent = `${Math.min(this.world.simTime, this.world.mission.durationLimitS).toFixed(1)} s / ${this.world.mission.durationLimitS}s`;
    this.stats.fps.textContent = `${this.fps.toFixed(1)} FPS`;
    this.stats.objects.textContent = `${this.world.allObjects.length}`;
    this.stats.worldSize.textContent = `${this.world.width} x ${this.world.height}`;
    this.stats.scenario.textContent = this.currentScenarioKey === "default" ? "Default" : "Custom";
    this.stats.mode.textContent = this.currentMode === "player" ? "Player" : "Greedy";
    this.stats.command.textContent = this.world.missionEnded
      ? "Mission ended"
      : commandCooldown <= 0.05
      ? "Ready"
      : `${commandCooldown.toFixed(1)} s`;
    this.stats.egoState.textContent = egoState;
    this.stats.egoSpeed.textContent = `${egoSpeed.toFixed(0)} px/s`;
    this.stats.battery.textContent = `${this.world.battery.toFixed(1)}%`;
    this.stats.energyUsed.textContent = `${this.world.energyUsed.toFixed(1)}%`;
    this.stats.collected.textContent = `${this.world.metrics.collected}`;
    this.stats.avoided.textContent = `${this.world.metrics.avoided}`;
    this.stats.missed.textContent = `${this.world.metrics.missed}`;
    this.stats.sobriety.textContent = `+${this.world.sobrietyBonus}`;
    this.stats.score.textContent = `${this.world.score}`;

    if (!force && this.entityList.children.length === this.world.allObjects.length) {
      for (const [index, object] of this.world.allObjects.entries()) {
        const item = this.entityList.children[index];
        item.querySelector(".entity-meta").textContent = `${object.speed.toFixed(1)} px/s`;
      }
      return;
    }

    this.entityList.innerHTML = "";
    for (const object of this.world.allObjects) {
      const item = document.createElement("div");
      item.className = "entity-item";
      item.innerHTML = `
        <div class="entity-label">
          <span class="swatch" style="background: rgb(${object.color.join(",")})"></span>
          <span>${object.name}</span>
        </div>
        <span class="entity-meta">${object.speed.toFixed(1)} px/s</span>
      `;
      this.entityList.appendChild(item);
    }
  }

  syncStatusUI() {
    const status = this.world?.missionEnded
      ? "Mission Complete"
      : this.isPaused
      ? "Paused"
      : "Running";
    this.statusBadge.textContent = status;
    this.stats.status.textContent = status;
    this.pauseButton.disabled = this.world?.missionEnded ?? false;
    this.pauseButton.textContent = this.world?.missionEnded ? "Pause" : this.isPaused ? "Resume" : "Pause";
  }

  roundRect(x, y, width, height, radius, fill, stroke) {
    this.ctx.beginPath();
    this.ctx.moveTo(x + radius, y);
    this.ctx.lineTo(x + width - radius, y);
    this.ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    this.ctx.lineTo(x + width, y + height - radius);
    this.ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    this.ctx.lineTo(x + radius, y + height);
    this.ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    this.ctx.lineTo(x, y + radius);
    this.ctx.quadraticCurveTo(x, y, x + radius, y);
    this.ctx.closePath();
    if (fill) {
      this.ctx.fill();
    }
    if (stroke) {
      this.ctx.stroke();
    }
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  const app = new CanvasSimulationApp();
  try {
    await app.init();
  } catch (error) {
    console.error(error);
    document.body.innerHTML = `
      <main style="padding: 32px; font-family: IBM Plex Sans, sans-serif; color: white; background: #08101f;">
        <h1>Unable to start the web simulation</h1>
        <p>${error.message}</p>
      </main>
    `;
  }
});
