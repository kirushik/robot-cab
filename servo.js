// The servo face: a level-crossing barrier (or a coupler) on a hobby servo.
//
// A hobby servo says nothing back: no position, no load. So the boom is drawn as what it is: the
// position he asked for (dashed, while it isn't sent yet), the position it was told (hollow), and
// the real position as «—», until something measures it (a current sensor or a feedback servo).
// After a reconnect nobody knows anything: both read «—» until his first command.
//
// The end stop is a foreseeable risk: the first time he uses the servo in its current build, the
// cab asks one prediction question in pictures (at the end stop it will… stop / push and buzz /
// break) and says one short sentence. Answering never sends the command: the command goes after a
// fixed beat whether or not he answered, so he can't think his guess made it happen. What happened
// is filled in by whoever saw it, him («машинист») or his father («Папа»), next to his prediction,
// never marked right or wrong. The servo holds a stalled position for as long as the command
// stands: his father's call (docs/principles.md).

const BEAT_MS = 3000;
const NOTCHES = [0, 0.25, 0.5, 0.75, 1];
const RISK = "servo:endstop";
const OUTCOMES = ["stop", "buzz", "break"];

const WARNING = {
  en: "If it hits something, it keeps pushing.",
  de: "Stößt sie an, drückt sie weiter.",
  ru: "Если упрётся, будет давить.",
};

