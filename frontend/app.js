/* app.js: creates the single `app` global and owns the hash router.
   Screens register as app.screens[name] = { mount(root), show(params), hide() };
   on DOMContentLoaded each registered screen is mounted once, then the hash is routed. */
(function () {
  "use strict";

  const SCREEN_NAMES = ["onboarding", "practice", "results", "history", "progress"];
  const DEFAULT_SCREEN = "practice";
  const ACTIVE_SCREEN_CLASS = "screen--active";
  const ACTIVE_NAV_CLASS = "nav__item--active";
  const PAGE_TITLE = "Speech Coach";

  const app = { screens: {}, router: {} };
  window.app = app;

  // Name of the screen whose show() ran last, so route() can call its hide().
  let shownScreenName = null;

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
    const activeHref = "#/" + name;
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

  function route() {
    const { name, params } = app.router.current();
    hidePreviousScreen();
    activateSection(name);
    const screen = app.screens[name];
    if (screen && typeof screen.show === "function") {
      screen.show(params);
    }
    shownScreenName = name;
    updateNav(name);
    document.title = PAGE_TITLE;
  }

  function boot() {
    Object.keys(app.screens).forEach((name) => {
      const screen = app.screens[name];
      const root = sectionFor(name);
      if (root && typeof screen.mount === "function") {
        screen.mount(root);
      }
    });
    route();
  }

  document.addEventListener("DOMContentLoaded", boot);
  window.addEventListener("hashchange", route);
})();
