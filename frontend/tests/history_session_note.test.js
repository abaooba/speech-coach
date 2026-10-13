// Tests for History's note that the server has ended this device's session (frontend/screens/
// history.js, docs/PLAN.md T49). The device is then a guest's: the account's takes still show,
// but nothing syncs until the speaker logs in again, so one line above the takes says so and
// points to the Account link in the header. History asks app.auth.syncStatus(), and says nothing
// without it. Runs history.js with the real ui.js on the shared fake DOM, plus insertBefore.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, FakeTextNode } = require("./fake-dom");

const source = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const HISTORY_SOURCE = source("screens", "history.js");
const UI_SOURCE = source("ui.js");
const CSS = source("styles.css");

const NOTE = "Your session has ended. Log in again from Account to sync your takes.";
const ENDED = { endedSession: { email: "ann@example.com", takesHere: 1 }, takesNotKept: 0 };
const SUMMARY = { wpm: 150, fillersPerMinute: 1, target: [140, 160] };

// FakeElement with the one DOM method the note needs on top of the shared fake.
class ElementWithInsert extends FakeElement {
  insertBefore(child, before) {
    const index = before ? this.children.indexOf(before) : this.children.length;
    if (index === -1) {
      throw new Error("insertBefore: not a child");
    }
    this.children.splice(index, 0, child);
    return child;
  }
}

function session(id) {
  return {
    id,
    createdAt: "2026-10-12T09:30:00.000Z",
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 31,
    metrics: { words_per_minute: 150 },
    transcript: [],
  };
}

// History on `sessions` (or app.store.list itself, when a function), with `auth` as app.auth
// (undefined for none).
function mountHistory(sessions, auth) {
  const document = {
    createElement: (tag) => new ElementWithInsert(tag),
    createElementNS: (namespace, tag) => new ElementWithInsert(tag, namespace),
    createTextNode: (text) => new FakeTextNode(text),
    getElementById: () => null,
  };
  const app = {
    screens: { results: { summarize: () => SUMMARY } },
    store: { list: typeof sessions === "function" ? sessions : async () => sessions },
    router: { go: () => {} },
  };
  if (auth !== undefined) {
    app.auth = auth;
  }
  const realm = { app, document };
  vm.runInNewContext(UI_SOURCE, realm, { filename: "ui.js" });
  vm.runInNewContext(HISTORY_SOURCE, realm, { filename: "history.js" });
  const root = new ElementWithInsert("section");
  const body = new ElementWithInsert("div");
  body.className = "screen__body";
  root.appendChild(body);
  const screen = realm.app.screens.history;
  screen.mount(root);
  return { screen, body };
}

function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

function classesOf(body) {
  return body.children.map((child) => child.className);
}

test("once the server ends the session, a note above the takes says to log in again", async () => {
  const { screen, body } = mountHistory([session("take-1")], { syncStatus: async () => ENDED });

  await screen.show();

  assert.deepEqual(classesOf(body), ["history__note", "session-list"]);
  assert.equal(body.children[0].tagName, "p");
  assert.equal(fullText(body.children[0]), NOTE);
});

test("a list that meets the 401 itself shows the note on that same visit", async () => {
  // The device was signed in until the list History asks for got a 401 (store.js endSessionOf).
  let status = { endedSession: null, takesNotKept: 0 };
  const list = async () => {
    await Promise.resolve();
    status = ENDED;
    return [session("take-1")];
  };
  const { screen, body } = mountHistory(list, { syncStatus: async () => status });

  await screen.show();

  assert.deepEqual(classesOf(body), ["history__note", "session-list"]);
});

test("with no takes, the note sits above the empty state", async () => {
  const { screen, body } = mountHistory([], { syncStatus: async () => ENDED });

  await screen.show();

  assert.deepEqual(classesOf(body), ["history__note", "state state--empty"]);
});

test("no note while signed in, for a plain guest, without app.auth, or when it fails", async () => {
  const cases = [
    { syncStatus: async () => ({ endedSession: null, takesNotKept: 2 }) },
    undefined,
    {},
    { syncStatus: async () => Promise.reject(new Error("IndexedDB failed")) },
  ];
  for (const auth of cases) {
    const { screen, body } = mountHistory([session("take-1")], auth);
    await screen.show();
    assert.deepEqual(classesOf(body), ["session-list"]);
  }
});

test("the note is small, muted text with room under it", () => {
  const match = CSS.match(/\n\.history__note\s*\{([^}]*)\}/);
  assert.ok(match, "styles.css has a .history__note rule");
  assert.match(match[1], /font-size:\s*var\(--fs-small\);/);
  assert.match(match[1], /color:\s*var\(--muted\);/);
  assert.match(match[1], /margin:\s*0 0 var\(--s-4\);/);
});
