# Submission Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deployed app, the repo and the screens match what a Congressional App Challenge judge scores: a live app that works with accounts and AI coach notes on, a privacy claim that is true, a repo whose first page shows screenshots, a license, green CI and an architecture page, and a Progress screen that never looks empty.

**Architecture:** Nothing new is built. The backend gains one best-effort DELETE call to AssemblyAI after each transcription and a deploy smoke script. The frontend gains one optional `preview` slot in `app.ui.renderState`, which Progress fills with an example trend, and a CSS brand mark on Onboarding. Everything else is configuration (render.yaml, env vars, CI workflow), documents (README, LICENSE, ARCHITECTURE.md, how.html) and screenshots produced by a Chrome DevTools Protocol script with no new dependencies.

**Tech Stack:** Python 3.13, FastAPI, httpx (`httpx.MockTransport` in tests), pytest with `--disable-socket`; vanilla ES2020 JavaScript tested with `node:test`, `node:assert/strict`, `vm` and `frontend/tests/fake-dom.js`; GitHub Actions; headless Google Chrome driven over its DevTools Protocol from Node (built-in `fetch` and `WebSocket`); Render (web service) and Neon (Postgres).

**Spec:** The owner's list of 2026-10-14 (this plan's "Scope" section below), with `CLAUDE.md`, `frontend/DESIGN.md` and docs/PLAN.md task T50 as the rules it is built under. There is no separate spec document.

## Scope

The owner asked for exactly these, on 2026-10-14, after a rubric review:

1. Accounts: ship them (Neon Postgres, `DATABASE_URL`, `SESSION_SECRET` on Render).
2. Turn on AI coach notes in production (`ANTHROPIC_API_KEY` on Render).
3. Finish docs/PLAN.md T50: render.yaml declares the three secrets as `sync: false`; README deploy section and how.html privacy lines updated.
4. Make the privacy claim true: the backend asks AssemblyAI to delete each transcript and its uploaded audio as soon as the words are back.
5. Add an architecture page.
6. Fix the repo's first impression: the five README screenshots that do not exist, no LICENSE, no CI.
7. Merge the `ui-cleanup` branch (one commit: the rank card as one bar).
8. Give Progress a richer empty state.
9. Think harder about the visuals, within the tests that pin the current design.

Explicitly out of scope: the AI disclosure (`docs/ai-disclosure.md`, README "AI disclosure"), because this is a mock run and not a real entry; the calendar (T45); any new feature; the sample take (`sample-session.json` is cache-first in the service worker and `CACHE_NAME` is pinned by three test files, so a changed sample would not reach installed phones).

## Global Constraints

- One task per session. Test first: write the failing test, watch it fail, make it pass. (CLAUDE.md)
- Run `.venv/bin/pytest -q`, `.venv/bin/ruff check .` and `node --test frontend/tests` before every commit. All three must pass. (CLAUDE.md)
- Never edit an existing test file. New test files are fine. Never skip, delete, weaken or mark tests as expected-fail. (CLAUDE.md) Every pinned fact named in a task below comes from an existing test; the task is written to keep it.
- Do not edit: docs/PLAN.md, docs/challenge-notes.md, CLAUDE.md, tasks/queue.json, anything under automation/ or .claude/. (CLAUDE.md)
- Never read or print .env. Never add API keys to code, logs or test output. (CLAUDE.md)
- Frontend: no frameworks, no build step, no CDN scripts. Vanilla only. No new frontend JS file: the script list is pinned by `backend/tests/test_frontend_shell.py`, `frontend/tests/account_screen.test.js`, `frontend/tests/design_shell_docs.test.js` and `backend/tests/test_pwa_files.py`, and `CACHE_NAME = "speech-coach-shell-v4"` is pinned by `frontend/tests/pwa.test.js`, `fix_screens_sw_fresh.test.js` and `account_screen.test.js`. (DESIGN.md section 2)
- Transcript and user text never go through `innerHTML`; build nodes with `app.ui.el`, SVG with `createElementNS`. (DESIGN.md section 2)
- Colors come from tokens only. `backend/tests/test_frontend_shell.py::test_hex_colors_only_in_the_token_block` fails on any hex literal in styles.css after the `/* end tokens */` line.
- Copy: second person, present tense, under 15 words a sentence, no exclamation marks, no blame. (DESIGN.md section 8) Fixed sentences listed in `backend/tests/test_frontend_copy.py` must appear exactly once across `api.js` and `screens/*.js`; the strings `state--` and `class="state` may appear only in ui.js.
- Audience: non-native speakers and anyone who wants to speak fluently. No debate words in anything a speaker reads (`frontend/tests/no_debate_words.test.js`). Screenshots and seed data follow the same rule.
- Python 3.13, type hints, ruff clean, line length 100. New JS lines also stay within 100 characters.
- Branching: all code goes on branch `submission-polish` off `main` (after Task 1 merges `ui-cleanup`). Commit small and often. Never push `main` except in Task 1 and Task 18, which the owner authorized ("merge the ui cleanup branch"; the final merge deploys to Render).
- Dates: video day Thu Oct 22, submit target Sat Oct 24, hard deadline Mon Oct 26, 2026 at noon EDT. Judging runs Oct 30 to Nov 23; the deploy must stay up and unchanged through it.

## Review Focus

The five inputs most likely to bite a real person that no feature test would naturally hit. Each has a test in the task that owns the code.

1. **AssemblyAI's delete call fails or hangs after a good transcription.** Expected: the speaker still gets the take; a warning is logged by status or error class, never with the transcript. Task 6 tests "a delete that answers 500 is logged without the words", "a delete that raises is logged by its class" and "the copy is discarded after transcribe whatever the answer", and the delete has its own 10 s timeout.
2. **The deploy's Postgres is set but unreachable at startup (Neon suspended).** Expected: guests are served, account routes answer until the database wakes. Already covered by `backend/tests/test_fix_robustness_database_url.py` and `lifespan()` in app.py; Task 4's smoke script reports "accounts: on" only on a 401 from `/api/me`, so a 503 after deploy is caught before the video.
3. **The Anthropic key is set but the hourly budget is spent during a demo.** Expected: coach notes fall back to library words with the "library" lead, no error. Already covered by `backend/tests/test_advice_budget.py`; Task 4's smoke script prints the `source` so a demo rehearsal sees which one it got.
4. **Progress with exactly one take, plus a rank card.** Expected: the card sits above the empty state, and the new preview sits inside the state block, last. Task 14 test "with one take the preview reads 1 of 2 and the block is still the body's last child" keeps `frontend/tests/rank_ui.test.js` ("rank-card", "state") true.
5. **A screenshot harness run on a machine without Chrome at the default path.** Expected: a one-line error naming the `CHROME` environment variable, exit code 1, no server left running. Task 10's `scripts/screenshots.mjs` checks the binary exists before spawning, and its pure module is unit-tested so the only untested code is the Chrome session itself.

---

## Phase 0: Owner setup (no code; do before Phase 2)

These are dashboard actions only the owner can take. Each later task says which one it needs.

- [ ] **0.1 Stop the cold start.** On 2026-10-14 the Render free instance went to sleep three times within an hour of testing and served Render's "Application loading" splash page in place of the app. Upgrade the `speech-coach` service to Render's Starter plan (Render dashboard, service, Settings, Instance Type). Fallback if the plan is declined: a free external pinger (for example UptimeRobot) hitting `https://speech-coach-xz8c.onrender.com/api/health` every 5 minutes through Nov 23. The Starter plan is the recommendation: a pinger can lapse, and the judging window is five weeks.
- [ ] **0.2 Create the Neon project.** neon.tech, New Project, name `speech-coach`, region closest to Render's Oregon (US West). Copy the pooled connection string; it starts `postgresql://` and ends `?sslmode=require`. `backend/db.py normalize_database_url` adds the psycopg driver, so paste it unchanged.
- [ ] **0.3 Make a session secret.** Run locally and copy the output:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

- [ ] **0.4 Get an Anthropic API key** at console.anthropic.com with a small monthly spend limit (the server caps itself at 300 coach-note calls an hour, `backend/advice/budget.py`).
- [ ] **0.5 Set the three variables on Render** (service, Environment): `DATABASE_URL`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`. Save; Render redeploys. Do this after Task 2 is merged so render.yaml and the dashboard agree, or before: the dashboard values win either way.
- [ ] **0.6 Google Chrome** must be installed at `/Applications/Google Chrome.app` for Task 11, or set `CHROME` to its path.

---

## Phase 1: Branch hygiene

### Task 1: Merge `ui-cleanup` into `main` and start the work branch

**Files:**
- No source edits. Git only.

**Interfaces:**
- Produces: branch `submission-polish` at `main`'s new head, which every later task builds on.

- [ ] **Step 1: Confirm the merge is a fast-forward and the suites are green on `ui-cleanup`**

```bash
cd /Users/arescajas/Projects/speech-coach
git fetch origin
git log --oneline main..ui-cleanup
git merge-base --is-ancestor main ui-cleanup && echo "fast-forward"
```

Expected: one commit, `e9618c8 Rank card: one bar, no ruler or wedge; headings the app focuses show no ring`, and the word `fast-forward`.

- [ ] **Step 2: Run the three checks on `ui-cleanup`**

```bash
git checkout ui-cleanup
.venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests
```

Expected: `1258 passed`, `All checks passed!`, `pass 1806` (counts as of 2026-10-14; any higher is fine, any failure stops here).

- [ ] **Step 3: Fast-forward `main`, push it (this deploys to Render), delete the branch**

```bash
git checkout main
git merge --ff-only ui-cleanup
git push origin main
git branch -d ui-cleanup
git push origin --delete ui-cleanup
```

- [ ] **Step 4: Create the work branch**

```bash
git checkout -b submission-polish
```

---

## Phase 2: Deploy truth (T50, accounts, AI coach notes)

### Task 2: render.yaml declares every secret the backend reads

**Files:**
- Modify: `render.yaml` (envVars block, after `DEEPGRAM_API_KEY`)
- Test: `backend/tests/test_render_blueprint.py` (new)

**Interfaces:**
- Produces: the five secret names, `SECRETS`, that Task 3's test reuses by copying the list (tests do not import each other).

- [ ] **Step 1: Write the failing test**

```python
"""render.yaml declares every secret the backend reads from the environment, none with a value.

docs/PLAN.md T50: DATABASE_URL, ANTHROPIC_API_KEY and SESSION_SECRET join the two speech-to-text
keys as `sync: false` entries, so Render asks for them in the dashboard and the repo never holds
one. The health check path is the one backend/app.py serves.
"""

import re
from pathlib import Path

RENDER_YAML = (Path(__file__).resolve().parents[2] / "render.yaml").read_text(encoding="utf-8")

# Every environment variable a deploy needs that is a secret: backend/providers/__init__.py,
# backend/app.py ANTHROPIC_API_KEY_VARIABLE, backend/db.py DATABASE_URL_VARIABLE and
# backend/auth.py SESSION_SECRET_VARIABLE.
SECRETS = [
    "ASSEMBLYAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "ANTHROPIC_API_KEY",
    "DATABASE_URL",
    "SESSION_SECRET",
]

# `- key: NAME` followed by its one setting line, as the Blueprint spec writes an envVar.
ENV_ENTRY = re.compile(r"- key: (\w+)\n\s+(\w+): (.+)")


def env_entries() -> dict[str, tuple[str, str]]:
    """{name: (setting, value)} for every envVars entry in render.yaml."""
    return {name: (setting, value) for name, setting, value in ENV_ENTRY.findall(RENDER_YAML)}


def test_every_secret_is_declared_and_never_synced_from_the_repo() -> None:
    entries = env_entries()
    for name in SECRETS:
        assert name in entries, f"render.yaml does not declare {name}"
        assert entries[name] == ("sync", "false"), f"{name} must be `sync: false`, got {entries[name]}"


def test_no_secret_carries_a_value() -> None:
    for name in SECRETS:
        assert not re.search(rf"- key: {name}\n\s+value:", RENDER_YAML), f"{name} has a value"


def test_provider_choice_and_python_version_stay_set() -> None:
    entries = env_entries()
    assert entries["STT_PROVIDER"] == ("value", "assemblyai")
    assert entries["PYTHON_VERSION"] == ("value", '"3.13.5"')


def test_health_check_path_matches_the_route() -> None:
    assert "healthCheckPath: /api/health" in RENDER_YAML
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_render_blueprint.py -q`
Expected: 1 failed (`render.yaml does not declare ANTHROPIC_API_KEY`), 3 passed.

- [ ] **Step 3: Add the three entries to render.yaml**

Replace the end of the `envVars` block so it reads:

```yaml
      - key: ASSEMBLYAI_API_KEY
        sync: false
      - key: DEEPGRAM_API_KEY
        sync: false
      # Coach notes written by Claude (backend/advice/coach.py). Unset: the library's own words.
      - key: ANTHROPIC_API_KEY
        sync: false
      # Optional accounts (backend/db.py, backend/auth.py). Unset: guests only, account routes 503.
      - key: DATABASE_URL
        sync: false
      - key: SESSION_SECRET
        sync: false
