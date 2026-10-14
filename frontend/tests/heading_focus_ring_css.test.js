// Tests that a heading the app focuses for screen readers shows no focus ring, while every
// control keeps the accent ring. The router focuses each new screen's h1, and the Level screen
// each step's heading, with tabindex="-1"; on a phone that drew a blue box around "Path" and
// "Progress" after every tap on the nav.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

// The declarations of the first rule whose selector is exactly `selector`, as one string.
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp("(^|\\n)" + escaped + " \\{([^}]*)\\}"));
  return match ? match[2] : null;
}

test("a focused heading with tabindex -1 shows no ring", () => {
  const body = ruleBody(':is(h1, h2, h3)[tabindex="-1"]:focus');
  assert.ok(body, "the rule exists");
  assert.match(body, /outline:\s*none;/);
});

test("controls keep the accent focus ring", () => {
  const body = ruleBody(":focus-visible");
  assert.ok(body, "the base ring exists");
  assert.match(body, /outline:\s*3px solid var\(--accent\);/);
  assert.match(body, /outline-offset:\s*2px;/);
});

test("the no-ring rule is limited to headings the app focuses", () => {
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const noRing = [...rules.matchAll(/([^{}]+)\{[^}]*outline:\s*none;[^}]*\}/g)]
    .map((match) => match[1].trim())
    .filter((selector) => /\[tabindex="-1"\]/.test(selector));
  assert.deepEqual(noRing, [':is(h1, h2, h3)[tabindex="-1"]:focus']);
});
