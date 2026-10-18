// Tests that a sheet that fails to open never breaks the screen under it (guided coach, final
// review finding 6): on Results the coach notes still arrive in the Coach card and its "Writing
// notes on this take…" status still goes; in a Path level the Result still shows and the run
// goes on. app.sheet.open is made to throw.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { mount, find, text, yourDay, REPLY, AI_HEADLINE } = require("./results-sheet-harness");
const { FakeTextNode } = require("./fake-dom");
const levelHarness = require("./level-harness");

const FRONTEND = path.join(__dirname, "..");
const load = (file) => fs.readFileSync(path.join(FRONTEND, file), "utf8");

function breakSheet(app) {
  const calls = { open: 0 };
  app.sheet.open = () => {
    calls.open += 1;
    throw new Error("the sheet could not open");
  };
  return calls;
}

test("Results: a sheet that throws still lets the notes reach the card and the status go", async () => {
  const page = mount([yourDay("t1")], {
    advice: () => Promise.resolve({ status: 200, body: REPLY }),
  });
  const calls = breakSheet(page.app);
  page.results.markFresh("t1");
  await assert.doesNotReject(page.results.show({ id: "t1" }));
  assert.equal(calls.open, 1, "the sheet was tried");
  assert.equal(find(page.body, "coach-card__status"), null, "no stuck Writing notes… status");
  assert.equal(text(find(page.body, "coach-card__headline")), AI_HEADLINE);
});

test("Results: when the notes fail too, the status still goes", async () => {
  const page = mount([yourDay("t1")], {
    advice: () => Promise.resolve({ status: 500, body: { detail: "down" } }),
  });
  breakSheet(page.app);
  page.results.markFresh("t1");
  await assert.doesNotReject(page.results.show({ id: "t1" }));
  assert.equal(find(page.body, "coach-card__status"), null);
});

function levelWorld() {
  const { at, createWorld, talkResult, savedTake } = levelHarness;
  const world = createWorld({
    history: [
      savedTake({ id: "y1", createdAt: at("2026-10-13", 10), result: talkResult({ fillers: 12 }) }),
    ],
    cleared: [{ levelId: "fillers-3", clearedAt: at("2026-10-10") }],
  });
  const app = world.app;
  const Element = world.body.constructor;
  const document = {
    createElement: (tag) => new Element(tag, null, world),
    createTextNode: (value) => new FakeTextNode(value),
  };
  const context = { app, document };
  vm.runInNewContext(load("screens/results.js"), context, { filename: "results.js" });
  vm.runInNewContext(load("coach.js"), context, { filename: "coach.js" });
  vm.runInNewContext(load("nextmove.js"), context, { filename: "nextmove.js" });
  vm.runInNewContext(load("sheet.js"), context, { filename: "sheet.js" });
  app.sheet.firstVisit = () => Promise.resolve(false);
  return world;
}

test("Level: a sheet that throws still shows the Result", async () => {
  const world = levelWorld();
  const calls = breakSheet(world.app);
  await world.open("fillers-3_checkback");
  world.tap("Record");
  await assert.doesNotReject(world.finishTake(levelHarness.talkResult({ fillers: 5 })));
  assert.equal(calls.open, 1, "the sheet was tried");
  assert.equal(
    levelHarness.textOf(levelHarness.find(world.body, "level-result__title")),
    "Check-back 1",
  );
  assert.deepEqual(world.store.marks, ["fillers-3_cb1"], "the pass is kept");
});
