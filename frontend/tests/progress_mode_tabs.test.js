// Text checks on the Talk | Read switch's look on Progress (docs/superpowers/specs/
// 2026-10-22-tester-feedback-design.md section 6). A tester never noticed that Talk and Read takes
// are charted apart: the switch was the same box as the Pace / Fillers / Pauses / Clean switch
// under it, so it read as one more filter. It is now drawn as a tab bar over two sets of charts:
// no box and no tint, body-size labels, a 1px hairline across the column and a 2px accent
// underline under the mode shown. Only section 10 of styles.css changes. The markup, a group of
// aria-pressed toggle buttons, stays as progress_talk_read.test.js pins it. The node suite has no
// layout engine, so these pin the rules; the screenshot loop checks how they render.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");

const CSS = read("styles.css");
const SECTION_START = "/* 10. Progress screen";
const SECTION_END = "/* 11. Reduced motion */";

const BAR = ".segmented.progress__modes";
const TAB = ".progress__modes .segmented__option";
const SHOWN = ".progress__modes .segmented__option--selected";

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

// Splits CSS into rules in source order: { at, selector, declarations }, where `at` is the
// enclosing @-rule prelude or null. Enough for this stylesheet, which never puts a brace inside a
// string.
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

function sectionText() {
  const start = CSS.indexOf(SECTION_START);
  const end = CSS.indexOf(SECTION_END);
  assert.ok(start !== -1 && end > start, "styles.css keeps section 10 before section 11");
  return withoutComments(CSS.slice(start, end));
}

const ALL_RULES = parseRules(withoutComments(CSS));
const SECTION_RULES = parseRules(sectionText());

// The declarations of section 10's one rule for `selector`, outside any @-rule.
function ruleOf(selector) {
  const matches = SECTION_RULES.filter((rule) => rule.at === null && rule.selector === selector);
  assert.equal(matches.length, 1, "section 10 has one rule for " + selector);
  return matches[0].declarations;
}

// Every rule that names the bar, as [at, selector] in source order.
function barRulesOf(rules) {
  return rules
    .filter((rule) => rule.selector.includes("progress__modes"))
    .map((rule) => [rule.at, rule.selector]);
}

test("the Talk | Read bar drops the segmented box: no fill, border, radius, gap or padding", () => {
  assert.deepEqual(ruleOf(BAR), {
    gap: "0",
    padding: "0",
    background: "transparent",
    border: "0",
    "border-radius": "0",
  });
});

test("each tab is 48px tall, body size, square, with a 1px hairline along its foot", () => {
  assert.deepEqual(ruleOf(TAB), {
    "min-height": "48px",
    "border-bottom": "1px solid var(--border)",
    "border-radius": "0",
    "font-size": "var(--fs-body)",
    "line-height": "1.5",
  });
});

test("the mode shown is text colour at 600 over a 2px accent underline, with no tint", () => {
  assert.deepEqual(ruleOf(SHOWN), {
    "border-bottom": "2px solid var(--accent)",
    background: "transparent",
    color: "var(--text)",
    "font-weight": "600",
  });
});

test("the underline rule comes after the tab rule, so its 2px foot replaces the hairline", () => {
  // Both selectors weigh two classes, so the later one wins border-bottom. Over section 4's
  // one-class rules (border 0, the --accent-soft tint, --accent text) they win wherever they sit.
  const indexOf = (selector) => SECTION_RULES.findIndex((rule) => rule.selector === selector);
  assert.ok(indexOf(TAB) !== -1, "section 10 has the tab rule");
  assert.ok(indexOf(SHOWN) > indexOf(TAB), "the selected rule comes after the tab rule");
});

test("those three rules are the bar's only ones: no focus ring, hover or width query", () => {
  // The shared inset ring (.segmented__option:focus-visible, outline-offset -3px) shows inside
  // each square tab, and under 300px section 10's #screen-progress .segmented rule keeps the two
  // tabs one row of two.
  const expected = [
    [null, BAR],
    [null, TAB],
    [null, SHOWN],
  ];
  assert.deepEqual(barRulesOf(ALL_RULES), expected);
  assert.deepEqual(barRulesOf(SECTION_RULES), expected, "all three sit in section 10");
});

test("the metric switch keeps its box: section 10 only spaces and reflows the other switches", () => {
  // The boxed Pace / Fillers / Pauses / Clean switch is what the tab bar stands apart from, so
  // section 10 may set its margins and its 200% zoom grid but never its fill, border or type.
  const layout = /^(margin(-(top|right|bottom|left))?|grid-auto-flow|grid-template-columns)$/;
  SECTION_RULES.filter(
    (rule) => rule.selector.includes("segmented") && !rule.selector.includes("progress__modes"),
  ).forEach((rule) => {
    Object.keys(rule.declarations).forEach((name) => {
      assert.match(name, layout, squash((rule.at || "") + " " + rule.selector));
    });
  });
});

test("the tabs stay toggle buttons: Progress never makes them a tablist", () => {
  // A tab bar in looks only: role="group" with aria-pressed buttons, as Practice's Talk | Read
  // switch and the metric switch, so a screen reader hears the same control on every screen.
  const source = read(path.join("screens", "progress.js"));
  assert.doesNotMatch(source, /tablist|aria-selected|["']tab["']/);
});
