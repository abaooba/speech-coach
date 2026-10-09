# PLAN (human-owned; agents read only)

## Goal
Win the 2026 Congressional App Challenge, IL-06. Submit Sat Oct 24.
Judging: idea quality, user experience and design, demonstrated coding skill.
The 1 to 3 minute demo video is what judges see.

## Scope (frozen on Oct 14)
1. Practice: pick a passage or free-talk prompt, record, submit, see results.
2. Results: transcript with fillers highlighted, pause markers, metrics,
   one or two rule-based tips.
3. History and progress chart.

Out of scope: accounts, server-side storage, native apps, live feedback,
LLM features. Do not add anything not in tasks/queue.json.

## Priorities when choices arise
1. The demo must never crash. Robustness over cleverness.
2. Readable, well-named code a judge can follow.
3. Clean UI over more features.
4. Speed of the first-run experience.

## Human-owned work
Tasks marked `"owner": "human"` in the queue are written by Ares by hand.
Agents skip them and must not implement them or stub them.

## Dates
- Oct 14 scope freeze, Oct 22 video day, Oct 24 submit.

## Run schedule (updated Oct 8)
- Thu Oct 8 night: automatic, 3 tasks (T01 to T03 expected).
- Fri Oct 9 night: automatic, 3 tasks (T04 to T06 expected).
- Sat Oct 10 to Mon Oct 12 (three-day weekend, hands-on):
  - Morning: approve or reject the night run (30 min).
  - Day batch 1 (2 tasks) runs while Ares hand-writes T08 (Web Audio pause
    detection) with Claude pairing live.
  - Approve, then day batch 2 (2 tasks) while Ares tests on a phone and
    writes new task briefs and acceptance lines for anything found.
  - Night: automatic as usual.
  - Sunday afternoon: first phone test of the full loop on the Render deploy.
  - Monday: bug fixes, daily recordings continue, first draft of the
    "technical difficulty" notes in docs/challenge-notes.md.
- Tue Oct 13 to Wed Oct 14: night runs only. Scope freeze Oct 14.
- Budget guard: `/usage` before every day batch (see automation/README.md).
