// Text checks on frontend/styles.css for the shared revamp rules: the light tokens, the two dark
// blocks (device setting and forced theme) with identical values, sentence-case labels, the
// centered nav column, the timer size and the shared components in DESIGN.md section 6.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const END_OF_TOKENS = "/* end tokens */";

const DARK_MEDIA = "@media (prefers-color-scheme: dark)";
const DARK_BY_DEVICE = ':root:not([data-theme="light"])';
const DARK_FORCED = ':root[data-theme="dark"]';
const HEX_COLOR = /^#[0-9A-Fa-f]{3,8}$/;

// The color tokens this revamp adds or changes, light then dark (DESIGN.md section 4).
const NEW_COLOR_TOKENS = {
  "--warn": ["#9A3412", "#FF8A4C"],
  "--on-record": ["#FFFFFF", "#0F1115"],
  "--record-text": ["#B91C1C", "#FF6369"],
  "--ok-bg": ["#DCFCE7", "#163B26"],
};

// Tokens that are not colors live in the light :root only.
const NEW_LAYOUT_TOKENS = { "--col-max": "640px", "--fs-metric-narrow": "32px" };

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

// Splits CSS into rules: { at, selector, declarations }, where `at` is the enclosing @-rule
// prelude or null. Enough for this stylesheet, which never puts a brace inside a string.
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

const TOKEN_RULES = parseRules(withoutComments(CSS.slice(0, CSS.indexOf(END_OF_TOKENS))));
const ALL_RULES = parseRules(withoutComments(CSS));

// The declarations of the rule with exactly this selector (and @-rule), or undefined.
function ruleFor(rules, selector, at = null) {
  const rule = rules.find((candidate) => candidate.selector === selector && candidate.at === at);
  return rule && rule.declarations;
}

function lightTokens() {
  return ruleFor(TOKEN_RULES, ":root");
}

test("the end-of-tokens marker appears exactly once", () => {
  assert.equal(CSS.split(END_OF_TOKENS).length - 1, 1);
});

test("the token block holds :root, the device dark block and the forced dark block", () => {
  const blocks = TOKEN_RULES.map((rule) => `${rule.at || ""} ${rule.selector}`.trim()).sort();
  const expected = [":root", DARK_FORCED, `${DARK_MEDIA} ${DARK_BY_DEVICE}`].sort();
  assert.deepEqual(blocks, expected);
  assert.equal(ruleFor(TOKEN_RULES, ":root", DARK_MEDIA), undefined, "no plain :root override");
});

test("the two dark blocks carry identical values and set color-scheme dark", () => {
  const byDevice = ruleFor(TOKEN_RULES, DARK_BY_DEVICE, DARK_MEDIA);
  const forced = ruleFor(TOKEN_RULES, DARK_FORCED);
  assert.ok(byDevice, `missing ${DARK_MEDIA} { ${DARK_BY_DEVICE} }`);
  assert.ok(forced, `missing ${DARK_FORCED}`);
  assert.deepEqual(byDevice, forced);
  assert.equal(forced["color-scheme"], "dark");
  assert.equal(lightTokens()["color-scheme"], "light");
});

test("every light color token has a dark value and the dark blocks override only colors", () => {
  const light = lightTokens();
  const colorNames = Object.keys(light).filter((name) => HEX_COLOR.test(light[name]));
  const forced = ruleFor(TOKEN_RULES, DARK_FORCED);
  const darkNames = Object.keys(forced).filter((name) => name !== "color-scheme");
  assert.deepEqual(darkNames.sort(), colorNames.sort());
  darkNames.forEach((name) => assert.match(forced[name], HEX_COLOR, name));
});

test("the warning token is rust and the new color tokens exist in all three blocks", () => {
  const light = lightTokens();
  const byDevice = ruleFor(TOKEN_RULES, DARK_BY_DEVICE, DARK_MEDIA);
  const forced = ruleFor(TOKEN_RULES, DARK_FORCED);
  for (const [name, [lightValue, darkValue]] of Object.entries(NEW_COLOR_TOKENS)) {
    assert.equal(light[name], lightValue, `${name} light`);
    assert.equal(byDevice[name], darkValue, `${name} dark by device`);
    assert.equal(forced[name], darkValue, `${name} dark forced`);
  }
});

test("the column and narrow metric tokens live in the light :root only", () => {
  const light = lightTokens();
  const forced = ruleFor(TOKEN_RULES, DARK_FORCED);
  for (const [name, value] of Object.entries(NEW_LAYOUT_TOKENS)) {
    assert.equal(light[name], value, name);
    assert.equal(forced[name], undefined, `${name} is not a color`);
  }
});

