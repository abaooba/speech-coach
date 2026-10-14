// The Path screen's test harness, shared by path_screen.test.js and
// path_screen_states.test.js. It loads ui.js, passages.js, delivery.js, path.js, loop.js and
// screens/path.js into one vm context, in index.html's order, with the shared fake DOM, a fake
// store and router, and a clock fixed at a known local time, so the screen's "today" is the same
// in every run and every time zone. Elements it makes also record focus() calls, which
// fake-dom.js does not have. The take and record builders date everything in local time.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const FILES = [
  "ui.js",
  "passages.js",
  "delivery.js",
  "path.js",
  "loop.js",
  path.join("screens", "path.js"),
];
const SOURCES = FILES.map((file) => ({
  file,
  source: fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8"),
}));

// Wednesday 14 October 2026 at 10:00 local time: the screen's today unless a test sets another
// clock, as [year, monthIndex, date, hour, minute].
const WEDNESDAY = [2026, 9, 14, 10, 0];
const TODAY = "2026-10-14";

// A Date whose "now" is `now`; a Date made from arguments is an ordinary one.
function fixedClock(now) {
  return class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length === 0 ? now : args));
    }

    static now() {
      return new Date(...now).getTime();
    }
  };
}

// The shared fake document, except that every element it makes records its focus() calls in
// focusLog, in order.
function focusRecordingDocument(focusLog, byId) {
  class FocusableElement extends FakeElement {
    focus() {
      focusLog.push(this);
    }
  }
  return {
    ...fakeDocument(byId),
    createElement: (tagName) => new FocusableElement(tagName),
    createElementNS: (namespaceURI, tagName) => new FocusableElement(tagName, namespaceURI),
  };
}

// Mounts the Path screen on a section built as index.html will build it: <h1>Path</h1>, then
// div.screen__body. The store lists `sessions` (the takes) and `cleared` (the cleared records),
// both changeable between shows through `store`. `store.fail` set to "list" or "cleared" makes
// that call reject; `store.hold` set to true keeps both calls waiting until store.release().
// The router records every go() as {name, id}.
function mountPath(options = {}) {
  const focusLog = [];
  const live = new FakeElement("div");
  const document = focusRecordingDocument(focusLog, { live });
  const routes = [];
  const waiting = [];
  const store = {
    sessions: options.sessions || [],
    cleared: options.cleared || [],
    fail: options.fail || null,
    hold: false,
    calls: 0,
    list() {
      store.calls += 1;
      return answer("list", () => [...store.sessions]);
    },
    listClearedLevels() {
      return answer("cleared", () => [...store.cleared]);
    },
    release() {
      waiting.splice(0).forEach((resolve) => resolve());
    },
  };

  function answer(call, value) {
    const settle = () =>
      store.fail === call
        ? Promise.reject(new Error("Close other Speech Coach tabs to finish updating."))
        : Promise.resolve(value());
    if (!store.hold) {
      return settle();
    }
    return new Promise((resolve) => waiting.push(resolve)).then(settle);
  }

  const app = {
    screens: {},
    store,
    router: {
      go: (name, params) => routes.push({ name, id: params ? params.id : undefined }),
    },
  };
  const context = { app, document, Date: fixedClock(options.now || WEDNESDAY) };
  SOURCES.forEach(({ file, source }) => vm.runInNewContext(source, context, { filename: file }));

  const root = new FakeElement("section");
  root.setAttribute("id", "screen-path");
  const heading = new FakeElement("h1");
  heading.textContent = "Path";
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(heading);
  root.appendChild(body);
  const screen = app.screens.path;
  screen.mount(root);
  return { app, screen, root, heading, body, store, routes, focusLog, live };
}

// Lets a click handler's promise chain run to the end.
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

// --- Takes and records --------------------------------------------------------------------

// An ISO time at `hour`:`minute` local time on a local calendar day ("2026-10-14").
function at(day, hour = 10, minute = 0) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, hour, minute).toISOString();
}

// A cleared record as app.store.listClearedLevels() lists one.
function record(levelId, day, hour = 10) {
  return { levelId, clearedAt: at(day, hour) };
}

// `count` words, one every half second from 1 s, each 0.4 s long; `say` swaps in other text by
// index ({3: "um"}).
function words(count, say = {}) {
  return Array.from({ length: count }, (_, index) => ({
    text: say[index] || "word" + index,
    start: 1 + index * 0.5,
    end: 1 + index * 0.5 + 0.4,
  }));
}

let takeCount = 0;

// A saved take: a Path take when `pathFields` is given ({play, kind, take, scored, passed,
// stage, inRoom}), a plain one otherwise.
function take({
  day,
  hour = 10,
  minute = 0,
  passageId = "impromptu",
  passageTitle = "Impromptu",
  transcript,
  metrics,
  pathFields,
}) {
  takeCount += 1;
  const saved = {
    id: "take-" + takeCount,
    createdAt: at(day, hour, minute),
    passageId,
    passageTitle,
    durationSeconds: 60,
    metrics: metrics || { pauses: [], repeats: [] },
    transcript: transcript || words(40),
  };
  if (pathFields) {
    saved.path = Object.assign(
      { take: 2, scored: true, passed: false, stage: null, inRoom: null },
      pathFields,
    );
  }
  return saved;
}

// A missed scored take `takeNumber` of the loop `levelId` on `day`.
function miss(levelId, day, takeNumber, hour = 9) {
  return take({
    day,
    hour,
    minute: takeNumber,
    pathFields: { play: levelId, kind: "loop", take: takeNumber, scored: true, passed: false },
  });
}

