// Review fix to "6. Bottom nav" in frontend/styles.css (DESIGN.md section 9: "Layout survives 200%
// zoom" and "Tap targets are at least 44 x 44px"). The nav grew to four items (Practice · Path ·
// Progress · History, spec docs/superpowers/specs/2026-10-14-loop-path.md section 10), and 200%
// zoom on a phone leaves a 160 to 215px window. Measured in Chrome at 160px before: "Practice" ran
// off the left edge (-6 to 43), "History" off the right (123 to 166), the labels read
// "PracticePathProgressHistory" and Path was 26.8px wide; at 187px Path was 42.2px and History
// 43.2px. After: the four items share the width equally, so from 240px the widest label
// ("Progress", about 53px) fits its quarter; under 240px each item shows its icon only, its label
// kept in the link, visually hidden, as the link's name, while four 44px items still fit in a row
// (4 x 44 = 176px); under 176px the nav takes two rows of two, labels showing again, and --nav-h
// doubles so every screen's padding and scroll margins still clear it. Node cannot lay a page
// out, so these pin the rules; the Chrome measurements are in the commit message.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND_DIR = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(FRONTEND_DIR, "styles.css"), "utf8");
const INDEX_HTML = fs.readFileSync(path.join(FRONTEND_DIR, "index.html"), "utf8");
const DESIGN = fs.readFileSync(path.join(FRONTEND_DIR, "DESIGN.md"), "utf8");

const SECTION_HEADING = "/* 6. Bottom nav";
const NEXT_HEADING = "/* 7. Practice screen";
const ICONS_ONLY = "@media (max-width: 239px)";
const TWO_ROWS = "@media (max-width: 175px)";

// The smallest tap target DESIGN.md section 9 allows, and the nav's items.
const TARGET_PX = 44;
const ITEMS = ["Practice", "Path", "Progress", "History"];

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

// Splits CSS into rules in source order: { at, selector, declarations }, `at` the enclosing
// @-rule or null.
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
  const start = CSS.indexOf(SECTION_HEADING);
  const end = CSS.indexOf(NEXT_HEADING);
  assert.ok(start !== -1 && end > start, "styles.css has section 6 before section 7");
  return CSS.slice(start, end);
}

const SECTION_RULES = parseRules(withoutComments(sectionText()));

// The declarations of the one rule in section 6 with exactly this selector and @-rule.
function ruleFor(selector, at = null) {
  const matching = SECTION_RULES.filter((rule) => rule.selector === selector && rule.at === at);
  assert.equal(matching.length, 1, `section 6 has one rule for ${at || ""} ${selector}`);
  return matching[0].declarations;
}

function indexOfRule(selector, at) {
  return SECTION_RULES.findIndex((rule) => rule.selector === selector && rule.at === at);
}

// The same declarations the base .sr-only rule uses to hide text from sight but not from a
// screen reader (padding and border are 0 on a label already).
const VISUALLY_HIDDEN = {
  position: "absolute",
  width: "1px",
  height: "1px",
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  "white-space": "nowrap",
};

test("the four items share the nav's width equally, never widened by a label", () => {
  const item = ruleFor(".nav__item");
  assert.equal(item["min-width"], "0", "a flex item's min-width: auto lets a label widen it");
  assert.equal(item.flex, "1 1 0");
  assert.equal(item["max-width"], "calc(var(--col-max) / 4)");
});

test("under 240px each item shows its icon only, its label visually hidden in the link", () => {
  const label = ruleFor(".nav__label", ICONS_ONLY);
  for (const [property, value] of Object.entries(VISUALLY_HIDDEN)) {
    assert.equal(label[property], value, property);
  }
  for (const property of ["display", "visibility", "font-size", "opacity"]) {
    assert.equal(label[property], undefined, `${property} would hide the link's name too`);
  }
  // Nothing else changes there: one row, the icon over a hidden label.
  const narrowRules = SECTION_RULES.filter((rule) => rule.at === ICONS_ONLY);
  assert.deepEqual(
    narrowRules.map((rule) => rule.selector),
    [".nav__label"],
  );
});

test("under 176px, where four 44px items no longer fit in a row, the nav takes two rows", () => {
  assert.equal(4 * TARGET_PX, 176, "the breakpoint is the width of four 44px items");
  assert.equal(ruleFor(":root", TWO_ROWS)["--nav-h"], "112px", "two rows of 56px");
  assert.equal(ruleFor(".nav", TWO_ROWS)["flex-wrap"], "wrap");
  const item = ruleFor(".nav__item", TWO_ROWS);
  assert.equal(item["flex-basis"], "50%", "two items to a row");
  assert.equal(item["min-height"], "calc(var(--nav-h) / 2)", "each row as tall as the one row");
});

test("in two rows each label shows again under its icon, the rule after the hiding one", () => {
  const label = ruleFor(".nav__label", TWO_ROWS);
  assert.deepEqual(label, {
    position: "static",
    width: "auto",
    height: "auto",
    margin: "0",
    overflow: "visible",
    clip: "auto",
    "white-space": "normal",
  });
  assert.ok(
    indexOfRule(".nav__label", TWO_ROWS) > indexOfRule(".nav__label", ICONS_ONLY),
    "the later rule wins under 176px",
  );
  const itemAt = (at) => indexOfRule(".nav__item", at);
  assert.ok(itemAt(TWO_ROWS) > itemAt(null), "the two-row item rule overrides the base one");
});

test("every nav link keeps its label in its markup, so a hidden label still names it", () => {
  const nav = INDEX_HTML.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
  const links = [...nav.matchAll(/<a class="nav__item" href="[^"]+">([\s\S]*?)<\/a>/g)];
  assert.deepEqual(
    links.map((link) => (link[1].match(/<span class="nav__label">([^<]+)<\/span>/) || [])[1]),
    ITEMS,
  );
  links.forEach((link) => {
    assert.match(link[1], /<svg class="nav__icon" aria-hidden="true"/);
    assert.doesNotMatch(link[0], /aria-label/, "the visible or hidden label is the name");
  });
});

test("DESIGN.md's nav entry says how the four items fit at 200% zoom", () => {
  const start = DESIGN.indexOf("**Nav** `<nav class=\"nav\" aria-label=\"Main\">`");
  assert.ok(start !== -1, "DESIGN.md has the nav entry");
  const entry = DESIGN.slice(start, DESIGN.indexOf("\n", start));
  assert.match(entry, /`min-width: 0`/);
  assert.match(entry, /Under 240px/);
  assert.match(entry, /icon only/);
  assert.match(entry, /visually hidden/);
  assert.match(entry, /[Uu]nder 176px/);
  assert.match(entry, /two rows of two/);
  assert.match(entry, /`--nav-h` doubles to 112px/);
});
