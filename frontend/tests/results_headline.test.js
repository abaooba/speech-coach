// Tests for the Results headline (DESIGN.md sections 6 and 8; queue feature T21): the pure
// headlineFor(summary, previousSummary) picks one strength and one focus, first match wins,
// with the same thresholds as the cards, and show() draws them in section.headline right after
// the meta line. The pure half loads delivery.js and results.js with no document and a stub
// app.ui; the DOM half adds the real ui.js and the shared fake DOM.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const UI_SOURCE = read("ui.js");
const DELIVERY_SOURCE = read("delivery.js");
const RESULTS_SOURCE = read(path.join("screens", "results.js"));
const TIPS_SOURCE = read("tips.js");
const CSS = read("styles.css");

const CLIP_WORDS = JSON.parse(
  fs.readFileSync(
    path.join(FRONTEND_DIR, "..", "backend", "tests", "fixtures", "test_clip_assemblyai.json"),
    "utf8",
  ),
).words;
const CLIP_METRICS = {
  words_per_minute: 93.2,
  duration: 30.908,
  word_count: 48,
  pauses: [
    [14.567, 1.531],
    [16.853, 2.474],
    [20.517, 2.185],
  ],
  fillers: { um: 6, uh: 3, hmm: 0, like: 1, "you know": 0, so: 2, basically: 1, actually: 0 },
  repeats: [{ text: "and I", at: 16.515 }],
  pace_windows: [],
};

// Gettysburg is 130 to 150 wpm; the drill band 100 to 130 suits the generated takes below.
const PASSAGES = [
  { id: "gettysburg", targetWpm: [130, 150] },
  { id: "drill", targetWpm: [100, 130] },
];

function bareApp() {
  return {
    screens: {},
    passages: PASSAGES.map((entry) => ({ ...entry, targetWpm: [...entry.targetWpm] })),
    ui: {},
    store: {},
    router: {},
  };
}

function loadPure() {
  const context = { app: bareApp() };
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  return context.app.screens.results;
}

// A take saved without words: the backend tallies decide every number. `fillers` is per
// minute over a one-minute take, `pauses` is how many pauses the backend found.
function tallies({ wpm = 140, fillers = 0, pauses = 0, passageId = "gettysburg" } = {}) {
  return {
    id: "t",
    createdAt: "2026-10-09T10:00:00.000Z",
    passageId,
    passageTitle: "Tallies",
    durationSeconds: 60,
    metrics: {
      words_per_minute: wpm,
      duration: 60,
      word_count: wpm,
      fillers: { um: fillers },
      pauses: Array.from({ length: pauses }, (_, k) => [10 + 10 * k, 2]),
      repeats: [],
      pace_windows: [],
    },
    transcript: [],
  };
}

// A take with words: `count` back-to-back half-second words, "um" at the indexes in `umAt`,
// so it lasts count / 2 seconds and its fillers per minute are ums over that time.
function spoken(count, umAt, passageId = "drill") {
  const ums = new Set(umAt);
  return {
    id: "w",
    createdAt: "2026-10-09T11:00:00.000Z",
    passageId,
    passageTitle: "Spoken",
    durationSeconds: count / 2,
    metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [] },
    transcript: Array.from({ length: count }, (_, index) => ({
      text: ums.has(index) ? "um" : "word",
      start: index * 0.5,
      end: (index + 1) * 0.5,
    })),
  };
}

function spread(count, every) {
  return Array.from({ length: count }, (_, k) => k * every + 1);
}

const CLIP = {
  id: "clip",
  createdAt: "2026-10-10T15:30:00Z",
  passageId: "gettysburg",
  passageTitle: "Gettysburg Address, opening",
  durationSeconds: 33.1,
  metrics: CLIP_METRICS,
  transcript: CLIP_WORDS,
};

function headline(session, previous) {
  const results = loadPure();
  const summary = results.summarize(session);
  const previousSummary = previous ? results.summarize(previous) : null;
  return { ...results.headlineFor(summary, previousSummary) };
}

function wordCount(sentence) {
  return sentence.trim().split(/\s+/).length;
}

test("results.js exports headlineFor beside summarize", () => {
  assert.equal(typeof loadPure().headlineFor, "function");
});

test("the real clip: its clean stretch is the strength, fillers are the focus", () => {
  assert.deepEqual(headline(CLIP, null), {
    strength: "Your longest clean stretch is 4.9 seconds.",
    focus: "Next take, cut fillers under 3 a minute.",
  });
});

