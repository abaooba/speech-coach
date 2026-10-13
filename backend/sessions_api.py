"""The Sessions API (docs/PLAN.md T48): a signed-in speaker's takes and progress, on the server.

    GET    /api/sessions                                  200 [take, ...], the newest first
    POST   /api/sessions         take                     200 {id}; replaces the speaker's own
                                                          take with that id, if there is one
    DELETE /api/sessions                                  204; every take the speaker kept is gone
    DELETE /api/sessions/{id}                             204; the speaker's take with that id is
                                                          gone, if there was one
    POST   /api/sessions/import  {sessions: [take, ...]}  200 {imported, skipped}
    GET    /api/progress                                  200 progress
    POST   /api/progress         progress                 200 progress, once merged in

Guests come first: the browser keeps every take in IndexedDB (frontend/store.js). For a speaker
who signs in, these routes keep the same data on the server too, so their other devices see it.

A take is {id, created_at, report, transcript}, as store.js keeps one: the id the browser gave
it, when it was recorded (a time with its zone, given back in UTC), its report (a JSON object:
the metrics and details) and its transcript (a JSON array: the words with their timings). The
report and the transcript are kept exactly as sent, MAX_TAKE_BYTES at most together, and audio
never is (TakeToKeep). Keeping a take with an id the speaker already has replaces that take, as
the browser's store does. An import keeps only the takes whose ids the speaker has no take with,
so importing the same guest history twice keeps one copy of each take.

Progress is {shown_advice: [{entry_id, shown_at}], path_progress: [{level_id, cleared_at}]}: the
library advice the speaker has been shown and the skill-path levels (frontend/path.js) they have
cleared, each list oldest first. Posting progress merges it in, so posting it twice changes
nothing: an entry keeps the latest time it was shown, as advice is chosen by when it was last
shown, and a level the first time it was cleared, the day it was earned, as in store.js.
/api/advice (backend/app.py) reads and records a signed-in speaker's shown advice here too
(shown_entry_ids, record_shown).

Every route needs a signed-in speaker (auth.signed_in_account: 401 "not signed in") and reads
and writes that speaker's rows only. A take's id names it within one account (the key of
speech_sessions is user_id and id), so another speaker's take with the same id is never read,
replaced or deleted. While DATABASE_URL is unset every route answers 503 (db.accounts_engine),
and every route that changes something accepts JSON only (auth.require_json, 415 otherwise).
"""

import json
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Annotated, Any, Self

from fastapi import APIRouter, Depends, Path
from pydantic import AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import Connection, Dialect, Engine, Insert, Select, delete, select

from backend import auth, db
from backend.advice.coach import MAX_ID_CHARACTERS

# A take's report and transcript together, as JSON.stringify writes them: no spaces, in UTF-8.
# A take holds about 7 KB a minute of speech, so an hour-long one fits with room to spare.
MAX_TAKE_BYTES = 1_000_000
# How many arrays and objects deep a report or a transcript may nest (nesting_depth). Real ones go
# about 5 deep. Far deeper JSON breaks the code that reads it back: pydantic, which writes
# FastAPI's answers, stops at 255 levels, so a take nested deeper would fail every listing of it.
MAX_JSON_DEPTH = 64
# Takes in one import: a long guest history in one request, while the request stays one the
# server can hold. A longer history goes in parts, which importing twice makes safe.
MAX_IMPORT_TAKES = 500
# Shown entries, or cleared levels, in one post: more than the library has entries (482) and
# far more than the path has levels.
MAX_PROGRESS_ROWS = 2_000
# What frontend/store.js refuses to keep on a session (AUDIO_FIELDS), so a report never has one.
AUDIO_FIELDS = frozenset({"audio", "blob"})
# A take is known by its account and its id, the key of db.speech_sessions.
TAKE_KEY = ("user_id", "id")
# What keeping a take again replaces.
TAKE_CONTENTS = ("created_at", "report", "transcript")


# --- what the routes take and give ---------------------------------------------------------------


