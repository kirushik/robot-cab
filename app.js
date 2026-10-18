// Robot Cab: a driver's desk for the robot. Master controller with fraction notches and a
// direction switch, signals, train protection that trips and latches, vigilance check, timetable
// programs, cab-radio announcements. The real robot and the simulator share one API
// (robot.js / sim.js); this file is the UI. Rule of the house: nothing happens to the driver
// without warning, and every picture means one thing.

import { BleRobot, bluetoothAvailable } from "./robot.js";
import { SimRobot } from "./sim.js";
import { Voice, understand, NOTCH_NAMES, LINES } from "./voice.js";

const $ = (id) => document.getElementById(id);
const cab = $("cab");
const voice = new Voice();

const NOTCHES = [1, 0.75, 0.5, 0.25, 0];
const CM_PER_S_AT_100 = 45; // simulator calibration; the real robot is estimated with the same number
const WHEELBASE = 14;
const REVERSE_FACTOR = 0.5; // reverse runs at half power: there's no sensor at the back
// Program lines get their own colours, never the signal colours (red/yellow/green) or reverse.
const LINE_COLORS = ["#8e6ccf", "#2aa198", "#d46a9f", "#3fb6d6", "#9aa84a", "#c07a4f", "#6f8fbf", "#b8a0e0"];
const BRUSHES = [null, [229, 72, 77], [242, 177, 52], [63, 191, 111], [74, 144, 217], [240, 240, 230]];
const UI = { en: { robot: "Robot", sim: "Simulator" }, de: { robot: "Roboter", sim: "Simulator" }, ru: { robot: "Робот", sim: "Симулятор" } };
const lineColor = (n) => LINE_COLORS[(n - 1) % LINE_COLORS.length];
const frac = (v) => ({ 1: "1", 0.75: f(3, 4), 0.5: f(1, 2), 0.25: f(1, 4), 0: "0" })[v] ?? String(v);
function f(n, d) {
  return `<span class="frac"><i>${n}</i><i>${d}</i></span>`;
}

// ---- settings and saved things ------------------------------------------------------------

const settings = {
  lang: guessLang(), voice: true, tones: true, alarms: true, blink: true, listen: true,
  maxSpeed: 60, guard: 20, sifaEvery: 0, programs: [], wishes: [],
};
try { Object.assign(settings, JSON.parse(localStorage.getItem("robot-cab") || "{}")); } catch { /* fresh */ }
// Whatever is in storage, a broken entry must not keep the cab from starting.
const validProgram = (p) => p && Number.isInteger(p.n) && Array.isArray(p.steps) && p.steps.every((s) => s && typeof s.type === "string");
settings.programs = Array.isArray(settings.programs) ? settings.programs.filter(validProgram) : [];
settings.wishes = Array.isArray(settings.wishes) ? settings.wishes.filter((w) => typeof w === "string") : [];
settings.programs.forEach(migrate);
const save = () => { try { localStorage.setItem("robot-cab", JSON.stringify(settings)); } catch { /* fine */ } };

// Programs from the first cab version had reverse as a notch of -0.5.
function migrate(program) {
  for (const step of program.steps) {
    if (step.type === "drive" && step.dir === undefined) {
      step.dir = step.t < 0 ? -1 : 1;
      step.t = Math.abs(step.t);
    }
  }
}

function guessLang() {
  const l = (navigator.language || "en").slice(0, 2);
  return ["en", "de", "ru"].includes(l) ? l : "en";
}

function applySettings() {
  voice.lang = settings.lang;
  voice.enabled = settings.voice;
  document.documentElement.lang = settings.lang;
  $("lang").value = settings.lang;
  for (const [id, key] of [["voiceOn", "voice"], ["tonesOn", "tones"], ["alarmsOn", "alarms"], ["blinkOn", "blink"], ["listenOn", "listen"]]) {
    $(id).checked = settings[key];
  }
  $("maxSpeed").value = settings.maxSpeed;
  $("maxOut").textContent = settings.maxSpeed;
  $("guard").value = String(settings.guard);
  $("sifaEvery").value = String(settings.sifaEvery);
  $("mic").hidden = !(settings.listen && voice.canListen);
  cab.classList.toggle("calm", !settings.blink);
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = UI[settings.lang][el.dataset.t];
  renderBadges();
  renderWishes();
}

// ---- sounds: each kind can be switched off on its own ------------------------------------------

let audio = null;
function tone(kind, hz, ms) {
  if (kind === "robot" && !settings.tones) return;
  if (kind === "alarm" && !settings.alarms) return;
  robot?.tone(hz, ms);
  // Alarms also sound on the phone (the robot may be across the room) and buzz it.
  if (kind === "alarm" && robot?.kind === "ble") {
    try {
      audio ??= new AudioContext();
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.frequency.value = hz; gain.gain.value = 0.06;
      osc.connect(gain).connect(audio.destination);
      osc.start(); osc.stop(audio.currentTime + ms / 1000);
    } catch { /* no audio */ }
    navigator.vibrate?.([120, 60, 120]);
  }
}

// ---- announcements: spoken, and a picture + number in the status strip -------------------------

let lastAnnouncement = null;
function announce(key, values = {}, { number = null } = {}) {
  const text = voice.text(key, values);
  voice.say(key, values);
  lastAnnouncement = { key, values };
  $("annIcon").setAttribute("href", `#${LINES[key]?.icon ?? "i-signal"}`);
  const n = number ?? (values.cm !== undefined ? `${values.cm}<small> cm</small>` : values.n ?? "");
  $("annNum").innerHTML = n;
  $("annText").textContent = text;
  const box = $("announce");
  box.classList.remove("fresh");
  void box.offsetWidth;
  box.classList.add("fresh");
  setTimeout(() => box.classList.remove("fresh"), 2500);
}
$("announce").onclick = () => lastAnnouncement && voice.say(lastAnnouncement.key, lastAnnouncement.values);

