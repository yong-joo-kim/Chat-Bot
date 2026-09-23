# No.28 운영 예약 배포 — 기존 문서 패치 목록

> 작성: system-architect · 2026-09-23 · 근거: `docs/02-spec/scheduled-deploy-설계.md`, `docs/02-spec/decisions/ADR-0032-scheduled-deploy-one-shot-actions-and-db-claimed-polling.md`
> **적용 방법**: 각 항목의 "찾을 원문"을 대상 파일에서 **정확히 1회** 찾아 "바꿀 내용"으로 교체한다. 모든 원문은 2026-09-23 시점 파일에서 복사했고 문자열 검색으로 유일성을 확인했다. append 항목은 원문을 그대로 포함한 채 뒤에 덧붙인다.
> **줄바꿈 주의**: 대상 파일 3종(`개발명세서.md` 등)은 **CRLF**다. 모든 "찾을 원문"은 **한 줄 안의 부분 문자열**(줄바꿈 미포함)로 잡았으므로 줄바꿈 형식과 무관하게 일치한다. "바꿀 내용"의 줄바꿈(LF)은 적용 스크립트가 대상 파일의 줄바꿈으로 정규화하는 것을 권장한다.
> **순서 독립**: 어떤 "바꿀 내용"도 다른 항목의 "찾을 원문"을 새로 만들어 내지 않는다(같은 줄에 걸리는 A-14/A-15, A-17/A-18, A-22/A-23/A-24는 서로 겹치지 않는 부분 문자열이다).
> 코드 변경은 이 파일의 범위가 아니다 — 설계서 §2.5·§9 체크리스트를 따른다.
> ⚠ 참고: `ADR-0011-…md` 마지막 줄에 문서 내용이 아닌 `</content>` 문자열이 들어 있다(기존 편집 흔적). B-7은 그 **앞**(118행 끝)에 덧붙이며 해당 문자열은 건드리지 않는다 — 정리 여부는 별도 판단.
> 항목 수: 개발명세서 34 · ADR 7 · 기능요구사항 2 = **43건**

---

## A. `docs/02-spec/개발명세서.md`

### A-1. §2 워크스페이스 상태 표 — `deploy-schedules` · `common/polling` 행 추가

**찾을 원문**
````text
신규 권한 0종**(ADR-0031) |
````
**바꿀 내용**
````text
신규 권한 0종**(ADR-0031) |
| **`apps/api/src/deploy-schedules`** · **`apps/api/src/common/polling`** | **운영 예약 배포 Phase에 신설**(No.28) — 1회성 예약 3종(버전 복원 · 공개 시작 · WEB 채널 열기/닫기) + 인프로세스 폴링 실행 엔진(DB CAS 선점 · 임대). 반영은 기존 `VersionRestoreService.restore()`와 신규 `channels/publication.service.ts`(상태+채널 원자 전환)를 **호출만** 한다. **`packages/dialogue-engine`·ml-worker·widget 변경 0건 · 신규 외부 접촉면 0건 · `@Public()` 추가 0건 · 신규 권한 0종**(ADR-0032) |
````

### A-2. §2.1 `actor` 전달 규약 — 요청 컨텍스트 없는 예약 실행 경로

**찾을 원문**
````text
actor가 비즈니스 인자인 경우(본인 비밀번호 변경 등)에만 컨트롤러의 `@CurrentUser()`로 받아 서비스 시그니처에 명시적으로 넘긴다(ADR-0016).
````
**바꿀 내용**
````text
actor가 비즈니스 인자인 경우(본인 비밀번호 변경 등)에만 컨트롤러의 `@CurrentUser()`로 받아 서비스 시그니처에 명시적으로 넘긴다(ADR-0016). **[No.28] 요청 컨텍스트가 없는 예약 실행 경로**는 ALS를 읽지 않고 주체를 인자(`ScheduledInvocation.actor` → `AuditRecordInput.actorOverride`)로 넘긴다 — 감사 주체는 실행 직전 재검증을 통과한 **예약자**다(ADR-0032 §5).
````

### A-3. §2.2 기능그룹별 모듈 배치 표 — No.28 행 추가

**찾을 원문**
````text
`chatbots`(영구삭제 동반 삭제 3테이블) | **설계 완료 → `version-history-설계.md`** |
````
**바꿀 내용**
````text
`chatbots`(영구삭제 동반 삭제 3테이블) | **설계 완료 → `version-history-설계.md`** |
| **운영 예약 배포 (No.28)** | **`deploy-schedules`(신규 — 예약 CRUD·미리보기·충돌 배너·요약/메타 · 실행 엔진·CAS/임대 저장소 · 동작별 실행기 레지스트리 · ★`restore()`의 두 번째 호출부 `restore-version.executor.ts`) + `common/polling`(신규 — 도메인 무관 `PollingLoop`·`Clock`·임대 순수 함수)** + `channels`(`ChatbotPublicationService` — 공개 전환 원자 경로) · `versions`(`restore()` 선택 인자·`RESTORE_BUSY`·보존 보호·삭제 409 · `VersionRestoreService`/`VersionDiffService` export — applier 미export) · `validation`(`TestRunService` export — 실행 직후 TC 옵션) · `chatbots`(영구삭제 동반 삭제 14테이블) | **설계 완료 → `scheduled-deploy-설계.md`** |
````

### A-4. §2.2 주석 "제안과 자산의 분리" — 예약 실행기 갱신 각주

**찾을 원문**
````text
Job 완료 콜백이 자산을 직접 쓰는 코드 경로는 **0건**이다(정적 검사로 강제 — ADR-0025).
````
**바꿀 내용**
````text
Job 완료 콜백이 자산을 직접 쓰는 코드 경로는 **0건**이다(정적 검사로 강제 — ADR-0025). **[갱신 2026-09-23 No.28]** 운영 예약 배포의 실행기도 자산을 **직접 쓰지 않는다** — 관리자가 미리보기로 승인해 해시에 묶은 예약에 한해 `VersionRestoreService.restore()`를 호출할 뿐이며, `restore()`의 호출부는 관리자 요청 핸들러와 예약 실행기 **2곳**, applier는 여전히 `restore()` 안에서만 호출된다(ADR-0032 §6, ADR-0025 갱신 각주).
````

### A-5. §2.2 주석 블록 — 엔진 불가침·모듈 의존 방향(No.28) 추가

**찾을 원문**
````text
복원 applier가 들어가지 않는다**(ADR-0025 봉인 L1과 같은 방식 — ADR-0031).
````
**바꿀 내용**
````text
복원 applier가 들어가지 않는다**(ADR-0025 봉인 L1과 같은 방식 — ADR-0031).
>
> **엔진 불가침(운영 예약 배포 No.28)**: 이 그룹은 엔진을 **호출하지도, 한 줄도 바꾸지도 않는다**(FR-0-78). 엔진 패키지에 `deploySchedule` 심볼 **0건**을 정적 검사가 단언한다.
>
> **모듈 의존 방향(No.28)**: `deploy-schedules → versions(VersionRestoreService·VersionDiffService) / version-capture(현재 해시 계산 — 읽기) / channels(ChatbotPublicationService) / chatbots / validation(TestRunService — 실행 직후 TC 1파일) / audit-logs` 단방향이다. **예약 모듈은 대화 자산 6모듈·`AnswerSettingsModule`·`AugmentationModule`·`LearningModule`·`ClassifierModule`·`TrainingJobsModule`·`ConversationModule`을 import하지 않고**, `VersionsModule`은 **`VersionRestoreApplier`를 export하지 않는다** — 예약이 자산을 바꾸는 경로는 `restore()` 호출 1곳뿐이며 applier 직접 호출은 **주입 자체가 불가능**하다. 관리자 즉시 경로인 `ChatbotsService.updateStatus()`·`ChannelsService.upsert()`도 호출하지 않는다 — 공개 전환은 판정 함수(`evaluateStatusTransition`·채널 `IMPLEMENTED` 규칙)를 **호출만** 하는 `ChatbotPublicationService`가 한 트랜잭션으로 처리한다(ADR-0032).
````

### A-6. §3 엔터티 표 — `DeploySchedule` 예약 행 실체화

