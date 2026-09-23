# 챗봇 복원/버전 이력관리 세부 설계서 (No.25)

> **요구사항**: `docs/requirements/version-history.md`(J-1~J-14, FR-0-68~77, FR-H1-\*/H2-\*/H3-\*/H4-\*, NFR-HP/HS/HA/HM, AC-H1~H4, EX-H-1~16)
> **상위 문서**: `docs/02-spec/개발명세서.md` §2.2·§3·§3.1·§4·§4.1·§5·§5.1·§6(결정 32 신설)
> **신규 ADR**: **ADR-0031**(챗봇 버전 = 대화 자산 시점 스냅샷 · ID 보존 차이 적용 복원 · 단일 쓰기 트랜잭션 · 파생 데이터 재계산 · No.40 경계)
> **갱신 ADR(각주만)**: ADR-0002(되돌릴 수단 도입 · 영구삭제 동반 삭제 3테이블) · ADR-0015(`@RequirePermission` 복수 인자 AND · 신규 권한 0종) · ADR-0016(`RESTORE` 요약 액션 · `ChatbotVersion` 대상 · 자동 스냅샷/정리 비감사 · actor 스냅샷 읽기 메서드) · ADR-0025(자산 쓰기 봉인 S-1의 3번째 허용 파일) · ADR-0027(`EXAMPLES_DRIFTED`가 감소를 못 잡는 사실 · 복원 시 모델 삭제) · ADR-0029(`envFingerprint.assetContentHash` 연결은 1차 제외)
> **작성일**: 2026-09-23 · **GPU**: **1 유지**(새 모델 0 · ml-worker 변경 0). ml-engineer 신규 작업 없음 — §18.
> **기존 파일 수정 목록**: 문서는 `docs/02-spec/version-history-patches.md`, 코드는 이 문서 §2.5.

---

## 1. PM 확정 사항 (2026-09-23 — §11 P-1~P-10 전부 기본 제안값)

| # | 확정 내용 | 이 문서에서의 반영 |
|---|---|---|
| P-1 | 수동 + 대량변경 직전 자동 5종(임포트 커밋 · 일괄 삭제 · 증강 승인 · 학습현황 일괄 반영 · 복원 직전), 단건 CRUD 제외, 직전 스냅샷과 해시 동일 시 생략 | §6.4(훅 **8지점** 실제 위치) · §6.2 ④(해시 비교를 쓰기 트랜잭션 안에서) |
| P-2 | `Chatbot` 표시 설정 4필드(`name`/`avatarUrl`/`description`/`skin`) 포함 | §5.1 `profile` · §8.1 경고 `PROFILE_WILL_CHANGE` |
| P-3 | 스냅샷 범위 **전체 원자적 교체만**(부분 복원 없음) | §8 · 내용 조회(§10 `content`)가 "과거 값 복사" 경로 |
| P-4 | 자동 스냅샷 실패 = **fail-open**(경고 후 본 동작 진행), 단 **복원 직전 백업 실패 = fail-closed** | §6.5(fail-open 응답 계약) · §8.3 ④(백업이 복원과 **같은 트랜잭션** — 구조적 fail-closed) |
| P-5 | 신규 권한 없음 — `dialogue:write` + `chatbot:write` 재사용 | §11(`@RequirePermission` 복수 인자 AND 확장, 권한 유니온 15종 불변) |
| P-6 | 자동 30 / 수동 30 / 고정 10, 1건 20MB, 챗봇당 300MB, JSON + `schemaVersion` + 업캐스터 + `contentHash` | §4 · §5 · §6.6 · §15 |
| P-7 | 체크박스 확인 + 대상 버전 명시 버튼(세부 ui-designer) | §10 `acknowledgeActive`(ACTIVE 챗봇이면 서버 재검증) · §18 ui-designer 인계 |
| P-8 | 롤백으로 제거된 승인 예문 재제안 **불허**, 미리보기에서 경고 | §8.1 경고 `ACCEPTED_SUGGESTIONS_NOT_RESUGGESTED` · `AugmentationSuggestion` 쓰기 0건(§16 V-3) |
| P-9 | **ID 예외 없이 보존** | §8.4(차이 적용 · 원래 `id`로 create/update) · §8.5(사후 해시 검증) |
| P-10 | GPU 1 · ml-engineer 불필요 | §18 |

---

## 2. 아키텍처 배치

### 2.1 신규 모듈 `apps/api/src/versions/` — **캡처 모듈과 복원 모듈을 분리한다**

기존 4계층 규약(개발명세서 §2.1)을 따른다. 자동 스냅샷 훅이 **대화 자산 모듈(intents·keywords·faqs) + learning + augmentation 5개 모듈**에서 호출되므로, 그 모듈들이 import하는 쪽은 **자산을 쓰지 않는 캡처 모듈**뿐이어야 한다. 복원(= 대화 자산 쓰기 유일 경로)은 별도 모듈에 둔다. 이렇게 하면 **대화 자산 모듈의 DI 그래프에 복원 쓰기 경로가 들어가지 않는다**(ADR-0025 봉인 L1과 같은 방식 — FR-0-69, NFR-HS3).

```
apps/api/src/versions/
├── capture/
│   ├── version-capture.module.ts        # ★ export: VersionCaptureService 1개. 자산 모듈 5곳이 import
│   ├── version-capture.service.ts       # 일관 읽기 캡처 · 영속화(수동/자동/BEFORE_RESTORE 공용) — 대화 자산 쓰기 0
│   └── version-retention.service.ts     # 보존 정리(생성 직후 호출, best-effort)
├── versions.module.ts                   # 컨트롤러·조회·차이·복원. VersionCaptureModule을 import
├── versions.controller.ts               # 12개 핸들러(§10)
├── version.service.ts                   # 목록·상세·현재상태·라벨/메모/고정·삭제 + AuditLog 기록 지점 — payload 미접근
├── version.mapper.ts
├── read/
│   └── version-payload.reader.ts        # payload 로드 → JSON 파싱 → 해시 검증 → 업캐스트 → hydrate(조회·차이·복원 공용)
├── diff/
│   └── version-diff.service.ts          # 비교 쌍 로드 + lib/version-diff 호출(저장 0)
├── restore/
│   ├── version-restore.service.ts       # 미리보기·확정 오케스트레이션, 잠금, 후속 처리, 감사
│   ├── version-restore.applier.ts       # ★ 대화 자산 9테이블 + Chatbot 4필드 + 분류기 삭제를 쓰는 **유일한 파일**
│   ├── restore-warnings.service.ts      # 경고 산출(읽기 전용 — 제안·TC·금지어·RAG 설정)
│   └── restore-lock.registry.ts         # 챗봇 단위 in-process 복원 잠금(동기 Set)
└── lib/                                 # DB·Nest 무의존 순수 함수(NFR-HM1)
    ├── snapshot-canonical.ts            # 정규 직렬화 · contentHash
    ├── snapshot-envelope.ts             # 캡처 결과 → 저장 봉투(slim) · counts
    ├── snapshot-hydrate.ts              # slim → DialogueBundle/설정/프로필 DTO 형태(검증 입력)
    ├── snapshot-upcasters.ts            # schemaVersion 체인(v→v+1)
    ├── snapshot-integrity.ts            # 참조 그래프 · 도메인 상한 · 정규화 유일성 · 노드 유형 유일성
    ├── version-diff.ts                  # 차이 계산(요약/목록/필드)
    ├── restore-plan.ts                  # 현재 ↔ 대상 → 순서 있는 적용 계획
    ├── retention-policy.ts              # 정리 대상 선정
    ├── __fixtures__/snapshot-v1.json    # ★ 영구 픽스처 — 수정 금지(NFR-HM4)
    └── version-sealing.spec.ts          # 정적 검사(§16)
```

### 2.2 모듈 의존 방향 (단방향)

```
intents / keywords / faqs / learning / augmentation ──▶ version-capture   (훅 1줄씩, §6.4)

version-capture → dialogue-common(DialogueBundleService.build — tx 인자)
                → prisma · config · audit-logs(actor 스냅샷 읽기만)

versions → version-capture
         → chatbots(ChatbotScopeService)
         → dialogue-common(DialogueBundleService.invalidate)          ※ 캐시·벡터 캐시·재색인 예약 단일 지점
         → answer-settings(AnswerSettingsCacheService.invalidate)
         → embedding(ReindexQueueService.isRunning — 읽기만)          ※ QueryEmbeddingService는 주입하지 않는다
         → banned-words(BannedWordFilterService — 경고 산출 읽기만)
         → audit-logs(AuditLogService)
```

**import 하지 않는 모듈(봉인 — §16 정적 검사로 단언):**

| 금지 대상 | 이유 |
|---|---|
| `IntentsModule`·`KeywordsModule`·`FaqsModule`·`DialogNodesModule`·`ContextsModule`·`HomonymsModule` | 순환 의존(자산 모듈 → capture) 방지 + 복원 쓰기가 **자산 서비스의 상한·충돌 규칙을 거치지 않는** 이유가 명확해야 한다 — 복원은 "새 편집"이 아니라 **과거 상태의 재현**이며, 검증은 §5.5의 스냅샷 무결성 검사가 한다 |
| `AugmentationModule` | 승격 유일 지점(`AugmentationAcceptService`)이 DI 그래프에 들어온다(ADR-0025). 복원 경고에 필요한 제안 정보는 **Prisma 읽기**로 얻는다 |
| `ValidationModule`·`TrainingJobsModule`·`ClassifierModule`·`LearningModule`·`ConversationModule` | 진행 중 작업·TC 판정·분류기는 **Prisma 읽기**로만 본다(FR-H3-15 — 쓰기 의존 0). 분류기 삭제는 applier가 같은 트랜잭션에서 `deleteMany` 1건으로 처리한다(`ChatbotsService.permanentDelete()` 선례) |
| `EmbeddingModule`의 `QueryEmbeddingService` | 질의 임베딩 캐시는 자산 무관 — 복원이 **건드릴 수단 자체**가 없어야 한다(AC-H3-15) |

### 2.3 엔진 불가침

`packages/dialogue-engine` **변경 0건**(FR-0-68, NFR-HM3). 이 그룹은 엔진을 실행하지 않는다. 단 **`getOutgoingNodeRefs()`(design-validator.ts)를 호출만** 해 노드 아웃풋의 노드 참조(이동·버튼)를 추출한다 — 참조 추출 규칙을 두 벌 만들지 않기 위해서다(§5.5 ②).

### 2.4 `apps/api` 외 워크스페이스 영향

| 워크스페이스 | 변경 |
|---|---|
| `packages/shared-types` | **`version.ts` 신설** + `common.ts`(ApiErrorCode 9종) · `audit.ts`(Action 1 · TargetType 1 · 파괴적 동작 목록) · `chatbot.ts`(`ChatbotSnapshotProfileSchema` — 원본 옆 파생) · `bulk-import.ts`·`learning.ts`(응답에 `autoSnapshot?` 선택 필드) **append** |
| `packages/dialogue-engine` | **변경 0건** |
| `apps/web` | 버전 이력 화면 4뷰(목록·차이·내용·복원 대화상자) + 증강 제안 목록·대량 업로드 확정 화면 안내문(FR-H4-6) + `autoSnapshot.status === 'FAILED'` 경고 표시 |
| `apps/widget` · `apps/ml-worker` | **변경 0건** |

### 2.5 기존 코드 변경 목록 (구현자 체크리스트)

| 파일 | 변경 | 근거 |
|---|---|---|
| `dialogue-common/dialogue-bundle.service.ts` | `build(chatbotId, db = this.prisma)` 선택 인자 추가. `db`가 주입되면 6회 조회를 **순차 실행**(tx 클라이언트 위 `Promise.all` 금지). 기존 호출부 무변경 | FR-H1-6, §6.1 |
| `intents|keywords|faqs/*.service.ts` | `importCommit()`·`bulkDelete()` 각 1줄 훅 + `ImportCommitResult.autoSnapshot` 채우기 | §6.4 |
| `augmentation/augmentation-accept.service.ts` | `accept()` 1줄 훅 + 응답 `autoSnapshot` | §6.4 |
| `learning/unanswered-questions.service.ts` | `bulkResolve()` 1줄 훅 + 응답 `autoSnapshot` | §6.4 |
| 위 5개 모듈의 `*.module.ts` | `imports`에 `VersionCaptureModule` 추가 | §2.1 |
| `chatbots/chatbots.service.ts` | `permanentDelete()` 트랜잭션에 `deleteMany` 3건(payload → version → sequence) 추가 | FR-H1-21, §13 |
| `common/auth/require-permission.decorator.ts` · `permission.guard.ts` | 복수 인자(AND) 지원. 기존 75+곳 호출 무변경 | P-5, §11 |
| `audit-logs/audit-log.service.ts` | 요약 액션 분기에 `RESTORE` 추가 · `currentActorSnapshot()` 공개 메서드 추가 | §12 |
| `audit-logs/lib/audit-snapshot.ts` | `AUDIT_FIELDS.ChatbotVersion` 추가(Record 타입이 강제) | §12 |
| `embedding/index/reindex-queue.service.ts` | **재실행 예약 플래그** 추가(실행 중 `schedule()` 호출을 버리지 않고 종료 후 1회 재실행) | §8.7 |
| `augmentation/lib/asset-write-sealing.spec.ts` | S-1 허용 파일에 `versions/restore/version-restore.applier.ts` 추가, 가드 단언 2 → 3 | §16.2 |
| `config/env.validation.ts` | 선택 환경변수 7종 | §15 |
| `prisma/schema.prisma` + 마이그레이션 1개 | 신규 3테이블 + `Chatbot` 역참조 2필드 | §4 |

---

## 3. `shared-types` 배치 (`version.ts` 신설)

ADR-0003 §9 배치 규칙 — 관심사가 다르고 기존 도메인 파일 어디에도 속하지 않는다. **`conversation.ts`에 넣지 않는다**(위젯 번들 경계). 의존: `version.ts → common · dialogue · dialogue-engine · chatbot · answering`(단방향). `bulk-import.ts`·`learning.ts`가 `AutoSnapshotOutcomeSchema` 1개를 `version.ts`에서 import한다(역방향 없음 — 순환 없음 확인: `dialogue.ts`·`dialogue-engine.ts`·`chatbot.ts`·`answering.ts`는 `bulk-import`/`learning`을 import하지 않는다).

