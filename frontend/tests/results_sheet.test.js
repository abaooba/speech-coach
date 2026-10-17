// Tests for the sheet after a take (docs/superpowers/specs/2026-10-17-guided-coach-design.md
// Phase 5 item 6): Practice marks a take it just saved as fresh right before it opens Results,
// and Results opens the coach's sheet for that take once: the rule takeaway at once with
// "Reading your take…", then Claude's headline in its place, one big button for the next move
// (app.nextMove after a take) and "See full results"; free-talk takes of 20 words or more also
// get "Check grammar & vocabulary". A sample or a reopened take gets no sheet. ui.js, sheet.js,
// passages.js, delivery.js, path.js, coach.js, nextmove.js, language.js, tips.js, results.js and
// coachcard.js run for real in a vm; the store, the api, the router and the document are fakes.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, FakeTextNode } = require("./fake-dom");
const harness = require("./practice-harness");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const SOURCES = [
  "ui.js",
  "sheet.js",
  "passages.js",
  "delivery.js",
  "path.js",
  "coach.js",
  "nextmove.js",
  "language.js",
  "tips.js",
  path.join("screens", "results.js"),
  path.join("screens", "coachcard.js"),
].map((file) => [file, read(file)]);

class Node extends FakeElement {
  constructor(tagName, ns, doc) {
    super(tagName, ns);
    this.doc = doc;
    this.inert = false;
  }

  focus() {
    this.doc.activeElement = this;
  }

