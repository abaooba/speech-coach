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

A take is {id, created_at, report, transcript}: the id the browser gave it (letters, digits, "-"
and "_"), when it was recorded (a time with its zone, given back in UTC), its report (a JSON
object: the metrics and details) and its transcript (a JSON array: the words with their timings).
That is not the record store.js keeps, {id, createdAt, passageId, passageTitle, durationSeconds,
metrics, transcript}, which is refused as it is (422). The browser sends the record's createdAt as
created_at, its passageId, passageTitle, durationSeconds and metrics as the report, and its
transcript as the transcript, and turns a take given back into a record the other way. The
report and the transcript are kept exactly as sent, MAX_TAKE_BYTES at most together and nested
MAX_JSON_DEPTH deep at most, and audio never is (TakeToKeep). Keeping a take with an id the
speaker already has replaces that take, as the browser's store does. An import keeps only the
takes whose ids the speaker has no take with, so importing the same guest history twice keeps one
copy of each take. It holds MAX_IMPORT_TAKES takes and MAX_IMPORT_BYTES of them at most, so a
long history goes in parts. One account keeps MAX_STORED_BYTES_PER_SPEAKER of takes at most, and
a write that would leave it over is refused (409) and changes nothing. The listing sends each
report and transcript as the JSON text the database keeps, so it never holds them parsed.

Progress is {shown_advice: [{entry_id, shown_at}], path_progress: [{level_id, cleared_at}]}: the
library advice the speaker has been shown and the skill-path levels (frontend/path.js) they have
cleared, each list oldest first. Posting progress merges it in, so posting it twice changes
nothing: an entry keeps the latest time it was shown, as advice is chosen by when it was last
shown, and a level the first time it was cleared, the day it was earned, as in store.js. One
account keeps MAX_PROGRESS_ROWS entries and as many levels at most (409 past that). /api/advice
(backend/app.py) reads and records a signed-in speaker's shown advice here too (shown_entry_ids,
record_shown).

