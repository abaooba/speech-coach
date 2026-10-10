/* store.js: app.store, the IndexedDB layer behind History and Progress.
   save/list/get/remove keep practice sessions (metrics and transcript only, never audio);
   getFlag/setFlag keep small settings such as "onboarded". Every IDBRequest is wrapped in
   a Promise so a failure rejects instead of hanging, and all calls share one open. */
(function () {
  "use strict";

  const DB_NAME = "speech-coach";
  const DB_VERSION = 1;
  const SESSIONS_STORE = "sessions";
  const FLAGS_STORE = "flags";
  const CREATED_AT_INDEX = "createdAt";
  const READ = "readonly";
  const WRITE = "readwrite";

  // The only fields a stored session may carry (DESIGN.md section 2).
  const SESSION_FIELDS = [
    "id",
    "createdAt",
    "passageId",
    "passageTitle",
    "durationSeconds",
    "metrics",
    "transcript",
  ];

  // Audio never reaches the database; a session carrying one of these is a programming error.
  const AUDIO_FIELDS = ["blob", "audio"];

  // Shared by every call so the database is opened once; reset when that open fails.
  let openPromise = null;

  function openDatabase() {
    if (openPromise === null) {
      openPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => createStores(request.result);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(errorOf(request, "Could not open the session database"));
      });
      openPromise.catch(() => {
        openPromise = null;
      });
    }
    return openPromise;
  }

  function createStores(db) {
    const sessions = db.createObjectStore(SESSIONS_STORE, { keyPath: "id" });
    sessions.createIndex(CREATED_AT_INDEX, CREATED_AT_INDEX);
    db.createObjectStore(FLAGS_STORE, { keyPath: "key" });
  }

  function requestToPromise(request, failureMessage) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(errorOf(request, failureMessage));
    });
  }

  function errorOf(request, fallbackMessage) {
    return request.error || new Error(fallbackMessage);
  }

  // Runs one request against one object store in its own transaction.
  async function run(storeName, mode, makeRequest) {
    const db = await openDatabase();
    const store = db.transaction(storeName, mode).objectStore(storeName);
    return requestToPromise(makeRequest(store), "IndexedDB request failed on " + storeName);
  }

  async function save(session) {
    assertStorable(session);
    if (!session.id) {
      session.id = newId();
    }
    if (!session.createdAt) {
      session.createdAt = new Date().toISOString();
    }
    const record = pickSessionFields(session);
    await run(SESSIONS_STORE, WRITE, (store) => store.put(record));
    return session.id;
  }

  function assertStorable(session) {
    if (session === null || typeof session !== "object") {
      throw new Error("save expects a session object");
    }
    AUDIO_FIELDS.forEach((field) => {
      if (field in session) {
        throw new Error("Sessions never store audio; remove the '" + field + "' property");
      }
    });
  }

  function pickSessionFields(session) {
    const record = {};
    SESSION_FIELDS.forEach((field) => {
      record[field] = session[field];
    });
    return record;
  }

  function newId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  async function list() {
    const sessions = await run(SESSIONS_STORE, READ, (store) => store.getAll());
    return sessions.sort(newestFirst);
  }

  // ISO 8601 timestamps order correctly as plain strings.
  function newestFirst(a, b) {
    if (a.createdAt === b.createdAt) {
      return 0;
    }
    return a.createdAt < b.createdAt ? 1 : -1;
  }

  function get(id) {
    return run(SESSIONS_STORE, READ, (store) => store.get(id));
  }

  async function remove(id) {
    await run(SESSIONS_STORE, WRITE, (store) => store.delete(id));
  }

  async function getFlag(key) {
    const record = await run(FLAGS_STORE, READ, (store) => store.get(key));
    return record === undefined ? undefined : record.value;
  }

  async function setFlag(key, value) {
    await run(FLAGS_STORE, WRITE, (store) => store.put({ key, value }));
  }

  app.store = { save, list, get, remove, getFlag, setFlag };
})();
