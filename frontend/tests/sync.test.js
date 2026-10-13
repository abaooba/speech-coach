// Tests for the account sync in frontend/store.js (docs/PLAN.md T49). store.js keeps its eight
// functions; for a speaker signed in through auth.js it also keeps takes and cleared levels on
// the server. Each "device" here is auth.js then store.js loaded into a fresh vm realm, as
// index.html loads them, over a fake IndexedDB and one browser of a fake server that answers as
// backend/auth.py and backend/sessions_api.py do (fake-account-server.js).
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
const JSON_TYPE = "application/json";

// One device. `options.indexedDB` reopens a device's storage (a reload); `options.browser` keeps
// its cookie jar. fire(type) dispatches a window event ("online", "load") to store.js.
function loadDevice(server, options = {}) {
  const indexedDB = options.indexedDB || new FakeIndexedDB();
  const browser = options.browser || server.browser();
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
    app: context.app,
    store: context.app.store,
    auth: context.app.auth,
    indexedDB,
    browser,
    fire: (type) => (listeners[type] || []).forEach((handler) => handler({ type })),
  };
}

// The fakes answer on microtasks only, so one turn of the event loop lets every queued write,
// reply and IndexedDB request run to its end.
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Objects built inside a vm realm compare by value after a JSON round trip.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// A session as store.js keeps it (its seven fields), never with audio.
function session(id, createdAt, overrides = {}) {
  return {
    id,
    createdAt,
    passageId: "rebuttal-uniforms",
    passageTitle: "Rebuttal: school uniforms",
    durationSeconds: 42.9,
    metrics: { words_per_minute: 159.5, fillers: { uh: 2 }, pauses: [[12.4, 1.8]] },
    transcript: [{ text: "My", start: 1.395, end: 1.6 }],
    ...overrides,
  };
}

// The same session as the server keeps and lists it (backend/sessions_api.py).
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

const T1 = "2026-10-11T08:00:00.123Z";
const T2 = "2026-10-12T09:30:00.000Z";
const T3 = "2026-10-13T10:45:00.500Z";
const T4 = "2026-10-13T11:00:00.000Z";

// The ids of `sessions`, in an array of this realm, so deepEqual compares them by value.
function idsOf(sessions) {
  return Array.from(sessions, (saved) => saved.id);
}

function requestsTo(server, method, pathname) {
  return server.requests.filter((sent) => sent.method === method && sent.path === pathname);
}

// A device signed up as `email`, with nothing saved yet.
async function signedUpDevice(server, email = ANN) {
  const device = loadDevice(server);
  await device.auth.signUp(email, PASSWORD);
  await settle();
  return device;
}

// Puts sessions straight into a device's IndexedDB, as a guest's earlier visits left them.
async function seedGuestSessions(device, sessions) {
  await device.store.list();
  const store = device.indexedDB.store("sessions");
  sessions.forEach((saved) => store.records.set(saved.id, structuredClone(saved)));
}

// --- guests ----------------------------------------------------------------------------------

test("a guest's takes and levels stay on the device: nothing reaches the network", async () => {
  const server = new FakeAccountServer();
  const device = loadDevice(server);

  const id = await device.store.save(session("guest-take", T1));
  assert.deepEqual(idsOf(await device.store.list()), ["guest-take"]);
  assert.equal((await device.store.get(id)).passageTitle, "Rebuttal: school uniforms");
  await device.store.markLevelCleared("fillers-1", T2);
  assert.deepEqual(plain(await device.store.listClearedLevels()), [
    { levelId: "fillers-1", clearedAt: T2 },
  ]);
  await device.store.remove(id);
  device.fire("load");
  device.fire("online");
  await settle();

  assert.deepEqual(server.requests, []);
  assert.deepEqual(plain(await device.store.list()), []);
});

test("store.js still assigns exactly app.store's eight functions beside auth.js", () => {
  const device = loadDevice(new FakeAccountServer());
  assert.deepEqual(Object.keys(device.app).sort(), ["auth", "store"]);
  assert.deepEqual(Object.keys(device.store).sort(), [
    "get",
    "getFlag",
    "list",
    "listClearedLevels",
    "markLevelCleared",
    "remove",
    "save",
    "setFlag",
  ]);
});

