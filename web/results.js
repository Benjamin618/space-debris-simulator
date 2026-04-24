const DATA_ROOT = "./data/analysis/analysis_v1";

function formatNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "n/a";
  return numeric.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rmse(values) {
  if (!values.length) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

function percentDelta(reference, value) {
  if (!reference) return "n/a";
  const delta = ((value - reference) / reference) * 100;
  return `${delta >= 0 ? "+" : ""}${formatNumber(delta, 0)}%`;
}

function percentValue(reference, value) {
  if (!reference) return 0;
  return (value / reference) * 100;
}

function formatVariantName(value) {
  return String(value)
    .replace("scenario_analysis_minimal_", "")
    .replaceAll("_", " ")
    .replace(/\bcoef\b/g, "accel")
    .replace(/\bscan\b/g, "scan")
    .replace(/\bradar\b/g, "radar")
    .replace(/\bseed\b/g, "seed");
}

async function loadJson(path) {
  const response = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.json();
}

function metricCard(label, value, unit) {
  return `
    <article class="summary-card">
      <p class="summary-card-label">${label}</p>
      <p class="summary-card-value">${value}</p>
      <p class="summary-card-unit">${unit}</p>
    </article>
  `;
}

function findingLinePlot(series, color, referenceIndex = 1) {
  const width = 264;
  const height = 128;
  const plotLeft = 16;
  const plotRight = width - 16;
  const plotTop = 18;
  const plotBottom = 76;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const values = series.map((item) => item.value);
  const minValue = Math.min(...values, 100);
  const maxValue = Math.max(...values, 100);
  const spread = Math.max(10, maxValue - minValue);
  const domainMin = minValue - spread * 0.18;
  const domainMax = maxValue + spread * 0.18;

  const xForIndex = (index) => plotLeft + (plotWidth * index) / Math.max(1, series.length - 1);
  const yForValue = (value) => plotBottom - ((value - domainMin) / (domainMax - domainMin)) * plotHeight;

  const refY = yForValue(100);
  const path = series.map((item, index) => {
    const x = xForIndex(index);
    const y = yForValue(item.value);
    return `${index === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ");

  const points = series.map((item, index) => {
    const x = xForIndex(index);
    const y = yForValue(item.value);
    const isReference = index === referenceIndex;
    return `
      <g>
        <circle cx="${x}" cy="${y}" r="${isReference ? 5.5 : 4.5}" fill="${color}" opacity="${isReference ? 1 : 0.84}"></circle>
        <circle cx="${x}" cy="${y}" r="${isReference ? 9 : 0}" fill="${color}" opacity="0.12"></circle>
        <text x="${x}" y="${y - 10}" text-anchor="middle" fill="rgba(237,243,255,0.94)" font-size="10" font-family="IBM Plex Sans">${formatNumber(item.value, 0)}%</text>
        <text x="${x}" y="${height - 10}" text-anchor="middle" fill="rgba(159,177,207,0.96)" font-size="11" font-family="IBM Plex Sans">${item.label}</text>
      </g>
    `;
  }).join("");

  return `
    <svg class="results-finding-chart" viewBox="0 0 ${width} ${height}" role="img" aria-hidden="true">
      <line x1="${plotLeft}" y1="${refY}" x2="${plotRight}" y2="${refY}" stroke="rgba(237,243,255,0.3)" stroke-dasharray="4 4" stroke-width="1.4"></line>
      <text x="${plotRight}" y="${refY - 6}" text-anchor="end" fill="rgba(237,243,255,0.74)" font-size="10" font-family="IBM Plex Sans">100% ref</text>
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path>
      ${points}
    </svg>
  `;
}

function findingCard(title, metric, body, series, tone = "neutral", referenceIndex = 1) {
  const color = tone === "warning" ? "rgba(255, 214, 102, 0.92)" : "rgba(86, 214, 255, 0.92)";
  return `
    <article class="results-finding-card results-finding-card-${tone}">
      <h3>${title}</h3>
      ${findingLinePlot(series, color, referenceIndex)}
      <p class="results-finding-metric">${metric}</p>
      <p>${body}</p>
    </article>
  `;
}

function buildFindingMetrics(runs, trajectories) {
  const byCoefficient = new Map();
  const byScanRate = new Map();
  const byPrecision = new Map();

  for (const row of runs) {
    const coefficient = Number(row.coefficient);
    const scanRate = Number(row.scan_rate_deg_s);
    const precision = Number(row.bearing_noise_factor ?? 1);
    const rmse5 = Number(row.post_update_position_rmse_after_init);

    if (!byCoefficient.has(coefficient)) byCoefficient.set(coefficient, []);
    if (!byScanRate.has(scanRate)) byScanRate.set(scanRate, []);
    if (!byPrecision.has(precision)) byPrecision.set(precision, []);

    byCoefficient.get(coefficient).push(rmse5);
    byScanRate.get(scanRate).push(rmse5);
    byPrecision.get(precision).push(rmse5);
  }

  const coefficientMean = (value) => mean(byCoefficient.get(value) ?? []);
  const scanMean = (value) => mean(byScanRate.get(value) ?? []);
  const precisionMean = (value) => mean(byPrecision.get(value) ?? []);

  const init1 = [];
  const init2 = [];
  const init3 = [];
  const init4 = [];
  const init5Plus = [];
  const rangeRows = [];

  for (const entry of trajectories) {
    const coefficient = Number(entry.coefficient);
    for (const detection of entry.detection_meta ?? []) {
      const index = Number(detection.index);
      const error = Number(detection.position_error);
      const range = Number(detection.range);

      if (coefficient === 0.0) {
        if (index === 1) init1.push(error);
        if (index === 2) init2.push(error);
        if (index === 3) init3.push(error);
        if (index === 4) init4.push(error);
        if (index >= 5) init5Plus.push(error);
      }

      if (coefficient === 0.5 && index >= 5) {
        rangeRows.push({ range, error });
      }
    }
  }

  rangeRows.sort((left, right) => left.range - right.range);
  const third = Math.floor(rangeRows.length / 3);
  const closeRows = rangeRows.slice(0, third);
  const midRows = rangeRows.slice(third, rangeRows.length - third);
  const farRows = rangeRows.slice(rangeRows.length - third);

  const extremes = [...runs].sort(
    (left, right) => Number(left.post_update_position_rmse_after_init) - Number(right.post_update_position_rmse_after_init),
  );

  return {
    coefficientMean,
    scanMean,
    precisionMean,
    init1Rmse: rmse(init1),
    init2Rmse: rmse(init2),
    init3Rmse: rmse(init3),
    init4Rmse: rmse(init4),
    init5PlusRmse: rmse(init5Plus),
    closeRangeMean: mean(closeRows.map((row) => row.range)),
    midRangeMean: mean(midRows.map((row) => row.range)),
    farRangeMean: mean(farRows.map((row) => row.range)),
    closeRangeRmse: rmse(closeRows.map((row) => row.error)),
    midRangeRmse: rmse(midRows.map((row) => row.error)),
    farRangeRmse: rmse(farRows.map((row) => row.error)),
    bestRun: extremes[0] ?? null,
    worstRun: extremes[extremes.length - 1] ?? null,
  };
}

function renderSummaryCards(overview) {
  const root = document.getElementById("results-summary-cards");
  const cards = overview.summary_cards;
  root.innerHTML = [
    metricCard("Runs Compared", formatNumber(cards.find((card) => card.key === "runs_compared")?.value ?? 0, 0), "runs"),
    metricCard("Run Duration", formatNumber(overview.experiment.durations_s?.[0] ?? 0, 0), "s"),
    metricCard("Position RMSE (5+)", formatNumber(cards.find((card) => card.key === "mean_post_update_position_rmse_after_init")?.value ?? 0, 2), "m"),
    metricCard("Velocity RMSE (5+)", formatNumber(cards.find((card) => card.key === "mean_post_update_velocity_rmse_after_init")?.value ?? 0, 2), "m/s"),
  ].join("");
}

function renderFindings(metrics) {
  const root = document.getElementById("results-findings-grid");
  const accelerationLow = metrics.coefficientMean(0.0);
  const accelerationNominal = metrics.coefficientMean(0.5);
  const accelerationHigh = metrics.coefficientMean(1.0);
  const scanSlow = metrics.scanMean(20.0);
  const scanNominal = metrics.scanMean(40.0);
  const scanFast = metrics.scanMean(80.0);
  const precisionLow = metrics.precisionMean(2.0);
  const precisionNominal = metrics.precisionMean(1.0);
  const precisionHigh = metrics.precisionMean(0.5);

  root.innerHTML = [
    findingCard(
      "Error drops after repeated detections",
      `${percentDelta(metrics.init1Rmse, metrics.init5PlusRmse)} from detection 1 to 5+`,
      `On linear cases only, the 5+ regime cuts position error by ${percentDelta(metrics.init1Rmse, metrics.init5PlusRmse)} relative to detection 1. The benefit appears over repeated revisits rather than on the first correction alone.`,
      [
        { label: "1", value: percentValue(metrics.init1Rmse, metrics.init1Rmse) },
        { label: "2", value: percentValue(metrics.init1Rmse, metrics.init2Rmse) },
        { label: "3", value: percentValue(metrics.init1Rmse, metrics.init3Rmse) },
        { label: "4", value: percentValue(metrics.init1Rmse, metrics.init4Rmse) },
        { label: "5+", value: percentValue(metrics.init1Rmse, metrics.init5PlusRmse) },
      ],
      "positive",
      0,
    ),
    findingCard(
      "Acceleration mismatch is the main tracker stressor",
      `${percentDelta(accelerationNominal, accelerationHigh)} at double accel vs nominal`,
      `Relative to the nominal accel case 0.50, moving to accel 1.00 increases RMSE by ${percentDelta(accelerationNominal, accelerationHigh)}. This is the strongest dynamics-driven degradation in the batch.`,
      [
        { label: "no", value: percentValue(accelerationNominal, accelerationLow) },
        { label: "nom", value: percentValue(accelerationNominal, accelerationNominal) },
        { label: "dbl", value: percentValue(accelerationNominal, accelerationHigh) },
      ],
      "warning",
      1,
    ),
    findingCard(
      "Faster radar revisit improves the estimate",
      `${percentDelta(scanSlow, scanFast)} from low to high revisit`,
      `Moving from 20 deg/s to 80 deg/s lowers RMSE by ${percentDelta(scanSlow, scanFast)}. Faster revisit means the tracker spends less time propagating without correction.`,
      [
        { label: "low", value: percentValue(scanNominal, scanSlow) },
        { label: "nom", value: percentValue(scanNominal, scanNominal) },
        { label: "high", value: percentValue(scanNominal, scanFast) },
      ],
      "positive",
      1,
    ),
    findingCard(
      "Better radar precision reduces tracking error",
      `${percentDelta(precisionLow, precisionHigh)} from low to high precision`,
      `Across the precision sweep, high radar precision reduces RMSE by ${percentDelta(precisionLow, precisionHigh)} relative to low precision. The sensing side of the trade-off is clearly visible.`,
      [
        { label: "low", value: percentValue(precisionNominal, precisionLow) },
        { label: "nom", value: percentValue(precisionNominal, precisionNominal) },
        { label: "high", value: percentValue(precisionNominal, precisionHigh) },
      ],
      "positive",
      1,
    ),
    findingCard(
      "Farther detections are harder to estimate",
      `${percentDelta(metrics.closeRangeRmse, metrics.farRangeRmse)} from close to far range`,
      `With accel 0.50 only, far detections show ${percentDelta(metrics.closeRangeRmse, metrics.farRangeRmse)} higher RMSE than close detections. This is the cleanest distance effect in the current dataset.`,
      [
        { label: "close", value: percentValue(metrics.midRangeRmse, metrics.closeRangeRmse) },
        { label: "mid", value: percentValue(metrics.midRangeRmse, metrics.midRangeRmse) },
        { label: "far", value: percentValue(metrics.midRangeRmse, metrics.farRangeRmse) },
      ],
      "warning",
      1,
    ),
  ].join("");
}

function renderExperiment(overview) {
  const root = document.getElementById("results-experiment-list");
  const experiment = overview.experiment;
  root.innerHTML = `
    <div><dt>Scenario</dt><dd>${experiment.base_scenarios.join(", ")}</dd></div>
    <div><dt>Truth model</dt><dd>Bounded second-order</dd></div>
    <div><dt>Tracker model</dt><dd>First-order constant velocity Kalman</dd></div>
    <div><dt>Acceleration levels</dt><dd>${experiment.coefficients.map((value) => formatNumber(value, 2)).join(", ")}</dd></div>
    <div><dt>Radar revisit</dt><dd>${experiment.scan_rates_deg_s.map((value) => `${formatNumber(value, 0)} deg/s`).join(", ")}</dd></div>
    <div><dt>Radar precision factors</dt><dd>${experiment.bearing_noise_factors.map((value) => `${formatNumber(value, 1)}x`).join(", ")}</dd></div>
    <div><dt>Seeds</dt><dd>${experiment.seeds.join(", ")}</dd></div>
    <div><dt>Objects per run</dt><dd>3 tracked objects</dd></div>
    <div><dt>RMSE after init</dt><dd>Computed after ${experiment.post_update_rmse_after_init_skip}+ detections</dd></div>
  `;
}

function renderExtremes(metrics) {
  const root = document.getElementById("results-extremes");
  const bestRun = metrics.bestRun;
  const worstRun = metrics.worstRun;
  root.innerHTML = `
    <article class="results-extreme-card results-extreme-card-best">
      <p class="results-extreme-label">Best run</p>
      <h3>${bestRun ? formatVariantName(bestRun.variant_name) : "n/a"}</h3>
      <p class="results-extreme-value">${bestRun ? `${formatNumber(bestRun.post_update_position_rmse_after_init, 2)} m` : "n/a"}</p>
      <p>Fast revisit, high precision, and low non-linearity define the cleanest case in the current batch.</p>
    </article>
    <article class="results-extreme-card results-extreme-card-worst">
      <p class="results-extreme-label">Worst run</p>
      <h3>${worstRun ? formatVariantName(worstRun.variant_name) : "n/a"}</h3>
      <p class="results-extreme-value">${worstRun ? `${formatNumber(worstRun.post_update_position_rmse_after_init, 2)} m` : "n/a"}</p>
      <p>Slow revisit, degraded radar precision, and strong non-linearity combine into the hardest regime for this tracker.</p>
    </article>
  `;
}

function renderNotes(overview, metrics) {
  const root = document.getElementById("results-notes");
  const spreadRatio = metrics.bestRun && metrics.worstRun
    ? Number(metrics.worstRun.post_update_position_rmse_after_init) / Number(metrics.bestRun.post_update_position_rmse_after_init)
    : 0;
  root.innerHTML = [
    ...overview.notes,
    `The current batch spans about ${formatNumber(spreadRatio, 1)}x between best and worst RMSE 5+ runs, which makes condition effects visible even without reading the detailed analysis tables.`,
    "The page intentionally prioritizes relative trends and normalized charts so the conclusions survive moderate changes in scenario scaling.",
  ].map((line) => `<li>${line}</li>`).join("");
}

async function bootstrap() {
  const [overview, runs, trajectories] = await Promise.all([
    loadJson(`${DATA_ROOT}/overview.json`),
    loadJson(`${DATA_ROOT}/runs.json`),
    loadJson(`${DATA_ROOT}/object_trajectories.json`),
  ]);

  const metrics = buildFindingMetrics(runs, trajectories);
  renderSummaryCards(overview);
  renderFindings(metrics);
  renderExperiment(overview);
  renderExtremes(metrics);
  renderNotes(overview, metrics);
}

bootstrap().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<pre style="padding: 24px; color: white;">Failed to load results page.\n${error.message}</pre>`;
});
