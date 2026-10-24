// Pins what Progress says when a chart holds under two takes (tester item 4; spec
// docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 6). Read's Slips chart
// leaves out a read with no script block (it strayed from its passage, or was saved before takes
// were lined up against their script), so it can chart one read, or none, while the Read mode
// holds two. Then no earlier charted take gives an average: "From your average" reads "Not
// measured", in the none style Latest and Best use, never "No change". The chart's aria-label
// says "1 session" for one point and gives no latest value when nothing is charted, so a screen
// reader never hears a measured 0. A Talk chart needs two takes, so nothing it shows changes.
// ui.js, passages.js, language.js and screens/progress.js run for real against the shared fake
// DOM; summarize is a stub that hands back each session's `metrics` as its summary, as in
// progress_talk_read.test.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const SOURCES = ["ui.js", "passages.js", "language.js", path.join("screens", "progress.js")].map(
  (file) => [file, read(file)],
);

// The class of a cell with nothing to show, and of the change cell when it has a number.
const NONE_CELL = "progress-summary__value progress-summary__value--none";
const CHANGE_CELL = "progress-summary__change num";

// A read that strayed from its passage: its report says it did not follow the script, so
// Slips cannot count it.
const STRAYED = { slipsPerMinute: 0, report: { speakingSeconds: 40, followedScript: false } };

// A stored session on `day` of October 2026 at noon UTC; `metrics` doubles as its summary.
function sessionOf(id, day, passageId, metrics) {
  return {
    id,
    createdAt: "2026-10-" + String(day).padStart(2, "0") + "T12:00:00.000Z",
    passageId,
    passageTitle: passageId,
    durationSeconds: 60,
    metrics,
    transcript: [],
  };
}

function talkOf(id, day, numbers) {
  return sessionOf(id, day, "free-talk", {
    wpm: 130,
    fillersPerMinute: 4,
    slipsPerMinute: 1,
    pauseCount: 4,
    cleanStretchSeconds: 10,
    ...numbers,
  });
}

function readOf(id, day, numbers) {
  return sessionOf(id, day, "explainer-rainbows", {
    wpm: 155,
    fillersPerMinute: 0,
    slipsPerMinute: 0,
    pauseCount: 0,
    cleanStretchSeconds: 40,
    ...numbers,
  });
}

// Mounts Progress with the store listing `sessions` (given oldest first) newest first.
function mount(sessions) {
  const context = {
    app: {
      screens: { results: { summarize: (stored) => stored.metrics } },
      store: { list: () => Promise.resolve([...sessions].reverse()) },
      router: { go() {} },
    },
    document: fakeDocument(),
  };
  SOURCES.forEach(([file, source]) => vm.runInNewContext(source, context, { filename: file }));
  const root = new FakeElement("section");
  const heading = new FakeElement("h1");
  heading.textContent = "Progress";
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(heading);
  root.appendChild(body);
  const progress = context.app.screens.progress;
  progress.mount(root);
  return { progress, body };
}

// Shows Progress for `sessions`, then taps `mode` on the Talk | Read switch (null for none) and
// `option` on the metric switch, the last control, which a mode tap may have rebuilt.
async function showChart(sessions, mode, option) {
  const { progress, body } = mount(sessions);
  await progress.show();
  if (mode !== null) {
    tap(switchesOf(body)[0], mode);
  }
  const switches = switchesOf(body);
  tap(switches[switches.length - 1], option);
  return body;
}

function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

// The segmented controls in body order: the mode switch first when there is one.
function switchesOf(body) {
  return body.children.filter((child) => child.classList.contains("segmented"));
}

function tap(control, label) {
  const option = control.children.find((child) => child.textContent === label);
  assert.ok(option, "an option labelled " + label);
  option.listeners.click[0]({ preventDefault() {} });
}

function chartOf(body) {
  const chart = body.children.find((child) => child.getAttribute("class") === "chart");
  assert.ok(chart, "the body holds the chart");
  return chart;
}

function dotsOf(body) {
  return chartOf(body).children.filter((child) => child.tagName === "circle");
}

function labelOf(body) {
  return chartOf(body).getAttribute("aria-label");
}

// Each summary cell as its label and value read together, "Latest1.4 /min".
function summaryOf(body) {
  const summary = byClass(body, "progress-summary");
  assert.ok(summary, "the body holds the summary row");
  return summary.children.map((item) => fullText(item));
}

// Each summary cell's value: its tag, class, words and icon (null without one).
function valuesOf(body) {
  return byClass(body, "progress-summary").children.map((item) => {
    const value = item.children[1];
    const icon = value.children.find((child) => child.tagName === "svg");
    return {
      tag: value.tagName,
      className: value.className,
      text: fullText(value),
      icon: icon ? icon.getAttribute("data-icon") : null,
    };
  });
}

// One read Slips can count of two (the newer), and of three (the oldest).
const ONE_COUNTED = [
  [[readOf("r1", 1, STRAYED), readOf("r2", 2, { slipsPerMinute: 1.4 })], 1.4],
  [
    [readOf("r1", 1, { slipsPerMinute: 2.8 }), readOf("r2", 2, STRAYED), readOf("r3", 3, STRAYED)],
    2.8,
  ],
];
const NONE_COUNTED = [readOf("r1", 1, STRAYED), readOf("r2", 2, STRAYED)];