// --- writing through -------------------------------------------------------------------------

test("a signed-in save keeps the take on the device and sends it to the server", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  const saved = session("take-1", T1);

  const id = await device.store.save({ ...saved });
  await settle();

  assert.equal(id, "take-1");
  assert.deepEqual(plain(device.indexedDB.store("sessions").records.get("take-1")), saved);
  const sent = requestsTo(server, "POST", "/api/sessions");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body, {
    id: "take-1",
    created_at: T1,
    report: {
      passageId: saved.passageId,
      passageTitle: saved.passageTitle,
      durationSeconds: saved.durationSeconds,
      metrics: saved.metrics,
    },
    transcript: saved.transcript,
  });
  assert.deepEqual(server.takesOf(ANN), [wireTake(saved)]);
});

test("a take saved on one device lists on another exactly as it was saved", async () => {
  const server = new FakeAccountServer();
  const phone = await signedUpDevice(server);
  const first = session("take-1", T1);
  const second = session("take-2", T2, { passageTitle: "Your day", durationSeconds: 61 });
  await phone.store.save({ ...first });
  await phone.store.save({ ...second });
  await settle();

  const laptop = loadDevice(server);
  await laptop.auth.logIn(ANN, PASSWORD);
  const listed = await laptop.store.list();

  // The server gives created_at back as "...:00Z" or with microseconds; the device reads it back
  // as toISOString wrote it, so every field round-trips unchanged.
  assert.deepEqual(plain(listed), [second, first]);
  assert.deepEqual(plain(await laptop.store.get("take-1")), first);
  assert.deepEqual(plain(laptop.indexedDB.store("sessions").records.get("take-2")), second);
});

test("a save made offline waits in the queue and goes up once the device is online", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  server.online = false;

  await device.store.save(session("offline-take", T1));
  await settle();
  assert.deepEqual(server.takesOf(ANN), []);
  assert.deepEqual(idsOf(await device.store.list()), ["offline-take"]);

  server.online = true;
  device.fire("online");
  await settle();
  assert.deepEqual(idsOf(server.takesOf(ANN)), ["offline-take"]);

  const before = server.requests.length;
  device.fire("online");
  await settle();
  const again = server.requests.slice(before).filter((sent) => sent.method !== "GET");
  assert.deepEqual(again, [], "a write the server confirmed is not sent twice");
});

test("a write still queued when the app closes goes up on its next load", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  await device.store.save(session("kept", T1));
  await settle();
  server.online = false;
  await device.store.save(session("queued", T2));
  await device.store.remove("kept");
  await device.store.markLevelCleared("fillers-1", T3);
  await settle();

  server.online = true;
  const reopened = loadDevice(server, { indexedDB: device.indexedDB, browser: device.browser });
  reopened.fire("load");
  await settle();

  assert.deepEqual(idsOf(server.takesOf(ANN)), ["queued"]);
  assert.deepEqual(server.users.get(ANN).levels.get("fillers-1"), serverMoment(T3));
});

test("deleting a take while signed in deletes it on the server too", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  await device.store.save(session("take-1", T1));
  await settle();

  await device.store.remove("take-1");
  await settle();

  assert.deepEqual(server.takesOf(ANN), []);
  const deletes = requestsTo(server, "DELETE", "/api/sessions/take-1");
  assert.equal(deletes.length, 1);
  assert.deepEqual(plain(await device.store.list()), []);
});

// A promise held open until its release() is called, to hold one request or reply back.
function held() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("a take deleted here is not listed while its DELETE is on the way", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  await device.store.save(session("take-1", T1));
  await device.store.save(session("take-2", T2));
  await settle();
  const deleting = held();
  server.beforeAnswer = (sent) => (sent.method === "DELETE" ? deleting.promise : null);

  await device.store.remove("take-1");

  // The server still lists the take, but the device knows it deleted it.
  assert.deepEqual(idsOf(await device.store.list()), ["take-2"]);
  assert.equal(await device.store.get("take-1"), undefined);
  server.beforeAnswer = null;
  deleting.release();
  await settle();
  assert.deepEqual(idsOf(server.takesOf(ANN)), ["take-2"]);
  assert.deepEqual(idsOf(await device.store.list()), ["take-2"]);
});

