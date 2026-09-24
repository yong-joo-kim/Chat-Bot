# No.26 레거시 API 연동 — 기존 문서 패치 목록

> 작성: system-architect · 2026-09-24 · 근거: `docs/02-spec/legacy-api-integration-설계.md`, `docs/02-spec/decisions/ADR-0034-legacy-api-connection-registry-and-engine-suspension.md`
> **적용 상태**: ✅ **적용 완료(2026-09-24)** — 오케스트레이터 세션이 47건 전부 "찾을 원문 정확히 1회" 확인 후 기계적으로 적용했다.
> **적용 방법**: 각 항목의 "찾을 원문"을 대상 파일에서 **정확히 1회** 찾아 "바꿀 내용"으로 교체한다. 모든 원문은 2026-09-24 시점 파일(No.29 패치 적용 후)에서 복사했고 문자열 검색(Grep)으로 대상 파일 안 유일성을 확인했다. "append" 항목은 원문을 그대로 포함한 채 뒤에 덧붙인다.
> **줄바꿈 주의**: 대상 파일은 CRLF일 수 있다. 모든 "찾을 원문"은 **한 줄 안의 부분 문자열**(줄바꿈 미포함)로 잡았다. "바꿀 내용"의 줄바꿈은 대상 파일의 줄바꿈으로 정규화한다.
> **순서 독립**: 어떤 "바꿀 내용"도 다른 항목의 "찾을 원문"을 새로 만들지 않는다.
> 코드 변경은 이 파일의 범위가 아니다 — 설계서 §2.5 체크리스트를 따른다.
> 항목 수: 개발명세서 29 · ADR 9 · 기능요구사항 2 · 선행 요구사항 2 · UI 스펙 3 · 레거시 API 연동 요구사항(PM 결정 기록) 2 = **47건**

---

## A. `docs/02-spec/개발명세서.md`

### A-1. §2 워크스페이스 상태 표 — `api-connections`·`legacy-api` 행 추가

**찾을 원문**
````text
신규 환경변수 0개**(ADR-0033) |
````
**바꿀 내용**
````text
신규 환경변수 0개**(ADR-0033) |
| **`apps/api/src/api-connections`**(+ `catalog/`) · **`apps/api/src/legacy-api`** | **레거시 API 연동 Phase에 신설**(No.26) — 전역 연결 레지스트리(ADMIN)·읽기 전용 카탈로그·레거시 호출 유일 출구(`LegacyApiHttpClient` — SSRF 다층 방어·DNS 후 주소 고정)·메타데이터 전용 `ApiCallLog`. **`packages/dialogue-engine`을 닫힌 목록으로 수정**(v2 `API_CONDITION` 정지점 · 순수 재진입 `resumeAfterApiCall` · 참조 편입 — 엔진 I/O 0건 정적 검사) · **ml-worker·widget 변경 0건 · `@Public()` 추가 0건 · 신규 권한 0종 · 시크릿 DB 미저장**(ADR-0034) |
````

### A-2. §2.1 외부 HTTP 출구 규약 — 3곳 → 4곳

**찾을 원문**
````text
1곳**뿐이다(총 **3곳**).
````
**바꿀 내용**
````text
1곳**, **레거시 시스템(No.26 — 관리자가 등록한 연결)으로 나가는 HTTP는 `legacy-api/legacy-api-http.client.ts` 1곳**뿐이다(총 **4곳**). **[No.26] 레거시 출구는 임의 URL 문자열을 받지 않고 `build-request.ts`만 만들 수 있는 브랜드 타입 요청(`ValidatedLegacyRequest`)만 받으며, `node:http(s)` import는 전송 구현 1파일로, `LEGACY_API_SECRET__` 참조는 시크릿 리졸버 1파일로 봉인한다(ADR-0034 §4).**
````

### A-3. §2.2 기능그룹별 모듈 배치 표 — No.26 행 추가

**찾을 원문**
````text
**설계 완료 → `integrated-stats-설계.md`** |
````
**바꿀 내용**
````text
**설계 완료 → `integrated-stats-설계.md`** |
| **레거시 API 연동 (No.26)** | **`api-connections`(신규 — 연결 CRUD·연결 테스트·참조 409·감사) + `api-connections/catalog`(신규 — ★읽기 전용 카탈로그: 호출 시 연결 조회·목 원천·설계 점검 정보, 외부 출구 없음) + `legacy-api`(신규 — `LegacyApiService`(턴 완결·연결 테스트)·★유일 출구 `LegacyApiHttpClient`·시크릿 리졸버(★`LEGACY_API_SECRET__` 1파일)·연결 단위 게이트·`node:http(s)` 전송 1파일·`ApiCallLog` 적재/조회, export 2개뿐)** + `packages/dialogue-engine`(닫힌 목록 수정 — 정지점·재진입·참조 편입) · `conversation`(④.5 턴 완결·RAG 제외·미응답 제외) · `simulation`(MOCK/LIVE·비교 목) · `validation`(TC 목 — 카탈로그만) · `dialog-nodes`(v1 쓰기 거부·응답 가림·API 참조 검증) · `dialogue-common`(삭제 409 규칙 1벌) · `versions`(가림·무결성·복원 경고 3종) · `chatbots`(영구삭제 동반 삭제 15테이블) | **설계 완료 → `legacy-api-integration-설계.md`** |
````

### A-4. §2.2 주석 블록 — 엔진 확장·모듈 의존 방향(No.26) 추가

**찾을 원문**
````text
**추가 조회 0건**이다(ADR-0033 §4).
````
**바꿀 내용**
````text
**추가 조회 0건**이다(ADR-0033 §4).
>
> **엔진 확장(레거시 API 연동 No.26)**: 이 그룹은 FR-0-78·88 "엔진 불가침"의 **의도된 예외**로 엔진을 수정하되 **닫힌 목록**으로 한정한다 — ① `executeOutputs`의 v2 `API_CONDITION` 정지점(뒤 아웃풋 미실행 · 턴당 호출 1회) ② 순수 재진입 `resumeAfterApiCall()`(매핑·조건 판정·분기 노드 실행·`{api.*}` 텍스트 치환) ③ 경로 추출·조건 판정·치환 순수 함수(웹 미리보기와 공유하기 위해 `shared-types/api-mapping.ts`에 두고 엔진은 import) ④ `getOutgoingNodeRefs()`의 `apiTargets` 편입(참조 무결성 4곳) ⑤ `resolveTurn` 결과의 선택 필드 `apiCall?`(정지 시 **실패 가정 폴백 결과 동봉**). 엔진은 여전히 **I/O·타이머·`fetch`·`process.env`·Nest·Prisma 심볼 0건**이며 `legacy-api-sealing.spec.ts` L-5가 단언한다. API 노드가 없는 번들의 모든 소비자 결과는 바이트 단위로 불변이다(ADR-0034 §1).
>
> **모듈 의존 방향(No.26)**: `api-connections → catalog / legacy-api / audit-logs` · `legacy-api → catalog / prisma / config` · `conversation｜simulation → legacy-api` · `simulation｜validation｜dialog-nodes → catalog` 단방향이다. **`LegacyApiModule`은 `LegacyApiService`·`ApiCallLogService`만 export**하며 HTTP 클라이언트·전송·시크릿 리졸버·게이트는 주입 자체가 불가능하다. **`validation`·`versions`·`deploy-schedules`는 `legacy-api`를 import하지 않는다** — TC·비교는 읽기 전용 카탈로그의 샘플 응답으로 **목 판정만** 하고, 버전 복원 경고는 Prisma 읽기로 연결 존재만 확인한다(FR-0-102, ADR-0030 형식).
````

### A-5. §3 엔터티 표 — `AuditLog` 행의 `ApiCallLog` 분리 예고를 완료로

**찾을 원문**
````text
No.26 착수 시 `ApiCallLog`로 분리한다**(ADR-0016) | 13 |
````
**바꿀 내용**
````text
No.26에서 `ApiCallLog`로 분리했다 — 메타데이터 전용, 원문·헤더·치환 URL 컬럼 없음**(ADR-0016, ADR-0034 §6) | 13, 26 |
````

### A-6. §3 엔터티 표 — `ApiConnection`·`ApiCallLog` 행 추가

