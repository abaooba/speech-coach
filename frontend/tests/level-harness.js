// The shared harness for the Level screen tests (frontend/screens/level.js, spec
// docs/superpowers/specs/2026-10-14-loop-path.md sections 7 and 8). ui.js, passages.js,
// delivery.js, path.js, loop.js and the screen run for real in one vm context against the shared
// fake DOM, extended here with what the screen touches beyond it: focus(), contains(), a
// descendant querySelector for classes and tags, insertBefore and removeAttribute. Practice,
// app.store and app.router are fakes; the router shows and hides the screen as app.js does. The
// browser's audio (AudioContext, the <audio> element, object URLs), the timers, the clock (a
// fixed Date) and Math.random are fakes as well, so every run is the same.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, FakeTextNode } = require("./fake-dom");

const FRONTEND_DIR = path.join(__dirname, "..");
const SOURCE_FILES = [
  "ui.js",
  "passages.js",
  "delivery.js",
  "path.js",
  "loop.js",
  path.join("screens", "level.js"),
];
const SOURCES = SOURCE_FILES.map((file) => ({
  file,
  text: fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8"),
}));

// The tests run on Wednesday 2026-10-14 at 10:00 local time.
const TODAY = "2026-10-14";
const NOW_LOCAL = "2026-10-14T10:00:00";
const RealDate = Date;
const NOW_ISO = new RealDate(NOW_LOCAL).toISOString();

// An ISO time on a local day at `hour`, as app.store keeps createdAt.
function at(day, hour = 9) {
  const [year, month, date] = day.split("-").map(Number);
  return new RealDate(year, month - 1, date, hour).toISOString();
}

// --- The fake DOM -----------------------------------------------------------------------------

// A fake element that also takes focus, finds classes and tags anywhere below it, inserts
// before a child, drops attributes and knows its parent, which the shared fake cannot.
class LevelElement extends FakeElement {
  constructor(tagName, namespaceURI, world) {
    super(tagName, namespaceURI);
    this.world = world;
    this.parentNode = null;
  }

  appendChild(child) {
    detach(child);
    child.parentNode = this;
    return super.appendChild(child);
  }

  insertBefore(child, reference) {
    if (reference === null || reference === undefined) {
      return this.appendChild(child);
    }
    const index = this.children.indexOf(reference);
    if (index === -1) {
      throw new Error("insertBefore: the reference is not a child");
    }
    detach(child);
    child.parentNode = this;
    this.children.splice(index, 0, child);
    return child;
  }

  removeChild(child) {
    super.removeChild(child);
    child.parentNode = null;
    return child;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  hasAttribute(name) {
    return Object.hasOwn(this.attributes, name);
  }

  focus() {
    this.world.focusLog.push(this);
  }

  contains(node) {
    return (
      node === this ||
      this.children.some((child) => typeof child.contains === "function" && child.contains(node))
    );
  }

  // ".class" or a tag name, searched depth first below this element.
  querySelector(selector) {
    const found = descendants(this).find((node) => matches(node, selector));
    return found || null;
  }
}

// The <audio> element the screen falls back on when decoding fails: it records what it is asked
// to play and fires "ended" when a test says so.
class FakeAudioElement extends LevelElement {
  constructor(world) {
    super("audio", null, world);
    this.currentTime = 0;
    this.paused = true;
    this.plays = [];
    this.pauses = 0;
    this.loads = 0;
    this.onended = null;
    world.audioElements.push(this);
  }

  play() {
    this.paused = false;
    this.plays.push(this.currentTime);
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    this.pauses += 1;
  }

  load() {
    this.loads += 1;
  }

