# FAQ/의도 매칭 고도화 — 2단계 답변 선택 (No.6·9·18·30 부분) 세부 설계서

> **요구사항**: `docs/requirements/nlu-rag-answering.md`(J-1~J-10, FR-N1/N2/N3-*, AC-N1~N4, EX-N1/N2-*)
> **외부 연동 원본**: `docs/00-source/API_RAG.md`(1,448행) — §9의 모든 외부 계약은 이 문서를 근거로 한다.
> **상위 문서**: `docs/02-spec/개발명세서.md` §1~§7 (이 문서는 개발명세서를 **확장**하며 대체하지 않는다)
> **선행 ADR**: ADR-0002(영구삭제) · ADR-0003(API 규약) · ADR-0004(쓰기 주체 없는 스키마 금지) · ADR-0006(정규화 유일성) · **ADR-0008(엔진 순수성)** · ADR-0009/0010(상태 봉투·`resolveTurn`) · ADR-0011(공개 API 규약) · **ADR-0013(PII 마스킹 지점)** · ADR-0015(권한) · ADR-0016(감사) · ADR-0017(KST 버킷) · ADR-0019(미응답 큐)
> **이 문서가 낳은 ADR**: **ADR-0020**(의미 유사도 주입) · **ADR-0021**(임계값 3구간) · **ADR-0022**(외부 RAG allowlist 봉인·인입 분리) · **ADR-0023**(비동기 답변 전달) · **ADR-0024**(`apps/ml-worker` 범위와 런타임)
> **작성일**: 2026-09-22 · **작성자**: system-architect

---

## 1. 범위와 전제

### 1.1 이 그룹이 바꾸는 것

| 구분 | 내용 |
|---|---|
| **1단계(자체 구축)** | FAQ/의도 매칭을 **문장 임베딩 의미 유사도**로 교체한다. 정확일치는 유지하고 **부분 문자열 포함 매칭을 제거**한다. 추론 전용 임베딩 서비스 `apps/ml-worker`를 신설한다 |
| **2단계(외부 위임)** | 1단계 실패 턴을 **회사가 이미 운영 중인 외부 RAG 서버**에 위임한다. 자체 RAG 엔진·벡터 검색·LLM 서빙을 **만들지 않는다** |
| **전달 방식** | 공개 대화 API는 외부 응답을 기다리지 않고 `PENDING`을 즉시 반환하고, 위젯이 폴링해 최종 답변을 받는다 |
| **관측·통계** | RAG가 답한 턴을 `ConversationLog.answeredByRag`로 구분하고 No.14 응답출처에 `RAG` 조각을 신설한다 |

### 1.2 PM 확정 사항 (이 설계의 입력)

| # | 확정 내용 | 이 문서의 반영 지점 |
|---|---|---|
| P-1 | **1단계 임베딩은 자체 구축하며 "최고 성능"을 목표로 한다.** 최소 구현이 아니라 실제 매칭 품질이 나오는 모델·방식을 택한다 | §8.1(모델 후보·선정 절차), §8.2(런타임), ADR-0024 |
| P-2 | **2단계는 외부 RAG API를 그대로 호출**한다. `RagHttpClient` 단일 게이트 + allowlist 3개, 파괴적 엔드포인트는 문자열로도 존재 금지(정적 검사 강제), `provider`는 상수 `'pdf'` | §9.1~§9.3, ADR-0022 |
| P-3 | **문서 인입(업로드)은 이번 범위에서 제외**한다. No.48은 보류·재검토이며 **이번 설계 문서에 인입 아키텍처를 만들지 않는다.** 연결 점검용 `GET /api/documents/metadata` 읽기 전용 호출만 포함하고 **타 회사명을 노출하지 않는다** | §9.6, §14, ADR-0022 §4 |
| P-4 | **외부 서버의 무인증·공인 IP·평문 HTTP는 개발 단계 리스크로 수용**한다. 문서에는 "실제 고객 배포 전 전제조건"으로만 명시하고 서버 측 조치를 지금 요구하지 않는다 | §11.4(R-1) |
| P-5 | **성능 목표는 "RAG 응답 5초"** 로 명시한다. 단 공개 위젯 대화 API는 이 5초를 기다리지 않고 즉시 `PENDING`을 반환 후 폴링한다 | §12, 개발명세서 §5 |

### 1.3 전제(변하지 않는 것)

1. `packages/dialogue-engine`은 **동기·순수·결정론**을 유지한다. HTTP·Prisma·환경변수가 들어가지 않는다(ADR-0008, FR-0-39/40).
2. 대화 상태는 **클라이언트 보관 봉투**이며 이번 그룹이 스키마를 바꾸지 않는다(ADR-0009).
3. 공개 API는 내부 식별자·`trace`·점수를 노출하지 않는다(ADR-0011).
4. PII 마스킹 함수는 **1벌**이다(ADR-0013). 소비자만 2곳이 된다.
5. Redis/BullMQ는 **계속 유보**한다(개발명세서 §6-4). ml-worker는 Job Queue 없는 동기 HTTP 서비스로 시작한다.
6. 신규 환경변수는 **전부 선택**이며, 하나도 설정하지 않으면 두 단계가 비활성이고 시스템은 현행 규칙 매칭으로 정상 기동한다(AC-N4-1).

---

## 2. 설계 결정 일람 (DD-68 ~ DD-90)

| ID | 결정 | 근거 / 대안 기각 사유 | 상세 |
|---|---|---|---|
| **DD-68** | `apps/ml-worker`를 **추론 전용 HTTP 서비스**로 신설한다. Job Queue·학습·Redis 없음 | 개발명세서 §6-2가 "ml-worker 도입 시점은 확장기능 착수 시"라고 유보한 그 시점이 이번 그룹이다. 다만 §6-4의 Redis 유보는 유지 — 재색인은 단일 인스턴스 in-process 큐로 충분하다 | §8.2, ADR-0024 |
| **DD-69** | 임베딩 모델은 **한국어 문장 검색 성능 1순위**로 고르고, 후보 3종을 골든셋으로 실측해 확정한다. `modelId`에 **정규화·프리픽스 규약까지 포함**한다 | P-1. 임계값 절대값이 모델·프리픽스 규약에 종속되므로, 모델을 식별하는 문자열이 "임계값이 유효한 조건" 전부를 식별해야 한다 | §8.1 |
| **DD-70** | 벡터는 `EmbeddingVector` 테이블에 **base64(Float32Array little-endian)** 로 저장한다. JSON 배열·pgvector 모두 1차 범위 밖 | JSON은 1024차원 기준 문자열이 2배 이상 크고 파싱 비용이 재색인·캐시 워밍에 그대로 붙는다. pgvector는 dev DB가 SQLite인 현실과 맞지 않고, 인덱스를 쓰지 않기로 한 이상(FR-N1-7) 얻는 것이 없다 | §6.1 |
| **DD-71** | 벡터는 **번들 캐시와 같은 수명주기**의 메모리 캐시에 동거시킨다. 무효화 지점도 공유한다 | 턴마다 DB에서 수천 벡터를 읽으면 500ms 예산이 성립하지 않는다. 무효화 지점을 나누면 "FAQ는 최신인데 벡터는 옛것"인 상태가 생긴다 | §8.5 |
| **DD-72** | 엔진 확장은 **`ResolveOptions.semantic` 선택 필드 1개**다. `apps/api`가 점수를 계산해 주입한다 | 엔진 안에서 `await`하면 진입점 3종이 전부 async가 되어 호출부 3종과 단위 테스트가 깨진다(ADR-0008 위반) | §8.6, **ADR-0020** |
| **DD-73** | 부분 문자열 포함 매칭 제거는 **`matcher.ts`·`faq.ts` 2파일의 점수 분기 1개씩**이며, `semantic` 미주입 시 **현행 동작과 바이트 단위로 동일**하다 | 저하 모드 = 현행 동작이어야 기존 테스트가 회귀 감시 장치로 계속 작동한다(AC-N1-3) | §8.7 |
| **DD-74** | 임계값은 **3구간 + 격차 조건**이며 `ChatbotAnswerSetting` **1:1 테이블**의 챗봇별 설정값이다(JSON 컬럼 기각) | 필드 12개에 각각 검증 규칙·감사 스냅샷·부분 수정 시맨틱이 붙는다. `Chatbot.skin`(표시용 JSON)과 성격이 다르다 | §6.2, **ADR-0021** |
| **DD-75** | 되묻기는 **후보 질문 원문을 `MESSAGE` 버튼**으로 제시하고, 클릭 시 정확일치로 확정된다. `ConversationState` 스키마를 **바꾸지 않는다** | 새 pending 상태를 만들면 봉투 버전이 올라가고 위젯·시뮬레이터·재검증 로직이 전부 영향을 받는다. `MESSAGE` 버튼은 이미 있는 수단이다 | §8.8 |
| **DD-76** | 색인 트리거는 **`DialogueBundleService.invalidate()` 1지점**이며, 대화 자산 쓰기 경로에 색인 코드를 복제하지 않는다 | 의도·FAQ 쓰기 경로는 이미 전부 번들 무효화를 호출한다. 색인 예약을 그 안에 두면 신규 쓰기 경로가 생겨도 자동으로 따라온다 | §8.9 |
| **DD-77** | 외부 호출은 **`RagHttpClient` 1개 클래스 + 경로 상수 3개**뿐이고, 클라이언트는 **경로를 인자로 받지 않는다**. 금지 문자열 0건을 **테스트가 강제**한다 | "호출하지 않기로 한다"는 약속은 회귀에 약하다. **호출할 수 없게** 만든다 | §9.1, **ADR-0022** |
| **DD-78** | 성패 판정·출처 정제·metadata 파싱은 **DB·Nest 무의존 순수 함수 3개**로 분리한다 | 외부 API의 함정 6종(200=실패, `source_info`로 판별 금지, LLM 오류 접두어, `"N/A"`, `file_path` 유출, 503 2종)이 전부 이 세 함수 안에서 끝나야 테스트 가능하다 | §9.4~§9.6 |
| **DD-79** | 공개 대화 API는 **즉시 `PENDING` 반환 + 폴링 엔드포인트 신설**. 보류 답변은 **TTL 기반 `PendingAnswerStore` 인터페이스** 뒤에 둔다 | 외부 질의는 수 초~수십 초다. 동기로 물면 공개 대화 API의 500ms 예산·레이트리밋·커넥션 예산이 동시에 무너진다 | §9.8, **ADR-0023** |
| **DD-80** | `@Public()` 핸들러를 **5개 → 6개**로 **의도적으로 갱신**한다. AC-C-4/AC-X-3의 개수 고정 테스트는 무력화하지 않고 6으로 고친다 | 개수 고정 테스트의 목적은 "몰래 늘어나는 것"을 막는 것이다. 설계 문서에 근거를 남기고 갱신하는 것은 그 장치의 정상 사용이다 | §11.1 |
| **DD-81** | 대화 로그는 **최종 결과로 1건만** 남긴다. `PENDING` 시점에 적재하지 않고 `messageId`를 선발급해 유지한다 | 2건을 남기면 No.14 응답률·No.2 접속수·No.15 큐가 전부 두 번 센다. 기존 코드가 이미 `record({ id: messageId })`로 로그 PK = `messageId` 규약을 쓰고 있어 선발급이 자연스럽다 | §9.9 |
| **DD-82** | `ConversationLog`에 **`answeredByRag` 불리언 1개만** 추가한다 | RAG 응답은 `matchedNodeId`/`matchedFaqId`가 둘 다 `null`이고 `isAnswered=true`여서 기존 "기타" 조각과 **파생 불가**하다 → ADR-0004 기준 통과 | §6.3 |
| **DD-83** | `RagCallLog`를 신설하되 **질문·답변 원문을 저장하지 않는다** | 원문은 `ConversationLog`에 마스킹된 채로 이미 1벌 있다. 두 곳에 두면 마스킹 정책 변경 시 누락이 생긴다(NFR-S8) | §6.4 |
| **DD-84** | PII 마스킹 소비자가 2곳(저장·외부 송신)이 되므로 **`packages/pii-mask`로 승격**한다 | 개발명세서 §5가 명시한 승격 조건("소비자가 2곳 이상")이 충족됐다. 승격하지 않으면 `rag` 모듈이 `conversation/lib`를 가로질러 import하게 되어 모듈 경계가 무너진다 | §7.3 |
| **DD-85** | 신규 모듈 **3개**(`answer-settings`·`embedding`·`rag`) + 기존 **3개 확장**(`conversation`·`dialogue-common`·`simulation`). 의존은 단방향 | `rag`는 `conversation`을 모른다. `embedding`은 `dialogue-common`을 모른다(역방향 참조 금지) | §7.1 |
| **DD-86** | 우리 API에 **`POST /rag/query`를 만들지 않는다.** 외부 호출은 내부 클라이언트 전용이다 | 개발명세서 §4의 "옵션(RAG 등) `POST /rag/query`"는 자체 RAG 엔진을 전제한 예고였다. 프록시 엔드포인트를 공개하면 allowlist 봉인(DD-77)이 무의미해진다 | §10.2 |
| **DD-87** | 신규 권한 **0종**. 조회 `chatbot:read`, 저장·점검·재색인 `chatbot:write` | ADR-0015의 "동작이 바꾸는 자원 기준" — 바뀌는 것은 챗봇 설정이다 | §11.2 |
| **DD-88** | 신규 환경변수 **11종 전부 선택**(기본값 있음). `RAG_TIMEOUT_MS`만 **하한 120,000을 코드가 강제**한다 | FR-0-46/AC-N4-1. 하한 강제는 외부 문서(§6-6)의 권고를 설정 실수로 깨뜨리지 못하게 하는 장치다 | §13 |
| **DD-89** | 마이그레이션은 **신규 테이블 3개 + 컬럼 1개 추가**이며 **백필이 필요 없다.** 기존 데이터는 100% 호환된다 | `answeredByRag` 기본값 `false`가 기존 행의 사실과 일치한다. 설정 테이블은 **행이 없으면 기본값**(= 두 단계 비활성)이라 기존 챗봇에 행을 만들지 않는다 | §6.6 |
| **DD-90** | 저하 모드(임베딩 장애)에서도 **폴백 도달 턴은 2단계를 탄다** | FR-N2-1의 실행 조건 9개에 임베딩 가용성이 없다. 1단계가 죽었다는 이유로 문서 근거 답변까지 막을 이유가 없다 | §9.7 |

