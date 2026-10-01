"""요청 본문을 원시 바이트로만 받는다(UploadFile/multipart/Pydantic 본문 금지 — C-3, VO-3)."""
from __future__ import annotations

from fastapi import Request

from ml_worker.speech.limits import too_large


async def read_capped(request: Request, max_bytes: int) -> bytes:
    """Content-Length 사전 검사 + 스트림 누적 상한. 초과하면 즉시 TOO_LARGE(나머지 본문은 읽지 않는다)."""
    header = request.headers.get("content-length")
    if header is not None:
        try:
            declared = int(header)
        except ValueError:
            declared = 0  # 잘못된 헤더 — 아래 누적 상한이 방어한다
        if declared > max_bytes:
            raise too_large()
    buf = bytearray()
    async for chunk in request.stream():
        buf += chunk
        if len(buf) > max_bytes:
            raise too_large()
    return bytes(buf)
