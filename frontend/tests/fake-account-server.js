// A stand-in for the backend's account routes for the frontend tests: backend/auth.py
// (/api/auth/signup, /login, /logout and /api/me) and backend/sessions_api.py (/api/sessions,
// /api/sessions/import and /api/progress), with the same answers, limits and wire format, kept in
// memory. Each browser() is one device: its own fetch and cookie jar, so two devices can share
// one server. Switches let a test take the network away, turn accounts off, or end a session.
"use strict";

const JSON_TYPE = "application/json";
// backend/sessions_api.py: what one import may hold, and one take.
const MAX_IMPORT_TAKES = 500;
const MAX_IMPORT_BYTES = 2000000;
const MAX_TAKE_BYTES = 1000000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
// backend/auth.py: what signing up checks.
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 256;
const TAKE_FIELDS = ["id", "created_at", "report", "transcript"];
const ONE_TAKE_PREFIX = "/api/sessions/";

// The bytes `value` takes as JSON with no spaces, in UTF-8: what the server counts (json_bytes).
function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

// A take's report and transcript together, as the server counts them against its limits.
function takeBytes(take) {
  return jsonBytes(take.report) + jsonBytes(take.transcript);
}

// A time as the server gives it back (pydantic): UTC, ending in Z, with microseconds only when
// there are any, so "2026-10-12T18:30:00.000Z" comes back as "2026-10-12T18:30:00Z".
function serverMoment(text) {
  const moment = new Date(text);
  const whole = moment.toISOString().slice(0, 19);
  const millis = moment.getUTCMilliseconds();
  return millis === 0 ? whole + "Z" : whole + "." + String(millis * 1000).padStart(6, "0") + "Z";
}

