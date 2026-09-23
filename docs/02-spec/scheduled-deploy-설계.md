# 운영 예약 배포 세부 설계서 (No.28)

> **요구사항**: `docs/requirements/scheduled-deploy.md`(J-1~J-15, FR-0-78~87, FR-D1-\*~FR-D7-\*, NFR-DP/DS/DA/DM, AC-D1~D6, EX-D-1~20)
> **상위 문서**: `docs/02-spec/개발명세서.md` §2·§2.1·§2.2·§3·§3.1·§4·§4.1·§5·§5.1·§6(**결정 33 신설**)·§7
> **신규 ADR**: **ADR-0032**(운영 예약 배포 = 1회성 동작 예약 + 인프로세스 폴링/DB CAS 선점/임대 · 반영은 No.25 복원·공개 전환 재사용 · 엄격 해시 바인딩 · draft/published는 No.40)
> **갱신 ADR(각주만)**: ADR-0031(예약 실행기의 `restore()` 호출 도입 · `RESTORE_BUSY` 분리) · ADR-0025(봉인 문구 개정 — "관리자 요청 핸들러 1곳" → "관리자 요청 핸들러 또는 관리자가 미리보기로 승인한 예약의 실행기, 둘 다 `restore()` 경유") · ADR-0016(`DeploySchedule` 대상 · 예약 실행 주체 = 예약자 `actorOverride`) · ADR-0015(신규 권한 0종 · 실행 시 재검증) · ADR-0027(임대 기반 정리 참고) · ADR-0002(영구삭제 동반 삭제 14테이블) · ADR-0011(공개 전환 원자 경로 `ChatbotPublicationService`)
> **작성일**: 2026-09-23 · **GPU**: **1 유지**(새 모델 0 · ml-worker 변경 0). ml-engineer 신규 작업 없음 — §19.
> **기존 파일 수정 목록**: 문서는 `docs/02-spec/scheduled-deploy-patches.md`, 코드는 이 문서 §2.5·§9.

---

## 0. 표기 규약 (요구사항 번호 혼동 방지)

요구사항 문서의 FR 접두사는 절 번호와 일치하지 않는 곳이 있다. 특히 **`FR-D4-0`·`FR-D4-0a`는 §4.4(misfire) 소속**이고 **`FR-D4-1`~`FR-D4-5`는 §4.6(예약 이후 상태 변경) 소속**이다. 이 문서는 요구사항 문서를 수정하지 않고, 인용할 때 **항상 괄호로 소속 주제를 병기**한다.

| 요구사항 ID | 소속 절 | 이 문서의 인용 형태 |
|---|---|---|
| FR-D1-1~3 | §4.1 동작 유형 | FR-D1-n |
| FR-D2-1~15 | §4.2 생성·미리보기·시각·권한 | FR-D2-n |
| FR-D3-1~15 | §4.3 관리·실행 엔진 | FR-D3-n |
| **FR-D4-0** | **§4.4 misfire** — 유예 환경변수 | **FR-D4-0(misfire 유예)** |
| **FR-D4-0a** | **§4.4 misfire** — "지금 다시 예약" | **FR-D4-0a(다시 예약)** |
| FR-D4-1~5 | §4.6 예약 이후 상태 변경 | FR-D4-n(상태 변경) |
| FR-D5-1~4 | §4.5 실행 게이트 | FR-D5-n |
| FR-D6-1~7 | §4.7 알림·감사 | FR-D6-n |
| FR-D7-1~8 | §4.8 콘솔 | FR-D7-n |

---

## 1. PM 확정 사항 (2026-09-23 — §11 P-1~P-12 전부 기본 제안값)

| # | 확정 내용 | 이 문서에서의 반영 |
|---|---|---|
| P-1 | 반영 대상 = (a) 버전 예약 복원 + (b) 공개 상태 예약 전환. 동작 3종 `RESTORE_VERSION`·`PUBLISH`(DRAFT→ACTIVE, 선택 시 WEB 채널 동시 활성화 — **같은 트랜잭션**)·`SET_WEB_CHANNEL`. (c) draft/published는 No.40 | §5(실행기 전략 패턴 · 레지스트리 매핑 타입으로 **동작 추가 = 파일 1개 + 레지스트리 1줄**) · §5.4(공개 전환 원자 경로) · §5.6(No.40 "포인터 전환" 확장점) |
| P-2 | 준비 편집의 운영 노출 한계 수용 | §20 L-1 · ui-designer 인계(빈 상태·생성 대화상자 안내문) |
| P-3 | 실행 전 TC 게이트 없음(G0 정합성 차단 + G0' 준비도 경고), 실행 직후 TC(G3) 옵션·기본 꺼짐, 자동 롤백 없음 | §11(G3) · §12(G0') · G0는 기존 실행부 판정 그대로(FR-D5-1) |
| P-4 | 엄격 바인딩: 생성 시 기준 해시 저장, 불일치면 미실행 + "확인 필요", 후속 HELD, 편집 화면 충돌 배너 | §6.2(체인 기준 해시) · §7.6(분류표 `STATE_CHANGED`) · §7.7(HELD 전파) · §13.1 `notice` 엔드포인트 |
| P-5 | misfire: 유예 10분 이내 지연 실행, 초과 `MISSED` | §7.5(**유예 + 폴링 1주기 허용오차**) |
| P-6 | 일시적 원인만 30초 간격 최대 15분 재시도 | §7.6 |
| P-7 | 챗봇당 활성 5건·리드 5분·최대 90일·같은 챗봇 예약 간 1분·수정은 시각/메모만 | §6.3 · §4.2 부분 유니크 인덱스(1분 간격의 DB 차원 보장) |
| P-8 | 선행 실패/누락 시 같은 챗봇 후속 전부 HELD | §7.7 |
| P-9 | 신규 권한 0종 · 실행 시 예약자 계정 상태·권한 재확인 · 감사는 `actorOverride`로 예약자 명의 `[예약 실행]` | §8 |
| P-10 | 알림 = 콘솔 + 감사로그만 | §13(`summary` 엔드포인트) · 아웃바운드 0건 정적 검사(§16 D-4) |
| P-11 | `SET_WEB_CHANNEL` 포함 | §5.5 |
| P-12 | GPU 1 | §19 |
| (architect) | 스케줄러 = 인프로세스 30초 DB 폴링 + CAS 선점 + 임대(lease). `setTimeout` 개별 예약·`@nestjs/schedule`·외부 cron 기각. UTC 저장, API는 오프셋 포함 ISO 8601만, 표시는 `STATS_TIMEZONE` | §7 · §14 · ADR-0032 |

---

## 2. 아키텍처 배치

### 2.1 신규 모듈 `apps/api/src/deploy-schedules/` + 공용 부품 `common/polling/`

기존 4계층 규약(개발명세서 §2.1)을 따른다. 예약 모듈은 **자산을 쓰지 않는다** — 자산·상태·채널을 바꾸는 코드는 전부 기존 모듈의 **공개 서비스 1개씩**(`VersionRestoreService`·`ChatbotPublicationService`) 뒤에 있고, 예약 모듈은 그 서비스를 **언제 호출할지**만 결정한다(FR-0-79).

```
apps/api/src/common/polling/                     # ★ 도메인 무관 부품(NFR-DM3 — No.45 정리 배치가 재사용 가능)
├── polling-loop.ts                              # setTimeout 체인 주기 루프 · 겹침 방지 · 예외 흡수 · stop()이 진행 중 tick을 기다림
├── polling-loop.spec.ts
├── clock.ts                                     # Clock 포트({ now(): Date }) + SystemClock + 주입 토큰 CLOCK
└── lease.ts                                     # isLeaseExpired(claimedAt, now, leaseMs) 등 순수 함수

apps/api/src/deploy-schedules/
├── deploy-schedules.module.ts
├── deploy-schedules.controller.ts               # 챗봇 스코프 10개 핸들러(§13.1)
├── deploy-schedules-global.controller.ts        # /deploy-schedules 3개 핸들러(목록·요약·메타)
├── deploy-schedule.service.ts                   # 생성·수정·취소·재개·확인 + AuditLog 기록 지점 + 권한 판정(§8.2)
├── deploy-schedule.query.service.ts             # 목록·상세·notice·summary·meta(읽기 전용)
├── deploy-schedule.mapper.ts
├── preview/
│   └── deploy-schedule-preview.service.ts       # 생성 전 미리보기(체인 기준 결정·blockers·준비도) — 쓰기 0
├── readiness/
│   └── readiness-warnings.service.ts            # G0' 준비도 경고(조회 시점 계산, 저장 안 함 — FR-D5-2)
├── engine/
│   ├── deploy-schedule.engine.ts                # ★ 라이프사이클(onApplicationBootstrap/onModuleDestroy) + tick 오케스트레이션
│   ├── deploy-schedule.repository.ts            # ★ 엔진의 상태 전이 쓰기 전부(CAS 선점·종결·재시도 복귀·MISSED·HELD 전파·임대 회수)
│   └── creator-verifier.ts                      # 실행 직전 예약자 재검증(FR-D3-12)
├── executors/
│   ├── deploy-action-executor.ts                # 전략 인터페이스(§5.1)
│   ├── executor.registry.ts                     # { [A in DeployScheduleAction]: Executor<A> } — 누락 = 컴파일 오류
│   ├── restore-version.executor.ts              # ★ VersionRestoreService.restore() 호출 유일 파일
│   ├── publish.executor.ts                      # ChatbotPublicationService.publish()
│   └── set-web-channel.executor.ts              # ChatbotPublicationService.setWebChannel()
├── post-run/
│   └── post-run-test.starter.ts                 # G3 — TestRunService.start() 호출 유일 파일(§11)
└── lib/                                         # DB·Nest·시계 무의존 순수 함수(NFR-DM1) — 전부 now를 인자로 받는다
    ├── tick-planner.ts                          # 도래 선정 · misfire · 재시도 창 · 임대 만료 · 앞선 HELD 판정
    ├── outcome-classifier.ts                    # 오류 → APPLIED/NOOP/TRANSIENT/PERMANENT(§7.6 표)
    ├── chain-rules.ts                           # 기준 해시 결정 · 복원 체인 append 규칙 · 순서 보존 규칙 · 후속 보류 대상
    ├── recovery-judge.ts                        # 임대 만료 행의 실제 상태 판정(§7.8)
    ├── required-permissions.ts                  # 동작 → 권한 목록(생성·관리·실행 재검증 공용 단일 소스)
    ├── result-summary.ts                        # resultSummary 조립(number/boolean/uuid만)
    └── deploy-schedule-sealing.spec.ts          # 정적 검사(§16)

apps/api/src/channels/
└── publication.service.ts                       # [신규] ChatbotPublicationService — 상태+WEB 채널 원자 전환(§5.4)
```

### 2.2 모듈 의존 방향 (단방향)

```
deploy-schedules → versions(VersionRestoreService · VersionDiffService — export 추가, applier는 export하지 않는다)
                 → version-capture(VersionCaptureService — 상태 점검·기동 정리의 현재 해시 계산, 읽기 전용)
                 → channels(ChatbotPublicationService — export 추가)
                 → chatbots(ChatbotScopeService)
                 → validation(TestRunService — export 추가, G3 전용 1파일)
                 → audit-logs(AuditLogService)
                 → prisma · config
```

**import 하지 않는 모듈(봉인 — §16 정적 검사로 단언)**

| 금지 대상 | 이유 |
|---|---|
| `IntentsModule`·`KeywordsModule`·`FaqsModule`·`DialogNodesModule`·`ContextsModule`·`HomonymsModule`·`AnswerSettingsModule`(쓰기 경로) | 예약 모듈이 자산을 **직접 쓸 수단 자체**가 DI 그래프에 없어야 한다(FR-0-79, ADR-0025 L1과 같은 방식) |
| `AugmentationModule`·`LearningModule`·`ClassifierModule`·`TrainingJobsModule`·`ConversationModule` | 승격 유일 지점·반영 경로·대화 로그가 DI 그래프에 들어오지 않는다. 진행 중 작업·TC 결과는 **Prisma 읽기**로만 본다 |
| `VersionRestoreApplier`(심볼) | `VersionsModule`이 **export하지 않으므로 주입 불가** + 심볼 0건 정적 검사(이중 봉인). 자산 변경은 오직 `restore()` 경유(J-11) |
| `@nestjs/schedule`·`cron` 패키지 | J-3 기각 결정의 구조적 보장 |

`ChatbotsService.updateStatus()`·`ChannelsService.upsert()`도 **호출하지 않는다** — 둘은 관리자 요청 경로 전용이며 트랜잭션 인자·주체 대체를 받지 않는다. 예약은 원자성(FR-D1-3)이 필요하므로 §5.4의 전용 서비스를 쓴다(판정 규칙은 공유 — 복제 없음).

### 2.3 엔진 불가침

`packages/dialogue-engine` **변경 0건**(FR-0-78, AC-D4-10). 이 그룹은 엔진을 호출하지도 않는다. 엔진 패키지에 `deploySchedule` 심볼 0건을 정적 검사가 단언한다(§16 D-9).

### 2.4 `apps/api` 외 워크스페이스 영향

| 워크스페이스 | 변경 |
|---|---|
| `packages/shared-types` | **`deploy-schedule.ts` 신설**(§3) + `common.ts`(`ApiErrorCode` 6종) · `audit.ts`(`AuditTargetType` `DeploySchedule` 14 → 15) · `version.ts`(`VersionTriggerContextSchema.deployScheduleId?` 선택 필드) **append** |
| `packages/dialogue-engine` | **변경 0건** |
| `apps/web` | 예약 목록(챗봇별·전역)·생성 대화상자·상세·자산 편집 화면 충돌 배너·챗봇 목록/대시보드 "확인 필요" 배지·전역 24시간 요약 진입점. 기존 `RestoreDialog`의 409 분기에 **`RESTORE_BUSY` 1개 추가**(§9.1) |
| `apps/widget` · `apps/ml-worker` | **변경 0건** |

### 2.5 기존 코드 변경 목록 (구현자 체크리스트)

| 파일 | 변경 | 근거 |
|---|---|---|
| `versions/restore/version-restore.service.ts` | ① `restore(chatbotId, versionId, dto, invocation?: ScheduledInvocation)` **선택 4번째 인자** ② BUSY 경합 → **`409 RESTORE_BUSY`**(해시 불일치는 계속 `RESTORE_PREVIEW_STALE`) ③ `invocation` 있으면 감사 `actorOverride` + summary 접두, 백업 `persistWithin` meta에 `actor`·`triggerContext.deployScheduleId` 전달 | §9.1, §9.2 · FR-D3-9/11 |
| `versions/capture/version-capture.service.ts` | `PersistMeta`에 `actor?: { id, email }` 선택 필드 — 있으면 `currentActorSnapshot()` 대신 사용 | §9.2 |
| `versions/lib/retention-policy.ts` | `selectVersionsToPrune(metas, policy, justCreatedId, externallyProtectedIds = EMPTY_SET)` 선택 4번째 인자 | §9.3 · FR-D4-1(상태 변경) |
| `versions/capture/version-retention.service.ts` | `pruneBestEffort()`: 버전 메타 읽기 + **활성 예약 참조 버전 읽기 + 삭제를 한 트랜잭션**으로 · `deleteOne(versionId)`: 트랜잭션 안에서 활성 예약 참조 재확인 → `409 VERSION_REFERENCED_BY_SCHEDULE` | §9.3 · FR-D4-1/2(상태 변경) |
| `versions/version.service.ts` | `remove()`는 변경 없음(판정이 `deleteOne` 트랜잭션 안으로 들어간다) — 응답 details 조립만 확인 | §9.3 |
| `versions/versions.module.ts` | `exports: [VersionRestoreService, VersionDiffService]` 추가(**applier는 export하지 않는다**) | §2.2 |
| `versions/lib/version-sealing.spec.ts` | V-3 `OUT_OF_SCOPE`에 `deploySchedule` 추가(버전 모듈은 예약을 **읽기만**) | §16.2 |
| `channels/publication.service.ts` | **신규** `ChatbotPublicationService`(publish / setWebChannel — 단일 트랜잭션 + 커밋 후 감사) | §5.4 |
| `channels/lib/channel-enable-rule.ts` | **신규** 순수 함수 `assertChannelEnableAllowed(type, enabled)` — `ChannelsService.upsert()`의 `IMPLEMENTED` 판정을 **이동**(upsert도 이 함수를 호출하도록 1줄 교체, 동작 불변) | FR-D5-1(판정 복제 금지) |
| `channels/channels.module.ts` | providers·exports에 `ChatbotPublicationService` | §2.2 |
| `validation/validation.module.ts` | `exports: [TestRunService]` 추가(imports 변경 없음 — `validation-sealing.spec.ts` 무수정 통과) | §11 |
| `chatbots/chatbots.service.ts` | `permanentDelete()` 트랜잭션에 `tx.deploySchedule.deleteMany({ where: { chatbotId: id } })` 1건(13 → 14테이블, `tx.chatbot.delete` 직전) | FR-D4(상태 변경 표) · AC-D5-3 |
| `audit-logs/audit-log.service.ts` | `AuditRecordInput.actorOverride` 주석 갱신("auth 경로 전용" → "auth 경로 + 예약 실행기"). 코드 변경 0 | §8.4 |
| `audit-logs/lib/audit-snapshot.ts` | `AUDIT_FIELDS.DeploySchedule` 추가(`Record` 타입이 강제) | §8.4 |
| `config/env.validation.ts` | 선택 환경변수 5종 + 임대 하한 보정 경고 + `STATS_TIMEZONE` 유효성 경고 | §15 |
| `main.ts` | `app.enableShutdownHooks()` 1줄 — SIGTERM 시 엔진 정지·Prisma 종료 훅 실행(정합성은 이것에 기대지 않는다 — 임대가 최종 방어선) | §7.9 |
| `app.module.ts` | `DeploySchedulesModule` 등록 | — |
| `prisma/schema.prisma` + 마이그레이션 1개 | `DeploySchedule` 신설 + `Chatbot.deploySchedules` 역참조 + **부분 유니크 인덱스 2개(원시 SQL, 마이그레이션 파일에만)** + 스키마 하단 경고 주석 | §4 |
| `apps/web/.../versions/restore/RestoreDialog.tsx` | 409 분기(`RESTORE_PREVIEW_STALE`·`RESTORE_BLOCKED_BY_ACTIVE_JOB`)에 `RESTORE_BUSY` 추가(미리보기 자동 재호출) + `messages.ts` 문구 1개 | §9.1 |
| 통합 테스트 부트스트랩 헬퍼 | 기본 `DEPLOY_SCHEDULE_ENABLED=false`(엔진 수동 구동). 기존 테스트 **단언 변경 0** | NFR-DM4/DM5 |

