// ================== Weather API & Manual Override ==================
const API_KEY = "bcd80b21e5b74547aa4170545250311";

// 手动预设：键盘 1–4 切换这些场景，0 回到实时天气
const MANUAL_PRESETS = {
  '1': { cloudPct: 15, pm25: 5,  windKph: 6  },   // 较晴朗
  '2': { cloudPct: 45, pm25: 18, windKph: 10 },   // 正常多云
  '3': { cloudPct: 75, pm25: 45, windKph: 20 },   // 厚云 + 轻度污染
  '4': { cloudPct: 95, pm25: 110, windKph: 30 }   // 阴沉 + 明显雾霾
};
let manualMode = false;  // true：使用 1–4 手动模式，跳过实时刷新

// ================== Helpers ==================
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t){ return a + (b - a) * t; }
function invLerp(a, b, v){ return clamp((v - a) / (b - a), 0, 1); }

// ================== Fetch Realtime Weather ==================
async function fetchRealtimeWeather(q) {
  const url = `https://api.weatherapi.com/v1/current.json?key=${API_KEY}&q=${encodeURIComponent(q)}&aqi=yes`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  console.log("🌤️ Full realtime weather data:", data);
  return data;
}

async function getRealtimeWeather() {
  // 手动模式下直接跳过实时刷新（避免覆盖 1–4 的效果）
  if (manualMode) {
    console.log("⏸ Manual mode active → skip realtime weather update");
    return null;
  }

  let data;
  if ("geolocation" in navigator) {
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          { enableHighAccuracy: true, timeout: 8000 }
        )
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

  const c   = data.current;
  const loc = data.location;

  // ----- 更新信息面板 -----
  const cityEl = document.getElementById("city");
  if (cityEl) cityEl.textContent = `${loc.name} ${loc.country}  (${loc.localtime})`;

  const tempEl = document.getElementById("temp");
  if (tempEl) tempEl.textContent = `Temperature: ${c.temp_c}°C (Feels like ${c.feelslike_c}°C)`;

  const windEl = document.getElementById("wind-v");
  if (windEl) windEl.textContent = `Wind: ${c.wind_kph} kph ${c.wind_dir}`;

  const humidityEl = document.getElementById("humidity");
  if (humidityEl) humidityEl.textContent = `Humidity: ${c.humidity}%`;

  const descEl = document.getElementById("desc");
  if (descEl) descEl.textContent = `Condition: ${c.condition.text}`;

  const cloudPct = clamp(Number(c.cloud ?? 0), 0, 100);     // 0..100%
  const pm25     = Number(c.air_quality?.pm2_5 ?? 0);       // µg/m³
  const windKph  = Number(c.wind_kph ?? 0);

  const cloudEl = document.getElementById("cloud");
  if (cloudEl) cloudEl.textContent = `Cloud cover: ${cloudPct}%`;
  const aqiEl = document.getElementById("aqi");
  if (aqiEl) aqiEl.textContent   = `PM2.5: ${pm25.toFixed(1)} µg/m³`;

  // ----- 驱动可视化 -----
  if (typeof particleField !== "undefined") {
    particleField.updateEnvironment({ cloudPct, pm25, windKph });
  }

  return data;
}

// ================== Canvas Setup & Mouse State ==================
let canvas = null;
let ctx     = null;

const mouseState = { x: 0, y: 0, active: false };
let mouseBound   = false;

function initCanvasIfNeeded() {
  if (canvas && ctx) return;

  canvas = document.getElementById("cloud-canvas");
  ctx    = canvas ? canvas.getContext("2d", { alpha: true }) : null;

  if (!canvas) console.warn("Cloudscript: canvas#cloud-canvas not found in DOM.");
  else console.log("Cloudscript: canvas found", canvas);
  if (!ctx) console.warn("Cloudscript: 2D context could not be obtained (ctx is null).");
  else console.log("Cloudscript: 2D context ready");

  // 绑定鼠标事件（只绑定一次）
  if (canvas && !mouseBound) {
    mouseBound = true;
    canvas.addEventListener("mousemove", (ev) => {
      const rect = canvas.getBoundingClientRect();
      mouseState.x = ev.clientX - rect.left;
      mouseState.y = ev.clientY - rect.top;
      mouseState.active = true;
    });
    canvas.addEventListener("mouseleave", () => {
      mouseState.active = false;
    });
  }
}

