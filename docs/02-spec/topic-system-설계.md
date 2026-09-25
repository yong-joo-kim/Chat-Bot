# 토픽 시스템 세부 설계서 (No.22)

> **요구사항**: `docs/requirements/topic-system.md`(T-1~10, J-1~J-18, FR-0-129~137, FR-TP1-\*~FR-TP8-\*, NFR-TPP/TPS/TPA/TPM, AC-TP1~TP7, EX-TP-1~24, P-1~P-16)
> **상위 문서**: `docs/02-spec/개발명세서.md` §2·§2.2·§3·§3.1·§4·§4.1·§5·§6(**결정 38 신설**)·§7
> **신규 ADR**: **ADR-0037**(토픽 = 챗봇 스코프 평면 분류 · `getCached()` 번들 조립에서 비활성 토픽의 응답 진입점 3종만 제외(엔진 수정 0) · 경계 참조 허용 + API 계층 점검 · 스냅샷 선택 필드(값 없으면 생략 → 해시 불변) · **ID 재매핑 적재기 3단계**(캡처 → 선택·계획(순수) → 적재(생성 전용)) · 분리 = 복사)
> **갱신 ADR(각주만)**: ADR-0002(사전검사 13 → 14종) · ADR-0005(토픽 소속 FK · API 계층 참조 열거 1벌 · K-2) · ADR-0008(번들은 비활성 진입점이 빠진 채 들어온다 · K-1 결정적 순서) · ADR-0016(`Topic` 대상 · 일괄 지정 요약 1건) · ADR-0025(자산 쓰기 봉인 S-1 허용 파일 3 → 5) · ADR-0031(자산 `topicId` 선택 필드 · 복원 정규화 · 깊은 복사 도입)
> **작성일**: 2026-09-25 · **GPU**: **1 유지**(DB 조회·번들 필터·참조 그래프 순수 함수·트랜잭션 복사 — 새 모델·학습·추론 0, 분리된 챗봇의 재색인은 기존 ml-worker 경로). ml-engineer 신규 작업 없음 — §26.
> **기존 파일 수정 목록**: 문서는 `docs/02-spec/topic-system-patches.md`, 코드는 이 문서 §2.5.

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

대화 자산 6종(의도·키워드·동음이의어·컨텍스트·노드·FAQ)은 전부 `chatbotId` 하나로 잘려 있다. 부서·주제별로 나누어 관리하고, 준비 중인 부분을 운영에서 가리고, 떼어 내 새 챗봇을 만들 단위가 없다. 이 설계는 챗봇 안에 **평면 `Topic`**을 두고 자산 6종에 **nullable `topicId`**(null = "공통", 항상 활성)를 더한다. 비활성 토픽의 효과는 엔진이 아니라 **`DialogueBundleService.getCached()`의 번들 조립 1곳**에서 **노드·의도·FAQ만 빼는 것**으로 낸다. 공개 대화·TC·비교·힌트·답변 설정 미리보기가 이 경로를 공유하므로 한꺼번에 일관되고, 의미 매칭은 번들 기준으로 후보를 거르므로 재색인 없이 따라온다. 캡처·설계 점검·흐름·삭제 사전검사·분리는 **필터 없는 `build()`**를 쓴다(정적 검사로 봉인). 토픽 경계를 넘는 참조는 막지 않고 API 계층 순수 함수(`validateTopicBoundaries`)가 보이게 한다. 분리는 **복사**다 — 원본을 트랜잭션 안에서 일관 캡처하고, 선택 토픽 + **의존 폐포** + 시작·폴백 노드를 고른 뒤, **모든 ID를 새로 발급**하고 참조를 **UUID 잎 재작성**으로 옮겨 **생성 호출만** 하는 적재기로 새 `DRAFT` 챗봇에 넣는다. 스냅샷에는 자산 `topicId`를 선택 필드로 넣는데, 값이 없으면 직렬화에서 빠지므로 토픽 없는 챗봇의 `contentHash`는 **도입 전과 바이트 단위로 같다**. 이 설계가 추가로 찾은 제약 5건: **① 복원이 없는 토픽을 공통으로 적재하면 사후 해시 검증이 실패한다**(대상 스냅샷을 먼저 정규화해 기대 해시를 다시 계산 — §11.2) · **② 소속 변경이 `updatedAt`을 올리면 동점 노드 순위(`rankNodes`의 `updatedAt desc`)가 바뀐다**(소속 변경은 `updatedAt` 보존 — §5.2) · **③ 시작 노드는 거의 항상 모든 토픽을 가리키는 허브라 폐포가 챗봇 전체가 된다**(시작·폴백 노드 연결 잘라내기 — §9.3) · **④ API 조건분기의 슬롯 바인딩이 컨텍스트를 가리키는 참조(E-12)가 요구사항 참조 목록에 없다**(폐포·재작성을 UUID 잎 스캔으로 만들어 목록 누락에 강하게 — §9.2·§9.5) · **⑤ 분리본에서 동점 승자가 바뀌지 않으려면 타임스탬프 보존과 순서 보존 ID 발급이 필요하다**(§9.5).

---

## 1. PM 확정 사항 (2026-09-25 — 전부 권고안)

| # | 확정 내용 | 이 문서에서의 반영 |
|---|---|---|
| P-1 | 1차-A(챗봇 안 토픽: 분류·필터·일괄 지정·활성/비활성·교차 참조 점검·토픽 단위 내보내기/가져오기) + 1차-B(토픽 → 새 챗봇 **분리 = 복사**). **병합은 2차** — 충돌 규칙(P-9)은 문서만 | §5~§9 · §10(문서만) |
| P-2 | 평면 · 자산당 0~1개(nullable `topicId`, null = 공통·항상 활성) · 챗봇당 50 · 대상 6종(설문·자주 쓰는 문장 제외) · START/FALLBACK 공통 고정 · 이름 유일성 챗봇 단위 유지 | §3.1 · §5 |
| P-3 | 경계 참조 허용 · 저장 검증 불변 · API 계층 점검 규칙 추가 · 엔진 `validateDesign` 불변 · 비활성화 전 영향 미리보기 필수 | §7 · §25 D-7 |
| P-4 | 엔진 수정 0 · `getCached()` 경로 번들 조립에서 비활성 토픽의 노드·의도·FAQ만 제외 · 의미 매칭 자동 일관(재색인 불필요) · 분류기 대화 경로 밖 · 캡처·점검은 전체 자산 | §2.3 · §6 |
| P-5 | 토픽 우선순위 없음 · 기존 예문 중복 경고에 토픽 이름 | §7.5 |
| P-6 | 대화설계 서브내비 8번째 "토픽" · 최상위 메뉴 없음 · 기존 목록 6화면에 필터·열·일괄 지정 | §5.3 · §20 |
| P-7 | 스냅샷 자산 `topicId` 선택 필드(값 없으면 생략 → 기존 해시 불변) · `Topic` 정의·활성 상태는 스냅샷 밖 · 복원 시 없는 토픽 → 공통 + 경고 | §11 |
| P-8 | 분리 = 복사 · 원본 불변 · 새 챗봇 DRAFT · ID 전부 새로 발급 · 토픽 밖 참조 자산·START/FALLBACK 동반 · 참조 설문은 정의만 복제 · API 연결 그대로 참조 · 전체 선택 = 깊은 복사 · No.40과 적재기 부품 공유 | §9 · ADR-0037 §5 |
| P-9 | 병합 충돌 기본값(의도·키워드 합치기·동의어 충돌 시 전체 거부 / 노드·컨텍스트 이름 바꿔 추가 / 동음이의어·FAQ 건너뛰기 + 리포트 / dry-run / `BEFORE_MERGE`) — **문서만** | §10 |
| P-10 | 신규 권한 0 · 토픽 편집 `dialogue:write` · 분리 `chatbot:write` | §14 |
| P-11 | 감사 `Topic` 대상 추가 · 일괄 지정 요약 1건 · 분리 = 기존 `COPY` 1건 | §15 |
| P-12 | `ConversationLog.topicId`(대화 당시 토픽) 지금부터 적재 · 1차 통계 화면 없음 | §6.6 |
| P-13 | 시뮬레이터에만 "비활성 토픽 포함" 토글 · TC 실행 제외 | §6.5 |
| P-14 | 그룹 계층화 = No.1 고도화 반납 · `dialogue-design.md:657` 범위 안 · 토픽 단위 권한 = No.45 | §23 · 패치 E |
| P-15 | GPU 1 | §26 |
| P-16 | K-1(번들 조회 `orderBy` 없음) 결정적 정렬 + TC 회귀를 **별도 선행 커밋**으로 | §2.6 · §12 |
| K-2 | (architect 결정) 노드→노드 참조 추출 두 벌의 단일화 여부 | §13 — **이번에 합치지 않고 동등성 시험으로 고정** |
| (architect) | 분리의 시작·폴백 노드 연결 처리 = **잘라내기(TRIM) 기본 + 따라가기(FOLLOW) 선택** | §9.3 · **PM 확인 1**(보고) |
| (architect) | 소속 변경은 `updatedAt`을 **보존**한다(요구사항 "갱신 허용"과 다름) | §5.2 · §25 D-3 |
| (architect) | 복원 시 대상 스냅샷을 **현재 토픽 기준으로 정규화한 뒤** 기대 해시를 계산한다 · 경고 2종(`TOPIC_MISSING`·`TOPIC_EXPOSURE_CHANGE`) | §11.2~§11.3 |

---

## 2. 아키텍처 배치

### 2.1 모듈 구조

기존 4계층 규약(개발명세서 §2.1)을 따른다. **NestJS 모듈 2개를 신설**한다 — 토픽 도메인(`topics`)과 **챗봇 간 자산 이관 부품**(`asset-transfer`, No.40·병합이 재사용). 참조 열거 순수 함수는 두 모듈과 대화 설계가 함께 쓰므로 횡단 모듈 `dialogue-common/lib`에 둔다.

```
apps/api/src/
├── topics/                                      # [신규] TopicsModule
│   ├── topics.module.ts                         # imports: prisma, chatbots, dialogue-common, audit-logs, asset-transfer
│   │                                            # exports: [TopicLookupService] — import처 = 자산 6모듈·simulation·dialog-nodes (versions는 Prisma로만 읽음 — §2.2)
│   ├── topics.controller.ts                     # @Controller('chatbots/:chatbotId/topics') — ①~⑩ (정적 세그먼트 split 먼저 선언)
│   ├── topic-assignments.controller.ts          # @Controller('chatbots/:chatbotId/topic-assignments') — ⑪
│   ├── topics.service.ts                        # ★ Topic 쓰기 유일 파일(생성·이름/설명·이동·활성/비활성·삭제(+공통으로 옮기기))
│   ├── topic-assignment.service.ts              # ★ 자산 6종 topicId 일괄 쓰기 유일 파일(assign · clearTopicInTx) — data 키 ⊆ {topicId, updatedAt}
│   ├── topic-read.service.ts                    # 목록(자산 수·교차 참조 수) · 영향 미리보기 — build() 1회 + 순수 함수
│   ├── topic-lookup.service.ts                  # (export) 토픽 존재·소속 검증(assertTopicInChatbot) · id→{name,enabled} 맵
│   ├── topic-split.service.ts                   # 분리 미리보기·실행 오케스트레이션(§9.6)
│   ├── topic.mapper.ts
│   └── lib/                                     # DB·Nest 무의존 순수 함수(NFR-TPM1)
│       ├── topic-summary.ts                     # summarizeTopics(bundle, topics, refs) → 토픽별 자산 수·교차 참조 수
│       ├── topic-boundary.ts                    # validateTopicBoundaries(bundle, topics, ctx) → { issues, ruleTotals } (§7.2)
│       ├── topic-impact.ts                      # computeTopicImpact(bundle, topics, ctx, topicId, action) (§7.4)
│       ├── topic-scope.ts                       # liveTopicKey(topicId, topicMap) · isLive() — 공통/활성/비활성 판정 1벌
│       ├── topic-order.ts                       # nextSortOrder · swapAdjacent
│       └── topic-sealing.spec.ts                # §17 T-1~T-16
├── asset-transfer/                              # [신규] AssetTransferModule — ★ 복원 적재기(ID 보존)와 코드를 섞지 않는다(NFR-TPM2)
│   ├── asset-transfer.module.ts                 # imports: dialogue-common(build) · prisma · exports: [AssetTransferCaptureService, AssetTransferLoader]
│   ├── asset-transfer-capture.service.ts        # captureTransferSource(tx, chatbotId) — build(chatbotId, tx) + 토픽 순차 조회
│   ├── asset-transfer.loader.ts                 # ★ create/createMany만(update·delete·upsert·원시 SQL 0 — §17 T-5)
│   └── lib/
│       ├── transfer-selection.ts                # selectTransferSubset(source, selection) — 씨앗·폐포·시스템 노드 잘라내기·건수(§9.2~§9.4)
│       ├── system-node-trim.ts                  # trimSystemNodeOutputs(node, keepNodeIds) (§9.3)
│       ├── transfer-plan.ts                     # planTransfer(source, subset, policy) — 순서 보존 ID 발급·재작성(§9.5)
│       ├── id-leaf-rewrite.ts                   # rewriteIdLeaves(json, remap, sourceIdSet) — UUID 잎 재작성 1벌
│       └── transfer-verify.ts                   # verifyTransferPlan(plan, sourceIdSet) — 원본 ID 잔존 0·참조 폐쇄성(FR-0-135)
├── dialogue-common/
│   ├── dialogue-bundle.service.ts               # [수정] ① K-1 orderBy · ② build(…, options) · getCached 필터 · getCachedUnfiltered · 무효화 2캐시
│   └── lib/
│       ├── topic-bundle-filter.ts               # [신규] filterInactiveTopicAssets(bundle, inactiveTopicIds) — 필터 1벌(NFR-TPM3)
│       └── asset-ref-graph.ts                   # [신규] collectAssetRefs(bundle, extras) — ★ API 계층 참조 열거 1벌(§7.1)
├── dialog-nodes/lib/node-target-refs.ts         # [신규 — K-2] 저장 검증의 노드 참조 수집을 동작 변경 없이 추출(§13)
├── conversation/lib/answered-topic.ts           # [신규] resolveAnsweredTopicId(bundle, result) (§6.6)
└── versions/lib/snapshot-topic-normalize.ts     # [신규] normalizeSnapshotTopics(envelope, existingTopicIds) (§11.2)
```

### 2.2 모듈 의존 방향

```
topics          → chatbots(ChatbotScopeService·ChatbotCopyTargetService) / dialogue-common(DialogueBundleService·lib)
                  / asset-transfer / audit-logs / prisma
asset-transfer  → dialogue-common(DialogueBundleService.build — tx 경로) / prisma          (topics·versions를 import하지 않는다)
intents｜keywords｜homonyms｜contexts｜dialog-nodes｜faqs → topics(TopicLookupService — 읽기 1개)
simulation      → topics(TopicLookupService — 답한 자산의 토픽 이름)
versions        → (Prisma 읽기로 토픽 id 집합만 — TopicsModule import 0)
conversation    → (변경 없음 — 번들의 topicId만 읽는다. 생성자 인자 추가 0)
asset-transfer ✕ versions/restore/**   · versions ✕ asset-transfer/**                        (§17 T-15)
```
- `TopicsModule`의 export는 **`TopicLookupService` 1개**다. 토픽 쓰기(`topics.service.ts`)·자산 소속 일괄 쓰기(`topic-assignment.service.ts`)·분리는 모듈 밖에서 주입할 수 없다.
- 자산 6모듈이 `TopicsModule`을 import하고 `TopicsModule`은 자산 모듈을 import하지 않는다(순환 없음). 일괄 지정은 자산 서비스가 아니라 Prisma로 `topicId`만 쓴다 — 자산 서비스의 검증·감사·자동 스냅샷 훅을 타지 않는 **분류 전용 경로**다(§5.2).
- `asset-transfer`는 대화 자산 6모듈·`VersionsModule`·`TopicsModule`을 import하지 않는다. 캡처는 `DialogueBundleService.build(chatbotId, tx)`를 **호출만** 한다.

### 2.3 엔진 수정 범위 — **0건** (FR-0-129)

- `packages/dialogue-engine`은 **한 파일도 바꾸지 않는다.** 비활성 토픽의 효과는 번들에서 노드·의도·FAQ가 **없는 것**으로 나타나며, 엔진은 이미 "없는 노드"(`BROKEN_REFERENCE` trace 후 그 아웃풋만 건너뜀)·"없는 의도"(조건 불일치)를 예외 없이 처리한다.
- `DialogueBundle`의 형태는 **자산 항목에 선택 필드 `topicId?` 추가**뿐이며 엔진은 읽지 않는다. `validateDialogueDesign()`·`getOutgoingNodeRefs()`·`buildDialogueIndex()`는 **호출만** 한다.
- 설계 점검의 토픽 규칙은 엔진 결과 **뒤에** API 계층에서 합친다(§7.3). `DesignIssueCode`·`resourceType` enum 확장은 `packages/shared-types`의 변경이다(엔진 코드 변경 0 — No.26·27이 코드를 추가한 선례와 같은 위치).
- 엔진 패키지에 `topic` 심볼 0건을 정적 검사가 단언한다(§17 T-1).

### 2.4 `apps/api` 외 워크스페이스 영향

| 워크스페이스 | 변경 |
|---|---|
| `packages/shared-types` | **`topic.ts` 신설**(§4.1) · `dialogue.ts`(자산 6종 `topicId?` · 목록 쿼리 `topicIds` · 목록 행 `topicId` · 생성/수정 `topicId` · `ExampleConflict.topicId?/topicName?`) · `dialogue-engine.ts`(`DesignIssueCode` +4 · `resourceType` + `HOMONYM` · `DesignIssue.topicRef?` · 보고서 `ruleTotals?`) · `bulk-import.ts`(`newItemTopicId?`) · 시뮬레이터 요청/응답 · `learning.ts`(`IntentSuggestion.topicId?`) · `version.ts`(복원 경고 2종) · `audit.ts`(`Topic`) · `common.ts`(`ApiErrorCode` 4종) · `index.ts` export |
| `packages/dialogue-engine` · `packages/pii-mask` · `apps/ml-worker` · `apps/widget` | **변경 0건** |
| `apps/web` | 대화설계 서브내비 8번째 **토픽**(관리·분리 마법사) · 목록 6화면 토픽 필터·열·일괄 지정 · 자산 폼 토픽 선택 · 설계 점검 토픽 규칙 표시 · 시뮬레이터 토글 · 가져오기 "신규 항목의 토픽" · 복원 미리보기 경고 2종 — §20 |

