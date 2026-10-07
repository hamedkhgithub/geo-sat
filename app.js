(() => {
  const $ = (id) => document.getElementById(id);

  const A = 6378.137;                 // WGS-84 semi-major axis [km]
  const INV_F = 298.257223563;
  const F = 1 / INV_F;
  const E2 = F * (2 - F);
  const R_GEO = 42164.0;

  const CITY_PRESETS = {
tehran:{lat:35.6889,lon:51.3897,h:1200},karaj:{lat:35.8328,lon:50.9917,h:1312},ardabil:{lat:38.2498,lon:48.2933,h:1351},
urmia:{lat:37.5527,lon:45.0761,h:1332},tabriz:{lat:38.0739,lon:46.2961,h:1351},isfahan:{lat:32.6525,lon:51.6750,h:1574},
ilam:{lat:33.6374,lon:46.4227,h:1431},bushehr:{lat:28.9234,lon:50.8203,h:5},birjand:{lat:32.8663,lon:59.2211,h:1491},
mashhad:{lat:36.2975,lon:59.6059,h:995},bojnurd:{lat:37.4747,lon:57.3290,h:1070},ahvaz:{lat:31.3183,lon:48.6706,h:17},
zanjan:{lat:36.6736,lon:48.4787,h:1663},semnan:{lat:35.5729,lon:53.3971,h:1130},zahedan:{lat:29.4963,lon:60.8629,h:1352},
shiraz:{lat:29.6100,lon:52.5425,h:1486},qazvin:{lat:36.2688,lon:50.0041,h:1278},qom:{lat:34.6401,lon:50.8764,h:928},
sanandaj:{lat:35.3144,lon:46.9923,h:1538},kerman:{lat:30.2839,lon:57.0834,h:1755},kermanshah:{lat:34.3142,lon:47.0650,h:1350},
yasuj:{lat:30.6682,lon:51.5879,h:1870},gorgan:{lat:36.8416,lon:54.4436,h:155},rasht:{lat:37.2808,lon:49.5832,h:-5},
khorramabad:{lat:33.4878,lon:48.3558,h:1147},sari:{lat:36.5633,lon:53.0601,h:20},arak:{lat:34.0917,lon:49.6892,h:1718},
bandarabbas:{lat:27.1865,lon:56.2808,h:9},hamedan:{lat:34.7992,lon:48.5146,h:1850},yazd:{lat:31.8974,lon:54.3569,h:1216},
shahrekord:{lat:32.3256,lon:50.8644,h:2070},chabahar:{lat:25.2919,lon:60.6430,h:14}
  };


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

    const visDelta = visibleDelta(lat, lon, h);
    const leftLon = lon - visDelta;
    const rightLon = lon + visDelta;

    // Dense sampling is used only to establish the continuous Azimuth range
    // and robust brackets for inversion Azimuth -> GEO longitude.
    const samples = [];
    const N = 4000;
    let prevAzU = null;

    for (let i = 0; i <= N; i++) {
      const L = leftLon + (rightLon - leftLon) * i / N;
      const look = lookAngles(lat, lon, h, wrap180(L));
      if (look.elevation < -1e-7) continue;

      let azU = look.azimuth;
      if (prevAzU !== null) {
        azU = prevAzU + signedAngleDiff(look.azimuth, prevAzU);
      }

      samples.push({ L, azU, look });
      prevAzU = azU;
    }

    if (samples.length < 2) return;

    const azMin = Math.min(...samples.map(s => s.azU));
    const azMax = Math.max(...samples.map(s => s.azU));

    function solveAtAz(targetAzU) {
      let a = null, b = null;

      for (let i = 0; i < samples.length - 1; i++) {
        const s0 = samples[i], s1 = samples[i + 1];
        const lo = Math.min(s0.azU, s1.azU);
        const hi = Math.max(s0.azU, s1.azU);
        if (targetAzU >= lo - 1e-10 && targetAzU <= hi + 1e-10) {
          a = s0; b = s1; break;
        }
      }
      if (!a || !b) return null;

      let l = a.L, r = b.L;
      let azL = a.azU, azR = b.azU;
      const increasing = azR >= azL;

      for (let k = 0; k < 60; k++) {
        const m = (l + r) / 2;
        const lookM = lookAngles(lat, lon, h, wrap180(m));
        const azM = azL + signedAngleDiff(lookM.azimuth, azL);

        if ((increasing && azM < targetAzU) || (!increasing && azM > targetAzU)) {
          l = m; azL = azM;
        } else {
          r = m; azR = azM;
        }
      }

      const satLonU = (l + r) / 2;
      const look = lookAngles(lat, lon, h, wrap180(satLonU));
      if (look.elevation < -1e-7) return null;
      return { satLon: wrap180(satLonU), look };
    }

    // Use a true fixed Azimuth grid. Include endpoints when they do not land
    // exactly on the requested grid so the visible GEO limits are still clear.
    const targets = [];
    const first = Math.ceil(azMin / step) * step;

    if (first - azMin > 1e-7) targets.push(azMin);
    for (let az = first; az <= azMax + 1e-9 && targets.length < 5000; az += step) {
      targets.push(az);
    }
    if (azMax - targets[targets.length - 1] > 1e-7) targets.push(azMax);

    for (const azU of targets) {
      const r = solveAtAz(azU);
      if (!r) continue;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${wrap360(azU).toFixed(2)}°</td>
        <td>${Math.max(0, r.look.elevation).toFixed(2)}°</td>
        <td>${fmtLon(r.satLon, 3)}</td>
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

  $("cityPreset").addEventListener("change", () => {
    const p = CITY_PRESETS[$("cityPreset").value];
    if (!p) return;
    $("lat").value = p.lat.toFixed(4);
    $("lon").value = p.lon.toFixed(4);
    $("h").value = String(p.h);
    selectedGeoPoints = [];
    renderSelectedGeoPoints();
    render();
  });

  ["lat","lon"].forEach(id => $(id).addEventListener("input", () => {
    const sel = $("cityPreset");
    const p = CITY_PRESETS[sel.value];
    if (!p) return;
    if (Math.abs(Number($("lat").value)-p.lat)>1e-6 || Math.abs(Number($("lon").value)-p.lon)>1e-6) sel.value="";
  }));

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
