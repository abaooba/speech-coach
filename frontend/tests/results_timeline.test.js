// Tests for the Results speech timeline (DESIGN.md section 6; queue feature T23). The pure
// timelineSegments(report) turns the app.delivery report into 0 to 1 positions measured from
// the first word, and show() draws them for a take with words: a heading, an SVG strip with
// the track, the clean-stretch band, mid-sentence pause blocks and filler ticks, an axis in
// recording time, a legend and a visually hidden list of every moment. Checked on the real
// clip and on the sample take that Practice offers.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const UI_SOURCE = read("ui.js");
const DELIVERY_SOURCE = read("delivery.js");
const RESULTS_SOURCE = read(path.join("screens", "results.js"));
const CSS = read("styles.css");
const SAMPLE = JSON.parse(read("sample-session.json"));

const SVG_NS = "http://www.w3.org/2000/svg";
const CLIP_WORDS = JSON.parse(
  fs.readFileSync(
    path.join(FRONTEND_DIR, "..", "backend", "tests", "fixtures", "test_clip_assemblyai.json"),
    "utf8",
  ),
).words;
const CLIP_METRICS = {
  words_per_minute: 93.2,
  duration: 30.908,
  word_count: 48,
  pauses: [
    [14.567, 1.531],
    [16.853, 2.474],
    [20.517, 2.185],
  ],
  fillers: { um: 6, uh: 3, hmm: 0, like: 1, "you know": 0, so: 2, basically: 1, actually: 0 },
  repeats: [{ text: "and I", at: 16.515 }],
  pace_windows: [],
};
const PASSAGES = [
  { id: "gettysburg-opening", targetWpm: [130, 150] },
  { id: "congress-speech", targetWpm: [130, 160], timeLimitSeconds: 180 },
];

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function loadPure() {
  const context = { app: { screens: {}, passages: PASSAGES, ui: {}, store: {}, router: {} } };
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  return context.app;
}

function segmentsFor(words, metrics) {
  const app = loadPure();
  return plain(app.screens.results.timelineSegments(app.delivery.analyze(words, metrics)));
}

// Words 0.3 s long with 0.1 s between them, as delivery.test.js builds them.
function timed(sentence) {
  return sentence.split(" ").map((text, index) => ({
    text,
    start: round3(index * 0.4),
    end: round3(index * 0.4 + 0.3),
  }));
}

test("results.js exports timelineSegments beside summarize", () => {
  assert.equal(typeof loadPure().screens.results.timelineSegments, "function");
});

test("the real clip: every filler, mid-sentence pause and the clean stretch, from 0 to 1", () => {
  const segments = segmentsFor(CLIP_WORDS, CLIP_METRICS);
  assert.equal(segments.start, 1.287);
  assert.equal(segments.seconds, 30.908);
  assert.deepEqual(
    segments.fillers.map((filler) => round3(filler.at)),
    [0.014, 0.037, 0.058, 0.12, 0.293, 0.479, 0.584, 0.599, 0.803, 0.872, 0.976],
  );
  assert.deepEqual(
    segments.fillers.map((filler) => filler.time),
    [1.723, 2.417, 3.079, 5, 10.352, 16.098, 19.327, 19.794, 26.112, 28.231, 31.451],
  );
  assert.deepEqual(
    segments.fillers.map((filler) => filler.text),
    ["so", "um", "basically", "um", "um", "um", "uh", "um", "uh", "um", "uh"],
  );
  assert.deepEqual(
    segments.fillers.map((filler) => filler.kind),
    ["habit", "hesitation", "habit", ...Array(8).fill("hesitation")],
  );
  assert.deepEqual(
    segments.pauses.map((pause) => [round3(pause.from), round3(pause.to)]),
    [
      [0.43, 0.479],
      [0.504, 0.584],
      [0.622, 0.693],
    ],
  );
  assert.deepEqual(
    segments.pauses.map((pause) => [pause.time, pause.seconds]),
    [
      [14.567, 1.531],
      [16.853, 2.474],
      [20.517, 2.185],
    ],
  );
  const clean = segments.cleanStretch;
  assert.deepEqual(
    [round3(clean.from), round3(clean.to), clean.time, clean.endTime, clean.seconds],
    [0.134, 0.293, 5.436, 10.352, 4.9],
  );
});

