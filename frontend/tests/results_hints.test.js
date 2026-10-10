// Tests for the Results hints, meta line and not-found icon (DESIGN.md section 6; audit M4,
// M10 and M11). A warning hint is rust with the alert icon and an in-target hint is green with
// the check icon; each icon is appended after the words and drawn first with CSS, so the hint's
// own text stays exactly the words. The meta line keeps the date, and the time used for a timed
// preset, in no-wrap spans. A missing session shows the search icon.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const SOURCES = ["ui.js", "delivery.js", path.join("screens", "results.js")].map((file) => [
  file,
  fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8"),
]);
const CSS = fs.readFileSync(path.join(FRONTEND_DIR, "styles.css"), "utf8");

const SVG_NS = "http://www.w3.org/2000/svg";
const CREATED_AT = "2026-10-09T22:21:00.000Z";
const PASSAGES = [
  { id: "gettysburg", targetWpm: [130, 150] },
  { id: "congress-speech", targetWpm: [130, 160], timeLimitSeconds: 180 },
];

function session(metrics, overrides) {
  return {
    id: "s1",
    createdAt: CREATED_AT,
    passageId: "gettysburg",
    passageTitle: "Gettysburg Address, opening",
    durationSeconds: 31.2,
    metrics: {
      words_per_minute: 140,
      duration: 30,
      word_count: 70,
      fillers: {},
      pauses: [],
      repeats: [],
      pace_windows: [],
      ...metrics,
    },
    transcript: [],
    ...overrides,
  };
}

async function showResults(stored, id) {
  const routes = [];
  const context = {
    app: {
      screens: {},
      passages: PASSAGES.map((entry) => ({ ...entry })),
      store: { get: (wanted) => Promise.resolve(stored[wanted]) },
      router: { go: (name) => routes.push(name) },
    },
    document: fakeDocument(),
  };
  SOURCES.forEach(([file, source]) => vm.runInNewContext(source, context, { filename: file }));
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  await context.app.screens.results.show({ id });
  return { app: context.app, body, routes };
}

function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

function childShape(node) {
  return node.children.map((child) =>
    child.nodeType === 3 ? "#" + child.textContent : child.className,
  );
}

function hintsOf(body) {
  return byClass(body, "metric-grid").children.map((card) => byClass(card, "metric-card__hint"));
}

// [words, class, icon name of the last child] for a hint.
function hintShape(hint) {
  const icon = hint.children[hint.children.length - 1];
  return [hint.textContent, hint.className, icon ? icon.getAttribute("data-icon") : null];
}

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
  const declarations = {};
  body.split(";").forEach((part) => {
    const colon = part.indexOf(":");
    if (colon !== -1) {
      declarations[squash(part.slice(0, colon))] = squash(part.slice(colon + 1));
    }
  });
  return declarations;
}

// Every rule as { at, selector, declarations }; `at` is the enclosing @-rule prelude or null.
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