```
packages/shared-types/src/version.ts   [신설]
  - SNAPSHOT_SCHEMA_VERSION = 1 as const          ★ 현재 형식의 단일 소스(FR-H1-12)
  - MIN_RESTORABLE_SCHEMA_VERSION = 1 as const
  - ChatbotVersionTrigger      = z.enum(['MANUAL','BEFORE_IMPORT','BEFORE_BULK_DELETE',
                                         'BEFORE_AUGMENT_ACCEPT','BEFORE_LEARNING_BULK_APPLY','BEFORE_RESTORE'])
  - CHATBOT_VERSION_TRIGGER_LABELS(한국어 6종)
  - VersionTriggerGroup        = z.enum(['MANUAL','AUTO','RESTORE_BACKUP'])   // 목록 필터(FR-H2-1)
  - VersionTriggerContextSchema = { resourceType?: 'INTENT'|'KEYWORD'|'FAQ', targetId?: uuid, itemCount?: int }  // 원문 없음(FR-H1-9)
  - VersionCountsSchema        = { intents, intentExamples, keywords, homonyms, contexts, dialogNodes,
                                   nodeIntentLinks, nodeKeywordLinks, faqs, answerSetting(0|1) }
  - VersionIntegrityWarningSchema = { rule, kind, id, field?, refId? }         // 원문 없음
  - ChatbotVersionListItemSchema / ChatbotVersionDetailSchema / ChatbotVersionListQuerySchema
  - VersionCurrentStatusSchema  = { contentHash, counts, latestVersion|null, hasUnsavedChanges }
  - CreateChatbotVersionSchema  = { label?: ≤50, memo?: ≤500 }
  - CreateChatbotVersionResponseSchema = 판별 유니온 { unchanged:false, version } | { unchanged:true, latestVersionNo, latestVersionId }
  - UpdateChatbotVersionSchema  = { label?: string≤50|null, memo?: string≤500|null, pinned?: boolean }  (최소 1키)
  - VersionAssetKind            = z.enum(['INTENT','KEYWORD','HOMONYM','CONTEXT','NODE','FAQ','ANSWER_SETTING','PROFILE'])
  - VersionDiffSummaryKind      = VersionAssetKind + 'INTEGRITY_WARNING'   (요약 9행 — FR-H2-7)
  - VersionChangeKind           = z.enum(['ADDED','REMOVED','MODIFIED'])
  - VersionRefSchema            = 판별 유니온 { kind:'CURRENT', contentHash } | { kind:'VERSION', versionId, versionNo, contentHash }
  - VersionDiffSummarySchema / VersionDiffQuerySchema / VersionDiffResponseSchema
  - VersionDiffListItemSchema   = { id, kind, change, name, recreated?: { counterpartId }, changedFields? }
  - VersionFieldDiffSchema      = 판별 유니온 by type: SCALAR | VALUE_SET | REF_SET | STRUCT      (§7.3)
  - VersionDiffItemDetailSchema
  - VersionContentQuerySchema / VersionContentPageSchema(kind 판별 유니온 — 기존 IntentSchema 등 **재사용**)
  - VersionAuditCountSchema     = { versionId, from, to, count, link: { chatbotId, from, to, clamped } }
  - RestoreBlockerSchema        = 판별 유니온 by code (§8.1 표)
  - RestoreWarningSchema        = 판별 유니온 by code (§8.1 표)
  - RestorePreviewResponseSchema
  - RestoreRequestSchema        = { expectedCurrentHash: /^[0-9a-f]{64}$/, acknowledgeActive?: boolean }
  - RestoreResponseSchema
  - AutoSnapshotOutcomeSchema   = { status: 'CREATED'|'UNCHANGED'|'FAILED'|'DISABLED', versionNo?, versionId? }
  - VERSION_LIMITS 상수(라벨 50 · 메모 500 · 목록 pageSize 기본 20/최대 100 · 차이·내용 pageSize 기본 50 · 무결성 경고 저장 상한 100)
```

**스냅샷 본문 자체의 zod 스키마는 느슨한 봉투만 둔다**(`ChatbotSnapshotEnvelopeSchema` — `schemaVersion`·`capturedAt`·`chatbotId` + `assets`의 6개 배열은 `z.array(z.unknown())`). **엄격 검증은 hydrate 후 기존 스키마로 한다**(§5.5) — `DialogueBundleSchema`·`UpdateAnswerSettingSchema`·`ChatbotSnapshotProfileSchema`. 두 번째 자산 규약을 만들지 않고(FR-H1-2), 도메인 상한(예문 500·동의어 200·대체질문 30·아웃풋 ≤10·슬롯 1~20 등)이 **기존 단일 소스**에서 자동으로 적용된다(FR-H3-8 ①).

**기존 파일 append(하위호환 확장만):**

| 파일 | 추가 |
|---|---|
| `common.ts` | `ApiErrorCode` **9종** — §10.3 표 |
| `audit.ts` | `AuditAction`에 `RESTORE`(12 → 13, 라벨 `'복원'`), `DESTRUCTIVE_AUDIT_ACTIONS`에 `RESTORE`, `AuditTargetType`에 `ChatbotVersion`(라벨 `'챗봇 버전'`) |
| `chatbot.ts` | `ChatbotSnapshotProfileSchema = ChatbotSchema.pick({ name, avatarUrl, description, skin }).extend({ avatarUrl: SafeUrlSchema.nullable(), description: z.string().max(500).nullable() })` — **원본과 같은 파일**(개발명세서 §6-9 파생 스키마 규칙) |
| `bulk-import.ts` | `ImportCommitResultSchema`에 `autoSnapshot: AutoSnapshotOutcomeSchema.optional()` |
| `learning.ts` | `BulkResultSchema`·`AugmentationAcceptResponseSchema`에 `autoSnapshot` 선택 필드 |

---

## 4. 데이터 모델 (Prisma)

### 4.1 신규 3테이블 — 기존 테이블 컬럼 변경 0건

```prisma
/// [신규 2026-09-23 No.25] 챗봇 대화 자산 시점 스냅샷의 메타(ADR-0031). 목록·상세·보존 정리는 이 테이블만 읽는다 —
/// 본문(payload)은 `ChatbotVersionPayload`로 분리되어 목록 조회가 구조적으로 본문을 읽을 수 없다(FR-H1-17, AC-H1-12).
model ChatbotVersion {
  id              String   @id @default(uuid())
  chatbotId       String
  chatbot         Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// 챗봇별 단조 증가. 정리·삭제로 비어도 재사용하지 않는다(FR-H1-19) — `ChatbotVersionSequence`가 발급한다.
  versionNo       Int
  /// MANUAL | BEFORE_IMPORT | BEFORE_BULK_DELETE | BEFORE_AUGMENT_ACCEPT | BEFORE_LEARNING_BULK_APPLY | BEFORE_RESTORE
  trigger         String
  /// JSON { resourceType?, targetId?, itemCount? } — 문장 원문을 담지 않는다(FR-H1-9).
  triggerContext  String?
  /// 캡처 시점의 본문 형식. 복원·차이 전 업캐스터 체인으로 현재 형식으로 변환한다(FR-H1-12).
  schemaVersion   Int
  /// sha256 hex(64). 정규 직렬화(타임스탬프 제외) 기준(FR-H1-11, §5.2).
  contentHash     String
  /// JSON VersionCounts — 목록의 종류별 건수(FR-H2-1). payload를 읽지 않고 표시하기 위한 비정규화.
  counts          String
  /// 본문 UTF-8 바이트 수(압축 전). 크기·총량 상한 판정 기준(FR-H1-14~16).
  sizeBytes       Int
  /// 'json'(현행 유일). 압축 도입 시 'json+gzip'을 추가한다 — 컬럼이 있으므로 마이그레이션 불필요(ADR-0031 §2).
  payloadEncoding String   @default("json")
  /// JSON VersionIntegrityWarning[] 최대 100건(FR-H1-8). 본문에서 재계산 가능한 파생값이라 본문에는 두지 않는다.
  integrityWarnings     String @default("[]")
  integrityWarningCount Int    @default(0)
  label           String?
  memo            String?
  /// 보존 정리 제외. 챗봇당 최대 10건(VERSION_PINNED_MAX).
  pinned          Boolean  @default(false)
  /// BEFORE_RESTORE일 때 "어느 버전으로 복원하기 직전"인가. FK 없음 — 대상 버전이 정리돼도 이 행은 남는다.
  restoredFromVersionId String?
  /// 표시용 스냅샷(대상이 정리돼도 "v27로 복원하기 전" 표기가 유지된다 — AuditLog.targetName과 같은 규약).
  restoredFromVersionNo Int?
  /// 생성 주체 스냅샷. FK 없음(AuditLog.actorId 규약). 시스템 경로·ALS 부재 시 null.
  createdById     String?
  createdByEmail  String?
  createdAt       DateTime @default(now())
  /// 라벨·메모·고정 변경 시각.
  updatedAt       DateTime @updatedAt

  payload         ChatbotVersionPayload?

  @@unique([chatbotId, versionNo])
  @@index([chatbotId, createdAt])
  @@index([chatbotId, trigger, createdAt])
  @@map("chatbot_versions")
}

/// [신규 2026-09-23 No.25] 스냅샷 본문(1:1). 이 테이블을 참조하는 코드는 캡처·본문 리더·보존 정리·챗봇 영구삭제 4곳뿐이다(§16 V-7).
model ChatbotVersionPayload {
  versionId String         @id
  version   ChatbotVersion @relation(fields: [versionId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// 정규 JSON(§5.1). payloadEncoding='json'이면 UTF-8 텍스트 그대로다.
  payload   String

  @@map("chatbot_version_payloads")
}

/// [신규 2026-09-23 No.25] 챗봇별 versionNo 발급기. `max(versionNo)+1`은 최신 버전 삭제 시 번호를 재사용하므로
/// 쓰지 않는다(FR-H1-19). `Chatbot`에 카운터 컬럼을 두지 않는 이유: Prisma `@updatedAt`이 증가 때마다
/// `Chatbot.updatedAt`을 바꿔 챗봇 목록 정렬(`chatbots(updatedAt)`)이 스냅샷 생성만으로 뒤섞인다.
model ChatbotVersionSequence {
  chatbotId     String  @id
  chatbot       Chatbot @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  lastVersionNo Int     @default(0)

  @@map("chatbot_version_sequences")
}
```

**`Chatbot` 모델**에는 역참조 2필드(`versions ChatbotVersion[]`, `versionSequence ChatbotVersionSequence?`)만 추가된다(Prisma 양방향 관계 요건 — **DB 컬럼 변화 0**).

**인덱스 근거**: `(chatbotId, versionNo) UNIQUE` = 번호 유일성의 최종 방어선 + 목록 정렬(`versionNo desc`) 겸용 · `(chatbotId, createdAt)` = 감사 구간 계산(다음 버전 시각) · `(chatbotId, trigger, createdAt)` = 보존 정리(트리거 분류별 최신 N건)와 목록 트리거 필터. `pinned`는 선택도가 낮아 인덱스를 두지 않는다(챗봇당 최대 수십 행을 앱에서 거른다).

**판단 — 본문 테이블 분리(요구사항 §5.2의 architect 판단 항목)**: 한 테이블 + Prisma `select` 규율로도 FR-H1-17은 지킬 수 있으나, `findMany`에 `select`를 빠뜨리거나 `include`를 쓰는 **한 줄 실수**로 목록이 행당 수 MB를 읽게 된다. 규율 대신 **구조로** 막는다(ADR-0022 이래의 일관된 방식). 비용은 쓰기 1건 추가뿐이다(같은 트랜잭션).

**판단 — 압축 없음(FR-H1-14)**: TEXT 무압축. 통상 1~2MB × 최대 70건(자동 30 + 수동 30 + 고정 10) ≈ 140MB로 총량 상한(300MB) 안이다. 무압축은 SQLite 셸에서 직접 확인 가능해 장애 분석이 쉽고, `zlib`(Node 내장) 도입 시에도 `payloadEncoding` 컬럼으로 **마이그레이션 없이** 전환된다. 재검토 트리거: 챗봇당 총량이 상한에 반복 도달.

### 4.2 만들지 않는 것

증분(델타) 테이블 · 항목별 버전 이력 테이블(`IntentVersion` 류) · 차이 결과 저장 테이블 · 환경/태그/승격 테이블(No.40) · 예약 복원 테이블(No.28) · **복원 Job 테이블**(동기 처리 — FR-H3-19) · 복원 잠금 테이블(§9 — SQLite 직렬화 트랜잭션이 DB 차원의 보장) · 임베딩/분류기 스냅샷 · 스냅샷 내보내기/가져오기 경로(NFR-HS5).

### 4.3 마이그레이션 영향 (기존 데이터 호환성)

| 항목 | 판정 |
|---|---|
| **기존 테이블 컬럼 변경** | **0건**. 신규 테이블 3개 CREATE만. `Chatbot` 역참조는 Prisma 스키마 전용(DDL 없음) |
| **백필** | **불필요**. 3테이블 모두 **0행에서 시작하는 것이 정상**이다. 도입 시점에 "초기 스냅샷"을 일괄 생성하지 않는다 — 첫 수동 저장 또는 첫 대량 작업이 v1이 된다(FR-H4-9 빈 상태 안내). 일괄 생성은 챗봇 수 × 수 MB의 쓰기를 배포 시점에 몰아넣는다 |
| **enum 확장**(`AuditAction`·`AuditTargetType`·`ApiErrorCode`) | 전부 **값 추가**이며 DB는 `String`이라 스키마 마이그레이션 없음. 기존 행 값은 전부 유효 |
| **⚠ `test_runs` 부분 유니크 인덱스** | 이번 마이그레이션은 `test_runs`를 건드리지 않지만, `prisma migrate dev`가 생성한 SQL에 `DROP INDEX "test_runs_chatbotId_active_key"`가 끼어 있지 않은지 **반드시 확인**한다(`schema.prisma` 하단 주석의 기존 경고). 끼어 있으면 그 줄을 제거한다 |
| **롤백** | 3테이블 **DROP만으로 완전 롤백**. 단 코드 롤백 시 훅 8지점·가드 확장·`build()` 인자도 함께 되돌려야 한다(스키마만 되돌리면 캡처가 실패하고 fail-open 경고만 남는다 — 본 동작은 계속된다) |
| **챗봇 영구삭제** | 트랜잭션에 `chatbotVersionPayload`(version.chatbotId 기준) → `chatbotVersion` → `chatbotVersionSequence` **deleteMany 3건 추가**(10 → 13 테이블). **사전 검사(409) 대상이 아니라 동반 삭제**(FR-H1-21, AC-H4-7). `ARCHIVED` 상태에서는 보존된다 |

---

## 5. 스냅샷 직렬화 포맷

### 5.1 저장 봉투 (`payload` 컬럼, `schemaVersion: 1`)

```jsonc
{
  "schemaVersion": 1,
  "capturedAt": "2026-09-23T00:42:11.000Z",
  "chatbotId": "…uuid…",
  "assets": {                         // DialogueBundle 6종과 같은 형태에서 항목별 chatbotId·updatedAt만 제거(FR-H1-2/3)
    "intents":     [{ "id", "name", "description"?, "examples": [], "createdAt" }],
    "keywords":    [{ "id", "name", "description"?, "synonyms": [], "createdAt" }],
    "homonyms":    [{ "id", "word", "description"?, "meanings": [], "policy", "clarifyPrompt"?, "defaultMeaningIndex"?, "createdAt" }],
    "dialogNodes": [{ "id", "name", "description"?, "nodeType", "matchMode", "enabled", "priority",
                      "intentIds": [], "keywordIds": [], "contextVariableId"?, "outputs": [], "createdAt" }],
    "contexts":    [{ "id", "name", "description"?, "slots": [], "completionMessage"?, "cancelKeywords": [], "sessionTimeoutMinutes", "createdAt" }],
    "faqs":        [{ "id", "category", "question", "answer", "altQuestions": [], "enabled", "createdAt" }]
  },
  "answerSetting": null | { "semanticEnabled", "acceptThreshold", "lowThreshold", "marginThreshold", "ragEnabled",
                            "ragCompany", "ragCategory", "ragSubcategory", "ragSimilarityThreshold",
                            "fallbackPolicy", "showSources", "ragTimeoutMs" },   // 행 없음 = null(복원 시 행 삭제 = 기본값)
  "profile": { "name", "avatarUrl": null|"…", "description": null|"…", "skin": { … } }   // P-2
}
```

