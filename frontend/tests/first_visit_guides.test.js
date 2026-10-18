// Tests for the first-visit guides (guided coach, spec Phase 5 item 9): app.sheet.firstVisit
// (the copy, the loop diagram, onboarding and stacking rules) and the five places that ask for
// one: Practice, Path, Progress, History and the first level.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, FakeTextNode, fakeDocument } = require("./fake-dom");
const practiceHarness = require("./practice-harness");
const pathHarness = require("./path-screen-harness");
const levelHarness = require("./level-harness");

const FRONTEND = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(FRONTEND, ...parts), "utf8");

// --- app.sheet.firstVisit against sheet.js's own fake page -------------------------------------

class Node extends FakeElement {
  constructor(tagName, ns, doc) {
    super(tagName, ns);
    this.doc = doc;
    this.inert = false;
  }
  focus() {
    this.doc.activeElement = this;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
}

function sheetWorld({ flags = { onboarded: true }, body = true } = {}) {
  const doc = { activeElement: null };
  doc.createElement = (tag) => new Node(tag, null, doc);
  doc.createElementNS = (ns, tag) => new Node(tag, ns, doc);
  doc.createTextNode = (text) => new FakeTextNode(text);
  doc.addEventListener = () => {};
  doc.removeEventListener = () => {};
  doc.getElementById = () => null;
  if (body) {
    doc.body = new Node("body", null, doc);
  }
  const app = {
    store: {
      getFlag: async (key) => flags[key],
      setFlag: async (key, value) => {
        flags[key] = value;
      },
    },
  };
  const context = { app, document: doc, setTimeout };
  vm.runInNewContext(read("ui.js"), context, { filename: "ui.js" });
  vm.runInNewContext(read("sheet.js"), context, { filename: "sheet.js" });
  return { app, doc, flags };
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

const GUIDE_COPY = {
  practice: [
    "Your first take",
    "Pick a topic, tap the red button and talk for a minute. Results show every pause, filler " +
      "and restart at the second it happened.",
    "Got it",
  ],
  path: [
    "Your path",
    "Each level is one short drill: two takes with a quick review between them. Clear a level " +
      "to open the next one.",
    "Got it",
  ],
  progress: [
    "Your progress",
    "Every take adds a point to these charts. Practice on a few different days to see your trend.",
    "Got it",
  ],
  history: [
    "Your takes",
    "Every take stays on this phone, and only there. Tap one to open its results again.",
    "Got it",
  ],
  level: [
    "How a level works",
    "Take 1, then a 30-second look at your moments, then take 2 with one fix in mind. Take 2 " +
      "decides the level.",
    "Start take 1",
  ],
};

for (const [name, [title, line, button]] of Object.entries(GUIDE_COPY)) {
  test("the " + name + " guide uses the designed copy and sets its seen flag", async () => {
    const { app, doc, flags } = sheetWorld();
    assert.equal(await app.sheet.firstVisit(name), true);
    const sheet = find(doc.body, "sheet");
    assert.match(text(find(sheet, "sheet__label")), /Guide/);
    assert.equal(text(find(sheet, "sheet__title")), title);
    assert.equal(text(find(sheet, "sheet__text")), line);
    assert.equal(text(find(sheet, "sheet__primary")), button);
    assert.equal(flags["guideSeen:" + name], true);
    assert.equal(find(sheet, "sheet__links"), null);
  });
}

test("a guide shows once", async () => {
  const { app, doc } = sheetWorld();
  assert.equal(await app.sheet.firstVisit("path"), true);
  find(doc.body, "sheet__primary").click();
  assert.equal(await app.sheet.firstVisit("path"), false);
  assert.equal(find(doc.body, "sheet"), null);
});

test("the level guide draws Take 1, Review and Take 2 with take 2 marked as counting", async () => {
  const { app, doc } = sheetWorld();
  await app.sheet.firstVisit("level");
  const loop = find(find(doc.body, "sheet"), "sheet__extra");
  assert.ok(find(loop, "loop"));
  assert.equal(text(loop).replace(/\s+/g, ""), "Take1Review" + "Take2counts");
  assert.ok(find(find(loop, "loop__node--counts"), "loop__pill"));
});

test("firstVisit's primary option replaces the button and runs", async () => {
  const { app, doc } = sheetWorld();
  let ran = 0;
  await app.sheet.firstVisit("level", { primary: { label: "Got it", onSelect: () => (ran += 1) } });
  assert.equal(text(find(doc.body, "sheet__primary")), "Got it");
  find(doc.body, "sheet__primary").click();
  assert.equal(ran, 1);
});

test("a guide waits for onboarding to finish", async () => {
  const { app, doc, flags } = sheetWorld({ flags: {} });
  assert.equal(await app.sheet.firstVisit("practice"), false);
  assert.equal(find(doc.body, "sheet"), null);
  assert.equal(flags["guideSeen:practice"], undefined, "not used up before it was shown");
});

test("a guide never opens over another sheet and is not used up by trying", async () => {
  const { app, doc, flags } = sheetWorld();
  app.sheet.open({
    label: "Coach",
    line: "Your longest pause was 5.4 s.",
    primary: { label: "Start: Restarts level 2" },
  });
  assert.equal(await app.sheet.firstVisit("history"), false);
  assert.equal(find(doc.body, "sheet__title"), null);
  assert.equal(text(find(doc.body, "sheet__line")), "Your longest pause was 5.4 s.");
  assert.equal(flags["guideSeen:history"], undefined);
});

test("with no document.body a guide does nothing", async () => {
  const { app, flags } = sheetWorld({ body: false });
  assert.equal(await app.sheet.firstVisit("practice"), false);
  assert.equal(flags["guideSeen:practice"], undefined);
});

test("a pill status stays when the AI line arrives; the spinner goes", () => {
  const { app, doc } = sheetWorld();
  const pill = app.sheet.open({
    label: "Coach",
    line: "rule line",
    status: { kind: "ok", text: "Level 1 cleared" },
    primary: { label: "Go" },
  });
  pill.update("AI line");
  assert.match(text(find(doc.body, "sheet__label")), /Level 1 cleared/);
  assert.equal(text(find(doc.body, "sheet__line")), "AI line");
});

// --- The screens ask for their guide ---------------------------------------------------------

function spyOn(app) {
  const asked = [];
  app.sheet = {
    firstVisit(name, options) {
      asked.push({ name, options });
      return Promise.resolve(true);
    },
  };
  return asked;
}

test("Practice asks for the practice guide on a normal visit", async () => {
  const t = practiceHarness.setup();
  const asked = spyOn(t.app);
  t.practice.show({});
  await practiceHarness.flush();
  assert.deepEqual(asked.map((each) => each.name), ["practice"]);
});

test("Practice does not ask for it while it holds a level's take", async () => {
  const t = practiceHarness.setup();
  const asked = spyOn(t.app);
  t.startLevel(practiceHarness.levelRequest().request);
  await practiceHarness.flush();
  assert.deepEqual(asked, []);
});

test("Path asks for the path guide", async () => {
  const w = pathHarness.mountPath();
  const asked = spyOn(w.app);
  await w.screen.show();
  assert.deepEqual(asked.map((each) => each.name), ["path"]);
});

function loadScreen(file, extra) {
  const document = fakeDocument();
  const app = { screens: {}, ui: {}, store: {}, router: { go() {} } };
  app.store.list = () => Promise.resolve([]);
  const context = { app, document };
  vm.runInNewContext(read("ui.js"), context, { filename: "ui.js" });
  vm.runInNewContext(read("screens", file + ".js"), context, { filename: file + ".js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(new FakeElement("h1"));
  root.appendChild(body);
  app.screens[file].mount(root);
  if (extra) {
    extra(app);
  }
  return app;
}

for (const name of ["progress", "history"]) {
  test(name[0].toUpperCase() + name.slice(1) + " asks for its guide", async () => {
    const app = loadScreen(name, (loaded) => {
      loaded.screens.results = { summarize: () => ({ wpm: 0, fillersPerMinute: 0 }) };
    });
    const asked = spyOn(app);
    await app.screens[name].show();
    assert.deepEqual(asked.map((each) => each.name), [name]);
  });
}

test("the first level asks for the level guide once its goal is drawn, and its button starts take 1", async () => {
  const world = levelHarness.createWorld({ history: [], cleared: [] });
  const asked = spyOn(world.app);
  await world.open("restarts-1");
  assert.deepEqual(asked.map((each) => each.name), ["level"]);
  asked[0].options.primary.onSelect();
  assert.equal(world.practice.requests.length, 1, "take 1 was handed to Practice");
});

test("a level that is not a loop (a check-back) asks for no level guide", async () => {
  const world = levelHarness.createWorld({
    history: [],
    cleared: ["restarts-1"].map((levelId) => ({ levelId, clearedAt: levelHarness.at("2026-10-01") })),
  });
  const asked = spyOn(world.app);
  await world.open("restarts-1_checkback");
  assert.deepEqual(asked, []);
});

test("no screen file builds a guide of its own: all five come from app.sheet.firstVisit", () => {
  ["practice", "path", "progress", "history", "level"].forEach((name) => {
    const source = read("screens", name + ".js");
    assert.match(source, /firstVisit\(/, name);
    assert.doesNotMatch(source, /guideOnce\(/, name);
  });
});
