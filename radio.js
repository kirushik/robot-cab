// The radio protocol between the driver and the onboard computer (docs/operating-model.md §1):
// call, message, "over", read-back. This file turns one transmission (what speech recognition
// heard while he held the microphone) into what he meant, and the cab's answer into words.
//
// Words come from all three languages at once: children mix languages, and "stop" sounds the same
// everywhere. Matching is by whole words and short phrases, ё and е alike.

// One category per phrase. Longer phrases win ("три четверти" before "три").
const WORDS = {
  stop: ["stop", "halt", "brake", "stopp", "bremse", "bremsen", "стоп", "стой", "тормоз", "хватит"],
  reverse: ["reverse", "back", "backwards", "zurück", "rückwärts", "назад"],
  quarter: ["quarter", "one quarter", "viertel", "ein viertel", "четверть", "четверти", "четвертая", "четвертую"],
  half: ["half", "halb", "halbe", "hälfte", "половина", "половину", "пол", "вторая"],
  threeQuarters: ["three quarters", "three-quarters", "dreiviertel", "drei viertel", "три четверти", "три четвертых"],
  full: ["full", "fast", "voll", "volle", "полный", "полную", "быстро", "полностью", "fully", "ganz"],
  forward: ["forward", "forwards", "ahead", "vorwärts", "los", "вперед", "поехали"],
  left: ["left", "links", "налево", "влево"],
  right: ["right", "rechts", "направо", "вправо"],
  horn: ["horn", "horns", "honk", "toot", "beep", "hupe", "hupen", "pfeife", "pfeifen", "гудок", "гудка", "гудков", "посигналь", "бибикни", "гуди"],
  again: ["еще", "снова", "again", "another", "more", "noch", "nochmal", "noch mal", "weiter"],
  times: ["раз", "раза", "times", "mal"],
  red: ["red", "rot", "красный", "красным", "красные", "красная"], green: ["green", "grün", "зеленый", "зеленым", "зеленые", "зеленая"],
  yellow: ["yellow", "gelb", "желтый", "желтым", "желтые", "желтая"], blue: ["blue", "blau", "синий", "синим", "синие", "синяя"],
  white: ["white", "weiß", "weiss", "белый", "белым", "белые", "белая"],
  dark: ["dark", "lights off", "licht aus", "dunkel", "темно", "выключи свет", "погаси"],
  program: ["program", "programme", "line", "fahrplan", "programm", "linie", "программа", "программу", "линия", "маршрут"],
  barrier: ["barrier", "gate", "boom", "servo", "schranke", "servo", "шлагбаум", "барьер", "сервопривод", "серво"],
  up: ["up", "open", "raise", "auf", "hoch", "öffnen", "вверх", "наверх", "открыть", "открой", "подними", "поднять"],
  down: ["down", "close", "lower", "zu", "runter", "schließen", "вниз", "закрыть", "закрой", "опусти", "опустить"],
  call: ["бортовой компьютер", "компьютер", "бортовой", "это машинист", "машинист", "onboard computer", "computer",
    "this is the driver", "driver here", "bordcomputer", "hier ist der lokführer", "lokführer", "hallo", "hello", "привет", "алло"],
  over: ["прием", "over", "kommen", "ende"],
  status: ["заявки", "заявок", "tickets", "wishes", "aufträge", "wünsche"],
  menu: ["что ты умеешь", "what can you do", "was kannst du"],
  // "чтобы" and the like always make a wish; "хочу" only with words beyond the protocol's
  // («Хочу полный ход!» is a command).
  wish: ["чтобы", "чтоб", "пусть", "научи", "не говори", "не надо", "не делай", "make it", "can you make", "teach", "don't",
    "mach dass", "dass"],
  want: ["хочу", "хочется", "сделай", "сделать", "i want", "i wish", "ich will", "ich möchte", "mach"],
  question: ["почему", "зачем", "как", "сколько", "когда", "где", "куда", "откуда", "а что", "что",
    "why", "what", "how", "when", "where", "warum", "wieso", "was", "wie", "wann", "wo"],
  // A report starts with who or what it's about, or with what he's doing («еду к дивану»).
  subject: ["он", "она", "оно", "они", "робот", "шлагбаум", "крыша", "мотор", "моторы", "колесо", "колеса", "я",
    "еду", "стою", "держу", "толкаю", "качу",
    "he", "she", "it", "they", "the robot", "i", "i'm", "er", "sie", "es", "der roboter", "ich", "fahre"],
  // The nouns the commands are about («полный ход», «красный свет»): understood with them.
  filler: ["ход", "ходом", "свет", "лампы", "фонари", "lights", "lamps", "licht", "lampen", "speed", "fahrt",
    "и", "а", "ну", "да", "вот", "пожалуйста", "давай", "мне", "ты", "это", "теперь", "потом", "ладно", "ок", "окей",
    "please", "the", "a", "and", "so", "now", "then", "okay", "ok", "bitte", "und", "also", "jetzt", "dann", "mal"],
};
const NUMBERS = {
  1: ["1", "one", "first", "eins", "erste", "один", "одна", "первая", "первую", "первый"],
  2: ["2", "two", "second", "zwei", "zweite", "два", "две", "вторая", "вторую", "второй"],
  3: ["3", "three", "third", "drei", "dritte", "три", "третья", "третью", "третий"],
  4: ["4", "four", "fourth", "vier", "vierte", "четыре", "четвертая", "четвертую"],
  5: ["5", "five", "fifth", "fünf", "fünfte", "пять", "пятая", "пятую"],
  6: ["6", "six", "sixth", "sechs", "sechste", "шесть", "шестая", "шестую"],
  7: ["7", "seven", "seventh", "sieben", "siebte", "семь", "седьмая", "седьмую"],
  8: ["8", "eight", "eighth", "acht", "achte", "восемь", "восьмая", "восьмую"],
};

