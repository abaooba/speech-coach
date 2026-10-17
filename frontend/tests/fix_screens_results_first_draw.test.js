// Tests that Results draws a take as soon as app.store.get() has it, without waiting for
// app.store.list() (frontend/screens/results.js). The list only finds the take before this one,
// for the "vs last take" lines; signed in, it can wait a second for the server (20 on a device's
// first list), and until then the screen still showed the last take's numbers under "Results
// ready". show() now draws the take at once with no comparison, then draws it again with the
// deltas once the last take is found, unless a newer show() has begun. The screen and the real
// ui.js and delivery.js run in a vm context against the shared fake DOM; each test holds the
// list open with a promise it settles by hand.
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

const PASSAGES = [{ id: "gettysburg", targetWpm: [130, 150] }];

const OCT_9 = "2026-10-09T15:30:00Z";
const OCT_10 = "2026-10-10T15:30:00Z";
const OCT_11 = "2026-10-11T15:30:00Z";


// A take saved without words, ten minutes long, so `fillers` ums make fillers / 10 a minute.
function tallies(id, createdAt, { wpm = 140, fillers = 0 } = {}) {
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
      pauses: [],
      repeats: [],
      pace_windows: [],
    },
    transcript: [],
  };
}

// A take with `count` back-to-back half-second words, an "um" at each of `ums`.
function spoken(id, createdAt, count, ums) {
  return {
    id,
    createdAt,
    passageId: "gettysburg",
    passageTitle: "Gettysburg Address, opening",
    durationSeconds: count * 0.5,
    metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [] },
    transcript: Array.from({ length: count }, (_, index) => ({
      text: ums.includes(index) ? "um" : "word",
      start: index * 0.5,
      end: (index + 1) * 0.5,
    })),
  };
}

