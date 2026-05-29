const $ = (id) => document.getElementById(id);

const els = {
  cultureVolume: $('cultureVolume'), cultureVolumeOut: $('cultureVolumeOut'),
  od: $('od'), odOut: $('odOut'),
  cellsAtODLog: $('cellsAtODLog'), cellsAtODOut: $('cellsAtODOut'),
  susceptibility: $('susceptibility'),
  doseMode: $('doseMode'), moiLog: $('moiLog'), moiOut: $('moiOut'),
  totalPfuLog: $('totalPfuLog'), totalPfuOut: $('totalPfuOut'),
  stockTiterLog: $('stockTiterLog'), stockTiterOut: $('stockTiterOut'),
  adsorptionTime: $('adsorptionTime'), adsorptionTimeOut: $('adsorptionTimeOut'),
  adsorptionRate: $('adsorptionRate'), adsorptionRateOut: $('adsorptionRateOut'),
  virucide: $('virucide'), virucideSurvivalLog: $('virucideSurvivalLog'), virucideSurvivalOut: $('virucideSurvivalOut'),
  burstSize: $('burstSize'), burstSizeOut: $('burstSizeOut'),
  burstTime: $('burstTime'), burstTimeOut: $('burstTimeOut'),
  graphDuration: $('graphDuration'), graphDurationOut: $('graphDurationOut'),
  dilution: $('dilution'), platedVolume: $('platedVolume'), platedVolumeOut: $('platedVolumeOut'),
  sampleTime: $('sampleTime'), sampleTimeOut: $('sampleTimeOut'),
  canvas: $('growthChart'), tooltip: $('tooltip'), plateSvg: $('plateSvg'),
  metrics: $('metrics'), heroPfu: $('heroPfu'), heroTime: $('heroTime'), heroPlaques: $('heroPlaques'),
  plateSummary: $('plateSummary'), resetBtn: $('resetBtn'), exportCsvBtn: $('exportCsvBtn'), copyParamsBtn: $('copyParamsBtn'),
  presetMcgavigan: $('presetMcgavigan'), presetFast: $('presetFast'),
  moiControl: $('moiControl'), pfuControl: $('pfuControl'), virucideSurvivalControl: $('virucideSurvivalControl')
};

const ctx = els.canvas.getContext('2d');
let chartBounds = null;
let lastModel = null;
let isDragging = false;