// ---- the robot ------------------------------------------------------------------------------

let robot = null;
let guardOnRobot = false;
const sim = new SimRobot();
sim.attach($("map"));
const wired = new WeakSet();

async function use(next) {
  if (robot && robot !== next) {
    stopEverything(); // the old robot's last events are ignored from here on, so stop now
    if (robot.state !== "disconnected") await robot.disconnect();
  }
  robot = next;
  if (wired.has(next)) return;
  wired.add(next);
  for (const [type, handler] of Object.entries(handlers)) {
    next.addEventListener(type, (e) => { if (robot === next) handler(e.detail); });
  }
}

let wasLost = false;
let buttonMask = 0;
const handlers = {
  state: ({ state: s, name }) => {
    const online = s === "connected";
    // Not connected, for whatever reason: everything goes to zero, so nothing drives off by itself
    // when the link comes back.
    if (!online) stopEverything();
    cab.classList.toggle("offline", !online);
    cab.classList.toggle("sim", robot?.kind === "sim" && s !== "disconnected");
    cab.classList.toggle("ble", robot?.kind === "ble" && s !== "disconnected");
    lamp("lampLink", online ? "on" : s === "reconnecting" ? "warn" : "");
    $("ident").textContent = s === "disconnected" ? "—" : name;
    $("connInfo").textContent = online ? `Connected: ${name}` : `Robot: ${s}`;
    $("speedBox").classList.toggle("est", robot?.kind === "ble");
    $("odoBox").classList.toggle("est", robot?.kind === "ble");
    if (online) {
      announce(wasLost ? "back" : robot.kind === "sim" ? "sim" : "ready", { name: spellName(name) });
      wasLost = false;
      buttonMask = 0;
      odometerBase = robot.kind === "sim" ? robot.odometer : estOdometer;
      robot.guard(settings.guard).then((ok) => { guardOnRobot = ok; lamp("lampAtp", settings.guard ? "on" : ""); });
      sendLights();
      requestAnimationFrame(placeHandle);
    }
    if (s === "reconnecting" && !wasLost) { wasLost = true; announce("lost"); }
    if (s === "disconnected") { wasLost = false; lamp("lampAtp", ""); lamp("lampMotor", ""); }
  },
  distance: ({ cm }) => showDistance(cm),
  buttons: ({ mask }) => {
    const pressed = mask & ~buttonMask; // only the ones that just went down
    buttonMask = mask;
    for (let i = 0; i < 8; i++) if (pressed & (1 << i)) announce("button", { n: i + 1 });
  },
  bump: () => { setThrottle(0, { silent: true }); announce("bump"); tone("alarm", 180, 200); },
  driver: ({ ok }) => {
    lamp("lampMotor", ok ? "on" : "alarm");
    if (!ok && robot?.kind === "ble") announce("noMotors");
  },
  guard: ({ blocked, cm }) => showBlocked(blocked, cm),
};

// "Robot-1A2B" -> "1 A 2 B" so it's read out as characters.
const spellName = (name) => name.replace(/^Robot-/, "").split("").join(" ");

$("connectBle").onclick = async () => {
  if (!bluetoothAvailable()) { announce("noBt"); return; }
  const real = new BleRobot();
  await use(real);
  try { await real.connect(); } catch { cab.classList.add("offline"); }
};
$("connectSim").onclick = async () => { await use(sim); await sim.connect(); };
$("disconnect").onclick = () => { robot?.disconnect(); $("settings").close(); };

// ---- master controller and direction switch ---------------------------------------------------

const state = { throttle: 0, dir: 1, steer: 0, blocked: false, tripped: false, caution: false, lastInput: performance.now() };
const rail = $("rail");
const handle = $("handle");
const notchEls = [...rail.querySelectorAll(".notch")];

function placeHandle() {
  const el = notchEls.find((n) => Number(n.dataset.v) === state.throttle);
  handle.style.top = `${el.offsetTop + (el.offsetHeight - handle.offsetHeight) / 2}px`;
  notchEls.forEach((n) => n.classList.toggle("active", n === el));
  const zero = notchEls.find((n) => n.dataset.v === "0");
  const quarter = notchEls.find((n) => n.dataset.v === "0.25");
  $("blockedBand").style.height = `${zero.offsetTop - 4}px`;
  $("cautionBand").style.height = `${quarter.offsetTop - 4}px`;
}
new ResizeObserver(placeHandle).observe(rail);

let throttleSay = null;
function setThrottle(value, { silent = false, fromProgram = false } = {}) {
  if (!fromProgram) touched();
  if (value === 0 && state.tripped) clearTrip();
  if (value === state.throttle) return;
  if (!fromProgram) cancelProgram();
  state.throttle = value;
  placeHandle();
  recordChange();
  drive();
  if (state.tripped && value > 0 && !fromProgram) announce("leverZero");
  else if (!silent) {
    clearTimeout(throttleSay);
    throttleSay = setTimeout(() => announce("throttle", { notch: NOTCH_NAMES[settings.lang][state.throttle] }, { number: frac(state.throttle) }), 450);
  }
}

function nearestNotch(clientY) {
  let best = notchEls[0];
  for (const n of notchEls) {
    const r = n.getBoundingClientRect(), b = best.getBoundingClientRect();
    if (Math.abs(r.top + r.height / 2 - clientY) < Math.abs(b.top + b.height / 2 - clientY)) best = n;
  }
  return Number(best.dataset.v);
}

