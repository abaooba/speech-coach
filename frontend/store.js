/* store.js: app.store, the device's storage behind History, Progress and the skill path, in
   IndexedDB: sessions (metrics and transcript, never audio), flags such as "onboarded", and cleared
   path levels. For a speaker signed in through auth.js it also keeps them on the server: writes go
   through, reads merge the server's, and writes that miss it wait in a queue. Guests never sync. */
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

  // --- the account sync (docs/PLAN.md T49) ---
  // Two flags no other module uses hold it. ACCOUNT_FLAG names the account this device syncs
  // with, {email}, and is absent for a guest. SYNC_FLAG keeps each account's sync state on this
  // device by email (see newAccountSync): which takes here are its copies, and its queue.
  const ACCOUNT_FLAG = "signedInAccount";
  const SYNC_FLAG = "accountSync";

  // The Sessions API (backend/sessions_api.py). A take there is {id, created_at, report,
  // transcript}: a session's createdAt is created_at, these fields are the report, and its
  // transcript is the transcript. takeFromSession and sessionFromTake turn one into the other.
  const SESSIONS_URL = "/api/sessions";
  const IMPORT_URL = "/api/sessions/import";
  const PROGRESS_URL = "/api/progress";
  const REPORT_FIELDS = [
    "passageId",
    "passageTitle",
    "durationSeconds",
    "metrics",
    "topic",
    "path",
  ];

  // backend/sessions_api.py: one import holds at most 500 takes and 2,000,000 bytes of reports
  // and transcripts, and one take at most 1,000,000. Batches and takes stay 5% under the byte
  // limits: JSON.stringify writes a few numbers a byte shorter than the server's Python, and a
  // batch over the limit is refused whole.
  const MAX_IMPORT_TAKES = 500;
  const IMPORT_BATCH_BYTES = 1900000;
  const MAX_TAKE_BYTES = 950000;
  // backend/sessions_api.py ID_PATTERN: the ids the server keeps a take or a level under.
  const SERVER_ID = /^[A-Za-z0-9_-]{1,100}$/;
  // A time with its zone, as the server takes created_at and cleared_at.
  const ZONED_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
  // A time as the server gives it back: UTC, ending in Z, to the second or the microsecond.
  const SERVER_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/;
  const MILLISECOND_DIGITS = 3;

  // How long a signed-in list waits for the server's before it answers with this device's copy.
  // The server's list still comes in behind it and updates that copy for the next list, so a
  // screen never stalls on a slow network. A device that has never listed the account's takes
  // has no copy worth showing yet, so its first list waits as long as a request may take
  // (auth.js REQUEST_TIMEOUT_MS).
  const LIST_WAIT_MS = 1000;
  const FIRST_LIST_WAIT_MS = 20000;
  // What a wait for the server's list resolves when the time runs out first.
  const TOO_SLOW = "too-slow";

  // A queued write of a take: kept on the server (POST) or deleted there (DELETE).
  const KEEP = "keep";
  const DELETE = "delete";

  // How an account's last answer to the offer to add this device's guest takes stands; null
  // until it is first answered. PENDING: the speaker said yes and the takes are still going up.
  const IMPORT_PENDING = "pending";
  const IMPORT_DONE = "imported";
  const IMPORT_DECLINED = "declined";

  // What became of one sync request. DONE; LATER: no reply, a server fault or accounts off, so
  // the write waits for the next load or reconnect; REFUSED: the server will never keep the write
  // as it is, so it leaves the queue; SIGNED_OUT: a 401, so this device is a guest's again.
  const DONE = "done";
  const LATER = "later";
  const REFUSED = "refused";
  const SIGNED_OUT = "signed-out";

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
    const record = pickSessionFields(session);
    const { email } = await readSyncState();
    if (email === null) {
      await run(SESSIONS_STORE, WRITE, (store) => store.put(record));
      return session.id;
    }
    // Signed in: the take is kept here and queued for the server in one transaction, then sent
    // without holding the caller up. It waits in the queue until the server confirms it.
    await changeSyncState(async (stores, state) => {
      await request(stores[SESSIONS_STORE].put(record));
      if (state.email !== null) {
        queueTakeWrite(accountSyncOf(state, state.email), record.id, KEEP);
      }
    });
    sendQueuedSoon();
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
  // server's list with this device's, which stands in when no reply comes in time.
  async function list() {
    const state = await readSyncState();
    if (state.email !== null) {
      return listForAccount(state);
    }
    return sessionsShownTo(null, state);
  }

  // ISO 8601 timestamps order correctly as plain strings.
  function newestFirst(a, b) {
    if (a.createdAt === b.createdAt) {
      return 0;
    }
    return a.createdAt < b.createdAt ? 1 : -1;
  }

  // This device's copy first, which a signed-in list keeps fresh. A take only the server has
  // (recorded on another device since the last list) is read from the server's list.
  async function get(id) {
    const state = await readSyncState();
    const session = await run(SESSIONS_STORE, READ, (store) => store.get(id));
    const found = session === undefined ? [] : visibleTo(state.email, [session], state);
    if (found.length === 1 || state.email === null) {
      return found[0];
    }
    const sessions = await listForAccount(state);
    return sessions.find((listed) => listed.id === id);
  }

  // Deletes a session. Signed in, the delete is queued for the account's server too, as a save
  // is. A guest deleting a take of the account whose session ended here queues the delete for
  // that account's next sign in, so the take does not come back with its next list.
  async function remove(id) {
    const state = await readSyncState();
    if (state.email === null && endedOwnerOf(id, state) === null) {
      await run(SESSIONS_STORE, WRITE, (store) => store.delete(id));
      return;
    }
    await changeSyncState(async (stores, now) => {
      await request(stores[SESSIONS_STORE].delete(id));
      const account = now.email !== null ? now.email : endedOwnerOf(id, now);
      if (account !== null) {
        queueTakeWrite(accountSyncOf(now, account), id, DELETE);
      }
    });
    sendQueuedSoon();
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
  // level cleared before keeps its first clearedAt, the day it was earned. A guest's levels are
  // this device's own, in pathProgress, where the lookup and the write share one transaction so
  // two calls at once cannot both write. A signed-in account's are its own, kept in its sync
  // state on this device and queued for the server, which also keeps each level's first
  // clearing; they show to that account alone, as its takes do.
  async function markLevelCleared(levelId, clearedAt) {
    if (typeof levelId !== "string" || levelId === "") {
      throw new Error("markLevelCleared expects a level id such as 'fillers-2'");
    }
    if (clearedAt !== undefined && typeof clearedAt !== "string") {
      throw new Error("markLevelCleared expects clearedAt as an ISO time string");
    }
    const record = { levelId, clearedAt: clearedAt || new Date().toISOString() };
    const { email } = await readSyncState();
    const kept = email === null ? null : await keepAccountLevel(record);
    if (kept === null) {
      return keepClearedLevel(record);
    }
    sendQueuedSoon();
    return kept;
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
  // Resolves null when no one is signed in by the time it runs: the level is then a guest's.
  function keepAccountLevel(record) {
    return changeSyncState(async (stores, state) => {
      if (state.email === null) {
        return null;
      }
      const accountSync = accountSyncOf(state, state.email);
      if (accountSync.levels[record.levelId] === undefined) {
        accountSync.levels[record.levelId] = record.clearedAt;
      }
      const first = { levelId: record.levelId, clearedAt: accountSync.levels[record.levelId] };
      accountSync.pendingLevels[first.levelId] = first.clearedAt;
      return first;
    });
  }

  // Every cleared level as {levelId, clearedAt}, in the order they were cleared, each at its
  // first clearing: this device's own levels, then the signed-in account's (with the ones it
  // cleared on other devices, from the server) or, for a guest, those of an account whose
  // session ended here.
  async function listClearedLevels() {
    const state = await readSyncState();
    const deviceOwn = await run(PATH_PROGRESS_STORE, READ, (store) => store.getAll());
    const shown = [...deviceOwn, ...accountLevelsShownTo(state.email, state)];
    if (state.email === null) {
      return firstClearings(shown);
    }
    sendQueuedSoon();
    const reply = await send("GET", PROGRESS_URL);
    const outcome = outcomeOf(reply.status);
    if (outcome === SIGNED_OUT) {
      await endSessionOf(state.email);
      return listClearedLevels();
    }
    const levels = reply.body && reply.body.path_progress;
    if (outcome !== DONE || !Array.isArray(levels)) {
      return firstClearings(shown);
    }
    return firstClearings([...shown, ...levels.map(levelFromServer).filter(Boolean)]);
  }

  // The levels of the account `email` may see (null for a guest: the account whose session
  // ended here, if any), as listClearedLevels lists them.
  function accountLevelsShownTo(email, state) {
    const owner = email !== null ? email : endedAccountOf(state);
    if (owner === null || state.accounts[owner] === undefined) {
      return [];
    }
    const levels = state.accounts[owner].levels;
    return Object.keys(levels).map((levelId) => ({ levelId, clearedAt: levels[levelId] }));
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

  // A level as the server gives it back, as listClearedLevels lists one; null for one malformed.
  function levelFromServer(level) {
    if (!level || typeof level.level_id !== "string" || typeof level.cleared_at !== "string") {
      return null;
    }
    return { levelId: level.level_id, clearedAt: isoMillis(level.cleared_at) };
  }

  // --- the account sync ------------------------------------------------------------------------
  // A signed-in speaker's takes live in the same sessions store as a guest's, so each account's
  // sync state on this device (newAccountSync) remembers which sessions here are its copies.
  // Those copies show to that account only: a guest, or another account signed in on this
  // device, never sees them. Sessions that belong to no account are this device's own, and show
  // to everyone who uses it; signing in offers to add them to the account, asking once about
  // each take. One exception keeps a lapsed session from hiding a speaker's own takes: when the
  // server ends this device's session (a 401), the device is a guest's, but that account's
  // copies still show here until someone signs in or the speaker lets them go.

  // An account's sync state on this device:
  // - takeIds: the sessions here that are the account's copies. Of those, cachedIds came here in
  //   a list (recorded on another device), and notKeptIds are takes recorded here that the server
  //   refused, such as when the account is full, which stay on this device only.
  // - pending: take id -> {write: KEEP or DELETE, number}, the writes the server has not
  //   confirmed (number tells a write from a later one of the same take); writes counts them.
  // - deletedIds: takes deleted from the server from here, until a list shows them gone.
  // - levels: level id -> first clearedAt, the levels the account cleared on this device;
  //   pendingLevels: the same for the ones the server has not confirmed.
  // - guestImport: how the latest answer to the offer of this device's guest takes stands;
  //   answeredIds: the guest takes an answer covered, never offered again; importIds: the ones
  //   the speaker said yes to that are still to go up.
  // - listed: a list from the server has been folded in here at least once.
  // - firstListSinceLogIn: set by a log in. The account behind the email may have been deleted
  //   and made again since this device last listed it. When the next list looks so (it holds
  //   none of the takes recorded here), it keeps a take recorded here that it leaves out, as
  //   this device's own, rather than delete it (foldInto, looksMadeAgain).
  // - sessionEnded: the server ended this device's session for the account (a 401).
  // - loggedOutHere: the speaker logged out of the account on this device, and no one has logged
  //   in to it here since. The server may not have recorded that log out (accounts were off), so
  //   auth.js me() never takes the account back from the browser's cookie.
  function newAccountSync() {
    return {
      takeIds: [],
      cachedIds: [],
      notKeptIds: [],
      pending: {},
      writes: 0,
      deletedIds: [],
      levels: {},
      pendingLevels: {},
      guestImport: null,
      answeredIds: [],
      importIds: [],
      listed: false,
      firstListSinceLogIn: false,
      sessionEnded: false,
      loggedOutHere: false,
    };
  }

  // The sync state as the flags hold it: {email, accounts}, email null for a guest.
  function syncStateFrom(accountRecord, syncRecord) {
    const signedIn = accountRecord && accountRecord.value;
    const accounts = {};
    const stored = syncRecord && syncRecord.value ? syncRecord.value : {};
    Object.keys(stored).forEach((email) => {
      accounts[email] = { ...newAccountSync(), ...stored[email] };
    });
    return {
      email: signedIn && typeof signedIn.email === "string" ? signedIn.email : null,
      accounts,
    };
  }

  // The signed-in account, if any, and every account's sync state, read together.
  function readSyncState() {
    return inTransaction([FLAGS_STORE], READ, async (stores) => {
      const flags = stores[FLAGS_STORE];
      const [accountRecord, syncRecord] = await Promise.all([
        request(flags.get(ACCOUNT_FLAG)),
        request(flags.get(SYNC_FLAG)),
      ]);
      return syncStateFrom(accountRecord, syncRecord);
    });
  }

  // `email`'s sync state within `state`, made when the account has none yet.
  function accountSyncOf(state, email) {
    if (!Object.prototype.hasOwnProperty.call(state.accounts, email)) {
      state.accounts[email] = newAccountSync();
    }
    return state.accounts[email];
  }

  // Changes to the sync state run one at a time in this page, each in one transaction over the
  // sessions, flags and cleared levels, so two never start from the same copy of the state.
  let changesInLine = Promise.resolve();

  // Runs change(stores, state) with the sync state read in a read-write transaction over the
  // sessions, flags and pathProgress stores, then writes back what it changed: state.accounts,
  // and state.email, the signed-in account (null to sign out). Resolves what change resolves.
  function changeSyncState(change) {
    const storeNames = [SESSIONS_STORE, FLAGS_STORE, PATH_PROGRESS_STORE];
    const next = changesInLine.then(() =>
      inTransaction(storeNames, WRITE, async (stores) => {
        const flags = stores[FLAGS_STORE];
        const [accountRecord, syncRecord] = await Promise.all([
          request(flags.get(ACCOUNT_FLAG)),
          request(flags.get(SYNC_FLAG)),
        ]);
        const state = syncStateFrom(accountRecord, syncRecord);
        const accountsBefore = JSON.stringify(state.accounts);
        const signedInBefore = state.email;
        const result = await change(stores, state);
        if (JSON.stringify(state.accounts) !== accountsBefore) {
          await request(flags.put({ key: SYNC_FLAG, value: state.accounts }));
        }
        if (state.email !== signedInBefore) {
          await request(
            state.email === null
              ? flags.delete(ACCOUNT_FLAG)
              : flags.put({ key: ACCOUNT_FLAG, value: { email: state.email } }),
          );
        }
        return result;
      }),
    );
    changesInLine = next.catch(() => {});
    return next;
  }

  // Take id -> the account whose copy it is, the first one listing it.
  function ownersOf(state) {
    const owners = new Map();
    Object.keys(state.accounts).forEach((owner) => {
      state.accounts[owner].takeIds.forEach((id) => {
        if (!owners.has(id)) {
          owners.set(id, owner);
        }
      });
    });
    return owners;
  }

  // The account whose session the server ended here, while no one is signed in; otherwise null.
  // At most one: only the signed-in account's session can end, and a sign in clears the mark.
  function endedAccountOf(state) {
    if (state.email !== null) {
      return null;
    }
    const ended = Object.keys(state.accounts).find((email) => state.accounts[email].sessionEnded);
    return ended === undefined ? null : ended;
  }

  // That account, when take `id` is one of its copies; otherwise null.
  function endedOwnerOf(id, state) {
    const ended = endedAccountOf(state);
    return ended !== null && state.accounts[ended].takeIds.includes(id) ? ended : null;
  }

  // The sessions in `sessions` that `email` may see (null for a guest): the ones that belong to
  // no account and that account's own copies; a guest also sees those of the account whose
  // session ended here.
  function visibleTo(email, sessions, state) {
    const owners = ownersOf(state);
    const ended = email === null ? endedAccountOf(state) : null;
    return sessions.filter((session) => {
      const owner = owners.get(session.id);
      return owner === undefined || owner === email || (ended !== null && owner === ended);
    });
  }

  // The ids of the sessions in `sessions` that belong to no account: this device's own.
  function unownedIds(sessions, state) {
    const owners = ownersOf(state);
    return sessions.map((session) => session.id).filter((id) => !owners.has(id));
  }

  function without(ids, id) {
    return ids.filter((other) => other !== id);
  }

  // Queues `write` of take `id` for the account: a KEEP makes the session here its copy, recorded
  // here, a DELETE lets it go. A later write of the same take replaces an earlier one waiting.
  function queueTakeWrite(accountSync, id, write) {
    accountSync.writes += 1;
    accountSync.pending[id] = { write, number: accountSync.writes };
    accountSync.takeIds = without(accountSync.takeIds, id);
    accountSync.cachedIds = without(accountSync.cachedIds, id);
    accountSync.notKeptIds = without(accountSync.notKeptIds, id);
    accountSync.deletedIds = without(accountSync.deletedIds, id);
    if (write === KEEP) {
      accountSync.takeIds.push(id);
    }
  }

  // The signed-in speaker's list: the server's, merged into this device's copies (foldServerList),
  // or this device's alone when the server gives none, or none in time (LIST_WAIT_MS).
  async function listForAccount(state) {
    const email = state.email;
    const accountSync = accountSyncOf(state, email);
    const reading = readServerList(email, accountSync);
    const wait = accountSync.listed ? LIST_WAIT_MS : FIRST_LIST_WAIT_MS;
    const answer = await withinWait(reading, wait);
    if (answer === SIGNED_OUT) {
      return list();
    }
    if (Array.isArray(answer)) {
      return answer;
    }
    return sessionsShownTo(email, await readSyncState());
  }

  // The read of the server's list under way, {email, done}: a list asked for meanwhile shares
  // it rather than download every take of the account again. Null when none is under way.
  let serverRead = null;

  // Asks the server for `email`'s takes and folds them in here. Resolves what the account may
  // see then, SIGNED_OUT after a 401, or null when no list came (no reply, a fault).
  function readServerList(email, accountSync) {
    if (serverRead !== null && serverRead.email === email) {
      return serverRead.done;
    }
    // The takes known to be on the server as this list is asked for: copies here with no write
    // waiting, which the server took. One the list leaves out was deleted on another device. A
    // take written meanwhile is never judged by a list asked for before it.
    const notKept = new Set(accountSync.notKeptIds);
    const confirmed = new Set(
      accountSync.takeIds.filter((id) => !accountSync.pending[id] && !notKept.has(id)),
    );
    sendQueuedSoon();
    const current = { email, done: null };
    current.done = (async () => {
      try {
        const reply = await send("GET", SESSIONS_URL);
        const outcome = outcomeOf(reply.status);
        if (outcome === SIGNED_OUT) {
          await endSessionOf(email);
          return SIGNED_OUT;
        }
        if (outcome !== DONE || !Array.isArray(reply.body)) {
          return null;
        }
        const fromServer = reply.body.map(sessionFromTake).filter((session) => session !== null);
        return await foldServerList(email, fromServer, confirmed);
      } catch {
        // IndexedDB failed under the fold: the next list tries again.
        return null;
      } finally {
        if (serverRead === current) {
          serverRead = null;
        }
      }
    })();
    serverRead = current;
    return current.done;
  }

  // `promise`, or TOO_SLOW once `ms` pass first. Without timers (an old browser, the test
  // sandbox) it waits for `promise` itself.
  function withinWait(promise, ms) {
    if (typeof setTimeout !== "function" || typeof clearTimeout !== "function") {
      return promise;
    }
    let timer = null;
    const timeUp = new Promise((resolve) => {
      timer = setTimeout(() => resolve(TOO_SLOW), ms);
    });
    return Promise.race([promise, timeUp]).finally(() => clearTimeout(timer));
  }

  // This device's sessions that `email` may see (null for a guest) under `state`, newest first.
  async function sessionsShownTo(email, state) {
    const sessions = await run(SESSIONS_STORE, READ, (store) => store.getAll());
    return visibleTo(email, sessions, state).sort(newestFirst);
  }

  // Folds the server's list into this device's copies in one transaction: caches the takes it
  // lacks or holds older, and drops the copies of takes deleted on another device. A take with a
  // write waiting here keeps this device's version; one deleted here stays deleted, even when
  // the list was sent before the DELETE landed. Resolves what `email` may see, newest first.
  function foldServerList(email, fromServer, confirmed) {
    return changeSyncState(async (stores, state) => {
      const sessionsStore = stores[SESSIONS_STORE];
      const sessions = await request(sessionsStore.getAll());
      if (state.email !== email) {
        // Signed out while the list was on its way: it is no longer this device's to keep.
        return visibleTo(state.email, sessions, state).sort(newestFirst);
      }
      const accountSync = accountSyncOf(state, email);
      const here = new Map(sessions.map((session) => [session.id, session]));
      const { toCache, toDrop } = foldInto(accountSync, fromServer, here, confirmed);
      await Promise.all(toCache.map((session) => request(sessionsStore.put(session))));
      await Promise.all(toDrop.map((id) => request(sessionsStore.delete(id))));
      toCache.forEach((session) => here.set(session.id, session));
      toDrop.forEach((id) => here.delete(id));
      return visibleTo(email, [...here.values()], state).sort(newestFirst);
    });
  }

  // The decisions of foldServerList, changing `accountSync` in place: which server takes to
  // cache here, and which copies here to drop. `here` maps id to this device's session. A copy
  // the server took that its list leaves out was deleted on another device, and goes; a take
  // the server refused is not on its list and stays. On the first list since a log in, the
  // account behind the email may be a new one, made after the one this device synced with was
  // deleted (looksMadeAgain): then a take recorded here that the list leaves out stays too, as
  // this device's own.
  function foldInto(accountSync, fromServer, here, confirmed) {
    const owned = new Set(accountSync.takeIds);
    const cached = new Set(accountSync.cachedIds);
    const notKept = new Set(accountSync.notKeptIds);
    const deletedHere = new Set(accountSync.deletedIds);
    const onServer = new Set(fromServer.map((session) => session.id));
    const madeAgain =
      accountSync.firstListSinceLogIn && looksMadeAgain(confirmed, cached, onServer);
    const toCache = [];
    fromServer.forEach((session) => {
      const waiting = accountSync.pending[session.id];
      if (deletedHere.has(session.id) || (waiting && waiting.write === DELETE)) {
        return;
      }
      owned.add(session.id);
      notKept.delete(session.id);
      if (waiting) {
        return;
      }
      const copy = here.get(session.id);
      if (copy === undefined) {
        cached.add(session.id);
      }
      if (copy === undefined || !sameSession(copy, session)) {
        toCache.push(session);
      }
    });
    const toDrop = [];
    confirmed.forEach((id) => {
      const gone =
        owned.has(id) && !onServer.has(id) && !accountSync.pending[id] && !notKept.has(id);
      if (!gone) {
        return;
      }
      owned.delete(id);
      const recordedHere = !cached.has(id);
      cached.delete(id);
      const keptAsOwn = madeAgain && recordedHere;
      if (!keptAsOwn && here.has(id)) {
        toDrop.push(id);
      }
    });
    accountSync.takeIds = [...owned];
    accountSync.cachedIds = [...cached].filter((id) => owned.has(id));
    accountSync.notKeptIds = [...notKept].filter((id) => owned.has(id));
    // A take deleted from here that the list no longer holds is gone from the server for good.
    accountSync.deletedIds = accountSync.deletedIds.filter((id) => onServer.has(id));
    accountSync.firstListSinceLogIn = false;
    accountSync.listed = true;
    return { toCache, toDrop };
  }

  // Whether the account's list looks like one made again under the same email: it holds none of
  // the takes recorded here that the server had confirmed (`confirmed` less the copies in
  // `cached`). Only this device could add those to a new account, and none has been sent since
  // (no write waits for them), so one of them on the list shows the account is the same: a take
  // recorded here that the list leaves out was deleted on another device. A copy of a take from
  // another device shows nothing, as that device may have added it to the new account. When
  // every take recorded here was deleted elsewhere, the two look alike, and those takes stay as
  // this device's own.
  function looksMadeAgain(confirmed, cached, onServer) {
    return ![...confirmed].some((id) => !cached.has(id) && onServer.has(id));
  }

  function sameSession(a, b) {
    return JSON.stringify(pickSessionFields(a)) === JSON.stringify(pickSessionFields(b));
  }

  // A session as the server keeps a take, or null when no server could keep it: an id or a time
  // it refuses, a transcript that is not a list, or more bytes than a take may hold.
  function takeFromSession(session) {
    const fits =
      SERVER_ID.test(String(session.id)) &&
      ZONED_TIME.test(String(session.createdAt)) &&
      Array.isArray(session.transcript);
    if (!fits) {
      return null;
    }
    const report = {};
    REPORT_FIELDS.forEach((field) => {
      if (session[field] !== undefined) {
        report[field] = session[field];
      }
    });
    const take = {
      id: session.id,
      created_at: session.createdAt,
      report,
      transcript: session.transcript,
    };
    return takeBytes(take) <= MAX_TAKE_BYTES ? take : null;
  }

  // A take the server gives back as the session it was saved as, or null for one malformed.
  function sessionFromTake(take) {
    const wellFormed =
      take !== null &&
      typeof take === "object" &&
      typeof take.id === "string" &&
      take.report !== null &&
      typeof take.report === "object" &&
      Array.isArray(take.transcript);
    if (!wellFormed) {
      return null;
    }
    const session = {
      id: take.id,
      createdAt: isoMillis(take.created_at),
      transcript: take.transcript,
    };
    REPORT_FIELDS.forEach((field) => {
      session[field] = take.report[field];
    });
    return pickSessionFields(session);
  }

  // A time the server gives back ("2026-10-12T18:30:00Z", or to the microsecond) as toISOString
  // writes it, to the millisecond, so a take's createdAt reads back exactly as it was saved and
  // sorts as text with the others.
  function isoMillis(text) {
    const match = SERVER_TIME.exec(String(text));
    if (match !== null) {
      const fraction = (match[2] || "").padEnd(MILLISECOND_DIGITS, "0");
      return match[1] + "." + fraction.slice(0, MILLISECOND_DIGITS) + "Z";
    }
    const moment = new Date(text);
    return Number.isNaN(moment.getTime()) ? String(text) : moment.toISOString();
  }

  // A take's report and transcript in bytes, as the server counts them (json_bytes): JSON with
  // no spaces, in UTF-8.
  function takeBytes(take) {
    return utf8Bytes(JSON.stringify(take.report)) + utf8Bytes(JSON.stringify(take.transcript));
  }

  function utf8Bytes(text) {
    let bytes = 0;
    for (const character of text) {
      const code = character.codePointAt(0);
      if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (code < 0x10000) {
        bytes += 3;
      } else {
        bytes += 4;
      }
    }
    return bytes;
  }

  // One request to the server, through auth.js, which sends the session cookie. Without
  // auth.js there is no account, and so no reply.
  function send(method, url, body) {
    if (typeof app.auth !== "object" || app.auth === null) {
      return Promise.resolve({ status: 0, body: null });
    }
    return app.auth.request(method, url, body);
  }

  function outcomeOf(status) {
    if (status >= 200 && status < 300) {
      return DONE;
    }
    if (status === 401) {
      return SIGNED_OUT;
    }
    if (status === 0 || status === 408 || status === 429 || status >= 500) {
      return LATER;
    }
    return REFUSED;
  }

  // After a 401 for `email`: the server ended this device's session with that account, which a
  // 30-day session running out, a new SESSION_SECRET or the account's deletion elsewhere all do.
  // The device is a guest's from now on and sends nothing, but the account's copies still show
  // here (visibleTo), so a take recorded just before still opens and History loses nothing,
  // until someone signs in or the speaker lets them go (forgetEndedSession). Its queue waits for
  // its next sign in.
  function endSessionOf(email) {
    return changeSyncState(async (stores, state) => {
      if (state.email === email) {
        state.email = null;
        accountSyncOf(state, email).sessionEnded = true;
      }
    });
  }

  async function stillSignedIn(email) {
    return (await readSyncState()).email === email;
  }

  // The queue is sent by one sender at a time; a call while it runs makes it go round once more.
  let sending = null;
  let sendAgain = false;

  // Starts sending the signed-in account's queued writes, now and in the background; resolves
  // when the queue has been through. Never rejects: what fails waits for the next try.
  function sendQueuedSoon() {
    if (sending !== null) {
      sendAgain = true;
      return sending;
    }
    sending = (async () => {
      try {
        do {
          sendAgain = false;
          await sendQueued();
        } while (sendAgain);
      } catch {
        // IndexedDB failed under the send: the queue is as it was, for the next try.
      } finally {
        sending = null;
      }
    })();
    return sending;
  }

  // Sends each queued take write, then the cleared levels, then a guest import the speaker
  // accepted, in that order, stopping at the first that gets no reply or a 401.
  async function sendQueued() {
    const state = await readSyncState();
    const email = state.email;
    if (email === null) {
      return;
    }
    const accountSync = accountSyncOf(state, email);
    for (const id of Object.keys(accountSync.pending)) {
      if (!(await stillSignedIn(email))) {
        return;
      }
      const queued = accountSync.pending[id];
      const outcome = await sendTakeWrite(id, queued.write);
      if (outcome === SIGNED_OUT) {
        await endSessionOf(email);
        return;
      }
      if (outcome === LATER) {
        return;
      }
      await settleTakeWrite(email, id, queued, outcome);
    }
    if (!(await sendClearedLevels(email, accountSync.pendingLevels))) {
      return;
    }
    if (accountSync.guestImport === IMPORT_PENDING) {
      await importGuestTakesOnce(email);
    }
  }

  async function sendTakeWrite(id, write) {
    if (write === DELETE) {
      // The server holds no take under an id it would refuse: nothing to delete there.
      if (!SERVER_ID.test(String(id))) {
        return DONE;
      }
      const reply = await send("DELETE", SESSIONS_URL + "/" + encodeURIComponent(id));
      return outcomeOf(reply.status);
    }
    const session = await run(SESSIONS_STORE, READ, (store) => store.get(id));
    if (session === undefined) {
      return DONE;
    }
    const take = takeFromSession(session);
    if (take === null) {
      return REFUSED;
    }
    const reply = await send("POST", SESSIONS_URL, take);
    return outcomeOf(reply.status);
  }

  // Takes a sent write off the queue, unless a later write of the same take replaced it. A take
  // the server deleted is remembered as deleted (foldInto). One it refused for good, such as
  // when the account is full, stays the account's copy on this device only (notKeptIds): never
  // shown to a guest or another account, and never sent again on its own.
  function settleTakeWrite(email, id, queued, outcome) {
    return changeSyncState(async (stores, state) => {
      const accountSync = state.accounts[email];
      const now = accountSync ? accountSync.pending[id] : undefined;
      if (now === undefined || now.number !== queued.number) {
        return;
      }
      delete accountSync.pending[id];
      if (queued.write === DELETE && outcome === DONE) {
        accountSync.deletedIds.push(id);
      }
      if (queued.write === KEEP && outcome === REFUSED && accountSync.takeIds.includes(id)) {
        accountSync.notKeptIds = [...without(accountSync.notKeptIds, id), id];
      }
    });
  }

  // Sends the queued cleared levels in one request. Resolves false when the queue should stop
  // there (no reply, or a 401), true otherwise.
  async function sendClearedLevels(email, pendingLevels) {
    const levels = Object.keys(pendingLevels).map((levelId) => ({
      level_id: levelId,
      cleared_at: pendingLevels[levelId],
    }));
    if (levels.length === 0) {
      return true;
    }
    // A level the server could never keep is dropped from the queue without a request.
    const sendable = levels.filter(
      (level) => SERVER_ID.test(level.level_id) && ZONED_TIME.test(level.cleared_at),
    );
    let outcome = DONE;
    if (sendable.length > 0) {
      const reply = await send("POST", PROGRESS_URL, { path_progress: sendable });
      outcome = outcomeOf(reply.status);
    }
    if (outcome === SIGNED_OUT) {
      await endSessionOf(email);
      return false;
    }
    if (outcome === LATER) {
      return false;
    }
    await changeSyncState(async (stores, state) => {
      const accountSync = state.accounts[email];
      if (accountSync === undefined) {
        return;
      }
      levels.forEach((level) => {
        if (accountSync.pendingLevels[level.level_id] === level.cleared_at) {
          delete accountSync.pendingLevels[level.level_id];
        }
      });
    });
    return true;
  }

  // --- adding this device's guest takes to an account -----------------------------------------

  // The import running now, which a second call joins rather than send the takes twice.
  let importing = null;

  function importGuestTakesOnce(email) {
    if (importing === null) {
      importing = importGuestTakesInto(email).finally(() => {
        importing = null;
      });
    }
    return importing;
  }

  // Imports the guest takes the speaker said yes to (importIds) into `email`'s account, in
  // batches within the server's limits. Each batch the server takes makes its sessions the
  // account's copies, so a run cut short sends only the rest next time, and the server keeps one
  // copy of any it is sent twice. Resolves {added, keptHere, waiting} (auth.js importGuestTakes).
  async function importGuestTakesInto(email) {
    const result = { added: 0, keptHere: 0, waiting: false };
    const state = await readSyncState();
    if (state.email !== email) {
      return { ...result, waiting: true };
    }
    const sessions = await run(SESSIONS_STORE, READ, (store) => store.getAll());
    const byId = new Map(sessions.map((session) => [session.id, session]));
    const unowned = new Set(unownedIds(sessions, state));
    const takes = [];
    // Ids that leave the import without a request: deleted since, an account's by now, or a
    // take no server could keep, which stays on this device.
    const settled = [];
    accountSyncOf(state, email).importIds.forEach((id) => {
      const take = unowned.has(id) ? takeFromSession(byId.get(id)) : null;
      if (take !== null) {
        takes.push(take);
        return;
      }
      if (unowned.has(id)) {
        result.keptHere += 1;
      }
      settled.push(id);
    });
    await leaveImport(email, settled, false);
    for (const batch of importBatches(takes)) {
      if (!(await stillSignedIn(email))) {
        return { ...result, waiting: true };
      }
      const reply = await send("POST", IMPORT_URL, { sessions: batch });
      const outcome = outcomeOf(reply.status);
      if (outcome === SIGNED_OUT) {
        await endSessionOf(email);
        return { ...result, waiting: true };
      }
      if (outcome === LATER) {
        return { ...result, waiting: true };
      }
      // Kept now, or kept before: either way the account has these takes. A refused batch
      // stays on this device, as its own.
      const kept = outcome !== REFUSED;
      await leaveImport(
        email,
        batch.map((take) => take.id),
        kept,
      );
      if (kept) {
        result.added += batch.length;
      } else {
        result.keptHere += batch.length;
      }
    }
    await setGuestImport(email, IMPORT_DONE);
    return result;
  }

  // `takes` in order, split so that each batch holds MAX_IMPORT_TAKES takes and
  // IMPORT_BATCH_BYTES bytes at most.
  function importBatches(takes) {
    const batches = [];
    let batch = [];
    let bytes = 0;
    takes.forEach((take) => {
      const size = takeBytes(take);
      const full = batch.length === MAX_IMPORT_TAKES || bytes + size > IMPORT_BATCH_BYTES;
      if (batch.length > 0 && full) {
        batches.push(batch);
        batch = [];
        bytes = 0;
      }
      batch.push(take);
      bytes += size;
    });
    if (batch.length > 0) {
      batches.push(batch);
    }
    return batches;
  }

  // Takes `ids` out of the account's import; when `claimed`, the account has them now, so the
  // sessions here become its copies.
  function leaveImport(email, ids, claimed) {
    if (ids.length === 0) {
      return Promise.resolve();
    }
    return changeSyncState(async (stores, state) => {
      const accountSync = state.accounts[email];
      if (accountSync === undefined) {
        return;
      }
      const leaving = new Set(ids);
      accountSync.importIds = accountSync.importIds.filter((id) => !leaving.has(id));
      if (claimed) {
        accountSync.takeIds = [...new Set([...accountSync.takeIds, ...ids])];
      }
    });
  }

  function setGuestImport(email, standing) {
    return changeSyncState(async (stores, state) => {
      if (state.accounts[email] !== undefined) {
        state.accounts[email].guestImport = standing;
      }
    });
  }

  // The signed-in account's answer to the offer, about the guest takes on this device it has not
  // been asked about yet: a yes queues them for the import, either answer covers them for good.
  // Resolves the email, or null with no one signed in.
  function answerGuestOffer(standing) {
    return changeSyncState(async (stores, state) => {
      if (state.email === null) {
        return null;
      }
      const accountSync = accountSyncOf(state, state.email);
      const sessions = await request(stores[SESSIONS_STORE].getAll());
      const answered = new Set(accountSync.answeredIds);
      const asked = unownedIds(sessions, state).filter((id) => !answered.has(id));
      accountSync.answeredIds = [...answered, ...asked];
      if (standing === IMPORT_PENDING) {
        accountSync.importIds = [...new Set([...accountSync.importIds, ...asked])];
      }
      accountSync.guestImport = standing;
      return state.email;
    });
  }

  // --- what auth.js drives (connectStore) ------------------------------------------------------

  async function account() {
    return (await readSyncState()).email;
  }

  // Signed in as `email`: this device syncs with that account from now on, and what it queued
  // before, signed in earlier, goes up. Whatever account's session had ended here no longer
  // shows to a guest. A sign up (`isNewAccount`) opens a new account, so what this device kept
  // under that email belonged to one since deleted elsewhere: it is let go first, as when the
  // account is deleted here (letGo). A log in may also reach an account made again under the
  // same email; the next list checks for it (firstListSinceLogIn).
  async function startSync(email, isNewAccount) {
    await changeSyncState(async (stores, state) => {
      if (isNewAccount) {
        await letGo(stores, state, email);
      }
      Object.keys(state.accounts).forEach((other) => {
        state.accounts[other].sessionEnded = false;
      });
      state.email = email;
      const accountSync = accountSyncOf(state, email);
      accountSync.firstListSinceLogIn = !isNewAccount;
      accountSync.loggedOutHere = false;
    });
    sendQueuedSoon();
  }

  // Logged out: this device stops syncing. The account's copies here stay, shown to it alone,
  // and its queue waits for its next sign in.
  function stopSync() {
    return changeSyncState(async (stores, state) => {
      if (state.email !== null) {
        accountSyncOf(state, state.email).loggedOutHere = true;
      }
      state.email = null;
    });
  }

  // Whether the speaker logged out of `email`'s account on this device since anyone last logged
  // in to it here.
  async function loggedOutHere(email) {
    const accountSync = (await readSyncState()).accounts[email];
    return accountSync !== undefined && accountSync.loggedOutHere === true;
  }

  // A 401 that auth.js met (me(), or deleting the account): the session of whoever is signed in
  // here has ended (endSessionOf).
  async function endSession() {
    const { email } = await readSyncState();
    if (email !== null) {
      await endSessionOf(email);
    }
  }

  // This device lets go of `email`'s account: its takes recorded here, sent or not, become this
  // device's own and show to anyone who uses it, as a guest's always do; its copies of takes
  // recorded on other devices are deleted here, as the account they came with is gone; the levels
  // it cleared here become this device's; its queue goes.
  async function letGo(stores, state, email) {
    const accountSync = state.accounts[email];
    if (accountSync === undefined) {
      return;
    }
    delete state.accounts[email];
    const ownedElsewhere = ownersOf(state);
    const fromOtherDevices = accountSync.cachedIds.filter((id) => !ownedElsewhere.has(id));
    for (const id of fromOtherDevices) {
      await request(stores[SESSIONS_STORE].delete(id));
    }
    const levels = stores[PATH_PROGRESS_STORE];
    for (const levelId of Object.keys(accountSync.levels)) {
      const clearedAt = accountSync.levels[levelId];
      const before = await request(levels.get(levelId));
      if (before === undefined || clearedAt < before.clearedAt) {
        await request(levels.put({ levelId, clearedAt }));
      }
    }
    if (state.email === email) {
      state.email = null;
    }
  }

  // The account is deleted: this device lets go of it (letGo).
  function forgetAccount(email) {
    return changeSyncState((stores, state) => letGo(stores, state, email));
  }

  // The speaker keeps the takes of the account whose session ended here on this device instead
  // of logging in again, as when that account was deleted elsewhere (letGo).
  function forgetEndedSession() {
    return changeSyncState(async (stores, state) => {
      const ended = endedAccountOf(state);
      if (ended !== null) {
        await letGo(stores, state, ended);
      }
    });
  }

  // What the account screen and History tell the speaker about this device beyond who is signed
  // in, read without asking the server: {endedSession, takesNotKept}. endedSession is {email,
  // takesHere} while the session of the account `email` has ended here and no one has signed in
  // since, takesHere counting its takes recorded on this device; otherwise null. takesNotKept
  // counts the signed-in account's takes the server refused, on this device only.
  async function syncStatus() {
    const state = await readSyncState();
    const sessions = await run(SESSIONS_STORE, READ, (store) => store.getAll());
    const here = new Set(sessions.map((session) => session.id));
    const status = { endedSession: null, takesNotKept: 0 };
    if (state.email !== null) {
      const notKept = accountSyncOf(state, state.email).notKeptIds;
      status.takesNotKept = notKept.filter((id) => here.has(id)).length;
      return status;
    }
    const ended = endedAccountOf(state);
    if (ended !== null) {
      const accountSync = state.accounts[ended];
      const cached = new Set(accountSync.cachedIds);
      const recordedHere = accountSync.takeIds.filter((id) => here.has(id) && !cached.has(id));
      status.endedSession = { email: ended, takesHere: recordedHere.length };
    }
    return status;
  }

  // {count} of the guest takes on this device the signed-in account has not been asked about,
  // when there are any and no import it said yes to is still going up; otherwise null. Right
  // after a log in to an account with copies here, it waits up to LIST_WAIT_MS for the first
  // list, which settles which takes here are the account's: on an account made again under the
  // same email, the ones recorded here are the device's own, and are offered.
  async function guestImportOffer() {
    let state = await readSyncState();
    if (state.email === null) {
      return null;
    }
    const before = accountSyncOf(state, state.email);
    if (before.firstListSinceLogIn && before.takeIds.length > 0) {
      await withinWait(readServerList(state.email, before), LIST_WAIT_MS);
      state = await readSyncState();
      if (state.email === null) {
        return null;
      }
    }
    const accountSync = accountSyncOf(state, state.email);
    if (accountSync.guestImport === IMPORT_PENDING) {
      return null;
    }
    const sessions = await run(SESSIONS_STORE, READ, (store) => store.getAll());
    const answered = new Set(accountSync.answeredIds);
    const count = unownedIds(sessions, state).filter((id) => !answered.has(id)).length;
    return count > 0 ? { count } : null;
  }

  // The speaker said yes: those takes are queued for the import, so a run the network cuts short
  // finishes on the next load or reconnect, then it starts now.
  async function importGuestTakes() {
    const email = await answerGuestOffer(IMPORT_PENDING);
    if (email === null) {
      return { added: 0, keptHere: 0, waiting: false };
    }
    return importGuestTakesOnce(email);
  }

  async function declineGuestImport() {
    await answerGuestOffer(IMPORT_DECLINED);
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

  // auth.js, loaded just before this file, signs the speaker in and out: these are the parts of
  // the sync it drives. They stay off app.store, whose eight functions every screen uses.
  if (typeof app.auth === "object" && app.auth !== null) {
    app.auth.connectStore({
      account,
      startSync,
      stopSync,
      loggedOutHere,
      endSession,
      forgetAccount,
      forgetEndedSession,
      syncStatus,
      sendQueued: sendQueuedSoon,
      guestImportOffer,
      importGuestTakes,
      declineGuestImport,
    });
  }

  // A write the server missed goes up when the device is back online, and on the next load.
  if (typeof window !== "undefined" && window && typeof window.addEventListener === "function") {
    window.addEventListener("online", () => sendQueuedSoon());
    window.addEventListener("load", () => sendQueuedSoon());
  }
})();