// A promise with its settle handles, to hold a list open.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Loads ui.js, delivery.js and results.js against the fake document and mounts the screen.
// store.get serves `sessions` by id at once; store.list hands each call to `list(calls)`, which
// returns the promise that call gets. tips.select counts its calls and picks no tips.
function mount(sessions, list) {
  const calls = { lists: 0, tips: 0 };
  const byId = Object.fromEntries(sessions.map((session) => [session.id, session]));
  const context = {
    app: {
      screens: {},
      passages: PASSAGES.map((entry) => ({ ...entry, targetWpm: [...entry.targetWpm] })),
      ui: {},
      store: {
        get: (id) => Promise.resolve(byId[id]),
        list: () => {
          calls.lists += 1;
          return list(calls.lists);
        },
      },
      router: { go() {} },
    },
    document: fakeDocument(),
  };
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

// Every session newest first, as app.store.list() answers.
function newestFirst(sessions) {
  return [...sessions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function paceOf(body) {
  const grid = byClass(body, "stat-strip");
  return grid ? byClass(grid.children[0], "stat__value").children[0].textContent : null;
}

function deltaTexts(body) {
  return byClass(body, "stat-strip").children.map((card) => {
    const delta = byClass(card, "stat__delta");
    return delta ? delta.textContent : null;
  });
}

// The body still holds the very nodes of the first draw, in order: nothing was drawn again.
function assertSameNodes(body, drawn) {
  assert.equal(body.children.length, drawn.length);
  drawn.forEach((node, index) => assert.equal(body.children[index], node, "child " + index));
}

test("the take is drawn as soon as it is read, before its last take is listed", async () => {
  const previous = tallies("p", OCT_9, { wpm: 120 });
  const current = tallies("c", OCT_10, { wpm: 140 });
  const listed = deferred();
  const { results, body } = mount([previous, current], () => listed.promise);

  const showing = results.show({ id: "c" });
  await flush();
  assert.deepEqual(
    body.children.map((child) => child.className),
    ["results__meta num", "stat-strip", "results__actions"],
    "drawn while the list still waits",
  );
  assert.equal(paceOf(body), "140");
  assert.deepEqual(deltaTexts(body), [null, null, null, null], "no comparison yet");
  assert.equal(byClass(body, "stat-strip__note"), undefined);

  listed.resolve(newestFirst([previous, current]));
  await showing;
  assert.deepEqual(deltaTexts(body), ["20 faster", "No change", "No change", "Not compared"]);
  const grid = byClass(body, "stat-strip");
  assert.equal(body.children[body.children.indexOf(grid) + 1].className, "stat-strip__note");
  assert.equal(paceOf(body), "140");
});

test("a new take replaces the one shown before at once, while the list still waits", async () => {
  const first = tallies("first", OCT_9, { wpm: 110 });
  const second = tallies("second", OCT_10, { wpm: 150 });
  const secondList = deferred();
  const { results, body } = mount([first, second], (call) =>
    call === 1 ? Promise.resolve(newestFirst([first])) : secondList.promise,
  );
  await results.show({ id: "first" });
  assert.equal(paceOf(body), "110");

  const showing = results.show({ id: "second" });
  await flush();
  assert.equal(paceOf(body), "150", "never the last take's numbers under Results ready");

  secondList.resolve(newestFirst([first, second]));
  await showing;
  assert.equal(deltaTexts(body)[0], "40 faster");
});

test("the second draw counts a fillers drop against the last take", async () => {
  const previous = spoken("p", OCT_9, 120, [10, 40, 70, 100]);
  const current = spoken("c", OCT_10, 120, [60]);
  const listed = deferred();
  const { results, body } = mount([previous, current], () => listed.promise);

  const showing = results.show({ id: "c" });
  await flush();
  assert.equal(deltaTexts(body)[1], null, "no last take to compare with yet");

  listed.resolve(newestFirst([previous, current]));
  await showing;
  assert.equal(deltaTexts(body)[1], "3 fewer", "4 fillers a minute down to 1");
});

test("tips are chosen once for the take, though it is drawn twice", async () => {
  const previous = tallies("p", OCT_9, { wpm: 130 });
  const current = tallies("c", OCT_10, { wpm: 140 });
  const { results, body, calls } = mount([previous, current], () =>
    Promise.resolve(newestFirst([previous, current])),
  );
  await results.show({ id: "c" });
  assert.equal(deltaTexts(body)[0], "10 faster");
  assert.equal(calls.lists, 1);
  assert.equal(calls.tips, 1);
});

test("a first take is drawn once: a list with nothing earlier leaves it as it is", async () => {
  const current = tallies("c", OCT_10);
  const later = tallies("n", OCT_11);
  const listed = deferred();
  const { results, body } = mount([current, later], () => listed.promise);

  const showing = results.show({ id: "c" });
  await flush();
  const drawn = [...body.children];
  assert.equal(drawn.length, 3);

  listed.resolve(newestFirst([current, later]));
  await showing;
  assertSameNodes(body, drawn);
});

test("a list that fails after the first draw leaves that draw as it is", async () => {
  const current = tallies("c", OCT_10);
  const listed = deferred();
  const { results, body } = mount([tallies("p", OCT_9), current], () => listed.promise);

  const showing = results.show({ id: "c" });
  await flush();
  const drawn = [...body.children];
  assert.equal(paceOf(body), "140");

  listed.reject(new Error("IndexedDB is unavailable"));
  await assert.doesNotReject(() => showing);
  assertSameNodes(body, drawn);
  assert.deepEqual(deltaTexts(body), [null, null, null, null]);
});

test("a slow list from an earlier visit never draws over a newer one", async () => {
  const previous = tallies("p", OCT_9, { wpm: 100 });
  const slow = tallies("slow", OCT_10, { wpm: 120 });
  const fast = tallies("fast", OCT_11, { wpm: 160 });
  const slowList = deferred();
  const { results, body } = mount([previous, slow, fast], (call) =>
    call === 1 ? slowList.promise : Promise.resolve(newestFirst([previous, slow, fast])),
  );

  const pendingSlow = results.show({ id: "slow" });
  await flush();
  assert.equal(paceOf(body), "120", "the earlier visit drew its take");

  await results.show({ id: "fast" });
  assert.equal(paceOf(body), "160");
  assert.equal(deltaTexts(body)[0], "40 faster");

  slowList.resolve(newestFirst([previous, slow, fast]));
  await pendingSlow;
  assert.equal(paceOf(body), "160", "the slow list must not draw its take again");
  assert.equal(deltaTexts(body)[0], "40 faster");
});