**찾을 원문**
````text
| `DeploySchedule` | 운영 예약 배포 | 28 |
````
**바꿀 내용**
````text
| **`DeploySchedule`** | **1회성 운영 예약 배포(No.28, ADR-0032). 1행 = 동작 1개 = 실행 최대 1회(재시도는 카운터).** `action`(`RESTORE_VERSION`/`PUBLISH`/`SET_WEB_CHANNEL` — 판별값)·`params`(JSON, 식별자·불리언만 — 동작 추가 시 마이그레이션 불필요)·`targetVersionId`(복원 전용 비정규화 — 보존 보호·삭제 409의 조회 키, **FK 없음**)/`targetVersionNo`/`targetContentHash`·**`expectedContentHash`**(생성 시 미리보기 기준 해시 — 실행 시 불일치면 **미실행**)·`predecessorScheduleId`(체인 기준)·`acknowledgeActive`·`scheduledAt`(UTC 순간, 분 단위)·`status`(`PENDING`/`RUNNING`/`SUCCEEDED`/`FAILED`/`MISSED`/`HELD`/`CANCELLED`)·`claimToken`/`claimedAt`(CAS 선점·임대)·`attemptCount`/`lastTransientReason`·`delaySeconds`·`outcome`(`APPLIED`/`NOOP`/`RECOVERED`)/`failureReason`·`resultSummary`(JSON, **원문 없음**)·`heldReason`/`heldByScheduleId`·`postRunTestSetId`/`testRunId`(실행 직후 TC 옵션)·`memo`·`createdBy*`(예약자 스냅샷 — 실행 시 재검증 키)·`cancelled*`·`acknowledged*`. **부분 유니크 2개**(같은 챗봇 활성 예약의 같은 분 금지 · 챗봇당 RUNNING 1건)는 마이그레이션 원시 DDL에만 존재한다(`test_runs` 선례). 결과 테이블을 나누지 않는다 | 28 |
````

### A-7. §3 미도입 결정 제목 — 10건 → 11건

**찾을 원문**
````text
미도입 결정 10건
````
**바꿀 내용**
````text
미도입 결정 11건
````

### A-8. §3 미도입 결정 ⑩ 보론 + ⑪ 신설

**찾을 원문**
````text
가져오기는 검증되지 않은 자산 주입 경로다(**ADR-0031**).
````
**바꿀 내용**
````text
가져오기는 검증되지 않은 자산 주입 경로다(**ADR-0031**). **[보론 2026-09-23] No.28에서 `DeploySchedule`로 예약을 도입했다(ADR-0032)** — ⑩의 "예약 복원 테이블"이 비워 둔 자리이며, 복원 자체는 여전히 동기 `restore()`이고 예약은 그 호출 시각만 정한다.
> ⑪ **반복 예약(cron 표현식) 컬럼·예약 실행 이력(1:N) 테이블·예약 잠금 테이블·알림 발송 테이블·엔진 heartbeat 테이블·draft/published 이중 자산** — 예약 1건 = 실행 최대 1회라 재시도는 카운터로 충분하고, 중복 실행 방지는 DB CAS 선점 + 부분 유니크 인덱스로, 엔진 가동 여부는 "기한 넘긴 `PENDING` 건수"로 판정한다. 반복 예약은 misfire·체인 의미가 달라 별도 ADR, 외부 알림은 No.41/45, **운영에 보이지 않는 준비 편집(draft/published)은 No.40의 본체**다(**ADR-0032**).
````

### A-9. §3.1 참조 무결성 — FK 미설정 예외에 `DeploySchedule` 추가

**찾을 원문**
````text
**`ChatbotVersion`의 `restoredFromVersionId`/`createdById`** 는 **FK를 걸지 않는다**
````
**바꿀 내용**
````text
**`ChatbotVersion`의 `restoredFromVersionId`/`createdById`**, **`DeploySchedule`의 `targetVersionId`/`predecessorScheduleId`/`heldByScheduleId`/`postRunTestSetId`/`testRunId`/`createdById`/`cancelledById`/`acknowledgedById`** 는 **FK를 걸지 않는다**
````

### A-10. §3.1 파생 데이터 동반 삭제 — `DeploySchedule`(13 → 14 테이블)

**찾을 원문**
````text
(No.25 — 10 → 13 테이블, 삭제 순서 `ChatbotVersionPayload → ChatbotVersion → ChatbotVersionSequence`).
````
**바꿀 내용**
````text
(No.25 — 10 → 13 테이블, 삭제 순서 `ChatbotVersionPayload → ChatbotVersion → ChatbotVersionSequence`). **`DeploySchedule`도 같은 분류**다(No.28 — 13 → 14 테이블). 예약이 영구삭제를 막지 않는다(AC-D5-3). 반대로 **활성 예약이 참조하는 `ChatbotVersion`은 보존 정리에서 제외되고 수동 삭제가 `409`**다(ADR-0032).
````

### A-11. §3.1 인덱스 목록 — `deploy_schedules` 추가