---

## 3. `shared-types` 배치 (`deploy-schedule.ts` 신설)

ADR-0003 §9 배치 규칙 — 관심사가 다르고 기존 도메인 파일 어디에도 속하지 않는다(위젯 번들 비유입). 의존: `deploy-schedule.ts → common · security(Permission) · version(RestorePreviewResponse·RestoreBlocker·RestoreWarning·VersionDiffSummary) · chatbot(ChatbotStatus)` 단방향. 역방향 import 없음.

```
packages/shared-types/src/deploy-schedule.ts   [신설]
  - DeployScheduleAction      = z.enum(['RESTORE_VERSION','PUBLISH','SET_WEB_CHANNEL'])        ★ 판별값 단일 소스
  - DEPLOY_SCHEDULE_ACTION_LABELS  { RESTORE_VERSION:'버전 복원', PUBLISH:'공개 시작', SET_WEB_CHANNEL:'웹 채널 열기/닫기' }
  - DeployScheduleStatus      = z.enum(['PENDING','RUNNING','SUCCEEDED','FAILED','MISSED','HELD','CANCELLED'])
  - DEPLOY_SCHEDULE_STATUS_LABELS  { 대기·실행 중·성공·실패·누락·보류·취소 }                       (NFR-DA2 — 색상 + 텍스트)
  - DEPLOY_SCHEDULE_ACTIVE_STATUSES = ['PENDING','HELD','RUNNING'] as const                     (한도·간격·보존 보호·삭제 409 공용)
  - DEPLOY_SCHEDULE_ATTENTION_STATUSES = ['FAILED','MISSED','HELD'] as const                    ("확인 필요")
  - DeployScheduleOutcome     = z.enum(['APPLIED','NOOP','RECOVERED'])
  - DeployScheduleFailureReason = z.enum([ 'STATE_CHANGED','TARGET_VERSION_MISSING','INTEGRITY_FAILED','SCHEMA_UNSUPPORTED',
        'BACKUP_TOO_LARGE','CHATBOT_ARCHIVED','CHATBOT_NOT_FOUND','INVALID_TRANSITION','CREATOR_NOT_AUTHORIZED',
        'BLOCKED_TOO_LONG','INTERRUPTED','INTERNAL_ERROR' ])                                   (요구사항 11종 + BACKUP_TOO_LARGE — §21 D-5)
  - DeployScheduleTransientReason = z.enum(['DB_BUSY','ACTIVE_JOB','RESTORE_LOCKED'])
  - DeployScheduleHeldReason  = z.enum(['PREDECESSOR_FAILED','PREDECESSOR_MISSED','PREDECESSOR_CANCELLED','PREDECESSOR_HELD'])
  - DeploySchedulePreconditionReason = z.enum(['RESTORE_BLOCKED','RESTORE_NO_CHANGES','CHAIN_ORDER','ORDER_CHANGE',
        'ALREADY_ACTIVE','DUPLICATE_PUBLISH','TEST_SET_INVALID','TEST_SET_NOT_APPLICABLE'])   (409 details 코드)
  - DEPLOY_SCHEDULE_LIMITS = { minLeadMinutes:5, maxHorizonDays:90, minSpacingMinutes:1, maxActivePerChatbot:5,
        memoMaxCodePoints:200, longHorizonWarnDays:30, listPageSizeDefault:20, listPageSizeMax:100 } as const
                                                    ★ FE/BE 공용 코드 상수 1곳(요구사항 §5.5 — 환경변수로 만들지 않는다)

  // 동작별 params(저장 JSON 형태 = API 형태) — 식별자·불리언만(NFR-DS4, 원문 필드 없음)
  - RestoreVersionParamsSchema = { versionId: uuid }
  - PublishParamsSchema        = { enableWebChannel: boolean }
  - SetWebChannelParamsSchema  = { enabled: boolean }

  - OffsetDateTimeSchema = z.string().datetime({ offset: true })            // Z 또는 ±HH:mm 필수(FR-D2-9)
                              .transform(s => truncateToMinute(new Date(s)))  // 초·밀리초 0(AC-D1-6)
  - MemoSchema = z.string().trim().refine(codePoints ≤ 200).refine(제어문자 없음)   // 코드 포인트 기준(EX-D-13)

  - CreateDeployScheduleSchema = z.discriminatedUnion('action', [
        { action:'RESTORE_VERSION', versionId, previewedContentHash:/^[0-9a-f]{64}$/, acknowledgeActive?: boolean },
        { action:'PUBLISH', enableWebChannel: boolean, acknowledgeActive?: never },
        { action:'SET_WEB_CHANNEL', enabled: boolean } ])
      .and({ scheduledAt: OffsetDateTimeSchema, memo?: MemoSchema, postRunTestSetId?: uuid })
  - PreviewDeployScheduleSchema  = CreateDeployScheduleSchema에서 previewedContentHash·memo 제외(§6.1)
  - UpdateDeployScheduleSchema   = { scheduledAt?: OffsetDateTime, memo?: MemoSchema | null }  (최소 1키)
  - ResumeDeployScheduleSchema   = { scheduledAt: OffsetDateTime, previewedContentHash?: hex64 }
  - DeployScheduleListQuerySchema = { status?: csvEnumArray(Status), action?: csvEnumArray(Action),
        from?: OffsetDateTime, to?: OffsetDateTime, needsAttention?: boolean, chatbotId?(전역 목록만),
        order: 'asc'|'desc' = 'asc', page, pageSize(20/≤100) }
  - DeployScheduleResultSummarySchema = 판별 유니온 by kind (§7.4 — number/boolean/uuid/enum만)
  - PostRunTestOutcomeSchema = { status:'STARTED'|'SKIPPED'|'REJECTED', testRunId?: uuid, reason?: enum }
  - ReadinessWarningSchema = 판별 유니온 by code(§12 표)
  - DeployScheduleListItemSchema / DeployScheduleDetailSchema / DeploySchedulePreviewResponseSchema /
    DeployScheduleStateCheckSchema / DeployScheduleNoticeSchema / DeployScheduleSummarySchema / DeployScheduleMetaSchema  (§13)

  // 순수 함수(FE 입력 즉시 검증 + BE 권위 판정 공용 — now를 인자로 받는다)
  - checkScheduleTimeRules({ scheduledAt, now, otherActiveTimes }) → TimeRuleViolation[]   ('LEAD'|'HORIZON'|'SPACING')
  - zonedLocalToInstant({ date:'YYYY-MM-DD', time:'HH:mm' }, timeZone)
        → { kind:'OK', instant } | { kind:'NONEXISTENT' } | { kind:'AMBIGUOUS', earlier, later }   (§14 — DST 안전)
  - formatInstantInZone(instant, timeZone) → { date, time, offsetLabel: 'UTC+9', abbreviation?: 'KST' }
```

**기존 파일 append(하위호환 확장만)**

| 파일 | 추가 |
|---|---|
| `common.ts` | `ApiErrorCode` **6종** — §13.4 표 |
| `audit.ts` | `AuditTargetType`에 `DeploySchedule`(라벨 `'배포 예약'`, 14 → 15). `AuditAction`은 **추가 0**(FR-D6-5) |
| `version.ts` | `VersionTriggerContextSchema`에 `deployScheduleId: z.string().uuid().optional()` — `BEFORE_RESTORE` 백업이 어느 예약 실행에서 생겼는지(기동 정리 판정의 근거, §7.8). 기존 행은 전부 유효 |

---

## 4. 데이터 모델 (Prisma)

### 4.1 신규 1테이블 — 기존 테이블 컬럼 변경 0건

```prisma
/// [신규 2026-09-23 No.28] 1회성 운영 예약 배포(ADR-0032). 1행 = 동작 1개 = 실행 최대 1회(재시도는 카운터).
/// 상태 전이 쓰기 지점은 deploy-schedule.service.ts(생성·수정·취소·재개·확인)와
/// engine/deploy-schedule.repository.ts(선점·종결·재시도·MISSED·HELD 전파·임대 회수) 2파일뿐이다(§16 D-1).
/// ⚠ 이 테이블에는 스키마에 표현되지 않는 부분 유니크 인덱스 2개가 있다(§4.2, 파일 하단 주석).
model DeploySchedule {
  id                    String    @id @default(uuid())
  chatbotId             String
  chatbot               Chatbot   @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// RESTORE_VERSION | PUBLISH | SET_WEB_CHANNEL — shared-types DeployScheduleAction가 단일 소스
  action                String
  /// JSON — 동작별 params(zod). 식별자·불리언만. 동작 추가 시 마이그레이션 불필요(NFR-DM2)
  params                String
  /// RESTORE_VERSION 전용 비정규화 — 보존 보호·삭제 409의 조회 키. FK 없음(§4.4)
  targetVersionId       String?
  /// 표시용 스냅샷(대상 버전이 사라져도 "v31 복원" 표기 유지 — AuditLog.targetName 규약)
  targetVersionNo       Int?
  /// 대상 버전의 정규 해시(업캐스트 반영 — 미리보기의 targetContentHash). 체인 후속의 기준값
  targetContentHash     String?
  /// 실행 시 restore()의 expectedCurrentHash로 전달(J-4/J-5)
  expectedContentHash   String?
  /// 기준 해시를 결정한 선행 복원 예약(null = 생성 시점 현재 상태 기준). FK 없음
  predecessorScheduleId String?
  /// 생성 시 ACTIVE(또는 공개 예정) 확인 여부(FR-D2-4)
  acknowledgeActive     Boolean   @default(false)
  /// G3(선택) — 성공 직후 실행할 TC 세트. FK 없음(세트 삭제는 정당한 동작 — 실행 시 SKIPPED)
  postRunTestSetId      String?
  /// UTC 순간, 초·밀리초 0(FR-D2-9)
  scheduledAt           DateTime
  /// PENDING | RUNNING | SUCCEEDED | FAILED | MISSED | HELD | CANCELLED
  status                String    @default("PENDING")
  /// 선점 토큰(uuid) — 종결·임대 회수의 CAS 조건
  claimToken            String?
  claimedAt             DateTime?
  attemptCount          Int       @default(0)
  lastAttemptAt         DateTime?
  /// DB_BUSY | ACTIVE_JOB | RESTORE_LOCKED — PENDING(재시도 대기)일 때만 의미
  lastTransientReason   String?
  /// 첫 선점 시각 · 종결 시각
  startedAt             DateTime?
  finishedAt            DateTime?
  /// 첫 선점(또는 MISSED 판정) 시점의 지연(초)
  delaySeconds          Int?
  /// APPLIED | NOOP | RECOVERED (SUCCEEDED일 때만)
  outcome               String?
  failureReason         String?
  /// JSON DeployScheduleResultSummary — number/boolean/uuid/enum만(원문 없음, NFR-DS4)
  resultSummary         String?
  heldReason            String?
  heldByScheduleId      String?
  heldAt                DateTime?
  /// G3로 시작된 TestRun. FK 없음(실행 보존 정리로 사라질 수 있다)
  testRunId             String?
  /// 관리자 메모(≤200 코드 포인트). API 응답에는 포함, 서버 로그에는 금지(FR-0-87)
  memo                  String?
  /// 예약자 스냅샷 — FK 없음(AuditLog.actorId 규약). 실행 시 재검증의 키(FR-D3-12)
  createdById           String
  createdByEmail        String
  createdByRole         String
  cancelledAt           DateTime?
  cancelledById         String?
  cancelledByEmail      String?
  /// "확인 필요" 해제(FR-D6-2). 표시 상태일 뿐 감사하지 않는다
  acknowledgedAt        DateTime?
  acknowledgedById      String?
  acknowledgedByEmail   String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@index([status, scheduledAt])
  @@index([chatbotId, scheduledAt])
  @@index([chatbotId, status])
  @@index([targetVersionId, status])
  @@map("deploy_schedules")
}
```

`Chatbot` 모델에는 역참조 1필드(`deploySchedules DeploySchedule[]`)만 추가된다(DB 컬럼 변화 0).

**인덱스 근거**: `(status, scheduledAt)` = 폴링 tick의 유일한 조회(`status IN (PENDING,RUNNING) AND scheduledAt ≤ now`) — 예약이 없으면 인덱스 범위 스캔 0행(NFR-DP2, AC-D2-9) · `(chatbotId, scheduledAt)` = 챗봇별 목록·체인 판정·후속 보류 대상 · `(chatbotId, status)` = 활성 5건 한도·notice·"확인 필요" 집계 · `(targetVersionId, status)` = 보존 보호·버전 삭제 409.

**판단 — `params` JSON + 비정규화 컬럼 1개**: 동작별 타입 컬럼(`enableWebChannel`·`channelEnabled` 등)을 두면 동작 추가마다 마이그레이션이 필요하다(NFR-DM2 — No.40 "포인터 전환", 채널 일반화). 반대로 전부 JSON이면 **보존 보호·삭제 409가 `targetVersionId`를 인덱스로 찾을 수 없다**. 그래서 교차 관심사(버전 참조) 1개만 컬럼으로 뽑고 나머지는 JSON이다. params의 형식 검증은 **실행기가 소유한 zod 스키마**가 읽기·쓰기 양쪽에서 한다(파싱 실패 행 = `FAILED(INTERNAL_ERROR)` + 경고 로그, 엔진은 멈추지 않는다).

**판단 — 결과 테이블을 나누지 않는다**(요구사항 §5.2): 1예약 = 최대 1실행이며 재시도는 카운터다. 실행 이력 1:N 테이블은 반복 예약(범위 밖)이 생길 때의 문제다.

### 4.2 ★ 부분 유니크 인덱스 2개 (원시 SQL — 마이그레이션 파일에만 존재)

Prisma 스키마 언어는 `WHERE` 절 부분 인덱스를 표현하지 못한다. `test_runs_chatbotId_active_key`(ADR-0029) 선례와 같은 방식으로 마이그레이션 SQL에 직접 쓰고 `schema.prisma` 하단에 경고 주석을 단다.

```sql
-- ① 같은 챗봇의 활성 예약은 같은 분(minute)에 2건 이상 존재할 수 없다.
--    scheduledAt이 분 단위로 정규화되므로 "서로 다른 분" ⇔ "최소 1분 간격"(FR-D2-12)의 DB 차원 최종 방어선이다.
CREATE UNIQUE INDEX "deploy_schedules_chatbotId_scheduledAt_active_key"
  ON "deploy_schedules"("chatbotId", "scheduledAt") WHERE "status" IN ('PENDING', 'HELD', 'RUNNING');

-- ② 한 챗봇에서 RUNNING은 최대 1건 — 다중 인스턴스에서도 챗봇 단위 직렬 실행(순서 보장, AC-D2-6)의 최종 방어선.
CREATE UNIQUE INDEX "deploy_schedules_chatbotId_running_key"
  ON "deploy_schedules"("chatbotId") WHERE "status" = 'RUNNING';
```

| 인덱스 | 위반 시(Prisma `P2002`) | 처리 |
|---|---|---|
| ① | 생성·시각 수정·재개의 동시 경합 | `400 DEPLOY_SCHEDULE_INVALID_TIME`(서비스 사전 검사와 같은 코드) |
| ② | 두 인스턴스가 같은 챗봇의 서로 다른 예약을 동시에 선점 | 선점 실패로 간주하고 **건너뜀**(다음 tick) — 오류 아님 |

`HELD`를 ①에 포함하는 이유: 보류 예약도 "재개 대기 중인 반영 계획"이며, 같은 분에 다른 예약을 끼워 넣으면 재개 시 순서가 모호해진다.

### 4.3 상태 기계

```
            create
              │
              ▼
   ┌──────► PENDING ──── cancel ────────────────────────────────► CANCELLED
   │          │  │  └─── tick: 유예 초과(시도 0회) ──────────────► MISSED ──┐
   │          │  └────── tick: 재시도 창 초과(시도 ≥1회) ────────► FAILED ──┤  후속 PENDING
   │          │  └────── 선행 실패/누락/취소(복원) · 앞선 HELD ──► HELD      │  → HELD(§7.7)
   │          ▼ CAS 선점                                                     │
   │       RUNNING ──── 성공/이미 그 상태 ──────────────────────► SUCCEEDED(APPLIED｜NOOP)
   │          │ ├────── 영구적 원인 ─────────────────────────────► FAILED ───┤
   │          │ └────── 임대 만료 회수(§7.8) ────► SUCCEEDED(RECOVERED｜NOOP) │ FAILED(INTERRUPTED)
   └─ 일시적 원인(재시도 창 이내)                                              │
                                                                             ▼
   HELD ──── resume(새 시각 · 복원이면 새 미리보기) ───► PENDING         (종단: SUCCEEDED·FAILED·MISSED·CANCELLED)
   HELD ──── cancel ───────────────────────────────────► CANCELLED
```

| 전이 | 쓰기 지점 | CAS 조건(`updateMany where`) |
|---|---|---|
| (생성) → PENDING | `service.create` | 쓰기 트랜잭션 안 재검사 + 부분 유니크 ① |
| PENDING → RUNNING | `repository.claim` | `id, status:'PENDING', attemptCount:<읽은 값>` |
| PENDING → MISSED | `repository.markMissed` | `id, status:'PENDING', attemptCount:0` |
| PENDING → FAILED(`BLOCKED_TOO_LONG`) | `repository.expireRetry` | `id, status:'PENDING', attemptCount:<읽은 값>` |
| PENDING → HELD | `repository.holdSuccessors` / `repository.holdBehindHeld` / `service.cancel`(체인) | `chatbotId, status:'PENDING', scheduledAt > 기준` |
| PENDING·HELD → CANCELLED | `service.cancel` | `id, status IN (PENDING, HELD)` |
| RUNNING → SUCCEEDED·FAILED·PENDING | `repository.finalize` | `id, status:'RUNNING', claimToken:<내 토큰>` |
| RUNNING → (회수 판정) | `repository.reclaimExpired` | `id, status:'RUNNING', claimToken:<관측 토큰>, claimedAt < now − lease` |
| HELD → PENDING | `service.resume` | `id, status:'HELD'` + 트랜잭션 안 재검사 |
| (종단/HELD) 확인 표시 | `service.acknowledge` | `id, status IN (FAILED, MISSED, HELD)` — 상태 불변, `acknowledged*`만 |

