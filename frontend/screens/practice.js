/* screens/practice.js: app.screens.practice, the home screen (DESIGN.md sections 6 and 7).
   mount() builds the passage chips, passage card, timer, record button, hint and state block
   inside its root once; render(state, detail) is the only function that changes that DOM
   afterwards, apart from the timer tick. The Record tap asks for the microphone, MediaRecorder
   collects the take, and Stop uploads it through app.api and saves it with app.store. */
(function () {
  "use strict";

  const STATES = ["idle", "recording", "uploading", "error"];

  const HINT_TEXT = "Tap to record. Stop uploads automatically.";
  const LOADING_TITLE = "Analyzing your speech";
  const LOADING_BODY = "Usually 5 to 15 seconds.";
  const TIMER_START = "0:00";

  // Container types in order of preference; iPhone Safari only says yes to audio/mp4.
  const MIME_CANDIDATES = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  const CHUNK_EVERY_MS = 1000;
  const TIMER_TICK_MS = 250;
  const ANNOUNCE_EVERY_SECONDS = 30;
  const MIN_TAKE_SECONDS = 5;

  // Fixed copy for the error blocks this screen shows (DESIGN.md section 8). The too-short
  // and upload sentences live in app.api.messages so each exists exactly once.
  const MIC_BLOCKED_TITLE = "Microphone blocked";
  const MIC_BLOCKED_BODY =
    "Microphone is blocked. Allow it in your browser settings, then tap Record.";
  const MIC_BLOCKED_ACTION = "Try again";
  const TOO_SHORT_TITLE = "Too short";
  const TOO_SHORT_ACTION = "Record again";
  const UPLOAD_FAILED_TITLE = "Upload failed";
  const UPLOAD_FAILED_ACTION = "Retry upload";
  const STARTED_ANNOUNCEMENT = "Recording started";
  const RESULTS_READY_ANNOUNCEMENT = "Results ready";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const MIC_ICON_SIZE = "28";
  const STOP_ICON_SIZE = "24";

  // The screen's <section>; its data-state attribute drives the CSS for every state.
  let root = null;
  // The one string every other piece of this screen is derived from.
  let state = "idle";
  let selectedPassageId = null;

  // Nodes built by mount() and repainted by render(); only tickTimer() writes the timer.
  const nodes = {
    chips: [],
    cardTitle: null,
    cardTarget: null,
    cardText: null,
    timer: null,
    recordButton: null,
    recordLabel: null,
    stateBlock: null,
  };

  // Everything a live take holds, from the Record tap until Stop or hide() lets it go.
  const capture = {
    awaitingMic: false,
    stream: null,
    recorder: null,
    chunks: [],
    chosenMimeType: "",
    startedAt: 0,
    timerId: null,
    announcedBlocks: 0,
    pausesStarted: false,
  };

  // The finished take, kept through uploading and error so Retry re-sends the same blob.
  let pendingTake = null;

  // The state table from DESIGN.md section 7 as plain data, so it can be tested without a DOM.
  // showHint and showRecord mirror the [data-state] rules in styles.css.
  function viewFor(nextState) {
    if (!STATES.includes(nextState)) {
      throw new Error("practice: unknown state " + JSON.stringify(nextState));
    }
    const recording = nextState === "recording";
    return {
      dataState: nextState,
      recordLabel: recording ? "Stop" : "Record",
      recordAriaLabel: recording ? "Stop recording" : "Start recording",
      recordPressed: recording,
      chipsDisabled: nextState !== "idle",
      showHint: nextState === "idle" || recording,
      showRecord: nextState !== "uploading",
    };
  }

  function selectedPassage() {
    const passages = app.passages || [];
    return passages.find((entry) => entry.id === selectedPassageId) || passages[0] || null;
  }

  function mount(screenRoot) {
    root = screenRoot;
    const passages = app.passages || [];
    selectedPassageId = passages.length > 0 ? passages[0].id : null;

    const body = root.querySelector(".screen__body");
    body.appendChild(buildChipRow(passages));
    body.appendChild(buildPassageCard());
    body.appendChild(buildTimer());
    body.appendChild(buildRecordButton());
    nodes.recordLabel = app.ui.el("span", { class: "btn-record__label" });
    body.appendChild(nodes.recordLabel);
    body.appendChild(app.ui.el("p", { class: "practice__hint", text: HINT_TEXT }));
    nodes.stateBlock = app.ui.el("div", { class: "practice__state" });
    body.appendChild(nodes.stateBlock);

    render("idle");
  }

  function buildChipRow(passages) {
    nodes.chips = passages.map((passage) =>
      app.ui.el("button", {
        class: "chip",
        type: "button",
        "aria-pressed": "false",
        dataset: { passageId: passage.id },
        text: passage.title,
        onClick: () => selectPassage(passage.id),
      }),
    );
    return app.ui.el("div", { class: "chip-row" }, nodes.chips);
  }

  function buildPassageCard() {
    nodes.cardTitle = app.ui.el("h2", { class: "passage-card__title" });
    nodes.cardTarget = app.ui.el("p", { class: "passage-card__target" });
    nodes.cardText = app.ui.el("p", { class: "passage-card__text" });
    return app.ui.el("section", { class: "passage-card" }, [
      nodes.cardTitle,
      nodes.cardTarget,
      nodes.cardText,
    ]);
  }

  function buildTimer() {
    nodes.timer = app.ui.el("div", { class: "timer num", "aria-live": "off", text: TIMER_START });
    return app.ui.el("div", { class: "practice__timer" }, [
      app.ui.el("span", { class: "rec-dot", "aria-hidden": "true" }),
      nodes.timer,
    ]);
  }

  function buildRecordButton() {
    nodes.recordButton = app.ui.el(
      "button",
      { class: "btn-record", type: "button", onClick: onRecordTap },
      [micIcon(), stopIcon()],
    );
    return nodes.recordButton;
  }

  // Chips only respond in idle; the disabled flag already blocks taps in the other states.
  function selectPassage(passageId) {
    if (state !== "idle") {
      return;
    }
    selectedPassageId = passageId;
    render("idle");
  }

  // Applies one state to the screen. `detail` is only read for "error":
  // {title, body, actionLabel, onAction}, passed straight to app.ui.renderState.
  function render(nextState, detail) {
    const view = viewFor(nextState);
    state = nextState;
    root.dataset.state = view.dataState;

    paintChips(view);
    paintPassageCard(selectedPassage());
    paintRecordButton(view);
    paintStateBlock(view.dataState, detail || {});
  }

  function paintChips(view) {
    nodes.chips.forEach((chip) => {
      const selected = chip.dataset.passageId === selectedPassageId;
      chip.classList.toggle("chip--selected", selected);
      chip.setAttribute("aria-pressed", String(selected));
      chip.disabled = view.chipsDisabled;
    });
  }

  function paintPassageCard(passage) {
    if (!passage) {
      nodes.cardTitle.textContent = "";
      nodes.cardTarget.textContent = "";
      nodes.cardText.textContent = "";
      return;
    }
    const [lo, hi] = passage.targetWpm;
    nodes.cardTitle.textContent = passage.title;
    nodes.cardTarget.textContent = "Target " + lo + " to " + hi + " wpm";
    nodes.cardText.textContent = passage.text;
  }

  function paintRecordButton(view) {
    nodes.recordButton.setAttribute("aria-label", view.recordAriaLabel);
    nodes.recordButton.setAttribute("aria-pressed", String(view.recordPressed));
    nodes.recordLabel.textContent = view.recordLabel;
  }

  function paintStateBlock(dataState, detail) {
    if (dataState === "uploading") {
      app.ui.renderState(nodes.stateBlock, {
        kind: "loading",
        title: LOADING_TITLE,
        body: LOADING_BODY,
      });
    } else if (dataState === "error") {
      app.ui.renderState(nodes.stateBlock, {
        kind: "error",
        title: detail.title,
        body: detail.body,
        actionLabel: detail.actionLabel,
        onAction: detail.onAction,
      });
    } else {
      app.ui.clear(nodes.stateBlock);
    }
  }

  // Coming back to the screen starts a fresh take unless one is already in flight.
  function show() {
    if (state !== "recording" && state !== "uploading") {
      render("idle");
    }
  }

  // Leaving mid-take must never leak the microphone: let the recorder, tracks, timer and pause
  // sampler go and drop the take. An upload in flight keeps going; show() will find it.
  function hide() {
    capture.awaitingMic = false;
    if (state === "recording") {
      releaseCapture();
      render("idle");
    }
  }

  // The record button: Stop while recording, otherwise ask for the microphone and begin.
  // This is the only place the permission prompt can come from, so it never fires on load.
  async function onRecordTap() {
    if (state === "recording") {
      stopTake();
      return;
    }
    if (state === "uploading" || capture.awaitingMic) {
      return;
    }
    capture.awaitingMic = true;
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Denied, dismissed or no microphone at all: shown as "blocked" below.
    }
    if (!capture.awaitingMic) {
      // hide() ran while the prompt was open: nobody is watching, so let the mic go.
      if (stream) {
        stopTracks(stream);
      }
      return;
    }
    capture.awaitingMic = false;
    if (stream === null) {
      render("error", {
        title: MIC_BLOCKED_TITLE,
        body: MIC_BLOCKED_BODY,
        actionLabel: MIC_BLOCKED_ACTION,
        onAction: () => render("idle"),
      });
      return;
    }
    beginTake(stream);
  }

  function beginTake(stream) {
    pendingTake = null;
    capture.stream = stream;
    if (app.pauses) {
      app.pauses.start(stream);
      capture.pausesStarted = true;
    }
    capture.chosenMimeType = supportedMimeType();
    capture.chunks = [];
    capture.recorder = capture.chosenMimeType
      ? new MediaRecorder(stream, { mimeType: capture.chosenMimeType })
      : new MediaRecorder(stream);
    capture.recorder.addEventListener("dataavailable", collectChunk);
    capture.recorder.addEventListener("stop", onRecorderStopped);
    capture.recorder.start(CHUNK_EVERY_MS);
    startTimer();
    app.ui.announce(STARTED_ANNOUNCEMENT);
    render("recording");
  }

  // The first container this browser can encode, or "" to let MediaRecorder pick its own
  // (it then reports the choice in recorder.mimeType).
  function supportedMimeType() {
    return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function collectChunk(event) {
    if (event.data && event.data.size > 0) {
      capture.chunks.push(event.data);
    }
  }

  // Stop tap. The blob is built in onRecorderStopped, once the recorder hands over its last
  // chunk; a second tap finds the recorder already inactive and does nothing.
  function stopTake() {
    const recorder = capture.recorder;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  // Runs once per take: after a Stop tap, or on its own when the browser ends the track.
  function onRecorderStopped() {
    const durationSeconds = elapsedSeconds();
    const contentType = capture.recorder.mimeType || capture.chosenMimeType;
    const { chunks, samples } = releaseCapture();
    app.ui.announce("Recording stopped, " + Math.floor(durationSeconds) + " seconds");

    if (durationSeconds < MIN_TAKE_SECONDS) {
      render("error", {
        title: TOO_SHORT_TITLE,
        body: app.api.messages.too_short,
        actionLabel: TOO_SHORT_ACTION,
        onAction: () => render("idle"),
      });
      return;
    }

    const passage = selectedPassage();
    pendingTake = {
      blob: new Blob(chunks, { type: contentType }),
      contentType,
      durationSeconds: Math.round(durationSeconds * 10) / 10,
      samples,
      passageId: passage ? passage.id : null,
      passageTitle: passage ? passage.title : "",
    };
    upload();
  }

  // Lets go of everything the live take holds and hands back what the caller may still want:
  // the chunks collected so far and the pause samples (null without app.pauses).
  function releaseCapture() {
    stopTimer();
    const { recorder, stream, chunks } = capture;
    if (recorder) {
      recorder.removeEventListener("dataavailable", collectChunk);
      recorder.removeEventListener("stop", onRecorderStopped);
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    }
    if (stream) {
      stopTracks(stream);
    }
    const samples = capture.pausesStarted ? app.pauses.stop() : null;
    capture.recorder = null;
    capture.stream = null;
    capture.chunks = [];
    capture.pausesStarted = false;
    return { chunks, samples };
  }

  function stopTracks(stream) {
    stream.getTracks().forEach((track) => track.stop());
  }

  // Sends the pending take, saves the session and hands off to Results. "Retry upload" calls
  // this again with the same blob; app.pauses, when present, folds its samples into metrics.
  async function upload() {
    const take = pendingTake;
    if (take === null) {
      return;
    }
    render("uploading");
    try {
      const result = await app.api.analyze(take.blob, take.contentType);
      const metrics =
        app.pauses && take.samples
          ? app.pauses.reconcile(result.metrics, take.samples)
          : result.metrics;
      const id = await app.store.save({
        passageId: take.passageId,
        passageTitle: take.passageTitle,
        durationSeconds: take.durationSeconds,
        metrics,
        transcript: result.transcript,
      });
      pendingTake = null;
      app.ui.announce(RESULTS_READY_ANNOUNCEMENT);
      render("idle");
      app.router.go("results", { id });
    } catch (error) {
      render("error", {
        title: UPLOAD_FAILED_TITLE,
        body: error.message,
        actionLabel: UPLOAD_FAILED_ACTION,
        onAction: upload,
      });
    }
  }

  // The timer: a 250 ms tick paints the elapsed clock and announces it every 30 s.
  function startTimer() {
    capture.startedAt = performance.now();
    capture.announcedBlocks = 0;
    nodes.timer.textContent = TIMER_START;
    capture.timerId = setInterval(tickTimer, TIMER_TICK_MS);
  }

  function tickTimer() {
    const elapsed = elapsedSeconds();
    nodes.timer.textContent = app.ui.formatClock(elapsed);
    const blocks = Math.floor(elapsed / ANNOUNCE_EVERY_SECONDS);
    if (blocks > capture.announcedBlocks) {
      capture.announcedBlocks = blocks;
      app.ui.announce(app.ui.formatClock(elapsed));
    }
  }

  function stopTimer() {
    if (capture.timerId !== null) {
      clearInterval(capture.timerId);
      capture.timerId = null;
    }
  }

  function elapsedSeconds() {
    return (performance.now() - capture.startedAt) / 1000;
  }

  // White on the record button in both color schemes; the button itself uses --record.
  function micIcon() {
    const svg = svgEl("svg", {
      class: "btn-record__mic",
      width: MIC_ICON_SIZE,
      height: MIC_ICON_SIZE,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "white",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    });
    svg.appendChild(svgEl("path", { d: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" }));
    svg.appendChild(svgEl("path", { d: "M19 11a7 7 0 0 1-14 0" }));
    svg.appendChild(svgEl("line", { x1: "12", y1: "18", x2: "12", y2: "22" }));
    svg.appendChild(svgEl("line", { x1: "8", y1: "22", x2: "16", y2: "22" }));
    return svg;
  }

  function stopIcon() {
    const svg = svgEl("svg", {
      class: "btn-record__stop",
      width: STOP_ICON_SIZE,
      height: STOP_ICON_SIZE,
      viewBox: "0 0 24 24",
      fill: "white",
      "aria-hidden": "true",
    });
    svg.appendChild(svgEl("rect", { x: "4", y: "4", width: "16", height: "16", rx: "3" }));
    return svg;
  }

  // SVG elements need their own namespace and take class via setAttribute.
  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach((key) => node.setAttribute(key, attrs[key]));
    return node;
  }

  app.screens.practice = {
    mount,
    show,
    hide,
    STATES,
    viewFor,
    render,
    selectedPassage,
    get state() {
      return state;
    },
  };
})();