**찾을 원문**
````text
결과 테이블을 나누지 않는다 | 28 |
````
**바꿀 내용**
````text
결과 테이블을 나누지 않는다 | 28 |
| **`ApiConnection`** | **레거시 API 연결 레지스트리(No.26, 전역 — 챗봇 스코프 아님, ADR-0034 §2).** 이름(`nameNormalized` 전역 유일)·기준 URL(사용자정보·쿼리·프래그먼트 금지)·허용 메서드(GET/POST)·인증 방식(`NONE`/`API_KEY_HEADER`/`BEARER`/`BASIC`)·`secretRef`·타임아웃(1~10초)·분당 레이트리밋·`allowRawPersonalData`·`personalDataLookup`·목 전용 샘플 응답(≤5개·각 16KB)·사용 여부. **★ 시크릿 값 컬럼이 없다** — 값은 환경변수 `LEGACY_API_SECRET__<secretRef>`에만 있고 리졸버 1파일만 읽는다. 쓰기 주체 = `ApiConnectionsService` 1파일(ADMIN, `security:write`). 노드 → 연결 참조는 `outputs` JSON 안(FK 없음 — 참조 중 삭제 `409 API_CONNECTION_IN_USE`, 스냅샷 참조는 막지 않음). **스냅샷 대상이 아니다**(금지어·채널과 같은 전역 설정) | 26 |
| **`ApiCallLog`** | **레거시 API 호출 관측 로그(No.26 — ADR-0016 §5 예고의 실체화, ADR-0034 §6).** 연결 id·이름 스냅샷·챗봇·노드·대화로그 id·출처(`PUBLIC`/`SIMULATION_LIVE`/`CONNECTION_TEST`)·메서드·**치환 전 경로 템플릿**·결과 코드(18종)·HTTP 상태·지연·응답 바이트·분기·마스킹 여부·`dayBucket`. **치환된 URL·쿼리·헤더·요청/응답 본문·바인딩 값·응답 값 컬럼이 존재하지 않는다**(정적 검사). 쓰기 주체 = `ApiCallLogService.record()` 1곳(fire-and-forget). 시뮬레이터 목·TC·비교는 기록하지 않는다. FK 없음 · 자동 보존 정리 없음(No.45) | 26 |
````

### A-7. §3 엔터티 표 — `DialogNode` 행에 `API_CONDITION` v1/v2 규약

**찾을 원문**
````text
아웃풋 12종은 JSON(ADR-0005) | 5 |
````
**바꿀 내용**
````text
아웃풋 12종은 JSON(ADR-0005). **[No.26] `API_CONDITION` payload는 읽기 = v2(`version: 2` — `connectionId` + 상대 경로 + 구조적 바인딩 + 응답 매핑 + 기본/실패 분기, 헤더·URL 필드 없음) ∪ v1(No.5 인라인 URL/헤더 — 실행 안 함), 쓰기 = v2만(`400 API_OUTPUT_LEGACY_FORMAT`). v1은 자동 변환·삭제하지 않고 조회 응답에서 헤더 값·본문 템플릿을 가린다(ADR-0034 §7)** | 5, 26 |
````

### A-8. §3 미도입 결정 ⑤ — `ApiCallLog` 도입 보론

**찾을 원문**
````text
기록 대상인 No.26이 미구현이라 쓰기 주체가 없다.
````
**바꿀 내용**
````text
~~기록 대상인 No.26이 미구현이라 쓰기 주체가 없다.~~ **[해소 2026-09-24 No.26] 쓰기 주체가 생겨 도입했다 — 단 요청·응답 원문·헤더·치환된 URL 컬럼은 계속 만들지 않는다(메타데이터 전용, ADR-0034 §6). 시크릿 저장 테이블·원문 디버그 로그·호출 결과 캐시·챗봇↔연결 허용 조인·재시도 큐·대화 세션 변수 저장소는 미도입.**
````

### A-9. §3.1 참조 무결성 — FK 미설정 예외에 `ApiCallLog` 추가