// Grab the handle and drag it notch by notch; a tap elsewhere moves it one notch towards the tap.
let dragging = false;
rail.addEventListener("pointerdown", (e) => {
  const h = handle.getBoundingClientRect();
  dragging = e.clientY >= h.top - 12 && e.clientY <= h.bottom + 12;
  rail.setPointerCapture(e.pointerId);
  $("throttle").classList.toggle("dragging", dragging);
  if (!dragging) {
    const i = NOTCHES.indexOf(state.throttle);
    const target = NOTCHES.indexOf(nearestNotch(e.clientY));
    if (target !== i) setThrottle(NOTCHES[i + Math.sign(target - i)]);
    else touched();
  }
});
rail.addEventListener("pointermove", (e) => {
  if (!dragging || !rail.hasPointerCapture(e.pointerId)) return;
  const i = NOTCHES.indexOf(state.throttle);
  const target = NOTCHES.indexOf(nearestNotch(e.clientY));
  if (target !== i) setThrottle(NOTCHES[i + Math.sign(target - i)]);
});
for (const ev of ["pointerup", "pointercancel"]) rail.addEventListener(ev, () => { dragging = false; $("throttle").classList.remove("dragging"); });

function setDirection(dir, { fromProgram = false } = {}) {
  if (dir === state.dir) return true;
  if (state.throttle !== 0 && !fromProgram) {
    announce("leverZero");
    return false;
  }
  state.dir = dir;
  cab.classList.toggle("reversing", dir < 0);
  $("revIcon").setAttribute("href", dir < 0 ? "#i-down" : "#i-up");
  recordChange();
  if (!fromProgram) announce(dir < 0 ? "reverse" : "forward");
  return true;
}
$("reverser").onclick = () => { touched(); setDirection(-state.dir); };

// ---- steering: springs back to the middle when released --------------------------------------

const steerTrack = document.querySelector(".steer-track");
function setSteer(s, { fromProgram = false } = {}) {
  s = Math.max(-1, Math.min(1, s));
  if (Math.abs(s) < 0.12) s = 0;
  if (!fromProgram) { if (s) cancelProgram(); touched(); }
  const changed = Math.sign(s) !== Math.sign(state.steer);
  state.steer = s;
  const max = steerTrack.clientWidth / 2 - 25;
  $("steerKnob").style.transform = `translateX(${s * max}px)`;
  if (changed) recordChange();
  drive();
}
function steerFrom(e) {
  const r = steerTrack.getBoundingClientRect();
  setSteer((e.clientX - (r.left + r.width / 2)) / (r.width / 2 - 25));
}
steerTrack.addEventListener("pointerdown", (e) => { steerTrack.setPointerCapture(e.pointerId); $("steer").classList.add("dragging"); steerFrom(e); });
steerTrack.addEventListener("pointermove", (e) => { if (steerTrack.hasPointerCapture(e.pointerId)) steerFrom(e); });
for (const ev of ["pointerup", "pointercancel"]) {
  steerTrack.addEventListener(ev, () => { $("steer").classList.remove("dragging"); setSteer(0); });
}

// ---- driving ---------------------------------------------------------------------------------

/// Effective power: reverse runs at half, the caution aspect limits forward to a quarter.
function effectiveThrottle() {
  let t = state.throttle;
  if (state.dir > 0 && state.caution) t = Math.min(t, 0.25);
  return t * (state.dir > 0 ? 1 : -REVERSE_FACTOR);
}

function wheelsFor(t, s) {
  const V = settings.maxSpeed;
  if (t === 0) return [s * V * 0.5, -s * V * 0.5]; // turn on the spot
  const base = t * V;
  const k = Math.abs(base) * 0.6 * s; // the outer wheel faster, the inner one slower
  return [base + k, base - k].map((w) => Math.max(-100, Math.min(100, w)));
}

function wheels() {
  if (state.tripped && state.throttle > 0) return [0, 0]; // protection tripped: lever to zero first
  return wheelsFor(effectiveThrottle(), state.steer);
}

function drive() {
  if (!robot || robot.state !== "connected") return;
  let [l, r] = wheels();
  // Old firmware without the robot's own guard: a slower version of it, here.
  if (!guardOnRobot && settings.guard > 0 && lastCm !== null && lastCm < settings.guard && l + r > 0) {
    const m = (l + r) / 2; l -= m; r -= m;
  }
  robot.drive(l, r);
}

// Keep talking to the robot while something is set; it stops by itself if we go quiet.
setInterval(() => { if (state.throttle !== 0 || state.steer !== 0) drive(); }, 100);

function stopEverything() {
  cancelProgram();
  state.throttle = 0;
  state.steer = 0;
  clearTrip();
  placeHandle();
  $("steerKnob").style.transform = "";
  robot?.drive(0, 0);
  clearSifa();
}

$("ebrake").addEventListener("pointerdown", () => {
  stopEverything();
  announce("ebrake");
  tone("alarm", 220, 400);
});

// Phone locked or app switched: stop.
document.addEventListener("visibilitychange", () => { if (document.hidden) stopEverything(); });

// ---- train protection: trips, and stays tripped until the lever goes to zero -----------------------

let lastCm = null;
function showDistance(cm) {
  lastCm = cm;
  $("distVal").textContent = cm === null ? "—" : String(cm);
  const g = settings.guard;
  // Protection off: the signal is dark, because nothing will stop for it. No echo is dark too:
  // it can mean open space or a bad sensor, and the robot's guard blocks forward after 500 ms of it.
  const aspect = !g || cm === null ? "" : cm < g ? "r" : cm < g + 30 ? "y" : "g";
  $("signal").className = `signal ${aspect}`;
  // Old firmware without the robot's own guard: the app's check trips and latches the same way.
  if (!guardOnRobot && g > 0 && robot?.kind === "ble") {
    const ahead = cm !== null && cm < g;
    if (ahead && !state.blocked && effectiveThrottle() > 0 && !state.tripped) showBlocked(true, cm);
    else if (!ahead && state.blocked) showBlocked(false, cm);
  }
  // Caution (yellow): forward limited to ¼, like a speed restriction.
  const caution = settings.guard > 0 && aspect === "y";
  if (caution && !state.caution && state.dir > 0 && state.throttle > 0.25) announce("caution", {}, { number: frac(0.25) });
  state.caution = caution;
  $("throttle").classList.toggle("caution", caution && state.dir > 0);
  // Tripped, and now the track ahead is clear again: tell the driver how to carry on.
  const clear = trackClear();
  if (state.tripped && clear && !state.clearSaid) { state.clearSaid = true; announce("clearZero"); }
  // Track view for the real robot: the obstacle on a 0..200 cm ruler.
  $("track").classList.toggle("has-obstacle", cm !== null && cm <= 200);
  if (cm !== null && cm <= 200) {
    const ruler = $("ruler");
    $("obstacle").style.top = `${ruler.offsetTop + ruler.offsetHeight * (1 - cm / 200)}px`;
  }
}

