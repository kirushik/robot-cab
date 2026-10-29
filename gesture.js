// The gesture sensor's face: Grove Gesture, PAJ7620U2 at I²C 0x73, "the shunter's hand signals"
// (web/depot.html §4). Left: the nine gestures as a compass with counters; the last one fills amber
// for 600 ms. Right: the cursor window (a dot where the hand is, as big as its size, as bright as its
// light, with its last ten positions) and the raw brightness, 0–255, never centimetres: this chip
// sees infrared brightness 5–15 cm away, it is not a depth camera. The chip runs one mode at a time,
// so the half that isn't running is dimmed. In the simulator the window is a touch pad: a finger is
// the hand, swipes are gestures.

export const GESTURES = ["anticlockwise", "up", "clockwise", "left", "wave", "right", "forward", "down", "backward"];

// Seeed's Gesture_PAJ7620 init (also in workshop.html); gesture bits in 0x43 / 0x44.
const INIT = [
  "ef=00 37=07 38=17 39=06 42=01 46=2d 47=0f 48=3c 49=00 4a=1e 4c=20 51=10 5e=10 60=27 80=42 81=44 82=04 8b=01 90=06 95=0a 96=0c 97=05 9a=14 9c=3f a5=19",
  "cc=19 cd=0b ce=13 cf=64 d0=21 ef=01 02=0f 03=10 04=02 25=01 27=39 28=7f 29=08 3e=ff 5e=3d 65=96 67=97 69=cd 6a=01 6d=2c 6e=01 72=01 73=35 77=01 ef=00",
  "ef=01 65=12 ef=00",
];
const BITS = ["up", "down", "left", "right", "forward", "backward", "clockwise", "anticlockwise"];

/// Where gestures come from: the simulator's twin, or the real chip polled over the console.
/// onReading({ gesture } | { brightness, x, y, size }), onFault(message).
export function gestureSource(robot, { onReading, onFault }) {
  if (robot.kind === "sim") {
    const listen = (e) => onReading(e.detail);
    robot.addEventListener("gesture", listen);
    return { stop: () => robot.removeEventListener("gesture", listen), cursor: true };
  }
  // The real chip, in gesture mode. Its cursor mode needs another register set that hasn't been
  // tried on his board yet, so the cursor window says «—» there instead of guessing.
  const loop = { on: true };
  (async () => {
    try {
      let id = null;
      for (let i = 0; i < 5 && !id; i++) id = await robot.command("i2c 73 w 00 r 2").catch(() => null);
      if (id !== "data 20 76") throw new Error("no answer at 0x73");
      for (const line of INIT) await robot.command(`regs 73 ${line}`);
      while (loop.on && robot.state === "connected") {
        const low = parseInt((await robot.command("i2c 73 w 43 r 1")).split(" ")[1], 16);
        const high = parseInt((await robot.command("i2c 73 w 44 r 1")).split(" ")[1], 16);
        const g = high & 1 ? "wave" : BITS.find((_, i) => low === 1 << i);
        if (g) onReading({ gesture: g });
        await new Promise((r) => setTimeout(r, 150));
      }
    } catch (e) {
      if (loop.on) onFault(String(e.message ?? e));
    }
  })();
  return { stop: () => (loop.on = false), cursor: false };
}

