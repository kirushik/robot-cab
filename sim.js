// The simulator: a pretend robot on a schematic floor plan, drawn like a signal-box diagram.
// Same API and events as BleRobot (robot.js). The wheels are decided by the firmware's own Rust
// supervisor compiled to WebAssembly (robot_core.wasm, built by `core-wasm`): 500 ms command
// expiry and the obstacle guard behave exactly like on the robot. A JavaScript copy of those
// rules takes over only if the .wasm file can't load.
//
// The floor is editable in edit mode (`editing = true`): drag a block to move it, tap empty
// floor to add one, hold a block to remove it. The layout is remembered on this phone.

const ROOM = { w: 300, h: 200 }; // centimetres
const DEFAULT_BLOCKS = [
  { x: 125, y: 25, w: 50, h: 20 },
  { x: 30, y: 70, w: 25, h: 45 },
  { x: 225, y: 90, w: 45, h: 25 },
];
const RADIUS = 9; // robot is ~18 cm across
const WHEELBASE = 14; // cm between wheels
const CM_PER_S_AT_100 = 45;
const SENSOR_RANGE = 350;
const EXPIRY_MS = 500;
const SAMPLE_MS = 70; // the real ranger is triggered every ~70 ms
const STORE = "robot-cab-room";

async function loadRustSupervisor() {
  try {
    const { instance } = await WebAssembly.instantiateStreaming(fetch(new URL("robot_core.wasm", import.meta.url)));
    return instance.exports;
  } catch {
    return null;
  }
}
const ms = (t) => BigInt(Math.max(0, Math.floor(t)));
const i8 = (v) => (v << 24) >> 24;

export class SimRobot extends EventTarget {
  kind = "sim";
  state = "disconnected";
  name = "SIM";
  pose = { x: 150, y: 170, heading: -Math.PI / 2 }; // facing up the screen; y grows downwards
  odometer = 0; // cm travelled
  speed = 0; // cm/s, signed
  usingRust = false;
  editing = false;
  preview = null; // { points: [[x, y], ...], color } — where a program would go
  blocks = loadBlocks();
  #cmd = [0, 0];
  #cmdAt = 0;
  #guardCm = 0;
  #blocked = false;
  #colors = Array(10).fill([0, 0, 0]);
  #canvas = null;
  #raf = null;
  #last = 0;
  #distanceTimer = null;
  #audio = null;
  #bumped = 0;
  #rust = null;
  #sampleAt = -Infinity;
  #lastValidAt = -1;
  #trail = [];
  #view = { s: 1, ox: 0, oy: 0 };
  #drag = null;
  #lastCm = null; // the reading last reported to the app, so the map shows the same number