### 2.5 기존 코드 변경 목록 (구현자 체크리스트)

| 파일 | 변경 | 근거 |
|---|---|---|
| `prisma/schema.prisma` + 마이그레이션 1개 | `Topic` 신설 · 자산 6종 `topicId String?` + FK `Restrict` + `@@index([topicId])` · `ConversationLog.topicId String?`(FK·인덱스 없음) · `Chatbot.topics` 역참조 | §3 |
| `prisma/seed.ts` | 데모 챗봇에 토픽 2개("배송" 활성 · "보험청구 — 준비 중" 비활성) + 의도·FAQ 몇 건 지정 | §3.3 |
| `packages/shared-types/src/{topic,dialogue,dialogue-engine,bulk-import,learning,version,audit,common,index}.ts` + 시뮬레이터 스키마 파일 | §4 · §15 · §16.3 | — |
| `dialogue-common/dialogue-bundle.service.ts` | **① K-1 커밋**: 7개 `findMany`에 `orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]` · **② 본체**: 매핑에 `topicId: row.topicId ?? undefined`(6종) · `build(chatbotId, db?, options?)` · `getCached`가 `{ excludeInactiveTopics: true }` · `getCachedUnfiltered()` · `invalidate()`가 두 캐시를 함께 비운다 | §6 · §12 |
| `dialogue-common/dialogue-common.module.ts` | 비필터 캐시 인스턴스 provider 1개(`'DialogueBundleUnfilteredCache'`, LRU 10) | §6.2 |
| `intents｜keywords｜homonyms｜contexts｜dialog-nodes｜faqs` 서비스·매퍼·컨트롤러 | 생성·수정의 `topicId`(검증 `TopicLookupService.assertTopicInChatbot`) · **topicId만 바뀌는 수정은 `updatedAt` 보존** · 목록 `topicIds` 필터·행 `topicId` · 감사 스냅샷 입력에 `topicId`(값 있을 때만) · 중복 이름 오류 문구에 상대 토픽 이름 | §5 |
| `dialog-nodes/dialog-nodes.service.ts` | START/FALLBACK + `topicId` → `400 TOPIC_SYSTEM_NODE_LOCKED`(생성·수정·유형 변경) · `validate()`가 토픽 규칙 합성 · 목록 행 "다른 토픽 참조 n"(기존 전체 노드 조회에 `topicId` select 추가 — 쿼리 수 불변) · **K-2** 참조 수집을 `lib/node-target-refs.ts`로 추출(동작 불변) · 노드 복사가 `topicId` 승계 | §5 · §7 · §13 |
| `intents/lib/example-conflict.ts` + `intents.service.ts` | 상대 의도 `topicId`·`topicName` 부착 | §7.5 |
| `keywords/keywords.service.ts` | 동의어 충돌 오류 `details[].message`에 상대 키워드 토픽 이름 | §7.5 |
| `intents｜keywords｜faqs` 내보내기·가져오기 커밋 | 내보내기 `topicIds` 필터 · 커밋 `newItemTopicId`(신규 항목에만) · `import-planner.ts` 불변 | §8 |
| `simulation/simulation.service.ts` | `includeInactiveTopics` → `getCachedUnfiltered()` · 응답 `answeredTopic?` | §6.5 |
| `conversation/public-conversation.service.ts` · `conversation-log.service.ts` | `record()`에 `topicId?`(답한 자산의 당시 토픽) — **생성자 인자 추가 0** | §6.6 |
| `learning/*`(추천 의도 조립) | 의도 select에 `topicId` · `IntentSuggestion.topicId?` | §19 |
| `versions/restore/version-restore.service.ts` · `version-restore.applier.ts` · `restore-warnings.service.ts` | 대상 정규화(트랜잭션 안에서 토픽 id 집합 조회) · 기대 해시 재계산 · applier 생성/갱신 `topicId` · 경고 2종 | §11 |
| `chatbots/chatbots.service.ts` · `chatbots/chatbot-copy-target.service.ts`(신규) | `CHILD_COUNT_LABELS.topics = '토픽'` · 사전검사 `topic.count`(13 → 14) · `copy()`의 이름·slug·그룹 결정 로직을 `ChatbotCopyTargetService`로 **동작 불변 추출**(분리가 재사용) · `ChatbotsModule` export 1개 추가 | §9.7 · §15 |
| `audit-logs/lib/audit-snapshot.ts` | `AUDIT_FIELDS.Topic` · 자산 6종에 `'topicId'` | §15 |
| `common/all-exceptions.filter.ts` | `P2003`(토픽 FK) → `409 TOPIC_NOT_EMPTY` 매핑 1줄 | §5.4 |
| `apps/web/**` | §20 | — |
| 시험 파일 | §21.2 닫힌 목록 | FR-0-136 |

> **이 목록에 없는 파일은 바꾸지 않는다.** 특히 `packages/dialogue-engine/**`, `embedding/**`(색인·벡터 캐시·의미 점수 조립 무변경 — 번들 기준 필터로 자동 일관), `validation/**`(TC 실행은 운영 번들 그대로 · 토글 없음), `handoff/**`(힌트는 `getCached` 그대로), `deploy-schedules/**`(동작 추가 0), `rag/**`, `answer-settings/**`, `stats/**`(토픽 통계 화면 0), `versions/lib/snapshot-{envelope,canonical,integrity}.ts`(선택 필드는 기존 직렬화 규칙으로 처리 — §11.1)는 무변경이다.

### 2.6 커밋 분리 단위 (P-16)

| 커밋 | 범위 | 독립성 |
|---|---|---|
| **① K-1 번들 결정적 정렬** | `dialogue-bundle.service.ts`의 7개 `findMany`에 `orderBy` 1줄씩 · 단위 시험 1개(쿼리 인자 단언) + 통합 시험 1개(동점 승자 결정성·복원 왕복) · 개발명세서 ADR-0008 각주(패치 B-5의 K-1 문단) | **No.22 코드에 의존하지 않는다.** 단독 배포 시 동작 변화 = **동점 매칭에서만** 승자가 "DB 행 순서"에서 "먼저 생성된 자산"으로 고정된다(§12.3). 반드시 **§21.3 TC 회귀 절차**를 거친 뒤 ②를 시작한다 |
| ② No.22 본체 | 나머지 전부(K-2 동등성 시험 포함 — 분리해도 무방) | ①의 정렬을 전제로 FR-0-130 "바이트 동일" 기준선을 **① 적용 후**로 잡는다 |

---

## 3. 데이터 모델 · 마이그레이션

### 3.1 Prisma 변경안

```prisma
/// [신규 No.22] 챗봇 안의 평면 토픽(ADR-0037 §1). 스냅샷 대상이 아니다(정의·활성 상태 모두).
/// 쓰기 주체 = topics.service.ts 1파일(+ 분리 적재기의 생성). 챗봇당 50개(서비스 검사).
model Topic {
  id             String   @id @default(uuid())
  chatbotId      String
  chatbot        Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  name           String   // 1~40(코드 포인트) · 줄바꿈/탭 금지
  nameNormalized String   // normalizeText(name) — 챗봇 내 유일(ADR-0006)
  description    String?  // ≤200
  sortOrder      Int
  /// false면 소속 노드·의도·FAQ가 getCached() 번들에서 빠진다. 키워드·컨텍스트·동음이의어는 빠지지 않는다.
  enabled        Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  intents          Intent[]
  keywords         Keyword[]
  homonyms         HomonymDictionary[]
  dialogNodes      DialogNode[]
  contextVariables ContextVariable[]
  faqs             FaqEntry[]

  @@unique([chatbotId, nameNormalized])
  @@index([chatbotId, sortOrder])
  @@map("topics")
}

// 자산 6종 공통 추가(Intent·Keyword·HomonymDictionary·DialogNode·ContextVariable·FaqEntry)
model Intent {
  // … 기존 필드 불변 …
  /// [신규 No.22] null = 공통(항상 활성). 같은 챗봇의 토픽만(서비스 검사 — FK는 Topic.id만 본다).
  /// START/FALLBACK 노드는 항상 null(서비스 검사). 유일성 (chatbotId, nameNormalized)는 불변.
  topicId String?
  topic   Topic?  @relation(fields: [topicId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@index([topicId])   // FK 검사(토픽 삭제 시 자식 스캔)와 "토픽별" 조회 — (chatbotId, …) 선두 인덱스로는 FK 검사를 못 돕는다
}

model ConversationLog {
  // … 기존 필드 불변 …
  /// [신규 No.22] 답한 자산(노드 → FAQ → 의도 순 첫 매칭)의 **대화 당시** 토픽. 공통·미응답·RAG·상담 턴 = null.
  /// FK 없음 · 인덱스 없음 · 쓰기 주체 record() 1곳 · 적재 후 불변(R-9/R-10) · 백필 없음(기존 행 = "기록 없음")
  topicId String?
}

model Chatbot {
  // … 기존 필드 불변 …
  /// [신규 No.22] 역참조만 — DB 컬럼 변화 0
  topics Topic[]
}
```

- **FK를 거는 이유**: 비어 있지 않은 토픽 삭제를 DB가 한 번 더 막는다(ADR-0002 "사전 검사 = UX, 제약 = 최종 방어선"). 복원은 없는 토픽을 null로 적재하므로 FK와 충돌하지 않는다(§11.2).
- **교차 챗봇 방어는 서비스 1곳**(`TopicLookupService.assertTopicInChatbot`)이다. `(chatbotId, topicId) → Topic(chatbotId, id)` 복합 FK는 기각했다(§25 D-10).
- **인덱스는 `(topicId)` 단독**이다. 목록 필터는 기존 `(chatbotId, updatedAt)`로 범위를 좁힌 뒤 거르는 것으로 충분하고(챗봇당 수천 행), SQLite의 FK 검사는 자식 테이블의 `topicId` 조회라 `chatbotId` 선두 인덱스로는 전 챗봇 스캔이 된다.

**만들지 않는 것**: 토픽 계층(상위 토픽) · 자산↔토픽 다대다 조인 · 토픽 단위 권한·담당자 테이블 · 챗봇 밖 공유 토픽 · 토픽 우선순위 · 토픽별 임베딩 색인 · 토픽 활성화 예약 · 토픽 스냅샷 · 토픽별 통계 롤업 · 분리 작업(Job) 테이블 · 재매핑 이력 테이블.

### 3.2 마이그레이션 (1개, `YYYYMMDDHHMMSS_topic_system`)

1. `CREATE TABLE topics`(+ UNIQUE `(chatbotId, nameNormalized)` · INDEX `(chatbotId, sortOrder)`).
2. 자산 6테이블에 `topicId TEXT NULL` + FK + INDEX `(topicId)`. ⚠ **Prisma의 SQLite 마이그레이션은 FK가 있는 컬럼 추가를 테이블 재정의(RedefineTables — 새 테이블 생성 → `INSERT … SELECT` → DROP → RENAME → 인덱스 재생성)로 만든다.** 구현자는 생성된 SQL에서 ① 6테이블의 기존 컬럼·유니크·인덱스·FK가 모두 재생성되는지 ② 조인 테이블(`dialog_node_intents`·`dialog_node_keywords`)의 FK가 끊기지 않는지(`PRAGMA foreign_key_check` 0건) ③ **`test_runs`·`deploy_schedules`·`handoff_sessions`의 원시 부분 유니크 인덱스를 지우는 구문이 끼지 않았는지**(기존 규약) 확인한다.
3. `ALTER TABLE conversation_logs ADD COLUMN topicId TEXT` — FK·기본값·인덱스가 없어 **테이블 재작성 없음**(대형 테이블 영향 없음).
- **비파괴 변경만** — 기존 행의 값 변경 0, **백필 0**(모든 자산이 null = 공통 = 도입 전 동작). 롤백 = `topics` DROP + 7컬럼 제거(자산 6테이블은 다시 재정의).
- **재정의 비용**: 대화 자산 6테이블은 챗봇당 수천 행 규모라 수 초 이내가 기대치다. 기존 배포 순서(마이그레이션 → API 기동)대로 **API 중지 상태**에서 실행하고, 구현자는 챗봇 50개 × 성능 기준 자산량(의도 1,000·노드 500·FAQ 2,000) 합성 DB에서 소요 시간을 측정해 `docs/05-ops/자동배포.md`에 기록한다.

### 3.3 seed

- 데모 챗봇: 토픽 "배송"(활성)·"보험청구 — 준비 중"(비활성) · 의도 2건·FAQ 2건을 "배송"에, 의도 1건·노드 1건·FAQ 1건을 "보험청구"에 지정. 시작·폴백 노드와 인사 의도는 공통. **대화로그 `topicId` 시드는 만들지 않는다**(대화로만 생긴다).

### 3.4 환경변수 — **0개**

코드 상수(`TOPIC_LIMITS` — `shared-types/topic.ts`): 챗봇당 토픽 50 · 이름 40 · 설명 200 · 일괄 지정 1,000건/요청 · 점검 규칙별 상위 50 · 영향 미리보기 끊기는 참조 상위 20 · 분리 미리보기 목록 상위 50 · 분리 동기 상한(§9.4) · 분리 트랜잭션 타임아웃 30초 · 비필터 번들 캐시 LRU 10.

### 3.5 배포 순서 · 롤백

① K-1 커밋(단독 배포 가능, §21.3 회귀 확인) → ② 마이그레이션(API 중지) → API 배포 → 콘솔 배포. 위젯 배포 없음.
- **롤백 안전성**: 구버전 API는 `topicId` 컬럼을 모른다 — 비활성 토픽 자산이 **다시 운영에 노출된다**(구버전 번들에는 필터가 없다). 롤백 절차에 "비활성 토픽이 있는 챗봇 목록 확인 → 필요 시 해당 자산의 노드 `enabled`/FAQ `enabled` 수동 조정 또는 롤백 보류"를 넣는다(운영 문서 인계 — §24 K-7). 토픽이 들어간 스냅샷을 구버전이 복원하면 사후 해시 검증이 실패해 롤백된다(안전 쪽 실패 — §24 K-8).

---

## 4. shared-types 스키마

### 4.1 `packages/shared-types/src/topic.ts` (신설 — 위젯 비유입)

```ts
export const TOPIC_LIMITS = {
  maxPerChatbot: 50, nameMax: 40, descriptionMax: 200, assignMaxIds: 1000,
  boundaryIssuesPerRule: 50, impactRefsTop: 20, splitListTop: 50,
} as const;
/** 목록 필터의 "공통"(topicId = null) 예약어. UUID와 충돌하지 않는다. */
export const TOPIC_FILTER_COMMON = 'common' as const;

export const TopicAssetKind = z.enum(['INTENT', 'KEYWORD', 'HOMONYM', 'CONTEXT', 'NODE', 'FAQ']);
export const TopicNameSchema;            // trim · 1~40 코드 포인트 · 줄바꿈/탭 금지
export const TopicSchema;                // { id, chatbotId, name, description?, sortOrder, enabled, createdAt, updatedAt }
export const CreateTopicSchema;          // { name, description?, enabled?: boolean = true }
export const UpdateTopicSchema;          // { name?, description?: string | null } — 활성 전환은 전용 경로(§16)
export const MoveTopicSchema;            // { direction: 'UP' | 'DOWN' } — 드래그 없음(canned-responses 선례)
export const DeleteTopicQuerySchema;     // { moveToCommon?: queryBoolean() }
export const TopicAssetCountsSchema;     // { intents, keywords, homonyms, contexts, dialogNodes, faqs }
export const TopicListItemSchema;        // TopicSchema + { counts, outgoingCrossRefs, incomingCrossRefs }
export const TopicListResponseSchema;    // { items: TopicListItem[], common: { counts, outgoingCrossRefs }, limit: 50 }

export const TopicAssignRequestSchema;   // { kind: TopicAssetKind, ids: uuid[] (1~1000, 중복 제거), topicId: uuid | null }
export const TopicAssignResultSchema;    // { kind, requested, updated, unchanged, targetTopicEnabled: boolean | null }

export const TopicRefEdge = z.enum([      // §7.1 — 참조 열거 1벌의 간선 종류
  'NODE_INTENT', 'NODE_KEYWORD', 'NODE_CONTEXT',                 // 조인·FK 컬럼(E-1·E-2·E-3)
  'NODE_MOVE', 'NODE_BUTTON', 'NODE_API_BRANCH', 'NODE_SURVEY_COMPLETE', // getOutgoingNodeRefs(E-4)
  'NODE_OUTPUT_CONTEXT', 'NODE_SURVEY', 'NODE_OUTPUT_OTHER',     // 아웃풋 UUID 잎(E-3 폼·E-12 API 슬롯 바인딩·E-5)
  'HOMONYM_INTENT', 'CONTEXT_SLOT_KEYWORD',                      // E-7·E-8
  'HANDOFF_END_BUTTON',                                          // E-9(상담 설정 — 번들 밖)
]);
export const TopicRefEndpointSchema;     // { kind: TopicAssetKind | 'SURVEY' | 'HANDOFF_SETTING', id, name, topicId: uuid | null, topicName: string, topicEnabled: boolean }
export const TopicRefSchema;             // { edge: TopicRefEdge, from: TopicRefEndpoint, to: TopicRefEndpoint }
export const TopicImpactQuerySchema;     // { action: 'ENABLE' | 'DISABLE' }
export const TopicImpactPreviewSchema;   // §7.4 — { topicId, action, alreadyInState, entryPoints: { dialogNodes, intents, faqs },
                                         //   brokenRefs: { total, items: TopicRef[] ≤20 }, duplicateExamples: { total, items ≤20 } (ENABLE),
                                         //   liveEntryPointsAfter: number, pendingRestoreSchedules: number }

export const TopicSplitSelectionSchema;  // { topicIds: uuid[] (0~50, 중복 제거), includeCommon: boolean, systemNodeLinks: 'TRIM' | 'FOLLOW' = 'TRIM' }
                                         //   refine: topicIds.length > 0 || includeCommon
export const TopicSplitRequestSchema;    // Selection + { name?: DialogueName, slug?: Slug, targetGroupId?: uuid } — CopyChatbotSchema 필드 재사용
export const TopicSplitCountsSchema;     // 6종 + { surveys, intentExamples, nodeIntentLinks, nodeKeywordLinks }
export const TopicSplitPreviewSchema;    // §9 — { selected: Counts, closureAdded: Counts, closureItems: { total, items ≤50 },
                                         //   systemNodes: { start: boolean, fallback: boolean }, trimmedLinks: { total, items ≤50 },
                                         //   followedSystemLinks: { total, items ≤50 }, totals: Counts, limits, exceeded: string[],
                                         //   closureDominates: boolean, apiConnectionsKept: number, notCopied: NotCopiedKey[] }
export const TopicSplitResultSchema;     // { chatbot: Chatbot, totals, closureAdded, trimmedLinks: number, surveysCopied: number,
                                         //   capturedAt, designCheck: { error, warning, info }, reindexScheduled: true, notCopied }
```

