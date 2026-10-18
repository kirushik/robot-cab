// The robot, as the app sees it. Two implementations share one small API:
//
//   BleRobot  - the real robot over Web Bluetooth (firmware/src/ble.rs, console.rs)
//   SimRobot  - a pretend robot on screen (sim.js), for playing and testing without hardware
//
// API: connect(), disconnect(), drive(left, right), lights(colors | "off"), tone(hz, ms),
//      guard(cm), command(text) -> reply.
// Events (EventTarget, detail in event.detail):
//   "state"    {state: "connected" | "connecting" | "reconnecting" | "disconnected", name}
//   "distance" {cm: number | null}        null = no echo / nothing measured
//   "buttons"  {mask}                     bit 0..3 board buttons, bit 4..5 Grove dual button
//   "driver"   {ok}                       motor driver answering on I2C
//   "guard"    {blocked, cm}              the robot's own obstacle reflex kicked in / released
//   "bump"     {}                         (pretend robot only) drove into something

// Must match firmware/src/ble.rs
const SERVICE = "c0de0001-b0b0-4a5e-8d3c-2f6a1e9b7c00";
const DRIVE = "c0de0002-b0b0-4a5e-8d3c-2f6a1e9b7c00";
const BUTTONS = "c0de0004-b0b0-4a5e-8d3c-2f6a1e9b7c00";
const MOTOR_DRIVER = "c0de0005-b0b0-4a5e-8d3c-2f6a1e9b7c00";
const UART = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const UART_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

// The robot stops by itself after 500 ms without a drive command; resend well within that.
const HEARTBEAT_MS = 100;

export const bluetoothAvailable = () => !!navigator.bluetooth;

const emit = (target, type, detail) => target.dispatchEvent(new CustomEvent(type, { detail }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, "0");
export const toHex = (rgb) => rgb.map(hex2).join("");

export class BleRobot extends EventTarget {
  kind = "ble";
  state = "disconnected";
  name = "";
  #device = null;
  #drive = null;
  #want = [0, 0];
  #sent = null;
  #writing = false;
  #heartbeat = null;
  #userClosed = false;
  #console = null;
  #pollLoop = null;

  async connect() {
    this.#userClosed = false;
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE] }],
        optionalServices: [UART],
      });
      this.#device = device;
      this.name = device.name || "Robot";
      device.addEventListener("gattserverdisconnected", () => this.#lost());
      await this.#open("connecting");
    } catch (e) {
      // Half open (connected, but a service or notification failed): let go of the link, or the
      // robot (one connection at a time, not advertising) can't be found again until a reload.
      this.#userClosed = true;
      this.#device?.gatt.disconnect();
      this.#setState("disconnected");
      throw e;
    }
  }

  async disconnect() {
    this.#userClosed = true;
    this.#want = [0, 0];
    this.#device?.gatt.disconnect();
  }

  drive(left, right) {
    const wheel = (v) => Math.max(-100, Math.min(100, Math.round(v) || 0)); // Int8Array would wrap
    this.#want = [wheel(left), wheel(right)];
    this.#pump();
  }

  lights(colors) {
    const arg = colors === "off" ? "off" : colors.map(toHex).join(" ");
    return this.command("leds " + arg).catch(() => {});
  }

  tone(hz, ms) {
    return this.command(`tone ${Math.round(hz)} ${Math.round(ms)}`).catch(() => {});
  }

  guard(cm) {
    // Older firmware has no guard; the app then falls back to its own (slower) check.
    return this.command(`guard ${Math.round(cm)}`).then(() => true, () => false);
  }

  command(text) {
    if (!this.#console) return Promise.reject(new Error("not connected"));
    return this.#console.send(text);
  }

  async #open(state) {
    this.#setState(state);
    const server = await this.#device.gatt.connect();
    const robot = await server.getPrimaryService(SERVICE);
    this.#drive = await robot.getCharacteristic(DRIVE);

    const buttons = await robot.getCharacteristic(BUTTONS);
    buttons.addEventListener("characteristicvaluechanged", (e) =>
      emit(this, "buttons", { mask: e.target.value.getUint8(0) }));
    await buttons.startNotifications();

    const driver = await robot.getCharacteristic(MOTOR_DRIVER);
    driver.addEventListener("characteristicvaluechanged", (e) =>
      emit(this, "driver", { ok: e.target.value.getUint8(0) !== 0 }));
    await driver.startNotifications();
    emit(this, "driver", { ok: (await driver.readValue()).getUint8(0) !== 0 });

    const uart = await server.getPrimaryService(UART);
    this.#console = new Console(await uart.getCharacteristic(UART_RX), await uart.getCharacteristic(UART_TX),
      (event) => this.#event(event));
    await this.#console.start();

    // Never resume old motion after (re)connecting.
    this.#want = [0, 0];
    this.#sent = null;
    clearInterval(this.#heartbeat);
    this.#heartbeat = setInterval(() => this.#pump(true), HEARTBEAT_MS);
    this.#setState("connected");
    this.#startDistance();
  }

  // Ask the robot to push distances; firmware without `sub` gets polled instead.
  async #startDistance() {
    try {
      await this.command("sub dist 100");
    } catch {
      const loop = { on: true };
      this.#pollLoop = loop;
      while (loop.on && this.state === "connected") {
        try {
          const reply = await this.command("dist");
          const value = reply.split(" ")[1];
          emit(this, "distance", { cm: value === "none" ? null : Number(value) });
        } catch {
          // keep trying while connected
        }
        await sleep(150);
      }
    }
  }

  #event(line) {
    const [what, ...rest] = line.split(" ");
    if (what === "dist" && (rest[0] === "none" || Number.isFinite(Number(rest[0])))) {
      emit(this, "distance", { cm: rest[0] === "none" ? null : Number(rest[0]) });
    }
    if (what === "guard") emit(this, "guard", { blocked: rest[0] === "stop", cm: Number(rest[1]) || null });
  }

  async #pump(heartbeat = false) {
    if (!this.#drive || this.#writing) return;
    const same = this.#sent && this.#sent[0] === this.#want[0] && this.#sent[1] === this.#want[1];
    if (same && !heartbeat) return;
    this.#writing = true;
    const value = this.#want;
    try {
      // A write that never settles (seen on some phones) must not freeze driving forever.
      await Promise.race([
        this.#drive.writeValueWithoutResponse(Int8Array.of(value[0], value[1])),
        sleep(400).then(() => { throw new Error("drive write timed out"); }),
      ]);
      this.#sent = value;
    } catch {
      this.#sent = null;
    } finally {
      this.#writing = false;
    }
    // If the wanted value changed while we were writing, send the newest one now.
    if (this.#want !== value) this.#pump();
  }

  async #lost() {
    clearInterval(this.#heartbeat);
    if (this.#pollLoop) this.#pollLoop.on = false;
    this.#console?.close();
    this.#console = null;
    this.#drive = null;
    if (this.#userClosed) {
      this.#setState("disconnected");
      return;
    }
    // Try to come back by itself (the robot may just have gone out of range for a moment).
    for (let attempt = 0; attempt < 6 && !this.#userClosed; attempt++) {
      this.#setState("reconnecting");
      await sleep(500 * 2 ** attempt);
      try {
        await this.#open("reconnecting");
        return;
      } catch {
        // try again
      }
    }
    this.#setState("disconnected");
  }

  #setState(state) {
    this.state = state;
    emit(this, "state", { state, name: this.name });
  }
}

