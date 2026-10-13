// Tests for frontend/auth.js (app.auth, docs/PLAN.md T49): signUp, logIn, logOut, deleteAccount
// and me() against /api/auth/* and /api/me, the fixed sentence each failure shows, and how they
// start and stop store.js's sync on this device. auth.js and store.js load into a vm realm, as
// index.html loads them, over a fake IndexedDB and a fake server (fake-account-server.js).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeIndexedDB } = require("./fake-indexeddb");
const { FakeAccountServer } = require("./fake-account-server");

const AUTH_SOURCE = fs.readFileSync(path.join(__dirname, "..", "auth.js"), "utf8");
const STORE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "store.js"), "utf8");

const ANN = "ann@example.com";
const PASSWORD = "correct horse battery staple";
const JSON_TYPE = "application/json";

const MESSAGES = {
  wrong: "Email or password is wrong.",
  too_many: "Too many tries. Wait 15 minutes, then try again.",
  unavailable: "Accounts are not available right now.",
  network: "Could not reach the server. Check your connection, then try again.",
  taken: "An account with this email already exists. Log in instead.",
  email: "Enter a valid email address.",
  password: "Use a password of 10 to 256 characters.",
  missing: "Enter your email and password.",
  signed_out: "Your session has ended. Log in again first.",
  unknown: "Something went wrong on our side. Try again.",
};

// auth.js then store.js in one realm, as index.html loads them. `options.browser` keeps a cookie
// jar across devices; `options.indexedDB` reopens a device's storage.
function loadDevice(server, options = {}) {
  const indexedDB = options.indexedDB || new FakeIndexedDB();
  const browser = options.browser || server.browser();
  const context = { app: {}, indexedDB, fetch: browser.fetch };
  vm.runInNewContext(AUTH_SOURCE, context, { filename: "auth.js" });
  vm.runInNewContext(STORE_SOURCE, context, { filename: "store.js" });
  return { auth: context.app.auth, store: context.app.store, browser, indexedDB };
}

// The rejection of `promise`, which must reject.
async function rejectionOf(promise) {
  return promise.then(
    () => assert.fail("expected a rejection"),
    (error) => error,
  );
}

function assertFailure(error, kind) {
  assert.equal(Object.prototype.toString.call(error), "[object Error]");
  assert.equal(error.kind, kind);
  assert.equal(error.message, MESSAGES[kind]);
}

test("auth.js assigns exactly app.auth and sends nothing at load", () => {
  const calls = [];
  const context = { app: {}, fetch: (...args) => calls.push(args) };
  vm.runInNewContext(AUTH_SOURCE, context, { filename: "auth.js" });
  assert.deepEqual(Object.keys(context.app), ["auth"]);
  assert.deepEqual(Object.keys(context.app.auth).sort(), [
    "account",
    "connectStore",
    "declineGuestImport",
    "deleteAccount",
    "guestImportOffer",
    "importGuestTakes",
    "logIn",
    "logOut",
    "me",
    "messages",
    "request",
    "signUp",
  ]);
  assert.deepEqual(calls, []);
});

test("messages holds one fixed sentence per failure, and is frozen", () => {
  const { auth } = loadDevice(new FakeAccountServer());
  assert.deepEqual({ ...auth.messages }, MESSAGES);
  assert.ok(Object.isFrozen(auth.messages));
});

test("signing up sends the email and password as JSON with the cookie, signing in", async () => {
  const server = new FakeAccountServer();
  const { auth } = loadDevice(server);

  const email = await auth.signUp("  Ann@Example.com ", PASSWORD);

  assert.equal(email, ANN);
  assert.equal(await auth.account(), ANN);
  assert.deepEqual(server.requests, [
    {
      method: "POST",
      path: "/api/auth/signup",
      contentType: JSON_TYPE,
      credentials: "same-origin",
      body: { email: ANN, password: PASSWORD },
    },
  ]);
});

