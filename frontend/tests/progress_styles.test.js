// Text checks on section 10 of frontend/styles.css, the Progress screen's own rules (DESIGN.md
// section 6, "Chart"): every summary value keeps the section-title size, bold, on one line, and
// the cells make room for it through the grid instead (Latest and Best side by side on a phone,
// the change from the average across the row under them, three in a row from 600px). At 200%
// zoom (section 9) the options and cells reflow and the hidden table stays narrow. "Need two
// sessions" sits centered above the nav with a full-width button, as in the approved draft.
// Spacing comes from the --s scale only. The node suite has no layout engine, so these pin the
// rules; the screenshot loop checks how they render.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const SECTION_START = "/* 10. Progress screen";
const SECTION_END = "/* 11. Reduced motion */";

const VALUE = ".progress-summary__value";
const CHANGE = ".progress-summary__change";
const LAST_CELL = ".progress-summary__item:last-child";
const WIDE = "@media (min-width: 600px)";

// 200% zoom on a 320 or 375 phone leaves a 160 or 187px viewport (DESIGN.md section 9: the
// layout survives 200% zoom).
const ZOOMED = "@media (max-width: 299px)";

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

// Splits CSS into rules: { at, selectors, declarations }, where `at` is the enclosing @-rule
// prelude or null and `selectors` the comma-separated list. Enough for this stylesheet, which
// never puts a brace or a comma inside a string.
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
      const selectors = prelude.split(",").map(squash);
      rules.push({ at, selectors, declarations: declarationsOf(body) });
    }
    cursor = close + 1;
  }
  return rules;
}

function sectionText() {
  const start = CSS.indexOf(SECTION_START);
  const end = CSS.indexOf(SECTION_END);
  assert.ok(start !== -1 && end > start, "styles.css should keep section 10 before section 11");
  return withoutComments(CSS.slice(start, end));
}

const RULES = parseRules(sectionText());

// Every declaration for `selector` under `at` (null for no @-rule), later rules winning.
function declared(selector, at = null) {
  return RULES.filter((rule) => rule.at === at && rule.selectors.includes(selector)).reduce(
    (all, rule) => Object.assign(all, rule.declarations),
    {},
  );
}

test("every summary value is the section-title size, bold and on one line", () => {
  for (const selector of [VALUE, CHANGE]) {
    const own = declared(selector);
    assert.equal(own["font-size"], "var(--fs-h2)", selector);
    assert.equal(own["font-weight"], "700", selector);
    assert.equal(own["white-space"], "nowrap", selector);
  }
});

test("no width query shrinks or lightens a summary value", () => {
  const overrides = RULES.filter(
    (rule) =>
      rule.at !== null &&
      rule.selectors.some((selector) => selector === VALUE || selector === CHANGE) &&
      ("font-size" in rule.declarations || "font-weight" in rule.declarations),
  );
  assert.deepEqual(
    overrides.map((rule) => `${rule.at} ${rule.selectors.join(", ")}`),
    [],
    "the cells make room instead (DESIGN.md section 6: dd.num is --fs-h2, 700, no-wrap)",
  );
});

test("on a phone Latest and Best share a row and the change spans the row under them", () => {
  const columns = declared(".progress-summary")["grid-template-columns"];
  assert.equal(columns, "repeat(2, minmax(0, 1fr))");
  assert.equal(declared(LAST_CELL)["grid-column"], "1 / -1");
});

test("from 600px the three cells share one row", () => {
  // At 600px each third holds about 160px of text, room for "123.4 s shorter" and its triangle.
  assert.equal(
    declared(".progress-summary", WIDE)["grid-template-columns"],
    "repeat(3, minmax(0, 1fr))",
  );
  assert.equal(declared(LAST_CELL, WIDE)["grid-column"], "auto");
});

test("the hidden table's caption wraps, so the table never widens a narrow page", () => {
  // .sr-only sets nowrap, and a table is at least as wide as its caption: "Longest clean
  // stretch by session" held it 237px wide, wider than the page at 200% zoom.
  assert.equal(declared("#screen-progress table.sr-only caption")["white-space"], "normal");
});

test("under 300px the options form two rows of two and the summary cells stack", () => {
  const segmented = declared("#screen-progress .segmented", ZOOMED);
  assert.equal(segmented["grid-auto-flow"], "row");
  assert.equal(segmented["grid-template-columns"], "repeat(2, minmax(0, 1fr))");
  assert.equal(declared(".progress-summary", ZOOMED)["grid-template-columns"], "minmax(0, 1fr)");
});

test("under 300px only the change from the average may wrap, between its words", () => {
  // At 160px a full-width cell holds 110px of text; "12.5 s shorter" and its triangle need 138.
  assert.equal(declared(CHANGE, ZOOMED)["white-space"], "normal");
  assert.equal(declared(VALUE, ZOOMED)["white-space"], undefined, "Latest and Best still fit");
});

// Only the active screen matches, so the hidden one keeps .screen[hidden]'s display: none.
const EMPTY_SCREEN = "#screen-progress.screen--active:has(.state)";

test("Need two sessions sits centered in the free height above the nav", () => {
  // As in the approved draft: the active screen fills the window inside main's padding, its
  // body takes the height under the heading, and .state's auto margins center the block.
  const screen = declared(EMPTY_SCREEN);
  assert.equal(screen.display, "flex");
  assert.equal(screen["flex-direction"], "column");
  assert.equal(
    screen["min-height"],
    "calc(100dvh - var(--s-4) - var(--nav-h) - var(--s-5) - env(safe-area-inset-bottom))",
    "main's top and bottom padding come off the window height",
  );
  const body = declared(EMPTY_SCREEN + " .screen__body");
  assert.equal(body.display, "flex");
  assert.equal(body["flex-direction"], "column");
  assert.equal(body.flex, "1 0 auto");
});

test("its Record button spans the block, 32px under the words", () => {
  const action = declared("#screen-progress .state__action");
  assert.equal(action["align-self"], "stretch");
  // .state already puts --s-3 between its children, so the button's margin adds the rest.
  assert.equal(action["margin-top"], "calc(var(--s-6) - var(--s-3))");
});

test("section 10 spaces only with the --s scale", () => {
  const spacing = /^(margin|padding|gap|row-gap|column-gap)(-(top|right|bottom|left))?$/;
  const step = /^(0|auto|var\(--s-[1-7]\))$/;
  const stepSum = /^calc\(var\(--s-[1-7]\) [-+] var\(--s-[1-7]\)\)$/;
  RULES.forEach((rule) => {
    Object.entries(rule.declarations)
      .filter(([name, value]) => spacing.test(name) && !stepSum.test(value))
      .forEach(([name, value]) => {
        value.split(" ").forEach((part) => {
          assert.match(part, step, `${rule.selectors.join(", ")} ${name}: ${value}`);
        });
      });
  });
});
