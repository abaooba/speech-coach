// Tests for the History row revamp (DESIGN.md section 6, "Session row", and section 9): the
// "/min" stats, the muted trash button, the labelled "Delete? Yes / No" group, where keyboard
// focus lands through a delete, the "Session deleted" announcement, the mic on the empty state
// and the row grid in styles.css section 9. ui.js and screens/history.js run against the shared
// fake DOM; elements made here also record focus() calls, which fake-dom.js does not have.
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
const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

const SVG_NS = "http://www.w3.org/2000/svg";
const STUB_SUMMARY = { wpm: 152, fillersPerMinute: 3.1 };
const DELETED = "Session deleted";

// Three stored sessions, newest first, the order app.store.list() hands them over in.
const NEWEST = {
  id: "s3",
  createdAt: "2026-10-10T09:05:00.000Z",
  passageId: "free-talk",
  passageTitle: "Your day",
  durationSeconds: 42,
  metrics: {},
  transcript: [],
};
const MIDDLE = {
  id: "s2",
  createdAt: "2026-10-09T22:21:00.000Z",
  passageId: "gettysburg",
  passageTitle: "Gettysburg Address, opening",
  durationSeconds: 31.2,
  metrics: {},
  transcript: [],
};
const OLDEST = {
  id: "s1",
  createdAt: "2026-10-08T15:30:00.000Z",
  passageId: "henry",
  passageTitle: "Give me liberty",
  durationSeconds: 55,
  metrics: {},
  transcript: [],
};

// The shared fake document, except that every element it makes also takes focus: each focus()
// call pushes the element onto focusLog, in order.
function focusRecordingDocument(focusLog, byId) {
  class FocusableElement extends FakeElement {
    focus() {
      focusLog.push(this);
    }
  }
  return {
    ...fakeDocument(byId),
    createElement: (tagName) => new FocusableElement(tagName),
    createElementNS: (namespaceURI, tagName) => new FocusableElement(tagName, namespaceURI),
  };
}

// Loads ui.js then history.js. The store serves `sessions` (newest first) and drops whatever
// remove() is given; the router records every route. With `focus: false` the elements have no
// focus(), like the shared fakes, so the screen must skip every focus move.
function mountHistory(sessions, options = {}) {
  const focusLog = [];
  const live = new FakeElement("div");
  const document =
    options.focus === false
      ? fakeDocument({ live })
      : focusRecordingDocument(focusLog, { live });
  const calls = { lists: 0, removes: [], routes: [] };
  let stored = [...sessions];
  const app = {
    screens: { results: { summarize: () => ({ ...STUB_SUMMARY }) } },
    store: {
      list: () => {
        calls.lists += 1;
        return Promise.resolve([...stored]);
      },
      remove: (id) => {
        calls.removes.push(id);
        stored = stored.filter((session) => session.id !== id);
        return Promise.resolve();
      },
    },
    router: {
      go: (name, params) => calls.routes.push({ name, id: params ? params.id : undefined }),
    },
  };
  const context = { app, document };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(HISTORY_SOURCE, context, { filename: "history.js" });

  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  const history = app.screens.history;
  history.mount(root);
  return { app, history, body, calls, live, focusLog };
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
  const text = byClass(openButtonOf(row), "session-row__text");
  return byClass(text, "session-row__title").textContent;
}

// The trash button or the "Delete? Yes / No" group: always the row's last child.
function controlOf(row) {
  return row.children[row.children.length - 1];
}

function answersOf(row) {
  const [, yes, no] = controlOf(row).children;
  return { yes, no };
}

// Lets a click handler's promise chain (remove, then show, then render) run to the end.
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("formatStats reads '152 wpm · 3.1 /min', the unit the Results card uses", () => {
  const { history } = mountHistory([]);
  assert.equal(history.formatStats(NEWEST), "152 wpm · 3.1 /min");
});

