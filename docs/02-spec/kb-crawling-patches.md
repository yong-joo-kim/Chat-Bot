# No.43 지식베이스 자동 크롤링/동기화 — 기존 문서 패치 목록

> 작성: system-architect · 2026-09-27 · 근거: `docs/02-spec/kb-crawling-설계.md`, `docs/02-spec/decisions/ADR-0044-knowledge-base-sync-crawler-egress-change-detection-and-serial-external-rag-ingest.md`
> **적용 상태**: ✅ **적용 완료(2026-09-27, 69건)** — 오케스트레이터 세션이 항목마다 "찾을 원문 정확히 1회"를 확인한 뒤 기계적으로 적용한다.
> **적용 방법**: 각 항목의 "찾을 원문"을 대상 파일에서 **정확히 1회** 찾아 "바꿀 내용"으로 교체한다. 모든 원문은 2026-09-27 시점 파일(No.46 채널별 리치 메시지 패치 적용 후 · 커밋 `a1a66a9`)에서 복사했고, 문자열 검색으로 대상 파일 안 유일성을 확인했다. "바꿀 내용"이 원문을 그대로 포함하는 항목은 append다(취소선 표기 항목은 원문을 `~~…~~`로 감싸 보존한다).
> **줄바꿈 주의**: 대상 파일은 CRLF일 수 있다. 모든 "찾을 원문"은 **한 줄 안의 부분 문자열**(줄바꿈 미포함)로 잡았다. "바꿀 내용"의 줄바꿈은 대상 파일의 줄바꿈으로 정규화한다.
> **순서 독립**: 어떤 "바꿀 내용"도 다른 항목의 "찾을 원문"을 새로 만들지 않는다. 같은 줄에 앵커가 둘인 항목은 없다.
> 코드 변경은 이 파일의 범위가 아니다 — 설계서 §2.5(기존 코드 변경 목록)와 §17.3(의도된 시험 기대값 변경 닫힌 목록 X-1·X-2)을 따른다. **`CLAUDE.md`는 이 패치의 대상이 아니다**(작업 트리의 미커밋 수정 보존).
> 항목 수: 개발명세서 33 · ADR 6 · 기능요구사항 3 · 지식베이스 요구사항(PM 결정 기록 + 설계 반영) 21 · 선행 요구사항 인계 정정 3 · No.30 설계서 2 · 운영 문서 1 = **69건**

---

## A. `docs/02-spec/개발명세서.md`

### A-1. [개발명세서 `docs/02-spec/개발명세서.md`] §2 워크스페이스 상태 표 — `kb-sync` 행 추가

**찾을 원문**
````text
widget 변경(캐러셀·바로연결 렌더 — vanilla 유지)**(ADR-0043) |
````
**바꿀 내용**
````text
widget 변경(캐러셀·바로연결 렌더 — vanilla 유지)**(ADR-0043) |
| **`apps/api/src/kb-sync`**(+ `packages/shared-types` `kb-sync`) | **지식베이스 동기화 Phase에 신설**(No.43) — 전역 수집 소스(사내 HTML·사이트맵·링크된 PDF·DOCX·XLSX·PPTX · 무인증 또는 `KB_SECRET__<REF>` 고정 헤더) · 크롤러(7번째 출구 `KB_CRAWL` — No.26 SSRF 부품 세 번째 공유 · 리다이렉트 단계별 재검증 3회 · robots 준수) · 변경 감지(조건부 요청 → 정규화 본문 해시) · 바뀐 것만 외부 RAG 적재(`RagHttpClient` 경로 3 → 5 · 결정적 파일 이름 · 슬롯 임대 전역 직렬) · 원문 비저장 · 첫 회 미리보기 · 자동 삭제 없음("정리 필요") · 해석은 작업 스레드 샌드박스. **`packages/dialogue-engine`·ml-worker·widget·공개 대화 경로 변경 0 · `@Public()` 8 유지 · 신규 권한·역할 0 · 선택 환경변수 16 + 비밀 접두 규약 · 신규 의존성 3(순수 JS)**(ADR-0044) |
````

### A-2. [개발명세서 `docs/02-spec/개발명세서.md`] §2.1 외부 HTTP 출구 규약 — 7번째 클래스 · RAG 경로 +2

**찾을 원문**
````text
를 `workflow-sealing.spec.ts` W-2가 추가로 단언한다(ADR-0041 §6).**
````
**바꿀 내용**
````text
를 `workflow-sealing.spec.ts` W-2가 추가로 단언한다(ADR-0041 §6).** **[No.43 — 2026-09-27] 7번째 클래스 `KB_CRAWL`(지식베이스 크롤러) — 출구 파일 `kb-sync/crawl/kb-crawl-http.fetcher.ts`가 요청(리다이렉트 매 단계 포함)마다 DNS 조회 전 `checkEgress('KB_CRAWL', …)`를 호출하고 같은 전송·DNS 부품을 **세 번째 DI 토큰**으로 공유한다(전송 요청 선택 필드 `redirectMode`·`captureHeaders` — 기본값 = 현행). 외부 RAG 적재·작업 조회는 **새 출구가 아니라 `rag/rag-http.client.ts`의 경로 +2**(같은 `send()`·같은 가드 — 멀티파트 본문)다. 공유 부품 이동 트리거(ADR-0041)는 발동했으나 이동은 연기했다(ADR-0044 §6).**
````

### A-3. [개발명세서 `docs/02-spec/개발명세서.md`] §2.2 기능그룹별 모듈 배치 표 — No.43 행 추가

**찾을 원문**
````text
`apps/widget`(캐러셀·바로연결) | **설계 완료 → `channel-rich-messages-설계.md`** |
````
**바꿀 내용**
````text
`apps/widget`(캐러셀·바로연결) | **설계 완료 → `channel-rich-messages-설계.md`** |
| **지식베이스 동기화 (No.43)** | **`kb-sync`(신규 — 소스·실행·문서·메타 12 핸들러 + 챗봇 카드 1(컨트롤러 2) · ★`KbSource` 쓰기 유일 `kb-sources.service.ts` · ★실행·문서·적재 작업·임대 쓰기 유일 `core/kb-run.store.ts` · `PollingLoop` 1(예약 → 크롤 조각 → 적재 → 종결) · ★출구 파일 `crawl/kb-crawl-http.fetcher.ts` · ★비밀 읽기 유일 `crawl/kb-secret.resolver.ts` · 작업 스레드 추출기 · 순수 lib · export 0)** + `rag`(`RAG_PATHS` 3 → 5 · `ingest()`·`taskStatus()` · 응답 파서 3) · `legacy-api/transport`(선택 필드 2) · `legacy-api/lib/ip-policy`(라벨 인자) · `common/egress`(7번째 클래스) · `governance`(지도 `kbSources?` · 파기 writer +2) · `audit-logs`(화이트리스트 +1) · `packages/shared-types`(`kb-sync.ts` · 출구·데이터 종류·감사 대상·오류 코드) | **설계 완료 → `kb-crawling-설계.md`** |
````

### A-4. [개발명세서 `docs/02-spec/개발명세서.md`] §2.2 주석 블록 — 엔진 불가침(No.43) · 모듈 의존 방향(No.43)

**찾을 원문**
````text
공개 대화 경로는 허용 목록 테이블을 읽지 않는다(ADR-0043 §7).
````
**바꿀 내용**
````text
공개 대화 경로는 허용 목록 테이블을 읽지 않는다(ADR-0043 §7).
>
> **엔진 불가침(지식베이스 동기화 No.43)**: 이 그룹은 `packages/dialogue-engine`·`apps/widget`·`apps/ml-worker`·공개 대화 경로(`conversation/**`)를 **한 줄도 바꾸지 않는다**(FR-0-206). 수집·감지·적재는 전부 백그라운드 루프이고 2단계 답변은 기존 외부 RAG 질의 그대로다 — 새로 적재된 문서는 외부 RAG가 검색할 뿐이다. 네 영역에 `KbSource｜KB_SYNC｜KB_CRAWL｜kb-sync` 심볼 0을 정적 검사가 단언한다(ADR-0044 §1).
>
> **모듈 의존 방향(No.43)**: `kb-sync → rag(RagHttpClient) · chatbots(ChatbotScopeService) · audit-logs · prisma · config` + `legacy-api` 클래스 파일(전송·DNS·주소 판정 — 모듈 import 0, No.41 방식) + `packages/pii-mask` 단방향이고 **export는 0개**다. `RagGateService`·`RagCallLogService`·`RagAnswerService`는 주입하지 않는다(질의 슬롯·호출 로그와 분리). 거버넌스는 Prisma 읽기(지도) + writer 삭제(파기)만 하고 `kb-sync`를 import하지 않으며, `kb-sync`도 `governance/**`를 import하지 않는다(잡 임대는 동형 별도 파일 — G-10, ADR-0044 §7).
````

### A-5. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — 지식베이스 5테이블 행 추가

**찾을 원문**
````text
변경 감사(`UPDATE Chatbot` 전후 목록) · 영구삭제 동반 삭제 | 46 |
````
**바꿀 내용**
````text
변경 감사(`UPDATE Chatbot` 전후 목록) · 영구삭제 동반 삭제 | 46 |
| **`KbSource`** | **지식베이스 수집 소스(전역 — 챗봇 소속 아님, No.43 — ADR-0044 §1).** 이름(정규화 전역 유일) · 시작 주소 1~10 · 사이트맵 0~5 · 허용 호스트(파생) · 경로 접두·제외 글롭·잡음 줄 글롭(정규식 아님) · 쿼리 URL 허용 · 깊이·최대 페이지·파일 형식·파일 상한·요청 간격 · **적재 스코프 3단(필수)** · 주기(수동/매일/매주 KST) · 인증(없음/고정 헤더 — 헤더 이름 + 비밀 참조 이름만 · 값 = `KB_SECRET__<REF>`) · 마스킹·원본 파일 전달 옵션 · 권리 확인자·시각 · `configVersion`/`approvedConfigVersion`(첫 회 미리보기 승인) · 자동 강등 사유 · ★`activeRunId`(소스당 실행 1 — CAS) · 다음 실행 · 마지막 실행 캐시. 쓰기 1파일 · 감사(`KbSource`) · 스냅샷·복사·환경 밖 | 43 |
| **`KbDocument`** | **소스의 URL 단위 상태 + 크롤 프런티어(No.43).** 정규화 URL·해시(`(sourceId, urlHash)` 유일) · 종류 · 결정적 외부 파일 이름(`kb_<8>_<16>.<ext>`) · 상태(`ACTIVE`·`GONE`·`EXCLUDED`)·제외 사유·**정리 필요 사유**(외부에 옛 내용이 남은 경우만) · 없어짐 연속 횟수 · 마스킹된 제목 · **마지막 성공 적재와 짝인** ETag·Last-Modified·본문 해시·적재 지문·길이 · 진행 중 적재 1건(CAS) · 프런티어(실행·방문 상태·깊이·순번·관측 변경). **본문·파일 바이트 컬럼 없음**(정적 검사). FK `KbSource`(`Restrict`) · 소스 삭제 시 삭제 · 쓰기 1파일 | 43 |
| **`KbSyncRun`** | **동기화 실행 이력(No.43).** 소스 id·이름 스냅샷 · 종류(`PREVIEW`·`SYNC`·`FULL_RESEND`)·트리거(예약·수동·승인) · 상태 7종(`INTERRUPTED`는 조회 시점 판정 — 저장 안 함) · 크롤 임대 · 재개 횟수 · 크롤 수치 JSON(적재 수치는 작업에서 파생) · 상한 도달 · 중단 호스트 · 강등·실패 사유 코드. **본문·URL 쿼리 없음** · FK 없음(로그 규약) · 보존 `CALL_LOGS`(종단 행 삭제) · 쓰기 1파일 + 파기 writer | 43 |
| **`KbIngestJob`** | **문서별 외부 RAG 적재 작업(대기열 겸 기록, No.43).** 실행·소스·문서 id · 레인(`INCREMENTAL`·`BULK`) · 상태 9종 · 시도·다음 시도 · `not_found` 재전송 여부 · 슬롯 토큰 · **UUID 검증된** 외부 `task_id` · 제출·조회·완료 시각 · 파일 이름·해시·지문·길이·마스킹 건수 · 결과 코드(외부 오류 원문 없음). **`RagCallLog`에 기록하지 않는다** · FK 없음 · 보존 `CALL_LOGS`(종단 행) · 쓰기 1파일 + 파기 writer | 43 |
| **`KbJobLease`** | **지식베이스 잡 임대 행(No.43).** `INGEST_SLOT_0..2`(전역 직렬 적재 슬롯 — `KB_INGEST_CONCURRENCY`개만 선점) · `INGEST_STATUS`(외부 vLLM 준비 상태 표시 캐시 — 본문 0). `GovernanceJobState`와 같은 형식의 별도 테이블(G-10) · 부팅 시 행 보장 · 쓰기 1파일 | 43 |
````

