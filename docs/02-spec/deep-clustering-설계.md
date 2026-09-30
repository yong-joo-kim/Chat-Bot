# 딥러닝 군집분석(발화 묶음 분석) 세부 설계서 (No.21)

> **요구사항**: `docs/requirements/deep-clustering.md`(J-1~J-12, R-1~R-6, FR-0-286~297, FR-DC1-\*~FR-DC9-\*, NFR-DCP/DCS/DCR/DCA/DCM, AC-DC1~DC7, EX-DC-1~20, P-1~P-12). FR-DC10(규모 B — 내부 대화 기록 입력)은 PM이 규모 A를 골라 **이번 범위 밖**이다.
> **상위 문서**: `docs/02-spec/개발명세서.md` §1·§2·§2.1·§2.2·§3·§3.1·§4·§5.1·§6(**결정 48 신설** · 결정 29·30 갱신 각주)·§7 · `docs/01-requirements/기능요구사항.md` 21·22·47·58행·§5 · ADR-0024·0026·0027·0046 · `docs/05-ops/자동배포.md` · `docs/02-spec/data-governance-설계.md` §8.1 — 반영 문구는 **`docs/02-spec/deep-clustering-patches.md`**(찾기/바꾸기 37건 · ⏳ 미적용 — 오케스트레이터가 적용. 대상 파일이 CRLF라 전체 재작성 대신 패치로 남긴다 · §25).
> **신규 ADR**: **ADR-0047**(군집 연산 위치 = `apps/api` · 구면 k-평균 · 자체 상태 테이블 · 기능 보존 일수 · 반영 경로 1곳 · 이름 제안 = ml-worker 생성 프로파일 선택 경로). `decisions/`의 현재 최대 번호는 **0046**이고, 저장소 `docs/` 전체에서 `ADR-0047` 이상을 적은 문서는 0건이다(미커밋 보류 초안 `plugin-marketplace.md`·`connector-hub.md`·`nocode-scenario-design.md`·`nlg-bot-to-bot.md` 포함 확인). 가번호는 예약이 아니다(ADR-0045 §12) — 이 결정이 **0047**을 쓴다.
> **갱신 ADR(각주)**: ADR-0024(재검토 트리거 "No.21 착수 시 다시 판정" → 판정 완료) · ADR-0027(재검토 트리거 "No.21 착수 → 학습 위치 재판정" → 판정 완료) · ADR-0026·ADR-0046(재검토 트리거 "두 번째 LLM 소비자 → `packages/llm-provider` 승격" → **발동 판정 · 미승격**)
> **작성일**: 2026-09-30 · **GPU**: **7 → 5 + 각주**(P-10 권고 채택) · 구축형 ○ · 구독형 △(+ 각주: 상담 전사본의 개인정보 밀도)
> **구현 담당**: `backend-implementer`(업로드·작업·대조·저장·반영·내보내기·보존·감사·거버넌스 편입) + `ml-engineer`(군집 순수 함수·대표 키워드 점수·품질 측정 도구·첫 보고서·ml-worker 이름 제안 경로) + `ui-designer`(화면 3개 상세) + `frontend-implementer`. 역할 분담은 §21.
> **표기**: 봉인 **DC-1~DC-16** · 의도된 기존 시험 기대값 변경 **닫힌 목록(FR-0-297) = 4건**(§20.6) · 코드에서 찾은 제약 **C-1~C-12** · 알려진 제한 **K-1~K-14** · 요구사항 대비 해석·조정 **R-1~R-22** · 새로 발견한 기존 결함 **D-1~D-4** · 구현 편차는 구현 후 §27에 **I-n**으로 기록

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

관리자가 **이미 글자로 된 발화 목록(엑셀/CSV)** 을 올리면, 서버는 요청 처리 안에서 파일을 읽어 **금지어 → PII 마스킹**을 끝낸 문장만 메모리에 남기고(원본 파일·원문 저장 0), 비동기 작업으로 ① 기존 ml-worker `/embed`(KURE-v1)로 문장 벡터를 얻고 ② **`apps/api` 안에서 구면 k-평균**으로 비슷한 말끼리 **묶음**을 만들고(작은 묶음은 "미분류") ③ 기존 형태소 분석기(garu)로 묶음별 **대표 키워드**를 뽑고 ④ 같은 벡터로 **지금 챗봇이 답하는지 대조**(대화 기록을 남기지 않는 No.19 규약)하고 ⑤ (서버 설정으로 켰을 때만) ml-worker 생성 프로파일에 **묶음 이름 제안**을 요청한 뒤 ⑥ 결과 전부를 **한 트랜잭션**으로 저장한다. 관리자는 결과를 보고 엑셀로 내려받거나, 고른 발화(≤50)를 **확인 화면을 거쳐** 기존 의도 예문 반영 경로(`IntentsService.applyLearningExample()` → `LearningApplyService.applyLearning()` 1회)로 넣는다. 분석 데이터는 **마스킹본만** 저장되고 **90일(설정) 뒤 파기 잡이 행을 삭제**한다. **대화 경로·위젯·엔진·채널 어댑터·`@Public()`·출구 클래스·권한은 한 줄도 바뀌지 않는다.**

> 이 설계가 코드에서 **추가로 찾은 제약 12건**(요구사항 §0.2 외):
> **C-1 `scikit-learn` 1.7.2가 ml-worker venv에 이미 있다 — 그러나 선언된 의존성이 아니다.** `sentence_transformers` 6.1.0의 `Requires-Dist: scikit-learn>=1.1.0`로 들어온 간접 의존성이다(`apps/ml-worker/.venv/Lib/site-packages/scikit_learn-1.7.2.dist-info`). `sklearn.cluster.HDBSCAN`(1.3+)도 존재한다(`sklearn/cluster/_hdbscan/hdbscan.py`). `pyproject.toml`에는 없다 → 버전이 통제되지 않는다(§5.1).
> **C-2 ml-worker venv가 `pyproject.toml`의 버전 범위를 이미 벗어나 있다** — `sentence-transformers` 6.1.0(선언 `<4.0`) · `numpy` 2.2.6(선언 `<2.0`) · `pytest` 9.1.1(선언 `<9.0`) · `transformers` 5.17.0 · 설치된 `ml_worker` 메타데이터도 옛 `pyproject`(httpx가 dev 추가 의존성) 기준이다. 개발 PC의 ml-worker 시험 결과가 새 설치를 대표하지 않는다 → **D-1**(이 그룹의 원인 아님 · 인계).
> **C-3 `TrainingJobQueue`는 `AsyncJobStatusSink` 포트로 상태 기록을 분리해 두었다**(`training-job.queue.ts` 24~33행). `TestRun`이 두 번째 구현이다(`test-run-status.sink.ts`). ADR-0027 갱신①은 "Training이 아닌 작업은 `TrainingJob`에 넣지 않는다"를 선례로 남겼다 → 분석 작업도 **자기 테이블이 상태를 소유**한다(`TrainingJobKind` 추가 0 — R-1).
> **C-4 `TrainingJobQueue.enqueue()`는 직렬화하지 않는다**(fire-and-forget `void this.run()`). 동시 실행 상한은 큐가 아니라 **DB 제약**으로 걸어야 한다(§8.2).
> **C-5 `TestRunExecutor`는 `TestCase`·`TestRun` 테이블·다중 턴·오버레이·API 목·RAG 시도에 결합돼 있고 `runSide()`가 `private`이다**(`test-run.executor.ts` 442행). 클래스를 그대로 재사용하려면 검증 모듈을 고쳐야 한다(회귀 표면 · `validation-sealing.spec.ts`) → **규약과 부품을 재사용**하고 실행기 클래스는 건드리지 않는다(§9 · R-2).
> **C-6 `IntentsService.applyLearningExample()`은 예문 1건씩 받는다**(`intents.service.ts` 303~384행)이며 다른 의도와의 중복은 **경고(`conflicts`)** 로만 돌려준다(107~123행 `computeConflicts`). 증강 승인(`augmentation-accept.service.ts`)도 건별 호출 + 요청당 `applyLearning()` 1회 + 부분 성공 선례다 → 같은 모양을 따르되 "다른 의도에 이미 있음"은 이 경로에서 **제외**로 강화한다(EX-DC-11 · R-5).
> **C-7 `asset-write-sealing.spec.ts` S-2는 `applyLearningExample(` 호출 파일을 정확히 3개로 단언한다**(123~139행). 반영 경로 1곳 추가 = 닫힌 목록 1건(§20.6).
> **C-8 `governance-sealing.spec.ts` G-15는 `recordExport(` 호출 파일 3개 · `VIEW_AUDIT_TARGETS` 11개를 단언한다**(575~600행). 엑셀 다운로드 감사·발화 목록 열람 감사 = 닫힌 목록 2건.
> **C-9 `RetentionTargetKind`의 전역 값은 "키 없음 = 무기한"이다**(`retention-policy.ts` 29행 · `retention-policy.service.ts` 92행 `DEFAULT` = 무기한). PM이 확정한 "기본 90일 자동 삭제"를 이 틀에 넣으려면 한 종류만 "키 없음 = 90"이라는 예외 의미를 만들어야 한다 → 보존 종류를 늘리지 않고 **기능 설정 일수 + 행 만료 시각 고정 + 기존 파기 잡 단계 추가**로 한다(§14 · R-3).
> **C-10 `MorphAnalyzerFactory`는 `LearningModule`의 provider이고 export되지 않는다**(`learning.module.ts` 45·48행). 다른 모듈이 provider로 한 번 더 등록하면 garu(WASM)가 두 번 적재된다. `LearningModule`을 통째로 import하면 미응답 수집기(`UnansweredCollectorService` — `UnansweredQuestion` 쓰기)가 DI 그래프에 들어온다 → **형태소 분석기만 작은 모듈로 분리**해 두 모듈이 공유한다(§6.4).
> **C-11 판정 함수 `judgeAnswered(trace)`는 `conversation/lib/conversation-log.ts`의 순수 함수다**(15행). 운영 로그의 `isAnswered`와 같은 정의를 쓰려면 이 파일을 **파일 단위로만** import한다(`ConversationModule` import 0 — 워크플로가 `handoff/lib`를 파일 import한 선례).
> **C-12 `EmbeddingProviderFactory`는 `EMBEDDING_BASE_URL`이 없으면 `undefined`를 준다**(`embedding-provider.factory.ts` 25~26행). 군집은 벡터 없이는 성립하지 않으므로, 대화의 "저하 모드" 같은 대체 경로가 없다 → 요청 시 `503 EMBEDDING_UNAVAILABLE`, 실행 중 실패는 작업 오류(부분 결과 0 — NFR-DCR1).

---

## 1. PM 확정 사항 (2026-09-30)

| # | 확정 내용 | 요구사항 권고와의 관계 | 이 문서 반영 |
|---|---|---|---|
| **P-1** | 입력 = **엑셀/CSV 발화 파일 업로드**(이미 글자로 된 발화 목록). 음성 인식·외부 수집·운영 대화 기록 제외 | 권고 (a) | §7 |
| **P-2/P-3** | 규모 **A**: 업로드 → 마스킹 → 임베딩(ml-worker `/embed` 재사용) → 군집 → 묶음별 대표 키워드 → 챗봇 대조(No.19 대량 대조 규약 재사용) → 조회·엑셀 다운로드 + **관리자가 고른 발화만 확인 화면을 거쳐 기존 반영 경로로 의도 예문 반영**. 자동 반영 없음 | 권고 A · (b) | 전체 · §15 |
| **P-4** | LLM = **"묶음 이름 제안" 보조만 · 기본 꺼짐 · 꺼져도 기능 성립**. No.37 생성 백엔드·주소 통제 재사용 · 모델 ID·백엔드는 설정으로 분리 | 권고 (b) | §16 |
| **P-5** | 묶음 품질은 **개발 PC에서 기존 의도 예문을 정답표로 측정·판정** · 속도·LLM 이름 제안은 운영 실측 전제로 분리(3050은 "동작 확인"만) | 권고 (a) | §20.5 |
| **P-6** | **마스킹본만 저장 · 원본 파일 저장 0 · 90일 후 자동 삭제(설정 가능) · 수동 삭제 가능** — No.45 보존 체계와 정합 | 권고 (a) | §14 |
| P-7 | 화면 용어 **"묶음"**(No.22 "토픽"과 구분) | 권고 | §17 · DC-15 |
| P-8 | 입력 한도 1회 5,000행(상향은 운영 실측 후 설정) | 권고 | §7.1 |
| P-9 | 대조 대상 번들 — architect 판단 | — | §9.1(**서비스 중(기본) / 초안** 선택) |
| P-10 | GPU **7 → 5 + 각주** | 권고 | §25(패치 B-2~B-4) |
| P-11 | 카탈로그 누락 2건(통계 > 군집분석 · 많이 쓴 단어) — **§5 메모에 기록 + 기존 항목으로 연결** | 권고 | 패치 B-5 |
| P-12 | 원본 확인 — 권고 채택. **이 설계는 결과를 기다리지 않는다**("토픽 -1 = 미분류" 판독이 틀리면 표시 문구만 바뀌고 저장 구조는 같다 — K-13) | 권고 | K-13 |

---

## 2. 범위

### 2.1 바뀌는 것

| 영역 | 변경 | 근거 |
|---|---|---|
| `apps/api/src/utterance-analysis/**` | **신설 모듈**(컨트롤러 1 · 13 핸들러) — §2.3 파일 구조 | 전체 |
| `apps/api/prisma/schema.prisma` + 마이그레이션 1 | **신규 3테이블**(`UtteranceAnalysis`·`UtteranceCluster`·`AnalyzedUtterance`) + `Chatbot` 역참조 1줄(DB 컬럼 0) · `CREATE TABLE`·`CREATE INDEX`만 | §10 |
| `packages/shared-types` | 신설 `utterance-analysis.ts` · `ApiErrorCode` +3 · `AuditTargetType` +1(`UtteranceAnalysis` 35 → 36) · `ChatbotVersionTrigger` +1(`BEFORE_UTTERANCE_APPLY` · 자동 그룹) · `GovernanceMapResponseSchema` 선택 키 `utteranceAnalysis?` | §11 |
| `apps/api/src/learning/learning-apply.service.ts` | `LearningApplyReason`에 `'UTTERANCE_ANALYSIS_APPLY'` 추가(**타입만** — 본문 불변) | §15 |
| `apps/api/src/learning/morph/morph-analyzer.module.ts` | **신설**(`MorphAnalyzerFactory` provide·export) · `learning.module.ts`는 provider 대신 이 모듈 import(동작 불변) | C-10 · §6.4 |
| `apps/api/src/chatbots/chatbots.service.ts` | 영구삭제 동반 삭제 +3(`analyzedUtterance → utteranceCluster → utteranceAnalysis`) · 27 → 30테이블 | §14.4 |
| `apps/api/src/governance/jobs/retention.job.ts` · `governance/writer/governance-data.writer.ts` | 파기 잡에 **만료 분석 삭제 단계** 1개(CUSTOMER_IDENTITY 뒤·AUDIT_LOGS 앞) · writer 메서드 1개 | §14.2 |
| `apps/api/src/governance/governance-map.service.ts` | 데이터 지도 선택 키 `utteranceAnalysis?`(분석 0건이면 키 생략 — 바이트 동일) | §13.4 |
| `apps/api/src/governance/bootstrap/governance-bootstrap.service.ts` | 모드 ON + 이름 제안 켬이면 `AUGMENTATION_LOCAL_BASE_URL` 호스트 허용 목록 검사(1조건 — 기존 `local` Provider 검사와 같은 규칙) | §13.3 |
| `apps/api/src/common/egress/egress-registry.ts` | `AUGMENT_LOCAL.files`에 이름 제안 출구 파일 1개 추가(**클래스 7종 불변**) | §16.3 |
| `apps/api/src/audit-logs/lib/audit-snapshot.ts` · `audit-logs/access/view-audit-targets.ts` | `AUDIT_FIELDS.UtteranceAnalysis` 화이트리스트 · 열람 감사 대상 +1(11 → 12) | §13.2 |
| `apps/api/src/versions/**`(캡처 트리거 유니온) | 자동 캡처 트리거 +1 — 캡처 동작 불변 | §15.3 |
| `apps/api/src/config/env.validation.ts` | 선택 환경변수 11개(§18) | §18 |
| `apps/api/src/app.module.ts` | `UtteranceAnalysisModule` 등록 | — |
| `apps/web` | 화면 3개(목록·새 분석·결과 상세) + 메시지 상수(트리거·감사 대상 라벨) | §17 |
| `apps/ml-worker` | 생성 프로파일에 **선택 경로 `POST /cluster-label`** · `Generator.label()` · `build_label_prompt()`·`parse_label()` · 설정 1개 · 시험 · (선택) 평가 기준선 스크립트 | §16 |
| 문서 | 이 설계서 · ADR-0047 · 패치 목록 | §25 |

### 2.2 바뀌지 않는 것 (봉인 — code-reviewer·정적 검사 대상)

| # | 봉인 | 확인 방법 |
|---|---|---|
| **DC-1** | `packages/dialogue-engine`·`apps/widget`·`apps/api/src/conversation/**`·채널 어댑터 변경 0 · `@Public()` 9 불변 · 공개 대화 요청·응답 스키마 불변 | `git diff --stat` · `validation-sealing.spec.ts` 7)(9개) 무수정 통과 |
| **DC-2** | `utterance-analysis/**`에 `ConversationLogService`·`QueryEmbeddingService`·`RagHttpClient`·`RagGateService`·`LegacyApi*`·`Workflow*`·`UnansweredCollectorService` 심볼 0 | UA-2 |
| **DC-3** | `utterance-analysis.module.ts`의 imports에 `ConversationModule`·`KeywordsModule`·`FaqsModule`·`DialogNodesModule`·`AugmentationModule`·`ValidationModule`·`RagModule`·`LegacyApiModule`·`WorkflowModule`·`InboxModule`·`TopicsModule`·`LearningModule`·`GovernanceModule` 0(이름이 실제 선언된 모듈인지 먼저 단언 — `validation-sealing` 2) 선례). `LearningApplyService`는 모듈 import 없이 providers에 직접 둔다(증강 모듈 선례) | UA-3 |
| **DC-4** | 자산 쓰기 = `apply/utterance-apply.service.ts` **1파일** — `IntentsService` 주입·`.applyLearningExample(` 호출·`.applyLearning(` 호출이 이 파일에만 있고 `.applyLearning(`은 요청 경로당 1회 · 모듈 안 `.invalidate(` 0 | UA-4 · S-2(4파일) |
| **DC-5** | 3테이블의 `create*`·`update*`·`upsert` 호출 파일 = `core/utterance-analysis.store.ts` 1개 · `delete*` 호출 파일 ⊆ {store · `governance/writer/governance-data.writer.ts` · `chatbots/chatbots.service.ts`} | UA-5 |
| **DC-6** | 모듈 안에서 `topic`·`unansweredQuestion`·`conversationLog`·`messageFeedback`·`embeddingVector`·`embeddingTextVector`·`trainingJob`·`testRun*`·`augmentationSuggestion`·`keyword`·`faqEntry`·`dialogNode` 쓰기 호출 0 | UA-6 |
| **DC-7** | `AnalyzedUtterance.text`·`sourceMemo`에 들어가는 값은 브랜드 타입 `MaskedUtteranceText`뿐 — 브랜드를 만드는 함수는 `lib/prepare-utterances.ts`의 `maskUtterance()` 1개(`ValidatedLegacyRequest` 선례 — 마스킹을 건너뛴 저장 코드는 컴파일되지 않는다) | 타입 · UA-7 |
| **DC-8** | 원본 파일 버퍼·마스킹 전 문자열을 디스크에 쓰지 않는다 — 모듈 안 `writeFile`·`createWriteStream`·`fs.promises.write` 0 · 요청 버퍼는 핸들러 스코프 밖으로 나가지 않는다(작업에는 `MaskedUtteranceText[]`만 전달) | UA-8 |
| **DC-9** | 로그·오류 메시지·`failureReason`·감사 `after`·`counts`에 문장·파일 내용 0(건수·사유 코드·시간만). `Logger` 호출 인자에 `text`·`utterance`·`raw`·`fileName`·`memo` 식별자 0 | UA-9 |
| **DC-10** | ml-worker `/embed`·`/health`·`/augment`·`/augment/health` 계약 바이트 동일 · `/cluster-label`은 생성 프로파일(`augment`·`both`)에서만 존재 · DB 접근·파인튜닝 0 | 기존 pytest 무수정 · 신규 시험 |
| **DC-11** | 새 출구 클래스 0(`EgressExitId` 7) · 이름 제안 출구 파일은 `AUGMENT_LOCAL`에 등록되고 `fetch(` 앞에 `assertEgressAllowed(` | G-1·G-2(무수정 · 동적) · `rich-message-sealing`·`proactive-sealing`의 7종 단언 무수정 |
| **DC-12** | 모듈 안 `setInterval(`·`cron`·`PollingLoop` 0 — 작업은 관리자 요청으로만 시작(자동 재분석·자동 반영 경로 0) | UA-10 |
| **DC-13** | 엔진 패키지에 `utteranceAnalysis`·`UtteranceCluster`·`analyzedUtterance` 심볼 0 | UA-11 |
| **DC-14** | 신규 권한·역할 0(`Permission` 18종) · 신규 `@Public()` 0 | 기존 단언 |
| **DC-15** | 콘솔의 이 기능 화면 문자열에 "토픽"·"군집"·"클러스터"·"임베딩"·"벡터" 0(도움말의 "챗봇의 '토픽' 설정과는 관계없습니다" 1문장만 예외) | web vitest |
| **DC-16** | `TrainingJob`·`TrainingJobKind`·`RetentionTargetKind`·`EncryptedFieldId` 불변 | diff |

### 2.3 모듈 파일 구조 (`apps/api/src/utterance-analysis/`)

