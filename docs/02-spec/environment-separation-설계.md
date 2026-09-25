# 환경 분리 / 버전 관리 세부 설계서 (No.40)

> **요구사항**: `docs/requirements/environment-separation.md`(T-1~12, J-1~J-20, FR-0-149~160, FR-EN1-\*~FR-EN9-\*, NFR-ENP/ENS/ENA/ENM, AC-EN1~EN8, EX-EN-1~26, 제약 C-1~C-4, P-1~P-12)
> **상위 문서**: `docs/02-spec/개발명세서.md` §2·§2.2·§3·§3.1·§4·§4.1·§5·§5.1·§6(**결정 40 신설**)·§7
> **신규 ADR**: **ADR-0039**(환경 = 한 챗봇 안의 버전 포인터(초안 = 기존 테이블) · 운영 포인터는 `Chatbot` 행 컬럼(공개 경로 추가 조회 0) · 운영 번들 = 불변 스냅샷 역직렬화 + 라이브 운영 자산 합성 · 스냅샷 해시 밖 동점 보조 필드 · 의미 색인 = 슬롯 테이블 불변 + 문장 해시 주소 보존 저장소 · 전환 = 포인터 CAS + append-only 이력 · 경고/차단 게이트 · `chatbot:deploy` · **ADR-0031 §8 부분 대체 · ADR-0032 §1 draft/published 기각 대체**)
> **갱신 ADR(각주만)**: ADR-0031(§8 부분 대체 · 보조 필드 · 보존 보호 · 트리거 2종) · ADR-0032(`SWITCH_PROD_VERSION` · 모드 켜기 시 `HELD`) · ADR-0037(적재기 1차 미사용) · ADR-0024(보존 저장소 · ml-worker 무변경) · ADR-0029(실행 대상 차원) · ADR-0015(권한 17 → 18) · ADR-0016(`ChatbotEnvironment` 대상) · ADR-0002(동반 삭제 +3) · ADR-0033(로그 `servedVersionId`) · ADR-0019(운영 미반영 표시 판정) · ADR-0008(서빙 번들 순서 재현) · ADR-0011(운영 모드 표시 설정 출처)
> **작성일**: 2026-09-25 · **GPU**: **1 유지**(포인터·역직렬화·집합 차이·DB 트랜잭션만 — 새 모델·학습·추론 0 · 추가 임베딩 호출은 경합 예외 외 0 · ml-worker 변경 0) — §29
> **기존 파일 수정 목록**: 문서는 `docs/02-spec/environment-separation-patches.md`, 코드는 이 문서 §2.5.

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

카탈로그 No.40은 "배포 전 별도 환경에서 대화 플로우를 테스트하고, 환경별로 버전을 태깅·트래픽 전환"하라고 한다. 이 설계는 **자산 테이블을 이중화하지 않고, 대화 엔진·위젯·ml-worker를 한 줄도 바꾸지 않고** 다음을 만든다. ① **환경 = 포인터**: 초안(DEV)은 지금의 자산 테이블 그대로이고, 스테이징·운영은 불변인 `ChatbotVersion` 스냅샷을 가리킨다. 운영 포인터는 **`Chatbot.prodVersionId` 컬럼**이라 `access.resolve()`가 이미 읽는 행에서 **추가 조회 0**으로 얻는다(값 null = 모드 꺼짐 = 현행 경로 바이트 동일). 스테이징 포인터·게이트 설정은 1:1 `ChatbotEnvironment`, 전환 이력은 append-only `EnvironmentSwitchLog`다. ② **운영 서빙**: 모드 켜진 챗봇의 공개 대화·상담 힌트는 **버전 번들**(스냅샷 역직렬화 → 동점 보조 필드 적용 → 생성순 재정렬 → 현재 설문·토픽 활성 합성 → 인덱스)을 `(chatbotId, versionId)` 키 캐시에서 얻는다. 초안 캐시(`getCached`)와 인스턴스가 분리되고 무효화 지점은 기존 `DialogueBundleService.invalidate()` 1곳이다. ③ **C-1 동점**: 스냅샷 봉투에 **해시 밖 최상위 보조 필드 `tiebreak.nodeUpdatedAt`**을 둔다 — `contentHash`는 자산부만 보므로 기존 해시·픽스처가 그대로이고, 보조 필드가 없는 과거 스냅샷은 `capturedAt` 폴백 + `LEGACY_TIEBREAK` 경고다. ④ **C-2 의미 색인**: 기존 슬롯 테이블(`EmbeddingVector`)과 색인기는 **무변경**이고, 새 **문장 해시 주소 보존 저장소 `EmbeddingTextVector`(`chatbotId, modelId, textHash` 유일)**가 포인터·운영 이력 버전 문장의 벡터를 **이미 있는 벡터를 복사해** 보존한다. 버전 대상 점수는 "보존 저장소 ∪ 같은 `textHash`의 초안 벡터"로 조립하므로 초안 편집·삭제·재색인이 운영 점수를 바꾸지 않고 추가 임베딩 호출은 0이다. ⑤ **전환**: 운영 전환·롤백은 포인터 CAS(`updateMany where prodVersionId = expected`) + 이력 1행의 트랜잭션이며 자산 테이블 쓰기 0 · `restore()` 호출부 2곳 불변 · 신규 권한 `chatbot:deploy`(ADMIN) · 예약 전환은 No.28에 실행기 1파일(`SWITCH_PROD_VERSION`). 이 설계가 추가로 찾은 제약 5건: **① 스냅샷 본문은 `id asc`로 저장되지만 라이브 번들은 `createdAt asc, id asc`(K-1)이고 의도·FAQ 매칭은 "동점이면 먼저 본 항목"이 이긴다**(`matcher.ts` 55행 `score > bestScore`) — `updatedAt`만 복원해서는 C-1이 풀리지 않고 **서빙 역직렬화가 생성순으로 재정렬**해야 한다(§6.2) · **② 봉투 검증 스키마 `ChatbotSnapshotEnvelopeSchema`는 `z.object`(strip)라 최상위 보조 필드가 파싱 단계에서 조용히 사라진다**(`version-payload.reader.ts` 45행) — 스키마에 선택 필드로 선언해야 한다(§6.1) · **③ "해시 같으면 최신 버전 재사용"만으로는 켜기 직후 응답 동일(AC-EN1-2)을 보장하지 못한다** — 편집 후 되돌리기로 해시는 같고 노드 `updatedAt`만 다를 수 있다(`tiebreakHash` 메타 컬럼으로 재사용 조건 강화 — §5.3) · **④ `ChatbotsService.permanentDelete()` 단위 시험이 트랜잭션 목의 모델을 명시 나열한다** — 동반 삭제 3테이블 추가 시 목 3줄이 필요하다(§24.2 X-4) · **⑤ `deploy-schedule-sealing.spec.ts` D-1은 `deploy-schedules/**`에서 `deploySchedule` 외 모델 쓰기를 0건으로 단언한다** — 전환 실행기는 포인터를 직접 쓰지 못하고 `environment/core`의 전환 서비스를 호출해야 한다(구조가 곧 봉인 — §11).

---

## 1. PM 확정 사항 (2026-09-25 — P-1~P-12 전부 추천안, No.40 도입 확정)

| # | 확정 내용 | 이 문서에서의 반영 |
|---|---|---|
| P-1 (d) | 1차 = 한 챗봇 안의 환경 포인터(초안 = 현재 테이블 · 스테이징/운영 = `ChatbotVersion` 스냅샷). 2차 = 서버 간 export/import. 복제 챗봇 체인 기각 | §2 · §3 · §26(2차 경계) · ADR-0039 §1 |
| P-2 (b) | 3단 고정(초안 → 스테이징 → 운영). 스테이징 검수는 콘솔(시뮬레이터·TC)만. 운영 전환 대상 = 현재 스테이징 버전 또는 운영 이력 버전(롤백)만 | §9.3 `isSwitchTargetAllowed` · §12 · `@Public()` 추가 0 |
| P-3 (b) | 즉시 전환 + 예약 전환(No.28 `SWITCH_PROD_VERSION`). 비율 분할 2차. 로그 `servedVersionId`는 1차부터 | §9 · §11 · §14 |
| P-4 (2) | 신규 권한 `chatbot:deploy`(ADMIN 기본). 스테이징 승격 = 편집자 가능 · 운영 전환·롤백·예약·모드 변경·게이트 설정 = deploy. 긴급 차단 = 기존 WEB 채널 닫기 | §17 |
| P-5 | 게이트 = 경고 기본 + 챗봇별 차단 선택 · 롤백엔 경고만 · 자동 롤백 없음 | §10 |
| P-6 | 켜기 = 현재 상태로 두 포인터 자동 초기화(응답 불변) · 끄기 = 매번 선택(기본 "운영 유지") | §5 |
| P-7 | 복원은 초안에만 · 운영 되돌리기는 포인터 롤백 | §13 |
| P-8 | 모드 켤 때 기존 `RESTORE_VERSION` 활성(PENDING) 예약 → `HELD(ENV_MODE_CHANGED)` | §5.3 · §11.6 |
| P-9 | 스냅샷 밖 자산(설문·API 연결·상담 설정·자주 쓰는 문장·채널·금지어·토픽 정의/활성)은 즉시 운영 반영 + 화면 안내 | §7.4 · §23 |
| P-10 | 위젯 표시값(이름·아바타·스킨) = 운영 버전 값 · 인사말·퀵리플라이·런처 = 채널 설정 | §16 |
| P-11 | 통계는 로그 귀속만(비교 화면 2차) | §14 · §26 |
| P-12 | GPU 1 · 구축형 ○ · 구독형 ○(망분리 구축형은 2차) | §29 |
| (architect) | 포인터 저장 위치 = **운영은 `Chatbot.prodVersionId`**, 스테이징·게이트·켜짐 메타는 1:1 `ChatbotEnvironment`. 전환은 `Chatbot.updatedAt`을 갱신한다(수용) | §3.1 · §9.5 · ADR-0039 §2 |
| (architect) | C-1 = 봉투 최상위 해시 밖 `tiebreak.nodeUpdatedAt` + 서빙 역직렬화의 생성순 재정렬 · 과거 스냅샷 폴백 + `LEGACY_TIEBREAK` · 재사용 조건 = `contentHash` ∧ `tiebreakHash` | §6 |
| (architect) | C-2 = 슬롯 테이블·색인기 무변경 + 문장 해시 주소 보존 저장소 `EmbeddingTextVector` + "보존 ∪ 같은 해시 초안 벡터" 조립 · 복사 기반 보존(pin) · 참조 버전 밖 GC | §8 |
| (architect) | C-3 = 소비자별 명시 소스(판별 유니온 `BundleSource`) · 2층 캐시(불변 코어 L1 + 합성 L2) · 무효화 = 기존 `invalidate()` 1곳 | §7 |
| (architect) | 트리거 값 `ENV_INIT`·`PROMOTE` 신설(목록 필터 그룹 `ENVIRONMENT` 신설) | §4.2 · §5.3 · §9.2 |
| (architect) | 끄기 "운영 유지" = 콘솔이 **기존 복원 API를 먼저 호출**한 뒤 끄기(서버는 초안 해시 = 운영 해시 확인) — `restore()` 세 번째 호출부 0 | §5.4 |
| (architect) | 학습 큐 "운영 미반영"·재유입 오표시 = **표시 단계 판정**(순수 함수 · 전환 이력의 `toVersionCapturedAt`) — 수집기 봉인 불변 | §15.1 |
| (architect) | 평가·큐 상세의 "초안에서 삭제됨" = 상세 1건 한정 버전 코어 조회 | §15.2 |
| (architect) | 감사 = 신규 대상 `ChatbotEnvironment` 1종 · 액션 재사용(`STATUS_CHANGE`·`UPDATE`) — `AuditAction` 14종 불변 | §18 |
| (architect) | 신규 `ApiErrorCode` 8종(요구 6종 + `ENV_MODE_ALREADY_ENABLED`·`ENV_DRAFT_NOT_RESTORED`) | §19.3 |
| (architect) | 기대값 변경 닫힌 목록 X-1~X-4(+ 확인 항목 X-5) | §24.2 |

---

## 2. 아키텍처 배치

### 2.1 모듈 구조

기존 4계층 규약(개발명세서 §2.1)을 따른다. **NestJS 모듈 3개를 신설**한다 — 관리 API(`environment`), 포인터 쓰기·전환 핵심(`environment/core` — 예약 실행기가 재사용), 버전 번들 서빙(`environment/serving` — 공개 대화·시뮬레이터·TC·상담·학습이 재사용). 순환 의존을 피하려고 셋으로 나눈다(§2.2).

```
apps/api/src/
├── environment/
│   ├── environment.module.ts                    # [신규] imports: core · serving · version-capture · version-read · deploy-schedules(EnvironmentScheduleHooks) · embedding · chatbots · audit-logs
│   ├── environment.controller.ts                # [신규] 11 핸들러(§19.1) — @Public() 0
│   ├── environment-mode.service.ts              # [신규] 켜기/끄기 미리보기·확정 · 게이트 설정(§5 · §10)
│   ├── staging-promotion.service.ts             # [신규] 초안 → 스테이징 승격(§9.2)
│   ├── environment-history.service.ts           # [신규] 전환 이력 조회(읽기 전용)
│   ├── lib/
│   │   ├── enable-plan.ts                       # decideEnvInitVersion({ latest, captured }) → REUSE | CREATE (§5.3)
│   │   ├── disable-plan.ts                      # decideDisable({ mode, draftHash, prodHash, expectedDraftHash }) (§5.4)
│   │   └── environment-sealing.spec.ts          # §20 E-1~E-17
│   ├── core/
│   │   ├── environment-core.module.ts           # [신규] exports: ProdSwitchService · EnvironmentReadService (2개)
│   │   ├── environment-pointer.writer.ts        # ★ Chatbot.prodVersionId · ChatbotEnvironment · EnvironmentSwitchLog 쓰기 유일 파일
│   │   ├── prod-switch.service.ts               # 운영 전환·롤백 미리보기/확정(즉시·예약 공용 — §9.3)
│   │   ├── environment-read.service.ts          # 상태 조회 · 보호 버전 집합(§13.2) · 게이트 입력 조회
│   │   └── lib/
│   │       ├── switch-rules.ts                  # isSwitchTargetAllowed · pickRollbackTarget · classifySwitch(NOOP 등) (§9.3)
│   │       ├── gate.ts                          # evaluateProdSwitchGate() — 미리보기·즉시·예약 공용 순수 함수 1개(§10)
│   │       ├── switch-warnings.ts               # 경고 산출 순수 함수(맥락 흐름·동점 가능성·토픽 노출 — §9.4)
│   │       └── protected-versions.ts            # computeEnvironmentProtectedIds() (§13.2)
│   └── serving/
│       ├── environment-serving.module.ts        # [신규] exports: VersionBundleService 1개
│       ├── version-bundle.service.ts            # get(chatbotId, versionId, opts) · getCore(versionId) · warm() — L1/L2·단일 비행(§7)
│       ├── version-core.cache.ts                # L1: versionId → 불변 서빙 코어(LRU, TTL 없음)
│       └── lib/
│           ├── bundle-source.ts                 # bundleSourceOf(chatbotRow) → { kind:'DRAFT' } | { kind:'VERSION', versionId }
│           └── compose-serving-bundle.ts        # 코어 + 현재 설문 + 토픽 정규화·비활성 필터 → DialogueBundle(순수)
├── versions/
│   ├── lib/snapshot-envelope.ts                 # [수정] buildSnapshotEnvelope가 tiebreak.nodeUpdatedAt 채움(§6.1)
│   ├── lib/snapshot-canonical.ts                # [수정] serializeEnvelopeForStorage가 tiebreak 포함(해시 함수 무변경) · computeTiebreakHash()
│   ├── lib/snapshot-serving.ts                  # [신규] hydrateForServing() — 보조 필드 적용 + 생성순 재정렬(§6.2) · hasPotentialNodeTies()
│   ├── lib/external-refs.ts                     # [신규] collectExternalRefs(envelope) — 복원 경고·전환 미리보기 공용(동작 불변 추출)
│   ├── lib/retention-policy.ts                  # 무변경(보호 집합 입력만 늘어난다)
│   ├── read/version-read.module.ts              # [신규] VersionPayloadReader 제공·export(VersionsModule·serving 공용)
│   ├── capture/version-capture.service.ts       # [수정] tiebreakHash 계산·저장 · AutoCaptureTrigger 타입에서 ENV 트리거 제외
│   ├── capture/version-retention.service.ts     # [수정] 보호 집합에 환경 참조 버전 + SWITCH 예약 대상 · 삭제 409 VERSION_REFERENCED_BY_ENVIRONMENT
│   ├── restore/restore-warnings.service.ts      # [수정] collectExternalRefs 사용(동작 불변) · 모드 켜짐 시 ENV_DRAFT_ONLY 경고 추가
│   ├── restore/version-restore.service.ts       # [수정] assertScope select에 prodVersionId(경고 입력 전달만) — 복원 의미론 무변경
│   ├── version.service.ts                       # [수정] 목록·상세의 environmentBadges(모드 켜짐일 때만 키 존재)
│   └── versions.module.ts                       # [수정] VersionPayloadReader를 VersionReadModule import로 대체
├── embedding/
│   ├── text-vector/embedding-text-vector.service.ts   # [신규] ★ EmbeddingTextVector 쓰기 유일 파일 — pin · retainOnly · purgeChatbot
│   ├── text-vector/text-vector.cache.ts               # [신규] (chatbotId, modelId) → textHash→vector 맵(TTL 60초, pin 시 무효화)
│   ├── version-vectors/version-vector.resolver.ts     # [신규] 버전 슬롯 → AssembleVectorEntry[] (보존 ∪ 초안 같은 해시)
│   ├── lib/semantic-slots.ts                          # [신규] deriveSemanticSlots(bundle) — 색인기 대상 규칙과 동등(동등성 시험)
│   ├── semantic-match.service.ts                      # [수정] score(..., source?) 선택 5번째 인자 — 미지정 = 현행 경로
│   ├── vector-cache.service.ts                        # [수정] CachedVectorEntry에 textHash 1필드(조회 행에 이미 존재)
│   └── embedding.module.ts                            # [수정] providers +3 · exports += EmbeddingTextVectorService, VersionVectorResolver
├── conversation/
│   ├── public-conversation.service.ts           # [수정] loadServing() 1곳에서 소스 선택 · getConfig 표시 설정 출처 · record(servedVersionId) · 생성자 +1(끝)
│   ├── conversation-log.service.ts              # [수정] create.data.servedVersionId
│   └── conversation.module.ts                   # [수정] imports += EnvironmentServingModule
├── rag/conversation-log.port.ts · rag-answer.service.ts   # [수정] servedVersionId? 전달(조건부 전개)
├── simulation/simulation.service.ts             # [수정] simulate()의 target(기본 초안) · compare 무변경 · 생성자 +1(끝)
├── validation/
│   ├── run/test-run.executor.ts                 # [수정] 실행 행의 대상으로 A측 번들·설정·벡터 선택 · 생성자 +1(끝)
│   ├── test-run.service.ts                      # [수정] start()의 target 해석·저장(STAGING/PROD → versionId)
│   └── validation.module.ts                     # [수정] imports += EnvironmentServingModule
├── handoff/handoff-hints.service.ts             # [수정] assertReadable 반환 prodVersionId로 소스 선택 · 생성자 +1(끝)
├── learning/unanswered-questions.service.ts     # [수정] 목록 prodReflection(모드 켜짐 · RESOLVED만) · 상세 "초안에서 삭제됨"
├── dialogue-common/
│   ├── dialogue-bundle.service.ts               # [수정] loadLiveOverlay(chatbotId) 추출(설문 매핑 공용 — build 동작 불변) · invalidate()가 L2 캐시도 비움
│   ├── version-serving-bundle.cache.ts          # [신규] L2 합성 캐시(키 chatbotId:versionId:filter, TTL 60초, LRU) — 무효화 지점 공유 목적으로 여기 둔다
│   └── dialogue-common.module.ts                # [수정] 'VersionServingBundleCache' 제공·export
├── deploy-schedules/
│   ├── executors/switch-prod-version.executor.ts   # [신규] 실행기 1파일(§11)
│   ├── executors/executor.registry.ts           # [수정] 매핑 1줄
│   ├── lib/required-permissions.ts              # [수정] case 1개(`chatbot:deploy`) + G3 허용 동작 +1
│   ├── lib/switch-chain.ts                      # [신규] resolveSwitchBinding(siblings, currentProd) 순수(§11.2)
│   ├── lib/outcome-classifier.ts                # [수정] 코드 → 사유 매핑 3행(§11.4 — 골격 불변)
│   ├── env-hooks/environment-schedule.hooks.ts  # [신규] 모드 켜기/끄기의 예약 처리 — repository 위임만(쓰기 0)
│   ├── engine/deploy-schedule.repository.ts     # [수정] holdRestoreForEnvModeChange(tx) · cancelSwitchForEnvDisable(tx) 2메서드
│   ├── post-run/post-run-test.starter.ts        # [수정] SWITCH 실행 직후 TC 대상 = 새 운영 버전
│   └── deploy-schedules.module.ts               # [수정] imports += EnvironmentCoreModule · exports: EnvironmentScheduleHooks
├── chatbots/
│   ├── chatbot-scope.service.ts                 # [수정] assertReadable/assertWritable 반환 { prodVersionId }(select 1컬럼 추가 — 쿼리 수 불변)
│   └── chatbots.service.ts                      # [수정] permanentDelete 동반 삭제 +3
├── audit-logs/lib/audit-snapshot.ts             # [수정] AUDIT_FIELDS.ChatbotEnvironment
└── config/env.validation.ts                     # [수정] 선택 2종(§3.4)
```

### 2.2 모듈 의존 방향

```
environment        → environment/core · environment/serving · version-capture · versions/read · deploy-schedules(EnvironmentScheduleHooks) · embedding · chatbots · audit-logs
deploy-schedules   → environment/core(ProdSwitchService·EnvironmentReadService) · (기존)
environment/core   → versions/read · embedding(EmbeddingTextVectorService) · chatbots · audit-logs · prisma          (deploy-schedules import 0)
environment/serving→ versions/read · dialogue-common · embedding · prisma                                              (core·environment import 0)
conversation｜simulation｜validation｜handoff｜learning → environment/serving(VersionBundleService 1개)
versions           → environment/** import 0 (보호 집합·배지는 Prisma 읽기 + shared-types 순수 함수)
embedding          → environment/** · versions/** import 0 (버전 슬롯은 호출자가 넘긴다)
```

