// Tests for frontend/screens/history.js (app.screens.history). formatStats() runs with no
// `document` and a stub app.screens.results.summarize, exactly as the brief describes; mount/show
// run against the shared fake DOM with the real ui.js loaded into the same vm context, a fake
// app.store that serves and deletes sessions from a list, and a fake app.router that records
// where every tap sends the user.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const HISTORY_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "screens", "history.js"),
  "utf8",
);
const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

const STUB_SUMMARY = { wpm: 152, fillersPerMinute: 3.1 };
const ZERO_SUMMARY = { wpm: 0, fillersPerMinute: 0 };
const STUB_STATS = "152 wpm · 3.1 per min";
const ZERO_STATS = "0 wpm · 0.0 per min";

const DELETE_BUTTON_CLASS = "btn btn--ghost session-row__delete";
const CONFIRM_CLASS = "session-row__confirm";
const EMPTY_STATE_CLASS = "state state--empty";

// Two stored sessions, already newest first, the order app.store.list() hands them over in.
const NEWER = {
  id: "s2",
  createdAt: "2026-10-10T09:05:00.000Z",
  passageId: "free-talk",
  passageTitle: "Free talk",
  durationSeconds: 42,
  metrics: {},
  transcript: [],
};
const OLDER = {
  id: "s1",
  createdAt: "2026-10-09T22:21:00.000Z",
  passageId: "gettysburg",
  passageTitle: "Gettysburg Address, opening",
  durationSeconds: 31.2,
  metrics: {},
  transcript: [],
};

function bareApp() {
  return {
    screens: { results: { summarize: () => ({ ...STUB_SUMMARY }) } },
    ui: {},
    store: {},
    router: {},
  };
}

// Loads history.js with no document and a stub summarize, exactly as the brief describes.
function loadPure() {
  const context = { app: bareApp() };
  vm.runInNewContext(HISTORY_SOURCE, context, { filename: "history.js" });
  return { app: context.app, history: context.app.screens.history };
}

// Loads ui.js then history.js against the fake document. The store serves `sessions` as given
// (newest first, as the real store sorts) and drops whatever remove() is given; every list,
// remove and route call is recorded. Route params are copied into this realm so deepEqual works.
function mountHistory(sessions) {
  const document = fakeDocument();
  const calls = { lists: 0, removes: [], routes: [] };
  const context = { app: bareApp(), document };
  let stored = [...sessions];
  context.app.store.list = () => {
    calls.lists += 1;
    return Promise.resolve([...stored]);
  };
  context.app.store.remove = (id) => {
    calls.removes.push(id);
    stored = stored.filter((session) => session.id !== id);
    return Promise.resolve();
  };
  context.app.router.go = (name, params) => {
    calls.routes.push({ name, id: params ? params.id : undefined });
  };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(HISTORY_SOURCE, context, { filename: "history.js" });

  const root = new FakeElement("section");
  const heading = new FakeElement("h1");
  heading.textContent = "History";
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(heading);
  root.appendChild(body);

  const history = context.app.screens.history;
  history.mount(root);
  return { app: context.app, history, body, calls };
}

// What a browser's textContent would return: the node's own text followed by its children's.
function fullText(node) {
  const own = node.textContent || "";
  const children = node.children || [];
  return own + children.map(fullText).join("");
}

function rowsOf(body) {
  const list = byClass(body, "session-list");
  assert.ok(list, "the body should hold the session list");
  return list.children;
}

function openButtonOf(row) {
  return byClass(row, "session-row__open");
}

function titleOf(row) {
  return byClass(byClass(openButtonOf(row), "session-row__text"), "session-row__title").textContent;
}

// The Delete button or the "Delete? Yes / No" prompt: always the row's last child.
function deleteControlOf(row) {
  return row.children[row.children.length - 1];
}

function yesButtonOf(row) {
  return deleteControlOf(row).children[1];
}

// Lets a click handler's promise chain (remove, then show, then render) run to the end.
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("history.js registers app.screens.history and touches no DOM at load time", () => {
  const { app, history } = loadPure();
  assert.deepEqual(Object.keys(app.screens).sort(), ["history", "results"]);
  for (const name of ["mount", "show", "hide", "formatStats"]) {
    assert.equal(typeof history[name], "function", `history.${name} should be a function`);
  }
});

test("formatStats gives '152 wpm · 3.1 per min' from the stub summary", () => {
  const { history } = loadPure();
  assert.equal(history.formatStats(OLDER), STUB_STATS);
});

test("formatStats reads summarize at call time: the zero stub gives '0 wpm · 0.0 per min'", () => {
  const { app, history } = loadPure();
  assert.equal(history.formatStats(OLDER), STUB_STATS);
  app.screens.results.summarize = () => ({ ...ZERO_SUMMARY });
  assert.equal(history.formatStats(OLDER), ZERO_STATS);
});

test("formatStats hands the session itself to summarize", () => {
  const { app, history } = loadPure();
  const seen = [];
  app.screens.results.summarize = (session) => {
    seen.push(session);
    return { ...STUB_SUMMARY };
  };
  history.formatStats(NEWER);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], NEWER);
});