test("each row's stats line reads wpm and fillers per minute as '/min'", async () => {
  const { app, history, body } = mountHistory([NEWEST, MIDDLE]);
  app.screens.results.summarize = (session) =>
    session.id === "s3" ? { wpm: 141, fillersPerMinute: 3 } : { wpm: 76, fillersPerMinute: 21.4 };
  await history.show();
  const stats = rowsOf(body).map((row) => byClass(openButtonOf(row), "session-row__stats"));
  assert.deepEqual(
    stats.map((node) => [node.tagName, node.className, node.textContent]),
    [
      ["span", "session-row__stats num", "141 wpm · 3.0 /min"],
      ["span", "session-row__stats num", "76 wpm · 21.4 /min"],
    ],
  );
});

test("delete is a muted trash icon button named after the session's date", async () => {
  const { app, history, body } = mountHistory([NEWEST, MIDDLE]);
  await history.show();
  const rows = rowsOf(body);
  rows.forEach((row, index) => {
    const remove = controlOf(row);
    assert.equal(remove.tagName, "button");
    assert.equal(remove.className, "icon-btn session-row__delete");
    assert.equal(remove.getAttribute("type"), "button");
    const date = app.ui.formatDate([NEWEST, MIDDLE][index].createdAt);
    assert.equal(remove.getAttribute("aria-label"), "Delete session from " + date);
    assert.equal(remove.textContent, "", "no visible word: the label names the action");
    assert.equal(remove.children.length, 1);
    const [icon] = remove.children;
    assert.equal(icon.tagName, "svg");
    assert.equal(icon.namespaceURI, SVG_NS);
    assert.equal(icon.getAttribute("data-icon"), "trash");
    assert.equal(icon.getAttribute("aria-hidden"), "true");
  });
  const [first, second] = rows.map((row) => controlOf(row).children[0]);
  assert.notEqual(first, second, "every row draws its own icon");
});

test("the confirm is a labelled group: 'Delete?', then Yes and No", async () => {
  const { app, history, body } = mountHistory([NEWEST, MIDDLE]);
  await history.show();
  const row = rowsOf(body)[1];
  controlOf(row).click();

  const confirm = controlOf(row);
  assert.equal(confirm.tagName, "span");
  assert.equal(confirm.className, "session-row__confirm");
  assert.equal(confirm.getAttribute("role"), "group");
  const date = app.ui.formatDate(MIDDLE.createdAt);
  assert.equal(confirm.getAttribute("aria-label"), "Delete session from " + date + "?");
  assert.equal(confirm.children.length, 3);
  const [prompt, yes, no] = confirm.children;
  assert.equal(prompt.nodeType, 3);
  assert.equal(prompt.textContent, "Delete?");
  assert.deepEqual(
    [yes, no].map((button) => [button.className, button.textContent]),
    [
      ["btn btn--danger", "Yes"],
      ["btn btn--ghost", "No"],
    ],
  );
});

test("opening the confirm moves focus to No", async () => {
  const { history, body, focusLog } = mountHistory([NEWEST, MIDDLE]);
  await history.show();
  assert.deepEqual(focusLog, [], "showing the list moves no focus");
  const row = rowsOf(body)[0];
  controlOf(row).click();
  assert.deepEqual(focusLog, [answersOf(row).no]);
});

test("No brings the trash button back and focuses it", async () => {
  const { history, body, calls, focusLog } = mountHistory([NEWEST, MIDDLE]);
  await history.show();
  const row = rowsOf(body)[0];
  controlOf(row).click();
  answersOf(row).no.click();
  await settle();
  const restored = controlOf(row);
  assert.equal(restored.className, "icon-btn session-row__delete");
  assert.equal(focusLog[focusLog.length - 1], restored);
  assert.equal(focusLog.length, 2, "No, then the trash button");
  assert.deepEqual(calls.removes, []);
});

test("opening a second confirm closes the first without pulling focus back to it", async () => {
  const { history, body, focusLog } = mountHistory([NEWEST, MIDDLE]);
  await history.show();
  const [first, second] = rowsOf(body);
  controlOf(first).click();
  const firstNo = answersOf(first).no;
  controlOf(second).click();
  assert.equal(controlOf(first).className, "icon-btn session-row__delete");
  assert.deepEqual(focusLog, [firstNo, answersOf(second).no]);
});

