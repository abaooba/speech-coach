// The 2026-10-19 design review: a Path unit card shows its study as a muted "Source:" line
// under the why sentence: the short credit, surnames and year, is the link, and the work
// follows in plain text. The link keeps its href, new-tab note and class; it sits in
// `span.path-unit__source-line`, which the stylesheet puts on its own line with the "Source:"
// label drawn before it.
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
    const links = line.children.filter((child) => child.tagName === "a");
    assert.equal(links.length, 1, "one link; the work is plain text after it");
    const link = links[0];
    assert.equal(link.tagName, "a");
    assert.ok(link.classList.contains("path-unit__source"));
    assert.match(harness.visible(link), /^[A-Z][^,]*(,| and| et al\.)?[^(]*\((\d{4}|n\.d\.)\)$/, "surnames and year");
    const credit = world.app.path.creditOf(unitData(world, unit).why.entry);
    assert.equal(harness.visible(line), harness.visible(link) + ", " + credit.work);
  }
});

function unitData(world, unit) {
  const title = harness.visible(harness.find(unit, "path-unit__title"));
  return world.app.path.UNITS.find((pathUnit) => pathUnit.title === title);
}

test("creditOf gives the surnames and the year, et al. from four authors on, and the work", () => {
  const { app } = harness.mountPath();
  const credit = (unitId) => app.path.creditOf(app.path.UNITS.find((unit) => unit.id === unitId).why.entry);
  assert.equal(credit("restarts").short, "Lambert, Kormos and Minn (2017)");
  assert.equal(credit("fillers").short, "Pawlik and Perrin (2020)");
  assert.equal(credit("long-pauses").short, "Tran and Saito (n.d.)");
  assert.equal(credit("pace").short, "Bosker et al. (2013)");
  assert.equal(credit("restarts").work, "Task Repetition and Second Language Speech Processing");
  assert.equal(app.path.creditOf("no-such-entry"), null);
  const why = app.path.UNITS.find((unit) => unit.id === "restarts").why;
  assert.deepEqual(Object.keys(why), ["entry", "text", "label", "url"], "the why shape is unchanged");
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
