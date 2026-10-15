// A minimal stand-in for the DOM, shared by the frontend node tests: only what ui.js and the
// screen modules touch. Modules under test run with vm.runInNewContext and fakeDocument() as
// their `document`; tests then read the element tree directly instead of querying a browser.
"use strict";

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }

  names() {
    return this.owner.className.split(/\s+/).filter(Boolean);
  }

  contains(name) {
    return this.names().includes(name);
  }

  add(name) {
    if (!this.contains(name)) {
      this.owner.className = [...this.names(), name].join(" ");
    }
  }

  remove(name) {
    this.owner.className = this.names().filter((other) => other !== name).join(" ");
  }

  toggle(name, force) {
    const on = force === undefined ? !this.contains(name) : Boolean(force);
    if (on) {
      this.add(name);
    } else {
      this.remove(name);
    }
    return on;
  }
}

class FakeElement {
  constructor(tagName, namespaceURI) {
    this.tagName = tagName;
    this.namespaceURI = namespaceURI || null;
    this.className = "";
    this.textContent = "";
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.disabled = false;
    this.classList = new FakeClassList(this);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index === -1) {
      throw new Error("removeChild: not a child");
    }
    this.children.splice(index, 1);
    return child;
  }

  get firstChild() {
    return this.children.length > 0 ? this.children[0] : null;
  }

  addEventListener(type, handler) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(handler);
  }

  // Mirrors a real button: a disabled control never fires its click handlers.
  click() {
    if (this.disabled) {
      return;
    }
    (this.listeners.click || []).forEach((handler) => handler({ type: "click" }));
  }

  querySelector(selector) {
    const wanted = selector.replace(/^\./, "");
    return byClass(this, wanted) || null;
  }
}

class FakeTextNode {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = String(text);
  }
}

// `document` for a module under test. byId maps element ids (such as the "live" region) to
// elements so getElementById can find them; everything else resolves to null.
function fakeDocument(byId) {
  const known = byId || {};
  return {
    createElement: (tagName) => new FakeElement(tagName),
    createElementNS: (namespaceURI, tagName) => new FakeElement(tagName, namespaceURI),
    createTextNode: (text) => new FakeTextNode(text),
    getElementById: (id) => (Object.hasOwn(known, id) ? known[id] : null),
  };
}

// The direct child of `parent` carrying the class `name`, or undefined.
function byClass(parent, name) {
  return parent.children.find((child) => child.classList && child.classList.contains(name));
}

module.exports = { FakeClassList, FakeElement, FakeTextNode, fakeDocument, byClass };
