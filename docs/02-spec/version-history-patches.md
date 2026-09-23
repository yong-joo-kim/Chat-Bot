# No.25 챗봇 복원/버전 이력관리 — 기존 문서 패치 목록

> 작성: system-architect · 2026-09-23 · 근거: `docs/02-spec/version-history-설계.md`, `docs/02-spec/decisions/ADR-0031-chatbot-version-snapshot-and-id-preserving-restore.md`
> **적용 방법**: 각 항목의 "찾을 원문"을 파일에서 **정확히 1회** 찾아 "바꿀 내용"으로 교체한다. 모든 원문은 2026-09-23 시점 파일에서 복사했고 유일성을 확인했다(append 항목은 원문을 그대로 포함한 채 뒤에 덧붙인다).
> 코드 변경은 이 파일의 범위가 아니다 — 설계서 §2.5 체크리스트를 따른다.
> 항목 수: 개발명세서 26 · ADR 6 · 기능요구사항 2 = **35건**

---

## A. `docs/02-spec/개발명세서.md`

### A-1. §2 워크스페이스 상태 표 — `versions` 행 추가

**찾을 원문**
````text
| **`packages/pii-mask`** | **매칭 고도화 Phase에 승격** — 기존 `apps/api/src/conversation/lib/pii-mask.ts`를 이동(동작 변경 0). 소비자가 저장·외부 송신 2곳이 되어 §5의 승격 조건 충족 |
````
**바꿀 내용**
````text
| **`apps/api/src/versions`** | **챗봇 복원/버전 이력관리 Phase에 신설**(No.25) — 대화 자산 시점 스냅샷(수동 + 대량 변경 직전 자동)·이력·차이·ID 보존 원자적 복원. **캡처 모듈(`version-capture`)과 복원 모듈을 분리**해 자산 모듈 5곳은 캡처만 import한다. **`packages/dialogue-engine`·ml-worker·widget 변경 0건 · 신규 외부 접촉면 0건 · 신규 권한 0종**(ADR-0031) |
| **`packages/pii-mask`** | **매칭 고도화 Phase에 승격** — 기존 `apps/api/src/conversation/lib/pii-mask.ts`를 이동(동작 변경 0). 소비자가 저장·외부 송신 2곳이 되어 §5의 승격 조건 충족 |
````

### A-2. §2.2 기능그룹별 모듈 배치 표 — 행 추가

**찾을 원문**
````text
`simulation`(`serializeOutputsForDiff` 공용 승격) | **설계 완료 → `validation-regression-설계.md`** |
````
**바꿀 내용**
````text
`simulation`(`serializeOutputsForDiff` 공용 승격) | **설계 완료 → `validation-regression-설계.md`** |
| **챗봇 복원/버전 이력관리 (No.25)** | **`versions`(신규 — 목록·상세·라벨/고정/삭제·차이·내용 조회·복원 미리보기/확정 · ★대화 자산 쓰기 유일 파일 `version-restore.applier.ts`) + `version-capture`(신규 — 일관 읽기 캡처·보존 정리, 자산 모듈 5곳이 import)** + `dialogue-common`(`build(chatbotId, tx?)` 선택 인자) · `intents`/`keywords`/`faqs`/`augmentation`/`learning`(자동 스냅샷 훅 1줄씩 — 총 8지점) · `embedding`(`ReindexQueueService` 재실행 예약 플래그) · `common/auth`(`@RequirePermission` 복수 인자 AND) · `audit-logs`(`RESTORE` 요약 액션) · `chatbots`(영구삭제 동반 삭제 3테이블) | **설계 완료 → `version-history-설계.md`** |
````

### A-3. §2.2 주석 블록 — 엔진 불가침·모듈 의존 방향(No.25) 추가

**찾을 원문**
````text
역방향 참조(`learning → validation`, `augmentation → validation`)는 만들지 않는다.
````
**바꿀 내용**
````text
역방향 참조(`learning → validation`, `augmentation → validation`)는 만들지 않는다.
>
> **엔진 불가침(챗봇 복원/버전 이력관리 No.25)**: 이 그룹은 엔진을 **실행하지 않고 한 줄도 바꾸지 않는다**(FR-0-68). 노드 아웃풋의 노드 참조 추출에 `getOutgoingNodeRefs()`를 **호출만** 한다(참조 규칙 복제 금지). 엔진 패키지에 `chatbotVersion` 심볼이 **0건**임을 정적 검사가 단언한다.
>
> **모듈 의존 방향(No.25)**: `intents｜keywords｜faqs｜augmentation｜learning → version-capture → dialogue-common` · `versions → version-capture / chatbots / dialogue-common / answer-settings / embedding(ReindexQueueService 읽기만) / banned-words(경고 산출 읽기만) / audit-logs` 단방향이다. **`versions`·`version-capture`는 대화 자산 6모듈·`AugmentationModule`·`ValidationModule`·`TrainingJobsModule`·`ClassifierModule`·`LearningModule`·`ConversationModule`을 import하지 않는다** — 진행 중 작업·제안·TC는 **Prisma 읽기**로만 보고, 분류기 삭제는 복원 트랜잭션 안 `deleteMany` 1건이다(`permanentDelete()` 선례). **`QueryEmbeddingService`를 주입하지 않는다**(질의 캐시는 자산 무관 — 건드릴 수단 자체가 없어야 한다). **캡처 모듈에는 복원 쓰기 경로가 없으므로 자산 모듈의 DI 그래프에 복원 applier가 들어가지 않는다**(ADR-0025 봉인 L1과 같은 방식 — ADR-0031).
````

### A-4. §3 엔터티 표 — `ChatbotVersion` 예약 행 실체화

**찾을 원문**
````text
| `ChatbotVersion` | 버전 스냅샷(복원용) | 25 |
````
**바꿀 내용**
````text
| **`ChatbotVersion`** | **챗봇 대화 자산 시점 스냅샷의 메타(No.25, ADR-0031).** 스냅샷 범위 = 대화 자산 6종 + 노드 조인 2종 + `ChatbotAnswerSetting` + `Chatbot` 표시 설정 4필드(`name`/`avatarUrl`/`description`/`skin`) — **`slug`·`status`·`groupId`·`Channel`·`BannedWord`·파생/운영/검증 데이터는 제외**. `versionNo`(챗봇별 단조 증가·**재사용 안 함**)·`trigger`(MANUAL + 자동 `BEFORE_IMPORT`/`BEFORE_BULK_DELETE`/`BEFORE_AUGMENT_ACCEPT`/`BEFORE_LEARNING_BULK_APPLY`/`BEFORE_RESTORE`)·`triggerContext`(JSON, **원문 없음**)·`schemaVersion`(업캐스터 체인 입력)·**`contentHash`**(타임스탬프 제외 정규 직렬화 sha256 — 직전과 같으면 생성 생략·미리보기 이후 변경 감지·복원 검증에 공용)·`counts`·`sizeBytes`·`payloadEncoding`·`integrityWarnings`·`label`/`memo`(자유 메모 — **의미·유일성 없음, No.40 태그가 아니다**)·`pinned`·`restoredFromVersionId`/`No`(FK 없음)·`createdById`/`Email`(FK 없음). 보존은 **자동 30 · 수동 30 · 고정 10 · 챗봇당 300MB**이며 새 스냅샷 생성 직후 정리한다(스케줄러 부재). **복원은 ID 보존 차이 적용**이고 복원 직전 백업과 **같은 트랜잭션**이다 | 25 |
| **`ChatbotVersionPayload`** | **스냅샷 본문(1:1, PK=`versionId`).** 정규 JSON(무압축 TEXT, 1건 상한 20MB). **목록·상세·보존 정리는 이 테이블을 읽지 않는다** — 본문 분리로 목록의 본문 미조회를 규율이 아니라 **구조로** 보장한다(참조 파일 4곳 고정, 정적 검사) | 25 |
| **`ChatbotVersionSequence`** | **챗봇별 `versionNo` 발급기(PK=`chatbotId`).** `max(versionNo)+1`은 최신 버전 삭제 시 번호를 재사용하고, `Chatbot`에 카운터를 두면 `@updatedAt`이 스냅샷 생성마다 챗봇 목록 정렬을 뒤섞는다 | 25 |
````

