/* ui.js: app.ui, the DOM helpers every screen builds from.
   el() builds elements node by node (never from markup strings), clear() empties a root,
   renderState() builds the empty / error / loading blocks, announce() writes the live region,
   and formatClock() / formatDate() turn seconds and ISO timestamps into display strings. */
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const LIVE_REGION_ID = "live";
  const ICON_SIZE = "32";

  // Attribute names that el() treats specially; everything else goes through setAttribute.
  const CLASS_KEY = "class";
  const DATASET_KEY = "dataset";
  const TEXT_KEY = "text";

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    applyAttributes(node, attrs || {});
    appendChildren(node, children);
    return node;
  }

  function applyAttributes(node, attrs) {
    Object.keys(attrs).forEach((key) => {
      const value = attrs[key];
      if (key === CLASS_KEY) {
        node.className = value;
      } else if (key === DATASET_KEY) {
        Object.assign(node.dataset, value);
      } else if (key === TEXT_KEY) {
        node.textContent = value;
      } else if (isListenerKey(key, value)) {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        node.setAttribute(key, value);
      }
    });
  }

  function isListenerKey(key, value) {
    return key.length > 2 && key.startsWith("on") && typeof value === "function";
  }

  function appendChildren(node, children) {
    if (children === undefined || children === null) {
      return;
    }
    const list = Array.isArray(children) ? children : [children];
    list.forEach((child) => {
      if (child === undefined || child === null) {
        return;
      }
      if (typeof child === "string" || typeof child === "number") {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    });
  }

  function clear(root) {
    while (root.firstChild) {
      root.removeChild(root.firstChild);
    }
  }

  // Builds the shared empty / error / loading block (DESIGN.md section 6, "State block").
  function renderState(root, options) {
    const { kind, title, body, actionLabel, onAction } = options;
    clear(root);

    const block = el("div", { class: "state state--" + kind });
    if (kind === "error") {
      block.setAttribute("role", "alert");
    } else if (kind === "loading") {
      block.setAttribute("role", "status");
    }

    block.appendChild(kind === "loading" ? spinner() : stateIcon(kind));
    block.appendChild(el("h2", { class: "state__title", text: title }));
    block.appendChild(el("p", { class: "state__body", text: body }));

    if (actionLabel) {
      const variant = kind === "error" ? "btn--primary" : "btn--secondary";
      block.appendChild(
        el(
          "button",
          { class: "state__action btn " + variant, type: "button", onClick: onAction },
          actionLabel,
        ),
      );
    }

    root.appendChild(block);
    return block;
  }

  function spinner() {
    return el("div", { class: "spinner", "aria-hidden": "true" });
  }

  // A 32px decorative icon: a triangle for errors, a circle for everything else.
  function stateIcon(kind) {
    const svg = svgEl("svg", {
      class: "state__icon",
      width: ICON_SIZE,
      height: ICON_SIZE,
      viewBox: "0 0 32 32",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    });
    const shape =
      kind === "error"
        ? svgEl("polygon", { points: "16 4 29 27 3 27" })
        : svgEl("circle", { cx: "16", cy: "16", r: "12" });
    svg.appendChild(shape);
    return svg;
  }

  // SVG elements need their own namespace and take class via setAttribute.
  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach((key) => node.setAttribute(key, attrs[key]));
    return node;
  }

  function announce(text) {
    const live = document.getElementById(LIVE_REGION_ID);
    if (live) {
      live.textContent = text;
    }
  }

  function formatClock(seconds) {
    const whole = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(whole / 60);
    const rest = whole % 60;
    return minutes + ":" + String(rest).padStart(2, "0");
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    const text = date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    // Newer ICU builds put a narrow no-break space before "PM"; keep the documented plain space.
    return text.replace(/\s/g, " ");
  }

  app.ui = { el, clear, renderState, announce, formatClock, formatDate };
})();
