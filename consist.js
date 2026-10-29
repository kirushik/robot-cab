// The consist: everything coupled to the robot, as a train (web/depot.html §1–3).
//
// Footer: a socket for each fitted module he uses (up to three), then the empty socket, always last:
// tap it to look for modules (only with the lever at 0 and standing still: coupling happens in the
// depot, not on the main line; plugging a cable into a live I²C bus can glitch the motor driver),
// hold it to hear its name. The consist drawer shows the loco, one wagon per module in coupling
// order, an empty plug, and the depot siding: his wish tickets, unknown devices, uncoupled wagons.
//
// Wagon states: found (dashed amber, answered a scan; tap to fit), fitted (solid), active (a data
// dot while samples arrive), fault (red border, hatched, never blinking), off (dimmed; hold 1.2 s),
// ghost (dashed grey on the siding: missing from two scans), unknown («?» with its address; the cab
// files a wish by itself). Module health never goes on the status strip: those lamps are safety only.

import { gestureFace, gestureSource } from "./gesture.js";

const LOCO = "0f"; // the motor driver is the loco itself
// Devices the cab has a face for. A digital servo can't be scanned: it is born by handshake.
const KINDS = {
  "73": { kind: "gesture", icon: "m-gesture" },
  servo: { kind: "servo", icon: "m-servo", label: "SV" },
};
const MAX_SOCKETS = 3;