// Clear enough to drive on: a few cm past the protection limit, so it doesn't flicker.
// No reading is never clear.
function trackClear() {
  return !settings.guard || (lastCm !== null && lastCm >= settings.guard + 5);
}

// Why it stopped, saying no more than the reading backs: a distance only if there is one.
function sayBlocked(cm) {
  if (cm === null) announce("noEcho");
  else announce("obstacle", { cm });
}

function showBlocked(blocked, cm) {
  state.blocked = blocked;
  $("throttle").classList.toggle("blocked", blocked);
  lamp("lampAtp", blocked ? "alarm" : settings.guard ? "on" : "");
  if (blocked) {
    if (state.throttle > 0) setTrip();
    sayBlocked(cm ?? lastCm);
    tone("alarm", 330, 160);
  }
  // "Clear" comes from the distance (showDistance), not from here: once tripped, the robot stops
  // pushing forward, so the robot's guard releases even though the obstacle is still there.
}

function setTrip() {
  state.tripped = true;
  state.clearSaid = false;
  $("throttle").classList.add("tripped");
  drive();
}
function clearTrip() {
  if (!state.tripped) return;
  state.tripped = false;
  $("throttle").classList.remove("tripped");
}

function buildRuler() {
  const ruler = $("ruler");
  ruler.querySelectorAll("b").forEach((b) => b.remove());
  for (const cm of [0, 50, 100, 150, 200]) {
    const b = document.createElement("b");
    b.textContent = `${cm}`;
    b.style.top = `${100 - cm / 2}%`;
    ruler.append(b);
  }
  $("limitRed").style.top = `${100 - settings.guard / 2}%`;
  $("limitYellow").style.top = `${100 - (settings.guard + 30) / 2}%`;
  $("limitRed").hidden = $("limitYellow").hidden = !settings.guard;
}
buildRuler();

// ---- instruments: speed and odometer -------------------------------------------------------------

const ticks = document.querySelector(".dial .ticks");
for (const [v, label] of [[0, "0"], [0.25, "¼"], [0.5, "½"], [0.75, "¾"], [1, "1"]]) {
  const a = Math.PI * (1 - v);
  const x1 = 60 + Math.cos(a) * 46, y1 = 64 - Math.sin(a) * 46, x2 = 60 + Math.cos(a) * 52, y2 = 64 - Math.sin(a) * 52;
  const tx = 60 + Math.cos(a) * 36, ty = 64 - Math.sin(a) * 36 + 4;
  ticks.insertAdjacentHTML("beforeend", `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><text x="${tx}" y="${ty}">${label}</text>`);
}

let odometerBase = 0;
let estOdometer = 0;
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  let speed = 0, odo = 0;
  if (robot?.kind === "sim" && robot.state === "connected") {
    speed = Math.abs(robot.speed);
    odo = robot.odometer;
  } else if (robot?.state === "connected") {
    const [l, r] = wheels();
    speed = state.blocked && l + r > 0 ? 0 : Math.abs((l + r) / 2 / 100) * CM_PER_S_AT_100;
    estOdometer += speed * dt;
    odo = estOdometer;
  }
  const full = CM_PER_S_AT_100 * settings.maxSpeed / 100 || 1;
  $("speedVal").textContent = String(Math.round(speed));
  $("odoVal").textContent = String(Math.round(Math.max(0, odo - odometerBase)));
  $("needle").style.transform = `rotate(${-90 + Math.min(1, speed / full) * 180}deg)`;
  $("wanted").style.transform = `rotate(${-90 + state.throttle * 180}deg)`;
}, 100);

// ---- lamps: ten of them, each its own colour --------------------------------------------------------

let leds = Array(10).fill(null);
let brush = 1;
const rgb = (c) => (c ? `rgb(${c.join(",")})` : "transparent");

function renderLeds() {
  $("ledRow").replaceChildren(...leds.map((c) => {
    const i = document.createElement("i");
    if (c) { i.className = "lit"; i.style.setProperty("--c", rgb(c)); }
    return i;
  }));
  $("ledEdit").replaceChildren(...leds.map((c, n) => {
    const b = document.createElement("button");
    b.dataset.n = n + 1;
    b.setAttribute("aria-label", `Lamp ${n + 1}`);
    if (c) { b.className = "lit"; b.style.setProperty("--c", rgb(c)); }
    b.onclick = () => { leds[n] = BRUSHES[brush]; changedLights(); };
    return b;
  }));
  $("brushes").replaceChildren(...BRUSHES.map((c, n) => {
    const b = document.createElement("button");
    b.className = (c ? "" : "off ") + (n === brush ? "selected" : "");
    b.style.setProperty("--c", rgb(c));
    b.setAttribute("aria-label", c ? `Colour ${n}` : "Off");
    b.onclick = () => { brush = n; renderLeds(); };
    return b;
  }));
}

function sendLights() {
  robot?.lights(leds.some(Boolean) ? leds.map((c) => c ?? [0, 0, 0]) : "off");
}

function changedLights() {
  touched();
  renderLeds();
  sendLights();
  recordInstant({ type: "lights", leds: [...leds] });
}

$("lightsBtn").onclick = () => { $("lightsPanel").hidden = !$("lightsPanel").hidden; $("timetable").hidden = true; touched(); };
$("lightsDone").onclick = () => ($("lightsPanel").hidden = true);
$("fillAll").onclick = () => { leds = Array(10).fill(BRUSHES[brush]); changedLights(); };
renderLeds();

