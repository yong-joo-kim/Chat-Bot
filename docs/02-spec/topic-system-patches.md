# No.22 토픽 시스템 — 기존 문서 패치 목록

> 작성: system-architect · 2026-09-25 · 근거: `docs/02-spec/topic-system-설계.md`, `docs/02-spec/decisions/ADR-0037-topic-classification-bundle-filter-and-id-remapping-split.md`
> **적용 상태**: ✅ **적용 완료(2026-09-25)** — 오케스트레이터 세션이 67건 전부 "찾을 원문 정확히 1회" 확인 후 기계적으로 적용했다.
> **적용 방법**: 각 항목의 "찾을 원문"을 대상 파일에서 **정확히 1회** 찾아 "바꿀 내용"으로 교체한다. 모든 원문은 2026-09-25 시점 파일(No.24 패치 적용 후)에서 복사했고 문자열 검색(Grep count)으로 대상 파일 안 유일성을 확인했다. "바꿀 내용"이 원문을 그대로 포함하는 항목은 append다(취소선 표기 항목은 원문을 `~~…~~`로 감싸 보존한다).
> **줄바꿈 주의**: 대상 파일은 CRLF일 수 있다. 모든 "찾을 원문"은 **한 줄 안의 부분 문자열**(줄바꿈 미포함)로 잡았다. "바꿀 내용"의 줄바꿈은 대상 파일의 줄바꿈으로 정규화한다.
> **순서 독립**: 어떤 "바꿀 내용"도 다른 항목의 "찾을 원문"을 새로 만들지 않는다. 같은 줄에 앵커가 여럿인 항목(개발명세서 §3.1 참조 무결성 줄 A-10·A-11 · §3.1 인덱스 줄 A-14 등)은 서로 겹치지 않는 부분 문자열이다.
> 코드 변경은 이 파일의 범위가 아니다 — 설계서 §2.5 체크리스트와 §21.2(의도된 시험 기대값 변경 닫힌 목록)를 따른다.
> 항목 수: 개발명세서 31 · ADR 6 · 기능요구사항 3 · 토픽 시스템 요구사항(PM 결정 기록 + 설계 반영) 17 · 선행 요구사항 인계 정정 10 = **67건**

---

## A. `docs/02-spec/개발명세서.md`

### A-1. [개발명세서 `docs/02-spec/개발명세서.md`] §2 워크스페이스 상태 표 — `topics`·`asset-transfer` 행 추가

**찾을 원문**
````text
선택 환경변수 5개 · 봉투 스키마·버전 불변 · widget 변경(상담 모드 — vanilla 유지)**(ADR-0036) |
````
**바꿀 내용**
````text
선택 환경변수 5개 · 봉투 스키마·버전 불변 · widget 변경(상담 모드 — vanilla 유지)**(ADR-0036) |
| **`apps/api/src/topics`** · **`apps/api/src/asset-transfer`** | **토픽 시스템 Phase에 신설**(No.22) — 챗봇 안 평면 토픽 CRUD·활성/비활성·★자산 소속 일괄 쓰기 유일 파일(`topic-assignment.service.ts`)·교차 참조 점검·영향 미리보기·토픽 → 새 챗봇 분리(export 1개) + **챗봇 간 자산 이관 부품**(캡처 → 선택·계획(순수) → 생성 전용 적재기 — No.40·병합이 재사용, export 2개). **`packages/dialogue-engine`·ml-worker·widget 변경 0건 · `@Public()` 7 유지 · 신규 권한·역할·환경변수 0 · 스냅샷 스키마 버전 1 유지(선택 필드)**(ADR-0037) |
````

### A-2. [개발명세서 `docs/02-spec/개발명세서.md`] §2.2 기능그룹별 모듈 배치 표 — No.22 행 추가

**찾을 원문**
````text
**설계 완료 → `hybrid-cs-설계.md`** |
````
**바꿀 내용**
````text
**설계 완료 → `hybrid-cs-설계.md`** |
| **토픽 시스템 (No.22)** | **`topics`(신규 — ★`Topic` 쓰기 유일 파일 `TopicsService` · ★자산 6종 `topicId` 일괄 쓰기 유일 파일 `TopicAssignmentService`(data 키 ⊆ `topicId`·`updatedAt`) · 목록(자산 수·교차 참조 수)·영향 미리보기·분리 오케스트레이션, export `TopicLookupService` 1개) + `asset-transfer`(신규 — `captureTransferSource`·`selectTransferSubset`/`planTransfer`/`verifyTransferPlan`(순수)·★생성 전용 `AssetTransferLoader`, 복원 적재기와 코드 비공유)** + `dialogue-common`(`build()` 선택 인자 `excludeInactiveTopics` · `getCached` 필터 · `getCachedUnfiltered`(시뮬레이터 전용) · 참조 열거 1벌 `asset-ref-graph.ts` · K-1 결정적 `orderBy`) · 자산 6모듈(`topicId` 생성·수정·목록 필터·감사) · `dialog-nodes`(시스템 노드 잠금·점검 규칙 합성·K-2 추출) · `simulation`(비활성 포함 토글) · `conversation`(`record()`의 `topicId`) · `versions`(복원 정규화·경고 2종) · `chatbots`(사전검사 14종·복사 대상 결정 추출) · `audit-logs`(`Topic`) | **설계 완료 → `topic-system-설계.md`** |
````

### A-3. [개발명세서 `docs/02-spec/개발명세서.md`] §2.2 주석 블록 — 엔진 불가침·모듈 의존 방향(No.22) 추가

**찾을 원문**
````text
상담 기록을 읽거나 쓸 수단이 DI 그래프에 없다(FR-0-123, ADR-0030 형식).
````
**바꿀 내용**
````text
상담 기록을 읽거나 쓸 수단이 DI 그래프에 없다(FR-0-123, ADR-0030 형식).
>
> **엔진 불가침(토픽 시스템 No.22)**: 이 그룹은 `packages/dialogue-engine`을 **한 줄도 바꾸지 않는다**(FR-0-129). 비활성 토픽의 효과는 **`getCached()` 번들 조립에서 노드·의도·FAQ가 빠진 것**으로만 나타나며(엔진은 없는 노드·의도를 이미 예외 없이 처리한다), 번들 형태는 자산 항목의 선택 필드 `topicId?`(엔진 미사용) 추가뿐이다. 설계 점검의 토픽 규칙은 엔진 결과 **뒤에** API 계층 순수 함수가 합친다. 엔진 패키지에 `topic` 심볼 0건을 정적 검사가 단언한다(ADR-0037 §2·§3).
>
> **모듈 의존 방향(No.22)**: `topics → chatbots / dialogue-common / asset-transfer / audit-logs / prisma` · `asset-transfer → dialogue-common(build — tx 경로) / prisma` · 자산 6모듈·`simulation → topics(TopicLookupService 읽기 1개)` 단방향이다. **`TopicsModule`은 `TopicLookupService` 1개만 export**하며 토픽 쓰기·소속 일괄 쓰기·분리는 모듈 밖에서 주입할 수 없다. **`asset-transfer`는 `versions/restore/**`를 import하지 않고 `versions`는 `asset-transfer`를 import하지 않는다** — ID 재매핑 적재기(생성 전용)와 ID 보존 복원 적재기는 코드를 공유하지 않는다(공유 = 캡처 `build(chatbotId, tx)`·`normalizeText`뿐). 공개 대화 서비스는 번들의 `topicId`만 읽는다(생성자 인자 추가 0).
````

### A-4. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `Topic` 행 추가

**찾을 원문**
````text
쓰기 주체 1파일 · 감사 `CannedResponse`(본문 제외) | 24 |
````
**바꿀 내용**
````text
쓰기 주체 1파일 · 감사 `CannedResponse`(본문 제외) | 24 |
| **`Topic`** | **챗봇 안의 평면 토픽(No.22, ADR-0037 §1).** 이름(`nameNormalized` 챗봇 내 유일 · 1~40자)·설명(≤200)·정렬 순서(위/아래 이동)·**`enabled`**(false면 소속 **노드·의도·FAQ**가 `getCached()` 번들에서 빠진다 — 키워드·컨텍스트·동음이의어는 빠지지 않는다) · 챗봇당 50개. **자산 6종(`Intent`·`Keyword`·`HomonymDictionary`·`DialogNode`·`ContextVariable`·`FaqEntry`)에 nullable `topicId`**(FK `Restrict` · `@@index([topicId])` · null = **공통**(가상 토픽 — 항상 활성·삭제 불가) · 자산당 0~1개 · START/FALLBACK 노드는 항상 null · 같은 챗봇 토픽만(서비스 검사) · 자산 이름 유일성은 **챗봇 단위 그대로**). 설문·자주 쓰는 문장·채널은 토픽 비소속. 쓰기 주체 = `TopicsService`(토픽) · `TopicAssignmentService`(소속 일괄 — `updatedAt` 보존) · 분리 적재기(생성). **토픽 정의·활성 상태는 스냅샷 밖**, 자산 `topicId`는 스냅샷 **선택 필드**(값 없으면 생략 → 기존 해시 불변). 비어 있지 않은 토픽 삭제 `409 TOPIC_NOT_EMPTY`(공통으로 옮기고 삭제 제공) | 22 |
````

### A-5. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `ConversationLog` 행에 `topicId`

**찾을 원문**
````text
세션 전문 조회용 인덱스 `(chatbotId, sessionId, createdAt)`을 추가한다(ADR-0036)** | 14, 15, 24, 27, 29, 30 |
````
**바꿀 내용**
````text
세션 전문 조회용 인덱스 `(chatbotId, sessionId, createdAt)`을 추가한다(ADR-0036)** **[No.22] `topicId`는 답한 자산(노드 → FAQ → 의도 순 첫 매칭)의 **대화 당시** 토픽 스냅샷이다(공통·미응답·RAG·상담 턴 = null) — FK·인덱스 없음 · `record()` 1곳 · 적재 후 불변 · 백필 없음(기존 행 = "기록 없음"). 토픽 이동이 과거 귀속을 소급 변경하지 않게 하는 유일한 방법이며(`groupId` 선례 — ADR-0033 §4) 1차는 적재만 한다(화면 0 — ADR-0037 §7)** | 14, 15, 22, 24, 27, 29, 30 |
````

### A-6. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 머리 — 13건 → 14건

**찾을 원문**
````text
> **미도입 결정 13건**
````
**바꿀 내용**
````text
> **미도입 결정 14건**
````

### A-7. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 ⑭ 신설 — 토픽 관련 미도입