- **`EnvironmentServingModule`의 export는 `VersionBundleService` 1개**다. 포인터를 쓰는 코드는 이 모듈에 없으므로 공개 대화·시뮬레이터·TC·상담·학습의 DI 그래프에 **포인터 쓰기 경로가 들어가지 않는다**(ADR-0025 봉인 L1 방식).
- **`EnvironmentCoreModule`의 export는 `ProdSwitchService`·`EnvironmentReadService` 2개**다. 포인터 쓰기 유일 파일 `environment-pointer.writer.ts`는 export하지 않는다(주입 불가 — `VersionRestoreApplier` 미export 선례).
- **`DeploySchedulesModule`은 `EnvironmentScheduleHooks` 1개만 새로 export**한다. 훅은 `DeployScheduleRepository`의 새 메서드 2개에 위임만 하므로 `deploySchedule` 쓰기 파일은 **2개 그대로**다(D-1). `deploy-schedules.module.ts`가 새로 import하는 `EnvironmentCoreModule`은 D-2 금지 목록(자산 6모듈·`AnswerSettingsModule`·`AugmentationModule`·`LearningModule`·`ClassifierModule`·`TrainingJobsModule`·`ConversationModule`)에 없고, core는 그 모듈들을 import하지 않는다.
- 순환 없음: `environment → deploy-schedules → environment/core`이며 `environment/core`는 `deploy-schedules`를 import하지 않는다.

### 2.3 엔진 수정 범위 — **0건** (FR-0-149)

- `packages/dialogue-engine`은 한 파일도 바꾸지 않는다. 운영 번들은 기존 `DialogueBundle` 모양이며, 동점 일치는 **입력 데이터(`updatedAt` 값·배열 순서)를 라이브와 같게 만드는 것**으로 푼다(§6) — `rankNodes`·`matchIntent`·`matchFaqEntry`의 규칙은 그대로다.
- 엔진 패키지에 `environment`·`prodVersion`·`servedVersion`·`tiebreak` 심볼 0건을 정적 검사가 단언한다(E-5).

### 2.4 `apps/api` 외 워크스페이스 영향

| 워크스페이스 | 변경 |
|---|---|
| `packages/shared-types` | **`bundle-target.ts` 신설**(zod만 의존 — `BundleTargetSchema`) · **`environment.ts` 신설**(§4.1) · `version.ts`(트리거 2종·그룹 1종·봉투 `tiebreak?`·목록 `environmentBadges?`·복원 경고 `ENV_DRAFT_ONLY`) · `deploy-schedule.ts`(동작 1·params·생성/미리보기 유니온·전제 조건 사유 1·보류 사유 1·실패 사유 1·결과 요약 1·준비도 경고 1) · `validation.ts`(실행 요청 `target?`·실행 `target?`·지문 `target?`) · `conversation.ts`(시뮬레이터 요청/응답 `target?`) · `learning.ts`(목록 `prodReflection?`·상세 대상 `deletedInDraft?`) · `security.ts`(`chatbot:deploy`) · `audit.ts`(`ChatbotEnvironment`) · `common.ts`(`ApiErrorCode` 8종) · `index.ts` |
| `apps/web` | 배포 그룹 "환경" 화면 · 공통 헤더 환경 배지 · 버전 목록 배지 · 시뮬레이터·TC 대상 선택 · 복원 확인 문구 · 환경 밖 자산 안내 · 학습현황 배지 · 예약 동작 선택(`ActionPickerStep`의 `Record<DeployScheduleAction,…>` 2곳·`deploySchedulePermissions.ts`·`ReadinessWarningList.tsx` 분기 — 컴파일 강제) — §23 |
| `apps/widget` · `packages/dialogue-engine` · `packages/pii-mask` · `apps/ml-worker` | **변경 0건** |

### 2.5 기존 코드 변경 목록 (구현자 체크리스트)

| 파일 | 변경 | 근거 |
|---|---|---|
| `prisma/schema.prisma` + 마이그레이션 2개 | ① `ChatbotVersion.tiebreakHash`(커밋 ①) ② `Chatbot.prodVersionId` · `ConversationLog.servedVersionId` · `TestRun.targetKind`/`targetVersionId`/`targetVersionNo` + 인덱스 1 · `ChatbotEnvironment`·`EnvironmentSwitchLog`·`EmbeddingTextVector` 신설 · `Chatbot` 역참조 3 — **새 컬럼은 전부 모델 끝** | §3 |
| `packages/shared-types/src/{bundle-target,environment,version,deploy-schedule,validation,conversation,learning,security,audit,common,index}.ts` | §4 | — |
| `config/env.validation.ts` | 선택 2종 | FR-0-159 |
| `versions/lib/snapshot-envelope.ts` · `snapshot-canonical.ts` · `snapshot-serving.ts`(신규) · `external-refs.ts`(신규) | §6 · §9.4 | C-1 |
| `versions/capture/version-capture.service.ts` | `computeFromCaptured()`가 `tiebreakHash` 계산 · `persistWithin()`이 저장 · `AutoCaptureTrigger = Exclude<…, 'MANUAL'｜'BEFORE_RESTORE'｜'ENV_INIT'｜'PROMOTE'>` | §5.3 |
| `versions/capture/version-retention.service.ts` | `deleteOne()`·`pruneBestEffort()` 트랜잭션 안에서 환경 보호 집합 조회(모드 꺼진 챗봇 = `chatbotEnvironment.findUnique` 1회 추가, null이면 끝) · 예약 참조 조회의 `action` 조건을 `in ['RESTORE_VERSION','SWITCH_PROD_VERSION']`로 | §13.2 |
| `versions/restore/restore-warnings.service.ts` | 외부 참조 수집을 `collectExternalRefs()`로 대체(동작 불변) · 입력 `prodVersionId`가 있으면 `ENV_DRAFT_ONLY { prodVersionNo, stagingVersionNo }` 추가(버전 번호 조회 1회 — 모드 켜짐만) | §13.1 |
| `versions/restore/version-restore.service.ts` | `assertScope()` select에 `prodVersionId` · `preview()`가 경고 서비스에 전달. **`restore()` 본문·검증·트랜잭션 무변경** | §13.1 |
| `versions/version.service.ts` | `list()`·`detail()` — `assertReadable()` 반환 `prodVersionId`가 있을 때만 환경 행·최근 운영 이력 조회(+2) 후 `environmentBadges` 채움(키 조건부) | §13.3 |
| `versions/read/version-read.module.ts`(신규) · `versions/versions.module.ts` | `VersionPayloadReader`를 새 모듈로 이동·export — 파일 위치·클래스 불변 | §2.1 |
| `embedding/**` | §8 | C-2 |
| `dialogue-common/dialogue-bundle.service.ts` | `loadLiveOverlay(chatbotId)` = `{ surveys, topics }`(설문 매핑을 `build()`와 같은 private 헬퍼로 — `build()` 결과 바이트 불변) · `invalidate()`에 `versionServingCache?.invalidateChatbot(chatbotId)` 1줄(선택 주입) | §7.3 |
| `dialogue-common/version-serving-bundle.cache.ts`(신규) · `dialogue-common.module.ts` | L2 캐시 | §7.3 |
| `conversation/public-conversation.service.ts` | `loadServing(chatbot)` private 1개(§7.2) — 초안 경로는 기존 두 호출(`getCached` → `answerSettingsCache.get`)을 **같은 순서로** · `semanticMatch.score()` 초안 경로 4인자 그대로 · BLOCK·HANDLED·일반·보류 턴 `record()`에 `servedVersionId: chatbot.prodVersionId ?? undefined` · `getConfig()` 표시 설정 3필드 출처 · **생성자 16번째 인자 `VersionBundleService`(끝)** · 버전 읽기 실패 시 폴백 턴(§7.6) | §7 · §14 · §16 |
| `conversation/conversation-log.service.ts` | `RecordConversationLogParams.servedVersionId?` · `create.data.servedVersionId: params.servedVersionId ?? null` | §14 |
| `rag/conversation-log.port.ts` · `rag/rag-answer.service.ts` | `servedVersionId?` 전달(두 `record()`) · `enqueue` 입력은 값이 있을 때만 키(조건부 전개) | §14 |
| `simulation/simulation.service.ts` | `simulate()`: `dto.target`이 없거나 `DRAFT`면 **현행 코드 그대로** · 그 밖은 `VersionBundleService` · 오버레이 + 비초안 대상 = `400` · 응답 `target?`(비초안일 때만) · `compare()` 무변경 · 생성자 11번째 인자(끝) | §12.1 |
| `validation/test-run.service.ts` · `run/test-run.executor.ts` | 대상 해석·저장 · A측 번들/설정/벡터 소스 · 지문 `target?` · 오버레이 + 비초안 = `400` · 생성자 12번째 인자(끝) | §12.2 |
| `handoff/handoff-hints.service.ts` | `getHints()`의 `assertReadable()` 반환 `?.prodVersionId`로 `compute()` 소스 결정 · 생성자 7번째 인자(끝) | §7.1 |
| `learning/unanswered-questions.service.ts`(+ mapper) · `learning.module.ts` | 목록 `prodReflection?` · 상세 `deletedInDraft?` · imports += `EnvironmentServingModule` | §15 |
| `deploy-schedules/**` | §11 | T-2 |
| `deploy-schedules/readiness/readiness-warnings.service.ts` | 합격률 계산을 `computePassRate()`(공용 순수 함수)로 대체(동작 불변) · 모드 켜진 챗봇의 `RESTORE_VERSION`에 `ENV_DRAFT_ONLY` | §10 · §11.2 |
| `chatbots/chatbot-scope.service.ts` | `assertReadable()`·`assertWritable()`의 반환형 `Promise<void>` → `Promise<{ prodVersionId: string｜null }>` · select에 `prodVersionId` 추가(**쿼리 수 불변**) — 기존 호출부 무변경(반환값 무시) | §7.1 |
| `chatbots/chatbots.service.ts` | `permanentDelete` 트랜잭션: `embeddingTextVector`·`environmentSwitchLog`·`chatbotEnvironment` `deleteMany` 3줄(챗봇 삭제 직전) — 사전검사 15종 불변 | §3.1 |
| `audit-logs/lib/audit-snapshot.ts` | `ChatbotEnvironment: ['enabled','stagingVersionNo','prodVersionNo','gateMode','gateTestSetId','gateMinPassRate','gateValidHours']` | §18 |
| `apps/web/**` | §23 | — |
| 시험 파일 | §24.2 닫힌 목록 | FR-0-158 |

> **이 목록에 없는 파일은 바꾸지 않는다.** 특히 `packages/dialogue-engine/**` · `apps/widget/**` · `apps/ml-worker/**` · `embedding/index/indexer.service.ts`(색인기) · `embedding/index/reindex-queue.service.ts` · `embedding/lib/assemble-semantic-input.ts`(조립 순수 함수 — 입력만 달라진다) · `versions/restore/version-restore.applier.ts` · `versions/lib/{snapshot-hydrate,snapshot-upcasters,retention-policy,version-diff,restore-plan}.ts` · 자산 6모듈 · `topics/**` · `asset-transfer/**` · `feedback/**` · `surveys/**` · `survey-responses/**` · `stats/**` · `answer-settings/**`(설정 미리보기는 초안 고정) · `learning/{learning-apply,unanswered-collector,decomposed-resolve}.service.ts`는 무변경이다.

### 2.6 커밋 분리 단위

| 커밋 | 범위 | 독립성 |
|---|---|---|
| **① 서빙 준비(관측 응답 불변)** | 마이그레이션 `…_version_tiebreak`(`chatbot_versions.tiebreakHash`) · 봉투 `tiebreak` 캡처·저장·파싱 · `tiebreakHash` · `snapshot-serving.ts`(미사용 순수 함수 + 시험) · `external-refs.ts`·`computePassRate` 추출 · `loadLiveOverlay()` 추출 · `VectorCacheService` 항목 `textHash` · `assertReadable/assertWritable` 반환 확장 · `VersionReadModule` 분리 | No.40 본체에 의존하지 않는다. **모든 기존 시험이 수정 없이 통과**해야 한다(새 스냅샷의 `sizeBytes`만 보조 필드만큼 늘고 `contentHash`는 불변 — 해시 픽스처·골든 시험 무수정). 여기서 깨지면 멈추고 보고한다 |
| ② No.40 본체 | 나머지 전부(마이그레이션 `…_environment_separation` 포함) | FR-0-150 "바이트 동일" 기준선을 **① 적용 후**로 잡는다 |

> ①을 먼저 배포하면 **이후 생기는 모든 스냅샷이 보조 필드를 가진다** — 모드를 켤 때 `LEGACY_TIEBREAK`가 뜨는 과거 버전이 줄어든다(운영 권장 순서).

---

## 3. 데이터 모델 · 마이그레이션

### 3.1 Prisma 변경안

```prisma
model Chatbot {
  // … 기존 필드 불변 · archivedAt 다음(모델 끝)에 선언 …
  /// [신규 No.40] 운영 포인터(ADR-0039 §2) — 값 있음 = 환경 모드 켜짐, 공개 대화·상담 힌트가 이 버전을 서빙한다.
  /// null = 모드 꺼짐(현행 라이브 서빙 — 바이트 동일). FK 없음(보호는 앱 레벨 409 — DeploySchedule.targetVersionId 선례).
  /// ★ 쓰기 주체 = environment/core/environment-pointer.writer.ts 1파일(정적 검사 E-1) · 조건부 갱신(CAS)만.
  /// access.resolve()가 이미 읽는 행이라 공개 경로 추가 조회 0. 전환 시 @updatedAt이 갱신된다(수용 — §9.5).
  prodVersionId           String?
  /// [신규 No.40] 역참조만 — DB 컬럼 변화 0.
  environment             ChatbotEnvironment?
  environmentSwitchLogs   EnvironmentSwitchLog[]
  embeddingTextVectors    EmbeddingTextVector[]
}

model ChatbotVersion {
  // … 기존 필드 불변 · updatedAt 다음(모델 끝)에 선언 …
  /// [신규 No.40 — 커밋 ①] 봉투 보조 필드 tiebreak.nodeUpdatedAt의 sha256(정규 JSON). contentHash와 별개다(해시 밖).
  /// null = 보조 필드 없는 과거 스냅샷. 환경 캡처의 "재사용" 조건 = contentHash ∧ tiebreakHash 동일(§5.3).
  tiebreakHash            String?
}

model ConversationLog {
  // … 기존 필드 불변 · inputKind 다음(모델 끝)에 선언 …
  /// [신규 No.40] 이 턴을 처리할 때의 운영 포인터(모드 켜짐) — 엔진·BLOCK·상담 턴 공통. null = 라이브 서빙(모드 꺼짐).
  /// FK 없음 · 인덱스 없음(1차 = 적재만 — 비교 화면 2차) · 쓰기 주체 record() 1곳 · 적재 후 불변 · 백필 없음.
  servedVersionId         String?
}

model TestRun {
  // … 기존 필드 불변 · updatedAt·results 다음(모델 끝)에 선언 …
  /// [신규 No.40] 실행 대상: DRAFT(기존 행 전부) | STAGING | PROD | VERSION. STAGING/PROD는 시작 시점의 포인터를 해석해 저장한다.
  targetKind              String   @default("DRAFT")
  /// 대상 버전(DRAFT = null). FK 없음(버전 정리와 실행 보존 분리 — caseId 선례).
  targetVersionId         String?
  /// 표시용 스냅샷(버전이 정리돼도 "v44 대상" 표기 유지).
  targetVersionNo         Int?

  @@index([chatbotId, targetVersionId])   // [신규 No.40] 게이트 조회: 대상 버전의 최근 성공 실행
}

/// [신규 No.40] 챗봇별 환경 설정(1:1, ADR-0039 §2). 행은 처음 켤 때 만들고 끌 때 지우지 않는다(게이트 설정 보존).
/// 모드 켜짐 판정은 Chatbot.prodVersionId 1곳이다 — 불변식: prodVersionId ≠ null ⇒ 이 행 존재 ∧ enabledAt ≠ null.
/// 쓰기 주체 = environment-pointer.writer.ts 1파일. 스냅샷·복사·토픽 분리 대상 아님. 영구삭제 시 동반 삭제.
model ChatbotEnvironment {
  chatbotId        String    @id
  chatbot          Chatbot   @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// 스테이징 포인터. FK 없음. 모드 꺼짐 = null.
  stagingVersionId String?
  enabledAt        DateTime?
  /// 켠 사람 스냅샷(FK 없음 — AuditLog.actorId 규약).
  enabledById      String?
  enabledByEmail   String?
  /// WARN | BLOCK (zod EnvironmentGateMode)
  gateMode         String    @default("WARN")
  /// 필수 TC 세트(FK 없음 — 세트 삭제는 정당한 동작, BLOCK이면 "게이트 설정 오류"로 전환 거부 · §10).
  gateTestSetId    String?
  /// 최소 합격률(%, 0~100)
  gateMinPassRate  Int       @default(95)
  /// 결과 유효 기간(시간, 1~168)
  gateValidHours   Int       @default(24)
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@map("chatbot_environments")
}

/// [신규 No.40] 환경 포인터 전환 이력(append-only, ADR-0039 §5). 삭제·갱신 코드 0건(영구삭제 동반 삭제만 — E-7).
/// ★ 자산 본문·사용자 발화 컬럼 없음. reason은 API 응답에만(서버 로그 금지 — FR-0-155).
model EnvironmentSwitchLog {
  id                  String    @id @default(uuid())
  chatbotId           String
  chatbot             Chatbot   @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// STAGING | PROD
  environment         String
  /// INIT | PROMOTE | IMMEDIATE | SCHEDULED | ROLLBACK | DISABLE
  method              String
  fromVersionId       String?
  fromVersionNo       Int?
  /// DISABLE = null(포인터 제거)
  toVersionId         String?
  toVersionNo         Int?
  /// 대상 버전 createdAt(캡처 시각) 비정규화 — 학습 큐 "운영 미반영" 판정 입력(§15.1, 조인 없이).
  toVersionCapturedAt DateTime?
  /// SCHEDULED일 때 예약 id(FK 없음 — 임대 만료 회수 판정의 커밋 증거, §11.5)
  deployScheduleId    String?
  /// DISABLE일 때 KEEP_PROD | PROMOTE_DRAFT
  disableMode         String?
  actorId             String?
  actorEmail          String?
  /// 사유 메모(≤200 코드 포인트, 제어문자 금지 — MemoSchema 재사용)
  reason              String?
  createdAt           DateTime  @default(now())

  @@index([chatbotId, environment, createdAt])
  @@map("environment_switch_logs")
}

/// [신규 No.40] 문장 해시 주소 벡터 보존 저장소(ADR-0039 §4). 환경 포인터·운영 이력·전환 예약이 참조하는 버전의
/// 질문 측 문장 벡터를 "초안 편집·재색인과 무관하게" 보존한다. EmbeddingVector(슬롯 테이블)와 색인기는 무변경.
/// ★ 원문 텍스트 컬럼 없음(EmbeddingVector 규약) · 모드 꺼진 챗봇 = 0행 · 쓰기 주체 = embedding-text-vector.service.ts 1파일.
model EmbeddingTextVector {
  id        String   @id @default(uuid())
  chatbotId String
  chatbot   Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  modelId   String
  /// normalizeText(원문)의 sha256 — EmbeddingVector.textHash와 같은 함수(textHashOf).
  textHash  String
  dimension Int
  /// L2 정규화 Float32Array base64(EmbeddingVector.vector와 같은 코덱).
  vector    String
  createdAt DateTime @default(now())

  @@unique([chatbotId, modelId, textHash])
  @@map("embedding_text_vectors")
}
```

- **FK 판단**: `prodVersionId`·`stagingVersionId`·`servedVersionId`·`targetVersionId`에 FK를 걸지 않는다. `Chatbot ↔ ChatbotVersion` 순환 FK는 영구삭제 순서를 꼬이게 하고, SQLite에서 `chatbots` 테이블 재정의(`RedefineTables`)를 부른다. 보호는 **앱 레벨 409**(`VERSION_REFERENCED_BY_ENVIRONMENT`)와 보존 정리 보호 집합이다(§13.2).
- **영구삭제**: 3테이블은 **동반 삭제**(버전·예약과 같은 "챗봇과 생사를 같이하는 운영·파생 데이터" 분류)이며 사전검사 목록(15종)은 불변이다. 동반 삭제 16 → **19테이블**.

### 3.2 마이그레이션 (2개 — 커밋 ①·②)

**수기 작성**한다(`integrated_stats`·`feedback_loop` 선례). 새 컬럼은 모델 끝에 선언해 `migrate dev` diff를 최소화한다.

```sql
-- ① 20260925125000_version_tiebreak — 커밋 ① (ADR-0039 §3). 비파괴: ADD COLUMN 1(NULL). 백필 0.
ALTER TABLE "chatbot_versions" ADD COLUMN "tiebreakHash" TEXT;
```

```sql
-- ② 20260925130000_environment_separation — 커밋 ② (ADR-0039). 비파괴 변경만. 기존 행 값 변경 0 · 백필 0 · 테이블 재정의 0.
-- ADD COLUMN x5(NULL 또는 상수 기본값 — SQLite는 테이블 재작성 없음) + CREATE INDEX 1 + CREATE TABLE 3.
-- ⚠ 원시 부분 유니크 인덱스 4개(test_runs_chatbotId_active_key · deploy_schedules 2 · handoff_sessions_active_key)가
--   있는 테이블(test_runs)에 ADD COLUMN·CREATE INDEX만 한다 — RedefineTables가 없으므로 삭제될 경로가 없다(적용 후 재확인).
-- 롤백 = 3테이블 DROP + 인덱스 DROP + 5컬럼 DROP COLUMN(SQLite 3.35+). 단 §3.5의 순서를 지킨다.

-- AlterTable
ALTER TABLE "chatbots" ADD COLUMN "prodVersionId" TEXT;
ALTER TABLE "conversation_logs" ADD COLUMN "servedVersionId" TEXT;
ALTER TABLE "test_runs" ADD COLUMN "targetKind" TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "test_runs" ADD COLUMN "targetVersionId" TEXT;
ALTER TABLE "test_runs" ADD COLUMN "targetVersionNo" INTEGER;
CREATE INDEX "test_runs_chatbotId_targetVersionId_idx" ON "test_runs"("chatbotId", "targetVersionId");

-- CreateTable
CREATE TABLE "chatbot_environments" (
    "chatbotId" TEXT NOT NULL PRIMARY KEY,
    "stagingVersionId" TEXT,
    "enabledAt" DATETIME,
    "enabledById" TEXT,
    "enabledByEmail" TEXT,
    "gateMode" TEXT NOT NULL DEFAULT 'WARN',
    "gateTestSetId" TEXT,
    "gateMinPassRate" INTEGER NOT NULL DEFAULT 95,
    "gateValidHours" INTEGER NOT NULL DEFAULT 24,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chatbot_environments_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "environment_switch_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "fromVersionId" TEXT,
    "fromVersionNo" INTEGER,
    "toVersionId" TEXT,
    "toVersionNo" INTEGER,
    "toVersionCapturedAt" DATETIME,
    "deployScheduleId" TEXT,
    "disableMode" TEXT,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "environment_switch_logs_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "environment_switch_logs_chatbotId_environment_createdAt_idx" ON "environment_switch_logs"("chatbotId", "environment", "createdAt");

CREATE TABLE "embedding_text_vectors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "dimension" INTEGER NOT NULL,
    "vector" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "embedding_text_vectors_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "embedding_text_vectors_chatbotId_modelId_textHash_key" ON "embedding_text_vectors"("chatbotId", "modelId", "textHash");
```

