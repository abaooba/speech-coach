/* passages.js: app.passages, the fixed reading material for the Practice screen.
   Each entry is {id, kind, title, text, targetWpm: [lo, hi], source?}; kind "passage" is read
   aloud word for word, kind "prompt" is a topic the speaker improvises on. No DOM here. */
(function () {
  "use strict";

  const REBUTTAL_UNIFORMS = [
    "My opponents claim that uniforms erase bullying, but the evidence says otherwise.",
    "Students who want to single someone out will find a reason, whether it is shoes,",
    "a backpack, or a phone. The real problem is school culture, and a dress code does",
    "not change culture. Second, they argue that uniforms save families money. In",
    "practice, parents still buy everyday clothes for evenings and weekends, which makes",
    "the uniform an added cost, not a replacement. Finally, consider what we lose.",
    "Choosing how to present yourself is one of the few decisions a student makes every",
    "day. Taking that away teaches compliance, not confidence. For these reasons, the",
    "proposal fails on its own terms.",
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
    {
      id: "rebuttal-uniforms",
      kind: "passage",
      title: "Rebuttal: school uniforms",
      text: REBUTTAL_UNIFORMS,
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
      id: "free-talk",
      kind: "prompt",
      title: "Free talk",
      text: "Argue for or against school uniforms for one minute.",
      targetWpm: [140, 160],
    },
  ];
})();