`PENDING → FAILED(BLOCKED_TOO_LONG)` 간선은 요구사항 상태표에 없는 **추가 간선**이다 — 재시도 대기(PENDING, 시도 ≥1회) 중 서버가 재시도 창을 넘겨 내려가 있던 경우 종결할 경로가 필요하다(§21 D-5).

### 4.4 FK를 걸지 않는 컬럼 (의도적 예외)

`targetVersionId`·`predecessorScheduleId`·`heldByScheduleId`·`postRunTestSetId`·`testRunId`·`createdById`·`cancelledById`·`acknowledgedById`. 특히 **`targetVersionId`에 FK를 걸면** `Restrict` 규약 때문에 **종단 예약(SUCCEEDED 등)이 참조하는 버전이 보존 정리로 영원히 지워지지 않는다**. 보호는 **활성(`PENDING`/`HELD`/`RUNNING`) 예약만** 대상이어야 하므로 앱 계층(§9.3)이 담당하고, 표시는 `targetVersionNo` 스냅샷으로 한다. `SetNull`은 이 프로젝트가 금지한 암묵적 참조 동작이다(개발명세서 §3.1).

### 4.5 만들지 않는 것

반복 규칙(cron 표현식) 컬럼 · 실행 이력 1:N 테이블 · 잠금 테이블(CAS·부분 유니크로 대체) · 알림 발송 테이블 · **인스턴스 heartbeat 테이블**(엔진 가동 여부는 "기한 넘긴 PENDING 건수"로 판정 — §13.1 `meta`) · 환경/포인터 컬럼(No.40) · 예약 보존 정리 배치(No.45 — §20 L-7).

### 4.6 마이그레이션 영향 (기존 데이터 호환성)

| 항목 | 판정 |
|---|---|
| 기존 테이블 컬럼 변경 | **0건**. 신규 테이블 1개 + 인덱스 4개 + 부분 유니크 2개 CREATE만. `Chatbot` 역참조는 Prisma 전용(DDL 없음) |
| 백필 | **불필요** — 0행 시작이 정상. 신규 seed 없음 |
| enum 확장(`AuditTargetType`·`ApiErrorCode`·`VersionTriggerContext`) | 값·선택 필드 추가, DB는 `String` — 기존 행 전부 유효 |
| **⚠ `test_runs` 부분 유니크 인덱스** | `prisma migrate dev`가 생성한 SQL에 `DROP INDEX "test_runs_chatbotId_active_key"`가 끼어 있지 않은지 **반드시 확인** 후 제거. **새 부분 유니크 2개도 같은 위험**이 이후 마이그레이션에 생기므로 `schema.prisma` 하단 경고 주석에 `deploy_schedules` 2개를 추가한다 |
| 롤백 | 테이블 **DROP만으로 완전 롤백**. 코드 롤백 시 `restore()` 선택 인자·`RESTORE_BUSY`·보존 보호·`permanentDelete` 1줄도 함께 되돌린다(스키마만 되돌리면 보존 정리가 `deploySchedule` 조회에서 실패 → best-effort라 정리만 멈춤, 본 동작 무영향) |
| 챗봇 영구삭제 | `deploySchedule.deleteMany` **동반 삭제**(13 → 14테이블). 사전 검사 409 대상 아님(AC-D5-3) |

---

## 5. 동작 유형별 실행기 (전략 패턴 · 확장점)

### 5.1 인터페이스

```ts
// executors/deploy-action-executor.ts
export interface DeployActionExecutor<A extends DeployScheduleAction> {
  readonly action: A;
  readonly paramsSchema: z.ZodType<ParamsOf<A>>;               // 저장·읽기 양방향 검증

  /** 생성·관리·실행 재검증 공용 권한(단일 소스 = lib/required-permissions.ts 위임). G3 권한은 별도(§11). */
  requiredPermissions(params: ParamsOf<A>): Permission[];

  /** 생성 전 미리보기 — 쓰기 0. 기준 결정·blockers·동작별 준비도(§6.1). */
  preview(ctx: PreviewContext<A>): Promise<ActionPreview<A>>;

  /** 생성·재개 쓰기 트랜잭션 안에서 호출 — 저장할 파생 필드(기준 해시 등)를 확정하거나 409를 던진다(§6.4). */
  resolveForInsert(tx: Prisma.TransactionClient, ctx: InsertContext<A>): Promise<DerivedFields>;

  /** 실행 — 절대 throw하지 않는다. 모든 결과를 ExecutionOutcome으로 분류해 반환(§7.6). */
  execute(ctx: ExecutionContext<A>): Promise<ExecutionOutcome>;

  /** 임대 만료 RUNNING의 실제 상태 판정(§7.8). */
  judgeRecovery(ctx: RecoveryContext<A>): Promise<RecoveryVerdict>;
}

export type ExecutionOutcome =
  | { kind: 'APPLIED'; summary: DeployScheduleResultSummary }
  | { kind: 'NOOP'; summary: DeployScheduleResultSummary }
  | { kind: 'TRANSIENT'; reason: DeployScheduleTransientReason }
  | { kind: 'PERMANENT'; reason: DeployScheduleFailureReason; detailCode?: string };
```

### 5.2 레지스트리 — 누락이 컴파일 오류가 되는 매핑 타입

```ts
// executors/executor.registry.ts
type ExecutorMap = { [A in DeployScheduleAction]: DeployActionExecutor<A> };
@Injectable()
export class ExecutorRegistry {
  private readonly map: ExecutorMap;
  constructor(r: RestoreVersionExecutor, p: PublishExecutor, s: SetWebChannelExecutor) {
    this.map = { RESTORE_VERSION: r, PUBLISH: p, SET_WEB_CHANNEL: s };   // ★ 분기는 이 1곳뿐
  }
  get<A extends DeployScheduleAction>(action: A): DeployActionExecutor<A> { return this.map[action]; }
}
```

엔진·서비스·미리보기는 `switch (action)`을 쓰지 않는다(정적 검사 §16 D-10: `deploy-schedules/**`에서 `case 'RESTORE_VERSION'` 류 리터럴 분기는 레지스트리·`lib/required-permissions.ts` 밖에 0건).

### 5.3 `RESTORE_VERSION`

| 단계 | 내용 |
|---|---|
| 사전 확인(읽기) | 챗봇 행 없음 → `PERMANENT(CHATBOT_NOT_FOUND)` · `ARCHIVED` → `PERMANENT(CHATBOT_ARCHIVED)` · **`ACTIVE`인데 `acknowledgeActive=false` → `PERMANENT(STATE_CHANGED, detail ACTIVE_NOT_ACKNOWLEDGED)`**(§4.6 표 — ACTIVE 확인 없이 운영 챗봇을 바꾸지 않는다) · 대상 버전 행 없음 → `PERMANENT(TARGET_VERSION_MISSING)` |
| 호출 | `versionRestore.restore(chatbotId, versionId, { expectedCurrentHash: row.expectedContentHash, acknowledgeActive: row.acknowledgeActive }, { actor, auditSummaryPrefix: '[예약 실행 #<id 앞 8자>] ', triggerContext: { deployScheduleId: row.id } })` |
| 결과 | 성공 → `APPLIED` + `{ kind:'RESTORE', fromVersionNo, backupVersionNo, backupVersionId, counts, reindexWasRunning, classifierDeleted }` · 예외 → §7.6 분류 |

`restore()` 내부의 잠금·준비·단일 트랜잭션·해시 재확인·백업·사후 검증·`invalidate()`·보존 정리는 **한 줄도 바뀌지 않는다**(요구사항 §4.9). 이 파일은 저장소 전체에서 `restore(`를 호출하는 **두 번째이자 마지막 호출부**다(첫째 = `versions.controller.ts`, §16 D-3).

### 5.4 `PUBLISH` — `ChatbotPublicationService`(channels 모듈 신규)

**판단 — 기존 두 서비스를 트랜잭션 인자로 확장하지 않고 전용 서비스를 둔다**(FR-D1-3 "구현 방식 architect 확정").

| 안 | 판정 |
|---|---|
| (a) `ChatbotsService.updateStatus(id, dto, tx?)` + `ChannelsService.upsert(..., tx?)`에 트랜잭션 인자 | 기각. 두 메서드 모두 **쓰기 직후 감사를 기록**하는데 감사는 커밋 후여야 한다(ADR-0016 §4) — tx 인자를 받으면 "tx가 있으면 감사를 미룬다" 분기가 두 곳에 생긴다. `upsert`는 config 부분 수정·스코프 검사까지 섞여 있어 원자 경로로 부적합 |
| (b) 예약 모듈이 `tx.chatbot.update`·`tx.channel.*`을 직접 호출 | 기각. FR-0-79(예약 모듈 직접 쓰기 0)와 정면 충돌 |
| **(c) channels 모듈에 공개 전환 전용 서비스(채택)** | ADR-0011의 정의 "**공개 = 상태 ACTIVE AND WEB 채널 enabled**"를 소유하는 곳이 채널 모듈이다. 판정은 기존 순수 함수(`evaluateStatusTransition` · `assertChannelEnableAllowed` · `defaultChannelConfig`)를 **호출만** 하므로 복제 0(FR-D5-1). 관리자 즉시 경로(`PATCH …/status`·`PATCH …/channels/:type`)는 **무변경** |

```
publish(chatbotId, { enableWebChannel }, invocation) → { changed, statusBefore, statusAfter, channelBefore, channelAfter }
  [단일 쓰기 트랜잭션]
    chatbot = tx.chatbot.findUnique(select status,name) — 없음 → NOT_FOUND · ARCHIVED → CHATBOT_ARCHIVED(409)
    ev = evaluateStatusTransition(status, 'ACTIVE')           — denied → INVALID_STATUS_TRANSITION(400)
    web = enableWebChannel ? tx.channel.findUnique({ chatbotId_type: { chatbotId, type:'WEB' } }) : null
    needChannel = enableWebChannel && !(web?.enabled)
    ev === noop && !needChannel → return { changed:false, … }                      ★ NOOP — 쓰기 0, 감사 0
    ev === allowed → tx.chatbot.update({ status:'ACTIVE' })
    needChannel → assertChannelEnableAllowed('WEB', true)
                  web ? tx.channel.update({ enabled:true }) : tx.channel.create({ chatbotId, type:'WEB', enabled:true, config: defaultChannelConfig('WEB') })
  [커밋 후 — 기존 요약 형식 그대로 + 접두]
    상태를 바꿨으면 audit STATUS_CHANGE(Chatbot) summary "[예약 실행 #xxxxxxxx] 상태 변경: DRAFT → ACTIVE"
    채널을 바꿨으면 audit UPDATE|CREATE(Channel) summary "[예약 실행 #xxxxxxxx] 사용 여부 변경: false → true"
    (둘 다 actorOverride = 예약자)
```

- **원자성(AC-D2-4)**: 채널 쓰기에서 예외가 나면 상태 변경도 롤백된다(한 트랜잭션). 감사는 커밋 뒤라 롤백된 쓰기의 감사는 존재하지 않는다.
- `ACTIVE`이지만 채널이 꺼져 있고 `enableWebChannel=true`면 **채널만 켜고 `APPLIED`**(목표 상태 = ACTIVE + WEB 사용). 이미 목표 상태면 `NOOP`(FR-D3-13).
- `PublicAccessService`는 캐시하지 않으므로 커밋 직후 다음 공개 요청부터 `200`이다(AC-D2-3). 무효화 호출 없음.

### 5.5 `SET_WEB_CHANNEL`

`ChatbotPublicationService.setWebChannel(chatbotId, enabled, invocation)` — 같은 서비스의 두 번째 메서드. 단일 트랜잭션에서 챗봇 존재·`ARCHIVED`(409) 확인 → WEB 행 조회 → 같은 값이면 `NOOP`(행 없음 + `false`도 NOOP) → 행 없고 `true`면 기본 config로 생성 → 커밋 후 감사(`UPDATE|CREATE`, `"[예약 실행 #…] 사용 여부 변경: a → b"`). `DRAFT` 챗봇의 채널을 켜는 것은 허용(공개 조건의 한쪽일 뿐 — 공개는 `ACTIVE`일 때만).

### 5.6 확장점 (NFR-DM2)

| 향후 동작 | 추가할 것 | 바뀌지 않는 것 |
|---|---|---|
| **No.40 "포인터 전환"**(published = 특정 `ChatbotVersion`) | `DeployScheduleAction`에 값 1개 · params 스키마 · 실행기 파일 1개 · 레지스트리 1줄 · `required-permissions.ts` 1분기 | 엔진·planner·분류기 골격·상태 기계·API 경로·테이블 |
| 채널 일반화 `SET_CHANNEL(type)` | 새 동작으로 추가(`SET_WEB_CHANNEL`은 호환 유지) · `CHANNEL_IMPLEMENTATION` 확장(ADR-0011) | 동일 |
| 반복 예약 | **이 설계의 확장 대상이 아니다** — misfire·체인 의미가 다르다(요구사항 §9). 도입 시 별도 ADR(`@nestjs/schedule` 재검토) | — |

---

## 6. 예약 생성 · 미리보기 바인딩 (FR-D2-\*)

### 6.1 미리보기 — `POST …/deploy-schedules/preview` (DB 변경 0)

기존 `restore/preview`는 "**현재** 상태 → 대상"만 계산한다. 예약은 **체인**(선행 복원 예약 반영 후 상태 → 대상)이 있으므로 기준 결정이 서버에 있어야 한다. 콘솔은 이 엔드포인트 하나로 미리보기·준비도·기준 해시를 얻는다(FR-D7-4).

```
① 권한(동작별, §8.2) → 스코프(404 · ARCHIVED 409) → 시각 정규화 + checkScheduleTimeRules(표시용 위반 목록)
② 실행기.preview(ctx):
   RESTORE_VERSION
     pred = chain-rules.findPredecessor(활성 RESTORE_VERSION 예약들, scheduledAt)          // scheduledAt보다 이른 것 중 가장 늦은 것
     rp   = versionRestore.preview(chatbotId, versionId)                                   // 기존 그대로: 현재 해시·대상 해시·blockers·warnings
     base = pred ? { kind:'SCHEDULE', scheduleId, scheduledAt, versionId, versionNo, contentHash: pred.targetContentHash }
                 : { kind:'CURRENT', contentHash: rp.currentContentHash }
     blockers(예약 의미로 재해석):
        INTEGRITY_FAILED · SCHEMA_UNSUPPORTED · CHATBOT_ARCHIVED → 차단
        ACTIVE_JOB · RESTORE_IN_PROGRESS → ★ 경고로 격하(FR-D2-3 — 실행 시점엔 끝나 있을 것)
        NO_CHANGES → base가 CURRENT일 때만 차단. base가 SCHEDULE이면 rp의 NO_CHANGES는 무시하고
                     targetContentHash === base.contentHash 일 때 차단("선행 예약 반영 후 상태와 동일")
     diff: base CURRENT → rp.diffSummary(기존 컴포넌트 재사용) / base SCHEDULE → versionDiff.diff(pred.versionId, against=versionId).summary
     requiresAcknowledgeActive = chatbot.status==='ACTIVE' || 이보다 이른 활성 PUBLISH 예약 존재(FR-D2-4)
   PUBLISH       현재 상태(DRAFT 아니면 차단 ALREADY_ACTIVE) · 활성 PUBLISH 중복(DUPLICATE_PUBLISH) · WEB 채널 행/설정/사용 여부
   SET_WEB_CHANNEL 현재 값(같아도 허용 — FR-D2-6)
③ 준비도 경고(§12) + 앞선 HELD 존재 경고
→ 200 DeploySchedulePreviewResponse { creatable, preconditionFailures[], timeViolations[], readinessWarnings[], restore?|publish?|setWebChannel? }
```

### 6.2 체인 규칙 (J-5) — `lib/chain-rules.ts`

| 규칙 | 내용 | 근거 |
|---|---|---|
| **R1 기준 해시** | 새 `RESTORE_VERSION`의 `expectedContentHash` = 이보다 이른 **활성(`PENDING`/`HELD`/`RUNNING`) 복원 예약 중 가장 늦은 것**의 `targetContentHash`. 없으면 **쓰기 트랜잭션 안에서 다시 계산한 현재 해시**(= `previewedContentHash`여야 함) | FR-D2-2 |
| **R2 복원 체인은 뒤에만 붙는다(append-only)** | 새 복원 예약보다 **늦은** 활성 복원 예약이 이미 있으면 거부(`409 DEPLOY_SCHEDULE_PRECONDITION_FAILED` + `CHAIN_ORDER`) | 끼워 넣으면 뒤 예약의 기준 해시가 **조용히 틀어진다**(뒤 예약은 관리자가 본 적 없는 기준으로 실행되거나 반드시 실패). 재기준화(rebinding)는 J-4 "조용한 변경 금지"와 충돌 — §21 D-4 |
| **R3 순서 보존** | 시각 수정(PATCH)은 같은 챗봇 **활성 예약 전체의 상대 순서**를 바꾸지 않는 범위에서만 허용(`ORDER_CHANGE`) | FR-D3-2의 "체인 순서" 규칙을 동작 무관하게 일반화 — "08:55 복원 → 09:00 공개"의 순서 역전도 옛 내용 공개 사고다 |
| **R4 `previewedContentHash`의 의미** | 미리보기 응답의 `restore.base.contentHash`. 생성 트랜잭션에서 R1로 다시 결정한 값과 다르면 `409 RESTORE_PREVIEW_STALE`(현재 상태가 바뀌었거나, 그 사이 선행 예약이 추가·취소됨) | FR-D2-2 ②, AC-D1-3 |
| **R5 재개(resume)** | `HELD → PENDING`은 새 시각 필수. 복원이면 **새 미리보기 해시 필수**이며 R1·R2를 새 시각 기준으로 다시 적용 | FR-D3-4, AC-D3-9 |
| **R6 체인 중간 취소** | 취소된 `RESTORE_VERSION`보다 늦은 활성 `RESTORE_VERSION`(PENDING)을 `HELD(PREDECESSOR_CANCELLED)` | FR-D3-3, AC-D3-10 |
| **R7 공개 중복** | 한 챗봇에 활성 `PUBLISH`는 1건(`DUPLICATE_PUBLISH`) | 두 번째 공개는 반드시 NOOP — 의미 없는 예약이 순서·보류 규칙만 복잡하게 한다 |