test("logging in signs this device in to the account", async () => {
  const server = new FakeAccountServer();
  server.addUser(ANN, PASSWORD);
  const { auth } = loadDevice(server);

  assert.equal(await auth.account(), null);
  assert.equal(await auth.logIn(ANN, PASSWORD), ANN);

  assert.equal(await auth.account(), ANN);
  const [sent] = server.requests;
  assert.equal(sent.path, "/api/auth/login");
  assert.equal(sent.contentType, JSON_TYPE);
  assert.equal(sent.credentials, "same-origin");
});

test("a wrong password and an unknown email get the same sentence", async () => {
  const server = new FakeAccountServer();
  server.addUser(ANN, PASSWORD);
  const { auth } = loadDevice(server);

  assertFailure(await rejectionOf(auth.logIn(ANN, "not the password at all")), "wrong");
  assertFailure(await rejectionOf(auth.logIn("nobody@example.com", PASSWORD)), "wrong");
  assert.equal(await auth.account(), null);
});

test("too many failed logins ask the speaker to wait 15 minutes", async () => {
  const server = new FakeAccountServer();
  server.addUser(ANN, PASSWORD);
  server.lockedOut = true;
  const { auth } = loadDevice(server);

  assertFailure(await rejectionOf(auth.logIn(ANN, PASSWORD)), "too_many");
});

test("with accounts off, the calls say accounts are not available right now", async () => {
  const server = new FakeAccountServer();
  server.accountsOn = false;
  const { auth } = loadDevice(server);

  assertFailure(await rejectionOf(auth.signUp(ANN, PASSWORD)), "unavailable");
  assertFailure(await rejectionOf(auth.logIn(ANN, PASSWORD)), "unavailable");
  assertFailure(await rejectionOf(auth.me()), "unavailable");
  assert.equal(await auth.account(), null);
});

test("with no network the calls say the server could not be reached", async () => {
  const server = new FakeAccountServer();
  const { auth } = loadDevice(server);
  await auth.signUp(ANN, PASSWORD);
  server.online = false;

  assertFailure(await rejectionOf(auth.me()), "network");
  assertFailure(await rejectionOf(auth.logOut()), "network");
  assertFailure(await rejectionOf(auth.deleteAccount()), "network");
  assertFailure(await rejectionOf(auth.logIn(ANN, PASSWORD)), "network");
  assert.equal(await auth.account(), ANN, "a call that got no reply changes nothing here");
});

test("a server fault reads as something that went wrong on our side", async () => {
  const server = new FakeAccountServer();
  server.failNext("POST", "/api/auth/signup", 500);
  const { auth } = loadDevice(server);

  assertFailure(await rejectionOf(auth.signUp(ANN, PASSWORD)), "unknown");
});

test("signing up checks the email and password first, sending nothing for a slip", async () => {
  const server = new FakeAccountServer();
  const { auth } = loadDevice(server);

  for (const email of ["", "ann", "ann@example", "ann @example.com", "a@b.c" + "x".repeat(250)]) {
    assertFailure(await rejectionOf(auth.signUp(email, PASSWORD)), "email");
  }
  for (const password of ["", "short", "9 letters", "x".repeat(257), "🎤".repeat(9)]) {
    assertFailure(await rejectionOf(auth.signUp(ANN, password)), "password");
  }
  assert.deepEqual(server.requests, []);
});

test("the server's own refusals of a sign up read as the same sentences", async () => {
  const server = new FakeAccountServer();
  const { auth } = loadDevice(server);
  server.addUser("taken@example.com", PASSWORD);

  assertFailure(await rejectionOf(auth.signUp("taken@example.com", PASSWORD)), "taken");
  // A control character passes this page's quick look at the address; the server refuses it.
  assertFailure(await rejectionOf(auth.signUp("ann\u0007@example.com", PASSWORD)), "email");
  assert.equal(server.requests.length, 2, "both were the server's to refuse");
});

