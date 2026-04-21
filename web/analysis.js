const DATA_ROOT = "./data/analysis/analysis_v1";

const state = {
  manifest: null,
  overview: null,
  runs: [],
  objects: [],
  trendDetection: [],
  trendRange: [],
  trendCoefficient: [],
  objectTrajectories: [],
  filters: {
    scenario: "all",
    coefficient: "all",
    objectName: "all",
    category: "all",
  },
  trajectory: {
    runA: "auto",
    objectA: "auto",
    runB: "none",
    objectB: "none",
  },
};

const TRAJECTORY_STYLES = {
  a: {
    name: "Track A",
    titleColor: "#74e7ff",
    truthStroke: "rgba(116, 231, 255, 0.96)",
    estimateStroke: "rgba(116, 231, 255, 0.92)",
    measureFill: "rgba(255, 214, 102, 0.96)",
    labelFill: "rgba(255, 255, 255, 0.9)",
  },
  b: {
    name: "Track B",
    titleColor: "#ff8fd8",
    truthStroke: "rgba(255, 143, 216, 0.96)",
    estimateStroke: "rgba(255, 143, 216, 0.92)",
    measureFill: "rgba(255, 173, 102, 0.94)",
    labelFill: "rgba(255, 255, 255, 0.9)",
  },
};

function formatNumber(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function categoryLabel(category) {
  switch (category) {
    case "hazard_debris":
      return "Hazard";
    case "target_debris":
      return "Target";
    case "neutral_debris":
      return "Neutral";
    default:
      return category || "Unknown";
  }
}

function categoryClass(category) {
  switch (category) {
    case "hazard_debris":
      return "category-chip-hazard";
    case "target_debris":
      return "category-chip-target";
    case "neutral_debris":
    default:
      return "category-chip-neutral";
  }
}

function setSelectOptions(select, values, formatter = (value) => value, firstLabel = "All") {
  const current = select.value;
  select.innerHTML = "";
  const baseOption = document.createElement("option");
  baseOption.value = "all";
  baseOption.textContent = firstLabel;
  select.append(baseOption);
  for (const value of values) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = formatter(value);
    select.append(option);
  }
  if ([...select.options].some((option) => option.value === current)) {
    select.value = current;
  } else {
    select.value = "all";
  }
}

function setTrajectorySelectOptions(select, values, mode, kind = "object") {
  const current = select.value;
  select.innerHTML = "";
  const defaults = [];
  if (mode === "a") {
    defaults.push({ value: "auto", label: kind === "run" ? "Auto run" : "Auto object" });
  } else {
    defaults.push({ value: "none", label: kind === "run" ? "No run" : "No object" });
  }
  for (const item of defaults) {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.append(option);
  }
  for (const value of values) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = value;
    select.append(option);
  }
  if ([...select.options].some((option) => option.value === current)) {
    select.value = current;
  } else {
    select.value = mode === "a" ? "auto" : "none";
  }
}

function rowMatchesGlobalFilter(row) {
  if (state.filters.scenario !== "all" && row.base_scenario !== state.filters.scenario) {
    return false;
  }
  if (state.filters.coefficient !== "all" && String(row.coefficient) !== state.filters.coefficient) {
    return false;
  }
  if (state.filters.objectName !== "all" && row.object_name && row.object_name !== state.filters.objectName) {
    return false;
  }
  if (state.filters.category !== "all" && row.true_category && row.true_category !== state.filters.category) {
    return false;
  }
  return true;
}

function trajectoryRowsForContext() {
  return state.objectTrajectories.slice();
}

function chooseDefaultRunA(rows) {
  if (!rows.length) {
    return null;
  }
  if (state.filters.scenario !== "all" || state.filters.coefficient !== "all") {
    const direct = rows.find((row) => {
      if (state.filters.scenario !== "all" && row.base_scenario !== state.filters.scenario) {
        return false;
      }
      if (state.filters.coefficient !== "all" && String(row.coefficient) !== state.filters.coefficient) {
        return false;
      }
      return true;
    });
    if (direct) {
      return direct.variant_name;
    }
  }
  return rows[0].variant_name;
}

