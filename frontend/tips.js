/* tips.js: app.tips, the coaching shown under the Results transcript. select(report, options)
   reads one take's app.delivery report and the passage's target range and returns at most two
   {id, text} rule tips in priority order; pure. coachNotes(session, report, targetWpm, tier) is
   the one request to POST /api/advice (docs/PLAN.md T41): cited notes written for the take;
   Claude's are kept in app.store flags so a take is asked about once. adviceRequest and
   parseCoachNotes are pure. */
(function () {
  "use strict";

  /* Rules, top to bottom; the first two that fire are shown, and "clean" shows only when none
     fire. [lo, hi] is options.targetWpm, default [140, 160]. Every number is rounded as the
     Results cards show it, so a tip never disagrees with the card above it.

       id          fires when                  why it matters for a debater
       pace-fast   wpm > hi + 15               a judge who cannot keep up stops flowing
       pace-slow   wpm < lo - 15               a slow speech runs out of time for its last point
       fillers     fillers per minute > 3      Zoom and tl;dv put 0.6 to 3 a minute in range
       habit       top habit 3 times or more   the Ah-Counter names each speaker's crutch word
       break-long  mid-sentence pause > 3 s    a pause at a period lands; mid-sentence it stalls
       freeze      5 s+ pause after a period   a freeze reads as a lost place, even at a period
       repeats     3 restarts or more          each restart costs the judge's trust in the line
       clean       nothing above fired */

  const DEFAULT_TARGET_WPM = [140, 160];
  const MAX_TIPS = 2;
  const PACE_MARGIN_WPM = 15;
  const MAX_FILLERS_PER_MINUTE = 3;
  const MIN_HABIT_COUNT = 3;
  const MAX_BREAK_SECONDS = 3;
  const MIN_REPEATS = 3;
  // The fillers tip lists this many moments, then "and N more".
  const MAX_TIMES_LISTED = 3;
  const SECONDS_PER_MINUTE = 60;

  // --- coach notes (docs/PLAN.md T41) ---
  const ADVICE_URL = "/api/advice";
  const OK = 200;
  // The backend caps the excerpt at 1,500 characters (coach.py MAX_EXCERPT_CHARACTERS).
  const MAX_EXCERPT_CHARACTERS = 1500;
  // A request may list at most 2,000 shown ids (coach.py MAX_SHOWN_IDS); the newest are kept.
  const MAX_SHOWN_IDS = 2000;
  // A speaker with no rank yet is coached as a Novice (backend/advice/select.py DEFAULT_TIER).
  const DEFAULT_TIER = "Novice";
  // The server writes 2 or 3 notes (coach.py MAX_TIPS); more would be a reply to distrust.
  const MAX_NOTES = 3;
  // Only web links are drawn; any other url is left out and the label stands alone.
  const WEB_URL = /^https?:\/\//i;
  // Who wrote the notes, as the reply's `source` says: Claude, or the library's own words.
  const AI_SOURCE = "ai";
  const SOURCES = [AI_SOURCE, "library"];
  // A high surrogate, the first half of an emoji in UTF-16: an excerpt never ends on one.
  const HIGH_SURROGATE_FIRST = 0xd800;
  const HIGH_SURROGATE_LAST = 0xdbff;
  // The flags that keep the notes: one per take (Claude's reply, word for word, under
  // NOTES_FLAG_PREFIX + the take's id) and one list of the entry ids shown here, oldest first,
  // which the request sends so a guest is not shown an entry twice while new ones are left. The
  // library's own words are shown but not kept: they stand in only while there is no key, the
  // model failed or timed out, or its budget is spent, so a later visit asks again.
  const NOTES_FLAG_PREFIX = "coachNotes:";
  const SHOWN_FLAG = "coachNotesShown";

  const RULES = [
    {
      id: "pace-fast",
      fires: (facts) => facts.wpm > facts.hi + PACE_MARGIN_WPM,
      text: () => "You are above target pace. Breathe at each period.",
    },
    {
      id: "pace-slow",
      fires: (facts) => facts.wpm < facts.lo - PACE_MARGIN_WPM,
      text: () => "You are under target pace. Shorten the pauses between ideas.",
    },
    {
      id: "fillers",
      fires: (facts) => facts.fillersPerMinute > MAX_FILLERS_PER_MINUTE,
      text: fillersText,
    },
    {
      id: "habit",
      fires: (facts) => facts.topHabit !== null && facts.topHabit.count >= MIN_HABIT_COUNT,
      text: (facts) =>
        "You said “" + facts.topHabit.text + "” " + facts.topHabit.count + " times. " +
        "Drop it and let the sentence land.",
    },
    {
      id: "break-long",
      fires: (facts) => facts.longestBreak > MAX_BREAK_SECONDS,
      text: () =>
        "A pause in the middle of a sentence ran past 3 seconds. " +
        "Glance at your next point first.",
    },
    {
      id: "freeze",
      fires: (facts) => facts.longestFreeze !== null,
      text: (facts) =>
        "You froze for " + facts.longestFreeze.length.toFixed(1) + " seconds at " +
        clockText(facts.longestFreeze.at) + ". Know how your next point opens.",
    },
    {
      id: "repeats",
      fires: (facts) => facts.repeatCount >= MIN_REPEATS,
      text: (facts) =>
        "You restarted phrases " + facts.repeatCount + " times. Finish the sentence, then fix it.",
    },
  ];

  // The clean tip names what went right and gives no direction: the headline's focus above it
  // already says what to work on next, so the screen gives one piece of advice.
  const CLEAN_TIP = { id: "clean", text: "Clean run. No filler, habit or long pause stood out." };

  function select(report, options) {
    const facts = readFacts(report || {}, options || {});
    const fired = RULES.filter((rule) => rule.fires(facts)).slice(0, MAX_TIPS);
    if (fired.length === 0) {
      return [{ id: CLEAN_TIP.id, text: CLEAN_TIP.text }];
    }
    return fired.map((rule) => ({ id: rule.id, text: rule.text(facts) }));
  }

  // "Fillers at 0:02, 0:05 and 0:10." or "... 0:10 and 8 more.", then the technique. A take
  // saved without words has no moments to name, so it gets the advice alone.
  function fillersText(facts) {
    const technique = "Next take, close your mouth and pause instead.";
    if (facts.fillerTimes.length === 0) {
      return "Replace um with a silent beat. " + technique;
    }
    const listed = facts.fillerTimes.slice(0, MAX_TIMES_LISTED).map(clockText);
    const more = facts.fillerTimes.length - listed.length;
    return "Fillers at " + joinMoments(listed, more) + ". " + technique;
  }

  // "0:02", "0:02 and 0:05", "0:02, 0:05 and 0:10", or "0:02, 0:05, 0:10 and 8 more".
  function joinMoments(listed, more) {
    if (more > 0) {
      return listed.join(", ") + " and " + more + " more";
    }
    if (listed.length === 1) {
      return listed[0];
    }
    return listed.slice(0, -1).join(", ") + " and " + listed[listed.length - 1];
  }

  // The numbers the rules compare, read once. Missing or malformed values read as 0 (or no
  // habit) so a bad record still yields a tip instead of an exception.
  function readFacts(report, options) {
    const [lo, hi] = targetRange(options.targetWpm);
    const fillers = Array.isArray(report.fillers) ? report.fillers : [];
    const habit = report.topHabit;
    const validHabit =
      habit && typeof habit.text === "string" && Number.isFinite(Number(habit.count));
    return {
      lo,
      hi,
      wpm: Math.round(numberOr0(report.wordsPerMinute)),
      fillersPerMinute: roundToTenth(numberOr0(report.fillersPerMinute)),
      fillerTimes: fillers.map((event) => numberOr0(event && event.start)),
      topHabit: validHabit ? { text: habit.text, count: Number(habit.count) } : null,
      longestBreak: roundToTenth(numberOr0(report.longestMidSentencePause)),
      longestFreeze: longestFreeze(report.pauses),
      repeatCount: numberOr0(report.repeatCount),
    };
  }

  // The longest long pause (5 s+, the report's `long` flag) that falls between sentences, as
  // {at, length}, or null. A long mid-sentence pause is left to break-long, so one freeze never
  // gets two tips.
  function longestFreeze(pauses) {
    let longest = null;
    (Array.isArray(pauses) ? pauses : []).forEach((pause) => {
      const freeze = pause && pause.long === true && pause.midSentence === false;
      if (freeze && (longest === null || numberOr0(pause.length) > longest.length)) {
        longest = { at: numberOr0(pause.at), length: numberOr0(pause.length) };
      }
    });
    return longest;
  }

  // The same m:ss text as app.ui.formatClock, kept here so tips.js loads on its own.
  function clockText(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
    const rest = whole % SECONDS_PER_MINUTE;
    return minutes + ":" + String(rest).padStart(2, "0");
  }

  // A copy of [lo, hi] when the option is a pair of finite numbers, else the default range.
  function targetRange(targetWpm) {
    const valid =
      Array.isArray(targetWpm) &&
      targetWpm.length === 2 &&
      targetWpm.every((bound) => Number.isFinite(Number(bound)));
    const range = valid ? targetWpm : DEFAULT_TARGET_WPM;
    return [Number(range[0]), Number(range[1])];
  }

  function numberOr0(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function roundToTenth(value) {
    return Math.round(value * 10) / 10;
  }

  // --- coach notes ---

  // The JSON body of POST /api/advice (backend/advice/coach.py AdviceRequest) for one take: the
  // numbers the Results cards show, read from its app.delivery report, the start of what was
  // said, the speaker's tier and the entries already shown. Every number is finite and 0 or more
  // and every count whole, as the server requires; the band goes only when it is a real [lo, hi].
  // Pure: a fresh object, and no input is changed.
  function adviceRequest(session, report, targetWpm, tier, shownIds) {
    const given = report && typeof report === "object" ? report : {};
    const summary = {
      duration_seconds: nonNegative(given.speakingSeconds),
      words_per_minute: nonNegative(given.wordsPerMinute),
      filler_count: wholeCount(given.fillerCount),
      restart_count: wholeCount(given.repeatCount),
      mid_sentence_pause_count: wholeCount(given.midSentencePauseCount),
      long_pause_count: wholeCount(given.longPauseCount),
    };
    const band = paceBand(targetWpm);
    if (band !== null) {
      summary.target_wpm = band;
    }
    summary.transcript_excerpt = excerptOf(session && session.transcript);
    return {
      session_id: String(session && session.id),
      summary,
      tier: isNonBlankString(tier) ? tier : DEFAULT_TIER,
      shown_ids: stringsOf(shownIds).slice(-MAX_SHOWN_IDS),
    };
  }

  function nonNegative(value) {
    return Math.max(0, numberOr0(value));
  }

  function wholeCount(value) {
    return Math.max(0, Math.round(numberOr0(value)));
  }

  // [lo, hi] when `targetWpm` is a pair of finite numbers running low to high, else null: the
  // server refuses a band that does not (coach.py band_runs_low_to_high).
  function paceBand(targetWpm) {
    if (!Array.isArray(targetWpm) || targetWpm.length !== 2) {
      return null;
    }
    const [lo, hi] = targetWpm.map(Number);
    return Number.isFinite(lo) && Number.isFinite(hi) && lo < hi ? [lo, hi] : null;
  }

  // The transcript's words, space-joined, up to MAX_EXCERPT_CHARACTERS. A cut that would leave
  // half an emoji drops that half too, so the server never reads a lone surrogate.
  function excerptOf(transcript) {
    if (!Array.isArray(transcript)) {
      return "";
    }
    const text = transcript.map((word) => String((word && word.text) || "")).join(" ");
    const excerpt = text.slice(0, MAX_EXCERPT_CHARACTERS);
    const last = excerpt.charCodeAt(excerpt.length - 1);
    const endsOnHalfAnEmoji = last >= HIGH_SURROGATE_FIRST && last <= HIGH_SURROGATE_LAST;
    return endsOnHalfAnEmoji ? excerpt.slice(0, -1) : excerpt;
  }

  function stringsOf(list) {
    return Array.isArray(list) ? list.filter((item) => typeof item === "string") : [];
  }

  function isNonBlankString(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  // The server's reply (coach.py Advice), checked and put in the shape Results draws:
  // {tips: [{entryId, text, drill, citation: {label, url, type}}], source}, or null for a reply
  // that is not one, so a broken answer leaves the rule tips in place. At most MAX_NOTES tips are
  // kept; a tip without an id, a text or a cited label fails the whole reply, since a note with
  // no source is the one thing the screen must never show. Pure: fresh objects.
  function parseCoachNotes(reply) {
    if (reply === null || typeof reply !== "object" || !SOURCES.includes(reply.source)) {
      return null;
    }
    if (!Array.isArray(reply.tips) || reply.tips.length === 0) {
      return null;
    }
    const tips = reply.tips.slice(0, MAX_NOTES).map(parseNote);
    if (tips.some((tip) => tip === null)) {
      return null;
    }
    return { tips, source: reply.source };
  }

  function parseNote(tip) {
    if (tip === null || typeof tip !== "object") {
      return null;
    }
    const citation = parseCitation(tip.citation);
    if (!isNonBlankString(tip.entry_id) || !isNonBlankString(tip.text) || citation === null) {
      return null;
    }
    return {
      entryId: tip.entry_id,
      text: tip.text.trim(),
      drill: typeof tip.drill === "string" ? tip.drill.trim() : "",
      citation,
    };
  }

  function parseCitation(citation) {
    if (citation === null || typeof citation !== "object" || !isNonBlankString(citation.label)) {
      return null;
    }
    const isWebLink = typeof citation.url === "string" && WEB_URL.test(citation.url);
    return {
      label: citation.label.trim(),
      url: isWebLink ? citation.url : null,
      type: typeof citation.type === "string" ? citation.type : "",
    };
  }

  // The requests for notes still waiting for their reply, by take id. A take shown again before
  // its notes arrive (the speaker went back and forth) gets the request already open, so it
  // costs no second request and no second AI call.
  const openRequests = new Map();

  // The last write of the shown list, which the next one waits for (keepShown). Each write reads
  // the list, adds its ids and writes it back; two at once would both read the same list, and
  // the later write would drop the earlier one's ids.
  let shownListWritten = Promise.resolve();

  // The coach notes for one take, or null when there are none to show. Claude's notes, kept here
  // from an earlier visit, come back without a request; otherwise the server is asked, through
  // app.auth.request so a signed-in speaker's cookie goes along and the server keeps their shown
  // ids itself. The entry ids it showed are recorded, and its reply is kept for the next visit
  // when Claude wrote it. While that request is open, another call for the take gets the same
  // promise. A reply that is not notes, no reply, or a store that cannot be read gives null and
  // keeps nothing; notes the store cannot keep are still returned. Never rejects.
  function coachNotes(session, report, targetWpm, tier) {
    const id = session && session.id;
    if (!id || !canAskForNotes()) {
      return Promise.resolve(null);
    }
    const key = String(id);
    if (!openRequests.has(key)) {
      const asked = askForNotes(id, session, report, targetWpm, tier);
      const forget = () => openRequests.delete(key);
      openRequests.set(key, asked);
      asked.then(forget, forget);
    }
    return openRequests.get(key);
  }

  // The one request behind coachNotes: Claude's notes kept for the take, or else the server's.
  // Only Claude's are ever kept (keepNotes), so anything else under the flag is asked again.
  async function askForNotes(id, session, report, targetWpm, tier) {
    try {
      const kept = parseCoachNotes(await app.store.getFlag(NOTES_FLAG_PREFIX + id));
      if (kept !== null && kept.source === AI_SOURCE) {
        return kept;
      }
      const shown = stringsOf(await app.store.getFlag(SHOWN_FLAG));
      const body = adviceRequest(session, report, targetWpm, tier, shown);
      const reply = await app.auth.request("POST", ADVICE_URL, body);
      const notes = reply && reply.status === OK ? parseCoachNotes(reply.body) : null;
      if (notes !== null) {
        await keepNotes(id, reply.body, notes);
      }
      return notes;
    } catch {
      return null;
    }
  }

  // The store to keep the notes in and the account's request to ask with: both load before this
  // file in index.html. A context without them (a test that stubs app) simply has no notes.
  function canAskForNotes() {
    const store = app.store;
    const auth = app.auth;
    return Boolean(
      store &&
        typeof store.getFlag === "function" &&
        typeof store.setFlag === "function" &&
        auth &&
        typeof auth.request === "function",
    );
  }

  // Keeps Claude's reply under the take's flag, so the take is not asked about again, and adds
  // the entry ids shown to the shown list whoever wrote them. The library's words are not kept
  // (NOTES_FLAG_PREFIX). A store that fails here costs nothing but a repeat request on the next
  // visit.
  async function keepNotes(id, replyBody, notes) {
    try {
      if (notes.source === AI_SOURCE) {
        await app.store.setFlag(NOTES_FLAG_PREFIX + id, replyBody);
      }
      await keepShown(notes.tips.map((tip) => tip.entryId));
    } catch {
      // The notes are shown all the same.
    }
  }

  // Moves `ids` to the end of the shown list, the most recently shown last, which is the order
  // the server takes them in, and keeps the newest MAX_SHOWN_IDS. The list is read again here,
  // once the reply has landed, not taken from when the request went out, and each write waits
  // for the one before it, so replies for two takes that land together keep both takes' ids.
  function keepShown(ids) {
    const written = shownListWritten.then(async () => {
      const shown = stringsOf(await app.store.getFlag(SHOWN_FLAG));
      const next = shown.filter((entryId) => !ids.includes(entryId)).concat(ids);
      await app.store.setFlag(SHOWN_FLAG, next.slice(-MAX_SHOWN_IDS));
    });
    // A write that failed must not stop the next one, which reads the list afresh.
    shownListWritten = written.catch(() => {});
    return written;
  }

  app.tips = { select, adviceRequest, parseCoachNotes, coachNotes };
})();