```
utterance-analysis.module.ts          imports: ChatbotsModule · DialogueCommonModule · EmbeddingModule · AnswerSettingsModule
                                                 · EnvironmentServingModule · TrainingJobsModule · IntentsModule · VersionCaptureModule
                                                 · BannedWordsModule · MorphAnalyzerModule(신설)   exports: 없음
                                      providers: 아래 서비스들 + LearningApplyService(직접 provide — 상태 없는 얇은 래퍼,
                                                 증강 모듈 선례 · LearningModule import 0 · DC-3)
utterance-analyses.controller.ts      13 핸들러(§12) — 권한 데코레이터·zod 파이프·multer(메모리·5MB·파일 1)
utterance-analysis.service.ts         요청·검증 미리보기·목록·상세·발화 목록·이름 수정·취소·삭제·capability · onModuleInit 고아 정리
utterance-analysis.mapper.ts          행 ↔ DTO(JSON 파싱 폴백)
core/utterance-analysis.store.ts      ★3테이블 쓰기 유일 파일(생성·상태 전이·결과 커밋·반영 표시·이름 수정·수동 삭제·고아 정리)
upload/utterance-upload.parser.ts     파일 형식 판별(내용 기반) → 기존 SheetReader(xlsx·csv) → 머리글 검사 → 행 추출
run/utterance-analysis-job.runner.ts  작업 본체(단계 6개) — IntentsService·KeywordsService 심볼 0(S-3 자동 적용)
run/utterance-analysis-status.sink.ts AsyncJobStatusSink 3번째 구현(store에 위임)
run/utterance-analysis-cancel.registry.ts  프로세스 로컬 취소 집합(TestRunCancelRegistry 선례)
run/analysis-embedding.source.ts      ★임베딩 공급원 교체 지점 1곳(기본 = EmbeddingProviderFactory — 전용 프로세스 분리의 자리, R-8)
run/utterance-probe.service.ts        챗봇 대조(대화 기록 0 · 전역 질의 캐시 0 · RAG·외부 API 호출 0)
naming/cluster-name-suggester.port.ts     이름 제안 포트(Nest·Prisma 무의존 — 승격 가능 형태)
naming/cluster-name-http.client.ts        ★출구 파일(AUGMENT_LOCAL — ml-worker `/cluster-label`)
naming/mock-cluster-name.suggester.ts     시험·CI용
naming/cluster-name-suggester.factory.ts  교체 지점 1곳(꺼짐 = 인스턴스 없음)
apply/utterance-apply.service.ts      ★자산 쓰기 유일 파일(미리보기·반영)
export/utterance-analysis-export.service.ts  엑셀 2시트 · recordExport
lib/                                   순수 함수(DB·Nest 무의존 — NFR-DCM2)
  prepare-utterances.ts   정리·병합·제외·마스킹(브랜드 MaskedUtteranceText 발급 유일)
  file-sniff.ts           내용 기반 형식 판별(ZIP 서명·UTF-8)
  spherical-kmeans.ts     ★군집 교체 지점(NFR-DCM1) — 입력 정규화 벡터+조건, 출력 발화별 묶음 번호
  cluster-postprocess.ts  최소 크기 → 미분류 · 번호 · 대표 발화 · 정렬 순번
  keyword-tokens.ts       형태소 토큰 → 키워드 후보(품사·불용어·조사·마스킹 토큰 제외)
  cluster-keywords.ts     묶음 대표 키워드 점수(c-TF-IDF)
  mask-tokens.ts          마스킹 표식 식별(마스킹 출력과의 결합 시험 동반)
  learning-candidate.ts   학습 후보 판정
  apply-plan.ts           반영 계획(포함·제외 사유·경고)
  name-sanitize.ts        이름(AI 제안·관리자 입력) 검사
  analysis-progress.ts    단계 → 진행률
eval/measure-clustering-quality.ts    품질 측정 도구(ml-engineer · CI 밖) + eval/report/
lib/utterance-analysis-sealing.spec.ts  봉인 UA-1~UA-11
```

---

## 3. 구성도

```
[관리자 콘솔] ─(multipart: 파일 + 조건)──▶ POST /chatbots/:id/utterance-analyses
                                            │ 요청 핸들러(동기, 저장 0 → 저장 1행)
                                            │  ① 내용 기반 형식 판별 → SheetReader → 머리글 검사
                                            │  ② 행 정리 → 금지어 마스킹 → PII 마스킹 → 병합·제외(MaskedUtteranceText[])
                                            │  ③ 상한·동시 실행·보관 상한·출구 사전 판정
                                            │  ④ UtteranceAnalysis 1행(QUEUED · activeLock='ACTIVE') → 202
                                            ▼
                         TrainingJobQueue.enqueue(id, task, UtteranceAnalysisStatusSink)   ← 기존 큐 재사용(상태는 자기 테이블)
                                            │
   ┌────────────── utterance-analysis-job.runner.ts (단계 · 취소 확인 · 진행률) ──────────────┐
   │ EMBEDDING   AnalysisEmbeddingSource → EmbeddingProvider.embed(QUERY, 배치 16, 적응형 양보) ──HTTP──▶ ml-worker(embed) /embed
   │ CLUSTERING  sphericalKMeans(벡터, k, 시드 고정) — 조각 256점마다 이벤트 루프 양보(API 프로세스 CPU)
   │ KEYWORDS    MorphAnalyzerPort(garu) → keyword-tokens → cluster-keywords(c-TF-IDF)
   │ PROBING     UtteranceProbeService: 번들(서비스 중=운영 버전|라이브 / 초안) + 같은 벡터 → resolveTurn(단일 턴) ─ 기록 0
   │ NAMING      (켰을 때만) ClusterNameSuggester ──HTTP(AUGMENT_LOCAL)──▶ ml-worker(augment) /cluster-label ─▶ Ollama/vLLM/HF
   │ SAVING      store.commitResults(): 묶음·발화 createMany(500행 조각) + 상태 SUCCEEDED + activeLock=null — 한 트랜잭션
   └───────────────────────────────────────────────────────────────────────────────────────────┘
                                            ▼
[콘솔] 목록 · 상세(묶음 표 · 발화 표 · 필터·페이지) · 엑셀 다운로드(EXPORT 감사)
      └─ 선택 발화(≤50) → apply/preview(DB 0) → apply ─▶ IntentsService.applyLearningExample() × N ─▶ applyLearning() 1회
[파기 잡(No.45 RetentionJob, KST 창)] expiresAt < now ∧ 종결 상태 → 발화·묶음·분석 행 삭제(secure_delete) · 건수만 이력
```

---

## 4. ★ 군집 연산 위치 재판정 (ADR-0024 114행 · ADR-0027 148행)

### 4.1 판정 대상과 결론

ADR-0024는 "No.21 착수 시 학습 기능 추가·Job Queue·GPU 5 복귀를 다시 판정", ADR-0027은 "No.21 착수 → 비지도 학습·대용량 배치가 들어오므로 **학습 위치(`apps/api` CPU vs ml-worker)를 다시** 판정, 자동 상속 없음"을 남겼다. 항목별 판정:

| 항목 | 판정 | 요지 |
|---|---|---|
| **모델 학습(파인튜닝)** | **없음** | 군집은 이번 요청의 벡터 위에서 끝나는 **일시 수치 계산**이다. 중심점은 저장하지 않고(묶음 번호·키워드만 저장) 어떤 모델 가중치도 갱신하지 않는다(FR-0-289) |
| **벡터화(문장 → 벡터)** | **ml-worker `/embed` 재사용** | GPU 등급 기능의 "딥러닝" 부분 = 임베딩 추론. 계약 불변(DC-10) |
| **벡터 → 묶음(군집)** | **`apps/api` 비동기 작업 안 · CPU · 조각 양보** | §4.2 |
| **Job Queue·상태** | **기존 `TrainingJobQueue` 재사용 · 상태는 `UtteranceAnalysis`가 소유**(`TrainingJob` kind 추가 0) | ADR-0027 갱신① 선례 · C-3 |
| **GPU 필요도** | **7 → 5 + 각주** | 기본 구성 = CPU 임베딩 배치 + CPU 군집. 수만 건 이상 대량은 GPU 임베딩 권장 · 이름 제안은 No.37 등급표 |
| **ml-worker 역할** | **불변**("ML 추론 서비스 — 임베딩 + 선택적 생성") · 생성 프로파일에 **선택 경로 1개**(`/cluster-label`)만 추가 | §16 |

### 4.2 군집을 어디서 계산하나 — 비교

요구사항 FR-DC3-4의 판정 기준 5개로 비교했다.

| 기준 | **(가) `apps/api` 안(채택)** | (나) ml-worker 임베딩 프로세스에 `/cluster` | (다) ml-worker 별도 분석 프로세스(새 역할) |
|---|---|---|---|
| ① 대화 경로 임베딩 지연 | 군집 계산이 **대화 임베딩과 같은 프로세스가 아니다**. API 이벤트 루프는 조각(256점)마다 양보해 한 번에 막는 시간을 수십 ms로 제한한다(§19.2) | 대화 `/embed`와 **같은 스레드 풀·같은 BLAS/OpenMP 스레드**를 쓴다. `threadpoolctl` 제한은 프로세스 전역이라 torch 추론까지 묶을 수 있다 → 대화 임베딩 P95(300ms) 직접 위협 | 프로세스는 분리되나 같은 장비면 CPU 코어는 공유한다. 운영자가 프로세스를 하나 더 띄워야 한다 |
| ② 새 의존성·폐쇄망 | **0**(수치 계산 순수 TS — 로지스틱 회귀 선례 ADR-0027 §1) | `scikit-learn`은 이미 설치돼 있으나 **선언되지 않은 간접 의존성**(C-1) — 명시 선언 필요. 반입 휠은 추가 0이나 버전 통제가 새로 생긴다 | (나)와 같음 + 새 역할·포트·설치 문서 |
| ③ 5,000건 메모리 | 5,000 × 1,024 × 4B ≈ 20MB(이미 API에 있다 — 대조에도 필요) · 쌍 거리 행렬 없음 | 같은 20MB를 **HTTP로 한 번 더 보낸다**(float32 base64 ≈ 27MB 본문, JSON 숫자 배열이면 ≈ 50MB) | (나)와 같음 |
| ④ 시험 용이성 | jest에서 **실제 알고리즘**을 가짜 임베딩(고정 벡터)과 함께 끝까지 돌린다 — 재현성·미분류·번호 규칙을 통합 시험에서 단언(AC-DC3-1·3-2) | API 통합 시험은 가짜 군집기를 써야 해 실제 알고리즘이 CI 통합 경로에 안 들어온다(pytest로만) | (나)와 같음 |
| ⑤ "추론 전용" 원칙 | ml-worker 역할 정의 불변 | 상태 없는 수치 계산이라 원칙 위반은 아니나, 역할이 "모델 추론"에서 "범용 수치 계산"으로 넓어진다 | 같음 + ADR-0024 재검토 트리거(내부 구조 재결정) 발동 |
| 속도 | JS 수치 계산은 numpy보다 느리다 — 최악 추정 수십 초(§19.1). 10분 목표 대비 지배 요인이 아니다(임베딩이 지배) | 빠르다 | 빠르다 |
| 알고리즘 선택 폭 | k-평균·계층 군집 등 직접 구현 가능한 것만(HDBSCAN 구현은 과함) | HDBSCAN·UMAP 등 선택 폭이 넓다 | 같음 |
| 품질 측정 도구와의 일치 | 측정 도구가 **같은 TS 함수**를 호출한다(분류기 측정 스크립트 `classifier/eval/compare-classifier-vs-knn.ts` 선례) | 같은 파이썬 모듈 호출 | 같음 |

**결론 — (가) `apps/api`**. 근거는 세 가지다.
1. **"입력이 있는 곳에서 계산한다"**(ADR-0027 근거 1). 벡터는 챗봇 대조(의미 매칭 점수)에 어차피 API 메모리에 있어야 한다. ml-worker로 보내면 20MB를 한 번 더 왕복시킬 뿐 얻는 것이 속도뿐인데, 속도는 이 기능의 병목(임베딩)이 아니다.
2. **대화 경로 보호가 구조적으로 쉽다.** (나)는 대화 임베딩과 같은 프로세스의 CPU를 수 초씩 점유한다. (가)는 API 이벤트 루프 양보만 지키면 되고 그 규약은 로지스틱 회귀·TC 실행에서 이미 검증됐다.
3. **개발명세서 §1 원칙과 일치한다.** "GPU 불필요 기능은 `apps/api`, GPU 필요 기능은 ml-worker" — 이 기능에서 GPU 등급인 부분은 임베딩 추론뿐이고, 그것은 ml-worker에 그대로 있다. 개발명세서 §1이 "군집분석"을 ml-worker 예시에 적은 것은 카탈로그 GPU 7(딥러닝 군집 = GPU 배치)을 전제로 한 문장이라 이번에 정정한다(패치 A-1).

**감수하는 것**: HDBSCAN·UMAP 같은 밀도 기반 방법을 제품에 넣지 않는다(§5.2). 교체 지점은 `lib/spherical-kmeans.ts` 1곳(NFR-DCM1)이며, 품질 측정에서 밀도 기반이 뚜렷이 낫다고 확인되면 **ml-worker 구현을 두 번째 구현으로 붙이는** 재검토 트리거를 둔다(§26).

---

## 5. ★ 알고리즘

### 5.1 의존성 실측 확인 (2026-09-30 — 개발 PC `apps/ml-worker/.venv`)

| 확인 | 결과 | 근거 |
|---|---|---|
| `scikit-learn` 설치 여부 | **설치됨 — 1.7.2** | `site-packages/scikit_learn-1.7.2.dist-info/METADATA` 3행 |
| 설치 경로 | `sentence-transformers` 6.1.0의 필수 의존성(`scikit-learn>=1.1.0`) | `sentence_transformers-6.1.0.dist-info/METADATA` 27행 |
| `pyproject.toml` 선언 | **없음** — `numpy`·`sentence-transformers`·`torch`·`fastapi`… 뿐 | `apps/ml-worker/pyproject.toml` 6~18행 |
| `sklearn.cluster.HDBSCAN` | **존재**(1.3 이상 기능) | `sklearn/cluster/_hdbscan/hdbscan.py` |
| `scipy`·`joblib`·`threadpoolctl` | 1.15.3 · 1.6.0 · 3.7.0(scikit-learn 의존성으로 이미 설치) | 각 `dist-info` |
| 선언 범위와 실제 설치의 불일치 | `sentence-transformers<4.0` 선언 vs 6.1.0 · `numpy<2.0` vs 2.2.6 · `pytest<9.0` vs 9.1.1 | D-1 |
| API 쪽 수치 라이브러리 | 없음 — 로지스틱 회귀·코사인은 순수 TS(`classifier/lib/logistic-regression.ts` · `embedding/lib/cosine.ts`) | ADR-0027 §1 |

**폐쇄망 영향**: 채택안(가)은 **새 의존성 0**이라 반입 목록·설치 절차가 바뀌지 않는다. 선택 도구인 파이썬 기준선 스크립트(§20.5 ⑦)가 `scikit-learn`을 쓰지만 이미 휠이 반입돼 있고(간접 의존성), 제품 경로가 아니므로 `pyproject.toml`에 **선택 추가 의존성 묶음 `eval = ["scikit-learn>=1.3,<2"]`** 으로만 명시해 버전 하한(HDBSCAN)을 문서화한다(런타임 설치 목록 불변 — ml-engineer 선택 작업).

### 5.2 후보 비교와 선택

| 후보 | 장점 | 단점 | 판정 |
|---|---|---|---|
| **구면 k-평균**(L2 정규화 벡터 · 코사인 · k-means++ 시드 고정) | 원본 조건 "토픽수"(목표 묶음 수)가 곧 k다 · 계산량 선형(n·k·d·반복) · 메모리 O(n·d) · 시드 고정으로 완전 결정론 · 순수 TS 150줄 규모 | 모든 발화를 어딘가에 배정한다(외톨이도) — 미분류는 "작은 묶음"으로만 생긴다 · 묶음 모양이 둥글다는 가정 | **채택** |
| HDBSCAN(밀도 기반) | 외톨이를 자연스럽게 −1(원본 "토픽 −1"과 같은 모양)로 뺀다 · 묶음 수를 데이터가 정한다 | **1,024차원 원공간에서는 밀도 추정이 약해 대부분을 외톨이로 내는 경향**이 알려져 있어 보통 UMAP으로 5차원 안팎까지 줄여 쓴다 → UMAP은 `umap-learn`·`numba`·`llvmlite`·`pynndescent` **새 의존성 4종**(폐쇄망 반입 증가 · numba JIT 캐시 문제) · "목표 묶음 수"를 맞추려면 병합 단계가 추가로 필요 · TS 구현 비현실적 → ml-worker 배치를 강제 | **기각**(품질 측정 기준선으로만 — §20.5) |
| 병합형 계층 군집(평균 연결 · 코사인) | 결정론 · 묶음 수 지정 가능 | 쌍 거리 행렬 5,000² × 4B ≈ 100MB · 시간 O(n² log n) · NFR-DCP4 경고 대상 | 기각 |
| 문자 bigram·키워드 빈도 묶기(원본 통계 > 군집분석 방식) | 의존성 0 · 빠름 | 표현이 다른 같은 뜻을 못 묶는다 — "딥러닝 군집분석"(원본 p.99)의 본뜻과 다르다 | 기각(규모 B의 "통계 > 군집분석" 대체는 임베딩 방식 — 요구사항 §1.3) |

> ⚠ "HDBSCAN이 원공간 고차원에서 약하다"는 **일반적으로 알려진 경향이며 이 데이터로 잰 사실이 아니다.** 품질 측정 도구의 파이썬 기준선(선택)에서 k-평균과 HDBSCAN(+PCA 50차원)을 같은 데이터로 비교해 보고서에 남긴다. 밀도 기반이 뚜렷이 낫게 나오면 재검토 트리거(§26)로 ml-worker 구현을 붙인다.

### 5.3 `lib/spherical-kmeans.ts` 규격 (★교체 지점 — NFR-DCM1)

**입력**: `vectors: readonly Float32Array[]`(길이 n · 같은 차원 d) · `k: number` · `hooks?: { yieldEvery?: () => Promise<void>; isCancelled?: () => boolean }`
**출력**: `{ assignments: Int32Array(n), centroids: Float32Array[] (k), similarities: Float32Array(n) (배정 중심과의 코사인), iterations: number, inertia: number }`
**알고리즘 상수**(코드 상수 1곳 `CLUSTERING_ALGORITHM` — 바꾸면 `algorithmVersion`을 올린다): `version = 'skmeans-1'` · `seed = 20260930` · `nInit = 3` · `maxIter = 50` · `slicePoints = 256`

| 단계 | 규칙 |
|---|---|
| 입력 정규화 | 각 벡터를 다시 L2 정규화한다(ml-worker가 이미 정규화하지만 방어 — 0벡터는 그대로 두고 유사도 0으로 취급) |
| **입력 순서** | 호출부가 **정규화 문자열 오름차순**으로 정렬해 넘긴다 → 파일의 행 순서가 결과를 바꾸지 않는다(재현성 강화 · FR-DC3-5) |
| 난수 | `mulberry32(seed + run)`(run = 0..nInit−1) — `Math.random` 사용 금지(정적 검사 UA-10에 포함) |
| 초기화 | k-means++ — 첫 중심은 난수 인덱스, 이후 가중치 `D(x) = 1 − max_j cos(x, c_j)`(음수는 0)의 누적 분포에서 난수로 선택. 모든 `D`가 0이면(전부 같은 문장 — EX-DC-3) 남은 중심을 만들지 않고 실제 k를 줄인다 |
| 배정 | 각 점을 코사인(내적)이 최대인 중심에 배정 · **동점은 작은 중심 인덱스** |
| 갱신 | 중심 = 배정 점의 합을 L2 정규화 |
| 빈 묶음 | 배정 0인 중심은 "현재 배정 유사도가 가장 낮은 점"(동점 = 작은 인덱스)으로 다시 심는다 — 그 점이 원래 묶음의 유일한 점이면 다시 심지 않고 빈 채로 둔다(마지막에 버린다) |
| 종료 | 배정이 한 점도 바뀌지 않거나 `maxIter` 도달 |
| 여러 번 시도 | `nInit`회 중 **관성(Σ(1 − cos))이 가장 작은 결과** — 동점 = 작은 run |
| 양보·취소 | 배정 단계에서 `slicePoints`점마다 `await hooks.yieldEvery()`(러너가 `setImmediate`를 주입) · 반복마다 `hooks.isCancelled()`가 참이면 `ClusteringCancelledError` |
| 결정론 | 같은 입력 벡터(비트 동일)·같은 k·같은 상수 → **같은 배정**. 부동소수 합산 순서를 고정한다(점 인덱스 오름차순 누적 · `Float64Array` 누산) |

**동기 판** `sphericalKMeansSync()`도 같은 파일에 둔다(단위 시험·측정 도구용 — 양보 없음, 결과 동일을 시험이 단언).

### 5.4 `lib/cluster-postprocess.ts` — 실제 묶음 수·미분류·번호·대표 발화

1. **실제 k**(EX-DC-2·4): `kMax = floor(n / minClusterSize)`. `kMax < 2`이면 요청 단계에서 이미 거부된다(`400 UTTERANCE_ANALYSIS_TOO_FEW` — §7.4). `k = min(targetClusterCount, kMax)` — 줄었으면 `notices`에 `TARGET_REDUCED`(화면: "발화 수에 맞춰 목표 묶음 수를 N개로 줄였습니다").
2. 군집 실행 → 빈 묶음 제거.
3. **미분류**(FR-DC3-3): 발화 수(고유 문장 수 — 발생 횟수 아님)가 `minClusterSize` 미만인 묶음의 발화를 전부 "미분류"로 옮긴다. 미분류는 **다시 배정하지 않는다**(원본 "토픽 −1"과 같은 의미 — K-13).
4. **번호**(FR-DC3-6): 남은 묶음을 ① 고유 발화 수 내림차순 ② 발생 횟수 합 내림차순 ③ 대표 발화 정규화 문자열 오름차순으로 정렬해 `ordinal = 1..m`. 미분류는 `ordinal = m + 1`, `unassigned = true`(화면 "미분류" · 목록 맨 끝). 발화가 있을 때만 행을 만든다.
5. **실제 묶음 수가 목표보다 적음**(EX-DC-3): `m < k`이면 `notices`에 `FEWER_THAN_TARGET`. `m = 0`이면 `NO_CLUSTER`("묶음을 만들지 못했습니다 — 최소 발화 수를 낮춰 보세요") — 분석은 **성공**(전부 미분류).
6. **대표 발화 3개**: 묶음 안 `similarity` 내림차순(동점 = 정규화 문자열 오름차순). 미분류는 발생 횟수 내림차순.
7. **발화 정렬 순번 `seq`**(페이지 조회 키): 묶음 `ordinal` 오름차순 → 묶음 안 `similarity` 내림차순(미분류는 발생 횟수 내림차순) → 정규화 문자열 오름차순. `seq`는 분석 안에서 1부터 연속.

