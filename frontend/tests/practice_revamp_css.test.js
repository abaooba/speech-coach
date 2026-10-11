// Text checks on the Practice rules in frontend/styles.css (DESIGN.md sections 3, 6 and 7).
// Node cannot lay a page out, so these pin the rules that make Practice fit one screen and that
// show or hide its parts per state; the screenshots in the revamp report cover the pixels.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
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
// prelude or null and `selectors` is the comma-separated selector list.
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

const RULES = parseRules(withoutComments(CSS));

// The value the last rule naming this exact selector gives the property, as the cascade would
// for rules of equal specificity; undefined when no rule sets it.
function valueFor(selector, property, at = null) {
  const matching = RULES.filter(
    (rule) =>
      rule.at === at && rule.selectors.includes(selector) && property in rule.declarations,
  );
  return matching.length > 0 ? matching[matching.length - 1].declarations[property] : undefined;
}

function practiceIn(state, part) {
  return `#screen-practice[data-state="${state}"] ${part}`;
}

test("uploading and error hide the record button together with its label (H1)", () => {
  for (const state of ["uploading", "error"]) {
    for (const part of [".btn-record", ".btn-record__label"]) {
      assert.equal(valueFor(practiceIn(state, part), "display"), "none", `${state} ${part}`);
    }
  }
});

test("error also hides the timer and the hint, so its block takes the record zone (H3)", () => {
  assert.equal(valueFor(practiceIn("error", ".practice__timer"), "display"), "none");
  assert.equal(valueFor(practiceIn("error", ".practice__hint"), "display"), "none");
  assert.equal(valueFor(practiceIn("uploading", ".practice__hint"), "display"), "none");
  assert.equal(valueFor(practiceIn("uploading", ".practice__timer"), "display"), undefined);
});

test("the active Practice section is a column as tall as the viewport above the nav (H2)", () => {
  const selector = "#screen-practice.screen--active";
  assert.equal(valueFor(selector, "display"), "flex");
  assert.equal(valueFor(selector, "flex-direction"), "column");
  const minHeight = valueFor(selector, "min-height");
  assert.ok(minHeight.startsWith("calc(100dvh"), `min-height is ${minHeight}`);
  for (const part of ["var(--s-4)", "var(--nav-h)", "var(--s-5)", "env(safe-area-inset-bottom)"]) {
    assert.ok(minHeight.includes(`- ${part}`), `min-height subtracts ${part}`);
  }
});

test("no rule puts a display on the bare Practice id, which would beat .screen[hidden]", () => {
  const offenders = RULES.filter(
    (rule) => rule.selectors.includes("#screen-practice") && "display" in rule.declarations,
  );
  assert.deepEqual(offenders, []);
});

test("the body is a column whose parts keep their size; the card takes the rest (H2)", () => {
  assert.equal(valueFor("#screen-practice .screen__body", "display"), "flex");
  assert.equal(valueFor("#screen-practice .screen__body", "flex-direction"), "column");
  assert.equal(valueFor("#screen-practice .screen__body > *", "flex"), "none");
  assert.equal(valueFor("#screen-practice .passage-card", "flex"), "1 1 0");
  assert.equal(valueFor("#screen-practice .passage-card", "min-height"), "120px");
  assert.equal(valueFor(".passage-card", "max-height"), undefined, "no 40vh cap any more");
});

// The card's floor on short screens holds its title, its target and two lines of text above the
// --s-5 fade: 16 + 27.4 + 27.6 + 2 x 25.6 + 24 + 2 is about 148px for a one-line title.
test("short screens give the card a two-line floor and tighten the record zone for it", () => {
  assert.equal(valueFor("#screen-practice .passage-card", "min-height", SHORT_SCREENS), "148px");
  assert.equal(valueFor("#screen-practice .btn-record", "width", SHORT_SCREENS), "72px");
  assert.equal(valueFor("#screen-practice .btn-record", "height", SHORT_SCREENS), "72px");
  assert.equal(
    valueFor("#screen-practice .btn-record", "margin-top", SHORT_SCREENS),
    "var(--s-2)",
  );
  assert.equal(
    valueFor("#screen-practice .practice__timer", "margin-top", SHORT_SCREENS),
    "var(--s-2)",
  );
  assert.equal(
    valueFor("#screen-practice .practice__limit-bar", "margin-top", SHORT_SCREENS),
    "var(--s-1)",
  );
  const hintText = "#screen-practice .practice__hint-text";
  assert.equal(valueFor(hintText, "display", SHORT_SCREENS), "none");
  const hidesSample = RULES.some(
    (rule) =>
      rule.at === SHORT_SCREENS &&
      rule.selectors.some((selector) => /practice__(sample|hint)$/.test(selector)),
  );
  assert.ok(!hidesSample, "landscape and 200% zoom keep the sample button; their page scrolls");
});

