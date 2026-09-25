# No.40 환경 분리 / 버전 관리 — 기존 문서 패치 목록

> 작성: system-architect · 2026-09-25 · 근거: `docs/02-spec/environment-separation-설계.md`, `docs/02-spec/decisions/ADR-0039-environment-pointers-version-serving-and-content-addressed-vector-retention.md`
> **적용 상태**: ✅ **적용 완료(2026-09-25, 94건)** — 오케스트레이터 세션이 항목마다 "찾을 원문 정확히 1회"를 확인한 뒤 기계적으로 적용한다.
> **적용 방법**: 각 항목의 "찾을 원문"을 대상 파일에서 **정확히 1회** 찾아 "바꿀 내용"으로 교체한다. 모든 원문은 2026-09-25 시점 파일(No.44 피드백 루프 패치 적용 후)에서 복사했고, 문자열 검색(Grep `-o`/count)으로 대상 파일 안 유일성을 확인했다. "바꿀 내용"이 원문을 그대로 포함하는 항목은 append다(취소선 표기 항목은 원문을 `~~…~~`로 감싸 보존한다).
> **줄바꿈 주의**: 대상 파일은 CRLF일 수 있다. 모든 "찾을 원문"은 **한 줄 안의 부분 문자열**(줄바꿈 미포함)로 잡았다. "바꿀 내용"의 줄바꿈은 대상 파일의 줄바꿈으로 정규화한다.
> **순서 독립**: 어떤 "바꿀 내용"도 다른 항목의 "찾을 원문"을 새로 만들지 않는다. 같은 줄에 앵커가 둘인 항목(개발명세서 §3 `ChatbotVersion` 행의 A-8·A-9 · §4.1 권한 줄의 A-27·A-28)은 서로 겹치지 않는 부분 문자열이다.
> 코드 변경은 이 파일의 범위가 아니다 — 설계서 §2.5 체크리스트와 §24.2(의도된 시험 기대값 변경 닫힌 목록)를 따른다.
> 항목 수: 개발명세서 52 · ADR 12 + 예약 배포 설계서 2 = 14 · 기능요구사항 6 · 환경 분리 요구사항(PM 결정 기록 + 설계 반영) 17 · 선행 요구사항 인계 정정 5 = **94건**

---

## A. `docs/02-spec/개발명세서.md`

### A-1. [개발명세서 `docs/02-spec/개발명세서.md`] §2 워크스페이스 상태 표 — `environment` 행 추가

**찾을 원문**
````text
widget 변경(평가 버튼 — vanilla 유지)**(ADR-0038) |
````
**바꿀 내용**
````text
widget 변경(평가 버튼 — vanilla 유지)**(ADR-0038) |
| **`apps/api/src/environment`**(+ `core/`·`serving/`) · `apps/api/src/embedding/text-vector` | **환경 분리/버전관리 Phase에 신설**(No.40) — 한 챗봇 안의 **초안(기존 편집 테이블) → 스테이징 → 운영** 환경 포인터(운영 = `Chatbot.prodVersionId` · 스테이징·게이트 = 1:1 `ChatbotEnvironment` · 이력 = append-only `EnvironmentSwitchLog`) · ★포인터 쓰기 유일 파일 `environment-pointer.writer.ts`(미export · CAS 갱신) · 운영 전환·롤백·게이트(`core` — 예약 실행기 재사용, export 2개) · 버전 번들 서빙(`serving` — 불변 코어 + 합성 캐시, export 1개) + 문장 해시 주소 벡터 보존 저장소(`EmbeddingTextVector` — 슬롯 색인·색인기 무변경). **`packages/dialogue-engine`·ml-worker·widget 변경 0건 · `@Public()` 8 유지 · 권한 17 → 18(`chatbot:deploy`) · 선택 환경변수 2개 · 스냅샷 스키마 버전 1 유지(해시 밖 보조 필드)**(ADR-0039) |
````

### A-2. [개발명세서 `docs/02-spec/개발명세서.md`] §2.2 기능그룹별 모듈 배치 표 — No.40 행 추가

**찾을 원문**
````text
**설계 완료 → `feedback-loop-설계.md`** |
````
**바꿀 내용**
````text
**설계 완료 → `feedback-loop-설계.md`** |
| **환경 분리/버전관리 (No.40)** | **`environment`(신규 — 켜기/끄기·스테이징 승격·전환 이력·게이트 설정, 11 핸들러) + `environment/core`(신규 — ★포인터·환경 행·이력 쓰기 유일 파일 `EnvironmentPointerWriter`(미export) · `ProdSwitchService`(즉시·예약 공용 CAS 전환·롤백) · 순수 함수 `evaluateProdSwitchGate`·`isSwitchTargetAllowed`·`pickRollbackTarget`, export 2개) + `environment/serving`(신규 — `VersionBundleService`: 스냅샷 역직렬화 `hydrateForServing`(해시 밖 보조 필드 · 생성순 재정렬) + 현재 설문·토픽 합성, export 1개)** + `versions`(봉투 보조 필드 `tiebreak`·메타 `tiebreakHash` · 트리거 `ENV_INIT`/`PROMOTE` · 보존 보호·삭제 409 · 복원 경고 `ENV_DRAFT_ONLY` · `VersionReadModule` 분리) · `embedding`(보존 저장소 `EmbeddingTextVectorService` · `VersionVectorResolver` · `score()` 선택 소스 인자 — 색인기 무변경) · `conversation`(소스 선택 1곳 `loadServing()` · `getConfig` 표시 설정 출처 · `record()`의 `servedVersionId`) · `rag`(보류 턴 전달) · `simulation`·`validation`(대상 선택 — 초안 기본) · `handoff`(힌트 = 운영 버전) · `learning`(운영 미반영 표시 · 초안에서 삭제됨) · `dialogue-common`(합성 캐시·`loadLiveOverlay`) · `deploy-schedules`(`SWITCH_PROD_VERSION` 실행기 1파일 · 모드 변경 훅) · `chatbots`(`assertReadable/Writable` 반환 `prodVersionId` · 동반 삭제 +3) · `audit-logs`(`ChatbotEnvironment`) | **설계 완료 → `environment-separation-설계.md`** |
````

### A-3. [개발명세서 `docs/02-spec/개발명세서.md`] §2.2 주석 블록 — 엔진 불가침·모듈 의존 방향(No.40) 추가

**찾을 원문**
````text
답변 대상 판정 `classifyFeedbackTarget()`은 `shared-types`의 순수 함수 1벌이다.
````
**바꿀 내용**
````text
답변 대상 판정 `classifyFeedbackTarget()`은 `shared-types`의 순수 함수 1벌이다.
>
> **엔진 불가침(환경 분리 No.40)**: 이 그룹은 `packages/dialogue-engine`을 **한 줄도 바꾸지 않는다**(FR-0-149). 운영 버전 서빙의 동점 일치는 엔진 규칙이 아니라 **입력**으로 푼다 — 스냅샷 해시 밖 보조 필드로 노드 `updatedAt`을 되살리고 번들 배열을 라이브와 같은 `(createdAt, id)` 순으로 재정렬한다. 번들·봉투 스키마 불변 · 엔진 패키지에 `environment`·`prodVersion`·`servedVersion`·`tiebreak` 심볼 0건을 정적 검사가 단언한다(ADR-0039 §3).
>
> **모듈 의존 방향(No.40)**: `environment → environment/core · environment/serving · version-capture · versions/read · deploy-schedules(EnvironmentScheduleHooks) · embedding · chatbots · audit-logs` · `deploy-schedules → environment/core` · `conversation｜simulation｜validation｜handoff｜learning → environment/serving` 단방향이다. **`environment/core`는 `deploy-schedules`를, `environment/serving`은 `environment/core`를 import하지 않는다.** 포인터 쓰기 파일은 core 안에서 export되지 않고 서빙 모듈은 `VersionBundleService` 1개만 export하므로 공개 대화·시뮬레이터·TC·상담·학습의 DI 그래프에 **포인터 쓰기 경로가 없다**. 예약 실행기는 포인터를 직접 쓰지 않고 전환 서비스를 호출한다(예약 모듈 쓰기 대상 = `deploySchedule` 봉인 유지). `versions`·`embedding`은 `environment/**`를 import하지 않는다(보호 집합·배지는 Prisma 읽기 + 순수 함수).
````

### A-4. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `Chatbot` 행에 운영 포인터

**찾을 원문**
````text
기존 보관 챗봇은 `updatedAt` 근사 백필) | 1, 3, 4, 29 |
````
**바꿀 내용**
````text
기존 보관 챗봇은 `updatedAt` 근사 백필) **[No.40] `prodVersionId`**(운영 포인터 — 값 있음 = 환경 모드 켜짐, 공개 대화·상담 힌트가 이 `ChatbotVersion`을 서빙 · null = 현행 라이브 서빙. FK 없음 · 쓰기 주체 `environment-pointer.writer.ts` 1파일 · CAS 갱신 · `access.resolve()`가 읽는 행이라 공개 경로 추가 조회 0 · 전환 시 `updatedAt` 갱신 수용 · DTO 미노출 · 복사·분리 비복사 — ADR-0039 §2) | 1, 3, 4, 29, 40 |
````

### A-5. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `ConversationLog` 행에 `servedVersionId`

**찾을 원문**
````text
— ADR-0038 §1** | 14, 15, 22, 24, 27, 29, 30, 44 |
````
**바꿀 내용**
````text
— ADR-0038 §1** **[No.40] `servedVersionId`는 턴 처리 시점의 운영 포인터(모드 켜짐 — 엔진·BLOCK·상담 턴 공통, 모드 꺼짐 = null)다 — 2차 비율 분할의 세션 귀속 근거이며 1차는 적재만 한다. `record()` 1곳 · 적재 후 불변 · FK·인덱스 없음 · 백필 없음(ADR-0039 §8)** | 14, 15, 22, 24, 27, 29, 30, 40, 44 |
````

### A-6. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `EmbeddingVector` 행 무변경 명시

**찾을 원문**
````text
`ownerId`에 FK를 걸지 않는다(`chatbotId`에만 FK)** | 18 |
````
**바꿀 내용**
````text
`ownerId`에 FK를 걸지 않는다(`chatbotId`에만 FK)** **[No.40] 이 테이블(슬롯 색인)과 색인기는 환경 분리에서 바꾸지 않는다 — 운영·스테이징 버전 문장의 벡터는 별도 `EmbeddingTextVector`(문장 해시 주소)가 보존한다(ADR-0039 §4)** | 18, 40 |
````

### A-7. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `TestRun` 행에 실행 대상 차원

**찾을 원문**
````text
초과분은 새 실행 완료 직후 정리한다(스케줄러 부재) | **19, 20** |
````
**바꿀 내용**
````text
초과분은 새 실행 완료 직후 정리한다(스케줄러 부재) **[No.40] 실행 대상 차원 `targetKind`(`DRAFT` 기본·`STAGING`·`PROD`·`VERSION`)·`targetVersionId`/`No`(시작 시 포인터 해석·저장, FK 없음) — 운영 전환 게이트의 입력(대상 버전을 대상으로 한 최근 성공 실행). 초안 실행의 응답·지문 바이트 불변(ADR-0039 §5)** | **19, 20**, 40 |
````

### A-8. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `ChatbotVersion` 행의 라벨 주석

**찾을 원문**
````text
No.40 태그가 아니다**)
````
**바꿀 내용**
````text
No.40 태그가 아니다** — [No.40] 환경 배지(운영·스테이징·운영 이력)는 라벨이 아니라 포인터·전환 이력에서 파생한다)
````

### A-9. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `ChatbotVersion` 행 끝(보조 필드·트리거·보호)

**찾을 원문**
````text
복원 직전 백업과 **같은 트랜잭션**이다 | 25 |
````
**바꿀 내용**
````text
복원 직전 백업과 **같은 트랜잭션**이다 **[No.40] 트리거 +2(`ENV_INIT` 환경 분리 시작 · `PROMOTE` 스테이징 승격) · 메타 `tiebreakHash`(본문 최상위 **해시 밖** 보조 필드 `tiebreak.nodeUpdatedAt`의 sha256 — `contentHash` 규칙 불변, 환경 캡처 재사용 조건) · 운영·스테이징 포인터 버전과 운영 이력 최근 N(기본 5)은 보존 정리 제외 + 삭제 `409 VERSION_REFERENCED_BY_ENVIRONMENT` · 운영 서빙은 이 본문을 역직렬화한다(ADR-0039 §1·§3)** | 25, 40 |
````

### A-10. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `DeploySchedule` 행에 전환 동작

**찾을 원문**
````text
결과 테이블을 나누지 않는다 | 28 |
````
**바꿀 내용**
````text
결과 테이블을 나누지 않는다. **[No.40] 동작 `SWITCH_PROD_VERSION`(params `{ targetVersionId, expectedProdVersionId }` · `targetVersionId`/`No` 비정규화 재사용 — 스키마 변경 0) · 보류 사유 `ENV_MODE_CHANGED`(모드 켜기 시 활성 복원 예약) · 실패 사유 `GATE_NOT_PASSED` · 전제 조건 사유 `SWITCH_BLOCKED`(ADR-0039 §5·§7)** | 28, 40 |
````

### A-11. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — 신규 3엔터티 행 추가