### 6.3 시각 규칙 (J-12, J-13) — `checkScheduleTimeRules()` (shared-types, FE/BE 공용)

| 규칙 | 판정 | 코드 |
|---|---|---|
| 분 정규화 | 입력 초·밀리초 절삭(`09:00:30+09:00` → `00:00:00Z`) | — |
| 리드타임 | `scheduledAt ≥ now + 5분` | `LEAD` |
| 최대 기간 | `scheduledAt ≤ now + 90일` | `HORIZON` |
| 간격 | 같은 챗봇 활성 예약과 **같은 분이 아님**(분 정규화로 "≥1분"과 동치) | `SPACING` |
| 한도 | 활성 < 5 | `DEPLOY_SCHEDULE_LIMIT_EXCEEDED` |

위반은 `400 DEPLOY_SCHEDULE_INVALID_TIME` + `details: [{ field:'scheduledAt', message:'LEAD'|… }]`. 서버 `now`가 권위이며 FE 검사는 즉시 안내용이다(시계 차이 무관). 메시지 예(NFR-DA4): "예약 시각은 지금부터 5분 이후여야 합니다. 09:07 이후로 입력해 주세요"(FE가 `details` + 현재 시각으로 조립).

### 6.4 생성 절차 — `POST …/deploy-schedules`

```
[트랜잭션 밖]
 0. 권한(§8.2 — 동작별 + postRunTestSetId면 simulation:write) · 스코프 assertWritable(404 · ARCHIVED 409)
 1. zod(오프셋 필수 · 분 정규화 · memo) · postRunTestSetId면 세트 존재 + 동작이 RESTORE_VERSION|PUBLISH인지(§11)
 2. 실행기 사전 검증(무거운 것): RESTORE → versionRestore.preview() 1회(blockers 재평가, §6.1 규칙)
    · 차단 blocker → 409 PRECONDITION_FAILED(RESTORE_BLOCKED + blocker 코드들)
    · requiresAcknowledgeActive && !acknowledgeActive → 400 VALIDATION_FAILED(details: acknowledgeActive)   (AC-D1-10)
[단일 쓰기 트랜잭션 — timeout VERSION_TX_TIMEOUT_MS]
 3. active = tx.deploySchedule.findMany({ chatbotId, status IN ACTIVE })            // 순차 await(tx 위 Promise.all 금지)
 4. checkScheduleTimeRules(now=clock.now(), active) · active.length ≥ 5 → LIMIT_EXCEEDED
 5. 실행기.resolveForInsert(tx):
      RESTORE: R2(append) → R1(선행 있으면 선행 targetContentHash / 없으면 versionCapture.readConsistent(chatbotId, tx)로 현재 해시)
               → R4(≠ previewedContentHash → 409 RESTORE_PREVIEW_STALE)
               → tx.chatbotVersion 존재 재확인(보존 정리 경합 — 없으면 404)
               → targetContentHash === expected → 409 PRECONDITION_FAILED(RESTORE_NO_CHANGES)
      PUBLISH: tx에서 status 재확인(DRAFT 아님 → ALREADY_ACTIVE) · R7
 6. tx.deploySchedule.create({ …, createdBy* = 요청 주체 스냅샷, status:'PENDING' })      // P2002(부분 유니크 ①) → 400 INVALID_TIME
[커밋 후]
 7. audit CREATE(DeploySchedule)
 8. 준비도 경고 계산(§12) → 201 { schedule, readinessWarnings }
```

- **현재 해시를 쓰기 트랜잭션 안에서 재계산**하는 이유: SQLite 직렬화로 "재계산 ~ INSERT" 사이 끼어든 편집이 없음을 보장한다(ADR-0031 §6과 같은 원리). 경합 시 BUSY → `409 RESTORE_BUSY`("잠시 후 다시 시도").
- 캡처 읽기(통상 100ms 안팎)가 쓰기 트랜잭션 안에 들어가지만 생성은 드문 관리자 동작이다(NFR-DP 예산 밖).

### 6.5 수정 · 취소 · 재개 · 확인

| 동작 | 허용 상태 | 절차(쓰기 트랜잭션 안) | 감사 |
|---|---|---|---|
| **PATCH** `{scheduledAt?, memo?}` | PENDING·HELD | 시각이 있으면 §6.3 재검사(자기 자신 제외) + **R3 순서 보존** → update. 다른 필드는 받지 않는다(zod strip이 아니라 **strict** — 대상·동작 변경 시도는 400) | `UPDATE`(DeploySchedule) |
| **cancel** | PENDING·HELD | `CANCELLED` + `cancelled*` → `RESTORE_VERSION`이면 **R6**(후속 복원 HELD). RUNNING → `409 DEPLOY_SCHEDULE_NOT_MODIFIABLE` | `STATUS_CHANGE` summary `"예약 취소"` (취소자 = 요청 주체, 예약자 아니어도 됨 — FR-D2-15) |
| **resume** `{scheduledAt, previewedContentHash?}` | HELD | 새 시각 §6.3 → 복원이면 R5(R1·R2·R4 재적용, `expectedContentHash`·`predecessorScheduleId` 갱신) → `PENDING` + `held*`·`acknowledged*`·`attemptCount`·`lastTransient*` 초기화 | `STATUS_CHANGE` summary `"보류 해제"` |
| **acknowledge** | FAILED·MISSED·HELD | `acknowledged*` 설정(상태 불변). 이미 확인됨 → 멱등 200 | **없음**(FR-D6-4) |

**재개 시 예약자는 바뀌지 않는다**: `createdBy*`는 원 예약자이며 재개자는 감사에 남는다. 실행 시 재검증은 **원 예약자** 기준이다 — 재개자가 자기 이름으로 실행되길 원하면 취소 후 새 예약을 만든다(S-6 흐름과 동일). ⚠ 재개 권한 보유자가 "권한 잃은 예약자의 예약"을 재개하면 실행 시 `CREATOR_NOT_AUTHORIZED`로 실패하므로, 재개 API는 **원 예약자가 현재 권한을 잃었으면 409 `PRECONDITION_FAILED`로 즉시 알린다**(쓸모없는 재개 방지 — 추가 판단).

---

## 7. 실행 엔진 (J-3, FR-D3-5~15)

### 7.1 공용 부품 `common/polling/PollingLoop` (NFR-DM3)

```ts
export interface PollingLoopOptions {
  name: string;                        // 로그 식별
  intervalMs: number;
  onTick: (signal: { stopping(): boolean }) => Promise<void>;
  logger: LoggerLike;
}
export class PollingLoop {
  start(): void;                       // setTimeout 체인 — "이전 tick 종료 후 intervalMs 뒤 다음 tick" ⇒ 겹침이 구조적으로 불가능(FR-D3-7)
  runOnce(): Promise<void>;            // 테스트·기동 직후 1회 실행용. 이미 실행 중이면 그 Promise를 반환(중복 실행 없음)
  stop(maxWaitMs = 30_000): Promise<void>;  // 타이머 해제 + stopping=true + 진행 중 tick 완료 대기(상한)
}
```

- **예외 흡수**: `onTick`의 예외는 잡아 `warn` 로그만 남기고 다음 tick을 예약한다(AC-D2-8 — 타이머가 죽지 않는다).
- 타이머는 `unref()` — 엔진이 프로세스 종료를 막지 않는다(`pending-answer.store.ts` 선례).
- **`setInterval`이 아니라 `setTimeout` 체인**인 이유: 느린 tick(복원 수십 초)이 다음 tick과 겹치지 않고, 겹침 방지 플래그가 필요 없다.
- 이 부품은 예약 도메인을 모른다(Prisma·예약 타입 import 0 — §16 D-11). No.45 정리 배치가 재사용할 수 있다(이번에 다른 소비자는 만들지 않는다).

### 7.2 tick — 조회 1건 + 순수 함수 계획 + 챗봇 단위 순차 실행

```
tick(signal):
  now = clock.now()
  rows = prisma.deploySchedule.findMany({
           where: { status: { in: ['PENDING','RUNNING'] }, scheduledAt: { lte: now } },
           orderBy: { scheduledAt: 'asc' }, take: 100,
           select: { id, chatbotId, action, status, scheduledAt, attemptCount, lastAttemptAt, claimedAt, claimToken } })
  if rows.length === 0 → return                                              ★ 유휴 tick = 인덱스 쿼리 1건(AC-D2-9, NFR-DP2)
  heldBefore = prisma.deploySchedule.findMany({ where: { chatbotId IN 후보 챗봇, status:'HELD', scheduledAt: { lte: now } } })
  decisions = planTick(rows, heldBefore, now, cfg)                           // lib/tick-planner.ts — 순수
  deadline = now + TICK_BUDGET_MS(= min(20_000, intervalMs × 2/3))
  for d of decisions (가장 이른 scheduledAt 순):
     if signal.stopping() || clock.now() > deadline → break                 // 남은 것은 다음 tick(FR-D3-7)
     try { await apply(d) } catch (e) { warn(id, action, code) }            // 한 건의 실패가 다른 챗봇을 막지 않는다
```

**`planTick(rows, heldBefore, now, cfg) → TickDecision[]`** — 챗봇마다 **최대 1개**의 결정만 만든다(같은 챗봇 예약의 순서 보장, FR-D3-5).

| 챗봇 상황 | 결정 |
|---|---|
| RUNNING 행 있음, `claimedAt < now − lease` | `RECOVER{ id, claimToken }` — 이번 tick에 이 챗봇의 다른 예약은 실행하지 않음 |
| RUNNING 행 있음, 임대 유효 | `SKIP`(다른 인스턴스·이 인스턴스가 실행 중) |
| 가장 이른 PENDING `p`보다 이른 HELD 존재 | `HOLD_BEHIND_HELD{ p, heldBy }`(`PREDECESSOR_HELD`) |
| `p.attemptCount === 0` 이고 `now − p.scheduledAt > grace + tolerance` | `MISS{ p, delaySeconds }` (§7.5) |
| `p.attemptCount ≥ 1` 이고 `now > p.scheduledAt + retryWindow` | `EXPIRE_RETRY{ p }` → `FAILED(BLOCKED_TOO_LONG)` |
| 그 외 | `EXECUTE{ p, expectAttemptCount }` |

- 순차 처리 근거(NFR-DP5): SQLite는 단일 작성자라 복원 병렬화 이득이 없고, 순차면 tick 예산으로 다른 API P95 영향을 제한할 수 있다.
- `take: 100`: 챗봇당 1건만 처리하므로 한 tick이 다루는 챗봇은 예산 안의 수 건이다. 백로그는 다음 tick으로 넘어간다.

### 7.3 CAS 선점 (FR-D3-6) — 신규 원시 SQL 0건(NFR-DM5)

```ts
// repository.claim
const token = randomUUID();
const first = d.expectAttemptCount === 0;
try {
  const { count } = await prisma.deploySchedule.updateMany({
    where: { id: d.id, status: 'PENDING', attemptCount: d.expectAttemptCount },
    data: {
      status: 'RUNNING', claimToken: token, claimedAt: now,
      attemptCount: { increment: 1 }, lastAttemptAt: now,
      ...(first ? { startedAt: now, delaySeconds: secondsBetween(scheduledAt, now) } : {}),
    },
  });
  return count === 1 ? token : null;          // 0 = 다른 인스턴스가 가져갔거나 상태가 바뀜 → 건너뜀
} catch (e) {
  if (isUniqueViolation(e)) return null;      // 부분 유니크 ② — 같은 챗봇의 다른 예약이 RUNNING
  throw e;
}
```

**프로세스 로컬 상태는 정합성의 근거가 아니다**(FR-0-81): 인스턴스가 몇 개든 `status='PENDING' → 'RUNNING'` 갱신은 DB에서 1회만 성공한다(AC-D2-1). `attemptCount`를 조건에 넣어 "첫 선점 여부"(`startedAt`·`delaySeconds` 기록)가 읽은 값과 어긋나지 않게 한다.

### 7.4 실행 순서 (선점 이후)

```
 1. claim → token (null이면 종료)
 2. row = findUnique(id) · params = executor.paramsSchema.safeParse(JSON.parse(row.params))   — 실패 → finalize PERMANENT(INTERNAL_ERROR)
 3. creatorVerifier.verify(row, executor.requiredPermissions(params))                          — §8.3, 실패 → PERMANENT(CREATOR_NOT_AUTHORIZED)
 4. outcome = executor.execute({ row, params, actor, now, invocationPrefix })                  — 절대 throw 안 함(§5.1)
 5. finalize(row, token, outcome) — 단일 트랜잭션:
      APPLIED|NOOP → status SUCCEEDED, outcome, finishedAt, resultSummary, claimToken=null
      TRANSIENT    → now > scheduledAt + retryWindow ? FAILED(BLOCKED_TOO_LONG) : PENDING(lastTransientReason, claimToken=null)
      PERMANENT    → FAILED(failureReason), finishedAt
      FAILED이면 같은 트랜잭션에서 holdSuccessors(§7.7)
      where 조건: { id, status:'RUNNING', claimToken: token } — count 0 → 임대를 잃음(다른 인스턴스가 회수). warn 로그, 결과 폐기
 6. APPLIED이고 postRunTestSetId 있으면 postRunTestStarter.start(row) → testRunId·resultSummary.postRunTest 갱신(best-effort, §11)
 7. 서버 로그(info): id · action · chatbotId · status/outcome/failureReason · delaySeconds · attemptCount · 해시 앞 8자리 — memo·원문 금지(FR-0-87)
```

- 선점과 실행 사이에 **다른 쓰기 트랜잭션을 두지 않는다**(선점 = 짧은 단일 UPDATE).
- 5의 종결이 DB 오류로 실패하면 행은 RUNNING으로 남고 임대 만료 후 §7.8이 **실제 상태로** 판정한다 — 재실행하지 않는다(at-most-once).

### 7.5 misfire 판정 (J-6, FR-D4-0(misfire 유예))

```
tolerance = pollIntervalMs + 5_000          // "한 주기 지연"은 놓침이 아니다
MISS  ⇔  attemptCount === 0  AND  now − scheduledAt > graceMs + tolerance
```

**판단 — 유예에 폴링 1주기 허용오차를 더한다**: `DEPLOY_SCHEDULE_MISFIRE_GRACE_MINUTES=0`("시각을 놓치면 절대 실행하지 않음")을 문자 그대로 구현하면 **서버가 멀쩡히 떠 있어도** 폴링 지연(최대 30초) 때문에 모든 예약이 `MISSED`가 된다. "놓침"은 **서버가 그 시각에 실행할 수 없었던 경우**여야 한다. 검증: AC-D3-2(+7분 → 실행, 지연 ≈420초) · AC-D3-3(+11분 > 10분35초 → MISSED) · AC-D3-4(유예 0, +1분 > 35초 → MISSED) 모두 성립. 한계값(+10분 20초)은 실행된다 — 시험 경계값으로 고정한다(§18).

| 상황 | 처리 |
|---|---|
| 서버 가동 중 | 다음 tick(≤ 폴링 주기)에 실행 — NFR-DP1 |
| 다운 후 유예+허용오차 이내 기동 | 기동 직후 `runOnce()`에서 지연 실행, `delaySeconds` 기록(S-4) |
| 초과 기동 | `MISSED` + 후속 HELD(§7.7). 실행하지 않는다 |
| 엔진 비활성 인스턴스만 가동 | 아무도 판정하지 않는다 → 엔진 활성 인스턴스가 뜨는 순간 `MISSED`(EX-D-17) · 콘솔은 `meta.overduePendingCount`로 경고(§13.1) |
| 시계 역행(NTP) | `scheduledAt ≤ now`만 보므로 늦게 실행될 뿐, 선점이 상태 기반이라 중복 없음(EX-D-16) |
| **선행 예약이 재시도로 오래 걸려 후속의 유예가 지남** | 후속도 `MISSED`(유예는 **자기 예정 시각** 기준). 보수적이지만 예측 가능하다 — §20 L-4 |

### 7.6 재시도 분류표 (J-7, FR-D3-9/10) — `lib/outcome-classifier.ts`

