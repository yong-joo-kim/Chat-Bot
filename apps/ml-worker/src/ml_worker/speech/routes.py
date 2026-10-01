"""`POST /speech/transcribe` · `GET /speech/health` (설계서 §8.3, DD-116~118·122).

- 본문은 원시 바이트(`Request.stream()`)로만 받는다 — UploadFile·Form·Pydantic 본문 모델 없음.
- 대기 없는 세마포어: 본문을 다 받은 뒤 얻고, 얻지 못하면 즉시 503 BUSY.
- 오류 본문은 코드 문자열만 `{"detail": CODE}`. 로그는 바이트 수·지속 ms·결과 코드·처리 ms만(글자·오디오 0).
- 처리 전체(디코딩·VAD·STT)는 스레드풀에서 돌려 이벤트 루프(`/health`·`/embed`)를 막지 않는다.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from ml_worker.speech.body import read_capped
from ml_worker.speech.decoder import SAMPLE_RATE, decode_to_pcm16k
from ml_worker.speech.limits import Deadline, SpeechError, SpeechGate, failed, loading, busy

logger = logging.getLogger("ml_worker")


def _error(err: SpeechError) -> JSONResponse:
    return JSONResponse({"detail": err.code}, status_code=err.status_code)


def register_speech_routes(
    app: FastAPI,
    cfg: Any,
    get_transcriber: Callable[[], Any],
    get_vad: Callable[[], Any],
) -> SpeechGate:
    gate = SpeechGate(cfg.stt_max_concurrency)

    def _work(payload: bytes, transcriber: Any, vad: Any) -> dict:
        """스레드풀 작업 — 슬롯 해제와 버퍼 참조 해제를 이 함수가 책임진다(요청 취소와 무관)."""
        try:
            deadline = Deadline(cfg.stt_deadline_s)
            pcm = decode_to_pcm16k(payload, cfg.stt_max_audio_seconds, deadline)
            duration_ms = round(pcm.shape[0] * 1000 / SAMPLE_RATE)
            speech = vad.speech_only(pcm)
            if speech.shape[0] == 0:
                return {"modelId": transcriber.model_id, "text": "", "durationMs": duration_ms, "empty": True}
            deadline.check()
            result = transcriber.transcribe(speech, "ko", deadline)
            result = " ".join(result.split())  # 공백 정리만 — 나머지 후처리는 API(DD-131)
            return {
                "modelId": transcriber.model_id,
                "text": result,
                "durationMs": duration_ms,
                "empty": result == "",
            }
        finally:
            del payload
            gate.release()

    @app.post("/speech/transcribe")
    async def speech_transcribe(request: Request) -> JSONResponse:
        started = time.monotonic()
        transcriber, vad = get_transcriber(), get_vad()
        if transcriber is None or vad is None:
            return _error(loading())
        nbytes = 0
        code = "OK"
        try:
            payload = await read_capped(request, cfg.stt_max_audio_bytes)
            nbytes = len(payload)
            if not gate.try_acquire():
                raise busy()
            # 슬롯은 _work가 해제한다. 클라이언트가 끊어도 작업은 끝까지 돌고 슬롯을 돌려준다.
            task = asyncio.ensure_future(run_in_threadpool(_work, payload, transcriber, vad))
            del payload
            body = await asyncio.shield(task)
            if body["empty"]:
                code = "EMPTY"
            return JSONResponse(body)
        except SpeechError as err:
            code = err.code
            return _error(err)
        except Exception as exc:  # noqa: BLE001 — 예외 메시지는 입력을 담을 수 있어 로그·응답에 싣지 않는다
            code = f"FAILED:{type(exc).__name__}"
            return _error(failed())
        finally:
            elapsed_ms = round((time.monotonic() - started) * 1000)
            logger.info("speech/transcribe 처리: bytes=%d 결과=%s 처리ms=%d", nbytes, code, elapsed_ms)

    @app.get("/speech/health")
    def speech_health() -> dict:
        transcriber = get_transcriber()
        vad = get_vad()
        base = {
            "status": "loading" if transcriber is None else "ok",
            "backend": cfg.stt_backend.strip().lower(),
            "modelId": None if transcriber is None else transcriber.model_id,
            "device": cfg.stt_device if transcriber is None else transcriber.device,
            "computeType": cfg.stt_compute_type if transcriber is None else transcriber.compute_type,
            "vad": None if vad is None else vad.name,
            "maxConcurrency": cfg.stt_max_concurrency,
            "maxAudioSeconds": cfg.stt_max_audio_seconds,
            "warmedUp": False if transcriber is None else bool(getattr(transcriber, "warmed_up", True)),
        }
        return base

    return gate
