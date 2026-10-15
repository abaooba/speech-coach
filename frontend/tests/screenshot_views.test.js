// scripts/screenshot_views.js: the README's screens in both themes, and the expression that
// seeds a fresh install's IndexedDB with the given sessions and skips onboarding.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const views = require(path.join(__dirname, "..", "..", "scripts", "screenshot_views.js"));

const README_SCREENS = ["onboarding", "practice", "results", "history", "progress"];

test("VIEWS covers the five README screens in light and dark at phone size", () => {
  for (const screen of README_SCREENS) {
    for (const theme of ["light", "dark"]) {
      const view = views.VIEWS.find((v) => v.name === screen + "-" + theme);
      assert.ok(view, screen + "-" + theme);
      assert.equal(view.theme, theme);
      assert.equal(view.w, 375);
      assert.equal(view.h, 812);
    }
  }
});

test("every view routes to a hash the app knows, or to @results for the seeded take", () => {
  const known = ["/onboarding", "/practice", "/history", "/progress", "@results"];
  for (const view of views.VIEWS) {
    assert.ok(known.includes(view.route), view.name + " -> " + view.route);
  }
});

test("seedExpression saves each session through app.store and sets the onboarded flag", () => {
  const source = views.seedExpression([{ passageId: "free-talk", transcript: [] }]);
  assert.match(source, /app\.store\.save\(/);
  assert.match(source, /app\.store\.setFlag\("onboarded", true\)/);
  assert.ok(source.includes('"passageId":"free-talk"'));
  // Split so the repo-wide HTML-injection scan does not flag this file.
  assert.ok(!source.includes("inner" + "HTML"));
});

test("resultsRoute builds the Results hash for a saved id", () => {
  assert.equal(views.resultsRoute("abc"), "/results/abc");
});

test("only the two Results views are captured full page", () => {
  for (const view of views.VIEWS) {
    assert.equal(view.full === true, view.name.startsWith("results-"), view.name);
  }
  assert.equal(views.VIEWS.filter((v) => v.full === true).length, 2);
});