test("a list the server sent before a DELETE landed does not bring the take back", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  await device.store.save(session("take-1", T1));
  await device.store.save(session("take-2", T2));
  await settle();
  // The server answers the list at once, with both takes, but the reply arrives late.
  const listReply = held();
  server.beforeReply = (sent) => (sent.method === "GET" ? listReply.promise : null);
  const listing = device.store.list();
  await settle();

  // Meanwhile the take is deleted, here and on the server.
  await device.store.remove("take-1");
  await settle();
  assert.deepEqual(idsOf(server.takesOf(ANN)), ["take-2"]);
  server.beforeReply = null;
  listReply.release();

  assert.deepEqual(idsOf(await listing), ["take-2"]);
  assert.equal(device.indexedDB.store("sessions").records.has("take-1"), false);
  assert.deepEqual(idsOf(await device.store.list()), ["take-2"]);
});

test("a take that goes up while a list is on its way is not taken for one deleted", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  server.online = false;
  await device.store.save(session("new-take", T1));
  await settle();
  server.online = true;
  // The list is answered before the queued save reaches the server, and arrives after it.
  const listReply = held();
  server.beforeReply = (sent) => (sent.method === "GET" ? listReply.promise : null);
  const listing = device.store.list();
  await settle();
  assert.deepEqual(idsOf(server.takesOf(ANN)), ["new-take"], "the list sent the queued save");
  server.beforeReply = null;
  listReply.release();

  assert.deepEqual(idsOf(await listing), ["new-take"]);
  assert.equal(device.indexedDB.store("sessions").records.has("new-take"), true);
  assert.deepEqual(idsOf(await device.store.list()), ["new-take"]);
});

test("a take the server refuses for good stays on the device and leaves the queue", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  server.failNext("POST", "/api/sessions", 422);

  await device.store.save(session("refused", T1));
  await settle();

  assert.deepEqual(server.takesOf(ANN), []);
  assert.deepEqual(idsOf(await device.store.list()), ["refused"]);
  const before = server.requests.length;
  device.fire("online");
  await settle();
  const retried = server.requests.slice(before).filter((sent) => sent.method === "POST");
  assert.deepEqual(retried, [], "a refused take is not sent again");
  // It stays the account's, on this device only: signing out hides it from a guest.
  await device.auth.logOut();
  assert.deepEqual(idsOf(await device.store.list()), []);
});

test("a take no server could keep is never sent, and stays on the device", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  // The server keeps ids of letters, digits, "-" and "_" only.
  await device.store.save(session("take.with.dots", T1));
  await settle();

  assert.deepEqual(requestsTo(server, "POST", "/api/sessions"), []);
  assert.deepEqual(idsOf(await device.store.list()), ["take.with.dots"]);
});

// --- reading ---------------------------------------------------------------------------------

test("list merges the server's takes with this device's, each once, newest first", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  await device.store.save(session("synced", T1));
  await settle();
  server.keep(ANN, wireTake(session("from-laptop", T2)));
  // A save the server has not taken yet: it answers 500 once, so the take waits in the queue.
  server.failNext("POST", "/api/sessions", 500);
  await device.store.save(session("not-sent-yet", T3));
  await settle();
  assert.deepEqual(idsOf(server.takesOf(ANN)), ["from-laptop", "synced"]);

  const listed = await device.store.list();

  assert.deepEqual(idsOf(listed), ["not-sent-yet", "from-laptop", "synced"]);
  assert.deepEqual(plain(listed[1]), session("from-laptop", T2));
});

test("list drops a take another device deleted, and keeps one still waiting to go up", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  await device.store.save(session("deleted-elsewhere", T1));
  await device.store.save(session("kept", T2));
  await settle();
  server.users.get(ANN).takes.delete("deleted-elsewhere");
  server.online = false;
  await device.store.save(session("waiting", T3));
  await settle();
  server.online = true;

  assert.deepEqual(idsOf(await device.store.list()), ["waiting", "kept"]);
  assert.equal(device.indexedDB.store("sessions").records.has("deleted-elsewhere"), false);
});