- **저장하지 않는 것**: 정규화 컬럼(`*Normalized` — 복원 시 `normalizeText()`로 재계산, ADR-0006) · 항목별 `updatedAt`(복원 시각이 된다) · 항목별 `chatbotId`(봉투에 1회) · `integrityWarnings`(파생값 — 메타에만, FR-H1-10의 해석 §20 D-1) · `slug`·`status`·`groupId`·`Channel`·`BannedWord`·파생/운영/검증 데이터(§4.1.2 표 그대로).
- **`createdAt`은 보존**한다(FR-H1-3 — 목록 정렬이 복원으로 뒤섞이지 않게).
- **`skin`은 객체로 저장**한다(DB는 JSON 문자열이지만 `chatbots/lib/skin.util.ts`의 `parseSkin()`으로 파싱한 값). 키 순서 차이가 해시를 흔들지 않는다.
- 조인 2종은 노드의 `intentIds`/`keywordIds`로 평탄화된다(`build()` 115~116행과 동일).
- **자격증명·세션·비밀번호 해시가 들어갈 필드가 봉투에 존재하지 않는다**(NFR-HS2 — 타입 수준 차단).

### 5.2 정규 직렬화 · `contentHash` (FR-H1-11)

순수 함수 `canonicalizeSnapshot(envelope) → string`, `computeContentHash(envelope) = sha256hex(utf8(canonical))`.

| 규칙 | 내용 | 근거 |
|---|---|---|
| 해시 범위 | `assets` + `answerSetting` + `profile`만. **`schemaVersion`·`capturedAt`·`chatbotId`·모든 `createdAt`/`updatedAt` 제외** | 같은 자산 상태 → 같은 해시(AC-H1-5) |
| 객체 키 | 사전순 정렬, `undefined` 키는 **생략**(값 `null`은 유지) | `build()`는 DB `null`을 `undefined`로 매핑한다 — 생략으로 통일해야 캡처↔복원 왕복이 같은 문자열이 된다 |
| 엔터티 배열(6종) | **`id` 오름차순** | DB 조회 순서는 비결정적 |
| **`intentIds`/`keywordIds`** | **오름차순 정렬** | 조인 테이블에는 순서 의미가 없다(ADR-0005 — "같은 종류 조건은 항상 OR"). 정렬하지 않으면 동일 상태의 해시가 흔들린다 |
| 값 배열(`examples`·`synonyms`·`altQuestions`·`cancelKeywords`) | **원래 순서 유지** | `slotIndex`(임베딩 키)와 연결 — 순서 변경도 변경이다(AC-H1-6) |
| 구조 배열(`outputs`·`slots`·`meanings`) | **원래 순서 유지** | 출력 순서·슬롯 순서·`defaultMeaningIndex`가 순서에 의미를 둔다 |
| 숫자 | `JSON.stringify` 기본 표현 | 같은 double → 같은 문자열 |

- 저장되는 `payload`도 **같은 정렬 규칙**으로 직렬화한다(타임스탬프만 포함). 따라서 저장 본문에서 해시를 **재계산해 검증**할 수 있다(§5.4 ③, EX-H-3).
- ⚠ `answerSetting` 행이 없는 상태(`null`)와 기본값으로 채운 행이 있는 상태는 **응답은 같아도 해시가 다르다**. 의도적이다 — 복원이 "행 없음"을 정확히 재현하려면 둘을 구분해야 한다.
- **해시 규칙은 `schemaVersion`과 함께 동결**된다. 규칙을 바꾸면 `schemaVersion`을 올린다(그 전 버전들은 해시 비교에서 "다름"으로 보여 1회 여분 스냅샷이 생길 뿐 — 보수적 실패).

### 5.3 `counts`

`intents` · `intentExamples`(예문 총합) · `keywords` · `homonyms` · `contexts` · `dialogNodes` · `nodeIntentLinks` · `nodeKeywordLinks` · `faqs` · `answerSetting`(0|1). 캡처 시 본문에서 계산해 메타에 저장한다(AC-H1-1).

### 5.4 `schemaVersion` · 업캐스터 · 픽스처 규약 (FR-H1-12/13, NFR-HM4)

| # | 규약 |
|---|---|
| ① | 현재 값은 **`shared-types`의 `SNAPSHOT_SCHEMA_VERSION` 1곳**. 캡처는 항상 현재 값으로 쓴다 |
| ② | `lib/snapshot-upcasters.ts`: `UPCASTERS: Record<number, (p: unknown) => unknown>` — 키 `n`은 "`n` → `n+1`" 변환. **순수 함수**, 입력을 변형하지 않고 새 객체를 반환. 1차는 **빈 맵**(v1이 현재) |
| ③ | 로드 순서(`VersionPayloadReader`): JSON 파싱 → **`schemaVersion === 현재`면 저장된 `contentHash`와 재계산 해시 비교**(불일치 = 손상/변조 → `VERSION_INTEGRITY_FAILED`) → `MIN ≤ v < 현재`면 체인 적용 → `v < MIN` 또는 `v > 현재`(**앱 버전 롤백 후 신형 스냅샷**) 또는 체인 누락 → `VERSION_SCHEMA_UNSUPPORTED` |
| ④ | 업캐스트된 스냅샷의 비교 해시는 **변환 결과로 재계산**한 값을 쓴다(저장된 `contentHash`는 캡처 당시 형식 기준). AC-H3-2("복원 후 해시 == 대상 해시")는 같은 `schemaVersion`에서 성립하며, 업캐스트 복원은 "복원 후 해시 == 업캐스트 결과 해시"로 검증한다(§8.5) |
| ⑤ | ★ **`lib/__fixtures__/snapshot-v1.json`은 영구 픽스처다 — 수정 금지.** 자동시험이 "픽스처 → 업캐스트 → 무결성 검사 → 빈 챗봇에 복원 → 재캡처 해시 == 업캐스트 결과 해시"를 매 CI에서 단언한다(AC-H3-20). `schemaVersion`을 올릴 때마다 `snapshot-v{n}.json`을 **추가**한다(기존 픽스처 유지) |
| ⑥ | **`schemaVersion` 증가가 필요한 변경**(FR-H1-13): `DialogueBundle` 6종 스키마의 필드 추가·삭제·의미 변경 · 스냅샷 범위 모델 추가/제거(FR-H1-1) · `answerSetting`/`profile` 필드 변경 · §5.2 해시 규칙 변경. **zod 상한만 바뀌는 경우는 증가 불필요**(복원 무결성 검사가 위반을 보고한다 — AC-H3-19). code-reviewer 점검 항목으로 고정한다 |
| ⑦ | 업캐스터가 채울 수 없는 신규 필수 필드는 **DB 기본값과 같은 값**으로 채운다(예: 과거 스냅샷에 없던 필드 = 그 필드 도입 전의 동작과 동일한 값). 이 원칙을 어기는 변경은 업캐스터를 두지 말고 해당 구버전을 복원 불가로 둔다(내용 조회는 가능 — S-10) |

### 5.5 hydrate 와 복원 무결성 검사 (FR-H1-8, FR-H3-8)

`hydrateSnapshot(envelope, chatbotId) → { bundle: DialogueBundle, answerSetting, profile }` — 항목별 `chatbotId := 현재 챗봇`, `updatedAt := capturedAt`("스냅샷 시점")을 채워 **기존 DTO 스키마로 `safeParse`** 한다. **쓰기에는 hydrate 결과가 아니라 원본(slim) 값을 쓴다** — zod의 `.trim()`·`.default()` 변환이 쓰기에 섞이면 복원 후 해시가 대상과 달라진다(§8.5 사후 검증 실패 원인 1순위).

`checkSnapshotIntegrity(hydrated) → { violations[], warnings[] }`:

| 검사 | 캡처 시(FR-H1-8) | 복원 시(FR-H3-8) |
|---|---|---|
| ① zod(기존 스키마) · 도메인 상한 | 하지 않음 | 위반 → **거부** |
| ② 참조 그래프 — **FK 대상**: 노드 `intentIds`/`keywordIds`(조인) · `contextVariableId` | 위반 → `integrityWarnings` 기록(저장은 진행) | 위반 → **거부**(DB가 어차피 거부한다 — EX-H-5) |
| ② 참조 그래프 — **앱 레벨**: 아웃풋 `DIALOG_MOVE.targetNodeId`·버튼 `NODE`(→ `getOutgoingNodeRefs()` 재사용) · `CONTEXT_FORM.contextVariableId` · `meanings[].intentId` · `slots[].keywordId` | 위반 → 경고 | 위반 → **경고만**(캡처 당시 상태의 재현이 복원의 정의 — EX-H-5) |
| ③ 정규화 이름 유일성: 의도·키워드·노드·컨텍스트 `normalizeText(name)`, 동음이의어 `word`, FAQ `question` | — | 스냅샷 내부 중복 → **거부**(ADR-0006) |
| ④ 노드 유형 유일성: `START`·`FALLBACK` 각 ≤1 | — | 위반 → **거부**(FR-5-4 — 서비스가 보장하던 불변식을 복원이 깨지 않게) |
| ⑤ 교차 챗봇 ID: 스냅샷의 `id`가 **다른 챗봇의 행**으로 존재(6테이블 `findMany({ id in, chatbotId not })`) | — | 존재 → **거부**(FR-H3-11 — 정상 경로로는 불가능, 방어) |
| ⑥ 답변설정 교차 제약 5종(`answer-settings/lib/validate-thresholds.ts` 재사용) | — | 위반 → **거부** |

위반 목록은 최대 100건 + 총수로 응답한다(`VERSION_INTEGRITY_FAILED` · `details`). **원문을 담지 않는다** — `{ kind, id, field, rule }`만(FR-0-77).

### 5.6 크기 (FR-H1-15/16)

`sizeBytes = Buffer.byteLength(payload, 'utf8')`. 상한 판정은 **직렬화 직후, DB 쓰기 전**. 초과 시: 수동 → `422 VERSION_SNAPSHOT_TOO_LARGE`(행 없음, AC-H1-10) · 자동 → `autoSnapshot.status = 'FAILED'`(fail-open, EX-H-1) · `BEFORE_RESTORE` → **복원 중단** `422 VERSION_SNAPSHOT_TOO_LARGE`(AC-H3-9).

---

## 6. 캡처 (FR-H1-4~9)

### 6.1 일관 읽기 — `build()`의 `Promise.all` 6회 조회 문제 해결 (FR-H1-6)

**문제**: 현재 `DialogueBundleService.build()`(65~146행)는 6개 `findMany`를 `Promise.all`로 **각각 독립 쿼리**로 실행한다. 그 사이에 커밋된 쓰기가 끼면 "노드는 새 의도를 참조하는데 의도 목록은 옛것"인 스냅샷이 생긴다.

**해결**: 스냅샷 범위 전체를 **하나의 Prisma 인터랙티브 트랜잭션** 안에서 순차 조회한다.

```ts
// dialogue-bundle.service.ts — 기존 호출부 무변경(기본 인자)
async build(chatbotId: string, db: PrismaService | Prisma.TransactionClient = this.prisma): Promise<DialogueBundle>
//   db === this.prisma  → 기존과 동일(Promise.all)
//   db가 tx             → 6회 조회를 **순차 await**(tx 클라이언트는 단일 커넥션 — 병렬 발행 금지)

// version-capture.service.ts
readConsistent(chatbotId, tx) {           // 호출자가 연 트랜잭션 안에서만 호출
  bundle        = await bundleService.build(chatbotId, tx)
  answerSetting = await tx.chatbotAnswerSetting.findUnique({ where: { chatbotId } })
  chatbot       = await tx.chatbot.findUnique({ where: { id: chatbotId }, select: { name, avatarUrl, description, skin, status } })
}
```

| 근거 | 내용 |
|---|---|
| **SQLite는 모든 트랜잭션이 직렬화 격리다** | 한 트랜잭션 안의 읽기는 같은 DB 스냅샷을 본다(WAL: 첫 읽기 시점의 스냅샷 / 롤백 저널: 공유 잠금 유지). 따라서 **8회 조회가 한 시점의 일관된 상태**다 |
| 읽기 전용 트랜잭션의 비용 | 통상 2MB 이하 읽기 ≈ 수십~100ms. 롤백 저널 모드에서는 그동안 **다른 쓰기의 커밋이 대기**하지만(공유 잠금) 규모가 작다. WAL 모드면 대기 없음 |
| 타임아웃 | Prisma 인터랙티브 트랜잭션 기본 `timeout` 5초·`maxWait` 2초는 대형 챗봇에서 부족할 수 있다 → **`VERSION_TX_TIMEOUT_MS`(기본 30000)를 명시 전달**한다 |
| ⚠ Postgres 전환 시 | 기본 `READ COMMITTED`는 문장 단위 스냅샷이라 **일관 읽기가 깨진다** → 이 트랜잭션에 `isolationLevel: RepeatableRead`를 지정한다. 지정 지점은 `VersionCaptureService` 1곳(상수 1개) |

대안 비교: (a) `build()` 결과를 두 번 읽어 해시가 같을 때까지 반복 — 경합이 잦으면 끝나지 않는다, 기각 · (b) 스냅샷 동안 챗봇 쓰기 잠금 — 모든 자산 서비스에 잠금 검사가 퍼진다, 기각 · (c) **트랜잭션 인자(채택)** — 1파일 1시그니처, 기존 호출부·테스트 무변경.

### 6.2 캡처 절차 (`VersionCaptureService`)

```
captureManual(chatbotId, {label?, memo?})          → 수동(FR-H4-2)
captureAuto(chatbotId, trigger, triggerContext)    → 자동 5종 훅(§6.4). ★ 절대 throw하지 않는다(fail-open)
readConsistent(chatbotId, tx) / persistWithin(tx, captured, meta)   → 복원 서비스가 자기 트랜잭션에서 사용(§8.3)

① 읽기 트랜잭션: readConsistent()                                   (§6.1)
② 트랜잭션 밖: slim 봉투 조립 → 정규 직렬화 → contentHash · counts · sizeBytes → 무결성 경고(§5.5 ② 캡처 모드)
③ 크기 상한 검사                                                      (§5.6)
④ 쓰기 트랜잭션:
     latest = 최신 ChatbotVersion(versionNo desc 1행, contentHash만 select)
     latest.contentHash === contentHash → 생성하지 않음(수동: unchanged / 자동: UNCHANGED)   ★ FR-H1-5
     seq = ChatbotVersionSequence upsert(create lastVersionNo=1 / update increment 1) → versionNo
     ChatbotVersion.create(meta) · ChatbotVersionPayload.create(payload)
⑤ 커밋 후: 보존 정리(§6.6, 예외 흡수) · 수동이면 감사 CREATE(§12)
```