**찾을 원문**
````text
`chatbot_versions(chatbotId, trigger, createdAt)`**(
````
**바꿀 내용**
````text
`chatbot_versions(chatbotId, trigger, createdAt)`**, **`deploy_schedules(status, scheduledAt)`, `deploy_schedules(chatbotId, scheduledAt)`, `deploy_schedules(chatbotId, status)`, `deploy_schedules(targetVersionId, status)` + 부분 유니크 2개(`(chatbotId, scheduledAt) WHERE status IN (PENDING,HELD,RUNNING)` · `(chatbotId) WHERE status = RUNNING` — 마이그레이션 원시 DDL에만 존재, `test_runs` 선례)**(
````

### A-12. §4 API 표 — "배포" 예고 행 실체화

**찾을 원문**
````text
| 배포 | `POST /chatbots/:id/deploy-schedule` | 28 |
````
**바꿀 내용**
````text
| **운영 예약 배포** | **`/chatbots/:chatbotId/deploy-schedules`(GET 목록 — `scheduledAt` 정렬 고정·해시 계산 없음 / POST 생성 — 동작 판별 유니온 `RESTORE_VERSION`｜`PUBLISH`｜`SET_WEB_CHANNEL`, `scheduledAt`은 오프셋 포함 ISO 8601 필수), `GET .../deploy-schedules/notice`(자산 편집 화면 충돌 배너 — ⚠ `:scheduleId`보다 **먼저 선언**), `POST .../deploy-schedules/preview`(체인 기준·blockers·준비도 — DB 변경 0), `GET｜PATCH .../deploy-schedules/:scheduleId`(수정은 시각·메모만), `POST .../:scheduleId/state-check｜cancel｜resume｜acknowledge`, 전역 `GET /deploy-schedules`(+`/summary` 확인 필요·24시간 요약, `/meta` 시간대·엔진 상태·한도)**. 총 13개 핸들러. 가드는 `chatbot:read` 기준선이며 **변경 권한은 서비스가 동작별로 판정**한다(복원 = `dialogue:write`+`chatbot:write` · 공개 = `chatbot:write`(+채널 동시 활성화 시 `channel:write`) · 채널 = `channel:write` · 실행 직후 TC 지정 시 + `simulation:write` — 신규 권한 0종). **외부 cron용 내부 트리거 경로를 만들지 않는다 · `@Public()` 추가 0건** | 28 |
````

### A-13. §4 정정 이력 — 2026-09-23c 항목 추가

**찾을 원문**
````text
⑤ **`@Public()`은 여전히 6개**(`version-history-설계.md` §10).
````
**바꿀 내용**
````text
⑤ **`@Public()`은 여전히 6개**(`version-history-설계.md` §10).
> **정정 이력(2026-09-23c — 운영 예약 배포)**: ① 예고 행 `POST /chatbots/:id/deploy-schedule`(단수·`:id`)을 **`/chatbots/:chatbotId/deploy-schedules` 복수 리소스 10개 + 전역 3개**로 구체화했다 — 예약은 목록·상세·수정·취소·재개가 있는 **리소스**다. ② 생성 전 **미리보기 경로를 예약 쪽에 둔다** — 복원 체인(선행 예약 반영 후 상태 기준)의 기준 결정을 서버가 해야 프런트가 체인 규칙을 복제하지 않는다. ③ 동작별 권한은 경로 분리가 아니라 **서비스 판정 1방식**으로 통일했다(수정·취소·재개는 행을 읽어야 동작을 안다). ④ 공개 경로 수는 변하지 않으며 외부 cron 트리거 경로를 만들지 않는다(`scheduled-deploy-설계.md` §13).
````

### A-14. §4.1 목록 쿼리 — 정렬 예외 4건 → 5건

**찾을 원문**
````text
**예외 4건**
````
**바꿀 내용**
````text
**예외 5건**
````

### A-15. §4.1 목록 쿼리 — `/deploy-schedules` 정렬 규칙 추가

**찾을 원문**
````text
(정렬 파라미터를 받지 않는다 — 버전 번호가 곧 시간축이다) |
````
**바꿀 내용**
````text
(정렬 파라미터를 받지 않는다 — 버전 번호가 곧 시간축이다), **`/deploy-schedules`는 정렬 키 `scheduledAt` 고정 · 방향만 `order`(기본 `asc`)**(예약은 시각이 곧 의미다) |
````

### A-16. §4.1 날짜 규약 — 예약 시각 입력 규칙

**찾을 원문**
````text
통계 응답은 `timezone` 필드로 그 기준을 명시한다**(ADR-0017) |
````
**바꿀 내용**
````text
통계 응답은 `timezone` 필드로 그 기준을 명시한다**(ADR-0017). **[No.28] 예약 시각 입력은 오프셋 포함 ISO 8601만 받는다**(`…Z` 또는 `…+09:00` — 오프셋 없는 로컬 시각은 `400`, 서버 OS 시간대와 무관). 분 단위로 정규화해 UTC 순간으로 저장하며, 표시·입력 기준 시간대는 `STATS_TIMEZONE`(`GET /deploy-schedules/meta`로 전달)이다(ADR-0032 §7) |
````

### A-17. §4.1 오류 봉투 — `RESTORE_PREVIEW_STALE` 의미 정정

**찾을 원문**
````text
`RESTORE_PREVIEW_STALE`(409, 미리보기 이후 변경·동시 쓰기 충돌)
````
**바꿀 내용**
````text
`RESTORE_PREVIEW_STALE`(409, 미리보기 이후 변경 — **동시 쓰기 경합은 No.28부터 `RESTORE_BUSY`로 분리**)
````

### A-18. §4.1 오류 봉투 — 운영 예약 배포 6종 추가

**찾을 원문**
````text
이 9종도 대화 경로에서는 쓰이지 않는다.
````
**바꿀 내용**
````text
이 9종도 대화 경로에서는 쓰이지 않는다. **운영 예약 배포 그룹이 6종 추가** — `DEPLOY_SCHEDULE_INVALID_TIME`(400, 리드타임 5분·최대 90일·같은 챗봇 같은 분 위반), `DEPLOY_SCHEDULE_LIMIT_EXCEEDED`(409, 챗봇당 활성 5건), `DEPLOY_SCHEDULE_NOT_MODIFIABLE`(409, 허용 상태가 아닌 수정·취소·재개), `DEPLOY_SCHEDULE_PRECONDITION_FAILED`(409, 복원 blockers·체인 순서·이미 공개·중복 공개 등 + `details[].message` 사유 코드), `VERSION_REFERENCED_BY_SCHEDULE`(409, 활성 예약이 참조하는 버전 삭제), **`RESTORE_BUSY`(409, 복원·예약 생성 트랜잭션의 동시 쓰기 경합 — 재시도 가능. 해시 불일치는 계속 `RESTORE_PREVIEW_STALE`)**. 이 6종도 대화 경로에서는 쓰이지 않는다.
````

### A-19. §4.1 챗봇 스코프 — 예약의 `ARCHIVED` 규칙

**찾을 원문**
````text
교차 챗봇 `versionId`는 `404`다 |
````
**바꿀 내용**
````text
교차 챗봇 `versionId`는 `404`다. **운영 예약 배포는 조회(목록·상세·notice·상태 점검)와 취소·확인을 `ARCHIVED`에서도 허용**하고(남은 예약을 정리할 수 있어야 한다) 생성·수정·재개는 `409`다. 교차 챗봇 `scheduleId`는 `404`다 |
````

### A-20. §4.1 권한 — 예약 권한 = 즉시 실행 권한 + 실행 시 재검증

**찾을 원문**
````text
(신규 권한 0종, PM 확정 — ADR-0015 갱신 각주) |
````
**바꿀 내용**
````text
(신규 권한 0종, PM 확정 — ADR-0015 갱신 각주). **[2026-09-23 No.28] 예약의 생성·수정·취소·재개·확인 권한 = 그 동작을 즉시 실행할 때의 권한**(단일 순수 함수 `requiredPermissions`)이며, 가드는 `chatbot:read` 기준선만 두고 서비스가 동작별로 판정한다(관리 권한이 전혀 없으면 행 조회 전 `403`). **실행 직전 예약자의 계정 상태(`ACTIVE`)와 현재 역할의 권한을 재검증**하고 불충족이면 실행하지 않는다 — 예약은 권한 우회 수단이 아니다(신규 권한 0종 — ADR-0032 §5) |
````

### A-21. §5 성능 — No.28 항목 추가

**찾을 원문**
````text
**대화 로그 유실 0건을 실측으로 확인**한다(미달 시 비동기 복원 재검토 — ADR-0031).
````
**바꿀 내용**
````text
**대화 로그 유실 0건을 실측으로 확인**한다(미달 시 비동기 복원 재검토 — ADR-0031).
  - **[신규 2026-09-23 — 운영 예약 배포] 이 그룹도 공개 대화 API의 성능 예산에 영향이 0건**이다(대화 경로 신규 조회·계산 0건). 실행 엔진 — **유휴 tick = `(status, scheduledAt)` 인덱스 쿼리 1건(5ms 이내)** · 막힘이 없을 때 **실행 시작 지연 ≤ 폴링 주기 + 30초(P95 60초)** · 복원 실행 = No.25 복원 예산 + 선점·재검증·종결 오버헤드 **100ms 이내** · 동시 도래 예약은 **챗봇 단위 순차 + tick 예산 20초**로 다른 API P95 증가 **20% 미만**. 관리자 경로 — **예약 목록 P95 300ms(해시·캡처 계산 없음)** · 상태 점검은 캡처 1회(P95 1초).
````

### A-22. §5 보안 — "승인 없는 자산 변경 금지" 항목 갱신

**찾을 원문**
````text
**"자동으로 하지 않기로 한다"는 약속 대신 할 수 없게 만든다.**
````
**바꿀 내용**
````text
**"자동으로 하지 않기로 한다"는 약속 대신 할 수 없게 만든다.** **[갱신 2026-09-23 No.28 — ADR-0032 §6]** 운영 예약 배포의 실행기도 자산을 **직접** 쓰지 않는다 — 관리자가 미리보기로 확인하고 해시에 묶어 생성한 예약에 한해 `VersionRestoreService.restore()`를 호출할 뿐이며(`restore()` 호출부는 관리자 요청 핸들러와 예약 실행기 **정확히 2곳**), 예약 모듈의 Prisma 쓰기 대상은 `DeploySchedule` 하나뿐임을 `deploy-schedule-sealing.spec.ts`가 단언한다. `asset-write-sealing.spec.ts` S-1 허용 파일은 **3개 그대로**다.
````

### A-23. §5 보안 — No.25 봉인 항목 ① 문구 개정

**찾을 원문**
````text
복원은 관리자 요청 핸들러 1곳의 **과거 상태 재현**이고
````
**바꿀 내용**
````text
복원은 관리자 요청 핸들러(**No.28부터 관리자가 미리보기로 승인한 예약의 실행기 포함 — 둘 다 `restore()` 경유, ADR-0032 §6**)의 **과거 상태 재현**이고
````

### A-24. §5 보안 — 운영 예약 배포 봉인 항목 신설

**찾을 원문**
````text
⑥ 위 전부를 `version-sealing.spec.ts` **9단언**으로 강제한다.
````
**바꿀 내용**
````text
⑥ 위 전부를 `version-sealing.spec.ts` **9단언**으로 강제한다.
  - **[신규 2026-09-23] 운영 예약 배포의 봉인(ADR-0032)**: ① 예약 모듈은 대화 자산·표시설정·답변설정·챗봇 상태·채널을 **직접 쓰지 않는다** — Prisma 쓰기 대상은 `DeploySchedule`뿐이고(서비스·저장소 2파일), 반영은 `VersionRestoreService.restore()`와 `ChatbotPublicationService`를 **호출만** 한다. `VersionsModule`은 applier를 **export하지 않는다**(주입 불가). ② **예약은 권한 우회 수단이 아니다** — 생성 권한 = 즉시 실행 권한, 실행 직전 예약자 계정·권한 재검증. ③ **예약 시점에 확인한 상태가 아니면 자산을 바꾸지 않는다**(기준 해시 불일치 → 미실행 + 확인 필요, 후속 예약 보류). ④ **정확히 한 번(at-most-once)** — DB CAS 선점 + 부분 유니크 인덱스, 임대 만료 시 재실행이 아니라 실제 상태로 판정. ⑤ **아웃바운드 HTTP 0건 · 공개 경로 추가 0건 · 외부 cron 트리거 경로 0건 · 예약별 타이머 0건**. ⑥ 예약 `params`·`resultSummary`에 원문 필드가 없고 서버 로그에 메모·원문을 남기지 않는다. ⑦ 위 전부를 `deploy-schedule-sealing.spec.ts` **16단언**으로 강제한다.
````

### A-25. §5 확장성 — 예약 실행 엔진의 다중 인스턴스 규약

**찾을 원문**
````text
**벡터 인덱스(pgvector/HNSW) 도입의 재검토 트리거는 챗봇당 2만 벡터 초과다.**
````
**바꿀 내용**
````text
**운영 예약 배포가 추가한 실행 엔진은 단일 인스턴스를 가정하지 않는다** — 예약의 원천은 DB이고, 실행 선점은 DB 조건부 갱신(CAS)과 챗봇당 RUNNING 1건 부분 유니크 인덱스로, 죽은 인스턴스의 실행은 **임대(lease) 만료 후 실제 상태 판정**으로 처리한다(`TrainingJob`처럼 "기동 시 잔존 = 전부 고아"로 보지 않는다). 새 프로세스 로컬 상태는 없으며 폴링 루프는 도메인 무관 부품(`common/polling/PollingLoop`)이라 **교체 지점 1곳**이고 No.45 정리 배치가 재사용할 수 있다. `DEPLOY_SCHEDULE_ENABLED`로 실행 전담 인스턴스를 지정할 수 있다(ADR-0032). **벡터 인덱스(pgvector/HNSW) 도입의 재검토 트리거는 챗봇당 2만 벡터 초과다.**
````

### A-26. §5 가용성 — 예약 실행 엔진의 실패 격리

**찾을 원문**
````text
외부 서버 장애 시 회로차단기(연속 5회 → 60초 open)가 체감 지연을 흡수한다.**
````
**바꿀 내용**
````text
외부 서버 장애 시 회로차단기(연속 5회 → 60초 open)가 체감 지연을 흡수한다.** **[신규 2026-09-23] 예약 실행 엔진의 실패는 API를 멈추지 않는다** — tick 예외는 흡수하고 다음 tick이 계속되며(타이머 생존), 한 예약의 실패가 다른 챗봇 예약을 막지 않는다. 일시적 원인(DB 경합·진행 중 작업·복원 잠금)만 15분 창 안에서 재시도하고 영구적 원인은 즉시 실패로 종결해 **같은 챗봇 후속 예약을 보류**한다(fail-stop — 어긋난 반영보다 멈춤이 싸다). 서버가 예정 시각에 내려가 있었으면 **유예(기본 10분) + 폴링 1주기** 안의 기동만 지연 실행하고 그 밖은 `MISSED`로 남긴다(운영 시간대 한가운데서의 뒤늦은 반영 방지 — ADR-0032 §4).
````

### A-27. §5 DB 이식성 — `RESTORE_BUSY` 매핑 · CAS 원시 SQL 0건

**찾을 원문**
````text
직렬화 실패(`P2034`)를 `409 RESTORE_PREVIEW_STALE`로 매핑한다(지정 지점 2곳의 상수).
````
**바꿀 내용**
````text
직렬화 실패(`P2034`)를 **`409 RESTORE_BUSY`**(재시도 가능한 경합 — 2026-09-23 No.28에서 해시 불일치 `RESTORE_PREVIEW_STALE`과 분리)로 매핑한다(지정 지점 2곳의 상수). **[No.28] 예약 선점·종결·임대 회수는 Prisma `updateMany` + 영향 행 수(CAS)로 표현해 런타임 원시 SQL 0건을 유지**하며, 부분 유니크 인덱스 2개는 `test_runs` 선례처럼 **마이그레이션 DDL에만** 존재한다(SQLite·Postgres 공통 문법 — `CREATE UNIQUE INDEX … WHERE`).
````

### A-28. §5.1 환경변수 표 — 5종 추가

**찾을 원문**
````text
| **`VERSION_TX_TIMEOUT_MS`** | `apps/api/.env` | — | `30000` | 캡처 읽기·복원 쓰기 인터랙티브 트랜잭션 timeout(Prisma 기본 5초 대체) |
````
**바꿀 내용**
````text
| **`VERSION_TX_TIMEOUT_MS`** | `apps/api/.env` | — | `30000` | 캡처 읽기·복원 쓰기 인터랙티브 트랜잭션 timeout(Prisma 기본 5초 대체) |
| **`DEPLOY_SCHEDULE_ENABLED`** | `apps/api/.env` | — | `true` | 이 인스턴스의 예약 실행 엔진 스위치(No.28). **CRUD는 항상 동작**하며 꺼져 있으면 콘솔이 경고한다. `true｜false｜1｜0`만 받는 명시 파서 |
| **`DEPLOY_SCHEDULE_POLL_INTERVAL_MS`** | `apps/api/.env` | — | `30000` | 폴링 주기(5000~300000). 재시도 간격도 이 값이다 |
| **`DEPLOY_SCHEDULE_MISFIRE_GRACE_MINUTES`** | `apps/api/.env` | — | `10` | 지연 실행 유예(0~1440). 실제 판정은 **유예 + 폴링 1주기 + 5초**(0이어도 정상 가동 중 폴링 지연은 놓침이 아니다) |
| **`DEPLOY_SCHEDULE_RETRY_WINDOW_MINUTES`** | `apps/api/.env` | — | `15` | 일시적 원인(DB 경합·진행 중 작업·복원 잠금) 재시도 창(1~1440) |
| **`DEPLOY_SCHEDULE_LEASE_MINUTES`** | `apps/api/.env` | — | `5` | `RUNNING` 임대. `2 × VERSION_TX_TIMEOUT_MS + 60초` 미만이면 기동 시 경고 + 하한으로 보정 |
````

### A-29. §5.1 환경변수 주석 — No.28 문단 추가

**찾을 원문**
````text
(첫 수동 저장 또는 첫 대량 작업이 v1이 된다).**
````
**바꿀 내용**
````text
(첫 수동 저장 또는 첫 대량 작업이 v1이 된다).**
> **운영 예약 배포 그룹(No.28)이 추가한 5개도 전부 선택이며 API 전용이다(ml-worker 변수 추가 0건). 하나도 설정하지 않으면 엔진 활성 · 폴링 30초 · 유예 10분 · 재시도 창 15분 · 임대 5분으로 정상 동작한다. `DEPLOY_SCHEDULE_LEASE_MINUTES`가 `2 × VERSION_TX_TIMEOUT_MS + 60초`보다 짧으면 기동 시 경고 로그 + 하한으로 보정한다(기동 실패 아님). `DEPLOY_SCHEDULE_ENABLED`는 `true｜false｜1｜0`만 받는 명시 파서로 검증한다 — 2026-09-24부터 모든 boolean 환경변수(`TRUST_PROXY`·`AUTH_COOKIE_SECURE`·`CLASSIFIER_ENABLED`·`VERSION_AUTO_SNAPSHOT_ENABLED` 포함)가 같은 명시 파서를 쓴다(`scheduled-deploy-설계.md` §15). 리드타임·최대 기간·간격·챗봇당 상한은 환경변수가 아니라 FE/BE 공용 코드 상수(`DEPLOY_SCHEDULE_LIMITS`)다. 신규 seed는 없다 — `DeploySchedule` 0행이 정상 상태다.**
````

### A-30. §6 결정 20 — No.28 갱신 각주

**찾을 원문**
````text
OR 조합은 지원하지 않는다.
````
**바꿀 내용**
````text
OR 조합은 지원하지 않는다.
    - **갱신(2026-09-23 — No.28)**: 운영 예약 배포는 **신규 권한 0종**이다. 예약의 생성·관리 권한 = 그 동작의 즉시 실행 권한이며, 동작이 행에 저장돼 있어 **가드가 아니라 서비스가 동작별로 판정**한다(가드는 `chatbot:read` 기준선 — fail-closed 유지, 관리 권한이 전혀 없으면 행 조회 전 `403`). **실행 직전 예약자의 `status=ACTIVE`와 현재 역할의 권한을 재검증**하며 `mustChangePassword`는 보지 않는다(권한 박탈이 아니다). `Permission` 유니온 15종 · 공개 경로 6곳 불변(ADR-0032 §5, ADR-0015 갱신 각주).
````

### A-31. §6 결정 21 — No.28 갱신 각주

**찾을 원문**
````text
§6의 `(targetType, targetId, createdAt)` 인덱스 재검토 트리거는 **발동하지 않는다**(ADR-0031).
````
**바꿀 내용**
````text
§6의 `(targetType, targetId, createdAt)` 인덱스 재검토 트리거는 **발동하지 않는다**(ADR-0031).
    - **갱신(2026-09-23 — No.28)**: `AuditTargetType`에 **`DeploySchedule`**(14 → 15종 — 예약 생성 `CREATE` · 시각/메모 수정 `UPDATE` · 취소·보류 해제 `STATUS_CHANGE`)을 추가하고 **`AuditAction`은 추가하지 않는다**. 예약 **실행**은 기존 액션(`RESTORE`·`STATUS_CHANGE`·`UPDATE`)으로 기록하되 **주체 = 예약자**(`actorOverride` — 요청 컨텍스트가 없는 경로의 명시 주체 전달, auth 경로에 이은 두 번째 사용처)이고 summary에 `[예약 실행 #<id 앞 8자>]` 접두를 붙인다. **NOOP·실패·누락·보류·확인 표시는 기록하지 않는다**(쓰기 없음 — 자동 스냅샷 비감사와 같은 판단). `RequestContextService.get()` 호출 지점은 여전히 `AuditLogService` 1곳이다(ADR-0032 §5, ADR-0016 갱신 각주).
````

### A-32. §6 결정 33 신설

**찾을 원문**
````text
→ **ADR-0031**(+ ADR-0002·0015·0016·0025·0027·0029 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0031**(+ ADR-0002·0015·0016·0025·0027·0029 갱신 각주)

33. **운영 예약 배포(No.28)의 반영 대상·실행 엔진·엄격 바인딩·misfire/재시도·체인 보류·권한/주체·봉인 개정 확정(2026-09-23)**: 이 그룹은 선행 7개 그룹이 "스케줄러 인프라 부재"로 미뤄 온 **최초의 시각 트리거 실행 엔진**이며, 새로 만드는 것은 "무엇을"이 아니라 **"언제"** 다. **① 반영 대상 = 이미 검증된 반영 동작 3종의 1회성 예약**(PM 확정 P-1) — `RESTORE_VERSION`(No.25 `restore()`를 한 줄도 바꾸지 않고 호출) · `PUBLISH`(DRAFT→ACTIVE + 선택적 WEB 채널 동시 활성화를 **한 트랜잭션**으로 — 신규 `ChatbotPublicationService`가 기존 판정 함수를 호출만 한다) · `SET_WEB_CHANNEL`(`ACTIVE→DRAFT`가 없으므로 공개 종료의 유일한 가역 수단). **draft/published 분리는 기각**한다 — 그것은 **No.40의 본체**이며 자산 서비스·대화 경로·임베딩 색인(버전 차원 부재)·학습 반영·TC·복원을 동시에 흔든다. No.40 착수 시 "포인터 전환" 동작 1개를 이 엔진에 추가하는 것이 접점이다(동작 유형 = 판별 유니온 + 매핑 타입 레지스트리). 준비 편집이 운영에 잠시 보이는 한계는 수용한다(P-2). **② 엔진 = 인프로세스 폴링(30초) + DB 조건부 갱신 선점(CAS) + 임대** — 예약별 `setTimeout`(재시작 소실 · 2³¹−1ms 초과 지연의 즉시 실행 함정)·`@nestjs/schedule`(폴링 이상을 주지 않으면서 의존성만 증가)·외부 cron(내부 트리거 = 공개 표면 증가)을 기각했다. 부분 유니크 인덱스 2개(같은 챗봇 같은 분 금지 · 챗봇당 RUNNING 1건)가 간격·순서의 DB 차원 최종 방어선이고, 임대 만료 RUNNING은 **재실행하지 않고 실제 상태로 판정**한다(복원 = 이 예약의 `BEFORE_RESTORE` 백업 흔적 — 백업은 복원과 같은 트랜잭션이라 커밋의 증명). 단일 인스턴스 가정(기동 시 잔존 = 고아)을 반복하지 않는다. **③ 엄격 바인딩**(P-4) — 복원 예약은 생성 시 기준 해시를 **쓰기 트랜잭션 안에서** 확정하고 실행 시 불일치면 자산을 바꾸지 않는다(강행 옵션 없음). 같은 챗봇의 복원은 **체인**(기준 = 선행 복원 예약의 대상 해시)이며 **뒤에만 붙고**, 시각 수정은 활성 예약의 상대 순서를 바꾸지 못한다. 실패·누락 시 같은 챗봇 후속 예약은 **같은 트랜잭션에서 보류(HELD)**(fail-stop, P-8). **④ misfire = 유예 10분 + 폴링 1주기 허용오차**(P-5 — 허용오차가 없으면 유예 0에서 정상 가동 중에도 전부 누락), **재시도 = 일시적 원인(DB 경합·진행 중 작업·복원 잠금)만 30초 간격 15분 창**(P-6). 이를 위해 `restore()`의 **BUSY 경합을 `RESTORE_BUSY`로 분리**했다(해시 불일치는 계속 `RESTORE_PREVIEW_STALE`). **⑤ 권한 = 즉시 실행과 동일(신규 0종) + 실행 직전 예약자 계정·권한 재검증 + 감사 주체 = 예약자(`actorOverride`) + `[예약 실행]` 접두**(P-9) — 예약은 권한 우회 수단이 아니다. 복원 직전 백업의 생성자도 예약자다. **⑥ ★ ADR-0025/0031의 봉인 문구를 개정**한다 — "복원은 관리자 요청 핸들러 1곳"에서 **"`restore()`의 호출부는 관리자 요청 핸들러와 관리자가 미리보기로 승인한 예약의 실행기 2곳, applier는 `restore()` 안에서만"** 으로. `VersionsModule`이 applier를 export하지 않아 **주입 자체가 불가능**하고, `asset-write-sealing.spec.ts` S-1 허용 파일은 3개 그대로다(정적 검사 16단언). **⑦ 시간 = UTC 순간 저장 · 오프셋 포함 ISO 8601만 입력 · `STATS_TIMEZONE` 표시**(신규 시간대 변수 0). **⑧ 알림 = 콘솔 + 감사로그만**(P-10) — 아웃바운드 0건 · 공개 경로 추가 0건. 실행 직후 TC는 예약별 옵션(기본 꺼짐, 보고만 — P-3). No.25 연동: 활성 예약 참조 버전은 **보존 정리 제외 + 수동 삭제 409**. GPU 재산정 없음 — **No.28은 1 유지**(P-12). → **ADR-0032**(+ ADR-0002·0011·0015·0016·0025·0027·0031 갱신 각주)
````

### A-33. §7 인덱스 — 설계서 행 추가

**찾을 원문**
````text
요구사항 대비 해석 10건** | 요구사항: `docs/requirements/version-history.md` |
````
**바꿀 내용**
````text
요구사항 대비 해석 10건** | 요구사항: `docs/requirements/version-history.md` |
| **`scheduled-deploy-설계.md`** | **운영 예약 배포(No.28) — Prisma 변경안(`DeploySchedule` 1종 신설 + 부분 유니크 2개, **기존 테이블 컬럼 변경 0건·백필 불필요·DROP만으로 완전 롤백**, 챗봇 영구삭제 동반 삭제 14테이블), 상태 기계 7상태·전이별 CAS 조건, 동작 3종 실행기 전략 패턴·매핑 타입 레지스트리·No.40 확장점, `ChatbotPublicationService`(상태+채널 원자 전환), 미리보기·체인 규칙 R1~R7(기준 해시·append-only·순서 보존), 시각 규칙(FE/BE 공용 순수 함수), 폴링 엔진(`PollingLoop`·tick 계획 순수 함수·CAS 선점·임대 회수·graceful shutdown·시계 주입), misfire(유예 + 1주기 허용오차)·재시도 분류표·HELD 전파, 권한 단일 소스·실행 직전 예약자 재검증·`actorOverride` 감사, No.25 수정 4건(`RESTORE_BUSY`·`restore()` 선택 인자·보존 보호·삭제 409), 실행 직후 TC(G3 옵션), 준비도 경고 9종, 13개 엔드포인트(**공개 경로 추가 0건 · 신규 권한 0종**), `ApiErrorCode` 6종, 시간대(오프셋 필수·DST 안전 변환), 환경변수 5종, 정적 검사 16단언, 시험 관점(가짜 시계·2인스턴스), 알려진 제한 11건, 요구사항 대비 해석 15건** | 요구사항: `docs/requirements/scheduled-deploy.md` |
````

### A-34. §7 인덱스 — ADR-0032 행 추가

**찾을 원문**
````text
| 요구사항 J-1/J-2/J-4/J-5/J-6/J-8/J-9/J-11/J-14, FR-0-68~77, FR-H1-\*, FR-H3-\*, AC-H1~H4 |
````
**바꿀 내용**
````text
| 요구사항 J-1/J-2/J-4/J-5/J-6/J-8/J-9/J-11/J-14, FR-0-68~77, FR-H1-\*, FR-H3-\*, AC-H1~H4 |
| **`decisions/ADR-0032-scheduled-deploy-one-shot-actions-and-db-claimed-polling.md`** | **운영 예약 배포 = 기존 반영 동작 3종(버전 복원·공개 시작·WEB 채널 열기/닫기)의 1회성 시각 예약(draft/published 기각 → No.40) · 인프로세스 폴링 + DB CAS 선점 + 임대(`setTimeout`·`@nestjs/schedule`·외부 cron 기각) · 부분 유니크 2개 · ★ 엄격 해시 바인딩 + 복원 체인 append-only + fail-stop 보류 · misfire 유예 + 1주기 허용오차 · 일시적 원인만 재시도(`RESTORE_BUSY` 분리) · 권한 = 즉시 실행 권한 + 실행 직전 예약자 재검증 + 예약자 명의 감사 · ★ **ADR-0025/0031 봉인 문구 개정**(`restore()` 호출부 2곳, applier 미export로 구조 보장) · 콘솔+감사 알림만** | 요구사항 J-1/J-3/J-4/J-5/J-6/J-7/J-8/J-11/J-12/J-15, FR-0-78~87, FR-D1~D7, AC-D1~D6 |
````

---

## B. 기존 ADR (전부 파일 끝 append — 결정 본문은 수정하지 않는다)

### B-1. `docs/02-spec/decisions/ADR-0031-chatbot-version-snapshot-and-id-preserving-restore.md` — 예약 실행기의 `restore()` 호출 · `RESTORE_BUSY` 분리

**찾을 원문**
````text
- **분류기가 대화 경로에 편입됨**(ADR-0027 트리거) → 복원 시 "삭제"가 아니라 모델 버전 연동을 재검토.
````
**바꿀 내용**
````text
- **분류기가 대화 경로에 편입됨**(ADR-0027 트리거) → 복원 시 "삭제"가 아니라 모델 버전 연동을 재검토.


---

## 갱신 (2026-09-23 — No.28 예약 실행기가 `restore()`의 두 번째 호출부가 된다 · `RESTORE_BUSY` 분리)

운영 예약 배포(No.28, **ADR-0032**)가 §8에서 "만들지 않는다"고 적은 **예약 복원(No.28)** 을 도입한다. **이 ADR의 복원 의미론(스냅샷 범위 · ID 보존 차이 적용 · 해시 재확인·백업·교체·사후 검증의 단일 트랜잭션 · 파생 데이터 처리 · No.40 경계)은 한 줄도 바뀌지 않는다** — 예약은 `restore()`를 **지정 시각에 호출**할 뿐이다. `Chatbot.status` 변경은 여전히 복원이 하지 않으며, 공개 전환은 별도 동작(`ChatbotPublicationService`)이다.

1. **봉인 문구 개정**: "복원은 관리자 요청 핸들러 1곳"을 다음으로 바꾼다 — **대화 자산을 쓰는 유일 경로(`VersionRestoreApplier`)는 `VersionRestoreService.restore()` 안에서만 호출되며, `restore()`의 호출부는 ① 관리자 요청 핸들러 ② 관리자가 미리보기로 확인하고 해시에 묶어 생성한 예약의 실행기 2곳뿐이다.** 구조 보장: `VersionsModule`은 `VersionRestoreService`·`VersionDiffService`만 export하고 **applier는 export하지 않는다**(주입 불가) · `restore(` 호출 파일 정확히 2개(`deploy-schedule-sealing.spec.ts`) · `version-sealing.spec.ts` V-1~V-3(applier 1파일) 불변.
2. **§6 BUSY 매핑 변경**: 복원 트랜잭션의 `P2034`·`SQLITE_BUSY` 계열은 **`409 RESTORE_BUSY`**(재시도 가능)로 매핑하고, **`RESTORE_PREVIEW_STALE`은 해시 불일치 전용**이 된다. BUSY 후 재시도는 트랜잭션 안 해시 재확인이 실제 변경을 다시 판정하므로 항상 안전하다. 즉시 복원의 정상 경로 응답은 불변이며, 경합 시에만 코드가 세분화된다(프런트 분기 1줄 — 같은 UX). Postgres 전환 시 `Serializable` 직렬화 실패도 `RESTORE_BUSY`다.
3. **`restore()` 선택 4번째 인자 `ScheduledInvocation { actor, auditSummaryPrefix, triggerContext? }`** — 있으면 `RESTORE` 감사의 주체를 예약자(`actorOverride`)로, summary에 `[예약 실행 #…]` 접두를, `BEFORE_RESTORE` 백업의 `createdBy*`를 예약자로, 백업 `triggerContext.deployScheduleId`를 기록한다(임대 만료 후 "이 예약이 복원을 커밋했는가"의 판정 근거). 없으면 기존과 바이트 단위로 동일하다.
4. **보존 정책 보호 집합 확장**: 활성(`PENDING`/`HELD`/`RUNNING`) 예약이 참조하는 버전은 정리에서 제외하고, 수동 삭제는 `409 VERSION_REFERENCED_BY_SCHEDULE`이다. 알고리즘은 불변이며 순수 함수 입력(보호 id 집합)만 늘어난다. 판정은 정리·삭제 트랜잭션 안에서 한다(예약 생성과의 경합 방어).
5. **재검토 트리거 추가**: No.40 착수 시 예약 엔진에 "포인터 전환" 동작을 추가하는 것이 이 ADR §8 경계와 No.40의 접점이다(ADR-0032 재검토 트리거).
````

### B-2. `docs/02-spec/decisions/ADR-0025-augmentation-output-and-suggestion-asset-separation.md` — 봉인 문구 개정(복원 호출부에 예약 실행기 추가)

**찾을 원문**
````text
증강분만 골라낼 표시가 없기 때문이다.
````
**바꿀 내용**
````text
증강분만 골라낼 표시가 없기 때문이다.


---

## 갱신 (2026-09-23 — 봉인 문구 개정: 복원 호출부에 "관리자가 승인한 예약의 실행기" 추가)

운영 예약 배포(No.28, **ADR-0032 §6**)에 따라 위 갱신(2026-09-23)의 문장 "복원은 **관리자의 명시적 요청 핸들러 1곳**에서만 실행된다. 스케줄러·Job·콜백 경로가 없다."를 **다음으로 대체**한다.

> 복원(대화 자산을 쓰는 `version-restore.applier.ts`)은 `VersionRestoreService.restore()` 안에서만 호출되며, `restore()`의 호출부는 **① 관리자 요청 핸들러(`POST …/versions/:versionId/restore`, `dialogue:write` + `chatbot:write`) ② 관리자가 미리보기로 확인하고 해시에 묶어 생성한 예약의 실행기(`deploy-schedules/executors/restore-version.executor.ts`)** 2곳뿐이다. 그 밖의 스케줄러·Job·콜백 경로는 없다.

**이 개정이 §본뜻("승인 없는 자산 변경 금지")을 약화하지 않는 이유**
- 예약 복원은 **관리자의 명시적 승인**이다 — 생성 시 복원 미리보기(차이·blockers·warnings)를 확인하고, 그 기준 상태를 **해시로 묶는다**. 실행 시 상태가 달라졌으면 **실행하지 않는다**(엄격 바인딩).
- 실행 직전 **예약자의 계정 상태와 권한을 재검증**한다(`dialogue:write` + `chatbot:write`) — 권한을 잃은 사람의 승인은 실행되지 않는다. 감사 주체도 예약자다.
- 반영 내용은 여전히 **과거에 실제로 존재한 자산 상태**다 — 스냅샷 본문을 만드는 경로는 실제 DB 자산의 캡처뿐이고 내보내기·가져오기가 없다. 제안(`AugmentationSuggestion`)이나 외부 문장이 승인 없이 예문이 되는 경로가 아니다.
- **L1~L4 봉인은 전부 불변**이다: 예약 모듈은 `IntentsModule`·`KeywordsModule`·`AugmentationModule`을 import하지 않고(L1), 자산 테이블 쓰기 호출이 0건이며(L2 — **`asset-write-sealing.spec.ts` S-1 허용 파일은 3개 그대로**), `applyLearningExample()`을 호출하지 않는다(L3 — S-2 불변). 개발명세서 §5의 "스케줄러·백그라운드 작업·Job 완료 콜백이 자산을 **직접** 쓰는 코드 0건"도 그대로 참이다 — 예약 실행기는 applier가 아니라 `restore()`를 호출한다.
- 구조 보장은 약속이 아니라 **주입 불가**다: `VersionsModule`이 applier를 export하지 않는다. `restore(` 호출 파일이 정확히 2개임을 `deploy-schedule-sealing.spec.ts`가 단언한다.
````

### B-3. `docs/02-spec/decisions/ADR-0016-audit-log-backfill-scope.md` — `DeploySchedule` 대상 · 예약 실행 주체 = 예약자

**찾을 원문**
````text
항목별 변경 이력 화면은 1차 범위 밖이고 만들더라도 **스냅샷 차이**로 구현한다.
````
**바꿀 내용**
````text
항목별 변경 이력 화면은 1차 범위 밖이고 만들더라도 **스냅샷 차이**로 구현한다.


---

## 갱신 (2026-09-23 — `DeploySchedule` 대상 · 예약 실행의 주체 = 예약자(`actorOverride`))

운영 예약 배포(No.28, ADR-0032)가 다음을 추가한다. **감사로그의 결정(append-only · 커밋 후 기록 · 화이트리스트 부분 스냅샷 · ALS actor 전달 · `RequestContextService.get()` 호출 지점 1곳)은 전부 불변**이다.

1. **`AuditTargetType`에 `DeploySchedule`(라벨 `'배포 예약'`, 14 → 15종)** — 예약 생성 `CREATE` · 시각/메모 수정 `UPDATE` · 취소(`summary: "예약 취소"`)·보류 해제(`"보류 해제"`) `STATUS_CHANGE`. `AUDIT_FIELDS.DeploySchedule = ['action','status','scheduledAt','targetVersionNo','memo']`. **`AuditAction`은 추가하지 않는다.**
2. **예약 실행은 기존 액션으로 기록한다** — 복원 `RESTORE`(요약 액션 그대로) · 공개 `STATUS_CHANGE` · 채널 `UPDATE｜CREATE`. summary에 `[예약 실행 #<id 앞 8자>]` 접두를 붙인다.
3. **주체 = 예약자.** 예약 실행은 요청 밖(타이머)이라 ALS에 actor가 없다 — 그대로 두면 `actorEmail: 'system'`이 되어 **누가 반영했는지가 사라진다**. 실행 직전 재검증을 통과한 예약자를 `actorOverride`로 넘긴다. `actorOverride`의 용도는 "인증되지 않은 주체를 기록해야 하는 auth 경로"에서 **"요청 컨텍스트가 없는 경로의 명시 주체 전달(auth · 예약 실행기)"** 로 넓어진다. ALS를 읽는 곳은 여전히 `AuditLogService` 1곳이며, 예약 실행기는 ALS를 흉내 내지 않고 **인자로** 주체를 넘긴다. `ip`/`userAgent`는 `null`이다.
4. **기록하지 않는 것**: 예약의 NOOP(이미 그 상태) · FAILED · MISSED · HELD 전이 · 임대 만료 회수 판정 · "확인 필요" 해제 — 쓰기가 없거나 시스템 동작이다(자동 스냅샷·보존 정리 비감사와 같은 판단). 결과는 예약 행과 서버 경고 로그에 남는다. 규제 고객이 "실행되지 않은 사실"의 감사를 요구하면 No.45에서 재검토한다.
5. **커밋 직후~감사 기록 전 크래시 시 누락 가능성**은 §4의 "커밋 후 별도 쓰기"가 원래 갖는 성질이며 예약 실행도 같다 — 임대 회수가 감사를 사후 보정하지 않는다(공개 전환은 "우리가 썼는가"를 증명할 수단이 없어 보정하면 잘못된 주체를 남길 수 있다).
````

### B-4. `docs/02-spec/decisions/ADR-0015-role-permission-model.md` — 예약 = 즉시 실행과 같은 권한 + 실행 시 재검증

**찾을 원문**
````text
조직 통제상 승인이 필요해지면(No.36/45) `chatbot:restore` 신설 또는 2인 승인을 재검토한다.
````
**바꿀 내용**
````text
조직 통제상 승인이 필요해지면(No.36/45) `chatbot:restore` 신설 또는 2인 승인을 재검토한다.


---

## 갱신 (2026-09-23 — 예약 = 즉시 실행과 같은 권한 + 실행 시 재검증, 신규 권한 0종)

운영 예약 배포(No.28, ADR-0032 §5)는 **신규 권한을 만들지 않는다**(PM 확정 P-9). `Permission` 유니온 15종 · `ROLE_PERMISSIONS` · 공개 경로 6곳 · fail-closed 판정 순서는 전부 불변이다.

- **예약의 생성·수정·취소·재개·확인 권한 = 그 동작을 즉시 실행할 때의 권한**: 복원 = `dialogue:write` + `chatbot:write` · 공개 = `chatbot:write`(+ WEB 채널 동시 활성화 시 `channel:write`) · 채널 열기/닫기 = `channel:write` · 실행 직전 TC 옵션 지정 시 + `simulation:write`. 동작 → 권한 매핑은 **순수 함수 1개**이며 생성 시 판정과 실행 시 재검증이 같은 함수를 쓴다(두 집합이 어긋날 수 없다).
- **가드가 아니라 서비스가 판정한다** — 동작이 요청 본문(생성) 또는 저장된 행(수정·취소·재개)에 있어 데코레이터로 표현할 수 없다. 핸들러는 `@RequirePermission('chatbot:read')` 기준선을 유지하고(fail-closed), 서비스는 ① 관리 권한(`chatbot:write` ∨ `channel:write`)이 전혀 없으면 **행 조회 전** `403`(권한 판정 → 존재 판정 순서 유지) ② 행을 읽은 뒤 동작별 권한 전부를 확인해 부족하면 `PERMISSION_DENIED` 이력(가드와 같은 요약 형식·60초 합치기) + `403`. 응답 본문에 요구 권한을 담지 않는다.
- **실행 직전 재검증**: 예약자 사용자 행이 존재하고 `status=ACTIVE`이며 **현재 역할**이 권한을 전부 보유해야 실행한다. 아니면 `FAILED(CREATOR_NOT_AUTHORIZED)` — 권한 강등·계정 비활성 후 과거 예약이 실행되지 않는다(**예약은 권한 우회 수단이 아니다**). `mustChangePassword`는 권한 박탈이 아니므로 보지 않는다.
- 취소는 예약자가 아니어도 같은 권한 보유자면 할 수 있다(휴가·퇴사 대응). 재개해도 예약자는 바뀌지 않는다 — 자기 명의 실행을 원하면 새 예약을 만든다.
````

### B-5. `docs/02-spec/decisions/ADR-0027-intent-classifier-and-training-job.md` — 예약 실행 엔진은 임대 기반 정리

**찾을 원문**
````text
큐·`TrainingJobService`는 **변경 0건**이다.
````
**바꿀 내용**
````text
큐·`TrainingJobService`는 **변경 0건**이다.


---

## 갱신 (2026-09-23 — 예약 실행 엔진은 임대(lease) 기반 정리를 쓴다 · 진행 중 작업은 예약 복원의 일시적 원인)

운영 예약 배포(No.28, ADR-0032)가 두 번째 백그라운드 실행 주체(인프로세스 폴링 엔진)를 도입한다. **이 ADR의 결정(단일 인스턴스 in-process 큐 · Redis/BullMQ 미도입 · 기동 시 고아 Job 정리 `SERVER_RESTART`)은 불변**이며, 다음을 기록한다.

1. **예약 엔진은 "기동 시 잔존 = 전부 고아" 가정을 반복하지 않는다.** 선점 시각(`claimedAt`) + 임대(기본 5분)를 넘긴 `RUNNING`만 회수하고, 재실행이 아니라 **실제 상태로 판정**한다. 다른 인스턴스가 정상 실행 중일 수 있기 때문이다.
2. **재검토 트리거 보강**: "다중 인스턴스 전환" 시 `TrainingJob`·`TestRun`의 기동 시 고아 정리도 **같은 임대 방식**(선점 시각 컬럼 + 만료 판정)으로 교체한다 — 현재 방식은 다른 인스턴스의 실행 중 작업을 `SERVER_RESTART`로 잘못 종결한다. 교체 지점은 각 서비스의 `onModuleInit` 1곳씩이며, 판정 순수 함수는 `common/polling/lease.ts`를 재사용할 수 있다.
3. **진행 중 작업과 예약 복원**: 예약 복원 시각에 이 챗봇의 `TrainingJob`/`TestRun`이 `QUEUED`/`RUNNING`이면 `restore()`가 `409 RESTORE_BLOCKED_BY_ACTIVE_JOB`을 반환하고, 예약 엔진은 이를 **일시적 원인**으로 분류해 폴링 주기마다 최대 15분 재시도한다(초과 시 `FAILED(BLOCKED_TOO_LONG)`). 큐·`TrainingJobService`·`TestRunService`는 **변경 0건**이다(예약 엔진은 큐를 쓰지 않는다 — 시각 트리거이지 작업 큐가 아니다).
4. **자동 재학습 스케줄 기각(§대안)은 불변**이다 — 스케줄러 인프라가 생겼어도 "관리자가 인지하지 못한 채 추천 품질이 바뀐다"는 기각 사유는 그대로다. 예약 엔진은 관리자가 미리보기로 승인한 반영 동작만 실행한다.
````

### B-6. `docs/02-spec/decisions/ADR-0002-permanent-delete-referential-integrity.md` — `DeploySchedule` 동반 삭제

**찾을 원문**
````text
(EDITOR 이상)로 둔다.
````
**바꿀 내용**
````text
(EDITOR 이상)로 둔다.


---

## 갱신 (2026-09-23 — No.28 `DeploySchedule` 동반 삭제)

운영 예약 배포(No.28, ADR-0032)의 **`DeploySchedule`은 "하위 데이터 제거" 분류**로 영구삭제 트랜잭션에서 **동반 삭제**된다(13 → 14테이블, `tx.chatbot.delete` 직전 `deleteMany` 1건). 사전 검사(409) 대상이 아니다 — 예약이 영구삭제를 막으면 보관 챗봇을 영원히 지울 수 없다. **이 ADR의 결정(cascade 금지 · 2단계 삭제 · 사전 검사 409 · `confirmName` 재검증)은 불변**이다.

- 예약의 `targetVersionId` 등 참조 컬럼에는 **FK를 걸지 않는다** — `Restrict`면 종단 예약이 참조하는 버전이 보존 정리로 영원히 지워지지 않는다. 대신 **활성 예약이 참조하는 버전의 수동 삭제는 서비스 계층에서 `409 VERSION_REFERENCED_BY_SCHEDULE`** 로 거부한다(이 ADR의 "사전 검사는 UX, 최종 방어선은 트랜잭션 안 재확인" 원칙 그대로).
- `ARCHIVED` 챗봇의 남은 예약은 실행 시 `FAILED(CHATBOT_ARCHIVED)`가 되며, 보관 중에도 **취소·조회는 허용**한다.
````

### B-7. `docs/02-spec/decisions/ADR-0011-channel-implementation-tier-and-public-surface.md` — 공개 전환 원자 경로 `ChatbotPublicationService`

**찾을 원문**
````text
+ 자격증명 저장 방식 ADR 신규 작성.
````
**바꿀 내용**
````text
+ 자격증명 저장 방식 ADR 신규 작성.


---

## 갱신 (2026-09-23 — 공개 전환 원자 경로 `ChatbotPublicationService` · 채널 활성화 규칙의 순수 함수 추출)

운영 예약 배포(No.28, ADR-0032)가 **"공개 = 상태 `ACTIVE` AND WEB 채널 `enabled`"**(§4 공개 접근 조건)를 지정 시각에 전환한다. 이 ADR의 결정(구현 등급 · WEB만 활성화 가능 · 공개 API 403/404 · Origin 인가 · 자격증명 미저장)은 **불변**이다.

1. **`channels/publication.service.ts`(`ChatbotPublicationService`) 신설** — `publish(chatbotId, { enableWebChannel })`은 `DRAFT → ACTIVE`와 WEB 채널 활성화를 **한 쓰기 트랜잭션**으로 처리하고(둘 다 적용되거나 둘 다 적용되지 않는다), `setWebChannel(chatbotId, enabled)`은 WEB 채널만 전환한다. 감사는 커밋 후 기존 형식(`STATUS_CHANGE` "상태 변경: …" · `Channel UPDATE｜CREATE` "사용 여부 변경: …") 그대로이며 예약 실행 주체를 `actorOverride`로 받는다. 이미 목표 상태면 쓰기·감사 0건(NOOP).
2. **판정 규칙은 복제하지 않는다** — 상태 전이는 `evaluateStatusTransition()`을, `IMPLEMENTED` 채널만 활성화 가능 규칙은 `ChannelsService.upsert()`에서 **`channels/lib/channel-enable-rule.ts` 순수 함수로 이동**해 두 경로가 같은 함수를 호출한다(`upsert()` 동작 불변). 채널 행이 없을 때는 기존 `defaultChannelConfig()`로 생성한다.
3. **관리자 즉시 경로(`PATCH …/status`, `PATCH …/channels/:type`)는 무변경**이다 — 트랜잭션 인자를 추가하지 않는다(두 메서드 모두 쓰기 직후 감사를 기록하므로 tx 인자를 받으면 "감사를 미룰지" 분기가 생긴다).
4. `PublicAccessService`는 여전히 캐시하지 않으므로 전환은 **다음 공개 요청부터 즉시** 반영된다(무효화 호출 불필요).
5. **후속 Phase 인계 보강**: 외부 채널을 실제로 붙일 때 예약 동작 `SET_WEB_CHANNEL`은 `SET_CHANNEL(type)`으로 **새 동작 유형을 추가**해 일반화한다(기존 동작은 호환 유지 — ADR-0032 §1 레지스트리).
````

---

## C. `docs/01-requirements/기능요구사항.md`

### C-1. §3 No.28 행 — 설계 완료 반영

**찾을 원문**
````text
| 28 | 운영관리 | 운영 예약 배포 | 학습 완료된 챗봇을 지정 시각에 자동 반영 예약 | 1 | 스케줄 트리거 | ○ | ○ | - |
````
**바꿀 내용**
````text
| 28 | 운영관리 | 운영 예약 배포 | 지정 시각에 **버전 스냅샷 예약 복원(No.25 경로) · 공개 시작(DRAFT→ACTIVE, 선택: WEB 채널 동시 활성화) · WEB 채널 열기/닫기**를 1회 실행(미리보기 해시 바인딩 · misfire 유예 · 선행 실패 시 후속 보류 · 다중 인스턴스 중복 실행 방지) | 1 | 스케줄 트리거(인프로세스 폴링 + DB 선점 — 새 모델·추론 0건). 복원 후 재색인은 No.25와 동일하게 ml-worker(No.18) 위임 | ○ | ○ | **설계 완료(2026-09-23, `docs/02-spec/scheduled-deploy-설계.md` · ADR-0032).** 원문 "학습 완료된 챗봇을 지정 시각에 자동 반영 예약"을 이미 검증된 반영 동작의 시각 예약으로 구현. **운영에 보이지 않는 준비 편집(draft/published)·환경 승격은 No.40** — 원본 ROCHA의 "학습본 → 운영 교체"를 완전히 충족하려면 No.40 선행 필요 |
````

### C-2. §4-1 No.40 행 비고 — No.28 접점 추가

**찾을 원문**
````text
착수 시 No.25의 캡처·무결성 검사를 **ID 재매핑 적재**와 결합해 재사용할 수 있다 |
````
**바꿀 내용**
````text
착수 시 No.25의 캡처·무결성 검사를 **ID 재매핑 적재**와 결합해 재사용할 수 있다. **No.28(운영 예약 배포)은 시각 트리거만 제공**한다 — 착수 시 "published = 특정 `ChatbotVersion` 포인터" 형태면 No.28 엔진에 **"포인터 전환" 동작 유형 1개**를 추가해 결합한다(ADR-0032) |
````