test("the timer uses the metric size and the hero size token is gone", () => {
  assert.equal(ruleFor(ALL_RULES, ".timer")["font-size"], "var(--fs-metric)");
  assert.ok(!CSS.includes("--fs-hero"), "--fs-hero should be deleted");
});

test("no label is uppercased or letter-spaced", () => {
  assert.doesNotMatch(CSS, /text-transform\s*:\s*uppercase/i);
  assert.doesNotMatch(CSS, /letter-spacing/i);
});

test("main and the nav items share the centered --col-max column", () => {
  assert.equal(ruleFor(ALL_RULES, "main")["max-width"], "var(--col-max)");
  assert.equal(ruleFor(ALL_RULES, ".nav")["justify-content"], "center");
  const item = ruleFor(ALL_RULES, ".nav__item");
  assert.equal(item.flex, "1 1 0");
  assert.equal(item["max-width"], "calc(var(--col-max) / 3)");
  assert.equal(item["min-height"], "var(--nav-h)");
  const label = ruleFor(ALL_RULES, ".nav__label");
  assert.equal(label["font-size"], "var(--fs-micro)");
  assert.equal(label["font-weight"], "600");
});

test("red text uses --record-text: the Delete button and the error title", () => {
  const danger = ruleFor(ALL_RULES, ".btn--danger");
  assert.equal(danger.color, "var(--record-text)");
  assert.equal(danger["border-color"], "var(--record)");
  assert.equal(ruleFor(ALL_RULES, ".state--error .state__title").color, "var(--record-text)");
  assert.equal(ruleFor(ALL_RULES, ".state--error .state__icon").color, "var(--record)");
  assert.ok(ruleFor(ALL_RULES, ".state__secondary"), "the secondary action has its spacing");
});

test("the icon button is a 44px muted target holding a 20px icon", () => {
  const button = ruleFor(ALL_RULES, ".icon-btn");
  assert.equal(button.width, "44px");
  assert.equal(button.height, "44px");
  assert.equal(button.color, "var(--muted)");
  assert.equal(button["border-radius"], "var(--r-btn)");
  const svg = ruleFor(ALL_RULES, ".icon-btn svg");
  assert.equal(svg.width, "20px");
  assert.equal(svg.height, "20px");
});

test("the segmented control is one row of equal options with an accent selection", () => {
  const group = ruleFor(ALL_RULES, ".segmented");
  assert.equal(group.display, "grid");
  assert.equal(group.background, "var(--surface)");
  assert.equal(group.border, "1px solid var(--border)");
  assert.equal(group["border-radius"], "var(--r-btn)");
  assert.equal(group.padding, "var(--s-1)");

  const option = ruleFor(ALL_RULES, ".segmented__option");
  assert.ok(option["min-height"] === "44px" || option.height === "44px", "44px tall options");
  assert.equal(option["font-size"], "var(--fs-small)");
  assert.equal(option.color, "var(--muted)");

  const selected = ruleFor(ALL_RULES, ".segmented__option--selected");
  assert.equal(selected.background, "var(--accent)");
  assert.equal(selected.color, "var(--on-accent)");
});

test("a disabled segmented option dims unless it is the selected one", () => {
  const dimmed = ruleFor(
    ALL_RULES,
    ".segmented__option[disabled]:not(.segmented__option--selected)",
  );
  assert.equal(dimmed.opacity, ".5");
  const dimsSelected = ALL_RULES.some(
    (rule) =>
      rule.selector.includes(".segmented__option") &&
      rule.selector.includes("[disabled]") &&
      !rule.selector.includes(":not(") &&
      "opacity" in rule.declarations,
  );
  assert.ok(!dimsSelected, "the selected option keeps full contrast while disabled");
});

test("focus rings on the nav and the segmented control are drawn inside the target", () => {
  // The nav touches the viewport edges and the segmented options sit 4px apart, so an outside
  // ring would be clipped or bleed into the next option; an inset ring keeps all of it visible.
  assert.equal(ruleFor(ALL_RULES, ".nav__item:focus-visible")["outline-offset"], "-3px");
  assert.equal(ruleFor(ALL_RULES, ".segmented__option:focus-visible")["outline-offset"], "-3px");
  const selected = ruleFor(ALL_RULES, ".segmented__option--selected:focus-visible");
  assert.equal(selected["outline-color"], "var(--on-accent)", "the ring shows on the accent fill");
});

test("a secondary state action sits one scale step closer to the primary one", () => {
  const pair = ruleFor(ALL_RULES, ".state__action + .state__secondary");
  assert.equal(pair["margin-top"], "calc(-1 * var(--s-1))");
});
