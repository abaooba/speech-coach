// Tests that the docs describe the long pause the Results timeline draws (docs/PLAN.md T32: a
// pause of 5 s or more counts and is marked wherever it falls), as the transcript copy already
// does (mhm_long_pause_copy.test.js). frontend/README.md's timeline step and DESIGN.md's Timeline
// paragraph and fixed copy quote the chip, the label and the moment the strip shows on the real
// church take, read from the screen rather than written out here. how.html keeps "long pause"
// for 5 s or more: the tip for a mid-sentence pause past 3 seconds is named for what it is.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const REPO_DIR = path.join(FRONTEND_DIR, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const SOURCES = ["ui.js", "delivery.js", "tips.js", path.join("screens", "results.js")].map(
  (file) => [file, read(file)],
);

// The owner's real 2026-10-11 church take as the API stores it, with the backend metrics of the
// same words (as in mhm_long_pause_copy.test.js): after "sad." the owner froze for 5.19 s.
const CHURCH_TRANSCRIPT = JSON.parse(
  fs.readFileSync(
    path.join(REPO_DIR, "backend", "tests", "fixtures", "take_2026_10_11_nervous.json"),
    "utf8",
  ),
).words.map((word) => ({ text: word.text, start: word.start / 1000, end: word.end / 1000 }));
const CHURCH_METRICS = {
  words_per_minute: 145.7,
  duration: 61.764,
  word_count: 150,
  pauses: [
    [25.305, 2.074],
    [35.738, 5.19],
    [46.717, 3.543],
  ],
  fillers: {
    um: 2, uh: 0, hmm: 0, mhm: 1, like: 1, "you know": 0, so: 2, basically: 0, actually: 1,
  },
  repeats: [{ text: "I kinda ner", at: 27.379 }],
  pace_windows: [],
};

// The church take's timeline as Results draws it: its marks, its label, the legend's chips and
// the hidden list of moments.
async function churchTimeline() {
  const session = {
    id: "s1",
    createdAt: "2026-10-11T19:00:00.000Z",
    passageId: "talk",
    passageTitle: "Talk",
    durationSeconds: 62,
    metrics: CHURCH_METRICS,
    transcript: CHURCH_TRANSCRIPT.map((word) => ({ ...word })),
  };
  const context = {
    app: {
      screens: {},
      passages: [{ id: "talk", targetWpm: [140, 160] }],
      store: { get: () => Promise.resolve(session) },
      router: { go() {} },
    },
    document: fakeDocument(),
  };
  SOURCES.forEach(([file, source]) => vm.runInNewContext(source, context, { filename: file }));
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  await context.app.screens.results.show({ id: session.id });
  const timeline = byClass(body, "timeline");
  const strip = timeline.children.find((node) => node.getAttribute("class") === "timeline__strip");
  return {
    marks: strip.children.map((mark) => mark.getAttribute("class")),
    label: strip.getAttribute("aria-label"),
    chips: byClass(timeline, "timeline__legend").children.map(fullText),
    moments: byClass(timeline, "timeline__moments").children.map(fullText),
  };
}

function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

// A document's text with every run of spaces and line breaks read as one space.
function flat(text) {
  return text.replace(/\s+/g, " ");
}

// The README's numbered Results step that opens with `title`, up to the next step.
function readmeStep(title) {
  const readme = read("README.md");
  const start = readme.indexOf(title);
  assert.ok(start !== -1, "frontend/README.md has the step " + title);
  const end = readme.slice(start).search(/\n\d+\. /);
  return flat(readme.slice(start, end === -1 ? undefined : start + end));
}

// DESIGN.md's paragraph that opens with `**name**`.
function designParagraph(name) {
  const line = read("DESIGN.md")
    .split("\n")
    .find((text) => text.startsWith("**" + name + "**"));
  assert.ok(line, "DESIGN.md has a " + name + " paragraph");
  return line;
}

const LONG_CHIP = "Long pause (5 s+)";
// A long pause as the hidden list reads it: "Long pause at 0:35, 5.2 seconds". The docs may give
// their own example, in this shape.
const LONG_MOMENT = /^Long pause at \d+:\d{2}, \d+\.\d seconds$/;

