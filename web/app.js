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

    const p00 = this.p00 + dt * (this.p10 + this.p01) + dt * dt * this.p11 + processVariance;
    const p01 = this.p01 + dt * this.p11;
    const p10 = this.p10 + dt * this.p11;
    const p11 = this.p11 + processVariance;

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
  }

  reset() {
    this.trackManager.reset();
    this.random = mulberry32(this.config.seed);
    this.scanAngleDeg = 0;
    this.lastDetectionCount = 0;
    this.lastDetectionTimes.clear();
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
    this.radar.update(dt, this);
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
    this.radarCanvas = document.getElementById("radar-canvas");
    this.radarCtx = this.radarCanvas.getContext("2d");
    this.pauseButton = document.getElementById("pause-button");
    this.resetButton = document.getElementById("reset-button");
    this.missionRestartButton = document.getElementById("mission-restart-button");
    this.modeSelect = document.getElementById("mode-select");
    this.scenarioSelect = document.getElementById("scenario-select");
    this.statusBadge = document.getElementById("status-badge");
    this.radarQualityBadge = document.getElementById("radar-quality-badge");
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
      radarAngle: document.getElementById("stat-radar-angle"),
      radarDetections: document.getElementById("stat-radar-detections"),
    };

    this.legendList = document.getElementById("legend-list");
    this.entityList = document.getElementById("entity-list");
    this.trackList = document.getElementById("track-list");

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
    this.nextPilotActionTime = 0;
    this.renderLegend();
    this.setControlMode(this.currentMode, { syncSelect: true, resetMotion: true });
    this.hideMissionSummary();
    this.syncStatusUI();
    this.resizeCanvases();
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

  resizeCanvases() {
    this.resizeCanvas(this.canvas, this.ctx);
    this.resizeCanvas(this.radarCanvas, this.radarCtx);
  }

  resizeCanvas(canvas, ctx) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
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

    this.drawTruthView();
    this.drawRadarView();
    if (timestamp - this.lastPanelRefresh > 180) {
      this.refreshSidebar();
      this.lastPanelRefresh = timestamp;
    }
  }

  computeViewport(canvas, worldWidth, worldHeight) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
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
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const viewport = this.computeViewport(this.canvas, this.world.width, this.world.height);

    this.ctx.clearRect(0, 0, width, height);
    this.drawBackground(this.ctx, width, height);
    this.drawStars(viewport);
    if (this.showGrid) {
      this.drawGrid(viewport);
    }

    this.ctx.strokeStyle = COLORS.worldFrame;
    this.ctx.lineWidth = 2;
    this.roundRect(this.ctx, viewport.originX, viewport.originY, viewport.width, viewport.height, 18, false, true);

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

  drawRadarView() {
    const width = this.radarCanvas.clientWidth;
    const height = this.radarCanvas.clientHeight;
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
    const velocityMagnitude = Math.hypot(track.vx, track.vy);
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

    const sigmaMajorPx = clamp(
      ((track.sigma * 0.32 + track.timeSinceUpdate * (2.2 + velocityMagnitude * 0.14)) / this.world.radar.config.maxRange) * radius,
      8,
      34,
    );
    const sigmaMinorPx = clamp(
      ((track.sigma * 0.14 + track.timeSinceUpdate * 0.9) / this.world.radar.config.maxRange) * radius,
      4,
      14,
    );

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
    this.radarCtx.rotate(track.headingRad);
    this.radarCtx.fillStyle = COLORS.uncertainty;
    this.radarCtx.beginPath();
    this.radarCtx.ellipse(0, 0, sigmaMajorPx, sigmaMinorPx, 0, 0, Math.PI * 2);
    this.radarCtx.fill();
    this.radarCtx.strokeStyle = "rgba(255, 255, 255, 0.24)";
    this.radarCtx.lineWidth = 1.5;
    this.radarCtx.stroke();
    this.radarCtx.restore();

    this.radarCtx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    this.radarCtx.lineWidth = 2;
    this.radarCtx.beginPath();
    this.radarCtx.rect(anchor.x - 4, anchor.y - 4, 8, 8);
    this.radarCtx.stroke();

    this.radarCtx.fillStyle = estimatedColor;
    this.radarCtx.beginPath();
    this.radarCtx.arc(endpoint.x, endpoint.y, 6, 0, Math.PI * 2);
    this.radarCtx.fill();

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
    this.roundRect(this.ctx, topLeft.x, topLeft.y, width, height, 14, false, true);
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
    const tracks = this.world.radar.trackManager.orderedTracks;

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
    this.stats.radarAngle.textContent = `${Math.round(this.world.radar.scanAngleDeg)} deg`;
    this.stats.radarDetections.textContent = `${this.world.radar.lastDetectionCount}`;
    this.radarQualityBadge.textContent = this.world.radar.lastDetectionCount > 0
      ? `${this.world.radar.lastDetectionCount} detection${this.world.radar.lastDetectionCount > 1 ? "s" : ""}`
      : "Scan Active";

    if (!force && this.entityList.children.length === this.world.allObjects.length) {
      for (const [index, object] of this.world.allObjects.entries()) {
        const item = this.entityList.children[index];
        item.querySelector(".entity-meta").textContent = `${object.speed.toFixed(1)} px/s`;
      }
    } else {
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

    this.trackList.innerHTML = "";
    if (tracks.length === 0) {
      const item = document.createElement("div");
      item.className = "entity-item";
      item.innerHTML = `
        <div class="entity-label">
          <span>No tracks yet</span>
        </div>
        <span class="entity-meta">waiting for beam revisit</span>
      `;
      this.trackList.appendChild(item);
      return;
    }

    for (const track of tracks) {
      const item = document.createElement("div");
      item.className = "entity-item";
      item.innerHTML = `
        <div class="entity-label">
          <span class="swatch" style="background: ${COLORS.track}"></span>
          <span>${track.id}</span>
        </div>
        <span class="entity-meta">${track.range.toFixed(0)} px</span>
      `;
      const detail = document.createElement("div");
      detail.className = "entity-meta";
      detail.style.whiteSpace = "normal";
      detail.style.lineHeight = "1.45";
      detail.textContent = `${categoryLabel(track.estimatedCategory)} | conf ${Math.round(track.confidence * 100)}% | quality ${track.observationLabel} | bearing ${Math.round(track.bearingDeg)} deg | age ${track.age.toFixed(1)} s`;
      item.appendChild(detail);
      this.trackList.appendChild(item);
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
