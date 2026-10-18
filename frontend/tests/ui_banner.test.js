// Tests for app.ui.banner (frontend/ui.js): the strip at the top of the page that Practice puts
// up for a take analyzed in the background. ui.js runs in a vm context against the shared fake
// DOM; the banner node is a fake that also logs focus() and answers contains(), since a repaint
// moves focus that sat on one of its buttons.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, FakeTextNode, byClass } = require("./fake-dom");

const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

class BannerElement extends FakeElement {
  constructor(tagName, namespaceURI, focusLog) {
    super(tagName, namespaceURI);
    this.focusLog = focusLog;
    this.hidden = false;
  }

  focus(options) {
    this.focusLog.push({ node: this, options });
  }

  contains(node) {
    return (
      node === this ||
      this.children.some((child) => typeof child.contains === "function" && child.contains(node))
    );
  }
}

// The root element's style records the custom properties the banner publishes.
function load() {
  const focusLog = [];
  const properties = {};
  const app = {};
  const document = {
    documentElement: {
      style: {
        setProperty(name, value) {
          properties[name] = value;
        },
      },
    },
    get activeElement() {
      return focusLog.length > 0 ? focusLog[focusLog.length - 1].node : null;
    },
    createElement: (tagName) => new BannerElement(tagName, null, focusLog),
    createElementNS: (namespaceURI, tagName) => new BannerElement(tagName, namespaceURI, focusLog),
    createTextNode: (text) => new FakeTextNode(text),
    getElementById: () => null,
  };
  vm.runInNewContext(UI_SOURCE, { app, document }, { filename: "ui.js" });
  const node = new BannerElement("div", null, focusLog);
  node.className = "banner";
  node.hidden = true;
  return { banner: app.ui.banner, node, focusLog, properties };
}

// The text under a node: a text node's own, else its children's in order.
function textOf(node) {
  if (!Array.isArray(node.children) || node.children.length === 0) {
    return node.textContent;
  }
  return node.children.map(textOf).join("");
}

// Values built inside the vm realm have a foreign prototype; a JSON round-trip makes them
// comparable with deepEqual.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function labelsOf(node) {
  const actions = byClass(node, "banner__actions");
  return actions ? actions.children.map(textOf) : [];
}

test("the banner starts down and show() paints kind, words and actions into the node", () => {
  const { banner, node } = load();
  banner.mount(node);
  assert.equal(node.hidden, true);
  assert.equal(banner.current(), null);

  const clicks = [];
  banner.show({
    kind: "ready",
    title: "Results ready",
    body: "Your 0:42 take is ready to read.",
    actions: [{ label: "See results", onClick: () => clicks.push("see") }],
  });
  assert.equal(node.hidden, false);
  assert.equal(node.className, "banner banner--ready");
  assert.equal(node.dataset.kind, "ready");
  assert.deepEqual(
    node.children.map((child) => child.className),
    ["banner__icon", "banner__text", "banner__actions"],
  );
  const icon = byClass(node, "banner__icon").children[0];
  assert.equal(icon.getAttribute("data-icon"), "check");
  assert.equal(icon.getAttribute("aria-hidden"), "true");
  const text = byClass(node, "banner__text");
  assert.equal(byClass(text, "banner__title").textContent, "Results ready");
  assert.equal(byClass(text, "banner__body").textContent, "Your 0:42 take is ready to read.");
  const [button] = byClass(node, "banner__actions").children;
  assert.equal(button.tagName, "button");
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(button.className, "banner__action btn btn--secondary");
  assert.equal(textOf(button), "See results");
  button.click();
  assert.deepEqual(clicks, ["see"]);
  const current = banner.current();
  assert.deepEqual(plain(current), {
    kind: "ready",
    title: "Results ready",
    body: "Your 0:42 take is ready to read.",
    actions: [{ label: "See results" }],
  });
  assert.equal(typeof current.actions[0].onClick, "function");
});

test("working shows the spinner and no actions; failed shows the alert triangle", () => {
  const { banner, node } = load();
  banner.mount(node);
  banner.show({ kind: "working", title: "Analyzing your speech", body: "Usually 5 to 15 seconds." });
  assert.equal(node.className, "banner banner--working");
  assert.equal(byClass(node, "banner__icon").children[0].className, "spinner");
  assert.equal(byClass(node, "banner__actions"), undefined, "no actions block without actions");
  assert.deepEqual(labelsOf(node), []);

  banner.show({
    kind: "failed",
    title: "Upload failed",
    body: "Could not reach the server. Your recording is still here.",
    actions: [{ label: "Retry upload" }, { label: "Record a new take" }],
  });
  assert.equal(node.className, "banner banner--failed");
  assert.equal(byClass(node, "banner__icon").children[0].getAttribute("data-icon"), "alert");
  assert.deepEqual(labelsOf(node), ["Retry upload", "Record a new take"]);
  assert.equal(node.children.length, 3, "a repaint replaces the parts, never stacks them");
});