  attach(canvas) {
    this.#canvas = canvas;
    canvas.addEventListener("pointerdown", (e) => this.#pointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.#pointerMove(e));
    canvas.addEventListener("pointerup", (e) => this.#pointerUp(e));
    canvas.addEventListener("pointercancel", () => (this.#drag = null));
    new ResizeObserver(() => this.#draw()).observe(canvas);
  }

  async connect() {
    if (this.state === "connected") return; // one physics loop, never two
    this.#rust ??= await loadRustSupervisor();
    this.usingRust = !!this.#rust;
    this.#rust?.set_guard(this.#guardCm);
    this.state = "connected";
    this.#emit("state", { state: "connected", name: this.name });
    this.#emit("driver", { ok: true });
    this.#last = performance.now();
    const tick = (t) => {
      // Fixed 10 ms physics steps, so a slow or throttled screen doesn't slow the robot down.
      const elapsed = Math.min(0.5, (t - this.#last) / 1000);
      for (let done = 0; done < elapsed; done += 0.01) this.#step(Math.min(0.01, elapsed - done), t);
      this.#last = t;
      this.#draw();
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
    this.#distanceTimer = setInterval(() => {
      this.#lastCm = this.distance();
      this.#emit("distance", { cm: this.#lastCm });
    }, 100);
  }

  async disconnect() {
    cancelAnimationFrame(this.#raf);
    clearInterval(this.#distanceTimer);
    this.#cmd = [0, 0];
    this.speed = 0;
    this.state = "disconnected";
    this.#emit("state", { state: "disconnected", name: this.name });
  }

  drive(left, right) {
    this.#cmd = [left, right];
    this.#cmdAt = performance.now();
    this.#rust?.set_command(ms(this.#cmdAt), Math.round(left), Math.round(right));
  }

  async lights(colors) {
    this.#colors = colors === "off" ? Array(10).fill([0, 0, 0]) : [...colors, ...Array(10).fill([0, 0, 0])].slice(0, 10);
  }

  async tone(hz, duration) {
    try {
      this.#audio ??= new AudioContext();
      const osc = this.#audio.createOscillator();
      const gain = this.#audio.createGain();
      osc.type = "triangle";
      osc.frequency.value = hz;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(this.#audio.destination);
      const now = this.#audio.currentTime;
      gain.gain.setTargetAtTime(0, now + duration / 1000 - 0.03, 0.01);
      osc.start(now);
      osc.stop(now + duration / 1000);
    } catch {
      // no audio: fine
    }
  }

  async guard(cm) {
    this.#guardCm = cm;
    this.#rust?.set_guard(cm);
    return true;
  }

  async command(text) {
    if (text === "dist") {
      const cm = this.distance();
      return cm === null ? "dist none" : `dist ${cm}`;
    }
    return "ok";
  }

  resetRoom() {
    this.blocks = DEFAULT_BLOCKS.map((b) => ({ ...b }));
    this.pose = { x: 150, y: 170, heading: -Math.PI / 2 };
    this.#trail = [];
    this.odometer = 0;
    saveBlocks(this.blocks);
  }

  /// Where wheel commands [[left, right, ms], ...] would take the robot from where it is now.
  predict(segments) {
    let { x, y, heading } = this.pose;
    const points = [[x, y]];
    for (const [l, r, ms] of segments) {
      const v = ((l + r) / 2 / 100) * CM_PER_S_AT_100;
      const w = ((r - l) / 100) * CM_PER_S_AT_100 / WHEELBASE;
      for (let t = 0; t < ms; t += 20) {
        heading -= w * 0.02;
        x += Math.cos(heading) * v * 0.02;
        y += Math.sin(heading) * v * 0.02;
        if (t % 100 === 0) points.push([x, y]);
      }
      points.push([x, y]);
    }
    return points;
  }

  /// Distance straight ahead in cm, like the ultrasonic sensor (narrow cone), or null.
  distance() {
    let best = Infinity;
    for (const spread of [-0.12, 0, 0.12]) best = Math.min(best, this.#ray(this.pose.heading + spread));
    const cm = best - RADIUS;
    return cm > SENSOR_RANGE ? null : Math.max(0, Math.round(cm));
  }

  // ---- physics ----------------------------------------------------------------------

  #step(dt, now) {
    const [l, r] = this.#rust ? this.#decideRust(now) : this.#decideJs(now);
    const v = ((l + r) / 2 / 100) * CM_PER_S_AT_100;
    const w = ((r - l) / 100) * CM_PER_S_AT_100 / WHEELBASE;
    const p = this.pose;
    const heading = p.heading - w * dt; // screen y points down, so turning left is negative
    const x = p.x + Math.cos(heading) * v * dt;
    const y = p.y + Math.sin(heading) * v * dt;
    p.heading = heading;
    if (this.#free(x, y)) {
      this.odometer += Math.hypot(x - p.x, y - p.y);
      p.x = x;
      p.y = y;
      this.speed = v;
      const lastPoint = this.#trail[this.#trail.length - 1];
      if (!lastPoint || Math.hypot(lastPoint[0] - x, lastPoint[1] - y) > 2) {
        this.#trail.push([x, y]);
        if (this.#trail.length > 600) this.#trail.shift();
      }
    } else {
      this.speed = 0;
      if (v !== 0 && now - this.#bumped > 800) {
        this.#bumped = now;
        this.#emit("bump", {});
      }
    }
  }

  #decideRust(now) {
    if (now - this.#sampleAt >= SAMPLE_MS) {
      this.#sampleAt = now;
      const cm = this.distance();
      if (cm !== null) this.#lastValidAt = now;
      this.#rust.set_sample(ms(now), cm ?? -1, this.#lastValidAt < 0 ? -1n : ms(this.#lastValidAt));
    }
    const out = this.#rust.evaluate(ms(now));
    const event = (out >> 16) & 3;
    if (event) this.#emit("guard", { blocked: event === 1, cm: this.distance(), limit: this.#guardCm });
    return [i8(out & 0xff), i8((out >> 8) & 0xff)];
  }

  #decideJs(now) {
    let [l, r] = now - this.#cmdAt > EXPIRY_MS ? [0, 0] : this.#cmd;
    const forward = (l + r) / 2;
    const cm = this.distance();
    const blocked = this.#guardCm > 0 && forward > 0 && cm !== null && cm < this.#guardCm;
    if (blocked) { l -= forward; r -= forward; }
    if (blocked !== this.#blocked) {
      this.#blocked = blocked;
      this.#emit("guard", { blocked, cm, limit: this.#guardCm });
    }
    return [l, r];
  }

  #free(x, y) {
    if (x < RADIUS || y < RADIUS || x > ROOM.w - RADIUS || y > ROOM.h - RADIUS) return false;
    return this.blocks.every((b) => {
      const cx = Math.max(b.x, Math.min(x, b.x + b.w));
      const cy = Math.max(b.y, Math.min(y, b.y + b.h));
      return Math.hypot(x - cx, y - cy) > RADIUS;
    });
  }

  #ray(angle) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    for (let d = 0; d < SENSOR_RANGE + RADIUS; d += 1) {
      const x = this.pose.x + dx * d, y = this.pose.y + dy * d;
      if (x < 0 || y < 0 || x > ROOM.w || y > ROOM.h) return d;
      if (this.blocks.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)) return d;
    }
    return Infinity;
  }

  // ---- editing the floor ------------------------------------------------------------

  #toRoom(e) {
    const rect = this.#canvas.getBoundingClientRect();
    const dpr = this.#canvas.width / rect.width;
    const { s, ox, oy } = this.#view;
    return { x: ((e.clientX - rect.left) * dpr - ox) / s, y: ((e.clientY - rect.top) * dpr - oy) / s };
  }

  #pointerDown(e) {
    if (!this.editing) return;
    const p = this.#toRoom(e);
    const block = this.blocks.find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    this.#canvas.setPointerCapture(e.pointerId);
    this.#drag = { block, start: p, from: block ? { x: block.x, y: block.y } : null, moved: false };
    if (block) {
      this.#drag.hold = setTimeout(() => {
        if (this.#drag && !this.#drag.moved) {
          this.blocks = this.blocks.filter((b) => b !== block);
          saveBlocks(this.blocks);
          this.#drag = null;
        }
      }, 650);
    }
  }