---

## 3. 전체 파이프라인 (아키텍처 관점)

```
[공개 대화 1턴]
 ① 슬러그 해석 · Origin 가드 · 레이트리밋                      (기존)
 ② 채널 어댑터 normalizeInbound                                 (기존)
 ②.5 입구 금지어 필터 → BLOCK이면 엔진·임베딩·RAG 전부 미호출   (기존)
 ─────────────────────────────────────────────────────────────
 ③ [신규] SemanticMatchService.score(chatbotId, text)
      ├ 설정 조회(캐시) semanticEnabled=false → 건너뜀(저하 모드와 동일 경로)
      ├ 정규화 길이 < 2자 → 건너뜀 (EX-N1-6)
      ├ LRU 캐시 적중 → 질의 벡터 재사용
      └ 미적중 → EmbeddingProvider.embed([text])  ── HTTP ──▶ apps/ml-worker
                   타임아웃 300ms / 회로차단 → 실패 시 semantic = undefined(저하 모드)
 ④ [신규] 코사인 내적(메모리 내 완전 탐색, 번들 캐시 동거 벡터)
      → SemanticMatchInput { faqScores, intentScores, ranked, thresholds }
 ⑤ resolveTurn(turnInput, state, bundle, now, { index, semantic })   ← 엔진: 동기·순수
      S1 세션 → S1.5 되묻기 → S2 동음이의어 → S3 노드 → S4 FAQ → S5 의도 → S6 폴백
 ⑥ 채널 어댑터 renderOutbound + 출구 금지어 마스킹               (기존)
 ─────────────────────────────────────────────────────────────
 ⑦ judgeAnswered(trace) === false 이고 §9.7의 9조건 충족?
      ├ 아니오 → 기존 응답 즉시 반환 + record() 1건 (기존 경로, 미응답 큐 포함)
      └ 예   → [신규] messageId 선발급 · PendingAnswerStore.create()
                 PENDING 응답 즉시 반환 { outputs:[대기 안내], pendingAnswer:{...} }
                 └─▶ 백그라운드 RagAnswerService.run()
                        PII 마스킹 → RagHttpClient.query({ ..., provider:'pdf' })
                        판정(6조건) → 출처 정제 → 출구 금지어 마스킹
                        → PendingAnswerStore.complete(READY|FAILED)
                        → RagCallLog 1건 + ConversationLog 1건(record)
 ⑧ [신규] 위젯 폴링 GET /public/chatbots/:slug/messages/:messageId
      PENDING → READY(최종 답변 + 출처) | FAILED(폴백 문구) | 404(TTL 만료)
```

**핵심 경계 3가지**

1. **엔진 경계** — ③④는 `apps/api`, ⑤는 엔진이다. 엔진은 네트워크를 모르고, 주입된 숫자 맵만 소비한다(ADR-0020).
2. **외부 경계** — 외부 RAG 호스트로 나가는 HTTP는 `RagHttpClient` 1곳뿐이고 경로는 상수 3개뿐이다(ADR-0022).
3. **응답 경계** — 공개 API는 ⑦에서 절대 기다리지 않는다. 5초든 50초든 사용자 요청은 이미 끝나 있다(ADR-0023).

---

## 4. `apps/ml-worker` 신설 (개발명세서 §1·§2 확장)

### 4.1 모노레포 배치

```
Chat Bot/
├── apps/
│   ├── web/
│   ├── widget/
│   ├── api/
│   └── ml-worker/        # [신설] 추론 전용 임베딩 서비스 (Python FastAPI)
│       ├── package.json          # pnpm 워크스페이스 편입용. scripts가 venv/uv를 감싼다
│       ├── pyproject.toml
│       ├── src/ml_worker/{app.py, embedder.py, config.py}
│       └── README.md             # 모델 다운로드·기동 절차
└── packages/
    ├── shared-types/
    ├── dialogue-engine/
    └── llm-provider/     # 여전히 미생성 — 이번 그룹은 LLM을 직접 부르지 않는다
```

- `packages/llm-provider`는 **이번에도 만들지 않는다.** 2단계의 LLM 추론은 전부 외부 서버가 수행하므로 우리 쪽에 LLM Provider 추상화가 들어갈 자리가 없다. 임베딩 추상화는 `packages/`가 아니라 `apps/api/src/embedding/`의 포트로 충분하다(소비자가 `apps/api` 1곳).
- `infra/`(docker-compose)는 계속 만들지 않는다. ml-worker 기동은 개발자 로컬 스크립트로 시작하고, 컨테이너화는 배포 Phase(사용자 지정 시)로 미룬다.

### 4.2 서비스 계약 (HTTP 2개)

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| `POST` | `/embed` | `{ texts: string[], kind: 'QUERY' \| 'PASSAGE' }` | `{ modelId, dimension, vectors: number[][] }` — **L2 정규화 완료** |
| `GET` | `/health` | — | `{ status: 'ok', modelId, dimension, device, warmedUp }` |

- `kind`는 **비대칭 인코딩 모델 대비**다. 프리픽스가 필요 없는 모델이면 서버가 무시한다 — **프리픽스 규칙을 `apps/api`가 알지 않게 한다**(모델 교체가 API 코드를 건드리지 않는다).
- **L2 정규화는 ml-worker가 책임진다**(FR-N1-5). `apps/api`는 정규화 여부를 다시 판단하지 않고 내적 = 코사인이라고 가정한다.
- 배치 상한은 서버가 강제한다(기본 64건/요청). 재색인은 이 단위로 쪼개 보낸다.

---

## 5. `packages/shared-types` 배치

| 파일 | 추가 내용 |
|---|---|
| `dialogue-engine.ts` | `SemanticMatchInput`, `SemanticRankedCandidate`, `TraceStep.code`에 `SEMANTIC_MATCHED`/`SEMANTIC_AMBIGUOUS`/`SEMANTIC_BELOW_THRESHOLD`/`SEMANTIC_SKIPPED` 4종 추가 |
| **`answering.ts`(신설)** | `ChatbotAnswerSettingSchema`, `UpdateAnswerSettingSchema`(부분 수정), `ThresholdPreviewRequest/Response`, `EmbeddingIndexStatus`, `RagConnectionCheckResult`, `FallbackPolicy`(`RAG_FIRST`\|`NODE_FIRST`), `EmbeddingOwnerType` 4종, `RagOutcome` 7종 |
| `conversation.ts` | `PublicMessageResponse`에 **선택 필드** `pendingAnswer?: { id, pollAfterMs, expiresAt }` 추가, `PendingAnswerPollResponse` 신설(`status` 4종 + `outputs?` + `sources?`) |
| `common.ts` | `ApiErrorCode` **7종 추가** — `RAG_NOT_CONFIGURED`, `RAG_UPSTREAM_UNAVAILABLE`, `RAG_DISABLED`, `EMBEDDING_UNAVAILABLE`, `REINDEX_IN_PROGRESS`, `PENDING_ANSWER_NOT_FOUND`, `INVALID_THRESHOLD` |

- `SemanticMatchInput`은 **엔진이 소비하는 타입**이므로 zod 스키마가 아니라 **순수 TS 타입**으로 둔다(엔진에 zod를 반입하지 않는다는 기존 규약 유지).
- `answering.ts` 신설 근거: 개발명세서 §6-9의 "관심사가 명확히 다르고 단방향 의존일 때만 새 도메인 파일". `chatbot.ts`는 이미 설정·스킨·상태로 비대하고, 이 스키마들은 챗봇 CRUD가 참조하지 않는다.

---

## 6. 데이터 모델 변경 (개발명세서 §3 확장)

### 6.1 `EmbeddingVector` — 신설 (개발명세서 §3에 예고돼 있던 항목의 1차 구체화)

```prisma
model EmbeddingVector {
  id            String   @id @default(uuid())
  chatbotId     String
  chatbot       Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// FAQ_QUESTION | FAQ_ALT | INTENT_NAME | INTENT_EXAMPLE (zod enum 단일 소스)
  ownerType     String
  /// FaqEntry.id 또는 Intent.id. FK를 걸지 않는다(파생·로그 규약, §3.1 예외 목록에 편입)
  ownerId       String
  /// altQuestions/examples 배열 내 위치. 단일 필드는 0
  slotIndex     Int      @default(0)
  /// normalizeText(원문)의 sha256 — 재임베딩 회피 키(FR-N1-19)
  textHash      String
  modelId       String
  dimension     Int
  /// L2 정규화된 Float32Array(little-endian)의 base64. JSON 배열이 아니다(DD-70)
  vector        String
  /// READY | PENDING | FAILED
  status        String   @default("PENDING")
  failureReason String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([chatbotId, ownerType, ownerId, slotIndex, modelId])
  @@index([chatbotId, modelId, status])
  @@index([chatbotId, ownerType, ownerId])
  @@map("embedding_vectors")
}
```

- **원문 텍스트를 저장하지 않는다.** `ownerId`/`slotIndex`로 역참조 가능하고, 중복 저장은 수정 시 정합성 부담만 늘린다. 부수 효과로 **대화 자산 문자열이 두 번째 저장소를 갖지 않는다**.
- `chatbotId`에는 FK를 **건다** — 벡터는 챗봇과 생사를 같이하는 파생 데이터다. `onDelete: Restrict`(§3.1 규약)이므로 **영구삭제 서비스의 동반 삭제 목록에 추가**한다(차단 대상이 아니라 삭제 대상 — ADR-0002의 "하위 데이터 제거" 분류, AC-N1-20).
- `ownerId`에 FK를 걸지 **않는** 이유: 걸면 `Restrict` 규약 때문에 **벡터가 있는 FAQ/의도를 영원히 삭제할 수 없다**. 정리는 색인 서비스가 책임진다(`ownerId` 고아 행은 재색인 시 제거).