const SMALL_PHONES = "@media (max-height: 600px) and (max-width: 479px)";

test("small phones drop the hint and its sample button, so the two-line card fits", () => {
  assert.equal(valueFor("#screen-practice .practice__hint", "display", SMALL_PHONES), "none");
});

test("the sample button shows in idle only; recording gives its room to the card", () => {
  const selector = practiceIn("recording", ".practice__sample");
  assert.equal(valueFor(selector, "display"), "none");
  assert.equal(valueFor(selector, "visibility"), undefined, "no invisible placeholder");
});

test("while a take records or uploads, the column reaches into the hidden nav's room", () => {
  for (const state of ["recording", "uploading"]) {
    const main = `body:has(#screen-practice.screen--active[data-state="${state}"]) main`;
    assert.equal(
      valueFor(main, "padding-bottom"),
      "calc(var(--s-5) + env(safe-area-inset-bottom))",
      `${state}: main keeps only its --s-5 end padding`,
    );
    const section = `#screen-practice.screen--active[data-state="${state}"]`;
    const minHeight = valueFor(section, "min-height");
    assert.ok(minHeight.startsWith("calc(100dvh"), `${state} min-height is ${minHeight}`);
    assert.ok(!minHeight.includes("--nav-h"), `${state}: the nav's room is the card's`);
    for (const part of ["var(--s-4)", "var(--s-5)", "env(safe-area-inset-bottom)"]) {
      assert.ok(minHeight.includes(`- ${part}`), `${state} min-height subtracts ${part}`);
    }
  }
  const idleMain = 'body:has(#screen-practice.screen--active[data-state="idle"]) main';
  assert.equal(valueFor(idleMain, "padding-bottom"), undefined, "idle keeps room for the nav");
});

test("inside Practice the state block takes the record zone with --s-4 padding", () => {
  assert.equal(valueFor("#screen-practice .practice__state .state", "padding"), "var(--s-4)");
});

// Every mask in Practice fades with the keyword colors only: hex is for the token block alone.
function assertKeywordMask(selector, direction, length) {
  const expected = `linear-gradient(to ${direction}, black calc(100% - ${length}), transparent)`;
  assert.equal(valueFor(selector, "mask-image"), expected, `${selector} mask-image`);
  assert.equal(valueFor(selector, "-webkit-mask-image"), expected, `${selector} webkit mask`);
}

test("the passage text scrolls inside the card and fades over its last --s-5 (M1)", () => {
  const text = "#screen-practice .passage-card__text";
  assert.equal(valueFor(text, "overflow-y"), "auto");
  assert.equal(valueFor(text, "min-height"), "0");
  assert.equal(valueFor(text, "padding-bottom"), "var(--s-5)", "the last line scrolls clear");
  assertKeywordMask(text, "bottom", "var(--s-5)");
  assert.equal(valueFor(".passage-card", "display"), "grid");
  assert.equal(valueFor(".passage-card", "grid-template-rows"), "auto auto minmax(0, 1fr)");
  assert.equal(valueFor(".passage-card", "overflow-y"), undefined, "only the text scrolls");
});

test("the card draws the passage text's focus ring, outside the text's mask", () => {
  const card = "#screen-practice .passage-card:has(.passage-card__text:focus-visible)";
  assert.equal(valueFor(card, "outline"), "3px solid var(--accent)");
  assert.equal(valueFor(card, "outline-offset"), "2px");
  const text = `${card} .passage-card__text`;
  assert.equal(valueFor(text, "outline"), "none", "replaced by the card's ring, never removed");
});

