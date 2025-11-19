// ================= Realtime weather fetch =====================
const API_KEY = "bcd80b21e5b74547aa4170545250311";

// 实时风数据（主要用来算强度）
let liveWind = { kph: 0, deg: 0 };
let currentWind = { kph: 0, deg: 0 };

// 手动模式
let manualOverride = false;
let manualLevel = 0;

async function fetchRealtimeWeather(q) {
  const url = `https://api.weatherapi.com/v1/current.json?key=${API_KEY}&q=${encodeURIComponent(
    q
  )}&aqi=yes`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  console.log("🌬️ Full realtime weather data:", data);
  return data;
}

async function getRealtimeWeather() {
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

  // ---- DOM 显示 ----
  const cityEl = document.getElementById("city");
  if (cityEl) cityEl.textContent = `${loc.name}, ${loc.country}  (${loc.localtime})`;

  const tempEl = document.getElementById("temp");
  if (tempEl)
    tempEl.textContent = `Temperature: ${c.temp_c}°C (Feels like ${c.feelslike_c}°C)`;

  const windEl = document.getElementById("wind-v");
  if (windEl)
    windEl.textContent = `Wind: ${c.wind_kph} km/h, ${c.wind_dir} (${c.wind_degree}°)`;

  const humidityEl = document.getElementById("humidity");
  if (humidityEl) humidityEl.textContent = `Humidity: ${c.humidity}%`;

  const descEl = document.getElementById("desc");
  if (descEl) descEl.textContent = `Condition: ${c.condition.text}`;

  const cloudPct = clamp(Number(c.cloud ?? 0), 0, 100);
  const pm25 = Number(c.air_quality?.pm2_5 ?? 0);
  const cloudEl = document.getElementById("cloud");
  if (cloudEl) cloudEl.textContent = `Cloud cover: ${cloudPct}%`;
  const aqiEl = document.getElementById("aqi");
  if (aqiEl) aqiEl.textContent = `PM2.5: ${pm25.toFixed(1)} µg/m³`;

  const windKph = Number(c.wind_kph ?? 0);
  const windDeg = Number(c.wind_degree ?? 0);

  liveWind = { kph: windKph, deg: windDeg };
  currentWind = { ...liveWind };

  // 用真实风速更新基础强度（但不改风带方向）
  windyScene.updateEnvironmentFromRealtime(currentWind);

  return data;
}

// ================= Canvas & mouse ============================
let canvas = null;
let ctx = null;
let mouseX = 0;
let mouseY = 0;

function initCanvasIfNeeded() {
  if (canvas && ctx) return;
  canvas = document.getElementById("cloud-canvas");
  ctx = canvas ? canvas.getContext("2d", { alpha: true }) : null;

  if (!canvas) console.warn("Windy: canvas#cloud-canvas not found.");
  if (!ctx) console.warn("Windy: 2D context could not be obtained.");
}

function resize() {
  initCanvasIfNeeded();
  if (!canvas || !ctx) return;
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (windyScene) windyScene.handleResize();
}

addEventListener("resize", resize, { passive: true });
addEventListener(
  "mousemove",
  (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  },
  { passive: true }
);

addEventListener("DOMContentLoaded", () => {
  resize();
});

try {
  resize();
} catch (e) {}

/* ================= Helpers ================= */
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function invLerp(a, b, v) {
  return clamp((v - a) / (b - a), 0, 1);
}

// ================= Windy visual scene ========================
class WindyScene {
  constructor() {
    this.time = 0;

    this.groundY = 0;
    this.dandelionPos = { x: 80, y: 80 };

    this.grassTufts = [];
    this.dandelionSeeds = [];

    this.initialized = false;

    // 风强度：0~1，控制速度 & 抖动
    this.baseIntensity = 0.4;  // 实时天气给的
    this.intensity = 0.4;      // 实际使用（手动可以覆盖）
    this.spreadFactor = 1.0;   // 粒子“散开程度”，手动等级 2/3/4 会加大

    // 三条「风带」
    this.streams = [];

    // 用来让草和种子随风轻轻摆动
    this.windVX = 1.0;
    this.windVY = 0.3;

    this.blowProgress = 0;
    this.seedTimer = 0;
  }

  handleResize() {
    if (!canvas) return;
    this.initialized = false;
  }