test("show() with no sessions renders No sessions yet with a Record action", async () => {
  const { history, body, calls } = mountHistory([]);
  await history.show();
  assert.equal(calls.lists, 1);
  assert.equal(body.children.length, 1);
  const block = body.children[0];
  assert.equal(block.className, EMPTY_STATE_CLASS);
  assert.equal(block.getAttribute("role"), null);
  const [icon, title, text, action] = block.children;
  assert.equal(icon.tagName, "svg");
  assert.equal(title.textContent, "No sessions yet");
  assert.equal(text.textContent, "Your first recording will show up here.");
  assert.equal(action.className, "state__action btn btn--secondary");
  assert.equal(fullText(action), "Record");
  action.click();
  assert.deepEqual(calls.routes, [{ name: "practice", id: undefined }]);
});

test("show() lists the sessions in store order: title over date, stats, Delete", async () => {
  const { app, history, body } = mountHistory([NEWER, OLDER]);
  await history.show();

  assert.equal(body.children.length, 1);
  const list = body.children[0];
  assert.equal(list.tagName, "ul");
  assert.equal(list.className, "session-list");
  const rows = list.children;
  assert.equal(rows.length, 2);
  rows.forEach((row) => {
    assert.equal(row.tagName, "li");
    assert.equal(row.className, "session-row");
    assert.equal(row.children.length, 2);
  });
  assert.deepEqual(rows.map(titleOf), ["Free talk", "Gettysburg Address, opening"]);

  const open = openButtonOf(rows[0]);
  assert.equal(open, rows[0].children[0]);
  assert.equal(open.tagName, "button");
  assert.equal(open.getAttribute("type"), "button");
  const [text, stats] = open.children;
  assert.equal(text.tagName, "div");
  assert.equal(text.className, "session-row__text");
  assert.deepEqual(
    text.children.map((child) => [child.tagName, child.className, child.textContent]),
    [
      ["div", "session-row__title", "Free talk"],
      ["div", "session-row__date", app.ui.formatDate(NEWER.createdAt)],
    ],
  );
  assert.equal(stats.tagName, "span");
  assert.equal(stats.className, "session-row__stats num");
  assert.equal(stats.textContent, STUB_STATS);

  const remove = deleteControlOf(rows[0]);
  assert.equal(remove.tagName, "button");
  assert.equal(remove.className, DELETE_BUTTON_CLASS);
  assert.equal(remove.getAttribute("type"), "button");
  assert.equal(remove.textContent, "Delete");
  assert.equal(
    remove.getAttribute("aria-label"),
    "Delete session from " + app.ui.formatDate(NEWER.createdAt),
  );
  assert.equal(
    deleteControlOf(rows[1]).getAttribute("aria-label"),
    "Delete session from " + app.ui.formatDate(OLDER.createdAt),
  );
});

test("each row's stats come from summarize of that session", async () => {
  const { app, history, body } = mountHistory([NEWER, OLDER]);
  app.screens.results.summarize = (session) =>
    session.id === "s2" ? { wpm: 160, fillersPerMinute: 1 } : { wpm: 120.4, fillersPerMinute: 4.25 };
  await history.show();
  const stats = rowsOf(body).map((row) => byClass(openButtonOf(row), "session-row__stats"));
  assert.deepEqual(
    stats.map((node) => node.textContent),
    ["160 wpm · 1.0 per min", "120.4 wpm · 4.3 per min"],
  );
});

test("tapping a row opens its Results by id", async () => {
  const { history, body, calls } = mountHistory([NEWER, OLDER]);
  await history.show();
  const [newerRow, olderRow] = rowsOf(body);
  openButtonOf(olderRow).click();
  openButtonOf(newerRow).click();
  assert.deepEqual(calls.routes, [
    { name: "results", id: "s1" },
    { name: "results", id: "s2" },
  ]);
});

test("Delete swaps to 'Delete? Yes / No' and No puts the Delete button back", async () => {
  const { app, history, body, calls } = mountHistory([NEWER, OLDER]);
  await history.show();
  const row = rowsOf(body)[0];
  deleteControlOf(row).click();

  assert.equal(row.children.length, 2);
  assert.equal(openButtonOf(row), row.children[0], "the open button stays in place");
  assert.equal(byClass(row, "session-row__delete"), undefined, "the Delete button is gone");
  const confirm = deleteControlOf(row);
  assert.equal(confirm.tagName, "span");
  assert.equal(confirm.className, CONFIRM_CLASS);
  assert.equal(confirm.children.length, 3);
  const [prompt, yes, no] = confirm.children;
  assert.equal(prompt.nodeType, 3, "'Delete?' is a plain text node");
  assert.equal(prompt.textContent, "Delete?");
  assert.deepEqual(
    [yes, no].map((button) => [
      button.tagName,
      button.className,
      button.textContent,
      button.getAttribute("type"),
    ]),
    [
      ["button", "btn btn--danger", "Yes", "button"],
      ["button", "btn btn--ghost", "No", "button"],
    ],
  );

  no.click();
  await settle();
  const restored = deleteControlOf(row);
  assert.equal(restored.className, DELETE_BUTTON_CLASS);
  assert.equal(restored.textContent, "Delete");
  assert.equal(
    restored.getAttribute("aria-label"),
    "Delete session from " + app.ui.formatDate(NEWER.createdAt),
  );
  assert.deepEqual(calls.removes, []);
  assert.equal(calls.lists, 1, "No never reloads the list");
  assert.deepEqual(rowsOf(body).map(titleOf), ["Free talk", "Gettysburg Address, opening"]);
});

