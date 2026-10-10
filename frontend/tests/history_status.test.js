// Tests for the History status words (DESIGN.md section 6, "Session row", and section 8):
// statusFor(summary) names what missed its target, pace first, then fillers, or says "On target";
// each row shows it as span.session-row__status after the stats, with the check or alert icon
// drawn before the words. The pure tests run history.js with no document; the row tests use the
// shared fake DOM; one test runs the real passages, delivery and results modules end to end.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

function source(...parts) {
  return fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
}

const HISTORY_SOURCE = source("screens", "history.js");
const UI_SOURCE = source("ui.js");
const CSS = source("styles.css");

const SVG_NS = "http://www.w3.org/2000/svg";
const BAND = [140, 160];
const ON_TARGET = { text: "On target", tone: "ok" };

// Loads history.js with no document, as the "touches no DOM at load time" test does.
function loadPure() {
  const context = { app: { screens: { results: { summarize: () => ({}) } } } };
  vm.runInNewContext(HISTORY_SOURCE, context, { filename: "history.js" });
  return context.app.screens.history;
}

const statusFor = loadPure().statusFor;

// Copies the result into this realm, so deepEqual compares plain values.
function statusOf(summary) {
  const status = statusFor(summary);
  return status === null ? null : { ...status };
}

function warn(text) {
  return { text, tone: "warn" };
}

test("statusFor is exported next to formatStats", () => {
  const history = loadPure();
  assert.equal(typeof history.statusFor, "function");
  assert.equal(typeof history.formatStats, "function");
});

test("statusFor gives null when nothing was measured: wpm at or below 0, or missing", () => {
  assert.equal(statusFor({ wpm: 0, fillersPerMinute: 0, target: BAND }), null);
  assert.equal(statusFor({ wpm: 0, fillersPerMinute: 5, target: BAND }), null);
  assert.equal(statusFor({ wpm: -12, fillersPerMinute: 1, target: BAND }), null);
  assert.equal(statusFor({ fillersPerMinute: 1, target: BAND }), null);
  assert.equal(statusFor({ wpm: Number.NaN, fillersPerMinute: 1, target: BAND }), null);
});

test("pace inside the band, both ends included, with fillers at 3 or under is On target", () => {
  for (const wpm of [140, 150, 160]) {
    for (const fillersPerMinute of [0, 2.9, 3]) {
      assert.deepEqual(statusOf({ wpm, fillersPerMinute, target: BAND }), ON_TARGET);
    }
  }
});

test("pace under the band is Too slow, over it Too fast", () => {
  const cases = [
    [{ wpm: 139, fillersPerMinute: 1, target: BAND }, "Too slow"],
    [{ wpm: 76, fillersPerMinute: 3, target: [130, 150] }, "Too slow"],
    [{ wpm: 161, fillersPerMinute: 0, target: BAND }, "Too fast"],
    [{ wpm: 175, fillersPerMinute: 1.2, target: [130, 160] }, "Too fast"],
  ];
  cases.forEach(([summary, text]) => assert.deepEqual(statusOf(summary), warn(text)));
});

test("fillers over 3 a minute miss, even just over", () => {
  const high = warn("Fillers over 3");
  assert.deepEqual(statusOf({ wpm: 150, fillersPerMinute: 3.1, target: BAND }), high);
  assert.deepEqual(statusOf({ wpm: 140, fillersPerMinute: 21.4, target: BAND }), high);
});

test("both misses are joined by a middle dot, pace first", () => {
  assert.deepEqual(
    statusOf({ wpm: 76, fillersPerMinute: 21.4, target: [130, 150] }),
    warn("Too slow · Fillers over 3"),
  );
  assert.deepEqual(
    statusOf({ wpm: 190, fillersPerMinute: 4, target: BAND }),
    warn("Too fast · Fillers over 3"),
  );
});

test("pace is checked only against a two-number target", () => {
  const notBands = [undefined, null, [], [140], [140, 160, 180], ["140", "160"], [140, NaN], {}];
  notBands.forEach((target) => {
    const where = JSON.stringify(target === undefined ? "undefined" : target);
    assert.deepEqual(statusOf({ wpm: 40, fillersPerMinute: 1, target }), ON_TARGET, where);
    assert.deepEqual(
      statusOf({ wpm: 400, fillersPerMinute: 9, target }),
      warn("Fillers over 3"),
      where,
    );
  });
});