def _printable(text: str) -> str:
    """`text`, if every character in it is printable.

    No id the app makes holds any other, such as NUL, which Postgres text cannot hold, or half
    of a UTF-16 surrogate pair, which UTF-8 cannot write (as auth.could_belong_to_an_account).
    """
    if not text.isprintable():
        raise ValueError("an id holds printable characters only")
    return text


def _in_utc(moment: datetime) -> datetime:
    """`moment` in UTC, as the database keeps it. A time that has no UTC equivalent is refused.

    Such as 0001-01-01T00:00+05:00, which would fall in year 0, before any datetime can hold.
    """
    try:
        return moment.astimezone(UTC)
    except OverflowError:
        raise ValueError("the time is out of range") from None


# A take's id (crypto.randomUUID in store.js), a library entry's ("filler-001") or a level's.
Id = Annotated[str, Field(min_length=1, max_length=MAX_ID_CHARACTERS), AfterValidator(_printable)]
# A time with its zone, such as toISOString's "2026-10-12T18:30:00.000Z", kept in UTC.
Moment = Annotated[AwareDatetime, AfterValidator(_in_utc)]


def nesting_depth(value: object) -> int:
    """How many arrays and objects deep `value` goes: 0 for a string, a number, true, false or
    null, 1 for [] or {}, and one more for each level inside on the deepest branch.

    Walked with a list of what is left to look at rather than by recursion, so no depth of input
    can exhaust the stack.
    """
    deepest = 0
    unvisited: list[tuple[object, int]] = [(value, 1)]
    while unvisited:
        item, depth = unvisited.pop()
        if isinstance(item, dict):
            children: Iterable[object] = item.values()
        elif isinstance(item, list):
            children = item
        else:
            continue
        deepest = max(deepest, depth)
        unvisited.extend((child, depth + 1) for child in children)
    return deepest


def json_bytes(value: object) -> int:
    """How many bytes `value` takes as JSON.stringify writes it: no spaces, in UTF-8.

    Raises ValueError for what standard JSON cannot carry: NaN or Infinity, which Postgres
    refuses, and half of a UTF-16 surrogate pair, which UTF-8 cannot write, so every answer
    holding the take would fail. The message never quotes the value.
    """
    try:
        text = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    except ValueError:
        raise ValueError("a take holds standard JSON only: no NaN or Infinity") from None
    try:
        return len(text.encode("utf-8"))
    except UnicodeEncodeError:
        raise ValueError("a take holds text UTF-8 can write: no half surrogate pairs") from None


class Take(BaseModel):
    """A take as the server gives it back: the speaker's row of speech_sessions."""

    id: str
    created_at: datetime
    report: dict[str, Any]
    transcript: list[Any]


class TakeToKeep(Take):
    """A take as a browser sends it to be kept, checked before it reaches the database.

    It has the four fields and nothing else, so a take carrying its audio is refused, as is a
    report with an audio field (AUDIO_FIELDS). The report and the transcript each nest
    MAX_JSON_DEPTH deep at most, and they take MAX_TAKE_BYTES at most together, written as
    json_bytes() writes them, which also refuses what Postgres or UTF-8 cannot hold.
    """

    model_config = ConfigDict(extra="forbid")

    id: Id
    created_at: Moment

    @model_validator(mode="after")
    def holds_no_audio_and_fits(self) -> Self:
        if self.report.keys() & AUDIO_FIELDS:
            raise ValueError("a take never holds audio")
        # Before json_bytes(), whose writer recurses through every level.
        depth = max(nesting_depth(self.report), nesting_depth(self.transcript))
        if depth > MAX_JSON_DEPTH:
            raise ValueError(f"the report or transcript nests {depth} deep, over {MAX_JSON_DEPTH}")
        size = json_bytes(self.report) + json_bytes(self.transcript)
        if size > MAX_TAKE_BYTES:
            raise ValueError(f"the report and transcript take {size} bytes, over {MAX_TAKE_BYTES}")
        return self


class TakeImport(BaseModel):
    """The body of POST /api/sessions/import: a guest's history, MAX_IMPORT_TAKES takes at most."""

    model_config = ConfigDict(extra="forbid")

    sessions: list[TakeToKeep] = Field(max_length=MAX_IMPORT_TAKES)


