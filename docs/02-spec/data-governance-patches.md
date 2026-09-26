# No.45 데이터 거버넌스 — 기존 문서 패치 목록

> 작성: system-architect · 2026-09-26 · 근거: `docs/02-spec/data-governance-설계.md`, `docs/02-spec/decisions/ADR-0040-data-governance-mode-egress-gate-field-encryption-text-purge-and-audit-hash-chain.md`
> **적용 상태**: ✅ **적용 완료(2026-09-26, 94건)** — 오케스트레이터 세션이 항목마다 "찾을 원문 정확히 1회"를 확인한 뒤 기계적으로 적용한다.
> **적용 방법**: 각 항목의 "찾을 원문"을 대상 파일에서 **정확히 1회** 찾아 "바꿀 내용"으로 교체한다. 모든 원문은 2026-09-26 시점 파일(No.40 환경 분리 패치 적용 후)에서 복사했고, 문자열 검색(Grep `-o`/count)으로 대상 파일 안 유일성을 확인했다. "바꿀 내용"이 원문을 그대로 포함하는 항목은 append다(취소선 표기 항목은 원문을 `~~…~~`로 감싸 보존한다).
> **줄바꿈 주의**: 대상 파일은 CRLF일 수 있다. 모든 "찾을 원문"은 **한 줄 안의 부분 문자열**(줄바꿈 미포함)로 잡았다. "바꿀 내용"의 줄바꿈은 대상 파일의 줄바꿈으로 정규화한다.
> **순서 독립**: 어떤 "바꿀 내용"도 다른 항목의 "찾을 원문"을 새로 만들지 않는다. 같은 줄에 앵커가 둘인 항목은 없다.
> 코드 변경은 이 파일의 범위가 아니다 — 설계서 §2.5 체크리스트와 §21.2(의도된 시험 기대값 변경 닫힌 목록)를 따른다.
> 항목 수: 개발명세서 46 · ADR 9 · 기능요구사항 7 · 데이터 거버넌스 요구사항(PM 결정 기록 + 설계 반영) 22 · 선행 요구사항 인계 정정 9 · 운영 문서 1 = **94건**

---

## A. `docs/02-spec/개발명세서.md`

### A-1. [개발명세서 `docs/02-spec/개발명세서.md`] §2 워크스페이스 상태 표 — `governance` 행 추가

**찾을 원문**
````text
스냅샷 스키마 버전 1 유지(해시 밖 보조 필드)**(ADR-0039) |
````
**바꿀 내용**
````text
스냅샷 스키마 버전 1 유지(해시 밖 보조 필드)**(ADR-0039) |
| **`apps/api/src/governance`**(+ `common/governance`·`common/egress`·`common/crypto`) | **데이터 거버넌스 Phase에 신설**(No.45) — 서버 단위 모드(`DATA_GOVERNANCE_MODE`, 기본 OFF) · 기동 검증(저장 경로·출구 호스트·키링·옛 키 필요 행) · 출구 레지스트리 5클래스 + 송신 직전 게이트 · 필드 AES-256-GCM 봉투 3필드(상담 원문·상담 메시지·설문 자유 텍스트) · 보존 정책(전역 + 챗봇 재정의) + 파기 잡(대화 원천 = **텍스트 소거** · 호출/감사 로그 = 행 삭제) · 감사 해시 체인(헤드 CAS · 앵커 · 검증) · 열람(`@AuditView`)·내보내기 감사 · 데이터 지도. ★소거·재암호화·감사 삭제 쓰기 유일 파일 `governance-data.writer.ts`(미export) · 거버넌스 런타임 = 부트스트랩 1곳이 1회 설치하는 프로세스 전역 불변 상태. **`packages/dialogue-engine`·ml-worker·widget 변경 0건 · `@Public()` 8 유지 · 신규 권한·역할 0 · `packages/pii-mask` `PII_MASK_MODE` 선택 인자 · 선택 환경변수 18 + 키 2(스키마 밖)**(ADR-0040) |
````

### A-2. [개발명세서 `docs/02-spec/개발명세서.md`] §2.1 외부 HTTP 출구 규약 — 5클래스 정정 · 게이트

**찾을 원문**
````text
아웃바운드 HTTP가 0건임이 검증 가능하다.
````
**바꿀 내용**
````text
아웃바운드 HTTP가 0건임이 검증 가능하다. **[No.45 — 2026-09-26] 위 "4곳"은 로컬 증강 생성기(`augmentation/providers/local-augmentation.provider.ts` — ml-worker `/augment`)가 빠진 표기였다 — 서버의 외부 HTTP 출구는 5클래스(임베딩·RAG·Gemini·로컬 증강·레거시 — 레거시는 전송·DNS 파일 포함 6파일)이며 `common/egress/egress-registry.ts` 상수 1곳에 등록된다. 각 출구 파일은 송신 직전 `assertEgressAllowed()`/`checkEgress()`를 호출하고(거버넌스 모드 OFF = 파싱 없이 통과), 파일 집합·호출 수를 `governance-sealing.spec.ts` G-1·G-2가 단언한다(ADR-0040 §2).**
````

### A-3. [개발명세서 `docs/02-spec/개발명세서.md`] §2.1 공통 횡단 관심사 목록 — 거버넌스 부품 3종

**찾을 원문**
````text
(토큰버킷 store·순수함수 — No.12에 `conversation/`에서 승격).
````
**바꿀 내용**
````text
(토큰버킷 store·순수함수 — No.12에 `conversation/`에서 승격). **[No.45] `governance/governance-runtime.ts`(모드·출구 정책·암호화 켜짐 — 부트스트랩 1곳이 설치하는 전역 불변 상태, 미설치 = 현행 동작) · `egress/`(출구 레지스트리·허용 목록 판정) · `crypto/`(봉투·`sealField`/`openField`·암호화 대상 상수 · ★키 환경변수 읽기 유일 파일 `env-key.provider.ts`)는 Nest 모듈이 아닌 순수 모듈이다(ADR-0040 §1).**
````

### A-4. [개발명세서 `docs/02-spec/개발명세서.md`] §2.2 기능그룹별 모듈 배치 표 — No.45 행 추가

**찾을 원문**
````text
설계 완료 → `environment-separation-설계.md`** |
````
**바꿀 내용**
````text
설계 완료 → `environment-separation-설계.md`** |
| **데이터 거버넌스 (No.45)** | **`governance`(신규 — 데이터 지도·보존 정책·파기 이력 11 핸들러 · 부트스트랩(기동 검증·런타임 설치 유일 파일) · 파기 잡·암호화 잡(`PollingLoop` + `GovernanceJobState` 임대) · ★쓰기 유일 파일 `governance-data.writer.ts`(미export — jobs만 import) · export 0개)** + `common/{governance,egress,crypto}`(신규 순수 모듈) + `audit-logs`(`record()` 체인 트랜잭션 · `recordView/recordExport` · 검증기 · `POST /audit-logs/verify` · `@AuditView` 데코레이터·인터셉터) · `handoff`·`survey-responses`(쓰기 `sealField` · 행 id 선발급) · `handoff`·`stats/surveys`(읽기 `openField` · 소거 표식) · `stats/lib`(질문 순위 필터 `textPurgedAt`) · `learning`(소거 표식) · `embedding`·`rag`·`augmentation`·`legacy-api`(출구 게이트 · `EGRESS_BLOCKED`) · `api-connections`(저장 시 호스트 검사) · `validation`(TC 결과 내보내기 감사) · `chatbots`(동반 삭제 +1) | **설계 완료 → `data-governance-설계.md`** |
````

### A-5. [개발명세서 `docs/02-spec/개발명세서.md`] §2.2 주석 블록 — 모듈 의존 방향(No.45) 추가

**찾을 원문**
````text
`versions`·`embedding`은 `environment/**`를 import하지 않는다(보호 집합·배지는 Prisma 읽기 + 순수 함수).
````
**바꿀 내용**
````text
`versions`·`embedding`은 `environment/**`를 import하지 않는다(보호 집합·배지는 Prisma 읽기 + 순수 함수).
>
> **모듈 의존 방향(No.45)**: `governance → audit-logs(AuditLogService·AuditChainVerifier) · chatbots · common/{governance,egress,crypto,polling}` · `governance/jobs → governance/writer`(유일 import처) 단방향이다. **어떤 도메인 모듈도 `governance/**`를 import하지 않고 `GovernanceModule`의 export는 0개**라 공개 대화·상담·설문·통계·학습의 DI 그래프에 소거·재암호화·감사 삭제 경로가 없다. `audit-logs`는 `governance`를 import하지 않는다(체인 검증기는 `audit-logs` 소유). 출구·암호화 소비자는 순수 모듈 `common/egress`·`common/crypto`만 import한다(ADR-0040 §1).
````

### A-6. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `AuditLog` 행에 체인 컬럼

**찾을 원문**
````text
(ADR-0016, ADR-0034 §6) | 13, 26 |
````
**바꿀 내용**
````text
(ADR-0016, ADR-0034 §6) **[No.45] 해시 체인 `seq`(유일 — 커밋된 행에만)·`prevHash`·`rowHash`(`s1:`/`h1:<keyId>:` 접두 — SHA-256 또는 HMAC) — `record()` 1곳이 싱글턴 `AuditChainHead` CAS와 같은 트랜잭션에서 채우고 `createdAt`을 명시한다(경합 재시도 초과 시 체인 밖 기록 + 경고). 도입 전 행은 체인 밖(제네시스 앵커). 보존기간 파기(행 삭제 — 감사 하한 이상)는 `governance-data.writer.ts` 1파일 + `RETENTION` 앵커(ADR-0040 §5)** | 13, 26, 45 |
````

### A-7. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `ConversationLog` 행에 소거 표식

**찾을 원문**
````text
백필 없음(ADR-0039 §8)** | 14, 15, 22, 24, 27, 29, 30, 40, 44 |
````
**바꿀 내용**
````text
백필 없음(ADR-0039 §8)** **[No.45] `textPurgedAt`은 보존기간 파기로 `userMessage`·`botResponse`를 `""`로 소거한 시각이다 — 행·버킷·`sessionId`·`groupId`·매칭 id는 불변이라 수치 통계가 바이트 단위로 같고, 질문 순위만 공유 필터로 소거 행을 제외한다. 쓰기 = `governance-data.writer.ts` 1파일(로그 `update*` 봉인의 유일 예외) · 인덱스 `(chatbotId, textPurgedAt, createdAt)` · **행 삭제 0 유지**(ADR-0040 §4)** | 14, 15, 22, 24, 27, 29, 30, 40, 44, 45 |
````

### A-8. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `UnansweredQuestion` 행에 종결 항목 소거

**찾을 원문**
````text
— ADR-0038 §4** | 15, 44 |
````
**바꿀 내용**
````text
— ADR-0038 §4** **[No.45] 종결(`RESOLVED`·`IGNORED`) 항목은 보존기간 경과 시 `questionText`·`variants`를 소거하고 `questionNormalized`를 행마다 다른 대문자 센티넬 `#PURGED#<id>`로 바꾼다(유일 키 보존) · `textPurgedAt` · `PENDING`은 대상 아님 · 쓰기 파일 3 → 4(writer)(ADR-0040 §4)** | 15, 44, 45 |
````

### A-9. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `RagCallLog` 행에 보존

**찾을 원문**
````text
(ADR-0016과 같은 판단)** | 30 |
````
**바꿀 내용**
````text
(ADR-0016과 같은 판단)** **[No.45] 보존기간(`CALL_LOGS` — 전역)이 지나면 행 삭제(봉인 대상 아님 — 영구삭제 동반 삭제 선례)** | 30, 45 |
````

### A-10. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `SurveyAnswer` 행에 암호화·소거

**찾을 원문**
````text
쓰기 주체·삭제 봉인은 `SurveyResponse`와 같다 | 27 |
````
**바꿀 내용**
````text
쓰기 주체·삭제 봉인은 `SurveyResponse`와 같다. **[No.45] `textValue`는 거버넌스 모드의 필드 암호화 대상(봉투 `enc:v1:<keyId>:…` · AAD = 테이블:컬럼:행 id — 행 id 앱 선발급) · 보존기간 경과 시 `""` 소거 + `textPurgedAt`(선택·척도 행 불변 → 분포 통계 불변) · 쓰기 파일 1 → 2(writer)(ADR-0040 §3·§4)** | 27, 45 |
````

### A-11. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `ApiCallLog` 행에 보존·`EGRESS_BLOCKED`

**찾을 원문**
````text
자동 보존 정리 없음(No.45) | 26 |
````
**바꿀 내용**
````text
~~자동 보존 정리 없음(No.45)~~ **[No.45] 보존기간(`CALL_LOGS` — 전역) 경과 시 행 삭제 · 결과 코드 +1 `EGRESS_BLOCKED`(18 → 19 — 거버넌스 모드 호스트 허용 목록 밖, 송신 0)(ADR-0040 §2·§4)** | 26, 45 |
````

### A-12. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `HandoffMessage` 행에 암호화·소거

**찾을 원문**
````text
행 생성 후 유일한 갱신 = 원문 소거(정적 검사). 삭제 코드 0건 | 24 |
````
**바꿀 내용**
````text
행 생성 후 유일한 갱신 = 원문 소거(정적 검사). 삭제 코드 0건 **[No.45] `text`·`rawText`는 필드 암호화 대상(원문은 표시 판정을 통과한 행만 개봉) · 종료된 상담 메시지는 보존기간 경과 시 `text` `""` 소거 + `textPurgedAt` · 소거·재암호화 쓰기는 `governance-data.writer.ts`(H-2 쓰기 파일 1 → 2 · H-3 원문 소거 규칙 불변)(ADR-0040 §3·§4)** | 24, 45 |
````

### A-13. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — 신규 5엔터티 행 추가