function chooseDefaultObject(rows) {
  if (!rows.length) {
    return null;
  }
  if (state.filters.objectName !== "all") {
    const direct = rows.find((row) => row.object_name === state.filters.objectName);
    if (direct) {
      return direct.object_name;
    }
  }
  if (state.filters.category !== "all") {
    const direct = rows.find((row) => row.true_category === state.filters.category);
    if (direct) {
      return direct.object_name;
    }
  }
  return rows[0].object_name;
}

function pickTrajectoryEntries() {
  const rows = trajectoryRowsForContext();
  const runNames = [...new Set(rows.map((row) => row.variant_name))].sort();

  const selectedRunA = state.trajectory.runA === "auto"
    ? chooseDefaultRunA(rows)
    : state.trajectory.runA;
  const rowsForRunA = rows.filter((row) => row.variant_name === selectedRunA);
  const objectNamesA = [...new Set(rowsForRunA.map((row) => row.object_name))].sort();
  const selectedObjectA = state.trajectory.objectA === "auto"
    ? chooseDefaultObject(rowsForRunA)
    : state.trajectory.objectA;

  const selectedRunB = state.trajectory.runB === "none" ? null : state.trajectory.runB;
  const rowsForRunB = selectedRunB ? rows.filter((row) => row.variant_name === selectedRunB) : [];
  const objectNamesB = [...new Set(rowsForRunB.map((row) => row.object_name))].sort();
  const selectedObjectB = state.trajectory.objectB === "none"
    ? null
    : state.trajectory.objectB === "auto"
    ? chooseDefaultObject(rowsForRunB)
    : state.trajectory.objectB;

  return {
    availableRuns: runNames,
    availableObjectsA: objectNamesA,
    availableObjectsB: objectNamesB,
    trackA: rows.find((row) => row.variant_name === selectedRunA && row.object_name === selectedObjectA) ?? null,
    trackB: selectedRunB && selectedObjectB
      ? rows.find((row) => row.variant_name === selectedRunB && row.object_name === selectedObjectB) ?? null
      : null,
  };
}

function renderOverview() {
  const cardsRoot = document.getElementById("summary-cards");
  cardsRoot.innerHTML = "";
  for (const card of state.overview.summary_cards) {
    const article = document.createElement("article");
    article.className = "summary-card";
    article.innerHTML = `
      <p class="summary-card-label">${card.label}</p>
      <p class="summary-card-value">${card.value}<span class="summary-card-unit"> ${card.unit}</span></p>
    `;
    cardsRoot.append(article);
  }

  const experimentSummary = document.getElementById("experiment-summary");
  experimentSummary.innerHTML = `
    <div><dt>Scenarios</dt><dd>${state.overview.experiment.base_scenarios.join(", ")}</dd></div>
    <div><dt>Coefficients</dt><dd>${state.overview.experiment.coefficients.join(", ")}</dd></div>
    <div><dt>Total detections</dt><dd>${state.overview.experiment.total_detections}</dd></div>
    <div><dt>Total samples</dt><dd>${state.overview.experiment.total_samples}</dd></div>
    <div><dt>Run durations</dt><dd>${state.overview.experiment.durations_s.map((value) => `${formatNumber(value, 2)} s`).join(", ")}</dd></div>
    <div><dt>Tracking RMSE Pos</dt><dd>${formatNumber(state.overview.experiment.tracking_mean_position_rmse, 2)} px</dd></div>
    <div><dt>Tracking RMSE Vel</dt><dd>${formatNumber(state.overview.experiment.tracking_mean_velocity_rmse, 2)} px/s</dd></div>
  `;

  const questions = document.getElementById("analysis-questions");
  questions.innerHTML = "";
  for (const question of state.manifest.questions) {
    const item = document.createElement("li");
    item.textContent = question;
    questions.append(item);
  }

  const notes = document.getElementById("analysis-notes");
  notes.innerHTML = "";
  for (const note of state.overview.notes) {
    const item = document.createElement("li");
    item.textContent = note;
    notes.append(item);
  }
}

