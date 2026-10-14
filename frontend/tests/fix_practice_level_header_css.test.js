// Owner decision on "7b. Practice level mode" in frontend/styles.css (spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 7; DESIGN.md sections 3 and 6): while a
// level banner shows, Practice's header row steps aside for the eye and the hint hides, so every
// play's banner fits one screen. Before, at 320 x 568 a banner body of 3 or more lines left
// Record's label at or under the fixed nav (Long pauses level 4's take 2: 545 against a nav at 512,
// the page 57px too tall), and at 375 x 667 the page scrolled 18 to 42px. The h1 "Practice" stays
// for screen readers, hidden as .sr-only hides text; the wordmark and the theme toggle hide; the
// hint's words hide (the banner says what to do). practice.js puts the banner in the body only
// while a level request is held (practice_level_mode.test.js), so a rule scoped to a Practice
// that holds the banner applies in level mode only, and normal mode keeps its header and hint.
// Node cannot lay a page out, so these pin the rules, as practice_level_mode_css.test.js does.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(FRONTEND, "styles.css"), "utf8");
const INDEX = fs.readFileSync(path.join(FRONTEND, "index.html"), "utf8");
const PRACTICE = fs.readFileSync(path.join(FRONTEND, "screens", "practice.js"), "utf8");
const SECTION_HEADING = "/* 7b. Practice level mode";
const NEXT_HEADING = "/* 8. Results screen";
const SHORT_SCREENS = "@media (max-height: 600px)";
const SMALL_PHONES = "@media (max-height: 600px) and (max-width: 479px)";
// Practice while it holds a level request: the banner is in its body.
const LEVEL_MODE = "#screen-practice:has(.practice__banner)";

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

// The selectors of every rule, at any height, that gives one of `targets` (a selector ends with
// it) one of the declarations in `hiding`, as "selector @ at".
function hidingSelectors(targets, hiding) {
  return RULES.flatMap((rule) =>
    Object.entries(hiding).some(([property, value]) => rule.declarations[property] === value)
      ? rule.selectors
          .filter((selector) => targets.some((target) => selector.endsWith(target)))
          .map((selector) => selector + " @ " + rule.at)
      : [],
  ).sort();
}

// --- The h1 stays for screen readers ------------------------------------------------------------

test("in level mode the h1 leaves the eye but not screen readers, hidden as .sr-only text", () => {
  const h1 = LEVEL_MODE + " .screen__header h1";
  for (const property of ["position", "width", "height", "overflow", "clip", "white-space"]) {
    const srOnly = valueFor(".sr-only", property);
    assert.ok(srOnly, ".sr-only sets " + property);
    assert.equal(valueFor(h1, property, null, SECTION_RULES), srOnly, property);
  }
  // .sr-only's -1px margin is off section 3's spacing scale; the header's h1 keeps its 0.
  assert.equal(valueFor(h1, "margin", null, SECTION_RULES), undefined);
  assert.equal(valueFor(".screen__header h1", "margin"), "0");
  const hiddenForAll = hidingSelectors(["h1"], { display: "none", visibility: "hidden" });
  assert.deepEqual(hiddenForAll, [], "nothing takes an h1 out of the accessibility tree");
});

test("the h1 stays on the page: index.html's header holds it bare, practice.js leaves it", () => {
  const start = INDEX.indexOf('id="screen-practice"');
  const section = INDEX.slice(start, INDEX.indexOf("</section>", start));
  // No hidden or aria-hidden attribute: the h1 tag has none at all.
  assert.match(section, /<header class="screen__header">\s*<h1>Practice<\/h1>/);
  assert.doesNotMatch(PRACTICE, /querySelector\([^)]*h1|\.screen__header/, "no code reaches it");
});

// --- The rest of the header row and the hint hide ------------------------------------------------

test("in level mode the wordmark and theme toggle hide, and the header gives up its gap", () => {
  for (const part of [".wordmark", ".theme-toggle"]) {
    assert.equal(valueFor(LEVEL_MODE + " " + part, "display", null, SECTION_RULES), "none", part);
  }
  const header = LEVEL_MODE + " .screen__header";
  assert.equal(valueFor(header, "margin-bottom", null, SECTION_RULES), "0");
});

test("in level mode the hint hides at every height: the banner says what to do", () => {
  assert.equal(valueFor(LEVEL_MODE + " .practice__hint", "display", null, SECTION_RULES), "none");
});

// --- Normal mode is unchanged -------------------------------------------------------------------

test("only level mode hides the header's parts; normal mode hides the hint where it did", () => {
  // Section 7's own: uploading and error put the state block in the hint's place, and small
  // phones drop the hint.
  const targets = [".screen__header h1", ".wordmark", ".theme-toggle", ".practice__hint"];
  const hiding = { display: "none", position: "absolute" };
  assert.deepEqual(
    hidingSelectors(targets, hiding),
    [
      '#screen-practice[data-state="uploading"] .practice__hint @ null',
      '#screen-practice[data-state="error"] .practice__hint @ null',
      "#screen-practice .practice__hint @ " + SMALL_PHONES,
      LEVEL_MODE + " .practice__hint @ null",
      LEVEL_MODE + " .screen__header h1 @ null",
      LEVEL_MODE + " .theme-toggle @ null",
      LEVEL_MODE + " .wordmark @ null",
    ].sort(),
  );
  assert.deepEqual(
    hidingSelectors([".screen__header"], { "margin-bottom": "0" }),
    [LEVEL_MODE + " .screen__header @ null"],
  );
});

test("normal mode keeps its header row and its hint as section 7 draws them", () => {
  assert.equal(valueFor(".screen__header", "display"), "flex");
  assert.equal(valueFor(".screen__header", "margin-bottom"), "var(--s-3)");
  assert.equal(valueFor(".screen__header h1", "flex"), "1 1 auto");
  assert.equal(valueFor(".screen__header h1", "margin"), "0");
  assert.equal(valueFor(".wordmark", "display"), "inline-flex");
  assert.equal(valueFor(".theme-toggle", "margin-right"), "calc(-1 * var(--s-2))");
  assert.equal(valueFor(".practice__hint", "display"), "flex");
  assert.equal(valueFor(".practice__hint", "margin"), "var(--s-1) 0 0");
  assert.equal(valueFor("#screen-practice .practice__hint-text", "display", SHORT_SCREENS), "none");
});

test("the level-mode rules for the header and the hint are 7b's, outside any media query", () => {
  const scoped = SECTION_RULES.filter((rule) =>
    rule.selectors.some((selector) => selector.startsWith(LEVEL_MODE + " ")),
  );
  assert.ok(scoped.length > 0, "7b holds them");
  assert.deepEqual([...new Set(scoped.map((rule) => rule.at))], [null], "at every height");
  const outside = RULES.filter((rule) =>
    rule.selectors.some((selector) => selector.startsWith(LEVEL_MODE + " ")),
  );
  assert.equal(outside.length, scoped.length, "no such rule outside 7b");
});
