// Tests for whose takes and levels a device shows, and what becomes of them, when the server ends
// a session, an account is deleted or made again under the same email, or the server refuses a
// take (frontend/store.js with auth.js, docs/PLAN.md T49). A device can be shared: a guest's takes
// show to everyone who uses it, an account's only to that account. Each "device" is auth.js then
// store.js in a fresh vm realm over a fake IndexedDB and one browser of the fake server
// (fake-account-server.js), as in sync.test.js.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeIndexedDB } = require("./fake-indexeddb");
const { FakeAccountServer, serverMoment } = require("./fake-account-server");

const AUTH_SOURCE = fs.readFileSync(path.join(__dirname, "..", "auth.js"), "utf8");
const STORE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "store.js"), "utf8");

const ANN = "ann@example.com";
const BEN = "ben@example.com";
const PASSWORD = "correct horse battery staple";

const T1 = "2026-10-11T08:00:00.123Z";
const T2 = "2026-10-12T09:30:00.000Z";
const T3 = "2026-10-13T10:45:00.500Z";
const T4 = "2026-10-13T11:00:00.000Z";

// One device: auth.js then store.js in a fresh realm. fire(type) dispatches a window event.
function loadDevice(server) {
  const indexedDB = new FakeIndexedDB();
  const browser = server.browser();
  const listeners = {};
  const fakeWindow = {
    addEventListener: (type, handler) => {
      listeners[type] = [...(listeners[type] || []), handler];
    },
  };
  const context = { app: {}, indexedDB, fetch: browser.fetch, window: fakeWindow };
  vm.runInNewContext(AUTH_SOURCE, context, { filename: "auth.js" });
  vm.runInNewContext(STORE_SOURCE, context, { filename: "store.js" });
  return {
    store: context.app.store,
    auth: context.app.auth,
    indexedDB,
    fire: (type) => (listeners[type] || []).forEach((handler) => handler({ type })),
  };
}

// The fakes answer on microtasks, so one turn of the event loop lets every write run to its end.
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function session(id, createdAt, overrides = {}) {
  return {
    id,
    createdAt,
    passageId: "free-talk",
    passageTitle: "Your day",
    durationSeconds: 31,
    metrics: { words_per_minute: 150 },
    transcript: [{ text: "Hello", start: 0.4, end: 0.8 }],
    ...overrides,
  };
}

function wireTake(saved) {
  return {
    id: saved.id,
    created_at: serverMoment(saved.createdAt),
    report: {
      passageId: saved.passageId,
      passageTitle: saved.passageTitle,
      durationSeconds: saved.durationSeconds,
      metrics: saved.metrics,
    },
    transcript: saved.transcript,
  };
}

function idsOf(sessions) {
  return Array.from(sessions, (saved) => saved.id);
}

// Every session this device's IndexedDB holds, whoever it shows to, sorted by id.
function storedIds(device) {
  return [...device.indexedDB.store("sessions").records.keys()].sort();
}

function levelsOf(levels) {
  return plain(levels).map((level) => level.levelId + " " + level.clearedAt);
}

// The account is deleted from another device, as the laptop does here.
async function deleteFromAnotherDevice(server, email) {
  const laptop = loadDevice(server);
  await laptop.auth.logIn(email, PASSWORD);
  await laptop.auth.deleteAccount();
  return laptop;
}

// --- a session the server ends ----------------------------------------------------------------

test("a take recorded as the session ends still opens, and History keeps the account's takes", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.store.save(session("guest-before", T1));
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.auth.declineGuestImport();
  await phone.store.save(session("signed-in", T2));
  await settle();
  // The 30-day session runs out, or SESSION_SECRET changes: the cookie signs no one in.
  server.endSessions(ANN);

  await phone.store.save(session("just-recorded", T3));
  await settle();

  assert.equal(await phone.auth.account(), null, "the device is a guest's now");
  assert.equal((await phone.store.get("just-recorded")).id, "just-recorded");
  assert.deepEqual(idsOf(await phone.store.list()), ["just-recorded", "signed-in", "guest-before"]);
  const before = server.requests.length;
  await phone.store.list();
  await phone.store.get("signed-in");
  await phone.store.listClearedLevels();
  await settle();
  assert.deepEqual(server.requests.slice(before), [], "nothing is sent while signed out");
});

