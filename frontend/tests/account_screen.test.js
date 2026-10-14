// Tests for frontend/screens/account.js (app.screens.account, #/account, docs/PLAN.md T49) and
// the shell around it: index.html, app.js's routes and the service worker's list. The screen runs
// against the shared fake DOM with the real ui.js and a stub app.auth whose answers each test
// sets; the last tests run it on the real auth.js and store.js over the fake server.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument } = require("./fake-dom");
const { FakeIndexedDB } = require("./fake-indexeddb");
const { FakeAccountServer } = require("./fake-account-server");

const FRONTEND = path.join(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(FRONTEND, file), "utf8");
const ACCOUNT_SOURCE = source("screens/account.js");
const UI_SOURCE = source("ui.js");
const AUTH_SOURCE = source("auth.js");
const STORE_SOURCE = source("store.js");
const APP_SOURCE = source("app.js");
const INDEX_HTML = source("index.html");

const ANN = "ann@example.com";
const PASSWORD = "correct horse battery staple";
const PRIVACY =
  "Your account keeps each take's metrics and transcript on our server, never audio. " +
  "Deleting the account here erases them.";

// --- the shell -------------------------------------------------------------------------------

function sectionOf(id) {
  const match = INDEX_HTML.match(
    new RegExp('<section class="screen" id="' + id + '"[^>]*>([\\s\\S]*?)</section>'),
  );
  assert.ok(match, "index.html has #" + id);
  return match[1].replace(/\s+/g, " ").trim();
}

test("index.html holds the account screen: its h1 and one empty body", () => {
  assert.equal(
    sectionOf("screen-account").replace(/\s+/g, ""),
    '<h1>Account</h1><divclass="screen__body"></div>',
  );
});