  // What a browser does when playback reaches the end of the take.
  finish() {
    this.paused = true;
    if (typeof this.onended === "function") {
      this.onended({ type: "ended" });
    }
  }
}

function detach(node) {
  if (node && node.parentNode && typeof node.parentNode.removeChild === "function") {
    node.parentNode.removeChild(node);
  }
}

function classOf(node) {
  if (!node || typeof node !== "object") {
    return "";
  }
  return node.className || (node.getAttribute ? node.getAttribute("class") : null) || "";
}

function hasClass(node, name) {
  return classOf(node).split(/\s+/).includes(name);
}

function matches(node, selector) {
  if (selector.startsWith(".")) {
    return hasClass(node, selector.slice(1));
  }
  return String(node.tagName || "").toLowerCase() === selector.toLowerCase();
}

// Every element below `node`, depth first, in document order.
function descendants(node) {
  const found = [];
  (node.children || []).forEach((child) => {
    if (child instanceof FakeElement) {
      found.push(child, ...descendants(child));
    }
  });
  return found;
}

function findAll(node, className) {
  return [node, ...descendants(node)].filter((each) => hasClass(each, className));
}

function find(node, className) {
  return findAll(node, className)[0] || null;
}

function byTag(node, tagName) {
  return [node, ...descendants(node)].filter(
    (each) => String(each.tagName || "").toLowerCase() === tagName,
  );
}

// All the text in a node, hidden or not.
function textOf(node) {
  if (!node) {
    return "";
  }
  return (node.textContent || "") + (node.children || []).map(textOf).join("");
}

// The text the eye reads: no .sr-only and nothing aria-hidden.
function visibleText(node) {
  if (!node || hasClass(node, "sr-only")) {
    return "";
  }
  if (node.getAttribute && node.getAttribute("aria-hidden") === "true") {
    return "";
  }
  return (node.textContent || "") + (node.children || []).map(visibleText).join("");
}

// The buttons and links in a node, as {node, text}.
function controlsOf(node) {
  return [node, ...descendants(node)]
    .filter((each) => each.tagName === "button" || each.tagName === "a")
    .map((each) => ({ node: each, text: visibleText(each).trim() }));
}

// The button or link reading exactly `text`, or null.
function control(node, text) {
  const found = controlsOf(node).find((each) => each.text === text);
  return found ? found.node : null;
}

// --- The fake browser -------------------------------------------------------------------------

// A fixed clock: new Date() is 10:00 on 2026-10-14; any other Date is as usual.
class FixedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(NOW_LOCAL);
    } else {
      super(...args);
    }
  }

  static now() {
    return new RealDate(NOW_LOCAL).getTime();
  }
}

// Math with a random source the test scripts: each call takes the next draw, then repeats the
// last one.
function scriptedMath(draws) {
  const fixed = Object.create(Math);
  let next = 0;
  fixed.random = () => {
    const draw = draws[Math.min(next, draws.length - 1)];
    next += 1;
    return draw;
  };
  return fixed;
}

// The buffer source a clip plays through: it records start() and stop(), and fires onended when
// stopped or when a test finishes it.
class FakeSource {
  constructor(context) {
    this.context = context;
    this.buffer = null;
    this.onended = null;
    this.started = null;
    this.stopped = false;
    this.connected = null;
  }

  connect(destination) {
    this.connected = destination;
  }

  start(when, offset, duration) {
    this.started = { when, offset, duration };
  }

  stop() {
    this.stopped = true;
    this.finish();
  }

  finish() {
    if (typeof this.onended === "function") {
      const handler = this.onended;
      this.onended = null;
      handler({ type: "ended" });
    }
  }
}

function fakeAudioContextClass(world) {
  return class FakeAudioContext {
    constructor() {
      this.currentTime = 0;
      this.state = "running";
      this.closed = false;
      this.destination = { speakers: true };
      this.decodes = [];
      this.sources = [];
      world.contexts.push(this);
    }

    decodeAudioData(bytes) {
      this.decodes.push(bytes);
      if (world.decodeFails) {
        return Promise.reject(new Error("Unable to decode audio data"));
      }
      return Promise.resolve({ duration: 90, decodedFrom: bytes });
    }

    createBufferSource() {
      const source = new FakeSource(this);
      this.sources.push(source);
      return source;
    }

    resume() {
      return Promise.resolve();
    }

    close() {
      this.closed = true;
      this.state = "closed";
      return Promise.resolve();
    }
  };
}

// A recording as Practice hands it over: only arrayBuffer() is read.
function fakeBlob(name = "take-1") {
  return {
    name,
    type: "audio/webm",
    arrayBuffer() {
      return Promise.resolve({ bytesOf: name });
    },
  };
}

// --- Takes ------------------------------------------------------------------------------------

// `count` words spoken over exactly `seconds` from `start`, each 80% of its step long. `say`
// swaps in other text by index.
function wordsOver(count, seconds, say = {}, start = 1) {
  const step = seconds / (count - 0.2);
  return Array.from({ length: count }, (_, index) => ({
    text: say[index] || "word" + index,
    start: start + index * step,
    end: start + index * step + step * 0.8,
  }));
}

function ums(...indexes) {
  return Object.fromEntries(indexes.map((index) => [index, "um"]));
}

// `count` filler indexes spread evenly through `words` words, from index 5.
function spreadUms(count, words) {
  const gap = Math.floor((words - 10) / Math.max(1, count));
  return ums(...Array.from({ length: count }, (_, index) => 5 + index * gap));
}