- **인덱스 이름**은 Prisma 명명 규칙과 같게 둔다(이후 `migrate dev`가 드리프트로 보지 않는다).
- **적용 후 확인(배포 체크리스트)**: ① `SELECT name FROM sqlite_master WHERE type='index' AND name IN ('test_runs_chatbotId_active_key','deploy_schedules_chatbotId_scheduledAt_active_key','deploy_schedules_chatbotId_running_key','handoff_sessions_active_key')` = **4행** ② 새 테이블 3개·인덱스 3개 존재 ③ `SELECT COUNT(*) FROM chatbots WHERE prodVersionId IS NOT NULL` = 0(모드 꺼짐 기본) ④ `PRAGMA foreign_key_check` 0행.
- **소요·잠금**: `ADD COLUMN`(NULL·상수 기본값)은 SQLite에서 스키마 텍스트만 바꾸는 O(1)이다. `CREATE INDEX test_runs(...)`는 실행 행 수(세트당 20+5 보존)에 비례해 작다. **100만 로그 행 DB에서 전체 소요를 실측해 `docs/05-ops/자동배포.md`에 기록**하며 API 중지 상태에서 적용한다.
- **통합 시험은 `prisma migrate deploy`**로 스키마를 만든다(CLAUDE.md 규약 — 부분 유니크 포함 실제 스키마).
- **백필 없음**: 기존 행은 전부 "모드 꺼짐·라이브 서빙·초안 대상 실행"이 사실이다(`prodVersionId`·`servedVersionId` null, `targetKind` `DRAFT`). 보존 저장소는 0행에서 시작하며 모드를 켤 때 채워진다(§8.4).

### 3.3 seed

**변경 없음.** 데모 챗봇은 모드 꺼짐(기능 기본값)으로 두고, 시연은 콘솔에서 켠다. seed가 환경 행·포인터를 만들지 않으므로 기존 데모 시험·통계가 바뀌지 않는다.

### 3.4 환경변수 — **2개(전부 선택 · 기본값 · 기동 조건 아님, FR-0-159)**

| 변수 | 기본 | 범위 | 용도 |
|---|---|---|---|
| `ENV_PROD_HISTORY_PROTECTED` | `5` | 1~20 | 보존 정리·수동 삭제에서 보호하는 **직전 운영 버전 수**(롤백 후보) |
| `ENV_VERSION_BUNDLE_CACHE_MAX` | `50` | 10~500 | 버전 코어 L1·합성 L2 캐시 각각의 항목 상한(챗봇 × 버전) |

기능 스위치는 환경변수가 아니라 **챗봇별 모드**(`chatbot:deploy`)다.

### 3.5 배포 순서 · 롤백

1. (커밋 ①) 마이그레이션 ① → API 배포 — 관측 응답 불변(기존 시험 전부 통과가 게이트).
2. (커밋 ②) 마이그레이션 ② → API 배포 → 콘솔 배포(순서 무관 — 모드 꺼진 챗봇은 모든 응답이 바이트 동일하고, 구버전 콘솔은 새 경로를 부르지 않는다). 위젯 배포 없음.
3. **롤백**: 콘솔 → API 순. **모드가 켜진 챗봇이 있으면 API 롤백 전에 전부 끈다**(구버전 API는 `prodVersionId`를 모르므로 초안을 서빙한다 — 끄기의 "운영 유지"로 초안을 운영 버전에 맞춘 뒤 롤백하면 사용자 응답이 바뀌지 않는다). 스키마 롤백은 이력·보존 저장소 DROP이 가능하지만 기본 절차는 "API 롤백까지, 스키마 유지"다(새 컬럼·테이블은 구버전 API에 무해).

---

## 4. shared-types 스키마

### 4.1 `bundle-target.ts`(신설 — zod만 의존) · `environment.ts`(신설)

```ts
// bundle-target.ts — conversation.ts·validation.ts·environment.ts가 공유(순환·위젯 반입 없음)
export const BundleTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('DRAFT') }),
  z.object({ kind: z.literal('STAGING') }),
  z.object({ kind: z.literal('PROD') }),
  z.object({ kind: z.literal('VERSION'), versionId: z.string().uuid() }),
]);
export type BundleTarget = z.infer<typeof BundleTargetSchema>;
/** 응답 에코(비초안 대상일 때만 싣는다). */
export const ResolvedBundleTargetSchema = z.object({
  kind: z.enum(['STAGING', 'PROD', 'VERSION']),
  versionId: z.string().uuid(),
  versionNo: z.number().int().positive(),
  legacyTiebreak: z.boolean(),
  semanticMissing: z.number().int().nonnegative(),
});

// environment.ts
export const EnvironmentKind = z.enum(['DRAFT', 'STAGING', 'PROD']);
export const EnvironmentSwitchMethod = z.enum(['INIT', 'PROMOTE', 'IMMEDIATE', 'SCHEDULED', 'ROLLBACK', 'DISABLE']);
export const EnvironmentDisableMode = z.enum(['KEEP_PROD', 'PROMOTE_DRAFT']);
export const EnvironmentGateMode = z.enum(['WARN', 'BLOCK']);
export const ENVIRONMENT_LIMITS = { reasonMaxCodePoints: 200, historyPageSizeDefault: 20, historyPageSizeMax: 100,
  gateMinPassRateMin: 0, gateMinPassRateMax: 100, gateValidHoursMin: 1, gateValidHoursMax: 168 } as const;

export const EnvironmentVersionRefSchema = z.object({
  versionId: z.string().uuid(), versionNo: z.number().int().positive(),
  capturedAt: z.coerce.date(), label: z.string().nullable(),
});

export const EnvironmentGateSettingsSchema = z.object({
  mode: EnvironmentGateMode, testSetId: z.string().uuid().nullable(),
  minPassRate: z.number().int().min(0).max(100), validHours: z.number().int().min(1).max(168),
});
/** PUT 본문 — BLOCK이면 testSetId 필수(superRefine). */
export const UpdateEnvironmentGateSchema = EnvironmentGateSettingsSchema;

export const GateEvaluationSchema = z.object({
  verdict: z.enum(['PASS', 'WARN', 'BLOCK']),
  reason: z.enum(['PASSED', 'NO_RUN', 'BELOW_THRESHOLD', 'EXPIRED', 'MODEL_CHANGED', 'SET_MISSING', 'NOT_CONFIGURED']).optional(),
  run: z.object({ runId: z.string().uuid(), setId: z.string().uuid(), setName: z.string(), passRate: z.number().min(0).max(1),
    finishedAt: z.coerce.date() }).nullable(),
});

export const EnvironmentStatusSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false), gate: EnvironmentGateSettingsSchema.nullable() }),
  z.object({
    enabled: z.literal(true),
    enabledAt: z.coerce.date(),
    prod: EnvironmentVersionRefSchema.extend({ switchedAt: z.coerce.date(), legacyTiebreak: z.boolean(),
      readFailed: z.boolean(), semanticPending: z.number().int().nonnegative() }),
    staging: EnvironmentVersionRefSchema.extend({ legacyTiebreak: z.boolean(), semanticPending: z.number().int().nonnegative() }).nullable(),
    draft: z.object({ contentHash: z.string(), sameAsProd: z.boolean(), sameAsStaging: z.boolean() }),
    gate: EnvironmentGateSettingsSchema,
    activeSwitchSchedule: z.object({ scheduleId: z.string().uuid(), scheduledAt: z.coerce.date(),
      targetVersionNo: z.number().int().positive(), status: z.enum(['PENDING', 'HELD']) }).nullable(),
  }),
]);

export const EnableEnvironmentPreviewResponseSchema = z.object({
  draftContentHash: z.string(),
  version: z.discriminatedUnion('action', [
    z.object({ action: z.literal('REUSE'), versionId: z.string().uuid(), versionNo: z.number().int().positive() }),
    z.object({ action: z.literal('CREATE') }),
  ]),
  heldRestoreSchedules: z.number().int().nonnegative(),
  blockers: z.array(z.enum(['CHATBOT_ARCHIVED', 'RESTORE_IN_PROGRESS', 'SCHEDULE_RUNNING', 'ALREADY_ENABLED'])),
});
export const EnableEnvironmentSchema = z.object({ expectedDraftHash: z.string().regex(/^[0-9a-f]{64}$/), reason: MemoSchema.optional() });

export const DisableEnvironmentPreviewResponseSchema = z.object({
  prod: EnvironmentVersionRefSchema, draftContentHash: z.string(), prodContentHash: z.string(),
  draftDiffersFromProd: z.boolean(), diffSummary: VersionDiffSummarySchema,
  cancelledSwitchSchedules: z.number().int().nonnegative(),
  potentialTieShift: z.boolean(),        // 동점 노드가 있어 "운영 유지" 후 라이브 동점 승자가 달라질 수 있음(§27 L-6)
});
export const DisableEnvironmentSchema = z.object({
  mode: EnvironmentDisableMode, expectedProdVersionId: z.string().uuid(),
  expectedDraftHash: z.string().regex(/^[0-9a-f]{64}$/), reason: MemoSchema.optional(),
});

export const PromoteToStagingSchema = z.object({
  expectedStagingVersionId: z.string().uuid().nullable(),
  label: z.string().trim().min(1).max(50).optional(), memo: z.string().trim().min(1).max(500).optional(),
});
export const PromoteToStagingResponseSchema = z.object({
  outcome: z.enum(['CREATED', 'REUSED', 'NOOP']), staging: EnvironmentVersionRefSchema,
  previousStagingVersionNo: z.number().int().positive().nullable(),
});

export const ProdSwitchWarningSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('GATE_WARN'), gate: GateEvaluationSchema }),
  z.object({ code: z.literal('LEGACY_TIEBREAK') }),
  z.object({ code: z.literal('SEMANTIC_INDEX_PENDING'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('CONTEXT_FLOWS_AFFECTED'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('TOPIC_EXPOSURE_CHANGE'), exposed: z.number().int().nonnegative(), hidden: z.number().int().nonnegative() }),
  z.object({ code: z.literal('TOPIC_MISSING'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('SURVEY_MISSING'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('SURVEY_NOT_OPEN'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('API_CONNECTION_MISSING'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('API_CONNECTION_DISABLED'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('PROFILE_WILL_CHANGE'), fields: z.array(z.string()) }),
  z.object({ code: z.literal('OLDER_THAN_DRAFT') }),
]);
export const ProdSwitchPreviewSchema = z.object({ kind: z.enum(['SWITCH', 'ROLLBACK']), targetVersionId: z.string().uuid().optional() });
export const ProdSwitchPreviewResponseSchema = z.object({
  kind: z.enum(['SWITCH', 'ROLLBACK']),
  current: EnvironmentVersionRefSchema, target: EnvironmentVersionRefSchema,
  expectedProdVersionId: z.string().uuid(),
  outcome: z.enum(['SWITCHABLE', 'NOOP']),
  diffSummary: VersionDiffSummarySchema,            // No.25 차이 서비스(버전 ↔ 버전) 재사용
  gate: GateEvaluationSchema,
  blockers: z.array(z.enum(['TARGET_NOT_ALLOWED', 'GATE_BLOCKED', 'GATE_CONFIG_ERROR', 'TARGET_UNREADABLE', 'CHATBOT_ARCHIVED', 'ENV_MODE_DISABLED'])),
  warnings: z.array(ProdSwitchWarningSchema),
});
export const ProdSwitchSchema = z.object({
  targetVersionId: z.string().uuid(), expectedProdVersionId: z.string().uuid(),
  acknowledgeWarnings: z.boolean().optional(), reason: MemoSchema.optional(),
});
export const ProdRollbackSchema = ProdSwitchSchema.extend({ targetVersionId: z.string().uuid().optional() }); // 생략 = 직전 운영 버전
export const ProdSwitchResponseSchema = z.object({
  outcome: z.enum(['APPLIED', 'NOOP']), prod: EnvironmentVersionRefSchema, fromVersionNo: z.number().int().positive(),
  semanticPending: z.number().int().nonnegative(),
});

export const EnvironmentSwitchLogItemSchema = z.object({
  id: z.string().uuid(), environment: z.enum(['STAGING', 'PROD']), method: EnvironmentSwitchMethod,
  fromVersionNo: z.number().int().positive().nullable(), toVersionNo: z.number().int().positive().nullable(),
  toVersionId: z.string().uuid().nullable(), deployScheduleId: z.string().uuid().nullable(),
  disableMode: EnvironmentDisableMode.nullable(), actorEmail: z.string().nullable(), reason: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export const EnvironmentHistoryQuerySchema = PaginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(20), environment: EnvironmentKind.exclude(['DRAFT']).optional(),
});

/** 버전 목록·상세의 환경 배지(포인터·이력 파생 — 라벨과 무관). FE/BE 공용 순수 함수. */
export const EnvironmentBadge = z.enum(['PROD', 'STAGING', 'PROD_HISTORY']);
export function deriveEnvironmentBadges(versionId: string, ctx: { prodVersionId: string | null; stagingVersionId: string | null;
  prodHistoryIds: ReadonlySet<string> }): EnvironmentBadge[] { /* 순서 고정: PROD → STAGING → PROD_HISTORY(현재 운영 제외) */ }

/** 학습 큐 "운영 미반영" 판정(§15.1) — 순수 함수, now 무관. */
export function judgeProdReflection(input: { resolvedAt: Date;
  prodSwitchesDesc: ReadonlyArray<{ at: Date; toVersionCapturedAt: Date | null }> }):
  { status: 'PENDING_SWITCH' } | { status: 'REFLECTED'; reflectedAt: Date } { /* §15.1 */ }
export function shouldShowRecurredAfterApply(input: { recurredCount: number; lastOccurredAt: Date;
  reflection?: { status: 'PENDING_SWITCH' } | { status: 'REFLECTED'; reflectedAt: Date } }): boolean { /* §15.1 */ }
```

### 4.2 기존 스키마 확장 (전부 선택 필드·값 추가 — 하위 호환)

| 파일 | 변경 |
|---|---|
| `version.ts` | `ChatbotVersionTrigger` += `ENV_INIT`('환경 분리 시작(자동)')·`PROMOTE`('스테이징 승격') · `VersionTriggerGroup` += `ENVIRONMENT`(= `['ENV_INIT','PROMOTE']`) · `ChatbotSnapshotEnvelopeSchema` += `tiebreak: z.object({ nodeUpdatedAt: z.record(z.string()) }).optional()`(★ 발견 제약 ② — 없으면 strip으로 소실) · `ChatbotVersionListItemSchema` += `environmentBadges: z.array(EnvironmentBadge).optional()`(모드 켜짐일 때만) · `RestoreWarningSchema` += `{ code:'ENV_DRAFT_ONLY', prodVersionNo, stagingVersionNo: nullable }` |
| `deploy-schedule.ts` | `DeployScheduleAction` += `SWITCH_PROD_VERSION`('운영 버전 전환') · `SwitchProdVersionParamsSchema = { targetVersionId, expectedProdVersionId }` · `CreateDeployScheduleSchema`/`PreviewDeployScheduleSchema` 유니온 += `{ action:'SWITCH_PROD_VERSION', targetVersionId, previewedProdVersionId(생성만), acknowledgeWarnings? }` · **`DeploySchedulePreconditionReason` += `SWITCH_BLOCKED`**(`RESTORE_BLOCKED` 선례 — §11.2) · `DeployScheduleHeldReason` += `ENV_MODE_CHANGED` · `DeployScheduleFailureReason` += `GATE_NOT_PASSED` · `DeployScheduleResultSummarySchema` += `{ kind:'SWITCH_PROD', fromVersionNo, toVersionNo, postRunTest? }` · `ReadinessWarningSchema` += `{ code:'ENV_DRAFT_ONLY' }` · `DeploySchedulePreviewResponseSchema` += `switchProd?: { base: CURRENT｜SCHEDULE, targetVersion, gate, blockers, warnings }` · `DeployScheduleDetailSchema.params` 유니온 += 새 params · `DeployScheduleListItem.targetVersionId` 주석 "RESTORE_VERSION·SWITCH_PROD_VERSION" |
| `validation.ts` | `StartTestRunRequestSchema` += `target: BundleTargetSchema.optional()`(없음 = DRAFT, superRefine: 오버레이 + 비초안 = 오류) · `TestRunSchema` += `target: ResolvedBundleTargetSchema.optional()`(비초안 실행만) · `TestRunEnvFingerprintSchema` += `target: ResolvedBundleTargetSchema.extend({ contentHash }).optional()` · 순수 함수 `computePassRate(summaryA)` |
| `conversation.ts` | `SimulateRequestSchema` += `target: BundleTargetSchema.optional()` · `SimulateResponseSchema` += `target: ResolvedBundleTargetSchema.optional()` · **`CompareRequestSchema`·공개 요청/응답 스키마 무변경** |
| `learning.ts` | `UnansweredQuestionListItemSchema` += `prodReflection: z.discriminatedUnion(…PENDING_SWITCH｜REFLECTED…).optional()` · 부정 평가 상세의 대상 += `deletedInDraft: z.literal(true).optional()`·`nameFromVersion: z.string().optional()` |
| `security.ts` | `Permission` += `chatbot:deploy`(17 → 18) · `ROLE_PERMISSIONS.ADMIN` += `chatbot:deploy` |
| `audit.ts` | `AuditTargetType` += `ChatbotEnvironment`('환경') · `AUDIT_TARGET_ROUTE.ChatbotEnvironment`(경로는 ui-designer 확정) · **`AuditAction` 추가 0** |
| `common.ts` | `ApiErrorCode` 8종(§19.3) |

> 모든 새 응답 필드는 **값이 있을 때만 키를 싣는다**(`feedback`·`pendingAnswer` 선례) — 모드 꺼진 챗봇·초안 대상 요청의 응답 바이트가 바뀌지 않는다(FR-0-150).

---

## 5. 환경 모드 켜기 · 끄기 (FR-EN1-\* · P-6 · P-8 · C-4)

### 5.1 상태 모델

```
            enable (chatbot:deploy)                        disable (chatbot:deploy)
 꺼짐  ─────────────────────────────▶  켜짐  ─────────────────────────────▶  꺼짐
 prodVersionId = null                 prodVersionId = vP                   prodVersionId = null
 env 행 없음/enabledAt null            env.stagingVersionId = vS, enabledAt   env.stagingVersionId = null, enabledAt = null(게이트 보존)
```

- **판정 단일 소스 = `Chatbot.prodVersionId`**. 환경 행은 스테이징·게이트·메타 저장소다. 불변식(`prodVersionId ≠ null ⇒ 행 존재 ∧ enabledAt ≠ null`)은 쓰기 파일이 1개라 한 트랜잭션에서만 성립·해제된다.
- `ARCHIVED` 챗봇은 켜기·끄기·승격·전환·게이트 설정 전부 `409 CHATBOT_ARCHIVED`(`assertWritable`). 상태 조회는 허용. `DRAFT` 챗봇은 켤 수 있다(공개 판정 불변 — FR-EN1-5). 보관 후 복귀(`DRAFT`)하면 포인터가 그대로라 재개된다(EX-EN-19).
- 챗봇 복사·토픽 분리는 `prodVersionId`를 복사하지 않는다 — 두 경로 모두 컬럼을 명시 나열한다(`chatbots.service.ts#copy` 253~261행 · 분리 적재기). 새 챗봇은 꺼짐(FR-EN1-7 — 코드 변경 0, 정적 검사 E-1이 두 경로에 `prodVersionId` 0건을 단언).

### 5.2 켜기 미리보기 `POST …/environment/enable/preview` (DB 변경 0)

`captureSnapshotData()`(읽기 트랜잭션 1회) → 최신 버전 메타(`contentHash`·`tiebreakHash`) 비교 → 활성 `RESTORE_VERSION` `PENDING` 예약 수 → 차단 사유(보관·복원 잠금·RUNNING 예약·이미 켜짐). 응답의 `draftContentHash`를 확정 요청의 `expectedDraftHash`로 돌려받는다(미리보기 이후 편집 감지).

### 5.3 켜기 확정 `POST …/environment/enable` — 한 트랜잭션