**찾을 원문**
````text
무기한 보존(No.45) | 44 |
````
**바꿀 내용**
````text
무기한 보존(No.45) | 44 |
| **`ChatbotEnvironment`** | **챗봇별 환경 설정(1:1, PK=`chatbotId`, No.40 — ADR-0039 §2).** 스테이징 포인터 `stagingVersionId`(FK 없음) · 켜짐 메타 `enabledAt`/`enabledById`/`enabledByEmail` · 운영 전환 게이트 `gateMode`(`WARN` 기본｜`BLOCK`)·`gateTestSetId`(FK 없음)·`gateMinPassRate`(%, 기본 95)·`gateValidHours`(기본 24). **모드 켜짐 판정은 `Chatbot.prodVersionId` 1곳**(불변식: 값 있음 ⇒ 이 행 존재 ∧ `enabledAt` 있음) · 행은 끌 때도 유지(게이트 설정 보존). 쓰기 주체 = `environment-pointer.writer.ts` 1파일 · 스냅샷·복사·토픽 분리 대상 아님 · 영구삭제 동반 삭제 | 40 |
| **`EnvironmentSwitchLog`** | **환경 포인터 전환 이력(append-only, No.40 — ADR-0039 §5).** `environment`(`STAGING`｜`PROD`) · `method`(`INIT`·`PROMOTE`·`IMMEDIATE`·`SCHEDULED`·`ROLLBACK`·`DISABLE`) · from/to 버전 id·번호 스냅샷 · **`toVersionCapturedAt`**(학습 큐 "운영 미반영" 판정 입력 — 조인 없음) · `deployScheduleId`(예약 실행 — 임대 만료 회수의 커밋 증거, FK 없음) · `disableMode` · 주체 스냅샷 · 사유 메모(≤200 — API 응답에만, 서버 로그 금지). **자산 본문·발화 컬럼 없음** · 포인터와 같은 트랜잭션에서 1행 · 삭제·갱신 코드 0건(영구삭제 동반 삭제만) · 롤백 대상·보존 보호 집합의 근거 | 40 |
| **`EmbeddingTextVector`** | **문장 해시 주소 벡터 보존 저장소(No.40 — ADR-0039 §4).** `(chatbotId, modelId, textHash)` 유일 · `dimension`·`vector`(`EmbeddingVector`와 같은 코덱) · **원문 텍스트 컬럼 없음**. 운영·스테이징·운영 이력·전환 예약 대상 버전의 질문 측 문장 벡터를 **슬롯 색인에서 복사**해 보존한다(추가 임베딩 0 — 경합·모델 교체 예외만 기존 Provider 경로). 버전 대상 점수 = 보존 ∪ 같은 `textHash`의 초안 벡터. **모드 꺼진 챗봇 = 0행** · 참조 버전 밖 행은 GC · 쓰기 주체 `embedding-text-vector.service.ts` 1파일 · 영구삭제 동반 삭제 | 40 |
````

### A-12. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 머리 — 15건 → 16건

**찾을 원문**
````text
> **미도입 결정 15건**
````
**바꿀 내용**
````text
> **미도입 결정 16건**
````

### A-13. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 ⑯ 신설 — 환경 분리 관련 미도입

**찾을 원문**
````text
스위치는 WEB 채널 설정의 선택 키로 대화 턴 추가 조회 0을 지킨다(**ADR-0038**).
````
**바꿀 내용**
````text
스위치는 WEB 채널 설정의 선택 키로 대화 턴 추가 조회 0을 지킨다(**ADR-0038**).
> ⑯ **환경별 자산 테이블 이중화(draft/published 컬럼·테이블)·환경 이름/사용자 정의 환경 테이블·트래픽 분할 규칙 테이블·승인 요청 테이블·버전 번들 영속 캐시 테이블·버전별 벡터 전량 복제 테이블·스테이징 미리보기 토큰 테이블** — 초안은 기존 테이블이고 스테이징·운영은 불변 스냅샷 포인터라 자산을 두 벌 두지 않는다. 3단 고정이라 환경 이름이 필요 없고, 분할·2인 승인·외부 미리보기는 2차/No.45 범위다. 번들 캐시는 본문이 불변이라 메모리 LRU로 충분하며, 버전 벡터는 문장 해시 주소 보존 저장소(`EmbeddingTextVector` — 초안과의 차집합만)로 해결한다(**ADR-0039**).
````

### A-14. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 ⑩ — No.40 도입 보론

**찾을 원문**
````text
환경·승격·트래픽 전환은 **No.40**
````
**바꿀 내용**
````text
환경·승격·트래픽 전환은 **No.40**(**[보론 2026-09-25] No.40은 환경/태그/승격 *테이블*을 만들지 않고 `Chatbot.prodVersionId` 포인터 + 1:1 `ChatbotEnvironment` + 전환 이력으로 도입했다 — ADR-0039**)
````

### A-15. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 ⑪ — draft/published 해소 보론

**찾을 원문**
````text
**운영에 보이지 않는 준비 편집(draft/published)은 No.40의 본체**다(**ADR-0032**).
````
**바꿀 내용**
````text
**운영에 보이지 않는 준비 편집(draft/published)은 No.40의 본체**다(**ADR-0032**). **[보론 2026-09-25] No.40이 자산 이중화 없이 버전 포인터로 해소했다(ADR-0039 §1)** — 예약 엔진은 동작 `SWITCH_PROD_VERSION` 1개만 더했다.
````

### A-16. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 참조 무결성 — FK 미설정 예외에 포인터 컬럼

**찾을 원문**
````text
대신 표시용 스냅샷(`targetName`/`actorEmail`/`actorRole`)을 함께 보관해 목록이 UUID 나열이 되지 않게 한다.
````
**바꿀 내용**
````text
대신 표시용 스냅샷(`targetName`/`actorEmail`/`actorRole`)을 함께 보관해 목록이 UUID 나열이 되지 않게 한다. **[No.40] `Chatbot.prodVersionId`·`ChatbotEnvironment.stagingVersionId`·`ConversationLog.servedVersionId`·`TestRun.targetVersionId`·`EnvironmentSwitchLog`의 버전 id·`deployScheduleId`도 FK를 걸지 않는다** — `Chatbot ↔ ChatbotVersion` 순환 FK는 영구삭제 순서와 `chatbots` 테이블 재정의를 부르며, 보호는 앱 레벨 `409 VERSION_REFERENCED_BY_ENVIRONMENT` + 보존 정리 보호 집합이다(ADR-0039 §2).
````

### A-17. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 파생 데이터 동반 삭제 — 3테이블 분류

**찾을 원문**
````text
이 분류를 바꾸려면 롤업 선적재 규약(ADR-0033 §3)을 먼저 구현해야 한다.
````
**바꿀 내용**
````text
이 분류를 바꾸려면 롤업 선적재 규약(ADR-0033 §3)을 먼저 구현해야 한다. **[No.40] `ChatbotEnvironment`·`EnvironmentSwitchLog`·`EmbeddingTextVector`는 동반 삭제 대상이다(16 → 19테이블)** — 버전·예약과 같은 "챗봇과 생사를 같이하는 운영·파생 데이터"이며 사전검사 목록(15종)은 불변이다(ADR-0002 갱신 각주, ADR-0039).
````

### A-18. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 인덱스 — No.40 인덱스 추가

**찾을 원문**
````text
앱에서 집계한다(ADR-0017 §4).
````
**바꿀 내용**
````text
앱에서 집계한다(ADR-0017 §4). **[No.40] `test_runs(chatbotId, targetVersionId)`(게이트의 대상 버전 최근 실행) · `environment_switch_logs(chatbotId, environment, createdAt)` · `embedding_text_vectors(chatbotId, modelId, textHash)` 유일. `conversation_logs.servedVersionId`에는 인덱스를 두지 않는다(1차 적재만 — 비율 분할 2차에서 재검토). 전부 `ADD COLUMN`/`CREATE`라 부분 유니크 4개에 영향이 없다(ADR-0039).**
````

### A-19. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 품질/시뮬레이션 행에 대상 선택

**찾을 원문**
````text
TC 실행에는 없다** | 10, 22, 26, 27 |
````
**바꿀 내용**
````text
TC 실행에는 없다** **[No.40] `simulate` 요청에 `target?`(`DRAFT` 기본｜`STAGING`｜`PROD`｜`VERSION` — 비초안은 운영 서빙과 같은 번들·설정·벡터, 오버레이와 함께 쓰면 `400`), 응답 `target?`(비초안일 때만). `compare`는 초안 고정(오버레이 비교 전용)** | 10, 22, 26, 27, 40 |
````

### A-20. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 검증/품질 행에 실행 대상

**찾을 원문**
````text
(쓰기·실행은 `409 CHATBOT_ARCHIVED`)** | **19, 20** |
````
**바꿀 내용**
````text
(쓰기·실행은 `409 CHATBOT_ARCHIVED`)** **[No.40] 실행 시작 요청 `target?`(시작 시 포인터를 해석해 저장) · 실행·지문 `target?`(비초안만) — 오버레이 모드는 초안만** | **19, 20**, 40 |
````

### A-21. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 버전 이력·복원 행에 환경 배지

**찾을 원문**
````text
**`@Public()` 추가 0건** | **25** |
````
**바꿀 내용**
````text
**`@Public()` 추가 0건** **[No.40] 목록·상세 `environmentBadges?`(모드 켜짐만) · 트리거 필터 그룹 `ENVIRONMENT` · 복원 미리보기 경고 `ENV_DRAFT_ONLY`(초안에만 적용) · 삭제 `409 VERSION_REFERENCED_BY_ENVIRONMENT`** | **25**, 40 |
````

### A-22. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 운영 예약 배포 행에 전환 동작

**찾을 원문**
````text
외부 cron용 내부 트리거 경로를 만들지 않는다 · `@Public()` 추가 0건** | 28 |
````
**바꿀 내용**
````text
외부 cron용 내부 트리거 경로를 만들지 않는다 · `@Public()` 추가 0건** **[No.40] 동작 `SWITCH_PROD_VERSION`(권한 `chatbot:deploy` · 바인딩 = 예약 시 운영 버전 · 게이트 실행 시 재평가) · 전제 조건 사유 `SWITCH_BLOCKED` · 보류 사유 `ENV_MODE_CHANGED` · 실패 사유 `GATE_NOT_PASSED` · 결과 요약 `SWITCH_PROD`** | 28, 40 |
````

### A-23. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 환경 분리 행 신설

**찾을 원문**
````text
영구삭제 사전검사 14종. 총 11개 핸들러 · **`@Public()` 추가 0건** | 22 |
````
**바꿀 내용**
````text
영구삭제 사전검사 14종. 총 11개 핸들러 · **`@Public()` 추가 0건** | 22 |
| **환경 분리/버전관리** | **`GET /chatbots/:chatbotId/environment`(현황 — 운영·스테이징·초안 동일 여부·게이트·의미 색인 준비 중), `POST …/environment/enable/preview`·`…/enable`·`…/disable/preview`·`…/disable`(켜기/끄기 — `chatbot:deploy`, 미리보기는 `chatbot:read`+`dialogue:read`), `POST …/environment/staging/promote`(`dialogue:write`+`chatbot:write`), `POST …/environment/prod/preview`(DB 변경 0)·`…/prod/switch`·`…/prod/rollback`(`chatbot:deploy` · 기대 운영 버전 CAS), `GET …/environment/history`(`chatbot:read`), `PUT …/environment/gate`(`chatbot:deploy`)**. 총 11개 핸들러 · **`@Public()` 추가 0건 · 공개 대화 요청·응답 스키마 불변**(모드 켜짐이면 서빙 버전·표시 설정 출처만 운영 버전) | 40 |
````

### A-24. [개발명세서 `docs/02-spec/개발명세서.md`] §4 정정 이력 — 2026-09-25d 항목 추가

**찾을 원문**
````text
④ 신규 `ApiErrorCode` 2종(`feedback-loop-설계.md` §16).
````
**바꿀 내용**
````text
④ 신규 `ApiErrorCode` 2종(`feedback-loop-설계.md` §16).
> **정정 이력(2026-09-25d — 환경 분리/버전관리)**: ① **환경 분리 행을 신설**했다 — 환경은 챗봇 스코프 자원(`/chatbots/:chatbotId/environment/*`)이며 요구사항 초안의 경로를 그대로 확정했다. ② 미리보기는 본문 입력 때문에 `POST`(DB 변경 0 — 복원 미리보기 선례). ③ 시뮬레이터·TC는 새 경로 없이 기존 요청에 `target?`을 더했고, 예약 전환은 기존 `/deploy-schedules`의 동작 유형으로 흡수했다(동작 추가 = 파일 1개 — ADR-0032). ④ 신규 `ApiErrorCode` 8종 · 공개 경로 8곳 불변(`environment-separation-설계.md` §19).
````

### A-25. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 오류 봉투 — No.40 오류 코드 8종

