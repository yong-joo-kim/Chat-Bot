# No.43 지식베이스 자동 크롤링/동기화 — 구현 편차 반영 패치 (코드 리뷰 R2 통과 후)

> 작성: system-architect · 2026-09-27 · 근거: 오케스트레이터가 승인한 구현 편차 32건. 사실관계는 전부 실제 코드(`apps/api/src/kb-sync/**`, `apps/api/src/rag/**`, `packages/shared-types/src/kb-sync.ts`, `apps/web/src/pages/settings/kb-crawling/**` 등)에서 확인했다. 파일:라인은 2026-09-27 작업 트리 기준이다.
> **적용 상태**: **적용 완료(2026-09-28 · 보정판)** — 백엔드 pass 4 이후 코드에 맞춰 D-1·D-3·D-7·D-15·D-18·D-19·D-22~D-29·D-37·D-38·U-9·A-1을 보정하고 설계서 +34(N-1~N-34)·화면 설계서 +4(U-10~U-13)·ADR +3(A-4~A-6)·기능요구사항 +1(F-1)을 더해 적용했다(50 → 92건 · 적용기 `apply43_pass4.py`). **아래 본문은 R2 시점 원안이다** — 최종 내용은 대상 문서(설계서 §25·§25.1 등)가 기준이다. **pass 5 반영(2026-09-28)**: 설계서 +41 · ADR-0044 +2 · ADR-0034 +1 · 화면 설계서 +2 · 기능요구사항 +1 · 이 문서 +1 = 48건(적용기 `apply43_pass5.py` — 설계서 §25 I-49~I-61 · §25.1 해소 표시 · §25.2 현재 상태·RG-16~RG-20 · §25.3 호스트 겹침 권장안). **pass 6 반영(2026-09-28)**: 설계서 +41 · ADR-0044 +4 · ADR-0034 +1 · 화면 설계서 +2 · 기능요구사항 +1 · 개발명세서 +2 · 자동배포 +1 · 이 문서 +1 = 53건(적용기 `apply43_pass6.py` — 설계서 §25 I-62~I-74 · §25.2 해소 표시·RG-19 권장 정정 · §25.3 B안 채택 · §25.4 현재 상태·RG-21~RG-22·사용자 설정·마이그레이션 영향 · §20 K-15~K-18 · 본문 §3·§6~§9·§15·§16 갱신). **pass 7·8 반영(2026-09-28)**: 설계서 +47 · ADR-0044 +6 · ADR-0040 +1 · 화면 설계서 +2 · 기능요구사항 +1 · 개발명세서 +3 · 자동배포 +1 · 이 문서 +1 = 62건(적용기 `apply43_pass78.py` — 설계서 §25 I-75~I-88 · §25.1 RG-3 부분 완화 · §25.4 해소 표시 · §25.5 현재 상태·RG-23~RG-25·§8.4 적용 대상 정리·거버넌스 결정 번복·사용자 결정 U-1~U-4 · §20 K-19~K-23 · §15 KB-14b · 본문 §2~§11·§16 갱신 · ADR-0044·ADR-0040 각주). **pass 9·10 반영(2026-09-28)**: 설계서 +51 · 화면 설계서 +3 · ADR-0044 +2 · ADR-0040 +1 · 기능요구사항 +3 · 자동배포 +1 · 이 문서 +1 = 62건(적용기 `apply43_pass910.py` — 설계서 §25 I-89~I-98 · §25.5 해소·채택 표시 · §25.6 현재 상태·RG-26·사용자 결정 U-5·잔여 갭 요약표 · §20 K-14·K-19~K-23 갱신·K-24~K-26 · 본문 §2.1·§3.1·§6.2·§6.4·§6.8·§6.9·§8.3·§8.4·§9.3·§9.5·§9.8·§10·§16 갱신 · 화면 설계서 §3.2·§3.3·§14 · ADR-0044·ADR-0040 각주 · 기능요구사항 비고 · 자동배포 §5.7). **pass 11·12·웹 후속 반영(2026-09-28)**: 설계서 +28 · 화면 설계서 +6 · ADR-0044 +1 · 기능요구사항 +2 · 자동배포 +1 · 이 문서 +1 = 39건(적용기 `apply43_pass1112.py` — 설계서 §25 I-99~I-106 · §25.6 pass 10 시점 기록 표시 · §25.7 현재 상태·`observedHash` 값 체계 표·신규 갭 RG-27·RG-28·최종 판정·PQ-1~PQ-4 · §20 K-20·K-26 갱신·K-27·K-28 · 본문 §2.1·§3.1·§6.2·§6.4·§6.5·§6.8·§6.9·§8.4·§9.5·§9.8·§17.4 갱신 · 화면 설계서 §3.3·§3.3.1·§3.4.1·§14 · ADR-0044 구현 상태 · 기능요구사항 비고 · 자동배포 §5.7). **pass 13·웹 RG-27 반영(2026-09-29)**: 설계서 +26 · 화면 설계서 +4 · ADR-0044 +1 · 기능요구사항 +2 · 자동배포 +1 · 이 문서 +1 = 35건(적용기 `apply43_pass13.py` — 설계서 §25 I-107·I-108 · I-102·I-104·I-106 정정 · §25.6·§25.7 RG-27·RG-28 해소 표시 · §25.8 최종 판정(커밋 전 필수 0건)·RG 최종 표·최종 시험 수치·커밋 분할 재점검(시험 안정화 ⓪ 분리) · §20 K-28 갱신·K-29 · 본문 §2.1·§3.1·§6.2·§6.9·§9.8·§17.4 갱신 · 화면 설계서 §3.3·§3.3.1·§14 · ADR-0044 구현 상태 · 기능요구사항 비고 · 자동배포 §5.7).
> **적용 방법**: 각 항목의 "찾을 원문"을 대상 파일에서 **정확히 1회** 찾아 "바꿀 내용"으로 교체한다. 모든 "찾을 원문"은 대상 파일 안에서 유일함을 문자열 검색으로 확인했다(설계서 38건 · 화면 설계서 9건 · ADR 3건 전부 1회 일치). "바꿀 내용"이 원문을 그대로 포함하는 항목은 append다. **"파일 끝에 덧붙이기"** 항목(D-38)은 찾을 원문 없이 대상 파일의 마지막 줄 바로 다음에 넣는다.
> **줄바꿈 주의**: 대상 파일은 CRLF일 수 있다. 모든 "찾을 원문"은 **한 줄 안의 부분 문자열**(줄바꿈 미포함)이다. "바꿀 내용"의 줄바꿈은 대상 파일의 줄바꿈으로 맞춘다.
> **순서 독립**: 어떤 "바꿀 내용"도 다른 항목의 "찾을 원문"을 새로 만들지 않는다. 한 줄에 앵커가 둘 있는 항목은 없다(설계서 11행은 앵커 1개로 묶었다).
> **범위**: 문서만 고친다. 코드는 바꾸지 않는다. 새 결정은 없다. 이미 구현된 사실만 적는다. 설계 의도와 충돌해 따로 결정이 필요한 관찰 사항은 이 패치에 넣지 않았다(보고서로 전달).
> 항목 수: 설계서(`kb-crawling-설계.md`) 38 · 화면 설계서(`kb-crawling-ui-spec.md`) 9 · ADR-0044 3 = **50건**

---

## D. `docs/02-spec/kb-crawling-설계.md`

### D-1. 머리말 표기 — X-3 · I-n 추가

**찾을 원문**
````text
의도된 기존 시험 기대값 변경은 **X-1~X-2**, 요구사항 대비 해석은 **R-1~R-30**, 알려진 제한은 **K-1~K-14**, 외부 RAG 담당자 확인 사항은 **Q-1~Q-10**이다.
````
**바꿀 내용**
````text
의도된 기존 시험 기대값 변경은 **X-1~X-3**(X-3은 구현 단계에서 추가 — §17.3), 요구사항 대비 해석은 **R-1~R-30**, 알려진 제한은 **K-1~K-14**, 외부 RAG 담당자 확인 사항은 **Q-1~Q-10**, 구현 편차는 **I-1~I-32**(§25 — 코드 리뷰 R2 통과 후 기록)이다.
````

### D-2. §2.1 파일 구조 — `kb-job-lease.ts` 미생성

**찾을 원문**
````text
└── kb-job-lease.ts
````
**바꿀 내용**
````text
└── ~~kb-job-lease.ts~~(만들지 않음 — 임대 CAS는 kb-run.store.ts에 통합 · §25 I-5)
````

### D-3. §2.1 파일 구조 — `kb-sync/lib` 구현 시 추가 파일

