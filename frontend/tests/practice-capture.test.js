// Tests for the capture half of frontend/screens/practice.js: the Record tap asks for the
// microphone, MediaRecorder collects chunks, the timer ticks, Stop builds the blob and uploads
// it, and hide() releases everything. Every browser API the screen touches (getUserMedia,
// MediaRecorder, Blob, performance.now, setInterval) is a fake injected into the vm context,
// so the tests drive the clock and the recorder's events by hand.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument, byClass } = require("./fake-dom");

const PRACTICE_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "screens", "practice.js"),
  "utf8",
);
const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

const PASSAGES = [
  { id: "a", kind: "passage", title: "A", text: "x", targetWpm: [140, 160] },
  { id: "b", kind: "prompt", title: "B", text: "y", targetWpm: [120, 130] },
];

// The same sentences api.js freezes (DESIGN.md section 8); the fake app.api carries them.
const MESSAGES = Object.freeze({
  network: "Could not reach the server. Your recording is still here.",
  too_short: "That was under 5 seconds. Try again.",
  provider: "Analysis failed on our side. Your recording is still here.",
});

const MIC_BLOCKED_BODY =
  "Microphone is blocked. Allow it in your browser settings, then tap Record.";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

const ANALYSIS = {
  transcript: [{ text: "hello", start: 0.1, end: 0.5 }],
  metrics: { words_per_minute: 150, pauses: [] },
};

const SAVED_ID = "session-1";

class FakeTrack {
  constructor() {
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  constructor() {
    this.tracks = [new FakeTrack(), new FakeTrack()];
  }

  getTracks() {
    return this.tracks;
  }

  allTracksStopped() {
    return this.tracks.every((track) => track.stopped);
  }
}

class FakeBlob {
  constructor(parts, options) {
    this.parts = Array.from(parts);
    this.type = (options && options.type) || "";
    this.size = this.parts.reduce((total, part) => total + part.size, 0);
  }
}

// Builds a MediaRecorder stand-in for one test. `supportedTypes` answers isTypeSupported;
// `reportedMimeType` is what a browser would expose as recorder.mimeType once it picks a
// container itself (empty means "whatever the constructor was given").
function fakeMediaRecorderClass(supportedTypes, reportedMimeType) {
  class FakeMediaRecorder {
    constructor(stream, options) {
      this.stream = stream;
      this.options = options;
      this.mimeType = reportedMimeType || (options && options.mimeType) || "";
      this.state = "inactive";
      this.timeslice = null;
      this.stopCalls = 0;
      this.listeners = {};
      FakeMediaRecorder.instances.push(this);
    }

    static isTypeSupported(type) {
      FakeMediaRecorder.asked.push(type);
      return supportedTypes.includes(type);
    }

    addEventListener(type, handler) {
      (this.listeners[type] = this.listeners[type] || []).push(handler);
    }

    removeEventListener(type, handler) {
      this.listeners[type] = (this.listeners[type] || []).filter((other) => other !== handler);
    }

    start(timeslice) {
      this.state = "recording";
      this.timeslice = timeslice;
    }

    stop() {
      this.state = "inactive";
      this.stopCalls += 1;
    }

    emit(type, event) {
      (this.listeners[type] || []).forEach((handler) => handler(event || { type }));
    }

    // What a browser does after stop(): one last chunk, then the stop event.
    finish(lastChunk) {
      this.state = "inactive";
      this.emit("dataavailable", { data: lastChunk });
      this.emit("stop", { type: "stop" });
    }
  }
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.asked = [];
  return FakeMediaRecorder;
}

function chunk(size) {
  return { size };
}

// A clock the tests move by hand: performance.now reads it and setInterval callbacks fire in
// order as advance() passes their due times.
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const intervals = new Map();

  function nextDue(end) {
    let due = null;
    intervals.forEach((entry, id) => {
      if (entry.next <= end && (due === null || entry.next < due.entry.next)) {
        due = { id, entry };
      }
    });
    return due;
  }

