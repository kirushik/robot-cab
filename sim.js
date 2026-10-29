// The simulator: a pretend robot on a schematic floor plan, drawn like a signal-box diagram.
// Same API and events as BleRobot (robot.js). The wheels are decided by the firmware's own Rust
// supervisor compiled to WebAssembly (robot_core.wasm, built by `core-wasm`): 500 ms command
// expiry and the obstacle guard behave exactly like on the robot. A JavaScript copy of those
// rules takes over only if the .wasm file can't load.
//
// Worlds: "ideal" (the default) has perfect echoes and motors. "messy" is the real robot as the
// roleplay found it: the ranger misses echoes (more often far away and on soft things like a
// sofa) and jitters by a centimetre or two; the motors don't turn below a start power, and less
// on the rug; it drifts a little to the left; it has no wheel encoders and no bump sensor; and the
// servo barrier hits a roof slope that comes off after it has pushed for about 1.5 s. Every echo,
// missing or not, goes through the Rust supervisor, so a 500 ms gap stops the robot exactly as the
// firmware does, and the cab hears it as the same `! guard ...` line. Randomness comes from a
// seed, so a run can be replayed.
//
// What the cab must not see: the floor plan is the room, drawn for the person holding the phone.
// The robot object only reports what the real robot would (distance samples, guard lines, motor
// driver, and a servo current only if a current sensor is fitted). Ground truth for tests is in
// `truth`, and things that happen in the room (a buzzing servo, a roof falling off) are "world"
// events, which the cab never listens to.
//
// The floor is editable in edit mode (`editing = true`): drag a block to move it, tap empty
// floor to add one, tap a block to make it soft or hard again, hold a block to remove it. The
// layout is remembered on this phone.

import { parseEvent } from "./robot.js";

const FIRMWARE = "robot-firmware 0.2.0 sim"; // the supervisor it runs is the firmware's own

const ROOM = { w: 300, h: 200 }; // centimetres
const DEFAULT_BLOCKS = [
  { x: 125, y: 25, w: 50, h: 20, soft: true }, // the sofa
  { x: 30, y: 70, w: 25, h: 45 },
  { x: 225, y: 90, w: 45, h: 25 },
];
const DEFAULT_ZONES = [{ x: 95, y: 100, w: 110, h: 90, kind: "rug" }];
const RADIUS = 9; // robot is ~18 cm across
const WHEELBASE = 14; // cm between wheels
const CM_PER_S_AT_100 = 45;
const SENSOR_RANGE = 350;
const EXPIRY_MS = 500;
const SAMPLE_MS = 70; // the real ranger is triggered every ~70 ms
const STREAM_MS = 100; // the app subscribes with `sub dist 100`
const SERVO_DEG_PER_S = 400;
const STORE = "robot-cab-room";
const WORLD_STORE = "robot-cab-world";

// Physics presets. `ideal` keeps the simulator as it always was; `messy` is the real robot.
export const WORLDS = {
  ideal: {
    echo: { miss: 0, missFrom: 30, missPerCm: 0, soft: 0, burst: 0, jitter: 0 },
    motors: { start: { floor: 0, rug: 0 }, rug: 1, drift: 0 },
    odometry: true, // the pretend robot knows how far it went, as if it had wheel encoders
    bump: true, // and feels a collision
    servo: { endStopDeg: null, roof: false, roofHoldMs: 1500, currentSensor: false },
    ranger: "fitted",
    i2c: ["0f", "73"], // what a `scan` finds: the motor driver and the gesture sensor
  },
  messy: {
    // One echo in fifteen lost up close, more with distance and on soft targets; a miss makes the
    // next one likelier (a soft or slanted target keeps swallowing them).
    echo: { miss: 1 / 15, missFrom: 30, missPerCm: 0.0025, soft: 0.25, burst: 0.6, jitter: 1.5 },
    // Wheel power below `start` doesn't turn the wheel (it hums); the rug costs a quarter of the
    // speed; the left wheel is 3 % weaker, so it drifts left.
    motors: { start: { floor: 10, rug: 20 }, rug: 0.75, drift: 0.03 },
    odometry: false,
    bump: false,
    servo: { endStopDeg: 70, roof: true, roofHoldMs: 1500, currentSensor: false },
    ranger: "fitted", // "silent": unplugged, or nothing but open space ahead
    i2c: ["0f", "73"],
  },
};

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