function renderRuns() {
  const tbody = document.getElementById("runs-table-body");
  tbody.innerHTML = "";
  for (const row of state.runs.filter((row) => rowMatchesGlobalFilter(row))) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.variant_name}</td>
      <td><span class="metric-pill">${formatNumber(row.coefficient, 2)}</span></td>
      <td>${formatNumber(row.max_acceleration, 2)}</td>
      <td>${formatNumber(row.angular_rate, 2)}</td>
      <td>${row.total_detections}</td>
      <td>${formatNumber(row.post_update_position_rmse, 2)}</td>
      <td>${formatNumber(row.post_update_velocity_rmse, 2)}</td>
    `;
    tbody.append(tr);
  }
}

function renderObjects() {
  const tbody = document.getElementById("objects-table-body");
  tbody.innerHTML = "";
  for (const row of state.objects.filter((row) => rowMatchesGlobalFilter(row))) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.object_name}</td>
      <td><span class="category-chip ${categoryClass(row.true_category)}">${categoryLabel(row.true_category)}</span></td>
      <td>${formatNumber(row.coefficient, 2)}</td>
      <td>${row.detection_count}</td>
      <td>${formatNumber(row.post_update_position_rmse, 2)}</td>
      <td>${formatNumber(row.post_update_velocity_rmse, 2)}</td>
      <td>${formatNumber(row.post_update_mean_position_error, 2)}</td>
      <td>${formatNumber(row.post_update_mean_velocity_error, 2)}</td>
    `;
    tbody.append(tr);
  }
}

function renderTrendTable(rootId, rows, mapper) {
  const tbody = document.getElementById(rootId);
  tbody.innerHTML = "";
  for (const row of rows.filter((item) => rowMatchesGlobalFilter(item))) {
    const tr = document.createElement("tr");
    tr.innerHTML = mapper(row);
    tbody.append(tr);
  }
}

function renderTrends() {
  renderTrendTable("trend-detection-body", state.trendDetection, (row) => `
    <td>${formatNumber(row.coefficient, 2)}</td>
    <td>${row.bucket_label}</td>
    <td>${row.sample_count}</td>
    <td>${formatNumber(row.mean_position_error, 2)}</td>
    <td>${formatNumber(row.median_position_error, 2)}</td>
    <td>${formatNumber(row.mean_velocity_error, 2)}</td>
    <td>${formatNumber(row.mean_truth_range, 2)}</td>
  `);

  renderTrendTable("trend-range-body", state.trendRange, (row) => `
    <td>${formatNumber(row.coefficient, 2)}</td>
    <td>${row.bucket_label}</td>
    <td>${row.sample_count}</td>
    <td>${formatNumber(row.mean_position_error, 2)}</td>
    <td>${formatNumber(row.median_position_error, 2)}</td>
    <td>${formatNumber(row.mean_velocity_error, 2)}</td>
    <td>${formatNumber(row.mean_detection_index, 2)}</td>
  `);

  renderTrendTable("trend-coefficient-body", state.trendCoefficient, (row) => `
    <td>${formatNumber(row.coefficient, 2)}</td>
    <td>${row.total_detections}</td>
    <td>${formatNumber(row.post_update_position_rmse, 2)}</td>
    <td>${formatNumber(row.post_update_velocity_rmse, 2)}</td>
    <td>${formatNumber(row.mean_position_error, 2)}</td>
    <td>${formatNumber(row.mean_velocity_error, 2)}</td>
    <td>${formatNumber(row.mean_truth_range, 2)}</td>
  `);
}

function updateTrajectorySelectors() {
  const runASelect = document.getElementById("trajectory-run-a");
  const runBSelect = document.getElementById("trajectory-run-b");
  const trackASelect = document.getElementById("trajectory-track-a");
  const trackBSelect = document.getElementById("trajectory-track-b");
  const { availableRuns, availableObjectsA, availableObjectsB } = pickTrajectoryEntries();
  setTrajectorySelectOptions(runASelect, availableRuns, "a", "run");
  setTrajectorySelectOptions(runBSelect, availableRuns, "b", "run");
  setTrajectorySelectOptions(trackASelect, availableObjectsA, "a", "object");
  setTrajectorySelectOptions(trackBSelect, availableObjectsB, "b", "object");
}

