// Tests for app.sheet (guided coach, spec Phase 5 item 5): the bottom sheet and the one-time
// guides. sheet.js runs in a vm against a small fake DOM of its own: elements with focus, a body,
// document-level key listeners and an activeElement.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, FakeTextNode } = require("./fake-dom");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "sheet.js"), "utf8");
const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

class Node extends FakeElement {
  constructor(tagName, ns, doc) {
    super(tagName, ns);
    this.doc = doc;
    this.inert = false;
  }

  focus() {
    this.doc.activeElement = this;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  get offsetWidth() {
    return 1;
  }
}

function makeDocument(withBody = true) {
  const doc = { activeElement: null, keyListeners: [], withBody };
  doc.createElement = (tag) => new Node(tag, null, doc);
  doc.createElementNS = (ns, tag) => new Node(tag, ns, doc);
  doc.createTextNode = (text) => new FakeTextNode(text);
  doc.addEventListener = (type, fn) => type === "keydown" && doc.keyListeners.push(fn);
  doc.removeEventListener = (type, fn) => {
    doc.keyListeners = doc.keyListeners.filter((other) => other !== fn);
  };
  doc.getElementById = (id) => (id === "live" ? doc.live : null);
  doc.live = new Node("div", null, doc);
  doc.press = (key, shiftKey = false) => {
    const event = { key, shiftKey, prevented: false, preventDefault() { this.prevented = true; } };
    doc.keyListeners.slice().forEach((fn) => fn(event));
    return event;
  };
  if (withBody) {
    doc.body = new Node("body", null, doc);
  }
  return doc;
}

function setup(options = {}) {
  const doc = makeDocument(options.body !== false);
  const flags = options.flags || {};
  const app = {
    store: {
      getFlag: async (key) => flags[key],
      setFlag: async (key, value) => {
        flags[key] = value;
      },
    },
  };
  const routeListeners = [];
  const context = {
    app,
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
  doc.route = () => routeListeners.slice().forEach((fn) => fn());
  doc.routeListeners = routeListeners;
  if (options.motion) {
    context.matchMedia = () => ({ matches: true });
  }
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(SOURCE, context, { filename: "sheet.js" });
  return { app, doc, flags, context };
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

function opener(doc) {
  const node = doc.createElement("button");
  doc.body.appendChild(node);
  node.focus();
  return node;
}

function coach(extra = {}) {
  return {
    label: "Coach",
    line: "Your longest pause was 5.4 s.",
    why: "Restarts is your weakest unit.",
    primary: { label: "Start: Restarts level 2", onSelect() {} },
    ...extra,
  };
}

test("open renders an accessible dialog with the label, line and primary button", () => {
  const { app, doc } = setup();
  app.sheet.open(coach());
  const sheet = find(doc.body, "sheet");
  assert.equal(sheet.getAttribute("role"), "dialog");
  assert.equal(sheet.getAttribute("aria-modal"), "true");
  assert.equal(find(sheet, "sheet__label").getAttribute("id"), sheet.getAttribute("aria-labelledby"));
  assert.equal(find(sheet, "sheet__line").getAttribute("id"), sheet.getAttribute("aria-describedby"));
  assert.match(text(find(sheet, "sheet__label")), /Coach/);
  assert.equal(text(find(sheet, "sheet__line")), "Your longest pause was 5.4 s.");
  assert.equal(text(find(sheet, "sheet__why")), "Restarts is your weakest unit.");
  const primary = find(sheet, "sheet__primary");
  assert.equal(primary.tagName, "button");
  assert.equal(text(primary), "Start: Restarts level 2");
  assert.equal(doc.activeElement, primary);
  assert.ok(find(doc.body, "sheet-scrim"));
  assert.equal(find(sheet, "sheet__handle").getAttribute("aria-label"), "Close");
});

test("status renders as a status region, an ok pill or a plain pill", () => {
  const { app, doc } = setup();
  const loading = app.sheet.open(coach({ status: { kind: "loading", text: "Reading your take…" } }));
  const region = find(doc.body, "sheet__status");
  assert.equal(region.getAttribute("role"), "status");
  assert.match(text(region), /Reading your take/);
  loading.clearStatus();
  assert.equal(find(doc.body, "sheet__status"), null);
  app.sheet.open(coach({ status: { kind: "ok", text: "Level 1 cleared" } }));
  assert.match(text(find(doc.body, "sheet__pill--ok")), /Level 1 cleared/);
  app.sheet.open(coach({ status: { kind: "pill", text: "Not yet · 2 tries left" } }));
  assert.match(text(find(doc.body, "sheet__pill")), /2 tries left/);
});

test("primary and link buttons run their callbacks and close the sheet", () => {
  const { app, doc } = setup();
  const calls = [];
  app.sheet.open(
    coach({
      primary: { label: "Go", onSelect: () => calls.push("primary") },
      secondary: { label: "See full results", onSelect: () => calls.push("secondary") },
      extra: { label: "Check grammar", icon: "check", onSelect: () => calls.push("extra") },
    }),
  );
  const links = find(doc.body, "sheet__links");
  assert.equal(links.children.length, 2);
  assert.ok(find(links, "sheet__grammar"));
  links.children[0].click();
  assert.deepEqual(calls, ["secondary"]);
  assert.equal(find(doc.body, "sheet"), null);
  app.sheet.open(coach({ primary: { label: "Go", onSelect: () => calls.push("primary") } }));
  find(doc.body, "sheet__primary").click();
  assert.deepEqual(calls, ["secondary", "primary"]);
  assert.equal(find(doc.body, "sheet"), null);
});

test("Escape, the scrim and the handle close the sheet and return focus to the opener", () => {
  const { app, doc } = setup();
  const origin = opener(doc);
  const closes = [];
  const closers = [
    () => doc.press("Escape"),
    () => find(doc.body, "sheet-scrim").click(),
    () => find(doc.body, "sheet__handle").click(),
  ];
  closers.forEach((close) => {
    app.sheet.open(coach({ onClose: () => closes.push(1) }));
    assert.notEqual(doc.activeElement, origin);
    close();
    assert.equal(find(doc.body, "sheet"), null);
    assert.equal(find(doc.body, "sheet-scrim"), null);
    assert.equal(doc.activeElement, origin);
    assert.equal(doc.keyListeners.length, 0);
  });
  assert.equal(closes.length, 3);
});

test("the page behind is inert while open and restored after", () => {
  const { app, doc } = setup();
  const main = doc.createElement("main");
  doc.body.appendChild(main);
  const handle = app.sheet.open(coach());
  assert.equal(main.inert, true);
  assert.equal(find(doc.body, "sheet").inert, false, "the sheet itself stays live");
  handle.close();
  assert.equal(main.inert, false);
});

test("aria-hidden stands in where inert is unsupported", () => {
  const { app, doc } = setup();
  const bare = { attributes: {}, getAttribute(n) { return this.attributes[n] ?? null; },
    setAttribute(n, v) { this.attributes[n] = String(v); },
    removeAttribute(n) { delete this.attributes[n]; } };
  doc.body.children.push(bare);
  const handle = app.sheet.open(coach());
  assert.equal(bare.getAttribute("aria-hidden"), "true");
  handle.close();
  assert.equal(bare.getAttribute("aria-hidden"), null);
});

test("Tab and Shift+Tab wrap inside the sheet", () => {
  const { app, doc } = setup();
  app.sheet.open(coach({ secondary: { label: "See full results" } }));
  const handle = find(doc.body, "sheet__handle");
  const primary = find(doc.body, "sheet__primary");
  const link = find(doc.body, "sheet__links").children[0];
  link.focus();
  assert.equal(doc.press("Tab").prevented, true);
  assert.equal(doc.activeElement, handle);
  assert.equal(doc.press("Tab", true).prevented, true);
  assert.equal(doc.activeElement, link);
  primary.focus();
  assert.equal(doc.press("Tab").prevented, false, "middle stops are left to the browser");
  doc.activeElement = null;
  doc.press("Tab");
  assert.equal(doc.activeElement, handle);
});

test("update swaps the line, announces it and leaves focus alone", () => {
  const { app, doc } = setup();
  const handle = app.sheet.open(
    coach({ status: { kind: "loading", text: "Reading your take…" } }),
  );
  const primary = find(doc.body, "sheet__primary");
  handle.update("You restarted “the few— the few” at 0:32.");
  assert.equal(text(find(doc.body, "sheet__line")), "You restarted “the few— the few” at 0:32.");
  assert.equal(doc.live.textContent, "You restarted “the few— the few” at 0:32.");
  assert.equal(doc.activeElement, primary);
  assert.equal(find(doc.body, "sheet__status"), null);
  handle.close();
  handle.update("late");
  assert.equal(doc.live.textContent, "You restarted “the few— the few” at 0:32.");
});

test("opening a second sheet closes the first and keeps the first opener", () => {
  const { app, doc } = setup();
  const origin = opener(doc);
  const closed = [];
  app.sheet.open(coach({ line: "first", onClose: () => closed.push("first") }));
  app.sheet.open(coach({ line: "second" }));
  const sheets = doc.body.children.filter((n) => n.classList.contains("sheet"));
  assert.equal(sheets.length, 1);
  assert.equal(text(find(doc.body, "sheet__line")), "second");
  assert.deepEqual(closed, ["first"]);
  doc.press("Escape");
  assert.equal(doc.activeElement, origin);
  assert.equal(doc.keyListeners.length, 0);
});

test("closing is idempotent and animates out only when motion is allowed", () => {
  const still = setup();
  const a = still.app.sheet.open(coach());
  a.close();
  a.close();
  assert.equal(find(still.doc.body, "sheet"), null);

  const moving = setup({ motion: true });
  const b = moving.app.sheet.open(coach());
  b.close();
  assert.ok(find(moving.doc.body, "sheet--closing"), "kept in place while it slides out");
});

test("guideOnce shows a guide once and sets its flag", async () => {
  const { app, doc, flags } = setup();
  const shown = await app.sheet.guideOnce("practice", {
    title: "Your first take",
    line: "Pick a topic.",
    primary: "Got it",
  });
  assert.equal(shown, true);
  assert.equal(flags["guideSeen:practice"], true);
  const sheet = find(doc.body, "sheet");
  assert.match(text(find(sheet, "sheet__label")), /Guide/);
  assert.equal(text(find(sheet, "sheet__title")), "Your first take");
  assert.equal(sheet.getAttribute("aria-labelledby"), find(sheet, "sheet__title").getAttribute("id"));
  assert.equal(text(find(sheet, "sheet__text")), "Pick a topic.");
  assert.equal(find(sheet, "sheet__links"), null);
  assert.equal(text(find(sheet, "sheet__primary")), "Got it");
  find(sheet, "sheet__primary").click();
  assert.equal(find(doc.body, "sheet"), null);
  const again = await app.sheet.guideOnce("practice", {
    title: "x",
    line: "y",
    primary: "Got it",
  });
  assert.equal(again, false);
  assert.equal(find(doc.body, "sheet"), null);
});

test("guideOnce skips a guide already seen and runs a primary onSelect with content", async () => {
  const { app, doc } = setup({ flags: { "guideSeen:path": true } });
  assert.equal(
    await app.sheet.guideOnce("path", { title: "t", line: "l", primary: "Got it" }),
    false,
  );
  const loop = doc.createElement("div");
  let started = 0;
  await app.sheet.guideOnce("level", {
    title: "How a level works",
    line: "Take 1, then review.",
    content: loop,
    primary: { label: "Start take 1", onSelect: () => (started += 1) },
  });
  assert.ok(find(find(doc.body, "sheet"), "sheet__extra"));
  find(doc.body, "sheet__primary").click();
  assert.equal(started, 1);
});

test("with no document.body every call does nothing", async () => {
  const { app, flags } = setup({ body: false });
  const handle = app.sheet.open(coach());
  assert.doesNotThrow(() => {
    handle.update("x");
    handle.clearStatus();
    handle.close();
  });
  assert.equal(
    await app.sheet.guideOnce("practice", { title: "t", line: "l", primary: "Got it" }),
    false,
  );
  assert.deepEqual(flags, {});
});

test("ui.js draws the compass icon the guide label uses", () => {
  const { app } = setup();
  assert.ok(app.ui.icon("compass"));
});

test("a line given as parts renders curly-quoted spans with the moment's mark", () => {
  const { app, doc } = setup();
  const handle = app.sheet.open(
    coach({ line: [{ text: "You restarted " }, { text: "the few", quote: "restart" }, { text: " at 0:32." }] }),
  );
  const line = find(doc.body, "sheet__line");
  const quote = find(line, "sheet__quote");
  assert.ok(quote.classList.contains("sheet__quote--restart"));
  assert.equal(quote.textContent, "“the few”");
  assert.equal(text(line), "You restarted “the few” at 0:32.");
  handle.update([{ text: "Say " }, { text: "um", quote: "filler" }]);
  assert.ok(find(find(doc.body, "sheet__line"), "sheet__quote--filler"));
  assert.equal(text(find(doc.body, "sheet__line")), "Say “um”");
  assert.equal(doc.live.textContent, "Say “um”");
});

test("quoteParts wraps the first quoted segment by the moment's kind", () => {
  const { app } = setup();
  const q = app.sheet.quoteParts;
  assert.deepEqual(JSON.parse(JSON.stringify(q("You said “the few— the few” at 0:32.", "restart"))), [
    { text: "You said " },
    { text: "the few— the few", quote: "restart" },
    { text: " at 0:32." },
  ]);
  assert.equal(q('Cut "um" short', "filler")[1].quote, "filler");
  assert.equal(q("After “and” a pause.", "long")[1].quote, "pause");
  assert.equal(q("After “and” a pause.", undefined)[0].text, "After ");
  assert.deepEqual(JSON.parse(JSON.stringify(q("No quotes here.", "restart"))), [{ text: "No quotes here." }]);
  assert.deepEqual(JSON.parse(JSON.stringify(q("“Only”", "filler"))), [{ text: "Only", quote: "filler" }]);
});

test("the live region stays reachable while the sheet is open", () => {
  const { app, doc } = setup();
  doc.live.setAttribute("id", "live");
  doc.body.appendChild(doc.live);
  const main = doc.createElement("main");
  doc.body.appendChild(main);
  const handle = app.sheet.open(coach());
  assert.equal(main.inert, true);
  assert.equal(doc.live.inert, false);
  handle.close();
});

test("a route change closes the sheet and calls onClose", () => {
  const { app, doc } = setup();
  let closed = 0;
  app.sheet.open(coach({ onClose: () => (closed += 1) }));
  doc.route();
  assert.equal(find(doc.body, "sheet"), null);
  assert.equal(closed, 1);
  assert.equal(doc.routeListeners.length, 0);
});

test("focus falls back to the screen heading when the opener is gone", () => {
  const { app, doc } = setup();
  const h1 = doc.createElement("h1");
  doc.querySelector = (sel) => (sel === ".screen--active h1" ? h1 : null);
  const origin = opener(doc);
  origin.isConnected = false;
  app.sheet.open(coach());
  doc.press("Escape");
  assert.equal(doc.activeElement, h1);
  assert.equal(h1.getAttribute("tabindex"), "-1");
});
