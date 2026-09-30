"""테스트는 전부 mock 임베더로 돈다 — 실제 모델 다운로드·GPU 없이 계약(HTTP 스키마·
배치 상한·헬스체크)을 검증한다. 매칭 품질 실측은 eval/sweep_thresholds.py의 책임이다."""
import os

os.environ["EMBEDDING_MODEL_ID"] = "mock"
os.environ["EMBEDDING_DEVICE"] = "cpu"


# ── No.37 가짜 생성 백엔드 서버(설계서 §15.2) ─────────────────────────────────────────
# 127.0.0.1 임시 포트의 ThreadingHTTPServer. vLLM(/v1/models·/v1/chat/completions)과
# Ollama(/api/tags·/api/generate) 경로를 함께 흉내 낸다. 시험이 시나리오 스위치를 바꾸고
# `requests`에 쌓인 요청(경로·헤더·JSON 본문)으로 단언한다.
import json as _json
import threading
import time as _time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


class FakeBackend:
    def __init__(self) -> None:
        self.models: list[str] = ["fake-model"]  # 빈 목록 = 모델 없음
        self.content = _json.dumps(["문장 하나", "문장 둘"], ensure_ascii=False)
        self.finish_reason = "stop"
        self.status = 200
        self.delay_s = 0.0
        self.redirect_to: str | None = None
        self.required_key: str | None = None
        self.requests: list[dict] = []
        self.content_fn = None  # (targetCount) -> str, 설정 시 content 대신 사용
        self._server: ThreadingHTTPServer | None = None

    @property
    def base_url(self) -> str:
        assert self._server is not None
        return f"http://127.0.0.1:{self._server.server_address[1]}"

    def start(self) -> "FakeBackend":
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):  # noqa: D401 - 조용히
                pass

            def _send(self, code: int, body: dict | None = None, headers: dict | None = None) -> None:
                raw = _json.dumps(body or {}, ensure_ascii=False).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(raw)

            def _record(self) -> dict | None:
                length = int(self.headers.get("Content-Length") or 0)
                body = _json.loads(self.rfile.read(length)) if length else None
                outer.requests.append({"path": self.path, "headers": dict(self.headers), "json": body})
                return body

            def _guard(self) -> bool:
                if outer.redirect_to:
                    self._send(302, {}, {"Location": outer.redirect_to})
                    return False
                if outer.required_key and self.headers.get("Authorization") != f"Bearer {outer.required_key}":
                    self._send(401, {"error": "unauthorized"})
                    return False
                return True

            def do_GET(self):  # noqa: N802
                self._record()
                if not self._guard():
                    return
                if self.path == "/v1/models":
                    self._send(200, {"object": "list", "data": [{"id": m} for m in outer.models]})
                elif self.path == "/api/tags":
                    self._send(200, {"models": [{"model": m, "name": m} for m in outer.models]})
                else:
                    self._send(404)

            def do_POST(self):  # noqa: N802
                body = self._record()
                if not self._guard():
                    return
                if outer.delay_s:
                    _time.sleep(outer.delay_s)
                if outer.status != 200:
                    self._send(outer.status, {"error": "boom"})
                    return
                if outer.content_fn is not None:
                    target = 0
                    if self.path == "/v1/chat/completions":
                        target = _json.loads(body["messages"][0]["content"].split("\n\n", 1)[1])["targetCount"]
                    else:
                        target = _json.loads(body["prompt"].split("\n\n", 1)[1])["targetCount"]
                    content = outer.content_fn(target)
                else:
                    content = outer.content
                if self.path == "/v1/chat/completions":
                    self._send(
                        200,
                        {"choices": [{"message": {"role": "assistant", "content": content}, "finish_reason": outer.finish_reason}]},
                    )
                elif self.path == "/api/generate":
                    self._send(200, {"response": content, "done_reason": outer.finish_reason})
                else:
                    self._send(404)

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()

    def generate_requests(self) -> list[dict]:
        return [r for r in self.requests if r["path"] in ("/v1/chat/completions", "/api/generate")]

    @staticmethod
    def prompt_target_count(request: dict) -> int:
        body = request["json"]
        prompt = body["messages"][0]["content"] if "messages" in body else body["prompt"]
        return _json.loads(prompt.split("\n\n", 1)[1])["targetCount"]


@pytest.fixture()
def fake_backend():
    server = FakeBackend().start()
    try:
        yield server
    finally:
        server.stop()
