/* passages.js: app.passages, Practice's fixed material. Each entry is {id, kind, title, text,
   targetWpm: [lo, hi], source?, timeLimitSeconds?, topics?}: a "prompt" is a timed topic (the
   Talk tab), a "passage" is read word for word (the Read tab), and prompts come first, as
   Practice opens on the first entry. coldReads() and benchmark() hold the Path's own, and
   retired() the ids old takes still carry. Everyday fluency only, never debate. No DOM. */
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

  // Everyday opinion questions: each asks what the speaker thinks and why, never for a side.
  const IMPROMPTU_TOPICS = [
    "Explain one rule your school should change, and say why.",
    "Would you rather live in a big city or a small town? Why?",
    "Is it worth learning a second language as an adult? Why or why not?",
    "What is the best way to spend a free Saturday, and why?",
    "Which season of the year do you enjoy most, and why?",
    "Do phones bring friends closer or push them apart? Why?",
    "Is it better to save money or enjoy it now? Explain your view.",
    "What one change would make your neighborhood a better place to live?",
  ];

  // Job interview questions, "Tell me about yourself" first.
  const INTERVIEW_TOPICS = [
    "Tell me about yourself: where you are now and what comes next.",
    "What is one strength you would bring to a new team?",
    "Describe a time you solved a problem at work or school.",
    "Why do you want this job, and what makes you a good fit?",
    "Tell me about a mistake you made and what you learned from it.",
    "Describe a time you worked with someone who saw things differently.",
    "Where do you see yourself in five years, and why?",
    "How do you stay calm and organized when things get busy?",
  ];

  // Something the speaker knows well, explained to someone who does not.
  const EXPLAIN_TOPICS = [
    "Explain how to cook a dish you know well, step by step.",
    "Explain the rules of a game or sport you enjoy.",
    "Explain how to get around your city without a car.",
    "Explain how a tool or app you use every day works.",
    "Explain a tradition from your family or culture to a newcomer.",
    "Explain how to plan a trip on a small budget.",
    "Explain how to look after a plant or a pet.",
    "Explain something you are good at to a complete beginner.",
  ];

  // Something that happened to the speaker, told from the start.
  const STORY_TOPICS = [
    "Tell the story of a day that did not go as planned.",
    "Tell the story of the first time you visited a new place.",
    "Talk about a time a stranger was kind to you.",
    "Tell the story of how you learned something difficult.",
    "Describe a time you got lost, and how you found your way.",
    "Tell the story of a meal you will never forget.",
    "Talk about a moment when you felt proud of yourself.",
    "Tell the story of a small mistake that turned out well.",
  ];

  // The Read tab's everyday texts: an explainer and a short story, original, read as written.
  // Like the cold reads, they hold no digit, symbol, quotation mark, number word or habit word,
  // so a take that reads one as written shows no misread and no filler. The explainer is also
  // the Pace ladder's passage (path.js), 109 words, so the ladder reads keep their set seconds.
  const EXPLAINER_RAINBOWS = [
    "A rainbow appears when sunlight meets rain at the right angle. Sunlight looks white, but it",
    "is really a mix of many colors. When a beam of light enters a raindrop, it slows down and",
    "bends. Each color bends a slightly different amount, and the colors separate. Inside the",
    "drop, the light reflects off the back and bends again as it leaves. Millions of drops send",
    "these colors toward your eyes at once. That is why you only see a rainbow with the sun",
    "behind you and rain in front of you. When a storm clears in the late afternoon, turn your",
    "back to the sun and look up.",
  ].join(" ");

  const STORY_WRONG_TRAIN = [
    "On my first morning in a new city, I got on the wrong train. I only noticed when the",
    "station names stopped matching the map in my hand. My heart was racing, and every word of",
    "my new language seemed to disappear. I took a slow breath and asked the woman beside me for",
    "help. She smiled, studied the map, and told me to change at the next stop. Then she walked",
    "with me to the right platform. I arrived late, but I arrived. Since that day, asking a",
    "stranger for help no longer frightens me. Most people are glad to help when you ask.",
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
      id: "interview-answer",
      kind: "prompt",
      title: "Interview answer",
      text: INTERVIEW_TOPICS[0],
      targetWpm: [140, 160],
      timeLimitSeconds: 90,
      topics: INTERVIEW_TOPICS,
    },
    // A listener new to the subject needs time to follow, so this band reaches down to 130.
    {
      id: "explain-something",
      kind: "prompt",
      title: "Explain something",
      text: EXPLAIN_TOPICS[0],
      targetWpm: [130, 160],
      timeLimitSeconds: 120,
      topics: EXPLAIN_TOPICS,
    },
    {
      id: "tell-a-story",
      kind: "prompt",
      title: "Tell a story",
      text: STORY_TOPICS[0],
      targetWpm: [140, 160],
      timeLimitSeconds: 120,
      topics: STORY_TOPICS,
    },
    {
      id: "explainer-rainbows",
      kind: "passage",
      title: "Explainer: how rainbows form",
      text: EXPLAINER_RAINBOWS,
      targetWpm: [150, 170],
    },
    {
      id: "story-wrong-train",
      kind: "passage",
      title: "Story: the wrong train",
      text: STORY_WRONG_TRAIN,
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

  // Cold reads: original debate-style passages for the skill path's coldRead mode, which hands a
  // speaker a text they have never read (docs/PLAN.md T42 and T44). Each argues its own
  // resolution in 120 to 200 words. None holds a digit or a symbol, which a transcript may write
  // either way, or a habit word delivery.js counts (like, so, you know, actually, basically), so a
  // take that reads one as written shows no misread and no filler. They are not entries of
  // app.passages, so the Read tab keeps its six passages; coldReads() hands them out.

  // A steady pace for a text read for the first time, a step under the 150 to 170 of the Read
  // tab's explainer and story, which can be rehearsed. It is also the band summarize() in
  // screens/results.js falls back on for an id that is not in app.passages, so a cold-read take
  // is held to this band on every screen.
  const COLD_READ_TARGET_WPM = [140, 160];

  // One cold read, shaped like the passages above, with its own copy of the band.
  function coldRead(id, title, lines) {
    return {
      id,
      kind: "passage",
      title,
      text: lines.join(" "),
      targetWpm: COLD_READ_TARGET_WPM.slice(),
      coldRead: true,
    };
  }

  const COLD_READS = [
    coldRead("cold-read-school-start", "Cold read: later school start", [
      "We affirm that high schools should start later in the morning. Our first contention is",
      "health. During adolescence, the body's internal clock shifts later, and many teenagers",
      "lie awake until late at night. When the first bell rings at dawn, students arrive",
      "exhausted, and exhausted students have trouble focusing, remembering, and managing their",
      "emotions. Our second contention is safety. A driver who has not slept enough reacts more",
      "slowly, and many students drive themselves to school in the dark. A later start puts",
      "them on the road when they are alert and the sky is bright. Our third contention is",
      "fairness. Students with long bus rides, jobs after school, or younger siblings to care",
      "for lose the most sleep under early schedules. The current system quietly punishes the",
      "students who already carry the most. The negative will say that a later bell disrupts",
      "sports and family routines. Those costs are real, but schedules can adapt, and a",
      "teenager's biology will not. When we weigh convenience against health, safety, and",
      "fairness, the ballot belongs to the affirmative.",
    ]),
    coldRead("cold-read-free-transit", "Cold read: free public transit", [
      "Cities should make public transit free to ride. Today, every bus and train trip begins",
      "with a barrier: a fare that costs little for some riders and a great deal for others.",
      "For a worker earning the minimum wage, a monthly pass can swallow a painful share of the",
      "family budget. Removing the fare removes that barrier, and it does more than save riders",
      "money. Free transit speeds up every trip, because buses no longer wait while each",
      "passenger pays at the door. It eases traffic, because some drivers will leave their cars",
      "at home when the alternative costs nothing. And it cleans the air, because a full bus",
      "replaces dozens of cars. Critics argue that fares fund the system and that free service",
      "will be crowded and poorly maintained. But in most cities, fares already cover only part",
      "of the cost, and taxes pay the rest. The real question is not whether the public pays",
      "for transit. It is whether we charge the people who can least afford it at the",
      "turnstile, or share the cost fairly across the whole community.",
    ]),
    coldRead("cold-read-nuclear-power", "Cold read: nuclear power", [
      "We affirm that our nation should expand its use of nuclear power. Climate change demands",
      "energy that is clean and constant at the same time. Wind and solar power are essential,",
      "but the wind does not always blow, and the sun sets every evening. Until batteries can",
      "store power for days at a time, the grid needs a steady source that does not burn fossil",
      "fuels. Nuclear plants provide exactly that. They run around the clock, they need very",
      "little land, and they release almost no greenhouse gases while they operate. Opponents",
      "raise concerns about accidents, waste, and cost. Newer reactor designs use passive",
      "safety systems that can cool the core without operators or outside power. Spent fuel is",
      "dangerous, but it is compact, and it can be stored securely for decades while permanent",
      "sites are developed. Cost is the most serious objection, which is why we support",
      "building plants in a steady series, where each project teaches the next how to build",
      "faster and cheaper. The alternative is to keep burning coal and gas whenever the weather",
      "fails us. That harm is certain; the harms of nuclear power are only possible.",
    ]),
    coldRead("cold-read-space-funding", "Cold read: funding space exploration", [
      "In this final speech, I want to weigh the round. My opponents have argued that every",
      "dollar spent on space exploration is a dollar that should have gone to problems here on",
      "Earth. That argument sounds compassionate, but it rests on a false choice. Space",
      "programs receive a tiny share of public spending, and cutting them would not end hunger",
      "or repair a single school. Meanwhile, the benefits of exploration return to Earth",
      "constantly. Satellites track hurricanes, measure melting ice, and help farmers decide",
      "when to plant. Research driven by the demands of space flight has improved water",
      "filters, medical imaging, and the materials in our homes and hospitals. Most",
      "importantly, exploration inspires students to study science and engineering, and those",
      "students go on to solve problems far from any launch site. Weigh the impacts this way.",
      "Their harm is speculative, because no budget cut guarantees that the money reaches",
      "people in need. Our benefits are proven, and they continue every year. For those",
      "reasons, I urge you to affirm.",
    ]),
    coldRead("cold-read-plastic-bags", "Cold read: banning plastic bags", [
      "Our town should ban plastic shopping bags at the checkout counter. These bags are used",
      "for minutes and last for centuries. They blow out of landfills, clog storm drains, and",
      "tangle in the branches of trees along the river. In the water, they break into tiny",
      "fragments that fish and birds mistake for food. Recycling has not solved the problem,",
      "because most programs refuse thin plastic film, which jams their sorting machines. The",
      "opposition argues that a ban burdens shoppers and hurts small businesses. Experience",
      "suggests otherwise. Where bans take effect, shoppers adjust within weeks and carry",
      "reusable bags out of habit, while stores stop paying for bags they once handed out for",
      "free. Others claim that paper bags are worse for the climate. That is why a good policy",
      "encourages reusable bags first and charges a small fee for paper. Most environmental",
      "problems feel too large for a single town to solve. This problem is different. It is",
      "small, visible, and entirely within our power to fix.",
    ]),
    coldRead("cold-read-social-media-ages", "Cold read: social media age limits", [
      "Social media platforms should be required to verify the ages of their users. Most",
      "platforms already set a minimum age, but they enforce it with a box that any child can",
      "check without thinking. As a result, young children spend hours inside feeds that",
      "engineers designed to hold attention for as long as possible. Those feeds expose them to",
      "strangers, to cruel comparisons, and to content that no responsible adult would choose",
      "for them. Critics raise serious objections. They warn that verification threatens",
      "privacy, because users would have to hand over documents. But an age check can be",
      "designed to confirm a single fact, whether a user is old enough, without storing a name",
      "or a face. Critics also argue that parents, not companies, should decide what children",
      "see online. We agree that parents matter, which is exactly why they need help. No parent",
      "can supervise every screen in the house at every hour of the day. Platforms profit from",
      "young users, and they should carry the responsibility of keeping them out until they are",
      "ready.",
    ]),
    coldRead("cold-read-compulsory-voting", "Cold read: compulsory voting", [
      "The affirmative asks you to make voting mandatory and to fine citizens who stay home on",
      "election day. We negate, because a democracy should measure consent, not compliance.",
      "First, the freedom to vote includes the freedom to abstain. A citizen who finds every",
      "candidate unworthy sends a message by refusing to choose, and the state has no business",
      "forcing a different message. Second, compulsory voting does not create informed voters;",
      "it creates rushed ones. People pushed to the polls under threat of a fine are more",
      "likely to pick at random or mark whichever name appears first on the ballot. That adds",
      "noise to the result without adding wisdom. Third, the fines fall hardest on the people",
      "the affirmative claims to help: workers who can't take time off, parents with young",
      "children at home, and citizens without reliable transportation. If we want higher",
      "turnout, we should make voting easier, with more polling places, longer hours, and a",
      "holiday on election day. Make participation easier, not mandatory.",
    ]),
    coldRead("cold-read-zoos", "Cold read: the case for zoos", [
      "I affirm the resolution that zoos do more good than harm. Because the resolution asks us",
      "to weigh consequences, my value is the welfare of animals as a whole, not the comfort of",
      "any single creature. Accredited zoos today look very different from the cramped",
      "menageries of the past. They fund field research, train veterinarians, and run breeding",
      "programs for species that have vanished from the wild or nearly have. Several species",
      "that once disappeared from their natural habitats survive today because zoos kept small",
      "populations alive and later returned them home. Zoos also build public support for",
      "conservation. A child who watches an elephant up close may grow into an adult who fights",
      "to protect elephants in the wild. The negative will argue that captivity is cruel. In",
      "some zoos it is, and those zoos should close. But the right response to a bad zoo is a",
      "better zoo, not the end of an institution that keeps entire species from disappearing.",
      "Judge this round by its consequences, and you will affirm.",
    ]),
    coldRead("cold-read-car-free-centers", "Cold read: car-free city centers", [
      "Cities should close their downtown streets to private cars. Picture a main street where",
      "the loudest sound is conversation, where children can cross without fear, and where the",
      "space once given to parking holds outdoor tables, gardens, and benches. This is not a",
      "fantasy. Streets designed for people attract more people, and more people means more",
      "customers for local businesses. The opposition fears that shops will lose sales when",
      "drivers can no longer park at the door. But shoppers on foot visit more often, linger",
      "longer, and over a month they can spend more than drivers who park, buy, and leave.",
      "Others worry about residents with disabilities and about delivery workers. A good plan",
      "keeps access for both, with permits for those who need them and loading zones at set",
      "hours. The deeper benefit is health. Fewer cars mean cleaner air, fewer crashes, and",
      "more walking, which strengthens the heart and calms the mind. A city center should be a",
      "place to spend time, not merely a place to drive through.",
    ]),
    coldRead("cold-read-ai-tools", "Cold read: AI tools in class", [
      "Schools should teach students to use artificial intelligence tools rather than banning",
      "them. A ban sounds decisive, but it fails in practice. Students carry these tools in",
      "their pockets, and a rule that nobody can enforce only teaches them to hide. Worse, a",
      "ban leaves students unprepared for colleges and workplaces that already expect them to",
      "use these tools wisely. Teaching is the better path. A student who learns how these",
      "programs produce their answers also learns why those answers can be wrong: why they",
      "invent sources, flatten nuance, and repeat the biases in their training data. That",
      "student becomes a sharper reader of every text, human or machine. The negative warns",
      "that students will let software do their thinking. That danger is real, and it is",
      "exactly why instruction matters. Teachers can design assignments that require drafts,",
      "reflections, and oral defenses, where shortcuts fail. We do not protect students by",
      "pretending a powerful technology does not exist. We protect them by teaching them to",
      "question it.",
    ]),
    coldRead("cold-read-service-hours", "Cold read: required service hours", [
      "The affirmative wants every student to complete community service hours before",
      "graduating. We share their goal of engaged citizens, but a requirement undermines the",
      "very spirit it hopes to build. Service means giving freely. When the state ties a",
      "diploma to it, service becomes another box to check, and students learn to count minutes",
      "rather than care about the people they serve. Requirements also deepen inequality. A",
      "student with a car, free afternoons, and well-connected parents can find a placement in",
      "a day. A student who works evenings to help pay the rent, or who cares for younger",
      "siblings, must squeeze hours out of a schedule that has none to spare. That student",
      "already serves a family at home every week, yet earns no credit for it. Finally,",
      "organizations that rely on volunteers lose staff time supervising reluctant teenagers",
      "who would rather be anywhere else. Encourage service with recognition, flexible",
      "schedules, and real opportunities. Do not make it a condition of graduation.",
    ]),
    coldRead("cold-read-clock-changes", "Cold read: ending clock changes", [
      "Members of this chamber, I rise in support of this bill, which would end the practice of",
      "changing our clocks twice a year. Every spring we lose an hour of sleep, and every",
      "autumn we scramble to reset ovens, cars, and watches. The disruption is more than an",
      "annoyance. In the days after the spring change, tired drivers and workers make more",
      "mistakes, and doctors have linked the shift to a rise in heart trouble. The original",
      "reason for the change, saving energy, has grown weak in an age of air conditioning and",
      "lights that burn around the clock. Some members worry about dark winter mornings if we",
      "choose permanent daylight time. That concern deserves a serious debate about which time",
      "to keep, and this bill lets each state make that choice. What we should not do is",
      "continue a ritual that harms our health twice a year and helps almost nobody. I urge my",
      "colleagues to vote in favor.",
    ]),
    coldRead("cold-read-local-news", "Cold read: saving local news", [
      "Communities need local journalism, and government should help pay for it. Over the past",
      "generation, a great many local newspapers have closed or shrunk to a skeleton staff.",
      "When the reporters disappear, nobody attends the school board meeting, reads the city",
      "budget, or asks why a contract went to the mayor's cousin. Where newspapers vanish,",
      "officials face fewer questions, and voters know less about the races on their ballots.",
      "Skeptics fear that public money will turn reporters into mouthpieces for the officials",
      "who fund them. That risk is serious, which is why support should flow through",
      "independent boards, follow clear formulas, and come with firm protections for editorial",
      "freedom. Several democracies already fund public broadcasters that criticize their own",
      "governments every night. Tax credits for subscribers would go further, letting readers,",
      "not politicians, decide where the money goes. The choice before us is not between",
      "perfect independence and public support. It is between imperfect support and silence.",
    ]),
    coldRead("cold-read-rent-control", "Cold read: rent control", [
      "We negate the resolution that cities should adopt strict rent control. The affirmative's",
      "goal is right: housing costs too much, and families are being pushed out of",
      "neighborhoods they have called home for generations. But rent control treats the symptom",
      "while worsening the disease, and the disease is scarcity. When a city caps rents,",
      "building new apartments becomes less profitable, and developers build elsewhere.",
      "Landlords facing frozen rents delay repairs, convert units into condominiums, or pull",
      "them off the rental market entirely. Tenants who hold a controlled lease stay put even",
      "when their jobs and families change, because moving means losing the deal. That leaves",
      "fewer apartments open for everyone else. The lucky tenants gain, while newcomers, who",
      "are often younger and poorer, pay more for whatever remains. If we want affordable",
      "housing, we have to build more of it. Change zoning rules to allow apartments near",
      "transit, speed up permits, and fund vouchers that help families directly without",
      "shrinking the supply that every renter depends on.",
    ]),
    coldRead("cold-read-organ-donors", "Cold read: organ donor defaults", [
      "Our state should register every adult as an organ donor by default, while letting anyone",
      "opt out with a simple form. Today, people must take action to become donors, and many",
      "never do, not because they object, but because they never get around to it. Meanwhile,",
      "patients die every week waiting for kidneys, livers, and hearts that never arrive. A",
      "default changes behavior without removing choice. Anyone who objects, for religious or",
      "personal reasons, keeps the right to decline, and that decision is respected completely.",
      "Opponents argue that a default presumes consent that was never given. But our current",
      "system also presumes something: that silence means no. Since most people say they",
      "support donation, the more respectful presumption is consent, which matches their stated",
      "wishes. Families should still be consulted at the hardest moment, and doctors must never",
      "let donor status affect a patient's care. With those safeguards, a default system honors",
      "individual choice and saves lives that our current inertia quietly lets slip away.",
    ]),
  ];

  // The skill path's coldRead mode draws from this list. Each call returns a new array, so a
  // caller can filter or shuffle it without changing what the next caller gets.
  app.passages.coldReads = function coldReads() {
    return COLD_READS.slice();
  };

  // The benchmark (docs/superpowers/specs/2026-10-14-loop-path.md section 5): one passage to read
  // and one prompt to talk on, held out from everything else, so the same two at every sitting
  // show real progress outside the path. Neither is an entry of app.passages or a cold read, so
  // no other take ever practises them. The read keeps the cold reads' rules: original and
  // debate-style, 140 to 180 words, with no digit, symbol, quotation mark or habit word.
  const BENCHMARK_TARGET_WPM = [140, 160];
  const BENCHMARK_TALK_SECONDS = 90;

  const BENCHMARK_READ = [
    "We affirm that every city should plant and protect trees along its streets. Start with",
    "heat. Pavement and rooftops soak up sunlight all afternoon and release it long after",
    "dark, and blocks without shade can feel far hotter than leafy ones nearby. A row of",
    "mature trees cools the sidewalk, the homes behind it, and the people waiting for the bus.",
    "Next, consider health. Trees filter dust from the air, soften the noise of traffic, and",
    "invite neighbors to walk instead of drive. Finally, weigh fairness. Wealthy districts",
    "tend to have the most shade, while crowded blocks with the least green space bear the",
    "worst of every heat wave. The opposition will argue that trees cost money to plant and",
    "maintain. They do, but a healthy tree repays that cost for decades, in lower cooling",
    "bills, fewer flooded streets, and healthier neighbors. Plant the shade where it is needed",
    "most, and the whole city benefits.",
  ].join(" ");

  const BENCHMARK_TALK_TOPIC =
    "Describe a skill you want to learn this year, and how you would start.";

  // {read, talk}: the benchmark passage and prompt, shaped like the entries above. Each call
  // returns new objects, so a caller can change its copy without changing the next caller's.
  app.passages.benchmark = function benchmark() {
    return {
      read: {
        id: "benchmark-read",
        kind: "passage",
        title: "Benchmark read",
        text: BENCHMARK_READ,
        targetWpm: BENCHMARK_TARGET_WPM.slice(),
      },
      talk: {
        id: "benchmark-talk",
        kind: "prompt",
        title: "Benchmark talk",
        text: BENCHMARK_TALK_TOPIC,
        targetWpm: BENCHMARK_TARGET_WPM.slice(),
        timeLimitSeconds: BENCHMARK_TALK_SECONDS,
        topics: [BENCHMARK_TALK_TOPIC],
      },
    };
  };

  // Retired ids. On 2026-10-14 the owner ruled that Speech Coach is for everyday fluency, not
  // debate, and these entries left Practice; takes saved on them still carry their ids. Each
  // keeps only what such a take is judged and timed by, its band and, for a prompt, its time
  // limit, so Results, History, Progress, the rank and the Path read an old take as before,
  // under the take's own saved passageTitle. No title, text or topics: nothing here is shown,
  // Practice never lists a retired id and the Path never hands one out.
  const RETIRED = [
    { id: "congress-speech", kind: "prompt", targetWpm: [130, 160], timeLimitSeconds: 180 },
    { id: "pf-constructive", kind: "prompt", targetWpm: [140, 180], timeLimitSeconds: 240 },
    { id: "rebuttal-uniforms", kind: "passage", targetWpm: [150, 170] },
    { id: "rebuttal-homework", kind: "passage", targetWpm: [150, 170] },
  ];

  // Each call returns new objects, so a caller can change its copy without changing the next.
  app.passages.retired = function retired() {
    return RETIRED.map((entry) =>
      Object.assign({}, entry, { targetWpm: entry.targetWpm.slice() }),
    );
  };
})();
