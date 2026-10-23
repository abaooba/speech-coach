/* delivery.js: app.delivery, the rules the coach applies to the words of a stored take.
   classify(words) labels each word a hesitation sound, a verbal habit or neither (isHesitation
   tests one word); analyze(words, metrics) re-scores any saved take into the report Results, tips
   and Progress read, so they never mix two definitions. findStumbles(words) finds the words that
   ran long enough to hide a small stutter: a transcript hint that no report or score reads.
   livePace(sampleRate) estimates the pace from the microphone's samples while a take records,
   and paceFactorAfter(factor, words, peaks) tunes that estimate from the take's words after.
   Pure: no DOM, no store, no I/O, no Web Audio (samples come in as plain Float32Arrays). */
(function () {
  "use strict";

  const HESITATION = "hesitation";
  const HABIT = "habit";

  // um, umm, uhm, uh, uhh, er, erm, ah, ahh, hm, hmm and longer stretches of the same letters,
  // plus the agreement sounds a speaker fills a gap with: mhm, mhmm, mm-hmm, mm-hm, uh-huh.
  // A lone "huh" never matches.
  const HESITATION_PATTERN = /^(?:u+h*m+|u+h+|e+r+m*|a+h+|h+m+|m+-?h+m+|u+h+-h+u+h+)$/;

  // The verbal habits the app counts, in the order a tie for "most used" is broken.
  const HABIT_WORDS = ["like", "so", "you know", "actually", "basically"];

  // Words that make the next "like" a verb or a comparison: "I like", "looks like", "just like".
  const LIKE_VERB_OR_COMPARISON_AFTER = [
    "i", "you", "we", "they", "people", "would", "i'd", "you'd", "we'd", "they'd", "to",
    "do", "does", "did", "don't", "doesn't", "didn't", "not", "really", "also", "just",
    "look", "looks", "looked", "sound", "sounds", "sounded", "feel", "feels", "felt",
    "seem", "seems", "seemed", "something", "nothing", "anything", "things", "stuff",
    "more", "much",
  ];

  // Habits that only count where a sentence or clause begins ("Basically, the plan fails").
  const CLAUSE_OPENERS = ["actually", "basically"];

  // Words that make the next "you know" a real question or verb: "do you know", "let you know".
  const YOU_KNOW_VERB_AFTER = [
    "do", "does", "did", "don't", "doesn't", "didn't", "if", "would", "let", "as",
  ];

  // A pause this long right before "like" marks a filler (Zufferey and Popescu-Belis, 2004).
  const SET_OFF_PAUSE_SECONDS = 0.25;
  // Speakers pause briefly after a connective "so"; only a longer hang counts as a stall.
  const SO_HANG_SECONDS = 0.5;
  // A silence this long is a freeze, not a breath: it counts wherever it falls, even after a
  // full stop, where a shorter pause lets the point land.
  const LONG_PAUSE_SECONDS = 5;

  const CLAUSE_END = /[,;:.?!]["')\]]*$/;
  const SENTENCE_END = /[.?!]["')\]]*$/;
  const EDGE_PUNCTUATION = /^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu;
  const SECONDS_PER_MINUTE = 60;
  // Word times and pause starts are millisecond values; allow for float error when comparing.
  const MILLISECOND = 0.001;

  // How the backend reads a repeat (backend/metrics.py find_repeats, backend/script_align.py),
  // so Results can find the words that say a phrase again. These sounds, the same set as
  // backend REPEAT_SKIP_WORDS, and bare punctuation ("—" said on its own) are never part of a
  // phrase. "mhm" stands for every spelling AGREEMENT_SOUND matches, as backend filler_key
  // reads them: mhmm, mm-hmm, mm-hm, uh-huh.
  const REPEAT_SKIP_WORDS = ["um", "uh", "hmm", "mhm"];
  const AGREEMENT_SOUND = /^(?:m+-?h+m+|u+h+-h+u+h+)$/;
  const AGREEMENT_KEY = "mhm";
  // After a free-talk first copy the second starts within this many words: a restart leaves at
  // most 2 abandoned words, a cut-off restart starts again within 4 (CUTOFF_LOOKAHEAD_WORDS).
  // A script restart has no such limit (see restartOf).
  const SECOND_COPY_SEARCH_WORDS = 4;
  // A dash ending a word marks where the speaker cut themselves off ("ner—", "day—").
  const CUTOFF_MARK = /[—–-]$/;
  // A fragment shorter than this ("a—") is not matched to a word it begins ("and").
  const CUTOFF_MIN_FRAGMENT_LETTERS = 2;
  // Two words joined by a dash with no space ("bullying—the"): the script alignment reads two.
  const JOINING_DASH = /(?<=[\p{L}\p{N}_])(?:--|[-—–])(?=[\p{L}\p{N}_])/u;
  // The backend's stem rule: "I'm" says "I" again, "decision" says "decisions".
  const CONTRACTION = /(?:n['’]t|['’](?:m|s|re|ve|ll|d))$/;

  // A small stutter the transcriber folds into the word it began ("che— check" comes back as
  // "check") still shows in the times: the word runs long. A word is a possible stumble when it
  // lasts STUMBLE_STRETCH times what this speaker takes for a word that many letters, and at
  // least STUMBLE_MIN_EXTRA_SECONDS more. A slow, stressed word can look the same, so it is a
  // hint in the transcript only, never counted. Tuned on the owner's 2026-10-11 takes, where it
  // flags none of 266 words (their one stutter, "ner—", is a restart).
  const STUMBLE_STRETCH = 2.2;
  const STUMBLE_MIN_EXTRA_SECONDS = 0.25;
  // A stutter folded into a word starts right after the word before. A word said slowly after a
  // silence this long is the speaker finding the word ("do some… residual work"), not one.
  const STUMBLE_MAX_SILENCE_BEFORE_SECONDS = 0.5;
  // A shorter word has too little sound to tell a stumble from a stress.
  const STUMBLE_MIN_LETTERS = 4;
  // The speaker's seconds per letter is the median over their words of at least this many
  // letters, fillers left out, and is only trusted with STUMBLE_MIN_PACE_WORDS of them.
  const PACE_MIN_LETTERS = 3;
  const STUMBLE_MIN_PACE_WORDS = 20;
  const LETTER = /\p{L}/gu;

  // The transcriber rated a word this sure or less: a coin flip or worse. Tuned after phone
  // tests (spec 2026-10-17, Phase 0 decisions); at most MAX_UNCLEAR_WORDS words are hinted.
  const UNCLEAR_CONFIDENCE = 0.5;
  const MAX_UNCLEAR_WORDS = 5;
  // A word under three letters ("to", "of") has too little to judge.
  const UNCLEAR_MIN_LETTERS = 3;

  // The live pace while a take records (spec 2026-10-22 section 7) counts syllable nuclei in the
  // microphone's samples the way de Jong and Wempe (2009) do: a peak of loudness with a dip
  // before it and a voice in it. Words are peaks times a words-a-peak factor. It runs on the
  // phone and sends nothing. Loudness is read in the 100 to 5000 Hz band (the top kept under
  // the Nyquist limit at low sample rates) over 32 ms windows, one every 8 ms.
  const LIVE_LOW_HZ = 100;
  const LIVE_HIGH_HZ = 5000;
  const LIVE_HIGH_MAX_SHARE_OF_RATE = 0.45;
  const LIVE_HOP_SECONDS = 0.008;
  const LIVE_HOPS_PER_WINDOW = 4;
  // A peak is at least 2 dB over the median loudness heard so far, at least 1.5 dB over the
  // quietest window since the last peak, the loudest within 3 hops either side, and voiced.
  const LIVE_ABOVE_MEDIAN_DB = 2;
  const LIVE_MIN_DIP_DB = 1.5;
  const LIVE_LOOKAHEAD_HOPS = 3;
  // Voiced: the 40 ms around the peak repeat at a pitch between 75 and 400 Hz, a normalized
  // autocorrelation of 0.45 or more. A hiss ("s") or a click never does.
  const LIVE_VOICING_SECONDS = 0.04;
  const LIVE_PITCH_LOW_HZ = 75;
  const LIVE_PITCH_HIGH_HZ = 400;
  const LIVE_MIN_VOICING = 0.45;
  // The median comes from a histogram of every window's loudness in 0.05 dB bins from -120 dB
  // (digital silence) to 0 dB (full scale), so a long take costs no more than a short one. In
  // dense speech many peaks sit within a few hundredths of a dB of the threshold, and 0.25 dB
  // bins moved it enough to count 4% more of them under a second voice.
  const LIVE_FLOOR_DB = -120;
  const LIVE_CEILING_DB = 0;
  const LIVE_BIN_DB = 0.05;
  // The lowest sample rate the band and the pitch range fit in, and the recent band-passed
  // audio kept for the voicing check behind the look-ahead (it needs about 60 ms).
  const LIVE_MIN_SAMPLE_RATE = 8000;
  const LIVE_KEPT_SECONDS = 0.25;
  // A filter value this small is flushed to 0, so a silence never leaves denormal numbers.
  const LIVE_FLUSH_BELOW = 1e-30;
  // The number: words a minute over the trailing 15 s of speech, or over all of it while that
  // is shorter, shown once there are 5 s of it and rounded to 5. A silence counts toward those
  // seconds only up to 1.5 s, and one over 1.5 s keeps what the row shows, so a pause at a full
  // stop never says Speed up, during it or after it.
  const LIVE_WINDOW_SECONDS = 15;
  const LIVE_MIN_SPEECH_SECONDS = 5;
  const LIVE_ROUND_TO_WPM = 5;
  const LIVE_SILENCE_SECONDS = 1.5;
  // Speech starts at the first peak that 2 more follow within 1.5 s. A tap on Record, a click or
  // a breath before the first word is a lone peak (the owner's read take has two, 1.6 s before
  // it), and starting the clock there would pull the first numbers down.
  const LIVE_SPEECH_RUN_PEAKS = 2;
  const LIVE_SPEECH_RUN_SECONDS = 1.5;
  // The cue: the first number shows the one it calls for. After that, Slow down or Speed up
  // once the number has been more than 10 wpm outside the band for 3 s, and On target again
  // once it has been within that for 3 s. The number is an estimate some 10 wpm either way, so
  // a smaller miss stays On target. The three cue ids are exported, so the live row matches
  // them without a copy of its own.
  const LIVE_CUE_MARGIN_WPM = 10;
  const LIVE_CUE_HOLD_SECONDS = 3;
  // The row reads once a second of the clock, but the audio heard by then comes in whole blocks
  // (1024 samples: 21 ms at 48 kHz, 128 ms at 8 kHz) and a tick can run late, so 3 s of the
  // clock can hold a little under 3 s of audio. With half a read of slack a new cue shows on the
  // read 3 s after the first that called for it: an error under half a second either way never
  // puts it a read later or a read sooner.
  const LIVE_CUE_HOLD_SLACK_SECONDS = 0.5;
  const ON_TARGET = "on-target";
  const SLOW_DOWN = "slow-down";
  const SPEED_UP = "speed-up";
  // Words a peak: 0.69 to start, between the owner's talk take (0.65) and read take (0.74).
  // Each counted take then moves it halfway to its own words over peaks, one factor a mode (the
  // caller keeps Talk and Read apart), kept within 0.45 and 1.1. A take counts with 20 s of
  // speech and 30 words or more. A peak this close outside the first word or the last is
  // still the take's: the recorder and the live tracker start a moment apart.
  const LIVE_PACE_FACTOR = 0.69;
  const PACE_FACTOR_MIN = 0.45;
  const PACE_FACTOR_MAX = 1.1;
  const PACE_FACTOR_WEIGHT = 0.5;
  const PACE_FACTOR_MIN_SECONDS = 20;
  const PACE_FACTOR_MIN_WORDS = 30;
  const PACE_FACTOR_EDGE_SECONDS = 0.25;

  function normalizeWord(text) {
    return String(text || "").toLowerCase().replace(EDGE_PUNCTUATION, "");
  }

  function isHesitation(text) {
    return HESITATION_PATTERN.test(normalizeWord(text));
  }

  // Whether a normalized word is a sound repeats skip: um, uh, hmm, or mhm in any spelling.
  function isRepeatSkip(token) {
    return REPEAT_SKIP_WORDS.includes(AGREEMENT_SOUND.test(token) ? AGREEMENT_KEY : token);
  }

  function numberOr0(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  // One label per word, left to right: "hesitation", "habit" or null.
  function classify(words) {
    const list = toWords(words);
    const tokens = list.map((word) => normalizeWord(word.text));
    const kinds = tokens.map((token) => (HESITATION_PATTERN.test(token) ? HESITATION : null));
    const context = {
      text: (i) => (list[i] ? list[i].text : ""),
      token: (i) => tokens[i] || "",
      hesitation: (i) => kinds[i] === HESITATION,
      gapBefore: (i) => (i > 0 ? list[i].start - list[i - 1].end : 0),
      gapAfter: (i) => (i < list.length - 1 ? list[i + 1].start - list[i].end : Infinity),
      // The nearest earlier word that is not a hesitation, or -1: an um never hides the word
      // that decides whether "like" is a verb ("I, um, like this plan").
      wordBefore: (i) => {
        let index = i - 1;
        while (index >= 0 && kinds[index] === HESITATION) {
          index -= 1;
        }
        return index;
      },
    };

    for (let i = 0; i < list.length; i += 1) {
      if (kinds[i] !== null) {
        continue;
      }
      const token = tokens[i];
      if (token === "you" && tokens[i + 1] === "know") {
        if (youKnowIsHabit(context, i)) {
          kinds[i] = HABIT;
          kinds[i + 1] = HABIT;
        }
        i += 1;
      } else if (token === "like" && likeIsHabit(context, i)) {
        kinds[i] = HABIT;
      } else if (token === "so" && soIsHabit(context, i)) {
        kinds[i] = HABIT;
      } else if (CLAUSE_OPENERS.includes(token) && startsClause(context, kinds, i)) {
        kinds[i] = HABIT;
      }
    }
    return kinds;
  }

  // The indexes of the words that may hide a small stumble, in order (see STUMBLE_STRETCH).
  // Left out: fillers and habit words (a drawn-out "like" is a filler), cut-offs (already
  // restarts), words under STUMBLE_MIN_LETTERS, a word that ends a clause, since speakers draw
  // out the last word before a comma or a full stop, and a word after a silence of
  // STUMBLE_MAX_SILENCE_BEFORE_SECONDS or more. analyze() never reads it, so no score, rank or
  // tip does either.
  function findStumbles(words) {
    const list = toWords(words);
    const kinds = classify(list);
    const letters = list.map((word) => (word.text.match(LETTER) || []).length);
    const seconds = list.map((word) => word.end - word.start);
    const plain = (i) =>
      kinds[i] === null && !HABIT_WORDS.includes(normalizeWord(list[i].text));
    const paceSamples = [];
    list.forEach((word, i) => {
      if (plain(i) && letters[i] >= PACE_MIN_LETTERS && seconds[i] > 0) {
        paceSamples.push(seconds[i] / letters[i]);
      }
    });
    if (paceSamples.length < STUMBLE_MIN_PACE_WORDS) {
      return [];
    }
    const secondsPerLetter = median(paceSamples);
    const stumbles = [];
    list.forEach((word, i) => {
      const usual = secondsPerLetter * letters[i];
      const silenceBefore = i > 0 ? word.start - list[i - 1].end : 0;
      if (
        plain(i) &&
        silenceBefore < STUMBLE_MAX_SILENCE_BEFORE_SECONDS &&
        letters[i] >= STUMBLE_MIN_LETTERS &&
        !CLAUSE_END.test(word.text) &&
        !CUTOFF_MARK.test(word.text) &&
        seconds[i] >= STUMBLE_STRETCH * usual &&
        seconds[i] - usual >= STUMBLE_MIN_EXTRA_SECONDS
      ) {
        stumbles.push(i);
      }
    });
    return stumbles;
  }

  // The indexes of the words the transcriber was unsure of, the least sure first (a tie keeps
  // the earlier word first): at most MAX_UNCLEAR_WORDS words rated below UNCLEAR_CONFIDENCE. A
  // word with no confidence (the provider gave none) is never listed. Left out, as for
  // findStumbles: fillers, habit words, words under UNCLEAR_MIN_LETTERS letters and cut-offs.
  // A hint in the transcript only: analyze() never reads it, so no report field, score, rank or
  // tip changes with or without confidence.
  function findUnclear(words) {
    const raw = Array.isArray(words) ? words : [];
    const list = toWords(raw);
    const kinds = classify(list);
    const unsure = [];
    list.forEach((word, i) => {
      const confidence = raw[i] ? raw[i].confidence : undefined;
      const rated = isFiniteNumber(confidence) && confidence >= 0 && confidence <= 1;
      if (
        rated &&
        confidence < UNCLEAR_CONFIDENCE &&
        kinds[i] === null &&
        !HABIT_WORDS.includes(normalizeWord(word.text)) &&
        (word.text.match(LETTER) || []).length >= UNCLEAR_MIN_LETTERS &&
        !CUTOFF_MARK.test(word.text)
      ) {
        unsure.push({ index: i, confidence });
      }
    });
    unsure.sort((a, b) => a.confidence - b.confidence || a.index - b.index);
    return unsure.slice(0, MAX_UNCLEAR_WORDS).map((entry) => entry.index);
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  // True when the word that decides a phrase's meaning (the nearest non-hesitation word
  // before position i) is in `words` and sits in the same sentence.
  function followsWordIn(context, i, words) {
    const before = context.wordBefore(i);
    return (
      before !== -1 &&
      !SENTENCE_END.test(context.text(before)) &&
      words.includes(context.token(before))
    );
  }

  // True when position i opens the take or a sentence, looking past any hesitations.
  function opensSentence(context, i) {
    const before = context.wordBefore(i);
    return before === -1 || SENTENCE_END.test(context.text(before));
  }

  // "like" right after I, would, looks, just and the rest is a verb or a comparison and never
  // counts. Otherwise it counts when something sets it off: at the start of a sentence, a comma
  // or um right after it ("Like, the plan fails"); mid-sentence, a comma or um on either side
  // or a 0.25 s pause before it ("it was, like, a disaster").
  function likeIsHabit(context, i) {
    if (followsWordIn(context, i, LIKE_VERB_OR_COMPARISON_AFTER)) {
      return false;
    }
    const setOffAfter = CLAUSE_END.test(context.text(i)) || context.hesitation(i + 1);
    if (opensSentence(context, i)) {
      return setOffAfter;
    }
    return (
      setOffAfter ||
      CLAUSE_END.test(context.text(i - 1)) ||
      context.hesitation(i - 1) ||
      context.gapBefore(i) >= SET_OFF_PAUSE_SECONDS
    );
  }

  // "you know" right after do, if, let and the rest is a real verb and never counts. Otherwise
  // it counts when something sets it off after "know": a comma or stop, an um, or a 0.25 s
  // pause. "You know the drill" and "I'll let you know." never count.
  function youKnowIsHabit(context, i) {
    if (followsWordIn(context, i, YOU_KNOW_VERB_AFTER)) {
      return false;
    }
    const know = i + 1;
    return (
      CLAUSE_END.test(context.text(know)) ||
      context.hesitation(know + 1) ||
      context.gapAfter(know) >= SET_OFF_PAUSE_SECONDS
    );
  }

  // "so" counts only when the speaker hangs on it: an um right after it, or half a second of
  // silence mid-sentence. "So the impact is" and "so far" never count.
  function soIsHabit(context, i) {
    if (SENTENCE_END.test(context.text(i))) {
      return false;
    }
    return context.hesitation(i + 1) || context.gapAfter(i) >= SO_HANG_SECONDS;
  }

  // "actually" and "basically" count only where a sentence or clause begins: the first word,
  // after a comma or stop, or right after another filler.
  function startsClause(context, kinds, i) {
    return i === 0 || CLAUSE_END.test(context.text(i - 1)) || kinds[i - 1] !== null;
  }

  // Everything the Results cards, tips and Progress chart need from one take. Words come from
  // the stored transcript; pauses (transcript gaps merged with pauses.js silences) and repeats
  // come from the backend metrics. A take saved without words falls back to the backend's own
  // tallies, so old or hand-made sessions still render.
  function analyze(words, metrics) {
    const list = toWords(words);
    const given = metrics && typeof metrics === "object" ? metrics : {};
    const pauses = pausePairs(given.pauses);
    const repeats = validRepeats(given.repeats, given.script);
    if (list.length === 0) {
      return reportWithoutWords(given, pauses, repeats);
    }
    const kinds = classify(list);
    const fillers = fillerEvents(list, kinds);
    const hesitationCount = fillers.filter((event) => event.kind === HESITATION).length;
    const habitCounts = countHabits(fillers);
    const speakingSeconds = roundToMillisecond(list[list.length - 1].end - list[0].start);
    const classified = pauses.map(([at, length]) => ({
      at,
      length,
      midSentence: isMidSentence(list, at, length),
      long: isLongPause(length) && isInsideSpeech(list, at, length),
    }));
    const breaks = classified.filter(isCountedPause);
    const restarts = restartsOf(list, repeats);
    return {
      kinds,
      fillers,
      fillerCount: fillers.length,
      hesitationCount,
      habitCounts,
      topHabit: topHabit(habitCounts),
      speechStart: list[0].start,
      speakingSeconds,
      wordsPerMinute: perMinute(list.length - hesitationCount, speakingSeconds),
      fillersPerMinute: perMinute(fillers.length, speakingSeconds),
      pauses: classified,
      ...pauseTallies(classified),
      cleanStretch: longestCleanStretch(list, fillers, breaks, repeats, restarts),
      repeatCount: repeats.length,
      restarts,
      followedScript: isScriptBlock(given.script),
      ...scriptSlipsOf(list, given.script),
    };
  }

  // The same report shape from the backend tallies alone, for a session saved without words.
  // Without words no pause can be placed in a sentence, so every pause counts as mid-sentence;
  // the long ones are still flagged.
  function reportWithoutWords(metrics, pauses, repeats) {
    const tallies = metrics.fillers && typeof metrics.fillers === "object" ? metrics.fillers : {};
    const fillerCount = Object.values(tallies).reduce((sum, count) => sum + numberOr0(count), 0);
    const habitCounts = {};
    HABIT_WORDS.forEach((habit) => {
      habitCounts[habit] = numberOr0(tallies[habit]);
    });
    const speakingSeconds = numberOr0(metrics.duration);
    const classified = pauses.map(([at, length]) => ({
      at,
      length,
      midSentence: true,
      long: isLongPause(length),
    }));
    return {
      kinds: [],
      fillers: [],
      fillerCount,
      hesitationCount: ["um", "uh", "hmm", "mhm"].reduce((sum, key) => sum + numberOr0(tallies[key]), 0),
      habitCounts,
      topHabit: topHabit(habitCounts),
      speechStart: null,
      speakingSeconds,
      wordsPerMinute: numberOr0(metrics.words_per_minute),
      fillersPerMinute: perMinute(fillerCount, speakingSeconds),
      pauses: classified,
      ...pauseTallies(classified),
      cleanStretch: null,
      repeatCount: repeats.length,
      restarts: restartsOf([], repeats),
      followedScript: isScriptBlock(metrics.script),
      ...scriptSlipsOf([], metrics.script),
    };
  }

  // Judged on the length the screen shows, to a tenth, so a pause that reads "5.0 s" is long.
  function isLongPause(length) {
    return roundToTenth(length) >= LONG_PAUSE_SECONDS;
  }

  // True for a pause the report counts: every mid-sentence pause, and a long one anywhere.
  function isCountedPause(pause) {
    return pause.midSentence || pause.long;
  }

  // The pause numbers the cards, headline and tips read: `pauseCount` and `longestPause` cover
  // every counted pause, a long mid-sentence pause once; the other two split them by kind.
  function pauseTallies(classified) {
    const counted = classified.filter(isCountedPause);
    const midSentence = classified.filter((pause) => pause.midSentence);
    return {
      pauseCount: counted.length,
      longestPause: longest(counted.map((pause) => pause.length)),
      midSentencePauseCount: midSentence.length,
      longestMidSentencePause: longest(midSentence.map((pause) => pause.length)),
      longPauseCount: classified.filter((pause) => pause.long).length,
    };
  }

  // One event per filler in time order; "you know" is one event spanning both words.
  function fillerEvents(list, kinds) {
    const events = [];
    for (let i = 0; i < list.length; i += 1) {
      if (kinds[i] === null) {
        continue;
      }
      const pair =
        normalizeWord(list[i].text) === "you" &&
        kinds[i + 1] === HABIT &&
        normalizeWord(list[i + 1].text) === "know";
      const last = pair ? i + 1 : i;
      events.push({
        index: i,
        text: pair ? "you know" : normalizeWord(list[i].text),
        kind: kinds[i],
        start: list[i].start,
        end: list[last].end,
      });
      i = last;
    }
    return events;
  }

  function countHabits(fillers) {
    const counts = {};
    HABIT_WORDS.forEach((habit) => {
      counts[habit] = fillers.filter((event) => event.text === habit).length;
    });
    return counts;
  }

  // The most-used habit as {text, count}; a tie goes to the word listed first in HABIT_WORDS.
  function topHabit(habitCounts) {
    let best = null;
    HABIT_WORDS.forEach((habit) => {
      if (habitCounts[habit] > 0 && (best === null || habitCounts[habit] > best.count)) {
        best = { text: habit, count: habitCounts[habit] };
      }
    });
    return best;
  }

  // A pause is mid-sentence unless the word right before it ends a sentence.
  function isMidSentence(list, at, length) {
    return (
      isInsideSpeech(list, at, length) &&
      !SENTENCE_END.test(list[wordBefore(list, at, length)].text)
    );
  }

  // True when the pause follows a word and another word comes after that one. Silence before
  // the first word or after the last is not a pause (backend/metrics.py), though pauses.js can
  // report one.
  function isInsideSpeech(list, at, length) {
    const before = wordBefore(list, at, length);
    return before !== -1 && before !== list.length - 1;
  }

  // The index of the word a pause of `length` seconds starting at `at` follows, or -1: the last
  // word that has ended by `at`, or that is still going then but ends before the quiet does. A
  // pause pauses.js adds starts when the voice went quiet, which can fall inside the
  // transcript's time for the word just said ("sad." runs to 35.738, quiet from 35.4 to 37.2):
  // that word decides whether the pause counts. When the quiet ends first, the transcript has
  // pulled the next word back over the silence ("Sadly" from 35.55, quiet 35.6 to 37.6, the
  // word ends 37.9), so the word before it decides.
  function wordBefore(list, at, length) {
    const quietEnd = at + Math.max(0, numberOr0(length));
    let before = -1;
    list.forEach((word, index) => {
      const ended = word.end <= at + MILLISECOND;
      const endsInTheQuiet = word.start < at - MILLISECOND && word.end <= quietEnd + MILLISECOND;
      if (ended || endsInTheQuiet) {
        before = index;
      }
    });
    return before;
  }

  // wordBefore for a stored transcript, so Results draws each pause marker right after the word
  // that decided whether the pause counts.
  function wordBeforePause(words, at, length) {
    return wordBefore(toWords(words), at, length);
  }

  // The longest stretch of speech with no filler, no counted pause (mid-sentence, or 5 s+
  // anywhere) and no restart, as {start, end, seconds}. Every filler and break cuts the take;
  // a restart cuts from the first copy of the phrase to the moment the speaker starts it over.
  // `restarts` are the repeats as restartsOf reads them, in the same order.
  function longestCleanStretch(list, fillers, breaks, repeats, restarts) {
    const cuts = [
      ...fillers.map((event) => [event.start, event.end]),
      ...breaks.map((pause) => [pause.at, pause.at + pause.length]),
      ...repeatCuts(list, repeats, restarts),
    ].sort((a, b) => a[0] - b[0]);
    let best = { start: 0, end: 0, seconds: 0 };
    let from = list[0].start;
    const consider = (to) => {
      const seconds = roundToTenth(to - from);
      if (seconds > best.seconds) {
        best = { start: from, end: to, seconds };
      }
    };
    cuts.forEach(([cutStart, cutEnd]) => {
      consider(cutStart);
      from = Math.max(from, cutEnd);
    });
    consider(list[list.length - 1].end);
    return best;
  }

  // [first copy start, restart] for each backend repeat {text, at}. The restart is the first
  // word of the second copy restartOf found, the one Results underlines, so the words the
  // speaker abandoned between the copies ("day—") are cut too. When no second copy was found,
  // it is the first word after as many words as the phrase has, skipping hesitations as the
  // backend does; when no word starts at `at` either, the cut shrinks to that instant.
  function repeatCuts(list, repeats, restarts) {
    return repeats.map((repeat, order) => {
      const secondCopy = restarts[order].secondCopy;
      if (secondCopy.length > 0) {
        return [repeat.at, list[secondCopy[0]].start];
      }
      const first = list.findIndex((word) => Math.abs(word.start - repeat.at) < MILLISECOND);
      if (first === -1) {
        return [repeat.at, repeat.at];
      }
      let index = first;
      let counted = 0;
      while (index < list.length && (counted < repeat.words || isHesitation(list[index].text))) {
        if (!isHesitation(list[index].text)) {
          counted += 1;
        }
        index += 1;
      }
      return [repeat.at, index < list.length ? list[index].start : repeat.at];
    });
  }

  // A backend repeat as Results draws it: {at, text, secondCopy}, where secondCopy lists the
  // indexes of the words that say the phrase again (none when they cannot be found). Every kind
  // of repeat has the same {text, at}: `at` starts the first copy and `text` is that copy, so
  // the first copy is the phrase's words from `at` on. The second copy starts at the word after
  // it that says the most of the phrase (see copyMatch), the earliest on a tie, as backend
  // _cut_off_match picks it, so a false start on the same first word ("I, uh, I think") stays
  // plain. A free-talk repeat looks SECOND_COPY_SEARCH_WORDS words ahead; a script restart
  // (`fromScript`) can drop any number of words before it goes back, so it looks up to
  // `searchUntil`, where the next repeat begins (Infinity: to the end of the take). A copy that
  // says less than two words of a longer phrase is not one.
  function restartOf(pieces, repeat, searchUntil) {
    const restart = { at: repeat.at, text: repeat.text, secondCopy: [] };
    const phrase = phrasePiecesOf(repeat.text);
    const first = pieces.findIndex((piece) => piece.start >= repeat.at - MILLISECOND);
    const firstEnd = first + phrase.length - 1;
    if (phrase.length === 0 || first === -1 || firstEnd >= pieces.length) {
      return restart;
    }
    const isFragment = pieces[firstEnd].cutOff;
    const lastCandidate = repeat.fromScript
      ? pieces.length - 1
      : Math.min(pieces.length - 1, firstEnd + SECOND_COPY_SEARCH_WORDS);
    let best = { said: 0, slips: 0, from: -1, to: -1 };
    for (let from = firstEnd + 1; from <= lastCandidate; from += 1) {
      if (pieces[from].start > searchUntil + MILLISECOND) {
        break;
      }
      const match = copyMatch(pieces, from, phrase, isFragment);
      const better =
        match.said > best.said || (match.said === best.said && match.slips < best.slips);
      if (match.said > 0 && better) {
        best = { ...match, from };
      }
    }
    if (best.said >= Math.min(2, phrase.length)) {
      const indexes = pieces.slice(best.from, best.to + 1).map((piece) => piece.index);
      restart.secondCopy = [...new Set(indexes)];
    }
    return restart;
  }

  // How much of `phrase` the pieces from `from` on say again: {said, slips, to}. The first piece
  // must say the phrase's first word. Each next phrase word is said by the next piece, or by
  // the one after with one word inserted before it ("I'm going to— I am going"), or the next
  // piece misreads it when the piece after says the phrase word after ("the few choices a").
  // Inserted and misread words are slips; the walk stops at the first phrase word not said.
  // `to` is the last piece of the copy. The last phrase word is a cut-off fragment when
  // `isFragment`, so a word it begins finishes it ("ner—" then "nervous").
  function copyMatch(pieces, from, phrase, isFragment) {
    const says = (position, at) =>
      at < pieces.length &&
      saysAgain(phrase[position], pieces[at].token, isFragment && position === phrase.length - 1);
    if (!says(0, from)) {
      return { said: 0, slips: 0, to: from };
    }
    let said = 1;
    let slips = 0;
    let at = from + 1;
    for (let position = 1; position < phrase.length; position += 1) {
      if (says(position, at)) {
        said += 1;
        at += 1;
      } else if (says(position, at + 1)) {
        said += 1;
        slips += 1;
        at += 2;
      } else if (position + 1 < phrase.length && says(position + 1, at + 1)) {
        slips += 1;
        at += 1;
      } else {
        break;
      }
    }
    return { said, slips, to: at - 1 };
  }

  // The spoken words as the backend compares them for a repeat, as {index, token, start,
  // cutOff}: um, uh, hmm, mhm and bare punctuation ("—" said on its own) left out, and two words
  // joined by a dash ("bullying—the") split into two pieces of the same word, as
  // backend/script_align.py reads them. `index` is the word's place in the transcript;
  // `cutOff` says the word ends in a cut-off dash ("ner—").
  function repeatPieces(list) {
    return list.flatMap((word, index) => {
      const token = normalizeWord(word.text);
      if (token === "" || isRepeatSkip(token)) {
        return [];
      }
      const parts = isHesitation(word.text) ? [token] : token.split(JOINING_DASH);
      const cutOff = CUTOFF_MARK.test(word.text);
      return parts
        .filter(Boolean)
        .map((part) => ({ index, token: straightApostrophes(part), start: word.start, cutOff }));
    });
  }

  // A repeat's text as the same pieces: "bullying the fear", or "well-known fact" in two.
  function phrasePiecesOf(text) {
    return text
      .split(" ")
      .flatMap((word) => normalizeWord(word).split(JOINING_DASH))
      .filter(Boolean)
      .map(straightApostrophes);
  }

  function straightApostrophes(token) {
    return token.replace(/[‘’]/g, "'");
  }

  // Whether `said` says `token` again, as backend says_again: the same stem, or the cut-off
  // fragment finished ("sa—" then "says").
  function saysAgain(token, said, isFragment) {
    if (stem(said) === stem(token)) {
      return true;
    }
    return isFragment && token.length >= CUTOFF_MIN_FRAGMENT_LETTERS && said.startsWith(token);
  }

  // A normalized word without its contraction or plural ending: "I'm" -> "i".
  function stem(token) {
    const bare = token.replace(CONTRACTION, "");
    return bare.length > 3 && bare.endsWith("s") && !bare.endsWith("ss") ? bare.slice(0, -1) : bare;
  }

  // Each repeat drawn on Results (see restartOf), in the backend's order. A script restart
  // searches up to where the next repeat begins.
  function restartsOf(list, repeats) {
    const pieces = repeatPieces(list);
    return repeats.map((repeat) => {
      const later = repeats.filter((other) => other.at > repeat.at + MILLISECOND);
      const searchUntil = Math.min(Infinity, ...later.map((other) => other.at));
      return restartOf(pieces, repeat, searchUntil);
    });
  }

  // The script words a take read from a script did not read as written (metrics.script, from
  // backend/script_align.py): `misreads` as {at, word, said, wordIndex}, where `word` is the
  // script word, `said` what was said in its place and `wordIndex` the transcript index of the
  // word that said it (-1 when no word does); `skips` as {at, word}, where `at` is where the
  // skipped word belonged: the end of the word said before it, or the start of the take. An
  // entry without a numeric `at` and a text `word` (and, for a misread, `said`) is left out, and
  // a take without a script block has neither.
  function scriptSlipsOf(list, script) {
    const block = isScriptBlock(script) ? script : {};
    const misreads = (Array.isArray(block.misread) ? block.misread : [])
      .filter((slip) => isSlip(slip) && typeof slip.said === "string")
      .map((slip) => ({
        at: slip.at,
        word: slip.word,
        said: slip.said,
        wordIndex: wordSaying(list, slip.at, slip.said),
      }));
    const skips = (Array.isArray(block.skipped) ? block.skipped : [])
      .filter(isSlip)
      .map((slip) => ({ at: slip.at, word: slip.word }));
    return { misreads, skips };
  }

  function isSlip(slip) {
    return Boolean(slip) && isFiniteNumber(slip.at) && typeof slip.word === "string";
  }

  // True when the take's metrics carry a script block: the backend lined the take up against
  // the script it was sent and found that the take follows it. Free talk has no block, and nor
  // has a take that strays from its script (backend/script_align.py MIN_SCRIPT_FOLLOWED_SHARE),
  // which the backend scores as free talk: its misreads and skips are empty, as a flawless
  // read's are, so the report's followedScript tells the two apart.
  function isScriptBlock(script) {
    return Boolean(script) && typeof script === "object" && !Array.isArray(script);
  }

  // The index of the word starting at `at` that says `said`: the whole word, or one of the two
  // halves of a dash-joined word ("short-endure,"), which the alignment reads as two. -1 when
  // no word does.
  function wordSaying(list, at, said) {
    const token = straightApostrophes(normalizeWord(said));
    return list.findIndex((word) => {
      if (Math.abs(word.start - at) >= MILLISECOND) {
        return false;
      }
      const whole = straightApostrophes(normalizeWord(word.text));
      return whole === token || whole.split(JOINING_DASH).includes(token);
    });
  }

  // The backend's repeats as {at, text, words, fromScript}, skipping any entry without a
  // numeric `at`. `fromScript` marks a script restart: one metrics.script.restarts also lists.
  function validRepeats(repeats, script) {
    if (!Array.isArray(repeats)) {
      return [];
    }
    const scriptRestarts = script && Array.isArray(script.restarts) ? script.restarts : [];
    return repeats
      .filter((repeat) => repeat && isFiniteNumber(repeat.at))
      .map((repeat) => {
        const text = String(repeat.text || "");
        return {
          at: repeat.at,
          text,
          words: Math.max(1, text.split(" ").filter(Boolean).length),
          fromScript: scriptRestarts.some(
            (restart) => restart && restart.at === repeat.at && restart.text === repeat.text,
          ),
        };
      });
  }

  // A copy of the word list where every entry has a string text and numeric times, so one
  // malformed entry can never throw; indexes stay aligned with the stored transcript.
  function toWords(words) {
    return (Array.isArray(words) ? words : []).map((word) => ({
      text: String((word && word.text) || ""),
      start: numberOr0(word && word.start),
      end: numberOr0(word && word.end),
    }));
  }

  // Only [number, number] pairs are pauses; anything else in the list is skipped.
  function pausePairs(list) {
    if (!Array.isArray(list)) {
      return [];
    }
    return list.filter(isPausePair).map((pause) => [pause[0], pause[1]]);
  }

  function isPausePair(pause) {
    return Array.isArray(pause) && isFiniteNumber(pause[0]) && isFiniteNumber(pause[1]);
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function perMinute(count, seconds) {
    return seconds > 0 ? roundToTenth(count / (seconds / SECONDS_PER_MINUTE)) : 0;
  }

  function longest(values) {
    return values.length > 0 ? roundToTenth(Math.max(...values)) : 0;
  }

  function roundToTenth(value) {
    return Math.round(value * 10) / 10;
  }

  function roundToMillisecond(value) {
    return Math.round(value * 1000) / 1000;
  }

  // A live pace tracker for one take, at the microphone's `sampleRate` in Hz (8000 or more, a
  // RangeError otherwise). push(samples) takes each block of samples as it arrives: a
  // Float32Array of any length, read at once and never held (only the last LIVE_KEPT_SECONDS of
  // band-passed audio stay). peaks() is a copy of the syllable peaks found so far, in seconds
  // from the first sample pushed; seconds() is the audio pushed so far. read(at) is what the
  // live row shows at `at` seconds (the audio pushed so far when left out), {wpm, cue} as
  // nextLiveReading gives them, read about once a second and in time order. options.band is the
  // entry's [lo, hi] the cue compares with; options.factor is the speaker's words a peak for
  // the take's mode (LIVE_PACE_FACTOR when missing).
  function livePace(sampleRate, options) {
    if (!isFiniteNumber(sampleRate) || sampleRate < LIVE_MIN_SAMPLE_RATE) {
      throw new RangeError(
        "livePace needs a sample rate of " + LIVE_MIN_SAMPLE_RATE + " Hz or more",
      );
    }
    const given = options && typeof options === "object" ? options : {};
    const factor = paceFactorOf(given.factor);
    const peaks = [];
    const detector = peakDetector(sampleRate, (seconds) => peaks.push(seconds));
    let reading = null;
    function read(at) {
      const now = at === undefined ? detector.seconds() : at;
      const heard = peaks.filter((peak) => peak <= now);
      reading = nextLiveReading(reading, {
        at: now,
        estimate: livePaceAt(heard, now, factor),
        quietSeconds: heard.length > 0 ? now - heard[heard.length - 1] : Infinity,
        band: given.band,
      });
      return { wpm: reading.wpm, cue: reading.cue };
    }
    return {
      push: detector.push,
      peaks: () => peaks.slice(),
      seconds: detector.seconds,
      read,
    };
  }

  // The streaming half of livePace: each sample is band-passed and its energy summed into 8 ms
  // hops; each new 32 ms window brings the window LIVE_LOOKAHEAD_HOPS before it up for a
  // decision, and `found(seconds)` hears every one that is a syllable peak, at the window's
  // middle. Every decision uses only the audio up to it, so a peak is known some 40 ms after
  // its middle.
  function peakDetector(sampleRate, found) {
    const highPass = biquad("highpass", sampleRate, LIVE_LOW_HZ);
    const lowPass = biquad(
      "lowpass",
      sampleRate,
      Math.min(LIVE_HIGH_HZ, sampleRate * LIVE_HIGH_MAX_SHARE_OF_RATE),
    );
    const hop = Math.round(sampleRate * LIVE_HOP_SECONDS);
    const windowSamples = hop * LIVE_HOPS_PER_WINDOW;
    const recent = new Float32Array(powerOfTwoAtLeast(sampleRate * LIVE_KEPT_SECONDS));
    const recentMask = recent.length - 1;
    const hopEnergies = new Float64Array(LIVE_HOPS_PER_WINDOW);
    // The levels of the latest windows: the one being decided and LIVE_LOOKAHEAD_HOPS each side.
    const levels = new Float64Array(2 * LIVE_LOOKAHEAD_HOPS + 1);
    const histogram = new Uint32Array(Math.round((LIVE_CEILING_DB - LIVE_FLOOR_DB) / LIVE_BIN_DB));
    const voicing = voicingCheck(sampleRate, recent);
    let pushed = 0;
    let hopEnergy = 0;
    let hopFill = 0;
    let hops = 0;
    let windows = 0;
    let anyPeak = false;
    let quietestSincePeak = Infinity;

    function push(samples) {
      const count = samples && samples.length > 0 ? samples.length : 0;
      for (let i = 0; i < count; i += 1) {
        // A value that is not a finite number (never one from a microphone) reads as silence,
        // so it cannot poison the filters for the rest of the take.
        const raw = samples[i];
        const value = lowPass(highPass(raw - raw === 0 ? raw : 0));
        recent[pushed & recentMask] = value;
        pushed += 1;
        hopEnergy += value * value;
        hopFill += 1;
        if (hopFill === hop) {
          endHop();
        }
      }
    }

    function endHop() {
      hopEnergies[hops % LIVE_HOPS_PER_WINDOW] = hopEnergy;
      hops += 1;
      hopEnergy = 0;
      hopFill = 0;
      if (hops >= LIVE_HOPS_PER_WINDOW) {
        const energy = hopEnergies.reduce((sum, value) => sum + value, 0);
        addWindow(levelOf(energy / windowSamples));
      }
    }

    // Window n covers hops n to n + 3; its look-ahead is complete once window n + 3 is in.
    function addWindow(level) {
      levels[windows % levels.length] = level;
      histogram[binOf(level, histogram.length)] += 1;
      windows += 1;
      const candidate = windows - 1 - LIVE_LOOKAHEAD_HOPS;
      if (candidate >= LIVE_LOOKAHEAD_HOPS) {
        decide(candidate);
      }
    }

    function levelAt(index) {
      return levels[index % levels.length];
    }

    function decide(index) {
      const level = levelAt(index);
      quietestSincePeak = Math.min(quietestSincePeak, level);
      const last = index + LIVE_LOOKAHEAD_HOPS;
      for (let other = index - LIVE_LOOKAHEAD_HOPS; other <= last; other += 1) {
        if (other !== index && levelAt(other) > level) {
          return;
        }
      }
      if (level < medianLevel(histogram, windows) + LIVE_ABOVE_MEDIAN_DB) {
        return;
      }
      if (anyPeak && level - quietestSincePeak < LIVE_MIN_DIP_DB) {
        return;
      }
      const middle = index * hop + windowSamples / 2;
      if (!voicing(middle)) {
        return;
      }
      anyPeak = true;
      quietestSincePeak = level;
      found(middle / sampleRate);
    }

    return { push, seconds: () => pushed / sampleRate };
  }

  // Whether the band-passed audio around sample `middle` (held in `recent`, a ring indexed by
  // sample number) is voiced: its normalized autocorrelation over LIVE_VOICING_SECONDS reaches
  // LIVE_MIN_VOICING at a lag inside the pitch range. Running sums of squares give each lag's
  // two energies at once.
  function voicingCheck(sampleRate, recent) {
    const mask = recent.length - 1;
    const half = Math.round((sampleRate * LIVE_VOICING_SECONDS) / 2);
    const length = 2 * half;
    const minLag = Math.round(sampleRate / LIVE_PITCH_HIGH_HZ);
    const maxLag = Math.min(length - 1, Math.round(sampleRate / LIVE_PITCH_LOW_HZ));
    const stretch = new Float64Array(length);
    const squares = new Float64Array(length + 1);
    return (middle) => {
      const from = middle - half;
      for (let i = 0; i < length; i += 1) {
        const value = recent[(from + i) & mask];
        stretch[i] = value;
        squares[i + 1] = squares[i] + value * value;
      }
      for (let lag = minLag; lag <= maxLag; lag += 1) {
        const overlap = length - lag;
        let product = 0;
        for (let i = 0; i < overlap; i += 1) {
          product += stretch[i] * stretch[i + lag];
        }
        const energies = squares[overlap] * (squares[length] - squares[lag]);
        if (energies > 0 && product / Math.sqrt(energies) >= LIVE_MIN_VOICING) {
          return true;
        }
      }
      return false;
    };
  }

  // A second-order filter from the RBJ audio cookbook, "highpass" or "lowpass" at `hz` with a Q
  // of 1/sqrt(2), as a function from each sample to the filtered sample, keeping its own state.
  function biquad(type, sampleRate, hz) {
    const w0 = (2 * Math.PI * hz) / sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) * Math.SQRT1_2;
    const a0 = 1 + alpha;
    const edge = (type === "highpass" ? 1 + cos : 1 - cos) / 2 / a0;
    const b0 = edge;
    const b1 = (type === "highpass" ? -2 : 2) * edge;
    const b2 = edge;
    const a1 = (-2 * cos) / a0;
    const a2 = (1 - alpha) / a0;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    return (x) => {
      let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      // Compared both ways rather than through Math.abs: this runs twice for every sample.
      if (y < LIVE_FLUSH_BELOW && y > -LIVE_FLUSH_BELOW) {
        y = 0;
      }
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      return y;
    };
  }

  function powerOfTwoAtLeast(value) {
    let size = 1;
    while (size < value) {
      size *= 2;
    }
    return size;
  }

  // A window's loudness in dB from its mean square, never under LIVE_FLOOR_DB (a silent window's
  // log is minus infinity).
  function levelOf(meanSquare) {
    return Math.max(LIVE_FLOOR_DB, 10 * Math.log10(meanSquare));
  }

  function binOf(level, bins) {
    return Math.min(bins - 1, Math.max(0, Math.floor((level - LIVE_FLOOR_DB) / LIVE_BIN_DB)));
  }

  // The median of the `count` levels counted in `histogram`, as the middle of its bin.
  function medianLevel(histogram, count) {
    const rank = Math.floor(count / 2);
    let seen = 0;
    for (let bin = 0; bin < histogram.length; bin += 1) {
      seen += histogram[bin];
      if (seen > rank) {
        return LIVE_FLOOR_DB + (bin + 0.5) * LIVE_BIN_DB;
      }
    }
    return LIVE_CEILING_DB;
  }

  // The live estimate at `at` seconds from syllable peak times (seconds, in order): words a
  // minute over the trailing LIVE_WINDOW_SECONDS of speech, or over all the speech since it
  // started while that is shorter, the peak speech starts at left out since it only starts the
  // clock. Speech time is the clock's time with every silence cut to LIVE_SILENCE_SECONDS (see
  // speechAges). Peaks after `at` are left out. Null until there are LIVE_MIN_SPEECH_SECONDS
  // of speech. Unrounded; `factor` is words a peak, read through paceFactorOf.
  function livePaceAt(peaks, at, factor) {
    if (!isFiniteNumber(at)) {
      return null;
    }
    const times = Array.isArray(peaks)
      ? peaks.filter((time) => isFiniteNumber(time) && time <= at)
      : [];
    const start = speechStartIndex(times);
    if (start === -1) {
      return null;
    }
    const ages = speechAges(times, start, at);
    if (ages[0] < LIVE_MIN_SPEECH_SECONDS) {
      return null;
    }
    const seconds = Math.min(LIVE_WINDOW_SECONDS, ages[0]);
    const counted = ages.filter((age, index) => index > 0 && age < seconds);
    return perMinuteExact(counted.length * paceFactorOf(factor), seconds);
  }

  // How long before `at` each peak from times[start] on came, in seconds of speech: the clock's
  // time less every silence's time beyond LIVE_SILENCE_SECONDS, whether the silence falls
  // between two peaks or after the last. The row keeps its value through such a silence, so
  // the number after it goes on from that value instead of counting the pause as slow speech.
  function speechAges(times, start, at) {
    const last = times.length - 1;
    const ages = [];
    let leftOut = Math.max(0, at - times[last] - LIVE_SILENCE_SECONDS);
    for (let index = last; index >= start; index -= 1) {
      if (index < last) {
        leftOut += Math.max(0, times[index + 1] - times[index] - LIVE_SILENCE_SECONDS);
      }
      ages[index - start] = at - times[index] - leftOut;
    }
    return ages;
  }

  // The index of the peak speech starts at: the first that LIVE_SPEECH_RUN_PEAKS more follow
  // within LIVE_SPEECH_RUN_SECONDS, or -1 while none has. Once found it never moves: a later
  // peak cannot fall within the run of an earlier one.
  function speechStartIndex(times) {
    for (let i = 0; i + LIVE_SPEECH_RUN_PEAKS < times.length; i += 1) {
      if (times[i + LIVE_SPEECH_RUN_PEAKS] - times[i] <= LIVE_SPEECH_RUN_SECONDS) {
        return i;
      }
    }
    return -1;
  }

  // The live row's next state, from the one before (null at the start of a take) and one read:
  // `at` in seconds, `estimate` livePaceAt's words a minute (null until there is enough
  // speech), `quietSeconds` the time since the latest peak and `band` the entry's [lo, hi].
  // Returns {wpm, cue, pendingCue, pendingSince}: `wpm` the number to show, rounded to
  // LIVE_ROUND_TO_WPM, or null until there is one; `cue` "on-target", "slow-down" or
  // "speed-up", null without a number or a valid band. The first number shows the cue it calls
  // for; after that the cue changes only once the number has called for another one for
  // LIVE_CUE_HOLD_SECONDS, less LIVE_CUE_HOLD_SLACK_SECONDS, the cue it calls for held in
  // `pendingCue` since `pendingSince`. A silence over LIVE_SILENCE_SECONDS keeps the state as it
  // was.
  function nextLiveReading(previous, sample) {
    const state = previous || { wpm: null, cue: null, pendingCue: null, pendingSince: null };
    const { at, estimate, quietSeconds, band } = sample || {};
    const silent = typeof quietSeconds === "number" && quietSeconds > LIVE_SILENCE_SECONDS;
    if (silent || !isFiniteNumber(estimate) || !isFiniteNumber(at)) {
      return state;
    }
    const wpm = Math.round(estimate / LIVE_ROUND_TO_WPM) * LIVE_ROUND_TO_WPM;
    const range = bandOf(band);
    if (range === null) {
      return { wpm, cue: null, pendingCue: null, pendingSince: null };
    }
    const called = cueFor(wpm, range);
    const cue = state.cue === null ? called : state.cue;
    if (called === cue) {
      return { wpm, cue, pendingCue: null, pendingSince: null };
    }
    const since = state.pendingCue === called ? state.pendingSince : at;
    if (at - since >= LIVE_CUE_HOLD_SECONDS - LIVE_CUE_HOLD_SLACK_SECONDS) {
      return { wpm, cue: called, pendingCue: null, pendingSince: null };
    }
    return { wpm, cue, pendingCue: called, pendingSince: since };
  }

  // The cue a number calls for against the band [lo, hi]: Slow down or Speed up only when it is
  // more than LIVE_CUE_MARGIN_WPM outside.
  function cueFor(wpm, [lo, hi]) {
    if (wpm > hi + LIVE_CUE_MARGIN_WPM) {
      return SLOW_DOWN;
    }
    if (wpm < lo - LIVE_CUE_MARGIN_WPM) {
      return SPEED_UP;
    }
    return ON_TARGET;
  }

  // [lo, hi] for two numbers in order, else null.
  function bandOf(band) {
    const valid =
      Array.isArray(band) &&
      band.length === 2 &&
      isFiniteNumber(band[0]) &&
      isFiniteNumber(band[1]) &&
      band[0] <= band[1];
    return valid ? [band[0], band[1]] : null;
  }

  // Words a peak as the estimate uses it: a number kept within PACE_FACTOR_MIN and
  // PACE_FACTOR_MAX, or LIVE_PACE_FACTOR for anything else (nothing kept yet).
  function paceFactorOf(value) {
    if (!isFiniteNumber(value)) {
      return LIVE_PACE_FACTOR;
    }
    return Math.min(PACE_FACTOR_MAX, Math.max(PACE_FACTOR_MIN, value));
  }

  // The words-a-peak factor after a take, for the take's mode: `factor` (the speaker's kept one,
  // read through paceFactorOf) moved PACE_FACTOR_WEIGHT of the way to the take's own words over
  // peaks, that ratio kept within the same bounds, to a thousandth. Words are the transcript's
  // without hesitation sounds, as Results counts pace; peaks are the tracker's inside the speech,
  // the first word's start to the last word's end, give or take PACE_FACTOR_EDGE_SECONDS. A take
  // that does not count (countsForPaceFactor) leaves the factor as it was.
  function paceFactorAfter(factor, words, peaks) {
    const kept = paceFactorOf(factor);
    const take = paceTakeOf(words, peaks);
    if (take === null) {
      return kept;
    }
    const own = paceFactorOf(take.words / take.peaks);
    return Math.round((kept + PACE_FACTOR_WEIGHT * (own - kept)) * 1000) / 1000;
  }

  // Whether a take counts toward its mode's factor: PACE_FACTOR_MIN_SECONDS of speech or more,
  // PACE_FACTOR_MIN_WORDS words or more without hesitation sounds, and a peak in its speech, as
  // paceFactorAfter reads them. A take that counts may still give the factor back unmoved, to
  // the thousandth, so a caller asks this to know whether its mode has been tuned.
  function countsForPaceFactor(words, peaks) {
    return paceTakeOf(words, peaks) !== null;
  }

  // A take's words without hesitation sounds and its peaks inside the speech, {words, peaks},
  // when it counts toward the factor; null when it does not.
  function paceTakeOf(words, peaks) {
    const list = toWords(words);
    if (list.length === 0) {
      return null;
    }
    const first = list[0].start;
    const last = list[list.length - 1].end;
    const counted = list.filter((word) => !isHesitation(word.text)).length;
    const inSpeech = (Array.isArray(peaks) ? peaks : []).filter(
      (time) =>
        isFiniteNumber(time) &&
        time >= first - PACE_FACTOR_EDGE_SECONDS &&
        time <= last + PACE_FACTOR_EDGE_SECONDS,
    ).length;
    const counts =
      last - first >= PACE_FACTOR_MIN_SECONDS && counted >= PACE_FACTOR_MIN_WORDS && inSpeech > 0;
    return counts ? { words: counted, peaks: inSpeech } : null;
  }

  // `count` a minute over `seconds`, unrounded.
  function perMinuteExact(count, seconds) {
    return (count * SECONDS_PER_MINUTE) / seconds;
  }

  app.delivery = {
    analyze,
    classify,
    findStumbles,
    findUnclear,
    isHesitation,
    isCountedPause,
    isLongPause,
    wordBeforePause,
    livePace,
    livePaceAt,
    nextLiveReading,
    paceFactorAfter,
    countsForPaceFactor,
    HESITATION,
    HABIT,
    ON_TARGET,
    SLOW_DOWN,
    SPEED_UP,
    HABIT_WORDS,
    LONG_PAUSE_SECONDS,
    UNCLEAR_CONFIDENCE,
    MAX_UNCLEAR_WORDS,
    LIVE_PACE_FACTOR,
  };
})();
