/* app.js: creates window.app, the only global, and owns the hash router (app.router.go, current).
   Screens register as app.screens[name] = { mount(root), show(params), hide() }; on
   DOMContentLoaded each is mounted once, then the hash is routed (to Onboarding on a first launch,
   no "onboarded" flag in app.store). No hash change is routed before that mount. It never builds
   what goes inside a screen's section. */
(function () {
  "use strict";

  const SCREEN_NAMES = [
    "onboarding",
    "practice",
    "results",
    "history",
    "progress",
    "path",
    "level",
  ];
  const DEFAULT_SCREEN = "practice";
  const ACTIVE_SCREEN_CLASS = "screen--active";
  const ACTIVE_NAV_CLASS = "nav__item--active";
  const NAV_SELECTOR = ".nav";
  const PAGE_TITLE = "Speech Coach";
  const TITLE_SEPARATOR = " · ";
  const ONBOARDING_SCREEN = "onboarding";
  const ONBOARDING_HASH = "#/onboarding";
  const ONBOARDED_FLAG = "onboarded";
  // A screen without its own nav item lights up the item it belongs to: a level is on the Path.
  const NAV_PARENT = Object.freeze({ level: "path" });

  const app = { screens: {}, router: {} };
  window.app = app;

  // Name of the screen whose show() ran last, so route() can call its hide(); null until the
  // boot route, which is how route() knows not to move focus then.
  let shownScreenName = null;
  // The id that screen was shown with (a session id on Results), or null.
  let shownId = null;
  // The location.hash route() last handled. A first launch's boot sets the hash to Onboarding
  // and routes at once; the hashchange that queues finds this hash and changes nothing.
  let routedHash = null;

  app.router.go = function go(name, params) {
    const idPart = params && params.id ? "/" + params.id : "";
    window.location.hash = "#/" + name + idPart;
  };

  app.router.current = function current() {
    const path = window.location.hash.replace(/^#\/?/, "");
    const [name, rawId] = path.split("/");
    if (!SCREEN_NAMES.includes(name)) {
      return { name: DEFAULT_SCREEN, params: {} };
    }
    const params = {};
    if (rawId) {
      params.id = decodeIdSafely(rawId);
    }
    return { name, params };
  };

  function decodeIdSafely(rawId) {
    try {
      return decodeURIComponent(rawId);
    } catch {
      return rawId;
    }
  }

  function sectionFor(name) {
    return document.getElementById("screen-" + name);
  }

  function hidePreviousScreen() {
    const previous = app.screens[shownScreenName];
    if (previous && typeof previous.hide === "function") {
      previous.hide();
    }
  }

  function activateSection(name) {
    SCREEN_NAMES.forEach((screenName) => {
      const section = sectionFor(screenName);
      if (section) {
        section.hidden = true;
        section.classList.remove(ACTIVE_SCREEN_CLASS);
      }
    });
    const target = sectionFor(name);
    if (target) {
      target.hidden = false;
      target.classList.add(ACTIVE_SCREEN_CLASS);
    }
  }

  function updateNav(name) {
    const activeHref = "#/" + (NAV_PARENT[name] || name);
    document.querySelectorAll(".nav__item").forEach((link) => {
      const isActive = link.getAttribute("href") === activeHref;
      link.classList.toggle(ACTIVE_NAV_CLASS, isActive);
      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  // A new screen, or another session on Results, opens at the top: the browser would keep the
  // last screen's scroll. The test fakes have no scrollTo.
  function scrollToTop() {
    if (typeof window.scrollTo === "function") {
      window.scrollTo(0, 0);
    }
  }

  // The section's h1, or null when it has none or the test fake cannot query.
  function headingOf(section) {
    if (!section || typeof section.querySelector !== "function") {
      return null;
    }
    return section.querySelector("h1");
  }

  // "Results · Speech Coach": the tab names the screen by its h1. Onboarding's h1 is the app's
  // own name, so it keeps the plain title, as does a section without an h1.
  function titleFor(heading) {
    const text = heading ? String(heading.textContent || "").trim() : "";
    return text && text !== PAGE_TITLE ? text + TITLE_SEPARATOR + PAGE_TITLE : PAGE_TITLE;
  }

  // Whether keyboard focus sits in `container`; false when a fake has no contains().
  function holdsFocus(container) {
    const active = document.activeElement;
    if (!container || !active || typeof container.contains !== "function") {
      return false;
    }
    return container.contains(active);
  }

  function navElement() {
    return typeof document.querySelector === "function"
      ? document.querySelector(NAV_SELECTOR)
      : null;
  }

  // After an in-app screen change keyboard focus starts on the new screen's h1, so the next Tab
  // walks that screen from the top instead of jumping to the nav. Focus already inside the
  // screen, or on the nav link just activated, stays put. preventScroll leaves the scroll to
  // route(), which already put a new screen at the top. The test fakes may lack focus().
  function focusHeading(section, heading) {
    if (!heading || holdsFocus(section) || holdsFocus(navElement())) {
      return;
    }
    heading.setAttribute("tabindex", "-1");
    if (typeof heading.focus === "function") {
      heading.focus({ preventScroll: true });
    }
  }

  function route() {
    if (window.location.hash === routedHash) {
      return;
    }
    routedHash = window.location.hash;
    const { name, params } = app.router.current();
    const id = params.id === undefined ? null : params.id;
    // Nothing has been shown yet: the page has just opened, so focus stays where it is.
    const isBoot = shownScreenName === null;
    hidePreviousScreen();
    activateSection(name);
    if (name !== shownScreenName || id !== shownId) {
      scrollToTop();
    }
    const screen = app.screens[name];
    if (screen && typeof screen.show === "function") {
      screen.show(params);
    }
    shownScreenName = name;
    shownId = id;
    updateNav(name);
    const section = sectionFor(name);
    const heading = headingOf(section);
    document.title = titleFor(heading);
    if (!isBoot) {
      focusHeading(section, heading);
    }
  }

  async function boot() {
    // The saved Auto / Dark / Light choice applies before any screen mounts. The inline script
    // in index.html's <head> already set data-theme for the first paint; this also points the
    // theme-color metas at the theme.
    const ui = app.ui;
    if (ui && typeof ui.applyTheme === "function" && typeof ui.getTheme === "function") {
      ui.applyTheme(ui.getTheme());
    }
    Object.keys(app.screens).forEach((name) => {
      const screen = app.screens[name];
      const root = sectionFor(name);
      if (root && typeof screen.mount === "function") {
        screen.mount(root);
      }
    });
    // Hash changes route only from here on, with every screen mounted. The nav shows while the
    // scripts load, and a tap then would reach a screen before its mount(); it only changes the
    // hash, which the route below shows.
    window.addEventListener("hashchange", route);
    // A first launch opens Onboarding, whatever the hash. Without a store there is no flag to
    // read, so nothing waits and nothing is gated.
    let onboarded = true;
    try {
      onboarded = app.store ? await app.store.getFlag(ONBOARDED_FLAG) : true;
    } catch {
      // IndexedDB is missing or blocked: open the app ungated rather than leave a blank page.
      onboarded = true;
    }
    if (!onboarded && window.location.hash !== ONBOARDING_HASH) {
      app.router.go(ONBOARDING_SCREEN);
    }
    route();
    // sw.js keeps the app files for offline opens. Without service workers, or when the browser
    // refuses the registration, the app runs exactly as before.
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
