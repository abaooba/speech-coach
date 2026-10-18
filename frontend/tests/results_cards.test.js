// Tests for the Results stat strip (DESIGN.md sections 3, 5 and 6): short sentence-case labels,
// the "/min" unit, a value line that never wraps apart from its unit, and the strip's layout in
// styles.css (one surface band with hairlines between its cells: 2 x 2 on a phone, four across
// from 600px, stacked at 200% zoom), plus the wide window's two-column Results. The DOM half
// mounts the real ui.js, delivery.js and results.js against the shared fake DOM; the CSS half
// reads styles.css.
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

const WIDE_MEDIA = "@media (min-width: 600px)";
const ZOOMED_MEDIA = "@media (max-width: 239px)";

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
  return byClass(body, "stat-strip").children;
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

test("the four stats read Pace, Fillers, Pauses and Clean stretch", async () => {
  const cards = await showCards(SESSION);
  assert.deepEqual(
    cards.map((card) => byClass(card, "stat__label").textContent),
    ["Pace", "Fillers", "Pauses", "Clean stretch"],
  );
});

test("each value line is the number, one space and the unit, with /min for fillers", async () => {
  const cards = await showCards(SESSION);
  assert.deepEqual(
    cards.map((card) => childShape(byClass(card, "stat__value"))),
    [
      ["#162", "# ", "stat__unit"],
      ["#18", "# ", "stat__unit"],
      ["#2", "# ", "stat__unit"],
      ["#0", "# ", "stat__unit"],
    ],
  );
  const values = cards.map((card) => byClass(card, "stat__value"));
  const units = values.map((value) => byClass(value, "stat__unit"));
  assert.deepEqual(
    units.map((unit) => (unit ? unit.textContent : null)),
    ["wpm", "/min", "pauses", "s"],
  );
});

test("the strip is 2 x 2 on a phone, four across from 600px, stacked at 200% zoom", () => {
  assert.equal(ruleFor(".stat-strip")["grid-template-columns"], "repeat(2, minmax(0, 1fr))");
  const overrides = RULES.filter(
    (rule) => rule.selector === ".stat-strip" && rule.at !== null,
  ).filter((rule) => "grid-template-columns" in rule.declarations);
  assert.deepEqual(
    overrides.map((rule) => [rule.at, rule.declarations["grid-template-columns"]]),
    [
      [WIDE_MEDIA, "repeat(4, minmax(0, 1fr))"],
      [ZOOMED_MEDIA, "minmax(0, 1fr)"],
    ],
  );
});

test("the strip is one surface band; hairlines, not cards, divide its cells", () => {
  const strip = ruleFor(".stat-strip");
  assert.equal(strip.display, "grid");
  assert.equal(strip.background, "var(--surface)");
  assert.equal(strip.border, "1px solid var(--border)");
  assert.equal(strip["border-radius"], "var(--r-card)");
  assert.equal(strip["margin-top"], "var(--s-5)");
  const cell = ruleFor(".stat");
  assert.equal(cell.padding, "var(--s-3)");
  assert.equal(cell.background, undefined, "a cell draws no card of its own");
  assert.equal(cell.border, undefined);
  // 2 x 2: the right cell of each row has a line on its left, the second row one on top.
  assert.equal(ruleFor(".stat:nth-child(even)")["border-left"], "1px solid var(--border)");
  assert.equal(ruleFor(".stat:nth-child(n + 3)")["border-top"], "1px solid var(--border)");
  // Four across: every cell after the first has a line on its left and none on top.
  assert.equal(
    ruleFor(".stat:nth-child(n + 2)", WIDE_MEDIA)["border-left"],
    "1px solid var(--border)",
  );
  assert.equal(ruleFor(".stat:nth-child(n + 3)", WIDE_MEDIA)["border-top"], "0");
  // Stacked: a line on top of every cell after the first, none on the left.
  assert.equal(ruleFor(".stat:nth-child(even)", ZOOMED_MEDIA)["border-left"], "0");
  assert.equal(
    ruleFor(".stat:nth-child(n + 2)", ZOOMED_MEDIA)["border-top"],
    "1px solid var(--border)",
  );
});