  initGeometry() {
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    this.groundY = h - 70;
    this.dandelionPos = { x: 80, y: this.groundY - 80 };

    // ===== 草丛 =====
    this.grassTufts = [];
    const numTufts = 60;
    const spacing = w / numTufts;
    for (let i = 0; i < numTufts; i++) {
      const x = i * spacing + (Math.random() * 6 - 3);
      const height = lerp(45, 95, Math.random());
      const stiffness = lerp(0.35, 0.85, Math.random());
      this.grassTufts.push({
        baseX: x,
        baseY: this.groundY,
        height,
        stiffness,
        phase: Math.random() * Math.PI * 2
      });
    }

    // ===== 三条短风带：整体比之前下移一点 =====
    this.streams = [];
    const bandDefs = [
      // 左侧一条
      {
        startX: w * 0.05,
        startY: h * 0.18,
        endX:   w * 0.40,
        endY:   h * 0.48
      },
      // 中间一条
      {
        startX: w * 0.35,
        startY: h * 0.14,
        endX:   w * 0.70,
        endY:   h * 0.44
      },
      // 右侧一条
      {
        startX: w * 0.65,
        startY: h * 0.16,
        endX:   w * 0.95,
        endY:   h * 0.46
      }
    ];

    for (let k = 0; k < bandDefs.length; k++) {
      const def = bandDefs[k];
      const fx = def.endX - def.startX;
      const fy = def.endY - def.startY;
      const len = Math.sqrt(fx * fx + fy * fy) || 1;
      const nx = -fy / len;
      const ny = fx / len;

      const particles = [];
      const count = 80; // 每条风带的点数

      for (let i = 0; i < count; i++) {
        // s 越靠近 0 的概率更大 → 上方更密
        const s0 = Math.random() * Math.random();
        particles.push({
          s: s0, // 0~1沿线位置
          speed: lerp(0.0015, 0.0035, Math.random()),
          size: lerp(1.2, 2.4, Math.random()),
          offsetMag: lerp(6, 14, Math.random()), // 垂直飘动幅度
          phase: Math.random() * Math.PI * 2
        });
      }

      this.streams.push({
        startX: def.startX,
        startY: def.startY,
        endX: def.endX,
        endY: def.endY,
        len,
        nx,
        ny,
        particles
      });
    }

    this.initialized = true;
  }

  ensureInitialized() {
    if (!canvas || this.initialized) return;
    this.initGeometry();
  }

  // 实时天气更新基础强度
  updateEnvironmentFromRealtime({ kph, deg }) {
    const t = invLerp(0, 40, kph);
    this.baseIntensity = 0.3 + t * 0.7; // 0.3 ~ 1
    if (!manualOverride) {
      this.intensity = this.baseIntensity;
      this.spreadFactor = 1.0 + this.baseIntensity * 0.4; // 实时风越大越微微散一点
    }

    // 简单给个风向量让草 & 种子轻轻跟着动（不旋转风带）
    const mag = lerp(0.5, 3.0, t);
    const angleRad = ((deg + 180) * Math.PI) / 180;
    this.windVX = Math.cos(angleRad) * mag;
    this.windVY = Math.sin(angleRad) * mag * 0.5;
  }

  // ============ 粒子风带 ============
  stepStreams(dt) {
    const speedFactor = 0.3 + this.intensity * 0.8;
    const wobbleStrength = this.intensity; // 抖动强度

    for (const stream of this.streams) {
      const { particles } = stream;
      for (const p of particles) {
        // s 越大（越靠下）移动越快 → 下方停留时间更短
        const speedScale = 0.7 + 1.2 * p.s;
        p.s += p.speed * speedFactor * speedScale * dt;

        if (p.s > 1.05) {
          // 重新从上方生成，位置集中在 0~0.25 且偏向 0
          p.s = Math.random() * Math.random() * 0.25;
          p.speed = lerp(0.0015, 0.0035, Math.random());
          p.size = lerp(1.2, 2.4, Math.random());
          p.offsetMag = lerp(6, 14, Math.random());
        }

        // 抖动相位
        p.phase += dt * 0.008;  // 更柔和
      }
    }
  }