### 5.5 계산량 (추정 — 측정 전)

한 반복 = n·k·d 곱셈합. n = 5,000 · d = 1,024 · k = 50(최대) → 2.56 × 10⁸. `nInit` 3 × (초기화 1 + 반복 ≤ 50) → **최악 약 3.9 × 10¹⁰**. 대부분의 데이터에서 배정은 10~20회 안에 멈춘다(일반적 경향 — 측정 아님). TS `Float32Array` 내적 성능을 초당 10⁹ 안팎으로 가정하면 최악 수십 초, 통상 10초 안팎이다. **이 수치는 추정이며 §19.1의 예산은 ml-engineer의 "동작 확인"(3050 개발 PC)과 운영 실측으로만 확정한다**(FR-0-293).

---

## 6. 묶음 대표 키워드 (FR-DC4)

### 6.1 토큰 → 후보 (`lib/keyword-tokens.ts`)

| 순서 | 규칙 |
|---|---|
| ① 마스킹 표식 제거 | `lib/mask-tokens.ts`의 패턴(`[주민등록번호]`·`[카드번호]`·`[전화번호]`·`[계좌번호]`·`[이메일]` · 부분 마스킹 전화 `\d{3}-\*{4}-\d{4}` · 부분 마스킹 이메일 `\S\*\*\*@\S+` · 금지어 마스킹 `\*{2,}`)을 공백으로 바꾼 뒤 분석한다(FR-DC4-4). **결합 시험**: `maskPii()`(PARTIAL·FULL)·금지어 마스킹 출력 표본을 넣어 전부 제거되는지 단언 — 마스킹 규칙이 바뀌면 이 시험이 먼저 깨진다 |
| ② 형태소 분석 | `MorphAnalyzerPort.analyze(text)`(garu — 로드 실패 시 휴리스틱 M0) |
| ③ 품사 | **명사만(기본)**: `NNG`·`NNP`·`SL`(영문 약어 — "ATM") · **명사만 끔**: 위 + `VV`·`VA`(동사·형용사 어간 — "해지하"가 아니라 "해지" 수준 표면형) · `XR`(어근). 휴리스틱 분석기는 품사 신뢰도가 낮다 → 분석 행에 `analyzerId` 기록 + 화면 안내 "기본 분석기로 계산 — 키워드 정확도가 낮을 수 있습니다" |
| ④ 제외 | 기존 `DEFAULT_STOPWORDS` · `josa-endings.ts` 조사/어미 단독 · 숫자만 · 한 글자(한글) · 마스킹 잔여(`*` 포함) |
| ⑤ 정규화 | 소문자(영문) · 앞뒤 기호 제거 · 발화 1개 안에서는 **있음/없음**(중복 1회) |

### 6.2 점수 (`lib/cluster-keywords.ts` — c-TF-IDF)

- `tf(t, c)` = 묶음 c에서 t가 나온 **고유 발화 수** · `|c|` = 묶음 c의 고유 발화 수 · `f(t)` = 전체(미분류 포함)에서 t가 나온 고유 발화 수 · `A` = 묶음(미분류 포함)당 평균 고유 발화 수.
- `score(t, c) = (tf(t, c) / |c|) × ln(1 + A / f(t))` — "그 묶음에서 자주 나오고 다른 묶음에서는 드문" 순(FR-DC4-1).
- 후보 조건: `tf(t, c) ≥ 2`(묶음 발화가 4개 미만이면 1) — 한 문장에만 나온 단어가 키워드가 되지 않게.
- 정렬: 점수 내림차순 → `tf` 내림차순 → 용어 사전순(결정론). 상위 `keywordCount`개.
- 저장: `[{ term, score(소수 4자리), count: tf }]`.
- **발생 횟수는 쓰지 않는다** — 한 문장이 500번 반복돼도 키워드 1표다(반복 문장 하나가 묶음의 이름을 독점하지 않게 · R-19).
- **자동 이름**(FR-DC4-3): 상위 키워드 3개를 `" · "`로 연결. 키워드가 0개면 `묶음 {ordinal}`. 미분류는 `미분류`(고정).

### 6.3 이름 3종의 표시 우선순위

`customName`(관리자 수정) > `autoName`(키워드) — `suggestedName`(AI)은 **이름을 대체하지 않고 옆에 "AI 제안 — 확인 필요" 표식과 함께** 참고로만 보인다(FR-DC8-4 · NFR-DCS4). 관리자가 AI 제안을 쓰고 싶으면 "이 이름 사용"으로 `customName`에 복사한다(그 시점에 관리자 입력으로 다시 검사 — §15.6).

### 6.4 형태소 분석기 공유 (C-10)

`apps/api/src/learning/morph/morph-analyzer.module.ts`(신설): `providers: [MorphAnalyzerFactory]`, `exports: [MorphAnalyzerFactory]`. `LearningModule`은 providers에서 `MorphAnalyzerFactory`를 빼고 이 모듈을 import한다(요소분해 동작·로드 시점 불변 — `onModuleInit` 1회). 이 기능 모듈도 같은 모듈을 import → **garu 적재 1회 · 미응답 수집기는 이 기능의 DI 그래프 밖**.

---

## 7. 업로드 · 정제 · 마스킹 (FR-DC1 · FR-DC2)

### 7.1 입력 형식과 한도

| 항목 | 규칙 |
|---|---|
| 형식 | `.xlsx` 첫 시트(`XlsxSheetReader`) · `.csv` UTF-8(BOM 허용 · `CsvSheetReader`) — **CSV 허용**(FR-DC1-1 권고 채택) |
| 형식 판별(NFR-DCS3 · AC-DC2-4) | 확장자가 아니라 **내용**으로(`lib/file-sniff.ts`): `.xlsx`는 ZIP 로컬 헤더 서명 `50 4B 03 04`로 시작해야 하고, `.csv`는 NUL 바이트 0 · UTF-8 디코딩 이상(치환문자 5% 초과 — 기존 `hasEncodingAnomaly`) 없음. 불일치 = `400 IMPORT_FILE_INVALID` "엑셀(.xlsx) 또는 CSV 파일이 아닙니다" |
| 파일 크기 | `IMPORT_LIMITS.maxFileBytes`(5MB) — multer `limits.fileSize`에서 끊는다(초과 = `413`→`400 IMPORT_TOO_LARGE`) |
| 행 수 | 머리글 제외 **파일 행 상한** `UTTERANCE_ANALYSIS_MAX_ROWS`(기본 5,000 · 100~20,000). 리더에 `maxRows`로 넘겨 초과 즉시 중단(압축 폭탄 방어 — 기존 `ImportFileTooLargeError`) → `400 IMPORT_TOO_LARGE`. **빈 행도 센다**(R-13) — 유효 발화는 항상 이 값 이하 |
| 머리글 | 1행. A열 = `발화`(별칭 `utterance`·`text`·`문장`) **필수** · B열 = `발생 횟수`(별칭 `count`·`건수`) 선택 · C열 = `출처 메모`(별칭 `memo`·`source`·`메모`) 선택. 열 순서 고정(기존 `isHeaderMismatch` 규약). A열 불일치 = `400 IMPORT_FILE_INVALID` + `details[{ field: 'header', message: '1열 머리글은 "발화"여야 합니다 — 양식을 받아 사용하세요' }]`(EX-DC-19) |
| 셀 | 값만 읽는다 — 수식 결과·서식·병합·숨은 시트 무시(기존 파서 규약 FR-DC1-6) |

### 7.2 행 정리 순서 (`lib/prepare-utterances.ts` — 순수 · 결정론)

| 순서 | 처리 | 결과 |
|---|---|---|
| 1 | 앞뒤 공백 제거 · 줄바꿈·탭 → 공백 · 제어문자 제거 · NFC | 빈 문자열 → 제외 `EMPTY` |
| 2 | **금지어 마스킹**(`BannedWordFilterService.maskPlainText` — 전역 사전) | 변화가 있으면 `hasBannedWord = true` |
| 3 | **PII 마스킹**(`maskPii` — 설치 모드 `PII_MASK_MODE` 따름) | 변화가 있으면 `masked = true` |
| 4 | 길이(마스킹 후) > `UTTERANCE_ANALYSIS_MAX_CHARS`(기본 300) | 제외 `TOO_LONG` |
| 5 | 마스킹 표식·기호·숫자를 뺀 **내용 글자**가 0 | 제외 `NO_CONTENT`(EX-DC-6) |
| 6 | `normalizeText(마스킹본)` 길이 < 2 | 제외 `TOO_SHORT`(임베딩 게이트 "2자 미만 시도 안 함"과 같은 기준) |
| 7 | 발생 횟수: 정수 1~1,000,000이 아니면 1로 두고 `invalidCountRows` +1(EX-DC-20 — 제외하지 않음 · R-7) | — |
| 8 | 출처 메모: 1·2·3을 같게 적용 후 100자 절단 | — |
| 9 | **병합**: `normalizeText(마스킹본)`이 같은 행을 1개로 합치고 발생 횟수 합산 · 대표 표기 = **먼저 나온 행** · 메모 = 먼저 나온 비어 있지 않은 메모 · `hasBannedWord`·`masked`는 OR | 합쳐진 행 수 = `mergedCount` |

- **병합 키가 마스킹본인 이유**: 마스킹 전 키로 합치면 원문을 비교해야 하고, 서로 다른 전화번호만 다른 두 문장("010-1234-5678 해지해 주세요"·"010-9999-0000 해지해 주세요")이 FULL 모드에서 같은 마스킹본이 되는데도 두 행으로 남는다.
- 마스킹은 대화 로그와 **같은 부품·같은 순서**(ADR-0013 · `ConversationLogService.record()` 75행)다. 결과 문자열에만 `MaskedUtteranceText` 브랜드가 붙는다(DC-7).
- 파일 이름: 경로 제거 → 제어문자 제거 → 금지어·PII 마스킹 → 120자 절단 후 저장(`fileName`). **사람 이름은 가려지지 않는다**(K-2).

### 7.3 검증 미리보기 (FR-DC1-5 — 저장 0)

`POST …/utterance-analyses/preview`(파일만) → 위 1~9를 그대로 실행하고 **건수만** 돌려준다. DB 쓰기 0 · 감사 0 · 로그에 건수·형식만. 요청 시에는 클라이언트가 **같은 파일을 다시 보낸다**(서버 스테이징 0 — 원본을 서버 메모리에 남기지 않기 위해 · R-12). 응답:

```
{ fileKind: 'XLSX'|'CSV', totalRows, validCount, mergedCount,
  excluded: { EMPTY, TOO_LONG, TOO_SHORT, NO_CONTENT },
  maskedRowCount, bannedRowCount, invalidCountRows, occurrenceTotal,
  canAnalyze: boolean, reasonIfNot?: 'TOO_FEW' (현재 조건 기준 — 조건은 선택 쿼리 minClusterSize) }
```

### 7.4 요청 시 사전 검사 순서 (`POST …/utterance-analyses`)

1. 기능 스위치(`UTTERANCE_ANALYSIS_ENABLED=false` → `404`) · `scope.assertWritable`(보관 = `409 CHATBOT_ARCHIVED` · EX-DC-9)
2. 조건 zod(§11) — 이름 제안 요청인데 서버에서 꺼져 있으면 `400 VALIDATION_FAILED`(`nameSuggest`)
3. 임베딩 공급원 가용성(`AnalysisEmbeddingSource.get()`) — 없음 = `503 EMBEDDING_UNAVAILABLE`("문장 분석 서비스에 연결할 수 없습니다")
4. **출구 사전 판정**(FR-DC9-4 · AC-DC7-2): `checkEgress('EMBEDDING', 임베딩 주소) === 'BLOCKED'` → `409 EGRESS_HOST_NOT_ALLOWED`(사유 문구에 "데이터 거버넌스 설정에서 문장 분석 서비스 주소가 허용되지 않았습니다"). 이름 제안 켬 + `AUGMENT_LOCAL` 차단이면 같은 코드(`details.field = 'nameSuggest'`)
5. 보관 상한(FR-DC6-5): 이 챗봇의 분석 수 ≥ `UTTERANCE_ANALYSIS_MAX_STORED_PER_CHATBOT`(20) → `409 UTTERANCE_ANALYSIS_STORE_FULL`(EX-DC-18 — 자동 삭제 아님)
6. 파일 파싱·정리(§7.1~7.2)
7. `validCount < minClusterSize × 2` → `400 UTTERANCE_ANALYSIS_TOO_FEW`(EX-DC-2)
8. **행 생성 = 동시 실행 잠금**: `store.createQueued()` — `activeLock = 'ACTIVE'` 유일 제약 위반(P2002) → `409 UTTERANCE_ANALYSIS_BUSY`("다른 분석이 진행 중입니다 — 끝난 뒤 다시 요청하세요", EX-DC-13 · 대기열 없음). 사전 `findFirst`는 빠른 거절용일 뿐 최종 방어선은 유일 제약이다(`test_runs` 선례와 같은 구조 — 단 원시 부분 인덱스가 아니다, §10.2)
9. 감사 `CREATE UtteranceAnalysis`(§13.2) → `queue.enqueue(id, task(MaskedUtterance[]), sink)` → `202 { analysisId, status: 'QUEUED' }`

---

## 8. 비동기 작업 · 상태 · 취소 · 재시작

### 8.1 상태 기계

```
QUEUED ──markRunning──▶ RUNNING ──commitResults(같은 트랜잭션에서 SUCCEEDED)──▶ SUCCEEDED
   │                       │──실패(임베딩 불가·예외)──markFinished(FAILED)──▶ FAILED
   └──cancel──▶ CANCELLED ◀┘(cancel: status ∈ {QUEUED,RUNNING} ∧ resultsCommittedAt = null 인 CAS)
```

- 종결 상태 3종(SUCCEEDED·FAILED·CANCELLED)으로 갈 때 **`activeLock = null`을 같은 UPDATE에서** 푼다.
- **완료 전이 = 결과 쓰기와 같은 트랜잭션**: `commitResults()`는 트랜잭션 안에서 ① `utteranceAnalysis.updateMany({ where: { id, status: 'RUNNING' }, data: { status: 'SUCCEEDED', …요약, activeLock: null, resultsCommittedAt: now, finishedAt: now } })` — 0행이면(그사이 취소) 예외로 롤백 ② 묶음 `createMany` ③ 발화 `createMany`(500행 조각). 러너는 성공 시 `{ status: 'SUCCEEDED' }`를 돌려주고 싱크의 `markFinished`는 `status = 'RUNNING'` CAS라 **0행 갱신(무해)**이다. 결과가 반쯤 저장된 "성공"이 구조적으로 없다(NFR-DCR1 · "부분 결과 저장 0").
- 싱크(`AsyncJobStatusSink` 3번째 구현): `markRunning`(QUEUED → RUNNING, `startedAt`) · `updateProgress`(RUNNING일 때만 · 실패 무시) · `markFinished(FAILED, failureReason)`(`status ∉ {CANCELLED, SUCCEEDED}` CAS · `activeLock = null`) — 전부 `store`에 위임. `PARTIAL`은 쓰지 않는다(들어오면 FAILED로 흡수 — `TestRunStatusSink` 선례).
- 러너가 단계마다 기록하는 `stage`: `EMBEDDING`·`CLUSTERING`·`KEYWORDS`·`PROBING`·`NAMING`·`SAVING`(끈 단계는 건너뜀). 진행률(`lib/analysis-progress.ts`): 임베딩 0→60 · 묶기 60→75 · 키워드 75→80 · 대조 80→95(끔이면 80→95를 이름 제안에) · 이름 제안 95→99 · 저장 100. 진행률 DB 쓰기는 **1초에 1회 이하**(`TEST_RUN_PROGRESS_MIN_INTERVAL_MS`와 같은 규약 — 상수 1000ms).

### 8.2 동시 실행 상한 (NFR-DCP2 · C-4)

- **서버 전체 1건**(따라서 챗봇당 1건도 포함). `UtteranceAnalysis.activeLock String? @unique` — QUEUED·RUNNING 동안 `'ACTIVE'`, 종결 시 `null`. SQLite·Postgres 모두 NULL은 유일 제약에서 여러 개 허용 → **원시 부분 인덱스 없이** Prisma 스키마로 표현된다(No.41 `WorkflowRun.dedupeKey` 선례).
- 상한을 설정값으로 두지 않는 이유: 두 번째 동시 분석은 대화 임베딩과의 경합만 두 배로 만든다. 늘릴 근거는 운영 부하 실측뿐이며 그때 잠금 슬롯을 `'SLOT_1'..'SLOT_n'`로 바꾸면 된다(재검토 트리거).

### 8.3 취소 (FR-DC6-4)

`POST …/:analysisId/cancel`: `store.cancel()` CAS(`status ∈ {QUEUED, RUNNING} ∧ resultsCommittedAt IS NULL` → `CANCELLED`, `activeLock = null`, `finishedAt`) → 0행이면 `409 INVALID_STATUS_TRANSITION`("이미 끝났거나 저장 중입니다") → 취소 레지스트리에 등록. 러너는 **임베딩 배치마다 · 군집 반복마다 · 키워드 200문장마다 · 대조 50문장마다 · 이름 제안 묶음마다 · 저장 직전**에 레지스트리를 확인하고, 참이면 결과를 버리고 `{ status: 'FAILED', failureReason: 'CANCELLED' }`를 돌려준다(싱크가 CANCELLED 행을 덮어쓰지 않는다). 레지스트리 항목은 싱크의 종결 처리에서 지운다(`TestRunStatusSink` 선례). 취소는 감사하지 않는다(TC 실행 취소와 같은 판단).

### 8.4 서버 재시작 (NFR-DCR2 · AC-DC7-5 · EX-DC-15)

`UtteranceAnalysisService.onModuleInit()` → `store.failOrphans()`: `status ∈ {QUEUED, RUNNING}` → `FAILED`, `failureReason = 'SERVER_RESTART'`, `activeLock = null`, `finishedAt = now`. 메모리에 있던 마스킹 문장은 사라졌으므로 **재개하지 않는다**(재요청 안내). 다중 인스턴스 전환 시 이 방식은 다른 인스턴스의 실행 중 작업을 잘못 종결한다 → ADR-0027 갱신(임대 방식) 재검토 트리거에 포함(K-11).

### 8.5 실패 사유 코드 (`failureReason` — 문장 0)

`EMBEDDING_UNAVAILABLE`(연결·시간 초과·배치 실패) · `EMBEDDING_MODEL_CHANGED`(작업 중 ml-worker `modelId` 변경) · `EGRESS_BLOCKED` · `CLUSTERING_FAILED` · `SAVE_FAILED` · `SERVER_RESTART` · `CANCELLED`(내부 — 표시는 상태 CANCELLED) · `INTERNAL_ERROR`. 대조·이름 제안 실패는 **작업 실패가 아니다**(`probeStatus`·`nameSuggestStatus = 'FAILED'` + 사유 · §9.5 · §16.3).

### 8.6 임베딩 단계와 대화 경로 양보 (NFR-DCP2 · R-8)

- 공급원: `AnalysisEmbeddingSource.get()` — 기본 구현은 `EmbeddingProviderFactory.getProvider()`를 그대로 돌려준다(대화 경로와 **같은 ml-worker**). 이 파일이 "분석 전용 ml-worker 프로세스" 분리의 **교체 지점 1곳**이다(R-8 — 이번에는 구현하지 않음).
- 호출: 고유 문장을 정렬 순서대로 `UTTERANCE_ANALYSIS_EMBED_BATCH_SIZE`(기본 **16**) 단위로 `provider.embed(batch, 'QUERY')`. `QueryEmbeddingService`(전역 질의 캐시)를 거치지 않는다(ADR-0030 §2 규약 — DC-2).
- **적응형 양보**: 배치 하나에 걸린 시간을 `t`라 하면 다음 배치 전 `max(EMBED_PAUSE_MS, t × EMBED_YIELD_RATIO)`만큼 쉰다(기본 100ms · 1.0) → 분석이 ml-worker 시간을 **최대 절반**만 쓴다. 대화 `/embed`가 그 틈에 들어간다. 배치 크기를 16으로 낮춘 것은 한 번에 붙잡는 CPU 시간을 줄이기 위해서다(64건 배치는 CPU에서 수 초).
- 모델 변경 감지: 첫 배치의 `provider.modelId`를 고정하고 이후 `EmbeddingProviderUnavailableError`(모델 변경 포함)가 오면 작업 실패.
- 벡터는 작업 메모리에만 있고 **저장하지 않는다**(FR-DC3-8 · `EmbeddingVector`·`EmbeddingTextVector` 쓰기 0).
- ⚠ 이 규칙이 대화 임베딩 P95 300ms를 지키는지는 **측정 전**이다 — AC-DC7-4 수동 게이트(운영 장비). 지키지 못하면 먼저 `EMBED_YIELD_RATIO`를 올리고, 그래도 안 되면 R-8(전용 프로세스)을 구현한다(§26).

---

## 9. 챗봇 대조 (FR-DC5)

### 9.1 대상 번들 (FR-DC5-3 · P-9 · AC-DC4-3 · EX-DC-8)

요청 조건 `probe.target`: **`SERVING`(기본)** | `DRAFT`.

| 챗봇 상태 | `SERVING` | `DRAFT` |
|---|---|---|
| 환경 모드 꺼짐(`prodVersionId = null`) | 라이브 번들(`DialogueBundleService.getCached` — 비활성 토픽 제외) + `AnswerSettingsCacheService.get` + `VectorCacheService.get(chatbotId, modelId)` | 같음(모드 꺼짐에서는 초안 = 서비스 중) |
| 환경 모드 켜짐 | 운영 버전 `VersionBundleService.get(chatbotId, prodVersionId, { topics: 'ACTIVE_ONLY' })` — 번들·색인·설정·`semanticSource` | 라이브 번들(위 첫 칸과 같은 조립) |