const norm = (w) => w.toLowerCase().replace(/ё/g, "е");
// phrase (as tokens) -> categories it can be, longest first
const PHRASES = [];
for (const [cat, list] of Object.entries(WORDS)) for (const p of list) PHRASES.push({ words: norm(p).split(/[\s-]+/), cat });
for (const [n, list] of Object.entries(NUMBERS)) for (const p of list) PHRASES.push({ words: [norm(p)], cat: "number", n: Number(n) });
PHRASES.sort((a, b) => b.words.length - a.words.length);

export function tokens(text) {
  return norm(text).replace(/[.,!?;:„“"«»()]/g, " ").split(/[\s-]+/).filter(Boolean);
}

// Every word gets all the categories it can be at that place; the longest phrase wins.
function match(toks) {
  const out = [];
  for (let i = 0; i < toks.length;) {
    let best = null;
    for (const p of PHRASES) {
      if (best && p.words.length < best.len) break;
      if (p.words.every((w, k) => toks[i + k] === w)) {
        if (!best) best = { i, len: p.words.length, text: toks.slice(i, i + p.words.length).join(" "), cats: [] };
        best.cats.push(p);
      }
    }
    if (best) { out.push(best); i += best.len; }
    else { out.push({ i, len: 1, text: toks[i], cats: [] }); i += 1; }
  }
  return out;
}

/// One transmission -> { kind, commands, unknown, text }.
/// kind: "call" (only a call, «На связи»), "commands", "wish", "question", "report", "status",
/// "menu", or "none" (nothing understood). `unknown`: words that are none of the protocol's.
export function parse(text) {
  const m = match(tokens(text));
  const has = (cat) => m.some((x) => x.cats.some((c) => c.cat === cat));
  const is = (x, cat) => x.cats.some((c) => c.cat === cat);
  const used = new Set();
  const take = (x) => used.add(x);
  const hits = [];

  // A call or "over" anywhere, filler words: part of the protocol, never "not understood".
  for (const x of m) if (is(x, "call") || is(x, "over") || is(x, "filler")) take(x);

  if (has("status")) return { kind: "status", commands: [], unknown: [], text };
  if (has("menu")) return { kind: "menu", commands: [], unknown: [], text };

  if (m.some((x) => is(x, "stop"))) {
    for (const x of m) if (is(x, "stop")) take(x);
    hits.push([0, { do: "stop" }]);
  } else {
    // "Program two", "программа вторая": the number word nearest after it.
    const prog = m.findIndex((x) => is(x, "program"));
    if (prog >= 0) {
      const num = m.slice(prog + 1).find((x) => is(x, "number"));
      if (num) {
        take(m[prog]); take(num);
        hits.push([m[prog].i, { do: "program", n: num.cats.find((c) => c.cat === "number").n }]);
      }
    }
    const notchOf = (x) => (is(x, "threeQuarters") ? 0.75 : is(x, "quarter") ? 0.25 : is(x, "half") ? 0.5 : is(x, "full") ? 1 : null);
    const free = (x) => !used.has(x);
    // The barrier: up/open alone = fully, down/close alone = 0, with a fraction = that much of 90°.
    const servoAt = m.findIndex((x) => free(x) && (is(x, "barrier") || is(x, "up") || is(x, "down")));
    if (servoAt >= 0) {
      const words = m.filter((x) => free(x) && (is(x, "barrier") || is(x, "up") || is(x, "down")));
      const fracWord = m.find((x) => free(x) && notchOf(x) !== null);
      const down = words.some((x) => is(x, "down"));
      const up = words.some((x) => is(x, "up"));
      if (up || down || fracWord) {
        const value = fracWord ? notchOf(fracWord) : up ? 1 : 0;
        words.forEach(take);
        if (fracWord) take(fracWord);
        hits.push([m[servoAt].i, { do: "servo", deg: Math.round(value * 90), up: up || (!down && value > 0) }]);
      }
    }
    // One lever command at most. The notch comes from the fraction words; a reverse word only sets
    // the direction ("backwards fast" and "fast backwards" are the same thing). «Вперёд» alone = ¼.
    // ("вторая" alone, no program, is a half; "три" or "two" alone is a number, not a notch.)
    const notches = m.filter((x) => free(x) && notchOf(x) !== null);
    const back = m.filter((x) => free(x) && is(x, "reverse"));
    const ahead = m.filter((x) => free(x) && is(x, "forward"));
    const named = notches;
    if (named.length || back.length || ahead.length) {
      const value = named.length ? notchOf(named[named.length - 1]) : back.length ? 0.5 : 0.25;
      [...named, ...back, ...ahead].forEach(take);
      const where = Math.min(...[...named, ...back, ...ahead].map((x) => x.i));
      hits.push([where, { do: "throttle", value: back.length ? -value : value }]);
    }
    for (const dir of ["left", "right"]) {
      const x = m.find((y) => free(y) && is(y, dir));
      if (x) { take(x); hits.push([x.i, { do: dir }]); }
    }
    // Horns: each horn word is one, "two horns" / "horn two times" are two, and "again" after a
    // horn is one more ("гудок, ещё гудок" = two; "гудок, ещё" = two).
    let horns = 0, hornAt = null;
    m.forEach((x, k) => {
      if (!free(x) || !is(x, "horn")) return;
      take(x);
      hornAt ??= x.i;
      let n = 1;
      const before = m[k - 1], after = m[k + 1], after2 = m[k + 2];
      if (before && free(before) && is(before, "number")) { n = before.cats.find((c) => c.cat === "number").n; take(before); }
      else if (after && free(after) && is(after, "number") && after2 && is(after2, "times")) {
        n = after.cats.find((c) => c.cat === "number").n; take(after); take(after2);
      }
      horns += n;
    });
    if (horns) {
      m.forEach((x, k) => {
        if (free(x) && is(x, "again") && m.slice(0, k).some((y) => is(y, "horn")) && !(m[k + 1] && is(m[k + 1], "horn"))) { take(x); horns++; }
        else if (free(x) && is(x, "again") && m[k + 1] && is(m[k + 1], "horn")) take(x);
      });
      hits.push([hornAt, { do: "horn", n: horns }]);
    }
    for (const color of ["red", "green", "yellow", "blue", "white", "dark"]) {
      const x = m.find((y) => free(y) && is(y, color));
      if (x) { take(x); hits.push([x.i, { do: "lights", color }]); }
    }
  }
  const commands = hits.sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  const rest = m.filter((x) => !used.has(x));
  const unknown = rest.filter((x) => !["wish", "want", "question", "subject"].some((c) => is(x, c))).map((x) => x.text);
  // A stop is always done, whatever else he said: stopping is never wrong.
  // (Command words it overrides were understood, just not done: only truly unknown words are listed.)
  if (commands.some((c) => c.do === "stop")) return { kind: "commands", commands, unknown: rest.filter((x) => !x.cats.length).map((x) => x.text), text };
  // A question asks; it never moves anything («Почему гудок один раз?»).
  const first = m.find((x) => !is(x, "call") && !is(x, "over") && !is(x, "filler"));
  if ((first && is(first, "question")) || /\?\s*$/.test(text)) return { kind: "question", commands: [], unknown, text };
  // A wish asks for something the cab can't do yet.
  if (has("wish") || (has("want") && unknown.length)) return { kind: "wish", commands: [], unknown, text };
  if (commands.length) return { kind: "commands", commands, unknown, text };
  if (first && is(first, "subject")) return { kind: "report", commands: [], unknown, text };
  if (!rest.length && m.length) return { kind: "call", commands: [], unknown: [], text };
  return { kind: "none", commands: [], unknown, text };
}

/// Commands only, in spoken order: [{do:"throttle", value:0.5}, {do:"left"}, ...].
export function understand(text) {
  return parse(text).commands;
}

/// Does this transmission end with "over" («Приём») after something else? Then it's complete.
export function endsWithOver(text) {
  const m = match(tokens(text));
  return m.length > 1 && m[m.length - 1].cats.some((c) => c.cat === "over");
}

/// Only a call opener so far («Приём!» alone, at the start)? Then keep listening.
export function onlyOpener(text) {
  const m = match(tokens(text));
  return m.length > 0 && m.every((x) => x.cats.some((c) => c.cat === "over"));
}

// ---- read-back: what was done, in the same words ---------------------------------------------------

const COUNT = {
  ru: ["ноль", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять"],
  de: ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn"],
  en: ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"],
};
const count = (lang, n) => COUNT[lang][n] ?? String(n);
const COLOR = {
  ru: { red: "красный", green: "зелёный", yellow: "жёлтый", blue: "синий", white: "белый", dark: "выключен" },
  de: { red: "rot", green: "grün", yellow: "gelb", blue: "blau", white: "weiß", dark: "aus" },
  en: { red: "red", green: "green", yellow: "yellow", blue: "blue", white: "white", dark: "off" },
};
const FRACTION = {
  ru: { 0: "ноль", 0.25: "четверть", 0.5: "половина", 0.75: "три четверти", 1: "полностью" },
  de: { 0: "null", 0.25: "ein Viertel", 0.5: "halb", 0.75: "drei Viertel", 1: "ganz" },
  en: { 0: "zero", 0.25: "one quarter", 0.5: "half", 0.75: "three quarters", 1: "fully" },
};

/// One short read-back of what was done ({what, ...} entries), plus what wasn't understood.
export function readBack(lang, done, unknown = []) {
  const parts = done.map((d) => {
    switch (d.what) {
      case "stop": return { ru: "Стоп.", de: "Halt.", en: "Stop." }[lang];
      case "throttle": {
        const n = d.notch;
        const dir = d.dir < 0 ? { ru: "назад, ", de: "rückwärts, ", en: "reverse, " }[lang] : "";
        const head = { ru: `Ход — ${dir}${d.notchName}.`, de: `Fahrstufe ${dir}${d.notchName}.`, en: `Throttle ${dir}${d.notchName}.` }[lang];
        // Never quietly less than asked: say the limit that holds it back.
        const limit = d.limited ? { ru: " Ограничение — четверть.", de: " Begrenzt auf ein Viertel.", en: " Limited to one quarter." }[lang] : "";
        const latched = d.latched ? { ru: " Сначала контроллер на ноль.", de: " Erst Fahrschalter auf Null.", en: " Lever to zero first." }[lang] : "";
        return n === 0 ? { ru: "Ход — ноль.", de: "Fahrstufe null.", en: "Throttle zero." }[lang] : head + limit + latched;
      }
      case "left": return { ru: "Влево.", de: "Links.", en: "Left." }[lang];
      case "right": return { ru: "Вправо.", de: "Rechts.", en: "Right." }[lang];
      case "horn": return { ru: `Гудок — ${count(lang, d.n)}.`, de: `Hupe — ${count(lang, d.n)}.`, en: `Horn — ${count(lang, d.n)}.` }[lang];
      case "lights": return { ru: `Свет — ${COLOR.ru[d.color]}.`, de: `Licht ${COLOR.de[d.color]}.`, en: `Lamps ${COLOR.en[d.color]}.` }[lang];
      case "servo": {
        const way = d.up ? { ru: "вверх", de: "auf", en: "up" }[lang] : { ru: "вниз", de: "zu", en: "down" }[lang];
        const how = FRACTION[lang][d.deg / 90] ?? `${d.deg}°`;
        if (d.failed) return { ru: "Шлагбаум не отвечает.", de: "Schranke antwortet nicht.", en: "Barrier not answering." }[lang];
        return { ru: `Шлагбаум — ${way}, ${how}.`, de: `Schranke — ${way}, ${how}.`, en: `Barrier — ${way}, ${how}.` }[lang];
      }
      case "program": return d.missing ? { ru: `Программы ${d.n} нет.`, de: `Fahrplan ${d.n} gibt es nicht.`, en: `No program ${d.n}.` }[lang] : "";
      default: return "";
    }
  }).filter(Boolean);
  if (unknown.length) {
    const words = unknown.slice(0, 4).join(" ");
    parts.push({ ru: `„${words}“ — не понял.`, de: `„${words}“ — nicht verstanden.`, en: `"${words}" — not understood.` }[lang]);
  }
  return parts.join(" ");
}
