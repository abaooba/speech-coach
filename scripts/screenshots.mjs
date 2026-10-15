// Headless Chrome over the DevTools Protocol, no npm packages: phone viewport at 2x, a forced
// color scheme per view, IndexedDB seeded once, one PNG per view. Needs a running backend.
//
//   .venv/bin/uvicorn backend.app:app --port 8766 &
//   .venv/bin/python scripts/screenshot_seed.py --out /tmp/seed.json
//   node scripts/screenshots.mjs --seed /tmp/seed.json --out docs/screenshots
//
// CHROME=/path/to/chrome overrides the default macOS location.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { VIEWS, seedExpression, resultsRoute } = require("./screenshot_views.js");

const args = Object.fromEntries(
  process.argv.slice(2).map((arg, i, all) => (arg.startsWith("--") ? [arg.slice(2), all[i + 1]] : [])).filter((p) => p.length),
);
const SEED = args.seed;
const OUT = args.out || "docs/screenshots";
const BASE = (args.base || "http://127.0.0.1:8766").replace(/\/$/, "") + "/";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;

if (!SEED || !existsSync(SEED)) {
  console.error("--seed <file> is required (scripts/screenshot_seed.py writes one)");
  process.exit(1);
}
if (!existsSync(CHROME)) {
  console.error("Chrome not found at " + CHROME + "; set CHROME=/path/to/chrome");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
// A fresh profile per run, so a re-run never doubles the seeded history.
const PROFILE = mkdtempSync(join(tmpdir(), "speech-coach-shots-"));

const chrome = spawn(
  CHROME,
  ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    "about:blank"],
  { stdio: "ignore" },
);
// Every exit path (errors, Ctrl-C, success) kills Chrome and deletes the profile.
process.on("exit", () => {
  chrome.kill();
  rmSync(PROFILE, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); // Chrome may still be flushing
});
process.on("SIGINT", () => process.exit(130));
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const stop = (code) => { chrome.kill(); process.exit(code); };

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === "page");
  } catch {}
}
if (!target) { console.error("Chrome did not open a debugging target"); stop(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
let nextId = 1;
const pending = new Map();
const errors = [];
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.text);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  }
});
const send = (method, params = {}) => new Promise((ok) => {
  const id = nextId++; pending.set(id, ok); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });

// Seed once, on the History route (any screen would do: the store is shared).
await send("Page.navigate", { url: BASE + "#/history" });
await sleep(1500);
const sessions = JSON.parse(readFileSync(SEED, "utf8"));
const lastId = await evaluate(seedExpression(sessions));

for (const view of VIEWS) {
  await send("Emulation.setDeviceMetricsOverride", { width: view.w, height: view.h, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: view.theme }] });
  // Onboarding shows only while the flag is unset: clear it for that view, set it back after.
  if (view.route === "/onboarding") await evaluate('app.store.setFlag("onboarded", false)');
  // The coach notes rotate past the entries already shown: forget them before each Results view,
  // so the light and dark captures pick the same notes (the server's order is seeded by take id).
  if (view.route === "@results") await evaluate('app.store.setFlag("coachNotesShown", [])');
  const hash = view.route === "@results" ? resultsRoute(lastId) : view.route;
  await send("Page.navigate", { url: BASE + "?v=" + Date.now() + "#" + hash });
  await sleep(1500);
  // A full-page capture would paint the fixed nav and the sticky action bar mid-image: hide both
  // for the capture only (the page reloads on the next view).
  if (view.full) await evaluate('document.head.appendChild(Object.assign(document.createElement("style"), { textContent: ".nav, .results__actions { display: none !important; }" }))');
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: Boolean(view.full) });
  writeFileSync(join(OUT, view.name + ".png"), Buffer.from(shot.result.data, "base64"));
  if (view.route === "/onboarding") await evaluate('app.store.setFlag("onboarded", true)');
  console.log("wrote " + join(OUT, view.name + ".png"));
}
if (errors.length) { console.error("console errors:\n" + errors.join("\n")); stop(1); }
ws.close();
stop(0);