```
① 사전(트랜잭션 밖): assertWritable · restoreLock.isLocked → 409 ENV_SWITCH_BUSY · RUNNING 예약 존재 → 409 ENV_SWITCH_BUSY
② prisma.$transaction(tx):                                      (tx 콜백 안 Promise.all 금지 — 순차 await)
   a. chatbot 재조회(status·prodVersionId) — ARCHIVED 409 · prodVersionId ≠ null → 409 ENV_MODE_ALREADY_ENABLED
   b. captured = versionCapture.readConsistent(chatbotId, tx)      ← 캡처는 같은 트랜잭션(편집 끼어들기 차단)
   c. data = versionCapture.computeFromCaptured(captured, now)
   d. data.contentHash ≠ dto.expectedDraftHash → 409 ENV_POINTER_STALE("미리보기 이후 초안이 바뀌었습니다")
   e. latest = 최신 버전 메타(versionNo desc 1행: id·contentHash·tiebreakHash)
      plan = decideEnvInitVersion({ latest, captured: { contentHash, tiebreakHash } })
        REUSE ⇔ latest ∧ latest.contentHash = data.contentHash ∧ latest.tiebreakHash ≠ null ∧ latest.tiebreakHash = data.tiebreakHash
        그 외 CREATE → versionCapture.persistWithin(tx, chatbotId, data, { trigger: 'ENV_INIT' })
   f. writer.enable(tx, { chatbotId, versionRow, actor, reason })
        - tx.chatbot.updateMany({ where: { id, prodVersionId: null }, data: { prodVersionId: v.id } }) → count 0이면 409 ENV_MODE_ALREADY_ENABLED
        - tx.chatbotEnvironment.upsert(… stagingVersionId: v.id, enabledAt, enabledBy*)
        - tx.environmentSwitchLog.create × 2(PROD·STAGING, method INIT, to = v, toVersionCapturedAt = v.createdAt)
   g. hooks.holdRestoreForEnvModeChange(tx, chatbotId, now)     ← P-8 · C-4 (§11.6) → heldCount
③ 커밋 후(동기): textVectors.pin(chatbotId, 버전 슬롯)의 "복사 단계"(§8.4) · retention.pruneBestEffort(CREATE였으면)
   · audit STATUS_CHANGE(ChatbotEnvironment, enabled false→true, summary: v번호·보류 예약 n건) · versionBundles.warm(chatbotId, v.id)
④ BUSY(P2034·SQLITE_BUSY) → 409 ENV_SWITCH_BUSY(재시도 가능 — RESTORE_BUSY 선례)
```

- **★ 발견 제약 ③ — 재사용 조건에 `tiebreakHash`**: "해시 같으면 최신 버전 재사용"만으로는, 노드를 편집했다 되돌려 `contentHash`는 같고 `updatedAt`만 다른 상태에서 **동점 승자가 바뀐 과거 버전**이 운영이 될 수 있다(AC-EN1-2 위반). 보조 필드가 없는 과거 버전(`tiebreakHash` null)도 재사용하지 않는다. 대가는 버전 1개 추가뿐이다.
- **진행 중 작업(EX-EN-11)**: 켜기는 **자산을 쓰지 않으므로** 진행 중 `TrainingJob`·`TestRun`과 무관하게 허용한다(복원의 `ACTIVE_JOB` 차단은 자산 쓰기 때문이다). 진행 중 TC는 계속 초안 대상으로 끝난다.
- **켜기 직후 응답 불변(AC-EN1-2)의 근거**: 운영 = 캡처 직전 초안과 같은 자산·같은 `updatedAt`·같은 배열 순서(§6)·같은 답변 설정·같은 벡터(§8 — 캡처 시점 초안 벡터와 같은 `textHash`로 조립) · 같은 설문·토픽 필터(현재 값). 다른 점은 표시 설정의 `getConfig()` 출처뿐이며 값은 같다.

### 5.4 끄기 — 미리보기 → (필요 시 콘솔의 기존 복원) → 확정 (FR-EN1-3 · FR-0-154)

- **미리보기** `POST …/disable/preview`(DB 변경 0): 운영 버전 · 초안 해시 · 운영 해시 · 차이 요약(No.25 `VersionDiffService`, 초안 ↔ 운영 버전) · 취소될 활성 전환 예약 수 · 동점 이동 가능성(`potentialTieShift`).
- **콘솔 흐름**(권고 기본 = "운영 유지"):
  1. `draftDiffersFromProd = false` → 선택 없이 확인만 → `disable({ mode: 'KEEP_PROD', … })`.
  2. "운영 유지"(`KEEP_PROD`) + 초안 ≠ 운영 → 콘솔이 **기존 복원 API**(`POST …/versions/:prodVersionId/restore/preview` → `restore`)를 호출한다. 복원은 `BEFORE_RESTORE` 백업으로 초안 변경을 보존하고 사후 검증으로 초안 해시 = 운영 해시를 보장한다. 그다음 `disable({ mode:'KEEP_PROD', expectedDraftHash: 복원 응답의 contentHash })`.
  3. "초안을 운영으로"(`PROMOTE_DRAFT`) → 차이 확인 후 `disable({ mode:'PROMOTE_DRAFT', expectedDraftHash: 미리보기 값 })` — 끄는 순간 초안이 라이브가 된다.
- **확정** `POST …/disable` — 한 트랜잭션: 재조회 → 모드 꺼짐 `409 ENV_MODE_DISABLED` → `prodVersionId ≠ expectedProdVersionId` → `409 ENV_POINTER_STALE` → 초안 해시 재계산(`readConsistent(tx)` + `computeFromCaptured`) ≠ `expectedDraftHash` → `409 ENV_POINTER_STALE` → `decideDisable()`: `KEEP_PROD`인데 초안 해시 ≠ 운영 버전 `contentHash` → **`409 ENV_DRAFT_NOT_RESTORED`**(콘솔이 2단계를 다시 수행) → `writer.disable(tx)`(`prodVersionId` CAS → null · `stagingVersionId`·`enabledAt` null · 이력 1행 `PROD/DISABLE`·`disableMode`) → `hooks.cancelSwitchForEnvDisable(tx, chatbotId, actor, now)`(활성 `SWITCH_PROD_VERSION` → `CANCELLED`, 건수 반환). RUNNING 전환 예약이 있으면 `409 ENV_SWITCH_BUSY`.
- **커밋 후**: `textVectors.purgeChatbot(chatbotId)`(보존 저장소 전부 삭제 — 모드 꺼진 챗봇 0행 불변식) · L1/L2 캐시 해당 챗봇 제거 · 감사 `STATUS_CHANGE`(true→false, summary: 방식·취소 예약 n건).
- **결과**: `restore()`의 **세 번째 호출부를 만들지 않는다**(FR-0-154 · D-3 = 2파일 유지). 이력·버전·로그의 `servedVersionId`는 남는다. 게이트 설정은 환경 행에 남아 다시 켜면 그대로 적용된다.
- ⚠ `KEEP_PROD`의 사후 상태는 **해시 동일**이지 **동점 `updatedAt` 동일**은 아니다 — 복원이 바뀐 행의 `updatedAt`을 복원 시각으로 쓴다(ADR-0031 §3 차이 적용). 끈 뒤 라이브 동점 승자가 끄기 직전 운영과 다를 수 있는 창은 "동점 노드가 있고 그 노드가 복원으로 갱신된 경우"뿐이며 미리보기가 `potentialTieShift`로 경고한다(§27 L-6).

---

## 6. ★ C-1 동점 일치 — 해시 밖 보조 필드 + 서빙 역직렬화 (FR-EN2-4)

### 6.1 봉투 형식 (스키마 버전 1 유지 · 업캐스터 불필요)

```jsonc
{
  "schemaVersion": 1, "capturedAt": "…", "chatbotId": "…",
  "assets": { … },                 // contentHash 범위 — 불변
  "answerSetting": { … }, "profile": { … },
  "tiebreak": { "nodeUpdatedAt": { "<nodeId>": "2026-09-25T01:02:03.456Z", … } }   // [신규] 해시 밖 · 선택
}
```

- **해시 호환**: `canonicalizeSnapshot()`은 `assets`·`answerSetting`·`profile`만 본다(`snapshot-canonical.ts` 87~110행). 최상위 새 키는 **해시 범위 밖**이므로 기존·신규 스냅샷의 `contentHash` 규칙이 같고, 영구 픽스처 `snapshot-v1.json`·골든 해시 시험은 무수정 통과한다. `SNAPSHOT_SCHEMA_VERSION = 1` 유지(선택 필드 — `topicId` 선례).
- **캡처**: `buildSnapshotEnvelope()`가 `bundle.dialogNodes`의 `updatedAt`(라이브 값, `stripIdentity` **전**)을 `tiebreak.nodeUpdatedAt`에 담는다. 노드만 담는 이유: 엔진이 `updatedAt`을 읽는 곳은 `rankNodes`(`node-matcher.ts` 98행) 1곳뿐이다. 엔진이 다른 자산의 `updatedAt`을 쓰기 시작하면 이 맵에 종류를 추가한다(재검토 트리거 — ADR-0039).
- **저장**: `serializeEnvelopeForStorage()`가 `tiebreak`가 있으면 포함한다(정규 정렬 `sortKeysDeep`). `sizeBytes`는 노드당 약 70바이트 증가한다(노드 1,000개 ≈ 70KB — 20MB 상한 대비 무시 가능).
- **★ 발견 제약 ② — 파싱 소실**: `ChatbotSnapshotEnvelopeSchema`가 `z.object`(기본 strip)라 선언하지 않은 최상위 키는 `loadStrict()`(45행) 단계에서 **사라진다**. 스키마에 `tiebreak` 선택 필드를 선언한다(§4.2). 복원·차이는 `tiebreak`를 읽지 않으므로 의미론 불변.
- **`tiebreakHash`**: `sha256(stableStringify(tiebreak.nodeUpdatedAt))` — `computeFromCaptured()`가 계산하고 `persistWithin()`이 메타에 저장한다(모든 캡처 경로 — 수동·자동 4종·`BEFORE_RESTORE`·`ENV_INIT`·`PROMOTE`). 목록·재사용 판정이 본문을 읽지 않게 하는 비정규화다.

### 6.2 서빙 역직렬화 `hydrateForServing(envelope, chatbotId)` (신규 순수 함수 · `versions/lib/snapshot-serving.ts`)

```
① base = hydrateSnapshot(envelope, chatbotId)                   // 기존 함수 그대로(복원·무결성 검사 경로 무변경)
② envelope.tiebreak 있음 → 각 노드 updatedAt := new Date(nodeUpdatedAt[node.id] ?? capturedAt) · legacyTiebreak = false
   없음 → updatedAt := capturedAt(기존) · legacyTiebreak = hasPotentialNodeTies(base.bundle.dialogNodes)
③ ★ 6종 배열을 (createdAt asc, id asc)로 재정렬              // 발견 제약 ① — 라이브 build()의 K-1 orderBy 재현
④ 검증: DialogueBundleSchema.safeParse(bundle) 실패 → 손상(§7.6). ★ 서빙에는 파싱 결과가 아니라 ③의 원본 값을 쓴다
   (zod 변환 .trim()/.default()가 섞이면 라이브와 달라진다 — hydrate 주석의 "쓰기에는 원본 값" 규칙과 같은 이유)
⑤ 반환: { bundle(설문 없음), answerSetting(null이면 호출자가 defaultAnswerSetting), profile, legacyTiebreak }
```

- **★ 발견 제약 ① — 배열 순서**: 스냅샷 본문은 `toCanonicalComparable()`이 **`id asc`**로 정렬해 저장한다(64~74행). 라이브 번들은 K-1 이후 **`createdAt asc, id asc`**다(`dialogue-bundle.service.ts` 125행). 의도(`matchIntent` 55행)·FAQ(`matchFaqEntry` 37행)·예문 인덱스는 **동점이면 먼저 본 항목**이 이기므로, `updatedAt`만 복원하면 노드 동점은 맞아도 의도·FAQ 동점은 틀릴 수 있다. `createdAt`은 스냅샷에 보존되므로(ADR-0031 §1) 재정렬로 정확히 재현된다(`createdAt` 동률은 `id asc` — 라이브와 같은 2차 키).
- **순서 무관 확인**: 노드의 `intentIds`/`keywordIds`는 본문에서 정렬되지만 엔진은 `includes`·`some`·길이만 본다(`node-matcher.ts` 32~81행) — 순서 무관. 의도 `examples`·FAQ `altQuestions`는 값 배열 순서가 보존된다(ADR-0031 §2 "값 배열 순서 유지").
- **`hasPotentialNodeTies(nodes)`**: 활성 노드 중 `(priority, 조건 수, matchMode)`가 같은 쌍이 있으면 true — 과거 스냅샷에서 **실제로 승자가 달라질 수 있을 때만** `LEGACY_TIEBREAK`를 띄운다(동점 없는 챗봇에 소음 경고 0).
- **동치 성질(시험의 핵심)**: 라이브 번들 B를 캡처한 봉투 E에 대해 `hydrateForServing(E)`는 엔진 관점에서 B와 같다 — 같은 입력의 `resolveTurn` 결과(매칭 id·아웃풋·trace·다음 상태)가 동일하다. 단위 시험은 동점 노드·동점 의도 예문·동점 FAQ·다국어/이모지 픽스처(EX-EN-21)로 이 성질을 고정한다(§24.1).

### 6.3 과거 스냅샷(보조 필드 없음) 처리

| 상황 | 동작 |
|---|---|
| 운영·스테이징 전환 대상 · 시뮬레이터/TC 대상 | 서빙 허용 · `legacyTiebreak = hasPotentialNodeTies` · 동점은 `id asc`(EX-EN-7) |
| 전환 미리보기 | `LEGACY_TIEBREAK` 경고(blocker 아님) |
| 켜기·승격의 "재사용" | **금지**(`tiebreakHash` null) — 새 버전을 캡처한다(§5.3) |
| 롤백 대상이 과거 스냅샷 | 허용 + 경고(긴급 복귀 우선) |

---

## 7. ★ C-3 번들 소스 · 캐시 · 조립 (FR-EN2-1~3·5 · NFR-ENM1)

### 7.1 소비자별 소스 — 명시 인자

소스는 판별 유니온 `BundleSource = { kind: 'DRAFT' } | { kind: 'VERSION'; versionId }` 1개다. **초안 경로는 기존 코드를 한 글자도 바꾸지 않고**, 버전 경로만 새 서비스를 부른다 — 모드 꺼진 챗봇·초안 대상 요청의 호출 순서·인자·쿼리 수가 같다.

| # | 소비자 (파일:행) | 소스 결정 | 초안 경로 | 버전 경로 |
|---|---|---|---|---|
| 1 | 공개 대화 `sendMessage`(`public-conversation.service.ts` 166~167) | `bundleSourceOf(chatbot)` — `access.resolve()`가 이미 읽은 행의 `prodVersionId`(**추가 조회 0**) | `getCached(id)` → `answerSettingsCache.get(id)`(현행 순서) | `versionBundles.get(id, vP, { topics: 'ACTIVE_ONLY' })` |
| 2 | 시뮬레이터 대화 `simulate`(`simulation.service.ts` 90~92·103) | `dto.target`(없음 = DRAFT) | 현행(`includeInactiveTopics`로 `getCached`/`getCachedUnfiltered`) | STAGING/PROD는 환경 행·챗봇 행 조회(+1 — 대상 지정 시만) 후 `versionBundles.get(…, { topics: includeInactiveTopics ? 'ALL' : 'ACTIVE_ONLY' })` |
| 3 | 시뮬레이터 비교 `compare`(335~336) | **DRAFT 고정**(오버레이 비교 전용 — FR-EN6-1 "오버레이는 초안만") | 현행 | 없음(요청 스키마에 `target` 없음) |
| 4 | TC 실행 A측(`test-run.executor.ts` 144·146·187) | 실행 행 `targetKind`/`targetVersionId`(시작 시 해석·저장) | 현행 | `versionBundles.get(…, 'ACTIVE_ONLY')` + 버전 설정 + `VersionVectorResolver` |
| 5 | 상담 응답힌트 `compute`(`handoff-hints.service.ts` 86~87) | `getHints()`의 `assertReadable()` 반환 `?.prodVersionId`(select 1컬럼 추가 — **쿼리 수 불변**) | 현행 | 운영 버전 번들·설정·벡터(FR-EN8-6) |
| 6 | 답변 설정 미리보기(`answer-settings.service.ts` 71·77) | **DRAFT 고정**(편집 중 설정의 미리보기) | 현행 | 없음 |

- **공개 경로의 선택 지점 1곳**: `PublicConversationService.loadServing(chatbot)` private 메서드만 `bundleSourceOf(`·`getCached(`·`versionBundles.get(`을 호출한다(정적 검사 E-9 — 각 1회). BLOCK·HANDLED 반환 경로는 번들을 만들지 않으므로 변화 없다(로그 `servedVersionId`만 — §14).
- **호출자 반환형 방어**: `assertReadable()`을 목으로 대체한 기존 단위 시험은 `undefined`를 돌려준다. 소비자는 **`(await this.scope.assertReadable(id))?.prodVersionId ?? null`** 형태로만 읽는다(기존 목 무수정 통과 — §24.2 "무수정 통과").

### 7.2 공개 대화 `loadServing()` 계약

```
loadServing(chatbot) → { bundle, index, settings, semanticSource?, servedVersionId }
  source = bundleSourceOf(chatbot)
  DRAFT   → const { bundle, index } = await bundleService.getCached(chatbot.id)
            const settings = await answerSettingsCache.get(chatbot.id)
            return { bundle, index, settings, semanticSource: undefined, servedVersionId: null }
  VERSION → const s = await versionBundles.get(chatbot.id, source.versionId, { topics: 'ACTIVE_ONLY' })
            return { bundle: s.bundle, index: s.index, settings: s.settings,
                     semanticSource: { kind: 'VERSION', versionId, slots: s.slots }, servedVersionId: versionId }
```

- 이후 파이프라인(설문 예측·의미 점수·`resolveTurn`·API 턴 완결·설문 적재·출구 필터·RAG 판정·`resolveAnsweredTopicId`)은 **받은 번들·설정을 그대로** 쓴다 — 운영 버전 서빙 턴은 RAG 스코프·임계값·폴백 정책도 운영 버전의 것이다(FR-EN2-3).
- `semanticMatch.score(chatbotId, text, bundle, thresholds)` — 초안 경로는 **4인자 그대로**, 버전 경로만 5번째 인자 `semanticSource`를 넘긴다(§8.3).

### 7.3 2층 캐시

| 층 | 키 | 값 | 수명·무효화 | 위치 |
|---|---|---|---|---|
| **L1 코어** | `versionId` | `hydrateForServing` 결과(설문 없는 번들 · 버전 답변 설정(DTO 모양) · 프로필 · `legacyTiebreak` · 의미 슬롯 `deriveSemanticSlots()` · `contentHash`·`versionNo`·`createdAt`) | **TTL 없음**(본문 불변 — FR-0-152) · LRU `ENV_VERSION_BUNDLE_CACHE_MAX` · 버전 삭제·모드 끄기 시 제거 | `environment/serving/version-core.cache.ts` |
| **L2 합성** | `${chatbotId}:${versionId}:${ACTIVE_ONLY｜ALL}` | 코어 + 현재 설문 + 토픽 정규화·비활성 필터 + `buildDialogueIndex` | TTL 60초(`getCached`와 같음) · LRU 같은 상한 · **`DialogueBundleService.invalidate(chatbotId)`가 해당 챗봇 키 전부 제거**(토픽 토글·설문 편집은 이미 `invalidate()`를 부른다 — `topics.service.ts` 133·185, `surveys.service.ts` 154·245·278·322) | `dialogue-common/version-serving-bundle.cache.ts`(무효화 지점 공유를 위해 dialogue-common에 둔다 — 선택 주입, `unfilteredCache` 선례) |

- **초안 캐시와 인스턴스 분리**(ADR-0037 §2 선례) — 운영·초안 항목이 서로를 밀어내지 않는다.
- **초안 편집의 영향**: 초안 편집도 `invalidate()`를 부르므로 L2가 비워진다. 다음 공개 요청은 **L1 적중 + 2쿼리(설문·토픽) + 합성 + 인덱스 구축**만 한다(본문 재파싱 없음). 이것은 현재 초안 편집 후 `getCached`가 8쿼리 + 인덱스를 다시 만드는 것보다 가볍다. 편집 빈도가 높아 문제가 되면 "설문·토픽 전용 무효화"로 나눈다(재검토 트리거).
- **단일 비행(EX-EN-9)**: L1·L2 모두 `Map<key, Promise>`로 같은 키의 동시 미스는 하나의 구축을 기다린다(인스턴스별 1회).
- **예열(NFR-ENP3)**: 켜기·즉시 전환·롤백·예약 전환 커밋 직후 현재 인스턴스에서 `warm(chatbotId, versionId)`를 fire-and-forget으로 호출한다(다른 인스턴스는 첫 요청이 구축 — 수용).
- **포인터는 캐시하지 않는다**(FR-EN2-2): 매 요청 `access.resolve()`가 DB에서 읽으므로 전환 커밋 **다음 요청부터 전 인스턴스**가 새 버전을 쓴다(NFR-ENP2 · AC-EN2-5). 캐시 키에 버전 id가 들어 있어 옛 항목이 새 포인터에 쓰일 수 없다.

### 7.4 합성 `composeServingBundle(core, overlay, topicMode)` (순수)

```
① 토픽 정규화: normalizeSnapshotTopics(코어 봉투 관점, 현재 토픽 id 집합) — 없는 토픽을 가리키는 자산 topicId 제거
   (복원 정규화와 같은 함수·같은 규칙 · 로그 topicId 귀속이 존재하지 않는 토픽 id를 남기지 않게 한다 · EX-EN-5)
② surveys := overlay.surveys(현재 DB — build()와 같은 매핑 헬퍼, loadLiveOverlay)
③ topicMode = ACTIVE_ONLY → filterInactiveTopicAssets(bundle, overlay.disabledTopicIds)   // 기존 순수 함수 재사용(T-2 식별자 불사용)
④ index = buildDialogueIndex(bundle)
```

- **환경 밖 자산은 현재 값이다**(P-9): 설문 정의·토픽 정의/활성(여기), API 연결(엔진 밖 `LegacyApiService`가 호출 시 조회), 상담 설정·자주 쓰는 문장(상담 모듈), 채널 설정·금지어(공개 파이프라인). 콘솔은 해당 편집 화면에 "환경 분리 대상이 아닙니다 — 저장 즉시 운영에 적용"을 표시한다(FR-EN2-7 — §23).
- 운영 버전이 참조하는 설문·API 연결이 없거나 닫혀 있으면 기존 규칙(설문 건너뜀·API 실패 분기)이다(FR-EN2-8) — 엔진·모듈이 이미 처리한다.

### 7.5 `VersionBundleService` 계약

```ts
get(chatbotId: string, versionId: string, opts: { topics: 'ACTIVE_ONLY' | 'ALL' }):
  Promise<{ bundle; index; settings: ChatbotAnswerSetting; profile; slots: SemanticSlot[];
            version: { id; versionNo; contentHash; createdAt; legacyTiebreak } }>
getCore(versionId: string, chatbotId: string): Promise<VersionCore>     // 이름 조회·미리보기·getConfig용(L1만)
warm(chatbotId: string, versionId: string): void                        // fire-and-forget
```

