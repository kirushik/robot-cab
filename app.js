// Robot Cab: a driver's desk for the robot. Master controller with fraction notches and a
// direction switch, signals, train protection that trips and latches, vigilance check, timetable
// programs, cab-radio announcements. The real robot and the simulator share one API
// (robot.js / sim.js); this file is the UI. Rule of the house: nothing happens to the driver
// without warning, and every picture means one thing.

import { BleRobot, bluetoothAvailable, guardGivesReasons } from "./robot.js";
import { SimRobot } from "./sim.js";
import { createServo } from "./servo.js";
import { createStop } from "./stop.js";
import { createKit } from "./kit.js";
import { createConsist } from "./consist.js";
import { NAMES } from "./voice.js";
import { Voice, NOTCH_NAMES, LINES } from "./voice.js";
import { parse, understand, readBack, endsWithOver, onlyOpener } from "./radio.js";

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
  lang: guessLang(), voice: true, tones: true, alarms: true, blink: true, listen: true, servoOn: false, ledsOn: false, depotOn: false, depotNews: 0,
  maxSpeed: 60, startPower: 30, guard: 20, sifaEvery: 0, programs: [], wishes: [], tickets: [], nextTicket: 1,
};
try { Object.assign(settings, JSON.parse(localStorage.getItem("robot-cab") || "{}")); } catch { /* fresh */ }
// Whatever is in storage, a broken entry must not keep the cab from starting.
const validProgram = (p) => p && Number.isInteger(p.n) && Array.isArray(p.steps) && p.steps.every((s) => s && typeof s.type === "string");
settings.programs = Array.isArray(settings.programs) ? settings.programs.filter(validProgram) : [];
settings.tickets = Array.isArray(settings.tickets) ? settings.tickets.filter((t) => t && Number.isInteger(t.n) && typeof t.text === "string") : [];
// Older cabs kept a plain list of things he said that it didn't understand: they become wish tickets.
for (const w of Array.isArray(settings.wishes) ? settings.wishes.filter((x) => typeof x === "string").reverse() : []) {
  settings.tickets.push({ n: 0, type: "wish", text: w, alternatives: [], lang: settings.lang, at: 0, state: "filed" });
}
settings.wishes = [];
settings.nextTicket = Math.max(Number(settings.nextTicket) || 1, ...settings.tickets.map((t) => t.n + 1));
settings.tickets.forEach((t) => { if (!t.n) t.n = settings.nextTicket++; });
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
  for (const [id, key] of [["voiceOn", "voice"], ["tonesOn", "tones"], ["alarmsOn", "alarms"], ["blinkOn", "blink"], ["listenOn", "listen"], ["servoOn", "servoOn"], ["ledsOn", "ledsOn"], ["depotOn", "depotOn"]]) {
    $(id).checked = settings[key];
  }
  showSockets();
  $("maxSpeed").value = settings.maxSpeed;
  $("maxOut").textContent = settings.maxSpeed;
  $("startPower").value = settings.startPower;
  $("startOut").textContent = settings.startPower;
  $("guard").value = String(settings.guard);
  $("sifaEvery").value = String(settings.sifaEvery);
  $("mic").hidden = !(settings.listen && voice.canListen);
  cab.classList.toggle("calm", !settings.blink);
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = UI[settings.lang][el.dataset.t];
  renderBadges();
  renderTickets();
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
  fitWords();
  const box = $("announce");
  box.classList.remove("fresh");
  void box.offsetWidth;
  box.classList.add("fresh");
  setTimeout(() => box.classList.remove("fresh"), 2500);
}
// Words show whole or not at all: he's learning to read, and a cut-off "Sim…" is a riddle. When the
// line doesn't fit, the picture and number stay; the cab said the words, and a tap says them again.
function fitWords() {
  const box = $("announce"), words = $("annText");
  box.classList.remove("no-words");
  box.classList.toggle("no-words", words.scrollWidth > words.clientWidth + 1);
}
addEventListener("resize", fitWords);
$("announce").onclick = () => lastAnnouncement && voice.say(lastAnnouncement.key, lastAnnouncement.values);

// ---- the robot ------------------------------------------------------------------------------

let robot = null;
let guardOnRobot = false;
const sim = new SimRobot();

// The barrier servo's face (servo.js). The robot object never leaves this file.
const servo = createServo({
  $, getRobot: () => robot, settings, save, frac,
  say: (text) => announce("said", { text }, { number: "" }),
  onSent: (deg, ok) => announce("said", { text: readBack(settings.lang, [{ what: "servo", deg, up: deg > 0, failed: !ok }]) }, { number: "" }),
});
// Modules (kit.js) run sandboxed; these are the only things they can make the cab do. Motion moves
// the cab's own controls, so he sees what drives, and the stop path still decides the wheels.
const kit = createKit({
  outputs: {
    lamps: (colors) => { leds = colors ? Array.from({ length: 10 }, (_, i) => colors[i] ?? null) : Array(10).fill(null); renderLeds(); sendLights(); },
    horn: () => horn(),
    say: (text) => announce("said", { text }, { number: "" }),
    lever: (notch) => setThrottle(notch, { fromProgram: true }),
    steer: (s) => setSteer(s, { fromProgram: true }),
  },
  onChange: () => consist?.render(),
});
settings.modules = Array.isArray(settings.modules) ? settings.modules.filter((u) => typeof u === "string") : [];
settings.moduleStore ??= {};
for (const url of settings.modules) kit.load(url, { store: settings.moduleStore[url] ?? {} }).catch(() => {});

