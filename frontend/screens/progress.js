/* screens/progress.js: app.screens.progress, the Progress screen (DESIGN.md sections 1 and 6).
   Two pure helpers do the maths without the DOM: series(sessions, key) pulls one metric out of
   the stored sessions oldest first through app.screens.results.summarize, and scale(values, key)
   turns those numbers into SVG points, a y axis snapped to tens and four gridline values. show()
   draws a chip row and a hand-rolled SVG line chart with a screen-reader table under it; tapping
   a chip redraws the chart for that metric, and the choice survives leaving the screen. */
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  // The three metrics the chart can show, in chip order. `key` names a field of the summary
  // app.screens.results.summarize returns; `color` is the line's token (DESIGN.md section 6,
  // "Chart"); the two counts are `fromZero`, so their axis always starts at 0.
  const METRICS = [
    { key: "wpm", label: "Words per minute", color: "var(--accent)", fromZero: false },
    { key: "fillersPerMinute", label: "Fillers per minute", color: "var(--filler)", fromZero: true },
    { key: "pauseCount", label: "Pauses", color: "var(--pause)", fromZero: true },
  ];
  const DEFAULT_KEY = "wpm";

  // The drawing box in viewBox units, and the padding that leaves room for the labels.
  const DEFAULT_GEOMETRY = {
    width: 320,
    height: 200,
    padLeft: 36,
    padRight: 12,
    padTop: 12,
    padBottom: 28,
  };

  // The y axis snaps to multiples of 10, starts 20 under the slowest take for pace, and spans at
  // least 10 so a flat series (or a single point) still has a height to draw against.
  const AXIS_STEP = 10;
  const WPM_HEADROOM = 20;
  const MIN_RANGE = 10;

  // Coordinates are written with at most two decimals so the markup stays readable.
  const COORD_SCALE = 100;

  // Where the labels sit relative to the axes, in viewBox units; dy centers a y label on its
  // gridline. Up to eight sessions every x label fits; beyond that every other one is drawn.
  const Y_LABEL_GAP = 6;
  const Y_LABEL_DY = "0.35em";
  const X_LABEL_DROP = 18;
  const MAX_FULL_X_LABELS = 8;

  // Strokes and fills are tokens only, never hex (DESIGN.md section 4).
  const GRID_COLOR = "var(--grid)";
  const AXIS_COLOR = "var(--border)";
  const LABEL_COLOR = "var(--muted)";
  const GRID_WIDTH = "1";
  const LINE_WIDTH = "2";
  const POINT_RADIUS = "4";

  // Fixed copy for the under-two state (DESIGN.md section 8), the aria-label and the table.
  const MIN_SESSIONS = 2;
  const EMPTY_TITLE = "Need two sessions";
  const EMPTY_BODY = "Record one more to see a trend.";
  const RECORD_LABEL = "Record";
  const LABEL_OVER = " over ";
  const LABEL_LATEST = " sessions, latest ";
  const CAPTION_SUFFIX = " by session";
  const SESSION_HEADER = "Session";
  const DATE_HEADER = "Date";

  // The screen's .screen__body; show() rebuilds everything inside it.
  let body = null;

  // Counts show() calls so a slow load from an earlier visit cannot paint over a newer one.
  let showCount = 0;

  // The metric whose chip is selected; module state so it survives leaving the screen.
  let selectedKey = DEFAULT_KEY;

  function mount(root) {
    body = root.querySelector(".screen__body");
  }

  // One number per session, oldest first, so the line reads left to right in time. The store
  // lists newest first, hence the reverse. Reads summarize when called, never at load, and
  // turns a missing or malformed value into 0 so a bad record never breaks the chart.
  function series(sessions, key) {
    const list = Array.isArray(sessions) ? sessions : [];
    return list
      .map((session) => numberOr0(app.screens.results.summarize(session)[key]))
      .reverse();
  }

  // SVG coordinates for `values` (oldest first) plus the axis they sit on. x spreads the points
  // evenly across the plot (a single point sits in the middle); y runs from yMax at the top
  // padding down to yMin at the bottom padding. yTicks are the four gridline values.
  function scale(values, key, opts) {
    const geometry = Object.assign({}, DEFAULT_GEOMETRY, opts || {});
    const numbers = (Array.isArray(values) ? values : []).map(numberOr0);
    const yMin = axisFloor(numbers, key);
    const yMax = axisCeiling(numbers, yMin);
    const points = numbers.map((value, index) => ({
      x: xFor(index, numbers.length, geometry),
      y: yFor(value, yMin, yMax, geometry),
    }));
    return { points, yMin, yMax, yTicks: ticksBetween(yMin, yMax) };
  }

  // 0 for the counts; for pace, the ten at or below 20 under the slowest take, never below 0.
  function axisFloor(numbers, key) {
    if (metricFor(key).fromZero || numbers.length === 0) {
      return 0;
    }
    const lowest = Math.min(...numbers);
    return Math.max(0, Math.floor((lowest - WPM_HEADROOM) / AXIS_STEP) * AXIS_STEP);
  }

  // The ten at or above the highest value, and at least one step above the floor.
  function axisCeiling(numbers, yMin) {
    const highest = numbers.length > 0 ? Math.max(...numbers) : 0;
    return Math.max(Math.ceil(highest / AXIS_STEP) * AXIS_STEP, yMin + MIN_RANGE);
  }

  // Both ends of the axis and the two thirds between them.
  function ticksBetween(yMin, yMax) {
    const third = (yMax - yMin) / 3;
    return [yMin, yMin + third, yMin + 2 * third, yMax];
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

  // The metric for a chip key; an unknown key draws like pace rather than throwing.
  function metricFor(key) {
    return METRICS.find((metric) => metric.key === key) || METRICS[0];
  }

  function numberOr0(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function coord(value) {
    return String(Math.round(value * COORD_SCALE) / COORD_SCALE);
  }

  async function show() {
    const ticket = ++showCount;
    const sessions = await loadSessions();
    if (ticket !== showCount) {
      return;
    }
    if (sessions.length < MIN_SESSIONS) {
      renderEmpty();
    } else {
      renderChart(sessions);
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

  function renderEmpty() {
    app.ui.renderState(body, {
      kind: "empty",
      title: EMPTY_TITLE,
      body: EMPTY_BODY,
      actionLabel: RECORD_LABEL,
      onAction: () => app.router.go("practice"),
    });
  }

  // The chip row is built once per show(); a tap only swaps the chart and the table under it,
  // so the tapped chip keeps focus and the row never flickers.
  function renderChart(sessions) {
    const chips = METRICS.map((metric) => buildChip(metric, () => choose(metric.key)));
    let drawn = [];

    app.ui.clear(body);
    body.appendChild(app.ui.el("div", { class: "chip-row" }, chips));
    draw();

    function choose(key) {
      selectedKey = key;
      chips.forEach((chip, index) => markChip(chip, METRICS[index].key === key));
      draw();
    }

    function draw() {
      drawn.forEach((node) => body.removeChild(node));
      const metric = metricFor(selectedKey);
      const values = series(sessions, metric.key);
      drawn = [buildSvg(metric, values), buildTable(metric, sessions, values)];
      drawn.forEach((node) => body.appendChild(node));
    }
  }

  function buildChip(metric, onClick) {
    const chip = app.ui.el("button", { class: "chip", type: "button", text: metric.label, onClick });
    markChip(chip, metric.key === selectedKey);
    return chip;
  }

  function markChip(chip, selected) {
    chip.classList.toggle("chip--selected", selected);
    chip.setAttribute("aria-pressed", String(selected));
  }

  // The chart, bottom layer first: gridlines, axes, labels, the line, then the dots on top.
  function buildSvg(metric, values) {
    const geometry = DEFAULT_GEOMETRY;
    const { points, yMin, yMax, yTicks } = scale(values, metric.key);
    const tickYs = yTicks.map((tick) => yFor(tick, yMin, yMax, geometry));
    const frame = {
      left: geometry.padLeft,
      right: geometry.width - geometry.padRight,
      top: geometry.padTop,
      bottom: geometry.height - geometry.padBottom,
    };
    const latest = values.length > 0 ? values[values.length - 1] : 0;

    const svg = svgEl("svg", {
      class: "chart",
      viewBox: "0 0 " + geometry.width + " " + geometry.height,
      role: "img",
      "aria-label": metric.label + LABEL_OVER + values.length + LABEL_LATEST + latest,
    });
    [
      ...gridlines(tickYs, frame),
      ...axes(frame),
      ...yLabels(yTicks, tickYs, frame),
      ...xLabels(points, frame),
      line(points, metric.color),
      ...dots(points, metric.color),
    ].forEach((node) => svg.appendChild(node));
    return svg;
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

  // "1" to "n" under the points, oldest first; past eight sessions only every other one.
  function xLabels(points, frame) {
    return points
      .map((point, index) =>
        svgText(String(index + 1), {
          x: coord(point.x),
          y: coord(frame.bottom + X_LABEL_DROP),
          "text-anchor": "middle",
          fill: LABEL_COLOR,
        }),
      )
      .filter((_, index) => points.length <= MAX_FULL_X_LABELS || index % 2 === 0);
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

  // The same numbers as the chart, for screen readers: one row per session, oldest first, in
  // the order the x labels count them.
  function buildTable(metric, sessions, values) {
    const oldestFirst = [...sessions].reverse();
    const rows = oldestFirst.map((session, index) =>
      app.ui.el("tr", {}, [
        app.ui.el("th", { scope: "row", text: String(index + 1) }),
        app.ui.el("td", { text: app.ui.formatDate(session.createdAt) }),
        app.ui.el("td", { class: "num", text: String(values[index]) }),
      ]),
    );
    const headers = [SESSION_HEADER, DATE_HEADER, metric.label].map((text) =>
      app.ui.el("th", { scope: "col", text }),
    );
    return app.ui.el("table", { class: "sr-only" }, [
      app.ui.el("caption", { text: metric.label + CAPTION_SUFFIX }),
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

  app.screens.progress = { mount, show, hide, series, scale };
})();
