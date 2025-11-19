// ================== Weather API & Manual Override ==================
const API_KEY = "bcd80b21e5b74547aa4170545250311";

// 手动预设：键盘 1–4 切换这些场景，0 回到实时天气
const MANUAL_PRESETS = {
  "1": { cloudPct: 15, pm25: 5, windKph: 6 },    // 较晴朗
  "2": { cloudPct: 45, pm25: 18, windKph: 10 },  // 正常多云
  "3": { cloudPct: 75, pm25: 45, windKph: 20 },  // 厚云 + 轻度污染
  "4": { cloudPct: 95, pm25: 110, windKph: 30 }  // 阴沉 + 明显雾霾
};
let manualMode = false; // true：使用 1–4 手动模式，跳过实时刷新

// ================== Helpers ==================
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function invLerp(a, b, v) {
  return clamp((v - a) / (b - a), 0, 1);
}

// ================== Fetch Realtime Weather ==================
async function fetchRealtimeWeather(q) {
  const url = `https://api.weatherapi.com/v1/current.json?key=${API_KEY}&q=${encodeURIComponent(
    q
  )}&aqi=yes`;
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
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 8000
        })
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

  const c = data.current;
  const loc = data.location;

  // ======= 拿出我们关心的数值 =======
  const cloudPct = clamp(Number(c.cloud ?? 0), 0, 100); // 0..100%
  const pm25 = Number(c.air_quality?.pm2_5 ?? 0); // µg/m³
  const windKph = Number(c.wind_kph ?? 0);

  // ----- 更新信息面板（只写“值”，不重复字段名） -----
  const cityEl = document.getElementById("city");
  if (cityEl) cityEl.textContent = `${loc.name}, ${loc.country}  (${loc.localtime})`;

  const tempEl = document.getElementById("temp");
  if (tempEl) tempEl.textContent = `${c.temp_c}°C (Feels like ${c.feelslike_c}°C)`;

  const windEl = document.getElementById("wind-v");
  if (windEl) windEl.textContent = `${c.wind_kph} kph ${c.wind_dir}`;

  const humEl = document.getElementById("humidity");
  if (humEl) humEl.textContent = `${c.humidity}%`;

  const descEl = document.getElementById("desc");
  if (descEl) descEl.textContent = c.condition.text;

  const cloudEl = document.getElementById("cloud");
  if (cloudEl) cloudEl.textContent = `${cloudPct}%`;

  const aqiEl = document.getElementById("aqi");
  if (aqiEl) aqiEl.textContent = `${pm25.toFixed(1)} µg/m³`;

  // ----- 驱动粒子可视化 -----
  if (typeof particleField !== "undefined") {
    particleField.updateEnvironment({ cloudPct, pm25, windKph });
  }

  return data;
}

// ================== Canvas Setup & Mouse State ==================
let canvas = null;
let ctx = null;

const mouseState = { x: 0, y: 0, active: false };
let mouseBound = false;

function initCanvasIfNeeded() {
  if (canvas && ctx) return;

  canvas = document.getElementById("cloud-canvas");
  ctx = canvas ? canvas.getContext("2d", { alpha: true }) : null;

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
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  console.log(
    `Cloudscript: resized canvas to ${canvas.width}x${canvas.height} (client ` +
      `${canvas.clientWidth}x${canvas.clientHeight}, dpr ${dpr})`
  );
}

addEventListener("resize", resize, { passive: true });
addEventListener("DOMContentLoaded", () => {
  resize();
});
try {
  resize();
} catch (e) {}

// ================== Cloud Particles ==================
class CloudParticle {
  constructor(w, h, cfg) {
    this.reset(w, h, cfg, true);
  }

  reset(w, h, cfg, first = false) {
    this.w = w;
    this.h = h;
    this.cfg = cfg;

    const centers = cfg.centers || [];

    if (centers.length > 0) {
      // 选一块云团中心
      const c = centers[(Math.random() * centers.length) | 0];

      // 在云团半径内随机一个偏移（指数分布：越靠中心越密）
      const ang = Math.random() * Math.PI * 2;
      const rad = c.r * Math.pow(Math.random(), 1.8);
      const ex = Math.cos(ang) * rad;
      const ey = Math.sin(ang) * rad * 0.5;

      this.x = c.x + ex;
      this.y = c.y + ey;

      // 风主导的整体平移 + 轻微旋转感
      const mag = Math.sqrt(ex * ex + ey * ey) || 1;
      const swirl = 0.008 + 0.02 * Math.random();
      this.vx = cfg.windVX + (-ey / mag) * swirl + (Math.random() - 0.5) * 0.006;
      this.vy = (ex / mag) * swirl * 0.35 + (Math.random() - 0.5) * 0.004;
    } else {
      // 兜底：还没有中心时的随机分布
      this.x = Math.random() * w;
      const tY = Math.random();
      this.y = h * tY * tY;
      this.vx = (Math.random() * 0.6 - 0.3) + cfg.windVX;
      this.vy = (Math.random() * 0.2 - 0.1) - 0.02;
    }

    // 尺寸 / 透明度：整体偏小、偏密
    const sizeBase = lerp(0.5, 1.6, cfg.cloudT);
    this.r = sizeBase * (0.6 + Math.random() * 1.0);

    const hazeT = invLerp(10, 75, cfg.pm25);
    this.alpha = lerp(0.10, 0.28, cfg.cloudT) * lerp(1.0, 1.4, hazeT);

    const grey = Math.floor(lerp(255, 220, hazeT));
    const brownish = Math.floor(lerp(255, 210, hazeT * 0.6));
    this.fill = `rgba(${brownish},${brownish},${grey},${this.alpha})`;

    this.life = 0;
    // 较长寿命 → 云团不会一下子全部消失
    this.maxLife = lerp(1200, 2600, cfg.cloudT);
    if (first) this.life = Math.random() * this.maxLife;
  }