### A-6. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 머리 — 20건 → 21건

**찾을 원문**
````text
미도입 결정 20건
````
**바꿀 내용**
````text
미도입 결정 21건
````

### A-7. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 ㉑ 신설 — 지식베이스 관련 미도입

**찾을 원문**
````text
새 저장소는 허용 도메인 목록 1:1 테이블뿐이다(**ADR-0043**).
````
**바꿀 내용**
````text
새 저장소는 허용 도메인 목록 1:1 테이블뿐이다(**ADR-0043**).
> ㉑ **수집 문서 원문·파일 저장 테이블(또는 디스크 캐시) · 우리 쪽 문서 청크·임베딩 색인 · 외부 RAG 작업 목록 미러 · 적재 시도별 이력 테이블 · 외부 삭제 요청 테이블 · 소스 단위 권한/담당자 · robots 캐시 테이블 · 소스당 활성 실행 부분 유니크 인덱스** — 원문은 적재 시점에 다시 받아 메모리에서만 다룬다(보존·암호화·파기·열람 감사 대상 0). 색인·청킹은 외부 RAG가 하며 우리 색인은 외부 RAG가 쓰지 않는다. 외부 작업 목록 API는 호출하지 않고(금지어) 문서별 작업 행이 기록이다. 외부 삭제는 봉인돼 있다. 동시 실행 제어는 소스 행·슬롯 행 CAS라 부분 인덱스가 필요 없다(원시 부분 유니크 4종 개수 불변 — **ADR-0044**).
````

### A-8. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 참조 무결성 예외 — 지식베이스 관계

**찾을 원문**
````text
**[No.46] `ChatbotRichUrlPolicy → Chatbot`도 `Restrict`이고 `updatedById`는 FK를 걸지 않는다(사실 기록 — ADR-0043).**
````
**바꿀 내용**
````text
**[No.46] `ChatbotRichUrlPolicy → Chatbot`도 `Restrict`이고 `updatedById`는 FK를 걸지 않는다(사실 기록 — ADR-0043).** **[No.43] `KbDocument → KbSource`는 `Restrict`(소스 삭제 서비스가 문서 행을 먼저 지운다)이고, `KbSyncRun`·`KbIngestJob`의 `sourceId`/`runId`/`documentId`와 `KbSource`의 `activeRunId`/`lastRunId`/`createdById`/`updatedById`/`approvedById`/`rightsConfirmedById`는 FK를 걸지 않는다 — 실행·작업은 소스가 지워져도 남는 사실 기록(이름 스냅샷 동반)이다(ADR-0044).**
````

### A-9. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 파생 데이터 동반 삭제 — 지식베이스는 전역

**찾을 원문**
````text
(23 → 24테이블). 사전검사 16종은 불변이다(ADR-0002 갱신 각주, ADR-0043).**
````
**바꿀 내용**
````text
(23 → 24테이블). 사전검사 16종은 불변이다(ADR-0002 갱신 각주, ADR-0043).** **[No.43] 지식베이스 테이블 5종(`KbSource`·`KbDocument`·`KbSyncRun`·`KbIngestJob`·`KbJobLease`)은 챗봇 참조가 없는 전역 자원이라 챗봇 영구삭제와 무관하다 — 동반 삭제 24테이블·사전검사 16종 불변(ADR-0044).**
````

### A-10. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 인덱스 — No.43

**찾을 원문**
````text
원시 부분 유니크 4개가 보존된다(적용 후 `sqlite_master` 4행 확인 — ADR-0043).**
````
**바꿀 내용**
````text
원시 부분 유니크 4개가 보존된다(적용 후 `sqlite_master` 4행 확인 — ADR-0043).** **[No.43] `kb_sources(nameNormalized)` 유일·`(enabled, nextRunAt)`(예약 선점)·`(updatedAt)` · `kb_documents(sourceId, urlHash)` 유일·`(sourceId, seenRunId, visitState, depth, discoveredSeq)`(프런티어)·`(sourceId, state)`·`(sourceId, cleanupReason)` · `kb_sync_runs(sourceId, createdAt)`·`(status, claimedAt)`(임대 회수)·`(createdAt)`(보존) · `kb_ingest_jobs(status, lane, nextAttemptAt, createdAt)`(작업 선택)·`(runId, status)`(진행률)·`(documentId, status)`·`(createdAt)`(보존) · `kb_job_leases` PK만. 소스당 활성 실행 1·전역 직렬은 **행 CAS**라 부분 인덱스를 두지 않는다 — 마이그레이션 `20260927150000_kb_crawling`은 `CREATE TABLE` 5 + `CREATE INDEX`뿐이라 원시 부분 유니크 4개가 보존된다(ADR-0044).**
````

### A-11. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 지식베이스 동기화 행 신설

**찾을 원문**
````text
(`{ channelType, source, outputs, changes }` — 스키마는 `'NOT_DEFINED'`과의 합집합)** | 42, 46 |
````
**바꿀 내용**
````text
(`{ channelType, source, outputs, changes }` — 스키마는 `'NOT_DEFINED'`과의 합집합)** | 42, 46 |
| **지식베이스 동기화** | **`GET /kb-sources`(목록) · `GET /kb-sources/meta`(전송 전제·외부 RAG 상태·형식·상한·실패 소스 수 — ⚠ `:id`보다 먼저 선언) · `POST /kb-sources`(등록 — 권리 확인 필수 · 호스트 판정) · `GET｜PATCH｜DELETE /kb-sources/:id`(범위 변경 = 다시 미리보기 · 실행 중 `409 KB_SOURCE_BUSY` · 삭제 = 우리 기록만) · `POST /kb-sources/:id/runs`(`{ kind: PREVIEW｜SYNC｜FULL_RESEND, acknowledgeCleanup? }` → `202`) · `POST /kb-sources/:id/approve-ingest`(`{ previewRunId }` — 첫 회 적재 시작 → `202`) · `POST /kb-sources/:id/runs/:runId/cancel` · `GET /kb-sources/:id/runs`(+`/:runId` 진행률·예상 시간) · `GET /kb-sources/:id/documents`(상태·정리 필요·실행별 관측 필터) — 조회 `security:read` · 쓰기 `security:write` · `GET /chatbots/:chatbotId/kb-status`(답변 설정 읽기 카드 — `chatbot:read` · URL·호스트 미노출)**. 총 13개 핸들러(컨트롤러 2) · `KB_SYNC_ENABLED=false`면 전부 `404` · 적재·작업 조회를 중계하는 경로 0(외부 RAG 프록시 금지 — ADR-0022 §8) · **`@Public()` 추가 0건 · 공개 대화 요청·응답 스키마 불변** | 43 |
````

### A-12. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 옵션(RAG) 행 — 경로 3 → 5

**찾을 원문**
````text
외부 RAG 호출은 `apps/api` 내부 `RagHttpClient` 전용이며 공개 표면이 없다(ADR-0022).
````
**바꿀 내용**
````text
외부 RAG 호출은 `apps/api` 내부 `RagHttpClient` 전용이며 공개 표면이 없다(ADR-0022). **[No.43] `RagHttpClient`의 경로 허용 목록은 3 → 5(적재 `POST /api/documents/ingest` — 파일 업로드 4필드 · 작업 개별 조회 `GET /api/async_task_status/{UUID}`)이며 호출부는 지식베이스 적재기 1파일이다. 삭제·초기화·전역 설정·프롬프트·작업 목록·작업 취소는 여전히 호출할 수 없다(ADR-0022 갱신 · ADR-0044 §2).**
````

### A-13. [개발명세서 `docs/02-spec/개발명세서.md`] §4 정정 이력 — 2026-09-27b 항목 추가

**찾을 원문**
````text
신규 `ApiErrorCode` 0종 · 공개 경로 8곳 그대로(`channel-rich-messages-설계.md` §9.3).
````
**바꿀 내용**
````text
신규 `ApiErrorCode` 0종 · 공개 경로 8곳 그대로(`channel-rich-messages-설계.md` §9.3).
> **정정 이력(2026-09-27b — 지식베이스 동기화)**: ① **지식베이스 동기화 행을 신설**했다 — 소스는 전역 자원(`/kb-sources/*`)이고 챗봇 답변 설정 카드만 챗봇 스코프(`/chatbots/:chatbotId/kb-status`)다. ② 요구사항 가칭 경로를 확정하고 `GET /kb-sources/meta`(전송 전제·배지)와 실행 상세 `GET …/runs/:runId`를 더했다(13개). ③ 옵션(RAG) 행의 "RAG 프록시 경로를 만들지 않는다"는 그대로다 — 적재·작업 조회는 서버 내부 백그라운드 호출이며 관리 API는 우리 DB 상태만 돌려준다. ④ 신규 `ApiErrorCode` 3종 · 공개 경로 8곳 그대로(`kb-crawling-설계.md` §11).
````

### A-14. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 오류 봉투 — No.43 3종 추가

**찾을 원문**
````text
공개 대화 경로는 인박스 코드를 쓰지 않는다(식별 실패는 응답에 드러나지 않는다) |
````
**바꿀 내용**
````text
공개 대화 경로는 인박스 코드를 쓰지 않는다(식별 실패는 응답에 드러나지 않는다) **[No.43] 3종 추가** — `KB_SOURCE_BUSY`(409 — 실행 중인 소스의 범위 필드 수정·삭제·중복 실행)·`KB_INGEST_NOT_ALLOWED`(409 — 적재 불가 사유 `details[].message` = `TRANSPORT_NOT_ACKNOWLEDGED｜RAG_NOT_CONFIGURED｜PREVIEW_REQUIRED｜PREVIEW_STALE｜REVIEW_REQUIRED`)·`KB_HOST_NOT_ALLOWED`(400 — 사설 대역 허용 목록 밖·절대 차단 대역·DNS 실패·주소 형식). 거버넌스 출구 허용 목록 밖은 `EGRESS_HOST_NOT_ALLOWED`, 이름 중복은 `DUPLICATE_NAME`, 소스 50 초과는 `LIMIT_EXCEEDED`, 형식·권리 확인 누락은 `VALIDATION_FAILED`, 기능 꺼짐은 `NOT_FOUND`를 재사용한다. 공개 대화 경로는 이 코드를 쓰지 않는다 |
````

### A-15. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 챗봇 스코프 — 지식베이스 카드 `ARCHIVED` 규칙

**찾을 원문**
````text
저장은 `409 CHATBOT_ARCHIVED`다(인박스 참여 설정과 같은 규칙)** |
````
**바꿀 내용**
````text
저장은 `409 CHATBOT_ARCHIVED`다(인박스 참여 설정과 같은 규칙)** **[No.43] 챗봇 답변 설정의 지식베이스 카드(`GET /chatbots/:chatbotId/kb-status`)는 조회라 `ARCHIVED`에서도 허용한다. 소스(`/kb-sources/*`)는 챗봇 스코프가 아니다** |
````

### A-16. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 권한 — No.43 권한 보론

**찾을 원문**
````text
허용 도메인 목록 = `chatbot:read｜write`(신규 권한 0 — ADR-0043 §10)** |
````
**바꿀 내용**
````text
허용 도메인 목록 = `chatbot:read｜write`(신규 권한 0 — ADR-0043 §10)** **[No.43] 지식베이스 동기화는 신규 권한·역할 0종이다** — 소스 등록·수정·삭제·실행·중지·적재 시작·전체 다시 적재 = `security:write`(새 외부 출구를 여는 전역 설정 — No.26 연결과 같은 등급) · 소스·실행·문서·메타 조회 = `security:read` · 챗봇 답변 설정 카드 = `chatbot:read`(이름·시각·건수만). **사설 대역 허용·원본 파일 전달 전역 허용·전송 전제 선언은 환경변수로만**(콘솔 불가 — ADR-0044 §11) |
````

### A-17. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 파괴적 동작 — 적재 재개 후에도 파괴적 호출 0

**찾을 원문**
````text
내부 호출 코드도 존재하지 않는다**(ADR-0022) |
````
**바꿀 내용**
````text
내부 호출 코드도 존재하지 않는다**(ADR-0022) **[No.43] 적재(`POST /api/documents/ingest`)·작업 개별 조회는 호출 코드가 생겼지만 삭제·초기화·전역 설정·프롬프트·작업 목록·작업 취소는 여전히 0건이다 — 지식베이스 소스 삭제도 외부 문서를 지우지 않는다(ADR-0044 §2·§9)** |
````

### A-18. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 파일 업로드 — 수동 업로드는 여전히 없음

**찾을 원문**
````text
**외부 RAG 서버로의 문서 업로드는 제공하지 않는다**(범위 밖 — ADR-0022 §5) |
````
**바꿀 내용**
````text
**외부 RAG 서버로의 문서 업로드는 제공하지 않는다**(범위 밖 — ADR-0022 §5) **[No.43] 관리자가 파일을 올리는 경로는 여전히 없다(No.48 종결 유지) — 서버가 등록 소스에서 수집한 문서만 백그라운드로 적재하며, 그 바이트는 메모리에서만 다루고 디스크에 남기지 않는다(ADR-0044 §3)** |
````