### 6.2 `ChatbotAnswerSetting` — 신설 (1:1)

```prisma
model ChatbotAnswerSetting {
  chatbotId              String   @id
  chatbot                Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  semanticEnabled        Boolean  @default(false)
  acceptThreshold        Float    @default(0.80)
  lowThreshold           Float    @default(0.60)
  marginThreshold        Float    @default(0.05)
  ragEnabled             Boolean  @default(false)
  ragCompany             String?
  ragCategory            String?
  ragSubcategory         String?
  /// null이면 요청에 similarity_threshold 필드를 아예 넣지 않는다(FR-N2-8)
  ragSimilarityThreshold Float?
  /// RAG_FIRST | NODE_FIRST
  fallbackPolicy         String   @default("RAG_FIRST")
  showSources            Boolean  @default(true)
  /// 하한 120000을 서버가 강제(FR-N2-26)
  ragTimeoutMs           Int      @default(120000)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  @@map("chatbot_answer_settings")
}
```

- **행이 없으면 전부 기본값**이다(= 두 단계 비활성). 기존 챗봇에 행을 만들지 않으므로 **백필이 없고 마이그레이션이 데이터를 건드리지 않는다**(DD-89). 최초 `PUT` 때 upsert로 생성한다.
- 검증(서버): `0.0 ≤ lowThreshold < acceptThreshold ≤ 1.0`, `0 ≤ marginThreshold ≤ 0.5`, `ragSimilarityThreshold`는 `null` 또는 `0 < v < 1`, `ragSubcategory`가 있으면 `ragCategory` 필수, `ragEnabled=true`면 `ragCompany` 필수. 위반 시 `400 INVALID_THRESHOLD`(임계값) / `400 VALIDATION_FAILED`(그 외).
- **`provider` 필드는 존재하지 않는다**(FR-N2-6). 스키마·DTO·환경변수 어디에도 없다.

### 6.3 `ConversationLog` — 컬럼 1개 추가

```prisma
  /// [신규] 2단계(외부 RAG)가 답한 턴. No.14 응답출처 `RAG` 조각의 유일한 근거(ADR-0004 기준 통과).
  /// 쓰기 주체는 ConversationLogService.record() 1곳(파라미터 전달).
  answeredByRag   Boolean  @default(false)
```

- 인덱스 추가 **없음**. 응답출처 분포는 이미 `(chatbotId, dayBucket)` 인덱스로 범위를 좁힌 뒤 앱에서 집계한다(ADR-0017 §4). 불리언 컬럼에 인덱스를 붙여도 선택도가 낮아 이득이 없다.
- 소비처는 `conversation/lib/conversation-log.ts`의 **응답출처 판정 순수 함수 1곳**이다. 분기 1개를 `matchedNodeId → matchedFaqId → answeredByRag → 기타` 순으로 추가한다. 기존 3조각의 수치는 변하지 않는다(AC-N4-10).

### 6.4 `RagCallLog` — 신설 (외부 호출 관측)

```prisma
model RagCallLog {
  id                String   @id @default(uuid())
  /// FK 없음(로그 규약). 챗봇 영구삭제 시 서비스가 동반 삭제한다
  chatbotId         String
  /// 대화 턴의 messageId(= ConversationLog.id). FK 없음
  conversationLogId String?
  /// SUCCESS | NO_EVIDENCE | UPSTREAM_ERROR | TIMEOUT | CIRCUIT_OPEN | RATE_LIMITED | SCHEMA_INVALID
  outcome           String
  httpStatus        Int?
  latencyMs         Int
  retryCount        Int      @default(0)
  /// 0 | 1 | null(응답 자체를 못 받음)
  retrievalSuccess  Int?
  sourceCount       Int?
  /// 스코프 오설정 추적용. 질문·답변 원문은 저장하지 않는다(DD-83)
  scopeCompany      String?
  /// ADR-0017 KST 버킷 규약 재사용
  dayBucket         String   @default("")
  createdAt         DateTime @default(now())

  @@index([chatbotId, dayBucket])
  @@index([chatbotId, createdAt])
  @@map("rag_call_logs")
}
```

- **질문·답변 원문 0건**이 불변식이다(AC-N2-29). 코드리뷰·테스트 양쪽의 점검 항목.
- 보존기간 정책·정리 배치는 범위 밖(No.45)이며 §14에 리스크로 남긴다.

### 6.5 개발명세서 §3 엔터티 표 갱신분

| 대상 행 | 갱신 |
|---|---|
| `EmbeddingVector` | "텍스트 임베딩(pgvector)" → "**FAQ/의도 질문 측 문장 임베딩. `ownerType`/`ownerId`/`slotIndex`/`textHash`/`modelId`로 항목별 색인하며 벡터는 base64(Float32Array) 1차 저장. 유사도는 메모리 내 코사인 완전 탐색이고 벡터 인덱스(HNSW/pgvector)는 도입하지 않는다 — 재검토 트리거는 챗봇당 2만 벡터 초과. 모델이 바뀌면 옛 벡터는 매칭에서 제외된다**" / 관련 기능 `18` |
| `ConversationLog` | 말미에 "**`answeredByRag`는 2단계(외부 RAG) 응답 여부이며 No.14 응답출처 `RAG` 조각의 유일한 근거다 — 세 매칭 컬럼이 전부 `null`인 채 `isAnswered=true`인 턴을 기존 '기타'와 구분한다(ADR-0004)**" 추가 |
| **신규 행** | `ChatbotAnswerSetting` — 챗봇별 답변 선택 설정(1:1). 의미 매칭 3임계값·RAG 스코프(`company`/`category`/`subcategory`)·폴백 정책·출처 표시·타임아웃. **행이 없으면 전부 기본값이며 두 단계 모두 비활성**이다. `provider` 필드는 존재하지 않는다 / 기능 `6, 9, 18, 30` |
| **신규 행** | `RagCallLog` — 외부 RAG 호출 관측 로그(건수·성패·지연·실패사유·스코프). **질문·답변 원문을 저장하지 않으며** `AuditLog`와 분리된다(보존기간·마스킹 요건이 다르다 — ADR-0016과 같은 판단) / 기능 `30` |
| `TrainingJob` | 말미에 "**이번 그룹(No.18 부분)도 이 테이블을 쓰지 않는다** — ml-worker는 추론 전용이고 Job Queue가 없다(ADR-0024)" 추가 |

### 6.6 마이그레이션 영향 분석

| 항목 | 내용 |
|---|---|
| **DDL** | 테이블 3개 신설(`embedding_vectors`, `chatbot_answer_settings`, `rag_call_logs`) + `conversation_logs.answeredByRag` 컬럼 1개 추가(기본값 `false`) |
| **백필** | **없다.** `answeredByRag=false`는 기존 행의 사실과 일치한다(RAG가 답한 과거 턴이 존재하지 않는다). ADR-0017의 센티넬 값 기법이 필요 없는 이유다 |
| **기존 데이터 호환성** | 100%. 설정 행이 없는 챗봇 = 두 단계 비활성 = 현행 동작. 벡터 0건 = 1단계 항상 실패 구간 = 현행 폴백 |
| **롤백** | 컬럼·테이블 추가만 있으므로 이전 API 버전과 **앞뒤 호환**된다(옛 코드는 새 컬럼을 무시한다). 되돌릴 때 데이터 손실은 벡터·호출로그뿐이며 둘 다 재생성 가능한 파생 데이터다 |
| **배포 순서** | ① 마이그레이션 적용 → ② API 배포(환경변수 미설정 = 비활성) → ③ ml-worker 기동 + `EMBEDDING_BASE_URL` 설정 → ④ 챗봇별 재색인 → ⑤ `semanticEnabled` on → ⑥ `RAG_BASE_URL` 설정 + 연결 점검 → ⑦ `ragEnabled` on. **각 단계가 독립적으로 되돌릴 수 있다** |
| **영구삭제 영향** | `ChatbotsService.permanentDelete()`의 동반 삭제 목록에 `embeddingVector`(FK Restrict이므로 필수) · `chatbotAnswerSetting`(FK Restrict) · `ragCallLog`(FK 없음, 보존 요건 없음) 3종 추가. 사전검사(409) 대상이 아니라 **삭제 대상**이다 |

---

## 7. NestJS 모듈 구조 (개발명세서 §2.1·§2.2 확장)

### 7.1 모듈 배치와 의존 방향

```
apps/api/src/
├── answer-settings/                 [신설]
│   ├── answer-settings.controller.ts        # GET/PUT 설정, POST preview, POST test
│   ├── answer-settings.service.ts           # 검증·감사·캐시 무효화
│   ├── answer-settings.mapper.ts
│   ├── answer-settings-cache.service.ts     # 설정 메모리 캐시(TTL + 즉시 무효화)
│   └── lib/validate-thresholds.ts           # 순수
├── embedding/                       [신설]
│   ├── embedding.module.ts
│   ├── embedding-provider.port.ts           # EmbeddingProvider 인터페이스 (교체 지점)
│   ├── providers/{http-embedding.provider.ts, mock-embedding.provider.ts}
│   ├── embedding-provider.factory.ts        # DI 바인딩 1곳 (FR-N1-1)
│   ├── query-embedding.service.ts           # LRU 캐시 + 타임아웃 + 회로차단
│   ├── semantic-match.service.ts            # 점수 맵 조립(SemanticMatchInput)
│   ├── vector-cache.service.ts              # 챗봇별 벡터 메모리 캐시(번들과 동거)
│   ├── index/{indexer.service.ts, reindex-queue.service.ts, embedding-status.service.ts}
│   └── lib/{vector-codec.ts, cosine.ts, compose-score.ts, text-hash.ts}   # 전부 순수
├── rag/                             [신설]
│   ├── rag.module.ts
│   ├── rag-http.client.ts                   # ★ 외부로 나가는 유일한 출구(allowlist 3)
│   ├── rag-answer.service.ts                # 백그라운드 1건 처리(마스킹→호출→판정→저장)
│   ├── rag-gate.service.ts                  # 동시성·레이트리밋·회로차단·status 캐시
│   ├── rag-call-log.service.ts
│   ├── pending-answer.store.ts              # 인터페이스 + InMemory 구현(TTL)
│   └── lib/{rag-paths.ts, judge-rag-response.ts, sanitize-sources.ts,
│            parse-document-metadata.ts, rag-response.schema.ts}           # 전부 순수
├── conversation/                    [확장]
│   ├── public-conversation.service.ts       # ③④ 주입 + ⑦ 2단계 분기
│   ├── public-conversation.controller.ts    # 폴링 핸들러 1개 추가(@Public())
│   └── conversation-log.service.ts          # answeredByRag 파라미터 1개 추가
├── dialogue-common/                 [확장]
│   └── dialogue-bundle.service.ts           # getCached()가 vectors 동반 반환 + invalidate()가 색인 예약
└── simulation/                      [확장]
    └── simulation.service.ts                # semantic 주입 + useRag 플래그 + 근거 패널 데이터
```

**의존 방향(단방향, 순환 없음)**

```
conversation ──▶ embedding ──▶ (prisma)
     │            ▲
     ├──────▶ rag │
     │            │
     └──▶ answer-settings
dialogue-common ──▶ embedding      (번들 캐시가 벡터를 동거시키고, 무효화가 색인을 예약)
simulation ──▶ embedding, rag, answer-settings
```

