"""How large a request body each API route takes: one over its route's limit is refused with 413.

Before any check of a route's own runs, FastAPI reads a JSON body whole and parses it, and
/api/analyze reads its recording whole, so a single oversized request could take a large part of
the 512 MB the server has. RequestBodyLimit, an ASGI middleware around the whole app (app.py),
refuses such a body with 413 and {"detail": message}, the shape of the app's other errors:

- at once, before the app runs or a byte is read, when its Content-Length states more than the
  limit;
- as it arrives, once more bytes than the limit have come, as from a body sent in chunks with no
  Content-Length. Each chunk is counted as the app reads it and is never held here.

A route's limit covers its path and every path under it (BODY_LIMITS). A path under /api that no
route names gets the small limit for JSON, and paths outside /api, the static frontend, have
none: nothing there reads a body.

Starlette has a RequestBodyLimitMiddleware of its own, but it refuses in plain text, with one
message for every route, and it lets the app run before it refuses a body that states too large a
length: a route that reads no body would act first and only then be refused.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# /api/analyze: room for 3 minutes of even uncompressed 16-bit stereo audio at 48 kHz (34.6 MB),
# with the longest script; a phone browser's compressed recording of that is a few MB.
MAX_RECORDING_BODY_BYTES = 40_000_000
RECORDING_TOO_LARGE = (
    f"That recording is over {MAX_RECORDING_BODY_BYTES // 1_000_000} MB. "
    "Record a shorter take and resend."
)
# /api/advice and every other JSON API route: the largest advice request the app sends,
# 2,000 shown library ids and a 1,500-character excerpt, is under 45,000 bytes.
MAX_SMALL_BODY_BYTES = 64_000
SMALL_BODY_TOO_LARGE = f"send at most {MAX_SMALL_BODY_BYTES:,} bytes in one request"


@dataclass(frozen=True)
class BodyLimit:
    """The most bytes of body a request to a route may carry, and what the 413 past it says."""

    max_bytes: int
    message: str


RECORDING_LIMIT = BodyLimit(MAX_RECORDING_BODY_BYTES, RECORDING_TOO_LARGE)
SMALL_BODY_LIMIT = BodyLimit(MAX_SMALL_BODY_BYTES, SMALL_BODY_TOO_LARGE)

# Each route's limit, by the path it covers along with every path under it. The first that covers
# a request's path is its limit, so the one for /api as a whole comes last.
BODY_LIMITS: tuple[tuple[str, BodyLimit], ...] = (
    ("/api/analyze", RECORDING_LIMIT),
    ("/api", SMALL_BODY_LIMIT),
)


def limit_for(
    path: str, limits: Sequence[tuple[str, BodyLimit]] = BODY_LIMITS
) -> BodyLimit | None:
    """The limit on the body of a request to `path`, or None when no limit covers it."""
    for covered, limit in limits:
        if path == covered or path.startswith(covered + "/"):
            return limit
    return None


def stated_length(scope: Scope) -> int:
    """The body's length as the request's Content-Length states it.

    0 when it states none, or nothing that reads as a number: the bytes are counted as they come.
    """
    try:
        return int(Headers(scope=scope).get("content-length", "0"))
    except ValueError:
        return 0


class BodyOverLimit(HTTPException):
    """A body whose bytes have passed its route's limit as they arrived: 413, with its message.

    An HTTPException, so FastAPI lets it out of its body reading and answers it as it answers
    any other: {"detail": message}.
    """

    def __init__(self, limit: BodyLimit) -> None:
        super().__init__(status_code=413, detail=limit.message)


class RequestBodyLimit:
    """ASGI middleware holding every request body to its route's limit (limit_for).

    A body that states too large a length is answered here, before the app runs. One that
    turns out too large as it arrives is cut off at the chunk that passes the limit, and the
    app answers the BodyOverLimit that its read raises.
    """

    def __init__(
        self, app: ASGIApp, limits: Sequence[tuple[str, BodyLimit]] = BODY_LIMITS
    ) -> None:
        self.app = app
        self.limits = limits

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        limit = limit_for(scope["path"], self.limits) if scope["type"] == "http" else None
        if limit is None:
            await self.app(scope, receive, send)
            return
        if stated_length(scope) > limit.max_bytes:
            refusal = JSONResponse({"detail": limit.message}, status_code=413)
            await refusal(scope, receive, send)
            return
        await self.app(scope, receive_at_most(receive, limit), send)


def receive_at_most(receive: Receive, limit: BodyLimit) -> Receive:
    """`receive`, raising BodyOverLimit once more than the limit's bytes of body have come."""
    received = 0

    async def receive_within_limit() -> Message:
        nonlocal received
        message = await receive()
        if message["type"] == "http.request":
            received += len(message.get("body", b""))
            if received > limit.max_bytes:
                raise BodyOverLimit(limit)
        return message

    return receive_within_limit