### A-19. [개발명세서 `docs/02-spec/개발명세서.md`] §5 성능 — No.43 항목 추가

**찾을 원문**
````text
콘솔 미리보기 서버 호출 0 · 위젯 gzip +6KB 이하(ADR-0043).
````
**바꿀 내용**
````text
콘솔 미리보기 서버 호출 0 · 위젯 gzip +6KB 이하(ADR-0043).
  - **[신규 2026-09-27 — 지식베이스 동기화] 기능이 꺼져 있거나 소스가 0개인 설치의 공개 대화·관리자 API 지연·응답 바이트·요청 경로 쿼리 수는 불변**이다(루프 미시작 · 경로 공유 0). 크롤·적재 중 공개 대화 P95 증가 **10% 미만**(해석·해시·마스킹·변환은 작업 스레드 — 이벤트 루프 차단 ≤5ms/문서 · 실측 기록) · 유휴 tick 쿼리 2개/10초 · 500쪽 크롤 ≈10분(호스트 간격 1초) · 크롤러 메모리 ≤256MB · 외부 RAG 호출 ≤30/분(슬롯 1 기준 실제 ≈8/분 · 질의 게이트 비사용) · 변경 없는 재실행 = 적재 호출 0 · 소스 목록 P95 300ms · 실행 상세 200ms · 문서 목록 300ms(5,000행 · 페이지 50) · 데이터 지도 +1~2쿼리(ADR-0044).
````

### A-20. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 본문 — 크롤러 출구·마스킹·원문 비저장

**찾을 원문**
````text
(`EgressExitId` 6 불변 · 서버가 그 주소에 접속하는 코드 0 — ADR-0043 §7·§8).**
````
**바꿀 내용**
````text
(`EgressExitId` 6 불변 · 서버가 그 주소에 접속하는 코드 0 — ADR-0043 §7·§8).** **[No.43] 지식베이스 크롤러는 7번째 서버 출구(`KB_CRAWL` — `EgressExitId` 6 → 7)다: 요청마다 출구 게이트 → DNS 1회 → 모든 주소 판정(절대 차단 불가역 · 사설 대역은 별도 `KB_CRAWL_PRIVATE_ALLOWLIST`만) → 검증 주소 고정 → 크기 상한 · 리다이렉트는 크롤러가 단계마다 재검증하며 최대 3회 · robots.txt 항상 준수 · 식별 UA. 고정 헤더 값은 `KB_SECRET__<REF>` 환경변수(리졸버 1파일 — DB·로그·감사 0)이며 시작 호스트로만 보낸다. HTML 추출 텍스트는 외부 RAG 적재 직전 PII 마스킹(ADR-0013 7번째 적용 지점 — 거버넌스 ON이면 끌 수 없음)이고, 원본 파일 전달은 기본 꺼짐(켜면 PII 사전 검사 건수 표시 · 거버넌스 ON이면 PII 파일 제외). 수집 원문은 DB·디스크에 저장하지 않는다(ADR-0044 §3·§6·§10).**
````

### A-21. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 외부 RAG 봉인 ① 갱신

**찾을 원문**
````text
⑦ 인증 헤더 주입 지점은 이 클라이언트 1곳이며 현재 자격증명을 저장하지 않는다.
````
**바꿀 내용**
````text
⑦ 인증 헤더 주입 지점은 이 클라이언트 1곳이며 현재 자격증명을 저장하지 않는다. **[No.43] ① 갱신 — 경로 allowlist 3 → 5(적재·작업 개별 조회 — 등록 소스 자동 동기화 전용). ②~⑦ 불변 · 작업 목록·작업 취소 금지 추가(ADR-0022 갱신 · ADR-0044 §2).**
````

### A-22. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — R-1 전제의 설정 강제(적재)

**찾을 원문**
````text
(목록 밖 = 기동 실패 — ADR-0040 §2).**
````
**바꿀 내용**
````text
(목록 밖 = 기동 실패 — ADR-0040 §2).** **[No.43] 지식베이스 적재는 문서 **전체**를 보내므로 이 전제를 설정으로 강제한다 — `KB_INGEST_TRANSPORT_ACK`(`INTERNAL_NETWORK｜AUTHENTICATED｜TLS`)가 없으면 적재가 불가하고(등록·미리보기만), `TLS`는 `RAG_BASE_URL`이 https일 때만 허용된다(기동 검사 — ADR-0044 §5).**
````

### A-23. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 지식베이스 봉인 항목 추가

**찾을 원문**
````text
사용자 브라우저가 외부 이미지 호스트에 접속한다(IP 노출 — 고지 사항).**
````
**바꿀 내용**
````text
사용자 브라우저가 외부 이미지 호스트에 접속한다(IP 노출 — 고지 사항).**
  - **[신규 2026-09-27] 지식베이스 동기화의 봉인(ADR-0044)**: ① `RAG_PATHS` 5개(값 리터럴) · `fetch(` 1곳 · `FormData` 필드 4개 · 작업 id 브랜드 타입 · 작업 목록·취소 문자열 0 · `file_path`·`force_sync`는 송신·`kb-sync` 0(보유 파일 = 질의 응답 파서 2개 고정) ② 출구 레지스트리 7번째 클래스 · `transport.request(` 보유 = 출구 파일 1개 · 가드 선행 ③ `KbSource` 쓰기 1파일 · 실행·문서·작업·임대 쓰기 1파일(+ 파기 writer) ④ 본문·바이트 컬럼 0 ⑤ `KB_SECRET__` 읽기 1파일 ⑥ 로그는 호스트·경로·코드 1형식(쿼리·헤더·본문·외부 오류 원문 0) ⑦ 스크립트 실행·`eval`·`vm` 0 · `pdfjs-dist` import 1파일(`isEvalSupported: false`) · 사이트맵 DOCTYPE/ENTITY 거부 ⑧ `@Public()` 8 · 권한 18 · `governance/**` import 0 · 엔진·위젯·ml-worker·공개 대화 심볼 0 · `RagCallLog`·질의 게이트 미사용 — `kb-sync-sealing.spec.ts` **KB-1~KB-22**. **[알려진 한계]** 외부에 옛 내용이 남는다("정리 필요" 표시 — 자동 삭제 없음) · 답변 출처에 `kb_…` 파일 이름 · `INTERNAL_NETWORK`·`AUTHENTICATED` 전송 전제는 운영자 선언 · 호스트 속도 제한은 인스턴스 메모리(근사).
````

### A-24. [개발명세서 `docs/02-spec/개발명세서.md`] §5 DB 이식성 — No.43

**찾을 원문**
````text
`hosts`는 기존 JSON 문자열 컬럼 규약을 따른다(ADR-0043).**
````
**바꿀 내용**
````text
`hosts`는 기존 JSON 문자열 컬럼 규약을 따른다(ADR-0043).** **[No.43] 소스당 실행 1·전역 직렬 적재·작업 전이·임대는 Prisma `updateMany` + 영향 행 수(CAS)이며 원시 SQL 0(보유 파일 4 불변) · 링크 발견은 기존 행 조회 후 신규 `createMany`(SQLite `skipDuplicates` 미지원) · 모든 스키마 변경은 `CREATE TABLE`/`CREATE INDEX`(재정의 0 — 부분 유니크 4개 보존). Postgres 전환 후 적재 작업 선택을 `FOR UPDATE SKIP LOCKED`로 바꿀 수 있다(재검토 트리거 — 현행 슬롯 CAS도 정확하다).**
````

### A-25. [개발명세서 `docs/02-spec/개발명세서.md`] §5.1 환경변수 표 — No.43 행 추가

**찾을 원문**
````text
**`EnvSchema` 밖** · 값은 로그·오류·응답·감사 어디에도 싣지 않는다 |
````
**바꿀 내용**
````text
**`EnvSchema` 밖** · 값은 로그·오류·응답·감사 어디에도 싣지 않는다 |
| **`KB_SYNC_ENABLED`** | `apps/api/.env` | — | `false` | 지식베이스 동기화 전체 스위치(No.43 — 꺼짐 = 루프 미시작·관리 API `404` · 시험은 `jest.isolate-env.js`가 `false` 고정) |
| **`KB_SYNC_INTERVAL_MS`** · **`KB_SYNC_LEASE_MS`** · **`KB_SYNC_MAX_PARALLEL_SOURCES`** | `apps/api/.env` | — | `10000` · `600000` · `2` | 루프 주기(5초~60초) · 크롤·슬롯 임대 · 크롤 동시 소스 수(1~5) |
| **`KB_CRAWL_PRIVATE_ALLOWLIST`** | `apps/api/.env` | — | (빈 값) | 크롤러 사설 대역 허용(CIDR·정확한 호스트명 — 레거시·웹훅 목록과 별도 · 절대 차단 대역 불가 · 완화는 환경변수만) |
| **`KB_CRAWL_MAX_PAGES_CAP`** · **`KB_CRAWL_MAX_FILE_BYTES`** · **`KB_CRAWL_TIMEOUT_MS`** · **`KB_CRAWL_USER_AGENT`** | `apps/api/.env` | — | `5000` · `20971520` · `15000` · `ChatBotKBCrawler/1.0` | 소스 최대 페이지 서버 상한 · 파일 서버 상한(≤100MB) · 요청 타임아웃(파일 ×4 · 최대 60초) · 식별 UA |
| **`KB_INGEST_TRANSPORT_ACK`** | `apps/api/.env` | — | (없음) | `INTERNAL_NETWORK｜AUTHENTICATED｜TLS` — 없으면 외부 RAG 적재 불가(미리보기만) · `TLS`는 `RAG_BASE_URL` https 필수(아니면 기동 실패) |
| **`KB_ALLOW_RAW_FILE_INGEST`** | `apps/api/.env` | — | `false` | 거버넌스 모드 ON에서 소스의 "원본 파일 그대로 보내기" 허용(완화) |
| **`KB_INGEST_CONCURRENCY`** · **`KB_INGEST_POLL_MS`** · **`KB_RAG_CALLS_PER_MIN`** | `apps/api/.env` | — | `1` · `10000` · `30` | 동시 외부 적재 작업(1~3) · 작업 조회 간격 하한 · 적재·조회·상태 호출 합계 한도(인스턴스) |
| **`KB_HTML_INGEST_FORMAT`** · **`KB_INGEST_BULK_WINDOW`** | `apps/api/.env` | — | `DOCX` · (빈 값) | HTML 변환 형식(`DOCX｜TXT｜HTML` — 첫 적재 전에 정할 것) · 대량 적재 허용 시간창(`HH:MM-HH:MM` KST · 빈 값 = 항상) |
| `KB_SECRET__<REF>` | `apps/api/.env` | — | — | 지식베이스 소스 고정 헤더 값(소스의 `authSecretRef`별). **`EnvSchema`에 등록하지 않고** 리졸버 1파일이 접두사 규약으로 직접 읽는다. 값을 로그·오류·응답·감사에 출력 금지 |
````

### A-26. [개발명세서 `docs/02-spec/개발명세서.md`] §5.1 주석 — No.43 환경변수 요약

**찾을 원문**
````text
seed는 데모 챗봇 참여 설정(꺼짐) 1행만 만든다.
````
**바꿀 내용**
````text
seed는 데모 챗봇 참여 설정(꺼짐) 1행만 만든다.
> **지식베이스 동기화 그룹(No.43)이 추가한 16개도 전부 선택이며 API 전용이다(ml-worker 변수 추가 0건).** 하나도 설정하지 않으면 **기능 꺼짐**(루프 미시작 · 관리 API `404` · 관측 변화 없음)이다. 켜도 `KB_INGEST_TRANSPORT_ACK`가 없으면 등록·미리보기만 되고 외부 적재는 되지 않는다. 비밀은 `KB_SECRET__<REF>` 접두 규약(스키마 밖)이며 없으면 해당 소스 실행이 `SECRET_MISSING`으로 실패한다(기동 실패 아님). 새 기동 실패 조건은 `ACK=TLS`인데 `RAG_BASE_URL`이 https가 아닌 경우 1건뿐이다. boolean은 `envBoolean()`. 시험은 `jest.isolate-env.js`가 `KB_SYNC_ENABLED=false`를 고정한다. seed는 변경하지 않는다(실제 외부 수집·적재 방지).
````

### A-27. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 27(ADR-0022) — No.43 재결정 갱신 각주

