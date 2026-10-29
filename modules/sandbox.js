// The sandbox every module runs in: a dedicated Worker per module (web/kit.js starts it with
// `?module=<url>`). A Worker has no page, no DOM and no localStorage; this also takes away the
// network, IndexedDB, caches and broadcast channels before the module's code is loaded, so the only
// way out is a message to the kit, which delivers only declared signals and executes only declared
// outputs (web/depot.html §7). The robot object, the stop path and the alarm tones live in the page,
// out of reach.

const BLOCKED = ["fetch", "XMLHttpRequest", "WebSocket", "WebTransport", "EventSource", "indexedDB", "caches",
  "BroadcastChannel", "SharedWorker", "Worker", "importScripts", "RTCPeerConnection", "FileSystemHandle"];
for (const name of BLOCKED) {
  try { Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false }); } catch { /* not there */ }
}
for (const name of ["storage", "locks", "serviceWorker", "usb", "serial", "hid", "bluetooth"]) {
  try { Object.defineProperty(navigator, name, { value: undefined, configurable: false }); } catch { /* not there */ }
}

const send = (msg) => postMessage(msg);
const handlers = new Map(); // signal -> [fn]
const values = {}; // latest value of every delivered signal
let store = {};
let knobs = {};

function guard(fn, where) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (e) {
      send({ type: "error", where, message: String(e?.message ?? e) });
    }
  };
}
self.addEventListener("error", (e) => { send({ type: "error", where: "worker", message: String(e.message) }); e.preventDefault(); });
self.addEventListener("unhandledrejection", (e) => { send({ type: "error", where: "promise", message: String(e.reason?.message ?? e.reason) }); e.preventDefault(); });

async function load(url) {
  const mod = (await import(url)).default;
  if (!mod || typeof mod !== "object" || typeof mod.id !== "string" || typeof mod.mount !== "function") {
    throw new Error("a module exports default { id, mount(ctx), ... }");
  }
  const needs = Array.isArray(mod.needs) ? mod.needs.map(String) : [];
  const outputs = Array.isArray(mod.outputs) ? mod.outputs.map(String) : [];
  knobs = Object.fromEntries(Object.entries(mod.knobs ?? {}).map(([k, v]) => [k, Number(v?.value) || 0]));
  send({
    type: "manifest",
    manifest: {
      id: mod.id, version: Number(mod.version) || 1, wish: mod.wish ?? null, plate: mod.plate ?? null,
      needs, outputs, knobs: mod.knobs ?? {},
    },
  });
  // ctx: exactly what the manifest declared.
  const out = {};
  for (const name of outputs) out[name] = (...args) => send({ type: "out", name, args: JSON.parse(JSON.stringify(args)) });
  const ctx = Object.freeze({
    on: (signal, fn) => {
      if (!needs.includes(signal)) throw new Error(`"${signal}" isn't in needs`);
      handlers.set(signal, [...(handlers.get(signal) ?? []), guard(fn, signal)]);
    },
    get: (signal) => values[signal],
    out: Object.freeze(out),
    say: (line) => send({ type: "say", text: String(line).slice(0, 120) }),
    knob: (name) => knobs[name],
    store: Object.freeze({ get: (k) => store[k], set: (k, v) => { store[k] = v; send({ type: "store", store }); } }),
  });
  guard(() => mod.mount(ctx), "mount")();
}

self.onmessage = (e) => {
  const msg = e.data ?? {};
  if (msg.type === "load") {
    store = msg.store ?? {};
    load(msg.url).catch((err) => send({ type: "error", where: "load", message: String(err?.message ?? err), fatal: true }));
  } else if (msg.type === "signal") {
    values[msg.name] = msg.value;
    for (const fn of handlers.get(msg.name) ?? []) fn(msg.value);
  } else if (msg.type === "knob") {
    knobs[msg.name] = msg.value;
  }
};