- **`rag`는 `conversation`을 모른다.** 완료 시 로그 적재가 필요하므로 `RagAnswerService`가 `ConversationLogService`를 주입받는데, 이는 `conversation` 모듈이 export하는 **서비스 1개**에 대한 의존이며 역방향 참조가 아니다(ADR-0019에서 `conversation → learning`을 금지한 것과 같은 기준을 적용하되, 여기서는 방향이 `rag → conversation`이다). 순환을 만들지 않기 위해 **`conversation`은 `rag`의 타입만 import하고 구현을 import하지 않는다** — 2단계 트리거는 `conversation`이 `RagAnswerService.enqueue()`를 호출하는 형태이므로 `conversation → rag` 1방향이고, 로그 적재는 `rag → conversation`이 된다. **이 한 쌍의 상호 참조를 피하기 위해 `RagAnswerService`는 `ConversationLogService`가 아니라 생성자 주입된 `ConversationLogPort`(인터페이스, `shared` 위치) 를 쓴다.**
- `embedding`은 `dialogue-common`을 의존하지 않는다. 색인에 필요한 FAQ/의도는 **Prisma에서 직접 읽는다**(번들은 대화용 조립 결과라 색인 대상과 모양이 다르다).

### 7.2 계층 규약 준수

| 계층 | 이번 그룹의 배치 |
|---|---|
| 컨트롤러 | 경로·권한 데코레이터·zod 파이프만. 임계값 판정·RAG 판정 분기를 두지 않는다 |
| 서비스 | 비즈니스 단일 진입점 + `AuditLogService.record()` 호출 지점(설정 변경 1건) |
| 매퍼 | Prisma row ↔ DTO. `Float` ↔ number, `null ↔ undefined`, enum 폴백 |
| `lib/*` | **점수 합성·구간 판정·코사인·벡터 인코딩·RAG 성패 판정·출처 정제·metadata 파싱** — 전부 DB·Nest 무의존 순수 함수(NFR-M1) |

### 7.3 `packages/pii-mask` 승격 (DD-84)

- 현재 `apps/api/src/conversation/lib/pii-mask.ts`(+ `.spec.ts`)를 **`packages/pii-mask`로 이동**한다. 공개 API는 `maskPii(text: string): string` 1개이며 정책(주민/카드/계좌 = 전량 placeholder, 전화/이메일 = 부분 마스킹)은 **바뀌지 않는다**(ADR-0013 불변).
- 소비자 2곳: `ConversationLogService.record()`(저장 경로, 기존) / `RagAnswerService`(외부 송신 경로, 신규).
- 이동은 **동작 변경 0**이어야 한다. 기존 `pii-mask.spec.ts`를 패키지로 함께 옮기고 `apps/api`에는 재export를 남기지 않는다(복제 금지 — AC-N4-7).

---

## 8. 1단계 설계 — NLU 의미 유사도 매칭

### 8.1 임베딩 모델 (P-1: 최고 성능 목표)

**결정: 한국어 검색·문장유사도 성능을 1순위로 고르고, 아래 3종을 골든셋으로 실측해 확정한다. 최종 선정과 실측표는 `ml-engineer`의 첫 산출물이다(AC-N1-12와 묶는다).**

| 후보 | 차원 | 성격 | 채택 시 장점 | 리스크 |
|---|---|---|---|---|
| **1순위 — 한국어 파인튜닝 BGE-M3 계열**(예: `nlpai-lab/KURE-v1`) | 1024 | 한국어 검색 특화 파인튜닝 | 한국어 질의-문서 검색 품질이 범용 다국어 모델보다 유의하게 높다. 프리픽스 규약이 없어 운영이 단순하다 | 파라미터 5억대 → **CPU 단문 인코딩이 300ms 예산과 충돌 가능**(아래 완화책) |
| **2순위 — 범용 다국어 BGE-M3**(`BAAI/bge-m3`) | 1024 | 다국어 범용 | 라이선스·배포 이력이 가장 안정적. 1순위의 대조군으로 반드시 함께 측정한다 | 한국어 특화 대비 top1 정확도 열세 가능 |
| **3순위 — 경량 대조군**(한국어 SBERT 계열 768차원 또는 소형 최신 임베딩) | 768 이하 | 속도 우선 | CPU 지연이 확실히 예산 안에 들어간다. 1·2순위가 예산을 못 지킬 때의 대안 | 정확도 하락 폭이 골든셋으로 정량화돼야 한다 |

**선정 지표(5개, 표로 남긴다)**: ① 골든셋 top1 정확도 ② 되묻기/실패 구간 분포(오탐률) ③ **CPU 1문장 인코딩 P95** ④ 5,000건 재색인 소요 ⑤ 라이선스·모델 크기.

**`modelId` 규약(DD-69)**: `<model-name>@<rev>|<prefix-rule>|<norm-rule>` (예: `kure-v1@2024-05|noprefix|l2`). 임계값은 모델뿐 아니라 **프리픽스 규약·정규화 규약에 종속**되므로, 이 셋이 하나라도 바뀌면 `modelId`가 바뀌고 **기존 벡터는 자동으로 무효**가 된다(FR-N1-4, AC-N1-11).

**CPU 지연 리스크와 완화 순서** — 최고 성능 모델은 크다. `EMBEDDING_TIMEOUT_MS=300`(FR-N1-31)을 넘기면 저하 모드가 흡수하지만 **그 상태는 의미 매칭이 사실상 꺼진 것**이다. 대응 순서를 고정한다.

1. 워밍업(기동 시 1회 더미 인코딩) + 단문 경로 `max_length` 절단(기본 128 토큰).
2. ONNX Runtime + int8 동적 양자화(정확도 손실을 골든셋으로 재측정).
3. GPU 할당(`EMBEDDING_DEVICE=cuda`) — 구축형 고객사가 GPU를 가진 경우의 기본 구성.
4. 3순위 경량 모델로 교체.

> **금지 사항**: 예산을 못 지킨다고 `EMBEDDING_TIMEOUT_MS`를 조용히 올려 **공개 대화 500ms(P95) 예산을 깨지 않는다.** 예산 변경은 설계 문서 갱신을 거친다.

### 8.2 ml-worker 런타임 (ADR-0024)

**결정: Python 3.11 + FastAPI + uvicorn, 추론 라이브러리는 sentence-transformers/FlagEmbedding. Node ONNX 단독 구성은 기각한다.**

- **기각 사유**: 한국어 임베딩 모델의 1차 배포 형태는 거의 전부 PyTorch/HF이고, ONNX 변환본은 모델마다 존재 여부·품질이 제각각이다. "최고 성능"을 목표로 두는 순간 **모델 교체 자유도가 런타임 선택을 지배**한다. Node 단독으로 가면 후보군이 "ONNX가 이미 있는 모델"로 좁아져 P-1과 충돌한다.
- **모노레포에 Python이 하나 생기는 비용**은 다음 3가지로 격리한다.
  1. 접촉면은 **HTTP 2개**(`POST /embed`, `GET /health`)뿐이다. 언어가 바뀌어도 `apps/api`는 모른다.
  2. `apps/api`는 **`EmbeddingProvider` 포트만** 안다. `MockEmbeddingProvider`(결정론적 해시 기반 벡터)로 **Python 없이 전 테스트가 통과**한다 — CI·타 개발자 환경이 Python에 묶이지 않는다.
  3. 기동은 `apps/ml-worker/package.json`의 pnpm 스크립트(`dev`/`start`/`health`)가 venv를 감싼다 — 팀의 명령어 체계가 하나로 유지된다.
- **Job Queue·Redis는 도입하지 않는다**(개발명세서 §6-4 유지). 재색인은 `apps/api` 안의 **단일 인스턴스 in-process 큐**이며, 다중 인스턴스 전환 시 교체 지점은 `ReindexQueueService` 1곳이다.

### 8.3 `EmbeddingProvider` 포트

```ts
interface EmbeddingProvider {
  readonly modelId: string;
  readonly dimension: number;
  embed(texts: string[], kind: 'QUERY' | 'PASSAGE'): Promise<Float32Array[]>;  // L2 정규화 완료
  healthy(): Promise<boolean>;
}
```

- 구현체 2종: `HttpEmbeddingProvider`(ml-worker) / `MockEmbeddingProvider`(테스트·`EMBEDDING_BASE_URL` 미설정 시 **비활성 처리**).
- **교체 지점은 `EmbeddingProviderFactory` 1곳**이다(FR-N1-1). 구독형에서 외부 임베딩 API로 바꿀 때 이 파일만 바뀐다.
- `modelId`/`dimension`은 **기동 시 `GET /health`로 확인**하고 메모리에 고정한다. 런타임 중 모델이 바뀌면 차원 불일치가 나므로 **벡터 사용 전 차원 검사**를 하고 불일치 시 그 턴만 저하 모드 + `staleModel` 보고(EX-N1-2).

### 8.4 질의 임베딩 경로 (턴당 정확히 1회)

| 단계 | 규칙 |
|---|---|
| 캐시 | 정규화 문자열 키 LRU(기본 1,000건 · TTL 10분). 적중 시 네트워크 0회(FR-N1-6) |
| 타임아웃 | 기본 300ms. 초과 = 실패이며 그 턴은 저하 모드(FR-N1-31) |
| 회로차단 | 연속 5회 실패 → 30초 open. open 중에는 호출조차 하지 않는다(AC-N1-10) |
| 생략 조건 | `semanticEnabled=false` / 정규화 길이 < 2자 / 벡터 0건 → 호출하지 않는다 |
| N+1 금지 | 한 턴에서 FAQ용·의도용을 따로 부르지 않는다. **질의 벡터 1개를 두 점수 맵에 공유**한다(NFR-P7) |

### 8.5 벡터 로딩 전략 (DD-71)

- `DialogueBundleService.getCached(chatbotId)`의 반환을 `{ bundle, index }` → **`{ bundle, index, vectors }`** 로 확장한다. `vectors`는 `{ modelId, dimension, faq: PackedVectors, intent: PackedVectors }` 형태이며, `PackedVectors`는 **하나의 연속 `Float32Array` + 메타 배열**(id/ownerType/slotIndex)이다 — 벡터마다 객체를 만들지 않는다(GC 압력·내적 루프 성능).
- **무효화 지점을 공유한다.** 의도·FAQ 쓰기 → `invalidate(chatbotId)` → 번들과 벡터가 **함께** 버려진다. "FAQ는 최신인데 벡터는 옛것"인 상태가 구조적으로 생기지 않는다(AC-N1-14가 캐시 TTL을 기다리지 않는 이유).
- **메모리 예산**: 1024차원 × 4바이트 = 4KB/벡터. 챗봇당 5,000벡터 = 20MB. 캐시 상한을 **항목 수가 아니라 바이트**로 두고(기본 256MB) 초과 시 LRU 축출한다. 축출된 챗봇은 다음 턴에 DB에서 재적재(콜드 1.5초 예산 안).
- 벡터 디코딩은 `lib/vector-codec.ts`(base64 → `Float32Array`) 순수 함수이며, 파싱 실패 벡터는 **그 벡터만 제외 + 경고 로그**(예외를 던지지 않는다 — 엔진의 가용성 규약과 대칭, EX-N1-3).

### 8.6 엔진 통합 — `ResolveOptions.semantic` (ADR-0020)

```ts
// packages/shared-types/src/dialogue-engine.ts (zod 아님 — 순수 타입)
export interface SemanticRankedCandidate {
  kind: 'FAQ' | 'INTENT';
  id: string;
  score: number;        // 0..1 코사인
  matchedText: string;  // 되묻기 버튼에 그대로 쓰이는 원문
}
export interface SemanticMatchInput {
  modelId: string;
  faqScores: ReadonlyMap<string, number>;     // FAQ id → 질문·대체질문 중 최댓값
  intentScores: ReadonlyMap<string, number>;  // 의도 id → 의도명·예문 중 최댓값
  ranked: readonly SemanticRankedCandidate[]; // 점수 내림차순 + 결정론적 타이브레이크
  thresholds: { accept: number; low: number; margin: number };
}

// packages/dialogue-engine/src/resolver.ts
export interface ResolveOptions {
  // ... 기존 7개 불변 ...
  /** [신규] apps/api가 사전 계산한 의미 유사도. 미지정이면 현행(규칙) 동작과 완전히 동일하다. */
  semantic?: SemanticMatchInput;
}
```