**찾을 원문**
````text
전제조건(내부망/인증/TLS 중 1택)으로 명시한다. → **ADR-0022**
````
**바꿀 내용**
````text
전제조건(내부망/인증/TLS 중 1택)으로 명시한다. → **ADR-0022**
    - **갱신(2026-09-27 — No.43 · 재결정)**: PM이 P-1 (a)를 확정해 이 결정의 "문서 인입·task 폴링을 만들지 않는다" 중 **적재·작업 개별 조회 2경로만** 연다 — 경로 allowlist 3 → 5(`POST /api/documents/ingest` 파일 업로드 4필드 · `GET /api/async_task_status/{UUID}`) · 출구는 여전히 `RagHttpClient` 1클래스·`fetch` 1곳 · 호출부는 등록 소스 자동 동기화 1파일. **수동 업로드 화면(No.48)은 계속 종결**이고 삭제·초기화·전역 설정·프롬프트는 불변 금지 + 작업 목록·작업 취소 금지 추가 · `file_path`·`force_sync`는 송신 코드 0. 적재는 문서 전체라 무인증 전제를 설정(`KB_INGEST_TRANSPORT_ACK`)으로 강제한다. 선결 문제 6(+1)의 처리 방침은 `kb-crawling-설계.md` §5.6(ADR-0022 갱신, ADR-0044 §2 — ADR-0022 §2 표 일부·§5 일부 부분 대체).
````

### A-28. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 35(ADR-0034) — No.43 갱신 각주

**찾을 원문**
````text
1장만 남으면 `CARD`로 바꾼다(ADR-0034 갱신 각주, ADR-0043 §2).
````
**바꿀 내용**
````text
1장만 남으면 `CARD`로 바꾼다(ADR-0034 갱신 각주, ADR-0043 §2).
    - **갱신(2026-09-27 — No.43)**: 전송·DNS·주소 판정 부품의 **세 번째 소비자**(지식베이스 크롤러 — 출구 `KB_CRAWL`)가 이동 없이 세 번째 DI 토큰으로 붙는다. 전송 요청 선택 필드 +2(`redirectMode: 'FAIL'｜'REPORT'` — 3xx를 `Location`과 함께 돌려줘 크롤러가 단계마다 재검증하며 최대 3회 추종 · `captureHeaders` — ETag·Last-Modified·X-Robots-Tag 등) · `ip-policy.parseAllowlist(raw, label?)` · 기본값 = 현행이라 레거시·웹훅 호출부와 L-2·L-4 불변. 사설 대역 허용 목록은 출구별 분리 원칙대로 `KB_CRAWL_PRIVATE_ALLOWLIST`(ADR-0034 갱신 각주, ADR-0044 §6).
````

### A-29. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 41(ADR-0040) — No.43 갱신 각주

**찾을 원문**
````text
식별자가 생겨 **정보주체 파기 요청(2차)의 착수 조건이 충족**됐다(ADR-0040 갱신 각주, ADR-0042 §6).
````
**바꿀 내용**
````text
식별자가 생겨 **정보주체 파기 요청(2차)의 착수 조건이 충족**됐다(ADR-0040 갱신 각주, ADR-0042 §6).
    - **갱신(2026-09-27 — No.43)**: 외부 출구 **6 → 7클래스**(`KB_CRAWL` — 데이터 종류 `CRAWL_REQUEST` · DB 결정 출구라 지도 `exits[]` 제외) · 외부 RAG 적재는 새 클래스가 아니라 RAG 출구의 새 데이터 종류 `DOCUMENT_BODY`(지도 선택 키 `egress.kbSources?` — 소스별 마스킹·원본 파일 허용 · 소스 0개면 생략) · 실행 이력·적재 작업은 `CALL_LOGS`에 편입(종단 행 삭제 · writer 블록 +2) · 암호화 대상 추가 0(원문 비저장) · 완화 환경변수 +2(`KB_CRAWL_PRIVATE_ALLOWLIST`·`KB_ALLOW_RAW_FILE_INGEST`)(ADR-0040 갱신 각주, ADR-0044 §3·§6).
````

### A-30. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 42(ADR-0041) — No.43 갱신 각주

**찾을 원문**
````text
스레드 이벤트 알림은 2차(`source.threadId`만 · 기록 채널은 `data`)(ADR-0041 갱신 각주, ADR-0042 §5).
````
**바꿀 내용**
````text
스레드 이벤트 알림은 2차(`source.threadId`만 · 기록 채널은 `data`)(ADR-0041 갱신 각주, ADR-0042 §5).
    - **갱신(2026-09-27 — No.43)**: 재검토 트리거 "세 번째 출구가 같은 전송 부품을 공유 → `common/outbound/`로 이동"이 **발동**했으나 이번에는 **이동하지 않는다**(동작 0 변경인데 import 15파일(spec 9)·L-2·W-12 경로가 연쇄로 바뀜 — 독립 리팩터로 분리, 사용자 결정). DB 선점·임대·루프 패턴은 지식베이스 적재 작업이 재사용하고(슬롯 임대 행 — 발송함과 별도 테이블), 운영 이벤트 2차 목록에 "지식베이스 동기화 실패"를 더한다(ADR-0041 갱신 각주, ADR-0044 §6·§7).
````

### A-31. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 45 신설