function resize() {
  initCanvasIfNeeded();
  if (!canvas || !ctx) return;

  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width  = Math.floor(canvas.clientWidth  * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  console.log(
    `Cloudscript: resized canvas to ${canvas.width}x${canvas.height} (client ` +
    `${canvas.clientWidth}x${canvas.clientHeight}, dpr ${dpr})`
  );
}

addEventListener("resize", resize, { passive: true });
addEventListener("DOMContentLoaded", () => { resize(); });
try { resize(); } catch (e) { /* noop */ }

// ================== Cloud Particles ==================
class CloudParticle {
  constructor(w, h, cfg) {
    this.reset(w, h, cfg, true);
  }

  reset(w, h, cfg, first = false) {
    this.w = w; this.h = h; this.cfg = cfg;

    const centers = cfg.centers || [];

    if (centers.length > 0) {
      // 选一块云团中心
      const c = centers[(Math.random() * centers.length) | 0];

      // 在云团半径内随机一个偏移（幂次 >1 → 中心更密）
      const ang = Math.random() * Math.PI * 2;
      const rad = c.r * Math.pow(Math.random(), 2.4); // 比之前更收敛
      const ex  = Math.cos(ang) * rad;
      const ey  = Math.sin(ang) * rad * 0.35;         // 云团更扁平一点

      this.x = c.x + ex;
      this.y = c.y + ey;

      // 基于风向 + 围绕中心的微旋转，让云有翻滚感
      const mag    = Math.sqrt(ex * ex + ey * ey) || 1;
      const swirl  = 0.03 + 0.06 * Math.random();     // 比上一版稍弱一些
      this.vx = cfg.windVX + (-ey / mag) * swirl + (Math.random() - 0.5) * 0.015;
      this.vy = -0.01        + (ex / mag) * swirl + (Math.random() - 0.5) * 0.008;
    } else {
      // 兜底：还没有中心时用原本随机分布
      this.x = Math.random() * w;
      const tY = Math.random();
      this.y = h * tY * tY;
      this.vx = (Math.random() * 0.6 - 0.3) + cfg.windVX;
      this.vy = (Math.random() * 0.2 - 0.1) - 0.02;
    }

    // 尺寸 / 透明度：整体更小、更密
    const sizeBase = lerp(0.5, 1.6, cfg.cloudT);
    this.r = sizeBase * (0.6 + Math.random() * 1.0);

    const hazeT = invLerp(10, 75, cfg.pm25);
    this.alpha = lerp(0.08, 0.22, cfg.cloudT) * lerp(1.0, 1.4, hazeT);

    const grey     = Math.floor(lerp(245, 210, hazeT));
    const brownish = Math.floor(lerp(245, 185, hazeT * 0.8));
    this.fill = `rgba(${brownish},${brownish},${grey},${this.alpha})`;

    this.life    = 0;
    this.maxLife = lerp(260, 560, cfg.cloudT) * lerp(1.0, 0.7, hazeT);
    if (first) this.life = Math.random() * this.maxLife;
  }

  step() {
    this.life++;
    this.x += this.vx;
    this.y += this.vy;

    // 鼠标吹散：鼠标附近粒子被“吹”离鼠标
    if (mouseState && mouseState.active) {
      const dx = this.x - mouseState.x;
      const dy = this.y - mouseState.y;
      const distSq = dx * dx + dy * dy;
      const influenceR = 110;
      if (distSq < influenceR * influenceR) {
        const dist = Math.sqrt(distSq) || 1;
        const strength = (influenceR - dist) / influenceR * 0.40;
        this.vx += (dx / dist) * strength;
        this.vy += (dy / dist) * strength;
      }
    }

    // 回环边界
    if (this.x < -10) this.x = this.w + 10;
    if (this.x > this.w + 10) this.x = -10;
    if (this.y < -20) this.y = this.h + 20;
    if (this.y > this.h + 20) this.y = -20;

    // 微小噪声抖动
    this.vx += (Math.random() - 0.5) * 0.01;
    this.vy += (Math.random() - 0.5) * 0.006;

    if (this.life > this.maxLife) {
      this.reset(this.w, this.h, this.cfg);
    }
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fillStyle = this.fill;
    ctx.fill();
  }
}

// ================== Particle Field with Cloud Centers ==================
class ParticleField {
  constructor() {
    this.env = { cloudPct: 0, pm25: 0, windKph: 0 };
    this.cloudT = 0;
    this.pm25   = 0;
    this.windVX = 0;

    this.targetCount = 0;
    this.particles   = [];
    this.hazeAlpha   = 0;

    // 云团中心（几大块云）
    this.centers     = [];
    this.centerCount = 0;
    this.lastW       = 0;
    this.lastH       = 0;
  }

  updateCenters(w, h) {
    // 云量越大 → 云团稍微多一些，但保持在 3–6 块
    const targetCenters = Math.max(3, Math.floor(lerp(3, 6, this.cloudT)));

    const needReset =
      this.centers.length === 0 ||
      this.centerCount !== targetCenters ||
      this.lastW !== w || this.lastH !== h;

    if (needReset) {
      this.centers = [];
      for (let i = 0; i < targetCenters; i++) {
        // 在中间 70% 区域随机放置云团，避免太平均
        const x = lerp(w * 0.18, w * 0.82, Math.random());
        const baseY = lerp(0.22, 0.45, Math.random()); // 略偏上
        const y = h * baseY;
        const r = lerp(110, 190, this.cloudT);         // 半径比上一版稍小，更紧凑
        this.centers.push({
          x,
          y,
          r,
          vx: this.windVX * 0.35,
          vy: (Math.random() - 0.5) * 0.03
        });
      }
      this.centerCount = targetCenters;
      this.lastW = w;
      this.lastH = h;
    } else {
      // 已有云团缓慢移动 & 从边缘回环
      for (const c of this.centers) {
        c.x += c.vx;
        c.y += c.vy;

        if (c.x < -c.r) c.x = w + c.r;
        if (c.x > w + c.r) c.x = -c.r;
        c.y = clamp(c.y, h * 0.18, h * 0.60);
      }
    }
  }

  updateEnvironment({ cloudPct, pm25, windKph }) {
    this.env     = { cloudPct, pm25, windKph };
    this.cloudT  = clamp(cloudPct / 100, 0, 1);
    this.pm25    = pm25;

    // 粒子数量明显提高 → 更像「灯泡云」
    const minCount = 200;
    const maxCount = 2200;
    this.targetCount = Math.floor(lerp(minCount, maxCount, this.cloudT));

    const wT = invLerp(0, 40, windKph);
    this.windVX = lerp(-0.05, 0.25, wT) * (Math.random() < 0.5 ? -1 : 1);

    const hazeT = invLerp(10, 150, pm25);
    this.hazeAlpha = lerp(0.0, 0.22, hazeT);

    // 把最新环境参数同步到每个粒子（包括 centers）
    for (const p of this.particles) {
      p.cfg = {
        cloudT: this.cloudT,
        pm25:   this.pm25,
        windVX: this.windVX,
        centers: this.centers
      };
    }
  }

  ensureCount() {
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    // 先更新云团中心
    this.updateCenters(w, h);

    // 补充或裁剪粒子数量
    if (this.particles.length < this.targetCount) {
      const toAdd = this.targetCount - this.particles.length;
      for (let i = 0; i < toAdd; i++) {
        this.particles.push(
          new CloudParticle(
            w,
            h,
            {
              cloudT: this.cloudT,
              pm25:   this.pm25,
              windVX: this.windVX,
              centers: this.centers
            }
          )
        );
      }
    } else if (this.particles.length > this.targetCount) {
      this.particles.length = this.targetCount;
    }
  }

  stepAndDraw(ctx) {
    if (!ctx || !canvas) return;
    this.ensureCount();

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    ctx.clearRect(0, 0, w, h);

    // 背景渐变（天空）
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#05070b");
    g.addColorStop(1, "#11161f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 粒子层
    for (const p of this.particles) {
      p.step();
      p.draw(ctx);
    }

    // 全屏雾幕：PM2.5 越高越浊
    if (this.hazeAlpha > 0.001) {
      ctx.fillStyle = `rgba(180,170,160,${this.hazeAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

// ================== Create Field & Keyboard Controls ==================
const particleField = new ParticleField();

console.log("Keyboard 1–4: 手动切换不同云量/空气质量预设，0: 返回实时天气");

// 键盘控制：1–4 为手动预设，0 退出手动模式
addEventListener("keydown", (ev) => {
  const key = ev.key;
  if (key === "0") {
    manualMode = false;
    console.log("Manual override OFF → back to realtime data");
    getRealtimeWeather();  // 立即刷新一次实时数据
    return;
  }
  const preset = MANUAL_PRESETS[key];
  if (!preset) return;

  manualMode = true;
  console.log("Manual override preset", key, preset);
  particleField.updateEnvironment(preset);

  // 更新信息面板的 cloud / PM2.5 显示
  const cloudEl = document.getElementById("cloud");
  if (cloudEl) cloudEl.textContent = `Cloud cover: ${preset.cloudPct}% (manual ${key})`;
  const aqiEl = document.getElementById("aqi");
  if (aqiEl) aqiEl.textContent   = `PM2.5: ${preset.pm25.toFixed(1)} µg/m³ (manual ${key})`;
});

// ================== Animation Loop & Timers ==================
function loop() {
  if (ctx) particleField.stepAndDraw(ctx);
  requestAnimationFrame(loop);
}
loop();

getRealtimeWeather();                             // 启动时拉一次
setInterval(getRealtimeWeather, 5 * 60 * 1000);   // 每 5 分钟刷新一次
