# apps/ml-worker

FAQ/의도 매칭 1단계(NLU 의미 유사도) — **추론 전용** 문장 임베딩 서비스.

- 요구사항: `docs/requirements/nlu-rag-answering.md` (J-1, FR-N1-1~7)
- 설계: `docs/02-spec/nlu-rag-answering-설계.md` §4·§8
- 결정: `docs/02-spec/decisions/ADR-0024-ml-worker-scope-and-runtime.md`

학습 파이프라인·Job Queue·Redis는 두지 않는다. 이 프로세스가 죽어도 `apps/api`는
저하 모드(규칙 매칭)로 전환할 뿐 대화가 멈추지 않는다(FR-0-44).

## 기동

```bash
pnpm --filter ml-worker run setup   # .venv 생성 + 의존성 설치(최초 1회, 수 분 소요)
cp .env.example .env                # 필요 시 모델/포트 조정
pnpm --filter ml-worker run dev     # http://localhost:8100
pnpm --filter ml-worker run health  # GET /health 확인
```

`EMBEDDING_MODEL_ID=mock`으로 두면 실제 모델(수백 MB~수 GB) 없이도 계약만 검증할 수 있다.
CI·다른 개발자 환경이 Python/모델 파일에 묶이지 않게 하기 위한 경로다.

## API 계약

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/embed` | `{ texts: string[], kind: 'QUERY'\|'PASSAGE' }` → `{ modelId, dimension, vectors }`. 벡터는 L2 정규화 완료. 배치 상한(기본 64) 초과 시 400 |
| `GET` | `/health` | `{ status, modelId, dimension, device, warmedUp }` |

`apps/api`는 `EMBEDDING_BASE_URL`이 설정된 경우에만 이 서비스를 호출한다. 미설정 시
1단계 전체가 비활성이며 시스템은 현행 규칙 매칭으로 정상 동작한다(FR-0-46).

## 모델 선정 (P-1 "최고 성능" 목표)

`eval/report/*.md`에 후보별 실측 보고서가 있다. 요약과 최종 선정 근거는
`apps/ml-worker` 인계 보고서(작업 완료 시 ml-engineer가 남긴 보고) 및
`docs/02-spec/nlu-rag-answering-설계.md` §8.1을 참고할 것.

## 골든셋 임계값 스윕 (AC-N1-12)

```bash
pnpm --filter ml-worker run eval:sweep -- --model nlpai-lab/KURE-v1 --prefix-rule noprefix
# 또는 venv 직접 사용
.venv/Scripts/python.exe eval/sweep_thresholds.py --model mock   # 로직만 빠르게 점검
```

- 골든셋 100문항: `eval/goldenset/corpus.json`(색인 대상 41항목 + alt) / `cases.json`(매칭 60·되묻기 20·미매칭 20)
- 산출물: `eval/report/<model-slug>.md`(사람이 읽는 보고서) + `.json`(전체 그리드, 감사용)
- 판정 로직(`judge_band`)은 `ADR-0021`의 3구간+격차 조건을 오프라인 평가용으로 재현한 것이다.
  실제 런타임 소스 오브 트루스는 `packages/dialogue-engine/src/semantic.ts`(backend-implementer 구현
  예정)이며, 두 구현이 갈라지면 이 보고서가 무효가 되므로 로직을 바꿀 때 반드시 함께 갱신할 것.

## 디렉터리

```
src/ml_worker/
  app.py        FastAPI 앱 (POST /embed, GET /health)
  embedder.py   SentenceTransformerEmbedder(실제 모델) / MockEmbedder(해시 기반)
  config.py     환경변수 (pydantic-settings)
tests/          pytest — 전부 mock 임베더로 계약만 검증(모델 다운로드 불필요)
eval/
  goldenset/    corpus.json, cases.json (100문항)
  sweep_thresholds.py
  report/       모델별 실측 보고서
scripts/        pnpm 스크립트가 venv를 감싸기 위한 헬퍼(setup/run/health_check)
```

## 구독형 배포로 교체

`apps/api/src/embedding/embedding-provider.port.ts`의 `EmbeddingProvider` 인터페이스만
지키면 이 서비스를 통째로 외부 임베딩 API로 바꿀 수 있다(DI 바인딩 1곳 — 세부 배선은
backend-implementer의 `EmbeddingProviderFactory`가 담당).
