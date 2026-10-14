// Text checks on section 13 of frontend/styles.css, the Path screen (spec
// docs/superpowers/specs/2026-10-14-loop-path.md sections 0 and 9): it closes the file; its
// colors are tokens, cleared --ok, current --accent and gold --warn; a closed card is hidden
// though its display is flex; the links run from one node's centre to the next behind the
// nodes; a node's centre sits where screens/path.js nodeX puts it; tap targets are 44px or more;
// nothing animates; and 200% zoom on a phone stacks the steps.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const SECTION_MARK = "/* 13. Path screen";
const SECTION = CSS.slice(CSS.indexOf(SECTION_MARK));

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

// The section's rules as {at, selector, declarations}, `at` the enclosing @-rule or null.
function parseRules(text, at = null, rules = []) {
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("{", cursor);
    if (open === -1) {
      break;
    }
    const prelude = squash(text.slice(cursor, open));
    const close = closingBrace(text, open);
    const inside = text.slice(open + 1, close);
    if (prelude.startsWith("@")) {
      parseRules(inside, prelude, rules);
    } else {
      const declarations = {};
      inside.split(";").forEach((part) => {
        const colon = part.indexOf(":");
        if (colon !== -1) {
          declarations[squash(part.slice(0, colon))] = squash(part.slice(colon + 1));
        }
      });
      rules.push({ at, selector: prelude, declarations });
    }
    cursor = close + 1;
  }
  return rules;
}

const RULES = parseRules(withoutComments(SECTION));

// The declarations of the rule with exactly this selector, outside any @-rule unless `at`.
function rule(selector, at = null) {
  const found = RULES.filter((entry) => entry.selector === selector && entry.at === at);
  assert.equal(found.length, 1, "one rule for " + selector + (at ? " in " + at : ""));
  return found[0].declarations;
}

test("the Path section is the last section of the stylesheet", () => {
  assert.equal(CSS.split(SECTION_MARK).length, 2, "one Path section");
  const sections = [...CSS.matchAll(/^\/\* (\d+[a-z]?)\. /gm)].map((match) => match[1]);
  assert.equal(sections[sections.length - 1], "13");
  assert.ok(CSS.indexOf(SECTION_MARK) > CSS.indexOf("/* 12. Account screen"));
});