export function createServo({ $, getRobot, say, settings, save, frac, onSent = () => {}, onChange = () => {} }) {
  const face = $("servoFace");
  const st = {
    cmd: null, // degrees it was told, or null (never told since connecting)
    req: null, // degrees he asked for, not sent yet
    pending: null, // { deg, timer, resolve }
    event: null, // { deg, prediction, outcomes: [{ what, source }] } for the last command that ran into the risk
    fault: false,
  };

  const build = () => settings.builds?.servo ?? 1;
  const armed = () => (settings.warned?.[RISK] ?? 0) !== build();

  // ---- drawing --------------------------------------------------------------------------------
  const arcPoint = (deg, r) => {
    const a = Math.PI * (1 - deg / 90);
    return [60 + Math.cos(a) * r, 64 - Math.sin(a) * r];
  };
  const ticks = face.querySelector(".ticks");
  for (const v of NOTCHES) {
    const [x1, y1] = arcPoint(v * 90, 46), [x2, y2] = arcPoint(v * 90, 52), [tx, ty] = arcPoint(v * 90, 36);
    ticks.insertAdjacentHTML("beforeend", `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><text x="${tx}" y="${ty + 4}">${{ 0: "0", 0.25: "¼", 0.5: "½", 0.75: "¾", 1: "1" }[v]}</text>`);
  }
  const boom = (el, deg) => {
    el.toggleAttribute("hidden", deg === null); // SVG elements have no .hidden property
    if (deg !== null) {
      const [x, y] = arcPoint(deg, 50);
      el.setAttribute("x2", x); el.setAttribute("y2", y);
    }
  };
  const label = (deg) => (deg === null ? "—" : `${frac(Math.round((deg / 90) * 4) / 4)} ${Math.round(deg)}°`);

  function render() {
    boom($("servoReqBoom"), st.req);
    boom($("servoCmdBoom"), st.cmd);
    boom($("servoCmdHollow"), st.cmd);
    $("servoCmd").innerHTML = label(st.cmd);
    $("servoReal").textContent = "—"; // nothing measures it on this robot
    $("servoReqBox").hidden = st.req === null;
    $("servoReq").innerHTML = label(st.req);
    face.querySelectorAll("[data-deg]").forEach((b) => {
      b.classList.toggle("active", st.cmd !== null && Math.abs(Number(b.dataset.deg) - st.cmd) < 1);
      b.classList.toggle("req", st.req !== null && Math.abs(Number(b.dataset.deg) - st.req) < 1);
    });
    $("predict").hidden = !st.pending?.asking;
    const ev = st.event;
    $("happened").hidden = !ev || !!st.pending?.asking;
    if (ev) {
      $("myGuess").replaceChildren(...(ev.prediction ? [picture(ev.prediction)] : [dash()]));
      const seen = ev.outcomes.length ? ev.outcomes.map((o) => picture(o.what, o.source)) : [dash()];
      $("whatHappened").replaceChildren(...seen);
      face.querySelectorAll("[data-report]").forEach((b) => b.classList.toggle("active", ev.outcomes.some((o) => o.what === b.dataset.report && o.source === "driver")));
    }
    document.querySelector('.socket[data-module="servo"]')?.classList.toggle("fault", st.fault);
    onChange(st);
  }
  function picture(what, source) {
    const span = document.createElement("span");
    span.className = "pic" + (source ? ` reported ${source}` : "");
    span.innerHTML = `<svg class="i"><use href="#p-${what}"/></svg>` + (source ? `<svg class="i src"><use href="#src-${source}"/></svg>` : "");
    return span;
  }
  function dash() {
    return Object.assign(document.createElement("b"), { textContent: "—", className: "dash" });
  }

  // ---- commands -------------------------------------------------------------------------------
  async function send(deg) {
    const robot = getRobot();
    let ok = false;
    try { ok = robot?.state === "connected" && typeof robot.servo === "function" && (await robot.servo(deg)) !== false; } catch { ok = false; }
    st.fault = !ok;
    if (ok) st.cmd = deg;
    st.req = null;
    render();
    return ok;
  }

  /// Point the barrier to `deg`. At the first use per build the prediction question comes first,
  /// and the command goes after the fixed beat whatever he answers. Resolves when it was sent.
  function command(deg, { voice = false } = {}) {
    deg = Math.max(0, Math.min(90, Math.round(deg)));
    if (st.pending) { clearTimeout(st.pending.timer); st.pending.resolve(false); st.pending = null; }
    st.req = deg;
    if (!armed()) {
      render();
      return send(deg).then((ok) => { if (!voice) onSent(deg, ok); return ok; });
    }
    settings.warned = { ...(settings.warned ?? {}), [RISK]: build() };
    save();
    open();
    st.event = { deg, prediction: null, outcomes: [] };
    return new Promise((resolve) => {
      st.pending = { deg, asking: true, resolve };
      st.pending.timer = setTimeout(async () => {
        st.pending = null;
        const ok = await send(deg);
        if (!voice) onSent(deg, ok);
        resolve(ok);
      }, BEAT_MS);
      render();
      say(WARNING[settings.lang] ?? WARNING.en);
    });
  }

  // ---- the face -------------------------------------------------------------------------------
  function open() {
    face.hidden = false;
    for (const id of ["lightsPanel", "timetable"]) { const el = $(id); if (el) el.hidden = true; }
    render();
    sayPapa();
  }
  function close() { face.hidden = true; }
  $("servoClose").onclick = close;
  face.querySelectorAll("[data-deg]").forEach((b) => (b.onclick = () => command(Number(b.dataset.deg))));
  // His prediction: stored, shown later beside what happened. It never sends anything.
  face.querySelectorAll("[data-answer]").forEach((b) => (b.onclick = () => {
    if (!st.event) return;
    st.event.prediction = b.dataset.answer;
    if (st.pending) st.pending.asking = false;
    render();
  }));
  // What happened, as he saw it.
  face.querySelectorAll("[data-report]").forEach((b) => (b.onclick = () => report(b.dataset.report, "driver")));

  // Dragging the boom asks for a position (dashed); it's sent when the finger lifts.
  const dial = face.querySelector(".servo-dial");
  let dragging = false;
  const degAt = (e) => {
    const r = dial.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 120 - 60, y = 64 - ((e.clientY - r.top) / r.height) * 74;
    const a = Math.atan2(Math.max(0, y), x); // 0 (right) .. π (left)
    const v = 1 - a / Math.PI;
    return NOTCHES.reduce((best, n) => (Math.abs(n - v) < Math.abs(best - v) ? n : best), 0) * 90;
  };
  dial.addEventListener("pointerdown", (e) => { dragging = true; dial.setPointerCapture(e.pointerId); st.req = degAt(e); render(); });
  dial.addEventListener("pointermove", (e) => { if (dragging) { st.req = degAt(e); render(); } });
  dial.addEventListener("pointerup", (e) => { if (!dragging) return; dragging = false; command(degAt(e)); });
  dial.addEventListener("pointercancel", () => { dragging = false; st.req = null; render(); });

  /// Someone saw what happened: "driver" (him) or "papa" (an operator report). Drawn as reported.
  function report(what, source) {
    if (!OUTCOMES.includes(what)) return;
    st.event ??= { deg: st.cmd, prediction: null, outcomes: [] };
    const ev = st.event;
    const i = ev.outcomes.findIndex((o) => o.what === what && o.source === source);
    if (i >= 0 && source === "driver") ev.outcomes.splice(i, 1); // his own tap toggles
    else if (i < 0) ev.outcomes.push({ what, source, at: Date.now() });
    // His father's report is said once, the next time the face is open (operating model §3).
    if (source === "papa") { st.papaSaid = false; if (!face.hidden) sayPapa(); }
    render();
  }
  const PAPA = {
    stop: { en: "Papa says: it stopped.", de: "Papa sagt: sie blieb stehen.", ru: "Папа говорит: остановился." },
    buzz: { en: "Papa says: it pushed and buzzed.", de: "Papa sagt: sie hat gedrückt und gebrummt.", ru: "Папа говорит: давил и гудел." },
    break: { en: "Papa says: something broke.", de: "Papa sagt: etwas ist kaputt.", ru: "Папа говорит: что-то сломалось." },
  };
  function sayPapa() {
    const last = st.event?.outcomes.filter((o) => o.source === "papa").pop();
    if (!last || st.papaSaid) return;
    st.papaSaid = true;
    say(PAPA[last.what][settings.lang] ?? PAPA[last.what].en);
  }

  /// A new link: nobody knows where the boom is or what it was told.
  function reset() {
    if (st.pending) { clearTimeout(st.pending.timer); st.pending.resolve(false); st.pending = null; }
    st.cmd = null;
    st.req = null;
    st.fault = false;
    render();
  }

  /// The servo was re-fitted or rebuilt: its warning comes again at the next first use.
  function refitted() {
    settings.builds = { ...(settings.builds ?? {}), servo: build() + 1 };
    save();
  }

  render();
  return { command, report, reset, refitted, open, close, get state() { return st; } };
}
