/* screens/practice.js: app.screens.practice, the home screen (DESIGN.md sections 6 and 7).
   mount() builds the Talk / Read switch, chips, card, timer, record button, hint (with Talk's
   script box) and state block once; render(state, detail) repaints them. Stop uploads the
   take with its script (a Read passage's text, or the one pasted on Talk) through app.api and
   saves it with app.store. It never asks for the microphone before a Record tap, and never
   stores audio. */
(function () {
  "use strict";

  const STATES = ["idle", "recording", "uploading", "error"];

  // The mode switch's tabs, in order: Talk lists the prompts and Read the passages.
  const MODES = [
    { kind: "prompt", label: "Talk" },
    { kind: "passage", label: "Read" },
  ];
  const MODE_SWITCH_LABEL = "Practice mode";
  const NEW_TOPIC_LABEL = "New topic";
  const NEW_TOPIC_ICON_SIZE = 16;
  // The card's title names the scrolling text, which is a region keyboard users can focus.
  const CARD_TITLE_ID = "practice-card-title";
  const LIMIT_PREFIX = "/ ";
  const LIMIT_OVER_CLASS = "practice__limit-bar--over";

  // Talk's optional script box: a speaker giving a prepared speech pastes it here, and the take
  // is checked against it as a Read passage is. The cap is the backend's MAX_SCRIPT_CHARACTERS.
  const SCRIPT_KIND = "prompt";
  const SCRIPT_SUMMARY = "Paste your script (optional)";
  // Once the box holds a script the closed summary names it, so it is never sent unnoticed.
  const ATTACHED_SUMMARY_PREFIX = "Your script (";
  const SCRIPT_LABEL = "Your script";
  const SCRIPT_NOTE = "Your take is checked against it for restarts, skips and misreads.";
  const SCRIPT_INPUT_ID = "practice-script";
  const SCRIPT_NOTE_ID = "practice-script-note";
  const SCRIPT_MAX_CHARACTERS = 20000;

  // The theme toggle beside the wordmark shows the current choice; a tap moves to the next one
  // (app.ui.nextTheme: auto, dark, light) and the live region names it (DESIGN.md section 8).
  const THEME_TOGGLE = {
    auto: {
      icon: "contrast",
      label: "Theme: Auto. Switch to dark.",
      announcement: "Theme: Auto",
    },
    dark: {
      icon: "moon",
      label: "Theme: Dark. Switch to light.",
      announcement: "Theme: Dark",
    },
    light: {
      icon: "sun",
      label: "Theme: Light. Switch to auto.",
      announcement: "Theme: Light",
    },
  };

  const HINT_TEXT = "Tap to record. Stop uploads automatically.";
  const RECORDING_HINT_TEXT = "Tap Stop when you finish. It uploads right away.";
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
    "Microphone is blocked. Allow it in your browser settings, then try again.";
  const MIC_BLOCKED_ACTION = "Try again";
  const TOO_SHORT_TITLE = "Too short";
  const TOO_SHORT_ACTION = "Record again";
  const UPLOAD_FAILED_TITLE = "Upload failed";
  const UPLOAD_FAILED_ACTION = "Retry upload";
  const NEW_TAKE_ACTION = "Record a new take";
  const SAMPLE_URL = "sample-session.json";
  const SAMPLE_LABEL = "See a sample result";
  const SAMPLE_ERROR_TITLE = "Sample unavailable";
  const SAMPLE_ERROR_BODY = "Could not load the sample. Try again.";
  const SAMPLE_ERROR_ACTION = "Try again";
  const STARTED_ANNOUNCEMENT = "Recording started";
  const STOPPED_ANNOUNCEMENT = "Recording stopped, ";
  const RESULTS_READY_ANNOUNCEMENT = "Results ready";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const MIC_ICON_SIZE = "28";
  const STOP_ICON_SIZE = "24";

  // The screen's <section>; its data-state attribute drives the CSS for every state.
  let root = null;
  // The one string every other piece of this screen is derived from.
  let state = "idle";

  // What the speaker picked, kept as they left it while the app is open: the tab showing
  // ("prompt" is Talk, "passage" is Read), each tab's own selected entry id, and the topic each
  // prompt with topics is on (by entry id; a prompt starts on its first topic).
  let currentKind = MODES[0].kind;
  const selectedIdByKind = {};
  const topicIndexById = {};

  // The theme the toggle shows. Kept here rather than re-read from storage on each tap, so the
  // toggle still cycles when localStorage is blocked and app.ui.getTheme() can only say "auto".
  let themeChoice = "auto";

  // Nodes built by mount(). render() repaints them; startTimer(), tickTimer() and resetClock()
  // write the clock. The theme toggle is the one node index.html builds: mount() finds it in
  // the header.
  const nodes = {
    themeToggle: null,
    modeOptions: [],
    chipRow: null,
    chips: [],
    cardTitle: null,
    cardTarget: null,
    cardText: null,
    newTopic: null,
    timer: null,
    limit: null,
    limitBar: null,
    limitFill: null,
    recordButton: null,
    recordLabel: null,
    hintText: null,
    sampleButton: null,
    stateBlock: null,
    scriptBox: null,
    scriptSummary: null,
    scriptInput: null,
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

  // The Upload failed block's detail, kept with its take. The block says the recording is still
  // here and the nav shows beside it, so the speaker may leave; show() then draws it again
  // instead of idle. letTakeGo() clears it with the take, so it is null whenever none is held.
  let failedUpload = null;

  // The seconds on the clock: the live take's, held through uploading. A take that is let go
  // (saved, dropped, turned down by the backend as too short, or left behind by leaving the
  // screen) goes back to 0:00 through resetClock(). After a Stop under 5 seconds the clock
  // keeps its time until the next take starts.
  let shownSeconds = 0;

  // What the card and the chip row last showed, so render() scrolls the text back to the top
  // only when the passage or topic changes, and the chips back to the start only when the tab
  // changes; a state change never loses the reader's place.
  let paintedTextKey = null;
  let paintedKind = null;

  // True from the sample tap until its fetch, validation and save have settled.
  let loadingSample = false;

  // The state table from DESIGN.md section 7 as plain data, so it can be tested without a DOM.
  // showHint and showRecord mirror the [data-state] rules in styles.css: the record button and
  // its label show in idle and recording only, and error puts its block in their place.
  // chipsDisabled holds the tabs and New topic as well; New topic shows in idle only.
  function viewFor(nextState) {
    if (!STATES.includes(nextState)) {
      throw new Error("practice: unknown state " + JSON.stringify(nextState));
    }
    const idle = nextState === "idle";
    const recording = nextState === "recording";
    return {
      dataState: nextState,
      recordLabel: recording ? "Stop" : "Record",
      recordAriaLabel: recording ? "Stop recording" : "Start recording",
      recordPressed: recording,
      chipsDisabled: !idle,
      showNewTopic: idle,
      showHint: idle || recording,
      hintText: recording ? RECORDING_HINT_TEXT : HINT_TEXT,
      showRecord: idle || recording,
    };
  }

  // The entry the current tab has selected, or null before mount or for an empty tab.
  function selectedPassage() {
    const id = selectedIdByKind[currentKind];
    return (app.passages || []).find((entry) => entry.id === id) || null;
  }

  // Helpers over the passage data; none of them touches the DOM or app.ui.

  // The tab Practice opens on is the first entry's, so the data's order decides; passages.js
  // lists the prompts first because Talk is home.
  function firstKind(passages) {
    const first = passages.find((entry) => MODES.some((mode) => mode.kind === entry.kind));
    return first ? first.kind : MODES[0].kind;
  }

  function entriesOfKind(passages, kind) {
    return passages.filter((entry) => entry.kind === kind);
  }

  function hasTopics(entry) {
    return Boolean(entry) && Array.isArray(entry.topics) && entry.topics.length > 0;
  }

  // The time limit in seconds, or null for an untimed entry.
  function limitOf(entry) {
    const limit = entry ? entry.timeLimitSeconds : null;
    return Number.isFinite(limit) && limit > 0 ? limit : null;
  }

  // How full the time-limit bar is: elapsed over limit, capped at 1, to four decimals.
  function limitRatio(seconds, limit) {
    const ratio = Math.min(1, Math.max(0, seconds / limit));
    return Math.round(ratio * 10000) / 10000;
  }

  function topicIndexOf(entry) {
    return topicIndexById[entry.id] || 0;
  }

  // What the card shows: the current topic of a prompt with topics, otherwise the entry's text.
  function cardTextOf(entry) {
    return hasTopics(entry) ? entry.topics[topicIndexOf(entry)] : entry.text;
  }

  function mount(screenRoot) {
    root = screenRoot;
    const passages = app.passages || [];
    currentKind = firstKind(passages);
    MODES.forEach((mode) => {
      const [first] = entriesOfKind(passages, mode.kind);
      selectedIdByKind[mode.kind] = first ? first.id : null;
    });

    // The header's toggle is absent from test sections that hold only the body.
    nodes.themeToggle = root.querySelector(".theme-toggle");
    if (nodes.themeToggle) {
      themeChoice = app.ui.getTheme();
      nodes.themeToggle.addEventListener("click", onThemeTap);
      paintThemeToggle();
    }

    const body = root.querySelector(".screen__body");
    body.appendChild(buildModeSwitch());
    body.appendChild(buildChipRow(passages));
    body.appendChild(buildPassageCard());
    body.appendChild(buildTimer());
    body.appendChild(buildRecordButton());
    nodes.recordLabel = app.ui.el("span", { class: "btn-record__label" });
    body.appendChild(nodes.recordLabel);
    // The words get their own span so short screens can hide them and keep the sample button.
    // Talk's script box closes the row beside the sample button, so it costs the one-screen
    // layout no row of its own (DESIGN.md section 3).
    nodes.hintText = app.ui.el("span", { class: "practice__hint-text", text: HINT_TEXT });
    body.appendChild(
      app.ui.el("div", { class: "practice__hint" }, [
        nodes.hintText,
        buildSampleButton(),
        buildScriptBox(),
      ]),
    );
    nodes.stateBlock = app.ui.el("div", { class: "practice__state" });
    body.appendChild(nodes.stateBlock);

    render("idle");
  }

  // A closed <details> in the hint row: its summary opens a labeled textarea. The note under
  // the label says what the script is for and describes the box to screen readers.
  function buildScriptBox() {
    nodes.scriptInput = app.ui.el("textarea", {
      class: "practice__script-input",
      id: SCRIPT_INPUT_ID,
      rows: "6",
      maxlength: String(SCRIPT_MAX_CHARACTERS),
      "aria-describedby": SCRIPT_NOTE_ID,
      onInput: paintScriptSummary,
    });
    nodes.scriptSummary = app.ui.el("summary", {
      class: "practice__script-summary",
      text: SCRIPT_SUMMARY,
    });
    nodes.scriptBox = app.ui.el("details", { class: "practice__script" }, [
      nodes.scriptSummary,
      app.ui.el("label", {
        class: "practice__script-label",
        for: SCRIPT_INPUT_ID,
        text: SCRIPT_LABEL,
      }),
      app.ui.el("p", { class: "practice__script-note", id: SCRIPT_NOTE_ID, text: SCRIPT_NOTE }),
      nodes.scriptInput,
    ]);
    return nodes.scriptBox;
  }

  function buildSampleButton() {
    nodes.sampleButton = app.ui.el("button", {
      class: "btn btn--ghost practice__sample",
      type: "button",
      text: SAMPLE_LABEL,
      onClick: onSampleTap,
    });
    return nodes.sampleButton;
  }

  // Loads the bundled take for visitors without a microphone and opens it in Results. The
  // outcome is only acted on while the screen is still idle, so a take that began meanwhile
  // is never overwritten.
  async function onSampleTap() {
    if (loadingSample) {
      return;
    }
    loadingSample = true;
    let id = null;
    try {
      const response = await fetch(SAMPLE_URL);
      if (!response.ok) {
        throw new Error("sample missing");
      }
      const file = await response.json();
      if (!isSampleFile(file)) {
        throw new Error("sample malformed");
      }
      id = await app.store.save({
        passageId: file.passageId,
        passageTitle: file.passageTitle,
        durationSeconds: file.durationSeconds,
        metrics: file.metrics,
        transcript: file.transcript,
      });
    } catch {
      id = null;
    } finally {
      loadingSample = false;
    }
    if (state !== "idle") {
      return;
    }
    if (id === null) {
      render("error", {
        title: SAMPLE_ERROR_TITLE,
        body: SAMPLE_ERROR_BODY,
        actionLabel: SAMPLE_ERROR_ACTION,
        onAction: () => backToIdle(nodes.sampleButton),
      });
      return;
    }
    app.router.go("results", { id });
  }

  function isSampleFile(file) {
    return (
      file !== null &&
      typeof file === "object" &&
      Array.isArray(file.transcript) &&
      file.metrics !== null &&
      typeof file.metrics === "object"
    );
  }

  // Talk or Read: toggle buttons in a labeled group (DESIGN.md section 6, "Segmented control").
  function buildModeSwitch() {
    nodes.modeOptions = MODES.map((mode) =>
      app.ui.el("button", {
        class: "segmented__option",
        type: "button",
        "aria-pressed": "false",
        dataset: { kind: mode.kind },
        text: mode.label,
        onClick: () => selectKind(mode.kind),
      }),
    );
    return app.ui.el(
      "div",
      { class: "segmented", role: "group", "aria-label": MODE_SWITCH_LABEL },
      nodes.modeOptions,
    );
  }

  // One chip per entry, built once; render() shows only the current tab's chips.
  function buildChipRow(passages) {
    nodes.chips = passages.map((passage) =>
      app.ui.el("button", {
        class: "chip",
        type: "button",
        "aria-pressed": "false",
        dataset: { passageId: passage.id, kind: passage.kind },
        text: chipLabel(passage),
        onClick: () => selectPassage(passage.id),
      }),
    );
    nodes.chipRow = app.ui.el(
      "div",
      { class: "chip-row", onFocusin: revealFocusedChip },
      nodes.chips,
    );
    return nodes.chipRow;
  }

  // A chip that takes focus while partly under the row's fade scrolls fully into view, inside the
  // row's scroll padding, so its focus ring shows whole. The test fakes have no scrollIntoView.
  function revealFocusedChip(event) {
    const chip = event.target;
    if (chip && typeof chip.scrollIntoView === "function") {
      chip.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
  }

  // "Your day 1:00" for a timed entry, the bare title for an untimed one.
  function chipLabel(passage) {
    const limit = limitOf(passage);
    return limit === null ? passage.title : passage.title + " " + app.ui.formatClock(limit);
  }

  // The card holds the title, New topic, the target and the text. New topic comes right after
  // the title, so focus order matches its place at the top right. Its refresh icon follows the
  // words in the DOM, so the label is plain text; CSS draws the icon first. The text scrolls on
  // its own, so it is a region named by the title that takes focus: keyboard users can scroll a
  // long passage in every browser (Safari never focuses a scroller by itself).
  function buildPassageCard() {
    nodes.cardTitle = app.ui.el("h2", { class: "passage-card__title", id: CARD_TITLE_ID });
    nodes.cardTarget = app.ui.el("p", { class: "passage-card__target" });
    nodes.cardText = app.ui.el("p", {
      class: "passage-card__text",
      tabindex: "0",
      role: "region",
      "aria-labelledby": CARD_TITLE_ID,
    });
    nodes.newTopic = app.ui.el(
      "button",
      {
        class: "btn btn--ghost passage-card__new",
        type: "button",
        text: NEW_TOPIC_LABEL,
        onClick: showNextTopic,
      },
      [app.ui.icon("refresh", NEW_TOPIC_ICON_SIZE)],
    );
    return app.ui.el("section", { class: "passage-card" }, [
      nodes.cardTitle,
      nodes.newTopic,
      nodes.cardTarget,
      nodes.cardText,
    ]);
  }

  // The clock, plus "/ 1:00" and a bar that fills toward the limit for a timed entry.
  function buildTimer() {
    nodes.timer = app.ui.el("div", { class: "timer num", "aria-live": "off", text: TIMER_START });
    nodes.limit = app.ui.el("span", { class: "practice__limit num" });
    nodes.limitFill = app.ui.el("div", { class: "practice__limit-fill" });
    nodes.limitBar = app.ui.el("div", { class: "practice__limit-bar", "aria-hidden": "true" }, [
      nodes.limitFill,
    ]);
    return app.ui.el("div", { class: "practice__timer" }, [
      app.ui.el("span", { class: "rec-dot", "aria-hidden": "true" }),
      nodes.timer,
      nodes.limit,
      nodes.limitBar,
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

  // Tabs, chips and New topic only respond in idle; their disabled flags already block taps in
  // the other states. A chip selects its entry on that entry's own tab.
  function selectPassage(passageId) {
    const entry = (app.passages || []).find((candidate) => candidate.id === passageId);
    if (state !== "idle" || !entry) {
      return;
    }
    currentKind = entry.kind;
    selectedIdByKind[entry.kind] = entry.id;
    render("idle");
  }

  function selectKind(kind) {
    if (state !== "idle" || kind === currentKind) {
      return;
    }
    currentKind = kind;
    render("idle");
  }

  // The selected prompt's next topic, back to the first after the last. Focus stays on New
  // topic while the card changes beside it, so the live region reads the new topic out.
  function showNextTopic() {
    const entry = selectedPassage();
    if (state !== "idle" || !hasTopics(entry)) {
      return;
    }
    topicIndexById[entry.id] = (topicIndexOf(entry) + 1) % entry.topics.length;
    render("idle");
    app.ui.announce(cardTextOf(entry));
  }

  // Applies one state to the screen. It is the only code that changes this screen's DOM, apart
  // from the clock (the timer tick writes it and the bar, resetClock() puts it back to 0:00), a
  // focused chip scrolling into view, and the header's theme toggle, which repaints itself.
  // `detail` is only read for "error": {title, body, actionLabel, onAction, secondaryLabel?,
  // onSecondary?}, passed straight to app.ui.renderState.
  function render(nextState, detail) {
    const view = viewFor(nextState);
    state = nextState;
    root.dataset.state = view.dataState;

    const passage = selectedPassage();
    paintModeSwitch(view);
    paintChips(view);
    paintPassageCard(view, passage);
    paintTimeLimit(passage);
    paintRecordButton(view);
    paintScriptBox(view);
    nodes.hintText.textContent = view.hintText;
    paintStateBlock(view.dataState, detail || {});
  }

  // A tab with no entries stays disabled, so the screen never shows an empty card.
  function paintModeSwitch(view) {
    const passages = app.passages || [];
    nodes.modeOptions.forEach((option) => {
      const kind = option.dataset.kind;
      const selected = kind === currentKind;
      option.classList.toggle("segmented__option--selected", selected);
      option.setAttribute("aria-pressed", String(selected));
      option.disabled = view.chipsDisabled || entriesOfKind(passages, kind).length === 0;
    });
  }

  // Only the current tab's chips show; switching tabs scrolls the row back to its start.
  function paintChips(view) {
    const selectedId = selectedIdByKind[currentKind];
    nodes.chips.forEach((chip) => {
      const inTab = chip.dataset.kind === currentKind;
      const selected = inTab && chip.dataset.passageId === selectedId;
      chip.hidden = !inTab;
      chip.classList.toggle("chip--selected", selected);
      chip.setAttribute("aria-pressed", String(selected));
      chip.disabled = view.chipsDisabled;
    });
    if (currentKind !== paintedKind) {
      nodes.chipRow.scrollLeft = 0;
      paintedKind = currentKind;
    }
  }

  function paintPassageCard(view, passage) {
    const textKey = passage ? passage.id + "/" + topicIndexOf(passage) : null;
    if (textKey !== paintedTextKey) {
      nodes.cardText.scrollTop = 0;
      paintedTextKey = textKey;
    }
    nodes.newTopic.hidden = !(view.showNewTopic && hasTopics(passage));
    nodes.newTopic.disabled = view.chipsDisabled;
    if (!passage) {
      nodes.cardTitle.textContent = "";
      nodes.cardTarget.textContent = "";
      nodes.cardText.textContent = "";
      return;
    }
    const [lo, hi] = passage.targetWpm;
    nodes.cardTitle.textContent = passage.title;
    nodes.cardTarget.textContent = "Target " + lo + " to " + hi + " wpm";
    nodes.cardText.textContent = cardTextOf(passage);
  }

  // "/ 1:00" and the bar for a timed entry; an untimed entry hides both.
  function paintTimeLimit(passage) {
    const limit = limitOf(passage);
    nodes.limit.hidden = limit === null;
    nodes.limitBar.hidden = limit === null;
    nodes.limit.textContent = limit === null ? "" : LIMIT_PREFIX + app.ui.formatClock(limit);
    paintLimitFill(limit);
  }

  // Scales the fill to the clock while a take records or uploads; idle and error show an empty
  // bar, whatever the clock holds. From the limit on it stays full and turns rust; the take keeps
  // going. The style goes through setAttribute, the one way the test fakes take.
  function paintLimitFill(limit) {
    const seconds = state === "recording" || state === "uploading" ? shownSeconds : 0;
    const ratio = limit === null ? 0 : limitRatio(seconds, limit);
    nodes.limitFill.setAttribute("style", "transform: scaleX(" + ratio + ")");
    nodes.limitBar.classList.toggle(LIMIT_OVER_CLASS, limit !== null && seconds >= limit);
  }

  // The box shows on Talk only. Outside idle it is read-only rather than disabled, so the
  // speaker can still scroll and read it while the take records.
  function paintScriptBox(view) {
    nodes.scriptBox.hidden = currentKind !== SCRIPT_KIND;
    nodes.scriptInput.readOnly = view.chipsDisabled;
    paintScriptSummary();
  }

  // "Paste your script (optional)" while the box is empty, else "Your script (124 words)".
  function paintScriptSummary() {
    const count = wordCount(pastedScript());
    const attached = ATTACHED_SUMMARY_PREFIX + count.toLocaleString("en-US") + " word";
    nodes.scriptSummary.textContent =
      count === 0 ? SCRIPT_SUMMARY : attached + (count === 1 ? ")" : "s)");
  }

  function wordCount(text) {
    return text === "" ? 0 : text.split(/\s+/).length;
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
        secondaryLabel: detail.secondaryLabel,
        onSecondary: detail.onSecondary,
      });
    } else {
      app.ui.clear(nodes.stateBlock);
      return;
    }
    // Either block's title can take focus from script (tabindex -1) but is never a Tab stop. The
    // error block replaces the button that had focus, so focus moves to its title; the block's
    // role="alert" already speaks it, and nothing is announced on top of that. upload() decides
    // for the loading title.
    const title = stateTitle();
    if (!title) {
      return;
    }
    title.setAttribute("tabindex", "-1");
    if (dataState === "error") {
      focusIfPossible(title);
    }
  }

  // The title of the block in the record zone, or null while the zone is empty. Some test fakes
  // have no querySelector.
  function stateTitle() {
    const block = nodes.stateBlock.firstChild;
    return block && typeof block.querySelector === "function"
      ? block.querySelector(".state__title")
      : null;
  }

  // True when keyboard focus is on `node` or inside it. Some test fakes have no activeElement,
  // and some have no contains().
  function holdsFocus(node) {
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (!active || !node) {
      return false;
    }
    return active === node || (typeof node.contains === "function" && node.contains(active));
  }

  // Moves keyboard focus when the node can take it; the test fakes have no focus().
  function focusIfPossible(node) {
    if (node && typeof node.focus === "function") {
      node.focus();
    }
  }

  // The way back to idle from an error block: Try again, Record again or Record a new take.
  // Clearing the block drops the focus it held (its title, or the button just used) to <body>,
  // where the next Tab would skip Record for the nav, so focus moves on to `next`: the record
  // button, or the sample button after the sample failed to load.
  function backToIdle(next) {
    const blockHadFocus = holdsFocus(nodes.stateBlock);
    render("idle");
    if (blockHadFocus) {
      focusIfPossible(next);
    }
  }

  // Applies the next theme, saves it through app.ui and says which one is on. The screen's own
  // state is untouched, so a tap works in any state.
  function onThemeTap() {
    themeChoice = app.ui.setTheme(app.ui.nextTheme(themeChoice));
    paintThemeToggle();
    app.ui.announce(THEME_TOGGLE[themeChoice].announcement);
  }

  // One 20px icon for the current choice, and a label naming it and the next one.
  function paintThemeToggle() {
    const look = THEME_TOGGLE[themeChoice];
    app.ui.clear(nodes.themeToggle);
    nodes.themeToggle.appendChild(app.ui.icon(look.icon));
    nodes.themeToggle.setAttribute("aria-label", look.label);
  }

  // Coming back to the screen starts a fresh take at 0:00 unless one is already in flight, or a
  // failed upload still holds its take: then its Upload failed block is drawn again, clock and
  // all, whether the upload failed before the speaker left or while they were away.
  function show() {
    if (state === "recording" || state === "uploading") {
      return;
    }
    if (state === "error" && failedUpload !== null) {
      render("error", failedUpload);
      return;
    }
    resetClock();
    render("idle");
  }

  // Leaving mid-take must never leak the microphone: let the recorder, tracks, timer and pause
  // sampler go and drop the take. An upload in flight keeps going, and a failed upload keeps its
  // take; show() will find either.
  function hide() {
    capture.awaitingMic = false;
    if (state === "recording") {
      releaseCapture();
      resetClock();
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
        onAction: () => backToIdle(nodes.recordButton),
      });
      return;
    }
    beginTake(stream);
  }

  function beginTake(stream) {
    letTakeGo();
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
    app.ui.announce(stoppedAnnouncement(Math.floor(durationSeconds)));

    if (durationSeconds < MIN_TAKE_SECONDS) {
      showTooShort();
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
      script: scriptFor(passage),
    };
    upload();
  }

  // The text the take was read from, fixed at Stop so Retry re-sends the same: a Read
  // passage's text, or on Talk the pasted script ("" for none). A script left in the closed
  // box is still sent; its summary names it.
  function scriptFor(entry) {
    if (entry && entry.kind !== SCRIPT_KIND) {
      return entry.text;
    }
    return pastedScript();
  }

  // The box's text without its edge spaces. Some test fakes give the textarea no value.
  function pastedScript() {
    return String(nodes.scriptInput.value || "").trim();
  }

  // The Too short block, after a Stop under 5 seconds or when the backend heard under 5 seconds
  // of speech. Either way nothing is left to re-send, so its one action goes back to idle.
  function showTooShort() {
    render("error", {
      title: TOO_SHORT_TITLE,
      body: app.api.messages.too_short,
      actionLabel: TOO_SHORT_ACTION,
      onAction: () => backToIdle(nodes.recordButton),
    });
  }

  // "Recording stopped, 12 seconds", or "1 second" for a one-second take.
  function stoppedAnnouncement(seconds) {
    return STOPPED_ANNOUNCEMENT + seconds + (seconds === 1 ? " second" : " seconds");
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
    // Stop and the error block both vanish as the take uploads. When focus sat on either, it
    // moves to the loading title, so it stays in the record zone and "Analyzing your speech" is
    // read out.
    const focusInRecordZone = holdsFocus(nodes.recordButton) || holdsFocus(nodes.stateBlock);
    render("uploading");
    if (focusInRecordZone) {
      focusIfPossible(stateTitle());
    }
    try {
      const result = await app.api.analyze(take.blob, take.contentType, take.script);
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
      letTakeGo();
      app.ui.announce(RESULTS_READY_ANNOUNCEMENT);
      resetClock();
      render("idle");
      app.router.go("results", { id });
    } catch (error) {
      if (error.kind === "too_short") {
        // The backend answered 400: the same blob would fail again and cost a provider call on
        // every tap, so the take goes, as after "Record a new take", and Retry is never offered.
        // Its clock goes back to 0:00 too: the take ran at least 5 seconds, and idle showing
        // that after Record again would contradict the block's "under 5 seconds".
        letTakeGo();
        resetClock();
        showTooShort();
        return;
      }
      failedUpload = {
        title: UPLOAD_FAILED_TITLE,
        body: error.message,
        actionLabel: UPLOAD_FAILED_ACTION,
        onAction: upload,
        secondaryLabel: NEW_TAKE_ACTION,
        onSecondary: dropTake,
      };
      render("error", failedUpload);
    }
  }

  // "Record a new take" after a failed upload: let the held take go and start over in idle.
  function dropTake() {
    letTakeGo();
    resetClock();
    backToIdle(nodes.recordButton);
  }

  // Forgets the held take, and with it the Upload failed block that offered it: the take was
  // saved, dropped, turned down as too short, or replaced by a new one.
  function letTakeGo() {
    pendingTake = null;
    failedUpload = null;
  }

  // The timer: one 250 ms tick paints the elapsed clock and the time-limit bar, and announces
  // the clock every 30 s.
  function startTimer() {
    capture.startedAt = performance.now();
    capture.announcedBlocks = 0;
    shownSeconds = 0;
    nodes.timer.textContent = TIMER_START;
    paintLimitFill(limitOf(selectedPassage()));
    capture.timerId = setInterval(tickTimer, TIMER_TICK_MS);
  }

  function tickTimer() {
    const elapsed = elapsedSeconds();
    shownSeconds = elapsed;
    nodes.timer.textContent = app.ui.formatClock(elapsed);
    paintLimitFill(limitOf(selectedPassage()));
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

  // A take that is let go takes its time with it: the clock reads 0:00 again. The bar is drawn
  // from the state in paintLimitFill, so render() empties it.
  function resetClock() {
    shownSeconds = 0;
    nodes.timer.textContent = TIMER_START;
  }

  function elapsedSeconds() {
    return (performance.now() - capture.startedAt) / 1000;
  }

  // Both icons draw in currentColor, which the button sets to --on-record: white on the light
  // red, near-black on the brighter dark-scheme red, at least 3:1 either way.
  function micIcon() {
    const svg = svgEl("svg", {
      class: "btn-record__mic",
      width: MIC_ICON_SIZE,
      height: MIC_ICON_SIZE,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
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
      fill: "currentColor",
      "aria-hidden": "true",
    });
    svg.appendChild(svgEl("rect", { x: "6", y: "6", width: "12", height: "12", rx: "2" }));
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
