"""디스크 0 디코딩 — PyAV `av.open(io.BytesIO)` → 16kHz 모노 float32 (설계서 §8.3, DD-117).

임시 파일·ffmpeg 하위 프로세스를 쓰지 않는다. 자동 탐지가 실패하는 형식은 형식 힌트(`format=`)
재시도까지만 허용한다.
"""
from __future__ import annotations

import io

import numpy as np

from ml_worker.speech.limits import Deadline, SpeechError, invalid, too_long

SAMPLE_RATE = 16000
# 브라우저 MediaRecorder 산출물(WebM·MP4·Ogg)과 WAV. 자동 탐지가 실패했을 때만 순서대로 재시도한다.
_FORMAT_HINTS = ("matroska,webm", "mov,mp4,m4a,3gp,3g2,mj2", "ogg", "wav")
# 공개 엔드포인트의 임의 바이트가 HLS·concat·data URI 같은 외부 참조 형식으로 탐지되는 것을 막는다(M-5):
# 허용 컨테이너 목록(demuxer)과 프로토콜 허용 목록(커스텀 IO 외 접근 0)을 모두 건다.
_ALLOWED_DEMUXERS = frozenset(
    {"matroska", "webm", "mov", "mp4", "m4a", "3gp", "3g2", "mj2", "ogg", "wav"}
)
_OPEN_OPTIONS = {
    "format_whitelist": ",".join(sorted(_ALLOWED_DEMUXERS)),
    "protocol_whitelist": "pipe",
}


def _format_allowed(container) -> bool:
    names = {n.strip() for n in str(getattr(container.format, "name", "")).split(",") if n.strip()}
    return bool(names) and names <= _ALLOWED_DEMUXERS


def _try_open(av, payload: bytes, **kwargs):
    container = av.open(io.BytesIO(payload), mode="r", options=dict(_OPEN_OPTIONS), **kwargs)
    if not _format_allowed(container):
        container.close()
        raise ValueError("format not allowed")
    return container


def _open(av, payload: bytes):
    try:
        return _try_open(av, payload)
    except Exception:  # noqa: BLE001 — 형식 힌트 재시도 후에도 실패하면 INVALID
        pass
    for hint in _FORMAT_HINTS:
        try:
            return _try_open(av, payload, format=hint)
        except Exception:  # noqa: BLE001
            continue
    raise invalid()


def decode_to_pcm16k(payload: bytes, max_seconds: float, deadline: Deadline) -> np.ndarray:
    """오디오 바이트 → float32 1차원 배열(16kHz 모노). 길이 상한은 디코딩 중 누적 샘플로 검사한다(R-4)."""
    import av  # 지연 import — speech 역할 밖 프로세스는 이 모듈을 부르지 않는다

    if not payload:
        raise invalid()
    max_samples = int(max_seconds * SAMPLE_RATE)
    container = _open(av, payload)
    try:
        streams = container.streams.audio
        if len(streams) < 1:
            raise invalid()
        stream = streams[0]
        resampler = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)
        parts: list[np.ndarray] = []
        total = 0

        def _take(frames) -> None:
            nonlocal total
            for out in frames or []:
                arr = out.to_ndarray().reshape(-1).astype(np.float32, copy=False)
                total += arr.shape[0]
                if total > max_samples:
                    raise too_long()
                parts.append(arr)

        for frame in container.decode(stream):
            deadline.check()
            _take(resampler.resample(frame))
        _take(resampler.resample(None))  # 리샘플러 잔여 flush
    except SpeechError:
        raise
    except Exception as exc:  # noqa: BLE001 — av 형식·손상 오류는 메시지 없이 INVALID로
        raise invalid() from exc
    finally:
        container.close()
    if not parts:
        raise invalid()
    return np.concatenate(parts)