### A-5. §3 미도입 결정 — 건수 갱신

**찾을 원문**
````text
> **미도입 결정 9건**
````
**바꿀 내용**
````text
> **미도입 결정 10건**
````

### A-6. §3 미도입 결정 — ⑨ 보론 + ⑩ 추가

**찾을 원문**
````text
**`TrainingJob`의 `TC_RUN` kind·새 큐 클래스·Redis/BullMQ도 계속 만들지 않는다**(**ADR-0029**).
````
**바꿀 내용**
````text
**`TrainingJob`의 `TC_RUN` kind·새 큐 클래스·Redis/BullMQ도 계속 만들지 않는다**(**ADR-0029**). **[보론 2026-09-23] No.25에서 `ChatbotVersion`(+본문·시퀀스)으로 자산 스냅샷을 도입했다(ADR-0031)** — ⑨가 비워 둔 자리를 No.25가 채운 것이며, TC 세트 버전 이력·비교 결과 저장 테이블은 여전히 미도입이다.
> ⑩ **스냅샷 증분(델타) 테이블·항목별 버전 이력 테이블(`IntentVersion` 류)·버전 차이 저장 테이블·복원 Job 테이블·복원 잠금 테이블·환경/태그/승격 테이블·예약 복원 테이블·스냅샷 내보내기/가져오기** — 증분은 체인 1개 손상이 이후 전부를 복원 불가로 만들고, 항목별 이력은 "한 시점의 전체"를 N개 테이블 시점 조인으로 재구성하게 만든다. 차이는 조회 시점 계산(저장하면 낡는다), 복원은 동기(카탈로그 "즉시 롤백")이며 동시성은 **SQLite 직렬화 트랜잭션 안의 재확인**으로 보장한다. 환경·승격·트래픽 전환은 **No.40**, 예약은 **No.28**, 내보내기는 **No.45**의 본체이고 가져오기는 검증되지 않은 자산 주입 경로다(**ADR-0031**).
````

### A-7. §3.1 참조 무결성 — FK 미설정 예외 추가

**찾을 원문**
````text
**`TestCase.expectedTargetId`**, **`TestRunResult.caseId`** 는 **FK를 걸지 않는다**.
````
**바꿀 내용**
````text
**`TestCase.expectedTargetId`**, **`TestRunResult.caseId`**, **`ChatbotVersion`의 `restoredFromVersionId`/`createdById`** 는 **FK를 걸지 않는다**.
````

### A-8. §3.1 파생 데이터의 동반 삭제 — 버전 3테이블 추가

**찾을 원문**
````text
(기존 트랜잭션에 deleteMany 4건 추가 — 6 → 10 테이블).
````
**바꿀 내용**
````text
(기존 트랜잭션에 deleteMany 4건 추가 — 6 → 10 테이블). **`ChatbotVersionPayload`·`ChatbotVersion`·`ChatbotVersionSequence` 3종도 같은 분류**다(No.25 — 10 → 13 테이블, 삭제 순서 `ChatbotVersionPayload → ChatbotVersion → ChatbotVersionSequence`). 영구삭제는 여전히 **불가역**이며 스냅샷도 함께 사라진다. **`ARCHIVED`(보관) 상태에서는 스냅샷을 보존**한다(ADR-0002 갱신 각주).
````

### A-9. §3.1 인덱스 — 버전 인덱스 추가

**찾을 원문**
````text
`test_run_results(runId, resultA)`, `test_run_results(runId, caseId)`**(`intent_classifier_models`는 PK가 `chatbotId`라 별도 인덱스를 두지 않는다).
````
**바꿀 내용**
````text
`test_run_results(runId, resultA)`, `test_run_results(runId, caseId)`**, **`chatbot_versions(chatbotId, versionNo) UNIQUE`, `chatbot_versions(chatbotId, createdAt)`, `chatbot_versions(chatbotId, trigger, createdAt)`**(`intent_classifier_models`는 PK가 `chatbotId`라 별도 인덱스를 두지 않는다. **`chatbot_version_payloads`·`chatbot_version_sequences`도 PK 조회만 하므로 별도 인덱스가 없다.** `chatbot_versions.pinned`는 선택도가 낮아 인덱스를 두지 않는다).
````

### A-10. §4 API 표 — 버전/배포 행 분리·구체화

**찾을 원문**
````text
| 버전/배포 | `/chatbots/:id/versions`, `POST /chatbots/:id/deploy-schedule` | 25, 28 |
````
**바꿀 내용**
````text
| **버전 이력·복원** | **`/chatbots/:chatbotId/versions`(GET 목록 — `versionNo desc` 고정·본문 미조회 / POST 수동 저장 — 해시 동일 시 `200 { unchanged:true }`), `GET .../versions/current`(현재 해시·저장되지 않은 변경 여부 — ⚠ `:versionId`보다 **먼저 선언**), `GET｜PATCH｜DELETE .../versions/:versionId`(라벨·메모·고정 / 고정 버전 삭제 409), `GET .../versions/:versionId/content?kind=`(읽기 전용 내용 — 과거 값 복사 경로), `GET .../versions/:versionId/diff?against=current｜<versionId>`(+`/diff/items/:kind/:itemId` — 조회 시점 계산·저장 안 함), `GET .../versions/:versionId/audit-count`(**`audit:read`** — 다음 버전까지 감사 건수 + 필터 링크), `POST .../versions/:versionId/restore/preview`(DB 변경 0), `POST .../versions/:versionId/restore`(`{ expectedCurrentHash, acknowledgeActive? }` → 동기 원자적 복원)**. 총 12개 핸들러. 조회 `dialogue:read` / 저장·라벨·고정·삭제 `dialogue:write` / **복원 미리보기·확정 `dialogue:write` AND `chatbot:write`**(신규 권한 0종). **`ARCHIVED` 챗봇은 조회만 허용**(쓰기·복원 `409 CHATBOT_ARCHIVED`). **`@Public()` 추가 0건** | **25** |
| 배포 | `POST /chatbots/:id/deploy-schedule` | 28 |
````

### A-11. §4 정정 이력 — No.25 항목 추가

**찾을 원문**
````text
④ **`@Public()`은 여전히 6개**이며 이 그룹도 공개 경로를 하나도 추가하지 않았다(`validation-regression-설계.md` §9).
````
**바꿀 내용**
````text
④ **`@Public()`은 여전히 6개**이며 이 그룹도 공개 경로를 하나도 추가하지 않았다(`validation-regression-설계.md` §9).
> **정정 이력(2026-09-23b — 챗봇 복원/버전 이력관리)**: ① 기존 "버전/배포" 예고 행을 **"버전 이력·복원"(No.25, 12개 핸들러)** 과 **"배포"(No.28)** 로 분리했다 — 한 행에 두면 복원이 배포·예약과 같은 개념으로 읽히며, 복원은 `Chatbot.status`를 바꾸지 않는다(No.40/No.28과의 경계, ADR-0031 §8). ② 경로 파라미터를 **`:chatbotId`로 통일**했다. ③ 복원은 **2단계(미리보기 → 확정)** 이고 확정은 **동기 응답**이다(카탈로그 "즉시 롤백" — Job·폴링 경로를 만들지 않는다). ④ 감사 건수는 목록에 합치지 않고 **`audit:read` 전용 경로로 분리**했다(목록 성능 · 권한 판정을 가드로). ⑤ **`@Public()`은 여전히 6개**(`version-history-설계.md` §10).
````

