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
  radarFrame: "rgba(255, 214, 102, 0.24)",
  radarRing: "rgba(255, 214, 102, 0.18)",
  radarBeam: "rgba(255, 214, 102, 0.16)",
  radarBeamEdge: "rgba(255, 214, 102, 0.75)",
  radarBlip: "#ffd666",
  track: "#56d6ff",
  trackTrail: "rgba(86, 214, 255, 0.3)",
  uncertainty: "rgba(255, 255, 255, 0.18)",
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

function normalizeAngleDeg(angle) {
  let normalized = angle % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

function angularDifferenceDeg(from, to) {
  let delta = normalizeAngleDeg(to) - normalizeAngleDeg(from);
  if (delta > 180) {
    delta -= 360;
  } else if (delta < -180) {
    delta += 360;
  }
  return delta;
}

function radToDeg(angle) {
  return angle * 180 / Math.PI;
}

function degToRad(angle) {
  return angle * Math.PI / 180;
}

function qualityLabel(quality) {
  if (quality >= 0.74) {
    return "high";
  }
  if (quality >= 0.48) {
    return "medium";
  }
  return "low";
}

function categoryLabel(category) {
  switch (category) {
    case "hazard_debris":
      return "Hazard";
    case "target_debris":
      return "Target";
    case "neutral_debris":
    default:
      return "Neutral";
  }
}

function categoryColor(category) {
  switch (category) {
    case "hazard_debris":
      return "rgba(255, 107, 107, 0.95)";
    case "target_debris":
      return "rgba(255, 214, 102, 0.95)";
    case "neutral_debris":
    default:
      return "rgba(134, 239, 172, 0.95)";
  }
}

class SpaceObject {
  constructor(config, style, isEgo = false) {
    this.name = config.name;
    this.objectClass = config.object_class;
    this.trueCategory = config.true_category ?? (config.object_class === "dangerous_debris"
      ? "hazard_debris"
      : config.object_class === "collectable_debris"
      ? "target_debris"
      : "neutral_debris");
    this.physicalSize = config.physical_size ?? (
      this.trueCategory === "hazard_debris"
        ? 1.45
        : this.trueCategory === "target_debris"
        ? 1.05
        : 0.72
    );
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

class KalmanAxis {
  constructor(position, measurementVariance) {
    this.position = position;
    this.velocity = 0;
    this.p00 = measurementVariance;
    this.p01 = 0;
    this.p10 = 0;
    this.p11 = measurementVariance;
  }

  predict(dt, processVariance) {
    this.position += this.velocity * dt;

    // Constant-velocity model with white-acceleration process noise.
    // This keeps covariance growth tied to the elapsed time instead of
    // inflating too aggressively at every rendered frame.
    const q00 = 0.25 * dt * dt * dt * dt * processVariance;
    const q01 = 0.5 * dt * dt * dt * processVariance;
    const q11 = dt * dt * processVariance;

    const p00 = this.p00 + dt * (this.p10 + this.p01) + dt * dt * this.p11 + q00;
    const p01 = this.p01 + dt * this.p11 + q01;
    const p10 = this.p10 + dt * this.p11 + q01;
    const p11 = this.p11 + q11;

    this.p00 = p00;
    this.p01 = p01;
    this.p10 = p10;
    this.p11 = p11;
  }

  update(measurement, measurementVariance) {
    const innovation = measurement - this.position;
    const s = this.p00 + measurementVariance;
    const k0 = this.p00 / s;
    const k1 = this.p10 / s;

    this.position += k0 * innovation;
    this.velocity += k1 * innovation;

    const p00 = (1 - k0) * this.p00;
    const p01 = (1 - k0) * this.p01;
    const p10 = this.p10 - k1 * this.p00;
    const p11 = this.p11 - k1 * this.p01;

    this.p00 = p00;
    this.p01 = p01;
    this.p10 = p10;
    this.p11 = p11;
  }
}

class Track {
  constructor(objectName, detection, trackingConfig) {
    this.objectName = objectName;
    this.id = `TRK-${objectName}`;
    this.history = [];
    this.detectionHistory = [];
    this.trackingConfig = trackingConfig;
    this.axisX = new KalmanAxis(detection.x, trackingConfig.initialMeasurementVariance);
    this.axisY = new KalmanAxis(detection.y, trackingConfig.initialMeasurementVariance);
    this.age = 0;
    this.timeSinceUpdate = 0;
    this.lastRange = detection.range;
    this.lastBearingDeg = detection.bearingDeg;
    this.estimatedCategory = "unknown";
    this.confidence = 0;
    this.observationQuality = 0;
    this.observationLabel = "low";
    this.lastTruthCategory = null;
    this.lastDetectionX = detection.x;
    this.lastDetectionY = detection.y;
    this.detectionCount = 0;
    this.updateClassification(detection.classification);
    this.pushDetection(detection.x, detection.y, detection.classification.estimatedCategory);
    this.pushHistory();
  }

  predict(dt) {
    this.age += dt;
    this.timeSinceUpdate += dt;
    this.axisX.predict(dt, this.trackingConfig.processVariance);
    this.axisY.predict(dt, this.trackingConfig.processVariance);
    this.pushHistory();
  }

  applyDetection(detection) {
    this.axisX.update(detection.x, this.trackingConfig.measurementVariance);
    this.axisY.update(detection.y, this.trackingConfig.measurementVariance);
    this.timeSinceUpdate = 0;
    this.lastRange = detection.range;
    this.lastBearingDeg = detection.bearingDeg;
    this.lastDetectionX = detection.x;
    this.lastDetectionY = detection.y;
    this.updateClassification(detection.classification);
    this.pushDetection(detection.x, detection.y, detection.classification.estimatedCategory);
    this.pushHistory();
  }

  updateClassification(classification) {
    this.estimatedCategory = classification.estimatedCategory;
    this.confidence = classification.confidence;
    this.observationQuality = classification.observationQuality;
    this.observationLabel = classification.observationLabel;
    this.lastTruthCategory = classification.trueCategory;
  }

  pushHistory() {
    this.history.push([this.x, this.y]);
    if (this.history.length > 60) {
      this.history.shift();
    }
  }

  pushDetection(x, y, estimatedCategory) {
    this.detectionCount += 1;
    this.detectionHistory.push({
      x,
      y,
      estimatedCategory,
    });
    if (this.detectionHistory.length > 5) {
      this.detectionHistory.shift();
    }
  }

  get x() {
    return this.axisX.position;
  }

  get y() {
    return this.axisY.position;
  }

  get vx() {
    return this.axisX.velocity;
  }

  get vy() {
    return this.axisY.velocity;
  }

  get range() {
    return Math.hypot(this.x, this.y);
  }

  get bearingDeg() {
    return normalizeAngleDeg(radToDeg(Math.atan2(this.y, this.x)));
  }

  get sigma() {
    return Math.sqrt(Math.max(this.axisX.p00 + this.axisY.p00, 1));
  }

  predictedDisplayPoint(lookaheadS = 2.4) {
    return {
      x: this.lastDetectionX + this.vx * lookaheadS,
      y: this.lastDetectionY + this.vy * lookaheadS,
    };
  }

  currentEstimatePoint() {
    return {
      x: this.x,
      y: this.y,
    };
  }

  get headingRad() {
    if (Math.hypot(this.vx, this.vy) < 1e-6) {
      return 0;
    }
    return Math.atan2(this.vy, this.vx);
  }

  predictionHorizonS(scanRateDegS) {
    const revisitIntervalS = 360 / scanRateDegS;
    return Math.max(0.9, revisitIntervalS - this.timeSinceUpdate);
  }

  trackStatus(scanRateDegS) {
    const revisitIntervalS = 360 / scanRateDegS;
    if (this.timeSinceUpdate <= revisitIntervalS * 0.6) {
      return "fresh";
    }
    if (this.timeSinceUpdate <= revisitIntervalS * 1.6) {
      return "coasting";
    }
    return "stale";
  }
}

class TrackManager {
  constructor(config) {
    this.trackingConfig = {
      processVariance: config?.process_variance ?? 8,
      measurementVariance: config?.measurement_variance ?? 18,
      initialMeasurementVariance: config?.initial_measurement_variance ?? 36,
    };
    this.tracks = new Map();
  }

  reset() {
    this.tracks.clear();
  }

  predict(dt) {
    for (const track of this.tracks.values()) {
      track.predict(dt);
    }
  }

  applyDetections(detections) {
    for (const detection of detections) {
      const existing = this.tracks.get(detection.objectName);
      if (existing) {
        existing.applyDetection(detection);
      } else {
        this.tracks.set(
          detection.objectName,
          new Track(detection.objectName, detection, this.trackingConfig),
        );
      }
    }
  }

  get orderedTracks() {
    return [...this.tracks.values()].sort((left, right) => left.range - right.range);
  }
}

class VisionClassifier {
  constructor(config) {
    this.config = {
      fullQualityRange: config?.full_quality_range ?? 140,
      degradedQualityRange: config?.degraded_quality_range ?? 340,
      minConfidence: config?.min_confidence ?? 0.24,
      maxConfidence: config?.max_confidence ?? 0.95,
      ambiguityNoiseScale: config?.ambiguity_noise_scale ?? 0.38,
    };
  }

  classify(object, distance, random) {
    const quality = this.computeObservationQuality(distance);
    const noiseAmplitude = (1 - quality) * this.config.ambiguityNoiseScale;
    const apparentSize = object.physicalSize + (random() * 2 - 1) * noiseAmplitude;
    const estimatedCategory = this.classifySize(apparentSize);
    const confidenceSpan = this.config.maxConfidence - this.config.minConfidence;
    const thresholdDistance = Math.min(
      Math.abs(apparentSize - 0.75),
      Math.abs(apparentSize - 2.1),
    );
    const boundaryBoost = clamp(thresholdDistance / 0.45, 0, 1);
    const confidence = clamp(
      this.config.minConfidence + confidenceSpan * (0.35 + 0.65 * quality) * (0.45 + 0.55 * boundaryBoost),
      this.config.minConfidence,
      this.config.maxConfidence,
    );

    return {
      estimatedCategory,
      confidence,
      observationQuality: quality,
      observationLabel: qualityLabel(quality),
      trueCategory: object.trueCategory,
    };
  }

  computeObservationQuality(distance) {
    if (distance <= this.config.fullQualityRange) {
      return 1;
    }
    if (distance >= this.config.degradedQualityRange) {
      return 0.2;
    }
    const ratio = (distance - this.config.fullQualityRange)
      / (this.config.degradedQualityRange - this.config.fullQualityRange);
    return clamp(1 - ratio * 0.8, 0.2, 1);
  }

  classifySize(apparentSize) {
    if (apparentSize >= 2.1) {
      return "hazard_debris";
    }
    if (apparentSize >= 0.75) {
      return "target_debris";
    }
    return "neutral_debris";
  }
}

class RadarSensor {
  constructor(config, classifier, tracking) {
    this.config = {
      maxRange: config?.max_range ?? 360,
      scanRateDegS: config?.scan_rate_deg_s ?? 90,
      beamWidthDeg: config?.beam_width_deg ?? 14,
      rangeNoiseStd: config?.range_noise_std ?? 4,
      bearingNoiseStdDeg: config?.bearing_noise_std_deg ?? 1.6,
      seed: config?.seed ?? 42,
    };
    this.classifier = classifier;
    this.trackManager = new TrackManager(tracking);
    this.random = mulberry32(this.config.seed);
    this.scanAngleDeg = 0;
    this.lastDetectionCount = 0;
    this.lastDetectionTimes = new Map();
    this.recentDetections = [];
  }

  reset() {
    this.trackManager.reset();
    this.random = mulberry32(this.config.seed);
    this.scanAngleDeg = 0;
    this.lastDetectionCount = 0;
    this.lastDetectionTimes.clear();
    this.recentDetections = [];
  }

  update(dt, world) {
    this.scanAngleDeg = normalizeAngleDeg(this.scanAngleDeg + this.config.scanRateDegS * dt);
    this.trackManager.predict(dt);
    const revisitIntervalS = (360 / this.config.scanRateDegS) * 0.82;

    const detections = [];
    for (const object of world.activeObjects) {
      const relativeX = shortestAxisDelta(world.ego.x, object.x, world.width);
      const relativeY = shortestAxisDelta(world.ego.y, object.y, world.height);
      const range = Math.hypot(relativeX, relativeY);

      if (range > this.config.maxRange) {
        continue;
      }

      const bearingDeg = normalizeAngleDeg(radToDeg(Math.atan2(relativeY, relativeX)));
      if (Math.abs(angularDifferenceDeg(this.scanAngleDeg, bearingDeg)) > this.config.beamWidthDeg / 2) {
        continue;
      }
      const lastDetectionTime = this.lastDetectionTimes.get(object.name);
      if (lastDetectionTime !== undefined && (world.simTime - lastDetectionTime) < revisitIntervalS) {
        continue;
      }

      const measuredRange = Math.max(0, range + this.gaussianNoise(this.config.rangeNoiseStd));
      const measuredBearingDeg = normalizeAngleDeg(
        bearingDeg + this.gaussianNoise(this.config.bearingNoiseStdDeg),
      );
      const measuredBearingRad = degToRad(measuredBearingDeg);
      const measuredX = Math.cos(measuredBearingRad) * measuredRange;
      const measuredY = Math.sin(measuredBearingRad) * measuredRange;
      const classification = this.classifier.classify(object, range, this.random);

      const detection = {
        objectName: object.name,
        range: measuredRange,
        bearingDeg: measuredBearingDeg,
        x: measuredX,
        y: measuredY,
        classification,
      };
      detections.push(detection);
      this.lastDetectionTimes.set(object.name, world.simTime);
    }
    this.lastDetectionCount = detections.length;
    this.recentDetections = detections;
    this.trackManager.applyDetections(detections);
  }

  gaussianNoise(std) {
    if (std <= 0) {
      return 0;
    }

    const u1 = Math.max(this.random(), 1e-9);
    const u2 = this.random();
    const magnitude = Math.sqrt(-2 * Math.log(u1));
    return std * magnitude * Math.cos(2 * Math.PI * u2);
  }
}

class SimulationWorld {
  constructor(config) {
    this.width = config.world.width;
    this.height = config.world.height;
    this.timeScale = config.world.time_scale ?? 1;
    this.simTime = 0;
    this.classStyles = config.class_styles;
    this.egoControl = {
      showFrame: config.ego_control?.show_frame ?? true,
    };
    this.mission = {
      durationLimitS: config.mission?.duration_limit_s ?? 180,
    };
    this.ego = new SpaceObject(config.ego, this.classStyles[config.ego.object_class], true);
    this.objects = config.objects.map((item) => new SpaceObject(item, this.classStyles[item.object_class]));
    this.missionEnded = false;
    this.missionEndReason = null;
    this.classifier = new VisionClassifier(config.classification);
    this.radar = new RadarSensor(config.radar, this.classifier, config.tracking);
  }

  get allObjects() {
    return [this.ego, ...this.activeObjects];
  }

  get activeObjects() {
    return this.objects.filter((object) => object.active);
  }

  get currentEgoSpeed() {
    return 0;
  }

  get energyUsed() {
    return 0;
  }

  get sobrietyBonus() {
    return 0;
  }

  get score() {
    return 0;
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
    this.radar.update(dt, this);
    this.evaluateMissionState();
  }

  updateEgo(dt) {
    this.ego.vx = 0;
    this.ego.vy = 0;
    this.ego.trail = [[this.ego.x, this.ego.y]];
    void dt;
  }

  evaluateMissionState() {
    if (this.simTime >= this.mission.durationLimitS) {
      this.endMission("Run complete");
    }
  }

  endMission(reason) {
    if (this.missionEnded) {
      return;
    }

    this.missionEnded = true;
    this.missionEndReason = reason;
  }
}

class CanvasSimulationApp {
  constructor() {
    this.truthCanvas = document.getElementById("truth-canvas");
    this.truthCtx = this.truthCanvas.getContext("2d");
    this.radarTruthCanvas = document.getElementById("radar-truth-canvas");
    this.radarTruthCtx = this.radarTruthCanvas.getContext("2d");
    this.radarCanvas = document.getElementById("radar-canvas");
    this.radarCtx = this.radarCanvas.getContext("2d");
    this.pauseButton = document.getElementById("pause-button");
    this.resetButton = document.getElementById("reset-button");
    this.scenarioSelect = document.getElementById("scenario-select");
    this.trackSelect = document.getElementById("track-select");
    this.statusBadge = document.getElementById("status-badge");
    this.radarQualityBadge = document.getElementById("radar-quality-badge");
    this.truthLegend = document.getElementById("truth-legend");
    this.radarLegend = document.getElementById("radar-legend");
    this.legendList = document.getElementById("legend-list");
    this.radarLog = document.getElementById("radar-log");
    this.trackMetrics = document.getElementById("track-metrics");
    this.statusSummary = document.getElementById("status-summary");
    this.currentScenarioKey = "default";
    this.config = null;
    this.world = null;
    this.starField = [];
    this.detectionLog = [];
    this.radarTruthEchoes = new Map();
    this.selectedTrackName = null;
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

    this.scenarioSelect.addEventListener("change", async (event) => {
      await this.loadScenario(event.target.value);
    });

    this.trackSelect.addEventListener("change", (event) => {
      this.selectedTrackName = event.target.value || null;
      this.refreshPanels(true);
    });

    window.addEventListener("keydown", async (event) => {
      if (event.repeat) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        this.isPaused = !this.isPaused;
        this.syncStatusUI();
      } else if (event.key === "Tab") {
        event.preventDefault();
        this.cycleSelectedTrack(1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        this.cycleSelectedTrack(-1);
      } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        this.cycleSelectedTrack(1);
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

    window.addEventListener("resize", () => this.resizeCanvases());
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
    this.detectionLog = [];
    this.radarTruthEchoes.clear();
    this.selectedTrackName = null;
    this.renderLegends();
    this.syncStatusUI();
    this.resizeCanvases();
    this.refreshPanels(true);
  }

  resetScenario() {
    if (!this.config) {
      return;
    }
    this.world = new SimulationWorld(this.config);
    this.isPaused = false;
    this.lastFrameTime = null;
    this.detectionLog = [];
    this.radarTruthEchoes.clear();
    this.selectedTrackName = null;
    this.syncStatusUI();
    this.refreshPanels(true);
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

  resizeCanvases() {
    this.resizeCanvas(this.truthCanvas, this.truthCtx);
    this.resizeCanvas(this.radarTruthCanvas, this.radarTruthCtx);
    this.resizeCanvas(this.radarCanvas, this.radarCtx);
  }

  measureCanvas(canvas) {
    const host = canvas.parentElement;
    const rect = host ? host.getBoundingClientRect() : canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    return { width, height };
  }

  resizeCanvas(canvas, ctx) {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.measureCanvas(canvas);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
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
      const simElapsed = elapsed * this.world.timeScale;
      this.world.update(simElapsed);
      this.ingestRadarState(simElapsed);
      if (this.world.missionEnded) {
        this.isPaused = true;
        this.syncStatusUI();
      }
    }

    this.frameCounter += 1;
    if (timestamp - this.fpsSampleTime >= 500) {
      this.fps = (this.frameCounter * 1000) / (timestamp - this.fpsSampleTime);
      this.frameCounter = 0;
      this.fpsSampleTime = timestamp;
    }

    this.drawTruthView();
    this.drawRadarTruthView();
    this.drawRadarView();
    if (timestamp - this.lastPanelRefresh > 180) {
      this.refreshPanels();
      this.lastPanelRefresh = timestamp;
    }
  }

  ingestRadarState(dt) {
    for (const [name, echo] of this.radarTruthEchoes.entries()) {
      echo.ttl -= dt;
      if (echo.ttl <= 0) {
        this.radarTruthEchoes.delete(name);
      }
    }

    for (const detection of this.world.radar.recentDetections) {
      const source = this.world.objects.find((object) => object.name === detection.objectName);
      this.detectionLog.push({
        simTime: this.world.simTime,
        objectName: detection.objectName,
        measuredRange: detection.range,
        measuredBearingDeg: detection.bearingDeg,
        estimatedCategory: detection.classification.estimatedCategory,
      });
      if (this.detectionLog.length > 18) {
        this.detectionLog.shift();
      }

      if (source) {
        this.radarTruthEchoes.set(detection.objectName, {
          x: source.x,
          y: source.y,
          estimatedCategory: detection.classification.estimatedCategory,
          ttl: 5,
          maxTtl: 5,
        });
      }
    }
  }

  syncSelectedTrack() {
    const trackNames = this.world ? this.world.radar.trackManager.orderedTracks.map((track) => track.objectName) : [];
    if (trackNames.length === 0) {
      this.selectedTrackName = null;
      this.trackSelect.innerHTML = '<option value="">Auto</option>';
      return;
    }

    if (!trackNames.includes(this.selectedTrackName)) {
      this.selectedTrackName = trackNames[0];
    }

    const previousValue = this.trackSelect.value;
    this.trackSelect.innerHTML = "";
    for (const trackName of trackNames) {
      const option = document.createElement("option");
      option.value = trackName;
      option.textContent = trackName;
      if (trackName === this.selectedTrackName) {
        option.selected = true;
      }
      this.trackSelect.appendChild(option);
    }
    if (previousValue && trackNames.includes(previousValue)) {
      this.trackSelect.value = previousValue;
      this.selectedTrackName = previousValue;
    }
  }

  cycleSelectedTrack(step) {
    if (!this.world) {
      return;
    }
    const trackNames = this.world.radar.trackManager.orderedTracks.map((track) => track.objectName);
    if (trackNames.length === 0) {
      return;
    }
    const currentIndex = Math.max(0, trackNames.indexOf(this.selectedTrackName));
    const nextIndex = (currentIndex + step + trackNames.length) % trackNames.length;
    this.selectedTrackName = trackNames[nextIndex];
    this.trackSelect.value = this.selectedTrackName;
    this.refreshPanels(true);
  }

  get selectedTrack() {
    if (!this.world || this.selectedTrackName === null) {
      return null;
    }
    return this.world.radar.trackManager.orderedTracks.find((track) => track.objectName === this.selectedTrackName) ?? null;
  }

  computeViewport(canvas, worldWidth, worldHeight) {
    const { width, height } = this.measureCanvas(canvas);
    const padding = 22;
    const renderWidth = width - padding * 2;
    const renderHeight = height - padding * 2;
    const scale = Math.min(renderWidth / worldWidth, renderHeight / worldHeight);
    const worldPixelWidth = worldWidth * scale;
    const worldPixelHeight = worldHeight * scale;
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

  drawTruthView() {
    this.drawWorldPanel(this.truthCanvas, this.truthCtx, {
      filteredToRadar: false,
      showStars: true,
    });
  }

  drawRadarTruthView() {
    this.drawWorldPanel(this.radarTruthCanvas, this.radarTruthCtx, {
      filteredToRadar: true,
      showStars: false,
    });
  }

  drawWorldPanel(canvas, ctx, options) {
    const { filteredToRadar, showStars } = options;
    const { width, height } = this.measureCanvas(canvas);
    const viewport = this.computeViewport(canvas, this.world.width, this.world.height);

    ctx.clearRect(0, 0, width, height);
    this.drawBackground(ctx, width, height);
    if (showStars) {
      this.drawStars(ctx, viewport);
    }
    if (this.showGrid) {
      this.drawGrid(ctx, viewport);
    }

    ctx.strokeStyle = COLORS.worldFrame;
    ctx.lineWidth = 2;
    this.roundRect(ctx, viewport.originX, viewport.originY, viewport.width, viewport.height, 18, false, true);
    this.drawWorldRadarRanges(ctx, viewport);

    if (filteredToRadar) {
      this.drawRadarTruthMask(ctx, viewport);
      const visibleObjects = [this.world.ego, ...this.visibleRadarObjects()];
      for (const object of visibleObjects) {
        this.drawObject(ctx, viewport, object);
      }
      this.drawRadarTruthEchoes(ctx, viewport);
      return;
    }

    if (this.showTrails) {
      for (const object of this.world.allObjects) {
        this.drawTrail(ctx, viewport, object);
      }
    }

    for (const object of this.world.allObjects) {
      this.drawObject(ctx, viewport, object);
    }
  }

  drawRadarView() {
    const { width, height } = this.measureCanvas(this.radarCanvas);
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.max(70, Math.min(width, height) * 0.38);
    const radar = this.world.radar;

    this.radarCtx.clearRect(0, 0, width, height);
    this.drawBackground(this.radarCtx, width, height);

    this.radarCtx.save();
    this.radarCtx.translate(centerX, centerY);

    for (let ringIndex = 1; ringIndex <= 4; ringIndex += 1) {
      this.radarCtx.strokeStyle = COLORS.radarRing;
      this.radarCtx.lineWidth = 1;
      this.radarCtx.beginPath();
      this.radarCtx.arc(0, 0, radius * ringIndex / 4, 0, Math.PI * 2);
      this.radarCtx.stroke();
    }

    this.radarCtx.strokeStyle = COLORS.radarFrame;
    this.radarCtx.beginPath();
    this.radarCtx.moveTo(-radius, 0);
    this.radarCtx.lineTo(radius, 0);
    this.radarCtx.moveTo(0, -radius);
    this.radarCtx.lineTo(0, radius);
    this.radarCtx.stroke();

    const beamHalfWidth = degToRad(radar.config.beamWidthDeg / 2);
    const beamAngle = degToRad(radar.scanAngleDeg);
    this.radarCtx.fillStyle = COLORS.radarBeam;
    this.radarCtx.beginPath();
    this.radarCtx.moveTo(0, 0);
    this.radarCtx.arc(0, 0, radius, beamAngle - beamHalfWidth, beamAngle + beamHalfWidth);
    this.radarCtx.closePath();
    this.radarCtx.fill();

    this.radarCtx.strokeStyle = COLORS.radarBeamEdge;
    this.radarCtx.lineWidth = 2;
    this.radarCtx.beginPath();
    this.radarCtx.moveTo(0, 0);
    this.radarCtx.lineTo(Math.cos(beamAngle) * radius, Math.sin(beamAngle) * radius);
    this.radarCtx.stroke();

    for (const track of radar.trackManager.orderedTracks) {
      this.drawTrack(track, radius);
    }

    this.radarCtx.fillStyle = COLORS.track;
    this.radarCtx.beginPath();
    this.radarCtx.arc(0, 0, 7, 0, Math.PI * 2);
    this.radarCtx.fill();
    this.radarCtx.strokeStyle = "rgba(255,255,255,0.9)";
    this.radarCtx.lineWidth = 2;
    this.radarCtx.stroke();
    this.radarCtx.restore();

    this.radarCtx.fillStyle = COLORS.textMuted;
    this.radarCtx.font = '13px "IBM Plex Sans", sans-serif';
    this.radarCtx.fillText(`Range scale: 0 - ${radar.config.maxRange.toFixed(0)} px`, 18, height - 22);
  }

  drawTrack(track, radius) {
    const estimatedColor = categoryColor(track.estimatedCategory);
    const anchor = this.radarPoint(track.lastDetectionX, track.lastDetectionY, radius);
    const predictedState = track.currentEstimatePoint();
    const endpoint = this.radarPoint(predictedState.x, predictedState.y, radius);

    if (track.detectionHistory.length >= 2) {
      for (let index = 0; index < track.detectionHistory.length - 1; index += 1) {
        const start = this.radarPoint(track.detectionHistory[index].x, track.detectionHistory[index].y, radius);
        const end = this.radarPoint(track.detectionHistory[index + 1].x, track.detectionHistory[index + 1].y, radius);
        const ageRatio = (index + 1) / track.detectionHistory.length;
        this.radarCtx.save();
        this.radarCtx.strokeStyle = `rgba(255, 214, 102, ${0.22 + ageRatio * 0.42})`;
        this.radarCtx.lineWidth = 1.2 + ageRatio * 1.2;
        this.radarCtx.setLineDash([3 + (1 - ageRatio) * 8, 8 + (1 - ageRatio) * 10]);
        this.radarCtx.beginPath();
        this.radarCtx.moveTo(start.x, start.y);
        this.radarCtx.lineTo(end.x, end.y);
        this.radarCtx.stroke();
        this.radarCtx.restore();
      }
    }

    track.detectionHistory.forEach((measurement, index) => {
      const point = this.radarPoint(measurement.x, measurement.y, radius);
      const ageRatio = (index + 1) / track.detectionHistory.length;
      const size = 2.2 + ageRatio * 2.8;
      const measurementColor = categoryColor(measurement.estimatedCategory);
      const measurementAlpha = 0.22 + ageRatio * 0.58;
      const fillColor = measurementColor.replace("0.95", `${measurementAlpha}`);
      this.radarCtx.fillStyle = fillColor;
      this.radarCtx.beginPath();
      this.radarCtx.rect(point.x - size, point.y - size, size * 2, size * 2);
      this.radarCtx.fill();
    });

    const heading = track.headingRad;
    const cosHeading = Math.cos(heading);
    const sinHeading = Math.sin(heading);
    const varX = Math.max(track.axisX.p00, 1);
    const varY = Math.max(track.axisY.p00, 1);
    const alongTrackSigma = Math.sqrt(varX * cosHeading * cosHeading + varY * sinHeading * sinHeading);
    const crossTrackSigma = Math.sqrt(varX * sinHeading * sinHeading + varY * cosHeading * cosHeading);
    const sigmaMajorPx = clamp((3 * alongTrackSigma / this.world.radar.config.maxRange) * radius, 4, 50);
    const sigmaMinorPx = clamp((3 * crossTrackSigma / this.world.radar.config.maxRange) * radius, 3, 28);

    this.radarCtx.save();
    this.radarCtx.strokeStyle = estimatedColor;
    this.radarCtx.lineWidth = 2;
    this.radarCtx.setLineDash([8, 8]);
    this.radarCtx.beginPath();
    this.radarCtx.moveTo(anchor.x, anchor.y);
    this.radarCtx.lineTo(endpoint.x, endpoint.y);
    this.radarCtx.stroke();
    this.radarCtx.restore();

    this.radarCtx.save();
    this.radarCtx.translate(endpoint.x, endpoint.y);
    this.radarCtx.rotate(heading);
    this.radarCtx.fillStyle = COLORS.uncertainty;
    this.radarCtx.beginPath();
    this.radarCtx.ellipse(0, 0, sigmaMajorPx, sigmaMinorPx, 0, 0, Math.PI * 2);
    this.radarCtx.fill();
    this.radarCtx.strokeStyle = "rgba(255, 255, 255, 0.32)";
    this.radarCtx.lineWidth = 1.5;
    this.radarCtx.stroke();
    this.radarCtx.restore();

    this.radarCtx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    this.radarCtx.lineWidth = 2;
    this.radarCtx.beginPath();
    this.radarCtx.rect(anchor.x - 4, anchor.y - 4, 8, 8);
    this.radarCtx.stroke();

    this.radarCtx.save();
    this.radarCtx.strokeStyle = estimatedColor;
    this.radarCtx.lineWidth = 1.6;
    this.radarCtx.beginPath();
    this.radarCtx.moveTo(endpoint.x - 5, endpoint.y);
    this.radarCtx.lineTo(endpoint.x + 5, endpoint.y);
    this.radarCtx.moveTo(endpoint.x, endpoint.y - 5);
    this.radarCtx.lineTo(endpoint.x, endpoint.y + 5);
    this.radarCtx.stroke();
    this.radarCtx.restore();

    this.radarCtx.fillStyle = COLORS.textPrimary;
    this.radarCtx.font = '12px "IBM Plex Sans", sans-serif';
    this.radarCtx.textAlign = "left";
    this.radarCtx.textBaseline = "bottom";
    this.radarCtx.fillText(
      `${track.id} ${categoryLabel(track.estimatedCategory)} ${Math.round(track.confidence * 100)}%`,
      endpoint.x + 10,
      endpoint.y - 8,
    );
  }

  radarPoint(x, y, radius) {
    const scale = radius / this.world.radar.config.maxRange;
    return {
      x: x * scale,
      y: y * scale,
    };
  }

  drawBackground(ctx, width, height) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#061021");
    gradient.addColorStop(1, "#030712");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "rgba(86, 214, 255, 0.06)";
    ctx.beginPath();
    ctx.arc(width * 0.14, height * 0.12, width * 0.16, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 214, 102, 0.05)";
    ctx.beginPath();
    ctx.arc(width * 0.84, height * 0.1, width * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }

  drawStars(ctx, viewport) {
    ctx.fillStyle = "#ffffff";
    for (const star of this.starField) {
      const point = this.worldToScreen(viewport, star.x, star.y);
      ctx.beginPath();
      ctx.arc(point.x, point.y, star.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawGrid(ctx, viewport) {
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= this.world.width; x += this.config.world.grid_spacing) {
      const start = this.worldToScreen(viewport, x, 0);
      const end = this.worldToScreen(viewport, x, this.world.height);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }

    for (let y = 0; y <= this.world.height; y += this.config.world.grid_spacing) {
      const start = this.worldToScreen(viewport, 0, y);
      const end = this.worldToScreen(viewport, this.world.width, y);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
  }

  drawWorldRadarRanges(ctx, viewport) {
    const center = this.worldToScreen(viewport, this.world.ego.x, this.world.ego.y);
    const maxRangePx = this.world.radar.config.maxRange * viewport.scale;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 214, 102, 0.26)";
    ctx.lineWidth = 1;
    for (let ringIndex = 1; ringIndex <= 4; ringIndex += 1) {
      ctx.beginPath();
      ctx.arc(center.x, center.y, maxRangePx * ringIndex / 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRadarTruthMask(ctx, viewport) {
    const center = this.worldToScreen(viewport, this.world.ego.x, this.world.ego.y);
    const maxRangePx = this.world.radar.config.maxRange * viewport.scale;
    const beamAngle = degToRad(this.world.radar.scanAngleDeg);
    const halfBeam = degToRad(this.world.radar.config.beamWidthDeg / 2);

    ctx.save();
    ctx.fillStyle = "rgba(2, 8, 16, 0.8)";
    ctx.fillRect(viewport.originX, viewport.originY, viewport.width, viewport.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.arc(center.x, center.y, maxRangePx, beamAngle - halfBeam, beamAngle + halfBeam);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(255, 214, 102, 0.08)";
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.arc(center.x, center.y, maxRangePx, beamAngle - halfBeam, beamAngle + halfBeam);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = COLORS.radarBeamEdge;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(
      center.x + Math.cos(beamAngle - halfBeam) * maxRangePx,
      center.y + Math.sin(beamAngle - halfBeam) * maxRangePx,
    );
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(
      center.x + Math.cos(beamAngle + halfBeam) * maxRangePx,
      center.y + Math.sin(beamAngle + halfBeam) * maxRangePx,
    );
    ctx.stroke();
    ctx.restore();
  }

  drawRadarTruthEchoes(ctx, viewport) {
    for (const echo of this.radarTruthEchoes.values()) {
      const point = this.worldToScreen(viewport, echo.x, echo.y);
      const alpha = clamp(echo.ttl / echo.maxTtl, 0, 1);
      const baseRadius = echo.estimatedCategory === "hazard_debris"
        ? 8
        : echo.estimatedCategory === "target_debris"
        ? 6
        : 4;
      ctx.save();
      ctx.fillStyle = categoryColor(echo.estimatedCategory).replace("0.95", `${0.16 + alpha * 0.44}`);
      ctx.beginPath();
      ctx.arc(point.x, point.y, baseRadius + alpha * 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  isObjectVisibleToRadar(object) {
    const relativeX = shortestAxisDelta(this.world.ego.x, object.x, this.world.width);
    const relativeY = shortestAxisDelta(this.world.ego.y, object.y, this.world.height);
    const range = Math.hypot(relativeX, relativeY);
    if (range > this.world.radar.config.maxRange) {
      return false;
    }
    const bearingDeg = normalizeAngleDeg(radToDeg(Math.atan2(relativeY, relativeX)));
    return Math.abs(angularDifferenceDeg(this.world.radar.scanAngleDeg, bearingDeg)) <= this.world.radar.config.beamWidthDeg / 2;
  }

  visibleRadarObjects() {
    return this.world.activeObjects.filter((object) => this.isObjectVisibleToRadar(object));
  }

  drawTrail(ctx, viewport, object) {
    if (object.trail.length < 2) {
      return;
    }

    ctx.strokeStyle = rgbaFromRgb(object.color, COLORS.trailAlpha);
    ctx.lineWidth = 2;
    for (let index = 0; index < object.trail.length - 1; index += 1) {
      const start = this.worldToScreen(viewport, object.trail[index][0], object.trail[index][1]);
      const end = this.worldToScreen(viewport, object.trail[index + 1][0], object.trail[index + 1][1]);
      if (Math.abs(start.x - end.x) > viewport.width * 0.5) {
        continue;
      }
      if (Math.abs(start.y - end.y) > viewport.height * 0.5) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
  }

  drawObject(ctx, viewport, object) {
    const point = this.worldToScreen(viewport, object.x, object.y);
    const radius = Math.max(4, object.radius * viewport.scale);

    if (object.isEgo) {
      this.drawSatellite(ctx, point, radius, object.headingRad, object.color);
    } else {
      ctx.fillStyle = `rgb(${object.color.join(",")})`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (this.showVectors && object.speed > 0.1) {
      ctx.strokeStyle = `rgb(${object.color.join(",")})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(
        point.x + object.vx * viewport.scale * 0.8,
        point.y + object.vy * viewport.scale * 0.8,
      );
      ctx.stroke();
    }

    if (this.showLabels) {
      ctx.fillStyle = COLORS.textPrimary;
      ctx.font = '13px "IBM Plex Sans", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${object.name} [${object.objectClass}]`, point.x, point.y - radius - 8);
    }
  }

  drawSatellite(ctx, point, radius, heading, color) {
    const polygon = [
      [point.x + Math.cos(heading) * radius * 1.6, point.y + Math.sin(heading) * radius * 1.6],
      [point.x + Math.cos(heading + 2.45) * radius * 1.2, point.y + Math.sin(heading + 2.45) * radius * 1.2],
      [point.x + Math.cos(heading - 2.45) * radius * 1.2, point.y + Math.sin(heading - 2.45) * radius * 1.2],
    ];

    ctx.fillStyle = `rgb(${color.join(",")})`;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.96)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(polygon[0][0], polygon[0][1]);
    ctx.lineTo(polygon[1][0], polygon[1][1]);
    ctx.lineTo(polygon[2][0], polygon[2][1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  renderLegends() {
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
    this.truthLegend.innerHTML = `
      <h3>Legend</h3>
      <div class="mini-legend-list">
        <div class="mini-legend-row"><span class="mini-legend-dot" style="background: rgb(86, 214, 255)"></span><span>Ego satellite</span></div>
        <div class="mini-legend-row"><span class="mini-legend-dot" style="background: rgb(255, 107, 107)"></span><span>Dangerous debris</span></div>
        <div class="mini-legend-row"><span class="mini-legend-dot" style="background: rgb(255, 214, 102)"></span><span>Collectable debris</span></div>
        <div class="mini-legend-row"><span class="mini-legend-dot" style="background: rgb(134, 239, 172)"></span><span>Neutral object</span></div>
      </div>
    `;
    this.radarLegend.innerHTML = `
      <h3>Legend</h3>
      <div class="mini-legend-list">
        <div class="mini-legend-row"><span class="mini-legend-square"></span><span>Measured positions</span></div>
        <div class="mini-legend-row"><span class="mini-legend-cross"></span><span>Estimated state</span></div>
        <div class="mini-legend-row"><span class="mini-legend-ellipse"></span><span>3 sigma envelope</span></div>
      </div>
    `;
  }

  refreshPanels(force = false) {
    void force;
    if (!this.world) {
      return;
    }

    this.syncSelectedTrack();
    this.renderRadarLog();
    this.renderTrackMetrics();
    this.renderStatusSummary();
    this.radarQualityBadge.textContent = this.world.radar.lastDetectionCount > 0
      ? `${this.world.radar.lastDetectionCount} detection${this.world.radar.lastDetectionCount > 1 ? "s" : ""}`
      : "Scan Active";
  }

  syncStatusUI() {
    const status = this.world?.missionEnded
      ? "Run Complete"
      : this.isPaused
      ? "Paused"
      : "Running";
    this.statusBadge.textContent = status;
    this.pauseButton.disabled = this.world?.missionEnded ?? false;
    this.pauseButton.textContent = this.world?.missionEnded ? "Pause" : this.isPaused ? "Resume" : "Pause";
  }

  renderRadarLog() {
    this.radarLog.innerHTML = "";
    const logs = [...this.detectionLog].slice(-12).reverse();
    if (logs.length === 0) {
      this.radarLog.innerHTML = '<div class="detail-empty">Waiting for radar revisit...</div>';
      return;
    }

    for (const entry of logs) {
      const card = document.createElement("article");
      card.className = "log-entry";
      card.innerHTML = `
        <div class="log-entry-head">
          <span class="log-entry-name" style="color:${categoryColor(entry.estimatedCategory)}">${entry.objectName}</span>
          <span class="log-entry-class">${categoryLabel(entry.estimatedCategory)}</span>
        </div>
        <div class="log-entry-meta">t=${entry.simTime.toFixed(1)} s | brg ${entry.measuredBearingDeg.toFixed(1)} deg | rng ${entry.measuredRange.toFixed(1)} px</div>
      `;
      this.radarLog.appendChild(card);
    }
  }

  renderTrackMetrics() {
    this.trackMetrics.innerHTML = "";
    const track = this.selectedTrack;
    if (track === null) {
      this.trackMetrics.innerHTML = '<div class="detail-empty">Waiting for a confirmed track.</div>';
      return;
    }

    const object = this.world.objects.find((item) => item.name === track.objectName) ?? null;
    let truthRange = null;
    let truthSpeed = null;
    if (object) {
      const dx = shortestAxisDelta(this.world.ego.x, object.x, this.world.width);
      const dy = shortestAxisDelta(this.world.ego.y, object.y, this.world.height);
      truthRange = Math.hypot(dx, dy);
      truthSpeed = object.speed;
    }

    const detailLines = [
      ["Track id", track.id],
      ["Status", track.trackStatus(this.world.radar.config.scanRateDegS)],
      ["Class", `${categoryLabel(track.estimatedCategory)} (${Math.round(track.confidence * 100)}%)`],
      ["Detection count", `${track.detectionCount}`],
      ["Estimated range", `${track.range.toFixed(1)} px`],
      ["Truth range", truthRange === null ? "n/a" : `${truthRange.toFixed(1)} px`],
      ["Bearing", `${track.bearingDeg.toFixed(1)} deg`],
      ["Estimated speed", `${Math.hypot(track.vx, track.vy).toFixed(2)} px/s`],
      ["Truth speed", truthSpeed === null ? "n/a" : `${truthSpeed.toFixed(2)} px/s`],
      ["Track age", `${track.age.toFixed(2)} s`],
      ["Time since update", `${track.timeSinceUpdate.toFixed(2)} s`],
      ["Uncertainty sigma", `${track.sigma.toFixed(2)} px`],
    ];

    const card = document.createElement("article");
    card.className = "detail-card";
    card.innerHTML = `
      <h3 style="color:${categoryColor(track.estimatedCategory)}">${track.objectName}</h3>
      <div class="detail-lines">
        ${detailLines.map(([label, value]) => `
          <div class="detail-line">
            <span class="detail-line-label">${label}</span>
            <span class="detail-line-value">${value}</span>
          </div>
        `).join("")}
      </div>
    `;
    this.trackMetrics.appendChild(card);
  }

  renderStatusSummary() {
    const items = [
      ["Status", this.world.missionEnded ? "Run complete" : this.isPaused ? "Paused" : "Running"],
      ["Sim time", `${Math.min(this.world.simTime, this.world.mission.durationLimitS).toFixed(1)} s / ${this.world.mission.durationLimitS}s`],
      ["Frame rate", `${this.fps.toFixed(1)} FPS`],
      ["Time scale", `x${this.world.timeScale.toFixed(1)}`],
      ["Scenario", this.currentScenarioKey === "default" ? "Default" : "Custom"],
      ["Objects", `${this.world.activeObjects.length}`],
      ["Tracks", `${this.world.radar.trackManager.orderedTracks.length}`],
      ["Radar beam", `${this.world.radar.scanAngleDeg.toFixed(1)} deg`],
      ["Beam width", `${this.world.radar.config.beamWidthDeg.toFixed(1)} deg`],
      ["Scan rate", `${this.world.radar.config.scanRateDegS.toFixed(1)} deg/s`],
      ["Radar range", `${this.world.radar.config.maxRange.toFixed(0)} px`],
      ["Detections", `${this.world.radar.lastDetectionCount}`],
      ["Ego state", "Fixed at scene center"],
    ];

    this.statusSummary.innerHTML = items.map(([label, value]) => `
      <div class="status-item">
        <dt>${label}</dt>
        <dd>${value}</dd>
      </div>
    `).join("");
  }

  roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) {
      ctx.fill();
    }
    if (stroke) {
      ctx.stroke();
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