**찾을 원문**
````text
원문 열람 자격은 순수 판정 함수(담당자·ADMIN·상담 중) + `RAW_VIEW` 감사로 충분하다(**ADR-0036**).
````
**바꿀 내용**
````text
원문 열람 자격은 순수 판정 함수(담당자·ADMIN·상담 중) + `RAW_VIEW` 감사로 충분하다(**ADR-0036**).
> ⑭ **토픽 계층(상위 토픽)·자산↔토픽 다대다 조인·토픽 단위 권한/담당자 테이블·챗봇 밖 공유 토픽·토픽 우선순위·토픽별 임베딩 색인·토픽 활성화 예약·토픽 스냅샷·토픽 통계 롤업·분리 작업(Job) 테이블·재매핑 이력 테이블** — 토픽은 챗봇 안 **평면 분류**이고 자산당 0~1개라 비활성 판정이 모호하지 않다. 공유 토픽은 "챗봇 = 버전·배포·검증 단위" 전제를 깨고, 우선순위는 엔진 매칭 규칙을 바꾼다. 비활성 효과는 번들 조립 필터로 충분해 색인을 나누지 않는다(의미 매칭은 번들 기준으로 후보를 거른다). 분리는 동기 상한 이하에서 수 초이며 결과는 새 챗봇과 감사 `COPY`로 남는다(**ADR-0037**).
````

### A-8. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 ④ — No.22 보론

**찾을 원문**
````text
챗봇별 상담원 배정은 후속(ADR-0036 §7).**
````
**바꿀 내용**
````text
챗봇별 상담원 배정은 후속(ADR-0036 §7).** **[보론 2026-09-25 No.22] 토픽 시스템은 트리거 대상이었으나 권한 경계를 만들지 않았다 — 토픽은 대화 자산의 분류이고 모든 EDITOR가 모든 토픽을 편집한다. 부서(토픽) 단위 권한·멀티테넌시는 No.45와 함께(ADR-0037 §7).**
````

### A-9. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 ③ — No.22 파생 컬럼 보론

**찾을 원문**
````text
상담원 메시지·원문은 로그에 섞지 않는다(`HandoffMessage`).
````
**바꿀 내용**
````text
상담원 메시지·원문은 로그에 섞지 않는다(`HandoffMessage`). **[No.22] 토픽 시스템은 `topicId` 1개만 추가했다** — 파생 불가(현재 소속으로 역산하면 자산 이동이 과거를 바꾼다)이며, 소비자(토픽 통계)는 아직 없지만 **나중에 추가하면 과거를 복원할 수 없어** PM 결정(P-12)으로 지금 적재한다(ADR-0004의 "소비자 없는 컬럼 금지"에 대한 명시적 예외 — 재검토 트리거는 토픽 통계 요구 확정).
````

### A-10. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 참조 무결성 — FK 미설정 예외에 `ConversationLog.topicId` 추가