/// The face, inside the given drawer element (the face template's cells). Returns its controls.
export function gestureFace(cells, { onTouchPad, mode = "gesture" }) {
  cells.innerHTML = `
    <div class="g-compass">${GESTURES.map((g) => `<div class="g-cell" data-g="${g}" data-name="g-${g}"><svg class="i"><use href="#g-${g}"/></svg><small>×<b>0</b></small></div>`).join("")}</div>
    <div class="g-window" data-name="gestureWindow"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><g class="trail"></g><circle class="dot" cx="50" cy="50" r="0"/></svg><span class="unknown">—</span></div>
    <div class="g-bar" data-name="gestureBrightness"><i><span></span></i><b class="num">—</b><small>0–255</small></div>`;
  const counts = Object.fromEntries(GESTURES.map((g) => [g, 0]));
  const trail = [];
  let cursorAvailable = true;
  const st = { mode };

  function setMode(m) {
    st.mode = m;
    cells.classList.toggle("cursor-mode", m === "cursor");
  }
  function gesture(g) {
    if (!(g in counts)) return;
    counts[g]++;
    const cell = cells.querySelector(`[data-g="${g}"]`);
    cell.querySelector("b").textContent = counts[g];
    cell.classList.remove("last");
    void cell.offsetWidth;
    cell.classList.add("last");
    clearTimeout(cell.t);
    cell.t = setTimeout(() => cell.classList.remove("last"), 600);
  }
  function cursor({ x, y, brightness, size = 30 }) {
    const b = Math.max(0, Math.min(255, Math.round(brightness)));
    cells.querySelector(".g-bar b").textContent = String(b);
    cells.querySelector(".g-bar span").style.height = `${(b / 255) * 100}%`;
    const dot = cells.querySelector(".dot");
    if (b === 0) { dot.setAttribute("r", 0); return; }
    trail.push([x * 100, y * 100]);
    if (trail.length > 10) trail.shift();
    dot.setAttribute("cx", x * 100); dot.setAttribute("cy", y * 100);
    dot.setAttribute("r", Math.max(3, Math.min(30, size / 4)));
    dot.style.opacity = String(0.25 + (b / 255) * 0.75);
    cells.querySelector(".trail").innerHTML = trail.map(([tx, ty]) => `<circle cx="${tx}" cy="${ty}" r="2"/>`).join("");
  }
  function setCursorAvailable(ok) {
    cursorAvailable = ok;
    cells.classList.toggle("no-cursor", !ok);
  }

  // The touch pad (simulator only): a finger is the hand.
  const pad = cells.querySelector(".g-window");
  let stroke = null;
  const at = (e) => {
    const r = pad.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)), t: performance.now() };
  };
  pad.addEventListener("pointerdown", (e) => {
    if (!onTouchPad) return;
    pad.setPointerCapture(e.pointerId);
    stroke = [at(e)];
    if (st.mode === "cursor") onTouchPad({ ...stroke[0], brightness: 200, size: 60 });
  });
  pad.addEventListener("pointermove", (e) => {
    if (!stroke) return;
    const p = at(e);
    stroke.push(p);
    if (st.mode === "cursor") onTouchPad({ ...p, brightness: 200, size: 60 });
  });
  const up = (e) => {
    if (!stroke) return;
    stroke.push(at(e));
    if (st.mode === "cursor") onTouchPad({ ...stroke[stroke.length - 1], brightness: 0, size: 0 });
    else {
      const g = classify(stroke);
      if (g) onTouchPad({ gesture: g });
    }
    stroke = null;
  };
  pad.addEventListener("pointerup", up);
  pad.addEventListener("pointercancel", () => (stroke = null));

  setMode(mode);
  return { gesture, cursor, setMode, setCursorAvailable, get mode() { return st.mode; }, get counts() { return { ...counts }; }, get cursorAvailable() { return cursorAvailable; } };
}

/// A finger stroke as one of the nine gestures (the way the chip would see a hand).
export function classify(points) {
  if (points.length < 2) return "forward"; // a tap: the hand comes towards the sensor
  const a = points[0], z = points[points.length - 1];
  const dx = z.x - a.x, dy = z.y - a.y;
  const ms = z.t - a.t;
  const span = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
  // Wave: back and forth sideways at least three times.
  let turns = 0;
  for (let i = 2; i < points.length; i++) {
    const d1 = points[i - 1].x - points[i - 2].x, d2 = points[i].x - points[i - 1].x;
    if (Math.abs(d1) > 0.01 && Math.abs(d2) > 0.01 && Math.sign(d1) !== Math.sign(d2)) turns++;
  }
  if (turns >= 3 && span > 0.15) return "wave";
  // A circle: the stroke comes back near its start, and the turning direction decides.
  const len = points.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
  if (len > 0.6 && Math.hypot(dx, dy) < 0.2) {
    let area = 0;
    for (let i = 1; i < points.length; i++) area += points[i - 1].x * points[i].y - points[i].x * points[i - 1].y;
    return area > 0 ? "clockwise" : "anticlockwise"; // screen y points down
  }
  if (Math.hypot(dx, dy) < 0.08) return ms > 600 ? "backward" : "forward"; // held still: away; a tap: towards
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
}