  scrollIntoView(options) {
    this.doc.scrolls.push([this, options]);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  contains(node) {
    return (
      node === this ||
      this.children.some((child) => typeof child.contains === "function" && child.contains(node))
    );
  }

  get offsetWidth() {
    return 1;
  }
}

function findById(node, id) {
  if (node.getAttribute && node.getAttribute("id") === id) {
    return node;
  }
  for (const child of node.children || []) {
    const found = findById(child, id);
    if (found) {
      return found;
    }
  }
  return null;
}

function find(node, className) {
  if (node.classList && node.classList.contains(className)) {
    return node;
  }
  for (const child of node.children || []) {
    const hit = find(child, className);
    if (hit) {
      return hit;
    }
  }
  return null;
}

function text(node) {
  return (node.textContent || "") + (node.children || []).map(text).join("");
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  const promise = new Promise((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

// The "Your day" take of results_coach_card.test.js: a restart "the few— the few" at 0:10, a
// 5.6 s pause after "and" at 0:24 and three fillers.
const TEXT =
  "So this morning I woke up early and, um, I went to the market near my house. I wanted to " +
  "buy the few— the few things for dinner. The seller was very friendly and we talked about " +
  "the weather. Um, after that I take the bus to work, and | the traffic was really bad today. " +
  "Like, it took me almost forty minutes. But I listened a podcast about cooking, so it was okay.";

function yourDay(id, overrides) {
  let time = 0;
  const words = [];
  TEXT.split(" ").forEach((token) => {
    if (token === "|") {
      time += 5.4;
      return;
    }
    words.push({ text: token, start: round(time), end: round(time + 0.35) });
    time += 0.5;
  });
  const and = words.findIndex((word, i) => word.text === "and" && words[i + 1].text === "the");
  const first = words.find((word, i) => word.text === "the" && words[i + 1].text === "few—");
  return {
    id,
    createdAt: "2026-10-17T09:12:00.000Z",
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 42,
    metrics: {
      pauses: [[words[and].end, round(words[and + 1].start - words[and].end)]],
      repeats: [{ at: first.start, text: "the few" }],
      fillers: {},
      pace_windows: [],
    },
    transcript: words,
    ...(overrides || {}),
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

const RULE_LINE =
  "Your longest pause was 5.6 s, at 0:24 after “and”. Finish the thought, then pause.";
const AI_HEADLINE =
  "You restarted “the few— the few” at 0:10. Pause before a sentence instead of starting twice.";
const REPLY = {
  headline: { text: AI_HEADLINE, moment_id: "restart-1" },
  tips: [
    {
      entry_id: "restart-004",
      text: "At 0:10 you said “the few— the few”. Pause silently before the phrase.",
      drill: "",
      citation: { label: "Clark & Wasow (1998)", url: "https://example.org/cw", type: "coach" },
      moment_ids: ["restart-1"],
    },
  ],
  source: "ai",
};
const LANGUAGE_RESULT = {
  status: "ok",
  fixes: [],
  words: [],
  rewrites: [],
  praise: "Clear and natural.",
};

// Mounts Results inside document.body, as index.html's main holds it. `advice` answers POST
// /api/advice; the language check answers LANGUAGE_RESULT.
function mount(sessions, options) {
  const settings = options || {};
  const doc = { activeElement: null, keyListeners: [], scrolls: [] };
  doc.createElement = (tag) => new Node(tag, null, doc);
  doc.createElementNS = (ns, tag) => new Node(tag, ns, doc);
  doc.createTextNode = (value) => new FakeTextNode(value);
  doc.addEventListener = (type, fn) => type === "keydown" && doc.keyListeners.push(fn);
  doc.removeEventListener = (type, fn) => {
    doc.keyListeners = doc.keyListeners.filter((other) => other !== fn);
  };
  doc.body = new Node("body", null, doc);
  doc.live = new Node("div", null, doc);
  doc.live.setAttribute("id", "live");
  doc.getElementById = (id) => (id === "live" ? doc.live : findById(doc.body, id));
  const routeListeners = [];
  const calls = { advice: [], language: [], go: [], cleared: 0 };
  const flags = new Map();
  const byId = Object.fromEntries(sessions.map((session) => [session.id, session]));
  const newestFirst = [...sessions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const context = {
    app: {
      screens: {},
      store: {
        get: (id) => Promise.resolve(byId[id]),
        list: () => Promise.resolve([...newestFirst]),
        listClearedLevels: () => {
          calls.cleared += 1;
          return Promise.resolve(settings.cleared || []);
        },
        getFlag: (key) => Promise.resolve(flags.get(key)),
        setFlag: (key, value) => {
          flags.set(key, value);
          return Promise.resolve();
        },
      },
      api: {
        postJson: (url, body) => {
          if (url === "/api/advice") {
            calls.advice.push(body);
            return settings.advice ? settings.advice() : Promise.resolve({ status: 0, body: null });
          }
          calls.language.push(body);
          return Promise.resolve({ status: 200, body: LANGUAGE_RESULT });
        },
      },
      router: {
        go(name, params) {
          calls.go.push({ name, params: params ? { ...params } : params });
        },
      },
    },
    document: doc,
    setTimeout,
    addEventListener: (type, fn) => type === "hashchange" && routeListeners.push(fn),
    removeEventListener: (type, fn) => {
      const at = routeListeners.indexOf(fn);
      if (at !== -1) {
        routeListeners.splice(at, 1);
      }
    },
  };
  SOURCES.forEach(([file, source]) => vm.runInNewContext(source, context, { filename: file }));
  const main = new Node("main", null, doc);
  const root = new Node("section", null, doc);
  const body = new Node("div", null, doc);
  body.className = "screen__body";
  root.appendChild(body);
  main.appendChild(root);
  doc.body.appendChild(main);
  doc.body.appendChild(doc.live);
  const results = context.app.screens.results;
  results.mount(root);
  return { results, body, doc, main, calls, app: context.app, flags, routeListeners };
}

function sheetOf(doc) {
  return doc.body.children.find((node) => node.classList.contains("sheet")) || null;
}

function linksOf(sheet) {
  const row = find(sheet, "sheet__links");
  return row ? row.children : [];
}

const TAKE = yourDay("t1");

// What app.nextMove says after this take, from the same history and cleared records.
function expectedMove(app, sessions, cleared) {
  return app.nextMove({
    history: [...sessions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    cleared: cleared || [],
    today: app.path.localDay(new Date()),
    after: { type: "take" },
  });
}

// --- opening ---

test("a fresh take opens the coach's sheet at once with the rule line and the next move", async () => {
  const replied = deferred();
  const page = mount([TAKE], { advice: () => replied.promise });
  page.results.markFresh("t1");
  const shown = page.results.show({ id: "t1" });
  await flush();
  await flush();
  const sheet = sheetOf(page.doc);
  assert.ok(sheet, "the sheet is open");
  assert.equal(sheet.getAttribute("role"), "dialog");
  assert.equal(text(find(sheet, "sheet__label")).replace("Reading your take…", ""), "Coach");
  assert.equal(text(find(sheet, "sheet__status")), "Reading your take…");
  const line = find(sheet, "sheet__line");
  assert.equal(text(line), RULE_LINE);
  const quote = find(line, "sheet__quote");
  assert.equal(quote.textContent, "“and”");
  assert.ok(quote.classList.contains("sheet__quote--pause"), "a pause's words stay plain");
  const move = expectedMove(page.app, [TAKE]);
  assert.equal(text(find(sheet, "sheet__why")), move.why);
  const primary = find(sheet, "sheet__primary");
  assert.equal(text(primary), move.label);
  assert.ok(move.label.startsWith("Start: "), "one take so far: level 1 of the weakest unit");
  assert.equal(page.calls.cleared, 1, "the cleared levels are read for the move");
  assert.deepEqual(linksOf(sheet).map(text), ["See full results", "Check grammar & vocabulary"]);
  assert.equal(page.main.inert, true, "the page behind the sheet is inert");
  replied.resolve({ status: 0, body: null });
  await shown;
});

test("Claude's headline replaces the rule line, its restart marked, and the status goes", async () => {
  const page = mount([TAKE], { advice: () => Promise.resolve({ status: 200, body: REPLY }) });
  page.results.markFresh("t1");
  await page.results.show({ id: "t1" });
  const sheet = sheetOf(page.doc);
  const line = find(sheet, "sheet__line");
  assert.equal(text(line), AI_HEADLINE);
  const quote = find(line, "sheet__quote");
  assert.equal(quote.textContent, "“the few— the few”");
  assert.ok(quote.classList.contains("sheet__quote--restart"));
  assert.equal(find(sheet, "sheet__status"), null);
  assert.equal(page.doc.live.textContent, AI_HEADLINE, "the new line is said");
});

test("when the notes fail or bring no headline, the rule line stays and the status goes", async () => {
  const noHeadline = { ...REPLY, headline: null };
  for (const advice of [
    () => Promise.resolve({ status: 500, body: { detail: "down" } }),
    () => Promise.resolve({ status: 200, body: noHeadline }),
  ]) {
    const page = mount([TAKE], { advice });
    page.results.markFresh("t1");
    await page.results.show({ id: "t1" });
    const sheet = sheetOf(page.doc);
    assert.equal(text(find(sheet, "sheet__line")), RULE_LINE);
    assert.equal(find(sheet, "sheet__status"), null);
  }
});

// --- only once, only for a fresh take ---

test("a reopened take, or the same take shown again, gets no sheet", async () => {
  const page = mount([TAKE]);
  await page.results.show({ id: "t1" });
  assert.equal(sheetOf(page.doc), null, "opened from History: never fresh");
  page.results.markFresh("t1");
  await page.results.show({ id: "t1" });
  find(sheetOf(page.doc), "sheet__handle").click();
  assert.equal(sheetOf(page.doc), null);
  await page.results.show({ id: "t1" });
  assert.equal(sheetOf(page.doc), null, "once per take: the mark is used up");
});

test("a take marked fresh but another take shown uses the mark up", async () => {
  const other = yourDay("t2", { createdAt: "2026-10-16T09:12:00.000Z" });
  const page = mount([TAKE, other]);
  page.results.markFresh("t1");
  await page.results.show({ id: "t2" });
  assert.equal(sheetOf(page.doc), null);
  await page.results.show({ id: "t1" });
  assert.equal(sheetOf(page.doc), null);
});

test("a sample never gets the sheet", async () => {
  const sample = yourDay("s1", { passageTitle: "Sample: Your day" });
  const page = mount([sample]);
  page.results.markFresh("s1");
  await page.results.show({ id: "s1" });
  assert.equal(sheetOf(page.doc), null);
});

test("a take left before the sheet could open never opens it", async () => {
  const page = mount([TAKE]);
  page.results.markFresh("t1");
  const shown = page.results.show({ id: "t1" });
  page.results.hide();
  await shown;
  assert.equal(sheetOf(page.doc), null);
});

// --- the buttons ---

test("the big button goes to the next move's route and closes the sheet", async () => {
  const page = mount([TAKE]);
  page.results.markFresh("t1");
  await page.results.show({ id: "t1" });
  const move = expectedMove(page.app, [TAKE]);
  find(sheetOf(page.doc), "sheet__primary").click();
  assert.equal(sheetOf(page.doc), null);
  const [, name, id] = move.href.split("/");
  assert.deepEqual(page.calls.go, [{ name, params: { id } }]);
});

test("Record another take goes back to Practice", async () => {
  // The fallback move's href is #/practice: Practice, with no id.
  const page = mount([TAKE]);
  page.results.markFresh("t1");
  page.app.nextMove = () => ({
    kind: "record",
    label: "Record another take",
    href: "#/practice",
    why: "Every take adds a point to your trend.",
  });
  await page.results.show({ id: "t1" });
  find(sheetOf(page.doc), "sheet__primary").click();
  assert.deepEqual(page.calls.go, [{ name: "practice", params: undefined }]);
});

test("See full results only closes the sheet", async () => {
  const page = mount([TAKE]);
  page.results.markFresh("t1");
  await page.results.show({ id: "t1" });
  linksOf(sheetOf(page.doc))[0].click();
  assert.equal(sheetOf(page.doc), null);
  assert.deepEqual(page.calls.go, []);
  assert.equal(page.main.inert, false);
});

test("the grammar link closes the sheet, brings the Coach card up and runs the check", async () => {
  const page = mount([TAKE]);
  page.results.markFresh("t1");
  await page.results.show({ id: "t1" });
  linksOf(sheetOf(page.doc))[1].click();
  assert.equal(sheetOf(page.doc), null);
  const card = find(page.body, "coach-card");
  assert.ok(page.doc.scrolls.some(([node]) => node === card), "the card scrolls into view");
  await flush();
  await flush();
  assert.equal(page.calls.language.length, 1);
  assert.ok(find(find(page.body, "coach-card"), "lang-check"), "the result is in the card");
  assert.equal(page.doc.activeElement.className, "lang-check__title", "focus lands on the result");
});

test("no grammar link on a Read take or a take under 20 words", async () => {
  const read = yourDay("r1", { passageId: "explainer-rainbows" });
  const short = yourDay("short");
  short.transcript = short.transcript.slice(0, 12);
  short.metrics = { pauses: [], repeats: [], fillers: {}, pace_windows: [] };
  for (const take of [read, short]) {
    const page = mount([take]);
    page.results.markFresh(take.id);
    await page.results.show({ id: take.id });
    assert.deepEqual(linksOf(sheetOf(page.doc)).map(text), ["See full results"], take.id);
  }
});

// --- Practice marks the take ---

test("Practice marks a saved take fresh right before it opens Results", async () => {
  const t = harness.setup();
  const marked = [];
  t.app.screens.results = { markFresh: (id) => marked.push(id) };
  const go = t.app.router.go;
  t.app.router.go = (name, params) => {
    t.calls.markedBeforeGo = [...marked];
    go(name, params);
  };
  await t.startRecording();
  t.clock.advance(6000);
  await t.stopRecording();
  t.resolveUpload();
  await harness.flush();
  assert.deepEqual(marked, [harness.SAVED_ID]);
  assert.deepEqual(t.calls.markedBeforeGo, [harness.SAVED_ID]);
  assert.deepEqual(harness.plain(t.calls.go), [
    { name: "results", params: { id: harness.SAVED_ID } },
  ]);
});

test("a level take goes back to its level and is never marked fresh", async () => {
  const t = harness.setup();
  const marked = [];
  t.app.screens.results = { markFresh: (id) => marked.push(id) };
  const { request } = harness.levelRequest();
  t.practice.startLevelTake(request);
  await t.startRecording();
  t.clock.advance(6000);
  await t.stopRecording();
  t.resolveUpload();
  await harness.flush();
  assert.deepEqual(marked, []);
});