test("logging back in sends the take that met the 401, which stayed the account's", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("signed-in", T1));
  await settle();
  server.endSessions(ANN);
  await phone.store.save(session("just-recorded", T2));
  await settle();
  assert.deepEqual(idsOf(server.takesOf(ANN)), ["signed-in"]);

  await phone.auth.logIn(ANN, PASSWORD);
  await settle();

  assert.deepEqual(idsOf(server.takesOf(ANN)), ["just-recorded", "signed-in"]);
  assert.equal(await phone.auth.guestImportOffer(), null, "not a guest's take: nothing to offer");
});

test("a take saved after the session ended is offered to the account when it logs back in", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.store.save(session("guest-before", T1));
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.auth.importGuestTakes();
  await phone.store.save(session("signed-in", T2));
  await settle();
  server.endSessions(ANN);
  await phone.store.list();
  await phone.store.save(session("while-signed-out", T3));

  await phone.auth.logIn(ANN, PASSWORD);

  assert.deepEqual(plain(await phone.auth.guestImportOffer()), { count: 1 });
  assert.deepEqual(plain(await phone.auth.importGuestTakes()), {
    added: 1,
    keptHere: 0,
    waiting: false,
  });
  assert.equal(await phone.auth.guestImportOffer(), null);
  const laptop = loadDevice(server);
  await laptop.auth.logIn(ANN, PASSWORD);
  assert.deepEqual(idsOf(await laptop.store.list()), [
    "while-signed-out",
    "signed-in",
    "guest-before",
  ]);
});

test("an answer covers the takes it was asked about: declined ones are not offered again", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.store.save(session("declined", T1));
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.auth.declineGuestImport();
  await phone.auth.logOut();
  await phone.store.save(session("recorded-later", T2));

  await phone.auth.logIn(ANN, PASSWORD);

  assert.deepEqual(plain(await phone.auth.guestImportOffer()), { count: 1 });
  await phone.auth.importGuestTakes();
  assert.deepEqual(idsOf(server.takesOf(ANN)), ["recorded-later"]);
  assert.equal(await phone.auth.guestImportOffer(), null);
});

test("syncStatus names the account whose session ended and the takes recorded here", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("phone-take", T1));
  await settle();
  server.keep(ANN, wireTake(session("laptop-take", T2)));
  await phone.store.list();
  assert.deepEqual(plain(await phone.auth.syncStatus()), {
    endedSession: null,
    takesNotKept: 0,
  });

  await deleteFromAnotherDevice(server, ANN);
  // The phone learns of it as a 401 on its next list: its takes still show, a guest's device.
  assert.deepEqual(idsOf(await phone.store.list()), ["laptop-take", "phone-take"]);

  assert.deepEqual(plain(await phone.auth.syncStatus()), {
    endedSession: { email: ANN, takesHere: 1 },
    takesNotKept: 0,
  });
  await assert.rejects(phone.auth.logIn(ANN, PASSWORD), { kind: "wrong" });
});

test("keeping an ended account's takes here makes the ones recorded here the device's own", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("phone-take", T1));
  await settle();
  server.keep(ANN, wireTake(session("laptop-take", T2)));
  await phone.store.list();
  await deleteFromAnotherDevice(server, ANN);
  await phone.store.list();

  await phone.auth.keepEndedTakesHere();

  assert.equal((await phone.auth.syncStatus()).endedSession, null);
  assert.deepEqual(idsOf(await phone.store.list()), ["phone-take"]);
  assert.deepEqual(storedIds(phone), ["phone-take"], "the copy from the laptop is gone");
  // The take is this device's own now: any account signing in here is offered it.
  await phone.auth.signUp(BEN, PASSWORD);
  assert.deepEqual(plain(await phone.auth.guestImportOffer()), { count: 1 });
});