**찾을 원문**
````text
→ **ADR-0043**(+ ADR-0002·0011·0012·0031·0034·0035·0038·0042 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0043**(+ ADR-0002·0011·0012·0031·0034·0035·0038·0042 갱신 각주)

45. **지식베이스 자동 크롤링/동기화(No.43)의 역할 분담·ADR-0022 재결정·원문 비저장·적재 계약·전송 전제·출구·실행 모델·반영 시점·삭제 처리·문서 해석·권한 확정(2026-09-27 — PM 확정, P-1~P-12 추천안)**: **① 역할 = 수집·변경 감지는 `apps/api`, 적재·청킹·임베딩·검색·답변은 외부 RAG**(P-1 (a) · 자체 색인·ml-worker 0). **② ADR-0022 부분 재개** — 경로 3 → 5(적재 · 작업 개별 조회) · `RagHttpClient` 1클래스·`fetch` 1곳·멀티파트 4필드·작업 id UUID 브랜드 · 수동 업로드(No.48) 계속 종결 · 삭제·초기화·전역 설정·프롬프트·작업 목록·작업 취소 금지 · `file_path`·`force_sync` 송신 0. **③ 원문 비저장** — 감지만 저장(URL·해시·검증자·상태) · 적재 시점 재수집 · 검증자·해시는 성공 적재와 짝. **④ 적재 계약** — 결정적 파일 이름 `kb_<8>_<16>.<ext>`(덮어쓰기 = 갱신) · HTML → DOCX(확인 전 기본) · 3중 성패 판정 · `not_found` = 1회 재전송 · 백오프 1·5·30분 · 3시간 시간 초과 · 질의 게이트·`RagCallLog` 미사용. **⑤ 전송 전제 `KB_INGEST_TRANSPORT_ACK`** 없으면 적재 불가(P-5). **⑥ 7번째 출구 `KB_CRAWL`**(SSRF 부품 세 번째 공유 · 리다이렉트 단계별 재검증 3회 · robots 준수 · 호스트당 1연결·간격) · 적재는 RAG 클래스 그대로 + 지도 `kbSources` 절. **⑦ 실행 = `PollingLoop` 1 · tick 조각 · DB 프런티어 재개 · 소스 행 CAS(실행 1) · 슬롯 임대 CAS(전역 직렬) · 크롤 종결 후 일괄 대기열 + 자동 강등 가드 · BULK/INCREMENTAL 레인** — 부분 유니크 추가 0. **⑧ 첫 회 미리보기 → 승인(`configVersion`) → 이후 자동** · 환경 밖(P-4). **⑨ 자동 삭제 없음 — "정리 필요"**(없어짐 2회·축소 50%·스코프/형식 변경·robots 금지 — 외부 적재 이력이 있는 문서만)(P-3). **⑩ 해석 = 작업 스레드 샌드박스**(`htmlparser2`·`fflate`·`pdfjs-dist` ≥4.2.67 · 스크립트 0 · XXE·압축 폭탄 방어) · HTML 마스킹 기본(ADR-0013 7번째) · 원본 파일 기본 꺼짐 + PII 사전 검사(P-6). **⑪ 권한 신규 0**(`security:*` · 카드 `chatbot:read`)(P-8) · 알림은 No.41 2차(P-9). 신규 테이블 5(마이그레이션 1 · `CREATE`만) · 컨트롤러 2(핸들러 13) · `@Public()` 8 · `ApiErrorCode` +3 · `AuditTargetType` +1 · 선택 환경변수 16 + `KB_SECRET__` · 의존성 +3 · 엔진·위젯·ml-worker·공개 대화 변경 0. GPU **4 → 1** · 구축형 ○(전제) · 구독형 △(P-12). → **ADR-0044**(+ ADR-0013·0022·0034·0040·0041 갱신 각주 · ADR-0022 부분 대체)
````

### A-32. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — 설계서 행 추가

**찾을 원문**
````text
요구사항: `docs/requirements/channel-rich-messages.md` |
````
**바꿀 내용**
````text
요구사항: `docs/requirements/channel-rich-messages.md` |
| **`kb-crawling-설계.md`** | **지식베이스 자동 크롤링/동기화(No.43) — 모듈 배치(`kb-sync` export 0 · 소스 쓰기 유일 · 실행·문서·작업·임대 쓰기 유일 · 출구 파일·비밀 리졸버 · 작업 스레드 추출기 · 순수 lib) · tick 흐름 · Prisma 변경안(5테이블 — 마이그레이션 1 · `CREATE`만 · 부분 유니크 4 보존) · 상태 기계 2종 · 거버넌스 편입(보존 `CALL_LOGS` · 암호화 0 · 지도 `kbSources`) · shared-types(`kb-sync.ts`) · ★ADR-0022 재개 범위·`RagHttpClient` 확장·봉인 변경·결정적 파일 이름·변환 형식·★외부 함정 대응 표·전송 전제·부하 보호 · ★출구 `KB_CRAWL`·SSRF·전송 포트 확장·리다이렉트·robots·사이트맵·범위·속도·헤더 · ★라이브러리 선정·작업 스레드 샌드박스·zip bomb 한도·HTML 추출·인코딩 · 변경/삭제/축소 감지·자동 강등 · ★예약·조각·재개·슬롯·재시도·진행률·대량 첫 적재·승인 · 개인정보 · API 13 · 콘솔 · 권한·감사 · **봉인 KB-1~KB-22** · 성능 예산 · 시험 전략(★상대 시각)·**의도된 기대값 변경 2건(닫힌 목록)** · 미사용 동작 불변 · 알려진 제한 14 · 요구사항 대비 해석 30 · ★외부 RAG 담당자 확인 Q-1~Q-10** | 요구사항: `docs/requirements/kb-crawling.md` |
````

### A-33. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — ADR-0044 행 추가

**찾을 원문**
````text
FR-RM1-\*~FR-RM8-\*, AC-RM1~RM7 |
````
**바꿀 내용**
````text
FR-RM1-\*~FR-RM8-\*, AC-RM1~RM7 |
| **`decisions/ADR-0044-knowledge-base-sync-crawler-egress-change-detection-and-serial-external-rag-ingest.md`** | **지식베이스 동기화 = 수집·감지 api · 적재·색인·답변 외부 RAG(자체 색인·외부 크롤 기능·목록만 기각) · ADR-0022 부분 대체(적재·작업 개별 조회 2경로 — 파괴적 봉인 불변 · 수동 업로드 종결 유지) · 원문 비저장·적재 시점 재수집 · 결정적 파일 이름·DOCX 기본·3중 판정·`not_found` 재전송 · 전송 전제 게이트 · 7번째 출구 `KB_CRAWL`(적재 클래스 분리 기각) · `PollingLoop` 조각·DB 프런티어·소스 행 CAS·슬롯 임대(부분 인덱스 기각) · 크롤 후 일괄 대기열·자동 강등 · 첫 회 미리보기 · 자동 삭제 없음 · 작업 스레드 샌드박스(jsdom·pdf-parse·SheetJS 기각) · 공유 전송 부품 이동 연기 · 신규 권한 0** | 요구사항 J-1~J-19, FR-0-203~214, FR-KB1-\*~FR-KB9-\*, AC-KB1~KB7 |
````

---

## B. 기존 ADR (결정 본문은 수정하지 않는다 — 상태 줄 표기 + 파일 끝 append)

### B-1. [ADR-0022] `docs/02-spec/decisions/ADR-0022-external-rag-allowlist-sealing.md` — 상태 줄에 부분 대체 표기

**찾을 원문**
````text
- **상태**: 채택 (Accepted)
````
**바꿀 내용**
````text
- **상태**: 채택 (Accepted) — **§2 표의 적재·task 행과 §5의 "인입·task 폴링을 만들지 않는다" 중 적재·작업 개별 조회 부분은 ADR-0044가 부분 대체(2026-09-27)**
````

### B-2. [ADR-0022] `docs/02-spec/decisions/ADR-0022-external-rag-allowlist-sealing.md` — 재결정 갱신 절 (append)

**찾을 원문**
````text
- "무인증·평문 = 배포 전 전제조건"은 불변이며, 거버넌스 모드 설치는 그에 더해 호스트 허용 목록 등록이 필요하다.
````
**바꿀 내용**
````text
- "무인증·평문 = 배포 전 전제조건"은 불변이며, 거버넌스 모드 설치는 그에 더해 호스트 허용 목록 등록이 필요하다.


---

## 갱신 (2026-09-27 — No.43: 재결정 — 적재·작업 개별 조회 2경로 재개 · 파괴적 봉인 불변 · ADR-0044가 부분 대체)

지식베이스 자동 크롤링/동기화(No.43, **ADR-0044 §2**). 재검토 트리거 "사용자가 문서 인입을 우리 콘솔에서 하기로 마음을 바꿀 때(재확정 필요)"에 대해 **PM이 2026-09-27 P-1 (a)로 재확정**했다 — 다만 "콘솔에서 올리기"가 아니라 **등록 소스 자동 동기화에 한정한 적재**다.

1. **바뀌는 것(§2 표 · §5 일부)**: 경로 allowlist **3 → 5** — `POST /api/documents/ingest`(파일 업로드 `file`·`company`·`category`·`subcategory` 4필드만 · 동기 옵션 미전송) · `GET /api/async_task_status/{UUID}`(작업 개별 조회 — UUID 검증 브랜드 값만 경로에 붙는다). 호출부는 지식베이스 적재기 1파일이다.
2. **바뀌지 않는 것**: §1 출구 1클래스(`fetch` 1곳 — 멀티파트는 같은 `send()`의 본문 인코딩 선택) · §2 경로 인자 미수용(`send(key: RagPathKey)`) · §3 금지 문자열 4종 0건(`rag-allowlist.spec.ts` 무수정) · §4 `provider` 상수 · §6 metadata 1숫자 · §7 스코프는 서버 설정에서만(소스 설정) · §8 RAG 프록시 경로 없음 · **§5 수동 업로드 화면(No.48) 없음 · 삭제·초기화 없음**.
3. **금지 추가**: 작업 목록·작업 취소 경로 문자열 0건(ADR-0044 봉인 KB-2) · `file_path`·`force_sync`는 송신 조립 파일에 0건(같은 원리 — 받는 필드가 없으면 채울 수 없다). `file_path`는 질의 응답 파서 2파일에만 있다(보유 파일 고정 — KB-3).
4. **§5 선결 문제 6건의 처리**: ① 진행률 0 → 우리 작업 행 개수 ② `not_found` → 1회 재전송(같은 이름 덮어쓰기) ③ `file_path` → 필드 없음 ④ 이름 덮어쓰기 → 결정적 이름 `kb_<8>_<16>.<ext>`(= 갱신 수단) ⑤ 삭제 성패 구분 불가 → 삭제를 계속 만들지 않음 ⑥ 옛 청크 잔존 → "정리 필요" 표시(자동 삭제 없음).
5. **§9 무인증 전제 강화**: 질의는 마스킹된 200자지만 적재는 **문서 전체**다 — 서버 운영자가 `KB_INGEST_TRANSPORT_ACK`(내부망·인증·TLS 중 하나)를 선언해야 적재가 켜진다(`TLS`는 https 기동 검사). 질의 경로는 기존 그대로.
6. **"나빠지는 것" 갱신**: "문서가 바뀌어도 알 방법이 없다"는 등록 소스 범위에서 해소된다. 새 감수 비용 = 우리 적재가 그 스코프의 모든 챗봇 답변을 즉시 바꾼다(첫 회 미리보기·자동 강등 가드로 완화) · 적재가 외부 vLLM을 점유한다(대량 적재 시간창).
7. 새 재검토 트리거: 외부 RAG가 크롤링·동기화 API를 제공하면 우리 크롤러를 축소(ADR-0044) · 외부에 인증이 생기면 인증 헤더 주입(이 클래스 1곳).
````

### B-3. [ADR-0040] `docs/02-spec/decisions/ADR-0040-data-governance-mode-egress-gate-field-encryption-text-purge-and-audit-hash-chain.md` — 출구 7 · 데이터 종류 · 보존 · 지도 (append)

**찾을 원문**
````text
1차는 보존기간 파기만이며, 절차가 확정되면 writer에 고객 단위 소거 메서드를 더한다.
````
**바꿀 내용**
````text
1차는 보존기간 파기만이며, 절차가 확정되면 writer에 고객 단위 소거 메서드를 더한다.


---

## 갱신 (2026-09-27 — No.43: 출구 7클래스 · 데이터 종류 +2 · `CALL_LOGS` 편입 +2모델 · 데이터 지도 `kbSources` · 완화 환경변수 +2)

지식베이스 동기화(No.43, **ADR-0044 §3·§6**). 결정 1~7은 **불변**이다 — 재검토 트리거 "새 외부 출구 클래스는 레지스트리 등록"의 두 번째 이행이다.

1. **출구 6 → 7클래스**: `KB_CRAWL`(라벨 "지식베이스 수집(크롤러)" · `EgressDataKind` `CRAWL_REQUEST` · `masked` 레지스트리 전용 값 `NOT_APPLICABLE`). 출구 파일 `kb-sync/crawl/kb-crawl-http.fetcher.ts`가 요청(리다이렉트 매 단계 포함)마다 DNS 조회 전 `checkEgress('KB_CRAWL', …)`를 호출하고(G-2), 공유 전송·DNS 파일을 세 클래스에 나열한다(G-1). DB 결정 출구라 데이터 지도 `exits[]`에서는 제외한다(레거시·웹훅 선례 — 제외하지 않으면 미사용 설치의 지도 바이트가 바뀐다).
2. **적재는 새 클래스가 아니다**: 외부 RAG 적재·작업 조회는 `RAG` 클래스의 같은 파일·같은 가드다. 새 데이터 종류 `DOCUMENT_BODY`는 지도 선택 키 **`egress.kbSources?`**(소스별 호스트·출구 판정·마스킹·원본 파일 허용·스코프 회사·전송 전제 — 소스 0개면 생략)로 표시한다. `exits[]`의 RAG 행(마스킹된 질문)은 불변이다.
3. **보존**: `KbSyncRun`·`KbIngestJob`의 종단 행을 `CALL_LOGS`에 편입(writer `deleteCallLogsBatch()` 블록 +2 — 작업 먼저 · 실행 다음). 보존 종류 신설 0 · `KbDocument`(변경 감지 기준)는 소스 수명.
4. **암호화 대상 추가 0**: 수집 원문을 저장하지 않는다(본문·바이트 컬럼 0 — 정적 검사). 제목은 마스킹 후 저장.
5. **완화 환경변수 +2**(콘솔 불가): `KB_CRAWL_PRIVATE_ALLOWLIST`(크롤러 사설 대역 — 출구별 분리) · `KB_ALLOW_RAW_FILE_INGEST`(거버넌스 ON에서 원본 파일 전달 허용). 거버넌스 ON이면 소스의 HTML 마스킹을 끌 수 없고, 원본 파일은 PII 사전 검사 1건 이상이면 제외된다.
6. **기동 검사**: 크롤 대상 호스트는 기동 검사 대상이 아니다(DB 결정 — 실행 시 판정 · 목록 밖이면 그 소스 실행 차단 + 배지). `KB_INGEST_TRANSPORT_ACK=TLS`면 `RAG_BASE_URL` https 검사(환경변수 교차 검사).
````

### B-4. [ADR-0041] `docs/02-spec/decisions/ADR-0041-workflow-webhook-engine-emission-db-outbox-and-sixth-egress-class.md` — 공유 전송 세 번째 소비자 · 이동 트리거 연기 · 운영 이벤트 (append)

**찾을 원문**
````text
기록 채널은 `channel`이 아니라 `data.recordChannel` — 봉투 v1 확장 규칙(선택 키) 안에서.
````
**바꿀 내용**
````text
기록 채널은 `channel`이 아니라 `data.recordChannel` — 봉투 v1 확장 규칙(선택 키) 안에서.


---

## 갱신 (2026-09-27 — No.43: 공유 전송 부품 세 번째 소비자 · 이동 트리거 발동과 연기 · 운영 이벤트 2차 +1)

지식베이스 동기화(No.43, **ADR-0044 §6·§7**). 결정 1~9는 **불변**이다.

1. **세 번째 소비자**: 지식베이스 크롤러(출구 `KB_CRAWL`)가 `NodeHttpTransport`·`NodeDnsResolver`·`lib/ip-policy.ts`를 **이동 없이 세 번째 DI 토큰**으로 쓴다. 전송 포트 선택 필드 +2(`redirectMode`·`captureHeaders` — 기본값 = 현행)이며 웹훅 발송기는 무수정이다. 사설 대역 허용 목록은 출구별 분리(`KB_CRAWL_PRIVATE_ALLOWLIST`).
2. **재검토 트리거 "세 번째 출구가 같은 부품을 공유 → `common/outbound/`로 이동"은 발동했으나 이번에는 이동하지 않는다**: 이동은 동작 변화 0인데 import 15파일(그중 spec 9 — 레거시·업무 자동화·리치 메시지 통합 시험)과 L-2·W-12 경로 단언·레지스트리 파일 목록을 함께 바꿔, 이 그룹과 무관한 회귀 면적을 만든다. **독립 리팩터 커밋**(경로만 · 동작 0)으로 분리하고 시기는 사용자가 정한다. 새 트리거 = 네 번째 소비자(No.39 커넥터 허브) 또는 사용자 지시.
3. **DB 선점 패턴 재사용**: 지식베이스 적재 작업은 발송함과 **별도 테이블**(`KbIngestJob`)에서 같은 방식(행 CAS · 임대 회수 · 지수 백오프)을 쓰고, 전역 직렬은 슬롯 임대 행(`KbJobLease`)으로 더한다.
4. **운영 이벤트 2차 목록 +1**: "지식베이스 동기화 실패(실행 FAILED·반복 실패·자동 강등)" — 1차는 콘솔 배지·감사만(P-9).
````

### B-5. [ADR-0034] `docs/02-spec/decisions/ADR-0034-legacy-api-connection-registry-and-engine-suspension.md` — 세 번째 소비자 · 전송 포트 선택 필드 +2 (append)

**찾을 원문**
````text
재조립 지점이 스프레드인지 먼저 확인한다(`channel-rich-messages-설계.md` §15 체크리스트).
````
**바꿀 내용**
````text
재조립 지점이 스프레드인지 먼저 확인한다(`channel-rich-messages-설계.md` §15 체크리스트).


---

## 갱신 (2026-09-27 — No.43: 전송·DNS·주소 판정 부품의 세 번째 소비자 · 전송 포트 선택 필드 +2)

지식베이스 동기화(No.43, **ADR-0044 §6**). 결정 1~11은 불변이다.

1. **세 번째 소비자**: 지식베이스 크롤러가 결정 4의 방어 층(DNS 1회·모든 주소 검사·절대 차단 대역·사설 allowlist·검증 주소 고정·단일 데드라인·응답 크기 상한)을 그대로 쓴다. `LegacyApiHttpClient`·`ValidatedLegacyRequest`·시크릿 리졸버는 공유하지 않는다 — L-2·L-4 **불변**.
2. **전송 포트 선택 필드 +2**(기본값 = 현행 — 레거시·웹훅 호출부·spec 무수정): `redirectMode?: 'FAIL'｜'REPORT'`(`REPORT`면 3xx를 오류가 아니라 `RESPONSE`(본문 폐기 + `Location`)로 돌려준다 — 크롤러가 **단계마다 허용 호스트·출구 게이트·주소 판정을 다시 하고 최대 3회** 따라가기 위함. 전송 계층은 여전히 스스로 따라가지 않는다) · `captureHeaders?`(닫힌 목록 `etag`·`last-modified`·`location`·`x-robots-tag`·`content-encoding`·`content-length` — 결과 `headers?`).
3. `ip-policy.parseAllowlist(raw, label?)` — 경고 문구의 변수 이름을 호출부가 넘긴다(기본값 = `LEGACY_API_PRIVATE_ALLOWLIST` 현행 문구).
4. 사설 대역 허용 목록은 출구별 분리 원칙 그대로 — `KB_CRAWL_PRIVATE_ALLOWLIST`(조회 연동·웹훅을 위해 연 대역이 크롤러에 자동으로 열리지 않는다).
````

### B-6. [ADR-0013] `docs/02-spec/decisions/ADR-0013-pii-masking-policy-and-placement.md` — 일곱 번째 적용 지점 (append)

**찾을 원문**
````text
감사·서버 로그에는 본문·이름 0(별칭만).
````
**바꿀 내용**
````text
감사·서버 로그에는 본문·이름 0(별칭만).


---

## 갱신 (2026-09-27 — No.43: 일곱 번째 적용 지점 = 지식베이스 적재 송신)

지식베이스 동기화(No.43, **ADR-0044 §10**). 정책(대상·차등)·함수 1벌·순서는 **불변**이다.

1. **적용 지점 7번째**(저장 · RAG 질의 · 증강 · 레거시 · 웹훅 · 인박스 저장 · **지식베이스 적재 송신**): 수집한 HTML의 추출 본문·제목·문서 머리 줄(출처 URL 포함)을 외부 RAG 적재 직전 `maskPii()`(`PII_MASK_MODE` 반영)로 마스킹한다 — 소스 옵션 기본 켜짐 · 거버넌스 모드 ON이면 끌 수 없다. 마스킹 건수는 실행 요약·문서 행에 숫자로만 남는다.
2. **예외(원본 파일)**: PDF·DOCX·XLSX·PPTX를 바이트 그대로 보내는 옵션(기본 꺼짐)은 마스킹할 수 없다 — 대신 작업 스레드가 텍스트를 추출해 **PII 형식 건수만** 세어 미리보기에 보여 주고, 거버넌스 ON이면 1건 이상인 파일을 보내지 않는다. 추출 텍스트는 보내지도 저장하지도 않는다.
3. **예외 없는 곳**: 수집 원문·마스킹본 모두 DB·디스크·로그·감사·실행 이력에 없다(제목만 마스킹 후 저장). 금지어 필터는 적재 문서에 적용하지 않는다(근거 원문 — 최종 답변은 기존 출구 필터).
````

---

## C. `docs/01-requirements/기능요구사항.md`

### C-1. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 No.43 행 — PM 확정 · 설계 완료 · GPU·배포형태 재평가

**찾을 원문**
````text
| 43 | 지식관리 | 지식베이스 자동 크롤링/동기화 | 사내 웹사이트·문서를 주기적으로 크롤링해 RAG(30번)용 지식베이스를 자동 최신화, 변경분만 재인덱싱 | 4 | △ | ○ | 업계 트렌드. RAG(30번) 도입 시 지식베이스 수동 업로드의 한계 보완 |
````
**바꿀 내용**
````text
| 43 | 지식관리 | 지식베이스 자동 크롤링/동기화 | 관리자가 등록한 **사내 웹사이트·사이트맵·링크된 문서(PDF·DOCX·XLSX·PPTX)** 를 정해진 주기로 수집(robots 준수·호스트별 속도 제한) → **바뀐 것만 외부 RAG(30번) 적재 API로 전송**(우리 쪽 색인 없음 · 변경 감지 = 조건부 요청 → 본문 해시) · 첫 동기화 미리보기 확인 후 자동 · 사라지거나 짧아진 페이지는 "정리 필요" 표시(자동 삭제 없음) | 1 | ○ | △ | **✅ PM 도입 확정(2026-09-25) · 범위·방식 확정(2026-09-27 — P-1~P-12 전부 추천안) · 설계 완료(`docs/02-spec/kb-crawling-설계.md` · ADR-0044).** GPU **4 → 1**(임베딩·청킹은 외부 RAG) · **구축형 ○(전제: 외부 RAG 전송 구간이 내부망·인증·TLS 중 1 — `KB_INGEST_TRANSPORT_ACK`) · 구독형 △(공개 사이트만)**(카탈로그 △/○에서 재평가). ADR-0022 부분 갱신(적재·작업 개별 조회 2경로만 · 삭제·초기화·전역 설정·프롬프트 봉인 불변) · No.48 수동 업로드는 계속 종결 · 원문 비저장 · 7번째 출구 `KB_CRAWL` · `@Public()` 8 유지 · 신규 권한 0 · 테이블 5(마이그레이션 1). 로그인·SPA·파일 서버·재구축(범위 삭제)·실패 알림(No.41 2차)은 2차. 업계 트렌드. RAG(30번) 도입 시 지식베이스 수동 업로드의 한계 보완 |
````

### C-2. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §3 No.30 행 — 지식베이스 자동 적재 각주

**찾을 원문**
````text
자체 서빙은 고사양 GPU 필요 → 구독형(클라우드 LLM API) 현실적 |
````
**바꿀 내용**
````text
자체 서빙은 고사양 GPU 필요 → 구독형(클라우드 LLM API) 현실적 **[2026-09-27 No.43 설계 완료] 지식베이스 자동 적재는 No.43(등록 소스 수집 → 바뀐 것만 외부 적재 API — 수동 업로드 화면은 계속 없음 · ADR-0044)** |
````

### C-3. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 사용자 확인 결과(106행) — No.43 범위·방식 확정

**찾을 원문**
````text
전부 추천안 · 설계 `docs/02-spec/channel-rich-messages-설계.md` · ADR-0043).**
````
**바꿀 내용**
````text
전부 추천안 · 설계 `docs/02-spec/channel-rich-messages-설계.md` · ADR-0043).** **[2026-09-27 갱신] No.43 지식베이스 자동 크롤링/동기화도 범위·방식까지 확정(요구사항 `docs/requirements/kb-crawling.md` §11 P-1~P-12 전부 추천안 · 설계 `docs/02-spec/kb-crawling-설계.md` · ADR-0044).**
````