test("the History test stubs, which carry no target, still get a status", () => {
  assert.deepEqual(statusOf({ wpm: 152, fillersPerMinute: 3.1 }), warn("Fillers over 3"));
  assert.deepEqual(statusOf({ wpm: 160, fillersPerMinute: 1 }), ON_TARGET);
  assert.deepEqual(statusOf({ wpm: 120.4, fillersPerMinute: 4.25 }), warn("Fillers over 3"));
  assert.equal(statusFor({ wpm: 0, fillersPerMinute: 0 }), null);
});

test("statusFor is pure: a fresh object each call and the summary left as it was", () => {
  const summary = { wpm: 76, fillersPerMinute: 21.4, target: [130, 150] };
  const first = statusFor(summary);
  const second = statusFor(summary);
  assert.notEqual(first, second);
  assert.deepEqual(Object.keys(first).sort(), ["text", "tone"]);
  assert.deepEqual(summary, { wpm: 76, fillersPerMinute: 21.4, target: [130, 150] });
});

// Two stored sessions, newest first.
const NEWER = {
  id: "s2",
  createdAt: "2026-10-10T15:30:00.000Z",
  passageId: "gettysburg-opening",
  passageTitle: "Gettysburg Address, opening",
  durationSeconds: 33,
  metrics: {},
  transcript: [],
};
const OLDER = {
  id: "s1",
  createdAt: "2026-10-08T15:30:00.000Z",
  passageId: "free-talk",
  passageTitle: "Your day",
  durationSeconds: 60,
  metrics: {},
  transcript: [],
};

