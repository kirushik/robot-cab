// Voice both ways, in the style of a cab radio: short announcements with real numbers.
// The robot talks with speech synthesis (every phone). It listens with speech recognition
// (Chrome; the audio goes to Google to become text, so a grown-up can switch listening off).

export const LANGS = { en: "en-US", de: "de-DE", ru: "ru-RU" };

// Fractions of full power, said the way people say them.
export const NOTCH_NAMES = {
  en: { 0: "zero", 0.25: "one quarter", 0.5: "half", 0.75: "three quarters", 1: "full" },
  de: { 0: "null", 0.25: "ein Viertel", 0.5: "halb", 0.75: "drei Viertel", 1: "voll" },
  ru: { 0: "ноль", 0.25: "четверть", 0.5: "половина", 0.75: "три четверти", 1: "полный" },
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
  servo: { en: "Barrier servo", de: "Schranke, Servo", ru: "Шлагбаум, сервопривод" },
  servoDial: { en: "Barrier: drag the boom, it moves when you let go", de: "Schranke: Baum ziehen, sie fährt beim Loslassen", ru: "Шлагбаум: тяни стрелу, поедет, когда отпустишь" },
  servoTold: { en: "Where it was told to go", de: "Wohin sie soll", ru: "Куда велели" },
  servoReal: { en: "Where it really is: nobody measures it", de: "Wo sie wirklich ist: misst keiner", ru: "Где на самом деле: никто не измеряет" },
  predStop: { en: "It stops", de: "Sie bleibt stehen", ru: "Остановится" },
  predBuzz: { en: "It pushes and buzzes", de: "Sie drückt und brummt", ru: "Будет давить и гудеть" },
  predBreak: { en: "Something breaks", de: "Etwas geht kaputt", ru: "Что-то сломается" },
  myGuess: { en: "Your guess", de: "Dein Tipp", ru: "Твой ответ" },
  // The consist and its modules (web/consist.js, gesture.js).
  socket: { en: "Socket: look for modules", de: "Steckplatz: Module suchen", ru: "Разъём: искать модули" },
  plug: { en: "Couple something here", de: "Hier etwas ankuppeln", ru: "Прицепить сюда" },
  loco: { en: "Locomotive: the motor driver, zero F", de: "Lok: der Motortreiber, null F", ru: "Локомотив: драйвер моторов, ноль F" },
  consist: { en: "The train: everything coupled", de: "Der Zug: alles angekuppelt", ru: "Состав: всё, что прицеплено" },
  siding: { en: "Depot siding", de: "Depotgleis", ru: "Депо" },
  ticket: { en: "Ticket", de: "Auftrag", ru: "Заявка" },
  foundModule: { en: "Found a module: tap to couple", de: "Modul gefunden: tippen zum Ankuppeln", ru: "Найден модуль: нажми, чтобы прицепить" },
  unknownDevice: { en: "Unknown device", de: "Unbekanntes Gerät", ru: "Неизвестное устройство" },
  wagon: { en: "Wagon", de: "Wagen", ru: "Вагон" },
  "wagon-gesture": { en: "Gesture sensor, seven three", de: "Gestensensor, sieben drei", ru: "Датчик жестов, семь три" },
  "wagon-servo": { en: "Barrier servo", de: "Schranke, Servo", ru: "Шлагбаум, сервопривод" },
  "wagon-unknown": { en: "Unknown device", de: "Unbekanntes Gerät", ru: "Неизвестное устройство" },
  gesture: { en: "Gesture sensor, seven three", de: "Gestensensor, sieben drei", ru: "Датчик жестов, семь три" },
  gestureMode: { en: "Mode: gestures or cursor", de: "Modus: Gesten oder Zeiger", ru: "Режим: жесты или курсор" },
  gestureWindow: { en: "Where the hand is", de: "Wo die Hand ist", ru: "Где рука" },
  gestureBrightness: { en: "Brightness, nought to two hundred fifty-five", de: "Helligkeit, null bis zweihundertfünfundfünfzig", ru: "Яркость, от нуля до двухсот пятидесяти пяти" },
  "g-up": { en: "Up", de: "Hoch", ru: "Вверх" },
  "g-down": { en: "Down", de: "Runter", ru: "Вниз" },
  "g-left": { en: "Left", de: "Links", ru: "Влево" },
  "g-right": { en: "Right", de: "Rechts", ru: "Вправо" },
  "g-forward": { en: "Towards the sensor", de: "Zum Sensor hin", ru: "К датчику" },
  "g-backward": { en: "Away from the sensor", de: "Vom Sensor weg", ru: "От датчика" },
  "g-clockwise": { en: "Clockwise", de: "Im Uhrzeigersinn", ru: "По часовой" },
  "g-anticlockwise": { en: "Anticlockwise", de: "Gegen den Uhrzeigersinn", ru: "Против часовой" },
  "g-wave": { en: "Wave", de: "Winken", ru: "Помахать" },
  whatHappened: { en: "What happened", de: "Was passiert ist", ru: "Что случилось" },
};

