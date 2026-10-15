// The README screenshots: which screens, at which size and theme, and the expression that seeds
// a fresh install so every screen has something to show. Pure: scripts/screenshots.mjs drives
// Chrome with it, frontend/tests/screenshot_views.test.js checks it.
"use strict";

const PHONE = { w: 375, h: 812 };
const SCREENS = [
  { name: "onboarding", route: "/onboarding" },
  { name: "practice", route: "/practice" },
  { name: "results", route: "@results" },
  { name: "history", route: "/history" },
  { name: "progress", route: "/progress" },
];

const VIEWS = [];
for (const theme of ["light", "dark"]) {
  for (const screen of SCREENS) {
    VIEWS.push({ name: screen.name + "-" + theme, route: screen.route, theme, ...PHONE });
  }
}

// Saves every session, newest last so Results opens the latest, and skips onboarding. Returns
// the id of the last saved session, which "@results" views open.
function seedExpression(sessions) {
  const json = JSON.stringify(sessions);
  return (
    "(async () => {" +
    " const sessions = " + json + ";" +
    " let last = null;" +
    " for (const s of sessions) { last = await app.store.save(s); }" +
    ' await app.store.setFlag("onboarded", true);' +
    " return last;" +
    "})()"
  );
}

function resultsRoute(id) {
  return "/results/" + id;
}

module.exports = { VIEWS, seedExpression, resultsRoute };
