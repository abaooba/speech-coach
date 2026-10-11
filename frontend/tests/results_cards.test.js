// Tests for the revamped Results metric cards (DESIGN.md sections 3, 5 and 6; audit H4, H5 and
// H7): short sentence-case labels, the "/min" unit, a value line that never wraps apart from
// its unit, and the card layout in styles.css (a subgrid inside @supports with a flex-column
// fallback, 2 x 2 at every width, tighter cards under 360px). The DOM half mounts the real
// ui.js, delivery.js and results.js against the shared fake DOM; the CSS half reads styles.css.
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

const SUBGRID_SUPPORTS = "@supports (grid-template-rows: subgrid)";
const NARROW_MEDIA = "@media (max-width: 359px)";

const SESSION = {
  id: "s1",
  createdAt: "2026-10-09T22:21:00.000Z",
  passageId: "gettysburg",
  passageTitle: "Gettysburg Address, opening",
  durationSeconds: 31.2,
  metrics: {
    words_per_minute: 162.4,
    duration: 30,
    word_count: 81,
    fillers: { um: 6, uh: 3 },
    pauses: [
      [9.9, 2.2],
      [20, 1.6],
    ],
    repeats: [],
    pace_windows: [],
  },
  transcript: [],
};

async function showCards(session) {
  const context = {
    app: {
      screens: {},
      passages: [{ id: "gettysburg", targetWpm: [130, 150] }],
      store: { get: () => Promise.resolve(session) },
      router: { go() {} },
    },
    document: fakeDocument(),
  };
  SOURCES.forEach(([file, source]) => vm.runInNewContext(source, context, { filename: file }));
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  await context.app.screens.results.show({ id: session.id });
  return byClass(body, "metric-grid").children;
}

// One string per child: "#<text>" for a text node, the class list for an element.
function childShape(node) {
  return node.children.map((child) =>
    child.nodeType === 3 ? "#" + child.textContent : child.className,
  );
}

function squash(text) {
  return text.replace(/\s+/g, " ").trim();
}

function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
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

const RULES = parseRules(withoutComments(CSS));

function ruleFor(selector, at = null) {
  const rule = RULES.find((candidate) => candidate.selector === selector && candidate.at === at);
  assert.ok(rule, `styles.css needs a rule for ${at ? at + " " : ""}${selector}`);
  return rule.declarations;
}

test("the four cards read Pace, Fillers, Mid-sentence pauses and Clean stretch", async () => {
  const cards = await showCards(SESSION);
  assert.deepEqual(
    cards.map((card) => byClass(card, "metric-card__label").textContent),
    ["Pace", "Fillers", "Mid-sentence pauses", "Clean stretch"],
  );
});

test("each value line is the number, one space and the unit, with /min for fillers", async () => {
  const cards = await showCards(SESSION);
  assert.deepEqual(
    cards.map((card) => childShape(byClass(card, "metric-card__value"))),
    [
      ["#162", "# ", "metric-card__unit"],
      ["#18", "# ", "metric-card__unit"],
      ["#2"],
      ["#0", "# ", "metric-card__unit"],
    ],
  );
  const values = cards.map((card) => byClass(card, "metric-card__value"));
  const units = values.map((value) => byClass(value, "metric-card__unit"));
  assert.deepEqual(
    units.map((unit) => (unit ? unit.textContent : null)),
    ["wpm", "/min", null, "s"],
  );
});

test("the grid is 2 x 2 from 240px up; only 200% zoom on a phone stacks the cards", () => {
  assert.equal(ruleFor(".metric-grid")["grid-template-columns"], "1fr 1fr");
  const zoomed = "@media (max-width: 239px)";
  const overrides = RULES.filter(
    (rule) => rule.selector === ".metric-grid" && rule.at !== null,
  ).filter((rule) => "grid-template-columns" in rule.declarations);
  assert.deepEqual(
    overrides.map((rule) => [rule.at, rule.declarations["grid-template-columns"]]),
    [[zoomed, "minmax(0, 1fr)"]],
    "the 600px four-up rule is gone; a 160 to 187px window stacks the cards",
  );
  const stacked = RULES.find(
    (rule) => rule.selector === ".metric-card:nth-child(n + 2)" && rule.at === zoomed,
  );
  assert.ok(stacked, "stacked cards keep the --s-3 the second grid row gets");
  assert.equal(stacked.declarations["margin-top"], "var(--s-3)");
});

test("a value never wraps apart from its unit, and labels wrap instead of truncating", () => {
  const value = ruleFor(".metric-card__value");
  assert.equal(value["white-space"], "nowrap");
  assert.equal(value.display, "flex", "one flex line: the space node never becomes a break");
  assert.equal(value["align-items"], "baseline");
  assert.equal(value.gap, "var(--s-1)");
  const label = ruleFor(".metric-card__label");
  assert.equal(label["font-size"], "var(--fs-small)");
  assert.equal(label.color, "var(--muted)");
  const labelRules = RULES.filter((rule) => rule.selector.includes(".metric-card__label"));
  labelRules.forEach((rule) => {
    assert.ok(!("text-overflow" in rule.declarations), "labels never truncate");
    assert.notEqual(rule.declarations["white-space"], "nowrap", "labels wrap");
  });
});

test("cards share a four-row subgrid inside @supports, with a flex-column fallback", () => {
  const fallback = ruleFor(".metric-card");
  assert.equal(fallback.display, "flex");
  assert.equal(fallback["flex-direction"], "column");

  const card = ruleFor(".metric-card", SUBGRID_SUPPORTS);
  assert.equal(card.display, "grid");
  assert.equal(card["grid-row"], "span 4");
  assert.equal(card["grid-template-rows"], "subgrid");
  const rows = ["label", "value", "hint", "delta"].map(
    (part) => ruleFor(".metric-card__" + part, SUBGRID_SUPPORTS)["grid-row"],
  );
  assert.deepEqual(rows, ["1", "2", "3", "4"]);
  assert.equal(ruleFor(".metric-card__value", SUBGRID_SUPPORTS)["align-self"], "end");
  assert.equal(
    ruleFor(".metric-card__hint", SUBGRID_SUPPORTS)["align-self"],
    "start",
    "a one-line hint stays under its value when the other card's hint wraps",
  );
});

test("under 360px the cards pad --s-3 and the values drop to --fs-metric-narrow", () => {
  assert.equal(ruleFor(".metric-card", NARROW_MEDIA).padding, "var(--s-3)");
  const narrowValue = ruleFor(".metric-card__value", NARROW_MEDIA);
  assert.equal(narrowValue["font-size"], "var(--fs-metric-narrow)");
  assert.equal(ruleFor(".metric-card__value")["font-size"], "var(--fs-metric)");
});

test("every figure on Results uses tabular numbers, hints and headline included", () => {
  assert.equal(ruleFor("#screen-results")["font-variant-numeric"], "tabular-nums");
});