// The consist: footer sockets, the coupling drawer, module faces (consist.js).
let lastMotionAt = -Infinity;
const consist = createConsist({
  $, getRobot: () => robot, settings, save, announce, kit, servo,
  say: (text) => announce("said", { text }, { number: "" }),
  fileTicket: (...a) => fileTicket(...a),
  name: (key) => voice.name(key),
  // Coupling happens in the depot: lever at 0, steering centred, and nothing moving for a second.
  canCouple: () => state.throttle === 0 && state.steer === 0 && performance.now() - lastMotionAt > 1000 &&
    !(robot?.odometry && Math.abs(robot.speed) > 0.5),
});
function showSockets() {
  consist.render();
}
sim.attach($("map"));
const wired = new WeakSet();

async function use(next) {
  if (robot && robot !== next) {
    stopKernel.stop("switch"); // the old robot's last events are ignored from here on, so stop now
    if (robot.state !== "disconnected") await robot.disconnect();
  }
  robot = next;
  if (wired.has(next)) return;
  wired.add(next);
  stopKernel.watch(next); // first: a lost link stops before anything else reacts
  for (const [type, handler] of Object.entries(handlers)) {
    next.addEventListener(type, (e) => { if (robot === next) handler(e.detail); });
  }
}

let wasLost = false;
let buttonMask = 0;
const handlers = {
  state: ({ state: s, name }) => {
    const online = s === "connected";
    // Not connected, for whatever reason, the stop path (stop.js) has already put everything to
    // zero, so nothing drives off by itself when the link comes back.
    cab.classList.toggle("offline", !online);
    cab.classList.toggle("sim", robot?.kind === "sim" && s !== "disconnected");
    cab.classList.toggle("ble", robot?.kind === "ble" && s !== "disconnected");
    lamp("lampLink", online ? "on" : s === "reconnecting" ? "warn" : "");
    showIdent(s === "disconnected" ? "—" : name);
    $("connInfo").textContent = online ? `Connected: ${name}` : `Robot: ${s}`;
    if (online) {
      announce(wasLost ? "back" : robot.kind === "sim" ? "sim" : "ready", { name: spellName(name) });
      wasLost = false;
      buttonMask = 0;
      lampsSaid = false;
      // A new link: old readings say nothing about now.
      Object.assign(echo, { cm: null, at: -Infinity, heardAt: -Infinity, history: [] });
      odo.anchor = null;
      rangerSpeed = null;
      odo.base = robot.odometry ? robot.odometer : odo.est + odo.cmd;
      // (The protection setting is sent by the stop path, stop.js, first thing after connecting.)
      sendLights();
      requestAnimationFrame(placeHandle);
      servo.reset(); // nobody knows where the boom is now
      consist.connected();
    }
    if (s === "reconnecting" && !wasLost) { wasLost = true; announce("lost"); }
    if (s === "disconnected") { wasLost = false; lamp("lampAtp", ""); lamp("lampMotor", ""); }
    if (!online) { servo.reset(); consist.disconnected(); }
    showSockets();
  },
  distance: ({ cm }) => showDistance(cm),
  buttons: ({ mask }) => {
    const pressed = mask & ~buttonMask; // only the ones that just went down
    buttonMask = mask;
    for (let i = 0; i < 8; i++) if (pressed & (1 << i)) announce("button", { n: i + 1 });
    kit.signal("buttons", mask);
  },
  bump: () => { setThrottle(0, { silent: true }); announce("bump"); tone("alarm", 180, 200); },
  driver: ({ ok }) => {
    lamp("lampMotor", ok ? "on" : "alarm");
    if (!ok && robot?.kind === "ble") announce("noMotors");
  },
  // Firmware 0.2.0+ says why it stopped; older firmware prints its threshold, which explains nothing.
  guard: ({ blocked, reason, cm }) => showBlocked(blocked, guardGivesReasons(robot?.firmware) ? { reason, cm } : null),
};

// The robot's name in the strip: "Robot-" and its own part ("277F") apart, so a narrow phone can
// show just the part that tells robots apart. Text nodes only: the name comes from the robot.
function showIdent(name) {
  const m = /^(Robot-)(.+)$/.exec(name);
  const parts = m ? [Object.assign(document.createElement("span"), { className: "pre", textContent: m[1] }), document.createTextNode(m[2])] : [document.createTextNode(name)];
  $("ident").replaceChildren(...parts);
  $("ident").title = name;
}

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

const state = { throttle: 0, dir: 1, steer: 0, blocked: false, caution: false, lastInput: performance.now() };
// The trip latch lives in the stop path (stop.js); the cab only reads it.
Object.defineProperty(state, "tripped", { get: () => stopKernel.tripped, enumerable: true });
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
  if (!fromProgram) { touched(); kit.driverTouched(); }
  if (value === 0 && state.tripped) clearTrip();
  // His hand on the lever takes over from a program, even if the notch doesn't change (a program
  // waiting to depart must not drive off after he pulled the lever to 0).
  if (!fromProgram) cancelProgram();
  if (value === state.throttle) return;
  state.throttle = value;
  placeHandle();
  recordChange();
  drive();
  if (state.tripped && value > 0 && !fromProgram) {
    // Latched: the lock on the handle shows it; the words come once per trip.
    if (!state.zeroSaid) { state.zeroSaid = true; announce("leverZero"); }
  }
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
  if (!fromProgram) { if (s) cancelProgram(); touched(); kit.driverTouched(); }
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