**찾을 원문**
````text
**`ConversationLog.groupId`**(No.29 — 대화 당시 그룹 스냅샷.
````
**바꿀 내용**
````text
**`ApiCallLog`의 `chatbotId`/`connectionId`/`nodeId`/`conversationLogId`**(No.26 — 연결·노드가 삭제돼도 호출 기록은 사실 기록으로 남는다), **`ConversationLog.groupId`**(No.29 — 대화 당시 그룹 스냅샷.
````

### A-10. §3.1 파생 데이터 동반 삭제 — `ApiCallLog` 추가(14 → 15테이블)

**찾을 원문**
````text
**`DeploySchedule`도 같은 분류**다(No.28 — 13 → 14 테이블).
````
**바꿀 내용**
````text
**`DeploySchedule`도 같은 분류**다(No.28 — 13 → 14 테이블). **`ApiCallLog`도 같은 분류**다(No.26 — 14 → 15 테이블, `RagCallLog`와 같은 처리 — ADR-0033의 로그 삭제 봉인은 `ConversationLog`·`UnansweredQuestion` 대상이라 저촉되지 않는다). **`ApiConnection`은 전역 설정이라 챗봇 영구삭제와 무관하다.**
````

### A-11. §3.1 인덱스 — No.26 인덱스 추가

**찾을 원문**
````text
**`conversation_logs.answeredByRag`에는 인덱스를 두지 않는다**
````
**바꿀 내용**
````text
**[No.26] `api_connections(nameNormalized) UNIQUE`, `api_connections(updatedAt)`, `api_call_logs(chatbotId, dayBucket)`(호출 로그 기간 필터), `api_call_logs(chatbotId, createdAt)`, `api_call_logs(connectionId, createdAt)`(연결 목록 24시간 통계).** **`conversation_logs.answeredByRag`에는 인덱스를 두지 않는다**
````

### A-12. §4 API 표 — 연동 행 구체화(`/legacy-apis` → `/api-connections`)

**찾을 원문**
````text
| 연동 | `/legacy-apis`, `/surveys` | 26, 27 |
````
**바꿀 내용**
````text
| **레거시 API 연동** | **`/api-connections`(GET 목록·POST 생성 — `security:read｜write`), `GET /api-connections/picker`(편집기 선택 목록 — `dialogue:read`, URL·시크릿 참조 미포함 · ⚠ `:id`보다 먼저 선언), `GET｜PATCH｜DELETE /api-connections/:id`(삭제는 참조 중 `409 API_CONNECTION_IN_USE`), `GET /api-connections/:id/samples`(목 샘플 — `dialogue:read`), `POST /api-connections/:id/test`(실제 GET 1회 · 본문 미반환 — `security:write`), `GET /chatbots/:chatbotId/api-call-logs`(+`/summary` — `chatbot:read`)**. 총 10개 핸들러 · 신규 권한 0종 · **`@Public()` 추가 0건 · 레거시 프록시 경로 0건** | 26 |
| 연동(설문) | `/surveys` | 27 |
````

### A-13. §4 API 표 — 품질/시뮬레이션 행에 `apiMode` 확장

**찾을 원문**
````text
(**2단계 미실행**) | 10 |
````
**바꿀 내용**
````text
(**2단계 미실행**). **[No.26] `simulate` 요청에 `apiMode`(`MOCK` 기본｜`LIVE`)·`mockResponse`, 응답에 `apiStep`(변수는 마스킹) — LIVE는 `simulation:write`·GET·저장본과 동일한 노드일 때만(불충족은 MOCK 격하). `compare`는 A/B 같은 목** | 10, 26 |
````

### A-14. §4 정정 이력 — 2026-09-24b 항목 추가

**찾을 원문**
````text
③ 신규 `ApiErrorCode` 0종 · 공개 경로 6곳 불변(`integrated-stats-설계.md` §8).
````
**바꿀 내용**
````text
③ 신규 `ApiErrorCode` 0종 · 공개 경로 6곳 불변(`integrated-stats-설계.md` §8).
> **정정 이력(2026-09-24b — 레거시 API 연동)**: ① 예고 행 `/legacy-apis`를 **`/api-connections` 8개 + 챗봇 스코프 `/api-call-logs` 2개**로 구체화했다 — 자원은 "API"가 아니라 관리자가 등록한 **연결**이며, 호출 로그는 챗봇 스코프 규약(교차 접근 404)을 따른다. ② `/surveys`(No.27)는 별도 행으로 분리했다. ③ 레거시 호출은 공개 표면이 없다 — **프록시 경로를 만들지 않는다**(ADR-0022 §8과 같은 이유, FR-0-100). ④ 신규 `ApiErrorCode` 2종 · 공개 경로 6곳 불변(`legacy-api-integration-설계.md` §12).
````

### A-15. §4.1 오류 봉투 — No.26 오류 코드 2종

**찾을 원문**
````text
2단계 실패는 전부 폴백으로 수렴해 공개 API가 오류를 반환하지 않는다 |
````
**바꿀 내용**
````text
2단계 실패는 전부 폴백으로 수렴해 공개 API가 오류를 반환하지 않는다. **레거시 API 연동 그룹이 2종 추가** — `API_OUTPUT_LEGACY_FORMAT`(400, v1 인라인 URL/헤더 형식 `API_CONDITION` 저장 시도), `API_CONNECTION_IN_USE`(409, 노드가 참조 중인 연결 삭제). 존재하지 않는 연결·분기 노드·폼 슬롯은 기존 `INVALID_REFERENCE`(404), 원문 송신 확인값 불일치는 `CONFIRM_NAME_MISMATCH`(400)를 재사용한다. **외부(레거시) 호출 실패도 공개 API 오류가 아니다** — 실패 분기 노드 또는 고정 안내 문구로 수렴한다 |
````

### A-16. §5 성능 — No.26 항목 추가

**찾을 원문**
````text
미달 시 커버링 인덱스 1차 완화 → 롤업 재검토(ADR-0033 §7).
````
**바꿀 내용**
````text
미달 시 커버링 인덱스 1차 완화 → 롤업 재검토(ADR-0033 §7).
  - **[신규 2026-09-24 — 레거시 API 연동] API 노드가 없는 턴의 공개 대화 예산(P95 500ms)은 불변**이다(추가 조회·계산 0 — 엔진 결과의 `apiCall` 유무 분기 1개). **API 턴은 별도 예산** — P95 ≤ 기존 예산 + 외부 응답 시간 + 우리 오버헤드 **50ms**(연결 PK 조회·DNS 해석·IP 판정·파싱·매핑·재진입), **최악 = 연결 타임아웃(기본 3초·최대 10초) + 500ms**. **턴당 외부 호출 1회 · 재시도 0**(N+1 금지 — RAG 1회 규약과 같다). 회로 개방·레이트 초과·사용 중지·시크릿 미설정·바인딩 누락은 **외부 대기 없이 10ms 이내** 실패 분기. 경로 추출·조건·치환 5ms(256KB·매핑 20·조건 10). 연결당 동시 10·전체 50 상한으로 외부 지연이 다른 API P95를 **20% 이상** 늘리지 않는다. TC 처리량 500 TC/분 불변(목 = 순수 함수). 호출 로그 목록 P95 300ms · 요약(30일) 1초. **예산 미달을 이유로 타임아웃 상한을 조용히 올리지 않는다**(ADR-0034 §5).
````

### A-17. §5 보안 — "연동 착수 시점에 결정" 문구의 결정 기록

**찾을 원문**
````text
연동 착수 시점에 암호화·시크릿 관리 방식을 먼저 결정한다.
````
**바꿀 내용**
````text
연동 착수 시점에 암호화·시크릿 관리 방식을 먼저 결정한다. **[결정 2026-09-24 No.26] 레거시 연동 시크릿은 DB에 저장하지 않고 환경변수 참조(`secretRef` → `LEGACY_API_SECRET__<REF>`)로만 주입한다** — 읽는 곳은 리졸버 1파일, 값은 응답·로그·감사·스냅샷·`ApiCallLog` 어디에도 없다. DB 암호화 저장은 No.45 필드 암호화와 함께 재검토한다(ADR-0034 §3).
````

### A-18. §5 보안 — 레거시 연동 봉인 항목 추가

**찾을 원문**
````text
그때 ADR-0033 §3의 롤업 선적재 규약을 따른다.
````
**바꿀 내용**
````text
그때 ADR-0033 §3의 롤업 선적재 규약을 따른다.
  - **[신규 2026-09-24] 레거시 API 연동의 봉인(ADR-0034)**: ① **SSRF 다층 방어**(NFR-S4 재정의) — 등록된 연결만 · `http`/`https` · WHATWG `URL` 정규화 후 조립·재파싱 동일성 검증(경로 이탈·호스트 변경·CRLF 차단) · **DNS 해석 1회 후 해석된 모든 주소를 검사하고 검증된 주소로만 소켓 연결**(재바인딩 방지) · **루프백·링크로컬·메타데이터·`0/8`·멀티캐스트·예약 대역은 절대 차단**(IPv4 매핑·NAT64·6to4 내장 주소 포함 — 설정으로 열 수 없다) · **사설 대역은 운영자 환경변수 allowlist로만**(기본 빈 목록) · 리다이렉트 불추종 · 응답 256KB 스트림 상한 · JSON만. ② **외부 HTTP 출구 4번째** — `LegacyApiHttpClient` 1클래스이며 `build-request.ts`만 만들 수 있는 브랜드 타입 요청만 받는다(임의 URL 불가). ③ **PII 적용 지점 4번째**(레거시 송신 — 폼 슬롯 값 기본 마스킹, 연결 단위 `allowRawPersonalData`는 ADMIN·확인값·감사로만). ④ **사용자 입력 URL 규약 보강** — 레거시 호출의 호스트는 관리자가 등록한 연결만 가능하고, 외부 응답값은 URL 필드에 치환하지 않는다(텍스트 필드만). ⑤ `ApiCallLog`에 원문 컬럼 0 · 서버 로그에 해석된 URL·바인딩 값·헤더·본문·예외 메시지 원문 0. ⑥ v1 `API_CONDITION`의 평문 헤더는 노드·버전 조회 응답에서 가린다(VIEWER 열람 해소). ⑦ 위 전부를 `legacy-api-sealing.spec.ts` **L-1~L-14**로 강제한다.
````

### A-19. §5 확장성 — 연결 단위 게이트(단일 인스턴스 상태)

**찾을 원문**
````text
도입의 재검토 트리거는 챗봇당 2만 벡터 초과다.**
````
**바꿀 내용**
````text
도입의 재검토 트리거는 챗봇당 2만 벡터 초과다.** **[No.26] 레거시 API 연동이 추가한 단일 인스턴스 상태는 연결 단위 회로·레이트·동시성 카운터 1종(`LegacyApiGateService` — 인터페이스 1곳)** 이며 다중 인스턴스에서는 인스턴스별 한도다(RAG 게이트와 같은 수용). 연결 정보는 캐시하지 않는다(API 턴마다 PK 1회 조회 — 사용 중지 즉시 반영).
````

### A-20. §5 가용성 — 외부 시스템 장애 수렴

**찾을 원문**
````text
운영 시간대 한가운데서의 뒤늦은 반영 방지 — ADR-0032 §4).
````
**바꿀 내용**
````text
운영 시간대 한가운데서의 뒤늦은 반영 방지 — ADR-0032 §4). **[신규 2026-09-24] 레거시(외부) 시스템 장애는 대화 실패가 아니다** — 타임아웃·5xx·네트워크 오류·회로 개방·설정 문제는 전부 관리자가 지정한 실패 분기 노드 또는 고정 안내 문구로 수렴하며, 연속 인프라 실패 5회 → 60초 회로 개방으로 외부 장애가 우리 서버로 번지지 않는다(4xx는 실패로 세지 않는다 — 익명 입력으로 회로를 여는 것 방지). 레거시 서비스의 예외는 응답 경로 밖으로 새지 않는다(ADR-0034 §5).
````

### A-21. §5.1 환경변수 표 — No.26 변수 추가

**찾을 원문**
````text
미만이면 기동 시 경고 + 하한으로 보정 |
````
**바꿀 내용**
````text
미만이면 기동 시 경고 + 하한으로 보정 |
| **`LEGACY_API_ENABLED`** | `apps/api/.env` | — | `true` | 레거시 API 연동 스위치(No.26). `false`면 대화·연결 테스트·시뮬레이터 LIVE 전부 `FEATURE_DISABLED`(**아웃바운드 0** — 구축형 폐쇄망 증명). `true｜false｜1｜0` 명시 파서 |
| **`LEGACY_API_PRIVATE_ALLOWLIST`** | `apps/api/.env` | — | (빈 값) | 사설·내부 대역 허용 목록(쉼표 구분 CIDR·정확한 호스트명). **절대 차단 대역(루프백·링크로컬·메타데이터)은 기재해도 무시** + 기동 경고. 잘못된 항목도 무시 + 경고(기동 실패 아님) |
| **`LEGACY_API_DEFAULT_TIMEOUT_MS`** | `apps/api/.env` | — | `3000` | 연결 생성 시 기본 타임아웃(1000~10000) |
| **`LEGACY_API_MAX_TIMEOUT_MS`** | `apps/api/.env` | — | `10000` | 연결 타임아웃 상한(1000~10000) — 저장값이 더 크면 호출 시 `min()` |
| **`LEGACY_API_MAX_RESPONSE_BYTES`** | `apps/api/.env` | — | `262144` | 응답 본문 상한(1024~1048576) |
| **`LEGACY_API_CIRCUIT_FAILURE_THRESHOLD`** | `apps/api/.env` | — | `5` | 연결 단위 연속 인프라 실패 수(4xx 미산입) |
| **`LEGACY_API_CIRCUIT_OPEN_MS`** | `apps/api/.env` | — | `60000` | 회로 개방 유지 |
| `LEGACY_API_SECRET__<REF>` | `apps/api/.env` | — | — | 연결 시크릿(연결의 `secretRef`별). **`EnvSchema`에 등록하지 않고** 리졸버 1파일이 접두사 규약으로 직접 읽는다. 값을 로그·오류·응답에 출력 금지 |
````

### A-22. §5.1 환경변수 주석 — No.26 문단 추가