| 발생원 | 오류/결과 | 분류 | 예약 결과 |
|---|---|---|---|
| `restore()` | 정상 반환 | APPLIED | SUCCEEDED(APPLIED) |
| `restore()` | `409 RESTORE_NO_CHANGES` | **NOOP** | SUCCEEDED(NOOP) — 감사·백업 없음(AC-D2-7, FR-D3-13) |
| `restore()` | **`409 RESTORE_BUSY`**(신설, §9.1) | **TRANSIENT** `DB_BUSY` | PENDING(재시도) |
| `restore()` | `409 RESTORE_BLOCKED_BY_ACTIVE_JOB` | **TRANSIENT** `ACTIVE_JOB` | PENDING(재시도, S-5) |
| `restore()` | `409 RESTORE_IN_PROGRESS`(in-process 잠금) | **TRANSIENT** `RESTORE_LOCKED` | PENDING(재시도) |
| `restore()` | `409 RESTORE_PREVIEW_STALE`(해시 불일치 — 이제 **이 경우만**) | PERMANENT | FAILED(`STATE_CHANGED`) — AC-D3-1 |
| `restore()` | `404 NOT_FOUND`(사전 확인 후라 = 버전 소실) | PERMANENT | FAILED(`TARGET_VERSION_MISSING`) |
| `restore()` | `422 VERSION_INTEGRITY_FAILED` | PERMANENT | FAILED(`INTEGRITY_FAILED`) |
| `restore()` | `422 VERSION_SCHEMA_UNSUPPORTED` | PERMANENT | FAILED(`SCHEMA_UNSUPPORTED`) |
| `restore()` | `422 VERSION_SNAPSHOT_TOO_LARGE`(복원 직전 백업 초과) | PERMANENT | FAILED(`BACKUP_TOO_LARGE`) |
| `restore()`·공개 전환 | `409 CHATBOT_ARCHIVED` | PERMANENT | FAILED(`CHATBOT_ARCHIVED`) |
| `restore()` | `500 INTERNAL_ERROR`(사후 검증 실패 — 전체 롤백됨) | PERMANENT | FAILED(`INTERNAL_ERROR`) |
| 공개 전환 | `400 INVALID_STATUS_TRANSITION` | PERMANENT | FAILED(`INVALID_TRANSITION`) |
| 공개 전환 | `changed:false` | NOOP | SUCCEEDED(NOOP) |
| 모든 경로 | Prisma `P2034` · `SQLITE_BUSY`/`database is locked`(원시 오류) | **TRANSIENT** `DB_BUSY` | PENDING(재시도) |
| 실행 전 | 예약자 재검증 실패 | PERMANENT | FAILED(`CREATOR_NOT_AUTHORIZED`) — 재시도 없음(AC-D4-3/4) |
| 실행 전 | ACTIVE인데 `acknowledgeActive=false` | PERMANENT | FAILED(`STATE_CHANGED`) |
| 모든 경로 | 그 외 모든 예외(분류 불가) | **PERMANENT** | FAILED(`INTERNAL_ERROR`) — at-most-once 우선, 모르는 오류를 반복하지 않는다 |
| 재시도 창 | `now > scheduledAt + 15분`(시도 ≥1회) | — | FAILED(`BLOCKED_TOO_LONG`) — AC-D3-6 |
| 임대 회수 | 적용 흔적 없음 · 목표 미달 | — | FAILED(`INTERRUPTED`) — AC-D3-11 |

- 재시도 간격 = 폴링 주기(기본 30초, P-6). 별도 백오프를 두지 않는다 — 원인이 "작업 종료 대기"라 선형 폴링이 맞다.
- 재시도 창은 misfire 유예와 **별개**이며 "시각에 맞춰 시작했으나 막힌" 경우(시도 ≥1회)에만 적용된다(FR-D3-10).
- 분류는 `ApiException.code` **문자열**로 한다(메시지 파싱 금지). 분류표 전체가 단위 시험 대상이다(§18).

### 7.7 체인 · HELD 전파 규칙 (J-5, P-8, FR-D3-14)

| 트리거 | 대상 | 결과 | 같은 트랜잭션? |
|---|---|---|---|
| 예약 X가 `FAILED`(원인 무관)·`MISSED` | 같은 챗봇의 `scheduledAt > X.scheduledAt`인 **PENDING 전부**(동작 무관) | `HELD`, `heldReason = PREDECESSOR_FAILED｜PREDECESSOR_MISSED`, `heldByScheduleId = X` | ✅ X 종결과 한 트랜잭션 |
| 복원 예약 X `CANCELLED` | 같은 챗봇의 `scheduledAt > X`인 PENDING **`RESTORE_VERSION`만** | `HELD(PREDECESSOR_CANCELLED)` | ✅ |
| 도래한 PENDING P보다 이른 HELD H 존재 | P | `HELD(PREDECESSOR_HELD, heldBy = H)` | 단건 |
| 예약 X `SUCCEEDED` | — | 전파 없음 | — |

- `FAILED/MISSED/HELD 전이는 감사하지 않는다`(FR-D6-6). 결과는 행과 서버 경고 로그에만 남는다.
- **취소는 공개·채널 예약을 보류시키지 않는다** — 취소는 관리자의 의도적 결정이고, 해시 전제가 깨지는 것은 복원 체인뿐이다(요구사항 FR-D3-3 그대로).
- `PREDECESSOR_HELD`(추가 사유): 보류가 해제되지 않은 선행이 있는데 후속만 실행되면 fail-stop 의미가 무너진다(AC-D3-8의 일반화).

### 7.8 임대(lease) · 기동 시 정리 · 회수 판정 (FR-D3-15)

**임대 = 선점 후 이 시간 안에 종결하지 못하면 "주인이 죽었다"고 간주하는 시간**(`DEPLOY_SCHEDULE_LEASE_MINUTES`, 기본 5분). 단일 인스턴스 가정(`TrainingJobService.onModuleInit`의 "잔존 = 전부 고아")을 **반복하지 않는다** — 다른 인스턴스가 정상 실행 중일 수 있다(AC-D3-12).

- **임대 하한**: 실행 최장 시간 = 준비(수 초) + 복원 트랜잭션(`maxWait` + `timeout` = 2 × `VERSION_TX_TIMEOUT_MS`) + 감사·보존 정리. 따라서 `leaseMs ≥ 2 × VERSION_TX_TIMEOUT_MS + 60_000`(기본 120초)을 **기동 시 검사**하고 미달이면 **경고 로그 + 하한으로 상향 보정**한다(기동 실패 아님 — FR-0-83, `RAG_TIMEOUT_MS` 하한 보정 선례). 기본 5분은 하한의 2.5배다.
- **언제 판정하는가**: 기동 직후 `runOnce()` 1회 + **매 tick**(planner의 `RECOVER` 결정). 별도 기동 전용 루틴이 없다 — 기동 정리 = 첫 tick이다.
- **회수 CAS**: `updateMany({ where: { id, status:'RUNNING', claimToken: 관측값, claimedAt: { lt: now − lease } }, data: { claimToken: 회수토큰 } })` → count 1인 인스턴스만 판정한다(동시 회수 방지). 판정 후 종결도 회수 토큰 CAS.

| 동작 | 판정(`lib/recovery-judge.ts` + 실행기 `judgeRecovery`) | 결과 |
|---|---|---|
| `RESTORE_VERSION` | **이 예약의 백업 흔적**: `chatbotVersion`에서 `chatbotId`, `trigger='BEFORE_RESTORE'`, `createdAt ≥ claimedAt`, `triggerContext.deployScheduleId = id` 인 행 존재 | 존재 → **SUCCEEDED(RECOVERED)** + `backupVersionNo` — 백업은 복원과 **같은 트랜잭션**이므로 백업이 있으면 복원은 커밋된 것이다(ADR-0031 §4) |
| | 흔적 없음 → 현재 해시(`versionCapture.captureSnapshotData`) = `targetContentHash`? | 같으면 **SUCCEEDED(NOOP)**(원하는 상태 달성, 우리가 쓰지 않음) · 다르면 **FAILED(INTERRUPTED)** — 자산 불변(AC-D3-11) |
| `PUBLISH` | `status === 'ACTIVE'` && (`!enableWebChannel` ‖ WEB `enabled`) | 참 → SUCCEEDED(RECOVERED) · 거짓 → FAILED(INTERRUPTED) |
| `SET_WEB_CHANNEL` | WEB `enabled`(행 없음 = false) === 목표 | 동일 |

- FAILED(INTERRUPTED)는 §7.7 전파를 탄다.
- **회수가 감사 공백을 메우지 않는다**: 커밋 직후 ~ 감사 기록 전 크래시는 감사가 누락될 수 있다 — **기존 모든 쓰기와 같은 성질**(ADR-0016 §4 "커밋 후 별도 쓰기")이며 이 그룹만 예외로 보정하지 않는다(PUBLISH는 "우리가 썼는지"를 증명할 수단이 없어 보정하면 오히려 잘못된 주체를 기록할 수 있다). §20 L-5.

### 7.9 수명주기 · graceful shutdown

| 훅 | 동작 |
|---|---|
| `onApplicationBootstrap` | 엔진 활성이면 `await loop.runOnce()`(기동 정리 + 지연 실행 판정) → `loop.start()`. 모든 모듈 `onModuleInit`(예: `TestRunService`의 고아 실행 정리) **이후**라 진행 중 작업 판정이 안정된 상태에서 시작한다. 비활성이면 `info` 로그 1줄만 |
| `onModuleDestroy` | `await loop.stop(30_000)` — 새 선점을 멈추고(`stopping()` 검사는 **선점 직전**) 진행 중 실행의 종결을 기다린다. 30초 안에 안 끝나면 그대로 종료 → 임대가 회수한다. Nest는 의존 역순으로 파괴하므로 `PrismaService` 종료보다 먼저 호출된다 |
| `main.ts` | `app.enableShutdownHooks()` 추가 — 없으면 SIGTERM에서 위 훅이 불리지 않는다. **정합성은 이것에 의존하지 않는다**(강제 종료·정전도 임대가 처리) |

### 7.10 시계 주입 · 테스트 구조 (NFR-DM1/DM4)

- `CLOCK` 토큰(`Clock { now(): Date }`) — 운영 `SystemClock`, 테스트 `FakeClock { set(d), advance(ms) }`. 엔진·서비스·repository는 `new Date()`를 직접 호출하지 않는다(정적 검사 §16 D-12: `deploy-schedules/**`에 `new Date()` 인자 없는 호출 0건, `Date.now()` 0건 — 매퍼의 DB 값 변환 `new Date(x)`는 허용).
- 순수 함수(`planTick`·`classifyOutcome`·`chain-rules`·`recovery-judge`·`checkScheduleTimeRules`·`zonedLocalToInstant`)는 전부 `now`를 인자로 받는다.
- 엔진은 **`tick()`을 public으로 노출**한다. 통합 시험은 `DEPLOY_SCHEDULE_ENABLED=false`로 기동(타이머 없음)하고 `clock.set()` → `await engine.tick()`으로 **실제 대기 없이** misfire·재시도·임대 만료를 결정적으로 재현한다.
- 다중 인스턴스 시험: 같은 SQLite 파일에 **Nest 앱 2개**(각자 엔진·FakeClock)를 띄우고 `Promise.all([a.tick(), b.tick()])` → 실행 1회·백업 1건(AC-D2-1).

### 7.11 다중 인스턴스 보장 요약

| 위험 | 방어 | 층 |
|---|---|---|
| 같은 예약 2회 실행 | CAS `status PENDING → RUNNING` | DB |
| 같은 챗봇 두 예약 동시 실행(순서 역전) | planner 챗봇당 1건 + 부분 유니크 ② | 앱 + DB |
| 같은 분 두 예약 | 부분 유니크 ① | DB |
| 죽은 인스턴스의 RUNNING | 임대 만료 + 회수 CAS | DB |
| 살아 있는 인스턴스의 RUNNING을 남이 회수 | 임대 ≥ 실행 최장 시간(기동 검사) + 종결 CAS가 토큰 불일치를 감지 | 설정 + DB |
| 같은 챗봇에 즉시 복원과 예약 복원 동시 | in-process 잠금(같은 인스턴스) · **복원 트랜잭션 안 해시 재확인**(인스턴스 무관 최종 방어선, EX-D-3/18) | 프로세스 + DB |

---

## 8. 권한 · 실행 주체 · 감사 (J-8, P-9)

### 8.1 권한 단일 소스 — `lib/required-permissions.ts`

| 동작 | 요구 권한(AND) | 즉시 실행 경로와의 대응 |
|---|---|---|
| `RESTORE_VERSION` | `dialogue:write` + `chatbot:write` | `POST …/restore`(ADR-0031 §7) |
| `PUBLISH` | `chatbot:write` (+ `enableWebChannel=true`면 `channel:write`) | `PATCH …/status` · `PATCH …/channels/WEB` |
| `SET_WEB_CHANNEL` | `channel:write` | `PATCH …/channels/WEB` |
| G3 `postRunTestSetId` 지정 | 위 + `simulation:write`(생성 시만 필수 — 실행 시 부족하면 G3만 SKIPPED, §11) | `POST …/test-sets/:setId/runs` |

이 함수 1개를 **생성·수정·취소·재개·확인 판정과 실행 시 재검증이 모두 호출**한다 — 생성 시와 실행 시 권한 집합이 어긋날 수 없다.

### 8.2 API 판정 방식 — **가드 기준선 + 서비스 판정**

**판단**: 요구사항 §5.4는 "동작별 경로 분리 vs 판별 후 재확인"을 물었다. 생성만 경로를 나누면 PATCH·취소·재개·확인(대상 행의 `action`을 읽어야 권한을 안다)은 어차피 서비스 판정이 필요해 **판정 방식이 두 벌**이 된다. 그래서 전 변경 핸들러를 한 방식으로 통일한다.

```
컨트롤러: @RequirePermission('chatbot:read')            // 기준선 — 인증 + 최소 조회 권한(가드가 fail-closed 유지)
         @CurrentUser() user                            // actor가 비즈니스 인자(개발명세서 §2.1 허용 규약)
서비스:   ① 행 조회 전: user가 "관리 권한 중 하나라도"(chatbot:write ∨ channel:write) 없으면 → 403
              (VIEWER + 존재하지 않는 id = 403 — "권한 판정 후 존재 판정" 규약 유지, 개발명세서 §4.1)
         ② 스코프·행 조회(404)
         ③ requiredPermissions(action, params) 전부 보유? 아니면 → PERMISSION_DENIED 감사(가드와 같은 요약 형식·60초 합치기) + 403
```

- `403` 본문에 요구 권한을 담지 않는다(ADR-0015). AC-D4-1(VIEWER 전부 403·DB 변경 0) · AC-D4-2(`chatbot:write`만 가진 가상 역할의 복원 생성 403 — 순수 함수 단위 시험 + 서비스 시험).
- 조회(목록·상세·notice·summary·meta·state-check)는 `chatbot:read` 가드만.

### 8.3 실행 직전 예약자 재검증 — `engine/creator-verifier.ts` (FR-D3-12)

```
user = prisma.user.findUnique({ where: { id: row.createdById }, select: { id, email, role, status } })
통과 조건: user 존재 && user.status === 'ACTIVE' && requiredPermissions(action, params).every(p => hasPermission(user.role, p))
통과 시 actor = { id: user.id, email: user.email(현재), role: user.role(현재) }   ← 감사 주체
```

- `mustChangePassword`는 **권한 박탈이 아니므로** 보지 않는다(관리자가 비밀번호를 초기화했다고 예약이 실패하면 안 된다). 세션 만료도 무관(EX-D-9).
- 사용자는 물리 삭제되지 않지만(비활성으로 대체) 행이 없으면 실패로 처리한다.

### 8.4 감사

| 동작 | `action` | `targetType` | 주체 | summary / 비고 |
|---|---|---|---|---|
| 예약 생성 | `CREATE` | **`DeploySchedule`**(신설) | 요청자 | `targetName = "<동작 라벨> · <시각(STATS_TIMEZONE)>"` |
| 시각·메모 수정 | `UPDATE` | `DeploySchedule` | 요청자 | before/after 화이트리스트 |
| 취소 | `STATUS_CHANGE` | `DeploySchedule` | 요청자(취소자) | `"예약 취소"` |
| 보류 해제 | `STATUS_CHANGE` | `DeploySchedule` | 요청자 | `"보류 해제"` |
| 확인 | — | — | — | 기록 안 함(표시 상태) |
| **예약 실행 — 복원** | `RESTORE`(기존 요약 액션) | `Chatbot` | **예약자**(`actorOverride`) | `"[예약 실행 #1a2b3c4d] v31로 복원 (백업 v33)"` — `after`는 기존과 같은 number만 |
| **예약 실행 — 상태** | `STATUS_CHANGE` | `Chatbot` | 예약자 | `"[예약 실행 #…] 상태 변경: DRAFT → ACTIVE"` |
| **예약 실행 — 채널** | `UPDATE｜CREATE` | `Channel` | 예약자 | `"[예약 실행 #…] 사용 여부 변경: false → true"` |
| NOOP · FAILED · MISSED · HELD · RECOVERED 판정 | — | — | — | **기록 안 함**(FR-D6-6, AC-D4-6) |

- `AUDIT_FIELDS.DeploySchedule = ['action', 'status', 'scheduledAt', 'targetVersionNo', 'memo']`(params는 매퍼가 평탄화한 `enableWebChannel`/`enabled`를 `after`에 number/boolean으로만 추가 — 원문 없음).
- `actorOverride`의 기존 주석("auth 경로 전용")을 "auth 경로 + 예약 실행기"로 갱신한다. **`RequestContextService.get()` 호출 지점은 여전히 `AuditLogService` 1곳**이다 — 예약 실행은 요청 컨텍스트가 없으므로 ALS를 읽지 않고 인자로 주체를 넘긴다(ADR-0016 규약의 "인증되지 않은 주체를 명시 기록" 예외를 넓히는 것).
- `ip`·`userAgent`는 `null`(요청 없음) — 이 자체가 "예약 실행" 흔적이다. summary 접두가 1차 식별자다(AC-D4-5 "`system` 주체 레코드 0건").

---

## 9. 기존 코드 수정 4건의 구체안 (요구사항 분석가 지적 사항)

### 9.1 ① BUSY 원인 분리 — `RESTORE_BUSY` 신설 (FR-D3-9)

**현재**(`version-restore.service.ts` 254~259행): 트랜잭션 밖 `catch`에서 `isBusyError(e)` → `RESTORE_PREVIEW_STALE`. 해시 불일치(208~210행)도 같은 코드라 **"재시도하면 될 경합"과 "상태가 바뀌어 재시도 무의미"를 구분할 수 없다**.

**변경**:
```ts
if (isBusyError(e)) {
  throw new ApiException('RESTORE_BUSY', 409,
    '다른 변경과 동시에 처리되어 복원하지 못했습니다. 변경 사항은 저장되지 않았습니다. 잠시 후 다시 시도해 주세요.');
}
```
- `isBusyError`는 `common/prisma/busy-error.ts`로 **이동**해 예약 분류기(§7.6 원시 오류 행)와 공유한다(판정 1벌).

**판단 — "원인 필드(details)" 대신 코드 분리**:

| 안 | 판정 |
|---|---|
| `RESTORE_PREVIEW_STALE` 유지 + `details:[{field:'cause', message:'BUSY'}]` | 기각. "같은 코드, 다른 의미"를 영구화하고, 분류기가 details 문자열을 파싱해야 한다. 이후 호출부가 cause를 빠뜨리면 조용히 잘못 분류된다 |
| **`RESTORE_BUSY` 신설(채택)** | 코드 = 의미. 경합 후 재시도 시 **트랜잭션 안 해시 재확인**이 실제 변경 여부를 다시 판정하므로 "BUSY = 일시적"이 항상 안전하다 |

**즉시 복원 경로 영향(AC-D5-4 해석)**: 정상 경로의 동작·응답·감사 주체는 **동일**하다. **BUSY 경합일 때만** 응답 코드가 `RESTORE_PREVIEW_STALE` → `RESTORE_BUSY`로 세분화된다. 프런트 `RestoreDialog.tsx` 179행 분기에 `RESTORE_BUSY`를 추가해 **같은 UX**(배너 + 미리보기 자동 재호출)를 유지한다(1줄). 기존 통합 시험 `version-history.integration.spec.ts`의 STALE 단언(해시 불일치 시나리오)은 **무수정 통과**한다. §21 D-10.

Postgres 전환 시 직렬화 실패(`P2034`)도 `RESTORE_BUSY`로 매핑한다(개발명세서 §5 DB 이식성 문구 갱신 — 패치 A-27).

### 9.2 ② 감사 주체 — `restore()` 선택 인자 `invocation` (FR-D3-11)

```ts
// audit-logs/audit-log.service.ts 에 타입만 추가(동작 변경 0)
export interface ScheduledInvocation {
  actor: AuditActorOverride;          // 예약자(재검증 통과한 현재 값)
  auditSummaryPrefix: string;         // '[예약 실행 #1a2b3c4d] '
  triggerContext?: { deployScheduleId: string };
}

// version-restore.service.ts
async restore(chatbotId, versionId, dto: RestoreRequestDto, invocation?: ScheduledInvocation): Promise<RestoreResponse>
  · persistWithin(tx, …, { trigger:'BEFORE_RESTORE', restoredFromVersionId, restoredFromVersionNo,
                           actor: invocation?.actor, triggerContext: invocation?.triggerContext })
  · auditLogService.record({ …기존…, summary: (invocation?.auditSummaryPrefix ?? '') + 기존summary,
                             ...(invocation ? { actorOverride: invocation.actor } : {}) })

// version-capture.service.ts — PersistMeta.actor?: { id: string; email: string }
  const actor = meta.actor ?? this.auditLogService.currentActorSnapshot();
```

- `invocation` 미지정(컨트롤러 경로)은 **바이트 단위로 기존과 동일**하다(AC-D5-4).
- **백업 스냅샷의 `createdBy*`도 예약자**가 된다 — 인자 없이 두면 타이머 경로에서 `null`이 되어 버전 이력에 "생성자 없음" 백업이 생긴다. 이 점은 분석가 지적(감사 주체) 외에 **코드 확인으로 추가 발견**한 지점이다.
- **PUBLISH/SET_WEB_CHANNEL 쪽 확인 결과**: `ChatbotsService.updateStatus()`·`ChannelsService.upsert()`도 ALS에서 주체를 읽는다(명시 인자 없음). 두 메서드에 인자를 추가하지 **않고**, §5.4의 `ChatbotPublicationService`가 처음부터 `invocation`을 받아 `actorOverride`로 기록한다. 기존 두 메서드는 무변경.

### 9.3 ③ 예약 참조 버전 보호 + 삭제 409 (FR-D4-1/2(상태 변경))

```ts
// lib/retention-policy.ts — 순수 함수 입력 확장(기존 호출·테스트 무변경)
export function selectVersionsToPrune(metas, policy, justCreatedId, externallyProtectedIds: ReadonlySet<string> = EMPTY)
  // protectedIds에 externallyProtectedIds 합류. 나머지 알고리즘 불변 — 보호 때문에 총량 초과면 기존 규약(경고 로그)
```

```ts
// capture/version-retention.service.ts
async pruneBestEffort(chatbotId, justCreatedId) {
  try {
    await this.prisma.$transaction(async (tx) => {                      // ★ 읽기 2 + 선정 + 삭제를 한 트랜잭션
      const rows = await tx.chatbotVersion.findMany({ where: { chatbotId }, select: {…} });
      const refs = await tx.deploySchedule.findMany({
        where: { chatbotId, action: 'RESTORE_VERSION', status: { in: ['PENDING','HELD','RUNNING'] }, targetVersionId: { not: null } },
        select: { targetVersionId: true } });
      const result = selectVersionsToPrune(metas, policy, justCreatedId, new Set(refs.map(r => r.targetVersionId!)));
      … payload → version deleteMany …
    });
  } catch { warn — best-effort 불변 }
}

async deleteOne(versionId) {                                            // 수동 삭제(version.service.remove)
  await this.prisma.$transaction(async (tx) => {
    const refs = await tx.deploySchedule.findMany({ where: { targetVersionId: versionId, status: { in: ACTIVE } },
                                                    select: { id, scheduledAt, status }, orderBy: { scheduledAt:'asc' }, take: 10 });
    if (refs.length > 0) throw new ApiException('VERSION_REFERENCED_BY_SCHEDULE', 409,
        '이 버전을 대상으로 한 예약이 있어 삭제할 수 없습니다. 예약을 먼저 취소해 주세요.',
        refs.map(r => ({ field: r.id, message: r.scheduledAt.toISOString() })));
    … 기존 삭제 …
  });
}
```

- **경합 방어**: 예약 생성 트랜잭션은 대상 버전 존재를 재확인하고(§6.4 ⑤), 정리·삭제 트랜잭션은 활성 참조를 재확인한다. SQLite 직렬화로 "참조가 생긴 직후 버전이 사라지는" 창이 없다. 정리의 BUSY는 best-effort로 흡수된다(다음 생성 때 재시도).
- `version-capture` 모듈은 이미 자산 모듈 5곳이 import하지만, 추가되는 것은 **`deploySchedule` 읽기 1건**(Prisma)뿐이라 DI 그래프가 바뀌지 않는다.
- 고정(pinned)과 무관하다 — 예약 대상 버전의 고정 해제는 영향 없음(EX-D-20).

### 9.4 ④ ADR-0025/0031 봉인 문구 개정 + 정적 보장

**개정 문구(ADR-0025 갱신 · ADR-0031 갱신 · 개발명세서 §2.2/§5 — 패치 B-1·B-2·A-4·A-22·A-23)**:

> "복원(대화 자산을 쓰는 유일 경로 `VersionRestoreApplier`)은 **① 관리자 요청 핸들러(`POST …/versions/:versionId/restore`) 또는 ② 관리자가 미리보기로 확인하고 해시에 묶어 생성한 예약의 실행기(`deploy-schedules/executors/restore-version.executor.ts`)** 에서만 실행된다. **두 경로 모두 `VersionRestoreService.restore()`를 통하며 applier를 직접 호출하지 않는다.** 그 밖의 스케줄러·Job·콜백 경로는 없다."

**구조적 보장(약속이 아니라 구조)**:

| # | 수단 | 단언 위치 |
|---|---|---|
| 1 | `VersionsModule`이 `VersionRestoreApplier`를 **export하지 않는다** → 예약 모듈에 주입 불가 | 컴파일 · §16 D-2 |
| 2 | `deploy-schedules/**`에 `VersionRestoreApplier`·`RestoreApplier` 심볼 0건 | §16 D-2 |
| 3 | 저장소 전체에서 `.restore(`(VersionRestoreService) 호출 파일 = `versions.controller.ts` + `restore-version.executor.ts` **정확히 2개** | §16 D-3 |
| 4 | **`asset-write-sealing.spec.ts` S-1 허용 파일은 3개 그대로**(intents.service · keywords.service · version-restore.applier) — 예약 모듈은 자산 테이블 쓰기 호출 0건 | 기존 S-1 무수정 통과 + §16 D-1 |
| 5 | `version-sealing.spec.ts` V-1/V-2/V-3 불변(applier 1파일) + V-3에 `deploySchedule` 쓰기 0건 추가 | §16.2 |

**이 개정이 "승인 없는 자산 변경 금지"(ADR-0025의 본뜻)를 약화하지 않는 이유**: 예약 복원은 ① 관리자가 **미리보기로 차이를 확인**하고 ② 그 기준 상태를 **해시로 묶었으며** ③ 실행 시 상태가 달라졌으면 **실행하지 않고**(엄격 바인딩) ④ 실행 시점에 예약자의 **권한을 재검증**하고 ⑤ 반영 내용은 생성된 문장이 아니라 **과거에 실제 존재한 상태**(캡처 본문뿐 — 가져오기 경로 없음)다. "관리자가 모르는 사이의 변경"이 아니라 "관리자가 승인한 변경의 시각 지연"이다.

---

## 10. No.25 연동 요약

| 항목 | 설계 |
|---|---|
| 보존 보호 | §9.3 — 활성 예약 참조 버전은 정리 제외(AC-D5-1) |
| 수동 삭제 | §9.3 — `409 VERSION_REFERENCED_BY_SCHEDULE` + 예약 목록(AC-D5-2) |
| 백업 식별 | `BEFORE_RESTORE.triggerContext.deployScheduleId` — 버전 이력 화면이 "예약 실행 전 백업" 표기 가능(선택), 기동 회수 판정의 근거(§7.8) |
| 되돌리기 링크 | 상세 응답 `revert: { backupVersionId, backupVersionNo }` → 콘솔이 **기존 즉시 복원 미리보기**를 연다(FR-D5-4, AC-D5-5). 두 번째 즉시 실행 경로를 만들지 않는다(FR-D4-0a(다시 예약)) |
| 진입점 | 버전 행의 "이 버전으로 예약 복원"(FR-D7-2) → `preview` 엔드포인트 |
| 즉시 복원 무회귀 | §9.1·§9.2 — 선택 인자·BUSY 세분화만(AC-D5-4) |

---

## 11. 실행 직후 TC (G3 — 선택, 기본 꺼짐) (FR-D5-3)

- **옵션의 의미**: 예약마다 `postRunTestSetId`를 **지정할 때만** 동작한다(생성 대화상자 체크박스 기본 해제 — P-3 "기본 꺼짐"). 전역 스위치 환경변수는 두지 않는다.
- **허용 동작**: `RESTORE_VERSION`·`PUBLISH`만. `SET_WEB_CHANNEL`은 응답 내용을 바꾸지 않아 TC 결과가 의미 없다 → `409 PRECONDITION_FAILED(TEST_SET_NOT_APPLICABLE)`.
- **호출**: `post-run/post-run-test.starter.ts` 1파일이 `TestRunService.start(chatbotId, setId, { overlaySource: 'NONE', useRag: false })`를 호출한다 — No.19의 `SINGLE` 모드 **그대로**(반영 후 = 현재 상태). 큐·상태 싱크·동시 1건 규약·보존 정리 전부 기존 것.
- **조건**: `outcome === 'APPLIED'`일 때만(NOOP·RECOVERED는 시작하지 않음).
- **실패는 예약 결과를 바꾸지 않는다**: 예약자에게 `simulation:write`가 더는 없음 → `SKIPPED(CREATOR_NOT_AUTHORIZED)` · 세트 삭제·비어 있음 → `SKIPPED(TEST_SET_MISSING｜TEST_SET_EMPTY)` · `TEST_RUN_IN_PROGRESS` 등 → `REJECTED(<code>)`. 결과는 `resultSummary.postRunTest`에 남고 경고 로그 1줄. **자동 롤백 없음**(G4 기각).
- `TestRun`에는 생성자 컬럼이 없으므로 감사·주체 문제가 없다(실행은 감사 대상이 아님 — ADR-0029 §5).
- ⚠ 새벽 실행 시 ml-worker 점유(요구사항 §4.11) · 같은 챗봇의 **다음 복원 예약이 이 TC 실행 때문에 `ACTIVE_JOB` 재시도에 들어갈 수 있다**(2,000 TC ≈ 4분 < 재시도 창 15분). 생성 대화상자가 "다음 예약과의 간격이 짧으면 TC 실행이 끝날 때까지 기다립니다"를 안내한다.

---

## 12. 준비도 경고 (G0' — 조회 시점 계산, 저장 안 함) (FR-D2-7, FR-D5-2)

| `code` | 조건 · 산출(전부 Prisma 읽기 또는 기존 서비스 읽기) | 적용 동작 |
|---|---|---|
| `EMBEDDING_INDEX_INCOMPLETE` | 기존 `embeddings/status` 산출(서비스 재사용)의 `PENDING`/`FAILED` 건수 > 0 | 전부 |
| `LAST_TEST_RUN` | 최근 `TestRun`(SUCCEEDED) 1건: 세트명·통과율·실행 시각 — 정보성. 없으면 `NO_RECENT_TEST_RUN` | RESTORE·PUBLISH |
| `ACTIVE_JOB` | `TrainingJob`/`TestRun` QUEUED·RUNNING — "실행 시각까지 끝나지 않으면 최대 15분 재시도" | RESTORE |
| `RESTORE_WARNINGS` | 기존 복원 미리보기 warnings 11종 그대로(금지어 일치·제거될 승인 증강 예문·`UNRESOLVED` 될 TC 등) | RESTORE(미리보기 시에만) |
| `WEB_CHANNEL_NOT_CONFIGURED` | WEB 행 없음 또는 허용 Origin 비어 있음(EX-D-14) | PUBLISH·SET_WEB_CHANNEL(true) |
| `PUBLISHED_BUT_CHANNEL_CLOSED` | `PUBLISH(enableWebChannel=false)` + WEB 비활성 — "공개되어도 위젯이 열리지 않습니다" | PUBLISH |
| `LONG_HORIZON` | `scheduledAt > now + 30일` — "장기 예약은 그 사이 편집이 있으면 실행되지 않습니다"(EX-D-19) | RESTORE |
| `PREDECESSOR_HELD` | 이보다 이른 HELD 예약 존재 — "앞선 보류 예약이 해제되지 않으면 이 예약도 보류됩니다" | 전부 |
| `ENGINE_DISABLED_ON_THIS_INSTANCE` | 이 인스턴스 `DEPLOY_SCHEDULE_ENABLED=false` | 전부 |

분류기 stale은 **표시하지 않는다**(대화 경로와 무관 — ADR-0027). 상세 조회는 `RESTORE_WARNINGS`를 계산하지 않는다(캡처 1초 비용 — 필요하면 `state-check`).

---

## 13. API 계약 (13개 핸들러 · `@Public()` 추가 0건)

### 13.1 엔드포인트 (`/api/v1` 생략)

| 메서드 | 경로 | 권한(가드 / 서비스) | 요청 / 응답 요지 |
|---|---|---|---|
| `GET` | `/chatbots/:chatbotId/deploy-schedules` | `chatbot:read` | query `status`·`action`·`from`·`to`·`needsAttention`·`order`(기본 `asc`)·`page`·`pageSize`(20/≤100) → `{ items: DeployScheduleListItem[], total, page, pageSize }`. **정렬 키는 `scheduledAt` 고정**(방향만 선택). 해시·캡처 계산 없음(NFR-DP3) |
| `GET` | `/chatbots/:chatbotId/deploy-schedules/notice` | `chatbot:read` | ★ **편집 화면 충돌 배너용**(FR-D4-3(상태 변경)) → `{ upcomingRestore: null ｜ { scheduleId, scheduledAt, status: 'PENDING'｜'HELD', targetVersionNo, chainLength }, activeCount }`. 인덱스 조회 1~2건, 캐시 없음. ⚠ **`/:scheduleId`보다 먼저 선언** |
| `POST` | `/chatbots/:chatbotId/deploy-schedules/preview` | `chatbot:read` / **동작별**(§8.2) | `PreviewDeploySchedule` → `DeploySchedulePreviewResponse`(§6.1). DB 변경 0 |
| `POST` | `/chatbots/:chatbotId/deploy-schedules` | `chatbot:read` / 동작별(+G3 시 `simulation:write`) | `CreateDeploySchedule` → **201** `{ schedule: DeployScheduleDetail, readinessWarnings }` |
| `GET` | `/chatbots/:chatbotId/deploy-schedules/:scheduleId` | `chatbot:read` | `DeployScheduleDetail`(+ 준비도 경고 — 캡처 제외) |
| `POST` | `/chatbots/:chatbotId/deploy-schedules/:scheduleId/state-check` | `chatbot:read` | 본문 없음 → `DeployScheduleStateCheck`(FR-D4-4(상태 변경)). DB 변경 0. 캡처 1회 |
| `PATCH` | `/chatbots/:chatbotId/deploy-schedules/:scheduleId` | `chatbot:read` / 동작별 | `UpdateDeploySchedule`(strict — 시각·메모만) → `DeployScheduleDetail` |
| `POST` | `/chatbots/:chatbotId/deploy-schedules/:scheduleId/cancel` | `chatbot:read` / 동작별 | 본문 없음 → `DeployScheduleDetail` |
| `POST` | `/chatbots/:chatbotId/deploy-schedules/:scheduleId/resume` | `chatbot:read` / 동작별 | `ResumeDeploySchedule` → `DeployScheduleDetail` |
| `POST` | `/chatbots/:chatbotId/deploy-schedules/:scheduleId/acknowledge` | `chatbot:read` / 동작별 | 본문 없음 → `DeployScheduleDetail`(멱등) |
| `GET` | `/deploy-schedules` | `chatbot:read` | 전역 목록 — 위 query + `chatbotId?` → `DeployScheduleListItem[]`(+`chatbotName`). 현재 권한 모델에 챗봇 단위 ACL이 없으므로 **전 챗봇**(NFR-DS3 — ACL 도입 시 이 쿼리 1곳에 필터 추가) |
| `GET` | `/deploy-schedules/summary` | `chatbot:read` | `{ needsAttention: { total, byChatbot: [{ chatbotId, chatbotName, count }] (≤100) }, last24h: { succeeded, failed, missed }, generatedAt }` — 챗봇 목록·대시보드 배지(FR-D6-2)와 전역 요약(FR-D6-3)을 **요청 1회**로. `ChatbotListItem` 계약을 바꾸지 않는다 |
| `GET` | `/deploy-schedules/meta` | `chatbot:read` | `{ timezone, timezoneFallback, engine: { enabledOnThisInstance, pollIntervalMs, misfireGraceMinutes, retryWindowMinutes, leaseMinutes, overduePendingCount }, limits: DEPLOY_SCHEDULE_LIMITS }` — 시간대 전달(FR-D2-10) · 엔진 비활성 경고(FR-D3-8, FR-D7-8) |