**찾을 원문**
````text
├── schedule-next.ts · backoff.ts · ingest-lane.ts · eta.ts · run-guards.ts
````
**바꿀 내용**
````text
├── schedule-next.ts · backoff.ts · ingest-lane.ts · eta.ts · run-guards.ts
│       ├── [구현 시 추가 — §25] build-run-view.ts(I-10) · preview-stale.ts · scope-warnings.ts(I-9) · url-scheme.ts(I-17) · gzip-guard.ts(I-20) · kb-rag-call-limiter.ts(I-18) · parse-source-row.ts · run-extract-job.ts
````

### D-4. §2.1 파일 구조 — `RagHttpClient` 결과 필드 · `common/lib/import-esm.ts` 추가

**찾을 원문**
````text
# [수정] ingest() · taskStatus() · send() 본문 인코딩 선택(JSON|MULTIPART)
````
**바꿀 내용**
````text
# [수정] ingest() · taskStatus() · send() 본문 인코딩 선택(JSON|MULTIPART) · 결과 retryAfterMs(§25 I-19)
├── common/lib/import-esm.ts                  # [신규 — §25 I-1] ESM 전용 패키지(pdfjs-dist) 동적 로더 · 인자가 상수인 new Function 1곳
````

### D-5. §2.1 파일 구조 — `rag/lib` 신규 순수 파일

**찾을 원문**
````text
rag/lib/{parse-ingest-response.ts, parse-task-status.ts, rag-task-id.ts}
````
**바꿀 내용**
````text
rag/lib/{parse-ingest-response.ts, parse-task-status.ts, rag-task-id.ts, judge-ingest-result-text.ts, retry-after.ts(§25 I-19)}
````

### D-6. §2.1 파일 구조 — 의존성 버전 · `pnpm-workspace.yaml`

**찾을 원문**
````text
# [수정] dependencies +htmlparser2 · +fflate · +pdfjs-dist
````
**바꿀 내용**
````text
# [수정] dependencies +htmlparser2(^9.1.0 고정 — §25 I-2) · +fflate(^0.8.3) · +pdfjs-dist(4.2.67)
pnpm-workspace.yaml                           # [수정] allowBuilds canvas: false — pdfjs-dist 선택 의존성의 네이티브 빌드 차단(§25 I-3)
````

### D-7. §2.3 실행 흐름 — 적재 조각 반복 종료 판정

**찾을 원문**
````text
tick = **쿼리 2개**(② due 조회 · ③④ 활성 실행·작업 존재 확인 1개 — 둘 다 인덱스).
````
**바꿀 내용**
````text
tick = **쿼리 2개**(② due 조회 · ③④ 활성 실행·작업 존재 확인 1개 — 둘 다 인덱스). 구현: 적재 조각의 반복 종료는 시각 추정이 아니라 `KbIngestRunner.runFragment()`의 boolean(이번 호출에서 실제 조회·제출을 했는가)으로 판정한다(§25 I-8).
````

### D-8. §2.5 기존 코드 변경 목록 — 의존성 행 갱신 + 구현 시 추가 행

**찾을 원문**
````text
| `apps/api/package.json` | `htmlparser2` · `fflate` · `pdfjs-dist`(≥ 4.2.67) | §7.1 |
````
**바꿀 내용**
````text
| `apps/api/package.json` | `htmlparser2`(**^9.1.0 고정** — v12는 ESM 전용) · `fflate`(^0.8.3) · `pdfjs-dist`(**4.2.67** 정확 고정) | §7.1 · §25 I-2 |
| `pnpm-workspace.yaml` | `allowBuilds`에 `canvas: false`(`pdfjs-dist` 선택 의존성 `canvas`의 네이티브 빌드 스크립트 차단) | §25 I-3 |
| `common/lib/import-esm.ts`(신규) | ESM 전용 패키지 동적 로더 — `pdf-text.ts`만 사용 | §25 I-1 |
| `rag/lib/retry-after.ts`(신규) · `rag/rag-http.client.ts` · `rag/lib/parse-{ingest-response,task-status}.ts` | `RagSendResult.retryAfterMs`(429·503 `Retry-After` 해석값 · 상한 30분) | §25 I-19 · X-3 |
| `apps/web/src/components/AsyncJobProgress.tsx` | 선택 prop `live?: boolean`(기본 `true` = 현행) | §25 I-29 |
````

### D-9. §2.5 기존 코드 변경 목록 — 시험 파일 행

**찾을 원문**
````text
| 시험 파일 | §17.3 X-1·X-2 + 신규 | FR-0-212 |
````
**바꿀 내용**
````text
| 시험 파일 | §17.3 X-1·X-2·X-3 + 신규 | FR-0-212 |
````

### D-10. §3.4 거버넌스 편입 — 데이터 지도 키 위치

**찾을 원문**
````text
소스 ≥1이면 선택 키 `egress.kbSources?:
````
**바꿀 내용**
````text
소스 ≥1이면 선택 키(구현: 응답 **최상위** `kbSources` — `egress` 아래가 아니다 · 이 문서의 `egress.kbSources` 표기는 모두 같은 뜻 · §25 I-26) `egress.kbSources?:
````

### D-11. §4 shared-types 계약 — `KbSourceResponse` 추가 필드

**찾을 원문**
````text
  lastRun: /* id·status·finishedAt */, nextRunAt, needsCleanupCount, repeatedFailureCount, rightsConfirmedAt, createdAt, updatedAt,
````
**바꿀 내용**
````text
  lastRun: /* id·status·finishedAt */, nextRunAt, needsCleanupCount, repeatedFailureCount, rightsConfirmedAt, createdAt, updatedAt,
  activeDocumentCount, previewStale: z.boolean(), warnings: z.array(KbScopeWarningSchema).optional(),   // [구현 추가 — §25 I-9] warnings는 저장(등록·수정) 응답에만
````

### D-12. §4 `common.ts` — `REVIEW_REQUIRED` 분리

**찾을 원문**
````text
PREVIEW_STALE｜REVIEW_REQUIRED`)
````
**바꿀 내용**
````text
PREVIEW_STALE｜REVIEW_REQUIRED` — 구현: 미승인 사유가 강등(`reviewRequiredReason`)이면 `REVIEW_REQUIRED`, 아니면 `PREVIEW_REQUIRED` · §25 I-11)
````

### D-13. §5.2 `RagHttpClient` 확장 — 기존 spec 영향

**찾을 원문**
````text
전송 바이트는 동일하다(`rag-http.client.spec.ts` 무수정).
````
**바꿀 내용**
````text
전송 바이트는 동일하다(구현: 결과 타입에 `retryAfterMs`가 더해져 `rag-http.client.spec.ts`의 기대 객체가 X-3으로 바뀌었다 · §25 I-19).
````

### D-14. §5.8 외부 RAG 부하 보호 — 토큰 버킷 구현

**찾을 원문**
````text
- **호출 한도**: 인스턴스별 토큰 버킷 `KB_RAG_CALLS_PER_MIN`(적재 + 작업 조회 + 상태 확인 합계).
````
**바꿀 내용**
````text
- **호출 한도**: 인스턴스별 토큰 버킷 `KB_RAG_CALLS_PER_MIN`(적재 + 작업 조회 + 상태 확인 합계). [구현: `kb-sync/lib/kb-rag-call-limiter.ts` — 직전 60초 슬라이딩 창 · DI 토큰 `KB_RAG_CALL_LIMITER` · §25 I-18]
````

### D-15. §5.8 외부 RAG 부하 보호 — `Retry-After`

**찾을 원문**
````text
— `Retry-After`가 더 길면 그 값.
````
**바꿀 내용**
````text
— `Retry-After`가 더 길면 그 값. [구현: `rag/lib/retry-after.ts`가 초·HTTP-date를 해석(상한 30분)하고, 값이 있으면 길이 비교 없이 고정 백오프 대신 그 값을 쓴다 · §25 I-19]
````

### D-16. §6.2 SSRF 다층 방어 — DNS 캐시

**찾을 원문**
````text
- 호스트별 DNS 결과는 **실행 안에서 5분** 재사용한다(검증된 주소만 · 재검증 포함 — 요청마다 DNS를 치지 않는다).
````
**바꿀 내용**
````text
- 호스트별 DNS 결과는 **5분** 재사용한다(구현 — §25 I-16: fetcher 인스턴스 메모리의 호스트별 TTL 5분 캐시 · 조회 실패(빈 결과)는 캐시하지 않음 · 주소 판정(절대 차단·사설 허용 목록)은 캐시 여부와 무관하게 **매 요청** 수행 · 핀 연결은 판정한 **같은 주소 배열** · 리다이렉트 재검증도 같은 캐시).
````