test("Yes deletes, says 'Session deleted' and focuses the row now in that place", async () => {
  const { history, body, calls, live, focusLog } = mountHistory([NEWEST, MIDDLE, OLDEST]);
  await history.show();
  const row = rowsOf(body)[0];
  controlOf(row).click();
  answersOf(row).yes.click();
  await settle();

  assert.deepEqual(calls.removes, ["s3"]);
  const rows = rowsOf(body);
  assert.deepEqual(rows.map(titleOf), ["Gettysburg Address, opening", "Give me liberty"]);
  assert.equal(focusLog[focusLog.length - 1], openButtonOf(rows[0]));
  assert.equal(live.textContent, DELETED);
});

test("deleting the bottom row focuses the row now at the bottom", async () => {
  const { history, body, live, focusLog } = mountHistory([NEWEST, MIDDLE, OLDEST]);
  await history.show();
  const row = rowsOf(body)[2];
  controlOf(row).click();
  answersOf(row).yes.click();
  await settle();

  const rows = rowsOf(body);
  assert.deepEqual(rows.map(titleOf), ["Your day", "Gettysburg Address, opening"]);
  assert.equal(focusLog[focusLog.length - 1], openButtonOf(rows[1]));
  assert.equal(live.textContent, DELETED);
});

test("deleting the last session focuses the empty state's Record action", async () => {
  const { history, body, calls, live, focusLog } = mountHistory([OLDEST]);
  await history.show();
  const row = rowsOf(body)[0];
  controlOf(row).click();
  answersOf(row).yes.click();
  await settle();

  const block = body.children[0];
  assert.equal(block.className, "state state--empty");
  const action = byClass(block, "state__action");
  assert.ok(action, "the empty state has its Record action");
  assert.equal(focusLog[focusLog.length - 1], action);
  assert.equal(live.textContent, DELETED);
  action.click();
  assert.deepEqual(calls.routes, [{ name: "practice", id: undefined }]);
});

test("after Yes, focus stays put when a newer show() started during the redraw", async () => {
  const { app, history, body, live, focusLog } = mountHistory([NEWEST, MIDDLE]);
  await history.show();
  const serve = app.store.list;
  let release = null;
  app.store.list = () => {
    app.store.list = serve;
    return new Promise((resolve) => {
      release = () => resolve(serve());
    });
  };

  const row = rowsOf(body)[0];
  controlOf(row).click();
  const focusesBeforeYes = focusLog.length;
  answersOf(row).yes.click();
  await settle();
  assert.equal(typeof release, "function", "the redraw after Yes is waiting on the store");
  await history.show();
  release();
  await settle();

  assert.deepEqual(rowsOf(body).map(titleOf), ["Gettysburg Address, opening"]);
  assert.equal(focusLog.length, focusesBeforeYes, "the newer visit keeps focus where it is");
  assert.equal(live.textContent, DELETED, "the session was still deleted");
});

test("a failed delete announces nothing and focuses the row still in that place", async () => {
  const { app, history, body, live, focusLog } = mountHistory([NEWEST, MIDDLE]);
  app.store.remove = () => Promise.reject(new Error("IndexedDB is unavailable"));
  await history.show();
  const row = rowsOf(body)[0];
  controlOf(row).click();
  answersOf(row).yes.click();
  await settle();

  const rows = rowsOf(body);
  assert.deepEqual(rows.map(titleOf), ["Your day", "Gettysburg Address, opening"]);
  assert.equal(focusLog[focusLog.length - 1], openButtonOf(rows[0]));
  assert.equal(live.textContent, "", "nothing was deleted, so nothing is announced");
});

test("every focus move is skipped when elements have no focus()", async () => {
  const { history, body, live } = mountHistory([NEWEST, MIDDLE], { focus: false });
  await history.show();
  const row = rowsOf(body)[0];
  assert.equal(typeof openButtonOf(row).focus, "undefined");
  controlOf(row).click();
  answersOf(row).no.click();
  controlOf(row).click();
  answersOf(row).yes.click();
  await settle();
  assert.deepEqual(rowsOf(body).map(titleOf), ["Gettysburg Address, opening"]);
  assert.equal(live.textContent, DELETED);
});

test("the empty state shows the mic icon", async () => {
  const { history, body } = mountHistory([]);
  await history.show();
  const [icon, title] = body.children[0].children;
  assert.equal(icon.tagName, "svg");
  assert.equal(icon.getAttribute("data-icon"), "mic");
  assert.equal(icon.getAttribute("class"), "state__icon");
  assert.equal(title.textContent, "No sessions yet");
});