  function advance(ms) {
    const end = now + ms;
    for (let due = nextDue(end); due !== null; due = nextDue(end)) {
      now = due.entry.next;
      due.entry.next += due.entry.ms;
      due.entry.callback();
    }
    now = end;
  }

  return {
    performance: { now: () => now },
    setInterval(callback, ms) {
      const id = nextId++;
      intervals.set(id, { callback, ms, next: now + ms });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    advance,
    activeIntervals: () => intervals.size,
  };
}

// A pause sampler shaped like the human-owned app.pauses, logging every call.
function fakePauses(samples, reconciled) {
  const calls = [];
  return {
    calls,
    start(stream) {
      calls.push(["start", stream]);
    },
    stop() {
      calls.push(["stop"]);
      return samples;
    },
    reconcile(metrics, given) {
      calls.push(["reconcile", metrics, given]);
      return reconciled;
    },
  };
}

function apiError(kind) {
  const error = new Error(MESSAGES[kind]);
  error.kind = kind;
  return error;
}

// Objects built inside the vm realm have a foreign prototype; a JSON round-trip makes them
// comparable with deepEqual.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// Lets every pending promise chain settle, including the awaits inside practice.js.
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Loads ui.js and practice.js against the fakes, mounts the screen, and returns handles for
// the DOM parts plus the call logs and the controls for the mic prompt and the upload.
function setup(options = {}) {
  const clock = fakeClock();
  const MediaRecorder = fakeMediaRecorderClass(
    options.supportedTypes || ["audio/webm;codecs=opus", "audio/webm"],
    options.reportedMimeType || "",
  );
  const calls = { getUserMedia: [], analyze: [], save: [], go: [], announce: [] };
  const streams = [];
  const micPrompts = [];
  const uploads = [];

  const app = {
    screens: {},
    ui: {},
    store: {
      save(session) {
        calls.save.push(session);
        return Promise.resolve(SAVED_ID);
      },
    },
    api: {
      messages: MESSAGES,
      analyze(blob, contentType) {
        calls.analyze.push({ blob, contentType });
        return new Promise((resolve, reject) => uploads.push({ resolve, reject }));
      },
    },
    passages: PASSAGES.map((entry) => ({ ...entry, targetWpm: [...entry.targetWpm] })),
    router: {
      go(name, params) {
        calls.go.push({ name, params });
      },
    },
  };
  if (options.pauses) {
    app.pauses = options.pauses;
  }

  const context = {
    app,
    document: fakeDocument(),
    navigator: {
      mediaDevices: {
        getUserMedia(constraints) {
          calls.getUserMedia.push(constraints);
          return new Promise((resolve, reject) => micPrompts.push({ resolve, reject }));
        },
      },
    },
    MediaRecorder,
    Blob: FakeBlob,
    performance: clock.performance,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  app.ui.announce = (text) => calls.announce.push(text);
  vm.runInNewContext(PRACTICE_SOURCE, context, { filename: "practice.js" });

  const root = new FakeElement("section");
  root.dataset.state = "idle";
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(body);
  const practice = app.screens.practice;
  practice.mount(root);

  const timerWrap = byClass(body, "practice__timer");
  return {
    practice,
    root,
    body,
    chips: byClass(body, "chip-row").children,
    timer: byClass(timerWrap, "timer"),
    recordButton: byClass(body, "btn-record"),
    recordLabel: byClass(body, "btn-record__label"),
    stateEl: byClass(body, "practice__state"),
    calls,
    clock,
    MediaRecorder,
    streams,
    // The browser's answer to the last mic prompt.
    grantMic() {
      const stream = new FakeStream();
      streams.push(stream);
      micPrompts.shift().resolve(stream);
    },
    denyMic() {
      const error = new Error("Permission denied");
      error.name = "NotAllowedError";
      micPrompts.shift().reject(error);
    },
    // The backend's answer to the oldest upload still in flight.
    resolveUpload(result) {
      uploads.shift().resolve(result);
    },
    rejectUpload(error) {
      uploads.shift().reject(error);
    },
  };
}

// Taps Record, grants the mic and returns the recorder the screen created.
async function startTake(t) {
  t.recordButton.click();
  t.grantMic();
  await flush();
  return t.MediaRecorder.instances[t.MediaRecorder.instances.length - 1];
}

// Reads the title, body and action button out of the rendered state block.
function stateBlockParts(t) {
  const block = t.stateEl.children[0];
  const [, title, body, action] = block.children;
  return {
    className: block.className,
    title: title.textContent,
    body: body.textContent,
    actionLabel: action ? action.children[0].textContent : null,
    action,
  };
}

test("the microphone is requested on the first Record tap, never at load", async () => {
  const t = setup();
  assert.deepEqual(t.calls.getUserMedia, []);
  assert.equal(t.MediaRecorder.instances.length, 0);

  t.recordButton.click();
  assert.deepEqual(plain(t.calls.getUserMedia), [{ audio: true }]);
  assert.equal(t.root.dataset.state, "idle", "nothing changes until the browser answers");

  t.grantMic();
  await flush();
  const recorder = t.MediaRecorder.instances[0];
  assert.equal(recorder.stream, t.streams[0]);
  assert.equal(recorder.timeslice, 1000);
  assert.equal(recorder.state, "recording");
  assert.equal(t.root.dataset.state, "recording");
  assert.equal(t.recordLabel.textContent, "Stop");
  assert.equal(t.timer.textContent, "0:00");
  assert.deepEqual(t.calls.announce, ["Recording started"]);
});

test("a second Record tap while the mic prompt is open does not ask twice", async () => {
  const t = setup();
  t.recordButton.click();
  t.recordButton.click();
  assert.equal(t.calls.getUserMedia.length, 1);
  t.grantMic();
  await flush();
  assert.equal(t.MediaRecorder.instances.length, 1);
});

test("the recorder gets the first supported type; iPhone Safari lands on audio/mp4", async () => {
  const chrome = setup();
  await startTake(chrome);
  assert.deepEqual(plain(chrome.MediaRecorder.instances[0].options), {
    mimeType: MIME_CANDIDATES[0],
  });

  const safari = setup({ supportedTypes: ["audio/mp4"] });
  await startTake(safari);
  assert.deepEqual(safari.MediaRecorder.asked, MIME_CANDIDATES.slice(0, 3));
  assert.deepEqual(plain(safari.MediaRecorder.instances[0].options), { mimeType: "audio/mp4" });

  const unknown = setup({ supportedTypes: [] });
  await startTake(unknown);
  assert.deepEqual(unknown.MediaRecorder.asked, MIME_CANDIDATES);
  assert.equal(unknown.MediaRecorder.instances[0].options, undefined, "browser picks");
});

test("the timer ticks every 250 ms from performance.now and announces every 30 s", async () => {
  const t = setup();
  await startTake(t);
  assert.equal(t.clock.activeIntervals(), 1);

  t.clock.advance(999);
  assert.equal(t.timer.textContent, "0:00");
  t.clock.advance(1);
  assert.equal(t.timer.textContent, "0:01");
  t.clock.advance(29000);
  assert.equal(t.timer.textContent, "0:30");
  assert.deepEqual(t.calls.announce, ["Recording started", "0:30"]);
  t.clock.advance(35000);
  assert.equal(t.timer.textContent, "1:05");
  assert.deepEqual(t.calls.announce, ["Recording started", "0:30", "1:00"]);
});

test("Stop before 5 s shows Too short, uploads nothing and keeps the timer value", async () => {
  const t = setup();
  const recorder = await startTake(t);
  t.clock.advance(3400);
  recorder.emit("dataavailable", { data: chunk(10) });

  t.recordButton.click();
  assert.equal(recorder.stopCalls, 1);
  recorder.finish(chunk(5));
  await flush();

  assert.ok(t.streams[0].allTracksStopped(), "mic tracks are released");
  assert.equal(t.clock.activeIntervals(), 0, "the timer interval is cleared");
  assert.equal(t.calls.analyze.length, 0, "nothing is uploaded");
  assert.deepEqual(t.calls.announce, ["Recording started", "Recording stopped, 3 seconds"]);
  assert.equal(t.timer.textContent, "0:03");

  assert.equal(t.root.dataset.state, "error");
  const block = stateBlockParts(t);
  assert.equal(block.className, "state state--error");
  assert.equal(block.title, "Too short");
  assert.equal(block.body, MESSAGES.too_short);
  assert.equal(block.actionLabel, "Record again");

  block.action.click();
  assert.equal(t.root.dataset.state, "idle");
  assert.deepEqual(t.stateEl.children, []);
  assert.equal(t.timer.textContent, "0:03", "idle keeps the last value until the next take");
});

test("Stop after 5 s uploads the blob, saves the session and routes to results", async () => {
  const t = setup();
  const recorder = await startTake(t);
  t.chips[1].click();
  assert.equal(t.practice.selectedPassage().id, "a", "chips are inert while recording");
  t.clock.advance(12345);
  recorder.emit("dataavailable", { data: chunk(100) });
  recorder.emit("dataavailable", { data: chunk(0) });

  t.recordButton.click();
  recorder.finish(chunk(50));
  await flush();

  assert.ok(t.streams[0].allTracksStopped());
  assert.equal(t.clock.activeIntervals(), 0);
  assert.deepEqual(t.calls.announce, ["Recording started", "Recording stopped, 12 seconds"]);
  assert.equal(t.root.dataset.state, "uploading");
  assert.equal(t.timer.textContent, "0:12", "uploading holds the final value");
  assert.equal(t.stateEl.children[0].className, "state state--loading");

  assert.equal(t.calls.analyze.length, 1);
  const { blob, contentType } = t.calls.analyze[0];
  assert.equal(contentType, MIME_CANDIDATES[0]);
  assert.equal(blob.type, MIME_CANDIDATES[0]);
  assert.deepEqual(blob.parts, [chunk(100), chunk(50)], "empty chunks are dropped");

  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(t.calls.save.length, 1);
  assert.deepEqual(plain(t.calls.save[0]), {
    passageId: "a",
    passageTitle: "A",
    durationSeconds: 12.3,
    metrics: ANALYSIS.metrics,
    transcript: ANALYSIS.transcript,
  });
  assert.equal(t.calls.announce[t.calls.announce.length - 1], "Results ready");
  assert.equal(t.root.dataset.state, "idle");
  assert.deepEqual(t.stateEl.children, []);
  assert.deepEqual(plain(t.calls.go), [{ name: "results", params: { id: SAVED_ID } }]);
});

test("the blob takes the recorder's reported type, falling back to the chosen one", async () => {
  const reported = setup({ reportedMimeType: "audio/webm" });
  let recorder = await startTake(reported);
  reported.clock.advance(6000);
  reported.recordButton.click();
  recorder.finish(chunk(60));
  await flush();
  assert.equal(reported.calls.analyze[0].contentType, "audio/webm");
  assert.equal(reported.calls.analyze[0].blob.type, "audio/webm");

  const silent = setup();
  recorder = await startTake(silent);
  recorder.mimeType = "";
  silent.clock.advance(6000);
  silent.recordButton.click();
  recorder.finish(chunk(60));
  await flush();
  assert.equal(silent.calls.analyze[0].contentType, MIME_CANDIDATES[0]);
  assert.equal(silent.calls.analyze[0].blob.type, MIME_CANDIDATES[0]);
});

test("a second Stop tap before the recorder's stop event is ignored", async () => {
  const t = setup();
  const recorder = await startTake(t);
  t.clock.advance(6000);
  t.recordButton.click();
  t.recordButton.click();
  assert.equal(recorder.stopCalls, 1);
  recorder.finish(chunk(60));
  await flush();
  assert.equal(t.calls.analyze.length, 1);
  assert.equal(t.calls.getUserMedia.length, 1);
});

test("a recorder that stops on its own (track ended) is handled like a Stop tap", async () => {
  const t = setup();
  const recorder = await startTake(t);
  t.clock.advance(8000);
  recorder.finish(chunk(80));
  await flush();
  assert.equal(recorder.stopCalls, 0);
  assert.ok(t.streams[0].allTracksStopped());
  assert.equal(t.clock.activeIntervals(), 0);
  assert.equal(t.root.dataset.state, "uploading");
  assert.equal(t.calls.analyze.length, 1);
});

test("a denied mic shows Microphone blocked; the next Record tap asks again", async () => {
  const t = setup();
  t.recordButton.click();
  t.denyMic();
  await flush();

  assert.equal(t.root.dataset.state, "error");
  const block = stateBlockParts(t);
  assert.equal(block.title, "Microphone blocked");
  assert.equal(block.body, MIC_BLOCKED_BODY);
  assert.equal(block.actionLabel, "Try again");
  assert.equal(t.MediaRecorder.instances.length, 0);
  assert.deepEqual(t.calls.announce, []);

  block.action.click();
  assert.equal(t.root.dataset.state, "idle");
  assert.deepEqual(t.stateEl.children, []);

  t.recordButton.click();
  assert.equal(t.calls.getUserMedia.length, 2);
  t.grantMic();
  await flush();
  assert.equal(t.root.dataset.state, "recording");
});

test("a failed upload shows the api message; Retry upload re-sends the same blob", async () => {
  const t = setup();
  const recorder = await startTake(t);
  t.clock.advance(8000);
  t.recordButton.click();
  recorder.finish(chunk(80));
  await flush();

  t.rejectUpload(apiError("network"));
  await flush();
  assert.equal(t.root.dataset.state, "error");
  let block = stateBlockParts(t);
  assert.equal(block.title, "Upload failed");
  assert.equal(block.body, MESSAGES.network);
  assert.equal(block.actionLabel, "Retry upload");
  assert.equal(t.timer.textContent, "0:08", "error keeps the final value");
  assert.equal(t.calls.save.length, 0);

  block.action.click();
  assert.equal(t.root.dataset.state, "uploading");
  assert.equal(t.calls.analyze.length, 2);
  assert.equal(t.calls.analyze[1].blob, t.calls.analyze[0].blob);
  assert.equal(t.calls.analyze[1].contentType, t.calls.analyze[0].contentType);

  t.rejectUpload(apiError("provider"));
  await flush();
  block = stateBlockParts(t);
  assert.equal(block.body, MESSAGES.provider);

  block.action.click();
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(t.calls.save.length, 1);
  assert.equal(t.root.dataset.state, "idle");
  assert.equal(plain(t.calls.go)[0].name, "results");
});

test("a Record tap in the error state starts a fresh take and resets the timer", async () => {
  const t = setup();
  let recorder = await startTake(t);
  t.clock.advance(2000);
  t.recordButton.click();
  recorder.finish(chunk(20));
  await flush();
  assert.equal(t.root.dataset.state, "error");
  assert.equal(t.timer.textContent, "0:02");

  recorder = await startTake(t);
  assert.equal(t.calls.getUserMedia.length, 2);
  assert.equal(t.root.dataset.state, "recording");
  assert.deepEqual(t.stateEl.children, []);
  assert.equal(t.timer.textContent, "0:00");
  assert.equal(recorder.state, "recording");
});

test("a Record tap while uploading does nothing", async () => {
  const t = setup();
  const recorder = await startTake(t);
  t.clock.advance(6000);
  t.recordButton.click();
  recorder.finish(chunk(60));
  await flush();
  assert.equal(t.root.dataset.state, "uploading");

  t.recordButton.click();
  assert.equal(t.calls.getUserMedia.length, 1);
  assert.equal(t.root.dataset.state, "uploading");
});

test("app.pauses gets start(stream), stop() and reconcile(metrics, samples)", async () => {
  const samples = [0.1, 0.9, 0.2];
  const reconciled = { words_per_minute: 150, pauses: [[1, 2]] };
  const pauses = fakePauses(samples, reconciled);
  const t = setup({ pauses });

  const recorder = await startTake(t);
  assert.deepEqual(pauses.calls, [["start", t.streams[0]]]);

  t.clock.advance(6000);
  t.recordButton.click();
  recorder.finish(chunk(60));
  await flush();
  assert.deepEqual(pauses.calls[1], ["stop"]);
  assert.equal(pauses.calls.length, 2, "reconcile waits for the backend");

  t.resolveUpload(ANALYSIS);
  await flush();
  assert.deepEqual(pauses.calls[2], ["reconcile", ANALYSIS.metrics, samples]);
  assert.equal(t.calls.save[0].metrics, reconciled);
});

test("reconcile is skipped when app.pauses.stop() returns nothing", async () => {
  const pauses = fakePauses(null, { should: "not be used" });
  const t = setup({ pauses });
  const recorder = await startTake(t);
  t.clock.advance(6000);
  t.recordButton.click();
  recorder.finish(chunk(60));
  await flush();
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.deepEqual(pauses.calls.map((call) => call[0]), ["start", "stop"]);
  assert.equal(t.calls.save[0].metrics, ANALYSIS.metrics);
});

test("hide() mid-take releases recorder, tracks, interval and pauses; no upload", async () => {
  const pauses = fakePauses([0.5], {});
  const t = setup({ pauses });
  const recorder = await startTake(t);
  t.clock.advance(7000);

  t.practice.hide();
  assert.equal(recorder.stopCalls, 1);
  assert.ok(t.streams[0].allTracksStopped());
  assert.equal(t.clock.activeIntervals(), 0);
  assert.deepEqual(pauses.calls.map((call) => call[0]), ["start", "stop"]);
  assert.equal(t.root.dataset.state, "idle", "the abandoned take is dropped");

  recorder.finish(chunk(70));
  await flush();
  assert.equal(t.calls.analyze.length, 0);
  assert.deepEqual(t.calls.announce, ["Recording started"]);

  t.practice.show({});
  assert.equal(t.root.dataset.state, "idle");
  await startTake(t);
  assert.equal(t.MediaRecorder.instances.length, 2);
  assert.deepEqual(pauses.calls.map((call) => call[0]), ["start", "stop", "start"]);
});

test("hide() in idle, uploading and error releases nothing and keeps the state", async () => {
  const t = setup();
  t.practice.hide();
  assert.equal(t.root.dataset.state, "idle");

  const recorder = await startTake(t);
  t.clock.advance(6000);
  t.recordButton.click();
  recorder.finish(chunk(60));
  await flush();
  t.practice.hide();
  assert.equal(t.root.dataset.state, "uploading", "the upload keeps going off screen");
  t.resolveUpload(ANALYSIS);
  await flush();
  assert.equal(t.calls.save.length, 1);
  assert.equal(plain(t.calls.go)[0].name, "results");
});

test("hide() while the mic prompt is open releases the stream when it arrives", async () => {
  const t = setup();
  t.recordButton.click();
  t.practice.hide();
  t.grantMic();
  await flush();
  assert.ok(t.streams[0].allTracksStopped());
  assert.equal(t.MediaRecorder.instances.length, 0);
  assert.equal(t.root.dataset.state, "idle");
  assert.deepEqual(t.calls.announce, []);

  t.practice.show({});
  await startTake(t);
  assert.equal(t.MediaRecorder.instances.length, 1, "a later tap records normally");
});