Every route needs a signed-in speaker (auth.signed_in_account: 401 "not signed in") and reads
and writes that speaker's rows only. A take's id names it within one account (the key of
speech_sessions is user_id and id), so another speaker's take with the same id is never read,
replaced or deleted. While DATABASE_URL is unset every route answers 503 (db.accounts_engine),
and every route that changes something accepts JSON only (auth.require_json, 415 otherwise). A
request body over MAX_REQUEST_BYTES is refused with 413 before it is read in full
(backend/limits.py).
"""

import json
from collections.abc import Iterable, Iterator, Mapping, Sequence
from datetime import UTC, datetime
from functools import cached_property
from typing import Annotated, Any, Self

from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.responses import StreamingResponse
from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    model_validator,
)
from sqlalchemy import (
    Connection,
    Dialect,
    Engine,
    Insert,
    Row,
    Select,
    Text,
    cast,
    delete,
    func,
    select,
)

from backend import auth, db
from backend.advice.coach import MAX_ID_CHARACTERS, MAX_SHOWN_IDS
from backend.nul_free import holds_nul

# A take's report and transcript together, as JSON.stringify writes them: no spaces, in UTF-8.
# A take holds about 7 KB a minute of speech, so an hour-long one fits with room to spare.
MAX_TAKE_BYTES = 1_000_000
# How many arrays and objects deep a report or a transcript may nest (nesting_depth). Real ones go
# about 5 deep. Far deeper JSON breaks code that reads it back: pydantic, which writes FastAPI's
# answers, stops at 255 levels.
MAX_JSON_DEPTH = 64
# What one import may hold: this many takes, and this many bytes of them, each take counted as
# MAX_TAKE_BYTES counts it. That is two of the largest takes, or about sixty five-minute ones. A
# longer history goes in parts, which importing twice makes safe.
MAX_IMPORT_TAKES = 500
MAX_IMPORT_BYTES = 2_000_000
# The body of any request to these routes: an import of MAX_IMPORT_BYTES with room for the takes'
# ids, times and keys and for JSON written with spaces. FastAPI parses a JSON body before any
# check of ours runs, and parsed, JSON can take 35 times its size in memory: 3 MB of [{},{},...]
# takes about 100 MB, of the 512 MB the server has for everything. So a body over this is
# refused with 413 as it arrives, before it is read in full (backend/limits.py).
MAX_REQUEST_BYTES = 3_000_000
REQUEST_TOO_LARGE = (
    f"send at most {MAX_REQUEST_BYTES:,} bytes in one request: import a long history in parts"
)
# Shown entries, or cleared levels, that one post and one account may hold: more than the library
# has entries (632) and far more than the path has levels (20). /api/advice records library
# entries only, so an account that is sent nothing else never comes near it.
MAX_PROGRESS_ROWS = 2_000
PROGRESS_FULL = (
    f"this account keeps at most {MAX_PROGRESS_ROWS:,} shown entries and "
    f"{MAX_PROGRESS_ROWS:,} cleared levels"
)
# The takes one account may keep, counted as the database keeps their reports and transcripts
# (stored_take_bytes): about 600 five-minute takes. It bounds how much of the shared database
# one account fills, and the memory listing its takes needs (list_takes).
MAX_STORED_BYTES_PER_SPEAKER = 20_000_000
TAKES_FULL = (
    f"this account keeps at most {MAX_STORED_BYTES_PER_SPEAKER:,} bytes of takes: "
    "delete some to keep more"
)
# What frontend/store.js refuses to keep on a session (AUDIO_FIELDS), so a report never has one.
AUDIO_FIELDS = frozenset({"audio", "blob"})
# A take is known by its account and its id, the key of db.speech_sessions.
TAKE_KEY = ("user_id", "id")
# What keeping a take again replaces.
TAKE_CONTENTS = ("created_at", "report", "transcript")


# --- what the routes take and give ---------------------------------------------------------------


def _in_utc(moment: datetime) -> datetime:
    """`moment` in UTC, as the database keeps it. A time that has no UTC equivalent is refused.

    Such as 0001-01-01T00:00+05:00, which would fall in year 0, before any datetime can hold.
    """
    try:
        return moment.astimezone(UTC)
    except OverflowError:
        raise ValueError("the time is out of range") from None


# A take's id (crypto.randomUUID in store.js, or its base-36 fallback), a library entry's
# ("filler-001") or a level's ("long-pauses-3"): letters, digits, hyphens and underscores, as
# every id the app makes is. So a take's id stands in DELETE /api/sessions/{id} as it is, with no
# "/" that would split the path or "." and ".." that clients fold away, and no id holds NUL,
# which Postgres text cannot, or half of a UTF-16 surrogate pair, which UTF-8 cannot write.
ID_PATTERN = r"^[A-Za-z0-9_-]+$"
Id = Annotated[str, Field(min_length=1, max_length=MAX_ID_CHARACTERS, pattern=ID_PATTERN)]
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

    Raises ValueError for what a take never holds: NaN or Infinity, which JSON has not and
    Postgres refuses, and half of a UTF-16 surrogate pair, which no browser sends and which has
    no UTF-8 bytes to count. The message never quotes the value.
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
    MAX_JSON_DEPTH deep at most, hold no NUL in any key or text (backend/nul_free.py), and take
    MAX_TAKE_BYTES at most together, written as json_bytes() writes them, which also refuses
    what Postgres or UTF-8 cannot hold.
    """

    model_config = ConfigDict(extra="forbid")

    id: Id
    created_at: Moment

    @cached_property
    def size(self) -> int:
        """The bytes of the report and the transcript together, as json_bytes() counts them."""
        return json_bytes(self.report) + json_bytes(self.transcript)

    @model_validator(mode="after")
    def holds_no_audio_and_fits(self) -> Self:
        if self.report.keys() & AUDIO_FIELDS:
            raise ValueError("a take never holds audio")
        # Before json_bytes(), whose writer recurses through every level.
        depth = max(nesting_depth(self.report), nesting_depth(self.transcript))
        if depth > MAX_JSON_DEPTH:
            raise ValueError(f"the report or transcript nests {depth} deep, over {MAX_JSON_DEPTH}")
        if holds_nul(self.report) or holds_nul(self.transcript):
            raise ValueError("the report and transcript may not hold NUL (U+0000) in a key or text")
        if self.size > MAX_TAKE_BYTES:
            raise ValueError(
                f"the report and transcript take {self.size} bytes, over {MAX_TAKE_BYTES}"
            )
        return self


