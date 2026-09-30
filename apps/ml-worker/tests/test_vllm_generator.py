"""No.37 `VllmGenerator` 단위시험 — 전부 `httpx.MockTransport`(네트워크 없음, 설계서 §15.3)."""
from __future__ import annotations

import json
import logging

import httpx
import pytest

from ml_worker.generator import (
    VllmGenerator,
    build_prompt,
    salvage_truncated_array,
    strip_think_blocks,
)

MODEL = "served-model"
BASE = "http://10.0.5.20:8000"


def _make(handler, *, base_url=BASE, api_key=None, **kw) -> VllmGenerator:
    return VllmGenerator(
        base_url=base_url,
        model_name=MODEL,
        api_key=api_key,
        max_new_tokens=2048,
        request_timeout_s=5,
        connect_timeout_s=2,
        warmup_timeout_s=10,
        target_cap=60,
        model_id=f"vllm:{MODEL}",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        **kw,
    )


def _ok_handler(content='["a 문장", "b 문장"]', finish="stop", seen=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if request.url.path.endswith("/v1/models"):
            return httpx.Response(200, json={"object": "list", "data": [{"id": MODEL}]})
        return httpx.Response(
            200, json={"choices": [{"message": {"role": "assistant", "content": content}, "finish_reason": finish}]}
        )

    return handler


def test_attributes_and_startup_success():
    g = _make(_ok_handler())
    assert (g.backend, g.profile, g.target_cap, g.model_id) == ("vllm", "standard", 60, f"vllm:{MODEL}")
    assert g.healthy() is True
    assert g.warmed_up is False


def test_model_missing_message_has_host_and_model_only():
    def handler(request):
        return httpx.Response(200, json={"data": [{"id": "other"}]})

    with pytest.raises(RuntimeError) as exc:
        _make(handler, base_url="https://gw.corp.local:8443/secret/path")
    msg = str(exc.value)
    assert MODEL in msg and "gw.corp.local:8443" in msg and "--served-model-name" in msg
    assert "secret/path" not in msg


def test_unreachable_server_fails_startup():
    def handler(request):
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(RuntimeError, match="연결할 수 없습니다"):
        _make(handler)


def test_non_200_and_unparsable_models_fail_startup():
    with pytest.raises(RuntimeError, match="HTTP 500"):
        _make(lambda r: httpx.Response(500, text="boom"))
    with pytest.raises(RuntimeError, match="해석"):
        _make(lambda r: httpx.Response(200, json={"nope": 1}))


def test_redirect_is_failure_not_followed():
    seen = []

    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(302, headers={"Location": "http://8.8.8.8/v1/models"})

    with pytest.raises(RuntimeError, match="리다이렉트"):
        _make(handler)
    assert seen == [f"{BASE}/v1/models"]


def test_default_client_disables_redirects_and_unreachable_fails_boot():
    """client 미주입(운영 경로)이면 follow_redirects=False 클라이언트를 직접 만든다(ED-7)."""
    captured = {}
    real_client = httpx.Client

    class Spy(real_client):
        def __init__(self, *args, **kwargs):
            captured["follow_redirects"] = kwargs.get("follow_redirects")
            super().__init__(*args, **kwargs)

    import ml_worker.generator as gen_module

    mp = pytest.MonkeyPatch()
    mp.setattr(gen_module, "httpx", None, raising=False)
    mp.undo()
    mp.setattr(httpx, "Client", Spy)
    try:
        with pytest.raises(RuntimeError, match="연결할 수 없습니다"):
            VllmGenerator(
                base_url="http://127.0.0.1:1",
                model_name=MODEL,
                api_key=None,
                max_new_tokens=8,
                request_timeout_s=1,
                connect_timeout_s=1,
                warmup_timeout_s=1,
                target_cap=1,
                model_id="x",
            )
    finally:
        mp.undo()
    assert captured["follow_redirects"] is False


def test_base_url_ending_with_v1_fails():
    with pytest.raises(RuntimeError, match="/v1"):
        _make(_ok_handler(), base_url="http://10.0.5.20:8000/v1")


def test_trailing_slash_and_path_prefix_supported():
    seen = []
    g = _make(_ok_handler(seen=seen), base_url="https://gw.corp.local/vllm/")
    g.generate(["시드"], 2)
    assert [r.url.path for r in seen] == ["/vllm/v1/models", "/vllm/v1/chat/completions"]


def test_generate_sends_chat_request_with_same_prompt_as_build_prompt():
    seen = []
    g = _make(_ok_handler(seen=seen))
    assert g.generate(["환불 규정 안내"], 3) == ["a 문장", "b 문장"]
    body = json.loads(seen[-1].content)
    assert body["model"] == MODEL
    assert body["messages"] == [{"role": "user", "content": build_prompt(["환불 규정 안내"], 3)}]
    assert body["max_tokens"] == 2048 and body["stream"] is False


def test_authorization_header_only_when_key_present():
    seen = []
    _make(_ok_handler(seen=seen), api_key="k-123").generate(["x"], 1)
    assert all(r.headers["authorization"] == "Bearer k-123" for r in seen)
    seen.clear()
    _make(_ok_handler(seen=seen)).generate(["x"], 1)
    assert all("authorization" not in r.headers for r in seen)


def test_failures_return_empty_list():
    def make(gen_handler):
        def handler(request):
            if request.url.path == "/v1/models":
                return httpx.Response(200, json={"data": [{"id": MODEL}]})
            return gen_handler(request)

        return _make(handler)

    assert make(lambda r: httpx.Response(500, json={})).generate(["x"], 1) == []
    assert make(lambda r: httpx.Response(302, headers={"Location": "http://x"})).generate(["x"], 1) == []
    assert make(lambda r: httpx.Response(200, json={"choices": []})).generate(["x"], 1) == []
    assert make(lambda r: httpx.Response(200, text="not json")).generate(["x"], 1) == []
    assert make(lambda r: httpx.Response(200, json={"choices": [{"message": {"content": None}}]})).generate(["x"], 1) == []

    def timeout(request):
        raise httpx.ReadTimeout("t", request=request)

    assert make(timeout).generate(["x"], 1) == []


def test_failure_log_has_no_url_path_or_body(caplog):
    def handler(request):
        if request.url.path.endswith("/v1/models"):
            return httpx.Response(200, json={"data": [{"id": MODEL}]})
        return httpx.Response(401, text="echo: 시드원문-SECRET")

    g = _make(handler, base_url="http://10.0.5.20:8000/private/prefix")
    with caplog.at_level(logging.WARNING):
        assert g.generate(["시드원문-SECRET"], 1) == []
    assert "private/prefix" not in caplog.text and "SECRET" not in caplog.text
    assert "10.0.5.20:8000" in caplog.text


def test_length_finish_reason_salvages_closed_elements():
    g = _make(_ok_handler(content='["환불 규정 좀 알려줘", "환불 조건이', finish="length"))
    assert g.generate(["x"], 5) == ["환불 규정 좀 알려줘"]


def test_think_block_removed():
    g = _make(_ok_handler(content='<think>생각 ["가짜"]</think>\n["진짜 문장"]'))
    assert g.generate(["x"], 1) == ["진짜 문장"]


def test_warmup_sets_flag_only_when_result_nonempty():
    g = _make(_ok_handler())
    g.warmup()
    assert g.warmed_up is True
    g2 = _make(_ok_handler(content="[]"))
    g2.warmup()
    assert g2.warmed_up is False


def test_strip_think_and_salvage_pure_functions():
    assert strip_think_blocks("<think>a</think>X<think>b\nc</think>Y") == "XY"
    assert strip_think_blocks('앞<think>닫히지 않음 ["z"]') == "앞"
    assert strip_think_blocks('생각중</think>["a"]') == '["a"]'
    assert salvage_truncated_array('["a", "b"]') == ["a", "b"]
    assert salvage_truncated_array('```json\n["a", "b", "c') == ["a", "b"]
    assert salvage_truncated_array('["a", ') == ["a"]
    assert salvage_truncated_array('["a", "b\\"c", "d') == ["a", 'b"c']
    assert salvage_truncated_array("1. 하나\n2. 둘") == ["하나", "둘"]
