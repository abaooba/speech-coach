// The 2026-10-19 design review found the rule fillers tip on the sample listing 0:15, 0:16 and
// 0:17 while its moment chips said 0:13, 0:14 and 0:15. tips.js counted clocks from the audio's
// start; coach.js, the speech map and the transcript count from the first word (the report's
// speechStart). tips.js now counts from the first word too, and when the Coach headline is
// about a filler (it then already says "Close your mouth and pause instead."), the tip lists
// the moments alone instead of repeating the technique.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(FRONTEND, ...parts), "utf8");
const SAMPLE_FILE = JSON.parse(read("sample-session.json"));

function loadTips() {
  const context = { app: {} };
  vm.runInNewContext(read("tips.js"), context, { filename: "tips.js" });
  return context.app.tips;
}

// The sample's numbers: the first word at 1.794 s, fillers at 15.559, 16.36 and 17.097 s.
const SAMPLE_REPORT = {
  wordsPerMinute: 146,
  fillersPerMinute: 10.5,
  fillers: [{ start: 15.559 }, { start: 16.36 }, { start: 17.097 }],
  speechStart: 1.794,
  pauses: [],
  repeatCount: 0,
};

test("the fillers tip counts its clocks from the first word, as the chips do", () => {
  const tips = loadTips();
  const [tip] = tips.select(SAMPLE_REPORT, { targetWpm: [130, 160] });
  assert.equal(tip.id, "fillers");
  assert.equal(
    tip.text,
    "Fillers at 0:13, 0:14 and 0:15. Next take, close your mouth and pause instead.",
  );
});

test("a report without a speech start still counts from the audio's start", () => {
  const tips = loadTips();
  const { speechStart, ...report } = SAMPLE_REPORT;
  assert.ok(speechStart);
  const [tip] = tips.select(report, { targetWpm: [130, 160] });
  assert.match(tip.text, /^Fillers at 0:15, 0:16 and 0:17\./);
});

test("when the headline is about a filler the tip lists the moments alone", () => {
  const tips = loadTips();
  const [tip] = tips.select(SAMPLE_REPORT, { targetWpm: [130, 160], headlineKind: "filler" });
  assert.equal(tip.text, "Fillers at 0:13, 0:14 and 0:15.");
  const [kept] = tips.select(SAMPLE_REPORT, { targetWpm: [130, 160], headlineKind: "restart" });
  assert.match(kept.text, /pause instead\.$/, "another headline leaves the technique in");
});

test("the freeze tip's clock counts from the first word too", () => {
  const tips = loadTips();
  const report = {
    ...SAMPLE_REPORT,
    fillers: [],
    fillersPerMinute: 0,
    pauses: [{ at: 36.3, length: 5.2, long: true, midSentence: false }],
  };
  const freeze = tips.select(report, { targetWpm: [130, 160] }).find((tip) => tip.id === "freeze");
  assert.equal(freeze.text, "You froze for 5.2 seconds at 0:34. Know how your next point opens.");
});

// Results hands tips.js the kind of the moment the rule headline is about.
function mountResults(session, tipsStub) {
  const app = {
    screens: {},
    passages: [{ id: "explain-something", kind: "passage", targetWpm: [130, 160] }],
    store: { get: () => Promise.resolve(session), list: () => Promise.resolve([session]) },
    router: { go() {} },
  };
  const context = { app, document: fakeDocument(), setTimeout, clearTimeout };
  ["ui.js", "passages.js", "delivery.js", "coach.js"].forEach((file) =>
    vm.runInNewContext(read(file), context, { filename: file }),
  );
  if (tipsStub) {
    app.tips = tipsStub;
  } else {
    vm.runInNewContext(read("tips.js"), context, { filename: "tips.js" });
  }
  vm.runInNewContext(read("screens", "results.js"), context, { filename: "results.js" });
  vm.runInNewContext(read("screens", "coachcard.js"), context, { filename: "coachcard.js" });
  const root = new FakeElement("section");
  root.appendChild(new FakeElement("h1"));
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  app.screens.results.mount(root);
  return { results: app.screens.results, body, app };
}

function sampleWithoutNotes() {
  const { coachNotes, ...plain } = structuredClone(SAMPLE_FILE);
  assert.ok(coachNotes);
  return { ...plain, id: "sample-1", createdAt: "2026-10-08T19:07:00Z" };
}

test("Results passes the headline's moment kind to tips.select: a filler on the sample", async () => {
  const calls = [];
  const { results } = mountResults(sampleWithoutNotes(), {
    select: (report, options) => {
      calls.push(options);
      return [];
    },
  });
  await results.show({ id: "sample-1" });
  assert.ok(calls.length >= 1);
  assert.equal(calls[0].headlineKind, "filler");
  assert.deepEqual(Array.from(calls[0].targetWpm), [130, 160]);
});

function findAll(node, name, found = []) {
  (node.children || []).forEach((child) => {
    if (child.classList && child.classList.contains(name)) {
      found.push(child);
    }
    findAll(child, name, found);
  });
  return found;
}

test("on the sample the rule fillers tip and its chips agree, and the technique is said once", async () => {
  const { results, body } = mountResults(sampleWithoutNotes());
  await results.show({ id: "sample-1" });
  const card = byClass(body, "coach-card");
  const headline = findAll(card, "coach-card__headline")[0];
  const texts = findAll(card, "coach-tip__text").map((node) => node.textContent);
  const fillers = texts.find((text) => text.startsWith("Fillers at"));
  assert.equal(fillers, "Fillers at 0:13, 0:14, 0:15 and 2 more.");
  const chips = findAll(card, "moment-chip").map((chip) =>
    (chip.textContent || "") + chip.children.map((c) => c.textContent || "").join(""),
  );
  assert.ok(chips.some((chip) => chip.includes("0:13")), JSON.stringify(chips));
  const headlineText = (headline.textContent || "") + headline.children.map((c) => c.textContent || "").join("");
  assert.match(headlineText, /Close your mouth and pause instead\./);
});
