// Tests for the account screen (frontend/screens/account.js, docs/PLAN.md T49) beyond its first
// tests: where keyboard focus goes after a failed sign in and after Try again (DESIGN.md section
// 9), what the screen says while logging out, after a server fault, after an import that kept
// nothing, once the server has ended this device's session, and when the server refused some of
// the account's takes. The screen runs against a fake DOM whose elements take focus, with the
// real ui.js and a stub app.auth whose answers each test sets; the last test runs it on the real
// auth.js and store.js over the fake server.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, FakeTextNode } = require("./fake-dom");
const { FakeIndexedDB } = require("./fake-indexeddb");
const { FakeAccountServer } = require("./fake-account-server");

const FRONTEND = path.join(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(FRONTEND, file), "utf8");
const ACCOUNT_SOURCE = source("screens/account.js");
const UI_SOURCE = source("ui.js");
const AUTH_SOURCE = source("auth.js");
const STORE_SOURCE = source("store.js");
const CSS = source("styles.css");

const ANN = "ann@example.com";
const PASSWORD = "correct horse battery staple";

const MESSAGES = Object.freeze({
  wrong: "Email or password is wrong.",
  network: "Could not reach the server. Check your connection, then try again.",
  unknown: "Something went wrong on our side. Try again.",
});

function failure(kind) {
  const error = new Error(MESSAGES[kind]);
  error.kind = kind;
  return error;
}

// A fake document whose elements take focus. page.active is the focused element; disabling it
// sends focus to the page's body, as a browser's focus fixup does.
function focusDocument(live) {
  const page = { active: null, body: { tagName: "body" } };
  class FocusableElement extends FakeElement {
    focus() {
      page.active = this;
    }

    get disabled() {
      return this.isDisabled === true;
    }

    set disabled(value) {
      this.isDisabled = Boolean(value);
      if (this.isDisabled && page.active === this) {
        page.active = page.body;
      }
    }
  }
  const document = {
    createElement: (tag) => new FocusableElement(tag),
    createElementNS: (namespace, tag) => new FocusableElement(tag, namespace),
    createTextNode: (text) => new FakeTextNode(text),
    getElementById: (id) => (id === "live" ? live : null),
  };
  return { document, page };
}

// A stub app.auth: every call is logged; `answers` replaces any of its functions.
function stubAuth(answers = {}) {
  const calls = [];
  const logged = (name, answer) => (...args) => {
    calls.push([name, ...args]);
    return answer(...args);
  };
  const auth = {
    messages: MESSAGES,
    me: logged("me", async () => null),
    account: logged("account", async () => null),
    signUp: logged("signUp", async (email) => email),
    logIn: logged("logIn", async (email) => email),
    logOut: logged("logOut", async () => undefined),
    deleteAccount: logged("deleteAccount", async () => undefined),
    guestImportOffer: logged("guestImportOffer", async () => null),
    importGuestTakes: logged("importGuestTakes", async () => ({
      added: 0,
      keptHere: 0,
      waiting: false,
    })),
    declineGuestImport: logged("declineGuestImport", async () => undefined),
    syncStatus: logged("syncStatus", async () => ({ endedSession: null, takesNotKept: 0 })),
    keepEndedTakesHere: logged("keepEndedTakesHere", async () => undefined),
  };
  Object.entries(answers).forEach(([name, answer]) => {
    auth[name] = logged(name, answer);
  });
  return { auth, calls };
}

