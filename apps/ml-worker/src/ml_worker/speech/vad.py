"""말소리 구간 검출(§8.4). 말소리 구간만 이어 붙여 STT에 넣는다(무음 환각 감소 — R-4)."""
from __future__ import annotations

from typing import Protocol

import numpy as np

SAMPLE_RATE = 16000


class VadBackend(Protocol):
    name: str

    def speech_only(self, pcm: np.ndarray) -> np.ndarray:
        """말소리 구간만 이어 붙인 배열. 말소리가 없으면 길이 0."""


class NoVad:
    name = "off"

    def speech_only(self, pcm: np.ndarray) -> np.ndarray:
        return pcm


class EnergyVad:
    """넘파이 RMS 임계 VAD — 모델·onnxruntime 없이 CI에서 돈다(mock 백엔드 기본)."""

    name = "energy"

    def __init__(
        self,
        frame_ms: int = 30,
        rms_threshold: float = 0.01,  # 약 -40 dBFS
        min_speech_ms: int = 90,
        pad_ms: int = 150,
    ) -> None:
        self._frame = SAMPLE_RATE * frame_ms // 1000
        self._threshold = rms_threshold
        self._min_frames = max(1, min_speech_ms // frame_ms)
        self._pad = max(0, pad_ms // frame_ms)

    def speech_only(self, pcm: np.ndarray) -> np.ndarray:
        n = pcm.shape[0] // self._frame
        if n == 0:
            return pcm[:0]
        frames = pcm[: n * self._frame].reshape(n, self._frame)
        rms = np.sqrt(np.mean(np.square(frames, dtype=np.float32), axis=1))
        active = rms > self._threshold
        # 연속 활성 구간 중 최소 길이 미만은 잡음으로 보고 버린다
        keep = np.zeros(n, dtype=bool)
        i = 0
        while i < n:
            if not active[i]:
                i += 1
                continue
            j = i
            while j < n and active[j]:
                j += 1
            if j - i >= self._min_frames:
                keep[max(0, i - self._pad) : min(n, j + self._pad)] = True
            i = j
        if not keep.any():
            return pcm[:0]
        return frames[keep].reshape(-1)


class SileroVad:
    """faster-whisper 패키지에 동봉된 Silero VAD(onnxruntime · CPU). 별도 모델 반입 0."""

    name = "silero"

    def __init__(self) -> None:
        from faster_whisper.vad import VadOptions, get_speech_timestamps

        self._get = get_speech_timestamps
        self._options = VadOptions()

    def speech_only(self, pcm: np.ndarray) -> np.ndarray:
        chunks = self._get(pcm, self._options, sampling_rate=SAMPLE_RATE)
        if not chunks:
            return pcm[:0]
        return np.concatenate([pcm[c["start"] : c["end"]] for c in chunks])


def load_vad(setting: str, backend: str) -> VadBackend:
    """`STT_VAD` 해석. auto = faster-whisper면 silero, mock이면 energy."""
    choice = setting.strip().lower()
    if choice == "auto":
        choice = "silero" if backend == "faster-whisper" else "energy"
    if choice == "silero":
        return SileroVad()
    if choice == "energy":
        return EnergyVad()
    if choice == "off":
        return NoVad()
    raise RuntimeError(f"알 수 없는 STT_VAD 값: '{setting}' — auto | silero | energy | off 중 하나여야 합니다.")
