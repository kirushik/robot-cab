// Voice both ways, in the style of a cab radio: short announcements with real numbers.
// The robot talks with speech synthesis (every phone). It listens with speech recognition
// (Chrome; the audio goes to Google to become text, so a grown-up can switch listening off).

export const LANGS = { en: "en-US", de: "de-DE", ru: "ru-RU" };

// Fractions of full power, said the way people say them.
export const NOTCH_NAMES = {
  en: { 0: "zero", 0.25: "one quarter", 0.5: "half", 0.75: "three quarters", 1: "full" },
  de: { 0: "null", 0.25: "ein Viertel", 0.5: "halb", 0.75: "drei Viertel", 1: "voll" },
  ru: { 0: "ноль", 0.25: "четверть", 0.5: "половина", 0.75: "три четверти", 1: "полный ход" },
};

// What every control is called, for "hold it to hear its name".
export const NAMES = {
  lever: { en: "Throttle", de: "Fahrschalter", ru: "Контроллер" },
  reverser: { en: "Direction: forward, neutral, reverse", de: "Richtungsschalter: vorwärts, null, rückwärts", ru: "Реверсор: вперёд, ноль, назад" },
  steer: { en: "Steering", de: "Lenkung", ru: "Руль" },
  horn: { en: "Horn", de: "Pfeife", ru: "Гудок" },
  lamps: { en: "Lamps", de: "Lampen", ru: "Фонари" },
  sifa: { en: "Vigilance button", de: "Sifa-Taste", ru: "Кнопка бдительности" },
  ebrake: { en: "Emergency brake", de: "Notbremse", ru: "Экстренный тормоз" },
  rec: { en: "Record a program", de: "Fahrplan aufnehmen", ru: "Записать программу" },
  mic: { en: "Voice command: hold and speak", de: "Sprachbefehl: halten und sprechen", ru: "Голосовая команда: держи и говори" },
  lampLink: { en: "Connection", de: "Verbindung", ru: "Связь" },
  lampAtp: { en: "Obstacle protection", de: "Hindernisschutz", ru: "Защита от препятствий" },
  lampSifa: { en: "Vigilance", de: "Sifa", ru: "Бдительность" },
  lampMotor: { en: "Motors", de: "Motoren", ru: "Моторы" },
  signal: { en: "Signal", de: "Signal", ru: "Светофор" },
  edit: { en: "Edit the floor", de: "Boden bearbeiten", ru: "Редактировать пол" },
  robot: { en: "Real robot", de: "Echter Roboter", ru: "Настоящий робот" },
  sim: { en: "Simulator", de: "Simulator", ru: "Симулятор" },
  program: { en: "Program", de: "Fahrplan", ru: "Программа" },
  play: { en: "Run", de: "Abfahrt", ru: "Пуск" },
  step: { en: "One step", de: "Ein Schritt", ru: "Один шаг" },
};