// styles.css section 9, parsed into { at, selector, declarations } rules (enough for this
// stylesheet, which never puts a brace inside a string).
const HISTORY_SECTION_START = "/* 9. History screen";
const HISTORY_SECTION_END = "/* 10. Progress screen";

function squash(text) {
  return text.replace(/\s+/g, " ").trim();
}

function historyCss() {
  const start = CSS.indexOf(HISTORY_SECTION_START);
  const end = CSS.indexOf(HISTORY_SECTION_END);
  assert.ok(start !== -1 && end > start, "styles.css keeps section 9 before section 10");
  return CSS.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
}

function closingBrace(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") {
      depth += 1;
    } else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error("styles.css has an unbalanced brace");
}

function declarationsOf(body) {
  const declarations = {};
  body.split(";").forEach((part) => {
    const colon = part.indexOf(":");
    if (colon !== -1) {
      declarations[squash(part.slice(0, colon))] = squash(part.slice(colon + 1));
    }
  });
  return declarations;
}

function parseRules(text, at = null, rules = []) {
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("{", cursor);
    if (open === -1) {
      break;
    }
    const prelude = squash(text.slice(cursor, open));
    const close = closingBrace(text, open);
    const body = text.slice(open + 1, close);
    if (prelude.startsWith("@")) {
      parseRules(body, prelude, rules);
    } else {
      rules.push({ at, selector: prelude, declarations: declarationsOf(body) });
    }
    cursor = close + 1;
  }
  return rules;
}

const RULES = parseRules(historyCss());
const WIDE = "@media (min-width: 480px)";

function ruleFor(selector, at = null) {
  const rule = RULES.find((candidate) => candidate.selector === selector && candidate.at === at);
  assert.ok(rule, `styles.css section 9 has no rule for ${at ? at + " " : ""}${selector}`);
  return rule.declarations;
}

test("the open button is a grid that keeps the stats under the title on a phone", () => {
  const open = ruleFor(".session-row__open");
  assert.equal(open.display, "grid");
  assert.equal(open["min-width"], undefined, "it never shrinks under the stats line");
  assert.equal(ruleFor(".session-row__text")["min-width"], "0");
  assert.equal(ruleFor(".session-row__date")["white-space"], "nowrap");
  const stats = ruleFor(".session-row__stats");
  assert.equal(stats["white-space"], "nowrap");
  assert.notEqual(stats["margin-left"], "auto", "no drift to the right (audit M5)");
});

test("from 480px the stats sit at the right of the title and date", () => {
  const open = ruleFor(".session-row__open", WIDE);
  assert.equal(open["grid-template-columns"], "minmax(0, 1fr) auto");
  assert.equal(ruleFor(".session-row__stats", WIDE)["justify-self"], "end");
});

test("from 480px an open confirm keeps a clear gap after the right-aligned stats", () => {
  assert.equal(ruleFor(".session-row__confirm", WIDE)["margin-left"], "var(--s-5)");
});

test("a narrow row lets the open confirm drop below the stats, at the right", () => {
  const row = ruleFor(".session-row");
  assert.equal(row.display, "flex");
  assert.equal(row["flex-wrap"], "wrap");
  assert.equal(ruleFor(".session-row__confirm")["margin-left"], "auto");
});

test("section 9 spaces only from --s-*, sizes type from --fs-* and colors from tokens", () => {
  const spacing = /^(margin|padding)(-[a-z]+)?$|^(row-|column-)?gap$/;
  const spacingValue = /^(0|auto|var\(--s-[1-7]\))$/;
  RULES.forEach(({ selector, declarations }) => {
    Object.entries(declarations).forEach(([name, value]) => {
      if (spacing.test(name)) {
        const where = `${selector} ${name}`;
        value.split(" ").forEach((part) => assert.match(part, spacingValue, where));
      }
      if (name === "font-size") {
        assert.match(value, /^var\(--fs-[a-z0-9-]+\)$/, selector);
      }
      if (name === "color" || name === "background") {
        assert.match(value, /^(transparent|var\(--[a-z-]+\))$/, `${selector} ${name}`);
      }
    });
  });
});