### D-17. §6.5 robots.txt — 요청 스킴

**찾을 원문**
````text
- 호스트별 `/robots.txt`를 실행에서 처음 방문할 때 1회 조회
````
**바꿀 내용**
````text
- 호스트별 `/robots.txt`(요청 스킴 = 그 문서 URL의 `http:`/`https:` — `lib/url-scheme.ts` · §25 I-17)를 실행에서 처음 방문할 때 1회 조회
````

### D-18. §6.6 사이트맵 — gzip 해제 구현

**찾을 원문**
````text
**압축 해제 50MB 상한**(`zlib.gunzipSync(buf, { maxOutputLength })` — 초과 시 오류 → 그 사이트맵 무시 · 압축 폭탄 방지)
````
**바꿀 내용**
````text
**압축 해제 50MB 상한**(구현 — §25 I-20: `lib/gzip-guard.ts`의 `safeGunzip()`이 `fflate` `Gunzip` 스트리밍으로 해제 바이트를 실시간 계수 · URL이 `.gz`로 끝나거나 본문이 gzip 매직 바이트 `1F 8B`면 적용 · 초과 시 `GzipGuardViolation` → 그 사이트맵 무시 · 압축 폭탄 방지)
````

### D-19. §7.1 라이브러리 표 — gzip 행

**찾을 원문**
````text
| gzip 사이트맵 | Node 내장 `zlib.gunzipSync({ maxOutputLength })` | — | 의존성 0 |
````
**바꿀 내용**
````text
| gzip 사이트맵 | ~~Node 내장 `zlib.gunzipSync({ maxOutputLength })`~~ → 구현: `fflate` `Gunzip` 스트리밍 + 해제 바이트 실시간 계수(`lib/gzip-guard.ts` — §25 I-20) | — | 추가 의존성 0(`fflate` 재사용) |
````

### D-20. §7.1 신규 의존성 — 구현 버전 · ESM 로딩 · 네이티브 빌드 차단

**찾을 원문**
````text
- 신규 의존성 **3개**(`htmlparser2`·`fflate`·`pdfjs-dist`) — 전부 순수 JS
````
**바꿀 내용**
````text
- 신규 의존성 **3개**(`htmlparser2`·`fflate`·`pdfjs-dist` — 구현 버전: `htmlparser2` **^9.1.0 고정**(v12는 ESM 전용 — §25 I-2) · `fflate` ^0.8.3 · `pdfjs-dist` **4.2.67**(legacy 빌드는 순수 ESM이라 `common/lib/import-esm.ts` 경유로 로드 — §25 I-1) · `pdfjs-dist`의 선택 의존성 `canvas`는 `pnpm-workspace.yaml`에서 빌드 스크립트 차단 — §25 I-3) — 전부 순수 JS
````

### D-21. §7.2 샌드박스 — 운영 기본 추출기 · 부팅 점검

**찾을 원문**
````text
(없으면 건너뜀 — 시험 결과는 순수 함수 시험이 보장).
````
**바꿀 내용**
````text
(없으면 건너뜀 — 시험 결과는 순수 함수 시험이 보장).
- **구현(§25 I-13)**: `KB_EXTRACTOR`의 모듈 DI 기본값은 개발·운영 구분 없이 `WorkerThreadExtractor`다. 작업 스레드 진입점은 `__dirname/extract.worker.js`이고 없으면 경로의 `src`를 `dist`로 바꾼 후보를 쓴다 — 따라서 **dev(`ts-node-dev`)·ts-jest에서도 최초 1회 `pnpm build`가 필요**하다. 둘 다 없으면 인프로세스로 조용히 대체하지 않고 `WorkerEntryMissingError`를 던진다. `KB_SYNC_ENABLED=true`면 부팅 때 `checkAvailability()`(스레드를 띄우지 않고 진입점만 확인)를 호출하고 실패하면 오류 로그 후 루프를 시작하지 않는다(§9.1). 통합 spec은 `overrideProvider(KB_EXTRACTOR)`로 `InProcessExtractor`를 쓴다.
````

### D-22. §9.1 루프 — 부팅 시 추출기 점검

**찾을 원문**
````text
`KB_SYNC_ENABLED`면 `loop.start()`
````
**바꿀 내용**
````text
`KB_SYNC_ENABLED`면 `loop.start()`(구현: 시작 전에 `KB_EXTRACTOR.checkAvailability?.()` — `WorkerEntryMissingError`면 오류 로그만 남기고 루프를 시작하지 않는다 · §25 I-13)
````

### D-23. §9.2 소스 선점 · 실행 생성 — 구현 배치

**찾을 원문**
````text
(G-10 — `governance/**` import 0).
````
**바꿀 내용**
````text
(G-10 — `governance/**` import 0).
- **구현(§25 I-4·I-5·I-6)**: ① 소스 CAS 4종(`claimForRun`·`releaseActiveRun`·`demoteReview`·`approveConfigVersion`)은 KB-9를 문자 그대로 따라 **`KbSourcesService`**가 가진다 — 스케줄러·크롤러·적재기·`KbRunsService`가 이 서비스를 호출한다. ② `kb-sync/core/kb-job-lease.ts`는 만들지 않았다 — 크롤 임대·적재 슬롯 임대·상태 행 CAS는 `kb-run.store.ts`에 있다(KB-9가 `kbJobLease` 쓰기 파일을 이 파일 1개로 고정). ③ `KbRunStore.createRun()`은 `id`를 **필수 인자**로 받는다 — 호출부가 `randomUUID()`로 만든 id로 먼저 `claimForRun()`을 하고, 성공하면 같은 id로 `createRun()`을 부른다(두 호출은 별도 호출이다).
````

### D-24. §9.3 크롤 조각 · 재개 — 삭제 감지 스윕 · DB 재집계 · 추출 실패 격리

**찾을 원문**
````text
④ 상태 전이 — 모두 `kb-run.store.ts` 트랜잭션(작업 생성은 500행 청크).
````
**바꿀 내용**
````text
④ 상태 전이 — 모두 `kb-run.store.ts` 트랜잭션(작업 생성은 500행 청크).
- **구현(§25 I-7)**: 크롤 종결 시 `run.kind ≠ PREVIEW ∧ maxPagesReached = false`이면 `findStaleDocuments()`(이번 실행에서 다시 보지 못한 ACTIVE·EXCLUDED 문서)를 `NOT_REDISCOVERED`로 관측해 `applyMissingUpdate()`로 기록한다(중단 호스트 문서 제외). 종결 집계(새로·바뀜·변경 없음·방문 HTML)는 tick 지역 변수가 아니라 `countRunObservations()`로 **DB에서 다시 조회**한다(조각 실행이 여러 tick에 걸치므로).
- **구현(§25 I-14 — 크롤 단계)**: 문서 1건의 추출 예외(작업 스레드 시간 초과·비정상 종료)는 그 문서만 `EXCLUDED(FILE_UNSAFE)`로 끝낸다. 단 `WorkerEntryMissingError`(전역 설정 오류)는 문서 탓으로 바꾸지 않고 위로 올리며, `KbCrawlRunner.runFragment()`와 `KbSyncJob.tick()`의 실행 루프가 실행 단위로 가둔다(다른 실행·다음 tick은 계속).
````

### D-25. §9.4 적재 슬롯 — CAS 하드닝 · SUBMITTING 스윕

**찾을 원문**
````text
이미 진행 중인 문서는 새 작업을 만들지 않는다(다음 실행이 다시 판정).
````
**바꿀 내용**
````text
이미 진행 중인 문서는 새 작업을 만들지 않는다(다음 실행이 다시 판정).
- **구현(§25 I-21 — 하드닝 기록)**: `claimAnySlot()`의 CAS 조건은 단순 동등 비교 `where: { name, claimToken: <읽은 값 ?? null> }` 1개다. 이전의 `OR: [{ claimToken: null }, { claimToken: row?.claimToken ?? undefined }]` 형태는 빈 슬롯에서 `undefined` 갈래를 Prisma가 조건에서 빼(가지치기) **우연히** 안전했을 뿐 CAS 불변식이 코드에 드러나지 않았다. 동작 변경은 없다.
- **구현(§25 I-15)**: 적재 조각 첫머리의 `sweepExpiredSubmittingJobs(KB_SYNC_LEASE_MS, now)`가, 쥔 슬롯(`slotToken`이 가리키는 `KbJobLease` 행)의 임대가 만료됐거나 사라진 SUBMITTING 작업을 정리한다 — `externalFileName`이 비어 있으면(외부 호출 전 중단이 확실) PENDING(`revertSubmissionClaim` — 시도 수 순증 0), 채워져 있으면(전송했을 수 있음) 재전송하지 않고 `UNKNOWN`.
````