### 4.2 기존 스키마 확장 (전부 선택 필드 — 하위 호환)

| 파일 | 변경 |
|---|---|
| `dialogue.ts` | `IntentSchema`·`KeywordSchema`·`HomonymDictionarySchema`·`DialogNodeBaseSchema`·`ContextVariableSchema`·`FaqEntrySchema`에 **`topicId: z.string().uuid().optional()`**(값 없음 = 공통 — 번들·스냅샷·상세 응답 공용) · 6개 `*ListItemSchema`에 **`topicId: z.string().uuid().nullable()`**(목록은 항상 키 존재) · 6개 `Create*Schema`에 `topicId?: uuid \| null` · 6개 `Update*Schema`에 `topicId?: uuid \| null`(부분 수정 시맨틱 — null = 공통으로) · 6개 `*ListQuerySchema`에 `topicIds`(콤마 구분, 원소 = uuid \| `'common'`, ≤51) · `ExampleConflictSchema`에 `topicId?`·`topicName?` |
| `dialogue-engine.ts` | `DesignIssueCode` + `INACTIVE_TOPIC_REFERENCE` · `CROSS_TOPIC_REFERENCE` · `CROSS_TOPIC_DUPLICATE_EXAMPLE` · `NO_LIVE_ENTRY_POINT` · `DesignIssueSchema.resourceType` + `'HOMONYM'` · `DesignIssueSchema.topicRef?: { edge, sourceTopicName, targetResourceType, targetResourceId, targetResourceName, targetTopicId: uuid \| null, targetTopicName }` · `DesignValidationReportSchema.ruleTotals?: Partial<Record<DesignIssueCode, number>>`(토픽 규칙이 잘렸을 때만) |
| `bulk-import.ts` | `ImportCommitRequestSchema.newItemTopicId?: uuid \| null` |
| 시뮬레이터(`SimulateRequestDto`·`CompareRequestDto` 소재 파일) | 요청 `includeInactiveTopics?: boolean`(기본 false) · 응답(단건·비교 턴) `answeredTopic?: { id, name, enabled }` — **관리자 API 전용** |
| `learning.ts` | `IntentSuggestionSchema.topicId?`(이름은 콘솔이 토픽 목록으로 해석) |
| `version.ts` | `RestoreWarningSchema` + `{ code: 'TOPIC_MISSING', count }` · `{ code: 'TOPIC_EXPOSURE_CHANGE', exposed, hidden }` |
| `audit.ts` | `AuditTargetType` + `'Topic'`(20 → 21) · 라벨 `'토픽'` |
| `common.ts` | `ApiErrorCode` 4종(§16.3) |

- **공개 계약(`conversation.ts`의 공개 응답·위젯 스키마)은 한 글자도 바뀌지 않는다**(NFR-TPS1 — §17 T-13).

---

## 5. 토픽 정의 · 소속 지정 (FR-TP1-\* · FR-TP2-\*)

### 5.1 토픽 규칙 (`topics.service.ts`)

| 동작 | 규칙 |
|---|---|
| 생성 | `assertWritable` · 이름 정규화 유일(`409 DUPLICATE_NAME` — 메시지 "이미 같은 이름의 토픽이 있습니다") · 챗봇당 50(`409 LIMIT_EXCEEDED`) · `sortOrder = max + 1` · 기본 활성(생성 시 비활성 선택 가능) · 감사 `CREATE` · **번들 무효화 불필요**(소속 자산 0) |
| 이름·설명 수정 | 같은 유일성 규칙 · 감사 `UPDATE` · 무효화 불필요(번들은 id만 본다 — FR-TP1-6) |
| 이동 | 인접 토픽과 `sortOrder` 교환(한 트랜잭션) · 감사 `UPDATE`(summary "순서 변경") · 응답 = 전체 목록 |
| 활성·비활성 | 이미 같은 상태면 **200 무변경**(감사·무효화 0 — 멱등) · 바뀌면 `enabled` 갱신 → **감사 `STATUS_CHANGE`** → `bundleService.invalidate(chatbotId)` · 자산 행 변경 0 · 자동 스냅샷 없음(P-7) |
| 삭제 | §5.4 |

"공통"은 행이 없는 **가상 토픽**이다 — 이름 변경·삭제·비활성화 경로가 없다(FR-TP1-3).

### 5.2 소속 지정

**단건(자산 폼)**: 6개 자산 서비스의 생성·수정이 `topicId`를 받는다. 값이 있으면 `TopicLookupService.assertTopicInChatbot(chatbotId, topicId)`(없음·다른 챗봇 → `404 INVALID_REFERENCE`). 노드는 최종 상태가 START/FALLBACK이면서 `topicId`가 있으면 `400 TOPIC_SYSTEM_NODE_LOCKED`(생성·수정·유형 변경 모두 — 기존 행에 값이 있는데 유형을 START로 바꾸는 경우 포함).

**일괄(`POST /topic-assignments`, `topic-assignment.service.ts`)** — 한 요청 = 한 종류:
1. `assertWritable` · 대상 토픽 검증(`null`이면 공통) · 노드이고 대상이 토픽이면 선택 안의 START/FALLBACK 포함 시 `400 TOPIC_SYSTEM_NODE_LOCKED`(details에 해당 id).
2. 트랜잭션: `findMany({ where: { chatbotId, id: { in: ids } }, select: { id, topicId, updatedAt } })` → 누락 id가 있으면 `404 INVALID_REFERENCE`(details = 누락 id, EX-TP-13 — 부분 성공 없음) → 이미 대상 토픽인 행 제외 → **`updatedAt` 값별로 묶어 `updateMany({ where: { id: { in: 묶음 } }, data: { topicId, updatedAt: 그 값 } })`**.
3. 커밋 후 `invalidate()`(변경 1건 이상일 때) → 감사 요약 1건(§15) → 응답.

★ **`updatedAt`을 보존하는 이유**(요구사항 FR-TP2-6 "갱신 허용"과 다름 — §25 D-3): 엔진의 노드 순위(`rankNodes`)가 `priority → 조건 수 → matchMode → updatedAt desc → id`로 동점을 가른다. 분류만 바꿨는데 `updatedAt`이 오르면 **동점 노드의 승자가 바뀐다** — "분류는 동작을 바꾸지 않는다"(FR-TP2-6 본뜻)가 깨진다. 같은 이유로 **단건 수정에서도 바뀌는 필드가 `topicId`뿐이면 서비스가 `updatedAt: current.updatedAt`을 명시**한다(Prisma는 명시된 `@updatedAt` 값을 그대로 쓴다 — 구현자가 시험으로 확인, §21.1). 다른 필드와 함께 바뀌면 기존대로 갱신된다. 목록의 "최근 수정순"은 소속 변경으로 움직이지 않는다(고지 — §24 K-4).

**대상 토픽이 비활성이면** 응답의 `targetTopicEnabled=false`로 콘솔이 "운영 응답에서 빠진" 결과를 안내한다. 확인 대화상자 문구의 건수(노드·의도·FAQ)는 콘솔이 선택 행으로 센다(FR-TP2-7 — 서버 추가 조회 0).

**대기 중 복원 예약 고지**(EX-TP-15): 소속 변경은 스냅샷 해시를 바꾼다. 확인 대화상자가 기존 `GET …/deploy-schedules/notice`(No.28 충돌 배너)를 호출해 대기 중 복원 예약 건수를 보여 준다 — 새 API 0.

### 5.3 목록 6화면 — 필터·열·배지

- 쿼리 `topicIds=common,<uuid>,…` → `where.OR = [{ topicId: { in: uuids } }, …(common ? [{ topicId: null }] : [])]`. **쿼리 수 불변**(기존 `findMany`·`count`의 `where`에 조건 추가). 없는 토픽 id는 오류가 아니라 매칭 0(EX-TP-24 — 콘솔이 "삭제된 토픽" 칩 표시).
- 행에 `topicId`(항상 키 존재). 이름·활성 표시는 콘솔이 토픽 목록 1회 조회로 해석한다(행마다 조인 0).
- **노드 목록 "다른 토픽 참조 n" 배지**(FR-TP4-5): 노드 목록은 이미 챗봇 전체 노드(`id, outputs`)·의도·키워드·컨텍스트 이름을 읽는다 — 그 `select`에 `topicId`를 더하고 페이지 행마다 `collectAssetRefs`의 노드 출발 간선 중 `CROSS_TOPIC_REFERENCE` 조건(§7.2 ②)을 만족하는 수를 센다. **쿼리 수 불변**.

### 5.4 삭제 · 공통으로 옮기기 (FR-TP1-5)

- `DELETE …/topics/:topicId` — 소속 자산이 1건이라도 있으면 `409 TOPIC_NOT_EMPTY` + `details = [{ field: 'intents', message: '23' }, …]`(0이 아닌 종류만). 비었으면 삭제 → 감사 `DELETE`. 무효화 불필요.
- `?moveToCommon=true` — **한 트랜잭션**: `TopicAssignmentService.clearTopicInTx(tx, chatbotId, topicId)`(6종 `updateMany` — `updatedAt` 보존 묶음 규칙 동일) → `topic.delete` → 커밋 후 `invalidate()` → 감사 2건(`Topic UPDATE` 요약 "공통으로 옮김 n건" · `Topic DELETE`) — AC-TP1-4.
- 경합으로 사전 확인과 삭제 사이에 자산이 들어오면 FK `Restrict`가 `P2003`을 내고 전역 필터가 `409 TOPIC_NOT_EMPTY`로 바꾼다.

---

## 6. 번들 필터 · 캐시 (FR-TP3-\* · FR-0-131)

### 6.1 `build()` 인자

```ts
interface BundleBuildOptions { excludeInactiveTopics?: boolean }   // 기본 = 필터 없음(전체 자산)
build(chatbotId: string, db: DbClient = this.prisma, options: BundleBuildOptions = {}): Promise<DialogueBundle>
```
- `excludeInactiveTopics=true`는 **비트랜잭션 경로에서만** 허용한다 — tx 클라이언트와 함께 오면 프로그래밍 오류로 `throw`(캡처 경로가 실수로 필터를 켜는 것을 런타임에서도 막는다).
- 조회: 기존 7개 `Promise.all`에 **8번째 `topic.findMany({ where: { chatbotId, enabled: false }, select: { id: true } })`를 병렬로** 더한다(캐시 미스 시 +1, 대기 시간 증가는 병렬이라 사실상 0). 필터 없는 호출은 8번째를 보내지 않는다.
- 적용: `filterInactiveTopicAssets(bundle, inactiveIds)` — 비활성 집합이 비었으면 **입력 객체를 그대로 반환**(토픽 없는 챗봇 바이트 동일). 아니면 `dialogNodes`·`intents`·`faqs`에서 `topicId ∈ inactiveIds`를 제거한 **새 배열**(키워드·동음이의어·컨텍스트·설문은 같은 참조 유지). O(n) 1회.

### 6.2 캐시 두 벌

| 메서드 | 필터 | 캐시 | 소비자 |
|---|---|---|---|
| `getCached(chatbotId)` | **비활성 제외** | 기존 `DialogueBundleCache`(TTL 60초 · LRU 50) | 공개 대화 · 시뮬레이터(기본) · 비교 · TC 실행 · 상담 힌트 · 답변 설정 미리보기(6곳 — 코드 변경 0) |
| `getCachedUnfiltered(chatbotId)` [신규] | 없음 | **별도 인스턴스**(TTL 60초 · **LRU 10**) | 시뮬레이터 "비활성 토픽 포함"(단건·비교) **1곳만**(§17 T-4) |
| `build(chatbotId)` | 없음 | 없음 | 설계 점검 · 흐름 · 토픽 목록·영향 미리보기 · 분리 미리보기 |
| `build(chatbotId, tx)` | 없음(필터 금지) | 없음 | 버전 캡처 · 분리 캡처(§9.6) |

- 운영 캐시에 비필터 번들이 들어갈 경로가 없다(AC-TP3-6 "운영 캐시 오염 0") — 키 공유가 아니라 **인스턴스 분리**다. 요청마다 조립하는 대신 소형 캐시를 둔 이유: 시뮬레이터는 같은 챗봇을 연속 호출하고 인덱스 구축(예문 2만)이 조립 비용의 대부분이다.
- `invalidate(chatbotId)`는 **두 캐시를 함께** 비우고 벡터 캐시 무효화·재색인 예약은 기존대로 1회(무효화 지점 1곳 — DD-71 규약 유지).

### 6.3 무효화 지점 (전수)

| 쓰기 | 무효화 | 근거 |
|---|---|---|
| 토픽 활성·비활성 전환(상태가 바뀔 때만) | ○ | 필터 입력 변경 |
| 일괄 지정 · 단건 `topicId` 변경 · 공통으로 옮기고 삭제 | ○ | 필터 대상 집합 변경(단건은 기존 자산 저장 경로의 `invalidate()`가 이미 처리) |
| 토픽 생성·이름·설명·순서·빈 토픽 삭제 | ✕ | 번들이 보는 값(id·enabled) 불변 |
| 분리 | 새 챗봇만 ○(재색인 예약 겸) | 원본 불변 |

재색인 예약은 벡터 `textHash`가 같으므로 **재임베딩 0**이다(ADR-0024 회피 키). 다중 인스턴스에서 다른 인스턴스는 최대 60초 뒤 반영된다(EX-TP-11 — 기존 자산 편집과 같은 한계).

### 6.4 의미 매칭 · 힌트 · TC의 일관성 (코드 변경 0)

- `assembleSemanticInput()`은 벡터 후보를 **번들에 있는 의도·`enabled` FAQ로만** 거른 뒤 순위를 매긴다(`embedding/lib/assemble-semantic-input.ts` 47·55행). 필터된 번들이 들어가면 비활성 토픽 의도·FAQ는 **순위 계산 전에** 빠진다 — 상위 k 자리를 차지하지 않는다(AC-TP3-2).
- 상담 힌트·TC 실행·비교는 `getCached()`를 그대로 쓰므로 자동으로 같은 결과다(AC-TP3-8 · EX-TP-20).
- 분류기(No.23)는 대화 경로 밖이며 추천 결과에 토픽을 표시만 한다(§19).

### 6.5 시뮬레이터 "비활성 토픽 포함" (P-13)

- 요청 `includeInactiveTopics=true` → `getCachedUnfiltered()`로 기준 번들을 얻는다(오버레이는 그 위에 기존대로 합성). 의미 점수는 같은 번들로 조립되므로 비활성 토픽 의도·FAQ도 후보가 된다(벡터는 이미 색인돼 있다).
- 응답 `answeredTopic`: 답한 자산(`resolveAnsweredTopicId` — §6.6 규칙 재사용)의 `topicId`가 있을 때만 `TopicLookupService.mapForChatbot()` 1회로 `{ id, name, enabled }`를 채운다(토픽 없는 챗봇·공통 답변은 필드 없음 — 응답 바이트 동일). 비교는 턴 결과마다 같은 필드(요청당 조회 최대 1회).
- TC 실행에는 이 옵션이 없다(스키마에 필드 없음 — ADR-0030 격리 유지).

### 6.6 `ConversationLog.topicId` (P-12)

- `resolveAnsweredTopicId(bundle, result)`(순수): `isAnswered`이고 `matchedNodeId`가 있으면 그 노드의 `topicId`, 없고 `matchedFaqId`가 있으면 FAQ의, 없고 `matchedIntentId`가 있으면 의도의 `topicId`. **처음 존재하는 매칭 자산에서 멈춘다**(그 자산이 공통이면 null — 다음 단계로 넘어가지 않는다). 미응답·금지어 차단·RAG 답변·상담 턴·설문 소비 턴은 null.
- 공개 대화 서비스는 이미 가진 번들(필터된 운영 번들)에서 찾는다 — **추가 조회 0 · 생성자 인자 추가 0**. `record()` 파라미터 `topicId?: string | null` → `create.data.topicId`. 적재 후 불변(R-10 정적 검사가 이미 단언).
- 1차는 적재만 한다. 통계 화면·집계·인덱스는 만들지 않는다(재검토 트리거 — 요구사항 §9).

---

## 7. 참조 그래프 · 교차 참조 점검 · 영향 미리보기 (FR-TP4-\* · FR-TP3-3)

### 7.1 참조 열거 1벌 — `dialogue-common/lib/asset-ref-graph.ts`

```ts
collectAssetRefs(bundle: DialogueBundle, extras?: { handoffEndButtonNodeId?: string | null }): AssetRef[]
// AssetRef = { edge: TopicRefEdge, fromKind, fromId, toKind, toId } — (from, to, edge) 중복 제거 · 결정적 순서
```

| 출처 | 간선 | 방법 |
|---|---|---|
| 노드 `intentIds`·`keywordIds`·`contextVariableId` | `NODE_INTENT`·`NODE_KEYWORD`·`NODE_CONTEXT` | 컬럼 |
| 노드 아웃풋의 노드 참조 | `NODE_MOVE`·`NODE_BUTTON`·`NODE_API_BRANCH`·`NODE_SURVEY_COMPLETE` | **`getOutgoingNodeRefs()` 호출만**(세 번째 구현 금지 — NFR-TPM1) |
| 노드 아웃풋의 나머지 UUID 잎 | `NODE_OUTPUT_CONTEXT`(CONTEXT_FORM · **API 슬롯 바인딩 `contextVariableId` — E-12, 요구사항 목록 누락분**) · `NODE_SURVEY` · `NODE_OUTPUT_OTHER` | 아웃풋 JSON의 **문자열 잎 중 번들 자산 id 색인에 있는 값**(`id → kind` 맵) — 위 행에서 이미 잡힌 노드 참조는 제외 |
| 동음이의어 `meanings[].intentId` | `HOMONYM_INTENT` | 필드 |
| 컨텍스트 `slots[].keywordId` | `CONTEXT_SLOT_KEYWORD` | 필드 |
| 상담 설정 종료 후 버튼 | `HANDOFF_END_BUTTON` | `extras`(번들 밖 — 호출자가 1회 조회) |