- 대상은 **작업 시작 시 1회** 해석해 고정한다(작업 중 전환·편집이 결과를 흔들지 않는다 — EX-DC-8). 분석 행에 `probeTargetKind`(`LIVE`|`PROD`) · `probeVersionId` · `probeVersionNo` · `probeContentHash`(운영 버전일 때) · `probeThreshold`(해석된 기준)를 기록한다.
- 운영 버전을 읽지 못하면(`TARGET_VERSION_UNREADABLE`) **대조만 실패**로 두고 분석은 계속한다(`probeStatus = 'FAILED'`) — TC 실행은 실패로 끝내지만(`test-run.executor.ts` 166~169행) 여기서 대조는 부가 정보다(R-20).

### 9.2 단일 턴 판정 (`UtteranceProbeService.probe()`)

`TestRunExecutor`를 **호출하지도 고치지도 않는다**(C-5). 같은 **규약**(ADR-0030: 기록 0 · 전역 질의 캐시 0 · 번들·색인·벡터 맵 실행당 1회 로드)과 같은 **부품**을 쓴다.

```
for 발화 u (정렬 순서, 50개마다 await setImmediate 양보 · 취소 확인):
  v = 임베딩 단계에서 이미 얻은 u의 벡터(추가 임베딩 호출 0)
  semantic = settings.semanticEnabled && entries.length>0 ? assembleSemanticInput(v, entries, bundle, thresholds, modelId) : undefined
  r = resolveTurn({ message: u.text }, undefined, bundle, now, { index, semantic, surveyPreview: true })
  answered = judgeAnswered(r.trace)                         ← conversation/lib/conversation-log.ts 파일 import(C-11)
  match   = r.matchedNodeId ? NODE : r.matchedFaqId ? FAQ : r.matchedIntentId ? INTENT : 없음
  band/top1Score = semantic ? judgeBand(semantic.ranked, thresholds).kind / ranked[0].score : 'SKIPPED' / null
```

- **상태 없는 단일 턴**(봉투 없음) · `now`는 작업 시작 시각 1개로 고정(재현성).
- **API 노드**(`r.apiCall` 있음): 외부 호출도 목 완결도 하지 않고 **매칭된 노드를 답한 것으로 본다**(FR-DC5-6 · R-21). 레거시·업무 자동화·RAG 모듈을 import하지 않는다(DC-3).
- **RAG 표시**(FR-DC5-6): `band === 'FAILED' ∧ settings.ragEnabled ∧ settings.ragCompany ∧ RAG_BASE_URL 설정` → `wouldUseRag = true`("2단계(외부 문서 답변)로 넘어갈 발화"). 외부 호출 0.
- **금지어**: 발화는 이미 마스킹돼 입구 금지어 판정을 다시 하지 않는다(`hasBannedWord`로 표시만).
- 매칭 대상 이름(`probeMatchName`)은 대조 시점 번들에서 뽑은 **스냅샷**이다(의도가 나중에 지워져도 결과 화면이 성립 — 로그 규약).

### 9.3 학습 후보 판정 (`lib/learning-candidate.ts` · FR-DC5-4)

`threshold = 요청 probe.scoreThreshold ?? settings.acceptThreshold`(원본 "의도 정확도" — 화면은 0~100 입력, 저장은 0~1).

```
learningCandidate = !answered || (top1Score !== null && top1Score < threshold)
```

- 뜻: "챗봇이 답하지 못했거나, 가장 비슷한 예문과의 점수가 기준 미만". 의미 매칭이 꺼져 있거나(설정) 점수가 없으면 `!answered`만 본다. 기준을 0으로 두면 "답하지 못한 발화만".
- 묶음별 `candidateCount`·학습 후보 비율 = 후보 고유 발화 수 / 묶음 고유 발화 수.

### 9.4 추천 의도 (FR-DC5-5 — 비용 0 재사용)

- 의미 점수가 있으면 `semantic.ranked`에서 `kind === 'INTENT'`인 항목을 점수순으로 **서로 다른 의도 최대 3개**, `score ≥ settings.lowThreshold`만 → `{ intentId, name, score, source: 'SEMANTIC' }`.
- 없으면 기존 `learning/lib/intent-suggest.ts`(문자 bigram 자카드 — 파일 import) 상위 3·0.15 이상 → `source: 'LEXICAL'`.
- 분류기(No.23)는 쓰지 않는다 — 벡터가 이미 있어 의미 순위가 공짜이고, 분류기는 예측마다 임베딩을 다시 부른다(R-17).

### 9.5 대조 끔·실패 (FR-DC5-7 · AC-DC4-4)

`probe.enabled = false` → 대조 단계 건너뜀 · `probeStatus = 'OFF'` · 발화 행의 대조 필드 전부 `null` · `learningCandidate = false` · 화면에 "챗봇 대조를 하지 않은 분석입니다". 실패는 `probeStatus = 'FAILED'` + `probeFailureReason`(`TARGET_VERSION_UNREADABLE`·`INTERNAL_ERROR`).

---

## 10. 데이터 모델 · 마이그레이션

### 10.1 Prisma 변경안

```prisma
/// [신규 No.21] 발화 묶음 분석 1건(ADR-0047). 상태를 스스로 소유한다(`TrainingJob` kind 추가 0 — ADR-0027 갱신① 선례).
/// ★쓰기 = utterance-analysis/core/utterance-analysis.store.ts 1파일(삭제는 + governance-data.writer.ts · chatbots.service.ts).
/// 문장 원문 없음(파일 이름은 마스킹·절단본). 환경 밖 — 스냅샷·복사·토픽 분리·승격·자산 이관 대상 아님(FR-DC9-6).
model UtteranceAnalysis {
  id                 String    @id @default(uuid())
  chatbotId          String
  chatbot            Chatbot   @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED (zod UtteranceAnalysisStatus)
  status             String    @default("QUEUED")
  /// EMBEDDING | CLUSTERING | KEYWORDS | PROBING | NAMING | SAVING | null
  stage              String?
  progress           Int       @default(0)
  /// 동시 실행 잠금 — QUEUED·RUNNING 동안 'ACTIVE', 종결 시 null. nullable 유일 = 서버 전체 1건(부분 인덱스 아님 — §10.2)
  activeLock         String?   @unique
  /// 결과 커밋 시각 — 이후 취소 불가(§8.3)
  resultsCommittedAt DateTime?
  /// 업로드 파일 이름(경로 제거·금지어·PII 마스킹·120자) — 사람 이름은 가려지지 않음(K-2)
  fileName           String
  /// XLSX | CSV
  fileKind           String
  /// JSON UtteranceAnalysisConditions(요청 조건 그대로)
  conditions         String
  /// JSON UtteranceAnalysisCounts(전체·유효·병합·제외 사유별·마스킹·금지어·발생 합 — 건수만)
  counts             String
  /// JSON string[] — TARGET_REDUCED | FEWER_THAN_TARGET | NO_CLUSTER | HEURISTIC_ANALYZER
  notices            String    @default("[]")
  embeddingModelId   String?
  /// 'skmeans-1' — 결과를 바꾸는 알고리즘 상수가 바뀌면 올린다
  algorithmVersion   String
  /// 형태소 분석기 id(garu-ko@… | heuristic)
  analyzerId         String?
  /// OFF | DONE | FAILED
  probeStatus        String    @default("OFF")
  probeFailureReason String?
  /// LIVE | PROD — 대조에 실제 쓴 번들
  probeTargetKind    String?
  probeVersionId     String?
  probeVersionNo     Int?
  probeContentHash   String?
  probeThreshold     Float?
  /// OFF | DONE | PARTIAL | FAILED
  nameSuggestStatus  String    @default("OFF")
  nameSuggestFailureReason String?
  clusterCount       Int?
  unassignedCount    Int?
  candidateCount     Int?
  appliedCount       Int       @default(0)
  /// 오류 코드성 문자열(외부 오류 원문·스택·문장 0)
  failureReason      String?
  /// 요청자(FK 없음 — 사실 기록 · 이름 스냅샷)
  requestedById      String?
  requestedByEmail   String?
  /// 보존 만료 시각 = 생성 시각 + UTTERANCE_ANALYSIS_RETENTION_DAYS(생성 시 고정 — §14.1)
  expiresAt          DateTime
  startedAt          DateTime?
  finishedAt         DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  clusters   UtteranceCluster[]
  utterances AnalyzedUtterance[]

  @@index([chatbotId, createdAt])
  @@index([expiresAt, status])
  @@map("utterance_analyses")
}

/// [신규 No.21] 분석 결과의 묶음(미분류 포함). 중심점 벡터는 저장하지 않는다.
model UtteranceCluster {
  id              String            @id @default(uuid())
  analysisId      String
  analysis        UtteranceAnalysis @relation(fields: [analysisId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// 1..m(발화 수 내림차순) · 미분류 = m+1
  ordinal         Int
  unassigned      Boolean           @default(false)
  /// JSON [{ term, score, count }]
  keywords        String            @default("[]")
  /// 상위 키워드 3개 연결 | '묶음 N' | '미분류'
  autoName        String
  /// 관리자 수정 이름(메모 — 자산 아님 · 감사 아님 · ≤40자 · 금지어 차단 · PII 마스킹)
  customName      String?
  /// AI 제안 이름(검사 통과분만 · "AI 제안 — 확인 필요")
  suggestedName   String?
  utteranceCount  Int
  occurrenceSum   Int
  candidateCount  Int               @default(0)
  appliedCount    Int               @default(0)
  /// JSON number[] — 대표 발화 seq 최대 3
  representativeSeqs String         @default("[]")

  utterances AnalyzedUtterance[]

  @@unique([analysisId, ordinal])
  @@map("utterance_clusters")
}

/// [신규 No.21] 분석 대상 발화 1행(병합 후 고유 문장). ★text·sourceMemo는 금지어·PII 마스킹 완료본만(브랜드 타입 — DC-7).
model AnalyzedUtterance {
  id                  String            @id @default(uuid())
  analysisId          String
  analysis            UtteranceAnalysis @relation(fields: [analysisId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  clusterId           String
  cluster             UtteranceCluster  @relation(fields: [clusterId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// 분석 안 정렬 순번(§5.4 ⑦) — 페이지 조회 키
  seq                 Int
  text                String
  textNormalized      String
  occurrenceCount     Int               @default(1)
  sourceMemo          String?
  hasBannedWord       Boolean           @default(false)
  hasMaskToken        Boolean           @default(false)
  similarityToCentroid Float?
  /// 대조 결과(대조 끔 = 전부 null)
  probeAnswered       Boolean?
  /// INTENT | FAQ | NODE
  probeMatchKind      String?
  /// Intent/FaqEntry/DialogNode.id — FK 없음(사실 기록)
  probeMatchId        String?
  probeMatchName      String?
  /// CONFIRMED | AMBIGUOUS | FAILED | SKIPPED
  probeBand           String?
  probeScore          Float?
  wouldUseRag         Boolean           @default(false)
  learningCandidate   Boolean           @default(false)
  /// JSON [{ intentId, name, score, source }] ≤3
  suggestedIntents    String            @default("[]")
  /// 반영 기록 — Intent.id FK 없음(의도가 지워져도 사실 기록으로 남는다)
  appliedIntentId     String?
  appliedIntentName   String?
  appliedById         String?
  appliedByEmail      String?
  appliedAt           DateTime?

  @@unique([analysisId, seq])
  @@unique([analysisId, textNormalized])
  @@index([analysisId, clusterId, seq])
  @@index([analysisId, learningCandidate, seq])
  @@index([clusterId])
  @@map("analyzed_utterances")
}
```

`Chatbot` 모델에 역참조 1줄(`utteranceAnalyses UtteranceAnalysis[]` — DB 컬럼 변화 0 · No.35 선례 주석).

### 10.2 마이그레이션 (1개 — `2026100xxxxxxx_utterance_analysis`, 번호는 생성 시점)

- 내용: `CREATE TABLE` 3 + `CREATE INDEX`·`CREATE UNIQUE INDEX`(위 `@@index`·`@@unique`·`activeLock @unique`)뿐. **테이블 재정의·`ALTER`·백필 0**(`Chatbot` 역참조는 DB 변화 0).
- ⚠ **원시 부분 유니크 인덱스 4개 보존**: `test_runs_chatbotId_active_key`(`20260922225951`) · `deploy_schedules` 2개(`20260923150000`) · `handoff_sessions_active_key`(`20260925100000`)는 스키마 언어로 표현되지 않아 `prisma migrate dev`의 diff가 **`DROP INDEX`를 끼워 넣을 수 있다**. 생성된 `migration.sql`에 `DROP INDEX` 줄이 있으면 **그 줄을 지우고** 적용한다. 적용 뒤 `SELECT count(*) FROM sqlite_master WHERE type='index' AND sql LIKE '%WHERE%'` = **4** 확인(No.44~No.35 선례와 같은 점검). 이 그룹은 원시 부분 인덱스를 **추가하지 않는다**(동시 실행 = nullable 유일 — ADR-0041 선례 · 개발명세서 §3 미도입 ⑱).
- 통합 시험 DB는 `prisma migrate deploy`로 만든다(`db push`는 부분 인덱스를 만들지 않는다 — CLAUDE.md).
- 롤백: 새 테이블 3개 `DROP`(다른 테이블 참조 없음) + 코드 되돌리기. 기존 데이터 호환성 영향 0(새 테이블만 · 기존 행 불변).
- seed: 변경하지 않는다(분석 0행이 정상 상태 · 데모 분석을 만들지 않는다 — 가짜 개인정보 데이터 생성 회피).

### 10.3 FK·삭제 규약 (개발명세서 §3.1)

- 3관계(`UtteranceAnalysis → Chatbot` · `UtteranceCluster → UtteranceAnalysis` · `AnalyzedUtterance → UtteranceAnalysis·UtteranceCluster`) 전부 `Restrict`(암묵 cascade 금지 — ADR-0005). 삭제는 **발화 → 묶음 → 분석** 순서로 명시 `deleteMany`.
- FK를 걸지 않는 참조(사실 기록): `requestedById` · `probeVersionId` · `probeMatchId` · `appliedIntentId` · `appliedById` · `suggestedIntents[].intentId`(JSON).
- 분류: **파생 데이터 → 챗봇 영구삭제 동반 삭제**(27 → 30테이블). 사전검사(409) 대상이 아니다 — 업로드된 외부 발화는 챗봇 대화 기록(통계 원천)이 아니다.

---

## 11. shared-types 계약 (`packages/shared-types/src/utterance-analysis.ts`)

```ts
export const UTTERANCE_ANALYSIS_LIMITS = {
  targetClusterCount: { min: 2, max: 50, default: 10 },
  minClusterSize:     { min: 2, max: 100, default: 5 },
  keywordCount:       { min: 1, max: 20, default: 10 },
  applyMaxUtterances: 50,
  utterancePageSizeMax: 100,
  customNameMax: 40,
  newIntentNameMax: 100,   // 기존 의도 이름 규칙과 같게(구현 시 intents 스키마 상한 값을 import해 1벌 유지)
  exampleMaxChars: 200,    // 기존 의도 예문 규칙(FR-6-6)
} as const;

export const UtteranceAnalysisStatus = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
export const UtteranceAnalysisStage  = z.enum(['EMBEDDING', 'CLUSTERING', 'KEYWORDS', 'PROBING', 'NAMING', 'SAVING']);
export const ProbeTarget  = z.enum(['SERVING', 'DRAFT']);
export const UtteranceExclusionReason = z.enum(['EMPTY', 'TOO_LONG', 'TOO_SHORT', 'NO_CONTENT']);
export const UtteranceAnalysisNotice  = z.enum(['TARGET_REDUCED', 'FEWER_THAN_TARGET', 'NO_CLUSTER', 'HEURISTIC_ANALYZER']);

export const UtteranceAnalysisConditionsSchema = z.object({
  targetClusterCount: z.number().int().min(2).max(50).default(10),
  minClusterSize:     z.number().int().min(2).max(100).default(5),
  keywordCount:       z.number().int().min(1).max(20).default(10),
  nounsOnly:          z.boolean().default(true),
  probe: z.object({
    enabled: z.boolean().default(true),
    target: ProbeTarget.default('SERVING'),
    scoreThreshold: z.number().min(0).max(1).nullable().default(null),   // null = 챗봇 acceptThreshold
  }).strict().default({}),
  nameSuggest: z.boolean().default(false),
}).strict();
// 멀티파트 필드 `conditions`(JSON 문자열)를 서버가 JSON.parse → 이 스키마로 파싱. 파싱 실패 = 400 VALIDATION_FAILED.

export const UtteranceAnalysisCountsSchema = z.object({
  totalRows: z.number().int(), validCount: z.number().int(), mergedCount: z.number().int(),
  excluded: z.record(UtteranceExclusionReason, z.number().int()),
  maskedRowCount: z.number().int(), bannedRowCount: z.number().int(),
  invalidCountRows: z.number().int(), occurrenceTotal: z.number().int(),
});
export const UtterancePreviewResponseSchema = UtteranceAnalysisCountsSchema.extend({
  fileKind: z.enum(['XLSX', 'CSV']), canAnalyze: z.boolean(), reasonIfNot: z.literal('TOO_FEW').optional(),
});

export const UtteranceAnalysisListItemSchema = z.object({
  id, status, stage: UtteranceAnalysisStage.nullable(), progress,
  fileName, requestedByEmail: z.string().nullable(), createdAt, finishedAt: z.coerce.date().nullable(),
  validCount, clusterCount: z.number().int().nullable(), candidateCount: z.number().int().nullable(),
  appliedCount, expiresAt: z.coerce.date(),
});
export const UtteranceAnalysisListQuerySchema = PaginationQuerySchema.extend({ status: csvEnumArray(UtteranceAnalysisStatus) });

export const UtteranceClusterSchema = z.object({
  id, ordinal, unassigned: z.boolean(), displayName: z.string(),
  autoName, customName: z.string().nullable(), suggestedName: z.string().nullable(),
  keywords: z.array(z.object({ term: z.string(), score: z.number(), count: z.number().int() })),
  utteranceCount, occurrenceSum, candidateCount, candidateRatio: z.number().nullable(), appliedCount,
  representatives: z.array(z.object({ utteranceId: z.string(), text: z.string() })).max(3),
});
export const UtteranceAnalysisDetailSchema = UtteranceAnalysisListItemSchema.extend({
  fileKind, conditions: UtteranceAnalysisConditionsSchema, counts: UtteranceAnalysisCountsSchema,
  notices: z.array(UtteranceAnalysisNotice), failureReason: z.string().nullable(),
  embeddingModelId: z.string().nullable(), staleModel: z.boolean(),         // 현재 임베딩 modelId와 다름(EX-DC-12 · NFR-DCM3)
  algorithmVersion, analyzerId: z.string().nullable(),
  probe: z.object({ status: z.enum(['OFF','DONE','FAILED']), failureReason: z.string().nullable(),
                    targetKind: z.enum(['LIVE','PROD']).nullable(), versionNo: z.number().int().nullable(),
                    threshold: z.number().nullable(), wouldUseRagCount: z.number().int() }),
  nameSuggest: z.object({ status: z.enum(['OFF','DONE','PARTIAL','FAILED']), failureReason: z.string().nullable() }),
  unassignedCount: z.number().int().nullable(),
  clusters: z.array(UtteranceClusterSchema),                                 // ≤ 51행 — 상세에 동봉
  startedAt: z.coerce.date().nullable(), durationMs: z.number().int().nullable(),
});

export const AnalyzedUtteranceSchema = z.object({
  id, seq, clusterId, clusterOrdinal, clusterDisplayName, text, occurrenceCount, sourceMemo: z.string().nullable(),
  hasBannedWord, hasMaskToken,
  probe: z.object({ answered: z.boolean(), matchKind: z.enum(['INTENT','FAQ','NODE']).nullable(),
                    matchId: z.string().nullable(), matchName: z.string().nullable(),
                    band: z.string().nullable(), score: z.number().nullable(), wouldUseRag: z.boolean() }).nullable(),
  learningCandidate: z.boolean(),
  suggestedIntents: z.array(z.object({ intentId: z.string(), name: z.string(), score: z.number(), source: z.enum(['SEMANTIC','LEXICAL']) })),
  applied: z.object({ intentId: z.string(), intentName: z.string(), byEmail: z.string().nullable(), at: z.coerce.date() }).nullable(),
});
export const AnalyzedUtteranceListQuerySchema = PaginationQuerySchema.extend({
  clusterId: z.string().uuid().optional(),
  candidateOnly: queryBoolean().optional(),      // z.coerce.boolean 금지(CLAUDE.md)
  unappliedOnly: queryBoolean().optional(),
  q: z.string().trim().min(1).max(50).optional(),  // 마스킹본 부분 일치(서버 · 5,000행 전송 0 — NFR-DCP3)
}).refine(q => q.pageSize <= 100);

export const ClusterRenameRequestSchema = z.object({ customName: z.string().trim().min(1).max(40).nullable() }).strict();

export const UtteranceApplyTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('EXISTING'), intentId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('NEW'), intentName: z.string().trim().min(1).max(100) }).strict(),
]);
export const UtteranceApplyRequestSchema = z.object({
  utteranceIds: z.array(z.string().uuid()).min(1).max(50),
  target: UtteranceApplyTargetSchema,
}).strict();
export const UtteranceApplyExcludeReason = z.enum([
  'NOT_FOUND', 'ALREADY_APPLIED', 'BANNED_WORD', 'TOO_LONG', 'DUPLICATE_IN_TARGET', 'DUPLICATE_IN_OTHER_INTENT', 'TARGET_LIMIT',
]);
export const UtteranceApplyPreviewResponseSchema = z.object({
  target: z.object({ resolution: z.enum(['EXISTING', 'NEW', 'EXISTING_BY_NAME']), intentId: z.string().nullable(), intentName: z.string() }),
  included: z.array(z.object({ utteranceId, text, warnings: z.array(z.enum(['MASK_TOKEN'])) })),
  excluded: z.array(z.object({ utteranceId, reason: UtteranceApplyExcludeReason, conflictIntentName: z.string().optional() })),
  resultingExampleCount: z.number().int(),
  linkedNodeCount: z.number().int().nullable(),   // 새 의도 = null · 0이면 "이 의도를 쓰는 대화상자가 없습니다"(No.15 규칙)
  draftOnly: z.boolean(),                          // 환경 모드 켜짐 — 초안에만 반영(FR-DC7-6)
});
export const UtteranceApplyResponseSchema = z.object({
  succeeded: z.number().int(), intentId: z.string().nullable(), intentName: z.string(), created: z.boolean(),
  excluded: UtteranceApplyPreviewResponseSchema.shape.excluded,
  failed: z.array(z.object({ utteranceId: z.string(), code: ApiErrorCode, message: z.string() })),
  appliedImmediately: z.boolean(), linkedNodeCount: z.number().int(), draftOnly: z.boolean(),
  autoSnapshot: AutoSnapshotOutcomeSchema.optional(),     // 기존 증강 승인 응답과 같은 형식
});

export const UtteranceAnalysisCapabilitySchema = z.object({
  embeddingAvailable: z.boolean(),
  nameSuggestAvailable: z.boolean(),         // 설정 켬 ∧ AUGMENTATION_LOCAL_BASE_URL 있음(네트워크 확인 없음)
  busy: z.object({ server: z.boolean(), chatbot: z.boolean() }),
  stored: z.object({ count: z.number().int(), max: z.number().int() }),
  limits: z.object({ maxFileBytes: z.number().int(), maxRows: z.number().int(), maxChars: z.number().int() }),
  retentionDays: z.number().int(),
  envModeEnabled: z.boolean(),               // 대조 대상 선택지("운영 중 답변"/"초안") 표시 판단
});
```

