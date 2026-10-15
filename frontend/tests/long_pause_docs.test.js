// Tests that the docs describe the long pause the Results speech map draws (docs/PLAN.md T32: a
// pause of 5 s or more counts and is marked wherever it falls), as the transcript copy already
// does (mhm_long_pause_copy.test.js). frontend/README.md's speech map step and DESIGN.md's
// Speech map paragraph and fixed copy quote the row's label, the list's count and the detail
// the map shows on the real church take, read from the screen rather than written out here.
// how.html keeps "long pause" for 5 s or more: the tip for a mid-sentence pause past 3 seconds
// is named for what it is.
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
async function churchMap() {
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
  const stage = byClass(byClass(body, "speech-map"), "speech-map__stage");
  const list = byClass(byClass(stage, "speech-map__body"), "speech-map__moments");
  return {
    kinds: list.children.map((row) => row.className.replace("moment moment--", "")),
    label: list.getAttribute("aria-label"),
    rows: list.children.map((row) => {
      const [head, context] = row.children[0].children;
      return {
        time: head.children[0].textContent,
        kind: head.children[1].textContent,
        context: fullText(context),
      };
    }),
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

// A long pause's kind as its card reads it: "Long pause · 5.2 s".
const LONG_KIND = /^Long pause · \d+\.\d s$/;

// The church take's long-pause card, which the docs quote: the example is read from the screen.
function longRow(map) {
  const row = map.rows.find((entry) => LONG_KIND.test(entry.kind));
  assert.ok(row, "the church map has a long-pause card");
  return row;
}

test("on the church take the map draws its freeze as a named, timed long-pause row", async () => {
  const map = await churchMap();
  assert.deepEqual(
    map.kinds.filter((kind) => /pause/.test(kind)),
    ["long-pause"],
    "the 5.19 s freeze after a period is the one pause drawn, as a long pause",
  );
  assert.match(map.label, /, no mid-sentence pauses, 1 long pause, /);
  assert.deepEqual(longRow(map), {
    time: "0:34",
    kind: "Long pause · 5.2 s",
    context: "…sad. 5.2 s Mhm. I…",
  });
});

test("frontend/README.md's speech map step shows the long pause the map draws", async () => {
  const map = await churchMap();
  const step = readmeStep("4. Speech map:");
  assert.ok(
    step.includes(
      "a pink block as long as the pause for each pause of 5 s or more, even after a period",
    ),
    "the map's long-pause block",
  );
  assert.ok(step.includes('"1 long pause"'), "the label's count");
  const row = longRow(map);
  assert.ok(
    step.includes('its card reads "' + row.kind + '" over "' + row.context + '"'),
    "the step quotes the church take's own long-pause card: " + row.kind,
  );
});

test("DESIGN.md's Speech map paragraph draws, names and details the long pause", async () => {
  const map = await churchMap();
  const paragraph = designParagraph("Speech map");
  assert.ok(paragraph.includes("`.moment--long-pause`"));
  assert.ok(paragraph.includes("`--pause-long`"));
  assert.ok(paragraph.includes("as long as the pause"));
  assert.ok(paragraph.includes('adds "1 long pause" after the mid-sentence count'));
  const row = longRow(map);
  assert.ok(
    paragraph.includes('"' + row.kind + '"') && paragraph.includes('"' + row.context + '"'),
    "the paragraph quotes the church take's own long-pause card: " + row.kind,
  );
});

test("DESIGN.md's fixed copy lists the long-pause row with the map's kinds", () => {
  const results = read("DESIGN.md")
    .split("\n")
    .find((line) => line.startsWith('- Results: "Arrows compare with your last take."'));
  assert.ok(results, "DESIGN.md section 8 has the Results copy line");
  assert.ok(
    results.includes(
      '"Speech map"; "First word", "Last word"; card kinds "Filler" ("3 fillers"), ' +
        '"Mid-sentence pause · 1.5 s", "Long pause · 5.2 s", "Restart", ' +
        '"Clean stretch · 26.5 s";',
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
