"""The queue in front of the one worker that transcribes (plan 0235, section 4).

One worker thread runs one clip at a time. In front of it are two lanes, `turn`
and `comment`, and the worker always takes the oldest turn first: a person who
spoke to the assistant is holding a phone and waiting, while the author of a
voice comment already has their message. A clip that is running is never
interrupted.

The module is not named `queue.py`, which is what the plan first called it. The
service runs with its own directory first on the import path, so a local
`queue.py` would replace the standard library module of that name for every
package that imports it, `concurrent.futures` among them.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from concurrent.futures import Future
from dataclasses import dataclass, field
from typing import Any, Callable

LANES = ('turn', 'comment')


class QueueFull(Exception):
    """Every place in the queue is taken. The caller is told when to come back."""

    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__('the queue is full')
        self.retry_after_seconds = retry_after_seconds


class Expired(Exception):
    """The caller's deadline passed while the clip waited. It was never run."""


@dataclass(eq=False)
class Clip:
    lane: str
    work: Callable[[], Any]
    # `time.monotonic()` seconds, or None when the caller gave no deadline.
    deadline: float | None
    enqueued_at: float = field(default_factory=time.monotonic)
    started_at: float | None = None
    future: Future = field(default_factory=Future)

    def wait_ms(self) -> int:
        end = self.started_at if self.started_at is not None else time.monotonic()
        return round((end - self.enqueued_at) * 1000)


class ClipQueue:
    """Two lanes, one worker, a fixed depth.

    `depth` counts the clips waiting and the one running together, because that
    is the work a new caller would stand behind.
    """

    def __init__(self, depth: int, retry_after_seconds: int) -> None:
        self._depth = depth
        self._retry_after_seconds = retry_after_seconds
        self._lanes: dict[str, deque[Clip]] = {lane: deque() for lane in LANES}
        self._running: Clip | None = None
        self._ready = threading.Condition()
        self._worker = threading.Thread(target=self._loop, name='transcriber-worker', daemon=True)
        self._worker.start()

    def submit(self, lane: str, work: Callable[[], Any], deadline: float | None) -> Clip:
        if lane not in self._lanes:
            raise ValueError(f'unknown lane {lane}')
        with self._ready:
            if self._size() >= self._depth:
                raise QueueFull(self._retry_after_seconds)
            clip = Clip(lane=lane, work=work, deadline=deadline)
            self._lanes[lane].append(clip)
            self._ready.notify()
            return clip

    def withdraw(self, clip: Clip) -> bool:
        """Take a clip out before it starts. False when it already started."""
        with self._ready:
            lane = self._lanes[clip.lane]
            if clip in lane:
                lane.remove(clip)
                clip.future.cancel()
                return True
            return False

    def snapshot(self) -> dict[str, int]:
        with self._ready:
            return {
                'turn': len(self._lanes['turn']),
                'comment': len(self._lanes['comment']),
                'running': 1 if self._running is not None else 0,
            }

    def _size(self) -> int:
        return sum(len(lane) for lane in self._lanes.values()) + (1 if self._running else 0)

    def _next(self) -> Clip:
        """The oldest turn, else the oldest comment. Called with the lock held."""
        while True:
            for lane in LANES:
                if self._lanes[lane]:
                    return self._lanes[lane].popleft()
            self._ready.wait()

    def _loop(self) -> None:
        while True:
            with self._ready:
                clip = self._next()
                expired = clip.deadline is not None and time.monotonic() >= clip.deadline
                if not expired:
                    self._running = clip
                    clip.started_at = time.monotonic()
            if expired:
                # Dropped without running. A caller that gave up does not cost the
                # next caller a turn of the worker.
                clip.future.set_exception(Expired())
                continue
            try:
                clip.future.set_result(clip.work())
            except BaseException as error:  # noqa: BLE001 (handed to the caller as it is)
                clip.future.set_exception(error)
            finally:
                with self._ready:
                    self._running = None
