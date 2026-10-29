// One wish, one file, run in a Worker by web/kit.js (contract: web/depot.html §7).
// The gesture sensor's raw brightness (0–255, not centimetres) above a knob lights the lamps blue.

const BLUE = [74, 144, 217];

export default {
  id: "near-lamps",
  version: 1,
  wish: { n: 7, text: "lamps blue when my hand is close", lang: "en" },
  plate: { icon: "m-gesture", addr: "73", name: { en: "Hand lamps", de: "Handlicht", ru: "Свет от руки" } },
  needs: ["gesture.brightness"],
  outputs: ["lamps"],
  knobs: { near: { value: 180, min: 50, max: 255, step: 10, unit: "" } },
  mount(ctx) {
    let lit = null;
    ctx.on("gesture.brightness", (b) => {
      const on = b > ctx.knob("near");
      if (on === lit) return;
      lit = on;
      ctx.out.lamps(on ? Array(10).fill(BLUE) : null);
    });
  },
  demo: () => [{ "gesture.brightness": 60 }, { "gesture.brightness": 210 }, { "gesture.brightness": 90 }],
};
