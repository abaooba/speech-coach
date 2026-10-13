"""No text the API takes may hold NUL (U+0000): such a request is refused with a 422.

Postgres text cannot hold NUL and refuses a statement that carries one, so a NUL that reached the
accounts database would turn its request into a 500. The SQLite the tests run on keeps NUL
without a word, so no test against it would notice. No browser sends one either: nothing the
app writes holds it. So every string field of the account, session, progress and advice routes
refuses NUL as the body is read, before any route code runs, like any other invalid field.

NulFreeStr is a string field that refuses NUL. A field with a length of its own is written
Annotated[str, Field(...), AfterValidator(refuse_nul)], the length first (backend/advice/coach.py).
holds_nul() finds a NUL in any key or text of a JSON value, for a take's report and transcript,
which hold any JSON. The error never quotes the text it refuses.
"""

from typing import Annotated

from pydantic import AfterValidator

NUL = "\x00"
NUL_REFUSED = "text may not hold NUL (U+0000)"


def refuse_nul(text: str) -> str:
    """`text` as it is, or a ValueError when it holds NUL. The error never quotes the text."""
    if NUL in text:
        raise ValueError(NUL_REFUSED)
    return text


NulFreeStr = Annotated[str, AfterValidator(refuse_nul)]


def holds_nul(value: object) -> bool:
    """Whether any key or text in `value`, as JSON parses into Python, holds NUL, at any depth.

    Walked with a list of what is left to look at rather than by recursion, so no depth of input
    can exhaust the stack.
    """
    unvisited: list[object] = [value]
    while unvisited:
        item = unvisited.pop()
        if isinstance(item, str):
            if NUL in item:
                return True
        elif isinstance(item, dict):
            unvisited.extend(item.keys())
            unvisited.extend(item.values())
        elif isinstance(item, list):
            unvisited.extend(item)
    return False