test("the sample take: five fillers, no pauses, a clean stretch from the first word", () => {
  const segments = segmentsFor(SAMPLE.transcript, SAMPLE.metrics);
  assert.equal(segments.start, 1.794);
  assert.equal(segments.seconds, 28.701);
  assert.deepEqual(
    segments.fillers.map((filler) => round3(filler.at)),
    [0.48, 0.508, 0.533, 0.759, 0.882],
  );
  assert.deepEqual(
    segments.fillers.map((filler) => filler.text),
    ["um", "like", "you know", "uh", "uh"],
  );
  assert.deepEqual(segments.pauses, []);
  const clean = segments.cleanStretch;
  assert.deepEqual(
    [round3(clean.from), round3(clean.to), clean.time, clean.endTime, clean.seconds],
    [0, 0.48, 1.794, 15.559, 13.8],
  );
});

test("no timeline without words, without a first word time or without speaking time", () => {
  const app = loadPure();
  const { timelineSegments } = app.screens.results;
  assert.equal(timelineSegments(app.delivery.analyze([], CLIP_METRICS)), null);
  const instant = app.delivery.analyze([{ text: "hi", start: 2, end: 2 }], {});
  assert.equal(timelineSegments(instant), null, "no speaking time");
  assert.equal(timelineSegments(null), null);
  assert.equal(timelineSegments(undefined), null);
  assert.equal(timelineSegments({}), null);
  assert.equal(timelineSegments({ speechStart: "1", speakingSeconds: 10 }), null);
});

test("only mid-sentence pauses are drawn, and a mark past the last word stops at 1", () => {
  const words = timed("We win. The plan works today.");
  const afterPeriod = [words[1].end, 2];
  const midSentence = [words[3].end, 100];
  const segments = segmentsFor(words, { pauses: [afterPeriod, midSentence], repeats: [] });
  assert.equal(segments.pauses.length, 1);
  assert.equal(segments.pauses[0].time, words[3].end);
  assert.equal(segments.pauses[0].to, 1, "clamped to the last word");
});

test("a take with no clean speech has no clean-stretch band", () => {
  const segments = segmentsFor([{ text: "um", start: 1, end: 1.4 }], { pauses: [], repeats: [] });
  assert.equal(segments.cleanStretch, null);
  assert.equal(segments.fillers.length, 1);
});

test("timelineSegments does not change the report it reads", () => {
  const app = loadPure();
  const report = app.delivery.analyze(CLIP_WORDS, CLIP_METRICS);
  const before = JSON.stringify(report);
  app.screens.results.timelineSegments(report);
  assert.equal(JSON.stringify(report), before);
});

