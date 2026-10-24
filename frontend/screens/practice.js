/* screens/practice.js: app.screens.practice, the home screen (DESIGN.md sections 6 and 7).
   mount() builds the Talk / Read switch, chips, card, timer, record button, hint (with Talk's
   script box) and state block once; render(state, detail) repaints them. A tap on a Talk chip, a
   Read group's chip or New topic draws a new topic or passage, by the Path's rule, over the
   speaker's own takes and every topic and passage shown since the app opened (spec
   docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 2), so taps go through a
   whole prompt or group before any comes back. Stop hands the take, with its script (a Read
   passage's text, or the one pasted on Talk), to a background job that sends it through app.api
   and saves it with app.store, with the topic it was given; the job reports on the top banner
   (app.ui.banner) while the speaker records another take or visits any screen; Results opens
   when the take is saved if Practice still waits in idle, else from the banner's "See results".
   In level mode (startLevelTake, spec docs/superpowers/specs/2026-10-14-loop-path.md section 7)
   a level banner stands in for the switch and the chips, the take uploads in place, and the
   saved take goes back to the Level screen instead of Results. While a normal take records, a
   row under the clock shows the pace the phone estimates from the microphone
   (app.delivery.livePace, spec section 7), with a cue once a take that counts has tuned that
   estimate for its mode, Talk or Read; until then the number is marked rough and has no cue. It
   never asks for the microphone before a Record tap, and never stores audio. */
