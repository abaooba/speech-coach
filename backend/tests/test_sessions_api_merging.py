"""How the Sessions API builds its upserts (backend/sessions_api.py, PLAN T48).

Postgres refuses an INSERT ... ON CONFLICT DO UPDATE that names one row twice ("command cannot
affect row a second time"), where SQLite applies the rows one after another, so the tests of the
routes, on SQLite, cannot tell. Before a statement is built, then, what a request names more than
once is kept once: an entry at the latest time it is listed as shown, a level at the earliest time
it is listed as cleared, and a take as first listed in an import.

Each statement writes its rows in the order of their keys. Two requests that write the same rows
in different orders, as two devices of one speaker syncing at once can, would each lock a row the
other waits for, and Postgres would end one of them with a deadlock: a 500.

No test here touches a database: each statement is compiled for Postgres and read.
"""

import re
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import Insert
from sqlalchemy.dialects.postgresql import psycopg

from backend import sessions_api
from backend.sessions_api import ClearedLevel, ProgressToMerge, ShownEntry, TakeToKeep

POSTGRES = psycopg.dialect()
EARLIER = datetime(2026, 10, 12, 18, 30, tzinfo=UTC)
LATER = EARLIER + timedelta(hours=1)
USER_ID = 7


def shown(entry_id: str, shown_at: datetime) -> ShownEntry:
    return ShownEntry(entry_id=entry_id, shown_at=shown_at)


def cleared(level_id: str, cleared_at: datetime) -> ClearedLevel:
    return ClearedLevel(level_id=level_id, cleared_at=cleared_at)


def take(take_id: str, version: int = 1) -> TakeToKeep:
    return TakeToKeep(
        id=take_id, created_at=EARLIER, report={"version": version}, transcript=[]
    )


def column_values(statement: Insert, column: str) -> list[object]:
    """The values `statement`, compiled for Postgres, writes in `column`, row by row."""
    params = statement.compile(dialect=POSTGRES).params
    rows = {
        int(match[1]): value
        for name, value in params.items()
        if (match := re.fullmatch(rf"{column}_m(\d+)", name))
    }
    return [rows[row] for row in sorted(rows)]


# --- what a request names more than once ---------------------------------------------------------


@pytest.mark.parametrize("times", [(EARLIER, LATER), (LATER, EARLIER)])
def test_an_entry_listed_twice_keeps_the_later_time(times: tuple[datetime, datetime]) -> None:
    showings = [shown("filler-001", when) for when in times] + [shown("pace-002", EARLIER)]

    assert sessions_api.latest_showings(showings) == {"filler-001": LATER, "pace-002": EARLIER}


@pytest.mark.parametrize("times", [(EARLIER, LATER), (LATER, EARLIER)])
def test_a_level_listed_twice_keeps_the_earlier_time(times: tuple[datetime, datetime]) -> None:
    clearings = [cleared("fillers-1", when) for when in times] + [cleared("pace-1", LATER)]

    assert sessions_api.first_clearings(clearings) == {"fillers-1": EARLIER, "pace-1": LATER}


def test_a_take_listed_twice_is_kept_as_first_listed() -> None:
    takes = [take("b", version=1), take("a"), take("b", version=2)]

    kept = sessions_api.first_copies(takes)

    assert [(each.id, each.report) for each in kept] == [("b", {"version": 1}), ("a", {"version": 1})]


def test_a_post_naming_an_entry_and_a_level_twice_names_each_once_for_postgres() -> None:
    post = ProgressToMerge(
        shown_advice=[shown("filler-001", EARLIER), shown("filler-001", LATER)],
        path_progress=[cleared("fillers-1", LATER), cleared("fillers-1", EARLIER)],
    )

    showings = sessions_api.latest_showings(post.shown_advice)
    clearings = sessions_api.first_clearings(post.path_progress)
    shown_statement = sessions_api.shown_advice_statement(POSTGRES, USER_ID, showings)
    cleared_statement = sessions_api.cleared_levels_statement(POSTGRES, USER_ID, clearings)

    assert column_values(shown_statement, "entry_id") == ["filler-001"]
    assert column_values(shown_statement, "shown_at") == [LATER]
    assert column_values(cleared_statement, "level_id") == ["fillers-1"]
    assert column_values(cleared_statement, "cleared_at") == [EARLIER]


# --- the order rows are written in ---------------------------------------------------------------


def test_shown_entries_are_written_in_the_order_of_their_ids() -> None:
    showings = {"restart-002": EARLIER, "filler-001": LATER, "pace_fast-001": EARLIER}

    statement = sessions_api.shown_advice_statement(POSTGRES, USER_ID, showings)

    assert column_values(statement, "entry_id") == ["filler-001", "pace_fast-001", "restart-002"]
    assert column_values(statement, "shown_at") == [LATER, EARLIER, EARLIER]


def test_cleared_levels_are_written_in_the_order_of_their_ids() -> None:
    clearings = {"pace-2": EARLIER, "fillers-1": LATER, "long-pauses-3": EARLIER}

    statement = sessions_api.cleared_levels_statement(POSTGRES, USER_ID, clearings)

    assert column_values(statement, "level_id") == ["fillers-1", "long-pauses-3", "pace-2"]
    assert column_values(statement, "cleared_at") == [LATER, EARLIER, EARLIER]


def test_imported_takes_are_written_in_the_order_of_their_ids() -> None:
    takes = [take("c", version=3), take("a", version=1), take("b", version=2)]

    statement = sessions_api.import_statement(POSTGRES, USER_ID, takes)

    assert column_values(statement, "id") == ["a", "b", "c"]
    assert column_values(statement, "report") == [{"version": 1}, {"version": 2}, {"version": 3}]


def test_tips_recorded_by_advice_are_written_in_the_order_of_their_ids() -> None:
    # record_shown notes the tips in the order they were given; the statement sorts them.
    showings = dict.fromkeys(["restart-002", "filler-001"], LATER)

    statement = sessions_api.shown_advice_statement(POSTGRES, USER_ID, showings)

    assert column_values(statement, "entry_id") == ["filler-001", "restart-002"]