### D-26. §9.5 적재 단계 — 추출 실패 격리 · `Retry-After`

**찾을 원문**
````text
축소였으면 `cleanupReason = SHRUNK`.
````
**바꿀 내용**
````text
축소였으면 `cleanupReason = SHRUNK`.
- **구현(§25 I-14 — 적재 단계)**: 재수집 후 추출 예외는 그 작업만 `SKIPPED(EXCLUDED_AT_INGEST)`로 끝낸다. `WorkerEntryMissingError`는 위로 올리기 전에 `revertSubmissionClaim()`으로 SUBMITTING → PENDING(백오프 없음 · `attemptCount` −1로 선점 시 +1을 상쇄 = 순증 0)으로 되돌리고, `KbIngestRunner.runFragment()`가 예외를 가둬 `false`를 돌려준다.
- **구현(§25 I-19)**: 429·503 응답의 `Retry-After`(해석값 `retryAfterMs`, 상한 30분)가 있으면 고정 백오프(1·5·30분) 대신 그 값으로 `nextAttemptAt`을 정한다.
````

### D-27. §9.6 진행률 · 예상 시간 — ETA 구현

**찾을 원문**
````text
BULK가 시간창 밖이면 `waitingReason = BULK_WINDOW`.
````
**바꿀 내용**
````text
BULK가 시간창 밖이면 `waitingReason = BULK_WINDOW`.
- **구현(§25 I-10)**: `etaSeconds` = 순수 `lib/eta.ts` `computeEtaSeconds()` — ⌈(남은 HTML 작업 × HTML 평균 + 남은 파일 작업 × 파일 평균) ÷ 슬롯 수(`KB_INGEST_CONCURRENCY`)⌉ · 표본 = 전역 최근 성공 작업(`completedAt` 내림차순) 종류별 최대 20건 · 표본 없으면 가정치 45초/150초 · 남은 작업 0이면 0 · 슬롯 ≤ 0이면 null. 조립은 `lib/build-run-view.ts` 1곳(실행 상세·목록·소스 `activeRun` 공유)이며 실행 상태가 `INGESTING`·`SUCCEEDED`·`PARTIAL`일 때만 계산한다 — 적재 작업이 없는 PREVIEW는 종결 시 **0**, 크롤 단계(`QUEUED`·`CRAWLING`)는 null.
````

### D-28. §10 개인정보 — 마스킹 끄기 거부 `details`

**찾을 원문**
````text
**저장 거부**(`400 VALIDATION_FAILED` — AC-KB6-3)
````
**바꿀 내용**
````text
**저장 거부**(`400 VALIDATION_FAILED` + `details: [{ field: 'piiMask', message: 'GOVERNANCE_MASK_REQUIRED' }]` — AC-KB6-3 · 구현 위치: 등록(`create`) 경로 · §25 I-12)
````

### D-29. §10 개인정보 — 원본 파일 전달 거부 `details`

**찾을 원문**
````text
(없으면 저장 거부 — AC-KB6-2)
````
**바꿀 내용**
````text
(없으면 저장 거부 — `400 VALIDATION_FAILED` + `details: [{ field: 'allowRawFileIngest', message: 'GOVERNANCE_RAW_FILE_NOT_ALLOWED' }]` · AC-KB6-2 · 구현 위치: 등록(`create`) 경로 · §25 I-12)
````

### D-30. §11 API — 챗봇 카드 매칭 버그 수정

**찾을 원문**
````text
(교차 404 · `ARCHIVED` 조회 허용)을 따른다.
````
**바꿀 내용**
````text
(교차 404 · `ARCHIVED` 조회 허용)을 따른다. 구현: 서브카테고리 조건이 빠져 있던 버그를 고쳐 3단 모두 적용한다(챗봇 값이 있을 때만 조건 추가 — §25 I-22).
````

### D-31. §15 봉인 KB-16 — `import-esm.ts` 범위

**찾을 원문**
````text
`node:worker_threads`·`node:crypto`·`node:zlib` |
````
**바꿀 내용**
````text
`node:worker_threads`·`node:crypto`·`node:zlib` · (구현: `common/lib/import-esm.ts`의 상수 인자 `new Function`은 검사 범위 `kb-sync/**`·`extract.worker.ts` 밖 — §25 I-1) |
````

### D-32. §17.3 의도된 기존 시험 기대값 변경 — X-3 추가

**찾을 원문**
````text
| 신규 컨트롤러 2 | ③ |
````
**바꿀 내용**
````text
| 신규 컨트롤러 2 | ③ |
| **X-3** | `apps/api/src/rag/rag-answer.service.spec.ts`(17·20행 결과 헬퍼) · `rag/rag-http.client.spec.ts`(114·122·130·209행) · `rag/lib/parse-ingest-response.spec.ts` · `rag/lib/parse-task-status.spec.ts`(뒤의 둘은 이 그룹 커밋 ①에서 만든 파일) | 결과 기대 객체에 `retryAfterMs`(`null` 또는 해석값)를 더한다 — 기계적 변경(단언 대상의 의미 변화 없음) | `RagSendResult`·`parseIngestResponse`·`parseTaskStatus` 결과 타입에 `retryAfterMs` 추가(§25 I-19) — **구현 단계에서 추가**(설계 시점 닫힌 목록 밖 · 오케스트레이터 승인) | I-19를 도입한 커밋 |
````

### D-33. §17.3 확인 항목 — `rag-http.client.spec.ts`는 X-3으로 이동

**찾을 원문**
````text
`rag-http.client.spec.ts`(공개 메서드 호출만 — 전송 바이트 불변)
````
**바꿀 내용**
````text
~~`rag-http.client.spec.ts`(공개 메서드 호출만 — 전송 바이트 불변)~~(→ X-3)
````

### D-34. §17.4 커밋 분할안 — X-3

**찾을 원문**
````text
X-n은 표의 커밋에서만(① X-1 · ③ X-2).
````
**바꿀 내용**
````text
X-n은 표의 커밋에서만(① X-1 · ③ X-2 · X-3은 `retryAfterMs`를 도입한 커밋).
````

### D-35. §18 기준선 — X-3

**찾을 원문**
````text
X-1 외 전 시험 무수정 통과 · ②는 기대값 변경 0 · ③은 X-2만 · ④는 0.
````
**바꿀 내용**
````text
X-1 외 전 시험 무수정 통과 · ②는 기대값 변경 0 · ③은 X-2만 · ④는 0. (구현 단계 추가: X-3 — `retryAfterMs` 도입 커밋 · §17.3)
````

### D-36. §19 추적표 — FR-0-212

**찾을 원문**
````text
| FR-0-212 | §17.3 X-1·X-2 |
````
**바꿀 내용**
````text
| FR-0-212 | §17.3 X-1·X-2·X-3 |
````

### D-37. §25 구현 편차 기록 — 머리 문단

**찾을 원문**
````text
(구현 단계에서 backend-implementer·frontend-implementer가 기록한다.)
````
**바꿀 내용**
````text
(구현 단계에서 backend-implementer·frontend-implementer가 기록한다.)

코드 리뷰 R2 통과 후(2026-09-27) system-architect가 실제 코드를 확인해 기록했다. 32건 모두 오케스트레이터 승인 사항이며 **새 결정이 아니라 이미 구현된 사실**이다. 파일 경로는 `apps/api/src/` 기준(다른 워크스페이스는 경로를 모두 적음), 라인은 2026-09-27 작업 트리 기준이다. 분류: 의존성 I-1~I-3 · 소스 CAS·실행 관리 I-4~I-8 · 계약 I-9~I-12 · 추출기·작업 스레드 I-13~I-15 · 전송·크롤 I-16~I-22 · 기존 시험 I-23 · 콘솔 I-24~I-32(화면 설계서 §14와 같은 내용).
````

### D-38. §25 구현 편차 기록 — 표 행 (파일 끝에 덧붙이기)