// The DOM half: show() against the fake document.
async function showSession(session) {
  const context = {
    app: {
      screens: {},
      passages: PASSAGES.map((entry) => ({ ...entry })),
      store: { get: () => Promise.resolve(session) },
      router: { go() {} },
    },
    document: fakeDocument(),
  };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(DELIVERY_SOURCE, context, { filename: "delivery.js" });
  vm.runInNewContext(RESULTS_SOURCE, context, { filename: "results.js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  context.app.screens.results.mount(root);
  await context.app.screens.results.show({ id: session.id });
  return body;
}

const CLIP_SESSION = {
  id: "clip",
  createdAt: "2026-10-10T15:30:00Z",
  passageId: "gettysburg-opening",
  passageTitle: "Gettysburg Address, opening",
  durationSeconds: 33.1,
  metrics: CLIP_METRICS,
  transcript: CLIP_WORDS,
};
const SAMPLE_SESSION = { ...SAMPLE, id: "sample", createdAt: "2026-10-10T17:30:00Z" };

function outline(node) {
  if (node.nodeType === 3) {
    return "#text";
  }
  const className = node.className || node.getAttribute("class") || "";
  return node.tagName + "." + className;
}

function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

function number(node, name) {
  return Number(node.getAttribute(name));
}

test("the timeline sits between the cards and the transcript, as one section", async () => {
  const body = await showSession(CLIP_SESSION);
  const names = body.children.map(outline);
  const grid = names.indexOf("div.metric-grid");
  assert.equal(names[grid + 1], "section.timeline");
  assert.equal(names[grid + 2], "h2.results__heading");
  assert.equal(body.children[grid + 2].textContent, "Transcript");
  const timeline = byClass(body, "timeline");
  assert.deepEqual(timeline.children.map(outline), [
    "h2.results__heading",
    "svg.timeline__strip",
    "div.timeline__axis",
    "p.timeline__legend",
    "ul.sr-only timeline__moments",
  ]);
  assert.equal(timeline.children[0].textContent, "Speech timeline");
});

test("a take without words has no timeline", async () => {
  const body = await showSession({ ...CLIP_SESSION, transcript: [] });
  assert.equal(byClass(body, "timeline"), undefined);
});

test("the strip is a labelled image that stretches to the column", async () => {
  const timeline = byClass(await showSession(CLIP_SESSION), "timeline");
  const strip = timeline.children[1];
  assert.equal(strip.tagName, "svg");
  assert.equal(strip.namespaceURI, SVG_NS);
  assert.equal(strip.getAttribute("role"), "img");
  assert.equal(strip.getAttribute("viewBox"), "0 0 320 40");
  assert.equal(strip.getAttribute("preserveAspectRatio"), "none");
  assert.equal(
    strip.getAttribute("aria-label"),
    "Speech timeline from 0:01 to 0:32: 11 fillers, 3 mid-sentence pauses, 1 restart, " +
      "a 4.9 second clean stretch",
  );
});

test("the strip draws the track, the band and its edge, the pauses, the fillers", async () => {
  const strip = byClass(await showSession(CLIP_SESSION), "timeline").children[1];
  assert.deepEqual(
    strip.children.map((mark) => mark.tagName + "." + mark.getAttribute("class")),
    [
      "rect.timeline__track",
      "rect.timeline__clean",
      "rect.timeline__clean-edge",
      ...Array(3).fill("rect.timeline__pause"),
      "rect.timeline__restart",
      ...Array(11).fill("rect.timeline__filler"),
    ],
  );
  strip.children.forEach((mark) => assert.equal(mark.namespaceURI, SVG_NS));
  const color = (name) => strip.children.find((mark) => mark.getAttribute("class") === name);
  const track = color("timeline__track");
  assert.equal(track.getAttribute("fill"), "var(--surface)");
  assert.equal(track.getAttribute("stroke"), "var(--border)");
  assert.equal(color("timeline__clean").getAttribute("fill"), "var(--ok-bg)");
  assert.equal(color("timeline__clean-edge").getAttribute("fill"), "var(--ok)");
  assert.equal(color("timeline__pause").getAttribute("fill"), "var(--pause)");
  assert.equal(color("timeline__filler").getAttribute("fill"), "var(--filler)");
  strip.children.forEach((mark) => {
    for (const name of ["fill", "stroke"]) {
      const value = mark.getAttribute(name);
      assert.ok(value === null || /^var\(--[a-z-]+\)$/.test(value), `${name}=${value}`);
    }
  });
});

test("marks sit at their positions across the 320-unit strip", async () => {
  const strip = byClass(await showSession(CLIP_SESSION), "timeline").children[1];
  const marks = (name) => strip.children.filter((mark) => mark.getAttribute("class") === name);
  const [track] = marks("timeline__track");
  const [band] = marks("timeline__clean");
  const [edge] = marks("timeline__clean-edge");
  const at = (x) => Math.round((x / 320) * 1000) / 1000;

  assert.deepEqual(
    marks("timeline__filler").map((tick) => at(number(tick, "x") + 1)),
    [0.014, 0.037, 0.058, 0.12, 0.293, 0.479, 0.584, 0.599, 0.803, 0.872, 0.976],
  );
  marks("timeline__filler").forEach((tick) => {
    assert.equal(number(tick, "width"), 2);
    assert.ok(number(tick, "y") < number(track, "y"), "a tick starts above the track");
    assert.ok(
      number(tick, "y") + number(tick, "height") > number(track, "y") + number(track, "height"),
      "and ends below it",
    );
  });
  assert.deepEqual(
    marks("timeline__pause").map((block) => [
      at(number(block, "x")),
      at(number(block, "x") + number(block, "width")),
    ]),
    [
      [0.43, 0.479],
      [0.504, 0.584],
      [0.622, 0.693],
    ],
  );
  assert.deepEqual(
    [at(number(band, "x")), at(number(band, "x") + number(band, "width"))],
    [0.134, 0.293],
  );
  assert.equal(number(edge, "height"), 3, "a 3-unit base line");
  assert.equal(number(edge, "x"), number(band, "x"));
  assert.equal(number(edge, "width"), number(band, "width"));
  assert.equal(
    number(edge, "y") + number(edge, "height"),
    number(band, "y") + number(band, "height"),
    "the line runs along the band's bottom",
  );
});

test("the axis reads the first word, midpoint and last word in recording time", async () => {
  const axis = byClass(byClass(await showSession(CLIP_SESSION), "timeline"), "timeline__axis");
  assert.equal(axis.getAttribute("aria-hidden"), "true", "the strip's label already says it");
  assert.deepEqual(
    axis.children.map((label) => label.textContent),
    ["0:01", "0:16", "0:32"],
  );
});

test("the legend pairs a swatch with each mark's name", async () => {
  const legend = byClass(byClass(await showSession(CLIP_SESSION), "timeline"), "timeline__legend");
  assert.deepEqual(legend.children.map(fullText), [
    "Filler",
    "Mid-sentence pause",
    "Restart",
    "Clean stretch",
  ]);
  assert.deepEqual(
    legend.children.map((key) => [key.className, key.children[0].className]),
    [
      ["timeline__key", "timeline__swatch timeline__swatch--filler"],
      ["timeline__key", "timeline__swatch timeline__swatch--pause"],
      ["timeline__key", "timeline__swatch timeline__swatch--restart"],
      ["timeline__key", "timeline__swatch timeline__swatch--clean"],
    ],
  );
  legend.children.forEach((key) => {
    assert.equal(key.children[0].getAttribute("aria-hidden"), "true");
  });
});

test("the hidden list names every moment in time order", async () => {
  const timeline = byClass(await showSession(CLIP_SESSION), "timeline");
  const list = byClass(timeline, "timeline__moments");
  assert.equal(list.tagName, "ul");
  assert.deepEqual(list.children.map((item) => [item.tagName, item.textContent]).map(String), [
    "li,Filler “so” at 0:01",
    "li,Filler “um” at 0:02",
    "li,Filler “basically” at 0:03",
    "li,Filler “um” at 0:05",
    "li,Clean stretch from 0:05 to 0:10, 4.9 seconds",
    "li,Filler “um” at 0:10",
    "li,Mid-sentence pause at 0:14, 1.5 seconds",
    "li,Filler “um” at 0:16",
    "li,Restart “and I” at 0:16",
    "li,Mid-sentence pause at 0:16, 2.5 seconds",
    "li,Filler “uh” at 0:19",
    "li,Filler “um” at 0:19",
    "li,Mid-sentence pause at 0:20, 2.2 seconds",
    "li,Filler “uh” at 0:26",
    "li,Filler “um” at 0:28",
    "li,Filler “uh” at 0:31",
  ]);
});

test("the sample take's timeline: label, marks and moments", async () => {
  const timeline = byClass(await showSession(SAMPLE_SESSION), "timeline");
  const strip = timeline.children[1];
  assert.equal(
    strip.getAttribute("aria-label"),
    "Speech timeline from 0:01 to 0:30: 5 fillers, no mid-sentence pauses, " +
      "a 13.8 second clean stretch",
  );
  assert.deepEqual(
    strip.children.map((mark) => mark.getAttribute("class")),
    [
      "timeline__track",
      "timeline__clean",
      "timeline__clean-edge",
      ...Array(5).fill("timeline__filler"),
    ],
  );
  assert.deepEqual(
    byClass(timeline, "timeline__axis").children.map((label) => label.textContent),
    ["0:01", "0:16", "0:30"],
  );
  assert.deepEqual(
    byClass(timeline, "timeline__moments").children.map((item) => item.textContent),
    [
      "Clean stretch from 0:01 to 0:15, 13.8 seconds",
      "Filler “um” at 0:15",
      "Filler “like” at 0:16",
      "Filler “you know” at 0:17",
      "Filler “uh” at 0:23",
      "Filler “uh” at 0:27",
    ],
  );
});

// Back-to-back words, each `seconds` long; "um" at the indexes in `umAt`.
function steady(count, seconds, umAt = []) {
  return {
    id: "steady",
    createdAt: "2026-10-10T18:00:00Z",
    passageId: "gettysburg-opening",
    passageTitle: "Gettysburg Address, opening",
    durationSeconds: count * seconds,
    metrics: { pauses: [], repeats: [], fillers: {}, pace_windows: [] },
    transcript: Array.from({ length: count }, (_, index) => ({
      text: umAt.includes(index) ? "um" : "word",
      start: index * seconds,
      end: (index + 1) * seconds,
    })),
  };
}

test("the label counts in words and picks a or an for the clean stretch", async () => {
  // An SVG class is set with setAttribute, which the fake classList cannot see.
  const label = async (session) =>
    byClass(await showSession(session), "timeline").children.find(
      (node) => node.getAttribute("class") === "timeline__strip",
    );
  const one = await label(steady(16, 0.5, [15]));
  assert.equal(
    one.getAttribute("aria-label"),
    "Speech timeline from 0:00 to 0:08: 1 filler, no mid-sentence pauses, " +
      "a 7.5 second clean stretch",
  );
  const eight = await label(steady(16, 0.5));
  assert.match(eight.getAttribute("aria-label"), /: no fillers, .* an 8 second clean stretch$/);
  const eleven = await label(steady(22, 0.5));
  assert.match(eleven.getAttribute("aria-label"), /an 11 second clean stretch$/);
  const umOnly = await label(steady(1, 0.4, [0]));
  assert.match(
    umOnly.getAttribute("aria-label"),
    /: 1 filler, no mid-sentence pauses, no clean stretch$/,
  );
});

function rule(selector) {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations = {};
  let found = false;
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((part) => part.replace(/\s+/g, " ").trim());
    if (selectors.includes(selector)) {
      found = true;
      match[2].split(";").forEach((part) => {
        const colon = part.indexOf(":");
        if (colon !== -1) {
          declarations[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
        }
      });
    }
  }
  assert.ok(found, `styles.css needs a rule for ${selector}`);
  return declarations;
}

test("the strip fills the column at 40px; axis and legend are micro and muted", () => {
  const strip = rule(".timeline__strip");
  assert.equal(strip.display, "block");
  assert.equal(strip.width, "100%");
  assert.equal(strip.height, "40px");
  const axis = rule(".timeline__axis");
  assert.equal(axis.display, "flex");
  assert.equal(axis["justify-content"], "space-between");
  assert.equal(axis["font-size"], "var(--fs-micro)");
  assert.equal(axis.color, "var(--muted)");
  assert.equal(axis["font-variant-numeric"], "tabular-nums");
  assert.equal(rule(".timeline__legend")["font-size"], "var(--fs-micro)");
  assert.equal(rule(".timeline__swatch--filler").background, "var(--filler)");
  assert.equal(rule(".timeline__swatch--pause").background, "var(--pause)");
  assert.equal(rule(".timeline__swatch--clean").background, "var(--ok-bg)");
  assert.equal(rule(".timeline__swatch--clean")["border-bottom"], "3px solid var(--ok)");
});