class ImportResult(BaseModel):
    """What an import did: how many takes it kept, and how many it skipped.

    A take is skipped when the speaker already has its id, or when the import listed it before.
    """

    imported: int
    skipped: int


class ShownEntry(BaseModel):
    """A library entry the speaker has been shown, and when last."""

    model_config = ConfigDict(extra="forbid")

    entry_id: Id
    shown_at: Moment


class ClearedLevel(BaseModel):
    """A skill-path level the speaker has cleared, and when first."""

    model_config = ConfigDict(extra="forbid")

    level_id: Id
    cleared_at: Moment


class Progress(BaseModel):
    """A speaker's progress as the server gives it back, each list oldest first.

    Entries shown at once come in the order of their ids, levels cleared at once likewise.
    """

    shown_advice: list[ShownEntry]
    path_progress: list[ClearedLevel]


class ProgressToMerge(BaseModel):
    """The body of POST /api/progress, where either list may be left out.

    Each list holds MAX_PROGRESS_ROWS at most and may name an entry or a level more than once.
    """

    model_config = ConfigDict(extra="forbid")

    shown_advice: list[ShownEntry] = Field(default_factory=list, max_length=MAX_PROGRESS_ROWS)
    path_progress: list[ClearedLevel] = Field(default_factory=list, max_length=MAX_PROGRESS_ROWS)


# --- merging, before the database ----------------------------------------------------------------
# Postgres refuses an INSERT ... ON CONFLICT DO UPDATE that would change one row twice, so a
# statement names each take, entry or level once.


def first_copies(takes: Iterable[TakeToKeep]) -> list[TakeToKeep]:
    """`takes` with each id once, as first listed, in their order."""
    first: dict[str, TakeToKeep] = {}
    for take in takes:
        first.setdefault(take.id, take)
    return list(first.values())


def latest_showings(shown_advice: Iterable[ShownEntry]) -> dict[str, datetime]:
    """Each entry's id once, with the latest time it is listed as shown."""
    latest: dict[str, datetime] = {}
    for entry in shown_advice:
        latest[entry.entry_id] = max(entry.shown_at, latest.get(entry.entry_id, entry.shown_at))
    return latest


def first_clearings(path_progress: Iterable[ClearedLevel]) -> dict[str, datetime]:
    """Each level's id once, with the earliest time it is listed as cleared."""
    first: dict[str, datetime] = {}
    for level in path_progress:
        first[level.level_id] = min(level.cleared_at, first.get(level.level_id, level.cleared_at))
    return first


# --- statements ----------------------------------------------------------------------------------
# Each is built for the database it will run on (db.insert_for): Postgres in production, SQLite
# in the tests. Every one writes the rows of `user_id` only.


def _take_row(user_id: int, take: TakeToKeep) -> dict[str, object]:
    """The row of speech_sessions that keeps `take` for `user_id`."""
    return {
        "id": take.id,
        "user_id": user_id,
        "created_at": take.created_at,
        "report": take.report,
        "transcript": take.transcript,
    }


def keep_take_statement(dialect: Dialect, user_id: int, take: TakeToKeep) -> Insert:
    """Keep `take` for `user_id`, in place of their take with the same id if they have one."""
    statement = db.insert_for(dialect, db.speech_sessions).values(_take_row(user_id, take))
    return statement.on_conflict_do_update(
        index_elements=TAKE_KEY,
        set_={column: statement.excluded[column] for column in TAKE_CONTENTS},
    )


def import_statement(dialect: Dialect, user_id: int, takes: Sequence[TakeToKeep]) -> Insert:
    """Keep each of `takes` (one or more, ids distinct) that `user_id` has no take with the id of.

    The takes they have are left as they are. The statement returns the ids of the takes kept.
    """
    rows = [_take_row(user_id, take) for take in takes]
    return (
        db.insert_for(dialect, db.speech_sessions)
        .values(rows)
        .on_conflict_do_nothing(index_elements=TAKE_KEY)
        .returning(db.speech_sessions.c.id)
    )