---

## D. `docs/requirements/kb-crawling.md` — PM 결정 기록 · 설계 반영

### D-1. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] 머리 "도입 상태" — 범위·방식 확정

**찾을 원문**
````text
이 문서는 도입 여부를 묻지 않고 **범위와 방식만** 묻는다(§11).
````
**바꿀 내용**
````text
이 문서는 도입 여부를 묻지 않고 **범위와 방식만** 묻는다(§11). **[범위·방식 확정(2026-09-27, 추천안)] PM이 §11 P-1~P-12를 전부 추천안으로 확정했다 — 설계: `docs/02-spec/kb-crawling-설계.md` · ADR-0044.**
````

### D-2. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] 머리 "PM 재확인 필요 사항(핵심 충돌)" — 해소 표기

**찾을 원문**
````text
> ⚠ **PM 재확인 필요 사항(핵심 충돌)**:
````
**바꿀 내용**
````text
> ⚠ **PM 재확인 필요 사항(핵심 충돌)** **[해소 2026-09-27 — PM이 P-1 (a)로 재확정: 적재·작업 개별 조회 2경로만 재개 · 수동 업로드·삭제·초기화·전역 설정·프롬프트는 계속 만들지 않음 → ADR-0022 부분 대체(ADR-0044)]**:
````

### D-3. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] 머리 "다음 단계" — 완료 표식

**찾을 원문**
````text
**다음 단계**: PM이 §11 핵심 4건(P-1~P-4)을 결정 → `system-architect`(ADR-0044 신규 가번호 · **ADR-0022 재결정 갱신** · ADR-0040/0041 갱신)
````
**바꿀 내용**
````text
**다음 단계**: **[2026-09-27 PM 결정·architect 설계 완료 — 다음은 `ui-designer`]** 원 계획: ~~PM이 §11 핵심 4건(P-1~P-4)을 결정~~(완료) → `system-architect`(ADR-0044 신규 · **ADR-0022 재결정 갱신** · ADR-0040/0041 갱신 — 완료)
````

### D-4. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] §1.10 핵심 판단 표 머리 — PM 결정 표기 · architect 조정 요약

**찾을 원문**
````text
### 1.10 이 문서의 핵심 판단 19건 (⚠ = PM 확인 필요)
````
**바꿀 내용**
````text
### 1.10 이 문서의 핵심 판단 19건 (⚠ = PM 확인 필요)

> **PM 결정(2026-09-27)** — ⚠ 표시 항목을 포함해 아래 "결정(제안)" 열이 **전부 추천안대로 확정**되었다(§11 P-1~P-12). architect 확정·조정은 설계서 §1·§21에 있다: ADR 번호 0044(R-1) · **적재 = RAG 출구 클래스 유지 + 데이터 지도 `kbSources` 절(J-11의 분리 권고와 다름 — R-2)** · `file_path` 봉인 범위 정밀화(R-3) · HTML 기본 형식 DOCX(R-4) · 크롤 재개 = 이어서(R-5) · 소스 행 CAS·슬롯 임대(부분 인덱스 0 — R-6·R-7) · `INTERRUPTED` 조회 시점 판정(R-8) · 크롤 후 일괄 대기열(R-9) · 루프 주기 10초(R-11) · `KB_SECRET__` 접두(R-12) · 글롭 패턴(R-13) · 공유 전송 부품 이동 연기(R-15) · 작업 스레드 샌드박스(R-16) · 원본 파일 PII 사전 검사(R-17) · BULK 레인(R-22).
````

### D-5. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] FR-0-204 — `file_path` 봉인 범위 정밀화

**찾을 원문**
````text
적재 요청에 **`file_path` 필드를 넣는 코드·받는 필드가 존재하지 않는다**(정적 검사) | J-2 · C-1 · C-4 |
````
**바꿀 내용**
````text
적재 요청에 **`file_path` 필드를 넣는 코드·받는 필드가 존재하지 않는다**(정적 검사) **[설계 확정 — R-3] `file_path`는 질의 응답 파서 2파일(`rag-response.schema.ts`·`sanitize-sources.ts`)에 이미 있어 "저장소 0건"은 불가 — 송신 조립 파일·`kb-sync/**`·`shared-types/kb-sync.ts` 0건 + 보유 파일 2개 고정으로 봉인한다(KB-3). 작업 목록·취소 금지어는 새 봉인(KB-2)이 단언하고 `rag-allowlist.spec.ts`는 무수정** | J-2 · C-1 · C-4 |
````

### D-6. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] FR-0-208 — 적재 출구 분리 여부 확정

**찾을 원문**
````text
적재의 데이터 종류(`DOCUMENT_BODY` — 마스킹 여부 소스별)를 데이터 지도에 표시한다.
````
**바꿀 내용**
````text
적재의 데이터 종류(`DOCUMENT_BODY` — 마스킹 여부 소스별)를 데이터 지도에 표시한다. **[설계 확정 — R-2] 적재는 새 출구 클래스가 아니라 RAG 클래스 그대로이고, `DOCUMENT_BODY`는 데이터 지도 선택 키 `egress.kbSources`(소스별 마스킹·원본 파일 허용 · 소스 0개면 생략)로 표시한다 — `EgressExitId` 6 → 7(`KB_CRAWL`만).**
````

### D-7. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] FR-0-212 — 기대값 변경 닫힌 목록 확정

**찾을 원문**
````text
| FR-0-212 | **의도된 기존 시험 기대값 변경은 architect가 닫힌 목록으로 확정**한다
````
**바꿀 내용**
````text
| FR-0-212 | **의도된 기존 시험 기대값 변경은 architect가 닫힌 목록으로 확정**한다 **[확정 2026-09-27 — 설계서 §17.3] X-1 `rich-message-sealing.spec.ts` RM-8 `EgressExitId` 6 → 7 · X-2 `public-decorator-count.spec.ts` 컨트롤러 46 → 48(`@Public()` 8 불변) — 2건뿐. 아래 예상 목록 중 `RAG_PATHS` 개수·G-1 파일 집합·데이터 지도 스냅샷·영구삭제 목록은 변경 불필요**
````

### D-8. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] FR-KB1-5 — 비밀 참조 규약 확정

**찾을 원문**
````text
`STATIC_HEADER`(헤더 이름 + **환경변수 이름 참조** — 값은 DB에 저장하지 않음, No.26 시크릿 규약).
````
**바꿀 내용**
````text
`STATIC_HEADER`(헤더 이름 + **환경변수 이름 참조** — 값은 DB에 저장하지 않음, No.26 시크릿 규약). **[설계 확정 — R-12] 참조는 임의 환경변수 이름이 아니라 `KB_SECRET__<REF>` 접두 규약의 `<REF>`(리졸버 1파일만 읽음) · 헤더는 시작 주소와 같은 호스트로만 보낸다.**
````

### D-9. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] FR-KB2-10 — 중단 후 재개 방식 확정

**찾을 원문**
````text
다음 실행은 처음부터 다시 방문하되 변경 감지로 적재는 되풀이하지 않는다. |
````
**바꿀 내용**
````text
~~다음 실행은 처음부터 다시 방문하되 변경 감지로 적재는 되풀이하지 않는다.~~ **[설계 확정 — R-5] 서버 종료·임대 만료는 다른 인스턴스가 DB 프런티어(문서 행)의 남은 URL부터 이어서 방문한다. 관리자 중지(CANCELLED) 뒤의 다음 실행만 처음부터 다시 방문하며, 변경 감지로 적재는 되풀이하지 않는다.** |
````

### D-10. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] FR-KB4-4 — 확인 전 기본 형식 확정

**찾을 원문**
````text
(착수 전 실측 — 후보 순서: `.txt` → `.html` → `.docx`)
````
**바꿀 내용**
````text
(착수 전 실측 — 후보 순서: `.txt` → `.html` → `.docx`) **[설계 확정 — R-4] 실측(외부 담당자 확인 Q-1) 전 기본값 = `.docx`(지원 목록에 명시된 형식) · `KB_HTML_INGEST_FORMAT`으로 전환 · 첫 적재 전에 정할 것(확장자가 파일 이름의 일부)**
````

### D-11. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] FR-KB5-1 — 동시 실행 보장 방식·주기 확정

