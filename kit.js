// The kit: runs the cab's modules (web/modules/*.js, contract in web/depot.html §7), each in its own
// sandboxed Worker (modules/sandbox.js). It delivers only the signals a module declared in `needs`,
// executes only the outputs it declared in `outputs`, and parks a module that throws three times:
// it stops, its outputs go dark, and the cab carries on.
//
// What a module can never reach: the robot object, the stop path (brake, keep-alive, latch), the
// alarm tones, storage, the page. Motion is an output like any other ("lever", "steer"): it moves
// the cab's own controls, so he sees what drives, and the stop path still decides what the wheels
// get. After any stop (brake, link lost, vigilance…) a module may not move the controls again until
// the driver has touched them himself.

const PARK_AFTER = 3;
const SIGNAL_MIN_MS = 100; // at most 10 updates a second per signal
const HORN_MIN_MS = 2000;
const SAY_MIN_MS = 2000;
export const SIGNALS = ["distance", "blocked", "tripped", "throttle", "dir", "speed", "buttons",
  "gesture.event", "gesture.brightness", "gesture.x", "gesture.y"];
export const OUTPUTS = ["lamps", "horn", "say", "lever", "steer"];

/// outputs: { lamps(colors|null), horn(), say(text), lever(notch), steer(s) } — the cab's own actions.
/// onChange(): the list of modules or a state changed.
export function createKit({ outputs, onChange = () => {}, now = () => performance.now() }) {
  const modules = new Map(); // id -> entry
  let motionHeld = false; // after a stop, until the driver touches a control
  const last = new Map(); // signal -> { value, at, timer }

  function deliver(entry, name, value) {
    if (entry.state !== "active" || !entry.manifest.needs.includes(name)) return;
    entry.worker.postMessage({ type: "signal", name, value });
  }

  function park(entry, why) {
    if (entry.state === "parked") return;
    entry.state = "parked";
    entry.why = why;
    entry.worker.terminate();
    // Its outputs go dark: lamps it lit go off, controls it moved go back to zero.
    if (entry.usedLamps) outputs.lamps(null);
    if (entry.usedMotion) { outputs.lever(0); outputs.steer(0); }
    onChange();
  }

  function onMessage(entry, msg) {
    if (!msg || typeof msg !== "object" || entry.state === "parked") return;
    if (msg.type === "manifest") {
      const m = msg.manifest;
      entry.manifest = {
        ...m,
        needs: m.needs.filter((s) => SIGNALS.includes(s)),
        outputs: m.outputs.filter((o) => OUTPUTS.includes(o)),
      };
      entry.state = "active";
      entry.resolve(entry);
      for (const name of entry.manifest.needs) if (last.has(name)) deliver(entry, name, last.get(name).value);
      onChange();
    } else if (msg.type === "error") {
      entry.errors.push(msg.message);
      if (msg.fatal) { entry.state = "parked"; entry.why = msg.message; entry.worker.terminate(); entry.reject(new Error(msg.message)); onChange(); return; }
      if (entry.errors.length >= PARK_AFTER) park(entry, "threw three times");
    } else if (msg.type === "out") {
      // Only what it declared; anything else is ignored, whatever it sends.
      if (!entry.manifest?.outputs.includes(msg.name) || !Array.isArray(msg.args)) return;
      run(entry, msg.name, msg.args);
    } else if (msg.type === "say") {
      if (now() - (entry.saidAt ?? -Infinity) < SAY_MIN_MS) return;
      entry.saidAt = now();
      outputs.say(String(msg.text).slice(0, 120)); // an ordinary line: safety lines always go first
    } else if (msg.type === "store") {
      entry.store = msg.store;
      entry.onStore?.(msg.store);
    }
  }

  function run(entry, name, args) {
    const [a] = args;
    if (name === "lamps") {
      const valid = a === null || (Array.isArray(a) && a.length <= 10 && a.every((c) => c === null || (Array.isArray(c) && c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255))));
      if (!valid) return;
      entry.usedLamps = true;
      outputs.lamps(a);
    } else if (name === "horn") {
      if (now() - (entry.hornAt ?? -Infinity) < HORN_MIN_MS) return;
      entry.hornAt = now();
      outputs.horn();
    } else if (name === "say") {
      onMessage(entry, { type: "say", text: a });
    } else if (name === "lever") {
      if (motionHeld || ![0, 0.25, 0.5, 0.75, 1].includes(a)) return;
      entry.usedMotion = true;
      outputs.lever(a);
    } else if (name === "steer") {
      if (motionHeld || !Number.isFinite(a)) return;
      entry.usedMotion = true;
      outputs.steer(Math.max(-1, Math.min(1, a)));
    }
  }

  return {
    /// Start a module from its URL. Resolves with its entry once it has mounted.
    load(url, { store = {} } = {}) {
      return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("modules/sandbox.js?v=64575a2", import.meta.url), { type: "module" });
        const entry = { url, worker, state: "loading", errors: [], manifest: null, store, resolve, reject };
        worker.onmessage = (e) => onMessage(entry, e.data);
        worker.onerror = (e) => { e.preventDefault(); onMessage(entry, { type: "error", message: e.message || "worker failed" }); };
        modules.set(url, entry);
        worker.postMessage({ type: "load", url: new URL(url, location.href).href, store });
      });
    },
    unload(url) {
      const entry = modules.get(url);
      if (!entry) return;
      entry.worker.terminate();
      modules.delete(url);
      onChange();
    },
    /// The cab's state changed: tell the modules that asked for it (at most 10 times a second).
    signal(name, value) {
      if (!SIGNALS.includes(name)) return;
      const prev = last.get(name);
      const isEvent = name === "gesture.event"; // every gesture counts, the same one twice too
      if (prev && Object.is(prev.value, value) && !isEvent) return;
      const t = now();
      const entry = { value, at: t, timer: prev?.timer ?? null };
      last.set(name, entry);
      const send = () => { entry.timer = null; entry.at = now(); for (const m of modules.values()) deliver(m, name, entry.value); };
      if (!prev || t - prev.at >= SIGNAL_MIN_MS || isEvent) { clearTimeout(prev?.timer); send(); }
      else if (!entry.timer) entry.timer = setTimeout(send, SIGNAL_MIN_MS - (t - prev.at));
    },
    knob(url, name, value) {
      modules.get(url)?.worker.postMessage({ type: "knob", name, value });
    },
    /// The stop path stopped everything: no module moves the controls until the driver does.
    stopped() { motionHeld = true; },
    /// The driver touched a control himself.
    driverTouched() { motionHeld = false; },
    get motionHeld() { return motionHeld; },
    get list() { return [...modules.values()]; },
  };
}