class TakeImport(BaseModel):
    """The body of POST /api/sessions/import: a guest's history, MAX_IMPORT_TAKES takes and
    MAX_IMPORT_BYTES of them at most, each take counted as TakeToKeep.size counts it."""

    model_config = ConfigDict(extra="forbid")

    sessions: list[TakeToKeep] = Field(max_length=MAX_IMPORT_TAKES)

    @model_validator(mode="after")
    def fits(self) -> Self:
        total = sum(take.size for take in self.sessions)
        if total > MAX_IMPORT_BYTES:
            raise ValueError(
                f"the takes come to {total} bytes, over {MAX_IMPORT_BYTES}: import them in parts"
            )
        return self


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
# in the tests. Every one writes the rows of `user_id` only, in the order of their keys: two
# requests that write the same rows in different orders, as two devices syncing at once can,
# would each lock a row the other waits for, and Postgres would end one with a deadlock.


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
    rows = [_take_row(user_id, take) for take in sorted(takes, key=lambda take: take.id)]
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
        for entry_id, shown_at in sorted(showings.items())
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
        for level_id, cleared_at in sorted(clearings.items())
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
    The MAX_SHOWN_IDS most recently shown at most, as many as a guest's request may send
    (coach.AdviceRequest): /api/advice puts these in place of the request's own without a check.
    """
    table = db.shown_advice
    most_recent = (
        select(table.c.entry_id)
        .where(table.c.user_id == user_id)
        .order_by(table.c.shown_at.desc(), table.c.entry_id.desc())
        .limit(MAX_SHOWN_IDS)
    )
    with engine.connect() as connection:
        most_recent_first = list(connection.execute(most_recent).scalars())
    return most_recent_first[::-1]


def record_shown(
    engine: Engine, user_id: int, entry_ids: Sequence[str], shown_at: datetime
) -> None:
    """Note the entries `entry_ids` as shown to `user_id` at `shown_at`, as /api/advice does."""
    if not entry_ids:
        return
    with engine.begin() as connection:
        showings = dict.fromkeys(entry_ids, shown_at)
        connection.execute(shown_advice_statement(connection.dialect, user_id, showings))


# --- what one account may keep -------------------------------------------------------------------
# Checked after a write, in its transaction: over the limit, the HTTPException undoes the write.
# Writes made at the same moment may each pass before the others are counted, so together they
# can leave an account over by what they carried.


def stored_take_bytes(user_id: int) -> Select[tuple[int]]:
    """How many bytes `user_id`'s takes take as the database keeps their reports and transcripts.

    db._json_text writes them in ASCII, with \\u escapes for everything else, so on Postgres and
    SQLite alike the length of the text in characters is its length in bytes.
    """
    takes = db.speech_sessions
    sizes = func.length(cast(takes.c.report, Text)) + func.length(cast(takes.c.transcript, Text))
    return select(func.coalesce(func.sum(sizes), 0)).where(takes.c.user_id == user_id)


def refuse_takes_over_the_limit(connection: Connection, user_id: int) -> None:
    """409, undoing the write, when `user_id`'s takes take over MAX_STORED_BYTES_PER_SPEAKER."""
    if connection.execute(stored_take_bytes(user_id)).scalar_one() > MAX_STORED_BYTES_PER_SPEAKER:
        raise HTTPException(status_code=409, detail=TAKES_FULL)


def refuse_progress_over_the_limit(connection: Connection, user_id: int) -> None:
    """409, undoing the write, when `user_id` has over MAX_PROGRESS_ROWS entries or levels."""
    for table in (db.shown_advice, db.path_progress):
        rows = select(func.count()).select_from(table).where(table.c.user_id == user_id)
        if connection.execute(rows).scalar_one() > MAX_PROGRESS_ROWS:
            raise HTTPException(status_code=409, detail=PROGRESS_FULL)