def shown_advice_statement(
    dialect: Dialect, user_id: int, showings: Mapping[str, datetime]
) -> Insert:
    """Note each entry in `showings` (one or more) as shown to `user_id` at its time.

    An entry shown before keeps the later of its two times: an older one never moves it back.
    """
    table = db.shown_advice
    rows = [
        {"user_id": user_id, "entry_id": entry_id, "shown_at": shown_at}
        for entry_id, shown_at in showings.items()
    ]
    statement = db.insert_for(dialect, table).values(rows)
    return statement.on_conflict_do_update(
        index_elements=("user_id", "entry_id"),
        set_={"shown_at": statement.excluded.shown_at},
        where=table.c.shown_at < statement.excluded.shown_at,
    )


def cleared_levels_statement(
    dialect: Dialect, user_id: int, clearings: Mapping[str, datetime]
) -> Insert:
    """Note each level in `clearings` (one or more) as cleared by `user_id` at its time.

    A level cleared before keeps the earlier of its two times: a later one never moves it on.
    """
    table = db.path_progress
    rows = [
        {"user_id": user_id, "level_id": level_id, "cleared_at": cleared_at}
        for level_id, cleared_at in clearings.items()
    ]
    statement = db.insert_for(dialect, table).values(rows)
    return statement.on_conflict_do_update(
        index_elements=("user_id", "level_id"),
        set_={"cleared_at": statement.excluded.cleared_at},
        where=table.c.cleared_at > statement.excluded.cleared_at,
    )


def _shown_advice_oldest_first(user_id: int) -> Select[tuple[str, datetime]]:
    """(entry_id, shown_at) of each entry shown to `user_id`, the least recently shown first."""
    table = db.shown_advice
    return (
        select(table.c.entry_id, table.c.shown_at)
        .where(table.c.user_id == user_id)
        .order_by(table.c.shown_at, table.c.entry_id)
    )


def _cleared_levels_oldest_first(user_id: int) -> Select[tuple[str, datetime]]:
    """(level_id, cleared_at) of each level `user_id` has cleared, the first cleared first."""
    table = db.path_progress
    return (
        select(table.c.level_id, table.c.cleared_at)
        .where(table.c.user_id == user_id)
        .order_by(table.c.cleared_at, table.c.level_id)
    )


def progress_of(connection: Connection, user_id: int) -> Progress:
    """Everything `user_id` has been shown and has cleared, each list oldest first."""
    shown_advice = connection.execute(_shown_advice_oldest_first(user_id))
    path_progress = connection.execute(_cleared_levels_oldest_first(user_id))
    return Progress(
        shown_advice=[
            ShownEntry(entry_id=row.entry_id, shown_at=row.shown_at) for row in shown_advice
        ],
        path_progress=[
            ClearedLevel(level_id=row.level_id, cleared_at=row.cleared_at) for row in path_progress
        ],
    )


# --- shown advice, for /api/advice ---------------------------------------------------------------


def shown_entry_ids(engine: Engine, user_id: int) -> list[str]:
    """The ids of the library entries shown to `user_id`, the least recently shown first.

    As candidates() (backend/advice/select.py) takes them; entries shown at once go in id order.
    """
    with engine.connect() as connection:
        return list(connection.execute(_shown_advice_oldest_first(user_id)).scalars())


def record_shown(
    engine: Engine, user_id: int, entry_ids: Sequence[str], shown_at: datetime
) -> None:
    """Note the entries `entry_ids` as shown to `user_id` at `shown_at`, as /api/advice does."""
    if not entry_ids:
        return
    with engine.begin() as connection:
        showings = dict.fromkeys(entry_ids, shown_at)
        connection.execute(shown_advice_statement(connection.dialect, user_id, showings))


# --- routes --------------------------------------------------------------------------------------

# Every route here needs the database, so while accounts are off each answers 503 before its own
# checks run. FastAPI reads a JSON body first, though, and answers one that does not parse with 422.
router = APIRouter(prefix="/api", dependencies=[Depends(db.accounts_engine)])