// Text console over the Nordic UART Service: tagged commands (`#7 dist`) get tagged replies
// (`#7 dist 42`); lines starting with "!" are events the robot sends by itself.
class Console {
  #rx; #tx; #onEvent; #buffer = ""; #nextId = 1; #waiting = new Map(); #queue = Promise.resolve(); #chunk = 180;
  #listener = (e) => this.#received(e.target.value);

  constructor(rx, tx, onEvent) {
    this.#rx = rx;
    this.#tx = tx;
    this.#onEvent = onEvent;
  }

  async start() {
    this.#tx.addEventListener("characteristicvaluechanged", this.#listener);
    await this.#tx.startNotifications();
  }

  close() {
    this.#tx.removeEventListener("characteristicvaluechanged", this.#listener);
    for (const { reject } of this.#waiting.values()) reject(new Error("disconnected"));
    this.#waiting.clear();
    this.#rx = null;
  }

  #received(dataView) {
    this.#buffer += new TextDecoder().decode(dataView);
    let newline;
    while ((newline = this.#buffer.indexOf("\n")) >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.startsWith("!")) {
        this.#onEvent(line.slice(1).trim());
      } else if (line.startsWith("#")) {
        const space = line.indexOf(" ");
        this.#waiting.get(line.slice(0, space))?.resolve(line.slice(space + 1));
      }
    }
  }

  send(command) {
    const run = async () => {
      if (!this.#rx) throw new Error("not connected");
      const tag = "#" + this.#nextId++;
      let timer;
      const reply = new Promise((resolve, reject) => {
        this.#waiting.set(tag, { resolve, reject });
        timer = setTimeout(() => reject(new Error("no reply")), 5000);
      });
      reply.catch(() => {}); // if the write fails, nobody awaits the reply
      try {
        await this.#write(`${tag} ${command}\n`);
        const line = await reply;
        if (line.startsWith("err ")) throw new Error(line.slice(4));
        return line;
      } finally {
        clearTimeout(timer);
        this.#waiting.delete(tag);
      }
    };
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => {});
    return result;
  }

  async #write(text) {
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    while (offset < bytes.length) {
      const piece = bytes.slice(offset, offset + this.#chunk);
      try {
        await this.#rx.writeValueWithResponse(piece);
        offset += piece.length;
      } catch (e) {
        if (this.#chunk === 20 || piece.length <= 20) throw e;
        this.#chunk = 20; // some links only carry 20 bytes per write
      }
    }
  }
}
