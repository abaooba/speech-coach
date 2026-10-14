/* path.js: app.path, the Loop Path (docs/superpowers/specs/2026-10-14-loop-path.md): four units
   of five levels, each a loop of goal, take 1, review and take 2, which counts, beside
   check-backs, crowns, checkpoints and a benchmark. It holds their data and rules: measures,
   baseline, guards, evaluate and unlocking. Pure: no DOM, store, clock or Math.random. */
(function () {
  "use strict";

  // --- Plays, statuses and materials -----------------------------------------------------------

  // A play is one thing started from the Path; its id is the route id (spec section 1): a level
  // loop ("fillers-3"), a check-back of a cleared level ("fillers-3_checkback"), a crown
  // ("fillers_crown"), a unit checkpoint ("fillers_checkpoint") or the benchmark ("benchmark").
  const LOOP = "loop";
  const CHECKBACK = "checkback";
  const CROWN = "crown";
  const CHECKPOINT = "checkpoint";
  const BENCHMARK = "benchmark";
  const CHECKBACK_SUFFIX = "_checkback";
  const CROWN_SUFFIX = "_crown";
  const CHECKPOINT_SUFFIX = "_checkpoint";
  // The record kept beside a checkpoint's own when it was cleared with someone listening.
  const IN_THE_ROOM_SUFFIX = "_room";
  // The records a passed check-back keeps: "<level>_cb1" for the first, "<level>_cb2" for the
  // second, which turns the node gold.
  const CHECKBACK_RECORD = "_cb";

  // A level on the path is cleared, current (open to play, not cleared yet), locked, or resting:
  // open, but its scored attempts for today are spent, so it reads "Back tomorrow".
  const CLEARED = "cleared";
  const CURRENT = "current";
  const LOCKED = "locked";
  const RESTING = "resting";

  // A cleared level's ring: none yet, half once its first check-back passes, gold ("Locked in")
  // once its second does.
  const NO_RING = "none";
  const HALF_RING = "half";
  const GOLD_RING = "gold";

  // What a play is said or read on (spec section 3). A loop keeps one material for every take;
  // a check-back, checkpoint or crown always starts on new material.
  const YOUR_DAY = "your-day"; // Practice's "Your day" prompt, on a topic pickTopic picks
  const IMPROMPTU = "impromptu"; // Practice's Impromptu prompt, on a topic pickTopic picks
  const NEW_TOPIC = "new-topic"; // an Impromptu topic no take has used yet
  const COLD_READ = "cold-read"; // a passage the speaker has never read (pickColdRead)
  const LADDER = "ladder"; // the ladder passage, read at a set pace
  const BENCHMARK_MATERIAL = "benchmark"; // app.passages.benchmark(): one read, then one talk
  const YOUR_DAY_PROMPT_ID = "free-talk";
  const IMPROMPTU_PROMPT_ID = "impromptu";
  const LADDER_PASSAGE_ID = "rebuttal-uniforms";

  const SECONDS_PER_MINUTE = 60;
  // Word times are in seconds to the millisecond; two times closer than this are the same moment.
  const MILLISECOND = 0.001;

  // A cold read lasts a minute and a half: the longest (192 words) takes 82 s at 140 wpm, the
  // slow edge of the cold reads' band. The benchmark read is held to the same time.
  const COLD_READ_SECONDS = 90;
  // A check-back on a new topic lasts a minute and a half (Fillers levels 1 and 2 excepted).
  const NEW_TOPIC_CHECKBACK_SECONDS = 90;
  // The benchmark talk's time, as app.passages.benchmark() sets it.
  const BENCHMARK_TALK_SECONDS = 90;
  // A ladder read is held to a pace within this many wpm of its target.
  const SPEED_TOLERANCE_WPM = 10;
  const DEFAULT_TARGET_WPM = [140, 160];

  // A reading take that leaves out more script words than this in one place did not read the
  // passage through: it stopped early or started partway in. Results draws a longer run of
  // skipped words as one marker for the same reason (screens/results.js).
  const MAX_SKIPPED_IN_ONE_PLACE = 8;

  // The units' ids, in the order select.py's MEASURED_SKILLS lists their skills.
  const UNIT_IDS = ["restarts", "fillers", "long-pauses", "pace"];

  // rank.js's slip weights, without misreads and skips: what one slip costs, counted in fillers.
  // Kept here so path.js loads on its own; change the two together.
  const FILLER_WEIGHT = 1;
  const RESTART_WEIGHT = 1.5;
  const SHORT_MID_PAUSE_WEIGHT = 1;
  const LONG_PAUSE_WEIGHT = 3;

  // --- Guards (spec section 2) -----------------------------------------------------------------

  // Every scored take must also pass the guards its play lists, so nobody clears a level by
  // saying very little, by crawling, or by swapping one slip for another. talkShare: a talk take
  // fills 80% of its set seconds. minWpm: at least 120 wpm. steadyOtherSlips: the weighted slips
  // the unit does not train rise no more than 1 a minute over the speaker's usual. readThrough: a
  // reading take followed its passage and skipped no more than 8 script words in one place.
  const TALK_SHARE = "talkShare";
  const MIN_WPM = "minWpm";
  const STEADY_OTHER_SLIPS = "steadyOtherSlips";
  const READ_THROUGH = "readThrough";
  const MIN_TALK_SHARE = 0.8;
  const MIN_PACE_WPM = 120;
  const OTHER_SLIPS_ALLOWANCE = 1;

  // What a failed guard asks of the next take, when the speaker chose no fix of their own.
  const GUARD_FIXES = Object.freeze({
    [TALK_SHARE]: "Keep talking until the time bar fills",
    [MIN_WPM]: "Keep a pace of at least " + MIN_PACE_WPM + " wpm",
    [STEADY_OTHER_SLIPS]: "Keep your other slips near your usual",
    [READ_THROUGH]: "Read every word, as written",
  });

  // The guards each kind of take checks. A rule that already holds every weighted slip at or
  // under the baseline (the checkpoints and Pace level 5) needs no steadyOtherSlips, and the
  // Pace unit, which trains speed itself, has no minWpm.
  const TALK_GUARDS = [TALK_SHARE, MIN_WPM, STEADY_OTHER_SLIPS];
  const READ_GUARDS = [READ_THROUGH, MIN_WPM, STEADY_OTHER_SLIPS];
  const PACE_READ_GUARDS = [READ_THROUGH, STEADY_OTHER_SLIPS];
  const PACE_TALK_GUARDS = [TALK_SHARE, STEADY_OTHER_SLIPS];
  const ALL_SLIPS_TALK_GUARDS = [TALK_SHARE, MIN_WPM];
  const ALL_SLIPS_PACE_GUARDS = [TALK_SHARE];

  const NO_SPEECH = "No speech was found in this take.";
  // How a detail ends when it says what clears the level.
  const TO_CLEAR_THIS_LEVEL = " to clear this level.";
  // A reading take the backend found does not follow its passage (talk, another text, or a few
  // lines read and then ad-libbed) reports no script slips, just as a flawless read does.
  const NOT_FOLLOWED =
    "This take did not follow the passage. Read it as written" + TO_CLEAR_THIS_LEVEL;
  // What a take shows in place of its number when it has none to show.
  const NO_VALUE = "—";

  // --- Rules -----------------------------------------------------------------------------------

  // A rule is a list of conditions, the first its headline. Each holds one measure() key to a
  // bound: at most `max`, at least `min`, or inside `band` [lo, hi] with both edges in. USUAL as
  // a bound is the baseline's own number; TAKE_BAND is the band of the take being judged.
  // Values and bounds compare at a tenth, as they are shown.
  const USUAL = "usual";
  const TAKE_BAND = "take";
  const AT_MOST = "max";
  const AT_LEAST = "min";
  const IN_BAND = "band";

  function atMost(measureKey, max) {
    return { measure: measureKey, max };
  }

  function atLeast(measureKey, min) {
    return { measure: measureKey, min };
  }

  function inTakeBand() {
    return { measure: "wpm", band: TAKE_BAND };
  }

  // Fillers level 1: at most halfway from the speaker's usual rate down to `max`, or `max` itself
  // for a speaker already at or under it.
  function halfwayToward(max) {
    return { measure: "fillersPerMinute", max, halfwayFromUsual: true };
  }

  // --- Crowns ----------------------------------------------------------------------------------

  // The Fillers crown is sudden death: the run is the time from the first word to the first
  // filler or restart, and each tier asks for a longer one. A tier's take runs this long past
  // its target, so a slow first word, or stopping as Practice's time bar fills, never costs a
  // run that reached the target.
  const SUDDEN_DEATH = "suddenDeath";
  const RUN_TARGETS_SECONDS = [30, 45, 60, 90, 120];
  const RUN_HEADROOM_SECONDS = 15;
  // The Pace crown is the speed ladder: the ladder passage read at 180 wpm, give or take 10,
  // with at most 1 restart.
  const SPEED_LADDER = "speedLadder";
  const LADDER_CROWN = Object.freeze({ wpm: 180, maxRestarts: 1 });
  // How a crown's verdict ends, where a level's says "Level cleared".
  const CROWN_EARNED = "Crown earned";
  const TO_EARN_THIS_CROWN = " to earn this crown.";

  // --- Checkpoints, the benchmark and the order ------------------------------------------------

  // Every unit ends in a checkpoint after level 5: 2 minutes on a new topic, which may be
  // recorded with someone listening in the room.
  const CHECKPOINT_SECONDS = 120;
  const CHECKPOINT_LABEL = "Checkpoint: 2-minute new topic";
  const BENCHMARK_GOAL = Object.freeze({
    headline: "One read, one talk",
    unitLabel: "the same passage and prompt every 14 days",
    length: "About 3 minutes",
    short: "Every 14 days",
  });

  // The weakness ranking mirrors backend/advice/select.py weakest_skills and
  // distances_from_target, with the same targets, so the path leads with the skill the coach's
  // advice is about. Change the two together.
  const RESTARTS_PER_MINUTE_TARGET = 1;
  const FILLERS_PER_MINUTE_TARGET = 3;
  const LONG_PAUSES_TARGET = 0;
  const NONE_AT_ALL = -1;
  const TIE_DECIMALS = 9;
  // The units follow the speaker's latest takes, this many, so a habit the speaker has since
  // fixed stops leading the path. Each take counts for its speaking time (see order), so a few
  // seconds of a take the speaker gave up on cannot reorder it. The baseline reads as many.
  const RECENT_TAKES = 5;
  // Fillers level 1 lists the speaker's most used fillers, this many.
  const TOP_FILLERS = 3;

  // --- The schedule (spec sections 4 and 5) ----------------------------------------------------

  // A loop allows this many scored attempts a local day: the first scored take, "Try take 3"
  // and "Try take 4". After that it rests until tomorrow.
  const ATTEMPTS_PER_DAY = 3;
  // A cleared level's first check-back is due this many days after it was cleared, its second
  // this many after, or this many after the first passed if that is later. A missed one is due
  // again this many days after the miss.
  const FIRST_CHECKBACK_DAYS = 2;
  const SECOND_CHECKBACK_DAYS = 7;
  const AFTER_FIRST_CHECKBACK_DAYS = 2;
  const AFTER_A_MISS_DAYS = 2;
  // A unit's crown opens once this level is cleared; its checkpoint once its last level is.
  const CROWN_OPENS_AFTER_LEVEL = 3;
  // The benchmark comes round this many days after its latest sitting. Its takes are saved with
  // the ids of app.passages.benchmark()'s read and talk.
  const BENCHMARK_EVERY_DAYS = 14;
  const BENCHMARK_READ_ID = "benchmark-read";
  const BENCHMARK_TALK_ID = "benchmark-talk";
  // The week's goal: practice on this many of its days, Monday to Sunday.
  const WEEK_GOAL_DAYS = 4;
  const DAYS_PER_WEEK = 7;
  // A local calendar day as the schedule writes it, "2026-10-14".
  const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // --- Citations (spec "Unit cards and tips") --------------------------------------------------

  // The research library entries the path cites, as backend/advice/library.json holds them: the
  // source's author, title, publisher, year and url, and for a tip the advice word for word.
  // frontend/tests/path_citations.test.js checks every one against library.json.
  const LIBRARY = {
    "restart-021": {
      author: "Craig Lambert, Judit Kormos, Danny Minn",
      title: "Task Repetition and Second Language Speech Processing",
      publisher: "Studies in Second Language Acquisition (Cambridge University Press)",
      year: 2017,
      url:
        "https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/" +
        "article/abs/task-repetition-and-second-language-speech-processing/" +
        "0EA95A4C7D9E90CD2AB30043F84A4635",
    },
    "filler-085": {
      author: "Brittany Pawlik, Christopher J. Perrin",
      title: "Reducing speech disfluencies during public speaking using brief habit reversal",
      publisher: "Journal of Applied Behavior Analysis",
      year: 2020,
      url: "https://doi.org/10.1002/jaba.627",
    },
    "general-014": {
      author: "Mai Ngoc Tran, Kazuya Saito",
      title:
        "Effects of the 4/3/2 Activity Revisited: Extending Boers (2014) and Thai & Boers (2016)",
      publisher: "Language Teaching Research (accepted manuscript, UCL Discovery)",
      year: null,
      url: "https://discovery.ucl.ac.uk/10128571/1/LTR2021.pdf",
    },
    "pause-029": {
      author: "Hans Rutger Bosker, Anne-France Pinget, Hugo Quené, Ted Sanders, Nivja H. de Jong",
      title: "What makes speech sound fluent? The contributions of pauses, speed and repairs",
      publisher: "Language Testing (SAGE); Utrecht University research portal",
      year: 2013,
      url:
        "https://research-portal.uu.nl/en/publications/" +
        "what-makes-speech-sound-fluent-the-contributions-of-pauses-speed-/",
    },
    "filler-052": {
      author: "Claire Spieler, Raymond Miltenberger",
      title: "Using awareness training to decrease nervous habits during public speaking",
      publisher: "Journal of Applied Behavior Analysis (via MetaTOC)",
      year: 2017,
      url:
        "https://www.metatoc.com/papers/" +
        "91725-using-awareness-training-to-decrease-nervous-habits-during-public-speaking",
      advice:
        "Just learning to recognise your own filled pauses, tongue clicks and \"like\" can " +
        "reduce them, even without a replacement behavior. Expect to need refreshers, though. " +
        "In the study, booster sessions were needed for further gains.",
    },
    "filler-002": {
      author: "Lisa B. Marshall",
      title: "Um, How Do I Stop, Ya Know, Using Um and Ah?",
      publisher: "Toastmasters International (Toastmaster magazine)",
      year: 2017,
      url: "https://www.toastmasters.org/magazine/magazine-issues/2017/september-2017/umah",
      advice:
        "Most people don't realize how often they hesitate. Listening back to your own " +
        "recordings every day trains you to notice a filler just before you say it.",
    },
    "filler-069": {
      author: "Noah Zandan",
      title: "How to Stop Saying \"Um,\" \"Ah,\" and \"You Know\"",
      publisher: "Harvard Business Review",
      year: 2018,
      url: "https://hbr.org/2018/08/how-to-stop-saying-um-ah-and-you-know",
      advice:
        "Pair each crutch word with a small physical action, such as tapping your leg " +
        "whenever you say \"like\". The action makes the habit noticeable in the moment. Once " +
        "you can feel a filler coming, stay deliberately silent instead.",
    },
    "filler-026": {
      author: "Martin Corley, Robert J. Hartsuiker",
      title: "Why Um Helps Auditory Word Recognition: The Temporal Delay Hypothesis",
      publisher: "PLoS ONE",
      year: 2011,
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3097182",
      advice:
        "Listeners recognized the next word faster after any short delay, whether it was 'um' " +
        "or silence. A silent pause gives you the same benefit without the filler.",
    },
    "filler-024": {
      author: "Herbert H. Clark, Jean E. Fox Tree",
      title: "Using uh and um in spontaneous speaking",
      publisher: "Cognition",
      year: 2002,
      url: "http://www.columbia.edu/~rmk7/HC/HC_Readings/Clark_Fox.pdf",
      advice:
        "Research suggests 'uh' signals a short delay and 'um' a longer one. Lots of 'um' " +
        "means you're doing heavy planning mid-sentence, so plan the idea before you start " +
        "speaking.",
    },
    "restart-056": {
      author: "Karen Schaefer",
      title: "Voicing Your Script: Tips and Techniques",
      publisher: "Society of Environmental Journalists (hosted file)",
      year: 2012,
      url: "https://em.sej.org/sites/default/files/VoicingYourScript101912.pdf",
      advice:
        "Lots of stumbling usually means you are reading faster than you can handle. Slow " +
        "down until the passage comes out clean, then bring the speed back up a little at a " +
        "time.",
    },
    "restart-060": {
      author: "David M. Cheshier",
      title: "",
      publisher: "Rostrum",
      year: null,
      url: "https://www.uvm.edu/~debate/NFL/rostrumlib/cxCheshier0402.pdf",
      advice:
        "When reading quickly from a page, guide your eyes with a fingertip kept a word or two " +
        "ahead of what you are saying. This keeps your place and cuts down on stumbles from " +
        "skipping or misreading.",
    },
    "restart-009": {
      author: "Herbert H. Clark, Thomas Wasow",
      title: "Repeating Words in Spontaneous Speech",
      publisher: "Cognitive Psychology",
      year: 1998,
      url:
        "https://web.stanford.edu/~clark/1990s/" +
        "Clark,%20H.H.%20_%20Wasow,%20T.%20_Repeating%20words%20in%20spontaneous%20speaking_" +
        "%201998.pdf",
      advice:
        "Repeats usually happen on small opening words like 'I', 'the' or 'a', as in 'I uh I " +
        "wouldn't…'. If you catch yourself, pause silently before the phrase instead of " +
        "firing off its first word.",
    },
    "restart-025": {
      author: "Hans Rutger Bosker, Anne-France Pinget, Hugo Quené, Ted Sanders, Nivja H. De Jong",
      title: "What makes speech sound fluent? The contributions of pauses, speed and repairs",
      publisher: "Language Testing",
      year: 2013,
      url: "https://forms.mpi.nl/node/51306",
      advice:
        "Listeners' fluency judgments depend mostly on how you pause and how fast you go. " +
        "Occasional self-corrections count for surprisingly little, so a quick, clean repair " +
        "is better than freezing to avoid one.",
    },
    "restart-008": {
      author: "Herbert H. Clark, Thomas Wasow",
      title: "Repeating Words in Spontaneous Speech",
      publisher: "Cognitive Psychology",
      year: 1998,
      url:
        "https://web.stanford.edu/~clark/1990s/" +
        "Clark,%20H.H.%20_%20Wasow,%20T.%20_Repeating%20words%20in%20spontaneous%20speaking_" +
        "%201998.pdf",
      advice:
        "Research on everyday speech found people are more likely to start a phrase, stop, " +
        "and repeat its first word when the phrase is long or complex. Plan the whole phrase " +
        "before you commit to the first word.",
    },
    "long-053": {
      author: "Stanford Seed (interview with Matt Abrahams)",
      title: "How to 'Think Faster and Talk Smarter': a Masterclass with Matt Abrahams",
      publisher: "Stanford Graduate School of Business",
      year: 2023,
      url:
        "https://www.gsb.stanford.edu/insights/" +
        "how-think-faster-talk-smarter-masterclass-matt-abrahams",
      advice:
        "Keep a simple three-step template ready for on-the-spot answers: what the thing is, " +
        "why it matters, and what should happen next. Moving through fixed steps means you " +
        "always know what comes next and don't stall.",
    },
    "long-003": {
      author: "Allison Shapira",
      title: "What to do when your mind goes blank",
      publisher: "Allison Shapira",
      year: null,
      url: "https://allisonshapira.com/mind-goes-blank/",
      advice:
        "Blanks often happen where two ideas aren't connected. Build a clear bridge from each " +
        "point to the next.",
    },
    "long-049": {
      author: "Greg Lewis",
      title: "The Two Sides of Table Topics",
      publisher: "Toastmaster magazine (Toastmasters International)",
      year: 2022,
      url:
        "https://www.toastmasters.org/magazine/magazine-issues/2022/jan/" +
        "two-sides-of-table-topics",
      advice:
        "For impromptu answers, open by stating your opinion on the topic. It gives you a " +
        "first sentence you can say right away instead of stalling at the start.",
    },
    "long-060": {
      author: "Jeffrey D. Karpicke, Henry L. Roediger III",
      title: "The Critical Importance of Retrieval for Learning",
      publisher: "Science",
      year: 2008,
      url: "https://www.brucehayes.org/Teaching/papers/2008_Roediger_Karpicke_Science.pdf",
      advice:
        "Rehearse by recalling your speech from memory, not by rereading the script. In the " +
        "study, repeated recall greatly improved later memory, while extra rereading added " +
        "nothing.",
    },
    "long-045": {
      author: "",
      title: "Impromptu Starter Kit",
      publisher: "National Speech & Debate Association",
      year: null,
      url: "https://www.speechanddebate.org/wp-content/uploads/Impromptu-Starter-Kit.pdf",
      advice:
        "Practice starting to speak immediately on a prompt you haven't planned, and work your " +
        "way toward a thesis as you talk. This trains you out of freezing while you wait for a " +
        "perfect opening.",
    },
    "pace-087": {
      author: "Denise Graveline",
      title: "5 ways to slow down your speech",
      publisher: "Ragan Communications",
      year: 2013,
      url: "https://www.ragan.com/5-ways-to-slow-down-your-speech-2/",
      advice:
        "Presenting is not the same as excited conversation. Audiences need a slower, steadier " +
        "presenting rate (about 140-160 words per minute in this article) than many people use " +
        "when chatting.",
    },
    "pace-028": {
      author: "",
      title: "Strategy: \"Interping\" Extemp",
      publisher: "Extemp Central",
      year: null,
      url: "https://extemp.com/interping-extemp/",
      advice:
        "Change speed on purpose. Speed up through a list of facts to show momentum, and slow " +
        "right down, even softening your voice, for your biggest moment.",
    },
    "pause-022": {
      author: "Gavin Bui, Mohammad Javad Ahmadian, Ann-Marie Hunter",
      title: "Spacing effects on repeated L2 task performance",
      publisher: "System",
      year: 2019,
      url: "https://eprints.whiterose.ac.uk/139941/2/System_FinalV.pdf",
      advice:
        "Even one immediate repeat of a speech helps. In the second performance, speakers in " +
        "one study talked faster and tended to make fewer pauses in the middle of clauses.",
    },
    "pace-003": {
      author: "Joel Schwartzberg",
      title: "How To Quit Talking Quickly",
      publisher: "Toastmasters International (Toastmaster magazine)",
      year: 2021,
      url: "https://www.toastmasters.org/magazine/magazine-issues/2021/sept/quit-talking-quickly",
      advice:
        "Each pause takes your speed back to zero. Even if you speed up again, regular pauses " +
        "keep you from staying at full speed.",
    },
    "pace-098": {
      author: "Rynette R. Kjesbo",
      title: "Using an Appropriate Rate of Speech (Handy Handouts #351)",
      publisher: "Super Duper Publications",
      year: 2012,
      url: "https://www.handyhandouts.com/pdf/351%20Rate%20of%20Speech.pdf",
      advice:
        "Fit your speed to how much your listener already knows. When the topic is new to " +
        "them, slow down to give them more time to think about your message.",
    },
  };
  // Shown in place of the year for an undated source, as backend/advice/__init__.py NO_DATE.
  const NO_DATE = "n.d.";

  // The label a source is shown with, built as backend/advice/__init__.py citation() builds it:
  // "Author, Title (Year)". With no author the publisher is credited in the author's place; with
  // no title the publisher stands in for the title; an undated source gets "n.d."; a part still
  // empty is left out with its comma.
  function citationLabel(source) {
    const credited = source.author ? source.author : source.publisher;
    const work = source.author ? source.title || source.publisher : source.title;
    const name = [credited, work].filter(Boolean).join(", ");
    const year = source.year === null ? NO_DATE : String(source.year);
    return name + " (" + year + ")";
  }

  // A level's tip: the library entry's advice word for word, with its citation and link.
  function tipOf(entryId) {
    const source = LIBRARY[entryId];
    return { entry: entryId, text: source.advice, label: citationLabel(source), url: source.url };
  }

  // A unit's "why this works" line: a sentence that says only what the entry says, cited.
  function whyOf(entryId, text) {
    const source = LIBRARY[entryId];
    return { entry: entryId, text, label: citationLabel(source), url: source.url };
  }

  // --- The units and levels (spec section 3) ---------------------------------------------------

  // An example line is a list of parts, so a screen can mark the slip in it without markup:
  // {text, mark}, `mark` naming the slip ("filler", "restart" or "pause") or null.
  function unmarked(text) {
    return { text, mark: null };
  }

  function marked(text, mark) {
    return { text, mark };
  }

  // A take in the level data: its set seconds, whether it is read from a passage, and for a pace
  // take its band. Pace level 3's take 2 also says how long it lasts for a speaker whose usual
  // pace is under the band (belowBandSeconds), 4/3/2 style.
  function talk(seconds, extra) {
    return Object.assign({ seconds, read: false }, extra);
  }

  function read(seconds, extra) {
    return Object.assign({ seconds, read: true }, extra);
  }

  // A ladder read lasts as long as the passage takes at the read's target pace, rounded up, so
  // Practice's time bar fills as an on-pace speaker reads the last word.
  function ladderRead(wpm) {
    return read(Math.ceil((ladderWords() * SECONDS_PER_MINUTE) / wpm), { band: bandAround(wpm) });
  }

  function bandAround(wpm) {
    return [wpm - SPEED_TOLERANCE_WPM, wpm + SPEED_TOLERANCE_WPM];
  }

  // The ladder passage's word count, read from passages.js, which index.html loads first.
  function ladderWords() {
    const passage = passageById(LADDER_PASSAGE_ID);
    if (!passage) {
      throw new Error("path.js needs the passage '" + LADDER_PASSAGE_ID + "' from passages.js");
    }
    return passage.text.trim().split(/\s+/).length;
  }

  // The band talk levels hold the pace to: the Impromptu prompt's own, which new topics share.
  function talkBand() {
    return paceBandOf(IMPROMPTU_PROMPT_ID).slice();
  }

  // Fillers levels: two talks of `seconds`, take 2 at most `max` fillers a minute. A check-back
  // is one talk on a new topic at the level's rate.
  function fillersLevel(spec) {
    const rate = atMost("fillersPerMinute", spec.max);
    return {
      title: spec.title,
      material: spec.material,
      takes: [talk(spec.seconds), talk(spec.seconds)],
      conditions: [spec.halfway ? halfwayToward(spec.max) : rate],
      guards: TALK_GUARDS,
      tip: spec.tip,
      flags: spec.flags,
      checkback: {
        material: NEW_TOPIC,
        take: talk(spec.checkbackSeconds),
        conditions: [rate],
        guards: TALK_GUARDS,
      },
    };
  }

  // Restarts levels 1 to 4: one unseen cold read, read `reads` times in a row; the last read
  // counts, at most `maxSlips` restarts and misreads. A check-back is one more unseen cold read
  // at the same limit.
  function coldReadLevel(title, reads, maxSlips, tip) {
    const conditions = [atMost("readSlips", maxSlips)];
    return {
      title,
      material: COLD_READ,
      takes: Array.from({ length: reads }, () => read(COLD_READ_SECONDS)),
      conditions,
      guards: READ_GUARDS,
      tip,
      checkback: {
        material: COLD_READ,
        take: read(COLD_READ_SECONDS),
        conditions,
        guards: READ_GUARDS,
      },
    };
  }

  // Long pauses levels: plan for `prepSeconds`, tell it, then tell it again, take 2 holding a
  // clean stretch of `stretch` seconds with at most `maxLong` long pauses. A check-back is 90 s
  // on a new topic, without prep, at the same limits.
  function holdLevel(spec) {
    const holds = [
      atLeast("cleanStretchSeconds", spec.stretch),
      atMost("longPauses", spec.maxLong),
    ];
    return {
      title: spec.title,
      material: spec.material,
      prepSeconds: spec.prepSeconds,
      takes: [talk(spec.seconds[0]), talk(spec.seconds[1])],
      conditions: holds.concat(spec.quietMid ? [atMost("shortMidPerMinute", USUAL)] : []),
      guards: TALK_GUARDS,
      tip: spec.tip,
      checkback: {
        material: NEW_TOPIC,
        take: talk(NEW_TOPIC_CHECKBACK_SECONDS),
        conditions: holds,
        guards: TALK_GUARDS,
      },
    };
  }

  // Pace levels 3 to 5: two talks, take 2 inside the band. A check-back is 90 s on a new topic,
  // inside the band.
  function talkInBandLevel(spec) {
    const band = { band: talkBand() };
    return {
      title: spec.title,
      material: spec.material,
      takes: [
        talk(spec.seconds[0], band),
        talk(spec.seconds[1], Object.assign({}, band, spec.take2)),
      ],
      conditions: [inTakeBand()].concat(spec.extra || []),
      guards: spec.guards,
      tip: spec.tip,
      checkback: paceCheckback(),
    };
  }

  function paceCheckback() {
    return {
      material: NEW_TOPIC,
      take: talk(NEW_TOPIC_CHECKBACK_SECONDS, { band: talkBand() }),
      conditions: [inTakeBand()],
      guards: PACE_TALK_GUARDS,
    };
  }

  const FILLER_MARK = "filler";
  const RESTART_MARK = "restart";
  const PAUSE_MARK = "pause";

  const UNIT_DATA = [
    {
      id: "restarts",
      title: "Restarts",
      tags: ["restart"],
      subtitle: "Read it three times, then twice, then say it",
      why: whyOf(
        "restart-021",
        "Restarts fade last: in one study they dropped only after the 4th repeat.",
      ),
      fixes: [
        "Finish the sentence, don't restart",
        "Read a phrase ahead",
        "Slow the first 3 words",
        "Pause at commas",
      ],
      example: {
        good: [unmarked("I'm kinda nervous, but here's my point.")],
        bad: [marked("I kinda ner—", RESTART_MARK), unmarked(" I'm kinda nervous.")],
      },
      levels: [
        coldReadLevel("Read it 3 times", 3, 4, "restart-056"),
        coldReadLevel("Read it 3 times", 3, 3, "restart-060"),
        coldReadLevel("Read it twice", 2, 2, "restart-009"),
        coldReadLevel("Read it twice", 2, 1, "restart-025"),
        {
          title: "Say it twice",
          material: IMPROMPTU,
          takes: [talk(90), talk(90)],
          conditions: [atMost("restartsPerMinute", 1)],
          guards: TALK_GUARDS,
          tip: "restart-008",
          checkback: {
            material: NEW_TOPIC,
            take: talk(NEW_TOPIC_CHECKBACK_SECONDS),
            conditions: [atMost("restartsPerMinute", 1)],
            guards: TALK_GUARDS,
          },
        },
      ],
      crown: null,
      checkpoint: {
        conditions: [atMost("restartsPerMinute", 1), atMost("weightedPerMinute", USUAL)],
        guards: ALL_SLIPS_TALK_GUARDS,
      },
    },
    {
      id: "fillers",
      title: "Fillers",
      tags: ["filler"],
      subtitle: "Name it, spot it, catch it, pause instead",
      why: whyOf(
        "filler-085",
        "Noticing your fillers and pausing silently in their place cut disfluencies for all " +
          "four speakers in one study.",
      ),
      fixes: [
        "Pause instead of um",
        "Jot 3 points first",
        "Slow the first 3 words",
        "Finish the sentence, don't restart",
      ],
      example: {
        good: [unmarked("Close your lips and pause. The plan costs less.")],
        bad: [
          marked("Um", FILLER_MARK),
          unmarked(", so, the plan, "),
          marked("uh", FILLER_MARK),
          unmarked(", costs less."),
        ],
      },
      levels: [
        fillersLevel({
          title: "Name it",
          material: YOUR_DAY,
          seconds: 60,
          max: 8,
          halfway: true,
          checkbackSeconds: 60,
          tip: "filler-052",
          flags: { listsTopFillers: true },
        }),
        fillersLevel({
          title: "Spot it",
          material: YOUR_DAY,
          seconds: 60,
          max: 8,
          checkbackSeconds: 60,
          tip: "filler-002",
          flags: { spotIt: true },
        }),
        fillersLevel({
          title: "Catch it live",
          material: IMPROMPTU,
          seconds: 90,
          max: 6,
          checkbackSeconds: 90,
          tip: "filler-069",
          flags: { liveTap: true },
        }),
        fillersLevel({
          title: "Pause instead",
          material: IMPROMPTU,
          seconds: 90,
          max: 5,
          checkbackSeconds: 90,
          tip: "filler-026",
        }),
        fillersLevel({
          title: "New topic",
          material: NEW_TOPIC,
          seconds: 120,
          max: 3,
          checkbackSeconds: 90,
          tip: "filler-024",
        }),
      ],
      crown: {
        judge: SUDDEN_DEATH,
        title: "Sudden death",
        label: "Sudden death, optional",
        material: YOUR_DAY,
        tiers: RUN_TARGETS_SECONDS.map((seconds) => ({ seconds })),
      },
      checkpoint: {
        conditions: [atMost("fillersPerMinute", 3), atMost("weightedPerMinute", USUAL)],
        guards: ALL_SLIPS_TALK_GUARDS,
      },
    },
    {
      id: "long-pauses",
      title: "Long pauses",
      tags: ["long_pause"],
      subtitle: "Plan, tell, then tell again",
      why: whyOf(
        "general-014",
        "Retelling a talk in less time each round brought gains in speed and pausing that " +
          "lasted on a later test.",
      ),
      fixes: [
        "Jot 3 points first",
        "Say your next point out loud",
        "Pause at a full stop, not mid-sentence",
        "Slow the first 3 words",
      ],
      example: {
        good: [unmarked("Uniforms cost more. Here's why: families still buy weekend clothes.")],
        bad: [
          unmarked("Uniforms cost more because… "),
          marked("[6 s]", PAUSE_MARK),
          unmarked(" …families still buy clothes."),
        ],
      },
      levels: [
        holdLevel({
          title: "Hold 15 s clean",
          material: IMPROMPTU,
          prepSeconds: 30,
          seconds: [90, 90],
          stretch: 15,
          maxLong: 1,
          tip: "long-053",
        }),
        holdLevel({
          title: "Hold 20 s",
          material: IMPROMPTU,
          prepSeconds: 20,
          seconds: [90, 75],
          stretch: 20,
          maxLong: 0,
          tip: "long-003",
        }),
        holdLevel({
          title: "Hold 30 s",
          material: IMPROMPTU,
          prepSeconds: 10,
          seconds: [90, 60],
          stretch: 30,
          maxLong: 0,
          tip: "long-049",
        }),
        holdLevel({
          title: "Hold 45 s",
          material: IMPROMPTU,
          prepSeconds: 0,
          seconds: [120, 90],
          stretch: 45,
          maxLong: 0,
          quietMid: true,
          tip: "long-060",
        }),
        holdLevel({
          title: "Hold a minute",
          material: NEW_TOPIC,
          prepSeconds: 0,
          seconds: [120, 120],
          stretch: 60,
          maxLong: 0,
          tip: "long-045",
        }),
      ],
      crown: null,
      checkpoint: {
        conditions: [atMost("longPauses", 0), atMost("weightedPerMinute", USUAL)],
        guards: ALL_SLIPS_TALK_GUARDS,
      },
    },
    {
      id: "pace",
      title: "Pace",
      tags: ["pace_fast", "pace_slow"],
      subtitle: "Feel the band, then hold it",
      why: whyOf(
        "pause-029",
        "When untrained listeners rate fluency, pausing and speed explain most of their " +
          "judgment.",
      ),
      fixes: [
        "Match the time bar",
        "Breathe at each full stop",
        "Pause at commas, not mid-phrase",
        "Keep going through small slips",
      ],
      example: {
        good: [unmarked("A steady 150: every word lands, and the pauses fall at full stops.")],
        bad: [unmarked("A rushed 190 that runs one sentence into the next.")],
      },
      levels: [
        {
          title: "Feel the band",
          material: LADDER,
          takes: [ladderRead(150), ladderRead(150)],
          conditions: [inTakeBand()],
          guards: PACE_READ_GUARDS,
          tip: "pace-087",
          goal: { short: "150 wpm, twice" },
          checkback: paceCheckback(),
        },
        {
          title: "Shift gears",
          material: LADDER,
          takes: [ladderRead(140), ladderRead(160)],
          scoredInPairs: true,
          conditions: [inTakeBand(), atMost("restarts", 2)],
          guards: PACE_READ_GUARDS,
          tip: "pace-028",
          goal: {
            headline: "140, then 160",
            unitLabel: "wpm, give or take 10, at most 2 restarts each",
            short: "140, then 160 wpm",
          },
          checkback: paceCheckback(),
        },
        talkInBandLevel({
          title: "Talk in the band",
          material: IMPROMPTU,
          seconds: [90, 90],
          take2: { belowBandSeconds: 70 },
          guards: PACE_TALK_GUARDS,
          tip: "pause-022",
        }),
        talkInBandLevel({
          title: "Hold it",
          material: IMPROMPTU,
          seconds: [120, 120],
          guards: PACE_TALK_GUARDS,
          tip: "pace-003",
        }),
        talkInBandLevel({
          title: "New topic",
          material: NEW_TOPIC,
          seconds: [120, 120],
          extra: [atMost("weightedPerMinute", USUAL)],
          guards: ALL_SLIPS_PACE_GUARDS,
          tip: "pace-098",
        }),
      ],
      crown: {
        judge: SPEED_LADDER,
        title: "Speed ladder",
        label: "180 wpm ladder, optional",
        material: LADDER,
        tiers: [{ wpm: LADDER_CROWN.wpm, maxRestarts: LADDER_CROWN.maxRestarts }],
      },
      checkpoint: {
        conditions: [inTakeBand(), atMost("weightedPerMinute", USUAL)],
        guards: ALL_SLIPS_PACE_GUARDS,
      },
    },
  ];

  // UNITS: the four units, in the order select.py's MEASURED_SKILLS lists their skills, which is
  // the order ties keep. A unit is {id, title, tags, subtitle, why, fixes, example, levels,
  // crown, checkpoint}: `tags` are the research library's tags for its skill, `why` its cited
  // "why this works" line {entry, text, label, url}, `fixes` the four fixes a speaker may choose
  // for a next take, `example` {good, bad} lines as parts {text, mark}. A level is {id, unit,
  // number, title, material, prepSeconds, takes, conditions, guards, scoredInPairs, tip,
  // liveTap, spotIt, listsTopFillers, checkback}, its id "<unit>-<number>" (the id app.store
  // keeps once it is cleared); its `takes` are [{seconds, scored, read, band?, label}], and the
  // rule a scored take must meet is its `conditions` and `guards`. `crown` is null or {id, judge,
  // title, label, material, tiers}; `checkpoint` is {id, label, seconds, conditions, guards}.
  const UNITS = deepFreeze(UNIT_DATA.map(buildUnit));

  const LEVELS_BY_ID = new Map(
    UNITS.flatMap((entry) => entry.levels.map((level) => [level.id, level])),
  );

  // The Goal card words a level puts in place of the ones its rule gives (Pace levels 1 and 2),
  // by level id.
  const GOAL_WORDS = new Map(
    UNIT_DATA.flatMap((data) =>
      data.levels
        .map((spec, index) => [data.id + "-" + (index + 1), spec.goal])
        .filter(([, words]) => words !== undefined),
    ),
  );

  function buildUnit(data) {
    const levels = data.levels.map((spec, index) => buildLevel(data.id, index + 1, spec));
    const crown = data.crown
      ? Object.assign({}, data.crown, {
          id: data.id + CROWN_SUFFIX,
          tiers: data.crown.tiers.map((tier, index) =>
            Object.assign({ number: index + 1 }, tier, {
              record: data.id + CROWN_SUFFIX + "-" + (index + 1),
            }),
          ),
        })
      : null;
    return {
      id: data.id,
      title: data.title,
      tags: data.tags,
      subtitle: data.subtitle,
      why: data.why,
      fixes: data.fixes,
      example: data.example,
      levels,
      crown,
      checkpoint: {
        id: data.id + CHECKPOINT_SUFFIX,
        label: CHECKPOINT_LABEL,
        seconds: CHECKPOINT_SECONDS,
        conditions: data.checkpoint.conditions,
        guards: data.checkpoint.guards,
      },
    };
  }

  // A level's takes are numbered within the loop, "Take 1" or "Read 1", and only the last one is
  // scored, except Pace level 2, whose two reads are scored as a pair.
  function buildLevel(unitId, number, spec) {
    const pairs = spec.scoredInPairs === true;
    const flags = spec.flags || {};
    return {
      id: unitId + "-" + number,
      unit: unitId,
      number,
      title: spec.title,
      material: spec.material,
      prepSeconds: spec.prepSeconds || 0,
      takes: spec.takes.map((take, index) =>
        Object.assign({}, take, {
          scored: pairs || index === spec.takes.length - 1,
          label: (take.read ? "Read " : "Take ") + (index + 1),
        }),
      ),
      conditions: spec.conditions,
      guards: spec.guards,
      scoredInPairs: pairs,
      tip: tipOf(spec.tip),
      liveTap: flags.liveTap === true,
      spotIt: flags.spotIt === true,
      listsTopFillers: flags.listsTopFillers === true,
      checkback: spec.checkback,
    };
  }

  // The level with this id ("fillers-2"), or null.
  function levelById(id) {
    return LEVELS_BY_ID.get(id) || null;
  }

  // --- Plays -----------------------------------------------------------------------------------

  // The play with this route id, or null: everything the Level screen shows and asks for,
  // without re-deriving a rule. {id, kind, unit, unitTitle, level, number, heading, subtitle,
  // takes, material, prepSeconds, prepText, goal, example, why, tip, fixes, liveTap, spotIt,
  // listsTopFillers, inRoomSwitch, tier}:
  // - kind "loop" | "checkback" | "crown" | "checkpoint" | "benchmark"; unit the unit id (null
  //   for the benchmark); level and number the level's (loops and check-backs, else null).
  // - heading the h1 ("Fillers, level 3", "Fillers, level 3 check-back", "Fillers crown",
  //   "Fillers checkpoint", "Benchmark") and subtitle the level title ("Catch it live").
  // - takes [{seconds, scored, read, band?, label}] in order ("Take 1", "Read 2"; a one-take
  //   play's is "Take", the benchmark's "Read" and "Talk"); takeAt() gives the takes past them.
  // - material: the key materialFor() reads ("your-day", "impromptu", "new-topic", "cold-read",
  //   "ladder" or "benchmark"); prepSeconds and prepText the planning before take 1.
  // - goal {headline, unitLabel, length, short}; example {good, bad} lines of parts {text,
  //   mark}; why the unit's cited line and tip the level's cited tip, each {entry, text, label,
  //   url} (why null for the benchmark, tip null but for loops and check-backs); fixes the
  //   unit's four.
  // - liveTap: Practice shows "Heard one" while recording; spotIt: the Review starts with Spot
  //   it; listsTopFillers: the Goal lists topFillers(); inRoomSwitch: the Goal asks whether
  //   someone is listening (checkpoints).
  // - tier: a crown's next tier {number, seconds | wpm, maxRestarts?, record, earned}, or the top
  //   tier with earned true once every one is earned; null for other plays.
  // `options` is {baseline, cleared}. Two things depend on the baseline (baseline() or, for a
  // speaker with none, measure() of take 1), and with a null one they say so rather than guess:
  // Fillers level 1's target reads "8 or fewer, or halfway there from take 1", and Pace level
  // 3's take 2 has null seconds until take 1 sets the baseline. A crown's tier reads `cleared`
  // (app.store.listClearedLevels()). The play is frozen.
  function playById(playId, options) {
    const given = options && typeof options === "object" ? options : {};
    const spec = specOf(playId);
    if (spec === null) {
      return null;
    }
    const usual = isBaseline(given.baseline) ? given.baseline : null;
    return deepFreeze(publicPlay(spec, usual, given.cleared));
  }

  // The play's take at `takeIndex` (0 for take 1), resolved with `options` as playById resolves
  // it: {seconds, scored, read, band?, label}. A loop's takes past its list are its retries
  // ("Try take 3"): each repeats the scored take ("Take 3"), and Pace level 2's repeat its pair
  // of reads ("Read 3" at 140, "Read 4" at 160). Null for the benchmark past its two takes, or
  // for an unknown play.
  function takeAt(play, takeIndex, options) {
    const spec = specOf(play && typeof play === "object" ? play.id : play);
    if (spec === null || !Number.isInteger(takeIndex) || takeIndex < 0) {
      return null;
    }
    const given = options && typeof options === "object" ? options : {};
    const usual = isBaseline(given.baseline) ? given.baseline : null;
    const take = takeOf(spec, takeIndex, usual, given.cleared);
    return take === null ? null : deepFreeze(take);
  }

  // The plays by id, built once: a loop and a check-back for every level, a crown for Fillers
  // and Pace, a checkpoint for every unit, and the benchmark.
  const SPECS = new Map();
  UNITS.forEach((pathUnit) => {
    pathUnit.levels.forEach((level) => {
      SPECS.set(level.id, loopSpec(pathUnit, level));
      SPECS.set(level.id + CHECKBACK_SUFFIX, checkbackSpec(pathUnit, level));
    });
    if (pathUnit.crown) {
      SPECS.set(pathUnit.crown.id, crownSpec(pathUnit));
    }
    SPECS.set(pathUnit.checkpoint.id, checkpointSpec(pathUnit));
  });
  SPECS.set(BENCHMARK, benchmarkSpec());

  function specOf(playId) {
    return typeof playId === "string" && SPECS.has(playId) ? SPECS.get(playId) : null;
  }

  function loopSpec(pathUnit, level) {
    return {
      id: level.id,
      kind: LOOP,
      unit: pathUnit,
      level,
      heading: pathUnit.title + ", level " + level.number,
      subtitle: level.title,
      takes: level.takes,
      scoredInPairs: level.scoredInPairs,
      material: level.material,
      prepSeconds: level.prepSeconds,
      conditions: level.conditions,
      guards: level.guards,
      tip: level.tip,
      goal: GOAL_WORDS.get(level.id) || null,
    };
  }

  function checkbackSpec(pathUnit, level) {
    const check = level.checkback;
    return {
      id: level.id + CHECKBACK_SUFFIX,
      kind: CHECKBACK,
      unit: pathUnit,
      level,
      heading: pathUnit.title + ", level " + level.number + " check-back",
      subtitle: level.title,
      takes: [Object.assign({}, check.take, { scored: true, label: "Take" })],
      scoredInPairs: false,
      material: check.material,
      prepSeconds: 0,
      conditions: check.conditions,
      guards: check.guards,
      tip: level.tip,
      goal: null,
    };
  }

  // A crown's take depends on its tier, so its takes are built per tier (crownTake).
  function crownSpec(pathUnit) {
    const crown = pathUnit.crown;
    return {
      id: crown.id,
      kind: CROWN,
      unit: pathUnit,
      level: null,
      heading: pathUnit.title + " crown",
      subtitle: crown.title,
      takes: null,
      scoredInPairs: false,
      material: crown.material,
      prepSeconds: 0,
      conditions: [],
      guards: [],
      tip: null,
      goal: null,
    };
  }

  function checkpointSpec(pathUnit) {
    const checkpoint = pathUnit.checkpoint;
    const band = pathUnit.id === "pace" ? { band: talkBand() } : {};
    return {
      id: checkpoint.id,
      kind: CHECKPOINT,
      unit: pathUnit,
      level: null,
      heading: pathUnit.title + " checkpoint",
      subtitle: "2-minute new topic",
      takes: [Object.assign(talk(checkpoint.seconds, band), { scored: true, label: "Take" })],
      scoredInPairs: false,
      material: NEW_TOPIC,
      prepSeconds: 0,
      conditions: checkpoint.conditions,
      guards: checkpoint.guards,
      tip: null,
      goal: null,
    };
  }

  // The benchmark: the held-out passage read, then the held-out prompt talked for 90 s. Neither
  // take is scored: a benchmark never clears or locks anything.
  function benchmarkSpec() {
    const band = { band: DEFAULT_TARGET_WPM.slice() };
    return {
      id: BENCHMARK,
      kind: BENCHMARK,
      unit: null,
      level: null,
      heading: "Benchmark",
      subtitle: "Same passage, same prompt, every 14 days",
      takes: [
        Object.assign(read(COLD_READ_SECONDS, band), { scored: false, label: "Read" }),
        Object.assign(talk(BENCHMARK_TALK_SECONDS, band), { scored: false, label: "Talk" }),
      ],
      scoredInPairs: false,
      material: BENCHMARK_MATERIAL,
      prepSeconds: 0,
      conditions: [],
      guards: [],
      tip: null,
      goal: null,
    };
  }

  function publicPlay(spec, usual, cleared) {
    const pathUnit = spec.unit;
    const tier = spec.kind === CROWN ? crownTierOf(pathUnit.crown, cleared) : null;
    const takes = takesOf(spec, usual, tier);
    return {
      id: spec.id,
      kind: spec.kind,
      unit: pathUnit ? pathUnit.id : null,
      unitTitle: pathUnit ? pathUnit.title : null,
      level: spec.level ? spec.level.id : null,
      number: spec.level ? spec.level.number : null,
      heading: spec.heading,
      subtitle: spec.subtitle,
      takes,
      material: spec.material,
      prepSeconds: spec.prepSeconds,
      prepText: spec.prepSeconds > 0 ? "Plan for " + spec.prepSeconds + " s: jot 3 points." : null,
      goal: goalOf(spec, takes, usual, tier),
      example: pathUnit ? pathUnit.example : null,
      why: pathUnit ? pathUnit.why : null,
      tip: spec.tip,
      fixes: pathUnit ? pathUnit.fixes : [],
      liveTap: spec.kind === LOOP && spec.level.liveTap,
      spotIt: spec.kind === LOOP && spec.level.spotIt,
      listsTopFillers: spec.kind === LOOP && spec.level.listsTopFillers,
      inRoomSwitch: spec.kind === CHECKPOINT,
      tier,
    };
  }

  // The play's listed takes, resolved.
  function takesOf(spec, usual, tier) {
    if (spec.kind === CROWN) {
      return [crownTake(spec.unit.crown, tier)];
    }
    return spec.takes.map((take, index) => resolveTake(spec, take, index, usual));
  }

  // The take at `index`: a listed one, or for a loop past its list a retry (see takeAt).
  function takeOf(spec, index, usual, cleared) {
    if (spec.kind === CROWN) {
      return crownTake(spec.unit.crown, crownTierOf(spec.unit.crown, cleared));
    }
    if (index < spec.takes.length) {
      return resolveTake(spec, spec.takes[index], index, usual);
    }
    if (spec.kind === BENCHMARK) {
      return null;
    }
    const size = attemptSize(spec);
    const repeated = spec.takes[spec.takes.length - size + ((index - spec.takes.length) % size)];
    return resolveTake(spec, repeated, index, usual);
  }

  // How many takes one attempt scores: two for Pace level 2's pair of reads, else one.
  function attemptSize(spec) {
    return spec.scoredInPairs ? 2 : 1;
  }

  // True when the take at `index` ends an attempt: every scored take, except that a pair ends
  // on its second read.
  function closesAttempt(spec, index) {
    const last = spec.takes.length - 1;
    return index >= last && (index - last) % attemptSize(spec) === 0;
  }

  // A take as a play lists it: {seconds, scored, read, band?, label}. A loop's takes are
  // numbered from 1. Pace level 3's take 2 is shorter for a speaker whose usual pace is under the
  // band, and its seconds are null until there is a baseline to say which.
  function resolveTake(spec, take, index, usual) {
    let seconds = take.seconds;
    if (take.belowBandSeconds !== undefined) {
      seconds = usual === null ? null : usual.wpm < take.band[0] ? take.belowBandSeconds : seconds;
    }
    const resolved = { seconds, scored: take.scored, read: take.read };
    if (take.band) {
      resolved.band = take.band.slice();
    }
    resolved.label =
      spec.kind === LOOP ? (take.read ? "Read " : "Take ") + (index + 1) : take.label;
    return resolved;
  }

  // A crown tier's one take: sudden death talks for the tier's run plus headroom; the speed
  // ladder reads the ladder passage at its pace.
  function crownTake(crown, tier) {
    if (crown.judge === SUDDEN_DEATH) {
      const seconds = tier.seconds + RUN_HEADROOM_SECONDS;
      return { seconds, scored: true, read: false, label: "Take" };
    }
    const take = ladderRead(tier.wpm);
    return { seconds: take.seconds, scored: true, read: true, band: take.band, label: "Take" };
  }

  // The crown's next tier: the first not yet earned, or the top one, marked earned, once all are.
  function crownTierOf(crown, cleared) {
    const ids = clearedIds(cleared);
    const next = crown.tiers.find((tier) => !ids.has(tier.record));
    const tier = next || crown.tiers[crown.tiers.length - 1];
    return Object.assign({}, tier, { earned: !next });
  }

  // --- Goals -----------------------------------------------------------------------------------

  // The Goal card's words: {headline, unitLabel, length, short}, e.g. "6 or fewer", "fillers a
  // minute", "90 s, two takes", "6 or fewer /min" (the short goal the Path's popover shows).
  function goalOf(spec, takes, usual, tier) {
    if (spec.kind === BENCHMARK) {
      return Object.assign({}, BENCHMARK_GOAL);
    }
    if (spec.kind === CROWN) {
      return crownGoal(spec.unit.crown, tier);
    }
    const scored = takes.filter((take) => take.scored);
    const scoredTake = scored[scored.length - 1];
    const conditions = spec.conditions.map((condition) =>
      resolveCondition(condition, usual, scoredTake),
    );
    const where = spec.kind === LOOP ? scoredTake.label.toLowerCase() : null;
    const goal = Object.assign(headlineOf(conditions, spec.conditions[0], where), {
      length: lengthOf(spec, takes),
    });
    if (spec.kind === CHECKPOINT) {
      goal.short = "2-minute new topic";
    }
    return Object.assign(goal, spec.goal || {});
  }

  // The headline, its unit label and the short goal, from the rule's first condition, with the
  // other conditions after the unit label.
  function headlineOf(conditions, first, where) {
    const [main, ...extras] = conditions;
    const extraWords = extras.map(goalExtraOf);
    const withExtras = (label) => [label].concat(extraWords).filter(Boolean).join(", ");
    switch (main.measure) {
      case "readSlips":
        return {
          headline: main.bound + " or fewer",
          unitLabel: withExtras(
            "slips" + (where ? " on " + where : "") + ": restarts and misreads",
          ),
          short: main.bound + (main.bound === 1 ? " slip" : " slips") + " or fewer",
        };
      case "cleanStretchSeconds":
        return {
          headline: tenthText(main.bound) + " s",
          unitLabel: withExtras("clean stretch"),
          short: tenthText(main.bound) + " s clean",
        };
      case "longPauses":
        return { headline: "No long pause", unitLabel: withExtras(""), short: "No long pause" };
      case "wpm":
        return {
          headline: main.bound[0] + " to " + main.bound[1],
          unitLabel: withExtras("wpm" + (where ? " on " + where : "")),
          short: main.bound[0] + " to " + main.bound[1] + " wpm",
        };
      default:
        return rateHeadline(main, first, withExtras);
    }
  }

  // A rate's headline. Fillers level 1's waits on the baseline: without one it names both ways
  // take 1 can set it.
  function rateHeadline(main, first, withExtras) {
    const words = RATE_WORDS[main.measure];
    if (main.bound === null && first.halfwayFromUsual) {
      return {
        headline: first.max + " or fewer",
        unitLabel: withExtras(words + ", or halfway there from take 1"),
        short: "Halfway to " + first.max + " /min",
      };
    }
    return {
      headline: tenthText(main.bound) + " or fewer",
      unitLabel: withExtras(words),
      short: tenthText(main.bound) + " or fewer /min",
    };
  }

  // A condition after the headline, as the Goal card names it.
  function goalExtraOf(condition) {
    if (condition.usual) {
      return condition.measure === "weightedPerMinute"
        ? "slips in all at your usual or fewer"
        : "mid-sentence pauses at your usual or fewer";
    }
    return countLimitText(condition.measure, condition.bound);
  }

  // "90 s, two takes", "90 s, then 75 s", "3 reads of a new passage", "90 s on a new topic".
  function lengthOf(spec, takes) {
    if (spec.kind === CHECKPOINT) {
      return takes[0].seconds + " s on a new topic";
    }
    if (spec.kind === CHECKBACK) {
      return takes[0].read ? "One read of a new passage" : takes[0].seconds + " s on a new topic";
    }
    if (takes.every((take) => take.read)) {
      const passage = spec.material === COLD_READ ? "a new passage" : "the passage";
      return takes.length + " reads of " + passage;
    }
    const [first, second] = takes;
    if (second.seconds === null) {
      const pending = spec.takes[1];
      const either = pending.belowBandSeconds + " or " + pending.seconds;
      return first.seconds + " s, then " + either + " s";
    }
    if (first.seconds === second.seconds) {
      return first.seconds + " s, two takes";
    }
    return first.seconds + " s, then " + second.seconds + " s";
  }

  function crownGoal(crown, tier) {
    if (crown.judge === SUDDEN_DEATH) {
      return {
        headline: clockText(tier.seconds),
        unitLabel: "without a filler or restart",
        length: tier.seconds + RUN_HEADROOM_SECONDS + " s on Your day",
        short: crown.label,
      };
    }
    const band = bandAround(tier.wpm);
    return {
      headline: band[0] + " to " + band[1],
      unitLabel: "wpm, at most " + countText(tier.maxRestarts, "restart"),
      length: "One read of the passage",
      short: crown.label,
    };
  }

  // --- Measures and the baseline (spec section 2) ----------------------------------------------

  // One take's numbers, as every Loop Path rule reads them, from its app.delivery report and its
  // set seconds (the take's time limit): {spoke, setSeconds, speakingSeconds, minutes, fillers,
  // fillersPerMinute, restarts, restartsPerMinute, shortMid, shortMidPerMinute, longPauses,
  // longPausesPerMinute, wpm, cleanStretchSeconds, misreads, readSlips, followedScript,
  // unreadRun, weightedPerMinute, otherPerMinute}. Rates are rounded to a tenth, wpm to a whole
  // number and seconds to a tenth, as the screens show them, so a rule judged on them never
  // contradicts its copy ("6.0 a minute, target 6" passes). `spoke` is false for a take without
  // speech (no first word, or no speaking time), which fails every rule. `minutes` is the
  // unrounded speaking time, the weight the take carries in a baseline. `shortMid` counts the
  // mid-sentence pauses that are not long, so a long one counts once, as long. `readSlips` are a
  // reading take's restarts and misreads (a skipped word is not a slip: a transcript can drop a
  // short word the speaker said) and `unreadRun` the most script words skipped in one place.
  // `weightedPerMinute` weighs every slip as rank.js does; `otherPerMinute` does the same with
  // each unit's own skill left out, by unit id (weightedSlipsOf).
  function measure(report, setSeconds) {
    const given = report && typeof report === "object" ? report : {};
    const facts = factsOf(given);
    const minutes = facts.speakingSeconds / SECONDS_PER_MINUTE;
    const counts = {
      fillers: numberOr0(given.fillerCount),
      restarts: facts.restartCount,
      shortMid: shortMidPauseCount(given),
      longPauses: numberOr0(given.longPauseCount),
    };
    const weighted = weightedSlipsOf(counts);
    const perMinute = (count) => (minutes > 0 ? roundToTenth(count / minutes) : 0);
    const otherPerMinute = {};
    UNIT_IDS.forEach((unitId) => {
      otherPerMinute[unitId] = perMinute(weighted.other[unitId]);
    });
    return {
      spoke: facts.spoke,
      setSeconds: numberOr0(setSeconds),
      speakingSeconds: roundToTenth(facts.speakingSeconds),
      minutes,
      fillers: counts.fillers,
      fillersPerMinute: perMinute(counts.fillers),
      restarts: counts.restarts,
      restartsPerMinute: perMinute(counts.restarts),
      shortMid: counts.shortMid,
      shortMidPerMinute: perMinute(counts.shortMid),
      longPauses: counts.longPauses,
      longPausesPerMinute: perMinute(counts.longPauses),
      wpm: facts.wpm,
      cleanStretchSeconds: roundToTenth(facts.cleanStretchSeconds),
      misreads: facts.misreadCount,
      readSlips: counts.restarts + facts.misreadCount,
      followedScript: facts.followedScript,
      unreadRun: longestSkipRun(facts.skips),
      weightedPerMinute: perMinute(weighted.all),
      otherPerMinute,
    };
  }

  // The mid-sentence pauses that are not long, as rank.js counts them: the report's `pauses`
  // list each as {midSentence, long}; a report without that list falls back on its count.
  function shortMidPauseCount(report) {
    if (!Array.isArray(report.pauses)) {
      return numberOr0(report.midSentencePauseCount);
    }
    return report.pauses.filter(
      (pause) => Boolean(pause) && pause.midSentence === true && pause.long !== true,
    ).length;
  }

  // The weighted slips of {fillers, restarts, shortMid, longPauses}: `all` of them, and in
  // `other`, by unit id, what is left once the unit's own skill is left out. Fillers leaves out
  // the fillers and Restarts the restarts; Long pauses leaves out both kinds of pause, so
  // fillers and restarts are what it must keep steady; Pace leaves out nothing.
  function weightedSlipsOf(counts) {
    const fillers = counts.fillers * FILLER_WEIGHT;
    const restarts = counts.restarts * RESTART_WEIGHT;
    const pauses =
      counts.shortMid * SHORT_MID_PAUSE_WEIGHT + counts.longPauses * LONG_PAUSE_WEIGHT;
    return {
      all: fillers + restarts + pauses,
      other: {
        restarts: fillers + pauses,
        fillers: restarts + pauses,
        "long-pauses": fillers + restarts,
        pace: fillers + restarts + pauses,
      },
    };
  }

  // The speaker's usual numbers, which a play freezes when its Goal step opens: their
  // RECENT_TAKES latest own takes with speech in `history` (the sample left out, as order()
  // leaves it out), each as measure() reads it. Each rate is the takes' total count over their
  // total speaking minutes, so a long take counts for every minute of it; wpm and the clean
  // stretch are means weighted by those minutes. {takes, minutes, fillersPerMinute,
  // restartsPerMinute, shortMidPerMinute, longPausesPerMinute, wpm, cleanStretchSeconds,
  // weightedPerMinute, otherPerMinute}, rounded as measure() rounds; null with no such take.
  function baseline(history) {
    const recent = [];
    for (const take of ownTakes(history).sort(newestFirst)) {
      if (recent.length === RECENT_TAKES) {
        break;
      }
      const measured = measure(app.delivery.analyze(take.transcript, take.metrics), 0);
      if (measured.spoke) {
        recent.push(measured);
      }
    }
    if (recent.length === 0) {
      return null;
    }
    const minutes = sumOf(recent, (measured) => measured.minutes);
    const perMinute = (count) => roundToTenth(count / minutes);
    const weightedMean = (key) =>
      sumOf(recent, (measured) => measured[key] * measured.minutes) / minutes;
    const counts = {
      fillers: sumOf(recent, (measured) => measured.fillers),
      restarts: sumOf(recent, (measured) => measured.restarts),
      shortMid: sumOf(recent, (measured) => measured.shortMid),
      longPauses: sumOf(recent, (measured) => measured.longPauses),
    };
    const weighted = weightedSlipsOf(counts);
    const otherPerMinute = {};
    UNIT_IDS.forEach((unitId) => {
      otherPerMinute[unitId] = perMinute(weighted.other[unitId]);
    });
    return {
      takes: recent.length,
      minutes,
      fillersPerMinute: perMinute(counts.fillers),
      restartsPerMinute: perMinute(counts.restarts),
      shortMidPerMinute: perMinute(counts.shortMid),
      longPausesPerMinute: perMinute(counts.longPauses),
      wpm: Math.round(weightedMean("wpm")),
      cleanStretchSeconds: roundToTenth(weightedMean("cleanStretchSeconds")),
      weightedPerMinute: perMinute(weighted.all),
      otherPerMinute,
    };
  }

  // True for a baseline as baseline() or measure() gives one.
  function isBaseline(value) {
    return Boolean(value) && typeof value === "object" && Boolean(value.otherPerMinute);
  }

  // The speaker's own takes in `history`: objects, the bundled sample left out.
  function ownTakes(history) {
    return listOf(history).filter((take) => take && typeof take === "object" && isOwnTake(take));
  }

  // --- Judging a take (spec sections 2 to 5) ---------------------------------------------------

  // How one take of a play went, from its app.delivery report: {scored, passed, value,
  // valueText, unitLabel, targetText, sentence, guards, fix, jumped, records, stage}.
  // - `play` is a play or its id; `takeIndex` 0 for take 1 (a loop's retries go on from there).
  // - `context` is {baseline, cleared, earlier, fix, inRoom}: the play's frozen baseline (from
  //   baseline(), or for a speaker with none, measure() of take 1; it may be null only on take
  //   1, which then stands in for it), the cleared records, the results of the run's earlier
  //   takes (Pace level 2 reads its pair's first read there), the fix the speaker chose, and
  //   whether someone was listening (checkpoints).
  // - passed: true or false on a scored take, null on one that is not. A take without speech
  //   fails with "No speech was found in this take."
  // - value, valueText, unitLabel and targetText: the number the take is judged on and its words
  //   for the Feedback card ("5.2", "fillers a minute", "target 6"); value null and valueText
  //   "—" when there is none to show.
  // - sentence: the verdict line ("5.2 fillers a minute on take 2. The target was 6.").
  // - guards: [{id, passed, text, fix}] for each guard the take checks.
  // - fix: on a scored take that missed, the one fix: the chosen fix, else the first failed
  //   guard's, else the play's first fix; null otherwise.
  // - jumped: the later levels a passing loop take also clears (the jump test); records: the
  //   ids app.store.markLevelCleared keeps when the take passes; stage: a check-back's 1 or 2.
  // A loop's attempt ends on its scored take. Pace level 2 scores a pair: read 1 passes on its
  // own band, and read 2 passes only when both reads landed, so read 2 alone carries records.
  function evaluate(play, takeIndex, report, context) {
    const spec = specOf(play && typeof play === "object" ? play.id : play);
    if (spec === null) {
      throw new Error("Unknown path play: " + (play && typeof play === "object" ? play.id : play));
    }
    if (!Number.isInteger(takeIndex) || takeIndex < 0) {
      throw new TypeError("evaluate needs a take index: 0 for take 1");
    }
    const given = context && typeof context === "object" ? context : {};
    if (spec.kind === BENCHMARK) {
      return describeBenchmarkTake(spec, takeIndex, report);
    }
    if (spec.kind === CROWN) {
      return judgeCrownTake(spec, report, given);
    }
    return judgeRuleTake(spec, takeIndex, report, given);
  }

  // A loop, check-back or checkpoint take, judged on its play's conditions and guards.
  function judgeRuleTake(spec, takeIndex, report, given) {
    const frozen = isBaseline(given.baseline) ? given.baseline : null;
    if (frozen === null && takeIndex > 0) {
      throw new TypeError(
        "evaluate needs context.baseline after take 1: the play's frozen baseline, or " +
          "measure() of take 1",
      );
    }
    // Take 1's set seconds never depend on the baseline, so a take 1 that stands in for a
    // missing baseline can be measured first.
    const measured = measure(report, takeOf(spec, takeIndex, frozen).seconds);
    const usual = frozen || measured;
    const take = takeOf(spec, takeIndex, usual);
    const closes = take.scored && closesAttempt(spec, takeIndex);
    const result = { scored: take.scored, stage: checkbackStageOf(spec, given.cleared) };
    if (!measured.spoke) {
      return takeResult(
        Object.assign(result, {
          passed: take.scored ? false : null,
          sentence: NO_SPEECH,
          fix: take.scored ? oneFix(given.fix, [], spec) : null,
        }),
      );
    }
    const guards = spec.guards.map((id) => guardLine(id, measured, usual, spec.unit.id));
    const checks = spec.conditions.map((condition) => {
      const resolved = resolveCondition(condition, usual, take);
      return { condition: resolved, met: meets(resolved, measured[resolved.measure]) };
    });
    const met = checks.every((check) => check.met);
    // A read that did not read its passage through has no slips worth showing, only why.
    const unread = take.read
      ? guards.find((guard) => guard.id === READ_THROUGH && !guard.passed)
      : null;
    const pair = pairVerdictOf(spec, takeIndex, closes, given.earlier);
    const passedAll = met && guards.every((guard) => guard.passed) && pair.landed;
    const passed = take.scored ? passedAll : null;
    const main = checks[0].condition;
    const where = spec.kind === LOOP ? take.label.toLowerCase() : null;
    Object.assign(result, {
      passed,
      value: unread ? null : measured[main.measure],
      valueText: unread ? NO_VALUE : valueTextOf(main.measure, measured[main.measure]),
      unitLabel: unitLabelOf(main.measure, measured[main.measure]),
      targetText: "target " + shortTargetOf(main),
      sentence: unread
        ? unread.text
        : ruleSentence(checks, measured, where, met) + pairSentence(pair, passedAll),
      guards,
      fix: passed === false ? oneFix(given.fix, guards, spec) : null,
    });
    if (passed === true && closes) {
      const jumped =
        spec.kind === LOOP ? jumpsFrom(spec, take, measured, usual, given.cleared) : [];
      result.jumped = jumped;
      result.records = recordsOf(spec, jumped, result.stage, given.inRoom === true);
    }
    return takeResult(result);
  }

  // A result with every field, the ones not given at their "nothing to say" values.
  function takeResult(fields) {
    return Object.assign(
      {
        scored: false,
        passed: null,
        value: null,
        valueText: NO_VALUE,
        unitLabel: "",
        targetText: "",
        sentence: "",
        guards: [],
        fix: null,
        jumped: [],
        records: [],
        stage: null,
      },
      fields,
    );
  }

  // Pace level 2's pair, when the take at `takeIndex` ends one: {pairs, landed, partner}, whether
  // the pair's first read (read from the run's earlier results) landed, and its label.
  // {pairs: false} for every other take.
  function pairVerdictOf(spec, takeIndex, closes, earlier) {
    if (!spec.scoredInPairs || !closes) {
      return { pairs: false, landed: true };
    }
    const partner = listOf(earlier)[takeIndex - 1];
    if (!partner || typeof partner.passed !== "boolean") {
      throw new TypeError(
        "evaluate needs context.earlier[" + (takeIndex - 1) + "], the result of this pair's " +
          "first read: both reads of " + spec.id + " must land",
      );
    }
    const label = takeOf(spec, takeIndex - 1, null).label;
    return { pairs: true, landed: partner.passed, partner: label };
  }

  // What a pair's second read adds to its sentence: that both landed, or which one did not.
  function pairSentence(pair, passedAll) {
    if (!pair.pairs) {
      return "";
    }
    if (!pair.landed) {
      return " " + pair.partner + " did not land, and both reads must land.";
    }
    return passedAll ? " Both reads landed." : "";
  }

  // The one fix a missed scored take names: the fix the speaker chose, else the first failed
  // guard's, else the play's first fix.
  function oneFix(chosen, guards, spec) {
    if (typeof chosen === "string" && chosen.trim() !== "") {
      return chosen;
    }
    const failed = guards.find((guard) => !guard.passed);
    if (failed) {
      return failed.fix;
    }
    return spec.unit && spec.unit.fixes.length > 0 ? spec.unit.fixes[0] : null;
  }

  // What app.store.markLevelCleared keeps when the take passes: a loop's level and every level
  // it jumped, a check-back's stage, a crown's tier, a checkpoint and, cleared in the room, its
  // room record.
  function recordsOf(spec, jumped, stage, inRoom) {
    if (spec.kind === LOOP) {
      return [spec.level.id].concat(jumped);
    }
    if (spec.kind === CHECKBACK) {
      return [spec.level.id + CHECKBACK_RECORD + stage];
    }
    return inRoom ? [spec.id, spec.id + IN_THE_ROOM_SUFFIX] : [spec.id];
  }

  // A check-back's stage: 2 once its first stage has passed, else 1; null for other plays.
  function checkbackStageOf(spec, cleared) {
    if (spec.kind !== CHECKBACK) {
      return null;
    }
    return clearedIds(cleared).has(spec.level.id + CHECKBACK_RECORD + 1) ? 2 : 1;
  }

  // The jump test (spec section 4): a take that passes level N also clears each later level M
  // of its unit, in order, while M has a single scored take of N's kind (talk or read) no longer
  // than this take's set seconds, and the take meets M's conditions and guards against the same
  // baseline. The first M that fails stops the jump; new-material requirements are ignored.
  // Levels already cleared are passed over without being listed again.
  function jumpsFrom(spec, take, measured, usual, cleared) {
    const ids = clearedIds(cleared);
    const jumped = [];
    for (const later of spec.unit.levels.slice(spec.level.number)) {
      const laterSpec = specOf(later.id);
      if (later.takes.filter((each) => each.scored).length !== 1) {
        break;
      }
      const laterTake = takeOf(laterSpec, later.takes.length - 1, usual);
      if (laterTake.read !== take.read || take.seconds < laterTake.seconds) {
        break;
      }
      const meetsRule = laterSpec.conditions.every((condition) => {
        const resolved = resolveCondition(condition, usual, laterTake);
        return meets(resolved, measured[resolved.measure]);
      });
      const guarded = laterSpec.guards.every(
        (id) => guardLine(id, measured, usual, spec.unit.id).passed,
      );
      if (!meetsRule || !guarded) {
        break;
      }
      if (!ids.has(later.id)) {
        jumped.push(later.id);
      }
    }
    return jumped;
  }

  // A condition with its bound worked out: {measure, kind, bound, usual}, kind AT_MOST,
  // AT_LEAST or IN_BAND. A USUAL bound is the baseline's number (null without a baseline);
  // Fillers level 1's is halfway from the usual rate down to its max.
  function resolveCondition(condition, usual, take) {
    if (condition.band === TAKE_BAND) {
      return { measure: condition.measure, kind: IN_BAND, bound: take.band, usual: false };
    }
    if (condition.min !== undefined) {
      return { measure: condition.measure, kind: AT_LEAST, bound: condition.min, usual: false };
    }
    const fromUsual = condition.max === USUAL;
    let bound = condition.max;
    if (fromUsual) {
      bound = usual === null ? null : usual[condition.measure];
    } else if (condition.halfwayFromUsual) {
      bound = usual === null ? null : halfwayTarget(usual.fillersPerMinute, condition.max);
    }
    return { measure: condition.measure, kind: AT_MOST, bound, usual: fromUsual };
  }

  // Halfway from a usual rate down to `floor`, to a tenth, or `floor` for a rate at or under it.
  function halfwayTarget(usualRate, floor) {
    return tenths(usualRate) > tenths(floor) ? roundToTenth((usualRate + floor) / 2) : floor;
  }

  // Whether `value` meets a resolved condition, compared at a tenth, as both are shown.
  function meets(condition, value) {
    if (condition.kind === IN_BAND) {
      return (
        tenths(value) >= tenths(condition.bound[0]) && tenths(value) <= tenths(condition.bound[1])
      );
    }
    if (condition.kind === AT_MOST) {
      return tenths(value) <= tenths(condition.bound);
    }
    return tenths(value) >= tenths(condition.bound);
  }

  // --- Guard lines -----------------------------------------------------------------------------

  // One guard's line for a take: {id, passed, text, fix}, the text the Result shows.
  function guardLine(id, measured, usual, unitId) {
    if (id === TALK_SHARE) {
      return talkShareLine(measured);
    }
    if (id === MIN_WPM) {
      const passed = measured.wpm >= MIN_PACE_WPM;
      const text = passed
        ? measured.wpm + " wpm"
        : measured.wpm + " wpm. Keep a pace of at least " + MIN_PACE_WPM + ".";
      return { id, passed, text, fix: GUARD_FIXES[id] };
    }
    if (id === STEADY_OTHER_SLIPS) {
      return steadyLine(measured, usual, unitId);
    }
    if (id === READ_THROUGH) {
      return readThroughLine(measured);
    }
    throw new Error("Unknown path guard: " + id);
  }

  // "Talked 88 s of 90", or "You talked 50 s of 90. Keep going to at least 72 s."
  function talkShareLine(measured) {
    const needed = roundToTenth(MIN_TALK_SHARE * measured.setSeconds);
    const passed = tenths(measured.speakingSeconds) >= tenths(needed);
    const ofSet = tenthText(measured.speakingSeconds) + " s of " + tenthText(measured.setSeconds);
    const text = passed
      ? "Talked " + ofSet
      : "You talked " + ofSet + ". Keep going to at least " + tenthText(needed) + " s.";
    return { id: TALK_SHARE, passed, text, fix: GUARD_FIXES[TALK_SHARE] };
  }

  // "Other slips steady", or "Other slips rose to 4.1 a minute from 2.0. Keep them within 1 of
  // your usual."
  function steadyLine(measured, usual, unitId) {
    const now = measured.otherPerMinute[unitId];
    const before = usual.otherPerMinute[unitId];
    const passed = tenths(now) <= tenths(before) + tenths(OTHER_SLIPS_ALLOWANCE);
    const text = passed
      ? "Other slips steady"
      : "Other slips rose to " + rateText(now) + " a minute from " + rateText(before) +
        ". Keep them within " + OTHER_SLIPS_ALLOWANCE + " of your usual.";
    return { id: STEADY_OTHER_SLIPS, passed, text, fix: GUARD_FIXES[STEADY_OTHER_SLIPS] };
  }

  // A reading take passes when the backend found it followed its passage and it left out no
  // more than MAX_SKIPPED_IN_ONE_PLACE script words in one place.
  function readThroughLine(measured) {
    let text = "Read the passage through";
    if (!measured.followedScript) {
      text = NOT_FOLLOWED;
    } else if (measured.unreadRun > MAX_SKIPPED_IN_ONE_PLACE) {
      text = notReadThrough(measured.unreadRun).detail;
    }
    const passed = measured.followedScript && measured.unreadRun <= MAX_SKIPPED_IN_ONE_PLACE;
    return { id: READ_THROUGH, passed, text, fix: GUARD_FIXES[READ_THROUGH] };
  }

  function notReadThrough(unread) {
    return {
      passed: false,
      detail:
        "You left out " + unread + " words of the passage in one place. " +
        "Read all of it" + TO_CLEAR_THIS_LEVEL,
    };
  }

  // --- The words of a verdict ------------------------------------------------------------------

  // The rates a rule can judge and what each counts.
  const RATE_WORDS = Object.freeze({
    fillersPerMinute: "fillers a minute",
    restartsPerMinute: "restarts a minute",
    shortMidPerMinute: "mid-sentence pauses a minute",
    weightedPerMinute: "slips a minute in all",
  });
  // The counts a rule can judge, as [one, many].
  const COUNT_WORDS = Object.freeze({
    readSlips: ["slip", "slips"],
    longPauses: ["long pause", "long pauses"],
    restarts: ["restart", "restarts"],
  });

  // The big number: a rate to one decimal ("6.0"), a count or wpm whole, seconds to a tenth.
  function valueTextOf(measureKey, value) {
    if (Object.prototype.hasOwnProperty.call(RATE_WORDS, measureKey)) {
      return rateText(value);
    }
    return measureKey === "cleanStretchSeconds" ? tenthText(value) : String(value);
  }

  // The words under the big number: "fillers a minute", "slips", "wpm", "seconds clean".
  function unitLabelOf(measureKey, value) {
    if (Object.prototype.hasOwnProperty.call(RATE_WORDS, measureKey)) {
      return RATE_WORDS[measureKey];
    }
    if (Object.prototype.hasOwnProperty.call(COUNT_WORDS, measureKey)) {
      return COUNT_WORDS[measureKey][value === 1 ? 0 : 1];
    }
    if (measureKey === "cleanStretchSeconds") {
      return value === 1 ? "second clean" : "seconds clean";
    }
    return "wpm";
  }

  // A measure as a sentence states it: "5.2 fillers a minute", "3 slips (2 restarts and 1
  // misread)", "no long pauses", "152 wpm", "18.2 seconds clean".
  function saidOf(measureKey, measured) {
    const value = measured[measureKey];
    if (Object.prototype.hasOwnProperty.call(RATE_WORDS, measureKey)) {
      return rateText(value) + " " + RATE_WORDS[measureKey];
    }
    if (Object.prototype.hasOwnProperty.call(COUNT_WORDS, measureKey)) {
      const [one, many] = COUNT_WORDS[measureKey];
      if (value === 0) {
        return "no " + many;
      }
      const counted = value + " " + (value === 1 ? one : many);
      return measureKey === "readSlips"
        ? counted + " (" + slipsText(measured.restarts, measured.misreads) + ")"
        : counted;
    }
    if (measureKey === "cleanStretchSeconds") {
      return tenthText(value) + " " + unitLabelOf(measureKey, value);
    }
    return value + " wpm";
  }

  // A condition's bound on the Feedback card: "6", "4", "15 s", "140 to 160".
  function shortTargetOf(condition) {
    if (condition.kind === IN_BAND) {
      return condition.bound[0] + " to " + condition.bound[1];
    }
    const text = condition.usual ? rateText(condition.bound) : tenthText(condition.bound);
    return condition.measure === "cleanStretchSeconds" ? text + " s" : text;
  }

  // The headline condition's bound in a sentence: "6", "15 seconds clean", "140 to 160", or for
  // a count of none, "no long pause".
  function mainTargetOf(condition) {
    if (condition.measure === "cleanStretchSeconds") {
      return tenthText(condition.bound) + " " + unitLabelOf(condition.measure, condition.bound);
    }
    if (condition.kind === AT_MOST && condition.bound === 0) {
      return countLimitText(condition.measure, 0);
    }
    return shortTargetOf(condition);
  }

  // Any other condition's bound in a sentence: "at most 1 long pause", "no long pause", "no
  // more than 2.5 mid-sentence pauses a minute, your usual".
  function extraTargetOf(condition) {
    if (Object.prototype.hasOwnProperty.call(RATE_WORDS, condition.measure)) {
      const bound = condition.usual ? rateText(condition.bound) : tenthText(condition.bound);
      return (
        "no more than " + bound + " " + RATE_WORDS[condition.measure] +
        (condition.usual ? ", your usual" : "")
      );
    }
    return countLimitText(condition.measure, condition.bound);
  }

  // "no long pause", "at most 1 long pause", "at most 2 restarts".
  function countLimitText(measureKey, bound) {
    const [one, many] = COUNT_WORDS[measureKey];
    return bound === 0 ? "no " + one : "at most " + bound + " " + (bound === 1 ? one : many);
  }

  // "5.2 fillers a minute on take 2. The target was 6." The target "was" when the take met the
  // rule's conditions and "is" when it did not.
  function ruleSentence(checks, measured, where, met) {
    const [main, ...extras] = checks.map((check) => check.condition);
    const said = joinAnd(checks.map((check) => saidOf(check.condition.measure, measured)));
    const others = extras.length > 0 ? ", with " + joinAnd(extras.map(extraTargetOf)) : "";
    return (
      capitalize(said) + (where ? " on " + where : "") + ". The target " +
      (met ? "was " : "is ") + mainTargetOf(main) + others + "."
    );
  }

  // "a", "a and b", "a, b and c".
  function joinAnd(parts) {
    if (parts.length < 2) {
      return parts.join("");
    }
    return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  }

  // --- Crowns and the benchmark ----------------------------------------------------------------

  // A crown's one take, judged by its own rule: sudden death or the speed ladder, at the next
  // tier not yet earned. A crown has no guards beyond its judge, which reads a ladder take's
  // passage through itself.
  function judgeCrownTake(spec, report, given) {
    const crown = spec.unit.crown;
    const tier = crownTierOf(crown, given.cleared);
    const facts = factsOf(report);
    const fields = { scored: true, stage: null };
    if (!facts.spoke) {
      Object.assign(fields, { passed: false, sentence: NO_SPEECH });
    } else if (crown.judge === SUDDEN_DEATH) {
      const verdict = judgeSuddenDeath({ runSeconds: tier.seconds }, facts);
      Object.assign(fields, {
        passed: verdict.passed,
        value: verdict.run,
        valueText: clockText(verdict.run),
        unitLabel: "before the first filler or restart",
        targetText: "target " + clockText(tier.seconds),
        sentence: verdict.detail,
      });
    } else {
      const verdict = judgeSpeedLadder(
        { wpm: tier.wpm, toleranceWpm: SPEED_TOLERANCE_WPM, maxRestarts: tier.maxRestarts },
        facts,
      );
      const band = bandAround(tier.wpm);
      Object.assign(fields, {
        passed: verdict.passed,
        value: verdict.readThrough ? facts.wpm : null,
        valueText: verdict.readThrough ? String(facts.wpm) : NO_VALUE,
        unitLabel: "wpm",
        targetText: "target " + band[0] + " to " + band[1],
        sentence: verdict.detail,
      });
    }
    fields.fix = fields.passed ? null : oneFix(given.fix, [], spec);
    fields.records = fields.passed ? [tier.record] : [];
    return takeResult(fields);
  }

  // suddenDeath: the run is the time from the first word to the first filler or restart, or to
  // the last word when there is neither. The tier is earned once the run reaches
  // pass.runSeconds.
  function judgeSuddenDeath(pass, facts) {
    const first = facts.slips.length > 0 ? facts.slips[0] : null;
    const end = first ? first.at : facts.speechStart + facts.speakingSeconds;
    const run = roundToTenth(Math.max(0, end - facts.speechStart));
    const passed = run >= pass.runSeconds;
    const target = clockText(pass.runSeconds);
    let saidText = "No filler or restart, but you spoke for only " + clockText(run) + ".";
    if (first) {
      saidText = "Your run lasted " + clockText(run) + " before " + first.name + ".";
    } else if (passed) {
      saidText = "No filler or restart in " + clockText(run) + " of speech.";
    }
    let next = "Keep going to " + target + TO_EARN_THIS_CROWN;
    if (passed) {
      next = CROWN_EARNED + ": the target was " + target + ".";
    } else if (first) {
      next = "Reach " + target + TO_EARN_THIS_CROWN;
    }
    return { passed, run, detail: saidText + " " + next };
  }

  // speedLadder: earned when the take followed the passage, the pace the Pace card shows (wpm,
  // rounded) is within pass.toleranceWpm of pass.wpm and it has at most pass.maxRestarts
  // restarts. `readThrough` says whether the take read the passage through at all.
  function judgeSpeedLadder(pass, facts) {
    if (!facts.followedScript) {
      return { passed: false, readThrough: false, detail: NOT_FOLLOWED };
    }
    const unread = longestSkipRun(facts.skips);
    if (unread > MAX_SKIPPED_IN_ONE_PLACE) {
      return Object.assign(notReadThrough(unread), { readThrough: false });
    }
    const lo = pass.wpm - pass.toleranceWpm;
    const hi = pass.wpm + pass.toleranceWpm;
    const band = lo + " to " + hi + " wpm";
    const fixes = [];
    if (facts.wpm > hi) {
      fixes.push("slow down to " + band);
    } else if (facts.wpm < lo) {
      fixes.push("speed up to " + band);
    }
    if (facts.restartCount > pass.maxRestarts) {
      fixes.push("keep restarts to " + pass.maxRestarts + " or fewer");
    }
    const saidText =
      "You read at " + facts.wpm + " wpm with " + countText(facts.restartCount, "restart") + ".";
    if (fixes.length === 0) {
      return {
        passed: true,
        readThrough: true,
        detail: saidText + " " + CROWN_EARNED + ": the target was " + band + ".",
      };
    }
    const fix = capitalize(fixes.join(" and "));
    return { passed: false, readThrough: true, detail: saidText + " " + fix + TO_EARN_THIS_CROWN };
  }

  // A benchmark take is measured, never judged: the read's slips and the talk's fillers, each
  // at its pace.
  function describeBenchmarkTake(spec, takeIndex, report) {
    const take = takeOf(spec, takeIndex, null);
    if (take === null) {
      throw new RangeError("The benchmark has two takes: 0 for the read, 1 for the talk");
    }
    const measured = measure(report, take.seconds);
    if (!measured.spoke) {
      return takeResult({ sentence: NO_SPEECH });
    }
    if (take.read) {
      const through = readThroughLine(measured);
      if (!through.passed) {
        return takeResult({ unitLabel: "slips", sentence: through.text });
      }
      return takeResult({
        value: measured.readSlips,
        valueText: String(measured.readSlips),
        unitLabel: unitLabelOf("readSlips", measured.readSlips),
        sentence: capitalize(saidOf("readSlips", measured)) + " at " + measured.wpm + " wpm.",
      });
    }
    return takeResult({
      value: measured.fillersPerMinute,
      valueText: rateText(measured.fillersPerMinute),
      unitLabel: RATE_WORDS.fillersPerMinute,
      sentence: saidOf("fillersPerMinute", measured) + " at " + measured.wpm + " wpm.",
    });
  }

  // --- Reading a report ------------------------------------------------------------------------

  // The numbers the judges read from a report, each checked, so a malformed report fails a
  // take instead of throwing.
  function factsOf(report) {
    const given = report && typeof report === "object" ? report : {};
    const speechStart = isFiniteNumber(given.speechStart) ? given.speechStart : null;
    const speakingSeconds = numberOr0(given.speakingSeconds);
    const clean = given.cleanStretch;
    return {
      spoke: speechStart !== null && speakingSeconds > 0,
      speechStart,
      speakingSeconds,
      wpm: Math.round(numberOr0(given.wordsPerMinute)),
      slips: slipsOf(given),
      restartCount: numberOr0(given.repeatCount),
      followedScript: given.followedScript === true,
      misreadCount: listOf(given.misreads).length,
      skips: listOf(given.skips),
      cleanStretchSeconds: clean && typeof clean === "object" ? numberOr0(clean.seconds) : 0,
    };
  }

  // Every filler and restart as {at, name}, earliest first. `name` is how a verdict names it:
  // “um”, or you restarted “the few decisions”. A restart is at the start of the phrase the
  // speaker went back over, where delivery.js ends a clean stretch and Results marks it.
  function slipsOf(report) {
    const fillers = listOf(report.fillers)
      .filter((filler) => filler && isFiniteNumber(filler.start))
      .map((filler) => ({
        at: filler.start,
        name: filler.text ? quoted(filler.text) : "a filler",
      }));
    const restarts = listOf(report.restarts)
      .filter((restart) => restart && isFiniteNumber(restart.at))
      .map((restart) => ({
        at: restart.at,
        name: restart.text ? "you restarted " + quoted(restart.text) : "a restart",
      }));
    return fillers.concat(restarts).sort((a, b) => a.at - b.at);
  }

  // The most script words skipped in one place. Skips come in script order, and the words
  // skipped in one place share their `at`, the end of the word said before them.
  function longestSkipRun(skips) {
    let longest = 0;
    let run = 0;
    let at = null;
    skips.forEach((skip) => {
      const here = skip && isFiniteNumber(skip.at) ? skip.at : null;
      const samePlace = here !== null && at !== null && Math.abs(here - at) < MILLISECOND;
      run = samePlace ? run + 1 : 1;
      at = here;
      longest = Math.max(longest, run);
    });
    return longest;
  }

  // "no restarts or misreads", "2 restarts and no misreads", "1 restart and 2 misreads".
  function slipsText(restarts, misreads) {
    if (restarts === 0 && misreads === 0) {
      return "no restarts or misreads";
    }
    return countText(restarts, "restart") + " and " + countText(misreads, "misread");
  }

  // --- Weakest unit first ----------------------------------------------------------------------

  // The units, the weakest first: each unit's distance from its target (distancesFromTarget)
  // over the speaker's RECENT_TAKES latest takes with speech, ranked as
  // backend/advice/select.py weakest_skills ranks one take. The takes' distances are averaged
  // with each take weighted by its speaking minutes, so a rate reads as the rate over all their
  // minutes together: 5 s of a take the speaker gave up on weigh what 5 s of any take weigh,
  // and one take alone ranks exactly as weakest_skills ranks it. `history` is the takes as
  // app.store.list() resolves them, in any order; the sample a visitor opens from Practice is
  // left out, as Progress leaves it out. Ties, and a speaker with no takes, keep UNITS' order.
  function order(history) {
    const recent = recentDistances(history);
    if (recent.length === 0) {
      return UNITS.slice();
    }
    const minutes = recent.reduce((sum, take) => sum + take.minutes, 0);
    const average = {};
    UNITS.forEach((entry) => {
      const total = recent.reduce((sum, take) => sum + take.distances[entry.id] * take.minutes, 0);
      average[entry.id] = roundTo(total / minutes, TIE_DECIMALS);
    });
    return UNITS.slice().sort((a, b) => average[b.id] - average[a.id]);
  }

  // The RECENT_TAKES latest takes that hold speech, newest first, each as {distances, minutes}:
  // its distance for each unit and its speaking time.
  function recentDistances(history) {
    const takes = listOf(history)
      .filter((take) => take && typeof take === "object" && isOwnTake(take))
      .sort(newestFirst);
    const recent = [];
    for (const take of takes) {
      if (recent.length === RECENT_TAKES) {
        break;
      }
      const measured = unitDistancesOf(take);
      if (measured !== null) {
        recent.push(measured);
      }
    }
    return recent;
  }

  // One take as {distances, minutes}: its distance from target for each unit, by unit id, and
  // its speaking minutes; null for a take with no speaking time, which says nothing about any
  // skill. Pace has a tag for each edge of its band and reads the edge the take is nearer, the
  // one weakest_skills ranks (the far one goes last).
  function unitDistancesOf(take) {
    const report = app.delivery.analyze(take.transcript, take.metrics);
    if (!(report.speakingSeconds > 0)) {
      return null;
    }
    const byTag = distancesFromTarget(report, paceBandOf(take.passageId));
    const distances = {};
    UNITS.forEach((entry) => {
      distances[entry.id] = Math.max(...entry.tags.map((tag) => byTag[tag]));
    });
    return { distances, minutes: report.speakingSeconds / SECONDS_PER_MINUTE };
  }

  // select.py distances_from_target for the tags the path has a unit for (none trains
  // mid_pause), read from a delivery report as select.py's ReportSummary is. Every skill reads
  // on one scale, above 0 past its target: a rate is its share of its target less one, each
  // long pause is a full step past a target of none (a take without one reads NONE_AT_ALL),
  // and pace counts band widths past an edge of the band.
  function distancesFromTarget(report, band) {
    const minutes = report.speakingSeconds / SECONDS_PER_MINUTE;
    const [lo, hi] = band;
    const wpm = report.wordsPerMinute;
    const longPauses = report.longPauseCount;
    return {
      restart: report.repeatCount / minutes / RESTARTS_PER_MINUTE_TARGET - 1,
      filler: report.fillerCount / minutes / FILLERS_PER_MINUTE_TARGET - 1,
      long_pause: longPauses > LONG_PAUSES_TARGET ? longPauses : NONE_AT_ALL,
      pace_fast: (wpm - hi) / (hi - lo),
      pace_slow: (lo - wpm) / (hi - lo),
    };
  }

  // The pace band of the take's passage, the one Results judges it against, or
  // DEFAULT_TARGET_WPM for a passage that is gone or a band that is not two numbers, low first.
  function paceBandOf(passageId) {
    const passages = Array.isArray(app.passages) ? app.passages : [];
    const passage = passages.concat(coldReadPassages()).find((entry) => entry.id === passageId);
    const band = passage ? passage.targetWpm : null;
    const valid =
      Array.isArray(band) && band.length === 2 && band.every(isFiniteNumber) && band[0] < band[1];
    return valid ? band : DEFAULT_TARGET_WPM;
  }

  // False for the bundled sample (app.screens.results.isSample), as Progress reads it; without
  // the Results module every take is the speaker's own.
  function isOwnTake(take) {
    const results = app.screens ? app.screens.results : undefined;
    return !(results && typeof results.isSample === "function" && results.isSample(take));
  }

  // ISO 8601 times order correctly as plain text; a take without one sorts last.
  function newestFirst(a, b) {
    const first = String(a.createdAt || "");
    const second = String(b.createdAt || "");
    if (first === second) {
      return 0;
    }
    return first < second ? 1 : -1;
  }

  // --- Unlocking ------------------------------------------------------------------------------

  // `cleared` is the speaker's cleared records as app.store.listClearedLevels() resolves them,
  // [{levelId, clearedAt}]; a record without a text levelId is skipped.
  function clearedIds(cleared) {
    return new Set(
      listOf(cleared)
        .filter((record) => record && typeof record.levelId === "string")
        .map((record) => record.levelId),
    );
  }

  // Whether `level` can be played: a unit's first level always, any other once the level right
  // before it in its unit is cleared. Each unit climbs on its own, so reordering the units by
  // weakness never locks a level the speaker has opened.
  function isUnlocked(level, cleared) {
    const before = levelBefore(level);
    return before === null || clearedIds(cleared).has(before.id);
  }

  // "cleared", "current" (unlocked, not cleared yet), "locked", or "resting": unlocked and not
  // cleared, but out of attempts on the local day `today` ("YYYY-MM-DD"), read from the saved
  // takes in `history` (attemptsLeft). Without a day nothing rests. `level` is a level or its id.
  function statusOf(level, cleared, history, today) {
    const id = level && typeof level === "object" ? level.id : level;
    const known = levelById(id);
    if (known === null) {
      throw new Error("Unknown path level: " + id);
    }
    if (clearedIds(cleared).has(known.id)) {
      return CLEARED;
    }
    if (!isUnlocked(known, cleared)) {
      return LOCKED;
    }
    const day = localDay(today);
    return day !== null && attemptsLeft(known.id, history, day) === 0 ? RESTING : CURRENT;
  }

  // The unit's first level not cleared yet, which is always unlocked, or null once all are.
  function currentLevel(pathUnit, cleared) {
    const ids = clearedIds(cleared);
    return pathUnit.levels.find((level) => !ids.has(level.id)) || null;
  }

  // The level before `level` in its unit, or null for a unit's first level.
  function levelBefore(level) {
    const known = levelById(level ? level.id : undefined);
    if (known === null) {
      throw new Error("Unknown path level: " + (level ? level.id : level));
    }
    return known.number === 1 ? null : levelById(known.unit + "-" + (known.number - 1));
  }

  // --- Rest days and check-backs (spec sections 4 and 5) -------------------------------------

  // How many scored attempts the loop `levelId` has left on the local day `today`, from
  // ATTEMPTS_PER_DAY down to 0. Only today's misses use one up: saved takes in `history` whose
  // `path` is {kind: "loop", play: levelId, scored: true, passed: false} and that end an attempt
  // (Pace level 2's pair ends on its second read; a take saved without its number ends one).
  function attemptsLeft(levelId, history, today) {
    const spec = specOf(levelId);
    if (spec === null || spec.kind !== LOOP) {
      throw new Error("Unknown path level: " + levelId);
    }
    const day = localDay(today);
    const misses = ownTakes(history).filter((take) => {
      const saved = pathOf(take);
      return (
        saved !== null &&
        saved.kind === LOOP &&
        saved.play === levelId &&
        saved.scored === true &&
        saved.passed === false &&
        localDay(take.createdAt) === day &&
        endsAttempt(spec, saved.take)
      );
    });
    return Math.max(0, ATTEMPTS_PER_DAY - misses.length);
  }

  // Whether take number `takeNumber` (1 for take 1) of a loop ends an attempt.
  function endsAttempt(spec, takeNumber) {
    const numbered = Number.isInteger(takeNumber) && takeNumber >= 1;
    return !numbered || closesAttempt(spec, takeNumber - 1);
  }

  // A saved take's Path fields ({play, kind, take, scored, passed, stage, inRoom}), or null for
  // a plain take.
  function pathOf(take) {
    const saved = take.path;
    return saved && typeof saved === "object" && typeof saved.play === "string" ? saved : null;
  }

  // A cleared level's ring: "none", "half" once its first check-back has passed, or "gold"
  // ("Locked in") once its second has.
  function ringOf(levelId, cleared) {
    const ids = clearedIds(cleared);
    if (ids.has(levelId + CHECKBACK_RECORD + 2)) {
      return GOLD_RING;
    }
    return ids.has(levelId + CHECKBACK_RECORD + 1) ? HALF_RING : NO_RING;
  }

  // Every cleared level not yet gold, with its next check-back: [{levelId, stage, dueOn, due}].
  // Stage 1 is due FIRST_CHECKBACK_DAYS after the level was cleared; stage 2, once stage 1 has
  // passed, SECOND_CHECKBACK_DAYS after, or AFTER_FIRST_CHECKBACK_DAYS after stage 1's pass if
  // that is later. A miss (a saved take whose `path` is {kind: "checkback", play:
  // "<level>_checkback", stage, passed: false}) makes its stage due again AFTER_A_MISS_DAYS
  // after it; nothing ever locks. `due` says whether `dueOn` has come on the local day `today`.
  // Due ones come first, by date, then by unit and level order; then the rest, the same way.
  function checkbacks(cleared, history, today) {
    const day = localDay(today);
    const clearedOn = clearedDays(cleared);
    const misses = checkbackMisses(history);
    const list = [];
    UNITS.forEach((pathUnit, unitIndex) => {
      pathUnit.levels.forEach((level) => {
        const levelOn = clearedOn.get(level.id);
        if (levelOn === undefined || clearedOn.has(level.id + CHECKBACK_RECORD + 2)) {
          return;
        }
        const firstPassedOn = clearedOn.get(level.id + CHECKBACK_RECORD + 1);
        const stage = firstPassedOn === undefined ? 1 : 2;
        let dueOn =
          stage === 1
            ? addDays(levelOn, FIRST_CHECKBACK_DAYS)
            : laterDay(
                addDays(levelOn, SECOND_CHECKBACK_DAYS),
                addDays(firstPassedOn, AFTER_FIRST_CHECKBACK_DAYS),
              );
        const missedOn = misses.get(level.id + CHECKBACK_SUFFIX + "/" + stage);
        if (missedOn !== undefined) {
          dueOn = laterDay(dueOn, addDays(missedOn, AFTER_A_MISS_DAYS));
        }
        list.push({
          entry: { levelId: level.id, stage, dueOn, due: day !== null && dueOn <= day },
          order: [unitIndex, level.number],
        });
      });
    });
    list.sort(
      (a, b) =>
        Number(b.entry.due) - Number(a.entry.due) ||
        compareText(a.entry.dueOn, b.entry.dueOn) ||
        a.order[0] - b.order[0] ||
        a.order[1] - b.order[1],
    );
    return list.map((item) => item.entry);
  }

  // The local day each readable cleared record was kept on, by record id.
  function clearedDays(cleared) {
    const days = new Map();
    listOf(cleared).forEach((entry) => {
      const day = entry && typeof entry.levelId === "string" ? localDay(entry.clearedAt) : null;
      if (day !== null) {
        days.set(entry.levelId, day);
      }
    });
    return days;
  }

  // The latest local day each check-back stage was missed, by "<play>/<stage>".
  function checkbackMisses(history) {
    const latest = new Map();
    ownTakes(history).forEach((take) => {
      const saved = pathOf(take);
      const day = localDay(take.createdAt);
      if (saved === null || saved.kind !== CHECKBACK || saved.passed !== false || day === null) {
        return;
      }
      const key = saved.play + "/" + saved.stage;
      if (!latest.has(key) || latest.get(key) < day) {
        latest.set(key, day);
      }
    });
    return latest;
  }

  // --- Crowns, checkpoints, the benchmark and the week ----------------------------------------

  // The crown beside a unit's level 3, or null for a unit without one: {id, unit, label, open,
  // tiers, earned, complete, next}. `open` once level 3 is cleared; `tiers` each with `earned`;
  // `earned` how many are; `complete` when all are; `next` the first tier not yet earned, or
  // null.
  function crownState(unitId, cleared) {
    const pathUnit = UNITS.find((entry) => entry.id === unitId);
    if (!pathUnit || !pathUnit.crown) {
      return null;
    }
    const ids = clearedIds(cleared);
    const tiers = pathUnit.crown.tiers.map((tier) =>
      Object.assign({}, tier, { earned: ids.has(tier.record) }),
    );
    const earned = tiers.filter((tier) => tier.earned).length;
    return deepFreeze({
      id: pathUnit.crown.id,
      unit: pathUnit.id,
      label: pathUnit.crown.label,
      open: ids.has(pathUnit.id + "-" + CROWN_OPENS_AFTER_LEVEL),
      tiers,
      earned,
      complete: earned === tiers.length,
      next: tiers.find((tier) => !tier.earned) || null,
    });
  }

  // The checkpoint after a unit's level 5, or null for an unknown unit: {id, unit, label, open,
  // cleared, inRoom}. `open` once level 5 is cleared; `inRoom` once it was cleared with someone
  // listening.
  function checkpointState(unitId, cleared) {
    const pathUnit = UNITS.find((entry) => entry.id === unitId);
    if (!pathUnit) {
      return null;
    }
    const ids = clearedIds(cleared);
    const checkpoint = pathUnit.checkpoint;
    return deepFreeze({
      id: checkpoint.id,
      unit: pathUnit.id,
      label: checkpoint.label,
      open: ids.has(pathUnit.levels[pathUnit.levels.length - 1].id),
      cleared: ids.has(checkpoint.id),
      inRoom: ids.has(checkpoint.id + IN_THE_ROOM_SUFFIX),
    });
  }

  // The benchmark's sittings and when the next is due: {due, nextOn, sittings: [{on, readSlips,
  // readWpm, fillersPerMinute, weightedPerMinute, wpm}]}. A sitting is the benchmark takes saved
  // on one local day (their `path.kind` "benchmark"): the read's slips (null when it did not
  // read the passage through) and pace, and the talk's fillers, weighted slips and pace, each
  // null when that take is missing; the latest of each counts. Sittings come oldest first. The
  // benchmark is due with no sitting yet, or BENCHMARK_EVERY_DAYS after the latest; `nextOn` is
  // that day, or `today` before the first sitting. A benchmark never clears or locks anything.
  function benchmarkState(history, today) {
    const day = localDay(today);
    const byDay = new Map();
    ownTakes(history)
      .filter((take) => {
        const saved = pathOf(take);
        return saved !== null && saved.kind === BENCHMARK && localDay(take.createdAt) !== null;
      })
      .sort((a, b) => newestFirst(b, a))
      .forEach((take) => {
        const on = localDay(take.createdAt);
        const takes = byDay.get(on) || {};
        if (take.passageId === BENCHMARK_READ_ID) {
          takes.read = take;
        } else if (take.passageId === BENCHMARK_TALK_ID) {
          takes.talk = take;
        }
        byDay.set(on, takes);
      });
    const sittings = Array.from(byDay.keys())
      .sort(compareText)
      .map((on) => sittingOf(on, byDay.get(on)));
    if (sittings.length === 0) {
      return { due: true, nextOn: day, sittings };
    }
    const nextOn = addDays(sittings[sittings.length - 1].on, BENCHMARK_EVERY_DAYS);
    return { due: day !== null && day >= nextOn, nextOn, sittings };
  }

  function sittingOf(on, takes) {
    const measuredOf = (take, seconds) =>
      take ? measure(app.delivery.analyze(take.transcript, take.metrics), seconds) : null;
    const read = measuredOf(takes.read, COLD_READ_SECONDS);
    const talked = measuredOf(takes.talk, BENCHMARK_TALK_SECONDS);
    const readSpoke = read !== null && read.spoke;
    const talkSpoke = talked !== null && talked.spoke;
    const readThrough =
      readSpoke && read.followedScript && read.unreadRun <= MAX_SKIPPED_IN_ONE_PLACE;
    return {
      on,
      readSlips: readThrough ? read.readSlips : null,
      readWpm: readSpoke ? read.wpm : null,
      fillersPerMinute: talkSpoke ? talked.fillersPerMinute : null,
      weightedPerMinute: talkSpoke ? talked.weightedPerMinute : null,
      wpm: talkSpoke ? talked.wpm : null,
    };
  }

  // This week's practice: {days, goal}, `days` the local days, Monday to Sunday of the week of
  // `today`, with at least one own take, and `goal` WEEK_GOAL_DAYS.
  function weekDays(history, today) {
    const day = localDay(today);
    if (day === null) {
      return { days: 0, goal: WEEK_GOAL_DAYS };
    }
    const monday = addDays(day, -((weekdayOf(day) + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK));
    const sunday = addDays(monday, DAYS_PER_WEEK - 1);
    const days = new Set(
      ownTakes(history)
        .map((take) => localDay(take.createdAt))
        .filter((on) => on !== null && on >= monday && on <= sunday),
    );
    return { days: days.size, goal: WEEK_GOAL_DAYS };
  }

  // --- Days -----------------------------------------------------------------------------------

  // The local calendar day ("2026-10-14") of a time: an ISO string or a Date, on this device's
  // clock face, so a take at 23:50 counts for its own day. A day string comes back as it is.
  // Null for anything that is not a real time or day.
  function localDay(value) {
    if (typeof value === "string" && DAY_PATTERN.test(value)) {
      return dayNumberOf(value) === null ? null : value;
    }
    const isDate = Object.prototype.toString.call(value) === "[object Date]";
    let date = null;
    if (typeof value === "string" && value !== "") {
      date = new Date(value);
    } else if (isDate) {
      date = value;
    }
    if (date === null || Number.isNaN(date.getTime())) {
      return null;
    }
    return dayText(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  // The local day `days` after `day` (before it for a negative count), or null for a day that is
  // not one or a count that is not whole.
  function addDays(day, days) {
    const number = typeof day === "string" ? dayNumberOf(day) : null;
    if (number === null || !Number.isInteger(days)) {
      return null;
    }
    const date = new Date((number + days) * MS_PER_DAY);
    return dayText(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  // A day as a count of days since 1970-01-01 (a calendar count, free of time zones), or null
  // for text that is not a real day ("2026-02-30").
  function dayNumberOf(day) {
    const match = DAY_PATTERN.exec(day);
    if (match === null) {
      return null;
    }
    const [year, month, date] = match.slice(1).map(Number);
    const utc = Date.UTC(year, month - 1, date);
    const back = new Date(utc);
    const real =
      back.getUTCFullYear() === year &&
      back.getUTCMonth() === month - 1 &&
      back.getUTCDate() === date;
    return real ? utc / MS_PER_DAY : null;
  }

  // 0 for a Sunday to 6 for a Saturday.
  function weekdayOf(day) {
    return new Date(dayNumberOf(day) * MS_PER_DAY).getUTCDay();
  }

  function dayText(year, month, date) {
    return (
      String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-" +
      String(date).padStart(2, "0")
    );
  }

  // The later of two days ("YYYY-MM-DD" order as text).
  function laterDay(a, b) {
    return a >= b ? a : b;
  }

  function compareText(a, b) {
    if (a === b) {
      return 0;
    }
    return a < b ? -1 : 1;
  }

  // --- Material -------------------------------------------------------------------------------

  // What a play's take is said or read on, as Practice's level mode takes it: {kind: "prompt" |
  // "passage", id, title, text, targetWpm, topic}. `text` is what Practice shows: a prompt's
  // topic, or the passage, which is also the script sent with the take; `topic` is the topic on
  // a prompt, else null. A topic or a cold read is drawn with `random` (such as Math.random), so
  // a screen calls this once at the Goal step and keeps the material for every take of a loop.
  // A ladder read's targetWpm is its take's band, `takeIndex` (0 for take 1) saying which take.
  function materialFor(play, history, random, takeIndex) {
    const spec = specOf(play && typeof play === "object" ? play.id : play);
    if (spec === null) {
      throw new Error("Unknown path play: " + (play && typeof play === "object" ? play.id : play));
    }
    const index = Number.isInteger(takeIndex) && takeIndex >= 0 ? takeIndex : 0;
    if (spec.material === YOUR_DAY) {
      return promptMaterial(YOUR_DAY_PROMPT_ID, history, random);
    }
    if (spec.material === IMPROMPTU || spec.material === NEW_TOPIC) {
      return promptMaterial(IMPROMPTU_PROMPT_ID, history, random);
    }
    if (spec.material === COLD_READ) {
      return passageMaterial(pickColdRead(history, random), null);
    }
    if (spec.material === LADDER) {
      return passageMaterial(passageById(LADDER_PASSAGE_ID), takeOf(spec, index, null).band);
    }
    return benchmarkMaterial(index);
  }

  // The benchmark's held-out material from app.passages.benchmark(): its passage for the read
  // (take 1) and its prompt, on its one topic, for the talk (take 2).
  function benchmarkMaterial(index) {
    const passages = app.passages;
    if (!passages || typeof passages.benchmark !== "function") {
      throw new Error("path.js needs app.passages.benchmark() from passages.js");
    }
    const held = passages.benchmark();
    if (index === 0) {
      return passageMaterial(held.read, null);
    }
    const topic = held.talk.topics[0];
    return {
      kind: "prompt",
      id: held.talk.id,
      title: held.talk.title,
      text: topic,
      targetWpm: Array.from(held.talk.targetWpm),
      topic,
    };
  }

  function promptMaterial(promptId, history, random) {
    const prompt = passageById(promptId);
    const topic = pickTopic(history, promptId, random);
    return {
      kind: "prompt",
      id: prompt.id,
      title: prompt.title,
      text: topic,
      targetWpm: Array.from(prompt.targetWpm),
      topic,
    };
  }

  function passageMaterial(passage, band) {
    return {
      kind: "passage",
      id: passage.id,
      title: passage.title,
      text: passage.text,
      targetWpm: Array.from(band || passage.targetWpm),
      topic: null,
    };
  }

  // A topic of the prompt `promptId` ("free-talk" or "impromptu") for the next take: one no own
  // take in `history` was given (its `topic`), drawn with `random`, a function returning a number
  // in [0, 1) such as Math.random; once every topic has been used, the one used longest ago.
  // `exclude` is a topic, or a list of them, to pass over while any other is left. Null for a
  // prompt with no topics.
  function pickTopic(history, promptId, random, exclude) {
    if (typeof random !== "function") {
      throw new TypeError("pickTopic needs a random source, such as Math.random");
    }
    const prompt = passageById(promptId);
    const topics = prompt && Array.isArray(prompt.topics) ? Array.from(prompt.topics) : [];
    if (topics.length === 0) {
      return null;
    }
    const avoided = new Set(typeof exclude === "string" ? [exclude] : listOf(exclude));
    const allowed = topics.filter((topic) => !avoided.has(topic));
    const pool = allowed.length > 0 ? allowed : topics;
    const takes = ownTakes(history);
    const used = new Set(takes.map((take) => take.topic));
    const unused = pool.filter((topic) => !used.has(topic));
    if (unused.length > 0) {
      return unused[indexFor(random(), unused.length)];
    }
    return leastRecent(pool, takes, (topic, take) => take.topic === topic);
  }

  // The speaker's most used fillers over their RECENT_TAKES latest own takes, at most
  // TOP_FILLERS of them, as [{text, count}]: the filler's text lowercased ("um", "you know"),
  // most used first, a tie going to the one heard first, oldest take first. [] with none.
  function topFillers(history) {
    const takes = ownTakes(history).sort(newestFirst).slice(0, RECENT_TAKES).reverse();
    const counts = new Map();
    takes.forEach((take) => {
      listOf(app.delivery.analyze(take.transcript, take.metrics).fillers).forEach((filler) => {
        const text = String((filler && filler.text) || "").toLowerCase();
        if (text !== "") {
          counts.set(text, (counts.get(text) || 0) + 1);
        }
      });
    });
    return Array.from(counts, ([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_FILLERS);
  }

  // --- Cold reads -----------------------------------------------------------------------------

  // A cold read for the next take: a passage from app.passages.coldReads() the speaker has
  // never read (no take in `history` has its id), drawn with `random`, a function returning a
  // number in [0, 1) such as Math.random, so a test can fix the draw. Once every cold read has
  // been read, the one read longest ago comes back, as backend advice does once every entry has
  // been shown. Null when there are no cold reads.
  function pickColdRead(history, random) {
    if (typeof random !== "function") {
      throw new TypeError("pickColdRead needs a random source, such as Math.random");
    }
    const coldReads = coldReadPassages();
    const takes = listOf(history).filter((take) => take && typeof take === "object");
    const read = new Set(takes.map((take) => take.passageId));
    const unread = coldReads.filter((passage) => !read.has(passage.id));
    if (unread.length > 0) {
      return unread[indexFor(random(), unread.length)];
    }
    return leastRecent(coldReads, takes, (passage, take) => take.passageId === passage.id);
  }

  // The draw as an index into a list of `length`, kept inside it whatever the source returns.
  function indexFor(draw, length) {
    const index = Math.floor(Number(draw) * length);
    return Number.isFinite(index) ? Math.min(length - 1, Math.max(0, index)) : 0;
  }

  // The item whose latest take (sameItem(item, take)) is the oldest, an item never taken first
  // of all; a tie goes to the one listed first.
  function leastRecent(items, takes, sameItem) {
    let oldest = null;
    let oldestAt = null;
    items.forEach((item) => {
      const at = takes
        .filter((take) => sameItem(item, take))
        .map((take) => String(take.createdAt || ""))
        .reduce((latest, time) => (time > latest ? time : latest), "");
      if (oldest === null || at < oldestAt) {
        oldest = item;
        oldestAt = at;
      }
    });
    return oldest;
  }

  function coldReadPassages() {
    const passages = app.passages;
    return passages && typeof passages.coldReads === "function" ? passages.coldReads() : [];
  }

  function passageById(id) {
    const passages = Array.isArray(app.passages) ? app.passages : [];
    return passages.find((entry) => entry.id === id) || null;
  }

  // --- Small helpers --------------------------------------------------------------------------

  // m:ss, as app.ui.formatClock writes it; kept here so path.js loads without ui.js.
  function clockText(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
    return minutes + ":" + String(whole % SECONDS_PER_MINUTE).padStart(2, "0");
  }

  // "no restarts", "1 restart", "3 restarts".
  function countText(count, noun) {
    if (count === 0) {
      return "no " + noun + "s";
    }
    return count === 1 ? "1 " + noun : count + " " + noun + "s";
  }

  // A rate as the screens show it, to one decimal: "6.0".
  function rateText(value) {
    return roundToTenth(value).toFixed(1);
  }

  // A number to a tenth, with no trailing ".0": "88", "71.9".
  function tenthText(value) {
    return String(roundToTenth(value));
  }

  // A number in tenths, as a whole number, so values shown to a tenth compare exactly.
  function tenths(value) {
    return Math.round(numberOr0(value) * 10);
  }

  function quoted(text) {
    return "“" + text + "”";
  }

  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function listOf(value) {
    return Array.isArray(value) ? value : [];
  }

  function sumOf(list, valueOf) {
    return list.reduce((sum, item) => sum + valueOf(item), 0);
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function numberOr0(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function roundToTenth(value) {
    return Math.round(value * 10) / 10;
  }

  function roundTo(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  // Freezes the path data all the way down, so no caller can change a level another reads.
  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }

  app.path = {
    UNITS,
    levelById,
    playById,
    takeAt,
    order,
    measure,
    baseline,
    evaluate,
    isUnlocked,
    statusOf,
    currentLevel,
    ringOf,
    attemptsLeft,
    checkbacks,
    crownState,
    checkpointState,
    benchmarkState,
    weekDays,
    materialFor,
    pickTopic,
    pickColdRead,
    topFillers,
    localDay,
    addDays,
  };
})();