Database = Annotated[Engine, Depends(db.accounts_engine)]
Speaker = Annotated[auth.SignedInAccount, Depends(auth.signed_in_account)]
JSON_ONLY = [Depends(auth.require_json)]


@router.get("/sessions")
def list_takes(engine: Database, speaker: Speaker) -> list[Take]:
    """Every take the signed-in speaker kept, the newest first (takes kept at once by id)."""
    takes = db.speech_sessions
    query = (
        select(takes.c.id, takes.c.created_at, takes.c.report, takes.c.transcript)
        .where(takes.c.user_id == speaker.user_id)
        .order_by(takes.c.created_at.desc(), takes.c.id)
    )
    with engine.connect() as connection:
        rows = connection.execute(query).all()
    return [Take.model_validate(row._asdict()) for row in rows]


@router.post("/sessions", dependencies=JSON_ONLY)
def keep_take(take: TakeToKeep, engine: Database, speaker: Speaker) -> dict[str, str]:
    """Keep one take: 200 {"id": ...}. It replaces the speaker's own take with that id, if any."""
    with engine.begin() as connection:
        connection.execute(keep_take_statement(connection.dialect, speaker.user_id, take))
    return {"id": take.id}


@router.delete("/sessions", status_code=204, dependencies=JSON_ONLY)
def delete_every_take(engine: Database, speaker: Speaker) -> None:
    """Delete every take the speaker kept: 204. Their progress and their account stay."""
    takes = db.speech_sessions
    with engine.begin() as connection:
        connection.execute(delete(takes).where(takes.c.user_id == speaker.user_id))


@router.delete("/sessions/{take_id}", status_code=204, dependencies=JSON_ONLY)
def delete_take(take_id: Annotated[Id, Path()], engine: Database, speaker: Speaker) -> None:
    """Delete the speaker's take with this id: 204, whether or not they had one.

    422 for an id no take could have, such as one holding NUL, which Postgres cannot compare.
    """
    takes = db.speech_sessions
    with engine.begin() as connection:
        connection.execute(
            delete(takes).where(takes.c.user_id == speaker.user_id, takes.c.id == take_id)
        )


@router.post("/sessions/import", dependencies=JSON_ONLY)
def import_takes(history: TakeImport, engine: Database, speaker: Speaker) -> ImportResult:
    """Keep each take whose id the speaker has no take with: 200 {"imported", "skipped"}.

    A take whose id the speaker has is skipped and theirs left as it was, and a take listed
    twice is kept as first listed, so importing the same history again keeps one copy of each.
    One take the import cannot keep refuses the whole import (422), and none is kept.
    """
    takes = first_copies(history.sessions)
    imported = 0
    if takes:
        with engine.begin() as connection:
            statement = import_statement(connection.dialect, speaker.user_id, takes)
            imported = len(connection.execute(statement).all())
    return ImportResult(imported=imported, skipped=len(history.sessions) - imported)


@router.get("/progress")
def show_progress(engine: Database, speaker: Speaker) -> Progress:
    """The advice the speaker has been shown and the levels they have cleared, oldest first."""
    with engine.connect() as connection:
        return progress_of(connection, speaker.user_id)


@router.post("/progress", dependencies=JSON_ONLY)
def merge_progress(progress: ProgressToMerge, engine: Database, speaker: Speaker) -> Progress:
    """Merge `progress` into the speaker's, and answer with the whole of theirs: 200.

    An entry keeps the latest time it was shown and a level the first time it was cleared, so
    posting the same progress twice, or in any order, comes to the same.
    """
    showings = latest_showings(progress.shown_advice)
    clearings = first_clearings(progress.path_progress)
    with engine.begin() as connection:
        if showings:
            statement = shown_advice_statement(connection.dialect, speaker.user_id, showings)
            connection.execute(statement)
        if clearings:
            statement = cleared_levels_statement(connection.dialect, speaker.user_id, clearings)
            connection.execute(statement)
        return progress_of(connection, speaker.user_id)