**파일 끝에 덧붙일 내용**(대상 파일의 마지막 줄 `|---|---|---|---|` 바로 다음 줄부터 · 빈 줄 없이)
````text
| I-1 | [의존성] `common/lib/import-esm.ts` 신설(§2.1 파일 목록 추가) — `importEsm(specifier)` = 인자가 상수인 `new Function('specifier', 'return import(specifier)')` 1곳으로 네이티브 동적 `import()`를 보존한다. 호출부는 `kb-sync/lib/pdf-text.ts`의 빌드타임 상수 지정자 1곳뿐이다(크롤 결과·사용자 입력 문자열을 받지 않는다). KB-16(`eval`·`new Function` 0)의 검사 범위(`kb-sync/**`·`extract.worker.ts`) 밖이다 | `pdfjs-dist@4.2.67`의 `legacy/build/pdf.mjs`는 최상위 `await`를 가진 순수 ESM이고, `module: commonjs` 트랜스파일은 `import()`를 `require()`로 낮춰 로드가 실패한다 | `common/lib/import-esm.ts:1-20` · `kb-sync/lib/pdf-text.ts:1·50` · `kb-sync/lib/kb-sync-sealing.spec.ts:381-386` |
| I-2 | [의존성] `htmlparser2`를 `^9.1.0`으로 고정한다(`fflate` `^0.8.3` · `pdfjs-dist` `4.2.67` 정확 고정) | `htmlparser2` v12는 ESM 전용이라 CommonJS로 빌드하는 `apps/api`에서 쓸 수 없다 | `apps/api/package.json:32·34·35` |
| I-3 | [의존성] `pnpm-workspace.yaml`의 `allowBuilds`에 `canvas: false`를 두어 `canvas` 빌드 스크립트를 실행하지 않는다 | `canvas@2.11.2`는 `pdfjs-dist@4.2.67`의 선택 의존성(`optionalDependencies`)으로 들어온다. 텍스트 추출에는 필요 없고, §7.1 "네이티브 빌드 0" 원칙을 지킨다 | `pnpm-workspace.yaml:8` · `pnpm-lock.yaml:6766-6769` |
| I-4 | [소스 CAS] 소스 CAS 4종(`claimForRun`·`releaseActiveRun`·`demoteReview`·`approveConfigVersion`)은 모두 `KbSourcesService`가 가진다. 스케줄러·크롤러·적재기·`KbRunsService`는 이 서비스를 호출하고, `kb-run.store.ts`는 `kbSource`를 읽기만 한다 | KB-9 문자 그대로 — "`kbSource` 쓰기 파일 = `kb-sync/kb-sources.service.ts` 1개" | `kb-sync/kb-sources.service.ts:291-309` · `kb-sync/engine/kb-scheduler.ts:33` · `kb-sync/engine/kb-crawl.runner.ts:270·279·308` · `kb-sync/engine/kb-ingest.runner.ts:394` · `kb-sync/kb-runs.service.ts:64` · `kb-sync/core/kb-run.store.ts:6-10` · `kb-sync-sealing.spec.ts:265-267` |
| I-5 | [임대] `core/kb-job-lease.ts`는 만들지 않았다. 크롤 임대(`claimCrawlLease`·`renewCrawlLease`)·적재 슬롯 임대(`ensureLeaseRow`·`claimAnySlot`·`releaseSlot`)·상태 행(`getLeaseState`·`setLeaseState`)을 `kb-run.store.ts`에 통합했다. `governance/**` import 0(KB-13)은 그대로다 | KB-9가 `kbJobLease` 쓰기 파일을 `kb-run.store.ts` 1개로 고정하므로 별도 파일을 두면 봉인과 충돌한다 | `kb-sync/core/kb-run.store.ts:96-126·696-738` · `kb-sync-sealing.spec.ts:268-271` |
| I-6 | [실행 생성] `KbRunStore.createRun()`은 `id`를 **필수 인자**로 받는다(`@default(uuid())`에 맡기지 않는다). 호출부는 `randomUUID()`로 만든 id로 먼저 `KbSourcesService.claimForRun()`을 하고, 성공하면 같은 id로 `createRun()`을 부른다(두 호출은 별도 호출이다) | id가 다르면 `KbSource.activeRunId`가 존재하지 않는 실행을 가리켜 해제 CAS(`releaseActiveRun`)가 영원히 실패한다 | `kb-sync/core/kb-run.store.ts:50-74` · `kb-sync/engine/kb-scheduler.ts:30-44` · `kb-sync/kb-runs.service.ts:63-64` |
| I-7 | [삭제 감지] 크롤 종결 시 `kind ≠ PREVIEW ∧ maxPagesReached = false`이면 `findStaleDocuments()`(이번 실행에서 다시 보지 못한 ACTIVE·EXCLUDED 문서)를 `NOT_REDISCOVERED`로 관측해 `applyMissingUpdate()`로 기록한다(중단 호스트의 문서는 건너뜀). 종결 집계(새로·바뀜·변경 없음·방문 HTML)는 `countRunObservations()`로 DB에서 다시 조회한다 | 조각 실행(§9.3)은 여러 tick에 걸쳐 이어져 tick 지역 변수가 남지 않는다. 304로 건너뛴 부모 페이지가 링크를 다시 내놓지 않아도 사라진 자식 페이지를 잡아야 한다(R-21) | `kb-sync/core/kb-run.store.ts:264-277·284-292` · `kb-sync/engine/kb-crawl.runner.ts:228-247` |
| I-8 | [유휴 판정] `KbIngestRunner.runFragment()`는 `Promise<boolean>`(이번 호출에서 실제 조회·제출을 했는가)을 돌려주고, `KbSyncJob.tick()`은 `false`가 나오면 적재 반복을 멈춘다 | 시각 추정으로 유휴를 판정하면 유휴 tick이 예산 30초를 다 쓰는 회귀가 생긴다 | `kb-sync/engine/kb-ingest.runner.ts:81-104` · `kb-sync/engine/kb-sync.job.ts:117-122` |
| I-9 | [계약] `KbSourceResponse` 필드 추가 — ① `activeDocumentCount`(state=ACTIVE 문서 수 — 전체 다시 적재 확인 문구용) ② `previewStale`(가장 최근 성공 PREVIEW의 `configVersion` ≠ 현재면 true · PREVIEW가 없으면 false. 판정 함수 `lib/preview-stale.ts` `isPreviewConfigStale()`을 `approve-ingest`의 `PREVIEW_STALE` 검사와 공유. 목록은 `kbSyncRun.groupBy({ by: sourceId, _max: configVersion })` 1회로 구한다) ③ `warnings?: { code }[]`(등록·수정 **저장 응답에만** · 코드 `SCOPE_SHARED_WITH_OTHER_SOURCE`·`SCOPE_NOT_READ_BY_ANY_CHATBOT` · 판정은 순수 함수 `lib/scope-warnings.ts`, DB 조회는 서비스). 목록 조회의 소스별 집계 4종은 groupBy 배치로 구한다 | §12 화면 3의 "저장 응답 `warnings[]`"와 §9.8 승인 조건을 계약으로 드러낸다(R1 리뷰 M-1) | `packages/shared-types/src/kb-sync.ts:209-213·247-259` · `kb-sync/lib/preview-stale.ts:6-8` · `kb-sync/lib/scope-warnings.ts:13-18` · `kb-sync/kb-sources.service.ts:102-113·204-205·279-280·316-373` · `kb-sync/core/kb-run.store.ts:374-384` · `kb-sync/kb-runs.service.ts:76-79` |
| I-10 | [계약] `etaSeconds` = `lib/eta.ts` `computeEtaSeconds()`(⌈(남은 HTML × HTML 평균 + 남은 파일 × 파일 평균) ÷ 슬롯 수⌉ · 최근 성공 작업 종류별 최대 20건 표본 · 표본 없으면 가정치 HTML 45초·파일 150초 · 남은 0이면 0 · 슬롯 ≤ 0이면 null). 조립은 `lib/build-run-view.ts` 1곳이며 `INGESTING`·`SUCCEEDED`·`PARTIAL`일 때만 계산한다 — 적재 작업이 없는 PREVIEW는 종결 시 0, 크롤 단계는 null. 슬롯 수 = `KB_INGEST_CONCURRENCY` | 실행 상세와 소스 `activeRun` 두 곳에 `null`이 하드코딩돼 있던 것을 한 함수로 모았다(§9.6) | `kb-sync/lib/eta.ts:10-42` · `kb-sync/lib/build-run-view.ts:45-97` · `kb-sync/core/kb-run.store.ts:432-505` |
| I-11 | [계약] 승인되지 않은 소스에 `SYNC`·`FULL_RESEND`를 요청하면 `409 KB_INGEST_NOT_ALLOWED`의 `details[].message`를 강등 사유(`reviewRequiredReason`)가 있으면 `REVIEW_REQUIRED`, 없으면 `PREVIEW_REQUIRED`로 나눈다(문구도 다르다). enum은 §4 그대로다 | 강등은 "다시 확인하라"는 뜻이라 안내 문구가 달라야 한다 | `kb-sync/kb-runs.service.ts:46-55` |
| I-12 | [계약] 거버넌스 모드 ON의 저장 거부(`400 VALIDATION_FAILED`)에 `details`를 붙인다 — 마스킹 끄기 `[{ field: 'piiMask', message: 'GOVERNANCE_MASK_REQUIRED' }]` · 서버가 허용하지 않은 원본 파일 전달 `[{ field: 'allowRawFileIngest', message: 'GOVERNANCE_RAW_FILE_NOT_ALLOWED' }]`. 이 검사는 등록(`create`) 경로에 있다. 콘솔은 `details[].field`로 필드별 인라인 오류를 표시한다 | 필드별 인라인 오류(UIUX §7) | `kb-sync/kb-sources.service.ts:154-163` · `apps/web/src/pages/settings/kb-crawling/KbSourceEditModal.tsx:206-211` · `integration/kb-sources-governance-validation.integration.spec.ts:158·170` |
| I-13 | [추출기] 운영 기본 추출기 = `WorkerThreadExtractor`(개발·운영 공통 DI 기본값). 진입점은 `__dirname/extract.worker.js`이고, 없으면 경로의 `src`를 `dist`로 바꾼 후보를 쓴다 → **dev·ts-jest에서도 최초 1회 `pnpm build`가 필요**하다. 둘 다 없으면 인프로세스로 대체하지 않고 `WorkerEntryMissingError`를 던진다. `KB_SYNC_ENABLED=true`면 부팅 때 `checkAvailability()`를 호출하고 실패하면 루프를 시작하지 않는다. 통합 spec은 `overrideProvider(KB_EXTRACTOR)`로 `InProcessExtractor`를 쓴다 | 샌드박스 격리는 보안 요건이다(§7.2) — 조용한 인프로세스 대체 금지. 부팅 점검은 매 tick 오류 반복 대신 가장 이른 시점에 한 번 알린다(R1 M-2) | `kb-sync/kb-sync.module.ts:29-47` · `kb-sync/extract/worker-thread.extractor.ts:14-59` · `kb-sync/engine/kb-sync.job.ts:48-80` · `integration/kb-sync*.integration.spec.ts`(5파일) |
| I-14 | [추출 실패 격리] 크롤 단계 추출 예외 = 그 문서만 `EXCLUDED(FILE_UNSAFE)` · 적재 단계 추출 예외 = 그 작업만 `SKIPPED(EXCLUDED_AT_INGEST)`. `WorkerEntryMissingError`는 전역 오류로 위로 올린다 — 적재 단계는 올리기 전에 `revertSubmissionClaim()`으로 SUBMITTING → PENDING(백오프 없음 · `attemptCount` −1로 선점 시 +1을 상쇄 = 순증 0). `KbCrawlRunner.runFragment()`·`KbIngestRunner.runFragment()`·`KbSyncJob.tick()`의 실행 루프가 각각 실행 단위로 예외를 가둔다 | 예외가 작업을 SUBMITTING에 영구히 가두거나, 문서를 QUEUED로 남겨 매 tick 같은 실패를 반복하거나, 같은 tick의 다른 실행을 멈추는 문제(R1 H-2 · R2) | `kb-sync/engine/kb-crawl.runner.ts:99-112·362-374` · `kb-sync/engine/kb-ingest.runner.ts:89-104·305-327` · `kb-sync/core/kb-run.store.ts:547-558` · `kb-sync/engine/kb-sync.job.ts:101-115` · `integration/kb-sync-extraction-failure.integration.spec.ts` |
| I-15 | [SUBMITTING 정리] `sweepExpiredSubmittingJobs(leaseMs, now)` — 적재 조각 첫머리에서, 쥔 슬롯(`slotToken`이 가리키는 `KbJobLease` 행)의 임대가 만료됐거나 사라진 SUBMITTING 작업을 정리한다. `externalFileName`이 비어 있으면 PENDING(`revertSubmissionClaim`), 채워져 있으면 `UNKNOWN`(재전송 안 함). 만료 기준은 `KB_SYNC_LEASE_MS` + `isLeaseExpired` | 프로세스 크래시 등으로 SUBMITTING에 남은 작업의 방어선. `recordSubmissionMeta()`(→ `externalFileName`)는 `ragClient.ingest()` 직전에만 기록되므로 비어 있으면 전송 전 중단이 확실하다(R2) | `kb-sync/core/kb-run.store.ts:560-602·627-645` · `kb-sync/engine/kb-ingest.runner.ts:91-94·110-115` · `kb-sync/core/kb-run.store.sweep.spec.ts` |
| I-16 | [DNS] fetcher 인스턴스 메모리에 호스트별 TTL 5분 캐시. 빈 결과(조회 실패)는 캐시하지 않는다. 주소 판정(절대 차단·사설 허용 목록)은 캐시 여부와 무관하게 매 요청 수행하고, 핀 연결(`pinnedAddresses`)은 판정한 같은 배열을 쓴다 | 요청마다 DNS를 치지 않되, 판정 생략과 일시 실패의 5분 고착은 막는다(R1 M-3 · §6.2) | `kb-sync/crawl/kb-crawl-http.fetcher.ts:33-36·52·64-73·90-110` |
| I-17 | [robots] robots.txt 요청 스킴은 그 문서 URL의 스킴을 따른다 — 순수 `lib/url-scheme.ts` `httpOrHttpsScheme()`(파싱 실패 시에만 `https:`) | https 하드코딩 때문에 http만 쓰는 사내 사이트의 robots.txt를 받지 못했다(R1 L-2) | `kb-sync/lib/url-scheme.ts:6-12` · `kb-sync/engine/kb-crawl.runner.ts:193-195` · `integration/kb-sync-robots-scheme.integration.spec.ts` |
| I-18 | [호출 한도] 토큰 버킷 `lib/kb-rag-call-limiter.ts` — 인스턴스별 직전 60초 슬라이딩 창(`KB_RAG_CALLS_PER_MIN`, 기본 30) · DI 토큰 `KB_RAG_CALL_LIMITER`. 적재 제출(`claimJobForSubmission` 전에 확인 — 한도 초과가 시도 수를 소모하지 않음)·작업 조회(초과 시 상태 변경 없이 이번 tick 건너뜀)·vLLM 상태 확인(초과 시 캐시값 사용) 3곳에서 `tryAcquire()` | §5.8 호출 한도의 구현 | `kb-sync/lib/kb-rag-call-limiter.ts:1-32` · `kb-sync/kb-sync.module.ts:48` · `kb-sync/engine/kb-ingest.runner.ts:129-131·178-180·228-230` |
| I-19 | [Retry-After] 순수 `rag/lib/retry-after.ts` `parseRetryAfterMs()`(초 또는 HTTP-date · 과거·파싱 실패 = null · 상한 30분). `RagHttpClient.send()`가 429·503 응답에서 해석해 `RagSendResult.retryAfterMs`(`number \| null`)로 싣고, `parseIngestResponse`(429·503)·`parseTaskStatus`(429)가 넘기며, 적재기는 값이 있으면 고정 백오프 대신 그 값을 쓴다(길이 비교 없음) | §5.8 "`Retry-After` 반영"의 구현 — 상한은 백오프 최댓값(30분)과 같다 | `rag/lib/retry-after.ts:5-20` · `rag/rag-http.client.ts:28·139-140` · `rag/lib/parse-ingest-response.ts:28·43-44` · `rag/lib/parse-task-status.ts:27-28` · `kb-sync/engine/kb-ingest.runner.ts:142-162` · X-3 |
| I-20 | [gzip] 사이트맵 gzip 해제는 `lib/gzip-guard.ts` `safeGunzip()` — `zlib.gunzipSync` 대신 `fflate` `Gunzip` 스트리밍으로 해제 바이트를 실시간 계수해 50MB를 넘으면 `GzipGuardViolation(SIZE_EXCEEDED)`(디코딩 실패 = `DECODE_ERROR`). URL이 `.gz`로 끝나거나 본문이 gzip 매직 바이트(`1F 8B`)면 적용하고, 위반은 "사이트맵 무시" 경로로 흡수한다 | 압축 헤더가 아니라 실제 해제량으로 폭탄을 막는다(KB-17 · `container-guard.ts`와 같은 원칙) | `kb-sync/lib/gzip-guard.ts:1-64` · `kb-sync/engine/kb-crawl.runner.ts:145-155` · `kb-sync/lib/gzip-guard.spec.ts` |
| I-21 | [하드닝] `claimAnySlot()`의 CAS를 단순 동등 비교 `where: { name, claimToken: row?.claimToken ?? null }` 1개로 명시했다. 이전 `OR: [{ claimToken: null }, { claimToken: row?.claimToken ?? undefined }]`는 빈 슬롯에서 `undefined` 갈래를 Prisma가 조건에서 빼(가지치기) **우연히** 안전했을 뿐이다. 동작 변경은 없다 | "읽은 값과 같을 때만 쓴다"는 CAS 불변식이 코드만 보고도 드러나야 한다(R1 H-1) | `kb-sync/core/kb-run.store.ts:706-724` · `integration/kb-sync-multi-instance.integration.spec.ts:297` · `kb-sync/core/kb-run.store.cas.spec.ts` |
| I-22 | [버그 수정] 챗봇 카드(`GET /chatbots/:chatbotId/kb-status`)의 소스 매칭에 서브카테고리 조건이 빠져 있던 것을 §11 규칙대로 3단 모두 적용하게 고쳤다(챗봇 값이 있을 때만 조건 추가) | §11 매칭 규칙 | `kb-sync/kb-status.service.ts:53-60` |
| I-23 | [기존 시험] X-1·X-2 외에 X-3이 있다 — `RagSendResult.retryAfterMs` 추가(I-19)로 기존 RAG spec 4파일의 기대 객체에 `retryAfterMs`가 기계적으로 더해졌다(§17.3) | 결과 타입 변경의 불가피한 반영 | `rag/rag-answer.service.spec.ts:17·20` · `rag/rag-http.client.spec.ts:114·122·130·209` · `rag/lib/parse-ingest-response.spec.ts` · `rag/lib/parse-task-status.spec.ts` |
| I-24 | [콘솔] `POST /kb-sources/:id/runs`의 `kind`는 **클라이언트**가 정한다 — KB2 케밥 "지금 실행" = `ingestApproved ? 'SYNC' : 'PREVIEW'` · 개요 탭 "지금 미리보기 실행" = 항상 `PREVIEW`. 종류 선택 UI는 없다. 서버 계약(`kind` 필수)은 §4 그대로다 | 화면 설계서 §13.1-3의 "서버 자동 결정" 문구가 실제와 다르다(화면 설계서에서 정정) | `apps/web/src/pages/settings/kb-crawling/KbSourcesPage.tsx:157` · `KbSourceOverviewPage.tsx:69` |
| I-25 | [콘솔] 스코프 3단(회사·카테고리·서브카테고리)은 폼에서 모두 필수로 검증한다(각각 인라인 오류 · `RagScopeFields` 재사용) | §4 `KbSourceScopeSchema`가 3단 모두 필수다 — RAG 답변 설정 스코프와 달리 카테고리도 필수 | `apps/web/src/pages/settings/kb-crawling/KbSourceEditModal.tsx:149-152·354-366` |
| I-26 | [콘솔·계약] 데이터 지도 소스 절의 키는 응답 **최상위** `kbSources`(`inbox`와 같은 층)다 — 이 문서·화면 설계서의 `egress.kbSources` 표기는 실제로는 `GovernanceMapResponse.kbSources`다. 소스 0개면 키 생략은 그대로다 | 스키마 구현 위치 | `packages/shared-types/src/governance.ts:275-292` · `governance/governance-map.service.ts:50·62` · `apps/web/src/pages/settings/data-governance/DataGovernanceMapPage.tsx:238-241` |
| I-27 | [콘솔] `noisePatterns`는 등록 폼 "범위" 섹션 안의 목록 입력(라벨 "잡음 줄 패턴(선택, 고급)")으로 둔다(별도 접힘 섹션은 없다) | 화면 설계서 KB6 목업에 없던 필드의 배치 | `apps/web/src/pages/settings/kb-crawling/KbSourceEditModal.tsx:302-310` · `apps/web/src/constants/messages.ts:3651` |
| I-28 | [콘솔] 목록 입력(시작 주소·사이트맵·경로 접두·제외 패턴·잡음 줄)은 `KbStringListField`가 기존 `ReorderableList`(No.27 선례)를 재사용한다 | 기존 컴포넌트 재사용 | `apps/web/src/pages/settings/kb-crawling/KbStringListField.tsx:2·22·52` · `KbSourceEditModal.tsx:259-310` |
| I-29 | [콘솔] 공용 `AsyncJobProgress`에 선택 prop `live?: boolean`(기본 `true` = 현행)을 더했다 — `false`면 루트의 `role="status"`/`aria-live`와 sr-only 문구를 빼고 시각 표시만 한다. `KbRunProgress`는 `live={false}` + 별도 sr-only `aria-live` 텍스트를 쓴다 | 화면 설계서 §12-①의 미정 사항(공용 확장 vs 래퍼)에 대한 구현 결과 | `apps/web/src/components/AsyncJobProgress.tsx:8-14·22-32` · `apps/web/src/pages/settings/kb-crawling/KbRunProgress.tsx:33-34` |
| I-30 | [콘솔] 실행 이력의 펼치기 트리거는 실제 `<button aria-expanded aria-controls>`(데스크톱 표·모바일 카드 공통)이고, 상세 행·패널은 접힌 상태에서도 DOM에 두고 `hidden`으로 숨긴다 | `<tr onClick>`만으로는 키보드 조작 불가(R1 H2) · `aria-controls` 대상이 늘 존재해야 한다(R2 Low) | `apps/web/src/pages/settings/kb-crawling/KbRunTable.tsx:40-41·75-94·133-148` |
| I-31 | [콘솔] KB5 문서 목록에서 필터(상태·정리 필요만·제외 사유) 결과가 0건이면 "아직 수집된 문서가 없습니다" 대신 별도 빈 상태(`emptyFilterTitle`)와 [필터 초기화] 버튼(필터 3종 해제 · 1쪽으로)을 보여 준다 | 필터로 0건인 것과 수집 전 0건을 구분(R1 M3) | `apps/web/src/pages/settings/kb-crawling/KbDocumentListPage.tsx:114-123·197-207` |
| I-32 | [콘솔] `KbSourceShell`은 `GET /kb-sources/meta`를 먼저 부르고, 성공한 뒤에만 `GET /kb-sources/:id`를 부른다 — meta 404 = 기능 꺼짐(KB12), 그 뒤의 404 = 소스 없음 | 기능 꺼짐 가드와 "소스 없음"이 둘 다 `code: NOT_FOUND`라 메시지 비교 대신 호출 순서로 404 원인을 구분한다(R1 M4) | `apps/web/src/pages/settings/kb-crawling/KbSourceShell.tsx:35-67·81-83` |
````

