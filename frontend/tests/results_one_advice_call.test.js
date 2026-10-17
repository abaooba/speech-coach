// Tests that the sheet after a take and the Coach card share ONE coach-notes request (guided
// coach, final review finding 4; spec Phase 5 item 6: the sheet is "upgraded from the same
// coachNotes promise"). A fresh take asks POST /api/advice once, whether the reply is quick or
// slow, and Claude's headline then shows in both places. The mount is results_sheet.test.js's:
// the real modules in a vm, with a fake store, api, router and document.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mount,
  sheetOf,
  find,
  text,
  flush,
  deferred,
  yourDay,
  REPLY,
  AI_HEADLINE,
} = require("./results-sheet-harness");

const TAKE = yourDay("t1");

function adviceCalls(page) {
  return page.calls.advice.length;
}

test("a fresh take asks for coach notes once, and the sheet and the card both get the headline", async () => {
  const page = mount([TAKE], { advice: () => Promise.resolve({ status: 200, body: REPLY }) });
  page.results.markFresh("t1");
  await page.results.show({ id: "t1" });
  assert.equal(adviceCalls(page), 1, "one POST /api/advice for the take");
  const sheet = sheetOf(page.doc);
  assert.ok(sheet, "the sheet opened");
  assert.equal(text(find(sheet, "sheet__line")), AI_HEADLINE);
  assert.equal(text(find(page.body, "coach-card__headline")), AI_HEADLINE);
});

test("a slow reply is still one request: the sheet opens without asking again", async () => {
  const replied = deferred();
  const page = mount([TAKE], { advice: () => replied.promise });
  page.results.markFresh("t1");
  const shown = page.results.show({ id: "t1" });
  for (let round = 0; round < 6; round += 1) {
    await flush();
  }
  assert.ok(sheetOf(page.doc), "the sheet is open while the notes are on their way");
  assert.equal(adviceCalls(page), 1);
  replied.resolve({ status: 200, body: REPLY });
  await shown;
  assert.equal(adviceCalls(page), 1, "still one once the reply lands");
  assert.equal(text(find(sheetOf(page.doc), "sheet__line")), AI_HEADLINE);
  assert.equal(text(find(page.body, "coach-card__headline")), AI_HEADLINE);
});

test("a library reply, which is not kept, is still asked for once per show", async () => {
  const library = { ...REPLY, source: "library" };
  const page = mount([TAKE], { advice: () => Promise.resolve({ status: 200, body: library }) });
  page.results.markFresh("t1");
  await page.results.show({ id: "t1" });
  for (let round = 0; round < 6; round += 1) {
    await flush();
  }
  assert.equal(adviceCalls(page), 1);
  assert.equal(text(find(sheetOf(page.doc), "sheet__line")), AI_HEADLINE);
});

test("the same take shown again without the fresh mark asks nothing new and opens no sheet", async () => {
  const page = mount([TAKE], { advice: () => Promise.resolve({ status: 200, body: REPLY }) });
  page.results.markFresh("t1");
  await page.results.show({ id: "t1" });
  find(sheetOf(page.doc), "sheet__handle").click();
  await page.results.show({ id: "t1" });
  assert.equal(adviceCalls(page), 1, "Claude's notes for the take are kept, not asked for again");
  assert.equal(sheetOf(page.doc), null);
});