**찾을 원문**
````text
`embedding-text-vector.service.ts` 1파일 · 영구삭제 동반 삭제 | 40 |
````
**바꿀 내용**
````text
`embedding-text-vector.service.ts` 1파일 · 영구삭제 동반 삭제 | 40 |
| **`RetentionPolicy`** | **보존기간 정책(No.45 — ADR-0040 §4).** 전역 1행(`scopeKey='GLOBAL'`) + 챗봇 재정의 N행(`scopeKey=chatbotId`, `chatbotId` 유일 · FK `Restrict`) · `days` JSON(종류별 일수 — 전역 키 없음 = 무기한 · 챗봇 키 없음 = 전역 따름, `null` = 무기한) · `pending` JSON(단축 유예 대기분 — 적용 시각 도래 후 유효) · 대상 6종(대화 원천 4종은 챗봇 재정의 가능, 호출/감사 로그는 전역만). 쓰기 = `retention-policy.service.ts` 1파일 · 행 없음 = 무기한 · 스냅샷·복사·토픽 분리 대상 아님 · 영구삭제 동반 삭제 | 45 |
| **`RetentionRun`** | **파기·백필·재암호화·체인 검증 실행 이력(No.45).** 묶음 `runId` · `kind`(`PURGE`·`BACKFILL`·`REENCRYPT`·`CHAIN_VERIFY`) · 대상 · 챗봇 · 일수 · 기준 시각 · 처리 건수 · 결과(`SUCCEEDED`·`PARTIAL`·`FAILED`)·사유 코드 · 체인 머리·앵커 seq · 인스턴스. **본문·행 id 목록·`sessionId` 컬럼 없음**(정적 검사) · 쓰기 = writer 1파일 · 감사 보존 기한으로 행 삭제 · FK 없음 | 45 |
| **`AuditChainHead`** | **감사 체인 머리 싱글턴(`id='HEAD'`, No.45).** `headSeq`·`headHash` — `record()`가 기대 seq 조건부 갱신(CAS)으로 전진시킨다(SQLite·Postgres 공통 — 잠금 불필요). 쓰기 = `audit-log.service.ts` 1파일 · 부팅 시 없으면 생성(`g1:genesis`) | 45 |
| **`AuditChainAnchor`** | **체인 앵커(No.45).** `GENESIS`(도입 시 1회 — 체인 이전 행 수·최대 시각) · `RETENTION`(보존 파기로 앞부분 삭제 시 마지막 삭제 행 seq·해시 — 최신 1행, 삭제와 같은 트랜잭션). 검증은 최신 앵커부터 | 45 |
| **`GovernanceJobState`** | **거버넌스 잡 상태(No.45 — `RETENTION`·`FIELD_CRYPTO`).** 임대 `claimToken`·`claimedAt`(CAS 선점 — 1인스턴스 실행) · `lastCompletedDay`(KST — `PARTIAL`이면 갱신 안 함) · `state` JSON(재암호화 커서·암호화 통계·v1 토큰 점검 결과 — 본문 0). 부팅 시 행 보장 | 45 |
````

### A-14. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 머리 — 16건 → 17건

**찾을 원문**
````text
> **미도입 결정 16건**
````
**바꿀 내용**
````text
> **미도입 결정 17건**
````

### A-15. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 ⑰ 신설 — 데이터 거버넌스 관련 미도입

**찾을 원문**
````text
초안과의 차집합만)로 해결한다(**ADR-0039**).
````
**바꿀 내용**
````text
초안과의 차집합만)로 해결한다(**ADR-0039**).
> ⑰ **대화 원천 롤업 테이블·소거 원문 보관(휴지통) 테이블·출구 차단 로그 테이블·키 id별 행 수 카운트 테이블·블라인드 인덱스 컬럼·열람 감사 전용 테이블·거버넌스 설정 테이블(모드·출구·암호화)·KMS 연동 테이블** — 대화 원천은 행을 지우지 않고 텍스트만 소거하므로 통계가 원천 1벌로 유지되고 롤업이 필요 없다. 소거는 불가역이 목적이다. 런타임 출구 차단은 레거시에서만 생기고 `ApiCallLog`가 기록한다. 키 사용은 기동 1회 접두 검색으로 충분하다. 블라인드 인덱스는 대화로그 본문 암호화(2차)와 함께다. 열람 감사는 `AuditLog`(같은 체인·보존)에 둔다. 모드·출구·암호화는 완화 방향 통제를 위해 **환경변수로만** 둔다(콘솔 저장소 없음). KMS는 `KeyProvider` 교체 지점 1곳으로 2차(**ADR-0040**).
````

### A-16. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 파생 데이터 동반 삭제 — 보존 재정의 1테이블

**찾을 원문**
````text
사전검사 목록(15종)은 불변이다(ADR-0002 갱신 각주, ADR-0039).
````
**바꿀 내용**
````text
사전검사 목록(15종)은 불변이다(ADR-0002 갱신 각주, ADR-0039). **[No.45] 챗봇 보존 재정의(`RetentionPolicy` 챗봇 행)도 동반 삭제다(19 → 20테이블 — 설정 데이터, `ChatbotHandoffSetting` 선례). 텍스트 소거는 행을 남기므로 "대화가 있었던 챗봇은 영구삭제 불가"(사전검사 409)는 그대로다(ADR-0002 갱신 각주, ADR-0040).**
````

### A-17. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 인덱스 — No.45 인덱스 추가

**찾을 원문**
````text
전부 `ADD COLUMN`/`CREATE`라 부분 유니크 4개에 영향이 없다(ADR-0039).**
````
**바꿀 내용**
````text
전부 `ADD COLUMN`/`CREATE`라 부분 유니크 4개에 영향이 없다(ADR-0039).** **[No.45] `conversation_logs(chatbotId, textPurgedAt, createdAt)` · `survey_answers(surveyId, textPurgedAt, answeredAt)` · `handoff_messages(chatbotId, textPurgedAt, createdAt)`(파기 대상 탐색 — 소거된 행을 다시 훑지 않게) · `audit_logs(seq)` 유일 · `retention_runs(kind, startedAt)`·`(chatbotId, startedAt)`. 암호문 컬럼에는 인덱스를 두지 않는다. 전부 `ADD COLUMN`/`CREATE`라 부분 유니크 4개에 영향이 없다(ADR-0040).**
````

### A-18. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 이력 행에 검증·체인

**찾을 원문**
````text
쓰기·수정·삭제 경로가 존재하지 않는다(append-only)** | 13 |
````
**바꿀 내용**
````text
쓰기·수정·삭제 경로가 존재하지 않는다(append-only)** **[No.45] `POST /audit-logs/verify`(`audit:read` — 기간 체인 검증, DB 변경 0) · 상세 `chain?` · 내보내기 `seq`·`rowHash` 2열 + 표식 행 2(`#CHAIN_HEAD`·`#CHAIN_VERIFY`) + `EXPORT` 감사 · 목록·상세 조회는 거버넌스 모드에서 `VIEW` 감사 · 목록 응답 불변. 보존기간 파기는 API가 아니라 파기 잡(감사 하한 이상)** | 13, 45 |
````

### A-19. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 데이터 거버넌스 행 신설

**찾을 원문**
````text
(모드 켜짐이면 서빙 버전·표시 설정 출처만 운영 버전) | 40 |
````
**바꿀 내용**
````text
(모드 켜짐이면 서빙 버전·표시 설정 출처만 운영 버전) | 40 |
| **데이터 거버넌스** | **`GET /governance/map`(데이터 지도 — 모드 OFF에서도 제공), `GET /governance/retention`·`PUT`(전역 정책 — 단축은 확인 문자열 + 유예), `POST /governance/retention/preview`(DB 변경 0), `POST /governance/retention/pending/cancel`, `GET /governance/retention/overrides`, `GET /governance/retention-runs` — 조회 `security:read`·저장 `security:write` · `GET/PUT /chatbots/:chatbotId/retention`·`POST …/retention/preview`·`POST …/retention/pending/cancel`(`chatbot:read` + `security:read｜write`) · `POST /audit-logs/verify`(`audit:read`)**. 총 12개 핸들러 · **`@Public()` 추가 0건 · 공개 대화 요청·응답 스키마 불변** | 45 |
````

### A-20. [개발명세서 `docs/02-spec/개발명세서.md`] §4 정정 이력 — 2026-09-26 항목 추가

**찾을 원문**
````text
④ 신규 `ApiErrorCode` 8종 · 공개 경로 8곳 불변(`environment-separation-설계.md` §19).
````
**바꿀 내용**
````text
④ 신규 `ApiErrorCode` 8종 · 공개 경로 8곳 불변(`environment-separation-설계.md` §19).
> **정정 이력(2026-09-26 — 데이터 거버넌스)**: ① **데이터 거버넌스 행을 신설**했다 — 전역 설정은 `/governance/*`, 챗봇 재정의는 챗봇 스코프 `/chatbots/:chatbotId/retention*`. ② 요구사항 초안의 `DELETE …/pending`은 동작 경로 관례에 맞춰 **`POST …/pending/cancel`** 로 확정했다. ③ 체인 검증은 이력 자원의 하위 동작 `POST /audit-logs/verify`로 두었다(DB 변경 0 — 본문 입력 때문에 POST). ④ 신규 `ApiErrorCode` 2종(확인 불일치·검증 범위는 기존 코드 재사용) · 공개 경로 8곳 불변(`data-governance-설계.md` §15).
````

### A-21. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 오류 봉투 — No.45 오류 코드 2종

**찾을 원문**
````text
공개 대화 경로는 이 코드를 쓰지 않는다(운영 버전 읽기 실패 = 폴백 턴) |
````
**바꿀 내용**
````text
공개 대화 경로는 이 코드를 쓰지 않는다(운영 버전 읽기 실패 = 폴백 턴) **[No.45] 2종 추가** — `EGRESS_HOST_NOT_ALLOWED`(400 — 거버넌스 모드에서 레거시 연결 호스트가 출구 허용 목록 밖)·`RETENTION_OUT_OF_RANGE`(400 — 보존 일수가 서버 하한 미만·상한 초과). 보존기간 단축 확인 불일치는 기존 `CONFIRM_NAME_MISMATCH`, 체인 검증 범위 초과는 기존 `AUDIT_RANGE_TOO_WIDE`를 재사용한다 |
````

### A-22. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 권한 — No.45 권한 보론

**찾을 원문**
````text
역할 4종 불변 · 긴급 차단은 기존 채널 닫기(`channel:write`) |
````
**바꿀 내용**
````text
역할 4종 불변 · 긴급 차단은 기존 채널 닫기(`channel:write`). **[2026-09-26 No.45] 데이터 거버넌스는 신규 권한·역할 0종이다** — 데이터 지도·보존 조회·파기 이력 = `security:read` · 보존 저장·유예 취소 = `security:write` · 체인 검증·감사 내보내기 = `audit:read`(전부 ADMIN). **모드·저장 경로·출구 허용 목록·필드 암호화·키·보존 하한·마스킹 강도 같은 완화 방향 설정은 환경변수로만** 바꾼다(콘솔은 읽기 표시만) |
````

### A-23. [개발명세서 `docs/02-spec/개발명세서.md`] §5 성능 — No.45 항목 추가

**찾을 원문**
````text
임베딩 호출 수 불변**(색인기 무변경 — ADR-0039).
````
**바꿀 내용**
````text
임베딩 호출 수 불변**(색인기 무변경 — ADR-0039).
  - **[신규 2026-09-26 — 데이터 거버넌스] 모드 OFF(기본)의 공개 대화·관리자 API 지연·응답 바이트·요청 경로 쿼리 수는 불변**이다(출구 가드·개봉·열람 인터셉터가 설치값 판정만). 모드 ON — 출구 판정 ≤0.1ms/호출(공개 대화 P95 +1% 이하) · 감사 기록(체인) P95 +5ms 이내 · 복호화 설문 50행·상담 스레드 +5ms · CSV 10,000행 ≤1초 · **파기·재암호화 중 공개 대화 P95 증가 20% 미만 · 대화 로그 적재 유실 0건**(배치 500 + 양보 200ms · 100만 행 소거 ≤30분 실측) · 체인 검증 10만 행 ≤5초(전체는 백그라운드) · 기동 검사 ≤2초(암호문 100만 행) · 데이터 지도 P95 1초(ADR-0040).
````

### A-24. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 레거시 시크릿 DB 암호화 재검토 결과

**찾을 원문**
````text
DB 암호화 저장은 No.45 필드 암호화와 함께 재검토한다(ADR-0034 §3).
````
**바꿀 내용**
````text
DB 암호화 저장은 No.45 필드 암호화와 함께 재검토한다(ADR-0034 §3). **[재검토 결과 2026-09-26 No.45] 1차 변경 없음** — DB에 값 0인 현행이 규제 관점에서 더 강하다. No.45 키링(`KeyProvider`)이 생겨 구독형 셀프서비스 요구 시 재사용할 확장점만 남긴다(ADR-0040).
````

### A-25. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — RAG 배포 전제조건에 출구 허용 목록

**찾을 원문**
````text
미충족 시 2단계는 구축형 고객사에 제공하지 않는다.
````
**바꿀 내용**
````text
미충족 시 2단계는 구축형 고객사에 제공하지 않는다. **[No.45] 거버넌스 모드 설치에서는 `RAG_BASE_URL` 호스트가 출구 허용 목록(`DATA_EGRESS_ALLOWED_HOSTS`)에 있어야 기동한다(목록 밖 = 기동 실패 — ADR-0040 §2).**
````

### A-26. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 로그 삭제 규약에 소거 예외

**찾을 원문**
````text
(롤업에 텍스트·세션 ID·의도 ID 없음).
````
**바꿀 내용**
````text
(롤업에 텍스트·세션 ID·의도 ID 없음). **[No.45] 보존기간 파기는 행을 지우지 않고 텍스트만 소거한다 — `LOG_DELETION_ALLOWLIST`는 빈 배열 그대로이고, R-10(로그 `update*` 0건)만 소거 서비스 1파일(`governance-data.writer.ts`)을 허용한다(ADR-0040 §4).**
````

### A-27. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 대화로그 무기한 알려진 리스크 해소

**찾을 원문**
````text
그때 ADR-0033 §3의 롤업 선적재 규약을 따른다.
````
**바꿀 내용**
````text
그때 ADR-0033 §3의 롤업 선적재 규약을 따른다. **[해소 2026-09-26 — No.45] 보존기간이 정책화됐다(전역 + 챗봇 재정의 · 하한 7일 · 기본 무기한 = 현행과 같음) — 기한이 지나면 `userMessage`·`botResponse`를 소거하고 행·수치는 남기므로 롤업 선적재가 필요 없다(ADR-0033 §3의 삭제 규약은 불변 · 행 삭제 0). 정보주체 파기 요청은 2차(ADR-0040).**
````

### A-28. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 설문 알려진 리스크 해소

**찾을 원문**
````text
무기한**이다 — 악화도 개선도 아니며 No.45에서 결정한다.
````
**바꿀 내용**
````text
무기한**이다 — 악화도 개선도 아니며 No.45에서 결정한다. **[해소 2026-09-26 No.45] 자유 텍스트는 보존기간 정책(`SURVEY_FREE_TEXT`)으로 소거되고 거버넌스 모드에서 필드 암호화된다(ADR-0040).**
````

### A-29. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 상담 알려진 리스크 해소