function fillTrackCard(rootId, titleId, entry, style, isEmptyText) {
  const title = document.getElementById(titleId);
  const stats = document.getElementById(rootId);
  const note = document.getElementById(rootId.replace("-stats", "-note"));

  if (!entry) {
    title.textContent = style.name;
    title.style.color = style.titleColor;
    stats.innerHTML = `<div><dt>Status</dt><dd>${isEmptyText}</dd></div>`;
    note.textContent = "";
    return;
  }

  const ranges = entry.detection_meta.map((item) => item.range);
  const positionErrors = entry.detection_meta.map((item) => item.position_error);
  const velocityErrors = entry.detection_meta.map((item) => item.velocity_error);
  const meanRange = ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : 0;
  const lastRange = ranges.length ? ranges[ranges.length - 1] : 0;
  const meanPosError = positionErrors.length
    ? positionErrors.reduce((sum, value) => sum + value, 0) / positionErrors.length
    : 0;
  const maxPosError = positionErrors.length ? Math.max(...positionErrors) : 0;
  const meanVelError = velocityErrors.length
    ? velocityErrors.reduce((sum, value) => sum + value, 0) / velocityErrors.length
    : 0;

  title.textContent = `${style.name} - ${entry.object_name}`;
  title.style.color = style.titleColor;
  stats.innerHTML = `
    <div><dt>Category</dt><dd>${categoryLabel(entry.true_category)}</dd></div>
    <div><dt>Coef</dt><dd>${formatNumber(entry.coefficient, 2)}</dd></div>
    <div><dt>Accel level</dt><dd>${formatNumber(entry.second_order_coefficient, 2)}</dd></div>
    <div><dt>Detections</dt><dd>${entry.detection_count}</dd></div>
    <div><dt>Mean range</dt><dd>${formatNumber(meanRange, 1)} px</dd></div>
    <div><dt>Last range</dt><dd>${formatNumber(lastRange, 1)} px</dd></div>
    <div><dt>Mean pos err</dt><dd>${formatNumber(meanPosError, 2)} px</dd></div>
    <div><dt>Max pos err</dt><dd>${formatNumber(maxPosError, 2)} px</dd></div>
    <div><dt>Mean vel err</dt><dd>${formatNumber(meanVelError, 2)} px/s</dd></div>
    <div><dt>Post-update RMSE Pos</dt><dd>${formatNumber(entry.post_update_position_rmse, 2)} px</dd></div>
    <div><dt>RMSE Pos (${state.manifest.post_update_rmse_after_init_skip}+)</dt><dd>${formatNumber(entry.post_update_position_rmse_after_init ?? 0, 2)} px</dd></div>
  `;
  const rangeComment = meanRange > 220 ? "observed mostly far from ego" : meanRange > 150 ? "observed at mid range" : "observed relatively close to ego";
  const dynamicsComment = entry.second_order_coefficient >= 0.5 ? "stronger non-linearity" : "milder dynamics";
  const detectionComment = entry.detection_count >= 10 ? "well supported by repeated detections" : "supported by relatively few detections";
  note.textContent = `${rangeComment}, with ${dynamicsComment}, and ${detectionComment}.`;
}

function buildTrajectoryTransform(entries, width, height) {
  const allPoints = entries.flatMap((entry) => [
    ...entry.truth_path.map((point) => ({ x: point.x, y: point.y })),
    ...entry.measured_points.map((point) => ({ x: point.x, y: point.y })),
    ...entry.estimated_path.map((point) => ({ x: point.x, y: point.y })),
  ]);

  if (!allPoints.length) {
    return null;
  }

  const maxAbsX = Math.max(...allPoints.map((point) => Math.abs(point.x)), 20);
  const maxAbsY = Math.max(...allPoints.map((point) => Math.abs(point.y)), 20);
  const spanX = Math.max(1, maxAbsX * 2);
  const spanY = Math.max(1, maxAbsY * 2);
  const pad = 26;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const centerX = width / 2;
  const centerY = height / 2;

  return {
    toCanvas(point) {
      return {
        x: centerX + point.x * scale,
        y: centerY - point.y * scale,
      };
    },
  };
}

