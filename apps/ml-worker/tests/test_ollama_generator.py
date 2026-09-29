"""No.17 파이프라인 검증(dev-pipeline-validation, `docs/requirements/nlg-bot-to-bot.md` FR-NG2)
— `OllamaGenerator` 어댑터 단위시험. 전부 `httpx.MockTransport`로 네트워크 없이 검증한다
(FR-0-258 — CI에 실제 Ollama 서버·모델 호출을 넣지 않는다).

⚠ 이 시험은 "파이프라인이 도는지"만 확인한다 — G3 후보 3종(8B~32B급, L40S 실측 대상)의
품질 채택 여부와 무관하다.
"""
from __future__ import annotations

import json

import httpx
import pytest

from ml_worker.generator import OllamaGenerator

MODEL_NAME = "qwen3:4b-instruct-2507-q4_K_M"


def _client_with(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_construction_succeeds_when_server_and_model_present():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/tags"
        return httpx.Response(200, json={"models": [{"model": MODEL_NAME, "name": MODEL_NAME}]})

    generator = OllamaGenerator(
        base_url="http://localhost:11434",
        model_name=MODEL_NAME,
        max_new_tokens=512,
        request_timeout_s=5,
        connect_timeout_s=2,
        model_id=f"ollama:{MODEL_NAME}",
        client=_client_with(handler),
    )
    assert generator.model_id == f"ollama:{MODEL_NAME}"
    assert generator.healthy() is True
    assert generator.warmed_up is False  # warmup()은 app.py가 별도로 호출한다(HFCausalLMGenerator와 동일 패턴)


def test_construction_matches_model_name_without_explicit_tag():
    """Ollama는 태그 없는 이름을 `:latest`로 취급한다 — 로컬 목록에 태그 없이 등록된
    경우도 매칭돼야 한다."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"models": [{"model": f"{MODEL_NAME}:latest"}]})

    generator = OllamaGenerator(
        base_url="http://localhost:11434",
        model_name=MODEL_NAME,
        max_new_tokens=512,
        request_timeout_s=5,
        connect_timeout_s=2,
        model_id=f"ollama:{MODEL_NAME}",
        client=_client_with(handler),
    )
    assert generator.model_id == f"ollama:{MODEL_NAME}"


def test_construction_raises_clear_error_when_model_missing():
    """C-8/R-5 방지 핵심 시험 — 서버는 있지만 모델이 없으면 mock으로 조용히 대체되지
    않고 명확한 오류(RuntimeError)로 기동이 실패해야 한다."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"models": [{"model": "other-model:latest"}]})

    with pytest.raises(RuntimeError, match="없습니다"):
        OllamaGenerator(
            base_url="http://localhost:11434",
            model_name=MODEL_NAME,
            max_new_tokens=512,
            request_timeout_s=5,
            connect_timeout_s=2,
            model_id="ollama:x",
            client=_client_with(handler),
        )


def test_construction_raises_clear_error_when_server_unreachable():
    """서버 연결 자체가 실패하는 경우도 명확한 오류로 남아야 한다(mock 대체 없음)."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    with pytest.raises(RuntimeError, match="연결할 수 없습니다"):
        OllamaGenerator(
            base_url="http://localhost:11434",
            model_name=MODEL_NAME,
            max_new_tokens=512,
            request_timeout_s=5,
            connect_timeout_s=2,
            model_id="ollama:x",
            client=_client_with(handler),
        )


def test_construction_raises_clear_error_on_non_200_tags_response():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="internal error")

    with pytest.raises(RuntimeError, match="응답 이상"):
        OllamaGenerator(
            base_url="http://localhost:11434",
            model_name=MODEL_NAME,
            max_new_tokens=512,
            request_timeout_s=5,
            connect_timeout_s=2,
            model_id="ollama:x",
            client=_client_with(handler),
        )


def _generator_with_generate_handler(handler) -> OllamaGenerator:
    def combined(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"model": MODEL_NAME}]})
        return handler(request)

    return OllamaGenerator(
        base_url="http://localhost:11434",
        model_name=MODEL_NAME,
        max_new_tokens=512,
        request_timeout_s=5,
        connect_timeout_s=2,
        model_id=f"ollama:{MODEL_NAME}",
        client=_client_with(combined),
    )


def test_generate_parses_json_array_response():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/generate"
        body = json.loads(request.content)
        assert body["model"] == MODEL_NAME
        assert body["stream"] is False
        return httpx.Response(
            200,
            json={
                "response": json.dumps(["환불 규정 좀 알려줘", "환불 조건이 뭐야?"], ensure_ascii=False),
                "done_reason": "stop",
            },
        )

    generator = _generator_with_generate_handler(handler)
    result = generator.generate(["환불 규정 안내"], 2)
    assert result == ["환불 규정 좀 알려줘", "환불 조건이 뭐야?"]


def test_generate_returns_empty_list_on_http_error_not_exception():
    """Generator 계약(C-1과 동등) — 실패 시 예외를 전파하지 않고 빈 배열로 수렴한다."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    generator = _generator_with_generate_handler(handler)
    result = generator.generate(["환불 규정 안내"], 2)
    assert result == []


def test_generate_returns_empty_list_on_network_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timeout", request=request)

    generator = _generator_with_generate_handler(handler)
    result = generator.generate(["환불 규정 안내"], 2)
    assert result == []


def test_generate_truncated_json_does_not_raise():
    """실측(§eval/report/ollama-dev-pipeline-validation.md)에서 확인된 실제 실패 모드 —
    num_predict 부족으로 JSON 배열이 중간에 잘리면(`done_reason=length`)
    `parse_candidate_array`가 예외 없이 무언가를 반환한다(품질 보장은 아님 — 검증 단계가
    걸러낸다). 여기서는 "예외를 던지지 않고 리스트를 반환한다"만 보장한다."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"response": '["환불 규정 좀 알려줘", "환불 조건이', "done_reason": "length"},
        )

    generator = _generator_with_generate_handler(handler)
    result = generator.generate(["환불 규정 안내"], 60)
    assert isinstance(result, list)