**찾을 원문**
````text
상담 메시지(마스킹본)의 보존기간도 무기한이다 — No.45.
````
**바꿀 내용**
````text
상담 메시지(마스킹본)의 보존기간도 무기한이다 — No.45. **[해소 2026-09-26 No.45] 종료된 상담 메시지는 보존기간 정책(`HANDOFF_TEXT`)으로 소거되고, 원문·메시지는 거버넌스 모드에서 필드 암호화된다 · 원문 60분 정책·`RAW_VIEW`는 불변(ADR-0040 §3).**
````

### A-30. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 데이터 거버넌스 봉인 항목 추가

**찾을 원문**
````text
`environment-sealing.spec.ts` **E-1~E-17**로 강제한다.
````
**바꿀 내용**
````text
`environment-sealing.spec.ts` **E-1~E-17**로 강제한다.
  - **[신규 2026-09-26] 데이터 거버넌스의 봉인(ADR-0040)**: ① 외부 HTTP 출구 파일 집합 = 레지스트리 상수(5클래스·6파일)이며 각 파일이 송신 직전 게이트를 호출한다 ② 거버넌스 런타임·마스킹 강도 설치 = 부트스트랩 1파일 · 키 환경변수 읽기 = `env-key.provider.ts` 1파일(키 값은 로그·오류·응답·감사·지도에 0 — 키 id만) ③ 암호화 봉인·개봉 호출 파일 닫힌 목록 ④ 대화 원천 소거·재암호화·호출/감사 로그 삭제·파기 앵커 쓰기 = `governance-data.writer.ts` 1파일(미export) · 쓰기 데이터 키 허용 목록 · **대화 원천 행 삭제 0 · `LOG_DELETION_ALLOWLIST` 빈 배열 유지** ⑤ 감사 체인 헤드 쓰기 = `audit-log.service.ts` 1파일 ⑥ 열람 감사 = 닫힌 목록 8핸들러의 데코레이터 · 내보내기 감사 3곳 ⑦ 파기 이력·감사 요약·데이터 지도에 본문·행 id·`sessionId` 0 ⑧ 위 전부를 `governance-sealing.spec.ts` **G-1~G-18**로 강제한다. **[알려진 한계]** 필드 암호화는 DB 파일·백업·덤프 유출을 막지만 서버·환경변수 장악은 막지 못한다 · 체인은 기록된 행의 무변조만 증명한다(누락 부재 아님) · `secure_delete`는 DB 페이지만 — 저널·백업 잔존은 **디스크 암호화 운영 전제**. 평가 원장(텍스트 없음)은 1차 보존 대상이 아니다.
````

### A-31. [개발명세서 `docs/02-spec/개발명세서.md`] §5 접근성/UI 품질 — 거버넌스 화면 원칙

**찾을 원문**
````text
(내부 용어 "포인터"·"스냅샷 번들" 금지).**
````
**바꿀 내용**
````text
(내부 용어 "포인터"·"스냅샷 번들" 금지).** **[No.45] 데이터 지도의 허용/차단·정상/불일치 상태는 텍스트 라벨 필수 · 보존기간 단축 확인 창은 초점 가두기·`Esc` 취소·재입력 필드 라벨·명시적 버튼 이름("보존기간 180일로 단축") · 미리보기 수치·유예 적용 시각은 표 형태 텍스트 · 저장 결과 `aria-live="polite"` 1회 · 소거 항목은 회색 글자만이 아니라 "보존기간 경과로 파기됨" 텍스트 · 화면 문구는 "데이터 거버넌스·데이터 지도·보존기간·파기·외부 전송·필드 암호화·무결성 검증"(내부 용어 "AAD"·"앵커"·"블라인드 인덱스"·"CAS" 금지).**
````

### A-32. [개발명세서 `docs/02-spec/개발명세서.md`] §5 확장성 — 다중 인스턴스 정합

**찾을 원문**
````text
낡은 항목이 새 포인터에 쓰일 수 없다.
````
**바꿀 내용**
````text
낡은 항목이 새 포인터에 쓰일 수 없다. **[No.45] 데이터 거버넌스의 다중 인스턴스 정합도 DB가 보장한다** — 파기·재암호화 잡은 `GovernanceJobState` 임대 CAS로 1인스턴스만 실행하고(재시작·임대 만료 시 커서·`PARTIAL`로 이어서), 감사 체인은 헤드 행 CAS로 한 번에 한 기록만 전진한다(Postgres에서도 잠금 불필요). 열람 감사 중복 억제는 인스턴스 로컬(중복 허용 — 누락보다 중복).
````

### A-33. [개발명세서 `docs/02-spec/개발명세서.md`] §5 DB 이식성 — 비파괴 마이그레이션·공통 문법

**찾을 원문**
````text
(테이블 재정의 0 — 부분 유니크 4개 보존).**
````
**바꿀 내용**
````text
(테이블 재정의 0 — 부분 유니크 4개 보존).** **[No.45] 소거·재암호화·앵커 갱신은 Prisma `updateMany`/`deleteMany`/`upsert`(원시 SQL 0 — `secure_delete`는 기존 격리 파일 재사용, 보유 파일 4 불변) · 체인 헤드는 기대값 조건부 갱신(SQLite·Postgres 공통) · 모든 스키마 변경은 `ADD COLUMN`/`CREATE TABLE`/`CREATE INDEX`(재정의 0 — 부분 유니크 4개 보존). Postgres 전환 시 `secure_delete`는 VACUUM 정책으로 대체(재검토 트리거).**
````

### A-34. [개발명세서 `docs/02-spec/개발명세서.md`] §5.1 환경변수 표 — No.45 20종 추가

**찾을 원문**
````text
| 버전 번들 코어·합성 캐시 각각의 항목 상한(10~500) |
````
**바꿀 내용**
````text
| 버전 번들 코어·합성 캐시 각각의 항목 상한(10~500) |
| **`DATA_GOVERNANCE_MODE`** | `apps/api/.env` | — | `OFF` | 데이터 거버넌스 모드 `OFF`｜`ON`(No.45 — 출구 집행·필드 암호화·열람 감사의 전제) |
| **`DATA_RESIDENCY_ALLOWED_DIRS`** · **`DATA_RESIDENCY_ALLOWED_DB_HOSTS`** | `apps/api/.env` | — | 없음 | 모드 ON 기동 시 `DATABASE_URL` 저장 경로(절대 경로·심볼릭 링크 해석)·원격 DB 호스트 허용 목록 |
| **`DATA_AT_REST_ENCRYPTION_DECLARED`** | `apps/api/.env` | — | `false` | 디스크 암호화 운영 자기 신고(애플리케이션은 검출 불가 — 데이터 지도 표시) |
| **`DATA_EGRESS_ALLOWED_HOSTS`** | `apps/api/.env` | — | 없음 | 외부 출구 허용 목록 `host[:port]`·`*.suffix[:port]`(모드 ON에서만 집행 · 루프백 자동 허용 없음 · 설정된 기본 URL이 목록 밖이면 기동 실패) |
| **`DATA_ENCRYPTION_ENABLED`** | `apps/api/.env` | — | `false` | 필드 암호화(모드 ON 필수) |
| **`DATA_ENCRYPTION_KEYS`** · **`AUDIT_CHAIN_KEY`** | `apps/api/.env` | — | 없음 | **zod 스키마 밖** — `<id>:<base64 32B>` 쉼표 키링(첫 항목 = 쓰기/서명 키). 읽는 곳은 `env-key.provider.ts` 1파일 · 값은 어디에도 출력하지 않는다 |
| **`DATA_REENCRYPT_JOB_ENABLED`** · **`DATA_REENCRYPT_BATCH_SIZE`** | `apps/api/.env` | — | `true` · `500` | 백필·재암호화 잡(키링이 있을 때만 시작) |
| **`RETENTION_MIN_DAYS_CONVERSATION`** · **`RETENTION_MIN_DAYS_AUDIT`** · **`RETENTION_MAX_DAYS`** · **`RETENTION_SHORTEN_GRACE_DAYS`** | `apps/api/.env` | — | `7` · `365` · `3650` · `7` | 보존 하한·상한·단축 유예(⚠ 하한은 법무 확인 전 기본값 — 감사 하한 365 미만은 기동 경고) |
| **`DATA_RETENTION_JOB_ENABLED`** · **`DATA_RETENTION_WINDOW`** · **`DATA_RETENTION_BATCH_SIZE`** · **`DATA_RETENTION_BATCH_PAUSE_MS`** · **`DATA_RETENTION_MAX_ROWS_PER_RUN`** | `apps/api/.env` | — | `true` · `02:00-05:00`(KST) · `500` · `200` · `500000` | 파기 잡 스위치·실행 창·배치·양보·1회 상한 |
| **`PII_MASK_MODE`** | `apps/api/.env` | — | `PARTIAL` | `FULL`이면 전화·이메일도 전량 치환(이후 적재분부터) |
````

### A-35. [개발명세서 `docs/02-spec/개발명세서.md`] §5.1 그룹별 주석 — No.45

**찾을 원문**
````text
seed는 변경하지 않는다(데모 챗봇은 모드 꺼짐).
````
**바꿀 내용**
````text
seed는 변경하지 않는다(데모 챗봇은 모드 꺼짐).
> **데이터 거버넌스 그룹(No.45)이 추가한 20개도 전부 선택이며 API 전용이다(ml-worker 변수 추가 0건).** 하나도 설정하지 않으면 모드 OFF · 보존 무기한 · 암호화 없음 · PARTIAL 마스킹으로 **현행과 같이** 동작한다(감사 체인은 항상 켜짐 — 부팅 시 헤드 행만 생긴다). 키 2종은 zod 스키마에 넣지 않는다(레거시 시크릿 선례). boolean은 전부 `envBoolean()`. 시험은 `jest.isolate-env.js`가 잡 2종을 끈다. seed는 변경하지 않는다.
````

### A-36. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 18(ADR-0013) — No.45 갱신 각주

**찾을 원문**
````text
상담원 발신은 마스킹 유지(ADR-0013 갱신 각주, ADR-0036 §6).
````
**바꿀 내용**
````text
상담원 발신은 마스킹 유지(ADR-0013 갱신 각주, ADR-0036 §6).
    - **갱신(2026-09-26 — No.45)**: 감수 비용 ①이 예고한 **`PII_MASK_MODE=FULL`**을 연다 — `maskPii(text, { mode })` 선택 인자 + 부트스트랩 1곳의 `configurePiiMaskMode()` 설치값(기본 PARTIAL = 현행 바이트 동일)이라 적용 지점 4종·저장 테이블 3종의 호출부 수정이 0이다. 거버넌스 모드의 저장 순서는 **금지어 → PII → 필드 암호화**(저장 직전 마지막 — 상담 원문·메시지·설문 자유 텍스트). 원문 예외는 넓히지 않는다(ADR-0013 갱신 각주, ADR-0040 §3).
````

### A-37. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 20(ADR-0015) — No.45 갱신 각주

**찾을 원문**
````text
개수 단언 2파일은 의도적으로 갱신한다(ADR-0015 갱신 각주, ADR-0039 §8).
````
**바꿀 내용**
````text
개수 단언 2파일은 의도적으로 갱신한다(ADR-0015 갱신 각주, ADR-0039 §8).
    - **갱신(2026-09-26 — No.45)**: 데이터 거버넌스는 **신규 권한·역할 0종**이다(PM 확정 P-4 (1)) — 설정·조회 = `security:write`/`security:read`, 체인 검증·감사 내보내기 = `audit:read`(ADMIN). 완화 방향 설정은 환경변수 전용. 감수 비용 1의 재검토 트리거(No.45)는 **발동 검토 결과 1차 미발동** — 감사 전용 역할(AUDITOR — 직무 분리)은 금융 고객 요구 확인 시 2차. `@Public()` 8·권한 18 불변(ADR-0015 갱신 각주, ADR-0040 §6).
````

### A-38. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 21(ADR-0016) — No.45 갱신 각주

**찾을 원문**
````text
NOOP·미리보기·보존 정리·벡터 보존은 기록하지 않는다(ADR-0016 갱신 각주, ADR-0039 §8).
````
**바꿀 내용**
````text
NOOP·미리보기·보존 정리·벡터 보존은 기록하지 않는다(ADR-0016 갱신 각주, ADR-0039 §8).
    - **갱신(2026-09-26 — No.45)**: ① **해시 체인** — `record()` 1곳이 싱글턴 헤드 CAS와 같은 트랜잭션에서 `seq`·`prevHash`·`rowHash`를 채운다(`createdAt` 명시 · 커밋 행에만 번호 · 경합 초과 시 체인 밖 기록 + 경고 · 모드 무관 항상). ② `AuditAction` **14 → 16**(`VIEW`·`EXPORT` — 파괴적 목록 불변 · `EXPORT`는 요약 액션) · `AuditTargetType` **21 → 27**(`ConversationLog`·`UnansweredQuestion`·`AuditLog`·`TestRun`·`RetentionPolicy`·`RetentionRun`). ③ **대안표의 "조회 이력도 기록 — 기각"을 부분 대체** — 거버넌스 모드에서 개인정보 원천 화면 **닫힌 목록 8핸들러**만 (열람자·대상·KST 일)당 1건, **선언적 데코레이터 + 인터셉터**(쓰기 감사의 인터셉터 기각 근거 3가지는 열람에 해당하지 않는다). `EXPORT`(CSV 3곳)는 모드 무관. ④ 감수 비용 6(무한 증가) 해소 — 보존기간 정책(감사 하한 365일 이상 · 행 삭제 + 체인 앵커). 파기 요약은 기존 `PURGE`(주체 system)(ADR-0016 갱신 각주, ADR-0040 §5·§7).
````

### A-39. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 34(ADR-0033) — No.45 갱신 각주