const RULES = parseRules(CSS.replace(/\/\*[\s\S]*?\*\//g, ""));

// The declarations of the rule outside any @-rule whose selector list holds this selector.
function ruleFor(selector) {
  const rule = RULES.find(
    (candidate) =>
      candidate.at === null && candidate.selector.split(",").map(squash).includes(selector),
  );
  assert.ok(rule, `styles.css needs a rule for ${selector}`);
  return rule.declarations;
}

test("warning hints keep their words and class and end with the alert icon", async () => {
  const fast = session({ words_per_minute: 162, fillers: { um: 9 } });
  const slow = session({ words_per_minute: 120 }, { id: "s2" });
  const fastHints = hintsOf((await showResults({ s1: fast }, "s1")).body);
  const slowHints = hintsOf((await showResults({ s2: slow }, "s2")).body);
  assert.deepEqual(hintShape(fastHints[0]), [
    "Slow down",
    "metric-card__hint metric-card__hint--warn",
    "alert",
  ]);
  assert.deepEqual(hintShape(fastHints[1]), [
    "Aim for under 3",
    "metric-card__hint metric-card__hint--warn",
    "alert",
  ]);
  assert.deepEqual(hintShape(slowHints[0]), [
    "Speed up",
    "metric-card__hint metric-card__hint--warn",
    "alert",
  ]);
});

test("in-target hints keep their words and class and end with the check icon", async () => {
  const hints = hintsOf((await showResults({ s1: session() }, "s1")).body);
  assert.deepEqual(hintShape(hints[0]), [
    "Target 130 to 150",
    "metric-card__hint metric-card__hint--ok",
    "check",
  ]);
  assert.deepEqual(hintShape(hints[1]), [
    "Target under 3",
    "metric-card__hint metric-card__hint--ok",
    "check",
  ]);
  assert.equal(hints[2], undefined);
  assert.equal(hints[3], undefined);
});

test("a hint icon is its only child: a decorative svg in the SVG namespace", async () => {
  const { body } = await showResults({ s1: session({ words_per_minute: 200 }) }, "s1");
  hintsOf(body).slice(0, 2).forEach((hint) => {
    assert.equal(hint.children.length, 1);
    const [icon] = hint.children;
    assert.equal(icon.tagName, "svg");
    assert.equal(icon.namespaceURI, SVG_NS);
    assert.equal(icon.getAttribute("aria-hidden"), "true");
  });
});

test("the hint is a 600-weight flex row whose icon is drawn before the words", () => {
  const hint = ruleFor(".metric-card__hint");
  assert.equal(hint.display, "flex");
  assert.equal(hint.gap, "var(--s-1)");
  assert.equal(hint["font-size"], "var(--fs-small)");
  assert.equal(hint["font-weight"], "600");
  const icon = ruleFor(".metric-card__hint svg");
  assert.equal(icon.order, "-1");
  assert.equal(icon.flex, "none");
  assert.equal(ruleFor(".metric-card__hint--warn").color, "var(--warn)");
  assert.equal(ruleFor(".metric-card__hint--ok").color, "var(--ok)");
});

test("the meta line is the title, then the date in its own span", async () => {
  const { app, body } = await showResults({ s1: session() }, "s1");
  const meta = byClass(body, "results__meta");
  assert.equal(meta.className, "results__meta num");
  assert.deepEqual(childShape(meta), ["#Gettysburg Address, opening · ", "results__date"]);
  assert.equal(byClass(meta, "results__date").textContent, app.ui.formatDate(CREATED_AT));
  assert.equal(byClass(meta, "results__time-used"), undefined);
});

test("a timed preset adds the time used in a second span", async () => {
  const timed = session(
    { duration: 30 },
    { passageId: "congress-speech", passageTitle: "Congress speech" },
  );
  const { app, body } = await showResults({ s1: timed }, "s1");
  const meta = byClass(body, "results__meta");
  assert.deepEqual(childShape(meta), [
    "#Congress speech · ",
    "results__date",
    "# · ",
    "results__time-used",
  ]);
  assert.equal(
    fullText(meta),
    "Congress speech · " + app.ui.formatDate(CREATED_AT) + " · 0:30 of 3:00",
  );
});

test("a session without a title still gets a clean meta line", async () => {
  const untitled = session({}, { passageTitle: undefined });
  const { app, body } = await showResults({ s1: untitled }, "s1");
  const meta = byClass(body, "results__meta");
  assert.equal(fullText(meta), app.ui.formatDate(CREATED_AT));
  assert.ok(!fullText(meta).includes("undefined"));
});

test("the date and the time used never break across lines", () => {
  assert.equal(ruleFor(".results__date")["white-space"], "nowrap");
  assert.equal(ruleFor(".results__time-used")["white-space"], "nowrap");
});

test("the meta line reads as the title's subtitle, --s-1 under the Results heading", () => {
  assert.equal(ruleFor("#screen-results h1")["margin-bottom"], "var(--s-1)");
});

test("a missing session shows the search icon above Session not found", async () => {
  const { body, routes } = await showResults({}, "nope");
  const block = body.children[0];
  assert.equal(block.className, "state state--empty");
  const [icon, title] = block.children;
  assert.equal(icon.getAttribute("data-icon"), "search");
  assert.equal(icon.getAttribute("class"), "state__icon");
  assert.equal(title.textContent, "Session not found");
  block.children[3].click();
  assert.deepEqual(routes, ["history"]);
});
