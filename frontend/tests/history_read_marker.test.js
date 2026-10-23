// Tests that a History row says "Read" in words for a take read aloud
// (docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 6): the row's meta line
// reads "<date> · Read", by app.language.isReadTake, the rule Progress charts Talk and Read apart
// on, so the kind never rests on color. A talk take's row is unchanged, and without language.js
// every take is talk, as before the rule. ui.js, passages.js, language.js and screens/history.js
// run for real against the shared fake DOM; summarize and the store are stubs.
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
const PASSAGES_SOURCE = read("passages.js");
const LANGUAGE_SOURCE = read("language.js");
const HISTORY_SOURCE = read(path.join("screens", "history.js"));

const MARKER = " · Read";
const SUMMARY = { wpm: 152, fillersPerMinute: 1.2, target: [140, 160] };

// The block the backend adds to a take that followed the script it was sent.
const FOLLOWED_SCRIPT = { pauses: [], script: { restarts: [], skipped: [], misread: [] } };

// A stored take on `passageId`, saved on the given day of October 2026.
function take(id, day, passageId, passageTitle, metrics) {
  return {
    id,
    createdAt: "2026-10-" + String(day).padStart(2, "0") + "T10:00:00.000Z",
    passageId,
    passageTitle,
    durationSeconds: 60,
    metrics: metrics || { pauses: [] },
    transcript: [],
  };
}

// One take of every kind History lists, newest first, as app.store.list() hands them over.
const TALK = take("talk", 12, "free-talk", "About you");
const READ_TAB = take("read-tab", 11, "gettysburg-opening", "Gettysburg Address, opening");
const COLD_READ = take(
  "cold-read",
  10,
  "cold-read-school-start",
  "Cold read: the teenage body clock",
);
const BENCHMARK_TALK = take("benchmark-talk", 9, "benchmark-talk", "Benchmark talk");
const BENCHMARK_READ = take("benchmark-read", 8, "benchmark-read", "Benchmark read");
const PASTED = take("pasted", 7, "free-talk", "About you", FOLLOWED_SCRIPT);
const EVERY_KIND = [TALK, READ_TAB, COLD_READ, BENCHMARK_TALK, BENCHMARK_READ, PASTED];