  step() {
    this.life++;
    this.x += this.vx;
    this.y += this.vy;

    // 鼠标吹散
    if (mouseState && mouseState.active) {
      const dx = this.x - mouseState.x;
      const dy = this.y - mouseState.y;
      const distSq = dx * dx + dy * dy;
      const influenceR = 90;
      if (distSq < influenceR * influenceR) {
        const dist = Math.sqrt(distSq) || 1;
        const strength = ((influenceR - dist) / influenceR) * 0.3;
        this.vx += (dx / dist) * strength;
        this.vy += (dy / dist) * strength;
      }
    }

    // 回环边界
    if (this.x < -20) this.x = this.w + 20;
    if (this.x > this.w + 20) this.x = -20;
    if (this.y < -40) this.y = this.h + 40;
    if (this.y > this.h + 40) this.y = -40;

    // 微小噪声抖动
    this.vx += (Math.random() - 0.5) * 0.004;
    this.vy += (Math.random() - 0.5) * 0.003;

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
    this.pm25 = 0;
    this.windVX = 0;

    this.targetCount = 0;
    this.particles = [];
    this.hazeAlpha = 0;

    this.centers = [];
    this.centerCount = 0;
    this.lastW = 0;
    this.lastH = 0;
  }

  // 生成云团中心：基于原来的随机逻辑 + “尽量拉开距离（有限次）”
  updateCenters(w, h) {
    const targetCenters = Math.max(3, Math.floor(lerp(5, 8, this.cloudT)));

    const needReset =
      this.centers.length === 0 ||
      this.centerCount !== targetCenters ||
      this.lastW !== w ||
      this.lastH !== h;

    if (needReset) {
      this.centers = [];

      const baseMin = 180; // 最小距离基准
      const minCenterDist = lerp(baseMin, baseMin + 120, this.cloudT); // 云量越多 → 稍微拉开点

      for (let i = 0; i < targetCenters; i++) {
        let x, y;
        let attempts = 0;
        let ok = false;

        while (attempts < 10 && !ok) {
          // 原来的“覆盖全屏”的随机分布
          x = lerp(w * 0.15, w * 0.85, Math.random());
          y = lerp(h * 0.15, h * 0.85, Math.random());
          ok = true;

          for (const c of this.centers) {
            const dx = x - c.x;
            const dy = y - c.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minCenterDist) {
              ok = false;
              break;
            }
          }
          attempts++;
        }

        // 如果 10 次都没找到特别远的，就接受最后一次的位置（保证不会死循环）
        const r = lerp(130, 240, this.cloudT);
        this.centers.push({
          x,
          y,
          r,
          vx: this.windVX * 0.8,
          vy: (Math.random() - 0.5) * 0.01
        });
      }

      this.centerCount = targetCenters;
      this.lastW = w;
      this.lastH = h;
    } else {
      // 云团整体缓慢移动 & 从边缘回环
      for (const c of this.centers) {
        c.x += c.vx;
        c.y += c.vy;

        if (c.x < -c.r) c.x = w + c.r;
        if (c.x > w + c.r) c.x = -c.r;
        c.y = clamp(c.y, h * 0.05, h * 0.95);
      }
    }
  }

  updateEnvironment({ cloudPct, pm25, windKph }) {
    this.env = { cloudPct, pm25, windKph };
    this.cloudT = clamp(cloudPct / 100, 0, 1);
    this.pm25 = pm25;

    const minCount = 200;
    const maxCount = 2200;
    this.targetCount = Math.floor(lerp(minCount, maxCount, this.cloudT));

    // 稳定的水平风速
    const wT = invLerp(0, 40, windKph);
    const dir = Math.random() < 0.5 ? -1 : 1;
    this.windVX = dir * lerp(0.02, 0.08, wT);

    const hazeT = invLerp(10, 150, pm25);
    this.hazeAlpha = lerp(0.0, 0.22, hazeT);

    // 同步给已有粒子
    for (const p of this.particles) {
      p.cfg = {
        cloudT: this.cloudT,
        pm25: this.pm25,
        windVX: this.windVX,
        centers: this.centers
      };
    }
  }

  ensureCount() {
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    this.updateCenters(w, h);

    if (this.particles.length < this.targetCount) {
      const toAdd = this.targetCount - this.particles.length;
      for (let i = 0; i < toAdd; i++) {
        this.particles.push(
          new CloudParticle(w, h, {
            cloudT: this.cloudT,
            pm25: this.pm25,
            windVX: this.windVX,
            centers: this.centers
          })
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

    // 背景渐变
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#05070b");
    g.addColorStop(1, "#11161f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    for (const p of this.particles) {
      p.step();
      p.draw(ctx);
    }

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
    getRealtimeWeather();
    return;
  }
  const preset = MANUAL_PRESETS[key];
  if (!preset) return;

  manualMode = true;
  console.log("Manual override preset", key, preset);
  particleField.updateEnvironment(preset);

  const cloudEl = document.getElementById("cloud");
  if (cloudEl) cloudEl.textContent = `${preset.cloudPct}% (manual ${key})`;
  const aqiEl = document.getElementById("aqi");
  if (aqiEl) aqiEl.textContent = `${preset.pm25.toFixed(1)} µg/m³ (manual ${key})`;
});

// ================== Animation Loop & Timers ==================
function loop() {
  if (ctx) particleField.stepAndDraw(ctx);
  requestAnimationFrame(loop);
}
loop();

getRealtimeWeather();
setInterval(getRealtimeWeather, 5 * 60 * 1000);