- 이 함수가 **토픽 점검·영향 미리보기·토픽 목록 교차 참조 수·노드 목록 배지**의 유일한 입력이다. 분리의 폐포 계산(§9.2)도 같은 "UUID 잎" 원리를 쓰지만 재작성까지 해야 하므로 `asset-transfer/lib/id-leaf-rewrite.ts`의 스캐너를 공유한다(잎 판정 규칙 1벌).
- **UUID 잎 스캔을 쓰는 이유**: 참조 종류가 늘 때마다(No.26 `apiTargets`, No.27 `surveyTargets`, E-12 슬롯 바인딩) 목록을 갱신해야 하는 구조가 K-2의 원인이다. 잎 스캔은 "번들 자산 id와 **정확히 같은** 문자열 잎"만 참조로 본다 — UUID v4가 우연히 일치할 확률은 무시할 수 있고, `connectionId`(전역 연결)·자유 텍스트는 자산 id 색인에 없어 걸리지 않는다. 종류 라벨(`edge`)이 필요한 곳만 타입 규칙을 쓴다.

### 7.2 토픽 점검 규칙 4종 — `topics/lib/topic-boundary.ts`

**토픽 키**: `topicId ?? 'common'`. **live 범위**: 공통 + 활성 토픽. **진입점 자산**: 노드·의도·FAQ(번들 필터 대상과 같은 3종).

| 코드 | 심각도 | 판정 | 대상 간선 |
|---|---|---|---|
| ① `INACTIVE_TOPIC_REFERENCE` | WARNING | 출발이 live 범위 · 도착이 **비활성 토픽의 진입점 자산** | `NODE_INTENT` · 노드→노드 4종 · `HOMONYM_INTENT` · `HANDOFF_END_BUTTON` |
| ② `CROSS_TOPIC_REFERENCE` | INFO | 출발 키 ≠ 도착 키 · 도착이 공통이 아님 · ①로 보고되지 않은 간선 | 전 간선(설문 간선 제외 — 설문은 토픽 비소속) |
| ③ `CROSS_TOPIC_DUPLICATE_EXAMPLE` | INFO | 정규화 예문 1개를 **토픽 키가 다른** 두 의도가 가짐(공통↔토픽 포함 · 같은 키끼리는 기존 저장 경고의 영역이라 제외) | — |
| ④ `NO_LIVE_ENTRY_POINT` | WARNING | 토픽이 1개 이상 있고 live 범위의 **활성 NORMAL 노드(조건 ≥1) + 활성 FAQ = 0** | `resourceType: 'CHATBOT'` |

- **토픽이 0개인 챗봇은 규칙을 실행하지 않고 빈 배열**을 돌려준다 → 설계 점검 결과 바이트 동일(AC-TP4-4).
- 각 이슈: `resourceType`/`resourceId`/`resourceName` = 출발 자산, `topicRef` = 간선·출발 토픽 이름·도착 자산·도착 토픽 이름. 메시지 예: `노드 '배송조회'(배송) → 이동 대상 '청구서류'(보험청구 · 비활성)`.
- 규칙별 **상위 50**(정렬: 출발 이름 → 도착 이름 → 간선) + `ruleTotals`(잘렸을 때만 키 존재 — EX-TP-23).
- 입력은 **필터 없는 번들**(전체 자산). 비용 O(간선 + 예문).

### 7.3 설계 점검 합성 (`dialog-nodes.service.ts` `validate()`)

```
bundle ← build(chatbotId)                              // 기존
engineReport ← validateDialogueDesign(bundle, now, ctx) // 기존 — 호출만
topics ← TopicLookupService.listForChatbot(chatbotId)   // +1 조회
if topics.length === 0 → return engineReport            // 바이트 동일
handoff ← chatbotHandoffSetting.endButtonNodeId          // +1 조회(토픽 있을 때만)
{ issues, ruleTotals } ← validateTopicBoundaries(bundle, topics, { handoffEndButtonNodeId })
return { issues: [...engineReport.issues, ...issues], summary: 재계산, checkedAt: engineReport.checkedAt, ...(ruleTotals ? { ruleTotals } : {}) }
```

### 7.4 영향 미리보기 — `GET …/topics/:topicId/impact?action=` (`topic-impact.ts`)

입력: `build()` 1회 + 토픽 목록 + 상담 종료 후 버튼 노드 + **대기 중 복원 예약 수**(`deploySchedule.count({ chatbotId, action: 'RESTORE_VERSION', status ∈ {PENDING, HELD} })`) — 쿼리 10회 고정(NFR-TPP3).

| 항목 | DISABLE(끄기) | ENABLE(켜기) |
|---|---|---|
| `alreadyInState` | 이미 비활성이면 true(나머지 0) | 이미 활성이면 true |
| `entryPoints` | 빠지는 노드·의도·FAQ 수(토픽 소속 전부 — 노드·FAQ의 개별 `enabled`와 무관하게 "번들에서 빠지는 행" 수) | 들어오는 수 |
| `brokenRefs` | **끄고 난 뒤 live 범위**에서 이 토픽 진입점으로 향하는 규칙 ① 간선(상위 20 + 총수) | 켜도 여전히 끊기는 간선: 이 토픽 노드 → **다른 비활성 토픽** 진입점 |
| `duplicateExamples` | — | 이 토픽 의도 ↔ live 범위 의도의 정규화 예문 중복(상위 20 + 총수) |
| `liveEntryPointsAfter` | 전환 후 live 진입점 수(0이면 콘솔이 규칙 ④ 경고를 함께 표시) | 동일 |
| `pendingRestoreSchedules` | 대기 중 복원 예약 수 — 참고(토글은 스냅샷 해시를 바꾸지 않는다 — §11.4) | 동일 |

- **"비활성화 전 필수"는 화면 흐름으로 강제한다**: 콘솔은 `[비활성화]` 확인 버튼을 미리보기 응답을 받은 뒤에만 활성화한다. 서버는 비활성화 요청에 미리보기 증빙을 요구하지 않는다(토글은 가역이고 자산 불변 — §25 D-7).

### 7.5 기존 경고·오류 문구 확장

| 위치 | 변경 |
|---|---|
| 의도 저장 예문 교차 충돌(FR-6-7 — 차단 아님) | `findExampleConflicts`의 입력 `OtherIntentExamples`에 `topicId`·`topicName` 추가 → 결과 `ExampleConflict.topicId?/topicName?`(상대 의도가 공통이면 없음) — AC-TP4-2 |
| 키워드 동의어 교차 충돌(`409 SYNONYM_CONFLICT` — 차단 유지) | `details[].message`에 상대 키워드 이름과 토픽 이름(`'환불사유'(토픽: 환불)`) — AC-TP4-3 |
| 이름 중복 `409 DUPLICATE_NAME`/`DUPLICATE_FAQ`(6종) | 기존 행이 토픽 소속이면 메시지에 "(토픽: 배송)"을 덧붙인다 — EX-TP-3. 기존 중복 검사의 조회에 `topic: { select: { name: true } }`만 추가(쿼리 수 불변) |

---

## 8. 토픽 단위 내보내기 / 가져오기 (FR-TP5-\* · FR-TP2-8)

- **내보내기**(의도·키워드·FAQ `GET …/export`): 쿼리 `topicIds`(목록과 같은 문법) → `where` 조건만 추가. **파일 형식 불변**(토픽 열 없음 — 다른 챗봇·기존 템플릿 호환).
- **가져오기 커밋**: `newItemTopicId?: uuid | null` → `assertTopicInChatbot` → 계획(`import-planner.ts` — **불변**)이 "신규"로 판정한 항목의 생성 데이터에만 `topicId`를 넣는다. 이름이 같은 기존 항목은 **토픽을 바꾸지 않고** 값만 합친다(AC-TP2-4). `BEFORE_IMPORT` 자동 스냅샷은 기존대로.
- **기존 벌크 임포트와의 관계**: 가져오기는 **이름 병합**(ID를 다루지 않는다)이고 분리는 **ID 재매핑**이다 — 두 경로는 코드를 공유하지 않는다. 노드·컨텍스트·동음이의어는 참조 ID를 담으므로 파일 이관을 만들지 않고 분리(§9)·병합(2차)으로 옮긴다(FR-TP5-3).

---

## 9. 토픽 → 새 챗봇 분리 (복사 · ID 재매핑 적재기) — FR-TP6-\*

### 9.1 적재기 인터페이스 — 3단계 (NFR-TPM2 · ADR-0037 §5)

```ts
// ① 캡처(서비스 · 인터랙티브 트랜잭션 안 · 순차 조회)
captureTransferSource(tx, chatbotId): Promise<TransferSource>
// TransferSource = { chatbotId, bundle: DialogueBundle(필터 없음·설문 포함), topics: TopicRow[], capturedAt }

// ② 선택·계획(순수)
selectTransferSubset(source, selection: TopicSplitSelection): TransferSubset
// TransferSubset = { ids: Record<Kind, Set<string>>, reasons: Map<id, 'SELECTED'|'CLOSURE'|'SYSTEM'>, closureItems, trimmed: Map<nodeId, DialogOutput[]>, trimmedLinks, followedSystemLinks, totals }
planTransfer(source, subset, policy: TransferPolicy): TransferPlan
// TransferPolicy = { idFactory: () => string, topicPolicy: 'COPY_SELECTED', surveyPolicy: 'DUPLICATE_DRAFT', now }
// TransferPlan = { topics[], surveys[], contexts[], intents[], keywords[], homonyms[], faqs[], nodes[], nodeIntentPairs[], nodeKeywordPairs[], remap: Map<old,new>, report }
verifyTransferPlan(plan, sourceIdSet): TransferViolation[]          // 비어 있어야 적재

// ③ 적재(서비스 · 생성 전용)
AssetTransferLoader.load(tx, targetChatbotId, plan): Promise<LoadCounts>
```

- **No.40·병합(2차)의 재사용 계약**: ①·③은 그대로 쓴다. ②에 다른 선택(환경 승격 = 전체)·다른 정책(병합 = 이름 충돌 규칙 §10 · 기존 대상과의 차이)을 넣는다. 적재기는 **대상에 같은 ID가 없음**을 전제로 하며(새 ID만 적재), 기존 행을 바꾸는 동작(병합의 "합치기")은 적재기 밖의 별도 적용기가 한다 — 이 적재기에 `update`를 추가하지 않는다(§17 T-5).
- **복원 적재기(ID 보존, `version-restore.applier.ts`)와 코드를 섞지 않는다**: 둘은 적재 규칙이 정반대다. 공유하는 것은 캡처(`build(chatbotId, tx)`)와 `normalizeText`뿐이다(§17 T-15).

### 9.2 선택과 의존 폐포 (`transfer-selection.ts`)

1. **씨앗**: `topicId ∈ selection.topicIds`인 6종 자산 + (`includeCommon`이면) `topicId = null`인 6종 자산.
2. **폐포**: 작업 목록에 씨앗을 넣고, 꺼낸 자산의 참조 대상을 추가한다 — 노드는 `intentIds`·`keywordIds`·`contextVariableId` + **아웃풋 JSON의 모든 자산 id 잎**(노드·의도·키워드·컨텍스트·설문 — 노드는 **전이적으로**), 동음이의어는 `meanings` 잎, 컨텍스트는 `slots` 잎. 의도·키워드·FAQ·설문은 나가는 참조가 없다. 고정점까지 반복(O(자산 + 간선)).
   - UUID 잎 규칙을 쓰므로 **요구사항 E-1~E-8에 없는 참조(E-12 API 슬롯 바인딩 → 컨텍스트)도 빠지지 않는다**. 폐포가 적재 재작성(§9.5)과 **같은 잎 판정**을 쓰므로 "폐포에 없는데 재작성해야 하는 id"가 구조적으로 생기지 않는다.
   - 폐포로 들어온 자산은 새 챗봇에서 **공통**이다. 동음이의어·FAQ는 무엇도 가리키지 않으므로 선택된 것만 복사된다.
3. **시스템 노드**: START·FALLBACK은 선택과 무관하게 포함한다(원본에 없으면 없음 — FR-TP6-4). 공통을 선택하지 않았으면 §9.3을 적용한다.
4. **건수·판정**: 종류별 건수 · 예문 수 · 조인 수 · `closureDominates = 폐포 추가분 > 선택분`(EX-TP-19 강조) · 상한 대비(§9.4).

### 9.3 시작·폴백 노드의 연결 처리 — TRIM(기본) / FOLLOW

**문제**: 시작 노드는 보통 모든 토픽의 메뉴 노드로 가는 버튼을 가진 **허브**다. 폐포 규칙을 그대로 적용하면 거의 모든 분리가 "챗봇 전체 복사"가 된다. **공통을 선택하지 않은 분리에서만**(`includeCommon=false`) 시스템 노드에 다음을 적용한다.

- `systemNodeLinks: 'TRIM'`(기본): 시스템 노드를 제외하고 먼저 폐포 C₀를 계산한다. 시스템 노드 아웃풋 중 **C₀ 밖 노드**를 가리키는
  - `DIALOG_MOVE` → 그 아웃풋 제거
  - `BUTTON`·`CARD`의 `NODE` 버튼 → 그 버튼 제거(`BUTTON`에 버튼이 0개 남으면: `text`가 있으면 같은 문구의 `TEXT` 아웃풋으로, 없으면 아웃풋 제거)
  - `API_CONDITION` 분기 대상·`SURVEY` 완료 후 이동 → **잘라내지 않고 따라간다**(`followedSystemLinks`로 보고 — 부분 제거가 분기 의미를 바꾸기 때문)
  - 잘라낸 결과 아웃풋이 0개가 되면 그 노드는 **자르지 않고 FOLLOW**로 처리하고 사유 `TRIM_WOULD_EMPTY`로 보고한다.
  - 시스템 노드의 조건(`intentIds` 등)·비노드 참조(컨텍스트·설문)는 정상 폐포로 따라간다.
- `systemNodeLinks: 'FOLLOW'`: 시스템 노드도 일반 자산처럼 폐포를 따라간다(요구사항 원안).
- 잘라낸 항목은 **미리보기와 결과에 전수 표시**한다(`trimmedLinks` — 노드 이름 · 종류 · 대상 이름 · 대상 토픽). 조용히 지우지 않는다. 원본은 바뀌지 않는다.
- 새 챗봇의 시작 노드가 달라졌음은 결과 화면 안내 문구로 알린다. 기본값을 TRIM으로 둔 판단은 **PM 확인 1**(보고)로 남긴다.

### 9.4 동기 상한 (FR-TP6-11 — 코드 상수 `TOPIC_SPLIT_LIMITS`)

| 종류 | 상한(복사 대상 합계 = 선택 + 폐포 + 시스템) | 근거 |
|---|---|---|
| 의도 · 예문 | 1,000 · 20,000 | 기존 성능 기준(FR-E-10) |
| 노드 | 500 | 〃 |
| FAQ | 2,000 | 〃 |
| 키워드 · 동음이의어 · 컨텍스트 | 2,000 · 1,000 · 200 | 이 설계의 기준(성능 기준 자산량의 2배 여유) |
| 설문 | 50 | 챗봇당 설문 상한 |

초과하면 미리보기 `exceeded[]`에 종류를 담고, 실행은 쓰기 전에 `422 TOPIC_SPLIT_TOO_LARGE`(details = 종류·건수·상한)로 거부한다. 전체 복사(깊은 복사)도 같은 상한을 받는다 — 초과 챗봇의 깊은 복사는 범위 밖(비동기화 트리거 — 요구사항 §9).

### 9.5 ID 재매핑 (`transfer-plan.ts` · `id-leaf-rewrite.ts` · `transfer-verify.ts`)

1. **순서 보존 ID 발급**: 종류별로 복사 대상 원본 id를 오름차순 정렬하고, 같은 수의 새 UUID를 발급해 **오름차순 정렬한 뒤 짝지운다**. 결과: 같은 종류 안에서 `원본 a.id < b.id ⇔ 새 a'.id < b'.id`. 엔진·의미 점수의 최종 동점 규칙(`id asc` — `rankNodes`·`assembleSemanticInput`)이 분리본에서도 같은 승자를 낸다.
2. **타임스탬프 보존**: 자산의 `createdAt`·`updatedAt`을 원본 값으로 명시한다 — K-1 정렬(`createdAt, id`)과 `rankNodes`(`updatedAt desc`)의 동점 규칙이 원본과 같아진다. 1·2로 **AC-TP5-6(전체 복사 후 100문장 해석 결과 동일)이 동점 경우까지 성립**한다. 새 토픽·새 설문·새 챗봇 행은 `now`.
3. **재작성**: `remap: Map<원본 id, 새 id>`(자산 6종 + 설문 + 선택 토픽). 컬럼 참조(`intentIds`·`keywordIds`·`contextVariableId`·`topicId`)는 맵으로 직접 바꾸고, JSON 필드(`outputs`·`meanings`·`slots`)는 `rewriteIdLeaves(json, remap, sourceIdSet)`로 **문자열 잎 중 원본 자산 id 집합(`sourceIdSet` — 원본 챗봇의 전 자산·설문 id)에 속한 값**만 바꾼다. 맵에 없는 원본 id 잎을 만나면 위반으로 기록한다. `connectionId`(전역)·자유 텍스트·v1 설문 키는 `sourceIdSet`에 없어 그대로 남는다(FR-TP6-5 · AC-TP5-4).
4. **토픽**: 선택 토픽 → 새 토픽(이름·설명·정렬 순서·활성 상태 원본 유지 — FR-TP6-7). 폐포 추가분·시스템 노드 → null. `includeCommon`의 공통 자산 → null.
5. **검증(`verifyTransferPlan`)**: ① 계획의 모든 JSON·컬럼에 `sourceIdSet` 원소가 **0건** ② 노드 조인·`contextVariableId`·`getOutgoingNodeRefs()` 대상·CONTEXT_FORM·설문 참조·`meanings`·`slots`가 전부 계획 안의 새 id ③ 새 id 중복 0 ④ 정규화 이름 유일(원본이 유일하므로 항상 참 — 방어) ⑤ 시스템 노드 `topicId = null`. 위반이 1건이라도 있으면 적재하지 않고 트랜잭션을 롤백한다(FR-0-135) — `500 INTERNAL_ERROR` + 서버 경고 로그(건수·규칙 코드만, 원문 0).