// A time with its zone, as the server's Moment takes it.
function isZonedTime(text) {
  return (
    typeof text === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(text) &&
    !Number.isNaN(Date.parse(text))
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// What TakeToKeep accepts: the four fields and nothing else, a valid id and time, an object
// report without audio and an array transcript, MAX_TAKE_BYTES at most together.
function takeProblem(take) {
  if (!isPlainObject(take)) {
    return "a take is an object";
  }
  const keys = Object.keys(take).sort();
  if (keys.join(",") !== [...TAKE_FIELDS].sort().join(",")) {
    return "a take has exactly id, created_at, report and transcript";
  }
  if (typeof take.id !== "string" || !ID_PATTERN.test(take.id)) {
    return "a take's id is 1 to 100 letters, digits, hyphens and underscores";
  }
  if (!isZonedTime(take.created_at)) {
    return "created_at is a time with its zone";
  }
  if (!isPlainObject(take.report) || "audio" in take.report || "blob" in take.report) {
    return "the report is an object without audio";
  }
  if (!Array.isArray(take.transcript)) {
    return "the transcript is an array";
  }
  if (takeBytes(take) > MAX_TAKE_BYTES) {
    return "the report and transcript are over the limit";
  }
  return null;
}

function reply(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    json: async () => {
      if (body === undefined) {
        throw new SyntaxError("Unexpected end of JSON input");
      }
      return JSON.parse(JSON.stringify(body));
    },
  };
}

class FakeAccountServer {
  constructor() {
    // email -> {password, takes: Map(id -> take as kept), levels: Map(level_id -> cleared_at)}
    this.users = new Map();
    // session token -> email
    this.tokens = new Map();
    this.nextToken = 1;
    // false: every fetch rejects, as a browser's does with no network.
    this.online = true;
    // false: every account route answers 503, as with DATABASE_URL unset.
    this.accountsOn = true;
    // true: logging in answers 429, as after five failed logins.
    this.lockedOut = false;
    // Every request that reached the server: {method, path, contentType, credentials, body}.
    this.requests = [];
    // When set, each request waits for the promise it returns before the server reads it.
    this.beforeAnswer = null;
    // When set, each answer, decided as the request arrives, waits for the promise it returns
    // before it reaches the browser: a reply that is overtaken by a later request.
    this.beforeReply = null;
    // Statuses the next matching requests get instead of their answer: {method, path, status}.
    this.failures = [];
  }

  // The next `method` request to `pathname` gets `status` (such as 500 or 422) and changes nothing.
  failNext(method, pathname, status) {
    this.failures.push({ method, path: pathname, status });
  }

  // One device: fetch(url, init) as a browser sends it, with this device's cookie jar.
  browser() {
    const jar = { token: null };
    const fetch = (url, init) => this.handle(jar, url, init || {});
    return { fetch, jar };
  }

  // An account made directly, as if signed up on another device.
  addUser(email, password) {
    this.users.set(email, { password, takes: new Map(), levels: new Map() });
  }

  // `email`'s takes as the server keeps them, newest first, as GET /api/sessions lists them.
  takesOf(email) {
    const user = this.users.get(email);
    return user ? this.listed(user) : [];
  }

  // Ends every session of `email`, as an expired cookie would.
  endSessions(email) {
    for (const [token, owner] of this.tokens) {
      if (owner === email) {
        this.tokens.delete(token);
      }
    }
  }

  // A take kept for `email`, as though it came from another device.
  keep(email, take) {
    const kept = JSON.parse(JSON.stringify(take));
    kept.created_at = serverMoment(take.created_at);
    this.users.get(email).takes.set(take.id, kept);
  }

  listed(user) {
    return [...user.takes.values()]
      .sort((a, b) => {
        const byTime = Date.parse(b.created_at) - Date.parse(a.created_at);
        return byTime !== 0 ? byTime : a.id < b.id ? -1 : 1;
      })
      .map((take) => JSON.parse(JSON.stringify(take)));
  }

  async handle(jar, url, init) {
    if (!this.online) {
      throw new TypeError("Failed to fetch");
    }
    const method = (init.method || "GET").toUpperCase();
    const headers = init.headers || {};
    const contentType = headers["Content-Type"] || headers["content-type"] || null;
    const credentials = init.credentials === undefined ? "same-origin" : init.credentials;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const path = new URL(url, "https://speech-coach.test").pathname;
    const request = { method, path, contentType, credentials, body };
    this.requests.push(request);
    if (this.beforeAnswer) {
      await this.beforeAnswer(request);
    }
    if (!this.online) {
      throw new TypeError("Failed to fetch");
    }
    // A request sent without credentials carries no cookie and keeps none it is given.
    const sendsCookie = credentials === "same-origin" || credentials === "include";
    const session = { jar: sendsCookie ? jar : { token: null } };
    const failure = this.failures.findIndex((next) => next.method === method && next.path === path);
    let response;
    if (failure === -1) {
      response = this.answer(method, path, contentType, body, session);
    } else {
      const [{ status }] = this.failures.splice(failure, 1);
      response = reply(status, { detail: "failed on purpose" });
    }
    if (this.beforeReply) {
      await this.beforeReply(request);
    }
    return response;
  }

  answer(method, path, contentType, body, session) {
    if (!this.accountsOn) {
      return reply(503, { detail: "accounts are not configured" });
    }
    if (method !== "GET" && (contentType || "").split(";")[0].trim().toLowerCase() !== JSON_TYPE) {
      return reply(415, { detail: "send this request as JSON (Content-Type: application/json)" });
    }
    if (path === "/api/auth/signup" && method === "POST") {
      return this.signUp(body, session);
    }
    if (path === "/api/auth/login" && method === "POST") {
      return this.logIn(body, session);
    }
    if (path === "/api/auth/logout" && method === "POST") {
      this.tokens.delete(session.jar.token);
      session.jar.token = null;
      return reply(204);
    }
    const email = this.tokens.get(session.jar.token);
    if (email === undefined) {
      return reply(401, { detail: "not signed in" });
    }
    const user = this.users.get(email);
    if (path === "/api/me" && method === "GET") {
      return reply(200, { email });
    }
    if (path === "/api/me" && method === "DELETE") {
      this.users.delete(email);
      this.endSessions(email);
      session.jar.token = null;
      return reply(204);
    }
    if (path === "/api/sessions" && method === "GET") {
      return reply(200, this.listed(user));
    }
    if (path === "/api/sessions" && method === "POST") {
      const problem = takeProblem(body);
      if (problem) {
        return reply(422, { detail: [{ msg: problem }] });
      }
      this.keep(email, body);
      return reply(200, { id: body.id });
    }
    const isOneTake = path.startsWith(ONE_TAKE_PREFIX) && path !== "/api/sessions/import";
    if (isOneTake && method === "DELETE") {
      const id = decodeURIComponent(path.slice(ONE_TAKE_PREFIX.length));
      if (!ID_PATTERN.test(id)) {
        return reply(422, { detail: [{ msg: "not an id" }] });
      }
      user.takes.delete(id);
      return reply(204);
    }
    if (path === "/api/sessions/import" && method === "POST") {
      return this.importTakes(email, user, body);
    }
    if (path === "/api/progress" && method === "GET") {
      return reply(200, this.progressOf(user));
    }
    if (path === "/api/progress" && method === "POST") {
      (body.path_progress || []).forEach((level) => {
        const before = user.levels.get(level.level_id);
        const at = serverMoment(level.cleared_at);
        if (before === undefined || Date.parse(at) < Date.parse(before)) {
          user.levels.set(level.level_id, at);
        }
      });
      return reply(200, this.progressOf(user));
    }
    return reply(404, { detail: "Not Found" });
  }

  signUp(body, session) {
    const email = String(body.email).trim().toLowerCase();
    // Python's isprintable() refuses control characters, as backend/auth.py signup_problem does.
    const printable = !/[\u0000-\u001f\u007f-\u009f]/.test(email);
    if (email.length > 254 || !printable || !EMAIL_SHAPE.test(email)) {
      return reply(400, { detail: "enter a valid email address" });
    }
    const length = [...String(body.password)].length;
    if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
      return reply(400, { detail: "use a password of 10 to 256 characters" });
    }
    if (this.users.has(email)) {
      return reply(409, { detail: "an account with this email already exists: log in instead" });
    }
    this.addUser(email, body.password);
    this.startSession(email, session);
    return reply(201, { email });
  }

  logIn(body, session) {
    const email = String(body.email).trim().toLowerCase();
    if (this.lockedOut) {
      return reply(
        429,
        { detail: "too many failed logins: try again in 15 min" },
        { "Retry-After": "900" },
      );
    }
    const user = this.users.get(email);
    if (!user || user.password !== body.password) {
      return reply(401, { detail: "email or password is wrong" });
    }
    this.startSession(email, session);
    return reply(200, { email });
  }

  startSession(email, session) {
    const token = "token-" + this.nextToken++;
    this.tokens.set(token, email);
    session.jar.token = token;
  }

  // The import route: one copy of each id, the speaker's own ids skipped, within the limits.
  importTakes(email, user, body) {
    const takes = body && Array.isArray(body.sessions) ? body.sessions : null;
    if (takes === null || takes.length > MAX_IMPORT_TAKES) {
      return reply(422, { detail: [{ msg: "at most 500 takes in one import" }] });
    }
    const problem = takes.map(takeProblem).find((found) => found !== null);
    if (problem) {
      return reply(422, { detail: [{ msg: problem }] });
    }
    const bytes = takes.reduce((sum, take) => sum + takeBytes(take), 0);
    if (bytes > MAX_IMPORT_BYTES) {
      return reply(422, { detail: [{ msg: "the takes are over the import limit" }] });
    }
    let imported = 0;
    takes.forEach((take) => {
      if (!user.takes.has(take.id)) {
        this.keep(email, take);
        imported += 1;
      }
    });
    return reply(200, { imported, skipped: takes.length - imported });
  }

  progressOf(user) {
    const levels = [...user.levels.entries()]
      .map(([level_id, cleared_at]) => ({ level_id, cleared_at }))
      .sort((a, b) => Date.parse(a.cleared_at) - Date.parse(b.cleared_at));
    return { shown_advice: [], path_progress: levels };
  }
}

module.exports = { FakeAccountServer, serverMoment, jsonBytes, MAX_IMPORT_TAKES, MAX_IMPORT_BYTES };