test("Practice's chip row bleeds to the screen edges and fades over its last --s-6 (L2)", () => {
  const row = "#screen-practice .chip-row";
  assert.equal(valueFor(row, "margin-inline"), "calc(-1 * var(--s-4))");
  assert.equal(valueFor(row, "padding-inline"), "var(--s-4) var(--s-6)");
  assertKeywordMask(row, "right", "var(--s-6)");
  assert.equal(valueFor(".chip-row", "mask-image"), undefined, "the shared row is untouched");
});

test("the clock stays centered in a three-column timer with the dot beside it (M3)", () => {
  assert.equal(valueFor(".practice__timer", "display"), "grid");
  assert.equal(valueFor(".practice__timer", "grid-template-columns"), "1fr auto 1fr");
  assert.equal(valueFor(".rec-dot", "grid-column"), "1");
  assert.equal(valueFor(".rec-dot", "justify-self"), "end");
  assert.equal(valueFor(".rec-dot", "margin-right"), undefined, "no margin pushes the clock");
  assert.equal(valueFor(".timer", "grid-column"), "2");
});

test("the record icon draws in --on-record (L5)", () => {
  assert.equal(valueFor(".btn-record", "color"), "var(--on-record)");
});

test("a disabled chip dims unless it is the selected one (L7)", () => {
  assert.equal(valueFor(".chip[disabled]:not(.chip--selected)", "opacity"), ".5");
  const dimsSelected = RULES.some(
    (rule) =>
      rule.selectors.some(
        (selector) =>
          selector.includes(".chip") &&
          selector.includes("[disabled]") &&
          !selector.includes(":not("),
      ) && "opacity" in rule.declarations,
  );
  assert.ok(!dimsSelected, "the selected chip keeps full contrast while disabled");
});

test("the header holds the h1 and a small muted wordmark that never wraps (L3)", () => {
  assert.equal(valueFor(".screen__header", "display"), "flex");
  assert.equal(valueFor(".screen__header", "align-items"), "center");
  assert.equal(valueFor(".screen__header h1", "margin"), "0");
  assert.equal(valueFor(".wordmark", "font-size"), "var(--fs-small)");
  assert.equal(valueFor(".wordmark", "color"), "var(--muted)");
  assert.equal(valueFor(".wordmark", "white-space"), "nowrap");
});

test("the mode switch sits --s-3 above the chips", () => {
  assert.equal(valueFor("#screen-practice .segmented", "margin-bottom"), "var(--s-3)");
});

test("hidden chips, New topic and the limit stay hidden despite their display rules", () => {
  for (const selector of [
    "#screen-practice .chip[hidden]",
    ".passage-card__new[hidden]",
    ".practice__limit[hidden]",
    ".practice__limit-bar[hidden]",
  ]) {
    assert.equal(valueFor(selector, "display"), "none", selector);
  }
});

test("timed chips use tabular figures", () => {
  assert.equal(valueFor("#screen-practice .chip", "font-variant-numeric"), "tabular-nums");
});

test("New topic shares the title's row in the card's grid, a small 44px ghost button", () => {
  const card = ".passage-card";
  assert.equal(valueFor(card, "display"), "grid");
  assert.equal(valueFor(card, "grid-template-columns"), "minmax(0, 1fr) auto");
  assert.equal(valueFor(card, "grid-template-rows"), "auto auto minmax(0, 1fr)");
  assert.equal(valueFor(".passage-card__title", "grid-column"), "1");
  for (const part of [".passage-card__target", ".passage-card__text"]) {
    assert.equal(valueFor(part, "grid-column"), "1 / -1", `${part} spans both columns`);
  }
  const button = ".passage-card__new";
  assert.equal(valueFor(button, "grid-column"), "2");
  assert.equal(valueFor(button, "grid-row"), "1");
  assert.equal(valueFor(button, "margin-block"), "calc(-1 * var(--s-3))", "the row stays h2-tall");
  assert.equal(valueFor(button, "position"), undefined, "no longer pinned to a corner");
  assert.equal(valueFor(button, "min-height"), "44px");
  assert.equal(valueFor(button, "font-size"), "var(--fs-small)");
  assert.equal(valueFor(".passage-card__new svg", "order"), "-1", "the icon is drawn first");
  const padsTitle = RULES.filter((rule) =>
    rule.selectors.some((selector) => selector.includes(":has(.passage-card__new")),
  );
  assert.deepEqual(padsTitle, [], "no rule pads the title to make room for the button");
});

