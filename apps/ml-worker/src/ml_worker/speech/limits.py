"""동시 처리 상한(대기 없는 세마포어)과 처리 기한(DD-122, §8.6)."""
from __future__ import annotations

import threading
import time


class SpeechError(Exception):
    """오류 코드만 싣는다(입력·예외 메시지·모델 정보 금지 — §8.3). 코드는 HTTP 본문 `detail`이 된다."""

    def __init__(self, code: str, status_code: int) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


def invalid() -> SpeechError:
    return SpeechError("INVALID", 400)


def too_large() -> SpeechError:
    return SpeechError("TOO_LARGE", 413)


def too_long() -> SpeechError:
    return SpeechError("TOO_LONG", 413)


def busy() -> SpeechError:
    return SpeechError("BUSY", 503)


def deadline_exceeded() -> SpeechError:
    return SpeechError("DEADLINE", 504)


def loading() -> SpeechError:
    return SpeechError("LOADING", 503)


def failed() -> SpeechError:
    return SpeechError("FAILED", 500)


class Deadline:
    """`time.monotonic()` 기준 처리 기한. 프레임·세그먼트 사이에서만 검사한다(중간에 끊을 수 없다 — K-11)."""

    def __init__(self, seconds: float) -> None:
        self._at = time.monotonic() + seconds

    def expired(self) -> bool:
        return time.monotonic() > self._at

    def check(self) -> None:
        if self.expired():
            raise deadline_exceeded()


class SpeechGate:
    """대기열 0 세마포어 — 얻지 못하면 즉시 BUSY. `BoundedSemaphore.acquire(blocking=False)`."""

    def __init__(self, size: int) -> None:
        self.size = size
        self._sem = threading.BoundedSemaphore(size)

    def try_acquire(self) -> bool:
        return self._sem.acquire(blocking=False)

    def release(self) -> None:
        self._sem.release()