**찾을 원문**
````text
→ **ADR-0033**(+ ADR-0001·0002·0004·0015·0017 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0033**(+ ADR-0001·0002·0004·0015·0017 갱신 각주)
    - **갱신(2026-09-26 — No.45)**: 보존기간 파기는 **행을 지우지 않고 텍스트만 소거**한다(PM 확정 P-3 (a)) — 결정 3의 삭제 규약(단일 서비스 + 롤업 선적재)은 **불변이며 발동하지 않는다**(`LOG_DELETION_ALLOWLIST` 빈 배열 유지 · 재검토 트리거 ③ 미발동). L3 정적 검사 중 "로그 `update*` 0건"(R-10·F-10)만 소거 서비스 1파일(`governance-data.writer.ts` — 쓰기 키 허용 목록 `userMessage`·`botResponse`·`textPurgedAt`)을 허용하도록 개정하고, 설문·상담·큐 쓰기 파일 봉인에 같은 1파일을 더한다. 행·수치·`groupId`는 불변이라 누적 통계가 바이트 단위로 같고, 질문 순위는 공유 필터로 소거 행을 제외한다(ADR-0033 갱신 각주, ADR-0040 §4).
````

### A-40. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 35(ADR-0034) — No.45 갱신 각주

**찾을 원문**
````text
→ **ADR-0034**(+ ADR-0008·0013·0015·0016·0022·0030·0031 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0034**(+ ADR-0008·0013·0015·0016·0022·0030·0031 갱신 각주)
    - **갱신(2026-09-26 — No.45)**: 거버넌스 모드에서 레거시 연결 호스트는 **출구 허용 목록**의 적용을 받는다 — 저장 시 `400 EGRESS_HOST_NOT_ALLOWED`, 호출 시 **DNS 조회 전** 차단 → `ApiCallOutcome` `EGRESS_BLOCKED`(18 → 19 · 회로 분류 `NEUTRAL` · 송신 0). 호스트 허용은 DNS 후 주소 검사·절대 차단 대역을 **대체하지 않고 더한다**. 시크릿 저장 방식은 1차 불변(재검토 트리거 "No.45 필드 암호화 착수" → 검토 결과 미발동). `ApiCallLog`는 보존기간(`CALL_LOGS`) 경과 시 행 삭제(ADR-0034 갱신 각주, ADR-0040 §2).
````

### A-41. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 37(ADR-0036) — No.45 갱신 각주

**찾을 원문**
````text
→ **ADR-0036**(+ ADR-0002·0009·0011·0012·0013·0015·0016·0019·0023·0026·0030·0031·0032·0033 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0036**(+ ADR-0002·0009·0011·0012·0013·0015·0016·0019·0023·0026·0030·0031·0032·0033 갱신 각주)
    - **갱신(2026-09-26 — No.45)**: 원문 정책(상담 중 · 마스킹본과 다를 때 · 최대 60분 · 필드 소거 3겹 · 담당자·ADMIN · `RAW_VIEW`)은 **불변**이다. 거버넌스 모드에서 `rawText`·`text`는 AES-256-GCM 봉투로 저장되고(행 id 선발급 · AAD), 원문은 **표시 판정을 통과한 행만** 개봉한다(개봉 실패 = 원문 생략 · `RAW_VIEW` 없음). 대화 보기는 `VIEW`(마스킹본 열람 — 일 1건)도 남긴다. 종료된 상담 메시지는 보존기간 경과 시 `text` 소거. 감수 비용 ③(물리 잔존)은 **디스크 암호화 운영 전제**로 명문화(ADR-0036 갱신 각주, ADR-0040 §3).
````

### A-42. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 41 신설

**찾을 원문**
````text
(+ ADR-0002·0008·0011·0015·0016·0019·0024·0029·0031·0032·0033·0037 갱신 각주)
````
**바꿀 내용**
````text
(+ ADR-0002·0008·0011·0015·0016·0019·0024·0029·0031·0032·0033·0037 갱신 각주)

41. **데이터 거버넌스(No.45)의 레지던시·필드 암호화·보존/파기·감사 무결성·열람 감사·권한 확정(2026-09-26 — PM 확정, P-1~P-12 추천안)**: **① 거버넌스 모드 = 서버 단위 스위치**(기본 OFF) · 거버넌스 런타임(모드·출구 정책·암호화 켜짐)·마스킹 강도 = **부트스트랩 1곳이 1회 설치하는 프로세스 전역 불변 상태**(미설치 = 현행 동작 · 키는 `env-key.provider.ts` 1파일). **② 레지던시 = 저장 경로 기동 검증 + 외부 출구 5클래스 레지스트리 게이트(허용 목록 · 기동 검사 · 레거시 저장 400/호출 `EGRESS_BLOCKED` · 루프백 자동 허용 없음) + 운영 문서 + 데이터 지도**(P-1 (d)) — 임베딩 출구의 질의 원문 송신은 분류·승인·경고로 드러낸다(마스킹은 하지 않음). **③ 필드 암호화 1차 = 상담 원문·상담 메시지·설문 자유 텍스트**(P-2 (b)) — `enc:v1:<keyId>:<base64(iv‖ct‖tag)>` AES-256-GCM · AAD = 테이블:컬럼:행 id · 환경변수 키링(첫 키 = 쓰기) · 커서 재암호화/백필 잡 · 옛 키 필요 행 남으면 기동 실패 · KMS 2차. **④ 보존 = 전역 + 챗봇 재정의(대화 원천 4종) · 하한 대화 7일·감사 365일 · 단축 유예 7일 · 대화 원천은 텍스트만 소거(행·수치 보존 — 롤업 불필요 · `LOG_DELETION_ALLOWLIST` 빈 배열 유지) · 호출/감사 로그는 행 삭제**(P-3 (a)·P-5) — 쓰기 유일 파일 `governance-data.writer.ts` · 파기 잡 = `PollingLoop` + KST 창 + 임대. **⑤ 감사 해시 체인(모드 무관 항상) = `record()` 1곳 · 헤드 CAS · 커밋 행에만 번호 · HMAC(키 있을 때) · 제네시스/파기 앵커 · 검증 API + 주간 자동**(P-6). **⑥ `EXPORT` 항상(CSV 3곳) · `VIEW` 모드 ON(닫힌 목록 8핸들러 · 데코레이터 · 일 1건)**(P-10) · `AuditAction` 14 → 16. **⑦ 신규 권한·역할 0 · 완화는 환경변수만**(P-4 (1)) · `PII_MASK_MODE=FULL` 옵션(P-9). 신규 `ApiErrorCode` 2종 · 선택 환경변수 18 + 키 2 · 공개 경로 추가 0 · 엔진·위젯·ml-worker 변경 0. GPU **1 유지**(P-12). → **ADR-0040**(+ ADR-0002·0013·0015·0016·0022·0026·0033·0034·0036 갱신 각주)
````

### A-43. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — 설계서 행 추가

**찾을 원문**
````text
요구사항: `docs/requirements/environment-separation.md` |
````
**바꿀 내용**
````text
요구사항: `docs/requirements/environment-separation.md` |
| **`data-governance-설계.md`** | **데이터 거버넌스(No.45) — 모듈 배치(`governance` export 0 · 부트스트랩 설치 유일 파일 · 쓰기 유일 파일 writer 미export · `common/{governance,egress,crypto}` 순수 모듈) · ★거버넌스 런타임 = 전역 불변 상태 · Prisma 변경안(`AuditLog` 체인 3컬럼 · `textPurgedAt` 4테이블 · `RetentionPolicy`·`RetentionRun`·`AuditChainHead`·`AuditChainAnchor`·`GovernanceJobState` — 마이그레이션 1개·부분 유니크 4 보존) · shared-types(`governance.ts` 신설) · 기동 검증 순서 · ★출구 레지스트리 5클래스·게이트·차단 폴백·임베딩 원문 송신 처리 · ★필드 암호화(봉투·AAD·키링·커서 재암호화·상담 원문 × 열람 감사 상호작용) · 보존 정책(유효 일수·단축 유예·미리보기) · ★파기 잡(텍스트 소거·센티넬 키·`secure_delete`·통계 불변 논증) · ★감사 체인(헤드 CAS·앵커·검증) · 열람(데코레이터)·내보내기 감사 · 데이터 지도 · 권한 · 12개 엔드포인트·오류 2종 · **봉인 G-1~G-18** · 성능 예산 · **기본값 동작 불변 보장표** · 콘솔 인계 · 시험 포인트·**의도된 기대값 변경 8건(닫힌 목록)** · 알려진 제한 10건 · 요구사항 대비 해석 15건** | 요구사항: `docs/requirements/data-governance.md` |
````

### A-44. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — ADR-0040 행 추가

**찾을 원문**
````text
FR-EN1-\*~FR-EN9-\*, AC-EN1~EN8 |
````
**바꿀 내용**
````text
FR-EN1-\*~FR-EN9-\*, AC-EN1~EN8 |
| **`decisions/ADR-0040-data-governance-mode-egress-gate-field-encryption-text-purge-and-audit-hash-chain.md`** | **데이터 거버넌스 = 서버 단위 모드 · 거버넌스 런타임 전역 불변 상태(생성자 주입·`fetch` 래퍼 기각) · 레지던시 = 저장 경로 검증 + 출구 레지스트리 게이트(루프백 자동 허용·차단 로그 테이블 기각) · 필드 AES-256-GCM 봉투·AAD·환경변수 키링·커서 재암호화(DB 계층 암호화·패키지 신설·카운트 테이블 기각) · 보존 = 텍스트 소거형(행 삭제 + 롤업 기각 — `LOG_DELETION_ALLOWLIST` 빈 배열 유지) · 감사 해시 체인 = 헤드 CAS + 앵커(잠금·체인 실패 시 기록 포기 기각) · 열람 감사 = 선언적 데코레이터 · 신규 권한 0 · 완화는 환경변수만 · ADR-0016 대안표 2항·ADR-0033 §2 L3 부분 대체** | 요구사항 J-1~J-20, FR-0-161~171, FR-DG1-\*~FR-DG9-\*, AC-DG1~DG8 |
````

### A-45. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — ADR-0016 행에 부분 대체 표기

**찾을 원문**
````text
`AsyncLocalStorage` actor 전달 · `ApiCallLog` 분리
````
**바꿀 내용**
````text
`AsyncLocalStorage` actor 전달 · `ApiCallLog` 분리 · **[2026-09-26] ADR-0040이 부분 대체**: 해시 체인 · 닫힌 목록 열람 감사(`VIEW`)·내보내기 감사(`EXPORT`) · 보존기간 정책(무한 증가 해소)
````

### A-46. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — ADR-0033 행에 소거 예외 표기

**찾을 원문**
````text
대안 B/C/D·조회 시점 조인·감사 재귀속 기각**
````
**바꿀 내용**
````text
대안 B/C/D·조회 시점 조인·감사 재귀속 기각 · **[2026-09-26] ADR-0040: 보존 파기 = 텍스트 소거(행 삭제 0 · `LOG_DELETION_ALLOWLIST` 빈 배열 유지) — 로그 `update*` 0건 봉인만 소거 1파일 예외**
````

---

## B. 기존 ADR (결정 본문은 수정하지 않는다 — 파일 끝 append)

### B-1. [ADR-0002] `docs/02-spec/decisions/ADR-0002-permanent-delete-referential-integrity.md` — 동반 삭제 +1 · 사전검사 불변 (append)

**찾을 원문**
````text
`Chatbot.prodVersionId`는 FK가 없어 버전 동반 삭제 순서에 영향이 없다.
````
**바꿀 내용**
````text
`Chatbot.prodVersionId`는 FK가 없어 버전 동반 삭제 순서에 영향이 없다.


---

## 갱신 (2026-09-26 — No.45: 보존 재정의 동반 삭제 · 텍스트 소거는 사전검사를 바꾸지 않는다)

데이터 거버넌스(No.45, **ADR-0040 §4**). 결정 1~6은 불변이다.

- 챗봇 보존 재정의(`RetentionPolicy` 챗봇 행 — FK `Restrict`)는 **동반 삭제**다(19 → 20테이블 — 설정 데이터, `ChatbotHandoffSetting` 선례). 사전검사 목록(15종)은 불변이다.
- 보존기간 파기는 대화 원천의 **텍스트만 소거**하고 행을 남긴다 — "대화가 있었던 챗봇은 영구삭제 불가"(사전검사 409 — 누적 통계 보존 장치)는 파기 후에도 그대로다. 로그 포함 영구삭제는 여전히 불허(No.29 P-2).
````

### B-2. [ADR-0013] `docs/02-spec/decisions/ADR-0013-pii-masking-policy-and-placement.md` — `PII_MASK_MODE` · 저장 직전 암호화 (append)

**찾을 원문**
````text
물리 잔존(저널·백업)·보존기간은 No.45.
````
**바꿀 내용**
````text
물리 잔존(저널·백업)·보존기간은 No.45.


---

## 갱신 (2026-09-26 — No.45: 감수 비용 ①의 `PII_MASK_MODE` 이행 · 저장 직전 필드 암호화 · 원문 예외 불변)

데이터 거버넌스(No.45, **ADR-0040 §3·§1**). 정책(대상·차등)·함수 1벌·순서(금지어 → PII)는 **불변**이다.

1. **`PII_MASK_MODE=PARTIAL｜FULL`**(기본 PARTIAL) — 감수 비용 ①이 남겨 둔 시그니처를 연다. `maskPii(text, options?: { mode })`의 기본값은 부트스트랩 1곳이 `configurePiiMaskMode()`로 설치하는 값이라 적용 지점 4종·저장 테이블 3종의 **호출부 수정이 0**이다. FULL = 전화 `[전화번호]`·이메일 `[이메일]` 전량 치환. PARTIAL은 도입 전과 바이트 동일. 변경은 이후 적재분에만(과거 행 재마스킹 없음).
2. **저장 순서 확장**: 거버넌스 모드의 필드 암호화 대상(상담 원문·상담 메시지·설문 자유 텍스트)은 **금지어 → PII → AES-256-GCM 봉인**(저장 직전 마지막) 순서다. 마스킹 판정(`masked !== raw` → 원문 보관 여부)은 평문 기준 그대로다.
3. **원문 예외(No.24 갱신 2항)는 넓히지 않는다** — 원문은 여전히 상담 중·최대 60분이며, 거버넌스 모드에서는 그 동안에도 DB에 봉투로만 존재하고 표시 판정을 통과한 행만 개봉한다.
4. **§6(이름·주소 미탐)의 보완**: 보존기간 정책(대화 원천 텍스트 소거)이 "마스킹이 놓친 개인정보가 무기한 남는" 리스크를 기한으로 제한한다. 공개 질의의 임베딩 송신은 여전히 비마스킹(의미 매칭 품질) — 출구 레지스트리가 `QUERY_RAW`로 분류하고 거버넌스 모드에서 호스트 승인·경고로 드러낸다.
````

### B-3. [ADR-0015] `docs/02-spec/decisions/ADR-0015-role-permission-model.md` — 신규 권한 0 · AUDITOR 2차 (append)

**찾을 원문**
````text
T-10)은 무력화하지 않고 18로 갱신한다.
````
**바꿀 내용**
````text
T-10)은 무력화하지 않고 18로 갱신한다.


---

## 갱신 (2026-09-26 — No.45 데이터 거버넌스: 신규 권한·역할 0종 · 완화는 환경변수 · AUDITOR는 2차)

데이터 거버넌스(No.45, **ADR-0040 §6**)는 **신규 권한·역할 0종**이다(PM 확정 P-4 (1)). 권한 18종·역할 4종·fail-closed 판정 순서·`@Public()` 8곳 불변.

- 데이터 지도·보존 조회·파기 이력 = `security:read` · 보존 저장·유예 취소 = `security:write` · 체인 검증·감사 내보내기 = `audit:read`(전부 ADMIN). 챗봇 재정의 경로는 `chatbot:read` AND `security:*`.
- **완화 방향 설정(모드·저장 경로·출구 허용 목록·필드 암호화·키·보존 하한·마스킹 강도)은 환경변수로만** — ADMIN 계정 하나로 감사 흔적 삭제·출구 개방·암호화 해제가 가능해지지 않게 한다.
- 감수 비용 1의 재검토 트리거(No.45)는 **검토 결과 1차 미발동**이다 — 감사 전용 역할(AUDITOR = `audit:read`+`security:read` — 직무 분리)은 역할 4 → 5의 매트릭스 전체 파급 때문에 금융 고객의 직무 분리 요구가 확인될 때 2차로 도입한다.
````

### B-4. [ADR-0016] `docs/02-spec/decisions/ADR-0016-audit-log-backfill-scope.md` — 체인 · 열람/내보내기 · 보존 (append)

**찾을 원문**
````text
(환경 감사 1건에 버전 번호로 포함 — 자동 스냅샷 비감사 선례).
````
**바꿀 내용**
````text
(환경 감사 1건에 버전 번호로 포함 — 자동 스냅샷 비감사 선례).


---

## 갱신 (2026-09-26 — No.45: 해시 체인 · `VIEW`/`EXPORT` · 대상 6종 · 대안표 2항 부분 대체 · 무한 증가 해소)

데이터 거버넌스(No.45, **ADR-0040 §5·§7**). 명시 호출·커밋 후 별도 쓰기·실패 흡수·화이트리스트·`RequestContextService.get()` 1곳 규약은 **불변**이다.

1. **해시 체인(모드 무관 항상)**: `AuditLog`에 `seq`(유일)·`prevHash`·`rowHash`. `record()` **1곳**이 한 트랜잭션에서 싱글턴 `AuditChainHead`를 읽고 `createdAt`을 **명시**한 뒤 정규 직렬화(고정 순서 배열 JSON v1)의 SHA-256(`AUDIT_CHAIN_KEY`가 있으면 HMAC-SHA256)을 계산해 헤드를 **기대 seq 조건부 갱신(CAS)** 으로 전진시키고 행을 삽입한다 — 번호는 커밋된 행에만 붙는다. 경합 재시도 초과 시 **체인 없이 기록 + 경고**(§4 "기록 실패 흡수"의 연장 — 행을 잃지 않는다). `auditLog.create` 호출 파일은 여전히 1개다.
2. **`AuditAction` 14 → 16**: `VIEW`(열람)·`EXPORT`(내보내기 — 요약 액션: 기간·행 수·필터 열거값만, `isBulkSummary` 분기에 추가). 둘 다 파괴적 목록 밖. **`AuditTargetType` 21 → 27**: `ConversationLog`·`UnansweredQuestion`·`AuditLog`·`TestRun`·`RetentionPolicy`·`RetentionRun`(전부 Prisma 모델명 — §9.3 규칙 유지). 보존기간 파기 요약은 기존 `PURGE`(주체 system · 대상 `RetentionRun`).
3. **대안표 "조회(READ) 이력도 기록 — 기각"을 부분 대체**: 거버넌스 모드에서 개인정보 원천 화면 **닫힌 목록 8핸들러**만 (열람자·대상·KST 일)당 1건 `VIEW`. 기록 기계는 **선언적 데코레이터 `@AuditView` + 인터셉터 1개**다 — §2가 인터셉터를 기각한 근거(① `beforeValue` 불가 ② 경로 파싱 추론 ③ 대량 요약 역추론)는 열람에 해당하지 않는다(대상은 데코레이터가 이름으로 지정 · before/after 없음). 쓰기 감사는 계속 명시 호출이다. `RAW_VIEW`(No.24)는 불변 — 같은 요청에서 `VIEW`와 함께 남을 수 있다.
4. **`EXPORT`는 모드 무관**: 감사로그·설문 결과·TC 결과 CSV 3곳(No.27 갱신의 "CSV 내보내기는 감사 대상이 아니다"를 대체). 자산 내보내기(FAQ·의도·키워드·TC 세트)는 대상 아님.
5. **대안표 "보존기간 정책·아카이브 배치를 지금 도입 — 기각" · 감수 비용 6(무한 증가) 해소**: 보존기간 정책(`AUDIT_LOGS` — 전역, 서버 하한 기본 365일 이상만)이 파기 잡으로 체인 앞부분을 연속 삭제하고 마지막 삭제 행을 `RETENTION` 앵커로 같은 트랜잭션에 남긴다. 감사 행 삭제 코드는 `governance-data.writer.ts` 1파일뿐이며 이력 API에는 여전히 쓰기·삭제 경로가 없다.
6. 감사 CSV: 기존 8열 뒤 `seq`·`rowHash` 2열 + 파일 끝 표식 행 2(`#CHAIN_HEAD`·`#CHAIN_VERIFY`). 상세 응답 `chain?`(값 있을 때만) · 목록 응답 불변.
````

### B-5. [ADR-0022] `docs/02-spec/decisions/ADR-0022-external-rag-allowlist-sealing.md` — 출구 게이트 공통 적용 (append)

**찾을 원문**
````text
개발명세서 §2.1의 "3곳"은 "4곳"으로 갱신된다.
````
**바꿀 내용**
````text
개발명세서 §2.1의 "3곳"은 "4곳"으로 갱신된다.


---

## 갱신 (2026-09-26 — No.45: 출구 레지스트리 게이트 공통 적용 · 출구 5클래스 정정)

데이터 거버넌스(No.45, **ADR-0040 §2**). 이 ADR의 결정(RAG 단일 출구·경로 allowlist 3·파괴적 문자열 0건·`provider` 상수)은 **불변**이다.

- 서버의 외부 HTTP 출구는 **5클래스**다(임베딩·RAG·Gemini·**로컬 증강**·레거시) — 위 "4곳"은 로컬 증강 생성기(`local-augmentation.provider.ts`)가 빠진 표기였다. 5클래스는 `common/egress/egress-registry.ts` 상수 1곳에 파일·설정·송신 데이터·마스킹 여부와 함께 등록된다.
- `RagHttpClient.send()`는 `fetch` 직전(기존 `try` 안) `assertEgressAllowed('RAG', url)`을 호출한다 — 거버넌스 모드 OFF = 파싱 없이 통과, ON에서 호스트가 허용 목록 밖이면 예외 → 기존 `catch`가 `{ networkError: true }`로 흡수(새 실패 모드 없음). 실제로는 `RAG_BASE_URL` 호스트가 목록 밖이면 **기동이 실패**하므로 런타임 차단은 방어 이중화다.
- `fetch(` 문자열은 이 클라이언트에 그대로 남는다(`rag-allowlist.spec.ts` 무변경). 출구 파일 집합·가드 호출 수는 `governance-sealing.spec.ts` G-1·G-2가 단언한다.
- "무인증·평문 = 배포 전 전제조건"은 불변이며, 거버넌스 모드 설치는 그에 더해 호스트 허용 목록 등록이 필요하다.
````

### B-6. [ADR-0026] `docs/02-spec/decisions/ADR-0026-augmentation-provider-three-ports.md` — 증강 2출구 게이트 (append)

**찾을 원문**
````text
구현체 추가로 흡수. 포트는 바뀌지 않는다.
````
**바꿀 내용**
````text
구현체 추가로 흡수. 포트는 바뀌지 않는다.


---

## 갱신 (2026-09-26 — No.45: G2·G3 출구 게이트 · 폴백 경로 불변)

데이터 거버넌스(No.45, **ADR-0040 §2**). 포트 1 + 구현 3종·모든 실패의 G1 수렴·강제 5단계는 **불변**이다.

- G2(Gemini)·G3(로컬)의 `fetch` 직전에 `assertEgressAllowed()`를 호출한다(Gemini는 URL에 키가 붙으므로 **기준 URL로 판정**하고 오류 메시지에 호스트만). 차단 예외는 기존 `catch`가 빈 배열(G1 폴백)·`healthy()=false`로 흡수한다 — 새 실패 모드 없음. 생성자·팩토리 무변경(가드는 전역 설치 정책을 읽는다).
- 거버넌스 모드에서 `AUGMENTATION_PROVIDER=gemini`(키 있음)이면 Gemini 호스트(기본 `generativelanguage.googleapis.com` — 상수 export)가, `local`이면 `AUGMENTATION_LOCAL_BASE_URL` 호스트가 출구 허용 목록에 있어야 **기동**한다.
- 데이터 지도는 G2 송신을 "예문 시드(마스킹)", G3 송신을 "예문 시드(마스킹 없음 — 관리자 자산 + 이미 마스킹된 학습 반영 예문)"로 표시한다.
````

### B-7. [ADR-0033] `docs/02-spec/decisions/ADR-0033-cumulative-stats-source-log-sealing-and-group-snapshot.md` — 텍스트 소거 1파일 · 삭제 규약 불변 (append)

**찾을 원문**
````text
환경 전환 이력(`EnvironmentSwitchLog`)은 운영 이력이지 대화 원천이 아니다 — 삭제·갱신 코드 0(영구삭제 동반 삭제만).
````
**바꿀 내용**
````text
환경 전환 이력(`EnvironmentSwitchLog`)은 운영 이력이지 대화 원천이 아니다 — 삭제·갱신 코드 0(영구삭제 동반 삭제만).


---

## 갱신 (2026-09-26 — No.45: 보존 파기 = 텍스트 소거 · 결정 3 삭제 규약 불변 · L3 "로그 `update*` 0건"의 소거 1파일 예외)

데이터 거버넌스(No.45, **ADR-0040 §4** — PM 확정 P-3 (a)). 결정 1·2(L1·L2)·3·4~8은 불변이다.

1. **보존기간 파기는 행을 지우지 않는다.** 대화 원천 4종(`ConversationLog`·`UnansweredQuestion` 종결 항목·`SurveyAnswer.textValue`·종료 상담 `HandoffMessage.text`)의 **텍스트만 `""`로 소거**하고 `textPurgedAt`을 채운다(미응답 큐 `questionNormalized`는 유일 키 보존을 위해 `#PURGED#<id>`). 행·버킷·`sessionId`·`groupId`·매칭 id·설문 선택/척도·상담 수치가 그대로라 **모든 수치 통계가 바이트 단위로 불변**이고 롤업 테이블이 필요 없다.
2. **결정 3(삭제 경로 = 단일 서비스 + 같은 트랜잭션 롤업 선적재)은 불변이며 이번에 발동하지 않는다.** `LOG_DELETION_ALLOWLIST`는 **빈 배열 그대로**다(R-4 불변). 재검토 트리거 ③(로그 삭제 경로 도입)도 미발동 — "행 자체 삭제" 규제 해석이 확정되면 그때 대안 B로 얹는다.
3. **L3 개정(유일한 예외)**: "로그 `update*` 0건"(R-10 · `feedback-sealing.spec.ts` F-10)은 **소거 서비스 1파일 `governance/writer/governance-data.writer.ts`** 만 허용한다 — 그 파일의 로그 `updateMany` data 키는 `userMessage`·`botResponse`·`textPurgedAt`로 정적 검사(G-8)가 제한한다. 설문(S-2)·상담(H-2)·큐(F-9) 쓰기 파일 봉인에도 같은 1파일만 추가된다. 삭제 0건(R-1·R-2·R-3·S-1·H-1·F-1)은 전부 유지.
4. **질문 순위의 원천 규칙 보강**: 공유 상수 `QUESTION_RANKING_LOG_FILTER`에 `textPurgedAt: null`을 더해 모든 스코프의 질문 순위에서 소거 행을 제외한다(기존 행은 전부 null — 수치 불변).
5. 소거 트랜잭션은 기존 `enableSecureDelete()`(No.24 격리 파일)를 재사용한다 — R-7 원시 SQL 보유 파일 4개 불변.
6. 감수 비용 2(대화로그 무기한)는 **해소**된다 — 기본값은 여전히 무기한(현행과 같음)이며 운영자가 정책을 정하면 기한이 생긴다.
````

### B-8. [ADR-0034] `docs/02-spec/decisions/ADR-0034-legacy-api-connection-registry-and-engine-suspension.md` — `EGRESS_BLOCKED` · 호스트 허용 목록 (append)

**찾을 원문**
````text
(`survey-sealing.spec.ts` S-9)로 더 정밀하게 유지된다.
````
**바꿀 내용**
````text
(`survey-sealing.spec.ts` S-9)로 더 정밀하게 유지된다.


---

## 갱신 (2026-09-26 — No.45: 출구 허용 목록 · `EGRESS_BLOCKED` · 시크릿 방식 1차 불변 · 호출 로그 보존)

데이터 거버넌스(No.45, **ADR-0040 §2·§4**). 결정 1~11은 불변이다.

1. **호스트 허용 목록은 주소 방어를 대체하지 않고 더한다**: 거버넌스 모드에서 연결 저장(생성·`baseUrl` 수정) 시 호스트가 `DATA_EGRESS_ALLOWED_HOSTS` 밖이면 `400 EGRESS_HOST_NOT_ALLOWED`. 호출 시 `LegacyApiHttpClient.send()`가 **DNS 조회 전** 판정해 목록 밖이면 `{ kind:'ERROR', outcome:'EGRESS_BLOCKED' }`(송신 0) — 이후 DNS 후 주소 검사·절대 차단 대역·사설 allowlist·리다이렉트 불추종은 그대로다. 전송 구현(`node-http.transport.ts`)도 `request` 직전 재판정(방어 이중화).
2. **`ApiCallOutcome` 18 → 19**(`EGRESS_BLOCKED`) · 회로 분류 `NEUTRAL`(설정 문제 — 인프라 실패로 세지 않는다) · 실패 분기/고정 문구 흐름 불변 · 시뮬레이터 목 실패 재현 값에 포함.
3. **시크릿 저장 방식은 1차 불변** — 재검토 트리거 "No.45 필드 암호화 착수"는 검토 결과 미발동(DB에 값 0이 더 강하다). No.45 키링(`KeyProvider`)이 구독형 셀프서비스 요구 시의 재사용 확장점이다.
4. 재검토 트리거 "`ApiCallLog` 1,000만 행 · No.45 착수 → 보존 자동 정리"를 **이행**한다 — 보존기간(`CALL_LOGS` — 전역) 경과 행을 파기 잡(`PollingLoop` 재사용)이 행 삭제한다.
5. §7(v1 평문 헤더)은 불변 — 자동 스크럽 없이 데이터 지도가 "평문 토큰 잔존 노드 수·스냅샷 수"를 점검 표시한다.
````

### B-9. [ADR-0036] `docs/02-spec/decisions/ADR-0036-hybrid-cs-handoff-thread-short-polling-and-transient-raw-text.md` — 암호화 · 보존 소거 · 물리 잔존 (append)

**찾을 원문**
````text
LLM 답변 제안·상담 요약 착수 → ADR-0026 포트 승격 · ADR-0022 allowlist 4번째 경로.
````
**바꿀 내용**
````text
LLM 답변 제안·상담 요약 착수 → ADR-0026 포트 승격 · ADR-0022 allowlist 4번째 경로.


---

## 갱신 (2026-09-26 — No.45: 상담 텍스트 필드 암호화 · 종료 상담 보존 소거 · 원문 표시와 열람 감사의 상호작용 · 물리 잔존 = 디스크 암호화 전제)

데이터 거버넌스(No.45, **ADR-0040 §3·§4·§7**). 결정 1~9, 특히 **원문 정책(상담 중 · 마스킹본과 다를 때 · 최대 60분 · 필드 소거 3겹 · 담당자·ADMIN · `RAW_VIEW`)은 불변**이다.

1. **필드 암호화**: 거버넌스 모드 + `DATA_ENCRYPTION_ENABLED`에서 `HandoffMessage.rawText`·`text`는 `enc:v1:<keyId>:…` AES-256-GCM 봉투로 저장된다(AAD = 테이블:컬럼:행 id — 쓰기 파일이 행 id 선발급). 마스킹·원문 보관 판정은 평문 기준 그대로이고 봉인은 저장 직전 마지막이다.
2. **원문 개봉 = 표시 판정 뒤**: 대화 보기는 `canViewRaw()`·행별 표시 조건을 **먼저** 판정하고 통과한 행만 원문을 개봉한다. 개봉 실패는 원문 키 생략(마스킹본만) — 원문이 실리지 않았으므로 `RAW_VIEW`도 남지 않는다.
3. **열람 감사의 두 층**: `RAW_VIEW`(원문 실제 노출 · (상담, 열람자)당 1건 · 모드 무관)는 불변. 거버넌스 모드에서는 같은 대화 보기가 `VIEW`(마스킹본 열람 · (열람자, 세션, KST 일)당 1건)도 남긴다 — 의미가 달라 둘 다 기록된다. 진행 중 목록·상담 상세도 `VIEW` 대상이다.
4. **원문 소거와 재암호화의 경합**: 재암호화 잡은 기존 값 조건부 갱신(CAS)이라 종료·정리 루프의 `rawText=null`이 항상 이긴다.
5. **보존 소거**: 종료된 상담의 메시지 `text`는 보존기간(`HANDOFF_TEXT`) 경과 시 `""`로 소거된다(행·seq·수치 유지 — 행 삭제 0 봉인 불변). 진행 중 상담은 대상 아님.
6. **감수 비용 ③(물리 잔존)**: `secure_delete`는 DB 페이지만 덮는다 — 저널·WAL·백업 잔존은 **디스크 암호화를 거버넌스 모드의 운영 전제**로 명문화하고, 데이터 지도는 이를 운영자 자기 신고값으로 보여 준다.
7. 재검토 트리거 "원문 60분 상한 부족·원문 열람 권한 위임 → No.45와 함께"는 **미발동** — No.45는 원문 정책을 넓히지 않았다.
````

---

## C. `docs/01-requirements/기능요구사항.md`

### C-1. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 No.45 행 — PM 확정 · 설계 완료 반영

**찾을 원문**
````text
| 45 | 거버넌스 | 규제산업向 데이터 레지던시/감사 강화 | 데이터 저장 위치 제한, 필드 단위 암호화, 감사로그 보존기간 정책화 등 금융/공공 규제 대응 옵션 | 1 | ○ | △ | watsonx Assistant 벤치마킹(규제산업 특화 거버넌스 강조). 36번(AI거버넌스·가드레일)이 "응답 안전성"이라면 이건 "데이터 거버넌스" |
````
**바꿀 내용**
````text
| 45 | 거버넌스 | 규제산업向 데이터 레지던시/감사 강화 | 서버 단위 **데이터 거버넌스 모드**(기본 꺼짐) — **저장 경로 기동 검증 + 외부 출구 5클래스 허용 목록**(레지던시) · **필드 암호화**(상담 원문·상담 메시지·설문 자유 텍스트 — AES-256-GCM·키 교체) · **보존기간 정책**(전역 + 챗봇별)·**자동 파기**(대화 원천 = 텍스트 소거·통계 수치 보존 · 호출/감사 로그 = 행 삭제)·파기 이력 · **감사 해시 체인**·열람/내보내기 감사 · 데이터 지도 | 1 | ○ | △ | **✅ PM 도입 확정(2026-09-25) · 범위·방식 확정(2026-09-26 — P-1~P-12 전부 추천안) · 설계 완료(`docs/02-spec/data-governance-설계.md` · ADR-0040).** 신규 권한·역할 0 · 완화 방향 설정(모드·출구·암호화·키·하한·마스킹 강도)은 환경변수만 · `@Public()` 추가 0 · 엔진·위젯·ml-worker 변경 0 · `PII_MASK_MODE=FULL` 옵션. **대화로그 본문 암호화(블라인드 인덱스)·KMS·정보주체 파기 요청·SIEM·감사 전용 역할은 2차 · 2인 승인은 No.36 · 멀티테넌시는 별도 그룹.** watsonx Assistant 벤치마킹(규제산업 특화 거버넌스 강조). 36번(AI거버넌스·가드레일)이 "응답 안전성"이라면 이건 "데이터 거버넌스" |
````

### C-2. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 사용자 확인 결과(106행) — No.45 범위·방식 확정

**찾을 원문**
````text
No.41~43·45~47은 도입만 확정됐고 범위·방식은 각 그룹 요구사항 단계에서 정한다.
````
**바꿀 내용**
````text
No.41~43·45~47은 도입만 확정됐고 범위·방식은 각 그룹 요구사항 단계에서 정한다. **[2026-09-26 갱신] No.45 데이터 거버넌스는 범위·방식까지 확정(요구사항 `docs/requirements/data-governance.md` §11 P-1~P-12 전부 추천안 · 설계 `docs/02-spec/data-governance-설계.md` · ADR-0040).**
````

### C-3. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §3 No.29 행 — 파기 방식 확정 각주

**찾을 원문**
````text
**로그 포함 영구삭제·보존기간 정리는 No.45 — 도입 시 삭제 전 롤업 적재 의무** |
````
**바꿀 내용**
````text
**로그 포함 영구삭제·보존기간 정리는 No.45 — 도입 시 삭제 전 롤업 적재 의무** **[2026-09-26 No.45 설계 완료] 보존기간 파기는 행을 지우지 않고 텍스트만 소거 — 수치 불변·롤업 불필요 · 로그 포함 영구삭제는 여전히 불허(ADR-0040)** |
````

### C-4. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §3 No.26 행 — 시크릿·로그 보존 결과

**찾을 원문**
````text
시크릿 DB 암호화·로그 보존은 No.45 |
````
**바꿀 내용**
````text
시크릿 DB 암호화·로그 보존은 No.45 **[2026-09-26 No.45 설계 완료] 호출 로그 보존기간 파기(행 삭제) · 연결 호스트 출구 허용 목록(`EGRESS_BLOCKED`) · 시크릿 DB 암호화는 1차 불변(환경변수 참조가 더 강함)(ADR-0040)** |
````

### C-5. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §3 No.27 행 — 보존·파기·암호화 결과

**찾을 원문**
````text
보존·파기는 No.45, 그룹·전역 설문 통계는 No.29 후속
````
**바꿀 내용**
````text
보존·파기는 No.45(**[2026-09-26 설계 완료] 자유 텍스트 보존기간 소거·필드 암호화·CSV 내보내기 감사 — 분포 통계 불변 · 작은 표본 비공개는 범위 밖, ADR-0040**), 그룹·전역 설문 통계는 No.29 후속
````

### C-6. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 No.44 행 — 자유 텍스트 사유 트리거 충족

**찾을 원문**
````text
자유 텍스트 사유는 No.45와 함께 · 엔진·ml-worker 변경 0 |
````
**바꿀 내용**
````text
자유 텍스트 사유는 No.45와 함께 · 엔진·ml-worker 변경 0 **[2026-09-26 No.45 설계 완료] 보존·소거·암호화 규약이 확정돼 자유 텍스트 사유(2차)는 "금지어 → PII → 암호화 → 보존 소거" 규약으로 받을 수 있다(트리거 충족 — 착수는 별도) · 평가 원장은 1차 보존 대상 아님(ADR-0040)** |
````

### C-7. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §3 No.24 행 — 보존·거버넌스 결과

**찾을 원문**
````text
보존·거버넌스 No.45 |
````
**바꿀 내용**
````text
보존·거버넌스 No.45 **[2026-09-26 설계 완료] 종료 상담 메시지 보존기간 소거 · 원문·메시지 필드 암호화 · 원문 정책(상담 중 60분·`RAW_VIEW`) 불변(ADR-0040)** |
````

---

## D. `docs/requirements/data-governance.md` — PM 결정 기록 · 설계 반영

### D-1. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] 머리 "도입 상태" — 범위·방식 확정

**찾을 원문**
````text
이 문서는 도입 여부를 묻지 않고 **범위와 방식만** 묻는다(§11).
````
**바꿀 내용**
````text
이 문서는 도입 여부를 묻지 않고 **범위와 방식만** 묻는다(§11). **[범위·방식 확정(2026-09-26, 추천안)] PM이 §11 P-1~P-12를 전부 추천안으로 확정했다 — 설계: `docs/02-spec/data-governance-설계.md` · ADR-0040.**
````

### D-2. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] §1.11 핵심 판단 표 머리 — PM 결정 표기

**찾을 원문**
````text
### 1.11 이 문서의 핵심 판단 20건 (⚠ = PM 확인 필요)
````
**바꿀 내용**
````text
### 1.11 이 문서의 핵심 판단 20건 (⚠ = PM 확인 필요)

> **PM 결정(2026-09-26)** — ⚠ 표시 항목을 포함해 아래 "결정(제안)" 열이 **전부 추천안대로 확정**되었다(§11 P-1~P-12). architect 확정 사항과 요구사항 대비 조정은 설계서 §1·§24에 있다: 거버넌스 런타임 = 부트스트랩 1곳이 설치하는 전역 불변 상태(설계서 §2.3) · 암호화 함수 위치 `common/crypto`(R-1) · 키 id 집계 = 기동 1회 접두 검색(R-2) · 오류 코드 신규 2종 + 기존 재사용(R-3) · 보존 정책 감사 대상 `RetentionPolicy`(R-4) · 체인 경합 초과 = 체인 밖 기록(R-6) · 열람 닫힌 목록 8핸들러·데코레이터(R-7) · 감사 CSV 2열 + 표식 행(R-8) · 유예 취소 `POST …/pending/cancel`(R-9) · 미응답 큐 소거 키 `#PURGED#<id>`(R-10) · 파기 감사 `PURGE` 재사용(R-11).
````

### D-3. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] §11 PM 확인 항목 — P 절 확정 표기

**찾을 원문**
````text
## 11. PM 확인이 필요한 항목
````
**바꿀 내용**
````text
## 11. PM 확인이 필요한 항목

> **PM 결정(2026-09-26) — 확정(2026-09-26, 추천안).** No.45 도입(2026-09-25) · P-1~P-12 전부 권고안 채택.
> - **P-1 (d)** 확정(2026-09-26, 추천안): 레지던시 = 기동 시 저장 경로 검증 + 외부 전송 통제(출구 5클래스 — 임베딩·RAG·Gemini·로컬 증강·레거시 — 허용 목록·기동 검사·호출 차단) + 운영 문서 + 콘솔 데이터 지도 · 임베딩 출구의 질의 원문(비마스킹) 송신은 분류·호스트 승인·경고로 드러낸다 · 물리 리전은 인프라 책임
> - **P-2 (b)** 확정(2026-09-26, 추천안): 1차 필드 암호화 = `HandoffMessage.rawText`(상담 원문) · `HandoffMessage.text`(상담 메시지) · `SurveyAnswer.textValue`(설문 자유 텍스트) · 대화로그·미응답 큐 본문은 2차
> - **P-3 (a)** 확정(2026-09-26, 추천안): 보존기간 경과 대화 원천 = 텍스트만 소거(행·통계 수치 보존) · 호출/감사 로그 = 행 삭제 · `LOG_DELETION_ALLOWLIST` 봉인(빈 배열)과 ADR-0033 유지
> - **P-4 (1)** 확정(2026-09-26, 추천안): 기존 `security:*`·`audit:read` 재사용 · 완화 방향 변경(보존 하한 우회·출구 개방·암호화 끄기 등)은 서버 설정(환경변수)으로만
> - **P-5** 확정(2026-09-26, 추천안): 전역 + 챗봇별 재정의(대화 원천 4종) · 하한 대화 7일·감사 365일(환경변수 기본값 — ⚠ 법무 확인) · 단축은 유예 7일 후 적용
> - **P-6** 확정(2026-09-26, 추천안): 감사 해시 체인 = HMAC(키 있을 때) + 앵커 + 검증 · 모드 무관 항상
> - **P-7** 확정(2026-09-26, 추천안): 환경변수 키링 + 재암호화 잡 · KMS 2차
> - **P-8** 확정(2026-09-26, 추천안): 켤 때 백필 잡 · 끄기 = 환경변수(기존 암호문은 키로 계속 읽음)
> - **P-9** 확정(2026-09-26, 추천안): `PII_MASK_MODE=FULL` 옵션(기본 PARTIAL) · 과거 행 재마스킹 없음
> - **P-10** 확정(2026-09-26, 추천안): 내보내기 감사 항상 · 열람 감사는 거버넌스 모드에서만 · (열람자·리소스·KST 일)당 1건
> - **P-11** 확정(2026-09-26, 추천안): 2차 = 대화로그 본문 암호화·KMS·정보주체 파기·SIEM·감사 역할 · 2인 승인은 No.36 · 멀티테넌시는 별도 그룹
> - **P-12** 확정(2026-09-26, 추천안): 데이터 지도는 모드 OFF에서도 읽기 제공 · GPU 1 · 구축형 ○ · 구독형 △
>
> 표 아래 "architect 확정 사항"의 결정은 설계서 §1 "(architect)" 행과 §24를 따른다.
````

### D-4. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] FR-0-168 — 오류 코드 확정

**찾을 원문**
````text
`AUDIT_CHAIN_RANGE_TOO_WIDE`(400). 신규 `ApiCallOutcome` 1종 `EGRESS_BLOCKED`. 오류 봉투 형식 불변 | ADR-0003 |
````
**바꿀 내용**
````text
`AUDIT_CHAIN_RANGE_TOO_WIDE`(400). 신규 `ApiCallOutcome` 1종 `EGRESS_BLOCKED`. **[확정 — 신규 2종: `EGRESS_HOST_NOT_ALLOWED` · `RETENTION_OUT_OF_RANGE`(하한·상한 겸용 — `RETENTION_BELOW_MINIMUM` 대체). 확인 불일치는 기존 `CONFIRM_NAME_MISMATCH`, 검증 범위 초과는 기존 `AUDIT_RANGE_TOO_WIDE` 재사용, `GOVERNANCE_MODE_DISABLED`는 모드 의존 콘솔 설정이 없어 미도입 — 설계서 §15.3]** 오류 봉투 형식 불변 | ADR-0003 |
````

### D-5. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] FR-0-169 — 기대값 변경 닫힌 목록 확정

**찾을 원문**
````text
| FR-0-169 | **의도된 기대값 변경은 architect가 닫힌 목록으로 확정**한다
````
**바꿀 내용**
````text
| FR-0-169 | **의도된 기대값 변경은 architect가 닫힌 목록으로 확정**한다 **[확정 — 설계서 §21.2 X-1~X-8: `AuditAction` 14 → 16(T-10) · R-10·F-10 로그 `update*` 허용 파일 1(writer) · F-9 3 → 4 · H-2 1 → 2 · S-2 1 → 2 · 영구삭제 트랜잭션 목 19 → 20 · 컨트롤러 등록 35 → 37(`@Public()` 8 불변) · `jest.isolate-env.js` 잡 2종 끔. `LOG_DELETION_ALLOWLIST`·원시 SQL 보유 파일 수·`ApiCallOutcome` 개수 단언 파일은 변경 0]**
````

### D-6. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] FR-DG3-1 — 와일드카드 확정

**찾을 원문**
````text
정확 일치 · 와일드카드는 architect 판단 — 권고: 선행 `*.` 접미 일치만)
````
**바꿀 내용**
````text
정확 일치 · 와일드카드는 ~~architect 판단 — 권고: 선행 `*.` 접미 일치만~~ **[확정] 선행 `*.` 접미 일치만(루트 도메인 자체는 별도 항목) · 포트는 항목에 있을 때만 비교 · IDN은 punycode 정규화 · 잘못된 항목은 기동 실패 — 설계서 §6.2**)
````

