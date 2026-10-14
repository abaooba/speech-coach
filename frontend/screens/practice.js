/* screens/practice.js: app.screens.practice, the home screen (DESIGN.md sections 6 and 7).
   mount() builds the Talk / Read switch, chips, card, timer, record button, hint (with Talk's
   script box) and state block once; render(state, detail) repaints them. Stop uploads the
   take with its script (a Read passage's text, or the one pasted on Talk) through app.api and
   saves it with app.store, with the topic it was given. In level mode (startLevelTake, spec
   docs/superpowers/specs/2026-10-14-loop-path.md section 7) a banner stands in for the switch
   and the chips, and the saved take goes back to the Level screen instead of Results. It never
   asks for the microphone before a Record tap, and never stores audio. */
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
  // What app.store rejects every call with while an older version of the app, open in another
  // tab, blocks the database upgrade (store.js UPGRADE_BLOCKED_MESSAGE; DESIGN.md section 2).
  // It says what to do, so a save refused with it shows it word for word; nothing else a save
  // throws ever does.
  const STORE_BLOCKED_SENTENCE =
    "Close other Speech Coach tabs to finish updating, then try again.";
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

  // Level mode: the Level screen asks for one take through startLevelTake(request). Its banner
  // says what the take is for, and a level with the live tap (Fillers level 3) puts "Heard one"
  // under the record button while the take records.
  const PRACTICE_ROUTE = "practice";
  const LEAVE_LEVEL_LABEL = "Leave level";
  const LIVE_TAP_LABEL = "Heard one";
  const LIVE_TAP_ARIA_LABEL = "Heard one filler";
  const LIVE_TAP_COUNT_ID = "practice-live-tap-count";
  const LIVE_TAP_COUNT_SUFFIX = " heard";
  const LEVEL_CALLBACKS = ["judge", "onSaved", "onLeave"];

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

  // The Level screen's request while Practice records a take for it, or null in normal mode:
  // {eyebrow, title, body, material, seconds, liveTap, judge, onSaved, onLeave} (spec section 7).
  // Its material and its seconds stand in for the selected entry and that entry's time limit.
  let levelRequest = null;

  // True from the router's show() until its hide(): Practice is the screen on show. A request
  // that comes meanwhile is painted at once, since the router has nothing new to show for it.
  let shown = false;

  // The clock's seconds, to a tenth, at each "Heard one" tap during the take recording now.
  let liveTaps = [];

  // Nodes built by mount(). render() repaints them; startTimer(), tickTimer() and resetClock()
  // write the clock. The theme toggle is the one node index.html builds: mount() finds it in
  // the header. The banner and the live tap join the body only in level mode.
  const nodes = {
    themeToggle: null,
    body: null,
    modeSwitch: null,
    modeOptions: [],
    chipRow: null,
    chips: [],
    card: null,
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
    hint: null,
    hintText: null,
    sampleButton: null,
    stateBlock: null,
    scriptBox: null,
    scriptSummary: null,
    scriptInput: null,
    banner: null,
    bannerEyebrow: null,
    bannerTitle: null,
    bannerBody: null,
    leaveLevel: null,
    liveTap: null,
    liveTapButton: null,
    liveTapCount: null,
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

  // The finished take, kept through uploading and error so Retry re-sends the same blob. Once the
  // backend's analysis is back it is kept here too, and so is the session once it is judged, so
  // Retry repeats only the step that failed.
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
  // only when the text changes (another passage or topic, or a level's material), and the chips
  // back to the start only when the tab changes; a state change never loses the reader's place.
  let paintedTextKey = null;
  let paintedKind = null;

  // True from the sample tap until its fetch, validation and save have settled.
  let loadingSample = false;

  // The state table from DESIGN.md section 7 as plain data, so it can be tested without a DOM.
  // showHint and showRecord mirror the [data-state] rules in styles.css: the record button and
  // its label show in idle and recording only, and error puts its block in their place.
  // chipsDisabled holds the tabs and New topic as well; New topic shows in idle only. In level
  // mode Leave level shows when the nav does (idle and error), so a stray thumb cannot abandon a
  // take that records or uploads, and "Heard one" shows while a take records.
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
      showLeaveLevel: idle || nextState === "error",
      showLiveTap: recording,
    };
  }

  // The entry the current tab has selected, or null before mount or for an empty tab.
  function selectedPassage() {
    const id = selectedIdByKind[currentKind];
    return (app.passages || []).find((entry) => entry.id === id) || null;
  }

  // The entry the card, the clock and the take use: in level mode the request's material, with
  // the request's seconds as its limit; otherwise the selected entry.
  function shownEntry() {
    return levelRequest === null ? selectedPassage() : levelEntry(levelRequest);
  }

  // A level request's material in the shape of an app.passages entry, so the card, the clock and
  // the take read it as they read the selected entry. It has no topics: New topic never changes
  // a level's material.
  function levelEntry(request) {
    const { id, kind, title, text, targetWpm } = request.material;
    return { id, kind, title, text, targetWpm, timeLimitSeconds: request.seconds };
  }

  // The topic a take is given, saved as its `topic` so app.path.pickTopic knows which topics were
  // used: a level material's topic, or the topic on screen of a prompt with topics. Null for a
  // passage or a prompt without topics, whose takes save no topic.
  function topicOf(entry) {
    if (levelRequest !== null) {
      const { topic } = levelRequest.material;
      return typeof topic === "string" && topic !== "" ? topic : null;
    }
    return hasTopics(entry) ? cardTextOf(entry) : null;
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
    nodes.body = body;
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
    nodes.hint = app.ui.el("div", { class: "practice__hint" }, [
      nodes.hintText,
      buildSampleButton(),
      buildScriptBox(),
    ]);
    body.appendChild(nodes.hint);
    nodes.stateBlock = app.ui.el("div", { class: "practice__state" });
    body.appendChild(nodes.stateBlock);
    // Level mode's banner and live tap are built once here too, but join the body only while a
    // request is held (paintLevelParts), so normal mode keeps exactly the parts above.
    buildBanner();
    buildLiveTap();

    render("idle");
  }

  // The level banner: the level as its eyebrow ("Path: Fillers, level 3"), the take as its title
  // ("Take 1 of 2"), what to do, and Leave level, a small text button.
  function buildBanner() {
    nodes.bannerEyebrow = app.ui.el("p", { class: "practice__banner-eyebrow" });
    nodes.bannerTitle = app.ui.el("h2", { class: "practice__banner-title" });
    nodes.bannerBody = app.ui.el("p", { class: "practice__banner-body" });
    nodes.leaveLevel = app.ui.el("button", {
      class: "btn btn--ghost practice__banner-leave",
      type: "button",
      text: LEAVE_LEVEL_LABEL,
      onClick: leaveLevel,
    });
    nodes.banner = app.ui.el("section", { class: "practice__banner" }, [
      nodes.bannerEyebrow,
      nodes.bannerTitle,
      nodes.bannerBody,
      nodes.leaveLevel,
    ]);
  }

  // "Heard one": a large secondary button the speaker taps on hearing one of their own fillers
  // while the take records. The small count beside it ("3 heard") also describes it to screen
  // readers, whose name for it, "Heard one filler", starts with the words on it (WCAG 2.5.3), so
  // a voice-control user can say "Heard one".
  function buildLiveTap() {
    nodes.liveTapButton = app.ui.el("button", {
      class: "btn btn--secondary practice__live-tap-button",
      type: "button",
      "aria-label": LIVE_TAP_ARIA_LABEL,
      "aria-describedby": LIVE_TAP_COUNT_ID,
      text: LIVE_TAP_LABEL,
      onClick: onLiveTap,
    });
    nodes.liveTapCount = app.ui.el("span", {
      class: "practice__live-tap-count",
      id: LIVE_TAP_COUNT_ID,
    });
    nodes.liveTap = app.ui.el("div", { class: "practice__live-tap" }, [
      nodes.liveTapButton,
      nodes.liveTapCount,
    ]);
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
    nodes.modeSwitch = app.ui.el(
      "div",
      { class: "segmented", role: "group", "aria-label": MODE_SWITCH_LABEL },
      nodes.modeOptions,
    );
    return nodes.modeSwitch;
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
    nodes.card = app.ui.el("section", { class: "passage-card" }, [
      nodes.cardTitle,
      nodes.newTopic,
      nodes.cardTarget,
      nodes.cardText,
    ]);
    return nodes.card;
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
  // onSecondary?}, passed straight to app.ui.renderState. A held level request is painted with
  // the state: its banner, its material and limit, and the live tap.
  function render(nextState, detail) {
    const view = viewFor(nextState);
    state = nextState;
    root.dataset.state = view.dataState;

    const passage = shownEntry();
    paintModeSwitch(view);
    paintChips(view);
    paintLevelParts(view);
    paintPassageCard(view, passage);
    paintTimeLimit(passage);
    paintRecordButton(view);
    paintScriptBox(view);
    paintHint(view);
    paintStateBlock(view.dataState, detail || {});
  }

  // A tab with no entries stays disabled, so the screen never shows an empty card. Level mode
  // hides the switch, and the chips below it: the banner takes their place.
  function paintModeSwitch(view) {
    const passages = app.passages || [];
    nodes.modeSwitch.hidden = levelRequest !== null;
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
    nodes.chipRow.hidden = levelRequest !== null;
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

  // Level mode's parts join the body while a request is held and leave it with the request, so
  // normal mode keeps exactly the body DESIGN.md section 3 lists: the banner right above the
  // card, in the place of the switch and the chips, and on a level with the live tap "Heard one"
  // right under the record button's label.
  function paintLevelParts(view) {
    const request = levelRequest;
    placeInBody(nodes.banner, request !== null, nodes.card);
    placeInBody(nodes.liveTap, request !== null && Boolean(request.liveTap), nodes.hint);
    if (request === null) {
      return;
    }
    nodes.bannerEyebrow.textContent = lineOf(request.eyebrow);
    nodes.bannerTitle.textContent = lineOf(request.title);
    nodes.bannerBody.textContent = lineOf(request.body);
    nodes.leaveLevel.hidden = !view.showLeaveLevel;
    nodes.liveTap.hidden = !view.showLiveTap;
    nodes.liveTapCount.textContent = liveTaps.length + LIVE_TAP_COUNT_SUFFIX;
  }

  // Puts `node` into the body right before `next` when `wanted`, otherwise takes it out. The
  // normal-mode test fakes keep no parentNode; nothing is ever put in there.
  function placeInBody(node, wanted, next) {
    const placed = node.parentNode === nodes.body;
    if (wanted && !placed) {
      nodes.body.insertBefore(node, next);
    } else if (!wanted && placed) {
      nodes.body.removeChild(node);
    }
  }

  // A line of the request as the banner shows it: nothing when the Level screen leaves it out.
  function lineOf(value) {
    return typeof value === "string" ? value : "";
  }

  // In level mode `passage` is the request's material (shownEntry), which has no topics.
  function paintPassageCard(view, passage) {
    const textKey = passage ? passage.id + "/" + cardTextOf(passage) : null;
    if (textKey !== paintedTextKey) {
      nodes.cardText.scrollTop = 0;
      paintedTextKey = textKey;
    }
    nodes.newTopic.hidden = !(view.showNewTopic && levelRequest === null && hasTopics(passage));
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

  // The box shows on Talk only, and never in level mode, where a take is said or read on its
  // material alone. Outside idle it is read-only rather than disabled, so the speaker can still
  // scroll and read it while the take records.
  function paintScriptBox(view) {
    nodes.scriptBox.hidden = levelRequest !== null || currentKind !== SCRIPT_KIND;
    nodes.scriptInput.readOnly = view.chipsDisabled;
    paintScriptSummary();
  }

  // The hint's words for the state. The sample button hides in level mode, where the take on
  // screen is the Level screen's.
  function paintHint(view) {
    nodes.hintText.textContent = view.hintText;
    nodes.sampleButton.hidden = levelRequest !== null;
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

  // True when keyboard focus sits on no control: on <body>, where the browser leaves it when the
  // focused node leaves the page, or on nothing in the test fakes.
  function focusIsLost() {
    if (typeof document === "undefined") {
      return false;
    }
    const active = document.activeElement;
    return !active || active === document.body;
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
    shown = true;
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
  // take; show() will find either. A level request goes too, unless such a take still answers
  // it: the Level screen asks again when the speaker goes back to it, and a later visit to
  // Practice is a normal one.
  function hide() {
    shown = false;
    capture.awaitingMic = false;
    if (pendingTake === null) {
      levelRequest = null;
    }
    if (state === "recording") {
      releaseCapture();
      resetClock();
      render("idle");
    }
  }

  // The Level screen's way in (spec section 7): hold the request and go to #/practice, where
  // show() paints it. A take still held from before (a failed upload) is let go, since the
  // request asks for a new take; an upload already in flight still answers the request it was
  // recorded under, while Practice holds the new one. When Practice is already on show (the
  // request comes from onSaved or onLeave, say), going to #/practice changes no hash and the
  // router calls no show(), so the request is painted here.
  function startLevelTake(request) {
    if (!isLevelRequest(request)) {
      throw new TypeError(
        "startLevelTake needs a material {kind, id, title, text, targetWpm} and judge, " +
          "onSaved and onLeave",
      );
    }
    levelRequest = request;
    if (failedUpload !== null) {
      letTakeGo();
    }
    if (shown) {
      paintRequestInPlace();
    }
    app.router.go(PRACTICE_ROUTE);
  }

  // Paints a request that came while Practice is on show, as show() would: a fresh take at 0:00
  // under the banner. A take that records or uploads is left as it is, as show() leaves it; the
  // banner shows with the next state the screen draws. Focus that the repaint would strand, on a
  // part the banner hides (the switch, the chips, New topic, the hint row), in a block it clears
  // or already on nothing, moves to the banner's title, as a screen change moves it to the new h1
  // (tabindex -1, never a Tab stop); focus anywhere else stays where it is.
  function paintRequestInPlace() {
    if (state === "recording" || state === "uploading") {
      return;
    }
    const stranded =
      focusIsLost() ||
      [nodes.modeSwitch, nodes.chipRow, nodes.newTopic, nodes.hint, nodes.stateBlock].some(
        holdsFocus,
      );
    resetClock();
    render("idle");
    if (stranded) {
      nodes.bannerTitle.setAttribute("tabindex", "-1");
      focusIfPossible(nodes.bannerTitle);
    }
  }

  // Whether Practice still holds `request`: the request on screen, or the one a recorded take
  // still answers (an upload in flight, or one that failed and waits for Retry). One it let go
  // (handed back with its take, left, or dropped by hide() with no take held) is not held, and in
  // normal mode nothing is. The Level screen keeps its run, and take 1's audio, on #/practice
  // only while Practice holds one of the run's requests. It reads state and changes nothing.
  function holdsLevelRequest(request) {
    if (request === null || request === undefined) {
      return false;
    }
    return levelRequest === request || (pendingTake !== null && pendingTake.request === request);
  }

  // A request Practice can paint and record: its callbacks, and a material whose kind decides
  // the script (MODES lists the two) and whose band the card's target line reads.
  function isLevelRequest(request) {
    if (request === null || typeof request !== "object") {
      return false;
    }
    const material = request.material;
    return (
      material !== null &&
      typeof material === "object" &&
      MODES.some((mode) => mode.kind === material.kind) &&
      ["id", "title", "text"].every((field) => typeof material[field] === "string") &&
      Array.isArray(material.targetWpm) &&
      material.targetWpm.length === 2 &&
      LEVEL_CALLBACKS.every((name) => typeof request[name] === "function")
    );
  }

  // "Leave level": back to normal mode in idle. A take still held for the level (a failed upload)
  // goes with the request, and a microphone prompt still open lets its stream go when it answers.
  // Focus on the button, or in an error block it clears (Safari leaves focus there on a tap),
  // moves to the Talk / Read switch now in the banner's place. The Level screen hears of it
  // last, so it finds Practice already in normal mode.
  function leaveLevel() {
    const request = levelRequest;
    if (request === null || !viewFor(state).showLeaveLevel) {
      return;
    }
    const hadFocus = holdsFocus(nodes.leaveLevel) || holdsFocus(nodes.stateBlock);
    capture.awaitingMic = false;
    levelRequest = null;
    letTakeGo();
    resetClock();
    render("idle");
    if (hadFocus) {
      focusIfPossible(selectedModeOption());
    }
    request.onLeave();
  }

  function selectedModeOption() {
    return nodes.modeOptions.find((option) => option.dataset.kind === currentKind) || null;
  }

  // "Heard one" while the take records: the clock's seconds to a tenth, which the Level screen
  // matches with the fillers the take finds (app.loop.matchTaps). The count beside it repaints.
  function onLiveTap() {
    if (state !== "recording") {
      return;
    }
    liveTaps.push(toTenth(elapsedSeconds()));
    render(state);
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
    liveTaps = [];
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

    // Like the script, the topic and the level request are fixed at Stop, so Retry saves and
    // hands back the take as it was recorded, with the taps it was given.
    const passage = shownEntry();
    pendingTake = {
      blob: new Blob(chunks, { type: contentType }),
      contentType,
      durationSeconds: toTenth(durationSeconds),
      samples,
      passageId: passage ? passage.id : null,
      passageTitle: passage ? passage.title : "",
      script: scriptFor(passage),
      topic: topicOf(passage),
      request: levelRequest,
      liveTaps: liveTaps.slice(),
      // {transcript, metrics} once the backend has analyzed the take, then the session to save.
      analysis: null,
      session: null,
    };
    upload();
  }

  // The text the take was read from, fixed at Stop so Retry re-sends the same: a Read
  // passage's (or a level passage's) text, or on Talk the pasted script ("" for none). A script
  // left in the closed box is still sent; its summary names it. A level take on a prompt sends
  // none: it is said on its topic, and the box is hidden.
  function scriptFor(entry) {
    if (entry && entry.kind !== SCRIPT_KIND) {
      return entry.text;
    }
    return levelRequest === null ? pastedScript() : "";
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

  // Sends the pending take, saves the session and hands off: a plain take to Results, a level
  // take back to the Level screen (handBack). "Retry upload" calls this again for the same take.
  // The analysis, a level take's judging and the save can each fail into the Upload failed
  // block, and each step that succeeded stays with the take: Retry sends the same blob again
  // only when no analysis came back, and never judges a take twice. The hand-off runs once the
  // take is saved, so it is never repeated. The block's sentence is fixed copy, apart from the
  // store's own while another tab blocks its upgrade (saveFailureSentence).
  async function upload() {
    const take = pendingTake;
    if (take === null) {
      return;
    }
    // Stop, Heard one and the error block all vanish as the take uploads. When focus sat on any
    // of them, it moves to the loading title, so it stays in the record zone and "Analyzing your
    // speech" is read out.
    const focusInRecordZone =
      holdsFocus(nodes.recordButton) || holdsFocus(nodes.stateBlock) || holdsFocus(nodes.liveTap);
    render("uploading");
    if (focusInRecordZone) {
      focusIfPossible(stateTitle());
    }
    if (take.analysis === null) {
      try {
        take.analysis = await analysisOf(take);
      } catch (error) {
        if (error && error.kind === "too_short") {
          // The backend answered 400: the same blob would fail again and cost a provider call
          // on every tap, so the take goes, as after "Record a new take", and Retry is never
          // offered. Its clock goes back to 0:00 too: the take ran at least 5 seconds, and idle
          // showing that after Record again would contradict the block's "under 5 seconds".
          letTakeGo();
          resetClock();
          showTooShort();
          return;
        }
        showUploadFailed(analysisFailureSentence(error));
        return;
      }
    }
    if (take.session === null) {
      try {
        take.session = sessionFor(take, take.analysis.transcript, take.analysis.metrics);
      } catch {
        // The judge threw. Whatever it threw, the block reads as for an unknown failure on our
        // side, and the speaker's recording is still here for Retry.
        showUploadFailed(app.api.messages.provider);
        return;
      }
    }
    let id = null;
    try {
      id = await app.store.save(take.session);
    } catch (error) {
      showUploadFailed(saveFailureSentence(error));
      return;
    }
    const session = take.session;
    letTakeGo();
    resetClock();
    if (take.request !== null) {
      handBack(take, id, session);
      return;
    }
    app.ui.announce(RESULTS_READY_ANNOUNCEMENT);
    render("idle");
    app.router.go("results", { id });
  }

  // The backend's analysis of the take: its transcript, and its metrics with the pause samples
  // folded in when app.pauses is present.
  async function analysisOf(take) {
    const result = await app.api.analyze(take.blob, take.contentType, take.script);
    const metrics =
      app.pauses && take.samples
        ? app.pauses.reconcile(result.metrics, take.samples)
        : result.metrics;
    return { transcript: result.transcript, metrics };
  }

  // The fixed sentence for a failed analysis (DESIGN.md section 8): app.api's for the kind it
  // reports ("network", "provider"). An "unknown" kind, or a throw with no kind, reads as a
  // provider failure, as api.js reads one; an exception's own words never show.
  function analysisFailureSentence(error) {
    const messages = app.api.messages;
    const kind = error !== null && typeof error === "object" ? error.kind : undefined;
    const sentence = typeof kind === "string" ? messages[kind] : undefined;
    return typeof sentence === "string" ? sentence : messages.provider;
  }

  // The sentence for a save that failed. While an older tab blocks the database upgrade, the
  // store's own sentence tells the speaker to close it and try again, and Retry then saves the
  // same take. Anything else reads as an unknown failure on our side: an exception's own words
  // never show.
  function saveFailureSentence(error) {
    const message = error !== null && typeof error === "object" ? error.message : undefined;
    return message === STORE_BLOCKED_SENTENCE ? STORE_BLOCKED_SENTENCE : app.api.messages.provider;
  }

  // The Upload failed block, with Retry and "Record a new take". It is kept with its take, so
  // show() can draw it again after the speaker leaves Practice and comes back.
  function showUploadFailed(sentence) {
    failedUpload = {
      title: UPLOAD_FAILED_TITLE,
      body: sentence,
      actionLabel: UPLOAD_FAILED_ACTION,
      onAction: upload,
      secondaryLabel: NEW_TAKE_ACTION,
      onSecondary: dropTake,
    };
    render("error", failedUpload);
  }

  // The session to save: the fields every take has, the topic it was given (when it was given
  // one) and, for a level take, the `path` its request's judge returns once the take is
  // analyzed. A field the take lacks stays absent, as app.store keeps it.
  function sessionFor(take, transcript, metrics) {
    const session = {
      passageId: take.passageId,
      passageTitle: take.passageTitle,
      durationSeconds: take.durationSeconds,
      metrics,
      transcript,
    };
    if (take.topic !== null) {
      session.topic = take.topic;
    }
    if (take.request !== null) {
      session.path = take.request.judge({
        transcript,
        metrics,
        durationSeconds: take.durationSeconds,
      });
    }
    return session;
  }

  // A saved level take goes back to the Level screen, never to Results. The request it answered
  // is let go (a newer one that took its place stays), Practice is back in idle, and onSaved
  // gets the take with its blob and its live taps. The take was already let go, so the blob
  // handed over is the only one left.
  function handBack(take, id, session) {
    if (levelRequest === take.request) {
      levelRequest = null;
    }
    render("idle");
    take.request.onSaved({
      id,
      session,
      blob: take.blob,
      contentType: take.contentType,
      liveTaps: take.liveTaps,
    });
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
    paintLimitFill(limitOf(shownEntry()));
    capture.timerId = setInterval(tickTimer, TIMER_TICK_MS);
  }

  function tickTimer() {
    const elapsed = elapsedSeconds();
    shownSeconds = elapsed;
    nodes.timer.textContent = app.ui.formatClock(elapsed);
    paintLimitFill(limitOf(shownEntry()));
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

  // Seconds to a tenth, as a take's duration and its live taps are kept.
  function toTenth(seconds) {
    return Math.round(seconds * 10) / 10;
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
    startLevelTake,
    holdsLevelRequest,
    STATES,
    viewFor,
    render,
    selectedPassage,
    get state() {
      return state;
    },
  };
})();