```

- [ ] **Step 4: Run the test and the three checks**

Run: `.venv/bin/pytest backend/tests/test_render_blueprint.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add render.yaml backend/tests/test_render_blueprint.py
git commit -m "Deploy: render.yaml declares ANTHROPIC_API_KEY, DATABASE_URL and SESSION_SECRET as unsynced secrets (T50)"
```

### Task 3: .env.example and the README deploy section name the same secrets

**Files:**
- Modify: `.env.example`
- Modify: `README.md` ("Deploy to Render" section, step 3; "Things to know" cold start bullet)
- Test: `backend/tests/test_env_example.py` (new)

**Interfaces:**
- Consumes: the `SECRETS` list from Task 2 (copied, not imported).

- [ ] **Step 1: Write the failing test**

```python
"""`.env.example` and the README's deploy steps name every secret render.yaml declares.

A developer copies .env.example to .env and fills it in; a deployer pastes the same names into
Render. Both lists are read here so neither can fall behind render.yaml (test_render_blueprint.py).
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_EXAMPLE = (ROOT / ".env.example").read_text(encoding="utf-8")
README = (ROOT / "README.md").read_text(encoding="utf-8")

SECRETS = [
    "ASSEMBLYAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "ANTHROPIC_API_KEY",
    "DATABASE_URL",
    "SESSION_SECRET",
]


def deploy_section() -> str:
    start = README.index("## Deploy to Render")
    end = README.index("### Install on a phone")
    return README[start:end]


def test_env_example_lists_every_secret_with_an_empty_value() -> None:
    for name in SECRETS:
        assert re.search(rf"^{name}=$", ENV_EXAMPLE, re.MULTILINE), f"{name}= missing or filled"


def test_env_example_holds_no_value_for_any_secret() -> None:
    for name in SECRETS:
        assert not re.search(rf"^{name}=.+$", ENV_EXAMPLE, re.MULTILINE), f"{name} has a value"


def test_readme_deploy_step_names_every_secret() -> None:
    section = deploy_section()
    for name in SECRETS:
        assert f"`{name}`" in section, f"the deploy section does not name {name}"


def test_readme_says_what_each_optional_secret_turns_on() -> None:
    section = deploy_section()
    assert "coach notes" in section.lower()
    assert "accounts" in section.lower()
    assert "Starter" in section, "the deploy section names the plan that stops the cold start"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_env_example.py -q`
Expected: 3 failed (env example missing names; README deploy step missing names and words), 1 passed.

- [ ] **Step 3: Update .env.example**

```
# Copy to .env and fill in. Never commit .env.
DEEPGRAM_API_KEY=
ASSEMBLYAI_API_KEY=
# Which provider the backend uses: deepgram or assemblyai
STT_PROVIDER=assemblyai
# Optional. Coach notes written by Claude; unset, Results shows the library's own words.
ANTHROPIC_API_KEY=
# Optional, both together. Accounts on Neon Postgres; unset, guests only and account routes 503.
# DATABASE_URL is the pooled Neon string (postgresql://...?sslmode=require).
# SESSION_SECRET: python3 -c "import secrets; print(secrets.token_urlsafe(32))"
DATABASE_URL=
SESSION_SECRET=
```

- [ ] **Step 4: Update README step 3 and the cold start bullet**

Replace step 3 of "Deploy to Render" with:

```markdown
3. Before you apply the Blueprint, Render asks for the secrets that
   `render.yaml` marks `sync: false`. Two are required: `ASSEMBLYAI_API_KEY`
   and `DEEPGRAM_API_KEY` (paste both; `STT_PROVIDER` is preset to
   `assemblyai`, switch it to `deepgram` under the service's **Environment**
   tab if you want the other provider). Three are optional and turn features
   on: `ANTHROPIC_API_KEY` makes Claude write the coach notes on Results
   (unset, the research library's own words stand in); `DATABASE_URL` (a
   Neon Postgres connection string) and `SESSION_SECRET` (32 random bytes,
   `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`) turn
   accounts on (unset, the app is guest-only and every account route answers
   503). Setting or changing `SESSION_SECRET` signs every account out.
```

Replace the "Cold start" bullet with:

```markdown
- **Cold start.** The free tier spins the service down after about fifteen
  minutes without traffic, and the first open after that shows Render's own
  "Application loading" page for up to a minute. For a demo or a judging
  window, move the service to Render's Starter plan, which never sleeps; a
  pinger hitting `/api/health` every five minutes is the fallback. Check a
  deploy with `.venv/bin/python scripts/smoke_deploy.py <url>` (see Tests).
```

- [ ] **Step 5: Run the test and the three checks**

Run: `.venv/bin/pytest backend/tests/test_env_example.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests`
Expected: all pass (`backend/tests/test_fix_docs_automation_readme.py` still passes: it reads the API and Stack sections, which do not change).

- [ ] **Step 6: Commit**

```bash
git add .env.example README.md backend/tests/test_env_example.py
git commit -m "Deploy docs: .env.example and the README name the optional coach-notes and account secrets, and the Starter plan for demos"
```

### Task 4: A smoke script that proves a deploy has accounts and AI notes on

**Files:**
- Create: `scripts/smoke_deploy.py`
- Test: `backend/tests/test_smoke_deploy.py` (new)
- Modify: `README.md` ("Tests" section: one paragraph after the lint command)

**Interfaces:**
- Produces: `scripts.smoke_deploy.run(base_url: str, client: httpx.Client) -> list[Check]`, `Check = (name: str, ok: bool, detail: str)`, and `main(argv) -> int`. Task 5 and Task 18 run `main` from the shell.
- Consumes: `POST /api/advice` body shape from `backend/advice/coach.py` (`AdviceRequest`: `session_id`, `summary`, `tier`, optional `shown_ids`; `TakeSummary`: `duration_seconds`, `words_per_minute`, `filler_count`, `restart_count`, `mid_sentence_pause_count`, `long_pause_count`, `target_wpm`, `transcript_excerpt`).

- [ ] **Step 1: Write the failing test**

```python
"""scripts/smoke_deploy.py reads a deploy's answers the way a demo rehearsal needs them.

Every request goes through httpx.MockTransport; pytest-socket blocks the network.
"""

import httpx

from scripts import smoke_deploy as smoke

BASE = "https://example.test"


def client_for(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def healthy_deploy(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path == "/api/health":
        return httpx.Response(200, json={"status": "ok"})
    if path == "/api/me":
        return httpx.Response(401, json={"detail": "not signed in"})
    if path == "/api/advice" and request.method == "POST":
        return httpx.Response(200, json={"tips": [{"entry_id": "filler-001"}], "source": "ai"})
    return httpx.Response(404)


def guest_only_deploy(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path == "/api/health":
        return httpx.Response(200, json={"status": "ok"})
    if path == "/api/me":
        return httpx.Response(503, json={"detail": "accounts are not configured"})
    if path == "/api/advice":
        return httpx.Response(200, json={"tips": [], "source": "library"})
    return httpx.Response(404)


def test_a_fully_configured_deploy_passes_every_check() -> None:
    checks = smoke.run(BASE, client_for(healthy_deploy))
    assert [name for name, _, _ in checks] == ["health", "accounts", "coach notes"]
    assert all(ok for _, ok, _ in checks), checks


def test_a_guest_only_deploy_fails_accounts_and_names_the_library_fallback() -> None:
    checks = dict((name, (ok, detail)) for name, ok, detail in smoke.run(BASE, client_for(guest_only_deploy)))
    assert checks["health"][0] is True
    assert checks["accounts"] == (False, "GET /api/me answered 503: accounts are off (DATABASE_URL unset?)")
    assert checks["coach notes"] == (
        False,
        "POST /api/advice answered with source 'library': no ANTHROPIC_API_KEY, or the hour's budget is spent",
    )


def test_a_sleeping_or_dead_host_fails_health_without_raising() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    checks = smoke.run(BASE, client_for(down))
    assert checks[0][0] == "health"
    assert checks[0][1] is False
    assert "ConnectError" in checks[0][2]


def test_the_advice_body_is_a_valid_request() -> None:
    from backend.advice.coach import AdviceRequest

    AdviceRequest.model_validate(smoke.ADVICE_BODY)


def test_main_exit_code_follows_the_checks(capsys) -> None:
    assert smoke.main([BASE], client_for(healthy_deploy)) == 0
    assert smoke.main([BASE], client_for(guest_only_deploy)) == 1
    out = capsys.readouterr().out
    assert "PASS health" in out
    assert "FAIL accounts" in out
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_smoke_deploy.py -q`
Expected: 5 errors, `ModuleNotFoundError: No module named 'scripts.smoke_deploy'`.

- [ ] **Step 3: Write the script**

```python
"""Check a deploy answers as the demo needs: health, accounts on, coach notes written by Claude.

Manual and online, like check_advice_links.py: the owner runs it by hand after setting the
Render environment, and before a demo. The tests run it against fake servers.

Usage: .venv/bin/python scripts/smoke_deploy.py https://speech-coach-xz8c.onrender.com

Three checks, each PASS or FAIL with one line of detail, exit code 1 when any fails:
  health       GET /api/health answers 200 {"status": "ok"}
  accounts     GET /api/me answers 401 (accounts on, nobody signed in); 503 means DATABASE_URL
               is unset or unusable
  coach notes  POST /api/advice answers 200 with source "ai"; "library" means no
               ANTHROPIC_API_KEY, or the hour's budget of AI calls is spent
