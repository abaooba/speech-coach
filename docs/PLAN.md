# Speech Coach upgrade: stricter detection, skill rank, cited advice, skill path, calendar, accounts

Self-contained plan for a fresh session. Repo: /Users/arescajas/Projects/speech-coach.
Research library: /Users/arescajas/Downloads/speech_advice_all.json (482 entries, already checked).

> Owner note, 2026-10-11: this plan replaces the previous PLAN.md, including its
> "Out of scope" list. T36 is written by the owner with Claude pairing live; agents skip it.

## Read first (repo rules that override everything here)

- CLAUDE.md: one task per session, test first, run `.venv/bin/pytest -q`, `.venv/bin/ruff check .`
  and `node --test frontend/tests` before every commit. Never push, never touch main (work on a
  feature branch). No placeholders or TODOs. Pure functions for metrics. Vanilla JS, no frameworks,
  no build step, no CDN. Never read .env.
- Do not edit: docs/PLAN.md, docs/challenge-notes.md, CLAUDE.md, tasks/queue.json,
  automation/, .claude/, existing test files. New test files are fine.
- frontend/DESIGN.md for tokens and classes. Python 3.13, ruff line length 100. JS ES2020 with a
  single app namespace.
- pytest runs with --disable-socket: tests cannot reach the network or a remote database.

## Context

The app records a speech, transcribes it (AssemblyAI with `disfluencies: True`,
backend/providers/assemblyai.py), and shows pace, pause and filler metrics. Two real takes on
2026-10-11 showed it is far too easy on speakers:

1. Restarts are missed. "I kinda ner— I'm kinda nervous" and "decisions a day— uh, the few
   decisions a student makes" are the owner's most common stutter (read the start of a sentence
   wrong, restart). Queued task T28 covers the second example only. The em dashes ("ner—", "day—")
   are not added by our code, so AssemblyAI appears to put them in the word text, which would make
   them a cheap cut-off signal. Verify this on a raw response.
2. "Mhm" is ignored on purpose. frontend/delivery.js:12 treats mhm/uh-huh/mm-hmm as agreement
   sounds. In a solo speech they are hesitations.
3. Long freezes are thrown away. Pauses are found by both backend/metrics.py find_pauses and
   frontend/pauses.js, but delivery.js isMidSentence (around line 287) drops every pause that
   comes after a full stop, including 5 s+ freezes.
4. No sense of level, and nothing that is hard to achieve.

## Owner decisions (final)

| Area | Decision |
|---|---|
| Restarts | Both: line words up against the script when there is one (Read passage or pasted text), and detect repeated phrases + cut-off words in free talk |
| mhm / uh-huh / mm-hmm | Count as fillers |
| Long pauses | 5 s+ pauses count anywhere, even after a full stop; mid-sentence pauses count as now (row reconstructed from T32; the pasted row was garbled) |
| Tracker | Skill rank + daily streak. Very harsh; Flawless almost unreachable |
| Haiku (claude-haiku-5-5) | Not used for detection (the Claude API has no audio input; rules do all counting). Used only to write personal advice drawn from the research library. Every tip cited, never repeated for the same speaker |
| Practice plan | Duolingo-style skill path whose levels are challenge modes (sudden death, speed ladder, cold read, clean stretch) |
| Calendar | Separate tab, heat-map by each day's best score, streaks, tap a day for its takes |
| Accounts | Optional, guest by default. Email + password built in FastAPI. Neon free Postgres |

Architecture rule: every feature works for guests using local IndexedDB (frontend/store.js).
Accounts only sync the same data to the server, so they can be cut last without breaking the rest.

## Preconditions the owner does by hand (agents must not)

1. Edit docs/PLAN.md: remove "accounts, server-side storage, LLM features" from Out of scope.
2. Add tasks T30 to T51 below to tasks/queue.json.
3. Create the Neon project and an Anthropic API key. Set DATABASE_URL, ANTHROPIC_API_KEY and
   SESSION_SECRET in the Render dashboard.
