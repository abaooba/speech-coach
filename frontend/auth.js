/* auth.js: app.auth, the speaker's optional account. signUp, logIn, logOut, deleteAccount and me()
   talk to /api/auth/* and /api/me with the session cookie; a failure rejects with an Error whose
   .kind names it and whose .message is a fixed sentence. It loads before store.js, which connects
   its sync here (connectStore), so signing in starts the sync and signing out stops it. */
(function () {
  "use strict";

  const SIGNUP_URL = "/api/auth/signup";
  const LOGIN_URL = "/api/auth/login";
  const LOGOUT_URL = "/api/auth/logout";
  const ME_URL = "/api/me";
  const JSON_TYPE = "application/json";

  // A request still open after this long fails as "network". Logging in may wait while the
  // database wakes up (backend/db.py allows it 10 seconds), so this leaves room for that.
  const REQUEST_TIMEOUT_MS = 20000;
  // What request() resolves when no reply came: offline, refused, or past the timeout.
  const NO_REPLY = 0;

  // backend/auth.py's rules for a new account, checked here first so a slip shows at once and
  // sends nothing. Lengths count characters as the server does: an emoji is one, not two.
  const MIN_PASSWORD_LENGTH = 10;
  const MAX_PASSWORD_LENGTH = 256;
  const MAX_EMAIL_LENGTH = 254;
  const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  // The only copies of these sentences in the codebase. A wrong password and an email with no
  // account read the same, as the server answers them.
  const messages = Object.freeze({
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
  });

  // The kind of failure each answer means for any account call; others are "unknown".
  const KIND_BY_STATUS = { [NO_REPLY]: "network", 429: "too_many", 503: "unavailable" };
  const OK = 200;
  const CREATED = 201;
  const NO_CONTENT = 204;
  const BAD_REQUEST = 400;
  const UNAUTHORIZED = 401;
  const CONFLICT = 409;
  const SERVICE_UNAVAILABLE = 503;

  // store.js's controls for this device's account (connectStore): which account it syncs with,
  // starting and stopping that, and the offer to add a guest's takes. Null until store.js loads.
  let sync = null;

  function connectStore(storeSync) {
    sync = storeSync;
  }

  // One request to the account's routes, as this browser's speaker: the session cookie goes along
  // (same origin), and a change goes as JSON, which every such route requires (backend/auth.py
  // require_json), body or not. Resolves {status, body}, status 0 when no reply came.
  async function request(method, url, body) {
    const init = { method, credentials: "same-origin", headers: {} };
    if (method !== "GET") {
      init.headers["Content-Type"] = JSON_TYPE;
    }
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const deadline = startDeadline();
    if (deadline.signal) {
      init.signal = deadline.signal;
    }
    try {
      const response = await fetch(url, init);
      return { status: response.status, body: await bodyOf(response) };
    } catch {
      return { status: NO_REPLY, body: null };
    } finally {
      deadline.clear();
    }
  }

  // The reply's JSON, or null for one without (a 204) or one cut short.
  async function bodyOf(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  // Aborts the request REQUEST_TIMEOUT_MS after it starts. Without AbortController or the timers
  // (an old browser, the test sandbox) the request has no deadline, as in api.js.
  function startDeadline() {
    const canAbort =
      typeof AbortController === "function" &&
      typeof setTimeout === "function" &&
      typeof clearTimeout === "function";
    if (!canAbort) {
      return { signal: undefined, clear: () => {} };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    return { signal: controller.signal, clear: () => clearTimeout(timer) };
  }

  function authError(kind) {
    const error = new Error(messages[kind] || messages.unknown);
    error.kind = Object.prototype.hasOwnProperty.call(messages, kind) ? kind : "unknown";
    return error;
  }

  function failureFor(status) {
    return authError(KIND_BY_STATUS[status] || "unknown");
  }

  // An email as accounts keep it (backend/auth.py normalized_email): trimmed and lowercased.
  function normalizedEmail(email) {
    return String(email === undefined || email === null ? "" : email)
      .trim()
      .toLowerCase();
  }

  // Characters as Python counts them: one per code point.
  function characterCount(text) {
    return [...text].length;
  }

  // Why the server would turn this sign up down, or null when it looks right.
  function signUpProblem(email, password) {
    if (email.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE.test(email)) {
      return "email";
    }
    const length = typeof password === "string" ? characterCount(password) : 0;
    if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
      return "password";
    }
    return null;
  }

  // Opens an account and signs this device in to it; resolves the email as the account keeps it.
  async function signUp(email, password) {
    const address = normalizedEmail(email);
    const problem = signUpProblem(address, password);
    if (problem !== null) {
      throw authError(problem);
    }
    const reply = await request("POST", SIGNUP_URL, { email: address, password });
    if (reply.status === CREATED) {
      return signedIn(reply, true);
    }
    if (reply.status === CONFLICT) {
      throw authError("taken");
    }
    if (reply.status === BAD_REQUEST) {
      // The server names the rule: its sentence about the password, or the one about the email.
      const detail = reply.body && typeof reply.body.detail === "string" ? reply.body.detail : "";
      throw authError(/password/i.test(detail) ? "password" : "email");
    }
    throw failureFor(reply.status);
  }

  // Signs this device in to the account with this email and password; resolves the email.
  async function logIn(email, password) {
    const address = normalizedEmail(email);
    if (address === "" || typeof password !== "string" || password === "") {
      throw authError("missing");
    }
    const reply = await request("POST", LOGIN_URL, { email: address, password });
    if (reply.status === OK) {
      return signedIn(reply, false);
    }
    throw reply.status === UNAUTHORIZED ? authError("wrong") : failureFor(reply.status);
  }

  // After a sign up or log in: store.js starts syncing this device with the account. A sign up
  // is always a new account, even under an email this device has seen before.
  async function signedIn(reply, isNewAccount) {
    const email = reply.body && typeof reply.body.email === "string" ? reply.body.email : null;
    if (email === null) {
      throw authError("unknown");
    }
    if (sync !== null) {
      await sync.startSync(email, isNewAccount);
    }
    return email;
  }

  // Ends this browser's session. Takes saved here go up first when they can, so none waits for a
  // sign in that may never come. A session already over, or accounts turned off since, signs
  // this device out all the same; with no reply it stays signed in, and the call rejects.
  async function logOut() {
    if (sync !== null) {
      await sync.sendQueued();
    }
    const reply = await request("POST", LOGOUT_URL);
    const over = [NO_CONTENT, UNAUTHORIZED, SERVICE_UNAVAILABLE].includes(reply.status);
    if (!over) {
      throw failureFor(reply.status);
    }
    if (sync !== null) {
      await sync.stopSync();
    }
  }

  // Deletes the account and everything the server keeps for it. This device then lets go of the
  // account: the takes recorded on it stay, a guest's from now on, and copies of takes from other
  // devices go (store.js letGo). A session that has ended cannot delete anything: this device is
  // signed out, as after any 401 (store.js endSessionOf), and the call rejects with "signed_out".
  async function deleteAccount() {
    const email = sync !== null ? await sync.account() : null;
    const reply = await request("DELETE", ME_URL);
    if (reply.status === NO_CONTENT) {
      if (sync !== null && email !== null) {
        await sync.forgetAccount(email);
      }
      return;
    }
    if (reply.status === UNAUTHORIZED) {
      if (sync !== null) {
        await sync.endSession();
      }
      throw authError("signed_out");
    }
    throw failureFor(reply.status);
  }

  // Asks the server who this browser is signed in as, and brings this device in line: resolves
  // the email, or null for a guest (a session that has ended signs this device out, as after any
  // 401). Rejects with "unavailable" while accounts are off and "network" with no reply, changing
  // nothing.
  async function me() {
    const reply = await request("GET", ME_URL);
    if (reply.status === OK && reply.body && typeof reply.body.email === "string") {
      const email = reply.body.email;
      if (sync !== null && (await sync.account()) !== email) {
        await sync.startSync(email, false);
      }
      return email;
    }
    if (reply.status === UNAUTHORIZED) {
      if (sync !== null) {
        await sync.endSession();
      }
      return null;
    }
    throw failureFor(reply.status);
  }

  // The account this device last knew it was signed in to, without asking the server; null for a
  // guest, or when store.js is not loaded.
  async function account() {
    return sync !== null ? sync.account() : null;
  }

  // {count} of the takes on this device that belong to no account, when the signed-in account
  // has not been asked about them before; otherwise null. The question is asked once an account.
  async function guestImportOffer() {
    return sync !== null ? sync.guestImportOffer() : null;
  }

  // Adds those takes to the account: {added, keptHere, waiting}. added counts the takes the
  // account now has, keptHere the ones it cannot keep, which stay on this device only; waiting is
  // true when the network dropped first, and the rest go up on their own once it is back.
  async function importGuestTakes() {
    if (sync === null) {
      return { added: 0, keptHere: 0, waiting: false };
    }
    return sync.importGuestTakes();
  }

  // Keeps those takes on this device only; the account is not asked about them again.
  async function declineGuestImport() {
    if (sync !== null) {
      await sync.declineGuestImport();
    }
  }

  // What this device holds beyond who is signed in, for the account screen and History:
  // {endedSession, takesNotKept}. endedSession is {email, takesHere} once the server has ended
  // this device's session (a 401) and until someone signs in: the device is a guest's, but that
  // account's takes still show here, takesHere of them recorded on this device. takesNotKept
  // counts the signed-in account's takes the server refused, which stay on this device only.
  async function syncStatus() {
    if (sync === null) {
      return { endedSession: null, takesNotKept: 0 };
    }
    return sync.syncStatus();
  }

  // For a speaker who cannot log in again, as when the account was deleted elsewhere: the
  // account whose session ended lets go of this device. Its takes recorded here become this
  // device's own, shown to anyone who uses it; copies of its takes from other devices go.
  async function keepEndedTakesHere() {
    if (sync !== null) {
      await sync.forgetEndedSession();
    }
  }

  app.auth = {
    signUp,
    logIn,
    logOut,
    deleteAccount,
    me,
    account,
    guestImportOffer,
    importGuestTakes,
    declineGuestImport,
    syncStatus,
    keepEndedTakesHere,
    request,
    messages,
    connectStore,
  };
})();