// Russian needs the right noun form after a number: 1 сантиметр, 2 сантиметра, 5 сантиметров.
function ruPlural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// Announcements. Functions get the values to speak; the icon is what the screen shows.
export const LINES = {
  ready:    { icon: "i-signal", en: (v) => `Robot ${v.name} ready.`, de: (v) => `Roboter ${v.name} bereit.`, ru: (v) => `Робот ${v.name} готов.` },
  sim:      { icon: "i-grid", en: "Simulator ready.", de: "Simulator bereit.", ru: "Симулятор готов." },
  obstacle: { icon: "i-buffer", en: (v) => `Obstacle, ${v.cm} centimetres. Braking.`, de: (v) => `Hindernis, ${v.cm} Zentimeter. Bremsung.`,
              ru: (v) => `Препятствие, ${v.cm} ${ruPlural(v.cm, "сантиметр", "сантиметра", "сантиметров")}. Торможение.` },
  clear:    { icon: "i-signal", en: "Track clear.", de: "Strecke frei.", ru: "Путь свободен." },
  clearZero:{ icon: "i-lever", en: "Track clear. Lever to zero.", de: "Strecke frei. Fahrschalter auf Null.", ru: "Путь свободен. Контроллер на ноль." },
  leverZero:{ icon: "i-lever", en: "Lever to zero first.", de: "Erst Fahrschalter auf Null.", ru: "Сначала контроллер на ноль." },
  neutral:  { icon: "i-reverser", en: "Direction switch is in neutral.", de: "Richtungsschalter steht auf Null.", ru: "Реверсор в нуле." },
  forward:  { icon: "i-reverser", en: "Forward.", de: "Vorwärts.", ru: "Вперёд." },
  reverse:  { icon: "i-reverser", en: "Reverse. No obstacle protection behind.", de: "Rückwärts. Hinten kein Hindernisschutz.", ru: "Назад. Сзади нет защиты." },
  caution:  { icon: "i-signal", en: "Caution. Slow, one quarter.", de: "Langsamfahrt, ein Viertel.", ru: "Внимание. Медленно, четверть." },
  sifaSoon: { icon: "i-pedal", en: "", de: "", ru: "" },
  throttle: { icon: "i-lever", en: (v) => `Throttle ${v.notch}.`, de: (v) => `Fahrstufe ${v.notch}.`, ru: (v) => `Ход: ${v.notch}.` },
  sifa:     { icon: "i-pedal", en: "Vigilance check!", de: "Sifa!", ru: "Проверка бдительности!" },
  sifaBrake:{ icon: "i-brake", en: "No response. Emergency brake.", de: "Keine Reaktion. Zwangsbremsung.", ru: "Нет ответа. Экстренное торможение." },
  ebrake:   { icon: "i-brake", en: "Emergency brake!", de: "Notbremse!", ru: "Экстренное торможение!" },
  bump:     { icon: "i-brake", en: "Collision!", de: "Kollision!", ru: "Столкновение!" },
  button:   { icon: "i-button", en: (v) => `Button ${v.n}.`, de: (v) => `Taste ${v.n}.`, ru: (v) => `Кнопка ${v.n}.` },
  lost:     { icon: "i-signal", en: "Connection lost.", de: "Verbindung verloren.", ru: "Связь потеряна." },
  back:     { icon: "i-signal", en: "Connection restored.", de: "Verbindung wieder da.", ru: "Связь восстановлена." },
  bye:      { icon: "i-signal", en: "Robot off.", de: "Roboter aus.", ru: "Робот выключен." },
  noMotors: { icon: "i-signal", en: "Motor driver not responding.", de: "Motortreiber antwortet nicht.", ru: "Драйвер моторов не отвечает." },
  recording:{ icon: "i-rec", en: "Recording.", de: "Aufnahme.", ru: "Запись." },
  saved:    { icon: "i-rec", en: (v) => `Program ${v.n} saved: ${v.k} steps.`, de: (v) => `Fahrplan ${v.n} gespeichert: ${v.k} Schritte.`,
              ru: (v) => `Программа ${v.n} записана: ${v.k} ${ruPlural(v.k, "шаг", "шага", "шагов")}.` },
  empty:    { icon: "i-rec", en: "Nothing recorded.", de: "Nichts aufgenommen.", ru: "Ничего не записано." },
  depart:   { icon: "i-play", en: (v) => `Program ${v.n}. Departure!`, de: (v) => `Fahrplan ${v.n}. Abfahrt!`, ru: (v) => `Программа ${v.n}. Отправление!` },
  arrived:  { icon: "i-play", en: "Arrived.", de: "Angekommen.", ru: "Прибыли." },
  repeat:   { icon: "i-mic", en: "Say again?", de: "Bitte wiederholen.", ru: "Повторите, пожалуйста." },
  vocab:    { icon: "i-mic", en: "Try: half, stop, left, horn, red.", de: "Sag: halb, stopp, links, Hupe, rot.", ru: "Скажи: половина, стоп, налево, гудок, красный." },
  noEars:   { icon: "i-mic", en: "Microphone not allowed.", de: "Mikrofon nicht erlaubt.", ru: "Микрофон запрещён." },
  offline:  { icon: "i-mic", en: "Speech recognition needs the internet.", de: "Spracherkennung braucht Internet.", ru: "Распознаванию речи нужен интернет." },
  noBt:     { icon: "i-signal", en: "This browser has no Bluetooth. Use Chrome.", de: "Dieser Browser hat kein Bluetooth. Nimm Chrome.", ru: "В этом браузере нет Bluetooth. Нужен Chrome." },
  lights:   { icon: "i-lamp", en: "Lights.", de: "Licht.", ru: "Свет." },
  dark:     { icon: "i-lamp", en: "Lights off.", de: "Licht aus.", ru: "Свет выключен." },
};

// Lines about safety: spoken in full, an ordinary line waits until they're done.
const SAFETY = new Set(["obstacle", "clearZero", "leverZero", "reverse", "caution", "sifa", "sifaBrake", "ebrake", "bump", "lost", "noMotors"]);