**찾을 원문**
````text
(검증 0건 게이트)를 **연속 실행**한다.
````
**바꿀 내용**
````text
(검증 0건 게이트)를 **연속 실행**한다.
> **레거시 API 연동 그룹(No.26)이 추가한 7개도 전부 선택이며 API 전용이다(ml-worker 변수 추가 0건).** 하나도 설정하지 않으면 연동 활성 · 사설 대역 전부 거부 · 타임아웃 3초/상한 10초 · 응답 256KB · 회로 5회/60초로 정상 기동하고, **시크릿이 필요한 연결은 `SECRET_MISSING` 실패 분기**가 된다(기동 실패 아님). 시크릿은 `LEGACY_API_SECRET__<REF>` 접두사 규약이며 변수 목록에 값을 적지 않는다. **seed는 데모 연결 1건(`https://legacy.example.invalid/api` — 해석되지 않는 예약 도메인이라 실호출 0)과 v2 데모 노드를 만든다.** 배포 직후 `prisma/scripts/report-legacy-api-conditions.ts`(읽기 전용)로 v1 `API_CONDITION` 잔존 건수를 계측한다.
````

### A-23. §6 결정 13 — 실행 가능 판정 = 형태(갱신 각주)

**찾을 원문**
````text
3종은 실행하지 않고 `unsupportedOutputs`로 보고한다. → **ADR-0008**
````
**바꿀 내용**
````text
3종은 실행하지 않고 `unsupportedOutputs`로 보고한다. → **ADR-0008**
    - **갱신(2026-09-24 — No.26)**: `API_CONDITION`의 실행 가능 여부는 **타입이 아니라 형태로** 판정한다 — v2(`version: 2`, 연결 참조)는 실행하고 v1(인라인 URL/헤더)은 기존과 바이트 단위로 같은 미지원 처리를 유지한다. `UNSUPPORTED_OUTPUT_TYPES`는 `['SCENARIO','SURVEY']`로 줄고 판정은 공용 함수 `isUnsupportedOutput()`(엔진·설계 점검·웹 배지 공용)가 한다. ADR-0008 §4의 "상수에서 값을 빼는 것만으로 열린다"는 예고는 **성립하지 않았다**(호출 자리 없음 · v1 인라인 시크릿 · 웹 배지 하드코딩) — ADR-0008 갱신 각주, ADR-0034 §1·§7.
````

### A-24. §6 결정 18 — PII 적용 지점 4번째(갱신 각주)

**찾을 원문**
````text
복제 0건임을 코드리뷰·테스트가 확인한다(ADR-0026 §3).
````
**바꿀 내용**
````text
복제 0건임을 코드리뷰·테스트가 확인한다(ADR-0026 §3).
    - **갱신(2026-09-24 — No.26)**: **레거시 API 송신이 네 번째 적용 지점**이 된다(저장 · RAG 송신 · 증강 송신 · 레거시 송신). 레거시 송신만 **연결 단위 예외**(`allowRawPersonalData` — ADMIN·연결 이름 재입력 확인·감사)를 가진다 — 전화번호·주문번호로 조회하는 연동은 원문이 없으면 동작하지 않기 때문이다. 관리자 작성 상수 바인딩은 비적용(TC 문장 비적용 선례). 로그·trace·`ApiCallLog`에는 예외 없이 원문 0이며 시뮬레이터의 응답 변수 표시도 마스킹한다. **함수는 여전히 1벌**(ADR-0013 갱신 각주, ADR-0034 §9).
````

### A-25. §6 결정 20(권한) — No.26 갱신 각주

**찾을 원문**
````text
(PM 확정 P-7, ADR-0033 §8). `Permission` 15종 · 공개 경로 6곳 불변.
````
**바꿀 내용**
````text
(PM 확정 P-7, ADR-0033 §8). `Permission` 15종 · 공개 경로 6곳 불변.
    - **갱신(2026-09-24 — No.26)**: 레거시 API 연동은 **신규 권한 0종**이다(PM 확정 P-12). 연결 CRUD·연결 테스트 = **`security:write`**(ADMIN — "어디로 나갈 수 있는가"는 외부 송신 경계라 금지어·로그인 정책과 같은 보안 설정 도메인), 연결 목록·상세 = `security:read`, 노드 편집기 선택 목록·목 샘플 = `dialogue:read`(URL·시크릿 참조 미포함), 호출 로그 = `chatbot:read`, 시뮬레이터 실제 호출 = 가드 `simulation:read` + 서비스의 `simulation:write` 재확인(불충족은 목 격하). `@Public()` 6곳 불변 · 레거시 프록시 경로 0(ADR-0015 갱신 각주, ADR-0034 §10).
````

### A-26. §6 결정 21(감사) — No.26 갱신 각주

**찾을 원문**
````text
(읽기 / 운영 스크립트 — `backfill-conversation-buckets.ts` 선례).
````
**바꿀 내용**
````text
(읽기 / 운영 스크립트 — `backfill-conversation-buckets.ts` 선례).
    - **갱신(2026-09-24 — No.26)**: `AuditTargetType`에 **`ApiConnection`**(15 → 16종 — 생성 `CREATE` · 수정 `UPDATE`(원문 송신 허용/해제·사용 중지는 summary로 구분) · 삭제 `DELETE`)을 추가하고 **`AuditAction`은 추가하지 않는다**. 화이트리스트는 `secretRef`를 **이름으로만**, `baseUrl`을 **호스트로만**, 샘플 응답을 **개수로만** 담는다. **호출 1건 1건과 연결 테스트는 감사 대상이 아니다** — 호출 관측은 ADR-0016 §5 예고대로 분리된 `ApiCallLog`(메타데이터 전용)가 맡는다(ADR-0016 갱신 각주, ADR-0034 §6).
````

### A-27. §6 결정 35 신설

