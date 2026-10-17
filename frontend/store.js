/* store.js: app.store, the device's storage behind History, Progress and the skill path, in
   IndexedDB: sessions (metrics and transcript, never audio), flags such as "onboarded", and cleared
   path levels. Everything stays on this device; nothing here talks to a server. */
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

  // The only fields a stored session may carry (DESIGN.md section 2). The Loop Path adds two
  // (docs/superpowers/specs/2026-10-14-loop-path.md section 6): `topic`, the Talk topic on screen
  // when the take was recorded, or null; and `path`, a Path take's {play, kind, take, scored,
  // passed, stage, inRoom}, which a plain take does not have.
  const SESSION_FIELDS = [
    "id",
    "createdAt",
    "passageId",
    "passageTitle",
    "durationSeconds",
    "metrics",
    "transcript",
    "topic",
    "path",
  ];

  // Audio never reaches the database; a session carrying one of these is a programming error.
  const AUDIO_FIELDS = ["blob", "audio"];

  // What every call says while an older version of the app, open in another tab, holds the
  // database at the version before. store.js before version 2 never lets go of its connection,
  // so the upgrade waits for that tab to close.
  const UPGRADE_BLOCKED_MESSAGE =
    "Close other Speech Coach tabs to finish updating, then try again.";

  // Flags an older version of the app kept for signed-in accounts. They are read once, to keep
  // the levels they hold, and then deleted (migrateAccountFlags).
  const ACCOUNT_FLAG = "signedInAccount";
  const SYNC_FLAG = "accountSync";

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
          // Callers wait for the one-time migration; a failure there never fails the open.
          openPromise = migrateAccountFlags(db).then(
            () => db,
            () => db,
          );
          resolve(openPromise);
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

  // Runs body(stores) in one transaction over `storeNames`, stores[name] each object store. The
  // body may await only requests on those stores: awaiting anything else lets the browser
  // commit the transaction under it.
  async function inTransaction(storeNames, mode, body) {
    const db = await openDatabase();
    const transaction = db.transaction(storeNames, mode);
    const stores = {};
    storeNames.forEach((name) => {
      stores[name] = transaction.objectStore(name);
    });
    return body(stores);
  }

  function request(storeRequest) {
    return requestToPromise(storeRequest, "IndexedDB request failed");
  }


  async function save(session) {
    assertStorable(session);
    if (!session.id) {
      session.id = newId();
    }
    if (!session.createdAt) {
      session.createdAt = new Date().toISOString();
    }
    await run(SESSIONS_STORE, WRITE, (store) => store.put(pickSessionFields(session)));
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

  // The session's own fields, each one it has; a field it lacks (a plain take's `path`) stays
  // absent rather than kept as undefined.
  function pickSessionFields(session) {
    const record = {};
    SESSION_FIELDS.forEach((field) => {
      if (session[field] !== undefined) {
        record[field] = session[field];
      }
    });
    return record;
  }

  function newId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  // Newest first. A guest's list is this device's sessions that belong to no account, with the
  // takes of an account whose session ended here (visibleTo); a signed-in speaker's merges the

  // Every session on this device, newest first.
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

  // This device's copy first, which a signed-in list keeps fresh. A take only the server has

  async function get(id) {
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
  // write share one transaction so two calls at once cannot both write.
  async function markLevelCleared(levelId, clearedAt) {
    if (typeof levelId !== "string" || levelId === "") {
      throw new Error("markLevelCleared expects a level id such as 'fillers-2'");
    }
    if (clearedAt !== undefined && typeof clearedAt !== "string") {
      throw new Error("markLevelCleared expects clearedAt as an ISO time string");
    }
    return keepClearedLevel({ levelId, clearedAt: clearedAt || new Date().toISOString() });
  }

  async function keepClearedLevel(record) {
    const db = await openDatabase();
    const store = db.transaction(PATH_PROGRESS_STORE, WRITE).objectStore(PATH_PROGRESS_STORE);
    return new Promise((resolve, reject) => {
      const failed = (pending) => () => reject(errorOf(pending, "Could not save path progress"));
      const lookup = store.get(record.levelId);
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

  // The signed-in account's record of a level, at its first clearing, queued for the server.

  // Every cleared level as {levelId, clearedAt}, in the order they were cleared.
  async function listClearedLevels() {
    const levels = await run(PATH_PROGRESS_STORE, READ, (store) => store.getAll());
    return firstClearings(levels);
  }


  function earliestClearedFirst(a, b) {
    if (a.clearedAt === b.clearedAt) {
      return a.levelId < b.levelId ? -1 : 1;
    }
    return a.clearedAt < b.clearedAt ? -1 : 1;
  }

  // One record per level, at its earliest clearing, in the order they were cleared.
  function firstClearings(records) {
    const first = new Map();
    records.forEach((record) => {
      const before = first.get(record.levelId);
      if (before === undefined || record.clearedAt < before.clearedAt) {
        first.set(record.levelId, record);
      }
    });
    return [...first.values()].sort(earliestClearedFirst);
  }

  // One-time move off the accounts this app once had. The levels an account cleared on this
  // device go into pathProgress (a level keeps its earliest clearing), then both account flags
  // are deleted, which also removes the stored email. A failure leaves the flags for the next
  // load to try again.
  async function migrateAccountFlags(db) {
    const names = [FLAGS_STORE, PATH_PROGRESS_STORE];
    const transaction = db.transaction(names, WRITE);
    const flags = transaction.objectStore(FLAGS_STORE);
    const progress = transaction.objectStore(PATH_PROGRESS_STORE);
    const sync = await request(flags.get(SYNC_FLAG));
    const accounts = sync && sync.value && typeof sync.value === "object" ? sync.value : {};
    const earned = [];
    Object.keys(accounts).forEach((email) => {
      const account = accounts[email] || {};
      [account.levels, account.pendingLevels].forEach((levels) => {
        Object.keys(levels || {}).forEach((levelId) => {
          if (typeof levels[levelId] === "string") {
            earned.push({ levelId, clearedAt: levels[levelId] });
          }
        });
      });
    });
    const here = await request(progress.getAll());
    const writes = firstClearings([...here, ...earned]).filter((record) => {
      const kept = here.find((level) => level.levelId === record.levelId);
      return kept === undefined || kept.clearedAt !== record.clearedAt;
    });
    await Promise.all([
      ...writes.map((record) => request(progress.put(record))),
      request(flags.delete(ACCOUNT_FLAG)),
      request(flags.delete(SYNC_FLAG)),
    ]);
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