// ---- horn --------------------------------------------------------------------------------------------

function horn() {
  tone("robot", 392, 300);
  setTimeout(() => tone("robot", 330, 420), 330);
}
$("horn").onclick = () => { touched(); horn(); recordInstant({ type: "horn" }); };

// ---- vigilance (Sifa): amber warning first, then the check, then a brake --------------------------------

let sifa = null; // null | { phase: "soon" | "alarm", brake }
function touched() {
  state.lastInput = performance.now();
  clearSifa();
}
function clearSifa() {
  if (!sifa) return;
  clearTimeout(sifa.brake);
  sifa = null;
  $("sifa").classList.remove("soon", "alarm", "counting");
  lamp("lampSifa", "");
}
setInterval(() => {
  const every = settings.sifaEvery * 1000;
  const moving = state.throttle !== 0 && robot?.state === "connected";
  if (!every || !moving) { if (sifa) clearSifa(); return; }
  const quiet = performance.now() - state.lastInput;
  if (!sifa && quiet > every - 5000) {
    sifa = { phase: "soon" };
    $("sifa").classList.add("soon");
    lamp("lampSifa", "warn");
  }
  if (sifa?.phase === "soon" && quiet > every) {
    sifa.phase = "alarm";
    const key = $("sifa");
    key.classList.add("alarm");
    key.style.setProperty("--countdown", "10s");
    requestAnimationFrame(() => key.classList.add("counting"));
    lamp("lampSifa", "alarm");
    announce("sifa");
    tone("alarm", 880, 200);
    sifa.brake = setTimeout(() => {
      stopEverything();
      announce("sifaBrake");
    }, 10000);
  }
}, 250);
// Acknowledged the moment it's pressed: a held press (which also says the button's name) counts too.
$("sifa").addEventListener("pointerdown", touched);
$("sifa").onclick = () => touched();

// ---- programs: record a run, or compose one; shown as a timetable; run whole or step by step --------------

let recording = null; // { steps, seg: {t, dir, s, start} }
let playing = null; // { run, program, index, single }
let shown = null; // program on the timetable drawer
let cursor = 0; // next step for single-stepping

const steerSign = (s) => (s > 0.3 ? 1 : s < -0.3 ? -1 : 0);
const segNow = (start) => ({ t: state.throttle, dir: state.dir, s: steerSign(state.steer), start });

function recordChange() {
  if (!recording) return;
  const now = performance.now();
  closeSegment(now);
  recording.seg = segNow(now);
}
function closeSegment(now) {
  const seg = recording.seg;
  const ms = Math.round((now - seg.start) / 100) * 100;
  if (ms < 300) return;
  const last = recording.steps[recording.steps.length - 1];
  if (last?.type === "drive" && last.t === seg.t && last.s === seg.s && last.dir === seg.dir) last.ms += ms;
  else recording.steps.push({ type: "drive", t: seg.t, dir: seg.dir, s: seg.s, ms });
}
function recordInstant(step) {
  if (!recording) return;
  const now = performance.now();
  closeSegment(now);
  recording.steps.push(step);
  recording.seg = segNow(now);
}

$("rec").onclick = () => {
  touched();
  if (!recording) {
    cancelProgram();
    recording = { steps: [], seg: segNow(performance.now()) };
    $("rec").classList.add("on");
    announce("recording");
    return;
  }
  closeSegment(performance.now());
  const steps = recording.steps;
  const idle = (s) => s.type === "drive" && s.t === 0 && s.s === 0;
  while (steps.length && idle(steps[steps.length - 1])) steps.pop(); // trailing stand-still
  while (steps.length && idle(steps[0])) steps.shift(); // and the wait before driving off
  recording = null;
  $("rec").classList.remove("on");
  if (!steps.length) { announce("empty"); return; }
  const program = { n: Math.max(0, ...settings.programs.map((p) => p.n)) + 1, steps };
  settings.programs.push(program);
  save();
  renderBadges();
  announce("saved", { n: program.n, k: steps.length });
  showTimetable(program);
};

function renderBadges() {
  const badges = $("badges");
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.innerHTML = `<svg class="i"><use href="#i-rec"/></svg>`;
  badges.replaceChildren(...(settings.programs.length ? [] : [hint]), ...settings.programs.map((p) => {
    const b = document.createElement("button");
    b.className = "badge" + (playing?.program === p ? " running" : "");
    b.style.setProperty("--c", lineColor(p.n));
    b.textContent = p.n;
    b.dataset.name = "program";
    b.dataset.n = p.n;
    b.setAttribute("aria-label", `Program ${p.n}`);
    b.onclick = () => showTimetable(p);
    return b;
  }));
}

// What a step does, in numbers he can check on the grid: cm for driving, degrees for turning.
function stepQuantity(step) {
  if (step.type !== "drive") return "";
  const [l, r] = wheelsFor(step.t * (step.dir > 0 ? 1 : -REVERSE_FACTOR), step.s);
  const secs = step.ms / 1000;
  const cm = Math.abs((l + r) / 2 / 100) * CM_PER_S_AT_100 * secs;
  if (step.t === 0 && step.s) {
    const deg = Math.abs((r - l) / 100 * CM_PER_S_AT_100 / WHEELBASE * secs) * 180 / Math.PI;
    return `${Math.round(deg / 5) * 5}°`;
  }
  return step.t === 0 ? "" : `${Math.round(cm)} cm`;
}

function showTimetable(program) {
  shown = program;
  cursor = 0;
  $("timetable").hidden = false;
  $("lightsPanel").hidden = true;
  $("ttBadge").textContent = program.n;
  $("ttBadge").style.setProperty("--c", lineColor(program.n));
  renderTimetable();
}

