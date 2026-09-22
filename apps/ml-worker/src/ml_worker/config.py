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

    @property
    def is_mock(self) -> bool:
        return self.embedding_model_id.strip().lower() == "mock"

    @property
    def resolved_model_id(self) -> str:
        """공개 modelId 문자열. mock 모드에서는 임베더가 자체 문자열을 준다."""
        return (
            f"{self.embedding_model_id}@{self.embedding_model_revision}"
            f"|{self.embedding_prefix_rule}|{self.embedding_norm_rule}"
        )


settings = Settings()