**찾을 원문**
````text
**대화 전송 경로는 이 2종을 쓰지 않는다** |
````
**바꿀 내용**
````text
**대화 전송 경로는 이 2종을 쓰지 않는다** **[No.40] 8종 추가** — `ENV_MODE_DISABLED`·`ENV_MODE_ALREADY_ENABLED`·`ENV_POINTER_STALE`(미리보기 이후 포인터·초안 변경)·`ENV_TARGET_NOT_STAGING`·`ENV_GATE_NOT_PASSED`·`ENV_SWITCH_BUSY`(재시도 가능)·`ENV_DRAFT_NOT_RESTORED`(끄기 "운영 유지" 전 복원 필요)·`VERSION_REFERENCED_BY_ENVIRONMENT`(전부 409). 공개 대화 경로는 이 코드를 쓰지 않는다(운영 버전 읽기 실패 = 폴백 턴) |
````

### A-26. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 챗봇 스코프 — 환경 동작의 `ARCHIVED` 규칙

**찾을 원문**
````text
보관 챗봇에 대한 공개 평가는 기존 공개 규약(`403 CHATBOT_NOT_PUBLISHED`)이다 |
````
**바꿀 내용**
````text
보관 챗봇에 대한 공개 평가는 기존 공개 규약(`403 CHATBOT_NOT_PUBLISHED`)이다. **[No.40] 환경 현황·이력·미리보기는 `ARCHIVED`에서도 허용**하고 켜기·끄기·승격·전환·롤백·게이트 설정은 `409 CHATBOT_ARCHIVED`다(포인터는 유지 — 복귀 후 재개). 교차 챗봇 버전을 포인터·대상으로 지정하면 `404`다 |
````

### A-27. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 권한 — `Permission` 17종 → 18종