function renderTimetable(current = -1) {
  if (!shown) return;
  const total = shown.steps.reduce((sum, s) => sum + (s.ms || 0), 0);
  $("ttTotal").textContent = `${(total / 1000).toFixed(1)} s`;
  const longest = Math.max(1, ...shown.steps.map((s) => s.ms || 0));
  const color = lineColor(shown.n);
  $("ttRows").replaceChildren(...shown.steps.map((step, i) => {
    const li = document.createElement("li");
    if (i === current) li.className = "now";
    let notch, turn, bar;
    if (step.type === "drive" && (step.t > 0 || step.s === 0)) {
      notch = cell(step.t === 0 ? `<svg class="i"><use href="#i-clock"/></svg>` : frac(step.t), "Power", () => {
        if (step.t === 0) return;
        step.t = { 0.25: 0.5, 0.5: 0.75, 0.75: 1, 1: 0.25 }[step.t];
        edited();
      });
    } else {
      notch = cell(step.type === "drive" ? "0" : "", "", null);
    }
    if (step.type === "drive") {
      const icon = step.s < 0 ? "i-left" : step.s > 0 ? "i-right" : step.dir < 0 ? "i-down" : "i-up";
      turn = cell(`<svg class="i"><use href="#${icon}"/></svg>`, "Direction", () => {
        // straight forward -> left -> right -> straight back -> ...
        const order = [[1, 0], [1, -1], [1, 1], [-1, 0]];
        const at = order.findIndex(([d, s]) => d === step.dir && s === step.s);
        [step.dir, step.s] = order[(at + 1) % order.length];
        if (step.t === 0 && step.s === 0 && step.dir === 1) step.s = -1; // a wait has nothing to turn
        edited();
      });
      if (step.dir < 0) turn.classList.add("rev");
      bar = document.createElement("span");
      bar.className = "bar";
      bar.style.setProperty("--w", `${(step.ms / longest) * 100}%`);
      bar.style.setProperty("--c", color);
      bar.innerHTML = `<span>${(step.ms / 1000).toFixed(1)} s</span><span class="cm">${stepQuantity(step)}</span>`;
    } else if (step.type === "horn") {
      turn = cell(`<svg class="i"><use href="#i-horn"/></svg>`, "", null);
      bar = document.createElement("span");
      bar.className = "bar";
    } else {
      turn = cell(`<svg class="i"><use href="#i-lamp"/></svg>`, "", null);
      bar = document.createElement("span");
      bar.className = "bar";
      bar.innerHTML = step.leds.map((c) => `<span class="swatch" style="--c:${c ? rgb(c) : "transparent"}"></span>`).join("");
    }
    const minus = chip("i-minus", "Less", () => adjust(step, -1));
    const plus = chip("i-plus", "More", () => adjust(step, 1));
    const del = chip("i-close", "Remove step", () => { shown.steps.splice(i, 1); edited(); });
    if (!step.ms) { minus.style.visibility = "hidden"; plus.style.visibility = "hidden"; }
    li.append(notch, turn, bar, minus, plus, del);
    return li;
  }));
  updatePreview();
}

function cell(html, label, onclick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "cell";
  b.innerHTML = html;
  if (label) b.setAttribute("aria-label", label);
  if (onclick) b.onclick = onclick; else b.disabled = true;
  return b;
}
function chip(icon, label, onclick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.setAttribute("aria-label", label);
  b.innerHTML = `<svg class="i"><use href="#${icon}"/></svg>`;
  b.onclick = onclick;
  return b;
}

// ± changes a straight drive by 10 cm (one grid square), anything else by half a second.
function adjust(step, sign) {
  if (step.type === "drive" && step.t > 0 && step.s === 0) {
    const [l, r] = wheelsFor(step.t * (step.dir > 0 ? 1 : -REVERSE_FACTOR), 0);
    const cmPerS = Math.abs((l + r) / 2 / 100) * CM_PER_S_AT_100;
    const cm = Math.max(10, Math.round((cmPerS * step.ms / 1000 + sign * 10) / 10) * 10);
    step.ms = Math.round((cm / cmPerS) * 1000);
  } else {
    step.ms = Math.max(500, Math.min(20000, step.ms + sign * 500));
  }
  edited();
}

function edited() {
  save();
  renderTimetable();
}

// Where the shown program would take the robot, drawn on the floor in its line colour.
function updatePreview() {
  if (!shown || robot?.kind !== "sim") { sim.preview = null; return; }
  const segments = shown.steps.filter((s) => s.type === "drive")
    .map((s) => [...wheelsFor(s.t * (s.dir > 0 ? 1 : -REVERSE_FACTOR), s.s), s.ms]);
  sim.preview = { points: sim.predict(segments), color: lineColor(shown.n) };
}

for (const button of document.querySelectorAll("[data-add]")) {
  button.onclick = () => {
    if (!shown) return;
    const kind = button.dataset.add;
    const step = {
      drive: { type: "drive", t: 0.5, dir: 1, s: 0, ms: 2000 },
      left: { type: "drive", t: 0, dir: 1, s: -1, ms: 800 },
      right: { type: "drive", t: 0, dir: 1, s: 1, ms: 800 },
      wait: { type: "drive", t: 0, dir: 1, s: 0, ms: 1000 },
      horn: { type: "horn" },
      lights: { type: "lights", leds: [...leds] },
    }[kind];
    shown.steps.push(step);
    edited();
  };
}

$("ttClose").onclick = () => { $("timetable").hidden = true; shown = null; sim.preview = null; };
$("ttPlay").onclick = () => {
  if (!shown) return;
  if (playing?.held && playing.program === shown) { resumeHeld(); return; }
  runProgram(shown);
};
$("ttStep").onclick = () => {
  if (!shown) return;
  if (cursor >= shown.steps.length) cursor = 0;
  runProgram(shown, { from: cursor, single: true });
};
let deleteHold = null;
$("ttDelete").addEventListener("pointerdown", () => {
  $("ttDelete").classList.add("holding");
  deleteHold = setTimeout(() => {
    settings.programs = settings.programs.filter((p) => p !== shown);
    save();
    renderBadges();
    $("ttClose").click();
  }, 900);
});
for (const ev of ["pointerup", "pointerleave", "pointercancel"]) {
  $("ttDelete").addEventListener(ev, () => { clearTimeout(deleteHold); $("ttDelete").classList.remove("holding"); });
}

