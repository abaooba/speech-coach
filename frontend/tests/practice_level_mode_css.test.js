// Text checks on "7b. Practice level mode" in frontend/styles.css (spec
// docs/superpowers/specs/2026-10-14-loop-path.md sections 0 and 7): its place right before the
// Results section, the [hidden] rules that let level mode hide parts with display rules of their
// own, the banner, Leave level and the live tap. Node cannot lay a page out, so these pin the
// rules; tokens only, the spacing scale and nothing animated, as everywhere in Practice.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const SECTION_HEADING = "/* 7b. Practice level mode";
const NEXT_HEADING = "/* 8. Results screen";
const SHORT_SCREENS = "@media (max-height: 600px)";

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

// Splits a selector list on its top-level commas only, so ":is(button, [tabindex])" stays whole.
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
  assert.ok(start !== -1, "styles.css has a 7b section");
  assert.ok(end > start, "7b comes before section 8");
  return CSS.slice(start, end);
}

const RULES = parseRules(withoutComments(CSS));
const SECTION_RULES = parseRules(withoutComments(sectionText()));

// The value the last rule naming this exact selector gives the property, as the cascade would
// for rules of equal specificity; undefined when no rule sets it.
function valueFor(selector, property, at = null) {
  const matching = RULES.filter(
    (rule) =>
      rule.at === at && rule.selectors.includes(selector) && property in rule.declarations,
  );
  return matching.length > 0 ? matching[matching.length - 1].declarations[property] : undefined;
}

test("7b is one section placed right before section 8, after all of section 7", () => {
  assert.equal(CSS.split(SECTION_HEADING).length, 2, "exactly one 7b heading");
  const seven = CSS.indexOf("/* 7. Practice screen");
  const sevenB = CSS.indexOf(SECTION_HEADING);
  const eight = CSS.indexOf(NEXT_HEADING);
  assert.ok(seven < sevenB && sevenB < eight);
  const lastOfSeven = CSS.indexOf("/* Small phones also drop the sample button");
  assert.ok(lastOfSeven !== -1 && lastOfSeven < sevenB, "section 7 ends before 7b starts");
  const between = CSS.slice(sevenB + SECTION_HEADING.length, eight);
  assert.doesNotMatch(between, /\/\* \d+[a-z]?\. /, "no other section heading inside 7b");
  assert.ok(SECTION_RULES.length > 0, "7b holds rules");
});

test("the parts level mode hides stay hidden despite their display rules", () => {
  for (const selector of [
    "#screen-practice .segmented[hidden]",
    "#screen-practice .chip-row[hidden]",
    "#screen-practice .practice__sample[hidden]",
    ".practice__banner-leave[hidden]",
    ".practice__live-tap[hidden]",
  ]) {
    assert.equal(valueFor(selector, "display"), "none", selector);
  }
});

test("the banner is an accent-soft card: 1px border, card radius, --s-4 padding", () => {
  const banner = ".practice__banner";
  assert.equal(valueFor(banner, "background"), "var(--accent-soft)");
  assert.equal(valueFor(banner, "border"), "1px solid var(--border)");
  assert.equal(valueFor(banner, "border-radius"), "var(--r-card)");
  assert.equal(valueFor(banner, "padding"), "var(--s-4)");
});

test("the banner reads eyebrow, title, body: small muted, h2 size, body size, --s-1 apart", () => {
  const eyebrow = ".practice__banner-eyebrow";
  assert.equal(valueFor(eyebrow, "margin"), "0");
  assert.equal(valueFor(eyebrow, "font-size"), "var(--fs-small)");
  assert.equal(valueFor(eyebrow, "color"), "var(--muted)");
  const title = ".practice__banner-title";
  assert.equal(valueFor(title, "margin"), "var(--s-1) 0 0");
  assert.equal(valueFor(title, "font-size"), "var(--fs-h2)");
  assert.equal(valueFor(title, "font-weight"), "600");
  const body = ".practice__banner-body";
  assert.equal(valueFor(body, "margin"), "var(--s-1) 0 0");
  assert.equal(valueFor(body, "font-size"), "var(--fs-body)");
});