---

## U. `docs/03-design/kb-crawling-ui-spec.md`

### U-1. §13.1 사용자 결정 3 — 실행 종류 결정 주체 정정 (I-24)

**찾을 원문**
````text
3. "지금 실행"은 **서버 자동 결정**(선택 UI 없음)으로 확정한다.
````
**바꿀 내용**
````text
3. "지금 실행"은 **선택 UI 없이 자동 결정**으로 확정한다. **[구현 사실 — 2026-09-27 · 설계서 §25 I-24]** 결정 주체는 서버가 아니라 **클라이언트**다 — KB2 케밥 "지금 실행"은 목록 응답의 `ingestApproved`를 보고 `POST /kb-sources/:id/runs { kind: ingestApproved ? 'SYNC' : 'PREVIEW' }`를 보낸다(`KbSourcesPage.tsx:157`). 개요 탭의 "지금 미리보기 실행"은 항상 `PREVIEW`다(`KbSourceOverviewPage.tsx:69`). 서버 계약(`kind` 필수)은 설계서 §4·§11 그대로다.
````

### U-2. §3.2 필드-오류 매핑 — 스코프 3단 모두 필수 (I-25)

**찾을 원문**
````text
| 회사/카테고리/서브카테고리 | 회사 빈 값 | "회사를 입력하세요."(외부 RAG 필수값) |
````
**바꿀 내용**
````text
| 회사/카테고리/서브카테고리 | **3단 모두** 빈 값(구현 — 설계서 §25 I-25: `KbSourceScopeSchema` 3단 필수 계약과 일치 · RAG 답변 설정 스코프와 달리 카테고리도 필수) | "회사를 입력하세요."(외부 RAG 필수값) · 카테고리·서브카테고리도 각각 필수 문구(`errorScopeCategoryRequired`·`errorScopeSubcategoryRequired`) |
````