- 버전 소속 검사: 코어 구축 시 `ChatbotVersion.chatbotId ≠ chatbotId` → `404`(NFR-ENS3 — 교차 챗봇 버전은 "없는 것"과 같다).
- 본문 읽기는 **`VersionPayloadReader.loadStrict()`만** 쓴다(해시 재검증·업캐스트 포함 — EX-EN-2). `chatbotVersionPayload` 참조 허용 목록(V-7)은 불변이다.

### 7.6 버전 읽기 실패(EX-EN-1)

- `loadStrict()`가 `VERSION_INTEGRITY_FAILED`·`VERSION_SCHEMA_UNSUPPORTED`를 던지거나 ④ 검증이 실패하면 `ServingVersionUnavailableError`(내부)로 바꾸고 **음성 캐시 30초**(재시도 폭주 방지)에 넣는다.
- **공개 대화**: 초안으로 몰래 대체하지 않는다. BLOCK 경로와 같은 모양으로 **엔진을 호출하지 않고** 기본 폴백 문구(엔진 export `DEFAULT_FALLBACK_RESPONSE`) 1건 + 요청 봉투 보존으로 응답하고, 로그는 `isAnswered: false`·`servedVersionId: vP`로 적재한다. 경고 로그는 챗봇 id·버전 id·오류 코드만 남긴다.
- **시뮬레이터·TC·상담 힌트**: 시뮬레이터는 `422 VERSION_INTEGRITY_FAILED`, TC 실행은 `FAILED(failureReason: TARGET_VERSION_UNREADABLE)`, 힌트는 초안 소스로 대체하지 않고 답변 후보를 비운다(`mode: 'LEXICAL'`, `answers: []` — 자주 쓰는 문장 후보는 기존대로).
- **환경 현황**: `prod.readFailed: true` → 콘솔이 "운영 버전을 읽을 수 없습니다 — 직전 운영 버전으로 되돌리기"를 안내한다.

---

## 8. ★ C-2 의미 색인의 버전 차원 (FR-EN3-\* · AC-EN3-\*)

### 8.1 판단 — 슬롯 테이블을 다시 짜지 않는다

| 후보 | 판정 | 근거 |
|---|---|---|
| (a) `EmbeddingVector` 유일 키를 `(chatbotId, modelId, textHash)`로 교체 + 슬롯 매핑 테이블 | **기각** | 모드 꺼진 챗봇의 색인 경로·재색인 비용·고아 정리·TC 벡터 로드가 전부 바뀐다(NFR-ENP5·FR-EN3-4 위반 위험). 색인기 재작성 = No.18 회귀 범위 |
| (b) 버전별 벡터 테이블(버전 × 슬롯) | 기각 | 버전마다 전량 복제 — 챗봇당 수만 행 × 보호 버전 수. 대부분 초안과 같은 문장 |
| **(c) 슬롯 테이블·색인기 무변경 + 문장 해시 주소 보존 저장소 + "보존 ∪ 초안 같은 해시" 조립** | **채택** | 모드 꺼진 챗봇은 **코드 경로·행 수가 완전히 같다**(보존 저장소 0행 · 색인기 무변경). 버전 벡터는 "같은 정규화 문장 = 같은 벡터"(기존 재사용 키 FR-N1-19의 정의 그대로)로 주소화되어 중복이 없고, 추가 행 = **보호 버전 문장과 초안 문장의 차집합**뿐이다(NFR-ENP5) |

### 8.2 슬롯 · 조립

- **`deriveSemanticSlots(bundle)`**(`embedding/lib/semantic-slots.ts`, 순수): FAQ `question`(slot 0)·`altQuestions[i]`, 의도 `name`(slot 0)·`examples[i]` → `{ ownerType, ownerId, slotIndex, text, textHash: textHashOf(text) }`. **색인기 대상 규칙과 동등**해야 하므로(`indexer.service.ts` 44~57행 — 비활성 FAQ도 포함) 동등성 시험이 같은 픽스처로 두 결과를 비교한다(색인기 코드는 무변경).
- **`VersionVectorResolver.resolve(chatbotId, modelId, slots)`** → `{ entries: AssembleVectorEntry[]; missing: number }`:
  ```
  draft = vectorCache.get(chatbotId, modelId)            // 기존 캐시(항목에 textHash 1필드 추가 — §2.5)
  store = textVectorCache.get(chatbotId, modelId)        // 보존 저장소 맵(TTL 60초, pin 시 무효화) — 쿼리 1(미스 시)
  for slot in slots: vector = store.get(slot.textHash) ?? draftByHash.get(slot.textHash)
                     있으면 entries.push({ ownerType, ownerId, slotIndex, vector }) · 없으면 missing++
  ```
  결과는 `(versionId, modelId, draftStamp, storeStamp)`로 인스턴스 로컬 메모한다(두 캐시의 `cachedAt`이 바뀌면 재계산).
- **점수 조립은 기존 순수 함수 그대로**: `assembleSemanticInput(queryVector, entries, bundle, thresholds, modelId)` — 입력 벡터만 버전 슬롯 기준이 된다. 표시 문장은 버전 번들에서 온다(33~58행 규칙 그대로). **랭킹·타이브레이크 규칙이 두 벌이 되지 않는다**(ADR-0030 §2).
- **`SemanticMatchService.score(chatbotId, text, bundle, thresholds, source?)`**: `source` 미지정 = 현행 경로(초안 벡터 캐시) · `{ kind:'VERSION', versionId, slots }` = 리졸버. 질의 임베딩은 턴당 1회 그대로(`QueryEmbeddingService` 전역 캐시 — 공개·시뮬레이터·힌트 경로, TC는 여전히 실행 로컬 임베딩).
- **왜 초안 벡터로 대체해도 안전한가**: 같은 `textHash` = 같은 정규화 문장 = 색인기가 이미 "재임베딩 불필요"로 취급하는 같은 벡터다. 초안이 그 문장을 **지우거나 바꾸면** 초안 쪽 후보가 사라질 뿐 보존 저장소 쪽 벡터(§8.4 pin)가 남는다. 따라서 **초안 편집·삭제·재색인은 운영 점수를 바꾸지 않는다**(AC-EN3-1).

### 8.3 소비자별 벡터 소스

| 소비자 | 초안 대상 | 버전 대상 |
|---|---|---|
| 공개 대화 · 상담 힌트 · 시뮬레이터 | `vectorCache.get()`(현행) | `score(…, { kind:'VERSION', … })` → 리졸버 |
| TC 실행 | `vectorCache.get()`(현행 `test-run.executor.ts` 187행) | `resolver.resolve(chatbotId, provider.modelId, slots).entries` — **질의는 여전히 실행 로컬 배치 임베딩**(전역 질의 캐시 비오염 — ADR-0030) |

### 8.4 보존(pin) — 추가 임베딩 호출 0

`EmbeddingTextVectorService`(★ `EmbeddingTextVector` 쓰기 유일 파일):

```
pin(chatbotId, modelId, slots[{ textHash, text }]):          // 텍스트는 메모리 인자일 뿐 저장하지 않는다
  ① 복사 단계(동기 · DB만): 보존 저장소에 없는 해시 → 슬롯 테이블에서 같은 (chatbotId, modelId, textHash, READY) 벡터 조회(IN 500청크)
     → createMany(청크 500 · 경합 P2002 시 해당 청크 1회 재조회 후 재시도 — SQLite는 skipDuplicates 미지원)
  ② 임베딩 단계(백그라운드 · 단일 비행 · 챗봇당 1개): ①에서도 없는 해시만 provider.embed(texts, 'PASSAGE') 64개 배치 → createMany
     · provider 없음/실패 → 흡수(경고 로그: 챗봇 id·건수만) · 다음 트리거에서 재시도
  → textVectorCache.invalidate(chatbotId)
retainOnly(chatbotId, keep: Map<modelId, Set<textHash>>):   // GC — 보호 버전 슬롯 해시 합집합 밖 행 deleteMany(현재 모델 외 행 포함)
purgeChatbot(chatbotId): 전부 deleteMany                     // 모드 끄기
```

- **트리거**: 켜기·승격·즉시 전환·롤백·예약 전환 커밋 직후(①은 요청 안에서, ②는 백그라운드) · 환경 현황 조회 시 `semanticPending > 0`이면 ②만 백그라운드 재시도(쿨다운 60초 — 모델 교체 후 자가 복구).
- **추가 임베딩 호출 = 0(정상 경로)**: 버전은 항상 "그 순간의 초안"을 캡처해 만들어지고(켜기·승격), 초안 문장은 편집 시점에 이미 색인됐다(`invalidate()` → 재색인). 복사 단계가 전부 채운다(AC-EN3-2). ②가 실제로 호출되는 경우는 **(i) 캡처 직전 편집의 재색인이 아직 끝나지 않았고 곧바로 그 문장이 다시 바뀐 경합**(재색인이 새 문장만 임베딩하므로 옛 문장 벡터가 영영 생기지 않는다) **(ii) 임베딩 모델 교체**(EX-EN-6) 두 가지뿐이다.
- **준비 중 표시(FR-EN3-3)**: 리졸버의 `missing` = "의미 색인 준비 중 N건". 그 항목만 의미 매칭 후보에서 빠지고 규칙 매칭은 유지된다. 전환을 막지 않는다(미리보기 경고 `SEMANTIC_INDEX_PENDING`).
- **GC 시점**: 전환·롤백·승격·예약 전환 커밋 후 백그라운드. 보호 버전 = §13.2의 집합(운영·스테이징·운영 이력 최근 N·활성 전환 예약 대상). 보호 버전의 슬롯은 L1 코어에서 얻는다(대부분 적중).
- **모델 교체**: 보존 행은 `modelId`별이라 새 모델 요청에서는 적중하지 않는다 → 같은 해시의 초안 벡터(새 모델로 재색인됨)로 대부분 채워지고, 초안에 없는 버전 문장만 `missing`으로 남아 ② 재시도가 새 모델로 채운다. 옛 모델 행은 다음 GC가 지운다.

### 8.5 ml-worker 영향 · 마이그레이션 · 백필

- **ml-worker 변경 0**: 계약(`POST /embed`·`GET /health`)·배포·환경변수 불변. ②의 임베딩 호출은 기존 `EmbeddingProvider`(유일 출구 `http-embedding.provider.ts`)를 그대로 쓴다 — 외부 HTTP 출구 수 4곳 불변.
- **마이그레이션**: 테이블 신설뿐(§3.2). 슬롯 테이블 컬럼·인덱스 불변.
- **백필 없음**: 보존 저장소는 모드를 켤 때 그 챗봇만 채운다(켜기의 ① 복사). 모드 꺼진 챗봇은 영원히 0행이다(정적·통합 시험 AC-EN3-3).

---

## 9. 승격 · 운영 전환 · 롤백 · 이력 (FR-EN4-\* · P-2)

### 9.1 쓰기 유일 파일 `EnvironmentPointerWriter`

| 메서드 | 쓰기 | 호출자 |
|---|---|---|
| `enable(tx, …)` | `chatbot.updateMany(prodVersionId null→v)` · `chatbotEnvironment.upsert` · 이력 2행 | 모드 서비스 |
| `disable(tx, …)` | `chatbot.updateMany(prodVersionId vP→null)` · `chatbotEnvironment.update(staging·enabledAt null)` · 이력 1행 | 모드 서비스 |
| `setStaging(tx, …)` | `chatbotEnvironment.updateMany(where stagingVersionId = expected)` · 이력 1행 | 승격 서비스 |
| `switchProd(tx, …)` | `chatbot.updateMany(where { id, prodVersionId: expected })` · 이력 1행(IMMEDIATE·ROLLBACK·SCHEDULED) | 전환 서비스 |
| `updateGate(…)` | `chatbotEnvironment.upsert`(게이트 4필드만) | 모드 서비스(게이트 설정) |

- 모든 포인터 갱신은 **기대값 조건부(CAS)**다. 영향 행 0 = 다른 요청이 먼저 바꿨다 → `409 ENV_POINTER_STALE`(FR-EN4-8 · AC-EN4-6 — 다중 인스턴스에서도 DB가 1건만 통과시킨다).
- 원시 SQL 0(`updateMany` + 영향 행 수 — ADR-0032 §2 방식).

### 9.2 스테이징 승격 `POST …/staging/promote` (`dialogue:write` AND `chatbot:write`)

한 트랜잭션: 모드 확인(꺼짐 → `409 ENV_MODE_DISABLED`) → `readConsistent(tx)` + `computeFromCaptured` → 현재 스테이징 ≠ `expectedStagingVersionId` → `409 ENV_POINTER_STALE` → 판정:
- 현재 스테이징 버전의 (`contentHash`,`tiebreakHash`)와 같음 → **`NOOP`**(쓰기 0 · 감사 0 · 이력 0).
- 최신 버전(아무 트리거)과 같음(두 해시, `tiebreakHash` ≠ null) → **`REUSED`**(그 버전으로 `setStaging`).
- 그 외 → **`CREATED`**(`persistWithin(tx, …, { trigger: 'PROMOTE', label, memo })` → `setStaging`).

커밋 후: pin ①(스테이징 슬롯) · 보존 정리(CREATED) · 감사 `UPDATE`(staging vX → vY) · 백그라운드 GC. **자산 테이블 쓰기 0**(FR-0-153).

### 9.3 운영 전환 · 롤백 (`chatbot:deploy`) — `ProdSwitchService`(즉시·예약 공용)

```
preview(chatbotId, { kind, targetVersionId? })          // DB 변경 0 · chatbot:read AND dialogue:read
  target = kind = ROLLBACK ∧ 생략 ? pickRollbackTarget(history, currentProd) : targetVersionId
  allowed = isSwitchTargetAllowed({ target, staging, prodHistoryIds, kind, scheduled: false })
  diff = VersionDiffService(current ↔ target)          // No.25 버전 ↔ 버전 차이 재사용
  gate = evaluateProdSwitchGate(settings, latestRun(target), now, kind)        // §10
  warnings = switch-warnings + 외부 참조(collectExternalRefs → 설문·API 연결 조회 2) + 토픽 노출(computeTopicExposureChange)
  expectedProdVersionId = currentProd

switch/rollback(chatbotId, dto, invocation?)            // invocation = 예약 실행(주체·접두·scheduleId·now)
  ① assertWritable · 모드 꺼짐 409 ENV_MODE_DISABLED · target 소속 확인(404) · target = currentProd → 200 { outcome: NOOP } (이력·감사 0 — EX-EN-16)
  ② allowed? 아니면 409 ENV_TARGET_NOT_STAGING (예약 실행은 생성 시 검증 — scheduled: true면 건너뜀, FR-EN5-2)
  ③ gate BLOCK ∧ kind = SWITCH → 409 ENV_GATE_NOT_PASSED (롤백은 경고만 — FR-EN4-4)
  ④ 경고 있음 ∧ acknowledgeWarnings ≠ true → 400 VALIDATION_FAILED(field: acknowledgeWarnings) (예약 실행은 생성 시 확인)
  ⑤ tx: writer.switchProd(expected = dto.expectedProdVersionId, next = target, method)   → count 0 → 409 ENV_POINTER_STALE
  ⑥ 커밋 후: pin ① · warm · 감사 UPDATE(ChatbotEnvironment — 주체 = invocation.actor ?? ALS) · 백그라운드 GC
  ⑦ BUSY → 409 ENV_SWITCH_BUSY(예약 실행은 일시적 원인 — §11.4)
```

- **`isSwitchTargetAllowed`**: 대상 ∈ {현재 스테이징} ∪ {운영 이력 버전 = `PROD` 이력의 `toVersionId` 전부}. 롤백은 이력 버전만(스테이징도 이력에 있으면 허용). 초안보다 오래된 이력 버전도 허용하며 경고 `OLDER_THAN_DRAFT`(EX-EN-17).
- **`pickRollbackTarget(historyDesc, currentProd)`**: 가장 최근 `PROD` 이력 중 `toVersionId = currentProd`인 행의 `fromVersionId`. 없거나 그 버전이 사라졌으면 `currentProd`가 아닌 가장 최근 `toVersionId`. 후보가 없으면 `409 ENV_TARGET_NOT_STAGING`.
- **트랜잭션 비용**: 포인터 1행 + 이력 1행 — 자산 규모 무관 ≤ 100ms(NFR-ENP4).

### 9.4 미리보기 경고 (전부 blocker 아님 · `acknowledgeWarnings` 필요)

| 코드 | 산출 |
|---|---|
| `GATE_WARN` | 게이트 판정 `WARN`(§10) |
| `LEGACY_TIEBREAK` | 대상 코어 `legacyTiebreak` |
| `SEMANTIC_INDEX_PENDING` | 리졸버 `missing` > 0 |
| `CONTEXT_FLOWS_AFFECTED` | 현재 운영에 있고 대상에 없는 컨텍스트·설문 참조 노드 수(진행 중 대화가 끊길 수 있는 흐름 — EX-EN-8) |
| `TOPIC_EXPOSURE_CHANGE`·`TOPIC_MISSING` | 기존 `computeTopicExposureChange`·정규화 결과(현재 운영 ↔ 대상) |
| `SURVEY_MISSING`·`SURVEY_NOT_OPEN`·`API_CONNECTION_MISSING`·`API_CONNECTION_DISABLED` | `collectExternalRefs(대상)` + 조회 2(복원 경고와 같은 함수 — FR-EN2-8) |
| `PROFILE_WILL_CHANGE` | 표시 설정 3필드 차이(위젯 이름·아바타·스킨이 바뀐다 — P-10) |
| `OLDER_THAN_DRAFT` | 대상 `createdAt` < 초안 최신 캡처 시각 |

### 9.5 `Chatbot.updatedAt` 갱신 수용 (FR-EN2-2 판단)

운영 포인터를 `Chatbot` 행에 두면 전환마다 `@updatedAt`이 바뀌어 챗봇 목록의 "최근 변경" 정렬이 올라간다. **수용한다** — ① 운영 전환·롤백·켜기/끄기는 "사용자가 보는 챗봇이 바뀐" 운영 변경이라 목록 상승이 의미상 맞다 ② 빈도가 낮다(수동·예약 전환) ③ 빈번한 쓰기(스테이징 승격·게이트)는 환경 행에 있어 `Chatbot`을 건드리지 않는다 ④ `updatedAt`을 보존하려면 원시 SQL 또는 명시 재기록이 필요한데 전자는 봉인 비용, 후자는 동시 편집과 경합한다. `ChatbotVersionSequence` 분리(ADR-0031)는 "스냅샷 생성(부수 동작)"이 목록을 흔드는 문제였고 이번은 주 동작이다. `Chatbot.updatedAt`을 표시 외 판정에 쓰는 코드는 없다(전수 확인 — 웹 목록 표시 2곳뿐).

### 9.6 이력 조회 `GET …/environment/history`

`chatbot:read` · `createdAt desc` 고정 · 페이지 20/100 · 필터 `environment`. 삭제·수정 경로 0(append-only).

---

## 10. 승격 검증 게이트 (FR-EN6-4~6 · P-5)

```ts
evaluateProdSwitchGate(input: {
  settings: { mode: 'WARN'|'BLOCK'; testSetId: string|null; minPassRate: number; validHours: number };
  latestRun: { runId; setId; setName; summaryA; finishedAt; embeddingModelId } | null;   // 대상 버전 대상 최근 성공 SINGLE 실행
  setExists: boolean;                    // testSetId 지정 시 세트 존재 여부
  currentEmbeddingModelId: string | null;
  now: Date; kind: 'SWITCH' | 'ROLLBACK';
}): GateEvaluation
```

| 조건(순서) | 결과 |
|---|---|
| `testSetId` 없음 | 모드 `BLOCK`이면 설정 단계에서 막힌다(PUT `superRefine`). `WARN`이면 대상 버전의 **아무 세트** 최근 실행 요약만 — 없으면 `WARN/NO_RUN`, 있으면 `PASS`(표시) |
| `testSetId` 있음 ∧ 세트 없음 | `BLOCK` 모드 → `BLOCK/SET_MISSING`(설정 오류 — 전환 거부 · EX-EN-23) · `WARN` → `WARN/SET_MISSING` |
| 실행 없음 | `NO_RUN` |
| `finishedAt + validHours < now` | `EXPIRED` |
| 실행 모델 ≠ 현재 모델 | `MODEL_CHANGED` |
| 합격률 < `minPassRate` | `BELOW_THRESHOLD` |
| 그 외 | `PASS/PASSED` |

- 판정 비통과 → 모드 `BLOCK`이면 `BLOCK`, `WARN`이면 `WARN`. **`kind = ROLLBACK`이면 `BLOCK`을 `WARN`으로 낮춘다**(긴급 복귀 우선 — FR-EN4-4 · AC-EN6-6).
- 합격률 = `pass / (pass + fail + notJudged + unresolved)` — `readiness-warnings.service.ts` 110~111행과 **같은 식**(순수 함수 `computePassRate(summaryA)`로 추출해 양쪽이 공유 — 동작 불변).
- 최근 실행 조회: `testRun.findFirst({ where: { chatbotId, targetVersionId: target, status: 'SUCCEEDED', mode: 'SINGLE', setId? }, orderBy: { finishedAt: 'desc' } })` — 새 인덱스 `(chatbotId, targetVersionId)`. **스테이징을 대상으로 한 실행은 `targetVersionId`로 해석·저장돼 있으므로** 그 버전이 운영 전환 대상이 될 때 그대로 인정된다.
- 미리보기·즉시 전환·예약 실행이 **같은 함수**를 호출한다(NFR-ENM2). 전환 후 자동 롤백·판정 롤백 없음(FR-EN6-6). 예약 전환의 실행 직후 TC(보고만)는 기존 G3 옵션을 재사용한다(§11.3).
- 게이트 설정 `PUT …/environment/gate`(`chatbot:deploy`): 모드 꺼진 챗봇도 저장 가능(켜면 적용). 감사 `UPDATE` before/after 4필드.

---

## 11. 예약 전환 `SWITCH_PROD_VERSION` (No.28 결합 · FR-EN5-\* · T-2)

### 11.1 추가되는 것 (ADR-0032 §1 "동작 추가 = 파일 1개 + 레지스트리 1줄")