### 9.6 트랜잭션 · 적재 순서 (`topic-split.service.ts`)

```
preview(chatbotId, selection):                         // DB 변경 0 · 트랜잭션 없음
  assertReadable(원본) → build(chatbotId) ∥ topic.findMany → selectTransferSubset → 미리보기 응답

split(chatbotId, dto):
  assertReadable(원본)                                  // ARCHIVED 원본 허용(읽기 연산 — FR-TP6-1)
  target ← ChatbotCopyTargetService.resolve(원본, dto)  // 이름("원본명 (분리)" 파생)·slug 파생/중복·그룹(보관 그룹 404) — copy()와 같은 규칙
  $transaction(async tx => {                            // timeout·maxWait 30초 · ⚠ tx 안 Promise.all 금지(순차 await)
    source ← captureTransferSource(tx, chatbotId)       // build(chatbotId, tx) + tx.topic.findMany — 일관 캡처(EX-TP-8)
    subset ← selectTransferSubset(source, dto)
    limits 초과 → throw 422 TOPIC_SPLIT_TOO_LARGE        // 쓰기 전
    plan ← planTransfer(source, subset, { idFactory: randomUUID, … })
    verifyTransferPlan(plan) 위반 → throw               // 쓰기 전
    chatbot ← tx.chatbot.create({ …target, status: 'DRAFT', avatarUrl·description·skin: 원본 })
    AssetTransferLoader.load(tx, chatbot.id, plan)
  })
  catch P2002(slug) → 409 DUPLICATE_SLUG · isBusyError → 409 TOPIC_SPLIT_BUSY(재시도 가능)
  커밋 후: 감사 COPY 1건 → bundleService.invalidate(새 챗봇)(재색인 예약) → 새 챗봇 build + validateDialogueDesign + 토픽 규칙 → 건수 요약 → 응답 201
```

**적재 순서**(FK 충족 · 전부 `createMany` 500행 청크 · 명시 id): `topic` → `survey` → `contextVariable` → `intent` → `keyword` → `homonymDictionary` → `faqEntry` → `dialogNode` → `dialogNodeIntent` → `dialogNodeKeyword`. 정규화 컬럼은 `normalizeText()`로 다시 계산한다(원본과 같은 함수 — 같은 값).

**잠금**: SQLite 쓰기 잠금은 첫 쓰기(`chatbot.create`)부터 커밋까지다. 성능 기준 자산량 전체 복사(행 약 3,500 + 조인)는 `createMany` 20여 문장으로 수 초 이내가 기대치이며, 구현자가 실측해 기록한다(NFR-TPP4 — 그 동안 다른 편집·대화 로그 쓰기가 대기).

### 9.7 새 챗봇 행 · 설문 복제 · 비복사

- **챗봇 행**: `copy()`와 같은 규칙(이름·slug 파생·중복 검사·`DRAFT`·그룹·프로필·스킨) — 규칙은 `ChatbotCopyTargetService`로 **추출해 공유**한다(`copy()` 동작 불변 · 기존 `POST /chatbots/:id/copy`는 여전히 프로필만 — FR-TP6-13).
- **설문**: 폐포에 든 설문만(노드가 참조하는 것) — 이름 유지 · `status: 'DRAFT'` · 문항·선택지 key는 `reissueQuestionKeys()`(FR-SV2-6 재사용 — `surveys/lib/survey-keys.ts` 순수 함수 import) · `structureVersion: 1` · 응답 0 · 기간·문구·취소어·타임아웃 복사. 노드의 `surveyId`는 §9.5 재작성으로 새 id를 가리킨다(AC-TP5-4). 보관·마감 설문도 같은 규칙(EX-TP-14).
- **복사하지 않는다**(FR-TP6-9 — 응답 `notCopied`에 고정 키로 안내): 채널 · 답변 설정 · 상담 설정 · 자주 쓰는 문장 · TC 세트 · 미응답 큐 · 증강 제안 · 분류기 · 대화로그 · 버전 이력 · 예약 · 임베딩 벡터(재색인으로 생성) · 설문 응답. 개인정보가 새 챗봇으로 퍼지지 않는다(NFR-TPS4).
- **원본에는 어떤 쓰기도 없다**(분리 서비스·적재기에 원본 챗봇 id를 대상으로 한 `update`/`delete` 0 — §17 T-5/T-6). 원본 토픽을 비활성화할지는 결과 화면의 **안내 링크**로만 묻는다(FR-TP6-12).

### 9.8 결과 요약

응답에 새 챗봇 DTO · 종류별 건수 · 폐포 추가 건수 · 잘라낸 연결 수 · 복제 설문 수 · 캡처 시각 · **새 챗봇 설계 점검 요약**(error/warning/info — 커밋 후 별도 조회, 실패해도 분리는 성공) · `reindexScheduled: true` · `notCopied`. 새 챗봇은 재색인 전까지 규칙 매칭만 한다(EX-TP-21 — `DRAFT`라 공개 노출 없음).

---

## 10. 병합 (2차) — 충돌 규칙 확정 (P-9 · 문서만, 구현하지 않는다)

병합 = 원본 챗봇 S의 토픽(들)을 대상 챗봇 T에 **새 토픽**으로 가져온다. 부품: §9.1 ①(S 캡처) · ②(선택·폐포) + **병합 정책**(아래) · 새 행은 ③ 적재기 · 기존 행 갱신("합치기")은 **별도 적용기**(적재기에 `update`를 넣지 않는다).

| 자산 | 충돌 키(T 안 정규화) | 기본 동작 |
|---|---|---|
| 의도 | `nameNormalized` | **합치기** — T 의도에 S 예문 추가(정규화 중복 무시) · T 의도의 토픽 소속 불변 · S 참조는 T 의도 id로 재매핑 |
| 키워드 | `nameNormalized` | **합치기**(동의어 추가). 합친 결과가 T의 **다른 키워드 동의어와 겹치면 병합 전체 거부**(`import-planner.ts` 79~106행 규칙) |
| 노드 | `nameNormalized` | **이름 바꿔 추가** — `이름 (가져옴)`, 다시 겹치면 `(가져옴 2)`… |
| 컨텍스트 | `nameNormalized` | **이름 바꿔 추가**(슬롯 구조가 달라 진행 중 세션을 깨지 않게) |
| 동음이의어 | `wordNormalized` | **건너뛰기 + 리포트**(T 유지) · 건너뛴 항목을 가리키던 S 참조는 T 항목으로 재매핑 |
| FAQ | `questionNormalized` | **건너뛰기 + 리포트**(T 유지 · 답변이 다르면 "충돌") |
| START·FALLBACK | 종류 | 가져오지 않음(T 유지) · S의 시스템 노드를 가리키던 참조는 T의 같은 종류 노드로 재매핑 |

공통 규칙: **dry-run 미리보기 필수**(종류별 신규·합침·이름 변경·건너뜀·거부 수 + 행 단위 리포트) · **`BEFORE_MERGE` 자동 스냅샷**(`ChatbotVersionTrigger` 7번째 — 2차 착수 시 추가) · 원본 S 불변 · 병합 후 T 설계 점검 자동 실행 + `CROSS_TOPIC_DUPLICATE_EXAMPLE` 표시(TC-22 "병합 후 충돌 경고"의 실체) · 감사 = T `Chatbot` `IMPORT` 요약 1건 · 권한 = T `dialogue:write` + S `dialogue:read`. 2차 착수 시 이 절을 새 ADR(병합 적용기)의 입력으로 쓴다.

---

## 11. 스냅샷 · 복원 호환 (P-7 · FR-TP8-4/5)

### 11.1 해시 불변 증명 (AC-TP6-1)

1. `build()`는 자산 행을 `topicId: row.topicId ?? undefined`로 매핑한다 — null이면 **키는 있으나 값이 `undefined`**다(§17 T-16).
2. 캡처 봉투(`buildSnapshotEnvelope`)는 `chatbotId`·`updatedAt`만 떼고 나머지를 그대로 담는다(코드 변경 0).
3. 해시 입력 `canonicalizeSnapshot()`과 저장 문자열 `serializeEnvelopeForStorage()`는 둘 다 `sortKeysDeep()`을 거치며, 이 함수는 **값이 `undefined`인 키를 생략한다**(`snapshot-canonical.ts` 36행 — 기존 동작, No.27 `bundle.surveys` D-17 선례).
4. 항목 순서는 `byIdAsc`로 정규화되므로 K-1 정렬도 해시에 영향이 없다.
5. 따라서 모든 자산이 공통인 챗봇(= 토픽 없는 챗봇 · 도입 전 모든 챗봇)의 정규 문자열은 도입 전과 **바이트 단위로 같고** `contentHash`도 같다. 과거 스냅샷 본문에는 `topicId`가 없으므로 hydrate 결과도 공통이다 → **`SNAPSHOT_SCHEMA_VERSION = 1` 유지 · 업캐스터 불필요**.
6. 시험: 도입 전 코드로 계산해 둔 **고정 해시 골든 픽스처**(자산 6종 · 토픽 없음)를 도입 후 코드로 다시 계산해 같음을 단언한다(§21.1).
- 토픽 **이름 변경·활성 전환은 해시를 바꾸지 않는다**(정의는 스냅샷 밖). 소속 변경은 해시를 바꾼다(의도된 동작 — EX-TP-15).

### 11.2 복원 정규화 — "없는 토픽 → 공통"과 사후 검증의 충돌 해결

**문제**: 복원은 트랜잭션 끝에서 현재 상태를 다시 캡처해 **대상 스냅샷의 해시와 같은지** 검증한다(`version-restore.service.ts` 244~251행). 없는 토픽을 null로 적재하면 결과 해시가 대상 해시와 달라져 **모든 그런 복원이 롤백된다**.

**해결** — `normalizeSnapshotTopics(envelope, existingTopicIds)`(순수):
- 자산 6종의 `topicId`가 `existingTopicIds`에 없으면 제거(= 공통), START/FALLBACK 노드의 `topicId`는 무조건 제거(방어).
- 반환 `{ envelope: 정규화본, missingCount, changed }`.

복원 흐름의 변경점:
1. **트랜잭션 안**에서 `tx.topic.findMany({ where: { chatbotId }, select: { id: true } })`(순차) → 정규화.
2. `effectiveTargetHash = changed ? computeContentHash(정규화본) : versionRow.contentHash(또는 업캐스트 재계산값)`.
3. `RESTORE_NO_CHANGES` 판정·`planRestore()`·차이 요약·**사후 검증**을 전부 정규화본과 `effectiveTargetHash`로 한다.
4. applier: 생성·갱신 데이터에 `topicId: item.topicId ?? null`(두 곳). 갱신 대상 판정은 기존 `stableStringify` 비교가 `topicId` 차이를 자동으로 잡는다.
- 미리보기도 같은 정규화를 트랜잭션 없이 한다(경고 산출). 미리보기와 확정 사이에 토픽이 지워져도 확정은 트랜잭션 안의 최신 토픽 집합으로 정규화한다(TOCTOU 없음).
- **토픽 정의·활성 상태는 복원하지 않는다**(AC-TP6-2).

### 11.3 복원 미리보기 경고 2종 (blocker 아님)

| 코드 | 값 | 의미 |
|---|---|---|
| `TOPIC_MISSING` | `count` | 대상 스냅샷이 가리키는 토픽 중 지금 없는 것에 속한 자산 수 — 공통으로 들어간다 |
| `TOPIC_EXPOSURE_CHANGE` | `exposed`, `hidden` | 현재와 대상에 **모두 있는** 노드·의도·FAQ 중 복원으로 운영 노출이 바뀌는 수(비활성 토픽 → 공통/활성 = `exposed`, 반대 = `hidden`). ★ **토픽 도입 전 스냅샷을 복원하면 모든 자산이 공통으로 돌아가 비활성 토픽 자산이 운영에 노출된다** — 이 경고가 그 사실을 미리 알린다(**PM 확인 2** — 경고로 충분한지) |

두 값이 0이면 경고를 넣지 않는다(기존 미리보기 응답 바이트 동일).

### 11.4 예약 배포(No.28)와의 관계

- 토픽 **활성 전환**은 스냅샷 해시를 바꾸지 않는다 → 대기 중 예약에 영향 없음. **소속 변경**은 해시를 바꾼다 → 대기 중 복원 예약이 "상태가 바뀜"으로 보류된다(ADR-0032 엄격 바인딩 — 설계상 올바름). 콘솔이 일괄 지정 전에 예약 건수를 고지한다(§5.2).
- 없는 토픽을 가리키는 스냅샷을 **예약 복원**하면 실효 해시가 버전 해시와 달라진다. 임대 회수 판정은 `BEFORE_RESTORE` 백업 흔적이 우선이라 영향이 없고, 같은 체인의 후속 예약은 "기준 상태 불일치"로 보류된다(안전 쪽 실패 — §24 K-6). 토픽 활성화 예약은 만들지 않는다(동작 3종 불변).

---

## 12. K-1 — 번들 조회 결정적 정렬 (별도 선행 커밋)

### 12.1 결함

`build()`의 7개 `findMany`에 `orderBy`가 없다(`dialogue-bundle.service.ts` 87~102행). 엔진은 여러 곳에서 **먼저 본 것**을 동점 승자로 삼는다 — 결과가 DB가 돌려준 행 순서에 달려 있다.

### 12.2 정렬 키 결정 — `orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]` (7개 전부 · 조인 include는 불변)

| 후보 | 판정 |
|---|---|
| **`createdAt asc, id asc`** ★ | **채택** — 편집·이름 변경에 흔들리지 않는다 · 복원이 `createdAt`을 보존하므로(applier S5·S6) **복원 전후 승자 동일** · 분리가 `createdAt`과 id 순서를 보존하므로(§9.5) **분리본 승자 동일** · "먼저 만든 자산이 이긴다"는 설명 가능한 규칙 |
| `nameNormalized asc` | 기각 — 이름 변경이 승자를 바꾼다 · FAQ·동음이의어는 키가 달라 규칙이 갈린다 |
| `updatedAt` | 기각 — 편집할 때마다 승자가 바뀐다(현재 결함의 한 형태) |
| `id asc` 단독 | 기각 — UUID v4라 무작위 순서와 같다(설명 불가) |

`createdAt`이 같은 행(같은 요청의 대량 생성)은 `id asc`로 결정적이다. 조인(`intentLinks`·`keywordLinks`)의 순서는 조건 판정(OR/ALL 집합 의미)에 영향이 없어 정렬하지 않는다.

### 12.3 기존 동작에 미치는 영향

**현재 순서**: SQLite는 `ORDER BY` 없이 `WHERE chatbotId = ?`를 **플래너가 고른 인덱스 순서**로 돌려준다 — 의도·키워드·컨텍스트·노드는 `(chatbotId, nameNormalized)` 유일 인덱스(이름순)나 `(chatbotId, updatedAt)`·`(chatbotId, priority)`(수정순·우선순위순) 중 하나다. 어느 것인지는 통계·버전에 따라 달라지며, 수정순이면 **편집이 동점 승자를 바꾼다**. 구현자는 ① 커밋 전에 7개 쿼리의 `EXPLAIN QUERY PLAN`을 기록해 현재 순서를 문서화한다.

| 순서 의존 지점 | 영향 |
|---|---|
| `matchIntent`(정확·부분 일치 동점 — 인덱스 `examplePartial` 순서 = 번들 의도 순서) | **바뀔 수 있다** — 두 의도에 같은 예문이 있거나 부분 일치 길이가 같을 때 |
| `matchFaqEntry`(동점 FAQ) · `suggestSimilarFaqs`(안정 정렬 동점) | **바뀔 수 있다** — 부분 일치 길이가 같은 두 FAQ |
| 동음이의어·컨텍스트 순회 · 설계 점검 이슈 순서 · 흐름 트리 표시 순서 · 상담 힌트 동점 | 표시·동점만 영향 |
| `rankNodes`(노드 — `id asc` 최종) · 의미 순위(`id asc` 최종) · 설문 조회(id) · 스냅샷 해시(`byIdAsc`) · 버전 차이 | **영향 없음** |

즉 동작 변화는 **동점일 때만** 생기며, 변화 후에는 동점 승자가 **결정적**이 된다. 운영 영향 확인은 §21.3 절차로 한다.

### 12.4 시험

- 단위: 7개 `findMany` 호출 인자에 같은 `orderBy`가 있음(Prisma 목 — tx·비tx 두 경로).
- 통합: ① 같은 예문을 가진 의도 A(먼저 생성)·B(나중 생성) → A를 수정해 `updatedAt`을 올려도 A가 답한다 ② 버전 캡처 → B 삭제·재생성 → 복원 → A가 답한다 ③ 부분 일치 길이가 같은 FAQ 2건에서 먼저 생성된 쪽이 답한다.

---

## 13. K-2 — 노드→노드 참조 추출 두 벌: **이번에는 합치지 않고 동등성으로 고정한다**

| 선택지 | 판정 |
|---|---|
| 저장 검증이 `getOutgoingNodeRefs()`를 호출 | 기각 — 저장 검증은 **어느 아웃풋의 어느 필드인지(zod 경로)**를 오류 상세로 돌려준다(No.26 M2-2). 엔진 함수는 id만 돌려준다 |
| 엔진 함수에 위치 정보 반환 추가 | 기각 — 이 그룹은 엔진 수정 0(FR-0-129) |
| **현 상태 유지 + 동등성 시험** ★ | **채택** |