test("a drop of 0.5 fillers a minute or more against a take with words leads", () => {
  assert.deepEqual(headline(spoken(600, spread(9, 60)), spoken(600, spread(21, 25))), {
    strength: "Fillers are down from 4.2 to 1.8 a minute.",
    focus: "Next take, hold this delivery on a longer topic.",
  });
  assert.equal(
    headline(spoken(240, spread(5, 40)), spoken(120, spread(3, 30))).strength,
    "Fillers are down from 3 to 2.5 a minute.",
    "exactly 0.5 counts",
  );
});

test("a fillers drop under 0.5, a rise or a missing previous take does not lead", () => {
  const drop04 = headline(spoken(600, spread(13, 40), "gettysburg"), spoken(120, spread(3, 30)));
  assert.equal(drop04.strength, "Your fillers are under 3 a minute.", "3 to 2.6 is 0.4");
  const rise = headline(spoken(120, spread(3, 30)), spoken(240, spread(5, 40)));
  assert.equal(rise.strength, "Your pace is inside the 100 to 130 target.");
  assert.equal(
    headline(spoken(120, spread(3, 30)), null).strength,
    "Your pace is inside the 100 to 130 target.",
  );
});

test("a fillers drop counts with or without words, as the Fillers card does", () => {
  const withWords = spoken(120, spread(2, 50));
  const previousWithout = tallies({ wpm: 120, fillers: 6, passageId: "drill" });
  assert.equal(
    headline(withWords, previousWithout).strength,
    "Fillers are down from 6 to 2 a minute.",
    "a previous take without words is scored from the backend tallies",
  );
  const currentWithout = tallies({ wpm: 120, fillers: 2, passageId: "drill" });
  assert.equal(
    headline(currentWithout, spoken(120, spread(6, 15))).strength,
    "Fillers are down from 6 to 2 a minute.",
  );
});

test("the headline and the Fillers card's delta agree when the last take has no words", () => {
  const results = loadPure();
  const current = results.summarize(spoken(600, spread(9, 60)));
  const previous = results.summarize(tallies({ wpm: 120, fillers: 6, passageId: "drill" }));
  const fillersDelta = results.compareWithPrevious(current, previous)[1];
  assert.deepEqual({ ...fillersDelta }, { direction: "down", text: "4.2 fewer" });
  assert.equal(
    results.headlineFor(current, previous).strength,
    "Fillers are down from 6 to 1.8 a minute.",
  );
});

test("pace inside the band is the next strength, band ends included", () => {
  for (const wpm of [130, 140, 150, 150.4]) {
    assert.equal(
      headline(tallies({ wpm })).strength,
      "Your pace is inside the 130 to 150 target.",
      String(wpm),
    );
  }
  assert.equal(headline(tallies({ wpm: 150.6 })).strength, "Your fillers are under 3 a minute.");
});

test("then fillers at 3 or under, then no mid-sentence pause, then the chart", () => {
  assert.deepEqual(headline(tallies({ wpm: 120, fillers: 3 })), {
    strength: "Your fillers are under 3 a minute.",
    focus: "Next take, lift your pace toward 130 to 150 wpm.",
  });
  assert.deepEqual(headline(tallies({ wpm: 120, fillers: 6 })), {
    strength: "No pause breaks a sentence.",
    focus: "Next take, cut fillers under 3 a minute.",
  });
  assert.deepEqual(headline(tallies({ wpm: 120, fillers: 6, pauses: 1 })), {
    strength: "This take is on your progress chart.",
    focus: "Next take, cut fillers under 3 a minute.",
  });
});

test("the focus follows the cards: fillers, then pace, then pauses", () => {
  assert.equal(
    headline(tallies({ wpm: 162, fillers: 3.1 })).focus,
    "Next take, cut fillers under 3 a minute.",
  );
  assert.equal(
    headline(tallies({ wpm: 162, fillers: 3 })).focus,
    "Next take, slow toward 130 to 150 wpm.",
  );
  assert.equal(
    headline(tallies({ wpm: 151 })).focus,
    "Next take, slow toward 130 to 150 wpm.",
  );
  assert.equal(
    headline(tallies({ wpm: 129 })).focus,
    "Next take, lift your pace toward 130 to 150 wpm.",
  );
  assert.deepEqual(headline(tallies({ wpm: 140, pauses: 2 })), {
    strength: "Your pace is inside the 130 to 150 target.",
    focus: "Next take, save pauses for the ends of sentences.",
  });
});