// A small seeded random number generator (mulberry32), so a messy run can be replayed.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function merge(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" ? merge(out[k], v) : v;
  }
  return out;
}

export class SimRobot extends EventTarget {
  kind = "sim";
  state = "disconnected";
  name = "SIM";
  pose = { x: 150, y: 170, heading: -Math.PI / 2 }; // facing up the screen; y grows downwards
  odometer = 0; // cm travelled (ground truth)
  speed = 0; // cm/s, signed (ground truth)
  usingRust = false;
  firmware = { name: "robot-firmware", version: [0, 2, 0], board: "sim" };
  editing = false;
  preview = null; // { points: [[x, y], ...], color } — where a program would go
  blocks = [];
  zones = [];
  world = WORLDS.ideal;
  worldName = "ideal";
  seed = 1;
  /// What really happens, for tests and for drawing the room. The cab never reads this.
  truth = { stalled: false, servoDeg: 0, servoStalled: false, roofOn: false, lastSample: null };
  #rand = random(1);
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
  #hum = null;
  #bumped = 0;
  #rust = null;
  #sampleAt = -Infinity;
  #lastValidAt = -1;
  #missed = false;
  #trail = [];
  #view = { s: 1, ox: 0, oy: 0 };
  #drag = null;
  #lastCm = null; // the reading last reported to the app, so the map shows the same number
  #servo = { cmd: null, stallMs: 0, endStop: null, currentAt: 0 };

