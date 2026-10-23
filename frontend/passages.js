/* passages.js: app.passages, Practice's fixed material. Each entry is {id, kind, title, text,
   targetWpm: [lo, hi], source?, timeLimitSeconds?, topics?, group?}: a "prompt" is a timed topic
   (the Talk tab), a "passage" is read word for word (the Read tab) and belongs to one of the
   groups groups() lists, and prompts come first, as Practice opens on the first entry.
   coldReads() and benchmark() hold the Path's own, and retired() the ids old takes still carry.
   Everyday fluency only, never debate. No DOM. */
(function () {
  "use strict";

  // One topic shows at a time, drawn again on each tap of its prompt's chip or of New topic
  // (screens/practice.js). Each prompt's text repeats its first topic, so every entry still has
  // text.
  const ABOUT_YOU_TOPICS = [
    "Talk about something you are looking forward to this week.",
    "Describe the best thing that happened to you last week.",
    "Talk about what you have planned for the weekend, and why.",
    "Describe a friend or family member and what makes them special.",
    "Talk about a hobby you enjoy and how you got into it.",
    "Describe how your week is going, the good parts and the hard ones.",
    "Talk about a goal you are working toward right now.",
    "Describe your favorite room at home and what you do there.",
    "Talk about a book, show or film you enjoyed recently.",
    "Describe a habit you are trying to build or break.",
    "Talk about a song you keep listening to, and why.",
    "Describe the place where you grew up to someone who has never been.",
    "Talk about someone who taught you something important.",
    "Talk about a small win you had recently and what it meant.",
    "Talk about a place you would love to visit one day.",
    "Describe a typical evening for you, from dinner to bedtime.",
    "Talk about something that has changed in your life this year.",
    "Describe the people you spend most of your time with.",
    "Talk about what you do to relax after a long day.",
    "Describe something small that made you smile recently.",
    "Describe a gift you gave or got that meant a lot.",
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
    "Is it better to have a few close friends or many friends? Why?",
    "What makes a good teacher, in your experience, and why?",
    "Would you rather travel to the past or the future? Why?",
    "What is one invention you could not live without, and why?",
    "Is breakfast really the most important meal of the day? Why?",
    "What makes a movie worth watching a second time, in your view?",
    "Would you rather have more free time or more money? Why?",
    "What is the most useful thing you have learned outside of school?",
    "Is it better to plan a trip carefully or just go? Why?",
    "What makes someone a good neighbor, in your opinion?",
    "Would you rather be a morning person or a night person? Why?",
    "Which is better for learning, books or videos? Explain your view.",
    "What is one skill everyone should learn before they leave home?",
    "Is it more fun to watch sports or to play them? Why?",
    "What would you change about the way people use social media?",
    "Would you rather live near the ocean or the mountains? Why?",
    "What is the best advice you have ever been given, and why?",
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
    "What are you most proud of so far, and why?",
    "How do you handle feedback that you do not agree with?",
    "Tell me about a time you had to learn something quickly.",
    "What kind of work environment helps you do your best?",
    "Describe a goal you set for yourself and how you reached it.",
    "How do you decide what to do first when everything feels urgent?",
    "Tell me about a time you helped someone who was struggling.",
    "What is one weakness you are working on, and how?",
    "Describe a project you are proud of, from start to finish.",
    "How would your friends or classmates describe you, and why?",
    "Tell me about a time you had to speak up for an idea.",
    "What do you do when you do not know the answer?",
    "Describe a time you led a group, even an informal one.",
    "Why are you interested in this field, and how did it start?",
    "Tell me about a time you missed a deadline and what happened.",
    "What would you want to learn in your first month here?",
    "How do you keep yourself motivated on a long, slow project?",
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
    "Explain how to make a good first impression at a new job.",
    "Explain how to ride a bike to someone who has never tried.",
    "Explain how to set up a new phone for an older relative.",
    "Explain how to make your favorite drink, hot or cold.",
    "Explain how to study for a big test without cramming.",
    "Explain how to pack a suitcase so that everything fits.",
    "Explain how the seasons change in the place where you live.",
    "Explain how to get from your home to a shop nearby.",
    "Explain how to take care of a pair of shoes so they last.",
    "Explain how your family gets ready for a holiday you celebrate.",
    "Explain how to make a simple budget for one month.",
    "Explain how to start a conversation with someone you just met.",
    "Explain how to keep a room tidy in ten minutes a day.",
    "Explain the plot of a favorite movie without giving away the ending.",
    "Explain how to choose good fruit or vegetables at the market.",
    "Explain how to fix a small problem around the house.",
    "Explain how to get better sleep, one step at a time.",
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
    "Tell the story of a time you laughed so hard you could not stop.",
    "Tell the story of your first day at a new school or job.",
    "Talk about a time you helped a friend through something hard.",
    "Tell the story of a trip that changed how you see things.",
    "Tell the story of a time you were really nervous, and what happened.",
    "Tell the story of a birthday or celebration you remember well.",
    "Talk about a time you tried something new and loved it.",
    "Tell the story of a time you lost something important.",
    "Tell the story of how you met one of your closest friends.",
    "Tell the story of a time the weather ruined your plans.",
    "Talk about a time you had to make a hard choice quickly.",
    "Tell the story of a funny misunderstanding you were part of.",
    "Tell the story of a game or match you will always remember.",
    "Talk about a time you surprised yourself by doing something brave.",
    "Tell the story of a time you taught someone something new.",
    "Tell the story of a family trip, from the start to the end.",
    "Tell the story of something you waited a long time for.",
  ];

  // The Read tab's everyday texts: six explainers and six short stories, original, read as
  // written. Like the cold reads, they hold no digit, symbol, quotation mark, number word or habit
  // word, so a take that reads one as written shows no misread and no filler.
  const EXPLAINER_RAINBOWS = [
    "A rainbow appears when sunlight meets rain at the right angle. Sunlight looks white, but it",
    "is really a mix of many colors. When a beam of light enters a raindrop, it slows down and",
    "bends. Each color bends a slightly different amount, and the colors separate. Inside the",
    "drop, the light reflects off the back and bends again as it leaves. Millions of drops send",
    "these colors toward your eyes at once. That is why you only see a rainbow with the sun",
    "behind you and rain in front of you. When a storm clears in the late afternoon, turn your",
    "back to the sun and look up.",
  ].join(" ");

  const EXPLAINER_CUT_APPLES = [
    "Cut an apple, and soon the pale slices start to turn brown. Each cell of the fruit keeps",
    "certain natural chemicals apart from a helper called an enzyme. A knife breaks the cells",
    "open, and the chemicals meet the enzyme. Then the enzyme helps oxygen from the air turn",
    "the chemicals brown. The color is harmless, but the fruit looks less fresh. Lemon juice",
    "slows the change, because its sour acid makes the enzyme work more slowly. That is why",
    "cooks often add lemon juice to fruit salad. Next time you cut an apple, brush lemon",
    "juice on half the slices, and watch the difference.",
  ].join(" ");

  const EXPLAINER_ECHOES = [
    "An echo is a sound that comes back to you. When you shout, your voice travels through",
    "the air as waves of vibration. A large, hard surface, such as a cliff, sends much of",
    "that sound back. Soft surfaces, such as grass and fresh snow, soak up sound and send",
    "less back. Distance matters. If the surface is near, the sound returns quickly and",
    "blends with your voice. If it is far enough away, you hear a separate copy a moment",
    "later. That is why a shout in a steep, rocky valley comes back clearly. Stand far back",
    "from a tall wall and clap once. Listen for the echo.",
  ].join(" ");

  const EXPLAINER_FLOATING_ICE = [
    "Drop an ice cube into a glass of water, and it stays at the top. Most liquids get",
    "smaller when they freeze. Water does the opposite. When it freezes, its molecules lock",
    "into an open pattern with tiny gaps between them. The same water takes up more space as",
    "ice, which makes ice lighter for its size. That is why ice floats. It is also why lakes",
    "freeze from the top down. The ice forms a lid, and fish can survive the winter beneath",
    "it. Pour yourself a cold drink with ice, and notice how much of each cube sits below the",
    "surface.",
  ].join(" ");

  const EXPLAINER_MOON_PHASES = [
    "The moon makes no light of its own. It shines by reflecting sunlight. The sun always",
    "lights up half of the moon, the half facing it. As the moon circles the Earth each",
    "month, we see different amounts of that bright half. When the moon is between the Earth",
    "and the sun, the bright half faces away from us. When the moon is on the side of the",
    "Earth away from the sun, we see the whole bright half. That is why the moon seems to",
    "change shape over the month. Look for the moon on a few nights this week, and watch the",
    "bright part grow or shrink.",
  ].join(" ");

  const EXPLAINER_BICYCLES = [
    "A bicycle stays upright mainly because its rider keeps steering. When the bike starts to",
    "lean left, the rider turns the front wheel slightly left. The wheels roll back under the",
    "rider, and the bike straightens up. When it leans right, the rider steers right. These",
    "corrections are tiny, and most riders make them without thinking. Steering can only",
    "catch a fall while the wheels are rolling, and it works better with some speed. That is",
    "why a bike wobbles when you ride slowly and falls over when you stop. Next time you",
    "ride, notice the small turns your hands keep making.",
  ].join(" ");

  const STORY_WRONG_TRAIN = [
    "On my first morning in a new city, I got on the wrong train. I only noticed when the",
    "station names stopped matching the map in my hand. My heart was racing, and every word of",
    "my new language seemed to disappear. I took a slow breath and asked the woman beside me for",
    "help. She smiled, studied the map, and told me to change at the next stop. Then she walked",
    "with me to the right platform. I arrived late, but I arrived. Since that day, asking a",
    "stranger for help no longer frightens me. Most people are glad to help when you ask.",
  ].join(" ");

  const STORY_PHONE_CALL = [
    "After I moved abroad, I avoided phone calls. On a call, I could not see the other",
    "person, and my words came out too fast. Then my bike broke. The repair shop only took",
    "appointments by phone. I wrote my sentences on a card and practiced them out loud. When",
    "a man answered, my mouth went dry, and I wanted to say everything at once. Instead, I",
    "slowed down and paused after each sentence. He understood every word, and the call took",
    "less than a minute. Now I speak at a calm pace on every call. It helps the listener",
    "understand, and it gives me time to think.",
  ].join(" ");

  const STORY_NAME_I_FORGOT = [
    "On the first day of language class, the student beside me told me her name. By the",
    "break, I had forgotten it. Every morning after that, she greeted me by name, and I only",
    "smiled and waved. Weeks went by, and it felt too late to ask. Then the teacher asked us",
    "to introduce each other to the class. My face felt hot. I whispered an apology and asked",
    "her name again. She laughed and admitted that she had forgotten mine too. Every morning,",
    "she had read it on my notebook. These days, if I forget a name, I ask again right away.",
    "Everyone forgets, and everyone understands.",
  ].join(" ");

  const STORY_CORNER_BAKERY = [
    "Every morning before class, I bought bread at the corner bakery. For weeks, I ordered by",
    "pointing. On a cold winter day, I decided to try a full sentence. I practiced it the",
    "whole way there. The baker listened, pressed her lips together, and burst out laughing.",
    "Instead of warm bread, I had asked her for a warm room. In her language, the words for",
    "bread and room sound almost the same. She said the word for bread slowly, and I repeated",
    "it until it felt natural. I have never forgotten that word. The words I get wrong are",
    "the words I remember best.",
  ].join(" ");

  const STORY_SOUP_NEXT_DOOR = [
    "On a rainy Sunday, I cooked a soup from my home country. The smell of garlic and ginger",
    "filled the hallway. Soon, there was a knock at my door. It was my neighbor, an older",
    "woman I barely knew. I was sure she had come to complain. But she was smiling. She",
    "wanted to know what I was cooking. I did not know the names of half the ingredients.",
    "Instead of explaining, I handed her a bowl. The next weekend, she knocked again, holding",
    "a warm apple cake. We still share very few words, but we share a lot of food. Kindness",
    "does not need perfect grammar.",
  ].join(" ");

  const STORY_GIVING_DIRECTIONS = [
    "For months, I felt stuck in my new language. Last week, a tourist at my bus stop asked",
    "me the way to the museum. Without thinking, I told her to walk past the park, turn left",
    "at the flower shop, and follow the river to the bridge. She thanked me and hurried off.",
    "Only then did I notice what had happened. I had not translated a single word in my head.",
    "The sentences had simply come out, the way they do in my own language. Progress is",
    "quiet. Often you notice it only when someone else needs your help.",
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

  const DRILL_TH_SOUNDS = [
    "This month, my brother and I thought of a way to thank our mother. Rather than buy",
    "something, we gathered thick cloth, thin thread, and soft feathers, and together we made",
    "them into a pillow. Neither of us had ever threaded a needle, and the edges were not",
    "very smooth. On Thursday, when she saw it, she smiled, then thanked us both. I think",
    "that smile was worth more than anything from a shop.",
  ].join(" ");

  const DRILL_R_AND_L = [
    "Early on a rainy morning, the road along the lake is quiet. Light rain drips from the",
    "trees, and a robin rests on the railing. Later, the clouds clear and a crowd arrives.",
    "Families spread blankets on the long green grass and pass around rice, grilled lamb, and",
    "tall glasses of lemonade. Children race to the shore, laughing loudly. I really love",
    "this hour, when the air feels fresh and the whole world looks relaxed.",
  ].join(" ");

  const DRILL_V_AND_W = [
    "Every winter, we visit a very small village in a wide, quiet valley. We travel west in a",
    "white van, wearing warm wool scarves over our sweaters. While the wind blows over the",
    "river, we wave to the vet walking her wet dog. The woman at the bakery welcomes us with",
    "sweet vanilla waffles. In the evening, we sit by the window with a view of the woods,",
    "and we wish the visit would never end.",
  ].join(" ");

  const DRILL_WORD_ENDINGS = [
    "Last Friday, I invited friends for dinner. I washed and chopped the vegetables, roasted",
    "the potatoes, and baked a fresh loaf of bread. My friends arrived late, but they brought",
    "flowers and a chocolate tart. We talked and laughed, everyone asked for more bread, and",
    "nobody checked the clock. When the candles melted, we cleaned the plates, folded the",
    "napkins, and packed the leftovers. I hugged each guest, waved from the steps, and slept",
    "well.",
  ].join(" ");

  // The speeches are read word for word, as their transcripts print them. delivery.js never reads
  // the script, so a "so" right before a comma counts as a habit when the reader pauses there
  // (SO_HANG_SECONDS): Roosevelt's "So, first of all, ... fear itself" and Kennedy's "And so, my
  // fellow Americans: ask not" are left out for that reason (passages_read_as_written.test.js).
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

  // Two paragraphs from the middle of the address, as printed on the Avalon Project's page (Yale
  // Law School), which the Miller Center's text matches word for word; as delivered, it opens
  // "Yes, the money changers", reads "the moral stimulation" and adds "my friends".
  const FDR_HAPPINESS = [
    "The money changers have fled from their high seats in the temple of our civilization. We",
    "may now restore that temple to the ancient truths. The measure of the restoration lies in",
    "the extent to which we apply social values more noble than mere monetary profit. Happiness",
    "lies not in the mere possession of money; it lies in the joy of achievement, in the thrill",
    "of creative effort. The joy and moral stimulation of work no longer must be forgotten in",
    "the mad chase of evanescent profits. These dark days will be worth all they cost us if they",
    "teach us that our true destiny is not to be ministered unto but to minister to ourselves",
    "and to our fellow men.",
  ].join(" ");

  // The passage of the address at Rice University that opens on its best-known line, as the
  // American Presidency Project prints it; Teaching American History's transcript matches it word
  // for word, writing office in lower case.
  const JFK_TO_THE_MOON = [
    "We choose to go to the moon. We choose to go to the moon in this decade and do the other",
    "things, not because they are easy, but because they are hard, because that goal will serve",
    "to organize and measure the best of our energies and skills, because that challenge is one",
    "that we are willing to accept, one we are unwilling to postpone, and one which we intend to",
    "win, and the others, too. It is for these reasons that I regard the decision last year to",
    "shift our efforts in space from low to high gear as among the most important decisions",
    "that will be made during my incumbency in the Office of the Presidency.",
  ].join(" ");

  // The man in the arena passage of the speech at the Sorbonne, from The credit belongs, as the
  // American Presidency Project prints it, word for word as in the 1910 book African and
  // European Addresses; popular copies differ in up to three places, and this follows the book.
  const TR_MAN_IN_THE_ARENA = [
    "The credit belongs to the man who is actually in the arena, whose face is marred by dust",
    "and sweat and blood; who strives valiantly; who errs, and comes short again and again,",
    "because there is no effort without error and shortcoming; but who does actually strive",
    "to do the deeds; who knows the great enthusiasms, the great devotions; who spends",
    "himself in a worthy cause; who at the best knows in the end the triumph of high",
    "achievement, and who at the worst, if he fails, at least fails while daring greatly, so",
    "that his place shall never be with those cold and timid souls who know neither victory",
    "nor defeat.",
  ].join(" ");

  // From the remarks at Amherst College, the second sentence of one paragraph through the third
  // of the next, as the American Presidency Project prints them; the JFK Library's transcript
  // agrees word for word.
  const JFK_GRACE_AND_BEAUTY = [
    "I look forward to an America which will not be afraid of grace and beauty, which will",
    "protect the beauty of our natural environment, which will preserve the great old",
    "American houses and squares and parks of our national past, and which will build",
    "handsome and balanced cities for our future. I look forward to an America which will",
    "reward achievement in the arts as we reward achievement in business or statecraft. I",
    "look forward to an America which will steadily raise the standards of artistic",
    "accomplishment and which will steadily enlarge cultural opportunities for all of our",
    "citizens. And I look forward to an America which commands respect throughout the world",
    "not only for its strength but for its civilization as well.",
  ].join(" ");

  app.passages = [
    // The free-talk id is older than the "About you" title and stays, so saved takes still find
    // their band.
    {
      id: "free-talk",
      kind: "prompt",
      title: "About you",
      text: ABOUT_YOU_TOPICS[0],
      targetWpm: [140, 160],
      timeLimitSeconds: 60,
      topics: ABOUT_YOU_TOPICS,
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
      group: "explainer",
    },
    {
      id: "story-wrong-train",
      kind: "passage",
      title: "Story: the wrong train",
      text: STORY_WRONG_TRAIN,
      targetWpm: [150, 170],
      group: "story",
    },
    {
      id: "gettysburg-opening",
      kind: "passage",
      title: "Gettysburg Address, opening",
      text: GETTYSBURG_OPENING,
      targetWpm: [130, 150],
      source: "Abraham Lincoln, Gettysburg Address, 1863",
      group: "speech",
    },
    {
      id: "liberty-or-death",
      kind: "passage",
      title: "Patrick Henry, liberty or death",
      text: LIBERTY_OR_DEATH,
      targetWpm: [130, 150],
      source: "Patrick Henry, speech to the Virginia Convention, 1775",
      group: "speech",
    },
    {
      id: "drill-st-clusters",
      kind: "passage",
      title: "Drill: st and str clusters",
      text: DRILL_ST_CLUSTERS,
      targetWpm: [120, 140],
      group: "drill",
    },
    {
      id: "drill-pl-bl-clusters",
      kind: "passage",
      title: "Drill: pl, bl and cl clusters",
      text: DRILL_PL_BL_CLUSTERS,
      targetWpm: [120, 140],
      group: "drill",
    },
    {
      id: "explainer-cut-apples",
      kind: "passage",
      title: "Explainer: why cut apples turn brown",
      text: EXPLAINER_CUT_APPLES,
      targetWpm: [150, 170],
      group: "explainer",
    },
    {
      id: "explainer-echoes",
      kind: "passage",
      title: "Explainer: how an echo works",
      text: EXPLAINER_ECHOES,
      targetWpm: [150, 170],
      group: "explainer",
    },
    {
      id: "explainer-floating-ice",
      kind: "passage",
      title: "Explainer: why ice floats",
      text: EXPLAINER_FLOATING_ICE,
      targetWpm: [150, 170],
      group: "explainer",
    },
    {
      id: "explainer-moon-phases",
      kind: "passage",
      title: "Explainer: why the moon changes shape",
      text: EXPLAINER_MOON_PHASES,
      targetWpm: [150, 170],
      group: "explainer",
    },
    {
      id: "explainer-bicycles",
      kind: "passage",
      title: "Explainer: how a bicycle stays up",
      text: EXPLAINER_BICYCLES,
      targetWpm: [150, 170],
      group: "explainer",
    },
    {
      id: "story-phone-call",
      kind: "passage",
      title: "Story: the phone call",
      text: STORY_PHONE_CALL,
      targetWpm: [150, 170],
      group: "story",
    },
    {
      id: "story-name-i-forgot",
      kind: "passage",
      title: "Story: the name I forgot",
      text: STORY_NAME_I_FORGOT,
      targetWpm: [150, 170],
      group: "story",
    },
    {
      id: "story-corner-bakery",
      kind: "passage",
      title: "Story: the corner bakery",
      text: STORY_CORNER_BAKERY,
      targetWpm: [150, 170],
      group: "story",
    },
    {
      id: "story-soup-next-door",
      kind: "passage",
      title: "Story: the soup next door",
      text: STORY_SOUP_NEXT_DOOR,
      targetWpm: [150, 170],
      group: "story",
    },
    {
      id: "story-giving-directions",
      kind: "passage",
      title: "Story: giving directions",
      text: STORY_GIVING_DIRECTIONS,
      targetWpm: [150, 170],
      group: "story",
    },
    {
      id: "fdr-happiness",
      kind: "passage",
      title: "Franklin D. Roosevelt, on happiness",
      text: FDR_HAPPINESS,
      targetWpm: [130, 150],
      source: "Franklin D. Roosevelt, First Inaugural Address, 1933",
      group: "speech",
    },
    {
      id: "jfk-to-the-moon",
      kind: "passage",
      title: "John F. Kennedy, to the moon",
      text: JFK_TO_THE_MOON,
      targetWpm: [130, 150],
      source: "John F. Kennedy, Address at Rice University, 1962",
      group: "speech",
    },
    {
      id: "tr-man-in-the-arena",
      kind: "passage",
      title: "Theodore Roosevelt, man in the arena",
      text: TR_MAN_IN_THE_ARENA,
      targetWpm: [130, 150],
      source: "Theodore Roosevelt, Citizenship in a Republic, 1910",
      group: "speech",
    },
    {
      id: "jfk-grace-and-beauty",
      kind: "passage",
      title: "John F. Kennedy, grace and beauty",
      text: JFK_GRACE_AND_BEAUTY,
      targetWpm: [130, 150],
      source: "John F. Kennedy, Remarks at Amherst College, 1963",
      group: "speech",
    },
    {
      id: "drill-th-sounds",
      kind: "passage",
      title: "Drill: th as in think and this",
      text: DRILL_TH_SOUNDS,
      targetWpm: [120, 140],
      group: "drill",
    },
    {
      id: "drill-r-and-l",
      kind: "passage",
      title: "Drill: r and l sounds",
      text: DRILL_R_AND_L,
      targetWpm: [120, 140],
      group: "drill",
    },
    {
      id: "drill-v-and-w",
      kind: "passage",
      title: "Drill: v and w sounds",
      text: DRILL_V_AND_W,
      targetWpm: [120, 140],
      group: "drill",
    },
    {
      id: "drill-word-endings",
      kind: "passage",
      title: "Drill: word endings",
      text: DRILL_WORD_ENDINGS,
      targetWpm: [120, 140],
      group: "drill",
    },
  ];

  // The Read tab's groups, in its order. Each passage above names its group by id; Practice shows
  // one chip per group, labeled with the group's label, and a tap draws a passage of the group
  // (docs/superpowers/specs/2026-10-22-tester-feedback-design.md section 2.3).
  const GROUPS = [
    { id: "explainer", label: "Explainer" },
    { id: "story", label: "Story" },
    { id: "speech", label: "Speech" },
    { id: "drill", label: "Drill" },
  ];

  // Each call returns a new array of new objects, so a caller can change its copy without
  // changing the next caller's.
  app.passages.groups = function groups() {
    return GROUPS.map((group) => Object.assign({}, group));
  };

  // Cold reads: original everyday passages the Path hands a speaker to read for the first time
  // (docs/PLAN.md T42 and T44). A Restarts level reads one all through its run, and every read of
  // Pace levels 1 and 2 and of the Pace crown draws a new one (path.js), so the pool has to last
  // both. Explainers, short stories and news-style pieces of 142 to 164 words; the fifteen added
  // on 2026-10-22 follow the first fifteen, which keep their order. None holds a digit or a
  // symbol, which a transcript may write either way, a number word a transcript may write as
  // digits, or a habit word delivery.js counts (like, so, you know, actually, basically), so a
  // take that reads one as written shows no misread and no filler. They are not entries of
  // app.passages, so the Read tab never lists them; coldReads() hands them out. On 2026-10-14
  // every debate-style cold read was rewritten as everyday prose under the id it had, so a take
  // saved on one still counts as read: an id names a slot, not its subject.

  // A steady pace for a text read for the first time, a step under the 150 to 170 of the Read
  // tab's explainers and stories, which can be rehearsed. It is also the band summarize() in
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
    coldRead("cold-read-school-start", "Cold read: the teenage body clock", [
      "Every person carries an internal clock that tells the body when to feel awake and when",
      "to feel sleepy. During the teenage years, that clock shifts later. Many teenagers are not",
      "tired late in the evening, even when they want to be, because the body has not yet",
      "released the hormone that brings on sleep. In the morning, the same clock is still set to",
      "night. That is why an early alarm can feel cruel at that age. A tired brain has trouble",
      "focusing, remembering new facts, and staying calm. A few habits can help. Bright light in",
      "the morning tells the clock that the day has started. Dim light in the evening, and a",
      "break from screens before bed, tell it that night is coming. Going to bed and waking up at",
      "the same time every day, even on weekends, keeps the clock steady. The body clock moves",
      "back again in early adulthood, but until then, a little planning goes a long way.",
    ]),
    coldRead("cold-read-free-transit", "Cold read: a week of free buses", [
      "Riders in a small river town boarded city buses for free this week, the first step in a",
      "trial that will run until the end of the summer. Drivers no longer collect fares at the",
      "door, and passengers now enter through every door at once. On the first morning, the bus",
      "to the hospital was full before it reached the bridge. Some riders said the change saves",
      "them the price of a monthly pass. Others said they had never taken the bus before and",
      "wanted to try it. A bakery owner near the main stop said more people were walking past",
      "her window. The town will count riders every day and ask them to fill out a short survey",
      "about their trips. Officials said the trial will also show whether buses keep to their",
      "timetables when nobody pays at the door. The results will be shared at a public meeting in",
      "the autumn, before the town decides what comes next.",
    ]),
    coldRead("cold-read-nuclear-power", "Cold read: how a power plant works", [
      "Most power plants make electricity in the same basic way. They heat water until it turns",
      "into steam, and the steam spins a large wheel called a turbine. The turbine turns a",
      "generator, where magnets move past coils of copper wire, and that movement pushes electric",
      "current through the wire. The difference between plants is mostly in how they heat the",
      "water. A coal or gas plant burns fuel. A nuclear plant uses the heat released when atoms",
      "split inside its core. A solar plant can focus sunlight with mirrors. Wind turbines skip",
      "the steam altogether, because the wind turns the blades directly. Once the current leaves",
      "the plant, it travels along high voltage lines to a substation near your home, where the",
      "voltage is lowered to a safe level. Within a tiny fraction of a second, that current",
      "reaches the outlet in your kitchen. Every time you switch on a lamp, a turbine somewhere",
      "turns a little harder to keep up.",
    ]),
    coldRead("cold-read-space-funding", "Cold read: satellites at work", [
      "Far above your head, satellites are working while you sleep. Some of them watch the",
      "weather. They photograph clouds as they form over the ocean and measure how warm the sea",
      "is, which helps forecasters warn towns before a storm arrives. Others send signals that",
      "your phone uses to find its place on a map. Each of these satellites carries a very",
      "precise clock, and your phone compares the time signals from several of them to work out",
      "exactly where you are standing. Farmers use satellite images to see which parts of a field",
      "need more water. Scientists use them to measure melting ice and to track forest fires.",
      "When you watch a live broadcast from the other side of the world, the picture may have",
      "bounced off a satellite on its way to you. Most of us never think about these machines,",
      "but daily life would feel very different without them.",
    ]),
    coldRead("cold-read-plastic-bags", "Cold read: the bag by the door", [
      "My grandmother kept a cloth bag on a hook by her front door. It was faded blue, with a",
      "patch in the corner where a jar had once broken inside it. Every Saturday she took it to",
      "the market, and every Saturday she came home with it full of bread, apples, and whatever",
      "fish looked fresh that morning. When I was small, I thought the bag was a little",
      "embarrassing. Other people carried their shopping in thin plastic bags that rustled in the",
      "wind. Years later, after she moved in with us, I found the blue bag folded in the bottom",
      "of her suitcase. I washed it and hung it by our own door. Now I take it to the market on",
      "Saturdays, and the man at the fruit stall always asks after her. The bag has been mended",
      "twice more since then. It will probably outlast me, and I find that comforting.",
    ]),
    coldRead("cold-read-social-media-ages", "Cold read: why feeds keep us scrolling", [
      "Have you ever opened an app to check a single message and looked up half an hour later?",
      "That is not an accident. Many apps are built around a feed with no bottom, where a new",
      "post appears every time you reach the end. Our brains enjoy surprises, and a feed delivers",
      "them at random moments: a funny video, a photo from a friend, a piece of news. Because we",
      "never know when the next good post will appear, we keep scrolling to find it.",
      "Notifications work in a similar way, pulling us back with small red badges and sounds.",
      "None of this makes the apps bad, but it helps to notice what is happening. Some people",
      "turn off notifications for everything except calls and messages. Others move their",
      "favorite apps off the home screen, or set a timer before they start scrolling. Small",
      "changes make it easier to decide for yourself when to put the phone down.",
    ]),
    coldRead("cold-read-compulsory-voting", "Cold read: election day at the library", [
      "On election morning, the public library on Elm Street opened an hour early. Volunteers had",
      "set up rows of small booths in the reading room, each with a curtain and a pen tied to a",
      "string. Before the sun was fully up, a short line had already formed outside the door. A",
      "retired teacher checked each name against a printed list and handed over a folded voting",
      "form. For many people in the line, this was a familiar routine. For a young woman near the",
      "front, it was her first time. She had read about every name on the form the night before,",
      "and she still felt nervous. Inside the booth, she took her time and marked her choices",
      "carefully. When she dropped the form into the box, a volunteer handed her a small sticker.",
      "She pressed it onto her jacket and walked out into the morning, smiling at strangers on",
      "her way to work.",
    ]),
    coldRead("cold-read-zoos", "Cold read: a morning at the zoo", [
      "We reached the zoo just as the gates opened, and my niece ran straight to the map. She had",
      "a single goal for the day: to see the red pandas. We found them in a quiet corner, curled",
      "up high in the branches with their striped tails hanging down. For a long time, nothing",
      "happened. Then the smaller panda woke, stretched, and climbed down to eat some bamboo,",
      "holding each stem in its paws. My niece did not say a word. A keeper walking past told us",
      "that red pandas sleep for much of the day and are most active at dawn and dusk. She",
      "explained that the zoo works with other parks to protect the forests where they live in",
      "the wild. On the way home, my niece fell asleep in the car with the map still in her",
      "hands. When she woke up, the first thing she asked was when we could go back.",
    ]),
    coldRead("cold-read-car-free-centers", "Cold read: a street without cars", [
      "For a weekend each summer, Main Street closes to cars and opens to everyone else. This",
      "year, the street fair drew crowds from early morning until long after dark. Children drew",
      "chalk pictures across the middle of the road, where buses usually run. Restaurants moved",
      "their tables onto the pavement, and a jazz band played on the steps of the old bank. Shop",
      "owners reported a busy weekend. A bookseller said she sold more books on Saturday than in",
      "the whole of the previous week. Not everyone was pleased. A few residents complained about",
      "noise late at night, and delivery drivers had to unload their vans before sunrise. The",
      "city plans to close the street again in the autumn and will ask residents and businesses",
      "what they would change. For now, the chalk drawings are still visible on the road, slowly",
      "fading each time it rains.",
    ]),
    coldRead("cold-read-ai-tools", "Cold read: how chatbots write", [
      "A chatbot can write an email, answer a question, or tell a story in seconds. It feels",
      "almost magical, but the basic idea is simple. The program has been trained on a huge",
      "collection of text, and it has learned which words tend to follow which. When you type a",
      "question, it predicts a likely next word, then the word after that, and it continues until",
      "the answer is complete. This explains both its strengths and its weaknesses. Because it",
      "has seen many well written sentences, its answers usually sound smooth and confident. But",
      "sounding right is not the same as being right. A chatbot can invent a fact, mix up names,",
      "or give an answer that was true years ago. Treat each answer as a helpful first draft.",
      "Check important facts against a trusted source, and make the final decision yourself.",
    ]),
    coldRead("cold-read-service-hours", "Cold read: a first day volunteering", [
      "The food bank was colder than I expected. It was a large warehouse at the edge of town,",
      "with tall shelves of cans and boxes reaching toward the ceiling. A woman named Rosa gave",
      "me gloves and a bright orange vest, and she showed me how to sort the donations. Cans went",
      "in a crate, dry goods in another, and anything past its date went in a bin by the door.",
      "For the first hour, I worked slowly and checked every label twice. Then the rhythm took",
      "over. By noon, our team had filled dozens of crates, and a truck backed up to the loading",
      "dock to collect them. Rosa told me those crates would reach families across the county by",
      "the end of the week. I drove home tired and sore, with my hands still cold. The next",
      "morning, I signed up for another shift.",
    ]),
    coldRead("cold-read-clock-changes", "Cold read: when the clocks change", [
      "In many countries, the clocks move forward by an hour in spring and back by an hour in",
      "autumn. The idea is to shift daylight from the early morning, when most people are asleep,",
      "to the evening, when they are awake to enjoy it. The change itself takes only a second,",
      "but the body notices it for days. In spring, we lose an hour of sleep, and many people feel",
      "tired and slow for the rest of the week. In autumn, the extra hour is easier to absorb,",
      "although evenings suddenly grow dark much earlier. A little preparation makes the switch",
      "smoother. In the days before the spring change, try going to bed a little earlier each",
      "night. Get outside in the morning light as soon as you can after waking. And remember to",
      "check the clocks that do not update themselves, such as the clock on the oven or the car.",
    ]),
    coldRead("cold-read-local-news", "Cold read: a day at the local paper", [
      "The newsroom of a small local paper is quieter than you might imagine. There are no",
      "shouting editors, only a handful of reporters at their desks, each working on several",
      "stories at once. The morning begins with a short meeting about what is happening in town.",
      "Someone covers the council meeting, someone visits the new bakery, and someone checks on",
      "the road repairs that have closed the bridge. Reporters spend much of the day on the phone,",
      "asking questions and checking facts. A good local story needs more than a single source,",
      "and every name must be spelled correctly, because readers will notice. In the afternoon,",
      "the editor reads each story, trims it, and chooses a photo. By evening, the pages are",
      "finished and sent to the printer. The next morning, the paper lands on doorsteps across",
      "town, and the whole process begins again.",
    ]),
    coldRead("cold-read-rent-control", "Cold read: a first apartment", [
      "My first apartment was a single room above a laundromat. The floor sloped slightly toward",
      "the window, and the whole place smelled faintly of warm soap. I had a bed, a folding table,",
      "a pair of chairs, and a small stove with a single working burner. It was perfect. On my",
      "first night, I cooked rice and vegetables and ate at the table by the window, watching",
      "people carry baskets of clothes in and out below. I learned to fix a dripping tap from a",
      "video, and I learned which neighbor played the piano late at night. The rent took most of",
      "my pay, and I counted every coin at the supermarket. Still, the place was mine. When I",
      "moved out years later, I stood in the empty room for a long time before I locked the door",
      "and handed back the key.",
    ]),
    coldRead("cold-read-organ-donors", "Cold read: giving blood", [
      "Giving blood takes less than an hour, and most of that time is spent waiting and resting.",
      "When you arrive at a donation center, a staff member asks about your health and any recent",
      "travel. Next, a nurse checks your temperature and pricks your finger to test your iron",
      "level. If everything looks fine, you lie back in a comfortable chair while the nurse cleans",
      "your arm and inserts a needle. The donation itself usually takes only a few minutes. Most",
      "people feel a small pinch at the start and very little after that. Afterward, you rest for",
      "a while and enjoy a drink and a snack, which helps your body recover. Within a couple of",
      "days, your body replaces the fluid you gave, and within a few weeks it replaces the red",
      "cells. A single donation can help several patients, from accident victims to people having",
      "surgery.",
    ]),
    coldRead("cold-read-refrigerator", "Cold read: how a refrigerator works", [
      "A refrigerator does not make cold. It moves heat out of the box and into the room. A",
      "special fluid does the work, flowing through a closed loop of thin pipes. Inside the",
      "fridge, the fluid boils at a very low temperature, and as it turns to gas, it draws heat",
      "from the food and the air. Sweat cools your skin in the same way when it dries. Next, a",
      "pump called the compressor squeezes the gas until it is hot. That pump makes the low hum",
      "you hear in a quiet kitchen. The hot gas then travels through coils at the back or bottom,",
      "where it gives off its heat and turns back into a liquid. A very narrow tube lowers its",
      "pressure and chills it again, and the loop starts over. This is why the air behind a",
      "fridge feels warm, and why an open fridge door will not cool a hot kitchen. In the end, it",
      "makes the room warmer.",
    ]),
    coldRead("cold-read-bread-dough", "Cold read: why bread dough rises", [
      "Most bread dough rises because something inside it is alive. Yeast is a tiny fungus, too",
      "small to see on its own. Mixed with flour and warm water, it feeds on sugars in the flour",
      "and gives off a gas called carbon dioxide. The gas would escape if the dough could not",
      "hold it. That is the job of gluten, a stretchy web of proteins that forms as the dough is",
      "mixed and folded. The web traps the gas in countless small bubbles, and the dough slowly",
      "swells, the way a balloon fills with air. Warmth speeds the yeast up and cold slows it",
      "down, which is why some bakers let their dough rise overnight in the fridge. In the oven,",
      "the bubbles grow quickly at first. Then the heat kills the yeast and sets the soft dough",
      "into bread. The next time you cut a slice, look closely at the holes. Each of them was",
      "once a bubble of gas.",
    ]),
    coldRead("cold-read-flat-tire", "Cold read: fixing a flat bike tire", [
      "My little brother came home pushing his bike, its front tire completely flat. He was sure",
      "it was ruined. I told him we could fix it ourselves, and he looked at me as if I were",
      "joking. We turned the bike upside down and took off the wheel. With plastic levers, we",
      "eased the edge of the tire over the rim and pulled out the inner tube. We pumped some air",
      "into the tube and held it under water in a bucket. A thin line of bubbles rose from a tiny",
      "hole. My brother gasped. We dried the tube, roughened the spot with sandpaper, and brushed",
      "on some glue. Once the glue was dry, we pressed a patch over the hole. Then I felt along",
      "the inside of the tire and found the cause, a small thorn still stuck in the rubber. We",
      "pulled it out and put everything back together. My brother pumped up the tire himself and",
      "rode off, grinning.",
    ]),
    coldRead("cold-read-power-cut", "Cold read: an evening without power", [
      "The power went out on a stormy evening, just as we sat down to dinner. The lights",
      "flickered and then the whole house went dark. For a moment, nobody spoke. Then my father",
      "found a box of candles in the kitchen drawer, and my mother set them along the middle of",
      "the table. The soup was still hot, and somehow it tasted better by candlelight. Without",
      "the hum of the fridge or the chatter of the television, we could hear the rain drumming on",
      "the roof. My sister fetched a deck of cards, and we played for hours, laughing at the",
      "shadows our hands made on the wall. Nobody reached for a phone. Later, our neighbor",
      "knocked to check on us, and he stayed for a cup of tea made on the gas stove. When the",
      "lights came back on just before midnight, we all groaned. My mother blew out the candles,",
      "but she left the cards on the table.",
    ]),
    coldRead("cold-read-repair-night", "Cold read: repair night at the hall", [
      "On the first Thursday evening of each month, the community hall on River Road becomes a",
      "busy workshop. Neighbors arrive carrying broken lamps, wobbly chairs, torn coats, and",
      "toasters that no longer toast. Volunteers sit at long tables with screwdrivers, sewing",
      "kits, and boxes of spare parts, and they fix whatever they can for free. The idea is",
      "simple. Instead of throwing something away, you bring it in and watch while it is",
      "repaired. Many visitors end up learning to do the job themselves. Last month, a retired",
      "electrician brought an old radio back to life as a small crowd watched. At the next table,",
      "a teenager learned to sew a button onto her favorite jacket. The organizers keep a",
      "notebook of every repair, and they say most items go home fixed. Coffee and cake are",
      "served while people wait. Anyone can come, and nobody needs an appointment. The volunteers",
      "would welcome more help, especially from people who can mend shoes.",
    ]),
    coldRead("cold-read-honey-bees", "Cold read: how bees make honey", [
      "Most honey begins inside a flower. Many flowers make nectar, a sweet, watery liquid that",
      "attracts insects. On a warm morning, worker bees fly from blossom to blossom, drinking",
      "nectar with their long, thin tongues. They carry it home in a special pouch called the",
      "honey stomach. Back at the hive, they pass it to younger bees, mouth to mouth. Along the",
      "way, the bees add enzymes that split the sugar in the nectar into simpler sugars. The",
      "younger bees store it in the wax cells of the comb. To thicken the runny nectar, the bees",
      "fan their wings over the comb, and the moving air carries water away. When the nectar has",
      "become honey, they seal each cell with a cap of wax. That honey feeds the colony through",
      "the winter, when few flowers bloom. The flowers shape the flavor too: clover honey is pale",
      "and mild, while buckwheat honey is dark and strong.",
    ]),
    coldRead("cold-read-tides", "Cold read: what makes the tides", [
      "Spend a day at the beach, and you may see the sea creep up the sand, then slip away. On",
      "many coasts, the water rises and falls about twice a day. These changes are called tides,",
      "and the moon is their main cause. Its gravity pulls on all of Earth, but hardest on the",
      "side facing it. There, the ocean bulges toward the moon. On the far side, the pull is",
      "weakest, and the water is left behind in a second bulge. As Earth turns, a coast passes",
      "through both bulges, and each time it does, the tide is high. Between them, the tide is",
      "low. The sun raises tides as well, though they are smaller, because it is much farther",
      "away. When the sun and moon line up, at full moon and new moon, their pulls combine, and",
      "the tides rise higher and fall lower. At half moon, the sun and moon pull at right angles,",
      "and the tides are gentler.",
    ]),
    coldRead("cold-read-clouds", "Cold read: how clouds form", [
      "On a cold morning, you can make a small cloud with your own breath. Your breath is warm",
      "and holds water vapor, an invisible gas. When the chilly air cools it, the vapor becomes",
      "tiny drops of water, and a white puff appears. Clouds in the sky form in much the same",
      "way. The sun warms lakes, seas and wet ground, and some of their water evaporates into the",
      "air. Warm, damp air rises, and as it climbs, it spreads out and cools. When it cools",
      "enough, the vapor condenses, turning back into liquid droplets on specks of dust, smoke or",
      "sea salt. A typical droplet is far smaller than a grain of sand. Countless droplets",
      "together make a cloud. Tiny and light, they float on the rising air. Inside the cloud,",
      "droplets bump into each other and join. When the drops grow heavy enough, they fall as",
      "rain. Fog is simply a cloud that forms near the ground.",
    ]),
    coldRead("cold-read-butterfly", "Cold read: caterpillar to butterfly", [
      "A butterfly starts life as an egg about the size of a pinhead, stuck to a leaf or stem.",
      "Its mother probably chose that plant by tasting it with her feet. When the tiny",
      "caterpillar hatches, its first meal is often its own eggshell. Then it eats leaf after",
      "leaf and grows fast. Several times, its skin gets too tight, and it wriggles free. Once",
      "fully grown, the caterpillar fastens itself to a twig with a pad of silk. Its skin splits",
      "for the last time, revealing a soft shell called a chrysalis, which soon hardens. Inside",
      "it, much of the old body breaks down into a kind of soup. Tiny groups of cells, formed",
      "inside the egg, use that soup to build wings, legs and new eyes. When the change is",
      "complete, the shell cracks open. The butterfly crawls out with soft, crumpled wings and",
      "pumps fluid into them until they spread. Once they dry and harden, it flies away.",
    ]),
    coldRead("cold-read-bean-jar", "Cold read: a bean in a jar", [
      "When my son was small, we grew a bean in a glass jar by the kitchen window. We lined the",
      "jar with a wet paper towel and tucked a dry bean between the towel and the glass. Every",
      "morning, he pressed his nose to the jar to check on it. At first the bean simply swelled,",
      "drinking water from the towel. A few days later, its skin split, and a pale root pushed",
      "out and headed downward. My son turned the jar on its side to trick it, but by bedtime the",
      "root had changed course and was growing down again. Next came a shoot, hooked at the top,",
      "which straightened as it climbed toward the window. The bean itself slowly wrinkled and",
      "shrank, because the young plant was living on the food stored inside it. When the first",
      "green leaves opened, we planted it in the garden. That summer, he picked beans from his",
      "very own plant.",
    ]),
    coldRead("cold-read-learning-to-swim", "Cold read: learning to swim", [
      "I never learned to swim as a child, and for years I sat on the sand while my friends played",
      "in the waves. Last winter, I signed up for lessons at the city pool. On the first evening,",
      "I stood in the shallow end with my heart pounding, even though the water only reached my",
      "waist. Our teacher was a patient man who never raised his voice. He started with breathing.",
      "We put our faces in the water and blew bubbles, breathing out slowly through our noses.",
      "Next, he taught us to float. He told us to lie back, look at the ceiling, and let the water",
      "hold us. I sank the first few times, because I was fighting it. When I finally relaxed, the",
      "water held me up, and I laughed out loud. By spring, I could swim the whole length of the",
      "pool without stopping. I am still slow, but I no longer sit on the sand and watch.",
    ]),
    coldRead("cold-read-letter-journey", "Cold read: how a letter travels", [
      "When you drop a letter into the mailbox on the corner, it can cross the country in a few",
      "days. Later that day, it is collected and taken to a large sorting center, where machines",
      "take over. A machine turns every envelope to face the same way and prints wavy lines over",
      "the stamp to mark it as used. Next, a camera reads the address, printed or handwritten.",
      "When the writing is too messy, a photo of the envelope appears on a screen, and a person",
      "types the address in. Then a barcode is printed on the envelope, and the machines after",
      "that read the barcode instead of the address. Trucks, and sometimes planes, carry the",
      "letter to the right town. Near the end of the trip, a machine sorts the letters into the",
      "exact order in which the mail carrier will deliver them. The next day, the carrier brings",
      "your letter to the right door, and someone opens it at the kitchen table.",
    ]),
    coldRead("cold-read-museum-guide", "Cold read: a guide at the museum", [
      "I have been a guide at the city museum for years, and I still learn something on almost",
      "every tour. Last week I led a class of young children, with their teacher and a grandfather",
      "who came to help. We began in the long gallery, in front of an old painting of the harbor.",
      "I asked everyone to look at it for a whole minute without saying a word. That is harder",
      "than it sounds. Then I asked what they had noticed. A boy saw the storm clouds. His friend",
      "counted the ships. A small girl at the back pointed to the lower corner, where a tiny dog",
      "lay asleep under a fish cart. I must have walked past that painting thousands of times, and",
      "I had never seen the dog. The children were delighted, and the grandfather laughed louder",
      "than anyone. Now every tour I lead begins with that painting and that quiet minute, and I",
      "let my visitors find the dog themselves.",
    ]),
    coldRead("cold-read-lost-and-found", "Cold read: the lost and found office", [
      "Below the central station, down a narrow flight of stairs, there is an office that few",
      "travelers visit until they need it. This is where the city keeps everything people leave",
      "behind on its trains and buses. On wet days, umbrellas arrive by the armful, along with",
      "gloves, keys and phones. Each item is labeled with the date and the line where it was",
      "found, then stored on long metal shelves. The oddest finds this year include a set of",
      "drums, a wedding dress and a toy bear in a knitted hat. The team works hard to return what",
      "it can. Anything left unclaimed for a few months goes to charity. Staff say the best part",
      "of the job is the moment an owner gets something back. Last month, a young man came in",
      "looking for the watch his grandfather had given him. It had been found under a bus seat. He",
      "held it for a long time before he could speak.",
    ]),
    coldRead("cold-read-window-cleaners", "Cold read: window cleaners up high", [
      "High above the river, a team of window cleaners is back at work on the tallest tower in the",
      "city. Each morning, the crew rides the elevator to the roof and steps onto a metal platform",
      "hanging from steel cables. A motor lowers them slowly down the building, floor by floor,",
      "while they wash the glass and wipe it dry with rubber blades. The job depends on the",
      "weather. When the wind grows strong, the platform stays on the roof and the crew waits. The",
      "team leader said she never gets tired of the view. Office workers often wave as the",
      "cleaners pass, and some hold up handwritten notes against the glass. Last spring, a pair of",
      "falcons nested on a high ledge, and the crew left that corner alone until the chicks could",
      "fly. The team should reach the last side of the tower by late summer. By then, they say,",
      "the first side will need cleaning again.",
    ]),
  ];

  // The Path draws every cold read from this list (path.js pickColdRead), for Restarts and for
  // Pace. Each call returns a new array, so a caller can filter or shuffle it without changing
  // what the next caller gets.
  app.passages.coldReads = function coldReads() {
    return COLD_READS.slice();
  };

  // The benchmark (docs/superpowers/specs/2026-10-14-loop-path.md section 5): one passage to read
  // and one prompt to talk on, held out from everything else, so the same two at every sitting
  // show real progress outside the path. Neither is an entry of app.passages or a cold read, so
  // no other take ever practises them. The read keeps the cold reads' rules: original everyday
  // prose (an explainer), 140 to 180 words, with no digit, symbol, quotation mark, number word or
  // habit word.
  const BENCHMARK_TARGET_WPM = [140, 160];
  const BENCHMARK_TALK_SECONDS = 90;

  const BENCHMARK_READ = [
    "Street trees do more work than most people notice. On a hot afternoon, pavement and",
    "rooftops soak up sunlight and release the heat long after dark. A row of mature trees",
    "shades the sidewalk, cools the homes behind it, and gives people waiting for the bus a",
    "place to stand. Trees also clean the air. Their leaves catch dust, and their roots soak up",
    "rain that would otherwise flood the gutters. Many birds and insects live in their branches,",
    "even on busy roads. A young tree needs care to reach that size. For its first few summers,",
    "it needs a deep drink of water every week, and its trunk needs protection from cars and",
    "bikes. Neighbors often help by watering the trees on their own block. With time and a",
    "little attention, a thin young tree can grow into the tallest thing on the street, and it",
    "may still be standing there a century from now.",
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
