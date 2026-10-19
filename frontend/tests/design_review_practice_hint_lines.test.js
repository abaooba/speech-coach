// The 2026-10-19 design review: "See a sample result" and "Paste your script (optional)" sit on
// separate lines of the Practice hint, instead of sharing one. The hint stays a centered
// wrapping row and the DOM is unchanged; the sample button takes a whole line, so the closed
// script box wraps under it.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(FRONTEND, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const DESIGN = fs.readFileSync(path.join(FRONTEND, "DESIGN.md"), "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp("(?:^|\\n)" + escaped + "\\s*\\{([^}]*)\\}"));
  assert.ok(match, "styles.css has a rule for " + selector);
  return match[1];
}

test("the sample button takes a whole line of the hint, so the script box drops under it", () => {
  assert.match(rule(".practice__sample"), /flex-basis:\s*100%/);
  assert.match(rule(".practice__hint"), /flex-wrap:\s*wrap/);
});

test("DESIGN.md says the sample link and the script summary sit on separate lines", () => {
  assert.match(DESIGN, /script box's summary sits on its own line under it/);
  assert.doesNotMatch(DESIGN, /the two share one line/);
});