test("with no reply from the server, list and get read this device's copy", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  await device.store.save(session("take-1", T1));
  server.keep(ANN, wireTake(session("take-2", T2)));
  await device.store.list();
  server.online = false;

  assert.deepEqual(idsOf(await device.store.list()), ["take-2", "take-1"]);
  assert.deepEqual(plain(await device.store.get("take-2")), session("take-2", T2));
  assert.equal(await device.store.get("never-saved"), undefined);
});

test("get finds a take only the server has, and caches it", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  server.keep(ANN, wireTake(session("from-laptop", T2)));

  assert.deepEqual(plain(await device.store.get("from-laptop")), session("from-laptop", T2));
  server.online = false;
  assert.deepEqual(plain(await device.store.get("from-laptop")), session("from-laptop", T2));
});

test("levels cleared while signed in go to the server and come back merged", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  server.users.get(ANN).levels.set("pace-1", serverMoment(T1));

  const record = await device.store.markLevelCleared("fillers-1", T2);
  await settle();

  assert.deepEqual(plain(record), { levelId: "fillers-1", clearedAt: T2 });
  const posts = requestsTo(server, "POST", "/api/progress");
  assert.deepEqual(posts.at(-1).body, {
    path_progress: [{ level_id: "fillers-1", cleared_at: T2 }],
  });
  assert.deepEqual(plain(await device.store.listClearedLevels()), [
    { levelId: "pace-1", clearedAt: T1 },
    { levelId: "fillers-1", clearedAt: T2 },
  ]);
  server.online = false;
  assert.deepEqual(plain(await device.store.listClearedLevels()), [
    { levelId: "fillers-1", clearedAt: T2 },
  ]);
});

// --- importing a guest's takes ---------------------------------------------------------------

test("signing in offers this device's guest takes, and sends nothing until asked", async () => {
  const server = new FakeAccountServer();
  const device = loadDevice(server);
  await device.store.save(session("guest-1", T1));
  await device.store.save(session("guest-2", T2));

  await device.auth.signUp(ANN, PASSWORD);
  await settle();

  assert.deepEqual(plain(await device.auth.guestImportOffer()), { count: 2 });
  assert.deepEqual(requestsTo(server, "POST", "/api/sessions/import"), []);
  assert.deepEqual(requestsTo(server, "POST", "/api/sessions"), []);
  assert.deepEqual(server.takesOf(ANN), []);
  // Not imported, the guest takes still show on this device.
  assert.deepEqual(idsOf(await device.store.list()), ["guest-2", "guest-1"]);
});

test("adding the guest takes imports them, and the offer is not made again", async () => {
  const server = new FakeAccountServer();
  const device = loadDevice(server);
  await device.store.save(session("guest-1", T1));
  await device.store.save(session("guest-2", T2));
  await device.auth.signUp(ANN, PASSWORD);

  const result = await device.auth.importGuestTakes();

  assert.deepEqual(plain(result), { added: 2, keptHere: 0, waiting: false });
  assert.deepEqual(idsOf(server.takesOf(ANN)), ["guest-2", "guest-1"]);
  assert.deepEqual(server.takesOf(ANN)[1], wireTake(session("guest-1", T1)));
  assert.equal(await device.auth.guestImportOffer(), null);
});

test("the import goes in batches within the server's 500-take limit", async () => {
  const server = new FakeAccountServer();
  const device = loadDevice(server);
  const guests = Array.from({ length: 501 }, (_, index) =>
    session("guest-" + String(index).padStart(3, "0"), T1, { transcript: [] }),
  );
  await seedGuestSessions(device, guests);
  await device.auth.signUp(ANN, PASSWORD);

  const result = await device.auth.importGuestTakes();

  const batches = requestsTo(server, "POST", "/api/sessions/import");
  assert.deepEqual(
    batches.map((sent) => sent.body.sessions.length),
    [500, 1],
  );
  assert.deepEqual(plain(result), { added: 501, keptHere: 0, waiting: false });
  assert.equal(server.takesOf(ANN).length, 501);
});

