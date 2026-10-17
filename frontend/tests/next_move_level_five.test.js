// Controller Ruling 5: a level just passed whose cleared record is not saved yet still advances.
// Passing level 5 with the cleared list not yet holding it suggests the unit's checkpoint, never
// level 5 again; passing level 2 never replays level 2.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.join(__dirname, "..");

function loadApp() {
  const app = { screens: {} };
  const context = { app };
  ["passages.js", "delivery.js", "path.js", "nextmove.js"].forEach((file) => {
    const source = fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
    vm.runInNewContext(source, context, { filename: file });
  });
  return app;
}

const APP = loadApp();
const TODAY = "2026-10-20";

function records(unit, count) {
  return Array.from({ length: count }, (_, i) => ({ levelId: unit + "-" + (i + 1) }));
}

test("passing level 5 before its record is saved suggests the checkpoint", () => {
  const move = APP.nextMove({
    history: [],
    cleared: records("restarts", 4),
    today: TODAY,
    after: { type: "level", levelId: "restarts-5", passed: true },
  });
  assert.equal(move.kind, "checkpoint");
  assert.equal(move.label, "Start: Restarts checkpoint");
});

test("passing level 2 before its record is saved suggests level 3", () => {
  const move = APP.nextMove({
    history: [],
    cleared: records("restarts", 1),
    today: TODAY,
    after: { type: "level", levelId: "restarts-2", passed: true },
  });
  assert.equal(move.kind, "next-level");
  assert.equal(move.label, "Start: Restarts level 3");
});