### U-3. §3.2 KB6 — 잡음 줄 패턴 배치 · 목록 입력 컴포넌트 (I-27 · I-28)

**찾을 원문**
````text
(모달 유지, 값 보존).
````
**바꿀 내용**
````text
(모달 유지, 값 보존).
- **구현(설계서 §25 I-27)**: 잡음 줄 패턴(`noisePatterns`)은 "범위" 섹션 안의 목록 입력으로 둔다 — 라벨 "잡음 줄 패턴(선택, 고급)" · 별도 접힘 섹션은 없다(`KbSourceEditModal.tsx:302-310` · `messages.ts:3651`).
- **구현(설계서 §25 I-28)**: 시작 주소·사이트맵·경로 접두·제외 패턴·잡음 줄 패턴의 여러 줄 입력은 `KbStringListField`가 기존 `ReorderableList`(No.27 선례)를 재사용한다(`KbStringListField.tsx:2·52`).
````

### U-4. §3.8 KB11 위치 — `kbSources`는 응답 최상위 (I-26)

**찾을 원문**
````text
`egress.workflowTargets` 절과 같은 위치·형식으로 추가(`egress.kbSources` 선택 키, 0개면 절 자체가 렌더되지 않는다).
````
**바꿀 내용**
````text
`egress.workflowTargets` 절과 같은 위치·형식으로 추가(`egress.kbSources` 선택 키, 0개면 절 자체가 렌더되지 않는다). **구현(설계서 §25 I-26)**: 실제 키는 응답 **최상위** `kbSources`(`GovernanceMapResponse.kbSources` — `egress` 아래가 아니다)다. 이 문서의 `egress.kbSources` 표기는 모두 같은 뜻이다(`DataGovernanceMapPage.tsx:238-241`).
````