export function createConsist({ $, getRobot, settings, save, announce, say, fileTicket, canCouple, servo, kit, name }) {
  // One consist per robot: what is coupled to the simulator isn't coupled to the real robot (whose
  // own scan says what's there), and two real robots are told apart by name.
  settings.consists ??= {};
  if (settings.consist) { settings.consists.sim ??= settings.consist; delete settings.consist; }
  const keyOf = (robot) => (robot?.kind === "sim" ? "sim" : robot?.name || "robot");
  let C = { wagons: [], unknownFiled: [] };
  function useConsist() {
    const key = keyOf(getRobot());
    settings.consists[key] ??= { wagons: [], unknownFiled: [] };
    C = settings.consists[key];
  }
  const found = new Set(); // addresses that answered and aren't fitted yet
  const unknown = new Set(); // addresses with no template
  const faults = new Map(); // addr -> message
  const lastData = new Map(); // addr -> time of the last reading
  let source = null; // the gesture sensor's readings
  let face = null; // the gesture face's controls

  const wagon = (addr) => C.wagons.find((w) => w.addr === addr);
  const stateOf = (w) => {
    if (faults.has(w.addr)) return "fault";
    if (w.state === "off") return "off";
    if ((w.missed ?? 0) >= 2) return "ghost";
    if (performance.now() - (lastData.get(w.addr) ?? -Infinity) < 1000) return "active";
    return "fitted";
  };
  const label = (addr) => KINDS[addr]?.label ?? addr.toUpperCase();
  const icon = (addr) => KINDS[addr]?.icon ?? "m-unknown";

  // ---- the gesture sensor's face (face template: spine + 8 × 3 cells of 44 px) -----------------
  const drawer = $("gestureFace");
  const cells = drawer.querySelector(".cells");
  face = gestureFace(cells, {
    onTouchPad: (input) => getRobot()?.kind === "sim" && getRobot().gesture(input),
  });
  $("gestureMode").onclick = () => {
    face.setMode(face.mode === "gesture" ? "cursor" : "gesture");
    $("gestureMode").classList.toggle("on", face.mode === "cursor");
  };
  $("gestureClose").onclick = () => (drawer.hidden = true);

  function reading(r) {
    lastData.set("73", performance.now());
    if (r.gesture) {
      face.gesture(r.gesture);
      kit.signal("gesture.event", r.gesture);
    } else {
      face.cursor(r);
      kit.signal("gesture.brightness", Math.round(r.brightness));
      kit.signal("gesture.x", r.x);
      kit.signal("gesture.y", r.y);
    }
    paintDots();
  }
  function startSensor() {
    source?.stop();
    source = null;
    const robot = getRobot();
    const w = wagon("73");
    if (!robot || robot.state !== "connected" || !w || stateOf(w) === "off" || stateOf(w) === "ghost") return;
    source = gestureSource(robot, {
      onReading: reading,
      onFault: (message) => { faults.set("73", message); render(); },
    });
    face.setCursorAvailable(source.cursor);
  }

  // ---- opening faces ------------------------------------------------------------------------------
  function closeFaces() {
    drawer.hidden = true;
    servo.close();
    $("consist").hidden = true;
  }
  function used(addr) {
    const before = C.recent?.[0];
    C.recent = [addr, ...(C.recent ?? []).filter((a) => a !== addr)];
    if (before !== addr) queueMicrotask(render); // the footer's one socket follows what he used last
  }
  function openFace(addr) {
    used(addr);
    const w = wagon(addr);
    if (w && stateOf(w) === "fault") { announce("needsGrownup"); return; }
    for (const id of ["lightsPanel", "timetable", "consist"]) $(id).hidden = true;
    if (addr === "servo") { drawer.hidden = true; servo.open(); return; }
    servo.close();
    drawer.hidden = false;
  }
  /// The newly fitted moment: the face's cells light up one after another, then its name, once.
  function lampTest(addr) {
    openFace(addr);
    const lit = [...drawer.querySelectorAll(".spine .cellkey, .cells > *, .g-cell")];
    lit.forEach((el, i) => setTimeout(() => {
      el.classList.add("lamptest");
      setTimeout(() => el.classList.remove("lamptest"), 240);
    }, i * 60));
    setTimeout(() => say(name(KINDS[addr]?.kind ?? "wagon")), lit.length * 60 + 100);
  }

  // ---- looking for modules ------------------------------------------------------------------------
  async function scan() {
    if (!canCouple()) { announce("coupleStop"); return; }
    const robot = getRobot();
    if (!robot || robot.state !== "connected") return;
    let reply = "";
    try { reply = await robot.command("scan"); } catch { return; }
    const seen = new Set(reply.split(/\s+/).slice(1).map((a) => a.toLowerCase()).filter((a) => /^[0-7][0-9a-f]$/.test(a)));
    seen.delete(LOCO);
    for (const w of C.wagons) {
      if (w.addr === "servo") continue;
      const was = stateOf(w);
      w.missed = seen.has(w.addr) ? 0 : (w.missed ?? 0) + 1;
      if (was === "ghost" && stateOf(w) !== "ghost") startSensor(); // the same wagon wakes up
    }
    unknown.clear();
    for (const addr of seen) {
      if (wagon(addr)) continue;
      if (KINDS[addr]) found.add(addr);
      else {
        unknown.add(addr);
        if (!C.unknownFiled.includes(addr)) {
          C.unknownFiled.push(addr);
          fileTicket("wish", `new device at 0x${addr}`, []);
        }
      }
    }
    save();
    if (found.size) announce("found", { addr: [...found][0].toUpperCase() }, { number: [...found][0].toUpperCase() });
    render();
    if (!found.size && !unknown.size) announce("nothingNew");
    if (wagon("73") && stateOf(wagon("73")) === "ghost") { source?.stop(); source = null; }
  }

  function fit(addr) {
    used(addr);
    found.delete(addr);
    C.wagons.push({ addr, kind: KINDS[addr].kind, state: "fitted", missed: 0 });
    save();
    render();
    startSensor();
    lampTest(addr);
  }

  function toggleOff(addr) {
    const w = wagon(addr);
    if (!w) return;
    w.state = w.state === "off" ? "fitted" : "off";
    save();
    if (addr === "73") startSensor();
    render();
  }

  // ---- drawing ---------------------------------------------------------------------------------------
  function wagonButton(addr, state, extra = "") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `wagon ${state}${extra}`;
    b.dataset.addr = addr;
    b.dataset.name = state === "unknown" ? "unknownDevice" : `wagon-${KINDS[addr]?.kind ?? "unknown"}`;
    b.innerHTML = `<svg class="i"><use href="#${state === "unknown" ? "m-unknown" : icon(addr)}"/></svg><span class="addr">${label(addr)}</span><i class="dot"></i>`;
    return b;
  }
  function holdable(el, ms, fn) {
    let t = null;
    el.addEventListener("pointerdown", () => { t = setTimeout(() => { t = null; el.dataset.held = "1"; fn(); }, ms); });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) el.addEventListener(ev, () => clearTimeout(t));
    el.addEventListener("click", (e) => { if (el.dataset.held) { delete el.dataset.held; e.stopImmediatePropagation(); } }, true);
  }

  function render() {
    useConsist();
    const robot = getRobot();
    const online = robot?.state === "connected";
    // The servo is there when the simulator has one or a grown-up ticked it.
    const servoFitted = online && (robot.kind === "sim" || settings.servoOn);
    if (servoFitted && !wagon("servo")) C.wagons.unshift({ addr: "servo", kind: "servo", state: "fitted", missed: 0 });
    if (!servoFitted && wagon("servo")) C.wagons = C.wagons.filter((w) => w.addr !== "servo");

    // Footer sockets: fitted modules in coupling order (never re-sorted), found ones dashed.
    const sockets = $("sockets");
    const usable = online ? C.wagons.filter((w) => !["ghost"].includes(stateOf(w))) : [];
    // On a narrow phone one module gets a socket (the one he used last); the rest wait in the
    // consist, counted on the empty socket.
    const room = innerWidth < 420 ? 1 : MAX_SOCKETS;
    const rank = (w) => { const i = (C.recent ?? []).indexOf(w.addr); return i < 0 ? Infinity : i; };
    const shown = [...usable].sort((a, b) => rank(a) - rank(b) || usable.indexOf(a) - usable.indexOf(b)).slice(0, room)
      .sort((a, b) => usable.indexOf(a) - usable.indexOf(b)); // plug-in order, never re-sorted
    const nodes = shown.map((w) => {
      const st = stateOf(w);
      const b = document.createElement("button");
      b.type = "button";
      b.className = `socket ${st}`;
      b.dataset.module = w.kind;
      b.dataset.name = w.kind;
      b.setAttribute("aria-label", w.kind);
      b.innerHTML = `<svg class="i"><use href="#${icon(w.addr)}"/></svg><span class="addr">${label(w.addr)}</span><i class="dot"></i>`;
      b.onclick = () => (st === "off" ? null : openFace(w.addr));
      return b;
    });
    for (const addr of online ? found : []) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "socket found";
      b.dataset.module = KINDS[addr].kind;
      b.dataset.name = "foundModule";
      b.innerHTML = `<svg class="i"><use href="#${icon(addr)}"/></svg><span class="addr">${label(addr)}</span>`;
      b.onclick = () => fit(addr);
      nodes.push(b);
    }
    const empty = document.createElement("button");
    empty.type = "button";
    empty.className = "socket empty";
    empty.id = "emptySocket";
    empty.dataset.name = "socket";
    empty.setAttribute("aria-label", "Socket: look for modules");
    const more = usable.length - shown.length;
    empty.innerHTML = `<svg class="i"><use href="#i-plug"/></svg>${more > 0 ? `<span class="more">+${more}</span>` : ""}`;
    empty.onclick = () => { $("consist").hidden = false; servo.close(); drawer.hidden = true; scan(); };
    nodes.push(empty);
    sockets.replaceChildren(...nodes);

    // The consist drawer.
    const train = $("train");
    const loco = document.createElement("span");
    loco.className = "wagon loco";
    loco.dataset.name = "loco";
    loco.innerHTML = `<svg class="i"><use href="#i-loco"/></svg><span class="addr">0F</span>`;
    const coupled = C.wagons.filter((w) => stateOf(w) !== "ghost").map((w) => {
      const b = wagonButton(w.addr, stateOf(w));
      b.onclick = () => openFace(w.addr);
      holdable(b, 1200, () => toggleOff(w.addr));
      return b;
    });
    const waiting = [...(online ? found : [])].map((addr) => {
      const b = wagonButton(addr, "found");
      b.onclick = () => fit(addr);
      return b;
    });
    const plug = document.createElement("button");
    plug.type = "button";
    plug.className = "wagon plug";
    plug.dataset.name = "plug";
    plug.innerHTML = `<svg class="i"><use href="#i-plug"/></svg>`;
    plug.onclick = scan;
    train.replaceChildren(loco, ...coupled, ...waiting, plug);

    const siding = $("siding");
    const tickets = settings.tickets.filter((t) => t.type === "wish" && !["done", "sent-back"].includes(t.state)).map((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ticket";
      b.dataset.name = "ticket";
      b.innerHTML = `<svg class="i"><use href="#i-ticket"/></svg><b>${t.n}</b>`;
      b.onclick = () => say(`${name("ticket")} ${t.n}: ${t.text}`);
      return b;
    });
    const unknowns = [...unknown].map((addr) => wagonButton(addr, "unknown"));
    const ghosts = C.wagons.filter((w) => stateOf(w) === "ghost").map((w) => wagonButton(w.addr, "ghost"));
    siding.replaceChildren(...tickets, ...unknowns, ...ghosts);
    $("tally").textContent = String(settings.tickets.filter((t) => t.type === "wish" && !["done", "sent-back"].includes(t.state)).length || "");
  }
  // The data dots, without redrawing everything every reading.
  function paintDots() {
    for (const el of document.querySelectorAll(".socket[data-module='gesture'], .wagon[data-addr='73']")) {
      el.classList.toggle("active", performance.now() - (lastData.get("73") ?? -Infinity) < 1000);
    }
  }
  setInterval(paintDots, 500);
  addEventListener("resize", () => render());
  $("consistClose").onclick = () => ($("consist").hidden = true);

  return {
    render,
    scan,
    openFace,
    closeFaces,
    /// A (re)connect: known wagons wake up; the sensor starts reading.
    connected() { faults.clear(); found.clear(); unknown.clear(); render(); startSensor(); },
    disconnected() { source?.stop(); source = null; found.clear(); render(); },
    get face() { return face; },
    get found() { return [...found]; },
    get unknown() { return [...unknown]; },
    state(addr) { const w = wagon(addr); return w ? stateOf(w) : found.has(addr) ? "found" : unknown.has(addr) ? "unknown" : null; },
  };
}
