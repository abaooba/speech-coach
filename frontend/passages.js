/* passages.js: app.passages, the fixed material for the Practice screen. Each entry is
   {id, kind, title, text, targetWpm: [lo, hi], source?, format?, timeLimitSeconds?, topics?}.
   Kind "prompt" is a timed topic to talk on (the Talk tab) and kind "passage" is read aloud word
   for word (the Read tab). Prompts come first: Practice opens on the first entry. No DOM here. */
(function () {
  "use strict";

  // One topic shows at a time and New topic moves to the next, so each prompt's text repeats
  // its first topic and every entry still has text.
  const YOUR_DAY_TOPICS = [
    "Talk about the best part of your day and why it stood out.",
    "Walk through your morning, from waking up to your first class.",
    "Describe something you learned today and how you would teach it.",
    "Tell the story of a small problem you solved today.",
    "Describe a meal you ate today as if you were reviewing it.",
    "Explain what you plan to do after school and why.",
    "Talk about a conversation today that made you think.",
    "Describe a place you spent time today, using three senses.",
  ];

  const IMPROMPTU_TOPICS = [
    "Explain one rule your school should change, and say why.",
    "Argue for or against school uniforms, with two clear reasons.",
    "Should every student learn a second language? Take a side.",
    "Argue whether homework should be optional in high school.",
    "Make the case for or against a four-day school week.",
    "Should phones be banned during the school day? Defend your answer.",
    "Argue whether voting should start at age sixteen.",
    "Make the case for one change that would improve your town.",
  ];

  const REBUTTAL_UNIFORMS = [
    "My opponents claim that uniforms erase bullying, but the evidence says otherwise.",
    "Students who want to single someone out will find a reason, whether it is shoes,",
    "a backpack, or a phone. The real problem is school culture, and a dress code does",
    "not change culture. Second, they argue that uniforms save families money. In",
    "practice, parents still buy everyday clothes for evenings and weekends, which makes",
    "the uniform an added cost, not a replacement. Consider what we lose.",
    "Choosing how to present yourself is one of the few decisions a student makes every",
    "day. Taking that away teaches compliance, not confidence. The proposal fails on",
    "its own terms.",
  ].join(" ");

  const REBUTTAL_HOMEWORK = [
    "My opponents argue that homework builds discipline, but the examples they offer show",
    "effort, not learning. Discipline comes from habits a student chooses, not from",
    "worksheets handed out at night. They also say homework prepares students for college.",
    "Yet a seventh grader who sleeps six hours is not preparing for anything. Tired",
    "students retain less, and the students with the least quiet time at home fall",
    "further behind. Finally, my opponents ignore what homework replaces: sleep, family",
    "dinners, sports, and play. A fair policy asks which of these a school is willing to",
    "trade. On that question, their case offers no answer.",
  ].join(" ");

  const DRILL_ST_CLUSTERS = [
    "Strong students study strict, stress-tested strategies. Streets stretch past stone",
    "stairs, and steady steps stir still streams. Strangers struggle to stack stray straw,",
    "so skilled stewards sweep stale stalls first. Stan stresses structure, strength, and",
    "stamina, then stops, steadies his stance, and starts again. Strictly speaking, stray",
    "stories strain the stage, so stay straight, stay steady, and state each strong,",
    "simple statement.",
  ].join(" ");

  const DRILL_PL_BL_CLUSTERS = [
    "Plain blue planes plan blunt, bleak climbs. Clever clerks clap as black clouds blow",
    "clear. Please place the plump plums on the blank plate, then blend, clip, and clean",
    "the bleached cloth. Blake plays the clarinet, and Claire plays the cello, climbing",
    "slowly through each clear, clean phrase. Clean clay plates clink. Plan the pause,",
    "place the stress, and let every blend land.",
  ].join(" ");

  const GETTYSBURG_OPENING = [
    "Four score and seven years ago our fathers brought forth on this continent, a new",
    "nation, conceived in Liberty, and dedicated to the proposition that all men are",
    "created equal. Now we are engaged in a great civil war, testing whether that nation,",
    "or any nation so conceived and so dedicated, can long endure. We are met on a great",
    "battlefield of that war. We have come to dedicate a portion of that field, as a",
    "final resting place for those who here gave their lives that that nation might",
    "live. It is altogether fitting and proper that we should do this.",
  ].join(" ");

  // The closing of the speech as published by William Wirt; the exclamation marks in that
  // text are rendered as periods here so the passage reads evenly at a steady pace.
  const LIBERTY_OR_DEATH = [
    "The war is inevitable, and let it come. It is in vain, sir, to extenuate the matter.",
    "Gentlemen may cry, Peace, Peace, but there is no peace. The war is actually begun.",
    "The next gale that sweeps from the north will bring to our ears the clash of",
    "resounding arms. Our brethren are already in the field. Why stand we here idle?",
    "What is it that gentlemen wish? What would they have? Is life so dear, or peace so",
    "sweet, as to be purchased at the price of chains and slavery? Forbid it, Almighty",
    "God. I know not what course others may take; but as for me, give me liberty or",
    "give me death.",
  ].join(" ");

  app.passages = [
    // The free-talk id is older than the "Your day" title and stays, so saved takes still find
    // their band.
    {
      id: "free-talk",
      kind: "prompt",
      title: "Your day",
      text: YOUR_DAY_TOPICS[0],
      targetWpm: [140, 160],
      timeLimitSeconds: 60,
      topics: YOUR_DAY_TOPICS,
    },
    {
      id: "impromptu",
      kind: "prompt",
      title: "Impromptu",
      text: IMPROMPTU_TOPICS[0],
      targetWpm: [140, 160],
      timeLimitSeconds: 120,
      topics: IMPROMPTU_TOPICS,
    },
    {
      id: "congress-speech",
      kind: "prompt",
      title: "Congress speech",
      text: "Give a three-minute speech for or against a bill of your choice. " +
        "Open with a clear claim.",
      targetWpm: [130, 160],
      format: "Congress",
      timeLimitSeconds: 180,
    },
    {
      id: "pf-constructive",
      kind: "prompt",
      title: "PF constructive",
      text: "Deliver a constructive case you are working on, " +
        "clear enough for a lay judge to follow.",
      targetWpm: [140, 180],
      format: "Public Forum",
      timeLimitSeconds: 240,
    },
    {
      id: "rebuttal-uniforms",
      kind: "passage",
      title: "Rebuttal: school uniforms",
      text: REBUTTAL_UNIFORMS,
      targetWpm: [150, 170],
    },
    {
      id: "rebuttal-homework",
      kind: "passage",
      title: "Rebuttal: homework",
      text: REBUTTAL_HOMEWORK,
      targetWpm: [150, 170],
    },
    {
      id: "gettysburg-opening",
      kind: "passage",
      title: "Gettysburg Address, opening",
      text: GETTYSBURG_OPENING,
      targetWpm: [130, 150],
      source: "Abraham Lincoln, Gettysburg Address, 1863",
    },
    {
      id: "liberty-or-death",
      kind: "passage",
      title: "Patrick Henry, liberty or death",
      text: LIBERTY_OR_DEATH,
      targetWpm: [130, 150],
      source: "Patrick Henry, speech to the Virginia Convention, 1775",
    },
    {
      id: "drill-st-clusters",
      kind: "passage",
      title: "Drill: st and str clusters",
      text: DRILL_ST_CLUSTERS,
      targetWpm: [120, 140],
    },
    {
      id: "drill-pl-bl-clusters",
      kind: "passage",
      title: "Drill: pl, bl and cl clusters",
      text: DRILL_PL_BL_CLUSTERS,
      targetWpm: [120, 140],
    },
  ];
})();