async function runProgram(program, { from = 0, single = false } = {}) {
  cancelProgram();
  if (!robot || robot.state !== "connected") return;
  touched();
  const run = { on: true };
  playing = { run, program, single };
  renderBadges();
  if (shown !== program) showTimetable(program);
  if (!single) {
    announce("depart", { n: program.n });
    await wait(1200, run);
  }
  // The run goes by the steps as they were when it started: removing a row while it runs must not
  // shift what comes next. (The step objects are shared, so ± on a later step still applies.)
  const steps = program.steps.slice(from, single ? from + 1 : undefined);
  const highlight = (step) => { if (shown === program) renderTimetable(program.steps.indexOf(step)); };
  let finished = false;
  try {
    for (const step of steps) {
      if (!run.on) break;
      playing.step = step;
      cursor = Math.max(0, program.steps.indexOf(step)) + 1;
      highlight(step);
      if (step.type === "drive") {
        // Never an instant flip from forward to back: to zero first, like the driver has to.
        if (step.dir !== state.dir && state.throttle !== 0) {
          setThrottle(0, { silent: true, fromProgram: true });
          await wait(300, run);
          if (!run.on) break;
        }
        setDirection(step.dir, { fromProgram: true });
        setThrottle(step.t, { silent: true, fromProgram: true });
        setSteer(step.s, { fromProgram: true });
        await driveFor(step.ms, run);
      } else if (step.type === "horn") {
        horn();
        await wait(800, run);
      } else {
        leds = [...step.leds];
        renderLeds();
        sendLights();
        await wait(300, run);
      }
    }
    finished = run.on;
  } finally {
    // However it ends (finished, or something went wrong), the program leaves the lever at zero.
    // A cancel by the driver has already handed the controls over, so it's left alone.
    if (run.on) {
      setThrottle(0, { silent: true, fromProgram: true });
      setSteer(0, { fromProgram: true });
      if (finished && !single) announce("arrived");
      if (playing?.run === run) playing = null;
      $("ttPlay").classList.remove("waiting");
      renderBadges();
      if (shown === program) renderTimetable(single ? cursor - 1 : -1);
    }
  }
}

// A step's clock only runs while the robot may move. If the protection trips, the program holds
// until the driver presses Run again (and the track is clear).
async function driveFor(ms, run) {
  let done = 0;
  let last = performance.now();
  while (run.on && done < ms) {
    await wait(50, run);
    const now = performance.now();
    if (state.tripped) {
      // Marked inside the loop: a resume that trips again straight away is held again too.
      while (run.on && state.tripped) {
        if (playing && !playing.held) { playing.held = true; $("ttPlay").classList.add("waiting"); }
        await wait(100, run);
      }
      last = performance.now();
      continue;
    }
    if (!state.blocked) done += now - last;
    last = now;
    state.lastInput = now; // the program counts as the driver for the vigilance check
  }
}
function resumeHeld() {
  // The robot's guard lets go as soon as it stops pushing, so ask the distance, not the guard.
  if (state.blocked || !trackClear()) { sayBlocked(lastCm); return; }
  playing.held = false;
  $("ttPlay").classList.remove("waiting");
  clearTrip();
  drive();
}

function cancelProgram() {
  if (!playing) return;
  playing.run.on = false;
  playing.run.cancel?.();
  playing = null;
  $("ttPlay").classList.remove("waiting");
  setSteer(0, { fromProgram: true });
  renderBadges();
  renderTimetable();
}

function wait(ms, run) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (run) run.cancel = () => { clearTimeout(t); resolve(); };
  });
}

// ---- floor editing (simulator) --------------------------------------------------------------------

$("editFloor").onclick = () => {
  sim.editing = !sim.editing;
  $("editFloor").classList.toggle("on", sim.editing);
};

// ---- voice commands: hold the microphone, speak, let go ---------------------------------------------

let listening = null;
let misses = 0;
const mic = $("mic");
mic.addEventListener("pointerdown", (e) => {
  if (listening) return;
  mic.setPointerCapture(e.pointerId);
  touched();
  tone("robot", 880, 60);
  mic.classList.add("on");
  listening = { started: performance.now(), session: voice.listen({ maxMs: 6000 }) };
  listening.session.result.then(heard);
});
const micUp = () => {
  if (!listening) return;
  // A quick tap means "listen for me"; holding means "listen while I hold".
  if (performance.now() - listening.started > 400) listening.session.stop();
};
mic.addEventListener("pointerup", micUp);
mic.addEventListener("pointercancel", micUp);

function heard({ alternatives, error }) {
  mic.classList.remove("on");
  listening = null;
  if (error === "denied") { announce("noEars"); return; }
  if (error === "offline") { announce("offline"); return; }
  const commands = alternatives.map(understand).find((c) => c.length) ?? [];
  if (!commands.length) {
    misses++;
    announce(misses >= 2 ? "vocab" : "repeat");
    if (alternatives[0]) addWish(alternatives[0]);
    return;
  }
  misses = 0;
  doCommands(commands);
}

async function doCommands(commands) {
  for (const c of commands) {
    if (c.do === "stop") { setThrottle(0); continue; }
    if (c.do === "throttle") {
      const dir = c.value < 0 ? -1 : 1;
      if (dir !== state.dir) { setThrottle(0, { silent: true }); setDirection(dir); }
      setThrottle(Math.abs(c.value));
    }
    if (c.do === "left" || c.do === "right") {
      setSteer(c.do === "left" ? -1 : 1);
      await wait(800);
      setSteer(0);
    }
    if (c.do === "horn") $("horn").click();
    if (c.do === "lights") {
      const colors = { red: BRUSHES[1], yellow: BRUSHES[2], green: BRUSHES[3], blue: BRUSHES[4], white: BRUSHES[5], dark: null };
      leds = Array(10).fill(colors[c.color]);
      changedLights();
      announce(c.color === "dark" ? "dark" : "lights");
    }
    if (c.do === "program") {
      const p = settings.programs.find((q) => q.n === c.n);
      if (p) runProgram(p);
    }
  }
}