/// The notch he asked for, after the caution limit (forward only).
function effectiveNotch() {
  let t = state.throttle;
  if (state.dir > 0 && state.caution) t = Math.min(t, 0.25);
  return t;
}

/// Wheel power for a notch: ¼ is the start power (the least that moves the robot), 1 is the top
/// speed, the notches in between evenly spaced. Reverse runs at half. Lever 0 is exactly 0, and
/// steering at lever 0 turns on the spot.
function power(t) {
  if (t <= 0) return 0;
  const hi = settings.maxSpeed, lo = Math.min(settings.startPower, hi);
  return lo + ((hi - lo) * (Math.min(1, t) - 0.25)) / 0.75;
}
function wheelsFor(t, s, dir = 1) {
  const V = settings.maxSpeed;
  if (t === 0 && s === 0) return [0, 0];
  if (t === 0) {
    const turn = s * Math.min(V, Math.max(settings.startPower, V * 0.5));
    return [turn, -turn]; // turn on the spot
  }
  const base = power(t) * (dir > 0 ? 1 : -REVERSE_FACTOR);
  const k = Math.abs(base) * 0.6 * s; // the outer wheel faster, the inner one slower
  return [base + k, base - k].map((w) => Math.max(-100, Math.min(100, w)));
}

function wheels() {
  if (state.tripped && state.throttle > 0) return [0, 0]; // protection tripped: lever to zero first
  return wheelsFor(effectiveNotch(), state.steer, state.dir);
}

// What the cab would like the wheels to do. The stop path decides what is sent.
function wantedWheels() {
  let [l, r] = wheels();
  // Old firmware without the robot's own guard: a slower version of it, here.
  const cm = freshCm();
  if (!guardOnRobot && settings.guard > 0 && (cm === null || cm < settings.guard) && l + r > 0) {
    const m = (l + r) / 2; l -= m; r -= m;
  }
  return [l, r];
}

// The stop path: emergency brake, keep-alive, stop on link loss and in the background, the
// protection setting sent after every connect, the trip latch. Frozen: see stop.js.
const stopKernel = createStop({
  brake: $("ebrake"),
  getRobot: () => robot,
  controls: () => ({ lever: state.throttle, steer: state.steer }),
  wanted: wantedWheels,
  guardCm: () => settings.guard,
  onStop: (reason) => {
    kit.stopped(); // no module moves the controls again until the driver does
    zeroControls();
    if (reason === "brake") { announce("ebrake"); tone("alarm", 220, 400); }
  },
  onGuard: (ok) => { guardOnRobot = ok; lamp("lampAtp", settings.guard ? "on" : ""); },
});
const drive = () => stopKernel.send();

// Everything the driver set goes back to zero (the stop path calls this when it stops).
function zeroControls() {
  state.throttle = 0;
  state.steer = 0;
  cancelProgram();
  $("throttle").classList.remove("tripped");
  placeHandle();
  $("steerKnob").style.transform = "";
  clearSifa();
}

// ---- train protection: trips, and stays tripped until the lever goes to zero -----------------------

// What the ranger told us. A reading is valid for ECHO_MS; after that the distance is unknown, and an
// unknown distance is never "clear": the signal goes dark, as on a railway.
const ECHO_MS = 500;
const echo = { cm: null, at: -Infinity, heardAt: -Infinity, history: [], misses: new Map() };
const freshCm = (now = performance.now()) => (now - echo.at <= ECHO_MS ? echo.cm : null);

let approach = null; // { said } from the first caution until a fresh, clearly green reading
function showDistance(cm) {
  const now = performance.now();
  echo.heardAt = now;
  if (cm === null) countMiss(true);
  else {
    countMiss(false, cm);
    echo.cm = cm;
    echo.at = now;
    echo.history.push([now, cm]);
    while (echo.history.length && now - echo.history[0][0] > 1500) echo.history.shift();
    rangerMoved(now);
  }
  // Old firmware without the robot's own guard: the app's check trips and latches the same way.
  if (!guardOnRobot && settings.guard > 0 && robot?.kind === "ble") {
    const fresh = freshCm(now);
    const ahead = fresh === null || fresh < settings.guard;
    if (ahead && !state.blocked && effectiveNotch() > 0 && state.dir > 0 && !state.tripped) showBlocked(true, fresh);
    else if (!ahead && state.blocked) showBlocked(false, fresh);
  }
  showSignal(now);
  if (stopLine && guardStopLine(now)[0] !== "guardStop") { clearTimeout(stopLine.timer); stopLine.say(); }
}

