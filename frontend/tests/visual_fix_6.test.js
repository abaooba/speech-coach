// Review row 6: a state block that carries a preview (Progress with one take, under the rank
// card) must fit a 375 x 812 phone without scrolling the page. Its --s-7 top and bottom padding
// is what pushed it 44px over, so a block with a preview takes --s-4 all round instead.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const match = CSS.match(new RegExp("\\n" + escaped + " \\{([^}]*)\\}"));
  assert.ok(match, "styles.css has a rule for " + selector);
  return match[1];
}

test("a state block with a preview uses the small padding step", () => {
  assert.match(ruleFor(".screen--active .state:has(> .state__preview)"), /padding: var\(--s-4\);/);
});

test("the plain state block keeps its large padding", () => {
  assert.match(ruleFor(".state"), /padding: var\(--s-7\) var\(--s-4\);/);
});

test("the preview rule comes after .state and uses no hex colour", () => {
  assert.ok(CSS.indexOf("\n.screen--active .state:has(> .state__preview) {") > CSS.indexOf("\n.state {"));
  assert.doesNotMatch(ruleFor(".screen--active .state:has(> .state__preview)"), /#[0-9a-fA-F]{3,8}/);
});
