/* api.js: app.api, the one place the frontend talks to the backend.
   analyze(blob, contentType) posts a recording to POST /api/analyze and resolves with the
   backend's {transcript, metrics}; failures reject with an Error whose .kind is
   "network" | "too_short" | "provider" | "unknown" and whose .message is a fixed sentence. */
(function () {
  "use strict";

  const ANALYZE_URL = "/api/analyze";
  const AUDIO_FIELD = "audio";
  const FILENAME_STEM = "recording.";
  const DEFAULT_EXTENSION = "webm";

  // A request still open after two minutes is aborted and fails as "network", so a stalled
  // upload never leaves the speaker on "Analyzing your speech". Two minutes is also how long
  // the backend waits on each call to the speech-to-text provider.
  const ANALYZE_TIMEOUT_MS = 120000;

  // The only copies of these sentences in the codebase (DESIGN.md section 8).
  const messages = Object.freeze({
    network: "Could not reach the server. Your recording is still here.",
    too_short: "That was under 5 seconds. Try again.",
    provider: "Analysis failed on our side. Your recording is still here.",
  });

  const KIND_BY_STATUS = { 400: "too_short", 502: "provider" };

  async function analyze(blob, contentType) {
    const form = new FormData();
    form.append(AUDIO_FIELD, blob, FILENAME_STEM + extensionFor(contentType));

    const deadline = startDeadline();
    try {
      return await post(form, deadline.signal);
    } finally {
      deadline.clear();
    }
  }

  // One POST and its JSON reply. The deadline's abort, while sending or while reading the reply,
  // fails as "network", as a server that cannot be reached does.
  async function post(form, signal) {
    let response;
    try {
      response = await fetch(ANALYZE_URL, { method: "POST", body: form, signal });
    } catch {
      throw apiError("network");
    }

    if (!response.ok) {
      throw apiError(KIND_BY_STATUS[response.status] || "unknown");
    }

    try {
      return await response.json();
    } catch {
      throw apiError(signal && signal.aborted ? "network" : "unknown");
    }
  }

  // Aborts the request ANALYZE_TIMEOUT_MS after it starts. Without AbortController or the timers
  // (an old browser, the test sandbox) the request has no deadline and no signal.
  function startDeadline() {
    const canAbort =
      typeof AbortController === "function" &&
      typeof setTimeout === "function" &&
      typeof clearTimeout === "function";
    if (!canAbort) {
      return { signal: undefined, clear: () => {} };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);
    return { signal: controller.signal, clear: () => clearTimeout(timer) };
  }

  // MediaRecorder reports types such as "audio/webm;codecs=opus", "audio/mp4" or "audio/ogg".
  function extensionFor(contentType) {
    const type = String(contentType || "").toLowerCase();
    if (type.includes("mp4")) {
      return "mp4";
    }
    if (type.includes("ogg")) {
      return "ogg";
    }
    return DEFAULT_EXTENSION;
  }

  // "unknown" has no sentence of its own and reads as a provider failure.
  function apiError(kind) {
    const error = new Error(messages[kind] || messages.provider);
    error.kind = kind;
    return error;
  }

  app.api = { analyze, messages };
})();