// Voice commands: words in all three languages at once (children mix languages, and
// "stop" sounds the same everywhere). Short words that hide in other phrases are left out.
const WORDS = {
  stop: ["stop", "halt", "brake", "stopp", "bremse", "bremsen", "стоп", "стой", "тормоз", "хватит"],
  reverse: ["reverse", "back", "backwards", "zurück", "rückwärts", "назад"],
  quarter: ["quarter", "viertel", "четверть", "четверти", "четвёртая", "четвертая"],
  half: ["half", "halb", "halbe", "hälfte", "половина", "половину", "пол", "вторая"],
  threeQuarters: ["three quarters", "three-quarters", "dreiviertel", "три четверти", "три четвёртых"],
  full: ["full", "fast", "voll", "volle", "полный", "полную", "быстро"],
  forward: ["forward", "forwards", "ahead", "vorwärts", "los", "вперёд", "вперед", "поехали"],
  left: ["left", "links", "налево", "влево"],
  right: ["right", "rechts", "направо", "вправо"],
  horn: ["horn", "honk", "toot", "beep", "hupe", "hupen", "pfeife", "pfeifen", "гудок", "посигналь", "бибикни", "гуди"],
  red: ["red", "rot", "красный", "красным"], green: ["green", "grün", "зелёный", "зеленый", "зелёным", "зеленым"],
  yellow: ["yellow", "gelb", "жёлтый", "желтый", "жёлтым", "желтым"], blue: ["blue", "blau", "синий", "синим"],
  white: ["white", "weiß", "weiss", "белый", "белым"], dark: ["dark", "lights off", "licht aus", "dunkel", "темно", "выключи свет", "погаси"],
  program: ["program", "programme", "line", "fahrplan", "programm", "linie", "программа", "программу", "линия", "маршрут"],
};
const NUMBERS = {
  1: ["1", "one", "first", "eins", "erste", "один", "одна", "первая", "первую", "первый"],
  2: ["2", "two", "second", "zwei", "zweite", "два", "две", "вторая", "вторую", "второй"],
  3: ["3", "three", "third", "drei", "dritte", "три", "третья", "третью", "третий"],
  4: ["4", "four", "fourth", "vier", "vierte", "четыре", "четвёртая", "четвертая", "четвёртую", "четвертую"],
  5: ["5", "five", "fifth", "fünf", "fünfte", "пять", "пятая", "пятую"],
  6: ["6", "six", "sixth", "sechs", "sechste", "шесть", "шестая", "шестую"],
  7: ["7", "seven", "seventh", "sieben", "siebte", "семь", "седьмая", "седьмую"],
  8: ["8", "eight", "eighth", "acht", "achte", "восемь", "восьмая", "восьмую"],
};

/// Turn a heard sentence into commands, in spoken order: [{do:"throttle", value:0.5}, {do:"left"}, ...].
export function understand(text) {
  let lower = ` ${text.toLowerCase().replace(/[.,!?;:]/g, " ").replace(/\s+/g, " ")} `;
  const at = (word) => { const i = lower.indexOf(` ${word} `); return i < 0 ? Infinity : i; };
  const first = (list) => Math.min(...list.map(at));
  const hits = [];
  const add = (cmd, list) => { const i = first(list); if (i !== Infinity) hits.push([i, cmd]); };

  if (first(WORDS.stop) !== Infinity) return [{ do: "stop" }];
  // "Program two", "программа вторая": the number word nearest after it. That word is then blanked
  // out, so "вторая" (also "one half") or "четвёртая" doesn't move the lever as well.
  const progAt = first(WORDS.program);
  if (progAt !== Infinity) {
    let best = null;
    for (const [n, list] of Object.entries(NUMBERS)) {
      for (const w of list) {
        const i = lower.indexOf(` ${w} `, progAt);
        if (i >= 0 && (!best || i < best.i)) best = { i, w, n: Number(n) };
      }
    }
    if (best) {
      hits.push([progAt, { do: "program", n: best.n }]);
      lower = lower.slice(0, best.i + 1) + "_".repeat(best.w.length) + lower.slice(best.i + 1 + best.w.length);
    }
  }
  // One lever command at most. The notch comes from the fraction words; a reverse word only sets the
  // direction ("backwards fast" and "fast backwards" are the same thing).
  const notches = [];
  const tq = first(WORDS.threeQuarters);
  if (tq !== Infinity) notches.push([tq, 0.75]);
  else notches.push([first(WORDS.quarter), 0.25], [first(WORDS.half), 0.5]);
  notches.push([first(WORDS.full), 1]);
  const named = notches.filter(([i]) => i !== Infinity).sort((a, b) => a[0] - b[0]);
  const back = first(WORDS.reverse);
  const ahead = first(WORDS.forward);
  if (named.length || back !== Infinity || ahead !== Infinity) {
    const value = named.length ? named[named.length - 1][1] : back !== Infinity ? 0.5 : 0.25;
    const where = Math.min(back, ahead, ...named.map(([i]) => i));
    hits.push([where, { do: "throttle", value: back !== Infinity ? -value : value }]);
  }
  add({ do: "left" }, WORDS.left);
  add({ do: "right" }, WORDS.right);
  add({ do: "horn" }, WORDS.horn);
  for (const color of ["red", "green", "yellow", "blue", "white", "dark"]) add({ do: "lights", color }, WORDS[color]);
  return hits.sort((a, b) => a[0] - b[0]).map(([, c]) => c);
}