- **해시 비교를 ④ 트랜잭션 안에서 하는 이유**: 같은 챗봇에 두 요청이 동시에 캡처하면 둘 다 "직전과 다름"으로 판정해 중복 행이 생긴다. 쓰기 트랜잭션 안에서 최신 행을 읽으면 SQLite 직렬화로 두 번째가 첫 번째 결과를 보게 된다.
- `createdById/Email`: `AuditLogService.currentActorSnapshot()`(§12 — ALS 읽기 지점은 여전히 `AuditLogService` 1곳)로 얻는다. 자동 스냅샷도 **그 대량 작업을 요청한 관리자**가 기록된다(S-1 "자동 · 증강 승인 직전 · 편집자A"). 화면은 `trigger !== 'MANUAL'`이면 "자동" 배지를 병기한다.
- **로그**: `chatbotId`·트리거·`versionNo`·건수·`sizeBytes`·소요시간·해시 앞 8자리만(FR-0-77). 예문·답변·아웃풋 원문 금지.

### 6.3 무결성 경고 (FR-H1-8)

캡처는 **막지 않는다**. §5.5 ②를 캡처 모드로 실행해 `integrityWarnings`(최대 100건) + `integrityWarningCount`를 메타에 저장한다. 현재 DB의 앱 레벨 참조가 이미 깨져 있을 수 있으며(AC-H1-11) 스냅샷이 그것을 숨기면 안 된다.

### 6.4 자동 스냅샷 훅 — **8지점**(코드 확인 결과)

**배치 원칙**: 입력 검증·사전 검사를 **모두 통과한 직후, 첫 쓰기 직전**, 본 동작의 트랜잭션 **밖**(FR-H1-7). 검증 실패로 끝나는 요청(토큰 만료·참조 사용 중 409 등)은 스냅샷을 만들지 않는다.

| # | 파일 · 메서드 | 삽입 위치(현재 코드 기준) | `trigger` | `triggerContext` |
|---|---|---|---|---|
| 1 | `intents/intents.service.ts` · `importCommit()` (501행~) | `ABORT_ON_ERROR` 검사(509~515행) **뒤**, `this.prisma.$transaction`(522행) **앞** | `BEFORE_IMPORT` | `{ resourceType:'INTENT', itemCount: plan.items.length }` |
| 2 | `intents/intents.service.ts` · `bulkDelete()` (376행~) | 참조 사전 검사 루프·`INTENT_IN_USE` 판정(383~399행) **뒤**, `deleteMany`(401행) **앞** | `BEFORE_BULK_DELETE` | `{ resourceType:'INTENT', itemCount: rows.length }` |
| 3 | `keywords/keywords.service.ts` · `importCommit()` (360행~) | `IMPORT_ABORTED` 검사(371행) **뒤**, `$transaction`(379행) **앞** | `BEFORE_IMPORT` | `{ resourceType:'KEYWORD', … }` |
| 4 | `keywords/keywords.service.ts` · `bulkDelete()` (238행~) | 사전 검사 **뒤**, `deleteMany`(260행) **앞** | `BEFORE_BULK_DELETE` | `{ resourceType:'KEYWORD', … }` |
| 5 | `faqs/faqs.service.ts` · `importCommit()` (318행~) | `IMPORT_ABORTED` 검사(327행) **뒤**, `$transaction`(335행) **앞** | `BEFORE_IMPORT` | `{ resourceType:'FAQ', … }` |
| 6 | `faqs/faqs.service.ts` · `bulkDelete()` (221행~) | 존재 검사(224행) **뒤**, `deleteMany`(225행) **앞** | `BEFORE_BULK_DELETE` | `{ resourceType:'FAQ', … }` |
| 7 | `augmentation/augmentation-accept.service.ts` · `accept()` (39행~) | ②승인 시점 재검증 블록(74~99행) **뒤**, 편입 루프(105행) **앞**. **편입 대상(`candidateIds` − `noveltyExcluded`)이 1건 이상일 때만** | `BEFORE_AUGMENT_ACCEPT` | `{ targetId: intentId, itemCount: 편입 대상 수 }` |
| 8 | `learning/unanswered-questions.service.ts` · `bulkResolve()` (305행~) | `assertBulkSizeOrThrow`(307행) **뒤**, 반영 루프(313행) **앞** | `BEFORE_LEARNING_BULK_APPLY` | `{ itemCount: dto.items.length }` |