test("another account signing in hides the ended account's takes and is never offered them", async () => {
  const server = new FakeAccountServer();
  const tablet = loadDevice(server);
  await tablet.store.save(session("guest-take", T1));
  await tablet.auth.signUp(ANN, PASSWORD);
  await tablet.auth.declineGuestImport();
  await tablet.store.save(session("ann-take", T2));
  await settle();
  server.endSessions(ANN);
  assert.deepEqual(idsOf(await tablet.store.list()), ["ann-take", "guest-take"]);

  await tablet.auth.signUp(BEN, PASSWORD);

  assert.deepEqual(idsOf(await tablet.store.list()), ["guest-take"]);
  assert.deepEqual(plain(await tablet.auth.guestImportOffer()), { count: 1 });
  await tablet.auth.importGuestTakes();
  assert.deepEqual(idsOf(server.takesOf(BEN)), ["guest-take"]);
  await tablet.auth.logOut();
  assert.deepEqual(idsOf(await tablet.store.list()), [], "ann's session is not the one that ended");
  assert.equal((await tablet.auth.syncStatus()).endedSession, null);
  await tablet.auth.logIn(ANN, PASSWORD);
  assert.deepEqual(idsOf(await tablet.store.list()), ["ann-take"]);
});

test("a guest deleting an ended account's take deletes it from the account on its next log in", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("take-1", T1));
  await phone.store.save(session("take-2", T2));
  await settle();
  server.endSessions(ANN);
  await phone.store.list();
  const before = server.requests.length;

  await phone.store.remove("take-1");
  await settle();

  assert.deepEqual(server.requests.slice(before), [], "a guest sends nothing");
  assert.deepEqual(idsOf(await phone.store.list()), ["take-2"]);
  await phone.auth.logIn(ANN, PASSWORD);
  await settle();
  assert.deepEqual(idsOf(server.takesOf(ANN)), ["take-2"]);
  assert.deepEqual(idsOf(await phone.store.list()), ["take-2"]);
});

test("a 401 met by me() or by deleting the account ends the session the same way", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("take-1", T1));
  await settle();
  server.endSessions(ANN);

  assert.equal(await phone.auth.me(), null);

  assert.equal((await phone.auth.syncStatus()).endedSession.email, ANN);
  assert.deepEqual(idsOf(await phone.store.list()), ["take-1"]);

  const laptop = loadDevice(server);
  await laptop.auth.signUp(BEN, PASSWORD);
  await laptop.store.save(session("ben-take", T2));
  await settle();
  server.endSessions(BEN);
  await assert.rejects(laptop.auth.deleteAccount(), { kind: "signed_out" });
  assert.equal((await laptop.auth.syncStatus()).endedSession.email, BEN);
  assert.deepEqual(idsOf(await laptop.store.list()), ["ben-take"]);
});

// --- an account made again under the same email --------------------------------------------------

test("logging in to an account deleted and made again elsewhere keeps the takes recorded here", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("phone-take-1", T1));
  await phone.store.save(session("phone-take-2", T2));
  await settle();
  const laptop = await deleteFromAnotherDevice(server, ANN);
  await laptop.auth.signUp(ANN, PASSWORD);
  assert.equal(await phone.auth.me(), null);

  await phone.auth.logIn(ANN, PASSWORD);

  assert.deepEqual(idsOf(await phone.store.list()), ["phone-take-2", "phone-take-1"]);
  assert.deepEqual(storedIds(phone), ["phone-take-1", "phone-take-2"]);
  // They are this device's own now, so the new account is offered them.
  assert.deepEqual(plain(await phone.auth.guestImportOffer()), { count: 2 });
  await phone.auth.importGuestTakes();
  assert.deepEqual(idsOf(server.takesOf(ANN)), ["phone-take-2", "phone-take-1"]);
});

