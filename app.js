(() => {
  const $ = (id) => document.getElementById(id);

  const A = 6378.137;                 // WGS-84 semi-major axis [km]
  const INV_F = 298.257223563;
  const F = 1 / INV_F;
  const E2 = F * (2 - F);
  const R_GEO = 42164.0;

  let selectedGeoPoints = [];
  let lastChartState = null;              // Geocentric GEO orbital radius [km]

  const rad = (x) => x * Math.PI / 180;
  const deg = (x) => x * 180 / Math.PI;

  function wrap180(x) {
    let y = ((x + 180) % 360 + 360) % 360 - 180;
    return y === -180 ? 180 : y;
  }

  function wrap360(x) {
    return ((x % 360) + 360) % 360;
  }

  function fmtLon(x, decimals = 3) {
    const w = wrap180(x);
    if (Math.abs(w) < 1e-10) return `0°`;
    return `${Math.abs(w).toFixed(decimals)}°${w > 0 ? "E" : "W"}`;
  }


  function signedLonDelta(b, a) {
    return ((b - a + 180) % 360 + 360) % 360 - 180;
  }

  function signedAzDelta(b, a) {
    return ((b - a + 180) % 360 + 360) % 360 - 180;
  }

  function fmtSigned(v, decimals=3) {
    const sign = v > 0 ? "+" : "";
    return `${sign}${v.toFixed(decimals)}°`;
  }

  function pointHtml(p) {
    if (!p) return "—";
    return `
      <div><strong>Lon:</strong> ${fmtLon(p.lon, 3)}</div>
      <div><strong>Az:</strong> ${p.azimuth.toFixed(3)}°</div>
      <div><strong>El:</strong> ${p.elevation.toFixed(3)}°</div>
    `;
  }

  function renderSelectedGeoPoints() {
    const p1 = selectedGeoPoints[0] || null;
    const p2 = selectedGeoPoints[1] || null;

    const p1El = $("selP1");
    const p2El = $("selP2");
    const dEl = $("selDelta");
    if (!p1El || !p2El || !dEl) return;

    p1El.innerHTML = pointHtml(p1);
    p2El.innerHTML = pointHtml(p2);

    if (!p1 || !p2) {
      dEl.textContent = "—";
      return;
    }

    const dLon = signedLonDelta(p2.lon, p1.lon);
    const dAz = signedAzDelta(p2.azimuth, p1.azimuth);
    const dElv = p2.elevation - p1.elevation;

    dEl.innerHTML = `
      <div><strong>ΔLon:</strong> ${fmtSigned(dLon)}</div>
      <div><strong>ΔAz:</strong> ${fmtSigned(dAz)}</div>
      <div><strong>ΔEl:</strong> ${fmtSigned(dElv)}</div>
    `;
  }

  function addSelectedGeoPoint(point) {
    if (!point || point.elevation < 0) return;

    if (selectedGeoPoints.length >= 2) {
      selectedGeoPoints = [point];
    } else {
      selectedGeoPoints.push(point);
    }
    renderSelectedGeoPoints();

    if (lastChartState && typeof lastChartState.redraw === "function") {
      lastChartState.redraw();
    }
  }


  function stationECEF(latDeg, lonDeg, heightM) {
    const phi = rad(latDeg);
    const lam = rad(lonDeg);
    const h = heightM / 1000;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const sl = Math.sin(lam), cl = Math.cos(lam);
    const N = A / Math.sqrt(1 - E2 * sp * sp);

    return {
      x: (N + h) * cp * cl,
      y: (N + h) * cp * sl,
      z: (N * (1 - E2) + h) * sp,
      phi, lam
    };
  }

  function lookAngles(latDeg, lonDeg, heightM, satLonDeg) {
    const g = stationECEF(latDeg, lonDeg, heightM);
    const L = rad(satLonDeg);
    const sx = R_GEO * Math.cos(L);
    const sy = R_GEO * Math.sin(L);

    const dx = sx - g.x;
    const dy = sy - g.y;
    const dz = -g.z;

    const sp = Math.sin(g.phi), cp = Math.cos(g.phi);
    const sl = Math.sin(g.lam), cl = Math.cos(g.lam);

    const east  = -sl * dx + cl * dy;
    const north = -sp * cl * dx - sp * sl * dy + cp * dz;
    const up    =  cp * cl * dx + cp * sl * dy + sp * dz;

    return {
      elevation: deg(Math.atan2(up, Math.hypot(east, north))),
      azimuth: wrap360(deg(Math.atan2(east, north)))
    };
  }

  function solveLongitudeDelta(lat, lon, h, targetElevation) {
    const maxElevation = lookAngles(lat, lon, h, lon).elevation;
    if (targetElevation > maxElevation + 1e-9) return null;

    const minElevation = lookAngles(lat, lon, h, lon + 180).elevation;
    if (targetElevation < minElevation - 1e-9) return null;

    let lo = 0, hi = 180;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      const el = lookAngles(lat, lon, h, lon + mid).elevation;
      if (el > targetElevation) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function solveForElevation(lat, lon, h, elevation) {
    const delta = solveLongitudeDelta(lat, lon, h, elevation);
    if (delta === null) return null;

    const eastLon = wrap180(lon + delta);
    const westLon = wrap180(lon - delta);
    const east = lookAngles(lat, lon, h, eastLon);
    const west = lookAngles(lat, lon, h, westLon);

    return {
      delta,
      east: { lon: eastLon, ...east },
      west: { lon: westLon, ...west }
    };
  }

  function readInputs() {
    return {
      lat: Number($("lat").value),
      lon: Number($("lon").value),
      el: Number($("el").value),
      h: Number($("h").value || 0),
      step: Number($("step").value),
      chartStep: Number($("chartStep").value),
      xRangeMode: $("xRangeMode").value,
      aspectMode: $("aspectMode").value
    };
  }

  function validInput(v) {
    return (
      Number.isFinite(v.lat) && v.lat >= -90 && v.lat <= 90 &&
      Number.isFinite(v.lon) && v.lon >= -180 && v.lon <= 180 &&
      Number.isFinite(v.el) &&
      Number.isFinite(v.h) &&
      Number.isFinite(v.step) && v.step >= 0.1 && v.step <= 30 &&
      Number.isFinite(v.chartStep) && v.chartStep >= 0.05 && v.chartStep <= 10 &&
      ["visible", "full"].includes(v.xRangeMode) &&
      ["equal", "auto"].includes(v.aspectMode)
    );
  }

  function clearResults() {
    ["azE", "azW", "satLonE", "satLonW"].forEach(id => $(id).textContent = "—");
    $("tbody").innerHTML = "";
  }

  function renderTable(lat, lon, h, maxEl, step) {
    const body = $("tbody");
    body.innerHTML = "";

    const elevations = [];
    for (let e = 0; e < maxEl - 1e-8 && elevations.length < 500; e += step) elevations.push(e);
    elevations.push(maxEl);

    for (const e of elevations) {
      const r = solveForElevation(lat, lon, h, e);
      if (!r) continue;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${e.toFixed(2)}°</td>
        <td>${r.east.azimuth.toFixed(2)}°</td>
        <td>${fmtLon(r.east.lon)}</td>
        <td>${r.west.azimuth.toFixed(2)}°</td>
        <td>${fmtLon(r.west.lon)}</td>`;
      body.appendChild(tr);
    }
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  let chartPoints = [];

  function svgEl(name, attrs = {}) {
    const el = document.createElementNS(SVG_NS, name);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    return el;
  }

  function niceStep(span, targetTicks = 8) {
    const rough = span / targetTicks;
    const pow = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1e-9))));
    const f = rough / pow;
    const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nice * pow;
  }

  function visibleDelta(lat, lon, h) {
    return solveLongitudeDelta(lat, lon, h, 0) ?? 0;
  }

  function createChartData(lat, lon, h, chartStep, xRangeMode) {
    let xMin, xMax;
    if (xRangeMode === "visible") {
      const d = visibleDelta(lat, lon, h);
      xMin = lon - d;
      xMax = lon + d;
    } else {
      xMin = -180;
      xMax = 180;
    }

    const points = [];
    const startIndex = Math.ceil(xMin / chartStep);
    const endIndex = Math.floor(xMax / chartStep);

    // Always include exact endpoints, then the requested sampling grid.
    const xs = [xMin];
    for (let i = startIndex; i <= endIndex; i++) {
      const x = i * chartStep;
      if (x > xMin + 1e-9 && x < xMax - 1e-9) xs.push(x);
    }
    if (xMax - xMin > 1e-9) xs.push(xMax);

    for (const unwrappedLon of xs) {
      const satLon = wrap180(unwrappedLon);
      const look = lookAngles(lat, lon, h, satLon);
      // Only above-horizon GEO points are meaningful for the plotted arc.
      if (look.elevation < -1e-9) continue;
      points.push({
        xLon: unwrappedLon,
        satLon,
        elevation: Math.max(0, look.elevation),
        azimuth: look.azimuth
      });
    }

    return { points, xMin, xMax };
  }

  function drawGeoChart(v, maxEl) {
    const svg = $("geoChart");
    const tooltip = $("chartTooltip");
    svg.innerHTML = "";
    tooltip.hidden = true;
    chartPoints = [];

    const data = createChartData(v.lat, v.lon, v.h, v.chartStep, v.xRangeMode);
    if (!data.points.length) return;

    const margin = { left: 74, right: 28, top: 24, bottom: 62 };
    const W = 900;
    const pw = W - margin.left - margin.right;

    const yMin = 0;
    const yMaxRaw = Math.max(0, maxEl, ...data.points.map(p => p.elevation));
    const yMax = Math.max(10, Math.ceil(yMaxRaw / 10) * 10);
    const xSpan = Math.max(1e-9, data.xMax - data.xMin);
    const ySpan = Math.max(1e-9, yMax - yMin);

    const ph = v.aspectMode === "equal" ? pw * (ySpan / xSpan) : 420;
    const H = margin.top + ph + margin.bottom;
    svg.setAttribute("viewBox", `0 0 ${W} ${H.toFixed(2)}`);
    svg.style.aspectRatio = `${W} / ${H}`;

    const xScale = x => margin.left + (x - data.xMin) / xSpan * pw;
    const yScale = y => margin.top + (yMax - y) / ySpan * ph;

    svg.appendChild(svgEl("rect", {
      x: margin.left, y: margin.top, width: pw, height: ph,
      class: "plot-bg"
    }));

    const xTickStep = niceStep(xSpan, 8);
    const firstXTick = Math.ceil(data.xMin / xTickStep) * xTickStep;
    for (let x = firstXTick; x <= data.xMax + 1e-8; x += xTickStep) {
      const px = xScale(x);
      svg.appendChild(svgEl("line", { x1:px, y1:margin.top, x2:px, y2:margin.top+ph, class:"grid-line" }));
      const t = svgEl("text", { x:px, y:margin.top+ph+24, "text-anchor":"middle", class:"tick-text" });
      t.textContent = fmtLon(x, xTickStep < 1 ? 1 : 0);
      svg.appendChild(t);
    }

    const yTickStep = niceStep(ySpan, 6);
    const firstYTick = Math.ceil(yMin / yTickStep) * yTickStep;
    for (let y = firstYTick; y <= yMax + 1e-8; y += yTickStep) {
      const py = yScale(y);
      svg.appendChild(svgEl("line", { x1:margin.left, y1:py, x2:margin.left+pw, y2:py, class:"grid-line" }));
      const t = svgEl("text", { x:margin.left-12, y:py+4, "text-anchor":"end", class:"tick-text" });
      t.textContent = `${Number(y.toFixed(2))}°`;
      svg.appendChild(t);
    }

    svg.appendChild(svgEl("line", { x1:margin.left, y1:margin.top+ph, x2:margin.left+pw, y2:margin.top+ph, class:"axis-line" }));
    svg.appendChild(svgEl("line", { x1:margin.left, y1:margin.top, x2:margin.left, y2:margin.top+ph, class:"axis-line" }));

    const xTitle = svgEl("text", { x:margin.left+pw/2, y:H-14, "text-anchor":"middle", class:"axis-title" });
    xTitle.textContent = "Satellite Longitude";
    svg.appendChild(xTitle);

    const yTitle = svgEl("text", {
      x:18, y:margin.top+ph/2, "text-anchor":"middle", class:"axis-title",
      transform:`rotate(-90 18 ${margin.top+ph/2})`
    });
    yTitle.textContent = "Elevation (deg)";
    svg.appendChild(yTitle);

    // Draw only above-horizon segments. Break the path if a hidden/negative
    // longitude interval existed between two adjacent plotted samples.
    let d = "";
    let prev = null;
    const maxContinuousGap = Math.max(v.chartStep * 1.6, 0.15);

    for (const p of data.points) {
      const x = xScale(p.xLon);
      const y = yScale(p.elevation);

      const isNewSegment = !prev || Math.abs(p.xLon - prev.xLon) > maxContinuousGap;
      d += `${isNewSegment ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `;

      const cp = { ...p, px:x, py:y };
      chartPoints.push(cp);
      prev = p;
    }
    svg.appendChild(svgEl("path", { d:d.trim(), class:"curve-geo" }));

    if (v.lon >= data.xMin && v.lon <= data.xMax) {
      const stationX = xScale(v.lon);
      svg.appendChild(svgEl("line", { x1:stationX, y1:margin.top, x2:stationX, y2:margin.top+ph, class:"station-line" }));
    }

    const hoverV = svgEl("line", { x1:0, y1:margin.top, x2:0, y2:margin.top+ph, class:"hover-line", visibility:"hidden" });
    const hoverH = svgEl("line", { x1:margin.left, y1:0, x2:margin.left+pw, y2:0, class:"hover-line", visibility:"hidden" });
    const hoverP = svgEl("circle", { cx:0, cy:0, r:6, class:"hover-point", visibility:"hidden" });
    svg.append(hoverV, hoverH, hoverP);

    // Dedicated layer for frozen P1/P2 markers.
    const selectedLayer = svgEl("g", { class:"selected-points-layer" });
    svg.appendChild(selectedLayer);

    function drawSelectedMarkers() {
      selectedLayer.innerHTML = "";

      selectedGeoPoints.forEach((p, i) => {
        if (!p || p.elevation < 0) return;
        if (p.xLon < data.xMin - 1e-9 || p.xLon > data.xMax + 1e-9) return;

        const px = xScale(p.xLon);
        const py = yScale(p.elevation);

        const c = svgEl("circle", {
          cx:px, cy:py, r:7,
          class: i === 0 ? "selected-point selected-p1" : "selected-point selected-p2"
        });
        selectedLayer.appendChild(c);

        const label = svgEl("text", {
          x:px+10, y:py-9,
          class: i === 0 ? "selected-label selected-label-p1" : "selected-label selected-label-p2"
        });
        label.textContent = i === 0 ? "P1" : "P2";
        selectedLayer.appendChild(label);
      });
    }

    drawSelectedMarkers();

    const hit = svgEl("rect", { x:margin.left, y:margin.top, width:pw, height:ph, class:"hit-area" });
    svg.appendChild(hit);

    function hideHover() {
      hoverV.setAttribute("visibility", "hidden");
      hoverH.setAttribute("visibility", "hidden");
      hoverP.setAttribute("visibility", "hidden");
      tooltip.hidden = true;
    }

    function pointerToSvg(clientX, clientY) {
      const rect = svg.getBoundingClientRect();
      return {
        x: (clientX - rect.left) * (W / rect.width),
        y: (clientY - rect.top) * (H / rect.height),
        rect
      };
    }

    function nearestChartPoint(mx, my, use2d=false) {
      let best = null;
      let bestMetric = Infinity;

      for (const p of chartPoints) {
        if (p.elevation < 0) continue;
        const metric = use2d
          ? ((p.px - mx) ** 2 + (p.py - my) ** 2)
          : Math.abs(p.px - mx);

        if (metric < bestMetric) {
          bestMetric = metric;
          best = p;
        }
      }
      return { point: best, metric: bestMetric };
    }

    function moveHover(clientX, clientY) {
      const pos = pointerToSvg(clientX, clientY);
      const mx = pos.x, my = pos.y;

      if (mx < margin.left || mx > margin.left+pw || my < margin.top || my > margin.top+ph) {
        hideHover();
        return;
      }

      const { point: best } = nearestChartPoint(mx, my, false);
      if (!best) return;

      hoverV.setAttribute("x1", best.px); hoverV.setAttribute("x2", best.px); hoverV.setAttribute("visibility", "visible");
      hoverH.setAttribute("y1", best.py); hoverH.setAttribute("y2", best.py); hoverH.setAttribute("visibility", "visible");
      hoverP.setAttribute("cx", best.px); hoverP.setAttribute("cy", best.py); hoverP.setAttribute("visibility", "visible");

      const decimals = v.chartStep < 0.1 ? 2 : v.chartStep < 1 ? 1 : 0;
      tooltip.innerHTML = `
        <div><strong>Satellite Longitude:</strong> ${fmtLon(best.satLon, decimals)}</div>
        <div><strong>Azimuth:</strong> ${best.azimuth.toFixed(3)}°</div>
        <div><strong>Elevation:</strong> ${best.elevation.toFixed(3)}°</div>`;
      tooltip.hidden = false;

      const wrap = $("chartWrap").getBoundingClientRect();
      const rect = svg.getBoundingClientRect();
      const pointX = rect.left - wrap.left + best.px * rect.width / W;
      const pointY = rect.top - wrap.top + best.py * rect.height / H;
      const tw = tooltip.offsetWidth || 220;
      const th = tooltip.offsetHeight || 110;

      let left = pointX + 14;
      let top = pointY - th / 2;
      if (left + tw > wrap.width - 8) left = pointX - tw - 14;
      top = Math.max(8, Math.min(top, wrap.height - th - 8));

      tooltip.style.left = `${Math.max(8, left)}px`;
      tooltip.style.top = `${top}px`;
    }

    hit.addEventListener("pointermove", e => moveHover(e.clientX, e.clientY));
    hit.addEventListener("pointerleave", hideHover);

    hit.addEventListener("click", e => {
      const pos = pointerToSvg(e.clientX, e.clientY);
      const { point: nearest, metric } = nearestChartPoint(pos.x, pos.y, true);
      if (!nearest) return;

      // 18 SVG units gives a comfortable but deliberate click target.
      if (Math.sqrt(metric) <= 18) {
        addSelectedGeoPoint({
          lon: nearest.satLon,
          xLon: nearest.xLon,
          satLon: nearest.satLon,
          azimuth: nearest.azimuth,
          elevation: nearest.elevation
        });
        drawSelectedMarkers();
      }
    });

    lastChartState = {
      redraw: drawSelectedMarkers
    };

    const modeText = v.xRangeMode === "visible" ? "Visible GEO Arc" : "Full GEO";
    const aspectText = v.aspectMode === "equal" ? "Equal angular scale (1° X = 1° Y)" : "Auto scale";
    $("chartStatus").textContent = `${modeText} · ${aspectText} · Tooltip step ${v.chartStep}°`;
  }

  // ---------- Exact nonlinear Antenna Beam Calculator ----------

  function signedAngleDiff(angle, reference) {
    let d = ((angle - reference + 180) % 360 + 360) % 360 - 180;
    return d;
  }

  function beamVisibleInterval(lat, lon, h) {
    const d = visibleDelta(lat, lon, h);
    return { left: lon - d, right: lon + d };
  }

  function beamConditionAt(mode, lat, lon, h, centerLook, satLonUnwrapped, halfBw) {
    const look = lookAngles(lat, lon, h, wrap180(satLonUnwrapped));
    if (look.elevation < -1e-8) return false;

    if (mode === "el-to-az") {
      return Math.abs(look.elevation - centerLook.elevation) <= halfBw + 1e-10;
    }
    return Math.abs(signedAngleDiff(look.azimuth, centerLook.azimuth)) <= halfBw + 1e-10;
  }

  // Find one boundary of the connected GEO segment containing the beam center.
  // The search is performed on the actual nonlinear GEO look-angle curve.
  function findBeamBoundary(direction, mode, lat, lon, h, centerLonU, centerLook, halfBw, limitLon) {
    const total = Math.abs(limitLon - centerLonU);
    if (total < 1e-12) return centerLonU;

    // Coarse scan only locates the first transition; bisection then refines it.
    const scanStep = Math.min(0.1, Math.max(0.005, total / 4000));
    let insideLon = centerLonU;
    let x = centerLonU;

    while (true) {
      let next = x + direction * scanStep;
      if ((direction < 0 && next < limitLon) || (direction > 0 && next > limitLon)) {
        next = limitLon;
      }

      const inside = beamConditionAt(mode, lat, lon, h, centerLook, next, halfBw);
      if (!inside) {
        // insideLon is inside; next is outside. Refine transition.
        let a = insideLon, b = next;
        for (let i = 0; i < 70; i++) {
          const m = (a + b) / 2;
          if (beamConditionAt(mode, lat, lon, h, centerLook, m, halfBw)) a = m;
          else b = m;
        }
        return (a + b) / 2;
      }

      insideLon = next;
      x = next;
      if (Math.abs(x - limitLon) < 1e-10) return limitLon;
    }
  }


  function solveCenterLonFromAzimuth(lat, lon, h, targetAz) {
    const vis = beamVisibleInterval(lat, lon, h);

    // At (or extremely close to) the equator, GEO azimuth is degenerate:
    // most east/west GEO positions collapse toward 90° / 270°, so azimuth
    // alone does not uniquely determine a GEO longitude.
    if (Math.abs(lat) < 1e-5) {
      return { error: "در عرض جغرافیایی نزدیک صفر، Azimuth به‌تنهایی Longitude ماهواره GEO را یکتا تعیین نمی‌کند." };
    }

    const N = 2400;
    const samples = [];
    let prevU = null;

    for (let i = 0; i <= N; i++) {
      const L = vis.left + (vis.right - vis.left) * i / N;
      const look = lookAngles(lat, lon, h, wrap180(L));
      if (look.elevation < -1e-6) continue;

      let azU;
      if (prevU === null) {
        azU = look.azimuth;
      } else {
        azU = prevU + signedAngleDiff(look.azimuth, prevU);
      }
      samples.push({ L, azU, look });
      prevU = azU;
    }

    if (samples.length < 2) {
      return { error: "GEO Arc قابل مشاهده برای این ایستگاه پیدا نشد." };
    }

    const azVals = samples.map(s => s.azU);
    const minAz = Math.min(...azVals);
    const maxAz = Math.max(...azVals);

    // Find an equivalent targetAz + k*360 lying in the continuous azimuth range.
    const targetCandidates = [];
    for (let k = -3; k <= 3; k++) {
      const t = targetAz + 360 * k;
      if (t >= minAz - 1e-7 && t <= maxAz + 1e-7) targetCandidates.push(t);
    }

    if (!targetCandidates.length) {
      const minFmt = wrap360(minAz).toFixed(2);
      const maxFmt = wrap360(maxAz).toFixed(2);
      return {
        error: `Azimuth انتخاب‌شده روی GEO Arc قابل مشاهده این ایستگاه قرار ندارد. بازه تقریبی قابل دسترس: ${minFmt}° تا ${maxFmt}°.`
      };
    }

    // Prefer the equivalent representation closest to the azimuth at station longitude.
    const centerAz = lookAngles(lat, lon, h, wrap180(lon)).azimuth;
    const centerAzU = samples.reduce((best, s) =>
      Math.abs(s.L - lon) < Math.abs(best.L - lon) ? s : best, samples[0]).azU;

    let targetU = targetCandidates[0];
    for (const t of targetCandidates) {
      if (Math.abs(t - centerAzU) < Math.abs(targetU - centerAzU)) targetU = t;
    }

    // Find the sample segment that brackets targetU.
    let a = null, b = null;
    for (let i = 0; i < samples.length - 1; i++) {
      const s0 = samples[i], s1 = samples[i + 1];
      const lo = Math.min(s0.azU, s1.azU);
      const hi = Math.max(s0.azU, s1.azU);
      if (targetU >= lo - 1e-10 && targetU <= hi + 1e-10) {
        a = s0;
        b = s1;
        break;
      }
    }

    if (!a || !b) {
      // Fallback to the nearest sampled point.
      let best = samples[0];
      for (const s of samples) {
        if (Math.abs(s.azU - targetU) < Math.abs(best.azU - targetU)) best = s;
      }
      return { centerLonU: best.L, centerLook: best.look };
    }

    // Bisection on the actual nonlinear look-angle relation.
    let left = a.L, right = b.L;
    let azLeftU = a.azU, azRightU = b.azU;
    const increasing = azRightU >= azLeftU;

    for (let i = 0; i < 70; i++) {
      const mid = (left + right) / 2;
      const rawAz = lookAngles(lat, lon, h, wrap180(mid)).azimuth;

      // Unwrap midpoint azimuth relative to the left bracket endpoint.
      const azMidU = azLeftU + signedAngleDiff(rawAz, azLeftU);

      if ((increasing && azMidU < targetU) || (!increasing && azMidU > targetU)) {
        left = mid;
        azLeftU = azMidU;
      } else {
        right = mid;
        azRightU = azMidU;
      }
    }

    const centerLonU = (left + right) / 2;
    const centerLook = lookAngles(lat, lon, h, wrap180(centerLonU));
    return { centerLonU, centerLook };
  }

  function exactBeamCalculation(lat, lon, h, centerAz, mode, inputBw) {
    const vis = beamVisibleInterval(lat, lon, h);

    const resolved = solveCenterLonFromAzimuth(lat, lon, h, centerAz);
    if (resolved.error) return resolved;

    const centerLonU = resolved.centerLonU;
    const centerLook = resolved.centerLook;

    if (centerLook.elevation < -1e-7) {
      return { error: "Azimuth مرکزی انتخاب‌شده به نقطه قابل مشاهده‌ای روی GEO Arc منتهی نمی‌شود." };
    }

    const halfBw = inputBw / 2;
    const left = findBeamBoundary(-1, mode, lat, lon, h, centerLonU, centerLook, halfBw, vis.left);
    const right = findBeamBoundary(+1, mode, lat, lon, h, centerLonU, centerLook, halfBw, vis.right);

    const leftLook = lookAngles(lat, lon, h, wrap180(left));
    const rightLook = lookAngles(lat, lon, h, wrap180(right));

    let outputBw;
    if (mode === "el-to-az") {
      // Azimuth along the visible GEO arc is continuous when unwrapped about the center.
      const dLeft = Math.abs(signedAngleDiff(leftLook.azimuth, centerLook.azimuth));
      const dRight = Math.abs(signedAngleDiff(rightLook.azimuth, centerLook.azimuth));
      outputBw = 2 * Math.max(dLeft, dRight);
    } else {
      // Elevation is unimodal. Its extrema on the connected interval occur
      // at one of the endpoints or at the station longitude (GEO culmination).
      const candidates = [leftLook.elevation, rightLook.elevation];
      if (lon >= left - 1e-10 && lon <= right + 1e-10) {
        candidates.push(lookAngles(lat, lon, h, wrap180(lon)).elevation);
      }
      const maxDev = Math.max(...candidates.map(e => Math.abs(e - centerLook.elevation)));
      outputBw = 2 * maxDev;
    }

    return {
      centerLonU, centerLook,
      left, right, leftLook, rightLook,
      outputBw,
      coverageSpan: right - left,
      clippedLeft: Math.abs(left - vis.left) < 1e-6,
      clippedRight: Math.abs(right - vis.right) < 1e-6
    };
  }

  function updateBeamModeUI() {
    const mode = $("beamMode").value;
    if (mode === "el-to-az") {
      $("beamInputLabel").textContent = "Elevation Beamwidth (°)";
      $("beamResultLabel").textContent = "Required Azimuth Beamwidth";
    } else {
      $("beamInputLabel").textContent = "Azimuth Beamwidth (°)";
      $("beamResultLabel").textContent = "Required Elevation Beamwidth";
    }
  }

  function renderBeamCalculator() {
    updateBeamModeUI();

    const lat = Number($("lat").value);
    const lon = Number($("lon").value);
    const h = Number($("h").value || 0);
    const centerAz = Number($("beamCenterAz").value);
    const mode = $("beamMode").value;
    const bw = Number($("beamWidth").value);
    const msg = $("beamMessage");

    msg.className = "message";

    const valid = Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
      Number.isFinite(lon) && lon >= -180 && lon <= 180 &&
      Number.isFinite(h) &&
      Number.isFinite(centerAz) && centerAz >= 0 && centerAz <= 360 &&
      Number.isFinite(bw) && bw > 0 && bw <= 180 &&
      ["el-to-az", "az-to-el"].includes(mode);

    if (!valid) {
      msg.textContent = "ورودی‌های Beam Calculator معتبر نیستند.";
      msg.classList.add("error");
      ["beamCenterLook","beamCenterLonOut","beamResult","beamCoverage","beamCoverageSpan","beamLeftEdge","beamRightEdge"]
        .forEach(id => $(id).textContent = "—");
      return;
    }

    const r = exactBeamCalculation(lat, lon, h, centerAz, mode, bw);
    if (r.error) {
      msg.textContent = r.error;
      msg.classList.add("error");
      ["beamCenterLook","beamCenterLonOut","beamResult","beamCoverage","beamCoverageSpan","beamLeftEdge","beamRightEdge"]
        .forEach(id => $(id).textContent = "—");
      return;
    }

    $("beamCenterLook").textContent =
      `Az ${r.centerLook.azimuth.toFixed(3)}° · El ${r.centerLook.elevation.toFixed(3)}°`;
    $("beamCenterLonOut").textContent = `Resolved GEO longitude: ${fmtLon(r.centerLonU, 3)}`;
    $("beamResult").textContent = `${r.outputBw.toFixed(3)}°`;
    $("beamCoverage").textContent = `${fmtLon(r.left, 3)}  →  ${fmtLon(r.right, 3)}`;
    $("beamCoverageSpan").textContent = `GEO longitude span: ${r.coverageSpan.toFixed(3)}°`;

    $("beamLeftEdge").textContent =
      `${fmtLon(r.left,3)} · Az ${r.leftLook.azimuth.toFixed(3)}° · El ${r.leftLook.elevation.toFixed(3)}°`;
    $("beamRightEdge").textContent =
      `${fmtLon(r.right,3)} · Az ${r.rightLook.azimuth.toFixed(3)}° · El ${r.rightLook.elevation.toFixed(3)}°`;

    const clipping = (r.clippedLeft || r.clippedRight)
      ? " بخشی از Beam ورودی تا افق هندسی ادامه پیدا می‌کند؛ پوشش در افق محدود شده است."
      : "";

    const outName = mode === "el-to-az" ? "Azimuth" : "Elevation";
    msg.textContent =
      `محاسبه غیرخطی روی GEO Arc انجام شد. Beamwidth متقارن لازم در ${outName} برابر ${r.outputBw.toFixed(3)}° است.${clipping}`;
    msg.classList.add("ok");
  }

  function render() {
    const v = readInputs();
    const msg = $("message");
    msg.className = "message";

    if (!validInput(v)) {
      clearResults();
      $("maxEl").textContent = "—";
      msg.textContent = "مقادیر ورودی معتبر نیستند. Tooltip Step باید بین 0.05° و 10° باشد.";
      msg.classList.add("error");
      return;
    }

    const maxEl = lookAngles(v.lat, v.lon, v.h, v.lon).elevation;
    $("maxEl").textContent = `${maxEl.toFixed(3)}°`;

    const r = solveForElevation(v.lat, v.lon, v.h, v.el);
    if (!r) {
      clearResults();
      msg.textContent = `Elevation = ${v.el.toFixed(2)}° برای این ایستگاه روی قوس GEO قابل دستیابی نیست. حداکثر Elevation تقریباً ${maxEl.toFixed(2)}° است.`;
      msg.classList.add("error");
    } else {
      $("azE").textContent = `${r.east.azimuth.toFixed(3)}°`;
      $("satLonE").textContent = fmtLon(r.east.lon);
      $("azW").textContent = `${r.west.azimuth.toFixed(3)}°`;
      $("satLonW").textContent = fmtLon(r.west.lon);
      msg.textContent = `برای Elevation = ${v.el.toFixed(2)}° دو موقعیت روی قوس GEO وجود دارد؛ جدایی طول جغرافیایی نسبت به ایستگاه برابر ±${r.delta.toFixed(3)}° است.`;
      msg.classList.add("ok");
    }

    renderTable(v.lat, v.lon, v.h, maxEl, v.step);
    drawGeoChart(v, maxEl);
    renderBeamCalculator();
  }

  $("calcForm").addEventListener("submit", (event) => {
    event.preventDefault();
    render();
  });

  $("tehranBtn").addEventListener("click", () => {
    $("lat").value = "35.6892";
    $("lon").value = "51.3890";
    $("el").value = "30";
    $("h").value = "1200";
    $("step").value = "5";
    $("chartStep").value = "1";
    $("xRangeMode").value = "visible";
    $("aspectMode").value = "equal";
    render();
  });

  ["lat", "lon", "el", "h", "step", "chartStep", "xRangeMode", "aspectMode"].forEach((id) => {
    $(id).addEventListener("change", render);
  });

  $("beamMode").addEventListener("change", () => {
    updateBeamModeUI();
    renderBeamCalculator();
  });
  $("beamCenterAz").addEventListener("change", renderBeamCalculator);
  $("beamWidth").addEventListener("change", renderBeamCalculator);
  $("beamCalcBtn").addEventListener("click", renderBeamCalculator);

  $("clearSelectedPoints").addEventListener("click", () => {
    selectedGeoPoints = [];
    renderSelectedGeoPoints();
    if (lastChartState && typeof lastChartState.redraw === "function") {
      lastChartState.redraw();
    }
  });

  renderSelectedGeoPoints();
  render();
})();