**찾을 원문**
````text
유니온 **17종**(
````
**바꿀 내용**
````text
유니온 ~~**17종**~~ **18종**(**2026-09-25 환경 분리(No.40)에서 `chatbot:deploy` 1종 신설 — 17 → 18** · 
````

### A-28. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 권한 — No.40 권한 보론

**찾을 원문**
````text
공개 평가는 인증 대상이 아니라 결합 검증 보상 통제다 |
````
**바꿀 내용**
````text
공개 평가는 인증 대상이 아니라 결합 검증 보상 통제다. **[2026-09-25 No.40] 환경 분리는 신규 권한 `chatbot:deploy` 1종(ADMIN 전용)이다** — 운영 전환·롤백·전환 예약·모드 켜기/끄기·게이트 설정 = `chatbot:deploy` · 스테이징 승격 = `dialogue:write`+`chatbot:write`(편집자) · 현황·미리보기 = `chatbot:read`+`dialogue:read` · 이력 = `chatbot:read`. 역할 4종 불변 · 긴급 차단은 기존 채널 닫기(`channel:write`) |
````

### A-29. [개발명세서 `docs/02-spec/개발명세서.md`] §5 성능 — No.40 항목 추가

**찾을 원문**
````text
100만 행 DB 전체 마이그레이션 소요를 실측·기록한다(ADR-0038).
````
**바꿀 내용**
````text
100만 행 DB 전체 마이그레이션 소요를 실측·기록한다(ADR-0038).
  - **[신규 2026-09-25 — 환경 분리] 모드 꺼진 챗봇의 공개 대화 예산(P95 500ms)·응답 바이트·쿼리 수는 불변**이다(운영 포인터는 `access.resolve()`가 이미 읽는 행의 컬럼 · 초안 경로 코드 동일). 모드 켜진 챗봇 — 버전 번들 캐시 적중 시 초안 대비 **+5ms 이내**, 미스(본문 ≤ 2MB 파싱·해시 재검증·역직렬화·인덱스) **1.5초 이내**(전환 직후 현재 인스턴스 예열) · 운영 전환·롤백 트랜잭션 **100ms 이내**(포인터 1 + 이력 1 — 자산 규모 무관) · 켜기·승격은 캡처 비용 + 벡터 보존 복사 1초 이내 · 환경 현황 P95 1초. **모드 꺼진 챗봇의 재색인 시간·벡터 수·임베딩 호출 수 불변**(색인기 무변경 — ADR-0039).
````

### A-30. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 환경 분리 봉인 항목 추가

**찾을 원문**
````text
원장(텍스트 없음)의 보존기간도 무기한이다 — No.45.
````
**바꿀 내용**
````text
원장(텍스트 없음)의 보존기간도 무기한이다 — No.45.
  - **[신규 2026-09-25] 환경 분리의 봉인(ADR-0039)**: ① 공개 표면 추가 0 · 공개 요청에 대상·버전 입력 필드가 없어 **공개 요청으로 초안·스테이징 번들에 도달하는 경로 0** ② 포인터·환경 행·이력 쓰기 1파일(미export · CAS) · 전환·승격·롤백의 자산 테이블 쓰기 0 · `restore()` 호출부 2곳 유지 ③ 버전 본문은 불변 — 서빙은 `loadStrict()`(해시 재검증)로만 읽는다 ④ 교차 챗봇 버전 지정 = `404` · 예약 전환은 실행 직전 예약자 `chatbot:deploy` 재검증 ⑤ 전환 이력·감사·예약 결과에 자산 본문·발화 0 — 사유 메모는 API 응답에만(서버 로그 금지) ⑥ 보존 저장소에 문장 원문 0 ⑦ 위 전부를 `environment-sealing.spec.ts` **E-1~E-17**로 강제한다.
````

### A-31. [개발명세서 `docs/02-spec/개발명세서.md`] §5 접근성/UI 품질 — 환경 화면 원칙

**찾을 원문**
````text
직접 수정 완료가 불가한 항목은 비활성 + 사유 텍스트다.**
````
**바꿀 내용**
````text
직접 수정 완료가 불가한 항목은 비활성 + 사유 텍스트다.** **[No.40] 환경 배지(초안·스테이징·운영)는 텍스트 필수(색만으로 구분 금지) · 운영 전환·롤백·끄기 확인 창은 초점 가두기·`Esc` 취소·명시적 버튼 이름("v44로 운영 전환") · 결과는 `aria-live="polite"` 1회 · 게이트 미달 사유는 비활성 버튼의 `aria-describedby` · 시뮬레이터 대상 선택은 라벨 있는 컨트롤 + 대화 영역 제목에 현재 대상 텍스트 · 화면 문구는 "초안·스테이징·운영"(내부 용어 "포인터"·"스냅샷 번들" 금지).**
````

### A-32. [개발명세서 `docs/02-spec/개발명세서.md`] §5 확장성 — 다중 인스턴스 정합

**찾을 원문**
````text
평가 전용 레이트리밋 버킷은 기존 `RateLimitStore`(인스턴스별 한도 — 기존과 같은 수용)를 쓴다.
````
**바꿀 내용**
````text
평가 전용 레이트리밋 버킷은 기존 `RateLimitStore`(인스턴스별 한도 — 기존과 같은 수용)를 쓴다. **[No.40] 환경 분리의 다중 인스턴스 정합은 DB가 보장한다** — 포인터는 캐시하지 않고 매 요청 읽으며(전환 다음 요청부터 전 인스턴스 동일), 전환·승격은 기대값 조건부 갱신(CAS)이다. 버전 번들 캐시(불변 코어·합성)는 인스턴스 로컬이며 키에 버전 id가 있어 낡은 항목이 새 포인터에 쓰일 수 없다.
````

### A-33. [개발명세서 `docs/02-spec/개발명세서.md`] §5 가용성 — 운영 버전 읽기 실패

**찾을 원문**
````text
평가 저장 실패는 대화 전송과 독립이다(ADR-0038).
````
**바꿀 내용**
````text
평가 저장 실패는 대화 전송과 독립이다(ADR-0038). **[No.40] 운영 버전 본문을 읽지 못하면(손상·스키마 미지원) 공개 대화는 초안으로 몰래 대체하지 않고 엔진 미호출 폴백 턴으로 응답**하며 30초 음성 캐시로 재시도 폭주를 막는다 — 콘솔은 "직전 운영 버전으로 되돌리기"를 안내한다. 의미 색인 보존의 임베딩 단계 실패는 흡수하고 해당 항목만 의미 매칭에서 빠진다(규칙 매칭 유지 — ADR-0039).
````

### A-34. [개발명세서 `docs/02-spec/개발명세서.md`] §5 DB 이식성 — CAS·비파괴 마이그레이션

**찾을 원문**
````text
새 컬럼은 모델 끝에 선언해 `migrate dev` diff를 최소화한다.
````
**바꿀 내용**
````text
새 컬럼은 모델 끝에 선언해 `migrate dev` diff를 최소화한다. **[No.40] 포인터 전환·승격·켜기/끄기는 `updateMany` + 영향 행 수(CAS)이며 원시 SQL 0 · 모든 스키마 변경은 `ADD COLUMN`/`CREATE TABLE`/`CREATE INDEX`(테이블 재정의 0 — 부분 유니크 4개 보존).**
````

### A-35. [개발명세서 `docs/02-spec/개발명세서.md`] §5.1 환경변수 표 — No.40 2종 추가

**찾을 원문**
````text
ENDING` 상한(미응답 상한과 별개) |
````
**바꿀 내용**
````text
ENDING` 상한(미응답 상한과 별개) |
| **`ENV_PROD_HISTORY_PROTECTED`** | `apps/api/.env` | — | `5` | 보존 정리·수동 삭제에서 보호하는 직전 운영 버전 수(롤백 후보, 1~20 — No.40) |
| **`ENV_VERSION_BUNDLE_CACHE_MAX`** | `apps/api/.env` | — | `50` | 버전 번들 코어·합성 캐시 각각의 항목 상한(10~500) |
````

### A-36. [개발명세서 `docs/02-spec/개발명세서.md`] §5.1 그룹별 주석 — No.40

**찾을 원문**
````text
**대응 로그 행과 함께** 만든다(원장·큐가 있으면 로그도 있다).
````
**바꿀 내용**
````text
**대응 로그 행과 함께** 만든다(원장·큐가 있으면 로그도 있다).
> **환경 분리 그룹(No.40)이 추가한 2개도 전부 선택이며 API 전용이다(ml-worker 변수 추가 0건).** 하나도 설정하지 않으면 운영 이력 보호 5 · 버전 번들 캐시 50으로 동작한다. **기능 스위치는 환경변수가 아니라 챗봇별 모드(`chatbot:deploy`)**다. seed는 변경하지 않는다(데모 챗봇은 모드 꺼짐).
````

### A-37. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 13(ADR-0008) — No.40 갱신 각주

**찾을 원문**
````text
엔진 수정은 닫힌 목록 9항목이며 **정지점을 쓰지 않는다**(ADR-0008 갱신 각주, ADR-0035 §3·§9).
````
**바꿀 내용**
````text
엔진 수정은 닫힌 목록 9항목이며 **정지점을 쓰지 않는다**(ADR-0008 갱신 각주, ADR-0035 §3·§9).
    - **갱신(2026-09-25 — No.40)**: 운영 버전 서빙은 엔진을 바꾸지 않고 **입력을 라이브와 같게** 만든다 — 스냅샷 역직렬화가 노드 `updatedAt`(해시 밖 보조 필드)을 되살리고 6종 배열을 K-1 순서(`createdAt asc, id asc`)로 재정렬해 노드·의도·FAQ 동점 승자가 캡처 시점과 같다(ADR-0008 갱신 각주, ADR-0039 §3).
````

### A-38. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 16(ADR-0011) — No.40 갱신 각주

**찾을 원문**
````text
3요소 결합 검증·단일 404·평가값 에코 응답을 보상 통제로 갖는다(ADR-0011 갱신 각주, ADR-0038 §2·§6).
````
**바꿀 내용**
````text
3요소 결합 검증·단일 404·평가값 에코 응답을 보상 통제로 갖는다(ADR-0011 갱신 각주, ADR-0038 §2·§6).
    - **갱신(2026-09-25 — No.40)**: 공개 경로는 **8곳 그대로**다. 모드 켜진 챗봇은 `access.resolve()`가 읽은 행의 `prodVersionId`로 운영 버전을 서빙하고(추가 조회 0 · 캐시 없음 — 전환 다음 요청부터 전 인스턴스 반영), `GET …/config`의 이름·아바타·스킨은 운영 버전 값·인사말·퀵리플라이는 채널 설정이다. 공개 요청·응답 스키마 불변(ADR-0011 갱신 각주, ADR-0039 §2).
````

### A-39. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 20(ADR-0015) — No.40 갱신 각주

**찾을 원문**
````text
`Permission` 17종·역할 4종 불변(ADR-0015 갱신 각주, ADR-0038 §2).
````
**바꿀 내용**
````text
`Permission` 17종·역할 4종 불변(ADR-0015 갱신 각주, ADR-0038 §2).
    - **갱신(2026-09-25 — No.40)**: **권한 17 → 18종(`chatbot:deploy` — ADMIN 전용)**. 운영 전환·롤백·전환 예약·환경 모드 켜기/끄기·게이트 설정에만 쓰며, 스테이징 승격은 기존 `dialogue:write`+`chatbot:write`(편집자)다. 역할 4종·fail-closed 판정 순서·`@Public()` 8곳 불변. 개수 단언 2파일은 의도적으로 갱신한다(ADR-0015 갱신 각주, ADR-0039 §8).
````

### A-40. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 21(ADR-0016) — No.40 갱신 각주

**찾을 원문**
````text
화이트리스트에 `sessionId`·토큰·텍스트가 없다(ADR-0016 갱신 각주, ADR-0036 §6).
````
**바꿀 내용**
````text
화이트리스트에 `sessionId`·토큰·텍스트가 없다(ADR-0016 갱신 각주, ADR-0036 §6).
    - **갱신(2026-09-25 — No.40)**: `AuditTargetType`에 **`ChatbotEnvironment`**(환경)를 추가하고 **`AuditAction`은 추가하지 않는다** — 켜기/끄기 `STATUS_CHANGE` · 승격·전환·롤백·게이트 `UPDATE` · 예약 전환 실행은 예약자 명의 + `[예약 실행 #…]` 접두. 화이트리스트는 버전 번호·게이트 4필드·켜짐 여부뿐(사유 메모 본문 0). NOOP·미리보기·보존 정리·벡터 보존은 기록하지 않는다(ADR-0016 갱신 각주, ADR-0039 §8).
````

### A-41. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 24(ADR-0019) — No.40 갱신 각주

**찾을 원문**
````text
이 그룹은 집합을 바꾸지 않는다(ADR-0019 갱신 각주, ADR-0038 §4).
````
**바꿀 내용**
````text
이 그룹은 집합을 바꾸지 않는다(ADR-0019 갱신 각주, ADR-0038 §4).
    - **갱신(2026-09-25 — No.40)**: 환경 모드에서 반영(예문 추가·직접 수정 완료)은 **초안**에 들어가고 운영에는 다음 전환 때 반영된다. "운영 미반영" 배지와 "반영 후 재발생" 배지는 **표시 단계 순수 함수**(전환 이력의 대상 캡처 시각)로 판정하며 수집기·병합·`recurredCount`는 불변이다(ADR-0019 갱신 각주, ADR-0039 §8).
````

### A-42. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 29(ADR-0024) — No.40 갱신 각주

**찾을 원문**
````text
→ **ADR-0024 갱신 · ADR-0026 · ADR-0027**
````
**바꿀 내용**
````text
→ **ADR-0024 갱신 · ADR-0026 · ADR-0027**
    - **갱신(2026-09-25 — No.40)**: ml-worker·`/embed` 계약·`EmbeddingVector`(슬롯 색인)·색인기는 **무변경**이다. 운영·스테이징 버전 문장의 벡터는 신규 `EmbeddingTextVector`(`(chatbotId, modelId, textHash)` 유일 · 원문 없음 · 모드 꺼진 챗봇 0행)가 **기존 벡터를 복사해** 보존하므로 추가 임베딩 호출은 경합·모델 교체 예외뿐이다(ADR-0024 갱신 각주, ADR-0039 §4).
````

### A-43. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 31(ADR-0029) — No.40 갱신 각주

**찾을 원문**
````text
→ **ADR-0029 · ADR-0030**(+ ADR-0007·0015·0016·0022·0027 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0029 · ADR-0030**(+ ADR-0007·0015·0016·0022·0027 갱신 각주)
    - **갱신(2026-09-25 — No.40)**: 실행 스냅샷에 **대상 차원**(`targetKind` 초안 기본·스테이징·운영·버전 + `targetVersionId`/`No`)을 더한다 — ADR-0029 §2(4)가 No.40으로 넘긴 "환경 간 비교"를 복제 챗봇 없이 같은 챗봇 버전 번들로 수행하며, 기대값(자산 id)은 ID 보존 버전 간 그대로 유효하다. 오버레이 비교(M2)는 초안 대상만. 대상 버전의 최근 성공 실행이 운영 전환 게이트의 입력이다(ADR-0029 갱신 각주, ADR-0039 §5).
````

### A-44. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 32(ADR-0031) — No.40 갱신 각주

**찾을 원문**
````text
→ **ADR-0031**(+ ADR-0002·0015·0016·0025·0027·0029 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0031**(+ ADR-0002·0015·0016·0025·0027·0029 갱신 각주)
    - **갱신(2026-09-25 — No.40)**: **§8 경계를 ADR-0039가 부분 대체**한다 — 환경 개념·환경 포인터(태깅)·승격·트래픽 전환을 도입한다. **유지**: 라벨은 자유 메모(환경 표시는 포인터에서 파생) · 다른 챗봇으로 복원 없음 · 복원 의미론·호출부 2곳 불변(환경 모드에서 복원 = 초안만). 봉투에 **해시 밖 최상위 보조 필드 `tiebreak`**(노드 `updatedAt` — 스키마 버전 1 유지) · 메타 `tiebreakHash` · 트리거 +2(`ENV_INIT`·`PROMOTE`) · 보존 보호 집합에 환경 참조 버전(ADR-0031 갱신 각주, ADR-0039).
````

### A-45. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 33(ADR-0032) — No.40 갱신 각주

**찾을 원문**
````text
→ **ADR-0032**(+ ADR-0002·0011·0015·0016·0025·0027·0031 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0032**(+ ADR-0002·0011·0015·0016·0025·0027·0031 갱신 각주)
    - **갱신(2026-09-25 — No.40)**: §1의 "draft/published 기각 → No.40"을 **ADR-0039가 대체**한다(published = 운영 포인터). 예약 엔진에는 **동작 `SWITCH_PROD_VERSION` 1개**(실행기 1파일 + 레지스트리 1줄 + 권한 1분기 — 엔진·상태 기계 무변경)만 더하고, 모드 켜기 시 활성 `RESTORE_VERSION` 예약은 `HELD(ENV_MODE_CHANGED)`, 끄기 시 활성 전환 예약은 `CANCELLED`다. 감수 비용 1(준비 편집 운영 노출)은 모드 켜진 챗봇에서 해소된다(ADR-0032 갱신 각주, ADR-0039 §5·§7).
````

### A-46. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 38(ADR-0037) — No.40 갱신 각주

**찾을 원문**
````text
→ **ADR-0037**(+ ADR-0002·0005·0008·0016·0025·0031 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0037**(+ ADR-0002·0005·0008·0016·0025·0031 갱신 각주)
    - **갱신(2026-09-25 — No.40)**: No.40 1차는 **같은 챗봇·같은 ID**의 버전 포인터라 §5 ID 재매핑 적재기를 **사용하지 않는다** — "기존 대상과의 차이 적용 + 영속 ID 대응표"는 2차 서버 간 이관의 부품으로 남긴다. 토픽 정의·활성은 환경 밖(즉시 운영 반영)이며 운영 버전 번들에도 같은 비활성 필터·정규화를 적용한다(ADR-0037 갱신 각주, ADR-0039 §6).
````

### A-47. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 40 신설

**찾을 원문**
````text
→ **ADR-0038**(+ ADR-0002·0011·0012·0015·0019·0023·0033 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0038**(+ ADR-0002·0011·0012·0015·0019·0023·0033 갱신 각주)

40. **환경 분리/버전관리(No.40)의 환경 모델·포인터 위치·서빙·동점·의미 색인·전환·예약·권한 확정(2026-09-25 — PM 도입 확정, P-1~P-12 추천안)**: **① 환경 = 한 챗봇 안의 버전 포인터**(초안 = 기존 자산 테이블 · 스테이징/운영 = 불변 `ChatbotVersion` · 3단 고정 · 복제 챗봇 체인 기각 · 서버 간 이관 2차). **② 운영 포인터 = `Chatbot.prodVersionId`**(`access.resolve()` 행 — 공개 경로 추가 조회 0 · 캐시 없음 · null = 모드 꺼짐 = 바이트 동일) · 스테이징·게이트 = 1:1 `ChatbotEnvironment` · 이력 = append-only `EnvironmentSwitchLog` · 쓰기 1파일 CAS · 전환 시 `Chatbot.updatedAt` 갱신 수용. **③ 운영 서빙 = 스냅샷 역직렬화(해시 밖 보조 필드 `tiebreak`로 노드 `updatedAt` 복원 + 생성순 재정렬) + 현재 설문·토픽 활성 합성** · 2층 캐시(불변 코어 + 합성, 무효화 = 기존 `invalidate()`) · 소비자별 명시 소스(공개·힌트 = 운영, 시뮬레이터·TC = 대상 선택, 비교·설정 미리보기 = 초안). **④ 의미 색인 = 슬롯 색인·색인기 무변경 + 문장 해시 주소 보존 저장소 `EmbeddingTextVector`**(기존 벡터 복사 — 추가 임베딩 0). **⑤ 전환·롤백 = 포인터 CAS + 이력** · 대상 = 스테이징·운영 이력만 · 게이트 = 경고 기본 + 챗봇별 차단(롤백은 경고만 · 자동 롤백 없음) · 예약 = `SWITCH_PROD_VERSION` 1개. **⑥ 모드 켜기 시 활성 복원 예약 `HELD` · 복원 = 초안만 · 끄기 "운영 유지" = 기존 복원 API 선행**(`restore()` 호출부 2 유지). **⑦ 신규 권한 `chatbot:deploy`(ADMIN) 1종 · 감사 대상 `ChatbotEnvironment` 1종(액션 재사용) · 로그 `servedVersionId`(1차 적재만)**. 신규 `ApiErrorCode` 8종 · 선택 환경변수 2종 · 공개 경로 추가 0 · 엔진·위젯·ml-worker 변경 0. GPU **1 유지**(P-12). → **ADR-0039**(+ ADR-0002·0008·0011·0015·0016·0019·0024·0029·0031·0032·0033·0037 갱신 각주)
````

### A-48. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — 설계서 행 추가

**찾을 원문**
````text
알려진 제한 10건 · 요구사항 대비 해석 22건** | 요구사항: `docs/requirements/feedback-loop.md` |
````
**바꿀 내용**
````text
알려진 제한 10건 · 요구사항 대비 해석 22건** | 요구사항: `docs/requirements/feedback-loop.md` |
| **`environment-separation-설계.md`** | **환경 분리/버전관리(No.40) — 모듈 배치(`environment` · `core` export 2 · `serving` export 1 · 포인터 쓰기 유일 파일 미export) · Prisma 변경안(`Chatbot.prodVersionId` · `ChatbotEnvironment` · `EnvironmentSwitchLog` · `EmbeddingTextVector` · `ChatbotVersion.tiebreakHash` · `ConversationLog.servedVersionId` · `TestRun` 대상 3컬럼 — 마이그레이션 2개·부분 유니크 4 보존) · shared-types(`bundle-target`·`environment` 신설) · 켜기/끄기(재사용 조건 `tiebreakHash` · 끄기 "운영 유지" = 복원 선행) · ★C-1 동점(해시 밖 보조 필드 + 생성순 재정렬) · ★C-3 소스·2층 캐시 · ★C-2 의미 색인(보존 저장소·리졸버·pin/GC) · 전환·롤백 CAS · 게이트 · 예약 `SWITCH_PROD_VERSION` · 시뮬레이터/TC 대상 · 보존 보호 · 로그 귀속 · 학습 큐·평가 부작용 · 권한 `chatbot:deploy` · 감사 · 11개 엔드포인트·오류 8종 · **봉인 E-1~E-17** · 성능 예산 · 콘솔 인계 · 시험 포인트·**의도된 기대값 변경 4건(닫힌 목록)** · 알려진 제한 10건 · 요구사항 대비 해석 14건** | 요구사항: `docs/requirements/environment-separation.md` |
````

### A-49. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — ADR-0039 행 추가

**찾을 원문**
````text
FR-FB10-\*, AC-FB1~FB8 |
````
**바꿀 내용**
````text
FR-FB10-\*, AC-FB1~FB8 |
| **`decisions/ADR-0039-environment-pointers-version-serving-and-content-addressed-vector-retention.md`** | **환경 분리 = 한 챗봇 안의 버전 포인터(자산 이중화·복제 챗봇 체인 기각) · 운영 포인터 = `Chatbot.prodVersionId`(1:1 테이블 단독·캐시 기각 — 추가 조회 0) · 운영 번들 = 불변 스냅샷 역직렬화 + 라이브 운영 자산 합성(2층 캐시) · ★C-1 해시 밖 보조 필드 + 생성순 재정렬(엔진 옵션·해시 범위 편입 기각) · ★C-2 슬롯 색인 무변경 + 문장 해시 주소 보존 저장소(키 교체·버전별 복제 기각) · 전환 = 포인터 CAS + append-only 이력 · 경고/차단 게이트 · `SWITCH_PROD_VERSION` · 모드 켜기 시 복원 예약 `HELD` · 끄기 "운영 유지" = 복원 선행 · `chatbot:deploy` · ADR-0031 §8·ADR-0032 §1 부분 대체** | 요구사항 J-1~J-20, FR-0-149~160, FR-EN1-\*~FR-EN9-\*, AC-EN1~EN8 |
````

### A-50. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — ADR-0031 행에 부분 대체 표기

**찾을 원문**
````text
★ **No.40 경계 고정**(환경·태깅·승격·트래픽·타 챗봇 복원 없음, 라벨 무의미)
````
**바꿀 내용**
````text
★ **No.40 경계 고정**(환경·태깅·승격·트래픽·타 챗봇 복원 없음, 라벨 무의미 — **[2026-09-25] ADR-0039가 부분 대체**: 환경·태깅·승격·전환 도입 · 라벨 무의미·타 챗봇 복원 없음 유지)
````

### A-51. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — ADR-0032 행에 대체 표기

**찾을 원문**
````text
(draft/published 기각 → No.40)
````
**바꿀 내용**
````text
(draft/published 기각 → No.40 — **[2026-09-25] ADR-0039가 버전 포인터로 대체 · 동작 `SWITCH_PROD_VERSION` 추가**)
````

### A-52. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — ADR-0015 행의 권한 개수

**찾을 원문**
````text
`Permission` 유니온 · fail-closed 전역 가드
````
**바꿀 내용**
````text
`Permission` 유니온(**18종** — 2026-09-25 No.40 `chatbot:deploy`) · fail-closed 전역 가드
````

---

## B. 기존 ADR · 설계서 (결정 본문은 수정하지 않는다 — 파일 끝 append)

### B-1. [ADR-0031] `docs/02-spec/decisions/ADR-0031-chatbot-version-snapshot-and-id-preserving-restore.md` — §8 부분 대체 · 보조 필드 · 트리거 · 보존 보호 (append)

**찾을 원문**
````text
No.40은 여기에 "기존 대상과의 차이 적용"을 더한다.
````
**바꿀 내용**
````text
No.40은 여기에 "기존 대상과의 차이 적용"을 더한다.


---

## 갱신 (2026-09-25 — No.40: §8 부분 대체 · 해시 밖 보조 필드 · 환경 트리거 2종 · 보존 보호 확장)

환경 분리/버전관리(No.40, **ADR-0039**). 스냅샷 범위·ID 보존 복원·단일 트랜잭션·`contentHash` 규칙·`restore()` 호출부 2곳은 **불변**이다.

1. **§8 부분 대체**: ADR-0039가 환경 개념·환경 포인터(태깅)·승격·트래픽 전환을 도입한다 — 초안 = 자산 테이블, 스테이징·운영 = 이 ADR의 스냅샷을 가리키는 포인터. **유지되는 경계**: 라벨은 자유 메모(환경 배지는 포인터·전환 이력에서 파생) · 다른 챗봇으로 복원 없음 · 트래픽 분할 없음(2차). 재검토 트리거 "No.40 착수 → ID 재매핑 적재와 결합"은 **1차에서 발동하지 않는다** — 같은 챗봇·같은 ID라 재매핑이 필요 없고, 적재기는 2차 서버 간 이관의 부품이다.
2. **해시 밖 최상위 보조 필드 `tiebreak.nodeUpdatedAt`**: §1의 "항목별 `updatedAt`은 저장하지 않는다"를 **해시 범위(자산부)에 한해** 유지하고, 운영 서빙의 동점 일치를 위해 봉투 최상위에 노드 `updatedAt` 맵을 둔다. `contentHash`(자산부·답변설정·프로필만)는 불변이라 기존 해시·영구 픽스처·복원 사후 검증이 그대로다. `SNAPSHOT_SCHEMA_VERSION = 1` 유지(선택 필드) · 봉투 검증 스키마에 선택 필드 선언(strip 소실 방지) · 메타 `tiebreakHash` 추가. 복원·차이는 이 필드를 읽지 않는다.
3. **서빙 역직렬화**: 운영·스테이징 서빙은 `hydrateSnapshot()`을 그대로 부른 뒤 보조 필드를 적용하고 6종 배열을 `(createdAt asc, id asc)`로 재정렬하는 **새 순수 함수**를 쓴다(본문 저장 순서 `id asc`와 라이브 순서가 다르다 — K-1). 복원 경로의 `hydrateSnapshot()`은 무변경.
4. **트리거 2종**: `ENV_INIT`(환경 분리 시작 — 켜기 시 캡처) · `PROMOTE`(스테이징 승격). "같은 상태면 재사용"은 `contentHash` ∧ `tiebreakHash` 동일일 때만(편집 후 되돌리기 대비). 보존 정리에서는 자동 트리거 계열로 센다. 목록 필터 그룹 `ENVIRONMENT`.
5. **보존 보호 집합 확장**: 운영·스테이징 포인터 버전 + 운영 이력 최근 N(기본 5) + 활성 `SWITCH_PROD_VERSION` 예약 대상은 정리에서 제외하고 수동 삭제는 `409 VERSION_REFERENCED_BY_ENVIRONMENT`다. 알고리즘 불변(입력만 늘어난다).
6. **환경 모드에서 복원 = 초안만**: 운영은 포인터라 복원의 영향을 받지 않는다. 미리보기에 `ENV_DRAFT_ONLY` 경고를 더하고 `acknowledgeActive` 요청 계약은 그대로다. 운영 되돌리기는 복원이 아니라 포인터 롤백(ADR-0039 §5)이다.
````

### B-2. [ADR-0032] `docs/02-spec/decisions/ADR-0032-scheduled-deploy-one-shot-actions-and-db-claimed-polling.md` — draft/published 기각의 대체 · 동작 추가 (append)

**찾을 원문**
````text
tick 예외는 코드만 남긴 새 오류로 넘긴다(원문·메시지 인자를 `PollingLoop` 경고 로그에 흘리지 않는다).
````
**바꿀 내용**
````text
tick 예외는 코드만 남긴 새 오류로 넘긴다(원문·메시지 인자를 `PollingLoop` 경고 로그에 흘리지 않는다).


---

## 갱신 (2026-09-25 — No.40: draft/published 기각의 대체 · 동작 `SWITCH_PROD_VERSION` · 모드 변경 시 예약 처리)

환경 분리/버전관리(No.40, **ADR-0039 §5·§7**). 엔진(폴링·CAS 선점·임대)·엄격 바인딩·fail-stop·misfire·재시도 분류·권한 재검증·예약자 명의 감사는 **불변**이다.

1. **§1 "draft/published 기각 → No.40"을 ADR-0039가 대체**한다 — 자산 이중화가 아니라 **운영 포인터(`Chatbot.prodVersionId`)**다. 감수 비용 1(준비 편집이 운영에 잠시 보인다)은 **모드 켜진 챗봇에서 해소**된다.
2. **동작 `SWITCH_PROD_VERSION`**: params `{ targetVersionId, expectedProdVersionId }` · 실행기 1파일 + 레지스트리 1줄 + `requiredPermissions` 1분기(`chatbot:deploy`) · `targetVersionId`/`No` 비정규화 컬럼 재사용(스키마 변경 0). 바인딩 = 예약 시 운영 버전 id(체인이면 선행 전환 예약의 대상 — 복원 체인과 같은 규칙). 실행 시 불일치 → `FAILED(STATE_CHANGED)` · 게이트 차단 → `FAILED(GATE_NOT_PASSED)`(신규 영구 사유) · BUSY → 일시적. 미리보기 blocker는 전제 조건 사유 `SWITCH_BLOCKED`(신규)로 보고한다.
3. **실행기는 포인터를 직접 쓰지 않는다** — 예약 모듈의 Prisma 쓰기 대상은 `deploySchedule`뿐이라는 봉인(D-1)을 지키기 위해 `environment/core`의 전환 서비스를 호출한다. 임대 만료 회수는 전환 이력의 `deployScheduleId`(포인터와 같은 트랜잭션) 존재로 `RECOVERED`를 판정한다(복원의 백업 흔적 판정과 같은 원리).
4. **모드 변경 시 예약 처리**: 켜기 트랜잭션에서 활성(`PENDING`) `RESTORE_VERSION` → `HELD(ENV_MODE_CHANGED)`(신규 보류 사유 — 효과 대상이 운영 → 초안으로 바뀌므로 재확인), 끄기 트랜잭션에서 활성 `SWITCH_PROD_VERSION` → `CANCELLED`. 두 쓰기는 `deploy-schedule.repository.ts`의 메서드 2개이며 쓰기 파일 수(2)는 불변이다. 모드 켜진 챗봇의 `RESTORE_VERSION` 생성에는 준비도 경고 `ENV_DRAFT_ONLY`가 붙는다.
5. **실행 직후 TC(G3)**: `SWITCH_PROD_VERSION`에도 허용하며 대상은 새 운영 버전이다. 대안표의 "실행 전 TC 게이트는 스냅샷 번들 TC 모드가 생길 때" 트리거가 **발동**했다 — 게이트는 ADR-0039 §5(경고 기본 · 챗봇별 차단 · 자동 롤백 없음).
````

### B-3. [ADR-0037] `docs/02-spec/decisions/ADR-0037-topic-classification-bundle-filter-and-id-remapping-split.md` — 적재기 1차 미사용 · 토픽은 환경 밖 (append)

**찾을 원문**
````text
**`ConversationLog.topicId` 적재 후 한 분기 이상 데이터 축적 + 토픽별 통계 요구 확정** → 통계 화면·인덱스.
````
**바꿀 내용**
````text
**`ConversationLog.topicId` 적재 후 한 분기 이상 데이터 축적 + 토픽별 통계 요구 확정** → 통계 화면·인덱스.


---

## 갱신 (2026-09-25 — No.40: 적재기 1차 미사용 · 토픽은 환경 밖)

환경 분리/버전관리(No.40, **ADR-0039 §1·§6**). 결정 §1~§8은 불변이다.

1. **재검토 트리거 "No.40 착수 → §5 적재기에 차이 적용"은 1차에서 발동하지 않는다** — No.40 1차는 같은 챗봇·같은 ID의 버전 포인터라 재매핑이 필요 없다. "기존 대상과의 차이 적용 + 영속 ID 대응표 + 파일 직렬화"는 **2차 서버 간 이관**의 부품으로 남기며, 가져온 버전은 대상 서버의 **초안**으로 적재한다.
2. **토픽 정의·활성은 환경 밖**이다(§4 — 스냅샷 밖): 토픽 토글은 즉시 운영에 반영되고, 운영 버전 번들에도 같은 비활성 필터(`filterInactiveTopicAssets`)와 복원 정규화 규칙(없는 토픽 → 공통)을 적용한다. `excludeInactiveTopics` 식별자(T-2)·`getCachedUnfiltered` 호출 파일(T-4)은 불변이다.
````

### B-4. [ADR-0024] `docs/02-spec/decisions/ADR-0024-ml-worker-scope-and-runtime.md` — 버전 문장 벡터 보존 저장소 · ml-worker 무변경 (append)

**찾을 원문**
````text
ml-worker는 **DB에 접근하지 않는다**(모든 영속화는 `apps/api`).
````
**바꿀 내용**
````text
ml-worker는 **DB에 접근하지 않는다**(모든 영속화는 `apps/api`).


---

## 갱신 (2026-09-25 — No.40: 버전 문장 벡터 보존 저장소 · ml-worker 무변경)

환경 분리/버전관리(No.40, **ADR-0039 §4**). §4 "이 갱신이 건드리지 않는 것" 전부와 `/embed`·`/health` 계약은 **불변**이다.

1. **슬롯 색인(`EmbeddingVector`)과 색인기는 바꾸지 않는다** — 유일 키·재사용 키 `textHash`·고아 정리·재색인 비용이 모드 꺼진 챗봇에서 같다.
2. **`EmbeddingTextVector`(신규)**: `(chatbotId, modelId, textHash)` 유일 · 원문 없음 · 같은 코덱. 운영·스테이징·운영 이력·전환 예약 대상 버전의 질문 측 문장 벡터를 **슬롯 색인에서 복사**해 보존한다(재사용 키의 "같은 정규화 문장 = 같은 벡터" 등식). 모드 꺼진 챗봇은 0행.
3. **버전 대상 점수**: 버전 슬롯마다 "보존 저장소 → 같은 `textHash`의 초안 벡터" 순으로 벡터를 모아 기존 `assembleSemanticInput()`에 넣는다 — 랭킹·타이브레이크 규칙 1벌 유지.
4. **추가 임베딩 호출**: 정상 경로 0. 경합(캡처 직전 편집의 재색인 전 재편집)·모델 교체로 벡터가 없는 문장만 기존 Provider 경로(유일 출구)로 임베딩한다 — 외부 HTTP 출구 수 불변 · ml-worker는 여전히 DB에 접근하지 않는다.
````

### B-5. [ADR-0029] `docs/02-spec/decisions/ADR-0029-test-run-as-version-axis.md` — 실행 대상 차원 (append)

**찾을 원문**
````text
TC는 복원 결과를 재는 **자**이므로 복원 대상이 아니다.
````
**바꿀 내용**
````text
TC는 복원 결과를 재는 **자**이므로 복원 대상이 아니다.


---

## 갱신 (2026-09-25 — No.40: 실행 대상 차원 · §2(4) 환경 간 비교의 해소)

환경 분리/버전관리(No.40, **ADR-0039 §5**). "버전 = 실행 결과"·판정 축(매칭 id 일치)·M1/M2·보존 정책은 **불변**이다.

1. **대상 차원**: `TestRun.targetKind`(`DRAFT` 기본·`STAGING`·`PROD`·`VERSION`) + `targetVersionId`/`No` — 시작 시 포인터를 해석해 저장한다. 비초안 대상은 운영 서빙과 **같은 버전 번들·설정·벡터**로 판정한다. 초안 실행의 응답·지문 바이트 불변.
2. **§2(4) "챗봇 인스턴스 복제 비교 = No.40 본체"의 해소**: 복제 챗봇 없이 **같은 챗봇의 버전 번들**을 대상으로 실행한다 — ID 보존 버전이라 기대값(자산 id)이 버전을 넘어 그대로 유효하다(§6의 FK 없는 id 저장이 전제).
3. **M2(오버레이)는 초안 대상만** — "저장본 + 가상 변경"의 저장본은 초안이다.
4. **게이트 입력**: 대상 버전을 대상으로 한 최근 성공 `SINGLE` 실행(세트·합격률·유효 기간·임베딩 모델)이 운영 전환 게이트의 입력이다(`(chatbotId, targetVersionId)` 인덱스).
````

### B-6. [ADR-0015] `docs/02-spec/decisions/ADR-0015-role-permission-model.md` — 권한 17 → 18 · `@Public()` 8 유지 (append)

**찾을 원문**
````text
만족도 통계 `chatbot:read`(AGENT 포함 — 통계와 같은 도메인).
````
**바꿀 내용**
````text
만족도 통계 `chatbot:read`(AGENT 포함 — 통계와 같은 도메인).


---

## 갱신 (2026-09-25 — No.40 환경 분리: 권한 17 → 18종 `chatbot:deploy` · `@Public()` 8 유지)

환경 분리/버전관리(No.40, **ADR-0039 §8**)는 **신규 권한 1종**을 만든다(PM 확정 P-4 (2)). 역할 4종 · fail-closed 판정 순서 · `@Public()` 8곳은 불변이다.

- **`chatbot:deploy`**(ADMIN 전용) — 운영 전환·롤백·운영 전환 예약·환경 모드 켜기/끄기·게이트 설정. "편집자 = 배포자"를 분리하는 최소 단위이며, 역할 신설("배포 관리자")은 매트릭스 전체 파급 때문에 기각했다. 명명은 기존 챗봇 도메인(`chatbot:*`)을 따른다.
- 스테이징 승격 = 기존 `dialogue:write` AND `chatbot:write`(편집자 가능) · 현황·미리보기 = `chatbot:read` AND `dialogue:read` · 이력 = `chatbot:read` · 긴급 차단 = 기존 `channel:write`(WEB 채널 닫기).
- 예약 전환의 실행 직전 재검증은 `chatbot:deploy`를 본다. 개수 고정 테스트 2파일(`permission-matrix.spec.ts`·`topic-sealing.spec.ts` T-10)은 무력화하지 않고 18로 갱신한다.
````

### B-7. [ADR-0016] `docs/02-spec/decisions/ADR-0016-audit-log-backfill-scope.md` — `ChatbotEnvironment` 대상 · 액션 재사용 (append)

**찾을 원문**
````text
5. 영향 미리보기·분리 미리보기·토픽 목록은 읽기라 기록하지 않는다.
````
**바꿀 내용**
````text
5. 영향 미리보기·분리 미리보기·토픽 목록은 읽기라 기록하지 않는다.


---

## 갱신 (2026-09-25 — No.40: `ChatbotEnvironment` 대상 · 액션 재사용)

환경 분리/버전관리(No.40, **ADR-0039 §8**). 기록 위치·트랜잭션 경계·화이트리스트 규약은 불변이다.

1. **`AuditTargetType`에 `ChatbotEnvironment`**(라벨 "환경", 1종 추가). 켜기/끄기 `STATUS_CHANGE` · 스테이징 승격·운영 전환·롤백·게이트 설정 `UPDATE`. **`AuditAction` 추가 0**(14종 — `topic-sealing.spec.ts` T-10 불변).
2. 화이트리스트 = `enabled`·`stagingVersionNo`·`prodVersionNo`·`gateMode`·`gateTestSetId`·`gateMinPassRate`·`gateValidHours`. **사유 메모 본문은 담지 않는다**(summary에 유무만).
3. 예약 전환 실행은 주체 = 예약자(`actorOverride`) + summary 접두 `[예약 실행 #…]`(ADR-0032 §5 규약 그대로).
4. NOOP·미리보기·이력 조회·보존 정리·벡터 보존/GC와 `ENV_INIT`/`PROMOTE` 버전 생성 자체는 기록하지 않는다(환경 감사 1건에 버전 번호로 포함 — 자동 스냅샷 비감사 선례).
````

### B-8. [ADR-0002] `docs/02-spec/decisions/ADR-0002-permanent-delete-referential-integrity.md` — 동반 삭제 +3 · 사전검사 15종 불변 (append)

**찾을 원문**
````text
사전검사 추가는 방어·표시(차단 사유에 `답변 평가 n건` 병기) 목적이다.
````
**바꿀 내용**
````text
사전검사 추가는 방어·표시(차단 사유에 `답변 평가 n건` 병기) 목적이다.


---

## 갱신 (2026-09-25 — No.40: 동반 삭제 3테이블 추가 · 사전검사 15종 불변)

환경 분리/버전관리(No.40, **ADR-0039**). 결정 1~6은 불변이다.

- `ChatbotEnvironment`(1:1 환경 설정) · `EnvironmentSwitchLog`(전환 이력) · `EmbeddingTextVector`(버전 문장 벡터 보존)는 **동반 삭제**다 — 버전·예약과 같은 "챗봇과 생사를 같이하는 운영·파생 데이터"이며 사용자 판단의 원천 기록이 아니다. 영구삭제 트랜잭션의 챗봇 삭제 직전에 `deleteMany` 3건(16 → 19테이블). 사전검사 목록(15종)은 불변이다.
- `Chatbot.prodVersionId`는 FK가 없어 버전 동반 삭제 순서에 영향이 없다.
````

### B-9. [ADR-0033] `docs/02-spec/decisions/ADR-0033-cumulative-stats-source-log-sealing-and-group-snapshot.md` — 로그 `servedVersionId` (append)

**찾을 원문**
````text
키의 👍/👎 건수 + `groupId` 스냅샷(텍스트·세션 ID 없음).
````
**바꿀 내용**
````text
키의 👍/👎 건수 + `groupId` 스냅샷(텍스트·세션 ID 없음).


---

## 갱신 (2026-09-25 — No.40: 로그 `servedVersionId` · 봉인 불변)

환경 분리/버전관리(No.40, **ADR-0039 §8**). 결정 1~8은 불변이다.

1. **`ConversationLog.servedVersionId`**: 턴 처리 시점의 운영 포인터(모드 켜짐 — 엔진·BLOCK·상담 턴 공통 · 모드 꺼짐 = null). `groupId`·`topicId`와 같이 **적재 시점에 확정되는 사실**이며 `record()` 1곳에서만 쓰고 적재 후 바꾸지 않는다(R-9/R-10 불변). FK·인덱스 없음 · 백필 없음.
2. 1차는 적재만 한다 — 버전별 통계 비교·비율 분할은 2차이며, 그때 인덱스와 세션 귀속 규칙을 이 컬럼 위에 올린다. 누적 통계·그룹 귀속 집계는 불변이다.
3. 환경 전환 이력(`EnvironmentSwitchLog`)은 운영 이력이지 대화 원천이 아니다 — 삭제·갱신 코드 0(영구삭제 동반 삭제만).
````

### B-10. [ADR-0019] `docs/02-spec/decisions/ADR-0019-unanswered-queue-collection-model.md` — 운영 미반영 표시 판정 (append)

**찾을 원문**
````text
**§6 그대로 감사하지 않는다.**
````
**바꿀 내용**
````text
**§6 그대로 감사하지 않는다.**


---

## 갱신 (2026-09-25 — No.40: 환경 모드의 "운영 미반영"·재유입 표시는 표시 단계 판정)

환경 분리/버전관리(No.40, **ADR-0039 §8**). 결정 §1~§6과 쓰기 파일 3개 집합은 **불변**이다.

1. 환경 모드 챗봇에서 반영(예문 추가·직접 수정 완료)은 **초안**에 들어가고 운영에는 다음 운영 전환 때 반영된다. 큐는 여전히 운영 대화 로그에서 모인다.
2. 목록 응답(모드 켜짐 · `RESOLVED` 항목)에 `prodReflection`(`PENDING_SWITCH` | `REFLECTED` + `reflectedAt`)을 싣는다 — 판정은 순수 함수가 **전환 이력의 대상 버전 캡처 시각**(비정규화 컬럼)과 반영 시각을 비교한다(요청당 1쿼리 · 수집기 무변경).
3. §5 "반영 후 재발생" 배지는 모드 켜짐이면 `PENDING_SWITCH` 동안 띄우지 않고, `REFLECTED`면 `lastOccurredAt > reflectedAt`일 때만 띄운다. `recurredCount` 숫자·`recurredOnly` 필터는 미반영 기간의 발생을 포함한다(수집기 봉인 우선 — 알려진 한계).
````

### B-11. [ADR-0008] `docs/02-spec/decisions/ADR-0008-dialogue-resolution-pipeline.md` — 운영 버전 서빙은 입력을 라이브와 같게 (append)

**찾을 원문**
````text
적용 전후 TC 비교로 차이가 동점 케이스뿐임을 확인한다.
````
**바꿀 내용**
````text
적용 전후 TC 비교로 차이가 동점 케이스뿐임을 확인한다.


---

## 갱신 (2026-09-25 — No.40: 운영 버전 서빙은 입력을 라이브와 같게 만든다 · 엔진 수정 0)

환경 분리/버전관리(No.40, **ADR-0039 §3**). §1~§8의 결정은 불변이며 **엔진 수정 0**이다.

1. 운영·스테이징 버전 번들은 스냅샷 역직렬화로 만든다. **노드 `updatedAt`**은 스냅샷의 해시 밖 보조 필드로 되살리고(없는 과거 스냅샷은 캡처 시각 — 동점은 `id asc`), **6종 배열 순서**는 K-1과 같은 `(createdAt asc, id asc)`로 재정렬한다 — 스냅샷 본문 저장 순서(`id asc`)와 달라 의도·FAQ 동점 승자가 바뀌는 것을 막는다.
2. 따라서 `rankNodes`(§4 동점 규칙)·`matchIntent`·`matchFaqEntry`의 "먼저 본 항목" 규칙은 그대로이고, 같은 버전을 대상으로 한 공개 대화·시뮬레이터·TC의 결과가 같으며 캡처 시점 초안과도 같다.
````

### B-12. [ADR-0011] `docs/02-spec/decisions/ADR-0011-channel-implementation-tier-and-public-surface.md` — 공개 경로 8 유지 · 운영 버전 서빙 · 표시 설정 출처 (append)

**찾을 원문**
````text
**`fb-ip`(120/분) + `fb-key:msg:{messageId}`(10/분)**만 소비한다.
````
**바꿀 내용**
````text
**`fb-ip`(120/분) + `fb-key:msg:{messageId}`(10/분)**만 소비한다.


---

## 갱신 (2026-09-25 — No.40: 공개 경로 8 유지 · 운영 버전 서빙 · 표시 설정 출처)

환경 분리/버전관리(No.40, **ADR-0039 §2**). §3(404/403)·§4·§5·§6과 "공개 판정 캐시 없음"은 **불변**이다.

1. **`@Public()` 8곳 그대로** — 스테이징 외부 미리보기 링크는 만들지 않는다(P-2). 공개 요청에 대상·버전 입력 필드가 없어 공개 요청으로 초안·스테이징에 도달하는 경로가 없다.
2. 모드 켜진 챗봇은 `resolve()`가 읽은 챗봇 행의 `prodVersionId`로 운영 버전을 서빙한다 — 추가 조회 0 · 포인터 캐시 없음(전환 다음 요청부터 전 인스턴스 반영 — 긴급 중단을 캐시 없이 처리한 것과 같은 이유).
3. `GET …/config`: 모드 켜짐이면 이름·아바타·스킨 = 운영 버전 표시 설정, 인사말·퀵리플라이·런처 = WEB 채널 config(현재 값). 응답 스키마 불변.
4. 운영 버전 본문을 읽지 못하면 대화는 초안으로 대체하지 않고 폴백 턴으로 응답한다(공개 판정은 통과한 상태 — `403`/`404` 규약과 별개).
````

### B-13. [예약 배포 설계서] `docs/02-spec/scheduled-deploy-설계.md` §5.6 — "포인터 전환" 확장점 이행 표기

**찾을 원문**
````text
| **No.40 "포인터 전환"**(published = 특정 `ChatbotVersion`) |
````
**바꿀 내용**
````text
| **No.40 "포인터 전환"**(published = 특정 `ChatbotVersion`) **[2026-09-25 이행 — `SWITCH_PROD_VERSION` · ADR-0039]** |
````

### B-14. [예약 배포 설계서] `docs/02-spec/scheduled-deploy-설계.md` 알려진 제한 L-1 — 해소 표기

**찾을 원문**
````text
트리거: "준비 중 노출 불가" 요구 → **No.40 우선 착수**("포인터 전환" 동작 추가, §5.6) |
````
**바꿀 내용**
````text
트리거: "준비 중 노출 불가" 요구 → **No.40 우선 착수**("포인터 전환" 동작 추가, §5.6) **[2026-09-25] No.40 설계 완료 — 환경 모드 챗봇에서 해소(ADR-0039)** |
````

---

## C. `docs/01-requirements/기능요구사항.md`

### C-1. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 No.40 행 — PM 도입 확정 · 설계 완료 반영

**찾을 원문**
````text
| 40 | 환경분리/버전관리 | Dev/Staging/Prod 환경 분리 + 시뮬레이터 | 배포 전 별도 환경에서 대화 플로우를 테스트하고, 환경별로 버전을 태깅·트래픽 전환 | 1 | ○ | ○ | Dialogflow CX 벤치마킹.
````
**바꿀 내용**
````text
| 40 | 환경분리/버전관리 | Dev/Staging/Prod 환경 분리 + 시뮬레이터 | 한 챗봇 안의 **초안 → 스테이징 → 운영** 환경(초안 = 기존 편집 테이블 · 스테이징/운영 = 버전 스냅샷 포인터 — **편집이 운영에 보이지 않음**) · 스테이징 승격 · 운영 **즉시/예약 전환**(No.28 동작 1개)·**직전 운영 버전 롤백** · 시뮬레이터·TC **환경/버전 대상 실행** + 운영 전환 검증 게이트(경고 기본·챗봇별 차단) · 로그 서빙 버전 귀속 | 1 | ○ | ○ | **✅ PM 도입 확정(2026-09-25 — 범위·방식 P-1~P-12 전부 추천안) · 설계 완료(`docs/02-spec/environment-separation-설계.md` · ADR-0039).** 1차 = 한 챗봇 안의 환경 포인터(신규 권한 `chatbot:deploy` · `@Public()` 추가 0 · 엔진·위젯·ml-worker 변경 0 · 설문/API 연결/상담 설정/토픽 활성은 환경 밖 즉시 반영) · **비율 분할(카나리·A/B)·서버 간 이관(export/import — 망분리 구축형)은 2차**. Dialogflow CX 벤치마킹.
````

### C-2. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 No.40 행 끝 — 적재기 1차 미사용

**찾을 원문**
````text
No.40은 이를 재사용해 "기존 대상과의 차이 적용"을 더한다(ADR-0037 §5)** |
````
**바꿀 내용**
````text
No.40은 이를 재사용해 "기존 대상과의 차이 적용"을 더한다(ADR-0037 §5)** **[2026-09-25 설계] 1차는 같은 챗봇·같은 ID의 버전 포인터라 적재기를 쓰지 않는다 — 2차 서버 간 이관의 부품(ADR-0039)** |
````

### C-3. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 주의 문단 — 확정 후 기록용 표기

**찾을 원문**
````text
**주의**: 이 8개는 아직 타사 사례 기반 "제안"일 뿐
````
**바꿀 내용**
````text
**[2026-09-25 갱신 — 아래 사용자 확인 결과로 8개 전부 도입 확정, 이 주의 문단은 기록용]** **주의**: 이 8개는 아직 타사 사례 기반 "제안"일 뿐
````

### C-4. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 사용자 확인 결과(106행) — No.40~47 전부 도입 확정

**찾을 원문**
````text
나머지 7개(No.40~43·45~47)는 여전히 확인 대기다.
````
**바꿀 내용**
````text
~~나머지 7개(No.40~43·45~47)는 여전히 확인 대기다.~~ **[2026-09-25 갱신] No.40~47 전부 도입 확정(2026-09-25)** — No.40 환경분리/버전관리는 범위·방식까지 확정(요구사항 `docs/requirements/environment-separation.md` §11 P-1~P-12 전부 추천안 · 설계 `docs/02-spec/environment-separation-설계.md` · ADR-0039). No.41~43·45~47은 도입만 확정됐고 범위·방식은 각 그룹 요구사항 단계에서 정한다.
````

### C-5. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §3 No.25 행 — 복원·롤백 역할 분리 각주

**찾을 원문**
````text
**환경·승격·트래픽 전환·태깅은 No.40** |
````
**바꿀 내용**
````text
**환경·승격·트래픽 전환·태깅은 No.40** **[2026-09-25 No.40 설계 완료] 환경 모드 챗봇에서 복원 = 초안만 · 운영 되돌리기 = 운영 포인터 롤백(ADR-0039)** |
````

### C-6. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §3 No.28 행 — 포인터 전환 결합 각주

**찾을 원문**
````text
"학습본 → 운영 교체"를 완전히 충족하려면 No.40 선행 필요 |
````
**바꿀 내용**
````text
"학습본 → 운영 교체"를 완전히 충족하려면 No.40 선행 필요 **[2026-09-25 No.40 설계 완료] 동작 `SWITCH_PROD_VERSION`(운영 버전 예약 전환)으로 결합 — 모드 켜진 챗봇은 준비 편집이 운영에 보이지 않는다(ADR-0039)** |
````

---

## D. `docs/requirements/environment-separation.md` — PM 결정 기록 · 설계 반영

### D-1. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] 머리 "도입 상태" — 범위·방식 확정

**찾을 원문**
````text
이 문서는 도입 여부를 묻지 않고 **범위와 방식만** 묻는다(§11).
````
**바꿀 내용**
````text
이 문서는 도입 여부를 묻지 않고 **범위와 방식만** 묻는다(§11). **[범위·방식 확정(2026-09-25, 추천안)] PM이 §11 P-1~P-12를 전부 추천안으로 확정했다 — 설계: `docs/02-spec/environment-separation-설계.md` · ADR-0039.**
````

### D-2. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] §1.11 핵심 판단 표 머리 — PM 결정 표기

**찾을 원문**
````text
### 1.11 이 문서의 핵심 판단 20건 (⚠ = PM 확인 필요)
````
**바꿀 내용**
````text
### 1.11 이 문서의 핵심 판단 20건 (⚠ = PM 확인 필요)

> **PM 결정(2026-09-25)** — ⚠ 표시 항목을 포함해 아래 "결정(제안)" 열이 **전부 추천안대로 확정**되었다(§11 P-1~P-12). architect 확정 사항과 요구사항 대비 조정은 설계서 §1·§28에 있다: 운영 포인터 = `Chatbot.prodVersionId`(D-7) · 동점 = 해시 밖 보조 필드 + **생성순 재정렬**(설계서 R-1) · 재사용 조건 `tiebreakHash`(R-2) · 의미 색인 = 별도 보존 저장소(D-8) · 비교는 초안 고정(D-10) · 로그 귀속 = 턴 유형 공통(D-11) · 오류 코드 8종(D-5).
````

### D-3. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] §11 PM 확인 항목 — P 절 확정 표기

**찾을 원문**
````text
## 11. PM 확인이 필요한 항목
````
**바꿀 내용**
````text
## 11. PM 확인이 필요한 항목

> **PM 결정(2026-09-25) — 확정(2026-09-25, 추천안).** No.40 도입 확정 · P-1~P-12 전부 권고안 채택.
> - **P-1 (d)** 확정(2026-09-25, 추천안): 1차 = 한 챗봇 안의 환경 포인터(초안 = 현재 테이블 · 스테이징/운영 = `ChatbotVersion` 스냅샷) · 2차 = 서버 간 export/import · 복제 챗봇 체인 기각
> - **P-2 (b)** 확정(2026-09-25, 추천안): 3단 고정 · 스테이징 검수는 콘솔(시뮬레이터·TC)만 · 운영 전환 대상 = 현재 스테이징 또는 운영 이력(롤백)
> - **P-3 (b)** 확정(2026-09-25, 추천안): 즉시 + 예약 전환(No.28 `SWITCH_PROD_VERSION`) · 비율 분할 2차 · 로그 `servedVersionId` 1차부터
> - **P-4 (2)** 확정(2026-09-25, 추천안): 신규 권한 `chatbot:deploy`(ADMIN) — 스테이징 승격은 편집자, 운영 전환·롤백·예약·모드 변경·게이트 설정은 deploy, 긴급 차단은 WEB 채널 닫기
> - **P-5** 확정(2026-09-25, 추천안): 경고 게이트 기본 + 챗봇별 차단 · 롤백엔 경고만 · 자동 롤백 없음
> - **P-6** 확정(2026-09-25, 추천안): 켜기 = 현재 상태로 두 포인터 자동 초기화(응답 불변) · 끄기 = 매번 선택(기본 "운영 유지")
> - **P-7** 확정(2026-09-25, 추천안): 복원 = 초안만 · 운영 되돌리기 = 포인터 롤백
> - **P-8** 확정(2026-09-25, 추천안): `SWITCH_PROD_VERSION` 추가 + 모드 켜기 시 기존 `RESTORE_VERSION` 활성 예약 `HELD`
> - **P-9** 확정(2026-09-25, 추천안): 스냅샷 밖 자산은 환경 밖(즉시 반영) + 화면 안내
> - **P-10** 확정(2026-09-25, 추천안): 위젯 이름·아바타·스킨 = 운영 버전 값 · 인사말·퀵리플라이 = 채널 설정
> - **P-11** 확정(2026-09-25, 추천안): 1차 로그 귀속만 · 비교 화면 2차
> - **P-12** 확정(2026-09-25, 추천안): GPU 1 · 구축형 ○ · 구독형 ○(망분리 구축형은 2차)
>
> 표 아래 "architect 확정 사항"의 결정은 설계서 §1 "(architect)" 행과 §28을 따른다.
````

### D-4. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] FR-0-154 — 끄기 "운영 유지" 흐름 확정

**찾을 원문**
````text
모드 끄기의 "운영 유지"는 콘솔이 기존 복원 API를 먼저 호출하는 흐름으로 구현하거나 architect가 대안을 확정한다 | C-4 |
````
**바꿀 내용**
````text
모드 끄기의 "운영 유지"는 ~~콘솔이 기존 복원 API를 먼저 호출하는 흐름으로 구현하거나 architect가 대안을 확정한다~~ **[확정] 콘솔이 기존 복원 API를 먼저 호출한 뒤 끄기를 요청하고, 서버는 초안 해시 = 운영 해시만 확인한다(아니면 `409 ENV_DRAFT_NOT_RESTORED` — 설계서 §5.4)** | C-4 |
````

### D-5. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] FR-0-157 — 오류 코드 8종 확정

**찾을 원문**
````text
`ENV_SWITCH_BUSY`(409). 오류 봉투 형식 불변 | ADR-0003 |
````
**바꿀 내용**
````text
`ENV_SWITCH_BUSY`(409) **[확정 — 8종: 위 6종 + `ENV_MODE_ALREADY_ENABLED`(409 — 켜진 챗봇에 켜기) · `ENV_DRAFT_NOT_RESTORED`(409 — 끄기 "운영 유지" 전 초안 복원 필요). 설계서 §19.3]**. 오류 봉투 형식 불변 | ADR-0003 |
````

### D-6. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] FR-0-158 — 기대값 변경 닫힌 목록 확정

**찾을 원문**
````text
| FR-0-158 | **의도된 기대값 변경은 architect가 닫힌 목록으로 확정**한다
````
**바꿀 내용**
````text
| FR-0-158 | **의도된 기대값 변경은 architect가 닫힌 목록으로 확정**한다 **[확정 — 설계서 §24.2 X-1~X-4: 권한 개수 단언 2파일(17 → 18) · `@Public` 컨트롤러 등록 목록(34 → 35, `@Public()` 8 불변) · 영구삭제 트랜잭션 목 3줄(16 → 19테이블). `AuditAction`·`@Public()` 수·`DeployScheduleAction` 단언 파일 0]**
````

### D-7. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] FR-EN2-2 — 포인터 위치 확정

**찾을 원문**
````text
포인터는 **캐시하지 않는다**(전환이 다음 요청부터 전 인스턴스에 반영). |
````
**바꿀 내용**
````text
포인터는 **캐시하지 않는다**(전환이 다음 요청부터 전 인스턴스에 반영). **[확정] 운영 포인터 = `Chatbot.prodVersionId`(추가 조회 0) · 전환 시 `Chatbot.updatedAt` 갱신 수용 · 스테이징·게이트 = 1:1 `ChatbotEnvironment`(설계서 §3.1·§9.5)** |
````

### D-8. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] FR-EN3-2 — 의미 색인 구조 확정

**찾을 원문**
````text
초안에서 이미 임베딩된 문장만 참조하므로 **추가 임베딩 호출 0**. |
````
**바꿀 내용**
````text
초안에서 이미 임베딩된 문장만 참조하므로 **추가 임베딩 호출 0**. **[확정] 슬롯 색인(`EmbeddingVector`)의 키는 바꾸지 않고 별도 보존 저장소 `EmbeddingTextVector`를 `(chatbotId, modelId, textHash)`로 주소화 · 버전 점수 = 보존 ∪ 같은 해시 초안 벡터 · 기존 벡터 복사(설계서 §8)** |
````

### D-9. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] FR-EN4-1 — 트리거·재사용 확정

**찾을 원문**
````text
(트리거 `PROMOTE` 신규 또는 `MANUAL` 재사용 — architect · 직전과 해시 같으면 재사용)
````
**바꿀 내용**
````text
(트리거 ~~`PROMOTE` 신규 또는 `MANUAL` 재사용 — architect · 직전과 해시 같으면 재사용~~ **[확정] `PROMOTE` 신규(+ 켜기 `ENV_INIT`) · 재사용 = `contentHash` ∧ `tiebreakHash` 동일 · 현재 스테이징과 같으면 NOOP — 설계서 §9.2**)
````

### D-10. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] FR-EN6-1 — 비교는 초안 고정(설계 조정)

**찾을 원문**
````text
FR-EN6-1 | 시뮬레이터 대화·비교에 **대상 선택**
````
**바꿀 내용**
````text
FR-EN6-1 | 시뮬레이터 대화~~·비교~~에 **대상 선택**(**[설계 조정] 비교는 오버레이 전용이라 초안 고정 — 설계서 §28 R-3**)
````

### D-11. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] FR-EN8-1 — 로그 귀속 값 규칙 확정

**찾을 원문**
````text
보류 RAG 턴은 POST 시점의 버전을 백그라운드 적재에 전달. |
````
**바꿀 내용**
````text
보류 RAG 턴은 POST 시점의 버전을 백그라운드 적재에 전달. **[확정] 값 = 턴 처리 시점의 운영 포인터 — 엔진·BLOCK·상담 턴 공통(세션 귀속 분모 — 설계서 §14 · §28 R-4)** |
````

### D-12. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] FR-EN8-4 — 운영 미반영 판정 방식 확정

**찾을 원문**
````text
(방식은 architect — 표시 단계 판정 권고, 수집기 봉인 유지)
````
**바꿀 내용**
````text
(**[확정] 표시 단계 순수 함수 `judgeProdReflection`·`shouldShowRecurredAfterApply` — 입력 = 전환 이력의 대상 캡처 시각, 수집기 봉인 유지 · 설계서 §15.1**)
````

### D-13. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] FR-EN8-5 — 버전 본문 조회 범위 확정

**찾을 원문**
````text
(버전 본문 조회는 architect 판단 — 상세 1건 한정)
````
**바꿀 내용**
````text
(**[확정] 상세 1건 한정 — 턴 로그 `servedVersionId`로 버전 코어 조회, 목록은 "초안에 없음" 문구만 · 설계서 §15.2**)
````

### D-14. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] §5.2 `ChatbotEnvironment` 행 — 저장 위치 확정

**찾을 원문**
````text
**공개 경로 추가 조회 0**을 위해 `Chatbot` 컬럼(`prodVersionId`)을 둘지 architect 판단(FR-EN2-2) |
````
**바꿀 내용**
````text
**공개 경로 추가 조회 0**을 위해 `Chatbot` 컬럼(`prodVersionId`)을 둘지 architect 판단(FR-EN2-2) **[확정] 운영 포인터는 `Chatbot.prodVersionId`, 스테이징·게이트·켜짐 메타는 `ChatbotEnvironment`(행은 끌 때도 유지 — 게이트 보존) · 두 포인터 모두 FK 없음(설계서 §3.1)** |
````

### D-15. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] EX-EN-11 — 켜기 중 진행 작업 판정 확정

**찾을 원문**
````text
EX-EN-11 | 모드 켜기 중 **TC 실행·증강 학습 진행 중** | 복원과 같은 판정(진행 중이면 `409` 또는 캡처만 — architect) |
````
**바꿀 내용**
````text
EX-EN-11 | 모드 켜기 중 **TC 실행·증강 학습 진행 중** | ~~복원과 같은 판정(진행 중이면 `409` 또는 캡처만 — architect)~~ **[확정] 허용 — 켜기는 자산을 쓰지 않는다(캡처만). 진행 중 작업은 초안 대상으로 끝난다 · RUNNING 예약·복원 잠금만 `409 ENV_SWITCH_BUSY`(설계서 §5.3)** |
````

### D-16. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] EX-EN-20 — 영구삭제 동반 삭제 확정

**찾을 원문**
````text
EX-EN-20 | 모드 켜진 챗봇 **영구삭제** | 포인터·이력 동반 삭제(사전검사 409 대상 아님 — 버전과 같은 규약, architect 확정) |
````
**바꿀 내용**
````text
EX-EN-20 | 모드 켜진 챗봇 **영구삭제** | 포인터·이력 동반 삭제(사전검사 409 대상 아님 — 버전과 같은 규약) **[확정] 환경 행·전환 이력·벡터 보존 저장소 3테이블 동반 삭제(16 → 19) · 사전검사 15종 불변 · 포인터 컬럼은 챗봇 행과 함께 삭제** |
````

### D-17. [환경 분리 요구사항 `docs/requirements/environment-separation.md`] §12 인계 — system-architect 행 완료 표식

**찾을 원문**
````text
| **`system-architect`** | ① **ADR-0039** 작성
````
**바꿀 내용**
````text
| **`system-architect`** | **✅ 완료(2026-09-25 — `docs/02-spec/environment-separation-설계.md` · ADR-0039 · `docs/02-spec/environment-separation-patches.md`)** ① **ADR-0039** 작성
````

---

## E. 선행 요구사항 문서 — No.40 인계 정정

### E-1. [예약 배포 요구사항 `docs/requirements/scheduled-deploy.md`] 경계 표(459행) — No.40 설계 완료

**찾을 원문**
````text
| **No.40 환경 분리**(미구현) |
````
**바꿀 내용**
````text
| **No.40 환경 분리**(~~미구현~~ **2026-09-25 설계 완료 — ADR-0039: 동작 `SWITCH_PROD_VERSION` 추가, 모드 켜진 챗봇은 준비 편집 운영 노출(P-2) 해소**) |
````

### E-2. [예약 배포 요구사항 `docs/requirements/scheduled-deploy.md`] 범위 밖(694행) — draft/published 해소

**찾을 원문**
````text
⚠ **P-2**에서 "준비 중 운영 노출 불가"로 결정되면 **No.40 우선 착수** |
````
**바꿀 내용**
````text
⚠ **P-2**에서 "준비 중 운영 노출 불가"로 결정되면 **No.40 우선 착수** **[2026-09-25] No.40 설계 완료 — 환경 모드 챗봇에서 해소(ADR-0039)** |
````

### E-3. [예약 배포 요구사항 `docs/requirements/scheduled-deploy.md`] 범위 밖(696행) — 실행 전 TC 게이트 트리거 발동

**찾을 원문**
````text
| 스냅샷 번들 TC 실행 모드가 다른 요구(No.40 등)로 생길 때 |
````
**바꿀 내용**
````text
| 스냅샷 번들 TC 실행 모드가 다른 요구(No.40 등)로 생길 때 **[2026-09-25 발동] No.40이 TC 실행 대상 차원을 만들어 운영 전환 게이트(경고 기본·챗봇별 차단)를 도입 — 자동 롤백은 여전히 없음(ADR-0039 §5)** |
````

### E-4. [버전 이력 요구사항 `docs/requirements/version-history.md`] J-14 — 경계 갱신 각주

**찾을 원문**
````text
| **J-14** | **No.40과의 경계** |
````
**바꿀 내용**
````text
| **J-14** | **No.40과의 경계** **[2026-09-25 — ADR-0039가 부분 대체: 환경·태깅·승격·전환 도입 · 라벨 무의미·타 챗봇 복원 없음 유지 · 환경 모드에서 복원 = 초안만]** |
````

### E-5. [통계/학습 요구사항 `docs/requirements/stats-learning.md`] 범위 밖(737행) — 버전별 비교의 1차 범위

**찾을 원문**
````text
A/B 테스트·버전별 성능 비교** | 챗봇 버전 개념이 미구현이다 | **No.25/No.40** |
````
**바꿀 내용**
````text
A/B 테스트·버전별 성능 비교** | 챗봇 버전 개념이 미구현이다 **[2026-09-25 No.40] 로그 `servedVersionId`로 서빙 버전 귀속만 1차 적재 — 비교 화면·비율 분할은 2차** | **No.25/No.40** |
````

---

## Z. 적용 후 확인 체크리스트

- [ ] A-1~A-52 · B-1~B-14 · C-1~C-6 · D-1~D-17 · E-1~E-5 각 "찾을 원문"이 적용 전 대상 파일에서 정확히 1회 검색되는지(0회 = 파일이 그 사이 바뀜 → 이 문서를 갱신 후 적용).
- [ ] 같은 줄에 앵커가 둘인 항목(개발명세서 §3 `ChatbotVersion` 행의 A-8·A-9, §4.1 권한 줄의 A-27·A-28)을 모두 적용한 뒤 각 줄의 표 셀 구조(`|`)가 유지되는지. 개발명세서 §2 표(A-1)·§2.2 표(A-2)·§3 표(A-4~A-11)·§4 표(A-19~A-23)·§4.1 표(A-25~A-28)·§5.1 표(A-35 — 5열)·§7 표(A-48~A-52)의 행이 열 개수를 유지하는지.
- [ ] 개발명세서 §3 엔터티 표에 `ChatbotEnvironment`·`EnvironmentSwitchLog`·`EmbeddingTextVector` 행이 `MessageFeedback` 행 바로 뒤에 순서대로 있는지. §3 "미도입 결정 16건" 머리와 ⑯ 항목이 함께 있는지. §6에 결정 40이 39 바로 뒤에 있는지. §6 결정 13·16·20·21·24·29·31·32·33·38 아래 "갱신(2026-09-25 — No.40)" 각주가 각 1개인지. §7 인덱스에 설계서·ADR-0039 행이 각 1개인지.
- [ ] `docs/01-requirements/기능요구사항.md` No.40 행(8열)·No.25·No.28 행의 열 개수가 표 머리와 같은지 · §4-1 사용자 확인 결과 인용 블록이 "No.40~47 전부 도입 확정(2026-09-25)"으로 바뀌었는지(C-4) · 주의 문단 앞에 기록용 표기가 1개인지(C-3).
- [ ] `docs/requirements/environment-separation.md` 머리 도입 상태(D-1)·§1.11 머리(D-2)·§11 머리의 **P-1~P-12 "확정(2026-09-25, 추천안)" 표기(D-3)**가 있는지 · FR 표(FR-0-154·157·158, FR-EN2-2·EN3-2·EN4-1·EN6-1·EN8-1·EN8-4·EN8-5)·§5.2 표·EX 표(EX-EN-11·20)·§12 표의 셀 구조가 깨지지 않는지 · 취소선이 셀 구조를 깨지 않는지.
- [ ] ADR-0031·0032·0037·0024·0029·0015·0016·0002·0033·0019·0008·0011 끝에 "갱신 (2026-09-25 — No.40 …)" 절이 각 1개인지. `scheduled-deploy-설계.md` §5.6 표(B-13)·L-1 행(B-14)의 셀 구조가 유지되는지.
- [ ] `CLAUDE.md`의 "보완 8종(No.40~47)은 … §4-1에서 사용자 확인 대기 중(단 No.44는 2026-09-25 도입 확정)" 문구와 "구현 완료 기능"·"다음 단계" 줄은 **이 패치의 범위가 아니다** — 에이전트는 `CLAUDE.md`를 수정하지 않으며, No.40~47 전부 도입 확정 반영 여부는 사용자가 직접 결정한다.
- [ ] `docs/03-design/UIUX_준수기준.md`의 "환경 배지 텍스트 필수 · 위험 동작(운영 전환·롤백·끄기) 확인 창 규칙 · 비활성 버튼 사유 `aria-describedby`" 보강과 환경 화면 정보구조(배포 그룹 4번째 탭 여부)는 **ui-designer 단계**에서 한다(개발명세서 §5 접근성 문단에 원칙을 먼저 기록했다 — A-31).
- [ ] `docs/04-test/시험항목.md`에 TC-40(AC-EN1~EN8)을 추가하고, 동점 노드·동점 의도 예문·동점 FAQ 픽스처 · 의미 색인 오염 시험 픽스처(목 provider 결정적 벡터) · 게이트 판정 표 · 2인스턴스 전환 반영 시험(동적 import 앱 2개)을 `시험데이터.md`·`자동시험_전략.md`에 추가하는 일은 **test-automation 단계**에서 한다.
- [ ] `docs/05-ops/자동배포.md`에 ① 커밋 ①(서빙 준비 — 마이그레이션 `…_version_tiebreak`) 선행 배포와 기존 시험 무수정 통과 게이트 ② 마이그레이션 ② 적용 후 확인(부분 유니크 4개·새 테이블 3·인덱스 3·`prodVersionId IS NOT NULL` 0행·`PRAGMA foreign_key_check`) · 100만 로그 행 DB 소요 실측 ③ **API 롤백 전 모드 켜진 챗봇 전부 끄기**(구버전 API는 초안을 서빙) 절차를 추가하는 일은 **deployment-engineer 단계**에서 한다.
- [ ] 코드 쪽 기대값 변경(설계서 §24.2 X-1~X-4)은 **구현 단계에서** 반영한다. 그 밖의 기존 시험이 깨지면 회귀로 취급한다(커밋 ①에서 깨지면 멈추고 보고).
- [ ] 코드 쪽 주석(`schema.prisma` `ChatbotVersion.trigger` 주석의 트리거 목록 · `DeploySchedule.action`·`targetVersionId` 주석 "RESTORE_VERSION 전용" · `Chatbot` 역참조 주석 · `dialogue-bundle.cache.ts`/`dialogue-bundle.service.ts`의 "공개 대화·TC·비교·힌트·답변 설정 미리보기 6곳 공용" 주석 · `snapshot-envelope.ts`/`snapshot-hydrate.ts`의 "`updatedAt`을 제거/capturedAt으로 채운다" 주석(보조 필드 병기) · `version-sealing.spec.ts` V-7 주석의 "본문 참조 4곳" · `chatbots.service.spec.ts` 머리 주석 · `public-decorator-count.spec.ts` 머리 주석 · `security.ts` 권한 주석 "17종" · `required-permissions.ts` 머리 "신규 권한 0종")은 **구현 단계에서** No.40 내용으로 갱신한다.