test("the laptop that imported its guest takes keeps them when the account is made again", async () => {
  const server = new FakeAccountServer();
  const laptop = loadDevice(server);
  await laptop.store.save(session("laptop-guest", T1));
  await laptop.auth.signUp(ANN, PASSWORD);
  await laptop.auth.importGuestTakes();
  await laptop.store.save(session("laptop-signed-in", T2));
  await settle();
  const phone = await deleteFromAnotherDevice(server, ANN);
  await phone.auth.signUp(ANN, PASSWORD);
  await laptop.store.list();

  await laptop.auth.logIn(ANN, PASSWORD);

  assert.deepEqual(idsOf(await laptop.store.list()), ["laptop-signed-in", "laptop-guest"]);
  assert.deepEqual(storedIds(laptop), ["laptop-guest", "laptop-signed-in"]);
});

test("the first list after a log in drops a missing copy from elsewhere, not one recorded here", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("phone-take", T1));
  await settle();
  server.keep(ANN, wireTake(session("laptop-take", T2)));
  await phone.store.list();
  await phone.auth.logOut();
  // Meanwhile the account behind the email lost every take, as one made again would.
  server.users.get(ANN).takes.clear();

  await phone.auth.logIn(ANN, PASSWORD);

  assert.deepEqual(idsOf(await phone.store.list()), ["phone-take"]);
  assert.deepEqual(storedIds(phone), ["phone-take"]);
});

test("after that first list, a take deleted on another device goes from this one as before", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("take-1", T1));
  await phone.store.save(session("take-2", T2));
  await settle();
  await phone.auth.logOut();
  await phone.auth.logIn(ANN, PASSWORD);
  assert.deepEqual(idsOf(await phone.store.list()), ["take-2", "take-1"]);

  server.users.get(ANN).takes.delete("take-1");

  assert.deepEqual(idsOf(await phone.store.list()), ["take-2"]);
  assert.deepEqual(storedIds(phone), ["take-2"]);
});

// --- a take the server refuses ---------------------------------------------------------------------

test("a take the server refuses stays the account's: no guest or other account sees it", async () => {
  const server = new FakeAccountServer();
  const tablet = loadDevice(server);
  await tablet.auth.signUp(ANN, PASSWORD);
  // The account is full: backend/sessions_api.py answers 409.
  server.failNext("POST", "/api/sessions", 409);
  await tablet.store.save(session("ann-private", T1));
  await settle();

  assert.deepEqual(idsOf(await tablet.store.list()), ["ann-private"]);
  assert.deepEqual(plain(await tablet.auth.syncStatus()), {
    endedSession: null,
    takesNotKept: 1,
  });
  await tablet.auth.logOut();
  assert.deepEqual(idsOf(await tablet.store.list()), []);
  assert.equal(await tablet.store.get("ann-private"), undefined);
  await tablet.auth.signUp(BEN, PASSWORD);
  assert.deepEqual(idsOf(await tablet.store.list()), []);
  assert.equal(await tablet.auth.guestImportOffer(), null);
  await tablet.auth.importGuestTakes();
  assert.deepEqual(server.takesOf(BEN), []);
  await tablet.auth.logOut();
  // Back to ann: a list that leaves the take out never drops it, as it never reached the server.
  await tablet.auth.logIn(ANN, PASSWORD);
  assert.deepEqual(idsOf(await tablet.store.list()), ["ann-private"]);
  assert.deepEqual(idsOf(await tablet.store.list()), ["ann-private"]);
});

test("a take no server could keep stays the account's too, and never reaches a guest", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.save(session("no-words", T1, { transcript: undefined }));
  await settle();

  assert.deepEqual(requestsTo(server, "POST", "/api/sessions"), []);
  assert.equal((await phone.auth.syncStatus()).takesNotKept, 1);
  await phone.auth.logOut();
  assert.deepEqual(idsOf(await phone.store.list()), []);
});

test("deleting the account keeps a refused take on the device, as the device's own", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.auth.signUp(ANN, PASSWORD);
  server.failNext("POST", "/api/sessions", 409);
  await phone.store.save(session("refused", T1));
  await settle();

  await phone.auth.deleteAccount();

  assert.deepEqual(idsOf(await phone.store.list()), ["refused"]);
});