// The aspect, the caution limit and the track view, from the reading that is still valid (if any).
function showSignal(now = performance.now()) {
  const g = settings.guard;
  const cm = freshCm(now);
  $("distVal").textContent = cm === null ? "—" : String(cm);
  // Protection off: dark, because nothing will stop for it. No valid reading: dark too ("none").
  const aspect = !g ? "" : cm === null ? "none" : cm < g ? "r" : cm < g + 30 ? "y" : "g";
  $("signal").className = `signal ${aspect}`;
  // Caution: forward limited to ¼, like a speed restriction. Only a fresh green lifts it: missing
  // data keeps it, so a missed echo is never a burst of full power.
  const caution = g > 0 && aspect !== "g";
  if (g > 0 && aspect === "g" && cm >= g + 35) approach = null; // well clear: the next approach is new
  if (caution && aspect !== "r" && state.dir > 0 && state.throttle > 0.25 && !state.tripped) {
    approach ??= { said: false };
    if (!approach.said) {
      approach.said = true;
      announce(aspect === "none" ? "noEchoSlow" : "caution", {}, { number: frac(0.25) });
    }
  }
  if (caution !== state.caution) {
    state.caution = caution;
    drive(); // apply (or lift) the limit now, not at the next keep-alive
  }
  // Only on a robot that is there: offline nothing is limited, and the band would say it is.
  $("throttle").classList.toggle("caution", caution && state.dir > 0 && g > 0 && robot?.state === "connected");
  // Tripped, and now a fresh reading says the track ahead is clear: tell the driver how to carry on.
  if (state.tripped && trackClear(now) && !state.clearSaid) { state.clearSaid = true; announce("clearZero"); }
  // Track view for the real robot: the obstacle on a 0..200 cm ruler.
  $("track").classList.toggle("has-obstacle", cm !== null && cm <= 200);
  if (cm !== null && cm <= 200) {
    const ruler = $("ruler");
    $("obstacle").style.top = `${ruler.offsetTop + ruler.offsetHeight * (1 - cm / 200)}px`;
  }
}

// Clear enough to drive on: a fresh reading a few cm past the protection limit. No reading, no clear.
function trackClear(now = performance.now()) {
  if (!settings.guard) return true;
  const cm = freshCm(now);
  return cm !== null && cm >= settings.guard + 5;
}

// The robot's guard stopped it. Say what we know, and no more: a fresh reading below the limit is an
// obstacle at that distance; distance samples arriving but none valid for 500 ms is "no echo";
// anything else (a reading that doesn't explain the stop: the robot samples more often than it
// reports) is only "protection, stop". The screen shows the same.
function guardStopLine(now = performance.now(), why = null) {
  if (why?.reason === "noEcho") return ["noEcho", {}];
  const cm = freshCm(now);
  if (cm !== null && cm < settings.guard) return ["obstacle", { cm }];
  if (cm === null && now - echo.heardAt <= ECHO_MS) return ["noEcho", {}];
  return ["guardStop", {}];
}

let stopLine = null; // a stop line waiting for the report that explains it
function showBlocked(blocked, why = null) {
  state.blocked = blocked;
  // Latch first: nothing below may send the wheels anything before the trip holds them.
  const latch = blocked && state.throttle > 0 && !state.tripped;
  if (blocked && state.throttle > 0) setTrip();
  if (blocked && why) {
    // The robot knows best: it saw every sample. Its reading goes on the screen, or, if it had no
    // valid echo, the reading we still hold is out of date and goes off it.
    const now = performance.now();
    if (why.reason === "obstacle" && why.cm !== null) Object.assign(echo, { cm: why.cm, at: now, heardAt: now });
    if (why.reason === "noEcho") echo.at = -Infinity;
    showSignal(now);
  }
  $("throttle").classList.toggle("blocked", blocked);
  lamp("lampAtp", blocked ? "alarm" : settings.guard ? "on" : "");
  if (blocked) {
    tone("alarm", 330, 160);
    // One line per stop. The first time it latches the lever, the line also says what to do.
    if (latch) state.zeroSaid = true;
    // The robot samples more often than it reports: if what we have doesn't explain the stop yet,
    // the next report (within 250 ms) usually does. The stop itself doesn't wait for words.
    const say = () => { stopLine = null; const [key, values] = guardStopLine(performance.now(), why); announce(key, { ...values, zero: latch }); };
    clearTimeout(stopLine?.timer);
    if (why || guardStopLine()[0] !== "guardStop") say();
    else stopLine = { say, timer: setTimeout(say, 250) };
  }
  // "Clear" comes from the distance (showSignal), not from here: once tripped, the robot stops
  // pushing forward, so the robot's guard releases even though the obstacle is still there.
}

function setTrip() {
  clearTimeout(throttleSay); // "Throttle ¼" after "Stop" would say the opposite of what happened
  state.clearSaid = false;
  state.zeroSaid = false;
  $("throttle").classList.add("tripped");
  stopKernel.trip();
}
function clearTrip() {
  if (!state.tripped) return;
  stopKernel.release();
  $("throttle").classList.remove("tripped");
}

// Where the ranger stops being reliable: missed echoes counted by the last valid distance, in 25 cm
// bands. A band where 30 % or more go missing (with enough samples) is drawn as unreliable.
function countMiss(missed, cm) {
  const at = missed ? (performance.now() - echo.at <= 1000 ? echo.cm : null) : cm;
  if (at === null) return;
  const band = Math.min(11, Math.floor(at / 25));
  const m = echo.misses.get(band) ?? { n: 0, miss: 0 };
  m.n++;
  if (missed) m.miss++;
  if (m.n > 200) { m.n /= 2; m.miss /= 2; } // remember about the last few minutes
  echo.misses.set(band, m);
}
function reliableUpTo() {
  for (let band = 0; band < 12; band++) {
    const m = echo.misses.get(band);
    if (m && m.n >= 12 && m.miss / m.n >= 0.3) return band * 25;
  }
  return null;
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
  showReliable();
}
function showReliable() {
  const cm = reliableUpTo();
  const mark = $("unreliable");
  mark.hidden = cm === null || cm >= 200;
  if (!mark.hidden) {
    mark.style.height = `${100 - cm / 2}%`;
    mark.querySelector("span").textContent = `≈${cm}`;
  }
}
buildRuler();

