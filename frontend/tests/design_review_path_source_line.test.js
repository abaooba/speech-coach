// The 2026-10-19 design review: a Path unit card shows its study as a muted "Source:" line
// under the why sentence, with only the citation (author, work and year) as the link. The link
// keeps its text, href, new-tab note and class; it now sits in `span.path-unit__source-line`,
// which the stylesheet puts on its own line with the "Source:" label drawn before it.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const harness = require("./path-screen-harness");

const FRONTEND = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(FRONTEND, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const DESIGN = fs.readFileSync(path.join(FRONTEND, "DESIGN.md"), "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp("(?:^|\\n)" + escaped + "\\s*\\{([^}]*)\\}"));
  assert.ok(match, "styles.css has a rule for " + selector);
  return match[1];
}

test("each unit's source link sits alone in a source line after the why sentence", async () => {
  const world = harness.mountPath();
  await world.screen.show();
  await harness.settle();
  const units = harness.findAll(world.body, "path-unit");
  assert.ok(units.length >= 4);
  for (const unit of units) {
    const why = harness.find(unit, "path-unit__why");
    const line = why.children[why.children.length - 1];
    assert.ok(line.classList.contains("path-unit__source-line"), "the line ends the why");
    assert.equal(line.tagName, "span");
    assert.equal(line.children.length, 1);
    const link = line.children[0];
    assert.equal(link.tagName, "a");
    assert.ok(link.classList.contains("path-unit__source"));
    assert.match(harness.visible(link), /\(\d{4}|n\.d\.\)$/, "author, work and year");
    assert.equal(harness.visible(line), harness.visible(link), "the line adds no words");
  }
});

test("the source line is its own muted line with the Source label drawn before the link", () => {
  const line = rule(".path-unit__source-line");
  assert.match(line, /display:\s*block/);
  assert.match(line, /margin-top:\s*var\(--s-1\)/);
  assert.match(rule(".path-unit__source-line::before"), /content:\s*"Source: "/);
});

test("DESIGN.md describes the unit card's Source line", () => {
  assert.match(DESIGN, /`\.path-unit__source-line`/);
  assert.match(DESIGN, /"Source: "/);
});