4. Copy ~/Downloads/speech_advice_all.json to backend/advice/library.json (or let T38 do it).

---

## Existing code to reuse

| What | Where |
|---|---|
| Word list, find_pauses, count_fillers, find_repeats, _repeated_phrase_length, MAX_REPEAT_PHRASE_WORDS=4, REPEAT_SKIP_WORDS, FILLER_WORDS/KEYS, analyze() | backend/metrics.py |
| /api/analyze, /api/health, cache-header middleware | backend/app.py |
| Provider abstraction (AssemblyAI, Deepgram) | backend/providers/ |
| Filler classification, pause classification (isMidSentence, SENTENCE_END), longestCleanStretch, delivery report | frontend/delivery.js |
| Silence detection + reconcile (human-owned, do not edit) | frontend/pauses.js |
| IndexedDB sessions/flags | frontend/store.js |
| Passages | frontend/passages.js |
| Rule-based tips (the fallback when there is no AI advice) | frontend/tips.js |
| Results, timeline, transcript tokens | frontend/screens/results.js |
| DEFAULT_TARGET_WPM = [140, 160], fillers target "under 3/min" | frontend/screens/progress.js |
| Hash router + nav | frontend/app.js, frontend/index.html |
| Service worker shell list (add every new JS file + bump CACHE_NAME) | frontend/sw.js |
| "How we count" page | frontend/how.html |
| Queued and still valid: T28 (restart rule), T29 (show restarts) | tasks/queue.json |

---

## Phase 1: Detection (Oct 11-12)

**T28** (queued, run as is): restart = a phrase of 2-4 words repeated after up to 2 abandoned words.

**T30 Cut-off restarts and longer re-reads** (backend/metrics.py, depends T28)
- First save a real AssemblyAI word list from a take containing "ner—" as a new fixture
  backend/tests/fixtures/take_2026_10_11_nervous.json and confirm the dash is in a word's text.