// One benchmark sitting on `day`: the read, its restarts at the word indexes `restartsAt`, and
// the 90 s talk with an "um" at each index of `umsAt`.
function sitting(day, { restartsAt = [], umsAt = [] } = {}) {
  const transcript = words(120);
  const restarts = restartsAt.map((index) => ({
    text: transcript[index].text + " " + transcript[index + 1].text,
    at: transcript[index].start,
  }));
  const read = take({
    day,
    hour: 9,
    passageId: "benchmark-read",
    passageTitle: "Benchmark read",
    transcript,
    metrics: { pauses: [], repeats: restarts, script: { restarts, skipped: [], misread: [] } },
    pathFields: { play: "benchmark", kind: "benchmark", take: 1, scored: false, passed: null },
  });
  const talk = take({
    day,
    hour: 9,
    minute: 5,
    passageId: "benchmark-talk",
    passageTitle: "Benchmark talk",
    transcript: words(120, Object.fromEntries(umsAt.map((index) => [index, "um"]))),
    pathFields: { play: "benchmark", kind: "benchmark", take: 2, scored: false, passed: null },
  });
  return [read, talk];
}

// --- Reading the drawn tree ---------------------------------------------------------------

// The class of an element: an SVG element keeps it in the attribute, since its className is
// read-only in browsers.
function classOf(node) {
  return node.className || (node.getAttribute ? node.getAttribute("class") : null) || "";
}

function hasClass(node, name) {
  return classOf(node).split(/\s+/).includes(name);
}

// Every element under `node`, itself first, in document order, that `matches`.
function all(node, matches, found = []) {
  if (!node || !node.children) {
    return found;
  }
  if (matches(node)) {
    found.push(node);
  }
  node.children.forEach((child) => all(child, matches, found));
  return found;
}

function findAll(node, name) {
  return all(node, (element) => hasClass(element, name));
}

function find(node, name) {
  return findAll(node, name)[0] || null;
}

// What the eye reads: text outside .sr-only and outside closed (hidden) cards. aria-hidden text
// still shows.
function visible(node) {
  if (!node.children) {
    return node.textContent || "";
  }
  if (node.hidden === true || hasClass(node, "sr-only")) {
    return "";
  }
  return (node.textContent || "") + node.children.map(visible).join("");
}

// What a screen reader hears from a part with no aria-label: its text, .sr-only included,
// aria-hidden and closed parts left out.
function spoken(node) {
  if (!node.children) {
    return node.textContent || "";
  }
  if (node.hidden === true || node.getAttribute("aria-hidden") === "true") {
    return "";
  }
  return (node.textContent || "") + node.children.map(spoken).join("");
}

// Every word the screen holds, shown or not: text, closed cards and .sr-only included, and every
// aria-label, one per line.
function everything(node) {
  if (!node.children) {
    return node.textContent || "";
  }
  const label = node.getAttribute("aria-label");
  const own = [node.textContent || "", label || ""].filter(Boolean).join("\n");
  return [own, ...node.children.map(everything)].filter(Boolean).join("\n");
}

// The data-icon names of the icons drawn under `node`, in order.
function iconsOf(node) {
  return all(node, (element) => element.getAttribute("data-icon") !== null).map((svg) =>
    svg.getAttribute("data-icon"),
  );
}

function unitsOf(body) {
  return findAll(body, "path-unit");
}

function titleOf(unit) {
  return visible(find(unit, "path-unit__title"));
}

function unitTitled(body, title) {
  const unit = unitsOf(body).find((entry) => titleOf(entry) === title);
  if (!unit) {
    throw new Error("no unit titled " + title);
  }
  return unit;
}

// The node buttons of a unit in document order: levels 1 to 3, the crown when the unit has one,
// levels 4 and 5, then the checkpoint.
function nodesOf(unit) {
  return findAll(unit, "path-node");
}

function levelNodes(unit) {
  return nodesOf(unit).filter((node) => hasClass(node, "path-node--level"));
}

function crownNode(unit) {
  return nodesOf(unit).find((node) => hasClass(node, "path-node--crown")) || null;
}

function checkpointNode(unit) {
  return nodesOf(unit).find((node) => hasClass(node, "path-node--checkpoint")) || null;
}

// The card a node opens: the element its aria-controls names.
function cardOf(body, node) {
  const id = node.getAttribute("aria-controls");
  const cards = all(body, (element) => element.getAttribute("id") === id);
  if (cards.length !== 1) {
    throw new Error("expected one card with id " + id + ", found " + cards.length);
  }
  return cards[0];
}

// The paragraphs of a card, as the eye reads them.
function cardLines(card) {
  return findAll(card, "path-card__text").map(visible);
}

const STATES = ["cleared", "current", "locked", "resting", "open", "earned"];

// The one state modifier a node carries.
function stateOf(node) {
  const states = STATES.filter((state) => hasClass(node, "path-node--" + state));
  if (states.length !== 1) {
    throw new Error("expected one state on " + classOf(node) + ", found " + states.length);
  }
  return states[0];
}

// Fires `key` at the element's keydown listeners, as a key press that lands on it or bubbles
// up to it would.
function press(element, key) {
  (element.listeners.keydown || []).forEach((handler) =>
    handler({ type: "keydown", key, target: element, preventDefault() {} }),
  );
}

module.exports = {
  TODAY,
  WEDNESDAY,
  mountPath,
  settle,
  at,
  record,
  words,
  take,
  miss,
  sitting,
  classOf,
  hasClass,
  all,
  findAll,
  find,
  visible,
  spoken,
  everything,
  iconsOf,
  unitsOf,
  titleOf,
  unitTitled,
  nodesOf,
  levelNodes,
  crownNode,
  checkpointNode,
  cardOf,
  cardLines,
  stateOf,
  press,
};