test("the import goes in batches within the server's 2,000,000-byte limit", async () => {
  const server = new FakeAccountServer();
  const device = loadDevice(server);
  // Three takes of about 700 KB each: two fit under the limit together, three do not.
  const words = Array.from({ length: 14000 }, (_, index) => ({
    text: "word" + index + "é",
    start: index,
    end: index + 0.5,
  }));
  const big = ["big-1", "big-2", "big-3"].map((id, index) =>
    session(id, [T1, T2, T3][index], { transcript: words }),
  );
  await seedGuestSessions(device, big);
  await device.auth.signUp(ANN, PASSWORD);

  const result = await device.auth.importGuestTakes();

  const batches = requestsTo(server, "POST", "/api/sessions/import");
  assert.deepEqual(
    batches.map((sent) => sent.body.sessions.length),
    [2, 1],
  );
  assert.deepEqual(plain(result), { added: 3, keptHere: 0, waiting: false });
  assert.equal(server.takesOf(ANN).length, 3);
});

test("an import cut off part way finishes later, keeping one copy of every take", async () => {
  const server = new FakeAccountServer();
  const device = loadDevice(server);
  const guests = Array.from({ length: 502 }, (_, index) =>
    session("guest-" + String(index).padStart(3, "0"), T1, { transcript: [] }),
  );
  await seedGuestSessions(device, guests);
  await device.auth.signUp(ANN, PASSWORD);
  // The account already has one of them, as if imported on an earlier try.
  server.keep(ANN, wireTake(guests[0]));
  // The network drops after the first batch is answered.
  let imports = 0;
  server.beforeAnswer = (sent) => {
    if (sent.path === "/api/sessions/import") {
      imports += 1;
      if (imports === 2) {
        server.online = false;
      }
    }
    return null;
  };

  const first = await device.auth.importGuestTakes();
  assert.equal(first.waiting, true);
  assert.equal(server.takesOf(ANN).length, 500);
  assert.equal(await device.auth.guestImportOffer(), null, "the speaker already said yes");

  server.beforeAnswer = null;
  server.online = true;
  device.fire("online");
  await settle();

  const ids = idsOf(server.takesOf(ANN));
  assert.equal(ids.length, 502);
  assert.equal(new Set(ids).size, 502, "each take once");
  const sizes = requestsTo(server, "POST", "/api/sessions/import").map(
    (sent) => sent.body.sessions.length,
  );
  assert.deepEqual(sizes, [500, 2, 2]);
});

test("keeping the guest takes on the device is remembered for the account, once", async () => {
  const server = new FakeAccountServer();
  const device = loadDevice(server);
  await device.store.save(session("guest-1", T1));
  await device.auth.signUp(ANN, PASSWORD);

  await device.auth.declineGuestImport();
  assert.equal(await device.auth.guestImportOffer(), null);
  await device.auth.logOut();
  await device.auth.logIn(ANN, PASSWORD);
  assert.equal(await device.auth.guestImportOffer(), null, "asked once for this account");
  assert.deepEqual(requestsTo(server, "POST", "/api/sessions/import"), []);

  await device.auth.logOut();
  await device.auth.signUp(BEN, PASSWORD);
  assert.deepEqual(plain(await device.auth.guestImportOffer()), { count: 1 }, "another account");
});

// --- signing out, a 401 and deleting the account ---------------------------------------------

test("a 401 from the server drops the device to a guest's state", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server);
  await device.store.save(session("take-1", T1));
  await settle();
  server.endSessions(ANN);

  await device.store.list();

  assert.equal(await device.auth.account(), null);
  const before = server.requests.length;
  await device.store.save(session("as-a-guest", T2));
  await device.store.list();
  await settle();
  assert.deepEqual(server.requests.slice(before), [], "a guest sends nothing");
});

test("signing out keeps the account's takes from a guest until it signs in again", async () => {
  const server = new FakeAccountServer();
  const device = loadDevice(server);
  await device.store.save(session("guest-take", T1));
  await device.auth.signUp(ANN, PASSWORD);
  await device.store.save(session("account-take", T2));
  server.keep(ANN, wireTake(session("from-laptop", T3)));
  await device.store.list();

  await device.auth.logOut();
  assert.equal(await device.auth.account(), null);
  assert.deepEqual(idsOf(await device.store.list()), ["guest-take"]);
  assert.equal(await device.store.get("from-laptop"), undefined);

  await device.auth.logIn(ANN, PASSWORD);
  server.online = false;
  assert.deepEqual(idsOf(await device.store.list()), ["from-laptop", "account-take", "guest-take"]);
});