- **`overduePendingCount`** = `status='PENDING' AND attemptCount=0 AND scheduledAt < now − (pollIntervalMs × 2 + 60초)` 건수. **엔진이 어디서도 돌지 않는** 상황을 인스턴스와 무관하게 드러낸다(heartbeat 테이블 불필요). 콘솔: `enabledOnThisInstance=false`면 안내 배너, `overduePendingCount > 0`이면 **경고** 배너("예정 시각이 지났는데 실행되지 않은 예약이 n건 있습니다. 실행 서버 설정을 확인해 주세요").
- 공개 표면 변화 0 — 외부 cron용 내부 트리거 엔드포인트를 만들지 않는다(FR-0-85).
- 교차 챗봇 `scheduleId` → `404`(NFR-DS3). `ARCHIVED` 챗봇: **조회(목록·상세·notice·state-check)는 허용**, 생성·수정·재개는 `409 CHATBOT_ARCHIVED`, **취소·확인은 허용**(보관 챗봇의 남은 예약을 정리할 수 있어야 한다).

### 13.2 주요 응답 스키마 요지

```ts
DeployScheduleListItem = {
  id, chatbotId, chatbotName?, action, status, scheduledAt,
  targetVersionNo|null, enableWebChannel|null, channelEnabled|null,          // params 평탄화(표시용)
  memo|null, createdByEmail, createdAt,
  attemptCount, lastTransientReason|null, delaySeconds|null, finishedAt|null,
  outcome|null, failureReason|null, heldReason|null, needsAttention: boolean
}
DeployScheduleDetail = ListItem & {
  params, acknowledgeActive, expectedContentHash|null, targetContentHash|null,
  predecessor: { id, scheduledAt, status, targetVersionNo } | null,
  heldBy:      { id, scheduledAt, status, action } | null,
  resultSummary: DeployScheduleResultSummary | null,
  revert: { backupVersionId, backupVersionNo } | null,                      // RESTORE APPLIED|RECOVERED
  postRunTestSetId|null, testRunId|null,
  cancelledByEmail|null, cancelledAt|null, acknowledgedByEmail|null, acknowledgedAt|null,
  readinessWarnings: ReadinessWarning[]
}
DeployScheduleResultSummary =
  | { kind:'RESTORE', fromVersionNo, backupVersionNo, backupVersionId, counts: Record<VersionAssetKind,{added,removed,modified}>,
      reindexWasRunning, classifierDeleted, postRunTest? }
  | { kind:'PUBLISH', statusBefore, statusAfter, channelBefore: boolean|null, channelAfter: boolean|null, postRunTest? }
  | { kind:'SET_WEB_CHANNEL', channelBefore: boolean|null, channelAfter: boolean }
DeployScheduleStateCheck = {
  applicable: boolean,
  basis: 'CURRENT' | 'CHAIN_HEAD',          // 체인 후속이면 "체인 선두 예약의 기준 해시 vs 현재"를 대신 점검
  headScheduleId?, currentContentHash, expectedContentHash, matches: boolean, checkedAt
}
```

### 13.3 권한·상태별 응답 매트릭스(요약)

| 상황 | 응답 |
|---|---|
| VIEWER가 변경 호출(존재/미존재 무관) | `403 FORBIDDEN` |
| 오프셋 없는 `scheduledAt` | `400 VALIDATION_FAILED`(AC-D1-6) |
| ACTIVE(또는 공개 예정) + `acknowledgeActive` 없음 | `400 VALIDATION_FAILED`(details `acknowledgeActive`) |
| 리드·기간·간격 위반 / 같은 분 경합 | `400 DEPLOY_SCHEDULE_INVALID_TIME` |
| 활성 5건 | `409 DEPLOY_SCHEDULE_LIMIT_EXCEEDED` |
| RUNNING·종단 상태의 수정·취소, PENDING의 재개 | `409 DEPLOY_SCHEDULE_NOT_MODIFIABLE` |
| blockers·체인·중복 공개·이미 공개·G3 부적합 | `409 DEPLOY_SCHEDULE_PRECONDITION_FAILED` + `details[{ field:'precondition', message:<Reason> }]` |
| 미리보기 이후 기준 변경 | `409 RESTORE_PREVIEW_STALE` |
| 생성 트랜잭션 BUSY | `409 RESTORE_BUSY` |
| 보관 챗봇 쓰기 | `409 CHATBOT_ARCHIVED` |

### 13.4 신규 `ApiErrorCode` 6종 (FR-0-84 확정)

| 코드 | HTTP | 발생 |
|---|---|---|
| `DEPLOY_SCHEDULE_INVALID_TIME` | 400 | 리드타임·최대 기간·같은 분(간격) 위반 — "기간 오류"는 400(§4.1 상태코드 규약) |
| `DEPLOY_SCHEDULE_LIMIT_EXCEEDED` | 409 | 챗봇당 활성 5건 |
| `DEPLOY_SCHEDULE_NOT_MODIFIABLE` | 409 | 허용 상태가 아닌 수정·취소·재개 |
| `DEPLOY_SCHEDULE_PRECONDITION_FAILED` | 409 | §13.3 |
| `VERSION_REFERENCED_BY_SCHEDULE` | 409 | 활성 예약이 참조하는 버전 수동 삭제 |
| `RESTORE_BUSY` | 409 | 복원(즉시·예약)·예약 생성 트랜잭션의 동시 쓰기 경합 — **재시도 가능**. 해시 불일치는 계속 `RESTORE_PREVIEW_STALE` |

이 6종은 대화 경로에서 쓰이지 않는다.

---

## 14. 시간대 처리 (J-12)

| 층 | 규칙 |
|---|---|
| 저장 | UTC 순간(`DateTime`), 초·밀리초 0 |
| API 입력 | **오프셋 포함 ISO 8601만**(`…Z` 또는 `…+09:00`). 오프셋 없는 문자열 → 400(AC-D1-6). 서버 OS 시간대와 무관(AC-D6-2) |
| API 출력 | ISO 8601 UTC(`…Z`) — 개발명세서 §4.1 날짜 규약 그대로 |
| 표시·입력 기준 | `STATS_TIMEZONE`(기본 `Asia/Seoul`) — `GET /deploy-schedules/meta`의 `timezone`. 신규 시간대 변수 없음 |
| 변환 | shared-types 순수 함수 `zonedLocalToInstant`·`formatInstantInZone` **1곳**(FE 입력·표시, BE 감사 `targetName` 표기 공용). `Intl.DateTimeFormat(timeZone).formatToParts`로 오프셋을 구해 2회 보정하는 방식 — 라이브러리 의존 0 |
| DST 지역(구축형) | 존재하지 않는 현지 시각(봄 전환) → `NONEXISTENT` → FE 입력 오류("이 시각은 해당 시간대에 존재하지 않습니다") · 중복 시각(가을 전환) → `AMBIGUOUS` → 앞쪽 시각 선택 + 오프셋 명시 안내. 한국은 해당 없음 |
| 라벨 | 모든 시각 옆에 `(KST, UTC+9)` — 약어는 알려진 표(`Asia/Seoul → KST`)에서, 없으면 IANA 이름. 오프셋은 **해당 순간 기준**으로 계산(DST 안전). 브라우저 시간대가 다르면 "서버 기준 시간대(KST)로 표시 중" 안내(FR-D2-10) |
| `STATS_TIMEZONE` 무효값 | `Intl`이 거부하는 값이면 기동 시 경고 로그 + 예약 표시는 `Asia/Seoul`로 폴백(`meta.timezoneFallback=true`). 기동 실패 아님 |

⚠ 통계의 일 버킷은 여전히 **고정 KST**(`KST_OFFSET_MINUTES` — ADR-0017)이다. `STATS_TIMEZONE`을 바꾸면 예약 표시는 따라가지만 통계 버킷은 따라가지 않는다(기존 문서 "변경 비권장"과 같은 한계 — §20 L-8).

---

## 15. 환경변수 (전부 선택 · 기본값 있음 — FR-0-83)

| 변수 | 기본값 | 검증 · 설명 |
|---|---|---|
| `DEPLOY_SCHEDULE_ENABLED` | `true` | 이 인스턴스의 실행 엔진 스위치(CRUD는 항상 동작). **`'true'｜'false'｜'1'｜'0'`만 허용하는 명시 파서**로 검증한다(아래 ⚠) |
| `DEPLOY_SCHEDULE_POLL_INTERVAL_MS` | `30000` | 정수, 5000 ≤ x ≤ 300000 |
| `DEPLOY_SCHEDULE_MISFIRE_GRACE_MINUTES` | `10` | 정수, 0 ≤ x ≤ 1440(FR-D4-0(misfire 유예)). 실제 판정은 + 폴링 1주기 허용오차(§7.5) |
| `DEPLOY_SCHEDULE_RETRY_WINDOW_MINUTES` | `15` | 정수, 1 ≤ x ≤ 1440 |
| `DEPLOY_SCHEDULE_LEASE_MINUTES` | `5` | 정수, ≥ 1. **`< (2 × VERSION_TX_TIMEOUT_MS + 60초)`면 기동 경고 + 하한으로 상향 보정**(§7.8) |

리드타임·최대 기간·간격·챗봇당 상한은 **환경변수가 아니라 `DEPLOY_SCHEDULE_LIMITS` 코드 상수**다(FE 입력 검증과 어긋나지 않게 — 요구사항 §5.5). 조정 요구가 생기면 `meta.limits`가 이미 서버 값을 내려주므로 상수 → 설정 승격이 FE 무변경으로 가능하다.

> ⚠ **코드 확인 중 발견한 기존 결함(이 그룹 범위 밖 — 보고만)**: `env.validation.ts`의 `TRUST_PROXY`·`CLASSIFIER_ENABLED`·`VERSION_AUTO_SNAPSHOT_ENABLED`는 `z.coerce.boolean()`이다. 이는 `Boolean("false") === true`라서 **`=false`로 설정해도 `true`가 된다**(미설정일 때만 기본값이 적용). 특히 `TRUST_PROXY=false`를 명시한 배포가 `X-Forwarded-For`를 신뢰하게 된다. 이 그룹의 `DEPLOY_SCHEDULE_ENABLED`는 명시 파서(`envBoolean()` 헬퍼 — `config/lib/env-boolean.ts` 신설)로 만들고, 기존 3개의 교체는 **별도 수정 건**으로 처리할 것을 권고한다(동작이 바뀌는 수정이므로 이 그룹에 섞지 않는다).
>
> ✅ **수정 완료(2026-09-24, No.28 후속)**: 위 3개와 `AUTH_COOKIE_SECURE`(같은 결함 — `=false`면 Secure 쿠키가 강제돼 http 환경 로그인이 깨질 수 있었다)를 모두 `envBoolean()`으로 교체했다. 규칙은 `true|false|1|0`(앞뒤 공백·대소문자 무시), 미설정·빈 값은 기본값, 그 외 값은 기동 시 검증 실패다(**동작 변경**: 예전에는 `yes` 등 임의 값이 조용히 `true`였다). 같은 원인의 **목록 쿼리 결함**도 함께 고쳤다 — `shared-types`의 쿼리 스키마 9곳(`enabled`·`includeArchived`·`needsAttention`·`recurredOnly`·`regressedOnly`·`pinned`)이 `z.coerce.boolean()`이라 `?enabled=false`가 `true`로 해석돼, 대화 노드 목록·테스트셋 상세의 "비활성만" 필터가 활성 항목을 돌려주고 있었다. 공용 `parseBooleanString()`/`queryBoolean()`(`shared-types/common.ts`)으로 교체했고 `envBoolean()`도 같은 함수를 쓴다. 회귀 시험: `config/env.validation.spec.ts`, `common/query-boolean.spec.ts`. **이후 boolean 입력에 `z.coerce.boolean()`을 쓰지 않는다.**

---

## 16. 정적 검사

### 16.1 신규 `deploy-schedules/lib/deploy-schedule-sealing.spec.ts`

`version-sealing.spec.ts`와 **같은 형식**(스캔 루트 지정 · 자기 자신 제외 · 스캔 대상 0건 아님 가드 · 주석 줄 제외).

| # | 단언 | 근거 |
|---|---|---|
| D-1 | `deploy-schedules/**`에서 `(prisma｜tx).<model>.(create｜createMany｜update｜updateMany｜upsert｜delete｜deleteMany)(` 의 `<model>`은 **`deploySchedule`뿐**이며, 그 호출 파일은 `deploy-schedule.service.ts`·`engine/deploy-schedule.repository.ts` **2개뿐** | FR-0-79, NFR-DS2, AC-D4-7 |
| D-2 | `deploy-schedules/**`에 `VersionRestoreApplier｜RestoreApplier｜IntentsService｜KeywordsService｜FaqsService｜DialogNodesService｜ContextsService｜HomonymsService｜AugmentationAcceptService｜LearningApplyService｜ChatbotsService｜ChannelsService` 심볼 0건 · `deploy-schedules.module.ts` imports에 자산 6모듈·`AnswerSettingsModule`·`AugmentationModule`·`LearningModule`·`ClassifierModule`·`TrainingJobsModule`·`ConversationModule` 0건 | §2.2, J-11 |
| D-3 | 저장소 전체(`apps/api/src/**`, spec 제외)에서 `versionRestore(Service)?\.restore\(` 호출 파일 = `versions/versions.controller.ts`·`deploy-schedules/executors/restore-version.executor.ts` **정확히 2개** | J-11 |
| D-4 | `deploy-schedules/**`·`common/polling/**`에 `fetch(`·`axios`·`http.request`·`https.request`·`nodemailer`·`WebSocket` 0건 | FR-0-86, J-10 |
| D-5 | `@Public()` 총수 **정확히 6** · `deploy-schedules/**` 컨트롤러 0건 | FR-0-85, AC-D4-8 |
| D-6 | `deploy-schedules/**`에 `setTimeout(`·`setInterval(` 0건(타이머는 `common/polling/polling-loop.ts` 1곳) | J-3 — 예약별 타이머 금지 |
| D-7 | `apps/api/package.json` 의존성·`apps/api/src/**` import에 `@nestjs/schedule`·`cron`·`node-cron` 0건 | J-3 |
| D-8 | `deploy-schedules/**`에 `$queryRaw｜$executeRaw｜$queryRawUnsafe｜$executeRawUnsafe` 0건 | NFR-DM5 |
| D-9 | `packages/dialogue-engine/**`에 `deploySchedule`(대소문자 무관) 0건 | FR-0-78 |
| D-10 | `deploy-schedules/**`에서 동작 리터럴 분기(`case 'RESTORE_VERSION'`·`=== 'PUBLISH'` 류)는 `executors/executor.registry.ts`·`lib/required-permissions.ts`·`lib/result-summary.ts` 밖에 0건 | NFR-DM2 |
| D-11 | `common/polling/**`에 `deploySchedule｜DeploySchedule｜PrismaService` 0건 | NFR-DM3(도메인 분리) |
| D-12 | `deploy-schedules/**`에 `Date.now(` 0건 · 인자 없는 `new Date()` 0건 | NFR-DM4(시계 주입) |
| D-13 | `deploy-schedules/**`의 `logger.(log｜warn｜error｜debug)(` 인자에 `memo` 토큰 0건 | FR-0-87 |
| D-14 | `deploy-schedules/**`의 tx 콜백 본문에 `Promise.all(` 0건(`version-sealing` V-10 헬퍼 재사용) | 단일 커넥션 규약 |
| D-15 | `versions/versions.module.ts`의 `exports`에 `VersionRestoreApplier` 0건 | §9.4 #1 |
| D-16 | `TestRunService` 참조 파일(`deploy-schedules/**` 안)은 `post-run/post-run-test.starter.ts` 1개 | §11 |

### 16.2 기존 정적 검사 영향

| 파일 | 영향 |
|---|---|
| `augmentation/lib/asset-write-sealing.spec.ts` | **무수정 통과** — S-1 허용 파일 3개 그대로, S-2(`applyLearningExample` 호출부 3곳) 불변, S-5(`augmentation/**`·`classifier/**`의 `setInterval`) 무관 |
| `versions/lib/version-sealing.spec.ts` | V-1/V-2/V-7/V-8/V-9/V-10 무수정 통과. **V-3 `OUT_OF_SCOPE`에 `deploySchedule` 1개 추가**(버전 모듈은 예약을 읽기만). V-5 금지 목록 불변(예약 모듈을 import하지 않는다) |
| `validation/lib/validation-sealing.spec.ts` | 무수정 통과(`exports` 추가는 검사 대상 아님) |
| `rag-allowlist.spec.ts` | 무관(외부 출구 3곳 불변) |

---

## 17. 비기능 설계

| ID | 설계 |
|---|---|
| NFR-DP1 | 막힘 없을 때 실행 시작 지연 ≤ 폴링 주기(30초) + tick 내 대기. 기본 설정 P95 60초 이내 |
| NFR-DP2 | 공개 대화 경로 신규 조회·계산 **0건**. 유휴 tick = `(status, scheduledAt)` 인덱스 쿼리 1건(≤5ms) |
| NFR-DP3 | 목록 = 테이블 1개 + 챗봇 이름 조인(전역), 해시·캡처 없음 — P95 300ms. `state-check` = 캡처 1회(P95 1초) |
| NFR-DP4 | 복원 실행 = No.25 NFR-HP3 + 선점 UPDATE 1 + 사용자 조회 1 + 종결 UPDATE 1(<100ms) |
| NFR-DP5 | 챗봇 단위 순차 · tick 예산 20초 · 챗봇당 tick 1건 — 다른 API P95 +20% 미만 |
| NFR-DS1~5 | §8 · §16 · params/resultSummary zod에 원문 필드 부재 · 로그 규약(FR-0-87) |
| NFR-DA1~4 | ui-designer 인계(§19) — 텍스트 입력 + 달력 보조 · 시간대가 접근 가능한 이름에 포함 · 배지 7종 텍스트 · 취소 대화상자 기본 포커스 "예약 유지" · `aria-live` · 원인+해결 메시지 |
| NFR-DM1~5 | §2.1 `lib/` · §5.2 레지스트리 · §7.1 `PollingLoop` · §7.10 시계 · 신규 원시 SQL 0(부분 유니크는 마이그레이션 DDL이지 런타임 SQL이 아니다) |