**찾을 원문**
````text
→ **ADR-0033**(+ ADR-0001·0002·0004·0015·0017 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0033**(+ ADR-0001·0002·0004·0015·0017 갱신 각주)

35. **레거시 API 연동(No.26)의 엔진 통합·시크릿·연결 레지스트리·SSRF·로그·기존 데이터 처리 확정(2026-09-24)**: ADR-0008 §4의 "상수에서 값을 빼는 것만으로 실행이 열린다"는 **성립하지 않았다** — 엔진은 동기 순수 함수라 호출 자리가 없고, No.5 저장 형태는 URL·평문 헤더를 노드 JSON에 담아 VIEWER(`dialogue:read`)가 토큰을 읽을 수 있었으며, 분기 참조가 무결성 검사 4곳에서 빠져 있었다. **① 엔진 = 정지점 → 엔진 밖 1회 호출 → 순수 재진입**(`resumeAfterApiCall`, 정지 시 실패 가정 폴백 동봉 · 수정은 닫힌 목록 · 엔진 I/O 0건 정적 검사 · PENDING 미재사용 — 분기 후 상태를 미리 확정할 수 없다). **② 전역 `ApiConnection` 레지스트리**(ADMIN · `security:*`) — v2 `API_CONDITION`은 `connectionId` + 상대 경로 + 구조적 바인딩(상수/같은 턴 완료 폼 슬롯)만 갖고 헤더·URL 필드가 없다(P-2). **③ 시크릿 DB 미저장** — `secretRef` → `LEGACY_API_SECRET__<REF>`, 리졸버 1파일(P-3 — §5 "연동 착수 시 결정"의 결정). **④ 유일 출구 `LegacyApiHttpClient` + SSRF 다층 방어**(브랜드 타입 요청 · DNS 후 주소 고정 · 루프백/링크로컬/메타데이터 절대 차단 · 사설 대역 운영자 allowlist · 리다이렉트 불추종 · 256KB · JSON만 — NFR-S4 재정의, P-9). **⑤ 동기 단발 호출**(타임아웃 기본 3초/최대 10초 · 턴당 1회 · 재시도 0 · 연결 단위 회로 5회/60초(4xx 미산입) · API 노드 없는 턴 예산 불변 — P-5·P-6 GET/POST만). **⑥ 실패·불일치 = 선택 분기 노드, 없으면 고정 문구**(고정 문구 턴은 `isAnswered=false`·미응답 큐 미적재·RAG 미전환 — P-7). **⑦ `{api.*}` 같은 턴·텍스트 필드만**(URL 치환 금지 · 상태 봉투 불변 — P-8). **⑧ PII 기본 마스킹 + 연결 단위 원문 예외**(ADR-0013 적용 지점 4번째 — P-10). **⑨ `ApiCallLog` 메타데이터 전용**(원문·헤더·치환 URL 컬럼 없음 · 목/TC 미기록 · 자동 정리 없음 — P-11, ADR-0016 §5 실체화). **⑩ v1 = 읽기 호환·실행 안 함·쓰기 400·응답 가림·자동 변환/삭제 없음**(P-4). **⑪ 권한 신규 0종**(P-12) · **시뮬레이터 목 기본, 실호출은 `simulation:write`+GET+저장본과 같은 노드일 때만(불충족은 격하), 비교·TC 항상 목**(P-13) · **개인정보 조회형 표시·30/분**(P-14). **⑫ 참조 무결성 편입**(`getOutgoingNodeRefs().apiTargets` — 저장 검증·삭제 409·고아/흐름·스냅샷 경고) · **연결은 스냅샷 밖**(참조 끊김 = 복원 경고). 신규 `ApiErrorCode` 2종 · 선택 환경변수 7종 · `@Public()` 추가 0 · 외부 HTTP 출구 4곳. GPU **1 유지**(P-15). → **ADR-0034**(+ ADR-0008·0013·0015·0016·0022·0030·0031 갱신 각주)
````

### A-28. §7 인덱스 — 설계서 행 추가

**찾을 원문**
````text
| 요구사항: `docs/requirements/integrated-stats.md` |
````
**바꿀 내용**
````text
| 요구사항: `docs/requirements/integrated-stats.md` |
| **`legacy-api-integration-설계.md`** | **레거시 API 연동(No.26) — Prisma 변경안(`ApiConnection`·`ApiCallLog` 신설 + `TestRunResult.apiMockA/B`, **비파괴·백필 0·v1 데이터 무변경**), v1 잔존 계측 스크립트, `API_CONDITION` v1/v2 스키마(판별 `version: 2`·쓰기 가드·업캐스트 없음·응답 가림 3지점), `api-mapping.ts` 순수 함수(경로 문법·연산자·치환), **엔진 닫힌 목록 수정**(정지점·`resumeAfterApiCall`·폴백 동봉·참조 편입·설계 점검 신규 항목), 소비자 4곳 턴 완결(공개 실호출·시뮬레이터 MOCK/LIVE 격하·비교/TC 목), **`LegacyApiService` 13단계·요청 조립(재파싱 동일성)·`LegacyApiHttpClient`(DNS 후 주소 고정)·IP 정책(절대 차단/사설 allowlist/내장 IPv4)**·연결 단위 게이트(4xx 미산입)·시크릿 리졸버·결과 코드 18종, 템플릿 치환, 메타데이터 전용 로그, 권한(신규 0), 감사(`ApiConnection`), 10개 엔드포인트·오류 2종, **봉인 정적 검사 L-1~L-14**, 성능 예산, 버전·예약(복원 경고 3종), 콘솔 인계, 시험 포인트, 알려진 제한 10건, 요구사항 대비 해석 20건** | 요구사항: `docs/requirements/legacy-api-integration.md` |
````

### A-29. §7 인덱스 — ADR-0034 행 추가

**찾을 원문**
````text
AC-I1/I3/I4/I6 |
````
**바꿀 내용**
````text
AC-I1/I3/I4/I6 |
| **`decisions/ADR-0034-legacy-api-connection-registry-and-engine-suspension.md`** | **레거시 API 연동 = 엔진 정지점 → 엔진 밖 1회 호출 → 순수 재진입(비동기 엔진·사전 호출·PENDING 기각) · 전역 연결 레지스트리(노드에서 URL·헤더 제거) · 시크릿 DB 미저장(환경변수 참조) · 유일 출구 + SSRF 다층 방어(DNS 후 주소 고정·절대 차단·사설 allowlist) · 동기 단발(턴당 1회·재시도 0·회로 4xx 미산입) · `ApiCallLog` 메타데이터 전용 · v1 읽기 호환·쓰기 거부·응답 가림 · `{api.*}` 같은 턴 텍스트만 · PII 연결 단위 원문 예외 · 신규 권한 0 · 시뮬레이터/TC 목 기본 · 참조 무결성 편입 · 연결은 스냅샷 밖** | 요구사항 J-1~J-20, FR-0-96~105, FR-L1-\*~FR-L9-\*, AC-L1~L8 |
````

---

## B. 기존 ADR (결정 본문은 수정하지 않는다 — 파일 끝 append + 인라인 표식 2건)

### B-1. `docs/02-spec/decisions/ADR-0008-dialogue-resolution-pipeline.md` — §4 인라인 표식

**찾을 원문**
````text
No.26/27 구현 시 **이 상수에서 값을 빼는 것만으로** 실행이 열린다.
````
**바꿀 내용**
````text
No.26/27 구현 시 **이 상수에서 값을 빼는 것만으로** 실행이 열린다. **[정정 2026-09-24 No.26 — 성립하지 않았다: 실행 가능 판정은 타입이 아니라 형태로 한다. 문서 끝 갱신 참고]**
````

### B-2. `docs/02-spec/decisions/ADR-0008-dialogue-resolution-pipeline.md` — 실행 가능 판정·엔진 수정 닫힌 목록 (append)

**찾을 원문**
````text
그 시점에 `simulate`를 제거한다.
````
**바꿀 내용**
````text
그 시점에 `simulate`를 제거한다.


---

## 갱신 (2026-09-24 — No.26: "상수에서 빼면 열린다"는 성립하지 않았다 · 실행 가능 판정 = 형태 · 엔진 수정 닫힌 목록)

레거시 API 연동(No.26, **ADR-0034**)이 `API_CONDITION`의 실행을 연다. §4의 예고("이 상수에서 값을 빼는 것만으로 실행이 열린다")는 **성립하지 않았다** — ① 엔진이 동기 순수 함수라 호출할 자리가 없고 ② No.5 저장 형태(인라인 URL·평문 헤더)는 실행하면 안 되는 형태이며 ③ 웹 배지가 이 상수를 쓰지 않고 타입을 하드코딩했다(`DialogOutputEditor.tsx:126`). 다음과 같이 갱신한다. §1~§3·§5~§8의 결정(진입점·우선순위·예외 없음·설계 점검의 엔진 배치)은 불변이다.

1. **실행 가능 판정은 타입이 아니라 형태로 한다.** `UNSUPPORTED_OUTPUT_TYPES = ['SCENARIO','SURVEY']`로 줄이고, `API_CONDITION`은 `version: 2`(연결 참조형)만 실행한다. v1은 이 ADR의 미지원 처리(출력 제외 + `unsupportedOutputs` 기록 + 0건이면 안내 문구)를 **바이트 단위 그대로** 받는다. 판정 함수 `isUnsupportedOutput()`을 `shared-types`에 두고 엔진·설계 점검·웹 배지가 공유한다(§4의 "공유" 의도를 함수로 실현).
2. **§1 "DB·NestJS 무의존 순수 함수"는 유지된다** — 외부 호출은 엔진 밖에서 한다. 엔진은 v2 `API_CONDITION`에서 **정지**(호출 요청서 반환, 뒤 아웃풋 미실행)하고, API 계층이 1회 호출한 뒤 순수 함수 `resumeAfterApiCall()`로 재진입한다. 정지 시 `resolveTurn`은 "호출 실패" 가정의 폴백 결과를 동봉해 §6의 "항상 최소 1건 응답"을 지킨다.
3. **엔진 수정은 닫힌 목록**이다: `executeOutputs` 분기 · 재진입 함수 · 참조 편입(`getOutgoingNodeRefs().apiTargets`) · 결과 타입 선택 필드 `apiCall?` · 폼 완료 값 전달. 엔진에 I/O·타이머·`fetch`·`process.env`·Nest·Prisma 심볼 0건을 정적 검사가 단언한다.
4. **§6 안전장치 보강**: 턴당 외부 호출 1회(두 번째는 실패 처리) · 분기 이동은 hop 1로 이어 센다(`HOP_LIMIT` 10 공유) · 끊긴 분기 참조는 `BROKEN_REFERENCE` + 고정 문구.
5. **§7 설계 점검**: v1은 `UNSUPPORTED_OUTPUT`(INFO) 대신 `API_LEGACY_FORMAT`(WARNING, "전환 필요")으로 보고하고 API 전용 점검 항목이 추가된다. 연결 의존 항목을 위해 `validateDialogueDesign`이 **선택 3번째 인자**(연결 설계 정보)를 받는다 — 엔진이 DB를 읽지 않는 원칙 유지.
6. 대안 표의 "미지원 아웃풋을 저장 단계에서 차단" 기각 사유(No.26 준비 데이터)는 v1에 대해 **반대로 적용**된다 — v1은 새로 저장할 수 없다(`400 API_OUTPUT_LEGACY_FORMAT`). 이미 저장된 v1은 자동 변환·삭제하지 않는다(ADR-0034 §7).
````

### B-3. `docs/02-spec/decisions/ADR-0013-pii-masking-policy-and-placement.md` — 네 번째 적용 지점 (append)

**찾을 원문**
````text
② 마스킹 전 원문이 `logger`·예외 메시지·`trace`에 등장하지 않는지.
````
**바꿀 내용**
````text
② 마스킹 전 원문이 `logger`·예외 메시지·`trace`에 등장하지 않는지.


---

## 갱신 (2026-09-24 — No.26: 네 번째 적용 지점 = 레거시 송신, 연결 단위 원문 예외)

레거시 API 연동(No.26, **ADR-0034 §9**)의 외부 송신이 **네 번째 적용 지점**이 된다(저장 · RAG 송신 · 증강 송신 · **레거시 송신**). 정책·구현은 불변이며 **함수는 여전히 1벌**(`packages/pii-mask`)이다.

- **대상**: 요청 바인딩 중 **폼 슬롯(사용자 입력) 값**만. 관리자가 작성한 상수 바인딩은 비적용(TC 문장 비적용 선례와 같은 판단).
- **연결 단위 예외(이 ADR의 첫 예외)**: `allowRawPersonalData=true`인 연결에 한해 원문을 송신한다. 전화번호·주문번호로 조회하는 레거시 연동은 마스킹된 값(`010-****-5678`)으로는 동작하지 않기 때문이다. 이 설정은 **ADMIN만**(`security:write`), **연결 이름 재입력 확인**을 거쳐, **감사로그**(`ApiConnection UPDATE` before/after)에 남고, 콘솔·설계 점검에 "원문 송신" 텍스트 배지로 항상 보인다. 기본값은 false(마스킹 송신).
- **예외 없는 곳**: 로그·trace·`ApiCallLog`·서버 로그에는 송신 값·응답 값이 **원문이든 마스킹본이든** 남지 않는다(`personalDataMasked` 플래그만). 관리자 시뮬레이터의 응답 변수 표시도 `maskPii` 후 보여 준다(§5 "관리자 본인이 방금 입력한 값" 예외는 외부 시스템이 돌려준 값에 적용되지 않는다).
- 외부 응답값이 치환된 봇 응답은 기존대로 `ConversationLogService.record()`의 금지어 → PII 마스킹을 거친다(§4 `botResponse` 규칙 그대로).
````

### B-4. `docs/02-spec/decisions/ADR-0015-role-permission-model.md` — 신규 권한 0종 (append)

**찾을 원문**
````text
그룹 삭제가 보관으로 처리되는 경우(ADR-0002 갱신)에도 권한은 `chatbot:write` 그대로다.
````
**바꿀 내용**
````text
그룹 삭제가 보관으로 처리되는 경우(ADR-0002 갱신)에도 권한은 `chatbot:write` 그대로다.


---

## 갱신 (2026-09-24 — No.26 레거시 API 연동: 신규 권한 0종, 연결 관리 = `security:*`)

레거시 API 연동(No.26, ADR-0034 §10)은 **신규 권한을 만들지 않는다**(PM 확정 P-12). `Permission` 15종 · `ROLE_PERMISSIONS` · 공개 경로 6곳 · 판정 순서는 전부 불변이다.

- **연결 CRUD·연결 테스트 = `security:write`, 연결 목록·상세 = `security:read`**(ADMIN) — "어디로 나갈 수 있는가"는 외부 송신 경계이며 금지어·로그인 정책과 같은 보안 설정 도메인이다. "동작이 바꾸는 자원을 기준으로 권한을 정한다"에 따라 자원 = 전역 보안 설정.
- 노드 편집기의 **연결 선택 목록·목 샘플 응답 = `dialogue:read`** — URL·시크릿 참조·인증 방식을 싣지 않는다. EDITOR는 등록된 연결을 **쓰기만** 한다(노드 저장 = 기존 `dialogue:write`).
- 호출 로그 = `chatbot:read`.
- **시뮬레이터 실제 호출**: 가드는 기존 `simulation:read` 그대로 두고 서비스가 `simulation:write`를 재확인한다(`deploy-schedule.service.ts`의 `hasPermission` 선례). 불충족은 `403`이 아니라 **목으로 격하 + 사유 안내**다 — VIEWER의 시뮬레이터 사용 자체를 막지 않으면서 VIEWER발 외부 호출을 막는다.
- VIEWER가 `dialogue:read`로 v1 `API_CONDITION`의 평문 헤더 토큰을 읽을 수 있던 노출은 권한 변경이 아니라 **응답 가림**으로 해소한다(ADR-0034 §7 — 권한을 올리면 VIEWER의 노드 조회 자체가 막힌다).
````

### B-5. `docs/02-spec/decisions/ADR-0016-audit-log-backfill-scope.md` — §5 인라인 표식

**찾을 원문**
````text
이번 Phase에 **`ApiCallLog`를 만들지 않는다.**
````
**바꿀 내용**
````text
이번 Phase에 **`ApiCallLog`를 만들지 않는다.** **[이행 2026-09-24 No.26 — 원문 없는 메타데이터 전용으로 도입. 문서 끝 갱신 참고]**
````

### B-6. `docs/02-spec/decisions/ADR-0016-audit-log-backfill-scope.md` — `ApiCallLog` 도입·`ApiConnection` 대상 (append)

**찾을 원문**
````text
증명할 수단이 없어 보정하면 잘못된 주체를 남길 수 있다).
````
**바꿀 내용**
````text
증명할 수단이 없어 보정하면 잘못된 주체를 남길 수 있다).