| 항목 | 내용 |
|---|---|
| 동작 값 | `DeployScheduleAction` += `SWITCH_PROD_VERSION` |
| params | `{ targetVersionId, expectedProdVersionId }` — 식별자만(NFR-DS4) |
| 비정규화 | `targetVersionId`·`targetVersionNo` 컬럼 재사용(보존 보호·삭제 409 조회 키 — **스키마 변경 0**) · `predecessorScheduleId` = 체인 선행 전환 예약 |
| 실행기 | `executors/switch-prod-version.executor.ts` 1파일 |
| 레지스트리 | `ExecutorMap`·생성자·객체 리터럴 각 1줄 |
| 권한 | `required-permissions.ts` `case 'SWITCH_PROD_VERSION': return ['chatbot:deploy']` |
| G3 허용 | `POST_RUN_TEST_APPLICABLE_ACTIONS` += `SWITCH_PROD_VERSION`(대상 = 새 운영 버전) |
| 엔진·planner·분류기 골격·상태 기계·API 경로·테이블 | **무변경** |

### 11.2 생성 · 체인 · 바인딩

- **미리보기**(`preview`): 기준 = `resolveSwitchBinding(activeSwitchSiblings, currentProd)` — 같은 챗봇의 **앞선 활성 전환 예약**이 있으면 그 대상(체인 — 복원 체인과 같은 규칙: 뒤에만 붙는다), 없으면 현재 운영. `ProdSwitchService.preview()`의 결과를 `switchProd`로 싣고, 그 blocker(`ENV_MODE_DISABLED`·`TARGET_NOT_ALLOWED`·`GATE_CONFIG_ERROR`·`TARGET_UNREADABLE`·`CHATBOT_ARCHIVED`) 중 하나라도 있으면 `preconditionFailures: [{ code: 'SWITCH_BLOCKED', message: <blocker 코드> }]`(신규 사유 1 — `RESTORE_BLOCKED` 선례) → `creatable: false`. **`GATE_BLOCKED`는 생성 시점 blocker가 아니다**(실행 시 재평가 — 예약 시점에는 TC가 아직 없을 수 있다) — 준비도 경고로만 보인다.
- **생성**(`resolveForInsert(tx)`): 트랜잭션 안에서 기준 재계산 → 요청 `previewedProdVersionId` ≠ 기준 → `409 ENV_POINTER_STALE` · 대상이 스테이징/이력 아님 → `409 ENV_TARGET_NOT_STAGING` · 경고가 있으면 `acknowledgeWarnings` 필수.
- 모드 켜진 챗봇의 `RESTORE_VERSION` 생성은 준비도 경고 `ENV_DRAFT_ONLY`("초안에만 적용 — 운영은 바뀌지 않습니다")를 붙인다(FR-EN5-4). `PUBLISH`·`SET_WEB_CHANNEL`은 의미 불변.

### 11.3 실행 (`execute()` — 절대 throw하지 않는다)

```
① 모드 꺼짐 → FAILED(STATE_CHANGED)                        // 끄기가 CANCELLED로 정리하므로 방어 경로
② 대상 버전 없음 → FAILED(TARGET_VERSION_MISSING) · 소속 불일치 → 같은 코드
③ currentProd ≠ params.expectedProdVersionId → FAILED(STATE_CHANGED)   // 엄격 바인딩(ADR-0032 §3) → fail-stop 후속 HELD(기존)
④ 게이트 재평가(kind SWITCH): BLOCK → FAILED(GATE_NOT_PASSED)(영구 — 재시도 없음 · AC-EN5-3)
⑤ ProdSwitchService.switch(chatbotId, { targetVersionId, expectedProdVersionId }, { actor: 예약자, prefix, scheduleId, scheduled: true, now })
     APPLIED → SUCCEEDED/APPLIED(summary kind SWITCH_PROD) · NOOP → SUCCEEDED/NOOP
     409 ENV_POINTER_STALE → FAILED(STATE_CHANGED) · 409 ENV_SWITCH_BUSY·P2034 → 일시적(DB_BUSY) → PENDING 재시도(15분 창)
⑥ G3: 옵션이 있으면 PostRunTestStarter가 대상 PROD(= 새 운영 버전)로 TC 시작
```

- 예약자 권한 재검증(`CreatorVerifier` — `chatbot:deploy` 상실 → `CREATOR_NOT_AUTHORIZED` · AC-EN5-4)·misfire(EX-EN-15)·임대·2인스턴스 CAS 선점(AC-EN5-5)은 **엔진이 그대로** 처리한다.
- 실행기는 `deploy-schedules/**`에 있으므로 **포인터를 직접 쓰지 않는다** — ★ 발견 제약 ⑤(D-1: `deploySchedule` 외 모델 쓰기 0건). 쓰기는 `environment/core`의 전환 서비스가 한다. D-2 금지 심볼(`ChatbotsService` 등)도 쓰지 않는다.
- `D-12`(시계 직접 호출 금지)에 따라 실행기는 `CLOCK`의 `now`를 전환 서비스에 넘긴다.

### 11.4 결과 분류

| 원인 | 분류 |
|---|---|
| `ENV_SWITCH_BUSY`·`P2034`·`SQLITE_BUSY` | 일시적(`DB_BUSY`) |
| `ENV_POINTER_STALE` · 모드 꺼짐 | 영구 `STATE_CHANGED` |
| 대상 없음·소속 불일치 | 영구 `TARGET_VERSION_MISSING` |
| 게이트 차단 | 영구 `GATE_NOT_PASSED`(신규 사유) |
| 보관 챗봇 | 영구 `CHATBOT_ARCHIVED` |
| 그 외 | 영구 `INTERNAL_ERROR`(기존 규칙) |

`outcome-classifier.ts`는 코드 → 사유 매핑 표에 3행(`ENV_SWITCH_BUSY`·`ENV_POINTER_STALE`·`ENV_GATE_NOT_PASSED`)을 더한다(골격 불변).

### 11.5 임대 만료 회수 (`judgeRecovery()`)

전환 이력에 `deployScheduleId = 이 예약`인 행이 있으면 **`RECOVERED`**(이력은 포인터와 같은 트랜잭션 — 커밋의 증거). 없고 현재 운영 = 대상이면 `NOOP`, 그 외 `INTERRUPTED`. 재실행하지 않는다(at-most-once — ADR-0032 §2).

### 11.6 모드 켜기/끄기와 기존 예약 (C-4 · P-8)

- **켜기**: 같은 트랜잭션에서 `repository.holdRestoreForEnvModeChange(tx, chatbotId, now)` — 활성 `PENDING` `RESTORE_VERSION` → `HELD(ENV_MODE_CHANGED)`(`heldAt = now`, `heldByScheduleId = null`). **이유**: 켜는 순간 복원의 효과 대상이 운영 → 초안으로 바뀐다. 예약자가 본 적 없는 의미로 실행하면 엄격 바인딩의 취지(ADR-0032 §3)를 어긴다. 해제는 기존 재개 흐름(새 미리보기 — `ENV_DRAFT_ONLY` 경고를 보고 확인)이다. 뒤따르는 다른 동작 예약은 도래 시점에 기존 `PREDECESSOR_HELD` 규칙을 받는다. `RUNNING` 예약이 있으면 켜기 자체가 `409 ENV_SWITCH_BUSY`.
- **끄기**: 같은 트랜잭션에서 `repository.cancelSwitchForEnvDisable(tx, chatbotId, actor, now)` — 활성(`PENDING`·`HELD`) `SWITCH_PROD_VERSION` → `CANCELLED`(`cancelled*` = 끄는 사람). 사유는 끄기 감사 summary의 건수로 남는다(예약 행에 사유 컬럼을 늘리지 않는다).
- 두 메서드는 `deploy-schedule.repository.ts`(기존 허용 2파일 중 하나)에 있고, `EnvironmentScheduleHooks`가 위임만 한다 — D-1 불변.

---

## 12. 시뮬레이터 · TC 대상 (FR-EN6-1~3 · J-12)

### 12.1 시뮬레이터

- `simulate()` 요청 `target?: BundleTarget`(기본 초안). `STAGING`/`PROD`는 모드 꺼짐 → `409 ENV_MODE_DISABLED`(스테이징 포인터가 null이어도 같은 코드). `VERSION`은 같은 챗봇 버전만(아니면 `404`).
- **오버레이 + 비초안 대상 → `400 VALIDATION_FAILED`(field `target`)**(AC-EN6-2). 비활성 토픽 포함 토글은 모든 대상에 적용(`topics: 'ALL'`).
- 버전 대상 결과는 공개 대화와 **같은 번들·같은 설정·같은 벡터**(AC-EN6-1 · AC-EN2-2) — 차이는 시뮬레이터 고유 기능(설문 미리보기·API 목·`matchTrace`)뿐이며 이는 초안 대상과 같다.
- LIVE API 호출의 "저장된 노드" 판정(`isSavedNode`)은 **대상 번들 기준**이다(버전의 노드도 "저장된" 자산).
- 응답 `target?`(비초안일 때만) = `{ kind, versionId, versionNo, legacyTiebreak, semanticMissing }`. 로그 적재 0(ADR-0030 불변 — `ConversationLogService` 미주입).
- **비교(`compare`)는 대상 없음**(오버레이 비교 전용 — §28 해석 R-3).

### 12.2 TC 실행

- `POST /chatbots/:chatbotId/test-sets/:setId/runs` 요청 `target?`(기본 초안). `TestRunService.start()`가 `STAGING`/`PROD`를 **시작 시점의 포인터로 해석**해 `targetKind`·`targetVersionId`·`targetVersionNo`를 저장한다(실행 중 전환이 결과 해석을 흔들지 않게). 오버레이 모드 + 비초안 = `400`. 동시 실행 1건 부분 유니크 불변.
- 실행기: 비초안이면 A측 = 버전 번들(`ACTIVE_ONLY`)·버전 설정·리졸버 벡터 · `liveIds` = 그 번들 기준(대상 버전에 없는 기대 id → 기존 `UNRESOLVED` — FR-EN6-3).
- 지문 `envFingerprint.target = { kind, versionId, versionNo, contentHash, legacyTiebreak, semanticMissing }`(비초안만 — 초안 실행 지문 바이트 불변). 실행 간 비교(M1)는 대상이 다르면 화면이 경고한다(`test-run-compare.service.ts`는 지문을 읽기만 한다 — 비교 응답에 대상 차이 표식 1개).
- 버전 읽기 실패 → `FAILED(TARGET_VERSION_UNREADABLE)`.

---

## 13. 버전(No.25) 관계 · 보존 보호 (FR-EN7-\* · P-7)

### 13.1 복원 = 초안만

- `restore()`의 코드·의미론·호출부(2곳)는 **불변**이다. 모드 켜진 챗봇에서 복원이 바꾸는 것은 초안(자산 테이블)뿐이며 운영은 포인터라 영향이 없다(AC-EN7-1).
- 복원 미리보기 경고에 `ENV_DRAFT_ONLY { prodVersionNo, stagingVersionNo }`를 **추가**한다(모드 켜짐만 — 버전 번호 조회 1회). `ACTIVE_CHATBOT` 경고와 `acknowledgeActive` 요청 계약은 그대로이며, 콘솔은 `ENV_DRAFT_ONLY`가 있으면 확인 문구를 "초안에만 적용됩니다. 운영(vP)·스테이징(vS)은 바뀌지 않습니다"로 바꾼다(FR-EN7-1 — 계약 불변).

### 13.2 보존 보호 집합 (FR-EN7-2 · J-18)

```ts
computeEnvironmentProtectedIds({ prodVersionId, stagingVersionId, prodHistoryDesc, historyN }): Set<string>
  = { prod, staging } ∪ (PROD 이력의 toVersionId 중 현재 운영을 제외한 최근 N개 distinct)
```

- `pruneBestEffort()`: 기존 `externallyProtectedIds` = 활성 예약 대상(`action IN (RESTORE_VERSION, SWITCH_PROD_VERSION)`) ∪ 위 집합. `selectVersionsToPrune()` 알고리즘 불변(입력만 늘어난다).
- `deleteOne()`: 같은 트랜잭션에서 위 집합에 있으면 **`409 VERSION_REFERENCED_BY_ENVIRONMENT`**(details: 환경 `PROD`/`STAGING`/`PROD_HISTORY`) — 예약 참조 409가 먼저다(기존 순서). 삭제되면 L1 코어 항목을 제거한다.
- 모드 꺼진 챗봇: 환경 행 조회 1회(null) — 정리·삭제 경로에 쿼리 1개가 더해진다(공개 경로 아님 · §24.2 주석).

### 13.3 버전 목록·상세의 환경 배지 (FR-EN4-6)

`assertReadable()` 반환 `prodVersionId`가 있을 때만 환경 행 + 최근 운영 이력(50행)을 읽어 `deriveEnvironmentBadges()`로 `environmentBadges`를 채운다(키 조건부 — 모드 꺼짐 응답 바이트 불변). 라벨은 자유 메모 그대로다(ADR-0031 §8의 "라벨 무의미" 유지).

---

## 14. 로그 귀속 `servedVersionId` (FR-EN8-1~2 · P-11)

- 쓰기 주체 = `ConversationLogService.record()` 1곳(`create.data.servedVersionId: params.servedVersionId ?? null`) · 적재 후 불변(R-10 `update*` 0 유지) · FK·인덱스 없음 · 백필 없음.
- **값 규칙**: 이 턴을 처리할 때 `access.resolve()`가 읽은 `chatbot.prodVersionId` — 엔진 턴·**BLOCK 턴·상담 HANDLED 턴·보류 RAG 턴 공통**. 모드 꺼짐 = null. 이유: 2차 비율 분할은 **세션 단위 귀속**이 분모이며 턴 유형마다 귀속 규칙이 다르면 집계가 어긋난다(§28 R-4).
- **보류 RAG 턴**: `startPendingRagAnswer()` 입력 → `RagAnswerRunInput.servedVersionId?`(값이 있을 때만 키 — 조건부 전개) → 백그라운드 `record()` 2곳. POST 시점의 버전이 적재된다(그 사이 전환돼도 — FR-EN8-1).
- 1차 통계 화면·집계 변경 0(No.2·14·29 — FR-EN8-2). 평가 원장(`MessageFeedback`)에는 복사하지 않는다(2차 — 필요 시 `conversationLogId` 조인으로 충분).

---

## 15. 학습 큐 · 평가(No.44) 부작용 2건 (FR-EN8-3~5)

### 15.1 "운영 미반영" · 재유입 오표시 — 표시 단계 판정

- 수집기(`record()`의 `collect()`)·병합·상한·상태 전이·`recurredCount` 증가는 **불변**(봉인 — F-9 3파일 집합 불변).
- 목록 응답(모드 켜짐 · `status = RESOLVED` 항목만)에 `prodReflection`을 싣는다. 입력은 `PROD` 전환 이력 최근 50행(`createdAt`, `toVersionCapturedAt`) — **요청당 쿼리 1개**(모드 켜짐만).
  ```
  judgeProdReflection({ resolvedAt, prodSwitchesDesc }):
    현재 운영(가장 최근 PROD 이력의 to)의 capturedAt < resolvedAt → PENDING_SWITCH("운영 미반영")
    그 외 → 최근 이력부터 거슬러 "toVersionCapturedAt ≥ resolvedAt"가 이어지는 가장 이른 이력의 at = reflectedAt → REFLECTED
  shouldShowRecurredAfterApply({ recurredCount, lastOccurredAt, reflection }):
    reflection 없음(모드 꺼짐) → recurredCount > 0                   // 현행
    PENDING_SWITCH → false                                        // 운영 미반영 기간 재유입은 "반영 후 재발생"이 아니다(EX-EN-12)
    REFLECTED → recurredCount > 0 ∧ lastOccurredAt > reflectedAt
  ```
- "운영 미반영" 배지는 전환 후 자동으로 사라진다(AC-EN7-3). 롤백으로 운영이 반영 이전 버전이 되면 다시 뜬다(설계상 올바름).
- 한계: `recurredCount` 숫자는 미반영 기간의 발생을 포함하고, `recurredOnly` 필터는 숫자 기준이다(§27 L-3).

### 15.2 "초안에서 삭제됨" — 상세 1건 한정

- 부정 평가 항목 **상세**가 대상 이름을 초안에서 못 찾으면, 그 턴 로그(`lastFeedbackLogId`)의 `servedVersionId`(select 1컬럼 추가)가 있을 때만 `VersionBundleService.getCore()`로 이름을 찾아 `deletedInDraft: true`·`nameFromVersion`을 싣는다(AC-EN7-4). 목록·No.14 "👎 집중 답변"은 조회 비용 때문에 버전을 읽지 않고, 콘솔이 모드 켜짐을 알면 기존 "삭제됨" 문구를 "초안에 없음"으로 바꾼다(§23).

---

## 16. 위젯 표시 설정 `getConfig()` (FR-EN2-6 · P-10)

- 모드 켜짐: `name`·`avatarUrl`·`skin` = **운영 버전 프로필**(`VersionBundleService.getCore()` — L1 적중 시 추가 조회 0) · `greetingMessage`·`quickReplies`·`launcherPosition`·`showLauncher` = WEB 채널 config(현재 값). `slug`는 챗봇 행.
- 모드 꺼짐: 현행 그대로(바이트 동일).
- 초안에서 스킨·이름을 바꿔도 위젯에 새지 않는다(AC-EN2-1). 공개 응답 스키마(`PublicChatbotConfigSchema`)는 **불변**이다(값 출처만 바뀐다 — 위젯 변경 0).
- 버전 읽기 실패 시 `getConfig()`는 챗봇 행 값으로 응답한다(표시 설정은 답변이 아니므로 가용성 우선 — 대화 경로는 §7.6 폴백).

---

## 17. 권한 (P-4 (2) — 신규 권한 1종 · 신규 역할 0)

### 17.1 권한 문자열

`Permission` += **`chatbot:deploy`**(17 → 18) · `ROLE_PERMISSIONS.ADMIN` += `chatbot:deploy`. EDITOR·VIEWER·AGENT 불변. 명명 규칙 `<도메인>:<동작>` — 운영 반영은 챗봇 도메인의 동작이므로 새 도메인을 만들지 않는다.

### 17.2 경로 매트릭스

| 동작 | 권한(AND) | ADMIN | EDITOR | VIEWER | AGENT |
|---|---|:-:|:-:|:-:|:-:|
| 환경 현황 · 전환 미리보기 · 켜기/끄기 미리보기 | `chatbot:read` + `dialogue:read` | ○ | ○ | ○ | ✕ |
| 전환 이력 | `chatbot:read` | ○ | ○ | ○ | ○ |
| 스테이징 승격 | `dialogue:write` + `chatbot:write` | ○ | ○ | ✕ | ✕ |
| 켜기 · 끄기 · 운영 전환 · 롤백 · 게이트 설정 | **`chatbot:deploy`** | ○ | ✕(403) | ✕ | ✕ |
| 전환 예약 생성·수정·취소·재개·확인 | 가드 `chatbot:read` + 서비스 `requiredPermissions` = `chatbot:deploy` | ○ | ✕ | ✕ | ✕ |
| 시뮬레이터 대상 선택 | 기존 `simulation:read` | ○ | ○ | ○ | ✕ |
| TC 대상 선택 | 기존 `simulation:write` | ○ | ○ | ✕ | ✕ |
| 긴급 차단(WEB 채널 닫기) | 기존 `channel:write` | ○ | ○ | ✕ | ✕ |

- 끄기 "운영 유지"의 콘솔 흐름은 복원 API(`dialogue:write`+`chatbot:write`)를 먼저 부른다 — ADMIN은 둘 다 가진다.
- 예약 실행 직전 예약자 재검증은 `chatbot:deploy`를 본다(권한 우회 수단 아님 — NFR-ENS4).

### 17.3 봉인 시험 영향

| 시험 | 영향 |
|---|---|
| `common/auth/lib/permission-matrix.spec.ts` | `toHaveLength(17)` → 18 · `arrayContaining`에 `'chatbot:deploy'` · 제목(X-1). "ADMIN = 전체"·"EDITOR ⊇ VIEWER" 단언은 **무수정 통과**(EDITOR에 추가하지 않으므로 VIEWER 상위집합 불변) |
| `topics/lib/topic-sealing.spec.ts` T-10 | `Permission.options.length === 17` → 18 · 제목(X-2) · `AuditAction` 14 **불변** |
| `common/auth/public-decorator-count.spec.ts` | 새 컨트롤러 등록(34 → 35) · `@Public()` 목록 8 **불변**(X-3) |
| 웹 `TopBar.handoff.spec.tsx` | `ROLE_PERMISSIONS`를 동적으로 읽어 무수정 통과 |
| `@RequirePermission` 인자 타입 | 새 문자열이 유니온에 있어야 빌드된다(오타 = 빌드 실패) |

---

## 18. 감사 (FR-EN9-2 — `AuditTargetType` +1 · `AuditAction` +0)

| 동작 | 액션 | 대상 | 내용 |
|---|---|---|---|
| 켜기 | `STATUS_CHANGE` | `ChatbotEnvironment`(targetId = chatbotId) | before `enabled:false` → after `enabled:true, prodVersionNo, stagingVersionNo` · summary `환경 분리 시작 vN · 보류 예약 n건` |
| 끄기 | `STATUS_CHANGE` | 〃 | `enabled:true → false` · summary `환경 분리 종료(운영 유지｜초안을 운영으로) · 취소 예약 n건` |
| 스테이징 승격 | `UPDATE` | 〃 | `stagingVersionNo` 전/후 · summary `스테이징 승격 vX → vY(생성｜재사용)` |
| 운영 전환 · 롤백 | `UPDATE` | 〃 | `prodVersionNo` 전/후 · summary `운영 전환｜운영 되돌리기 vX → vY` (+ `사유 메모 있음`) |
| 예약 전환 실행 | `UPDATE` | 〃 | 주체 = 예약자(`actorOverride`) · summary 접두 `[예약 실행 #<id 앞 8자>]` |
| 게이트 설정 | `UPDATE` | 〃 | 게이트 4필드 전/후 |

- 화이트리스트: `['enabled','stagingVersionNo','prodVersionNo','gateMode','gateTestSetId','gateMinPassRate','gateValidHours']`. **사유 메모 본문·자산 본문·발화 0**(메모 유무만 summary에 — FR-0-155).
- NOOP·미리보기·조회·보존 정리·pin·GC는 감사하지 않는다(쓰기 없음 또는 파생 데이터 — 자동 스냅샷 비감사 선례). `ENV_INIT`·`PROMOTE` 버전 생성은 환경 감사 1건에 버전 번호로 포함한다(버전 `CREATE` 감사를 따로 남기지 않는다 — 자동 캡처 선례).
- `RequestContextService.get()` 호출 지점은 여전히 `AuditLogService` 1곳이다.

