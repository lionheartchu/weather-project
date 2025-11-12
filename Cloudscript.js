// ===== 你的原始实时获取逻辑：保留并复用 =====
const API_KEY = "bcd80b21e5b74547aa4170545250311"; // ← 你已有的 key

async function fetchRealtimeWeather(q) {
  const url = `https://api.weatherapi.com/v1/current.json?key=${API_KEY}&q=${encodeURIComponent(q)}&aqi=yes`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  console.log("🌤️ Full realtime weather data:", data);
  return data;
}

async function getRealtimeWeather() {
  let data;
  if ("geolocation" in navigator) {
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000 })
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

  // ---- DOM 显示（沿用你已有的）----
  const c = data.current;
  const loc = data.location;

  const cityEl = document.getElementById("city");
  if (cityEl) cityEl.textContent = `${loc.name}, ${loc.country}  (${loc.localtime})`;

  const tempEl = document.getElementById("temp");
  if (tempEl) tempEl.textContent = `Temperature: ${c.temp_c}°C (Feels like ${c.feelslike_c}°C)`;

  const windEl = document.getElementById("wind-v");
  if (windEl) windEl.textContent = `Wind: ${c.wind_kph} km/h ${c.wind_dir}`;

  const humidityEl = document.getElementById("humidity");
  if (humidityEl) humidityEl.textContent = `Humidity: ${c.humidity}%`;

  const descEl = document.getElementById("desc");
  if (descEl) descEl.textContent = `Condition: ${c.condition.text}`;

  // 关键字段：云量 & PM2.5
  const cloudPct = clamp(Number(c.cloud ?? 0), 0, 100);          // 0..100 %
  const pm25 = Number(c.air_quality?.pm2_5 ?? 0);                // µg/m³
  const cloudEl = document.getElementById("cloud");
  if (cloudEl) cloudEl.textContent = `Cloud cover: ${cloudPct}%`;
  const aqiEl = document.getElementById("aqi");
  if (aqiEl) aqiEl.textContent   = `PM2.5: ${pm25.toFixed(1)} µg/m³`;

  // 用于风向漂移
  const windKph = Number(c.wind_kph ?? 0);

  // 更新可视化
  if (typeof particleField !== 'undefined') particleField.updateEnvironment({ cloudPct, pm25, windKph });

  return data;
}

// ====== 粒子云可视化（Canvas 2D）======
let canvas = null;
let ctx = null;

function initCanvasIfNeeded() {
  if (canvas && ctx) return;
  canvas = document.getElementById("cloud-canvas");
  ctx = canvas ? canvas.getContext("2d", { alpha: true }) : null;

  if (!canvas) console.warn('Cloudscript: canvas#cloud-canvas not found in DOM.');
  else console.log('Cloudscript: canvas found', canvas);
  if (!ctx) console.warn('Cloudscript: 2D context could not be obtained (ctx is null).');
  else console.log('Cloudscript: 2D context ready');
}

function resize() {
  initCanvasIfNeeded();
  if (!canvas || !ctx) return;
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width  = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  console.log(`Cloudscript: resized canvas to ${canvas.width}x${canvas.height} (client ${canvas.clientWidth}x${canvas.clientHeight}, dpr ${dpr})`);

  // quick visual smoke test: draw a visible rectangle and circle
  try {
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.fillStyle = 'rgba(255,80,80,0.9)';
    ctx.fillRect(10, 10, 120, 40);
    ctx.fillStyle = 'rgba(80,200,255,0.9)';
    ctx.beginPath(); ctx.arc(200, 60, 28, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'white'; ctx.font = '14px sans-serif'; ctx.fillText('test draw', 18, 36);
    console.log('Cloudscript: drew smoke-test shapes on canvas');
  } catch (e) {
    console.error('Cloudscript: error drawing smoke-test', e);
  }
}

addEventListener("resize", resize, { passive: true });
addEventListener('DOMContentLoaded', () => {
  // Ensure canvas init after DOM ready
  resize();
});

// In case the script is loaded after DOMContentLoaded, ensure canvas is initialized now.
try { resize(); } catch (e) { /* noop */ }

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t){ return a + (b - a) * t; }
function invLerp(a, b, v){ return clamp((v - a) / (b - a), 0, 1); }