function formatSci(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e4 || abs < 0.01) {
    const exp = Math.floor(Math.log10(abs));
    const mant = value / Math.pow(10, exp);
    return `${mant.toFixed(digits)}×10^${exp}`;
  }
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatCount(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  if (value >= 10) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

function formatMinutes(min) {
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  return `${Math.round(min)} min`;
}

function readParams() {
  const cultureVolumeMl = parseFloat(els.cultureVolume.value);
  const od600 = parseFloat(els.od.value);
  const cellsPerMlAtOD025 = Math.pow(10, parseFloat(els.cellsAtODLog.value));
  const cellsPerMl = cellsPerMlAtOD025 * (od600 / 0.25);
  const susceptibleFraction = parseFloat(els.susceptibility.value);
  const susceptibleCellsPerMl = cellsPerMl * susceptibleFraction;
  const totalCells = cellsPerMl * cultureVolumeMl;
  const doseMode = els.doseMode.value;
  const targetMoi = Math.pow(10, parseFloat(els.moiLog.value));
  const sliderTotalPfu = Math.pow(10, parseFloat(els.totalPfuLog.value));
  const totalPfuAdded = doseMode === 'moi' ? targetMoi * totalCells : sliderTotalPfu;
  const realizedMoiTotal = totalCells > 0 ? totalPfuAdded / totalCells : 0;
  const realizedMoiSusceptible = (susceptibleCellsPerMl * cultureVolumeMl) > 0 ? totalPfuAdded / (susceptibleCellsPerMl * cultureVolumeMl) : 0;
  const startingPfuPerMl = cultureVolumeMl > 0 ? totalPfuAdded / cultureVolumeMl : 0;
  const stockTiter = Math.pow(10, parseFloat(els.stockTiterLog.value));
  const phageStockVolumeMl = stockTiter > 0 ? totalPfuAdded / stockTiter : 0;

  return {
    cultureVolumeMl,
    od600,
    cellsPerMlAtOD025,
    cellsPerMl,
    susceptibleFraction,
    susceptibleCellsPerMl,
    totalCells,
    doseMode,
    targetMoi,
    totalPfuAdded,
    realizedMoiTotal,
    realizedMoiSusceptible,
    startingPfuPerMl,
    stockTiter,
    phageStockVolumeMl,
    adsorptionTime: parseFloat(els.adsorptionTime.value),
    adsorptionRateConstant: parseFloat(els.adsorptionRate.value) * 1e-9,
    virucide: els.virucide.checked,
    virucideSurvival: Math.pow(10, parseFloat(els.virucideSurvivalLog.value)),
    burstSize: parseFloat(els.burstSize.value),
    burstTime: parseFloat(els.burstTime.value),
    graphDuration: parseFloat(els.graphDuration.value),
    dilutionFactor: Math.pow(10, parseInt(els.dilution.value, 10)),
    dilutionExponent: parseInt(els.dilution.value, 10),
    platedVolumeMl: parseFloat(els.platedVolume.value) / 1000,
    sampleTime: parseFloat(els.sampleTime.value)
  };
}

function releaseFraction(ageMin, risePeriodMin) {
  if (ageMin <= 0) return 0;
  if (ageMin >= risePeriodMin) return 1;
  const x = ageMin / risePeriodMin;
  return x * x * (3 - 2 * x);
}

function simulate(params) {
  const maxT = params.graphDuration;
  const dt = Math.max(0.5, maxT / 600);
  const points = [];
  const S = params.susceptibleCellsPerMl;
  const P0 = params.startingPfuPerMl;
  const k = params.adsorptionRateConstant;
  const A = params.adsorptionTime;
  const adsorptionTerm = k * S;
  const adsorptionFractionAtA = S > 0 && P0 > 0 && A > 0 ? 1 - Math.exp(-adsorptionTerm * A) : 0;
  const adsorbedPerMl = P0 * adsorptionFractionAtA;
  const freeAfterAdsorptionBeforeVirucide = Math.max(0, P0 - adsorbedPerMl);
  const freeAfterVirucide = freeAfterAdsorptionBeforeVirucide * (params.virucide ? params.virucideSurvival : 1);

  let infectedCellsPerMl = 0;
  if (S > 0 && adsorbedPerMl > 0) {
    infectedCellsPerMl = S * (1 - Math.exp(-adsorbedPerMl / S));
  }

  const infectionBins = [];
  if (A > 0 && infectedCellsPerMl > 0 && adsorbedPerMl > 0) {
    const steps = Math.max(10, Math.ceil(A * 3));
    const binDt = A / steps;
    let totalWeight = 0;
    const raw = [];
    for (let i = 0; i < steps; i++) {
      const tMid = (i + 0.5) * binDt;
      const density = adsorptionTerm * P0 * Math.exp(-adsorptionTerm * tMid);
      const weight = density * binDt;
      raw.push({ t: tMid, weight });
      totalWeight += weight;
    }
    for (const r of raw) {
      infectionBins.push({ t: r.t, infected: infectedCellsPerMl * (r.weight / totalWeight) });
    }
  }

  const risePeriod = Math.max(3, params.burstTime * 0.15);
  for (let t = 0; t <= maxT + 0.0001; t += dt) {
    let free;
    if (t <= A) {
      free = P0 * Math.exp(-adsorptionTerm * t);
    } else {
      free = freeAfterVirucide;
    }

    let released = 0;
    for (const bin of infectionBins) {
      const ageSinceLatentEnd = t - bin.t - params.burstTime;
      released += bin.infected * params.burstSize * releaseFraction(ageSinceLatentEnd, risePeriod);
    }
    const pfuPerMl = Math.max(0, free + released);
    points.push({ t, free, released, pfuPerMl });
  }

  return {
    params,
    points,
    adsorptionFractionAtA,
    adsorbedPerMl,
    freeAfterAdsorptionBeforeVirucide,
    freeAfterVirucide,
    infectedCellsPerMl,
    infectedFractionOfSusceptible: S > 0 ? infectedCellsPerMl / S : 0,
    risePeriod,
    plateauPfuPerMl: freeAfterVirucide + infectedCellsPerMl * params.burstSize
  };
}

function interpPoint(points, t) {
  if (!points.length) return { t, pfuPerMl: 0, free: 0, released: 0 };
  if (t <= points[0].t) return points[0];
  if (t >= points[points.length - 1].t) return points[points.length - 1];
  for (let i = 1; i < points.length; i++) {
    if (points[i].t >= t) {
      const a = points[i - 1], b = points[i];
      const f = (t - a.t) / (b.t - a.t);
      return {
        t,
        free: a.free + (b.free - a.free) * f,
        released: a.released + (b.released - a.released) * f,
        pfuPerMl: a.pfuPerMl + (b.pfuPerMl - a.pfuPerMl) * f
      };
    }
  }
  return points[points.length - 1];
}

function expectedPlaquesFor(model, sampleTime = model.params.sampleTime) {
  const p = model.params;
  const selected = interpPoint(model.points, sampleTime);
  // Dilution options are stored as the fraction of the original sample that reaches the plate.
  // Example: 10^-5 means one ten-thousandth of the original PFU/mL is plated.
  const expectedPlaques = selected.pfuPerMl * p.dilutionFactor * p.platedVolumeMl;
  return { selected, expectedPlaques };
}

function probabilityAtLeastOne(lambda) {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;
  return 1 - Math.exp(-lambda);
}

function updateOutputs(params, model) {
  els.cultureVolumeOut.value = `${params.cultureVolumeMl.toFixed(params.cultureVolumeMl < 10 ? 1 : 0)} mL`;
  els.odOut.value = params.od600.toFixed(2);
  els.cellsAtODOut.value = `${formatSci(params.cellsPerMlAtOD025)} /mL`;
  els.moiOut.value = formatSci(Math.pow(10, parseFloat(els.moiLog.value)), 2);
  els.totalPfuOut.value = `${formatSci(params.doseMode === 'moi' ? params.totalPfuAdded : Math.pow(10, parseFloat(els.totalPfuLog.value)))} PFU`;
  els.stockTiterOut.value = `${formatSci(params.stockTiter)} PFU/mL`;
  els.adsorptionTimeOut.value = formatMinutes(params.adsorptionTime);
  els.adsorptionRateOut.value = `${(params.adsorptionRateConstant / 1e-9).toFixed(1)}×10^-9 mL/min`;
  els.virucideSurvivalOut.value = `${formatSci(params.virucideSurvival * 100, 1)}%`;
  els.burstSizeOut.value = `${params.burstSize.toFixed(0)} PFU/cell`;
  els.burstTimeOut.value = formatMinutes(params.burstTime);
  els.graphDurationOut.value = formatMinutes(params.graphDuration);
  els.platedVolumeOut.value = `${(params.platedVolumeMl * 1000).toFixed(0)} µL`;
  els.sampleTimeOut.value = formatMinutes(params.sampleTime);

  els.moiControl.classList.toggle('disabled', params.doseMode !== 'moi');
  els.pfuControl.classList.toggle('disabled', params.doseMode !== 'pfu');
  els.virucideSurvivalControl.classList.toggle('disabled', !params.virucide);

  const { selected, expectedPlaques } = expectedPlaquesFor(model, params.sampleTime);
  els.heroPfu.textContent = `${formatSci(selected.pfuPerMl)} PFU/mL`;
  els.heroTime.textContent = formatMinutes(params.sampleTime);
  els.heroPlaques.textContent = formatCount(expectedPlaques);

  const metricData = [
    [formatSci(params.cellsPerMl), 'Total bacteria concentration'],
    [formatSci(params.susceptibleCellsPerMl), 'Susceptible bacteria per mL'],
    [formatSci(params.totalPfuAdded), 'Total phage dose added'],
    [formatSci(params.realizedMoiTotal), 'Realized MOI across all bacteria'],
    [formatSci(params.realizedMoiSusceptible), 'Effective MOI among susceptible bacteria'],
    [`${(model.adsorptionFractionAtA * 100).toFixed(1)}%`, 'Predicted phage adsorption during incubation'],
    [formatSci(model.infectedCellsPerMl), 'Productively infected cells per mL'],
    [`${(model.infectedFractionOfSusceptible * 100).toFixed(1)}%`, 'Susceptible cells productively infected'],
    [formatSci(model.freeAfterVirucide), 'Free phage after adsorption/virucide'],
    [formatSci(model.plateauPfuPerMl), 'Single-cycle plateau PFU/mL'],
    [`${formatCount(params.phageStockVolumeMl * 1000)} µL`, 'Phage stock volume required'],
    [`${formatMinutes(params.burstTime)} + ${formatMinutes(model.risePeriod)} rise`, 'Latent period and smoothed rise']
  ];
  els.metrics.innerHTML = metricData.map(([value, label]) => `<div class="metric-card"><strong>${value}</strong><span>${label}</span></div>`).join('');
}

function drawChart(model) {
  const canvas = els.canvas;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const pad = { l: 82, r: 32, t: 32, b: 68 };
  const left = pad.l, right = w - pad.r, top = pad.t, bottom = h - pad.b;
  const plotW = right - left, plotH = bottom - top;
  const maxT = model.params.graphDuration;
  const maxY = Math.max(...model.points.map(p => p.pfuPerMl), 10);
  const minPositive = Math.max(1, Math.min(...model.points.filter(p => p.pfuPerMl > 0).map(p => p.pfuPerMl), 1));
  const yMin = Math.max(1, Math.pow(10, Math.floor(Math.log10(minPositive)) - 1));
  const yMax = Math.pow(10, Math.ceil(Math.log10(maxY)) + 0.05);

  const xScale = (t) => left + (t / maxT) * plotW;
  const yScale = (y) => {
    const ly = Math.log10(Math.max(y, yMin));
    const a = Math.log10(yMin), b = Math.log10(yMax);
    return bottom - ((ly - a) / (b - a)) * plotH;
  };
  chartBounds = { left, right, top, bottom, plotW, plotH, xScale, yScale, yMin, yMax, maxT };

  const grad = ctx.createLinearGradient(0, top, 0, bottom);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#eef4ff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, plotW, plotH);
  ctx.clip();

  if (model.params.adsorptionTime > 0) {
    ctx.fillStyle = 'rgba(63, 124, 255, 0.10)';
    ctx.fillRect(left, top, Math.min(plotW, xScale(model.params.adsorptionTime) - left), plotH);
  }

  const burstX = xScale(Math.min(maxT, model.params.burstTime));
  ctx.strokeStyle = 'rgba(23, 160, 131, 0.35)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(burstX, top);
  ctx.lineTo(burstX, bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  const adsX = xScale(Math.min(maxT, model.params.adsorptionTime));
  ctx.strokeStyle = 'rgba(63, 124, 255, 0.42)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 7]);
  ctx.beginPath();
  ctx.moveTo(adsX, top);
  ctx.lineTo(adsX, bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.lineWidth = 4;
  ctx.strokeStyle = '#3f7cff';
  ctx.beginPath();
  model.points.forEach((p, i) => {
    const x = xScale(p.t), y = yScale(p.pfuPerMl);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(23, 160, 131, 0.62)';
  ctx.beginPath();
  model.points.forEach((p, i) => {
    const x = xScale(p.t), y = yScale(Math.max(p.released, yMin));
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.restore();

  ctx.strokeStyle = 'rgba(22, 32, 51, 0.14)';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#607089';
  ctx.font = '24px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const yStartExp = Math.floor(Math.log10(yMin));
  const yEndExp = Math.ceil(Math.log10(yMax));
  for (let e = yStartExp; e <= yEndExp; e++) {
    const val = Math.pow(10, e);
    const y = yScale(val);
    if (y < top - 1 || y > bottom + 1) continue;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillText(`10^${e}`, left - 12, y);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const xTicks = 6;
  for (let i = 0; i <= xTicks; i++) {
    const t = (maxT / xTicks) * i;
    const x = xScale(t);
    ctx.strokeStyle = 'rgba(22, 32, 51, 0.10)';
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.fillStyle = '#607089';
    ctx.fillText(`${Math.round(t)}`, x, bottom + 14);
  }

  ctx.strokeStyle = 'rgba(22, 32, 51, 0.32)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();

  ctx.save();
  ctx.translate(24, top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#162033';
  ctx.font = '700 25px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PFU per mL, log scale', 0, 0);
  ctx.restore();

  ctx.fillStyle = '#162033';
  ctx.font = '700 25px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Time after phage addition (min)', left + plotW / 2, h - 32);

  ctx.font = '22px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(63, 124, 255, 0.95)';
  ctx.fillText('adsorption window', left + 12, top + 22);
  ctx.fillStyle = 'rgba(23, 160, 131, 0.95)';
  ctx.fillText('released progeny component', right - 310, top + 22);

  const sel = interpPoint(model.points, model.params.sampleTime);
  const selX = xScale(model.params.sampleTime);
  const selY = yScale(sel.pfuPerMl);
  ctx.strokeStyle = 'rgba(163, 59, 77, 0.74)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(selX, top);
  ctx.lineTo(selX, bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#a33b4d';
  ctx.beginPath();
  ctx.arc(selX, selY, 8, 0, Math.PI * 2);
  ctx.fill();
}

function poisson(lambda, rng) {
  if (lambda <= 0) return 0;
  if (lambda < 60) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng();
    } while (p > L);
    return k - 1;
  }
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
}

function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function drawPlate(model) {
  const p = model.params;
  const { selected, expectedPlaques: expected } = expectedPlaquesFor(model, p.sampleTime);
  const seed = Math.floor(p.sampleTime * 1000 + p.dilutionExponent * 1777 + p.platedVolumeMl * 99999 + selected.pfuPerMl) >>> 0;
  const rng = mulberry32(seed);
  const observed = poisson(expected, rng);

  const maxVisibleDots = expected > 650 ? 650 : Math.min(observed, 650);
  const pAtLeastOne = probabilityAtLeastOne(expected);
  let status = 'countable';
  if (expected < 1) status = 'likely blank';
  else if (expected < 30) status = 'below ideal counting range';
  else if (expected <= 300) status = 'countable';
  else if (expected <= 1000) status = 'TNTC';
  else status = 'confluent / nearly confluent';

  const volumeUl = p.platedVolumeMl * 1000;
  const confluenceOpacity = expected > 1000
    ? Math.min(0.42, 0.10 + 0.075 * Math.log10(expected / 1000 + 1))
    : 0;

  let svg = '';
  svg += `<defs>
    <radialGradient id="agar" cx="45%" cy="38%" r="65%">
      <stop offset="0%" stop-color="#fbfcff"/>
      <stop offset="70%" stop-color="#dfe8f8"/>
      <stop offset="100%" stop-color="#c3d2e8"/>
    </radialGradient>
    <radialGradient id="plaque" cx="42%" cy="35%" r="70%">
      <stop offset="0%" stop-color="#20334d" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#0d1727" stop-opacity="0.55"/>
    </radialGradient>
  </defs>`;
  svg += `<circle cx="260" cy="260" r="232" fill="url(#agar)" stroke="#f7fbff" stroke-width="18"/>`;
  svg += `<circle cx="260" cy="260" r="238" fill="none" stroke="rgba(20,32,52,0.16)" stroke-width="5"/>`;
  svg += `<circle cx="204" cy="176" r="76" fill="#fff" opacity="0.17"/>`;
  svg += `<text x="260" y="36" text-anchor="middle" font-size="17" font-weight="800" fill="#162033" opacity="0.72">Expected plaques λ = ${formatCount(expected)}</text>`;
  svg += `<text x="260" y="60" text-anchor="middle" font-size="14" fill="#607089">${volumeUl.toFixed(0)} µL plated at 10^${p.dilutionExponent}</text>`;
  svg += `<text x="260" y="494" text-anchor="middle" font-size="16" fill="#607089">${status}</text>`;

  if (expected > 1000) {
    svg += `<circle cx="260" cy="260" r="220" fill="#17243a" opacity="${confluenceOpacity.toFixed(2)}"/>`;
    svg += `<circle cx="260" cy="260" r="190" fill="#17243a" opacity="${Math.max(0.04, confluenceOpacity / 2).toFixed(2)}"/>`;
  }

  for (let i = 0; i < maxVisibleDots; i++) {
    let x, y, tries = 0;
    do {
      x = 260 + (rng() * 2 - 1) * 218;
      y = 260 + (rng() * 2 - 1) * 218;
      tries++;
    } while (((x - 260) ** 2 + (y - 260) ** 2 > 218 ** 2) && tries < 100);
    const r = expected > 350 ? 2.4 + rng() * 2.1 : 3.2 + rng() * 5.5;
    const op = expected > 600 ? 0.48 : 0.72 + rng() * 0.2;
    svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="url(#plaque)" opacity="${op.toFixed(2)}"/>`;
  }

  if (expected > 650) {
    svg += `<text x="260" y="262" text-anchor="middle" font-size="36" font-weight="800" fill="#162033" opacity="0.72">TNTC</text>`;
  } else if (expected < 1) {
    const percent = (pAtLeastOne * 100).toFixed(expected < 0.1 ? 1 : 0);
    svg += `<text x="260" y="250" text-anchor="middle" font-size="28" font-weight="800" fill="#607089" opacity="0.78">no plaques likely</text>`;
    svg += `<text x="260" y="282" text-anchor="middle" font-size="17" fill="#607089" opacity="0.9">P(≥1 plaque) = ${percent}%</text>`;
  }

  els.plateSvg.innerHTML = svg;
  const dilutionLabel = `10^${p.dilutionExponent}`;
  const observedText = expected > 650 ? `display capped at ${maxVisibleDots} visible marks` : `${observed} simulated visible plaque${observed === 1 ? '' : 's'}`;
  const lowCountText = expected < 30 ? ` The Poisson probability of seeing at least one plaque is <strong>${(pAtLeastOne * 100).toFixed(expected < 0.1 ? 1 : 0)}%</strong>.` : '';
  els.plateSummary.innerHTML = `At <strong>${formatMinutes(p.sampleTime)}</strong>, the predicted sample has <strong>${formatSci(selected.pfuPerMl)} PFU/mL</strong>. Plating <strong>${volumeUl.toFixed(0)} µL</strong> at <strong>${dilutionLabel}</strong> gives <strong>${formatCount(expected)}</strong> expected plaques (${status}; ${observedText}).${lowCountText}`;
}

function pointerToTime(evt) {
  if (!chartBounds) return 0;
  const rect = els.canvas.getBoundingClientRect();
  const xCanvas = (evt.clientX - rect.left) * (els.canvas.width / rect.width);
  const clamped = Math.max(chartBounds.left, Math.min(chartBounds.right, xCanvas));
  return ((clamped - chartBounds.left) / chartBounds.plotW) * chartBounds.maxT;
}

function updateTooltip(evt, model) {
  if (!chartBounds || !model) return;
  const rect = els.canvas.getBoundingClientRect();
  const t = pointerToTime(evt);
  const p = interpPoint(model.points, t);
  const x = (chartBounds.xScale(t) / els.canvas.width) * rect.width;
  const y = (chartBounds.yScale(p.pfuPerMl) / els.canvas.height) * rect.height;
  els.tooltip.style.left = `${x}px`;
  els.tooltip.style.top = `${y}px`;
  els.tooltip.innerHTML = `<strong>${formatMinutes(t)}</strong><br>${formatSci(p.pfuPerMl)} PFU/mL<br><span>${formatSci(p.released)} released progeny</span>`;
  els.tooltip.classList.add('show');
}

function syncSampleRangeMax() {
  const duration = parseFloat(els.graphDuration.value);
  els.sampleTime.max = String(duration);
  if (parseFloat(els.sampleTime.value) > duration) els.sampleTime.value = String(duration);
}

function render() {
  syncSampleRangeMax();
  const params = readParams();
  const model = simulate(params);
  lastModel = model;
  updateOutputs(params, model);
  drawChart(model);
  drawPlate(model);
}

function setupDilutions() {
  const options = [];
  for (let e = 0; e >= -12; e--) {
    const label = e === 0 ? 'undiluted' : `10^${e}`;
    options.push(`<option value="${e}" ${e === -5 ? 'selected' : ''}>${label}</option>`);
  }
  els.dilution.innerHTML = options.join('');
}

function resetDefaults() {
  els.cultureVolume.value = '1';
  els.od.value = '0.25';
  els.cellsAtODLog.value = '8';
  els.susceptibility.value = '1';
  els.doseMode.value = 'moi';
  els.moiLog.value = '0';
  els.totalPfuLog.value = '8';
  els.stockTiterLog.value = '10';
  els.adsorptionTime.value = '15';
  els.adsorptionRate.value = '2';
  els.virucide.checked = true;
  els.virucideSurvivalLog.value = '-3';
  els.burstSize.value = '200';
  els.burstTime.value = '180';
  els.graphDuration.value = '300';
  els.sampleTime.value = '180';
  els.dilution.value = '-5';
  els.platedVolume.value = '10';
  render();
}

function applyMcgaviganPreset() {
  els.cellsAtODLog.value = '6.55';
  els.doseMode.value = 'moi';
  els.moiLog.value = '-1';
  els.adsorptionTime.value = '5';
  els.virucide.checked = false;
  els.burstSize.value = '200';
  els.burstTime.value = '180';
  els.graphDuration.value = '300';
  els.sampleTime.value = '210';
  els.dilution.value = '-4';
  render();
}

function applyFastPreset() {
  els.cellsAtODLog.value = '8';
  els.doseMode.value = 'moi';
  els.moiLog.value = '-1';
  els.adsorptionTime.value = '10';
  els.virucide.checked = true;
  els.virucideSurvivalLog.value = '-4';
  els.burstSize.value = '80';
  els.burstTime.value = '30';
  els.graphDuration.value = '120';
  els.sampleTime.value = '45';
  els.dilution.value = '-5';
  render();
}

function exportCsv() {
  if (!lastModel) return;
  const p = lastModel.params;
  const rows = ['time_min,pfu_per_ml,free_pfu_per_ml,released_progeny_pfu_per_ml'];
  for (const point of lastModel.points) {
    rows.push([point.t.toFixed(3), point.pfuPerMl.toExponential(6), point.free.toExponential(6), point.released.toExponential(6)].join(','));
  }
  rows.push('');
  rows.push('parameter,value');
  Object.entries({
    cultureVolumeMl: p.cultureVolumeMl,
    od600: p.od600,
    cellsPerMlAtOD025: p.cellsPerMlAtOD025,
    susceptibleFraction: p.susceptibleFraction,
    totalPfuAdded: p.totalPfuAdded,
    realizedMoiTotal: p.realizedMoiTotal,
    realizedMoiSusceptible: p.realizedMoiSusceptible,
    adsorptionTimeMin: p.adsorptionTime,
    adsorptionRateConstantMlPerMin: p.adsorptionRateConstant,
    virucide: p.virucide,
    virucideSurvival: p.virucideSurvival,
    burstSize: p.burstSize,
    burstTimeMin: p.burstTime,
    sampleTimeMin: p.sampleTime,
    dilutionFraction: p.dilutionFactor,
    dilutionExponent: p.dilutionExponent,
    platedVolumeMl: p.platedVolumeMl,
    expectedPlaquesAtSelectedTime: expectedPlaquesFor(lastModel).expectedPlaques
  }).forEach(([k, v]) => rows.push(`${k},${v}`));
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'phage_one_step_growth_model.csv';
  a.click();
  URL.revokeObjectURL(url);
}

async function copyParams() {
  if (!lastModel) return;
  const p = lastModel.params;
  const summary = [
    `Culture: ${p.cultureVolumeMl} mL at OD600 ${p.od600}, ${formatSci(p.cellsPerMl)} bacteria/mL`,
    `Susceptible fraction: ${(p.susceptibleFraction * 100).toFixed(1)}%`,
    `Dose: ${formatSci(p.totalPfuAdded)} PFU, MOI total ${formatSci(p.realizedMoiTotal)}, MOI susceptible ${formatSci(p.realizedMoiSusceptible)}`,
    `Adsorption: ${p.adsorptionTime} min, k=${formatSci(p.adsorptionRateConstant)} mL/min, virucide=${p.virucide}`,
    `Burst: ${p.burstSize} PFU/cell, latent period ${p.burstTime} min`,
    `Predicted plateau: ${formatSci(lastModel.plateauPfuPerMl)} PFU/mL`
  ].join('\n');
  try {
    await navigator.clipboard.writeText(summary);
    els.copyParamsBtn.textContent = 'Copied';
    setTimeout(() => els.copyParamsBtn.textContent = 'Copy parameters', 1200);
  } catch (err) {
    alert(summary);
  }
}

function wireEvents() {
  document.querySelectorAll('input, select').forEach(el => el.addEventListener('input', render));
  els.resetBtn.addEventListener('click', resetDefaults);
  els.presetMcgavigan.addEventListener('click', applyMcgaviganPreset);
  els.presetFast.addEventListener('click', applyFastPreset);
  els.exportCsvBtn.addEventListener('click', exportCsv);
  els.copyParamsBtn.addEventListener('click', copyParams);

  els.canvas.addEventListener('mousemove', (evt) => updateTooltip(evt, lastModel));
  els.canvas.addEventListener('mouseleave', () => els.tooltip.classList.remove('show'));
  els.canvas.addEventListener('mousedown', (evt) => {
    isDragging = true;
    els.sampleTime.value = String(Math.round(pointerToTime(evt)));
    render();
  });
  window.addEventListener('mousemove', (evt) => {
    if (!isDragging) return;
    els.sampleTime.value = String(Math.round(pointerToTime(evt)));
    render();
    updateTooltip(evt, lastModel);
  });
  window.addEventListener('mouseup', () => { isDragging = false; });
  els.canvas.addEventListener('click', (evt) => {
    els.sampleTime.value = String(Math.round(pointerToTime(evt)));
    render();
  });
}

setupDilutions();
wireEvents();
render();