- **제외 확인**: `bulkIgnore()`(자산 무변경) · `resolve()`/`resolve-decomposed`(단건 — FR-H1-4) · 동음이의어·컨텍스트·노드(일괄 삭제·임포트 경로가 **존재하지 않음**) · TC 임포트(`validation` — 검증 자산이지 대화 자산이 아님).
- 증강 승인(#7)은 **증강분만 골라 빼는 유일한 수단**이다(J-3 — `Intent.examples`에 증강 표시가 없다). #7의 위치가 재검증 **뒤**인 이유: 재검증은 임베딩 호출(수 초)을 포함하므로 스냅샷을 편입 직전에 두어야 그 사이의 다른 편집이 스냅샷에 반영된다.
- 호출 형태는 **1줄**: `const autoSnapshot = await this.versionCapture.captureAuto(chatbotId, 'BEFORE_IMPORT', {...});` 후 응답 객체에 `autoSnapshot`을 싣는다.
- **NFR-HP2**: 캡처는 통상 규모 P95 1초. 임포트 커밋 예산(20초, NFR-P5)을 초과시키지 않는다.

### 6.5 fail-open 응답 계약 (P-4, EX-H-1)

`captureAuto()`는 **모든 예외를 흡수**하고 `AutoSnapshotOutcome`을 반환한다: `CREATED{versionNo,versionId}` · `UNCHANGED{versionNo}`(직전과 해시 동일 — 그 버전이 곧 롤백 지점) · `FAILED`(크기 초과·DB 오류 — 서버 `warn` 로그) · `DISABLED`(`VERSION_AUTO_SNAPSHOT_ENABLED=false`).

| 엔드포인트 | 응답 반영 |
|---|---|
| 의도/키워드/FAQ `import/commit` | `ImportCommitResult.autoSnapshot` |
| 증강 `accept` | `AugmentationAcceptResponse.autoSnapshot` |
| 학습현황 `bulk-resolve` | `BulkResult.autoSnapshot` |
| 의도/키워드/FAQ `bulk-delete` | ⚠ **현재 `204 No Content`라 본문이 없다** — 계약을 바꾸지 않는다(§20 D-7). 실패는 서버 경고 로그로만 관측되고 화면 경고는 없다(§19 L-3) |

화면은 `status === 'FAILED'`일 때 "직전 버전이 저장되지 않았습니다(작업은 완료됨)"를 경고로 표시한다. `CREATED`면 "v27로 자동 저장됨 · 버전 이력에서 되돌릴 수 있습니다" 안내가 가능하다(FR-H4-6과 연결).

### 6.6 보존 정리 (FR-H1-16/18/19, §4.3.3)

순수 함수 `selectVersionsToPrune(metas, policy, justCreatedId) → versionId[]`. **새 스냅샷 생성 직후** 같은 요청 안에서 호출한다(스케줄러 없음). 정리 실패는 흡수하고 경고 로그만 남긴다(다음 생성 때 다시 시도된다).

```
보호(절대 삭제 안 함): pinned · justCreatedId · "가장 최근 BEFORE_RESTORE 1건"
1) MANUAL(비고정) 을 versionNo desc로 정렬 → 앞 RETENTION_MANUAL(30)건 초과분 삭제
2) 자동(BEFORE_*, BEFORE_RESTORE 포함, 비고정) 을 versionNo desc → 앞 RETENTION_AUTO(30)건 초과분 삭제(보호 대상은 건너뜀)
3) 남은 전체(고정 포함) sizeBytes 합 > TOTAL_MAX_BYTES 이면:
     비보호 자동 → 오래된 순 삭제, 그래도 초과면 비보호 수동 → 오래된 순 삭제
     그래도 초과(고정·보호만 남음) → 삭제 중단 + 경고 로그(고정은 관리자 의사다)
```

- 삭제는 `ChatbotVersionPayload` → `ChatbotVersion` 순서, 한 트랜잭션.
- **정리는 감사하지 않는다**(FR-H3-18). `versionNo`는 재사용되지 않는다(시퀀스 테이블).
- 수동 한도·자동 한도가 **분리**되어 있으므로 자동 30건이 소진돼도 수동·고정 버전은 밀려나지 않는다(AC-H1-8).

---

## 7. 차이 계산 (FR-H2-6~12, J-7)

### 7.1 비교 쌍과 방향

| 호출 | base | target | 의미 |
|---|---|---|---|
| `GET …/versions/:versionId/diff?against=current` | 그 버전 | **현재** | "그 버전 이후 무엇이 바뀌었나" |
| `GET …/versions/:versionId/diff?against=<versionId2>` | 그 버전 | 버전2 | 두 시점 비교 |
| 복원 미리보기(`restore/preview`) | **현재** | 대상 버전 | "복원하면 무엇이 일어나나" — `ADDED` = 되살아나는 항목 |

응답은 `base`/`target`을 `VersionRef`로 **항상 명시**한다(UI가 방향을 추측하지 않는다). 교차 챗봇 `versionId`는 `404`(NFR-HS4, AC-H2-6).

### 7.2 알고리즘 — 순수 함수 `diffSnapshots(base, target)`

1. 양쪽을 hydrate된 **정규형**(§5.2 정렬 규칙 적용)으로 만든다. 현재 쪽은 `readConsistent()`를 **짧은 읽기 트랜잭션**으로 실행해 얻는다.
2. 종류별로 `Map<id, item>` 구성 → `ADDED`(target에만) · `REMOVED`(base에만) · `MODIFIED`(양쪽 + **비교 필드의 정규 JSON이 다름**) · 동일(목록 제외).
3. `ANSWER_SETTING`·`PROFILE`은 id = `chatbotId` 1항목(행 없음 = 항목 없음).
4. 요약 9행(8종 + `INTEGRITY_WARNING` base/target 건수) + `totalChanged` + `identical`(두 해시 동일).
5. **"같은 이름으로 재생성됨" 힌트**(FR-H2-10): 같은 종류의 `REMOVED`·`ADDED` 쌍 중 정규화 키(`normalizeText(name|word|question)`)가 같은 것에 `recreated.counterpartId`를 양방향으로 붙인다. **병합 표시는 하지 않는다**.
6. **저장하지 않는다**(AC-H2-7 — DB 쓰기 0건). "항목 비교 필드" 판정 함수 `itemEquals(kind, a, b)`는 **복원 계획(§8.4)과 공유**한다 — 차이 화면의 "변경"과 복원이 실제로 쓰는 "변경"이 한 규칙이다.
7. `simulation/lib/compare-diff.ts`·`audit-logs/lib/audit-diff.ts`를 **재사용하지 않는다**(FR-H2-11 — 자료구조가 다르다). 정규화는 `normalizeText()` 1벌.

### 7.3 필드 단위 규칙 (FR-H2-8)

| `type` | 대상 필드 | 표현 |
|---|---|---|
| `VALUE_SET` | `examples`·`synonyms`·`altQuestions`·`cancelKeywords` | `{ added[], removed[], reorderedOnly }` — 집합 동일·순서만 다르면 `reorderedOnly:true` 1줄(AC-H2-2: `[a,b,c]→[a,c,d]` = `+d −b`) |
| `REF_SET` | 노드 `intentIds`·`keywordIds` | `{ added:[{id,name|null}], removed:[…] }` — 이름은 **target → base 순으로** 해석, 양쪽에 없으면 `null`("(현재 없음)" 표기) |
| `STRUCT` | `outputs`·`slots`·`meanings`·`skin` | `{ before, after }` 전/후 원문(JSON). 화면이 정돈 표시 |
| `SCALAR` | 그 외(`name`·`answer`·`priority`·`enabled`·`contextVariableId`·임계값 …) | `{ before, after }` |

### 7.4 페이지네이션 · 성능 (NFR-HP5)

- `diff` 응답: 요약은 **항상** 포함, 항목 목록은 `kind` 지정 시에만(`change` 필터 콤마 구분, 기본 50행). 필드 상세는 `GET …/diff/items/:kind/:itemId?against=`.
- 요청마다 전체 차이를 재계산한다(무상태). 통상 규모 P95 2초. **미달 시** `(baseHash, targetHash)` 키의 프로세스 로컬 LRU(≤20건)를 도입할 수 있다 — 키가 두 해시라 **낡을 수 없다**(1차 미도입).

---

## 8. 복원 (FR-H3-1~20, J-4/J-5/J-6/J-8/J-9)

### 8.1 미리보기 — `POST …/versions/:versionId/restore/preview` (DB 변경 0 — AC-H3-1)

```
① 스코프(404) → ② 대상 버전 로드·파싱·업캐스트·hydrate(§5.4/§5.5) → ③ 무결성 검사(복원 모드)
④ 현재 캡처(읽기 트랜잭션) → currentContentHash
⑤ diffSnapshots(current, target) → diffSummary · changesUndone(= totalChanged) · laterVersionCount(versionNo > 대상)
⑥ blockers / warnings 산출(아래) → restorable = blockers.length === 0
```

**blockers**(`RestoreBlocker` — 있으면 확정 버튼 비활성, FR-H3-4)

| `code` | 조건 | 부가 정보 |
|---|---|---|
| `CHATBOT_ARCHIVED` | `status === 'ARCHIVED'` | — |
| `ACTIVE_JOB` | 이 챗봇의 `TrainingJob` 또는 `TestRun`이 `QUEUED`/`RUNNING` | `jobs[]: { source:'TRAINING_JOB'｜'TEST_RUN', kind, status, progress }` (S-6 "분류기 학습(60%)") |
| `SCHEMA_UNSUPPORTED` | §5.4 ③ | `schemaVersion` |
| `INTEGRITY_FAILED` | §5.5 거부 항목 또는 본문 손상(EX-H-3) | `violations[]`(≤100) · `total` |
| `RESTORE_IN_PROGRESS` | 복원 잠금 보유 중 | — |
| `NO_CHANGES` | `currentContentHash === 대상 해시`(EX-H-15 — 불필요한 백업 방지) | — |

**warnings**(`RestoreWarning` — 복원 가능, 확인 필요, FR-H3-5)

| `code` | 조건 · 산출(전부 **Prisma 읽기**) |
|---|---|
| `ACTIVE_CHATBOT` | `status === 'ACTIVE'` — "다음 대화부터 즉시 반영" |
| `TARGET_INTEGRITY_WARNINGS` | 대상의 앱 레벨 참조 경고 N건(§5.5 ②) |
| `BANNED_WORD_MATCHES` | 대상에서 **복원으로 되살아나거나 바뀌는** 응답 문구(FAQ `answer`·노드 아웃풋 텍스트 필드·`completionMessage`·슬롯 `prompt`) 중 **현재** 금지어 사전과 일치하는 항목 수(S-11, EX-H-13). `BannedWordFilterService`의 매칭 함수 재사용 |
| `PENDING_SUGGESTIONS_ORPHANED` | `PENDING` 제안 중 `intentId ∉ 대상 의도` N건(EX-H-11) |
| `ACCEPTED_SUGGESTIONS_NOT_RESUGGESTED` | `ACCEPTED` 제안 중 `(intentId, textNormalized)`가 **현재 예문에 있고 대상 예문에 없는** N건 — "복원으로 제거되는 승인 예문 N건은 다시 제안되지 않습니다"(P-8, EX-H-10) |
| `TEST_CASES_UNRESOLVED` | `enabled` TC 중 `expectedKind ∈ {INTENT,FAQ,NODE}`이고 `expectedTargetId ∉ 대상` N건(복원 후 `UNRESOLVED`가 될 것) |
| `CLASSIFIER_WILL_BE_DELETED` | `IntentClassifierModel` 행 존재 — "복원 후 재학습이 필요합니다"(J-8) |
| `PROFILE_WILL_CHANGE` | 표시 설정 차이 존재 — 바뀌는 필드명 목록(P-2 "미리보기에 명시") |
| `RAG_NOT_CONFIGURED` | 대상 `answerSetting.ragEnabled === true` && `RAG_BASE_URL` 미설정 — "복원은 되지만 2단계는 호출되지 않습니다"(EX-H-9) |
| `REINDEX_IN_PROGRESS` | `ReindexQueueService.isRunning()` — "진행 중인 색인이 끝난 뒤 복원 내용이 이어서 색인됩니다"(§8.7) |
| `SCHEMA_UPCASTED` | 대상이 구형식 → 현재 형식으로 변환되어 표시됨(S-10) |

**"대상 버전 이후 변경 N건이 함께 취소됩니다"**(FR-H3-3)는 `changesUndone`(미리보기 차이의 총 변경 항목 수)과 `laterVersionCount`로 서버가 수치를 주고, 문구는 화면이 조립한다.

### 8.2 확정 — `POST …/versions/:versionId/restore` 전체 순서 (FR-H3-7의 구체화)

```
[트랜잭션 밖 — 준비]
 0. 권한 가드: dialogue:write AND chatbot:write (§11)
 1. 스코프: 챗봇 없음 → 404 · ARCHIVED → 409 CHATBOT_ARCHIVED
    · ACTIVE && acknowledgeActive !== true → 400 VALIDATION_FAILED(details: acknowledgeActive)   (P-7 서버 재검증)
 2. 복원 잠금 tryAcquire(chatbotId) — 실패 → 409 RESTORE_IN_PROGRESS            (try/finally로 반드시 해제)
 3. 대상 버전 로드(없음/정리됨 → 404, EX-H-2) → 파싱 → 해시 검증 → 업캐스트 → hydrate → 무결성 검사
      실패 → 422 VERSION_SCHEMA_UNSUPPORTED / 422 VERSION_INTEGRITY_FAILED(+위반 목록)
 4. 대상 쓰기 모델 준비: 원본(slim) 값 + normalizeText() 키 + JSON 컬럼 문자열 + 대상 정규 해시(targetHash)

[단일 쓰기 트랜잭션 — timeout VERSION_TX_TIMEOUT_MS]                              ★ §8.3
 5~13 …

[커밋 직후 — 동기, await 없이 연속 실행]                                            ★ §8.6
 14. reindexWasRunning = reindexQueue.isRunning(chatbotId)
 15. bundleService.invalidate(chatbotId)          // 번들·인덱스 캐시 + 벡터 캐시 + 재색인 예약(단일 지점, 복제 금지)
 16. answerSettingsCache.invalidate(chatbotId)
[그 뒤 — await]
 17. auditLogService.record(RESTORE 요약 1건)     // 커밋 후 별도 쓰기(ADR-0016 §4)
 18. retention.prune(chatbotId, justCreated = backupVersionId)   // best-effort
 19. finally: 잠금 해제
 → 200 RestoreResponse
```

### 8.3 단일 쓰기 트랜잭션 내부 (5~13)

```
 5. chatbot.status 재확인(ARCHIVED → 409)                                        // 준비 단계 이후 보관 처리 경합
 6. 진행 중 작업 재확인: trainingJob.count / testRun.count (status IN QUEUED,RUNNING) > 0
      → 409 RESTORE_BLOCKED_BY_ACTIVE_JOB                                       // ★ DB 직렬화로 TOCTOU 없음(§9)
 7. current = readConsistent(chatbotId, tx) → currentHash
      currentHash !== expectedCurrentHash → 409 RESTORE_PREVIEW_STALE           // S-5, AC-H3-10
      currentHash === targetHash          → 409 RESTORE_NO_CHANGES              // EX-H-15
 8. BEFORE_RESTORE 백업: current 직렬화 → 크기 검사(초과 → 422 VERSION_SNAPSHOT_TOO_LARGE, 전체 롤백)
      → persistWithin(tx, …, { trigger:'BEFORE_RESTORE', restoredFromVersionId/No })
      ★ 해시 동일 생략 규칙의 **예외** — 직전 버전과 같아도 항상 새 행(FR-H1-5, AC-H3-5)
 9. plan = planRestore(current, target)                                          // 순수 함수(§8.4)
10. applier.apply(tx, chatbotId, plan)                                           // §8.4 S1~S9
11. tx.intentClassifierModel.deleteMany({ where: { chatbotId } })               // J-8, AC-H3-13
12. 사후 검증: after = readConsistent(chatbotId, tx) → hash(after) !== targetHash
      → throw(전체 롤백) 500 INTERNAL_ERROR + 경고 로그(해시 앞 8자리)          // §8.5
13. commit
```

**판단 — 백업을 복원과 같은 트랜잭션에 둔다(FR-H3-7 ③④의 결합, §20 D-3)**:

| 안 | 판정 |
|---|---|
| (a) 백업 트랜잭션 커밋 → 별도 교체 트랜잭션 | 기각. 두 트랜잭션 사이에 다른 편집이 끼면 **백업 ≠ 교체 직전 상태**가 된다(그 편집은 백업에도 없고 교체로 사라진다 — "복원의 복원"이 불완전, AC-H3-6 위반 가능). 막으려면 교체 트랜잭션에서 해시를 다시 확인해야 하는데 그러면 두 번 읽는다 |
| **(b) 한 트랜잭션: 해시 확인 → 백업 → 교체 → 사후 검증(채택)** | **"백업 없는 복원"이 구조적으로 불가능**하다(FR-0-72를 규약이 아니라 원자성으로 보장). 백업 내용 = 해시 확인한 바로 그 상태 = 교체 직전 상태. 교체 실패 시 백업도 롤백되는데, AC-H3-8은 "백업은 남아도 **된다**"(허용)이지 "남아야 한다"가 아니다 |

### 8.4 교체 계획과 적용 순서 — **차이 적용(diff-apply), ID 보존** (FR-H3-9/10, FR-0-71, P-9)

**판단 — (b) 차이 적용 채택, (a) 전체 삭제 후 재생성 기각**:

| 관점 | (a) 전체 삭제 후 재생성 | **(b) 차이 적용(채택)** |
|---|---|---|
| 변경 없는 행 `updatedAt` | 전부 갱신됨 — 목록 정렬(`updatedAt desc`)이 복원으로 뒤섞인다 | **보존**(FR-H3-10 ③) — "복원이 실제로 바꾼 것"이 `updatedAt`으로도 드러난다 |
| 쓰기량 | 전체 행 × 2 | 변경 행만 — SQLite 쓰기 잠금 시간이 짧다(§9 · NFR-HP7) |
| FK 순서 | 단순 | 계획 순서 필요(아래) |
| 이름 교환 | 자동 해결 | 임시 키 1단계 필요(아래 S3) |

`planRestore(current, target) → RestorePlan` (순수 함수 — 단위 테스트 1차 대상):

```
종류별: toDelete = current∖target (id) · toCreate = target∖current · toUpdate = 양쪽 && !itemEquals
조인:   pairsToDelete = currentPairs∖targetPairs · pairsToCreate = targetPairs∖currentPairs   ((nodeId,intentId)/(nodeId,keywordId) 집합 차이)
rekey:  toUpdate 중 정규화 키(name/word/question)가 바뀌는 행
nodeCtx: toUpdate 노드 중 contextVariableId가 바뀌는 행
```

**적용 순서** (`VersionRestoreApplier.apply` — 대화 자산을 쓰는 **유일한 파일**):

| 단계 | 동작 | 이 순서여야 하는 이유 |
|---|---|---|
| **S1** | 조인 삭제 `pairsToDelete` (`DialogNodeIntent`/`DialogNodeKeyword`) | 조인이 노드·의도·키워드를 `Restrict`로 붙잡고 있다. 대상에 없는 의도/키워드를 참조하는 조인은 **반드시** 여기 포함된다(대상 FK 폐포가 §5.5 ②로 보장) |
| **S2** | 노드 삭제 `toDelete.nodes` | 노드가 `contextVariableId`로 컨텍스트를 붙잡는다 → 컨텍스트 삭제(S4)보다 먼저 |
| **S3** | **임시 키 부여**: `rekey` 행의 `*Normalized` := `"\u001Frestore:" + id` · `nodeCtx` 노드의 `contextVariableId` := `null` | ① **이름 교환**(A↔B) 시 `@@unique([chatbotId, nameNormalized])` 중간 충돌 방지(AC-H3-17) ② 삭제될 컨텍스트를 참조하던 유지 노드의 FK 해제. 임시 키는 id별로 유일하고 트랜잭션 밖에 절대 노출되지 않는다(S5/S6에서 전부 덮어쓴다) |
| **S4** | 삭제 `toDelete`: 의도·키워드·동음이의어·컨텍스트·FAQ | S1~S3로 모든 FK 참조가 해제됨 |
| **S5** | 생성 `toCreate`(원래 `id`·`createdAt`, 재계산 정규화 키) → 갱신 `toUpdate`(전 필드 + 최종 정규화 키): 의도·키워드·동음이의어·컨텍스트·FAQ | 컨텍스트가 S6 노드보다 먼저 존재해야 한다. 생성·갱신 간 이름 충돌은 **대상 내부 중복일 때만** 가능하며 §5.5 ③이 사전에 거부한다 |
| **S6** | 노드 생성 → 노드 갱신(최종 `contextVariableId`·이름 포함) | 참조 컨텍스트가 S5에서 이미 존재 |
| **S7** | 조인 생성 `pairsToCreate` | 노드·의도·키워드가 모두 존재 |
| **S8** | 답변설정: 대상 `null` → `deleteMany` / 다르면 `upsert`(전 필드) / 같으면 skip | — |
| **S9** | 프로필: 4필드가 다를 때만 `chatbot.update({ name, avatarUrl, description, skin: serializeSkin(…) })` | 같으면 쓰지 않아 `Chatbot.updatedAt`을 건드리지 않는다. **`slug`·`status`·`groupId`는 절대 쓰지 않는다**(§4.1.2, AC-H3-16) |

- 쓰기 값은 **원본(slim) 값**(§5.5). JSON 컬럼은 `JSON.stringify(배열/객체)`, 선택 필드 `undefined` → DB `null`.
- 대량 `id IN (...)`/`createMany`는 **500건 단위로 분할**한다(SQLite 변수 상한 방어). `createMany`는 현재 Prisma 버전의 SQLite 지원 여부를 확인하고, 미지원이면 순차 `create`.
- `ConversationLog`·`UnansweredQuestion`·`AugmentationSuggestion`·`TestCase`·`TestRun`·`TrainingJob`·`Channel`·`BannedWord`·`EmbeddingVector`는 **쓰기 0건**(FR-H3-15, AC-H3-16) — 정적 검사 §16 V-3.
- **ID 보존의 효과**(J-5): TC `expectedTargetId` 유효(AC-H3-3/4) · `EmbeddingVector (ownerId, slotIndex, textHash)` 재사용 → **바뀐 문장만 재임베딩**(AC-H3-7) · `ConversationLog.matched*Id` 통계 연속 · 대화 봉투의 `contextVariableId`/`homonymId` 유지(ADR-0009, AC-H3-18).

### 8.5 사후 검증 (AC-H3-2의 런타임 보장)

트랜잭션 커밋 직전에 **같은 트랜잭션에서 재캡처**해 `hash == targetHash`를 확인한다. 불일치는 **구현 결함**(쓰기 값 변환·누락)이므로 전체 롤백 후 `500 INTERNAL_ERROR` + 경고 로그(해시 앞 8자리·종류별 건수만). 비용은 읽기 1회(통상 100ms 안팎)이며, "복원했다고 응답했는데 실제로는 다른 상태"를 원천 차단한다.

### 8.6 복원 후 처리 — 캐시·파생 데이터 대상 전수표 (FR-H3-12~15, J-8)

| 대상 | 처리 | 지점 |
|---|---|---|
| 대화 번들 + 엔진 인덱스 캐시(`DialogueBundleCache`, TTL 60초) | **무효화** | `DialogueBundleService.invalidate()` — **1회**, 복제 금지 |
| 챗봇 벡터 메모리 캐시(`VectorCacheService`) | **무효화** | 같은 `invalidate()` 안 |
| 1단계 임베딩 색인(`EmbeddingVector`) | **재색인 예약** — `textHash` 재사용으로 **바뀐 문장만** 임베딩, 사라진 항목은 고아 정리(`IndexerService` 기존 규칙) | 같은 `invalidate()` 안(`ReindexQueueService.schedule`) |
| 답변설정 캐시(`AnswerSettingsCacheService`, TTL 30초) | **무효화** | `answerSettingsCache.invalidate()` |
| 경량 분류기(`IntentClassifierModel`) | **삭제**(트랜잭션 안 — §8.3 ⑪) | `judgeClassifierStale()`의 `EXAMPLES_DRIFTED`는 **증가만** 감지(`current − atTrain > 50`, stale-judge.ts 43행) → 증강 롤백(예문 감소)이 stale로 안 잡혀 **증강분으로 학습된 모델이 추천에 계속 쓰인다**. 삭제하면 추천은 즉시 LEXICAL(bigram)로 복귀하고 상태 API는 `NOT_TRAINED`를 보고한다 |
| 질의 임베딩 LRU(`QueryEmbeddingService`, 1,000건/10분) | **건드리지 않는다** | `(질문, modelId)`의 함수 — 자산 무관. 무효화하면 운영 캐시 적중률만 붕괴(AC-H3-15). 주입 자체를 하지 않는다 |
| 챗봇 프로필(공개 `config`) | 해당 없음 | 공개 대화 경로는 챗봇 행을 매 요청 DB에서 읽고 `Cache-Control: no-store`다(캐시 없음 — 코드 확인) |
| 금지어 사전 캐시 | 해당 없음 | 전역·스냅샷 범위 밖 |
| 진행 중 대화 봉투 | 해당 없음 | ADR-0009 매 턴 재검증 — 없는 노드/컨텍스트는 자동 폐기(S-7) |
| `AugmentationSuggestion`·TC·실행·로그 | **쓰기 0건** | FR-H3-15 |

재색인 완료 전까지 새로 생기거나 바뀐 문장은 **규칙 매칭으로만** 응답된다(기존 저하 규약, FR-H3-14). 화면은 기존 `GET …/embeddings/status`를 재사용한다(S-9).

### 8.7 `ReindexQueueService` 재실행 예약 플래그 (기존 잠재 결함 보완)

**코드 확인 결과**: `schedule()`은 이미 실행 중이면 **조용히 무시**한다(reindex-queue.service.ts 31행). 실행 중인 색인은 시작 시점에 의도/FAQ를 읽었으므로, 그 뒤의 쓰기는 **다음 쓰기가 있을 때까지 색인되지 않는다**. 복원은 수백 행을 한 번에 바꾸므로 이 틈이 치명적이다(되살아난 예문이 의미 매칭에서 빠지고, 사라진 의도의 고아 벡터가 남는다).

**변경**: `private readonly rerunRequested = new Set<string>()`. 실행 중 `schedule()` 호출은 `rerunRequested.add(chatbotId)`로 기록하고, `finally`에서 `rerunRequested`에 있으면 제거 후 **1회 재실행**한다. 수동 재색인의 `409 REINDEX_IN_PROGRESS`(`isRunning()` 기반)와 "챗봇당 동시 실행 1건"(AC-N1-17)은 **불변**이다. 재실행은 `textHash` 재사용 덕분에 바뀐 문장만 임베딩하므로 비용이 작다. 이 수정은 복원뿐 아니라 **모든 자산 편집의 같은 틈**을 함께 메운다.

---

## 9. 동시성 (J-9, §4.7)

### 9.1 보장 수단 — "DB 직렬화 트랜잭션 안에서 재확인"이 최종 방어선

기존 TOCTOU 방어 패턴(`test_runs` 부분 유니크 인덱스)은 **"진행 중" 상태가 DB 행으로 존재**하기 때문에 가능했다. 복원은 **동기·단일 요청**이라 "복원 중" 행이 없다(복원 Job 테이블 미도입 — §4.2). 대신 **판정 자체를 쓰기 트랜잭션 안으로** 옮긴다. SQLite는 모든 트랜잭션이 직렬화 격리이므로, 트랜잭션 안의 "읽기 → 판정 → 쓰기" 사이에 다른 커밋이 끼면 **이 트랜잭션의 첫 쓰기가 `SQLITE_BUSY`(WAL: `BUSY_SNAPSHOT`)로 실패**한다 — 끼어든 쓰기를 모른 채 커밋하는 경로가 존재하지 않는다.

| 충돌 | 처리 | 보장 층 |
|---|---|---|
| 미리보기 이후 다른 편집(S-5) | 트랜잭션 안 재캡처 해시 ≠ `expectedCurrentHash` → **409 `RESTORE_PREVIEW_STALE`** | DB(직렬화) |
| 해시 확인 직후 ~ 교체 사이의 편집 | 같은 트랜잭션 → 끼어든 커밋이 있으면 우리 쓰기가 BUSY로 실패 → **409 `RESTORE_PREVIEW_STALE`로 매핑** | DB |
| 진행 중 `TrainingJob`/`TestRun`(S-6) | 트랜잭션 안 `count(QUEUED|RUNNING)` > 0 → **409 `RESTORE_BLOCKED_BY_ACTIVE_JOB`** | DB |
| 복원 중 새 작업 시작(TC 실행·증강·학습) | 작업 생성(행 INSERT)은 복원 트랜잭션의 쓰기 잠금 뒤로 **직렬화**된다 → 복원 커밋 **이후**에 생성되어 **복원된 자산으로** 실행된다(정합). 복원 커밋 **전**에 생성됐다면 ⑥이 잡는다 | DB |
| 동시 복원(같은 챗봇) | 1차: in-process 잠금 → **409 `RESTORE_IN_PROGRESS`**(빠른 실패) / 최종: 두 번째 트랜잭션의 해시 확인이 실패(첫 복원이 자산을 바꿨다) | 프로세스 + DB |
| 동시 스냅샷 생성 | 해시 동일 판정·번호 발급이 같은 쓰기 트랜잭션 → 중복 행 없음 · `@@unique([chatbotId, versionNo])` 최종 방어 | DB |
| 고정 10건 상한 경합 | `PATCH pinned:true`의 "고정 수 count → 갱신"을 한 쓰기 트랜잭션에서 수행 | DB |
| 진행 중 대화 | 차단하지 않는다 — 다음 턴부터 복원된 번들, 봉투는 매 턴 재검증(ADR-0009) | 기존 |

**판단 — 요구사항 §4.7의 "복원 잠금 중 작업 시작 요청 409" 권고는 채택하지 않는다(§20 D-4)**: 채택하려면 `validation`·`augmentation`·`classifier` 3개 모듈의 시작 경로가 버전 모듈의 잠금을 참조해야 해 의존 방향이 역전되고 3모듈을 수정해야 한다. 위 표대로 **작업이 복원 전/후 어느 한쪽에만 속함**이 DB 직렬화로 이미 보장되며, J-9가 우려한 "복원과 뒤섞인 결과"는 **복원 시점을 가로지르는 작업**에서만 생기는데 그것은 ⑥이 막는다. 남는 틈은 "커밋 직후 ~ `invalidate()` 호출 전"의 마이크로태스크 간격뿐이며, 이는 **기존 모든 자산 편집이 갖는 것과 같은 성질**이다(쓰기 `await` 후 `invalidate()`).

**BUSY 오류 매핑**: 복원 트랜잭션에서 Prisma `P2034`(트랜잭션 충돌) 또는 SQLite `database is locked`/`SQLITE_BUSY` 계열이 나오면 **409 `RESTORE_PREVIEW_STALE`**("동시에 변경이 있었습니다. 미리보기를 다시 확인해 주세요")로 변환한다. 자동 재시도하지 않는다 — 재시도는 사용자가 **새 차이를 본 뒤** 결정해야 한다.

### 9.2 in-process 복원 잠금 (`RestoreLockRegistry`)

`Set<chatbotId>` · `tryAcquire()`/`release()` 전부 **동기**(await 없음 — `ReindexQueueService.isRunning/schedule`과 같은 규약). 서버 재시작 시 자연 해제(EX-H-6 — 미커밋 트랜잭션은 SQLite가 롤백). **단일 인스턴스 상태**이며 다중 인스턴스 전환 시 교체 지점 1곳이다. 잠금이 없어져도 정합성은 §9.1의 DB 층이 보장한다(잠금은 UX용 빠른 실패 + 불필요한 캡처 비용 절감).

### 9.3 쓰기 잠금 시간과 다른 요청 (NFR-HP7)

SQLite는 **DB 전체 단일 작성자**다. 복원 트랜잭션(5~13)이 쓰기 잠금을 쥐는 동안 **모든 챗봇의 쓰기**(관리자 편집·대화 로그 적재)가 대기한다. 완화: ① 준비 작업(파싱·업캐스트·무결성·쓰기 모델·대상 해시)을 **트랜잭션 밖**에서 끝낸다 ② 차이 적용으로 쓰기량을 변경 행으로 한정한다 ③ 기존 선례(임포트 커밋 5,000행 트랜잭션 20초 예산)와 같은 범주다. ⚠ 대화 로그 적재는 fire-and-forget이라 응답 지연은 없지만 **busy 대기 한도를 넘으면 그 로그가 유실**될 수 있다 — NFR-HP7 실측 항목으로 둔다(§17, §19 L-1).

### 9.4 Postgres 전환 메모 (개발명세서 §6-4 대비)

캡처 읽기 트랜잭션 `RepeatableRead`, 복원·스냅샷 생성 쓰기 트랜잭션 **`Serializable`** + `P2034` → 409 매핑(위와 동일 코드 경로). 격리 수준 지정 지점은 `VersionCaptureService`·`VersionRestoreService` 2곳의 상수다. 원시 SQL은 여전히 0건.

---

## 10. API 계약 (12개 핸들러 · `@Public()` 추가 0건)

### 10.1 엔드포인트

| 메서드 | 경로 (`/api/v1` 생략) | 권한 | 요청 / 응답 요지 |
|---|---|---|---|
| `GET` | `/chatbots/:chatbotId/versions` | `dialogue:read` | query `page`·`pageSize`(20/≤100)·`triggerGroup=MANUAL,AUTO,RESTORE_BACKUP`·`pinned?` → `{ items: ChatbotVersionListItem[], total, page, pageSize }`. **정렬 `versionNo desc` 고정**(`/audit-logs` 선례). **payload 테이블 미접근** |
| `POST` | `/chatbots/:chatbotId/versions` | `dialogue:write` | `{ label?, memo? }` → **201** `{ unchanged:false, version }` / **200** `{ unchanged:true, latestVersionNo, latestVersionId }`(AC-H1-2 — 기존 버전에 라벨 달기 제안용) |
| `GET` | `/chatbots/:chatbotId/versions/current` | `dialogue:read` | `VersionCurrentStatus` — 목록 최상단 "현재(저장되지 않은 변경 있음/없음)" 행(FR-H2-2). ⚠ **`/:versionId`보다 먼저 선언** |
| `GET` | `/chatbots/:chatbotId/versions/:versionId` | `dialogue:read` | `ChatbotVersionDetail`(메타 + counts + `integrityWarnings[]` + `schemaSupported` + `payloadStatus: OK｜CORRUPT｜SCHEMA_UNSUPPORTED`) |
| `GET` | `/chatbots/:chatbotId/versions/:versionId/content` | `dialogue:read` | query `kind`(8종)·`q`·`page`·`pageSize`(50) → `VersionContentPage`(기존 `IntentSchema` 등 재사용, `updatedAt`=스냅샷 시점). 스키마 미지원이면 `schemaSupported:false` + 원형 JSON 항목(내용 조회는 허용 — FR-H1-12, S-10) |
| `PATCH` | `/chatbots/:chatbotId/versions/:versionId` | `dialogue:write` | `{ label?, memo?, pinned? }` → `ChatbotVersionDetail`. 11번째 고정 → 409 `VERSION_PINNED_LIMIT_EXCEEDED`(AC-H1-9) |
| `DELETE` | `/chatbots/:chatbotId/versions/:versionId` | `dialogue:write` | 204. 고정 버전 → **409 `VERSION_PINNED`**(고정 해제 후 삭제 — FR-H1-20) |
| `GET` | `/chatbots/:chatbotId/versions/:versionId/diff` | `dialogue:read` | query `against=current｜<uuid>`(필수)·`kind?`·`change?`·`page`·`pageSize` → `{ base, target, summary, items? }`(§7) |
| `GET` | `/chatbots/:chatbotId/versions/:versionId/diff/items/:kind/:itemId` | `dialogue:read` | query `against` → `VersionDiffItemDetail`(필드 단위, §7.3) |
| `GET` | `/chatbots/:chatbotId/versions/:versionId/audit-count` | **`audit:read`** | `{ versionId, from, to, count, link: { chatbotId, from, to, clamped } }` — 구간 = [이 버전 `createdAt`, 다음 버전 `createdAt` 또는 현재). `link`는 `AUDIT_QUERY_MAX_RANGE_DAYS`(90일)를 넘으면 `to` 기준 90일로 **서버가 잘라** `clamped:true`(프런트가 상한을 하드코딩하지 않는다) |
| `POST` | `/chatbots/:chatbotId/versions/:versionId/restore/preview` | `dialogue:write` **+** `chatbot:write` | 본문 없음 → `RestorePreviewResponse`(§8.1). DB 변경 0 |
| `POST` | `/chatbots/:chatbotId/versions/:versionId/restore` | `dialogue:write` **+** `chatbot:write` | `{ expectedCurrentHash, acknowledgeActive? }` → **200** `RestoreResponse` |

**판단 — 감사 건수는 별도 엔드포인트**(요구사항 §5.4의 architect 판단 항목): 목록에 합치면 행마다 `audit_logs` 범위 `count`가 붙어(20행 × 인덱스 범위 스캔, 감사 100만 행 규모) NFR-HP4(300ms)를 위협하고, 권한에 따라 **응답 형태가 달라지는** 분기가 목록 서비스에 들어간다. 별도 경로면 `audit:read`가 **가드에서** 판정되어 VIEWER/EDITOR 응답에 필드가 원천적으로 없고(AC-H2-4), 화면은 `GET /auth/me`의 `permissions`에 `audit:read`가 있을 때만 행 펼침 시 호출한다(FR-H2-3 — 미보유자에게 링크·건수를 렌더하지 않는다).

### 10.2 주요 응답 스키마 요지

```ts
ChatbotVersionListItem = {
  id, versionNo, trigger, triggerLabel, triggerContext|null, schemaVersion, schemaSupported,
  contentHash, counts, sizeBytes, integrityWarningCount, label|null, memo|null, pinned,
  restoredFromVersionNo|null,              // BEFORE_RESTORE면 "vN으로 복원하기 전 상태"(FR-H2-4)
  createdByEmail|null, createdAt, updatedAt
}

RestorePreviewResponse = {
  targetVersion: { id, versionNo, trigger, createdAt, schemaVersion },
  currentContentHash,                      // → 확정 요청의 expectedCurrentHash
  targetContentHash,                       // 업캐스트 후 재계산 값
  diffSummary: VersionDiffSummary,         // base=CURRENT, target=VERSION
  changesUndone, laterVersionCount,
  blockers: RestoreBlocker[], warnings: RestoreWarning[], restorable
}

RestoreResponse = {
  restoredFromVersionNo, backupVersionNo, backupVersionId, contentHash,
  summary: Record<VersionAssetKind, { added, removed, modified }>,
  reindexScheduled: true,                  // 재실행 플래그(§8.7)로 항상 예약된다
  reindexWasRunning: boolean,              // true면 "진행 중이던 색인이 끝난 뒤 이어서 색인" 안내
  classifierDeleted: boolean, upcastedFromSchemaVersion?: number
}
```

화면 동선(FR-H4-5): `backupVersionNo` 표시 · 재색인 진행(기존 `embeddings/status`) · **"TC 세트로 검증하기"** 링크(No.19 실행 화면 — ID가 보존돼 TC가 전부 유효하다, AC-H3-4).

### 10.3 신규 `ApiErrorCode` 9종 (FR-0-75 확정)

| 코드 | HTTP | 발생 |
|---|---|---|
| `VERSION_SNAPSHOT_TOO_LARGE` | 422 | 수동 저장 · 복원 직전 백업이 20MB 초과(자동 트리거는 오류가 아니라 `autoSnapshot.FAILED`) |
| `VERSION_SCHEMA_UNSUPPORTED` | 422 | 업캐스트 경로 없음(구형 · **신형 = 앱 롤백 후**) — 복원·차이 불가, 메타·원형 내용 조회 가능 |
| `VERSION_INTEGRITY_FAILED` | 422 | §5.5 거부 항목 · 본문 파싱 실패 · 저장 해시 불일치(EX-H-3) + `details[]` |
| `VERSION_PINNED_LIMIT_EXCEEDED` | 409 | 11번째 고정 |
| **`VERSION_PINNED`** | 409 | 고정 버전 삭제 시도(FR-H1-20) — **요구사항 7종에 추가** |
| `RESTORE_PREVIEW_STALE` | 409 | 해시 불일치 · 동시 변경 BUSY(§9.1) |
| `RESTORE_BLOCKED_BY_ACTIVE_JOB` | 409 | 진행 중 `TrainingJob`/`TestRun` |
| `RESTORE_IN_PROGRESS` | 409 | 같은 챗봇 복원 진행 중 |
| **`RESTORE_NO_CHANGES`** | 409 | 대상 = 현재(EX-H-15) — **요구사항 7종에 추가**. 기존 `NO_CHANGES_TO_COMPARE`(400, 시뮬레이터 비교 전용 의미)는 재사용하지 않는다 |

**`ARCHIVED` 챗봇 복원 거부는 기존 `409 CHATBOT_ARCHIVED`를 재사용**한다(FR-0-75 판단 항목). `INVALID_STATUS_TRANSITION`(400)은 "상태 전이 요청"의 코드이고 복원은 상태를 바꾸지 않으며, `CHATBOT_ARCHIVED`가 이미 "보관된 챗봇의 쓰기 = 409"의 **전 모듈 공통 코드**다. 버전 생성·라벨·고정·삭제도 `ARCHIVED`에서 `409 CHATBOT_ARCHIVED`, **조회(목록·상세·내용·차이·감사 건수)는 허용**한다(보관된 챗봇의 과거를 볼 수 있어야 한다 — 통계와 같은 판단).

---

## 11. 권한 · 가드 (P-5, J-11, FR-H4-8)

**신규 권한 문자열 0종**(`Permission` 유니온 15종 불변). 조회 `dialogue:read` · 저장/라벨/고정/삭제 `dialogue:write` · **복원 미리보기·확정 `dialogue:write` AND `chatbot:write`** · 감사 건수 `audit:read`.

**코드 확인 결과 현재 가드는 단일 권한만 지원한다**(`RequirePermission(permission: Permission)`, `PermissionGuard`가 `getAllAndOverride<Permission>` 1개 판정). 요구사항 §5.4의 경고대로 미지원이면 P-5 대안(`chatbot:restore` 신설)이 자연스러워지지만, **PM이 신규 권한 없음으로 확정**했으므로 데코레이터를 확장한다.

```ts
// require-permission.decorator.ts — 기존 호출(인자 1개)은 한 글자도 바뀌지 않는다
export const RequirePermission = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(PERMISSION_METADATA_KEY, permissions);          // 항상 배열로 저장

// permission.guard.ts
const required = reflector.getAllAndOverride<Permission[] | Permission>(...);
const list = required === undefined ? [] : Array.isArray(required) ? required : [required];
const missing = list.filter((p) => !hasPermission(role, p));   // ★ AND 의미
if (missing.length > 0) → PERMISSION_DENIED 기록(summary: "요구 권한 a+b") + 403 FORBIDDEN(본문에 권한 문자열 미포함)
```

- **AND만** 지원한다(OR는 수요가 없고, 섞으면 판정 규칙이 코드에서 읽히지 않는다).
- 튜플 타입 `[Permission, ...Permission[]]`으로 **빈 호출은 컴파일 오류**. 오타는 여전히 빌드 실패.
- 프런트: 복원 버튼은 `can('dialogue:write') && can('chatbot:write')`일 때만 렌더(VIEWER는 저장·라벨·고정·삭제·복원 버튼이 **렌더되지 않는다** — FR-H4-8).
- 단위 시험: `dialogue:write`만 가진 가상 역할 → 복원 403(AC-H4-4). 가드 기존 테스트 무수정 통과.

---

## 12. 감사 (J-10, FR-H3-16~18)

| 동작 | `action` | `targetType` | 기록 | 비고 |
|---|---|---|---|---|
| 복원 | **`RESTORE`**(신설, 파괴적 동작 목록 포함) | `Chatbot` | ✅ **요약 1건** | `targetId=chatbotId`, `targetName=챗봇 이름`, `summary`: `"v27로 복원 (백업 v28) — 의도 +0/−0/~1, FAQ +0/−3/~0"`, `after`: `{ fromVersionNo, backupVersionNo, counts: {INTENT:{added,removed,modified}, …} }`(**number만**) |
| 수동 저장 | `CREATE` | **`ChatbotVersion`**(신설) | ✅ | `targetName="v12 · 라벨"` |
| 라벨·메모 수정 / 고정·해제 | `UPDATE` | `ChatbotVersion` | ✅ | 고정 토글은 `summary: "고정"｜"고정 해제"` |
| 수동 삭제 | `DELETE` | `ChatbotVersion` | ✅ | — |
| 자동 스냅샷 생성 | — | — | ❌ | 이미 감사되는 본 동작(`IMPORT`·`BULK_DELETE`·`Intent UPDATE`)의 부수 효과(FR-H3-18) |
| 보존 정리 · 복원 직전 백업 | — | — | ❌ | 시스템 동작 · 백업 번호는 `RESTORE` 요약에 포함 |

- **`RESTORE`는 요약 액션**이다 — `AuditLogService.record()`의 요약 분기(`isBulkSummary`)에 `RESTORE`를 추가해 화이트리스트를 건너뛴다(ADR-0016 §7과 같은 규약: 값 종류가 number·UUID·boolean으로 제한). 개별 변경 수백 건을 풀어 쓰지 않는다(AC-H4-1).
- `AUDIT_FIELDS.ChatbotVersion = ['versionNo', 'trigger', 'label', 'memo', 'pinned', 'sizeBytes']`(`Record<AuditTargetType, …>` 타입이 누락을 컴파일 오류로 강제).
- 기록 시점은 **커밋 직후**(트랜잭션 안에서 호출하지 않는다 — ADR-0016 §4).
- **actor 스냅샷**: `AuditLogService`에 `currentActorSnapshot(): { id, email, role } | null`를 추가한다. 스냅샷의 `createdBy*`는 이 메서드로만 얻는다 — **`RequestContextService.get()` 호출 지점은 여전히 `AuditLogService` 1곳**(개발명세서 §2.1 규약 불변).
- 감사로그를 복원 원천으로 쓰지 않고 복제하지 않는다(FR-0-73). "두 버전 사이의 감사 레코드"는 §10.1 `audit-count`로 **건수 + 링크**만 제공한다.
- ADR-0016 §6의 재검토 트리거("No.25가 이 리소스의 변경 이력 화면을 만들 때 `(targetType, targetId, createdAt)` 인덱스")는 **발동하지 않는다** — 이 그룹은 감사를 `(chatbotId, createdAt)` 범위로만 조회하고, 항목별 이력 화면은 1차 범위 밖이며 만들어도 **스냅샷 차이**로 구현한다(FR-H4-10).

---

## 13. 보존 · 영구삭제

- 보존 정책: §6.6.
- **챗봇 영구삭제**(FR-H1-21, AC-H4-7): `permanentDelete()` 트랜잭션의 `tx.chatbot.delete` **직전**에 `tx.chatbotVersionPayload.deleteMany({ where: { version: { chatbotId: id } } })` → `tx.chatbotVersion.deleteMany({ where: { chatbotId: id } })` → `tx.chatbotVersionSequence.deleteMany({ where: { chatbotId: id } })`. 사전 검사(409) 목록에는 **넣지 않는다**(ADR-0002 "하위 데이터 제거" 분류). 영구삭제는 여전히 **불가역**이다 — 스냅샷도 함께 사라진다(ADR-0002 갱신 각주).
- `ARCHIVED`(보관) 상태에서는 스냅샷을 **보존**하며, 보관 해제 후 복원할 수 있다.

---

## 14. 비기능 설계

### 14.1 성능

| ID | 설계 |
|---|---|
| NFR-HP1 | 공개 대화 경로 신규 조회·계산 **0건**. 복원 직후 첫 턴 1회 번들 재구축(기존 편집과 동일) |
| NFR-HP2 | 캡처: 읽기 트랜잭션 8쿼리 + 직렬화 + sha256 + INSERT 1~2MB — 통상 P95 1초 |
| NFR-HP3 | 복원: 준비(트랜잭션 밖) + 트랜잭션(재캡처 · 백업 INSERT · 변경 행 쓰기 · 재캡처) — 통상 P95 5초, 1만 행 15초. 미달 시 비동기화 재검토(§19 트리거) |
| NFR-HP4 | 목록: `chatbot_versions`만 조회(본문 테이블 분리) · `(chatbotId, versionNo) UNIQUE` 인덱스 — P95 300ms |
| NFR-HP5 | 차이 요약 P95 2초 · 항목 목록·내용 조회 페이지네이션 필수(기본 50) |
| NFR-HP6 | 재임베딩 = 내용이 바뀐 색인 대상 문장 수(ID 보존 + `textHash`) |
| NFR-HP7 | 복원 트랜잭션 동안 SQLite 전역 쓰기 대기 — §9.3. 실측 항목 |

### 14.2 보안 · 거버넌스

스냅샷에 사용자 발화·PII 유입 경로 없음(관리자 작성 자산만 — 학습현황 반영 예문은 이미 마스킹된 값, NFR-HS1) · 자격증명 필드 부재(NFR-HS2) · 대화 자산 쓰기 경로 = applier 1파일(NFR-HS3, §16) · 교차 챗봇 버전 접근 404(NFR-HS4) · **내보내기/가져오기 경로 없음**(NFR-HS5 — 검증되지 않은 자산 주입 경로 차단. 이것이 복원 쓰기 경로가 ADR-0025의 "승인 없는 자산 변경"이 아닌 근거이기도 하다: 스냅샷 본문을 만드는 경로는 **실제 DB 자산의 캡처뿐**이다) · 서버 로그 원문 금지(NFR-HS6) · API 응답(차이·내용)에는 원문 포함(FR-0-77 — 관리자 작성 자산).

### 14.3 접근성 (NFR-HA1~4)

추가/삭제/변경 = `+`/`−`/`~` **기호 + 텍스트 라벨**(색상 단독 금지) · 복원 확인 대화상자 포커스 트랩·`Esc`·**기본 포커스 = 취소**·확정 버튼 라벨 **"v27로 복원"**(FR-H4-4) · 결과 `aria-live="polite"` · 목록·차이 표 키보드 행 이동·펼침, 필터 상태 스크린리더 노출 · axe 대비 위반 0건. 세부 레이아웃은 ui-designer(§18).

### 14.4 유지보수성

정규 직렬화·해시·hydrate·업캐스터·무결성·차이·복원 계획·보존 선정 = **순수 함수**(NFR-HM1) · 캡처·그래프 검증을 ID 정책과 분리(NFR-HM2 — 향후 깊은 복사는 "캡처 + ID 재매핑 + 적재"로 같은 함수를 재사용, J-12) · 엔진 변경 0(NFR-HM3) · 픽스처 v1 영구(NFR-HM4) · 왕복 동일성 속성 시험(NFR-HM5) · 기존 테스트 무수정 통과 + **신규 원시 SQL 0건**(NFR-HM6 — 이름 교환은 임시 키로 해결해 원시 SQL 예외가 필요 없다).

---

## 15. 환경변수 (전부 선택 · 기본값 있음 — FR-0-74)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `VERSION_AUTO_SNAPSHOT_ENABLED` | `true` | 자동 스냅샷 5종 전역 스위치. **`BEFORE_RESTORE`는 끌 수 없다**(FR-0-72) |
| `VERSION_RETENTION_AUTO` | `30` | 챗봇당 자동 스냅샷 보존 수(`BEFORE_RESTORE` 포함, 최신 `BEFORE_RESTORE` 1건은 제외) |
| `VERSION_RETENTION_MANUAL` | `30` | 챗봇당 수동 스냅샷 보존 수 |
| `VERSION_PINNED_MAX` | `10` | 챗봇당 고정 상한 |
| `VERSION_SNAPSHOT_MAX_BYTES` | `20971520` | 스냅샷 1건 원본(UTF-8) 상한 20MB |
| `VERSION_TOTAL_MAX_BYTES_PER_CHATBOT` | `314572800` | 챗봇당 총량 300MB. `< VERSION_SNAPSHOT_MAX_BYTES`면 기동 시 **경고 로그**(기동 실패 아님) |
| `VERSION_TX_TIMEOUT_MS` | `30000` | 캡처 읽기·복원 쓰기 인터랙티브 트랜잭션 timeout(Prisma 기본 5초 대체) |

`env.validation.ts`: 정수 강제 변환 · 하한(보존 ≥1, 고정 ≥0, 바이트 ≥1MB, timeout ≥5000). 하나도 설정하지 않아도 정상 동작(AC-H4-8). **신규 seed 없음** — 3테이블 0행이 정상.

---

## 16. 정적 검사

### 16.1 신규 `versions/lib/version-sealing.spec.ts`

`rag-allowlist.spec.ts`·`asset-write-sealing.spec.ts`·`validation-sealing.spec.ts`와 **같은 형식**(스캔 루트 지정 · 자기 자신 제외 · 스캔 대상 0건 아님 가드 · 주석 줄 제외).

| # | 단언 | 근거 |
|---|---|---|
| V-1 | `apps/api/src/**`에서 `(prisma｜tx).(intent｜keyword｜homonymDictionary｜contextVariable｜dialogNode｜dialogNodeIntent｜dialogNodeKeyword｜faqEntry｜chatbotAnswerSetting).(create｜createMany｜update｜updateMany｜upsert｜delete｜deleteMany)(` 가 `versions/**` 안에서는 **`restore/version-restore.applier.ts` 1파일에만** 존재 | FR-0-69, NFR-HS3, AC-H4-5 |
| V-2 | `versions/**`의 `(prisma｜tx).chatbot.update(` 은 applier 1파일에만 | 프로필 4필드 쓰기 유일 지점 |
| V-3 | `versions/**`에 `augmentationSuggestion｜testCase｜testCaseSet｜testRun｜testRunResult｜trainingJob｜conversationLog｜unansweredQuestion｜ragCallLog｜embeddingVector｜channel｜bannedWord` 쓰기 호출 0건. `intentClassifierModel` 쓰기는 applier의 `deleteMany`만 | FR-H3-15, AC-H3-16 |
| V-4 | `versions/**`에 `QueryEmbeddingService` 참조 0건 | AC-H3-15 |
| V-5 | `versions.module.ts`·`version-capture.module.ts`의 imports에 `IntentsModule｜KeywordsModule｜FaqsModule｜DialogNodesModule｜ContextsModule｜HomonymsModule｜AugmentationModule｜ValidationModule｜ConversationModule｜LearningModule｜ClassifierModule｜TrainingJobsModule` 0건 | §2.2 |
| V-6 | `version-capture.module.ts`에 `VersionRestore｜RestoreApplier` 심볼 0건 | 자산 모듈 DI 그래프에 쓰기 경로 미유입(§2.1) |
| V-7 | `chatbotVersionPayload` 참조 파일 = `version-capture.service.ts`·`version-payload.reader.ts`·`version-retention.service.ts`·`chatbots/chatbots.service.ts` 4곳뿐(**`version.service.ts` 0건**) | FR-H1-17, AC-H1-12 구조적 보장 |
| V-8 | `@Public()` 핸들러 수 = **정확히 6** | FR-0-76, AC-H4-6 |
| V-9 | `packages/dialogue-engine/**`에 `chatbotVersion`(대소문자 무관) 0건 | FR-0-68 |

### 16.2 기존 `augmentation/lib/asset-write-sealing.spec.ts` 갱신 (필수)

S-1("Intent/Keyword 자산 쓰기 Prisma 호출은 소유 서비스 파일 밖에서 0건")이 **복원 applier 때문에 실패한다**(`tx.intent.create/update`·`tx.keyword.create/update`). 허용 목록에 `versions/restore/version-restore.applier.ts`를 **추가**하고 "정확히 2개" 가드 단언을 **3개**로 갱신한다. 근거는 ADR-0025 갱신 각주(복원은 **관리자 요청 핸들러 1곳**의 과거 상태 재현이며, 본문을 만드는 경로가 캡처뿐이라 미승인 문장의 주입 경로가 아니다). S-2(`applyLearningExample()` 호출부 3곳)는 **불변** — 복원은 그 메서드를 호출하지 않는다.

> **권고(선택)**: S-1 정규식은 `createMany｜delete｜deleteMany`를 잡지 못한다. 확장하면 봉인이 더 촘촘해지나 걸리는 파일 목록을 먼저 확인해야 한다(예상: 동일 3파일). 이번 범위의 필수 사항은 아니다.

---

## 17. 시험 관점 (test-automation 인계)

| 층 | 대상 | 핵심 케이스 |
|---|---|---|
| **단위(순수 함수)** | `snapshot-canonical` | 키 순서·엔터티 순서·`intentIds` 순서가 달라도 같은 해시(AC-H1-5) / 예문 순서만 바뀌면 다른 해시(AC-H1-6) / `undefined`↔생략·`null` 유지 |
| | `snapshot-upcasters` + **픽스처 v1** | ★ AC-H3-20 · NFR-HM4 |
| | `snapshot-integrity` | FK 참조 깨짐 거부 / 앱 레벨 참조 경고만 / 정규화 중복 거부 / START 2개 거부 / 상한 초과(AC-H3-19) |
| | `version-diff` | AC-H2-1~3(요약 · `+d −b` · 재생성 힌트) · `reorderedOnly` · REF_SET 이름 해석 |
| | `restore-plan` | 이름 맞바꿈(AC-H3-17) · 컨텍스트 교체 노드 · 조인 집합 차이 · 변경 없는 행 미포함 |
| | `retention-policy` | AC-H1-8 · 최신 `BEFORE_RESTORE` 보호 · 총량 초과 순서 · 고정만 남은 초과 |
| | **왕복 동일성(속성 기반)** | 임의 자산 S → 캡처 → 무작위 변경 → 복원 → 재캡처 해시 == S 해시(NFR-HM5, AC-H3-2) |
| **통합(API + SQLite)** | 캡처 | AC-H1-1~4, 7, 9~12(목록 쿼리 로그에 `chatbot_version_payloads` 부재) |
| | 복원 | ★ **AC-H3-2**(해시 동일) · **AC-H3-3/4**(ID 보존 · TC 유효 — No.19 실행으로 `UNRESOLVED` 아님) · **AC-H3-8**(적용 단계 오류 주입 → 자산 불변) · AC-H3-5/6(백업 · 복원의 복원) · AC-H3-9(백업 크기 초과 → 중단) · AC-H3-10(미리보기 후 수정 → 409) · AC-H3-11(RUNNING 학습 · QUEUED TestRun → 409) · AC-H3-12(ARCHIVED → 409 `CHATBOT_ARCHIVED`) · AC-H3-13(분류기 행 없음) · AC-H3-14(캐시 무효화 — 60초 대기 없이 대상 FAQ 응답) · AC-H3-15(질의 캐시 500건 유지) · AC-H3-16(범위 밖 테이블·`slug`/`status`/`groupId` 불변) · AC-H3-18(봉투 이어가기) |
| | 재색인 | ★ **AC-H3-7**: Mock 임베딩 호출 인자 계측 — 예문 1,000 중 20건 변경 버전으로 복원 시 임베딩 문장 ≤20 / 색인 실행 중 복원 → 종료 후 재실행으로 복원 내용 색인(§8.7) |
| | 동시성 | 두 복원 동시 → 1건 409 / 복원 트랜잭션 중 편집 요청 → 편집이 복원 후 적용 또는 복원 409(둘 중 하나, 뒤섞임 없음) / 동시 수동 저장 → 행 1개 |
| | 감사·권한 | AC-H4-1~4(가상 역할 AND 단위 시험 포함) · AC-H4-7(영구삭제 동반 삭제) · AC-H4-8(환경변수 0) · AC-H4-10(로그 원문 부재 — 로거 캡처) |
| **정적** | §16 | AC-H4-5/6/9 |
| **성능** | NFR-HP2~7 | 2MB 캡처 · 1만 행 복원 15초 · **복원 중 다른 챗봇 API P95 +20% 미만 및 대화 로그 유실 0건**(§9.3) |

**필수 5종**(요구사항 §12 지정): AC-H3-2 · AC-H3-4 · AC-H3-8 · AC-H3-7 · AC-H3-20.
**시험 데이터**(`docs/04-test/시험데이터.md` 추가 대상): `snapshot-v1.json` 영구 픽스처 · 이름 맞바꿈 픽스처 · 참조 깨진 DB 픽스처(노드 `targetNodeId` 고아) · START 노드 중복 스냅샷(무결성 거부).

---

## 18. 다음 단계 인계

| 에이전트 | 인계 내용 |
|---|---|
| **`ml-engineer`** | **건너뛴다**(P-10). 새 모델·ml-worker 변경 0. 참고 과제(선택): CPU 배포에서 "바뀐 문장 수 대비 재색인 소요" 실측 — `EMBEDDING_BATCH_TIMEOUT_MS`(30초) 대비 여유 확인 |
| **`ui-designer`** | ① 정보 구조(버전 이력 진입점 — 챗봇 상세의 탭 vs 대화 설계 서브내비) ② 목록 + 최상단 "현재" 행(`GET …/versions/current`) + 복원 이벤트 구분선(`restoredFromVersionNo`) + 트리거 필터 ③ **3단계 차이 화면**(요약 9행 → 항목 목록 → 필드 상세, `STRUCT`는 JSON 전/후 대비) ④ **복원 대화상자**: blockers(원인 + 해결 방법, UIUX §7) · warnings 11종 문구 · "대상 버전 이후 변경 N건이 함께 취소됩니다" · **P-7 체크박스 + "vN으로 복원" 버튼 · 기본 포커스 취소** · ACTIVE면 체크 → `acknowledgeActive:true` ⑤ 증강 제안 목록·대량 업로드 확정 화면 안내문(FR-H4-6) + `autoSnapshot` 결과 토스트/경고 ⑥ 복원 완료 패널(백업 번호 · 재색인 진행 · "TC 세트로 검증하기") ⑦ 빈 상태(FR-H4-9) ⑧ 감사 링크는 `audit:read` 보유 시에만 |
| **`backend-implementer`** | §2~§16 전부. ★ **최우선 6가지**: ① **ID 보존 + 차이 적용 순서 S1~S9**(§8.4) ② **해시 확인·백업·교체·사후 검증을 단일 쓰기 트랜잭션**(§8.3) — 쓰기 값은 zod 변환값이 아니라 원본 ③ **`build(chatbotId, tx)` 순차 조회**(tx 위 `Promise.all` 금지) + `VERSION_TX_TIMEOUT_MS` 명시 ④ 커밋 직후 `invalidate()` **1회** + 답변설정 캐시 · 분류기는 트랜잭션 안 삭제 · 질의 캐시 **미주입** ⑤ 목록은 본문 테이블 미접근(구조로) ⑥ `asset-write-sealing.spec.ts` S-1 갱신 + `version-sealing.spec.ts` 신설. 순서 권고: shared-types → Prisma 3테이블 → `lib/` 순수 함수 + 픽스처 → 캡처(+`build` 인자) → 훅 8지점 → 목록/상세/라벨/삭제 → 차이 → 가드 확장 → 복원 → ReindexQueue 플래그 → 정적 검사 |
| **`frontend-implementer`** | FR-H4-\*. 기존 파괴적 동작 확인 대화상자·차이 표시 재사용 우선. 권한 판정은 `can()`만(복원 = 두 권한 AND). `autoSnapshot` 필드는 **선택**이라 없을 때(구버전 서버·TC 임포트) 아무것도 표시하지 않는다 |
| **`test-automation`** | §17 |
| **`code-reviewer`** | ① applier 외 자산 쓰기 0건 ② 복원 트랜잭션 안에 `await auditLogService.record` 없음 ③ 로그 원문 부재 ④ `SNAPSHOT_SCHEMA_VERSION` 증가 판단 누락(§5.4 ⑥) ⑤ `RestoreResponse`·`RESTORE` 감사 `after`가 number만 담는지 ⑥ 픽스처 v1 변경 금지 |

---

## 19. 알려진 제한사항 · 재검토 트리거

| # | 제한 | 완화 / 재검토 트리거 |
|---|---|---|
| L-1 | **SQLite 단일 작성자** — 복원 트랜잭션 동안 전 챗봇의 쓰기가 대기하며, busy 대기 한도를 넘으면 fire-and-forget 대화 로그가 유실될 수 있다 | 준비를 트랜잭션 밖으로 · 차이 적용 · 실측(§17). 트리거: 실측에서 로그 유실 발생 또는 NFR-HP3 미달 → **비동기 복원 Job**(요구사항 §9) 또는 Postgres 전환 우선순위 상향 |
| L-2 | 부분 복원 없음(P-3) — 증강분만 빼려면 복원 후 다른 편집도 함께 되돌아간다 | 차이 화면·내용 조회에서 과거 값 복사. 트리거: "특정 의도만 되돌리기" 요청 반복 |
| L-3 | `bulk-delete` 3종은 `204`라 **자동 스냅샷 실패를 화면에 알릴 수 없다**(EX-H-1 부분 미충족) | 서버 경고 로그 + 목록에 `BEFORE_BULK_DELETE` 부재로 사후 확인. 트리거: 운영 중 실패 관측 시 `200 { deleted, autoSnapshot }`로 계약 변경(프런트 동시 수정) |
| L-4 | 업캐스트된 버전은 저장된 `contentHash`와 재계산 해시가 달라 **"현재와 동일" 판정·해시 생략 규칙에서 1회 여분 스냅샷**이 생길 수 있다 | 보수적 실패(데이터 손실 없음) |
| L-5 | `answerSetting` 행 없음 vs 기본값 행은 해시가 다르다(§5.2) | 의도된 동작 — 복원 정확성 우선 |
| L-6 | 커밋 직후 ~ `invalidate()` 사이의 마이크로태스크 간격에 시작된 TC 실행이 옛 캐시 번들을 볼 수 있다 | 기존 모든 편집과 같은 성질(§9.1). 트리거: 실제 관측 시 작업 시작 경로에 잠금 조회 추가 |
| L-7 | 롤백으로 제거된 승인 증강 예문은 **다시 제안되지 않는다**(P-8, `@@unique`) | 미리보기 경고 · 관리자가 의도 편집에서 직접 추가 |
| L-8 | 영구삭제는 여전히 불가역(스냅샷 동반 삭제) | 오프사이트 백업은 No.45 |
| L-9 | 항목별 버전 변화 화면·내보내기/가져오기·예약 복원·타 챗봇 복원·환경 승격 없음 | 각각 FR-H4-10 / No.45 / No.28 / No.40·No.1 고도화 |

---

## 20. 요구사항 대비 해석 · 편차 (PM 재확인 불요 — 설계 판단 범위)

| # | 요구사항 원문 | 이 설계 | 근거 |
|---|---|---|---|
| D-1 | FR-H1-10 봉투에 `integrityWarnings[]` 포함 | 메타 컬럼에만 저장, 본문 제외 | 본문에서 재계산 가능한 파생값 · 해시 범위 밖 · 목록에서 "유무"를 본문 없이 표시 |
| D-2 | §4.2.1 `BEFORE_RESTORE` "해시가 같아도 가장 최근 동일 버전을 백업 참조로 기록" | **항상 새 행 생성** | FR-H1-5("`BEFORE_RESTORE` 예외") · AC-H3-5("새로 있고")와 일치. 참조만 기록하면 그 버전이 자동 정리(30건)로 사라질 수 있다 |
| D-3 | FR-H3-7 ③백업 → ④단일 트랜잭션 교체(별개 단계) | **백업·교체를 같은 트랜잭션** | §8.3 — 백업 = 교체 직전 상태를 원자적으로 보장. AC-H3-8은 백업 잔존을 "허용"할 뿐 |
| D-4 | §4.7 "복원 잠금 중 작업 시작 409"(권고) | 미채택 | §9.1 — DB 직렬화 + 트랜잭션 안 진행 작업 재확인으로 뒤섞임 없음, 3모듈 역의존 회피 |
| D-5 | FR-H3-12 ③ 분류기 삭제(커밋 직후) | **트랜잭션 안** | 복원이 롤백되면 모델도 남아야 한다(원자성) |
| D-6 | FR-H2-9 `envFingerprint.assetContentHash`(선택) | **1차 제외** | No.19 실행기 수정 필요 · 필수 범위 아님. 재검토 트리거: "이 실행은 vN과 동일" 표시 요구 발생 시 — 실행 시작 시 `canonicalize` 순수 함수로 계산해 지문에 추가(스냅샷 행 생성 없음) |
| D-7 | EX-H-1 "응답에 `snapshotSkipped: true`" | `autoSnapshot: { status }`(선택 필드) · `bulk-delete`는 미반영 | 상태 4값이 화면 안내에 더 유용 · 204 계약 유지(§19 L-3) |
| D-8 | FR-0-75 신규 코드 7종 | **9종**(+`VERSION_PINNED`·`RESTORE_NO_CHANGES`) · `ARCHIVED`는 `CHATBOT_ARCHIVED` 재사용 | §10.3 |
| D-9 | FR-H2-3 "목록 응답에 조건부로 합칠지 architect" | 별도 `audit-count` 엔드포인트 | §10.1 — 목록 성능 · 권한 판정을 가드로 |
| D-10 | 신규 환경변수 6종 | **7종**(+`VERSION_TX_TIMEOUT_MS`) | Prisma 인터랙티브 트랜잭션 기본 5초가 NFR-HP3(1만 행 15초)와 충돌 |
