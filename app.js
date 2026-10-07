
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

  function fmtLon(x) {
    return `${Math.abs(x).toFixed(3)}° ${x >= 0 ? "E" : "W"}`;
  }

  function stationECEF(latDeg, lonDeg, heightM) {
    const phi = rad(latDeg);
    const lam = rad(lonDeg);
    const h = heightM / 1000;

    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    const sl = Math.sin(lam);
    const cl = Math.cos(lam);

    const N = A / Math.sqrt(1 - E2 * sp * sp);

    return {
      x: (N + h) * cp * cl,
      y: (N + h) * cp * sl,
      z: (N * (1 - E2) + h) * sp,
      phi,
      lam
    };
  }

  function lookAngles(latDeg, lonDeg, heightM, satLonDeg) {
    const g = stationECEF(latDeg, lonDeg, heightM);
    const L = rad(satLonDeg);

    const sx = R_GEO * Math.cos(L);
    const sy = R_GEO * Math.sin(L);
    const sz = 0;

    const dx = sx - g.x;
    const dy = sy - g.y;
    const dz = sz - g.z;

    const sp = Math.sin(g.phi);
    const cp = Math.cos(g.phi);
    const sl = Math.sin(g.lam);
    const cl = Math.cos(g.lam);

    const east  = -sl * dx + cl * dy;
    const north = -sp * cl * dx - sp * sl * dy + cp * dz;
    const up    =  cp * cl * dx + cp * sl * dy + sp * dz;

    const horizontal = Math.hypot(east, north);

    return {
      elevation: deg(Math.atan2(up, horizontal)),
      azimuth: wrap360(deg(Math.atan2(east, north)))
    };
  }

  function solveLongitudeDelta(lat, lon, h, targetElevation) {
    const maxElevation = lookAngles(lat, lon, h, lon).elevation;

    if (targetElevation > maxElevation + 1e-9) return null;

    // Elevation decreases monotonically with absolute GEO longitude separation
    // from 0 to 180 degrees for a fixed ground station.
    const minElevation = lookAngles(lat, lon, h, wrap180(lon + 180)).elevation;
    if (targetElevation < minElevation - 1e-9) return null;

    let lo = 0;
    let hi = 180;

    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      const el = lookAngles(lat, lon, h, wrap180(lon + mid)).elevation;

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
      step: Number($("step").value)
    };
  }

  function validInput(v) {
    return (
      Number.isFinite(v.lat) && v.lat >= -90 && v.lat <= 90 &&
      Number.isFinite(v.lon) && v.lon >= -180 && v.lon <= 180 &&
      Number.isFinite(v.el) &&
      Number.isFinite(v.h) &&
      Number.isFinite(v.step) && v.step >= 0.1 && v.step <= 30
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
    for (let e = 0; e < maxEl - 1e-8 && elevations.length < 500; e += step) {
      elevations.push(e);
    }
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
        <td>${fmtLon(r.west.lon)}</td>
      `;
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

  function createGeoChartData(lat, lon, h, maxEl) {
    const east = [];
    const west = [];
    const samples = 360;

    for (let i = 0; i <= samples; i++) {
      const elevation = maxEl * (i / samples);
      const r = solveForElevation(lat, lon, h, elevation);
      if (!r) continue;

      east.push({
        branch: "East GEO branch",
        azimuth: r.east.azimuth,
        elevation: r.east.elevation,
        stationLat: lat,
        stationLon: lon,
        satLat: 0,
        satLon: r.east.lon
      });
      west.push({
        branch: "West GEO branch",
        azimuth: r.west.azimuth,
        elevation: r.west.elevation,
        stationLat: lat,
        stationLon: lon,
        satLat: 0,
        satLon: r.west.lon
      });
    }

    return { east, west };
  }

  function renderGeoChart(lat, lon, h, maxEl) {
    const svg = $("geoChart");
    const tooltip = $("chartTooltip");
    if (!svg || !tooltip) return;

    svg.innerHTML = "";
    tooltip.hidden = true;
    chartPoints = [];

    const W = 900, H = 480;
    const margin = { left: 68, right: 26, top: 22, bottom: 58 };
    const pw = W - margin.left - margin.right;
    const ph = H - margin.top - margin.bottom;
    const yMax = Math.max(10, Math.ceil(maxEl / 10) * 10);

    const xScale = satLon => margin.left + ((satLon + 180) / 360) * pw;
    const yScale = el => margin.top + ph - (el / yMax) * ph;

    function axisLonLabel(lon) {
      if (Math.abs(lon) < 1e-9) return "0°";
      if (Math.abs(Math.abs(lon) - 180) < 1e-9) return "180°";
      return `${Math.abs(lon)}°${lon > 0 ? "E" : "W"}`;
    }

    // Background grid and satellite-longitude ticks
    for (let satLon = -180; satLon <= 180; satLon += 45) {
      const x = xScale(satLon);
      svg.appendChild(svgEl("line", { x1:x, y1:margin.top, x2:x, y2:margin.top+ph, class:"grid-line" }));
      const t = svgEl("text", { x, y:margin.top+ph+24, "text-anchor":"middle", class:"tick-text" });
      t.textContent = axisLonLabel(satLon);
      svg.appendChild(t);
    }

    const yStep = yMax <= 30 ? 5 : yMax <= 60 ? 10 : 15;
    for (let el = 0; el <= yMax + 1e-9; el += yStep) {
      const y = yScale(el);
      svg.appendChild(svgEl("line", { x1:margin.left, y1:y, x2:margin.left+pw, y2:y, class:"grid-line" }));
      const t = svgEl("text", { x:margin.left-12, y:y+5, "text-anchor":"end", class:"tick-text" });
      t.textContent = `${el}°`;
      svg.appendChild(t);
    }

    svg.appendChild(svgEl("line", { x1:margin.left, y1:margin.top+ph, x2:margin.left+pw, y2:margin.top+ph, class:"axis-line" }));
    svg.appendChild(svgEl("line", { x1:margin.left, y1:margin.top, x2:margin.left, y2:margin.top+ph, class:"axis-line" }));

    const xTitle = svgEl("text", { x:margin.left+pw/2, y:H-14, "text-anchor":"middle", class:"axis-title" });
    xTitle.textContent = "Satellite Longitude";
    svg.appendChild(xTitle);

    const yTitle = svgEl("text", { x:18, y:margin.top+ph/2, "text-anchor":"middle", class:"axis-title", transform:`rotate(-90 18 ${margin.top+ph/2})` });
    yTitle.textContent = "Elevation (deg)";
    svg.appendChild(yTitle);

    const data = createGeoChartData(lat, lon, h, maxEl);

    function addCurve(points, className) {
      if (!points.length) return;
      const ordered = points.slice().sort((a,b) => a.elevation-b.elevation);

      // Longitude wraps at ±180°. Split the SVG path there so the curve does
      // not draw an artificial line across the entire chart.
      let d = "";
      let prev = null;
      for (const p of ordered) {
        const x = xScale(p.satLon);
        const y = yScale(p.elevation);
        const wrapJump = prev && Math.abs(p.satLon - prev.satLon) > 180;
        d += `${(!prev || wrapJump) ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `;
        chartPoints.push({ ...p, px:x, py:y });
        prev = p;
      }
      svg.appendChild(svgEl("path", { d: d.trim(), class:className }));
    }

    addCurve(data.east, "curve-east");
    addCurve(data.west, "curve-west");

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

      let best = null, bestD = Infinity;
      for (const p of chartPoints) {
        const dx = p.px - mx;
        const dy = p.py - my;
        const d = dx*dx + dy*dy;
        if (d < bestD) { bestD = d; best = p; }
      }
      if (!best) return;

      hoverV.setAttribute("x1", best.px); hoverV.setAttribute("x2", best.px); hoverV.setAttribute("visibility", "visible");
      hoverH.setAttribute("y1", best.py); hoverH.setAttribute("y2", best.py); hoverH.setAttribute("visibility", "visible");
      hoverP.setAttribute("cx", best.px); hoverP.setAttribute("cy", best.py); hoverP.setAttribute("visibility", "visible");

      tooltip.innerHTML = `
        <div><strong>Satellite Longitude:</strong> ${fmtLon(best.satLon)}</div>
        <div><strong>Azimuth:</strong> ${best.azimuth.toFixed(3)}°</div>
        <div><strong>Elevation:</strong> ${best.elevation.toFixed(3)}°</div>`;
      tooltip.hidden = false;

      const wrap = $("chartWrap").getBoundingClientRect();
      const pointX = rect.left - wrap.left + best.px / sx;
      const pointY = rect.top - wrap.top + best.py / sy;
      const tw = tooltip.offsetWidth || 220;
      const th = tooltip.offsetHeight || 150;
      let left = pointX + 14;
      let top = pointY - th / 2;
      if (left + tw > wrap.width - 8) left = pointX - tw - 14;
      top = Math.max(8, Math.min(top, wrap.height - th - 8));
      tooltip.style.left = `${Math.max(8,left)}px`;
      tooltip.style.top = `${top}px`;
    }

    hit.addEventListener("pointermove", e => moveHover(e.clientX, e.clientY));
    hit.addEventListener("pointerdown", e => moveHover(e.clientX, e.clientY));
    hit.addEventListener("pointerleave", hideHover);
  }

  function render() {
    const v = readInputs();
    const msg = $("message");

    msg.className = "message";

    if (!validInput(v)) {
      clearResults();
      $("maxEl").textContent = "—";
      msg.textContent = "مقادیر ورودی معتبر نیستند.";
      msg.classList.add("error");
      const chart = $("geoChart"); if (chart) chart.innerHTML = "";
      return;
    }

    const maxEl = lookAngles(v.lat, v.lon, v.h, v.lon).elevation;
    $("maxEl").textContent = `${maxEl.toFixed(3)}°`;

    const r = solveForElevation(v.lat, v.lon, v.h, v.el);

    if (!r) {
      clearResults();
      msg.textContent =
        `Elevation = ${v.el.toFixed(2)}° برای این ایستگاه روی قوس GEO قابل دستیابی نیست. ` +
        `حداکثر Elevation تقریباً ${maxEl.toFixed(2)}° است.`;
      msg.classList.add("error");
      renderTable(v.lat, v.lon, v.h, maxEl, v.step);
      renderGeoChart(v.lat, v.lon, v.h, maxEl);
      return;
    }

    $("azE").textContent = `${r.east.azimuth.toFixed(3)}°`;
    $("satLonE").textContent = fmtLon(r.east.lon);
    $("azW").textContent = `${r.west.azimuth.toFixed(3)}°`;
    $("satLonW").textContent = fmtLon(r.west.lon);

    msg.textContent =
      `برای Elevation = ${v.el.toFixed(2)}° دو موقعیت روی قوس GEO وجود دارد؛ ` +
      `جدایی طول جغرافیایی نسبت به ایستگاه برابر ±${r.delta.toFixed(3)}° است.`;
    msg.classList.add("ok");

    renderTable(v.lat, v.lon, v.h, maxEl, v.step);
    renderGeoChart(v.lat, v.lon, v.h, maxEl);
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
    render();
  });

  ["lat", "lon", "el", "h", "step"].forEach((id) => {
    $(id).addEventListener("change", render);
  });

  render();
})();
