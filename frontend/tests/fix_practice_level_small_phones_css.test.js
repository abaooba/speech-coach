// Review fix to "7b. Practice level mode" in frontend/styles.css (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 7; DESIGN.md section 3: Practice fits
// one screen at 320 x 568). On small phones the level banner tightens a step further, so level
// mode fits as normal mode does. Measured in Chrome at 320 x 568: 582px of page in a 568px window
// before, in idle, and 581 while a take records with the live tap; 568 in every state after, with
// the record label --s-5 above the nav and the card at its 148px floor or above. Node cannot lay
// a page out, so these pin the rules, as practice_level_mode_css.test.js does.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const SECTION_HEADING = "/* 7b. Practice level mode";
const NEXT_HEADING = "/* 8. Results screen";
const SHORT_SCREENS = "@media (max-height: 600px)";
const SMALL_PHONES = "@media (max-height: 600px) and (max-width: 479px)";

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

// --- Small phones: the banner tightens so level mode fits 320 x 568 ----------------------------

test("on small phones the banner's title and body drop one type step", () => {
  assert.equal(valueFor(".practice__banner-title", "font-size", SMALL_PHONES), "var(--fs-body)");
  assert.equal(valueFor(".practice__banner-body", "font-size", SMALL_PHONES), "var(--fs-small)");
  assert.equal(
    valueFor(".practice__banner-body", "line-height", SMALL_PHONES),
    "1.4",
    "the line height every small text in Practice has",
  );
});

test("on small phones the card sits --s-2 under the banner, as the record zone's gaps tighten", () => {
  assert.equal(
    valueFor("#screen-practice .practice__banner + .passage-card", "margin-top", SMALL_PHONES),
    "var(--s-2)",
  );
});

test("the card keeps its two-line floor: nothing in 7b lowers it", () => {
  assert.equal(valueFor("#screen-practice .passage-card", "min-height", SHORT_SCREENS), "148px");
  const lowered = SECTION_RULES.filter((rule) =>
    rule.selectors.some((selector) => selector.includes("passage-card")) &&
    "min-height" in rule.declarations,
  );
  assert.deepEqual(lowered, []);
});

test("the small-phone rules live in 7b, and taller or wider screens keep the banner as it was", () => {
  const smallPhoneRules = SECTION_RULES.filter((rule) => rule.at === SMALL_PHONES);
  assert.equal(smallPhoneRules.length, 3, "title, body and the card's gap");
  assert.equal(valueFor(".practice__banner-title", "font-size"), "var(--fs-h2)");
  assert.equal(valueFor(".practice__banner-body", "font-size"), "var(--fs-body)");
  assert.equal(valueFor(".practice__banner-title", "font-size", SHORT_SCREENS), undefined);
  assert.equal(valueFor(".practice__banner-body", "font-size", SHORT_SCREENS), undefined);
});