- `resolveResponse`/`resolveByNodeId`/`resolveTurn`의 **인자 순서·반환 타입은 바뀌지 않는다**(AC-N4-5).
- 엔진은 `semantic`을 **읽기만** 한다. 계산도, 네트워크도, 시간도 쓰지 않는다 → 결정론이 유지된다(AC-N1-8).
- 적용 지점 3곳: **S3 노드 매칭의 `ctx.matchedIntentId` 산출 · S4 FAQ · S5 의도 단독**. 노드 트리거에 전파되는 것은 **의도된 동작 변경**이며 AC-N1-6으로 명시 고정한다(조용한 변경 금지).

### 8.7 점수 합성과 부분일치 제거 (DD-73)

`matcher.ts`(의도)와 `faq.ts`(FAQ)의 `consider` 분기를 다음 규칙으로 통일한다. 구현은 `packages/dialogue-engine/src/semantic.ts`의 순수 함수 1개를 두 파일이 공유한다(NFR-M2).

```
① 정규화 정확일치         → score = norm.length + 1000        (기존 유지, 확정)
② semantic 주입 있음      → score = semantic score            (0..1 → 내부 비교용 스케일링)
③ semantic 주입 없음      → 부분 문자열 포함(현행 로직)        (저하 모드에서만 살아난다)
```

- ②가 동작하는 동안 ③은 **평가되지 않는다** — 짧은 예문 오탐(J-3의 ②)이 사라진다(AC-N1-2).
- 동점 타이브레이크: **`FAQ` → `INTENT`, 같은 종류 내에서는 `id` 오름차순**(FR-N1-10).
- `boostIntentIds`(동음이의어 해소 확정)는 **여전히 최우선**이다 — `BOOST_SCORE` 가산 규칙을 바꾸지 않는다(ADR-0010의 "부스트가 아니라 확정" 결정 유지).
- `enabled=false` FAQ 제외 판정은 **엔진의 기존 규칙 그대로**다(`faq.ts` 17행). 벡터는 남아 있어도 후보에 들어가지 않는다(AC-N1-16).

**재작성이 필요한 기존 테스트 목록(조용한 변경 금지 — NFR-M4)**: `matcher.spec.ts`/`resolver.spec.ts`/`turn.spec.ts` 중 **부분 문자열 포함 매칭에 의존하는 케이스만** 식별해 `semantic` 미주입(저하 모드) 케이스로 유지하고, 동일 시나리오의 `semantic` 주입 버전을 **추가**한다. `backend-implementer`는 이 목록을 PR 설명에 명시한다.

### 8.8 구간 판정과 되묻기 (ADR-0021)

| 구간 | 조건 | 동작 | trace |
|---|---|---|---|
| 확정 | `s₁ ≥ accept` **그리고** `s₁ − s₂ ≥ margin` | 그 FAQ/의도로 확정 | `SEMANTIC_MATCHED` |
| 모호 | `low ≤ s₁ < accept`, 또는 `s₁ ≥ accept`인데 격차 미달 | 후보 **최대 3건** `MESSAGE` 버튼 되묻기 | `SEMANTIC_AMBIGUOUS` |
| 실패 | `s₁ < low`(후보 0건 포함) | 2단계 이관 또는 기존 폴백 | `SEMANTIC_BELOW_THRESHOLD` |
| 생략 | `semantic` 미주입 | 규칙 매칭 | `SEMANTIC_SKIPPED` |

- **판정 함수는 1곳**(`packages/dialogue-engine/src/semantic.ts`의 `judgeBand()`)이며 엔진·설정 미리보기(FR-N3-5)·시뮬레이터가 **같은 함수**를 쓴다(NFR-M2, AC-N3-9). `apps/api`는 엔진 패키지의 이 함수를 import한다 — 복제하지 않는다.
- 후보가 1건뿐이면 되묻지 않고 확정한다(FR-N1-13).
- 되묻기 턴은 폴백에 도달하지 않으므로 `judgeAnswered(trace)`가 자연히 `true`가 된다 — **판정 함수에 예외 분기를 추가하지 않는다**(FR-N1-14).
- 기본값 `accept=0.80 / low=0.60 / margin=0.05`는 **모델 종속 잠정값**이며, `modelId → 기본 임계값` 매핑을 **코드 상수 1곳**(`shared-types/answering.ts`)에 둔다(FR-N1-26).

### 8.9 색인 수명주기 (DD-76)

| 항목 | 설계 |
|---|---|
| 대상 4종 | `FaqEntry.question` · `FaqEntry.altQuestions[]` · `Intent.name` · `Intent.examples[]`. 답변 본문·노드 아웃풋은 색인하지 않는다 |
| 트리거 | `DialogueBundleService.invalidate(chatbotId)` 내부에서 `ReindexQueueService.schedule(chatbotId)` 호출. 의도/FAQ CRUD·엑셀 임포트 커밋·No.15 `resolve`가 이미 전부 이 지점을 지난다 |
| 단위 | **텍스트 1건**. `textHash`(정규화 문자열 sha256)가 같으면 재임베딩하지 않는다 → FAQ 답변만 고치면 색인 0건(AC-N1-13) |
| 실행 | 단일 인스턴스 in-process 큐. 챗봇당 동시 1건, 배치 64건씩 ml-worker 호출, 배치 간 양보(대화 지연 20% 이내 — NFR-P5) |
| 실패 | best-effort. 저장 트랜잭션을 롤백하지 않고 해당 행을 `FAILED`로 남겨 재시도 대상으로 둔다 |
| 부분 색인 | 색인되지 않은 항목은 후보에서 빠질 뿐 대화는 정상이다(AC-N1-15). 정확일치는 계속 동작한다 |
| 수동 재색인 | `POST /chatbots/:chatbotId/embeddings/reindex`. 챗봇당 동시 1건, 중복 시 `409 REINDEX_IN_PROGRESS` |
| 모델 교체 | `modelId` 불일치 벡터는 **매칭에서 제외**되고 상태 API가 `staleModel: true`를 보고한다. 재색인 중 모델이 바뀌면 진행 중 작업을 취소하고 재시작한다(EX-N1-9) |

---

## 9. 2단계 설계 — 외부 RAG 폴백

### 9.1 `RagHttpClient` 봉인 (ADR-0022, DD-77)

```ts
// rag/lib/rag-paths.ts — 이 파일이 외부 경로 문자열의 유일한 거처다
export const RAG_PATHS = Object.freeze({
  QUERY: '/api/rag/query',
  STATUS: '/api/status',
  DOCUMENT_METADATA: '/api/documents/metadata',
} as const);
export type RagPathKey = keyof typeof RAG_PATHS;
```

```ts
// rag/rag-http.client.ts — 공개 메서드는 정확히 3개
class RagHttpClient {
  query(input: RagQueryInput): Promise<RagQueryRaw>;       // POST RAG_PATHS.QUERY
  status(): Promise<RagStatusRaw>;                          // GET  RAG_PATHS.STATUS
  documentMetadata(): Promise<RagMetadataRaw>;              // GET  RAG_PATHS.DOCUMENT_METADATA
  private send(key: RagPathKey, ...): Promise<unknown>;     // ★ string이 아니라 키만 받는다
}
```

**불변식 5개**

1. **경로를 인자로 받는 공개 메서드가 없다.** `send()`는 `private`이고 파라미터 타입이 `RagPathKey`라 임의 문자열이 컴파일되지 않는다.
2. **`provider`는 DTO·설정·환경변수 어디에도 없다.** `query()` 내부에서 상수 `'pdf'`를 본문에 주입한다(FR-N2-6, AC-N2-2).
3. **`Content-Type: application/json`을 항상 명시한다**(§0-2: 헤더를 빠뜨리면 본문이 무시되고 쿼리스트링을 읽는다). 쿼리스트링 폴백에 의존하지 않는다.
4. **요청 본문 상한을 우리가 먼저 건다** — 질문 200자 + 스코프 문자열. 413(200MB)에 도달할 수 없는 상태를 유지한다.
5. **인증 헤더 주입 지점은 이 클래스 1곳**이다(FR-N2-12). 현재는 자격증명을 저장하지 않는다.

**정적 강제 수단(AC-N2-1을 테스트로)** — `rag/lib/rag-allowlist.spec.ts`:

- `apps/**/src/**`, `packages/**/src/**`(`.ts`)를 읽어 **금지 문자열 4종**(문서 초기화·문서 삭제·전역 설정·프롬프트 관리 경로)의 출현이 **0건**임을 단언한다. `docs/**`는 제외한다.
- **검사기 자신이 그 문자열을 포함하면 안 되므로** 탐지어를 조각으로 조립한다(예: `'/api/docum' + 'ents/reset'`). 이 트릭을 주석으로 명시해 후임자가 "왜 이렇게 썼나"를 묻지 않게 한다.
- 추가로 `RagHttpClient` 밖에서 `RAG_BASE_URL`/`RAG_PATHS`를 참조하거나 `fetch(`가 외부 호스트를 향하는 곳이 없음을 같은 테스트에서 단언한다(FR-0-41, AC-N4-6).

### 9.2 요청 매핑

```jsonc
POST {RAG_BASE_URL}/api/rag/query        Content-Type: application/json
{
  "question": "<PII 마스킹된 원문, ≤200자>",
  "company":  "<ChatbotAnswerSetting.ragCompany>",      // 서버 설정에서만 읽는다
  "category": "<ragCategory 있을 때만>",
  "subcategory": "<ragSubcategory 있을 때만, category 동반 필수>",
  "provider": "pdf",                                     // 클라이언트 상수
  "similarity_threshold": 0.35                           // ragSimilarityThreshold가 null이면 키 자체를 넣지 않는다
}
```

- **공개 대화 요청 본문에서 스코프를 받지 않는다.** 위젯이 `company`를 보내도 무시된다(NFR-S14, AC-N2-3). 이것이 테넌트 경계의 유일한 방어선이다.
- `similarity_threshold`는 **우리가 먼저 `0 < v < 1`을 검증**한다 — 외부 서버는 잘못된 값을 **조용히 무시**하기 때문에(§6-1 함정) 검증하지 않으면 "설정했는데 적용 안 됨"이 침묵한다.
- `question`은 정규화 전 원문 기반이되 **PII 마스킹을 통과한 문자열**이며, 금지어 마스킹이 이미 적용된 턴이면 그 결과를 쓴다(FR-N2-14, AC-N2-4).

### 9.3 응답 스키마와 파싱

```ts
// rag/lib/rag-response.schema.ts — 알 수 없는 필드는 strip. 파싱 실패 = SCHEMA_INVALID(호출 실패)
RagQueryResponseSchema = z.object({
  result: z.string(),
  keywords: z.array(z.string()).default([]),
  source_info: z.object({
    total_sources: z.number(),
    common_metadata: z.object({ company: NAString, category: NAString, subcategory: NAString }).partial(),
    sources: z.array(z.object({
      file_path: z.string(),
      page: z.union([z.number(), z.literal('N/A')]).optional(),
      section_title: NAString.optional(),
      paragraph_id: z.string().optional(),
      highlight_text: z.string().optional(),
      // start_char/end_char는 항상 0이라 스키마에 두지 않는다(§6-3)
    })).default([]),
  }).nullable(),
  retrieval_success: z.union([z.literal(0), z.literal(1)]),
});
```

- 최상위는 **정확히 4필드**(§6-3). 그 밖의 필드는 strip한다.
- 모든 `sources[]` 필드에 **`"N/A"` 허용**이 들어간다(§6-3 경고, FR-N2-22).
- **예외를 사용자에게 전파하지 않는다.** 파싱 실패·HTML 응답·평문 응답은 전부 `SCHEMA_INVALID`로 수렴해 폴백한다(AC-N2-28, EX-N2-6).