// Russian needs the right noun form after a number: 1 сантиметр, 2 сантиметра, 5 сантиметров.
function ruPlural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const zero = {
  en: (v) => (v.zero ? " Lever to zero." : ""), de: (v) => (v.zero ? " Fahrschalter auf Null." : ""), ru: (v) => (v.zero ? " Контроллер на ноль." : ""),
};

// Announcements. Functions get the values to speak; the icon is what the screen shows.
export const LINES = {
  ready:    { icon: "i-signal", en: (v) => `Robot ${v.name} ready.`, de: (v) => `Roboter ${v.name} bereit.`, ru: (v) => `Робот ${v.name} готов.` },
  sim:      { icon: "i-grid", en: "Simulator ready.", de: "Simulator bereit.", ru: "Симулятор готов." },
  // A guard stop says only what a fresh reading backs (principles §3); `zero` adds what to do next,
  // the first time it latches the lever.
  obstacle: { icon: "i-buffer", en: (v) => `Obstacle, ${v.cm} centimetres. Braking.${zero.en(v)}`, de: (v) => `Hindernis, ${v.cm} Zentimeter. Bremsung.${zero.de(v)}`,
              ru: (v) => `Препятствие, ${v.cm} ${ruPlural(v.cm, "сантиметр", "сантиметра", "сантиметров")}. Торможение.${zero.ru(v)}` },
  noEcho:   { icon: "i-buffer", en: (v) => `No echo. Stop.${zero.en(v)}`, de: (v) => `Kein Echo. Halt.${zero.de(v)}`, ru: (v) => `Нет эха. Стоп.${zero.ru(v)}` },
  guardStop:{ icon: "i-buffer", en: (v) => `Protection. Stop.${zero.en(v)}`, de: (v) => `Schutz. Halt.${zero.de(v)}`, ru: (v) => `Защита. Стоп.${zero.ru(v)}` },
  noEchoSlow:{ icon: "i-signal", en: "No echo. Slow, one quarter.", de: "Kein Echo. Langsam, ein Viertel.", ru: "Нет эха. Медленно, четверть." },
  clear:    { icon: "i-signal", en: "Track clear.", de: "Strecke frei.", ru: "Путь свободен." },
  clearZero:{ icon: "i-lever", en: "Track clear. Lever to zero.", de: "Strecke frei. Fahrschalter auf Null.", ru: "Путь свободен. Контроллер на ноль." },
  leverZero:{ icon: "i-lever", en: "Lever to zero first.", de: "Erst Fahrschalter auf Null.", ru: "Сначала контроллер на ноль." },
  neutral:  { icon: "i-reverser", en: "Direction switch is in neutral.", de: "Richtungsschalter steht auf Null.", ru: "Реверсор в нуле." },
  forward:  { icon: "i-reverser", en: "Forward.", de: "Vorwärts.", ru: "Вперёд." },
  reverse:  { icon: "i-reverser", en: "Reverse. No obstacle protection behind.", de: "Rückwärts. Hinten kein Hindernisschutz.", ru: "Назад. Сзади нет защиты." },
  caution:  { icon: "i-signal", en: "Caution. Slow, one quarter.", de: "Langsamfahrt, ein Viertel.", ru: "Внимание. Медленно, четверть." },
  sifaSoon: { icon: "i-pedal", en: "", de: "", ru: "" },
  throttle: { icon: "i-lever", en: (v) => `Throttle ${v.notch}.`, de: (v) => `Fahrstufe ${v.notch}.`, ru: (v) => `Ход — ${v.notch}.` },
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
  // The radio protocol (docs/operating-model.md §1).
  repeat:   { icon: "i-mic", en: "Not understood. Say again.", de: "Nicht verstanden. Wiederholen.", ru: "Не понял. Повторите." },
  vocab:    { icon: "i-mic", en: "I know: half, stop, left, horn, red, barrier up, program two.", de: "Ich kenne: halb, stopp, links, Hupe, rot, Schranke auf, Fahrplan zwei.",
              ru: "Я знаю: половина, стоп, налево, гудок, красный, шлагбаум вверх, программа два." },
  onAir:    { icon: "i-mic", en: "On the air.", de: "Auf Empfang.", ru: "На связи." },
  roger:    { icon: "i-mic", en: "Roger.", de: "Verstanden.", ru: "Принял." },
  wishFiled:{ icon: "i-ticket", en: (v) => `Received. Ticket ${v.n}.`, de: (v) => `Angenommen. Auftrag ${v.n}.`, ru: (v) => `Принято. Заявка ${v.n}.` },
  questionFiled: { icon: "i-ticket", en: (v) => `Question received, number ${v.n}.`, de: (v) => `Frage angenommen, Nummer ${v.n}.`, ru: (v) => `Вопрос принят, номер ${v.n}.` },
  cutOff:   { icon: "i-mic", en: "Cut off. Say the last part again?", de: "Abgerissen. Das Letzte wiederholen?", ru: "Обрыв. Повторить последнее?" },
  noLamps:  { icon: "i-lamp", en: "No lamp stick is fitted: the robot's lamps stay dark.", de: "Keine Lampenleiste angebaut: die Lampen am Roboter bleiben dunkel.",
              ru: "Фонари на роботе не подключены: они не загорятся." },
  coupleStop:{ icon: "i-plug", en: "Coupling only at a standstill.", de: "Ankuppeln nur im Stand.", ru: "Сцепка — только на стоянке." },
  found:    { icon: "i-plug", en: (v) => `Module found: ${v.addr}.`, de: (v) => `Modul gefunden: ${v.addr}.`, ru: (v) => `Найден модуль: ${v.addr}.` },
  nothingNew:{ icon: "i-plug", en: "No new modules.", de: "Keine neuen Module.", ru: "Новых модулей нет." },
  needsGrownup:{ icon: "i-plug", en: "Needs a grown-up.", de: "Braucht einen Erwachsenen.", ru: "Нужен взрослый." },
  noTickets:{ icon: "i-ticket", en: "No open tickets.", de: "Keine offenen Aufträge.", ru: "Заявок нет." },
  said:     { icon: "i-mic", en: (v) => v.text, de: (v) => v.text, ru: (v) => v.text },
  noEars:   { icon: "i-mic", en: "Microphone not allowed.", de: "Mikrofon nicht erlaubt.", ru: "Микрофон запрещён." },
  offline:  { icon: "i-mic", en: "Speech recognition needs the internet.", de: "Spracherkennung braucht Internet.", ru: "Распознаванию речи нужен интернет." },
  noBt:     { icon: "i-signal", en: "This browser has no Bluetooth. Use Chrome.", de: "Dieser Browser hat kein Bluetooth. Nimm Chrome.", ru: "В этом браузере нет Bluetooth. Нужен Chrome." },
  lights:   { icon: "i-lamp", en: "Lights.", de: "Licht.", ru: "Свет." },
  dark:     { icon: "i-lamp", en: "Lights off.", de: "Licht aus.", ru: "Свет выключен." },
};