### A-12. §4.1 목록 쿼리 행 — 예외 건수 갱신

**찾을 원문**
````text
`q`(부분 일치), `sort`/`order`(기본 `updatedAt desc`)를 공통 제공. **예외 3건**
````
**바꿀 내용**
````text
`q`(부분 일치), `sort`/`order`(기본 `updatedAt desc`)를 공통 제공. **예외 4건**
````

### A-13. §4.1 목록 쿼리 행 — `/versions` 예외 추가

**찾을 원문**
````text
**`/unanswered-questions`는 기본 `occurredCount desc` → 동률 시 `lastOccurredAt desc`**(검토 우선순위 = 막힌 사용자 수) |
````
**바꿀 내용**
````text
**`/unanswered-questions`는 기본 `occurredCount desc` → 동률 시 `lastOccurredAt desc`**(검토 우선순위 = 막힌 사용자 수), **`/versions`는 `versionNo desc` 고정**(정렬 파라미터를 받지 않는다 — 버전 번호가 곧 시간축이다) |
````

### A-14. §4.1 오류 봉투 — No.25 코드 9종

**찾을 원문**
````text
`TEST_RUN_CANCELLED`(409). **이 5종도 대화 경로에서는 쓰이지 않는다**.
````
**바꿀 내용**
````text
`TEST_RUN_CANCELLED`(409). **이 5종도 대화 경로에서는 쓰이지 않는다**. **챗봇 복원/버전 이력관리 그룹이 9종 추가** — `VERSION_SNAPSHOT_TOO_LARGE`(422, 수동 저장·복원 직전 백업 20MB 초과 — 자동 트리거는 오류가 아니라 응답의 `autoSnapshot.status='FAILED'`), `VERSION_SCHEMA_UNSUPPORTED`(422, 업캐스트 경로 없음 — 메타·원형 내용 조회는 가능), `VERSION_INTEGRITY_FAILED`(422, 복원 무결성 위반·본문 손상·저장 해시 불일치 + `details[]`), `VERSION_PINNED_LIMIT_EXCEEDED`(409), `VERSION_PINNED`(409, 고정 버전 삭제), `RESTORE_PREVIEW_STALE`(409, 미리보기 이후 변경·동시 쓰기 충돌), `RESTORE_BLOCKED_BY_ACTIVE_JOB`(409, 진행 중 `TrainingJob`/`TestRun`), `RESTORE_IN_PROGRESS`(409), `RESTORE_NO_CHANGES`(409, 대상 = 현재). **보관 챗봇 복원 거부는 기존 `CHATBOT_ARCHIVED`(409)를 재사용**한다. 이 9종도 대화 경로에서는 쓰이지 않는다.
````

### A-15. §4.1 챗봇 스코프 행 — 버전 이력 규칙

**찾을 원문**
````text
**AI 답변 설정은 조회만 `ARCHIVED` 허용, 저장·점검·재색인은 `409`다**(일반 쓰기 규약) |
````
**바꿀 내용**
````text
**AI 답변 설정은 조회만 `ARCHIVED` 허용, 저장·점검·재색인은 `409`다**(일반 쓰기 규약). **버전 이력도 조회(목록·상세·내용·차이·감사 건수)만 `ARCHIVED` 허용, 저장·라벨·고정·삭제·복원은 `409`다** — 보관 중 스냅샷은 보존되며 보관 해제 후 복원할 수 있다. 교차 챗봇 `versionId`는 `404`다 |
````

### A-16. §4.1 권한 행 — 복수 권한 AND

**찾을 원문**
````text
**실행(run)은 DB를 바꾸지 않지만 ml-worker 자원을 대량 소비하므로 쓰기로 분류한다**(ADR-0029 §5, ADR-0015 갱신 각주)** |
````
**바꿀 내용**
````text
**실행(run)은 DB를 바꾸지 않지만 ml-worker 자원을 대량 소비하므로 쓰기로 분류한다**(ADR-0029 §5, ADR-0015 갱신 각주)**. **[2026-09-23 No.25] `@RequirePermission`은 복수 인자(AND)를 받는다** — `RequirePermission(...permissions: [Permission, ...Permission[]])`, 가드는 **전부 보유**해야 통과시킨다. 첫 사용처는 복원 미리보기·확정(`dialogue:write` + `chatbot:write` — 복원은 대화 자산과 답변설정·표시설정을 **함께** 바꾼다). 기존 호출(인자 1개)은 무변경이며 **`Permission` 유니온은 15종 그대로**다(신규 권한 0종, PM 확정 — ADR-0015 갱신 각주) |
````

### A-17. §5 성능 — No.25 항목

**찾을 원문**
````text
이는 검증 가능한 수용기준이다(**ADR-0030 §2**).
````
**바꿀 내용**
````text
이는 검증 가능한 수용기준이다(**ADR-0030 §2**).
  - **[신규 2026-09-23 — 챗봇 복원/버전 이력관리] 이 그룹도 공개 대화 API의 성능 예산에 영향이 0건**이다(대화 경로 신규 조회·계산 0건 — 복원 직후 첫 턴의 번들 재구축 1회는 기존 편집과 동일). 관리자 경로 예산 — **스냅샷 캡처(자동 포함) 원본 2MB 이하 P95 1초**(자동 스냅샷이 임포트 커밋 20초 예산을 초과시키지 않는다) / **복원 확정(백업 포함) 통상 P95 5초 · 스냅샷 범위 1만 행 15초** / **버전 목록 P95 300ms(본문 테이블 미조회)** / 차이 요약 P95 2초, 항목 목록·내용 조회 **페이지네이션 필수**(기본 50) / **복원 후 재임베딩 = 내용이 바뀐 색인 대상 문장 수**(ID 보존 + `textHash` 재사용 — 전체 재임베딩 금지) / **복원 중 다른 챗봇 API P95 증가 20% 미만**. ⚠ SQLite는 DB 전체 단일 작성자라 복원 트랜잭션 동안 전 챗봇의 쓰기가 대기한다 — 준비(파싱·업캐스트·무결성·쓰기 모델)를 트랜잭션 밖에서 끝내고 차이 적용으로 쓰기량을 줄이며, **대화 로그 유실 0건을 실측으로 확인**한다(미달 시 비동기 복원 재검토 — ADR-0031).
````

### A-18. §5 보안 — No.25 항목

**찾을 원문**
````text
(`validation-sealing.spec.ts` — `rag-allowlist.spec.ts`·`asset-write-sealing.spec.ts`와 같은 형식).
````
**바꿀 내용**
````text
(`validation-sealing.spec.ts` — `rag-allowlist.spec.ts`·`asset-write-sealing.spec.ts`와 같은 형식).
  - **[신규 2026-09-23] 버전 스냅샷·복원의 봉인(ADR-0031)**: ① **대화 자산 9테이블 + `Chatbot` 표시 설정 4필드를 쓰는 경로는 `version-restore.applier.ts` 1파일**이며 캡처·목록·차이·조회는 쓰기 0건이다(FR-0-69). 이 때문에 `asset-write-sealing.spec.ts` S-1의 허용 파일이 **2 → 3**이 된다(ADR-0025 갱신 각주) — 복원은 관리자 요청 핸들러 1곳의 **과거 상태 재현**이고, 스냅샷 본문을 만드는 경로가 **실제 DB 자산의 캡처뿐**(내보내기·가져오기 없음)이라 미승인 문장의 주입 경로가 아니다. ② 복원은 `AugmentationSuggestion`·TC·실행·로그·채널·금지어·임베딩 벡터에 **쓰기 0건**이며 `slug`·`status`·`groupId`를 쓰지 않는다. ③ **복원 직전 백업은 교체와 같은 트랜잭션**이라 "백업 없는 복원"이 구조적으로 불가능하다. ④ 스냅샷에는 **사용자 발화·PII·자격증명이 들어갈 필드가 없다**(관리자 작성 자산뿐 — 학습현황 반영 예문은 이미 마스킹된 값). ⑤ 서버 로그에 자산 원문을 남기지 않는다(건수·크기·소요시간·해시 앞 8자리만). API 응답(차이·내용)에는 원문이 포함된다. ⑥ 위 전부를 `version-sealing.spec.ts` **9단언**으로 강제한다.
