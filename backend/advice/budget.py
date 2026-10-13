"""The cost ceiling on coach notes: how many times an hour the server may ask Claude to write them.

Every set of notes Claude writes is a paid API call (coach.advise), and nothing else stops a
script, or a crowd, asking /api/advice for notes again and again. So the server keeps one count of
the calls it made in the last hour, ADVICE_CALL_BUDGET, shared by every visitor: never one count
per address, since behind Render's proxy every visitor has the proxy's address. Once the hour's
calls are spent, the notes are the library's own tips (source "library"), as when no key is set,
until the oldest call is an hour old. The speaker never sees an error, and the log says only how
many calls an hour the budget allows.

The count lives in this process's memory: a restart clears it, and each server process keeps its
own (Render runs one).
"""

import threading
import time
from collections import deque
from collections.abc import Callable

# A call every 12 seconds, around the clock: far more notes than a room of speakers asks for, and
# a ceiling on what anyone asking in a loop can spend.
AI_ADVICE_CALLS_PER_HOUR = 300
# The rolling hour: each call counts against the budget for this long after it is made.
BUDGET_WINDOW_SECONDS = 3_600.0


class AICallBudget:
    """At most `calls_per_window` calls to the model in any `window_seconds`, for the whole server.

    `clock` gives the time in seconds. It is time.monotonic unless a test gives its own: a change
    to the system clock cannot move it, so it can neither free the budget early nor hold it.
    try_to_spend() is safe to call from any thread.
    """

    def __init__(
        self,
        calls_per_window: int = AI_ADVICE_CALLS_PER_HOUR,
        window_seconds: float = BUDGET_WINDOW_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.calls_per_window = calls_per_window
        self.window_seconds = window_seconds
        self._clock = clock
        # When each call still counting was made, oldest first: calls_per_window at most.
        self._calls: deque[float] = deque()
        self._lock = threading.Lock()

    def try_to_spend(self) -> bool:
        """Count a call made now and return True, or return False when the window's are spent.

        A call that is turned away is not counted.
        """
        with self._lock:
            now = self._clock()
            while self._calls and self._calls[0] <= now - self.window_seconds:
                self._calls.popleft()
            if len(self._calls) >= self.calls_per_window:
                return False
            self._calls.append(now)
            return True


# The one budget the server keeps (app.advice_call_budget hands it to /api/advice).
ADVICE_CALL_BUDGET = AICallBudget()