// The long-pause moments quoted in `text`, without their quotes.
function quotedMoments(text) {
  return [...text.matchAll(/"(Long pause at [^"]*)"/g)].map((match) => match[1]);
}

test("on the church take the strip draws its freeze as a long pause, with chip and moment", async () => {
  const timeline = await churchTimeline();
  assert.deepEqual(
    timeline.marks.filter((mark) => /pause/.test(mark)),
    ["timeline__long-pause"],
    "the 5.19 s freeze after a period is the one pause drawn, as a long pause",
  );
  assert.ok(timeline.chips.includes(LONG_CHIP));
  assert.match(timeline.label, /, no mid-sentence pauses, 1 long pause, /);
  assert.ok(timeline.moments.includes("Long pause at 0:35, 5.2 seconds"));
});

test("frontend/README.md's timeline step shows the long pause the strip draws", async () => {
  const timeline = await churchTimeline();
  const step = readmeStep("4. Speech timeline:");
  assert.ok(
    step.includes("a taller pink block for each pause of 5 s or more, even after a period"),
    "the strip's long-pause block",
  );
  assert.ok(step.includes('adds "' + LONG_CHIP + '"'), "the legend's chip");
  assert.ok(timeline.chips.includes(LONG_CHIP));
  assert.ok(step.includes('"1 long pause"'), "the label's count");
  assert.ok(timeline.moments.some((text) => LONG_MOMENT.test(text)));
  const quoted = quotedMoments(step);
  assert.equal(quoted.length, 1, "one long-pause moment quoted");
  assert.match(quoted[0], LONG_MOMENT);
});

test("DESIGN.md's Timeline paragraph draws, labels, keys and lists the long pause", async () => {
  const timeline = await churchTimeline();
  const paragraph = designParagraph("Timeline");
  assert.ok(paragraph.includes("`rect.timeline__long-pause`"));
  assert.ok(paragraph.includes("`--pause-long`"));
  assert.ok(paragraph.includes("as tall as a filler tick"));
  assert.ok(!paragraph.includes("each mid-sentence pause as a `--pause` block"));
  assert.ok(paragraph.includes('adds "1 long pause" after the mid-sentence count'));
  assert.ok(paragraph.includes('"' + LONG_CHIP + '" for a take with one'));
  assert.ok(paragraph.includes("`.timeline__swatch--long-pause`"));
  assert.ok(timeline.moments.some((text) => LONG_MOMENT.test(text)));
  const quoted = quotedMoments(paragraph);
  assert.equal(quoted.length, 1, "the moments list quotes one long pause");
  assert.match(quoted[0], LONG_MOMENT);
});

test("DESIGN.md's fixed copy lists the long-pause chip with the timeline legend", () => {
  const results = read("DESIGN.md")
    .split("\n")
    .find((line) => line.startsWith('- Results: "Arrows compare with your last take."'));
  assert.ok(results, "DESIGN.md section 8 has the Results copy line");
  assert.ok(
    results.includes(
      'legend "Filler", "Mid-sentence pause", "Clean stretch", plus "' + LONG_CHIP +
        '" and "Restart" when the strip draws one;',
    ),
  );
});

test("how.html keeps 'long pause' for 5 s or more: the 3-second tip is a mid-sentence pause", () => {
  const html = read("how.html");
  const rows = [...html.matchAll(/<th scope="row">([^<]*)<\/th>\s*<td>([^<]*)<\/td>/g)].map(
    (match) => [match[1], flat(match[2]).trim()],
  );
  const tip = rows.find(([, rule]) => rule === "A mid-sentence pause runs past 3 seconds.");
  assert.ok(tip, "the tips table has the 3-second rule");
  assert.equal(tip[0], "Mid-sentence pause");
  assert.ok(!rows.some(([name]) => /long pause/i.test(name)), "no row names a long pause");
  assert.ok(
    flat(html).includes("After a sentence ends, only a long pause of 5 s or more counts."),
    "the page's one definition of a long pause",
  );
});