````

### A-19. §5 확장성 — 단일 인스턴스 상태 · 재색인 큐 보완

**찾을 원문**
````text
**벡터 인덱스(pgvector/HNSW) 도입의 재검토 트리거는 챗봇당 2만 벡터 초과다.**
````
**바꿀 내용**
````text
**챗봇 복원/버전 이력관리가 추가한 단일 인스턴스 상태는 복원 잠금 레지스트리 1개뿐**이며(동기 `Set`), 이는 UX용 빠른 실패일 뿐 정합성의 근거가 아니다 — 동시 복원·미리보기 이후 변경·진행 중 작업과의 충돌은 **쓰기 트랜잭션 안의 재확인**(SQLite 직렬화)이 최종 방어선이다(ADR-0031 §6). **같은 그룹에서 `ReindexQueueService`에 재실행 예약 플래그를 추가**했다 — 실행 중 `schedule()` 호출을 버리던 기존 동작은 "색인 실행 중의 자산 쓰기가 다음 쓰기까지 색인되지 않는" 잠재 결함이었다. 동시 실행 1건·수동 재색인 409 계약은 불변이다. **벡터 인덱스(pgvector/HNSW) 도입의 재검토 트리거는 챗봇당 2만 벡터 초과다.**
````

### A-20. §5 DB 이식성 — 트랜잭션 격리

**찾을 원문**
````text
**트랜잭션 내부에서 실패한 쿼리를 삼키지 않는다**(Postgres의 aborted transaction 동작 — 감사 기록을 커밋 후로 뺀 이유, ADR-0016 §4).
````
**바꿀 내용**
````text
**트랜잭션 내부에서 실패한 쿼리를 삼키지 않는다**(Postgres의 aborted transaction 동작 — 감사 기록을 커밋 후로 뺀 이유, ADR-0016 §4). **[No.25] 스냅샷 캡처의 일관 읽기와 복원의 TOCTOU 방어는 SQLite의 "모든 트랜잭션 = 직렬화 격리"에 기대고 있다.** Postgres 전환 시 캡처 읽기 트랜잭션은 `RepeatableRead`, 스냅샷 생성·복원 쓰기 트랜잭션은 `Serializable`로 지정하고 직렬화 실패(`P2034`)를 `409 RESTORE_PREVIEW_STALE`로 매핑한다(지정 지점 2곳의 상수). 이름 교환은 임시 키로 해결해 **신규 원시 SQL 0건**을 유지한다(ADR-0031).
````

### A-21. §5.1 환경변수 표 — 7종 추가

**찾을 원문**
````text
| **`TEST_RUN_PROGRESS_MIN_INTERVAL_MS`** | `apps/api/.env` | — | `1000` | 진행률 DB 쓰기 최소 주기 |
````
**바꿀 내용**
````text
| **`TEST_RUN_PROGRESS_MIN_INTERVAL_MS`** | `apps/api/.env` | — | `1000` | 진행률 DB 쓰기 최소 주기 |
| **`VERSION_AUTO_SNAPSHOT_ENABLED`** | `apps/api/.env` | — | `true` | 대량 변경 직전 자동 스냅샷(4종) 전역 스위치(No.25). **복원 직전 백업은 끌 수 없다** |
| **`VERSION_RETENTION_AUTO`** | `apps/api/.env` | — | `30` | 챗봇당 자동 스냅샷 보존 수(`BEFORE_RESTORE` 포함 — 최신 1건은 정리 제외) |
| **`VERSION_RETENTION_MANUAL`** | `apps/api/.env` | — | `30` | 챗봇당 수동 스냅샷 보존 수 |
| **`VERSION_PINNED_MAX`** | `apps/api/.env` | — | `10` | 챗봇당 고정 상한(고정 버전은 정리되지 않는다) |
| **`VERSION_SNAPSHOT_MAX_BYTES`** | `apps/api/.env` | — | `20971520` | 스냅샷 1건 원본(UTF-8) 상한 20MB |
| **`VERSION_TOTAL_MAX_BYTES_PER_CHATBOT`** | `apps/api/.env` | — | `314572800` | 챗봇당 스냅샷 총량 300MB. 초과 시 비고정 자동 → 비고정 수동 순으로 오래된 것부터 정리 |
| **`VERSION_TX_TIMEOUT_MS`** | `apps/api/.env` | — | `30000` | 캡처 읽기·복원 쓰기 인터랙티브 트랜잭션 timeout(Prisma 기본 5초 대체) |
````

### A-22. §5.1 주석 — No.25 환경변수 설명

**찾을 원문**
````text
신규 seed는 없다 — TC 세트·TC·실행·결과 4테이블이 0행인 것이 정상 상태이며 더미 세트를 만들지 않는다.**
````
**바꿀 내용**
````text
신규 seed는 없다 — TC 세트·TC·실행·결과 4테이블이 0행인 것이 정상 상태이며 더미 세트를 만들지 않는다.**
> **챗봇 복원/버전 이력관리 그룹(No.25)이 추가한 7개도 전부 선택이며 API 전용이다(ml-worker 변수 추가 0건). 하나도 설정하지 않으면 자동 스냅샷 활성 · 자동 30 · 수동 30 · 고정 10 · 1건 20MB · 챗봇당 300MB · 트랜잭션 30초로 정상 동작한다. `VERSION_TOTAL_MAX_BYTES_PER_CHATBOT < VERSION_SNAPSHOT_MAX_BYTES`면 기동 시 경고 로그만 남긴다(기동 실패 아님). 신규 seed는 없다 — 버전 3테이블이 0행인 것이 정상 상태이며, 도입 시점에 초기 스냅샷을 일괄 생성하지 않는다(첫 수동 저장 또는 첫 대량 작업이 v1이 된다).**
````

### A-23. §6 결정 20 — ADR-0015 갱신 각주

**찾을 원문**
````text
    - **갱신(2026-09-22)**: 보류 답변 폴링 엔드포인트가 추가되어 **`@Public()`은 6곳**이 된다. 개수 고정 테스트는 무력화하지 않고 **6으로 갱신**하며, 근거는 ADR-0023 §2에 남긴다. 신규 권한은 만들지 않는다.
````
**바꿀 내용**
````text
    - **갱신(2026-09-22)**: 보류 답변 폴링 엔드포인트가 추가되어 **`@Public()`은 6곳**이 된다. 개수 고정 테스트는 무력화하지 않고 **6으로 갱신**하며, 근거는 ADR-0023 §2에 남긴다. 신규 권한은 만들지 않는다.
    - **갱신(2026-09-23 — No.25)**: **`@RequirePermission`이 복수 인자(AND)를 받는다.** 복원이 `dialogue:write`와 `chatbot:write`를 **함께** 요구하기 때문이며(PM 확정 — 신규 권한 0종), 기존 호출(인자 1개)·`Permission` 유니온(15종)·`@Public()`(6곳)·fail-closed 판정 순서는 전부 불변이다. OR 조합은 지원하지 않는다.
````

### A-24. §6 결정 21 — ADR-0016 갱신 각주