class CloudParticle {
  constructor(w, h, cfg) {
    this.reset(w, h, cfg, true);
  }
  reset(w, h, cfg, first=false) {
    this.w = w; this.h = h; this.cfg = cfg;

    // 初始位置与速度
    this.x = Math.random() * w;
    this.y = Math.random() * h * 0.7;              // 更集中在上部区域
    this.vx = (Math.random() * 0.6 - 0.3) + cfg.windVX;
    this.vy = (Math.random() * 0.2 - 0.1) - 0.02;  // 略微向上

    // 尺寸 / 透明度由云量决定
    const sizeBase = lerp(0.8, 3.2, cfg.cloudT);
    this.r = sizeBase * (0.5 + Math.random()*1.5);

    // pm2.5 带来的“浑浊度” → 颜色与透明度
    const hazeT = invLerp(10, 75, cfg.pm25);
    this.alpha = lerp(0.06, 0.18, cfg.cloudT) * lerp(1.0, 1.6, hazeT);

    // 偏灰/偏棕：越污染越偏棕
    const grey = Math.floor(lerp(235, 190, hazeT));
    const brownish = Math.floor(lerp(235, 165, hazeT * 0.8));
    this.fill = `rgba(${brownish},${brownish},${grey},${this.alpha})`;

    this.life = 0;
    this.maxLife = lerp(240, 540, cfg.cloudT) * lerp(1.0, 0.7, hazeT); // 污染越重，寿命略短
    if (first) this.life = Math.random() * this.maxLife;
  }
  step() {
    this.life++;
    this.x += this.vx;
    this.y += this.vy;

    // 回环
    if (this.x < -10) this.x = this.w + 10;
    if (this.x > this.w + 10) this.x = -10;
    if (this.y < -20) this.y = this.h + 20;
    if (this.y > this.h + 20) this.y = -20;

    // 简单噪声抖动
    this.vx += (Math.random()-0.5) * 0.02;
    this.vy += (Math.random()-0.5) * 0.01;

    if (this.life > this.maxLife) {
      this.reset(this.w, this.h, this.cfg);
    }
  }
  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI*2);
    ctx.fillStyle = this.fill;
    ctx.fill();
  }
}

class ParticleField {
  constructor() {
    this.env = { cloudPct: 0, pm25: 0, windKph: 0 };
    this.cloudT = 0;    // 0..1 云量归一化
    this.pm25 = 0;
    this.windVX = 0;

    this.targetCount = 0;
    this.particles = [];
    this.hazeAlpha = 0; // 全屏雾幕（由 PM2.5 控制）
  }

  updateEnvironment({ cloudPct, pm25, windKph }) {
    this.env = { cloudPct, pm25, windKph };
    this.cloudT = clamp(cloudPct / 100, 0, 1);
    this.pm25 = pm25;

    // 粒子数量随云量在 [80, 900] 之间
    this.targetCount = Math.round(lerp(80, 900, this.cloudT));

    // 风向水平漂移（风速 0..40+ km/h → vx -0.15..0.35）
    const wT = invLerp(0, 40, windKph);
    this.windVX = lerp(-0.05, 0.25, wT) * (Math.random() < 0.5 ? -1 : 1);

    // 全屏雾幕透明度（PM2.5 10..150）
    const hazeT = invLerp(10, 150, pm25);
    this.hazeAlpha = lerp(0.0, 0.22, hazeT);

    // 同步给粒子（参数变化后立即让新粒子体现新环境）
    for (const p of this.particles) {
      p.cfg = { cloudT: this.cloudT, pm25: this.pm25, windVX: this.windVX };
    }
  }

  ensureCount() {
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // 增减粒子
    while (this.particles.length < this.targetCount) {
      this.particles.push(new CloudParticle(w, h, { cloudT: this.cloudT, pm25: this.pm25, windVX: this.windVX }));
    }
    while (this.particles.length > this.targetCount) {
      this.particles.pop();
    }
  }

  stepAndDraw(ctx) {
    if (!ctx || !canvas) return;
    this.ensureCount();

    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    // 背景渐变（更“天空”一点）
    const g = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight);
    g.addColorStop(0, "#0b0e12");
    g.addColorStop(1, "#121820");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    // 粒子层
    for (const p of this.particles) {
      p.step();
      p.draw(ctx);
    }

    // 雾幕叠加：PM2.5 越高越浊
    if (this.hazeAlpha > 0.001) {
      ctx.fillStyle = `rgba(180,170,160,${this.hazeAlpha})`;
      ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    }
  }
}

const particleField = new ParticleField();

// 动画循环
let rafId = null;
function loop() {
  if (ctx) particleField.stepAndDraw(ctx);
  rafId = requestAnimationFrame(loop);
}
loop();

// 定时刷新实时数据（首次 + 每 5 分钟）
getRealtimeWeather();
setInterval(getRealtimeWeather, 5 * 60 * 1000);