---

## 갱신 (2026-09-24 — No.26: §5 `ApiCallLog` 도입 — 원문 미저장으로 보존·마스킹 충돌을 원천 제거 · `ApiConnection` 대상 추가)

레거시 API 연동(No.26, **ADR-0034 §6**)이 §5가 예고한 쓰기 주체를 만든다. **§5의 분리 결정은 그대로 이행하되, 전제 하나를 바꾼다** — §5는 API 로그를 "외부 호출 원문(고용량·단기보존·Header에 토큰/PII 포함 가능)"으로 가정했으나, `ApiCallLog`는 **원문을 저장하지 않는 메타데이터 전용**으로 만든다.

1. **`ApiCallLog` 컬럼**: 연결 id·이름 스냅샷 · 챗봇 · 노드 · 대화로그 id · 출처 · 메서드 · **치환 전 경로 템플릿** · 결과 코드 · HTTP 상태 · 지연 · 응답 바이트 · 분기 · 마스킹 여부 · KST 일 버킷. **치환된 URL·쿼리·헤더·요청/응답 본문·바인딩 값·응답 값 컬럼이 없다**(정적 검사로 고정). 그 결과 §5가 우려한 보존기간·마스킹 요건이 `RagCallLog`와 같아지며, 행이 작아 1차 자동 정리가 필요 없다(No.45).
2. **호출 1건 1건은 감사로그가 아니다**(§5 그대로). 연결 테스트도 감사 대상이 아니다(`ApiCallLog`에 `CONNECTION_TEST`로 남는다).
3. **`AuditTargetType`에 `ApiConnection`**(라벨 `'API 연결'`, 15 → 16종) — 생성·수정·삭제. `AuditAction` 추가 0. `AUDIT_FIELDS.ApiConnection`은 `secretRef`를 **이름으로**, `baseUrl`을 **호스트로**, 샘플 응답을 **개수로만** 담는다(시크릿 값은 애초에 어디에도 없다).
4. 노드 저장 감사는 불변 — `DialogNode` 화이트리스트에 `outputs`가 없어(`outputCount`만) v1 헤더 토큰이 감사로그에 들어간 적이 없다. 유지한다.
````

### B-7. `docs/02-spec/decisions/ADR-0022-external-rag-allowlist-sealing.md` — 봉인 형식 계승·보강 제안 (append)

**찾을 원문**
````text
옵션 자체를 비활성으로 되돌린다"를 추가한다.
````
**바꿀 내용**
````text
옵션 자체를 비활성으로 되돌린다"를 추가한다.


---

## 갱신 (2026-09-24 — No.26: 외부 출구 봉인 형식의 계승 · `RagHttpClient` 보강 제안)

레거시 API 연동(No.26, **ADR-0034 §4**)이 이 ADR의 봉인 형식을 **네 번째 외부 출구**(`LegacyApiHttpClient`)에 계승한다. 이 ADR의 결정(RAG 출구·경로 allowlist 3개·파괴적 문자열 0건·`provider` 상수)은 **한 줄도 바뀌지 않으며** 레거시 출구는 `RagHttpClient`를 재사용하지 않는다(용도·봉인 방식이 다르다).

- **같은 것**: 출구는 1개 클래스 · 다른 코드는 그 호스트로 HTTP를 직접 부르지 않는다 · 임의 경로/URL을 인자로 받지 않는다 · 정적 검사로 단언한다(`legacy-api-sealing.spec.ts` — `rag-allowlist.spec.ts`와 같은 형식) · 공개 프록시 경로를 만들지 않는다(§8과 같은 이유).
- **다른 것**: 레거시는 호출 대상이 관리자 설정이라 "경로 상수 allowlist"로 봉인할 수 없다. 대신 **등록된 연결 + `build-request.ts`만 만들 수 있는 브랜드 타입 요청 + 네트워크 계층 검증**(DNS 후 주소 검사·주소 고정·절대 차단 대역·사설 allowlist·리다이렉트 불추종·응답 크기 상한)으로 봉인한다.
- **⚠ 보강 제안(이 그룹 범위 밖 — 코드리뷰 과제)**: `RagHttpClient.send()`는 `fetch` 기본값으로 **리다이렉트를 따라가고**(`rag-http.client.ts:72`) 응답을 `res.text()`로 **전체 수신**한다(:79). 고정 서버라 1차 허용했지만, RAG 서버가 오염되거나 이전되면 리다이렉트로 내부 주소를 가리키거나 대용량 응답으로 메모리를 압박할 수 있다. `redirect: 'manual'`(3xx = 실패)과 스트림 크기 상한을 같은 방식으로 적용할 것을 제안한다. **재검토 트리거에 "RAG 서버 이전 또는 코드리뷰 지적"을 추가한다.**
- 외부 HTTP 출구 현황: RAG · 임베딩 · 외부 LLM(증강) · **레거시(No.26)** — 개발명세서 §2.1의 "3곳"은 "4곳"으로 갱신된다.
````