---

## 18. 시험 관점 (test-automation 인계)

| 층 | 대상 | 핵심 케이스 |
|---|---|---|
| **단위(순수)** | `tick-planner` | 도래 선정 · 챗봇당 1건 · RUNNING 챗봇 건너뜀 · 임대 만료 → RECOVER · 앞선 HELD → HOLD · **misfire 경계**(유예 10분: +7분 실행 / +10분20초 실행 / +10분36초 MISSED / 유예 0: +10초 실행·+36초 MISSED) · 재시도 창 경계(+14분59초 EXECUTE / +15분1초 EXPIRE) |
| | `outcome-classifier` | §7.6 표 전 행(원시 `P2034`·`SQLITE_BUSY` 포함, 미지 예외 = PERMANENT) |
| | `chain-rules` | R1(선행 없음/있음/선행이 HELD) · R2(뒤에 복원 있으면 거부) · R3(상대 순서 불변 판정) · R6 대상 선정 · 후속 보류 대상(동작 무관) |
| | `recovery-judge` | 백업 흔적 있음 → RECOVERED / 없음+해시 같음 → NOOP / 없음+다름 → INTERRUPTED · PUBLISH·채널 목표 판정 |
| | `required-permissions` | 3동작 × `enableWebChannel` × G3 · 가상 역할(`chatbot:write`만) 복원 거부(AC-D4-2) |
| | `checkScheduleTimeRules` · `zonedLocalToInstant` | AC-D1-6/7/8 · AC-D6-1/2 · DST 가상 시간대(`America/New_York`) 존재하지 않는/중복 시각 |
| | `PollingLoop` | 겹침 없음 · 예외 후 생존(AC-D2-8) · `stop()`이 진행 중 tick 대기 · `runOnce()` 중복 호출 1회 실행 |
| | `retention-policy` | 외부 보호 집합 적용(AC-D5-1) · 기존 케이스 무수정 통과 |
| **통합(API + SQLite + FakeClock, 엔진 수동 tick)** | 생성 | AC-D1-1~10(AC-D1-4 체인 기준 해시 · AC-D1-5 ACTIVE_JOB 경고 격하) |
| | ★ 실행 | **AC-D2-1**(앱 2개 동시 tick → 실행 1·백업 1) · AC-D2-2(해시 = 대상) · AC-D2-3(공개 즉시 200) · **AC-D2-4**(채널 쓰기 오류 주입 → 상태 DRAFT 유지) · AC-D2-5 · **AC-D2-6**(08:55/09:00 동시 도래 → 순서) · AC-D2-7(NOOP 감사·백업 0) · AC-D2-9(유휴 tick 쿼리 1 — Prisma 쿼리 이벤트 계측) |
| | ★ 상태 변경·misfire·재시도·보류 | **AC-D3-1**(FAQ 수정 후 실행 → 자산 불변 + STATE_CHANGED + 배지) · AC-D3-2~4 · AC-D3-5(`TestRun` RUNNING → PENDING 재시도 → 종료 후 성공) · AC-D3-6 · **AC-D3-7**(`$transaction`에 BUSY 1회 주입 → `RESTORE_BUSY` → 다음 tick 성공) · **AC-D3-8**(복원 무결성 실패 → 공개 HELD, DRAFT 유지) · AC-D3-9/10 · **AC-D3-11**(커밋 후 강제 종료 = 종결 전 프로세스 종료 시뮬레이션 → 임대 만료 tick → RECOVERED / 커밋 전 종료 → INTERRUPTED, 자산 불변) · **AC-D3-12**(인스턴스 A RUNNING 임대 유효 중 B tick → 미접촉) |
| | ★ 권한·감사·봉인 | AC-D4-1 · AC-D4-2 · **AC-D4-3/4**(DISABLED·강등 → CREATOR_NOT_AUTHORIZED, 실행 0) · **AC-D4-5**(RESTORE 주체 = 예약자, summary 접두, `system` 0건, 백업 `createdByEmail` = 예약자) · AC-D4-6 · AC-D4-9(환경변수 0으로 기동·실행) |
| | No.25 연동 | AC-D5-1~5 · **즉시 복원 무회귀**(기존 `version-history.integration.spec.ts` 전량 무수정 통과) |
| **정적** | §16 | AC-D4-7/8/10 |
| **성능** | NFR-DP2/5 | 유휴 tick 5ms · 백로그 20건 처리 중 다른 API P95 +20% 미만 |

**필수 6종**(요구사항 §12 지정): AC-D2-1 · AC-D3-1 · AC-D3-3 · AC-D3-8 · AC-D3-11 · AC-D4-3.
**시험 데이터**(`docs/04-test/시험데이터.md` 추가 대상): FakeClock 픽스처 · 2앱 동시 tick 하네스 · 체인 시나리오(v31@T1 → v30@T2 → 공개@T3) · 권한 강등 시나리오 · BUSY 주입 헬퍼(`$transaction` 스파이).
**AC-D3-11 재현 방법**: 실행기 `execute()`를 감싼 테스트 훅으로 "restore() 반환 직후 · 종결 전"에 예외를 던져 종결을 건너뛰게 한다(행은 RUNNING + 백업 존재) → `clock.advance(lease + 1초)` → `engine.tick()`.

---

## 19. 다음 단계 인계

| 에이전트 | 인계 내용 |
|---|---|
| **`ml-engineer`** | **건너뛴다**(P-12). 새 모델·ml-worker 변경 0. 참고: G3 새벽 TC 실행 부하는 No.19의 기존 부하다 |
| **`ui-designer`** | ① 정보 구조: 챗봇 상세 "예약 배포" 탭 + 전역 운영 화면(전체 예약) + 상단 24시간 요약 진입점 ② **생성 대화상자**: 동작 선택 → 동작별 입력 → `preview` 결과(복원은 기존 미리보기 컴포넌트 재사용 · 체인이면 "기준: 10/1 00:00 예약(v31) 반영 후 상태" 명시) → 준비도 경고 9종 → 시각·메모 → G3 체크박스(기본 해제) → 확정 버튼 라벨에 대상 명시("11/1 00:00에 v30으로 복원 예약") ③ **시각 입력**: 날짜·시·분 텍스트 입력 + 달력 보조, `(KST, UTC+9)`를 접근 가능한 이름에 포함, "지금으로부터 n일 n시간 후" 보조문, `meta.limits`로 즉시 검증 ④ 상태 배지 7종(색+텍스트)·"확인 필요 n" ⑤ **자산 편집 화면 충돌 배너**(`notice` — 의도·키워드·동음이의어·컨텍스트·노드·FAQ·답변설정·기본설정·증강 승인·대량 업로드·학습현황 반영, **저장을 막지 않음**) ⑥ 상세: 기준 상태 점검 버튼 · 결과 · 되돌리기 링크(기존 즉시 복원 미리보기) · TC 결과 링크 · 보류 사유/선행 예약 링크 · "다시 예약"(생성 흐름 프리필) ⑦ 엔진 비활성·기한 초과 배너(`meta`) ⑧ 빈 상태 + **P-2 안내**("운영 중 챗봇의 내용 변경 예약은 버전 이력에서 시작합니다 · 준비하는 동안 편집 내용이 운영에 보입니다") ⑨ 취소 대화상자 기본 포커스 "예약 유지". **UIUX 준수기준에 날짜·시각 입력 규칙(텍스트 입력 병행·시간대 명시)이 없으면 추가를 제안**한다(요구사항 §10) |
| **`backend-implementer`** | §2~§16 전부. ★ **최우선 7가지**: ① CAS 선점 + 부분 유니크 2개(원시 SQL은 마이그레이션에만, 스키마 하단 경고 주석) ② 엄격 해시 바인딩 — 현재 해시는 **생성 쓰기 트랜잭션 안에서** 재계산 ③ 실행 직전 예약자 재검증 + `actorOverride` + 백업 `createdBy` ④ 예약 모듈 자산 쓰기 0 · `restore()` 호출부 2파일 · applier 미export ⑤ 순수 함수 + `CLOCK` 주입(`new Date()` 금지) ⑥ `RESTORE_BUSY` 분리와 `isBusyError` 공용화 ⑦ 보존 정리·삭제의 트랜잭션 안 참조 재확인. 순서 권고: shared-types → Prisma/마이그레이션 → `lib/` 순수 함수 + 단위 시험 → `PollingLoop`/`Clock` → No.25 수정 4건 → `ChatbotPublicationService` → 서비스·미리보기 → 실행기 3종 → 엔진·repository → 컨트롤러 → 정적 검사 |
| **`frontend-implementer`** | FR-D7-\*. 시각 변환은 shared-types 유틸만(자체 구현 금지) · 권한은 `can()`만(복원 예약 = `dialogue:write`∧`chatbot:write`, 공개 = `chatbot:write`(+채널 동시면 `channel:write`), 채널 = `channel:write`) · `RestoreDialog`에 `RESTORE_BUSY` 분기 1개 · 배지 데이터는 `summary` 1회 호출 |
| **`test-automation`** | §18 |
| **`code-reviewer`** | ① 예약 모듈의 자산·상태·채널 직접 쓰기 0 ② 종결·회수 `updateMany` where에 `claimToken` 포함 ③ 감사가 트랜잭션 안에 없음 ④ 로그에 memo·원문 없음 ⑤ `resultSummary`가 number/boolean/uuid/enum만 ⑥ 새 동작 추가 시 레지스트리·권한 함수 외 분기 없음 ⑦ `new Date()`/`Date.now()` 직접 호출 없음 ⑧ `PublicationService`가 `evaluateStatusTransition`·`assertChannelEnableAllowed`를 **호출**하는지(복제 금지) |

---

## 20. 알려진 제한사항 · 재검토 트리거

| # | 제한 | 완화 / 재검토 트리거 |
|---|---|---|
| L-1 | **(a) 경로의 준비 편집이 운영에 보인다**(P-2 수용) — 편집 → 버전 저장 → 즉시 원복 사이 | 콘솔 안내. 트리거: "준비 중 노출 불가" 요구 → **No.40 우선 착수**("포인터 전환" 동작 추가, §5.6) |
| L-2 | 엄격 바인딩 때문에 **장기 예약은 그 사이 편집이 있으면 실패**한다 | 편집 화면 배너 · `LONG_HORIZON` 경고 · `state-check`. 트리거: `STATE_CHANGED` 실패 반복 보고 → `acceptLaterChanges` 재검토(P-4, 요구사항 §9) |
| L-3 | 엔진 비활성 인스턴스만 떠 있으면 예약이 실행되지 않는다(기한 후 MISSED) | `meta.overduePendingCount` 경고 배너 |
| L-4 | 선행 예약이 재시도로 늦어지면 **후속 예약의 유예가 자기 예정 시각 기준으로 소진**되어 MISSED가 될 수 있다 | 보수적·예측 가능 선택. 트리거: 운영에서 이 경로의 MISSED가 관측되면 "선행 종결 시각 기준 유예"로 planner 1곳 수정 |
| L-5 | 커밋 직후~감사 기록 전 크래시 시 **감사 누락** 가능(회수가 보정하지 않음) | 기존 모든 쓰기와 같은 성질(ADR-0016 §4). 예약 행·백업 스냅샷에는 사실이 남는다 |
| L-6 | 크래시 후 재기동 시 RUNNING 행은 **임대 만료(기본 5분)까지** 판정되지 않고, 그동안 같은 챗봇의 후속 예약도 대기한다 | 임대 5분 < 유예 10분이라 통상 후속이 MISSED되지 않는다. 트리거: 인스턴스 식별자 기반 즉시 회수(자기 인스턴스가 남긴 행) 도입 |
| L-7 | 종단 예약 행이 정리되지 않고 누적된다 | 챗봇당 월 수 건 규모. 트리거: 행 수 증가 시 보존 배치(No.45 — `PollingLoop` 재사용) |
| L-8 | `STATS_TIMEZONE`을 바꾸면 예약 표시는 따라가지만 통계 일 버킷(고정 KST)은 따라가지 않는다 | 기존 "변경 비권장" 문구 유지 |
| L-9 | 전역 목록·요약이 전 챗봇을 보인다(챗봇 단위 ACL 부재) | ACL 도입(No.22/45) 시 쿼리 1곳 필터 |
| L-10 | G3 TC 실행이 같은 챗봇의 다음 복원 예약을 최대 수 분 재시도시킨다 | 생성 시 안내. 재시도 창 안이다 |
| L-11 | 반복 예약·외부 알림·2인 승인·실행 전 TC 게이트·자동 롤백 없음 | 요구사항 §9 트리거 그대로 |

---

## 21. 요구사항 대비 해석 · 편차 (PM 재확인 불요 — 설계 판단 범위)

| # | 요구사항 원문 | 이 설계 | 근거 |
|---|---|---|---|
| D-1 | FR-D3-1 목록 페이지 기본 50 | **기본 20 · 최대 100** | 개발명세서 §4.1 목록 공통 규약(`/versions`도 20) |
| D-2 | §5.4 핸들러 9개 | **13개**(+`preview`·`notice`·`summary`·`meta`) | 체인 기준 결정을 서버에 두기(FR-D7-4) · 편집 화면 10여 곳이 같은 계약을 쓰게(FR-D4-3(상태 변경)) · 배지를 `ChatbotListItem` 계약 변경 없이(FR-D6-2) · 시간대·엔진 상태 전달(FR-D2-10, FR-D3-8) |
| D-3 | FR-D2-5 `ARCHIVED` → `PRECONDITION_FAILED` | **`409 CHATBOT_ARCHIVED`**(메시지로 DRAFT 경유 안내) | "보관 챗봇 쓰기 = `CHATBOT_ARCHIVED`"가 전 모듈 공통 규약(ADR-0031이 복원에서도 재사용) |
| D-4 | FR-D3-2 "복원 체인 순서가 바뀌면 거부" | **R2 복원 체인 append-only + R3 모든 활성 예약의 상대 순서 보존** | 생성 시 끼워 넣기도 같은 문제(뒤 예약 기준 해시가 조용히 틀어짐). 순서 역전은 복원·공개 사이에서도 옛 내용 공개 사고 |
| D-5 | 상태표 · `failureReason` 11종 | **`PENDING → FAILED(BLOCKED_TOO_LONG)` 간선 추가 · `BACKUP_TOO_LARGE` 추가(12종) · `heldReason`에 `PREDECESSOR_HELD` 추가** | 재시도 대기 중 장기 다운 종결 경로 · 복원 직전 백업 20MB 초과(`VERSION_SNAPSHOT_TOO_LARGE`)는 관리자가 취할 조치가 달라 `INTERNAL_ERROR`와 구분 · 보류 미해제 선행의 fail-stop |
| D-6 | J-6 "유예 10분 이내면 지연 실행" · FR-D4-0(misfire 유예) "0 = 놓치면 절대 실행 안 함" | **유예 + 폴링 1주기 + 5초 허용오차** | 문자 그대로면 유예 0에서 정상 가동 중에도 전부 MISSED(§7.5) |
| D-7 | FR-D3-15 RECOVERED 조건 "현재 해시 = 대상 해시 AND 백업 존재" | **백업 흔적(`deployScheduleId` 표시)만으로 RECOVERED** · 흔적 없고 해시 같으면 **SUCCEEDED(NOOP)** | 백업은 복원과 같은 트랜잭션이라 존재 = 커밋 증명. 커밋 후 다른 편집이 있어도 "우리가 실행했다"는 사실은 참. 해시만 같으면 우리가 쓰지 않았으므로 NOOP이 정직하다 |
| D-8 | §5.4 `acknowledge` 권한 `chatbot:read`(⚠) | **해당 동작의 관리 권한**(VIEWER 불가) | FR-D7-6("VIEWER에게 확인 버튼이 렌더되지 않는다")과 일치. 운영 모니터가 배지를 지워 편집자가 문제를 못 보는 것 방지 |
| D-9 | FR-D5-3 G3 적용 동작 · 권한 | **`RESTORE_VERSION`·`PUBLISH`만** · 생성 시 `simulation:write` 필수, 실행 시 부족하면 **G3만 SKIPPED** | 채널 전환은 응답 내용 불변 · G3 실패가 예약 성공을 뒤집지 않는다(FR-D5-3 원칙) |
| D-10 | AC-D5-4 "즉시 복원 동작·응답 동일" | **정상 경로 동일, BUSY 경합 시에만 코드가 `RESTORE_BUSY`로 세분화** + FE 1줄 | FR-D3-9·FR-0-84가 요구한 원인 구분의 불가피한 결과. UX는 동일(미리보기 재호출) |
| D-11 | (규정 없음) 활성 `PUBLISH` 중복 | **거부**(`DUPLICATE_PUBLISH`) | 두 번째는 반드시 NOOP |
| D-12 | FR-D2-1 "`restore/preview`의 `currentContentHash`를 `previewedContentHash`로" | **`deploy-schedules/preview`의 `restore.base.contentHash`** | 체인이면 기준이 "현재"가 아니다. 서버가 기준을 결정해야 FE가 체인 규칙을 복제하지 않는다 |
| D-13 | FR-D2-10 "`/auth/me` 또는 설정 조회" | **`GET /deploy-schedules/meta`** | `/auth/me` 계약 불변. 엔진 상태·한도와 함께 내려준다 |
| D-14 | FR-D2-15 재개 주체 | 재개해도 **예약자는 원 예약자**, 원 예약자가 권한을 잃었으면 재개 409 | 재개자 명의로 바꾸려면 새 예약(감사 주체의 명확성) |
| D-15 | 요구사항 §5.2 `DeploySchedule` 컬럼 개요 | `cancelled*`·`heldAt`·`claimToken` 등 추가 · params JSON + `targetVersionId` 비정규화 | 취소자 표시(FR-D2-15) · CAS · 보존 보호 인덱스(§4.1 판단) |
