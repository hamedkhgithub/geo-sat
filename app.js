(() => {
  const $ = (id) => document.getElementById(id);

  const A = 6378.137;                 // WGS-84 semi-major axis [km]
  const INV_F = 298.257223563;
  const F = 1 / INV_F;
  const E2 = F * (2 - F);
  const R_GEO = 42164.0;              // Geocentric GEO orbital radius [km]

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
      if (xRangeMode === "visible" && look.elevation < -1e-6) continue;
      points.push({
        xLon: unwrappedLon,
        satLon,
        elevation: look.elevation,
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

    const yMin = v.xRangeMode === "visible" ? 0 : Math.floor(Math.min(...data.points.map(p => p.elevation)) / 10) * 10;
    const yMaxRaw = Math.max(maxEl, ...data.points.map(p => p.elevation));
    const yMax = Math.max(10, Math.ceil(yMaxRaw / 10) * 10);
    const xSpan = Math.max(1e-9, data.xMax - data.xMin);
    const ySpan = Math.max(1e-9, yMax - yMin);

    // Equal: one angular degree has the same physical size on X and Y.
    // Auto: use a conventional readable plot height.
    const ph = v.aspectMode === "equal" ? pw * (ySpan / xSpan) : 420;
    const H = margin.top + ph + margin.bottom;
    svg.setAttribute("viewBox", `0 0 ${W} ${H.toFixed(2)}`);
    svg.style.aspectRatio = `${W} / ${H}`;

    const xScale = x => margin.left + (x - data.xMin) / xSpan * pw;
    const yScale = y => margin.top + (yMax - y) / ySpan * ph;

    // White plotting area, independent from page theme.
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

    let d = "";
    for (let i = 0; i < data.points.length; i++) {
      const p = data.points[i];
      const x = xScale(p.xLon), y = yScale(p.elevation);
      d += `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `;
      chartPoints.push({ ...p, px:x, py:y });
    }
    svg.appendChild(svgEl("path", { d:d.trim(), class:"curve-geo" }));

    // Mark station longitude / maximum elevation location.
    if (v.lon >= data.xMin && v.lon <= data.xMax) {
      const stationX = xScale(v.lon);
      svg.appendChild(svgEl("line", { x1:stationX, y1:margin.top, x2:stationX, y2:margin.top+ph, class:"station-line" }));
    }

    const hoverV = svgEl("line", { x1:0, y1:margin.top, x2:0, y2:margin.top+ph, class:"hover-line", visibility:"hidden" });
    const hoverH = svgEl("line", { x1:margin.left, y1:0, x2:margin.left+pw, y2:0, class:"hover-line", visibility:"hidden" });
    const hoverP = svgEl("circle", { cx:0, cy:0, r:6, class:"hover-point", visibility:"hidden" });
    svg.append(hoverV, hoverH, hoverP);

    const hit = svgEl("rect", { x:margin.left, y:margin.top, width:pw, height:ph, class:"hit-area" });
    svg.appendChild(hit);

    function hideHover() {
      hoverV.setAttribute("visibility", "hidden");
      hoverH.setAttribute("visibility", "hidden");
      hoverP.setAttribute("visibility", "hidden");
      tooltip.hidden = true;
    }

    function moveHover(clientX, clientY) {
      const rect = svg.getBoundingClientRect();
      const sx = W / rect.width;
      const sy = H / rect.height;
      const mx = (clientX - rect.left) * sx;
      const my = (clientY - rect.top) * sy;

      if (mx < margin.left || mx > margin.left+pw || my < margin.top || my > margin.top+ph) {
        hideHover();
        return;
      }

      // Tooltip movement is quantized to the requested longitude sampling step.
      let best = null, bestDx = Infinity;
      for (const p of chartPoints) {
        const dx = Math.abs(p.px - mx);
        if (dx < bestDx) { bestDx = dx; best = p; }
      }
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
      const pointX = rect.left - wrap.left + best.px / sx;
      const pointY = rect.top - wrap.top + best.py / sy;
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
    hit.addEventListener("pointerdown", e => moveHover(e.clientX, e.clientY));
    hit.addEventListener("pointerleave", hideHover);

    const modeText = v.xRangeMode === "visible" ? "Visible GEO Arc" : "Full GEO";
    const aspectText = v.aspectMode === "equal" ? "Equal angular scale (1° X = 1° Y)" : "Auto scale";
    $("chartStatus").textContent = `${modeText} · ${aspectText} · Tooltip step ${v.chartStep}°`;
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

  render();
})();