test("History's header links to the account screen; the nav is Practice, Path, Progress, History", () => {
  const history = sectionOf("screen-history");
  assert.equal(
    history,
    '<header class="screen__header"> <h1>History</h1> ' +
      '<a class="btn btn--ghost account-link" href="#/account">Account</a> ' +
      '</header> <div class="screen__body"></div>',
  );
  const nav = INDEX_HTML.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
  const links = [...nav.matchAll(/<a class="nav__item" href="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(links, ["#/practice", "#/path", "#/progress", "#/history"]);
});

test("auth.js loads before store.js and the account screen before onboarding, the last", () => {
  const scripts = [...INDEX_HTML.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(scripts.slice(0, 4), ["app.js", "ui.js", "auth.js", "store.js"]);
  assert.deepEqual(scripts.slice(-3), [
    "screens/level.js",
    "screens/account.js",
    "screens/onboarding.js",
  ]);
});

test("the offline shell holds both new files under a new cache name", () => {
  const worker = source("sw.js");
  const shell = [...worker.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(shell.includes("auth.js"));
  assert.ok(shell.includes("screens/account.js"));
  assert.match(worker, /const CACHE_NAME = "speech-coach-shell-v4";/);
});

test("app.js routes #/account to the account screen", () => {
  const fakeWindow = { location: { hash: "#/account" }, addEventListener: () => {} };
  const context = { window: fakeWindow, document: { addEventListener: () => {} } };
  vm.runInNewContext(APP_SOURCE, context, { filename: "app.js" });
  assert.deepEqual(JSON.parse(JSON.stringify(fakeWindow.app.router.current())), {
    name: "account",
    params: {},
  });
});

// --- the screen, on a stub app.auth ----------------------------------------------------------

const MESSAGES = Object.freeze({
  wrong: "Email or password is wrong.",
  network: "Could not reach the server. Check your connection, then try again.",
  unknown: "Something went wrong on our side. Try again.",
});

function failure(kind) {
  const error = new Error(MESSAGES[kind] || "Accounts are not available right now.");
  error.kind = kind;
  return error;
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
  };
  Object.entries(answers).forEach(([name, answer]) => {
    auth[name] = logged(name, answer);
  });
  return { auth, calls };
}

// ui.js then screens/account.js against the fake document, mounted on a section like
// index.html's. `context` adds to the realm (the real auth.js and store.js, for the end).
function mountAccount(auth, context = {}) {
  const live = new FakeElement("div");
  const document = fakeDocument({ live });
  const routes = [];
  const realm = {
    app: { screens: {}, router: { go: (name) => routes.push(name) }, auth },
    document,
    ...context,
  };
  vm.runInNewContext(UI_SOURCE, realm, { filename: "ui.js" });
  vm.runInNewContext(ACCOUNT_SOURCE, realm, { filename: "screens/account.js" });
  const root = new FakeElement("section");
  const heading = new FakeElement("h1");
  heading.textContent = "Account";
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(heading);
  root.appendChild(body);
  const screen = realm.app.screens.account;
  screen.mount(root);
  return { screen, body, live, routes, app: realm.app };
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

// What a browser's textContent would return: the node's own text, then its children's.
function fullText(node) {
  return (node.textContent || "") + (node.children || []).map(fullText).join("");
}

function hasClass(node, name) {
  return Boolean(node.classList) && node.classList.contains(name);
}

// Every element under `root`, depth first.
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

// Sends the form, as pressing its submit button or Enter in a field does.
async function submit(root) {
  const form = find(root, (node) => node.tagName === "form");
  form.listeners.submit.forEach((handler) => handler({ type: "submit", preventDefault() {} }));
  await settle();
}

async function fillAndSubmit(body, email, password) {
  inputOfType(body, "email").value = email;
  inputOfType(body, "password").value = password;
  await submit(body);
}

function primaryButtons(root) {
  return descendants(root).filter(
    (node) => node.tagName === "button" && hasClass(node, "btn--primary"),
  );
}

test("account.js registers app.screens.account and builds nothing until shown", () => {
  const { auth, calls } = stubAuth();
  const { app, body } = mountAccount(auth);
  assert.deepEqual(Object.keys(app.screens), ["account"]);
  assert.deepEqual(body.children, []);
  assert.deepEqual(calls, []);
});

test("while the account is checked, the screen shows a loading block", async () => {
  let answer;
  const { auth } = stubAuth({ me: () => new Promise((resolve) => (answer = resolve)) });
  const { screen, body } = mountAccount(auth);
  screen.show();
  const block = body.children[0];
  assert.equal(block.className, "state state--loading");
  assert.equal(fullText(block), "Checking your accountThis takes a moment.");
  answer(null);
  await settle();
  assert.ok(byClassDeep(body, "account__form"));
});

test("a guest sees the sign-up form, the switch to log in and the privacy line", async () => {
  const { auth } = stubAuth();
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();

  assert.deepEqual(
    body.children.map((child) => child.className),
    ["account__lead", "segmented account__modes", "account__form", "account__privacy"],
  );
  assert.equal(
    fullText(body.children[0]),
    "An account keeps your takes on every device you use. Without one, they stay on this device.",
  );
  const modes = body.children[1];
  assert.equal(modes.getAttribute("role"), "group");
  assert.equal(modes.getAttribute("aria-label"), "Sign up or log in");
  assert.deepEqual(
    modes.children.map((option) => [fullText(option), option.getAttribute("aria-pressed")]),
    [
      ["Sign up", "true"],
      ["Log in", "false"],
    ],
  );
  const email = inputOfType(body, "email");
  const password = inputOfType(body, "password");
  assert.equal(email.getAttribute("autocomplete"), "email");
  assert.equal(password.getAttribute("autocomplete"), "new-password");
  assert.equal(fullText(byClassDeep(body, "account__hint")), "At least 10 characters.");
  const labels = descendants(body).filter((node) => node.tagName === "label");
  assert.deepEqual(
    labels.map((label) => [fullText(label), label.getAttribute("for")]),
    [
      ["Email", email.getAttribute("id")],
      ["Password", password.getAttribute("id")],
    ],
  );
  assert.equal(fullText(body.children[3]), PRIVACY);
  const primaries = primaryButtons(body);
  assert.equal(primaries.length, 1, "one primary button");
  assert.equal(fullText(primaries[0]), "Create account");
  assert.equal(primaries[0].getAttribute("type"), "submit");
});

test("Log in switches the form, keeping what was typed", async () => {
  const { auth, calls } = stubAuth();
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();
  inputOfType(body, "email").value = ANN;

  buttonNamed(body, "Log in").click();
  await settle();

  const modes = byClassDeep(body, "account__modes");
  assert.deepEqual(
    modes.children.map((option) => option.getAttribute("aria-pressed")),
    ["false", "true"],
  );
  assert.equal(inputOfType(body, "email").value, ANN);
  assert.equal(inputOfType(body, "password").getAttribute("autocomplete"), "current-password");
  assert.equal(byClassDeep(body, "account__hint"), null);
  assert.equal(fullText(primaryButtons(body)[0]), "Log in");

  await fillAndSubmit(body, ANN, PASSWORD);
  const sent = calls.filter((call) => call[0] === "logIn" || call[0] === "signUp");
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [["logIn", ANN, PASSWORD]]);
});

test("creating an account sends what was typed, then shows who is signed in", async () => {
  const { auth, calls } = stubAuth();
  const { screen, body, live } = mountAccount(auth);
  await screen.show();
  await settle();

  await fillAndSubmit(body, ANN, PASSWORD);

  assert.ok(calls.some((call) => call[0] === "signUp" && call[1] === ANN && call[2] === PASSWORD));
  assert.equal(fullText(byClassDeep(body, "account__status")), "Signed in as " + ANN);
  assert.equal(live.textContent, "Signed in");
  assert.equal(byClassDeep(body, "account__form"), null);
  assert.equal(fullText(byClassDeep(body, "account__privacy")), PRIVACY);
});

test("a failed log in shows the account's sentence and keeps the form to try again", async () => {
  const { auth } = stubAuth({ logIn: async () => Promise.reject(failure("wrong")) });
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();
  buttonNamed(body, "Log in").click();

  await fillAndSubmit(body, ANN, "not the password");

  const error = byClassDeep(body, "account__error");
  assert.equal(error.getAttribute("role"), "alert");
  assert.equal(fullText(error), "Email or password is wrong.");
  assert.equal(find(error, (node) => node.tagName === "svg").getAttribute("data-icon"), "alert");
  const button = primaryButtons(body)[0];
  assert.equal(button.disabled, false);
  assert.equal(inputOfType(body, "email").value, ANN);
});

test("a failure with no sentence of its own reads as one on our side", async () => {
  const { auth } = stubAuth({ signUp: async () => Promise.reject(new TypeError("boom")) });
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();

  await fillAndSubmit(body, ANN, PASSWORD);

  assert.equal(fullText(byClassDeep(body, "account__error")), MESSAGES.unknown);
});

test("with accounts not configured the screen says so, and guest mode carries on", async () => {
  const { auth } = stubAuth({ me: async () => Promise.reject(failure("unavailable")) });
  const { screen, body, routes } = mountAccount(auth);
  await screen.show();
  await settle();

  const block = body.children[0];
  assert.equal(block.className, "state state--empty");
  assert.equal(
    fullText(block),
    "Accounts are not available right now" +
      "Your takes stay on this device, and everything else works as before.Practice",
  );
  assert.equal(byClassDeep(body, "account__form"), null);
  buttonNamed(body, "Practice").click();
  assert.deepEqual(routes, ["practice"]);
});

test("with no reply, a guest gets Try again, which checks once more", async () => {
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
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();

  const block = body.children[0];
  assert.equal(block.className, "state state--error");
  assert.equal(
    fullText(block),
    "Could not reach the serverCheck your connection, then try again.Try again",
  );
  buttonNamed(body, "Try again").click();
  await settle();
  assert.ok(byClassDeep(body, "account__form"));
});

test("with no reply, a device signed in before keeps its account view with a note", async () => {
  const { auth } = stubAuth({
    me: async () => Promise.reject(failure("network")),
    account: async () => ANN,
  });
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();

  assert.equal(fullText(byClassDeep(body, "account__status")), "Signed in as " + ANN);
  assert.equal(
    fullText(byClassDeep(body, "account__note")),
    "You are offline. Takes save on this device and sync later.",
  );
});

test("signed in, the offer adds this device's takes to the account and says how many", async () => {
  const { auth, calls } = stubAuth({
    me: async () => ANN,
    guestImportOffer: async () => ({ count: 3 }),
    importGuestTakes: async () => ({ added: 3, keptHere: 0, waiting: false }),
  });
  const { screen, body, live } = mountAccount(auth);
  await screen.show();
  await settle();

  const offer = byClassDeep(body, "account__offer");
  assert.ok(hasClass(offer, "tip-card"));
  assert.equal(
    fullText(byClassDeep(offer, "account__offer-text")),
    "This device has 3 takes from before you signed in. Add them to your account?",
  );
  const primaries = primaryButtons(body);
  assert.deepEqual(primaries.map(fullText), ["Add to account"]);

  buttonNamed(offer, "Add to account").click();
  await settle();

  assert.ok(calls.some((call) => call[0] === "importGuestTakes"));
  assert.equal(fullText(byClassDeep(body, "account__offer")), "Added 3 takes to your account.");
  assert.equal(live.textContent, "Added 3 takes to your account.");
});

test("the offer's sentences count one take as one", async () => {
  const { auth } = stubAuth({
    me: async () => ANN,
    guestImportOffer: async () => ({ count: 1 }),
    importGuestTakes: async () => ({ added: 1, keptHere: 1, waiting: false }),
  });
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();

  assert.equal(
    fullText(byClassDeep(body, "account__offer-text")),
    "This device has 1 take from before you signed in. Add it to your account?",
  );
  buttonNamed(body, "Add to account").click();
  await settle();
  assert.equal(
    fullText(byClassDeep(body, "account__offer")),
    "Added 1 take to your account. 1 take stays on this device only.",
  );
});

test("an import that has to wait for the network says when it will finish", async () => {
  const { auth } = stubAuth({
    me: async () => ANN,
    guestImportOffer: async () => ({ count: 2 }),
    importGuestTakes: async () => ({ added: 0, keptHere: 0, waiting: true }),
  });
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();

  buttonNamed(body, "Add to account").click();
  await settle();

  assert.equal(
    fullText(byClassDeep(body, "account__offer")),
    "Your takes join your account once you are back online.",
  );
});

test("Keep on this device answers the offer for good, and it goes away", async () => {
  const { auth, calls } = stubAuth({
    me: async () => ANN,
    guestImportOffer: async () => ({ count: 2 }),
  });
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();

  buttonNamed(body, "Keep on this device").click();
  await settle();

  assert.ok(calls.some((call) => call[0] === "declineGuestImport"));
  assert.ok(!calls.some((call) => call[0] === "importGuestTakes"));
  assert.equal(byClassDeep(body, "account__offer"), null);
});

test("Delete account asks first; Cancel puts the button back, nothing deleted", async () => {
  const { auth, calls } = stubAuth({ me: async () => ANN });
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();

  buttonNamed(body, "Delete account").click();

  const confirm = byClassDeep(body, "account__confirm");
  assert.equal(confirm.getAttribute("role"), "group");
  assert.equal(confirm.getAttribute("aria-label"), "Delete account?");
  assert.equal(
    fullText(byClassDeep(confirm, "account__confirm-text")),
    "Delete your account and every take it keeps on our server? " +
      "Takes recorded on this device stay here, for anyone who uses it.",
  );
  const confirmButton = buttonNamed(confirm, "Delete account");
  assert.ok(hasClass(confirmButton, "btn--danger"));
  assert.ok(hasClass(buttonNamed(confirm, "Cancel"), "btn--ghost"));
  assert.ok(!calls.some((call) => call[0] === "deleteAccount"), "nothing deleted yet");

  buttonNamed(confirm, "Cancel").click();
  assert.equal(byClassDeep(body, "account__confirm"), null);
  assert.ok(hasClass(buttonNamed(body, "Delete account"), "btn--danger"));
  assert.ok(!calls.some((call) => call[0] === "deleteAccount"));
});

test("confirming deletes the account once, then shows the sign-up form", async () => {
  const { auth, calls } = stubAuth({ me: async () => ANN });
  const { screen, body, live } = mountAccount(auth);
  await screen.show();
  await settle();
  buttonNamed(body, "Delete account").click();
  const confirmButton = buttonNamed(byClassDeep(body, "account__confirm"), "Delete account");

  confirmButton.click();
  confirmButton.click();
  await settle();

  assert.equal(calls.filter((call) => call[0] === "deleteAccount").length, 1);
  assert.ok(byClassDeep(body, "account__form"));
  assert.equal(live.textContent, "Account deleted");
});

test("after a delete the form offers a new account, with no email left from the old", async () => {
  const { auth } = stubAuth();
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();
  buttonNamed(body, "Log in").click();
  await fillAndSubmit(body, ANN, PASSWORD);
  buttonNamed(body, "Delete account").click();

  buttonNamed(byClassDeep(body, "account__confirm"), "Delete account").click();
  await settle();

  assert.equal(fullText(primaryButtons(body)[0]), "Create account");
  assert.equal(inputOfType(body, "email").value, "");
  assert.equal(inputOfType(body, "password").value, "");
});

test("a delete that fails keeps the account view and says why", async () => {
  const { auth } = stubAuth({
    me: async () => ANN,
    deleteAccount: async () => Promise.reject(failure("network")),
  });
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();
  buttonNamed(body, "Delete account").click();

  buttonNamed(byClassDeep(body, "account__confirm"), "Delete account").click();
  await settle();

  assert.equal(fullText(byClassDeep(body, "account__status")), "Signed in as " + ANN);
  assert.equal(fullText(byClassDeep(body, "account__error")), MESSAGES.network);
  assert.equal(byClassDeep(body, "account__confirm"), null);
  assert.ok(buttonNamed(body, "Delete account"));
});

test("a delete refused because the session ended shows the log-in form and says why", async () => {
  const ended = new Error("Your session has ended. Log in again first.");
  ended.kind = "signed_out";
  const { auth } = stubAuth({
    me: async () => ANN,
    deleteAccount: async () => Promise.reject(ended),
  });
  const { screen, body } = mountAccount(auth);
  await screen.show();
  await settle();
  buttonNamed(body, "Delete account").click();

  buttonNamed(byClassDeep(body, "account__confirm"), "Delete account").click();
  await settle();

  assert.equal(byClassDeep(body, "account__status"), null);
  assert.equal(fullText(primaryButtons(body)[0]), "Log in");
  assert.equal(fullText(byClassDeep(body, "account__error")), ended.message);
});

test("Log out signs out and shows the form again", async () => {
  const { auth, calls } = stubAuth();
  const { screen, body, live } = mountAccount(auth);
  await screen.show();
  await settle();
  await fillAndSubmit(body, ANN, PASSWORD);

  const logOut = buttonNamed(body, "Log out");
  assert.ok(hasClass(logOut, "btn--secondary"));
  logOut.click();
  await settle();

  assert.ok(calls.some((call) => call[0] === "logOut"));
  assert.ok(byClassDeep(body, "account__form"));
  assert.equal(live.textContent, "Logged out");
  // Whoever logs in next starts from an empty form, on Log in.
  assert.equal(fullText(primaryButtons(body)[0]), "Log in");
  assert.equal(inputOfType(body, "email").value, "");
});

test("a slow check from an earlier visit never paints over a newer one", async () => {
  const answers = [];
  const { auth } = stubAuth({ me: () => new Promise((resolve) => answers.push(resolve)) });
  const { screen, body } = mountAccount(auth);
  screen.show();
  screen.show();
  answers[1](null);
  await settle();
  answers[0](ANN);
  await settle();

  assert.ok(byClassDeep(body, "account__form"));
  assert.equal(byClassDeep(body, "account__status"), null);
});

test("every sentence on the screen is sentence case with no exclamation mark", () => {
  const { auth } = stubAuth();
  const { screen } = mountAccount(auth);
  const strings = Object.values(screen.COPY).filter((value) => typeof value === "string");
  assert.ok(strings.length >= 20);
  strings.forEach((text) => {
    assert.doesNotMatch(text, /!/, text);
    assert.match(text, /^[A-Z]/, text);
  });
  assert.ok(Object.isFrozen(screen.COPY));
});

// --- the screen on the real account and store ------------------------------------------------

test("signing up from the screen and adding the guest takes puts them in the account", async () => {
  const server = new FakeAccountServer();
  const indexedDB = new FakeIndexedDB();
  const realm = { indexedDB, fetch: server.browser().fetch };
  // auth.js and store.js join the realm before the screen, as index.html loads them.
  const live = new FakeElement("div");
  const document = fakeDocument({ live });
  const context = { app: { screens: {}, router: { go: () => {} } }, document, ...realm };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(AUTH_SOURCE, context, { filename: "auth.js" });
  vm.runInNewContext(STORE_SOURCE, context, { filename: "store.js" });
  vm.runInNewContext(ACCOUNT_SOURCE, context, { filename: "screens/account.js" });
  const store = context.app.store;
  await store.save({ ...guestTake("guest-1", "2026-10-11T08:00:00.000Z") });
  await store.save({ ...guestTake("guest-2", "2026-10-12T08:00:00.000Z") });
  const root = new FakeElement("section");
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  const screen = context.app.screens.account;
  screen.mount(root);

  await screen.show();
  await settle();
  await fillAndSubmit(body, ANN, PASSWORD);
  await settle();

  assert.equal(fullText(byClassDeep(body, "account__status")), "Signed in as " + ANN);
  assert.equal(
    fullText(byClassDeep(body, "account__offer-text")),
    "This device has 2 takes from before you signed in. Add them to your account?",
  );
  buttonNamed(body, "Add to account").click();
  await settle();
  assert.equal(fullText(byClassDeep(body, "account__offer")), "Added 2 takes to your account.");
  assert.deepEqual(
    server.takesOf(ANN).map((take) => take.id),
    ["guest-2", "guest-1"],
  );

  // Back on the screen later, the offer is not made again.
  await screen.show();
  await settle();
  assert.equal(byClassDeep(body, "account__offer"), null);
});

function guestTake(id, createdAt) {
  return {
    id,
    createdAt,
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 31,
    metrics: { words_per_minute: 150 },
    transcript: [{ text: "Hello", start: 0.4, end: 0.8 }],
  };
}