// An open drawer covers the bottom of the view: the track (and the simulator's room) move above it,
// so the loco and the protection limits always stay in sight.
const view = document.querySelector(".view");
function fitView() {
  const open = [...view.querySelectorAll(".drawer")].filter((d) => !d.hidden && d.offsetHeight);
  // If the drawer, shown whole, would leave too little for the room (a phone upright), the room and
  // the track become a thin strip across the top instead, and the drawer gets the rest.
  let squeezed = false, strip = 0;
  if (open.length) {
    const natural = Math.max(...open.map((d) => d.scrollHeight + 2));
    const room = view.clientHeight - natural - 18; // 8 px under the drawer, 10 above
    squeezed = room < 150;
    strip = Math.max(34, Math.min(60, room));
  }
  view.classList.toggle("squeezed", squeezed);
  view.style.setProperty("--strip", `${strip}px`);
  view.style.setProperty("--len", `${view.clientWidth}px`);
  const h = open.length ? Math.max(...open.map((d) => view.clientHeight - d.offsetTop + 6)) : 0;
  view.style.setProperty("--drawer-h", `${h}px`);
  $("map").dataset.insetBottom = String(h);
  $("track").classList.toggle("compact", view.clientHeight - h < 140);
  showSignal(); // the obstacle's place on the ruler
}
new MutationObserver(fitView).observe(view, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
// The height really visible: Chrome's address bar comes and goes on a phone.
const fitHeight = () => document.documentElement.style.setProperty("--app-h", `${innerHeight}px`);
addEventListener("resize", fitHeight);
fitHeight();
const drawerSizes = new ResizeObserver(fitView);
drawerSizes.observe(view);
view.querySelectorAll(".drawer").forEach((d) => drawerSizes.observe(d));

// ---- instruments: speed and odometer -------------------------------------------------------------

const ticks = document.querySelector(".dial .ticks");
for (const [v, label] of [[0, "0"], [0.25, "¼"], [0.5, "½"], [0.75, "¾"], [1, "1"]]) {
  const a = Math.PI * (1 - v);
  const x1 = 60 + Math.cos(a) * 46, y1 = 64 - Math.sin(a) * 46, x2 = 60 + Math.cos(a) * 52, y2 = 64 - Math.sin(a) * 52;
  const tx = 60 + Math.cos(a) * 36, ty = 64 - Math.sin(a) * 36 + 4;
  ticks.insertAdjacentHTML("beforeend", `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><text x="${tx}" y="${ty}">${label}</text>`);
}

// Speed and distance driven, each one of three kinds, drawn as such:
//  - measured (solid): the robot knows (the ideal simulator, or wheel encoders some day);
//  - estimated (≈): from how the ranger's distance changes while a target is in range. Changes
//    within RANGER_NOISE cm are noise and count as standing still;
//  - commanded (hollow): what the wheels were told, when nothing measures it.
const RANGER_NOISE = 3; // cm: the ranger jitters by a centimetre or two
const RANGE_FOR_SPEED = 250; // cm: beyond this the echoes are too sparse to trust a change
const odo = { base: 0, est: 0, cmd: 0, anchor: null };
let rangerSpeed = null; // cm/s from the ranger, or null if it can't tell
function rangerMoved(now) {
  const h = echo.history.filter(([t]) => now - t <= 700);
  const [, cm] = h[h.length - 1];
  // A jump of more than 30 cm is another target (it turned, or something moved), not motion.
  if (odo.anchor === null || Math.abs(cm - odo.anchor) > 30) odo.anchor = cm;
  else if (Math.abs(cm - odo.anchor) > RANGER_NOISE) { odo.est += Math.abs(cm - odo.anchor); odo.anchor = cm; }
  if (h.length < 3 || cm > RANGE_FOR_SPEED) { rangerSpeed = null; return; }
  // Least-squares slope over the last 0.7 s; a change smaller than the noise is standing still.
  const n = h.length, mt = h.reduce((s, [t]) => s + t, 0) / n, mc = h.reduce((s, [, c]) => s + c, 0) / n;
  const slope = h.reduce((s, [t, c]) => s + (t - mt) * (c - mc), 0) / (h.reduce((s, [t]) => s + (t - mt) ** 2, 0) || 1);
  const span = h[n - 1][0] - h[0][0];
  rangerSpeed = Math.abs(slope * span) < RANGER_NOISE ? 0 : Math.abs(slope * 1000);
}

let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  showSignal(now); // a reading runs out even if no new one arrives
  let speed = 0, kind = "";
  const connected = robot?.state === "connected";
  if (connected && robot.odometry) {
    speed = Math.abs(robot.speed);
  } else if (connected) {
    const steering = state.steer !== 0;
    if (!steering && freshCm(now) !== null && freshCm(now) <= RANGE_FOR_SPEED && rangerSpeed !== null) {
      speed = rangerSpeed;
      kind = "est";
    } else {
      const [l, r] = wheels();
      speed = state.blocked && l + r > 0 ? 0 : Math.abs((l + r) / 2 / 100) * CM_PER_S_AT_100;
      odo.cmd += speed * dt;
      kind = "cmd";
    }
  }
  let shownOdo = 0, odoKind = "";
  if (connected && robot.odometry) shownOdo = robot.odometer - odo.base;
  else if (connected) {
    shownOdo = odo.est + odo.cmd - odo.base;
    odoKind = odo.cmd > 0.5 ? "cmd" : "est"; // any part only commanded: the whole number is
  }
  const full = CM_PER_S_AT_100 * settings.maxSpeed / 100 || 1;
  $("speedVal").textContent = String(Math.round(speed));
  $("odoVal").textContent = String(Math.round(Math.max(0, shownOdo)));
  $("speedBox").className = `readout ${kind}`;
  $("odoBox").className = `readout ${odoKind}`;
  document.querySelector(".dial").classList.toggle("cmd", kind === "cmd");
  $("needle").style.transform = `rotate(${-90 + Math.min(1, speed / full) * 180}deg)`;
  $("wanted").style.transform = `rotate(${-90 + state.throttle * 180}deg)`;
  showReliable();
  // What modules may know (they get only what they declared).
  const [wl, wr] = wheels();
  if (wl || wr) lastMotionAt = now;
  kit.signal("distance", freshCm(now));
  kit.signal("blocked", state.blocked);
  kit.signal("tripped", state.tripped);
  kit.signal("throttle", state.throttle);
  kit.signal("dir", state.dir);
  kit.signal("speed", Math.round(speed));
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

// The LED stick can't say whether it's there (its data line goes one way), so the cab's lamp row
// shows what was sent (hollow, like any command), and on the real robot with no stick ticked in
// settings, the first lamps he paints get one line: they'd stay dark, and he should know.
let lampsSaid = false;
function sendLights() {
  const lit = leds.some(Boolean);
  robot?.lights(lit ? leds.map((c) => c ?? [0, 0, 0]) : "off");
  if (lit && robot?.kind === "ble" && !settings.ledsOn && !lampsSaid) {
    lampsSaid = true;
    announce("noLamps");
  }
}

function changedLights() {
  touched();
  renderLeds();
  sendLights();
  recordInstant({ type: "lights", leds: [...leds] });
}

$("lightsBtn").onclick = () => { $("lightsPanel").hidden = !$("lightsPanel").hidden; $("timetable").hidden = true; servo.close(); touched(); };
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
      stopKernel.stop("vigilance");
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
  const [l, r] = wheelsFor(step.t, step.s, step.dir);
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
  servo.close();
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
    const [l, r] = wheelsFor(step.t, 0, step.dir);
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
    .map((s) => [...wheelsFor(s.t, s.s, s.dir), s.ms]);
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
  if (state.blocked || !trackClear()) { announce(...guardStopLine()); return; }
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

// ---- the radio: hold the microphone, speak, let go (docs/operating-model.md §1) ------------------------

// While he holds it, it listens (up to 20 s), and nothing he says closes it early. A quick tap means
// "listen for me": then it ends with his first sentence, or with «Приём» as the last word (never at the
// start: there it's a call). The start beep sounds when the microphone is really capturing, the end
// beep when the transmission ends, and the key is lit in between. If the recogniser gives up on its
// own while he still holds it, what it heard is kept and the cab offers «Повторить последнее?»: his
// next transmission continues that one.
let tx = null; // { session, held, started, captured }
let kept = null; // { text, at }: a transmission cut off by the cab
const mic = $("mic");
mic.addEventListener("pointerdown", (e) => {
  if (tx) return;
  mic.setPointerCapture(e.pointerId);
  touched();
  mic.classList.add("arming");
  const t = { held: true, started: performance.now(), captured: false };
  tx = t;
  t.session = voice.listen({
    maxMs: 20000,
    onCapture: () => { t.captured = true; mic.classList.remove("arming"); mic.classList.add("on"); tone("robot", 880, 60); },
    onText: (text, final) => {
      if (t.held || !final) return;
      if (endsWithOver(text) || !onlyOpener(text)) t.session.stop();
    },
  });
  t.session.result.then((r) => heard(t, r));
});
const micUp = () => {
  if (!tx || !tx.held) return;
  tx.held = false;
  tx.heldMs = performance.now() - tx.started;
  // Held: letting go ends it. A tap: it listens for one sentence (see onText).
  if (tx.heldMs > 400) tx.session.stop();
};
mic.addEventListener("pointerup", micUp);
mic.addEventListener("pointercancel", micUp);

function heard(t, { text, alternatives, captured, ended, error }) {
  mic.classList.remove("on", "arming");
  if (tx === t) tx = null;
  if (captured) tone("robot", 660, 60);
  if (error === "denied") { announce("noEars"); return; }
  if (error === "offline") { announce("offline"); return; }
  // Cut off: the recogniser stopped while he still held the key, or ran out of time. That's the
  // cab's fault, never "not understood".
  if ((ended === "self" && t.held) || ended === "cap") {
    if (text) kept = { text: kept ? `${kept.text} ${text}` : text, at: performance.now() };
    mic.classList.toggle("kept", !!kept);
    announce("cutOff");
    return;
  }
  if (!text && !alternatives.length) {
    if (!kept) announce("repeat");
    return;
  }
  const before = kept && performance.now() - kept.at < 60000 ? `${kept.text} ` : "";
  kept = null;
  mic.classList.remove("kept");
  respond(alternatives.length ? alternatives.map((a) => before + a) : [before + text]);
}

// One answer per transmission, in the protocol's words.
function respond(alternatives) {
  const parsed = alternatives.map(parse);
  const p = parsed.find((x) => x.kind === "commands") ?? parsed.find((x) => x.kind !== "none") ?? parsed[0];
  switch (p.kind) {
    case "call": announce("onAir"); break;
    case "menu": announce("vocab"); break;
    case "status": sayTickets(); break;
    case "report": fileTicket("report", p.text, alternatives); announce("roger"); break;
    case "wish": announce("wishFiled", { n: fileTicket("wish", p.text, alternatives).n }, { number: "" }); break;
    case "question": announce("questionFiled", { n: fileTicket("question", p.text, alternatives).n }, { number: "" }); break;
    case "commands": doCommands(p.commands, p.unknown); break;
    default: announce("repeat");
  }
}

const COLORS = { red: BRUSHES[1], yellow: BRUSHES[2], green: BRUSHES[3], blue: BRUSHES[4], white: BRUSHES[5], dark: null };
/// Do what he said, as he said it, then read back what was done (and what wasn't understood).
async function doCommands(commands, unknown = []) {
  const done = [];
  for (const c of commands) {
    if (c.do === "stop") { setThrottle(0, { silent: true }); done.push({ what: "stop" }); continue; }
    if (c.do === "throttle") {
      const dir = c.value < 0 ? -1 : 1;
      if (dir !== state.dir) { setThrottle(0, { silent: true }); setDirection(dir); }
      setThrottle(Math.abs(c.value), { silent: true });
      done.push({
        what: "throttle", notch: state.throttle, notchName: NOTCH_NAMES[settings.lang][state.throttle], dir: state.dir,
        limited: state.dir > 0 && state.caution && state.throttle > 0.25, latched: state.tripped && state.throttle > 0,
      });
    }
    if (c.do === "left" || c.do === "right") {
      done.push({ what: c.do });
      setSteer(c.do === "left" ? -1 : 1);
      await wait(800);
      setSteer(0);
    }
    if (c.do === "horn") {
      for (let i = 0; i < c.n; i++) {
        if (i) await wait(900);
        touched(); horn(); recordInstant({ type: "horn" });
      }
      done.push({ what: "horn", n: c.n });
    }
    if (c.do === "lights") {
      leds = Array(10).fill(COLORS[c.color]);
      changedLights();
      done.push({ what: "lights", color: c.color });
    }
    if (c.do === "program") {
      const p = settings.programs.find((q) => q.n === c.n);
      if (p) runProgram(p); // it announces its own departure
      else done.push({ what: "program", n: c.n, missing: true });
    }
    if (c.do === "servo") {
      const ok = await servo.command(c.deg, { voice: true });
      done.push({ what: "servo", deg: c.deg, up: c.up, failed: !ok });
    }
  }
  const text = readBack(settings.lang, done, unknown);
  if (text) announce("said", { text }, { number: "" });
}

// ---- tickets: his wishes, questions and reports, numbered (the depot picks them up) ---------------------

const TICKET_STATE = {
  filed: { en: "received", de: "angenommen", ru: "принята" },
  depot: { en: "in the depot", de: "im Depot", ru: "в депо" },
  papa: { en: "waiting for Papa", de: "wartet auf Papa", ru: "ждёт Папу" },
  done: { en: "done", de: "fertig", ru: "готова" },
  answered: { en: "answered", de: "beantwortet", ru: "отвечен" },
  trial: { en: "on trial", de: "zur Probe", ru: "на пробе" },
  "sent-back": { en: "sent back", de: "zurückgeschickt", ru: "отправлена обратно" },
};
function fileTicket(type, text, alternatives = []) {
  const t = {
    n: settings.nextTicket++, type, text, alternatives: alternatives.slice(0, 4), lang: settings.lang, at: Date.now(), state: "filed",
    // What the cab knew then: the depot can't see the robot either.
    context: {
      robot: robot?.kind ?? null, firmware: robot?.firmware ?? null, world: robot?.kind === "sim" ? sim.worldName : null,
      lever: state.throttle, dir: state.dir, tripped: state.tripped, distance: freshCm(), guard: settings.guard,
    },
  };
  settings.tickets.push(t);
  settings.tickets = settings.tickets.slice(-200);
  save();
  renderTickets();
  dispatchEvent(new CustomEvent("robot-cab:ticket", { detail: t }));
  depotSend();
  return t;
}

// ---- the depot (docs/depot-service.md): tickets go to the laptop that serves the cab, and news
// comes back as spoken lines. Only if his father allowed it (a family setting, off by default).
// News waits while the lever is up: the depot never talks over driving.
let depotBusy = false;
const heldNews = [];
async function depotSend() {
  if (!settings.depotOn || depotBusy) return;
  depotBusy = true;
  try {
    for (const t of settings.tickets.filter((x) => !x.sent)) {
      const { sent: _s, ...body } = t;
      const r = await fetch("depot/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) break;
      t.sent = true;
      save();
    }
  } catch { /* the depot isn't there: they wait on the phone */ }
  depotBusy = false;
}
async function depotPoll() {
  if (!settings.depotOn || document.hidden) return;
  depotSend();
  try {
    const r = await fetch(`depot/news?after=${settings.depotNews}`, { cache: "no-store" });
    if (!r.ok) return;
    for (const item of (await r.json()).news) {
      settings.depotNews = Math.max(settings.depotNews, item.id);
      heldNews.push(item);
    }
    save();
  } catch { /* offline: try again later */ }
}
function depotSay() {
  if (state.throttle !== 0 || tx) return;
  const item = heldNews.shift();
  if (!item) return;
  const t = settings.tickets.find((x) => x.n === item.ticket);
  const L = settings.lang;
  if (item.kind === "answer") {
    if (t) t.state = "answered";
    const head = { en: `Answer to question ${item.ticket}:`, de: `Antwort auf Frage ${item.ticket}:`, ru: `Ответ на вопрос ${item.ticket}:` }[L];
    announce("said", { text: `${head} ${item.text}` }, { number: "" });
  } else if (item.kind === "state") {
    if (t) t.state = item.state;
    const name = { en: "Ticket", de: "Auftrag", ru: "Заявка" }[L];
    announce("said", { text: `${name} ${item.ticket} — ${TICKET_STATE[item.state]?.[L] ?? item.state}.` }, { number: "" });
  } else if (item.kind === "outcome") {
    servo.report(item.what, "papa");
  }
  save();
  renderTickets();
}
setInterval(depotPoll, 3000);
setInterval(depotSay, 500);
function sayTickets() {
  const open = settings.tickets.filter((t) => t.type !== "report" && t.state !== "done" && t.state !== "answered");
  if (!open.length) { announce("noTickets"); return; }
  const name = { wish: { en: "Ticket", de: "Auftrag", ru: "Заявка" }, question: { en: "Question", de: "Frage", ru: "Вопрос" } };
  const text = open.slice(-6).map((t) => `${name[t.type][settings.lang]} ${t.n} — ${TICKET_STATE[t.state]?.[settings.lang] ?? t.state}.`).join(" ");
  announce("said", { text }, { number: "" });
}
function renderTickets() {
  consist?.render();
  const open = settings.tickets.filter((t) => t.type !== "report");
  $("wishCount").textContent = open.length;
  $("wishes").replaceChildren(...[...settings.tickets].reverse().map((t) =>
    Object.assign(document.createElement("li"), { textContent: `${t.n} · ${t.type} · ${t.state} · ${t.text}` })));
}
$("copyWishes").onclick = async () => {
  const text = "What my son told the robot (tickets):\n" + settings.tickets.map((t) => `- #${t.n} ${t.type} (${t.state}): ${t.text}`).join("\n");
  try { await navigator.clipboard.writeText(text); $("copyWishes").textContent = "Copied"; } catch { /* select manually */ }
};
$("clearWishes").onclick = () => { settings.tickets = []; save(); renderTickets(); };

// ---- hold anything to hear its name (without pressing it) --------------------------------------------

let nameHold = null;
let swallowClick = null;
document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest("[data-name]");
  if (!el || el.closest("#rail, #steer, #mic, .servo-dial")) return;
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
for (const [id, key] of [["voiceOn", "voice"], ["tonesOn", "tones"], ["alarmsOn", "alarms"], ["blinkOn", "blink"], ["listenOn", "listen"], ["servoOn", "servoOn"], ["ledsOn", "ledsOn"], ["depotOn", "depotOn"]]) {
  $(id).onchange = () => { settings[key] = $(id).checked; save(); applySettings(); };
}
$("maxSpeed").oninput = () => { settings.maxSpeed = Number($("maxSpeed").value); $("maxOut").textContent = settings.maxSpeed; save(); drive(); };
// ¼ is the start power: the least that turns the wheels on his floor (on a rug, more than on parquet).
$("startPower").oninput = () => { settings.startPower = Number($("startPower").value); $("startOut").textContent = settings.startPower; save(); drive(); };
$("guard").onchange = () => {
  settings.guard = Number($("guard").value);
  save();
  buildRuler();
  stopKernel.guardChanged();
};
$("sifaEvery").onchange = () => { settings.sifaEvery = Number($("sifaEvery").value); save(); };
$("resetRoom").onclick = () => sim.resetRoom();
$("servoRefit").onclick = () => { servo.refitted(); $("servoRefit").textContent = "Servo re-fitted: warning armed"; };
$("simWorld").value = sim.worldName;
$("simWorld").onchange = () => sim.setWorld($("simWorld").value);
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

// Installable as a fullscreen home-screen app (manifest.webmanifest) that also opens offline (sw.js).
// Not under test automation, so the tests always see the files as they are.
if ("serviceWorker" in navigator && isSecureContext && !navigator.webdriver) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* fine: it still works in the browser */ });
}

// For tests and curious grown-ups in the browser console.
window.robotCab = { echo, sim, state, settings, understand, wheelsFor, servo, parse, kit, consist, NAMES, showTimetable, get robot() { return robot; }, runProgram };