// What he asked for that the robot doesn't understand yet: for grown-ups (and an AI assistant).
function addWish(text) {
  settings.wishes = [text, ...settings.wishes.filter((w) => w !== text)].slice(0, 30);
  save();
  renderWishes();
}
function renderWishes() {
  $("wishCount").textContent = settings.wishes.length;
  $("wishes").replaceChildren(...settings.wishes.map((w) => Object.assign(document.createElement("li"), { textContent: w })));
}
$("copyWishes").onclick = async () => {
  const text = "Things my son asked the robot for that it doesn't understand yet:\n" + settings.wishes.map((w) => `- ${w}`).join("\n");
  try { await navigator.clipboard.writeText(text); $("copyWishes").textContent = "Copied"; } catch { /* select manually */ }
};
$("clearWishes").onclick = () => { settings.wishes = []; save(); renderWishes(); };

// ---- hold anything to hear its name (without pressing it) --------------------------------------------

let nameHold = null;
let swallowClick = null;
document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest("[data-name]");
  if (!el || el.closest("#rail, #steer, #mic")) return;
  clearTimeout(nameHold);
  nameHold = setTimeout(() => {
    const name = el.dataset.name === "program" ? `${voice.name("program")} ${el.dataset.n}` : voice.name(el.dataset.name);
    voice.say(name, {}, { raw: true });
    el.classList.add("speaking");
    setTimeout(() => el.classList.remove("speaking"), 900);
    swallowClick = el;
  }, 600);
}, true);
for (const ev of ["pointerup", "pointercancel", "pointerleave"]) document.addEventListener(ev, () => clearTimeout(nameHold), true);
document.addEventListener("click", (e) => {
  if (swallowClick && e.target.closest("[data-name]") === swallowClick) {
    e.stopPropagation();
    e.preventDefault();
  }
  swallowClick = null;
}, true);

// ---- small helpers ----------------------------------------------------------------------------------

function lamp(id, mode) {
  $(id).className = "lamp" + (mode ? ` ${mode}` : "");
}

// ---- settings: hold the gear ------------------------------------------------------------------------

let gearHold = null;
$("gear").addEventListener("pointerdown", () => {
  $("gear").classList.add("holding");
  gearHold = setTimeout(() => { $("gear").classList.remove("holding"); $("settings").showModal(); }, 1500);
});
for (const ev of ["pointerup", "pointerleave", "pointercancel"]) {
  $("gear").addEventListener(ev, () => { clearTimeout(gearHold); $("gear").classList.remove("holding"); });
}
$("settings").addEventListener("click", (e) => { if (e.target === $("settings")) $("settings").close(); });

$("lang").onchange = () => { settings.lang = $("lang").value; save(); applySettings(); };
for (const [id, key] of [["voiceOn", "voice"], ["tonesOn", "tones"], ["alarmsOn", "alarms"], ["blinkOn", "blink"], ["listenOn", "listen"]]) {
  $(id).onchange = () => { settings[key] = $(id).checked; save(); applySettings(); };
}
$("maxSpeed").oninput = () => { settings.maxSpeed = Number($("maxSpeed").value); $("maxOut").textContent = settings.maxSpeed; save(); };
$("guard").onchange = () => {
  settings.guard = Number($("guard").value);
  save();
  buildRuler();
  robot?.guard(settings.guard).then((ok) => { guardOnRobot = ok; lamp("lampAtp", settings.guard ? "on" : ""); });
};
$("sifaEvery").onchange = () => { settings.sifaEvery = Number($("sifaEvery").value); save(); };
$("resetRoom").onclick = () => sim.resetRoom();
$("clearPrograms").onclick = () => { settings.programs = []; save(); renderBadges(); $("ttClose").click(); };

// ---- keyboard, for desktops and tests: arrows, R = direction, space = emergency brake, H = horn -------

addEventListener("keydown", (e) => {
  if ($("settings").open || e.repeat) return;
  const i = NOTCHES.indexOf(state.throttle);
  if (e.key === "ArrowUp") setThrottle(NOTCHES[Math.max(0, i - 1)]);
  else if (e.key === "ArrowDown") setThrottle(NOTCHES[Math.min(NOTCHES.length - 1, i + 1)]);
  else if (e.key === "ArrowLeft") setSteer(-1);
  else if (e.key === "ArrowRight") setSteer(1);
  else if (e.key === "r") $("reverser").click();
  else if (e.key === " ") $("ebrake").dispatchEvent(new PointerEvent("pointerdown"));
  else if (e.key === "h") $("horn").click();
  else return;
  e.preventDefault();
});
addEventListener("keyup", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") setSteer(0); });
// Switched to another window while holding an arrow: the keyup never comes.
addEventListener("blur", () => { if (state.steer) setSteer(0); });

// Keyboard and switch access: Enter/Space on a notch moves the lever one notch towards it, and on
// the gear opens the settings (there's no holding a key).
for (const n of notchEls) {
  n.addEventListener("click", (e) => {
    if (e.detail !== 0) return; // pointer taps are handled by the rail
    const i = NOTCHES.indexOf(state.throttle), target = NOTCHES.indexOf(Number(n.dataset.v));
    if (target !== i) setThrottle(NOTCHES[i + Math.sign(target - i)]);
  });
}
$("gear").addEventListener("click", (e) => { if (e.detail === 0) $("settings").showModal(); });

applySettings();
placeHandle();

// For tests and curious grown-ups in the browser console.
window.robotCab = { sim, state, settings, understand, get robot() { return robot; }, runProgram };
