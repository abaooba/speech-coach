// Tests for logging back in to an account after some of its takes were deleted on another device
// (frontend/store.js with auth.js, docs/PLAN.md T49). The first list after a log in may come from
// an account deleted and made again under the same email; the takes recorded here are then this
// device's own. A list that still holds one of the takes recorded here comes from the same
// account, though, so a take recorded here that it leaves out was deleted on another device: it
// goes from this one too, and never comes back as an offer or as a guest's take. Each "device" is
// auth.js then store.js in a fresh vm realm over a fake IndexedDB and one browser of the fake
// server (fake-account-server.js), as in sync_ownership.test.js.
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
const T3 = "2026-10-13T10:45:00.500Z";

// One device: auth.js then store.js in a fresh realm, with its IndexedDB for storedIds.
function loadDevice(server) {
  const indexedDB = new FakeIndexedDB();
  const context = { app: {}, indexedDB, fetch: server.browser().fetch };
  vm.runInNewContext(AUTH_SOURCE, context, { filename: "auth.js" });
  vm.runInNewContext(STORE_SOURCE, context, { filename: "store.js" });
  return { store: context.app.store, auth: context.app.auth, indexedDB };
}

// The fakes answer on microtasks, so one turn of the event loop lets every write run to its end.
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
    transcript: [{ text: "Hello", start: 0.4, end: 0.8 }],
  };
}

function idsOf(sessions) {
  return Array.from(sessions, (saved) => saved.id);
}

// Every session this device's IndexedDB holds, whoever it shows to, sorted by id.
function storedIds(device) {
  return [...device.indexedDB.store("sessions").records.keys()].sort();
}

// The phone, signed up as ann, records private-take and kept-take, then signs out with
// `signOut(phone)`. On the laptop ann deletes private-take. Resolves the phone, signed out.
async function deletePrivateTakeOnLaptop(server, signOut) {
  const phone = loadDevice(server);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("private-take", T1));
  await phone.store.save(session("kept-take", T2));
  await settle();
  await signOut(phone);
  assert.equal(await phone.auth.account(), null);
  const laptop = loadDevice(server);
  await laptop.auth.logIn(ANN, PASSWORD);
  assert.deepEqual(idsOf(await laptop.store.list()), ["kept-take", "private-take"]);
  await laptop.store.remove("private-take");
  await settle();
  assert.deepEqual(idsOf(server.takesOf(ANN)), ["kept-take"]);
  return phone;
}

function logOut(phone) {
  return phone.auth.logOut();
}

// The 30-day session runs out while the phone is away; me() finds it ended.
async function endSession(phone, server) {
  server.endSessions(ANN);
  assert.equal(await phone.auth.me(), null);
}

// --- a take deleted on another device ------------------------------------------------------------

test("a take deleted elsewhere while this device was logged out stays deleted here", async () => {
  const server = new FakeAccountServer();
  const phone = await deletePrivateTakeOnLaptop(server, logOut);

  await phone.auth.logIn(ANN, PASSWORD);

  assert.deepEqual(idsOf(await phone.store.list()), ["kept-take"]);
  assert.equal(await phone.auth.guestImportOffer(), null, "the deleted take is not offered");
  assert.equal(await phone.store.get("private-take"), undefined);
  assert.deepEqual(storedIds(phone), ["kept-take"]);
  await phone.auth.logOut();
  assert.deepEqual(idsOf(await phone.store.list()), [], "a guest never sees the deleted take");
  assert.equal(await phone.store.get("private-take"), undefined);
  assert.deepEqual(idsOf(server.takesOf(ANN)), ["kept-take"], "nothing sent it back");
});

test("right after that log in, the offer counts a guest take but not the deleted one", async () => {
  const server = new FakeAccountServer();
  const phone = await deletePrivateTakeOnLaptop(server, logOut);
  await phone.store.save(session("guest-take", T3));

  await phone.auth.logIn(ANN, PASSWORD);

  // The account screen asks for the offer first, before any list.
  assert.deepEqual(plain(await phone.auth.guestImportOffer()), { count: 1 });
  assert.deepEqual(plain(await phone.auth.importGuestTakes()), {
    added: 1,
    keptHere: 0,
    waiting: false,
  });
  assert.deepEqual(idsOf(server.takesOf(ANN)), ["guest-take", "kept-take"]);
  assert.deepEqual(idsOf(await phone.store.list()), ["guest-take", "kept-take"]);
  assert.deepEqual(storedIds(phone), ["guest-take", "kept-take"]);
});

test("a take deleted elsewhere while this device's session had ended stays deleted", async () => {
  const server = new FakeAccountServer();
  const phone = await deletePrivateTakeOnLaptop(server, (device) => endSession(device, server));

  await phone.auth.logIn(ANN, PASSWORD);

  assert.equal(await phone.auth.guestImportOffer(), null);
  assert.deepEqual(idsOf(await phone.store.list()), ["kept-take"]);
  assert.deepEqual(storedIds(phone), ["kept-take"]);
  await phone.auth.logOut();
  assert.deepEqual(idsOf(await phone.store.list()), []);
});

// --- an account made again under the same email still gives the takes back -----------------------

test("an account made again still leaves the takes recorded here to this device", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("phone-take-1", T1));
  await phone.store.save(session("phone-take-2", T2));
  await settle();
  await phone.auth.logOut();
  const laptop = loadDevice(server);
  await laptop.auth.logIn(ANN, PASSWORD);
  await laptop.auth.deleteAccount();
  await laptop.auth.signUp(ANN, PASSWORD);

  await phone.auth.logIn(ANN, PASSWORD);

  assert.deepEqual(plain(await phone.auth.guestImportOffer()), { count: 2 });
  assert.deepEqual(idsOf(await phone.store.list()), ["phone-take-2", "phone-take-1"]);
  await phone.auth.logOut();
  // They are this device's own, so a guest sees them as well.
  assert.deepEqual(idsOf(await phone.store.list()), ["phone-take-2", "phone-take-1"]);
});

test("a copy from another device in the account made again does not drop a take here", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("phone-take", T1));
  await settle();
  const laptop = loadDevice(server);
  await laptop.auth.logIn(ANN, PASSWORD);
  await laptop.store.save(session("laptop-take", T2));
  await settle();
  assert.deepEqual(idsOf(await phone.store.list()), ["laptop-take", "phone-take"]);
  await phone.auth.logOut();
  // Ann deletes the account on the laptop, makes it again, and adds the laptop's takes to it:
  // the new account holds laptop-take, of which the phone keeps a copy.
  await laptop.auth.deleteAccount();
  await laptop.auth.signUp(ANN, PASSWORD);
  assert.deepEqual(plain(await laptop.auth.guestImportOffer()), { count: 1 });
  await laptop.auth.importGuestTakes();
  assert.deepEqual(idsOf(server.takesOf(ANN)), ["laptop-take"]);

  await phone.auth.logIn(ANN, PASSWORD);

  assert.deepEqual(idsOf(await phone.store.list()), ["laptop-take", "phone-take"]);
  assert.deepEqual(storedIds(phone), ["laptop-take", "phone-take"]);
  assert.deepEqual(plain(await phone.auth.guestImportOffer()), { count: 1 });
  await phone.auth.importGuestTakes();
  assert.deepEqual(idsOf(server.takesOf(ANN)), ["laptop-take", "phone-take"]);
});