---

## 19. API 계약 요약

### 19.1 신규 엔드포인트 (관리자 11 · `@Public()` 0)

| 메서드·경로(`/api/v1/chatbots/:chatbotId/environment…`) | 권한 | 요청 → 응답 |
|---|---|---|
| `GET …/environment` | `chatbot:read`+`dialogue:read` | → `EnvironmentStatus` |
| `POST …/environment/enable/preview` | `chatbot:read`+`dialogue:read` | → `EnableEnvironmentPreviewResponse` |
| `POST …/environment/enable` | `chatbot:deploy` | `EnableEnvironment` → `EnvironmentStatus` + `heldRestoreSchedules` |
| `POST …/environment/disable/preview` | `chatbot:read`+`dialogue:read` | → `DisableEnvironmentPreviewResponse` |
| `POST …/environment/disable` | `chatbot:deploy` | `DisableEnvironment` → `EnvironmentStatus` + `cancelledSwitchSchedules` |
| `POST …/environment/staging/promote` | `dialogue:write`+`chatbot:write` | `PromoteToStaging` → `PromoteToStagingResponse` |
| `POST …/environment/prod/preview` | `chatbot:read`+`dialogue:read` | `ProdSwitchPreview` → `ProdSwitchPreviewResponse` |
| `POST …/environment/prod/switch` | `chatbot:deploy` | `ProdSwitch` → `ProdSwitchResponse` |
| `POST …/environment/prod/rollback` | `chatbot:deploy` | `ProdRollback` → `ProdSwitchResponse` |
| `GET …/environment/history` | `chatbot:read` | `EnvironmentHistoryQuery` → `Paginated<EnvironmentSwitchLogItem>` |
| `PUT …/environment/gate` | `chatbot:deploy` | `UpdateEnvironmentGate` → `EnvironmentGateSettings` |

- 전부 `POST`인 미리보기는 DB 변경 0(본문 입력 때문 — 복원 미리보기 선례). 파괴적 동작은 GET 0(NFR-S9).
- 챗봇 스코프 규약: 교차 챗봇 `404` · `ARCHIVED` 쓰기 `409 CHATBOT_ARCHIVED` · 권한 판정이 존재 판정보다 먼저.

### 19.2 기존 경로 확장

| 경로 | 확장 |
|---|---|
| `POST …/simulate` | 요청 `target?` · 응답 `target?` |
| `POST …/test-sets/:setId/runs` | 요청 `target?` · 실행 응답 `target?` · 지문 `target?` |
| `GET …/versions`(+상세) | 항목 `environmentBadges?` · 트리거 필터 그룹 `ENVIRONMENT` |
| `POST …/versions/:id/restore/preview` | 경고 `ENV_DRAFT_ONLY` |
| `DELETE …/versions/:id` | `409 VERSION_REFERENCED_BY_ENVIRONMENT` |
| `/deploy-schedules`(생성·미리보기·상세·목록) | 동작 `SWITCH_PROD_VERSION` · 전제 조건 사유 `SWITCH_BLOCKED` · 보류 사유 `ENV_MODE_CHANGED` · 실패 사유 `GATE_NOT_PASSED` · 결과 요약 `SWITCH_PROD` · 준비도 경고 `ENV_DRAFT_ONLY` |
| `GET …/unanswered-questions`(+상세) | 목록 `prodReflection?` · 상세 대상 `deletedInDraft?`·`nameFromVersion?` |
| `GET /public/chatbots/:slug/config` | 스키마 불변 · 모드 켜짐이면 표시 3필드 출처 = 운영 버전 |
| `POST /public/chatbots/:slug/messages` | 스키마 불변(요청에 대상·버전 입력 필드 없음 — NFR-ENS1) |

### 19.3 오류 코드 (`ApiErrorCode` 신규 8종)

| 코드 | 상태 | 조건 |
|---|---|---|
| `ENV_MODE_DISABLED` | 409 | 모드 꺼진 챗봇에 승격·전환·롤백·끄기·`STAGING`/`PROD` 대상 지정 |
| `ENV_MODE_ALREADY_ENABLED` | 409 | 켜진 챗봇에 켜기(동시 켜기 경합 포함) |
| `ENV_POINTER_STALE` | 409 | 기대 포인터·초안 해시 불일치(미리보기 이후 변경) · 예약 생성의 기준 불일치 |
| `ENV_TARGET_NOT_STAGING` | 409 | 전환 대상이 스테이징·운영 이력이 아님 · 롤백 후보 없음 |
| `ENV_GATE_NOT_PASSED` | 409 | 차단 게이트 미달·설정 오류(운영 전환만) |
| `ENV_SWITCH_BUSY` | 409 | DB 경합·복원 잠금·RUNNING 예약(재시도 가능) |
| `ENV_DRAFT_NOT_RESTORED` | 409 | 끄기 `KEEP_PROD`인데 초안 ≠ 운영(콘솔이 복원 후 재시도) |
| `VERSION_REFERENCED_BY_ENVIRONMENT` | 409 | 포인터·운영 이력 보호 버전 삭제 |

오류 봉투 형식 불변(ADR-0003). 공개 대화 경로는 이 코드를 쓰지 않는다(버전 읽기 실패 = 폴백 턴 — §7.6).

---

## 20. 봉인 · 정적 검사 — `apps/api/src/environment/lib/environment-sealing.spec.ts`

| # | 단언 | 근거 |
|---|---|---|
| E-1 | `prodVersionId`를 쓰는 Prisma 호출(`chatbot.(create｜update｜updateMany｜upsert)` data에 `prodVersionId`) · `chatbotEnvironment.(create｜update｜updateMany｜upsert｜delete)` · `environmentSwitchLog.(create｜createMany)` 호출 파일 = `environment/core/environment-pointer.writer.ts` 1개. `chatbots/chatbots.service.ts`·`topics/topic-split.service.ts`·`asset-transfer/**`에 `prodVersionId` 토큰 0 | FR-0-153 · FR-EN1-7 |
| E-2 | `environment/**`에 자산 9테이블 쓰기 0 · `VersionRestoreService`·`VersionRestoreApplier`·자산 서비스(`IntentsService` 등)·`LearningApplyService` 심볼 0 | FR-0-153 |
| E-3 | `restore(` 호출 파일 = 2(D-3 재확인 — 새 파일 추가 0) | FR-0-154 |
| E-4 | `chatbotVersionPayload` 토큰 파일 ⊆ 기존 허용 목록(V-7 재확인) · `environment/**`·`embedding/**` 0 | FR-0-152 |
| E-5 | `packages/dialogue-engine/src`에 `environment`·`prodVersion`·`servedVersion`·`tiebreak`(대소문자 무관) 0 | FR-0-149 |
| E-6 | `@Public()` 총 8 · `environment.controller.ts` 0 | FR-0-151 |
| E-7 | `environmentSwitchLog.(update｜updateMany｜upsert｜delete)` 0 · `deleteMany`는 `chatbots.service.ts` 1곳 | FR-EN4-5 |
| E-8 | `conversationLog.update*` 0(R-10) · `conversation-log.service.ts` `create.data`에 `servedVersionId` 키 | FR-EN8-1 |
| E-9 | `public-conversation.service.ts`에서 `bundleSourceOf(`·`.getCached(`·`versionBundles.get(` 각 정확히 1회 · 공개 요청 스키마(`PublicMessageRequestSchema`·`PublicChatbotConfigSchema`) 재귀 키에 `target`·`version` 0 | NFR-ENS1 · AC-EN8-4 |
| E-10 | `apps/widget/src`·`apps/ml-worker`에 `environment`·`stagingVersion`·`prodVersion`·`embedding_text_vectors` 0 | FR-0-149 |
| E-11 | `embeddingTextVector` 쓰기 호출 파일 = `embedding/text-vector/embedding-text-vector.service.ts` + `chatbots.service.ts`(deleteMany) | §8.4 |
| E-12 | `embeddingVector` 쓰기 호출 파일 집합 불변(색인기 + 영구삭제) — `environment/**`·`embedding/text-vector/**`·`embedding/version-vectors/**` 0 | FR-EN3-4 |
| E-13 | `environment/**`·`embedding/text-vector/**`의 `logger.(log｜warn｜error｜debug)(` 줄에 `reason`·`memo`·`text` 토큰 0 | FR-0-155 |
| E-14 | `Permission.options.length === 18` · `'chatbot:deploy'`는 `ROLE_PERMISSIONS.ADMIN`에만 · `@RequirePermission('chatbot:deploy')` 사용 파일 = `environment.controller.ts` | FR-0-156 |
| E-15 | `environment-core.module.ts` exports = {`ProdSwitchService`,`EnvironmentReadService`} · `environment-serving.module.ts` exports = {`VersionBundleService`} · `EnvironmentPointerWriter` export 0 | §2.2 |
| E-16 | `environment/**`의 `$transaction(async (tx) =>` 콜백 안 `Promise.all` 0 | 단일 커넥션 규약 |
| E-17 | `excludeInactiveTopics` 식별자 `environment/**` 0(T-2 불변) · `getCachedUnfiltered(` 호출 파일 = `simulation.service.ts` 1개(T-4 불변) | ADR-0037 |

각 단언에 **역검증 픽스처**(검사 헬퍼가 실제로 위반 문자열을 잡는지)를 둔다(AC-EN8-3).

---

## 21. 성능 예산 (NFR-ENP)

| # | 대상 | 예산 | 근거·측정 |
|---|---|---|---|
| P-1 | 모드 꺼진 챗봇 공개 대화 | 지연·쿼리 수 **증가 0**(P95 500ms 불변) | `prodVersionId`는 이미 읽는 행의 컬럼 · 초안 경로 코드 동일 — Prisma 쿼리 계측 시험(AC-EN1-1) |
| P-2 | 모드 켜진 챗봇 · L2 적중 | 초안 대비 **+5ms 이내**(P95) | 캐시 조회 + 리졸버 메모 적중 — 대개 초안보다 빠르다(설정 캐시 조회 생략) |
| P-3 | L2 미스(L1 적중) | 쿼리 2(설문·토픽) + 합성 + 인덱스 — 초안 `getCached` 미스보다 가볍다 | 실측·기록 |
| P-4 | L1 미스(본문 ≤ 2MB) | **≤ 1.5초**(P95) — 본문 1쿼리 + JSON 파싱 + 해시 재검증 + 역직렬화 + 검증 + 슬롯 해시 | 실측·기록(NFR-ENP3) · 전환 직후 예열 |
| P-5 | 운영 전환·롤백 트랜잭션 | **≤ 100ms**(자산 규모 무관) | 포인터 1 + 이력 1(NFR-ENP4) |
| P-6 | 켜기·승격 | 캡처 비용(No.25와 같음, P95 1초) + pin 복사 ≤ 1초(1만 벡터) | 실측 |
| P-7 | 환경 현황 GET | P95 1초(초안 해시 캡처 1회 — `versions/current`와 같은 비용) | 콘솔은 화면 진입·전환 후에만 새로고침(폴링 금지) |
| P-8 | 재색인(모드 꺼짐) | 시간·벡터 수·임베딩 호출 수 **불변** | 색인기 무변경(AC-EN3-3) |
| P-9 | 보존 저장소 크기 | 추가 행 = 보호 버전 문장 − 초안 문장(차집합) | GC 후 실측 |
| P-10 | 메모리 | 챗봇당 최대 코어 2~7벌(운영·스테이징·이력) — 캐시 상한으로 제한 | 구독형 용량 산정에 반영(§29) |

---

## 22. 다른 기능과의 경계

| 기능 | 경계 |
|---|---|
| No.25 버전 이력 | 캡처·해시·차이·본문 리더·보존 정리 공유 · 복원 = 초안 시간축 · 롤백 = 운영 포인터 · 라벨 무의미 유지 · ID 보존이라 운영 턴의 매칭 id가 초안 자산 id와 이어진다 |
| No.28 예약 배포 | 동작 1개 추가 · 엔진·상태 기계 불변 · 켜기 시 복원 예약 `HELD` · 끄기 시 전환 예약 `CANCELLED` |
| No.22 토픽 | 토픽 정의·활성은 환경 밖(즉시 운영) · 운영 번들에도 같은 필터 · ID 재매핑 적재기 **1차 미사용**(2차 서버 간 이관의 부품) |
| No.19/20 TC·학습영향도 | 실행 대상 차원 추가 · 오버레이 비교는 "초안 + 가상 변경" 그대로 |
| No.10 시뮬레이터 | 대상 선택(원문 "+ 시뮬레이터"의 실체) · 비교는 초안 고정 |
| No.18 임베딩 | 슬롯 테이블·색인기·ml-worker 무변경 · 보존 저장소는 복사 기반 |
| No.44 평가 | 운영 턴에만 평가 버튼(기존 규칙) · 상세 대상 이름 "초안에서 삭제됨" |
| No.24 상담 | 힌트 = 운영 버전 · 상담 중 세션은 봇 일시정지라 전환 무관(EX-EN-25) |
| No.29 통합 통계 | 불변(버전별 비교 2차) |
| No.45 거버넌스 | 2인 승인·이력 보존 정책·감사 보존은 No.45 |
| No.1 챗봇 복사 | 모드·포인터 비복사 — 복사본은 초안(현재 테이블) 기준 |

---

## 23. 관리자 콘솔 (ui-designer / frontend-implementer 인계)

- **배포 그룹 "환경" 화면**(T-10 — 4번째 최상위 탭 판단은 ui-designer): 현황(운영 vP · 스테이징 vS · 초안 "운영과 같음/다름" · 의미 색인 준비 중 N) · `스테이징으로 승격` · 운영 전환 미리보기(차이 요약·게이트 결과·경고 목록·확인 체크) · `지금 전환`/`예약 전환`/`직전 운영 버전으로 되돌리기` · 게이트 설정 · 전환 이력 표 · 켜기/끄기 확인 흐름(§5 — 끄기 "운영 유지"는 복원 → 끄기 2단계를 한 흐름으로).
- **콘솔 공통 헤더 환경 배지**(FR-EN4-7): 모드 켜짐 챗봇에서만. 텍스트 필수(색만으로 구분 금지 — NFR-ENA1).
- **버전 목록 배지**(`environmentBadges`) · 트리거 필터 그룹 "환경".
- **시뮬레이터 대상 선택**(라벨 있는 선택 컨트롤 · 대화 영역 제목에 현재 대상 텍스트 — NFR-ENA4) · 오버레이 사용 중이면 초안 외 대상 비활성 + 사유.
- **TC 실행 대상 선택** · 실행 목록/상세에 대상 표기 · 비교 시 대상 다름 경고.
- **복원 확인 창**: `ENV_DRAFT_ONLY`가 있으면 확인 문구 교체(계약 불변).
- **환경 밖 자산 편집 화면 안내**(설문·API 연결·상담 설정·자주 쓰는 문장·채널·금지어·토픽): 모드 켜진 챗봇에서 "환경 분리 대상이 아닙니다 — 저장 즉시 운영에 적용".
- **학습현황**: `prodReflection` → "운영 미반영" 텍스트 배지 · "반영 후 재발생" 배지는 `shouldShowRecurredAfterApply()`로 판정 · 반영 성공 안내 "저장 즉시 반영됩니다"(`appliedImmediatelyHint`)를 모드 켜짐이면 "초안에 반영됨 — 운영 전환 후 사용자에게 적용" 문구로 교체(응답 계약 불변).
- **평가·큐 목록의 "삭제됨"**: 모드 켜짐이면 "초안에 없음".
- **예약 배포**: 동작 선택에 "운영 버전 전환"(ADMIN만 활성) · 준비도 경고 `ENV_DRAFT_ONLY` 문구 · 결과 요약 `SWITCH_PROD` · 전제 조건 사유 `SWITCH_BLOCKED`. 웹의 `Record<DeployScheduleAction,…>`(`ActionPickerStep.tsx` 19·24행)·`deploySchedulePermissions.ts`·`ReadinessWarningList.tsx` 분기는 컴파일 오류로 누락이 드러난다.
- **접근성**: 운영 전환·롤백·끄기 확인 창 = 초점 가두기·`Esc` 취소·버튼 명시적 이름("v44로 운영 전환") · 결과 안내 `aria-live="polite"` 1회 · 게이트 미달 사유는 비활성 버튼의 `aria-describedby`(NFR-ENA2~3). 화면 문구는 "초안 · 스테이징 · 운영"(영문 보조) — "포인터"·"스냅샷 번들"·"보존 저장소" 금지(FR-0-160).
- **위젯 변경 0.**

---

## 24. 시험 설계 포인트 (test-automation 인계)

### 24.1 층별 핵심

| 층 | 대상 |
|---|---|
| 단위(순수) | ★ `hydrateForServing` **왕복 동치**(라이브 번들 → 봉투 → 서빙 번들의 `resolveTurn` 결과 동일 — 동점 노드·동점 의도 예문·동점 FAQ·같은 `createdAt` 다른 id·다국어/이모지 픽스처) · 보조 필드 없는 봉투 폴백 · `hasPotentialNodeTies` 표 · `computeContentHash` 불변(보조 필드 유무 무관) · `serializeEnvelopeForStorage` 왕복(보조 필드 보존) · 봉투 스키마 파싱이 `tiebreak`를 유지 · `computeTiebreakHash` · `decideEnvInitVersion`(REUSE 조건 4) · `decideDisable` · `isSwitchTargetAllowed`·`pickRollbackTarget` 표 · ★ `evaluateProdSwitchGate` 표(§10 7행 × WARN/BLOCK × SWITCH/ROLLBACK) · `computePassRate`(readiness와 동치) · `computeEnvironmentProtectedIds` · `deriveEnvironmentBadges` · ★ `judgeProdReflection`/`shouldShowRecurredAfterApply` 표 · `deriveSemanticSlots` ↔ 색인기 대상 **동등성** · `composeServingBundle`(토픽 정규화·필터·설문 합성) · `resolveSwitchBinding` 체인 |
| 서비스(목) | 리졸버(보존 우선 · 초안 같은 해시 대체 · missing) · pin(복사·P2002 재시도·임베딩 단계 호출 수) · `VersionBundleService` 단일 비행·음성 캐시 · 전환 서비스 CAS 0행 → 409 · 실행기 분류 표(§11.4) · `judgeRecovery` 3분기 · 훅 → 저장소 위임 |
| 통합(`migrate deploy`) | ★ **AC-EN1-1**(모드 꺼진 챗봇: 기존 스위트 무수정 통과 · 공개 대화 Prisma 쿼리 수 = 도입 전 · 로그 `servedVersionId` null · 보존 저장소 0행) · ★ **AC-EN1-2**(켜기 전후 같은 입력 세트 공개 응답 동일 — 동점 픽스처 · 의미 매칭 켠 챗봇 포함) · AC-EN1-3(`HELD(ENV_MODE_CHANGED)`) · AC-EN1-4/5(끄기 2방식 · `ENV_DRAFT_NOT_RESTORED`) · ★ **AC-EN2-1**(초안 편집 9종 후 공개 응답·`getConfig` 불변) · ★ **AC-EN2-2**(운영 = 같은 버전 시뮬레이터 = 같은 버전 TC — 매칭·의미 점수 순위) · AC-EN2-3/4(토픽·설문 즉시 반영) · ★ **AC-EN2-5**(2인스턴스 — 전환 커밋 후 두 번째 요청부터 두 인스턴스 모두 새 버전, `servedVersionId` 확인 — 동적 import로 앱 2개) · ★ **AC-EN3-1**(FAQ X 대체 질문 변경 + FAQ Y 삭제 + 재색인 완료 후 운영 점수 동일) · AC-EN3-2(승격→전환 임베딩 호출 0 — 목 provider 호출 계수) · AC-EN3-3 · ★ AC-EN4-3/5/6(stale · 롤백 자산 쓰기 0 · 동시 전환 `Promise.all` 1건만) · AC-EN4-7(삭제 409·정리 제외) · ★ **AC-EN5-2**(예약 후 수동 전환 → `STATE_CHANGED` · 후속 `HELD`) · AC-EN5-1/3/4/5(가짜 시계 · 2인스턴스 선점) · AC-EN6-1~6 · AC-EN7-1~5 · AC-EN8-1/2/4 · **마이그레이션 시험**: 적용 후 부분 유니크 4개 존재 · 새 테이블·인덱스 |
| 정적 | ★ E-1~E-17 + 역검증(AC-EN8-3) |
| 접근성 | axe(환경 화면·확인 창·시뮬레이터 대상 선택) · 키보드만으로 승격·전환·롤백 |

- 선택 기능을 켜야 하는 시험(예약 엔진 루프 등)은 **동적 import**로 앱을 로드하고 `tick()`을 직접 호출한다(CLAUDE.md 시험 격리 규약). 환경 모드 자체는 환경변수가 아니라 API로 켠다.
- **시험데이터 고정표**(`시험데이터.md` — test-automation 단계): 동점 노드 3개(같은 priority·조건 수·matchMode, `updatedAt`만 다름) · 동점 의도 예문 2개(같은 문장·다른 의도·다른 `createdAt`) · 동점 FAQ 2개 · 의미 매칭 픽스처(목 provider 결정적 벡터) · 게이트 판정 표.

### 24.2 ★ 의도된 기존 시험 기대값 변경 (닫힌 목록 — FR-0-158 확정)

전수 확인(`Permission.options` · `toHaveLength(17)` · `@Public` 컨트롤러 목록 · 영구삭제 트랜잭션 목 · 생성자 위치 인자 · `assertReadable` 목 · 동작/트리거/대상 유형 enum 단언) 결과:

| # | 파일 | 변경 | 비고 |
|---|---|---|---|
| X-1 | `apps/api/src/common/auth/lib/permission-matrix.spec.ts` | 29~30행 `toHaveLength(17)` → `18` · `arrayContaining`에 `'chatbot:deploy'` · `it` 제목 "17종" → "18종(No.40 `chatbot:deploy`)" · 16행 제목 "17종" → "18종" | 숫자 단언 |
| X-2 | `apps/api/src/topics/lib/topic-sealing.spec.ts` T-10 | 370행 `toBe(17)` → `toBe(18)` · `describe`/`it` 제목 | 숫자 단언 · `AuditAction` 14 **불변** |
| X-3 | `apps/api/src/common/auth/public-decorator-count.spec.ts` | `EnvironmentController` import·목록 등록 · 95행 제목 "34개" → "35개" · 기대 `@Public()` 목록 **불변(8)** | 새 컨트롤러 등록(리뷰 규약) |
| X-4 | `apps/api/src/chatbots/chatbots.service.spec.ts` | `buildTxMock()`에 `embeddingTextVector`·`environmentSwitchLog`·`chatbotEnvironment` `deleteMany` 목 3줄(없으면 `undefined.deleteMany`로 실패) · 96행 제목 "16개" → "19개" · 머리 주석 · (선택) 새 3건 `toHaveBeenCalledWith` 단언 추가 | ★ 발견 제약 ④ |
| X-5 | `apps/api/src/deploy-schedules/lib/deploy-schedule-sealing.spec.ts` | **변경 없음(확인 항목)** — D-10(switch/case 허용 파일 3개)에 새 `case`가 `required-permissions.ts`(허용 파일)에만 생기는지, 새 실행기·훅 파일이 D-1·D-2·D-12를 통과하는지 확인 | 확인만 |