  drawStreams(ctx) {
    const wobbleStrength = this.intensity;
    ctx.save();

    for (const stream of this.streams) {
      const { startX, startY, endX, endY, nx, ny, particles } = stream;

      for (const p of particles) {
        const s = p.s;
        // 主路径：斜向 + 轻微正弦弯曲
        const baseX = lerp(startX, endX, s);
        const baseY =
          lerp(startY, endY, s) +
          Math.sin(s * 6 + this.time * 1.8) *
            (10 + 18 * wobbleStrength);

        // s 越大（越靠尾部）抖动幅度越大 → 尾部更散
        const tailSpread = 1 + 3.0 * s * s; // 头部 ≈1，尾部≈3
        const jitter =
            Math.sin(this.time * 3.2 + p.phase + s * 10.0) *
            p.offsetMag *
            wobbleStrength *
            this.spreadFactor *
            tailSpread;


        const x = baseX + nx * jitter;
        const y = baseY + ny * jitter;

        // 开头和结尾淡入淡出：上出现、下消失
        let alpha = 0.9;
        alpha *= clamp(s / 0.15, 0, 1);          // 0~0.15 淡入
        alpha *= clamp((1.05 - s) / 0.25, 0, 1); // 0.8~1.05 淡出
        // 更透明一些，和背景融合
        alpha *= 0.45 + wobbleStrength * 0.35;

        ctx.beginPath();
        ctx.fillStyle = `rgba(168,216,255,${alpha.toFixed(3)})`;
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // ============ 草 ============
  stepGrass() {}

  drawGrass(ctx) {
    if (!canvas) return;
    const w = canvas.clientWidth;

    ctx.save();

    // 地面线
    ctx.strokeStyle = "rgba(100, 150, 110, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, this.groundY + 2);
    ctx.lineTo(w, this.groundY + 2);
    ctx.stroke();

    const time = this.time;

    for (const t of this.grassTufts) {
      const swayWind = this.windVX * (1.6 - t.stiffness);
      const localSway = swayWind + Math.sin(time * 2.0 + t.phase) * 2.5;

      const blades = 4 + Math.floor(Math.random() * 2);
      for (let i = 0; i < blades; i++) {
        const offset = (i - (blades - 1) / 2) * 2.5;
        const heightFactor = 0.8 + (i / blades) * 0.4;
        const hBlade = t.height * heightFactor;

        const baseX = t.baseX + offset;
        const baseY = t.baseY;

        const tipX = baseX + localSway * 1.1 + offset * 0.4;
        const tipY = baseY - hBlade;

        ctx.strokeStyle = "rgba(140, 210, 135, 0.95)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);

        const cp1X = baseX + localSway * 0.3;
        const cp1Y = baseY - hBlade * 0.4;
        const cp2X = tipX;
        const cp2Y = baseY - hBlade * 0.7;

        ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, tipX, tipY);
        ctx.stroke();
      }

      // 草根附近的小点点
      ctx.fillStyle = "rgba(125, 190, 130, 0.45)";
      for (let i = 0; i < 6; i++) {
        const px = t.baseX + (Math.random() * 16 - 8);
        const py = this.groundY + (Math.random() * 10 - 4);
        ctx.beginPath();
        ctx.arc(px, py, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // ============ 蒲公英种子 ============
  blowSeeds() {
    if (!canvas) return;
    const num = 3;
    for (let i = 0; i < num; i++) {
      const baseAngle = -Math.PI / 3 + Math.random() * (Math.PI / 2); // 略向右上
      const baseMag = lerp(0.6, 1.6, Math.random()); // 温柔一点

      let vx = Math.cos(baseAngle) * baseMag + this.windVX * 0.35;
      let vy = Math.sin(baseAngle) * baseMag + this.windVY * 0.25;

      this.dandelionSeeds.push({
        x: this.dandelionPos.x + (Math.random() * 10 - 5),
        y: this.dandelionPos.y + (Math.random() * 10 - 5),
        vx,
        vy,
        life: 0,
        maxLife: 260 + Math.random() * 200
      });
    }
  }

  stepSeeds(dt) {
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    for (let i = this.dandelionSeeds.length - 1; i >= 0; i--) {
      const s = this.dandelionSeeds[i];
      s.life += dt;

      s.vx += this.windVX * 0.004;
      s.vy += this.windVY * 0.004;

      s.x += s.vx * 0.9;
      s.y += s.vy * 0.9;

      if (
        s.life > s.maxLife ||
        s.x < -40 ||
        s.x > w + 40 ||
        s.y < -40 ||
        s.y > h + 40
      ) {
        this.dandelionSeeds.splice(i, 1);
      }
    }
  }

  drawSeeds(ctx) {
    ctx.save();
    ctx.strokeStyle = "rgba(240, 240, 240, 0.9)";
    ctx.lineWidth = 1;
    for (const s of this.dandelionSeeds) {
      const len = Math.sqrt(s.vx * s.vx + s.vy * s.vy) || 1;
      const dx = (s.vx / len) * 7;
      const dy = (s.vy / len) * 7;

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + dx, s.y + dy);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(s.x + dx, s.y + dy, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(240,240,240,0.95)";
      ctx.fill();
    }
    ctx.restore();
  }

  drawDandelion(ctx, dt) {
    const hoverDist = 70;
    const dx = mouseX - this.dandelionPos.x;
    const dy = mouseY - this.dandelionPos.y;
    const hovered = Math.sqrt(dx * dx + dy * dy) < hoverDist;

    const speed = 0.04;
    if (hovered) {
      this.blowProgress = Math.min(1, this.blowProgress + speed * dt);
      this.seedTimer += dt;
      if (this.seedTimer > 10) {
        this.blowSeeds();
        this.seedTimer = 0;
      }
    } else {
      this.blowProgress = Math.max(0, this.blowProgress - speed * dt);
      this.seedTimer = 0;
    }

    ctx.save();

    // 茎
    ctx.strokeStyle = "rgba(150, 210, 155, 1)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.dandelionPos.x, this.dandelionPos.y);
    ctx.lineTo(this.dandelionPos.x, this.dandelionPos.y + 60);
    ctx.stroke();

    // 花心
    const baseR = 18;
    const r = baseR * (1 - 0.1 * this.blowProgress);
    ctx.fillStyle = "rgba(255, 255, 255, 1)";
    ctx.beginPath();
    ctx.arc(this.dandelionPos.x, this.dandelionPos.y, r, 0, Math.PI * 2);
    ctx.fill();

    // 光晕
    if (hovered || this.blowProgress > 0) {
      ctx.beginPath();
      ctx.arc(
        this.dandelionPos.x,
        this.dandelionPos.y,
        r + 10 + this.blowProgress * 4,
        0,
        Math.PI * 2
      );
      ctx.strokeStyle = `rgba(150,190,255,${
        0.3 + this.blowProgress * 0.4
      })`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 籽：根据 blowProgress 掉一圈
    ctx.strokeStyle = "rgba(220, 220, 220, 0.9)";
    ctx.lineWidth = 1;
    const totalRays = 28;
    const remainRatio = 1 - this.blowProgress * 0.75;
    const raysToDraw = Math.max(4, Math.round(totalRays * remainRatio));

    for (let i = 0; i < raysToDraw; i++) {
      const a = (Math.PI * 2 * i) / totalRays;
      const len = 20;
      const x2 = this.dandelionPos.x + Math.cos(a) * len;
      const y2 = this.dandelionPos.y + Math.sin(a) * len;

      ctx.beginPath();
      ctx.moveTo(this.dandelionPos.x, this.dandelionPos.y);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x2 + 3, y2, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(240,240,240,0.95)";
      ctx.fill();
    }

    ctx.restore();
  }

  // ============ 主绘制循环 ============
  stepAndDraw(ctx) {
    this.ensureInitialized();
    if (!canvas || !ctx) return;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    this.time += 0.015;
    const dt = 1;

    // 背景：黑色轻渐变
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#05070a");
    bg.addColorStop(1, "#050910");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    this.stepStreams(dt);
    this.stepGrass(dt);
    this.stepSeeds(dt);

    // 顺序：风带粒子 → 草 → 蒲公英
    this.drawStreams(ctx);
    this.drawGrass(ctx);
    this.drawDandelion(ctx, dt);
    this.drawSeeds(ctx);
  }
}

const windyScene = new WindyScene();

// ================= Animation loop ============================
let rafId = null;
function loop() {
  if (ctx) windyScene.stepAndDraw(ctx);
  rafId = requestAnimationFrame(loop);
}
loop();

// ================= Weather polling ===========================
getRealtimeWeather();
setInterval(getRealtimeWeather, 5 * 60 * 1000);

// ================= Keyboard controls =========================
const modeLabelEl = document.getElementById("mode-label");

function updateModeLabel() {
  if (!modeLabelEl) return;
  if (manualOverride) {
    modeLabelEl.textContent = `MANUAL (level ${manualLevel})`;
  } else {
    modeLabelEl.textContent = "LIVE WEATHER";
  }
}

function setManualWindLevel(level) {
  manualOverride = true;
  manualLevel = level;

  // 1234 只控制风的强度 + 散开程度，不改方向
  switch (level) {
    case 1:
      windyScene.intensity = 0.25;
      windyScene.spreadFactor = 1.0;
      break;
    case 2:
      windyScene.intensity = 0.45;
      windyScene.spreadFactor = 1.4; // 更散
      break;
    case 3:
      windyScene.intensity = 0.70;
      windyScene.spreadFactor = 1.8; // 更更散
      break;
    case 4:
      windyScene.intensity = 1.0;
      windyScene.spreadFactor = 2.2; // 最散
      break;
  }

  updateModeLabel();

  const windEl = document.getElementById("wind-v");
  if (windEl) {
    windEl.textContent = `Wind (manual level ${level})`;
  }
}

window.addEventListener("keydown", (e) => {
  if (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") {
    setManualWindLevel(Number(e.key));
  } else if (e.key === "0") {
    // 回到实时强度
    manualOverride = false;
    windyScene.intensity = windyScene.baseIntensity;
    windyScene.spreadFactor = 1.0 + windyScene.baseIntensity * 0.4;
    updateModeLabel();

    const windEl = document.getElementById("wind-v");
    if (windEl) {
      windEl.textContent = `Wind: ${liveWind.kph.toFixed(
        1
      )} km/h, ${liveWind.deg.toFixed(0)}°`;
    }
  }
});
updateModeLabel();