**찾을 원문**
````text
(DB 제약으로 보장 — 마이그레이션 전용 부분 유니크 인덱스면 시험 DB는 `migrate deploy`). |
````
**바꿀 내용**
````text
(DB 제약으로 보장 — 마이그레이션 전용 부분 유니크 인덱스면 시험 DB는 `migrate deploy`). **[설계 확정 — R-6·R-11] 동시 실행 1은 부분 유니크 인덱스가 아니라 소스 행 `activeRunId` 조건부 갱신(CAS)으로 보장한다(원시 부분 유니크 4 보존). 루프 기본 주기는 10초(조각 실행 처리량 — 60초 아님).** |
````

### D-12. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] FR-KB5-4 — `INTERRUPTED` 판정 방식 확정

**찾을 원문**
````text
`INTERRUPTED`(서버 종료·임대 만료로 끊김 → 다음 틱에 다른 인스턴스가 **적재 단계부터** 이어받음). |
````
**바꿀 내용**
````text
`INTERRUPTED`(서버 종료·임대 만료로 끊김 → 다음 틱에 다른 인스턴스가 **적재 단계부터** 이어받음). **[설계 확정 — R-8] `INTERRUPTED`는 저장 상태가 아니라 조회 시점 판정(진행 단계 ∧ 임대 만료)이며, 크롤 단계도 남은 URL부터 이어받는다.** |
````

### D-13. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] §4.8 API — 경로 확정

**찾을 원문**
````text
### 4.8 API 개요(권고 — 최종 경로는 architect)
````
**바꿀 내용**
````text
### 4.8 API 개요(권고 — 최종 경로는 architect)

> **[확정 2026-09-27 — 설계서 §11]** 아래 가칭 경로를 그대로 확정하고 `GET /kb-sources/meta`(전송 전제·외부 RAG 상태·배지)·`GET /kb-sources/:id/runs/:runId`(진행률·예상 시간)를 더했다(13 핸들러 · 컨트롤러 2 · `KB_SYNC_ENABLED=false`면 전부 `404`). 오류 코드 +3(`KB_SOURCE_BUSY`·`KB_INGEST_NOT_ALLOWED`·`KB_HOST_NOT_ALLOWED`).
````

### D-14. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] NFR-KBS1 — `file_path` 봉인 범위

**찾을 원문**
````text
| NFR-KBS1 | 외부 RAG 파괴적 경로 문자열 0건 불변 · `file_path` 0건 · 작업 목록·취소 경로 0건(정적 검사). |
````
**바꿀 내용**
````text
| NFR-KBS1 | 외부 RAG 파괴적 경로 문자열 0건 불변 · ~~`file_path` 0건~~ **`file_path`·`force_sync` 송신 코드 0건(보유 파일 = 응답 파서 2개 고정 — R-3)** · 작업 목록·취소 경로 0건(정적 검사). |
````

### D-15. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] AC-KB1-2 — `file_path` 봉인 범위

**찾을 원문**
````text
- **AC-KB1-2** Then 정적 검사: 파괴적 경로 문자열 0 · `file_path` 0 · 작업 목록·취소 경로 0 · `RAG_PATHS` 키 5개 · `RAG_PATHS` 참조 파일 2개 불변.
````
**바꿀 내용**
````text
- **AC-KB1-2** Then 정적 검사: 파괴적 경로 문자열 0 · ~~`file_path` 0~~ **송신·`kb-sync`의 `file_path` 0(보유 파일 2 고정 — R-3)** · 작업 목록·취소 경로 0 · `RAG_PATHS` 키 5개 · `RAG_PATHS` 참조 파일 2개 불변.
````

### D-16. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] EX-KB-14 — 실행 중 설정 수정 규칙 확정

**찾을 원문**
````text
| 수정 저장 거부(먼저 중지) 또는 다음 실행부터 적용(architect) |
````
**바꿀 내용**
````text
| ~~수정 저장 거부(먼저 중지) 또는 다음 실행부터 적용(architect)~~ **[설계 확정 — R-14] 범위·스코프·개인정보 옵션(`configVersion`을 올리는 필드) 수정 = `409 KB_SOURCE_BUSY`(먼저 중지) · 이름·주기·인증·요청 간격·활성은 즉시 저장(다음 실행부터)** |
````

### D-17. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] §10 상위 문서 갱신 제안 — ADR 번호 확정

**찾을 원문**
````text
| `docs/02-spec/decisions/` | **ADR-0044(신규 가번호)** |
````
**바꿀 내용**
````text
| `docs/02-spec/decisions/` | **ADR-0044(신규 — 다음 빈 번호로 확정 · 작성 완료)** |
````

### D-18. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] §11 PM 확인 항목 — P 절 확정 표기

**찾을 원문**
````text
## 11. PM 확인이 필요한 항목
````
**바꿀 내용**
````text
## 11. PM 확인이 필요한 항목

> **PM 결정(2026-09-27) — 확정(2026-09-27, 추천안).** No.43 도입(2026-09-25) · P-1~P-12 전부 권고안 채택.
> - **P-1 (a)** 확정(2026-09-27, 추천안): 수집·변경 감지는 우리, 바뀐 것만 외부 RAG `POST /api/documents/ingest`로 전송 · 작업 개별 조회 · ADR-0022 §5 부분 재개(적재·작업 개별 조회 2경로만) · 수동 업로드(No.48)·삭제·초기화·전역 설정·프롬프트는 계속 만들지 않음
> - **P-2 (a)** 확정(2026-09-27, 추천안): 사내 HTML + 사이트맵 + 링크된 PDF·DOCX·XLSX·PPTX · 인증 없음 또는 환경변수 참조 고정 헤더
> - **P-3 (a)** 확정(2026-09-27, 추천안): 자동 삭제 없음 · "정리 필요" 표시 · `rag-allowlist.spec` 삭제 경로 봉인 유지
> - **P-4 (a)** 확정(2026-09-27, 추천안): 첫 회만 미리보기 확인 후 자동 반영 · 지식베이스는 No.40 환경 밖(즉시 반영)
> - **P-5** 확정(2026-09-27, 추천안): 전송 전제 게이트 `KB_INGEST_TRANSPORT_ACK`(내부망·인증·TLS 중 1 충족 시에만 적재)
> - **P-6** 확정(2026-09-27, 추천안): HTML 텍스트 마스킹 기본 · 원본 파일 그대로 전달은 기본 꺼짐
> - **P-7** 확정(2026-09-27, 추천안): api 서버에서 실행
> - **P-8** 확정(2026-09-27, 추천안): 신규 권한 0 · `security:write`
> - **P-9** 확정(2026-09-27, 추천안): 알림은 No.41 2차 · 1차는 콘솔 표시만
> - **P-10** 확정(2026-09-27, 추천안): 깊이 3 · 500쪽 · 파일 20MB · 호스트당 1초
> - **P-11** 확정(2026-09-27, 추천안): 1차/2차 분리 = §9 목록대로
> - **P-12** 확정(2026-09-27, 추천안): GPU 1 · 구축형 ○(전제 필요) · 구독형 △
>
> 표 아래 architect 확정 항목의 결정은 설계서 `docs/02-spec/kb-crawling-설계.md` §1 "(architect)" 행과 §21(R-1~R-30)을 따른다. ADR 번호는 **ADR-0044**(다음 빈 번호 — 가번호와 일치). ⚠ §12 PM 행의 **외부 RAG 담당자 확인 3건**은 아직 미결이다 — 확인 전 가정치와 결과별 변경은 설계서 §23(Q-1~Q-10).
````

### D-19. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] §11 architect 확정 사항 문단 — 완료 표식

**찾을 원문**
````text
> **architect 확정 사항**(권고안 제시):
````
**바꿀 내용**
````text
> **[2026-09-27 완료 — 설계서 §1 "(architect)" 행 · §21 R-1~R-30]** **architect 확정 사항**(권고안 제시):
````

### D-20. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] §12 인계 — PM 행 완료 표식 · 외부 확인 미결

**찾을 원문**
````text
| **PM** | ★ **P-1~P-4 결정**(§11.1 문구)
````
**바꿀 내용**
````text
| **PM** | **[2026-09-27 완료 — P-1~P-12 전부 추천안 · 외부 RAG 담당자 확인 3건은 미결(설계서 §23 Q-1·Q-2·Q-3 + 추가 Q-4~Q-10)]** ★ **P-1~P-4 결정**(§11.1 문구)
````

### D-21. [지식베이스 요구사항 `docs/requirements/kb-crawling.md`] §12 인계 — system-architect 행 완료 표식

**찾을 원문**
````text
| **`system-architect`** | ① **ADR-0022 재결정 갱신**(§1.5 표 그대로)
````
**바꿀 내용**
````text
| **`system-architect`** | **[2026-09-27 완료 — `docs/02-spec/kb-crawling-설계.md` · ADR-0044 · `kb-crawling-patches.md`]** ① **ADR-0022 재결정 갱신**(§1.5 표 그대로)
````

---

## E. 선행 요구사항 문서 — No.43 인계 정정

### E-1. [매칭 고도화 요구사항 `docs/requirements/nlu-rag-answering.md`] J-8(56행) — 적재 부분 재개 표기

**찾을 원문**
````text
이미 적재된 문서만으로도 2단계는 가치를 낸다. §4.4 |
````
**바꿀 내용**
````text
이미 적재된 문서만으로도 2단계는 가치를 낸다. §4.4 **[2026-09-27 No.43] 적재·작업 개별 조회 2경로는 지식베이스 자동 동기화(등록 소스 수집분) 전용으로 재개됐다 — 수동 업로드(No.48)·삭제·task 목록/취소는 계속 없음(`kb-crawling-설계.md` §5 · ADR-0044)** |
````

### E-2. [매칭 고도화 요구사항 `docs/requirements/nlu-rag-answering.md`] §4.4 선결 문제 7건(446행) — 처리 결과

**찾을 원문**
````text
**No.48 착수 시 반드시 먼저 풀어야 할 문제**(이번 문서가 남기는 인계):
````
**바꿀 내용**
````text
**No.48 착수 시 반드시 먼저 풀어야 할 문제**(이번 문서가 남기는 인계): **[2026-09-27 No.43 처리] 1·2(삭제)는 삭제를 계속 만들지 않아 해당 없음 · 3(진행률)은 문서 작업 행 개수로 · 4(`not_found`)는 1회 재전송 · 5(파일명 덮어쓰기)는 결정적 이름 `kb_<8>_<16>`로 · 6(HWP)은 수집 제외 · 7(옛 청크 잔존)은 "정리 필요" 표시로 — `kb-crawling-설계.md` §5.6. No.48(수동 업로드)은 계속 종결.**
````

### E-3. [업무 자동화 요구사항 `docs/requirements/workflow-automation.md`] 범위 밖(721행) — 운영 이벤트에 동기화 실패 추가

**찾을 원문**
````text
| **운영 이벤트**(예약 배포 실패 T-2 · 위험 동작 알림 T-3 · 설문 응답 수 도달·정기 리포트 T-5) |
````
**바꿀 내용**
````text
| **운영 이벤트**(예약 배포 실패 T-2 · 위험 동작 알림 T-3 · 설문 응답 수 도달·정기 리포트 T-5 · **[2026-09-27 No.43] 지식베이스 동기화 실패** — ADR-0044) |
````

---

## G. `docs/02-spec/nlu-rag-answering-설계.md` — P-3 재확인 문구 갱신

### G-1. [매칭 고도화 설계서 `docs/02-spec/nlu-rag-answering-설계.md`] P-3 재확인(652행) — No.43 부분 재개

**찾을 원문**
````text
재검토는 사용자가 No.48을 다시 꺼낼 때다.
````
**바꿀 내용**
````text
재검토는 사용자가 No.48을 다시 꺼낼 때다. **[2026-09-27 No.43 갱신] 사용자가 No.43(지식베이스 자동 크롤링/동기화)을 P-1 (a)로 확정해 적재·작업 개별 조회 2경로만 재개했다 — 업로드 화면(No.48)·삭제·task 목록/취소는 여전히 없다(`kb-crawling-설계.md` §5 · ADR-0044 · ADR-0022 부분 대체).**
````

### G-2. [매칭 고도화 설계서 `docs/02-spec/nlu-rag-answering-설계.md`] 범위 밖 표(891행) — 재검토 결과

**찾을 원문**
````text
| 사용자가 No.48을 다시 꺼낼 때 |
````
**바꿀 내용**
````text
| 사용자가 No.48을 다시 꺼낼 때 **[2026-09-27 No.43에서 적재·작업 개별 조회만 재개 — ADR-0044]** |
````

---

## F. 운영 문서

### F-1. [자동배포 `docs/05-ops/자동배포.md`] §5.7 신설 — 지식베이스 동기화(No.43) 운영 요구

**찾을 원문**
````text
5. **배포 후 확인**: 위젯 번들 gzip 증가 ≤6KB(빌드 로그) · 신버전 위젯의 메시지 요청 `features` 3개 · 챗봇 설정 "리치 메시지 주소 허용 목록" 화면(목록 밖 주소 노드 수 표시).
````
**바꿀 내용**
````text
5. **배포 후 확인**: 위젯 번들 gzip 증가 ≤6KB(빌드 로그) · 신버전 위젯의 메시지 요청 `features` 3개 · 챗봇 설정 "리치 메시지 주소 허용 목록" 화면(목록 밖 주소 노드 수 표시).

