// Tests that the copy around the transcript follows the two 2026-10-11 decisions (PLAN.md T31
// and T32): mhm, uh-huh and mm-hmm are hesitations, highlighted like um and left out of pace,
// and a pause of 5 s or more counts and is marked wherever it falls, even after a period. The
// Results legend names mhm; how.html, frontend/README.md and DESIGN.md no longer say that only
// ums and uhs are hesitations or that a pause after a period never counts or is never marked;
// the 2026-10-10 plan says up front that both rules changed after it was written.
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

const LEGEND_BASE =
  "Highlighted words are hesitations: um, uh, mhm. Underlined words are verbal habits.";

// The owner's real 2026-10-11 church take as the API stores it ({text, start, end} in
// seconds), with the backend metrics of the same words (as in mhm.test.js). After "sad." the
// owner froze for 5.19 s, then said "Mhm.".
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

async function showChurchTake() {
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
  return body;
}

// A document's text with every run of spaces and line breaks read as one space, so a sentence
// matches however its source lines wrap.
function flat(text) {
  return text.replace(/\s+/g, " ");
}

// how.html as a reader sees it: no tags, no comments.
function howText() {
  return flat(read("how.html").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " "));
}

function wordCount(sentence) {
  return sentence.trim().split(" ").length;
}

test("on the church take the legend names mhm, and its Mhm is highlighted", async () => {
  const body = await showChurchTake();
  assert.equal(
    byClass(body, "transcript__legend").textContent,
    LEGEND_BASE +
      " Purple underlined words are restarts. Pink outlined pills are long pauses of 5 s or more.",
  );
  const spans = byClass(body, "transcript").children.filter((node) => node.tagName === "span");
  const mhm = spans.findIndex((span) => span.textContent === "Mhm.");
  assert.deepEqual(
    spans.slice(mhm - 2, mhm + 1).map((span) => [span.textContent, span.className]),
    [
      ["sad.", "tok"],
      ["5.2 s long pause", "tok--pause tok--pause-long num"],
      ["Mhm.", "tok tok--filler"],
    ],
    "the freeze after the period is marked, and the Mhm after it is a highlighted hesitation",
  );
  assert.equal(spans[mhm].getAttribute("aria-label"), "mhm, filler word");
});

test("how.html leaves every hesitation out of pace, not only ums and uhs", () => {
  const text = howText();
  assert.ok(text.includes("Pace is your words, minus hesitations, over your speaking time."));
  assert.ok(!text.includes("minus ums and uhs"));
});

test("how.html defines a counted pause by both rules, in sentences under 15 words", () => {
  const text = howText();
  const rules = [
    "A mid-sentence pause counts when it lasts 1.5 s or more.",
    "Mid-sentence means it does not follow a period, question mark or exclamation point.",
    "After a sentence ends, only a long pause of 5 s or more counts.",
  ];
  assert.ok(text.includes(rules.join(" ")), "the Pauses section opens with the two rules");
  rules.forEach((sentence) => assert.ok(wordCount(sentence) < 15, sentence));
  assert.ok(!text.includes("1.5 s or more and does not follow a period"));
});

test("how.html says the transcript marks the counted pauses, mid-sentence or long", () => {
  const text = howText();
  const sentence = "Your transcript marks only the pauses the card counts, mid-sentence or long.";
  assert.ok(text.includes(sentence));
  assert.ok(wordCount(sentence) < 15);
  assert.ok(!text.includes("marks only mid-sentence pauses"));
});

test("frontend/README.md quotes the new legend and walks through a marked freeze", () => {
  const readme = flat(read("README.md"));
  assert.ok(readme.includes('The legend reads "' + LEGEND_BASE + '"'));
  assert.ok(
    readme.includes(
      'Hesitations ("um", "uh", "er", "ah", "hm", and "mhm", "uh-huh", "mm-hmm") get an amber ' +
        "highlight.",
    ),
  );
  assert.ok(
    readme.includes(
      "A pause of 5 s or more is marked wherever it falls, even after a period, as an " +
        'outlined pink pill such as "6.0 s long pause". A shorter pause after a period is not ' +
        "marked, so the transcript, the Pauses stat and the speech map always show the same pauses.",
    ),
  );
  assert.ok(!readme.includes("A pause after a period is not marked"));
  assert.ok(!readme.includes("Ums and uhs ("));
  assert.ok(!readme.includes("or at a period is not counted"));
  assert.ok(
    readme.includes(
      '"You froze for 6.0 seconds at 0:04. Know how your next point opens." End a sentence, ' +
        "stay silent for 6 seconds, then keep talking.",
    ),
    "the freeze tip has its own step",
  );
});

test("DESIGN.md quotes the new legend and marks long pauses between sentences", () => {
  const design = flat(read("DESIGN.md"));
  assert.ok(design.includes('reads "' + LEGEND_BASE + '"'));
  assert.ok(!design.includes("ums and uhs"));
  assert.ok(!design.includes("Pauses between sentences are not marked"));
  assert.ok(
    design.includes(
      "for each pause `report.pauseCount` counts (every mid-sentence pause and every 5 s+ " +
        "pause, even after a full stop)",
    ),
  );
  assert.ok(design.includes("`.tok--pause-long`"));
  assert.ok(design.includes('text `6.0 s long pause`, `aria-label="long pause, 6.0 seconds"`'));
});

test("the 2026-10-10 plan says up front which of its rules T31 and T32 changed", () => {
  const plan = fs.readFileSync(
    path.join(REPO_DIR, "docs", "superpowers", "plans", "2026-10-10-next-level.md"),
    "utf8",
  );
  // The note is a blockquote: read its lines without their "> " markers.
  const head = flat(plan.slice(0, plan.indexOf("## Global Constraints")).replace(/^> ?/gm, ""));
  assert.ok(
    head.includes(
      "docs/PLAN.md T31 made mhm, uh-huh and mm-hmm count as hesitations, and T32 made a " +
        "pause of 5 s or more count anywhere, even after a period.",
    ),
  );
});