// ui.js then screens/account.js on the focus document, mounted on a section like index.html's.
// `context` adds to the realm (the real auth.js and store.js, for the end).
function mountAccount(auth, context = {}) {
  const live = new FakeElement("div");
  const { document, page } = focusDocument(live);
  const realm = {
    app: { screens: {}, router: { go: () => {} }, auth },
    document,
    ...context,
  };
  vm.runInNewContext(UI_SOURCE, realm, { filename: "ui.js" });
  if (auth === null) {
    vm.runInNewContext(AUTH_SOURCE, realm, { filename: "auth.js" });
    vm.runInNewContext(STORE_SOURCE, realm, { filename: "store.js" });
  }
  vm.runInNewContext(ACCOUNT_SOURCE, realm, { filename: "screens/account.js" });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  const screen = realm.app.screens.account;
  screen.mount(root);
  return { screen, body, live, page, app: realm.app };
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

function hasClass(node, name) {
  return Boolean(node.classList) && node.classList.contains(name);
}

function descendants(root) {
  return (root.children || []).flatMap((child) => [child, ...descendants(child)]);
}

function find(root, test) {
  return descendants(root).find(test) || null;
}

function byClassDeep(root, name) {
  return find(root, (node) => hasClass(node, name));
}

function buttonNamed(root, label) {
  return find(root, (node) => node.tagName === "button" && fullText(node) === label);
}

function inputOfType(root, type) {
  return find(root, (node) => node.tagName === "input" && node.getAttribute("type") === type);
}

function submitButton(root) {
  return find(root, (node) => node.tagName === "button" && node.getAttribute("type") === "submit");
}

// Focus is on `node`, and `node` is on the screen.
function assertFocusedOn(page, body, node, message) {
  assert.ok(node, message + ": the node exists");
  assert.equal(page.active, node, message);
  assert.ok(descendants(body).includes(node), message + ": the focused node is on the screen");
}

// Sends the form from its focused submit button, as pressing Enter on it does.
async function submitFromButton(body, page) {
  const button = submitButton(body);
  button.focus();
  const form = find(body, (node) => node.tagName === "form");
  form.listeners.submit.forEach((handler) => handler({ type: "submit", preventDefault() {} }));
  return button;
}

// --- focus ---------------------------------------------------------------------------------------

test("a failed log in sent from its button leaves focus on the button", async () => {
  const { auth } = stubAuth({ logIn: async () => Promise.reject(failure("wrong")) });
  const { screen, body, page } = mountAccount(auth);
  await screen.show();
  await settle();
  buttonNamed(body, "Log in").click();
  inputOfType(body, "email").value = ANN;
  inputOfType(body, "password").value = "not the password";

  const button = await submitFromButton(body, page);
  await settle();

  assert.equal(fullText(byClassDeep(body, "account__error")), MESSAGES.wrong);
  assertFocusedOn(page, body, button, "focus stays on Log in");
});

test("while a sign up runs, its button reads as busy, keeps focus and sends once", async () => {
  let answer;
  const { auth, calls } = stubAuth({
    signUp: () =>
      new Promise((resolve, reject) => {
        answer = reject;
      }),
  });
  const { screen, body, page } = mountAccount(auth);
  await screen.show();
  await settle();
  inputOfType(body, "email").value = ANN;
  inputOfType(body, "password").value = PASSWORD;

  const button = await submitFromButton(body, page);
  await settle();
  assert.equal(button.getAttribute("aria-disabled"), "true");
  assert.equal(button.disabled, false, "never disabled, which would drop its focus");
  assertFocusedOn(page, body, button, "focus stays on Create account while it runs");
  const form = find(body, (node) => node.tagName === "form");
  form.listeners.submit.forEach((handler) => handler({ type: "submit", preventDefault() {} }));
  const sent = calls.filter((call) => call[0] === "signUp");
  assert.equal(sent.length, 1, "a second Enter sends nothing");

  answer(failure("network"));
  await settle();
  assert.equal(button.getAttribute("aria-disabled"), "false");
  assertFocusedOn(page, body, button, "focus stays on Create account after it fails");
});

test("Try again moves focus to the first line of the view it brings", async () => {
  let replies = 0;
  const { auth } = stubAuth({
    me: async () => {
      replies += 1;
      if (replies === 1) {
        throw failure("network");
      }
      return null;
    },
  });
  const { screen, body, page } = mountAccount(auth);
  await screen.show();
  await settle();
  const retry = buttonNamed(body, "Try again");
  retry.focus();

  retry.click();
  await settle();

  assertFocusedOn(page, body, byClassDeep(body, "account__lead"), "focus on the form's first line");
});

test("Try again that gets no reply again moves focus to the error's title", async () => {
  const { auth } = stubAuth({ me: async () => Promise.reject(failure("network")) });
  const { screen, body, page } = mountAccount(auth);
  await screen.show();
  await settle();

  buttonNamed(body, "Try again").click();
  await settle();

  const title = byClassDeep(body, "state__title");
  assert.equal(fullText(title), "Could not reach the server");
  assert.equal(title.getAttribute("tabindex"), "-1");
  assertFocusedOn(page, body, title, "focus on the error's title");
});

// --- logging out ---------------------------------------------------------------------------------

test("Log out reads Logging out and keeps focus while the queue goes up first", async () => {
  let finish;
  const { auth } = stubAuth({
    me: async () => ANN,
    logOut: () =>
      new Promise((resolve, reject) => {
        finish = reject;
      }),
  });
  const { screen, body, page } = mountAccount(auth);
  await screen.show();
  await settle();
  const button = buttonNamed(body, "Log out");
  button.focus();

  button.click();
  await settle();

  assert.equal(fullText(button), "Logging out");
  assert.equal(button.getAttribute("aria-disabled"), "true");
  assertFocusedOn(page, body, button, "focus stays on the button");
  finish(failure("network"));
  await settle();
  assert.equal(fullText(button), "Log out");
  assert.equal(button.getAttribute("aria-disabled"), "false");
  assert.equal(fullText(byClassDeep(body, "account__error")), MESSAGES.network);
});

// --- what the screen says ---------------------------------------------------------------------

test("a fault on our side is not called being offline, signed in or not", async () => {
  const signedIn = stubAuth({
    me: async () => Promise.reject(failure("unknown")),
    account: async () => ANN,
  });
  const first = mountAccount(signedIn.auth);
  await first.screen.show();
  await settle();
  assert.equal(fullText(byClassDeep(first.body, "account__status")), "Signed in as " + ANN);
  assert.equal(fullText(byClassDeep(first.body, "account__note")), MESSAGES.unknown);

  const guest = stubAuth({ me: async () => Promise.reject(failure("unknown")) });
  const second = mountAccount(guest.auth);
  await second.screen.show();
  await settle();
  const block = second.body.children[0];
  assert.equal(block.className, "state state--error");
  assert.equal(fullText(block), "Could not check your account" + MESSAGES.unknown + "Try again");
});

test("an import that kept none of the takes says so first", async () => {
  const { auth } = stubAuth({
    me: async () => ANN,
    guestImportOffer: async () => ({ count: 2 }),
    importGuestTakes: async () => ({ added: 0, keptHere: 2, waiting: false }),
  });
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();

  buttonNamed(body, "Add to account").click();
  await settle();

  assert.equal(
    fullText(byClassDeep(body, "account__offer")),
    "Your account could not keep these takes. 2 takes stay on this device only.",
  );
});

test("signed in, the screen says how many takes the server did not keep", async () => {
  const { auth } = stubAuth({
    me: async () => ANN,
    syncStatus: async () => ({ endedSession: null, takesNotKept: 2 }),
  });
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();

  assert.equal(
    fullText(byClassDeep(body, "account__note")),
    "Your account could not keep 2 takes. They stay on this device only.",
  );
});

test("the delete question says which takes stay on the device, and for whom", async () => {
  const { auth } = stubAuth({ me: async () => ANN });
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();

  buttonNamed(body, "Delete account").click();

  assert.equal(
    fullText(byClassDeep(body, "account__confirm-text")),
    "Delete your account and every take it keeps on our server? " +
      "Takes recorded on this device stay here, for anyone who uses it.",
  );
});

// --- a session the server ended ------------------------------------------------------------------

test("once the server has ended the session, the screen says so with the email ready", async () => {
  const { auth } = stubAuth({
    syncStatus: async () => ({ endedSession: { email: ANN, takesHere: 2 }, takesNotKept: 0 }),
  });
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();

  assert.equal(
    fullText(byClassDeep(body, "account__lead")),
    "Your session has ended. Log in again to sync your takes.",
  );
  const modes = byClassDeep(body, "account__modes");
  assert.deepEqual(
    modes.children.map((option) => [fullText(option), option.getAttribute("aria-pressed")]),
    [
      ["Sign up", "false"],
      ["Log in", "true"],
    ],
  );
  assert.equal(inputOfType(body, "email").value, ANN);
  const card = byClassDeep(body, "account__offer");
  assert.equal(
    fullText(byClassDeep(card, "account__offer-text")),
    "Cannot log in? Keep the 2 takes recorded here on this device, without the account.",
  );
  const keep = buttonNamed(card, "Keep on this device");
  assert.ok(hasClass(keep, "btn--ghost"), "the form's Log in stays the one primary button");
  // Switching to Sign up keeps the switch where the speaker put it.
  buttonNamed(body, "Sign up").click();
  await settle();
  const signUpOption = byClassDeep(body, "account__modes").children[0];
  assert.equal(signUpOption.getAttribute("aria-pressed"), "true");
});

test("Keep on this device lets the account go, then shows the plain form", async () => {
  let ended = { email: ANN, takesHere: 1 };
  const { auth, calls } = stubAuth({
    syncStatus: async () => ({ endedSession: ended, takesNotKept: 0 }),
    keepEndedTakesHere: async () => {
      ended = null;
    },
  });
  const { screen, body, live, page } = mountAccount(auth);
  await screen.show();
  await settle();

  buttonNamed(body, "Keep on this device").click();
  await settle();

  assert.equal(calls.filter((call) => call[0] === "keepEndedTakesHere").length, 1);
  assert.equal(byClassDeep(body, "account__offer"), null);
  const lead = byClassDeep(body, "account__lead");
  assert.equal(
    fullText(lead),
    "An account keeps your takes on every device you use. Without one, they stay on this device.",
  );
  assert.equal(live.textContent, "Takes kept on this device");
  assertFocusedOn(page, body, lead, "focus on the form's first line");
});

test("on the real account and store, a deleted account's takes can be kept here", async () => {
  const server = new FakeAccountServer();
  const indexedDB = new FakeIndexedDB();
  const phone = server.browser();
  const { screen, body, app } = mountAccount(null, { indexedDB, fetch: phone.fetch });
  await app.auth.signUp(ANN, PASSWORD);
  await app.store.save({
    id: "phone-take",
    createdAt: "2026-10-12T09:30:00.000Z",
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 31,
    metrics: { words_per_minute: 150 },
    transcript: [],
  });
  await settle();
  // The account is deleted on a laptop.
  const laptop = server.browser();
  await laptop.fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ANN, password: PASSWORD }),
  });
  await laptop.fetch("/api/me", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });

  await screen.show();
  await settle();
  assert.equal(
    fullText(byClassDeep(body, "account__offer-text")),
    "Cannot log in? Keep the 1 take recorded here on this device, without the account.",
  );
  buttonNamed(body, "Keep on this device").click();
  await settle();

  assert.equal(byClassDeep(body, "account__offer"), null);
  const listed = await app.store.list();
  assert.deepEqual(
    Array.from(listed, (saved) => saved.id),
    ["phone-take"],
  );
  assert.equal(await app.auth.account(), null);
});

// --- styles --------------------------------------------------------------------------------------

// The declarations of every rule in styles.css whose selector list ends with `selector`.
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...CSS.matchAll(new RegExp("(?:^|\\n)" + escaped + "\\s*\\{([^}]*)\\}", "g"))];
  assert.ok(matches.length > 0, "styles.css has a rule for " + selector);
  return matches.map((match) => match[1]).join("\n");
}

test("a long email wraps inside the column, and a busy button dims as a disabled one does", () => {
  assert.match(ruleBody(".account__status"), /overflow-wrap:\s*anywhere;/);
  assert.match(ruleBody('#screen-account .btn[aria-disabled="true"]'), /opacity:\s*\.5;/);
});
