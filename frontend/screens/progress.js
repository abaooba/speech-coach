/* screens/progress.js: app.screens.progress, the Progress screen (DESIGN.md sections 1 and 6).
   show() draws the rank card (app.rankCard) and charts one metric over the speaker's own takes;
   the pure helpers series, scale and summaryFor do the maths without the DOM. The sample a
   visitor opens from Practice never counts (app.screens.results.isSample), and the SVG chart is
   drawn by hand: no chart library. Once the speaker has a take read aloud, a Talk | Read switch
   charts each kind of take on its own (owner decision 2026-10-22). */
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  // How each metric ranks its best take (DESIGN.md section 6, "Chart"): pace by its distance
  // from the take's own target band, the counts by the lowest value, the clean stretch by the
  // highest.
  const CLOSEST_TO_BAND = "band";
  const LOWEST = "lowest";
  const HIGHEST = "highest";

  // A take whose passage band is unknown is judged against results.js's default band.
  const DEFAULT_TARGET_WPM = [140, 160];

  // The fillers target, "under 3" a minute: the same line as the Results card and the tips.
  const FILLERS_TARGET = 3;

  // The four metrics the chart can show, in option order. `key` names a field of the summary
  // app.screens.results.summarize returns; `short` labels the option, `label` is the full name
  // for the title, the chart's aria-label and the table; `color` is the line's token. The three
  // counts are `fromZero`, so their axis always starts at 0. `best` ranks the takes, `digits`
  // and `unit` write a value ("21.4 /min"), and `changeUnit`, `rise` and `fall` write the change
  // from the average in the Results delta words ("2.1 s longer"). `targetUnder` shades a band.
  const METRICS = [
    {
      key: "wpm",
      short: "Pace",
      label: "Words per minute",
      color: "var(--accent)",
      fromZero: false,
      best: CLOSEST_TO_BAND,
      digits: 0,
      unit: " wpm",
      changeUnit: "",
      rise: "faster",
      fall: "slower",
    },
    {
      key: "fillersPerMinute",
      short: "Fillers",
      label: "Fillers per minute",
      color: "var(--filler)",
      fromZero: true,
      best: LOWEST,
      digits: 1,
      unit: " /min",
      changeUnit: "",
      rise: "more",
      fall: "fewer",
      targetUnder: FILLERS_TARGET,
    },
    {
      key: "pauseCount",
      short: "Pauses",
      label: "Pauses",
      color: "var(--pause)",
      fromZero: true,
      best: LOWEST,
      digits: 0,
      unit: "",
      changeUnit: "",
      rise: "more",
      fall: "fewer",
    },
    {
      key: "cleanStretchSeconds",
      short: "Clean",
      label: "Longest clean stretch",
      color: "var(--ok)",
      fromZero: true,
      best: HIGHEST,
      digits: 1,
      unit: " s",
      changeUnit: " s",
      rise: "longer",
      fall: "shorter",
    },
  ];
  const DEFAULT_KEY = "wpm";
  const CONTROL_LABEL = "Chart metric";

  // Takes read aloud chart Slips in Fillers' place: a passage holds no filler words to say, so a
  // read's fillers stay near 0 whatever the speaker does. A slip is a restart or a misread word
  // (summary.slipsPerMinute). `definition` is the muted line under the title; `minRange` keeps
  // the axis at 0 to 5 until a take goes higher, since slips run lower than fillers. The line is
  // in the text colour, which no other metric draws with. `counts` says whether a take's slips
  // can be counted: a take on a passage that strayed from it (or was saved before takes were
  // lined up against their script) reports no misreads, which would draw as a clean read, so it
  // is left out of this chart alone. A metric without `counts` charts every take.
  const SLIPS = {
    key: "slipsPerMinute",
    short: "Slips",
    label: "Slips per minute",
    definition: "Restarts and misread words",
    color: "var(--text)",
    fromZero: true,
    minRange: 5,
    best: LOWEST,
    digits: 1,
    unit: " /min",
    changeUnit: "",
    rise: "more",
    fall: "fewer",
    counts: (summary) => !summary.report || summary.report.followedScript !== false,
  };
  const READ_METRICS = METRICS.map((metric) =>
    metric.key === "fillersPerMinute" ? SLIPS : metric,
  );

  // The Talk | Read switch, drawn once the speaker has a take read aloud (app.language.isReadTake):
  // each mode charts its own takes only, so a read's near-silent numbers never pass for progress
  // in free talk. Both modes keep the metric switch's position: Slips sits where Fillers does.
  // `noun` writes the empty state, `caption` the line under the switch after the take count.
  const TALK = "talk";
  const READ = "read";
  const MODES = [
    {
      id: TALK,
      label: "Talk",
      metrics: METRICS,
      noun: "Talk take",
      caption: " · your own words · rated",
    },
    {
      id: READ,
      label: "Read",
      metrics: READ_METRICS,
      noun: "Read take",
      caption: " · read aloud · not rated",
    },
  ];
  const MODES_LABEL = "Takes to show";
  const TITLE_JOINER = " · ";
  const ONE_TAKE = " take";
  const TAKES = " takes";

  // The drawing box in viewBox units, and the padding that leaves room for the labels.
  const DEFAULT_GEOMETRY = {
    width: 320,
    height: 200,
    padLeft: 36,
    padRight: 12,
    padTop: 12,
    padBottom: 28,
  };

  // The data range runs from 0 for the counts, or from the ten at or below 20 under the slowest
  // take for pace, up to the highest value; it spans at least 10 (a metric's own minRange, where
  // it has one) so a flat series (or a single point) still has a height to draw against.
  const FLOOR_STEP = 10;
  const WPM_HEADROOM = 20;
  const MIN_RANGE = 10;

  // Round ticks (DESIGN.md section 6): the smallest of these steps that splits the data range
  // into at most five intervals, with the axis padded out to whole steps, so a top of 21.4 reads
  // 0 to 25 in fives. A range no listed step fits (only a malformed record gets there) keeps
  // multiplying the largest one by ten.
  const ROUND_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200];
  const MAX_INTERVALS = 5;
  const STEP_GROWTH = 10;

  // Coordinates are written with at most two decimals so the markup stays readable.
  const COORD_SCALE = 100;

  // Where the labels sit relative to the axes, in viewBox units; dy centers a y label on its
  // gridline. Up to five takes every one gets a date; past that, five dates spread evenly, or
  // fewer where five would crowd. The widest short date, "May 28", is about 43 units wide at the
  // micro size, so centered dates keep their centers X_LABEL_SPACING apart.
  const Y_LABEL_GAP = 6;
  const Y_LABEL_DY = "0.35em";
  const X_LABEL_DROP = 18;
  const MAX_X_LABELS = 5;
  const X_LABEL_SPACING = 44;

  // Strokes and fills are tokens only, never hex (DESIGN.md section 4).
  const GRID_COLOR = "var(--grid)";
  const AXIS_COLOR = "var(--border)";
  const LABEL_COLOR = "var(--muted)";
  const BAND_COLOR = "var(--ok-bg)";
  const TARGET_COLOR = "var(--ok)";
  const TARGET_DASH = "4 4";
  const GRID_WIDTH = "1";
  const LINE_WIDTH = "2";
  const POINT_RADIUS = "4";

  // The personal best: a ring 7 units out around its point and a micro "Best" label. The label's
  // box is estimated from the micro size as 27 units wide and 9 tall above its baseline. Above
  // or below the point it sits 9 units to one side (or centered), its baseline 12 units above
  // the point or 21 below it (the ring plus the label); level with the point it sits 12 units
  // to the side, clear of the ring. It keeps 1 unit clear of the line.
  const RING_RADIUS = 7;
  const BEST_WIDTH = 27;
  const BEST_HEIGHT = 9;
  const BEST_SIDE_SHIFT = 9;
  const BEST_LEVEL_SHIFT = 12;
  const BEST_RISE = 12;
  const BEST_DROP = 21;
  const BEST_CLEARANCE = 1;
  const ANCHOR_START = "start";
  const ANCHOR_MIDDLE = "middle";
  const ANCHOR_END = "end";

  // Fixed copy (DESIGN.md section 8): the under-two state, whose words count what is missing
  // (two takes with none yet, one more after the first), the summary row, the band legend, the
  // chart's aria-label and the table.
  const MIN_SESSIONS = 2;
  const EMPTY_TITLE = "Need two sessions";
  const EMPTY_BODY_NONE = "Record two sessions to see a trend.";
  const EMPTY_BODY_ONE = "Record one more to see a trend.";
  const EMPTY_ICON = "chart";
  const RECORD_LABEL = "Record";
  // The example trend under "Need two sessions": fillers per minute over six takes, falling
  // toward the target band the real chart draws (0 to 3). Values, not data: a picture of what
  // the chart will show, in the Fillers series color.
  const PREVIEW_VIEWBOX = "0 0 320 120";
  const PREVIEW_VALUES = [8.5, 7.2, 7.8, 5.1, 4.4, 3.2];
  const PREVIEW_MAX = 10;
  const PREVIEW_TARGET = 3;
  const PREVIEW_PAD = { left: 16, right: 16, top: 12, bottom: 12 };
  const PREVIEW_CAPTION = "Example: fillers per minute falling over six takes.";
  const PREVIEW_STEPS = ["Take 1", "Take 2"];
  const PREVIEW_STEPS_LABEL = " of 2 takes recorded";
  const LATEST_LABEL = "Latest";
  const BEST_LABEL = "Best";
  const CHANGE_LABEL = "From your average";
  const NO_CHANGE = "No change";
  const NOT_MEASURED = "Not measured";
  const LEGEND_PREFIX = "Target under ";
  const LABEL_OVER = " over ";
  const LABEL_LATEST = " sessions, latest ";
  const CAPTION_SUFFIX = " by session";
  const SESSION_HEADER = "Session";
  const DATE_HEADER = "Date";

  // The change's icon: a triangle that points the way the number moved, or a dash.
  const RISE_ICON = "triangle-up";
  const FALL_ICON = "triangle-down";
  const SAME_ICON = "dash";
  const CHANGE_ICON_SIZE = 12;

  // The rank card (docs/PLAN.md T37) is built for this screen: its foot is the streak.
  const RANK_SCREEN = "progress";

  // The screen's .screen__body; show() rebuilds everything inside it.
  let body = null;

  // Counts show() calls so a slow load from an earlier visit cannot paint over a newer one.
  let showCount = 0;

  // The metric whose option is selected; module state so it survives leaving the screen. It is
  // always a Talk metric's key: on Read the option in the same place is selected (Slips for
  // Fillers).
  let selectedKey = DEFAULT_KEY;

  // The mode the speaker picked on the Talk | Read switch, or null before they pick one: then
  // Talk, or Read for a speaker with no talk take yet. Module state, as selectedKey.
  let selectedMode = null;

  function mount(root) {
    body = root.querySelector(".screen__body");
  }

  // One number per take, oldest first, so the line reads left to right in time.
  function series(sessions, key) {
    return valuesOf(summariesOf(ownTakes(sessions)), key);
  }

  // The sessions that are the speaker's own takes, in the order given. History lists the sample
  // too, but it never adds a point, wins Best, moves the average or counts toward the two
  // sessions a trend needs. A results module without isSample counts every session.
  function ownTakes(sessions) {
    const list = Array.isArray(sessions) ? sessions : [];
    const results = app.screens.results;
    if (!results || typeof results.isSample !== "function") {
      return list;
    }
    return list.filter((session) => !results.isSample(session));
  }

  // Each session's summary, oldest first: the store lists newest first, hence the reverse.
  // Reads summarize when called, never at load.
  function summariesOf(sessions) {
    const list = Array.isArray(sessions) ? sessions : [];
    return list.map((session) => app.screens.results.summarize(session)).reverse();
  }

  // One metric from each summary; a missing or malformed value reads as 0, so a bad record
  // never breaks the chart.
  function valuesOf(summaries, key) {
    return summaries.map((summary) => numberOr0(summary[key]));
  }

  // SVG coordinates for `values` (oldest first) plus the axis they sit on. x spreads the points
  // evenly across the plot (a single point sits in the middle); y runs from yMax at the top
  // padding down to yMin at the bottom padding. yTicks are the gridline values, a round step
  // apart from yMin to yMax.
  function scale(values, key, opts) {
    const geometry = Object.assign({}, DEFAULT_GEOMETRY, opts || {});
    const numbers = (Array.isArray(values) ? values : []).map(numberOr0);
    const low = axisFloor(numbers, key);
    const highest = numbers.length > 0 ? Math.max(...numbers) : 0;
    const range = metricFor(key).minRange || MIN_RANGE;
    const { yMin, yMax, yTicks } = roundAxis(low, Math.max(highest, low + range));
    const points = numbers.map((value, index) => ({
      x: xFor(index, numbers.length, geometry),
      y: yFor(value, yMin, yMax, geometry),
    }));
    return { points, yMin, yMax, yTicks };
  }

  // 0 for the counts; for pace, the ten at or below 20 under the slowest take, never below 0.
  function axisFloor(numbers, key) {
    if (metricFor(key).fromZero || numbers.length === 0) {
      return 0;
    }
    const lowest = Math.min(...numbers);
    return Math.max(0, Math.floor((lowest - WPM_HEADROOM) / FLOOR_STEP) * FLOOR_STEP);
  }

  // The data range [low, high] padded out to whole round steps, and every tick on it: 120 to 160
  // reads 120, 130, 140, 150, 160, 50 to 152 becomes 50 to 175 in steps of 25, and 0 to 21.4
  // becomes 0 to 25 in steps of 5.
  function roundAxis(low, high) {
    const intervals = (step) => Math.ceil(high / step) - Math.floor(low / step);
    let step = ROUND_STEPS.find((candidate) => intervals(candidate) <= MAX_INTERVALS);
    if (step === undefined) {
      step = ROUND_STEPS[ROUND_STEPS.length - 1];
      while (intervals(step) > MAX_INTERVALS) {
        step *= STEP_GROWTH;
      }
    }
    const yMin = Math.floor(low / step) * step;
    const yMax = Math.ceil(high / step) * step;
    const yTicks = [];
    for (let tick = yMin; tick <= yMax; tick += step) {
      yTicks.push(tick);
    }
    return { yMin, yMax, yTicks };
  }

  function xFor(index, count, geometry) {
    const left = geometry.padLeft;
    const right = geometry.width - geometry.padRight;
    if (count < 2) {
      return (left + right) / 2;
    }
    return left + ((right - left) * index) / (count - 1);
  }

  // yMax - yMin is at least MIN_RANGE, so this never divides by zero.
  function yFor(value, yMin, yMax, geometry) {
    const top = geometry.padTop;
    const bottom = geometry.height - geometry.padBottom;
    return top + ((yMax - value) / (yMax - yMin)) * (bottom - top);
  }

  // The summary row's numbers for one metric, from its values oldest first and, for pace, each
  // take's [lo, hi] target band. latest is the last take, average the mean of the takes before
  // it, and change is latest minus average (null with nothing before it). best is the fewest
  // fillers or mid-sentence pauses, the longest clean stretch, or the pace closest to its own
  // band (0 anywhere inside it); a tie goes to the most recent take. A null value marks a take
  // with nothing measured: it reads as 0, the way the chart draws it, and never wins fillers or
  // pauses, so bestIndex is -1 when no take can win.
  function summaryFor(values, key, targets) {
    const list = Array.isArray(values) ? values : [];
    const numbers = list.map(numberOr0);
    const earlier = numbers.slice(0, -1);
    const latest = numbers.length > 0 ? numbers[numbers.length - 1] : null;
    const average = earlier.length > 0 ? sum(earlier) / earlier.length : null;
    const bestIndex = bestIndexOf(list, metricFor(key), Array.isArray(targets) ? targets : []);
    return {
      latest,
      best: bestIndex === -1 ? null : numbers[bestIndex],
      bestIndex,
      average,
      change: average === null ? null : latest - average,
    };
  }

  // Every take gets a score where lower is better; `<=` hands a tie to the later take.
  function bestIndexOf(values, metric, targets) {
    let bestIndex = -1;
    let bestScore = Infinity;
    values.forEach((value, index) => {
      if (metric.best === LOWEST && isUnmeasured(value)) {
        return;
      }
      const score = scoreOf(metric, numberOr0(value), targets[index]);
      if (score <= bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  function scoreOf(metric, value, target) {
    if (metric.best === CLOSEST_TO_BAND) {
      return distanceFromBand(value, target);
    }
    return metric.best === HIGHEST ? -value : value;
  }

  // How far a pace sits outside its band; 0 anywhere inside, the ends included.
  function distanceFromBand(value, target) {
    const [lo, hi] = isBand(target) ? target : DEFAULT_TARGET_WPM;
    return Math.max(lo - value, value - hi, 0);
  }

  function isBand(target) {
    return (
      Array.isArray(target) && target.length === 2 && target.every((end) => Number.isFinite(end))
    );
  }

  function isUnmeasured(value) {
    return value === null || value === undefined;
  }

  function sum(numbers) {
    return numbers.reduce((total, number) => total + number, 0);
  }

  // The metric for a key, Slips included; an unknown key draws like pace rather than throwing.
  function metricFor(key) {
    return METRICS.concat(SLIPS).find((metric) => metric.key === key) || METRICS[0];
  }

  function numberOr0(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function coord(value) {
    return String(Math.round(value * COORD_SCALE) / COORD_SCALE);
  }


  // Draws the rank card first, then a segmented control, the metric's full name, a summary row
  // and a hand-rolled SVG line chart (a target band for fillers, a ring on the best take, short
  // dates under the points) with a screen-reader table. Tapping an option redraws everything
  // under the control. Under two takes the card, when there is one, sits above the empty state.
  // Once a take was read aloud, the Talk | Read switch comes between the card and the rest.
  async function show() {
    const ticket = ++showCount;
    const takes = ownTakes(await loadSessions());
    if (ticket !== showCount) {
      return;
    }
    const rankCard = buildRankCard(takes);
    if (takes.some(isReadTake)) {
      renderSplit(takes, rankCard);
    } else if (takes.length < MIN_SESSIONS) {
      renderEmpty(takes.length, rankCard);
    } else {
      renderChart(takes, rankCard);
    }
  }

  // A take read aloud (app.language.isReadTake): a passage, a cold read, the benchmark read or a
  // pasted script it followed. Without language.js every take counts as talk, as before the rule.
  function isReadTake(session) {
    const language = app.language;
    return (
      Boolean(language) && typeof language.isReadTake === "function" && language.isReadTake(session)
    );
  }

  // The rank card for the speaker's own takes, its streak counted to now, or null: with no rated
  // take, or while rank.js or rankcard.js is not loaded, Progress draws as it did before the
  // card. The card is extra to the chart, so one that cannot be built never stops the screen.
  function buildRankCard(takes) {
    const rankCard = app.rankCard;
    if (!rankCard || typeof rankCard.model !== "function" || typeof rankCard.build !== "function") {
      return null;
    }
    try {
      const model = rankCard.model(takes, { screen: RANK_SCREEN, today: new Date() });
      return model === null ? null : rankCard.build(model, { screen: RANK_SCREEN });
    } catch {
      return null;
    }
  }

  // The stored sessions newest first, or none when the store cannot be read: a broken database
  // shows "Need two sessions" rather than a console error.
  async function loadSessions() {
    try {
      const sessions = await app.store.list();
      return Array.isArray(sessions) ? sessions : [];
    } catch {
      return [];
    }
  }

  // Nothing to release: show() rebuilds the body from the store every time.
  function hide() {}

  // `count` is how many takes there are, 0 or 1. With one, the rank card goes above the block:
  // renderState empties the body for the block, so the block moves back under the card.
  function renderEmpty(count, rankCard) {
    const block = app.ui.renderState(body, {
      kind: "empty",
      icon: EMPTY_ICON,
      title: EMPTY_TITLE,
      body: count === 0 ? EMPTY_BODY_NONE : EMPTY_BODY_ONE,
      actionLabel: RECORD_LABEL,
      onAction: () => app.router.go("practice"),
      preview: buildPreview(count),
    });
    if (rankCard) {
      body.removeChild(block);
      body.appendChild(rankCard);
      body.appendChild(block);
    }
  }

  // The preview's three parts: the example chart, its caption and the two-take tracker.
  function buildPreview(count) {
    return [previewChart(), previewCaption(), previewSteps(count)];
  }

  function previewCaption() {
    return app.ui.el("p", { class: "progress-preview__caption", text: PREVIEW_CAPTION });
  }

  // A 320 x 120 picture: the target band along the bottom, a dashed line through six points.
  function previewChart() {
    const svg = svgEl("svg", {
      class: "progress-preview__chart",
      viewBox: PREVIEW_VIEWBOX,
      "aria-hidden": "true",
    });
    const width = 320 - PREVIEW_PAD.left - PREVIEW_PAD.right;
    const height = 120 - PREVIEW_PAD.top - PREVIEW_PAD.bottom;
    const y = (value) => PREVIEW_PAD.top + height - (value / PREVIEW_MAX) * height;
    const x = (index) => PREVIEW_PAD.left + (index / (PREVIEW_VALUES.length - 1)) * width;
    svg.appendChild(
      svgEl("rect", {
        class: "progress-preview__band",
        x: String(PREVIEW_PAD.left),
        y: String(y(PREVIEW_TARGET)),
        width: String(width),
        height: String(y(0) - y(PREVIEW_TARGET)),
      }),
    );
    const points = PREVIEW_VALUES.map((value, i) => x(i).toFixed(1) + "," + y(value).toFixed(1));
    svg.appendChild(
      svgEl("polyline", { class: "progress-preview__line", points: points.join(" ") }),
    );
    PREVIEW_VALUES.forEach((value, i) => {
      svg.appendChild(
        svgEl("circle", {
          class: "progress-preview__point",
          cx: x(i).toFixed(1),
          cy: y(value).toFixed(1),
          r: "4",
        }),
      );
    });
    return svg;
  }

  // "Take 1 · Take 2", each recorded take filled; the list's label says the count for readers.
  function previewSteps(count) {
    const items = PREVIEW_STEPS.map((label, i) =>
      app.ui.el("li", {
        class: "progress-preview__step" + (i < count ? " progress-preview__step--done" : ""),
        text: label,
      }),
    );
    return app.ui.el(
      "ol",
      { class: "progress-preview__steps", "aria-label": count + PREVIEW_STEPS_LABEL },
      items,
    );
  }

  // The rank card, when there is one, and the chart under it.
  function renderChart(sessions, rankCard) {
    app.ui.clear(body);
    if (rankCard) {
      body.appendChild(rankCard);
    }
    appendChart(sessions, METRICS, null);
  }

  // The split view: the rank card, the Talk | Read switch and its caption, then the chosen
  // mode's chart, or its empty state under two takes. The switch and the caption are built once
  // per show(); a mode tap only swaps what sits under them, so the tapped option keeps focus,
  // and a tap on the mode shown changes nothing. Each mode's takes are summarized the first time
  // it is drawn, not on every tap.
  function renderSplit(takes, rankCard) {
    const takesOf = {
      [TALK]: takes.filter((take) => !isReadTake(take)),
      [READ]: takes.filter(isReadTake),
    };
    const summariesBy = {};
    const options = MODES.map((mode) => buildOption(mode.label, false, () => choose(mode.id)));
    const control = {
      class: "segmented progress__modes",
      role: "group",
      "aria-label": MODES_LABEL,
    };
    const caption = app.ui.el("p", { class: "progress__caption" });
    app.ui.clear(body);
    if (rankCard) {
      body.appendChild(rankCard);
    }
    body.appendChild(app.ui.el("div", control, options));
    body.appendChild(caption);
    draw();

    function shownId() {
      return selectedMode || (takesOf[TALK].length > 0 ? TALK : READ);
    }

    function choose(modeId) {
      if (modeId === shownId()) {
        return;
      }
      selectedMode = modeId;
      draw();
    }

    function draw() {
      const mode = MODES.find((each) => each.id === shownId());
      const sessions = takesOf[mode.id];
      options.forEach((option, index) => markOption(option, MODES[index].id === mode.id));
      const count = sessions.length + (sessions.length === 1 ? ONE_TAKE : TAKES);
      caption.textContent = count + mode.caption;
      removeAfter(caption);
      if (sessions.length < MIN_SESSIONS) {
        appendModeEmpty(mode, sessions.length);
        return;
      }
      if (!summariesBy[mode.id]) {
        summariesBy[mode.id] = summariesOf(sessions);
      }
      appendChart(sessions, mode.metrics, mode, summariesBy[mode.id]);
    }
  }

  // "Need two Read takes", under the switch: renderState builds the block in a holder of its own,
  // since it empties the node it draws into, and the block then moves to the end of the body.
  function appendModeEmpty(mode, count) {
    const block = app.ui.renderState(app.ui.el("div", {}), {
      kind: "empty",
      icon: EMPTY_ICON,
      title: "Need two " + mode.noun + "s",
      body:
        count === 0
          ? "Record two " + mode.noun + "s to see a trend."
          : "Record one more " + mode.noun + " to see a trend.",
      actionLabel: RECORD_LABEL,
      onAction: () => app.router.go("practice"),
    });
    body.appendChild(block);
  }

  // Takes every node after `node` out of the body.
  function removeAfter(node) {
    const children = Array.from(body.children);
    children.slice(children.indexOf(node) + 1).forEach((child) => body.removeChild(child));
  }

  // The metric switch (the options of `metrics`) and everything under it, appended to the body.
  // With a `mode` (the split view) every title names it, so a Read number never passes for a
  // Talk one once the switch has scrolled away. The switch is built once; a tap only swaps what
  // sits under it (the title, the summary, the chart, its legend and the table), so the tapped
  // option keeps focus and never flickers. The sessions are summarized once, not on every tap:
  // here, or by the split view, which passes its own `summaries` (oldest first) along.
  function appendChart(sessions, metrics, mode, summaries = summariesOf(sessions)) {
    const oldestFirst = [...sessions].reverse();
    const measured = summaries.map(wasMeasured);
    const days = oldestFirst.map((session) => app.ui.formatDay(session.createdAt));
    const options = metrics.map((metric, index) =>
      buildOption(metric.short, index === selectedIndex(), () => choose(index)),
    );
    let drawn = [];

    const control = { class: "segmented", role: "group", "aria-label": CONTROL_LABEL };
    body.appendChild(app.ui.el("div", control, options));
    draw();

    function choose(index) {
      selectedKey = METRICS[index].key;
      options.forEach((option, at) => markOption(option, at === index));
      draw();
    }

    // Draws the selected metric over the takes it charts (`charted`, indexes into the summaries):
    // every take, or for a metric with `counts` only the takes it can count.
    function draw() {
      drawn.forEach((node) => body.removeChild(node));
      const metric = metrics[selectedIndex()];
      const label = mode ? mode.label + TITLE_JOINER + metric.label : metric.label;
      const charted = summaries
        .map((summary, index) => index)
        .filter((index) => !metric.counts || metric.counts(summaries[index]));
      const values = charted.map((index) => numberOr0(summaries[index][metric.key]));
      const forSummary = charted.map((index, at) => (measured[index] ? values[at] : null));
      const targets = charted.map((index) => summaries[index].target);
      const summary = summaryFor(forSummary, metric.key, targets);
      drawn = [
        app.ui.el("h2", { class: "progress__title", text: label }),
        metric.definition
          ? app.ui.el("p", { class: "progress__definition", text: metric.definition })
          : null,
        buildSummary(metric, summary),
        buildSvg(metric, label, values, charted.map((index) => days[index]), summary.bestIndex),
        metric.targetUnder ? buildLegend(metric.targetUnder) : null,
        buildTable(label, charted.map((index) => oldestFirst[index]), values),
      ].filter((node) => node !== null);
      drawn.forEach((node) => body.appendChild(node));
    }
  }

  // Where the selected option sits in the metric switch: the same place in both modes.
  function selectedIndex() {
    const index = METRICS.findIndex((metric) => metric.key === selectedKey);
    return index === -1 ? 0 : index;
  }

  // False only when the take's report timed no speech at all: every rate then reads 0 and
  // means nothing. A summary that carries no report counts as measured.
  function wasMeasured(summary) {
    return !summary.report || summary.report.speakingSeconds > 0;
  }

  // A toggle button in a segmented control: a metric's short name, or a mode's.
  function buildOption(text, selected, onClick) {
    const option = app.ui.el("button", {
      class: "segmented__option",
      type: "button",
      text,
      onClick,
    });
    markOption(option, selected);
    return option;
  }

  function markOption(option, selected) {
    option.classList.toggle("segmented__option--selected", selected);
    option.setAttribute("aria-pressed", String(selected));
  }

  // The summary row: three cells, each a label over its value. The change cell leads with a
  // triangle or a dash, like the delta lines on the Results cards.
  function buildSummary(metric, summary) {
    const best = valueOrNone(metric, summary.best, "progress-summary__value num");
    return app.ui.el("dl", { class: "progress-summary" }, [
      summaryItem(LATEST_LABEL, valueOrNone(metric, summary.latest)),
      summaryItem(BEST_LABEL, best),
      summaryItem(CHANGE_LABEL, changeOrNone(metric, summary.change)),
    ]);
  }

  // The change cell, or "Not measured" as Latest and Best read it when no earlier take was
  // charted to average (Slips with one read counted, or none). A chart of every take, as each
  // Talk chart is, draws two takes or more, so it always has one.
  function changeOrNone(metric, change) {
    if (change === null) {
      return valueOrNone(metric, null);
    }
    const described = describeChange(metric, change);
    return app.ui.el("dd", { class: "progress-summary__change num" }, [
      app.ui.icon(described.icon, CHANGE_ICON_SIZE),
      described.text,
    ]);
  }

  function summaryItem(label, value) {
    return app.ui.el("div", { class: "progress-summary__item" }, [
      app.ui.el("dt", { class: "progress-summary__label", text: label }),
      value,
    ]);
  }

  // A value as its cell shows it, or "Not measured" for none: a Best no take can win, a Latest
  // with no take charted (Slips when no read could be counted), or a change with no earlier take
  // charted to average.
  function valueOrNone(metric, value, className) {
    if (value === null) {
      return summaryValue(NOT_MEASURED, "progress-summary__value progress-summary__value--none");
    }
    return summaryValue(formatValue(metric, value), className);
  }

  function summaryValue(text, className) {
    return app.ui.el("dd", { class: className || "progress-summary__value num", text });
  }

  // "152 wpm", "21.4 /min", "3", "4.9 s".
  function formatValue(metric, value) {
    return numberOr0(value).toFixed(metric.digits) + metric.unit;
  }

  // The latest take against the average in the Results delta words, at the metric's precision:
  // "12 faster", "1.2 fewer", "2.1 s longer", or "No change" when it rounds to nothing.
  function describeChange(metric, change) {
    const size = Math.abs(numberOr0(change)).toFixed(metric.digits);
    if (Number(size) === 0) {
      return { icon: SAME_ICON, text: NO_CHANGE };
    }
    const rose = change > 0;
    return {
      icon: rose ? RISE_ICON : FALL_ICON,
      text: size + metric.changeUnit + " " + (rose ? metric.rise : metric.fall),
    };
  }

  // The chart, bottom layer first: the fillers band, gridlines, the band's dashed target line,
  // axes, labels, the line and its dots, then the best take's ring and label on top. `label` is
  // the title the chart sits under, which its aria-label repeats.
  function buildSvg(metric, label, values, days, bestIndex) {
    const geometry = DEFAULT_GEOMETRY;
    const { points, yMin, yMax, yTicks } = scale(values, metric.key);
    const yOf = (value) => yFor(value, yMin, yMax, geometry);
    const tickYs = yTicks.map(yOf);
    const frame = {
      left: geometry.padLeft,
      right: geometry.width - geometry.padRight,
      top: geometry.padTop,
      bottom: geometry.height - geometry.padBottom,
      width: geometry.width,
    };
    const latest = values.length > 0 ? values[values.length - 1] : 0;
    const bandTop = metric.targetUnder ? Math.max(yOf(metric.targetUnder), frame.top) : null;

    const svg = svgEl("svg", {
      class: "chart",
      viewBox: "0 0 " + geometry.width + " " + geometry.height,
      role: "img",
      "aria-label": label + LABEL_OVER + values.length + LABEL_LATEST + latest,
    });
    [
      ...band(bandTop, frame),
      ...gridlines(tickYs, frame),
      ...targetLine(bandTop, frame),
      ...axes(frame),
      ...yLabels(yTicks, tickYs, frame),
      ...xLabels(points, days, frame),
      line(points, metric.color),
      ...dots(points, metric.color),
      ...bestMarker(points, bestIndex, metric.color, frame),
    ].forEach((node) => svg.appendChild(node));
    return svg;
  }

  // The target band from the bottom of the plot up to the target, for a metric that has one.
  function band(top, frame) {
    if (top === null) {
      return [];
    }
    return [
      svgEl("rect", {
        class: "chart__band",
        x: coord(frame.left),
        y: coord(top),
        width: coord(frame.right - frame.left),
        height: coord(frame.bottom - top),
        fill: BAND_COLOR,
      }),
    ];
  }

  // A dashed line along the top of the band, at the target itself.
  function targetLine(top, frame) {
    if (top === null) {
      return [];
    }
    const node = segment(frame.left, frame.right, top, top, TARGET_COLOR);
    node.setAttribute("class", "chart__target");
    node.setAttribute("stroke-dasharray", TARGET_DASH);
    return [node];
  }

  function gridlines(tickYs, frame) {
    return tickYs.map((y) => segment(frame.left, frame.right, y, y, GRID_COLOR));
  }

  // The left axis down the plot, then the bottom axis along it.
  function axes(frame) {
    return [
      segment(frame.left, frame.left, frame.top, frame.bottom, AXIS_COLOR),
      segment(frame.left, frame.right, frame.bottom, frame.bottom, AXIS_COLOR),
    ];
  }

  // A 1px straight line between two plot coordinates.
  function segment(x1, x2, y1, y2, color) {
    return svgEl("line", {
      x1: coord(x1),
      x2: coord(x2),
      y1: coord(y1),
      y2: coord(y2),
      stroke: color,
      "stroke-width": GRID_WIDTH,
    });
  }

  // Whole numbers, right-aligned just left of the axis, centered on their gridline.
  function yLabels(yTicks, tickYs, frame) {
    return yTicks.map((tick, index) =>
      svgText(String(Math.round(tick)), {
        x: coord(frame.left - Y_LABEL_GAP),
        y: coord(tickYs[index]),
        dy: Y_LABEL_DY,
        "text-anchor": "end",
        fill: LABEL_COLOR,
      }),
    );
  }

  // Short dates ("Oct 9") under the points, oldest first: every take up to five, else up to five
  // spread from the first take to the last. A date the label before it already shows is skipped,
  // and the label under the last point is anchored at its end so it stays inside the chart.
  function xLabels(points, days, frame) {
    const last = points.length - 1;
    let shown = null;
    return labelIndexes(points.length, frame).flatMap((index) => {
      const day = days[index];
      if (!day || day === shown) {
        return [];
      }
      shown = day;
      return [
        svgText(day, {
          x: coord(points[index].x),
          y: coord(frame.bottom + X_LABEL_DROP),
          "text-anchor": index === last ? ANCHOR_END : ANCHOR_MIDDLE,
          fill: LABEL_COLOR,
        }),
      ];
    });
  }

  // Every index up to five takes. Past that, five indexes spread from the first to the last,
  // or four, three or two when the closest pair would sit under X_LABEL_SPACING apart (eight
  // takes get four). Rounding down makes the last gap the widest, at least 68 units for five, so
  // the end-anchored last date always has room for its full width.
  function labelIndexes(count, frame) {
    if (count <= MAX_X_LABELS) {
      return Array.from({ length: count }, (_, index) => index);
    }
    const pointGap = (frame.right - frame.left) / (count - 1);
    let labels = MAX_X_LABELS;
    let indexes = spreadIndexes(count, labels);
    while (labels > 2 && closestGap(indexes) * pointGap < X_LABEL_SPACING) {
      labels -= 1;
      indexes = spreadIndexes(count, labels);
    }
    return indexes;
  }

  // `labels` indexes from 0 to count - 1, evenly spread and rounded down: 20 takes give 0, 4, 9,
  // 14 and 19.
  function spreadIndexes(count, labels) {
    return Array.from({ length: labels }, (_, step) =>
      Math.floor((step * (count - 1)) / (labels - 1)),
    );
  }

  // The fewest takes between two neighboring indexes.
  function closestGap(indexes) {
    return Math.min(...indexes.slice(1).map((index, at) => index - indexes[at]));
  }

  function line(points, color) {
    return svgEl("polyline", {
      points: points.map((point) => coord(point.x) + "," + coord(point.y)).join(" "),
      fill: "none",
      stroke: color,
      "stroke-width": LINE_WIDTH,
    });
  }

  function dots(points, color) {
    return points.map((point) =>
      svgEl("circle", { cx: coord(point.x), cy: coord(point.y), r: POINT_RADIUS, fill: color }),
    );
  }

  // The personal best in the series color: a ring around its point, drawn as a path so it never
  // counts as one more dot, and the "Best" label beside it. Nothing when no take can be best.
  function bestMarker(points, bestIndex, color, frame) {
    const point = points[bestIndex];
    if (!point) {
      return [];
    }
    const spot = bestLabelSpot(points, bestIndex, frame);
    return [
      svgEl("path", {
        class: "chart__best",
        d: ringPath(point),
        fill: "none",
        stroke: color,
        "stroke-width": LINE_WIDTH,
      }),
      svgText(BEST_LABEL, {
        class: "chart__best-label",
        x: coord(spot.x),
        y: coord(spot.y),
        "text-anchor": spot.anchor,
        fill: color,
      }),
    ];
  }

  // A circle of RING_RADIUS around the point as two half arcs: "M233 166.67 a7 7 0 1 0 14 0 ...".
  function ringPath(point) {
    const arc = "a" + RING_RADIUS + " " + RING_RADIUS + " 0 1 0 ";
    const start = "M" + coord(point.x - RING_RADIUS) + " " + coord(point.y);
    return [start, arc + 2 * RING_RADIUS + " 0", arc + -2 * RING_RADIUS + " 0"].join(" ");
  }

  // Where the "Best" label goes, as spots in order of preference. First above the point on the
  // side away from the steeper of its two segments, where the line leaves the most room; then
  // centered over it; then above on the other side. Next beside the point at its own height,
  // for a line that falls steeply into it, and last the three spots below it, which is where a
  // point at the top of the chart ends up. The first spot inside the chart that keeps clear of
  // the line wins; failing that, the first one inside.
  function bestLabelSpot(points, index, frame) {
    const point = points[index];
    const leftSteeper = steepness(point, points[index - 1]) > steepness(point, points[index + 1]);
    const away = leftSteeper ? 1 : -1;
    const above = point.y - BEST_RISE;
    const level = point.y + BEST_HEIGHT / 2;
    const below = point.y + BEST_DROP;
    const spots = [
      beside(point, away, BEST_SIDE_SHIFT, above),
      centered(point, above, frame),
      beside(point, -away, BEST_SIDE_SHIFT, above),
      beside(point, away, BEST_LEVEL_SHIFT, level),
      beside(point, -away, BEST_LEVEL_SHIFT, level),
      beside(point, away, BEST_SIDE_SHIFT, below),
      centered(point, below, frame),
      beside(point, -away, BEST_SIDE_SHIFT, below),
    ];
    const inside = spots.filter((spot) => fitsChart(labelBox(spot), frame));
    const clear = inside.find((spot) => clearOfLine(labelBox(spot), points));
    return clear || inside[0] || spots[0];
  }

  // A spot `shift` units to the right (side 1) or left (side -1) of the point, its text running
  // away from the point.
  function beside(point, side, shift, y) {
    return { x: point.x + side * shift, y, anchor: side > 0 ? ANCHOR_START : ANCHOR_END };
  }

  // A spot centered over or under the point, slid inward so the label never crosses the y axis
  // or the chart's right edge.
  function centered(point, y, frame) {
    const half = BEST_WIDTH / 2;
    const x = Math.min(Math.max(point.x, frame.left + half), frame.width - half);
    return { x, y, anchor: ANCHOR_MIDDLE };
  }

  // How steeply the line runs from a point to a neighbor; 0 when there is no neighbor.
  function steepness(point, neighbor) {
    if (!neighbor) {
      return 0;
    }
    return Math.abs(neighbor.y - point.y) / (Math.abs(neighbor.x - point.x) || 1);
  }

  // The label's estimated box around its anchor point.
  function labelBox(spot) {
    const share = { start: 0, middle: 0.5, end: 1 }[spot.anchor];
    const left = spot.x - BEST_WIDTH * share;
    return { left, right: left + BEST_WIDTH, top: spot.y - BEST_HEIGHT, bottom: spot.y };
  }

  // Right of the y axis, inside the viewBox and above the x axis.
  function fitsChart(box, frame) {
    const across = box.left >= frame.left && box.right <= frame.width;
    return across && box.top >= 0 && box.bottom <= frame.bottom;
  }

  // True when no segment of the line comes within BEST_CLEARANCE of the box.
  function clearOfLine(box, points) {
    const near = {
      left: box.left - BEST_CLEARANCE,
      right: box.right + BEST_CLEARANCE,
      top: box.top - BEST_CLEARANCE,
      bottom: box.bottom + BEST_CLEARANCE,
    };
    return points.every((point, index) => index === 0 || !crosses(points[index - 1], point, near));
  }

  // Whether the straight segment from a to b (b to the right of a) passes through the box.
  function crosses(a, b, box) {
    const left = Math.max(a.x, box.left);
    const right = Math.min(b.x, box.right);
    if (left > right) {
      return false;
    }
    const yAt = (x) => a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    const ends = [yAt(left), yAt(right)];
    return Math.min(...ends) <= box.bottom && Math.max(...ends) >= box.top;
  }

  // Words for the target band under the chart, so color is not its only cue (DESIGN.md section
  // 9): the micro label "Target under 3" after a swatch that repeats the band's fill and dashed
  // edge.
  function buildLegend(target) {
    return app.ui.el("p", { class: "chart__legend num" }, [
      app.ui.el("span", { class: "chart__swatch", "aria-hidden": "true" }),
      LEGEND_PREFIX + target,
    ]);
  }

  // The same numbers as the chart, for screen readers: one row per charted session, oldest first
  // (`oldestFirst`), in the order the points run, under the chart's title (`label`).
  function buildTable(label, oldestFirst, values) {
    const rows = oldestFirst.map((session, index) =>
      app.ui.el("tr", {}, [
        app.ui.el("th", { scope: "row", text: String(index + 1) }),
        app.ui.el("td", { text: app.ui.formatDate(session.createdAt) }),
        app.ui.el("td", { class: "num", text: String(values[index]) }),
      ]),
    );
    const headers = [SESSION_HEADER, DATE_HEADER, label].map((text) =>
      app.ui.el("th", { scope: "col", text }),
    );
    return app.ui.el("table", { class: "sr-only" }, [
      app.ui.el("caption", { text: label + CAPTION_SUFFIX }),
      app.ui.el("thead", {}, app.ui.el("tr", {}, headers)),
      app.ui.el("tbody", {}, rows),
    ]);
  }

  // SVG elements need their own namespace and take every attribute, class included, through
  // setAttribute.
  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach((key) => node.setAttribute(key, attrs[key]));
    return node;
  }

  function svgText(text, attrs) {
    const node = svgEl("text", attrs);
    node.textContent = text;
    return node;
  }

  app.screens.progress = { mount, show, hide, series, scale, summaryFor };
})();