// What Practice hands judge(): a talk of `words` words over `seconds` with `fillers` ums
// spread through it, or the words given.
function talkResult({ seconds = 90, words = 225, fillers = 0, transcript, pauses = [] } = {}) {
  const spoken = transcript || wordsOver(words, seconds, spreadUms(fillers, words));
  return {
    transcript: spoken,
    metrics: { pauses, repeats: [], fillers: {} },
    durationSeconds: seconds + 2,
  };
}

// A read of a script: a script restart at each word index in `restartsAt`, a misread at each in
// `misreadAt`. `followed` false leaves out the script block, as for a take that strayed.
function readResult({ seconds = 80, words = 200, restartsAt = [], misreadAt = [], followed = true }) {
  const transcript = wordsOver(words, seconds);
  const restarts = restartsAt.map((index) => ({
    text: transcript[index].text + " " + transcript[index + 1].text,
    at: transcript[index].start,
  }));
  const misread = misreadAt.map((index) => ({
    word: "script" + index,
    index,
    at: transcript[index].start,
    said: transcript[index].text,
  }));
  const metrics = { pauses: [], repeats: restarts, fillers: {} };
  if (followed) {
    metrics.script = { restarts, skipped: [], misread };
  }
  return { transcript, metrics, durationSeconds: seconds + 2 };
}

// A take already saved before the run, as app.store.list() hands it back.
function savedTake({ id, createdAt, passageId = "impromptu", topic = null, result, path }) {
  const take = {
    id,
    createdAt,
    passageId,
    passageTitle: "Impromptu",
    durationSeconds: result.durationSeconds,
    metrics: result.metrics,
    transcript: result.transcript,
    topic,
  };
  if (path) {
    take.path = path;
  }
  return take;
}

// --- The world --------------------------------------------------------------------------------

