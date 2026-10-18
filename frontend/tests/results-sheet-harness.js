// The Results-with-a-sheet mount shared by the guided-coach final-review tests (taken from
// results_sheet.test.js): ui.js, sheet.js, passages.js, delivery.js, path.js, coach.js,
// nextmove.js, language.js, tips.js, results.js and coachcard.js run for real in a vm; the store,
// the api, the router and the document are fakes. mount(sessions, {advice, cleared}) answers
// POST /api/advice with `advice()`.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, FakeTextNode } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
const SOURCES = [
  "ui.js",
  "sheet.js",
  "passages.js",
  "delivery.js",
  "path.js",
  "coach.js",
  "nextmove.js",
  "language.js",
  "tips.js",
  path.join("screens", "results.js"),
  path.join("screens", "coachcard.js"),
].map((file) => [file, read(file)]);

class Node extends FakeElement {
  constructor(tagName, ns, doc) {
    super(tagName, ns);
    this.doc = doc;
    this.inert = false;
  }

  focus() {
    this.doc.activeElement = this;
  }

  scrollIntoView(options) {
    this.doc.scrolls.push([this, options]);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  contains(node) {
    return (
      node === this ||
      this.children.some((child) => typeof child.contains === "function" && child.contains(node))
    );
  }

  get offsetWidth() {
    return 1;
  }
}

function findById(node, id) {
  if (node.getAttribute && node.getAttribute("id") === id) {
    return node;
  }
  for (const child of node.children || []) {
    const found = findById(child, id);
    if (found) {
      return found;
    }
  }
  return null;
}

function find(node, className) {
  if (node.classList && node.classList.contains(className)) {
    return node;
  }
  for (const child of node.children || []) {
    const hit = find(child, className);
    if (hit) {
      return hit;
    }
  }
  return null;
}

function text(node) {
  return (node.textContent || "") + (node.children || []).map(text).join("");
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  const promise = new Promise((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

// The "Your day" take of results_coach_card.test.js: a restart "the few— the few" at 0:10, a
// 5.6 s pause after "and" at 0:24 and three fillers.
const TEXT =
  "So this morning I woke up early and, um, I went to the market near my house. I wanted to " +
  "buy the few— the few things for dinner. The seller was very friendly and we talked about " +
  "the weather. Um, after that I take the bus to work, and | the traffic was really bad today. " +
  "Like, it took me almost forty minutes. But I listened a podcast about cooking, so it was okay.";

function yourDay(id, overrides) {
  let time = 0;
  const words = [];
  TEXT.split(" ").forEach((token) => {
    if (token === "|") {
      time += 5.4;
      return;
    }
    words.push({ text: token, start: round(time), end: round(time + 0.35) });
    time += 0.5;
  });
  const and = words.findIndex((word, i) => word.text === "and" && words[i + 1].text === "the");
  const first = words.find((word, i) => word.text === "the" && words[i + 1].text === "few—");
  return {
    id,
    createdAt: "2026-10-17T09:12:00.000Z",
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 42,
    metrics: {
      pauses: [[words[and].end, round(words[and + 1].start - words[and].end)]],
      repeats: [{ at: first.start, text: "the few" }],
      fillers: {},
      pace_windows: [],
    },
    transcript: words,
    ...(overrides || {}),
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

const AI_HEADLINE =
  "You restarted “the few— the few” at 0:10. Pause before a sentence instead of starting twice.";
const REPLY = {
  headline: { text: AI_HEADLINE, moment_id: "restart-1" },
  tips: [
    {
      entry_id: "restart-004",
      text: "At 0:10 you said “the few— the few”. Pause silently before the phrase.",
      drill: "",
      citation: { label: "Clark & Wasow (1998)", url: "https://example.org/cw", type: "coach" },
      moment_ids: ["restart-1"],
    },
  ],
  source: "ai",
};
const LANGUAGE_RESULT = {
  status: "ok",
  fixes: [],
  words: [],
  rewrites: [],
  praise: "Clear and natural.",
};

// Mounts Results inside document.body, as index.html's main holds it. `advice` answers POST
// /api/advice; the language check answers LANGUAGE_RESULT.
function mount(sessions, options) {
  const settings = options || {};
  const doc = { activeElement: null, keyListeners: [], scrolls: [] };
  doc.createElement = (tag) => new Node(tag, null, doc);
  doc.createElementNS = (ns, tag) => new Node(tag, ns, doc);
  doc.createTextNode = (value) => new FakeTextNode(value);
  doc.addEventListener = (type, fn) => type === "keydown" && doc.keyListeners.push(fn);
  doc.removeEventListener = (type, fn) => {
    doc.keyListeners = doc.keyListeners.filter((other) => other !== fn);
  };
  doc.body = new Node("body", null, doc);
  doc.live = new Node("div", null, doc);
  doc.live.setAttribute("id", "live");
  doc.getElementById = (id) => (id === "live" ? doc.live : findById(doc.body, id));
  const routeListeners = [];
  const calls = { advice: [], language: [], go: [], cleared: 0 };
  const flags = new Map();
  const byId = Object.fromEntries(sessions.map((session) => [session.id, session]));
  const newestFirst = [...sessions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const context = {
    app: {
      screens: {},
      store: {
        get: (id) => Promise.resolve(byId[id]),
        list: () => Promise.resolve([...newestFirst]),
        listClearedLevels: () => {
          calls.cleared += 1;
          return Promise.resolve(settings.cleared || []);
        },
        getFlag: (key) => Promise.resolve(flags.get(key)),
        setFlag: (key, value) => {
          flags.set(key, value);
          return Promise.resolve();
        },
      },
      api: {
        postJson: (url, body) => {
          if (url === "/api/advice") {
            calls.advice.push(body);
            return settings.advice ? settings.advice() : Promise.resolve({ status: 0, body: null });
          }
          calls.language.push(body);
          return Promise.resolve({ status: 200, body: LANGUAGE_RESULT });
        },
      },
      router: {
        go(name, params) {
          calls.go.push({ name, params: params ? { ...params } : params });
        },
      },
    },
    document: doc,
    setTimeout,
    addEventListener: (type, fn) => type === "hashchange" && routeListeners.push(fn),
    removeEventListener: (type, fn) => {
      const at = routeListeners.indexOf(fn);
      if (at !== -1) {
        routeListeners.splice(at, 1);
      }
    },
  };
  SOURCES.forEach(([file, source]) => vm.runInNewContext(source, context, { filename: file }));
  const main = new Node("main", null, doc);
  const root = new Node("section", null, doc);
  const body = new Node("div", null, doc);
  body.className = "screen__body";
  root.appendChild(body);
  main.appendChild(root);
  doc.body.appendChild(main);
  doc.body.appendChild(doc.live);
  const results = context.app.screens.results;
  results.mount(root);
  return { results, body, doc, main, calls, app: context.app, flags, routeListeners };
}

function sheetOf(doc) {
  return doc.body.children.find((node) => node.classList.contains("sheet")) || null;
}

module.exports = {
  mount,
  sheetOf,
  find,
  text,
  flush,
  deferred,
  yourDay,
  REPLY,
  AI_HEADLINE,
};