### 9.4 성패 판정 순수 함수 (DD-78)

```
judgeRagResponse(httpStatus, parsed) → { ok: boolean, outcome: RagOutcome }

ok = true 조건 (전부 만족)
  ① HTTP 200
  ② zod 파싱 성공
  ③ retrieval_success === 1
  ④ result.trim() !== ''
  ⑤ result가 "답변 생성 중 오류가 발생했습니다" 로 시작하지 않는다   ← §6-5 말미
  ⑥ result가 "실패." 로 끝나지 않는다                                ← §0-3
```

- **`source_info`로 판별하지 않는다**(§6-4의 3번 사례 — 근거는 있는데 LLM이 "모르겠다"고 답한 경우). `retrieval_success`가 유일한 기준이다(AC-N2-7).
- 실패 시 사용자에게는 **우리 폴백 문구**를 보인다. RAG의 실패 문구(`"정보가 부족하여 답변할 수 없습니다"` 및 영어 폴백)를 그대로 노출하지 않는다(FR-N2-19, AC-N2-30).
- 이 함수는 **HTTP를 모른다** — 상태코드와 파싱 결과만 받는다. 모킹 7종(성공/무근거/LLM오류/vLLM503/과부하503/429/스키마불일치, NFR-M6)이 전부 이 함수의 단위 테스트가 된다.

### 9.5 출처 정제 순수 함수

```
sanitizeSources(source_info, { max: 3 }) → Array<{ fileName, sectionTitle?, page? }>
```

| 규칙 | 근거 |
|---|---|
| `file_path`에서 **파일명만** 추출(`/` 기준 마지막 세그먼트) | 서버 절대경로 유출 금지(FR-N2-21, AC-N2-8) |
| `page === 'N/A'` 또는 누락 → 쪽수 **생략** | `"N/A"` 방어(AC-N2-9) |
| `section_title`이 비거나 `"N/A"` → 파일명만 표시 | 동일 |
| 최대 3건 | FR-N2-20 |
| `sources` 빈 배열인데 성공 → **출처 영역을 렌더하지 않는다** | EX-N2-8 |
| `common_metadata.company`가 설정값과 다르면 **경고 로그 + 출처 미표시** | 스코프 오설정 best-effort 탐지(EX-N2-14). "모든 근거의 공통값이라는 보장은 없다"(§6-3)를 감안한 방어 |
| 페이지는 **참고용 표기**이며 "정확한 위치"로 단정하는 문구를 쓰지 않는다 | 엑셀 인입 청크의 `page`가 1 크게 나오는 알려진 결함(§6-3, FR-N2-23) |

### 9.6 `GET /api/documents/metadata` 취급 (P-3)

**외부 응답은 JSON 객체가 아니라 여러 줄 문자열이다**(§2-2). 따라서 `lib/parse-document-metadata.ts` 순수 파서가 필요하다.

```
parseDocumentMetadata(resultText) → { totalChunks, byCompany: Map<company, {total, categories:Map<...>}> }
scopeChunkCount(parsed, { company, category, subcategory }) → number
```

- 파싱 규칙: `총 저장된 벡터의 개수: N` / 들여쓰기 0·2·4칸의 `- {이름}: N개` 3단(§2-2 표 그대로).
- **`"Graph DB가 로드되지 않았습니다."` 는 HTTP 200이지만 실패**다(§2-3) → `UPSTREAM_ERROR`로 처리한다.
- **API 응답에는 `scopeChunkCount` 1개 숫자만 담는다.** 파싱 결과 전체(= 다른 회사명 목록)는 서비스 밖으로 나가지 않는다(FR-N2-7, AC-N3-5). 이것이 P-3의 "타 회사명 노출 금지"를 코드 수준에서 보장하는 지점이다.
- 이 호출은 **관리자 연결 점검 경로에서만** 쓰인다. 대화 경로에서는 절대 호출하지 않는다.

> **P-3 재확인**: 문서 인입·삭제·비동기 task 폴링 아키텍처는 **이 문서 어디에도 없다.** 외부 서버의 인입 기능을 그대로 쓰는 것이 유력하므로, 우리 쪽 업로드 화면·상태기계·task 폴링을 설계하지 않는다. 재검토는 사용자가 No.48을 다시 꺼낼 때다.

### 9.7 실행 조건과 유량 제어

**2단계 실행 조건 9개(전부 만족해야 호출)** — FR-N2-1. 판정은 `rag/lib/should-run-rag.ts` 순수 함수 1개다.

```
① ragEnabled && ragCompany 설정됨        ⑥ 컨텍스트 세션 진행 중이 아님
② 폴백 도달(judgeAnswered === false)      ⑦ 되묻기 해소 턴이 아님
③ 입력이 텍스트 또는 MESSAGE 버튼         ⑧ 정규화 길이 2~200자
④ 금지어 BLOCK 턴이 아님                  ⑨ 회로 닫힘 + 동시성·레이트리밋 여유 + vllm_ready
⑤ fallbackPolicy 판정(NODE_FIRST면 폴백 노드 존재 시 미실행)
```

- **저하 모드에서도 실행된다**(DD-90) — 조건 목록에 임베딩 가용성이 없다.
- 관리자 시뮬레이션은 **기본 미실행**, `useRag: true`일 때만 실행하며 그때도 `ConversationLog`는 적재되지 않는다(FR-N2-3, AC-N2-25). 비교 실행(`/simulate/compare`)은 **항상 미실행**(AC-N2-26).

**유량 제어(`RagGateService`)**

| 장치 | 기본값 | 동작 | 근거 |
|---|---|---|---|
| HTTP 타임아웃 | 120,000ms (**하한 강제**, 상한 300,000) | 초과 → `TIMEOUT`, 재시도 없음 | §6-6 "최소 120초" |
| 재시도 | `429` 1회(3초) / `503`+`code:SERVER_OVERLOAD` 1회(5초) / **`503` `code` 없음(vLLM 미준비) 재시도 금지** / `408`·`500`·타임아웃·`400` 재시도 금지 | 503 두 종류는 **본문 `code` 키 유무로 구분**한다 | §0-4, AC-N2-10/11 |
| 회로차단 | 연속 5회 실패 → 60초 open, half-open 1건 | open 중 즉시 폴백(외부 호출 0건) | AC-N2-12 |
| 동시성 | 5 | 초과 시 **대기하지 않고 즉시 폴백**(큐잉 금지) | 외부 동시 한도 50건(§0-4) 독점 방지, AC-N2-13 |
| 자체 레이트리밋 | 60회/분/인스턴스 | 초과 시 즉시 폴백 | 외부 IP 한도 200회/분(§0-4) 여유 확보 |
| 상태 캐시 | `GET /api/status` 60초 | `vllm_ready === false`면 시도하지 않음. 단 **상태만으로 방어하지 않는다**(vLLM 사망 감지에 최대 15초 지연, §0-5) → 회로차단과 병행 | FR-N2-31 |

- **모든 실패는 폴백으로 수렴한다**(FR-0-43). 사용자는 오류 화면을 보지 않는다.

### 9.8 비동기 전달 — `PENDING` + 폴링 (ADR-0023)

**응답 계약(하위호환 불변식)**

```jsonc
// 2단계를 타지 않는 턴 — 바이트 단위로 현행과 동일하다(AC-N2-16)
{ "messageId": "...", "outputs": [...], "state": {...}, "stateReset": false }

// 2단계를 타는 턴 — 선택 필드 1개만 추가된다
{ "messageId": "...", "outputs": [{ "type":"TEXT", "payload":{ "text":"문서에서 찾아보고 있어요. 잠시만요" } }],
  "state": <요청에 실려온 상태 그대로>, "stateReset": false,
  "pendingAnswer": { "id": "<messageId와 동일>", "pollAfterMs": 1200, "expiresAt": "..." } }
```

- `state`는 **요청 상태를 그대로 보존**한다(금지어 BLOCK 턴과 같은 처리 — EX-12-26 패턴). 폴백 턴은 세션을 바꾸지 않는다.
- `pendingAnswer.id`는 **`messageId`와 같은 값**이다. 별도 식별자를 만들지 않아 로그 1건 규약(DD-81)과 자연히 맞물린다.

**폴링 엔드포인트** — `GET /api/v1/public/chatbots/:slug/messages/:messageId`, `@Public()`(6번째)

| 항목 | 규칙 |
|---|---|
| 응답 | `{ status: 'PENDING'\|'READY'\|'FAILED', outputs?, sources? }` |
| 규약 상속 | 레이트리밋(세션 30/분·IP 120/분)·Origin 가드·내부 식별자/`trace` 미노출(ADR-0011) |
| 추측 방어 | ① `messageId`는 UUID v4 ② 다른 슬러그의 id면 `404`(AC-N2-18) ③ TTL(기본 5분) 경과 후 `404 PENDING_ANSWER_NOT_FOUND`(AC-N2-19) ④ `READY` **최초 조회 후 30초 유예**를 두고 제거(네트워크 재시도 허용, 무한 재조회 차단) |
| 지연 예산 | 50ms(P95) — 메모리 조회 1회 |

**`PendingAnswerStore` 인터페이스(FR-N2-37)**

```ts
interface PendingAnswerStore {
  create(id: string, meta: { chatbotId: string; slug: string; expiresAt: Date }): void;
  complete(id: string, result: PendingAnswerResult): void;
  get(id: string, slug: string): PendingAnswerEntry | null;   // 슬러그 불일치는 null(=404)
}
```

- 1차 구현은 `InMemoryPendingAnswerStore`(Map + TTL 스위퍼). **단일 인스턴스 전제**이며 다중 인스턴스 전환 시 교체 지점은 1곳이다(개발명세서 §5 확장성 규약, ADR-0007 스테이징과 같은 패턴).
- 서버 재시작으로 보류 답변이 사라지면 폴링이 `404` → 위젯이 정리 문구로 마감한다. **사용자에게 오류를 보이지 않는다**(EX-N2-12).

**위젯 폴링 규격(FR-N2-38/39)**: 최초 `pollAfterMs`(1,200ms) 대기 → 1.5초 간격 → **최대 90초**. 초과 시 정리 문구. 폴링 중 입력을 잠그지 않으며, 새 질문 전송 시 이전 폴링을 중단한다. 대기는 진행 표시 + `aria-live="polite"`로 **시각·보조기술 양쪽에 알린다**.

### 9.9 로그 1건 규약 (DD-81)

```
PENDING 반환 시점   : ConversationLog 적재 없음. messageId만 선발급
백그라운드 완료 시점 : ConversationLogService.record({ id: messageId, ... }) 1회
  ├ 성공 → isAnswered=true,  answeredByRag=true,  botResponse=RAG 답변(마스킹 후)
  └ 실패 → isAnswered=false, answeredByRag=false, botResponse=폴백 문구
             → 기존 미응답 큐 수집 조건이 자동으로 성립(ADR-0019, 추가 분기 없음)
동시에            : RagCallLog 1건(원문 없음)
```

- RAG 성공 턴은 `isAnswered=true`이므로 **미응답 큐에 들어가지 않는다** — `answeredByRag` 조건을 수집기에 추가할 필요가 없다(AC-N2-20).
- **프로세스가 죽으면 그 턴의 로그가 유실된다.** 수용 가능한 손실로 판단한다(대화 응답은 이미 사용자에게 전달됐고, 통계상 1턴 결손이다). 재검토 트리거는 다중 인스턴스 전환이다. §14에 리스크로 등재한다.
- RAG 답변도 **출구 금지어 마스킹을 거친다**(EX-N2-16). 외부 답변이라고 예외를 두지 않는다.
- 답변 본문은 **2,000자 상한** + 초과 시 절단·말줄임(FR-N2-25).

---

## 10. API 설계 (개발명세서 §4 확장)

### 10.1 신규 엔드포인트 7개

