"""No text the API takes may hold NUL (U+0000): such a request is refused with a 422.

No browser sends NUL: nothing the app writes holds it. So every string field of the advice
route refuses it as the body is read, before any route code runs, like any other invalid field.

A field with a length of its own is written Annotated[str, Field(...), AfterValidator(refuse_nul)],
the length first (backend/advice/coach.py). The error never quotes the text it refuses.
"""

NUL = "\x00"
NUL_REFUSED = "text may not hold NUL (U+0000)"


def refuse_nul(text: str) -> str:
    """`text` as it is, or a ValueError when it holds NUL. The error never quotes the text."""
    if NUL in text:
        raise ValueError(NUL_REFUSED)
    return text