  #pointerMove(e) {
    const d = this.#drag;
    if (!d?.block) return;
    const p = this.#toRoom(e);
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (Math.hypot(dx, dy) > 3) d.moved = true;
    d.block.x = clamp(Math.round((d.from.x + dx) / 5) * 5, 0, ROOM.w - d.block.w);
    d.block.y = clamp(Math.round((d.from.y + dy) / 5) * 5, 0, ROOM.h - d.block.h);
  }

  #pointerUp(e) {
    const d = this.#drag;
    this.#drag = null;
    if (!d) return;
    clearTimeout(d.hold);
    if (d.block) {
      if (!this.#free(this.pose.x, this.pose.y)) Object.assign(d.block, d.from); // not on the robot
      saveBlocks(this.blocks);
      return;
    }
    const p = this.#toRoom(e);
    if (this.blocks.length < 10 && p.x >= 0 && p.y >= 0 && p.x <= ROOM.w && p.y <= ROOM.h) {
      const b = { x: clamp(Math.round((p.x - 10) / 5) * 5, 0, ROOM.w - 20), y: clamp(Math.round((p.y - 10) / 5) * 5, 0, ROOM.h - 20), w: 20, h: 20 };
      this.blocks.push(b);
      if (!this.#free(this.pose.x, this.pose.y)) this.blocks.pop();
      saveBlocks(this.blocks);
    }
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // ---- drawing: a signal-box style floor plan ----------------------------------------

  #draw() {
    const canvas = this.#canvas;
    if (!canvas || !canvas.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const css = getComputedStyle(canvas);
    const color = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const C = {
      screen: color("--screen", "#0e1418"), grid: color("--grid", "#1d2a30"), major: color("--grid-major", "#2a3c44"),
      label: color("--dim", "#7d8a94"), block: color("--block", "#3a4650"), trail: color("--trail", "#4a90d9"),
      green: color("--sig-green", "#3fbf6f"), yellow: color("--sig-yellow", "#f2b134"), red: color("--sig-red", "#e5484d"),
      body: color("--loco", "#f2b134"),
    };
    const ctx = canvas.getContext("2d");
    const pad = 22 * dpr; // room for axis labels
    const s = Math.min((canvas.width - pad * 1.5) / ROOM.w, (canvas.height - pad * 1.5) / ROOM.h);
    const ox = pad + (canvas.width - pad * 1.5 - ROOM.w * s) / 2;
    const oy = pad * 0.5 + (canvas.height - pad * 1.5 - ROOM.h * s) / 2;
    this.#view = { s, ox, oy };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.screen;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // grid: 10 cm, with 50 cm lines and labels in cm along the edges
    ctx.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
    ctx.textBaseline = "middle";
    for (let x = 0; x <= ROOM.w; x += 10) {
      ctx.strokeStyle = x % 50 ? C.grid : C.major;
      ctx.lineWidth = x % 50 ? 1 : 1.5;
      ctx.beginPath(); ctx.moveTo(ox + x * s, oy); ctx.lineTo(ox + x * s, oy + ROOM.h * s); ctx.stroke();
      if (x % 50 === 0) { ctx.fillStyle = C.label; ctx.textAlign = "center"; ctx.fillText(String(x), ox + x * s, oy + ROOM.h * s + pad * 0.5); }
    }
    for (let y = 0; y <= ROOM.h; y += 10) {
      ctx.strokeStyle = y % 50 ? C.grid : C.major;
      ctx.lineWidth = y % 50 ? 1 : 1.5;
      ctx.beginPath(); ctx.moveTo(ox, oy + y * s); ctx.lineTo(ox + ROOM.w * s, oy + y * s); ctx.stroke();
      if (y % 50 === 0) { ctx.fillStyle = C.label; ctx.textAlign = "right"; ctx.fillText(String(y), ox - 6 * dpr, oy + y * s); }
    }

    ctx.setTransform(s, 0, 0, s, ox, oy);

    // blocks: hatched obstacles
    for (const b of this.blocks) {
      ctx.fillStyle = C.block;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.save();
      ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
      ctx.strokeStyle = C.screen; ctx.lineWidth = 1.2;
      for (let k = -b.h; k < b.w; k += 6) { ctx.beginPath(); ctx.moveTo(b.x + k, b.y + b.h); ctx.lineTo(b.x + k + b.h, b.y); ctx.stroke(); }
      ctx.restore();
      ctx.strokeStyle = C.label; ctx.lineWidth = 0.8; ctx.strokeRect(b.x, b.y, b.w, b.h);
    }

    if (this.editing) {
      ctx.strokeStyle = C.yellow; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.strokeRect(1, 1, ROOM.w - 2, ROOM.h - 2); ctx.setLineDash([]);
    }

    // where the shown program would go
    if (this.preview?.points.length > 1) {
      ctx.strokeStyle = this.preview.color; ctx.lineWidth = 3; ctx.globalAlpha = 0.55; ctx.lineCap = "round";
      ctx.beginPath();
      this.preview.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke(); ctx.globalAlpha = 1;
      const [ex, ey] = this.preview.points[this.preview.points.length - 1];
      ctx.fillStyle = this.preview.color; ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.fill();
    }

    // the route driven so far
    if (this.#trail.length > 1) {
      ctx.strokeStyle = C.trail; ctx.lineWidth = 1.6; ctx.setLineDash([4, 3]);
      ctx.beginPath();
      this.#trail.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke(); ctx.setLineDash([]);
    }

    // sensor beam, coloured like a signal aspect
    const p = this.pose;
    const cm = this.#lastCm;
    const beamColor = cm === null ? C.label :cm < Math.max(this.#guardCm, 1) ? C.red : cm < this.#guardCm + 30 ? C.yellow : C.green;
    const reach = (cm ?? 120) + RADIUS;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.heading);
    ctx.strokeStyle = beamColor; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(RADIUS, 0); ctx.lineTo(reach, 0); ctx.stroke(); ctx.setLineDash([]);
    if (cm !== null) { ctx.beginPath(); ctx.moveTo(reach, -5); ctx.lineTo(reach, 5); ctx.lineWidth = 2; ctx.stroke(); }
    // the protection limits on the beam: red = it stops here, yellow = slow from here
    if (this.#guardCm > 0) {
      for (const [d, c] of [[this.#guardCm, C.red], [this.#guardCm + 30, C.yellow]]) {
        ctx.strokeStyle = c; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(RADIUS + d, -4); ctx.lineTo(RADIUS + d, 4); ctx.stroke();
      }
    }

    // the robot: a locomotive-style marker, pointed at the front, with its 10 lamps across the
    // back, lamp 1 on the robot's left (check this against the real strip's wiring!)
    ctx.fillStyle = C.body;
    ctx.beginPath();
    ctx.moveTo(-RADIUS, -RADIUS + 2); ctx.lineTo(RADIUS - 4, -RADIUS + 2); ctx.lineTo(RADIUS + 3, 0);
    ctx.lineTo(RADIUS - 4, RADIUS - 2); ctx.lineTo(-RADIUS, RADIUS - 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.screen;
    ctx.fillRect(-7, -RADIUS - 1, 10, 3); ctx.fillRect(-7, RADIUS - 2, 10, 3); // wheels
    this.#colors.forEach((c, i) => {
      ctx.fillStyle = c.some((v) => v > 0) ? `rgb(${c.join(",")})` : C.screen;
      ctx.fillRect(-RADIUS + 0.5, -RADIUS + 3 + i * 1.25, 2.2, 1.05);
    });
    ctx.restore();

    // the reading at the end of the beam, in cm
    if (cm !== null) {
      const lx = p.x + Math.cos(p.heading) * (reach + 8), ly = p.y + Math.sin(p.heading) * (reach + 8);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = beamColor; ctx.textAlign = "center";
      ctx.font = `600 ${11 * dpr}px "IBM Plex Mono", monospace`;
      ctx.fillText(String(cm), ox + lx * s, oy + ly * s);
    }
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function loadBlocks() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (Array.isArray(saved)) return saved;
  } catch { /* fresh room */ }
  return DEFAULT_BLOCKS.map((b) => ({ ...b }));
}

function saveBlocks(blocks) {
  try { localStorage.setItem(STORE, JSON.stringify(blocks)); } catch { /* fine */ }
}