// --- deleting the account ----------------------------------------------------------------------

test("deleting the account keeps the takes recorded here and removes copies from elsewhere", async () => {
  const server = new FakeAccountServer();
  const tablet = loadDevice(server);
  await tablet.store.save(session("guest-take", T1));
  await tablet.auth.signUp(ANN, PASSWORD);
  await tablet.auth.importGuestTakes();
  await tablet.store.save(session("account-take", T2));
  server.keep(ANN, wireTake(session("from-phone", T3)));
  assert.deepEqual(idsOf(await tablet.store.list()), ["from-phone", "account-take", "guest-take"]);

  await tablet.auth.deleteAccount();

  assert.deepEqual(idsOf(await tablet.store.list()), ["account-take", "guest-take"]);
  assert.deepEqual(storedIds(tablet), ["account-take", "guest-take"]);
  await tablet.auth.signUp(BEN, PASSWORD);
  assert.deepEqual(plain(await tablet.auth.guestImportOffer()), { count: 2 });
  await tablet.auth.importGuestTakes();
  assert.deepEqual(idsOf(server.takesOf(BEN)), ["account-take", "guest-take"]);
});

// --- cleared path levels -------------------------------------------------------------------------

test("a level an account clears shows to it alone, and another account keeps its own date", async () => {
  const server = new FakeAccountServer();
  const tablet = loadDevice(server);
  await tablet.auth.signUp(ANN, PASSWORD);
  await tablet.store.markLevelCleared("fillers-1", T1);
  await settle();
  await tablet.auth.logOut();

  assert.deepEqual(levelsOf(await tablet.store.listClearedLevels()), []);
  await tablet.auth.signUp(BEN, PASSWORD);
  assert.deepEqual(levelsOf(await tablet.store.listClearedLevels()), []);
  const kept = await tablet.store.markLevelCleared("fillers-1", T3);
  await settle();

  assert.deepEqual(plain(kept), { levelId: "fillers-1", clearedAt: T3 });
  assert.equal(server.users.get(BEN).levels.get("fillers-1"), serverMoment(T3));
  assert.equal(server.users.get(ANN).levels.get("fillers-1"), serverMoment(T1));
  await tablet.auth.logOut();
  await tablet.auth.logIn(ANN, PASSWORD);
  server.online = false;
  assert.deepEqual(levelsOf(await tablet.store.listClearedLevels()), ["fillers-1 " + T1]);
});

test("a guest's levels show to every account, and an ended account's levels to the guest", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.store.markLevelCleared("pace-1", T1);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.markLevelCleared("fillers-1", T2);
  await settle();

  assert.deepEqual(levelsOf(await phone.store.listClearedLevels()), [
    "pace-1 " + T1,
    "fillers-1 " + T2,
  ]);
  assert.deepEqual([...server.users.get(ANN).levels.keys()], ["fillers-1"]);
  server.endSessions(ANN);
  assert.deepEqual(levelsOf(await phone.store.listClearedLevels()), [
    "pace-1 " + T1,
    "fillers-1 " + T2,
  ]);
  assert.equal(await phone.auth.account(), null);
});

test("deleting the account keeps the levels it cleared on this device, as the device's own", async () => {
  const server = new FakeAccountServer();
  const phone = loadDevice(server);
  await phone.store.markLevelCleared("fillers-1", T4);
  await phone.auth.signUp(ANN, PASSWORD);
  await phone.store.markLevelCleared("fillers-1", T2);
  await phone.store.markLevelCleared("pace-1", T3);
  await settle();

  await phone.auth.deleteAccount();

  assert.deepEqual(levelsOf(await phone.store.listClearedLevels()), [
    "fillers-1 " + T2,
    "pace-1 " + T3,
  ]);
});

function requestsTo(server, method, pathname) {
  return server.requests.filter((sent) => sent.method === method && sent.path === pathname);
}