### 5.7 지식베이스 동기화(No.43) 운영 요구 (2026-09-27 추가)

`kb-crawling-설계.md` · ADR-0044. 지식베이스 동기화를 켜는 설치의 **운영 책임**이다.

1. **마이그레이션**: `20260927150000_kb_crawling`(`CREATE TABLE` 5개) 적용 뒤 원시 부분 유니크 인덱스 개수가 4 그대로인지 · 신규 테이블 5(`kb_sources`·`kb_documents`·`kb_sync_runs`·`kb_ingest_jobs`·`kb_job_leases`) · 외래 키 점검 0행을 확인한다.
2. **켜기 순서**: `KB_SYNC_ENABLED=true` → (사내 사이트면) `KB_CRAWL_PRIVATE_ALLOWLIST`에 사내 대역·호스트 → (거버넌스 모드면) `DATA_EGRESS_ALLOWED_HOSTS`에 크롤 대상 호스트 → 외부 RAG 전송 구간 확인 후 `KB_INGEST_TRANSPORT_ACK`. ACK가 없으면 등록·미리보기만 된다.
3. **전송 전제 확인 절차**: `INTERNAL_NETWORK` = 챗봇 서버와 외부 RAG가 같은 사내망(공인 IP 경유 없음)임을 네트워크 담당자가 확인 · `AUTHENTICATED` = 외부 RAG 앞단(역프록시·mTLS 등)이 인증을 강제함을 확인 · `TLS` = `RAG_BASE_URL`이 https(서버가 검증). 확인 기록을 설치 문서에 남긴다.
4. **첫 적재 전 형식·처리량 실측**: HTML 10쪽·PDF 5개로 형식(`KB_HTML_INGEST_FORMAT` — 외부 담당자 확인 전 기본 DOCX)·처리 시간을 실측하고 `KB_INGEST_CONCURRENCY`·`KB_INGEST_BULK_WINDOW`(예: `19:00-08:00`)를 정한다. **형식은 첫 적재 뒤 바꾸지 않는다**(바꾸면 외부에 옛 파일이 남는다).
5. **외부 RAG 운영자 합의**: 소스마다 **전용 서브카테고리** 사용 · `kb_`로 시작하는 파일 이름은 직접 업로드하지 않기 · "정리 필요" 표시가 쌓이면 외부에서 그 서브카테고리를 정리한 뒤 콘솔의 "전체 다시 적재(정리 완료 확인)"를 누르기.
6. **UA·권리**: `KB_CRAWL_USER_AGENT`에 관리자 연락처를 덧붙인다(예: `ChatBotKBCrawler/1.0 (+mailto:it@example.co.kr)`). 자사·계약상 이용 권한이 있는 사이트만 등록하고, 개인정보가 게시된 페이지는 제외 패턴으로 뺀다.
7. **배포 후 확인**: 콘솔 "지식베이스 동기화" 메뉴 표시 · 소스 1개 미리보기 성공 · 데이터 지도 "지식베이스 동기화" 절 · 적재 1건 성공 후 외부 RAG 질의로 근거 확인 · 서버 로그에 URL 쿼리·헤더 값이 없는지.
````

---

## Z. 적용 후 확인 체크리스트

- [ ] A-1~A-33 · B-1~B-6 · C-1~C-3 · D-1~D-21 · E-1~E-3 · G-1~G-2 · F-1 각 "찾을 원문"이 적용 전 대상 파일에서 **정확히 1회** 검색되는지(0회 = 파일이 그 사이 바뀜 → 이 문서를 갱신 후 적용). 특히 A-6의 `미도입 결정 20건`이 §3 머리 1곳뿐인지, A-9의 `(23 → 24테이블). 사전검사 16종은 불변이다(ADR-0002 갱신 각주, ADR-0043).**`가 §3.1 동반 삭제 줄 1곳뿐인지(§6 결정 44 줄과 문구가 다르다), A-12의 `…공개 표면이 없다(ADR-0022).`가 §4 옵션(RAG) 행 1곳뿐인지, A-22의 `(목록 밖 = 기동 실패 — ADR-0040 §2).**`가 §5 R-1 줄 1곳뿐인지, A-33의 `FR-RM1-\*~FR-RM8-\*, AC-RM1~RM7 |`(역슬래시 포함 원문)이 §7 ADR-0043 행 1곳뿐인지, B-1의 `- **상태**: 채택 (Accepted)`가 ADR-0022 3행 1곳뿐인지, C-3의 앵커가 106행(사용자 확인 결과)에만 있고 No.46 행의 "설계 완료(`docs/…` · ADR-0043).**"와 겹치지 않는지(앞의 `전부 추천안 · 설계 ` 포함 여부로 구분), D-18의 `## 11. PM 확인이 필요한 항목`이 요구사항 725행 1곳뿐인지, G-2의 `| 사용자가 No.48을 다시 꺼낼 때 |`가 설계서 891행 1곳뿐인지(652행 문장과 다름) 확인한다.
- [ ] 개발명세서 §2 표(A-1 — 2열)·§2.2 표(A-3 — 3열)·§3 표(A-5 — 3열 · 5행)·§4 표(A-11 — 3열)·§4.1 표(A-14~A-18 — 2열 셀 안 append · 끝의 ` |` 유지)·§5.1 표(A-25 — 5열 · 9행)·§7 표(A-32·A-33 — 3열)의 행이 열 개수를 유지하는지. A-5 대응 기능 열 `43` · A-11 `43`.
- [ ] 개발명세서 §3 엔터티 표에 `KbSource`~`KbJobLease` 5행이 `ChatbotRichUrlPolicy` 행 바로 뒤에 있는지 · §3 "미도입 결정 21건" 머리와 ㉑ 항목이 함께 있는지 · §5 보안의 지식베이스 봉인 하위 항목(A-23)이 통합 인박스 봉인 하위 항목 바로 뒤에 들여쓰기 2칸으로 있는지 · §5 성능 하위 항목(A-19)이 No.46 항목 바로 뒤인지 · §6에 결정 45가 44 바로 뒤에 빈 줄 하나를 두고 있는지 · §6 결정 27·35·41·42 아래 "갱신(2026-09-27 — No.43 …)" 각주가 각 1개이고 들여쓰기 4칸 목록인지 · §7 인덱스에 설계서·ADR-0044 행이 각 1개인지.
- [ ] `docs/01-requirements/기능요구사항.md` No.43 행(C-1 — 8열 · GPU 1 · 구축형 ○ · 구독형 △)과 No.30 행(C-2 — 8열)의 열 개수가 표 머리와 같은지 · §4-1 사용자 확인 결과 인용 블록 끝에 "No.43 … 범위·방식까지 확정" 문장이 1개인지(C-3).
- [ ] `docs/requirements/kb-crawling.md` 머리 도입 상태(D-1)·핵심 충돌 해소(D-2)·다음 단계(D-3)·§1.10 머리(D-4)·**§11 머리의 P-1~P-12 "확정(2026-09-27, 추천안)" 표기(D-18)**가 있는지 · FR 표(FR-0-204·208·212, FR-KB1-5, FR-KB2-10, FR-KB4-4, FR-KB5-1·5-4)·NFR-KBS1·EX-KB-14·§10·§12 표의 셀 구조가 깨지지 않는지 · 취소선(D-9·D-14·D-15·D-16)이 셀 구조를 깨지 않는지 · 가번호 "ADR-0044"는 실제 번호와 같으므로 정정 표기가 아니라 "확정" 표기인지(D-17).
- [ ] ADR-0022 3행 상태 줄(B-1)과 파일 끝 "갱신 (2026-09-27 — No.43 …)" 절(B-2 — No.45 절 다음)이 각 1개인지 · ADR-0040(No.42 절 다음)·ADR-0041(No.42 절 다음)·ADR-0034(No.46 절 다음)·ADR-0013(No.42 절 다음) 끝에 No.43 갱신 절이 각 1개인지.
- [ ] `docs/05-ops/자동배포.md` §5.7이 §5.6 다음, 파일 끝 주석(있다면) 앞에 있는지.
- [ ] **⚠ 사용자 확인 필요(설계 판단 — 구현 착수 전)**: ① **적재를 새 출구 클래스로 나누지 않는다**(요구사항 J-11·FR-0-208의 분리 권고와 다름 — 데이터 지도 `kbSources` 절로 대체 · R-2) ② **신규 의존성 3개**(`htmlparser2`·`fflate`·`pdfjs-dist` — 특히 `pdfjs-dist`는 설치 크기 수십 MB · 원본 파일 PII 사전 검사용이며 빼면 PDF 사전 검사 없이 원본 전송 여부만 판단 · R-16·R-17) ③ **공유 전송 부품 이동 연기**(ADR-0041 트리거 발동이지만 독립 리팩터로 분리 · R-15) ④ **루프 주기 기본 10초**(요구사항 60초 · R-11) ⑤ **HTML 변환 기본 DOCX**(외부 담당자 확인 전 — R-4) ⑥ **`file_path` 봉인 범위 정밀화**(요구사항 "저장소 0건"은 기존 코드와 충돌 — R-3). 사용자가 원안을 고수하면 설계서 해당 절·R-n·ADR-0044 해당 문장·D-5·D-6·D-10·D-11·D-14·D-15를 되돌린다.
- [ ] **⚠ 외부 RAG 담당자 확인(미결)**: 설계서 §23 Q-1(HTML·TXT 적재 지원)·Q-3(운영 전송 구간)·Q-4(같은 이름·다른 스코프 재적재 시 옛 청크)·Q-6(처리 시간 실측)·Q-7(적재가 질의 품질·지연에 주는 영향)을 우선 확인한다. 확인 전에는 가정치(DOCX · ACK 없음 = 적재 불가 · 스코프 변경 시 정리 필요 · 직렬 1 · BULK 시간창 권장)로 구현·시험한다.
- [ ] `CLAUDE.md`의 "구현 완료 기능"·"다음 단계"·"보완 8종 … 사용자 확인 대기 중" 문구는 **이 패치의 범위가 아니다** — 에이전트는 `CLAUDE.md`를 수정하지 않으며(작업 트리의 미커밋 수정 보존), 반영 여부는 사용자가 직접 결정한다.
- [ ] 화면 명세 `docs/03-design/kb-crawling-ui-spec.md`(메뉴·배지 · 소스 목록 · 등록 폼(용어 풀이·거버넌스 비활성 사유·권리 확인) · 미리보기·적재 시작 확인 · 실행 진행(텍스트 진행률·상태 변화 시에만 알림) · 문서 목록 · 정리 필요 안내·전체 다시 적재 · 챗봇 답변 설정 카드 · 데이터 지도 절)는 **ui-designer 단계**에서 한다. 새 UIUX 규칙은 필요 없다(기존 "비동기 대기 패턴"·"실시간 목록 갱신"·폼 규칙으로 충족 — 설계서 §12).
- [ ] `docs/04-test/시험항목.md`에 TC-43(AC-KB1~KB7)을 추가하고, `API_RAG.md` 응답 예시 픽스처 · 가짜 사이트(robots·사이트맵·리다이렉트·EUC-KR·noindex) 픽스처 · OOXML 압축 폭탄·매크로·암호 PDF 픽스처 · 다중 인스턴스 선점 절차를 `시험데이터.md`·`자동시험_전략.md`에 추가하는 일은 **test-automation 단계**에서 한다.
- [ ] 설치 가이드(사설 허용 목록 · 전송 전제 확인 절차 · 출구 허용 목록 · UA · 권리 확인 · 첫 적재 소요 시간·시간창 · 외부 RAG 운영자 합의 사항)는 **deployment-engineer 단계**에서 작성한다(F-1 §5.7이 요구 사항을 먼저 기록했다).
- [ ] 코드 쪽 기대값 변경(설계서 §17.3 X-1·X-2)은 **구현 단계에서** 반영한다. 그 밖의 기존 시험이 깨지면 회귀로 취급한다(커밋 ①·②·④에서 X 외 변경이 생기면 멈추고 보고).
- [ ] 코드 쪽 주석(`egress-registry.ts` 머리 "출구 5클래스"(→ 7) · `egress-guard.ts` 머리 "5클래스 6파일" · `legacy-transport.port.ts` 머리(세 번째 소비자 · 선택 필드 2) · `node-http.transport.ts` 머리(리다이렉트 불추종 — `REPORT` 모드 병기) · `rag-paths.ts`·`rag-http.client.ts` 머리 "allowlist 3개뿐"·"공개 메서드는 정확히 3개"(→ 5) · `governance-sealing.spec.ts` G-1 제목 "6파일"(서술 — 선택) · `public-decorator-count.spec.ts` 제목(46 → 48 — X-2))은 **구현 단계에서** No.43 내용으로 갱신한다.