### D-7. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] FR-DG4-2 — 암호화 함수 위치 확정

**찾을 원문**
````text
(`packages/field-crypto` 또는 `apps/api/src/common/crypto` — architect)
````
**바꿀 내용**
````text
(~~`packages/field-crypto` 또는 `apps/api/src/common/crypto` — architect~~ **[확정] `apps/api/src/common/crypto`(소비자 1곳 — 패키지 승격 규약 미충족) · `sealField`/`openField` · 행 id 앱 선발급(AAD) — 설계서 §7.4**)
````

### D-8. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] FR-DG4-9 — 키 id 집계 방식 확정

**찾을 원문**
````text
비용은 architect: 키별 카운트 캐시 테이블 또는 기동 1회 집계)
````
**바꿀 내용**
````text
비용은 ~~architect: 키별 카운트 캐시 테이블 또는 기동 1회 집계~~ **[확정] 기동 1회 접두 검색(필드별 "알려진 키가 아닌 봉투" 1건 탐색 → 해당 키 행 수) — 카운트 테이블 기각 · 설계서 §5.3**)
````

### D-9. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] FR-DG5-3 — 범위 오류 코드 확정

**찾을 원문**
````text
하한 미만은 `400 RETENTION_BELOW_MINIMUM`.
````
**바꿀 내용**
````text
하한 미만은 ~~`400 RETENTION_BELOW_MINIMUM`~~ **`400 RETENTION_OUT_OF_RANGE`(상한 초과도 같은 코드 — 설계서 §8.3)**.
````

