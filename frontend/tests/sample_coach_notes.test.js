// The bundled sample opens with its coach notes already in the Coach card, never with the
// "Writing notes on this take…" status (2026-10-19 design review). sample-session.json carries
// the notes Claude wrote for it under `coachNotes`; Practice saves them with the take, the store
// keeps the field, and Results draws them at once and asks the server for nothing.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, FakeTextNode, fakeDocument, byClass } = require("./fake-dom");
const { FakeIndexedDB } = require("./fake-indexeddb");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const SAMPLE_FILE = JSON.parse(read("sample-session.json"));
const DESIGN = read("DESIGN.md");

const PASSAGES = [
  { id: "explain-something", kind: "passage", targetWpm: [130, 160] },
  { id: "free-talk", kind: "prompt", targetWpm: [140, 160] },
];

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

function findAll(node, name, found = []) {
  (node.children || []).forEach((child) => {
    if (child.classList && child.classList.contains(name)) {
      found.push(child);
    }
    findAll(child, name, found);
  });
  return found;
}

// Loads the pure modules the Coach card's content depends on, with no screen mounted.
function loadModules(files) {
  const app = { screens: {}, ui: {}, store: {}, router: { go() {} }, api: {} };
  const context = { app, document: fakeDocument(), setTimeout, clearTimeout };
  files.forEach((file) => vm.runInNewContext(read(file), context, { filename: file }));
  return app;
}

// --- the file -------------------------------------------------------------------------------

test("sample-session.json carries coach notes that tips.js accepts, written by Claude", () => {
  const app = loadModules(["ui.js", "tips.js"]);
  const notes = app.tips.parseCoachNotes(SAMPLE_FILE.coachNotes);
  assert.ok(notes, "the notes parse");
  assert.equal(notes.source, "ai");
  assert.ok(notes.headline && notes.headline.text, "a headline");
  assert.ok(notes.tips.length >= 2, "at least two tips");
  notes.tips.forEach((tip) => {
    assert.ok(tip.citation.url, tip.entryId + " cites a web source");
    assert.doesNotMatch(tip.text, /debat/i);
  });
});

test("every moment the sample's notes name is one the app finds in the sample", () => {
  const app = loadModules([
    "ui.js",
    "passages.js",
    "delivery.js",
    "coach.js",
    "tips.js",
    path.join("screens", "results.js"),
  ]);
  const session = { ...SAMPLE_FILE, id: "sample", createdAt: "2026-10-08T19:07:00.000Z" };
  const summary = app.screens.results.summarize(session);
  const moments = app.coach.coachMoments(summary.report, session.transcript);
  const byId = new Map(moments.map((moment) => [moment.id, moment]));
  const notes = app.tips.parseCoachNotes(SAMPLE_FILE.coachNotes);
  assert.ok(byId.has(notes.headline.momentId), "the headline's moment exists");
  const named = notes.tips.flatMap((tip) => tip.momentIds);
  assert.ok(named.length > 0);
  named.forEach((id) => assert.ok(byId.has(id), id + " is a moment of the sample"));
  // The headline names the clock of the moment it points at, counted from the first word.
  assert.match(notes.headline.text, new RegExp(byId.get(notes.headline.momentId).clock));
});

// --- Practice saves them ----------------------------------------------------------------------

function mountPractice(file) {
  const saves = [];
  const context = {
    app: {
      screens: {},
      ui: {},
      api: { messages: {} },
      passages: PASSAGES.map((entry) => ({ ...entry, targetWpm: [...entry.targetWpm] })),
      store: {
        save: async (session) => {
          saves.push(session);
          return "sample-1";
        },
      },
      router: { go() {} },
    },
    document: fakeDocument(),
    fetch: () => Promise.resolve({ ok: true, json: () => file }),
  };
  vm.runInNewContext(read("ui.js"), context, { filename: "ui.js" });
  vm.runInNewContext(read(path.join("screens", "practice.js")), context, {
    filename: "practice.js",
  });
  const root = new FakeElement("section");
  root.dataset.state = "idle";
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.practice.mount(root);
  const hint = byClass(body, "practice__hint");
  return { button: byClass(hint, "practice__sample"), saves };
}

test("Practice saves the sample's coach notes with its five fields", async () => {
  const { button, saves } = mountPractice(SAMPLE_FILE);
  button.click();
  await flush();
  assert.equal(saves.length, 1);
  assert.deepEqual(
    Object.keys(saves[0]).sort(),
    ["coachNotes", "durationSeconds", "metrics", "passageId", "passageTitle", "transcript"],
  );
  assert.deepEqual(JSON.parse(JSON.stringify(saves[0].coachNotes)), SAMPLE_FILE.coachNotes);
});