"""

import argparse
import sys
from collections.abc import Sequence

import httpx

Check = tuple[str, bool, str]

# A cold start on Render's free plan can take a minute before the first byte.
TIMEOUT_SECONDS = 90.0

# A valid POST /api/advice body (backend/advice/coach.py AdviceRequest): an everyday take.
ADVICE_BODY = {
    "session_id": "00000000-0000-4000-8000-00000000c0de",
    "tier": "Novice",
    "summary": {
        "duration_seconds": 60,
        "words_per_minute": 150,
        "filler_count": 6,
        "restart_count": 1,
        "mid_sentence_pause_count": 2,
        "long_pause_count": 0,
        "target_wpm": [140, 160],
        "transcript_excerpt": "Today I want to explain how I plan my week, um, so I start on Sunday.",
    },
}


def run(base_url: str, client: httpx.Client) -> list[Check]:
    """The three checks against `base_url`, in order; a request that raises fails its check."""
    base = base_url.rstrip("/")
    return [check_health(base, client), check_accounts(base, client), check_coach_notes(base, client)]


def check_health(base: str, client: httpx.Client) -> Check:
    try:
        reply = client.get(f"{base}/api/health", timeout=TIMEOUT_SECONDS)
    except httpx.HTTPError as error:
        return ("health", False, f"GET /api/health failed: {type(error).__name__}")
    ok = reply.status_code == 200 and reply.json().get("status") == "ok"
    return ("health", ok, f"GET /api/health answered {reply.status_code}")


def check_accounts(base: str, client: httpx.Client) -> Check:
    try:
        reply = client.get(f"{base}/api/me", timeout=TIMEOUT_SECONDS)
    except httpx.HTTPError as error:
        return ("accounts", False, f"GET /api/me failed: {type(error).__name__}")
    if reply.status_code == 401:
        return ("accounts", True, "GET /api/me answered 401: accounts are on, nobody signed in")
    if reply.status_code == 503:
        return ("accounts", False, "GET /api/me answered 503: accounts are off (DATABASE_URL unset?)")
    return ("accounts", False, f"GET /api/me answered {reply.status_code}")


def check_coach_notes(base: str, client: httpx.Client) -> Check:
    try:
        reply = client.post(f"{base}/api/advice", json=ADVICE_BODY, timeout=TIMEOUT_SECONDS)
    except httpx.HTTPError as error:
        return ("coach notes", False, f"POST /api/advice failed: {type(error).__name__}")
    if reply.status_code != 200:
        return ("coach notes", False, f"POST /api/advice answered {reply.status_code}")
    source = reply.json().get("source")
    if source == "ai":
        return ("coach notes", True, "POST /api/advice answered with source 'ai': Claude wrote the notes")
    return (
        "coach notes",
        False,
        f"POST /api/advice answered with source '{source}': no ANTHROPIC_API_KEY, "
        "or the hour's budget is spent",
    )


def main(argv: Sequence[str] | None = None, client: httpx.Client | None = None) -> int:
    parser = argparse.ArgumentParser(description="Smoke-check a Speech Coach deploy.")
    parser.add_argument("base_url", help="https://speech-coach-xz8c.onrender.com")
    args = parser.parse_args(argv)
    checks = run(args.base_url, client or httpx.Client())
    for name, ok, detail in checks:
        print(f"{'PASS' if ok else 'FAIL'} {name}: {detail}")
    return 0 if all(ok for _, ok, _ in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Add the README paragraph** under "Tests", after the lint code block:

```markdown
Check a deploy before a demo (this one reaches the network, so pytest never runs it):

```bash
.venv/bin/python scripts/smoke_deploy.py https://speech-coach-xz8c.onrender.com
```

It prints PASS or FAIL for health, accounts (`/api/me` answers 401 when
`DATABASE_URL` is set) and coach notes (`/api/advice` says Claude wrote them
when `ANTHROPIC_API_KEY` is set and the hourly budget lasts).
```

- [ ] **Step 5: Run the test and the three checks**

Run: `.venv/bin/pytest backend/tests/test_smoke_deploy.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests`
Expected: all pass. If ruff flags a line over 100 characters in the test's `checks = dict(...)` line, break it after `for name, ok, detail in`.

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke_deploy.py backend/tests/test_smoke_deploy.py README.md
git commit -m "scripts/smoke_deploy.py: PASS or FAIL for health, accounts on and Claude-written coach notes on a deploy"
```

### Task 5: Owner turns the features on and proves it

**Files:** none. Render dashboard and one shell command.

- [ ] **Step 1: Phase 0 items 0.1 to 0.5 are done.** Render shows the three new variables and a finished deploy.
- [ ] **Step 2: Run the smoke script against the live URL**

```bash
.venv/bin/python scripts/smoke_deploy.py https://speech-coach-xz8c.onrender.com
```

Expected, three lines:

```
PASS health: GET /api/health answered 200
PASS accounts: GET /api/me answered 401: accounts are on, nobody signed in
PASS coach notes: POST /api/advice answered with source 'ai': Claude wrote the notes
```

If `accounts` fails with 503: the Render log says `DATABASE_URL cannot be used (<ErrorClass>)`; the usual cause is a pasted string with a trailing space or a missing `?sslmode=require`. If `coach notes` says `library`: the key is unset, has a space, or the console shows no credit.

- [ ] **Step 3: Sign up on a phone, record one take, sign in on the laptop, see the same take in History.** Then delete the account from the Account screen and confirm Neon's Tables view shows no row for that email.

---

## Phase 3: Privacy truth

### Task 6: The take's copy at AssemblyAI is deleted as soon as the words are back

**Files:**
- Modify: `backend/providers/assemblyai.py` (imports, constants, `transcribe` keeps the id, new `delete_last_transcript`)
- Modify: `backend/app.py` (`analyze()` calls the new `discard_provider_copy` after `transcribe`)
- Test: `backend/tests/test_assemblyai_delete.py` (new)
- Test: `backend/tests/test_analyze_discards_copy.py` (new)

**Interfaces:**
- Produces: `AssemblyAIProvider.last_transcript_id: str | None` (set by `transcribe`, one provider per request since `get_provider()` builds a new one each call) and `AssemblyAIProvider.delete_last_transcript() -> None` (best effort `DELETE {BASE_URL}/transcript/{id}`, `DELETE_TIMEOUT_SECONDS = 10.0`). `backend.app.discard_provider_copy(provider) -> None` calls `delete_last_transcript` when the provider has one; a provider without it (Deepgram, the tests' `FakeTranscriber`) is left alone.
- Why not inside `transcribe`: `backend/tests/test_providers.py::test_assemblyai_uploads_audio_then_requests_disfluencies_then_polls` reads the fake's full request list as `upload, create, *polls` and asserts three polls; a DELETE recorded there would make it four, and existing tests cannot change. The delete is therefore a second call that `/api/analyze` makes, and `transcribe` sends exactly what it sends today.

- [ ] **Step 1: Write the failing provider test**

```python
"""After transcribe, delete_last_transcript asks AssemblyAI to delete the transcript, and the
uploaded audio with it (AssemblyAI's docs: a DELETE on /v2/transcript/{id} removes both). Best
effort: a failed delete is logged by its status or error class and never raises. All HTTP goes
through httpx.MockTransport."""

import json
import logging
from pathlib import Path

import httpx
import pytest

from backend.providers.assemblyai import (
    BASE_URL,
    DELETE_TIMEOUT_SECONDS,
    AssemblyAIProvider,
)
from backend.providers.base import ProviderError

FIXTURES = Path(__file__).parent / "fixtures"
COMPLETED = json.loads((FIXTURES / "assemblyai_transcript_completed.json").read_text())
AUDIO = b"fake-audio-bytes"
LOGGER = "backend.providers.assemblyai"


class AssemblyAIWithDelete:
    """Scripted server: upload, create, one poll that completes, then DELETE with a chosen reply."""

    def __init__(self, delete_reply: httpx.Response | Exception) -> None:
        self.delete_reply = delete_reply
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if request.method == "POST" and path == "/v2/upload":
            return httpx.Response(200, json={"upload_url": COMPLETED["audio_url"]})
        if request.method == "POST" and path == "/v2/transcript":
            return httpx.Response(200, json={"id": COMPLETED["id"], "status": "queued"})
        if request.method == "GET" and path == f"/v2/transcript/{COMPLETED['id']}":
            return httpx.Response(200, json=COMPLETED)
        if request.method == "DELETE" and path == f"/v2/transcript/{COMPLETED['id']}":
            if isinstance(self.delete_reply, Exception):
                raise self.delete_reply
            return self.delete_reply
        return httpx.Response(404, json={"error": f"unexpected {request.method} {path}"})


def provider_for(fake: AssemblyAIWithDelete, client: httpx.Client | None = None) -> AssemblyAIProvider:
    client = client or httpx.Client(transport=httpx.MockTransport(fake))
    return AssemblyAIProvider(api_key="test-key", client=client, sleep=lambda _: None)


def test_transcribe_sends_nothing_new_and_remembers_the_transcript_id() -> None:
    fake = AssemblyAIWithDelete(httpx.Response(200, json={"status": "deleted"}))
    provider = provider_for(fake)

    words = provider.transcribe(AUDIO, "audio/webm")

    assert len(words) == 8
    assert [r.method for r in fake.requests] == ["POST", "POST", "GET"]
    assert provider.last_transcript_id == COMPLETED["id"]


def test_delete_last_transcript_sends_one_authorized_delete() -> None:
    fake = AssemblyAIWithDelete(httpx.Response(200, json={"status": "deleted"}))
    provider = provider_for(fake)
    provider.transcribe(AUDIO, "audio/webm")

    provider.delete_last_transcript()

    delete = fake.requests[-1]
    assert (delete.method, delete.url.path) == ("DELETE", f"/v2/transcript/{COMPLETED['id']}")
    assert delete.headers["authorization"] == "test-key"
    assert str(delete.url).startswith(BASE_URL)
    assert provider.last_transcript_id is None, "deleted once, never twice"


def test_a_delete_that_answers_500_is_logged_without_the_words(
    caplog: pytest.LogCaptureFixture,
) -> None:
    fake = AssemblyAIWithDelete(httpx.Response(500, text="server error Hey um"))
    provider = provider_for(fake)
    provider.transcribe(AUDIO, "audio/webm")

    with caplog.at_level(logging.WARNING, logger=LOGGER):
        provider.delete_last_transcript()

    assert "AssemblyAI delete returned HTTP 500" in caplog.text
    assert "Hey" not in caplog.text


def test_a_delete_that_raises_is_logged_by_its_class(caplog: pytest.LogCaptureFixture) -> None:
    fake = AssemblyAIWithDelete(httpx.ConnectTimeout("slow"))
    provider = provider_for(fake)
    provider.transcribe(AUDIO, "audio/webm")

    with caplog.at_level(logging.WARNING, logger=LOGGER):
        provider.delete_last_transcript()

    assert "AssemblyAI delete failed (ConnectTimeout)" in caplog.text


def test_the_delete_has_its_own_short_timeout() -> None:
    fake = AssemblyAIWithDelete(httpx.Response(200, json={"status": "deleted"}))
    seen: list[object] = []

    class Spy(httpx.Client):
        def delete(self, *args, **kwargs):  # noqa: ANN002, ANN003
            seen.append(kwargs.get("timeout"))
            return super().delete(*args, **kwargs)

    provider = provider_for(fake, Spy(transport=httpx.MockTransport(fake)))
    provider.transcribe(AUDIO, "audio/webm")
    provider.delete_last_transcript()

    assert seen == [DELETE_TIMEOUT_SECONDS]
    assert DELETE_TIMEOUT_SECONDS <= 10.0


def test_nothing_is_sent_when_there_is_no_transcript_to_delete() -> None:
    fake = AssemblyAIWithDelete(httpx.Response(200, json={"status": "deleted"}))
    provider = provider_for(fake)

    provider.delete_last_transcript()

    assert fake.requests == []


def test_a_failed_job_leaves_no_id_to_delete() -> None:
    def failing(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v2/upload":
            return httpx.Response(200, json={"upload_url": "https://cdn/fake"})
        if request.method == "POST":
            return httpx.Response(200, json={"id": "t1", "status": "queued"})
        return httpx.Response(200, json={"id": "t1", "status": "error", "error": "bad audio"})

    client = httpx.Client(transport=httpx.MockTransport(failing))
    provider = AssemblyAIProvider(api_key="k", client=client, sleep=lambda _: None)

    with pytest.raises(ProviderError, match="bad audio"):
        provider.transcribe(AUDIO, "audio/webm")
    assert provider.last_transcript_id is None
```

- [ ] **Step 2: Write the failing API test**

```python
"""/api/analyze asks the provider to discard its copy of the take once the words are in hand,
whether the take is then accepted or refused as too short, and leaves a provider that keeps no
copy alone."""

import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend.providers.base import Word

LONG_ENOUGH = [Word("Hey", 0.5, 0.8), Word("there", 1.0, 1.4), Word("everyone", 5.2, 6.0)]
TOO_SHORT = [Word("Hey", 0.5, 0.8)]


class KeepsACopy:
    """A provider shaped like AssemblyAIProvider: words, then a copy to discard."""

    def __init__(self, words: list[Word]) -> None:
        self.words = words
        self.calls: list[str] = []
        self.last_transcript_id = "t1"

    def transcribe(self, audio_bytes: bytes, content_type: str) -> list[Word]:
        self.calls.append("transcribe")
        return self.words

    def delete_last_transcript(self) -> None:
        self.calls.append("delete")
        self.last_transcript_id = None


class KeepsNoCopy:
    def __init__(self, words: list[Word]) -> None:
        self.words = words
        self.calls: list[str] = []

    def transcribe(self, audio_bytes: bytes, content_type: str) -> list[Word]:
        self.calls.append("transcribe")
        return self.words


def post(client: TestClient) -> object:
    return client.post("/api/analyze", files={"audio": ("take.webm", b"fake-audio", "audio/webm")})


@pytest.mark.parametrize("words, status", [(LONG_ENOUGH, 200), (TOO_SHORT, 400)])
def test_the_copy_is_discarded_after_transcribe_whatever_the_answer(
    monkeypatch: pytest.MonkeyPatch, words: list[Word], status: int
) -> None:
    provider = KeepsACopy(words)
    monkeypatch.setattr(app_module, "get_provider", lambda: provider)

    reply = post(TestClient(app_module.app))

    assert reply.status_code == status
    assert provider.calls == ["transcribe", "delete"]


def test_a_provider_without_a_copy_is_left_alone(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = KeepsNoCopy(LONG_ENOUGH)
    monkeypatch.setattr(app_module, "get_provider", lambda: provider)

    reply = post(TestClient(app_module.app))

    assert reply.status_code == 200
    assert provider.calls == ["transcribe"]


def test_discard_provider_copy_is_a_plain_function_on_the_provider() -> None:
    provider = KeepsACopy(LONG_ENOUGH)
    app_module.discard_provider_copy(provider)
    assert provider.calls == ["delete"]
    app_module.discard_provider_copy(KeepsNoCopy(LONG_ENOUGH))
```

- [ ] **Step 3: Run both to verify they fail**

Run: `.venv/bin/pytest backend/tests/test_assemblyai_delete.py backend/tests/test_analyze_discards_copy.py -q`
Expected: `ImportError: cannot import name 'DELETE_TIMEOUT_SECONDS'`, and `AttributeError: module 'backend.app' has no attribute 'discard_provider_copy'`.

- [ ] **Step 4: Change the provider**

In `backend/providers/assemblyai.py`:

Module docstring, add a third paragraph:

```python
"""AssemblyAI provider: upload the clip, create a transcript job, poll until it completes.

AssemblyAI reports word times in milliseconds; this module converts them to seconds. The whole
exchange, from the upload to the finished transcript, is held to TRANSCRIBE_DEADLINE_SECONDS.

transcribe() keeps the transcript's id, and delete_last_transcript() then asks AssemblyAI to
delete it (DELETE /v2/transcript/{id}), which its docs say removes the uploaded audio with it.
/api/analyze calls the second right after the first. It is best effort: the take is already in
hand, so a failure is logged and never costs the speaker the take.
"""
```

Imports: add `import logging` after `import time`, and `logger = logging.getLogger(__name__)` after the imports. Constants, after `TRANSCRIBE_DEADLINE_SECONDS`:

```python
# The delete runs once the words are in hand and has its own short limit: a slow delete must not
# hold the speaker's answer, and a transcript that outlives it expires under the account's
# retention setting in AssemblyAI's dashboard.
DELETE_TIMEOUT_SECONDS = 10.0
```

In `__init__`, after `self._clock = clock`:

```python
        # The id of the transcript the last transcribe() read, until delete_last_transcript()
        # deletes it. get_provider() builds one provider per request, so no two takes share it.
        self.last_transcript_id: str | None = None
```

`transcribe`, replace the last four lines of the body:

```python
        completed = self._wait_for_completion(transcript_id, deadline)
        with reading_reply("AssemblyAI poll"):
            words = [to_word(w) for w in completed["words"]]
        self.last_transcript_id = transcript_id
        return words
```

and its docstring gains, at the end: `On success the transcript's id is kept in last_transcript_id for delete_last_transcript().`

New method, after `_wait_for_completion`:

```python
    def delete_last_transcript(self) -> None:
        """Ask AssemblyAI to delete the last transcript read, and with it the audio uploaded for it.

        Nothing is sent when no transcript was read, or it was deleted already. Best effort: a
        failure is logged by its status code or error class alone, because the reply and the
        error can hold the speaker's words, and the log must not.
        """
        transcript_id = self.last_transcript_id
        if transcript_id is None:
            return
        self.last_transcript_id = None
        try:
            response = self._client.delete(
                f"{BASE_URL}/transcript/{transcript_id}",
                headers=self._headers,
                timeout=DELETE_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as error:
            logger.warning(
                "AssemblyAI delete failed (%s); the transcript stays until it expires",
                type(error).__name__,
            )
            return
        if not response.is_success:
            logger.warning(
                "AssemblyAI delete returned HTTP %d; the transcript stays until it expires",
                response.status_code,
            )
```

- [ ] **Step 5: Change `/api/analyze`**

In `backend/app.py`, after the `try`/`except` that calls `provider.transcribe` and before the `MIN_RECORDING_SECONDS` check:

```python
    # The provider's copy is deleted the moment the words are here, before the take is judged:
    # a take refused as too short has a copy to delete too. Off the event loop, as the upload was.
    await run_in_threadpool(discard_provider_copy, provider)
```

New function, after `speech_end_seconds`:

```python
def discard_provider_copy(provider: object) -> None:
    """Ask the provider to delete its copy of the take, when it keeps one.

    AssemblyAI keeps the transcript and the uploaded audio until asked (its provider's
    delete_last_transcript); Deepgram keeps nothing this code can delete. A provider without the
    method, the tests' fakes included, is left alone. The call never raises: the provider logs
    its own failures, and the take is already in hand.
    """
    delete = getattr(provider, "delete_last_transcript", None)
    if callable(delete):
        delete()
```

Update the `analyze` docstring's privacy sentence: `The audio bytes are held in memory for this request only and handed straight to the speech-to-text provider; nothing is written by this code, and the provider is asked to delete its copy as soon as the words are back (discard_provider_copy).`

- [ ] **Step 6: Run the two new tests, then the three checks**

Run: `.venv/bin/pytest backend/tests/test_assemblyai_delete.py backend/tests/test_analyze_discards_copy.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests`
Expected: all pass. `backend/tests/test_providers.py` is untouched and green: `transcribe` sends the same three kinds of request it did. `backend/tests/test_api.py`'s `FakeTranscriber` has no `delete_last_transcript`, so `discard_provider_copy` leaves it alone.

- [ ] **Step 7: Commit**

```bash
git add backend/providers/assemblyai.py backend/app.py backend/tests/test_assemblyai_delete.py backend/tests/test_analyze_discards_copy.py
git commit -m "AssemblyAI: /api/analyze deletes the transcript and its uploaded audio once the words are back, best effort"
```

### Task 7: The privacy copy says what now happens

**Files:**
- Modify: `README.md` ("How it works" step 3; "Privacy" third bullet)
- Modify: `frontend/how.html` (new unnumbered section after section 8, before "The Path")
- Test: `frontend/tests/how_audio_section.test.js` (new)
- Test: `backend/tests/test_privacy_copy.py` (new)

**Interfaces:**
- Consumes: the delete behaviour from Task 6.

Pinned facts kept: `frontend/tests/coach_notes_docs.test.js` requires the numbered `<h2>` list to be exactly 1 to 8 (the new section is unnumbered) and keeps every sentence of section 7 as it is; `frontend/tests/onboarding.test.js:130` pins the onboarding privacy line word for word, and that line ("Audio is deleted right after analysis.") is now true, so it does not change.

- [ ] **Step 1: Write the failing frontend test**

```js
// how.html has a "Your audio" section that says the recording is deleted at AssemblyAI as soon
// as the words are back, in sentences a phone can read (under 15 words, no exclamation).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HOW = fs.readFileSync(path.join(__dirname, "..", "how.html"), "utf8");
const MAX_SENTENCE_WORDS = 15;

function audioSection() {
  const start = HOW.indexOf("<h2>Your audio</h2>");
  assert.notEqual(start, -1, "how.html has a Your audio section");
  const end = HOW.indexOf("</section>", start);
  return HOW.slice(start, end)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

test("how.html's Your audio section says the recording is deleted at AssemblyAI", () => {
  const text = audioSection();
  [
    "Your recording goes to AssemblyAI once, to be turned into words.",
    "As soon as the words are back, the app asks AssemblyAI to delete the recording.",
    "The app never keeps audio of its own.",
  ].forEach((sentence) => assert.ok(text.includes(sentence), sentence));
});

test("the Your audio section comes after rule 8 and before The Path", () => {
  const rule8 = HOW.indexOf("<h2>8. ");
  const audio = HOW.indexOf("<h2>Your audio</h2>");
  const thePath = HOW.indexOf("<h2>The Path</h2>");
  assert.ok(rule8 < audio && audio < thePath);
});

test("every sentence of the Your audio section is under 15 words, with no exclamation", () => {
  const text = audioSection();
  assert.ok(!text.includes("!"));
  text
    .split(/(?<=[.?])\s+/)
    .filter((sentence) => sentence.trim() !== "")
    .forEach((sentence) => {
      const words = sentence.trim().split(" ").length;
      assert.ok(words < MAX_SENTENCE_WORDS, words + " words: " + sentence);
    });
});
```

- [ ] **Step 2: Write the failing backend test**

```python
"""The README's privacy bullets say what the backend does with audio after Task 6."""

from pathlib import Path

README = (Path(__file__).resolve().parents[2] / "README.md").read_text(encoding="utf-8")


def privacy_section() -> str:
    start = README.index("## Privacy")
    end = README.index("## AI disclosure")
    return README[start:end]


def test_privacy_section_says_assemblyai_is_asked_to_delete() -> None:
    section = privacy_section()
    assert "`DELETE /v2/transcript/{id}`" in section
    assert "asks AssemblyAI to delete" in section
    assert "Deepgram" in section, "the other provider's retention is still named"


def test_how_it_works_step_three_names_the_delete() -> None:
    start = README.index("## How it works")
    end = README.index("### API")
    assert "asks AssemblyAI to delete" in README[start:end]
```

- [ ] **Step 3: Run both to verify they fail**

Run: `node --test frontend/tests/how_audio_section.test.js; .venv/bin/pytest backend/tests/test_privacy_copy.py -q`
Expected: the node test fails at "how.html has a Your audio section"; both pytest tests fail.

- [ ] **Step 4: Add the how.html section** after the `</section>` that closes "8. What these numbers cannot tell you":

```html
    <section class="how__section">
      <h2>Your audio</h2>
      <p>Your recording goes to AssemblyAI once, to be turned into words.
        As soon as the words are back, the app asks AssemblyAI to delete the recording.
        The app never keeps audio of its own.</p>
      <p>During a Path level, take 1 stays in this phone’s memory for replay.
        It is deleted when the level ends.</p>
    </section>
```

- [ ] **Step 5: Update the README**

"How it works" step 3 becomes:

```markdown
3. The backend computes the metrics from the word timestamps and returns
   them with the transcript. Audio is discarded after analysis, and the
   backend asks AssemblyAI to delete its copy as soon as the words are back;
   during a Path level the browser keeps take 1 in memory for replay until
   the level ends (see Privacy below for exactly what that means).
```

The third Privacy bullet becomes:

```markdown
- The audio is forwarded once to the speech-to-text provider you configure.
  With AssemblyAI, the default, the backend asks AssemblyAI to delete the
  transcript and the uploaded audio as soon as the words are back
  (`DELETE /v2/transcript/{id}`, which AssemblyAI documents as removing both).
  A failed delete is logged by its status alone, and the copy then expires
  under the retention setting in the AssemblyAI dashboard. With Deepgram the
  audio is subject to Deepgram's retention policy.
```

- [ ] **Step 6: Run the two new tests and the three checks**

Run: `node --test frontend/tests/how_audio_section.test.js && .venv/bin/pytest backend/tests/test_privacy_copy.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests`
Expected: all pass. `frontend/tests/how_page.test.js` and `coach_notes_docs.test.js` stay green (numbered headings unchanged).

- [ ] **Step 7: Commit**

```bash
git add frontend/how.html README.md frontend/tests/how_audio_section.test.js backend/tests/test_privacy_copy.py
git commit -m "Privacy copy: the recording is deleted at AssemblyAI once the words are back (how.html, README)"
```

---

## Phase 4: The repo's first impression

### Task 8: LICENSE

**Files:**
- Create: `LICENSE`
- Modify: `README.md` (new last section "## License")
- Test: `backend/tests/test_license.py` (new)

- [ ] **Step 1: Write the failing test**

```python
"""The repo carries an MIT license naming the author, and the README points to it."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_license_is_mit_and_names_the_author() -> None:
    text = (ROOT / "LICENSE").read_text(encoding="utf-8")
    assert text.startswith("MIT License")
    assert "Copyright (c) 2026 Ares Cajas" in text
    assert "THE SOFTWARE IS PROVIDED \"AS IS\"" in text


def test_readme_has_a_license_section() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "## License" in readme
    assert "[MIT](LICENSE)" in readme
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_license.py -q`
Expected: `FileNotFoundError` on LICENSE.

- [ ] **Step 3: Create LICENSE** with the standard MIT text:

```
MIT License

Copyright (c) 2026 Ares Cajas

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Append to README.md**

```markdown

## License

[MIT](LICENSE). The research library in `backend/advice/library.json` quotes
and cites published sources; each entry names its author and link.
```

- [ ] **Step 5: Run the test and the three checks; commit**

```bash
.venv/bin/pytest backend/tests/test_license.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests
git add LICENSE README.md backend/tests/test_license.py
git commit -m "MIT license, named in the README"
```

### Task 9: GitHub Actions CI runs the same three checks, and the README shows the badge

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md` (badge on the line under the title)
- Test: `backend/tests/test_ci_workflow.py` (new)

- [ ] **Step 1: Write the failing test**

```python
"""CI runs exactly the three checks CLAUDE.md asks for before every commit, on the versions the
repo targets, and the README shows its badge."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
BADGE = "https://github.com/abaooba/speech-coach/actions/workflows/ci.yml/badge.svg"


def test_workflow_runs_ruff_pytest_and_the_node_tests() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    for command in ("ruff check .", "pytest -q", "node --test frontend/tests"):
        assert f"run: {command}" in text, command


def test_workflow_installs_both_requirement_files() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "pip install -r requirements.txt -r requirements-dev.txt" in text


def test_workflow_pins_python_313() -> None:
    assert 'python-version: "3.13"' in WORKFLOW.read_text(encoding="utf-8")


def test_workflow_runs_on_pushes_to_main_and_pull_requests() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "pull_request:" in text
    assert "branches: [main]" in text


def test_readme_shows_the_ci_badge_near_the_top() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert BADGE in readme
    assert readme.index(BADGE) < readme.index("## Screenshots")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_ci_workflow.py -q`
Expected: `FileNotFoundError` on ci.yml.

- [ ] **Step 3: Create the workflow**

```yaml
# The three checks CLAUDE.md asks for before every commit, on every push to main and every PR.
# pytest also runs the node tests through backend/tests/test_frontend_node.py, so the last step
# repeats them only to show their own count in the log.
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
      - uses: actions/setup-node@v4
        with:
          node-version: "26"
      - run: pip install -r requirements.txt -r requirements-dev.txt
      - run: ruff check .
      - run: pytest -q
      - run: node --test frontend/tests
```

- [ ] **Step 4: Add the badge to the README**, as the first line after `# Speech Coach (working title)`:

```markdown
[![CI](https://github.com/abaooba/speech-coach/actions/workflows/ci.yml/badge.svg)](https://github.com/abaooba/speech-coach/actions/workflows/ci.yml)
Live app: <https://speech-coach-xz8c.onrender.com>
```

- [ ] **Step 5: Run the test and the three checks; commit**

```bash
.venv/bin/pytest backend/tests/test_ci_workflow.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests
git add .github/workflows/ci.yml README.md backend/tests/test_ci_workflow.py
git commit -m "CI: ruff, pytest and the node tests on every push to main and every PR; badge and live link in the README"
```

The workflow runs for the first time when the PR opens (Task 18). If `setup-node` cannot resolve "26" on that day, change it to "24" in a follow-up commit; `node --test` with a directory argument works on both.

### Task 10: Screenshot tooling with no new dependencies

**Files:**
- Create: `scripts/screenshot_seed.py` (builds the seed history from fixtures, or from audio through a running backend)
- Create: `scripts/screenshot_views.js` (pure: the view list and the seed expression)
- Create: `scripts/screenshots.mjs` (drives headless Chrome over the DevTools Protocol)
- Test: `backend/tests/test_screenshot_seed.py` (new)
- Test: `frontend/tests/screenshot_views.test.js` (new)

**Interfaces:**
- Produces: `scripts.screenshot_seed.sessions_from_fixtures() -> list[dict]` (each a session `app.store.save` accepts: `createdAt`, `passageId`, `passageTitle`, `durationSeconds`, `metrics`, `transcript`, `topic`), `sessions_from_audio(paths, base_url, client) -> list[dict]`, `main(argv) -> int` writing JSON to `--out`. `scripts/screenshot_views.js` exports `VIEWS` (array of `{name, route, theme, w, h}`), `seedExpression(sessions)` (a JS source string) and `resultsRoute(id)`. `scripts/screenshots.mjs` reads `--seed <json> --out <dir> --base <url>`.
- Consumes: `backend.metrics.analyze(words)`, `backend.providers.assemblyai.to_word`, fixture `backend/tests/fixtures/take_2026_10_11_nervous.json` (`words` in AssemblyAI shape) and `frontend/sample-session.json`.

Why these two seed takes: the fixture is the owner's real everyday take of 2026-10-11 with a cut-off restart ("ner— I'm kinda nervous"), and the sample's words are an everyday explanation with fillers, so the seeded Results shows a restart, fillers and the headline, and Progress has its two sessions. `take_2026_10_11_uniforms.json` is a debate rebuttal and is never used (audience rule). The README caption says the history is seeded.

- [ ] **Step 1: Write the failing backend test**

```python
"""scripts/screenshot_seed.py turns real fixture takes into sessions the browser store accepts.

The optional audio path posts to a running backend; here it goes through MockTransport.
"""

import json
from datetime import datetime
from pathlib import Path

import httpx

from scripts import screenshot_seed as seed

SESSION_FIELDS = {
    "createdAt",
    "passageId",
    "passageTitle",
    "durationSeconds",
    "metrics",
    "transcript",
    "topic",
}


def test_fixture_sessions_have_the_store_fields_and_real_timings() -> None:
    sessions = seed.sessions_from_fixtures()
    assert len(sessions) == 2
    for session in sessions:
        assert set(session) == SESSION_FIELDS
        datetime.fromisoformat(session["createdAt"].replace("Z", "+00:00"))
        assert session["durationSeconds"] > 20
        assert session["transcript"][0].keys() == {"text", "start", "end"}
        assert "words_per_minute" in session["metrics"]
    assert sessions[0]["createdAt"] < sessions[1]["createdAt"]


def test_the_real_take_keeps_its_restart() -> None:
    nervous = next(s for s in seed.sessions_from_fixtures() if s["passageId"] == "free-talk")
    assert nervous["metrics"]["repeats"], "the 2026-10-11 take restarts 'I'm kinda nervous'"


def test_no_seed_title_is_a_sample_or_names_debate() -> None:
    for session in seed.sessions_from_fixtures():
        assert not session["passageTitle"].startswith("Sample: ")
        text = json.dumps(session).lower()
        for word in ("debate", "rebuttal", "resolution", "judge"):
            assert word not in text, word


def test_sessions_from_audio_posts_each_file_and_reads_the_answer(tmp_path: Path) -> None:
    clip = tmp_path / "take.webm"
    clip.write_bytes(b"fake-audio")
    posted: list[httpx.Request] = []

    def backend(request: httpx.Request) -> httpx.Response:
        posted.append(request)
        return httpx.Response(
            200,
            json={
                "transcript": [{"text": "Hello", "start": 0.5, "end": 0.9}],
                "metrics": {"words_per_minute": 120, "duration": 30, "repeats": [], "pauses": []},
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(backend))
    sessions = seed.sessions_from_audio([clip], "http://127.0.0.1:8766", client)

    assert len(posted) == 1
    assert posted[0].url.path == "/api/analyze"
    assert sessions[0]["durationSeconds"] == 30
    assert set(sessions[0]) == SESSION_FIELDS


def test_main_writes_the_json_file(tmp_path: Path) -> None:
    out = tmp_path / "seed.json"
    assert seed.main(["--out", str(out)]) == 0
    assert len(json.loads(out.read_text())) == 2
```

- [ ] **Step 2: Write the failing frontend test**

```js
// scripts/screenshot_views.js: the README's screens in both themes, and the expression that
// seeds a fresh install's IndexedDB with the given sessions and skips onboarding.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const views = require(path.join(__dirname, "..", "..", "scripts", "screenshot_views.js"));

const README_SCREENS = ["onboarding", "practice", "results", "history", "progress"];

test("VIEWS covers the five README screens in light and dark at phone size", () => {
  for (const screen of README_SCREENS) {
    for (const theme of ["light", "dark"]) {
      const view = views.VIEWS.find((v) => v.name === screen + "-" + theme);
      assert.ok(view, screen + "-" + theme);
      assert.equal(view.theme, theme);
      assert.equal(view.w, 375);
      assert.equal(view.h, 812);
    }
  }
});

test("every view routes to a hash the app knows, or to @results for the seeded take", () => {
  const known = ["/onboarding", "/practice", "/history", "/progress", "@results"];
  for (const view of views.VIEWS) {
    assert.ok(known.includes(view.route), view.name + " -> " + view.route);
  }
});

test("seedExpression saves each session through app.store and sets the onboarded flag", () => {
  const source = views.seedExpression([{ passageId: "free-talk", transcript: [] }]);
  assert.match(source, /app\.store\.save\(/);
  assert.match(source, /app\.store\.setFlag\("onboarded", true\)/);
  assert.ok(source.includes('"passageId":"free-talk"'));
  assert.ok(!source.includes("innerHTML"));
});

test("resultsRoute builds the Results hash for a saved id", () => {
  assert.equal(views.resultsRoute("abc"), "/results/abc");
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `.venv/bin/pytest backend/tests/test_screenshot_seed.py -q; node --test frontend/tests/screenshot_views.test.js`
Expected: `ModuleNotFoundError` and `Cannot find module`.

- [ ] **Step 4: Write `scripts/screenshot_seed.py`**

```python
"""Build the seed history the README screenshots are taken with.

Two real takes: the owner's 2026-10-11 everyday take from backend/tests/fixtures (its words from
AssemblyAI, with a cut-off restart) and the bundled sample's words and timings, each scored by
backend.metrics.analyze as /api/analyze scores a take. Dated three days apart, so Progress has
its two sessions and a trend. With --analyze, each audio file is posted to a running backend
instead (needs a provider key in .env and the network; pytest never does this).

Usage:
  .venv/bin/python scripts/screenshot_seed.py --out /tmp/seed.json
  .venv/bin/python scripts/screenshot_seed.py --out /tmp/seed.json \
      --analyze samples/take1.m4a samples/take2.m4a --base http://127.0.0.1:8766
"""

import argparse
import json
import sys
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

import httpx

from backend import metrics
from backend.providers.assemblyai import to_word
from backend.providers.base import Word

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "backend" / "tests" / "fixtures"
SAMPLE = ROOT / "frontend" / "sample-session.json"

# The 2026-10-11 take and the sample, three days apart, newest last.
NERVOUS_AT = "2026-10-08T22:15:00.000Z"
EXPLAIN_AT = "2026-10-11T19:07:00.000Z"
ANALYZE_TIMEOUT_SECONDS = 180.0


def sessions_from_fixtures() -> list[dict]:
    """The two seed sessions, oldest first."""
    nervous = json.loads((FIXTURES / "take_2026_10_11_nervous.json").read_text(encoding="utf-8"))
    words = [to_word(raw) for raw in nervous["words"]]
    sample = json.loads(SAMPLE.read_text(encoding="utf-8"))
    sample_words = [Word(**entry) for entry in sample["transcript"]]
    return [
        session(NERVOUS_AT, "free-talk", "Your day", words, metrics.analyze(words), topic=None),
        session(
            EXPLAIN_AT,
            sample["passageId"],
            "Explain something",
            sample_words,
            metrics.analyze(sample_words),
            topic=None,
        ),
    ]


def session(
    created_at: str,
    passage_id: str,
    title: str,
    words: Sequence[Word],
    take_metrics: dict,
    topic: str | None,
) -> dict:
    """One session in the shape frontend/store.js save() accepts (no id: the store assigns one)."""
    return {
        "createdAt": created_at,
        "passageId": passage_id,
        "passageTitle": title,
        "durationSeconds": round(words[-1].end, 1) if words else 0,
        "metrics": take_metrics,
        "transcript": [asdict(word) for word in words],
        "topic": topic,
    }


def sessions_from_audio(paths: Sequence[Path], base_url: str, client: httpx.Client) -> list[dict]:
    """Post each audio file to a running backend and keep its answer as a session."""
    sessions = []
    for index, path in enumerate(paths):
        with path.open("rb") as audio:
            reply = client.post(
                f"{base_url.rstrip('/')}/api/analyze",
                files={"audio": (path.name, audio, "application/octet-stream")},
                timeout=ANALYZE_TIMEOUT_SECONDS,
            )
        reply.raise_for_status()
        answer = reply.json()
        words = [Word(**entry) for entry in answer["transcript"]]
        created_at = f"2026-10-{5 + 2 * index:02d}T18:00:00.000Z"
        sessions.append(
            {
                **session(created_at, "free-talk", "Your day", words, answer["metrics"], None),
                "durationSeconds": answer["metrics"].get("duration", 0),
            }
        )
    return sessions


def main(argv: Sequence[str] | None = None, client: httpx.Client | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write the screenshot seed history as JSON.")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--analyze", nargs="*", type=Path, default=[])
    parser.add_argument("--base", default="http://127.0.0.1:8766")
    args = parser.parse_args(argv)
    sessions = sessions_from_fixtures()
    if args.analyze:
        sessions += sessions_from_audio(args.analyze, args.base, client or httpx.Client())
    args.out.write_text(json.dumps(sessions, indent=1), encoding="utf-8")
    print(f"{len(sessions)} sessions written to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

If `test_the_real_take_keeps_its_restart` fails because `metrics.analyze` reports the cut-off as a `script`-less restart under another key, open `backend/metrics.py analyze()` and assert on the key it uses for repeats or restarts (`repeats` is the key the README's API section documents; `backend/tests/test_metrics_restarts.py` names it). Do not weaken the assertion to an empty check.

- [ ] **Step 5: Write `scripts/screenshot_views.js`**

```js
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
```

- [ ] **Step 6: Write `scripts/screenshots.mjs`**

```js
// Headless Chrome over the DevTools Protocol, no npm packages: phone viewport at 2x, a forced
// color scheme per view, IndexedDB seeded once, one PNG per view. Needs a running backend.
//
//   .venv/bin/uvicorn backend.app:app --port 8766 &
//   .venv/bin/python scripts/screenshot_seed.py --out /tmp/seed.json
//   node scripts/screenshots.mjs --seed /tmp/seed.json --out docs/screenshots
//
// CHROME=/path/to/chrome overrides the default macOS location.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
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
const PROFILE = join(OUT, ".chrome-profile");

if (!SEED || !existsSync(SEED)) {
  console.error("--seed <file> is required (scripts/screenshot_seed.py writes one)");
  process.exit(1);
}
if (!existsSync(CHROME)) {
  console.error("Chrome not found at " + CHROME + "; set CHROME=/path/to/chrome");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const chrome = spawn(
  CHROME,
  ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    "about:blank"],
  { stdio: "ignore" },
);
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
  const hash = view.route === "@results" ? resultsRoute(lastId) : view.route;
  await send("Page.navigate", { url: BASE + "?v=" + Date.now() + "#" + hash });
  await sleep(1500);
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(join(OUT, view.name + ".png"), Buffer.from(shot.result.data, "base64"));
  if (view.route === "/onboarding") await evaluate('app.store.setFlag("onboarded", true)');
  console.log("wrote " + join(OUT, view.name + ".png"));
}
if (errors.length) { console.error("console errors:\n" + errors.join("\n")); stop(1); }
ws.close();
stop(0);
```

- [ ] **Step 7: Run both new tests and the three checks**

Run: `.venv/bin/pytest backend/tests/test_screenshot_seed.py -q && node --test frontend/tests/screenshot_views.test.js && .venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests`
Expected: all pass. If `backend/tests/test_frontend_shell.py` or `test_frontend_copy.py` scans `scripts/*.js` for globals or copy (they scan `frontend/`), nothing changes; if `.gitignore` needs `docs/screenshots/.chrome-profile/`, add that line.

- [ ] **Step 8: Commit**

```bash
git add scripts/screenshot_seed.py scripts/screenshot_views.js scripts/screenshots.mjs backend/tests/test_screenshot_seed.py frontend/tests/screenshot_views.test.js .gitignore
git commit -m "Screenshot tooling: seed two real takes, drive headless Chrome over CDP, no new dependencies"
```

### Task 11: Real screenshots in the README

**Files:**
- Create: `docs/screenshots/*.png` (ten files from Task 10)
- Modify: `README.md` ("Screenshots" section; a two-sentence pitch under the live link)
- Test: `backend/tests/test_readme_screenshots.py` (new)

Needs Phase 0 item 0.6 (Chrome).

- [ ] **Step 1: Write the failing test**

```python
"""Every screenshot the README shows exists, is a PNG at phone width, and is small enough to
load on GitHub without a wait. The README says the history is seeded."""

import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
README = (ROOT / "README.md").read_text(encoding="utf-8")
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MAX_BYTES = 600_000
PHONE_WIDTH_AT_2X = 750


def referenced_images() -> list[Path]:
    return [ROOT / path for path in re.findall(r"!\[[^\]]*\]\((docs/screenshots/[^)]+)\)", README)]


def png_width(data: bytes) -> int:
    return struct.unpack(">I", data[16:20])[0]


def test_readme_references_the_five_screens_in_both_themes() -> None:
    names = sorted(path.name for path in referenced_images())
    assert names == sorted(
        f"{screen}-{theme}.png"
        for screen in ("onboarding", "practice", "results", "history", "progress")
        for theme in ("light", "dark")
    )


def test_every_referenced_screenshot_exists_as_a_small_phone_png() -> None:
    for path in referenced_images():
        assert path.is_file(), f"{path} is missing"
        data = path.read_bytes()
        assert data.startswith(PNG_MAGIC), f"{path} is not a PNG"
        assert len(data) <= MAX_BYTES, f"{path} is {len(data)} bytes"
        assert png_width(data) == PHONE_WIDTH_AT_2X, f"{path} is {png_width(data)} px wide"


def test_readme_says_the_history_is_seeded() -> None:
    start = README.index("## Screenshots")
    end = README.index("## How it works")
    assert "seeded" in README[start:end]
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_readme_screenshots.py -q`
Expected: the first test fails (five light names only, none exist).

- [ ] **Step 3: Produce the screenshots**

```bash
.venv/bin/uvicorn backend.app:app --port 8766 > /dev/null 2>&1 &
sleep 2
.venv/bin/python scripts/screenshot_seed.py --out /tmp/speech-coach-seed.json
node scripts/screenshots.mjs --seed /tmp/speech-coach-seed.json --out docs/screenshots
kill %1
ls -la docs/screenshots
```

Expected: ten PNG files, each 100 to 400 KB, and no "console errors" line. Open `docs/screenshots/results-light.png`: the Results screen shows the headline, the rank card, the metric cards, the timeline with a restart or filler marks, the transcript with highlighted words and coach notes. If Results shows "Session not found", the seed's last id was not returned; check `seedExpression` returns `last` and that `app.store.save` resolves to the id (DESIGN.md section 2: `save(session) -> Promise<id>`).

If any PNG is over 600 KB, run `sips -s format png --resampleWidth 750 <file> --out <file>` (macOS, lossless resample at the same width is a no-op) and, if still large, reduce `deviceScaleFactor` for that run to 1.5 and set `PHONE_WIDTH_AT_2X` thinking aside: the test pins 750, so keep 2x and instead shorten the seed transcript. In practice a 375 x 812 2x PNG of this UI is about 150 KB.

- [ ] **Step 4: Rewrite the README "Screenshots" section**

```markdown
## Screenshots

Phone width, light and dark. The history is seeded with two real takes
(`scripts/screenshot_seed.py`), so Results and Progress have something to show.

| Light | Dark |
| --- | --- |
| ![Practice screen](docs/screenshots/practice-light.png) | ![Practice screen, dark](docs/screenshots/practice-dark.png) |
| ![Results screen](docs/screenshots/results-light.png) | ![Results screen, dark](docs/screenshots/results-dark.png) |
| ![Progress screen](docs/screenshots/progress-light.png) | ![Progress screen, dark](docs/screenshots/progress-dark.png) |
| ![History screen](docs/screenshots/history-light.png) | ![History screen, dark](docs/screenshots/history-dark.png) |
| ![Onboarding screen](docs/screenshots/onboarding-light.png) | ![Onboarding screen, dark](docs/screenshots/onboarding-dark.png) |

- Practice, the home screen: pick a timed topic or a passage, tap Record, and Stop uploads
  the take.
- Results: a two-sentence headline, your rank, four metric cards, a speech timeline, the
  transcript with fillers and restarts marked, and two or three cited coach notes.
- Progress: one metric charted across your takes, with your latest, your best and your change
  from the average, under your rank and streak.
- History: every take, newest first, with its pace, fillers per minute and a status word.
- Onboarding, shown on first launch: what is measured and what happens to your audio.
```

And under the live-app line added in Task 9, add the pitch:

```markdown
Talk for a minute, get your pace, your pauses, your fillers and your restarts
back in seconds, with coach notes that cite the research they come from.
Then climb a practice path built from that research.
```

- [ ] **Step 5: Run the test and the three checks; commit**

```bash
.venv/bin/pytest backend/tests/test_readme_screenshots.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests
git add docs/screenshots/*.png README.md backend/tests/test_readme_screenshots.py
git commit -m "README: ten real screenshots, light and dark, from a seeded history; a two-sentence pitch"
```

Do not commit `docs/screenshots/.chrome-profile/` (Task 10 added it to .gitignore).

---

## Phase 5: Architecture page

### Task 12: docs/ARCHITECTURE.md with a diagram, pinned to the code

**Files:**
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/architecture.svg`
- Modify: `README.md` ("How it works": one line linking the page)
- Test: `backend/tests/test_architecture_doc.py` (new)

- [ ] **Step 1: Write the failing test**

```python
"""docs/ARCHITECTURE.md names every module that exists and no module that does not, its diagram
is well-formed SVG, and the README links it."""

import re
import xml.etree.ElementTree as ElementTree
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "docs" / "ARCHITECTURE.md"
SVG = ROOT / "docs" / "architecture.svg"
README = (ROOT / "README.md").read_text(encoding="utf-8")


def modules_section() -> str:
    text = DOC.read_text(encoding="utf-8")
    start = text.index("## Modules")
    end = text.index("## ", start + 3)
    return text[start:end]


def listed_paths() -> list[str]:
    return re.findall(r"^\| `([^`]+)` \|", modules_section(), re.MULTILINE)


def test_every_listed_module_exists() -> None:
    missing = [path for path in listed_paths() if not (ROOT / path).exists()]
    assert missing == [], missing


def test_every_backend_module_and_frontend_script_is_listed() -> None:
    listed = set(listed_paths())
    backend = {f"backend/{p.name}" for p in (ROOT / "backend").glob("*.py") if p.name != "__init__.py"}
    frontend = {f"frontend/{p.name}" for p in (ROOT / "frontend").glob("*.js") if p.name != "sw.js"}
    screens = {f"frontend/screens/{p.name}" for p in (ROOT / "frontend" / "screens").glob("*.js")}
    expected = backend | frontend | screens | {"backend/providers/", "backend/advice/", "frontend/sw.js"}
    assert expected <= listed, sorted(expected - listed)


def test_the_diagram_is_well_formed_svg_naming_the_four_parties() -> None:
    root = ElementTree.fromstring(SVG.read_bytes())
    assert root.tag.endswith("svg")
    text = " ".join(t.text or "" for t in root.iter() if t.text)
    for party in ("Phone", "FastAPI", "AssemblyAI", "Anthropic", "Neon"):
        assert party in text, party


def test_the_doc_embeds_the_diagram_and_the_readme_links_the_doc() -> None:
    assert "![Architecture](architecture.svg)" in DOC.read_text(encoding="utf-8")
    assert "[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)" in README
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest backend/tests/test_architecture_doc.py -q`
Expected: `FileNotFoundError` on ARCHITECTURE.md.

- [ ] **Step 3: Draw `docs/architecture.svg`** (hand-written, 960 x 460, plain hex colors are fine here: the token rule covers styles.css only):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 460" width="960" height="460" font-family="-apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="14">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#5B6270"/>
    </marker>
  </defs>
  <rect width="960" height="460" fill="#FFFFFF"/>

  <!-- Phone -->
  <rect x="24" y="40" width="280" height="380" rx="12" fill="#F4F5F7" stroke="#D9DDE3"/>
  <text x="40" y="68" font-size="18" font-weight="700" fill="#111318">Phone (PWA, vanilla JS)</text>
  <rect x="40" y="88" width="248" height="52" rx="8" fill="#FFFFFF" stroke="#D9DDE3"/>
  <text x="52" y="110" fill="#111318">MediaRecorder records the take</text>
  <text x="52" y="128" fill="#5B6270">screens/practice.js</text>
  <rect x="40" y="152" width="248" height="52" rx="8" fill="#FFFFFF" stroke="#D9DDE3"/>
  <text x="52" y="174" fill="#111318">Web Audio finds pauses locally</text>
  <text x="52" y="192" fill="#5B6270">pauses.js (human-owned)</text>
  <rect x="40" y="216" width="248" height="52" rx="8" fill="#FFFFFF" stroke="#D9DDE3"/>
  <text x="52" y="238" fill="#111318">Delivery rules, rank, Loop Path</text>
  <text x="52" y="256" fill="#5B6270">delivery.js, rank.js, path.js, loop.js</text>
  <rect x="40" y="280" width="248" height="52" rx="8" fill="#FFFFFF" stroke="#D9DDE3"/>
  <text x="52" y="302" fill="#111318">IndexedDB keeps every take</text>
  <text x="52" y="320" fill="#5B6270">store.js (guests need no server)</text>
  <rect x="40" y="344" width="248" height="52" rx="8" fill="#FFFFFF" stroke="#D9DDE3"/>
  <text x="52" y="366" fill="#111318">Service worker caches the shell</text>
  <text x="52" y="384" fill="#5B6270">sw.js (never audio, never /api)</text>

  <!-- FastAPI -->
  <rect x="360" y="40" width="280" height="380" rx="12" fill="#E3ECFA" stroke="#2457F5"/>
  <text x="376" y="68" font-size="18" font-weight="700" fill="#111318">FastAPI backend (Render)</text>
  <rect x="376" y="88" width="248" height="52" rx="8" fill="#FFFFFF" stroke="#D9DDE3"/>
  <text x="388" y="110" fill="#111318">POST /api/analyze</text>
  <text x="388" y="128" fill="#5B6270">app.py, metrics.py, script_align.py</text>
  <rect x="376" y="152" width="248" height="52" rx="8" fill="#FFFFFF" stroke="#D9DDE3"/>
  <text x="388" y="174" fill="#111318">POST /api/advice (coach notes)</text>
  <text x="388" y="192" fill="#5B6270">advice/select.py, advice/coach.py</text>
  <rect x="376" y="216" width="248" height="52" rx="8" fill="#FFFFFF" stroke="#D9DDE3"/>
  <text x="388" y="238" fill="#111318">/api/auth, /api/sessions, /api/progress</text>
  <text x="388" y="256" fill="#5B6270">auth.py, sessions_api.py, db.py</text>
  <rect x="376" y="280" width="248" height="52" rx="8" fill="#FFFFFF" stroke="#D9DDE3"/>
  <text x="388" y="302" fill="#111318">Research library, 632 cited entries</text>
  <text x="388" y="320" fill="#5B6270">advice/library.json</text>
  <rect x="376" y="344" width="248" height="52" rx="8" fill="#FFFFFF" stroke="#D9DDE3"/>
  <text x="388" y="366" fill="#111318">Audio lives in memory for one request</text>
  <text x="388" y="384" fill="#5B6270">limits.py caps bodies at 40 MB</text>

  <!-- Services -->
  <rect x="696" y="40" width="240" height="100" rx="12" fill="#F4F5F7" stroke="#D9DDE3"/>
  <text x="712" y="68" font-size="16" font-weight="700" fill="#111318">AssemblyAI</text>
  <text x="712" y="92" fill="#111318">Speech to text, fillers kept</text>
  <text x="712" y="112" fill="#5B6270">deleted once the words are back</text>
  <rect x="696" y="180" width="240" height="100" rx="12" fill="#F4F5F7" stroke="#D9DDE3"/>
  <text x="712" y="208" font-size="16" font-weight="700" fill="#111318">Anthropic (Claude Haiku)</text>
  <text x="712" y="232" fill="#111318">Rewrites 2 to 3 library tips</text>
  <text x="712" y="252" fill="#5B6270">numbers + 1,500 chars of transcript</text>
  <rect x="696" y="320" width="240" height="100" rx="12" fill="#F4F5F7" stroke="#D9DDE3"/>
  <text x="712" y="348" font-size="16" font-weight="700" fill="#111318">Neon Postgres (optional)</text>
  <text x="712" y="372" fill="#111318">Accounts sync the same takes</text>
  <text x="712" y="392" fill="#5B6270">reports and transcripts, never audio</text>

  <!-- Arrows -->
  <line x1="304" y1="114" x2="376" y2="114" stroke="#5B6270" stroke-width="2" marker-end="url(#arrow)"/>
  <text x="312" y="104" font-size="12" fill="#5B6270">audio</text>
  <line x1="376" y1="130" x2="304" y2="130" stroke="#5B6270" stroke-width="2" marker-end="url(#arrow)"/>
  <text x="312" y="148" font-size="12" fill="#5B6270">words + metrics</text>
  <line x1="624" y1="100" x2="696" y2="100" stroke="#5B6270" stroke-width="2" marker-end="url(#arrow)"/>
  <line x1="624" y1="180" x2="696" y2="226" stroke="#5B6270" stroke-width="2" marker-end="url(#arrow)"/>
  <line x1="624" y1="244" x2="696" y2="366" stroke="#5B6270" stroke-width="2" marker-end="url(#arrow)"/>
  <line x1="304" y1="178" x2="376" y2="178" stroke="#5B6270" stroke-width="2" marker-end="url(#arrow)"/>
  <text x="312" y="168" font-size="12" fill="#5B6270">numbers</text>
  <line x1="304" y1="242" x2="376" y2="242" stroke="#5B6270" stroke-width="2" marker-end="url(#arrow)"/>
  <text x="312" y="232" font-size="12" fill="#5B6270">cookie</text>
</svg>
```

- [ ] **Step 4: Write `docs/ARCHITECTURE.md`**

```markdown
# Architecture

Speech Coach is a phone-first web app with a small Python backend. The phone
records, finds pauses, scores the take by rules it can explain, keeps every
take in its own database and draws the progress chart. The backend does the
two things a phone cannot: turn audio into timed words through a speech-to-text
provider, and ask Claude to rewrite research-library tips for one take. Accounts
are optional and only sync what the phone already has.

![Architecture](architecture.svg)

## How a take becomes a score

1. Practice records with `MediaRecorder` and, in parallel, `pauses.js` reads
   loudness from the Web Audio API to find silences over 1.5 seconds.
2. Stop posts the audio (and the script, on the Read tab) to `POST /api/analyze`.
3. The backend forwards the audio once to AssemblyAI with `disfluencies: true`,
   so "um" and "uh" come back as words with timestamps, then asks AssemblyAI
   to delete the transcript and the audio (`providers/assemblyai.py`).
4. `metrics.py` computes words per minute, fillers, pauses and repeated phrases
   from the word times. With a script, `script_align.py` lines the words up
   against it and reports restarts, skips and misreads. Both are pure functions.
5. The browser saves words and metrics in IndexedDB (`store.js`) and
   `delivery.js` re-scores every stored take by today's rules, so old takes
   never go stale when a rule changes.
6. Results asks `POST /api/advice` for coach notes: `advice/select.py` picks
   library entries for the take's weakest skills, `advice/coach.py` has Claude
   Haiku rewrite two or three of them in the take's numbers, and the app, not
   the model, attaches each citation. Without a key, the library's own words
   stand in.
7. `rank.js` turns the last ten takes into a rating and a tier; `path.js`
   turns the weakest skill into the next Loop Path level.

## Modules

| Path | Owns |
| --- | --- |
| `backend/app.py` | FastAPI app: `/api/analyze`, `/api/advice`, `/api/health`, static files, cache headers, body limits |
| `backend/metrics.py` | Pure metrics from timed words: pace, fillers, pauses, repeated phrases |
| `backend/script_align.py` | Lines a take up against its script: restarts, skipped and misread words |
| `backend/providers/` | `base.py` (the `Transcriber` protocol and `Word`), `assemblyai.py`, `deepgram.py` |
| `backend/advice/` | The research library (`library.json`, `__init__.py`), `select.py` (which entries fit a take), `coach.py` (Claude writes the notes), `budget.py` (300 AI calls an hour) |
| `backend/auth.py` | Optional accounts: Argon2 passwords, HttpOnly session cookies, rate-limited logins |
| `backend/sessions_api.py` | A signed-in speaker's takes, shown advice and Path progress |
| `backend/db.py` | SQLAlchemy Core tables; Neon Postgres in production, SQLite in tests; off without `DATABASE_URL` |
| `backend/limits.py` | Request body caps (40 MB audio) answered with 413 before the body is read |
| `backend/nul_free.py` | Refuses NUL bytes in any text a route stores |
| `frontend/app.js` | The `app` namespace, hash router, boot |
| `frontend/ui.js` | DOM helpers, state blocks, icons, theme |
| `frontend/api.js` | `app.api.analyze` with a 180 s deadline and typed errors |
| `frontend/store.js` | IndexedDB sessions, flags and Path progress; write-through to the server when signed in |
| `frontend/auth.js` | Sign up, log in, log out, delete account |
| `frontend/passages.js` | Talk prompts, Read passages, cold reads, the benchmark |
| `frontend/delivery.js` | Filler rules, pause classes, clean stretch, restarts: the delivery report |
| `frontend/pauses.js` | Browser-side pause detection with Web Audio (human-owned) |
| `frontend/rank.js` | Take scores, the rating and the seven tiers (owner-written) |
| `frontend/rankcard.js` | The rank card on Progress and Results |
| `frontend/path.js` | The Loop Path: units, levels, rules, check-backs, crowns, the benchmark |
| `frontend/loop.js` | The Level screen's pure helpers: steps, feedback, moments, tap matching |
| `frontend/tips.js` | Rule-based tips and the coach-notes request |
| `frontend/sw.js` | Service worker: caches the app shell, never audio, never `/api` |
| `frontend/screens/practice.js` | Record, upload, level mode, the sample |
| `frontend/screens/results.js` | Headline, rank card, metric cards, timeline, transcript, coach notes |
| `frontend/screens/history.js` | Every take, newest first, with delete |
| `frontend/screens/progress.js` | One metric charted across takes; the rank card and streak |
| `frontend/screens/path.js` | The winding Path with its units and nodes |
| `frontend/screens/level.js` | One Loop Path level: goal, take 1, review, take 2, result |
| `frontend/screens/account.js` | Sign up, log in, import guest history, delete |
| `frontend/screens/onboarding.js` | First launch: what is measured, what happens to audio |

## Where data lives

| Data | Where | How long |
| --- | --- | --- |
| Audio | Phone memory while recording; backend memory for one request; AssemblyAI until the words are back | Seconds. Take 1 of a Path level stays in phone memory until the level ends |
| Words and metrics | IndexedDB on the phone; Postgres too when signed in | Until the speaker deletes the take or the account |
| Transcript excerpt (1,500 characters) and the take's numbers | Sent to Anthropic for coach notes | Anthropic's retention policy |
| Email and Argon2 password hash | Postgres | Until the account is deleted |

## Why these choices

- **Rules, not a model, do the counting.** Every number on Results can be
  explained on a whiteboard (`how.html`), and the same rules re-score old takes.
- **AssemblyAI over Deepgram.** On a 30 s clip with heavy fillers, AssemblyAI
  kept 6 um and 3 uh and a restart; Deepgram kept 1 and 2 (`scripts/compare_providers.py`).
- **No framework, no build.** The app is 20 files a judge can read top to
  bottom. The service worker makes it installable and offline for the shell.
- **Guests first.** Everything works with no account. Accounts add sync and
  nothing else, so they could be cut without touching a screen.
- **The model writes prose, never facts.** Claude rewrites library entries in
  the take's numbers; the app attaches every citation from the entry itself.

## Tests

`backend/tests/` (pytest, network blocked by `pytest-socket`, providers behind
`httpx.MockTransport`, SQLite in memory for accounts) and `frontend/tests/`
(`node:test` with a hand-written fake DOM in `fake-dom.js`; modules run inside
`vm` contexts). CI runs both on every push and PR.
```

- [ ] **Step 5: Link it from the README** at the end of "How it works", before "### API":

```markdown
The longer version, with a diagram and every module's job, is
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
```

- [ ] **Step 6: Run the test and the three checks; commit**

```bash
.venv/bin/pytest backend/tests/test_architecture_doc.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests
git add docs/ARCHITECTURE.md docs/architecture.svg README.md backend/tests/test_architecture_doc.py
git commit -m "docs/ARCHITECTURE.md: the request flow, every module's job, where data lives, why these choices"
```

If `test_every_backend_module_and_frontend_script_is_listed` names a file this table missed, add a row for it with its real job (read its header comment); never drop the assertion.

---

## Phase 6: Progress empty state and the visuals

### Task 13: `app.ui.renderState` gains an optional preview slot

**Files:**
- Modify: `frontend/ui.js` (`renderState`)
- Modify: `frontend/DESIGN.md` (section 6 "State block" paragraph; section 2 contract line for `renderState`)
- Test: `frontend/tests/ui_state_preview.test.js` (new)

**Interfaces:**
- Produces: `renderState(root, {..., preview})` where `preview` is a Node or an array of Nodes; when given, the block's last child is `figure.state__preview` holding them. Without it the block is exactly as today (`frontend/tests/ui.test.js:262` and `ui_icons.test.js` pin the three- and four-child shapes).

- [ ] **Step 1: Write the failing test**

```js
// renderState's optional preview: a figure.state__preview after the actions, holding whatever
// the caller passes, and nothing when no preview is given.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument } = require("./fake-dom");

const UI_SOURCE = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

function ui() {
  const context = { app: {}, document: fakeDocument(() => null) };
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  return context;
}

test("a preview node becomes the block's last child inside figure.state__preview", () => {
  const { app, document } = ui();
  const root = document.createElement("div");
  const chart = document.createElement("svg");
  app.ui.renderState(root, {
    kind: "empty",
    title: "Need two sessions",
    body: "Record two sessions to see a trend.",
    actionLabel: "Record",
    preview: chart,
  });
  const block = root.children[0];
  assert.equal(block.children.length, 5);
  const figure = block.children[4];
  assert.equal(figure.tagName, "figure");
  assert.equal(figure.className, "state__preview");
  assert.equal(figure.children[0], chart);
});

test("an array of preview nodes keeps its order", () => {
  const { app, document } = ui();
  const root = document.createElement("div");
  const first = document.createElement("svg");
  const second = document.createElement("p");
  app.ui.renderState(root, { kind: "empty", title: "T", body: "B.", preview: [first, second] });
  const figure = root.children[0].children[3];
  assert.equal(figure.children.length, 2);
  assert.equal(figure.children[0], first);
  assert.equal(figure.children[1], second);
});

test("without a preview the block is unchanged", () => {
  const { app, document } = ui();
  const root = document.createElement("div");
  app.ui.renderState(root, { kind: "empty", title: "T", body: "B.", actionLabel: "Go" });
  assert.equal(root.children[0].children.length, 4);
});

test("a preview comes after the secondary action too", () => {
  const { app, document } = ui();
  const root = document.createElement("div");
  app.ui.renderState(root, {
    kind: "error",
    title: "T",
    body: "B.",
    actionLabel: "Retry",
    secondaryLabel: "Drop",
    preview: document.createElement("p"),
  });
  const block = root.children[0];
  assert.equal(block.children.length, 6);
  assert.equal(block.children[5].className, "state__preview");
});

test("ui.js is the only file that builds a state__preview", () => {
  assert.ok(UI_SOURCE.includes('"state__preview"'));
  const screens = path.join(__dirname, "..", "screens");
  for (const file of fs.readdirSync(screens)) {
    const source = fs.readFileSync(path.join(screens, file), "utf8");
    assert.ok(!source.includes("state__preview"), file + " must pass preview to renderState");
  }
});

test("the figure is an element the fake DOM can hold", () => {
  assert.ok(new FakeElement("figure"));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test frontend/tests/ui_state_preview.test.js`
Expected: first test fails, `block.children.length` is 4 not 5.

- [ ] **Step 3: Change `renderState`**

In `frontend/ui.js`, the destructured options of `renderState` gain `preview`, and after the `secondaryLabel` block, before `root.appendChild(block)`:

```js
    // An optional preview under the words and actions: a figure the caller fills (Progress
    // shows an example trend there), never a sentence of its own.
    if (preview) {
      block.appendChild(el("figure", { class: "state__preview" }, preview));
    }
```

Update the function's header comment to list `preview` with the other options. If `el`'s `children` argument accepts only arrays, wrap: `Array.isArray(preview) ? preview : [preview]`.

- [ ] **Step 4: Update DESIGN.md**

Section 2 contract line: `renderState(root, {kind, title, body, actionLabel, onAction, icon, secondaryLabel, onSecondary, preview})` and add after `icon "mic" | "chart" | "search"`: `; preview, a Node or Nodes placed last in the block inside figure.state__preview (Progress's example trend)`.

Section 6 "State block" paragraph, after "then an optional `.btn--ghost` secondary action": `, then, when the caller passes `preview`, `figure.state__preview` (full width of the block, `--s-4` above) holding it`.

- [ ] **Step 5: Run the test and the three checks; commit**

```bash
node --test frontend/tests/ui_state_preview.test.js && .venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests
git add frontend/ui.js frontend/DESIGN.md frontend/tests/ui_state_preview.test.js
git commit -m "ui.renderState: an optional preview figure after the actions"
```

### Task 14: Progress shows an example trend and a 2-take tracker while it waits

**Files:**
- Modify: `frontend/screens/progress.js` (`renderEmpty`; new `buildPreview`, `previewChart`, `previewSteps`)
- Modify: `frontend/styles.css` (new rules after the `.state` rules, around line 400: `.state__preview`, `.progress-preview__*`)
- Modify: `frontend/DESIGN.md` (section 8 Progress line)
- Test: `frontend/tests/progress_preview.test.js` (new)

**Interfaces:**
- Consumes: `app.ui.renderState({preview})` from Task 13; progress.js's own `svgEl(tag, attrs)` (line 877) and `SVG_NS`.
- Pinned facts kept: `frontend/tests/progress.test.js` ("show() with fewer than two sessions…") reads `body.children.length === 1`, `block.className === "state state--empty"`, the first four children `[svg, title, text, action]`, the title "Need two sessions", both body sentences and the action "Record"; `progress_revamp.test.js` reads `block.children[0].getAttribute("data-icon") === "chart"`; `rank_ui.test.js` reads the body as `["rank-card", "state"]` or `["state"]`. The preview is the block's fifth child, so all of these hold.

What the preview shows: a 320 x 120 example chart (six points trending down toward a dashed target band, in the series colors Progress already uses), a one-line caption, and a two-step tracker "Take 1 · Take 2" where recorded takes are filled.

- [ ] **Step 1: Write the failing test**

```js
// Progress under two sessions: the state block keeps its four pinned children and gains a
// preview: an example trend chart, a caption and a two-take tracker that fills as takes land.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeElement, fakeDocument } = require("./fake-dom");

const FRONTEND = path.join(__dirname, "..");
const UI_SOURCE = fs.readFileSync(path.join(FRONTEND, "ui.js"), "utf8");
const PROGRESS_SOURCE = fs.readFileSync(path.join(FRONTEND, "screens", "progress.js"), "utf8");
const CSS = fs.readFileSync(path.join(FRONTEND, "styles.css"), "utf8");

// One stored take, as progress.test.js builds one: the stub summarize hands metrics back as
// the summary, so these are the numbers Progress reads.
const TAKE = {
  id: "t1",
  createdAt: "2026-10-11T19:07:00.000Z",
  passageId: "free-talk",
  passageTitle: "Your day",
  durationSeconds: 60,
  metrics: { wpm: 150, fillersPerMinute: 2, pauseCount: 0 },
  transcript: [],
};

function bareApp() {
  return {
    screens: { results: { summarize: (stored) => stored.metrics } },
    ui: {},
    store: {},
    router: {},
  };
}

// The same mount progress.test.js uses: ui.js then progress.js in one vm context against the
// fake document, a store that serves `sessions` newest first, a router that swallows taps.
function mountProgress(sessions) {
  const document = fakeDocument();
  const context = { app: bareApp(), document };
  context.app.store.list = () => Promise.resolve([...sessions]);
  context.app.router.go = () => {};
  vm.runInNewContext(UI_SOURCE, context, { filename: "ui.js" });
  vm.runInNewContext(PROGRESS_SOURCE, context, { filename: "progress.js" });
  const root = new FakeElement("section");
  const heading = new FakeElement("h1");
  heading.textContent = "Progress";
  const body = new FakeElement("div");
  body.className = "screen__body";
  root.appendChild(heading);
  root.appendChild(body);
  const progress = context.app.screens.progress;
  progress.mount(root);
  return { progress, body };
}

function find(node, className) {
  if (node.className && node.className.split(" ").includes(className)) return node;
  for (const child of node.children || []) {
    const hit = find(child, className);
    if (hit) return hit;
  }
  return null;
}

function ruleFor(selector) {
  const match = CSS.match(new RegExp("\\n" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{([^}]*)\\}"));
  assert.ok(match, "styles.css has a rule for " + selector);
  return match[1];
}

test("the preview is the block's fifth child and holds chart, caption and tracker", async () => {
  const { progress, body } = mountProgress([]);
  await progress.show();
  assert.equal(body.children.length, 1);
  const block = body.children[0];
  assert.equal(block.children.length, 5);
  const figure = block.children[4];
  assert.equal(figure.className, "state__preview");
  assert.deepEqual(
    figure.children.map((child) => child.tagName + "." + child.className),
    ["svg.progress-preview__chart", "p.progress-preview__caption", "ol.progress-preview__steps"],
  );
});

test("the chart is decorative, 320 by 120, with a target band, a dashed line and six points", async () => {
  const { progress, body } = mountProgress([]);
  await progress.show();
  const chart = find(body, "progress-preview__chart");
  assert.equal(chart.getAttribute("viewBox"), "0 0 320 120");
  assert.equal(chart.getAttribute("aria-hidden"), "true");
  assert.ok(find(chart, "progress-preview__band"));
  const line = find(chart, "progress-preview__line");
  assert.equal(line.getAttribute("points").split(" ").length, 6);
  const points = chart.children.filter((c) => c.tagName === "circle");
  assert.equal(points.length, 6);
});

test("the caption says it is an example, in under 15 words", async () => {
  const { progress, body } = mountProgress([]);
  await progress.show();
  const caption = find(body, "progress-preview__caption");
  assert.equal(caption.textContent, "Example: fillers per minute falling over six takes.");
  assert.ok(caption.textContent.split(" ").length < 15);
});

test("the tracker fills one step per recorded take", async () => {
  for (const [sessions, done] of [
    [[], []],
    [[TAKE], ["progress-preview__step--done"]],
  ]) {
    const { progress, body } = mountProgress(sessions);
    await progress.show();
    const steps = find(body, "progress-preview__steps");
    assert.equal(steps.getAttribute("aria-label"), done.length + " of 2 takes recorded");
    assert.deepEqual(steps.children.map((li) => li.textContent), ["Take 1", "Take 2"]);
    const doneSteps = steps.children.filter((li) => li.className.includes("--done"));
    assert.equal(doneSteps.length, done.length);
  }
});

test("with one take the block is still the body's last child", async () => {
  const { progress, body } = mountProgress([TAKE]);
  await progress.show();
  const last = body.children[body.children.length - 1];
  assert.equal(last.className, "state state--empty");
  assert.equal(last.children[2].textContent, "Record one more to see a trend.");
});

test("styles.css draws the preview from tokens only", () => {
  assert.match(ruleFor(".state__preview"), /width: 100%/);
  assert.match(ruleFor(".state__preview"), /margin: var\(--s-4\) 0 0/);
  assert.match(ruleFor(".progress-preview__chart"), /color: var\(--filler\)/);
  assert.match(ruleFor(".progress-preview__band"), /fill: var\(--ok-bg\)/);
  assert.match(ruleFor(".progress-preview__line"), /stroke-dasharray/);
  assert.match(ruleFor(".progress-preview__step--done"), /background: var\(--accent-soft\)/);
  assert.match(ruleFor(".progress-preview__caption"), /color: var\(--muted\)/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test frontend/tests/progress_preview.test.js`
Expected: the first test fails on `block.children.length`, 4 not 5.

- [ ] **Step 3: Add the preview to progress.js**

Constants, after `RECORD_LABEL` (line 162):

```js
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
```

`renderEmpty` passes the preview:

```js
  function renderEmpty(count, rankCard) {
    const body = nodes.body;
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
```

(Keep whatever `renderEmpty` does today around this; only the `preview:` line is new. Read lines 421-435 first and change nothing else.)

New functions, after `renderEmpty`:

```js
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
    svg.appendChild(svgEl("polyline", { class: "progress-preview__line", points: points.join(" ") }));
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
      app.ui.el(
        "li",
        { class: "progress-preview__step" + (i < count ? " progress-preview__step--done" : "") },
        label,
      ),
    );
    return app.ui.el(
      "ol",
      { class: "progress-preview__steps", "aria-label": count + PREVIEW_STEPS_LABEL },
      items,
    );
  }
```

`svgEl` at line 877 sets attributes from `attrs`; confirm it handles `class` as a plain attribute (SVG elements take `setAttribute("class", …)`). If it maps `class` to `className`, the fake DOM and the browser both accept that too.

- [ ] **Step 4: Add the CSS** after the `.screen__body > .state > .state__action` rule (line 393):

```css
/* The optional preview under a state block's actions (ui.js renderState). Progress fills it
   with an example trend while it waits for a second take: a picture of the chart to come, in
   the Fillers series color, never a sentence of its own. */
.state__preview {
  width: 100%;
  margin: var(--s-4) 0 0;
}

.progress-preview__chart {
  display: block;
  width: 100%;
  height: auto;
  color: var(--filler);
}

.progress-preview__band {
  fill: var(--ok-bg);
}

.progress-preview__line {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-dasharray: 6 4;
  stroke-linejoin: round;
}

.progress-preview__point {
  fill: var(--bg);
  stroke: currentColor;
  stroke-width: 2;
}

.progress-preview__caption {
  margin: var(--s-2) 0 0;
  font: var(--fs-micro);
  color: var(--muted);
  text-align: center;
}

.progress-preview__steps {
  display: flex;
  justify-content: center;
  gap: var(--s-2);
  margin: var(--s-3) 0 0;
  padding: 0;
  list-style: none;
}

.progress-preview__step {
  padding: var(--s-1) var(--s-3);
  border: 1px solid var(--border);
  border-radius: var(--r-chip);
  font: var(--fs-micro);
  color: var(--muted);
}

.progress-preview__step--done {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
```

Check how `styles.css` writes the type scale (`font: var(--fs-micro)` or `font-size: var(--fs-micro)`): grep `--fs-micro` in styles.css once and follow that spelling; adjust the test's regexes only if they named the wrong property (they check color and dasharray, not font).

- [ ] **Step 5: Update DESIGN.md section 8**, the Progress line:

`- Progress under two sessions (samples do not count): "Need two sessions" / "Record two sessions to see a trend." with none, "Record one more to see a trend." with one. Action "Record". Under the action, the preview (section 6, state block): an example chart captioned "Example: fillers per minute falling over six takes." and a tracker "Take 1", "Take 2" with one chip filled per recorded take (`aria-label` "1 of 2 takes recorded").`

- [ ] **Step 6: Run the test and the three checks**

Run: `node --test frontend/tests/progress_preview.test.js && .venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests`
Expected: all pass, including `progress.test.js`, `progress_revamp.test.js`, `rank_ui.test.js`, `state_layout.test.js` and `backend/tests/test_frontend_copy.py` (no `state--` or `class="state` in progress.js: the new classes are `progress-preview__*`, and the preview is passed as an option).

- [ ] **Step 7: Look at it**

```bash
.venv/bin/uvicorn backend.app:app --port 8766 > /dev/null 2>&1 &
sleep 2
.venv/bin/python scripts/screenshot_seed.py --out /tmp/one.json
python3 -c "import json; s=json.load(open('/tmp/one.json')); json.dump(s[:1], open('/tmp/one.json','w'))"
node scripts/screenshots.mjs --seed /tmp/one.json --out /tmp/preview-shots
kill %1
open /tmp/preview-shots/progress-light.png /tmp/preview-shots/progress-dark.png
```

Expected: "Need two sessions", "Record one more to see a trend.", the Record button, then the example chart with its green band and dashed amber line, the caption, and "Take 1" filled, "Take 2" outlined. The block stays centered between the heading and the nav on a 375 x 812 phone with no scroll; if it scrolls, reduce `PREVIEW_VIEWBOX` height to 100 and the test's expected viewBox with it.

- [ ] **Step 8: Commit**

```bash
git add frontend/screens/progress.js frontend/styles.css frontend/DESIGN.md frontend/tests/progress_preview.test.js
git commit -m "Progress: an example trend and a two-take tracker under Need two sessions"
```

### Task 15: Onboarding opens with the app's mark

**Files:**
- Modify: `frontend/styles.css` (`.onboarding__lead` block, line 2955)
- Modify: `frontend/DESIGN.md` (section 6: the Onboarding entry, or section 1 if that is where Onboarding is described)
- Test: `frontend/tests/onboarding_brand.test.js` (new)

Pinned facts kept: `frontend/tests/onboarding.test.js` reads the body's children as exactly `p.onboarding__lead, ul.onboarding__list, p.onboarding__privacy, button…`, so the mark is drawn by CSS on the lead paragraph, not by a new node. `icons/icon.svg` is in the service worker's SHELL already.

- [ ] **Step 1: Write the failing test**

```js
// Onboarding shows the app icon above its first sentence, drawn by CSS so the screen's DOM
// (pinned by onboarding.test.js) does not change.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp("\\n" + escaped + " \\{([^}]*)\\}"));
  assert.ok(match, "styles.css has a rule for " + selector);
  return match[1];
}

test("the lead paragraph draws the app icon above itself", () => {
  const rule = ruleFor(".onboarding__lead::before");
  assert.match(rule, /content: ""/);
  assert.match(rule, /display: block/);
  assert.match(rule, /width: 64px/);
  assert.match(rule, /height: 64px/);
  assert.match(rule, /url\("icons\/icon\.svg"\)/);
  assert.match(rule, /margin: 0 0 var\(--s-4\)/);
});

test("the icon file the rule points at exists", () => {
  assert.ok(fs.existsSync(path.join(__dirname, "..", "icons", "icon.svg")));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test frontend/tests/onboarding_brand.test.js`
Expected: "styles.css has a rule for .onboarding__lead::before".

- [ ] **Step 3: Add the rule** right before `.onboarding__lead {` (line 2955):

```css
/* The app's mark above the first sentence, drawn by CSS so the screen's DOM stays the four
   pinned children. The same file the manifest and the home screen use. */
.onboarding__lead::before {
  content: "";
  display: block;
  width: 64px;
  height: 64px;
  margin: 0 0 var(--s-4);
  background: url("icons/icon.svg") center / contain no-repeat;
  border-radius: 14px;
}
```

- [ ] **Step 4: DESIGN.md**: in the Onboarding description (section 1 or 6, wherever `.onboarding__lead` is named; grep it), add: `The lead paragraph draws the 64px app icon above itself with `::before` (`icons/icon.svg`), so the screen's DOM is unchanged.`

- [ ] **Step 5: Run the test and the three checks, look, commit**

```bash
node --test frontend/tests/onboarding_brand.test.js && .venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests
```

Then re-run the Task 14 Step 7 screenshot commands and open `onboarding-light.png` and `onboarding-dark.png`: a blue rounded square with the white microphone sits above "Record a practice speech…", with `--s-4` under it.

```bash
git add frontend/styles.css frontend/DESIGN.md frontend/tests/onboarding_brand.test.js
git commit -m "Onboarding: the app icon above the lead, drawn by CSS"
```

### Task 16: Visual review pass against a fixed checklist

**Files:**
- Read: `docs/screenshots/*.png` regenerated after Tasks 13 to 15 (re-run Task 11 Step 3, then commit the new PNGs)
- Modify: only what a failed row below needs; each fix is its own commit with its own new test, in the style of Tasks 14 and 15.

This task has no code of its own. It exists because the owner asked for a harder look at the visuals, and the way to do that honestly, under tests that pin the current design, is to check specific things and fix only what fails.

- [ ] **Step 1: Regenerate the ten screenshots** (Task 11 Step 3) and also capture four extra views by running `scripts/screenshots.mjs` after temporarily setting `PHONE` in `scripts/screenshot_views.js` to `{ w: 320, h: 568 }` and then `{ w: 1280, h: 800 }` into `/tmp/review-320` and `/tmp/review-1280` (do not commit the changed `PHONE`; `git checkout scripts/screenshot_views.js` afterwards).

- [ ] **Step 2: Walk the checklist.** Each row names what to look at and what passes.

| # | Screen and width | Pass when |
| --- | --- | --- |
| 1 | Every PNG | The script printed no "console errors" line |
| 2 | Every screen at 320 | No horizontal scrollbar; nothing clipped on the right (the script's report from the old harness is not kept, so judge by eye and by `document.documentElement.scrollWidth` via one `evaluate` if in doubt) |
| 3 | Results, light and dark | The rank card from `ui-cleanup` shows one bar and no ruler; the transcript shows the restart underline from the seeded take; the timeline shows at least one filler mark |
| 4 | Results, dark | Coach-note source links are readable (`--accent` on `--surface`); the "Peer reviewed" badge, if present, is readable |
| 5 | Progress, both | The chart's "Best" label does not overlap its point or the line; the three summary cells share one baseline |
| 6 | Progress empty (Task 14 Step 7 shots) | Block centered, no scroll at 375 x 812, the example band is visibly green in both themes |
| 7 | History, both | Status words carry their icon; nothing wraps mid-word at 320 |
| 8 | Onboarding, both | The icon's rounded corners match the card radius family; the lead sentence sits `--s-4` under it |
| 9 | Practice, 1280 | The column is centered at 640 max and the record button is still reachable without scrolling at 800 tall |
| 10 | Any | Nothing uses an exclamation mark; every visible sentence is under 15 words |

- [ ] **Step 3: For each failed row**, write a new test file `frontend/tests/visual_fix_<row>.test.js` that pins the fix (a CSS rule, a class, an attribute), watch it fail, fix, run the three checks, commit as `Visual: <what> (review row <n>)`. Do not change an existing test to make a row pass; if a row cannot pass without one, record it in the PR description under "Not fixed" with the test that pins the current behaviour.

- [ ] **Step 4: Commit the regenerated screenshots**

```bash
git add docs/screenshots/*.png
git commit -m "Screenshots regenerated after the Progress preview and the onboarding mark"
```

---

## Phase 7: Finish

### Task 17: Final verification on the branch

- [ ] **Step 1: The three checks, from a clean tree**

```bash
git status --short
.venv/bin/pytest -q && .venv/bin/ruff check . && node --test frontend/tests
```

Expected: no untracked files except `docs/screenshots/.chrome-profile/` (ignored); all green with higher counts than Task 1 recorded.

- [ ] **Step 2: Run the smoke script against a local server with every feature on** (a throwaway SQLite URL is fine):

```bash
DATABASE_URL=sqlite:////tmp/speech-coach-smoke.db SESSION_SECRET=local-only-secret .venv/bin/uvicorn backend.app:app --port 8766 > /dev/null 2>&1 &
sleep 2
.venv/bin/python scripts/smoke_deploy.py http://127.0.0.1:8766
kill %1
```

Expected: `PASS health`, `PASS accounts`, and `coach notes` PASS if `.env` has a key, else FAIL with the library detail (that line is the point of the script). Never print `.env`.

- [ ] **Step 3: Read the diff once as a judge would**

```bash
git log --oneline main..submission-polish
git diff main..submission-polish --stat
```

Expected: 14 to 20 commits, each named for what it does; no change under `automation/`, `.claude/`, `tasks/`, `docs/PLAN.md`, `docs/challenge-notes.md`, `CLAUDE.md` or any existing test file:

```bash
git diff main..submission-polish --name-only | grep -E "^(automation|\.claude|tasks)/|docs/PLAN.md|docs/challenge-notes.md|CLAUDE.md" ; echo "(nothing above this line is allowed)"
git diff main..submission-polish --name-only --diff-filter=M | grep -E "tests/" ; echo "(nothing above this line is allowed either)"
```

### Task 18: Pull request, merge, deploy, prove, tag

- [ ] **Step 1: Push the branch and open the PR**

```bash
git push -u origin submission-polish
gh pr create --base main --head submission-polish --title "Submission polish: accounts and AI notes on, privacy made true, screenshots, CI, license, architecture page, Progress preview" --body-file - <<'EOF'
## What changed

- Deploy: render.yaml declares ANTHROPIC_API_KEY, DATABASE_URL and SESSION_SECRET (T50); .env.example and the README deploy steps name them; `scripts/smoke_deploy.py` proves a deploy has accounts and Claude-written coach notes on.
- Privacy: the backend asks AssemblyAI to delete each transcript and its audio as soon as the words are back; README and how.html say so.
- Repo: MIT license, GitHub Actions CI with a badge, ten real screenshots (seeded history, light and dark), a two-sentence pitch, `docs/ARCHITECTURE.md` with a diagram pinned to the module list by a test.
- Screens: Progress shows an example trend and a two-take tracker under "Need two sessions"; Onboarding opens with the app icon.
- Tooling: `scripts/screenshot_seed.py`, `scripts/screenshot_views.js`, `scripts/screenshots.mjs` (headless Chrome over CDP, no dependencies).

## Not changed

- The AI disclosure (owner decision: mock run).
- Any existing test. New test files only.
- The sample take and `CACHE_NAME`.

## Visual review

Rows passed: <list>. Not fixed: <row and the test that pins it, or "none">.

## Checks

pytest <n> passed, ruff clean, node <n> passed. CI runs the same three.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Fill in the two `<…>` fields from Task 16 and Task 17 before submitting.

- [ ] **Step 2: Wait for CI green on the PR** (first run of `ci.yml`). If `setup-node` rejects "26", change it to "24", commit, push.

- [ ] **Step 3: Owner merges** (squash or merge commit, their choice). Merging deploys to Render.

- [ ] **Step 4: Prove the deploy**

```bash
.venv/bin/python scripts/smoke_deploy.py https://speech-coach-xz8c.onrender.com
```

Expected: three PASS lines. Then open the URL on a phone: Onboarding shows the icon; Progress on a fresh install shows the preview; `how.html` has "Your audio".

- [ ] **Step 5: Tag the state the judges will see, and stop pushing `main` until Nov 23**

```bash
git checkout main && git pull
git tag -a submission-2026 -m "State deployed for the 2026 Congressional App Challenge judging window"
git push origin submission-2026
```

---

## Self-review

**Spec coverage.** Scope item 1 (accounts): Phase 0 items 0.2, 0.3, 0.5 and Task 5. Item 2 (AI notes): 0.4, 0.5, Task 4, Task 5. Item 3 (T50): Tasks 2, 3, 7. Item 4 (privacy): Tasks 6, 7. Item 5 (architecture): Task 12. Item 6 (first impression): Tasks 8, 9, 10, 11. Item 7 (merge ui-cleanup): Task 1. Item 8 (Progress empty state): Tasks 13, 14. Item 9 (visuals): Tasks 14, 15, 16. The cold start, which the owner did not list but which blocks every Function point, is Phase 0 item 0.1 and the README bullet in Task 3.

**Placeholder scan.** Task 16 is a checklist, not code, by design; its fixes follow the Tasks 14 and 15 pattern. Task 18's PR body has two fields filled from earlier tasks. No "TBD" or "implement later" anywhere.

**Type consistency.** `renderState({preview})` (Task 13) is what `renderEmpty` passes (Task 14). `scripts.smoke_deploy.run/main` (Task 4) are what Tasks 5, 17 and 18 run. `scripts/screenshot_views.js` exports `VIEWS`, `seedExpression`, `resultsRoute` (Task 10), which `screenshots.mjs` imports and Task 11's test reads through the README names. `SECRETS` is the same five names in Tasks 2 and 3. `DELETE_TIMEOUT_SECONDS`, `BASE_URL`, `last_transcript_id` and `delete_last_transcript` (Task 6) are what its provider test and `discard_provider_copy` use.

**Review Focus.** Row 1 is Task 6's two failure tests and timeout test. Row 2 and 3 are existing tests plus Task 4's detail strings. Row 4 is Task 14's "with one take" test. Row 5 is the Chrome existence check in `screenshots.mjs` plus the pure module's tests; the Chrome session itself is exercised by Tasks 11, 14 and 16 by hand.

**Placement of the AssemblyAI delete.** `backend/tests/test_providers.py` destructures the fake's request list as `upload, create, *polls` and asserts three polls, so `transcribe` cannot send a fourth request. Task 6 therefore keeps `transcribe` as it is and has `/api/analyze` call `delete_last_transcript` through `discard_provider_copy`, which both new test files check and `test_api.py`'s `FakeTranscriber` (no such method) ignores.
