/* screens/level.js: app.screens.level, one Loop Path play at #/level/<playId> (spec
   docs/superpowers/specs/2026-10-14-loop-path.md sections 7 and 8): its goal, its takes, the
   feedback and review after take 1, and its result. It keeps one run in memory, hands each take
   to Practice (app.screens.practice.startLevelTake), judges it with app.path, plays take 1 back
   from memory for the review and records what a pass clears. Every rule and number comes from
   app.path and app.loop; the screen builds its nodes one by one, never from markup. */
(function () {
  "use strict";

  // --- Routes, plays and the run's views -------------------------------------------------------

  const PATH_ROUTE = "path";
  const LEVEL_ROUTE = "level";
  const PRACTICE_ROUTE = "practice";
  const PATH_HREF = "#/path";
  const LEVEL_HREF = "#/level/";

  // Play kinds and materials as app.path names them.
  const LOOP = "loop";
  const CHECKBACK = "checkback";
  const CROWN = "crown";
  const CHECKPOINT = "checkpoint";
  const BENCHMARK = "benchmark";
  const LADDER_MATERIAL = "ladder";
  const BENCHMARK_MATERIAL = "benchmark";
  const CLEARED_STATUS = "cleared";
  const LOCKED_STATUS = "locked";
  const RESTING_STATUS = "resting";
  // app.path.ringOf's ring for a level whose check-backs have both passed.
  const GOLD_RING = "gold";

  // Route ids and records the spec names (section 1): a level's check-back is played as
  // "<level>_checkback", and a passed first check-back keeps "<level>_cb1". The Result asks
  // app.path.checkbacks when check-back 2 falls once that record exists, so the schedule's rule
  // stays in path.js.
  const CHECKBACK_SUFFIX = "_checkback";
  const FIRST_CHECKBACK_RECORD = "_cb1";

  // Where a run stands: its Goal (the benchmark's Intro), the Review after take 1 (the feedback
  // first, then the moments), a take step between two takes, or its Result (the benchmark's
  // Done). The stepper's steps come from app.loop.stepsFor.
  const GOAL_VIEW = "goal";
  const REVIEW_VIEW = "review";
  const TAKE_VIEW = "take";
  const RESULT_VIEW = "result";
  const FEEDBACK_PHASE = "feedback";
  const MOMENTS_PHASE = "moments";
  const REVIEW_STEP = "review";
  const TAKE_STEP = "take";

  // The long-pause prep counts down a second at a time.
  const PREP_TICK_MS = 1000;
  const MS_PER_SECOND = 1000;
  // The Review's time estimate: about this long a moment ("about 30 s" for three).
  const SECONDS_PER_MOMENT = 10;
  // The fix chips' heading, which names their group.
  const FIX_TITLE_ID = "level-fix-title";

  // --- Copy (spec section 8; DESIGN.md section 8 for the voice) ---------------------------------

  const DEFAULT_HEADING = "Level";
  const BACK_LABEL = "Path";
  const STEPS_LABEL = "Level steps";
  const DONE_NOTE = ", done";
  const LOADING_TITLE = "Loading your level";
  const LOADING_BODY = "Reading your past takes.";
  const NOT_FOUND_TITLE = "Level not found";
  const NOT_FOUND_BODY = "Pick a level on the path.";
  const LOCKED_TITLE = "Not open yet";
  const CLEAR_BEFORE_FIRST = "Clear the levels before it first.";
  const RESTING_TITLE = "Back tomorrow";
  const OPENS_TOMORROW = "This level opens again tomorrow.";
  const NOT_DUE_TITLE = "Not due yet";
  const LOCKED_IN_TITLE = "Locked in";
  const NOTHING_LEFT_TO_CHECK = "Both check-backs passed. Nothing is left to check.";
  const BACK_TO_PATH = "Back to path";

  // Goal
  const LIKE_THIS = "Like this: ";
  const NOT_LIKE_THIS = "Not like this: ";
  const SOURCE_LABEL = "Source:";
  const NEW_TAB_NOTE = ", opens in a new tab";
  const TOP_FILLERS_TITLE = "Your top fillers";
  const NO_FILLERS_YET = "No fillers counted yet. Take 1 will find yours.";
  const START_PLANNING = "Start planning";
  const SKIP_LABEL = "Skip";
  const PLANNING_DONE = "Planning time is up.";
  const PLANNING_SKIPPED = "Planning skipped.";
  const IN_THE_ROOM_SWITCH = "Someone is listening (in the room)";
  const READ_IT = "Read it";
  const RECORD = "Record";
  const START_BENCHMARK = "Start benchmark";

  // Feedback and review
  const MOMENT_COUNT_WORDS = ["One", "Two", "Three"];
  const PLAY_CLIP = "Play 3 s";
  const STOP_LABEL = "Stop";
  const WHAT_HAPPENED_ASK = "What happened?";
  const SPOT_IT_TITLE = "Spot it";
  const SPOT_IT_HOW = "Play take 1. Tap Heard one each time you hear a filler.";
  const PLAY_TAKE_1 = "Play take 1";
  const HEARD_ONE = "Heard one";
  const PRIVACY =
    "Take 1's audio stays in this phone's memory for this level only, then it is deleted. " +
    "It is never saved.";
  const AUDIO_GONE = "Take 1's audio is gone: it is kept only while this level is open.";
  const SAY_IT_AGAIN = "Say it again";
  const READ_IT_AGAIN = "Read it again";
  const RECORD_THE_TALK = "Record the talk";

  // Result
  const LEVEL_CLEARED = "Level cleared";
  const NOT_YET = "Not yet";
  const CHECK_BACK_TITLE = "Check back";
  const CHECK_BACK_TALK = "A level counts when it sticks. One quick take on a new topic:";
  const CHECK_BACK_READ = "A level counts when it sticks. One quick read of a new passage:";
  const TURNS_GOLD = ", turns the node ";
  const GOLD = "gold";
  const NEXT_LABEL = "Next";
  const START_CHECKPOINT = "Start checkpoint";
  const CHECKBACK_HALF = "Check-back passed: half ring";
  const CHECKBACK_GOLD = "Locked in: the node turns gold";
  const CROWN_EARNED = "Crown earned";
  const CHECKPOINT_CLEARED = "Checkpoint cleared";
  const CLEARED_IN_THE_ROOM = "Cleared in the room";
  const SAVE_FAILED = "Could not save your progress on this device.";
  const BENCHMARK_DONE = "Benchmark done";
  const READ_LINE = "Read: ";
  const TALK_LINE = "Talk: ";
  const SINCE_FIRST = "Since your first: ";

  // The banner Practice shows for a take (section 7).
  const ONE_TAKE = "One take";
  const ONE_READ = "One read";
  const READ_ALOUD = "Read the passage aloud.";
  const MEASURED_ONLY = "It is measured, not scored.";

  // How a moment's slip is marked, as the transcript marks it on Results, and what a screen
  // reader hears after it. A pace third outside its band reads in --warn with the alert icon.
  const MOMENT_MARKS = Object.freeze({
    filler: { className: "tok--filler", note: ", filler" },
    restart: { className: "tok--restart", note: ", restart" },
    misread: { className: "tok--misread", note: ", misread" },
    "long-pause": { className: "tok--pause tok--pause-long", note: ", long pause" },
    pause: { className: "tok--pause", note: ", pause" },
    pace: { className: "level-moment__off", note: ", outside the band" },
  });
  // The slip an example line marks.
  const EXAMPLE_MARKS = Object.freeze({
    filler: "tok--filler",
    restart: "tok--restart",
    pause: "tok--pause",
  });
  // The change line's icon follows the number: down, up or the same.
  const TREND_ICONS = Object.freeze({ down: "triangle-down", up: "triangle-up", flat: "dash" });

  // --- State -----------------------------------------------------------------------------------

  // The section, its h1 and its body, found once at mount.
  let heading = null;
  let body = null;
  // The one run in memory (startRun), or null.
  let run = null;
  // Whether the screen shows, and the play it shows.
  let visible = false;
  let shownPlayId = null;
  // Counts show() and hide() calls, so a slow load from an earlier visit never paints over a
  // newer one.
  let showCount = 0;
  // The Goal's prep card while it is drawn ({controls, clock, seconds, next}), and its countdown
  // while it runs ({remaining, id}).
  let prepView = null;
  let prepTimer = null;

  // --- Lifecycle -------------------------------------------------------------------------------

  // The back link to the Path goes right before the h1, once. Any route change that leaves both
  // Practice and this play ends the run, even one away from Practice, which this screen never
  // hides from.
  function mount(root) {
    heading = root.querySelector("h1");
    body = root.querySelector(".screen__body");
    const back = el("a", { class: "level-back", href: PATH_HREF }, [
      iconOf("chevron-left", 20),
      BACK_LABEL,
    ]);
    root.insertBefore(back, heading || body);
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("hashchange", endRunOffRoute);
    }
  }

  // The run for this play carries on where it stands, as when Practice hands a take back.
  // Without one, a new run starts at the Goal once the store's takes and cleared records are in:
  // its baseline frozen and its material drawn. A play that cannot start says why.
  async function show(params) {
    visible = true;
    const ticket = ++showCount;
    const playId = params && typeof params.id === "string" ? params.id : null;
    const known = playId === null ? null : app.path.playById(playId);
    shownPlayId = known ? known.id : null;
    if (known === null) {
      setHeading(DEFAULT_HEADING);
      renderState(NOT_FOUND_TITLE, NOT_FOUND_BODY, "search");
      return;
    }
    setHeading(known.heading);
    if (run !== null && run.playId === known.id) {
      render();
      return;
    }
    endRun();
    app.ui.renderState(body, { kind: "loading", title: LOADING_TITLE, body: LOADING_BODY });
    const [history, cleared] = await Promise.all([loadHistory(), loadCleared()]);
    if (ticket !== showCount) {
      return;
    }
    // A take handed back while the store was read brought this play's run back (takeSaved).
    if (run !== null && run.playId === known.id) {
      render();
      return;
    }
    const blocked = blockedReason(known, history, cleared);
    if (blocked !== null) {
      renderState(blocked.title, blocked.body, blocked.icon);
      return;
    }
    run = startRun(known.id, history, cleared);
    render();
  }

  // Leaving stops the countdown and anything playing. The run lives on only while the route
  // shows Practice (a take of this play is being recorded) or this same play.
  function hide() {
    visible = false;
    shownPlayId = null;
    showCount += 1;
    stopPrep();
    if (run !== null) {
      stopPlayback(run.audio);
    }
    endRunOffRoute();
  }

  function endRunOffRoute() {
    if (run !== null && !routeKeeps(run)) {
      endRun();
    }
  }

  function routeKeeps(target) {
    const router = app.router;
    const route = router && typeof router.current === "function" ? router.current() : null;
    if (!route) {
      return false;
    }
    const samePlay = route.name === LEVEL_ROUTE && Boolean(route.params) &&
      route.params.id === target.playId;
    return route.name === PRACTICE_ROUTE || samePlay;
  }

  // --- The run ---------------------------------------------------------------------------------

  // A new run: {playId, play, baseline, cleared, history, material, takes, sessions, kept,
  // choices, fix, inRoom, audio, ...}. The baseline is frozen here from the takes before the
  // play (null for a speaker with none, until a take with speech sets it), and the material is
  // drawn here once for every take of a loop.
  function startRun(playId, history, cleared) {
    const baseline = app.path.baseline(history);
    const play = app.path.playById(playId, { baseline, cleared });
    return {
      playId,
      play,
      baseline,
      cleared,
      history,
      material: app.path.materialFor(play, history, Math.random, 0),
      topFillers: play.listsTopFillers ? app.path.topFillers(history) : [],
      // By take index: {transcript, metrics, report, evaluation, liveTaps, session}.
      takes: [],
      // The run's saved sessions, newest first, and the records its passes kept.
      sessions: [],
      kept: [],
      saveFailed: false,
      // The Review's choices: what happened at each moment, and the fix for the next take.
      choices: {},
      fix: null,
      inRoom: false,
      // Take 1's recording and its playback, while the run keeps them (keepAudio).
      audio: null,
      feedback: null,
      moments: [],
      view: GOAL_VIEW,
      phase: null,
      // The take recorded next, and the one the Result shows.
      takeIndex: 0,
      last: null,
      // Whether the run has handed Practice a take to record yet (startTake).
      requested: false,
      // The step last drawn, so a new step takes focus and is announced.
      drawn: null,
    };
  }

  // The run ends: its countdown stops and take 1's audio is released.
  function endRun() {
    if (run === null) {
      return;
    }
    stopPrep();
    releaseAudio(run);
    run = null;
  }

  // Practice's "Leave level" ends the run; Practice is back in its normal mode.
  function leaveLevel(target) {
    if (run === target) {
      endRun();
    }
  }

  // A take step's material: the run's own, drawn at the Goal. A ladder read asks again for its
  // own band on the same passage, and the benchmark's take 2 is its talk.
  function materialOf(target, takeIndex) {
    const key = target.play.material;
    const material =
      (key === LADDER_MATERIAL || key === BENCHMARK_MATERIAL) && takeIndex > 0
        ? app.path.materialFor(target.playId, target.history, Math.random, takeIndex)
        : target.material;
    return Object.assign({}, material, { targetWpm: Array.from(material.targetWpm) });
  }

  // The take at `takeIndex`, resolved against the run's frozen baseline.
  function takeOf(target, takeIndex) {
    return app.path.takeAt(target.playId, takeIndex, {
      baseline: target.baseline,
      cleared: target.cleared,
    });
  }

  // A take's set seconds. Pace level 3's take 2 has none until a take with speech sets the
  // baseline; then its limit is the first take's length, the longer of the two it may be.
  function secondsOf(play, take) {
    return typeof take.seconds === "number" ? take.seconds : play.takes[0].seconds;
  }

  // --- Takes: the Practice contract (spec section 7) ------------------------------------------

  function startTake(target, takeIndex) {
    const practice = app.screens.practice;
    if (!practice || typeof practice.startLevelTake !== "function") {
      return;
    }
    stopPrep();
    stopPlayback(target.audio);
    target.requested = true;
    practice.startLevelTake(requestFor(target, takeIndex));
  }

  // What Practice shows and calls back for one take.
  function requestFor(target, takeIndex) {
    const play = target.play;
    const take = takeOf(target, takeIndex);
    return {
      eyebrow: "Path: " + play.heading,
      title: bannerTitle(play, take, takeIndex),
      body: bannerBody(target, take, takeIndex),
      material: materialOf(target, takeIndex),
      seconds: secondsOf(play, take),
      liveTap: play.liveTap === true,
      judge: (result) => judgeTake(target, takeIndex, result),
      onSaved: (saved) => {
        takeSaved(target, takeIndex, saved);
      },
      onLeave: () => leaveLevel(target),
    };
  }

  // "Take 1 of 2", "Read 2 of 3"; a retry by its own label ("Take 3"); "One take" or "One read"
  // for a one-take play.
  function bannerTitle(play, take, takeIndex) {
    const listed = play.takes.length;
    if (listed === 1) {
      return take.read ? ONE_READ : ONE_TAKE;
    }
    if (takeIndex >= listed) {
      return take.label;
    }
    const numbered = /\d$/.test(take.label) ? take.label : "Take " + (takeIndex + 1);
    return numbered + " of " + listed;
  }

  // What to do, or the fix the speaker chose for this take, then what counts: "Talk for 90 s.
  // Take 2 counts: 6 or fewer fillers a minute."
  function bannerBody(target, take, takeIndex) {
    const play = target.play;
    const lead =
      takeIndex > 0 && target.fix ? "Your fix: " + target.fix + "." : actionOf(play, take);
    return lead + " " + countsOf(play, take, takeIndex);
  }

  function actionOf(play, take) {
    if (!take.read) {
      return "Talk for " + secondsOf(play, take) + " s.";
    }
    const ladder =
      play.kind === LOOP && play.material === LADDER_MATERIAL && Array.isArray(take.band);
    return ladder
      ? "Read the passage at " + take.band[0] + " to " + take.band[1] + " wpm."
      : READ_ALOUD;
  }

  function countsOf(play, take, takeIndex) {
    if (play.kind === BENCHMARK) {
      return MEASURED_ONLY;
    }
    const words = targetWords(play.goal, scoredWhere(play));
    if (play.kind !== LOOP) {
      return "Target: " + words + ".";
    }
    const scored = play.takes.filter((each) => each.scored);
    if (scored.length > 1) {
      return "Both " + (take.read ? "reads" : "takes") + " count: " + words + ".";
    }
    const counted = takeIndex >= play.takes.length ? take.label : scored[scored.length - 1].label;
    return counted + " counts: " + words + ".";
  }

  // The goal in a phrase: its headline and unit label, without the take the label names (the
  // banner names it) or the gloss after a colon: "6 or fewer fillers a minute", "4 or fewer
  // slips", "No long pause, slips in all at your usual or fewer".
  function targetWords(goal, where) {
    let unit = String(goal.unitLabel || "");
    if (where) {
      unit = unit.split(" on " + where).join("");
    }
    const colon = unit.indexOf(": ");
    if (colon !== -1) {
      unit = unit.slice(0, colon);
    }
    return unit === "" ? goal.headline : goal.headline + headlineJoiner(goal.headline) + unit;
  }

  // A number reads on into its unit ("6 or fewer fillers a minute"); a headline in words is a
  // clause of its own ("No long pause, slips in all ...").
  function headlineJoiner(headline) {
    return /\d/.test(headline) ? " " : ", ";
  }

  // The take a loop's goal says it is judged on ("take 2", "read 3"), or null.
  function scoredWhere(play) {
    if (play.kind !== LOOP) {
      return null;
    }
    const scored = play.takes.filter((take) => take.scored);
    return scored[scored.length - 1].label.toLowerCase();
  }

  // Practice calls this once the take uploads: the take is judged with app.path.evaluate
  // against the run (spec section 6) and kept with its words, which the Review's moments need.
  // A speaker with no baseline gets one here from the first take with speech. Returns the
  // session's `path` field.
  function judgeTake(target, takeIndex, result) {
    const given = result && typeof result === "object" ? result : {};
    const transcript = Array.isArray(given.transcript) ? given.transcript : [];
    const report = app.delivery.analyze(transcript, given.metrics);
    const evaluation = app.path.evaluate(target.playId, takeIndex, report, {
      baseline: target.baseline,
      cleared: target.cleared,
      earlier: target.takes.map((take) => (take ? take.evaluation : null)),
      fix: target.fix,
      inRoom: target.inRoom,
    });
    target.takes[takeIndex] = {
      transcript,
      metrics: given.metrics,
      report,
      evaluation,
      liveTaps: [],
      session: null,
    };
    freezeBaseline(target, takeIndex, report);
    return pathFieldOf(target, takeIndex, evaluation);
  }

  // A null baseline (or measure() of a take without speech) gives way to measure() of the run's
  // first take with speech, which Fillers level 1's target and Pace level 3's take 2 read. A take
  // without speech stands in until then, so later takes can still be judged.
  function freezeBaseline(target, takeIndex, report) {
    if (hasSpeech(target.baseline)) {
      return;
    }
    const take = takeOf(target, takeIndex);
    const measured = app.path.measure(report, take && take.seconds ? take.seconds : 0);
    if (measured.spoke || target.baseline === null) {
      target.baseline = measured;
      target.play = app.path.playById(target.playId, {
        baseline: measured,
        cleared: target.cleared,
      });
    }
  }

  function hasSpeech(baseline) {
    return baseline !== null && typeof baseline === "object" && baseline.spoke !== false;
  }

  // {play, kind, take, scored, passed, stage, inRoom}: passed only on a scored take, stage on a
  // check-back, inRoom on a checkpoint.
  function pathFieldOf(target, takeIndex, evaluation) {
    const kind = target.play.kind;
    const scored = evaluation.scored === true;
    return {
      play: target.playId,
      kind,
      take: takeIndex + 1,
      scored,
      passed: scored ? evaluation.passed === true : null,
      stage: kind === CHECKBACK ? evaluation.stage : null,
      inRoom: kind === CHECKPOINT ? target.inRoom === true : null,
    };
  }

  // Practice saved the take and hands its recording back. A loop keeps take 1's audio for the
  // review; a pass writes every record evaluate listed. Then the run moves to its next step and
  // the screen shows it. A take that answers a run which has ended was judged and saved all the
  // same, so that run comes back to show it (bringBack), unless another play holds the screen.
  async function takeSaved(target, takeIndex, saved) {
    const take = target.takes[takeIndex];
    if (!take) {
      return;
    }
    const given = saved && typeof saved === "object" ? saved : {};
    take.session = sessionOf(target, takeIndex, take, given);
    take.liveTaps = Array.isArray(given.liveTaps)
      ? given.liveTaps.filter((tap) => typeof tap === "number" && Number.isFinite(tap))
      : [];
    target.sessions.unshift(take.session);
    if (run === target && takeIndex === 0 && target.play.kind === LOOP) {
      keepAudio(target, given);
    }
    if (take.evaluation.passed === true && take.evaluation.records.length > 0) {
      await keepRecords(target, take.evaluation.records);
    }
    if (run !== target && !bringBack(target)) {
      return;
    }
    advance(target, takeIndex);
    if (visible && shownPlayId === target.playId) {
      render();
    } else {
      app.router.go(LEVEL_ROUTE, { id: target.playId });
    }
  }

  // A run that ended while Practice still held its take (an upload that failed, then went
  // through on Retry once the speaker came back) is the screen's run again, so the speaker sees
  // what the take did: the Result, a miss's next try, or after take 1 its feedback. Take 1's
  // audio went with the run and stays gone. It comes back only while no other play holds the
  // screen: no run at all, or a fresh one of this same play that has asked Practice for no
  // take yet. Returns whether it came back.
  function bringBack(target) {
    const freshOfThisPlay = run !== null && run.playId === target.playId && !run.requested;
    if (run !== null && !freshOfThisPlay) {
      return false;
    }
    endRun();
    run = target;
    return true;
  }

  // The saved take as the history reads it: Practice's session, with what the run knows
  // filled in where it is missing.
  function sessionOf(target, takeIndex, take, saved) {
    const session = saved.session && typeof saved.session === "object"
      ? Object.assign({}, saved.session)
      : {};
    if (typeof session.id !== "string" && typeof saved.id === "string") {
      session.id = saved.id;
    }
    if (typeof session.createdAt !== "string") {
      session.createdAt = new Date().toISOString();
    }
    if (!Array.isArray(session.transcript)) {
      session.transcript = take.transcript;
    }
    if (!session.metrics) {
      session.metrics = take.metrics;
    }
    if (!session.path) {
      session.path = pathFieldOf(target, takeIndex, take.evaluation);
    }
    return session;
  }

  // Writes each record in order, all with one clearedAt, the time the take passed, so levels a
  // take jumped share its day and their check-backs fall with its own (spec section 4), even
  // when the writes straddle midnight. A write that fails still counts for the dates shown, and
  // the Result says the progress could not be saved.
  async function keepRecords(target, records) {
    const clearedAt = new Date().toISOString();
    for (const levelId of records) {
      try {
        const kept = await app.store.markLevelCleared(levelId, clearedAt);
        target.kept.push(kept && typeof kept.levelId === "string" ? kept : { levelId, clearedAt });
      } catch {
        target.saveFailed = true;
        target.kept.push({ levelId, clearedAt });
      }
    }
  }

  // The step after the take at `takeIndex`: the next one app.loop.stepsFor lists, or for a
  // retry the Result once its attempt is complete. An attempt is as many takes as the play's
  // list scores: one, or Pace level 2's pair of reads. The Result releases take 1's audio.
  function advance(target, takeIndex) {
    const next = stepAfter(target, takeIndex);
    target.view = next.view;
    target.phase = next.view === REVIEW_VIEW ? FEEDBACK_PHASE : null;
    target.takeIndex = next.view === RESULT_VIEW ? takeIndex + 1 : next.takeIndex;
    if (next.view === REVIEW_VIEW) {
      prepareReview(target);
    }
    if (next.view === RESULT_VIEW) {
      target.last = takeIndex;
      releaseAudio(target);
    }
  }

  function stepAfter(target, takeIndex) {
    const play = target.play;
    const listed = play.takes.length;
    if (takeIndex < listed) {
      const steps = app.loop.stepsFor(play.id);
      const at = steps.findIndex(
        (step) => step.step === TAKE_STEP && step.takeIndex === takeIndex,
      );
      const following = steps[at + 1];
      if (following.step === REVIEW_STEP) {
        return { view: REVIEW_VIEW, takeIndex: takeIndex + 1 };
      }
      if (following.step === TAKE_STEP) {
        return { view: TAKE_VIEW, takeIndex: following.takeIndex };
      }
      return { view: RESULT_VIEW };
    }
    const attempt = play.takes.filter((take) => take.scored).length;
    return (takeIndex - listed + 1) % attempt === 0
      ? { view: RESULT_VIEW }
      : { view: TAKE_VIEW, takeIndex: takeIndex + 1 };
  }

  // Take 1's feedback and moments, worked out once (app.loop).
  function prepareReview(target) {
    const take = target.takes[0];
    target.feedback = app.loop.feedbackFor(target.playId, take.report, {
      takeIndex: 0,
      baseline: target.baseline,
      cleared: target.cleared,
      history: target.history,
      takeId: take.session.id,
      at: take.session.createdAt,
      today: today(),
      liveTaps: take.liveTaps,
    });
    target.moments = app.loop.momentsFor(target.playId, take.report, take.transcript, 0);
  }

  // The takes the store had at the Goal, with the run's own saved since, newest first.
  function historyNow(target) {
    return target.sessions.concat(target.history);
  }

  function clearedAfter(target) {
    return target.cleared.concat(target.kept);
  }

  // --- Plays that cannot start -----------------------------------------------------------------

  // Why a play cannot start, or null: a level not unlocked or resting today, a check-back not
  // due today (checkbackBlocked), a crown or checkpoint not open yet.
  function blockedReason(play, history, cleared) {
    const locked = (why) => ({ title: LOCKED_TITLE, body: why, icon: "lock" });
    if (play.kind === LOOP) {
      const status = app.path.statusOf(play.level, cleared, history, today());
      if (status === LOCKED_STATUS) {
        return locked("Clear level " + (play.number - 1) + " first.");
      }
      return status === RESTING_STATUS
        ? { title: RESTING_TITLE, body: OPENS_TOMORROW, icon: "moon" }
        : null;
    }
    if (play.kind === CHECKBACK) {
      return checkbackBlocked(play, history, cleared);
    }
    if (play.kind === CROWN) {
      const crown = app.path.crownState(play.unit, cleared);
      return crown && crown.open ? null : locked(CLEAR_BEFORE_FIRST);
    }
    if (play.kind === CHECKPOINT) {
      const checkpoint = app.path.checkpointState(play.unit, cleared);
      return checkpoint && checkpoint.open ? null : locked(CLEAR_BEFORE_FIRST);
    }
    return null;
  }

  // A check-back starts only on the day app.path.checkbacks says it is due, as the Path offers
  // it (spec sections 5 and 9): never before its level is cleared, never once the level is
  // locked in gold, and before its day the screen says which day that is, as the Path does.
  function checkbackBlocked(play, history, cleared) {
    if (app.path.statusOf(play.level, cleared) !== CLEARED_STATUS) {
      return { title: LOCKED_TITLE, body: "Clear level " + play.number + " first.", icon: "lock" };
    }
    if (app.path.ringOf(play.level, cleared) === GOLD_RING) {
      return { title: LOCKED_IN_TITLE, body: NOTHING_LEFT_TO_CHECK, icon: "check" };
    }
    const next = app.path
      .checkbacks(cleared, history, today())
      .find((entry) => entry.levelId === play.level);
    if (next && !next.due) {
      const day = app.loop.dateText(next.dueOn, "long");
      return {
        title: NOT_DUE_TITLE,
        body: "Check-back " + next.stage + " is due " + day + ".",
        icon: "calendar",
      };
    }
    return null;
  }

  function renderState(title, text, icon) {
    app.ui.renderState(body, {
      kind: "empty",
      icon,
      title,
      body: text,
      actionLabel: BACK_TO_PATH,
      onAction: () => app.router.go(PATH_ROUTE),
    });
  }

  // --- Drawing ---------------------------------------------------------------------------------

  // The subtitle, the stepper and the run's step. A step new since the last draw starts at the
  // top, takes keyboard focus on its heading and is announced.
  function render() {
    if (body === null || run === null) {
      return;
    }
    stopPrep();
    stopPlayback(run.audio);
    prepView = null;
    const key = [run.view, run.phase, run.takeIndex, run.last].join(":");
    const moved = run.drawn !== null && run.drawn !== key;
    run.drawn = key;
    const steps = stepsShown(run);
    const current = currentStep(run, steps);
    const step = buildStep(run);
    app.ui.clear(body);
    body.appendChild(el("p", { class: "level__subtitle", text: run.play.subtitle }));
    body.appendChild(buildStepper(steps, current));
    body.appendChild(step.node);
    if (moved) {
      scrollToTop();
      focusIfPossible(step.heading, true);
      app.ui.announce(announcementFor(steps, current, step.heading));
    }
  }

  // "Step 3 of 5: Review. Take 1".
  function announcementFor(steps, current, title) {
    const label = steps[current].label;
    const words = title ? String(title.textContent || "") : "";
    const named = words !== "" && words !== label ? ". " + words : "";
    return "Step " + (current + 1) + " of " + steps.length + ": " + label + named;
  }

  function buildStep(target) {
    if (target.view === REVIEW_VIEW) {
      return target.phase === MOMENTS_PHASE ? buildReview(target) : buildFeedback(target);
    }
    if (target.view === TAKE_VIEW) {
      return buildTakeStep(target);
    }
    if (target.view === RESULT_VIEW) {
      return buildResult(target);
    }
    return buildGoal(target);
  }

  // The play's steps (app.loop.stepsFor). On a retry the last take step reads the retry's
  // label ("Take 3"), since the list stops at the scored take.
  function stepsShown(target) {
    const steps = app.loop.stepsFor(target.playId).map((step) => ({
      step: step.step,
      label: step.label,
      takeIndex: step.takeIndex,
    }));
    const shown = target.view === TAKE_VIEW ? target.takeIndex : target.last;
    const retry = target.view === TAKE_VIEW || target.view === RESULT_VIEW ? shown : null;
    if (retry !== null && retry >= target.play.takes.length) {
      steps[lastTakeStep(steps)].label = takeOf(target, retry).label;
    }
    return steps;
  }

  function lastTakeStep(steps) {
    let found = -1;
    steps.forEach((step, index) => {
      if (step.step === TAKE_STEP) {
        found = index;
      }
    });
    return found;
  }

  function currentStep(target, steps) {
    if (target.view === REVIEW_VIEW) {
      return steps.findIndex((step) => step.step === REVIEW_STEP);
    }
    if (target.view === TAKE_VIEW) {
      const listed = steps.findIndex(
        (step) => step.step === TAKE_STEP && step.takeIndex === target.takeIndex,
      );
      return listed !== -1 ? listed : lastTakeStep(steps);
    }
    if (target.view === RESULT_VIEW) {
      return steps.length - 1;
    }
    return 0;
  }

  // An ordered list: done steps carry a check, the current one aria-current="step", the rest
  // their number.
  function buildStepper(steps, current) {
    return el(
      "ol",
      { class: "level-steps", "aria-label": STEPS_LABEL },
      steps.map((step, index) => {
        let state = "upcoming";
        if (index < current) {
          state = "done";
        } else if (index === current) {
          state = "current";
        }
        const attrs = { class: "level-steps__item level-steps__item--" + state };
        if (state === "current") {
          attrs["aria-current"] = "step";
        }
        const done = state === "done";
        return el("li", attrs, [
          el(
            "span",
            { class: "level-steps__mark", "aria-hidden": "true" },
            done ? iconOf("check", 16) : String(index + 1),
          ),
          el("span", { class: "level-steps__label", text: step.label }),
          done ? el("span", { class: "sr-only", text: DONE_NOTE }) : null,
        ]);
      }),
    );
  }

  // A step's heading, which takes focus when the step is new.
  function stepHeading(text, className) {
    return el("h2", {
      class: (className ? className + " " : "") + "level-heading",
      tabindex: "-1",
      text,
    });
  }

  function stepNode(parts) {
    return el("div", { class: "level-step" }, parts);
  }

  function actionsOf(controls) {
    return el("div", { class: "level-actions" }, controls);
  }

  function primaryButton(label, onClick) {
    return el("button", {
      type: "button",
      class: "btn btn--primary btn--block",
      text: label,
      onClick,
    });
  }

  function linkButton(label, href, primary) {
    const variant = primary ? "btn--primary" : "btn--secondary";
    return el("a", { class: "btn " + variant + " btn--block", href, text: label });
  }

  // --- Goal ------------------------------------------------------------------------------------

  // The target card with the unit's why line, Fillers level 1's top fillers, the long-pause
  // prep, a checkpoint's switch, then the button that starts take 1.
  function buildGoal(target) {
    const play = target.play;
    const title = stepHeading(app.loop.stepsFor(play.id)[0].label);
    const parts = [title, targetCard(play, true)];
    if (play.listsTopFillers) {
      parts.push(topFillersCard(target.topFillers));
    }
    if (play.prepSeconds > 0) {
      parts.push(prepCard(play));
    }
    if (play.inRoomSwitch) {
      parts.push(inRoomSwitch(target));
    }
    const start = primaryButton(goalAction(play), () => startTake(target, 0));
    if (prepView !== null) {
      prepView.next = start;
    }
    parts.push(actionsOf([start]));
    return { node: stepNode(parts), heading: title };
  }

  function goalAction(play) {
    if (play.kind === BENCHMARK) {
      return START_BENCHMARK;
    }
    const first = play.takes[0];
    if (play.takes.length === 1) {
      return first.read ? READ_IT : RECORD;
    }
    return "Record " + first.label.toLowerCase();
  }

  // The headline target, large, with its unit label, the length, the example and non-example,
  // and on the Goal the unit's why line with its source.
  function targetCard(play, withWhy) {
    const goal = play.goal;
    const parts = [
      el("p", { class: "level-target__goal" }, [
        el("span", { class: "level-target__headline", text: goal.headline }),
        el("span", { class: "sr-only", text: headlineJoiner(goal.headline) }),
        el("span", { class: "level-target__unit", text: goal.unitLabel }),
      ]),
      el("p", { class: "level-target__length", text: goal.length }),
    ];
    if (play.example) {
      parts.push(examplesList(play.example));
    }
    if (withWhy && play.why) {
      parts.push(
        el("div", { class: "level-why" }, [
          el("p", { class: "level-why__text", text: play.why.text }),
          sourceLine(play.why),
        ]),
      );
    }
    return el("div", { class: "level-card level-target" }, parts);
  }

  function examplesList(example) {
    return el("ul", { class: "level-examples", role: "list" }, [
      exampleLine(true, example.good),
      exampleLine(false, example.bad),
    ]);
  }

  // A ✓ or ✗ line, its slip marked as the transcript marks one.
  function exampleLine(good, parts) {
    return el("li", { class: "level-example level-example--" + (good ? "good" : "bad") }, [
      iconOf(good ? "check" : "close", 16, "level-example__icon"),
      el("span", { class: "level-example__text" }, [
        el("span", { class: "sr-only", text: good ? LIKE_THIS : NOT_LIKE_THIS }),
        ...parts.map((part) => {
          const mark = part.mark ? EXAMPLE_MARKS[part.mark] : null;
          return mark ? el("span", { class: mark, text: part.text }) : part.text;
        }),
      ]),
    ]);
  }

  // "Source: <citation>", the citation a link that opens in a new tab with rel="noopener", so
  // the page it opens gets no handle on this one.
  function sourceLine(cited) {
    return el("p", { class: "level-source" }, [
      iconOf("external-link", 14, "level-source__icon"),
      SOURCE_LABEL + " ",
      el(
        "a",
        {
          class: "level-source__link",
          href: cited.url,
          target: "_blank",
          rel: "noopener",
          text: cited.label,
        },
        [el("span", { class: "sr-only", text: NEW_TAB_NOTE })],
      ),
    ]);
  }

  function topFillersCard(fillers) {
    const parts = [el("h3", { class: "level-card__title", text: TOP_FILLERS_TITLE })];
    if (fillers.length === 0) {
      parts.push(el("p", { class: "level-fillers__none", text: NO_FILLERS_YET }));
    } else {
      parts.push(
        el(
          "ul",
          { class: "level-fillers__list", role: "list" },
          fillers.map((filler) =>
            el("li", { class: "level-fillers__item" }, [
              el("span", { class: "tok--filler", text: filler.text }),
              " " + countOf(filler.count, "time"),
            ]),
          ),
        ),
      );
    }
    return el("div", { class: "level-card level-fillers" }, parts);
  }

  // "Plan for 30 s: jot 3 points." and a Start planning button that counts it down.
  function prepCard(play) {
    const controls = el("div", { class: "level-prep__controls" });
    prepView = { controls, clock: null, seconds: play.prepSeconds, next: null };
    drawPrepIdle();
    return el("div", { class: "level-card level-prep" }, [
      el("p", { class: "level-prep__text", text: play.prepText }),
      controls,
    ]);
  }

  function drawPrepIdle() {
    prepView.clock = null;
    fill(prepView.controls, [
      el("button", {
        type: "button",
        class: "btn btn--secondary level-prep__start",
        text: START_PLANNING,
        onClick: startPrep,
      }),
    ]);
  }

  // The countdown runs a second at a time, with Skip beside it; it is announced at its start
  // and at its end.
  function startPrep() {
    if (prepView === null) {
      return;
    }
    stopPrep();
    const view = prepView;
    const clock = el("span", {
      class: "level-prep__clock",
      text: app.ui.formatClock(view.seconds),
    });
    const skip = el("button", {
      type: "button",
      class: "btn btn--ghost level-prep__skip",
      text: SKIP_LABEL,
      onClick: () => endPrep(PLANNING_SKIPPED),
    });
    fill(view.controls, [clock, skip]);
    view.clock = clock;
    prepTimer = { remaining: view.seconds, id: setInterval(tickPrep, PREP_TICK_MS) };
    app.ui.announce("Planning for " + view.seconds + " seconds.");
    focusIfPossible(skip, true);
  }

  function tickPrep() {
    if (prepTimer === null || prepView === null) {
      return;
    }
    prepTimer.remaining -= 1;
    if (prepView.clock) {
      prepView.clock.textContent = app.ui.formatClock(Math.max(0, prepTimer.remaining));
    }
    if (prepTimer.remaining <= 0) {
      endPrep(PLANNING_DONE);
    }
  }

  // The countdown ends, by itself or by Skip. Focus on Skip, which goes, moves on to the take.
  function endPrep(announcement) {
    if (prepView === null) {
      return;
    }
    const view = prepView;
    const focused = holdsFocus(view.controls);
    stopPrep();
    drawPrepIdle();
    app.ui.announce(announcement);
    if (focused) {
      focusIfPossible(view.next, false);
    }
  }

  function stopPrep() {
    if (prepTimer !== null) {
      clearInterval(prepTimer.id);
      prepTimer = null;
    }
  }

  // "Someone is listening (in the room)": a switch the checkpoint's records read.
  function inRoomSwitch(target) {
    const toggle = el(
      "button",
      {
        type: "button",
        class: "level-switch",
        role: "switch",
        "aria-checked": String(target.inRoom),
      },
      [
        el("span", { class: "level-switch__track", "aria-hidden": "true" }, [
          el("span", { class: "level-switch__thumb" }),
        ]),
        el("span", { class: "level-switch__label", text: IN_THE_ROOM_SWITCH }),
      ],
    );
    toggle.addEventListener("click", () => {
      target.inRoom = !target.inRoom;
      toggle.setAttribute("aria-checked", String(target.inRoom));
    });
    return toggle;
  }

  // --- Feedback (the Review step, after take 1) ------------------------------------------------

  // The target, take 1's card (its number against the target, the change line, the live catch
  // and the moments to look at), the level's tip, then the review or take 2.
  function buildFeedback(target) {
    const play = target.play;
    const feedback = target.feedback;
    const evaluation = target.takes[0].evaluation;
    const title = stepHeading(takeOf(target, 0).label, "level-take__title");
    const card = [title, valueLine(feedback)];
    if (feedback.change) {
      card.push(changeLine(feedback.change));
    }
    if (feedback.value === null && evaluation.sentence) {
      card.push(el("p", { class: "level-take__note", text: evaluation.sentence }));
    }
    if (feedback.caught) {
      card.push(el("p", { class: "level-take__caught", text: feedback.caught.text }));
    }
    if (target.moments.length > 0) {
      card.push(
        el("h3", { class: "level-card__title", text: momentsTitle(target.moments.length) }),
        momentsList(target.moments),
      );
    }
    const parts = [targetCard(play, false), el("div", { class: "level-card level-take" }, card)];
    if (play.tip) {
      parts.push(tipCard(play.tip));
    }
    const count = target.moments.length;
    const next =
      count > 0
        ? primaryButton(
            "Review " + countOf(count, "moment") + " (" + count * SECONDS_PER_MOMENT + " s)",
            () => showMoments(target),
          )
        : primaryButton("Go to " + takeOf(target, 1).label.toLowerCase(), () =>
            startTake(target, 1),
          );
    parts.push(actionsOf([next]));
    return { node: stepNode(parts), heading: title };
  }

  function showMoments(target) {
    target.phase = MOMENTS_PHASE;
    render();
  }

  // "6.8 fillers a minute target 6": the big number, its words and the target.
  function valueLine(feedback) {
    const parts = [el("span", { class: "level-take__value", text: feedback.valueText })];
    if (feedback.unitLabel) {
      parts.push(" ", el("span", { class: "level-take__unit", text: feedback.unitLabel }));
    }
    if (feedback.targetText) {
      parts.push(" ", el("span", { class: "level-take__target", text: feedback.targetText }));
    }
    return el("p", { class: "level-take__result" }, parts);
  }

  // "1.4 fewer than Tuesday": --ok when better, muted when worse or the same.
  function changeLine(change) {
    return el("p", { class: "level-change level-change--" + change.direction }, [
      iconOf(TREND_ICONS[change.trend] || TREND_ICONS.flat, 12, "level-change__icon"),
      change.text,
    ]);
  }

  // "Three moments to look at"; app.loop gives three at most.
  function momentsTitle(count) {
    const words = MOMENT_COUNT_WORDS[count - 1] || String(count);
    return words + (count === 1 ? " moment" : " moments") + " to look at";
  }

  function momentsList(moments) {
    return el(
      "ul",
      { class: "level-moments", role: "list" },
      moments.map((moment) =>
        el("li", { class: "level-moments__item" }, [
          el("span", { class: "level-moments__time", text: moment.time }),
          el("span", { class: "level-moments__words" }, momentWords(moment)),
        ]),
      ),
    );
  }

  // A moment's words, its slip marked: "so the, um, the plan costs".
  function momentWords(moment) {
    const mark = MOMENT_MARKS[moment.kind] || MOMENT_MARKS.filler;
    return moment.parts.map((part) => {
      if (!part.marked) {
        return part.text;
      }
      const children = [part.text, el("span", { class: "sr-only", text: mark.note })];
      if (moment.kind === "pace") {
        children.push(iconOf("alert", 12, "level-moment__alert"));
      }
      return el("span", { class: mark.className }, children);
    });
  }

  function tipCard(tip) {
    return el("div", { class: "tip-card level-tip" }, [
      el("p", { class: "level-tip__text" }, [
        iconOf("lightbulb", 18, "level-tip__icon"),
        el("span", { text: tip.text }),
      ]),
      sourceLine(tip),
    ]);
  }

  // --- Review ----------------------------------------------------------------------------------

  // "Look at 3 moments": Spot it first on Fillers level 2, a card per moment with Play 3 s and
  // What happened?, the fix for the next take, the privacy line, then the next take. Without
  // take 1's audio the Play buttons give way to one line saying it is gone.
  function buildReview(target) {
    const play = target.play;
    const count = target.moments.length;
    const title = stepHeading("Look at " + countOf(count, "moment"));
    const parts = [
      el("div", { class: "level-review__header" }, [
        title,
        el("span", {
          class: "level-review__about",
          text: "about " + count * SECONDS_PER_MOMENT + " s",
        }),
      ]),
    ];
    const report = target.takes[0].report;
    if (target.audio === null) {
      parts.push(el("p", { class: "level-review__gone", text: AUDIO_GONE }));
    } else if (play.spotIt && app.loop.fillerTimes(report).length > 0) {
      parts.push(spotItCard(target, report));
    }
    target.moments.forEach((moment, index) => parts.push(momentCard(target, moment, index)));
    const next = takeOf(target, 1);
    parts.push(
      el("h2", {
        class: "level-review__fix-title",
        id: FIX_TITLE_ID,
        text: "Your fix for " + next.label.toLowerCase(),
      }),
      choiceChips(play.fixes, target.fix, (choice) => {
        target.fix = choice;
      }, { "aria-labelledby": FIX_TITLE_ID }),
      el("p", { class: "level-privacy" }, [
        iconOf("lock", 14, "level-privacy__icon"),
        el("span", { text: PRIVACY }),
      ]),
      actionsOf([
        primaryButton(next.read ? READ_IT_AGAIN : SAY_IT_AGAIN, () => startTake(target, 1)),
      ]),
    );
    return { node: stepNode(parts), heading: title };
  }

  function momentCard(target, moment, index) {
    const parts = [
      el("p", { class: "level-moment__time", text: moment.time }),
      el("p", { class: "level-moment__words" }, momentWords(moment)),
    ];
    if (target.audio !== null) {
      parts.push(clipButton(target, moment));
    }
    parts.push(
      el("p", { class: "level-moment__ask", "aria-hidden": "true", text: WHAT_HAPPENED_ASK }),
      choiceChips(app.loop.WHAT_HAPPENED, target.choices[index] || null, (choice) => {
        target.choices[index] = choice;
      }, { "aria-label": "What happened at " + moment.time + "?" }),
    );
    return el("div", { class: "level-card level-moment" }, parts);
  }

  // Single-choice chips (aria-pressed) in a labelled group. A second tap on the chosen chip
  // clears it, since every choice is optional.
  function choiceChips(options, selected, onChoose, label) {
    let chosen = selected;
    const chips = Array.from(options, (option) => ({
      option,
      chip: el("button", { type: "button", class: "chip", text: option }),
    }));
    const paint = () => {
      chips.forEach(({ option, chip }) => {
        chip.setAttribute("aria-pressed", String(option === chosen));
        chip.classList.toggle("chip--selected", option === chosen);
      });
    };
    chips.forEach(({ option, chip }) => {
      chip.addEventListener("click", () => {
        chosen = chosen === option ? null : option;
        onChoose(chosen);
        paint();
      });
    });
    paint();
    return el(
      "div",
      Object.assign({ class: "level-chips", role: "group" }, label),
      chips.map((each) => each.chip),
    );
  }

  // --- Playback (spec section 8) ---------------------------------------------------------------

  // "Play 3 s": take 1 from 1 s before the moment, for 3 s (app.loop.clipFor). It reads Stop
  // while it plays.
  function clipButton(target, moment) {
    const control = {
      button: el("button", { type: "button", class: "btn btn--secondary level-play" }),
      idleLabel: PLAY_CLIP,
    };
    paintPlay(control, false);
    const clip = app.loop.clipFor(moment);
    control.button.addEventListener("click", () => {
      togglePlayback(target, control, (audio) => playClip(audio, control, clip));
    });
    return control.button;
  }

  // Spot it: "Play take 1" plays the whole take while a big "Heard one" button takes taps; at
  // the end the taps are matched to take 1's fillers (app.loop.matchTaps).
  function spotItCard(target, report) {
    const spot = {
      control: {
        button: el("button", { type: "button", class: "btn btn--secondary level-play" }),
        idleLabel: PLAY_TAKE_1,
      },
      tap: el("button", {
        type: "button",
        class: "btn btn--secondary btn--block level-spot__tap",
        text: HEARD_ONE,
      }),
      score: el("p", { class: "level-spot__score" }),
      report,
      taps: [],
      position: null,
    };
    spot.tap.disabled = true;
    paintPlay(spot.control, false);
    spot.control.button.addEventListener("click", () => {
      togglePlayback(target, spot.control, (audio) => playWhole(audio, spot));
    });
    spot.tap.addEventListener("click", () => {
      if (spot.position !== null) {
        spot.taps.push(Math.round(spot.position() * 10) / 10);
      }
    });
    return el("div", { class: "level-card level-spot" }, [
      el("h3", { class: "level-card__title", text: SPOT_IT_TITLE }),
      el("p", { class: "level-spot__how", text: SPOT_IT_HOW }),
      spot.control.button,
      spot.tap,
      spot.score,
    ]);
  }

  // A tap on a Play button: on the one playing it stops; otherwise whatever plays stops and,
  // once take 1 is ready, `play` starts, if the review is still on screen. Only the latest tap
  // plays, and any stop in between (stopPlayback) cancels it, so a tap still waiting on the
  // decode when the speaker moves on never plays on its own.
  function togglePlayback(target, control, play) {
    const audio = target.audio;
    if (!audio) {
      return;
    }
    const tappedStop = audio.playing !== null && audio.playing.control === control;
    stopPlayback(audio);
    if (tappedStop) {
      return;
    }
    const token = audio.token;
    prepareAudio(audio).then((ready) => {
      if (ready && !audio.released && audio.token === token && reviewShows(target)) {
        play(audio);
      }
    });
  }

  // Whether the run's review, the only step with Play buttons, is the screen on show.
  function reviewShows(target) {
    return (
      visible &&
      run === target &&
      shownPlayId === target.playId &&
      target.view === REVIEW_VIEW &&
      target.phase === MOMENTS_PHASE
    );
  }

  // Take 1's recording, kept for the review until the run ends or reaches its Result.
  function keepAudio(target, saved) {
    releaseAudio(target);
    if (!saved.blob) {
      return;
    }
    target.audio = {
      blob: saved.blob,
      context: null,
      buffer: null,
      url: null,
      element: null,
      decoding: null,
      playing: null,
      token: 0,
      released: false,
    };
  }

  // Decodes take 1 once, on the first Play tap: the AudioContext is made inside the tap (a user
  // gesture), then decodeAudioData reads the recording. When that fails, an <audio> element on
  // an object URL of the recording plays it instead. Resolves true when one of them is ready.
  function prepareAudio(audio) {
    if (audio.buffer || audio.element) {
      return Promise.resolve(true);
    }
    if (audio.decoding === null) {
      audio.decoding = decodeAudio(audio);
    }
    return audio.decoding;
  }

  function decodeAudio(audio) {
    const Context = audioContextClass();
    try {
      audio.context = Context ? new Context() : null;
    } catch {
      audio.context = null;
    }
    const context = audio.context;
    if (context && context.state === "suspended" && typeof context.resume === "function") {
      quietly(context.resume());
    }
    return bytesOf(audio.blob)
      .then((bytes) => decodeWith(context, bytes))
      .then((buffer) => {
        if (audio.released) {
          return false;
        }
        audio.buffer = buffer;
        return true;
      })
      .catch(() => {
        if (audio.released) {
          return false;
        }
        closeContext(audio);
        return fallBackToElement(audio);
      })
      .catch(() => false);
  }

  function audioContextClass() {
    if (typeof AudioContext !== "undefined") {
      return AudioContext;
    }
    return typeof webkitAudioContext !== "undefined" ? webkitAudioContext : null;
  }

  function bytesOf(blob) {
    if (blob && typeof blob.arrayBuffer === "function") {
      return blob.arrayBuffer();
    }
    return Promise.reject(new Error("The recording cannot be read"));
  }

  // decodeAudioData answers by promise in current browsers and by callbacks in older Safari.
  function decodeWith(context, bytes) {
    if (!context) {
      return Promise.reject(new Error("This browser has no AudioContext"));
    }
    return new Promise((resolve, reject) => {
      const pending = context.decodeAudioData(bytes, resolve, reject);
      if (pending && typeof pending.then === "function") {
        pending.then(resolve, reject);
      }
    });
  }

  function fallBackToElement(audio) {
    if (!audio.blob || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      return false;
    }
    audio.url = URL.createObjectURL(audio.blob);
    const element = document.createElement("audio");
    element.preload = "auto";
    element.src = audio.url;
    audio.element = element;
    return true;
  }

  // A clip through an AudioBufferSourceNode, start(0, offset, 3); or on the <audio> element,
  // from its offset, paused again after its duration.
  function playClip(audio, control, clip) {
    if (audio.buffer && audio.context) {
      const source = sourceOf(audio);
      const playing = { control, stop: () => stopSource(source) };
      source.onended = () => finished(audio, playing);
      audio.playing = playing;
      source.start(0, clip.offset, clip.duration);
    } else if (audio.element) {
      const element = audio.element;
      const playing = {
        control,
        timer: null,
        stop: () => element.pause(),
      };
      element.currentTime = clip.offset;
      element.onended = () => finished(audio, playing);
      audio.playing = playing;
      playing.timer = setTimeout(() => {
        element.pause();
        finished(audio, playing);
      }, clip.duration * MS_PER_SECOND);
      playMedia(element, () => stopPlayback(audio));
    } else {
      return;
    }
    paintPlay(control, true);
  }

  // The whole of take 1, for Spot it. "Heard one" is live only while it plays.
  function playWhole(audio, spot) {
    let playing = null;
    if (audio.buffer && audio.context) {
      const context = audio.context;
      const source = sourceOf(audio);
      const startedAt = context.currentTime;
      spot.position = () => context.currentTime - startedAt;
      playing = { control: spot.control, stop: () => stopSource(source) };
      source.onended = () => finished(audio, playing);
      audio.playing = playing;
      source.start(0, 0);
    } else if (audio.element) {
      const element = audio.element;
      spot.position = () => element.currentTime;
      playing = { control: spot.control, timer: null, stop: () => element.pause() };
      element.currentTime = 0;
      element.onended = () => finished(audio, playing);
      audio.playing = playing;
      playMedia(element, () => stopPlayback(audio));
    } else {
      return;
    }
    spot.taps = [];
    spot.score.textContent = "";
    spot.tap.disabled = false;
    playing.onEnd = () => scoreSpotIt(spot);
    playing.onStop = () => {
      spot.taps = [];
      spot.position = null;
      spot.tap.disabled = true;
    };
    paintPlay(spot.control, true);
  }

  function scoreSpotIt(spot) {
    spot.position = null;
    spot.tap.disabled = true;
    const caught = app.loop.matchTaps(
      spot.taps,
      app.loop.fillerTimes(spot.report),
      app.loop.SPOT_IT_WINDOW,
    );
    spot.score.textContent = caught.text;
    app.ui.announce(caught.text);
  }

  function sourceOf(audio) {
    const source = audio.context.createBufferSource();
    source.buffer = audio.buffer;
    source.connect(audio.context.destination);
    return source;
  }

  function stopSource(source) {
    try {
      source.stop();
    } catch {
      // A source that already ended has nothing to stop.
    }
  }

  function playMedia(element, onRefused) {
    const pending = element.play();
    if (pending && typeof pending.catch === "function") {
      pending.catch(onRefused);
    }
  }

  // Playback reached its end by itself.
  function finished(audio, playing) {
    if (audio.playing !== playing) {
      return;
    }
    audio.playing = null;
    if (playing.timer) {
      clearTimeout(playing.timer);
    }
    paintPlay(playing.control, false);
    if (playing.onEnd) {
      playing.onEnd();
    }
  }

  // Stops what plays, and cancels a Play tap still waiting on take 1's decode: leaving the
  // screen, drawing it again, the next take and the release all come through here. What plays
  // is let go first, so the end the stop fires finds nothing to finish.
  function stopPlayback(audio) {
    if (!audio) {
      return;
    }
    audio.token += 1;
    if (!audio.playing) {
      return;
    }
    const playing = audio.playing;
    audio.playing = null;
    if (playing.timer) {
      clearTimeout(playing.timer);
    }
    playing.stop();
    paintPlay(playing.control, false);
    if (playing.onStop) {
      playing.onStop();
    }
  }

  // "Play 3 s" with the play icon, or "Stop" with the stop icon while it plays.
  function paintPlay(control, playing) {
    fill(control.button, [
      iconOf(playing ? "stop" : "play", 16),
      playing ? STOP_LABEL : control.idleLabel,
    ]);
  }

  // Releases take 1's audio: stops playback, closes the AudioContext, drops the decoded
  // buffer, revokes the object URL and drops the recording itself.
  function releaseAudio(target) {
    const audio = target.audio;
    target.audio = null;
    if (!audio) {
      return;
    }
    stopPlayback(audio);
    audio.released = true;
    closeContext(audio);
    audio.buffer = null;
    if (audio.element) {
      audio.element.onended = null;
      audio.element.pause();
      audio.element.removeAttribute("src");
      if (typeof audio.element.load === "function") {
        audio.element.load();
      }
      audio.element = null;
    }
    if (audio.url) {
      URL.revokeObjectURL(audio.url);
      audio.url = null;
    }
    audio.blob = null;
    audio.decoding = null;
  }

  function closeContext(audio) {
    const context = audio.context;
    audio.context = null;
    if (context && typeof context.close === "function") {
      try {
        quietly(context.close());
      } catch {
        // A context that is already closed has nothing left to release.
      }
    }
  }

  // A promise whose failure changes nothing here.
  function quietly(pending) {
    if (pending && typeof pending.catch === "function") {
      pending.catch(() => {});
    }
  }

  // --- A take step (between two takes) ---------------------------------------------------------

  // Restarts' read 3 after read 2, Pace level 2's second read of a retried pair, the
  // benchmark's talk: the take before it in a line, then the button for this one.
  function buildTakeStep(target) {
    const index = target.takeIndex;
    const take = takeOf(target, index);
    const title = stepHeading(take.label);
    const before = target.takes[index - 1];
    const parts = [
      title,
      el("div", { class: "level-card level-summary" }, [
        el("p", { class: "level-summary__label", text: takeOf(target, index - 1).label }),
        el("p", { class: "level-summary__sentence", text: before.evaluation.sentence }),
      ]),
    ];
    if (target.fix) {
      parts.push(el("p", { class: "level-summary__fix", text: "Your fix: " + target.fix + "." }));
    }
    let label = take.read ? READ_IT_AGAIN : SAY_IT_AGAIN;
    if (target.play.kind === BENCHMARK) {
      label = RECORD_THE_TALK;
    }
    parts.push(actionsOf([primaryButton(label, () => startTake(target, index))]));
    return { node: stepNode(parts), heading: title };
  }

  // --- Result ----------------------------------------------------------------------------------

  function buildResult(target) {
    const kind = target.play.kind;
    if (kind === BENCHMARK) {
      return buildDone(target);
    }
    const evaluation = target.takes[target.last].evaluation;
    if (kind === LOOP) {
      return evaluation.passed === true
        ? loopPassed(target, evaluation)
        : loopMissed(target, evaluation);
    }
    if (kind === CHECKBACK) {
      return checkbackResult(target, evaluation);
    }
    return crownOrCheckpointResult(target, evaluation);
  }

  // Level cleared: the verdict and guards, any jump, the check-back dates and what is next.
  function loopPassed(target, evaluation) {
    const title = resultTitle(LEVEL_CLEARED);
    const parts = [passCard(title, evaluation, [])];
    if (evaluation.jumped.length > 0) {
      const numbers = evaluation.jumped.map((id) => app.path.levelById(id).number);
      const levels = (numbers.length === 1 ? "level " : "levels ") + joinAnd(numbers);
      parts.push(el("p", { class: "level-jump", text: "Your take also cleared " + levels + "." }));
    }
    if (target.saveFailed) {
      parts.push(saveFailedLine());
    }
    const checkBack = checkBackCard(target, target.play.level);
    if (checkBack !== null) {
      parts.push(checkBack);
    }
    parts.push(...nextParts(target));
    return { node: stepNode(parts), heading: title };
  }

  // Not yet: the verdict, the failed guards and the one fix, then Try take 3 or 4 while today's
  // attempts last (app.path.attemptsLeft), else the level rests until tomorrow.
  function loopMissed(target, evaluation) {
    const title = resultTitle(NOT_YET);
    const parts = [missCard(title, evaluation, null, true)];
    const left = app.path.attemptsLeft(target.play.level, historyNow(target), today());
    if (left > 0) {
      const retry = takeOf(target, target.last + 1);
      parts.push(
        actionsOf([
          primaryButton("Try " + retry.label.toLowerCase(), () =>
            startTake(target, target.last + 1),
          ),
          linkButton(BACK_TO_PATH, PATH_HREF, false),
        ]),
      );
    } else {
      parts.push(el("p", { class: "level-rest", text: OPENS_TOMORROW }));
      parts.push(actionsOf([linkButton(BACK_TO_PATH, PATH_HREF, true)]));
    }
    return { node: stepNode(parts), heading: title };
  }

  function checkbackResult(target, evaluation) {
    const title = resultTitle("Check-back " + evaluation.stage);
    let card;
    if (evaluation.passed === true) {
      const verdict = evaluation.stage === 2 ? CHECKBACK_GOLD : CHECKBACK_HALF;
      card = passCard(title, evaluation, [], verdict);
    } else {
      const due = app.path
        .checkbacks(target.cleared, historyNow(target), today())
        .find((entry) => entry.levelId === target.play.level);
      const when = due ? app.loop.dateText(due.dueOn, "long") : "";
      card = missCard(title, evaluation, "Missed. It comes back on " + when + ". Nothing locks.");
    }
    const parts = [card];
    if (target.saveFailed) {
      parts.push(saveFailedLine());
    }
    parts.push(actionsOf([linkButton(BACK_TO_PATH, PATH_HREF, true)]));
    return { node: stepNode(parts), heading: title };
  }

  // A crown's or a checkpoint's verdict line, and its record; a checkpoint cleared with someone
  // listening says so.
  function crownOrCheckpointResult(target, evaluation) {
    const crown = target.play.kind === CROWN;
    const passed = evaluation.passed === true;
    let words = NOT_YET;
    if (passed) {
      words = crown ? CROWN_EARNED : CHECKPOINT_CLEARED;
    }
    const title = resultTitle(words);
    let card;
    if (passed) {
      const room = !crown && target.inRoom
        ? [el("p", { class: "level-result__room", text: CLEARED_IN_THE_ROOM })]
        : [];
      card = passCard(title, evaluation, room);
    } else {
      card = missCard(title, evaluation, null, !crown);
    }
    const parts = [card];
    if (passed && target.saveFailed) {
      parts.push(saveFailedLine());
    }
    parts.push(actionsOf([linkButton(BACK_TO_PATH, PATH_HREF, true)]));
    return { node: stepNode(parts), heading: title };
  }

  function resultTitle(text) {
    return stepHeading(text, "level-result__title");
  }

  // The green card: a check badge, the title, an optional verdict line, the sentence and every
  // guard line.
  function passCard(title, evaluation, extra, verdict) {
    return el("div", { class: "level-result level-result--pass" }, [
      el("span", { class: "level-result__badge", "aria-hidden": "true" }, [iconOf("check", 36)]),
      title,
      verdict ? el("p", { class: "level-result__verdict", text: verdict }) : null,
      el("p", { class: "level-result__sentence", text: evaluation.sentence }),
      guardList(evaluation.guards),
      ...extra,
    ]);
  }

  // A miss: the title, an optional verdict line, the value against the target, the guards that
  // failed (one that only repeats the sentence left out) and, when asked, the one fix.
  function missCard(title, evaluation, verdict, withFix) {
    const failed = evaluation.guards.filter(
      (guard) => !guard.passed && guard.text !== evaluation.sentence,
    );
    return el("div", { class: "level-card level-result level-result--miss" }, [
      title,
      verdict ? el("p", { class: "level-result__verdict", text: verdict }) : null,
      el("p", { class: "level-result__sentence", text: evaluation.sentence }),
      guardList(failed),
      withFix && evaluation.fix
        ? el("p", { class: "level-result__fix", text: "The one fix: " + evaluation.fix + "." })
        : null,
    ]);
  }

  function guardList(guards) {
    if (guards.length === 0) {
      return null;
    }
    return el(
      "ul",
      { class: "level-guards", role: "list" },
      guards.map((guard) =>
        el(
          "li",
          {
            class:
              "level-guards__item level-guards__item--" + (guard.passed ? "passed" : "failed"),
          },
          [
            iconOf(guard.passed ? "check" : "alert", 16, "level-guards__icon"),
            el("span", { text: guard.text }),
          ],
        ),
      ),
    );
  }

  function saveFailedLine() {
    return el("p", { class: "level-save-failed" }, [
      iconOf("alert", 16, "level-save-failed__icon"),
      el("span", { text: SAVE_FAILED }),
    ]);
  }

  // "Check back": when the level's check-backs fall (app.path.checkbacks), check-back 2's date
  // as it falls once check-back 1 passes on its own day.
  function checkBackCard(target, levelId) {
    const cleared = clearedAfter(target);
    const history = historyNow(target);
    const day = today();
    const forLevel = (entries) => entries.find((entry) => entry.levelId === levelId);
    const next = forLevel(app.path.checkbacks(cleared, history, day));
    if (!next) {
      return null;
    }
    const rows = [checkBackRow(next.dueOn, next.stage)];
    if (next.stage === 1) {
      const passed = { levelId: levelId + FIRST_CHECKBACK_RECORD, clearedAt: next.dueOn };
      const second = forLevel(app.path.checkbacks(cleared.concat([passed]), history, day));
      if (second) {
        rows.push(checkBackRow(second.dueOn, second.stage));
      }
    }
    const reads = app.path.playById(levelId + CHECKBACK_SUFFIX).takes[0].read;
    return el("div", { class: "level-card level-checkback" }, [
      el("h2", { class: "level-checkback__title", text: CHECK_BACK_TITLE }),
      el("p", { class: "level-checkback__lead", text: reads ? CHECK_BACK_READ : CHECK_BACK_TALK }),
      el("ul", { class: "level-dates", role: "list" }, rows),
    ]);
  }

  // "Friday, Oct 16: check-back 1"; check-back 2 adds that it turns the node gold.
  function checkBackRow(day, stage) {
    const words = [app.loop.dateText(day, "long") + ": check-back " + stage];
    if (stage === 2) {
      words.push(TURNS_GOLD, el("span", { class: "level-dates__gold", text: GOLD }));
    }
    return el("li", { class: "level-dates__item" }, [
      iconOf("calendar", 20, "level-dates__icon"),
      el("span", {}, words),
    ]);
  }

  // The unit's next level not cleared, or once all five are, its checkpoint: a card naming it
  // and a link that starts it, beside Back to path.
  function nextParts(target) {
    const cleared = clearedAfter(target);
    const unit = app.path.UNITS.find((entry) => entry.id === target.play.unit);
    const level = unit ? app.path.currentLevel(unit, cleared) : null;
    let nextId = level ? level.id : null;
    if (nextId === null && unit) {
      const checkpoint = app.path.checkpointState(unit.id, cleared);
      if (checkpoint && checkpoint.open && !checkpoint.cleared) {
        nextId = checkpoint.id;
      }
    }
    if (nextId === null) {
      return [actionsOf([linkButton(BACK_TO_PATH, PATH_HREF, true)])];
    }
    const next = app.path.playById(nextId, { baseline: target.baseline, cleared });
    const start = next.kind === LOOP ? "Start level " + next.number : START_CHECKPOINT;
    return [
      el("div", { class: "level-card level-next" }, [
        el("p", { class: "level-next__label", text: NEXT_LABEL }),
        el("h2", { class: "level-next__title", text: next.heading }),
        el("p", {
          class: "level-next__goal",
          text: next.subtitle + ", " + targetWords(next.goal, scoredWhere(next)),
        }),
      ]),
      actionsOf([
        linkButton(start, LEVEL_HREF + next.id, true),
        linkButton(BACK_TO_PATH, PATH_HREF, false),
      ]),
    ];
  }

  // The benchmark's Done: this sitting's read and talk, the change since the first sitting
  // when there is one, and when the next is due (app.path.benchmarkState).
  function buildDone(target) {
    const title = resultTitle(BENCHMARK_DONE);
    const [read, talk] = target.takes;
    const state = app.path.benchmarkState(historyNow(target), today());
    const lines = [
      el("p", { class: "level-done__line", text: READ_LINE + read.evaluation.sentence }),
      el("p", { class: "level-done__line", text: TALK_LINE + talk.evaluation.sentence }),
    ];
    const since = sinceFirst(state.sittings);
    if (since !== null) {
      lines.push(el("p", { class: "level-done__since", text: since }));
    }
    if (state.nextOn) {
      lines.push(
        el("p", {
          class: "level-done__next",
          text: "Next benchmark: " + app.loop.dateText(state.nextOn, "short") + ".",
        }),
      );
    }
    return {
      node: stepNode([
        el("div", { class: "level-card level-done" }, [title, ...lines]),
        actionsOf([linkButton(BACK_TO_PATH, PATH_HREF, true)]),
      ]),
      heading: title,
    };
  }

  // "Since your first: read slips 6 → 2, fillers 5.1 → 2.4 a minute", or null before a second
  // sitting or with nothing to compare.
  function sinceFirst(sittings) {
    if (sittings.length < 2) {
      return null;
    }
    const first = sittings[0];
    const latest = sittings[sittings.length - 1];
    const parts = [];
    if (first.readSlips !== null && latest.readSlips !== null) {
      parts.push("read slips " + first.readSlips + " → " + latest.readSlips);
    }
    if (first.fillersPerMinute !== null && latest.fillersPerMinute !== null) {
      parts.push(
        "fillers " + first.fillersPerMinute.toFixed(1) + " → " +
          latest.fillersPerMinute.toFixed(1) + " a minute",
      );
    }
    return parts.length > 0 ? SINCE_FIRST + parts.join(", ") : null;
  }

  // --- Small helpers ---------------------------------------------------------------------------

  function el(tag, attrs, children) {
    return app.ui.el(tag, attrs, children);
  }

  // A decorative icon, with a class when given (an SVG element takes it as an attribute).
  function iconOf(name, size, className) {
    const svg = app.ui.icon(name, size);
    if (svg && className) {
      svg.setAttribute("class", className);
    }
    return svg;
  }

  // Replaces a node's children.
  function fill(node, children) {
    app.ui.clear(node);
    children.forEach((child) => {
      if (child === null || child === undefined) {
        return;
      }
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
  }

  function setHeading(text) {
    if (heading !== null) {
      heading.textContent = text;
    }
  }

  // Every list, store and screen read is wrapped, so a store that cannot be read starts the
  // play as a new speaker's rather than failing.
  async function loadHistory() {
    try {
      const sessions = await app.store.list();
      return Array.isArray(sessions) ? sessions : [];
    } catch {
      return [];
    }
  }

  async function loadCleared() {
    try {
      const levels = await app.store.listClearedLevels();
      return Array.isArray(levels) ? levels : [];
    } catch {
      return [];
    }
  }

  // Today as a local calendar day; the screen reads the clock so app.path never does.
  function today() {
    return app.path.localDay(new Date());
  }

  function countOf(count, noun) {
    return count + " " + noun + (count === 1 ? "" : "s");
  }

  // "4", "4 and 5", "3, 4 and 5".
  function joinAnd(items) {
    if (items.length < 2) {
      return items.join("");
    }
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  }

  // Whether keyboard focus sits in `node`; false where a test fake has no activeElement or
  // contains().
  function holdsFocus(node) {
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (!active || !node || typeof node.contains !== "function") {
      return false;
    }
    return node.contains(active);
  }

  // Moves focus when the node can take it. A new step's heading is focused without scrolling,
  // since the page was just put at its top.
  function focusIfPossible(node, preventScroll) {
    if (node && typeof node.focus === "function") {
      node.focus({ preventScroll: Boolean(preventScroll) });
    }
  }

  function scrollToTop() {
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      window.scrollTo(0, 0);
    }
  }

  app.screens.level = { mount, show, hide };
})();