test("Leave level is a small text button on a 44px target, its words in line with the text", () => {
  const leave = ".practice__banner-leave";
  assert.equal(valueFor(leave, "min-height"), "44px");
  assert.equal(valueFor(leave, "padding"), "0 var(--s-2)");
  assert.equal(valueFor(leave, "margin"), "var(--s-1) 0 0 calc(-1 * var(--s-2))");
  assert.equal(valueFor(leave, "font-size"), "var(--fs-small)");
  assert.equal(valueFor(leave, "font-weight"), "500");
});

test("on short screens the banner tightens and Leave level moves up beside the eyebrow", () => {
  const banner = ".practice__banner";
  assert.equal(valueFor(banner, "display", SHORT_SCREENS), "grid");
  assert.equal(valueFor(banner, "grid-template-columns", SHORT_SCREENS), "minmax(0, 1fr) auto");
  assert.equal(valueFor(banner, "padding", SHORT_SCREENS), "var(--s-3)");
  for (const part of [".practice__banner-title", ".practice__banner-body"]) {
    assert.equal(valueFor(part, "grid-column", SHORT_SCREENS), "1 / -1", part);
  }
  const leave = ".practice__banner-leave";
  assert.equal(valueFor(leave, "grid-column", SHORT_SCREENS), "2");
  assert.equal(valueFor(leave, "grid-row", SHORT_SCREENS), "1");
  assert.equal(
    valueFor(leave, "margin-block", SHORT_SCREENS),
    "calc(-1 * var(--s-3))",
    "its 44px target overlaps the row, which stays as tall as the eyebrow",
  );
  assert.equal(valueFor(".practice__banner-eyebrow", "grid-row", SHORT_SCREENS), "1");
});

test("the live tap keeps its button centered, the count beside it, as the timer does", () => {
  const row = ".practice__live-tap";
  assert.equal(valueFor(row, "display"), "grid");
  assert.equal(valueFor(row, "grid-template-columns"), "minmax(0, 1fr) auto minmax(0, 1fr)");
  assert.equal(valueFor(row, "margin-top"), "var(--s-2)");
  assert.equal(valueFor(".practice__live-tap-button", "grid-column"), "2");
  const count = ".practice__live-tap-count";
  assert.equal(valueFor(count, "grid-column"), "3");
  assert.equal(valueFor(count, "justify-self"), "start");
  assert.equal(valueFor(count, "font-size"), "var(--fs-small)");
  assert.equal(valueFor(count, "color"), "var(--muted)");
  assert.equal(valueFor(count, "font-variant-numeric"), "tabular-nums");
  assert.equal(valueFor(count, "white-space"), "nowrap");
});

test("Heard one is a large target: 56px tall, 48px on short screens, never under 44px", () => {
  const button = ".practice__live-tap-button";
  assert.equal(valueFor(button, "min-height"), "56px");
  assert.equal(valueFor(button, "min-height", SHORT_SCREENS), "48px");
  assert.equal(valueFor(button, "min-width"), "160px");
});

// Colors come only from tokens (DESIGN.md section 4): no literal in any color-bearing value.
const COLOR_PROPERTY = /^(color|background(-color)?|border(-[a-z]+)*|outline(-color)?|fill|stroke)$/;
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|lab)\(/;

test("every color in 7b is a token", () => {
  const offenders = [];
  for (const rule of SECTION_RULES) {
    for (const [property, value] of Object.entries(rule.declarations)) {
      if (COLOR_PROPERTY.test(property) && COLOR_LITERAL.test(value)) {
        offenders.push(`${rule.selectors.join(", ")} { ${property}: ${value} }`);
      }
    }
  }
  assert.deepEqual(offenders, []);
  assert.doesNotMatch(withoutComments(sectionText()), COLOR_LITERAL);
});

test("nothing in 7b animates, so reduced motion has nothing to stop", () => {
  const animated = SECTION_RULES.filter(
    (rule) => "transition" in rule.declarations || "animation" in rule.declarations,
  );
  assert.deepEqual(animated, []);
});

test("7b never sets a width wider than the column, so 320px never scrolls sideways", () => {
  const offenders = SECTION_RULES.filter((rule) =>
    Object.entries(rule.declarations).some(
      ([property, value]) =>
        /^(min-)?width$/.test(property) && /^\d+px$/.test(value) && parseInt(value, 10) > 288,
    ),
  );
  assert.deepEqual(offenders, [], "288px is the column at 320px wide");
});
