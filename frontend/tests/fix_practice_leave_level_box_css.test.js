// Review fix to "7b. Practice level mode" in frontend/styles.css (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 7; DESIGN.md line 3: "nothing moves
// unless it carries information"). Leave level hides while a take records or uploads, as the nav
// does, but keeps its box: the banner keeps its height, so the card under it, and the passage a
// read level starts reading at the Record tap, no longer jump up 48px. Measured in Chrome at
// 375 x 667: the banner went from 181px to 133px and the card's top from 249.8 to 201.8 before;
// both hold after. A level with the live tap gives that room to "Heard one", which needs it
// under the record button at 375 x 667. Node cannot lay a page out, so these pin the rules, as
// practice_level_mode_css.test.js does.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const SECTION_HEADING = "/* 7b. Practice level mode";
const NEXT_HEADING = "/* 8. Results screen";

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

// Splits a selector list on its top-level commas only, so ":is(a, b)" stays whole.
function selectorList(prelude) {
  const selectors = [];
  let depth = 0;
  let current = "";
  for (const char of prelude) {
    depth += char === "(" ? 1 : char === ")" ? -1 : 0;
    if (char === "," && depth === 0) {
      selectors.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  return [...selectors, current].map(squash);
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

// Splits CSS into rules: { at, selectors, declarations }, `at` the enclosing @-rule or null.
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
      rules.push({ at, selectors: selectorList(prelude), declarations: declarationsOf(body) });
    }
    cursor = close + 1;
  }
  return rules;
}

function sectionText() {
  const start = CSS.indexOf(SECTION_HEADING);
  const end = CSS.indexOf(NEXT_HEADING);
  assert.ok(start !== -1 && end > start, "styles.css has 7b before section 8");
  return CSS.slice(start, end);
}

const RULES = parseRules(withoutComments(CSS));
const SECTION_RULES = parseRules(withoutComments(sectionText()));

// The value the last rule naming this exact selector gives the property; undefined when none.
function valueFor(selector, property, at = null, rules = RULES) {
  const matching = rules.filter(
    (rule) =>
      rule.at === at && rule.selectors.includes(selector) && property in rule.declarations,
  );
  return matching.length > 0 ? matching[matching.length - 1].declarations[property] : undefined;
}

// --- Leave level keeps its box while a take runs ---------------------------------------------

const LEAVE_HIDDEN = ".practice__banner-leave[hidden]";
const RUNNING_TAKE =
  '#screen-practice:is([data-state="recording"], [data-state="uploading"])' +
  ":not(:has(.practice__live-tap)) " +
  LEAVE_HIDDEN;

// The 7b rules that give a hidden Leave level a visibility, so that it keeps its box.
function boxKeepingRules() {
  return SECTION_RULES.filter(
    (rule) =>
      "visibility" in rule.declarations &&
      rule.selectors.some((selector) => selector.endsWith(LEAVE_HIDDEN)),
  );
}

test("while a take records or uploads, Leave level hides but keeps its box", () => {
  const rules = boxKeepingRules();
  assert.equal(rules.length, 1, "one rule keeps the box");
  assert.deepEqual(rules[0].selectors, [RUNNING_TAKE], "not on a level with the live tap");
  assert.equal(rules[0].at, null, "at every screen height");
  assert.equal(
    rules[0].declarations.visibility,
    "hidden",
    "out of sight, out of the tab order and out of the accessibility tree",
  );
  assert.equal(
    rules[0].declarations.display,
    valueFor(".btn", "display"),
    "the button's own display, so its 44px target keeps its room in the banner",
  );
});

test("anywhere else a hidden Leave level still takes no room", () => {
  assert.equal(valueFor(LEAVE_HIDDEN, "display"), "none");
  const displays = SECTION_RULES.filter(
    (rule) =>
      "display" in rule.declarations &&
      rule.selectors.some((selector) => selector.endsWith(LEAVE_HIDDEN)),
  );
  const selectors = displays.flatMap((rule) => rule.selectors).filter((selector) =>
    selector.endsWith(LEAVE_HIDDEN),
  );
  assert.deepEqual(
    selectors.sort(),
    [LEAVE_HIDDEN, RUNNING_TAKE].sort(),
    "no rule keeps the box in idle or error, where Leave level shows anyway",
  );
});