**찾을 원문**
````text
API 연동 상세 로그는 `AuditLog`에서 분리해 **No.26의 `ApiCallLog`로 이관**한다. → **ADR-0016**
````
**바꿀 내용**
````text
API 연동 상세 로그는 `AuditLog`에서 분리해 **No.26의 `ApiCallLog`로 이관**한다. → **ADR-0016**
    - **갱신(2026-09-23 — No.25)**: `AuditAction`에 **`RESTORE`**(12 → 13종, 파괴적 동작 목록 포함)를 **요약 액션**으로 추가하고(`BULK_DELETE`/`IMPORT`와 같은 분기 — 복원이 바꾼 개별 항목 수백 건을 풀어 쓰지 않는다), `AuditTargetType`에 **`ChatbotVersion`**(수동 저장·라벨/메모·고정·삭제)을 추가한다. **자동 스냅샷 생성·보존 정리는 기록하지 않는다.** 감사로그는 여전히 복원 원천이 아니며 버전 이력은 "두 버전 사이의 감사 레코드"를 **건수 + 링크**로만 잇는다. 스냅샷의 생성자 기록을 위해 `AuditLogService.currentActorSnapshot()`을 추가하되 **`RequestContextService.get()` 호출 지점은 여전히 `AuditLogService` 1곳**이다. §6의 `(targetType, targetId, createdAt)` 인덱스 재검토 트리거는 **발동하지 않는다**(ADR-0031).
````

### A-25. §6 결정 32 신설