test("a sample file without notes still saves exactly the five fields", async () => {
  const { coachNotes, ...plain } = SAMPLE_FILE;
  assert.ok(coachNotes);
  const { button, saves } = mountPractice(plain);
  button.click();
  await flush();
  assert.deepEqual(Object.keys(saves[0]).sort(), Object.keys(plain).sort());
});

// --- the store keeps them ---------------------------------------------------------------------

test("the store keeps a take's coachNotes field", async () => {
  const context = { app: {}, indexedDB: new FakeIndexedDB(), window: { addEventListener() {} } };
  vm.runInNewContext(read("store.js"), context, { filename: "store.js" });
  const saved = {
    id: "sample-1",
    createdAt: "2026-10-08T19:07:00.000Z",
    ...SAMPLE_FILE,
  };
  await context.app.store.save({ ...saved });
  const kept = JSON.parse(JSON.stringify(await context.app.store.get("sample-1")));
  assert.deepEqual(kept.coachNotes, SAMPLE_FILE.coachNotes);
});

// --- Results draws them at once -------------------------------------------------------------

// Mounts Results over `session`. `advice()` answers POST /api/advice; by default nothing comes.
function mountResults(session, advice) {
  const calls = { advice: [] };
  const reply = advice || (() => Promise.resolve({ status: 0, body: null }));
  const live = new FakeElement("div");
  const document = fakeDocument();
  document.getElementById = (id) => (id === "live" ? live : null);
  const context = {
    app: {
      screens: {},
      passages: PASSAGES.map((entry) => ({ ...entry, targetWpm: [...entry.targetWpm] })),
      store: {
        get: () => Promise.resolve(session),
        list: () => Promise.resolve([session]),
        getFlag: () => Promise.resolve(undefined),
        setFlag: () => Promise.resolve(),
      },
      api: {
        postJson: (url, body) => {
          calls.advice.push({ url, body });
          return reply();
        },
      },
      router: { go() {} },
    },
    document,
    setTimeout,
    clearTimeout,
  };
  [
    "ui.js",
    "sheet.js",
    "delivery.js",
    "coach.js",
    "language.js",
    "tips.js",
    path.join("screens", "results.js"),
    path.join("screens", "coachcard.js"),
  ].forEach((file) => vm.runInNewContext(read(file), context, { filename: file }));
  const root = new FakeElement("section");
  root.appendChild(new FakeElement("h1"));
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  return { results: context.app.screens.results, body, calls, live };
}

function sampleSession() {
  return { ...structuredClone(SAMPLE_FILE), id: "sample-1", createdAt: "2026-10-08T19:07:00Z" };
}

test("the sample's Results opens with Claude's notes, no status and no advice request", async () => {
  const { results, body, calls, live } = mountResults(sampleSession());
  await results.show({ id: "sample-1" });
  await flush();
  const card = byClass(body, "coach-card");
  assert.ok(card, "a Coach card");
  assert.equal(findAll(card, "coach-card__status").length, 0, "no 'Writing notes' status");
  // The card draws the headline's first quoted words with curly quotes, as the sheet does.
  const straight = (text) => text.replace(/[“”]/g, '"');
  assert.equal(
    straight(fullText(byClass(card, "coach-card__headline"))),
    straight(SAMPLE_FILE.coachNotes.headline.text),
  );
  assert.deepEqual(
    findAll(card, "coach-tip__text").map((node) => node.textContent),
    SAMPLE_FILE.coachNotes.tips.map((tip) => tip.text),
  );
  assert.equal(
    byClass(card, "coach-card__by").textContent,
    "Written for this take by Claude, from the research library.",
  );
  assert.deepEqual(calls.advice, [], "nothing is asked of the server");
  assert.notEqual(live.textContent, "Coach notes ready.", "nothing arrived, so nothing is said");
});

test("a take without bundled notes still asks the server and shows the status meanwhile", async () => {
  const { coachNotes, ...plain } = sampleSession();
  assert.ok(coachNotes);
  let answer;
  const held = new Promise((resolve) => {
    answer = resolve;
  });
  const { results, body, calls } = mountResults(plain, () => held);
  const shown = results.show({ id: "sample-1" });
  await flush();
  assert.equal(findAll(byClass(body, "coach-card"), "coach-card__status").length, 1);
  assert.equal(calls.advice.length, 1);
  answer({ status: 0, body: null });
  await shown;
  assert.equal(findAll(byClass(body, "coach-card"), "coach-card__status").length, 0);
});

test("DESIGN.md says the sample ships its notes and opens without the status", () => {
  assert.match(DESIGN, /sample-session\.json one sample take[\s\S]{0,400}`coachNotes` holds/);
  assert.match(DESIGN, /The sample take[^\n]*never shows the status/);
});
