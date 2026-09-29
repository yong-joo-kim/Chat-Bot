"""ml-worker 환경변수. 전부 apps/ml-worker/.env 위치(설계서 §13).

`modelId` 규약(DD-69): `<model-name>@<rev>|<prefix-rule>|<norm-rule>`.
임계값은 모델뿐 아니라 프리픽스·정규화 규약에도 종속되므로, 이 셋 중 하나라도 바뀌면
modelId 문자열이 바뀌어 apps/api 쪽 기존 벡터가 자동으로 무효화된다(FR-N1-4, AC-N1-11).
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ml_worker_host: str = "0.0.0.0"
    ml_worker_port: int = 8100

    # "mock" 이면 실제 모델을 로드하지 않고 결정론적 해시 벡터를 반환한다.
    # 골든셋 실측(§ eval/goldenset)으로 확정된 1순위 모델을 기본값으로 둔다.
    embedding_model_id: str = "nlpai-lab/KURE-v1"
    embedding_model_revision: str = "main"
    embedding_device: str = "cpu"  # cpu | cuda (ADR-0024 §5)
    embedding_prefix_rule: str = "noprefix"  # noprefix | e5
    embedding_norm_rule: str = "l2"  # l2 고정 (FR-N1-5)
    embedding_max_seq_length: int = 128  # CPU 지연 완화 1단계 (설계서 §8.1)
    embedding_batch_max: int = 64  # 배치 상한 (설계서 §4.2)
    mock_dimension: int = 64  # embedding_model_id == "mock" 일 때만 사용

    # ── No.16 증강 생성 프로파일(ADR-0026 §5, DD-101) ────────────────────────────────
    # embed(기본) | augment | both. `/embed`·`/health` 계약은 role과 무관하게 항상 바이트
    # 단위로 동일하다(FR-L2-37) — role은 어떤 모델이 메모리에 올라가는지만 결정한다.
    ml_worker_role: str = "embed"
    # "mock"이면 실제 생성모델을 로드하지 않는다(§eval/generation_candidates.py로 실측 확정 전 기본값).
    generation_model_id: str = "mock"
    generation_model_revision: str = "main"
    generation_device: str = "cuda"  # ADR-0026 §5 — 생성은 GPU 권장(24GB+ VRAM 전제)
    generation_max_new_tokens: int = 512
    # 시드 20건 → 후보 target_count건을 1회 배치로 만든다(§5.3 "문장별 호출 금지").
    generation_target_count_max: int = 60
    generation_seeds_max: int = 20

    # ── No.17 파이프라인 검증 전용 백엔드 선택(`docs/requirements/nlg-bot-to-bot.md` FR-NG2,
    # dev-pipeline-validation, 2026-09-29) ──────────────────────────────────────────────
    # "transformers"(기본값 — 위 GENERATION_* 그대로, HFCausalLMGenerator 경로. 동작 무변화)
    # | "ollama" — 별도 Ollama 서버(HTTP API)에 위탁한다. ⚠ Ollama 경로는 개발·시연용 소형
    # 양자화 모델(3050 4GB에서도 도는) 파이프라인 흐름 검증 전용이다. G3 후보 3종(8B~32B급,
    # L40S 실측 대상 — `eval/report/generation-model-comparison.md`)의 대체가 아니다.
    generation_backend: str = "transformers"  # transformers | ollama
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3:4b-instruct-2507-q4_K_M"
    # ml-worker 자신의 HTTP 클라이언트 타임아웃. apps/api 쪽 AUGMENTATION_TIMEOUT_MS(기본
    # 30초)와는 별개 값이다 — 실측 결과(§ eval/report/ollama-dev-pipeline-validation.md)
    # 운영 조건(후보 60건)에서 30~44초가 걸려 API 쪽 30초 예산을 넘기는 경우가 관찰됐다.
    # ml-worker 자신은 더 오래 기다려 완주를 시도하고, API는 그 사이 자체적으로 G1로
    # 폴백한다(NFR-NGR1 — 이 값이 API 타임아웃보다 길어도 안전하다).
    ollama_request_timeout_s: float = 90.0
    ollama_connect_timeout_s: float = 5.0

    @property
    def is_ollama_backend(self) -> bool:
        return self.generation_backend.strip().lower() == "ollama"

    @property
    def is_mock(self) -> bool:
        return self.embedding_model_id.strip().lower() == "mock"

    @property
    def loads_embedding(self) -> bool:
        return self.ml_worker_role in ("embed", "both")

    @property
    def loads_generation(self) -> bool:
        return self.ml_worker_role in ("augment", "both")

    @property
    def is_generation_mock(self) -> bool:
        return self.generation_model_id.strip().lower() == "mock"

    @property
    def resolved_generation_model_id(self) -> str:
        return f"{self.generation_model_id}@{self.generation_model_revision}"

    @property
    def resolved_model_id(self) -> str:
        """공개 modelId 문자열. mock 모드에서는 임베더가 자체 문자열을 준다."""
        return (
            f"{self.embedding_model_id}@{self.embedding_model_revision}"
            f"|{self.embedding_prefix_rule}|{self.embedding_norm_rule}"
        )


settings = Settings()