test("logging in with a field left empty asks for both and sends nothing", async () => {
  const server = new FakeAccountServer();
  const { auth } = loadDevice(server);

  assertFailure(await rejectionOf(auth.logIn("", PASSWORD)), "missing");
  assertFailure(await rejectionOf(auth.logIn(ANN, "")), "missing");
  assert.deepEqual(server.requests, []);
});

test("logging out ends the session on the server and stops the sync here", async () => {
  const server = new FakeAccountServer();
  const { auth } = loadDevice(server);
  await auth.signUp(ANN, PASSWORD);

  await auth.logOut();

  assert.equal(await auth.account(), null);
  const logout = server.requests.find((sent) => sent.path === "/api/auth/logout");
  assert.equal(logout.method, "POST");
  assert.equal(logout.contentType, JSON_TYPE);
  assert.equal(logout.credentials, "same-origin");
  assert.equal(await auth.me(), null, "the server ended the session too");
});

test("me() signs in a device whose cookie is good, and out one whose session ended", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.auth.signUp(ANN, PASSWORD);
  // The same browser with its storage cleared: the cookie is all that is left.
  const cleared = loadDevice(server, { browser: phone.browser });
  assert.equal(await cleared.auth.account(), null);

  assert.equal(await cleared.auth.me(), ANN);
  assert.equal(await cleared.auth.account(), ANN);

  server.endSessions(ANN);
  assert.equal(await cleared.auth.me(), null);
  assert.equal(await cleared.auth.account(), null);
});

test("deleting the account sends DELETE /api/me as JSON and forgets the account here", async () => {
  const server = new FakeAccountServer();
  const { auth } = loadDevice(server);
  await auth.signUp(ANN, PASSWORD);

  await auth.deleteAccount();

  assert.equal(server.users.has(ANN), false);
  assert.equal(await auth.account(), null);
  const deleted = server.requests.find((sent) => sent.path === "/api/me");
  assert.equal(deleted.method, "DELETE");
  assert.equal(deleted.contentType, JSON_TYPE);
  assert.equal(deleted.credentials, "same-origin");
});

test("deleting with a session that has ended asks to log in again, signed out here", async () => {
  const server = new FakeAccountServer();
  const { auth } = loadDevice(server);
  await auth.signUp(ANN, PASSWORD);
  server.endSessions(ANN);

  assertFailure(await rejectionOf(auth.deleteAccount()), "signed_out");
  assert.equal(await auth.account(), null);
  assert.equal(server.users.has(ANN), true, "the account is still there");
});

test("request() sends JSON with the cookie, answers {status, body}, 0 for no reply", async () => {
  const server = new FakeAccountServer();
  const { auth } = loadDevice(server);
  await auth.signUp(ANN, PASSWORD);

  const listed = await auth.request("GET", "/api/sessions");
  assert.deepEqual(JSON.parse(JSON.stringify(listed)), { status: 200, body: [] });
  const kept = await auth.request("POST", "/api/progress", { path_progress: [] });
  assert.equal(kept.status, 200);
  assert.equal(server.requests.at(-1).contentType, JSON_TYPE);
  assert.equal(server.requests.at(-1).credentials, "same-origin");

  server.online = false;
  assert.deepEqual(JSON.parse(JSON.stringify(await auth.request("GET", "/api/me"))), {
    status: 0,
    body: null,
  });
});

test("without store.js the account calls still work, and nothing is kept here", async () => {
  const server = new FakeAccountServer();
  const context = { app: {}, fetch: server.browser().fetch };
  vm.runInNewContext(AUTH_SOURCE, context, { filename: "auth.js" });
  const auth = context.app.auth;

  assert.equal(await auth.signUp(ANN, PASSWORD), ANN);
  assert.equal(await auth.account(), null);
  assert.equal(await auth.guestImportOffer(), null);
});