**변경하지 않아도 통과해야 하는 것(회귀 감시)**: `public-conversation.service.spec.ts`(생성자 15인자 호출 — 16번째는 선택 · 초안 경로 호출 불변) · `handoff-hints.service.spec.ts`·`test-run.service.spec.ts`(`assertReadable` 목 `undefined` → `?.` 방어) · `test-run.executor.spec.ts`·`query-embedding-cache-isolation.spec.ts`(위치 인자 — 새 인자 선택) · `simulation`·`answer-settings` 스펙 · `version-sealing.spec.ts` V-1~V-10(V-2 `chatbot.update(`는 `versions/**` 한정 — 포인터 쓰기는 `environment/**`의 `updateMany`) · `snapshot-canonical.spec.ts`·`snapshot-upcasters.spec.ts`·골든 해시(보조 필드는 해시 밖) · `version-restore.service.spec.ts`(`hydrateSnapshot` 목 — 복원 경로 불변) · `retention-policy.spec.ts`(순수 함수 불변) · `readiness-warnings.service.spec.ts`(합격률 식 동치) · `deploy-schedule-sealing.spec.ts` D-1~D-16 · `validation-sealing.spec.ts` 1)~10) · `feedback-sealing.spec.ts` F-1~F-16(F-10은 `create.data`에 키 추가 허용) · `stats-retention-sealing.spec.ts` R-1~R-10(R-7 `$queryRaw` 4파일 불변 — 원시 SQL 0) · `topic-sealing.spec.ts` T-1~T-16(T-10 제외) · `handoff-sealing.spec.ts` · `survey-sealing.spec.ts` · `legacy-api-sealing.spec.ts` · `asset-write-sealing.spec.ts` S-1(허용 파일 3개 불변) · `validation-regression.integration.spec.ts`(엔드포인트 21개 — 실행 시작 경로 추가 0) · 웹 `TopBar.handoff.spec.tsx` · 통합 스위트 전체. **이 목록 밖의 기존 시험이 깨지면 회귀로 취급한다**(커밋 ①에서 깨지면 멈추고 보고).

> 모드 꺼진 챗봇의 보존 정리·버전 삭제 경로에는 쿼리 1개(`chatbotEnvironment.findUnique`)가 더해진다 — 공개·응답 경로가 아니며 쿼리 수를 단언하는 기존 시험은 없다(전수 확인).

---

## 25. 요구사항 추적표

| 요구사항 | 설계 위치 |
|---|---|
| FR-0-149 엔진·ml-worker·위젯 변경 0 | §2.3 · §8.5 · E-5/E-10 |
| FR-0-150 모드 꺼짐 바이트 동일·조회 0 | §3.1 · §7.1 · §7.2 · §21 P-1 · AC-EN1-1 |
| FR-0-151 `@Public()` 8 | §19.1 · E-6 |
| FR-0-152 버전 본문 불변 | §7.3 · §7.5 · E-4 |
| FR-0-153 자산 테이블 쓰기 0 | §9.1 · E-1/E-2 |
| FR-0-154 `restore()` 호출부 2 | §5.4 · E-3 |
| FR-0-155 본문·발화 0 · 메모 로그 금지 | §3.1 · §18 · E-13 |
| FR-0-156 권한 1종·역할 0 | §17 · E-14 |
| FR-0-157 오류 코드 | §19.3(8종) |
| FR-0-158 기대값 변경 닫힌 목록 | §24.2 |
| FR-0-159 선택 환경변수 | §3.4 |
| FR-0-160 문구 | §23 |
| FR-EN1-1~7 모드 | §5 · §11.6 |
| FR-EN2-1~8 서빙 | §6 · §7 · §16 |
| FR-EN3-1~4 의미 매칭 | §8 |
| FR-EN4-1~8 승격·전환·롤백·이력 | §9 · §13.3 |
| FR-EN5-1~5 예약 전환 | §11 · §13.2 |
| FR-EN6-1~6 시뮬레이터·TC·게이트 | §10 · §12 |
| FR-EN7-1~4 복원·보존 | §5.4 · §13 |
| FR-EN8-1~6 로그·통계·큐·평가·힌트 | §7.1 · §14 · §15 |
| FR-EN9-1~3 권한·감사·봉인 | §17 · §18 · §20 |
| NFR-ENP1~5 | §21 |
| NFR-ENS1~4 | §7.5 · §17.2 · §19.3 · E-9 |
| NFR-ENA1~4 | §23 |
| NFR-ENM1~3 | §7.1 · §10 · ADR-0039 재검토 트리거 |
| C-1 · C-2 · C-3 · C-4 | §6 · §8 · §7 · §5.3/§11.6 |

---

## 26. 범위 밖 (재검토 트리거는 요구사항 §9 · ADR-0039)

비율 분할(카나리·A/B) · 서버 간 이관(export/import — 2차: ADR-0037 적재기 + 차이 적용 + 영속 ID 대응표 + 파일 형식·서명) · 복제 챗봇 체인 · 사용자 정의 환경 · 스테이징 외부 미리보기 링크 · 2인 승인 · 전환 후 자동 롤백 · 버전별 통계 비교 화면 · 평가 원장의 버전 귀속 컬럼 · 설문/API 연결/상담 설정/토픽의 환경 분리 · 토픽 단위 승격 · 환경 간 대화 비교(`compare`의 A/B = 두 버전) · 엔진·위젯·ml-worker 변경.

---

## 27. 알려진 제한

| # | 내용 | 대응 |
|---|---|---|
| L-1 | 운영 전환은 `Chatbot.updatedAt`을 갱신한다(목록 "최근 변경" 상승) | 수용(§9.5) |
| L-2 | 보조 필드 없는 과거 스냅샷은 동점을 `id asc`로 가른다 | `LEGACY_TIEBREAK` 경고(동점 가능할 때만) · 커밋 ① 선배포 권장 |
| L-3 | "반영 후 재발생" 배지는 시간 판정이지만 `recurredCount` 숫자·`recurredOnly` 필터는 미반영 기간 발생을 포함한다 | 배지 툴팁 "운영 반영 전 발생 포함" · 정확한 분리는 수집기 변경이 필요해 보류(봉인 우선) |
| L-4 | 초안 편집마다 L2가 비워져 다음 공개 요청이 합성 1회를 치른다 | L1 적중이라 가볍다 · 편집 빈도 문제 시 설문·토픽 전용 무효화 분리(트리거) |
| L-5 | 임의 버전(보호 밖)을 시뮬레이터·TC 대상으로 고르면 초안에서 사라진 문장의 벡터가 없을 수 있다 | `semanticMissing` 표시 · 운영 전환 대상(스테이징·이력)은 항상 보호 |
| L-6 | 끄기 "운영 유지" 후 라이브 동점 승자는 복원이 바꾼 행의 `updatedAt` 때문에 끄기 직전 운영과 다를 수 있다 | 끄기 미리보기 `potentialTieShift` 경고 · 복원 의미론(ADR-0031 §3) 불변 우선 |
| L-7 | 전환 직후 다른 인스턴스의 첫 요청은 L1 구축 지연(≤1.5초)을 치른다 | 현재 인스턴스 예열 · 다중 인스턴스 예열은 운영 요구 시 |
| L-8 | 모델 교체 직후 초안에 없는 버전 문장은 콘솔 현황 조회 전까지 재임베딩되지 않는다 | 현황 조회 시 백그라운드 재시도(쿨다운 60초) · 전환 미리보기 경고 |
| L-9 | 목록 수준 "삭제됨" 표시는 버전을 읽지 않는다 | 상세에서 버전 이름 확인(§15.2) |
| L-10 | 망분리 구축형(개발/운영 서버 분리)은 1차에서 한 서버 안의 초안/스테이징/운영으로 운영해야 한다 | 2차 서버 간 이관(P-1 (d)) |

### 27.1 구현 편차 (backend-implementer, 2026-09-25 — PM 지시로 기록)

| # | 편차 | 사유 | 수용 여부 |
|---|---|---|---|
| I-1 | 보호 버전 판정 순수 함수(`computeEnvironmentProtectedIds`)가 설계 원안이 암시한 `environment/core/lib/`가 아니라 `versions/lib/environment-protected-versions.ts`에 있다 | 버전 보존·삭제 보호는 `versions` 도메인의 기존 보존 정책(`retention-policy.ts`)과 같은 계층이라 그 옆에 두는 편이 응집도가 높다 — `environment/core`가 이 함수를 import해서 쓴다(방향은 설계 의도(§2.2 경계) 그대로 유지) | 수용(오케스트레이터 수용) |
| I-2 | `EnvironmentPointerWriter`가 단일 provider가 아니라 `EnvironmentCoreModule` 안에서만 providers 배열에 등록되고 export되지 않는 구조라, 사실상 그 모듈의 소비자(`ProdSwitchService`·`EnvironmentModeService` 등)가 각자 주입받는 것처럼 보이지만 실제로는 Nest DI가 모듈 스코프 내 **단일 인스턴스**를 공유한다(2개의 "별도 인스턴스"가 아니라 export 여부로 주입 가능 범위를 좁힌 것) — 최초 보고 시 "2인스턴스"로 오기술했다 | Nest 모듈 캡슐화 원칙(provider는 자기 모듈 안에서만 재사용, export한 것만 밖에서 주입 가능)을 그대로 따른 결과 — 포인터 쓰기 유일 파일(E-1)이라는 봉인 목표는 인스턴스 수가 아니라 "그 클래스를 import할 수 있는 모듈이 1개"로 이미 만족된다 | 수용(오케스트레이터 수용) — 최초 보고 문구 정정. **주의**: 이 표에서 "PM 확인/승인"으로 적혔던 문구는 실제로는 오케스트레이터가 검토·수용한 것이었다(2026-09-25 R1 리뷰 반영 시 정정 — I-1·I-2 2건뿐, I-3~I-5는 원래 "보고"였고 승인 표시가 없었다) |
| I-3 | 설계서 §2.5 파일 변경표는 시뮬레이터(`simulation.service.ts`)·TC 실행기(`test-run.executor.ts`)의 생성자 변경을 "+1(끝)"로, `validation.module.ts`·`learning.module.ts`의 import 추가를 `EnvironmentServingModule` 1개로 적었다. 실제 구현은 두 곳 다 **2개**를 추가했다 — `EnvironmentReadService`(포인터 해석, `EnvironmentCoreModule` 소속)와 `VersionBundleService`(번들 조회, `EnvironmentServingModule` 소속)가 서로 다른 모듈의 별개 서비스이기 때문이다(설계서 §12.1/§12.2 본문은 "환경 행·챗봇 행 조회"라고만 적어 인라인 쿼리처럼 보일 수 있으나, 이미 있는 `EnvironmentReadService.getPointerStatus()` 추상화를 재사용하는 편이 직접 Prisma를 또 호출하는 것보다 일관적이라고 판단했다) | 기존 추상화 재사용이 새 인라인 쿼리보다 유지보수에 유리하다고 판단 — 영향받은 파일: `simulation.service.ts`(생성자 9→11번째·10번째 2개), `simulation.module.ts`(+2 모듈), `test-run.executor.ts`(생성자 +2), `test-run.service.ts`(생성자 +1, `environmentRead`), `validation.module.ts`(+`EnvironmentCoreModule`), `handoff.module.ts`(+`EnvironmentServingModule`만, 이쪽은 설계와 일치), `learning.module.ts`(+2 모듈, §15.1/15.2 배선용) | 보고 — 봉인 시험(validation-sealing 등)이 이미 이 두 모듈을 허용 목록에 넣고 있어 구조적 문제는 없다 |
| I-4 | `SWITCH_PROD_VERSION` 예약의 미리보기(`switchProd.gate`/`diffSummary`/`warnings`)는 체인 기준(선행 예약이 먼저 실행된 뒤의 가상의 운영)이 아니라 **항상 "지금의 실제 운영"**을 기준으로 계산한다. 2026-09-25 보강으로 `switchProd.expectedProdVersionId`(CAS에 실제로 쓰이는 값)만 체인을 정확히 반영하도록 고쳤다 — 화면에 보이는 게이트 판정·차이 요약·경고 문구는 여전히 실제 현재 운영 기준이다 | 체인 기준으로 게이트·차이를 다시 계산하려면 선행 예약의 대상 버전을 마치 "이미 적용된 것처럼" 가정해 번들을 다시 합성해야 해 비용이 크고, 실행 시점에 게이트는 어차피 재평가된다(§11.3 ④) — 표시값은 참고용, CAS 저장값만 안전성에 관여한다 | 보고 — 콘솔은 "체인 예약의 미리보기는 참고용(실제 실행 시 재평가)"이라는 안내 문구를 붙이는 편이 좋다 |
| I-5 | `TestRun`(목록·상세) 응답의 `target.legacyTiebreak`/`target.semanticMissing`은 항상 `false`/`0` 고정값이다. 실제 값(실행 당시 계산된 값)은 `envFingerprint.target`(같은 실행의 지문 필드)에만 있다 | 목록/상세 매퍼(`test-run.mapper.ts`)는 DB 컬럼(`targetKind`/`targetVersionId`/`targetVersionNo`)만으로 매핑하고 `legacyTiebreak`/`semanticMissing`을 저장하지 않는다 — 저장하려면 스키마 변경이 필요해 범위를 지문 필드로 좁혔다 | 보고 — 콘솔은 이 두 필드를 `TestRun.target`이 아니라 `envFingerprint.target`에서 읽어야 정확하다(필드명 동일이라 착각하기 쉽다) |

### 27.2 코드 리뷰 R1 반영 (backend-implementer, 2026-09-25)

| # | 지적 | 수정 내용 | 비고 |
|---|---|---|---|
| R1-H1 | `prod-switch.service.ts` `switch()`/`rollback()` 확정 시 `acknowledgeWarnings` 검사가 `gate.verdict`(WARN/BLOCK)만 보고, `preview()`가 계산하는 §9.4의 다른 경고(LEGACY_TIEBREAK·PROFILE_WILL_CHANGE·SURVEY_MISSING 등)는 우회할 수 있었다 | `preview()`·`switch()`가 공유하는 `assembleSwitchWarnings()`(신규 private 메서드)로 경고 조립을 한 곳으로 합치고, `switch()`는 `switchWarnings.length > 0 && acknowledgeWarnings !== true` → 400으로 바꿨다. 겸사겸사 `deploy-schedule.service.ts#create()`에 SWITCH_PROD_VERSION 예약 생성 시 `previewResp.switchProd.warnings` 기준 동일 검사가 **아예 없던 공백**도 함께 메웠다(§11.2 "경고가 있으면 acknowledgeWarnings 필수"가 미구현이었다) | 통합 시험 §M(2건) — PROFILE_WILL_CHANGE 단독 경고로 비게이트 acknowledge 경로를 재현 |
| R1-M1 | `VersionBundleService.invalidateChatbot()`/`invalidateVersion()`에 호출부가 0건이었다(§13.2·§5.4 문구는 있었으나 배선이 빠짐) | `versions`(버전 삭제)·`environment/core`(전환·롤백 확정)는 §2.2 경계상 `environment/serving`을 직접 import할 수 없어, `common/events/environment-cache.events.ts`(신규 — Node `EventEmitter` 기반 전역 이벤트 버스, `PrismaModule`과 같은 `@Global()` 패턴)를 신설했다. `VersionRetentionService#deleteOne()`은 커밋 후 `emitVersionDeleted()`를, `ProdSwitchService#switch()`는 커밋 후 `emitChatbotPointerChanged()`를 발행하고 `VersionBundleService`가 두 이벤트를 구독해 `invalidateVersion`/`invalidateChatbot`을 호출한다. `EnvironmentModeService#disable()`은 최상위 `environment` 모듈이라 `serving`을 직접 import할 수 있어 이벤트 없이 `invalidateChatbot()`을 직접 호출한다 | 통합 시험 §N — 시뮬레이터 대상으로 캐시를 데운 뒤 그 버전을 삭제하면 같은 versionId 요청이 404가 됨을 확인 |
| R1-M2 | `EnvironmentModeService#enable()`이 `RestoreLockRegistry`를 보지 않아 복원 진행 중에도 켜기가 진행될 수 있었다(§5.3 ①) | `RestoreLockRegistry`(기존 `versions/restore/restore-lock.registry.ts`)를 `VersionsModule` 전용 provider에서 `RestoreLockModule`(신규 — "1 export = 1 모듈" 공유 패턴, `VersionCaptureModule`·`VersionReadModule`과 동형)로 분리해 `VersionsModule`·`EnvironmentModule` 양쪽이 **같은 인스턴스**를 주입받게 했다. `enable()` 진입부에서 `restoreLock.isLocked(chatbotId)` → `409 ENV_SWITCH_BUSY` | 통합 시험 §O — 잠금 중 409, 해제 후 성공 확인(단위 시험 대신 통합으로 — DI 배선 자체가 검증 대상이라) |
| R1-L1 | (Low, 수정 불필요) `embedMissing()`의 P2002 처리는 설계 허용 범위 — 변경 없음 | — | — |

---

## 28. 요구사항 대비 해석 (architect 판단)

| # | 요구사항 | 해석·조정 | 근거 |
|---|---|---|---|
| R-1 | FR-EN2-4 "해시 밖 `updatedAt` 보조 필드" | 노드 `updatedAt`만 담고, **배열 순서 재현(생성순 재정렬)을 추가**한다 | 발견 제약 ① — 의도·FAQ 동점은 배열 순서가 결정 |
| R-2 | FR-EN1-2 "해시 같으면 최신 버전 재사용" | **`contentHash` ∧ `tiebreakHash`** 동일일 때만 재사용 | 발견 제약 ③ |
| R-3 | FR-EN6-1 "시뮬레이터 대화·비교에 대상 선택" | **대화만** 대상 선택, 비교는 초안 고정 | 비교는 오버레이 전용이고 오버레이는 초안만(같은 요구 FR-EN6-1 · AC-EN6-2) — 환경 간 비교는 버전 차이 화면과 TC가 담당 |
| R-4 | FR-EN8-1 "운영 버전 서빙 턴 = 버전 id" | **엔진·BLOCK·상담 턴 공통**으로 그 시점 운영 포인터를 적재 | 세션 단위 귀속(2차 분할의 분모)·단일 규칙 |
| R-5 | FR-EN3-2 "재사용 키를 `(chatbotId, modelId, textHash)`로 주소화" | 슬롯 테이블 키는 그대로, **별도 보존 저장소**를 그 키로 주소화 | 모드 꺼진 챗봇 색인 경로 완전 불변(FR-EN3-4) |
| R-6 | FR-EN1-3 "끈 뒤 포인터는 제거" | 포인터 제거 + **환경 행은 유지**(게이트 설정 보존) · 판정은 `prodVersionId` 1곳 | 재활성화 시 게이트 재설정 부담 제거 |
| R-7 | FR-0-157 오류 코드 6종 | **8종**(+`ENV_MODE_ALREADY_ENABLED`·`ENV_DRAFT_NOT_RESTORED`) | "같은 코드, 다른 의미" 금지(ADR-0032 선례) |
| R-8 | FR-EN5-1 "params = `{ targetVersionId, expectedProdVersionId }`" | 그대로 + 생성 요청은 `previewedProdVersionId`(체인 기준 확인) · 전제 조건 사유 `SWITCH_BLOCKED` 1종 | 복원 예약의 `previewedContentHash`·`RESTORE_BLOCKED` 선례 |
| R-9 | EX-EN-1 "폴백 문구 + 경고 로그" | 공개 대화 = 엔진 미호출 폴백 턴 + 로그(`isAnswered:false`) · `getConfig`는 챗봇 행 값 · 음성 캐시 30초 | 초안 몰래 대체 금지 + 가용성 |
| R-10 | EX-EN-11 "진행 중 작업 판정" | 켜기는 **허용**(자산 쓰기 0) | 복원 차단 사유(자산 쓰기)가 없다 |
| R-11 | FR-EN8-4 "운영 미반영 배지" | `RESOLVED`(예문 반영·직접 수정 완료) 항목만 · 판정 입력 = 전환 이력 비정규화 컬럼 | 조인 없는 요청당 1쿼리 |
| R-12 | FR-EN2-5 "토픽 활성·설문 변경·전환 시 무효화" | 무효화는 기존 `invalidate()` 1곳(토픽·설문은 이미 호출) · 전환은 키에 버전 id가 있어 무효화 불필요 | 무효화 지점 1곳 규약 |
| R-13 | P-10 표시 설정 | 버전 읽기 실패 시 `getConfig`는 챗봇 행 값 | 표시 설정은 답변이 아님 |
| R-14 | J-19 감사 "액션은 architect" | 기존 `STATUS_CHANGE`·`UPDATE` 재사용 | `AuditAction` 14 불변(T-10) |

---

## 29. GPU · 배포 형태

| 연산 | 성격 | GPU |
|---|---|---|
| 포인터 조회·전환·이력·게이트 | DB CRUD · 순수 함수 | 불필요 |
| 스냅샷 역직렬화·재정렬·검증·인덱스 | CPU(JSON·정렬) — 캐시 미스 시 1회 | 불필요 |
| 의미 색인 보존 | 기존 벡터 **복사**(추가 임베딩 0 — 경합·모델 교체 예외만 기존 경로 호출) | 불필요 |
| 버전 대상 TC | 기존 TC와 같은 연산량 | 기존과 동일 |

→ **GPU 1 유지.** **구축형 ○**(한 서버 안의 논리 분리 · 신규 인프라 0 — 망분리 개발/운영 서버는 2차) · **구독형 ○**(인프라 변화 없음 · 챗봇당 버전 코어 메모리를 용량 산정에 반영 — §21 P-10).
