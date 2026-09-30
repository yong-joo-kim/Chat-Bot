"""No.37 경량 구성 상한 절삭 시험(설계서 §7, AC-ED3-1) — 가짜 Ollama 서버(conftest `fake_backend`).

- `targetCount=60` -> 백엔드가 받은 프롬프트의 targetCount=20, 후보 <= 20, 400 아님.
- `targetCount=61` -> 계약 상한 400 유지(절삭보다 먼저).
- transformers mock 경로 응답은 종전과 동일.
- 상한 설정 범위 밖 기동 실패, `OLLAMA_MAX_NEW_TOKENS` 폴백 체인 3경우.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

import ml_worker.app as app_module
import ml_worker.config as config_module
from appenv import configure, reset_env


def teardown_function() -> None:
    reset_env()


def _ollama_env(server, **extra):
    env = {"GENERATION_BACKEND": "ollama", "OLLAMA_BASE_URL": server.base_url, "OLLAMA_MODEL": "fake-model"}
    env.update(extra)
    return env


def _many(target: int) -> str:
    # 모델이 요청보다 많이 내는 상황(상한 초과 결과 절단 검증)
    return json.dumps([f"문장 {i}" for i in range(target + 10)], ensure_ascii=False)


def test_target_60_is_truncated_to_20_for_backend_and_result(fake_backend):
    fake_backend.content_fn = _many
    configure("augment", **_ollama_env(fake_backend))
    with TestClient(app_module.app) as client:
        fake_backend.requests.clear()
        res = client.post("/augment", json={"seeds": ["환불 어떻게 하나요"], "targetCount": 60, "locale": "ko"})
        assert res.status_code == 200
        body = res.json()
        assert len(body["candidates"]) == 20
        assert body["modelId"] == "ollama:fake-model"
        sent = fake_backend.generate_requests()
        assert len(sent) == 1
        assert fake_backend.prompt_target_count(sent[0]) == 20


def test_target_below_cap_is_untouched(fake_backend):
    fake_backend.content_fn = _many
    configure("augment", **_ollama_env(fake_backend))
    with TestClient(app_module.app) as client:
        fake_backend.requests.clear()
        res = client.post("/augment", json={"seeds": ["환불"], "targetCount": 5, "locale": "ko"})
        assert len(res.json()["candidates"]) == 5
        assert fake_backend.prompt_target_count(fake_backend.generate_requests()[0]) == 5


def test_target_61_is_still_400(fake_backend):
    configure("augment", **_ollama_env(fake_backend))
    with TestClient(app_module.app) as client:
        res = client.post("/augment", json={"seeds": ["환불"], "targetCount": 61, "locale": "ko"})
        assert res.status_code == 400


def test_custom_cap_applies(fake_backend):
    fake_backend.content_fn = _many
    configure("augment", **_ollama_env(fake_backend, OLLAMA_TARGET_CAP="7"))
    with TestClient(app_module.app) as client:
        health = client.get("/augment/health").json()
        assert health["targetCap"] == 7
        res = client.post("/augment", json={"seeds": ["환불"], "targetCount": 30, "locale": "ko"})
        assert len(res.json()["candidates"]) == 7


def test_transformers_mock_path_is_unchanged():
    configure("both", GENERATION_MODEL_ID="mock")
    with TestClient(app_module.app) as client:
        res = client.post("/augment", json={"seeds": ["환불 어떻게 하나요"], "targetCount": 3, "locale": "ko"})
        assert res.status_code == 200
        assert res.json() == {
            "modelId": "mock-generator@0",
            "candidates": [
                "환불 어떻게 하나요 (로컬 생성 mock 1)",
                "환불 어떻게 하나요 (로컬 생성 mock 2)",
                "환불 어떻게 하나요 (로컬 생성 mock 3)",
            ],
        }
        health = client.get("/augment/health").json()
        assert health["backend"] == "transformers" and health["profile"] == "standard"
        assert health["targetCap"] == 60
        assert health["device"] == config_module.settings.generation_device  # 현행 그대로(K-4)


@pytest.mark.parametrize("cap", ["0", "61"])
def test_ollama_cap_out_of_range_fails_boot(fake_backend, cap):
    configure("augment", **_ollama_env(fake_backend, OLLAMA_TARGET_CAP=cap))
    with pytest.raises(RuntimeError, match="OLLAMA_TARGET_CAP"):
        with TestClient(app_module.app):
            pass


def test_ollama_max_new_tokens_fallback_chain(monkeypatch):
    # 로컬 .env 파일의 GENERATION_MAX_NEW_TOKENS 영향을 받지 않도록 env 파일을 끄고 판별한다.
    for key in ("GENERATION_MAX_NEW_TOKENS", "OLLAMA_MAX_NEW_TOKENS"):
        monkeypatch.delenv(key, raising=False)
    settings_cls = config_module.Settings
    # 1) 아무것도 없으면 768
    assert settings_cls(_env_file=None).resolved_ollama_max_new_tokens == 768
    # 2) GENERATION_MAX_NEW_TOKENS만 명시하면 그 값(기존 설치 보호)
    monkeypatch.setenv("GENERATION_MAX_NEW_TOKENS", "512")
    assert settings_cls(_env_file=None).resolved_ollama_max_new_tokens == 512
    # 3) OLLAMA_MAX_NEW_TOKENS가 있으면 그 값이 우선
    monkeypatch.setenv("OLLAMA_MAX_NEW_TOKENS", "900")
    assert settings_cls(_env_file=None).resolved_ollama_max_new_tokens == 900


def test_ollama_receives_resolved_max_new_tokens(fake_backend):
    configure("augment", **_ollama_env(fake_backend, OLLAMA_MAX_NEW_TOKENS="900"))
    with TestClient(app_module.app):
        pass
    sent = fake_backend.generate_requests()
    assert sent and sent[0]["json"]["options"]["num_predict"] == 900


def test_ollama_default_cap_follows_lowered_contract_max(fake_backend):
    configure("augment", **_ollama_env(fake_backend, GENERATION_TARGET_COUNT_MAX="10"))
    with TestClient(app_module.app) as client:
        assert client.get("/augment/health").json()["targetCap"] == 10


def test_result_truncation_not_applied_to_transformers_path():
    """원격 백엔드(target_cap 있음)만 결과를 절단한다 — transformers/mock 경로는 생성기 출력을 그대로 돌려준다."""
    configure("both", GENERATION_MODEL_ID="mock")
    with TestClient(app_module.app) as client:
        gen = app_module.get_generator()
        assert gen.target_cap is None
        gen.generate = lambda seeds, n: [f"문장 {i}" for i in range(n + 5)]  # type: ignore[method-assign]
        res = client.post("/augment", json={"seeds": ["환불"], "targetCount": 3, "locale": "ko"})
        assert len(res.json()["candidates"]) == 8