**찾을 원문**
````text
→ **ADR-0029 · ADR-0030**(+ ADR-0007·0015·0016·0022·0027 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0029 · ADR-0030**(+ ADR-0007·0015·0016·0022·0027 갱신 각주)

32. **챗봇 복원/버전 이력관리(No.25)의 스냅샷 범위·저장 형식·ID 보존 복원·원자성·파생 데이터 처리·동시성·권한·No.40 경계 확정(2026-09-23)**: 이 그룹은 ADR-0002·ADR-0016·ADR-0029가 세 번 "No.25의 몫"으로 비워 둔 **복구 수단**이다(No.19/20 = 회귀 **발견**, No.25 = 회귀에서 **복구**). **① 스냅샷 = "관리자가 작성하고, 응답을 결정하며, 이 챗봇에만 속하는 것"** — 대화 자산 6종 + 노드 조인 2종 + `ChatbotAnswerSetting` + `Chatbot` 표시 설정 4필드(PM 확정 P-2). `slug`(외부 계약)·`status`/`Channel`(배포 행위)·`groupId`·`BannedWord`(전역)·파생(임베딩·분류기)·제안·검증 자산(TC는 **자**다)·사실 기록은 제외한다. **② 전체 스냅샷 · 정규 JSON · `contentHash`(타임스탬프 제외, 조인 id 정렬, 값 배열 순서 유지) · `schemaVersion` + 업캐스터 체인 + 영구 픽스처 CI 단언** — 증분 체인은 1개 손상이 이후 전부를 무너뜨린다. 자산부는 `DialogueBundle` 형태를 재사용하고 엄격 검증은 **hydrate 후 기존 DTO 스키마**로 한다(두 번째 자산 규약 없음). **메타/본문 테이블을 분리**해 목록의 본문 미조회를 구조로 보장하고, `versionNo`는 시퀀스 테이블이 발급한다(재사용 금지). **③ 생성 시점 = 수동 + 대량 변경 직전 자동**(임포트 커밋·일괄 삭제·**증강 승인**·학습현황 일괄 반영 = 훅 **8지점**, 단건 CRUD 제외, 직전과 해시 동일 시 생략 — PM 확정 P-1). 증강 승인 직전 스냅샷이 **"승인 후 되돌리기"의 유일한 안전망**이다(`Intent.examples`에 증강 표시가 없다). 자동 스냅샷 실패는 **fail-open**(응답 `autoSnapshot.status`로 알림, P-4). 캡처는 `DialogueBundleService.build(chatbotId, tx?)` 선택 인자로 **한 트랜잭션 안에서 순차 조회**해 일관 읽기를 보장한다(기존 `Promise.all` 6회 독립 조회 문제 해소). **④ ★ 복원은 ID를 예외 없이 보존하는 차이 적용**이며(P-9) 부분 복원은 없다(P-3) — ID가 바뀌면 **No.19 TC 전체 `UNRESOLVED` · 전체 재임베딩 · 통계 단절 · 진행 중 대화 폐기**가 동시에 일어난다. 적용 순서(조인 → 노드 → **임시 키**(이름 교환 대비) → 삭제 → 생성/갱신 → 노드 → 조인 → 설정 → 프로필)로 `Restrict` FK와 정규화 유일성을 **원시 SQL 없이** 만족한다. **⑤ "해시 재확인 → 복원 직전 백업 → 교체 → 사후 해시 검증"을 하나의 쓰기 트랜잭션**으로 묶어 **백업 없는 복원을 구조적으로 불가능**하게 한다(fail-closed, J-6). 백업이 있으므로 복원은 **가역 동작**이다. **⑥ 파생 데이터는 재계산·무효화** — `invalidate()` 1회(번들·벡터 캐시 + **바뀐 문장만** 재색인), 답변설정 캐시 무효화, **`IntentClassifierModel` 삭제**(`EXAMPLES_DRIFTED`가 예문 **감소**를 감지하지 못해 증강 롤백 후에도 옛 모델이 추천에 쓰인다), **질의 임베딩 캐시는 건드리지 않는다**(주입조차 하지 않는다). `ReindexQueueService`에 재실행 예약 플래그를 더해 색인 실행 중 복원의 누락을 막는다. **⑦ 동시성의 최종 방어선은 SQLite 직렬화 트랜잭션 안의 재확인**(챗봇 상태 · 진행 중 `TrainingJob`/`TestRun` · `expectedCurrentHash`)이며, in-process 복원 잠금은 UX용 빠른 실패다. 작업 시작 경로에 복원 잠금을 퍼뜨리지 않는다(작업은 DB 직렬화로 복원 전/후 한쪽에만 속한다). **⑧ 신규 권한 0종**(P-5) — 복원은 `dialogue:write` AND `chatbot:write`이며 이를 위해 `@RequirePermission`을 **복수 인자 AND**로 확장한다(유니온 15종 불변). **⑨ 감사는 `RESTORE` 요약 1건 + `ChatbotVersion`(수동 저장·라벨·고정·삭제)** 이고 자동 스냅샷·정리는 기록하지 않는다. **⑩ ★ No.40 경계** — 이 그룹은 **"한 챗봇 · 한 시간축 · 뒤로 가기"** 뿐이며 환경·태깅·승격·트래픽 전환·쌍둥이·타 챗봇 복원·예약 복원·`status` 변경을 만들지 않는다. 라벨은 **자유 메모**다. `ChatbotsService.copy()`는 수정하지 않는다(깊은 복사는 캡처 + **ID 재매핑**으로 향후 가능 — 적재 규칙이 복원과 정반대). GPU 재산정 없음 — **No.25는 1 유지**(ID 보존이 1 유지의 조건: 재색인이 "바뀐 문장 수"에 비례). → **ADR-0031**(+ ADR-0002·0015·0016·0025·0027·0029 갱신 각주)
````

### A-26. §7 인덱스 — 세부 설계서 행 추가

**찾을 원문**
````text
| 요구사항: `docs/requirements/validation-regression.md` |
````
**바꿀 내용**
````text
| 요구사항: `docs/requirements/validation-regression.md` |
| **`version-history-설계.md`** | **챗봇 복원/버전 이력관리(No.25) — Prisma 변경안(`ChatbotVersion`·`ChatbotVersionPayload`·`ChatbotVersionSequence` 3종 신설, **기존 테이블 컬럼 변경 0건·백필 불필요·DROP만으로 완전 롤백**, 챗봇 영구삭제 동반 3테이블), 스냅샷 봉투·정규 직렬화·`contentHash`·`schemaVersion` 업캐스터·영구 픽스처 규약, hydrate 후 기존 DTO 스키마 검증, `build(chatbotId, tx?)` 일관 읽기, 자동 스냅샷 훅 8지점(실제 코드 위치)·fail-open 응답 계약, 보존 정리 알고리즘, 차이 계산(방향·필드 4유형·재생성 힌트), 복원 미리보기(blockers 6 · warnings 11), **단일 쓰기 트랜잭션(해시 재확인·백업·ID 보존 차이 적용 S1~S9·사후 검증)**, 캐시·파생 데이터 전수표, `ReindexQueueService` 재실행 플래그, 동시성(SQLite 직렬화 재확인)·Postgres 전환 메모, 12개 엔드포인트(**`@Public()` 추가 0건 · 신규 권한 0종 · `@RequirePermission` AND 확장**), `ApiErrorCode` 9종, 감사(`RESTORE` 요약·`ChatbotVersion`), 환경변수 7종, 정적 검사 9단언 + `asset-write-sealing` S-1 갱신, 시험 관점, 알려진 제한 9건, 요구사항 대비 해석 10건** | 요구사항: `docs/requirements/version-history.md` |
````

### A-27. §7 인덱스 — ADR-0031 행 추가

**찾을 원문**
````text
AC-V2-10, AC-V4-1~3 |
````
**바꿀 내용**
````text
AC-V2-10, AC-V4-1~3 |
| **`decisions/ADR-0031-chatbot-version-snapshot-and-id-preserving-restore.md`** | **챗봇 버전 = 대화 자산 시점 스냅샷(범위: 자산 6+조인 2+답변설정+표시설정 4필드 · 제외 근거 표) · 전체 스냅샷·정규 JSON·`contentHash`·`schemaVersion` 업캐스터·메타/본문 분리(증분·항목별 이력 기각) · ★ **ID 예외 없는 보존 + 차이 적용**(새 ID 발급·전체 재생성 기각 — TC·색인·통계·진행 중 대화 4근거) · **해시 재확인·백업·교체·사후 검증의 단일 트랜잭션**(백업 없는 복원의 구조적 불가) · 파생 데이터 재계산(분류기 삭제 — `EXAMPLES_DRIFTED` 감소 미감지 · 질의 캐시 미접촉) · SQLite 직렬화 재확인을 동시성 최종 방어선으로(작업 시작측 잠금 기각) · 신규 권한 0종 + `@RequirePermission` AND · ★ **No.40 경계 고정**(환경·태깅·승격·트래픽·타 챗봇 복원 없음, 라벨 무의미)** | 요구사항 J-1/J-2/J-4/J-5/J-6/J-8/J-9/J-11/J-14, FR-0-68~77, FR-H1-\*, FR-H3-\*, AC-H1~H4 |
````

---

## B. 기존 ADR — 갱신 각주(append 블록)

> 개발명세서 §7 ADR 작성 규칙의 예외("결정을 바꾸지 않고 범위만 넓히는 경우") 적용. 각 ADR 파일 **끝**에 덧붙인다.

### B-1. `docs/02-spec/decisions/ADR-0002-permanent-delete-referential-integrity.md`

**찾을 원문**
````text
- 후속 Phase(No.13 이력관리)는 영구 삭제 직전 스냅샷을 `AuditLog.beforeValue`에 남기는 지점으로 `permanentDelete()`를 사용한다.
````
**바꿀 내용**
````text
- 후속 Phase(No.13 이력관리)는 영구 삭제 직전 스냅샷을 `AuditLog.beforeValue`에 남기는 지점으로 `permanentDelete()`를 사용한다.


---

## 갱신 (2026-09-23 — No.25로 "되돌릴 수단"이 생겼다)

§근거의 "버전 스냅샷/롤백(No.25)도 … 없어 **되돌릴 수단이 전무하다**"는 **대화 자산에 한해 더 이상 사실이 아니다.** No.25가 대화 자산 시점 스냅샷과 ID 보존 원자적 복원을 도입했다(ADR-0031). **이 ADR의 결정은 전부 불변이다** — cascade 금지·2단계 삭제·사전 검사 409·`confirmName` 서버 재검증.

- **영구삭제는 여전히 불가역이다.** `ChatbotVersion`·`ChatbotVersionPayload`·`ChatbotVersionSequence`는 **"하위 데이터 제거" 분류**로 영구삭제 트랜잭션에서 **동반 삭제**된다(사전 검사 409 대상이 아니다 — 스냅샷이 영구삭제를 막으면 보관 챗봇을 영원히 지울 수 없다). 따라서 영구삭제 후에는 스냅샷도 남지 않는다. 오프사이트 백업은 No.45의 몫이다.
- **보관(`ARCHIVED`) 중에는 스냅샷이 보존**되며 보관 해제 후 복원할 수 있다.
- **복원은 이 ADR이 말하는 "복구 불가능한 파괴적 동작"이 아니다** — 복원 직전 상태를 같은 트랜잭션에서 자동 백업하므로 가역이다. 그래서 `chatbot:purge`(ADMIN 전용)와 같은 등급을 요구하지 않고 `dialogue:write` + `chatbot:write`(EDITOR 이상)로 둔다.
````

### B-2. `docs/02-spec/decisions/ADR-0015-role-permission-model.md`

**찾을 원문**
````text
개수 고정 테스트(권한 유니온 크기)는 무력화하지 않고 **15로 갱신**한다.
````
**바꿀 내용**
````text
개수 고정 테스트(권한 유니온 크기)는 무력화하지 않고 **15로 갱신**한다.


---

## 갱신 (2026-09-23 — `@RequirePermission` 복수 인자 AND, 신규 권한 0종)

챗봇 복원/버전 이력관리(No.25)의 **복원 미리보기·확정은 `dialogue:write`와 `chatbot:write`를 모두** 요구한다 — 복원은 대화 자산(`dialogue:*`)과 답변설정·표시설정(`chatbot:write`, `answer-settings.controller.ts`가 쓰는 권한)을 **함께** 바꾸기 때문이다. PM이 **신규 권한 0종**(대안 `chatbot:restore` 신설 기각)으로 확정했으므로, 단일 권한만 판정하던 데코레이터·가드를 확장한다.

```ts
export const RequirePermission = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(PERMISSION_METADATA_KEY, permissions);      // 항상 배열로 저장
// PermissionGuard: 메타데이터가 단일 값이든 배열이든 배열로 정규화 → **전부 보유**해야 통과(AND)
```

- **불변**: `Permission` 유니온 **15종** · `ROLE_PERMISSIONS` · `@Public()` **6곳** · fail-closed 판정 순서 ①~⑦ · `403` 본문에 요구 권한 미표기 · 기존 호출(인자 1개) 한 글자도 변경 없음.
- **AND만** 지원한다. OR 조합은 수요가 없고, 섞이면 판정 규칙이 데코레이터에서 읽히지 않는다.
- 빈 호출(`RequirePermission()`)은 튜플 타입으로 **컴파일 오류**다. `PERMISSION_DENIED` 이력의 `summary`에는 요구 권한을 `a+b`로 남긴다(응답 본문에는 여전히 미포함).
- 복원이 ADMIN 전용이 아닌 이유: 복원 직전 자동 백업으로 **가역 동작**이며(ADR-0031 §4), "즉시 롤백"은 사고 현장의 EDITOR가 할 수 있어야 의미가 있다. 조직 통제상 승인이 필요해지면(No.36/45) `chatbot:restore` 신설 또는 2인 승인을 재검토한다.
````

### B-3. `docs/02-spec/decisions/ADR-0016-audit-log-backfill-scope.md`

**찾을 원문**
````text
또한 실행 결과에는 **관리자가 작성한 문장만** 들어가므로 NFR-S8(감사로그에 사용자 발화 유입 금지)과는 무관하다.
````
**바꿀 내용**
````text
또한 실행 결과에는 **관리자가 작성한 문장만** 들어가므로 NFR-S8(감사로그에 사용자 발화 유입 금지)과는 무관하다.


---

## 갱신 (2026-09-23 — `RESTORE` 요약 액션 · `ChatbotVersion` 대상 · actor 스냅샷 읽기)

챗봇 복원/버전 이력관리(No.25, ADR-0031)가 다음을 추가한다. **감사로그의 결정(append-only · 커밋 후 기록 · 화이트리스트 부분 스냅샷 · 복원 원천이 아님)은 전부 불변**이며, 감수비용 5("`beforeValue`로 복원할 수 없다 — 복원은 No.25의 본체")는 **예고대로 No.25가 별도 저장소(`ChatbotVersion`)로 이행**했다.

1. **`AuditAction`에 `RESTORE`(12 → 13종, 라벨 `'복원'`)를 추가하고 `DESTRUCTIVE_AUDIT_ACTIONS`에 포함**한다. `targetType='Chatbot'`, `summary` 예: `"v27로 복원 (백업 v28) — 의도 +0/−0/~1, FAQ +0/−3/~0"`.
2. **`RESTORE`는 §7의 요약 액션**이다 — `record()`의 요약 분기(`BULK_DELETE`/`IMPORT`)에 `RESTORE`를 더해 화이트리스트를 건너뛴다. `after`는 `{ fromVersionNo, backupVersionNo, counts: { <종류>: { added, removed, modified } } }`로 **number만** 담는다(§7 표의 값 종류 제약 그대로 — 원문·이름 없음). **복원이 바꾼 개별 항목 수백 건을 감사 레코드로 풀어 쓰지 않는다**(행당 1건 기록을 기각한 §대안과 같은 판단). 요약 액션 호출부는 6곳 → **7곳**이며 code-reviewer 전수 점검 대상에 포함한다.
3. **`AuditTargetType`에 `ChatbotVersion`(라벨 `'챗봇 버전'`)을 추가**한다 — 수동 저장(`CREATE`)·라벨/메모 수정·고정/해제(`UPDATE`)·수동 삭제(`DELETE`). `AUDIT_FIELDS.ChatbotVersion = ['versionNo','trigger','label','memo','pinned','sizeBytes']`.
4. **자동 스냅샷 생성과 보존 정리, 복원 직전 백업 생성은 기록하지 않는다** — 자동 생성은 이미 감사되는 본 동작(`IMPORT`·`BULK_DELETE`·`Intent UPDATE`)의 부수 효과이고, 정리는 시스템 동작이며, 백업 번호는 `RESTORE` 요약에 포함된다. 기록하면 대량 작업마다 감사가 2배가 된다(FR-15-35·ADR-0029 §5와 같은 판단).
5. **`AuditLogService.currentActorSnapshot(): { id, email, role } | null` 공개 메서드를 추가**한다. 스냅샷 메타의 `createdById`/`createdByEmail`은 이 메서드로만 얻는다 — **`RequestContextService.get()` 호출 지점은 여전히 `AuditLogService` 1곳**이다(§결과 code-reviewer 점검 ③ 유지).
6. 버전 이력은 감사로그를 **복제하지 않는다** — "두 버전 사이의 감사 레코드"는 `(chatbotId, createdAt)` 인덱스로 **건수만** 세고 이력관리 화면으로 필터 링크를 건다(`audit:read` 전용 경로). **§6의 `(targetType, targetId, createdAt)` 인덱스 재검토 트리거는 발동하지 않는다** — No.25는 `targetId`로 조회하지 않으며, 항목별 변경 이력 화면은 1차 범위 밖이고 만들더라도 **스냅샷 차이**로 구현한다.
````

### B-4. `docs/02-spec/decisions/ADR-0025-augmentation-output-and-suggestion-asset-separation.md`

**찾을 원문**
````text
- **파인튜닝 요구가 실제로 발생**(세일즈 요건 확정 + GPU 인프라 상시화) → (b)안을 별도 ADR로 재검토. 이번 그룹이 만든 예문이 그 학습 데이터가 된다.
````
**바꿀 내용**
````text
- **파인튜닝 요구가 실제로 발생**(세일즈 요건 확정 + GPU 인프라 상시화) → (b)안을 별도 ADR로 재검토. 이번 그룹이 만든 예문이 그 학습 데이터가 된다.


---

## 갱신 (2026-09-23 — 자산 쓰기 봉인 L2/S-1의 세 번째 허용 파일: 복원 applier)

챗봇 복원/버전 이력관리(No.25, ADR-0031)의 **`apps/api/src/versions/restore/version-restore.applier.ts`** 가 `Intent`·`Keyword`(및 나머지 대화 자산)를 트랜잭션 안에서 쓴다. 따라서 §5 봉인 **L2**("`Intent.examples`·`Keyword.synonyms`를 쓰는 Prisma 호출은 2개 파일뿐")와 `asset-write-sealing.spec.ts` **S-1**의 허용 파일이 **2 → 3**이 된다(가드 단언 "정확히 2개" → 3개).

**이 예외가 "승인 없는 자산 변경 금지"를 약화하지 않는 이유**
- 복원은 **관리자의 명시적 요청 핸들러 1곳**(`POST …/versions/:versionId/restore`, `dialogue:write` + `chatbot:write`)에서만 실행된다. 스케줄러·Job·콜백 경로가 없다.
- 복원이 쓰는 내용은 **과거에 실제로 존재했던 자산 상태**다 — 스냅샷 본문을 만드는 경로는 **실제 DB 자산의 캡처뿐**이며 **내보내기·가져오기가 존재하지 않는다**(NFR-HS5). 따라서 제안(`AugmentationSuggestion`)이나 외부 문장이 승인 없이 예문으로 들어가는 경로가 되지 않는다.
- 복원은 `AugmentationSuggestion`에 **쓰기 0건**이며 `applyLearningExample()`을 호출하지 않는다 — **L3(호출부 allowlist 3곳)·S-2는 불변**이다.
- 버전 모듈 쪽에도 대화 자산 쓰기가 applier **1파일**뿐임을 `version-sealing.spec.ts`가 단언한다(L4와 같은 형식).

**영향 기록**: 롤백으로 제거된 **승인 증강 예문은 다시 제안되지 않는다**(`@@unique([intentId, textNormalized])` — 감수비용 2와 같은 성질, PM 확정 P-8). 복원 미리보기가 그 건수를 경고로 보여 준다. 반대로 **증강 승인 직전 자동 스냅샷**(`BEFORE_AUGMENT_ACCEPT`)이 "승인 후 되돌리기"의 유일한 안전망이 된다 — 승격된 문장은 일반 예문이라(§5) 증강분만 골라낼 표시가 없기 때문이다.
````

### B-5. `docs/02-spec/decisions/ADR-0027-intent-classifier-and-training-job.md`

**찾을 원문**
````text
기동 시 고아 작업 정리(`SERVER_RESTART`) 규약은 `TestRun`에도 **같은 시점·같은 방식**으로 적용한다.
````
**바꿀 내용**
````text
기동 시 고아 작업 정리(`SERVER_RESTART`) 규약은 `TestRun`에도 **같은 시점·같은 방식**으로 적용한다.


---

## 갱신 (2026-09-23 — stale 조건 ③은 예문 **감소**를 감지하지 않는다 · 복원 시 모델 삭제)

**코드 확인 사실**: `classifier/lib/stale-judge.ts`의 `EXAMPLES_DRIFTED`는 `currentExampleCount − exampleCountAtTrain > 50` — **증가만** 판정한다(`INTENTS_DRIFTED`는 절대값 10%라 양방향이다). 따라서 "증강 50건 승인 → 재학습 → 증강을 되돌림(예문 감소)" 경로에서 **stale이 뜨지 않고, 증강분으로 학습된 모델이 미응답 큐 추천에 계속 쓰인다.**

**결정(ADR-0031 §5)**: 챗봇 복원/버전 이력관리의 **복원은 같은 트랜잭션에서 `IntentClassifierModel` 행을 삭제**한다. 추천은 즉시 LEXICAL(bigram)로 복귀하고 상태 API는 `NOT_TRAINED`를 보고하며, 화면은 "복원 후 재학습이 필요합니다"를 안내한다. 재학습은 수 초이고 대화 경로와 무관하므로(이 ADR §1) 삭제가 가장 싸고 확실하다. 모델 버전 이력을 만들지 않는다는 §6의 결정은 **불변**이다.

**조건 ③을 절대값(`|Δ| > 50`)으로 바꿀지는 별도 판단**으로 남긴다 — 복원 경로는 삭제로 우회하므로 이번에 필수가 아니다. 단 복원이 아닌 경로(관리자가 예문을 대량 수동 삭제)에서도 같은 틈이 있으므로, **재검토 트리거**: "예문 대량 삭제 후 추천 품질 저하"가 보고될 때 조건 ③을 절대값으로 정밀화한다(순수 함수 1곳 수정).

**진행 중 작업과의 관계**: 복원은 이 챗봇의 `TrainingJob`이 `QUEUED`/`RUNNING`이면 `409 RESTORE_BLOCKED_BY_ACTIVE_JOB`으로 거부한다 — 학습은 끝나면서 **복원 전 데이터로 학습한 모델을 upsert**하므로 복원과 뒤섞인 결과를 만든다. 이 판정은 복원 쓰기 트랜잭션 안에서 이뤄져 **DB 직렬화로 TOCTOU가 없다**. 큐·`TrainingJobService`는 **변경 0건**이다.
````

### B-6. `docs/02-spec/decisions/ADR-0029-test-run-as-version-axis.md`

**찾을 원문**
````text
VIEWER 권한 집합은 변하지 않아 기존 권한 테스트는 무수정 통과한다.
````
**바꿀 내용**
````text
VIEWER 권한 집합은 변하지 않아 기존 권한 테스트는 무수정 통과한다.


---

## 갱신 (2026-09-23 — No.25 착수: §2(3)에서 비워 둔 자리가 채워졌다)

§2 (3) "챗봇 자산 스냅샷 — **No.25의 본체를 선점**한다"로 기각한 자리를 **No.25가 `ChatbotVersion`으로 채웠다**(ADR-0031). **이 ADR의 결정은 전부 불변이다** — "버전 비교"는 여전히 `TestRun`(실행 결과) 간 비교이며, 자산 스냅샷은 **복원**을 위한 것이지 회귀 **탐지**의 입력이 아니다(두 축은 역할이 다르다: No.19/20 = 발견, No.25 = 복구).

- **`envFingerprint.assetContentHash` 연결은 1차에서 하지 않는다**(요구사항 FR-H2-9 — 선택 항목). 하려면 No.19 실행기를 수정해야 하고 필수 범위가 아니다. **재검토 트리거**: "이 실행은 vN과 동일한 자산 상태" 표시 요구가 생길 때 — 실행 시작 시 No.25의 정규 직렬화 순수 함수로 해시를 계산해 지문에 **추가만** 한다(스냅샷 행을 만들지 않는다 · 기존 지문 필드 불변).
- **ID 보존 복원 덕분에 TC는 복원 직후에도 전부 유효하다** — `TestCase.expectedTargetId`(FK 없음, §6)가 복원된 행의 원래 `id`를 그대로 가리킨다. 복원 완료 화면은 "TC 세트로 검증하기" 동선을 제공한다(복원 결과를 이 ADR의 도구로 즉시 검증).
- 복원은 이 챗봇의 `TestRun`이 `QUEUED`/`RUNNING`이면 **거부**한다(실행은 시작 시 번들을 1회 로드하므로 결과가 복원 전/후 어느 쪽인지 해석할 수 없다). **TC 세트·TC·실행·결과 테이블에 쓰기 0건**이다 — TC는 복원 결과를 재는 **자**이므로 복원 대상이 아니다.
````

---

## C. `docs/01-requirements/기능요구사항.md`

### C-1. §3 No.25 행 — 설명·비고 보강(GPU 1 유지 재확인)

**찾을 원문**
````text
| 25 | 품질/검증 | 챗봇 복원/버전 이력관리 | 업데이트 히스토리 조회, 이전 버전 즉시 롤백 | 1 | 버전 스냅샷 저장/복원 | ○ | ○ | - |
````
**바꿀 내용**
````text
| 25 | 품질/검증 | 챗봇 복원/버전 이력관리 | 업데이트 히스토리 조회(수동 + **대량 변경 직전 자동 스냅샷**), 버전 간 차이, 이전 버전 **즉시·원자적 롤백(ID 보존 · 복원 직전 자동 백업)** | 1 | 버전 스냅샷 저장/복원(CPU — JSON 직렬화·집합 차이·트랜잭션). 복원 후 재색인은 ml-worker(No.18)에 위임되며 ID 보존으로 **바뀐 문장만** 임베딩 | ○ | ○ | **설계 완료(2026-09-23, `docs/02-spec/version-history-설계.md` · ADR-0031).** 대화 자산·답변설정·표시설정만 대상 — 채널 배포·slug·상태·금지어(전역)는 제외. **환경·승격·트래픽 전환·태깅은 No.40** |
````

### C-2. §4-1 No.40 행 비고 — 경계 문구 정밀화

**찾을 원문**
````text
Dialogflow CX 벤치마킹. 25번(챗봇 버전 롤백)은 "사후 복원"이고 이건 "배포 전 격리 검증" |
````
**바꿀 내용**
````text
Dialogflow CX 벤치마킹. 25번(챗봇 버전 롤백)은 **"한 챗봇의 시간축 사후 복원"**(환경·승격·태깅·트래픽 전환 없음, 버전 라벨은 자유 메모 — ADR-0031 §8)이고 이건 "배포 전 격리 검증". 착수 시 No.25의 캡처·무결성 검사를 **ID 재매핑 적재**와 결합해 재사용할 수 있다 |
````

---

## D. 이 목록에 넣지 않은 것 (참고)

| 대상 | 사유 |
|---|---|
| `docs/03-design/UIUX_준수기준.md` | 변경 없음 — 파괴적 동작 확인·색상 단독 금지 규칙을 그대로 적용(요구사항 §10) |
| `docs/04-test/시험항목.md`·`시험데이터.md` | test-automation 단계에서 AC-H1~H4 + 픽스처 4종(설계서 §17)을 추가한다 |
| `docs/02-spec/security-audit-설계.md` 95행 재검토 트리거 | ADR-0016 갱신 각주(B-3 ⑥)로 "발동하지 않음"을 기록했다. 세부 설계서 본문은 이력 문서로 두고 수정하지 않는다 |
| `docs/02-spec/nlu-rag-answering-설계.md`(재색인 큐) | `ReindexQueueService` 재실행 플래그는 동작 계약(동시 1건·409)을 바꾸지 않는 결함 보완이라 개발명세서 §5 확장성(A-19)과 `version-history-설계.md` §8.7에만 기록한다 |
| 코드 파일 | 이 목록 범위 밖 — `version-history-설계.md` §2.5 체크리스트 |
