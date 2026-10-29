// The stop path: the one part of the cab no AI change may touch (docs/principles.md §8). His
// father changes it himself. `stop-check` (tools/stop_check.py) fails when this file, its tests
// (tools/ui_stop.py) or the firmware change without an entry in docs/stop-reviews.md.
//
// What it owns: the emergency brake, the drive keep-alive, stopping when the link is lost or the
// app goes to the background, sending the protection setting to the robot after every connect,
// and the trip latch. The rest of the cab asks for wheel speeds; this decides what is sent:
//   - lever 0 with the steering centred sends exactly 0/0;
//   - while the trip is latched, a lever above 0 sends 0/0, until the lever has been at 0;
//   - a stop (brake, link lost, background, robot switched, vigilance) sends 0/0 at once, after
//     asking the cab to put its own controls to zero.
// The robot stops by itself 500 ms after the last command (its failsafe), so the keep-alive
// resends every 100 ms while the lever or the steering is off zero, and never otherwise.

export const KEEPALIVE_MS = 100;

/// brake: the emergency brake element (it acts on touch, not on release).
/// getRobot(): the robot the cab drives now.
/// controls(): { lever, steer } as the driver (or a program) set them.
/// wanted(): [left, right] the cab would like for those controls (power mapping, caution, steering).
/// guardCm(): the protection setting, in cm (0 = off).
/// onStop(reason): the cab puts its controls to zero ("brake", "link", "background", "switch",
///   "vigilance"). Whatever it does, 0/0 is sent afterwards.
/// onGuard(ok): whether the robot took the protection setting (false: old firmware without it).
export function createStop({ brake, getRobot, controls, wanted, guardCm, onStop, onGuard }) {
  let tripped = false;
  let stopping = false; // while the cab zeroes its controls, anything it sends is 0/0
  const watched = new WeakSet();

  /// Send what the wheels may do now.
  function send() {
    const robot = getRobot();
    if (!robot || robot.state !== "connected") return;
    const { lever, steer } = controls();
    let wheels = [0, 0];
    if (!stopping && !(lever === 0 && steer === 0) && !(tripped && lever > 0)) {
      const [l, r] = wanted();
      wheels = [Number.isFinite(l) ? l : 0, Number.isFinite(r) ? r : 0];
    }
    robot.drive(wheels[0], wheels[1]);
  }

  /// Stop everything, now: the wheels first, then the cab's controls, then the wheels again (in
  /// case anything the cab did on the way sent something).
  function stop(reason) {
    tripped = false;
    stopping = true;
    getRobot()?.drive(0, 0);
    try {
      onStop(reason);
    } finally {
      stopping = false;
      getRobot()?.drive(0, 0);
    }
  }

  function forwardGuard(robot) {
    return robot.guard(guardCm()).then((ok) => { if (robot === getRobot()) onGuard(ok); return ok; }, () => { onGuard(false); return false; });
  }

  // Keep talking to the robot while something is set; it stops by itself if we go quiet.
  setInterval(() => {
    const { lever, steer } = controls();
    if (lever !== 0 || steer !== 0) send();
  }, KEEPALIVE_MS);
  brake.addEventListener("pointerdown", () => stop("brake"));
  // Phone locked or app switched: stop.
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop("background"); });

  return {
    send,
    stop,
    get tripped() { return tripped; },
    /// The robot's guard stopped it with the lever up: hold the wheels at 0 until the lever is at 0.
    trip() {
      if (tripped) return;
      tripped = true;
      send();
    },
    /// The lever has been at 0 (or a held program was resumed on a clear track).
    release() { tripped = false; },
    /// Follow a robot's link: not connected means stop; connected means the protection setting
    /// goes to the robot first thing.
    watch(robot) {
      if (watched.has(robot)) return;
      watched.add(robot);
      robot.addEventListener("state", (e) => {
        if (robot !== getRobot()) return;
        if (e.detail.state === "connected") forwardGuard(robot);
        else stop("link");
      });
    },
    /// The protection setting changed: tell the robot.
    guardChanged() {
      const robot = getRobot();
      if (robot?.state === "connected") forwardGuard(robot);
    },
  };
}