// Mounts History over a store serving `sessions`. `language` picks the rule: "real" runs
// language.js, "none" leaves app.language unset, and an object becomes app.language itself.
function mountHistory(sessions, { language = "real" } = {}) {
  const app = {
    screens: { results: { summarize: () => ({ ...SUMMARY, target: [...SUMMARY.target] }) } },
    store: { list: () => Promise.resolve([...sessions]), remove: () => Promise.resolve() },
    router: { go() {} },
  };
  const context = { app, document: fakeDocument() };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(PASSAGES_SOURCE, context, { filename: "passages.js" });
  if (language === "real") {
    vm.runInNewContext(LANGUAGE_SOURCE, context, { filename: "language.js" });
  } else if (language !== "none") {
    app.language = language;
  }
  vm.runInNewContext(HISTORY_SOURCE, context, { filename: "history.js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  app.screens.history.mount(root);
  return { app, history: app.screens.history, body };
}

async function shown(sessions, options) {
  const page = mountHistory(sessions, options);
  await page.history.show();
  return page;
}

function rowsOf(body) {
  const list = byClass(body, "session-list");
  assert.ok(list, "the body should hold the session list");
  return list.children;
}

function openButtonOf(row) {
  return byClass(row, "session-row__open");
}

function textColumnOf(row) {
  return byClass(openButtonOf(row), "session-row__text");
}

// The meta line under the title: the date, and the marker for a take read aloud.
function metaTextOf(row) {
  return byClass(textColumnOf(row), "session-row__date").textContent;
}

// What a browser's textContent would return: the node's own text followed by its children's.
function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

// [tag, class] of each child, the shape of a row part.
function shapeOf(node) {
  return node.children.map((child) => [child.tagName, child.className]);
}

test("a take read aloud says Read after its date; a talk take's is its date alone", async () => {
  const { app, body } = await shown(EVERY_KIND);
  const date = (session) => app.ui.formatDate(session.createdAt);
  assert.deepEqual(rowsOf(body).map(metaTextOf), [
    date(TALK),
    date(READ_TAB) + MARKER,
    date(COLD_READ) + MARKER,
    date(BENCHMARK_TALK),
    date(BENCHMARK_READ) + MARKER,
    date(PASTED) + MARKER,
  ]);
});

test("a pasted script followed on Talk says Read, the kind Progress charts it as", async () => {
  const strayed = take("strayed", 6, "free-talk", "About you");
  const { app, body } = await shown([PASTED, strayed]);
  const [followed, talked] = rowsOf(body);
  assert.equal(metaTextOf(followed), app.ui.formatDate(PASTED.createdAt) + MARKER);
  assert.equal(metaTextOf(talked), app.ui.formatDate(strayed.createdAt), "no script block: talk");
});

test("the marker is words in the muted meta line: no color, no extra part", async () => {
  const { body } = await shown([TALK, READ_TAB]);
  const [talkRow, readRow] = rowsOf(body);
  assert.deepEqual(shapeOf(textColumnOf(readRow)), [
    ["div", "session-row__title"],
    ["div", "session-row__date"],
  ]);
  const meta = byClass(textColumnOf(readRow), "session-row__date");
  assert.equal(meta.children.length, 0, "plain text: no tag, icon or colored span");
  assert.deepEqual(shapeOf(openButtonOf(readRow)), shapeOf(openButtonOf(talkRow)));
  assert.deepEqual(shapeOf(readRow), shapeOf(talkRow), "the same open button and trash button");
  const words = fullText(openButtonOf(readRow));
  assert.equal(words.split("Read").length - 1, 1, "the row says Read once: " + words);
  assert.equal(fullText(openButtonOf(talkRow)).includes("Read"), false);
});

test("the delete control still names the take by its date alone", async () => {
  const { app, body } = await shown([READ_TAB]);
  const [row] = rowsOf(body);
  const trash = row.children[row.children.length - 1];
  assert.equal(
    trash.getAttribute("aria-label"),
    "Delete session from " + app.ui.formatDate(READ_TAB.createdAt),
  );
});

test("without language.js, or without its rule, every row is talk and none says Read", async () => {
  for (const language of ["none", {}, { isReadTake: "not a function" }]) {
    const { app, body } = await shown(EVERY_KIND, { language });
    assert.deepEqual(
      rowsOf(body).map(metaTextOf),
      EVERY_KIND.map((session) => app.ui.formatDate(session.createdAt)),
    );
  }
});

test("app.language.isReadTake alone decides, asked about each take", async () => {
  const asked = [];
  const language = {
    isReadTake: (session) => {
      asked.push(session.id);
      return session.id === "talk";
    },
  };
  // The rule says the opposite of the passages: history.js must not judge a take by its passage.
  const { app, body } = await shown([TALK, READ_TAB], { language });
  assert.deepEqual(rowsOf(body).map(metaTextOf), [
    app.ui.formatDate(TALK.createdAt) + MARKER,
    app.ui.formatDate(READ_TAB.createdAt),
  ]);
  assert.ok(asked.includes("talk"), "the rule is asked about the talk take");
  assert.ok(asked.includes("read-tab"), "and about the Read tab take");
});

// history.js without its block comments and its whole-line // comments, so only code is left.
function codeOf(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// As backend/tests/test_frontend_copy.py keeps each fixed sentence in one string literal, the
// marker's word lives in one literal, so a wording change is made in one place.
test("the marker's word is one string literal in history.js", () => {
  assert.equal(codeOf(HISTORY_SOURCE).split('"Read"').length - 1, 1);
});