- 필드 줄임표(`id, status …`)는 설계 표기다 — 구현은 각 필드를 명시한다. 날짜는 `z.coerce.date()` 규약.
- `ApiErrorCode` +3(`common.ts` 끝 — "딥러닝 군집분석(No.21) 그룹 추가 — 3종"): **`UTTERANCE_ANALYSIS_BUSY`**(409) · **`UTTERANCE_ANALYSIS_STORE_FULL`**(409) · **`UTTERANCE_ANALYSIS_TOO_FEW`**(400). 나머지는 재사용: `IMPORT_FILE_INVALID`·`IMPORT_TOO_LARGE`·`EMBEDDING_UNAVAILABLE`·`EGRESS_HOST_NOT_ALLOWED`·`INVALID_STATUS_TRANSITION`·`CHATBOT_ARCHIVED`·`NOT_FOUND`·`VALIDATION_FAILED`·`BANNED_WORD_BLOCKED`·`DUPLICATE_NAME`.
- `GovernanceMapResponseSchema`에 선택 키(분석 0건이면 **키 생략** — 바이트 동일):
  `utteranceAnalysis?: { analyses: int, utterances: int, retentionDays: int, storesMaskedOnly: true, originalFileStored: false, exits: ('EMBEDDING'|'AUGMENT_LOCAL')[], nameSuggestEnabled: boolean, retentionJobEnabled: boolean }`

---

## 12. API (챗봇 스코프 `/chatbots/:chatbotId/utterance-analyses` — 13 핸들러)

| # | 메서드·경로 | 권한 | 요약 |
|---|---|---|---|
| 1 | `GET …/template?format=xlsx｜csv` | `dialogue:read` | 양식 받기(머리글 3 + 합성 예시 2행 — 개인정보 0 · CSV는 BOM·수식 방어) ⚠ `:analysisId`보다 먼저 선언 |
| 2 | `GET …/capability` | `dialogue:read` | §11 · 네트워크 호출 0 · ⚠ 먼저 선언 |
| 3 | `POST …/preview` | `dialogue:write` | multipart `file` · 쿼리 `minClusterSize?` → 건수(저장 0 · 감사 0) · ⚠ 먼저 선언 |
| 4 | `POST …` | `dialogue:write` | multipart `file` + 필드 `conditions` → **`202 { analysisId, status }`** · 감사 CREATE |
| 5 | `GET …` | `dialogue:read` | 목록(페이지 · `createdAt desc` 고정 · 상태 필터) |
| 6 | `GET …/:analysisId` | `dialogue:read` | 상세 + 묶음 목록(폴링 대상 — 처리 중이면 묶음 `[]`) |
| 7 | `GET …/:analysisId/utterances` | `dialogue:read` | 발화 목록(필터·검색·페이지 ≤100 · `seq` 순) · **거버넌스 모드 `VIEW` 감사**(§13.2) |
| 8 | `PATCH …/:analysisId/clusters/:clusterId` | `dialogue:write` | 이름 수정(`null` = 자동 이름으로 되돌림) · 비감사 |
| 9 | `GET …/:analysisId/export` | `dialogue:read` | 엑셀(시트 `묶음`·`발화`) · **`EXPORT` 감사(모드 무관)** · 완료 분석만 |
| 10 | `POST …/:analysisId/apply/preview` | `dialogue:write` | 반영 계획(DB 변경 0) |
| 11 | `POST …/:analysisId/apply` | `dialogue:write` | 반영(★자산 쓰기) · 감사 |
| 12 | `POST …/:analysisId/cancel` | `dialogue:write` | 취소 CAS |
| 13 | `DELETE …/:analysisId` | `dialogue:write` | 수동 삭제(종결 상태만 — 처리 중 `409 INVALID_STATUS_TRANSITION`) · 감사 DELETE · `204` |

- **권한 = 신규 0**(FR-0-295 · J-11): 조회·다운로드 `dialogue:read`(VIEWER 가능) · 요청·수정·반영·취소·삭제 `dialogue:write`(EDITOR·ADMIN). 반영은 의도 예문 편집과 같은 권한이다(학습현황 반영 선례).
- 교차 챗봇·없는 분석·다른 분석의 묶음/발화 = `404 NOT_FOUND`(`where: { id, chatbotId }` · `where: { id, analysisId }`).
- 보관 챗봇: 조회·다운로드 허용 · 쓰기 전부 `409 CHATBOT_ARCHIVED`(FR-DC9-5).
- `UTTERANCE_ANALYSIS_ENABLED=false` → 13개 전부 `404`(콘솔은 capability `404`면 메뉴를 숨긴다 — 통합 인박스 `OMNI_INBOX_ENABLED` 선례).
- 반영(11)·삭제(13)·다운로드(9)·요청(4)은 완료 조건을 따른다: 반영·다운로드 = `SUCCEEDED`만(그 외 `409 INVALID_STATUS_TRANSITION`) · 삭제 = `SUCCEEDED｜FAILED｜CANCELLED`.
- multer: `memoryStorage` · `limits: { fileSize: IMPORT_LIMITS.maxFileBytes, files: 1, fields: 2 }` · 버퍼는 핸들러가 파싱 후 참조를 놓는다(DC-8).
- 응답 봉투·오류 형식은 ADR-0003 그대로. `@Public()` 0.

---

## 13. 권한 · 감사 · 거버넌스

### 13.1 권한

§12 표. `ROLE_PERMISSIONS` 변경 0 · `Permission` 18종 불변(AC-DC1-3).

### 13.2 감사 (`AuditTargetType` +1 `UtteranceAnalysis` — 라벨 "발화 묶음 분석")

| 사건 | 액션 | 기록 위치 | 내용(문장 0) |
|---|---|---|---|
| 분석 요청 | `CREATE` | 서비스(§7.4 ⑨) | targetId = 분석 id · targetName = 마스킹 파일 이름 · after `{ validCount, totalRows, conditions(수치·불리언), fileKind }` · summary "발화 묶음 분석 요청(유효 N건)" — **외부 데이터 반입 기록**(R-15) |
| 엑셀 다운로드 | `EXPORT` | `export/utterance-analysis-export.service.ts` → `AuditLogService.recordExport()` | after `{ clusters, utterances, rows }` · summary "발화 묶음 분석 결과 내보내기(N행)" — 응답 생성 후·전송 전(No.45 §11.2 규약) |
| 발화 목록 조회 | `VIEW`(거버넌스 모드에서만) | `@AuditView('UtteranceAnalysis')` — `UtteranceAnalysesController#listUtterances` | 기존 인터셉터 규약(같은 열람자·같은 대상 하루 1건) · `VIEW_AUDIT_TARGETS` 11 → 12(R-14) |
| 반영 | `UPDATE` | `apply/utterance-apply.service.ts` | after `{ intentId, created, appliedCount, excludedByReason }` · summary "발화 묶음 분석 예문 반영(N건)" — **추가로** 의도별 기존 감사(`UPDATE｜CREATE Intent` — `applyLearningExample()`이 남김, auditSummary "발화 묶음 분석 예문 반영 (N건)") |
| 수동 삭제 | `DELETE` | store 호출 전 서비스 | after `{ clusters, utterances, appliedCount }` |
| 보존 파기 | (요약) `PURGE RetentionRun` | 기존 파기 잡 | `affectedByKind.UTTERANCE_ANALYSIS`(>0일 때만) |
| 이름 수정·취소 | 감사 안 함 | — | 메모 성격 · TC 취소 선례(FR-DC4-3 권고) |

`AUDIT_FIELDS.UtteranceAnalysis` 화이트리스트 = `status`·`validCount`·`totalRows`·`clusterCount`·`appliedCount`·`fileKind`·`conditions`·`intentId`·`created`·`excludedByReason`·`clusters`·`utterances`·`rows` — **`text`·`fileName`·`memo`·`keywords`류 0**(G-18 방식 단언을 이 대상에도 추가 — UA-9).

### 13.3 출구 (FR-0-292 · FR-DC9-4)

| 구간 | 출구 클래스 | 보내는 것 | 판정 |
|---|---|---|---|
| API → ml-worker `/embed` | `EMBEDDING`(기존 파일 `http-embedding.provider.ts`) | **마스킹된** 발화(대화 경로는 원문 `QUERY_RAW` — 이 기능은 더 보수적) | 기존 가드 · 요청 시 사전 판정 |
| API → ml-worker `/cluster-label` | `AUGMENT_LOCAL`(신규 파일 `naming/cluster-name-http.client.ts`를 레지스트리 `files`에 추가) | 묶음별 키워드 + 마스킹 대표 발화 ≤5 | `fetch(` 직전 `assertEgressAllowed('AUGMENT_LOCAL', url)` · `egressRedirectMode()`·`assertNoRedirectResponse()` |
| ml-worker → Ollama/vLLM | (API 출구 밖) | 같은 내용 | No.37 `backend_guard`(루프백·사설·허용 목록) 그대로 |

- **거버넌스 기동 검사**: 모드 ON이고 `UTTERANCE_ANALYSIS_NAME_SUGGEST_ENABLED=true`이면 `AUGMENTATION_LOCAL_BASE_URL` 호스트가 허용 목록에 있어야 기동한다(`AUGMENTATION_PROVIDER=local`의 기존 검사와 같은 규칙 — 조건 1개 추가). `EMBEDDING`은 이미 검사된다.
- 외부 LLM API(Gemini 등)로 발화를 보내는 경로 0 — 이름 제안 포트에 cloud 구현을 두지 않는다(P-4 · FR-0-292).

### 13.4 데이터 지도 (FR-DC9-3)

§11의 선택 키 `utteranceAnalysis?` — 분석이 1건 이상일 때만. 콘솔 데이터 지도에 "업로드 발화 분석: 마스킹본만 저장 · 원본 파일 저장 안 함 · 보존 N일(설정) · 보내는 곳 = 문장 분석 서비스(+ 이름 제안을 켜면 로컬 생성기)" 한 절을 추가한다(ui-designer · 기존 `kbSources`·`proactive` 절 선례). 파기 잡이 꺼져 있으면(`DATA_RETENTION_JOB_ENABLED=false`) "자동 삭제가 동작하지 않습니다" 경고.

---

## 14. 보존 · 삭제 (FR-DC9 · P-6)

### 14.1 보존 일수 = 기능 설정 + 행 만료 시각 고정 (R-3)

- `UTTERANCE_ANALYSIS_RETENTION_DAYS`(기본 **90** · 1~3650). 분석 생성 시 `expiresAt = createdAt + days × 24h`로 **고정**한다.
- **고정하는 이유**: ① 화면이 "이 분석은 ○월 ○일에 삭제됩니다"를 정확히 말할 수 있다 ② 운영자가 일수를 줄여도 이미 만든 분석이 **예고 없이** 다음 창에 한꺼번에 사라지지 않는다(No.45는 콘솔 단축에 7일 유예를 둔다 — 환경변수에는 유예 장치가 없으므로 "새 분석부터 적용"이 같은 보호다) ③ 파기 조회가 인덱스 `(expiresAt, status)` 한 번으로 끝난다.
- **No.45 보존 종류(`RetentionTargetKind`)에 넣지 않는 이유**: 전역 값의 규약이 "키 없음 = 무기한"(C-9)인데 PM 확정은 "기본 90일"이다. 한 종류만 "키 없음 = 90"으로 읽으면 보존 정책 화면·미리보기·단축 유예·지도 요약이 종류마다 다른 기본값 의미를 갖게 된다. 대신 **실행은 No.45 파기 잡**(같은 창·임대·이력·감사)에 태워 "보존 체계와 정합"을 지킨다. 콘솔 보존 정책 화면에서 이 값을 바꾸는 기능은 재검토 트리거로 남긴다(K-4).

### 14.2 자동 삭제 (AC-DC7-1)

`RetentionJob.tick()`의 **CUSTOMER_IDENTITY 단계 뒤 · AUDIT_LOGS 단계 앞**에 한 단계:

```
if (!signal.stopping() && rowsBudget.remaining > 0) {
  affected = purgeBatchLoop(rowsBudget, signal, async () => {
    ids = utteranceAnalysis.findMany({ where: { expiresAt: { lt: now }, status: { in: ['SUCCEEDED','FAILED','CANCELLED'] } },
                                       select: { id }, orderBy: { expiresAt: 'asc' }, take: 20 })   // 분석 단위 배치(행은 최대 20×5,000)
    return ids.length ? writer.deleteUtteranceAnalyses(ids, now) : 0     // 반환 = 삭제한 분석 수
  })
  if (affected > 0) affectedByKind.UTTERANCE_ANALYSIS = affected          // 0이면 키를 만들지 않는다(바이트 동일)
}
```

- `GovernanceDataWriter.deleteUtteranceAnalyses(ids)`: 한 트랜잭션 — `enableSecureDelete(tx)`(마스킹본이라도 사람 이름 등이 남을 수 있는 텍스트 행 — 대화 소거 선례) → `analyzedUtterance.deleteMany({ analysisId in ids })` → `utteranceCluster.deleteMany(…)` → `utteranceAnalysis.deleteMany({ id in ids, status in 종결 })`. `rowsBudget`은 **삭제한 발화 행 수**로 차감한다(1회 상한 `DATA_RETENTION_MAX_ROWS_PER_RUN`과 같은 단위).
- `affectedByKind`에 키가 생길 때만 기존 요약 감사(`PURGE RetentionRun`)에 포함된다 — 분석이 없는 설치는 파기 잡 결과·감사가 **바이트 동일**(FR-0-287). 부하는 창 안에서 하루 1회 `findMany` 1건 추가(K-5).
- `RetentionRun` 요약 행은 기존대로 1건(대상별 행을 새로 만들지 않는다). 파기 이력 화면은 요약 감사의 `affectedByKind`로 건수를 보여 준다(문장 0 — FR-DC9-2).
- 반영된 의도 예문은 자산이라 **삭제되지 않는다**(FR-DC9-2).

### 14.3 수동 삭제 (FR-DC6-4)

`DELETE …/:analysisId` → 종결 상태만 → `store.deleteAnalysis(id)`: 같은 순서·같은 `enableSecureDelete(tx)`. 확인 문구(ui): "분석 결과를 지웁니다. 이미 의도에 넣은 예문은 지워지지 않습니다."

### 14.4 챗봇 영구삭제 (FR-DC9-5 · AC-DC7-3)

`ChatbotsService.permanentDelete()`의 트랜잭션에 `tx.analyzedUtterance.deleteMany({ where: { analysis: { chatbotId } } })` → `tx.utteranceCluster.deleteMany({ where: { analysis: { chatbotId } } })` → `tx.utteranceAnalysis.deleteMany({ where: { chatbotId } })`(`testRunResult` 선례의 관계 필터). 27 → 30테이블. 사전검사 16종 불변. 처리 중 분석이 있어도 막지 않는다 — 작업의 결과 커밋은 FK 위반으로 롤백되고 작업은 FAILED로 끝난다(행이 이미 없으므로 무해 · K-12).

### 14.5 환경·스냅샷과의 관계 (FR-DC9-6)

버전 스냅샷(No.25)·토픽 복사/분리(No.22)·환경 승격(No.40)·자산 이관·챗봇 복사는 분석 3테이블을 **읽지도 복사하지도 않는다**(각 기능의 캡처·복사 대상 목록이 명시 열거라 코드 변경 0). 복원(`restore()`)은 분석을 막지 않는다(분석은 자산을 쓰지 않는다 — 반영 요청만 쓴다).

---

## 15. 선택 발화 → 의도 예문 반영 (FR-DC7)

### 15.1 계획 (`lib/apply-plan.ts` — 순수)

입력: 선택 발화 행들 · 대상 의도의 현재 예문(없으면 빈 목록) · 다른 의도들의 정규화 예문 집합(의도 이름 포함) · 상한(예문 200자 · 의도당 500개).

| 순서 | 판정 | 결과 |
|---|---|---|
| 1 | 이 분석의 발화가 아님 | 제외 `NOT_FOUND` |
| 2 | `appliedAt` 있음 | 제외 `ALREADY_APPLIED`(AC-DC5-4) |
| 3 | `hasBannedWord` | 제외 `BANNED_WORD` — **서버에서 항상 제외**(마스킹된 `***`가 예문에 들어가는 것을 막는다 · 화면은 기본 선택 해제 — R-4) |
| 4 | 길이 > 200(기존 예문 규칙) | 제외 `TOO_LONG` |
| 5 | 대상 의도에 같은 정규화 예문 | 제외 `DUPLICATE_IN_TARGET` |
| 6 | 다른 의도에 같은 정규화 예문 | 제외 `DUPLICATE_IN_OTHER_INTENT` + `conflictIntentName`(EX-DC-11 — 기존 서비스는 경고지만 이 경로는 제외 · R-5) |
| 7 | 포함 후 예문 수 > 500 | 넘는 분(정렬 순서 뒤쪽)부터 제외 `TARGET_LIMIT` |
| — | 마스킹 표식 포함 | **포함하되 경고** `MASK_TOKEN`("개인정보 가림 표시가 들어간 문장입니다 — 필요하면 의도 화면에서 다듬으세요") |

같은 선택 안의 두 발화가 같은 정규화 문장일 수는 없다(분석 안 `(analysisId, textNormalized)` 유일).

### 15.2 미리보기 (`POST …/apply/preview` — DB 변경 0)

`scope.assertWritable` → 분석 `SUCCEEDED` 확인 → 대상 해석: `EXISTING` = `intent.findFirst({ id, chatbotId })`(없음 = `404 NOT_FOUND` "의도가 없습니다" · EX-DC-10) · `NEW` = 정규화 이름으로 기존 의도 조회 → 있으면 `resolution: 'EXISTING_BY_NAME'`(그 의도에 넣는다고 알림 — `applyLearningExample()`의 이름 해석과 같은 규칙) · 없으면 `NEW` → 계획 → `linkedNodeCount`(`dialogNodeIntent.count`) · `draftOnly = chatbot.prodVersionId != null`.

### 15.3 반영 (`POST …/apply` — ★`apply/utterance-apply.service.ts`)

1. 미리보기 1~2와 같은 검사 + **계획을 다시 계산**(미리보기 이후 바뀐 상태 반영 — 결과는 응답이 정직하게 말한다).
2. 포함 0건 → `200 { succeeded: 0, … }`(자산·감사·스냅샷 0).
3. **자동 스냅샷**: `versionCapture.captureAuto(chatbotId, 'BEFORE_UTTERANCE_APPLY', { targetId: intentId?, itemCount })` — fail-open(증강 승인 선례 · 새 의도면 `targetId` 없음). 트리거 라벨 "발화 묶음 반영 직전(자동)" · 목록 필터 그룹 `AUTO`.
4. 포함 발화마다(정렬 순서): `intentsService.applyLearningExample(chatbotId, target, text, { auditSummary: '발화 묶음 분석 예문 반영 (N건)', deferBundleInvalidate: true })` → **첫 호출이 새 의도를 만들면 이후 대상은 `{ intentId }`로 바꾼다** → 성공하면 `store.markApplied(utteranceId, intentId, intentName, actor)`(`appliedAt IS NULL` CAS — 0행이면 동시 반영: 예문은 `mergeExampleMutation`의 정규화 중복 제거로 이미 하나뿐이므로 `ALREADY_APPLIED`로 보고) · 실패하면 `failed[]`(기존 코드 그대로 — 예: `LIMIT_EXCEEDED`).
5. **`learningApply.applyLearning({ chatbotId, intentIds, reason: 'UTTERANCE_ANALYSIS_APPLY', resolvedCount })` — 성공 1건 이상일 때 요청당 정확히 1회**(K-1~K-6 · AC-DC5-1). 반환 `appliedImmediately`를 그대로 전달(K-4).
6. `store.refreshAppliedCounts(analysisId)`(묶음·분석 `appliedCount` 재계산) → 감사 `UPDATE UtteranceAnalysis`.
7. 응답 `draftOnly = true`면 화면: "초안에 넣었습니다 — 운영에는 스테이징 승격·운영 전환을 거쳐 나갑니다"(FR-DC7-6 · AC-DC5-5).

**원자성**(NFR-DCR4): 증강 승인과 같이 **건별 부분 성공 + "들어간 것/빠진 것/실패한 것" 명시**를 택한다. 전체 롤백을 하려면 `applyLearningExample()`을 트랜잭션 인자를 받게 고쳐야 하고(의도 서비스·감사 체인 트랜잭션과 중첩), 자동 스냅샷이 되돌리기 안전망을 이미 준다(R-18).

### 15.4 봉인 (FR-DC7-4 · AC-DC5-3)