| # | 메서드·경로 | 권한 | 요약 | 주요 상태코드 |
|---|---|---|---|---|
| 1 | `GET /chatbots/:chatbotId/answer-settings` | `chatbot:read` | 1·2단계 설정 조회. **행이 없으면 기본값을 반환**한다(404 아님) | 200 / 404(챗봇) |
| 2 | `PUT /chatbots/:chatbotId/answer-settings` | `chatbot:write` | 전체 교체(부분 수정 아님 — 필드 간 상호 제약이 많다). 저장 즉시 다음 턴부터 적용(설정 캐시 무효화) | 200 / 400 `INVALID_THRESHOLD` / 409 `CHATBOT_ARCHIVED` |
| 3 | `POST /chatbots/:chatbotId/answer-settings/preview` | `chatbot:read` | 임계값 미리보기. 시험 문장 → `{ band, top3: [{kind,id,label,score}], wouldUseRag }`. **저장하지 않고 외부 RAG를 호출하지 않는다** | 200 / 503 `EMBEDDING_UNAVAILABLE` |
| 4 | `POST /chatbots/:chatbotId/answer-settings/test` | `chatbot:write` | 연결 점검. `{ upstreamStatus, vllmReady, neo4jReady, scopeChunkCount, checkedAt }`. **`/api/rag/query`를 호출하지 않는다**(AC-N3-4) | 200 / 400 `RAG_NOT_CONFIGURED` / 503 `RAG_UPSTREAM_UNAVAILABLE` |
| 5 | `GET /chatbots/:chatbotId/embeddings/status` | `chatbot:read` | `{ modelId, dimension, totalTargets, indexed, pending, failed, staleModel, lastIndexedAt, providerHealthy }` | 200 |
| 6 | `POST /chatbots/:chatbotId/embeddings/reindex` | `chatbot:write` | 전체 재색인. 챗봇당 동시 1건 | 202 / 409 `REINDEX_IN_PROGRESS` / 503 `EMBEDDING_UNAVAILABLE` |
| 7 | **`GET /public/chatbots/:slug/messages/:messageId`** | **`@Public()`(6번째)** | 보류 답변 폴링. `{ status, outputs?, sources? }` | 200 / 404 `PENDING_ANSWER_NOT_FOUND` / 429 |

**기존 엔드포인트 확장 1건**: `POST /chatbots/:chatbotId/simulate` 요청에 선택 필드 `useRag?: boolean`(기본 `false`), 응답에 선택 필드 `matchTrace?: { band, top3, ragUsed, ragLatencyMs, ragSourceCount }`. **관리자 API에만** 노출한다(AC-N3-8).

- `answer-settings`가 `PUT`인 이유: 세 임계값·스코프 3종·정책 필드가 **서로 검증 제약을 공유**한다(`low < accept`, `subcategory ⇒ category`, `ragEnabled ⇒ company`). 부분 수정을 허용하면 "부분 적용된 불완전 조합"이 만들어질 수 있다. `Channel.config` 전체 교체와 같은 판단(개발명세서 §3.1).
- 통계·학습현황과 달리 이 경로들은 **`ARCHIVED` 챗봇에서 쓰기가 금지**된다(일반 쓰기 규약 적용). 조회는 허용한다(EX-N2-17).

### 10.2 개발명세서 §4 표 갱신분

| 대상 행 | 갱신 |
|---|---|
| **`AI 엔진(ml-worker 프록시)`** | "`POST /training-jobs`…" 유지 + 각주: "**이번 그룹(No.18 부분)은 `TrainingJob`을 쓰지 않는다** — ml-worker는 추론 전용이고 Job Queue가 없다. 임베딩 색인은 `/chatbots/:chatbotId/embeddings/*`로 제공한다(ADR-0024)" |
| **`옵션(RAG 등)`** | "`POST /rag/query`" **삭제**. "**우리 API에 RAG 프록시 엔드포인트를 만들지 않는다** — 외부 RAG 호출은 `apps/api` 내부의 `RagHttpClient` 전용이며 공개 표면이 없다(ADR-0022, DD-86). 남은 `/agentic/tasks`·`/voice/*`는 해당 기능 Phase 예고" |
| **신규 행 `AI 답변 설정`** | `GET｜PUT /chatbots/:chatbotId/answer-settings`, `POST .../answer-settings/preview｜test`, `GET /chatbots/:chatbotId/embeddings/status`, `POST .../embeddings/reindex` / 기능 `6, 9, 18, 30` |
| **`공개 대화(인증 없음)` 행** | `GET /public/chatbots/:slug/messages/:messageId` **추가**(보류 답변 폴링) |
| §4.1 권한 행 | "`@Public()`… **정확히 5곳**" → "**정확히 6곳**(`/api/health`, 공개 대화 2, **보류 답변 폴링 1**, `/auth/login`, `/auth/logout`)" + 근거 각주 |

### 10.3 오류 코드 7종 (ADR-0003 봉투 불변)

| 코드 | 상태 | 발생 지점 |
|---|---|---|
| `RAG_NOT_CONFIGURED` | 400 | 연결 점검/설정 저장 시 `company` 미설정 |
| `RAG_UPSTREAM_UNAVAILABLE` | 503 | 연결 점검에서 외부 서버 도달 실패·`unhealthy` |
| `RAG_DISABLED` | 400 | RAG 비활성 상태에서 점검·미리보기의 RAG 항목 요청 |
| `EMBEDDING_UNAVAILABLE` | 503 | 미리보기·재색인 시 임베딩 서비스 불가 |
| `REINDEX_IN_PROGRESS` | 409 | 재색인 중복 요청 |
| `PENDING_ANSWER_NOT_FOUND` | 404 | 폴링 대상 없음·TTL 만료·슬러그 불일치 |
| `INVALID_THRESHOLD` | 400 | 임계값 제약 위반 |

> **대화 경로는 이 코드들을 쓰지 않는다.** 2단계 실패는 전부 폴백으로 수렴하므로 공개 API가 오류를 반환하는 일이 없다(FR-0-43).

---

## 11. 보안 · 권한 · 감사

### 11.1 `@Public()` 5 → 6 (DD-80)

| # | 경로 | 핸들러 |
|---|---|---|
| 1 | `GET /api/health` | `HealthController#check` |
| 2 | `GET /api/v1/public/chatbots/:slug/config` | `PublicConversationController#getConfig` |
| 3 | `POST /api/v1/public/chatbots/:slug/messages` | `PublicConversationController#sendMessage` |
| 4 | `POST /api/v1/auth/login` | `AuthController#login` |
| 5 | `POST /api/v1/auth/logout` | `AuthController#logout` |
| **6** | **`GET /api/v1/public/chatbots/:slug/messages/:messageId`** | **`PublicConversationController#pollMessage`** |

- **근거**: 폴링은 방금 자신이 보낸 질문의 답을 받는 동작이며, 공개 대화 API와 **같은 신뢰 경계**에 있다. 인증을 요구하면 위젯이 답을 받을 수 없다.
- **보상 통제 4가지**: UUID v4 추측 불가 · 슬러그 교차 조회 차단 · TTL 5분 · `READY` 단발 조회(+30초 유예). 응답에는 내부 식별자·`trace`·점수가 없다.
- 개수 고정 테스트는 **6으로 갱신**하고, `security-audit.md` AC-C-4에 갱신 각주를 남긴다(§15).

### 11.2 권한 (DD-87, 신규 0종)

| 동작 | 권한 |
|---|---|
| 설정·색인 상태·미리보기 조회 | `chatbot:read` |
| 설정 저장·연결 점검·재색인 | `chatbot:write` |
| 폴링 | 없음(`@Public()`) |

VIEWER는 저장·점검·재색인 버튼이 렌더되지 않으며, API 직접 호출 시 `403`이고 DB가 변경되지 않는다(AC-N3-6).

### 11.3 감사 (ADR-0016 규약 재사용)

- 기록 대상은 **설정 저장 1종**뿐이다 — `targetType: 'Chatbot'`, `action: 'UPDATE'`, 화이트리스트 스냅샷에 **임계값 3종·`ragEnabled`·`semanticEnabled`·스코프 3종·정책·타임아웃**을 담는다(FR-N3-9).
- **대화 문장·질문 원문은 감사로그에 담지 않는다**(AC-N1-19, NFR-S8 유지).
- 재색인·연결 점검은 **감사 대상이 아니다** — 설정을 바꾸지 않는 조회·재계산 동작이다(ADR-0019가 큐 상태 변경을 감사 대상에서 뺀 것과 같은 기준은 아니며, 여기서는 "변경이 없다"가 이유다).

### 11.4 잔존 리스크 R-1 (P-4)

> **외부 RAG 서버는 무인증·공인 IP·평문 HTTP(`http://118.129.180.214:28081`)이며 우리 통제 밖이다.** 사내 문서 질의가 제3자에게 관측될 수 있다.
>
> **현 단계 취급**: 개발 단계 리스크로 **수용**한다. 서버 측 보안 조치를 이번 범위에서 요구하지 않는다.
>
> **전제 조건(실제 고객 배포 전)**: ① 내부망 이전 ② 인증 도입 ③ 전송 구간 TLS — **최소 1개 충족**. 미충족 시 2단계는 구축형 고객사에 제공하지 않는다(`기능요구사항.md` No.30 구축형 △의 실질 근거).
>
> **우리 쪽에서 이미 한 것**: PII 마스킹 후 송신(J-9) · 파괴적 엔드포인트 호출 불가(ADR-0022) · 스코프 서버 고정(NFR-S14) · 자격증명 미저장 + 인증 헤더 주입 지점 1곳 확보(FR-N2-12).

### 11.5 그 밖의 보안 불변식

| ID | 불변식 | 강제 수단 |
|---|---|---|
| NFR-S11 | 파괴적 외부 엔드포인트 문자열 **저장소 0건** | `rag-allowlist.spec.ts` 정적 검사(§9.1) |
| NFR-S12 | 외부 HTTP는 `RagHttpClient` 1곳 | 같은 테스트 + 코드리뷰 |
| NFR-S13 | 외부 송신 문장 PII 마스킹, 함수 1벌 | `packages/pii-mask` 승격(§7.3) |
| NFR-S15 | `file_path`·내부 오류 문자열 사용자 미노출 | `sanitizeSources`/`judgeRagResponse` 순수 함수(§9.4~9.5) |
| NFR-S18 | 시뮬레이션의 `useRag: true` 호출도 **PII 마스킹 적용** | `RagAnswerService` 단일 경로 통과 |

---

## 12. 성능 목표 (개발명세서 §5 갱신 대상)

| 항목 | 목표 | 비고 |
|---|---|---|
| **RAG 경유 답변 생성** | **5초(P95)** | **P-5 확정치.** 외부 RAG 서버 왕복 기준(요청 조립 → 응답 판정 → 저장 완료). **이 5초는 목표(SLO)이고, HTTP 타임아웃 120초는 안전장치**다 — 둘을 혼동하지 않는다. 초과가 상시화되면 스코프 축소·`similarity_threshold` 조정·외부 서버 증설을 검토한다 |
| **공개 대화 API(2단계 진입 턴)** | **`PENDING` 200ms(P95)** | 5초를 **기다리지 않는다**. 위젯이 `pollAfterMs`(1.2초) 후 1.5초 간격으로 폴링하므로 5초 목표 달성 시 **대개 3회 이내 폴링에서 최종 답변이 도착**한다 |
| 폴링 엔드포인트 | 50ms(P95) | 메모리 조회 1회 |
| 공개 대화 API(일반 턴) | **500ms(P95) 불변** | 내역: 임베딩 ≤300ms(타임아웃) + 유사도 ≤20ms + 기존 예산. 1단계가 이 예산을 깨지 않는 것이 전제다 |
| 유사도 계산 | 5,000벡터 20ms(P95) | 초과 시 후보 축소가 아니라 **인덱스 도입 재검토**(챗봇당 2만 벡터 트리거) |
| 전체 재색인 | 5,000건 10분(CPU) | 재색인 중 대화 응답 지연 증가 20% 이내 |
| 위젯 하드 상한 | **90초** | 초과 시 정리 문구로 마감하고 입력 재활성화(S-15). 백그라운드 작업은 계속되어 로그에만 남는다 |
| N+1 금지 | 턴당 임베딩 1회·RAG 1회(재시도 제외) | NFR-P7 |