- 저장 검증의 노드 참조 수집(`dialog-nodes.service.ts` 131~161행)을 **동작 변경 없이** `dialog-nodes/lib/node-target-refs.ts`의 `collectNodeTargetRefs(outputs): Array<{ id, field }>`로 추출한다.
- **동등성 시험**(`node-target-refs.parity.spec.ts`): 모든 아웃풋 유형(v1·v2 포함) 픽스처에서 `set(collectNodeTargetRefs(o).map(id)) === set(getOutgoingNodeRefs(node) 4종 합집합)`. 새 참조 종류를 한쪽에만 추가하면 CI가 잡는다.
- 이 그룹의 신규 코드는 노드 참조를 `getOutgoingNodeRefs()`(라벨)와 UUID 잎(폐포·재작성)으로만 본다 — **세 번째 타입 목록을 만들지 않는다**.
- **단일화 트리거**: 다음에 엔진을 닫힌 목록으로 수정하는 그룹이 `getOutgoingNodeRefs()`에 위치 정보를 추가할 때 저장 검증을 그 함수로 옮긴다(ADR-0005 갱신 각주).
- 참조 종류 추가 체크리스트(NFR-TPM4 — 개발명세서 §3.1에 기록): ① 저장 검증(`node-target-refs.ts` 또는 서비스) ② `getOutgoingNodeRefs()` ③ 삭제 사전검사(`reference-check.service.ts`) ④ 스냅샷 무결성(`snapshot-integrity.ts`) ⑤ 토픽 간선 라벨(`asset-ref-graph.ts` — UUID 잎이면 자동 포함, 라벨만 추가). 분리·병합의 재작성은 UUID 잎 규칙이라 **갱신 불필요**.

---

## 14. 권한 (P-10 — 신규 권한 0 · 신규 역할 0)

| 동작 | 권한 | VIEWER | EDITOR | AGENT | ADMIN |
|---|---|---|---|---|---|
| 토픽 목록 · 영향 미리보기 · 목록 필터 · 설계 점검 결과 | `dialogue:read` | ○ | ○ | ✕ | ○ |
| 토픽 생성·수정·이동·활성 전환·삭제 · 일괄/단건 소속 지정 | `dialogue:write` | ✕ | ○ | ✕ | ○ |
| 분리 미리보기 · 분리 실행 | `dialogue:read` **AND** `chatbot:write`(`@RequirePermission` 복수 인자) | ✕ | ○ | ✕ | ○ |
| 시뮬레이터 "비활성 토픽 포함" | 기존 시뮬레이터 권한 | 기존과 같음 | 기존과 같음 | 기존과 같음 | 기존과 같음 |

- 분리의 대상 그룹에 대한 별도 권한은 없다(기존 `copy()`와 같다). 부서 담당자만 자기 토픽을 편집하게 하는 제한은 만들지 않는다(No.45 — T-4).
- `ARCHIVED` 챗봇: 토픽 조회·영향 미리보기·**분리(원본 읽기)**는 허용, 토픽 쓰기·소속 지정은 `409 CHATBOT_ARCHIVED`(EX-TP-17).

---

## 15. 감사 (P-11 — `AuditTargetType` 20 → 21 · `AuditAction` 추가 0)

| 동작 | 기록 |
|---|---|
| 토픽 생성 · 이름/설명 · 순서 · 삭제 | `Topic` `CREATE`·`UPDATE`(순서는 summary "순서 변경")·`DELETE` — `AUDIT_FIELDS.Topic = ['name','description','sortOrder','enabled']` |
| 활성 전환 | `Topic` `STATUS_CHANGE`(summary "활성화"｜"비활성화") — 상태가 바뀐 경우만 |
| 자산 1건 소속 변경(폼) | 해당 자산 기존 `UPDATE` — 자산 6종 `AUDIT_FIELDS`에 `'topicId'` 추가. **서비스는 `topicId`가 null이면 스냅샷 입력에 넣지 않는다** → 토픽 없는 챗봇의 감사 본문 불변 |
| 일괄 지정 | 대상 토픽(`Topic` · 공통이면 `Chatbot`)에 `UPDATE` **요약 1건** — before/after 없음, summary만 `"토픽 지정(의도) 42건 — 대상: 배송"`(건수·종류·토픽 이름, 자산 이름 목록·원문 0) |
| 공통으로 옮기고 삭제 | `Topic UPDATE` 요약 1건 + `Topic DELETE` 1건(AC-TP1-4) |
| 분리 | 새 `Chatbot`에 기존 **`COPY`** 1건 — `after` = 챗봇 행(기존 `copy()`와 같음), summary `"토픽 분리 — 원본 <id 앞 8자> · 토픽 n · 의도 n·노드 n·FAQ n… · 동반 n · 잘라낸 연결 n"`. 원본에는 감사 없음(변경 없음) |

일괄 지정·분리의 요약을 `after` 객체가 아니라 **summary 문자열**에 담는다 — 요약 액션 분기(`BULK_DELETE`·`IMPORT`·`RESTORE`)를 늘리지 않고, 화이트리스트를 우회하지 않는다.

---

## 16. API 계약

### 16.1 신규 엔드포인트 (관리자 11 · 공개 0)

| # | 메서드 | 경로 | 권한 | 요청 → 응답 | 오류 |
|---|---|---|---|---|---|
| ① | GET | `/chatbots/:chatbotId/topics` | `dialogue:read` | → `TopicListResponse` | `404` |
| ② | POST | `…/topics` | `dialogue:write` | `CreateTopic` → `201 Topic` | `409 DUPLICATE_NAME`·`LIMIT_EXCEEDED`·`CHATBOT_ARCHIVED` |
| ③ | POST | `…/topics/split/preview` | `dialogue:read`+`chatbot:write` | `TopicSplitSelection` → `TopicSplitPreview`(DB 변경 0) | `404`(원본·토픽) · `400` |
| ④ | POST | `…/topics/split` | `dialogue:read`+`chatbot:write` | `TopicSplitRequest` → `201 TopicSplitResult` | `422 TOPIC_SPLIT_TOO_LARGE` · `409 DUPLICATE_SLUG`·`TOPIC_SPLIT_BUSY` · `404`(토픽·보관 그룹) |
| ⑤ | PATCH | `…/topics/:topicId` | `dialogue:write` | `UpdateTopic` → `Topic` | 위 + `404` |
| ⑥ | DELETE | `…/topics/:topicId?moveToCommon=` | `dialogue:write` | → `204` | `409 TOPIC_NOT_EMPTY` · `404` |
| ⑦ | POST | `…/topics/:topicId/move` | `dialogue:write` | `MoveTopic` → `{ items: Topic[] }` | `404` |
| ⑧ | GET | `…/topics/:topicId/impact?action=` | `dialogue:read` | → `TopicImpactPreview` | `404` |
| ⑨ | POST | `…/topics/:topicId/enable` | `dialogue:write` | `{}` → `Topic` | `404`·`409 CHATBOT_ARCHIVED` |
| ⑩ | POST | `…/topics/:topicId/disable` | `dialogue:write` | `{}` → `Topic` | 〃 |
| ⑪ | POST | `/chatbots/:chatbotId/topic-assignments` | `dialogue:write` | `TopicAssignRequest` → `TopicAssignResult` | `400 VALIDATION_FAILED`(1,001건 등)·`TOPIC_SYSTEM_NODE_LOCKED` · `404 INVALID_REFERENCE` |

- **선언 순서**: `TopicsController`는 정적 세그먼트 `split/preview`·`split`을 `:topicId` 핸들러보다 **먼저** 선언한다.
- 요구사항 초안 대비: `POST …/topics/reorder` → **`POST …/topics/:topicId/move`**(위/아래 버튼 — 자주 쓰는 문장 선례) · `POST …/impact-preview` → **`GET …/impact?action=`**(읽기 연산) — §25 D-8.

### 16.2 기존 경로 확장

| 경로 | 변경 |
|---|---|
| 자산 6종 `GET` 목록 | 쿼리 `topicIds` · 행 `topicId` |
| 자산 6종 `POST`·`PATCH` | 본문 `topicId`(검증 · 노드 시스템 잠금 · topicId만 바뀌면 `updatedAt` 보존) · 상세 응답 `topicId?` |
| 의도·키워드·FAQ `GET …/export` | 쿼리 `topicIds` |
| 의도·키워드·FAQ `POST …/import/commit` | 본문 `newItemTopicId` |
| `POST …/dialog-nodes/validate` | 토픽 규칙 4종 합성 · `ruleTotals?` |
| `POST …/dialog-nodes/:id/copy` | 복사본이 원본 `topicId` 승계 |
| `POST …/simulate` · `…/simulate/compare` | 요청 `includeInactiveTopics` · 응답 `answeredTopic?` |
| 미응답 큐 목록·상세 | `suggestedIntents[].topicId?` |
| `POST …/versions/:versionId/restore/preview` | 경고 `TOPIC_MISSING`·`TOPIC_EXPOSURE_CHANGE` |
| `POST /chatbots/:chatbotId/permanent-delete` | 사전검사 14종(`토픽`) |
| **공개 경로** | **변경 없음**(`@Public()` 7 유지) |

### 16.3 오류 코드 (`ApiErrorCode` 신규 4종)

| 코드 | 상태 | 쓰임 |
|---|---|---|
| `TOPIC_NOT_EMPTY` | 409 | 소속 자산이 있는 토픽 삭제(`details` = 종류별 건수) · FK 경합(`P2003`) |
| `TOPIC_SYSTEM_NODE_LOCKED` | 400 | START/FALLBACK 노드에 토픽 지정(단건·일괄·유형 변경) |
| `TOPIC_SPLIT_TOO_LARGE` | 422 | 분리 동기 상한 초과(`details` = 종류·건수·상한) — `VERSION_SNAPSHOT_TOO_LARGE`(422)와 같은 분류 |
| **`TOPIC_SPLIT_BUSY`**(요구사항 대비 추가) | 409 | 분리 트랜잭션의 쓰기 경합(`SQLITE_BUSY`·Postgres 직렬화 실패) — 재시도 가능 |

재사용(요구사항 초안의 신규 2종 대체): 토픽 이름 중복 `DUPLICATE_NAME`(409) · 챗봇당 50 초과 `LIMIT_EXCEEDED`(409) — 설문·자주 쓰는 문장과 같은 코드로 프런트 분기를 늘리지 않는다(§25 D-9). 그 밖에 `INVALID_REFERENCE`(없는·다른 챗봇 토픽) · `VALIDATION_FAILED`(일괄 1,001건·빈 선택) · `CHATBOT_ARCHIVED` · `DUPLICATE_SLUG` · `NOT_FOUND`(보관 그룹) · `INTERNAL_ERROR`(재매핑 검증 위반). 오류 봉투 형식 불변.

---

## 17. 봉인 · 정적 검사 — `apps/api/src/topics/lib/topic-sealing.spec.ts`

검사 대상: `apps/api/src/**/*.ts`(`*.spec.ts`·`src/integration/**` 제외, 주석 제거) + `packages/dialogue-engine/src/**` + `schema.prisma` + (런타임) shared-types. 탐지어는 조각 조립. **역검증 픽스처 포함**.

| # | 단언 | 막는 것 |
|---|---|---|
| T-1 | `packages/dialogue-engine/src`에 `topic`(대소문자 무관) 심볼 0 | 엔진 수정(FR-0-129) |
| T-2 | `excludeInactiveTopics` 식별자 등장 파일 = `dialogue-common/dialogue-bundle.service.ts` 1개 · 그 안에서 `excludeInactiveTopics: true` 리터럴은 `getCached` 메서드 블록에만 | 필터가 다른 경로로 확산(NFR-TPM3) |
| T-3 | `versions/**`·`asset-transfer/**`·`topics/**`·`dialog-nodes/**`에 `getCached(`·`getCachedUnfiltered(` 0 | 캡처·분리·점검이 필터된 번들을 봄(FR-0-131) |
| T-4 | `getCachedUnfiltered(` 호출 파일 = `simulation/simulation.service.ts` 1개 | 비필터 번들이 운영 경로로 |
| T-5 | `asset-transfer/**`의 Prisma 호출은 `create｜createMany`와 조회만 — `update｜updateMany｜upsert｜delete｜deleteMany｜$executeRaw｜$queryRaw` 0 | 적재기가 기존 행을 바꿈(FR-0-135) |
| T-6 | `topics/topic-split.service.ts`에 `.update(｜.updateMany(｜.delete(｜.deleteMany(｜.upsert(` 0 | 원본 변경 |
| T-7 | 자산 6모델의 `updateMany` 호출 중 `data`에 `topicId`가 있는 호출은 `topics/topic-assignment.service.ts`에만 있고, 그 파일의 모든 `data:` 객체 키 ⊆ `{topicId, updatedAt}` | 일괄 지정이 내용을 바꿈(FR-TP2-6) |
| T-8 | `topic.(create｜createMany｜update｜updateMany｜delete｜deleteMany｜upsert)` 호출 파일 ⊆ {`topics/topics.service.ts`, `asset-transfer/asset-transfer.loader.ts`} | 토픽 쓰기 확산 |
| T-9 | `@Public()` 총 7 · `topics/**`·`asset-transfer/**`에 0 | 공개 표면(FR-0-132) |
| T-10 | `Permission.options.length === 17` · `topic:` 접두 권한 문자열 0 · `AuditAction.options.length === 14` | 신규 권한·동작(FR-0-132) |
| T-11 | `schema.prisma`: `Topic`의 관계 `onDelete: Restrict` · 자산 6모델에 `topicId String?` + `onDelete: Restrict` + `@@index([topicId])` · `ConversationLog.topicId String?`에 `@relation` 없음 · `ConversationLog`의 어떤 `@@index`에도 `topicId` 없음 | 스키마 계약 |
| T-12 | `conversation/conversation-log.service.ts`의 `create.data`에 `topicId` 키 존재(쓰기 1곳 — R-9/R-10이 나머지 보증) | P-12 누락 |
| T-13 | (런타임) 공개 응답·위젯 스키마(`conversation.ts`의 `Public*`·`*Poll*` 스키마 전수)의 재귀 키 집합에 `topic` 부분 문자열 0 | 공개 응답 노출(NFR-TPS1) |
| T-14 | `topics/**`·`asset-transfer/**`의 `$transaction(async (tx) =>` 콜백 안 `Promise.all` 0(`version-sealing.spec.ts` V-10 헬퍼 재사용) | 단일 커넥션 병렬 발행 |
| T-15 | `asset-transfer/**`에 `versions/restore`·`VersionRestoreApplier` import 0 · `versions/**`에 `asset-transfer` import 0 | 두 적재기 코드 혼합(NFR-TPM2) |
| T-16 | `dialogue-bundle.service.ts`에 `topicId: row.topicId ?? undefined` 정확히 6회 · `topicId: row.topicId ?? null` 0회 | null 직렬화로 해시 변경(AC-TP6-1) — 최종 보증은 골든 해시 시험 |

기존 검사 갱신은 §21.2 닫힌 목록을 따른다.

---

## 18. 성능 예산 (NFR-TPP)

| 대상 | 목표 · 내역 |
|---|---|
| 토픽 없는 챗봇 공개 대화 | **P95 500ms 불변** · 캐시 적중 시 추가 조회 0 · 응답 바이트 동일. 캐시 미스 시 토픽 조회 +1(기존 7개와 **병렬**) |
| 토픽 있는 챗봇 공개 대화 | 캐시 미스 시 +1 병렬 조회 + 필터 O(n) **5ms 이내**(의도 1,000·노드 500·FAQ 2,000) · 캐시 적중 시 0 · 해석 P95 200ms(AC-E-12) 유지 |
| 토픽 목록 | **P95 300ms**(토픽 50 · 성능 기준 자산량) · 쿼리 8 고정(`build` 7 + 토픽 1 — 토픽 수와 무관) · 요약 순수 계산 20ms |
| 영향 미리보기 | **P95 1초** · 쿼리 10 고정 |
| 설계 점검 토픽 규칙 추가분 | **P95 +300ms 이내** · 토픽 없으면 +1 조회만 |
| 일괄 지정 1,000건 | **P95 2초** · 한 트랜잭션 · `updateMany` 수 = `updatedAt` 서로 다른 값 수(대량 생성분은 소수로 묶인다) |
| 분리 미리보기 | **P95 3초** · 쓰기 0 |
| 분리 실행 | **P95 15초**(상한 이하) · 트랜잭션 1 · 쓰기 잠금 구간 = 챗봇 생성 ~ 커밋(`createMany` 청크 500) · 구현자가 잠금 시간 실측·기록 |
| 시뮬레이터 비활성 포함 | 비필터 캐시 적중 시 기존과 같음 · 미스 시 조립 + 인덱스 1회 |
| 목록 6화면 | P95 300ms 불변 · 쿼리 수 불변 |
| 마이그레이션 | 자산 6테이블 재정의 소요 실측(API 중지) · `conversation_logs`는 `ADD COLUMN`만 |

---

## 19. 다른 기능과의 경계

- **시뮬레이터·비교(No.10)**: 기본 = 운영 번들 · "비활성 토픽 포함" 토글(§6.5) · 로그 0(기존).
- **TC·학습영향도(No.19/20)**: 운영 번들 그대로 · 토글·토픽 필터 없음 · 비활성 토픽 대상 기대값은 실패로 보고(EX-TP-20).
- **의미 매칭(No.18)**: 번들 기준 자동 일관 · 재색인 0 · 분리된 챗봇만 재색인.
- **미응답 큐·증강(No.15/16/23)**: 추천 의도에 `topicId`(콘솔이 이름·"비활성" 배지 표시) · 비활성 토픽 의도를 추천에서 빼지 않는다(FR-TP8-6). 증강 제안 화면은 대상 의도의 토픽을 표시(콘솔 — 의도 상세의 `topicId`).
- **버전(No.25)**: `topicId` 선택 필드 · 정규화 복원 · 경고 2종 · 토글·일괄 지정 자동 스냅샷 없음 · 버전 차이는 기존 필드 차이로 `topicId` 변경을 보여 준다(콘솔 라벨 "토픽", 값은 현재 토픽 이름으로 해석·없으면 "삭제된 토픽").
- **예약 배포(No.28)**: 동작 추가 0 · 소속 변경의 해시 영향 고지(§11.4).
- **레거시 API(No.26)**: 분리 시 `connectionId` 유지 · API 슬롯 바인딩의 컨텍스트 참조는 폐포·재작성 대상(E-12).
- **설문(No.27)**: 토픽 비소속 · 분리 시 참조 설문만 정의 복제(DRAFT).
- **상담(No.24)**: 힌트는 `getCached` 번들 → 비활성 토픽 FAQ·의도 자동 제외 · 종료 후 버튼 노드는 영향 미리보기·점검 규칙 ① 대상 · 상담 설정은 분리 시 복사하지 않음.
- **통계(No.14/29)**: 화면 변경 0 · `ConversationLog.topicId` 적재만.
- **챗봇 복사(No.1)**: `POST …/copy` 불변(프로필만) · 깊은 복사는 분리의 "전체 토픽 + 공통"(EX-TP-22 — 복사 대화상자에 안내).