test("at the band's ends the focus holds, as the strength and the Pace card do", () => {
  // 130 and 150 are inside the 130 to 150 band, and 150.4 shows as 150 on the card.
  for (const wpm of [130, 150, 150.4]) {
    assert.equal(
      headline(tallies({ wpm })).focus,
      "Next take, hold this delivery on a longer topic.",
      String(wpm),
    );
  }
});

test("a clean stretch under 15 seconds has room to grow; 15 or more holds", () => {
  assert.deepEqual(headline(spoken(40, [20])), {
    strength: "Your pace is inside the 100 to 130 target.",
    focus: "Next take, stretch your clean run past 10 seconds.",
  });
  assert.equal(
    headline(spoken(120, [])).focus,
    "Next take, hold this delivery on a longer topic.",
    "a clean minute",
  );
  assert.equal(
    headline(spoken(29, [])).focus,
    "Next take, stretch your clean run past 14.5 seconds.",
  );
  assert.equal(
    headline(spoken(30, [])).focus,
    "Next take, hold this delivery on a longer topic.",
    "exactly 15 seconds",
  );
  assert.equal(
    headline(tallies({ wpm: 140 })).focus,
    "Next take, hold this delivery on a longer topic.",
    "without words there is no clean stretch to beat",
  );
});

test("a clean take's tip gives no advice the headline's focus could contradict", () => {
  // The pace tips wait until 15 wpm past the band, while the focus starts at its ends: a take
  // just outside the band gets a pace focus and the clean tip together (review code-5).
  const context = { app: bareApp() };
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(TIPS_SOURCE, context, { filename: "tips.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  const { results } = context.app.screens;
  const cases = [
    [120, "Next take, lift your pace toward 130 to 150 wpm."],
    [140, "Next take, hold this delivery on a longer topic."],
    [160, "Next take, slow toward 130 to 150 wpm."],
  ];
  for (const [wpm, focus] of cases) {
    const summary = results.summarize(tallies({ wpm }));
    assert.equal(results.headlineFor(summary, null).focus, focus);
    const tips = context.app.tips.select(summary.report, { targetWpm: summary.target });
    assert.deepEqual(
      Array.from(tips, (tip) => tip.id),
      ["clean"],
      String(wpm),
    );
    assert.doesNotMatch(tips[0].text, /\bnext\b|pace|faster|slower|speed|push/i, String(wpm));
  }
});

test("one second reads as a second, not seconds", () => {
  const session = spoken(4, [2]);
  session.passageId = "fast";
  const results = loadPure();
  const summary = results.summarize(session);
  summary.wpm = 300;
  summary.fillersPerMinute = 9;
  summary.pauseCount = 1;
  summary.cleanStretchSeconds = 1;
  assert.equal(
    results.headlineFor(summary, null).strength,
    "Your longest clean stretch is 1 second.",
  );
});

test("every headline sentence is short, calm and fully filled in", () => {
  const cases = [
    [CLIP, null],
    [spoken(600, spread(9, 60)), spoken(600, spread(21, 25))],
    [spoken(40, [20]), null],
    [spoken(120, []), null],
    [tallies({ wpm: 120, fillers: 3 }), null],
    [tallies({ wpm: 120, fillers: 6 }), null],
    [tallies({ wpm: 120, fillers: 6, pauses: 1 }), null],
    [tallies({ wpm: 162 }), null],
    [tallies({ wpm: 140, pauses: 2 }), null],
    [tallies({ wpm: 140 }), tallies({ wpm: 120 })],
  ];
  for (const [session, previous] of cases) {
    const { strength, focus } = headline(session, previous);
    for (const sentence of [strength, focus]) {
      assert.equal(typeof sentence, "string");
      assert.ok(wordCount(sentence) < 15, sentence);
      assert.ok(!sentence.includes("!"), sentence);
      assert.ok(!/undefined|NaN|null/.test(sentence), sentence);
      assert.match(sentence, /^[A-Z].*\.$/, sentence);
    }
  }
});

// The DOM half: show() against the fake document. With `earlier` sessions the store can list,
// so the headline can compare with the last of them.
async function showHeadline(session, earlier) {
  const store = { get: () => Promise.resolve(session) };
  if (earlier) {
    store.list = () => Promise.resolve([session, ...earlier]);
  }
  const context = {
    app: {
      screens: {},
      passages: PASSAGES.map((entry) => ({ ...entry })),
      store,
      router: { go() {} },
    },
    document: fakeDocument(),
  };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  await context.app.screens.results.show({ id: session.id });
  return body;
}

test("show() draws section.headline right after the meta line", async () => {
  const body = await showHeadline(CLIP);
  const [meta, section] = body.children;
  assert.equal(meta.className, "results__meta num");
  assert.equal(section.tagName, "section");
  assert.equal(section.className, "headline");
  const [strength, focus] = section.children;
  assert.equal(section.children.length, 2);
  assert.deepEqual(
    [strength.tagName, strength.className, strength.textContent],
    ["p", "headline__strength", "Your longest clean stretch is 4.9 seconds."],
  );
  assert.deepEqual(
    [focus.tagName, focus.className, focus.textContent],
    ["p", "headline__focus", "Next take, cut fillers under 3 a minute."],
  );
});

test("each headline line ends with its icon: a check, then an arrow", async () => {
  const body = await showHeadline(CLIP);
  const [strength, focus] = byClass(body, "headline").children;
  for (const [line, name] of [
    [strength, "check"],
    [focus, "arrow-right"],
  ]) {
    assert.equal(line.children.length, 1);
    const [icon] = line.children;
    assert.equal(icon.tagName, "svg");
    assert.equal(icon.getAttribute("data-icon"), name);
    assert.equal(icon.getAttribute("aria-hidden"), "true");
  }
});

// The text of each drawn headline line, strength first.
async function drawnHeadline(session, earlier) {
  const body = await showHeadline(session, earlier);
  return byClass(body, "headline").children.map((line) => line.textContent);
}

test("the take's band never splits across lines; other numbers wrap as usual", async () => {
  // As in the Pace hint, the spaces around the band's "to" do not break once drawn, so a
  // narrow screen breaks "slow toward / 130 to 150 wpm", never "130 to / 150". headlineFor
  // itself keeps plain spaces.
  assert.deepEqual(await drawnHeadline(tallies({ wpm: 140, pauses: 2 })), [
    "Your pace is inside the 130 to 150 target.",
    "Next take, save pauses for the ends of sentences.",
  ]);
  const previous = { ...tallies({ wpm: 165, fillers: 4 }), id: "p" };
  previous.createdAt = "2026-10-08T10:00:00.000Z";
  assert.deepEqual(await drawnHeadline(tallies({ wpm: 165, fillers: 1 }), [previous]), [
    "Fillers are down from 4 to 1 a minute.",
    "Next take, slow toward 130 to 150 wpm.",
  ]);
  assert.equal(
    (await drawnHeadline(tallies({ wpm: 120, fillers: 3 })))[1],
    "Next take, lift your pace toward 130 to 150 wpm.",
  );
  assert.equal(headline(tallies({ wpm: 165 })).focus, "Next take, slow toward 130 to 150 wpm.");
});

// Every declaration styles.css gives this selector, later rules winning as in the cascade.
// The headline rules sit outside any @-rule, so a flat scan is enough here.
function rule(selector) {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations = {};
  let found = false;
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((part) => part.replace(/\s+/g, " ").trim());
    if (selectors.includes(selector)) {
      found = true;
      match[2].split(";").forEach((part) => {
        const colon = part.indexOf(":");
        if (colon !== -1) {
          declarations[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
        }
      });
    }
  }
  assert.ok(found, `styles.css needs a rule for ${selector}`);
  return declarations;
}

test("the headline is a bordered surface card with a bold strength and colored icons", () => {
  const card = rule(".headline");
  assert.equal(card.background, "var(--surface)");
  assert.equal(card.border, "1px solid var(--border)");
  assert.equal(card["border-radius"], "var(--r-card)");
  assert.equal(card.padding, "var(--s-4)");
  assert.equal(rule(".headline__strength")["font-weight"], "600");
  assert.equal(rule(".headline__strength")["font-size"], "var(--fs-body)");
  assert.equal(rule(".headline__focus")["font-size"], "var(--fs-body)");
  assert.equal(rule(".headline__strength svg").order, "-1");
  assert.equal(rule(".headline__focus svg").order, "-1");
  assert.equal(rule(".headline__strength svg").color, "var(--ok)");
  assert.equal(rule(".headline__focus svg").color, "var(--accent)");
});