test("hide() takes it down and clears what it showed; a show() after that paints afresh", () => {
  const { banner, node } = load();
  banner.mount(node);
  banner.show({ kind: "working", title: "Analyzing your speech", body: "" });
  banner.hide();
  assert.equal(node.hidden, true);
  assert.equal(node.className, "banner");
  assert.deepEqual(node.children, []);
  assert.equal(node.dataset.kind, undefined, "no kind is left on the hidden node");
  assert.equal(banner.current(), null);
  banner.show({ kind: "working", title: "Again", body: "" });
  assert.equal(node.hidden, false);
  assert.equal(byClass(byClass(node, "banner__text"), "banner__title").textContent, "Again");
});

test("an unknown kind throws and leaves the banner as it was", () => {
  const { banner, node } = load();
  banner.mount(node);
  banner.show({ kind: "working", title: "Analyzing your speech", body: "" });
  assert.throws(() => banner.show({ kind: "info", title: "x", body: "" }), /unknown kind "info"/);
  assert.equal(banner.current().kind, "working");
  assert.equal(node.hidden, false);
  assert.deepEqual(plain(banner.KINDS), ["working", "ready", "failed"]);
});

test("show() and hide() work before mount, and mount paints what was asked for", () => {
  const { banner, node } = load();
  banner.show({ kind: "ready", title: "Results ready", body: "", actions: [{ label: "See results" }] });
  assert.equal(banner.current().kind, "ready", "the state is kept with no node");
  banner.mount(node);
  assert.equal(node.hidden, false);
  assert.equal(node.className, "banner banner--ready");
  assert.deepEqual(labelsOf(node), ["See results"]);
  banner.mount(null);
  banner.hide();
  assert.equal(banner.current(), null);
  assert.equal(node.hidden, false, "an unmounted node is left alone");
});

test("a repaint moves focus from a banner button to the banner itself, never a Tab stop", () => {
  const { banner, node, focusLog } = load();
  banner.mount(node);
  banner.show({ kind: "failed", title: "Upload failed", body: "", actions: [{ label: "Retry upload" }] });
  const [retry] = byClass(node, "banner__actions").children;
  retry.focus();
  banner.show({ kind: "working", title: "Analyzing your speech", body: "" });
  assert.equal(node.getAttribute("tabindex"), "-1");
  const last = focusLog[focusLog.length - 1];
  assert.equal(last.node, node);
  assert.deepEqual(plain(last.options), { preventScroll: true });
});

test("a repaint leaves focus alone when it sat outside the banner", () => {
  const { banner, node, focusLog } = load();
  banner.mount(node);
  const elsewhere = new BannerElement("button", null, focusLog);
  elsewhere.focus();
  banner.show({ kind: "working", title: "Analyzing your speech", body: "" });
  banner.show({ kind: "ready", title: "Results ready", body: "", actions: [{ label: "See results" }] });
  assert.equal(focusLog.length, 1);
  assert.equal(node.getAttribute("tabindex"), null);
});

// The strip is no live region of its own: it enters the page already filled, and is hidden while
// a take records, so its words are said through the #live region by whoever shows it.
test("the banner node in index.html is first in the body, hidden, and no live region", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const body = html.slice(html.indexOf("<body>"));
  const firstTag = body.match(/<body>\s*<(\w+)([^>]*)>/);
  assert.equal(firstTag[1], "div");
  assert.match(firstTag[2], /class="banner"/);
  assert.match(firstTag[2], /id="banner"/);
  assert.doesNotMatch(firstTag[2], /role=|aria-live=/);
  assert.match(firstTag[2], /\bhidden\b/);
  assert.equal(body.indexOf("<main>") > body.indexOf('id="banner"'), true);
});

test("holdsFocus() says whether keyboard focus sits in the banner", () => {
  const { banner, node, focusLog } = load();
  banner.mount(node);
  banner.show({ kind: "ready", title: "Results ready", body: "", actions: [{ label: "See results" }] });
  assert.equal(banner.holdsFocus(), false);
  byClass(node, "banner__actions").children[0].focus();
  assert.equal(banner.holdsFocus(), true);
  new BannerElement("button", null, focusLog).focus();
  assert.equal(banner.holdsFocus(), false);
});

test("the banner's height reaches the page as --banner-h, 0px while it is down", () => {
  const { banner, node, properties } = load();
  banner.mount(node);
  assert.equal(properties["--banner-h"], "0px", "down at mount");
  node.offsetHeight = 72;
  banner.show({ kind: "working", title: "Analyzing your speech", body: "" });
  assert.equal(properties["--banner-h"], "72px");
  node.offsetHeight = 119;
  banner.show({ kind: "failed", title: "Upload failed", body: "", actions: [{ label: "Retry upload" }] });
  assert.equal(properties["--banner-h"], "119px", "measured again on every paint");
  banner.hide();
  assert.equal(properties["--banner-h"], "0px");
});

test("app.js mounts the banner at boot by its id, guarded for fakes without getElementById", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(source, /const BANNER_ID = "banner";/);
  assert.match(source, /ui\.banner\.mount\(document\.getElementById\(BANNER_ID\)\)/);
  assert.match(source, /typeof document\.getElementById === "function"/);
});