- `IntentsService` 주입·`.applyLearningExample(`·`.applyLearning(` = 이 파일에만(UA-4) · `asset-write-sealing.spec.ts` S-2 allowlist에 이 파일 추가(3 → 4 — 닫힌 목록 1).
- 러너 파일(`*job.runner.ts`)에 `IntentsService` 심볼 0(S-3가 자동 적용).
- 새 키워드·노드·FAQ·토픽을 만드는 코드 0(FR-DC7-7) — 새 의도는 **공통(토픽 없음)** 으로 생성된다(`applyLearningExample()`이 `topicId`를 쓰지 않음 · 토픽 지정은 기존 의도 화면에서 — R-9).

### 15.5 반영 표시 (FR-DC7-5)

발화 행 `applied*` · 목록 필터 "반영 안 된 것만" · 묶음 `appliedCount` · 분석 `appliedCount`. 반영한 의도가 나중에 지워져도 기록은 남는다(FK 없음).

### 15.6 묶음 이름 수정 (§6.3)

`customName`: trim · 1~40자 · 금지어 `BLOCK` 판정이면 `400 BANNED_WORD_BLOCKED` · 저장값은 `maskPii()` 결과 · `null`이면 자동 이름으로 되돌림. 자산이 아니므로 반영 경로 밖이다(스냅샷·감사 0).

---

## 16. 묶음 이름 제안 — LLM 선택 기능 (FR-DC8 · P-4)

### 16.1 켜는 조건

| 층 | 조건 |
|---|---|
| API 설정 | `UTTERANCE_ANALYSIS_NAME_SUGGEST_ENABLED=true`(기본 **false**) ∧ `AUGMENTATION_LOCAL_BASE_URL` 설정 → capability `nameSuggestAvailable = true` |
| 요청 | 조건 `nameSuggest: true`(화면 확인란 — 가용일 때만 보인다 · AC-DC6-1) |
| ml-worker | 생성 프로파일 프로세스(`ML_WORKER_ROLE=augment｜both`)에 `POST /cluster-label` 존재 |

셋 중 하나라도 아니면 이름 제안 0회 · 생성 백엔드 호출 0(AC-DC6-1). 기능 본체는 영향 없음(FR-0-290).

### 16.2 포트 (`naming/cluster-name-suggester.port.ts` — Nest·Prisma 무의존)

```ts
export interface ClusterNameSuggester {
  readonly suggesterId: 'local' | 'mock';
  suggest(input: { keywords: string[]; samples: MaskedUtteranceText[] }, signal: AbortSignal): Promise<string | null>;  // 실패·시간 초과 = null(예외 금지)
}
```

- 구현 2개: `local`(ml-worker `/cluster-label` HTTP — ★출구 파일) · `mock`(시험 — 결정론적 "키워드1 키워드2 문의"). **cloud 구현 없음**(FR-0-292). 팩토리 1곳(`cluster-name-suggester.factory.ts`) — 꺼짐이면 인스턴스를 만들지 않는다(`rule` 구성의 Gemini 인스턴스화 0 선례).
- **`packages/llm-provider` 승격 판정**: ADR-0026 §6·ADR-0046 재검토 트리거 "LLM 호출 소비자 2곳"이 **문자 그대로는 발동**한다(증강 + 이름 제안). 그러나 두 소비자는 **입출력 계약이 다르고**(예문 N개 생성 vs 이름 1개) **배포 형태 요구도 다르다**(증강 = rule·gemini·local / 이름 = local만 — cloud 금지). 공유할 수 있는 것이 "ml-worker 생성 프로세스로 HTTP를 보낸다"뿐이라 패키지로 올리면 빈 추상화만 늘어난다. → **이번에는 승격하지 않는다.** 포트 파일은 승격 가능한 형태(데코레이터·Prisma 무의존)로 두고, 트리거를 "**같은 생성 연산(같은 계약)을 쓰는 두 번째 소비자 또는 cloud 구현이 필요한 두 번째 소비자**"로 정밀화한다(ADR-0047 §8 · ADR-0026/0046 갱신 각주 · R-10).

### 16.3 API → ml-worker 계약

```
POST {AUGMENTATION_LOCAL_BASE_URL}/cluster-label
요청 { keywords: string[1..20](각 ≤30자), samples: string[0..5](각 ≤300자 · 마스킹본), locale: "ko" }
응답 200 { modelId: string, label: string | null }
```

- 호출 파일 `naming/cluster-name-http.client.ts`: `assertEgressAllowed('AUGMENT_LOCAL', url)` → `fetch(url, { method: 'POST', redirect: egressRedirectMode(), signal })` → `assertNoRedirectResponse` → zod 파싱(모르는 키 버림) · 비200·파싱 실패·시간 초과 = `null`.
- 시간: 호출 1회 `UTTERANCE_ANALYSIS_NAME_SUGGEST_TIMEOUT_MS`(기본 30,000 — ml-worker 원격 25초보다 길게) · 단계 전체 `UTTERANCE_ANALYSIS_NAME_SUGGEST_BUDGET_MS`(기본 300,000). 예산이 바닥나면 남은 묶음은 요청하지 않는다(`nameSuggestStatus = 'PARTIAL'`).
- 순서: 묶음 `ordinal` 오름차순 · **직렬 1건씩**(생성 서버 하나를 여러 요청으로 누르지 않는다) · 미분류는 요청하지 않는다.
- 결과: 성공 수 = 요청 수 → `DONE` · 일부 → `PARTIAL` · 0 → `FAILED`(+ `NAME_SUGGEST_UNAVAILABLE`(404·연결 실패)·`EGRESS_BLOCKED`·`TIMEOUT`). 어느 경우든 분석은 계속·`SUCCEEDED`(AC-DC6-2 · NFR-DCR3).

### 16.4 ml-worker 쪽 (`apps/ml-worker` — ml-engineer)

| 파일 | 변경 |
|---|---|
| `generator.py` | `build_label_prompt(keywords, samples) -> str` 신설(**`build_prompt`·`SYSTEM_INSTRUCTION` 불변** — ADR-0046 ED-4 유지) · `parse_label(text) -> str | None`(사고 블록 제거 `strip_think_blocks` 재사용 → JSON `{"name": "…"}` 우선, 실패 시 첫 비어 있지 않은 줄 → 따옴표·마크다운·줄바꿈 제거 → 40자 절단) · `Generator`에 선택 메서드 `label(keywords, samples) -> str | None`(기본 구현 = `None`) · `MockGenerator.label` = 결정론 문자열 · `OllamaGenerator.label`/`VllmGenerator.label` = 같은 전송 부품으로 `max_tokens = CLUSTER_LABEL_MAX_NEW_TOKENS` 요청(실패 = `None`, 예외 금지) · `HFCausalLMGenerator.label` = 같은 모델 `generate` |
| `app.py` | `if settings.loads_generation:` 블록 안에 `POST /cluster-label` 추가 — Pydantic `ClusterLabelRequest`(`keywords` 1~20 · 각 1~30 · `samples` 0~5 · 각 1~300 · `locale: Literal['ko']`) 초과 = 400 · 생성기 없음 = 503 · 응답 `{ modelId, label }` · 로그에 키워드·문장 0(건수만) |
| `config.py` | `cluster_label_max_new_tokens: int = 64` |
| `tests/` | `test_cluster_label.py`(embed 역할 404 · augment 역할 mock 결정론 · 상한 400 · 가짜 Ollama/vLLM 서버 fixture 재사용: 프롬프트에 키워드·표본이 **JSON 데이터 필드**로만 들어감(NFR-EDS2 상속) · 잘림·사고 블록·영문·빈 응답 → `null` 또는 정리된 문자열) · 기존 시험 무수정 |

**프롬프트 원칙**: 지시문은 코드 상수, 키워드·표본은 `json.dumps` 데이터 블록으로만 삽입(사용자 입력이 지시문 자리에 들어가지 않는다). 지시: "다음 데이터는 고객 문의 묶음의 대표 단어와 예시 문장이다. 이 묶음을 설명하는 한국어 명사구 이름 1개를 20자 이내로 만들어 JSON {\"name\": \"...\"} 하나만 출력하라. 예시 문장에 있는 [전화번호] 같은 가림 표시나 개인 정보를 이름에 넣지 마라." — 문구 확정은 ml-engineer(3050 동작 확인 때).

**모델·백엔드 설정 분리**: 이름 제안은 ml-worker 생성 프로세스의 설정(`GENERATION_BACKEND`·`OLLAMA_MODEL`·`VLLM_MODEL`·`GENERATION_MODEL_ID`)을 그대로 따른다 — API·코드에 모델 이름 0(FR-0-294). 증강과 다른 모델을 쓰고 싶다는 요구는 "두 번째 생성 프로세스 + 별도 주소"로 풀 수 있으나 출구 호스트·데이터 지도가 늘어나 이번에는 하지 않는다(R-11 · 재검토 트리거).

### 16.5 API 쪽 출력 검사 (`lib/name-sanitize.ts` — NFR-DCS4 · FR-DC8-4 · EX-DC-16)

