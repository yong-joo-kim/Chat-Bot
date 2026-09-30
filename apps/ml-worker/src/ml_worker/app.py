"""apps/ml-worker — ML 추론 서비스 (ADR-0024 갱신, ADR-0026 §5).

기본 프로파일(`ML_WORKER_ROLE=embed`)은 종전과 100% 동일한 임베딩 추론 서비스다.
계약(설계서 §4.2):
  POST /embed  { texts: string[], kind: 'QUERY' | 'PASSAGE' } -> { modelId, dimension, vectors }
  GET  /health -> { status, modelId, dimension, device, warmedUp }

선택적 생성 프로파일(`ML_WORKER_ROLE=augment|both`)은 No.16 증강(G3)의 `POST /augment`를
추가로 노출한다(설계서 §5.2). `embed` 프로파일(기본값)에서는 이 경로가 **존재하지 않는다**(404) —
`/embed`·`/health` 계약은 role과 무관하게 바이트 단위로 동일하다(FR-L2-37).

생성 백엔드는 `GENERATION_BACKEND`로 transformers | ollama(경량 설치 구성) | vllm(운영 구성) 중
하나를 고른다(No.37, ADR-0046). 원격 2종은 기동 시 주소 검사(루프백·사설·허용 목록)를 거치고
`/augment`는 백엔드별 1회 생성 상한으로 절삭한다. `/augment` 요청·응답 계약은 불변이다.

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

from ml_worker.backend_guard import assert_backend_url_allowed, is_loopback_url
from ml_worker.config import settings
from ml_worker.embedder import Embedder, MockEmbedder, SentenceTransformerEmbedder
from ml_worker.generator import (
    Generator,
    HFCausalLMGenerator,
    MockGenerator,
    OllamaGenerator,
    VllmGenerator,
)

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


_GENERATION_BACKENDS = ("transformers", "ollama", "vllm")
_API_TIMEOUT_S = 30.0  # apps/api AUGMENTATION_TIMEOUT_MS 기본값 — 이보다 길면 헛일 경고(설계서 §10)


def _validate_remote_settings(backend: str) -> tuple[str, float, float, int, int]:
    """원격 백엔드(ollama|vllm) 필수값·범위 검사(설계서 §5.3). 실패 시 RuntimeError로 기동 실패.
    반환: (base_url, request_timeout_s, connect_timeout_s, max_new_tokens, target_cap)."""
    cap_max = settings.generation_target_count_max
    if backend == "vllm":
        base_url = settings.vllm_base_url.strip()
        if not base_url:
            raise RuntimeError("GENERATION_BACKEND=vllm이면 VLLM_BASE_URL이 필요합니다.")
        if not settings.vllm_model.strip():
            raise RuntimeError("GENERATION_BACKEND=vllm이면 VLLM_MODEL이 필요합니다.")
        if base_url.rstrip("/").endswith("/v1"):
            raise RuntimeError("VLLM_BASE_URL 끝의 /v1을 빼고 적으세요(코드가 /v1/... 경로를 붙입니다).")
        request_s, connect_s = settings.vllm_request_timeout_s, settings.vllm_connect_timeout_s
        max_tokens, cap, cap_key = settings.vllm_max_new_tokens, settings.resolved_vllm_target_cap, "VLLM_TARGET_CAP"
        timeout_key = "VLLM_REQUEST_TIMEOUT_S"
    else:
        base_url = settings.ollama_base_url.strip()
        request_s, connect_s = settings.ollama_request_timeout_s, settings.ollama_connect_timeout_s
        max_tokens, cap, cap_key = (
            settings.resolved_ollama_max_new_tokens,
            settings.resolved_ollama_target_cap,
            "OLLAMA_TARGET_CAP",
        )
        timeout_key = "OLLAMA_REQUEST_TIMEOUT_S"
    if not 1 <= cap <= cap_max:
        raise RuntimeError(f"{cap_key}={cap}은 1~{cap_max}(GENERATION_TARGET_COUNT_MAX) 범위여야 합니다.")
    if request_s <= 0 or connect_s <= 0 or settings.generation_warmup_timeout_s <= 0:
        raise RuntimeError("생성 백엔드 시간 제한(*_TIMEOUT_S)은 0보다 커야 합니다.")
    if max_tokens <= 0:
        raise RuntimeError("생성 백엔드 최대 토큰 수(*_MAX_NEW_TOKENS)는 0보다 커야 합니다.")
    if request_s > _API_TIMEOUT_S:
        logger.warning(
            "%s=%s가 30초보다 깁니다 — API AUGMENTATION_TIMEOUT_MS(기본 30초)보다 길면 API가 포기한 뒤에도 "
            "생성이 계속됩니다(API 값을 올렸다면 그 값 - 5초 이하로 맞추세요).",
            timeout_key,
            request_s,
        )
    return base_url, request_s, connect_s, max_tokens, cap


def _host_only(url: str) -> str:
    from urllib.parse import urlsplit

    parts = urlsplit(url)
    return (parts.hostname or "?") + (f":{parts.port}" if parts.port else "")


def _load_generator() -> Generator:
    # 생성 백엔드 3종(transformers | ollama | vllm) 교체 지점 1곳(No.37, 설계서 §4.4). 값 검사를
    # 이 함수 첫 줄에 두어 임베딩 전용 프로세스(`loads_generation` 거짓)는 영향받지 않는다(NFR-EDR2).
    backend = settings.normalized_generation_backend
    if backend not in _GENERATION_BACKENDS:
        raise RuntimeError(
            f"알 수 없는 GENERATION_BACKEND 값: '{settings.generation_backend}' — transformers | ollama | vllm 중 하나여야 합니다."
        )

    if backend in ("ollama", "vllm"):
        base_url, request_s, connect_s, max_tokens, cap = _validate_remote_settings(backend)
        # 주소 검사는 생성기 생성(=네트워크 연결) 전에 실행한다(ED-11).
        assert_backend_url_allowed(
            base_url,
            settings.generation_backend_allowed_hosts,
            settings.generation_backend_require_allowlist,
        )
        generator: Generator
        if backend == "vllm":
            raw_key = settings.vllm_api_key.get_secret_value().strip() if settings.vllm_api_key else ""
            if raw_key and base_url.lower().startswith("http://") and not is_loopback_url(base_url):
                logger.warning(
                    "VLLM_API_KEY가 설정됐지만 VLLM_BASE_URL이 루프백이 아닌 http입니다(%s) — "
                    "키가 평문으로 전송됩니다. https 또는 사내 게이트웨이 TLS를 검토하세요.",
                    _host_only(base_url),
                )
            generator = VllmGenerator(
                base_url=base_url,
                model_name=settings.vllm_model.strip(),
                api_key=raw_key or None,
                max_new_tokens=max_tokens,
                request_timeout_s=request_s,
                connect_timeout_s=connect_s,
                warmup_timeout_s=settings.generation_warmup_timeout_s,
                target_cap=cap,
                model_id=f"vllm:{settings.vllm_model.strip()}",
                label_max_new_tokens=settings.cluster_label_max_new_tokens,
            )
        else:
            generator = OllamaGenerator(
                base_url=base_url,
                model_name=settings.ollama_model,
                max_new_tokens=max_tokens,
                request_timeout_s=request_s,
                connect_timeout_s=connect_s,
                model_id=f"ollama:{settings.ollama_model}",
                target_cap=cap,
                warmup_timeout_s=settings.generation_warmup_timeout_s,
                label_max_new_tokens=settings.cluster_label_max_new_tokens,
            )
        generator.warmup()  # type: ignore[attr-defined]
        logger.info(
            "생성 백엔드=%s 구성=%s 모델=%s 호스트=%s 1회 상한=%s",
            generator.backend,
            generator.profile,
            generator.model_id,
            _host_only(base_url),
            generator.target_cap,
        )
        if generator.profile == "lightweight":
            logger.warning("경량 설치 구성: 동작 보장·품질 미보증 (운영 G3 채택 판정은 No.17)")
        return generator

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
        label_max_new_tokens=settings.cluster_label_max_new_tokens,
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
    # No.37 선택 필드 — API zod 스키마는 모르는 키를 버리므로 API 동작에는 영향이 없다.
    backend: Literal["transformers", "ollama", "vllm"] | None = None
    profile: Literal["standard", "lightweight"] | None = None
    targetCap: int | None = None


def _augment_device() -> str:
    """원격 백엔드(ollama|vllm)는 연산이 외부 서빙 엔진에서 일어나므로 `cuda`를 사실처럼 쓰지 않는다."""
    if settings.normalized_generation_backend in ("ollama", "vllm"):
        return "external"
    return settings.generation_device


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

        # 백엔드별 1회 생성 상한 절삭(No.37 P-3/P-6) — 계약 상한 400 검사(위)는 그대로 먼저 돈다.
        cap = generator.target_cap or settings.generation_target_count_max
        effective = min(req.targetCount, cap)
        if effective < req.targetCount:
            logger.info("targetCount 절삭: 요청 %s -> 적용 %s (백엔드 상한)", req.targetCount, effective)
        candidates = generator.generate(req.seeds, effective)
        if generator.target_cap is not None:
            # 원격 백엔드만 결과 절단(API 후보 임베딩 배치 상한 초과 차단). transformers/mock 경로는 무변경.
            candidates = candidates[:effective]
        return AugmentResponse(modelId=generator.model_id, candidates=candidates)

    @app.get("/augment/health", response_model=AugmentHealthResponse)
    def augment_health() -> AugmentHealthResponse:
        backend = settings.normalized_generation_backend
        known_backend = backend if backend in _GENERATION_BACKENDS else None
        if _generator is None:
            return AugmentHealthResponse(
                status="loading", device=_augment_device(), warmedUp=False, backend=known_backend
            )
        warmed_up = getattr(_generator, "warmed_up", True)
        return AugmentHealthResponse(
            status="ok",
            modelId=_generator.model_id,
            device=_augment_device(),
            warmedUp=warmed_up,
            backend=_generator.backend,  # type: ignore[arg-type]
            profile=_generator.profile,  # type: ignore[arg-type]
            targetCap=_generator.target_cap or settings.generation_target_count_max,
        )

    # ── No.21 발화 묶음 분석의 묶음 이름 제안(설계서 §16.4). 생성 프로파일에서만 존재한다 — 기능 본체는
    # 이 경로 없이도 성립한다(꺼짐·실패 = label null). 로그에는 키워드·문장을 남기지 않는다(건수만).
    class ClusterLabelRequest(BaseModel):
        keywords: list[str]
        samples: list[str]
        locale: Literal["ko"]

    class ClusterLabelResponse(BaseModel):
        modelId: str
        label: str | None

    @app.post("/cluster-label", response_model=ClusterLabelResponse)
    def cluster_label(req: ClusterLabelRequest) -> ClusterLabelResponse:
        # 상한 초과는 /augment와 같이 400(Pydantic 기본 422가 아니라 명시 검사).
        if not 1 <= len(req.keywords) <= 20:
            raise HTTPException(status_code=400, detail=f"keywords 개수는 1~20이어야 합니다: {len(req.keywords)}")
        if len(req.samples) > 5:
            raise HTTPException(status_code=400, detail=f"samples 개수 상한 초과: {len(req.samples)} > 5")
        if any(not 1 <= len(k) <= 30 or not k.strip() for k in req.keywords):
            raise HTTPException(status_code=400, detail="keywords 각 항목은 1~30자의 비어 있지 않은 문자열이어야 합니다")
        if any(not 1 <= len(s) <= 300 or not s.strip() for s in req.samples):
            raise HTTPException(status_code=400, detail="samples 각 항목은 1~300자의 비어 있지 않은 문자열이어야 합니다")

        try:
            generator = get_generator()
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        label = generator.label(req.keywords, req.samples)
        logger.info("cluster-label 처리: keywords=%d samples=%d 결과=%s", len(req.keywords), len(req.samples), "있음" if label else "없음")
        return ClusterLabelResponse(modelId=generator.model_id, label=label)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("ml_worker.app:app", host=settings.ml_worker_host, port=settings.ml_worker_port)