**찾을 원문**
````text
**`ConversationLog.groupId`**(No.29 — 대화 당시 그룹 스냅샷.
````
**바꿀 내용**
````text
**`ConversationLog.topicId`**(No.22 — 대화 당시 답한 자산의 토픽 스냅샷. 토픽이 삭제돼도 기록은 사실로 남는다), **`ConversationLog.groupId`**(No.29 — 대화 당시 그룹 스냅샷.
````

### A-11. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 파생 데이터 동반 삭제 — `Topic` 분류

**찾을 원문**
````text
**`ChatbotHandoffSetting`은 `ChatbotAnswerSetting`과 같은 설정 데이터라 동반 삭제 대상**이다(트랜잭션에 `deleteMany` 1건 추가).
````
**바꿀 내용**
````text
**`ChatbotHandoffSetting`은 `ChatbotAnswerSetting`과 같은 설정 데이터라 동반 삭제 대상**이다(트랜잭션에 `deleteMany` 1건 추가). **[No.22] `Topic`은 대화 자산 성격이라 동반 삭제가 아니라 영구삭제 사전검사(409) 대상**이다(`토픽` — 13 → 14종). 자산 6종의 `topicId` FK가 `Restrict`라 비어 있지 않은 토픽은 단건으로도 지울 수 없다(`409 TOPIC_NOT_EMPTY` → 공통으로 옮기고 삭제).
````

### A-12. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 정규화 유일성 — 토픽 이름 · 자산 유일성 불변

**찾을 원문**
````text
정규화 구현은 `packages/shared-types/src/common.ts` 한 곳뿐이다.
````
**바꿀 내용**
````text
정규화 구현은 `packages/shared-types/src/common.ts` 한 곳뿐이다. **[No.22] `Topic.nameNormalized`도 같은 규약(`(chatbotId, nameNormalized)` 유일)이다. 자산의 유일성은 토픽이 달라도 챗봇 단위 그대로다** — `(chatbotId, topicId, nameNormalized)`로 바꾸면 엔진·편집기·가져오기·동음이의어의 이름 해석이 전부 바뀐다(ADR-0037 §1).
````

### A-13. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 부분 수정 시맨틱 — `topicId`

**찾을 원문**
````text
(경고 > 주의 · 버튼 라벨·노드 둘 다 또는 둘 다 없음).
````
**바꿀 내용**
````text
(경고 > 주의 · 버튼 라벨·노드 둘 다 또는 둘 다 없음). **[No.22] 자산 6종의 `topicId`는 일반 규약(키 없음 = 미변경 · `null` = 공통으로 · 값 = 그 토픽)을 따르되, 수정에서 바뀌는 필드가 `topicId`뿐이면 `updatedAt`을 보존한다** — 엔진의 노드 순위가 `updatedAt`으로 동점을 가르므로 분류가 답을 바꾸면 안 된다(ADR-0037 §6).
````

### A-14. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 인덱스 — No.22 인덱스 추가

**찾을 원문**
````text
`handoffTurn`·`apiNotice`·`rawText`에는 인덱스를 두지 않는다.**
````
**바꿀 내용**
````text
`handoffTurn`·`apiNotice`·`rawText`에는 인덱스를 두지 않는다.** **[No.22] `topics(chatbotId, nameNormalized) UNIQUE`, `topics(chatbotId, sortOrder)`, `intents｜keywords｜homonym_dictionaries｜dialog_nodes｜context_variables｜faq_entries(topicId)`(FK 검사·토픽별 조회 — `chatbotId` 선두 인덱스로는 SQLite FK 검사를 돕지 못한다). `conversation_logs.topicId`에는 인덱스를 두지 않는다(적재만 — 통계 화면 없음). 자산 6테이블의 FK 컬럼 추가는 SQLite 테이블 재정의 마이그레이션이다(API 중지 상태 · 소요 실측 기록).**
````

### A-15. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 참조 무결성 — 참조 종류 추가 체크리스트

**찾을 원문**
````text
사전 검사는 UX용, DB 제약은 최종 방어선이다.
````
**바꿀 내용**
````text
사전 검사는 UX용, DB 제약은 최종 방어선이다. **[No.22] 대화 자산 사이에 새 참조 종류가 생기면 다섯 곳을 함께 갱신한다 — ① 저장 검증(`dialog-nodes/lib/node-target-refs.ts` 등) ② `getOutgoingNodeRefs()`(노드→노드일 때) ③ 삭제 사전검사(`reference-check.service.ts`) ④ 스냅샷 무결성(`snapshot-integrity.ts`) ⑤ 토픽 간선 라벨(`dialogue-common/lib/asset-ref-graph.ts`). 분리·병합의 재작성은 "원본 자산 UUID와 같은 문자열 잎" 규칙이라 갱신이 필요 없다. ①과 ②의 노드 참조 목록 일치는 동등성 시험이 단언한다(K-2 — ADR-0005 갱신 각주).**
````

### A-16. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 토픽 시스템 행 추가

**찾을 원문**
````text
**`@Public()` 추가 0건 — 응답은 기존 공개 대화 경로로만 들어온다** | 27 |
````
**바꿀 내용**
````text
**`@Public()` 추가 0건 — 응답은 기존 공개 대화 경로로만 들어온다** | 27 |
| **토픽 시스템** | **`/chatbots/:chatbotId/topics`(GET 목록 — 자산 수·교차 참조 수 / POST 생성), `POST …/topics/split/preview`(DB 변경 0)·`POST …/topics/split`(새 `DRAFT` 챗봇 — ⚠ 두 경로는 `:topicId`보다 **먼저 선언**), `PATCH｜DELETE …/topics/:topicId`(`?moveToCommon=true` — 공통으로 옮기고 삭제), `POST …/topics/:topicId/move｜enable｜disable`, `GET …/topics/:topicId/impact?action=ENABLE｜DISABLE`(영향 미리보기), `POST /chatbots/:chatbotId/topic-assignments`(일괄 소속 지정 ≤1,000건·한 종류)**. 조회 `dialogue:read` / 쓰기 `dialogue:write` / 분리 `dialogue:read` AND `chatbot:write`(신규 권한 0종). 기존 경로 확장: 자산 6종 목록 `topicIds`(`common` 예약어)·행 `topicId` · 생성/수정 `topicId` · 내보내기 `topicIds` · 가져오기 커밋 `newItemTopicId` · 설계 점검 토픽 규칙 4종 · 시뮬레이터 `includeInactiveTopics`·`answeredTopic?` · 복원 미리보기 경고 2종 · 영구삭제 사전검사 14종. 총 11개 핸들러 · **`@Public()` 추가 0건** | 22 |
````

### A-17. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 품질/시뮬레이션 행에 비활성 토픽 포함

**찾을 원문**
````text
`compare`·TC는 항상 설문 미리보기 판정(상태·기간 무시 — 결정론)** | 10, 26, 27 |
````
**바꿀 내용**
````text
`compare`·TC는 항상 설문 미리보기 판정(상태·기간 무시 — 결정론)** **[No.22] `simulate`·`compare` 요청에 `includeInactiveTopics`(기본 false — 켜면 비활성 토픽 자산 포함 번들, 운영 캐시와 분리된 캐시), 응답에 `answeredTopic?`(답한 자산의 토픽 이름·활성 여부 — 관리자 전용). TC 실행에는 없다** | 10, 22, 26, 27 |
````

### A-18. [개발명세서 `docs/02-spec/개발명세서.md`] §4 정정 이력 — 2026-09-25b 항목 추가

**찾을 원문**
````text
④ 신규 `ApiErrorCode` 7종(`hybrid-cs-설계.md` §17).
````
**바꿀 내용**
````text
④ 신규 `ApiErrorCode` 7종(`hybrid-cs-설계.md` §17).
> **정정 이력(2026-09-25b — 토픽 시스템)**: ① **토픽 시스템 행을 신설**했다 — 토픽은 챗봇 스코프 자원이라 `/chatbots/:chatbotId/topics/*`이며, ROCHA식 최상위 `/topics`는 만들지 않는다(해석 b 기각). ② 요구사항 초안의 `POST …/topics/reorder`는 **`POST …/topics/:topicId/move`**(위/아래 버튼 — 자주 쓰는 문장 선례), `POST …/impact-preview`는 **`GET …/impact?action=`**(읽기 연산)로 바꿨다. ③ 분리는 **동기 응답**이다(상한 이하 수 초 — Job 경로 없음). ④ 신규 `ApiErrorCode` 4종 · 공개 경로 7곳 불변(`topic-system-설계.md` §16).
````

### A-19. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 오류 봉투 — No.22 오류 코드 4종

**찾을 원문**
````text
나머지 상담 사정(토큰 없음·선점 의심 등)은 중립 안내·봇 경로로 수렴한다 |
````
**바꿀 내용**
````text
나머지 상담 사정(토큰 없음·선점 의심 등)은 중립 안내·봇 경로로 수렴한다. **토픽 시스템 그룹이 4종 추가** — `TOPIC_NOT_EMPTY`(409, 소속 자산이 있는 토픽 삭제 · `details` = 종류별 건수 · FK 경합 `P2003` 매핑), `TOPIC_SYSTEM_NODE_LOCKED`(400, START/FALLBACK 노드에 토픽 지정), `TOPIC_SPLIT_TOO_LARGE`(422, 분리 동기 상한 초과), `TOPIC_SPLIT_BUSY`(409, 분리 트랜잭션 쓰기 경합 — 재시도 가능). 토픽 이름 중복은 `DUPLICATE_NAME`, 챗봇당 50 초과는 `LIMIT_EXCEEDED`, 없는·다른 챗봇 토픽은 `INVALID_REFERENCE`(404), 일괄 1,001건은 `VALIDATION_FAILED`, slug 경합은 `DUPLICATE_SLUG`를 재사용한다. **이 4종도 대화 경로에서는 쓰이지 않는다** — 비활성 토픽은 최종 사용자에게 존재하지 않는다(기존 폴백으로 응답) |
````

### A-20. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 챗봇 스코프 — 토픽의 `ARCHIVED` 규칙

**찾을 원문**
````text
교차 챗봇 `handoffId`·`cannedId`·`sessionRef`는 `404`다 |
````
**바꿀 내용**
````text
교차 챗봇 `handoffId`·`cannedId`·`sessionRef`는 `404`다. **[No.22] 토픽은 조회·영향 미리보기와 분리(원본 읽기 연산)를 `ARCHIVED`에서도 허용**하고, 토픽 쓰기·소속 지정은 `409 CHATBOT_ARCHIVED`다. 교차 챗봇 `topicId`는 경로에서 `404`, 자산의 `topicId`로 지정하면 `404 INVALID_REFERENCE`다 |
````

### A-21. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 복수 선택 쿼리 — `topicIds`의 `common` 예약어

**찾을 원문**
````text
| 복수 선택 쿼리 | 콤마 구분 단일 파라미터(`?status=DRAFT,ACTIVE`) |
````
**바꿀 내용**
````text
| 복수 선택 쿼리 | 콤마 구분 단일 파라미터(`?status=DRAFT,ACTIVE`). **[No.22] 토픽 필터 `?topicIds=common,<uuid>,…`의 `common`은 `topicId = null`(공통) 예약어다. 존재하지 않는 토픽 id는 오류가 아니라 매칭 0이다(삭제된 토픽이 남은 공유 링크)** |
````

### A-22. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 권한 — No.22 권한 보론

**찾을 원문**
````text
OR 가드 신설 0(ADR-0015 갱신 각주, ADR-0036 §7) |
````
**바꿀 내용**
````text
OR 가드 신설 0(ADR-0015 갱신 각주, ADR-0036 §7). **[2026-09-25 No.22] 토픽은 신규 권한 0종이다** — 조회 `dialogue:read` · 토픽 편집·소속 지정·활성 전환 `dialogue:write`(노드 `enabled` 토글과 같은 권한 — 바꾸는 자원 기준) · 분리 `dialogue:read` AND `chatbot:write`(`@RequirePermission` 복수 인자 — 원본 읽기 + 챗봇 생성). 토픽 단위 담당자 권한은 만들지 않는다(No.45 — ADR-0037 §7) |
````

### A-23. [개발명세서 `docs/02-spec/개발명세서.md`] §5 성능 — No.22 항목 추가

**찾을 원문**
````text
위젯 gzip 100KB 유지 · 폴링 분당 20(상담)/12(관찰)/4(숨김)회 상한(ADR-0036).
````
**바꿀 내용**
````text
위젯 gzip 100KB 유지 · 폴링 분당 20(상담)/12(관찰)/4(숨김)회 상한(ADR-0036).
  - **[신규 2026-09-25 — 토픽 시스템] 토픽 없는 챗봇의 공개 대화 예산(P95 500ms)·응답 바이트는 불변**이다(캐시 적중 시 추가 조회 0 — 미스 시 비활성 토픽 id 조회 1회를 기존 7개와 **병렬**로). **토픽 있는 챗봇은 캐시 미스 시 필터 O(n) 5ms 이내**(의도 1,000·노드 500·FAQ 2,000) · 적중 시 0 · 해석 P95 200ms 유지. 관리자 경로 — 토픽 목록 P95 300ms(쿼리 8 고정 — 토픽 수와 무관) · 영향 미리보기 P95 1초(쿼리 10 고정) · 설계 점검 토픽 규칙 추가분 P95 +300ms · 일괄 지정 1,000건 P95 2초(한 트랜잭션) · 분리 미리보기 P95 3초 · **분리 실행 P95 15초**(동기 상한 = 의도 1,000·예문 20,000·노드 500·FAQ 2,000·키워드 2,000·동음이의어 1,000·컨텍스트 200·설문 50 — 초과 `422`) · 목록 6화면 쿼리 수 불변. ⚠ 분리 트랜잭션 동안 SQLite 전체 쓰기가 대기한다 — 쓰기는 `createMany` 500행 청크이며 잠금 시간을 실측·기록한다(ADR-0037). **K-1(번들 결정적 정렬)은 `ORDER BY` 7개 추가로 캐시 미스 비용만 소폭 늘린다**(챗봇당 수천 행 정렬).
````

### A-24. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 토픽 봉인 항목 추가

**찾을 원문**
````text
**[알려진 리스크]** 상담 메시지(마스킹본)의 보존기간도 무기한이다 — No.45.
````
**바꿀 내용**
````text
**[알려진 리스크]** 상담 메시지(마스킹본)의 보존기간도 무기한이다 — No.45.
  - **[신규 2026-09-25] 토픽 시스템의 봉인(ADR-0037)**: ① 공개 응답·위젯 스키마에 토픽 id·이름·활성 여부가 **타입상 없다**(런타임 키 검사) — 비활성 토픽은 최종 사용자에게 존재하지 않는다. ② 비활성 필터는 `getCached()` 1곳, 비필터 번들은 시뮬레이터 1곳이며 캡처·점검·분리는 필터를 쓰지 않는다. ③ **분리는 원본을 한 글자도 바꾸지 않고**(적재기 = `create｜createMany`만), 대화로그·미응답 질문·상담 기록·설문 응답·TC를 복사하지 않는다 — 개인정보가 새 챗봇으로 퍼지지 않는다. ④ 교차 챗봇 토픽은 경로 `404` · 자산 지정 `404 INVALID_REFERENCE` · 분리는 원본 읽기와 챗봇 생성 권한을 모두 재검증한다. ⑤ 감사·오류·로그에 예문·답변 원문 0(건수·id·이름만). ⑥ 위 전부를 `topic-sealing.spec.ts` **T-1~T-16**으로 강제한다.
````

### A-25. [개발명세서 `docs/02-spec/개발명세서.md`] §5 접근성/UI 품질 — 토픽 화면 원칙

**찾을 원문**
````text
비활성 버튼(담당 아님·종료됨)은 사유 텍스트를 병기한다.**
````
**바꿀 내용**
````text
비활성 버튼(담당 아님·종료됨)은 사유 텍스트를 병기한다.** **[No.22] 토픽 구분은 텍스트 이름이 원천이고 색 점은 보조이며, 비활성 토픽은 "비활성" 텍스트 배지로 구분한다. 토픽 순서는 위/아래 버튼, 필터는 기존 다중 선택 드롭다운 규약(방향키·Esc)이다. 비활성화·삭제·분리 확인 대화상자는 포커스 트랩·복귀를 갖고, 영향 미리보기의 "끊기는 참조"는 건수 문장 + 표로 제공하며 확인 버튼은 미리보기 수신 뒤에만 활성화한다. 일괄 지정·분리 결과는 `aria-live="polite"`로 1회 안내하고, 시작·폴백 노드의 토픽 선택은 비활성 + 사유 텍스트다.**
````

### A-26. [개발명세서 `docs/02-spec/개발명세서.md`] §5 확장성 — 토픽이 추가한 프로세스 로컬 상태

**찾을 원문**
````text
연산이 멱등이라 선점이 필요 없다(`PollingLoop` 두 번째 소비자 — ADR-0032).
````
**바꿀 내용**
````text
연산이 멱등이라 선점이 필요 없다(`PollingLoop` 두 번째 소비자 — ADR-0032). **[No.22] 토픽 시스템의 정합성 근거는 DB(토픽 행·자산 `topicId`)다.** 추가된 프로세스 로컬 상태는 **비필터 번들 캐시 인스턴스 1개**(시뮬레이터 전용 · LRU 10 · 기존 `DialogueBundleCache` 인터페이스 재사용)뿐이며 `invalidate()` 1지점이 두 캐시를 함께 비운다 — 다중 인스턴스 수렴은 기존과 같은 60초다. 분리는 DB 트랜잭션 하나로 끝나 인스턴스 간 조정이 없다.
````

### A-27. [개발명세서 `docs/02-spec/개발명세서.md`] §5 가용성 — 분리·복원 규칙

**찾을 원문**
````text
서버 정지 중 지연된 원문 파기는 기동 즉시 1회 실행으로 처리한다(ADR-0036 §5·§6).
````
**바꿀 내용**
````text
서버 정지 중 지연된 원문 파기는 기동 즉시 1회 실행으로 처리한다(ADR-0036 §5·§6). **[신규 2026-09-25] 토픽 분리의 실패는 부분 결과를 남기지 않는다** — 캡처·계획·검증·챗봇 생성·적재가 한 트랜잭션이며, 재매핑 검증 위반(원본 id 잔존)이 1건이라도 있으면 쓰기 전에 거부한다. 분리 직후 새 챗봇의 설계 점검 요약 계산이 실패해도 분리는 성공으로 응답한다. **복원은 없는 토픽을 공통으로 적재하되 대상 스냅샷을 트랜잭션 안에서 먼저 정규화해 사후 해시 검증과 양립시킨다**(ADR-0037 §4).
````

### A-28. [개발명세서 `docs/02-spec/개발명세서.md`] §5 DB 이식성 — 재정의 마이그레이션·원시 SQL 0

**찾을 원문**
````text
Postgres 전환 시 `conversation_logs` 인덱스는 `CREATE INDEX CONCURRENTLY`로 분리 실행한다.
````
**바꿀 내용**
````text
Postgres 전환 시 `conversation_logs` 인덱스는 `CREATE INDEX CONCURRENTLY`로 분리 실행한다. **[No.22] 토픽 시스템은 원시 SQL을 추가하지 않는다**(원시 SQL 보유 파일 4개 불변 — R-7). 자산 6테이블의 FK 컬럼 추가는 SQLite에서 **테이블 재정의** 마이그레이션이 되므로 생성 SQL이 기존 인덱스·조인 FK를 재생성하고 다른 테이블의 원시 부분 유니크 인덱스를 지우지 않는지 확인한다. 소속 일괄 지정의 `updatedAt` 보존은 값별로 묶은 `updateMany`로 표현한다(원시 SQL 없음). 분리 트랜잭션의 경합은 SQLite 쓰기 직렬화에 기대므로 Postgres 전환 시 `Serializable` 지정 대상에 추가하고 직렬화 실패를 `409 TOPIC_SPLIT_BUSY`로 매핑한다.
````

### A-29. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 38 신설

**찾을 원문**
````text
GPU **1 유지**(P-17). → **ADR-0036**(+ ADR-0002·0009·0011·0012·0013·0015·0016·0019·0023·0026·0030·0031·0032·0033 갱신 각주)
````
**바꿀 내용**
````text
GPU **1 유지**(P-17). → **ADR-0036**(+ ADR-0002·0009·0011·0012·0013·0015·0016·0019·0023·0026·0030·0031·0032·0033 갱신 각주)

38. **토픽 시스템(No.22)의 모델·엔진 영향·경계 참조·스냅샷·분리 확정(2026-09-25)**: **① 토픽 = 챗봇 안 평면 분류**(`Topic` · 챗봇당 50 · 자산 6종 nullable `topicId` · null = 공통(항상 활성) · START/FALLBACK 공통 고정 · 이름 유일성 챗봇 단위 유지 · 설문·자주 쓰는 문장 비소속, P-2). **② 엔진 수정 0 — `getCached()` 번들 조립에서 비활성 토픽의 노드·의도·FAQ만 제외**(키워드·컨텍스트·동음이의어 유지 · 의미 매칭 자동 일관 · 재색인 0 · 캡처·점검·흐름·분리는 필터 없음 · 시뮬레이터 비활성 포함은 별도 캐시, P-4·P-13). **③ 경계 참조 허용 + API 계층 점검 4종**(`INACTIVE_TOPIC_REFERENCE`·`CROSS_TOPIC_REFERENCE`·`CROSS_TOPIC_DUPLICATE_EXAMPLE`·`NO_LIVE_ENTRY_POINT`) + 비활성화 전 영향 미리보기(화면 흐름으로 강제) · 참조 열거 1벌(`asset-ref-graph.ts` — 노드 참조는 `getOutgoingNodeRefs()` 호출, 나머지는 UUID 잎)(P-3·P-5). **④ 스냅샷 자산 `topicId` 선택 필드(값 없으면 생략 → 해시 불변 · 스키마 버전 1) · 토픽 정의·활성 상태는 스냅샷 밖 · 복원은 트랜잭션 안 대상 정규화(없는 토픽 → 공통) 후 기대 해시 재계산 · 경고 `TOPIC_MISSING`·`TOPIC_EXPOSURE_CHANGE`**(P-7). **⑤ 분리 = 복사 — ID 재매핑 적재기 3단계**(캡처 → 선택·계획·검증(순수) → 생성 전용 적재) · 의존 폐포(UUID 잎 — API 슬롯 바인딩 참조 포함) · 시작·폴백 노드 연결 잘라내기(기본)/따라가기 · 순서 보존 ID + 타임스탬프 보존(동점 승자 보존) · 참조 설문 정의 복제 · API 연결 유지 · 전체 선택 = 깊은 복사 · 동기 1트랜잭션 + 상한 · No.40·병합이 재사용(P-8). **⑥ 소속 변경은 `updatedAt` 보존**(동점 노드 순위 보존). **⑦ 병합은 2차 — 충돌 기본값만 확정**(의도·키워드 합치기(동의어 충돌 전체 거부) · 노드·컨텍스트 이름 바꿔 추가 · 동음이의어·FAQ 건너뛰기 · dry-run · `BEFORE_MERGE`, P-9). **⑧ 신규 권한 0 · 감사 `Topic`(일괄 지정 요약 1건 · 분리 `COPY`) · `ConversationLog.topicId` 적재(당시 토픽) · 영구삭제 사전검사 14종**(P-10~P-12). **⑨ K-1 번들 조회 결정적 정렬 `(createdAt, id)` — 별도 선행 커밋 + TC 비교 회귀**(P-16) · **K-2 노드 참조 두 벌은 합치지 않고 동등성 시험으로 고정**. 신규 `ApiErrorCode` 4종 · 환경변수 0 · 공개 경로 0. GPU **1 유지**(P-15). → **ADR-0037**(+ ADR-0002·0005·0008·0016·0025·0031 갱신 각주)
````

### A-30. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — 설계서 행 추가

**찾을 원문**
````text
알려진 제한 14건 · 요구사항 대비 해석 20건** | 요구사항: `docs/requirements/hybrid-cs.md` |
````
**바꿀 내용**
````text
알려진 제한 14건 · 요구사항 대비 해석 20건** | 요구사항: `docs/requirements/hybrid-cs.md` |
| **`topic-system-설계.md`** | **토픽 시스템(No.22) — 모듈 배치(`topics` export 1 · `asset-transfer` export 2 · 쓰기 유일 파일 2) · 엔진 수정 0 · K-1 분리 커밋 · Prisma 변경안(`Topic` 신설 + 자산 6종 `topicId` FK·인덱스 + `ConversationLog.topicId`, **비파괴·백필 0 · 자산 6테이블 재정의**) · shared-types(`topic.ts` · 선택 필드 확장) · 토픽 규칙·소속 지정(**`updatedAt` 보존**) · 목록 필터 · **번들 필터 위치·캐시 두 벌·무효화 지점 전수** · 의미 매칭 일관성 · 시뮬레이터 토글 · `ConversationLog.topicId` · **참조 열거 1벌(UUID 잎)·점검 규칙 4종·영향 미리보기** · 토픽 단위 내보내기/가져오기 · **분리 = ID 재매핑 적재기 3단계(폐포·시스템 노드 TRIM·상한·순서 보존 ID·재작성·검증·트랜잭션)** · 병합 충돌 규칙(2차) · **스냅샷 해시 불변 증명·복원 정규화·경고 2종** · K-1 정렬 키·영향 분석 · K-2 판단 · 권한 · 감사 · 11개 엔드포인트·오류 4종 · **봉인 T-1~T-16** · 성능 예산 · 경계 · 콘솔 인계 · 시험 포인트·**의도된 기대값 변경 3건(닫힌 목록)**·K-1 TC 회귀 절차 · 알려진 제한 12건 · 요구사항 대비 해석 18건** | 요구사항: `docs/requirements/topic-system.md` |
````

### A-31. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — ADR-0037 행 추가

**찾을 원문**
````text
FR-CS1-\*~FR-CS11-\*, AC-CS1~CS8 |
````
**바꿀 내용**
````text
FR-CS1-\*~FR-CS11-\*, AC-CS1~CS8 |
| **`decisions/ADR-0037-topic-classification-bundle-filter-and-id-remapping-split.md`** | **토픽 = 챗봇 안 평면 분류(공유 토픽 패키지·계층·다대다 기각) · `getCached()` 번들 조립에서 비활성 토픽의 응답 진입점 3종만 제외(엔진 인자·인덱스 제외·자산 `enabled` 일괄 기각 — 엔진 0) · 경계 참조 허용 + API 계층 점검 · 스냅샷 선택 필드(해시 불변 · 스키마 버전 1) + 복원 대상 정규화 · ★ID 재매핑 적재기 3단계(캡처 → 선택·계획 → 생성 전용 적재 — 복원 적재기와 코드 비공유 · No.40·병합 재사용) · UUID 잎 폐포·재작성 · 시스템 노드 TRIM · 순서 보존 ID · 소속 변경 `updatedAt` 보존 · 신규 권한 0** | 요구사항 J-1~J-18, FR-0-129~137, FR-TP1-\*~FR-TP8-\*, AC-TP1~TP7 |
````

---

## B. 기존 ADR (결정 본문은 수정하지 않는다 — 파일 끝 append)

### B-1. [ADR-0031] `docs/02-spec/decisions/ADR-0031-chatbot-version-snapshot-and-id-preserving-restore.md` — 자산 `topicId` 선택 필드 · 복원 정규화 · 깊은 복사 도입 (append)

**찾을 원문**
````text
진행 중 상담은 복원·예약 복원의 영향을 받지 않는다(봇이 멈춰 있다).
````
**바꿀 내용**
````text
진행 중 상담은 복원·예약 복원의 영향을 받지 않는다(봇이 멈춰 있다).


---

## 갱신 (2026-09-25 — No.22: 자산 `topicId`는 선택 필드 · 복원은 대상 정규화 · 깊은 복사는 ID 재매핑 적재기로 도입)

토픽 시스템(No.22, **ADR-0037 §4·§5**). 스냅샷 범위·ID 보존 복원·단일 트랜잭션·해시 규칙·§8 경계(다른 챗봇으로 **복원** 없음)는 **불변**이다.

1. **자산 6종의 `topicId`는 스냅샷 선택 필드다.** 캡처 번들이 null을 `undefined`로 매핑하고 정규 직렬화가 `undefined` 키를 생략하므로(§5.2 규칙 그대로) 토픽 없는 챗봇의 `contentHash`는 도입 전과 같다. **`SNAPSHOT_SCHEMA_VERSION = 1` 유지 · 업캐스터 불필요** — 과거 본문의 `topicId` 부재는 "공통"과 같은 뜻이다. **`Topic` 정의·활성 상태는 스냅샷 밖**이다(설문·API 연결 선례). 토픽 활성 전환은 해시를 바꾸지 않고, 소속 변경은 바꾼다(예약 해시 바인딩이 보류 — 설계상 올바름).
2. **복원 정규화**: 대상 스냅샷의 `topicId`가 지금 없는 토픽을 가리키면 공통으로 적재한다(PM 결정). 그대로 적재하면 §6의 사후 검증(복원 후 해시 = 대상 해시)이 실패하므로, **트랜잭션 안에서 현재 토픽 id 집합으로 대상 봉투를 정규화한 뒤 그 해시를 기대 해시로** 삼아 `RESTORE_NO_CHANGES` 판정·계획·차이·사후 검증을 한다. START/FALLBACK 노드의 `topicId`도 정규화에서 제거한다(방어). 미리보기 경고 2종(blocker 아님): `TOPIC_MISSING`(공통으로 들어가는 자산 수) · `TOPIC_EXPOSURE_CHANGE`(복원으로 운영 노출이 바뀌는 노드·의도·FAQ 수 — **토픽 도입 전 스냅샷 복원은 모든 자산을 공통으로 되돌려 비활성 토픽 자산을 노출한다**). applier는 생성·갱신에 `topicId`를 쓴다(쓰기 파일은 여전히 applier 1개).
3. **§8 "깊은 복사는 ID 재매핑"의 도입**: No.22 분리(1차-B)가 **캡처 → 선택·계획·검증(순수) → 생성 전용 적재**의 ID 재매핑 적재기(`apps/api/src/asset-transfer/**`)를 만든다. 캡처는 이 ADR의 `build(chatbotId, tx)` 일관 읽기를 그대로 쓰고, **적재 규칙은 정반대(모든 ID 새로 발급)라 복원 applier와 코드를 공유하지 않는다**(정적 검사). 분리는 "다른 챗봇으로 복원"이 아니라 **새 챗봇 생성**이다 — §8 경계는 그대로다.
4. **재검토 트리거 갱신**: "No.40 착수 → 캡처·무결성 검사를 ID 재매핑 적재와 결합"의 적재 부품은 **ADR-0037 §5로 이미 존재**한다. No.40은 여기에 "기존 대상과의 차이 적용"을 더한다.
````

### B-2. [ADR-0005] `docs/02-spec/decisions/ADR-0005-dialog-node-reference-join-tables.md` — 토픽 소속 FK · 참조 열거 1벌 · K-2 (append)

**찾을 원문**
````text
본 ADR의 조인 테이블 패턴을 그대로 재사용한다.
````
**바꿀 내용**
````text
본 ADR의 조인 테이블 패턴을 그대로 재사용한다.


---

## 갱신 (2026-09-25 — No.22: 토픽 소속은 FK 컬럼 · API 계층 참조 열거 1벌 · 노드 참조 두 벌은 동등성 시험으로 고정)

토픽 시스템(No.22, **ADR-0037**). 조인 테이블·`contextVariableId` FK·아웃풋 JSON 참조 결정은 **불변**이다.

1. **자산 6종 → `Topic`은 단일 열 FK(`topicId`, `Restrict`)**다 — 자산당 토픽 0~1개라 조인 테이블이 필요 없다. 비어 있지 않은 토픽 삭제를 DB가 막는다(사전검사 `409 TOPIC_NOT_EMPTY` + `P2003` 매핑). 교차 챗봇 토픽은 서비스 1곳이 막는다(복합 FK 기각 — `chatbotId`를 두 관계가 공유하면 관계 쓰기가 까다롭다).
2. **아웃풋 JSON 참조 목록에 누락이 있었다** — v2 `API_CONDITION`의 슬롯 바인딩(`bindings[].contextVariableId`)이 컨텍스트를 가리킨다(E-12). 토픽 점검·영향 미리보기·분리 폐포는 이런 누락에 강하도록 **API 계층 참조 열거 1벌(`dialogue-common/lib/asset-ref-graph.ts`)**을 쓴다 — 노드→노드는 `getOutgoingNodeRefs()`를 호출하고, 나머지 JSON 참조는 **번들 자산 id와 정확히 같은 UUID 문자열 잎**으로 찾는다. 분리·병합의 참조 재작성도 같은 잎 규칙이다(새 참조 종류가 생겨도 갱신 불필요).
3. **K-2 — 노드→노드 참조 추출 두 벌**(`getOutgoingNodeRefs()` vs 저장 검증): 저장 검증은 오류 상세에 필드 경로가 필요하고 엔진은 이번에 수정하지 않으므로 **합치지 않는다.** 대신 저장 검증의 수집을 `dialog-nodes/lib/node-target-refs.ts`로 동작 불변 추출하고 **동등성 시험**(모든 아웃풋 유형에서 두 id 집합이 같다)으로 고정한다. 단일화 트리거 = 엔진을 닫힌 목록으로 수정하는 다음 그룹이 `getOutgoingNodeRefs()`에 위치 정보를 더할 때.
4. 새 참조 종류 추가 체크리스트(5곳)를 개발명세서 §3.1에 둔다.
````

### B-3. [ADR-0016] `docs/02-spec/decisions/ADR-0016-audit-log-backfill-scope.md` — `Topic` 대상 · 일괄 지정 요약 1건 (append)

**찾을 원문**
````text
4. 상담 설정 저장은 답변 설정과 같은 경로(`Chatbot` `UPDATE`, summary `상담 연계 설정 변경`, 안내 문구는 길이만).
````
**바꿀 내용**
````text
4. 상담 설정 저장은 답변 설정과 같은 경로(`Chatbot` `UPDATE`, summary `상담 연계 설정 변경`, 안내 문구는 길이만).


---

## 갱신 (2026-09-25 — No.22: `Topic` 대상 · 일괄 지정은 summary 1건 · 분리는 기존 `COPY`)

토픽 시스템(No.22, **ADR-0037 §7**). 기록 위치·트랜잭션 경계·화이트리스트 규약은 불변이다.

1. **`AuditTargetType`에 `Topic`**(라벨 "토픽", 20 → 21종). 생성 `CREATE` · 이름·설명·순서 `UPDATE` · 활성 전환 `STATUS_CHANGE`(상태가 실제로 바뀔 때만) · 삭제 `DELETE`. `AUDIT_FIELDS.Topic = ['name','description','sortOrder','enabled']`. **`AuditAction` 추가 0.**
2. **자산 1건의 소속 변경**은 그 자산의 기존 `UPDATE` 감사다 — 자산 6종 화이트리스트에 `'topicId'`를 더하되, **서비스는 값이 null이면 스냅샷 입력에 넣지 않는다**(토픽 없는 챗봇의 감사 본문 불변).
3. **일괄 지정(최대 1,000건)은 대상 토픽(공통이면 `Chatbot`)에 `UPDATE` 1건**이며 before/after 없이 **summary 문자열**에 종류·건수·대상 토픽 이름만 담는다(자산 이름 목록·원문 0). 요약 액션 분기(`BULK_DELETE`·`IMPORT`·`RESTORE`)를 늘리지 않고 화이트리스트도 우회하지 않는다. "공통으로 옮기고 삭제"는 요약 `UPDATE` + `DELETE` 2건이다.
4. **분리는 새 `Chatbot`에 기존 `COPY` 1건**(after = 챗봇 행 — 기존 `copy()`와 같음, summary에 원본 id 앞 8자·토픽 수·종류별 건수·동반 수·잘라낸 연결 수). 원본에는 기록하지 않는다(변경 없음).
5. 영향 미리보기·분리 미리보기·토픽 목록은 읽기라 기록하지 않는다.
````

### B-4. [ADR-0002] `docs/02-spec/decisions/ADR-0002-permanent-delete-referential-integrity.md` — 사전검사 13 → 14종 (append)

**찾을 원문**
````text
상담 기록은 단건으로도 삭제할 수 없다.
````
**바꿀 내용**
````text
상담 기록은 단건으로도 삭제할 수 없다.


---

## 갱신 (2026-09-25 — No.22: 사전검사 대상 13 → 14종 · 비어 있지 않은 토픽 삭제 409)

토픽 시스템(No.22, **ADR-0037 §1**)에 따라 결정 3의 사전검사 목록에 **`topics`('토픽')**를 추가한다(13 → 14종). 결정 1~6은 불변이다.

- 토픽은 대화 자산의 분류 정의라 **"하위 데이터 제거"(동반 삭제) 분류가 아니다**.
- 토픽 단건 삭제는 **소속 자산 0건일 때만** 허용한다(`409 TOPIC_NOT_EMPTY` + 종류별 건수). 자산 6종의 `topicId` FK가 `Restrict`라 DB가 최종 방어선이다(경합 `P2003` → 같은 코드). "공통으로 옮기고 삭제"는 한 트랜잭션에서 소속을 비운 뒤 지운다 — 암묵적 cascade·`SetNull`을 쓰지 않는다.
````

### B-5. [ADR-0008] `docs/02-spec/decisions/ADR-0008-dialogue-resolution-pipeline.md` — 번들 입력의 비활성 진입점 제외 · K-1 결정적 순서 (append)

**찾을 원문**
````text
5. 엔진 수정은 ADR-0035 §3의 **닫힌 목록 9항목**이며 엔진 I/O 0건 정적 검사가 계속 단언한다.
````
**바꿀 내용**
````text
5. 엔진 수정은 ADR-0035 §3의 **닫힌 목록 9항목**이며 엔진 I/O 0건 정적 검사가 계속 단언한다.


---

## 갱신 (2026-09-25 — No.22: 번들은 비활성 토픽 진입점이 빠진 채 들어온다 · 번들 순서는 결정적이다(K-1))

토픽 시스템(No.22, **ADR-0037 §2**). §1~§8의 결정은 불변이며 **엔진 수정 0**이다.

1. **파이프라인 입력**: `getCached()` 경로(공개 대화·시뮬레이터·비교·TC·힌트·답변 설정 미리보기)의 번들에서는 **비활성 토픽에 속한 노드·의도·FAQ가 이미 빠져 있다.** 엔진은 이를 모른다 — 빠진 노드로 가는 이동은 §6의 `BROKEN_REFERENCE` trace + 그 아웃풋만 건너뜀, 빠진 의도는 조건 불일치로 처리된다(기존 동작). 키워드·컨텍스트·동음이의어는 빠지지 않는다. 설계 점검·흐름은 필터 없는 번들로 호출된다.
2. **K-1 — 번들 순서의 결정성**: 번들 조립의 7개 조회에 `orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]`를 둔다(별도 선행 커밋). 지금까지 순서는 DB가 고른 인덱스 순서였고, 의도·FAQ 매칭은 **동점이면 먼저 본 항목**이 이기므로 동점 승자가 DB 행 순서(편집·복원으로 바뀔 수 있다)에 달려 있었다. 이제 동점 승자는 **먼저 생성된 자산**이며 복원(`createdAt` 보존)·분리(타임스탬프·ID 순서 보존) 후에도 같다. 노드 순위(`rankNodes` — `id asc` 최종)·의미 순위·스냅샷 해시(`byIdAsc`)는 영향이 없다. 적용 전후 TC 비교로 차이가 동점 케이스뿐임을 확인한다.
````

### B-6. [ADR-0025] `docs/02-spec/decisions/ADR-0025-augmentation-output-and-suggestion-asset-separation.md` — 자산 쓰기 봉인 S-1 허용 파일 3 → 5 (append)

**찾을 원문**
````text
`restore(` 호출 파일이 정확히 2개임을 `deploy-schedule-sealing.spec.ts`가 단언한다.
````
**바꿀 내용**
````text
`restore(` 호출 파일이 정확히 2개임을 `deploy-schedule-sealing.spec.ts`가 단언한다.


---

## 갱신 (2026-09-25 — No.22: 자산 쓰기 봉인 L2/S-1 허용 파일 3 → 5 · 쓰기 패턴에 `createMany` 편입)

토픽 시스템(No.22, **ADR-0037 §5·§6**)이 `Intent`·`Keyword` 테이블을 쓰는 파일 2개를 더한다. `asset-write-sealing.spec.ts` **S-1**의 허용 파일이 **3 → 5**가 되고, 쓰기 패턴에 **`createMany`를 편입**한다(지금까지 두 테이블의 `createMany` 호출이 0건이라 편입 자체로 걸리는 기존 파일은 없다 — 새 적재기가 봉인을 우회하지 못하게 한다).

- **`topics/topic-assignment.service.ts`** — 쓰는 필드는 **`topicId`(+ 보존용 `updatedAt`)뿐**이다(`topic-sealing.spec.ts` T-7이 `data` 키를 제한). 예문·동의어를 쓰지 않으므로 "승인 없는 예문 주입" 경로가 아니다.
- **`asset-transfer/asset-transfer.loader.ts`** — **새 챗봇에만, 원본 챗봇에 실제로 존재하는 자산의 복사본만** 생성한다(`create｜createMany`만 — T-5). 외부 문장·제안이 들어올 입력이 없다.
- **L1·L3·L4는 불변**이다: 두 모듈은 `IntentsModule`·`KeywordsModule`·`AugmentationModule`을 import하지 않고(L1), `applyLearningExample()`을 호출하지 않는다(L3 — S-2 불변).
````

---

## C. `docs/01-requirements/기능요구사항.md`

### C-1. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §3 No.22 행 — 설계 완료 반영

**찾을 원문**
````text
| 22 | 대화 설계(빌더) | 토픽 시스템(멀티 온톨로지) | 부서·주제별 토픽 분리 구축 후 개별 챗봇화 또는 병합/확장 | 1 | 구조적 데이터 분리 관리 | ○ | ○ | - |
````
**바꿀 내용**
````text
| 22 | 대화 설계(빌더) | 토픽 시스템(멀티 온톨로지) | 부서·주제별 **토픽**으로 챗봇 안의 대화 자산 6종을 분류(필터·일괄 지정·**토픽 활성/비활성**·교차 참조 점검·토픽 단위 내보내기/가져오기) + **토픽 → 새 챗봇 분리**(복사·ID 재매핑·원본 불변 — 전체 선택 시 챗봇 깊은 복사) + 병합(2차) | 1 | 구조적 데이터 분리 관리(새 모델 0) | ○ | ○ | **설계 완료(2026-09-25, `docs/02-spec/topic-system-설계.md` · ADR-0037).** 원문 "부서·주제별 토픽 분리 구축 후 개별 챗봇화 또는 병합/확장"(제품소개서 p.17·18). 엔진 수정 0(비활성 토픽은 번들 조립에서 노드·의도·FAQ만 제외) · 경계 참조 허용 + 점검 · 스냅샷 선택 필드(해시 불변) · 병합은 충돌 규칙만 확정(2차) · 여러 챗봇 공유 토픽·토픽 우선 라우팅은 후속 · 토픽 단위 권한은 No.45 · 그룹 계층은 No.1 고도화 |
````

### C-2. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §2 No.1 행 — 깊은 복사 각주

**찾을 원문**
````text
| 1 | 챗봇 운영관리 | 챗봇 리스트/그룹 관리 | 다수 챗봇을 그룹(폴더)으로 생성·조회·복사·삭제 |
````
**바꿀 내용**
````text
| 1 | 챗봇 운영관리 | 챗봇 리스트/그룹 관리 | 다수 챗봇을 그룹(폴더)으로 생성·조회·복사·삭제 (자산 포함 복사(깊은 복사)는 No.22 분리 경로의 "전체 토픽 + 공통" 선택으로 제공 · 그룹 계층화는 No.1 고도화 — 2026-09-25) |
````

### C-3. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 No.40 행 비고 — 적재기 선행 표식

**찾을 원문**
````text
"포인터 전환" 동작 유형 1개**를 추가해 결합한다(ADR-0032) |
````
**바꿀 내용**
````text
"포인터 전환" 동작 유형 1개**를 추가해 결합한다(ADR-0032). **[2026-09-25] ID 재매핑 적재기(캡처 → 선택·계획 → 생성 전용 적재)는 No.22가 먼저 도입했다 — No.40은 이를 재사용해 "기존 대상과의 차이 적용"을 더한다(ADR-0037 §5)** |
````

---

## D. `docs/requirements/topic-system.md` — PM 결정 기록 · 설계 반영

### D-1. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] §1.9 핵심 판단 표 머리 — PM 결정 표기

**찾을 원문**
````text
### 1.9 이 문서의 핵심 판단 18건 (⚠ = PM 확인 필요)
````
**바꿀 내용**
````text
### 1.9 이 문서의 핵심 판단 18건 (⚠ = PM 확인 필요)

> **PM 결정(2026-09-25)** — ⚠ 표시 항목을 포함해 아래 "판단" 열이 **전부 권고안대로 확정**되었다(§11 P-1~P-16). J-14·J-15·J-16은 architect 확정 사항이며, architect는 다음을 요구사항 대비 조정했다(설계서 §25): 소속 변경 `updatedAt` **보존**(J-2·FR-TP2-6) · 복원 대상 정규화(J-9) · 분리 폐포의 UUID 잎 규칙과 시작·폴백 노드 연결 잘라내기(J-10) · 오류 코드 4종(FR-0-134). 세부 설계: `docs/02-spec/topic-system-설계.md` · ADR-0037.
````

### D-2. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] §11 PM 확인 항목 — 결정 기록

**찾을 원문**
````text
## 11. PM 확인이 필요한 항목
````
**바꿀 내용**
````text
## 11. PM 확인이 필요한 항목

> **PM 결정(2026-09-25)** — 전부 권고안을 채택했다.
>
> | # | PM 결정(2026-09-25) |
> |---|---|
> | P-1 | **(d) 단계 도입.** 1차-A = 챗봇 안 토픽(분류·필터·일괄 지정·활성/비활성·교차 참조 점검·토픽 단위 내보내기/가져오기) · 1차-B = **토픽 → 새 챗봇 분리(복사)** · **병합은 2차**(충돌 규칙 P-9는 지금 확정·문서화, 구현 안 함) |
> | P-2 | **평면** · 자산당 0~1개(nullable `topicId`) · null = **"공통"**(항상 활성) · 챗봇당 50 · 대상 6종(의도·키워드·동음이의어·컨텍스트·FAQ·노드 — 설문·자주 쓰는 문장 제외) · START/FALLBACK 공통 고정 · 이름 유일성 챗봇 단위 유지 |
> | P-3 | 경계 참조 **허용** · 저장 검증 불변 · API 계층 점검 규칙 추가 · 엔진 `validateDesign` 불변 · **비활성화 전 영향 미리보기 필수** |
> | P-4 | **엔진 수정 0** · `getCached()` 경로 번들 조립에서 비활성 토픽의 노드·의도·FAQ만 제외 · 의미 매칭은 번들 기준 자동 일관(재색인 불필요) · 분류기는 대화 경로 밖 · 캡처·점검은 전체 자산 |
> | P-5 | 토픽 우선순위 없음 · 기존 예문 중복 경고에 토픽 이름 |
> | P-6 | 대화설계 서브내비 **8번째 "토픽"** · 최상위 메뉴 없음 · 기존 목록 6화면에 토픽 필터·열·일괄 지정 |
> | P-7 | 스냅샷 자산 `topicId` **선택 필드**(값 없으면 생략 → 기존 `contentHash` 불변) · `Topic` 정의·활성 상태는 스냅샷 밖 · 복원 시 없는 토픽 → 공통 + 경고 |
> | P-8 | **분리 = 복사** · 원본 불변 · 새 챗봇 DRAFT · 모든 ID 새로 발급 · 토픽 밖 참조 자산·START/FALLBACK 동반 · 참조 설문은 정의만 복제 · API 연결은 그대로 참조 · 전체 선택 = 깊은 복사 · No.40과 ID 재매핑 적재기 부품 공유 |
> | P-9 | 병합 충돌 기본값(2차용 · 문서만): 의도·키워드 **합치기**(동의어 충돌 시 전체 거부) · 노드·컨텍스트 **이름 바꿔 추가** · 동음이의어·FAQ **건너뛰고 리포트** · dry-run · `BEFORE_MERGE` 스냅샷 |
> | P-10 | 신규 권한 0 · 토픽 편집 `dialogue:write` · 분리 `chatbot:write` |
> | P-11 | 감사 `Topic` 대상 추가 · 일괄 지정 요약 1건 · 분리 = 기존 `COPY` 1건 |
> | P-12 | `ConversationLog.topicId`(대화 당시 토픽) **지금부터 적재** · 1차 통계 화면 없음 |
> | P-13 | 시뮬레이터에만 "비활성 토픽 포함" 토글 · TC 실행 제외 |
> | P-14 | 그룹 계층화 = No.1 고도화 반납 · `dialogue-design.md` 657행 범위 안 · 토픽 단위 권한 = No.45 |
> | P-15 | GPU 1 |
> | P-16 | K-1 결정적 정렬 + TC 회귀를 **별도 선행 커밋**으로(정렬 키 `(createdAt, id)` · 영향 분석·회귀 절차는 설계서 §12·§21.3). K-2(노드 참조 두 벌)는 architect가 "합치지 않고 동등성 시험으로 고정"으로 결정(설계서 §13) |
>
> **architect 확정·조정**(설계서 §25): 소속 변경 `updatedAt` 보존(D-3) · 복원 대상 정규화 + 경고 `TOPIC_EXPOSURE_CHANGE` 추가(D-4) · UUID 잎 폐포(E-12 포함, D-5) · 시작·폴백 노드 연결 TRIM 기본/FOLLOW 선택(D-6 — **PM 확인 대기**) · 영향 미리보기 필수 = 화면 흐름 강제(D-7) · 경로 2건 변경(D-8) · 오류 코드 4종(D-9) · 분리본 타임스탬프·ID 순서 보존(D-11).
````

### D-3. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] FR-0-134 — 오류 코드 확정

**찾을 원문**
````text
`TOPIC_SPLIT_TOO_LARGE`(413/422 — 분리 동기 상한 초과, architect 확정)
````
**바꿀 내용**
````text
`TOPIC_SPLIT_TOO_LARGE`(413/422 — 분리 동기 상한 초과, architect 확정) **[architect 확정 2026-09-25] 신규 4종 = `TOPIC_NOT_EMPTY`(409)·`TOPIC_SYSTEM_NODE_LOCKED`(400)·`TOPIC_SPLIT_TOO_LARGE`(422)·`TOPIC_SPLIT_BUSY`(409, 분리 경합 — 재시도 가능). ~~`DUPLICATE_TOPIC_NAME`~~ → 기존 `DUPLICATE_NAME`(409), ~~`TOPIC_LIMIT_EXCEEDED`~~ → 기존 `LIMIT_EXCEEDED`(409) 재사용(설문·자주 쓰는 문장과 같은 코드 — 설계서 §16.3)**
````

### D-4. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] FR-0-136 — 의도된 기대값 변경 목록 확정

**찾을 원문**
````text
| FR-0-136 | **의도된 기대값 변경(목록 고정 — architect가 전수 확인해 닫힌 목록으로 확정)**:
````
**바꿀 내용**
````text
| FR-0-136 | **[확정 2026-09-25 — 설계서 §21.2 닫힌 목록 X-1~X-3: `asset-write-sealing.spec.ts` S-1 허용 파일 3 → 5 + `createMany` 편입 · `chatbots.service.spec.ts` Prisma 목에 `topic.count`(단언 변경 0) · `public-decorator-count.spec.ts` 컨트롤러 32 → 34(`@Public` 7 불변). K-1 선행 커밋의 목록은 비어 있다] 초안:** **의도된 기대값 변경(목록 고정 — architect가 전수 확인해 닫힌 목록으로 확정)**:
````

### D-5. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] AC-TP1-3 — 오류 코드 재사용 반영

**찾을 원문**
````text
Then `409 DUPLICATE_TOPIC_NAME`이다. 51번째 토픽 생성은 `409 TOPIC_LIMIT_EXCEEDED`다.
````
**바꿀 내용**
````text
Then `409 DUPLICATE_NAME`이다(~~`DUPLICATE_TOPIC_NAME`~~ — 기존 코드 재사용, FR-0-134 확정). 51번째 토픽 생성은 `409 LIMIT_EXCEEDED`다(~~`TOPIC_LIMIT_EXCEEDED`~~).
````

### D-6. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] FR-TP1-4 — 조회 방식 확정

**찾을 원문**
````text
조회 쿼리 수는 토픽 수와 무관하게 고정한다(`groupBy` — NFR-TPP2).
````
**바꿀 내용**
````text
조회 쿼리 수는 토픽 수와 무관하게 고정한다(~~`groupBy`~~ **→ 필터 없는 번들 조립 1회(7) + 토픽 1 = 8 고정 · 자산 수·교차 참조 수를 순수 함수로 한 번에 계산** — 교차 참조 수가 어차피 전체 참조 그래프를 요구한다, 설계서 §25 D-1 — NFR-TPP2).
````

### D-7. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] FR-TP2-6 — `updatedAt` 보존 확정

**찾을 원문**
````text
(`updatedAt`은 갱신 허용 — architect 확정)
````
**바꿀 내용**
````text
(~~`updatedAt`은 갱신 허용~~ **[architect 확정] `updatedAt`도 보존한다** — 엔진 노드 순위가 `updatedAt desc`로 동점을 가르므로 분류만 바꿔도 동점 노드의 승자가 바뀐다. 일괄 지정은 `updatedAt` 값별로 묶은 `updateMany`, 단건은 바뀌는 필드가 `topicId`뿐일 때 명시 보존 — 설계서 §5.2)
````

### D-8. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] FR-TP3-3 — "필수"의 강제 방식

**찾을 원문**
````text
| FR-TP3-3 | ★ **영향 미리보기**(비활성화 전 필수, 활성화 전 권장):
````
**바꿀 내용**
````text
| FR-TP3-3 | ★ **영향 미리보기**(비활성화 전 필수, 활성화 전 권장 — **[architect 확정] "필수"는 화면 흐름으로 강제**(확인 버튼은 미리보기 수신 뒤 활성) · 서버는 증빙을 요구하지 않는다 · 경로 `GET …/topics/:topicId/impact?action=` — 설계서 §7.4):
````

### D-9. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] FR-TP6-11 — 동기 상한 수치 확정

**찾을 원문**
````text
(비동기 작업화는 범위 밖 — architect가 상한 수치 확정)
````
**바꿀 내용**
````text
(비동기 작업화는 범위 밖 — architect가 상한 수치 확정) **[확정] 복사 대상 합계(선택 + 폐포 + 시스템 노드) 기준 의도 1,000 · 예문 20,000 · 노드 500 · FAQ 2,000 · 키워드 2,000 · 동음이의어 1,000 · 컨텍스트 200 · 설문 50 — 초과 `422 TOPIC_SPLIT_TOO_LARGE`(details = 종류·건수·상한). 전체 복사(깊은 복사)도 같은 상한(설계서 §9.4)**
````

### D-10. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] FR-TP6-1 — `ARCHIVED` 원본 분리 확정

**찾을 원문**
````text
원본 `ARCHIVED`여도 분리 가능(읽기 연산) — architect 확인.
````
**바꿀 내용**
````text
원본 `ARCHIVED`여도 분리 가능(읽기 연산) — architect 확인. **[확정] 허용 — 보관 챗봇에서 부서 챗봇을 되살리는 경로다. 새 챗봇은 `DRAFT`, 보관 그룹 지정은 `404`(설계서 §9.6·§25 D-18)**
````

### D-11. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] FR-TP8-5 — 복원 정규화·경고 확정

**찾을 원문**
````text
버전 차이 화면에 "토픽 이동 n건"을 표시한다(권고 — architect).
````
**바꿀 내용**
````text
버전 차이 화면에 "토픽 이동 n건"을 표시한다(권고 — architect). **[architect 확정] ① 원안대로 공통 적재하면 복원 사후 해시 검증이 실패하므로 트랜잭션 안에서 대상 스냅샷을 현재 토픽 기준으로 정규화한 뒤 그 해시를 기대 해시로 쓴다 ② 경고 `TOPIC_EXPOSURE_CHANGE`(복원으로 운영 노출이 바뀌는 노드·의도·FAQ 수 — 토픽 도입 전 스냅샷 복원 시 비활성 토픽 자산 노출) 추가 ③ 버전 차이는 별도 요약 없이 기존 필드 차이로 `topicId` 변경을 표시(콘솔 라벨 "토픽") — 설계서 §11**
````

### D-12. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] §1.3.2 참조 엣지 표 — E-12 추가

**찾을 원문**
````text
| E-11 | 대화로그·미응답·증강 제안 → 의도/노드/FAQ | FK 없음 | — | — | 과거 기록(불변) |
````
**바꿀 내용**
````text
| E-11 | 대화로그·미응답·증강 제안 → 의도/노드/FAQ | FK 없음 | — | — | 과거 기록(불변) |
| E-12 | 노드(v2 `API_CONDITION` 슬롯 바인딩 `bindings[].contextVariableId`) → 컨텍스트 | JSON | (architect 확인 2026-09-25 — 요구사항 초안 누락분) | — | 바인딩 값 없음 → 실패 분기 |
````

### D-13. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] §1.3.8 K-1 행 — PM 결정 기록

**찾을 원문**
````text
**별도 커밋 + TC 회귀 실행**으로 적용할지 PM 결정(P-16) |
````
**바꿀 내용**
````text
**별도 커밋 + TC 회귀 실행**으로 적용할지 PM 결정(P-16) — **[PM 결정 2026-09-25] 별도 선행 커밋으로 적용. 정렬 키 `[{ createdAt: 'asc' }, { id: 'asc' }]` · 영향은 동점 매칭에서만 · 적용 전후 `test-runs/compare`로 차이가 동점 케이스뿐임을 확인(설계서 §12·§21.3)** |
````

### D-14. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] §1.3.8 K-2 행 — architect 결정 기록

**찾을 원문**
````text
결함 목록 등록만. 이 그룹은 `getOutgoingNodeRefs()`만 사용 |
````
**바꿀 내용**
````text
결함 목록 등록만. 이 그룹은 `getOutgoingNodeRefs()`만 사용 — **[architect 결정 2026-09-25] 합치지 않는다(엔진 수정 0 · 저장 검증은 필드 경로가 필요). 저장 검증의 수집을 `dialog-nodes/lib/node-target-refs.ts`로 동작 불변 추출하고 두 목록의 id 집합이 같음을 동등성 시험으로 고정한다. 이 그룹의 폐포·재작성은 UUID 잎 규칙이라 세 번째 목록을 만들지 않는다(설계서 §13 · ADR-0005 갱신 각주)** |
````

### D-15. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] §5.4 API 표 — 토픽 행 경로 확정

**찾을 원문**
````text
`POST …/topics/reorder` · `DELETE …/topics/:topicId?moveToCommon=true`
````
**바꿀 내용**
````text
~~`POST …/topics/reorder`~~ **`POST …/topics/:topicId/move`(architect 확정)** · `DELETE …/topics/:topicId?moveToCommon=true`
````

### D-16. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] §5.4 API 표 — 영향 미리보기 경로 확정

**찾을 원문**
````text
| 활성 | `POST …/topics/:topicId/impact-preview`
````
**바꿀 내용**
````text
| 활성 | ~~`POST …/topics/:topicId/impact-preview`~~ **`GET …/topics/:topicId/impact?action=ENABLE｜DISABLE`(architect 확정 — 읽기 연산)**
````

### D-17. [토픽 시스템 요구사항 `docs/requirements/topic-system.md`] §12 인계 — system-architect 행 완료 표식

**찾을 원문**
````text
| **`system-architect`** | ① **ADR-0037** 작성
````
**바꿀 내용**
````text
| **`system-architect`** | **[완료 2026-09-25 — `docs/02-spec/topic-system-설계.md` · ADR-0037 · `topic-system-patches.md`. 다음 인계: backend-implementer는 ① K-1 선행 커밋(§12·§21.3 회귀 절차) → ② 본체 순서로 진행]** ① **ADR-0037** 작성
````

---

## E. 선행 요구사항 문서 — No.22 인계 정정

### E-1. [챗봇 운영관리 요구사항 `docs/requirements/chatbot-operations.md`] 범위 밖 표 — 그룹 계층화 반납

**찾을 원문**
````text
1단계 평면 그룹만 지원. 계층화는 No.22(토픽 시스템) 검토 시 |
````
**바꿀 내용**
````text
1단계 평면 그룹만 지원. 계층화는 No.22(토픽 시스템) 검토 시 **[정정 2026-09-25 — No.22와 무관: 그룹 = 챗봇의 그릇, 토픽 = 챗봇 안 자산의 그릇(다른 축). 그룹 계층화는 No.1 고도화로 반납 — `topic-system.md` T-1·P-14]** |
````

### E-2. [대화 설계 요구사항 `docs/requirements/dialogue-design.md`] 범위 밖 표 — 토픽 시스템 이행

**찾을 원문**
````text
| 토픽 시스템(멀티 온톨로지)·부서별 토픽 분리 | No.22 |
````
**바꿀 내용**
````text
| 토픽 시스템(멀티 온톨로지)·부서별 토픽 분리 | No.22 **[설계 완료 2026-09-25 — 챗봇 안 평면 토픽 · 비활성 토픽은 번들 조립에서 제외(엔진 0) · `topic-system-설계.md` · ADR-0037]** |
````

### E-3. [대화 설계 요구사항 `docs/requirements/dialogue-design.md`] 범위 밖 표 — 챗봇 간 자산 이관

**찾을 원문**
````text
이번엔 CSV 내보내기/가져오기로 우회(FR-6-30). 전용 마이그레이션 기능은 후속 |
````
**바꿀 내용**
````text
이번엔 CSV 내보내기/가져오기로 우회(FR-6-30). 전용 마이그레이션 기능은 후속 **[부분 이행 2026-09-25 No.22 — 토픽 → 새 챗봇 분리(복사·ID 재매핑, 전체 선택 = 깊은 복사)가 첫 구현. 기존 챗봇으로 옮겨 넣기(병합)는 2차 — 충돌 규칙은 `topic-system-설계.md` §10]** |
````

### E-4. [보안/이력 요구사항 `docs/requirements/security-audit.md`] J-7 — No.22 결과

**찾을 원문**
````text
②는 No.22(토픽 시스템)·No.45(데이터 거버넌스)와 함께 설계해야 한다. §9.1 |
````
**바꿀 내용**
````text
②는 No.22(토픽 시스템)·No.45(데이터 거버넌스)와 함께 설계해야 한다. §9.1 **[2026-09-25] No.22는 토픽 단위 권한·멀티테넌시를 만들지 않았다(토픽 = 자산 분류 · 모든 EDITOR가 모든 토픽 편집) — ②는 No.45로 이관(`topic-system.md` T-4)** |
````

### E-5. [보안/이력 요구사항 `docs/requirements/security-audit.md`] 범위 밖 표 — 사용자 그룹 테이블

**찾을 원문**
````text
기본기능 1개에 담을 범위가 아니다 | No.22(토픽 시스템)·No.45와 함께 설계 |
````
**바꿀 내용**
````text
기본기능 1개에 담을 범위가 아니다 | No.22(토픽 시스템)·No.45와 함께 설계 **[2026-09-25 — No.22 범위 밖 확정 → No.45]** |
````

### E-6. [통합 통계 요구사항 `docs/requirements/integrated-stats.md`] 범위 밖 표 — 의도 체계 공유 트리거

**찾을 원문**
````text
| 의도 체계 공유(No.22 토픽 시스템) 도입 시 |
````
**바꿀 내용**
````text
| 의도 체계 공유(No.22 토픽 시스템) 도입 시 **[2026-09-25 트리거 미발동 — No.22 1차는 의도를 공유하지 않는다(토픽은 챗봇 안 분류 · 분리는 복사라 챗봇 간 의도 id 동일성이 없다). 공유 토픽 패키지 도입 시 재검토]** |
````

### E-7. [버전 이력 요구사항 `docs/requirements/version-history.md`] J-12 — 깊은 복사 도입처

**찾을 원문**
````text
깊은 복사 자체는 **No.40(쌍둥이 챗봇) 또는 No.1 고도화**의 몫이다 |
````
**바꿀 내용**
````text
깊은 복사 자체는 **No.40(쌍둥이 챗봇) 또는 No.1 고도화**의 몫이다 **[2026-09-25 — No.22 분리 경로(전체 토픽 + 공통 선택)로 도입. 캡처는 이 그룹의 `build(chatbotId, tx)`를 재사용하고 적재는 ID 재매핑 적재기(ADR-0037 §5)]** |
````

### E-8. [버전 이력 요구사항 `docs/requirements/version-history.md`] 경계 표 — No.1 챗봇 복사

**찾을 원문**
````text
변경하지 않는다. 깊은 복사는 **캡처 + ID 재매핑**으로 향후 가능(J-12) |
````
**바꿀 내용**
````text
변경하지 않는다. 깊은 복사는 **캡처 + ID 재매핑**으로 향후 가능(J-12) **[2026-09-25 이행 — No.22 분리. `copy()`(프로필만)는 여전히 불변]** |
````

### E-9. [버전 이력 요구사항 `docs/requirements/version-history.md`] 범위 밖 표 — 다른 챗봇으로 복원 / 깊은 복사

**찾을 원문**
````text
| No.40 또는 No.1 고도화 — 캡처 + ID 재매핑 |
````
**바꿀 내용**
````text
| No.40 또는 No.1 고도화 — 캡처 + ID 재매핑 **[2026-09-25 — 깊은 복사는 No.22에서 도입(분리 = 새 챗봇 생성). "다른 챗봇으로 복원"은 여전히 없음(ADR-0031 §8)]** |
````

### E-10. [하이브리드 CS 요구사항 `docs/requirements/hybrid-cs.md`] 범위 밖 표 — 챗봇별 상담원 배정

**찾을 원문**
````text
| 멀티 테넌트·부서 분리 요구(No.22·45) |
````
**바꿀 내용**
````text
| 멀티 테넌트·부서 분리 요구(No.22·45) **[2026-09-25 — No.22 범위 밖 확정(토픽은 사람의 담당 범위가 아니다) → No.45]** |
````

---

## Z. 적용 후 확인 체크리스트

- [ ] A-1~A-31 · B-1~B-6 · C-1~C-3 · D-1~D-17 · E-1~E-10 각 "찾을 원문"이 적용 전 대상 파일에서 정확히 1회 검색되는지(0회 = 파일이 그 사이 바뀜 → 이 문서를 갱신 후 적용).
- [ ] 같은 줄에 앵커가 여럿인 항목(개발명세서 §3.1 참조 무결성 줄의 A-10·A-15, §3.1 동반 삭제 줄의 A-11, §3.1 인덱스 줄의 A-14)을 모두 적용한 뒤 각 줄이 목록 항목 구조(`- **…**:`)를 유지하는지. 개발명세서 §4 표(A-16·A-17)·§4.1 표(A-19~A-22)·§7 표(A-30·A-31)의 행이 표 셀 구조(`|`)와 열 개수를 유지하는지.
- [ ] 개발명세서 §7 인덱스에 설계서·ADR-0037 행이 각 1개인지. §6에 결정 38이 37 바로 뒤에 있는지. §3 "미도입 결정 14건" 머리와 ⑭ 항목이 함께 있는지. §3 엔터티 표에 `Topic` 행이 `CannedResponse` 행 바로 뒤에 있는지.
- [ ] `docs/01-requirements/기능요구사항.md` No.22 행(9열)·No.40 행의 열 개수가 표 머리와 같은지(No.1 행 각주는 기존 셀 안).
- [ ] `docs/requirements/topic-system.md` §1.9 머리·§11 머리에 PM 결정이 있는지 · §1.3.2 표에 E-12가 E-11 뒤에 있는지 · §5.4 표 두 행의 취소선이 셀 구조를 깨지 않는지.
- [ ] ADR-0031·0005·0016·0002·0008·0025 끝에 "갱신 (2026-09-25 — No.22 …)" 절이 각 1개인지.
- [ ] `docs/03-design/UIUX_준수기준.md`의 "분류(토픽) 표시는 텍스트 이름이 원천, 색 점은 보조" · "영향 미리보기는 건수 문장 + 표" 보강은 **ui-designer 판단**이다(개발명세서 §5 접근성 문단에 원칙을 먼저 기록했다 — A-25).
- [ ] `docs/04-test/시험항목.md` 460행 TC-22를 1차 AC-TP4-2·AC-TP4-3(토픽 간 충돌 경고)로 구체화하고 2차 "병합 후 충돌 경고"를 남기는 일, AC-TP1~TP7 · 토픽 3개 + 교차 참조 표준 픽스처 · 동점 케이스 픽스처(K-1·AC-TP5-6 공용) · 골든 해시 픽스처 · 분리 왕복 동일성 · 원본 불변 해시 시험을 `시험데이터.md`·`자동시험_전략.md`에 추가하는 일은 **test-automation 단계**에서 한다.
- [ ] `docs/05-ops/자동배포.md`에 ① K-1 커밋 선행 배포와 TC 비교 회귀(운영 챗봇 포함) ② 마이그레이션은 API 중지 상태(자산 6테이블 재정의 소요 실측 · 원시 부분 유니크 인덱스 보존 확인) ③ **롤백 시 비활성 토픽 자산이 운영에 노출되는 점 확인 단계** ④ 분리 잠금 시간 실측값을 추가하는 일은 **deployment-engineer 단계**에서 한다.
- [ ] 코드 쪽 기대값 변경(설계서 §21.2 X-1~X-3)은 **구현 단계에서** 반영한다. 그 밖의 기존 시험이 깨지면 회귀로 취급한다(K-1 커밋에서 깨지면 멈추고 보고).
- [ ] 코드 쪽 주석(`chatbots.service.ts`의 `CHILD_COUNT_LABELS` 머리 "11 → 13종", `asset-write-sealing.spec.ts` S-1 머리의 허용 파일 설명, `packages/shared-types/src/audit.ts`의 대상 개수, `apps/web/src/pages/dialogue/DialogueShell.tsx`의 서브내비 주석 "7번째")은 **구현 단계에서** No.22 내용으로 갱신한다.