### D-10. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] FR-DG5-7 — 감사 대상 확정

**찾을 원문**
````text
(before/after = 대상별 일수 · 적용 시각 — 챗봇 재정의는 `Chatbot` 대상)
````
**바꿀 내용**
````text
(before/after = 대상별 일수 · 적용 시각 — ~~챗봇 재정의는 `Chatbot` 대상~~ **[확정] 전역·챗봇 모두 `RetentionPolicy` 대상(targetId = scopeKey · 챗봇 재정의는 `chatbotId` 채움) — 설계서 §8.3·§24 R-4**)
````

### D-11. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] FR-DG6-2 — `secure_delete` 재사용 확정

**찾을 원문**
````text
(ADR-0036 선례 — 원시 SQL 파일 재사용 여부는 architect)
````
**바꿀 내용**
````text
(ADR-0036 선례 — ~~원시 SQL 파일 재사용 여부는 architect~~ **[확정] 기존 `handoff-secure-delete.query.ts`의 `enableSecureDelete()` 재사용 · 원시 SQL 보유 파일 4 불변 · 미응답 큐 `questionNormalized` 소거값은 유일 키 보존을 위해 `#PURGED#<id>` — 설계서 §9.2·§9.3**)
````

### D-12. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] FR-DG6-8 — 파기 감사 액션 확정