# --- the listing ---------------------------------------------------------------------------------
# A take's report and transcript go out as the JSON text the database keeps, never parsed into
# Python and written again: parsed, JSON can take 35 times its size in memory.

# How a Take's created_at is written: ISO 8601 in UTC, ending in Z.
MOMENT_JSON = TypeAdapter(datetime)


def take_as_json(take_id: str, created_at: datetime, report: str, transcript: str) -> str:
    """One take as JSON, given its `report` and `transcript` as JSON text already."""
    return (
        f'{{"id":{json.dumps(take_id)},"created_at":{MOMENT_JSON.dump_json(created_at).decode()},'
        f'"report":{report},"transcript":{transcript}}}'
    )


def takes_as_json(rows: Sequence[Row[tuple[str, datetime, str, str]]]) -> Iterator[str]:
    """`rows` of (id, created_at, report, transcript) as one JSON array, a take at a time."""
    yield "["
    for place, row in enumerate(rows):
        yield ("," if place else "") + take_as_json(*row)
    yield "]"


# --- routes --------------------------------------------------------------------------------------

# Every route here needs the database, so while accounts are off each answers 503 before its own
# checks run. FastAPI reads a JSON body first, though, and answers one that does not parse with 422,
# and a body over MAX_REQUEST_BYTES is refused with 413 before either (backend/limits.py).
router = APIRouter(prefix="/api", dependencies=[Depends(db.accounts_engine)])

Database = Annotated[Engine, Depends(db.accounts_engine)]
Speaker = Annotated[auth.SignedInAccount, Depends(auth.signed_in_account)]
JSON_ONLY = [Depends(auth.require_json)]


@router.get("/sessions", response_model=list[Take])
def list_takes(engine: Database, speaker: Speaker) -> StreamingResponse:
    """Every take the signed-in speaker kept, the newest first (takes kept at once by id).

    Each report and transcript is sent as the JSON text the database keeps (takes_as_json), so
    the answer needs about the memory of the takes themselves: MAX_STORED_BYTES_PER_SPEAKER.
    """
    takes = db.speech_sessions
    query = (
        select(
            takes.c.id,
            takes.c.created_at,
            cast(takes.c.report, Text),
            cast(takes.c.transcript, Text),
        )
        .where(takes.c.user_id == speaker.user_id)
        .order_by(takes.c.created_at.desc(), takes.c.id)
    )
    with engine.connect() as connection:
        rows = connection.execute(query).all()
    return StreamingResponse(takes_as_json(rows), media_type="application/json")


@router.post("/sessions", dependencies=JSON_ONLY)
def keep_take(take: TakeToKeep, engine: Database, speaker: Speaker) -> dict[str, str]:
    """Keep one take: 200 {"id": ...}. It replaces the speaker's own take with that id, if any.

    409, and nothing kept, when the speaker's takes would then take over
    MAX_STORED_BYTES_PER_SPEAKER (a take it replaces no longer counts).
    """
    with engine.begin() as connection:
        connection.execute(keep_take_statement(connection.dialect, speaker.user_id, take))
        refuse_takes_over_the_limit(connection, speaker.user_id)
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
    One take the import cannot keep refuses the whole import (422), and none is kept, as does
    an import that would leave the speaker's takes over MAX_STORED_BYTES_PER_SPEAKER (409).
    """
    takes = first_copies(history.sessions)
    imported = 0
    if takes:
        with engine.begin() as connection:
            statement = import_statement(connection.dialect, speaker.user_id, takes)
            imported = len(connection.execute(statement).all())
            if imported:
                refuse_takes_over_the_limit(connection, speaker.user_id)
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
    posting the same progress twice, or in any order, comes to the same. 409, and nothing
    merged, when the speaker would then have over MAX_PROGRESS_ROWS entries or levels.
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
        refuse_progress_over_the_limit(connection, speaker.user_id)
        return progress_of(connection, speaker.user_id)