// Loads ui.js then history.js against the fake document, with a store serving `sessions` and
// summarize answering from `summaries` by session id. Every summarize call is recorded.
function mountHistory(sessions, summaries) {
  const seen = [];
  const app = {
    screens: {
      results: {
        summarize: (session) => {
          seen.push(session.id);
          return { ...summaries[session.id] };
        },
      },
    },
    store: { list: () => Promise.resolve([...sessions]), remove: () => Promise.resolve() },
    router: { go: () => {} },
  };
  const context = { app, document: fakeDocument() };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(HISTORY_SOURCE, context, { filename: "history.js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  app.screens.history.mount(root);
  return { history: app.screens.history, body, seen };
}

function openButtonsOf(body) {
  return byClass(body, "session-list").children.map((row) => byClass(row, "session-row__open"));
}

test("each row shows its status after the stats, the icon after the words", async () => {
  const { history, body } = mountHistory([NEWER, OLDER], {
    s2: { wpm: 76, fillersPerMinute: 21.4, target: [130, 150] },
    s1: { wpm: 152, fillersPerMinute: 1, target: BAND },
  });
  await history.show();
  const rows = openButtonsOf(body).map((open) => {
    const [text, stats, status] = open.children;
    assert.equal(open.children.length, 3);
    assert.equal(text.className, "session-row__text");
    assert.equal(stats.className, "session-row__stats num");
    return status;
  });
  assert.deepEqual(
    rows.map((status) => [status.tagName, status.className, status.textContent]),
    [
      ["span", "session-row__status session-row__status--warn", "Too slow · Fillers over 3"],
      ["span", "session-row__status session-row__status--ok", "On target"],
    ],
  );
  assert.deepEqual(
    rows.map((status) =>
      status.children.map((icon) => [
        icon.tagName,
        icon.namespaceURI,
        icon.getAttribute("data-icon"),
        icon.getAttribute("aria-hidden"),
      ]),
    ),
    [[["svg", SVG_NS, "alert", "true"]], [["svg", SVG_NS, "check", "true"]]],
  );
});

test("a row with nothing measured shows its stats and no status", async () => {
  const { history, body } = mountHistory([NEWER, OLDER], {
    s2: { wpm: 0, fillersPerMinute: 0, target: [130, 150] },
    s1: { wpm: 150, fillersPerMinute: 2 },
  });
  await history.show();
  const [empty, measured] = openButtonsOf(body);
  assert.equal(empty.children.length, 2);
  assert.equal(byClass(empty, "session-row__stats").textContent, "0 wpm · 0.0 /min");
  assert.equal(byClass(empty, "session-row__status"), undefined);
  assert.equal(byClass(measured, "session-row__status").textContent, "On target");
});

test("show() summarizes each session once for both the stats and the status", async () => {
  const { history, seen } = mountHistory([NEWER, OLDER], {
    s2: { wpm: 76, fillersPerMinute: 21.4, target: [130, 150] },
    s1: { wpm: 152, fillersPerMinute: 1, target: BAND },
  });
  await history.show();
  assert.deepEqual(seen, ["s2", "s1"]);
});

test("real summaries from the passages and the delivery rules get the right status", () => {
  const context = { app: { screens: {} }, document: fakeDocument() };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(source("passages.js"), context, { filename: "passages.js" });
  vm.runInNewContext(source("delivery.js"), context, { filename: "delivery.js" });
  vm.runInNewContext(source("screens", "results.js"), context, { filename: "results.js" });
  vm.runInNewContext(HISTORY_SOURCE, context, { filename: "history.js" });
  const { results, history } = context.app.screens;

  // A take saved without words, scored from the backend tallies over one minute.
  function take(passageId, wpm, ums) {
    const metrics = { words_per_minute: wpm, duration: 60, word_count: wpm, fillers: { um: ums } };
    return { passageId, metrics: { ...metrics, pauses: [], repeats: [] }, transcript: [] };
  }
  const cases = [
    [take("free-talk", 128, 4), "Too slow · Fillers over 3", "warn"],
    [take("free-talk", 141, 3), "On target", "ok"],
    [take("free-talk", 160, 1), "On target", "ok"],
    [take("gettysburg-opening", 152, 1), "Too fast", "warn"],
    [take("congress-speech", 146, 10), "Fillers over 3", "warn"],
    [take("no-such-passage", 139, 0), "Too slow", "warn"],
  ];
  cases.forEach(([session, text, tone]) => {
    const status = history.statusFor(results.summarize(session));
    assert.deepEqual({ ...status }, { text, tone }, `${session.passageId} ${text}`);
  });
  assert.equal(history.statusFor(results.summarize(take("free-talk", 0, 0))), null);
});

// styles.css section 9, parsed into { at, selector, declarations } rules (enough for this
// stylesheet, which never puts a brace inside a string): the status line is micro and 600, ok
// and warn take their tokens, and the icon, appended after the words, is drawn first.
function squash(text) {
  return text.replace(/\s+/g, " ").trim();
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
  const found = {};
  body.split(";").forEach((part) => {
    const colon = part.indexOf(":");
    if (colon !== -1) {
      found[squash(part.slice(0, colon))] = squash(part.slice(colon + 1));
    }
  });
  return found;
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

function historyRules() {
  const start = CSS.indexOf("/* 9. History screen");
  const end = CSS.indexOf("/* 10. Progress screen");
  assert.ok(start !== -1 && end > start, "styles.css keeps section 9 before section 10");
  return parseRules(CSS.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, ""));
}

function declarations(selector, at = null) {
  const rule = historyRules().find((each) => each.selector === selector && each.at === at);
  assert.ok(rule, `styles.css section 9 has no rule for ${at ? at + " " : ""}${selector}`);
  return rule.declarations;
}

test("the status line is micro type at 600, ok in --ok and warn in --warn", () => {
  const status = declarations(".session-row__status");
  assert.equal(status["font-size"], "var(--fs-micro)");
  assert.equal(status["font-weight"], "600");
  assert.equal(status.display, "flex");
  assert.equal(status.gap, "var(--s-1)");
  assert.equal(declarations(".session-row__status--ok").color, "var(--ok)");
  assert.equal(declarations(".session-row__status--warn").color, "var(--warn)");
  const icon = declarations(".session-row__status svg");
  assert.equal(icon.order, "-1", "the icon comes after the words but is drawn first");
  assert.equal(icon.flex, "none");
});

test("every figure in a row is tabular: the stats, the date and the status", () => {
  ["session-row__date", "session-row__status"].forEach((name) => {
    assert.equal(declarations("." + name)["font-variant-numeric"], "tabular-nums", name);
  });
});

test("from 480px the status sits under the stats, at the right", () => {
  const wide = "@media (min-width: 480px)";
  assert.equal(
    declarations(".session-row__open", wide)["grid-template-areas"],
    '"text stats" "text status"',
  );
  const status = declarations(".session-row__status", wide);
  assert.equal(status["grid-area"], "status");
  assert.equal(status["justify-self"], "end");
  assert.equal(status["white-space"], "nowrap", "a tight row moves the prompt, not the words");
});