### B-8. `docs/02-spec/decisions/ADR-0030-test-run-resource-isolation.md` — TC·비교는 레거시를 목으로만 (append)

**찾을 원문**
````text
그때는 기본값을 "옵션 자체 비활성"으로 되돌린다.
````
**바꿀 내용**
````text
그때는 기본값을 "옵션 자체 비활성"으로 되돌린다.


---

## 갱신 (2026-09-24 — No.26: TC·비교는 레거시 API를 목으로만 판정한다)

레거시 API 연동(No.26, ADR-0034 §10)의 v2 `API_CONDITION`이 TC 대량 실행과 비교 실행에 들어온다. 이 ADR의 격리 원칙을 그대로 적용한다 — **실행 경로는 외부 레거시 시스템을 호출할 수단을 DI 그래프에 갖지 않는다.**

1. **항상 목**: TC 실행기·비교 실행은 연결에 등록된 **샘플 응답**(없으면 실패 분기)으로 분기·치환을 재현한다. 실행 모듈은 외부 출구 모듈(`legacy-api`)을 **import하지 않고** 읽기 전용 카탈로그(`api-connections/catalog` — Prisma 읽기만)만 쓴다. 목 원천은 **실행당 1회** 로드한다(N+1 금지).
2. **결정론**: 목 판정은 순수 함수라 같은 샘플이면 두 실행의 응답 해시가 같고 처리량(500 TC/분)도 불변이다. 사용된 샘플은 결과 행의 `apiMockA/B`(샘플 해시 앞 8자리 또는 `NO_SAMPLE`)로 남아 **샘플 변경으로 인한 해시 변화**를 설명할 수 있다.
3. **로그 0**: `ApiCallLog`·`ConversationLog`를 만들지 않는다(§4와 같은 원칙 — 운영 지표 오염 방지).
4. **해시 불연속(ADR-0029 버전 축)**: v2 노드를 포함한 TC는 No.26 이전(미지원 안내 폴백)과 이후(목 분기)의 응답 해시가 다르다. 실행 비교 화면은 한쪽만 목이 관여했거나 샘플 해시가 다를 때 안내를 1회 표시한다.
5. 정적 검사: `validation-sealing.spec.ts`의 금지 import에 `legacy-api/`를 추가하고, `legacy-api-sealing.spec.ts` L-6이 `validation`·`versions`·`deploy-schedules`의 출구 import 0건을 함께 단언한다.
````

### B-9. `docs/02-spec/decisions/ADR-0031-chatbot-version-snapshot-and-id-preserving-restore.md` — 연결은 스냅샷 밖 (append)

**찾을 원문**
````text
No.40의 접점이다(ADR-0032 재검토 트리거).
````
**바꿀 내용**
````text
No.40의 접점이다(ADR-0032 재검토 트리거).


---

## 갱신 (2026-09-24 — No.26: `ApiConnection`은 스냅샷 밖 · 연결 참조 끊김은 경고 · v1 평문 헤더 처리)

레거시 API 연동(No.26, **ADR-0034 §11**)에 따라 다음을 확정한다. 스냅샷 범위·ID 보존 복원·단일 트랜잭션·해시 규칙은 **불변**이다.

1. **`ApiConnection`은 스냅샷 대상이 아니다** — 금지어·채널과 같은 **전역 설정**이다(§1 제외 표에 추가). 노드 `outputs` 안의 `connectionId` 참조는 스냅샷에 그대로 포함된다. v2 `API_CONDITION`에는 헤더·URL 필드가 없으므로 **스냅샷에 시크릿이 들어갈 자리가 원천적으로 없다.**
2. **스키마 버전 불변 · 업캐스터 불필요** — `API_CONDITION`의 읽기 스키마가 v1 ∪ v2 합집합이라 과거 스냅샷(v1 포함)이 그대로 복원된다. v1은 복원 후에도 실행되지 않는다.
3. **복원 미리보기 경고 3종**(전부 blocker 아님 — EX-H-5 "캡처 당시 상태의 재현이 복원의 정의"): `API_CONNECTION_MISSING`(참조 연결 없음 — 실행 시 실패 분기) · `API_CONNECTION_DISABLED` · `API_LEGACY_FORMAT`(v1 포함 — 복원 후 실행되지 않음). 앱 레벨 참조 무결성 경고에 `BROKEN_REFERENCE_NODE_API`(분기 대상 노드 없음)를 추가한다. 예약 복원(No.28)의 준비도 경고에도 자동으로 포함된다(실행기가 복원 미리보기를 호출한다).
4. **연결 삭제는 스냅샷 참조를 검사하지 않는다** — 스냅샷 때문에 연결을 영원히 지울 수 없게 되는 것을 막는다(현재 노드 참조만 `409`).
5. **v1 스냅샷의 평문 헤더**: 버전 내용 조회·차이 항목 응답은 v1 헤더 값·본문 템플릿을 가린다. 제거가 필요하면 **해당 버전을 삭제**한다 — 스냅샷 본문을 수정하는 경로를 만들지 않는다(`contentHash` 불변 원칙). 목록의 "이전 형식 포함" 표시는 No.26 이후 캡처분만 가능하다(목록은 본문을 읽지 않는다 — 본문 참조 봉인 유지).
````

---

## C. `docs/01-requirements/기능요구사항.md`

### C-1. §3 No.26 행 — 설계 완료 반영

**찾을 원문**
````text
| 26 | 연동/확장 | 레거시 API 연동 | 대화상자 조건에 외부 API(GET/POST) 연결, 응답값 실시간 매핑·출력 | 1 | API 호출·파싱(경량) | ○ | ○ | - |
````
**바꿀 내용**
````text
| 26 | 연동/확장 | 레거시 API 연동 | 대화 노드의 API 조건에 **관리자가 등록한 연결**로 외부 API(GET/POST) 호출 → 응답 경로 값으로 **같은 턴 분기·출력 치환**(시크릿은 서버 환경변수 · SSRF 다층 방어 · 호출 메타데이터 로그) | 1 | API 호출·파싱(경량 — 새 모델·추론 0) | ○ | ○(전제: 고객 레거시 HTTPS 도달 + 고정 송신 IP 등록) | **설계 완료(2026-09-24, `docs/02-spec/legacy-api-integration-설계.md` · ADR-0034).** 원문 "대화상자 조건에 외부 API(GET/POST) 연결, 응답값 실시간 매핑·출력". `SCENARIO`·표준 커넥터는 No.39, 쓰기형 후속 액션은 No.41, 시크릿 DB 암호화·로그 보존은 No.45 |
````

### C-2. §3 No.39 행 — No.26 연결 레지스트리 토대 비고

**찾을 원문**
````text
| 39 | 연동/확장 | 확장 시스템 커넥터 허브 | ERP/CRM/결제/카카오·네이버 API 표준 커넥터로 신속 연동 | 1 | ○ | ○ | - |
````
**바꿀 내용**
````text
| 39 | 연동/확장 | 확장 시스템 커넥터 허브 | ERP/CRM/결제/카카오·네이버 API 표준 커넥터로 신속 연동 | 1 | ○ | ○ | No.26의 `ApiConnection`(전역 연결 레지스트리 · 유일 출구 · SSRF 방어)을 커넥터 인스턴스로 확장하고 `SCENARIO` 실행을 그 위에 올린다(ADR-0034 재검토 트리거) |
````

---

## D. `docs/requirements/dialogue-design.md` — NFR-S4/S5 해소 각주

### D-1. NFR-S4 — SSRF 재정의

**찾을 원문**
````text
이번 Phase에는 저장 시 형식 검증까지만 한다. |
````
**바꿀 내용**
````text
이번 Phase에는 저장 시 형식 검증까지만 한다. **[해소 2026-09-24 No.26]** 인라인 URL은 v2에서 폐기되고(노드는 등록된 연결 id + 상대 경로만), SSRF 방어는 "사설 대역 차단"이 아니라 **다층 방어**(DNS 후 주소 검사·주소 고정 · 루프백/링크로컬/메타데이터 절대 차단 · 사설 대역은 운영자 allowlist로만 · 리다이렉트 불추종 · 응답 상한)로 재정의됐다 — `legacy-api-integration-설계.md` §7, ADR-0034 §4 |
````

### D-2. NFR-S5 — 헤더 토큰 평문 저장 해소

**찾을 원문**
````text
암호화 저장은 No.26/No.45(데이터 거버넌스) 과제로 기록한다. |
````
**바꿀 내용**
````text
암호화 저장은 No.26/No.45(데이터 거버넌스) 과제로 기록한다. **[해소 2026-09-24 No.26]** 암호화가 아니라 **노드에서 시크릿을 제거**했다 — v2에는 헤더 필드가 없고 시크릿은 연결의 `secretRef` → 서버 환경변수로만 주입된다. 기존 v1의 평문 헤더 값은 노드·버전 조회 응답에서 가리며(`[비공개]`), v1은 새로 저장할 수 없다(ADR-0034 §3·§7) |
````

