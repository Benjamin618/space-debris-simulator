const DATA_ROOT = "./data/analysis/analysis_v1";
const DATA_VERSION = "2026-04-22-analysis-physical";

const state = {
  manifest: null,
  overview: null,
  runs: [],
  objects: [],
  trendDetection: [],
  trendRange: [],
  trendCoefficient: [],
  objectTrajectories: [],
  detectionRows: [],
  filters: {
    scenario: "all",
    coefficient: "all",
    scanRate: "all",
    seed: "all",
    objectName: "all",
    category: "all",
  },
  trajectory: {
    coefficientA: "auto",
    scanRateA: "auto",
    seedA: "auto",
    objectA: "auto",
    coefficientB: "none",
    scanRateB: "auto",
    seedB: "auto",
    objectB: "none",
  },
  runTable: {
    sortKey: "post_update_position_rmse_after_init",
    sortDir: "asc",
    textFilter: "",
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

const RUN_TABLE_COLUMNS = [
  { key: "variant_name", label: "Run", type: "text" },
  { key: "coefficient", label: "Non-Linearity", type: "number", digits: 2, unit: "" },
  { key: "scan_rate_deg_s", label: "Scan Rate", type: "number", digits: 1, unit: "deg/s" },
  { key: "seed", label: "Seed", type: "number", digits: 0, unit: "" },
  { key: "max_acceleration", label: "Max Accel", type: "number", digits: 4, unit: "m/s^2" },
  { key: "total_detections", label: "Detections", type: "number", digits: 0, unit: "" },
  { key: "post_update_position_rmse", label: "RMSE Pos (all)", type: "number", digits: 2, unit: "m" },
  { key: "post_update_position_rmse_after_init", label: "RMSE Pos (5+)", type: "number", digits: 2, unit: "m" },
  { key: "post_update_velocity_rmse_after_init", label: "RMSE Vel (5+)", type: "number", digits: 2, unit: "m/s" },
];

function formatNumber(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function formatVariantName(variantName) {
  return variantName
    .replace("scenario_analysis_minimal_", "")
    .replaceAll("_", " ");
}

function flattenDetectionRows(entries) {
  const rows = [];
  for (const entry of entries) {
    const measuredByIndex = new Map(entry.measured_points.map((point) => [point.index, point]));
    const estimatedByIndex = new Map(entry.estimated_path.map((point) => [point.index, point]));
    for (const meta of entry.detection_meta) {
      const measured = measuredByIndex.get(meta.index) ?? null;
      const estimated = estimatedByIndex.get(meta.index) ?? null;
      rows.push({
        base_scenario: entry.base_scenario,
        variant_name: entry.variant_name,
        coefficient: entry.coefficient,
        scan_rate_deg_s: entry.scan_rate_deg_s,
        seed: entry.seed,
        object_name: entry.object_name,
        true_category: entry.true_category,
        second_order_coefficient: entry.second_order_coefficient,
        time: meta.time,
        detection_index: meta.index,
        truth_x: meta.truth_x,
        truth_y: meta.truth_y,
        range: meta.range,
        measured_x: measured?.x ?? null,
        measured_y: measured?.y ?? null,
        estimated_x: estimated?.x ?? null,
        estimated_y: estimated?.y ?? null,
        position_error: meta.position_error,
        velocity_error: meta.velocity_error,
      });
    }
  }
  return rows;
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
    defaults.push({ value: "auto", label: `Auto ${kind}` });
  } else {
    if (kind === "coefficient") {
      defaults.push({ value: "none", label: "Disabled" });
      defaults.push({ value: "auto", label: "Auto coefficient" });
    } else {
      defaults.push({ value: "auto", label: `Auto ${kind}` });
    }
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
    select.value = mode === "a" ? "auto" : kind === "coefficient" ? "none" : "auto";
  }
}

function runColumnLabel(column) {
  return column.unit ? `${column.label} (${column.unit})` : column.label;
}

function formatRunCell(row, column) {
  const value = row[column.key];
  if (column.key === "variant_name") {
    return formatVariantName(value);
  }
  if (column.key === "coefficient") {
    return `<span class="metric-pill">${formatNumber(value, column.digits ?? 2)}</span>`;
  }
  if (column.type === "number") {
    const formatted = formatNumber(value, column.digits ?? 2);
    return column.unit ? `${formatted} ${column.unit}` : formatted;
  }
  return String(value);
}

function rowMatchesGlobalFilter(row) {
  if (state.filters.scenario !== "all" && row.base_scenario !== state.filters.scenario) {
    return false;
  }
  if (state.filters.coefficient !== "all" && String(row.coefficient) !== state.filters.coefficient) {
    return false;
  }
  if (state.filters.scanRate !== "all" && String(row.scan_rate_deg_s) !== state.filters.scanRate) {
    return false;
  }
  if (state.filters.seed !== "all" && String(row.seed) !== state.filters.seed) {
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
  return state.objectTrajectories.filter((row) => {
    if (state.filters.scenario !== "all" && row.base_scenario !== state.filters.scenario) {
      return false;
    }
    return true;
  });
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

function valueOrAuto(selected, fallback) {
  return selected === "auto" ? fallback : selected;
}

function pickTrajectoryEntries() {
  const rows = trajectoryRowsForContext();
  const coefficients = [...new Set(rows.map((row) => String(row.coefficient)))].sort((a, b) => Number(a) - Number(b));
  const scanRates = [...new Set(rows.map((row) => String(row.scan_rate_deg_s)))].sort((a, b) => Number(a) - Number(b));
  const seeds = [...new Set(rows.map((row) => String(row.seed)))].sort((a, b) => Number(a) - Number(b));

  const fallbackCoefficientA = state.filters.coefficient !== "all" ? state.filters.coefficient : coefficients[0] ?? "auto";
  const selectedCoefficientA = valueOrAuto(state.trajectory.coefficientA, fallbackCoefficientA);
  const rowsForCoefA = rows.filter((row) => String(row.coefficient) === String(selectedCoefficientA));
  const scanRatesA = [...new Set(rowsForCoefA.map((row) => String(row.scan_rate_deg_s)))].sort((a, b) => Number(a) - Number(b));
  const fallbackScanA = state.filters.scanRate !== "all" ? state.filters.scanRate : scanRatesA[0] ?? "auto";
  const selectedScanA = valueOrAuto(state.trajectory.scanRateA, fallbackScanA);
  const rowsForScanA = rowsForCoefA.filter((row) => String(row.scan_rate_deg_s) === String(selectedScanA));
  const seedsA = [...new Set(rowsForScanA.map((row) => String(row.seed)))].sort((a, b) => Number(a) - Number(b));
  const fallbackSeedA = state.filters.seed !== "all" ? state.filters.seed : seedsA[0] ?? "auto";
  const selectedSeedA = valueOrAuto(state.trajectory.seedA, fallbackSeedA);
  const rowsForSeedA = rowsForScanA.filter((row) => String(row.seed) === String(selectedSeedA));
  const objectNamesA = [...new Set(rowsForSeedA.map((row) => row.object_name))].sort();
  const selectedObjectA = valueOrAuto(state.trajectory.objectA, chooseDefaultObject(rowsForSeedA));

  const enabledB = state.trajectory.coefficientB !== "none";
  const selectedCoefficientB = enabledB ? valueOrAuto(state.trajectory.coefficientB, fallbackCoefficientA) : null;
  const rowsForCoefB = enabledB ? rows.filter((row) => String(row.coefficient) === String(selectedCoefficientB)) : [];
  const scanRatesB = [...new Set(rowsForCoefB.map((row) => String(row.scan_rate_deg_s)))].sort((a, b) => Number(a) - Number(b));
  const selectedScanB = enabledB ? valueOrAuto(state.trajectory.scanRateB, scanRatesB[0] ?? "auto") : null;
  const rowsForScanB = enabledB ? rowsForCoefB.filter((row) => String(row.scan_rate_deg_s) === String(selectedScanB)) : [];
  const seedsB = [...new Set(rowsForScanB.map((row) => String(row.seed)))].sort((a, b) => Number(a) - Number(b));
  const selectedSeedB = enabledB ? valueOrAuto(state.trajectory.seedB, seedsB[0] ?? "auto") : null;
  const rowsForSeedB = enabledB ? rowsForScanB.filter((row) => String(row.seed) === String(selectedSeedB)) : [];
  const objectNamesB = [...new Set(rowsForSeedB.map((row) => row.object_name))].sort();
  const selectedObjectB = enabledB ? valueOrAuto(state.trajectory.objectB, chooseDefaultObject(rowsForSeedB)) : null;

  return {
    availableCoefficients: coefficients,
    availableScanRates: scanRates,
    availableSeeds: seeds,
    availableScanRatesA: scanRatesA,
    availableSeedsA: seedsA,
    availableObjectsA: objectNamesA,
    availableScanRatesB: scanRatesB,
    availableSeedsB: seedsB,
    availableObjectsB: objectNamesB,
    trackA: rowsForSeedA.find((row) => row.object_name === selectedObjectA) ?? null,
    trackB: enabledB ? rowsForSeedB.find((row) => row.object_name === selectedObjectB) ?? null : null,
  };
}

function renderOverview() {
  const cardsRoot = document.getElementById("summary-cards");
  cardsRoot.innerHTML = "";
  const durationValues = state.overview.experiment.durations_s ?? [];
  const durationLabel = durationValues.length <= 1
    ? formatNumber(durationValues[0] ?? 0, 2)
    : `${formatNumber(Math.min(...durationValues), 2)}-${formatNumber(Math.max(...durationValues), 2)}`;
  const overviewCards = [
    {
      label: "Runs Compared",
      value: state.overview.summary_cards.find((card) => card.key === "runs_compared")?.value ?? 0,
      unit: "runs",
    },
    {
      label: "Run Duration",
      value: durationLabel,
      unit: "s",
    },
    {
      label: "Total Detections",
      value: state.overview.experiment.total_detections ?? 0,
      unit: "detections",
    },
    {
      label: "Position RMSE",
      value: formatNumber(state.overview.summary_cards.find((card) => card.key === "mean_post_update_position_rmse_after_init")?.value ?? 0, 2),
      unit: "m",
    },
  ];

  for (const card of overviewCards) {
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
    <div><dt>Scan rates</dt><dd>${state.overview.experiment.scan_rates_deg_s.map((value) => `${formatNumber(value, 1)} deg/s`).join(", ")}</dd></div>
    <div><dt>Seeds</dt><dd>${state.overview.experiment.seeds.join(", ")}</dd></div>
    <div><dt>Total detections</dt><dd>${state.overview.experiment.total_detections}</dd></div>
    <div><dt>Total samples</dt><dd>${state.overview.experiment.total_samples}</dd></div>
    <div><dt>Run durations</dt><dd>${state.overview.experiment.durations_s.map((value) => `${formatNumber(value, 2)} s`).join(", ")}</dd></div>
    <div><dt>Tracking RMSE Pos</dt><dd>${formatNumber(state.overview.experiment.tracking_mean_position_rmse, 2)} m</dd></div>
    <div><dt>Tracking RMSE Vel</dt><dd>${formatNumber(state.overview.experiment.tracking_mean_velocity_rmse, 2)} m/s</dd></div>
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

function renderRunTableControls() {
  const sortKeySelect = document.getElementById("runs-sort-key");
  const sortDirSelect = document.getElementById("runs-sort-dir");
  const filterInput = document.getElementById("runs-text-filter");

  if (!sortKeySelect.options.length) {
    for (const column of RUN_TABLE_COLUMNS) {
      const option = document.createElement("option");
      option.value = column.key;
      option.textContent = column.label;
      sortKeySelect.append(option);
    }
  }
  sortKeySelect.value = state.runTable.sortKey;
  sortDirSelect.value = state.runTable.sortDir;
  filterInput.value = state.runTable.textFilter;
}

function renderGuidedObservations() {
  const grid = document.getElementById("guided-observation-grid");
  const notes = document.getElementById("guided-observation-notes");
  const filteredRuns = state.runs.filter((row) => rowMatchesGlobalFilter(row));
  const filteredDetectionRows = state.detectionRows.filter((row) => rowMatchesGlobalFilter(row));

  grid.innerHTML = "";
  notes.innerHTML = "";

  if (!filteredRuns.length) {
    grid.innerHTML = `<article class="guided-observation-card"><h3>No filtered runs</h3><p>Adjust the filters to reveal at least one run.</p></article>`;
    return;
  }

  const bestRun = [...filteredRuns].sort((left, right) => left.post_update_position_rmse_after_init - right.post_update_position_rmse_after_init)[0];
  const worstRun = [...filteredRuns].sort((left, right) => right.post_update_position_rmse_after_init - left.post_update_position_rmse_after_init)[0];

  const byCoefficient = new Map();
  for (const row of filteredRuns) {
    const bucket = byCoefficient.get(row.coefficient) ?? [];
    bucket.push(row);
    byCoefficient.set(row.coefficient, bucket);
  }
  const coefficientRows = [...byCoefficient.entries()]
    .map(([coefficient, rows]) => ({
      coefficient,
      rmseAfterInit: mean(rows.map((row) => row.post_update_position_rmse_after_init)),
      detections: mean(rows.map((row) => row.total_detections)),
    }))
    .sort((left, right) => left.coefficient - right.coefficient);

  const byScan = new Map();
  for (const row of filteredRuns) {
    const bucket = byScan.get(row.scan_rate_deg_s) ?? [];
    bucket.push(row);
    byScan.set(row.scan_rate_deg_s, bucket);
  }
  const scanRows = [...byScan.entries()]
    .map(([scanRate, rows]) => ({
      scanRate,
      rmseAfterInit: mean(rows.map((row) => row.post_update_position_rmse_after_init)),
      detections: mean(rows.map((row) => row.total_detections)),
    }))
    .sort((left, right) => left.scanRate - right.scanRate);

  const bySeed = new Map();
  for (const row of filteredRuns) {
    const bucket = bySeed.get(row.seed) ?? [];
    bucket.push(row);
    bySeed.set(row.seed, bucket);
  }
  const seedRows = [...bySeed.entries()]
    .map(([seed, rows]) => ({
      seed,
      rmseAfterInit: mean(rows.map((row) => row.post_update_position_rmse_after_init)),
    }))
    .sort((left, right) => left.seed - right.seed);

  const earlyMean = mean(
    filteredDetectionRows
      .filter((row) => row.detection_index === 1)
      .map((row) => row.position_error),
  );
  const lateMean = mean(
    filteredDetectionRows
      .filter((row) => row.detection_index >= 5)
      .map((row) => row.position_error),
  );
  const convergenceGain = earlyMean > 0 ? ((earlyMean - lateMean) / earlyMean) * 100 : 0;

  const stabilizedRangeRows = filteredDetectionRows
    .filter((row) => row.detection_index >= 5)
    .slice()
    .sort((left, right) => left.range - right.range);
  const splitIndex = Math.floor(stabilizedRangeRows.length / 2);
  const nearRows = stabilizedRangeRows.slice(0, splitIndex);
  const farRows = stabilizedRangeRows.slice(splitIndex);
  const nearMean = mean(nearRows.map((row) => row.position_error));
  const farMean = mean(farRows.map((row) => row.position_error));
  const nearRangeAvg = mean(nearRows.map((row) => row.range));
  const farRangeAvg = mean(farRows.map((row) => row.range));

  const nonLinearityDelta = coefficientRows.length >= 2
    ? coefficientRows[coefficientRows.length - 1].rmseAfterInit - coefficientRows[0].rmseAfterInit
    : 0;
  const scanDelta = scanRows.length >= 2
    ? scanRows[0].rmseAfterInit - scanRows[scanRows.length - 1].rmseAfterInit
    : 0;
  const seedSpread = seedRows.length >= 2
    ? Math.max(...seedRows.map((row) => row.rmseAfterInit)) - Math.min(...seedRows.map((row) => row.rmseAfterInit))
    : 0;

  const cards = [
    {
      title: "Best run after initialization",
      value: `${formatNumber(bestRun.post_update_position_rmse_after_init, 2)} m`,
      body: `${formatVariantName(bestRun.variant_name)} delivers the lowest post-init position RMSE in the current selection.`,
    },
    {
      title: "Filter convergence after 5 detections",
      value: `${formatNumber(convergenceGain, 1)}%`,
      body: `Mean position error from detection 1 to detection 5+ (${formatNumber(earlyMean, 2)} m -> ${formatNumber(lateMean, 2)} m).`,
    },
    {
      title: "Non-linearity effect on RMSE",
      value: `${formatNumber(nonLinearityDelta, 2)} m`,
      body: coefficientRows.length >= 2
        ? `Change in post-init position RMSE from accel level ${formatNumber(coefficientRows[0].coefficient, 2)} to ${formatNumber(coefficientRows[coefficientRows.length - 1].coefficient, 2)}.`
        : "Need multiple coefficient levels in the current filter.",
    },
    {
      title: "Radar revisit effect on RMSE",
      value: `${formatNumber(scanDelta, 2)} m`,
      body: scanRows.length >= 2
        ? `Post-init position RMSE difference from ${formatNumber(scanRows[0].scanRate, 1)} to ${formatNumber(scanRows[scanRows.length - 1].scanRate, 1)} deg/s.`
        : "Need multiple scan rates in the current filter.",
    },
    {
      title: "Seed spread",
      value: `${formatNumber(seedSpread, 2)} m`,
      body: `Spread of post-init position RMSE across seeds in the current selection.`,
    },
    {
      title: "Range effect on error",
      value: farRows.length && nearRows.length ? `${farMean >= nearMean ? "+" : ""}${formatNumber(farMean - nearMean, 2)} m` : "n/a",
      body: farRows.length && nearRows.length
        ? `Mean position error from avg ${formatNumber(nearRangeAvg, 1)} m to avg ${formatNumber(farRangeAvg, 1)} m (${formatNumber(nearMean, 2)} m -> ${formatNumber(farMean, 2)} m).`
        : "Not enough 5+ detections to compare near and far populations.",
    },
  ];

  for (const card of cards) {
    const article = document.createElement("article");
    article.className = "guided-observation-card";
    article.innerHTML = `
      <h3>${card.title}</h3>
      <p class="guided-observation-value">${card.value}</p>
      <p class="guided-observation-body">${card.body}</p>
    `;
    grid.append(article);
  }

  const commentLines = [
    `Best filtered run: ${formatVariantName(bestRun.variant_name)}. Worst filtered run: ${formatVariantName(worstRun.variant_name)} (${formatNumber(worstRun.post_update_position_rmse_after_init, 2)} m after initialization).`,
    coefficientRows.length >= 2
      ? `Across the selected runs, non-linearity changes after-init position RMSE by ${formatNumber(nonLinearityDelta, 2)} m, while scan-rate changes it by ${formatNumber(scanDelta, 2)} m.`
      : "The current filter fixes non-linearity, so the coefficient effect cannot be compared here.",
    `Filter convergence from detection 1 to 5+ is ${formatNumber(earlyMean, 2)} m -> ${formatNumber(lateMean, 2)} m. Seed spread is ${formatNumber(seedSpread, 2)} m.`,
  ];

  for (const line of commentLines) {
    const item = document.createElement("li");
    item.textContent = line;
    notes.append(item);
  }
}

function renderRuns() {
  const filteredRows = state.runs.filter((row) => rowMatchesGlobalFilter(row)).filter((row) => {
    const term = state.runTable.textFilter.trim().toLowerCase();
    if (!term) return true;
    return [
      formatVariantName(row.variant_name),
      String(row.coefficient),
      String(row.scan_rate_deg_s),
      String(row.seed),
    ].join(" ").toLowerCase().includes(term);
  });
  const sortColumn = RUN_TABLE_COLUMNS.find((column) => column.key === state.runTable.sortKey) ?? RUN_TABLE_COLUMNS[0];
  const multiplier = state.runTable.sortDir === "desc" ? -1 : 1;
  const rows = [...filteredRows].sort((left, right) => {
    const leftValue = left[sortColumn.key];
    const rightValue = right[sortColumn.key];
    if (sortColumn.type === "number") {
      return (leftValue - rightValue) * multiplier;
    }
    return String(leftValue).localeCompare(String(rightValue)) * multiplier;
  });

  const list = document.getElementById("runs-list");
  const summary = document.getElementById("run-comparison-summary");
  list.innerHTML = "";
  summary.textContent = `${rows.length} runs shown`;

  for (const row of rows) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "run-list-item";
    item.innerHTML = `
      <span class="run-list-title">${formatVariantName(row.variant_name)}</span>
      <span class="run-list-meta">coef ${formatNumber(row.coefficient, 2)} | ${formatNumber(row.scan_rate_deg_s, 1)} deg/s | seed ${row.seed}</span>
      <span class="run-list-metrics">RMSE 5+: ${formatNumber(row.post_update_position_rmse_after_init, 2)} m | detections: ${row.total_detections}</span>
    `;
    item.addEventListener("click", () => {
      state.trajectory.coefficientA = String(row.coefficient);
      state.trajectory.scanRateA = String(row.scan_rate_deg_s);
      state.trajectory.seedA = String(row.seed);
      state.trajectory.objectA = "auto";
      renderAll();
    });
    list.append(item);
  }
}

function renderDataDetails() {
  const rows = state.detectionRows
    .filter((row) => rowMatchesGlobalFilter(row))
    .sort((left, right) => {
      if (left.variant_name !== right.variant_name) {
        return left.variant_name.localeCompare(right.variant_name);
      }
      if (left.object_name !== right.object_name) {
        return left.object_name.localeCompare(right.object_name);
      }
      return left.detection_index - right.detection_index;
    });

  const summary = document.getElementById("data-details-summary");
  const tbody = document.getElementById("data-details-body");
  const shownRows = rows.slice(0, 400);
  summary.textContent = `${shownRows.length} rows shown${rows.length > shownRows.length ? ` (filtered from ${rows.length})` : ""}`;
  tbody.innerHTML = "";

  for (const row of shownRows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatVariantName(row.variant_name)}</td>
      <td>${row.object_name}</td>
      <td><span class="category-chip ${categoryClass(row.true_category)}">${categoryLabel(row.true_category)}</span></td>
      <td>${formatNumber(row.coefficient, 2)}</td>
      <td>${formatNumber(row.scan_rate_deg_s, 1)} deg/s</td>
      <td>${row.seed}</td>
      <td>${row.detection_index}</td>
      <td>${formatNumber(row.time, 2)} s</td>
      <td>${formatNumber(row.range, 2)} m</td>
      <td>${formatNumber(row.truth_x, 2)}, ${formatNumber(row.truth_y, 2)}</td>
      <td>${row.measured_x == null ? "n/a" : `${formatNumber(row.measured_x, 2)}, ${formatNumber(row.measured_y, 2)}`}</td>
      <td>${row.estimated_x == null ? "n/a" : `${formatNumber(row.estimated_x, 2)}, ${formatNumber(row.estimated_y, 2)}`}</td>
      <td>${formatNumber(row.position_error, 2)} m</td>
      <td>${formatNumber(row.velocity_error, 2)} m/s</td>
    `;
    tbody.append(tr);
  }
}

function updateTrajectorySelectors() {
  const coeffASelect = document.getElementById("trajectory-coeff-a");
  const scanASelect = document.getElementById("trajectory-scan-a");
  const seedASelect = document.getElementById("trajectory-seed-a");
  const trackASelect = document.getElementById("trajectory-track-a");
  const coeffBSelect = document.getElementById("trajectory-coeff-b");
  const scanBSelect = document.getElementById("trajectory-scan-b");
  const seedBSelect = document.getElementById("trajectory-seed-b");
  const trackBSelect = document.getElementById("trajectory-track-b");
  const {
    availableCoefficients,
    availableScanRatesA,
    availableSeedsA,
    availableObjectsA,
    availableScanRatesB,
    availableSeedsB,
    availableObjectsB,
  } = pickTrajectoryEntries();
  setTrajectorySelectOptions(coeffASelect, availableCoefficients, "a", "coefficient");
  setTrajectorySelectOptions(scanASelect, availableScanRatesA, "a", "scan rate");
  setTrajectorySelectOptions(seedASelect, availableSeedsA, "a", "seed");
  setTrajectorySelectOptions(trackASelect, availableObjectsA, "a", "object");
  setTrajectorySelectOptions(coeffBSelect, availableCoefficients, "b", "coefficient");
  setTrajectorySelectOptions(scanBSelect, availableScanRatesB, "b", "scan rate");
  setTrajectorySelectOptions(seedBSelect, availableSeedsB, "b", "seed");
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
    <div><dt>Run</dt><dd>${formatVariantName(entry.variant_name)}</dd></div>
    <div><dt>Category</dt><dd>${categoryLabel(entry.true_category)}</dd></div>
    <div><dt>Non-linearity</dt><dd>${formatNumber(entry.coefficient, 2)}</dd></div>
    <div><dt>Accel level</dt><dd>${formatNumber(entry.second_order_coefficient, 2)}</dd></div>
    <div><dt>Scan rate (deg/s)</dt><dd>${formatNumber(entry.scan_rate_deg_s, 1)} deg/s</dd></div>
    <div><dt>Seed</dt><dd>${entry.seed}</dd></div>
    <div><dt>Detections</dt><dd>${entry.detection_count}</dd></div>
    <div><dt>Mean range (m)</dt><dd>${formatNumber(meanRange, 1)} m</dd></div>
    <div><dt>Last range (m)</dt><dd>${formatNumber(lastRange, 1)} m</dd></div>
    <div><dt>Mean pos err (m)</dt><dd>${formatNumber(meanPosError, 2)} m</dd></div>
    <div><dt>Max pos err (m)</dt><dd>${formatNumber(maxPosError, 2)} m</dd></div>
    <div><dt>Mean vel err (m/s)</dt><dd>${formatNumber(meanVelError, 2)} m/s</dd></div>
    <div><dt>RMSE Pos (all, m)</dt><dd>${formatNumber(entry.post_update_position_rmse, 2)} m</dd></div>
    <div><dt>RMSE Pos (${state.manifest.post_update_rmse_after_init_skip}+, m)</dt><dd>${formatNumber(entry.post_update_position_rmse_after_init ?? 0, 2)} m</dd></div>
  `;
  const rangeComment = meanRange > 260 ? "observed mostly far from ego" : meanRange > 180 ? "observed at mid range" : "observed relatively close to ego";
  const dynamicsComment = entry.second_order_coefficient >= 0.5 ? "stronger non-linearity" : "milder dynamics";
  const revisitComment = entry.scan_rate_deg_s >= 45 ? "faster radar revisit" : entry.scan_rate_deg_s <= 32 ? "slower radar revisit" : "baseline radar revisit";
  const detectionComment = entry.detection_count >= 12 ? "well supported by repeated detections" : "supported by relatively few detections";
  note.textContent = `${rangeComment}, with ${dynamicsComment}, ${revisitComment}, and ${detectionComment}.`;
}

function fillTrackDetectionTable(rootId, entry) {
  const tbody = document.getElementById(rootId);
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!entry) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="7">No track selected.</td>`;
    tbody.append(tr);
    return;
  }

  const measuredByIndex = new Map(entry.measured_points.map((point) => [point.index, point]));
  const estimatedByIndex = new Map(entry.estimated_path.map((point) => [point.index, point]));

  for (const meta of entry.detection_meta) {
    const measured = measuredByIndex.get(meta.index);
    const estimated = estimatedByIndex.get(meta.index);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${meta.index}</td>
      <td>${formatNumber(meta.range, 1)} m</td>
      <td>${formatNumber(meta.truth_x, 1)}, ${formatNumber(meta.truth_y, 1)}</td>
      <td>${measured ? `${formatNumber(measured.x, 1)}, ${formatNumber(measured.y, 1)}` : "n/a"}</td>
      <td>${estimated ? `${formatNumber(estimated.x, 1)}, ${formatNumber(estimated.y, 1)}` : "n/a"}</td>
      <td>${formatNumber(meta.position_error, 2)} m</td>
      <td>${formatNumber(meta.velocity_error, 2)} m/s</td>
    `;
    tbody.append(tr);
  }
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
  fillTrackDetectionTable("trajectory-a-detections", trackA);
  fillTrackDetectionTable("trajectory-b-detections", trackB);

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
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(159, 177, 207, 0.8)";
  ctx.fillText("ego-centred frame (m)", width - 18, 20);
  ctx.textAlign = "left";

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
  renderGuidedObservations();
  renderRuns();
  updateTrajectorySelectors();
  drawTrajectoryPanel();
}

function bindGlobalFilters() {
  const scenarioSelect = document.getElementById("filter-scenario");
  const coefficientSelect = document.getElementById("filter-coefficient");
  const scanRateSelect = document.getElementById("filter-scan-rate");
  const seedSelect = document.getElementById("filter-seed");
  const objectSelect = document.getElementById("filter-object");
  const categorySelect = document.getElementById("filter-category");

  if (!scenarioSelect || !coefficientSelect || !scanRateSelect || !seedSelect || !objectSelect || !categorySelect) {
    return;
  }

  setSelectOptions(scenarioSelect, state.manifest.filters.base_scenarios);
  setSelectOptions(coefficientSelect, state.manifest.filters.coefficients, (value) => formatNumber(value, 2));
  setSelectOptions(scanRateSelect, state.manifest.filters.scan_rates_deg_s, (value) => `${formatNumber(value, 1)} deg/s`, "All scan rates");
  setSelectOptions(seedSelect, state.manifest.filters.seeds, (value) => String(value), "All seeds");
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
  scanRateSelect.addEventListener("change", () => {
    state.filters.scanRate = scanRateSelect.value;
    renderAll();
  });
  seedSelect.addEventListener("change", () => {
    state.filters.seed = seedSelect.value;
    renderAll();
  });
  objectSelect.addEventListener("change", () => {
    state.filters.objectName = objectSelect.value;
    if (objectSelect.value !== "all") {
      state.trajectory.objectA = objectSelect.value;
    }
    renderAll();
  });
  categorySelect.addEventListener("change", () => {
    state.filters.category = categorySelect.value;
    renderAll();
  });
}

function bindRunTableControls() {
  const sortKeySelect = document.getElementById("runs-sort-key");
  const sortDirSelect = document.getElementById("runs-sort-dir");
  const filterInput = document.getElementById("runs-text-filter");

  sortKeySelect.addEventListener("change", () => {
    state.runTable.sortKey = sortKeySelect.value;
    renderRuns();
  });
  sortDirSelect.addEventListener("change", () => {
    state.runTable.sortDir = sortDirSelect.value;
    renderRuns();
  });
  filterInput.addEventListener("input", () => {
    state.runTable.textFilter = filterInput.value;
    renderRuns();
  });
}

function bindTrajectoryFilters() {
  const coeffASelect = document.getElementById("trajectory-coeff-a");
  const scanASelect = document.getElementById("trajectory-scan-a");
  const seedASelect = document.getElementById("trajectory-seed-a");
  const trackASelect = document.getElementById("trajectory-track-a");
  const coeffBSelect = document.getElementById("trajectory-coeff-b");
  const scanBSelect = document.getElementById("trajectory-scan-b");
  const seedBSelect = document.getElementById("trajectory-seed-b");
  const trackBSelect = document.getElementById("trajectory-track-b");

  coeffASelect.addEventListener("change", () => {
    state.trajectory.coefficientA = coeffASelect.value;
    state.trajectory.scanRateA = "auto";
    state.trajectory.seedA = "auto";
    state.trajectory.objectA = "auto";
    renderAll();
  });
  scanASelect.addEventListener("change", () => {
    state.trajectory.scanRateA = scanASelect.value;
    state.trajectory.seedA = "auto";
    state.trajectory.objectA = "auto";
    renderAll();
  });
  seedASelect.addEventListener("change", () => {
    state.trajectory.seedA = seedASelect.value;
    state.trajectory.objectA = "auto";
    renderAll();
  });
  coeffBSelect.addEventListener("change", () => {
    state.trajectory.coefficientB = coeffBSelect.value;
    state.trajectory.scanRateB = "auto";
    state.trajectory.seedB = "auto";
    state.trajectory.objectB = coeffBSelect.value === "none" ? "none" : "auto";
    renderAll();
  });
  scanBSelect.addEventListener("change", () => {
    state.trajectory.scanRateB = scanBSelect.value;
    state.trajectory.seedB = "auto";
    state.trajectory.objectB = "auto";
    renderAll();
  });
  seedBSelect.addEventListener("change", () => {
    state.trajectory.seedB = seedBSelect.value;
    state.trajectory.objectB = "auto";
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
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${path}${separator}v=${encodeURIComponent(DATA_VERSION)}`);
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
  state.detectionRows = flattenDetectionRows(state.objectTrajectories);
  bindGlobalFilters();
  renderRunTableControls();
  bindRunTableControls();
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