function drawPolyline(ctx, points, toCanvas, strokeStyle, lineWidth, dash = []) {
  if (!points.length) return;
  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dash);
  ctx.beginPath();
  const first = toCanvas(points[0]);
  ctx.moveTo(first.x, first.y);
  for (const point of points.slice(1)) {
    const screen = toCanvas(point);
    ctx.lineTo(screen.x, screen.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawMeasurementPoints(ctx, points, toCanvas, style, showLabels) {
  ctx.save();
  ctx.fillStyle = style.measureFill;
  ctx.font = "10px IBM Plex Sans";
  for (const point of points) {
    const screen = toCanvas(point);
    ctx.fillRect(screen.x - 3, screen.y - 3, 6, 6);
    if (showLabels) {
      ctx.fillStyle = style.labelFill;
      ctx.fillText(String(point.index), screen.x + 6, screen.y - 6);
      ctx.fillStyle = style.measureFill;
    }
  }
  ctx.restore();
}

function drawMeasurementResiduals(ctx, measuredPoints, detectionMeta, toCanvas, style) {
  const truthByIndex = new Map(detectionMeta.map((item) => [item.index, item]));
  ctx.save();
  ctx.strokeStyle = style.measureFill.replace("0.96", "0.45").replace("0.94", "0.45");
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  for (const point of measuredPoints) {
    const truth = truthByIndex.get(point.index);
    if (!truth) continue;
    const truthScreen = toCanvas({ x: truth.truth_x, y: truth.truth_y });
    const measureScreen = toCanvas(point);
    ctx.beginPath();
    ctx.moveTo(truthScreen.x, truthScreen.y);
    ctx.lineTo(measureScreen.x, measureScreen.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTrajectoryPanel() {
  const { trackA, trackB } = pickTrajectoryEntries();
  fillTrackCard("trajectory-a-stats", "trajectory-a-title", trackA, TRAJECTORY_STYLES.a, "No track selected.");
  fillTrackCard("trajectory-b-stats", "trajectory-b-title", trackB, TRAJECTORY_STYLES.b, "Optional overlay disabled.");

  const canvas = document.getElementById("trajectory-canvas");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#071021";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(122, 154, 219, 0.12)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i += 1) {
    const x = (width / 6) * i;
    const y = (height / 6) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const selectedEntries = [trackA, trackB].filter(Boolean);
  if (!selectedEntries.length) {
    ctx.fillStyle = "rgba(159, 177, 207, 0.9)";
    ctx.font = "15px IBM Plex Sans";
    ctx.fillText("No trajectory data for the current selection.", 26, 36);
    return;
  }

  const transform = buildTrajectoryTransform(selectedEntries, width, height);
  if (!transform) {
    return;
  }
  const toCanvas = transform.toCanvas;

  const ego = toCanvas({ x: 0, y: 0 });
  ctx.strokeStyle = "rgba(159, 177, 207, 0.36)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(ego.x - 7, ego.y);
  ctx.lineTo(ego.x + 7, ego.y);
  ctx.moveTo(ego.x, ego.y - 7);
  ctx.lineTo(ego.x, ego.y + 7);
  ctx.stroke();
  ctx.fillStyle = "rgba(159, 177, 207, 0.92)";
  ctx.font = "11px IBM Plex Sans";
  ctx.fillText("ego", ego.x + 10, ego.y - 8);

  if (trackA) {
    drawPolyline(ctx, trackA.truth_path, toCanvas, TRAJECTORY_STYLES.a.truthStroke, 2.0);
    drawPolyline(ctx, trackA.estimated_path, toCanvas, TRAJECTORY_STYLES.a.estimateStroke, 1.9, [7, 5]);
    drawMeasurementResiduals(ctx, trackA.measured_points, trackA.detection_meta, toCanvas, TRAJECTORY_STYLES.a);
    drawMeasurementPoints(ctx, trackA.measured_points, toCanvas, TRAJECTORY_STYLES.a, true);
  }
  if (trackB) {
    drawPolyline(ctx, trackB.truth_path, toCanvas, TRAJECTORY_STYLES.b.truthStroke, 2.0);
    drawPolyline(ctx, trackB.estimated_path, toCanvas, TRAJECTORY_STYLES.b.estimateStroke, 1.9, [7, 5]);
    drawMeasurementResiduals(ctx, trackB.measured_points, trackB.detection_meta, toCanvas, TRAJECTORY_STYLES.b);
    drawMeasurementPoints(ctx, trackB.measured_points, toCanvas, TRAJECTORY_STYLES.b, true);
  }
}

function renderAll() {
  renderOverview();
  renderRuns();
  renderObjects();
  renderTrends();
  updateTrajectorySelectors();
  drawTrajectoryPanel();
}

function bindGlobalFilters() {
  const scenarioSelect = document.getElementById("filter-scenario");
  const coefficientSelect = document.getElementById("filter-coefficient");
  const objectSelect = document.getElementById("filter-object");
  const categorySelect = document.getElementById("filter-category");

  setSelectOptions(scenarioSelect, state.manifest.filters.base_scenarios);
  setSelectOptions(coefficientSelect, state.manifest.filters.coefficients, (value) => formatNumber(value, 2));
  setSelectOptions(objectSelect, state.manifest.filters.object_names);
  setSelectOptions(categorySelect, state.manifest.filters.true_categories, categoryLabel);

  scenarioSelect.addEventListener("change", () => {
    state.filters.scenario = scenarioSelect.value;
    renderAll();
  });
  coefficientSelect.addEventListener("change", () => {
    state.filters.coefficient = coefficientSelect.value;
    renderAll();
  });
  objectSelect.addEventListener("change", () => {
    state.filters.objectName = objectSelect.value;
    if (objectSelect.value !== "all") {
      state.trajectory.trackA = objectSelect.value;
    }
    renderAll();
  });
  categorySelect.addEventListener("change", () => {
    state.filters.category = categorySelect.value;
    renderAll();
  });
}

function bindTrajectoryFilters() {
  const runASelect = document.getElementById("trajectory-run-a");
  const runBSelect = document.getElementById("trajectory-run-b");
  const trackASelect = document.getElementById("trajectory-track-a");
  const trackBSelect = document.getElementById("trajectory-track-b");

  runASelect.addEventListener("change", () => {
    state.trajectory.runA = runASelect.value;
    state.trajectory.objectA = "auto";
    renderAll();
  });
  runBSelect.addEventListener("change", () => {
    state.trajectory.runB = runBSelect.value;
    state.trajectory.objectB = runBSelect.value === "none" ? "none" : "auto";
    renderAll();
  });
  trackASelect.addEventListener("change", () => {
    state.trajectory.objectA = trackASelect.value;
    renderAll();
  });
  trackBSelect.addEventListener("change", () => {
    state.trajectory.objectB = trackBSelect.value;
    renderAll();
  });
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.json();
}

async function bootstrap() {
  state.manifest = await loadJson(`${DATA_ROOT}/manifest.json`);
  state.overview = await loadJson(`${DATA_ROOT}/overview.json`);
  state.runs = await loadJson(`${DATA_ROOT}/runs.json`);
  state.objects = await loadJson(`${DATA_ROOT}/objects.json`);
  state.trendDetection = await loadJson(`${DATA_ROOT}/trend_detection_index.json`);
  state.trendRange = await loadJson(`${DATA_ROOT}/trend_range.json`);
  state.trendCoefficient = await loadJson(`${DATA_ROOT}/trend_coefficient.json`);
  state.objectTrajectories = await loadJson(`${DATA_ROOT}/object_trajectories.json`);
  bindGlobalFilters();
  bindTrajectoryFilters();
  renderAll();
}

bootstrap().catch((error) => {
  console.error(error);
  document.body.innerHTML = `
    <div class="analysis-shell">
      <section class="panel analysis-panel">
        <h1>Analysis data could not be loaded</h1>
        <p class="analysis-lead">${error.message}</p>
      </section>
    </div>
  `;
});