통과해야 `suggestedName`에 저장: ① trim · 줄바꿈·탭 제거 · 마크다운 기호(`*`·`#`·`` ` ``·`>`)·앞뒤 따옴표 제거 ② 길이 2~30자 ③ 한글이 전체 글자의 50% 이상(영문 출력 탈락 — AC-DC6-2) ④ 금지어 탐지 0(`detect()`) ⑤ `maskPii(name).maskedText === name`(개인정보 모양 0) ⑥ 마스킹 표식·`*` 0 ⑦ URL·`@` 0. 하나라도 실패 = `null`(그 묶음은 키워드 이름만).

### 16.6 3050·운영 구분 (FR-DC8-6 · AC-DC6-4)

3050 + Ollama `qwen3:4b-instruct-2507-q4_K_M`에서 실제 분석 1회를 돌려 이름 제안이 끝까지 도는지만 기록한다("동작 확인 — 품질 판단 근거 아님"). 이름 품질·지연 판정은 운영 vLLM(No.17 소관 모델 채택 후).

---

## 17. 화면 정보 구조 (상세 = ui-designer)

용어: **"묶음"**(도움말 "비슷한 말끼리 모은 것입니다. 챗봇의 '토픽' 설정과는 관계없습니다") · "문장 분석"(임베딩) · "챗봇 대조" · "학습 후보" · "미분류". 기술 용어 0(DC-15). 위치: 챗봇 메뉴의 학습 영역("학습현황" 옆) **"발화 묶음 분석"** — 경로 제안 `/chatbots/:chatbotId/utterance-analyses`(+`/new`, `/:analysisId`).

### 17.1 화면 A — 분석 목록

- 머리: 제목 · 한 줄 설명("상담 녹취를 글로 옮긴 발화 파일을 올리면 비슷한 말끼리 묶고, 챗봇이 못 알아듣는 문장을 찾아 드립니다") · **"새 분석"** 버튼(`dialogue:write` · 서버 처리 중/보관 상한이면 비활성 + 이유 글자) · 보관 "20개 중 N개".
- 표(`<table>` + `<caption>`): 요청 일시 · 요청자 · 파일 이름 · 상태(글자 — 대기/처리 중(단계·%)/완료/오류(사유)/취소) · 유효 발화 수 · 묶음 수 · 학습 후보 수 · 반영 수 · 보존 만료일 · 상세 링크. 페이지.
- 빈 상태: 사용 절차 3단계 + "양식 받기". 기능 불가(문장 분석 서비스 없음) 안내.

### 17.2 화면 B — 새 분석

1. **파일**: "양식 받기(엑셀·CSV)" · 파일 입력(레이블 · `accept=".xlsx,.csv"`) · **마스킹 안내 글자**(FR-DC2-3 원문 그대로) · 올리면 자동 **검증 미리보기**(표: 전체·유효·합침·제외(사유별)·가림 적용·금지어 포함·발생 횟수 오류) — 오류는 필드 아래 글자 + `aria-describedby`.
2. **조건**(`<fieldset>`·`<legend>`): 목표 묶음 수(2~50) · 묶음 최소 발화 수(2~100) · 대표 키워드 수(1~20) · "키워드는 명사만"(확인란) · "실제 묶음 수는 데이터에 따라 목표와 다를 수 있습니다" · 챗봇 대조(확인란) → 대조 대상(라디오: "운영 중인 답변"(기본) / "편집 중인 초안" — 환경 모드일 때만 두 번째 설명 차이 표시) · 학습 후보 기준 점수(0~100 · 빈칸 = "챗봇 답변 설정 따름") · **"묶음 이름 제안 받기(AI)"**(가용일 때만 · "결과는 참고용이며 확인이 필요합니다").
3. **요청** → 성공 시 화면 C로 이동. 오류 코드별 글자(처리 중·보관 상한·발화 부족·출구 차단).

### 17.3 화면 C — 결과 상세

- **머리**: 파일 이름 · 요청자·일시 · 상태 · 보존 만료일 · 버튼(엑셀 받기 · 처리 중이면 "취소" · 종결이면 "삭제"). 확인 대화상자(삭제: 예문은 남는다).
- **처리 중**: 단계 목록(마스킹 → 문장 분석 → 묶기 → 키워드 → 챗봇 대조 → [이름 제안] → 저장)의 완료/진행/대기를 **글자로** + 진행률 막대(`role="progressbar"` + 글자 %) · 단계가 바뀔 때만 `aria-live="polite"` 알림(FR-DC6-7 · NFR-DCA3) · 2초 폴링.
- **기본 정보**(접기): 조건 · 문장 분석 모델 · 대조 대상(운영 v번호/초안)·기준 · 소요 시간 · 제외 사유 요약 · 알림(목표 축소·묶음 적음·기본 분석기) · "다른 문장 분석 모델로 만든 결과"(stale) · 대조/이름 제안 실패 글자.
- **묶음 표**: 번호 · 이름(편집 버튼 → 인라인 입력 · 저장/취소 · AI 제안이 있으면 "AI 제안 — 확인 필요: ○○ [이 이름 사용]") · 대표 키워드 · 발화 수 · 발생 합 · 학습 후보 비율(글자 %) · 반영 수 · "발화 보기"(발화 표 필터 설정). 미분류는 마지막 행.
- **발화 표**: 필터(묶음 선택 · "학습 후보만" · "반영 안 된 것만" · 검색) · 열: 선택 확인란(행마다 레이블 "○번 발화 선택") · 발화(마스킹본) · 발생 횟수 · 묶음 · 챗봇 대조(글자: "답함 — 의도 ○○" / "답하지 못함" / "2단계로 넘어감") · 점수(0~100) · 추천 의도 · 표식(글자: "학습 후보"·"금지어 포함"·"가림 표시 포함"·"반영됨(의도명)") · 페이지(50). 머리 확인란 = 이 페이지 전체 선택. 선택 수를 글자로("12개 선택됨 — 최대 50개").
- **"선택한 발화를 의도 예문으로 넣기"**(`dialogue:write` · 1~50) → **대화상자**: 대상(기존 의도 콤보박스(검색) / 새 의도 이름 입력) → [미리보기] → 들어가는 수·빠지는 수(사유별 목록)·경고·"같은 이름 의도에 넣습니다"·"이 의도를 쓰는 대화상자가 없습니다"·환경 모드 "초안에 들어갑니다" → [넣기] → 결과 글자(들어간 N · 빠진 M · 실패 K · 자동 저장 버전 안내). 금지어 포함 발화는 기본 선택 해제.
- 접근성: 모든 입력에 레이블 · 키보드만으로 필터→행 선택→대화상자→확정 · 대화상자 포커스 가둠·복귀 · 색만으로 상태 표시 금지(NFR-DCA1·2).

---

## 18. 설정 키

### 18.1 `apps/api/.env` — 전부 선택(기본값으로 기동 조건 불변)

| 키 | 기본값 | 범위 | 설명 |
|---|---|---|---|
| `UTTERANCE_ANALYSIS_ENABLED` | `true` | `envBoolean()` | `false` = 13 핸들러 `404`(메뉴 숨김) |
| `UTTERANCE_ANALYSIS_MAX_ROWS` | `5000` | 100~20000 | 파일 행 상한(머리글 제외 · 빈 행 포함). 상향은 운영 실측 후(P-8) |
| `UTTERANCE_ANALYSIS_MAX_CHARS` | `300` | 50~1000 | 발화 길이 상한(마스킹 후) |
| `UTTERANCE_ANALYSIS_RETENTION_DAYS` | `90` | 1~3650 | 새 분석의 보존 일수(생성 시 `expiresAt` 고정) |
| `UTTERANCE_ANALYSIS_MAX_STORED_PER_CHATBOT` | `20` | 1~200 | 챗봇당 보관 분석 수 — 초과 시 새 요청 409(자동 삭제 아님) |
| `UTTERANCE_ANALYSIS_EMBED_BATCH_SIZE` | `16` | 1~64 | 분석 임베딩 배치(ml-worker 배치 상한 64 이하) |
| `UTTERANCE_ANALYSIS_EMBED_PAUSE_MS` | `100` | 0~5000 | 배치 사이 최소 휴식 |
| `UTTERANCE_ANALYSIS_EMBED_YIELD_RATIO` | `1.0` | 0~10 | 배치 소요 × 비율만큼 휴식(1.0 = ml-worker 시간 최대 절반) |
| `UTTERANCE_ANALYSIS_NAME_SUGGEST_ENABLED` | `false` | `envBoolean()` | 이름 제안(LLM) 허용 — `AUGMENTATION_LOCAL_BASE_URL` 필요 |
| `UTTERANCE_ANALYSIS_NAME_SUGGEST_TIMEOUT_MS` | `30000` | 1000~120000 | `/cluster-label` 1회 시간 제한 |
| `UTTERANCE_ANALYSIS_NAME_SUGGEST_BUDGET_MS` | `300000` | 10000~1800000 | 이름 제안 단계 전체 예산 |

- 새 백그라운드 루프 0 → `jest.isolate-env.js` 변경 0. boolean은 `envBoolean()`(CLAUDE.md).
- 알고리즘 상수(시드·`nInit`·`maxIter`·조각 크기)는 설정이 아니라 **코드 상수 1곳 + `algorithmVersion`** — 결과를 바꾸는 값이므로 결과 행에 버전으로 남아야 한다(증강 임계값이 `modelId` 종속 코드 상수인 것과 같은 판단).

### 18.2 `apps/ml-worker/.env` — 선택 1개

| 키 | 기본값 | 설명 |
|---|---|---|
| `CLUSTER_LABEL_MAX_NEW_TOKENS` | `64` | `/cluster-label` 최대 생성 토큰(이름 1개 JSON) |

---

## 19. 성능 예산 · 대화 경로 격리

### 19.1 예산 (NFR-DCP1 — **5,000건 10분은 운영 장비 목표일 뿐이다**)

| 단계 | 목표(운영) | 추정 근거(측정 아님) | 측정 |
|---|---|---|---|
| 요청 처리(파싱·마스킹 5,000행) | ≤ 3초 | 스트리밍 파서 · 정규식 5종 | 미측정 |
| 문장 분석(임베딩) | ≤ 6분 | 기존 보고서의 KURE-v1 CPU 5,000건 재색인 **추정** 183~192초(`apps/ml-worker/eval/report/model-comparison.md` 26행 — 다른 조건·다른 배치) × 양보 비율 1.0(최대 2배) | 미측정 |
| 묶기 | ≤ 60초 | §5.5 | 미측정 |
| 키워드 | ≤ 30초 | garu 5,000문장 | 미측정 |
| 챗봇 대조 | ≤ 60초 | `resolveTurn` 5,000회 + 의미 입력 조립(색인 벡터 수 × 1,024 × 5,000) | 미측정 |
| 이름 제안(선택) | ≤ 예산 5분 | 묶음 ≤ 50 × 1회 | 운영 vLLM에서만 판정 |
| 저장 | ≤ 5초 | `createMany` 500행 × 10 | 미측정 |
| **합계(이름 제안 제외)** | **≤ 10분(목표)** | — | **운영 장비 실측 후 확정** · 3050·개발 PC는 "동작 확인" |

- 합계가 목표를 넘으면 먼저 `EMBED_YIELD_RATIO`를 낮추지 **않는다**(대화 보호가 우선) — 운영 장비에서 GPU 임베딩(`EMBEDDING_DEVICE=cuda`) 또는 전용 프로세스(R-8)로 푼다.
- 처리 시간은 분석 행의 `startedAt`·`finishedAt`으로 매 실행 남는다(문장 0) — 운영 실측 수집에 쓴다.

### 19.2 대화 경로 영향 격리 (NFR-DCP2)

| 경로 | 격리 장치 | 검증 |
|---|---|---|
| 코드 | 대화 파이프라인·엔진·위젯·어댑터가 이 모듈을 import하지 않는다 · 이 모듈은 `QueryEmbeddingService`(질의 LRU 캐시)를 주입하지 않는다 — 5,000문장이 운영 캐시를 밀어내지 않는다(ADR-0030 §2) | UA-1·UA-2 · DC-1 |
| API 이벤트 루프 | 묶기 256점 · 키워드 200문장 · 대조 50문장마다 `setImmediate` 양보 → 한 번에 막는 시간 목표 ≤ 50ms | 단위 시험(조각 수 단언) · 부하 게이트 |
| ml-worker(대화 임베딩과 공유) | 동시 분석 서버 1건 · 배치 16 · 적응형 양보(최대 절반) · 분석 요청은 대화 요청과 같은 스레드 풀에서 번갈아 처리 | **AC-DC7-4 수동 게이트**(운영 장비 · 분석 중 대화 임베딩 P95 ≤ 300ms · 회로차단 개방 0) |
| ⚠ 회로차단 | 대화 임베딩이 300ms를 넘으면 5회 연속 실패로 회로가 열려 **의미 매칭이 쿨다운 동안 꺼진다**(`EMBEDDING_CIRCUIT_FAILURE_THRESHOLD`) — 이 기능이 줄 수 있는 가장 큰 대화 피해 | 부하 게이트에서 회로 개방 여부를 함께 기록 · 개방이 관측되면 비율 상향 → 전용 프로세스(§26) |
| DB(SQLite 단일 작성자) | 결과 커밋 1회(수천 행) 동안 대화 로그 적재(`record()` — fire-and-forget)가 잠깐 기다릴 수 있다(응답 지연 아님) | 부하 게이트에서 커밋 시간 기록(K-6) |
| 메모리 | 벡터 ≈ 20MB + 문장 5,000 — 작업 종료와 함께 GC | — |
| 기존 작업 | 재색인·TC 실행·증강·분류기 학습과 동시 가능(각자 상한) — 분석은 서버 1건 | — |

---

## 20. 시험 전략

### 20.1 원칙

- **GPU·Python·Ollama·vLLM 없이 API·웹 전 시험 통과**(FR-0-296). API 시험의 임베딩은 두 종류만: ① `MockEmbeddingProvider`(해시 — 재현성·흐름) ② **`FixtureEmbeddingProvider`**(시험 전용 — 고정 데이터셋의 문장 → **설계된 벡터**: 의도 3~4개를 서로 직교하는 축 주변에 작은 잡음으로 배치해 "같은 의도 = 같은 묶음"이 알고리즘적으로 성립하는지 단언). `EmbeddingProviderFactory`를 시험 모듈에서 덮어쓴다(검증 모듈 시험 선례).
- 이름 제안은 `MockClusterNameSuggester` 또는 **루프백 임시 포트의 가짜 ml-worker HTTP 서버**(오류·시간 초과·잘림·영문 시나리오 — No.37 fixture 방식).
- 통합 DB는 `prisma migrate deploy`. 선택 기능(이름 제안)을 켠 스펙은 환경변수 설정 뒤 `await import('../app.module')`(CLAUDE.md). 파기 잡은 `tick()` 직접 호출(`DATA_RETENTION_WINDOW`를 전일로 둔 동적 import 스펙).
- 실제 모델·장비 시험은 CI 밖(수동 게이트 — 보고서 필수 항목 검사만 자동화).

### 20.2 층별

| 층 | 대상 |
|---|---|
| 순수 함수(jest) | `prepare-utterances`(순서 1~9 · 병합 키 = 마스킹본 · 브랜드) · `file-sniff`(ZIP 서명·가짜 xlsx·NUL·인코딩) · `spherical-kmeans`(결정론 2회 동일 · 동기/비동기 동일 · 설계 벡터 분할 · 빈 묶음 · 전부 같은 벡터 · 동점 규칙 · 취소 · 조각 수) · `cluster-postprocess`(실제 k · 미분류 · 번호 · 대표 · `seq`) · `keyword-tokens`(명사만 · 조사·불용어·한 글자 · **마스킹 결합 시험**) · `cluster-keywords`(점수·동점·최소 tf) · `learning-candidate` · `apply-plan`(7사유 · 경고) · `name-sanitize`(7검사) · `analysis-progress` |
| 서비스·통합(jest + SQLite) | 요청 → 작업 → 결과 전 과정 · 사전 검사 순서 · 동시 요청 2건(유일 제약 → 409) · 취소(처리 중·커밋 후) · 재시작 정리 · 대조(라이브·운영 버전·초안 · API 노드 · RAG 표시) · 반영(계획·스냅샷·`applyLearning` 1회·부분 성공·동시 반영) · 다운로드(EXPORT 1건 · 시트 2 · 마스킹본) · 삭제 · 파기 `tick()` · 영구삭제 · 권한·교차 404·보관 409 · 거버넌스 출구 차단 · 데이터 지도 키 생략/존재 |
| 정적 봉인 | `utterance-analysis-sealing.spec.ts` UA-1~UA-11(§20.4) |
| 웹(vitest) | 화면 3개: 레이블·키보드 선택·글자 표식·진행 단계 글자·대화상자 포커스 · **"토픽"·기술 용어 0**(DC-15) · capability 404 → 메뉴 숨김 |
| ml-worker(pytest) | §16.4 · 기존 시험 무수정 |
| 수동 게이트 | AC-DC3-4(품질) · AC-DC6-4(3050 이름 제안) · AC-DC7-4(부하) · NFR-DCP1(시간) |

### 20.3 시험 데이터 (FR-0-296 — 실제 고객 데이터 0)

- `test/fixtures/utterance-analysis/`: ① `small-4intents.json`(의도 4 × 8문장 + 설계 벡터) ② `tc21-1000.csv`(TC-21 — 합성 템플릿 10종 × 100 변형 · 빈 행 3 · 중복 5쌍 · 301자 2) ③ `pii-mix.xlsx`(가짜 전화 `010-0000-00xx`·주민 형식 `000101-3xxxxxx`·카드·계좌·이메일·전역 금지어 조합) ④ `fake-xlsx.xlsx`(확장자만 — AC-DC2-4) ⑤ `5001rows.csv`(AC-DC2-2).
- 가짜 개인정보는 **형식만 맞춘 무효 값**(실존 번호 회피 — 체크섬 무효).

### 20.4 봉인 정적 검사 `lib/utterance-analysis-sealing.spec.ts` (기존 봉인 스펙과 같은 형식)

| # | 단언 |
|---|---|
| UA-1 | `conversation/**`·`packages/dialogue-engine/**`·`apps/widget/**`에 `utterance-analysis` import·`UtteranceAnalysis` 심볼 0 |
| UA-2 | 모듈 안 금지 심볼 0(DC-2) |
| UA-3 | 모듈 imports 금지 목록 0 + 금지 목록 이름이 실제 선언된 모듈인지 먼저 단언(DC-3) |
| UA-4 | `IntentsService`·`.applyLearningExample(`·`.applyLearning(` = `apply/utterance-apply.service.ts`만 · `.applyLearning(` 호출문 2개 이하(미리보기에는 0) · `.invalidate(` 0 |
| UA-5 | 3테이블 쓰기 호출 파일 집합(DC-5) |
| UA-6 | 금지 테이블 쓰기 0(DC-6) |
| UA-7 | `MaskedUtteranceText` 브랜드 생성(`as MaskedUtteranceText`) = `lib/prepare-utterances.ts`에만 |
| UA-8 | `writeFile`·`createWriteStream`·`appendFile` 0(DC-8) |
| UA-9 | `Logger` 호출 인자에 금지 식별자 0 · `AUDIT_FIELDS.UtteranceAnalysis`에 텍스트 필드명 0(DC-9) |
| UA-10 | `setInterval(`·`cron`·`PollingLoop`·`Math.random(` 0(DC-12 · 결정론) |
| UA-11 | 엔진 패키지 심볼 0(DC-13) |

### 20.5 ★ 품질 측정 도구 (FR-DC3-7 · P-5 · AC-DC3-4 — ml-engineer)

1. **위치**: `apps/api/src/utterance-analysis/eval/measure-clustering-quality.ts`(ts-node · 분류기 측정 스크립트 선례). **제품 함수 그대로** 호출(`sphericalKMeansSync`·`cluster-postprocess`·`cluster-keywords`) — 측정한 것 = 배포되는 것. 임베딩은 `HttpEmbeddingProvider.connect(EMBEDDING_BASE_URL)`(등록된 출구 파일의 클래스 — 스크립트가 `fetch`를 직접 쓰지 않으므로 G-1 제외 목록 변경 0).
2. **입력(정답표)**: `{ intents: Record<의도, 예문[]> }` — ① 기존 `classifier/eval/dataset-*.json` ② **새 합성 데이터셋 `dataset-clustering-ko.json`**(의도 ≥ 20 × 예문 ≥ 10 — 어휘가 겹치는 혼동 의도 포함 · 실제 고객 문장 0) ③ (선택) 개발 DB 챗봇의 의도 예문(`--from-db <chatbotId>` — Prisma 읽기 · 결과 보고서에 문장 0).
3. **옵션**: `--k`(기본 = 의도 수 · 추가로 10) · `--min`(5) · `--nouns` · `--mask-inject 0.2`(20% 문장에 가짜 개인정보를 넣고 마스킹한 뒤 측정 → 마스킹 표식 영향 — FR-DC2-4) · `--repeat 2`(결정론 확인) · `--dump <dir>`(벡터 `float32` 바이너리 + 라벨 — 파이썬 기준선용).
4. **지표**: 순도(purity) · 역순도(inverse purity) · 조정 랜드 지수(ARI) · 정규화 상호정보(NMI) · 쌍 단위 정밀도/재현율 · 미분류 비율 · 반복 일치 여부 · 소요 시간("동작 확인"만).
5. **보고서**: `apps/api/src/utterance-analysis/eval/report/clustering-quality_<modelId 안전 문자>_<YYYY-MM-DD>.md` — 머리에 장비(CPU·RAM·GPU)·OS·일자·명령·`modelId`·`algorithmVersion`·데이터셋(의도 수·문장 수)·조건, 본문에 지표 표·마스킹 주입 전후 비교·결론. ml-worker 보고서(`apps/ml-worker/eval/report/*.md`)의 머리 형식을 따른다.
6. **합격 기준(P-5 (a))**: **잠정** — `k = 의도 수`에서 순도 ≥ 0.80 · ARI ≥ 0.50 · 반복 결과 완전 일치. ml-engineer가 첫 보고서와 함께 수치를 **제안**하고 PM이 확정한다(요구사항 P-5 "첫 측정 후 제안"). 확정 전까지 AC-DC3-4는 "측정 기록 존재 + 결정론 일치"만 게이트.
7. **(선택) 파이썬 기준선** `apps/ml-worker/eval/clustering_baseline.py`: `--dump` 산출물로 `sklearn.cluster.KMeans`(구면 근사 — 정규화 입력)·`HDBSCAN`(원공간 · PCA 50차원) 지표를 같은 형식으로 보고 — **제품 경로 아님 · 게이트 아님**. `pyproject.toml`에 선택 묶음 `eval = ["scikit-learn>=1.3,<2"]`(§5.1).

### 20.6 FR-0-297 닫힌 목록 — 의도된 기존 시험 기대값 변경 (**4건**)

| # | 파일 · 단언 | 변경 |
|---|---|---|
| 1 | `apps/api/src/augmentation/lib/asset-write-sealing.spec.ts` S-2 | `applyLearningExample(` 호출 파일 3 → **4** · allowlist에 `utterance-analysis/apply/utterance-apply.service.ts` |
| 2 | `apps/api/src/governance/lib/governance-sealing.spec.ts` G-15 첫 시험 | `recordExport(` 호출 파일 집합에 `apps/api/src/utterance-analysis/export/utterance-analysis-export.service.ts` 추가(3 → 4) |
| 3 | 같은 파일 G-15 셋째 시험 | `VIEW_AUDIT_TARGETS` 선언 수·`@AuditView(` 부착 수 11 → **12** |
| 4 | `apps/api/src/chatbots/chatbots.service.spec.ts` permanentDelete | tx 목에 `analyzedUtterance`·`utteranceCluster`·`utteranceAnalysis` `deleteMany` 추가 · 기대 호출 3건 추가 · 제목 27 → **30**테이블 |

**변경하지 않는 것(확인)**: `validation-sealing` 7)(`@Public()` 9) · `rich-message-sealing`/`proactive-sealing`의 `EgressExitId` 7 · G-1/G-2(레지스트리 동적) · `learning-apply-invalidate-callsite.spec.ts`(learning 모듈 안 호출 수 불변) · 데이터 거버넌스 쿼리 수 시험(공개 대화 경로 불변) · 파기 잡 통합 시험(분석 0건이면 `affectedByKind` 키 없음). **구현 중 이 밖의 기존 시험 수정이 필요해지면 architect가 이 목록을 먼저 갱신한다.**

### 20.7 AC ↔ 시험 매핑

| AC | 시험 | 종류 |
|---|---|---|
| AC-DC1-1 | api jest · web vitest · ml-worker pytest 전체 — §20.6 목록 외 무수정 | 자동 |
| AC-DC1-2 | UA-1 · DC-1 diff · `@Public()` 9 단언(기존) | 자동·리뷰 |
| AC-DC1-3 | `EgressExitId` 7(기존 단언) · `Permission` 18 단언(신규 1줄 — shared-types 단위 시험) | 자동 |
| AC-DC1-4 | 통합: 분석 1건 완료 전후 `ConversationLog`·`UnansweredQuestion`·`MessageFeedback`·`Topic`·`EmbeddingVector`·`EmbeddingTextVector`·`TrainingJob` 행 수·`/stats/summary` 응답 동일 + UA-6 | 자동 |
| AC-DC2-1 | 통합: 미리보기(빈 3·중복 5쌍·301자 2·유효 100) 건수 정확 + 전 테이블 행 수 불변 | 자동 |
| AC-DC2-2 | 통합: 5,001행 → 400 `IMPORT_TOO_LARGE` · 5MB 초과 → 400 · 분석 행 0 | 자동 |
| AC-DC2-3 | 통합: `pii-mix.xlsx` 분석 완료 후 3테이블 전 컬럼·감사 `after`·`summary`·캡처한 `Logger` 출력·엑셀 버퍼에서 원문 전화·주민·카드·금지어 문자열 0건 | 자동 |
| AC-DC2-4 | 통합: 확장자만 xlsx → 400 `IMPORT_FILE_INVALID` | 자동 |
| AC-DC3-1 | 통합: `MockEmbeddingProvider` · 같은 파일·조건 2회 → 발화별 묶음 `ordinal`·키워드 동일 + 행 순서를 섞은 파일도 동일 | 자동 |
| AC-DC3-2 | 단위(postprocess) + 통합(Fixture): 최소 5 미만 묶음 발화 = 미분류 · 번호 내림차순 · 미분류 마지막 | 자동 |
| AC-DC3-3 | 단위(keyword-tokens·cluster-keywords): 명사만 · 불용어·조사·마스킹 표식 0 | 자동 |
| AC-DC3-4 | §20.5 보고서(개발 PC · KURE-v1) — 필수 항목 존재 검사만 자동 | **수동 게이트** |
| AC-DC3-5 | 통합: `tc21-1000.csv` → 묶음 N ≥ 2 · 각 묶음 키워드 ≥ 1 | 자동 |
| AC-DC4-1 | 통합: 시드 챗봇(의도 예문 포함) · 예문과 같은 발화 → 답함(의도명) · 무관 발화 → 답하지 못함·학습 후보 | 자동 |
| AC-DC4-2 | 통합: 대조 전후 로그·세션·통계 불변 · `RagHttpClient`·레거시·웹훅 스파이 0회 + UA-2/UA-3 | 자동 |
| AC-DC4-3 | 통합: 환경 모드(초안 ≠ 운영) → 운영 버전 번들 결과 · `probeVersionNo` 기록 | 자동 |
| AC-DC4-4 | 통합: 대조 끔 → 후보 0·대조 필드 null·`probeStatus=OFF` | 자동 |
| AC-DC5-1 | 통합: 10개(중복 1·201자 1·금지어 1) → 미리보기 7/3 · 확정 후 예문 +7 · `applyLearning` 스파이 1회 | 자동 |
| AC-DC5-2 | 통합: 완료·조회·다운로드만 → 자산 6종 행·`updatedAt` 불변 | 자동 |
| AC-DC5-3 | UA-4 · S-2(4파일) | 자동 |
| AC-DC5-4 | 통합: 반영된 발화 재반영 → `ALREADY_APPLIED` · 행에 반영 표시 | 자동 |
| AC-DC5-5 | 통합: 환경 모드 → 초안 예문만 증가 · 운영 버전 번들 불변 · `draftOnly=true` | 자동 |
| AC-DC5-6 | 통합: VIEWER → 요청·반영·삭제·취소·이름 수정 403 · 조회·다운로드 200 | 자동 |
| AC-DC6-1 | 통합: 설정 꺼짐 → capability false · `nameSuggest:true` 요청 400 · 가짜 서버 호출 0 | 자동 |
| AC-DC6-2 | 통합(가짜 ml-worker): 오류/시간 초과/잘림/영문 → 분석 SUCCEEDED · 해당 묶음 `suggestedName=null` | 자동 |
| AC-DC6-3 | 통합(가짜 ml-worker 기록): 묶음당 키워드 + 표본 ≤5 · 미분류 요청 0 · 원문 0 | 자동 |
| AC-DC6-4 | 3050 + Ollama 실제 분석 1회 기록 | **수동 게이트** |
| AC-DC7-1 | 통합: `expiresAt` 과거 분석 + `tick()` → 3테이블 행 삭제 · 반영 예문 유지 · 요약 감사 `affectedByKind.UTTERANCE_ANALYSIS` | 자동 |
| AC-DC7-2 | 통합(거버넌스 모드 동적 import · 허용 목록에 임베딩 호스트 없음) → 409 `EGRESS_HOST_NOT_ALLOWED` | 자동 |
| AC-DC7-3 | 단위(permanentDelete 목 — 닫힌 목록 4) + 통합(분석 있는 보관 챗봇 영구삭제 → 0행) | 자동 |
| AC-DC7-4 | 부하: 5,000행 분석 중 대화 턴 반복 → 임베딩 P95·회로 개방·커밋 시간 | **수동 게이트**(운영 장비 · 개발 장비 = 동작 확인) |
| AC-DC7-5 | 통합: RUNNING 행 만든 뒤 `onModuleInit()` → FAILED(`SERVER_RESTART`)·잠금 해제 | 자동 |

EX 매핑(요약): EX-DC-1 임베딩 불가 → 작업 FAILED(가짜 공급원 예외) · 2 → 400 TOO_FEW · 3·4 → 알림 코드 · 6 → `NO_CONTENT` · 7 → 표시·반영 제외 · 8 → 시작 시 고정(작업 중 편집 후 결과 동일) · 9 → 409 ARCHIVED · 10 → 404 · 11 → `DUPLICATE_IN_OTHER_INTENT` · 12 → `staleModel` · 13 → 409 BUSY · 15 → AC-DC7-5 · 16 → `name-sanitize` · 17 → ml-worker 기동 실패는 No.37 시험 · 18 → 409 STORE_FULL · 19 → 400 머리글 · 20 → `invalidCountRows`.

---

## 21. 구현 체크리스트 · 역할 분담

> 순서: shared-types → 마이그레이션 → 순수 lib(ml-engineer·backend 병행) → 서비스·러너 → 반영·내보내기 → 거버넌스 편입 → 시험 → 웹 → ml-worker 이름 제안(선택 기능 — 병행 가능). 이 설계 밖 파일을 고쳐야 하면 **멈추고 architect에 되묻는다**.

### 21.1 `ml-engineer`

1. [x] `lib/spherical-kmeans.ts`(비동기·동기 판 · 상수 `CLUSTERING_ALGORITHM` · 결정론 규약 §5.3) + 단위 시험(설계 벡터 · 결정론 · 빈 묶음 · 동점 · 조각)
2. [x] `lib/cluster-postprocess.ts`(§5.4) + 단위 시험
3. [x] `lib/keyword-tokens.ts`·`lib/cluster-keywords.ts`·`lib/mask-tokens.ts`(§6 — 품사 집합은 garu 실제 태그로 확인해 §27에 기록) + 마스킹 결합 시험
4. [x] `eval/measure-clustering-quality.ts` + `eval/dataset-clustering-ko.json`(합성) → **첫 보고서**(개발 PC · KURE-v1) + 합격 수치 제안(§20.5 ⑥)
5. [x] (선택) `apps/ml-worker/eval/clustering_baseline.py` + `pyproject.toml` 선택 묶음 `eval`
6. [x] ml-worker `/cluster-label`(§16.4) + pytest · 기존 시험 무수정
7. [ ] 3050 + Ollama 이름 제안 동작 확인 기록(AC-DC6-4) · 3050 전 과정 5,000행 소요 시간 "동작 확인" 기록(개발 PC · FR-0-293)

### 21.2 `backend-implementer`

1. [x] shared-types: `utterance-analysis.ts` · `ApiErrorCode` +3 · `AuditTargetType` +1·라벨 · `ChatbotVersionTrigger` +1·라벨·`AUTO` 그룹 · `GovernanceMapResponseSchema` 선택 키 · index export → `pnpm --filter @chat-bot/shared-types build`
2. [x] Prisma 3모델 + `Chatbot` 역참조 → 마이그레이션 생성 → **`DROP INDEX` 줄 제거 확인** → 부분 인덱스 4개 확인(§10.2)
3. [x] `learning/morph/morph-analyzer.module.ts` 신설 · `learning.module.ts` import 전환(동작 불변)
4. [x] `lib/prepare-utterances.ts`(브랜드) · `lib/file-sniff.ts` · `upload/utterance-upload.parser.ts`
5. [x] `core/utterance-analysis.store.ts`(★) · `run/*`(러너·싱크·취소·임베딩 공급원·대조) · `lib/learning-candidate.ts` · `lib/analysis-progress.ts`
6. [x] `utterance-analysis.service.ts`(사전 검사 순서 §7.4 · 고아 정리) · 컨트롤러 13(선언 순서 ⚠) · 매퍼 · 모듈(providers에 `LearningApplyService` 직접 — DC-3)
7. [x] `apply/utterance-apply.service.ts`(★ §15) · `lib/apply-plan.ts` · `LearningApplyReason` +1 · 자동 캡처 트리거 +1
8. [x] `export/utterance-analysis-export.service.ts`(기존 xlsx 작성기 · 수식 방어 · 파일 이름 `utterance-analysis-<YYYYMMDD>-<id8>.xlsx` — 업로드 파일 이름 미사용) · `recordExport`
9. [x] 이름 제안: 포트·팩토리·mock·★출구 파일 · `egress-registry.ts` `AUGMENT_LOCAL.files` +1 · `lib/name-sanitize.ts`
10. [x] 거버넌스: 파기 잡 단계 · writer 메서드 · 지도 선택 키 · 기동 검사 1조건 · `AUDIT_FIELDS` · `VIEW_AUDIT_TARGETS` +1
11. [x] `chatbots.service.ts` 동반 삭제 +3 · `env.validation.ts` 11키 · `app.module.ts`
12. [x] 시험: §20 전부(봉인 UA · 통합 · 닫힌 목록 4건 수정)

> 완료 표시(2026-09-30): 21.1 ①~⑥ · 21.2 ①~⑫ 구현·자동 시험 완료. 21.1 ⑦(3050 + Ollama 동작 확인 · 5,000행 소요 시간)은 수동 게이트라 미완이다(§27).

### 21.3 `ui-designer` → `frontend-implementer`

화면 3개 상세 명세(`docs/03-design/deep-clustering-ui-spec.md`) · 데이터 지도 절 1개 · 메시지 상수(트리거 라벨 "발화 묶음 반영 직전(자동)" · 감사 대상 라벨 "발화 묶음 분석") · vitest(DC-15 포함).

### 21.4 `test-automation`

AC-DC1~DC7 자동화분 · 수동 게이트 3건의 보고서 필수 항목 검사 · `docs/04-test/시험항목.md` TC-21 갱신(패치 J-1 적용 뒤 세부 항목 추가) · `시험데이터.md` 갱신.

---

## 22. 알려진 제한 (K)

| # | 제한 | 이유 · 후속 |
|---|---|---|
| K-1 | 정규식 PII 마스킹은 **사람 이름·주소를 놓친다** | ADR-0013 한계 그대로 · 화면 안내(FR-DC2-3) · 보존 기한 · secure_delete · 이름 탐지(NER)는 범위 밖 |
| K-2 | 파일 이름의 사람 이름도 가려지지 않는다 | 저장은 절단·정규식 마스킹본 · 다운로드 파일 이름에는 쓰지 않는다 |
| K-3 | k-평균은 외톨이를 어딘가에 배정한다 — 원본 "토픽 −1"보다 미분류가 적게 나올 수 있다 | 미분류 = 작은 묶음. 유사도 하한으로 외톨이를 빼는 규칙은 품질 측정 뒤 재검토(§26) |
| K-4 | 보존 일수는 환경변수라 콘솔 보존 정책 화면에서 바꿀 수 없다 | C-9 · 재검토 트리거 |
| K-5 | 파기 잡이 창 안에서 하루 1회 조회 1건을 더 한다(분석 0건 설치 포함) | 결과·감사는 바이트 동일 |
| K-6 | 결과 커밋(수천 행) 동안 SQLite 작성자 잠금 — 대화 로그 적재가 잠깐 대기 | fire-and-forget이라 응답 지연 아님 · 부하 게이트에서 측정 |
| K-7 | 분석 전용 ml-worker 프로세스를 이번에 지원하지 않는다 | 교체 지점 1곳(`analysis-embedding.source.ts`) · 부하 게이트 결과로 판단 |
| K-8 | 처리 시간·대량 한계는 미측정 | FR-0-293 · 운영 실측 |
| K-9 | 휴리스틱 형태소 분석기로 떨어지면 명사 판정이 부정확 | `analyzerId` 기록 + 화면 알림 |
| K-10 | 여러 챗봇·그룹을 합친 분석 없음 | 범위 밖(요구사항 §9) |
| K-11 | 재시작 시 고아 정리는 단일 인스턴스 전제 | ADR-0027 갱신(임대) 트리거와 함께 |
| K-12 | 처리 중 챗봇 영구삭제 시 작업은 FK 오류로 실패한다 | 결과 행 0 · 무해 |
| K-13 | "토픽 −1 = 미분류"는 원본 화면 판독(P-12 확인 전) | 뜻이 다르면 표시 문구만 수정 |
| K-14 | 이름 제안 품질·지연은 운영 모델 채택(No.17) 전까지 판정 불가 | 기본 꺼짐 |

---

## 23. 요구사항 대비 해석 · 조정 (R)

| # | 요구사항 | 이 설계 | 이유 |
|---|---|---|---|
| **R-1** | §5.2 `TrainingJob.kind` 1개 추가 예상 | **추가하지 않는다** — `UtteranceAnalysis`가 상태 소유(싱크 3번째 구현) | ADR-0027 갱신① "Training이 아닌 작업은 넣지 않는다" · 결과와 상태를 한 행에 두어야 "성공 = 결과 있음"이 한 트랜잭션이 된다 |
| **R-2** | PM "No.19 대량 대조 실행기 재사용" | **실행기 클래스가 아니라 규약·부품 재사용**(`resolveTurn`·`assembleSemanticInput`·`judgeBand`·`VersionBundleService`·벡터 캐시 · 기록 0 · 전역 캐시 0) | C-5 — 클래스 재사용은 검증 모듈 수정(회귀 표면)을 요구한다 |
| **R-3** | FR-DC9-1 보존 종류 1개 추가 여부 | **추가하지 않는다** — 기능 설정 일수 + `expiresAt` 고정 + 기존 파기 잡 단계 | C-9 · §14.1 |
| **R-4** | FR-DC2-2 금지어 포함 발화 "반영 시 기본 선택 해제" | 화면은 기본 해제 + **서버는 항상 제외** | 마스킹 문자(`***`)가 예문 자산에 들어가는 것을 구조로 막는다 |
| **R-5** | EX-DC-11 "다른 의도에 이미 있음 = 제외(기존 규칙)" | 기존 의도 서비스는 **경고**이지만 이 경로는 **제외** | C-6 — "기존 규칙"의 사실 정정 · 대량 외부 문장이 의도 경계를 흐리지 않게 |
| R-6 | EX-DC-5 언어 판별 표시 | 하지 않음(품질 미보증 안내만) | 판별기 의존성 · 가치 대비 비용 |
| R-7 | EX-DC-20 발생 횟수 이상값 처리 | 1로 두고 경고 집계(제외 안 함) | 발화 자체는 유효 |
| **R-8** | NFR-DCP2 "분석 전용 ml-worker 프로세스 분리 가능 구조" | **교체 지점 1곳만** 두고 이번엔 미구현 · 대신 적응형 양보·배치 16·서버 1건 | 별도 주소는 출구 호스트·거버넌스 기동 검사·데이터 지도를 늘린다 · 필요성은 부하 게이트가 판단 |
| R-9 | FR-DC7-2 새 의도의 토픽 선택 | **공통으로 생성**(선택 없음) | 토픽 쓰기 유일 파일(`topic-assignment.service.ts`) 봉인 · 기존 의도 화면에서 지정 |
| **R-10** | (요구사항 언급 없음) LLM 소비자 2곳 → `packages/llm-provider` 승격 트리거 | **발동 판정 · 미승격** + 트리거 정밀화 | §16.2 |
| R-11 | FR-DC8-2 "모델 ID·백엔드는 설정" | ml-worker 생성 프로세스 설정을 그대로 따름(별도 모델용 주소는 미지원) | §16.4 |
| R-12 | FR-DC1-5 미리보기 저장 방식 | 저장 0 · 요청 때 파일 재전송 | 원본을 서버에 남기지 않는다(스테이징 0) |
| R-13 | FR-DC1-3 "유효 발화 5,000행" | **파일 행 5,000(빈 행 포함)** 상한 | 기존 리더의 행 상한 방어를 그대로 쓴다 · 유효 ≤ 파일 행 |
| R-14 | (요구사항 언급 없음) 발화 목록 열람 감사 | 거버넌스 모드 `VIEW` 대상 +1 | 마스킹 대화 문장 열람(대화 보기·미응답 상세)과 같은 등급 |
| R-15 | (요구사항 언급 없음) 요청 감사 | `CREATE` 감사 | 외부 개인정보성 데이터 반입 기록 |
| R-16 | FR-DC6-1 파일 이름 "마스킹 불필요" | 정규식 마스킹 + 절단 후 저장 | 파일 이름에 전화번호가 들어가는 관행 |
| R-17 | FR-DC5-5 추천 의도(자카드/분류기) | 의미 순위 상위 의도(비용 0) · 의미 없으면 자카드 · 분류기 미사용 | §9.4 |
| R-18 | NFR-DCR4 반영 원자성 | 건별 부분 성공 + 명시 + 자동 스냅샷 | 증강 승인 선례 · §15.3 |
| R-19 | FR-DC4-1 키워드 방식 | c-TF-IDF(고유 발화 기준 · 발생 횟수 미반영) | 반복 문장 1개의 독점 방지 |
| R-20 | FR-DC5-3 운영 번들 읽기 실패 | 대조만 실패 · 분석 성공 | 대조는 부가 정보 |
| R-21 | FR-DC5-1 API 노드 매칭 | 외부 호출·목 없이 "답함" | FR-DC5-6(외부 호출 0) |
| R-22 | FR-DC6-1 분석 목록 위치 | 챗봇 스코프 | 권한 모델 · 교차 404 규약 |

---

## 24. 새로 발견한 기존 결함 (D — 이 그룹 원인 아님 · 인계)

| # | 결함 | 영향 | 권고 |
|---|---|---|---|
| **D-1** | ml-worker 개발 venv가 `pyproject.toml` 범위를 벗어나 있다 — `sentence-transformers` 6.1.0(`<4.0`) · `numpy` 2.2.6(`<2.0`) · `pytest` 9.1.1(`<9.0`) · `transformers` 5.17.0 · 설치된 `ml_worker` 메타데이터가 옛 선언(httpx dev 추가) · `scikit-learn`은 선언 없이 간접 설치 | 새로 설치하면 다른 판이 깔린다 → 개발 PC 시험·측정 결과(임베딩 지연·재현성)가 운영 설치를 대표하지 않을 수 있다. 폐쇄망 반입 목록도 어느 쪽 기준인지 불명 | `bug-triage` → ml-engineer: 실제로 쓰는 판을 확인해 `pyproject.toml` 범위를 고치거나 venv를 다시 만들고, 잠금 파일(버전 고정 목록)을 남긴다 |
| D-2 | 개발명세서 §1 설계 원칙이 "군집분석"을 ml-worker 분리 예시에 적었다 | 이 설계와 문장 충돌 | 패치 A-1로 정정 |
| D-3 | 개발명세서 §3.1 "파생 데이터의 동반 삭제"가 No.43 시점 **24테이블**에서 멈췄다 — No.35가 3테이블(24 → 27)을 더했으나 반영되지 않았다(시험 `chatbots.service.spec.ts`는 27) | 문서·코드 불일치 | 패치 A-9에서 27 → 30으로 함께 정정 |
| D-4 | `governance-sealing.spec.ts` 설명 문자열이 옛 수치다 — G-1 제목 "6파일"(실제 레지스트리는 더 많음) · G-15 describe 제목 "8개"(단언은 11) | 기능 영향 없음(단언은 동적·최신) | 닫힌 목록 2·3을 고칠 때 제목도 함께 현행화(권고 — 기대값 변경 아님) |

---

## 25. 상위 문서 반영 (`docs/02-spec/deep-clustering-patches.md` — ⏳ 미적용)

architect 세션에는 부분 수정 도구가 없고 대상 파일이 CRLF라, 선행 그룹과 같이 **찾기/바꾸기 패치 37건**으로 남긴다(앵커는 작성 시점 문자열 검색으로 1회 매칭 확인). 대상: 개발명세서(§1·§2·§2.2·§3·§3.1·§4·§5.1·§6·§7 — 19건) · 기능요구사항(21·22·47·58행·§5 — 5건) · ADR-0024·0027·0026·0046(각 2건) · `자동배포.md`(§5.9 신설) · `data-governance-설계.md` §8.1 · (test-automation 소관·선택) `시험항목.md` TC-21·`시험데이터.md` · (선택) 요구사항 PM 확정 기록. **`CLAUDE.md`는 대상이 아니다.**

---

## 26. 재검토 트리거

- **품질 측정에서 밀도 기반(HDBSCAN+차원 축소)이 k-평균보다 뚜렷이 우수**(예: 같은 데이터 ARI +0.1 이상) → ml-worker 두 번째 군집 구현(교체 지점 `spherical-kmeans.ts`의 포트화) + 의존성 선언 · ADR-0047 §2 대체.
- **외톨이가 큰 묶음을 오염시킨다는 보고** → 유사도 하한 미분류 규칙(`algorithmVersion` 증가).
- **부하 게이트에서 대화 임베딩 P95 초과 또는 회로 개방** → 양보 비율 상향 → 분석 전용 임베딩 프로세스(R-8 · 출구·거버넌스·지도 함께 설계).
- **운영 실측에서 5,000건 10분 초과** → GPU 임베딩 구성 · 상한 조정.
- **1회 5,000행 초과 요구** → 운영 실측 후 `UTTERANCE_ANALYSIS_MAX_ROWS` 상향(20,000 상한 · 그 이상은 메모리·커밋 설계 재검토).
- **보존 일수를 콘솔에서 바꾸자는 요구** → No.45 보존 정책 편입 설계(기본값 의미 확장 ADR).
- **동시 분석 2건 이상 요구** → 잠금 슬롯화(§8.2).
- **이름 제안에 증강과 다른 모델 필요** → 두 번째 생성 프로세스 + 별도 주소(출구·지도).
- **같은 계약의 두 번째 생성 소비자 또는 cloud 구현이 필요한 소비자** → `packages/llm-provider` 승격.
- **규모 B(내부 대화 기록 입력) 요청** → FR-DC10 설계(원본 "통계 > 군집분석" 대체 · 보존 연동).
- **다중 인스턴스 전환** → 동시 실행 잠금·고아 정리·취소 레지스트리를 임대 방식으로.

---

## 27. 구현 편차 기록 (구현 후 작성)

> 2026-09-30 backend-implementer · ml-engineer 구현과 code-reviewer 1차 수정 반영. 설계 밖 파일을 고친 경우는 표에 명시한다.

| # | 내용 |
|---|---|
| **I-1** | **브랜드 이름 `MaskedText` → `MaskedUtteranceText`.** 기존 `inbox-sealing.spec.ts` O-4가 `as MaskedText` 문자열을 `inbox/core/lib/masked-text.ts` 밖에서 금지해 DC-7의 이름과 충돌했다(닫힌 목록 밖의 기존 시험은 고칠 수 없다). DC-7·UA-7 표기를 새 이름으로 갱신했다. |
| **I-2** | **XLSX 항목 순서 정규화 `lib/xlsx-order.ts`(우회).** 기존 `XlsxSheetReader`(exceljs 스트리밍)는 `xl/workbook.xml`이 워크시트 뒤에 있는 파일(exceljs가 만든 파일 전부 — 이 저장소의 `buildXlsxTemplate` 출력 포함)을 안정적으로 읽지 못한다. 읽기 전에 압축 항목 순서만 바로잡는다(fflate 비동기 API · 전체 30MB/항목 20MB 상한을 **해제 전**에 헤더 원본 크기로 판정). **기존 결함 D-5 후보(인계):** 의도·키워드·FAQ 대량등록 리더도 같은 조건에서 실패할 수 있다 — 기존 리더는 이 그룹에서 고치지 않았다. |
| **I-3** | **§7.4 ③④ 통합.** 요청·미리보기가 같은 공통 함수로 임베딩 가용성과 출구 사전 판정을 함께 본다. 출구가 막혀 연결이 실패한 경우 503이 아니라 `409 EGRESS_HOST_NOT_ALLOWED`로 원인을 알린다(미리보기 포함). |
| **I-4** | **`validCount` = 병합 후 고유 발화 수**, `mergedCount` = 병합으로 사라진 행 수. `UTTERANCE_ANALYSIS_TOO_FEW` 판정도 이 값이다. |
| **I-5** | **capability 정적 판정.** `embeddingAvailable` = 주소 설정 여부 ∧ `checkEgress('EMBEDDING')`가 차단이 아님(순수 계산 · 네트워크 호출 0). 실제 연결 실패는 요청 시 503. `getDetail`의 `staleModel`도 네트워크 확인 없이 마지막으로 연결된 제공자의 `modelId`(`AnalysisEmbeddingSource.knownModelId()`)와 비교한다(연결된 적이 없으면 판정하지 않는다). |
| **I-6** | **파기 잡 단계는 `purgeBatchLoop` 대신 자체 루프**(예산 차감 단위 = 삭제한 발화 행 수). 기존 파기 잡 로직은 불변. |
| **I-7** | `createMany` 조각 250행(SQLite 바인드 변수 여유). 5,000행 저장은 통합 시험(1,000행 대량)에서 통과. |
| **I-8** | **`slicePoints` 64 주입.** ml-engineer가 `spherical-kmeans` hooks에 선택 `slicePoints`(미지정 시 256 · 결과 동일성 시험 포함)를 열었고 러너가 `CLUSTERING_SLICE_POINTS = 64`를 넘긴다. 이벤트 루프 최장 점유가 5,000점 × k=50에서 기본 256일 때 70~77ms, 64로 낮추면 약 20ms라는 수치는 **ml-engineer 임시 측정(재현 스크립트·저장소 보고서 없음)** 이며 단정하지 않는다 — 운영 장비 부하 게이트(AC-DC7-4)에서 다시 잰다. 결과(묶음 배정)에는 영향이 없다(동일성 시험). |
| **I-9** | 응답 형태 결정: 취소·삭제 `204`, 이름 수정은 갱신된 묶음(`UtteranceCluster`) 반환. 화면 명세 선택 요청 2건(목록 `failureReason`, 미리보기 `minValidCount`)을 shared-types 선택 필드로 추가. |
| **I-10** | **`.csv` 인코딩 오류 구분(M-2).** ZIP·NUL이 없고 UTF-8 해석만 이상한 `.csv`(CP949/EUC-KR)는 `400 IMPORT_FILE_INVALID` + 메시지 "UTF-8로 저장한 뒤 다시 올려 주세요." + `details[{ field: 'encoding', message }]`로 안내한다(shared-types 변경 없음). 그 밖의 형식 불일치는 기존 일반 안내(details 없음), 머리글 불일치는 `details[field=header]`. |
| **I-11** | **취소 시 `activeLock`은 러너가 실제로 끝날 때 푼다**(§8.3 정정 — 취소 CAS는 상태만 `CANCELLED`로 바꾼다). 취소 직후 러너가 배치 하나를 마저 돌고 있는 동안 새 요청은 `409 UTTERANCE_ANALYSIS_BUSY`이다(두 작업이 겹쳐 돌지 않는다). 해제는 싱크의 `markFinished`(성공·실패·취소 공통)가 한다. 취소 후 러너가 끝나기 전에 서버가 내려간 경우(CANCELLED + 잠금 유지)는 기동 시 `failOrphans()`가 상태는 그대로 두고 잠금만 푼다(별도 UPDATE). 또한 잠금이 남아 있는(러너 마무리 중인) 분석의 수동 삭제는 `409 INVALID_STATUS_TRANSITION`("취소를 정리하는 중입니다. 잠시 뒤 다시 삭제해 주세요.")로 거절한다 — 행 삭제로 잠금이 사라져 새 분석이 겹쳐 도는 것을 막는다. |
| **I-12** | 감사 `targetName`은 파일 이름(마스킹본 포함)이 아니라 `분석 <id 앞 8자>`이다(UA-9 정합 · K-2). 수동 삭제 감사는 삭제가 성공한 뒤 기록한다. |
| **I-13** | 임베딩 모델 변경 판별은 오류 메시지 문자열이 아니라 타입(`EmbeddingModelChangedError` — `EmbeddingProviderUnavailableError`의 하위 클래스, `embedding-provider.port.ts`·`http-embedding.provider.ts` 1줄 변경)으로 한다. 기존 catch·시험은 그대로 통과. |
| **I-14** | 이름 제안 표본은 발화 길이 설정(`UTTERANCE_ANALYSIS_MAX_CHARS` ≤ 1000)과 무관하게 각 300자로 자른다(`/cluster-label` 계약). |
| **I-15** | **열람 감사 범위 판단(L-5).** 묶음 상세의 대표 발화(묶음당 ≤3) · 반영 미리보기의 포함 문장은 마스킹 문장을 싣지만 `@AuditView` 대상에 넣지 않았다. 근거: 열람 감사 닫힌 목록(G-15 · 11→12)은 FR-0-297이 정한 범위이고, 이 화면들의 문장은 **발화 목록(`listUtterances`)에서 이미 감사되는 같은 데이터의 부분집합**이며(같은 열람자 · 같은 분석 · 같은 날 1건) 상세는 폴링 대상이라 감사 잡음이 크다. 이 범위를 넓히려면 architect가 §20.6 닫힌 목록을 먼저 갱신해야 한다(재검토 트리거). |
| **I-16** | **garu 실제 품사 태그(ml-engineer):** 명사만 = `NNG`·`NNP`·`SL`(영문 약어) · 명사만 끔 = 위 + `VV`·`VA`(어간)·`XR`(어근). `UNK`(휴리스틱 M0의 어간 태그)는 두 모드 모두 후보로 인정(그렇지 않으면 기본 분석기 폴백 시 키워드 0개). `NNB`·`NP`·`NR`·`MAG`·`MM`·조사·어미·`SN`·기호는 자연히 제외된다. jest 환경에서는 garu 적재가 실패해 휴리스틱으로 대체된다(기존 동작 — 통합 시험 결과에 `HEURISTIC_ANALYZER` 알림). |
| **I-17** | **합격 수치 제안(ml-engineer 첫 측정 보고서 기준 · `apps/api/src/utterance-analysis/eval/report/`):** 순도 ≥ 0.75 · ARI ≥ 0.55 · NMI ≥ 0.80 · 미분류 비율 ≤ 10% · 반복 결과 완전 일치. **제안이며 PM 확정 · 운영 실데이터 재측정 후 확정한다**(§20.5 ⑥의 잠정값 순도 0.80·ARI 0.50을 대체할지 PM 판단). 확정 전 AC-DC3-4 게이트는 "측정 기록 존재 + 결정론 일치". **이 제안 기준은 쉬운 합성셋(`dataset-clustering-ko`) 기준이며, 혼동 데이터셋(classifier `dataset-hard`: 순도 0.656 · ARI 0.461 · NMI 0.785 · 미분류 4.4%)은 미달이다 — PM 확정 · 운영 실데이터 재측정 후 최종.** |
| **I-18** | 마이그레이션 `20260930120000_utterance_analysis`: CREATE 3테이블·인덱스뿐(인덱스 삭제 줄 0). 통합 시험이 `migrate deploy` 뒤 원시 부분 유니크 인덱스 4개 유지와 `activeLock` 유일 제약(중복 ACTIVE = P2002 · null 다건)을 단언한다. |
| **I-19** | 수동 게이트(미실행): AC-DC3-4(KURE-v1 품질 보고서 합격 판정) · AC-DC6-4(3050 + Ollama 이름 제안) · AC-DC7-4(부하 — 분석 중 대화 임베딩 P95·회로 개방) · NFR-DCP1(5,000행 10분). 실제 임베딩 전 경로 수동 확인은 하지 않았다(가짜 임베딩 서버로 자동 시험). |