---

## 20. 관리자 콘솔 (ui-designer / frontend-implementer 인계)

- **대화설계 서브내비 8번째 "토픽"**(`/chatbots/:id/dialogue/topics` — 새 최상위 라우트 0): 표(맨 위 고정 행 "공통" + 토픽 행: 이름 · 활성 **텍스트 배지** · 자산 수 6종 · 교차 참조 나감/들어옴 · 위/아래 버튼 · 이름 변경 · 활성 전환 · 삭제 · 분리). 색 점은 보조(NFR-TPA1). 50개 상한 안내.
- **활성 전환 대화상자**: 영향 미리보기(⑧) 로딩 → 건수 문장("노드 12 · 의도 9 · FAQ 30이 운영 응답에서 빠집니다") + 끊기는 참조 **표**(출발 · 토픽 · 간선 · 도착 · 편집 링크) + 활성화 시 예문 중복 표 + live 진입점 0 경고 · **확인 버튼은 미리보기 수신 후에만 활성** · 다중 인스턴스 60초 반영 고지 · 포커스 트랩·복귀.
- **삭제 대화상자**: 비었으면 즉시 · 아니면 종류별 건수 + `[공통으로 옮기고 삭제]`(NFR-TPA5 문구).
- **목록 6화면**: 상단 토픽 필터(기존 `MultiSelectDropdown` 규약 — 전체/공통/토픽 n, URL 쿼리 유지, 삭제된 토픽 칩) · "토픽" 열(텍스트) · 행 선택 → `[토픽 지정]`(대상 선택 · 비활성 대상 경고 · 대기 복원 예약 고지 · 결과 `aria-live="polite"` 1회) · 노드 목록 "다른 토픽 참조 n" 배지.
- **자산 폼**: 토픽 선택(기본 = 현재 필터의 단일 토픽 또는 공통) · START/FALLBACK 노드는 비활성 + 사유 텍스트("시작·폴백 노드는 항상 공통입니다").
- **설계 점검 패널**: 토픽 규칙 4종을 기존 목록에 합쳐 표시(출발 → 도착 · 토픽 이름 · 편집 링크 · 잘린 경우 "외 n건").
- **분리 마법사**(토픽 화면 `[새 챗봇으로 분리]` — 4단계 대화상자): ① 토픽 선택(다중 · 공통 포함 체크 · 시작·폴백 연결 처리 라디오 "잘라내기(권장)/함께 복사") ② 미리보기(선택·동반·시스템 노드·잘라낼 연결 표·설문 복제·API 연결 유지·비복사 목록·상한 초과 강조·동반 > 선택 강조) ③ 이름·slug·그룹 ④ 결과(새 챗봇 링크 · 설계 점검 요약 · 재색인 진행 중 · 비복사 안내 · **원본 토픽 비활성화 안내 링크**). 키보드만으로 진행 가능.
- **시뮬레이터**: `비활성 토픽 포함` 체크박스(기본 꺼짐) · 결과 패널에 "토픽: 보험청구(비활성)" 텍스트.
- **가져오기 대화상자**: "신규 항목의 토픽" 선택(기본 공통) · 내보내기는 현재 필터를 따른다는 안내.
- **복원 미리보기**: 경고 2종 문구(특히 `TOPIC_EXPOSURE_CHANGE` — "복원하면 준비 중 토픽의 자산 n건이 운영에 노출됩니다").
- **미응답 큐 추천 의도**: 토픽 이름 + "비활성" 배지.
- ⚠ ROCHA 매뉴얼 `토픽` 메뉴 직접 확인(요구사항 조사 한계)은 ui-designer 인계 그대로.

---

## 21. 시험 설계 포인트 (test-automation 인계)

### 21.1 층별 핵심

| 층 | 대상 | 핵심 |
|---|---|---|
| 순수 | `topic-bundle-filter` | 비활성 0개 → 동일 객체 반환 · 노드·의도·FAQ만 제거 · 키워드·컨텍스트·동음이의어·설문 유지 |
| 순수 | `asset-ref-graph` | 간선 13종 전 행 · UUID 잎이 `connectionId`·자유 텍스트를 잡지 않음 · E-12(API 슬롯 바인딩) 검출 · 결정적 순서 |
| 순수 | `topic-boundary` | ★ AC-TP4-1 · 토픽 0개 → 빈 배열 · 규칙별 50 + `ruleTotals` · ③의 공통↔토픽 포함/같은 키 제외 · ④ live 진입점 0 |
| 순수 | `topic-impact` | 끄기/켜기 · 이미 그 상태 · 끊기는 참조 상위 20 · 예문 중복 · E-9 |
| 순수 | `transfer-selection` · `system-node-trim` | ★ AC-TP5-1 건수 · 전이 폐포 · E-12 동반 · TRIM 규칙 4종(`TEXT` 전환 · API/설문 FOLLOW · 빈 결과 FOLLOW) · FOLLOW 옵션 · `closureDominates` · 상한 판정 |
| 순수 | `transfer-plan` · `id-leaf-rewrite` · `transfer-verify` | ★ 순서 보존 발급(`a<b ⇔ a'<b'`) · 원본 id 잔존 0 · `connectionId` 유지 · 누락 잎 → 위반 · 결정적(같은 idFactory 시퀀스 → 같은 계획) |
| 순수 | `snapshot-topic-normalize` | 없는 토픽 → 제거 · 시스템 노드 → 제거 · `changed` 판정 · ★ **골든 해시**(도입 전 코드로 계산한 토픽 없는 봉투 해시 = 도입 후 해시) |
| 순수 | `resolveAnsweredTopicId` | 노드 → FAQ → 의도 · 첫 매칭이 공통이면 null · 미응답 null |
| 순수 | `node-target-refs.parity` | K-2 동등성(모든 아웃풋 유형 v1·v2) |
| 통합 | 회귀 | ★ **AC-TP1-1 토픽 없는 챗봇 — 공개 응답·시뮬레이터·TC 결과·설계 점검·버전 해시·감사 본문이 ① 적용 후 기준선과 바이트 동일, 공개 경로 캐시 적중 시 조회 수 동일**(Prisma `$on('query')` 계수) |
| 통합 | 비활성 효과 | ★ AC-TP3-1(폴백) · ★ AC-TP3-2(의미 되묻기 후보 제외 — 목 임베딩) · AC-TP3-3(키워드 유지) · AC-TP3-4(`BROKEN_REFERENCE`) · ★ AC-TP3-5(캡처 전체) · AC-TP3-6(시뮬레이터 토글·운영 캐시 오염 0) · AC-TP3-7(같은 인스턴스 즉시) · AC-TP3-8(힌트) |
| 통합 | 소속 지정 | AC-TP2-1(내용 바이트 동일 · **`updatedAt` 불변**) · AC-TP2-2 · AC-TP2-3(쿼리 수 동일) · AC-TP2-4 · 노드 단건 `topicId`만 변경 시 `updatedAt` 불변 → 동점 노드 승자 불변 |
| 통합 | 분리 | ★ AC-TP5-2(원본 id 0 · 새 챗봇 `BROKEN_REFERENCE` 0) · ★ AC-TP5-3(원본 해시·행 바이트 동일) · AC-TP5-4 · AC-TP5-5(적재 중 예외 주입 → 새 챗봇 행 포함 0) · ★ AC-TP5-6(전체 복사 후 100문장 — **동점 케이스 포함 픽스처**로 답한 자산 이름 동일) · AC-TP5-7~9 · 동시 분리 2건 → 독립 챗봇 2개 · slug 경합 → `409 DUPLICATE_SLUG` |
| 통합 | 버전 | ★ AC-TP6-1 · AC-TP6-2(`TOPIC_MISSING` · 사후 검증 통과) · 토픽 도입 전 스냅샷 복원 → `TOPIC_EXPOSURE_CHANGE.exposed > 0` · AC-TP6-3 |
| 통합 | 로그·삭제 | AC-TP6-4(`topicId` 당시 값 · 이동 후 불변) · AC-TP6-5(14종) · 토픽 FK 경합 → `409 TOPIC_NOT_EMPTY` |
| 통합 | 권한·봉인 | AC-TP7-1 · `topic-sealing.spec.ts` T-1~T-16(AC-TP7-2) · AC-TP7-4(공개 응답·위젯 네트워크에 토픽 0) |
| E2E/접근성 | 콘솔 | AC-TP7-3(axe 대비 0 · 키보드만으로 토픽 생성 → 일괄 지정 → 비활성화 → 분리) |
| 성능 | — | §18 표(토픽 목록 300ms · 영향 1초 · 일괄 2초 · 분리 3초/15초 · 잠금 시간) |

### 21.2 ★ 의도된 기존 시험 기대값 변경 (닫힌 목록 — FR-0-136 확정)

| # | 파일 | 변경 | 근거 |
|---|---|---|---|
| X-1 | `apps/api/src/augmentation/lib/asset-write-sealing.spec.ts` S-1 | 쓰기 패턴에 `createMany` 추가(`(create\|createMany\|update\|updateMany\|upsert)`) · 허용 파일 **3 → 5**(`topics/topic-assignment.service.ts` · `asset-transfer/asset-transfer.loader.ts` 추가) · `it.each` 제목·가드 `it` 제목("정확히 3개" → "정확히 5개")·가드 단언 2줄 추가 · 주석에 No.22 사유 | ADR-0025 갱신 각주(패치 B-6) |
| X-2 | `apps/api/src/chatbots/chatbots.service.spec.ts` | Prisma 목에 `topic: { count: jest.fn().mockResolvedValue(0) }` 추가 · 머리 주석 "(11 → 13종)" 문단에 "[No.22] 13 → 14종(`topics`)" 추가 — **단언 변경 0** | FR-TP8-8 |
| X-3 | `apps/api/src/common/auth/public-decorator-count.spec.ts` | 전수 스캔 목록에 `TopicsController`·`TopicAssignmentsController` import·추가 · `it` 제목 "등록된 32개 컨트롤러" → "34개" — **`@Public()` 총 7 단언 불변** | §16.1 |