**찾을 원문**
````text
신규 `AuditAction`이 필요한지(`PURGE` 재사용 vs `RETENTION`)는 architect.
````
**바꿀 내용**
````text
~~신규 `AuditAction`이 필요한지(`PURGE` 재사용 vs `RETENTION`)는 architect.~~ **[확정] 기존 `PURGE` 재사용(대상 `RetentionRun` · 주체 system) — `AuditAction`은 `VIEW`·`EXPORT`만 추가(14 → 16) · 설계서 §9.4·§11.1**
````

### D-13. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] FR-DG7-5 — 검증 범위 오류 코드 확정

**찾을 원문**
````text
초과 `400 AUDIT_CHAIN_RANGE_TOO_WIDE`)
````
**바꿀 내용**
````text
초과 ~~`400 AUDIT_CHAIN_RANGE_TOO_WIDE`~~ **`400 AUDIT_RANGE_TOO_WIDE`(기존 코드 재사용 · 행 수 상한 200,000도 같은 코드)**)
````

### D-14. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] FR-DG7-6 — 번호 부여 방식 확정

**찾을 원문**
````text
architect는 **번호를 커밋된 행에만 부여**하는 방식을 택한다.
````
**바꿀 내용**
````text
architect는 **번호를 커밋된 행에만 부여**하는 방식을 택한다. **[확정] 싱글턴 헤드 행의 기대 seq 조건부 갱신(CAS)과 행 삽입을 한 트랜잭션으로 — 실패하면 둘 다 롤백되므로 `seq` 결손 = 삭제의 증거 · 설계서 §10.3**
````

### D-15. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] FR-DG7-8 — 동시성·Postgres·폴백 확정

**찾을 원문**
````text
Postgres 전환 시 잠금 방식은 architect(C-5).
````
**바꿀 내용**
````text
Postgres 전환 시 잠금 방식은 architect(C-5). **[확정] 헤드 CAS라 Postgres에서도 잠금 불필요(SQLite·Postgres 공통) · 인스턴스 로컬 직렬화 + 재시도 5회 · 초과 시 기록을 포기하지 않고 **체인 없이 기록 + 경고**(검증이 `outOfChainRows`로 드러낸다 — 설계서 §10.3·§24 R-6)**
````

### D-16. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] FR-DG8-3 — 열람 닫힌 목록 확정

**찾을 원문**
````text
목록 추가는 architect가 설계서에서 닫는다.
````
**바꿀 내용**
````text
목록 추가는 architect가 설계서에서 닫는다. **[확정 — 8핸들러: 진행 중 목록 · 대화 보기 · 상담 상세 · 설문 응답 목록 · 설문 자유 텍스트 목록 · 미응답/부정 평가 상세 · 감사로그 목록 · 감사로그 상세. 기록 기계 = 선언적 데코레이터 `@AuditView` + 인터셉터 1개 — 설계서 §11.3]**
````

### D-17. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] FR-DG8-6 — CSV 동봉 형식 확정

**찾을 원문**
````text
(파일 끝 주석 행 또는 별도 헤더 — CSV 파서 호환은 architect)
````
**바꿀 내용**
````text
(~~파일 끝 주석 행 또는 별도 헤더 — CSV 파서 호환은 architect~~ **[확정] 기존 8열 뒤 `seq`·`rowHash` 2열 + 파일 끝 표식 행 2개(`#CHAIN_HEAD`·`#CHAIN_VERIFY` — 열 수 동일, 파서 호환) · 응답 헤더 방식 기각 — 설계서 §11.4**)
````

### D-18. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] §5.2 `EgressBlockLog` 행 — 미도입 확정

**찾을 원문**
````text
레거시는 `ApiCallLog`로 대체 가능(architect) |
````
**바꿀 내용**
````text
레거시는 `ApiCallLog`로 대체 가능(architect) **[확정] 미도입 — 런타임 차단은 레거시에서만 생기고 `ApiCallLog.outcome=EGRESS_BLOCKED`로 기록, 나머지 4클래스는 기동 검사가 사전 차단(설계서 §6.3). 신규 모델은 `RetentionPolicy`(단일 모델 · scopeKey PK)·`RetentionRun`·`AuditChainHead`·`AuditChainAnchor`·`GovernanceJobState`(설계서 §3.1)** |
````

### D-19. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] §5.4 API 표 — 유예 취소 경로 확정

**찾을 원문**
````text
| `DELETE /governance/retention/pending` | `security:write` | 단축 유예 취소 |
````
**바꿀 내용**
````text
| ~~`DELETE /governance/retention/pending`~~ **`POST /governance/retention/pending/cancel`**(동작 경로 관례 — 설계서 §15.1) | `security:write` | 단축 유예 취소 **[확정 — 챗봇 재정의도 `POST /chatbots/:chatbotId/retention/pending/cancel`·`…/retention/preview` · 재정의 목록 `GET /governance/retention/overrides` 추가 — 총 12 핸들러]** |
````

### D-20. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] §5.5 환경변수 — 루프백 포함 여부 확정

**찾을 원문**
````text
루프백 포함 여부는 architect)
````
**바꿀 내용**
````text
루프백 포함 여부는 architect **[확정] 루프백도 자동 허용하지 않는다 — 같은 서버 ml-worker도 명시(`127.0.0.1:8000` 등) · 키 2종(`DATA_ENCRYPTION_KEYS`·`AUDIT_CHAIN_KEY`)은 zod 스키마 밖(읽기 1파일) — 설계서 §3.4·§6.2**)
````

### D-21. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] EX-DG-3 — 루프백 확정

**찾을 원문**
````text
(자동 허용 여부는 architect — 권고: 자동 허용하지 않고 명시)
````
**바꿀 내용**
````text
(~~자동 허용 여부는 architect — 권고: 자동 허용하지 않고 명시~~ **[확정] 자동 허용하지 않고 명시 — 설계서 §6.2**)
````

### D-22. [데이터 거버넌스 요구사항 `docs/requirements/data-governance.md`] §12 인계 — system-architect 행 완료 표식

**찾을 원문**
````text
| **`system-architect`** | ① **ADR-0040** 작성
````
**바꿀 내용**
````text
| **`system-architect`** | **✅ 완료(2026-09-26 — `docs/02-spec/data-governance-설계.md` · ADR-0040 · `docs/02-spec/data-governance-patches.md`)** ① **ADR-0040** 작성
````

---

## E. 선행 요구사항 문서 — No.45 인계 정정

### E-1. [보안/이력 요구사항 `docs/requirements/security-audit.md`] 범위 밖(683행) — 감사로그 무한 증가 해소

**찾을 원문**
````text
운영 리스크로 명시하고 No.45로 이관(§9.1) |
````
**바꿀 내용**
````text
운영 리스크로 명시하고 No.45로 이관(§9.1) **[2026-09-26 No.45 설계 완료] 감사로그 보존기간 정책(서버 하한 기본 365일 이상 · 행 삭제 + 체인 앵커 — ADR-0040)** |
````

### E-2. [보안/이력 요구사항 `docs/requirements/security-audit.md`] 범위 밖(717행) — 무결성 해시 체인 도입

**찾을 원문**
````text
암호학적 무결성 증명은 규제 요건이 확정된 뒤 | No.45 |
````
**바꿀 내용**
````text
암호학적 무결성 증명은 규제 요건이 확정된 뒤 | No.45 **[2026-09-26 설계 완료] 해시 체인(HMAC 선택)·앵커·검증 API — 모드 무관 항상(ADR-0040 §5)** |
````

### E-3. [통합 통계 요구사항 `docs/requirements/integrated-stats.md`] 범위 밖(575행) — 파기 방식 확정

**찾을 원문**
````text
| 보존기간 정책 · 자동 정리 · 파기 요청 처리 | No.45. 도입 시 FR-I1-4 규약 준수 | No.45 착수 |
````
**바꿀 내용**
````text
| 보존기간 정책 · 자동 정리 · 파기 요청 처리 | No.45. 도입 시 FR-I1-4 규약 준수 | No.45 착수 **[2026-09-26 설계 완료] 보존 = 텍스트 소거(행·수치 보존 → FR-I1-4 롤업 규약 미발동 · `LOG_DELETION_ALLOWLIST` 빈 배열 유지) · 정보주체 파기 요청은 2차(ADR-0040)** |
````

### E-4. [설문관리 요구사항 `docs/requirements/survey-management.md`] 범위 밖(819행) — 응답 보존·파기

**찾을 원문**
````text
| **응답 삭제·제외 처리·보존기간·정보주체 파기** | J-12 · 봉인 | No.45 착수(롤업 선적재 규약) |
````
**바꿀 내용**
````text
| **응답 삭제·제외 처리·보존기간·정보주체 파기** | J-12 · 봉인 | No.45 착수(롤업 선적재 규약) **[2026-09-26 No.45 설계 완료] 자유 텍스트만 보존기간 소거(응답·답 행 삭제 0 — 분포 불변) · 필드 암호화 · 정보주체 파기는 2차(ADR-0040)** |
````

### E-5. [설문관리 요구사항 `docs/requirements/survey-management.md`] 범위 밖(828행) — 내보내기 감사 도입