// Loads the modules into a fresh vm context and mounts the screen into a section holding the h1
// and the body index.html gives it. `history` is what app.store.list() resolves (newest first),
// `cleared` what listClearedLevels() resolves; `draws` script Math.random.
function createWorld(options = {}) {
  const world = {
    focusLog: [],
    announcements: [],
    contexts: [],
    audioElements: [],
    objectUrls: { created: [], revoked: [] },
    timers: new Map(),
    nextTimer: 1,
    decodeFails: Boolean(options.decodeFails),
    hashListeners: [],
    scrolls: 0,
    savedCount: 0,
  };

  let lastAnnouncement = "";
  const live = {
    get textContent() {
      return lastAnnouncement;
    },
    set textContent(text) {
      lastAnnouncement = text;
      world.announcements.push(text);
    },
  };

  const document = {
    get activeElement() {
      return world.focusLog.length > 0 ? world.focusLog[world.focusLog.length - 1] : null;
    },
    createElement: (tagName) =>
      tagName === "audio" ? new FakeAudioElement(world) : new LevelElement(tagName, null, world),
    createElementNS: (namespaceURI, tagName) => new LevelElement(tagName, namespaceURI, world),
    createTextNode: (text) => new FakeTextNode(text),
    getElementById: (id) => (id === "live" ? live : null),
  };

  function addTimer(kind, callback, ms) {
    const id = world.nextTimer++;
    world.timers.set(id, { kind, callback, ms });
    return id;
  }

  const store = {
    sessions: (options.history || []).slice(),
    cleared: (options.cleared || []).slice(),
    marks: [],
    failMarks: false,
    list() {
      return Promise.resolve(this.sessions.slice());
    },
    listClearedLevels() {
      return Promise.resolve(this.cleared.slice());
    },
    markLevelCleared(levelId, clearedAt) {
      if (this.failMarks) {
        return Promise.reject(new Error("Could not save path progress"));
      }
      this.marks.push(levelId);
      const kept = this.cleared.find((record) => record.levelId === levelId);
      if (kept) {
        return Promise.resolve(kept);
      }
      const record = { levelId, clearedAt: clearedAt || NOW_ISO };
      this.cleared.push(record);
      return Promise.resolve(record);
    },
  };

  const app = { screens: {} };

  // As app.js routes: the hash changes, the shown screen hides (reading the new route), the new
  // one shows.
  const router = {
    route: { name: "practice", params: {} },
    shown: null,
    gone: [],
    showing: Promise.resolve(),
    go(name, params) {
      const id = params && params.id ? params.id : null;
      this.gone.push(id ? name + "/" + id : name);
      this.route = { name, params: id ? { id } : {} };
      world.hashListeners.forEach((listener) => listener({ type: "hashchange" }));
      if (this.shown === "level") {
        app.screens.level.hide();
      }
      this.shown = name;
      if (name === "level") {
        this.showing = Promise.resolve(app.screens.level.show(this.route.params));
      }
    },
    current() {
      return this.route;
    },
  };

  const practice = {
    requests: [],
    startLevelTake(request) {
      this.requests.push(request);
      router.go("practice");
    },
  };
  app.screens.practice = practice;
  app.store = store;
  app.router = router;

  const objectUrls = world.objectUrls;
  const context = {
    app,
    document,
    window: {
      addEventListener(type, listener) {
        if (type === "hashchange") {
          world.hashListeners.push(listener);
        }
      },
      scrollTo() {
        world.scrolls += 1;
      },
    },
    AudioContext: options.noAudio ? undefined : fakeAudioContextClass(world),
    URL: {
      createObjectURL(blob) {
        const url = "blob:take-" + (objectUrls.created.length + 1);
        objectUrls.created.push({ url, blob });
        return url;
      },
      revokeObjectURL(url) {
        objectUrls.revoked.push(url);
      },
    },
    setInterval: (callback, ms) => addTimer("interval", callback, ms),
    clearInterval: (id) => world.timers.delete(id),
    setTimeout: (callback, ms) => addTimer("timeout", callback, ms),
    clearTimeout: (id) => world.timers.delete(id),
    Date: FixedDate,
    Math: scriptedMath(options.draws || [0]),
    console,
  };
  SOURCES.forEach(({ file, text }) => vm.runInNewContext(text, context, { filename: file }));

  const section = new LevelElement("section", null, world);
  section.className = "screen";
  section.setAttribute("id", "screen-level");
  const heading = new LevelElement("h1", null, world);
  heading.textContent = "Level";
  const body = new LevelElement("div", null, world);
  body.className = "screen__body";
  section.appendChild(heading);
  section.appendChild(body);
  app.screens.level.mount(section);

  Object.assign(world, {
    app,
    store,
    router,
    practice,
    screen: app.screens.level,
    section,
    heading,
    body,
    // Runs every timer of `kind` that is due, once ("interval" ticks run one at a time).
    tick(kind = "interval") {
      Array.from(world.timers.entries())
        .filter(([, timer]) => timer.kind === kind)
        .forEach(([id, timer]) => {
          if (kind === "timeout") {
            world.timers.delete(id);
          }
          timer.callback();
        });
    },
    activeTimers(kind) {
      return Array.from(world.timers.values()).filter((timer) => timer.kind === kind).length;
    },
    async settle() {
      for (let round = 0; round < 6; round += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      await router.showing;
      for (let round = 0; round < 6; round += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
    // Opens #/level/<playId> as a tap on the Path does.
    async open(playId) {
      router.go("level", { id: playId });
      await world.settle();
    },
    // The request Practice holds: the last one the screen handed over.
    request() {
      return practice.requests[practice.requests.length - 1] || null;
    },
    // Practice's side of a take that uploaded: judge, save, hand the recording back.
    async finishTake(result, extra = {}) {
      const request = world.request();
      const pathField = request.judge(result);
      world.savedCount += 1;
      const session = {
        id: extra.id || "saved-" + world.savedCount,
        createdAt: extra.createdAt || at(TODAY, 10),
        passageId: request.material.id,
        passageTitle: request.material.title,
        durationSeconds: result.durationSeconds,
        metrics: result.metrics,
        transcript: result.transcript,
        topic: request.material.topic,
        path: pathField,
      };
      store.sessions.unshift(session);
      request.onSaved({
        id: session.id,
        session,
        blob: extra.blob === undefined ? fakeBlob("take-" + world.savedCount) : extra.blob,
        contentType: "audio/webm",
        liveTaps: extra.liveTaps || [],
      });
      await world.settle();
      return { pathField, session };
    },
    // Taps a button or link reading exactly `text` in the screen's body.
    tap(text) {
      const found = control(body, text);
      if (!found) {
        throw new Error(
          "No control reads '" + text + "': " + controlsOf(body).map((each) => each.text),
        );
      }
      found.click();
      return found;
    },
  });
  return world;
}

module.exports = {
  TODAY,
  NOW_ISO,
  at,
  createWorld,
  wordsOver,
  ums,
  spreadUms,
  talkResult,
  readResult,
  savedTake,
  fakeBlob,
  find,
  findAll,
  byTag,
  hasClass,
  classOf,
  textOf,
  visibleText,
  controlsOf,
  control,
  descendants,
};
