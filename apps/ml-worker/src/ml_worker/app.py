"""apps/ml-worker — ML 추론 서비스 (ADR-0024 갱신, ADR-0026 §5).

기본 프로파일(`ML_WORKER_ROLE=embed`)은 종전과 100% 동일한 임베딩 추론 서비스다.
계약(설계서 §4.2):
  POST /embed  { texts: string[], kind: 'QUERY' | 'PASSAGE' } -> { modelId, dimension, vectors }
  GET  /health -> { status, modelId, dimension, device, warmedUp }

선택적 생성 프로파일(`ML_WORKER_ROLE=augment|both`)은 No.16 증강(G3)의 `POST /augment`를
추가로 노출한다(설계서 §5.2). `embed` 프로파일(기본값)에서는 이 경로가 **존재하지 않는다**(404) —
`/embed`·`/health` 계약은 role과 무관하게 바이트 단위로 동일하다(FR-L2-37).

학습(파인튜닝) 파이프라인·Job Queue는 여전히 두지 않는다(추론 전용 원칙 유지, ADR-0024/0027).
이 프로세스가 죽어도 apps/api는 저하 모드(규칙 매칭 / G1 증강)로 전환할 뿐 대화가 멈추지 않는다
(FR-0-44, FR-L1-7).
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from ml_worker.config import settings
from ml_worker.embedder import Embedder, MockEmbedder, SentenceTransformerEmbedder
from ml_worker.generator import Generator, HFCausalLMGenerator, MockGenerator

logger = logging.getLogger("ml_worker")

_embedder: Embedder | None = None
_generator: Generator | None = None


def get_embedder() -> Embedder:
    if _embedder is None:
        raise RuntimeError("embedder가 아직 초기화되지 않았습니다")
    return _embedder


def get_generator() -> Generator:
    if _generator is None:
        raise RuntimeError("generator가 아직 초기화되지 않았습니다")
    return _generator


def _load_model() -> Embedder:
    if settings.is_mock:
        logger.warning("EMBEDDING_MODEL_ID=mock — 결정론적 해시 벡터로 동작합니다(실제 매칭 품질 없음)")
        return MockEmbedder(dimension=settings.mock_dimension)

    logger.info("모델 로드 시작: %s (device=%s)", settings.embedding_model_id, settings.embedding_device)
    embedder = SentenceTransformerEmbedder(
        model_name=settings.embedding_model_id,
        revision=settings.embedding_model_revision,
        device=settings.embedding_device,
        prefix_rule=settings.embedding_prefix_rule,
        norm_rule=settings.embedding_norm_rule,
        max_seq_length=settings.embedding_max_seq_length,
        model_id=settings.resolved_model_id,
    )
    embedder.warmup()  # CPU 지연 완화 1단계 — 기동 시 1회 더미 인코딩
    logger.info("모델 로드 완료: %s (dim=%s)", embedder.model_id, embedder.dimension)
    return embedder


def _load_generator() -> Generator:
    if settings.is_generation_mock:
        logger.warning("GENERATION_MODEL_ID=mock — 결정론적 에코 문장으로 동작합니다(실제 생성 품질 없음)")
        return MockGenerator()

    logger.info(
        "생성모델 로드 시작: %s (device=%s) — 후보는 eval/generation_candidates.py 실측으로 확정할 것",
        settings.generation_model_id,
        settings.generation_device,
    )
    generator = HFCausalLMGenerator(
        model_name=settings.generation_model_id,
        revision=settings.generation_model_revision,
        device=settings.generation_device,
        max_new_tokens=settings.generation_max_new_tokens,
        model_id=settings.resolved_generation_model_id,
    )
    generator.warmup()
    logger.info("생성모델 로드 완료: %s", generator.model_id)
    return generator


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _embedder, _generator
    if settings.loads_embedding:
        _embedder = _load_model()
    if settings.loads_generation:
        _generator = _load_generator()
    yield
    _embedder = None
    _generator = None


app = FastAPI(title="Chat Bot ml-worker", version="0.1.0", lifespan=lifespan)


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1)
    kind: Literal["QUERY", "PASSAGE"]


class EmbedResponse(BaseModel):
    modelId: str
    dimension: int
    vectors: list[list[float]]


class HealthResponse(BaseModel):
    status: Literal["ok", "loading"]
    modelId: str | None = None
    dimension: int | None = None
    device: str
    warmedUp: bool


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest) -> EmbedResponse:
    if len(req.texts) > settings.embedding_batch_max:
        raise HTTPException(
            status_code=400,
            detail=f"배치 상한 초과: {len(req.texts)} > {settings.embedding_batch_max}",
        )
    if any(not t.strip() for t in req.texts):
        raise HTTPException(status_code=400, detail="빈 문자열은 임베딩할 수 없습니다")

    try:
        embedder = get_embedder()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    vectors = embedder.embed(req.texts, req.kind)
    return EmbedResponse(
        modelId=embedder.model_id,
        dimension=embedder.dimension,
        vectors=vectors.tolist(),
    )


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    if _embedder is None:
        return HealthResponse(status="loading", device=settings.embedding_device, warmedUp=False)
    warmed_up = getattr(_embedder, "warmed_up", True)
    return HealthResponse(
        status="ok",
        modelId=_embedder.model_id,
        dimension=_embedder.dimension,
        device=settings.embedding_device,
        warmedUp=warmed_up,
    )


class AugmentRequest(BaseModel):
    seeds: list[str] = Field(min_length=1)
    targetCount: int = Field(ge=1)
    locale: Literal["ko"]


class AugmentResponse(BaseModel):
    modelId: str
    candidates: list[str]


class AugmentHealthResponse(BaseModel):
    status: Literal["ok", "loading"]
    modelId: str | None = None
    device: str
    warmedUp: bool


# ── No.16 증강 생성 프로파일(ADR-0026 §5) — `ML_WORKER_ROLE=embed`(기본값)에서는 이 두 경로를
# 아예 등록하지 않는다. 그 경우 호출부는 FastAPI 기본 동작대로 404를 받는다(설계서 §5.1 —
# "생성 프로파일이 꺼져 있으면 POST /augment는 존재하지 않는다"). `/embed`·`/health`는 role과
# 무관하게 위에서 이미 항상 등록되어 있다(FR-L2-37 — 바이트 단위로 계약 불변).
if settings.loads_generation:

    @app.post("/augment", response_model=AugmentResponse)
    def augment(req: AugmentRequest) -> AugmentResponse:
        if len(req.seeds) > settings.generation_seeds_max:
            raise HTTPException(
                status_code=400,
                detail=f"시드 상한 초과: {len(req.seeds)} > {settings.generation_seeds_max}",
            )
        if req.targetCount > settings.generation_target_count_max:
            raise HTTPException(
                status_code=400,
                detail=f"targetCount 상한 초과: {req.targetCount} > {settings.generation_target_count_max}",
            )
        if any(not s.strip() for s in req.seeds):
            raise HTTPException(status_code=400, detail="빈 시드 문자열은 생성할 수 없습니다")

        try:
            generator = get_generator()
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        candidates = generator.generate(req.seeds, req.targetCount)
        return AugmentResponse(modelId=generator.model_id, candidates=candidates)

    @app.get("/augment/health", response_model=AugmentHealthResponse)
    def augment_health() -> AugmentHealthResponse:
        if _generator is None:
            return AugmentHealthResponse(status="loading", device=settings.generation_device, warmedUp=False)
        warmed_up = getattr(_generator, "warmed_up", True)
        return AugmentHealthResponse(
            status="ok",
            modelId=_generator.model_id,
            device=settings.generation_device,
            warmedUp=warmed_up,
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("ml_worker.app:app", host=settings.ml_worker_host, port=settings.ml_worker_port)