// Lines about safety: spoken in full, an ordinary line waits until they're done.
const SAFETY = new Set(["obstacle", "noEcho", "guardStop", "noEchoSlow", "clearZero", "leverZero", "reverse", "caution", "sifa", "sifaBrake", "ebrake", "bump", "lost", "noMotors"]);

// Voice commands are parsed in radio.js (the radio protocol).
export { understand } from "./radio.js";

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

  /// Start listening, continuously, until stop() or `maxMs`. `onCapture` fires when the microphone
  /// is really capturing (that's when the start beep belongs), `onText(text, final)` on every result.
  /// Returns { stop(), result: Promise<{ text, alternatives: string[], captured, ended, error? }> }:
  /// `ended` is "stopped" (by us), "cap" (time limit) or "self" (the recogniser gave up on its own:
  /// a cut-off, the cab's fault, not his); error is "denied", "offline" or "broken".
  listen({ maxMs = 20000, onCapture = () => {}, onText = () => {} } = {}) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let rec = null;
    let ended = "self";
    const result = new Promise((resolve) => {
      if (!Recognition) return resolve({ text: "", alternatives: [], captured: false, ended: "self", error: "broken" });
      rec = new Recognition();
      rec.lang = LANGS[this.lang];
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 4;
      const finals = []; // per result: its alternatives
      let interim = "";
      let error;
      let captured = false;
      const capture = () => { if (!captured) { captured = true; onCapture(); } };
      const best = () => [...finals.filter(Boolean).map((f) => f[0]), interim].filter(Boolean).join(" ").trim();
      // Whole-transmission alternatives: the best of every result, with the last one varied.
      const alternatives = () => {
        const done = finals.filter(Boolean);
        if (!done.length) return interim ? [interim] : [];
        const head = done.slice(0, -1).map((f) => f[0]);
        return done[done.length - 1].map((alt) => [...head, alt, interim].filter(Boolean).join(" ").trim());
      };
      rec.onaudiostart = capture;
      rec.onresult = (e) => {
        capture(); // a result means it heard something, even if audiostart never came
        interim = "";
        let final = false;
        for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {
          const r = e.results[i];
          const alts = [...r].map((alt) => alt.transcript.trim());
          if (r.isFinal === false) interim = alts[0];
          else { finals[i] = alts; final = true; }
        }
        onText(best(), final);
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") error = "denied";
        else if (e.error === "network") error = "offline";
        else if (e.error !== "no-speech" && e.error !== "aborted") error = "broken";
      };
      const finish = () => resolve({ text: best(), alternatives: alternatives(), captured, ended, error });
      rec.onend = finish;
      setTimeout(() => { if (ended === "self") ended = "cap"; try { rec.stop(); } catch { /* already stopped */ } }, maxMs);
      // A recogniser that never ends gives up with what it has.
      setTimeout(finish, maxMs + 2500);
      try { rec.start(); } catch { resolve({ text: "", alternatives: [], captured: false, ended: "self", error: "broken" }); }
    });
    return { result, stop: () => { if (ended === "self") ended = "stopped"; try { rec?.stop(); } catch { /* fine */ } } };
  }
}