test("another account on the same device never sees the first one's takes", async () => {
  const server = new FakeAccountServer();
  const device = await signedUpDevice(server, ANN);
  await device.store.save(session("ann-take", T1));
  await settle();
  await device.auth.logOut();

  await device.auth.signUp(BEN, PASSWORD);

  assert.deepEqual(plain(await device.store.list()), []);
  assert.equal(await device.auth.guestImportOffer(), null, "ann's takes are not a guest's");
});

test("deleting the account signs out, keeping the takes recorded here as a guest's", async () => {
  const server = new FakeAccountServer();
  const device = loadDevice(server);
  await device.store.save(session("guest-take", T1));
  await device.auth.signUp(ANN, PASSWORD);
  await device.store.save(session("account-take", T2));
  server.keep(ANN, wireTake(session("from-laptop", T3)));
  await device.store.list();

  await device.auth.deleteAccount();

  assert.equal(server.users.has(ANN), false);
  assert.equal(await device.auth.account(), null);
  const before = server.requests.length;
  assert.deepEqual(idsOf(await device.store.list()), ["account-take", "guest-take"]);
  await device.store.save(session("after", T4));
  await settle();
  assert.deepEqual(server.requests.slice(before), [], "a guest again: nothing is sent");

  // Signing up again with the same email starts clean: the old account's queue is gone.
  await device.auth.signUp(ANN, PASSWORD);
  await settle();
  assert.deepEqual(server.takesOf(ANN), []);
  assert.deepEqual(plain(await device.auth.guestImportOffer()), { count: 3 });
});

test("an account deleted elsewhere: signing up again here keeps this device's takes", async () => {
  const server = new FakeAccountServer();
  const phone = await signedUpDevice(server);
  await phone.store.save(session("phone-take", T1));
  await settle();
  const laptop = loadDevice(server);
  await laptop.auth.logIn(ANN, PASSWORD);
  await laptop.auth.deleteAccount();

  // The phone learns of it only as a 401: its session ended, so it signs out, its takes still
  // showing.
  assert.deepEqual(idsOf(await phone.store.list()), ["phone-take"]);
  assert.equal(await phone.auth.account(), null);

  // Signing up opens a new account: what the phone kept for the old one is the phone's own again.
  await phone.auth.signUp(ANN, PASSWORD);
  assert.deepEqual(idsOf(await phone.store.list()), ["phone-take"]);
  assert.equal(phone.indexedDB.store("sessions").records.has("phone-take"), true);
  assert.deepEqual(plain(await phone.auth.guestImportOffer()), { count: 1 });
});

// --- the requests themselves -----------------------------------------------------------------

test("every sync request sends the cookie, and every change goes as JSON", async () => {
  const server = new FakeAccountServer();
  const device = loadDevice(server);
  await device.store.save(session("guest-1", T1));
  await device.auth.signUp(ANN, PASSWORD);
  await device.auth.importGuestTakes();
  await device.store.save(session("take-2", T2));
  await device.store.markLevelCleared("fillers-1", T3);
  await settle();
  await device.store.remove("take-2");
  await settle();
  await device.store.list();
  await device.store.listClearedLevels();

  const syncRequests = server.requests.filter(
    (sent) => sent.path.startsWith("/api/sessions") || sent.path === "/api/progress",
  );
  const kinds = new Set(syncRequests.map((sent) => sent.method + " " + sent.path));
  for (const kind of [
    "POST /api/sessions/import",
    "POST /api/sessions",
    "POST /api/progress",
    "DELETE /api/sessions/take-2",
    "GET /api/sessions",
    "GET /api/progress",
  ]) {
    assert.ok(kinds.has(kind), kind + " was sent");
  }
  syncRequests.forEach((sent) => {
    assert.equal(sent.credentials, "same-origin", sent.method + " " + sent.path);
    if (sent.method !== "GET") {
      assert.equal(sent.contentType, JSON_TYPE, sent.method + " " + sent.path);
    }
  });
});