test("Yes removes that session and redraws the list from the store", async () => {
  const { history, body, calls } = mountHistory([NEWER, OLDER]);
  await history.show();
  deleteControlOf(rowsOf(body)[0]).click();
  yesButtonOf(rowsOf(body)[0]).click();
  await settle();

  assert.deepEqual(calls.removes, ["s2"]);
  assert.equal(calls.lists, 2, "the list is read again after the delete");
  const rows = rowsOf(body);
  assert.deepEqual(rows.map(titleOf), ["Gettysburg Address, opening"]);
  assert.equal(deleteControlOf(rows[0]).className, DELETE_BUTTON_CLASS);
});

test("deleting the last session shows the empty state", async () => {
  const { history, body, calls } = mountHistory([OLDER]);
  await history.show();
  deleteControlOf(rowsOf(body)[0]).click();
  yesButtonOf(rowsOf(body)[0]).click();
  await settle();
  assert.deepEqual(calls.removes, ["s1"]);
  assert.equal(body.children.length, 1);
  assert.equal(body.children[0].className, EMPTY_STATE_CLASS);
});

test("only one row confirms at a time: opening another resets the first", async () => {
  const { history, body } = mountHistory([NEWER, OLDER]);
  await history.show();
  const [first, second] = rowsOf(body);

  deleteControlOf(first).click();
  assert.equal(deleteControlOf(first).className, CONFIRM_CLASS);
  assert.equal(deleteControlOf(second).className, DELETE_BUTTON_CLASS);

  deleteControlOf(second).click();
  assert.equal(deleteControlOf(first).className, DELETE_BUTTON_CLASS);
  assert.equal(deleteControlOf(second).className, CONFIRM_CLASS);

  // The Delete button that came back still opens the prompt and closes the other one.
  deleteControlOf(first).click();
  assert.equal(deleteControlOf(first).className, CONFIRM_CLASS);
  assert.equal(deleteControlOf(second).className, DELETE_BUTTON_CLASS);
  rowsOf(body).forEach((row) => assert.equal(row.children.length, 2));
});

test("a store that cannot be read shows the empty state instead of throwing", async () => {
  const { app, history, body } = mountHistory([NEWER]);
  app.store.list = () => Promise.reject(new Error("IndexedDB is unavailable"));
  await assert.doesNotReject(() => history.show());
  assert.equal(body.children.length, 1);
  assert.equal(body.children[0].className, EMPTY_STATE_CLASS);
});

test("a failed remove keeps the row and still redraws the list", async () => {
  const { app, history, body, calls } = mountHistory([NEWER, OLDER]);
  app.store.remove = () => Promise.reject(new Error("IndexedDB is unavailable"));
  await history.show();
  deleteControlOf(rowsOf(body)[0]).click();
  yesButtonOf(rowsOf(body)[0]).click();
  await settle();
  assert.equal(calls.lists, 2);
  const rows = rowsOf(body);
  assert.deepEqual(rows.map(titleOf), ["Free talk", "Gettysburg Address, opening"]);
  rows.forEach((row) => assert.equal(deleteControlOf(row).className, DELETE_BUTTON_CLASS));
});

test("show() rebuilds the body each time, dropping an open prompt; hide() leaves it alone", async () => {
  const { history, body } = mountHistory([NEWER, OLDER]);
  await history.show();
  deleteControlOf(rowsOf(body)[0]).click();
  assert.equal(deleteControlOf(rowsOf(body)[0]).className, CONFIRM_CLASS);

  await history.show();
  assert.equal(body.children.length, 1, "a second show replaces the list, never stacks");
  const rows = rowsOf(body);
  assert.equal(rows.length, 2);
  rows.forEach((row) => assert.equal(deleteControlOf(row).className, DELETE_BUTTON_CLASS));

  assert.doesNotThrow(() => history.hide());
  assert.equal(body.children.length, 1);
  assert.equal(rowsOf(body).length, 2);
});

test("when two loads overlap, the later show wins", async () => {
  const { app, history, body } = mountHistory([]);
  let releaseFirst = null;
  const first = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let listCalls = 0;
  app.store.list = () => {
    listCalls += 1;
    return listCalls === 1 ? first : Promise.resolve([NEWER]);
  };

  const pendingSlow = history.show();
  await history.show();
  releaseFirst([NEWER, OLDER]);
  await pendingSlow;

  assert.deepEqual(rowsOf(body).map(titleOf), ["Free talk"], "the slow load must not paint over");
});