test("a value never wraps apart from its unit, and labels wrap instead of truncating", () => {
  const value = ruleFor(".stat__value");
  assert.equal(value["white-space"], "nowrap");
  assert.equal(value.display, "flex", "one flex line: the space node never becomes a break");
  assert.equal(value["align-items"], "baseline");
  assert.equal(value.gap, "var(--s-1)");
  const label = ruleFor(".stat__label");
  assert.equal(label["font-size"], "var(--fs-small)");
  assert.equal(label.color, "var(--muted)");
  const labelRules = RULES.filter((rule) => rule.selector.includes(".stat__label"));
  labelRules.forEach((rule) => {
    assert.ok(!("text-overflow" in rule.declarations), "labels never truncate");
    assert.notEqual(rule.declarations["white-space"], "nowrap", "labels wrap");
  });
});

test("a cell is a flex column whose value sinks to the bottom, so values line up", () => {
  const cell = ruleFor(".stat");
  assert.equal(cell.display, "flex");
  assert.equal(cell["flex-direction"], "column");
  assert.equal(cell.gap, "var(--s-1)");
  assert.equal(cell["min-width"], "0", "a cell shrinks below its longest word");
  assert.equal(ruleFor(".stat__value")["margin-top"], "auto");
});

test("the value is a compact --fs-h2 figure at 700 with a micro muted unit", () => {
  const value = ruleFor(".stat__value");
  assert.equal(value["font-size"], "var(--fs-h2)");
  assert.equal(value["font-weight"], "700");
  assert.equal(value["line-height"], "1.3");
  const unit = ruleFor(".stat__unit");
  assert.equal(unit["font-size"], "var(--fs-micro)");
  assert.equal(unit["font-weight"], "500");
  assert.equal(unit.color, "var(--muted)");
  const narrow = RULES.filter(
    (rule) => rule.selector.startsWith(".stat") && rule.at === "@media (max-width: 359px)",
  );
  assert.deepEqual(narrow, [], "no narrow-phone size step: the figure is small already");
});

test("every figure on Results uses tabular numbers, hints and headline included", () => {
  assert.equal(ruleFor("#screen-results")["font-variant-numeric"], "tabular-nums");
});

// The wide window (DESIGN.md section 3): from 1024px Results flows into two columns. The block
// sits inside @supports selector(:has(a)), since only :has widens main for Results; the parser
// records the innermost @-rule, the media query, as a rule's `at`.
const WIDE_WINDOW = "@media (min-width: 1024px)";
const BODY = "#screen-results > .screen__body";

test("from 1024px Results is two columns that break at Words to check or the Transcript", () => {
  assert.equal(ruleFor(BODY, WIDE_WINDOW).columns, "2");
  assert.equal(ruleFor(BODY, WIDE_WINDOW)["column-gap"], "var(--s-6)");
  assert.equal(
    ruleFor("main:has(> #screen-results.screen--active)", WIDE_WINDOW)["max-width"],
    "calc(var(--col-max) * 2 + var(--s-6))",
  );
  const spanning = [".results__meta", ".results__actions"]
    .map((part) => BODY + " > " + part)
    .join(", ");
  assert.equal(ruleFor(spanning, WIDE_WINDOW)["column-span"], "all");
  const heading = ruleFor(BODY + " > .transcript__heading", WIDE_WINDOW);
  assert.equal(heading["break-before"], "column");
  assert.equal(heading["margin-top"], "0");
  const words = ruleFor(BODY + " > .words-check", WIDE_WINDOW);
  assert.equal(words["break-before"], "column", "Words to check heads the right column");
  assert.equal(words["margin-top"], "0");
  const after = ruleFor(BODY + " > .words-check + .transcript__heading", WIDE_WINDOW);
  assert.equal(after["break-before"], "auto", "then the Transcript heading stays under it");
  assert.equal(ruleFor(BODY + " > *", WIDE_WINDOW)["break-inside"], "avoid");
  assert.equal(
    ruleFor(BODY + " > .transcript", WIDE_WINDOW)["break-inside"],
    "auto",
    "only the tall transcript may split between the columns",
  );
});

test("the two-column block waits for :has, so a browser without it keeps one column", () => {
  const css = withoutComments(CSS);
  const supports = css.indexOf("@supports selector(:has(a))");
  assert.ok(supports !== -1, "styles.css has the @supports wrapper");
  const open = css.indexOf("{", supports);
  const block = css.slice(open + 1, closingBrace(css, open));
  assert.ok(block.includes(WIDE_WINDOW), "the 1024px media query sits inside it");
  assert.ok(block.includes("columns: 2"), "and so do the columns");
  const outside = css.slice(0, supports) + css.slice(closingBrace(css, open) + 1);
  assert.ok(!outside.includes("columns: 2"), "no two-column rule outside the wrapper");
  assert.ok(!outside.includes(":has(> #screen-results"), "nor the widened main");
});