test("one read counted: From your average reads Not measured, in the none style", async () => {
  for (const [sessions, slips] of ONE_COUNTED) {
    const body = await showChart(sessions, null, "Slips");
    const name = "one counted of " + sessions.length;
    assert.equal(dotsOf(body).length, 1, name);
    assert.deepEqual(
      summaryOf(body),
      ["Latest" + slips + " /min", "Best" + slips + " /min", "From your averageNot measured"],
      name,
    );
    assert.deepEqual(
      valuesOf(body)[2],
      { tag: "dd", className: NONE_CELL, text: "Not measured", icon: null },
      name + ": the change cell takes Latest and Best's none style, with no triangle or dash",
    );
  }
});

test("no read counted: all three cells read Not measured, in the none style", async () => {
  const body = await showChart(NONE_COUNTED, null, "Slips");
  assert.equal(dotsOf(body).length, 0);
  assert.deepEqual(
    valuesOf(body),
    [0, 1, 2].map(() => ({ tag: "dd", className: NONE_CELL, text: "Not measured", icon: null })),
  );
});

test("one read counted: the chart's label says 1 session, then its latest value", async () => {
  for (const [sessions, slips] of ONE_COUNTED) {
    const body = await showChart(sessions, null, "Slips");
    assert.equal(labelOf(body), "Read · Slips per minute over 1 session, latest " + slips);
  }
});

test("no read counted: the chart's label says 0 sessions and gives no latest value", async () => {
  // A latest of 0 would be heard as a measured 0, a clean read.
  const body = await showChart(NONE_COUNTED, null, "Slips");
  assert.equal(labelOf(body), "Read · Slips per minute over 0 sessions");
});

test("two reads counted: the change and the label are as before", async () => {
  const cases = [
    [readOf("r1", 1, { slipsPerMinute: 2.8 }), readOf("r2", 2, { slipsPerMinute: 1.4 })],
    [
      readOf("r1", 1, { slipsPerMinute: 2.8 }),
      readOf("r2", 2, STRAYED),
      readOf("r3", 3, { slipsPerMinute: 1.4 }),
    ],
  ];
  for (const sessions of cases) {
    const body = await showChart(sessions, null, "Slips");
    const name = sessions.length + " reads";
    assert.equal(dotsOf(body).length, 2, name);
    assert.deepEqual(
      summaryOf(body),
      ["Latest1.4 /min", "Best1.4 /min", "From your average1.4 fewer"],
      name,
    );
    assert.deepEqual(
      valuesOf(body)[2],
      { tag: "dd", className: CHANGE_CELL, text: "1.4 fewer", icon: "triangle-down" },
      name,
    );
    assert.equal(labelOf(body), "Read · Slips per minute over 2 sessions, latest 1.4", name);
  }
});

test("the reads Slips leaves out still chart Pace, Pauses and Clean, each as before", async () => {
  const sessions = [readOf("r1", 1, STRAYED), readOf("r2", 2, { slipsPerMinute: 1.4 })];
  const expected = [
    ["Pace", "Read · Words per minute over 2 sessions, latest 155"],
    ["Pauses", "Read · Pauses over 2 sessions, latest 0"],
    ["Clean", "Read · Longest clean stretch over 2 sessions, latest 40"],
  ];
  for (const [option, label] of expected) {
    const body = await showChart(sessions, null, option);
    assert.equal(dotsOf(body).length, 2, option);
    assert.deepEqual(
      valuesOf(body)[2],
      { tag: "dd", className: CHANGE_CELL, text: "No change", icon: "dash" },
      option,
    );
    assert.equal(labelOf(body), label);
  }
});

test("a Talk chart is unchanged: its two takes always give a change and a latest", async () => {
  // Two talk takes, the fewest a chart is drawn for, alone and beside a read take.
  const first = talkOf("t1", 1, { wpm: 120, fillersPerMinute: 4, pauseCount: 4 });
  const second = talkOf("t2", 3, {
    wpm: 132,
    fillersPerMinute: 2,
    pauseCount: 3,
    cleanStretchSeconds: 12.5,
  });
  const expected = [
    ["Pace", "Words per minute", "12 faster", "triangle-up", 132],
    ["Fillers", "Fillers per minute", "2.0 fewer", "triangle-down", 2],
    ["Pauses", "Pauses", "1 fewer", "triangle-down", 3],
    ["Clean", "Longest clean stretch", "2.5 s longer", "triangle-up", 12.5],
  ];
  const views = [
    [[first, second], null, ""],
    [[first, readOf("r1", 2, { slipsPerMinute: 1.4 }), second], "Talk", "Talk · "],
  ];
  for (const [sessions, mode, prefix] of views) {
    for (const [option, title, change, icon, latest] of expected) {
      const body = await showChart(sessions, mode, option);
      const name = prefix + title;
      assert.equal(dotsOf(body).length, 2, name);
      assert.deepEqual(
        valuesOf(body)[2],
        { tag: "dd", className: CHANGE_CELL, text: change, icon },
        name,
      );
      assert.equal(labelOf(body), name + " over 2 sessions, latest " + latest);
    }
  }
});