test("every color in the section is a token", () => {
  const colorProperty = /^(color|background(-color)?|border(-\w+)*|stroke|fill)$/;
  // Values that set no color: a keyword, or a border of 0.
  const keywords = new Set(["transparent", "inherit", "none", "currentColor", "0"]);
  RULES.forEach(({ selector, declarations }) => {
    Object.entries(declarations)
      .filter(([property]) => colorProperty.test(property) && !/radius|width/.test(property))
      .forEach(([property, value]) => {
        const usesToken = /var\(--[a-z-]+\)/.test(value);
        assert.ok(usesToken || keywords.has(value), selector + " " + property + ": " + value);
      });
  });
  assert.doesNotMatch(withoutComments(SECTION), /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
});

test("cleared is --ok, current --accent, and the rings and an earned crown are gold --warn", () => {
  const cleared = rule(".path-node--cleared .path-node__circle");
  assert.equal(cleared.background, "var(--ok)");
  assert.equal(cleared["border-color"], "var(--ok)");
  const current = rule(
    ".path-node--current .path-node__circle, .path-node--checkpoint.path-node--open " +
      ".path-node__circle",
  );
  assert.equal(current.background, "var(--accent)");
  assert.equal(current.color, "var(--on-accent)");
  const rings = rule(
    ".path-node--half .path-node__circle::after, .path-node--gold .path-node__circle::after",
  );
  assert.equal(rings.border, "3px solid var(--warn)");
  const half = rule(".path-node--half .path-node__circle::after");
  assert.equal(half["border-bottom-color"], "transparent", "half the edge");
  assert.equal(half["border-left-color"], "transparent");
  assert.equal(half.transform, "rotate(-45deg)", "over the top half");
  const earned = rule(".path-node--crown.path-node--earned .path-node__circle");
  assert.equal(earned.background, "var(--warn)");
  assert.equal(rule(".path-node--crown.path-node--open .path-node__circle").color, "var(--warn)");
});

test("the walked path is --ok and the rest --grid", () => {
  assert.equal(rule(".path-step__link path").stroke, "var(--grid)");
  assert.equal(rule(".path-step__link--walked path").stroke, "var(--ok)");
});

test("a closed card is hidden, since its display: flex would beat the hidden attribute", () => {
  assert.equal(rule(".path-card").display, "flex");
  assert.equal(rule(".path-card[hidden]").display, "none");
  assert.equal(rule(".path-card--current").background, "var(--accent-soft)");
});

test("a link runs from its node's centre as tall as its row, behind the nodes", () => {
  const link = rule(".path-step__link");
  assert.equal(link.position, "absolute");
  assert.equal(link.top, "32px", "a level's 64px circle has its centre 32px down");
  assert.equal(link.height, "100%");
  assert.equal(link.width, "100%");
  assert.equal(link["z-index"], "-1");
  assert.equal(link["pointer-events"], "none");
  // The drop stretches down to the foot of the row's content; the turn spans the row's
  // --s-6 foot and the next node's top half, below every card and crown in the row.
  assert.equal(rule(".path-step__drop").top, "0");
  assert.equal(rule(".path-step__drop").height, "calc(100% - var(--s-6) - 32px)");
  assert.equal(rule(".path-step__turn").bottom, "0");
  assert.equal(rule(".path-step__turn").height, "calc(var(--s-6) + 32px)");
  assert.equal(rule(".path-steps").isolation, "isolate");
  assert.equal(rule(".path-step").position, "relative");
  assert.equal(rule(".path-step")["padding-bottom"], "var(--s-6)", "rows meet with no gap");
  assert.equal(rule(".path-steps").gap, undefined);
  const circle = rule(".path-node__circle");
  assert.equal(circle.height, "64px");
  const small = rule(
    ".path-node--crown .path-node__circle, .path-node--checkpoint .path-node__circle",
  );
  assert.equal(small.height, "48px");
  assert.equal(small["margin-top"], "var(--s-2)", "8px down puts its centre 32px down too");
});

test("a side node's centre sits at 25% of the row from its edge, as nodeX places it", () => {
  assert.equal(rule(".path-node").width, "104px");
  assert.equal(
    rule(".path-step--left")["grid-template-columns"],
    "max(0px, calc(25% - 52px)) 104px minmax(0, 1fr)",
  );
  assert.equal(
    rule(".path-step--right")["grid-template-columns"],
    "minmax(0, 1fr) 104px max(0px, calc(25% - 52px))",
  );
  assert.equal(rule(".path-step--center")["justify-items"], "center");
  const steps = rule(".path-steps");
  assert.equal(steps["max-width"], "440px", "a wide column keeps a phone-wide path");
  assert.equal(steps.margin, "var(--s-5) auto 0", "centred under the unit card");
});

test("the due chip is a 44px chip whose words may wrap; the week is a plain pill", () => {
  const due = rule(".path__due");
  assert.equal(due["white-space"], "normal");
  assert.equal(due["min-width"], "0");
  const chip = CSS.slice(CSS.indexOf("\n.chip {"));
  assert.match(chip.slice(0, chip.indexOf("}")), /min-height: 44px;/);
  assert.equal(rule(".path__week").margin, "0");
});

test("nothing in the section animates", () => {
  assert.doesNotMatch(withoutComments(SECTION), /animation|transition|@keyframes/);
});

test("at 200% zoom on a phone the steps stack and the links are left out", () => {
  const narrow = "@media (max-width: 319px)";
  assert.equal(
    rule(".path-step--left, .path-step--right, .path-step--center", narrow)[
      "grid-template-columns"
    ],
    "minmax(0, 1fr)",
  );
  assert.equal(rule(".path-step__link, .path-card::before", narrow).display, "none");
  assert.equal(rule(".path-step > .path-step__side", narrow)["grid-row"], "2");
});

test("focus scrolls a Path control clear of the nav", () => {
  const margins = rule("#screen-path :is(a, button)");
  assert.equal(margins["scroll-margin-top"], "var(--s-2)");
  assert.equal(
    margins["scroll-margin-bottom"],
    "calc(var(--nav-h) + var(--s-2) + env(safe-area-inset-bottom))",
  );
});