> **개발명세서 §5의 기존 문구 "LLM/RAG 경유 응답은 3초 이내(P95, 옵션기능)"는 폐기한다.** 외부 API 실측이 "수 초~수십 초"(§6-6)이고 동기 3초 전제 자체가 성립하지 않는다. 대체 문구는 위 표의 첫 두 행이다.

---

## 13. 환경변수 (개발명세서 §5.1 확장) — 11종 전부 선택

| 변수 | 위치 | 기본값 | 용도 |
|---|---|---|---|
| `EMBEDDING_BASE_URL` | `apps/api/.env` | (없음) | **미설정 = 1단계 비활성** |
| `EMBEDDING_TIMEOUT_MS` | `apps/api/.env` | `300` | 질의 임베딩 클라이언트 타임아웃(FR-N1-31) |
| `EMBEDDING_CACHE_SIZE` | `apps/api/.env` | `1000` | 질의 임베딩 LRU 건수 |
| `EMBEDDING_CACHE_TTL_MS` | `apps/api/.env` | `600000` | 질의 임베딩 LRU TTL |
| `VECTOR_CACHE_MAX_BYTES` | `apps/api/.env` | `268435456` | 챗봇 벡터 메모리 캐시 상한(256MB, §8.5) |
| `RAG_BASE_URL` | `apps/api/.env` | (없음) | **미설정 = 2단계 비활성**. 코드·DB·API 응답에 하드코딩하지 않는다 |
| `RAG_TIMEOUT_MS` | `apps/api/.env` | `120000` | **하한 120000 강제**(미달 시 보정 + 경고 로그, AC-N2-14). 상한 300000 |
| `RAG_MAX_CONCURRENCY` | `apps/api/.env` | `5` | 동시 호출 상한 |
| `RAG_RATE_LIMIT_PER_MIN` | `apps/api/.env` | `60` | 자체 레이트리밋 |
| `RAG_CIRCUIT_FAILURE_THRESHOLD` / `RAG_CIRCUIT_OPEN_MS` | `apps/api/.env` | `5` / `60000` | 회로차단기 |
| `RAG_STATUS_CACHE_MS` | `apps/api/.env` | `60000` | `GET /api/status` 캐시 |
| `PENDING_ANSWER_TTL_MS` | `apps/api/.env` | `300000` | 보류 답변 TTL(5분) |
| `ML_WORKER_PORT` / `EMBEDDING_MODEL_ID` / `EMBEDDING_DEVICE` | `apps/ml-worker/.env` | `8100` / (모델 확정 후) / `cpu` | ml-worker 전용 |

- 전부 `EnvSchema`의 **선택 변수**다. 하나도 설정하지 않아도 API가 기동하고 현행 규칙 매칭으로 동작한다(AC-N4-1).
- `RAG_TIMEOUT_MS`의 하한 보정은 **기동 시 1회 경고 로그**로 드러낸다(조용히 고치지 않는다).

### 13.1 seed 전략

- 기존 seed 챗봇 중 **1개에만** `ChatbotAnswerSetting` 행을 만들고 `semanticEnabled=false`/`ragEnabled=false`로 둔다 — 화면의 "설정 있음" 경로를 렌더할 수 있게 하되, **기본 동작은 비활성**을 유지한다.
- `EmbeddingVector`·`RagCallLog` seed는 **만들지 않는다.** 벡터는 실제 모델의 산출물이라 가짜 값이 임계값 감각을 왜곡한다.

---

## 14. 이 Phase에서 하지 않는 것 (아키텍처 관점 재확인)

| 항목 | 이유 | 재검토 트리거 |
|---|---|---|
| **문서 인입·삭제·task 폴링 아키텍처** | **P-3.** 외부 서버의 인입 기능을 그대로 쓰는 방향이 유력하다. 우리 쪽 상태기계를 만들지 않는다 | 사용자가 No.48을 다시 꺼낼 때 |
| 외부 RAG의 프롬프트·전역 설정 관리 | 무인증 관리자 API이며 **다른 이용자 응답까지 바꾼다**(§7·§8) | 서버에 인증·테넌트 격리가 생길 때 |
| 우리 API의 RAG 프록시 엔드포인트 | allowlist 봉인이 무의미해진다(DD-86) | 없음(영구) |
| `packages/llm-provider` 생성 | 이번 범위에 자체 LLM 호출이 없다 | No.16/No.24/생성형 기능 착수 시 |
| Redis/BullMQ Job Queue | 재색인은 in-process로 충분하다 | 다중 인스턴스 전환 또는 No.16 학습 도입 |
| 벡터 인덱스(HNSW/pgvector) | 챗봇당 수천 벡터에 과설계 | 챗봇당 2만 벡터 초과 |
| 리랭킹(cross-encoder)·하이브리드 검색 | 임계값 체계를 다시 세워야 한다. 단일 인코더 골든셋 결과를 먼저 본다 | 1차 보정 정밀도 미달 시 |
| RAG 답변 캐싱·스트리밍 | 외부가 스트리밍 미지원(§6-6). 문서 변경 통지 수단이 없어 캐시가 거짓이 된다 | 상위 API 지원 시 |
| 다중 인스턴스 보류 답변 공유 | 인터페이스 추상화만 남긴다 | Redis 도입 시 |
| `RagCallLog` 보존기간·정리 배치 | 스케줄러 인프라 없음(선행 그룹과 동일 판단) | No.45 |

**등재 리스크**

| ID | 리스크 | 완화 |
|---|---|---|
| R-1 | 외부 서버 무인증·평문(§11.4) | 배포 전 전제조건 3택1 |
| R-2 | **최고 성능 모델의 CPU 지연이 300ms 예산을 넘김** | §8.1의 완화 4단계. 실측이 ml-engineer 첫 산출물 |
| R-3 | 저하 모드에서 부분일치 오탐이 되살아남 | 의도된 가용성 판단(FR-N1-34). 관리자 화면 경고 배지 + 저하 모드 지속 시간 관측 |
| R-4 | 프로세스 재시작 시 보류 답변·미적재 로그 유실 | 사용자 영향은 정리 문구로 흡수. 통계 1턴 결손은 수용 |
| R-5 | 임계값 기본값이 모델 종속 잠정값 | `modelId → 기본값` 매핑 1곳 + 골든셋 보정 보고서(AC-N1-12) |
| R-6 | 의미 매칭이 **노드 트리거 동작을 바꿈** | AC-N1-6으로 명시 고정 + 배포 순서(§6.6)에서 `semanticEnabled`를 마지막에 켠다 |

---

## 15. 다음 단계 인계

| 대상 | 인계 사항 |
|---|---|
| `ml-engineer` | **가장 먼저 끝나야 하는 산출물**: ① §8.1 후보 3종 실측표(5지표) ② 골든셋 100문항 + `τ` 스윕 보고서(AC-N1-12) ③ ml-worker `POST /embed`·`GET /health` 구현 ④ CPU P95 실측으로 §8.1 완화 단계 결정 ⑤ `modelId` 문자열 확정(§8.1 규약) |
| `backend-implementer` | ① `embedding`/`rag`/`answer-settings` 3모듈 ② 엔진 수정은 **`ResolveOptions.semantic` 소비 + 부분일치 제거 + `semantic.ts` 신설 3건으로 한정** ③ `packages/pii-mask` 승격(동작 변경 0) ④ `rag-allowlist.spec.ts` 정적 검사 ⑤ `conversation` 파이프라인 확장(주입·PENDING·폴링·로그 1건) ⑥ 재작성한 부분일치 의존 테스트 목록을 PR에 명시 |
| `ui-designer` | ① `AI 답변 설정` 정보구조(챗봇 상세 탭 과밀 문제와 함께 판단) ② 임계값 슬라이더 + **수치 입력 대체 수단** + 3구간 시각화 ③ 미리보기 패널 ④ 색인/연결 상태 배지(색상+텍스트) ⑤ **위젯 대기 UX**(진행 표시·`aria-live`·90초 정리 문구) ⑥ 되묻기 버튼 3건 레이아웃 ⑦ 출처 표기(링크 아님·`"N/A"` 대응) ⑧ 빈 상태 3종 ⑨ **위험 동작이 없다는 사실을 화면으로 보이게 하기**(문서 관리는 별도 기능 안내) |
| `frontend-implementer` | `apps/web` 설정 화면·시뮬레이터 패널 / **`apps/widget` 폴링·대기 UI·되묻기 버튼·출처 표기**(이번 그룹은 위젯 수정이 **있다**) |
| `test-automation` | AC-N2-1(정적 검사) · AC-N2-3/4(스코프 위조·PII) · AC-N2-6/7(판정 두 함정) · AC-N1-2(오탐 제거) · AC-N1-3/AC-N4-2(저하 모드 = 현행) · AC-N4-1(환경변수 0개 기동) · **AC-N4-3(`@Public()` 6개)** · AC-N2-16(응답 하위호환). **외부 서버 실호출 테스트를 CI에 넣지 않는다**(전부 모킹) |
| `code-reviewer` | §11.5 불변식 5종 + 턴당 임베딩 1회 + 임계값 판정 1곳 + `@Public()` 6개 초과 금지 + 신규 원시 SQL 0건 |

### 15.1 상위 문서 갱신 (이 설계서가 요청하는 것)

| 문서 | 갱신 |
|---|---|
| `docs/02-spec/개발명세서.md` | §1·§2·§2.2·§3·§3.1·§4·§4.1·§5·§5.1·§6·§7 — 본 문서 §4·§6.5·§10.2·§12·§13 기준(system-architect가 동시에 반영) |
| `docs/requirements/security-audit.md` **AC-C-4** | "정확히 **5개**" → **갱신 각주 추가**: 이 그룹에서 **6개**로 의도적 갱신(6번 = 보류 답변 폴링). 원문 5개 표는 이력으로 보존 |
| `docs/01-requirements/기능요구사항.md` | No.6/No.9 각주(매칭 엔진 교체) · No.18 각주(GPU 5 → **4**, 추론 전용) · No.30 각주(GPU 8 → **1**, 외부 위임) — **No.48 신설은 보류**(P-3) |
| `docs/04-test/시험항목.md`·`시험데이터.md` | 의미 매칭 케이스 4종 + 골든셋 100문항 + 외부 응답 모킹 7종 |
| `docs/03-design/UIUX_준수기준.md` | **비동기 답변 대기 패턴**(진행 표시 + `aria-live` + 포기 시 정리 문구) |

---

## 16. 요구사항 ↔ 설계 추적표 (발췌)

| 요구사항 | 설계 |
|---|---|
| J-1 / FR-N1-1~7 | §4, §8.1~§8.5, ADR-0024 |
| J-2·J-3 / FR-N1-8~11 | §8.6~§8.7, ADR-0020 |
| J-4 / FR-N1-25~30 | §6.2, §8.8, ADR-0021 |
| FR-N1-16~24 | §8.9, §6.1 |
| J-5·J-6 / FR-N2-5~12 | §9.1~§9.2, ADR-0022 |
| FR-N2-13~25 | §9.2~§9.5 |
| FR-N2-26~32 | §9.7, §6.4 |
| J-7 / FR-N2-33~40 | §9.8~§9.9, ADR-0023 |
| J-8 | §9.6, §14, ADR-0022 §4 |
| J-9 / NFR-S13 | §7.3, §9.2 |
| J-10 / FR-14/15 정합 | §6.3, §9.9 |
| FR-N3-1~12 | §10.1, §15(ui-designer 인계) |
| NFR-P1~P7 | §12 |
| NFR-S11~S19 | §11 |
| NFR-M1~M6 | §7.2, §8.7, §9.4 |
