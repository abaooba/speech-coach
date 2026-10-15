// Onboarding shows the app icon above its first sentence, drawn by CSS so the screen's DOM
// (pinned by onboarding.test.js) does not change.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp("\\n" + escaped + " \\{([^}]*)\\}"));
  assert.ok(match, "styles.css has a rule for " + selector);
  return match[1];
}

test("the lead paragraph draws the app icon above itself", () => {
  const rule = ruleFor(".onboarding__lead::before");
  assert.match(rule, /content: ""/);
  assert.match(rule, /display: block/);
  assert.match(rule, /width: 64px/);
  assert.match(rule, /height: 64px/);
  assert.match(rule, /url\("icons\/icon\.svg"\)/);
  assert.match(rule, /margin: 0 0 var\(--s-4\)/);
});

test("the icon file the rule points at exists", () => {
  assert.ok(fs.existsSync(path.join(__dirname, "..", "icons", "icon.svg")));
});