- **추가 단언(기존 기대값 변경 아님)**: `version-sealing.spec.ts` V-10 헬퍼를 T-14가 재사용(헬퍼 export만 — 단언 변경 0이 가능하면 복제 대신 import).
- **전수 확인 결과 변경 불필요**: `hybrid-cs-hardening.integration.spec.ts`의 "사전검사 13종" 문구는 `it` 제목이며 단언은 메시지 부분 일치라 불변 · `handoff-sealing.spec.ts` H-8·`stats-retention-sealing.spec.ts` R-6(사전검사 블록에 특정 키 존재 확인)은 키 추가에 무영향 · `version-sealing.spec.ts` V-1~V-3(versions/** 쓰기 대상)은 applier가 기존 테이블에 필드 1개를 더 쓸 뿐이라 불변 · `learning-apply-invalidate-callsite.spec.ts`는 `learning/`만 스캔 · `public-conversation.service.spec.ts`는 생성자 인자 추가 0이라 불변 · `snapshot-canonical.spec.ts`·`restore-plan.spec.ts`는 `topicId` 없는 픽스처라 불변 · `Permission`/`AuditAction`/`ApiErrorCode`/`DesignIssueCode` 개수 단언 0건(`AuditTargetType`도 0건) · 웹 서브내비 항목 수 단언 0건.
- **K-1 커밋(①)의 닫힌 목록은 비어 있다.** ①에서 기존 시험이 깨지면 **즉시 멈추고** 그 시험이 동점 순서에 의존했는지 분석해 architect에 보고한다(조용히 기대값을 고치지 않는다).
- **그 밖의 기존 시험이 깨지면 회귀**로 취급한다.

### 21.3 K-1 TC 회귀 절차 (① 커밋 전후)

1. ① 적용 **전** 코드로 데모 seed 챗봇 + 시험 픽스처 챗봇(동점 예문·동점 부분 일치 FAQ 포함)에 기존 TC 세트를 실행해 `TestRun` A를 남긴다(의미 매칭 켠 것·끈 것 각 1회).
2. ①을 적용하고 같은 세트를 다시 실행해 `TestRun` B를 남긴다.
3. 기존 `GET …/test-runs/compare?baseRunId=A&targetRunId=B`로 차이를 뽑는다 — **차이가 난 TC는 전부 동점 케이스여야 한다**(예문 중복·동일 길이 부분 일치). 그 목록과 `EXPLAIN QUERY PLAN` 기록을 커밋 메시지·시험 보고에 남긴다.
4. 동점이 아닌 차이가 1건이라도 있으면 ①을 되돌리고 architect에 보고한다.
5. 운영 데이터가 있는 설치본은 배포 전에 같은 절차를 운영 챗봇 TC로 반복하도록 `docs/05-ops/자동배포.md`에 적는다(deployment-engineer 인계).

---

## 22. 요구사항 추적표

| 요구사항 | 설계 위치 |
|---|---|
| T-1 · T-4 · T-7 · P-14 | §23 · 패치 E |
| T-2 · T-3 · J-1 · P-1 | §5~§9 · §10 |
| T-5 | §23(트리거 미발동) |
| T-6 · T-9 · T-10 · J-10 · P-8 · FR-TP6-\* · AC-TP5-\* | §9 · ADR-0037 §5 |
| T-8 · J-5 · P-5 · FR-TP4-4 · AC-TP4-2/3 | §7.5 · §10 |
| J-2 · P-2 · FR-TP1-\* · FR-TP2-1~3 · AC-TP1-3~5 | §3.1 · §5.1 · §5.2 · §5.4 |
| J-3 · P-3 · FR-TP4-1~3/5 · AC-TP4-1/4 | §7.1~§7.3 · §5.3 |
| J-4 · P-4 · FR-0-129/131 · FR-TP3-1~6/8 · AC-TP3-1~5/7/8 | §2.3 · §6 · §17 T-1~T-4 |
| FR-TP3-3 · AC-TP3-4 · EX-TP-9/10 | §7.4 |
| J-6 · P-6 · FR-TP2-4~8 · AC-TP2-\* | §5.2 · §5.3 · §8 · §20 |
| J-7 · P-10 · NFR-TPS2 · AC-TP5-8 · AC-TP7-1 | §14 |
| J-8 · P-11 · FR-TP8-1~3 · AC-TP5-9 · AC-TP6-3 | §15 |
| J-9 · P-7 · FR-TP8-4/5 · AC-TP6-1/2 · EX-TP-15/16 | §11 |
| J-11 · P-9 · FR-TP7-\* | §10 |
| J-12 · P-12 · FR-TP8-7 · AC-TP6-4 | §6.6 · §17 T-11/T-12 |
| J-13 · P-13 · FR-TP3-7 · AC-TP3-6 | §6.5 |
| J-14 | §11.4 |
| J-15 | §19 |
| J-16 · NFR-TPP1~6 | §18 |
| J-17 · FR-TP8-8 · AC-TP6-5 | §5.4 · §15 · §21.2 X-2 |
| J-18 · P-15 | §26 |
| P-16 · K-1 | §2.6 · §12 · §21.3 |
| K-2 · NFR-TPM1/4 | §7.1 · §13 |
| FR-0-130 · AC-TP1-1 | §6.1 · §11.1 · §21.1 |
| FR-0-132 · AC-TP7-2 | §16 · §17 |
| FR-0-133 · EX-TP-17 | §14 |
| FR-0-134 | §16.3 |
| FR-0-135 | §9.5 · §17 T-5/T-6 |
| FR-0-136 | §21.2 |
| FR-0-137 · NFR-TPS1 · AC-TP7-4 | §4.2 · §17 T-13 |
| FR-TP5-\* | §8 |
| FR-TP8-6 | §19 |
| FR-TP8-9 | §17 |
| NFR-TPS3/4 | §9.7 · §15 |
| NFR-TPA1~5 · AC-TP7-3 | §20 |
| NFR-TPM2/3 | §9.1 · §6.1 · §17 T-15 |
| EX-TP-1 | §7.2 ④ |
| EX-TP-2 · 4 · 11 · 12 | §6 · §7.4 · §5.1(멱등·마지막 쓰기 승리) |
| EX-TP-3 · 5 · 6 | §7.5 · §4.1(코드 포인트·`normalizeText`) · 금지어 비대상 |
| EX-TP-7 · 8 · 13 · 14 · 18 · 19 · 21 · 22 | §9 · §5.2 |
| EX-TP-20 · 23 · 24 | §19 · §7.2 · §5.3 |

---

## 23. 범위 밖 (재검토 트리거는 요구사항 §9 · ADR-0037 재검토 트리거)

병합(2차 — §10 규칙만) · 공유 토픽 패키지(해석 b) · 토픽 우선 라우팅(c3) · 토픽 계층 · 자산 다대다 소속 · 토픽 단위 권한·부서 멀티테넌시(No.45) · 그룹 계층(No.1 고도화 반납) · 토픽별 통계 화면 · 토픽 활성화 예약 · TC 실행의 비활성 포함·토픽별 TC 필터 · 노드·컨텍스트·동음이의어 파일 이관 · 분리 비동기 작업화(상한 초과 챗봇의 깊은 복사 포함) · 옮기기형 분리(원본 자동 제거) · 토픽 스냅샷·토픽 단위 복원 · ROCHA식 최상위 `토픽` 메뉴 · 의도 체계 공유 통계(T-5 트리거 미발동 — 분리는 복사라 챗봇 간 의도 동일성이 생기지 않는다) · 분리 시 답변 설정·상담 설정·채널 복사 · 서버 강제 영향 미리보기 증빙.

---

## 24. 알려진 제한

| # | 제한 | 수용 근거 · 완화 |
|---|---|---|
| K-1 | 이름 유일성이 챗봇 단위라 두 부서가 같은 이름을 쓸 수 없다 | P-2 · 오류 문구에 상대 토픽 표시 · 접두어 운영 지침 |
| K-2 | 다중 인스턴스에서 토글·소속 변경은 최대 60초 뒤 반영 | 기존 자산 편집과 같은 한계 · 화면 고지 |
| K-3 | 토픽 경계를 넘는 참조를 막지 않는다 — 비활성화가 활성 노드의 이동·조건을 끊을 수 있다 | P-3 · 영향 미리보기 · 점검 규칙 ① · 엔진은 예외 없이 건너뛴다 |
| K-4 | 소속 변경은 `updatedAt`을 바꾸지 않아 "최근 수정순" 목록에 나타나지 않는다 | 동점 순위 보존(§5.2) · 감사로그에는 남는다 |
| K-5 | 분리는 동기 상한(§9.4)을 넘는 챗봇을 복사할 수 없다(깊은 복사 포함) | 성능 기준 자산량 · 비동기화 트리거 |
| K-6 | 삭제된 토픽을 가리키는 스냅샷의 **예약** 복원은 체인의 후속 예약을 보류시킨다 | 안전 쪽 실패 · 미리보기 `TOPIC_MISSING` |
| K-7 | API 롤백 시 구버전은 토픽 필터가 없어 비활성 토픽 자산이 운영에 노출된다 | 롤백 절차에 확인 단계(§3.5) |
| K-8 | 토픽이 든 스냅샷은 구버전 API로 복원할 수 없다(사후 해시 검증 실패 → 롤백) | 안전 쪽 실패 |
| K-9 | 분리 트랜잭션 동안 SQLite 전체 쓰기가 대기한다 | 상한 · 청크 적재 · 실측 기록 · Postgres 전환 시 완화 |
| K-10 | 아웃풋 문자열 잎이 우연히 원본 자산 UUID와 정확히 같으면 참조로 취급된다 | UUID v4 충돌 확률 무시 가능 · 자유 텍스트 전체가 UUID인 경우만 해당 |
| K-11 | TRIM으로 새 챗봇의 시작 노드 버튼이 줄어든다 | 미리보기·결과에 전수 표시 · FOLLOW 선택 가능 |
| K-12 | 토픽 도입 전 스냅샷 복원은 모든 자산을 공통(=운영 노출)으로 되돌린다 | P-7의 귀결 · `TOPIC_EXPOSURE_CHANGE` 경고 |

---

## 25. 요구사항 대비 해석 (architect 판단)

| # | 요구사항 | 해석·변경 | 근거 |
|---|---|---|---|
| D-1 | FR-TP1-4·NFR-TPP2 "`groupBy`로 쿼리 수 고정" | **`build()` 1회(7) + 토픽 1 = 8 고정** · 자산 수·교차 참조 수를 한 번에 순수 계산 | 교차 참조 수는 참조 그래프가 필요해 어차피 전체 자산을 읽는다 — `groupBy` 6회를 더하면 오히려 늘어난다 |
| D-2 | FR-TP3-2 "`build()` 선택 인자" | 인자 + **비트랜잭션 경로 전용 런타임 가드** + 비필터 전용 캐시 인스턴스 | 캡처 경로 오용 방지 · 운영 캐시 오염 불가 |
| D-3 | FR-TP2-6 "`updatedAt` 갱신 허용" | **보존**(일괄 = 값별 묶음 `updateMany` · 단건 = topicId만 바뀌면 명시 보존) | `rankNodes` 동점 규칙이 `updatedAt`을 본다 — 분류가 답을 바꾸면 안 된다 |
| D-4 | FR-TP8-5 "없는 토픽 → 공통 + 경고" | **트랜잭션 안 대상 정규화 → 기대 해시 재계산**으로 사후 검증과 양립 · 경고 `TOPIC_EXPOSURE_CHANGE` 추가 | 원안 그대로면 그런 복원이 전부 롤백된다 · 도입 전 스냅샷 복원의 노출 위험 |
| D-5 | FR-TP6-3 "E-1~E-8을 따라" | **UUID 잎 스캔 폐포**(+ 컬럼) — E-12(API 슬롯 바인딩 → 컨텍스트) 포함 | 요구사항 참조 목록에 누락이 있었다 · 재작성과 같은 판정 규칙이어야 누락이 구조적으로 없다 |
| D-6 | FR-TP6-4 "START·FALLBACK 항상 복사" + 폐포 전이 | **공통 미선택 분리에서 시스템 노드 연결 TRIM(기본)/FOLLOW** | 시작 노드 허브가 모든 분리를 전체 복사로 만든다 · **PM 확인 1** |
| D-7 | FR-TP3-3 "비활성화 전 필수" | **화면 흐름으로 강제**(서버 증빙 요구 없음) | 토글은 가역이고 자산 불변 · 서버 증빙은 오류 코드·해시 바인딩을 늘린다 |
| D-8 | §5.4 `POST …/topics/reorder` · `POST …/impact-preview` | `POST …/:topicId/move` · `GET …/:topicId/impact?action=` | 위/아래 버튼 선례(자주 쓰는 문장) · 읽기 연산 |
| D-9 | FR-0-134 신규 코드 5종 | **4종**(`TOPIC_NOT_EMPTY`·`TOPIC_SYSTEM_NODE_LOCKED`·`TOPIC_SPLIT_TOO_LARGE`·`TOPIC_SPLIT_BUSY`) · 이름 중복·상한은 `DUPLICATE_NAME`·`LIMIT_EXCEEDED` 재사용 | 설문·자주 쓰는 문장과 같은 코드 — 프런트 분기 불변 · 경합은 재시도 가능 코드가 필요 |
| D-10 | §5.2 FK 여부 | FK `Restrict`(단일 열) + `@@index([topicId])` · 복합 FK 기각 | 복합 FK는 `chatbotId`를 두 관계가 공유해 Prisma 관계 쓰기가 까다롭다 · 교차 챗봇은 서비스 1곳 |
| D-11 | FR-TP6-13·AC-TP5-6 "해석 결과 같음" | 분리본의 **타임스탬프 보존 + 순서 보존 ID 발급** | 없으면 동점 케이스에서 AC가 우연에 좌우된다 |
| D-12 | FR-TP4-2 ② "공통으로의 참조 제외" · ③ "서로 다른 토픽" | ②는 그대로 · ③은 **공통↔토픽 포함**(같은 키끼리만 제외) | 공통 의도와 토픽 의도의 예문 중복도 운영 중 동점을 만든다 |
| D-13 | FR-TP3-8 "활성 응답 진입점 0건" | `NO_LIVE_ENTRY_POINT` — 토픽이 있을 때만 · 활성 NORMAL 노드(조건 ≥1) + 활성 FAQ 기준 | 토픽 없는 챗봇 점검 결과 불변(AC-TP4-4) |
| D-14 | FR-TP8-2 "대상 토픽(공통이면 챗봇)에 요약 1건" | **summary 문자열**에 건수 · `after` 없음 | 요약 액션 분기를 늘리지 않는다 · 화이트리스트 우회 0 |
| D-15 | FR-TP1-1 "이름 1~40자" | 코드 포인트 기준(EX-TP-5) · 금지어 필터 비대상(EX-TP-6) | 요구사항 그대로 명시 |
| D-16 | P-16 K-1 정렬 키 권고 `(createdAt, id)` | 채택 + 영향 분석 + TC 비교 절차(§12·§21.3) | 복원·분리에서 승자가 보존되는 유일한 후보 |
| D-17 | K-2 단일화 여부 | 합치지 않음 + 동등성 시험 + 단일화 트리거 | 엔진 수정 0 · 저장 검증의 필드 경로 요구 |
| D-18 | FR-TP6-1 원본 `ARCHIVED` 분리 | **허용**(읽기 연산) | 보관 챗봇에서 부서 챗봇을 되살리는 경로 |

---

## 26. GPU · 배포 형태

- **GPU 1 유지**(P-15): DB 조회·O(n) 필터·참조 그래프 순수 함수·트랜잭션 복사. 새 모델·학습·추론 0. 분리된 챗봇의 재색인은 **기존** ml-worker 임베딩 경로(No.18). ml-worker 변경 0.
- **구축형 ○**: 외부 의존 0 · 새 인프라·프로세스 로컬 상태는 기존 번들 캐시의 두 번째 인스턴스(무효화 지점 공유)뿐 · 마이그레이션은 API 중지 상태의 테이블 재정의 1회.
- **구독형 ○**: 챗봇 스코프 자원이라 교차 404 규약 그대로 · 다중 인스턴스 정합성 근거는 DB(토픽 행·자산 `topicId`)이며 캐시는 60초 수렴 · 부서 단위 권한 요구는 No.45.

---

## 27. 구현 편차 / PM 변경 (backend-implementer 기록, 2026-09-25)

| # | 절 | 원안(이 문서) | 실제 구현 | 근거 |
|---|---|---|---|---|
| I-1 | §11.3 · §25 D-4 | `TOPIC_EXPOSURE_CHANGE`는 **경고만**(차단 아님) — "PM 확인 2"로 사용자 확인 대기 | **PM 확정 2026-09-25(강화)**: 복원 요청에 `acknowledgeTopicExposure: boolean`(선택) 필드를 추가한다. 미리보기가 아니라 **확정(`restore()`) 경로**에서 서버가 직접 판정한다 — `TOPIC_EXPOSURE_CHANGE`에 해당하는데(`exposed>0 \|\| hidden>0`) 이 값이 `true`가 아니면 **`400 VALIDATION_FAILED`**로 복원을 거부한다(`details: [{ field: 'acknowledgeTopicExposure', message: '토픽 노출 변화 확인이 필요합니다.' }]`) — 기존 `acknowledgeActive`(운영 중 챗봇 복원 확인)와 **동일한 필드·오류 패턴**을 그대로 따른다. 코드 위치: `versions/restore/version-restore.service.ts#restore()`, 순수 판정 로직은 `versions/lib/topic-exposure.ts`(`computeTopicExposureChange`, `RestoreWarningsService`와 공유). | 조정자(coordinator) 화면설계서 계약 확정 지시(2026-09-25) — "acknowledgeTopicExposure: boolean 확정 · acknowledgeActive와 같은 패턴 · 오류 코드는 기존 acknowledge 거부 선례를 따른다" |
| I-2 | §5.3 FR-TP4-5 | "노드 목록 '다른 토픽 참조 n' 배지" — 구체적 응답 필드명 미기재 | `DialogNodeListItemSchema`에 `crossTopicRefCount: number`(0 이상) 필드를 신설한다 — 이 노드에서 나가 다른 토픽(공통 제외)으로 향하는 교차 참조 간선 수(`collectAssetRefs()`의 `CROSS_TOPIC_REFERENCE` 판정과 같은 규칙). 쿼리 수는 기존 6개 그대로다(동음이의어·FAQ는 노드의 나가는 참조 대상이 아니므로 추가 조회 없이 계산). | 조정자 지시 — "필드명을 정해 보고하라" |
| I-3 | §9.3 시스템 노드 TRIM/FOLLOW | 폐포를 **선택 자산만으로 1차 계산(C0)** 후 시스템 노드 아웃풋을 트림하는 정밀 알고리즘 | 구현은 다음과 같이 단순화했다: (1) 시스템 노드를 제외한 1차 폐포(C0)를 계산해 트림/따라감 판정 기준으로 쓴다(원안과 동일). (2) TRIM 모드에서 `DIALOG_MOVE`/버튼의 `NODE` 액션 중 C0 밖 대상은 실제로 잘라내 새 챗봇에 반영한다(원안과 동일). (3) `API_CONDITION`/`SURVEY`의 대상은 "따라간다"고 보고하고 폐포에 편입한다(원안과 동일). 다만 **폐포 편입 시 재귀적으로 그 대상의 전체 참조 그래프를 다시 닫는(BFS) 구현**이며, 원안의 "빈 결과 시 FOLLOW로 되돌린다"는 규칙도 노드 단위로 구현했다. 세부 branch(예: CARD 버튼 트림)는 원안에 명시되지 않은 부분이라 BUTTON과 동일 규칙을 적용했다. 이 영역은 로직이 복잡해 code-reviewer·test-automation의 집중 검토를 권고한다. | 구현자 판단(시간 제약) — `asset-transfer/lib/transfer-selection.ts` · `system-node-trim.ts` |
| I-4 | §7.2 규칙① `resourceType` | `HANDOFF_END_BUTTON` 간선의 "출발"(상담 설정)도 이슈로 보고 가능하다는 암묵적 전제 | `DesignIssue.resourceType`은 `HOMONYM`만 추가했고(닫힌 유니온), `HANDOFF_SETTING`은 추가하지 않았다 — 상담 설정은 대화 자산이 아니라 이슈의 "출발 자원"으로 표현할 방법이 없다. 따라서 `HANDOFF_END_BUTTON` 간선은 규칙①(INACTIVE_TOPIC_REFERENCE) 이슈로 **보고되지 않는다**(교차 참조 집계·영향 미리보기의 `brokenRefs`에는 여전히 반영된다 — `topic-impact.ts`는 `TopicRefEndpoint.kind`가 유니온이라 문제 없음). | 구현자 판단 — `topics/lib/topic-boundary.ts` `refKindToResourceType()` |
| I-5 | §9.3 · `TopicSplitTrimmedLinkSchema` | `trimmedLinks`/`followedSystemLinks` 항목에 "왜 트림 대신 따라갔는지" 표시 필드가 없었다 | 1차 코드리뷰(M-2) 대응 — `TopicSplitTrimmedLinkSchema`에 `reason: z.literal('TRIM_WOULD_EMPTY').optional()`을 추가한다(값이 있으면 `followedSystemLinks` 항목, "잘라내면 출력이 없어져 대신 따라갔다"는 뜻). 동시에 `FollowedLinkReport.edge`를 `'NODE_API_BRANCH'` 고정값에서 실제 출처(`NODE_MOVE`/`NODE_BUTTON`/`NODE_API_BRANCH`/`NODE_SURVEY_COMPLETE`)로 바로잡았다 — 이전 구현은 TRIM_WOULD_EMPTY로 되돌린 `DIALOG_MOVE`/`BUTTON` 항목까지 전부 `NODE_API_BRANCH`로 오분류했다(결함, 설계 의도 자체는 §9.3과 합치). | 코드리뷰 1회차 M-2 — `asset-transfer/lib/system-node-trim.ts` · `packages/shared-types/src/topic.ts` |
| I-6 | §11.2 | "트랜잭션 안에서 대상 스냅샷을 정규화"까지만 명시 — 노출 게이트(I-1) 자체의 트랜잭션 안 재확인은 명시 없음 | 코드리뷰 1회차 M-3 대응 — I-1의 `acknowledgeTopicExposure` 게이트를 트랜잭션 **안**에서 최신 토픽 상태로 재계산해 재확인한다(TOCTOU). 확인 시점과 트랜잭션 시점의 `{exposed,hidden}` 값이 다르면(트랜잭션 진입 직전 다른 요청이 토픽을 토글한 경합) `RESTORE_PREVIEW_STALE`(409)로 롤백해 재확인을 유도한다 — 자산 내용 해시(`expectedCurrentHash`)만으로는 이 경합을 잡지 못한다(토픽 **활성 상태**는 자산 내용이 아니라 해시에 반영되지 않는다). 값이 같은데도 노출 변화가 있고 확인 체크가 없으면 트랜잭션 안에서도 다시 `400 VALIDATION_FAILED`로 막는다(방어적 이중 게이트 — 정상 흐름에서는 트랜잭션 밖 게이트가 먼저 막으므로 도달하지 않는다). | 코드리뷰 1회차 M-3 — `versions/restore/version-restore.service.ts#restore()` |
| I-7(L-2) | §7.2 규칙③ | `topicRef.edge`에 쓸 전용 값 미정 — 원안은 규칙③(CROSS_TOPIC_DUPLICATE_EXAMPLE)의 간선 라벨을 구체적으로 정하지 않았다 | 1회차 코드리뷰 L-2 대응 — 기존 구현이 `NODE_INTENT`(노드→의도, `TopicRefEdge`의 실제 그래프 간선 하나)를 재사용해 규칙③(의도↔의도 예문 중복 — 그래프 간선이 아니라 파생 분석 결과)에 붙이고 있었다. `DesignIssueTopicRefSchema.edge`가 자유 문자열(`z.string()`)임을 확인하고, `TopicRefEdge`(13종 구조적 간선 닫힌 목록, `collectAssetRefs()`가 채운다) 확장 없이 전용 문자열 `'INTENT_DUPLICATE_EXAMPLE'`을 새로 써서 의미를 바로잡았다. **판단**: 이 필드는 관리자 콘솔 설계 점검 패널이 "출발→도착" 표시·편집 링크에 잠재적으로 쓸 수 있는 공개 계약(§20)이라 프런트 구현 전이라도 정확한 값을 두는 편이 안전하다고 판단해 수정했다. `shared-types` 스키마 자체(`TopicRefEdge`)는 변경하지 않았다(그래프 간선 열거와 파생 분석 관계 열거를 섞지 않기 위해). | 코드리뷰 1회차 L-2 — `topics/lib/topic-boundary.ts` |

**미구현/축소 항목 보고(코드리뷰·시험 설계 인계용)**:
- 토픽 CRUD·소속 일괄 지정·번들 필터·복원 정규화·경고·사전검사 등 핵심 경로는 통합 시험(신규)으로 검증하지 못했다(시간 제약) — 단위 시험(순수 함수)과 기존 전체 회귀(1855건)만 확인했다. `topics/**` 컨트롤러·서비스의 HTTP 계약 통합 시험, 분리(`split`) 실행 통합 시험은 test-automation 후속 작업으로 남긴다.
- §21.3 K-1 TC 회귀 절차(TestRun A/B + `test-runs/compare`)는 절차 자체를 수행하지 못했다(운영 데이터·TC 세트가 필요) — K-1 변경의 안전성은 단위 시험(orderBy 인자 단언)과 기존 전체 회귀(무변화)로만 확인했다.

- **I-8 (자동시험 발견 결함 수정, 2026-09-25)**: 분리 동기 상한 검사가 무거운 번들 캡처·트랜잭션 **뒤**에서만 실행돼, 상한 초과 챗봇에 부하가 겹치면 캡처가 트랜잭션 타임아웃(30초)을 넘겨 `422 TOPIC_SPLIT_TOO_LARGE` 대신 `500`이 났다. `split()`·`preview()` 모두 캡처 **전**에 선택 범위(선택 토픽 또는 공통)의 자산 6종 `count()` 사전 검사를 두어 즉시 422로 거부한다. 선택 범위 수는 최종 합계(선택+폐포+시스템)의 하한이므로 오탐이 없고, 트랜잭션 안의 기존 정밀 검사는 이중 방어로 유지한다. 챗봇 전체 수 기준 검사는 "큰 챗봇을 작은 토픽으로 쪼개는" 주력 시나리오를 오탐하므로 채택하지 않았다.