### U-5. §12-① `AsyncJobProgress` — 구현 결과 (I-29)

**찾을 원문**
````text
(둘 다 이 문서의 요구사항을 만족한다).
````
**바꿀 내용**
````text
(둘 다 이 문서의 요구사항을 만족한다). **→ 구현(설계서 §25 I-29)**: 공용 컴포넌트에 선택 prop `live?: boolean`(기본 `true` = 현행)을 더했다. `false`면 루트의 `role="status"`/`aria-live`와 sr-only 문구를 빼고 시각 표시만 한다. `KbRunProgress`는 `live={false}` + 별도 sr-only `aria-live` 텍스트를 쓴다(`AsyncJobProgress.tsx:8-14·22-32` · `KbRunProgress.tsx:33-34`).
````

### U-6. §3.4 KB4 컴포넌트 분해 — 펼치기 트리거 (I-30)

**찾을 원문**
````text
├── KbRunTable(진행/완료 공통 행 + 펼침)
````
**바꿀 내용**
````text
├── KbRunTable(진행/완료 공통 행 + 펼침 — 구현 I-30: 펼치기 트리거는 <button aria-expanded aria-controls>, 상세 행·패널은 접혀도 DOM에 두고 hidden으로 숨김)
````

### U-7. §3.5 KB5 상태별 UI — 필터 결과 0건 (I-31)

**찾을 원문**
````text
| 빈 상태(문서 0건 — 아직 실행 안 됨) | `EmptyState`: "아직 수집된 문서가 없습니다. 먼저 실행하세요." |
````
**바꿀 내용**
````text
| 빈 상태(문서 0건 — 아직 실행 안 됨) | `EmptyState`: "아직 수집된 문서가 없습니다. 먼저 실행하세요." |
| 필터 결과 0건(구현 — 설계서 §25 I-31) | 별도 `EmptyState`(`emptyFilterTitle`) + [필터 초기화] 버튼(상태·정리 필요만·제외 사유 해제 · 1쪽으로) — `KbDocumentListPage.tsx:114-123·197-207` |
````

### U-8. §3.3 KB3 상태별 UI — 404 원인 구분 (I-32)

**찾을 원문**
````text
| 소스가 삭제된 경우(직접 URL 접근) | `ErrorState`(404) |
````
**바꿀 내용**
````text
| 소스가 삭제된 경우(직접 URL 접근) | `ErrorState`(404) — 구현(설계서 §25 I-32): `KbSourceShell`이 `GET /kb-sources/meta`를 먼저 부르고 성공한 뒤에만 `GET /kb-sources/:id`를 부른다. 둘 다 `NOT_FOUND`라 호출 순서로 구분한다 — meta 404 = 기능 꺼짐(KB12), 그 뒤의 404 = 소스 없음(`KbSourceShell.tsx:35-67·81-83`) |
````

### U-9. §14 구현 편차 반영 (신규 절 — §13.1 끝에 append)

**찾을 원문**
````text
4. 모바일에서도 확인 문구를 **축약하지 않고** 전체 문장을 줄바꿈해 보여준다.
````
**바꿀 내용**
````text
4. 모바일에서도 확인 문구를 **축약하지 않고** 전체 문장을 줄바꿈해 보여준다.

---

## 14. 구현 편차 반영 (코드 리뷰 R2 통과 후 · 2026-09-27)

화면 관련 구현 사실이다(오케스트레이터 승인 · 새 결정 아님). 상세 근거는 `docs/02-spec/kb-crawling-설계.md` §25와 같다.

| 설계서 §25 | 내용 | 코드 |
|---|---|---|
| I-24 | 수동 실행 `kind`는 클라이언트가 `ingestApproved`로 정한다(선택 UI 없음) — §13.1-3 정정 | `KbSourcesPage.tsx:157` · `KbSourceOverviewPage.tsx:69` |
| I-25 | 스코프 3단 모두 필수(각각 인라인 오류) — §3.2 표 | `KbSourceEditModal.tsx:149-152` |
| I-26 | 데이터 지도 소스 절의 키는 응답 최상위 `kbSources` — §3.8 | `DataGovernanceMapPage.tsx:238-241` |
| I-27 | 잡음 줄 패턴은 "범위" 섹션 안 "(선택, 고급)" 목록 입력 — §3.2 | `KbSourceEditModal.tsx:302-310` |
| I-28 | 목록 입력은 `ReorderableList` 재사용(`KbStringListField`) — §3.2 | `KbStringListField.tsx:2·52` |
| I-29 | `AsyncJobProgress`에 `live` prop 추가 — §12-① | `AsyncJobProgress.tsx:8-14·22-32` |
| I-30 | 실행 이력 펼치기 = `<button>` · 상세는 `hidden` — §3.4 | `KbRunTable.tsx:75-94·133-148` |
| I-31 | KB5 필터 결과 0건 → [필터 초기화] — §3.5 | `KbDocumentListPage.tsx:197-207` |
| I-32 | `KbSourceShell`이 meta를 먼저 불러 404 원인을 구분 — §3.3 | `KbSourceShell.tsx:35-67` |
````

---

## A. `docs/02-spec/decisions/ADR-0044-knowledge-base-sync-crawler-egress-change-detection-and-serial-external-rag-ingest.md`

### A-1. 결정 §7 — 잡 임대 파일 위치 (I-5)

**찾을 원문**
````text
잡 임대는 `governance/**` 밖의 동형 파일(G-10).
````
**바꿀 내용**
````text
잡 임대는 `governance/**` 밖의 동형 파일(G-10). (구현: 별도 `kb-job-lease.ts` 없이 `kb-sync/core/kb-run.store.ts`에 통합 — KB-9가 `kbJobLease` 쓰기 파일을 1개로 고정하므로. 소스 CAS는 `KbSourcesService` — 설계서 §25 I-4·I-5)
````

### A-2. 결정 §10 — 라이브러리 구현 버전 (I-1~I-3)

**찾을 원문**
````text
`pdfjs-dist` ≥ 4.2.67(`isEvalSupported: false`). 전부 순수 JS(네이티브 0).
````
**바꿀 내용**
````text
`pdfjs-dist` ≥ 4.2.67(`isEvalSupported: false`). 전부 순수 JS(네이티브 0). (구현 고정: `htmlparser2` ^9.1.0 — v12는 ESM 전용 · `pdfjs-dist` 4.2.67 — 순수 ESM이라 `common/lib/import-esm.ts` 경유 로드 · 선택 의존성 `canvas`는 `pnpm-workspace.yaml`에서 빌드 차단 — 설계서 §25 I-1~I-3)
````

### A-3. 결과 — X-3 (I-23)

**찾을 원문**
````text
의도된 기존 시험 기대값 변경 X-1(RM-8 6 → 7)·X-2(컨트롤러 46 → 48).
````
**바꿀 내용**
````text
의도된 기존 시험 기대값 변경 X-1(RM-8 6 → 7)·X-2(컨트롤러 46 → 48)·X-3(구현 단계 추가 — `RagSendResult.retryAfterMs`로 RAG spec 4파일의 기대 객체 갱신 · 설계서 §17.3).
````
