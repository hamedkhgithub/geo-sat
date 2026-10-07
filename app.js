
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

  function render() {
    const v = readInputs();
    const msg = $("message");

    msg.className = "message";

    if (!validInput(v)) {
      clearResults();
      $("maxEl").textContent = "—";
      msg.textContent = "مقادیر ورودی معتبر نیستند.";
      msg.classList.add("error");
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
