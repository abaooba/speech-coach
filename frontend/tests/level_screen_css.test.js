// Text checks on the Level screen's section of frontend/styles.css ("8b. Level screen", spec
// docs/superpowers/specs/2026-10-14-loop-path.md section 0 and 8; DESIGN.md sections 3 to 6 and
// 9): it sits right before the History screen's section, its colours and spacing come only from
// tokens, its controls are 44px targets, the stepper and result use the path's colours (cleared
// --ok, current --accent, gold --warn), nothing in it animates, and it styles only classes the
// screen draws.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND_DIR = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(FRONTEND_DIR, "styles.css"), "utf8");
const SCREEN = fs.readFileSync(path.join(FRONTEND_DIR, "screens", "level.js"), "utf8");

const SECTION_START = "/* 8b. Level screen";
const NEXT_SECTION = "/* 9. History screen";

function sectionText() {
  const start = CSS.indexOf(SECTION_START);
  const end = CSS.indexOf(NEXT_SECTION);
  assert.notEqual(start, -1, "styles.css has no 8b. Level screen section");
  assert.ok(end > start, "the Level screen's section comes before History's");
  return CSS.slice(start, end);
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
  throw new Error("unbalanced brace");
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

// The section's rules: {at, selector, declarations}, `at` the enclosing @-rule or null.
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

const RULES = parseRules(withoutComments(sectionText()));

function ruleFor(selector, at = null) {
  const rule = RULES.find((each) => each.selector === selector && each.at === at);
  assert.ok(rule, "no rule for " + selector + (at ? " in " + at : ""));
  return rule.declarations;
}

test("the Level screen's section sits right before the History screen's", () => {
  const start = CSS.indexOf(SECTION_START);
  assert.equal(CSS.split(SECTION_START).length - 1, 1, "one 8b section");
  assert.ok(CSS.indexOf("/* 8. Results screen") < start, "after the Results screen's section");
  const between = CSS.slice(start + SECTION_START.length, CSS.indexOf(NEXT_SECTION));
  assert.doesNotMatch(between, /\/\* \d+[a-z]?\. /, "no other numbered section in between");
});

test("colours come only from tokens", () => {
  const text = withoutComments(sectionText());
  assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(text, /\b(rgb|rgba|hsl|hsla)\(/);
  const colourProperties = /(^|-)(color|background|border|outline|fill|stroke)/;
  const allowed = /^(var\(--[a-z-]+\)|transparent|currentColor|inherit|none|0)$/;
  RULES.forEach(({ selector, declarations }) => {
    Object.entries(declarations).forEach(([property, value]) => {
      if (!colourProperties.test(property)) {
        return;
      }
      value
        .split(/\s+/)
        .filter((word) => !/^\d+px$/.test(word) && !/^(solid|dashed|dotted)$/.test(word))
        .forEach((word) => {
          assert.match(word, allowed, selector + " { " + property + ": " + value + " }");
        });
    });
  });
});

test("margins, padding and gaps use only the spacing scale", () => {
  const spacing = /^(margin|padding)(-(top|right|bottom|left|block|inline))?$|^(row-|column-)?gap$/;
  const step = /^(0|auto|var\(--s-[1-7]\)|calc\(-1 \* var\(--s-[1-7]\)\))$/;
  RULES.forEach(({ selector, declarations }) => {
    Object.entries(declarations).forEach(([property, value]) => {
      if (!spacing.test(property)) {
        return;
      }
      value
        .replace(/calc\(-1 \* (var\(--s-[1-7]\))\)/g, "calc(-1_*_$1)")
        .split(/\s+/)
        .map((word) => word.replace(/_/g, " "))
        .forEach((word) => {
          assert.match(word, step, selector + " { " + property + ": " + value + " }");
        });
    });
  });
});

test("nothing in the Level screen animates, and no focus ring is removed", () => {
  const text = withoutComments(sectionText());
  assert.doesNotMatch(text, /\banimation\b|\btransition\b/);
  assert.doesNotMatch(text, /outline\s*:\s*(none|0)\b/);
});

test("its controls are 44px targets, Heard one bigger still", () => {
  const back = ruleFor(".level-back");
  assert.equal(back["min-height"], "44px");
  // A state block makes the section a flex column (DESIGN.md "State block"); the link keeps to
  // its words rather than stretch across it.
  assert.equal(back["align-self"], "flex-start");
  assert.equal(ruleFor(".level-play")["min-height"], "44px");
  assert.equal(ruleFor(".level-switch")["min-height"], "44px");
  assert.equal(ruleFor(".level-spot__tap")["min-height"], "64px");
  // The inline source link reaches 44px through its padding, as the Coach notes' link does.
  assert.equal(ruleFor(".level-source__link").padding, "var(--s-4) 0");
});

test("the stepper and the result use the path's colours", () => {
  assert.equal(ruleFor(".level-steps__item--done .level-steps__mark").background, "var(--ok)");
  assert.equal(
    ruleFor(".level-steps__item--current .level-steps__mark").background,
    "var(--accent)",
  );
  assert.equal(ruleFor(".level-steps__item--current .level-steps__label").color, "var(--accent)");
  assert.equal(ruleFor(".level-steps__mark").border, "1px solid var(--muted)");
  assert.equal(ruleFor(".level-result--pass").background, "var(--ok-bg)");
  assert.equal(ruleFor(".level-result__badge").background, "var(--ok)");
  assert.equal(ruleFor(".level-dates__gold").color, "var(--warn)");
  assert.equal(ruleFor(".level-change--better").color, "var(--ok)");
  assert.equal(ruleFor(".level-guards__item--failed").color, "var(--warn)");
  assert.equal(ruleFor(".level-moment__off").color, "var(--warn)");
});

test("it holds at 320px and at 200% zoom: steps wrap, chips and long words wrap", () => {
  assert.equal(
    ruleFor(".level-steps")["grid-template-columns"],
    "repeat(auto-fit, minmax(44px, 1fr))",
  );
  assert.equal(ruleFor(".level-chips")["flex-wrap"], "wrap");
  const chip = ruleFor(".level-chips .chip");
  assert.equal(chip["white-space"], "normal");
  assert.equal(chip["max-width"], "100%");
  assert.equal(ruleFor(".level-card")["overflow-wrap"], "anywhere");
  assert.equal(
    ruleFor(".level-target__headline, .level-take__value", "@media (max-width: 359px)")[
      "font-size"
    ],
    "var(--fs-metric-narrow)",
  );
});

test("cards and the number fonts match the rest of the app", () => {
  const card = ruleFor(".level-card");
  assert.equal(card.background, "var(--surface)");
  assert.equal(card.border, "1px solid var(--border)");
  assert.equal(card["border-radius"], "var(--r-card)");
  assert.equal(ruleFor("#screen-level")["font-variant-numeric"], "tabular-nums");
  assert.equal(ruleFor(".level-target__headline")["font-size"], "var(--fs-metric)");
  assert.equal(ruleFor(".level-take__value")["font-size"], "var(--fs-metric)");
});

test("every Level class the section styles is one the screen draws", () => {
  const styled = new Set(
    (withoutComments(sectionText()).match(/\.level[\w-]*/g) || []).map((name) => name.slice(1)),
  );
  // Every word of every string in level.js: class lists such as "level-card level-take", and the
  // prefixes modifiers are built from ("level-steps__item--" + state).
  const words = new Set(
    (SCREEN.match(/"[^"\\]*"/g) || []).flatMap((literal) => literal.slice(1, -1).split(/\s+/)),
  );
  const drawn = (name) => {
    if (words.has(name)) {
      return true;
    }
    const modifier = name.match(/^(.*--)[a-z]+$/);
    return modifier !== null && words.has(modifier[1]);
  };
  const dead = Array.from(styled).filter((name) => !drawn(name));
  assert.deepEqual(dead, []);
});