  constructor() {
    super();
    const room = loadRoom();
    this.blocks = room.blocks;
    this.zones = room.zones;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(WORLD_STORE) || "null"); } catch { /* ideal */ }
    this.setWorld(saved ?? "ideal", { remember: false });
  }

  /// Choose the physics: "ideal", "messy", or { preset, seed, ...overrides } (deep-merged).
  setWorld(choice = "ideal", { remember = true } = {}) {
    const c = typeof choice === "string" ? { preset: choice } : choice;
    const preset = WORLDS[c.preset] ? c.preset : "ideal";
    const { preset: _p, seed = 1, ...over } = c;
    this.worldName = preset;
    this.world = merge(WORLDS[preset], over);
    this.seed = seed;
    this.#rand = random(seed);
    this.#missed = false;
    this.#servo.endStop = this.world.servo.endStopDeg;
    this.truth.roofOn = !!this.world.servo.roof;
    if (remember) {
      try { localStorage.setItem(WORLD_STORE, JSON.stringify(preset)); } catch { /* fine */ }
    }
  }

  /// Does this robot know how far it went? (Wheel encoders: the real one has none yet.)
  get odometry() {
    return this.world.odometry;
  }

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
      for (let done = 0; done < elapsed; done += 0.01) this.#step(Math.min(0.01, elapsed - done), Math.min(t, this.#last + (done + 0.01) * 1000));
      this.#last = t;
      this.#draw();
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
    // Like `sub dist 100`: the latest finished sample, every 100 ms.
    this.#distanceTimer = setInterval(() => {
      const sample = this.truth.lastSample;
      this.#lastCm = sample ? sample.cm : null;
      this.#emit("distance", { cm: this.#lastCm });
      if (this.world.servo.currentSensor) this.#emit("current", { ma: this.#servoCurrent() });
    }, STREAM_MS);
  }

  async disconnect() {
    cancelAnimationFrame(this.#raf);
    clearInterval(this.#distanceTimer);
    this.#cmd = [0, 0];
    this.speed = 0;
    this.#humOff();
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

  /// Point the servo to `deg` (0..90). A hobby servo says nothing back: no position, no load.
  async servo(deg) {
    this.#servo.cmd = Math.max(0, Math.min(90, Number(deg) || 0));
    return true;
  }

  async command(text) {
    if (text === "dist") {
      const cm = this.truth.lastSample?.cm ?? null;
      return cm === null ? "dist none" : `dist ${cm}`;
    }
    if (text === "scan") return `scan ${this.world.i2c.join(" ")}`;
    if (text === "ver") return `ver ${FIRMWARE}`;
    return "ok";
  }

  resetRoom() {
    this.blocks = DEFAULT_BLOCKS.map((b) => ({ ...b }));
    this.zones = DEFAULT_ZONES.map((z) => ({ ...z }));
    this.pose = { x: 150, y: 170, heading: -Math.PI / 2 };
    this.#trail = [];
    this.odometer = 0;
    this.#servo = { cmd: null, stallMs: 0, endStop: this.world.servo.endStopDeg, currentAt: 0 };
    this.truth.servoDeg = 0;
    this.truth.roofOn = !!this.world.servo.roof;
    saveRoom(this);
  }

  /// Where wheel commands [[left, right, ms], ...] would take the robot from where it is now
  /// (on an ideal floor: it's a plan, not a measurement).
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

  /// The gesture sensor's twin: the face's touch pad stands in for his hand. `input` is
  /// { gesture: "up" | … } or { x, y, brightness, size } (0..1, 0..1, raw 0–255, raw), like the
  /// PAJ7620U2 reports them. Only while a sensor sits at 0x73.
  gesture(input) {
    if (this.state !== "connected" || !this.world.i2c.includes("73")) return false;
    this.#emit("gesture", { ...input });
    return true;
  }

  /// The true distance straight ahead in cm (narrow cone, like the ultrasonic sensor), or null.
  distance() {
    return this.#target().cm;
  }

  // ---- the ranger ---------------------------------------------------------------------

  #target() {
    let best = { d: Infinity, soft: false };
    for (const spread of [-0.12, 0, 0.12]) {
      const hit = this.#ray(this.pose.heading + spread);
      if (hit.d < best.d) best = hit;
    }
    const cm = best.d - RADIUS;
    return { cm: cm > SENSOR_RANGE ? null : Math.max(0, Math.round(cm)), soft: best.soft };
  }

  // One measurement, as the ranger on the robot makes it: maybe no echo, maybe a little off.
  #measure() {
    if (this.world.ranger === "silent") return null;
    const { cm, soft } = this.#target();
    if (cm === null) return null;
    const e = this.world.echo;
    // A soft target swallows the echo more the farther it is (up close it still answers).
    let p = e.miss + e.missPerCm * Math.max(0, cm - e.missFrom) + (soft ? e.soft * Math.min(1, cm / 80) : 0);
    if (this.#missed) p += (1 - p) * e.burst;
    this.#missed = p > 0 && this.#rand() < Math.min(0.97, p);
    if (this.#missed) return null;
    const jitter = e.jitter ? (this.#rand() * 2 - 1) * e.jitter : 0;
    return Math.max(0, Math.round(cm + jitter));
  }

  #sample(now) {
    if (now - this.#sampleAt < SAMPLE_MS) return;
    this.#sampleAt = now;
    const cm = this.#measure();
    if (cm !== null) this.#lastValidAt = now;
    this.truth.lastSample = { at: now, cm, lastValidAt: this.#lastValidAt < 0 ? null : this.#lastValidAt };
    this.#rust?.set_sample(ms(now), cm ?? -1, this.#lastValidAt < 0 ? -1n : ms(this.#lastValidAt));
  }

  // ---- physics ----------------------------------------------------------------------

  #step(dt, now) {
    this.#sample(now);
    const [l, r] = this.#rust ? this.#decideRust(now) : this.#decideJs(now);
    const m = this.world.motors;
    const p = this.pose;
    const rug = this.#onRug(p.x, p.y);
    const start = rug ? m.start.rug : m.start.floor;
    const k = rug ? m.rug : 1;
    // Below its start power a wheel doesn't turn: it hums.
    const wheel = (power, strength) => (Math.abs(power) < start ? 0 : (power / 100) * CM_PER_S_AT_100 * k * strength);
    const vl = wheel(l, 1 - m.drift), vr = wheel(r, 1);
    this.truth.stalled = (l !== 0 && vl === 0) || (r !== 0 && vr === 0);
    this.truth.wheels = [l, r];
    this.#humming(this.truth.stalled);
    const v = (vl + vr) / 2;
    const w = (vr - vl) / WHEELBASE;
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
      if (this.world.bump && v !== 0 && now - this.#bumped > 800) {
        this.#bumped = now;
        this.#emit("bump", {});
      }
    }
    this.#stepServo(dt);
  }

  #decideRust(now) {
    const out = this.#rust.evaluate(ms(now));
    const event = (out >> 16) & 3;
    // The firmware prints the reason; the cab hears the same line.
    if (event) this.#guardLine(event === 1 ? `guard stop ${(out >>> 18) & 1023}` : event === 3 ? "guard stop none" : "guard clear");
    return [i8(out & 0xff), i8((out >> 8) & 0xff)];
  }

  // The same rules as core/src/lib.rs, for when the .wasm file can't load.
  #decideJs(now) {
    let [l, r] = now - this.#cmdAt >= EXPIRY_MS ? [0, 0] : this.#cmd;
    const forward = (l + r) / 2;
    const s = this.truth.lastSample;
    const blind = !s || now - s.at > 250 || (s.cm === null && (s.lastValidAt === null || now - s.lastValidAt > 500));
    const blocked = this.#guardCm > 0 && forward > 0 && (blind || (s.cm !== null && s.cm < this.#guardCm));
    if (blocked) { l -= forward; r -= forward; }
    if (blocked !== this.#blocked) {
      this.#blocked = blocked;
      this.#guardLine(!blocked ? "guard clear" : blind || s.cm === null ? "guard stop none" : `guard stop ${s.cm}`);
    }
    return [l, r];
  }

  #guardLine(line) {
    const event = parseEvent(line);
    if (event) this.#emit(event.type, event.detail);
  }

  #stepServo(dt) {
    const s = this.#servo, t = this.truth;
    if (s.cmd === null) return; // never commanded: limp, where it was
    const limit = s.endStop ?? 90;
    const target = Math.min(s.cmd, limit);
    const step = SERVO_DEG_PER_S * dt;
    t.servoDeg += Math.max(-step, Math.min(step, target - t.servoDeg));
    const stalled = s.cmd > limit + 0.5 && t.servoDeg >= limit - 0.01;
    if (stalled && !t.servoStalled) this.#happened("buzz");
    if (!stalled && t.servoStalled) this.#happened("buzz-end");
    t.servoStalled = stalled;
    this.#buzzing(stalled);
    s.stallMs = stalled ? s.stallMs + dt * 1000 : 0;
    if (stalled && t.roofOn && s.stallMs >= this.world.servo.roofHoldMs) {
      // The boom pried the roof slope off its two studs; nothing stops it any more.
      t.roofOn = false;
      s.endStop = null;
      this.#happened("roof-off");
    }
  }

  #servoCurrent() {
    const t = this.truth;
    const moving = this.#servo.cmd !== null && Math.abs(Math.min(this.#servo.cmd, this.#servo.endStop ?? 90) - t.servoDeg) > 0.5;
    const ma = t.servoStalled ? 600 : moving ? 180 : this.#servo.cmd === null ? 0 : 12;
    return Math.round(ma + (this.#rand() * 2 - 1) * ma * 0.05);
  }

  #onRug(x, y) {
    return this.zones.some((z) => z.kind === "rug" && x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h);
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
      if (x < 0 || y < 0 || x > ROOM.w || y > ROOM.h) return { d, soft: false };
      const b = this.blocks.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      if (b) return { d, soft: !!b.soft };
    }
    return { d: Infinity, soft: false };
  }

  // ---- sounds of the room: a stalled motor hums, a stalled servo buzzes ---------------

  #humming(on) { this.#noise("motor", on, 95, 0.025); }
  #buzzing(on) { this.#noise("servo", on, 210, 0.03); }
  #humOff() { this.#noise("motor", false); this.#noise("servo", false); }
  #noise(which, on, hz, level) {
    this.#hum ??= {};
    const playing = this.#hum[which];
    if (on === !!playing) return;
    try {
      if (on) {
        this.#audio ??= new AudioContext();
        const osc = this.#audio.createOscillator(), gain = this.#audio.createGain();
        osc.type = "sawtooth";
        osc.frequency.value = hz;
        gain.gain.value = level;
        osc.connect(gain).connect(this.#audio.destination);
        osc.start();
        this.#hum[which] = osc;
      } else {
        playing.stop();
        this.#hum[which] = null;
      }
    } catch {
      this.#hum[which] = null;
    }
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
          saveRoom(this);
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
      if (!d.moved) d.block.soft = !d.block.soft; // a tap: soft (a sofa, a cushion) or hard again
      if (!this.#free(this.pose.x, this.pose.y)) Object.assign(d.block, d.from); // not on the robot
      saveRoom(this);
      return;
    }
    const p = this.#toRoom(e);
    if (this.blocks.length < 10 && p.x >= 0 && p.y >= 0 && p.x <= ROOM.w && p.y <= ROOM.h) {
      const b = { x: clamp(Math.round((p.x - 10) / 5) * 5, 0, ROOM.w - 20), y: clamp(Math.round((p.y - 10) / 5) * 5, 0, ROOM.h - 20), w: 20, h: 20 };
      this.blocks.push(b);
      if (!this.#free(this.pose.x, this.pose.y)) this.blocks.pop();
      saveRoom(this);
    }
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // Something happened in the room. The robot can't report it; only a person can.
  #happened(what) {
    this.#emit("world", { what, at: performance.now() });
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
      body: color("--loco", "#f2b134"), rug: color("--rug", "#3a2f45"), dark: color("--bezel", "#343d46"),
    };
    const ctx = canvas.getContext("2d");
    const pad = 22 * dpr; // room for axis labels
    // Keep clear of whatever covers the bottom of the view (a drawer), so the robot stays visible.
    const inset = (Number(canvas.dataset.insetBottom) || 0) * dpr;
    const h = canvas.height - inset;
    const s = Math.min((canvas.width - pad * 1.5) / ROOM.w, (h - pad * 1.5) / ROOM.h);
    const ox = pad + (canvas.width - pad * 1.5 - ROOM.w * s) / 2;
    const oy = pad * 0.5 + (h - pad * 1.5 - ROOM.h * s) / 2;
    this.#view = { s, ox, oy };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.screen;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // rugs first, under the grid: a woven pattern, no signal colours
    ctx.setTransform(s, 0, 0, s, ox, oy);
    for (const z of this.zones) {
      ctx.fillStyle = C.rug;
      ctx.fillRect(z.x, z.y, z.w, z.h);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

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

    // blocks: hatched obstacles; soft ones (a sofa) with rounded corners and dotted hatching
    for (const b of this.blocks) {
      ctx.fillStyle = C.block;
      ctx.beginPath();
      if (b.soft && ctx.roundRect) ctx.roundRect(b.x, b.y, b.w, b.h, 5); else ctx.rect(b.x, b.y, b.w, b.h);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = C.screen; ctx.lineWidth = 1.2;
      if (b.soft) ctx.setLineDash([1.5, 2.5]);
      for (let k = -b.h; k < b.w; k += 6) { ctx.beginPath(); ctx.moveTo(b.x + k, b.y + b.h); ctx.lineTo(b.x + k + b.h, b.y); ctx.stroke(); }
      ctx.restore();
      ctx.strokeStyle = C.label; ctx.lineWidth = 0.8;
      ctx.beginPath();
      if (b.soft && ctx.roundRect) ctx.roundRect(b.x, b.y, b.w, b.h, 5); else ctx.rect(b.x, b.y, b.w, b.h);
      ctx.stroke();
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

    // sensor beam, coloured like a signal aspect; no echo is dark, never green
    const p = this.pose;
    const cm = this.#lastCm;
    const beamColor = cm === null ? C.dark : cm < Math.max(this.#guardCm, 1) ? C.red : cm < this.#guardCm + 30 ? C.yellow : C.green;
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (cm !== null) {
      const lx = p.x + Math.cos(p.heading) * (reach + 8), ly = p.y + Math.sin(p.heading) * (reach + 8);
      ctx.fillStyle = beamColor; ctx.textAlign = "center";
      ctx.font = `600 ${11 * dpr}px "IBM Plex Mono", monospace`;
      ctx.fillText(String(cm), ox + lx * s, oy + ly * s);
    }

    // the barrier as you'd see it standing next to the robot: post, boom, and the roof slope.
    // In the margin left of the room when there's space, else in the room's bottom-left corner.
    if (this.#servo.cmd !== null || this.truth.roofOn) {
      const box = 30 * dpr * 1.6;
      const left = ox - pad > box + 8 * dpr ? ox - pad - box - 4 * dpr : ox + 4 * dpr;
      this.#drawBarrier(ctx, C, dpr, left, oy + ROOM.h * s - box - 4 * dpr, box);
    }
  }

  #drawBarrier(ctx, C, dpr, x, y, box) {
    const u = box / 30; // the box is 30 units square; the post stands at (4, 26)
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = C.screen; ctx.globalAlpha = 0.9;
    ctx.fillRect(0, 0, box, box);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.label; ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, box, box);
    const px = 4 * u, py = 26 * u, len = 22 * u;
    const stop = this.world.servo.endStopDeg ?? 70;
    const b = (stop + 9) * Math.PI / 180;
    // The roof slope sits just past where the boom stops; once it's off, it lies on the floor.
    const roof = this.truth.roofOn ? [px + Math.cos(b) * len * 0.8, py - Math.sin(b) * len * 0.8] : [22 * u, 26 * u];
    if (this.truth.roofOn || this.world.servo.roof) {
      ctx.fillStyle = C.block;
      ctx.fillRect(roof[0] - 3 * u, roof[1] - 2.5 * u, 6 * u, 2.5 * u);
    }
    ctx.fillStyle = C.label; ctx.fillRect(px - 1.5 * u, py, 3 * u, 3 * u);
    const a = (this.truth.servoDeg * Math.PI) / 180;
    ctx.strokeStyle = C.red; ctx.lineWidth = 2 * u; ctx.lineCap = "butt";
    ctx.setLineDash([3 * u, 3 * u]);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * len, py - Math.sin(a) * len); ctx.stroke();
    ctx.restore();
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function loadRoom() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (Array.isArray(saved)) return { blocks: saved, zones: DEFAULT_ZONES.map((z) => ({ ...z })) }; // older phones kept blocks only
    if (saved && Array.isArray(saved.blocks)) return { blocks: saved.blocks, zones: Array.isArray(saved.zones) ? saved.zones : [] };
  } catch { /* fresh room */ }
  return { blocks: DEFAULT_BLOCKS.map((b) => ({ ...b })), zones: DEFAULT_ZONES.map((z) => ({ ...z })) };
}

function saveRoom(sim) {
  try { localStorage.setItem(STORE, JSON.stringify({ blocks: sim.blocks, zones: sim.zones })); } catch { /* fine */ }
}
