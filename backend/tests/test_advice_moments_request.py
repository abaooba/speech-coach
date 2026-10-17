"""POST /api/advice takes the take's moments (backend/advice/coach.py Moment, spec Phase 3).

A moment is one place in the take the Results screen found: a restart, a filler, a pause, a long
pause, a misread or skipped script word, or a stumble or unclear word the app only guesses at
(`hint`). Each has an id like "restart-1" whose prefix is its kind, the second it starts at, its
clock time as the transcript shows it ("0:32"), how long it lasted when that matters, its words
and the words either side, and for a misread the word the script expected. A request holds 40
moments at most, each id once. A request without moments, as the frontend in a browser's cache
still sends, is read exactly as before.

No test asks a model: the model is a fake that fails if it is asked.
"""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend import app as app_module
from backend.advice import coach

JSON_HEADERS = {"content-type": "application/json"}
# Sent next to each refused value: an answer that holds it has quoted the value back.
MARKER = "MARKER-OF-THE-REFUSED-VALUE"


def moment(**changes: object) -> dict[str, Any]:
    """The uniforms take's restart, as the Results screen sends it, changed by `changes`."""
    return {
        "id": "restart-1",
        "kind": "restart",
        "at": 32.4,
        "clock": "0:32",
        "seconds": None,
        "text": "a day— uh, the few",
        "before": "one of the few decisions",
        "after": "decisions a student makes",
        "expected": None,
        "hint": False,
        **changes,
    }


def advice_body(**changes: object) -> dict[str, Any]:
    return {
        "session_id": "8b1f6c2e-take-one",
        "summary": {
            "duration_seconds": 42.882,
            "words_per_minute": 159.5,
            "filler_count": 2,
            "restart_count": 1,
            "mid_sentence_pause_count": 0,
            "long_pause_count": 0,
            "target_wpm": [140, 160],
            "transcript_excerpt": "One of the few decisions a day— uh, the few decisions.",
        },
        "tier": "Contender",
        "shown_ids": [],
        **changes,
    }


def request_with(*moments: dict[str, Any]) -> coach.AdviceRequest:
    return coach.AdviceRequest.model_validate(advice_body(moments=list(moments)))


class RefusingMessages:
    async def create(self, **request: Any) -> Any:
        raise AssertionError("the model was asked")


class RefusingAnthropic:
    def __init__(self) -> None:
        self.messages = RefusingMessages()


@pytest.fixture
def client() -> Any:
    app_module.app.dependency_overrides[app_module.advice_client] = lambda: RefusingAnthropic()
    yield TestClient(app_module.app)
    app_module.app.dependency_overrides.clear()


# --- what a moment holds -------------------------------------------------------------------------


def test_a_moment_is_read_with_every_field() -> None:
    [read] = request_with(moment()).moments

    assert read == coach.Moment(
        id="restart-1",
        kind="restart",
        at=32.4,
        clock="0:32",
        seconds=None,
        text="a day— uh, the few",
        before="one of the few decisions",
        after="decisions a student makes",
        expected=None,
        hint=False,
    )


@pytest.mark.parametrize(
    "kind", ["restart", "filler", "pause", "long-pause", "misread", "skip", "stumble", "unclear"]
)
def test_every_kind_of_moment_is_taken(kind: str) -> None:
    [read] = request_with(moment(id=f"{kind}-12", kind=kind)).moments

    assert (read.id, read.kind) == (f"{kind}-12", kind)


def test_a_pause_carries_how_long_it_lasted_and_a_misread_its_expected_word() -> None:
    pause = moment(id="pause-2", kind="pause", seconds=1.8, text="", before="the", after="few")
    misread = moment(id="misread-1", kind="misread", text="fourty", expected="forty")

    read_pause, read_misread = request_with(pause, misread).moments

    assert read_pause.seconds == 1.8
    assert read_pause.text == ""
    assert read_misread.expected == "forty"


def test_a_hint_and_the_optional_fields_may_be_left_out() -> None:
    sent = moment(id="unclear-1", kind="unclear", text="thoroughly")
    for optional in ("seconds", "expected", "hint"):
        del sent[optional]

    [read] = request_with(sent).moments

    assert (read.seconds, read.expected, read.hint) == (None, None, False)


def test_a_field_a_moment_does_not_name_is_dropped() -> None:
    [read] = request_with(moment(confidence=0.41)).moments

    assert not hasattr(read, "confidence")


# --- requests without moments ---------------------------------------------------------------------


def test_a_request_without_moments_is_read_as_before() -> None:
    request = coach.AdviceRequest.model_validate(advice_body())

    assert request.moments is None


def test_a_request_may_list_no_moments() -> None:
    assert request_with().moments == []


def test_forty_moments_are_taken_and_forty_one_refused() -> None:
    forty = [moment(id=f"filler-{number}", kind="filler") for number in range(1, 42)]

    assert len(request_with(*forty[:40]).moments) == 40
    with pytest.raises(ValidationError):
        request_with(*forty)


# --- what is refused ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "changes",
    [
        {"id": "Restart-1"},
        {"id": "restart-"},
        {"id": "restart-1000"},
        {"id": "restart-1 "},
        {"id": "debate-1"},
        {"id": "filler-1"},  # the id names another kind than the moment's own
        {"kind": "rebuttal", "id": "rebuttal-1"},
        {"at": -1.0},
        {"at": float("nan")},
        {"seconds": -0.5},
        {"clock": "32"},
        {"clock": "0:7"},
        {"clock": "0:32 "},
        {"text": "x" * 121},
        {"before": "x" * 61},
        {"after": "x" * 61},
        {"expected": "x" * 41},
        {"hint": "yes"},
        {"text": None},
    ],
    ids=[
        "capital in the id", "no number", "four digits", "space after the id", "unknown kind",
        "id of another kind", "kind not listed", "negative start", "start not a number",
        "negative length", "clock without a colon", "clock with one digit of seconds",
        "space after the clock", "text over 120", "before over 60", "after over 60",
        "expected over 40", "hint not a boolean", "no text",
    ],
)
def test_a_moment_that_breaks_a_rule_is_refused(changes: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        request_with(moment(**changes))


def test_two_moments_with_one_id_are_refused() -> None:
    with pytest.raises(ValidationError):
        request_with(moment(), moment(text="the few"))


def test_the_longest_texts_are_taken() -> None:
    [read] = request_with(
        moment(text="x" * 120, before="y" * 60, after="z" * 60, expected="w" * 40)
    ).moments

    assert (len(read.text), len(read.before), len(read.after), len(read.expected or "")) == (
        120, 60, 60, 40,
    )


@pytest.mark.parametrize("field", ["text", "before", "after", "expected"])
def test_a_moment_text_holding_nul_is_refused_by_the_route_without_quoting_it(
    client: TestClient, field: str
) -> None:
    body = advice_body(moments=[moment(**{field: f"{MARKER}\x00"})])

    response = client.post("/api/advice", content=json.dumps(body), headers=JSON_HEADERS)

    assert response.status_code == 422, response.text
    assert MARKER not in response.text
    [problem] = response.json()["detail"]
    assert problem["loc"] == ["body", "moments", 0, field]
    assert "NUL" in problem["msg"]


def test_a_refused_moment_is_never_quoted_back(client: TestClient) -> None:
    body = advice_body(moments=[moment(text=MARKER * 10)])

    response = client.post("/api/advice", json=body)

    assert response.status_code == 422
    assert MARKER not in response.text
