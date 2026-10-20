/* tips.js: app.tips, the coaching shown under the Results transcript. select(report, options)
   reads one take's app.delivery report and the passage's target range and returns at most two
   {id, text} rule tips in priority order; pure. coachNotes(session, report, targetWpm, tier) is
   the one request to POST /api/advice (docs/PLAN.md T41): cited notes written for the take;
   Claude's are kept in app.store flags so a take is asked about once. adviceRequest and
   parseCoachNotes are pure. DEFAULT_TIER ("Novice") is the tier a speaker with no rank is
   coached at; Results (without rank.js) and the Level screen (rank never shows on the Path) send
   it. */
(function () {
  "use strict";

  /* Rules, top to bottom; the first two that fire are shown, and "clean" shows only when none
     fire. [lo, hi] is options.targetWpm, default [140, 160]. Every number is rounded as the
     Results cards show it, so a tip never disagrees with the card above it.

       id          fires when                  why it matters for a speaker
       pace-fast   wpm > hi + 15               a listener who cannot keep up stops following
       pace-slow   wpm < lo - 15               a slow talk runs out of time for its last point
       fillers     fillers per minute > 3      Zoom and tl;dv put 0.6 to 3 a minute in range
       habit       top habit 3 times or more   the Ah-Counter names each speaker's crutch word
       break-long  mid-sentence pause > 3 s    a pause at a period lands; mid-sentence it stalls
       freeze      5 s+ pause after a period   a freeze reads as a lost place, even at a period
       repeats     3 restarts or more          each restart costs the listener's trust in the line
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
  // The Coach headline's moment kind (app.coach) that already carries the fillers technique.
  const FILLER_KIND = "filler";
  const SECONDS_PER_MINUTE = 60;

  // --- coach notes (docs/PLAN.md T41) ---
  const ADVICE_URL = "/api/advice";
  const OK = 200;
  // The backend caps the excerpt at 1,500 characters (coach.py MAX_EXCERPT_CHARACTERS).
  const MAX_EXCERPT_CHARACTERS = 1500;
  // The store keeps at most 2,000 shown ids (coach.py MAX_SHOWN_IDS); the newest are kept.
  const MAX_SHOWN_IDS = 2000;
  // A request sends at most the newest 600 of them: the library holds 632 entries with ids of 11
  // characters or fewer, so 600 ids cost under 10,000 bytes. 40 moments at their caps cost up to
  // about 50,000 bytes when every character is an emoji (4 bytes in UTF-8, the widest a
  // character can be once nothing is sent as a \uXXXX escape: see ESCAPED), and the 1,500-unit
  // excerpt up to 4,500. That widest body would pass the server's body limit (MAX_BODY_BYTES),
  // so fitShownIds leaves out the oldest ids until the body fits.
  const MAX_REQUEST_SHOWN_IDS = 600;
  // /api/advice refuses a body over this many bytes (backend/limits.py MAX_SMALL_BODY_BYTES).
  const MAX_BODY_BYTES = 64000;
  // The moments a request may carry and the caps on their text fields (coach.py MAX_MOMENTS,
  // MAX_MOMENT_TEXT_CHARACTERS, MAX_MOMENT_CONTEXT_CHARACTERS, MAX_EXPECTED_CHARACTERS).
  const MAX_MOMENTS = 40;
  const MAX_MOMENT_TEXT = 120;
  const MAX_MOMENT_CONTEXT = 60;
  const MAX_MOMENT_EXPECTED = 40;
  const MAX_MOMENT_SECONDS = 86400;
  const MOMENT_KINDS = [
    "restart", "filler", "pause", "long-pause", "misread", "skip", "stumble", "unclear",
  ];
  // A moment's id is its kind and a number of up to three digits; its clock is m:ss.
  const MOMENT_ID = /^(?:restart|filler|pause|long-pause|misread|skip|stumble|unclear)-\d{1,3}$/;
  const MOMENT_CLOCK = /^\d{1,3}:[0-5]\d$/;
  // What JSON writes as a 6-byte \uXXXX escape: the C0 control characters (U+0000 to U+001F;
  // NUL is refused by the server) and a lone half of a surrogate pair. None is ever sent.
  const ESCAPED =
    /[\u0000-\u001f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
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

  // "Fillers at 0:02, 0:05 and 0:10." or "... 0:10 and 8 more.", then the technique, unless the
  // Coach headline is about a filler and already says it (options.headlineKind "filler"): the
  // tip then lists the moments alone, so the card gives the advice once. A take saved without
  // words has no moments to name, so it gets the advice alone.
  function fillersText(facts) {
    const technique = "Next take, close your mouth and pause instead.";
    if (facts.fillerTimes.length === 0) {
      return "Replace um with a silent beat. " + technique;
    }
    const listed = facts.fillerTimes.slice(0, MAX_TIMES_LISTED).map(clockText);
    const more = facts.fillerTimes.length - listed.length;
    const moments = "Fillers at " + joinMoments(listed, more) + ".";
    return facts.headlineKind === FILLER_KIND ? moments : moments + " " + technique;
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
  // habit) so a bad record still yields a tip instead of an exception. Clocks count from the
  // first word (the report's speechStart), as the Coach card's chips, the speech map and the
  // transcript count them; a report without one counts from the audio's start.
  function readFacts(report, options) {
    const [lo, hi] = targetRange(options.targetWpm);
    const start = Number.isFinite(report.speechStart) ? report.speechStart : 0;
    const fromFirstWord = (seconds) => Math.max(0, numberOr0(seconds) - start);
    const fillers = Array.isArray(report.fillers) ? report.fillers : [];
    const habit = report.topHabit;
    const validHabit =
      habit && typeof habit.text === "string" && Number.isFinite(Number(habit.count));
    return {
      lo,
      hi,
      wpm: Math.round(numberOr0(report.wordsPerMinute)),
      fillersPerMinute: roundToTenth(numberOr0(report.fillersPerMinute)),
      fillerTimes: fillers.map((event) => fromFirstWord(event && event.start)),
      topHabit: validHabit ? { text: habit.text, count: Number(habit.count) } : null,
      longestBreak: roundToTenth(numberOr0(report.longestMidSentencePause)),
      longestFreeze: longestFreeze(report.pauses, fromFirstWord),
      repeatCount: numberOr0(report.repeatCount),
      headlineKind: typeof options.headlineKind === "string" ? options.headlineKind : null,
    };
  }

  // The longest long pause (5 s+, the report's `long` flag) that falls between sentences, as
  // {at, length}, or null. A long mid-sentence pause is left to break-long, so one freeze never
  // gets two tips.
  function longestFreeze(pauses, fromFirstWord) {
    let longest = null;
    (Array.isArray(pauses) ? pauses : []).forEach((pause) => {
      const freeze = pause && pause.long === true && pause.midSentence === false;
      if (freeze && (longest === null || numberOr0(pause.length) > longest.length)) {
        longest = { at: fromFirstWord(pause.at), length: numberOr0(pause.length) };
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
  function adviceRequest(session, report, targetWpm, tier, shownIds, moments) {
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
    const body = {
      session_id: String(session && session.id),
      summary,
      tier: isNonBlankString(tier) ? tier : DEFAULT_TIER,
      shown_ids: stringsOf(shownIds).slice(-MAX_REQUEST_SHOWN_IDS),
    };
    // A list of moments (an empty one for a clean take) is sent; no list, no key.
    if (Array.isArray(moments)) {
      body.moments = momentsOf(moments);
    }
    fitShownIds(body);
    return body;
  }

  // The moments the server accepts, in order: at most MAX_MOMENTS, each id once, a moment that
  // would be refused (an id that does not match its kind, a bad clock or time) left out, and
  // every text field cut to its cap.
  function momentsOf(list) {
    const seen = new Set();
    const kept = [];
    for (const given of list) {
      const moment = wireMoment(given);
      if (moment !== null && !seen.has(moment.id)) {
        seen.add(moment.id);
        kept.push(moment);
      }
      if (kept.length === MAX_MOMENTS) {
        break;
      }
    }
    return kept;
  }

  function wireMoment(given) {
    if (given === null || typeof given !== "object") {
      return null;
    }
    const valid =
      MOMENT_KINDS.includes(given.kind) &&
      typeof given.id === "string" &&
      MOMENT_ID.test(given.id) &&
      given.id.replace(/-\d+$/, "") === given.kind &&
      typeof given.clock === "string" &&
      MOMENT_CLOCK.test(given.clock) &&
      isSecondCount(given.at);
    if (!valid) {
      return null;
    }
    return {
      id: given.id,
      kind: given.kind,
      at: given.at,
      clock: given.clock,
      seconds: isSecondCount(given.seconds) ? given.seconds : null,
      text: cutText(given.text, MAX_MOMENT_TEXT, false),
      before: cutText(given.before, MAX_MOMENT_CONTEXT, true),
      after: cutText(given.after, MAX_MOMENT_CONTEXT, false),
      expected: typeof given.expected === "string"
        ? cutText(given.expected, MAX_MOMENT_EXPECTED, false)
        : null,
      hint: given.hint === true,
    };
  }

  function isSecondCount(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 &&
      value <= MAX_MOMENT_SECONDS;
  }

  // `value` as text of at most `limit` characters (whole code points, so no half an emoji),
  // without any character JSON would escape (ESCAPED; NUL among them, which the server refuses).
  // A context before a moment keeps its end, the words nearest the moment; any other text keeps
  // its start.
  function cutText(value, limit, keepEnd) {
    const characters = Array.from(typeof value === "string" ? value.replace(ESCAPED, "") : "");
    return (keepEnd ? characters.slice(-limit) : characters.slice(0, limit)).join("");
  }

  // Leaves out the oldest shown ids, only as many as it takes, while the body as UTF-8 JSON is
  // over MAX_BODY_BYTES. The moments and the excerpt, what the notes are about, always stay.
  function fitShownIds(body) {
    let over = utf8Bytes(JSON.stringify(body)) - MAX_BODY_BYTES;
    let dropped = 0;
    while (over > 0 && dropped < body.shown_ids.length) {
      // The id in its quotes, and the comma after it.
      over -= utf8Bytes(JSON.stringify(body.shown_ids[dropped])) + 1;
      dropped += 1;
    }
    if (dropped > 0) {
      body.shown_ids = body.shown_ids.slice(dropped);
    }
  }

  // The UTF-8 length of `text` (a JSON string, so it holds no lone surrogate).
  function utf8Bytes(text) {
    let bytes = 0;
    for (const character of text) {
      const code = character.codePointAt(0);
      if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (code < 0x10000) {
        bytes += 3;
      } else {
        bytes += 4;
      }
    }
    return bytes;
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

  // The transcript's words, space-joined, without any character JSON would escape (ESCAPED), up
  // to MAX_EXCERPT_CHARACTERS. A cut that would leave half an emoji drops that half too, so the
  // server never reads a lone surrogate.
  function excerptOf(transcript) {
    if (!Array.isArray(transcript)) {
      return "";
    }
    const text = transcript
      .map((word) => String((word && word.text) || ""))
      .join(" ")
      .replace(ESCAPED, "");
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
    return { headline: parseHeadline(reply.headline), tips, source: reply.source };
  }

  // The reply's headline as {text, momentId} (momentId null when it names no moment), or null
  // when there is none or it has no text.
  function parseHeadline(headline) {
    if (headline === null || typeof headline !== "object" || !isNonBlankString(headline.text)) {
      return null;
    }
    const momentId = isNonBlankString(headline.moment_id) ? headline.moment_id : null;
    return { text: headline.text.trim(), momentId };
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
      momentIds: stringsOf(tip.moment_ids),
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
  // app.api.postJson, sending the shown ids with it. The entry ids it showed are recorded, and
  // its reply is kept for the next visit when Claude wrote it. While that request is open, another call for the take gets the same
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
      const body = adviceRequest(session, report, targetWpm, tier, shown, momentsFor(session, report));
      const reply = await app.api.postJson(ADVICE_URL, body);
      const notes = reply && reply.status === OK ? parseCoachNotes(reply.body) : null;
      if (notes !== null) {
        await keepNotes(id, reply.body, notes);
      }
      return notes;
    } catch {
      return null;
    }
  }

  // The take's moments from app.coach, or undefined when it is not loaded or fails: the request
  // is then sent without them, as a take with none to name.
  function momentsFor(session, report) {
    try {
      const coach = app.coach;
      return coach && typeof coach.coachMoments === "function"
        ? coach.coachMoments(report, session && session.transcript)
        : undefined;
    } catch {
      return undefined;
    }
  }

  // The store to keep the notes in and the request to ask with: both load before this
  // file in index.html. A context without them (a test that stubs app) simply has no notes.
  function canAskForNotes() {
    const store = app.store;
    const api = app.api;
    return Boolean(
      store &&
        typeof store.getFlag === "function" &&
        typeof store.setFlag === "function" &&
        api &&
        typeof api.postJson === "function",
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

  app.tips = { select, adviceRequest, parseCoachNotes, coachNotes, DEFAULT_TIER };
})();