- `CUTOFF_MARKS = ("—", "–", "-")` at the end of a word marks a self-interruption. A restart is
  counted when, within the next `CUTOFF_LOOKAHEAD_WORDS = 4` words, either (a) a word starts with the
  cut-off fragment ("ner" → "nervous"), or (b) the words before the cut are spoken again with the
  same first word or the same stem (I/I'm, decision/decisions).
- Raise MAX_REPEAT_PHRASE_WORDS to 8 so rereading a whole clause counts. Keep longest-match and no
  overlap.
- Optionally add `Repeat.kind: "repeat" | "restart" | "cutoff"` (default keeps old callers working).
- New backend/tests/test_metrics_cutoffs.py: both 2026-10-11 sentences each give exactly 1
  repeat; "well-known fact" (a hyphen inside a word) gives none; "the day the end" gives none; an
  8-word reread gives 1; existing tests unchanged.

**T31 Count mhm / uh-huh / mm-hmm**
- backend/metrics.py: add "mhm" to FILLER_WORDS and FILLER_KEYS, normalizing "mm-hmm",
  "uh-huh", "mhmm", "mm-hm" to the mhm key.
- frontend/delivery.js: these sounds now match as hesitations and are added to hesitationCount.
  Update the comment at line 12.
- frontend/how.html: one line in "How we count".
- New tests: backend/tests/test_metrics_mhm.py and frontend/tests/mhm.test.js. "Mhm." with
  punctuation counts; the 2026-10-11 church take has hesitationCount = 3.

**T32 Long pauses anywhere**
- delivery.js: `LONG_PAUSE_SECONDS = 5`. Each classified pause gets `long: length >= 5`. A pause
  counts if `midSentence || long`. New report fields longPauseCount and longestPause. Long pauses
  break the clean stretch.
- Results timeline: a distinct marker plus legend chip "Long pause (5 s+)". Transcript: a pause
  marker with an aria-label. Follow DESIGN.md (add a token line only, no restructuring).
- New frontend/tests/long_pauses.test.js: a 6 s pause after "." counts; a 2 s pause after "."
  doesn't; a 2 s pause mid-sentence counts as before.

**T33 Script alignment** (new pure module backend/script_align.py)
- `align(words: Sequence[Word], script: str) -> ScriptReport` aligns normalized spoken tokens to
  script tokens (Needleman-Wunsch, match/mismatch/gap costs as named constants).
- `ScriptReport(restarts: list[Repeat], skipped: list[ScriptSlip], misread: list[ScriptSlip])`.
  A restart is the speaker going back to a script position already spoken. A misread is
  a substitution. A skip is a script word with no spoken match.
- New backend/tests/test_script_align.py: clean read (all empty); "the few decisions a day — the
  few decisions a student makes every day" against the passage gives 1 restart; one skipped line;
  one misread; empty script; fillers in speech ignored.

**T34 Send the script with each take** (depends T33)
- /api/analyze accepts an optional form field `script` (max 20,000 chars, otherwise a 400). When
  present, analyze() output gains a `script` block and `repeats` uses the script restarts (no
  double count).
- Practice Read tab sends the passage text from passages.js. Talk tab gets a collapsible "Paste
  your script (optional)" textarea.
- New backend/tests/test_analyze_script.py with a fake provider: with script, without, too long.

**T29** (queued) **+ T35 Show restarts, misreads and skips** (depends T29, T34)
- T29 as queued renders restarts. T35 adds .tok--misread (wavy underline) and skipped script words
  inserted as struck-through tokens. (The pasted text was cut off after "struck-throu"; this line
  is completed from context.)

## Phase 2: Skill rank and streak (Oct 12-13)

**T36 frontend/rank.js (app.rank), pure.** A good candidate for a human-owned task, because
judges will ask how the score works. Every constant is named with a one-line reason.
(Owner decision 2026-10-11: written by the owner with Claude pairing live.)
Owner decisions 2026-10-12, which override the bullets below where they differ:
- Misreads add to `weighted` (+1 each); a misread is an error.
- A take's weight in `rating` is its minutes, capped at 3, then quartered under 30 s. The 3
  imaginary 40-point takes weigh 1 minute each.
- The two 2026-10-11 takes score 33.5 (church) and 48.0 (uniforms) and land in Novice
  (rating about 39.8). That is accepted as "very harsh"; rank.test.js expects Novice, not
  Contender/Varsity.
Review fixes 2026-10-13 (frontend/rank.js is the reference):
- The 3 imaginary 40-point takes weigh whichever is more: 1 minute per empty slot of the
  10-take window, or the minutes the rated takes fall short of 3. Ten quick tries cannot push
  them out; ten full takes can still reach Master and Flawless.
- Each pause is charged once: a 5 s+ pause costs 3 wherever it falls, a shorter mid-sentence
  pause costs 1.
- More than 8 script words skipped at the very start or end of a take (script it never
  reached) cost nothing; every other skip costs 0.5.
- `takeScore(report)`: `weighted = fillers×1 + restarts×1.5 + midSentencePauses×1 + longPauses×3
  + misreads×1 + skips×0.5`, `perMin = weighted / minutes`,
  `score = 100 × exp(−0.15 × perMin) − pacePenalty`, clamped 0-100. The pace penalty is 1 point
  per 5 wpm outside the target band. Move DEFAULT_TARGET_WPM from progress.js to a shared constant.
  Rough results: 1 error/min gives 86, 0.1/min gives 98.5, the 2026-10-11 uniforms take about 48.
  (The pasted formula read "− misreads×1"; a misread is an error, so it is written here as "+".)
- `rating(history)`: the average of the last 10 take scores, weighted by length (takes under 30 s
  count ¼, capped at 3 min), pulled toward 40 by 3 imaginary takes.
- `tier(rating, history)`: Novice <40 · Contender ≥40 · Varsity ≥60 · Elite ≥75 · Champion ≥88 ·
  Master ≥96 · Flawless ≥99 and each of the last 10 takes ≥2 min, ≥97, with zero long pauses.
- `streak(history, today)`: consecutive local days with at least one take (current and longest).
- New frontend/tests/rank.test.js: the two real takes land in Contender/Varsity; 9 perfect takes
  are not Flawless; a first take is pulled toward 40; streak across midnight and across a gap; a
  10 s take barely moves the rating.

**T37 Rank UI** (depends T36): a rank badge with a progress bar to the next tier on Results
(including the change, "+3.1 → Varsity") and Progress; a streak flame on Practice. A rank line in
how.html. New frontend/tests/rank_ui.test.js.

## Phase 3: Research library + cited Haiku advice (Oct 13-15)

Library facts (checked 2026-10-11): 482 entries; tags filler 129, mid_pause 131, pace_fast 116,
restart 112, long_pause 111, pace_slow 66, general 58; levels beginner 284 / advanced 198; source
types organization 232, peer_reviewed 146, coach 76, book 28; 316 distinct sources; 0 duplicate ids
or texts. 133 entries have year: null and 97 have an empty author, so the schema must allow
these. Citation display falls back to publisher and "n.d.". 17 URLs are http://.

Entry shape:
`{id, advice, quote, drill, targets[], level, source{author, credentials, title, publisher, year|null, url, type}}`.

**T38 Import the library**
- Copy it to backend/advice/library.json unchanged. New backend/advice/__init__.py with
  `load_library() -> list[AdviceEntry]` (frozen dataclasses, loaded once).
- New backend/tests/test_advice_library.py: required keys; unique ids; targets ⊂ {restart, filler,
  mid_pause, long_pause, pace_fast, pace_slow, general}; level ∈ {beginner, advanced}; type ∈
  {peer_reviewed, book, coach, organization}; URL matches `^https?://`; quote ≤ 25 words; advice
  ≤ 70 words; year is int or null; at least 50 entries per measured tag; citation(entry) formats
  "Author, Title (Year)" with the publisher / n.d. fallbacks.
- New scripts/check_advice_links.py (manual, network, not in pytest): HEAD each unique URL and
  print dead ones. The owner runs it once; dead entries are fixed in the JSON by hand.

**T39 Advice selection** (pure, backend/advice/select.py, depends T38)
- `weakest_skills(report_summary) -> list[tag]` ranks skills by how far each is from target:
  restarts/min, fillers/min, mid-sentence pauses/min, long pauses, pace above or below the band.
- `candidates(library, weak_tags, tier, shown_ids, limit=25)`: entries matching the 2 weakest tags,
  level = beginner for Novice/Contender/Varsity and advanced from Elite up (falling back to the
  other level when empty), excluding shown_ids. When a tag runs out, the least recently shown come
  back first. Order is deterministic (seeded by session id) so tests are stable.
- New backend/tests/test_advice_select.py.

**T40 /api/advice endpoint with Haiku** (backend/advice/coach.py, depends T39)
- Request: `{session_id, summary: {...metrics, transcript excerpt ≤ 1,500 chars}, tier, shown_ids}`.
  For signed-in users (Phase 6) shown_ids comes from the database instead.
- Use the official anthropic Python SDK (add to requirements.txt). Model claude-haiku-5-5,
  `output_config={"effort": "low", "format": <json schema>}`, with the schema
  `{tips: [{entry_id: string, text: string ≤ 60 words}] (2-3 items)}`. The system prompt: write
  personal coaching using only the given entries and numbers, address the speaker as "you", no new
  facts, no sources in the text. Load the claude-api skill before writing this code.
- Validate: each entry_id must be a candidate, there are no duplicates, and the text is non-empty
  and within length. The citation is attached by the server from the library, never taken from
  the model.
- Fallback (no key, timeout 8 s, API error, refusal or invalid output): the top 2-3 candidates
  with their advice (and drill) shown word for word, cited. The response always has the same
  shape: `{tips: [{entry_id, text, drill, citation: {label, url, type}}], source: "ai" | "library"}`.
- The Anthropic client is injected so tests use a fake (no sockets). The key comes from the
  environment only and is never logged.
- New backend/tests/test_advice_api.py: happy path; invented id rejected → fallback; timeout →
  fallback; no key → fallback; citations equal the library's; shown ids excluded.

**T41 Advice on Results** (depends T40)
- Results shows the existing tips.js tips at once, then requests /api/advice and replaces them
  with a "Coach notes" card: each tip, its drill if any, and "Source: label" linking to the URL in a
  new tab with rel="noopener", plus a peer-reviewed badge. Keep the tips on failure.
- store.js records shown entry ids per take and caches the advice on the session, so reopening a
  take doesn't call the API again.
- New frontend/tests/advice_ui.test.js. A how.html line saying the transcript summary is sent to
  Anthropic to write the advice.

## Phase 4: Skill path with challenge modes (Oct 14-17)

**T42 frontend/path.js (app.path): data + pure evaluator**
- Units: Restarts, Fillers, Long pauses, Pace, each with 5 levels. `path.order(history)` puts the
  weakest unit first (same weakness ranking as T39, mirrored in JS).
- Level = `{id, unit, mode, prompt, durationSeconds, pass}`. Modes, all scored after the take from
  the delivery report:
  - suddenDeath: run = time to the first filler or restart. Pass if run ≥ target (30, 45, 60,
    90, 120 s).
  - speedLadder: the same passage at a target wpm (140 → 160 → 180). Pass if within ±10 wpm and
    restarts ≤ N.
  - coldRead: a random passage the speaker hasn't read. Pass if restarts + misreads ≤ N.
  - cleanStretch: free talk on a topic. Pass if the longest clean stretch ≥ Y s.
- `path.evaluate(level, report) -> {passed, detail}` with detail copy such as "Your run ended at 0:47
  on 'um'". Progress is saved via store.js.
- New frontend/tests/path.test.js: pass and fail per mode; unlock order; weakest-first; a cold
  read never repeats a passage.

**T43 Path screen** (#/path, depends T42, T37): a vertical path of level nodes (locked, current,
cleared) with the tier badge at the top. Tapping the current level opens Practice preset to that
mode/passage/time. Results shows pass/fail for a path take. Each level shows one cited "why this
works" line, picked from the library for that unit. Nav becomes Practice · Path · Calendar ·
Progress · History. New frontend/tests/path_screen.test.js.

**T44 Cold-read passages**: add at least 12 new debate-style passages (120-200 words each, original
text) to passages.js with a `coldRead: true` flag. New frontend/tests/passages_cold.test.js
checks the count and word lengths.

## Phase 5: Calendar (Oct 16-17)

**T45 frontend/calendar.js (pure layout) + #/calendar screen**
- `monthGrid(year, month, weekStart)` returns weeks of days. `shade(bestScore)` returns one of 4
  steps (none, <60, 60-88, ≥88), using DESIGN.md accent tokens.
- Screen: month grid with prev/next; current and longest streak above; a mark on days a path level
  was cleared. Tapping a day lists its takes (time, score, tier), each linking to Results.
  Accessible labels such as "Oct 11, 2 takes, best 74"; arrow keys move between days.
- Data from app.store, scores from app.rank, so it works for guests.
- New frontend/tests/calendar.test.js: Feb 2028 (leap year), a month starting on Sunday, shade
  buckets, a day with no takes, streak marks.

## Phase 6: Accounts, optional (Oct 16-19, cut first if late)

**T46 Database layer** (backend/db.py): SQLAlchemy Core with tables
users(id, email unique lowercased, password_hash, created_at),
auth_sessions(token_hash, user_id, expires_at),
speech_sessions(id, user_id, created_at, report JSON, transcript JSON) (no audio ever),
shown_advice(user_id, entry_id, shown_at), path_progress(user_id, level_id, cleared_at).
DATABASE_URL from the environment (Neon Postgres via psycopg); tests use sqlite:// in memory.
Create tables on startup. Add sqlalchemy, psycopg[binary] and argon2-cffi to requirements.

**T47 Auth** (backend/auth.py, depends T46): POST /api/auth/signup | login | logout,
GET /api/me, DELETE /api/me (deletes the user and all their rows). Argon2 password hashes,
password ≥ 10 chars. A 32-byte random session token, stored sha256-hashed, sent as an
HttpOnly; Secure; SameSite=Lax; Path=/ cookie, valid 30 days. Rate limit: 5 failed logins per
email+IP per 15 min (in memory). State-changing routes require Content-Type: application/json.
Uniform "email or password is wrong" errors. New backend/tests/test_auth.py.

**T48 Sessions API** (depends T47): GET/POST/DELETE /api/sessions, POST /api/sessions/import
(bulk, idempotent by session id), GET/POST /api/progress for shown advice and path progress.
/api/advice reads and records shown ids for signed-in users. New
backend/tests/test_sessions_api.py, including that user A cannot read or delete user B's sessions.

**T49 Frontend account + sync** (depends T48): frontend/auth.js (app.auth) and an #/account
screen (sign up, log in, log out, delete account with confirm). store.js keeps its public
interface. When signed in it writes through to the server and reads from it, with IndexedDB as the
offline cache. On first sign-in it offers to import guest history. New frontend/tests/sync.test.js
with a fake fetch.

**T50 Deploy + copy**: add DATABASE_URL, ANTHROPIC_API_KEY and SESSION_SECRET as
`sync: false` in render.yaml. Update the README deploy section and how.html privacy lines (what
the server stores, what goes to Anthropic, how to delete the account). Add every new JS file to
sw.js SHELL and bump CACHE_NAME.

---

## Order and cut line

| Dates | Tasks |
|---|---|
| Oct 11-12 | T28, T30, T31, T32, T33, T34, T29, T35 |
| Oct 12-13 | T36 (maybe human-owned), T37 |
| Oct 13-15 | T38, T39, T40, T41 |
| Oct 14-17 | T42, T43, T44, T45 |
| Oct 16-19 | T46, T47, T48, T49, T50 |
| Oct 20-21 | Buffer, phone tests, demo script. Oct 22 video, Oct 24 submit |

If late, cut in this order: accounts (T46-T49), then T44 cold-read content (drop the coldRead mode),
then the speedLadder mode. Everything else works without accounts.

## Verification

- Every task: `.venv/bin/pytest -q`, `.venv/bin/ruff check .`, `node --test frontend/tests` all
  pass with new test files only.
- Detection on a phone: re-record the two 2026-10-11 scripts. Expect "ner— I'm kinda" and "a day—
  uh, the few decisions" marked as restarts, "Mhm" highlighted, and a deliberate 6 s freeze between
  sentences shown as a long pause. A Read-tab take with one skipped line shows the skip.
- Rank: those takes land in Contender/Varsity. A fixture of 10 clean 2-minute takes with one 96 is
  not Flawless.
- Advice: with ANTHROPIC_API_KEY unset, Results still shows 2-3 cited library tips. With it set,
  5 takes in a row show no repeated entry id, and every citation equals its library entry. Run
  scripts/check_advice_links.py once and fix dead links.
- Path: clear sudden-death level 1 and see level 2 unlock. The calendar marks that day.
- Calendar: takes on two days give the right shading and streak.
- Accounts: sign up on the phone, record, sign in on a laptop and see the same history and rank.
  Delete the account and confirm the rows are gone in Neon. Guest mode still works offline.
