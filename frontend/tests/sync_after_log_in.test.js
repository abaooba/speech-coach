// Tests for what a log in and a log out leave behind on a device (frontend/auth.js and store.js,
// docs/PLAN.md T49): right after a log in to an account made again under the same email, the
// offer already counts the takes recorded here; and a log out the server could not record
// (accounts were off, 503) is never undone by a later me() adopting that account's cookie.
// Each "device" is auth.js then store.js over a fake IndexedDB and the fake server.
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
const T1 = "2026-10-11T08:00:00.123Z";
const T2 = "2026-10-12T09:30:00.000Z";

function loadDevice(server) {
  const context = { app: {}, indexedDB: new FakeIndexedDB(), fetch: server.browser().fetch };
  vm.runInNewContext(AUTH_SOURCE, context, { filename: "auth.js" });
  vm.runInNewContext(STORE_SOURCE, context, { filename: "store.js" });
  return { store: context.app.store, auth: context.app.auth };
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function session(id, createdAt) {
  return {
    id,
    createdAt,
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 31,
    metrics: { words_per_minute: 150 },
    transcript: [],
  };
}

function idsOf(sessions) {
  return Array.from(sessions, (saved) => saved.id);
}

function logOutsSent(server) {
  return server.requests.filter((sent) => sent.path === "/api/auth/logout").length;
}

test("right after a log in to an account made again, the offer counts the takes here", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("phone-take-1", T1));
  await phone.store.save(session("phone-take-2", T2));
  await settle();
  const laptop = loadDevice(server);
  await laptop.auth.logIn(ANN, PASSWORD);
  await laptop.auth.deleteAccount();
  await laptop.auth.signUp(ANN, PASSWORD);
  await phone.auth.me();

  await phone.auth.logIn(ANN, PASSWORD);

  assert.deepEqual(plain(await phone.auth.guestImportOffer()), { count: 2 });
});

test("right after logging back in to the same account, nothing is offered", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("phone-take", T1));
  await settle();
  await phone.auth.logOut();

  await phone.auth.logIn(ANN, PASSWORD);

  assert.equal(await phone.auth.guestImportOffer(), null);
  assert.deepEqual(idsOf(await phone.store.list()), ["phone-take"]);
});

test("a log out the server could not record is not undone by a later me()", async () => {
  const server = new FakeAccountServer();
  const tablet = loadDevice(server);
  await tablet.auth.signUp(ANN, PASSWORD);
  await tablet.store.save(session("ann-take", T1));
  await settle();
  // Accounts are off for a moment: the log out signs the tablet out, but the session lives on.
  server.failNext("POST", "/api/auth/logout", 503);
  await tablet.auth.logOut();
  assert.equal(await tablet.auth.account(), null);
  assert.equal(logOutsSent(server), 1);

  // Accounts are back, and whoever uses the tablet next opens the account screen.
  assert.equal(await tablet.auth.me(), null);

  assert.equal(await tablet.auth.account(), null);
  assert.deepEqual(idsOf(await tablet.store.list()), [], "ann's take stays hidden");
  assert.equal(logOutsSent(server), 2, "the session the server kept is ended now");
  assert.equal([...server.tokens.values()].includes(ANN), false);
  assert.equal(await tablet.auth.me(), null);
});

test("logging in again after such a log out lets me() follow the cookie again", async () => {
  const server = new FakeAccountServer();
  const tablet = loadDevice(server);
  await tablet.auth.signUp(ANN, PASSWORD);
  server.failNext("POST", "/api/auth/logout", 503);
  await tablet.auth.logOut();

  await tablet.auth.logIn(ANN, PASSWORD);

  assert.equal(await tablet.auth.me(), ANN);
  assert.equal(await tablet.auth.account(), ANN);
});