// Section 3: only --s-* values for margin, padding and gap. Every such value in Practice's rules
// (section 7 and the sample rules at the end of the file) is built from the scale: 0, auto,
// var(--s-N), its negative, or --s-N plus the bottom safe area.
const SCALE_TERM = new RegExp(
  "^(0|auto|var\\(--s-[1-7]\\)|calc\\(-1 \\* var\\(--s-[1-7]\\)\\)|" +
    "calc\\(var\\(--s-[1-7]\\) \\+ env\\(safe-area-inset-bottom\\)\\))$",
);
const SPACING_PROPERTY = /^(margin|padding|scroll-padding)(-[a-z]+)*$|^(row-|column-)?gap$/;

function topLevelTerms(value) {
  const terms = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    depth += char === "(" ? 1 : char === ")" ? -1 : 0;
    if (char === " " && depth === 0) {
      terms.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  return [...terms, current].filter(Boolean);
}

function practiceRules() {
  const css = withoutComments(CSS);
  const start = CSS.indexOf("/* 7. Practice screen");
  const end = CSS.indexOf("/* 8. Results screen");
  assert.ok(start !== -1 && end > start, "styles.css keeps its section 7 heading");
  const section = parseRules(withoutComments(CSS.slice(start, end)));
  const sampleRules = parseRules(css).filter((rule) =>
    rule.selectors.some((selector) => selector.includes("practice__sample")),
  );
  return [...section, ...sampleRules];
}

test("every margin, padding and gap in Practice's rules comes from the --s-* scale", () => {
  const offenders = [];
  for (const rule of practiceRules()) {
    for (const [property, value] of Object.entries(rule.declarations)) {
      if (SPACING_PROPERTY.test(property) && !topLevelTerms(value).every((term) =>
        SCALE_TERM.test(term))) {
        offenders.push(`${rule.selectors.join(", ")} { ${property}: ${value} }`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("the time limit sits right of the clock and its bar spans the next row (T26)", () => {
  assert.equal(valueFor(".practice__limit", "grid-column"), "3");
  assert.equal(valueFor(".practice__limit", "justify-self"), "start");
  assert.equal(valueFor(".practice__limit", "font-size"), "var(--fs-small)");
  assert.equal(valueFor(".practice__limit", "color"), "var(--muted)");
  const bar = ".practice__limit-bar";
  assert.equal(valueFor(bar, "grid-column"), "1 / -1");
  assert.equal(valueFor(bar, "width"), "min(100%, 240px)");
  assert.equal(valueFor(bar, "height"), "4px");
  assert.equal(valueFor(bar, "background"), "var(--grid)");
  assert.equal(valueFor(bar, "border-radius"), "var(--r-chip)");
  assert.equal(valueFor(".practice__limit-fill", "background"), "var(--accent)");
  assert.equal(valueFor(".practice__limit-fill", "transform"), "scaleX(0)");
  assert.equal(
    valueFor(".practice__limit-bar--over .practice__limit-fill", "background"),
    "var(--warn)",
  );
});

test("nothing new animates: the bar has no transition", () => {
  const animated = RULES.filter(
    (rule) =>
      rule.selectors.some((selector) => selector.includes("practice__limit")) &&
      ("transition" in rule.declarations || "animation" in rule.declarations),
  );
  assert.deepEqual(animated, []);
});

test("the theme toggle's 44px target overlaps the header edges; the row stays h1-tall", () => {
  assert.equal(valueFor(".theme-toggle", "margin-block"), "calc(-1 * var(--s-2))");
  assert.equal(valueFor(".theme-toggle", "margin-right"), "calc(-1 * var(--s-2))");
});

test("figures in the target line and the state block use tabular digits", () => {
  assert.equal(valueFor(".passage-card__target", "font-variant-numeric"), "tabular-nums");
  const block = "#screen-practice .practice__state .state";
  assert.equal(valueFor(block, "font-variant-numeric"), "tabular-nums");
});

test("See a sample result is small, like New topic, with a 44px target", () => {
  assert.equal(valueFor(".practice__sample", "min-height"), "44px");
  assert.equal(valueFor(".practice__sample", "font-size"), "var(--fs-small)");
  assert.equal(valueFor(".practice__sample", "font-weight"), "500");
});