**찾을 원문**
````text
| CSV 내보내기 감사 기록 | `EXPORT` 액션 선례 없음 | ⚠ P-13에서 "기록" 선택 · No.45 감사 강화 |
````
**바꿀 내용**
````text
| CSV 내보내기 감사 기록 | `EXPORT` 액션 선례 없음 | ⚠ P-13에서 "기록" 선택 · No.45 감사 강화 **[2026-09-26 No.45 설계 완료] `EXPORT` 액션 신설 — 설문 결과 CSV 내보내기는 모드 무관 항상 기록(기간·행 수 요약 · ADR-0040 §7)** |
````

### E-6. [하이브리드 CS 요구사항 `docs/requirements/hybrid-cs.md`] 경계 표(525행) — No.45 결과

**찾을 원문**
````text
| **No.45 거버넌스** | 보존기간·필드 암호화·원문 열람 권한 위임은 No.45 **[P-9] 상담 중 원문 열람과 그 감사는 이 그룹 범위(설계서 §9)** |
````
**바꿀 내용**
````text
| **No.45 거버넌스** | 보존기간·필드 암호화·원문 열람 권한 위임은 No.45 **[P-9] 상담 중 원문 열람과 그 감사는 이 그룹 범위(설계서 §9)** **[2026-09-26 No.45 설계 완료] 종료 상담 메시지 보존 소거 · 원문·메시지 필드 암호화(표시 판정 통과 행만 개봉) · 대화 보기 `VIEW` 감사(모드 ON) · 원문 열람 권한 위임·60분 연장은 범위 밖 유지(ADR-0040)** |
````

### E-7. [레거시 API 요구사항 `docs/requirements/legacy-api-integration.md`] 범위 밖(709행) — 호출 로그 보존 이행

**찾을 원문**
````text
| **`ApiCallLog`·`RagCallLog` 보존기간 자동 정리** | 행이 작음 · No.45 소관 |
````
**바꿀 내용**
````text
| **`ApiCallLog`·`RagCallLog` 보존기간 자동 정리** **[2026-09-26 No.45 설계 완료 — `CALL_LOGS` 전역 보존기간 경과 행 삭제(파기 잡 · ADR-0040)]** | 행이 작음 · No.45 소관 |
````

### E-8. [NLU/RAG 요구사항 `docs/requirements/nlu-rag-answering.md`] 범위 밖(774행) — `RagCallLog` 보존 이행

**찾을 원문**
````text
| **`RagCallLog` 보존기간 정책·정리 배치** | 스케줄러 인프라가 없다(선행 그룹과 동일 판단) | **No.45** |
````
**바꿀 내용**
````text
| **`RagCallLog` 보존기간 정책·정리 배치** | 스케줄러 인프라가 없다(선행 그룹과 동일 판단) | **No.45** **[2026-09-26 설계 완료 — `CALL_LOGS` 보존기간 파기(`PollingLoop` 재사용 · ADR-0040)]** |
````

### E-9. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] 범위 밖(685행) — 자유 텍스트 사유 트리거 충족

**찾을 원문**
````text
| **자유 텍스트 사유** | J-11 — 새 PII 저장소·보존기간 부재·누출 봉인 | **No.45** 보존·파기 정책 확정 |
````
**바꿀 내용**
````text
| **자유 텍스트 사유** | J-11 — 새 PII 저장소·보존기간 부재·누출 봉인 | **No.45** 보존·파기 정책 확정 **[2026-09-26 충족 — No.45 설계 완료: 금지어 → PII → 필드 암호화 → 보존 소거 규약 확정(ADR-0040). 착수는 No.44 2차 결정 사항]** |
````

---

## F. 운영 문서

### F-1. [자동배포 `docs/05-ops/자동배포.md`] §5.3 신설 — 데이터 거버넌스(No.45) 운영 요구

**찾을 원문**
````text
백필 완료 전에는 통합 통계 화면에 "과거 데이터 정리 중"(`backfillPending`) 안내가 표시된다.
````
**바꿀 내용**
````text
백필 완료 전에는 통합 통계 화면에 "과거 데이터 정리 중"(`backfillPending`) 안내가 표시된다.

### 5.3 데이터 거버넌스(No.45) 운영 요구 (2026-09-26 추가)

`data-governance-설계.md` · ADR-0040. 거버넌스 모드(`DATA_GOVERNANCE_MODE=ON`)를 켜는 설치(규제 고객 구축형)의 **운영 책임**이며 애플리케이션이 검출·보증하지 않는다.

1. **디스크·볼륨 암호화(전제)**: DB 파일·저널·WAL·같은 볼륨 백업이 있는 디스크를 암호화한다(BitLocker·LUKS·클라우드 볼륨 암호화). 적용 후 `DATA_AT_REST_ENCRYPTION_DECLARED=true`(데이터 지도는 이 값을 "운영자 신고값"으로만 표시). `secure_delete`는 DB 페이지만 덮으므로 파기의 물리 잔존은 이 전제로만 막힌다.
2. **저장 위치**: `DATABASE_URL`은 **절대 경로**(`file:/secure/chatbot/prod.db`) · `DATA_RESIDENCY_ALLOWED_DIRS`에 그 디렉터리 — 상대 경로·심볼릭 링크로 밖을 가리키면 기동 실패. 원격 DB면 `DATA_RESIDENCY_ALLOWED_DB_HOSTS`.
3. **출구 허용 목록 작성**: `DATA_EGRESS_ALLOWED_HOSTS`에 실제로 쓰는 호스트만(`127.0.0.1:8000`(같은 서버 ml-worker) · `rag.internal` · 레거시 연결 호스트 · 필요 시 `*.bank.internal`). 루프백도 자동 허용되지 않는다. 설정된 임베딩·RAG·증강 기본 URL 호스트가 목록 밖이면 **기동하지 않는다**(로그에 호스트·출구 이름). 임베딩 호스트가 같은 서버가 아니면 "질의 원문 외부 송신" 경고가 뜬다.
4. **ml-worker 모델 사전 배치**: 폐쇄망·거버넌스 설치는 모델을 미리 내려받아 두고 `HF_HUB_OFFLINE=1`로 기동한다(ml-worker 코드 변경 없음).
5. **키 생성·백업·교체**: `DATA_ENCRYPTION_KEYS="k1:<base64 32바이트>"`(예: `openssl rand -base64 32`), 체인 서명 키 `AUDIT_CHAIN_KEY` 동일 형식. **키 분실 = 암호문 영구 손실** — 키는 DB 백업과 **다른 매체**에 이중 보관한다. 교체: 새 키를 **앞에** 추가(`k2:…,k1:…`) → 재기동 → 데이터 지도 "k1 사용 행 0" 확인 → k1 제거 → 재기동(먼저 지우면 기동이 거부된다). 키 값은 로그·티켓·채팅에 붙이지 않는다.
6. **백업 보존**: 백업도 보존기간 정책을 따라야 한다 — 파기 창 이후에도 오래된 백업에 소거 전 텍스트가 남는다. 백업 보관 기간 ≤ 대화 보존기간 + 운영 여유를 권고하고, 백업 볼륨도 암호화한다.
7. **보존 하한**: `RETENTION_MIN_DAYS_CONVERSATION`(7)·`RETENTION_MIN_DAYS_AUDIT`(365)는 **법무 확인 전 기본값**이다 — 고객사 규정(예: 접속기록 보관 기간)으로 확정해 설정한다. 감사 하한을 365 미만으로 낮추면 기동 경고가 남는다.
8. **파기 창**: `DATA_RETENTION_WINDOW`(기본 KST 02:00-05:00)는 예약 배포·백업 시각과 겹치지 않게 둔다(겹쳐도 배치 양보로 동작하지만 지연된다).
9. **체인 머리 보관**: 부팅·파기 실행 로그의 `info` "체인 머리(seq·해시)" 줄과 감사 CSV의 `#CHAIN_HEAD` 행을 로그 수집 시스템·별도 보관소에 남긴다 — 키 없는 설치에서 전체 재계산 변조를 대조로 찾는 유일한 수단이다.
10. **롤백 금지 조건**: 필드 암호화를 켠 설치는 **API 구버전으로 롤백하지 않는다**(구버전은 봉투를 평문처럼 표시) — 전진 수정만. 다중 인스턴스는 전 인스턴스를 동시에 교체한다(구버전 인스턴스의 감사 행은 체인 밖으로 남는다).
11. **배포 후 확인**: 마이그레이션 `20260926120000_data_governance` 적용 후 부분 유니크 4종 존재 · 신규 테이블 5 · `PRAGMA foreign_key_check` 0행 · 데이터 지도에서 모드·출구 판정·체인 머리 확인.
````

---

## Z. 적용 후 확인 체크리스트

- [ ] A-1~A-46 · B-1~B-9 · C-1~C-7 · D-1~D-22 · E-1~E-9 · F-1 각 "찾을 원문"이 적용 전 대상 파일에서 **정확히 1회** 검색되는지(0회 = 파일이 그 사이 바뀜 → 이 문서를 갱신 후 적용). 특히 D-3의 `## 11. PM 확인이 필요한 항목`은 요구사항 문서 826행 1곳뿐인지, A-42의 결정 40 꼬리 문자열이 A-41(결정 37)과 겹치지 않는지 확인한다.
- [ ] 개발명세서 §2 표(A-1 — 2열)·§2.2 표(A-4 — 3열)·§3 표(A-6~A-13 — 3열)·§4 표(A-18·A-19 — 3열)·§4.1 표(A-21·A-22)·§5.1 표(A-34 — 5열)·§7 표(A-43~A-46 — 3열)의 행이 열 개수를 유지하는지. A-11의 취소선이 셀 구조를 깨지 않는지.
- [ ] 개발명세서 §3 엔터티 표에 `RetentionPolicy`·`RetentionRun`·`AuditChainHead`·`AuditChainAnchor`·`GovernanceJobState` 행이 `EmbeddingTextVector` 행 바로 뒤에 순서대로 있는지 · §3 "미도입 결정 17건" 머리와 ⑰ 항목이 함께 있는지 · §6에 결정 41이 40 바로 뒤에 있는지 · §6 결정 18·20·21·34·35·37 아래 "갱신(2026-09-26 — No.45)" 각주가 각 1개인지 · §7 인덱스에 설계서·ADR-0040 행이 각 1개인지.
- [ ] `docs/01-requirements/기능요구사항.md` No.45 행(8열)·No.24·26·27·29·44 행의 열 개수가 표 머리와 같은지 · §4-1 사용자 확인 결과 인용 블록 끝에 "No.45 … 범위·방식까지 확정" 문장이 1개인지(C-2).
- [ ] `docs/requirements/data-governance.md` 머리 도입 상태(D-1)·§1.11 머리(D-2)·§11 머리의 **P-1~P-12 "확정(2026-09-26, 추천안)" 표기(D-3)**가 있는지 · FR 표(FR-0-168·169, FR-DG3-1·DG4-2·DG4-9·DG5-3·DG5-7·DG6-2·DG6-8·DG7-5·DG7-6·DG7-8·DG8-3·DG8-6)·§5.2·§5.4·§5.5 표·EX 표(EX-DG-3)·§12 표의 셀 구조가 깨지지 않는지 · 취소선이 셀 구조를 깨지 않는지.
- [ ] ADR-0002·0013·0015·0016·0022·0026·0033·0034·0036 끝에 "갱신 (2026-09-26 — No.45 …)" 절이 각 1개인지. ADR-0026은 기존 파일 끝의 재검토 트리거 목록 다음에 붙는 것이 정상이다.
- [ ] `docs/05-ops/자동배포.md` §5.3이 §5.2 다음, 파일 끝 "⚠ §4의 헬스체크 기준" 주석 앞에 있는지.
- [ ] `CLAUDE.md`의 "구현 완료 기능"·"다음 단계"·"보완 8종 … 사용자 확인 대기 중" 문구는 **이 패치의 범위가 아니다** — 에이전트는 `CLAUDE.md`를 수정하지 않으며, 반영 여부는 사용자가 직접 결정한다.
- [ ] `docs/03-design/UIUX_준수기준.md`의 "불가역 동작(파기·보존 단축) 확인 창 규칙 · '파기됨' 텍스트 표시 · 상태 텍스트 라벨" 보강과 데이터 거버넌스 화면 정보구조(설정 메뉴 위치·탭 구성)는 **ui-designer 단계**에서 한다(개발명세서 §5 접근성 문단에 원칙을 먼저 기록했다 — A-31). 산출물 `docs/03-design/data-governance-ui-spec.md`.
- [ ] `docs/04-test/시험항목.md`에 TC-45(AC-DG1~DG8)를 추가하고, 시험 전용 키 픽스처(무작위 32바이트 — 저장소에 실제 키 커밋 금지) · 소거 전후 통계 스냅샷 비교 절차 · 체인 변조 픽스처(DB 직접 수정·중간 삭제·꼬리 삭제) · 파기 중 부하 측정 절차 · 2인스턴스 임대 시험(동적 import 앱 2개)을 `시험데이터.md`·`자동시험_전략.md`에 추가하는 일은 **test-automation 단계**에서 한다.
- [ ] `docs/04-test/오류검출_프로세스.md`에 "기동 실패 메시지(출구·저장 경로·키) 해석" 항목을 더하는 일은 **bug-triage/test-automation 단계**에서 한다.
- [ ] 코드 쪽 기대값 변경(설계서 §21.2 X-1~X-8 + `test-run.service.spec.ts` 픽스처 인자)은 **구현 단계에서** 반영한다. 그 밖의 기존 시험이 깨지면 회귀로 취급한다(커밋 ①에서 깨지면 멈추고 보고).
- [ ] 코드 쪽 주석(`schema.prisma` `AuditLog.action` 주석 "12종" · `ConversationLog.userMessage` 주석 "원문은 어디에도 남기지 않는다"(소거 표식 병기) · `HandoffMessage` 모델 주석 "유일한 갱신은 원문 소거"(writer 예외 병기) · `SurveyAnswer`·`SurveyResponse` 주석 "쓰기 주체 = SurveyResponseService 1파일" · `audit-log.service.ts` 머리 주석 "`prisma.auditLog.create`를 이 서비스 밖에서 호출하지 않는다"(체인 트랜잭션 병기) · `audit-logs.controller.ts` 머리 주석(verify는 DB 변경 0) · `stats-retention-sealing.spec.ts` R-4 주석(허용 목록 소비 코드 없음 — 소거 허용 목록은 R-10) · `question-ranking-filter.ts` 머리 주석 · `handoff-thread.service.ts` 머리 주석 "메시지 행의 유일한 갱신은 원문 소거뿐" · `public-decorator-count.spec.ts` 머리 주석(35 → 37) · `chatbots.service.spec.ts` 머리 주석 · 개발명세서 §2.1 "총 4곳")은 **구현 단계에서** No.45 내용으로 갱신한다.
