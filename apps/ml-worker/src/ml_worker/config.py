"""ml-worker 환경변수. 전부 apps/ml-worker/.env 위치(설계서 §13).

`modelId` 규약(DD-69): `<model-name>@<rev>|<prefix-rule>|<norm-rule>`.
임계값은 모델뿐 아니라 프리픽스·정규화 규약에도 종속되므로, 이 셋 중 하나라도 바뀌면
modelId 문자열이 바뀌어 apps/api 쪽 기존 벡터가 자동으로 무효화된다(FR-N1-4, AC-N1-11).
"""
from __future__ import annotations

from pydantic import SecretStr
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

    # ── 생성 백엔드 선택(No.17 FR-NG2 → No.37 확장, ADR-0046) ────────────────────────────
    # "transformers"(기본값 — 위 GENERATION_* 그대로, HFCausalLMGenerator 경로. 동작 무변화)
    # | "ollama" — 별도 Ollama 서버에 위탁. **경량 설치 구성(No.37) — 동작 보장·품질 미보증**,
    #   G3 후보 3종(8B~32B급, L40S 실측 대상)의 대체가 아니다(운영 채택 판정은 No.17).
    # | "vllm" — 생성 전용 사내 vLLM 서버(OpenAI 호환 /v1/chat/completions)에 위탁(운영 구성).
    # 그 외 값은 생성 프로세스 기동 실패(`app._load_generator`가 검사 — 임베딩 전용 프로세스는 영향 없음).
    generation_backend: str = "transformers"  # transformers | ollama | vllm
    # 워밍업 1회 요청에만 적용되는 시간 제한(모델 적재 시간 흡수).
    generation_warmup_timeout_s: float = 120.0
    # 루프백·사설 대역 밖 주소를 쓰려면 여기에 명시(콤마 구분, host | host:port | *.suffix).
    generation_backend_allowed_hosts: str = ""
    # true면 루프백·사설 대역도 목록에 있어야 한다(거버넌스 모드 설치 권장).
    generation_backend_require_allowlist: bool = False

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3:4b-instruct-2507-q4_K_M"
    # 원격 요청 시간 제한 — apps/api의 AUGMENTATION_TIMEOUT_MS(기본 30초)보다 먼저 포기하도록
    # 25초로 둔다(P-9: API가 포기한 뒤에도 생성이 계속되는 헛일 축소). 30초 초과는 기동 경고.
    ollama_request_timeout_s: float = 25.0
    ollama_connect_timeout_s: float = 5.0
    # 미설정이면 GENERATION_MAX_NEW_TOKENS를 명시 설정했을 때 그 값, 아니면 768
    # (`resolved_ollama_max_new_tokens`). 3050 조건 A(20건·768토큰)에서 출발한 값.
    ollama_max_new_tokens: int | None = None
    # 경량 구성 1회 생성 상한(P-3). 1~generation_target_count_max.
    # 미설정이면 min(20, GENERATION_TARGET_COUNT_MAX) — `resolved_ollama_target_cap`.
    ollama_target_cap: int | None = None

    vllm_base_url: str = ""  # 서버 루트(끝 /v1 금지). vllm이면 필수
    vllm_model: str = ""  # vLLM --served-model-name. vllm이면 필수
    vllm_api_key: SecretStr | None = None  # 비밀값 — repr/로그/상태에 노출 금지(ED-8)
    vllm_request_timeout_s: float = 25.0
    vllm_connect_timeout_s: float = 5.0
    vllm_max_new_tokens: int = 2048  # No.17 운영 실측 후 확정
    # 미설정이면 계약 상한(GENERATION_TARGET_COUNT_MAX)을 따른다 — No.17 실측 전까지 절삭 효과 없음.
    vllm_target_cap: int | None = None

    # ── No.21 묶음 이름 제안(POST /cluster-label — 생성 프로파일 전용, 설계서 §16.4) ─────────────
    # 이름 1개(JSON {"name": ...})면 충분하므로 증강보다 훨씬 작은 토큰 상한을 쓴다.
    cluster_label_max_new_tokens: int = 64

    @property
    def normalized_generation_backend(self) -> str:
        return self.generation_backend.strip().lower()

    @property
    def resolved_ollama_target_cap(self) -> int:
        if self.ollama_target_cap is not None:
            return self.ollama_target_cap
        return min(20, self.generation_target_count_max)

    @property
    def resolved_vllm_target_cap(self) -> int:
        if self.vllm_target_cap is not None:
            return self.vllm_target_cap
        return self.generation_target_count_max

    @property
    def resolved_ollama_max_new_tokens(self) -> int:
        if self.ollama_max_new_tokens is not None:
            return self.ollama_max_new_tokens
        if "generation_max_new_tokens" in self.model_fields_set:
            return self.generation_max_new_tokens
        return 768

    @property
    def is_ollama_backend(self) -> bool:
        return self.normalized_generation_backend == "ollama"

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