(function () {
  "use strict";

  const STATES = ["idle", "recording", "uploading", "error"];

  // How settle() reports on a take, and a background job's status once it is not "working".
  const SAVED = "saved";
  const READY = "ready";
  const WORKING = "working";
  const FAILED = "failed";
  const TOO_SHORT = "too_short";

  // The mode switch's tabs, in order: Talk lists the prompts and Read the passages.
  const MODES = [
    { kind: "prompt", label: "Talk" },
    { kind: "passage", label: "Read" },
  ];
  const MODE_SWITCH_LABEL = "Practice mode";
  // The Read tab's kind: its passages come in groups, one chip each (app.passages.groups()).
  const READ_KIND = "passage";
  // The card's one button: New topic on Talk, New passage on Read.
  const NEW_TOPIC_LABEL = "New topic";
  const NEW_PASSAGE_LABEL = "New passage";
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
  // After Stop the button reads Record at once, in the same place. A bouncing thumb or a double
  // tap would start a new take, so record taps are ignored for this long after a Stop.
  const STOP_GRACE_MS = 500;

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

  // The top banner's copy for a take analyzed in the background (DESIGN.md section 8). With one
  // take the lines name it by its length ("Your 0:42 take"), so the speaker who has recorded
  // another knows which one is meant; with more the counts stand in.
  const BANNER_TAKE_PREFIX = "Your ";
  const BANNER_TAKE_SUFFIX = " take";
  const BANNER_WORKING_MANY_PREFIX = "Analyzing ";
  const BANNER_WORKING_MANY_SUFFIX = " takes";
  const BANNER_WORKING_BODY_EACH = "Usually 5 to 15 seconds each.";
  const BANNER_READY_BODY_SUFFIX = " is ready to read.";
  const BANNER_READY_MANY_SUFFIX = " takes ready";
  const BANNER_READY_MANY_BODY = "See results opens the oldest first.";
  const BANNER_READY_ACTION = "See results";

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

  // The live pace row (spec section 7): the waiting sentence until the estimate has 5 seconds of
  // speech, then "About 150 wpm" and a cue. A take whose mode (Talk or Read) has no kept factor
  // yet runs the same estimate with the starting factor (delivery.js LIVE_PACE_FACTOR) and shows
  // its number with PACE_ROUGH in the cue's place, in the waiting sentence's look, never a cue:
  // uncalibrated the median error is 22%, and in the app the untuned cue was right on 1 of 4
  // first takes (spec section 7, "Rough pace before tuning"). A cue's words come with its icon
  // and tone, the check in --ok or the alert triangle in --warn, as Results' Pace hint draws
  // them, so color never carries it alone.
  const PACE_WAITING = "Your pace shows after a few seconds.";
  const PACE_ROUGH = "Rough until tuned";
  const PACE_NUMBER_PREFIX = "About ";
  const PACE_NUMBER_SUFFIX = " wpm";
  const PACE_LOOK_ON_TARGET = Object.freeze({ words: "On target", icon: "check", tone: "ok" });
  const PACE_LOOK_SLOW_DOWN = Object.freeze({ words: "Slow down", icon: "alert", tone: "warn" });
  const PACE_LOOK_SPEED_UP = Object.freeze({ words: "Speed up", icon: "alert", tone: "warn" });
  const PACE_ICON_SIZE = 16;
  // The capture: a ScriptProcessor hands over one channel 1024 samples at a time. It runs only
  // while it feeds an output, so a gain of 0 keeps it silent. A capture that no block has
  // reached when the clock shows 0:03 is taken to hear nothing (iOS can leave a context's
  // resume() unanswered, and a suspended graph hands over nothing), so it goes as one whose
  // resume was refused. Either way its row hides with the held class, which keeps the row's box
  // until the take ends (styles.css), so the clock above it never moves mid-take.
  const PACE_BLOCK_SAMPLES = 1024;
  const PACE_CHANNELS = 1;
  const PACE_SILENT_GAIN = 0;
  const PACE_NO_AUDIO_SECONDS = 3;
  const PACE_HELD_CLASS = "practice__pace--held";
  // Talk and Read each keep their own words-a-peak factor (app.delivery.paceFactorAfter): a
  // number in the store flag "livePaceFactor:talk" or "livePaceFactor:read".
  const PACE_FACTOR_FLAG_PREFIX = "livePaceFactor:";
  const TALK_PACE = "talk";
  const READ_PACE = "read";
  const PACE_MODES = [TALK_PACE, READ_PACE];

  // The screen's <section>; its data-state attribute drives the CSS for every state.
  let root = null;
  // The one string every other piece of this screen is derived from.
  let state = "idle";

  // What the speaker picked, kept as they left it while the app is open: the tab showing
  // ("prompt" is Talk, "passage" is Read), each tab's own selected entry id (on Read, the passage
  // drawn for its group's chip), and the topic each prompt with topics is on (by entry id), drawn
  // at mount and again on each tap of its chip or of New topic.
  let currentKind = MODES[0].kind;
  const selectedIdByKind = {};
  const topicById = {};

  // The Read tab's groups, app.passages.groups() as mount() found it, in its order and less any
  // group no passage names: [{id, label}], one chip each. Empty for passage data without groups,
  // where every passage keeps a chip of its own.
  let readGroups = [];

  // The speaker's own takes, which the draws read (spec section 2.1): those app.store.list() gave
  // in its latest answer, and every take saved here since that list was asked for, which it may
  // not hold yet, newest first, each cut down to the fields a draw reads (drawFieldsOf). A take
  // saved before is in the answer, unless History has deleted it, and then it no longer counts.
  // A take in both changes no draw, which asks only which topics and passages takes used, and
  // when.
  let listedTakes = [];
  let savedTakes = [];

  // Every topic and passage the draws have put on screen since the app opened, the ones each tab
  // opens on included, newest first (spec section 2.1). A tap saves nothing, so without these,
  // once every item of a prompt or group had been used the taps flipped between the two used
  // longest ago. Each is what a draw reads of a take: the entry's id as `passageId` (a topic's
  // prompt), the `topic` for a topic, and `createdAt`, the moment it was shown, stamped by
  // shownAt(). They have no `passageTitle`, so app.path counts them as the speaker's own, as it
  // counts every take but the bundled sample. They live here only: never saved, never sent, and
  // never read by Progress, History, the rank or the Path.
  const shownItems = [];

  // The last showing's stamp, in milliseconds since 1970; 0 before the first.
  let lastShownAt = 0;

  // Each mode's kept live pace factor, read from its flag at show() and set again when a take's
  // tuning is kept: a number, or null while the mode has none and its row says when it starts.
  const paceFactors = { [TALK_PACE]: null, [READ_PACE]: null };

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

  // True from openResults() until the router's hide() or show(): the hash points at Results,
  // but the hashchange that hides Practice has not run yet. A second take saved in that moment
  // waits in the banner instead of opening over the first.
  let leavingForResults = false;

  // The clock's reading when the last normal take stopped and the button turned back into
  // Record in place, for the grace on record taps; null until then. A level take's button
  // hides at Stop, so it needs none.
  let stoppedAt = null;

  // The clock's seconds, to a tenth, at each "Heard one" tap during the take recording now.
  let liveTaps = [];

  // Nodes built by mount(). render() repaints them; startTimer(), tickTimer() and resetClock()
  // write the clock, and tickTimer() the live pace row too. The theme toggle is the one node
  // index.html builds: mount() finds it in the header. The banner and the live tap join the body
  // only in level mode.
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
    newTopicIcon: null,
    timer: null,
    limit: null,
    limitBar: null,
    limitFill: null,
    pace: null,
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

  // Everything a live take holds, from the Record tap until Stop or hide() lets it go. `pace` is
  // the take's live pace capture (startLivePace), or null when it did not start, its context
  // refused to resume, or no block reached it by 0:03 (dropLivePace); `paceDropped` is true once
  // it went one of those last two ways, so the row holds its box to the take's end (paintPace).
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
    pace: null,
    paceDropped: false,
  };

  // A level take, kept through uploading and error so Retry re-sends the same blob. Once the
  // backend's analysis is back it is kept here too, and so is the session once it is judged, so
  // Retry repeats only the step that failed. A normal take never lands here: it goes to a
  // background job at Stop (startJob).
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

  // The words the live pace row last showed, so its children are rebuilt only when they change.
  let paintedPaceText = null;

  // True from the sample tap until its fetch, validation and save have settled.
  let loadingSample = false;

  // The state table from DESIGN.md section 7 as plain data, so it can be tested without a DOM.
  // showHint and showRecord mirror the [data-state] rules in styles.css: the record button and
  // its label show in idle and recording only, and error puts its block in their place.
  // chipsDisabled holds the tabs and New topic as well; New topic shows in idle only. In level
  // mode Leave level shows when the nav does (idle and error), so a stray thumb cannot abandon a
  // take that records or uploads, and "Heard one" shows while a take records. The live pace row
  // shows while a take records, though never in level mode or without its capture (paintPace).
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
      showPace: recording,
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

  // The topic a prompt with topics is on: the one last drawn for it, or its first for a prompt
  // mount() never drew for.
  function currentTopic(entry) {
    const topic = topicById[entry.id];
    return entry.topics.includes(topic) ? topic : entry.topics[0];
  }

  // What the card shows: the current topic of a prompt with topics, otherwise the entry's text.
  function cardTextOf(entry) {
    return hasTopics(entry) ? currentTopic(entry) : entry.text;
  }

  // app.passages.groups() as a list, in its order, less any group no Read passage names, which
  // would have nothing to draw; none for passage data without it, such as the plain arrays of
  // the test fixtures.
  function groupsOf(passages) {
    const groups = typeof passages.groups === "function" ? Array.from(passages.groups()) : [];
    return groups.filter((group) =>
      passages.some((entry) => entry.kind === READ_KIND && entry.group === group.id),
    );
  }

  // The group a Read passage belongs to, from readGroups, or null for a prompt, a level's
  // material and a passage of no listed group.
  function groupOf(entry) {
    if (!entry || entry.kind !== READ_KIND) {
      return null;
    }
    return readGroups.find((group) => group.id === entry.group) || null;
  }

  // A group's passages, in the data's order.
  function passagesOf(group) {
    return (app.passages || []).filter((entry) => groupOf(entry) === group);
  }

  // True when New topic (New passage on Read) has another to show: a prompt with topics, or a
  // passage of a group that holds two or more. A passage on a chip of its own has none.
  function canDrawAnother(entry) {
    const group = groupOf(entry);
    return group === null ? hasTopics(entry) : passagesOf(group).length > 1;
  }

  // --- draws: a new topic or passage on every tap (spec section 2.1) ---

  // A draw follows the Path's rule when path.js is loaded, over the speaker's takes and what the
  // draws have shown since the app opened (shownItems): from the pool less the item the tap
  // replaces (once that item has shown), one no take has used and no draw has shown, at random;
  // failing that, the one used or shown longest ago. So taps go through the whole pool before any
  // item comes back, and never give the one on screen. Without app.path (some test harnesses) it
  // is any other item at random. A pool of one gives that one. Math.random draws, so a test fixes
  // it on its vm context's Math.

  // A topic of `entry`, a prompt with topics. Once a topic of the prompt has shown
  // (hasShownTopic), it is one other than `current` while another is left. Before that, the
  // Path's rule passes over none and can give `current` itself: mount() draws every prompt a
  // topic, but only the opening prompt's shows, so another prompt's `current` has never been on
  // screen, and passing over it could skip the one topic no take has used or, with every topic
  // used, the one used longest ago. The draw without app.path passes over `current` either way:
  // mount() drew it at random, so every topic stays as likely as any other.
  function drawTopic(entry, current) {
    const path = app.path;
    if (path && typeof path.pickTopic === "function") {
      const passOver = hasShownTopic(entry) ? current : null;
      return path.pickTopic(drawHistory(), entry.id, Math.random, passOver);
    }
    return drawOther(entry.topics, current);
  }

  // A passage of `group` other than the one `currentId` names while another is left.
  function drawPassage(group, currentId) {
    const passages = passagesOf(group);
    const path = app.path;
    if (path && typeof path.pickPassage === "function") {
      return path.pickPassage(drawHistory(), passages, Math.random, currentId);
    }
    const current = passages.find((passage) => passage.id === currentId);
    return drawOther(passages, current);
  }

  // Any item of `pool` but `current`, at random; `current` itself when it is all there is.
  function drawOther(pool, current) {
    const others = pool.filter((item) => item !== current);
    const choices = others.length > 0 ? others : pool;
    return choices[indexFor(Math.random(), choices.length)];
  }

  // The draw as an index into a list of `length`, kept inside it whatever the source returns.
  function indexFor(draw, length) {
    const index = Math.floor(Number(draw) * length);
    return Number.isFinite(index) ? Math.min(length - 1, Math.max(0, index)) : 0;
  }

  // What a draw reads: the takes saved here, then those the store listed, then every topic and
  // passage the draws have shown.
  function drawHistory() {
    return savedTakes.concat(listedTakes, shownItems);
  }

  // Counts what the card now shows for `entry` as used from this moment: the topic a prompt with
  // topics is on, or a Read passage drawn for its group. Nothing else is ever drawn, so nothing
  // else is counted, and neither is a level's material, which the Path drew.
  function noteShown(entry) {
    if (hasTopics(entry)) {
      shownItems.unshift({ passageId: entry.id, topic: currentTopic(entry), createdAt: shownAt() });
    } else if (groupOf(entry) !== null) {
      shownItems.unshift({ passageId: entry.id, createdAt: shownAt() });
    }
  }

  // True once a topic of `entry`, a prompt with topics, has shown since the app opened: the one
  // the Talk tab opens on, or one a tap drew (noteShown). The topic mount() draws another prompt
  // never shows.
  function hasShownTopic(entry) {
    return shownItems.some((item) => item.passageId === entry.id);
  }

  // The moment a showing counts from, as an ISO 8601 time like a take's createdAt: the clock's,
  // and at least 1 ms after the last showing's, so two shown in the same millisecond still order
  // as they came.
  function shownAt() {
    lastShownAt = Math.max(Date.now(), lastShownAt + 1);
    return new Date(lastShownAt).toISOString();
  }

  // What a draw reads of a saved session: the passage it used, its title (app.path leaves the
  // bundled sample out by it), its topic and when it was made. Practice keeps only these, so it
  // holds no second copy of the takes' transcripts and metrics while the app is open.
  function drawFieldsOf(session) {
    const { passageId, passageTitle, topic, createdAt } = session;
    return { passageId, passageTitle, topic, createdAt };
  }

  // Reads the speaker's takes for the draws. The answer replaces the takes listed before, and of
  // the takes saved here it keeps only those saved after the list was asked for: the others are
  // in the answer, unless History deleted them. A store without list() (some test fakes), one
  // that cannot be read and an answer that is no list all leave the takes as they were; an item
  // that is no session is left out.
  async function loadTakes() {
    if (!app.store || typeof app.store.list !== "function") {
      return;
    }
    const savedBeforeAsking = new Set(savedTakes);
    try {
      const sessions = await app.store.list();
      if (Array.isArray(sessions)) {
        listedTakes = sessions
          .filter((session) => Boolean(session) && typeof session === "object")
          .map(drawFieldsOf);
        savedTakes = savedTakes.filter((take) => !savedBeforeAsking.has(take));
      }
    } catch {
      // Blocked or unreadable storage: the draws go on with the takes they had.
    }
  }

  // The entry a tab opens on, its first chip's: on the Read tab a drawn passage of the first
  // group, whose chip leads the tab's chips, and otherwise the tab's first entry.
  function openingEntry(passages, kind) {
    if (kind === READ_KIND && readGroups.length > 0) {
      return drawPassage(readGroups[0], null);
    }
    const [first] = entriesOfKind(passages, kind);
    return first || null;
  }

  // Each prompt with topics starts on a drawn topic and each tab on its first chip's entry, the
  // Read tab on a drawn passage of the first group (spec sections 2.2 and 2.3). What each tab
  // opens on counts as shown from now (spec section 2.1); another prompt's topic shows only after
  // a tap on its chip, which draws it one first (drawTopic).
  function mount(screenRoot) {
    root = screenRoot;
    const passages = app.passages || [];
    readGroups = groupsOf(passages);
    currentKind = firstKind(passages);
    passages.filter(hasTopics).forEach((entry) => {
      topicById[entry.id] = drawTopic(entry, null);
    });
    MODES.forEach((mode) => {
      const opening = openingEntry(passages, mode.kind);
      selectedIdByKind[mode.kind] = opening ? opening.id : null;
      noteShown(opening);
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
    // Talk's script box closes the row, on its own line under the sample button (DESIGN.md
    // section 3).
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
      // The sample ships the coach notes written for it, so Results opens with them in place
      // and asks the server for none; a file without them saves the five fields alone.
      const notes = file.coachNotes === undefined ? {} : { coachNotes: file.coachNotes };
      id = await app.store.save({
        passageId: file.passageId,
        passageTitle: file.passageTitle,
        durationSeconds: file.durationSeconds,
        metrics: file.metrics,
        transcript: file.transcript,
        ...notes,
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

  // One chip per entry, in the data's order, except that a Read group's passages share one chip:
  // the group chips lead the Read tab's chips, in app.passages.groups() order, and a passage of
  // no listed group keeps a chip of its own after them. Built once; render() shows only the
  // current tab's chips.
  function buildChipRow(passages) {
    const firstRead = passages.findIndex((entry) => entry.kind === READ_KIND);
    nodes.chips = [];
    passages.forEach((entry, index) => {
      if (index === firstRead) {
        nodes.chips.push(...readGroups.map(groupChip));
      }
      if (groupOf(entry) === null) {
        nodes.chips.push(entryChip(entry));
      }
    });
    nodes.chipRow = app.ui.el(
      "div",
      { class: "chip-row", onFocusin: revealFocusedChip },
      nodes.chips,
    );
    return nodes.chipRow;
  }

  function entryChip(entry) {
    return app.ui.el("button", {
      class: "chip",
      type: "button",
      "aria-pressed": "false",
      dataset: { passageId: entry.id, kind: entry.kind },
      text: chipLabel(entry),
      onClick: () => selectPassage(entry.id),
    });
  }

  // A Read group's chip, named by the group's label alone: its passages are untimed.
  function groupChip(group) {
    return app.ui.el("button", {
      class: "chip",
      type: "button",
      "aria-pressed": "false",
      dataset: { group: group.id, kind: READ_KIND },
      text: group.label,
      onClick: () => selectGroup(group),
    });
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
  // the title, so focus order matches its place at the top right; on the Read tab it reads New
  // passage. Its refresh icon follows the words in the DOM, so the label is plain text; CSS draws
  // the icon first. The text scrolls on its own, so it is a region named by the title that takes
  // focus: keyboard users can scroll a long passage in every browser (Safari never focuses a
  // scroller by itself).
  function buildPassageCard() {
    nodes.cardTitle = app.ui.el("h2", { class: "passage-card__title", id: CARD_TITLE_ID });
    nodes.cardTarget = app.ui.el("p", { class: "passage-card__target" });
    nodes.cardText = app.ui.el("p", {
      class: "passage-card__text",
      tabindex: "0",
      role: "region",
      "aria-labelledby": CARD_TITLE_ID,
    });
    nodes.newTopicIcon = app.ui.icon("refresh", NEW_TOPIC_ICON_SIZE);
    nodes.newTopic = app.ui.el(
      "button",
      {
        class: "btn btn--ghost passage-card__new",
        type: "button",
        text: NEW_TOPIC_LABEL,
        onClick: drawAnother,
      },
      [nodes.newTopicIcon],
    );
    nodes.card = app.ui.el("section", { class: "passage-card" }, [
      nodes.cardTitle,
      nodes.newTopic,
      nodes.cardTarget,
      nodes.cardText,
    ]);
    return nodes.card;
  }

  // The clock, plus "/ 1:00" and a bar that fills toward the limit for a timed entry, then the
  // live pace row under them, hidden until a take records. Like the clock, the row is
  // aria-live off: nothing it says is ever announced.
  function buildTimer() {
    nodes.timer = app.ui.el("div", { class: "timer num", "aria-live": "off", text: TIMER_START });
    nodes.limit = app.ui.el("span", { class: "practice__limit num" });
    nodes.limitFill = app.ui.el("div", { class: "practice__limit-fill" });
    nodes.limitBar = app.ui.el("div", { class: "practice__limit-bar", "aria-hidden": "true" }, [
      nodes.limitFill,
    ]);
    nodes.pace = app.ui.el("p", { class: "practice__pace", "aria-live": "off" });
    nodes.pace.hidden = true;
    return app.ui.el("div", { class: "practice__timer" }, [
      app.ui.el("span", { class: "rec-dot", "aria-hidden": "true" }),
      nodes.timer,
      nodes.limit,
      nodes.limitBar,
      nodes.pace,
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
  // the other states. A chip selects its entry on that entry's own tab, and a prompt's chip, the
  // selected one or another, draws the prompt a new topic.
  function selectPassage(passageId) {
    const entry = (app.passages || []).find((candidate) => candidate.id === passageId);
    if (state !== "idle" || !entry) {
      return;
    }
    currentKind = entry.kind;
    selectedIdByKind[entry.kind] = entry.id;
    if (hasTopics(entry)) {
      showNewTopic(entry);
    } else {
      render("idle");
    }
  }

  // A Read group's chip, the selected one or another, draws a passage of the group.
  function selectGroup(group) {
    if (state !== "idle") {
      return;
    }
    showNewPassage(group);
  }

  function selectKind(kind) {
    if (state !== "idle" || kind === currentKind) {
      return;
    }
    currentKind = kind;
    render("idle");
  }

  // New topic: another topic for the selected prompt, or on the Read tab (New passage) another
  // passage of the selected passage's group.
  function drawAnother() {
    const entry = selectedPassage();
    if (state !== "idle" || !canDrawAnother(entry)) {
      return;
    }
    const group = groupOf(entry);
    if (group === null) {
      showNewTopic(entry);
    } else {
      showNewPassage(group);
    }
  }

  // Draws the prompt a topic and shows it, counted as shown from now: never the topic the prompt
  // last showed while another is left (drawTopic). Focus stays on the chip or New topic while the
  // card changes beside it, so the live region reads the new topic out.
  function showNewTopic(entry) {
    topicById[entry.id] = drawTopic(entry, currentTopic(entry));
    noteShown(entry);
    render("idle");
    app.ui.announce(cardTextOf(entry));
  }

  // Draws a passage of the group other than the one on screen, selects it, counts it as shown
  // from now and reads its title out, as New topic reads a topic.
  function showNewPassage(group) {
    const passage = drawPassage(group, selectedIdByKind[READ_KIND]);
    currentKind = READ_KIND;
    selectedIdByKind[READ_KIND] = passage.id;
    noteShown(passage);
    render("idle");
    app.ui.announce(passage.title);
  }

  // Applies one state to the screen. It is the only code that changes this screen's DOM, apart
  // from the clock and the live pace row (the timer tick writes them and the bar, resetClock()
  // puts the clock back to 0:00), a focused chip scrolling into view, and the header's theme
  // toggle, which repaints itself.
  // `detail` is only read for "error": {title, body, actionLabel, onAction, secondaryLabel?,
  // onSecondary?}, passed straight to app.ui.renderState. A held level request is painted with
  // the state: its banner, its material and limit, and the live tap.
  function render(nextState, detail) {
    const view = viewFor(nextState);
    state = nextState;
    root.dataset.state = view.dataState;
    // The tab's kind, as the chips and New topic carry it: on short phones styles.css hides the
    // Read tab's hint words and sample button (section 7).
    root.dataset.kind = currentKind;

    const passage = shownEntry();
    paintModeSwitch(view);
    paintChips(view);
    paintLevelParts(view);
    paintPassageCard(view, passage);
    paintTimeLimit(passage);
    paintPace(view);
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

  // Only the current tab's chips show; switching tabs scrolls the row back to its start. The
  // selected chip is the selected entry's own, or its group's.
  function paintChips(view) {
    const entry = selectedPassage();
    nodes.chipRow.hidden = levelRequest !== null;
    nodes.chips.forEach((chip) => {
      const inTab = chip.dataset.kind === currentKind;
      const selected = inTab && standsFor(chip, entry);
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

  // True when `chip` is the chip of `entry`: a group's chip for a passage of that group, else the
  // entry's own chip.
  function standsFor(chip, entry) {
    if (!entry) {
      return false;
    }
    const group = groupOf(entry);
    return group === null ? chip.dataset.passageId === entry.id : chip.dataset.group === group.id;
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
    paintNewTopicButton(currentKind);
    const drawable = levelRequest === null && canDrawAnother(passage);
    nodes.newTopic.hidden = !(view.showNewTopic && drawable);
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

  // New topic, or New passage on the Read tab: the button's words, then its icon, rebuilt only
  // when the words change. It is cleared first because the test fakes keep an element's text
  // apart from its children. It carries its tab's kind, as the chips do, for styles.css: under
  // 360px the Read tab's button shows its icon alone (section 7), so there its words are also its
  // aria-label (DESIGN.md section 9). Talk's always shows its words.
  function paintNewTopicButton(kind) {
    const label = kind === READ_KIND ? NEW_PASSAGE_LABEL : NEW_TOPIC_LABEL;
    nodes.newTopic.dataset.kind = kind;
    if (kind === READ_KIND) {
      nodes.newTopic.setAttribute("aria-label", label);
    } else {
      removeAttribute(nodes.newTopic, "aria-label");
    }
    if (nodes.newTopic.textContent === label) {
      return;
    }
    app.ui.clear(nodes.newTopic);
    nodes.newTopic.textContent = label;
    nodes.newTopic.appendChild(nodes.newTopicIcon);
  }

  // The test fakes have no removeAttribute.
  function removeAttribute(node, name) {
    if (typeof node.removeAttribute === "function") {
      node.removeAttribute(name);
    }
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
    // role="alert" already speaks it, and nothing is announced on top of that. uploadInPlace()
    // decides for the loading title.
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


  // The first-visit guide for this screen (app.sheet.firstVisit, once ever, never over another
  // sheet): nothing happens while sheet.js is not loaded.
  function showGuide() {
    if (app.sheet && typeof app.sheet.firstVisit === "function") {
      app.sheet.firstVisit("practice");
    }
  }

  // Coming back to the screen starts a fresh take at 0:00 unless a level take is already in
  // flight, or a failed level upload still holds its take: then its Upload failed block is drawn
  // again, clock and all, whether the upload failed before the speaker left or while they were
  // away. A take analyzed in the background is the banner's business, not this screen's. Each
  // visit reads the speaker's takes again for the draws, and each mode's live pace factor; the
  // tab, the entry and the topic stay as they were left, so Results' "Record again" retries the
  // same topic.
  function show() {
    shown = true;
    leavingForResults = false;
    loadTakes();
    loadPaceFactors();
    if (state === "recording" || state === "uploading") {
      return;
    }
    if (state === "error" && failedUpload !== null) {
      render("error", failedUpload);
      return;
    }
    resetClock();
    render("idle");
    if (levelRequest === null) {
      showGuide();
    }
  }

  // Leaving mid-take must never leak the microphone: let the recorder, tracks, timer, pause
  // sampler and live pace capture go and drop the take. A level upload in flight keeps going,
  // and a failed one keeps its take; show() will find either. A level request goes too, unless
  // such a take still answers it: the Level screen asks again when the speaker goes back to it,
  // and a later visit to Practice is a normal one. Background jobs run on regardless.
  function hide() {
    shown = false;
    leavingForResults = false;
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
  // show() paints it. A level take still held from before (a failed upload) is let go, since
  // the request asks for a new take; a level upload already in flight still answers the request
  // it was recorded under, while Practice holds the new one. A normal take's job is the
  // banner's and runs on. When Practice is already on show (the
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
    if (state === "uploading" || capture.awaitingMic || withinStopGrace()) {
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
      showMicBlocked();
      return;
    }
    beginTake(stream);
  }

  // The Microphone blocked block, for a microphone refused, missing, or one this browser
  // cannot record from. Try again goes back to idle.
  function showMicBlocked() {
    render("error", {
      title: MIC_BLOCKED_TITLE,
      body: MIC_BLOCKED_BODY,
      actionLabel: MIC_BLOCKED_ACTION,
      onAction: () => backToIdle(nodes.recordButton),
    });
  }

  // Starts a take on a granted stream: the pause sampler, the live pace capture, the recorder
  // and the clock. When the browser cannot record the stream (no MediaRecorder, or one that
  // refuses it) no take starts: what had started is let go at once, the microphone with it,
  // and the block says what it says for a refused microphone.
  function beginTake(stream) {
    letTakeGo();
    liveTaps = [];
    capture.stream = stream;
    if (app.pauses) {
      app.pauses.start(stream);
      capture.pausesStarted = true;
    }
    startLivePace(stream);
    try {
      startRecorder(stream);
    } catch {
      releaseCapture();
      showMicBlocked();
      return;
    }
    startTimer();
    app.ui.announce(STARTED_ANNOUNCEMENT);
    render("recording");
  }

  // The take's recorder, in the first container this browser can encode, handing over a chunk
  // every second.
  function startRecorder(stream) {
    capture.chosenMimeType = supportedMimeType();
    capture.chunks = [];
    capture.recorder = capture.chosenMimeType
      ? new MediaRecorder(stream, { mimeType: capture.chosenMimeType })
      : new MediaRecorder(stream);
    capture.recorder.addEventListener("dataavailable", collectChunk);
    capture.recorder.addEventListener("stop", onRecorderStopped);
    capture.recorder.start(CHUNK_EVERY_MS);
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
    const { chunks, samples, pace } = releaseCapture();
    app.ui.announce(stoppedAnnouncement(Math.floor(durationSeconds)));

    if (durationSeconds < MIN_TAKE_SECONDS) {
      showTooShort();
      return;
    }

    // Like the script, the topic and the level request are fixed at Stop, so Retry saves and
    // hands back the take as it was recorded, with the taps it was given.
    const passage = shownEntry();
    const take = {
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
      // The live pace's {peaks, mode} for tunePace, which takes them once; never saved.
      pace,
      // {transcript, metrics} once the backend has analyzed the take, then the session to save.
      analysis: null,
      session: null,
    };
    if (take.request === null) {
      // A normal take leaves the screen here: Practice is back in idle at 0:00 for the next one
      // while the banner reports on this one. Focus on Stop stays on the button, now Record,
      // which ignores a bounce for STOP_GRACE_MS.
      stoppedAt = performance.now();
      resetClock();
      render("idle");
      startJob(take);
      return;
    }
    pendingTake = take;
    uploadInPlace();
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
  // of a level take. Either way nothing is left to re-send, so its one action goes back to idle.
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
  // the chunks collected so far, the pause samples (null without app.pauses) and the live pace's
  // {peaks, mode} (null without its capture).
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
    const pace = releaseLivePace();
    capture.recorder = null;
    capture.stream = null;
    capture.chunks = [];
    capture.pausesStarted = false;
    capture.paceDropped = false;
    return { chunks, samples, pace };
  }

  function stopTracks(stream) {
    stream.getTracks().forEach((track) => track.stop());
  }

  // The three steps every take goes through, each kept on the take once it succeeds so a retry
  // repeats only the step that failed: the backend's analysis, the session (a level take's
  // judge runs in sessionFor) and the save. Resolves {outcome: "saved", id}, {outcome:
  // "too_short"} when the backend answered 400 (the same blob would fail again and cost a
  // provider call on every retry), or {outcome: "failed", sentence} with the fixed sentence
  // for the Upload failed detail. Retry sends the same blob again only when no analysis came
  // back, and never judges a take twice. Once the session is built a take that counts tunes its
  // mode's live pace factor (tunePace), on its own: the save never waits for it.
  async function settle(take) {
    if (take.analysis === null) {
      try {
        take.analysis = await analysisOf(take);
      } catch (error) {
        if (error && error.kind === "too_short") {
          return { outcome: TOO_SHORT };
        }
        return { outcome: FAILED, sentence: analysisFailureSentence(error) };
      }
    }
    if (take.session === null) {
      try {
        take.session = sessionFor(take, take.analysis.transcript, take.analysis.metrics);
      } catch {
        // The judge threw. Whatever it threw, the sentence reads as for an unknown failure on
        // our side, and the speaker's recording is still here for Retry.
        return { outcome: FAILED, sentence: app.api.messages.provider };
      }
      tunePace(take);
    }
    try {
      const id = await app.store.save(take.session);
      // The draws count it from now on, before any list() holds it, with the createdAt the store
      // has just set on it.
      savedTakes.unshift(drawFieldsOf(take.session));
      return { outcome: SAVED, id };
    } catch (error) {
      return { outcome: FAILED, sentence: saveFailureSentence(error) };
    }
  }

  // Settles the pending level take on this screen and hands it back to the Level screen
  // (handBack). "Retry upload" calls this again for the same take. A failure lands in the
  // Upload failed block, a backend 400 in Too short, with the take dropped as after "Record a
  // new take" and its clock back to 0:00 (the take ran at least 5 seconds, and idle showing
  // that after Record again would contradict the block's "under 5 seconds"). The hand-off runs
  // once the take is saved, so it is never repeated.
  async function uploadInPlace() {
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
    const result = await settle(take);
    if (result.outcome === TOO_SHORT) {
      letTakeGo();
      resetClock();
      showTooShort();
      return;
    }
    if (result.outcome === FAILED) {
      showUploadFailed(result.sentence);
      return;
    }
    const session = take.session;
    letTakeGo();
    resetClock();
    handBack(take, result.id, session);
  }

  // --- takes analyzed in the background ---

  // A normal take leaves the screen at Stop. It is settled here while Practice is free for
  // another take and the nav for any screen, and the top banner (app.ui.banner) reports on it
  // over every screen. A level take stays in place instead (uploadInPlace), since the Level
  // screen waits on it. Each job is {take, status, id, sentence}: status "working" until the
  // save, "ready" once saved while Practice was busy or away, "failed" with the Upload failed
  // sentence, or "too_short" when the backend turned the take down. A job leaves the list when
  // Results opens for it, "Record a new take" drops it, or "Record again" dismisses Too short.
  const jobs = [];

  function startJob(take) {
    const job = { take, status: WORKING, id: null, sentence: null };
    jobs.push(job);
    paintBanner();
    runJob(job);
  }

  // Settles the job's take. A take saved while Practice waits in idle, in normal mode, opens
  // Results at once, as the speaker who waited for it expects; one saved while a take records,
  // the microphone prompt is open, the sample loads, an error block shows, a level is on,
  // another screen is open, or Results is already opening for an earlier take waits in the
  // banner for "See results", so nothing is pulled from under the speaker. Once saved the
  // audio has no further use and is let go; the job keeps only its id.
  async function runJob(job) {
    const result = await settle(job.take);
    if (!jobs.includes(job)) {
      // Dropped while it ran ("Record a new take"): nothing is shown for it.
      return;
    }
    if (result.outcome === SAVED) {
      job.id = result.id;
      job.take.blob = null;
      if (practiceWaitsIdle()) {
        openResults(job);
        return;
      }
      job.status = READY;
      app.ui.announce(RESULTS_READY_ANNOUNCEMENT);
    } else if (result.outcome === TOO_SHORT) {
      job.status = TOO_SHORT;
    } else {
      job.status = FAILED;
      job.sentence = result.sentence;
    }
    paintBanner();
  }

  // True while Practice is on show in idle, in normal mode, with nothing underway: no
  // microphone prompt open, no sample loading, and no Results route already on its way.
  function practiceWaitsIdle() {
    return (
      shown &&
      !leavingForResults &&
      state === "idle" &&
      levelRequest === null &&
      !capture.awaitingMic &&
      !loadingSample
    );
  }

  // "Retry upload" on the banner: the same take, from the step that failed. Each banner action
  // first checks its job is still listed, so a button already detached by a repaint does
  // nothing.
  function retryJob(job) {
    if (!jobs.includes(job)) {
      return;
    }
    job.status = WORKING;
    job.sentence = null;
    paintBanner();
    runJob(job);
  }

  // "Record a new take" after a failed job, or "Record again" after a too-short one: the take
  // goes, and so does the banner's word on it, and Practice opens for the next take. On
  // Practice already, the route changes nothing (or, from the empty home hash, shows it again
  // in idle), so focus that the banner held moves to the record button, as after an error
  // block's action; elsewhere the route's own focus rule places it.
  function dropJob(job) {
    if (!jobs.includes(job)) {
      return;
    }
    const fromBanner = app.ui.banner.holdsFocus();
    forgetJob(job);
    app.router.go(PRACTICE_ROUTE);
    if (shown && fromBanner) {
      focusIfPossible(nodes.recordButton);
    }
  }

  // Opens Results for a saved take: from runJob while Practice waits in idle, with "Results
  // ready" said as it goes (a take that waited in the banner was announced when it turned
  // ready), or from the banner's "See results". A take just recorded gets the coach's sheet on
  // Results; one opened again never does.
  function openResults(job) {
    if (!jobs.includes(job)) {
      return;
    }
    forgetJob(job);
    if (shown) {
      leavingForResults = true;
      if (state === "idle") {
        app.ui.announce(RESULTS_READY_ANNOUNCEMENT);
      }
    }
    const results = app.screens.results;
    if (results && typeof results.markFresh === "function") {
      results.markFresh(job.id);
    }
    app.router.go("results", { id: job.id });
  }

  function forgetJob(job) {
    const index = jobs.indexOf(job);
    if (index !== -1) {
      jobs.splice(index, 1);
    }
    paintBanner();
  }

  // The banner says one thing about the jobs, in this order: the oldest failed job (its Upload
  // failed sentence, "Retry upload" and "Record a new take"), the oldest too-short one ("Record
  // again"), the ready ones ("See results" opens the oldest), the working ones; with no job it
  // is down. A failure comes first because it is the one that needs the speaker. A new title
  // is said through the live region (app.ui.announce), since the strip itself is no live
  // region: it enters the page already filled, and is hidden while a take records, so a
  // screen reader could not be trusted to read it.
  function paintBanner() {
    const banner = app.ui.banner;
    if (!banner) {
      return;
    }
    const before = banner.current();
    const failed = jobs.find((job) => job.status === FAILED);
    const tooShort = jobs.find((job) => job.status === TOO_SHORT);
    const ready = jobs.filter((job) => job.status === READY);
    const working = jobs.filter((job) => job.status === WORKING);
    if (failed) {
      banner.show({
        kind: "failed",
        title: UPLOAD_FAILED_TITLE,
        body: failed.sentence,
        actions: [
          { label: UPLOAD_FAILED_ACTION, onClick: () => retryJob(failed) },
          { label: NEW_TAKE_ACTION, onClick: () => dropJob(failed) },
        ],
      });
    } else if (tooShort) {
      banner.show({
        kind: "failed",
        title: TOO_SHORT_TITLE,
        body: app.api.messages.too_short,
        actions: [{ label: TOO_SHORT_ACTION, onClick: () => dropJob(tooShort) }],
      });
    } else if (ready.length > 0) {
      banner.show({
        kind: "ready",
        title: readyTitle(ready.length),
        body: readyBody(ready[0].take, ready.length),
        actions: [{ label: BANNER_READY_ACTION, onClick: () => openResults(ready[0]) }],
      });
    } else if (working.length > 0) {
      banner.show({
        kind: "working",
        title: workingTitle(working.length),
        body: workingBody(working[0].take, working.length),
      });
    } else {
      banner.hide();
    }
    const after = banner.current();
    if (after !== null && after.title !== RESULTS_READY_ANNOUNCEMENT && !sameTitle(before, after)) {
      app.ui.announce(after.title);
    }
  }

  // "Results ready" is said by runJob and openResults, where its timing is known; every other
  // banner title is said here when it changes.
  function sameTitle(before, after) {
    return before !== null && before.title === after.title;
  }

  // "Your 0:42 take", from the length the clock showed at Stop.
  function takeName(take) {
    return BANNER_TAKE_PREFIX + app.ui.formatClock(take.durationSeconds) + BANNER_TAKE_SUFFIX;
  }

  function workingTitle(count) {
    if (count === 1) {
      return LOADING_TITLE;
    }
    return BANNER_WORKING_MANY_PREFIX + count + BANNER_WORKING_MANY_SUFFIX;
  }

  function workingBody(take, count) {
    return count === 1 ? takeName(take) + ". " + LOADING_BODY : BANNER_WORKING_BODY_EACH;
  }

  function readyTitle(count) {
    return count === 1 ? RESULTS_READY_ANNOUNCEMENT : count + BANNER_READY_MANY_SUFFIX;
  }

  function readyBody(take, count) {
    return count === 1 ? takeName(take) + BANNER_READY_BODY_SUFFIX : BANNER_READY_MANY_BODY;
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

  // The Upload failed block for a level take, with Retry and "Record a new take". It is kept
  // with its take, so show() can draw it again after the speaker leaves Practice and comes back.
  function showUploadFailed(sentence) {
    failedUpload = {
      title: UPLOAD_FAILED_TITLE,
      body: sentence,
      actionLabel: UPLOAD_FAILED_ACTION,
      onAction: uploadInPlace,
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

  // The timer: one 250 ms tick paints the elapsed clock and the time-limit bar, announces the
  // clock every 30 s and, once per new whole second, paints the live pace row, or lets its
  // capture go when no audio has reached it (readLivePace). It starts right after the recorder,
  // so its start is the recording's, which the live pace's peaks are lined up with
  // (releaseLivePace).
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
    readLivePace(Math.floor(elapsed));
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

  // True within STOP_GRACE_MS of the last Stop, when a tap on the button is a bounce.
  function withinStopGrace() {
    return stoppedAt !== null && performance.now() - stoppedAt < STOP_GRACE_MS;
  }

  // Seconds to a tenth, as a take's duration and its live taps are kept.
  function toTenth(seconds) {
    return Math.round(seconds * 10) / 10;
  }

  // --- the live pace while a take records (spec section 7) ---

  // Starts the take's live pace capture, right after the pause sampler: an AudioContext of its
  // own at the device's rate, the stream's source into a ScriptProcessor whose blocks go to an
  // app.delivery.livePace tracker, and a zero gain to the output, without which the processor
  // never runs. The tracker judges against the shown entry's band and counts with the kept
  // factor of the take's mode. Every take, level mode's too, is captured, so every take that
  // counts tunes its mode. Without Web Audio or the estimator the take records without the row;
  // so it does when a step throws (a tracker refuses a rate under 8 kHz), after whatever was
  // made is let go. A capture still held from before goes first, as app.pauses.start stops its
  // own sampler.
  function startLivePace(stream) {
    releaseLivePace();
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    const delivery = app.delivery;
    if (!AudioContextClass || !delivery || typeof delivery.livePace !== "function") {
      return;
    }
    const entry = shownEntry();
    const mode = paceModeOf(entry);
    const pace = {
      context: null,
      source: null,
      processor: null,
      silence: null,
      tracker: null,
      mode,
      // Whether the mode had a kept factor when the take began: only then does its row show a
      // cue; until then its number is rough (the validation result).
      tuned: paceFactors[mode] !== null,
      firstSampleAt: null,
      readSecond: 0,
      reading: null,
    };
    try {
      pace.context = new AudioContextClass();
      pace.tracker = delivery.livePace(pace.context.sampleRate, {
        band: entry ? entry.targetWpm : null,
        factor: paceFactors[mode],
      });
      pace.source = pace.context.createMediaStreamSource(stream);
      pace.processor = pace.context.createScriptProcessor(
        PACE_BLOCK_SAMPLES,
        PACE_CHANNELS,
        PACE_CHANNELS,
      );
      pace.silence = pace.context.createGain();
      pace.silence.gain.value = PACE_SILENT_GAIN;
      pace.processor.onaudioprocess = (event) => pushPaceBlock(pace, event);
      pace.source.connect(pace.processor);
      pace.processor.connect(pace.silence);
      pace.silence.connect(pace.context.destination);
      // iOS Safari may hand over a suspended context, and a suspended graph hands over nothing.
      // One that refuses to resume never will, so its capture goes and the row with it; one
      // whose resume() never answers goes at 0:03 (readLivePace).
      if (pace.context.state === "suspended" && typeof pace.context.resume === "function") {
        whenRefused(pace.context.resume(), () => dropLivePace(pace));
      }
    } catch {
      tearDownPace(pace);
      return;
    }
    capture.pace = pace;
  }

  // The mode a take records in, as app.language.isReadTake will judge the saved take: Read when
  // a script goes with it (a passage's text, on the Read tab or in a level, or a script pasted on
  // Talk), Talk otherwise.
  function paceModeOf(entry) {
    return scriptFor(entry) === "" ? TALK_PACE : READ_PACE;
  }

  // One block from the microphone: its first channel goes to the take's tracker. The first
  // block notes when the tracker's first sample was heard, the block's arrival less its own
  // length, to line the peaks up with the recording (releaseLivePace).
  function pushPaceBlock(pace, event) {
    if (pace.tracker === null) {
      return;
    }
    const samples = event.inputBuffer.getChannelData(0);
    if (pace.firstSampleAt === null) {
      pace.firstSampleAt = performance.now() - (samples.length / pace.context.sampleRate) * 1000;
    }
    pace.tracker.push(samples);
  }

  // Once per new whole second on the clock. A capture that no block has reached by
  // PACE_NO_AUDIO_SECONDS goes (dropLivePace), level mode's too, so its context is freed. Else,
  // in a normal take, tuned or not, the tracker's reading of the audio heard so far, painted.
  // Level mode reads nothing, since its row never shows.
  function readLivePace(second) {
    const pace = capture.pace;
    if (pace === null || second <= pace.readSecond) {
      return;
    }
    pace.readSecond = second;
    if (pace.firstSampleAt === null && second >= PACE_NO_AUDIO_SECONDS) {
      dropLivePace(pace);
      return;
    }
    if (levelRequest !== null) {
      return;
    }
    pace.reading = pace.tracker.read();
    paintPace(viewFor(state));
  }

  // The live pace row, shown only while a normal take records with its capture running: never
  // in idle, uploading or error, never in level mode, whose takes count, and never for a take
  // whose capture did not start or was dropped. A dropped capture's row hides with its last
  // words and the held class, which keeps its box until the take ends, so nothing above Record
  // moves while the speaker talks. The row says the waiting sentence until the tracker has a
  // number, then the number and, for a take whose mode had a kept factor when it began, the cue;
  // for one whose mode had none, the rough words in the cue's place, and never a cue. The words
  // are the tracker's: its number comes rounded and its cue held. The children are rebuilt only
  // when the words change.
  function paintPace(view) {
    const pace = capture.pace;
    const normalTake = view.showPace && levelRequest === null;
    nodes.pace.hidden = !(normalTake && pace !== null);
    nodes.pace.classList.toggle(PACE_HELD_CLASS, normalTake && capture.paceDropped);
    if (nodes.pace.hidden) {
      return;
    }
    const { sentence, number, cue, rough } = paceWordsOf(pace);
    const text =
      sentence !== null ? sentence : [number, cue && cue.words, rough].filter(Boolean).join(" ");
    if (text === paintedPaceText) {
      return;
    }
    paintedPaceText = text;
    app.ui.clear(nodes.pace);
    if (sentence !== null) {
      nodes.pace.appendChild(
        app.ui.el("span", { class: "practice__pace-placeholder", text: sentence }),
      );
      return;
    }
    if (number !== null) {
      nodes.pace.appendChild(
        app.ui.el("span", { class: "practice__pace-number num", text: number }),
      );
    }
    // The space Results writes in "162 wpm": flex draws no gap from it, but a screen reader
    // keeps "wpm" and "On" (or "Rough") apart.
    if (number !== null && (cue !== null || rough !== null)) {
      nodes.pace.appendChild(document.createTextNode(" "));
    }
    if (cue !== null) {
      nodes.pace.appendChild(paceCueNode(cue));
    }
    if (rough !== null) {
      nodes.pace.appendChild(app.ui.el("span", { class: "practice__pace-rough", text: rough }));
    }
  }

  // What the row says for a take's capture: `sentence`, shown in the placeholder look, is the
  // waiting sentence until the tracker has a number, else null; then `number`, "About 150 wpm",
  // `cue`, its look, or null for none, and `rough`, the rough words for a take whose mode had no
  // kept factor when it began (which never gets a cue), or null.
  function paceWordsOf(pace) {
    const reading = pace.reading;
    if (reading === null || reading.wpm === null) {
      return { sentence: PACE_WAITING, number: null, cue: null, rough: null };
    }
    return {
      sentence: null,
      number: PACE_NUMBER_PREFIX + reading.wpm + PACE_NUMBER_SUFFIX,
      cue: pace.tuned ? paceLookOf(reading.cue) : null,
      rough: pace.tuned ? null : PACE_ROUGH,
    };
  }

  // The look of app.delivery's cue id, or null for none.
  function paceLookOf(cue) {
    const { ON_TARGET, SLOW_DOWN, SPEED_UP } = app.delivery;
    if (cue === null || cue === undefined) {
      return null;
    }
    if (cue === ON_TARGET) {
      return PACE_LOOK_ON_TARGET;
    }
    if (cue === SLOW_DOWN) {
      return PACE_LOOK_SLOW_DOWN;
    }
    return cue === SPEED_UP ? PACE_LOOK_SPEED_UP : null;
  }

  // The cue's words, then its icon, which CSS draws first, as a Results hint does.
  function paceCueNode(look) {
    return app.ui.el(
      "span",
      { class: "practice__pace-cue practice__pace-cue--" + look.tone, text: look.words },
      [app.ui.icon(look.icon, PACE_ICON_SIZE)],
    );
  }

  // Lets the take's live pace capture go, whichever way the take ends (releaseCapture): Stop,
  // the track ending, hide(), a take under 5 seconds, a recorder that cannot start. Hands back
  // what tunePace needs, {peaks, mode}, or null without a capture or when no block came. The
  // tracker's peaks count from its first sample, the transcript's words from the recorder's
  // start (startTimer notes it), so the time between the two goes on every peak. That sample's
  // time is its block's arrival less the block's length (1024 samples: 21 ms at 48 kHz, 128 ms
  // at 8 kHz), late only by the time the browser takes to hand a block over, some tens of
  // milliseconds: well inside the 0.25 s paceFactorAfter allows at the edges of the speech.
  function releaseLivePace() {
    const pace = capture.pace;
    capture.pace = null;
    if (pace === null) {
      return null;
    }
    const heard = pace.firstSampleAt !== null;
    const offset = heard ? (pace.firstSampleAt - capture.startedAt) / 1000 : 0;
    const peaks = heard ? pace.tracker.peaks().map((peak) => peak + offset) : null;
    tearDownPace(pace);
    return peaks === null ? null : { peaks, mode: pace.mode };
  }

  // A capture whose context refused to resume, or that no block reached by 0:03, goes as if it
  // had never started, unless its take has let it go already: the context closes and the row
  // hides for the rest of the take, which tunes nothing. The row keeps its box (paintPace).
  function dropLivePace(pace) {
    if (capture.pace !== pace) {
      return;
    }
    releaseLivePace();
    capture.paceDropped = true;
    paintPace(viewFor(state));
  }

  // Clears the handler, disconnects every node made, closes the context and drops the tracker;
  // safe on a capture whose setup stopped partway.
  function tearDownPace(pace) {
    if (pace.processor) {
      pace.processor.onaudioprocess = null;
    }
    [pace.source, pace.processor, pace.silence].forEach((node) => {
      if (node) {
        node.disconnect();
      }
    });
    const context = pace.context;
    if (context && context.state !== "closed" && typeof context.close === "function") {
      ignoreRejection(context.close());
    }
    pace.tracker = null;
  }

  // close() answers with a promise whose outcome changes nothing here.
  function ignoreRejection(promise) {
    whenRefused(promise, () => {});
  }

  // Runs `then` if `promise` is refused. An older browser's resume() or close() may hand back
  // no promise at all, which refuses nothing.
  function whenRefused(promise, then) {
    if (promise && typeof promise.catch === "function") {
      promise.catch(then);
    }
  }

  // Reads each mode's kept live pace factor from its flag. A store without getFlag (some test
  // fakes) or one that cannot be read leaves the factors as they were; a flag that holds no
  // number (none kept yet, or cleared with the site's data) means none.
  async function loadPaceFactors() {
    const store = app.store;
    if (!store || typeof store.getFlag !== "function") {
      return;
    }
    await Promise.all(
      PACE_MODES.map(async (mode) => {
        try {
          const value = await store.getFlag(PACE_FACTOR_FLAG_PREFIX + mode);
          paceFactors[mode] = typeof value === "number" && Number.isFinite(value) ? value : null;
        } catch {
          // Blocked or unreadable storage: this mode keeps the factor it had.
        }
      }),
    );
  }

  // Tunes the take's mode's live pace factor once its analysis is back and its session built
  // (settle): app.delivery.paceFactorAfter moves the kept factor toward the take's own words a
  // peak, and a take that counts (app.delivery.countsForPaceFactor: 20 s of speech, 30 words)
  // keeps the result with app.store.setFlag, then here, even when it did not move: its mode has
  // a factor from then on, so the mode's next takes show the number and the cue. A take that
  // does not count keeps nothing. The first call takes the peaks with it, so a Retry never
  // tunes a take twice; the sample never comes here. A store that cannot keep the factor
  // changes nothing the speaker sees: the mode keeps the factor it had, and its row stays as it
  // was.
  async function tunePace(take) {
    const pace = take.pace;
    take.pace = null;
    const delivery = app.delivery;
    const store = app.store;
    const canTune =
      Boolean(delivery) &&
      typeof delivery.paceFactorAfter === "function" &&
      typeof delivery.countsForPaceFactor === "function" &&
      Boolean(store) &&
      typeof store.setFlag === "function";
    if (pace === null || !canTune) {
      return;
    }
    try {
      const mode = tunedModeOf(take, pace);
      const words = take.analysis.transcript;
      const factor = delivery.paceFactorAfter(paceFactors[mode], words, pace.peaks);
      if (!delivery.countsForPaceFactor(words, pace.peaks)) {
        return;
      }
      await store.setFlag(PACE_FACTOR_FLAG_PREFIX + mode, factor);
      paceFactors[mode] = factor;
    } catch {
      // Blocked or unwritable storage: the mode keeps the factor it had.
    }
  }

  // The mode a take tunes: app.language.isReadTake's verdict on its saved session, the rule the
  // rank, Progress and History split takes by; without language.js, the mode it recorded in.
  function tunedModeOf(take, pace) {
    const language = app.language;
    if (language && typeof language.isReadTake === "function") {
      return language.isReadTake(take.session) ? READ_PACE : TALK_PACE;
    }
    return pace.mode;
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
