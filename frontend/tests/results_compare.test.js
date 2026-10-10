// Tests for the "vs last take" lines on the Results cards (DESIGN.md sections 6 and 8; queue
// feature T22). The pure compareWithPrevious(summary, previousSummary) returns one
// {direction, text} per card, rounded to the card's precision, or null; show() finds the take
// saved just before this one through app.store.list() and draws a delta line on each card that
// can be compared, plus one note under the grid. Stores without list(), or ones that fail, mean
// no comparison and never an error.
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
const CSS = read("styles.css");

const PASSAGES = [{ id: "gettysburg", targetWpm: [130, 150] }];

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

// Objects built inside the vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// A take saved without words, ten minutes long, so `fillers` ums make fillers / 10 a minute.
function tallies(id, createdAt, { wpm = 140, fillers = 0, pauses = 0 } = {}) {
  return {
    id,
    createdAt,
    passageId: "gettysburg",
    passageTitle: "Gettysburg Address, opening",
    durationSeconds: 600,
    metrics: {
      words_per_minute: wpm,
      duration: 600,
      word_count: wpm * 10,
      fillers: { um: fillers },
      pauses: Array.from({ length: pauses }, (_, k) => [10 + 10 * k, 2]),
      repeats: [],
      pace_windows: [],
    },
    transcript: [],
  };
}

// A take with words: `count` back-to-back words, each `seconds` long, so with no fillers and no
// pauses the clean stretch is the whole take.
function spoken(id, createdAt, count, seconds) {
  return {
    id,
    createdAt,
    passageId: "gettysburg",
    passageTitle: "Gettysburg Address, opening",
    durationSeconds: count * seconds,
    metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [] },
    transcript: Array.from({ length: count }, (_, index) => ({
      text: "word",
      start: index * seconds,
      end: (index + 1) * seconds,
    })),
  };
}

function compare(session, previous) {
  const results = loadPure();
  const summary = results.summarize(session);
  const previousSummary = previous ? results.summarize(previous) : null;
  return plain(results.compareWithPrevious(summary, previousSummary));
}

const OCT_8 = "2026-10-08T15:30:00Z";
const OCT_9 = "2026-10-09T15:30:00Z";
const OCT_10 = "2026-10-10T15:30:00Z";
const OCT_11 = "2026-10-11T15:30:00Z";

test("results.js exports compareWithPrevious beside summarize", () => {
  assert.equal(typeof loadPure().compareWithPrevious, "function");
});

test("a first take has nothing to compare with", () => {
  assert.equal(compare(tallies("a", OCT_10), null), null);
  const results = loadPure();
  assert.equal(results.compareWithPrevious(results.summarize(tallies("a", OCT_10))), null);
});

test("each card moves up, down or not at all, in card order", () => {
  const before = tallies("p", OCT_9, { wpm: 128, fillers: 19, pauses: 2 });
  const after = tallies("c", OCT_10, { wpm: 140, fillers: 31, pauses: 3 });
  assert.deepEqual(compare(after, before), [
    { direction: "up", text: "12 faster" },
    { direction: "up", text: "1.2 more" },
    { direction: "up", text: "1 more" },
    null,
  ]);
  assert.deepEqual(compare(before, after), [
    { direction: "down", text: "12 slower" },
    { direction: "down", text: "1.2 fewer" },
    { direction: "down", text: "1 fewer" },
    null,
  ]);
  assert.deepEqual(compare(after, after), [
    { direction: "same", text: "No change" },
    { direction: "same", text: "No change" },
    { direction: "same", text: "No change" },
    null,
  ]);
});

test("the clean stretch compares only when both takes have words", () => {
  const long = spoken("c", OCT_10, 21, 0.3);
  const short = spoken("p", OCT_9, 14, 0.3);
  assert.deepEqual(compare(long, short)[3], { direction: "up", text: "2.1 s longer" });
  assert.deepEqual(compare(short, long)[3], { direction: "down", text: "2.1 s shorter" });
  assert.deepEqual(compare(long, long)[3], { direction: "same", text: "No change" });
  assert.equal(compare(long, tallies("p", OCT_9))[3], null, "the previous take has no words");
  assert.equal(compare(tallies("c", OCT_10), short)[3], null, "this take has no words");
  assert.notEqual(compare(long, tallies("p", OCT_9))[0], null, "pace still compares");
});

