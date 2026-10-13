/* store.js: app.store, the IndexedDB layer behind History, Progress and the skill path.
   save/list/get/remove keep sessions (metrics and transcript, never audio); getFlag/setFlag keep
   settings such as "onboarded"; markLevelCleared/listClearedLevels keep path progress. Requests
   are wrapped in Promises, so a failure rejects instead of hanging; all calls share one open. */
(function () {
  "use strict";

  const DB_NAME = "speech-coach";
  // Version 1 held sessions and flags; version 2 adds pathProgress (docs/PLAN.md T42).
  const DB_VERSION = 2;
  const SESSIONS_STORE = "sessions";
  const FLAGS_STORE = "flags";
  const PATH_PROGRESS_STORE = "pathProgress";
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

  // What every call says while an older version of the app, open in another tab, holds the
  // database at the version before. store.js before version 2 never lets go of its connection,
  // so the upgrade waits for that tab to close.
  const UPGRADE_BLOCKED_MESSAGE =
    "Close other Speech Coach tabs to finish updating, then try again.";

  // Shared by every call so the database is opened once; reset when that open fails.
  let openPromise = null;

  // A blocked open fails its callers at once rather than leave them waiting: app.js boot waits
  // for a flag before it shows any screen. The open itself goes on, and every call until it
  // finishes gets the same failure, because an open made behind it would wait unheard. Once the
  // older tab closes, the open upgrades the database and every later call uses its connection.
  function openDatabase() {
    if (openPromise === null) {
      openPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => upgrade(request.result, event.oldVersion);
        request.onblocked = () => reject(new Error(UPGRADE_BLOCKED_MESSAGE));
        request.onsuccess = () => {
          const db = closeForNewerVersions(request.result);
          openPromise = Promise.resolve(db);
          resolve(db);
        };
        request.onerror = () => {
          openPromise = null;
          reject(errorOf(request, "Could not open the session database"));
        };
      });
    }
    return openPromise;
  }

  // A newer app version opening the database in another tab can upgrade it only once every
  // open connection closes, so this one closes when asked; the next call here opens again.
  function closeForNewerVersions(db) {
    db.onversionchange = () => {
      db.close();
      openPromise = null;
    };
    return db;
  }

  // Brings the database from `oldVersion` (0 for a new one, or when the event leaves it out)
  // up to DB_VERSION, creating only the stores each later version added. Creating a store that
  // exists would abort the upgrade, so an upgrade never touches the sessions and flags a
  // speaker already saved.
  function upgrade(db, oldVersion) {
    const from = Number.isFinite(oldVersion) ? oldVersion : 0;
    if (from < 1) {
      const sessions = db.createObjectStore(SESSIONS_STORE, { keyPath: "id" });
      sessions.createIndex(CREATED_AT_INDEX, CREATED_AT_INDEX);
      db.createObjectStore(FLAGS_STORE, { keyPath: "key" });
    }
    if (from < 2) {
      db.createObjectStore(PATH_PROGRESS_STORE, { keyPath: "levelId" });
    }
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

  // Records a skill-path level (an app.path level id, such as "fillers-2") as cleared and
  // resolves the record kept: {levelId, clearedAt}, clearedAt an ISO time, now unless given. A
  // level cleared before keeps its first clearedAt, the day it was earned. The lookup and the
  // write share one transaction, so two calls at once cannot both write.
  async function markLevelCleared(levelId, clearedAt) {
    if (typeof levelId !== "string" || levelId === "") {
      throw new Error("markLevelCleared expects a level id such as 'fillers-2'");
    }
    if (clearedAt !== undefined && typeof clearedAt !== "string") {
      throw new Error("markLevelCleared expects clearedAt as an ISO time string");
    }
    const record = { levelId, clearedAt: clearedAt || new Date().toISOString() };
    const db = await openDatabase();
    const store = db.transaction(PATH_PROGRESS_STORE, WRITE).objectStore(PATH_PROGRESS_STORE);
    return new Promise((resolve, reject) => {
      const failed = (request) => () => reject(errorOf(request, "Could not save path progress"));
      const lookup = store.get(levelId);
      lookup.onerror = failed(lookup);
      lookup.onsuccess = () => {
        if (lookup.result !== undefined) {
          resolve(lookup.result);
          return;
        }
        const write = store.put(record);
        write.onerror = failed(write);
        write.onsuccess = () => resolve(record);
      };
    });
  }

  // Every cleared level as {levelId, clearedAt}, in the order they were cleared.
  async function listClearedLevels() {
    const records = await run(PATH_PROGRESS_STORE, READ, (store) => store.getAll());
    return records.sort(earliestClearedFirst);
  }

  function earliestClearedFirst(a, b) {
    if (a.clearedAt === b.clearedAt) {
      return a.levelId < b.levelId ? -1 : 1;
    }
    return a.clearedAt < b.clearedAt ? -1 : 1;
  }

  app.store = {
    save,
    list,
    get,
    remove,
    getFlag,
    setFlag,
    markLevelCleared,
    listClearedLevels,
  };
})();
