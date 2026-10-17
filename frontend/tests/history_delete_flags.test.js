// Tests that deleting a take also deletes what was kept about it (guided coach, final review
// finding 9): the coach notes kept under `coachNotes:<id>` (tips.js) and the grammar check kept
// under `languageCheck:<id>` (language.js) hold fragments of the take's transcript, so History's
// delete removes both flags with the take. app.store keeps its eight functions: setFlag(key,
// undefined) deletes a flag. The real store.js runs on the fake IndexedDB, with ui.js and
// screens/history.js on the shared fake DOM.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");
const { FakeIndexedDB } = require("./fake-indexeddb");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");

function take(id, createdAt) {
  return {
    id,
    createdAt,
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 42,
    metrics: {},
    transcript: [{ text: "hello", start: 0, end: 0.4 }],
  };
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function settled(rounds = 12) {
  for (let round = 0; round < rounds; round += 1) {
    await settle();
  }
}

// History over the real store, holding `takes` and a flag of each kind per take.
async function mountWithStore(takes) {
  const indexedDB = new FakeIndexedDB();
  const live = new FakeElement("div");
  const app = {
    screens: { results: { summarize: () => ({ wpm: 150, fillersPerMinute: 1 }) } },
    router: { go() {} },
  };
  const context = { app, document: fakeDocument({ live }), indexedDB };
  vm.runInNewContext(read("store.js"), context, { filename: "store.js" });
  vm.runInNewContext(read("ui.js"), context, { filename: "ui.js" });
  vm.runInNewContext(read(path.join("screens", "history.js")), context, {
    filename: "history.js",
  });
  for (const each of takes) {
    await app.store.save({ ...each });
    await app.store.setFlag("coachNotes:" + each.id, { headline: "kept", source: "ai" });
    await app.store.setFlag("languageCheck:" + each.id, { status: "ok", fixes: [] });
  }
  await app.store.setFlag("onboarded", true);
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  app.screens.history.mount(root);
  await app.screens.history.show();
  return { app, body, indexedDB };
}

function rowsOf(body) {
  return byClass(body, "session-list").children;
}

function lastChild(row) {
  return row.children[row.children.length - 1];
}

async function deleteRow(body, index) {
  const row = rowsOf(body)[index];
  lastChild(row).click();
  const [, yes] = lastChild(row).children;
  yes.click();
  await settled();
}

test("setFlag(key, undefined) deletes the flag, and app.store keeps its eight functions", async () => {
  const indexedDB = new FakeIndexedDB();
  const context = { app: {}, indexedDB };
  vm.runInNewContext(read("store.js"), context, { filename: "store.js" });
  const store = context.app.store;
  assert.equal(Object.keys(store).length, 8);
  await store.setFlag("coachNotes:t1", { headline: "x" });
  assert.ok(indexedDB.store("flags").records.has("coachNotes:t1"));
  await store.setFlag("coachNotes:t1", undefined);
  assert.equal(indexedDB.store("flags").records.has("coachNotes:t1"), false, "no record left");
  assert.equal(await store.getFlag("coachNotes:t1"), undefined);
  await assert.doesNotReject(store.setFlag("never-set", undefined));
});

test("deleting a take in History deletes its coach notes and grammar check flags", async () => {
  const { app, body, indexedDB } = await mountWithStore([
    take("t2", "2026-10-17T10:00:00.000Z"),
    take("t1", "2026-10-16T10:00:00.000Z"),
  ]);
  await deleteRow(body, 0);
  assert.equal(await app.store.get("t2"), undefined, "the take is gone");
  const flags = indexedDB.store("flags").records;
  assert.equal(flags.has("coachNotes:t2"), false);
  assert.equal(flags.has("languageCheck:t2"), false);
  assert.ok(flags.has("coachNotes:t1"), "another take's flags stay");
  assert.ok(flags.has("languageCheck:t1"));
  assert.equal(await app.store.getFlag("onboarded"), true, "other flags stay");
});

test("a delete that fails keeps the take's flags with it", async () => {
  const { app, body, indexedDB } = await mountWithStore([take("t1", "2026-10-16T10:00:00.000Z")]);
  app.store.remove = () => Promise.reject(new Error("blocked"));
  await deleteRow(body, 0);
  const flags = indexedDB.store("flags").records;
  assert.ok(flags.has("coachNotes:t1"));
  assert.ok(flags.has("languageCheck:t1"));
});

test("History names the same flags tips.js and language.js keep", () => {
  const history = read(path.join("screens", "history.js"));
  const tips = read("tips.js");
  const language = read("language.js");
  assert.match(tips, /NOTES_FLAG_PREFIX = "coachNotes:"/);
  assert.match(language, /FLAG_PREFIX = "languageCheck:"/);
  assert.match(history, /"coachNotes:"/);
  assert.match(history, /"languageCheck:"/);
});