test("differences are rounded to the card's precision before the direction is chosen", () => {
  const results = loadPure();
  const base = results.summarize(spoken("p", OCT_9, 14, 0.3));
  const near = { ...base, fillersPerMinute: base.fillersPerMinute + 0.04 };
  const nudged = { ...base, cleanStretchSeconds: 0.1 + 0.2 };
  const tenths = { ...base, cleanStretchSeconds: 0.3 };
  const [, fillers] = plain(results.compareWithPrevious(near, base));
  assert.deepEqual(fillers, { direction: "same", text: "No change" }, "0.04 shows as no change");
  const clean = plain(results.compareWithPrevious(nudged, tenths))[3];
  assert.deepEqual(clean, { direction: "same", text: "No change" }, "0.1 + 0.2 is 0.3");
  for (const entry of compare(spoken("c", OCT_10, 21, 0.3), spoken("p", OCT_9, 14, 0.3))) {
    assert.ok(!/0000|9999|NaN|undefined/.test(entry.text), entry.text);
  }
});

// The DOM half: show() against the fake document, with a store that can list sessions.
function mount(sessions, options = {}) {
  const calls = { lists: 0, tips: 0 };
  const byId = Object.fromEntries(sessions.map((session) => [session.id, session]));
  const context = { app: bareApp(), document: fakeDocument() };
  context.app.store.get = (id) => (options.get ? options.get(id) : Promise.resolve(byId[id]));
  if (options.list !== "none") {
    context.app.store.list =
      options.list ||
      (() => {
        calls.lists += 1;
        const newestFirst = [...sessions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        return Promise.resolve(newestFirst);
      });
  }
  context.app.router.go = () => {};
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  context.app.tips = {
    select: () => {
      calls.tips += 1;
      return [];
    },
  };
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  const results = context.app.screens.results;
  results.mount(root);
  return { results, body, calls };
}

function deltasOf(body) {
  return byClass(body, "metric-grid").children.map((card) => byClass(card, "metric-card__delta"));
}

// [class, own text, hidden ending, icon name] for one delta line.
function deltaShape(delta) {
  if (!delta) {
    return null;
  }
  const [ending, icon] = delta.children;
  return [
    delta.className,
    delta.textContent,
    ending.className + ":" + ending.textContent,
    icon.getAttribute("data-icon"),
  ];
}

test("each comparable card ends with its delta line, read as a full sentence", async () => {
  const previous = tallies("p", OCT_9, { wpm: 152, fillers: 10, pauses: 0 });
  const current = tallies("c", OCT_10, { wpm: 76, fillers: 214, pauses: 3 });
  const { results, body } = mount([previous, current]);
  await results.show({ id: "c" });
  assert.deepEqual(deltasOf(body).map(deltaShape), [
    [
      "metric-card__delta metric-card__delta--down",
      "76 slower",
      "sr-only: than your last take",
      "triangle-down",
    ],
    [
      "metric-card__delta metric-card__delta--up",
      "20.4 more",
      "sr-only: than your last take",
      "triangle-up",
    ],
    [
      "metric-card__delta metric-card__delta--up",
      "3 more",
      "sr-only: than your last take",
      "triangle-up",
    ],
    null,
  ]);
  const cards = byClass(body, "metric-grid").children;
  cards.forEach((card) => {
    const last = card.children[card.children.length - 1];
    if (byClass(card, "metric-card__delta")) {
      assert.equal(last.className.split(" ")[0], "metric-card__delta", "the delta comes last");
    }
  });
  for (const card of cards.slice(2)) {
    assert.equal(byClass(card, "metric-card__hint"), undefined, "a delta is never a hint");
  }
});

test("No change reads from your last take and draws a dash", async () => {
  const previous = spoken("p", OCT_9, 21, 0.3);
  const current = spoken("c", OCT_10, 21, 0.3);
  const { results, body } = mount([previous, current]);
  await results.show({ id: "c" });
  const shapes = deltasOf(body).map(deltaShape);
  shapes.forEach((shape) =>
    assert.deepEqual(shape, [
      "metric-card__delta metric-card__delta--same",
      "No change",
      "sr-only: from your last take",
      "dash",
    ]),
  );
});

test("the note under the grid explains the arrows, only when there is a last take", async () => {
  const previous = tallies("p", OCT_9);
  const current = tallies("c", OCT_10, { wpm: 150 });
  const { results, body } = mount([previous, current]);
  await results.show({ id: "c" });
  const grid = byClass(body, "metric-grid");
  const note = body.children[body.children.indexOf(grid) + 1];
  assert.equal(note.tagName, "p");
  assert.equal(note.className, "metric-grid__note");
  assert.equal(note.textContent, "Arrows compare with your last take.");

  const first = mount([current]);
  await first.results.show({ id: "c" });
  assert.equal(byClass(first.body, "metric-grid__note"), undefined);
  assert.deepEqual(deltasOf(first.body), [undefined, undefined, undefined, undefined]);
});

test("the last take is the newest one saved before this one, never a later one", async () => {
  const oldest = tallies("o", OCT_8, { wpm: 100 });
  const previous = tallies("p", OCT_9, { wpm: 130 });
  const current = tallies("c", OCT_10, { wpm: 140 });
  const newer = tallies("n", OCT_11, { wpm: 200 });
  const { results, body, calls } = mount([oldest, newer, current, previous]);
  await results.show({ id: "c" });
  assert.equal(deltasOf(body)[0].textContent, "10 faster");
  assert.equal(calls.lists, 1);
  assert.equal(calls.tips, 1, "tips are chosen for this take only, never the last one");

  await results.show({ id: "o" });
  assert.equal(byClass(body, "metric-grid__note"), undefined, "the oldest take has no last take");
});

test("a store without list(), or one that fails, shows the cards without deltas", async () => {
  const current = tallies("c", OCT_10);
  for (const list of [
    "none",
    () => Promise.reject(new Error("IndexedDB is unavailable")),
    () => {
      throw new Error("list blew up");
    },
    () => Promise.resolve(null),
  ]) {
    const { results, body } = mount([tallies("p", OCT_9), current], { list });
    await assert.doesNotReject(() => results.show({ id: "c" }));
    assert.equal(byClass(body, "metric-grid").children.length, 4);
    assert.deepEqual(deltasOf(body), [undefined, undefined, undefined, undefined]);
    assert.equal(byClass(body, "metric-grid__note"), undefined);
  }
});

test("a missing session never asks for the list", async () => {
  const { results, body, calls } = mount([tallies("p", OCT_9)]);
  await results.show({ id: "nope" });
  await results.show({});
  assert.equal(calls.lists, 0);
  assert.equal(body.children[0].className, "state state--empty");
});

test("when two loads overlap, the later show wins even if its list is slower", async () => {
  const previous = tallies("p", OCT_9, { wpm: 100 });
  const slow = tallies("slow", OCT_10, { wpm: 120 });
  const fast = tallies("fast", OCT_10, { wpm: 140 });
  let releaseList = null;
  let listCalls = 0;
  const { results, body } = mount([previous, slow, fast], {
    list: () => {
      listCalls += 1;
      if (listCalls === 1) {
        return new Promise((resolve) => {
          releaseList = () => resolve([slow, fast, previous]);
        });
      }
      return Promise.resolve([fast, slow, previous]);
    },
  });
  const pendingSlow = results.show({ id: "slow" });
  // setImmediate runs once every resolved promise has settled: the slow show is then parked
  // on its list.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(listCalls, 1, "the slow show asks for the list after its session loads");
  await results.show({ id: "fast" });
  releaseList();
  await pendingSlow;
  const pace = byClass(byClass(body, "metric-grid").children[0], "metric-card__value");
  assert.equal(pace.children[0].textContent, "140", "the slow earlier load must not paint over");
  assert.equal(deltasOf(body)[0].textContent, "40 faster");
});

test("the headline counts a fillers drop against the last take", async () => {
  const previous = spoken("p", OCT_9, 120, 0.5);
  previous.transcript[10].text = "um";
  previous.transcript[40].text = "um";
  previous.transcript[70].text = "um";
  previous.transcript[100].text = "um";
  const current = spoken("c", OCT_10, 120, 0.5);
  current.transcript[60].text = "um";
  const { results, body } = mount([previous, current]);
  await results.show({ id: "c" });
  assert.equal(
    byClass(byClass(body, "headline"), "headline__strength").textContent,
    "Fillers are down from 4 to 1 a minute.",
  );
});

// Every declaration styles.css gives this selector outside @-rules, later rules winning.
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

test("a delta is one muted micro line with tabular figures and its icon drawn first", () => {
  const delta = rule(".metric-card__delta");
  assert.equal(delta["font-size"], "var(--fs-micro)");
  assert.equal(delta.color, "var(--muted)");
  assert.equal(delta["white-space"], "nowrap");
  assert.equal(delta["font-variant-numeric"], "tabular-nums");
  assert.equal(rule(".metric-card__delta svg").order, "-1");
  const note = rule(".metric-grid__note");
  assert.equal(note["font-size"], "var(--fs-micro)");
  assert.equal(note.color, "var(--muted)");
});