export class Voice {
  lang = "en";
  enabled = true;
  onTalking = () => {};
  #voices = [];
  #safetyTalking = null;

  constructor() {
    if ("speechSynthesis" in window) {
      const load = () => (this.#voices = speechSynthesis.getVoices());
      load();
      speechSynthesis.addEventListener?.("voiceschanged", load);
    }
  }

  get canListen() {
    return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
  }

  get hasVoiceForLang() {
    return this.#voices.some((v) => v.lang?.startsWith(this.lang));
  }

  notch(value) {
    return NOTCH_NAMES[this.lang]?.[value] ?? String(value);
  }

  text(key, values = {}) {
    const line = LINES[key];
    if (!line) return key;
    const t = line[this.lang] ?? line.en;
    return typeof t === "function" ? t(values) : t;
  }

  name(key) {
    const n = NAMES[key];
    return n ? n[this.lang] ?? n.en : key;
  }

  /// Announce a line (by key, with values) and resolve when it's done.
  say(key, values = {}, { interrupt = true, raw = false } = {}) {
    const text = raw ? key : this.text(key, values);
    if (!text || !this.enabled || !("speechSynthesis" in window)) return Promise.resolve(text);
    // A safety line is never cut off by an ordinary one (that waits its turn instead).
    const safety = !raw && SAFETY.has(key);
    if (interrupt && (safety || !this.#safetyTalking)) speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (safety) {
      this.#safetyTalking = utterance;
      const over = () => { if (this.#safetyTalking === utterance) this.#safetyTalking = null; };
      utterance.addEventListener("end", over);
      utterance.addEventListener("error", over);
      setTimeout(over, 700 + text.length * 80);
    }
    utterance.lang = LANGS[this.lang];
    const voices = this.#voices.filter((v) => v.lang?.startsWith(this.lang));
    utterance.voice = voices.find((v) => v.localService) ?? voices[0] ?? null;
    utterance.rate = 1.0;
    return new Promise((resolve) => {
      const done = () => { this.onTalking(false); resolve(text); };
      utterance.onstart = () => this.onTalking(true);
      utterance.onend = done;
      utterance.onerror = done;
      speechSynthesis.speak(utterance);
      setTimeout(done, 700 + text.length * 80); // some phones never fire onend
    });
  }

  /// Start listening. Returns { stop(), result: Promise<{alternatives: string[], error?: "denied"|"offline"|"broken"}> }.
  listen({ maxMs = 6000 } = {}) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let rec = null;
    const result = new Promise((resolve) => {
      if (!Recognition) return resolve({ alternatives: [], error: "broken" });
      rec = new Recognition();
      rec.lang = LANGS[this.lang];
      rec.interimResults = false;
      rec.maxAlternatives = 4;
      let alternatives = [];
      let error;
      rec.onresult = (e) => (alternatives = [...e.results[0]].map((alt) => alt.transcript));
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") error = "denied";
        else if (e.error === "network") error = "offline";
        else if (e.error !== "no-speech" && e.error !== "aborted") error = "broken";
      };
      rec.onend = () => resolve({ alternatives, error });
      // Time's up: stop, and let the sentence still being recognised arrive (onend resolves). Only if
      // the recogniser never ends does it give up with what it has.
      setTimeout(() => { try { rec.stop(); } catch { /* already stopped */ } }, maxMs);
      setTimeout(() => resolve({ alternatives, error }), maxMs + 2500);
      try { rec.start(); } catch { resolve({ alternatives: [], error: "broken" }); }
    });
    return { result, stop: () => { try { rec?.stop(); } catch { /* fine */ } } };
  }
}
