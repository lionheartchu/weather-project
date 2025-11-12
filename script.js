
const API_KEY = "bcd80b21e5b74547aa4170545250311";
// ====== CONFIG ======

const CONDITIONS_URL = "conditions.json";   // 你放的本地文件

// ====== Fetch current.json with AQI (needed for Cloudy metrics) ======
async function fetchRealtimeWeather(q = "auto:ip") {
  const url = `https://api.weatherapi.com/v1/current.json?key=${API_KEY}&q=${encodeURIComponent(q)}&aqi=yes`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`current.json HTTP ${res.status}`);
  const data = await res.json();
  console.log("Full realtime weather data:", data);
  return data;
}

// ====== Build code -> Category from conditions.json ======
async function loadConditionsList(url = CONDITIONS_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`conditions.json HTTP ${res.status}`);
  return res.json(); // [{code, day, night, icon}, ...]
}

function buildCodeCategoryMap(list) {
  const map = new Map();
  for (const it of list) {
    const code = it.code;
    const txt = `${(it.day || "").toLowerCase()} ${(it.night || "").toLowerCase()}`;

    let cat = null;
    if (/snow|sleet|blizzard|ice pellets/.test(txt)) cat = "SNOW";
    else if (/rain|drizzle|shower|thunder/.test(txt)) cat = "RAIN";
    else if (/cloud|overcast|fog|mist|haze/.test(txt)) cat = "CLOUDY";
    else if (code === 1000) cat = "SUNNY";   // Sunny / Clear
    else if (code === 1087) cat = "WINDY";   // Thundery outbreaks possible → 你要的 WINDY 桶
    else cat = "CLOUDY";                     // 兜底

    map.set(code, cat);
  }
  return map;
}

async function classifyCategory(data) {
  const list = await loadConditionsList();
  const codeMap = buildCodeCategoryMap(list);
  const code = data?.current?.condition?.code;
  const text = data?.current?.condition?.text || "";
  const category = codeMap.get(code) || "CLOUDY";
  return { category, code, text };
}

// ====== Pick metrics per your spec ======
function pickCategoryMetrics(category, cur) {
  // cur = data.current
  const aq = cur.air_quality || {};
  const base = {
    // useful basics you also show at left panel
    wind_kph: cur.wind_kph,
    wind_dir: cur.wind_dir,
    humidity: cur.humidity,
    precip_mm: cur.precip_mm,
    cloud: cur.cloud,
    uv: cur.uv,
    temp_f: cur.temp_f,
  };

  if (category === "CLOUDY") {
    return {
      cloud_pct: base.cloud,         // Cloud cover as percentage
      pm2_5: aq.pm2_5 ?? null,
    };
  }
  if (category === "WINDY") {
    return {
      wind_dir: base.wind_dir,
      wind_kph: base.wind_kph
    };
  }
  if (category === "SUNNY") {
    return {
      uv: base.uv,
      temp_f: base.temp_f
    };
  }
  if (category === "RAIN") {
    return {
      humidity: base.humidity,
      precip_mm: base.precip_mm
    };
  }
  if (category === "SNOW") {
    return {
      precip_mm: base.precip_mm,  // 实况里没有独立雪量字段；需要更准可用 forecast.hour.snow_cm
      wind_kph: base.wind_kph
    };
  }
  return {};
}

// ====== Render helpers ======
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderMetrics(obj) {
  const root = document.getElementById("metrics");
  if (!root) return;
  root.innerHTML = "";
  const entries = Object.entries(obj).filter(([,v]) => v !== null && v !== undefined);
  if (entries.length === 0) {
    root.textContent = "No metrics available for this category.";
    return;
  }
  for (const [k, v] of entries) {
    const div = document.createElement("div");
    div.className = "kv";
    div.innerHTML = `<b>${k}:</b> ${v}`;
    root.appendChild(div);
  }
}

// ====== Main ======
const fmt = v => (v === undefined || v === null || v === "" ? "N/A" : v);
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // geolocation → fallback to auto:ip
    let data;
    if ("geolocation" in navigator) {
      try {
        const pos = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 8000 })
        );
        const lat = pos.coords.latitude.toFixed(6);
        const lon = pos.coords.longitude.toFixed(6);
        data = await fetchRealtimeWeather(`${lat},${lon}`);
      } catch {
        data = await fetchRealtimeWeather("auto:ip");
      }
    } else {
      data = await fetchRealtimeWeather("auto:ip");
    }

    const cur = data.current;
    const aq = cur.air_quality || {};

    // update floating info panel
    setText("city", `${data.location.name}, ${data.location.country}`);
    setText("desc", data.current.condition.text);
    setText("temp", `${data.current.temp_c}°C (feels ${data.current.feelslike_c}°C)`);
    setText("base-wind", `${data.current.wind_kph} km/h ${data.current.wind_dir}`);
    setText("base-humidity", `${data.current.humidity}%`);
    setText("cloud", `${fmt(cur.cloud)}%`);
    setText("aqi-pm25", `${fmt(aq.pm2_5)} μg/m³`);

    // classify & show category metrics (optional - can hide if space limited)
    const { category } = await classifyCategory(data);

    const metrics = pickCategoryMetrics(category, data.current);
    // renderMetrics(metrics); // hidden in immersive mode

  } catch (err) {
    console.error(err);
    setText("city", "Unable to load");
    setText("desc", "—");
    setText("temp", "—");
    setText("base-wind", "—");
    setText("base-humidity", "—");
  }
});