---

## E. `docs/03-design/dialogue-design-ui-spec.md` — 대체 예정 표식 (세부 갱신은 ui-designer 단계)

### E-1. 197행 `UnsupportedOutputBadge` 대상 축소

**찾을 원문**
````text
아웃풋 편집 폼(`SCENARIO`/`SURVEY`/`API_CONDITION`)
````
**바꿀 내용**
````text
아웃풋 편집 폼(`SCENARIO`/`SURVEY`/**v1(이전 형식)** `API_CONDITION` — [No.26] v2는 배지 없음, 판정은 공용 `isUnsupportedOutput()`)
````

### E-2. 413행 ⑫ API 조건분기 — 헤더 마스킹 스펙 폐기 표식

**찾을 원문**
````text
`headers` 값 마스킹 도움말: "저장은 평문으로 되며, 화면에서는 가려서 표시됩니다."(NFR-S5) |
````
**바꿀 내용**
````text
`headers` 값 마스킹 도움말: "저장은 평문으로 되며, 화면에서는 가려서 표시됩니다."(NFR-S5) **[대체 예정 2026-09-24 No.26]** 이 행은 v1(이전 형식) 표시에만 남는다 — 새 편집 폼은 연결 선택·구조적 바인딩·응답 매핑·기본/실패 분기이며 헤더·URL 입력이 없고, 헤더 마스킹 표시 스펙은 폐기된다. v1은 "이전 형식 — 실행되지 않음" 배지 + 헤더 키·개수만 표시(값은 서버가 `[비공개]`로 가림). 세부는 ui-designer가 `legacy-api-integration-설계.md` §16으로 갱신한다 |
````

### E-3. 423행 ⑩⑪⑫ 배지 규칙 — v2 제외

**찾을 원문**
````text
배지는 INFO 계열 색상(파랑)으로 경고가 아님을 표시하되 텍스트로 명확히 안내한다.
````
**바꿀 내용**
````text
배지는 INFO 계열 색상(파랑)으로 경고가 아님을 표시하되 텍스트로 명확히 안내한다. **[No.26] ⑫는 v1(이전 형식)일 때만 배지를 노출하고 문구를 "이전 형식 — 실행되지 않습니다. 연결을 선택해 전환하세요"로 바꾼다. v2 `API_CONDITION`에는 배지가 없다.**
````

---

## F. `docs/requirements/legacy-api-integration.md` — PM 결정 기록

### F-1. §1.5 핵심 판단 표 머리 — PM 결정 표기

**찾을 원문**
````text
### 1.5 이 문서의 핵심 판단 20건 (⚠ = PM 확인 필요)
````
**바꿀 내용**
````text
### 1.5 이 문서의 핵심 판단 20건 (⚠ = PM 확인 필요)

> **PM 결정: 권고안 채택(2026-09-24)** — ⚠ 표시 항목(J-1·J-2·J-3·J-5·J-6·J-7·J-9·J-11·J-12·J-13·J-14·J-15·J-16)을 포함해 아래 "결정(제안)" 열이 전부 확정되었다(§11 P-1~P-15). J-4(엔진 정지점/재진입)·J-17(참조 무결성 편입)·J-18(스냅샷 취급)은 architect 확정 사항이다. 세부 설계: `docs/02-spec/legacy-api-integration-설계.md` · ADR-0034.
````

### F-2. §11 PM 확인 항목 — 결정 기록

**찾을 원문**
````text
## 11. PM 확인이 필요한 항목
````
**바꿀 내용**
````text
## 11. PM 확인이 필요한 항목

> **PM 결정: 권고안 채택(2026-09-24)** — P-1~P-15 전부 아래 표의 "권고안" 열로 확정했다.
>
> | # | PM 결정(2026-09-24) |
> |---|---|
> | P-1 | **`API_CONDITION`만 실행.** `SCENARIO`는 미지원 유지 → No.39 |
> | P-2 | **ADMIN 관리 전역 `ApiConnection` 레지스트리 도입.** 노드는 `connectionId` + 상대 경로만(URL·헤더 제거) |
> | P-3 | **(a) 환경변수 참조** — 시크릿은 DB에 저장하지 않고 `secretRef` + 환경변수 `LEGACY_API_SECRET__<REF>` |
> | P-4 | **v1: 읽기 가능 · 실행 안 함 · 신규 v1 저장 400 · 편집 시 v2 전환 필요 · 조회 응답에서 헤더 값 가림**(VIEWER가 `dialogue:read`로 평문 토큰을 읽던 노출 해소) · 자동 변환·삭제 없음 |
> | P-5 | **같은 응답 내 동기 호출** · 연결별 타임아웃 기본 3초(1~10초) · 턴당 1회 · 재시도 없음 · 회로차단 5회 실패/60초 · API 노드 없는 턴의 기존 성능 예산 불변 |
> | P-6 | **GET/POST만** |
> | P-7 | **`defaultNodeId`/`failureNodeId` 선택, 미지정 시 고정 문구**, `API_CONDITION`은 노드의 마지막 아웃풋(뒤는 실행 안 함). 고정 문구 턴은 `isAnswered=false`·미응답 큐 미적재 |
> | P-8 | **`{api.이름}`은 같은 턴·텍스트 필드만 치환**, URL 필드 치환 금지, 다음 턴 이월 없음 |
> | P-9 | **루프백/링크로컬/메타데이터 절대 차단**, 사설 대역은 환경변수 allowlist로만(기본 빈 목록), DNS 해석 후 실제 접속 IP 검사, 리다이렉트 불추종, 응답 256KB·JSON만. 기존 NFR-S4 재정의 |
> | P-10 | **기본 마스킹 송신**, 연결별 `allowRawPersonalData`(ADMIN·확인값·감사로그), 로그에는 원문 절대 없음 |
> | P-11 | **`ApiCallLog` 메타데이터만**(`RagCallLog` 선례), 목/TC 미기록, 자동 보존정리 없음(No.45) |
> | P-12 | **신규 권한 없음** — 연결 관리 `security:write`, 선택 목록 `dialogue:read`, 호출 로그 `chatbot:read`, 시뮬레이터 실호출 `simulation:write` |
> | P-13 | **시뮬레이션·TC 기본 목**(연결의 샘플 응답). 실호출은 `simulation:write` + GET + 저장된 노드 + 시뮬레이터 단건만 |
> | P-14 | **익명 조회 위험 수용·가시화** — `personalDataLookup` 표시, 편집기 경고, 기본 레이트리밋 30/분 |
> | P-15 | **GPU 1 유지** · 구축형 ○ · 구독형 ○(전제조건 명시) |
> | (architect) | 엔진 연결 방식(J-4 — 정지점 → 엔진 밖 실행 → 순수 재진입, 엔진 수정 범위 FR-0-96 닫힌 목록 + 엔진 I/O 0건 정적 검사) · 참조 무결성 편입(J-17 — `conditions[].nextNodeId`가 4곳 참조 검사에서 누락된 기존 결함 해소) · 스냅샷 취급(J-18 — 연결은 스냅샷 밖, 시크릿 미포함) |
````

---

## G. 적용 후 확인 체크리스트

- [ ] A-1~A-29 · B-1~B-9 · C-1~C-2 · D-1~D-2 · E-1~E-3 · F-1~F-2 각 "찾을 원문"이 적용 전 대상 파일에서 정확히 1회 검색되는지(0회 = 파일이 그 사이 바뀜 → 이 문서를 갱신 후 적용).
- [ ] 개발명세서 §7 인덱스에 설계서·ADR-0034 행이 각 1개인지. §6에 결정 35가 34 바로 뒤에 있는지.
- [ ] `docs/requirements/dialogue-design.md`·`docs/03-design/dialogue-design-ui-spec.md` 표 행이 적용 후에도 열 개수를 유지하는지(각주는 마지막 셀 안에 들어간다).
- [ ] `docs/04-test/시험항목.md`·`시험데이터.md`·`자동시험_전략.md`에 AC-L1~L8 · 가짜 레거시 서버/가짜 DNS 리졸버 픽스처 · SSRF 입력 표 · 시크릿 누출 grep 시험을 추가하는 일은 **test-automation 단계**에서 한다(이 목록에 포함하지 않음).
- [ ] `docs/03-design/dialogue-design-ui-spec.md`의 v2 폼·연결 관리·외부 연동 로그 화면 세부 스펙, `docs/03-design/UIUX_준수기준.md`의 "외부 시스템 오류 안내 문구 원칙" 보강 여부는 **ui-designer 판단**이다.
- [ ] 코드 쪽 JSDoc(`packages/shared-types/src/dialogue.ts:520-523` "SSRF 방어는 실행 Phase(No.26)의 책임 / headers 평문 저장")은 **구현 단계에서** v1 스키마 주석으로 교체한다(설계서 §4.1).
