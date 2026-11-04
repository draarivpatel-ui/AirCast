(function () {
  "use strict";

  const STATIONS = [
    {
      id: "C8",
      name: "Houston Aldine (EPA CAMS 8)",
      lat: 29.901,
      lon: -95.326,
      pm25: 18.4,
      pm10: 42.0,
      o3_ppb: 68,
      no2_ppb: 21,
      pollen_idx: 7.4,
      wind_mph: 8.5,
      wind_dir: "SSE",
      humidity: 64,
      forecast48h: [
        58, 62, 69, 76, 84, 92, 97, 89, 78, 66, 59, 55,
        61, 70, 82, 95, 108, 114, 104, 88, 74, 65, 58, 52
      ]
    },
    {
      id: "C35",
      name: "Deer Park Ship Channel (EPA CAMS 35)",
      lat: 29.670,
      lon: -95.128,
      pm25: 26.8,
      pm10: 61.5,
      o3_ppb: 79,
      no2_ppb: 34,
      pollen_idx: 6.2,
      wind_mph: 11.2,
      wind_dir: "ESE",
      humidity: 71,
      forecast48h: [
        74, 80, 88, 96, 109, 118, 124, 112, 95, 84, 76, 71,
        79, 91, 105, 119, 131, 136, 122, 103, 89, 78, 72, 68
      ]
    },
    {
      id: "C53",
      name: "Bayland Park Southwest (EPA CAMS 53)",
      lat: 29.695,
      lon: -95.499,
      pm25: 13.2,
      pm10: 31.0,
      o3_ppb: 54,
      no2_ppb: 14,
      pollen_idx: 8.6,
      wind_mph: 6.8,
      wind_dir: "S",
      humidity: 58,
      forecast48h: [
        44, 48, 53, 61, 68, 74, 77, 70, 61, 52, 46, 42,
        47, 55, 64, 73, 81, 85, 76, 65, 54, 49, 45, 41
      ]
    },
    {
      id: "C403",
      name: "Clinton Drive Industrial (EPA CAMS 403)",
      lat: 29.733,
      lon: -95.257,
      pm25: 31.5,
      pm10: 78.2,
      o3_ppb: 74,
      no2_ppb: 38,
      pollen_idx: 5.9,
      wind_mph: 9.4,
      wind_dir: "SE",
      humidity: 68,
      forecast48h: [
        82, 88, 95, 104, 115, 126, 134, 121, 106, 92, 85, 79,
        86, 98, 112, 128, 139, 144, 129, 110, 96, 87, 81, 75
      ]
    }
  ];

  // Official EPA piecewise linear AQI calculation for PM2.5 (24h ug/m3) and O3 (8h ppb)
  function calcPm25Aqi(c) {
    const bp = [
      [0.0, 9.0, 0, 50],
      [9.1, 35.4, 51, 100],
      [35.5, 55.4, 101, 150],
      [55.5, 125.4, 151, 200],
      [125.5, 225.4, 201, 300]
    ];
    for (const [cLow, cHigh, iLow, iHigh] of bp) {
      if (c <= cHigh) {
        return Math.round(((iHigh - iLow) / (cHigh - cLow)) * (Math.max(c, cLow) - cLow) + iLow);
      }
    }
    return 301;
  }

  function calcO3Aqi(ppb) {
    const bp = [
      [0, 54, 0, 50],
      [55, 70, 51, 100],
      [71, 85, 101, 150],
      [86, 105, 151, 200],
      [106, 200, 201, 300]
    ];
    for (const [cLow, cHigh, iLow, iHigh] of bp) {
      if (ppb <= cHigh) {
        return Math.round(((iHigh - iLow) / (cHigh - cLow)) * (Math.max(ppb, cLow) - cLow) + iLow);
      }
    }
    return 301;
  }

  function aqiTier(aqi) {
    if (aqi <= 50) return { label: "Good", color: "#10b981", guidance: "Unrestricted outdoor activity." };
    if (aqi <= 100) return { label: "Moderate", color: "#f59e0b", guidance: "Sensitive individuals should limit prolonged outdoor exertion." };
    if (aqi <= 150) return { label: "Unhealthy for Sensitive Groups", color: "#f97316", guidance: "Asthma and pediatric cohorts should shift heavy exertion indoors." };
    return { label: "Unhealthy", color: "#ef4444", guidance: "Avoid prolonged outdoor exertion; activate HEPA filtration or N95." };
  }

  let currentStation = STATIONS[0];

  function renderForecastChart(station) {
    const canvas = document.getElementById("aqiForecastCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = (canvas.width = canvas.clientWidth || 540);
    const h = (canvas.height = canvas.clientHeight || 130);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, w, h);

    // Threshold lines (50, 100, 150)
    const maxAqi = 160;
    const padL = 34, padR = 14, padT = 14, padB = 22;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    [50, 100, 150].forEach((lvl) => {
      const y = padT + plotH * (1 - lvl / maxAqi);
      ctx.strokeStyle = lvl === 100 ? "rgba(245,158,11,0.35)" : "rgba(148,163,184,0.16)";
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillStyle = "#64748b";
      ctx.font = "10px JetBrains Mono, monospace";
      ctx.fillText(String(lvl), 6, y + 3);
    });

    const pts = station.forecast48h;
    ctx.beginPath();
    pts.forEach((v, i) => {
      const x = padL + (i / (pts.length - 1)) * plotW;
      const y = padT + plotH * (1 - Math.min(v, maxAqi) / maxAqi);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.stroke();

    pts.forEach((v, i) => {
      const x = padL + (i / (pts.length - 1)) * plotW;
      const y = padT + plotH * (1 - Math.min(v, maxAqi) / maxAqi);
      ctx.fillStyle = aqiTier(v).color;
      ctx.beginPath();
      ctx.arc(x, y, 2.8, 0, Math.PI * 2);
      ctx.fill();
      if (i % 4 === 0) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "9px JetBrains Mono, monospace";
        ctx.fillText(`+${i * 2}h`, x - 10, h - 6);
      }
    });
  }

  function updateDashboard() {
    const st = currentStation;
    const pmAqi = calcPm25Aqi(st.pm25);
    const o3Aqi = calcO3Aqi(st.o3_ppb);
    const compositeAqi = Math.max(pmAqi, o3Aqi);
    const peak48h = Math.max(...st.forecast48h);
    const tier = aqiTier(compositeAqi);

    const hours = parseFloat(document.getElementById("expHours")?.value || "2");
    const ventRate = parseFloat(document.getElementById("expActivity")?.value || "1.8"); // m3/hr
    const maskFactor = parseFloat(document.getElementById("expMask")?.value || "1.0");

    const inhaledUg = st.pm25 * hours * ventRate * maskFactor;
    const eqCigs = inhaledUg / 22.0; // Berkeley Earth 22 ug/m3 per 24h ~ 1 cigarette equivalence scaled by dose

    const setEl = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };

    setEl("aqiCompositeVal", `${compositeAqi} AQI (${tier.label})`);
    const badge = document.getElementById("aqiCompositeVal");
    if (badge) badge.style.color = tier.color;

    setEl("aqiPm25Val", `${st.pm25.toFixed(1)} ug/m3 (AQI ${pmAqi})`);
    setEl("aqiPm10Val", `${st.pm10.toFixed(1)} ug/m3`);
    setEl("aqiO3Val", `${st.o3_ppb} ppb (AQI ${o3Aqi})`);
    setEl("aqiAllergenVal", `${st.pollen_idx.toFixed(1)} / 12.0`);
    setEl("aqiPeak48Val", `${peak48h} AQI (+${st.forecast48h.indexOf(peak48h) * 2}h)`);
    setEl("aqiGuidanceText", tier.guidance);
    setEl("expHoursLabel", `${hours.toFixed(1)}h`);
    setEl("expDoseVal", `${inhaledUg.toFixed(1)} ug PM2.5 (${eqCigs.toFixed(2)} cig eq)`);

    renderForecastChart(st);
  }

  function initAqiStudio() {
    const sel = document.getElementById("aqiStationSelect");
    if (!sel) return;
    sel.innerHTML = STATIONS.map(
      (s) => `<option value="${s.id}">${s.name}</option>`
    ).join("");
    sel.addEventListener("change", () => {
      currentStation = STATIONS.find((s) => s.id === sel.value) || STATIONS[0];
      updateDashboard();
    });

    ["expHours", "expActivity", "expMask"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", updateDashboard);
    });

    const btnBroadcastAqi = document.getElementById("btnBroadcastAqi");
    if (btnBroadcastAqi) {
      btnBroadcastAqi.addEventListener("click", () => {
        const st = currentStation;
        const compositeAqi = Math.max(calcPm25Aqi(st.pm25), calcO3Aqi(st.o3_ppb));
        const peak48h = Math.max(...st.forecast48h);
        const packet = JSON.stringify({
          type: "AIRCAST_AQI_TELEMETRY",
          station: st.id,
          name: st.name,
          aqi: compositeAqi,
          pm25_ugm3: st.pm25,
          pm10_ugm3: st.pm10,
          o3_ppb: st.o3_ppb,
          allergen_idx: st.pollen_idx,
          forecast_48h_peak_aqi: peak48h
        });
        const input = document.getElementById("payloadInput");
        if (input) {
          input.value = packet;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        const loopBtn = document.getElementById("btnLoopback");
        if (loopBtn) loopBtn.click();
      });
    }

    updateDashboard();
    window.addEventListener("resize", () => renderForecastChart(currentStation));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAqiStudio);
  } else {
    initAqiStudio();
  }
})();
