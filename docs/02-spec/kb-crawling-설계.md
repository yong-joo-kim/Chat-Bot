# 지식베이스 자동 크롤링/동기화 세부 설계서 (No.43)

> **요구사항**: `docs/requirements/kb-crawling.md`(T-1~T-6, J-1~J-19, FR-0-203~214, FR-KB1-\*~FR-KB9-\*, NFR-KBP/KBS/KBR/KBA/KBM, AC-KB1~KB7, EX-KB-1~22, 제약 C-1~C-12, P-1~P-12)
> **외부 명세**: `docs/00-source/API_RAG.md` §1(적재) · §5(비동기 작업) · §0(공통 제한)
> **상위 문서**: `docs/02-spec/개발명세서.md` §2·§2.1·§2.2·§3·§3.1·§4·§4.1·§5·§5.1·§6(**결정 45 신설**)·§7
> **신규 ADR**: **ADR-0044**(지식베이스 동기화 = 수집·변경 감지는 `apps/api` · 적재·색인·답변은 외부 RAG · 원문 비저장 · 7번째 출구 클래스 `KB_CRAWL` · 적재는 RAG 출구 안의 새 데이터 종류 · 첫 회 미리보기 · 자동 삭제 없음 · 슬롯 임대 전역 직렬 적재 · 결정적 파일 이름). `decisions/`의 현재 최대 번호가 0043이므로 다음 빈 번호 **0044**다(요구사항의 가번호와 우연히 같다 — 확정).
> **Supersedes(부분)**: **ADR-0022 §2 표의 `POST /api/documents/ingest`·`/api/async_task*` 행과 §5의 "향후에도 문서 인입·task 폴링 아키텍처를 만들지 않는다" 문장 중 "인입(적재)·task 개별 조회" 부분**. 나머지(수동 업로드 화면 없음 · 삭제·초기화·전역 설정·프롬프트 금지 · `provider` 상수 · 경로 인자 미수용 · 무인증 전제)는 **불변**이다.
> **갱신 ADR(각주만)**: **ADR-0022(재결정 — 적재·작업 개별 조회 2경로)** · **ADR-0040(출구 6 → 7 · 데이터 종류 +2 · `CALL_LOGS` 편입 · 완화 환경변수 2 · 데이터 지도 선택 키)** · **ADR-0041(공유 전송 포트 세 번째 사용자 · 이동 트리거 발동과 연기 · 운영 이벤트 2차 목록 +1)** · ADR-0034(전송 포트 선택 필드 +2) · ADR-0013(7번째 적용 지점 = 지식베이스 적재 송신)
> **작성일**: 2026-09-27 · **GPU**: **1**(카탈로그 4 → 1 — P-12, §22) · 구축형 ○(전제 필요) · 구독형 △
> **기존 파일 수정 목록**: 문서는 `docs/02-spec/kb-crawling-patches.md`, 코드는 이 문서 §2.5.
> **표기**: 봉인 번호는 **KB-1~KB-22**(+ **KB-14b** — pass 8), 의도된 기존 시험 기대값 변경은 **X-1~X-3**(X-3은 구현 단계에서 추가 — §17.3), 요구사항 대비 해석은 **R-1~R-30**, 알려진 제한은 **K-1~K-29**(K-15~K-18 = pass 6 · K-19~K-23 = pass 7·8 · K-24~K-26 = pass 9·10 · K-27~K-28 = pass 11·12 · K-29 = pass 13·웹 RG-27 — K-26은 pass 11 해소), 외부 RAG 담당자 확인 사항은 **Q-1~Q-10**, 구현 편차는 **I-1~I-108**(§25 — 코드 리뷰 R2 통과 후 I-1~I-32 · 백엔드 pass 4 후 I-33~I-48 · 백엔드 pass 5 후 I-49~I-61 · 백엔드 pass 6 후 I-62~I-74 · 백엔드 pass 7·8 후 I-75~I-88 · 백엔드 pass 9·10 후 I-89~I-98 · 백엔드 pass 11·12·웹 후속 후 I-99~I-106 · 백엔드 pass 13·웹 RG-27 후 I-107~I-108), 알려진 잔여 갭(미구현)은 **RG-1~RG-28**(§25.1 = pass 4 시점 기록 · §25.2 = pass 5 시점 기록과 신규 갭 RG-16~RG-20 · §25.3 = 호스트 겹침 실행 — pass 6에서 B안 채택·구현 · §25.4 = pass 6 시점 기록과 신규 갭 RG-21~RG-22 · §25.5 = pass 7·8 시점 기록 · 신규 갭 RG-23~RG-25 · §8.4 적용 대상 정리 · 거버넌스 결정 번복 · 사용자 결정 대기 U-1~U-4 · **§25.6 = pass 9·10 현재 상태 · RG-23·RG-25 해소 · U-3 채택 · 신규 갭 RG-26 · 사용자 결정 U-5 · 잔여 갭 요약표(커밋 전 필수/권장/후속)** · **§25.7 = pass 11·12·웹 후속 현재 상태 · RG-26 해소(U-5 (b) 채택) · K-26 해소 · 신규 갭 RG-27·RG-28 · `observedHash` 값 체계 표 · 최종 판정 · 커밋 분할(§17.4 갱신)** · **§25.8 = pass 13·웹 RG-27 반영 — RG-28·RG-27 해소 · 최종 판정(커밋 전 필수 0건) · 최종 시험 수치 · 커밋 분할 재점검(시험 안정화 커밋 ⓪ 분리)**)이다.

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

카탈로그 No.43은 "사내 웹사이트·문서를 주기적으로 크롤링해 RAG(30번)용 지식베이스를 자동 최신화, 변경분만 재인덱싱"이다. PM은 2026-09-27에 **P-1 (a)** 를 확정했다 — 우리는 **수집과 변경 감지**만 하고, 바뀐 것만 외부 RAG의 적재 API(`POST /api/documents/ingest`)로 보내며 그 작업을 개별 조회(`GET /api/async_task_status/{id}`)로 추적한다. 청킹·임베딩·검색·답변은 지금처럼 외부 RAG가 한다. 이 설계는 **기능이 꺼져 있거나 소스가 0개인 설치의 결과를 한 바이트도 바꾸지 않고** 다음을 만든다. ① `apps/api`에 **`kb-sync` 모듈**(소스 등록·실행 이력·문서 목록 API 13개 · `PollingLoop` 1개) ② **7번째 출구 클래스 `KB_CRAWL`** — No.26/No.41의 공유 전송 포트·DNS·주소 판정 부품을 **세 번째 DI 토큰**으로 재사용하고 리다이렉트는 크롤러가 **한 단계씩 재검증하며 최대 3회** 따라간다 ③ **`RagHttpClient`의 경로 허용 목록 3 → 5**(적재·작업 개별 조회) — 멀티파트 본문을 같은 `send()` 한 곳에서 보내고, 삭제·초기화·전역 설정·프롬프트·작업 목록·작업 취소·`file_path`·`force_sync` 문자열은 송신 코드에 0건 ④ **원문 비저장** — 본문 텍스트·파일 바이트는 메모리에서만 다루고 DB에는 URL·해시·HTTP 검증자·상태만 남긴다(적재 시점에 다시 받아 보낸다) ⑤ **첫 회 미리보기 → 관리자 승인 → 이후 자동**, 사라지거나 짧아진 페이지는 **자동 삭제 없이 "정리 필요"** ⑥ **전역 직렬 적재**를 슬롯 임대 행 CAS로, **소스당 동시 실행 1**을 소스 행 CAS로 보장해 **원시 부분 유니크 인덱스 4개를 그대로** 둔다 ⑦ 모든 HTML·문서 해석·해시·마스킹·변환은 **작업 스레드(`worker_threads`) 샌드박스** 안에서 한다(이벤트 루프 차단 0 · 메모리 상한 · 시간 상한 · zip bomb 방어).

> 이 설계가 코드에서 **추가로 찾은 제약 12건**(요구사항 C-1~C-12 외):
> **① `file_path`는 이미 저장소 코드에 있다**(`rag/lib/rag-response.schema.ts` 13행 — 질의 응답 `sources[].file_path` 파싱 · `rag/lib/sanitize-sources.ts` 28행 — 절대경로 제거) → 요구사항 FR-0-204 "저장소 0건"은 성립할 수 없다. 봉인은 **송신 조립 파일·`kb-sync/**` 0건 + 기존 응답 파서 2파일 고정**으로 정밀화한다(KB-3 · R-3) ·
> **② `RagHttpClient.send()`는 `Content-Type: application/json` 고정 · `fetch(` 1곳**(`rag-http.client.ts` 75~82행) → 멀티파트는 두 번째 `fetch(`가 아니라 **같은 `send()`의 본문 인코딩 선택**으로 보낸다(G-2 "가드 수 ≥ 송신 수" · 기존 `rag-allowlist.spec.ts` 무수정 — §5.2) ·
> **③ 공유 전송 포트는 3xx를 즉시 `REDIRECT_NOT_ALLOWED`로 끝내고 `Location`을 돌려주지 않으며, 응답 헤더는 `content-type`·`retry-after`만 준다**(`node-http.transport.ts` 79~86행) → 크롤러의 수동 리다이렉트·조건부 요청(ETag·Last-Modified)·`X-Robots-Tag`를 위해 **선택 필드 2개**(`redirectMode`·`captureHeaders`)를 더한다 — 기본값 = 현행(레거시·웹훅 호출부 무수정 — §6.3) ·
> **④ `ip-policy.parseAllowlist()`의 경고 문구가 `LEGACY_API_PRIVATE_ALLOWLIST`로 하드코딩돼 있다**(160~205행 — 업무 자동화도 같은 문구를 찍는다) → 선택 인자 `label`(기본값 = 현행 문구)을 더한다 ·
> **⑤ 데이터 지도 `exits[]`는 레지스트리를 순회해 만든다**(`governance-map.service.ts` 146행 — `LEGACY_API`·`WORKFLOW_WEBHOOK`만 제외) → `KB_CRAWL`을 레지스트리에 넣으면서 **제외 목록에도 넣지 않으면 모든 설치의 데이터 지도 응답이 바뀐다**(FR-0-203 위반) — 제외 + 선택 키 `egress.kbSources?`(소스 0개면 생략) ·
> **⑥ 레지스트리 항목은 `dataKind`·`masked`가 1개씩이다**(`egress-registry.ts` 7~15행) → RAG 출구가 "마스킹된 질문"과 "문서 본문(소스별 마스킹·원본 파일은 비마스킹)"을 함께 보내면 한 행으로 표현할 수 없다. 이 설계는 출구 클래스를 나누지 않고 **데이터 지도 `kbSources` 절이 소스 단위로 표시**한다(ADR-0044 §6 · R-2) ·
> **⑦ `PollingLoop`는 tick이 끝나야 다음 tick을 예약한다**(`polling-loop.ts` 56~63행) · `stop()`은 진행 중 tick을 최대 대기 후 포기한다 → 크롤(수십 분)·적재(수 시간)를 한 tick에 담을 수 없다. **tick 예산 30초의 조각 실행 + DB 프런티어로 이어서 하기**(§9.3) ·
> **⑧ SQLite의 Prisma `createMany`는 `skipDuplicates`를 지원하지 않는다** → 링크 발견 시 기존 행 조회 후 신규만 `createMany` + 기존은 `updateMany`(임대 보유자만 쓰므로 경합 없음 — §9.3) ·
> **⑨ `rich-message-sealing.spec.ts` RM-8이 `EgressExitId.options.length === 6`을, RM-12가 적용 DB의 부분 인덱스 = 4를 단언한다**(197·263행) → 앞의 것은 의도된 변경(X-1), 뒤의 것은 **부분 유니크 인덱스를 새로 만들지 않아** 그대로 통과(§3.2) ·
> **⑩ 파기 잡은 호출 로그를 writer 1파일의 `deleteCallLogsBatch()`로만 지운다**(`governance-data.writer.ts` 71~94행 — No.41 `WorkflowRun` 종단 행 선례) · G-10은 `governance/**` 밖에서 writer·잡 임대 import를 막는다 → 실행 이력·적재 작업 파기는 **writer에 블록 2개 추가**, 크롤러의 임대는 **`kb-sync` 안의 동형 파일**(§3.4 · §9.2) ·
> **⑪ 외부 RAG의 `source`(청크 식별)는 업로드 파일 이름이다**(`API_RAG.md` 198·296행) · 우리 답변 출처 표시는 그 파일 이름을 그대로 보여 준다(`sanitize-sources.ts` 28~29행) → 결정적 파일 이름 `kb_<8>_<16>.<ext>`가 **답변 출처에 그대로 보인다**. 공개 대화 경로 변경 0(FR-0-206)을 지키기 위해 1차는 문서 첫 줄의 제목·원본 URL로 보완하고 이름 매핑은 2차(K-2) ·
> **⑫ `rag-gate.service.ts`의 `isVllmReady()`는 질의 게이트의 캐시·회로 상태와 한 몸이다**(69~81행) → 적재는 게이트를 주입하지 않고 `RagHttpClient.status()`를 직접 부르며 자체 60초 캐시를 둔다(질의 회로가 열려도 적재 판단이 흔들리지 않고, 적재가 질의 슬롯·회로를 건드리지 않는다 — FR-KB4-10).

---

## 1. PM 확정 사항 (2026-09-27 — P-1~P-12 전부 추천안)

| # | 확정 내용 | 이 문서에서의 반영 |
|---|---|---|
| **P-1 (a)** | 수집·변경 감지는 우리, 바뀐 것만 외부 RAG 적재 API로 전송 · 작업 상태 개별 조회 · ADR-0022 §5 부분 재개(적재·작업 개별 조회 2경로만) · 수동 업로드(No.48)·삭제·초기화·전역 설정·프롬프트는 계속 만들지 않음 | §5 · §15 |
| **P-2 (a)** | 사내 HTML + 사이트맵 + 링크된 PDF·DOCX·XLSX·PPTX · 인증 없음 또는 환경변수 참조 고정 헤더 | §6 · §7 |
| **P-3 (a)** | 자동 삭제 없음 · "정리 필요" 표시 · `rag-allowlist.spec` 삭제 경로 봉인 유지 | §8 · §15 |
| **P-4 (a)** | 첫 회만 미리보기 확인, 이후 자동 · 지식베이스는 No.40 환경 밖(즉시 반영) | §9.8 · §14 |
| P-5 | 전송 전제 게이트 `KB_INGEST_TRANSPORT_ACK`(내부망·인증·TLS 중 1) | §5.7 |
| P-6 | HTML 텍스트 마스킹 기본 · 원본 파일 전달 기본 꺼짐 | §10 |
| P-7 | api 서버에서 실행 | §2 |
| P-8 | 신규 권한 0 · `security:write` | §13 |
| P-9 | 알림은 No.41 2차 · 1차 콘솔 표시만 | §12 · §24 |
| P-10 | 깊이 3 · 500쪽 · 파일 20MB · 호스트당 1초 | §4 · §6.8 |
| P-11 | 요구사항 §9를 따른다 | §24 |
| P-12 | GPU 1 · 구축형 ○(전제 필요) · 구독형 △ | §22 |
| (architect) | ADR 번호 = **0044**(다음 빈 번호 — 가번호와 일치 확정) | R-1 |
| (architect) | 적재는 **RAG 출구 클래스 그대로**(`RAG_INGEST` 분리 안 함) — 데이터 종류 `DOCUMENT_BODY`는 데이터 지도 `kbSources` 절에서 소스 단위로 표시 | §5.1 · R-2 |
| (architect) | `file_path` 봉인 = 송신·`kb-sync` 0 + 응답 파서 2파일 고정 | KB-3 · R-3 |
| (architect) | HTML 변환 기본 형식 = **DOCX**(외부 RAG 지원 목록에 명시된 형식) — Q-1 확인 뒤 `KB_HTML_INGEST_FORMAT`으로 전환 | §5.5 · R-4 |
| (architect) | 소스 동시 실행 1 = 소스 행 CAS(`activeRunId`) · 전역 직렬 = 슬롯 임대 행 CAS(`KbJobLease`) → **부분 유니크 인덱스 추가 0** | §9.2 · §9.4 · R-6 · R-7 |
| (architect) | 크롤은 tick 예산 30초의 조각 실행 + DB 프런티어로 **이어서** 한다(처음부터 다시 아님) | §9.3 · R-5 |
| (architect) | 적재 대기열 등록 = **크롤 완료 후 일괄**(새로 비율·인증 벽 가드 판정 뒤) · 적재 시점 재수집 | §9.8 · R-9 · R-10 |
| (architect) | 대량 첫 적재 = **BULK 레인**(증분 뒤) + 선택 시간창 `KB_INGEST_BULK_WINDOW` | §9.7 · R-22 |
| (architect) | 문서 해석 = 작업 스레드 샌드박스 · `htmlparser2`·`fflate`·`pdfjs-dist`(평가 금지 옵션) | §7 · R-16 |
| (architect) | 공유 전송 부품 이동(ADR-0041 트리거 "세 번째 출구") = **발동 확인 · 이번엔 이동하지 않음**(별도 리팩터로 연기) | §6.3 · R-15 |
| (architect) | 기대값 변경 닫힌 목록 X-1~X-2 · 봉인 KB-1~KB-22 | §17.3 · §15 |

---

## 2. 아키텍처 배치

### 2.1 파일 구조 (신규 · 주요 수정)

```
packages/shared-types/src/
├── kb-sync.ts             # [신규] 소스·실행·문서·적재 작업 계약 · KB_SYNC_LIMITS · 상태/사유 enum · 메타·챗봇 카드 응답
├── governance.ts          # [수정] EgressExitId +KB_CRAWL · EgressDataKind +CRAWL_REQUEST·DOCUMENT_BODY · 지도 선택 키 egress.kbSources?
├── audit.ts               # [수정] AuditTargetType +KbSource(33 → 34) — AuditAction 추가 0
├── common.ts              # [수정] ApiErrorCode +3(KB_SOURCE_BUSY · KB_INGEST_NOT_ALLOWED · KB_HOST_NOT_ALLOWED)
└── index.ts               # [수정] export
apps/api/src/
├── kb-sync/                                  # ── 신규 모듈(export 0) ──
│   ├── kb-sync.module.ts                     # controllers [KbSourcesController, ChatbotKbStatusController] · exports []
│   ├── kb-sources.controller.ts              # /kb-sources — 12 핸들러
│   ├── chatbot-kb-status.controller.ts       # GET /chatbots/:chatbotId/kb-status — 1 핸들러
│   ├── kb-sources.service.ts                 # ★ KbSource 쓰기 유일 · 저장 검증 · 감사
│   ├── kb-runs.service.ts                    # 수동 실행·중지·적재 승인·이력/문서 조회(쓰기는 store 경유)
│   ├── kb-status.service.ts                  # 메타·챗봇 카드(읽기 전용)
│   ├── kb-source.mapper.ts
│   ├── core/
│   │   ├── kb-run.store.ts                   # ★ KbSyncRun·KbDocument·KbIngestJob·KbJobLease 쓰기 유일(상태 전이 = updateMany CAS)
│   │   └── ~~kb-job-lease.ts~~(만들지 않음 — 임대 CAS는 kb-run.store.ts에 통합 · §25 I-5)                   # 임대 CAS(GovernanceJobLease와 같은 형식 — governance import 0, G-10)
│   ├── engine/
│   │   ├── kb-sync.job.ts                    # PollingLoop 소비자 · tick() public · 예약 → 크롤 조각 → 적재 → 종결
│   │   ├── kb-scheduler.ts                   # 실행 시각이 된 소스 선점 → 실행 생성
│   │   ├── kb-crawl.runner.ts                # 크롤 조각(프런티어·범위·robots·속도·변경 감지)
│   │   └── kb-ingest.runner.ts               # 슬롯 임대·재수집·제출·작업 조회·재시도·종결
│   ├── crawl/
│   │   ├── kb-crawl-http.fetcher.ts          # ★ 출구 파일(KB_CRAWL) — checkEgress → DNS 1회 → 주소 판정 → transport.request
│   │   ├── kb-secret.resolver.ts             # ★ `KB_SECRET__<REF>` 읽기 유일
│   │   └── kb-host-pacer.ts                  # 호스트별 요청 간격(인스턴스 메모리)
│   ├── extract/
│   │   ├── kb-extractor.port.ts              # KB_EXTRACTOR 토큰 · 인터페이스(해석·해시·마스킹·변환)
│   │   ├── worker-thread.extractor.ts        # 운영 구현(작업 스레드 1개 · resourceLimits · 작업별 타임아웃 · 비정상 시 재생성)
│   │   ├── in-process.extractor.ts           # 시험 구현(같은 순수 함수를 직접 호출)
│   │   └── extract.worker.ts                 # 작업 스레드 진입점(lib 순수 함수만)
│   └── lib/                                  # 순수 — DB·Nest·네트워크·시계 무의존
│       ├── url-normalize.ts · scope-match.ts · glob-match.ts
│       ├── robots.ts · sitemap-parse.ts · redirect-policy.ts · link-extract.ts
│       ├── html-extract.ts · charset.ts · text-normalize.ts
│       ├── ooxml-text.ts · pdf-text.ts(★ pdfjs-dist import 유일) · docx-writer.ts · container-guard.ts
│       ├── content-fingerprint.ts · change-detect.ts · missing-detect.ts
│       ├── external-file-name.ts · ingest-document.ts
│       ├── schedule-next.ts · backoff.ts · ingest-lane.ts · eta.ts · run-guards.ts
│       ├── [구현 시 추가 — §25] build-run-view.ts(I-10·I-43) · preview-stale.ts · scope-warnings.ts(I-9) · url-scheme.ts(I-17) · gzip-guard.ts(I-20) · kb-rag-call-limiter.ts(I-18) · parse-source-row.ts · run-extract-job.ts(I-42) · config-change.ts(I-38 — pass 4) · throttle-delay.ts(I-51) · x-robots-tag.ts(I-58) · inspect-raw-file.ts(I-55 — pass 5) · push-in-chunks.ts(I-65) · path-canon.ts(I-71·I-72) · bounded-map.ts(I-70) · `crawl/kb-redirect-follow.ts`(I-66 — pass 6) · detect-kind.ts(I-78) · crawl-limits.ts(`HTML_MAX_BYTES` I-70⑥ · `MAX_HOST_INTERVAL_MS` I-75) · governance-flags.ts(I-86 — pass 7·8) · observed-hash.ts(I-89 — pass 9 · 인증 벽 지문 규칙) · allowed-origins.ts(I-104 — pass 12 · 허용 출처 host:port — 실행 시점 계산 · I-107 — pass 13 · 평문 `http:` 허용 출처 `computePlainHttpOrigins` · 인증 헤더 판정 `canSendAuthTo(origins: AuthOrigins, url, startUrl?)`)
│       ├── kb-log-line.ts
│       └── kb-sync-sealing.spec.ts           # §15 KB-1~KB-22
├── rag/rag-http.client.ts                    # [수정] ingest() · taskStatus() · send() 본문 인코딩 선택(JSON|MULTIPART) · 결과 retryAfterMs(§25 I-19)
├── common/lib/import-esm.ts                  # [신규 — §25 I-1] ESM 전용 패키지(pdfjs-dist) 동적 로더 · 인자가 상수인 new Function 1곳
├── rag/lib/rag-paths.ts                      # [수정] +INGEST · +TASK_STATUS(3 → 5)
├── rag/lib/{parse-ingest-response.ts, parse-task-status.ts, rag-task-id.ts, judge-ingest-result-text.ts, retry-after.ts(§25 I-19)}   # [신규·순수] 응답 판정 · UUID 검증
├── legacy-api/transport/{legacy-transport.port.ts, node-http.transport.ts}     # [수정] 선택 필드 redirectMode · captureHeaders
├── legacy-api/lib/ip-policy.ts               # [수정] parseAllowlist(raw, label?) — 기본값 = 현행 문구
├── common/egress/egress-registry.ts          # [수정] 7번째 클래스 KB_CRAWL · masked 타입 +'NOT_APPLICABLE'
├── governance/governance-map.service.ts      # [수정] exits[] 제외 +KB_CRAWL · egress.kbSources?(소스 ≥1)
├── governance/writer/governance-data.writer.ts # [수정] deleteCallLogsBatch +KbIngestJob·KbSyncRun(종단 행)
├── audit-logs/lib/audit-snapshot.ts          # [수정] AUDIT_FIELDS.KbSource
├── config/env.validation.ts                  # [수정] 선택 환경변수 16 · 교차 검사 1(ACK=TLS ⇒ RAG https)
└── app.module.ts                             # [수정] imports 끝 KbSyncModule
apps/api/jest.isolate-env.js                  # [수정] process.env.KB_SYNC_ENABLED = 'false'
apps/api/package.json                         # [수정] dependencies +htmlparser2(^9.1.0 고정 — §25 I-2) · +fflate(^0.8.3) · +pdfjs-dist(4.2.67)
pnpm-workspace.yaml                           # [수정] allowBuilds canvas: false — pdfjs-dist 선택 의존성의 네이티브 빌드 차단(§25 I-3)
apps/web/src/                                 # §12(ui-designer → frontend-implementer)
```

### 2.2 모듈 의존 방향

```
kb-sync   → rag(RagHttpClient — export 기존) · chatbots(ChatbotScopeService) · audit-logs · prisma · config
          + legacy-api 클래스 파일 import(NodeHttpTransport · NodeDnsResolver · ip-policy — 모듈 import 0, No.41 방식)
          + packages/pii-mask(maskPii)
governance → Prisma 읽기 kbSource·kbSyncRun(지도) · writer가 kbIngestJob·kbSyncRun deleteMany — kb-sync 모듈 import 0
공개 대화 · 엔진 · 위젯 · ml-worker → kb-sync 심볼 0(KB-18)
```

- `KbSyncModule`의 export는 **0개**다. 다른 모듈이 크롤러·적재기를 부를 경로가 없다.
- 전송·DNS 부품은 **세 번째 DI 토큰**(`KB_TRANSPORT`·`KB_DNS_RESOLVER`)으로 등록한다(`workflow.module.ts` 선례 — `LegacyApiModule` import 0). `LegacyApiHttpClient`·`ValidatedLegacyRequest`·레거시 시크릿 리졸버는 쓰지 않는다(KB-7).
- `RagHttpClient`는 `RagModule`이 이미 export한다 — `RagGateService`·`RagCallLogService`·`RagAnswerService`는 **주입하지 않는다**(KB-19).
- `AppModule` imports **끝**에 둔다. 루프는 `onApplicationBootstrap`에서 `KB_SYNC_ENABLED`일 때만 시작한다.

### 2.3 실행 흐름 (한 tick)

```
KbSyncJob.tick(signal)                                   ← PollingLoop(KB_SYNC_INTERVAL_MS, 기본 10초) · 예산 30초
 ① if (!KB_SYNC_ENABLED) return                          (루프 자체를 시작하지 않으므로 방어 이중화)
 ② 스케줄러: due 소스 조회 1쿼리(enabled ∧ nextRunAt ≤ now ∧ activeRunId = null)
            → 소스 행 CAS(activeRunId) → KbSyncRun(QUEUED) 생성 · 실행 종류 = 승인 여부로 PREVIEW|SYNC
 ③ 크롤 조각: CRAWLING|QUEUED 실행 중 임대 보유·만료분 ≤ KB_SYNC_MAX_PARALLEL_SOURCES
            → 조각(URL 1개씩 · 호스트 간격 · 예산 소진 또는 signal.stopping()까지) · URL마다 임대 갱신
            → 프런티어 소진 시 크롤 종결(삭제 감지 · 가드 · 적재 작업 일괄 생성 → INGESTING | SUCCEEDED)
 ④ 적재: 슬롯 임대 CAS → 보유 슬롯의 작업이 SUBMITTED면 조회(≥ KB_INGEST_POLL_MS) · 없으면 다음 PENDING 선택
            → 재수집 → 작업 스레드(해석·해시·마스킹·변환) → RagHttpClient.ingest() → task_id 저장
 ⑤ 종결: INGESTING 실행 중 남은 작업 0 → SUCCEEDED | PARTIAL (CAS) · 소스 lastRun·nextRunAt 갱신 · activeRunId 해제
```

- 유휴(소스 있음·할 일 없음) tick = **쿼리 2개**(② due 조회 · ③④ 활성 실행·작업 존재 확인 1개 — 둘 다 인덱스). 구현: 적재 조각의 반복 종료는 시각 추정이 아니라 `KbIngestRunner.runFragment()`의 boolean(이번 호출에서 실제 조회·제출을 했는가)으로 판정한다(§25 I-8). 구현 순서(pass 4): ② `KbSourcesService.claimAndCreateRun()`(선점 + 실행 생성 한 트랜잭션 — §25 I-39) · ④ = `sweepExpiredSubmittingJobs()` → `pollDue()`(슬롯 없이 조회 대상 1건 — 아무 인스턴스나) → `trySubmitOne()`(대기 작업 존재 확인 → vLLM 준비 → 슬롯 선점 → 제출) → `finalizeIngestingRuns()`.
- 한 tick은 네트워크 대기 외에 메인 스레드를 오래 잡지 않는다 — 해석·해시는 작업 스레드(§7.2).

### 2.4 엔진·위젯·ml-worker · 워크스페이스 영향

| 워크스페이스 | 변경 |
|---|---|
| `packages/dialogue-engine` | **0** |
| `packages/shared-types` | §4 |
| `packages/pii-mask` | **0**(기존 `maskPii(text, { mode })` 재사용) |
| `apps/api` | 신규 모듈 1(컨트롤러 2 · 핸들러 13) · 테이블 5 · 마이그레이션 1(`CREATE`만) · §2.5 |
| `apps/widget` | **0** |
| `apps/web` | §12 |
| `apps/ml-worker` | **0**(문서 임베딩 미도입 — ADR-0024 범위 불변) |

### 2.5 기존 코드 변경 목록 (구현자 체크리스트)

| 파일 | 변경 | 근거 |
|---|---|---|
| `prisma/schema.prisma` + 마이그레이션 `20260927150000_kb_crawling` | 모델 5개 신규(파일 끝) · 기존 모델 변경 0 | §3 |
| `packages/shared-types/src/{kb-sync(신규), governance, audit, common, index}.ts` | §4 | — |
| `rag/lib/rag-paths.ts` | `INGEST: '/api/documents/ingest'` · `TASK_STATUS: '/api/async_task_status/'` | §5.2 |
| `rag/rag-http.client.ts` | 공개 메서드 +2 · `send()` 본문 인코딩 인자 · `fetch(` 1곳 유지 · 헤더는 JSON일 때만 | §5.2 |
| `rag/lib/{parse-ingest-response, parse-task-status, rag-task-id}.ts` | 신규 순수 함수 | §5.6 |
| `legacy-api/transport/legacy-transport.port.ts` | 요청 선택 필드 `redirectMode?: 'FAIL'｜'REPORT'`·`captureHeaders?` · 결과 선택 필드 `headers?` — [pass 5] `captureHeaders` 닫힌 목록 +`'retry-after'`(6 → 7 · §25 I-59) | §6.3 |
| `legacy-api/transport/node-http.transport.ts` | `REPORT`면 3xx를 `RESPONSE`(본문 비움 + `location`)로 · 요청된 헤더만 소문자 키로 반환 · 기본 = 현행 · [pass 5] 캡처 값이 배열이면 `', '`로 합친다(이전 = 첫 값 · 현 닫힌 목록에서는 방어 코드 — §25 I-59) | §6.3 · §25 I-59(No.26 파일 — ADR-0034 갱신 각주) |
| `legacy-api/lib/ip-policy.ts` | `parseAllowlist(raw, label = 'LEGACY_API_PRIVATE_ALLOWLIST')` | 제약 ④ |
| `common/egress/egress-registry.ts` | `KB_CRAWL` 항목 · `masked` 타입 +`'NOT_APPLICABLE'`(응답 스키마 변경 0 — exits[] 제외 출구 전용) | §6.1 |
| `governance/governance-map.service.ts` | 제외 목록 +`KB_CRAWL` · `egress.kbSources?` 조립(소스 ≥1일 때만 — 쿼리 +2) | 제약 ⑤ · §3.4 |
| `governance/writer/governance-data.writer.ts` | `deleteCallLogsBatch()`에 `kbIngestJob`(종단)·`kbSyncRun`(종단) 블록 | §3.4 |
| `audit-logs/lib/audit-snapshot.ts` | `AUDIT_FIELDS.KbSource`(값 컬럼 화이트리스트 — 헤더 값 없음) | §13 |
| `config/env.validation.ts` | 선택 16종 · `ACK=TLS ∧ RAG_BASE_URL ∉ https:` → 기동 실패 | §3.5 · §5.7 |
| `apps/api/jest.isolate-env.js` | `process.env.KB_SYNC_ENABLED = 'false';` | FR-0-205 |
| `app.module.ts` | imports 끝 `KbSyncModule` | §2.2 |
| `apps/api/package.json` | `htmlparser2`(**^9.1.0 고정** — v12는 ESM 전용) · `fflate`(^0.8.3) · `pdfjs-dist`(**4.2.67** 정확 고정) | §7.1 · §25 I-2 |
| `pnpm-workspace.yaml` | `allowBuilds`에 `canvas: false`(`pdfjs-dist` 선택 의존성 `canvas`의 네이티브 빌드 스크립트 차단) | §25 I-3 |
| `common/lib/import-esm.ts`(신규) | ESM 전용 패키지 동적 로더 — `pdf-text.ts`만 사용 | §25 I-1 |
| `rag/lib/retry-after.ts`(신규) · `rag/rag-http.client.ts` · `rag/lib/parse-{ingest-response,task-status}.ts` | `RagSendResult.retryAfterMs`(429·503 `Retry-After` 해석값 · 상한 30분) | §25 I-19 · X-3 |
| `apps/web/src/components/AsyncJobProgress.tsx` | 선택 prop `live?: boolean`(기본 `true` = 현행) | §25 I-29 |
| `apps/web/src/*` | §12 | — |
| 시험 파일 | §17.3 X-1·X-2·X-3 + 신규 | FR-0-212 |

> **이 목록에 없는 파일은 바꾸지 않는다.** 특히 `conversation/**`(공개 대화 경로) · `rag/rag-answer.service.ts`·`rag-gate.service.ts`·`rag-call-log.service.ts` · `rag/lib/rag-allowlist.spec.ts`(금지 목록 불변 — 추가 금지어는 KB-2가 따로 단언) · `packages/dialogue-engine/**` · `apps/widget/**` · `apps/ml-worker/**` · `legacy-api/legacy-api-http.client.ts` · `workflow/**` · `governance/jobs/**`(잡 코드 불변 — writer 메서드만 확장) · `governance/governance-bootstrap.service.ts`(KB 출구는 DB 결정 출구라 기동 검사 대상 아님 — EX-KB-18).

### 2.6 커밋 분리 단위

| 커밋 | 범위 | 독립성 · 게이트 |
|---|---|---|
| **① 계약·순수 함수(관측 불변)** | shared-types 전부(§4) · `kb-sync/lib/*` 순수 함수 + 단위 시험 · `rag/lib` 파서 3종 + 픽스처 시험 · 웹 라벨 사전(`exitLabel.KB_CRAWL`·`dataKindLabel` 2·감사 대상 라벨 — 타입 망라 컴파일) | enum 1개 추가로 **X-1**(RM-8 6 → 7). 그 밖의 기존 시험 무수정 통과 |
| **② 전송·출구·RAG 클라이언트** | 전송 포트 선택 필드 2 · `ip-policy` 라벨 인자 · `RAG_PATHS` 5 · `RagHttpClient` 2메서드 · 레지스트리 `KB_CRAWL` + 지도 제외 · 출구 파일(fetcher)·시크릿 리졸버·작업 스레드 추출기 · 의존성 3 · 봉인 KB-1~KB-8·KB-16~KB-17 | 호출자(모듈)가 아직 없어 관측 변화 0. 기존 전송·RAG 시험 무수정 통과(선택 필드 기본값 = 현행) |
| **③ 저장·엔진·관리 API** | 마이그레이션 · 스키마 · `kb-sync` 모듈(store·임대·잡·스케줄러·크롤러·적재기·서비스·컨트롤러) · 환경변수 · `jest.isolate-env.js` · `AppModule` · writer 파기 블록 · 데이터 지도 `kbSources` · 감사 화이트리스트 · 나머지 봉인 | **X-2**(컨트롤러 46 → 48) |
| **④ 콘솔·운영 문서** | 웹 화면 전부(§12) · 통합 시험 보강 · `docs/05-ops` 설치 가이드 | 기대값 변경 0 |

---

## 3. 데이터 모델 · 마이그레이션

### 3.1 Prisma 변경안

```prisma
/// [신규 No.43] 지식베이스 수집 소스(전역 — 챗봇 소속 아님, ADR-0044 §1).
/// ★ 쓰기 = kb-sync/kb-sources.service.ts 1파일(KB-9) · 헤더 값 컬럼 없음(authSecretRef = 이름만).
model KbSource {
  id                    String       @id @default(uuid())
  name                  String
  /// normalizeText(name) — 전역 유일(ApiConnection 선례)
  nameNormalized        String       @unique
  /// JSON string[] — 정규화된 http(s) URL 1~10 / 0~5
  seedUrls              String       @default("[]")
  sitemapUrls           String       @default("[]")
  /// JSON string[] — 시작 주소·사이트맵에서 파생(저장 시 계산, 소문자 호스트[:포트])
  /// [pass 10 확인 — §25.6 RG-26] 구현은 **호스트 이름만** 저장한다(`deriveAllowedHosts()` = `URL.hostname` — 포트 없음) · 범위·허용 호스트 검사도 포트를 비교하지 않는다
  /// [pass 12 해소 — §25 I-104 · U-5 (b)] 저장 형식은 그대로(호스트 이름 — 호스트 겹침 판정·데이터 지도·저장 검증용) · 포트 구분은 `parseSourceRow()`가 실행 시점마다 `seedUrls`·`sitemapUrls`에서 계산하는 허용 출처 `allowedOrigins`(host[:port] · 저장 안 함)가 맡는다 · [pass 13 — §25 I-107] 인증 헤더용 평문 허용 출처 `plainHttpOrigins`(시작 주소·사이트맵 중 `http:`로 등록된 URL의 host[:port])도 같은 방식으로 실행 시점에 계산한다(저장 안 함 — §6.9)
  allowedHosts          String       @default("[]")
  /// JSON string[] — 경로 접두 0~20 · 제외 글롭 0~50 · 잡음 줄 글롭 0~20(정규식 아님 — R-13)
  pathPrefixes          String       @default("[]")
  excludePatterns       String       @default("[]")
  noisePatterns         String       @default("[]")
  allowQueryUrls        Boolean      @default(false)
  maxDepth              Int          @default(3)
  maxPages              Int          @default(500)
  /// JSON ('PDF'|'DOCX'|'XLSX'|'PPTX')[]
  fileTypes             String       @default("[]")
  maxFileBytes          Int          @default(20971520)
  minIntervalMs         Int          @default(1000)
  scopeCompany          String
  scopeCategory         String
  scopeSubcategory      String
  /// MANUAL | DAILY | WEEKLY (KST)
  scheduleKind          String       @default("MANUAL")
  scheduleTime          String?      /// "HH:mm"
  scheduleWeekday       Int?         /// 0(일)~6
  /// NONE | STATIC_HEADER
  authKind              String       @default("NONE")
  authHeaderName        String?
  /// ^[A-Z0-9]+(_[A-Z0-9]+)*$ — 값은 KB_SECRET__<REF> 환경변수(리졸버 1파일)
  authSecretRef         String?
  piiMask               Boolean      @default(true)
  allowRawFileIngest    Boolean      @default(false)
  rightsConfirmedById   String
  rightsConfirmedAt     DateTime
  /// 범위·스코프·개인정보 옵션이 바뀔 때마다 +1(§9.8) — 승인은 이 값에 묶인다
  configVersion         Int          @default(1)
  approvedConfigVersion Int?
  approvedAt            DateTime?
  approvedById          String?
  /// NEW_RATIO | AUTH_WALL — 자동 강등 사유(승인 해제와 함께 기록, 다음 승인 시 null)
  reviewRequiredReason  String?
  enabled               Boolean      @default(true)
  /// ★ 소스당 동시 실행 1 — CAS(activeRunId = null 조건부 갱신). FK 없음
  activeRunId           String?
  nextRunAt             DateTime?
  /// 표시 캐시(종결 CAS와 같은 트랜잭션에서만 갱신)
  lastRunId             String?
  lastRunStatus         String?
  lastRunFinishedAt     DateTime?
  createdById           String?
  updatedById           String?
  documents             KbDocument[]
  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt

  @@index([enabled, nextRunAt])
  @@index([updatedAt])
  @@map("kb_sources")
}

/// [신규 No.43] 소스의 URL 단위 상태 + 크롤 프런티어(ADR-0044 §3).
/// ★ 본문·파일 바이트 컬럼 없음(KB-10) · 쓰기 = kb-sync/core/kb-run.store.ts 1파일.
model KbDocument {
  id                        String    @id @default(uuid())
  sourceId                  String
  source                    KbSource  @relation(fields: [sourceId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// 정규화 URL(쿼리는 allowQueryUrls일 때만 · 프래그먼트 없음)
  url                       String
  /// sha256(url) hex 64
  urlHash                   String
  /// HTML | PDF | DOCX | XLSX | PPTX
  kind                      String
  /// kb_<source 8>_<urlHash 16>.<ext> — 결정적(§5.4)
  externalFileName          String
  /// ACTIVE | GONE | EXCLUDED
  state                     String    @default("ACTIVE")
  /// KbExcludeReason(EXCLUDED일 때)
  excludeReason             String?
  /// GONE | SHRUNK | ROBOTS_DISALLOWED | SCOPE_CHANGED | FORMAT_CHANGED — 외부 RAG에 옛 내용이 남은 경우만(lastIngestedAt ≠ null)
  cleanupReason             String?
  missingStreak             Int       @default(0)
  /// 마스킹 후 ≤200 — [pass 10 해소 — §25 I-93: 작업 스레드 `sanitizeTitle()` = 마스킹 뒤 코드 포인트 200자 절단 · `piiMask = false` 소스는 절단만]
  title                     String?
  /// ★ 아래 5개는 "마지막으로 외부 RAG에 성공 적재한 내용"과 짝이다(적재 성공 또는 해시 동일 확인 때만 갱신 — R-24)
  etag                      String?
  lastModified              String?
  contentHash               String?
  /// sha256(contentHash + 변환 규칙 버전 + 형식 + 마스킹 모드·여부) — 바뀌면 재적재(R-25)
  ingestFingerprint         String?
  textLength                Int?
  byteSize                  Int?
  lastIngestedAt            DateTime?
  lastIngestJobId           String?
  /// ★ 문서당 진행 중 적재 1건 — CAS(activeIngestJobId = null 조건부). FK 없음
  activeIngestJobId         String?
  consecutiveIngestFailures Int       @default(0)
  /// ── 크롤 프런티어(해당 실행 동안만 의미) ──
  seenRunId                 String?
  /// QUEUED | VISITED (seenRunId 실행 기준)
  visitState                String?
  depth                     Int       @default(0)
  discoveredSeq             Int       @default(0)
  /// [pass 6 · §25 I-63] 이 문서를 링크로 (그 실행에서 처음) 발견시킨 부모 문서 id — FK 없음 · 시작 주소·사이트맵 URL = null
  /// 부모가 304·오류·차단으로 링크를 다시 확인하지 못한 실행에서 자식을 이어 방문하는 데 쓴다(`carryChildren` — §8.3)
  discoveredFromId          String?
  /// NEW | CHANGED | UNCHANGED (seenRunId 실행의 관측 — 미리보기 목록 원천)
  observedChange            String?
  observedPiiMasked         Int?
  /// [pass 8 · §25 I-85] 이 실행이 이 행에서 관측한 수렴 지문(인증 벽 가드 입력 — §8.4) — HTML 정규화 본문 sha256 · 리다이렉트 원래 행 `R:`+최종 URL 해시 ·
  /// 범위 밖 리다이렉트 행 `X:`+목적지 호스트·경로 해시. 원문 아님 · `seedFrontier()` 재방문 때 null 초기화 · 파일·304·오류 행은 null
  /// [pass 9·11 갱신 — 현재 값 체계와 분자·분모 취급은 §25.7 표(`schema.prisma` 주석과 같음): 본문 해시(빈 본문 미기록) · `RL:`(쿼리 제거) · `R:` · `RD:`(pass 11 신설) · `X:`]
  observedHash              String?
  firstSeenAt               DateTime  @default(now())
  lastSeenAt                DateTime  @default(now())
  updatedAt                 DateTime  @updatedAt

  @@unique([sourceId, urlHash])
  @@index([sourceId, seenRunId, visitState, depth, discoveredSeq])
  @@index([sourceId, state])
  @@index([sourceId, cleanupReason])
  @@index([sourceId, discoveredFromId])   // [pass 6 · §25 I-63]
  @@map("kb_documents")
}

/// [신규 No.43] 동기화 실행 이력(로그 규약 — FK 없음 · 소스 이름 스냅샷 · CALL_LOGS 보존).
/// ★ 본문·URL 쿼리 컬럼 없음 · 쓰기 = kb-run.store.ts 1파일 + 파기 writer(deleteMany).
model KbSyncRun {
  id                String    @id @default(uuid())
  sourceId          String
  sourceName        String
  /// PREVIEW | SYNC | FULL_RESEND
  kind              String
  /// SCHEDULED | MANUAL | APPROVAL
  trigger           String
  /// QUEUED | CRAWLING | INGESTING | SUCCEEDED | PARTIAL | FAILED | CANCELLED (INTERRUPTED는 조회 시점 판정 — R-8)
  status            String
  configVersion     Int
  /// 크롤 임대(크롤 단계에만 의미)
  claimToken        String?
  claimedAt         DateTime?
  resumedCount      Int       @default(0)
  /// JSON KbRunCrawlCounts(§4) — 적재 수치는 KbIngestJob groupBy로 파생
  counts            String    @default("{}")
  maxPagesReached   Boolean   @default(false)
  /// JSON string[] — robots·5xx로 이번 실행 수집을 중단한 호스트(삭제 감지 제외 근거)
  abortedHosts      String    @default("[]")
  /// NEW_RATIO | AUTH_WALL
  demotedReason     String?
  /// KbRunFailureCode(코드만)
  failureCode       String?
  cancelRequestedAt DateTime?
  createdById       String?
  cancelledById     String?
  startedAt         DateTime?
  crawlFinishedAt   DateTime?
  finishedAt        DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([sourceId, createdAt])
  @@index([status, claimedAt])
  @@index([createdAt])
  @@map("kb_sync_runs")
}

/// [신규 No.43] 문서별 적재 작업(대기열 겸 기록 — FK 없음 · CALL_LOGS 보존).
/// ★ 본문 컬럼 없음 · RagCallLog에 쓰지 않는다(FR-KB4-11) · 쓰기 = kb-run.store.ts 1파일 + 파기 writer.
model KbIngestJob {
  id                  String    @id @default(uuid())
  runId               String
  sourceId            String
  documentId          String
  /// INCREMENTAL | BULK
  lane                String
  /// NEW | CHANGED | FULL_RESEND
  reason              String
  /// PENDING | SUBMITTING | SUBMITTED | SUCCEEDED | FAILED | UNKNOWN | TIMEOUT | CANCELLED | SKIPPED
  status              String    @default("PENDING")
  attemptCount        Int       @default(0)
  nextAttemptAt       DateTime?
  notFoundResubmitted Boolean   @default(false)
  /// 슬롯 임대 토큰(SUBMITTING·SUBMITTED 동안)
  slotToken           String?
  /// UUID 검증을 통과한 값만(KB-5)
  taskId              String?
  submittedAt         DateTime?
  lastPolledAt        DateTime?
  completedAt         DateTime?
  fileKind            String?
  externalFileName    String?
  contentHash         String?
  ingestFingerprint   String?
  textLength          Int?
  byteSize            Int?
  piiMaskedCount      Int?
  /// KbIngestResultCode(코드만 — 외부 오류 원문 저장 금지)
  resultCode          String?
  httpStatus          Int?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  @@index([status, lane, nextAttemptAt, createdAt])
  @@index([runId, status])
  @@index([documentId, status])
  @@index([createdAt])
  @@map("kb_ingest_jobs")
}

/// [신규 No.43] 지식베이스 잡 임대 행 — INGEST_SLOT_0..2 · INGEST_STATUS(GovernanceJobState와 같은 형식, 별도 테이블 — G-10).
model KbJobLease {
  name        String    @id
  claimToken  String?
  claimedAt   DateTime?
  holderJobId String?
  /// JSON — INGEST_STATUS: { checkedAt, vllmReady } (본문 0)
  state       String    @default("{}")
  updatedAt   DateTime  @updatedAt

  @@map("kb_job_leases")
}
```

- **관계는 `KbDocument → KbSource`(`Restrict`) 1개뿐**이다. 실행·작업은 로그 규약(FK 없음 · 이름 스냅샷)이라 소스를 지워도 이력이 남는다(`WorkflowRun` 선례 — R-29). 챗봇 FK 0 → **영구삭제 사전검사·동반 삭제 목록 불변**.
- JSON 배열 컬럼은 기존 규약(`String` + 매퍼 파싱 · 실패 시 빈 배열 + 경고)을 따른다.

### 3.2 마이그레이션 (3개 — `20260927150000_kb_crawling` · [pass 6] `20260928100000_kb_document_parent` · [pass 8] `20260928120000_kb_document_observed_hash`)

- **`CREATE TABLE` 5개 + `CREATE INDEX`/`CREATE UNIQUE INDEX`만.** 기존 테이블 재정의·`ALTER`·`DROP`·`WHERE`(부분 인덱스) 0 · 백필 0 · 기존 행 값 변경 0.
- **수기 작성**(선행 그룹 규약): `prisma migrate dev`가 만든 diff가 원시 부분 유니크 4종(`test_runs_chatbotId_active_key` · `deploy_schedules_chatbotId_scheduledAt_active_key` · `deploy_schedules_chatbotId_running_key` · `handoff_sessions_active_key`)을 지우는 구문을 끼우지 않았는지 확인한다. 적용 후 `SELECT count(*) FROM sqlite_master WHERE type='index' AND sql LIKE '%WHERE%'` = **4**(RM-12 그대로 통과 · KB-14).
- **부분 유니크 인덱스를 새로 만들지 않는 이유**(R-6 · R-7): "소스당 실행 1"은 소스 행의 `activeRunId` 조건부 갱신(영향 행 수 1)으로, "전역 직렬"은 슬롯 행 CAS로 이미 DB가 원자적으로 판정한다(`GovernanceJobLease`·No.28 선점과 같은 형식). 부분 인덱스를 더하면 RM-12(=4)가 깨지고 Postgres 전환 시 원시 DDL이 늘어난다.
- **배포·롤백**: ①② 커밋은 테이블을 쓰지 않는다. ③ 롤백 = 코드만 되돌리면 새 테이블은 참조 0(방치 가능) — 테이블 삭제는 선택.
- **[pass 6 — §25 I-63] 두 번째 마이그레이션 `20260928100000_kb_document_parent`**: `ALTER TABLE "kb_documents" ADD COLUMN "discoveredFromId" TEXT`(nullable · 기본값 없음) + `CREATE INDEX "kb_documents_sourceId_discoveredFromId_idx"` 1개. 위 첫 마이그레이션의 원칙("`ALTER` 0")에서 벗어나는 유일한 변경이다 — 기존 테이블 재정의·`DROP`·`WHERE`·`UPDATE` 0 · 기존 행 값 null(백필 0) · 원시 부분 유니크 4 보존(RM-12·KB-14 통합 검사 유지). SQLite의 nullable `ADD COLUMN`은 테이블 재작성 없이 적용된다. 롤백 = 코드만 되돌리면 컬럼·인덱스는 참조 0(방치 가능). 기존 행 null의 영향은 §20 K-16(미배포 기능이라 운영 데이터 이행 불요 · 개발·시연 DB 안내는 §25.4). 정적 봉인 KB-14는 첫 파일만 검사한다(보강 제안 — §25.4 RG-22⑤). 인증 벽 가드 재작업(§25.4 RG-21)을 권장안대로 하면 nullable 컬럼 1개짜리 마이그레이션이 하나 더 붙는다(→ pass 8에서 아래 세 번째 마이그레이션으로 반영).
- **[pass 8 — §25 I-85] 세 번째 마이그레이션 `20260928120000_kb_document_observed_hash`**: `ALTER TABLE "kb_documents" ADD COLUMN "observedHash" TEXT` 1문장(nullable · 기본값 없음 · 인덱스 없음 — 종결 때 `(sourceId, seenRunId)` 범위 안에서만 `count`·`groupBy`하므로 기존 프런티어 인덱스로 충분). 백필 0 · 기존 행 null — **null은 "이번 실행에서 관측하지 않음"과 같은 뜻이라 호환 문제가 없다**(값은 매 실행 `seedFrontier()`가 비우고 방문이 다시 채운다 · 도입 전 실행의 종결은 이미 끝났다). 테이블 재정의·`DROP`·`UPDATE`·`WHERE` 0 · 원시 부분 유니크 4 보존. 롤백 = 코드만 되돌림(컬럼 방치 가능). 두 번째 마이그레이션에 합치지 않은 이유는 이미 적용한 개발 DB의 체크섬 불일치(§25.4 RG-21 권장대로). 두 번째 이후 KB 마이그레이션은 정적 봉인 **KB-14b**(§15)가 검사한다.
- **`KbJobLease` 행 보장**: 부트스트랩이 `INGEST_SLOT_0..(KB_INGEST_CONCURRENCY−1)`·`INGEST_STATUS`를 create-if-absent(P2002 무시 — `GovernanceJobLease.ensureRow` 선례). 동시성 값을 줄이면 남는 슬롯 행은 선택 대상에서 빠진다(이름 인덱스 < N만 선점).

### 3.3 상태 기계

**실행(`KbSyncRun.status`)**

| 현재 | 사건 | 다음 |
|---|---|---|
| QUEUED | 크롤 임대 선점 | CRAWLING |
| CRAWLING | 프런티어 소진 · 적재 작업 1+건 생성 | INGESTING |
| CRAWLING | 프런티어 소진 · 적재 0(PREVIEW · 변경 없음 · 강등) | SUCCEEDED |
| CRAWLING | 시작 주소 전부 접속 실패 · 모든 허용 호스트의 robots 5xx · 출구 차단 · 비밀 없음 | FAILED(`failureCode`) — **구현(§25 I-46·I-49)**: `SECRET_MISSING`(크롤 시작 전) · [pass 5] 크롤 종결 시 시작 주소 미도달이면 삭제 감지·강등·적재를 건너뛰고 `ALL_SEEDS_UNREACHABLE`(허용 호스트 전부가 robots 불가 중단이면 `ROBOTS_UNREACHABLE` — PREVIEW도 같음) · 적재 전제 없음(`INGEST_NOT_ACKNOWLEDGED`·`RAG_NOT_CONFIGURED` — SYNC·FULL_RESEND). `EGRESS_BLOCKED`·`HOST_NOT_ALLOWED`는 미구현(§25.1 RG-2) |
| INGESTING | 남은 작업 0 · 실패/불명/시간초과 0 | SUCCEEDED |
| INGESTING | 남은 작업 0 · 1건 이상 실패/불명/시간초과 | PARTIAL |
| QUEUED·CRAWLING·INGESTING | 중지 요청 · 소스 일시중지 | CANCELLED — [pass 5 · §25 I-49·I-52·I-56] `failureCode` = `CANCELLED_BY_USER`(관리자 중지) · `SOURCE_DISABLED`(소스 일시중지) · 중지·작업 정리·소스 선점 해제는 한 트랜잭션(`cancelRunAndRelease`) · 크롤 조각은 다음 URL 경계에서 임대 갱신 실패로 멈춘다(진행 중 요청 1개만 마무리). 잔여: 크롤 종결 직전 경합 — §25.2 RG-19 **[pass 6 해소 — §25 I-69: 종결 CAS에 지면 종단 실행의 PENDING 작업 정리 · 제출 전 실행 상태 게이트 · 소스 일시중지로 멈춘 작업 `resultCode` = `CONFIG_CHANGED`(I-70)]** · [pass 8 — §25 I-86] 적재 제출 직전 거버넌스 차단(INGESTING — 모드를 켜기 전에 저장된 마스킹 끔·원본 파일 전달 소스) = CANCELLED + `failureCode` `GOVERNANCE_MASK_REQUIRED`·`GOVERNANCE_RAW_FILE_NOT_ALLOWED`(같은 `cancelRunAndRelease` — 대기 작업 `CONFIG_CHANGED` · SUBMITTED는 UNKNOWN) |
| CRAWLING(임대 만료) | 조회 | **표시 = INTERRUPTED**(저장 안 함) → 다음 tick에 다른 인스턴스가 선점하며 `resumedCount+1` |

**적재 작업(`KbIngestJob.status`)**

| 현재 | 사건 | 다음 |
|---|---|---|
| PENDING | 슬롯 선점 · 재수집 성공 · 변환 완료 | SUBMITTING(슬롯 토큰 기록) |
| PENDING | 재수집 결과 404·410·범위 밖·noindex·해시 동일(이미 반영) | SKIPPED(`resultCode`) |
| SUBMITTING | [구현 — §25 I-35] 재수집 실패(네트워크 `NETWORK_ERROR` · 404·410 외 비2xx `UPSTREAM_ERROR`) | PENDING(제출 실패와 같은 백오프 1·5·30분) → 3회 소진 시 FAILED — 구현은 선점(SUBMITTING)이 재수집보다 먼저라 위 SKIPPED도 SUBMITTING에서 전이한다 · [pass 5 · §25 I-58] 재수집 HTML의 메타 `noindex`·`X-Robots-Tag` noindex → SKIPPED(`EXCLUDED_AT_INGEST`) · 원본 파일 재검사(`FILE_UNSAFE`·`FILE_ENCRYPTED`·거버넌스 ON 개인정보 ≥1) → SKIPPED(`EXCLUDED_AT_INGEST`)(I-55) · "범위 밖" 재검사는 두지 않는다(범위 변경 = `CONFIG_CHANGED` 취소) · [pass 6 — §25 I-66] 재수집도 공용 헬퍼로 리다이렉트를 따른다(범위 밖·하향·4번째 홉·순환·응답 상한 초과 → SKIPPED(`EXCLUDED_AT_INGEST`)) · [pass 6 — I-64] `FULL_RESEND` 작업은 해시 동일 건너뛰기(`UNCHANGED_AT_INGEST`)를 적용하지 않는다 |
| SUBMITTING | `async_started` + UUID `task_id` | SUBMITTED |
| SUBMITTING | 동기 응답 `{result: "…성공."}` | SUCCEEDED |
| SUBMITTING | 400(필수값) | FAILED(재시도 0) |
| SUBMITTING | 429·503·500·네트워크·"…실패." | PENDING(`attemptCount+1` · 백오프) → 3회 초과 시 FAILED |
| SUBMITTING(임대 만료 — 응답 저장 전 인스턴스 종료) | 다른 인스턴스 조회 | PENDING(재전송 — 같은 파일 이름 덮어쓰기라 중복 적재 0) — **구현 정정(§25 I-15)**: `externalFileName`이 비었을 때(전송 전 중단 확실)만 PENDING(시도 수 순증 0) · 채워져 있으면 재전송하지 않고 UNKNOWN · 멈춤 판정에 슬롯 토큰 불일치 포함 |
| SUBMITTED | `completed` ∧ `result` 성공 접미 | SUCCEEDED(문서 해시·검증자 갱신) |
| SUBMITTED | `completed` ∧ 실패 접미 · `failed` · `cancelled` | PENDING(백오프) 또는 FAILED |
| SUBMITTED | [구현 — §25 I-34] 조회 자체 실패(네트워크·5xx·429 = `POLL_AGAIN`) | SUBMITTED 유지(재조회 · 재전송 0) — 429는 다음 조회를 max(`KB_INGEST_POLL_MS`×2, `Retry-After`) 뒤로 |
| SUBMITTED | `not_found` · `notFoundResubmitted = false` | PENDING(`notFoundResubmitted = true` · 즉시) |
| SUBMITTED | `not_found` · 이미 1회 재전송 | FAILED(`TASK_LOST`) |
| SUBMITTED | 제출 후 3시간 경과 | TIMEOUT(외부에서 계속될 수 있음) |
| PENDING·SUBMITTING·SUBMITTED | 실행 중지 · 설정 변경(`configVersion` 불일치) | CANCELLED(SUBMITTED는 `UNKNOWN`으로 — 외부 취소 호출 0) — 구현(§25 I-44): 중지는 PENDING → CANCELLED · SUBMITTED → UNKNOWN(슬롯 해제) · SUBMITTING은 진행 중 제출 1건을 끝내게 둔다 · 설정 변경 취소(`CONFIG_CHANGED`)는 제출 직전 PENDING만 · 모두 문서 연속 실패 수 불변 |

- 모든 전이는 `kb-run.store.ts`의 `updateMany({ where: { id, status: 기대값, slotToken?: 기대값 }, data })` + 영향 행 수 1 확인(CAS)이다. 원시 SQL 0.

### 3.4 거버넌스 편입 (보존 · 암호화 · 데이터 지도)

| 항목 | 결정 | 근거 |
|---|---|---|
| **보존** | `KbSyncRun`·`KbIngestJob`의 **종단 행**(SUCCEEDED·PARTIAL·FAILED·CANCELLED / SUCCEEDED·FAILED·UNKNOWN·TIMEOUT·CANCELLED·SKIPPED)을 `CALL_LOGS` 보존 기간 경과 시 **행 삭제** — writer `deleteCallLogsBatch()`에 블록 2개(작업 먼저, 실행 다음 · 배치 크기 공유). 보존 종류 신설 0 · 라벨 불변 | FR-KB5-8 · No.41 `WorkflowRun` 선례 · 제약 ⑩ |
| | `KbDocument`는 보존 대상이 아니다 — 변경 감지의 기준이며 소스 수명과 같다(소스 삭제 시 삭제) | FR-KB5-8 |
| **암호화** | **대상 추가 0**(`EncryptedFieldId` 6 불변). 저장되는 텍스트는 설정값(URL·경로·스코프)·마스킹된 제목·코드뿐 — 개인 텍스트 0. 쿼리 있는 URL은 기본 수집 제외(`allowQueryUrls=false`)이고, 켜도 API 응답·로그에는 경로까지만 싣는다 | FR-0-210 · §10 |
| **데이터 지도** | `egress.exits[]`에서 `KB_CRAWL` 제외(DB 결정 출구 — 레거시·웹훅 선례) · 소스 ≥1이면 선택 키(구현: 응답 **최상위** `kbSources` — `egress` 아래가 아니다 · 이 문서의 `egress.kbSources` 표기는 모두 같은 뜻 · §25 I-26) `egress.kbSources?: [{ sourceId, name, hosts[], enabled, decision, piiMask, allowRawFileIngest, ingestDataKind: 'DOCUMENT_BODY', scopeCompany, ingestAck }]`(0개면 키 생략 = 바이트 동일) | FR-KB6-6 · 제약 ⑤⑥ |
| **레지던시** | 크롤 결과는 DB·디스크에 원문으로 남지 않고 외부 RAG로만 간다 — `storage` 절 불변 | FR-0-210 |
| **출구 게이트** | 크롤 요청 = `checkEgress('KB_CRAWL', url)`(리다이렉트 매 단계) · 적재 = 기존 `assertEgressAllowed('RAG', url)`(같은 `send()`) · 모드 OFF = 파싱 없이 통과 | FR-KB6-4 |
| **완화 환경변수** | `KB_CRAWL_PRIVATE_ALLOWLIST` · `KB_ALLOW_RAW_FILE_INGEST`(콘솔로 켤 수 없음) + 전송 전제 선언 `KB_INGEST_TRANSPORT_ACK` | FR-0-211 · No.45 규약 |

### 3.5 seed · 환경변수

- **seed 변경 0** — 데모 소스를 만들지 않는다(실제 외부 수집·적재 방지 — No.41 선례).
- **신규 선택 환경변수 16종 + 비밀 접두 규약 1**(전부 기본값 · 기동 조건 아님 · boolean은 `envBoolean()`):

| 변수 | 기본 | 범위/형식 | 용도 |
|---|---|---|---|
| `KB_SYNC_ENABLED` | `false` | envBoolean | 기능 전체 스위치(루프·관리 API — 꺼지면 API `404`) |
| `KB_SYNC_INTERVAL_MS` | `10000` | 5,000~60,000 | 루프 주기(R-11) |
| `KB_SYNC_LEASE_MS` | `600000` | **≥300,000**([pass 6 — §25 I-73 · 이전 ≥60,000] 미만이면 기동 실패) | 크롤·슬롯 임대(크롤 = URL마다 · 적재 슬롯 = 재수집·해석·전송 구간 앞마다 갱신) |
| `KB_SYNC_MAX_PARALLEL_SOURCES` | `2` | 1~5 | 크롤 단계 동시 소스 수 |
| `KB_CRAWL_PRIVATE_ALLOWLIST` | `''` | CIDR·정확한 호스트 쉼표 | 사설 대역 허용(완화 — 레거시·웹훅 목록과 분리) |
| `KB_CRAWL_MAX_PAGES_CAP` | `5000` | 1~20,000 | 소스 `maxPages` 서버 상한 |
| `KB_CRAWL_MAX_FILE_BYTES` | `20971520` | 1MB~100MB | 소스 `maxFileBytes` 서버 상한 |
| `KB_CRAWL_USER_AGENT` | `ChatBotKBCrawler/1.0` | 1~200자 | 식별 UA(연락처 덧붙이기 권장) |
| `KB_CRAWL_TIMEOUT_MS` | `15000` | 3,000~60,000 | HTML·robots·사이트맵 요청(파일 = ×4 — [pass 7 정정 · §25 I-78] 상한 없음: 기본 15초면 60초, 최대값 60,000이면 240초 · 크롤·적재 공통 · 이 값은 아래 `KB_SYNC_LEASE_MS` 교차 검사에 들어간다) |
| `KB_INGEST_TRANSPORT_ACK` | (없음) | `INTERNAL_NETWORK｜AUTHENTICATED｜TLS` | 없으면 적재 불가(§5.7) |
| `KB_ALLOW_RAW_FILE_INGEST` | `false` | envBoolean | 거버넌스 ON에서 원본 파일 전달 허용(완화) |
| `KB_INGEST_CONCURRENCY` | `1` | 1~3 | 동시 외부 적재 작업 수 |
| `KB_INGEST_POLL_MS` | `10000` | ≥10,000 | 작업 조회 간격 하한 |
| `KB_RAG_CALLS_PER_MIN` | `30` | 1~100 | 적재·조회·상태 호출 합계(인스턴스 버킷) |
| `KB_HTML_INGEST_FORMAT` | `DOCX` | `DOCX｜TXT｜HTML` | HTML 변환 형식(§5.5 — Q-1 확인 전 DOCX) |
| `KB_INGEST_BULK_WINDOW` | `''` | `HH:MM-HH:MM`(KST) 또는 빈 값 | BULK 레인 허용 시간창(빈 값 = 항상) |
| `KB_SECRET__<REF>` | — | 스키마 밖 | 고정 헤더 값(리졸버 1파일 — KB-11) |

- 교차 검사(`validate()`): `KB_INGEST_TRANSPORT_ACK=TLS`인데 `RAG_BASE_URL`이 `https:`가 아니면 **기동 실패**(FR-KB6-1). `KB_SYNC_ENABLED=true`인데 `RAG_BASE_URL` 미설정이면 **경고만**(미리보기는 가능). **[pass 7 — §25 I-83 · N-10]** `KB_SYNC_LEASE_MS ≥ KB_CRAWL_TIMEOUT_MS × 4 + 120,000` — 미만이면 **기동 실패**(임대를 갱신하지 못하는 가장 긴 구간 = 문서 파일 요청 1개 + 해석·전송 여유). 기본값(15초 · 600초 → 필요 180초)과 임대 최소 300초는 불변이라 기본 설치는 영향이 없고, `KB_CRAWL_TIMEOUT_MS`를 45초 넘게 올린 설치만 임대도 함께 올려야 한다(60초면 360,000 이상 — `docs/05-ops/자동배포.md` §5.7).

---

## 4. shared-types 계약 (`packages/shared-types/src/kb-sync.ts`)

```ts
export const KB_SYNC_LIMITS = {
  maxSources: 50, nameMax: 100, seedUrls: 10, sitemapUrls: 5, pathPrefixes: 20,
  excludePatterns: 50, noisePatterns: 20, patternMax: 200, maxDepth: 5, defaultDepth: 3,
  defaultMaxPages: 500, defaultMaxFileBytes: 20 * 1024 * 1024, minIntervalMs: 500, defaultIntervalMs: 1000,
  scopeMax: 200, headerNameMax: 64,
} as const;

export const KbFileType = z.enum(['PDF', 'DOCX', 'XLSX', 'PPTX']);
export const KbScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('MANUAL') }),
  z.object({ kind: z.literal('DAILY'), time: HhMm }),
  z.object({ kind: z.literal('WEEKLY'), weekday: z.number().int().min(0).max(6), time: HhMm }),
]);
export const KbAuthSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NONE') }),
  z.object({ kind: z.literal('STATIC_HEADER'), headerName: HeaderName, secretRef: SecretRef }), // 값 필드 없음
]);
export const KbSourceCreateSchema = z.object({
  name, seedUrls, sitemapUrls, pathPrefixes, excludePatterns, noisePatterns, allowQueryUrls,
  maxDepth, maxPages, fileTypes, maxFileBytes, minIntervalMs,
  scope: z.object({ company, category, subcategory }),          // 3개 모두 필수(외부 규약)
  schedule: KbScheduleSchema, auth: KbAuthSchema,
  piiMask: z.boolean(), allowRawFileIngest: z.boolean(),
  rightsConfirmed: z.literal(true),                             // FR-KB1-7 — false/누락 = 400
});
export const KbSourceUpdateSchema = KbSourceCreateSchema.omit({ rightsConfirmed: true }).partial()
  .extend({ enabled: z.boolean().optional() });

export const KbRunKind = z.enum(['PREVIEW', 'SYNC', 'FULL_RESEND']);
export const KbRunTrigger = z.enum(['SCHEDULED', 'MANUAL', 'APPROVAL']);
export const KbRunStatus = z.enum(['QUEUED', 'CRAWLING', 'INGESTING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED']);
export const KbRunDisplayStatus = z.enum([...KbRunStatus.options, 'INTERRUPTED']);          // 응답 전용(R-8)
export const KbRunFailureCode = z.enum(['ALL_SEEDS_UNREACHABLE', 'ROBOTS_UNREACHABLE', 'EGRESS_BLOCKED',
  'HOST_NOT_ALLOWED', 'SECRET_MISSING', 'RAG_NOT_CONFIGURED', 'INGEST_NOT_ACKNOWLEDGED', 'CANCELLED_BY_USER',
  'SOURCE_DISABLED', 'CONFIG_CHANGED',
  'GOVERNANCE_MASK_REQUIRED', 'GOVERNANCE_RAW_FILE_NOT_ALLOWED']);   // [pass 8 — §25 I-86 · PM 결정 2026-09-28] 뒤의 2개 = 거버넌스 ON에서 규칙에 걸리는 소스의 적재를 제출 직전에 막아 끝낸 실행(CANCELLED) — 저장 검증 details[].message와 같은 이름 · [구현 — §25 I-46·I-49] 서버가 쓰는 값 = SECRET_MISSING · INGEST_NOT_ACKNOWLEDGED · RAG_NOT_CONFIGURED · (pass 5) ALL_SEEDS_UNREACHABLE · ROBOTS_UNREACHABLE · CANCELLED_BY_USER · SOURCE_DISABLED(CANCELLED 실행에도 붙는다). EGRESS_BLOCKED · HOST_NOT_ALLOWED · CONFIG_CHANGED는 예약(콘솔 라벨만 — RG-2)
export const KbDemotionReason = z.enum(['NEW_RATIO', 'AUTH_WALL']);
export const KbDocumentState = z.enum(['ACTIVE', 'GONE', 'EXCLUDED']);
export const KbExcludeReason = z.enum(['ROBOTS', 'TYPE', 'SIZE', 'REDIRECT_OUT_OF_SCOPE', 'NO_BODY', 'NOINDEX',
  'RAW_FILE_OFF', 'ENCODING', 'PII_IN_RAW_FILE', 'FILE_UNSAFE', 'FILE_ENCRYPTED', 'AUTH_WALL']);
export const KbCleanupReason = z.enum(['GONE', 'SHRUNK', 'ROBOTS_DISALLOWED', 'SCOPE_CHANGED', 'FORMAT_CHANGED']);
export const KbIngestLane = z.enum(['INCREMENTAL', 'BULK']);
export const KbIngestJobStatus = z.enum(['PENDING', 'SUBMITTING', 'SUBMITTED', 'SUCCEEDED', 'FAILED',
  'UNKNOWN', 'TIMEOUT', 'CANCELLED', 'SKIPPED']);
export const KbIngestResultCode = z.enum(['OK', 'RAG_REPORTED_FAILURE', 'TASK_FAILED', 'TASK_CANCELLED', 'TASK_LOST',
  'HTTP_400', 'RATE_LIMITED', 'OVERLOADED', 'UPSTREAM_ERROR', 'NETWORK_ERROR', 'INVALID_TASK_ID',
  'GONE_AT_INGEST', 'EXCLUDED_AT_INGEST', 'UNCHANGED_AT_INGEST', 'WAIT_TIMEOUT', 'CANCELLED_BY_USER', 'CONFIG_CHANGED']);

export const KbRunCrawlCountsSchema = z.object({   // [구현 — §25 I-40] 종결 시 DB 재집계 · 진행 중(저장값 {})은 응답에서 0으로 채움
  discovered, visited, unchanged, added, changed, missing, gone, needsCleanup, piiMasked,
  excluded: z.record(KbExcludeReason, z.number().int()).partial(), outOfScopeLinks,
});
export const KbRunIngestCountsSchema = z.object({ total, pending, inFlight, succeeded, failed, unknown, timeout, cancelled, skipped });
export const KbRunViewSchema = z.object({
  id, sourceId, sourceName, kind: KbRunKind, trigger: KbRunTrigger, status: KbRunDisplayStatus,
  crawl: KbRunCrawlCountsSchema, ingest: KbRunIngestCountsSchema.nullable(),
  progress: z.object({ done: z.number().int(), total: z.number().int() }).nullable(),   // 우리 기록 기준(외부 progress 미사용)
  etaSeconds: z.number().int().nullable(), waitingReason: z.enum(['RAG_NOT_READY', 'BULK_WINDOW', 'RATE_LIMIT']).nullable(),   // [구현 — §25 I-43] 서버는 RAG_NOT_READY·BULK_WINDOW만 낸다(RATE_LIMIT 미구현 — RG-14)
  maxPagesReached, demotedReason: KbDemotionReason.nullable(), failureCode: KbRunFailureCode.nullable(),
  resumedCount, startedAt, crawlFinishedAt, finishedAt, createdAt,
});
export const KbSourceResponseSchema = /* 입력 필드 + */ z.object({
  id, allowedHosts, configVersion, ingestApproved: z.boolean(), needsPreview: z.boolean(),
  reviewRequiredReason: KbDemotionReason.nullable(), activeRun: KbRunViewSchema.nullable(),
  lastRun: /* id·status·finishedAt */, nextRunAt, needsCleanupCount, repeatedFailureCount, rightsConfirmedAt, createdAt, updatedAt,
  activeDocumentCount, previewStale: z.boolean(), warnings: z.array(KbScopeWarningSchema).optional(),   // [구현 추가 — §25 I-9] warnings는 저장(등록·수정) 응답에만
});
export const KbDocumentViewSchema = z.object({
  id, displayUrl /* 호스트+경로(쿼리 있으면 "?…" 표식만) */, kind, state, excludeReason, cleanupReason,
  observedChange, title, lastIngestedAt, lastSeenAt, consecutiveIngestFailures, externalFileName,
});
export const KbRunCreateSchema = z.object({ kind: KbRunKind, acknowledgeCleanup: z.boolean().optional() });
export const KbApproveIngestSchema = z.object({ previewRunId: z.string().uuid() });
export const KbDocumentListQuerySchema = PaginationQuerySchema.extend({
  state: csvEnumArray(KbDocumentState), cleanupOnly: queryBoolean().optional(),     // z.coerce.boolean 금지(CLAUDE.md)
  runId: z.string().uuid().optional(), observedChange: csvEnumArray(z.enum(['NEW', 'CHANGED', 'UNCHANGED'])),
  excludeReason: csvEnumArray(KbExcludeReason),
});
export const KbMetaResponseSchema = z.object({
  enabled: z.literal(true), ragConfigured, ingestAck: z.enum(['INTERNAL_NETWORK', 'AUTHENTICATED', 'TLS']).nullable(),
  ragReady: z.boolean().nullable(), ragCheckedAt, /* [구현 — §25 I-43] 둘 다 INGEST_STATUS 행 캐시값 */ htmlFormat: z.enum(['DOCX', 'TXT', 'HTML']),
  caps: { maxPages, maxFileBytes }, privateAllowlistConfigured, governanceMode, rawFileIngestAllowedByServer,
  bulkWindow: z.string().nullable(), failedSourceCount, needsCleanupSourceCount,
});
export const ChatbotKbStatusResponseSchema = z.object({
  sources: z.array(z.object({ id, name, lastRunStatus, lastSyncedAt, needsCleanupCount })),   // URL·호스트 미노출(R-26)
  environmentModeOn: z.boolean(),                                                            // J-15 안내 표시 여부
});
```

- `governance.ts`: `EgressExitId` +`'KB_CRAWL'`(6 → 7) · `EgressDataKind` +`'CRAWL_REQUEST'`·`'DOCUMENT_BODY'`(6 → 8) · `GovernanceMapResponseSchema.egress.kbSources` **optional**.
- `audit.ts`: `AuditTargetType` +`'KbSource'` + 라벨 "지식베이스 소스". `AuditAction` 추가 0(T-10 16 불변).
- `common.ts`: `ApiErrorCode` +3 — `KB_SOURCE_BUSY`(409) · `KB_INGEST_NOT_ALLOWED`(409 · `details[].message` = 사유 코드 `TRANSPORT_NOT_ACKNOWLEDGED｜RAG_NOT_CONFIGURED｜PREVIEW_REQUIRED｜PREVIEW_STALE｜REVIEW_REQUIRED` — 구현: 미승인 사유가 강등(`reviewRequiredReason`)이면 `REVIEW_REQUIRED`, 아니면 `PREVIEW_REQUIRED` · §25 I-11 · [pass 8 — §25 I-86] 실행 시작(수동 실행·적재 승인 — **PREVIEW 포함**)이 거버넌스 규칙에 걸리면 `details: [{ field: 'piiMask'｜'allowRawFileIngest', message: 'GOVERNANCE_MASK_REQUIRED'｜'GOVERNANCE_RAW_FILE_NOT_ALLOWED' }]` + 원인·해결 문구) · `KB_HOST_NOT_ALLOWED`(400 · `details` = `{ field, message: PRIVATE_NOT_ALLOWLISTED｜ABSOLUTE_BLOCKED｜DNS_FAILED｜INVALID_URL }`).
- `.default()`를 **응답 스키마 외** 입력 스키마에 쓰지 않는다 — 기본값은 서비스가 `KB_SYNC_LIMITS`로 채운다(PATCH 부분 수정 시맨틱 보존).

---

## 5. 외부 RAG 적재 (ADR-0022 부분 재개)

### 5.1 재결정 범위 (C-1 · J-2)

| ADR-0022 항목 | 이 그룹 이후 | 봉인 |
|---|---|---|
| §1 출구 = `RagHttpClient` 1개 클래스 | **불변** — 적재도 이 클래스 | KB-4 |
| §2 경로 allowlist 3 · 경로 인자 미수용 | **3 → 5**(`INGEST` · `TASK_STATUS`) · 메서드는 여전히 경로를 받지 않는다 · `send(key: RagPathKey)` | KB-1 · KB-4 |
| §2 `POST /api/documents/ingest`·`/api/async_task*` "미구현 — 분리" | **적재 1경로 + 작업 개별 조회 1경로만 허용**(등록 소스 자동 동기화 전용 — 호출부 = `kb-ingest.runner.ts` 1파일) · 작업 목록(`/api/async_tasks`)·작업 취소(`/api/async_task_cancel`)는 **금지 목록에 추가** | KB-2 · KB-6 |
| §2 삭제·초기화·전역 설정·프롬프트 "미구현·금지" | **불변**(`rag-allowlist.spec.ts` 무수정) | 기존 |
| §3 금지 문자열 0건 정적 검사 | **불변** + 새 금지어 2(KB-2) | KB-2 |
| §4 `provider` 받는 필드 없음 | **불변** · 같은 원리를 `file_path`·`force_sync`에 적용 | KB-3 |
| §5 수동 업로드·삭제·초기화 없음 · 운영자가 외부 RAG에서 직접 | **수동 업로드 화면 없음 불변(No.48 계속 종결)** · 삭제·초기화 없음 불변 · **등록 소스가 만든 문서의 추가·갱신만** 우리가 한다(운영자 직접 업로드 문서는 계속 운영자 관리 — 소스 전용 서브카테고리 권장) | ADR-0044 |
| §8 RAG 프록시 경로 없음 | **불변** — 적재·작업 조회를 우리 공개/관리 API로 노출하지 않는다(관리 API는 우리 DB 상태만 보여 준다) | KB-7 |
| §9 무인증·평문 = 배포 전 전제 | **적재는 더 강하게** — 전제 확인 환경변수 없으면 적재 자체가 불가(§5.7) | FR-KB6-1 |
| 선결 문제 6(+No.43 요구사항 7) | 아래 §5.6 표 | — |

### 5.2 `RagHttpClient` 확장

```ts
// rag/lib/rag-paths.ts
export const RAG_PATHS = Object.freeze({
  QUERY: '/api/rag/query',
  STATUS: '/api/status',
  DOCUMENT_METADATA: '/api/documents/metadata',
  INGEST: '/api/documents/ingest',          // [No.43] 적재 — 파일 업로드(multipart)만
  TASK_STATUS: '/api/async_task_status/',   // [No.43] 작업 개별 조회 — 뒤에 검증된 UUID만 붙는다
} as const);

// rag/rag-http.client.ts (공개 메서드 3 → 5)
export interface RagIngestInput {
  file: KbIngestFile;          // 브랜드 타입 — kb-sync/lib/external-file-name.ts만 만든다 { name, bytes: Uint8Array, contentType }
  company: string; category: string; subcategory: string;   // 3개 모두 필수 — 빈 값이면 호출 전 거부
}
async ingest(input: RagIngestInput, timeoutMs = 120_000): Promise<RagSendResult>
async taskStatus(taskId: string, timeoutMs = 10_000): Promise<RagSendResult>   // isRagTaskId(taskId) 거짓이면 fetch 없이 { networkError: true, invalidTaskId: true }

private async send(key: RagPathKey, method: 'GET' | 'POST', body: RagBody | undefined, timeoutMs: number, pathSuffix?: RagTaskId)
type RagBody = { kind: 'JSON'; value: unknown } | { kind: 'MULTIPART'; form: FormData };
```

- **`fetch(` 호출은 여전히 1곳**, 그 직전 `assertEgressAllowed('RAG', url)` 1곳(G-2 순서 불변). JSON이면 기존대로 `Content-Type: application/json` + `JSON.stringify`, 멀티파트면 **헤더를 지정하지 않고**(경계 문자열은 `fetch`가 만든다) `FormData`를 본문으로 넘긴다. 기존 3메서드는 `{ kind: 'JSON', value }`로 감싸 호출만 바뀌고 전송 바이트는 동일하다(구현: 결과 타입에 `retryAfterMs`가 더해져 `rag-http.client.spec.ts`의 기대 객체가 X-3으로 바뀌었다 · §25 I-19).
- `FormData` 조립은 `ingest()` 안 **정확히 4회의 `append`** — `'file'`(Blob + `name`) · `'company'` · `'category'` · `'subcategory'`. `force_sync`를 보내지 않으므로 기본 비동기(KB-4).
- `pathSuffix`는 `RagTaskId` 브랜드 타입만 받는다 — `rag/lib/rag-task-id.ts`의 `toRagTaskId(s)`(정규식 `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, 소문자화 후 검사)만 만든다(KB-5 · AC-KB4-9).
- `method`는 `'GET' | 'POST'` 그대로 — `'DELETE'` 리터럴 0(KB-4).
- 응답 전체 수신(`res.text()`)은 그대로 — 적재·조회 응답은 수백 바이트(`API_RAG.md` 248~256·472~513행). 모드 OFF 리다이렉트 추종은 기존 동작 그대로(ADR-0022 No.26 보강 제안 — K-10).
- **`RagCallLog`에 기록하지 않는다** — 로그는 `KbIngestJob` 행(FR-KB4-11 · KB-19).

### 5.3 봉인 변경 요약

| 봉인 | 이전 | 이후 |
|---|---|---|
| `RAG_PATHS` 키 | 3 | **5**(값 리터럴 단언 — KB-1) |
| `RAG_PATHS` 참조 파일 | 2(`rag-paths.ts`·`rag-http.client.ts`) | **2 불변**(`rag-allowlist.spec.ts` 무수정) |
| 금지어(저장소 전체) | 초기화·문서 삭제(따옴표 닫힘)·전역 설정·프롬프트 4 | **불변 4** + **작업 목록 `/api/async_tasks` · 작업 취소 `/api/async_task_cancel`**(KB-2 — 조각 조립 · `'/api/async_task_status/'`와 부분 일치하지 않는다) |
| `file_path`·`force_sync` | (없음) | 송신 조립 파일(`rag-http.client.ts`·`rag-paths.ts`)·`kb-sync/**`·`shared-types/kb-sync.ts`에 0 · `file_path` 보유 파일 = {`rag/lib/rag-response.schema.ts`, `rag/lib/sanitize-sources.ts`} 정확히(KB-3) |
| 적재 호출부 | — | `ingest(`·`taskStatus(` 호출 파일 = `kb-sync/engine/kb-ingest.runner.ts` 1개(KB-6) |

### 5.4 결정적 파일 이름 (FR-KB4-3 · C-4)

- `kb_<sourceId 하이픈 제거 앞 8자>_<urlHash 앞 16자>.<ext>` — `ext` = `docx｜txt｜html`(HTML 변환) 또는 `pdf｜docx｜xlsx｜pptx`(원본 파일). 순수 함수 `buildExternalFileName()` 1곳(KB-20 · 정규식 `^kb_[0-9a-f]{8}_[0-9a-f]{16}\.(docx|txt|html|pdf|xlsx|pptx)$`).
- 같은 URL = 같은 이름 = 외부 **덮어쓰기 = 갱신**. 원래 파일명·경로·한글·특수문자는 이름에 넣지 않는다(외부 `uploads/` 저장 경로 안전 · 정보 노출 방지).
- 충돌: 다른 소스는 앞 8자가 다르고(uuid) 같은 소스의 다른 URL은 뒤 16자(64비트)가 다르다. 운영자가 직접 올리는 파일과는 접두 `kb_`로 구분한다(Q-10 — 외부 RAG 담당자에게 접두 예약 합의 요청).
- **형식 변경의 함정**: `KB_HTML_INGEST_FORMAT`을 바꾸면 확장자가 바뀌어 **새 파일**이 된다 — 옛 파일은 외부에 남는다. 적재 지문이 달라진 문서는 `cleanupReason = FORMAT_CHANGED`를 달고 재적재한다(K-8). 형식은 설치 시 한 번 정하는 값이다(운영 문서).

### 5.5 변환 형식 (C-5 · J-8 — Q-1 확인 전 기본값)

| 형식 | 외부 RAG 근거 | 우리 구현 | 판정 |
|---|---|---|---|
| **DOCX**(기본) | 지원 표에 **명시**(`.docx·.pptx 등` — LibreOffice → PDF · 실패 시 원본 처리 — `API_RAG.md` 213행) | `kb-sync/lib/docx-writer.ts` — `fflate.zipSync` · 최소 OOXML 4파트(`[Content_Types].xml`·`_rels/.rels`·`word/document.xml`·`word/styles.xml`) · 제목 `Heading1`~`Heading3` 스타일 · 문단 · 목록은 "• " 문단 · 표는 " \| " 구분 행 · XML 금지 제어 문자 제거·이스케이프 · **고정 mtime**(같은 텍스트 = 같은 바이트) | **확인 전 기본값** — 명시 형식이라 가장 안전. 대가: LibreOffice 변환 시간(처리량 ↓) |
| TXT | 지원 표에 **없음** | UTF-8(BOM 없음) · LF · 제목 줄 `# ` | Q-1에서 지원 확인 시 권장(가장 빠름 · 변환 손실 0) |
| HTML | 지원 표에 **없음** | **원본 HTML이 아니라** 추출 구조로 새로 만든 최소 HTML(`<meta charset>`·`<title>`·`h1~h3`·`p`·`li`·`table` — 속성·스크립트·주석 0) | Q-1에서 지원 확인 시 선택 |

- **문서 머리 3줄**(모든 형식): `출처: <URL — 쿼리·프래그먼트·사용자정보 제거>` · `제목: <제목>` · `수집 시각: <KST ISO>`. 머리 줄도 PII 마스킹 대상이다(경로에 이름이 들어간 URL 방어). 해시는 머리 줄을 **제외한** 정규화 본문으로 계산한다(수집 시각이 매번 바뀌어도 변경 없음).
- 원본 파일(PDF·DOCX·XLSX·PPTX)은 **바이트 그대로** 보낸다(P-6 — 소스 옵션 켜짐 · 거버넌스 규칙 충족 시만 — §10).
- 착수 직후 **실측 1회**(Q-6): HTML 10쪽을 DOCX·TXT·HTML로 각각, PDF 5개를 적재해 성공 여부·처리 시간·청크 수·`section_title` 품질을 기록하고 기본값·`KB_INGEST_CONCURRENCY`를 확정한다(운영 문서 §5.7).

### 5.6 성패 판정 · 작업 조회 함정 대응 (FR-KB4-6~9 · 선결 문제)

| 외부 성질(`API_RAG.md`) | 대응 | 위치 |
|---|---|---|
| 적재는 파일 업로드 · 회사/카테고리/서브카테고리 필수(191~197행) | 소스 스코프 3단 필수 저장 검증 · `ingest()`가 빈 값이면 송신 전 거부 · 400은 재시도 0(`HTTP_400` — 설정 오류 배지) | §4 · `parse-ingest-response.ts` |
| 기본 비동기 — `{status:"async_started", task_id}`(245~256행) | 접수 = HTTP 2xx ∧ `status === 'async_started'` ∧ `toRagTaskId(task_id)` 성공 · 아니면 `INVALID_TASK_ID`로 FAILED(경로에 넣지 않음) | `parseIngestResponse()` |
| 동기 응답 `{result: "…성공."｜"…실패."}`(263~275행 — 200인데 실패) | 문자열 접미 판정(`/성공\.\s*$/` · `/실패\.\s*$/` — 둘 다 아니면 `UPSTREAM_ERROR`) | 순수 함수 1벌(`judgeIngestResultText`) |
| `progress` 항상 0(530행) | **쓰지 않는다** — 진행률 = 우리 작업 행 `done/total`(§9.6) | — |
| `completed`인데 `result`가 "…실패."(526~528행) | `completed` ∧ 성공 접미일 때만 SUCCEEDED · 실패 접미 = `RAG_REPORTED_FAILURE`(재시도) | `parseTaskStatus()` |
| `failed`(`error` 원문) · `cancelled` | `TASK_FAILED`·`TASK_CANCELLED`(재시도) — **`error` 원문은 저장·로그 0**(코드만) | 〃 |
| 재시작 시 `not_found`(533~534행 — 200) | **실패 아님** → `notFoundResubmitted` 1회 재전송(같은 이름 덮어쓰기) · 재전송 뒤 또 `not_found`면 `TASK_LOST` FAILED(구현 — §25 I-34: 재전송은 **즉시**(`nextAttemptAt = now`) · `resubmitNotFound()` CAS가 `notFoundResubmitted = false`일 때만 성공해 1회뿐 · 슬롯 해제) | `kb-ingest.runner.ts` |
| (구현 추가 — §25 I-34) 작업 조회 자체의 네트워크 오류·5xx·429 | 외부 작업 성패 정보가 없으므로 `POLL_AGAIN` — **상태 불변 · 재전송 0** · 다음 조회는 429면 max(`KB_INGEST_POLL_MS`×2, `Retry-After`) 뒤, 그 밖은 `KB_INGEST_POLL_MS` 뒤 · 끝없는 재조회는 제출 후 3시간 `TIMEOUT`이 끊는다 · 그 밖의 비2xx(4xx)는 `UPSTREAM_ERROR` 재시도 | `parseTaskStatus()` · `kb-ingest.runner.ts` |
| `cancelling`(관측 안 됨 가정) | `running`과 같이 대기 | `parseTaskStatus()` |
| 작업 목록은 재시작 전까지 증가(536~539행) | 목록 경로 **호출 불가**(금지어 KB-2) · 개별 조회만 | — |
| 작업 취소 | 호출 불가(금지어) — 우리 쪽 중지는 조회만 멈추고 `UNKNOWN`(AC-KB5-4) | — |
| 같은 이름 덮어쓰기(198행) | 결정적 이름(§5.4)이 "재적재 = 갱신"을 만든다 | — |
| `file_path` 임의 절대경로(200~202행) | 받는 필드·보내는 코드 0(KB-3) | — |
| 재적재 시 청크가 줄면 옛 청크 잔존(296~299행) | 축소 감지 → `cleanupReason = SHRUNK`(§8) | `change-detect.ts` |
| 문서 1건 삭제 API 없음(384~390행) | 자동 삭제 없음 · "정리 필요" + 전체 다시 적재(P-3) | §8 |
| vLLM 죽으면 메타데이터 빈 채 저장·실패(289~292행) | 제출 전 `status()`의 `vllm_ready === true` 확인(60초 캐시 — 구현 §25 I-36: 응답 **최상위** `vllm_ready`(`API_RAG.md` §0-5) · 이전 구현의 `vllm.status` 참조는 버그였다) · 아니면 제출하지 않고 대기(`waitingReason = RAG_NOT_READY` · 시도 수 미산입) | §5.8 |
| 직렬 권장(293~294행) · 동시 50 · 분당 200(96~102행) | 슬롯 임대 N(기본 1) · 인스턴스 버킷 30/분 · 질의 게이트 비사용 | §5.8 · §9.4 |
| 동기 최대 3시간(267~269행) | 비동기만 쓰고 제출 후 3시간 넘으면 `TIMEOUT`(외부 계속 가능 표시) | §9.5 |
| HWP 리눅스 불가(214행) | 수집 대상 형식 아님(`TYPE` 제외 · "PDF로 변환해 게시" 안내) | §6.7 |
| 적재 응답 413(200MB) | 파일 상한 20MB(서버 상한 100MB)라 도달 0 — 도달 시 `HTTP_400`류로 FAILED | — |

### 5.7 전송 전제 게이트 (P-5 · FR-KB6-1 · C-6)

- `KB_INGEST_TRANSPORT_ACK` ∈ {`INTERNAL_NETWORK`, `AUTHENTICATED`, `TLS`} — 서버 운영자가 "외부 RAG 전송 구간이 이 조건을 충족한다"를 **선언**하는 값이다. 없으면:
  - 소스 등록·수정·미리보기(`PREVIEW`)는 **가능**(외부 RAG 호출 0).
  - "적재 시작"(`approve-ingest`)·`SYNC`·`FULL_RESEND` 요청은 `409 KB_INGEST_NOT_ALLOWED`(`TRANSPORT_NOT_ACKNOWLEDGED`).
  - 예약 실행은 승인된 소스여도 적재 단계를 만들지 않고 `FAILED(INGEST_NOT_ACKNOWLEDGED)`로 끝낸다(ACK를 나중에 지운 경우 — 크롤 결과는 남아 다음 실행에서 다시 "바뀜").
  - 대기 중 작업(PENDING)은 제출하지 않는다(적재기가 매 제출 직전 재확인).
- `TLS`는 `RAG_BASE_URL`이 `https:`일 때만 허용(기동 검사). `INTERNAL_NETWORK`·`AUTHENTICATED`는 서버가 검증할 수 없는 **운영자 선언**이다(K-7) — 콘솔에 "외부 RAG 전송 구간: 내부망(운영자 확인)"으로 표시하고, 설치 가이드가 확인 절차를 적는다.
- 질의 경로(2단계 답변)에는 이 게이트를 **적용하지 않는다**(기존 ADR-0022 §9 동작 불변 — 질의는 마스킹된 200자).

### 5.8 외부 RAG 부하 보호 (J-14 · C-9 · NFR-KBP3)

- **질의와 분리**: `RagGateService`(질의 동시성·레이트·회로)를 주입하지 않는다 — 적재가 질의 슬롯을 먹지 않고, 질의 회로가 열려도 적재 판단이 흔들리지 않는다(제약 ⑫).
- **호출 한도**: 인스턴스별 토큰 버킷 `KB_RAG_CALLS_PER_MIN`(적재 + 작업 조회 + 상태 확인 합계). [구현: `kb-sync/lib/kb-rag-call-limiter.ts` — 직전 60초 슬라이딩 창 · DI 토큰 `KB_RAG_CALL_LIMITER` · §25 I-18] 슬롯 1개 기준 실제 호출은 분당 약 8회(조회 6 + 제출 1 + 상태 1) — 한도는 방어 이중화다. 다중 인스턴스에서는 슬롯이 전역이라 합계도 슬롯 수에 비례한다.
- **429·503 백오프**: 제출 실패 1분 · 5분 · 30분(최대 3회) — `Retry-After`가 더 길면 그 값. [구현: `rag/lib/retry-after.ts`가 초·HTTP-date를 해석(상한 30분)하고, 값이 있으면 길이 비교 없이 고정 백오프 대신 그 값을 쓴다 · §25 I-19] [pass 4 — §25 I-34: 작업 **조회**의 네트워크 오류·5xx·429는 `parseTaskStatus()` = `POLL_AGAIN`(작업 상태 불변 · 재전송 0) — 429면 다음 조회를 max(`KB_INGEST_POLL_MS`×2, `Retry-After`) 뒤로, 그 밖은 `KB_INGEST_POLL_MS` 뒤로 미룬다] 작업 조회의 429는 다음 조회를 `KB_INGEST_POLL_MS × 2`로 미룬다(작업 상태는 바꾸지 않음).
- **vLLM 상태**: 제출 직전 `status()`(60초 캐시 — 인스턴스 메모리 + 표시용 `KbJobLease('INGEST_STATUS').state` 갱신). `vllm_ready=false`면 제출하지 않고 슬롯을 놓는다. [구현 — §25 I-36: 캐시는 인스턴스 메모리가 아니라 `INGEST_STATUS` 행 하나(모든 인스턴스 공유 · `checkedAt` 60초) · 판정 = 응답 최상위 `vllm_ready === true` · 대기 작업이 있을 때만 슬롯 선점 **전**에 확인하므로 준비 안 됨이면 슬롯을 잡지 않는다 · 호출 한도 초과 시 캐시값]
- **업무 시간 보호**: BULK 레인은 `KB_INGEST_BULK_WINDOW` 밖이면 선택하지 않는다(구현 — §25 I-43: `isWithinBulkWindow(창, now)` → `pickNextPendingJob(now, bulkAllowed)`)(적재가 외부 vLLM을 써서 챗봇 답변과 경합 — Q-7 · §9.7).

---

## 6. 수집 (크롤러)

### 6.1 7번째 출구 클래스 `KB_CRAWL` (J-11 · C-11 · G-1/G-2)

```ts
{
  exitId: 'KB_CRAWL',
  files: ['kb-sync/crawl/kb-crawl-http.fetcher.ts', 'legacy-api/transport/node-http.transport.ts', 'legacy-api/transport/node-dns.resolver.ts'],
  dataKind: 'CRAWL_REQUEST',      // 요청 줄·UA·(선택) 고정 헤더 — 사용자 텍스트 송신 0
  masked: 'NOT_APPLICABLE',
  label: '지식베이스 수집(크롤러)',
}
```

- **G-1**: 출구 문자열(`fetch(`·`http.request(`·`https.request(`·`node:dns`) 사용 파일 = 레지스트리 파일 집합 — fetcher는 `this.transport.request(`만 쓰므로 G-1 패턴에 걸리지 않지만 **등록은 필수**(No.41 W-2 선례 — KB-6이 `transport.request(` 보유 파일 ⊆ 레지스트리를 보강 단언).
- **G-2**: fetcher 1파일에서 `checkEgress('KB_CRAWL', …)`가 `this.transport.request(`보다 앞선다(수·순서) — 리다이렉트 추종은 같은 `fetchOnce()`를 다시 부르므로 호출 지점은 각 1개다.
- **적재는 RAG 클래스 그대로**(R-2): 같은 호스트·같은 파일·같은 가드라 출구 판정이 동일하고, 데이터 종류의 차이(질문 vs 문서 본문 · 소스별 마스킹)는 **데이터 지도 `kbSources` 절이 소스 단위로** 더 정확하게 보여 준다. `RAG_INGEST` 분리는 `EgressExitId` 8 · `exits[]` 행 증가(미사용 설치 바이트 변화) · 응답 `masked` enum 변경을 부르면서 판정 결과는 같다(ADR-0044 대안 표).

### 6.2 SSRF 다층 방어 · 사설 허용 목록 (J-12 · C-7 · FR-KB1-3 · FR-KB6-5)

요청 1건(`fetchOnce(url, ctx)`)의 순서 — `workflow-http.sender.ts` 56~130행과 같은 층:

1. **URL 검사**: `http:`/`https:`만 · 사용자정보(`@`)·제어 문자·공백 거부 · 호스트 ∈ 소스 `allowedHosts`(정확 일치 — 하위 도메인 자동 포함 없음) · 포트는 시작 주소에 명시된 것만. **[pass 12 해소 — §25 I-104 · U-5 (b) · 바로 뒤 서술은 pass 10 시점 기록 · 현재 규칙은 이 절 아래 "허용 출처" 항목]** ~~[미구현 — §25.6 RG-26 · pass 10 확인]~~ 허용 호스트(`allowedHosts`)는 호스트 이름만 저장하고, 범위 검사(`scope-match.ts` `isInScope` — `url.hostname`)·fetcher 허용 호스트 검사·첫 요청의 인증 헤더 판정도 포트를 비교하지 않는다 — 같은 호스트의 다른 포트로 가는 링크·리다이렉트가 범위 안으로 처리된다(출구 게이트·DNS 주소 판정은 요청마다 그대로 적용 · pass 10부터 리다이렉트 홉만 다른 포트면 인증 헤더를 싣지 않는다 — §6.9).
2. **출구 게이트**: `checkEgress('KB_CRAWL', url)` — 모드 ON이면 `DATA_EGRESS_ALLOWED_HOSTS` 밖 차단(`EGRESS_BLOCKED` · 송신 0).
3. **DNS 1회**(IP 리터럴이면 생략) → **모든 주소 판정**: `ABSOLUTE_BLOCKED`(루프백·링크로컬·메타데이터·0.0.0.0/8·멀티캐스트·예약) = 거부(허용 목록으로도 못 연다) · `PRIVATE` = `KB_CRAWL_PRIVATE_ALLOWLIST`의 CIDR 또는 정확한 호스트명일 때만 · 하나라도 불합격이면 그 URL 거부.
4. **검증 주소로만 연결**(`pinnedAddresses` — 재바인딩 방지 · SNI·인증서는 호스트명 기준 유지) · 단일 데드라인 · `agent: false`.
5. 응답 크기 상한(HTML 2MB · robots 512KB · 사이트맵 10MB 압축 · 파일 = 소스 `maxFileBytes`) — 스트림 도중 중단.

- 호스트별 DNS 결과는 **5분** 재사용한다(구현 — §25 I-16: fetcher 인스턴스 메모리의 호스트별 TTL 5분 캐시 · 조회 실패(빈 결과)는 캐시하지 않음 · 주소 판정(절대 차단·사설 허용 목록)은 캐시 여부와 무관하게 **매 요청** 수행 · 핀 연결은 판정한 **같은 주소 배열** · 리다이렉트 재검증도 같은 캐시).
- **저장 시 검증**(`kb-sources.service.ts`): 시작 주소·사이트맵 호스트마다 ①②③을 미리 수행해 `400 KB_HOST_NOT_ALLOWED`(`PRIVATE_NOT_ALLOWLISTED`·`ABSOLUTE_BLOCKED`·`DNS_FAILED`) · 모드 ON 목록 밖 = `400 EGRESS_HOST_NOT_ALLOWED`(No.26 코드 재사용). 실행 시에도 매번 다시 판정한다(EX-KB-18 — 거버넌스를 나중에 켠 경우 실행 차단 + 배지, 기동 실패 아님). [구현: 요청마다 재판정해 차단(송신 0)은 되지만 실행 `failureCode`·배지는 없다 — 차단 요청은 `TRANSIENT`, robots 요청이 막히면 그 호스트 중단 · §25.1 RG-2]
- **자기 자신 크롤**(EX-KB-22): 루프백은 절대 차단 · 사설 주소의 자기 서버는 허용 목록에 넣지 않는 한 거부.
- **[pass 12 — §25 I-104 · RG-26 해소 · U-5 (b) PM 기본안] 허용 출처(host:port)**: 1단계 URL 검사는 호스트 이름(`allowedHosts`)에 더해 **출처**(`new URL().host` 소문자 — 스킴 기본 포트 80/443은 빠지므로 `:443` 명시와 생략은 같은 출처)가 허용 집합에 있어야 한다. 집합 = 시작 주소·사이트맵 URL이 가리키는 출처 전부(`lib/allowed-origins.ts` `computeAllowedOrigins(seedUrls, sitemapUrls)` — 명시한 모든 포트 허용 · 사이트맵 안 `<loc>`은 출처를 넓히지 못한다 · 시작 주소에 포트가 없으면 그 스킴의 기본 포트만). **저장하지 않고** `parseSourceRow()`(`ParsedSourceConfig.allowedOrigins`)가 tick·적재 작업마다 다시 계산한다(`configVersion`이 바뀌면 다음 tick부터 새 집합 · 스키마·계약·마이그레이션 0 · `allowedHosts` 저장 형식·`deriveAllowedHosts`·호스트 겹침 판정·데이터 지도 불변). `ScopeConfig`·`KbFetchRequest`에 **필수 필드**로 넣었다(선택이면 누락 시 호스트 이름만 보는 조용한 구멍이 된다). 적용 지점: `isInScope`(링크 → `outOfScopeLinks` · 리다이렉트 → `REDIRECT_OUT_OF_SCOPE` · 사이트맵 `<loc>` → 같은 검사) · fetcher 허용 호스트 단계(`HOST_NOT_ALLOWED` — 네트워크 주소 판정·핀 연결·출구 게이트는 종전 그대로) · 적재 `submitJob` 범위 방어(다른 포트 문서 = `SKIPPED(EXCLUDED_AT_INGEST)`) · 인증 헤더(§6.9) · robots.txt(§6.5). 영향: 같은 호스트의 다른 포트 문서를 수집하려면 그 포트 URL을 시작 주소나 사이트맵에 넣어야 한다(링크로만 발견되던 다른 포트 문서는 다음 실행부터 범위 밖 — 미배포라 운영 데이터 영향 0 · 개발 DB의 그런 행은 2회 뒤 GONE/정리 필요). 스킴은 출처에 들어가지 않는다 — `http://a`와 `https://a`는 같은 출처다(상향 리다이렉트 유지 · 하향 리다이렉트는 §6.4에서 거부 · 링크·사이트맵으로 발견한 `http://` URL은 범위 안 — ~~그 첫 요청의 인증 헤더 문제는 §25.7 RG-28~~ **[pass 13 해소 — §25 I-107]** 그 요청의 인증 헤더는 `http:`를 시작 주소·사이트맵에 명시한 host:port에만 싣는다(§6.9 — 범위 판정은 스킴 무관 그대로) · 두 스킴 중복 적재 가능성은 §20 K-28).

### 6.3 공유 전송 포트 확장 (제약 ③ · ADR-0034/0041 갱신)

```ts
export interface LegacyTransportRequest {
  // …기존 필드 불변
  /** [신규 No.43] 'REPORT'면 3xx를 오류가 아니라 RESPONSE(본문 비움 + headers.location)로 돌려준다. 기본 'FAIL'(현행). */
  redirectMode?: 'FAIL' | 'REPORT';
  /** [신규 No.43] 결과 headers에 담을 응답 헤더(소문자 · 닫힌 목록). 미지정 = headers 키 없음(현행). */
  captureHeaders?: ReadonlyArray<'etag' | 'last-modified' | 'location' | 'x-robots-tag' | 'content-encoding' | 'content-length' | 'retry-after'>;   // [pass 5 — §25 I-59] 'retry-after' 추가(크롤 단계 429·503 지연 — I-51)
}
export type LegacyTransportResult =
  | { kind: 'RESPONSE'; status: number; contentType?: string; bytes: number; body: Buffer; retryAfter?: string; headers?: Record<string, string> }
  | { kind: 'ERROR'; outcome: LegacyTransportOutcome; errorCode?: string };
```

- 기본값이 현행이라 레거시·웹훅 호출부와 기존 spec은 **무수정**이다. `REPORT`의 3xx 본문은 `maxBytes`까지만 소비·폐기한다.
- 크롤러 요청 헤더: `User-Agent`(`KB_CRAWL_USER_AGENT`) · `Accept: text/html, application/xhtml+xml, application/pdf, application/vnd.openxmlformats-officedocument.*;q=0.9, */*;q=0.1` · **`Accept-Encoding: identity`**(전송 계층이 압축을 풀지 않으므로 — 서버가 무시하고 `Content-Encoding`을 보내면 `ENCODING` 제외) · 조건부 요청 시 `If-None-Match`·`If-Modified-Since` · 소스 고정 헤더(§6.9).
- **ADR-0041 재검토 트리거 "세 번째 출구가 같은 부품을 공유 → `common/outbound/`로 이동"이 발동한다.** 이 설계는 **이동하지 않는다**(R-15): ① 이동은 동작 변화 0인 경로 변경인데 import 파일 15개(그중 spec 9개 — 레거시·업무 자동화·리치 메시지 통합 시험)를 흔들어 이 그룹과 무관한 회귀 면적을 만든다 ② L-2·W-12 경로 단언과 레지스트리 파일 목록이 연쇄로 바뀐다. 대신 **독립 리팩터 커밋**(동작 0 · 경로만 · 이 그룹 뒤)으로 분리해 사용자 결정에 맡기고(보고 U-3), ADR-0041에 "발동 확인 · 연기 · 새 트리거 = 네 번째 소비자(No.39 커넥터 허브) 또는 사용자 지시"를 적는다.

### 6.4 리다이렉트 (C-8 · FR-KB2-7)

`redirect-policy.ts`(순수) — `nextHop(current, status, location, ctx)`:

- 3xx(`301·302·303·307·308`)이고 `location`이 있으면 현재 URL 기준으로 해석 → **§6.2 1~3단계 전부 재검증**(허용 호스트 · 출구 게이트 · 주소 판정). 하나라도 불합격 = `REDIRECT_OUT_OF_SCOPE` 제외.
- `https:` → `http:` 하향 거부 · `http:` → `https:` 상향 허용(같은 호스트).
- **최대 3회** — 4번째 3xx는 `REDIRECT_OUT_OF_SCOPE`. 순환(이미 방문한 URL로 돌아옴) = 중단.
- 최종 URL이 원래 URL과 다르면 **최종 URL로 문서를 기록**하고(정규화 후) 원래 URL은 프런티어에서 `VISITED` 처리만 한다(같은 문서 두 번 적재 방지). `303`은 GET 그대로(우리는 GET만).
- `<meta http-equiv="refresh">`는 따라가지 않는다(본문 없음 판정으로 수렴).
- **[pass 6 해소 — §25 I-66 · 이전 §25.2 RG-16]** 공용 헬퍼 `crawl/kb-redirect-follow.ts` `fetchFollowingRedirects()`(크롤 문서·사이트맵·robots.txt·적재 재수집이 공유 — 홉마다 범위 재검증 · 출구·주소 판정은 요청마다): 범위 밖·하향·4번째 홉·순환 = 크롤 `EXCLUDED(REDIRECT_OUT_OF_SCOPE)`(시작 주소 도달로 셈) / 적재 `SKIPPED(EXCLUDED_AT_INGEST)` · 최종 URL(정규화)을 같은 깊이 · 부모 = 원래 문서로 프런티어에 올려 **그 행에** 받은 응답을 기록하고 원래 URL 행은 방문 표시만(`ACTIVE` · `observedChange = null` — 적재 후보 아님 · 최종 URL이 비대상 형식이면 원래 행 `EXCLUDED(TYPE)`) · 상대 링크는 최종 URL 기준 · 홉마다 robots 재확인(차단 = `EXCLUDED(ROBOTS)`)·페이싱(크롤 단계만 — 적재 단계 홉은 없음, §25.4 RG-22②) · 조건부 헤더는 첫 요청에만 · 인증 헤더는 홉에서 **시작 호스트**로 갈 때만 · `Location` 없음·해석 불가 = `TRANSIENT`.
- **[pass 7·8 — §25 I-75·I-78·I-85]** ① **홉 ≥ 1의 강제 대기**(**[pass 9 폐기 — 아래 pass 9·10 항목 ① · §25 I-92]** 이 ①은 pass 7·8 시점 기록이다): 앞 홉 요청이 이미 나갔으므로 다음 홉은 조각 예산을 넘겨서라도 호스트 간격을 기다린다(홉 사이 robots 조회도 강제 · 안전 상한 = 실효 간격 상한 300초 + 10초 · 대기 중 10초마다·요청 직전 2초 간격으로 크롤 임대 갱신 — 잃으면 다음 홉을 보내지 않는다 · 중지 요청은 1초마다 확인). 홉 0은 종전대로 예산을 넘으면 미룬다. 미루면 다음 조각이 홉 0부터 다시 요청해, 간격이 조각 예산보다 큰 호스트에서 영원히 진행하지 못하던 라이브락(R4 N-1)을 없앴다 — 비용은 §20 K-19 ② 요청 상한·타임아웃은 **홉 URL마다** 정한다(`FollowRequest.maxBytes`·`timeoutMs` = 값 또는 `(url, hop) => 값` — 크롤은 파일 URL이면 `maxFileBytes`·타임아웃 ×4, 아니면 min(`maxFileBytes`, 2MB)·×1) ③ **종류 전환**: 크롤에서 최종 응답이 문서 파일인데 `allowRawFileIngest = false`면 `EXCLUDED(RAW_FILE_OFF)` · 파일 URL이 HTML로 리다이렉트되면 HTML 상한 2MB(초과 = `SIZE`) · 적재 재수집의 최종 URL 종류가 `doc.kind`와 다르면 `SKIPPED(EXCLUDED_AT_INGEST)`(다음 크롤이 원본·목적지 행으로 나눠 기록) — 판정은 `lib/detect-kind.ts`(`detectKind` 이동 + `isFileUrl`) ④ [pass 8] 리다이렉트 원래 행·범위 밖 리다이렉트 행은 인증 벽 판정용 관측 해시(`R:`·`X:`)를 남긴다(§8.4). **[pass 8 시점 기록 — §25.5 RG-24 · pass 10에서 ①(리다이렉트 홉의 다른 포트 헤더)·③(적재 타임아웃)은 해소, ②만 미해소 — 아래 항목]** 인증 헤더 동행 판정이 호스트 이름만 비교해 같은 호스트의 **다른 포트**로 가는 홉에도 헤더가 붙는다 · 리다이렉트 원래 URL은 검증자가 없어 매 실행 목적지를 조건부 없이 다시 받는다(적재는 해시로 걸러짐 — 대역폭만) · 적재 재수집 타임아웃은 홉별이 아니라 문서 종류 기준 1값.
- **[pass 9·10 — §25 I-92·I-96]** ① **리다이렉트 재개(강제 대기 대체 · pass 9 M-4)**: 모든 요청(홉 0·홉 ≥ 1 동일)은 `now + 남은 호스트 간격 > 조각 기한`이면 `DEFERRED`다(조각 예산을 넘겨 기다리지 않는다). 홉 ≥ 1에서 미루면 `fetchFollowingRedirects()`가 `DEFERRED.resume = { url, hop, visited }`를 돌려주고, 크롤러가 이를 인스턴스 메모리 `redirectResume`(키 `실행 id｜문서 id` · 상한 200 · 유효 30분 `REDIRECT_RESUME_TTL_MS` · `startUrl`·`savedAt` 포함)에 저장한다. 다음 조각은 같은 문서를 꺼내 `FollowRequest.resume`으로 **저장된 홉부터** 잇는다(홉 0 재요청 없음 · 홉 사이 robots 재확인·페이싱·최대 3회·순환 검사는 그대로). 시작 URL 불일치·30분 경과·임대 상실·재인수(`acquireLease`)·실행 종결(`forgetRun`)이면 상태를 버리고 홉 0부터 다시 한다(요청 1회 중복일 뿐 정확성 무관 — §20 K-24). 결과: 실효 간격 최대 300초에서도 문서 1건이 tick 예산(조각 ≤ 25초)을 넘겨 점유하지 않고 라이브락도 없다(간격이 예산보다 커도 조각마다 한 홉씩 진행). 이전 강제 대기(`force`·`FORCED_WAIT_GRACE_MS`)는 제거 · 요청 직전 크롤 임대 갱신은 간격 생략 없이 **항상**(pass 9 L-3 — `LEASE_RENEW_BEFORE_REQUEST_GAP_MS` 제거 · 대기 중 10초 간격 갱신은 유지) ② **인증 헤더 동행(pass 10 · RG-24①)**: 리다이렉트 홉(≥ 1)의 호스트 + 포트(`url-normalize.ts` `urlHostPort()` = `URL.host` — 스킴 기본 포트 80/443은 빠짐)가 시작 URL과 같을 때만(`isSameHostPort()`) 싣는다(크롤·적재 공통). `http→https` 상향·`https://a:443` 명시는 같은 출처로 보고 유지, `:8443` 등 다른 포트는 미전송(요청 자체는 나간다 — 범위가 포트를 구분하지 않으므로 · §25.6 RG-26 — **[pass 12 이후]** 시작 주소·사이트맵에 없는 포트면 범위 밖이라 그 홉은 `REDIRECT_OUT_OF_SCOPE`로 끝나고 요청하지 않는다 · 둘 다 허용 출처인 다른 포트로의 홉은 요청하되 헤더는 싣지 않는다) ③ **적재 재수집 타임아웃 홉별화(pass 10 · RG-24③)**: `(url) => KB_CRAWL_TIMEOUT_MS × (isFileUrl(url) ? 4 : 1)` — 크롤과 같은 규칙(`maxBytes`는 여전히 `doc.kind` 기준 1값 — 종류가 바뀌면 어차피 `SKIPPED(EXCLUDED_AT_INGEST)`라 영향 없음) ④ [미해소 — RG-24②] 리다이렉트 원래 URL은 검증자가 없어 매 실행 목적지를 조건부 없이 다시 받는다(적재는 해시로 걸러짐 — 대역폭만 · 2차).
- **[pass 11 — §25 I-103 · R6 L-C] 재개 홉 범위 재검사**: 재개(`FollowRequest.resume`)할 때 저장된 홉 URL을 요청 **전에** `normalizeUrl` + `isInScope(…, 0, 현재 범위)`로 다시 검사한다 — 미룬 뒤(최대 30분) 범위가 좁혀졌으면 요청 없이 `REDIRECT_OUT_OF_SCOPE`(reason `SCOPE` · `target` = 그 홉 URL)로 끝내고 러너가 재개 상태를 버린다(목적지에 로그인 신호가 있으면 `X:` 지문 규칙 그대로). SSRF·주소 판정·robots·페이싱·임대 갱신은 재개해도 요청마다 다시 한다. **[pass 12]** 홉 범위 판정에는 허용 출처(host:port)도 들어간다(§6.2).

### 6.5 robots.txt (FR-KB2-1 · FR-KB9-1 · FR-0-213)

- 호스트별 `/robots.txt`(요청 스킴 = 그 문서 URL의 `http:`/`https:` — `lib/url-scheme.ts` · §25 I-17)를 실행에서 처음 방문할 때 1회 조회(인스턴스 메모리 캐시 24시간 — K-11).
- RFC 9309: **2xx** = 파싱 · **4xx** = 전부 허용 · **5xx·연결 실패·타임아웃** = 그 실행에서 **그 호스트 수집 중단**(`abortedHosts`에 기록 → 삭제 감지 제외) · **리다이렉트**는 같은 호스트·허용 호스트 안에서 최대 3회만 따라가고, 범위 밖으로 가면 중단으로 본다(보수적 — RFC의 "5회·권한 넘어 추종"과 다름 — R-23). **[pass 6 해소 — §25 I-66·I-71: 같은 호스트 안 최대 3회(`http→https` 상향 허용) · 타 호스트·하향·초과 = 호스트 중단 · 4xx(429 제외) `ALLOW_ALL`도 24시간 캐시 · 429 = 호스트 중단 · robots 요청도 호스트 페이서를 거친다(간격 = 소스 간격)]**
- 그룹 선택: `User-agent` 토큰이 우리 제품 토큰(`ChatBotKBCrawler`, 대소문자 무시)과 일치하는 그룹 → 없으면 `*`. `Allow`/`Disallow` **최장 일치**(같은 길이면 `Allow`) · `*`·`$` 지원. `Crawl-delay`(초 · 비표준이지만 반영) → 호스트 간격 = max(소스 간격, Crawl-delay×1000) · 300초 초과면 그 호스트 중단(`ROBOTS_UNREACHABLE`와 구분되는 사유 코드 `CRAWL_DELAY_TOO_LONG` — 실행 요약에 표시). **[미구현 — §25.1 RG-3 · pass 7 임시 대체(§25 I-75): 서버 실효 상한 `MAX_HOST_INTERVAL_MS = 300,000` — 소스 `minIntervalMs`·`Crawl-delay`를 300초로 클램프하고 호스트는 중단하지 않는다 · 계약(`minIntervalMs` 하한만) 변경 0 · [pass 9] 클램프는 유지하되 리다이렉트 진행 보장은 더 이상 클램프·강제 대기에 기대지 않는다(§6.4 pass 9·10 ① · §25 I-92)]**
- 규칙 비교 **[pass 6 — §25 I-71]**: 대상 = 경로 + 쿼리(`/a?x=1` — `Disallow: /*?sid=` 지원) · 비ASCII 경로와 규칙은 UTF-8 퍼센트 인코딩 정준형(`lib/path-canon.ts`)으로 맞춰 비교(`Disallow: /관리`가 무시되던 결함).
- 크기 상한 512KB(초과분 무시 — RFC 권고 500KiB).
- **[pass 12 — §25 I-104 · 설계에 없던 추가 수정] robots.txt는 출처(스킴 + host:port) 단위**다(RFC 9309) — `getRobots(pageUrl, …)`가 문서 URL의 스킴·`urlHostPort`로 `${scheme}//${host:port}/robots.txt`를 요청하고 캐시 키도 같다(`robotsKey(scheme, hostPort)` · `hostIntervalMs(url, …)`의 Crawl-delay 조회도 같은 키). 이전(호스트 이름만)에는 `https://a:8443/` 시작 주소의 robots를 기본 포트로 요청해 fetcher가 허용 출처 밖으로 막고 호스트 전체가 `ABORT_HOST`(크롤 실패)가 됐다. robots 요청은 자격증명 없이 · 리다이렉트는 같은 host:port 안에서만(범위 = 그 출처 1개 · `http→https` 상향은 같은 출처). 중단 호스트(`abortedHosts`)·페이서는 호스트 이름 단위 그대로(§6.8).
- 무시 옵션 없음(1차 — FR-0-213).
- `<meta name="robots">`·`X-Robots-Tag`: `noindex` = 적재 안 함(`NOINDEX`) · `nofollow` = 링크 미추종 · 우리 UA 이름 지정 메타(`<meta name="ChatBotKBCrawler">`)도 인식. **[pass 6 — §25 I-70④·I-72③]** `X-Robots-Tag`는 쉼표 조각마다 판정하고 `봇이름:` 접두가 없는 조각은 **항상 우리에게 적용**한다(여러 줄이 `, `로 합쳐지면 줄 경계를 복원할 수 없다) — 그래서 `googlebot: noindex, nofollow`(한 줄)의 `nofollow`도 우리에게 적용될 수 있다(과적용 = 덜 적재·덜 추종 — 안전한 방향으로 수용). `noindex`만 있으면(메타·헤더) 적재는 안 하되 링크는 따라간다.

### 6.6 사이트맵

- `sitemap-parse.ts`(순수 · 작업 스레드): `htmlparser2` **`xmlMode: true`** 스트리밍 파서 — DTD·외부 엔티티를 처리하지 않는다. 추가로 문서에 `<!DOCTYPE` 또는 `<!ENTITY`가 있으면 **해석 거부**(XXE 원천 차단 — KB-17 · AC-KB6-5).
- `<urlset>`의 `<loc>` · `<sitemapindex>` 1단계만(색인 안의 색인은 무시) · 사이트맵 파일 ≤ 50개 · 파일당 압축 10MB · **압축 해제 50MB 상한**(구현 — §25 I-20·I-42: gzip 해제·문자 해석·XML 파싱을 모두 **작업 스레드**에서 한다 — 추출 요청 종류 `SITEMAP { bytes, contentType, gzipped }` → 결과 `sitemap: { kind: URLSET｜SITEMAPINDEX｜EMPTY｜REJECTED, locs }`(`lib/run-extract-job.ts`) · 해제는 `lib/gzip-guard.ts` `safeGunzip()`(`fflate` `Gunzip` 스트리밍 · 해제 바이트 실시간 계수) · URL이 `.gz`로 끝나거나 본문이 gzip 매직 바이트 `1F 8B`면 적용 · 위반·오류는 전부 `REJECTED`로 수렴 → 그 사이트맵 무시 · 압축 폭탄 방지 · 파일 50개는 색인이 가리키는 자식까지 합친 **실행당** 한도 · 색인의 `<loc>`은 자식 사이트맵으로만 추적한다(페이지 URL로 넣지 않는다) · 크롤러는 응답 `Buffer`의 **복사본**(`new Uint8Array(buf)`)을 넘긴다 — 공유 풀을 가리킬 수 있는 `Buffer`를 그대로 이전(transfer)하면 풀 전체가 분리된다) · URL은 `maxPages`까지만 프런티어에 넣는다(EX-KB-16).
- `<lastmod>`는 저장·판정에 쓰지 않는다(힌트로도 적재를 건너뛰지 않는다 — 조건부 요청이 더 정확하고 싸다).
- 사이트맵 URL도 범위 규칙(호스트·경로·제외·쿼리)을 모두 통과해야 한다. 깊이 = 0.

### 6.7 범위 · URL 정규화 · 수집 형식 (FR-KB1-2 · FR-KB2-2~4)

- **정규화**(`url-normalize.ts` — 순수): WHATWG `URL` 파싱 → 스킴·호스트 소문자 · 기본 포트 제거 · 프래그먼트 제거 · 경로 `.`/`..` 정리(URL 파서) · 퍼센트 인코딩 대문자화 · 쿼리 매개변수 정렬 · `allowQueryUrls=false`면 **쿼리가 있는 URL은 제외**(EX-KB-15) · `<link rel="canonical">`이 같은 호스트·범위 안이면 그것을 기준 URL로.
- **범위**(`scope-match.ts`): 허용 호스트 ∧ (경로 접두 목록이 비었거나 하나와 일치) ∧ 제외 글롭 불일치 ∧ 깊이 ≤ `maxDepth`. 범위 밖 링크는 **행을 만들지 않고 개수만**(`outOfScopeLinks`). **[pass 6 — §25 I-71·I-72 · 사용자 설정 해석 변경]** 경로 접두는 **경로 세그먼트 경계**로 비교한다 — `/docs` = `/docs`·`/docs/…`만 · `/`로 끝나는 접두(`/docs/`) = 그 아래만 · `/docsecret`·`/docs-v2`·`/docs.html`은 범위 밖(이전 구현 = 문자열 접두). 비ASCII 경로·접두·제외 글롭은 퍼센트 인코딩 정준형으로 맞춰 비교한다. `outOfScopeLinks`에는 비대상 형식 링크도 합산된다(아래 형식 판정).
- **글롭**(`glob-match.ts`): `*`(임의 문자열)·`?`만 지원하는 선형 매처 — **정규식을 받지 않는다**(관리자 입력 정규식의 ReDoS 방지 — R-13). 잡음 제거 패턴도 같은 매처로 "줄 전체 일치" 시 그 줄을 해시 대상에서 뺀다. **[pass 7 — §25 I-84 · N-13]** 경로 글롭(제외 패턴)은 정준형 경로를 **문자 단위**로 쪼개 매칭한다(`path-canon.ts` `splitPathUnits`·`globMatchPath`) — `?`는 한글 1자(정준형 `%XX` 3개)·`%2F`를 각각 1단위로 맞춘다(이전: 바이트 1개로 봐 `/규?` 같은 패턴이 한글과 맞지 않았다).
- **형식 판정**: 응답 `Content-Type` **그리고** 확장자 둘 다(FR-KB2-3). `text/html`·`application/xhtml+xml` = HTML · `application/pdf` + `.pdf` · OOXML 3종 MIME + 확장자 · 그 밖(이미지·동영상·압축·HWP·`.doc/.xls/.ppt` 구형 바이너리) = `TYPE` 제외. 링크 단계에서 확장자로 명백한 비대상(`.jpg`·`.zip`·`.hwp` 등)은 **요청하지 않는다**. [pass 6 구현 — §25 I-72②: `followLinks()`가 `detectKind()` = null(비대상 확장자·소스 `fileTypes` 밖 형식)이면 행을 만들지 않고 요청하지 않는다 · 그 수는 `outOfScopeLinks`에 합산]
- 소스의 `fileTypes`에 없는 문서 형식 = `TYPE` 제외. `allowRawFileIngest=false`인 소스의 문서 파일은 **내려받지 않고** `RAW_FILE_OFF`로 목록에만 남긴다(미리보기에 표시 — S-5). **[pass 5 해소 — §25 I-54: 페이서·robots 앞에서 요청 없이 `EXCLUDED(RAW_FILE_OFF)`]**

### 6.8 속도 제한 (FR-KB2-5 · P-10)

- `kb-host-pacer.ts`: 호스트별 "다음 요청 가능 시각"(인스턴스 메모리). 간격 = max(소스 `minIntervalMs`(하한 500ms), robots `Crawl-delay`) — [pass 7 — §25 I-75] 서버 실효 상한 300초로 클램프(`lib/crawl-limits.ts` `MAX_HOST_INTERVAL_MS`). **호스트당 동시 연결 1**. **[pass 12 — §25 I-104]** 페이서·중단 호스트(`abortedHosts`)·429/503 연속 횟수는 **호스트 이름** 단위 그대로다 — 같은 호스트의 다른 포트(둘 다 허용 출처일 때)는 간격을 공유하고, 한 포트의 robots 실패가 그 호스트 이름 전체를 이번 실행에서 중단시킨다(보수적 방향 · robots 규칙 자체는 출처 단위 — §6.5 · 크롤 시작 게이트의 호스트 겹침 판정도 호스트 이름 기준이라 같은 호스트의 다른 포트를 쓰는 소스끼리는 동시에 크롤하지 않는다).
- **호스트가 겹치는 소스는 동시에 크롤하지 않는다**: 스케줄러가 실행 선점 시 진행 중인 크롤 실행들의 `allowedHosts`와 교집합이 있으면 이번 tick에는 시작하지 않는다 — 다중 인스턴스·다중 소스에서 같은 호스트에 두 배 속도로 가는 것을 막는다(K-5 완화). **[pass 6 해소 — §25 I-67·I-68 · §25.3 B안 채택 · 이전 §25.2 RG-17·RG-18]** 판정 시점을 **크롤 시작 순간**(QUEUED → CRAWLING 전이 · `claimCrawlLease()`)으로 옮겼다 — 허용 호스트가 겹치는 다른 소스의 CRAWLING 실행이 있거나 더 먼저 만든(`createdAt`) 겹침 QUEUED 실행이 있으면 시작하지 않고(FIFO), 전이 CAS 뒤 사후 확인에서 경합이면 QUEUED로 되돌린다. 예약·수동 실행·적재 승인 세 경로와 다중 인스턴스가 같은 규칙을 받는다(스케줄러 사전 필터는 유지 · 대기 실행은 콘솔에 "대기 중"). 페이서가 준비되지 않았을 때 남은 지연이 이 실행의 조각 기한 안이면 조각 안에서 기다린다(`msUntilReady`·`sleep` — 중지 요청 확인) · tick이 크롤 예산(30초 − 적재 몫 5초)을 처리 중 실행 수로 나눠 실행별 기한을 주고 일찍 끝난 몫은 뒤 실행이 이어 쓴다. 요청 훅은 페이지·리다이렉트 홉·robots.txt 요청 모두에 걸린다(사이트맵 요청은 페이싱하지 않음 — 기존 · §25.4 RG-22③).
- 요청 타임아웃 `KB_CRAWL_TIMEOUT_MS`(기본 15초) · 파일 = ×4(~~최대 60초~~ → 기본값에서 60초 · 상한 없음 — `KB_CRAWL_TIMEOUT_MS` 최대 60,000이면 240초 · §3.5 교차 검사). **[pass 7 — §25 I-78 · N-4]** 크롤 단계 파일 요청도 ×4를 적용한다(이전: 크롤은 ×1 — 적재와 달랐다) · 리다이렉트 홉마다 그 홉 URL의 종류로 정한다.
- 429·503 응답은 그 URL을 실행 안에서 1회 재시도(간격 ×4 또는 `Retry-After` — 최대 60초)하고, 호스트 연속 5회면 그 호스트를 중단(`abortedHosts`). **[pass 5 해소 — §25 I-51: 지연 = `Retry-After` 또는 간격×4(하한 정상 간격 · 상한 60초) · tick은 기다리지 않고 문서를 QUEUED로 남긴다 · 재시도 여부·연속 횟수는 인스턴스 메모리, 중단 호스트는 실행 행(I-50)]** **[pass 7 — §25 I-75]** 429·503 지연 = max(정상 간격, `throttleDelayMs`) — 정상 간격(클램프 후 최대 300초)이 60초를 넘는 호스트에서 지연이 정상 간격보다 짧아지던 결함 수정.

### 6.9 인증 헤더 (P-2 · FR-KB1-5)

- `STATIC_HEADER`: 헤더 이름(`^[A-Za-z0-9-]{1,64}$` · `Host`·`Cookie`·`Content-Length`·`Transfer-Encoding`·`Connection`·`Proxy-*` 금지) + 비밀 참조 이름(`authSecretRef`). 값은 `KB_SECRET__<REF>` 환경변수에서 `kb-secret.resolver.ts` **1파일**만 읽는다(No.26·No.41 규약 — KB-11). 없으면 실행 `FAILED(SECRET_MISSING)`(기동 실패 아님).
- **헤더는 소스 `allowedHosts`로 가는 요청에만** 붙인다 — 리다이렉트가 다른 허용 호스트로 가도 **시작 주소와 같은 호스트일 때만** 붙인다(자격증명 누출 방지). **[pass 10 — §25 I-96 · 이전 §25.5 RG-24①]** 리다이렉트 홉에서 "같은 호스트" = 호스트 이름 + 포트(스킴 기본 포트 정규화 후 — `isSameHostPort()`)다 — 같은 머신의 다른 포트 서비스로는 자격증명을 싣지 않는다(`http→https` 상향은 유지). ~~[잔여 — §25.6 RG-26②] 첫 요청(홉 0)의 헤더 판정은 여전히 `allowedHosts`(호스트 이름) 기준이라, 링크로 발견한 같은 호스트 다른 포트 URL(`https://a:8443/x`)의 첫 요청에는 헤더가 실린다.~~ **[pass 12 해소 — §25 I-104]** 크롤 `applyAuthHeader`·적재 `applyAuth`가 같은 순수 함수 `canSendAuthTo(origins: AuthOrigins, url, startUrl?)`(pass 12 당시 시그니처 `(allowedOrigins, url, startUrl?)` → pass 13에서 `AuthOrigins = { allowedOrigins, plainHttpOrigins }` 필수 두 필드로 변경 — §25 I-107)를 쓴다 — 첫 요청은 허용 출처(시작 주소·사이트맵이 명시한 host:port)와 **정확히 일치**할 때만, 홉(≥ 1)은 여기에 더해 이 문서의 시작 URL과 같은 host:port(`isSameHostPort` — pass 10)여야 한다(허용 출처가 여럿이어도 리다이렉트로 자격증명을 다른 출처로 옮기지 않는다). 시작 주소에 포트가 없으면 그 스킴의 기본 포트만 · `http→https` 상향은 같은 출처(https→http 하향 리다이렉트는 §6.4에서 거부). robots.txt·사이트맵 파일 요청에는 싣지 않는다(`headersFor: () => ({})`). ~~[잔여 — §25.7 RG-28] 출처 비교가 스킴을 보지 않아(`URL.host`), `https://` 시작 주소 소스의 페이지·사이트맵이 같은 호스트의 `http://` URL을 내놓으면 그 첫 요청(평문)에 헤더가 실린다(하향 리다이렉트는 거부되므로 링크·사이트맵 경로만 해당).~~ **[pass 13 해소 — §25 I-107 · RG-28] 현재 규칙** — `canSendAuthTo(origins, url, startUrl?)`의 판정 3단계(첫 요청·홉 공통): ① 요청 URL의 host:port가 허용 출처(`allowedOrigins` · 스킴 무관)가 아니면 거부 ② 홉(≥ 1)이면 이 문서의 시작 URL과 같은 host:port(`isSameHostPort`)여야 한다 ③ 요청 URL이 `http:`(평문)이면 그 host:port가 **평문 허용 출처** `plainHttpOrigins`에 있어야 한다 — 집합 = 시작 주소(`seedUrls`)·소스에 등록한 사이트맵 URL 중 `http:`로 등록된 URL의 host:port(`lib/allowed-origins.ts` `computePlainHttpOrigins(seedUrls, sitemapUrls)` · 저장하지 않고 `parseSourceRow()`가 실행 시점마다 계산 → `ParsedSourceConfig.plainHttpOrigins`). 홉에서 시작 URL이 `https:`인데 요청이 `http:`(하향)면 평문 출처가 명시돼 있어도 **무조건 거부**한다(설계에 없던 이중 방어 — 하향 리다이렉트는 §6.4가 이미 거부하므로 동작 변화 없음). `https:` 요청은 종전 그대로 — `http→https` 상향은 유지(시작 `http://a/` → 홉 `https://a/`에 헤더 · `https:`로만 등록한 소스가 링크로 발견한 `http://a/x`가 `https://a/x`로 리다이렉트되면 홉 1에 헤더). 정책: 사이트맵 파일 안 `<loc>`이나 페이지 링크로 발견한 `http:` URL은 "명시"로 치지 않는다 · 명시는 그 host:port에 한정(`http://a/` 명시가 `http://a:8080/`을 허용하지 않음) · `https:`만 명시한 출처의 `http:` URL은 범위 안이라 수집될 수 있으나 헤더는 없다(§20 K-28 ②). **범위 판정(`isAllowedOrigin`·`isInScope`)과 `computeAllowedOrigins`(반환 `string[]` · 스킴 무관)는 바꾸지 않았다.** `AuthOrigins`의 두 필드는 모두 필수다(선택 필드면 빠뜨렸을 때 헤더가 나가는 쪽으로 조용히 실패한다 — `ParsedSourceConfig`·크롤 `SourceConfig`가 그대로 만족). 소스 인증 헤더를 붙이는 곳은 크롤 `applyAuthHeader`(첫 요청·홉)·적재 `applyAuth`(첫 요청·홉)의 `KbSecretResolver.get` 호출 두 곳뿐이고 둘 다 `canSendAuthTo`만 거친다(크롤 시작 때 비밀 존재를 확인하는 `get` — `SECRET_MISSING` — 은 헤더를 만들지 않는다) · robots.txt·사이트맵 파일 요청은 `headersFor: () => ({})`(통합 시험 `kb-crawl-pass13` (b)가 확인). 스키마·계약·마이그레이션·환경변수 변경 0.
- 헤더 값은 로그·오류·응답·감사·실행 이력·데이터 지도 어디에도 없다(KB-11 · KB-15 · AC-KB6-4).

---

## 7. 문서 해석 (라이브러리 · 샌드박스 · 한도)

### 7.1 라이브러리 선정

| 용도 | 채택 | 기각 | 근거 |
|---|---|---|---|
| HTML 본문·링크·메타 | **`htmlparser2`**(MIT · 스트리밍 SAX · 스크립트 실행 없음 · cheerio의 하부 파서) | `jsdom`(스크립트 실행 옵션·수십 MB·보안 면적) · `cheerio`(의존성 다수 — 필요한 것은 파서뿐) · `@mozilla/readability`(DOM 필요 → jsdom 동반) · `parse5`(명세 준수지만 DOM 트리 메모리 — 2MB 페이지에 불리) | 원문 DOM을 만들지 않고 이벤트 1패스로 본문·링크·메타·제목을 뽑는다 |
| 사이트맵 XML | **`htmlparser2` `xmlMode`** + DOCTYPE/ENTITY 거부 | `xml2js`·`fast-xml-parser`(엔티티 처리 옵션 실수 위험) · Node 내장 없음 | 같은 파서 1벌 · XXE 원천 차단 |
| OOXML(DOCX·XLSX·PPTX) 텍스트 | **`fflate`**(MIT · 의존성 0 · 스트리밍 `Unzip` — 항목별 해제 바이트를 세며 중단 가능) + 자체 XML 텍스트 추출(`word/document.xml`·`ppt/slides/slide*.xml`·`xl/sharedStrings.xml`+`xl/worksheets/sheet*.xml` 인라인 문자열) | `mammoth`(DOCX 전용·무거움) · SheetJS `xlsx`(npm 0.18.5 고정 — 수정판 미배포 CVE · ADR-0007 기각) · `exceljs`(이미 의존성이지만 통째 적재 — 해제 상한 통제 불가) · `officeparser`(PDF 포함 다수 의존성) | 압축 폭탄을 해제 **도중** 멈출 수 있는 것이 조건 |
| PDF 텍스트 | **`pdfjs-dist`**(Apache-2.0 · Mozilla · legacy Node 빌드 · **≥ 4.2.67**) · `isEvalSupported: false` · `disableFontFace: true` · `useSystemFonts: false` · 패키지 동봉 CMap(한글 CID) | `pdf-parse`(2018년 pdf.js 1.10 번들 · 유지보수 중단 · 알려진 취약점) · `pdf2json`(유지보수 약함) · 외부 프로세스(`pdftotext`)(구축형 설치 의존성) | CVE-2024-4367(글꼴 처리 중 임의 JS 실행)은 4.2.67에서 수정 + `isEvalSupported:false`로 이중 차단 |
| DOCX 생성(HTML 변환) | **`fflate.zipSync`** + 자체 최소 OOXML | `docx`(npm — 기능 과잉·수백 KB) | 4파트 고정 XML이면 충분 · 결정적 바이트 |
| gzip 사이트맵 | ~~Node 내장 `zlib.gunzipSync({ maxOutputLength })`~~ → 구현: `fflate` `Gunzip` 스트리밍 + 해제 바이트 실시간 계수(`lib/gzip-guard.ts` — §25 I-20 · 작업 스레드 안 — I-42) | — | 추가 의존성 0(`fflate` 재사용) |
| 문자 인코딩 | Node 내장 `TextDecoder`(full-icu — `euc-kr`·`cp949` 레이블 지원) | `iconv-lite` | 의존성 0 |

- 신규 의존성 **3개**(`htmlparser2`·`fflate`·`pdfjs-dist` — 구현 버전: `htmlparser2` **^9.1.0 고정**(v12는 ESM 전용 — §25 I-2) · `fflate` ^0.8.3 · `pdfjs-dist` **4.2.67**(legacy 빌드는 순수 ESM이라 `common/lib/import-esm.ts` 경유로 로드 — §25 I-1) · `pdfjs-dist`의 선택 의존성 `canvas`는 `pnpm-workspace.yaml`에서 빌드 스크립트 차단 — §25 I-3) — 전부 순수 JS(네이티브 빌드 0 → 기동 전제 네이티브 의존성 금지 원칙 준수). `pdfjs-dist`만 설치 크기가 크다(수십 MB) — 구축형 패키지 크기 영향은 보고 U-2.
- **문서 파일 텍스트 추출의 용도**(원본 파일은 바이트 그대로 보내므로 추출 텍스트는 **보내지 않는다**): ① 원본 파일 전달이 켜진 소스의 **개인정보 사전 검사**(건수 — 미리보기·실행 요약 · 거버넌스 ON이면 1건 이상인 파일 제외 — R-17) ② 제목 추출 ③ 텍스트 0(스캔 PDF) 경고 ④ 축소 감지 보조(`textLength`). 원본 파일 전달이 꺼진 소스는 파일을 내려받지 않으므로 추출도 0이다. **[pass 5 — §25 I-55: ① 개인정보 사전 검사와 §7.3 컨테이너 한도·매크로·암호 검사는 크롤 방문·적재 재수집 두 곳에서 집행된다 · ② 파일 제목 추출 · ③ 스캔 PDF(텍스트 0) 경고는 미구현(§25.2 RG-11 잔여) · ④ 파일의 축소 판정은 `byteSize`만 쓴다(`textLength` = 0 — I-53)]**

### 7.2 샌드박스 — 작업 스레드 (R-16)

- **모든 해석·해시·마스킹·변환은 `worker_threads` 작업 스레드 1개**에서 한다(인스턴스당 1 · 요청 직렬 큐). 메인 스레드는 네트워크·DB만 — 2MB HTML 파싱·20MB 해시(sha256)·PDF 해석이 **공개 대화의 이벤트 루프를 막지 않는다**(NFR-KBP1).
- `resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, codeRangeSizeMb: 16, stackSizeMb: 4 }` — 초과 시 스레드가 죽고 그 문서는 `FILE_UNSAFE` 제외, 스레드는 재생성된다.
- **작업별 시간 상한 30초**(HTML 5초) — 초과 시 `worker.terminate()` → `FILE_UNSAFE` · 재생성. 200작업마다 예방 재생성(메모리 조각화 방지).
- 입력 바이트는 `ArrayBuffer` **이전(transfer)** 으로 넘겨 복사하지 않는다. (구현: 사이트맵 응답은 `Buffer` 풀 공유 때문에 복사본 1개를 만들어 그 복사본을 이전한다 — §25 I-42) 결과는 `{ normalizedText?, title, links[], meta, contentHash, textLength, piiMaskedCount, ingestBytes?, flags }` — 원문 텍스트는 적재용 변환 바이트(`ingestBytes`)로만 돌아오고 메인은 곧바로 외부 RAG로 보낸 뒤 참조를 버린다(디스크 임시 파일 0 — FR-0-210).
- 작업 스레드 코드는 `kb-sync/lib`의 순수 함수만 import한다 — Prisma·Nest·네트워크 모듈 import 0(KB-16). 스레드 안에는 `eval`·`new Function`·`vm` 0.
- 시험: `KB_EXTRACTOR` 토큰에 `InProcessExtractor`(같은 순수 함수 직접 호출)를 주입한다(ts-jest가 `.ts` 작업 스레드를 띄우지 못하는 문제 회피). 운영 구현의 스레드 경로는 빌드 산출물(`dist`)이 있을 때만 도는 스모크 시험 1개로 확인한다(없으면 건너뜀 — 시험 결과는 순수 함수 시험이 보장).
- **구현(§25 I-13)**: `KB_EXTRACTOR`의 모듈 DI 기본값은 개발·운영 구분 없이 `WorkerThreadExtractor`다. 작업 스레드 진입점은 `__dirname/extract.worker.js`이고 없으면 경로의 `src`를 `dist`로 바꾼 후보를 쓴다 — 따라서 **dev(`ts-node-dev`)·ts-jest에서도 최초 1회 `pnpm build`가 필요**하다. 둘 다 없으면 인프로세스로 조용히 대체하지 않고 `WorkerEntryMissingError`를 던진다. `KB_SYNC_ENABLED=true`면 부팅 때 `checkAvailability()`(스레드를 띄우지 않고 진입점만 확인)를 호출하고 실패하면 오류 로그 후 루프를 시작하지 않는다(§9.1). 통합 spec은 `overrideProvider(KB_EXTRACTOR)`로 `InProcessExtractor`를 쓴다.

### 7.3 한도 · zip bomb 방어

| 대상 | 한도 | 초과 시 |
|---|---|---|
| HTML 응답 | 2MB(스트림 중단) · 추출 텍스트 1MB(잘라냄 + 표식) · 링크 2,000개/쪽 | `SIZE` 제외(응답) · 잘라냄(텍스트) |
| 파일 응답 | 소스 `maxFileBytes`(기본 20MB · 서버 상한 `KB_CRAWL_MAX_FILE_BYTES`) · `Content-Length` 선검사 | `SIZE` 제외 |
| OOXML 컨테이너 | 항목 ≤ 2,000 · 항목 해제 ≤ 50MB · **전체 해제 ≤ 100MB** · **압축비 ≤ 100:1**(항목·전체) · 중앙 디렉터리 선언 크기를 믿지 않고 해제 바이트를 실시간 계수 · 경로에 `..`/절대경로/NUL 있는 항목 = 불합격 | `FILE_UNSAFE` 제외 |
| OOXML 내용 | `vbaProject.bin`(매크로) 포함 = `FILE_UNSAFE` · OLE2 서명(`D0 CF 11 E0` — 암호화 OOXML·구형 바이너리) = `FILE_ENCRYPTED`/`TYPE` · XML에 `<!DOCTYPE` = `FILE_UNSAFE` | 제외 |
| PDF | 헤더 `%PDF-` 확인 · 트레일러의 `/Encrypt` = `FILE_ENCRYPTED`(EX-KB-9 — 외부로 보내 실패시키지 않고 미리 제외) · 쪽 ≤ 300 해석(그 이상은 앞 300쪽만 검사 — 파일 자체는 그대로 전송) · 추출 텍스트 2MB | 제외 / 부분 검사 |
| 사이트맵 | 압축 10MB · 해제 50MB · 파일 50개 · DOCTYPE/ENTITY 거부 | 그 사이트맵 무시 |
| 작업 스레드 | 힙 192MB · 작업 30초 | `FILE_UNSAFE` · 재생성 |

- 메모리 예산(NFR-KBP2): 메인 스레드 동시 버퍼 ≤ 2 × 파일 상한 + 작업 스레드 힙 192MB — 기본값 기준 약 240MB 이하.
- **[pass 6 — §25 I-65]** 압축 해제(OOXML `safeUnzipEntries()` · gzip `safeGunzip()`)는 입력을 **4KB 조각**으로 밀고 조각마다 한도 위반을 확인해 멈춘다(`lib/push-in-chunks.ts`) — fflate 동기 스트림은 `terminate()`가 없고 한 번의 `push()`가 받은 입력을 끝까지 해제하므로 "위반 표식 후 return"으로는 폭탄을 멈출 수 없었다. 조각 크기는 실측(64KB 조각 = 조각당 출력 최대 약 67MB · 16KB = 17MB · 4KB ≈ 4.2MB)으로 정했고 위반 시 한도 + 8MB 이내에서 중단된다. PDF는 추출 텍스트 누적 2MB · 쪽당 텍스트 조각 20만 개 상한(`takeWithinBudget()`). pdf.js 내부 자원(스트림 팽창 등)은 §20 K-17.
- **[pass 7 — §25 I-82 · N-9]** 원본 파일 사전 검사(`inspectRawFile(…, { governanceOn })`)는 결과에 `truncated`(PDF 300쪽 초과 · 추출 텍스트 2MB 초과로 **일부만 검사**)를 싣는다. **거버넌스 ON ∧ truncated면 `FILE_UNSAFE`로 제외**한다(크롤·적재 동일) — 검사하지 못한 부분에 개인정보가 있어도 원본은 마스킹 없이 나가기 때문이다(R-17 보수 적용). 거버넌스 OFF는 종전대로 부분 검사 후 전송(위 표 "파일 자체는 그대로 전송").

### 7.4 HTML 본문 추출 (FR-KB2-8)

- 제거 요소: `script`·`style`·`noscript`·`template`·`svg`·`iframe`·`object`·`embed`·`canvas`·`nav`·`header`·`footer`·`aside`·`form`·`button`·`select` · `role=navigation|banner|contentinfo|search` · `hidden` 속성 · `aria-hidden="true"` · 주석.
- 본문 영역: `<main>` 또는 `role=main` 또는 `<article>`(하나)이 있으면 그 안만 · 없으면 `<body>`에서 위 요소를 뺀 나머지.
- 구조 보존: `h1~h3` → 제목 표식(DOCX 제목 스타일) · `h4~h6` → 굵은 문단 · `p`·`div` 블록 경계 → 문단 · `li` → 목록 · `table` → 행 단위 " | " · `br` → 줄바꿈 · 연속 공백 축약.
- 제목 = `<title>`(사이트 공통 접미 " - 사이트명"은 모든 페이지에 같은 접미가 반복되면 제거) → 없으면 첫 `h1`.
- 추출 텍스트 < 200자 = `NO_BODY`(SPA 감지 — 실행 요약에 "화면을 스크립트로 그리는 사이트로 보임" 안내 · EX-KB-6).
- **자바스크립트 실행 0** · 외부 리소스(CSS·이미지·iframe) 요청 0.

### 7.5 인코딩 (FR-KB2-9 · EX-KB-10)

`charset.ts`(순수): ① `Content-Type` `charset` → ② BOM → ③ 앞 4KB의 `<meta charset>`/`http-equiv` → ④ UTF-8. `TextDecoder(label, { fatal: false })`로 해석한 뒤 **대체 문자(U+FFFD) 비율 > 2%**면 UTF-8로 한 번 더 · 여전히 높으면 `ENCODING` 제외. `euc-kr`·`ks_c_5601-1987`·`x-windows-949`는 `euc-kr` 디코더(WHATWG가 CP949 상위 집합으로 매핑)로 처리.

---

## 8. 변경 감지 · 삭제/축소 감지 (J-9 · J-10 · FR-KB3)

### 8.1 판정 (순수 함수 — 시계·DB 무의존)

```
decideChange(prev: { contentHash?, ingestFingerprint?, textLength?, byteSize?, lastIngestedAt? },
             observed: { contentHash, fingerprint, textLength?, byteSize? })
  → { change: 'NEW' | 'CHANGED' | 'UNCHANGED', shrunk: boolean }
```

1. **조건부 요청**: 문서에 `etag`/`lastModified`가 있으면 `If-None-Match`/`If-Modified-Since` → **304 = UNCHANGED**(본문 미수신 · 작업 스레드 0).
2. **200**이면 작업 스레드가 해시: HTML = 정규화 본문(잡음 줄 제거 · 공백 정리 · 머리 줄 제외 · **마스킹 전**)의 sha256 · 파일 = 바이트 sha256.
3. `prev.contentHash` 없음 = NEW · 다름 = CHANGED · 같음 = UNCHANGED.
4. **지문**: `ingestFingerprint = sha256(contentHash | CONVERSION_RULES_VERSION | 형식 | piiMask | PII_MASK_MODE)` — 해시가 같아도 지문이 다르면 **CHANGED**(마스킹 강도·변환 형식·변환 규칙이 바뀌면 자동 재적재 — R-25).
5. **축소**: CHANGED ∧ (`textLength` < 이전 × 0.5 또는 파일 `byteSize` < 이전 × 0.5) ∧ 이전에 적재됨 → `shrunk = true` → 적재 **하되** `cleanupReason = SHRUNK`(FR-KB3-6 · AC-KB3-5). **[pass 5 해소 — §25 I-53: 판정 위치는 크롤 단계가 아니라 적재 성공 시점 `succeedJob()`(순수 `isShrunk()`) — 크롤 단계의 `decideChange().shrunk`는 쓰지 않는다]**

### 8.2 검증자·해시 갱신 규칙 (R-24 — 304 함정 방지)

`etag`·`lastModified`·`contentHash`·`ingestFingerprint`·`textLength`·`byteSize`는 **"마지막으로 외부 RAG에 성공 적재한 내용"의 값**이다. 따라서:
- 갱신 시점은 ⓐ 그 문서의 적재 작업 `SUCCEEDED`(작업이 들고 있던 값으로) ⓑ 크롤에서 UNCHANGED 판정(해시·지문 동일 확인 — 새 검증자만 갱신) 두 가지뿐이다.
- 감지만 하고 적재하지 않은 경우(PREVIEW · 적재 실패 · 강등)에는 갱신하지 않는다 — 그래야 다음 실행이 **304로 속지 않고** 다시 "바뀜"을 본다(AC-KB3-6).

### 8.3 삭제 감지 (FR-KB3-5 · EX-KB-4 · AC-KB3-4)

`nextMissingState(prev, observation, crawlComplete)` — 관측 = `SEEN_OK`(200·304) · `GONE_HTTP`(404·410) · `NOT_REDISCOVERED`(사이트맵·링크 어디에도 없음) · `TRANSIENT`(5xx·타임아웃·네트워크) · `ROBOTS_BLOCKED`.

| 관측 | 결과 |
|---|---|
| `SEEN_OK` | `missingStreak = 0` · `state = ACTIVE`(GONE에서 복귀 시 `cleanupReason = GONE`도 해제) — [pass 5 해소 — §25 I-57] 200(HTML·파일)·304 경로 모두 GONE만 해제하고 다른 정리 사유는 보존(`markVisited`의 `cleanupReason`: `undefined` 유지 · `null` 해제 · 문자열 = 그 값) |
| `GONE_HTTP` · `NOT_REDISCOVERED` | `missingStreak + 1` · **2 이상**이면 `state = GONE` · 이전에 적재됐으면 `cleanupReason = GONE`, 적재된 적 없으면 **행 삭제** |
| `TRANSIENT` | 변화 없음(삭제로 세지 않음) |
| `ROBOTS_BLOCKED` | `state = EXCLUDED`(`ROBOTS`) · 이전에 적재됐으면 `cleanupReason = ROBOTS_DISALLOWED` |

- **`NOT_REDISCOVERED`는 다음 조건을 모두 만족하는 실행에서만 센다**(R-21): 종류가 `SYNC`·`FULL_RESEND`(PREVIEW는 세지 않음 — 미리보기·동기화가 겹쳐 두 번 세는 것 방지) ∧ `maxPagesReached = false` ∧ 문서 호스트가 `abortedHosts`에 없음 ∧ 실행이 CANCELLED가 아님 ∧ **[pass 9 — §25 I-90 · L-1] 이번 실행이 자동 강등되지 않음**(강등 판정을 스윕보다 먼저 하고 강등이면 스윕을 건너뛴다 — `AUTH_WALL`·`NEW_RATIO` 모두 · 신뢰할 수 없는 크롤이 적재 문서의 `missingStreak`·요약 `missing`을 오염시키지 않게) ∧ **[pass 5 — §25 I-49] 시작 주소 도달(`seedReached`)** — 깊이 0 행(시작 주소 + 사이트맵 URL)이 전부 실패면 스윕 없이 `FAILED(ALL_SEEDS_UNREACHABLE｜ROBOTS_UNREACHABLE)`. 재종결 시 스윕 멱등을 위해 실행 시작(`startedAt`) 뒤 바뀐 행은 대상에서 뺀다(I-52). **[pass 6 — §25 I-63·I-70·I-72]** 시작 주소 판정은 세 표식(`seedReached`·`seedFailed`·`seedNeutral`) — 도달이 없고 (실패가 있거나 중립도 없을 때)만 미도달(요청 없이 제외한 `RAW_FILE_OFF`는 중립). 링크를 이번 실행에서 확인하지 못한 부모(304 · 전송 오류·비2xx·재시도 소진 · robots 차단 · `SIZE` · 추출 예외 · 범위 밖 리다이렉트 · 중단 호스트)의 지난 자식은 크롤 중 이어 방문(`carryChildren` — `discoveredFromId`)하므로, 스윕에 남는 것은 실제로 어디서도 발견되지 않은 문서다. 의도적 nofollow와 404·410 부모의 자식은 이어 넣지 않는다(미발견으로 셈). 한계: 부모 포인터는 1개(§20 K-15) · 도입 전 행(K-16). 재종결 시에는 첫 종결이 저장한 스윕 몫(`counts.sweep`)을 이어받고 다시 스윕하지 않는다. **[pass 7 — §25 I-80 · N-7]** 이어 방문(`carryChildren`)은 **GONE 자식을 뺀다**(부모가 304일 때마다 이미 사라진 문서를 다시 요청하지 않게) — 삭제 카운트 중인 자식(ACTIVE ∧ `missingStreak ≥ 1`)은 GONE이 될 때까지 계속 이어 방문한다. 부모가 200으로 그 링크를 다시 내놓으면 일반 발견 경로가 GONE 행을 QUEUED로 되돌리고, 200이면 ACTIVE로 복귀한다(RG-10 복귀 규칙).
- "정리 필요" = `cleanupReason ≠ null`인 문서(목록·배지·챗봇 카드 건수).

### 8.4 실행 가드 — 자동 강등 (EX-KB-5 · EX-KB-7)

`run-guards.ts`(순수 — 사유만 판정) — 크롤 종결 시 적용. **[pass 8 정정 — §25 I-85 · 적용 대상을 구현 기준으로 확정 · 이전 문구 "SYNC에만"은 폐기 · 판단 근거 §25.5 "§8.4 적용 대상 정리"]** **새로 비율 = 모든 종류 강등**(SYNC·FULL_RESEND·PREVIEW — PREVIEW의 강등 = 승인 해제 + 사유) · **인증 벽 = SYNC·FULL_RESEND는 강등, PREVIEW는 실행에 `demotedReason`만 기록하고 소스 승인 유지**:
- **새로 비율**: 실행 전 ACTIVE·적재됨 문서 수 `k ≥ 20` ∧ `added / k > 0.5` → `NEW_RATIO`(사이트 개편 의심). **[pass 10 해소 — §25 I-94 · 이전 §25.5 RG-23]** `k` = `countPreviouslyIngested()` = `state = ACTIVE ∧ lastIngestedAt ≠ null`(이 문언대로 — GONE·EXCLUDED 옛 URL 제외 · 종결 조각 시작 때 셈) · **승인으로 시작된 SYNC(실행 `trigger = APPROVAL` — `approveIngest`만 만든다)는 새로 비율 판정을 면제**한다(`RunGuardInput.approvedByUser` — 방금 사람이 미리보기를 보고 승인했다 · 인증 벽은 면제하지 않는다 · 다음 예약·수동 SYNC부터는 다시 적용). 판정 지점에서 이미 읽은 실행 행(`finishRow.trigger`)을 쓰므로 `runFragment` 시그니처·계약·스키마 변경 0(§25.5 권장안 "`runFragment`에 `trigger` 전달"과 방식만 다름). "첫 적재"(대량 레인) 판정은 분모와 분리해 `hasEverIngested()`(상태 무관 적재 이력)로 한다 — 문서가 전부 GONE이 된 소스를 "처음"으로 오판하지 않게. 잔여: 한 실행이 여러 조각에 걸치면 앞 조각에서 GONE → ACTIVE로 복귀한 문서가 `k`에 들어갈 수 있다(§20 K-26). **[pass 11 해소 — §25 I-99 · R6 M-A]** `k`는 실행의 첫 조각이 한 번 세어 실행 행 `counts` JSON의 내부 키 `priorActiveIngested`에 고정하고(`KbRunStore.fixPriorActiveIngested(sourceId, runId)` — 실행이 `CRAWLING`일 때만 기록) 이후 조각·인스턴스는 그 값을 쓴다 — 앞 조각에서 이 실행이 EXCLUDED(noindex·`NO_BODY`·robots·크기 초과)·GONE으로 바꾼 문서만큼 분모가 줄어 다중 조각 크롤에서 가드가 꺼지던 결함(K-26과 반대 방향이며 더 큰 쪽)을 없앴다. 새 컬럼·마이그레이션 0 · 종결 때 계약 키만 다시 써 종결 뒤 남지 않고 조회 응답(`parseCrawlCounts`)에도 실리지 않는다 · `hasEverIngested`(대량 레인 판정) 무관 · 이로써 문언 "실행 전 ACTIVE·적재됨"과 일치한다.
- **인증 벽**: 방문 HTML ≥ 10 ∧ 같은 `contentHash`를 가진 문서가 방문 HTML의 80% 이상 → `AUTH_WALL`(로그인 페이지로 수렴 의심). **[pass 8 해소 — §25 I-85 · 이전 §25.4 RG-21]** 판정 입력을 **실행 전체의 DB 분포**로 바꿨다 — HTML 본문을 추출한 모든 경로(NEW·CHANGED·UNCHANGED·`NO_BODY`·`NOINDEX`)가 행의 `observedHash`에 정규화 본문 해시를, 리다이렉트 원래 행이 `R:`+최종 URL 해시를, 범위 밖 리다이렉트 행이 `X:`+목적지 **호스트+경로** 해시를 남기고(스킴 하향은 목적지가 없어 기록 없음), 종결 때 `store.countObservedHashDistribution()`(이번 실행 · `kind = HTML` · `observedHash` 있음 — `count` + `groupBy` 최빈 1)로 분모(관측 해시를 남긴 HTML 행 수)·분자(최빈 수)를 구한다. ~~파일 행·304·오류 행은 분모에서 빠진다(이전 분모 `visitedHtml`은 304·제외 행까지 셌다).~~ **[pass 9에서 분모·지문 규칙 재정의 — 바로 아래 "인증 벽 — pass 9 재정의" 항목이 현재 규칙]** 임계(≥ 10쪽 ∧ ≥ 80%)는 불변. `X:`를 호스트만이 아니라 호스트+경로로 한 것은 권장안(호스트만)과의 **의도된 편차**다 — 문서들이 새 도메인의 서로 다른 경로로 이사한 정상 경우를 "한 곳으로 수렴"으로 오판하지 않게(SSO는 문서마다 `?next=`만 달라 같은 경로로 모인다). 한계는 §20 K-20.
- **인증 벽 — [pass 9 재정의 · §25 I-89 · R5 H-1 · 현재 규칙]** 지문 규칙은 순수 `lib/observed-hash.ts` 한 곳에 둔다. ① **본문 지문**(접두 없음 · 정규화 본문 sha256): 본문이 비면(공백뿐 포함) **남기지 않는다**(이미지·iframe 전용·빈 SPA 셸이 전부 `sha256('')`로 같아지던 충돌 제거) — `NO_BODY`라도 짧지만 비어 있지 않은 텍스트면 남긴다 ② **리다이렉트 원래 행**: 최종 목적지 URL에 로그인 신호가 있으면 `RL:`+최종 URL 해시(분포에 셈), 없으면 `R:`+해시(**분포의 분자·하한에서 제외** — 정상 통합·개편 리다이렉트 `/v1/*` → `/latest/`를 벽으로 오판하지 않게 · 원래 행 표식으로만 쓰며 FULL_RESEND 대상 제외에 쓴다 — §9.8) ③ **범위 밖 리다이렉트 행**: 목적지에 로그인 신호가 있을 때만 `X:`+목적지 호스트(포트 포함)+경로 해시(쿼리 제외), 없으면 미기록 ④ **로그인 신호**(`hasLoginSignal()` — URL의 호스트+경로만 · 소문자 · 경로 퍼센트 디코딩): `login`·`logon`·`signin`·`sign-in`·`sign_in`·`log-in`·`log_in` = 부분 일치 · `sso`·`auth`·`oauth`·`oauth2`·`saml`·`saml2`·`cas`·`idp`·`adfs`·`okta`·`authenticate`·`authorize`·`signon` = 영숫자가 아닌 문자로 나눈 **토큰 일치**(`lesson`·`authors`·`casual`은 신호 아님). 추출기가 폼·비밀번호 입력 정보를 주지 않아 "200 로그인 폼" 신호는 쓰지 않는다 — 200 로그인 폼이 여러 URL에서 같은 본문이면 ①로 잡힌다 ⑤ **판정 입력**: `countObservedHashDistribution()` → `{ visited, hashed, max }` — `visited` = 이번 실행에서 방문한 HTML 행 **전체**(304·오류·제외·빈 본문·리다이렉트 원래 행 포함 — 변경 없는 정상 문서가 분포를 희석) · `hashed` = 판정용 지문(본문·`RL:`·`X:`) 행 수 · `max` = 판정용 지문의 최빈 수. `RunGuardInput` = `observedHtmlCount`(= visited)·`hashedHtmlCount`(신설)·`sameHashHtmlMaxCount` ⑥ **조건**: `hashedHtmlCount ≥ 10 ∧ max ÷ visited ≥ 0.8` → `AUTH_WALL`(적용 대상은 위 pass 8 정정 그대로 — SYNC·FULL_RESEND 강등 · PREVIEW 기록만 · 승인 SYNC도 면제 없음). pass 8의 분모(지문 있는 행만)는 증분 크롤에서 304 정상 문서가 빠지고 빈 본문 페이지가 분포를 지배해 오탐을 냈다. 한계(URL만 보는 로그인 신호 · 첫 크롤의 짧은 공통 문구)는 §20 K-20.
- **인증 벽 — [pass 11 보정 · §25 I-100·I-101 · R6 M-B·L-A · 현재 규칙 — 값 체계 전체는 §25.7 표]** ① **`RL:` 지문에서 쿼리 제거**: 원래 행의 로그인 목적지 지문 = `RL:` + 목적지 host+path 해시(`X:`와 같은 규칙) — 쿼리 허용 소스에서 `/login?next=/docs/pN`처럼 페이지마다 다른 return 파라미터가 붙어도 한 지문으로 모인다 ② **목적지 행 `RD:`(신설)**: 로그인 신호가 있는 목적지에 리다이렉트로 도달해 그 자리에서 기록된 목적지 행은 본문 해시 대신 `RD:` + host·path 해시를 남기고 **분포의 분자·분모·하한 어디에도 세지 않는다**(`countsTowardConvergence` = false · store는 "방문 HTML 행 전체 − `RD:` 행"으로 센다 — `NOT LIKE`가 NULL 행까지 떨구는 SQL 3값 논리를 피하려고 빼기로 계산). 원래 행(`RL:`)은 분자·분모에 센다 — 쿼리 허용 소스에서 원래 행 12 + 목적지 행 12가 분모를 이중으로 부풀려 벽이 0.48로 희석되던 문제 해소 ③ **분모 정의 변경**: "방문 HTML 행 전체"(pass 9) → "방문 HTML 행 − `RD:` 행"(조건 `hashed ≥ 10 ∧ max ÷ 분모 ≥ 0.8`은 불변) ④ **채택하지 않은 리뷰어 대안과 근거**: (가) 원래 행을 분모에서 빼는 안 — 작은 사이트에서 10쪽이 로그인으로 넘어가고 정상 5쪽이 있으면 분자 10 ÷ 분모 7이 1을 넘어 정상 사이트도 오탐 강등될 수 있다 (나) 원래 행에 목적지 본문 해시를 남기는 안 — 로그인 폼 본문에 return 값이 들어가 페이지마다 해시가 달라지면 수렴을 못 잡는다(시험 a2로 고정) ⑤ **로그인 신호(`hasLoginSignal`) 개정**(L-A): 짧은 토큰(`sso`·`auth`·`oauth`·`cas` 등 13어)은 경로 조각(`/`로 나눈 한 칸)·호스트 라벨 안의 단어 경계에서만 보고, 하이픈 등으로 이어진 조각에 문서성 단어(약 60개 사전 — guide·setup·studies·tutorial·docs·example·policy·design·blog 등 · `help`·`support`는 로그인 도움말 페이지 미탐을 피하려고 **사전에서 제외**)가 함께 있으면 신호로 보지 않는다(단독 조각 `/sso/…`·`/auth/callback`·`sso.example`과 문서 단어 없는 `/auth-callback`은 신호) · `signin`은 뒤에 `g`가 오면 제외(`designing`·`assigning` — 리뷰어 문언 "뒤에 영문자가 이어지면 제외"는 `/signinForm` 미탐이 생겨 불채택) · `sign-in`·`sign_in`·`log-in`·`log_in`은 앞에 영문자가 오면 제외(`design-in-practice`) · 부분 일치 목록 = `login`·`logon`·`로그인`·`로그온`·`j_spring_security_check`·`j_security_check`·`j_acegi_security_check` · 경로 `decodeURIComponent` 예외는 원문으로 폴백 ⑥ **시험으로 고정된 재현표**(`kb-crawl-pass11` M-B): 쿼리 허용 + 페이지별 `next` → `AUTH_WALL`(수정 전 null·INGESTING) · 본문에도 `next` → `AUTH_WALL` · 쿼리 미허용 → `AUTH_WALL` · 쿼리 허용 + `next` 없음 → `AUTH_WALL` · 쿼리 미허용 + 접두 `/login` → `AUTH_WALL` · 기존 기대 결과 유지: 옛 URL 12개 → 새 URL 통합(강등 없음) · 빈 갤러리 + 304(강등 없음) · `/docs/sign-in`으로의 수렴(강등). 잔여 오탐·미탐은 §20 K-20.
- 강등 = 적재 작업을 만들지 않고 실행 `SUCCEEDED` + `demotedReason` · 소스 `approvedConfigVersion = null` + `reviewRequiredReason` → 관리자가 이 실행 결과를 미리보기처럼 보고 다시 "적재 시작"을 눌러야 한다. **[pass 11 정정 — §25 I-102 · R6 L-B]** 승인(`approve-ingest`)에는 PREVIEW 실행만 넘길 수 있고, 소스에 `reviewRequiredReason`이 있으면 그 미리보기는 **강등을 만든 가장 최근 실행의 종료 시각 이후**에 끝난 것이어야 한다 — SYNC·FULL_RESEND가 강등했으면 새 미리보기(수동 또는 승인 해제로 PREVIEW가 된 다음 예약)를 본 뒤에야 승인되고, PREVIEW 자신이 NEW_RATIO로 강등했으면 그 미리보기로 곧바로 승인된다(동시각 통과 — RG-23 흐름 유지). 승인 SYNC가 새로 비율을 면제받으므로(pass 10) 옛 성공 미리보기 id로 방금 강등된 대량 적재를 새 결과를 보지 않고 통과시키는 경로를 막는다. `lastRunFinishedAt`을 기준으로 쓰지 않은 이유: 강등 뒤 새 미리보기가 소스의 마지막 실행이 되어 정상 흐름이 막힌다.
- **[pass 9 — §25 I-90 · L-1] 판정 순서**: 강등 판정은 삭제 감지 스윕(§8.3)보다 **먼저** 하고, 강등이면(`AUTH_WALL`·`NEW_RATIO` 모두) 스윕을 건너뛴다(PREVIEW는 원래 스윕 없음). 판정 입력(관측 분포 · 신규 수)은 `seenRunId = 실행` 행만 세고 스윕은 `seenRunId ≠ 실행` 행만 바꾸므로 순서를 바꿔도 판정값은 같다. **[pass 10]** 강등 뒤 관리자가 미리보기를 보고 승인하면 그 SYNC는 새로 비율을 면제받아 적재가 시작된다(RG-23 루프 해소 · EX-KB-5 "관리자 확인 요청" = 확인 뒤 진행).

---

## 9. 예약 · 실행 · 잡

### 9.1 루프 (`kb-sync.job.ts`)

- `PollingLoop({ name: 'kb-sync', intervalMs: KB_SYNC_INTERVAL_MS, onTick })` — **새 루프 1개**(FR-0-205) · `setInterval` 0 · `tick(signal)`은 public(시험이 직접 호출 — CLAUDE.md).
- `onApplicationBootstrap`: `KbJobLease` 행 보장 → `KB_SYNC_ENABLED`면 `loop.start()`(구현: 시작 전에 `KB_EXTRACTOR.checkAvailability?.()` — `WorkerEntryMissingError`면 **고정 문구** 오류 로그(오류 원문·서버 경로 없음 — KB-15 · §25 I-41)만 남기고 루프를 시작하지 않는다 · §25 I-13). `onModuleDestroy`: `loop.stop(30_000)` — 진행 중 요청 1개를 끝내고 멈춘다(FR-KB2-10). 임대는 해제하지 않고 만료에 맡긴다(다른 인스턴스가 이어받음 — 강제 종료와 같은 경로 1개).
- tick 예산 **30초**(코드 상수): 크롤 조각과 적재 단계가 나눠 쓴다. `signal.stopping()`을 요청 경계마다 확인한다.
- 기본 주기 10초(R-11 — 요구사항 60초): 조각 실행 구조에서 60초면 크롤 처리량이 절반 이하로 떨어지고 작업 조회 간격이 60초 이상으로 늘어난다. 유휴 비용은 쿼리 2개/10초.

### 9.2 소스 선점 · 실행 생성 (FR-KB5-1 · AC-KB5-2)

```
due = findMany({ where: { enabled: true, activeRunId: null, nextRunAt: { lte: now } }, orderBy: nextRunAt, take: 10 })
for s in due (호스트 겹침·병렬 상한 검사 후):
  runId = uuid()
  claimed = updateMany({ where: { id: s.id, activeRunId: null }, data: { activeRunId: runId, nextRunAt: 다음 발생 } })  // CAS
  if claimed.count === 1: create KbSyncRun(QUEUED, kind = 승인됨 ? SYNC : PREVIEW, trigger SCHEDULED)
```

- **소스당 동시 실행 1**은 이 CAS가 DB 수준에서 보장한다(두 인스턴스가 같은 tick에 와도 1건만 영향 행 1). 실행 행 생성과 CAS는 한 트랜잭션.
- 수동 실행(`POST …/runs`)·승인(`approve-ingest`)도 같은 CAS를 쓴다 — 이미 실행 중이면 `409 KB_SOURCE_BUSY`.
- 다음 발생 계산 `schedule-next.ts`(순수 · KST): `DAILY HH:mm` · `WEEKLY weekday HH:mm` · `MANUAL = null`. 서버가 여러 회차를 놓쳤으면 **1회만** 따라잡는다(misfire 누적 실행 없음).
- 크롤 임대: 실행 `claimToken`·`claimedAt`(URL마다 갱신) · 만료(`KB_SYNC_LEASE_MS`) 시 다른 인스턴스가 `updateMany({ where: { id, claimToken: 이전 } })`로 가져가며 `resumedCount + 1`. `kb-sync/core/kb-job-lease.ts`는 `GovernanceJobLease`와 같은 형식의 **별도 파일**이다(G-10 — `governance/**` import 0).
- **구현(§25 I-4·I-5·I-6·I-39)**: ① 소스 CAS 4종(`claimForRun`·`releaseActiveRun`·`demoteReview`·`approveConfigVersion`)과 선점·실행 생성 묶음 `claimAndCreateRun()`은 KB-9를 문자 그대로 따라 **`KbSourcesService`**가 가진다 — 스케줄러·크롤러·적재기·`KbRunsService`가 이 서비스를 호출한다. ② `kb-sync/core/kb-job-lease.ts`는 만들지 않았다 — 크롤 임대·적재 슬롯 임대·상태 행 CAS는 `kb-run.store.ts`에 있다(KB-9가 `kbJobLease` 쓰기 파일을 이 파일 1개로 고정). ③ **[pass 4 — I-39]** 스케줄러·수동 실행(`POST …/runs`)·적재 승인(`approve-ingest`) 세 경로 모두 `claimAndCreateRun()` 하나를 부른다 — `randomUUID()`로 만든 id로 **한 `$transaction` 안에서** `claimForRun(tx)` → (승인 경로만) `approveConfigVersion(tx)` → `KbRunStore.createRun({ id, … }, tx)`. 선점에 실패하면 `null`(승인 기록도 남지 않음 — 수동·승인 경로는 `409 KB_SOURCE_BUSY`). 트랜잭션 안에서는 `tx`만 쓴다(SQLite 단일 연결 — `this.prisma`를 부르면 교착). `createRun()`이 `id`를 필수 인자로 받는 것(I-6)은 그대로다. ④ **[pass 5 해소 — §25 I-56 · 이전 RG-9]** 크롤 임대는 인스턴스가 **자기가 획득한 토큰**(`leaseTokens` 메모리)으로만 갱신한다 — 없으면 `claimCrawlLease()`(QUEUED 선점 · 만료 인수)로만 얻고, 유효한 남의 임대면 처리하지 않는다. URL마다·종결 직전에 갱신하고 실패하면 즉시 물러난다(`LOST`). 종결·중지·일시중지는 선점 해제와 한 트랜잭션이다(I-52 — `finishCrawlAndRelease`·`finishIngestingAndRelease`·`cancelRunAndRelease` · 스케줄러 tick 첫머리 자가 치유 `healOrphanedActiveRuns()`). ⑤ **[pass 6 — §25 I-68·I-73]** QUEUED → CRAWLING 전이에 호스트 겹침 게이트(§6.8 · §25.3 B안) · 크롤 임대 만료 인수 CAS와 적재 슬롯 선점 CAS는 읽은 `claimToken`·`claimedAt`이 **모두** 같을 때만 · `KB_SYNC_LEASE_MS` 최소 300초 · 스케줄러 예약은 소스 단위로 예외 격리. ⑥ **[pass 8 — §25 I-86 · PM 결정 2026-09-28]** `claimAndCreateRun()`은 트랜잭션 **맨 앞에서** 저장된 소스 값을 다시 읽어 거버넌스 규칙(`lib/governance-flags.ts` `governanceViolation()` — 저장 검증 `assertGovernanceFlags()`와 같은 규칙)에 걸리면 `409 KB_INGEST_NOT_ALLOWED`(`details: [{ field: 'piiMask'｜'allowRawFileIngest', message: 'GOVERNANCE_MASK_REQUIRED'｜'GOVERNANCE_RAW_FILE_NOT_ALLOWED' }]` · 원인·해결 문구)로 거부한다 — 실행 행·소스 선점·승인 기록 모두 롤백. 수동 실행·적재 승인·예약 세 경로 공통이며 **PREVIEW도 차단**한다(설계에 없던 결정 — 근거·대안은 §25.5 U-1). 스케줄러는 소스 단위로 먼저 판정해 걸리면 실행을 만들지 않고 `nextRunAt`을 **다음 예약 시각**으로 CAS 갱신(`skipScheduledRunForGovernance` — `activeRunId = null ∧ nextRunAt = 읽은 값`)하며, CAS 승자만 로그 1줄 + 감사 `STATUS_CHANGE` `[예약 실행 건너뜀] …`을 남긴다(매 tick 반복 로그·감사와 tick당 후보 상한 10 점유 방지). 마스킹을 켜 저장해도 예약 실행은 다음 예약 시각까지 기다린다(수동 실행은 즉시 가능 · §25.5 U-2).

### 9.3 크롤 조각 · 재개 (R-5 · 제약 ⑦⑧)

- **프런티어 = `KbDocument` 행**(`seenRunId = 실행`, `visitState = QUEUED`) — 시작 시 robots(호스트별) → 사이트맵 URL(깊이 0) → 시작 주소(깊이 0)를 넣고, 너비 우선(`depth asc, discoveredSeq asc`)으로 1개씩 꺼낸다.
- 방문 결과를 그 행에 기록(`visitState = VISITED` · `observedChange` · 제외 사유 · 제목 · 삭제 감지 관측)하고, 링크는 범위 판정 후 **배치로** 넣는다: 같은 `urlHash`의 기존 행 조회 1회 → 없는 것은 `createMany`, 있는 것은 `updateMany(seenRunId, visitState=QUEUED, depth)`(이번 실행에서 아직 안 본 것만).
- `maxPages`: 이번 실행에서 `seenRunId = 실행`인 행 수가 상한이면 더 넣지 않고 `maxPagesReached = true`(AC-KB2-5 · 삭제 감지 끔). **[pass 7 — §25 I-77 · N-3: 구현을 이 문구에 맞췄다]** 상한은 **행을 넣을 때**만 적용하고(`seedFrontier(…, maxRows)` — 링크 발견·`carryChildren`·리다이렉트 목적지 모두 · 리다이렉트는 원본+목적지 2행을 쓴다) 이미 넣은 행은 모두 방문한다 · `maxPagesReached` = 프런티어 소진 시 이번 실행 행 수 ≥ 상한(이전 구현은 행 수가 상한에 닿는 순간 방문을 멈춰, 발견한 링크 수만큼 방문이 줄었다).
- **인스턴스가 죽으면**: 행이 이미 DB에 있으므로 임대 만료 후 다른 인스턴스가 **남은 QUEUED부터 이어서** 간다(요구사항 FR-KB2-10 "처음부터 다시"보다 나음 — 이미 방문한 URL을 다시 치지 않는다).
- 크롤 종결: ~~① 삭제 감지(§8.3) ② 가드(§8.4)~~ **[pass 9 — §25 I-90: ① 가드(§8.4) ② 삭제 감지(§8.3 — 강등이면 건너뜀)]** ③ 적재 작업 일괄 생성(§9.8) ④ 상태 전이 — 모두 `kb-run.store.ts` 트랜잭션(작업 생성은 500행 청크).
- **구현(§25 I-7)**: 크롤 종결 시 `run.kind ≠ PREVIEW ∧ maxPagesReached = false`이면 `findStaleDocuments()`(이번 실행에서 다시 보지 못한 ACTIVE·EXCLUDED 문서)를 `NOT_REDISCOVERED`로 관측해 `applyMissingUpdate()`로 기록한다(중단 호스트 문서 제외).
- **구현(§25 I-40 — pass 4)**: 종결 집계는 tick 지역 변수가 아니라 **DB 재집계**다 — `countRunObservations()`(새로·바뀜·변경 없음·방문 HTML) + `countRunOutcomes()`(`seenRunId = 실행` 행의 발견(VISITED+QUEUED)·방문·없어짐(ACTIVE ∧ `missingStreak > 0`)·GONE·정리 필요·마스킹 건수 합·제외 사유별 `groupBy`) + 위 삭제 감지 스윕이 바꾼 몫(`seenRunId ≠ 실행`이라 재집계에 잡히지 않으므로 호출부가 따로 센다). 행이 없는 `outOfScopeLinks`는 크롤 중 `KbRunStore.addOutOfScopeLinks()`가 실행 행 `counts` JSON에 누적하고(크롤 임대 보유자 1명만 쓴다는 전제의 읽기-수정-쓰기 — §25.1 RG-9 참고) 종결 때 이어받는다.
- **구현(§25 I-46 — pass 4)**: `seedFrontier()`는 이전 실행의 행을 이번 실행 QUEUED로 되돌릴 때 `observedChange = null`로 초기화한다(상한 도달·중지로 방문하지 못한 행이 지난 실행의 NEW·CHANGED로 적재 후보에 잡히지 않게). 실행 수준 실패는 `SECRET_MISSING`(크롤 시작 전 — `STATIC_HEADER`인데 비밀 없음) · `INGEST_NOT_ACKNOWLEDGED`·`RAG_NOT_CONFIGURED`(크롤 종결 시 SYNC·FULL_RESEND만 — 적재 작업을 만들지 않고 FAILED · 크롤 집계는 기록 · 해시 미갱신이라 다음 실행이 다시 "바뀜") 3종만 구현했다(나머지 — §25.1 RG-1·RG-2).
- **구현(§25 I-14 — 크롤 단계)**: 문서 1건의 추출 예외(작업 스레드 시간 초과·비정상 종료)는 그 문서만 `EXCLUDED(FILE_UNSAFE)`로 끝낸다. 단 `WorkerEntryMissingError`(전역 설정 오류)는 문서 탓으로 바꾸지 않고 위로 올리며, `KbCrawlRunner.runFragment()`와 `KbSyncJob.tick()`의 실행 루프가 실행 단위로 가둔다(다른 실행·다음 tick은 계속).
- **[pass 5 해소 — §25 I-56 · 이전 RG-15]** URL마다 자기 토큰으로 임대를 갱신하므로 중지(`cancelRun()`이 `claimToken`을 비움) 뒤에는 진행 중 요청 1개만 마무리하고 새 요청 없이 멈춘다(AC-KB5-4). 잔여 경합(종결 직전 갱신 ~ 종결 트랜잭션 사이의 중지)은 §25.2 RG-19.
- **[pass 5 — §25 I-49·I-50·I-52]** 종결 순서: 임대 재확인 → 시작 주소 미도달 판정(미도달이면 스윕·강등·적재 건너뛰고 FAILED) → ~~삭제 감지 스윕(`untouchedSince = startedAt`) → 가드~~ **[pass 9 — I-90: 가드 → 삭제 감지 스윕(`untouchedSince = startedAt` · 강등이면 건너뜀)]** → 적재 전제 → 작업 생성(`createIngestJobsBulk` — **종결 트랜잭션 밖**, 문서당 진행 중 1건 CAS로 재종결 멱등) → `finishCrawlAndRelease()`(상태 전이 + 선점 해제 한 트랜잭션). 이번에 만든 작업이 0이어도 그 실행의 작업이 이미 있으면 INGESTING.
- **[pass 6 — §25 I-62·I-63·I-66·I-69·I-70·I-73]** 프런티어: 링크는 정규화 URL로 중복 제거 후 넣는다(배치 유니크 위반으로 링크 배치를 잃던 결함) · 새·재발견 행에 부모(`discoveredFromId`)를 기록하고, 링크를 얻지 못한 부모의 지난 자식을 이어 넣는다(`carryChildren` — §8.3) · 재방문 행은 `observedChange`·`observedPiiMasked`를 null로 초기화 · 발견 순서 번호는 소스 전체 최대값 다음부터 · 리다이렉트 최종 URL은 같은 깊이로 프런티어에 올려 그 행에 기록(§6.4) · 방문 중 예외가 나도 이미 받은 응답의 시작 주소 판정(`ctx.verdict`)은 남긴다. 종결: 자동 강등(`demoteReview`)은 종결 CAS와 같은 트랜잭션 · 종결 CAS에 지면 종단 실행의 PENDING 작업을 정리(`cancelPendingJobsOfTerminatedRun`) · 재종결은 저장된 스윕 몫(`counts.sweep`)을 이어받는다. 인증 벽 가드 입력의 결함은 §25.4 RG-21(pass 8 해소 — §25 I-85).
- **[pass 7·8 — §25 I-75·I-79·I-83]** 조각 예산 분모 = min(남은 병렬 자리, 남은 후보 수)(후보 1개면 예산 전체) · 후보 창 = max(`KB_SYNC_LIMITS.maxSources`(50), 병렬 상한 × 10)(호스트 겹침 대기 실행이 앞자리를 막지 않게 — 겹침 그룹별 조회는 미구현) · 크롤 임대 갱신 지점 = URL마다 + 호스트 간격 대기 중 10초마다 + 요청 직전(~~2초 간격~~ **[pass 9 L-3] 간격 생략 없이 항상**) + **사이트맵 파일 요청 직전마다**(`ensureSeeded` — 실패하면 프런티어를 만들지 않고 `LOST`로 물러남 · `processLoop`는 임대 갱신 클로저를 만든 뒤 씨앗을 넣는다).
- **[pass 9 — §25 I-92 · M-4]** 조각 기한을 넘는 요청은 홉과 무관하게 미루고 다음 조각이 그 문서를 이어 처리한다 — 리다이렉트 중간이면 저장된 홉부터(`redirectResume` · §6.4 pass 9·10 ①). 프런티어 머리 문서가 미뤄지면 조각을 곧바로 끝내므로 실행당 살아 있는 재개 상태는 보통 1개다(너비 우선 순서 `nextQueuedDocument`라 다음 조각이 같은 문서를 먼저 꺼낸다 — §20 K-24).

### 9.4 적재 슬롯 · 전역 직렬 (FR-KB4-5 · AC-KB4-1 · R-7)

- 슬롯 행 `INGEST_SLOT_0..N−1`(N = `KB_INGEST_CONCURRENCY`, 기본 1). 슬롯 선점 = `updateMany({ where: { name, OR: [{ claimToken: null }, { claimedAt: { lt: now − LEASE } }] }, data: { claimToken, claimedAt, holderJobId } })`. [구현: 행을 읽어 비었거나 임대 만료(`isLeaseExpired`)인지 판정한 뒤 `where: { name, claimToken: 읽은 값 ?? null }` 동등 비교 1개로 CAS — §25 I-21·I-48]
- 슬롯을 가진 인스턴스만 작업을 **SUBMITTING**으로 올릴 수 있다(`updateMany({ where: { id, status: 'PENDING' } , data: { status: 'SUBMITTING', slotToken } })`). 작업이 종단 상태가 되거나 백오프로 PENDING에 돌아가면 슬롯을 놓는다.
- **SUBMITTED 작업을 가진 슬롯이 만료되면**(인스턴스 종료) 다른 인스턴스가 슬롯과 작업을 함께 이어받아 **같은 `taskId`를 계속 조회**한다(재전송 아님). SUBMITTING에서 만료되면 외부 접수 여부를 알 수 없으므로 PENDING으로 되돌려 재전송한다(같은 이름 덮어쓰기 — 중복 적재 0). [구현 정정 — §25 I-15: `externalFileName`이 비어 있을 때만 PENDING, 채워져 있으면 재전송하지 않고 UNKNOWN]
- 작업 선택: `status = PENDING ∧ (nextAttemptAt ≤ now ∨ null)` ∧ 소스 `enabled` ∧ 소스 `configVersion = 작업 생성 시 값`(불일치 = CANCELLED `CONFIG_CHANGED`) — 순서 **INCREMENTAL 먼저**, 그다음 BULK(시간창 안일 때만), 같은 레인은 `createdAt asc`. **[pass 7 — §25 I-81 · 이전 §25.4 RG-22①]** QUEUED·CRAWLING 실행의 작업은 후보에서 뺀다(그 상태 실행 id 선조회 1쿼리 + `runId notIn`) — 크롤 종결 창의 작업이나 그 창에서 크롤 인스턴스가 죽어 남은 작업이 전역 대기열 머리를 막지 않는다. 종단 실행의 고아 작업은 계속 골라 정리한다(`runGate` — RG-19 불변 · `WAIT`는 방어용으로 남김). RG-22① 권장안("INGESTING 실행만")과 다른 것은 종단 정리 경로를 살리기 위한 의도된 선택이다.
- **문서당 진행 중 적재 1건**: 작업 생성 시 `KbDocument.activeIngestJobId` CAS — 이미 진행 중인 문서는 새 작업을 만들지 않는다(다음 실행이 다시 판정).
- **구현(§25 I-33 — pass 4 · 슬롯 수명)**: 슬롯은 제출 직후가 아니라 작업이 **종단 상태가 되거나 백오프로 PENDING에 돌아갈 때까지** 유지된다. 작업 행 `slotToken` = `"<슬롯 이름>:<토큰>"`(슬롯 키). `trySubmitOne()`은 대기 작업이 있을 때만 슬롯을 잡고, 제출 결과가 SUBMITTED면 슬롯을 놓지 않는다(`keepSlot`) — 그 밖(대기·건너뜀·백오프·예외)은 `finally`에서 놓는다. 전이 메서드(`succeedJob`·`failJob`·`timeoutJob`·`markSkipped` = 종단 · `retryJob`·`resubmitNotFound`·`revertSubmissionClaim` = PENDING 복귀)가 전이 CAS 성공 시 슬롯을 놓는다(전이 UPDATE가 `slotToken`을 비우므로 `slotKeyOf()`로 먼저 읽어 둔다 · 해제는 CAS라 이중 해제 무해). 조회(`markPolled`)마다 `renewSlot(now)`로 임대를 연장해 SUBMITTED가 최대 3시간이어도 `KB_SYNC_LEASE_MS` 만료로 슬롯이 풀리지 않는다. 조회 자체는 슬롯 없이 아무 인스턴스나 한다(멱등).
- **구현(§25 I-33 — 인수)**: `claimAnySlot()`이 임대 만료 슬롯을 CAS로 잡았는데 그 슬롯 이름으로 시작하는 `slotToken`의 SUBMITTED 작업이 있으면(직전 보유자 사망) 그 작업의 `slotToken`을 새 키로 CAS 재바인딩하고(같은 `taskId` 계속 조회 — 재전송 아님) 그 슬롯은 새 제출에 쓰지 않고 다음 슬롯으로 넘어간다(전역 직렬 유지).
- **구현(§25 I-21 — 하드닝 기록)**: `claimAnySlot()`의 CAS 조건은 단순 동등 비교 `where: { name, claimToken: <읽은 값 ?? null> }` 1개다. 이전의 `OR: [{ claimToken: null }, { claimToken: row?.claimToken ?? undefined }]` 형태는 빈 슬롯에서 `undefined` 갈래를 Prisma가 조건에서 빼(가지치기) **우연히** 안전했을 뿐 CAS 불변식이 코드에 드러나지 않았다. 동작 변경은 없다.
- **구현(§25 I-48 — Prisma where 의미 · 실측 `kb-run.store.cas.spec.ts`)**: 필드 값 `undefined` = 그 조건 제거 · `null` = `IS NULL` · `OR` 안의 `undefined` 갈래 = 가지치기. 그래서 `releaseSlot()`·`renewSlot()`은 `parseSlotKey()`로 `이름:토큰` 형식을 먼저 확인하고 형식이 틀리면 아무것도 하지 않는다(토큰이 `undefined`로 새면 `where: { name }`이 되어 남의 슬롯까지 놓기 때문).
- **구현(§25 I-15 — pass 4 개정)**: 적재 조각 첫머리의 `sweepExpiredSubmittingJobs(KB_SYNC_LEASE_MS, now)`가 **멈춘 SUBMITTING** 작업을 정리한다. 멈춤 판정 = 작업 슬롯 키 형식 오류 ∨ 슬롯 행 없음 ∨ 슬롯 `claimToken` 비어 있음 ∨ **슬롯 토큰 ≠ 작업 키의 토큰**(다른 보유자가 가져감) ∨ 슬롯 임대 만료. `externalFileName`이 비어 있으면(외부 호출 전 중단이 확실) PENDING(`revertSubmissionClaim` — 시도 수 순증 0), 채워져 있으면(전송했을 수 있음) 재전송하지 않고 `UNKNOWN` + 문서 표식 해제.
- **구현(§25 I-44 — pass 4)**: `cancelRun()`은 실행 CANCELLED CAS 성공 시 PENDING 작업 → CANCELLED(`CANCELLED_BY_USER`) · SUBMITTED 작업 → UNKNOWN(`slotToken` 비움) + 그 슬롯 해제 · 두 경우 모두 문서 `activeIngestJobId` 해제(연속 실패 수 불변).

### 9.5 적재 단계 · 재시도 · 시간 초과 (FR-KB4-6~9)

```
1. ACK·RAG 설정·vLLM 준비 확인(아니면 대기 — 시도 수 미산입)
2. 재수집: fetcher로 URL GET(조건부 아님) — 404·410 = SKIPPED(GONE_AT_INGEST) · 범위 밖/noindex = SKIPPED(EXCLUDED_AT_INGEST)
3. 작업 스레드: 해석 → 해시·지문 → 문서의 현재 contentHash·지문과 같으면 SKIPPED(UNCHANGED_AT_INGEST — 다른 실행이 이미 반영)
                → HTML: 추출 → 잡음 제거 → 마스킹(piiMask) → 머리 3줄 → 형식 변환 / 파일: 원본 바이트(+ PII 사전 검사 건수)
4. RagHttpClient.ingest({ file: buildExternalFile(...), company, category, subcategory })
5. 접수 → SUBMITTED(taskId) · 이후 tick마다 lastPolledAt + KB_INGEST_POLL_MS ≤ now이면 taskStatus()
```

- 재시도: 제출 실패·"실패."·`failed`·`cancelled`·429·503·500·네트워크 → `attemptCount + 1` · 백오프 **1분 · 5분 · 30분**(`backoff.ts` 순수) · **3회 초과 = FAILED** → 다음 예약 실행이 다시 "바뀜"으로 잡는다(해시 미갱신). 400 = 즉시 FAILED(재시도 0 · 설정 오류 배지). [구현 — §25 I-34·I-35·I-46: 작업 **조회**의 네트워크·5xx·429는 재시도(재전송)가 아니라 재조회(`POLL_AGAIN`) · 재수집 실패도 같은 백오프·소진 규칙 · `INVALID_TASK_ID`도 재시도 0 · 백오프 기준 시각 = tick 주입 시계 `now`]
- 제출 후 **3시간**(외부 동기 상한과 같음) = `TIMEOUT`(외부에서 계속될 수 있음을 표시 · 슬롯 해제).
- 같은 문서가 **3회 연속** FAILED(실행을 건너) = `consecutiveIngestFailures ≥ 3` → 소스 목록 "반복 실패" 배지(EX-KB-3). [구현 — §25 I-44: +1은 FAILED·TIMEOUT 전이에서만 · SKIPPED·중지·설정 변경 취소는 올리지 않음 · 성공 시 0]
- 성공 시 같은 트랜잭션에서 문서 `contentHash`·`ingestFingerprint`·검증자·`textLength`·`byteSize`·`externalFileName`·`lastIngestedAt` 갱신 · `consecutiveIngestFailures = 0` · `activeIngestJobId = null` · 축소였으면 `cleanupReason = SHRUNK`.
- **[pass 5 해소 — §25 I-53 · 이전 RG-6]** `succeedJob()`이 문서 갱신 **전에** 이전 `textLength`·`byteSize`·`lastIngestedAt`·`cleanupReason`을 읽어, 이전에 적재됐고 이번 값(HTML = `textLength` · 파일 = `byteSize`)이 이전 × 0.5 미만이면 같은 갱신에서 `cleanupReason = SHRUNK`(다른 사유가 있으면 보존 · AC-KB3-5).
- **[pass 5 — §25 I-55·I-58]** 재수집 뒤 검사: HTML = 메타 `noindex` ∨ `X-Robots-Tag` noindex → `SKIPPED(EXCLUDED_AT_INGEST)` · 파일 = 해시가 바뀐 경우 원본 파일 사전 검사(`FILE_UNSAFE`·`FILE_ENCRYPTED`·거버넌스 ON ∧ 개인정보 ≥ 1) → `SKIPPED(EXCLUDED_AT_INGEST)` · 통과 시 작업 `piiMaskedCount` 기록.
- **[pass 6 해소 — §25 I-69 · 이전 §25.2 RG-19]** `trySubmitOne()`은 외부 RAG 준비 확인(상태 조회 호출)보다 **먼저** 작업의 실행 상태를 본다(`runGate`) — INGESTING = 진행 · 종단(SUCCEEDED·PARTIAL·FAILED·CANCELLED) = 작업 CANCELLED(`CANCELLED_BY_USER`) + 문서 표식 해제(외부 호출 0) · QUEUED·CRAWLING = 취소도 제출도 하지 않고 대기(작업 생성 ~ INGESTING 전이 사이의 정상 창 보호) · 슬롯 선점 뒤 한 번 더 같은 판정. 잔여: 대기 작업의 머리 막힘(§25.4 RG-22① — pass 7 해소 · §25 I-81).
- **[pass 6 — §25 I-64·I-66·I-70·I-73]** `FULL_RESEND` 작업은 3단계의 해시 동일 건너뛰기를 적용하지 않는다 · 재수집은 공용 헬퍼로 리다이렉트를 따른다(홉마다 범위 재검증 · 범위 밖·하향·4번째 홉·순환·응답 상한 초과 = `SKIPPED(EXCLUDED_AT_INGEST)` · 적재 단계 홉은 페이싱·robots 재확인 없음) · HTML 재수집 상한 = min(`maxFileBytes`, 2MB) · 재수집·해석·외부 전송 구간 앞마다 슬롯 임대 갱신.
- **[pass 7·8 — §25 I-78·I-82·I-83·I-86]** 재수집 최종 URL 종류 ≠ `doc.kind` → `SKIPPED(EXCLUDED_AT_INGEST)` · 원본 파일 재검사도 거버넌스 ON ∧ `truncated`면 제외 · 재수집 리다이렉트 **홉 사이**에도 슬롯 임대 갱신(`beforeRequest` 훅 — 홉 > 0) · **거버넌스 적재 게이트**: `trySubmitOne()`이 `runGate` 직후(외부 RAG 상태 조회보다 먼저 — 외부 호출 0)와 슬롯 획득·소스 재조회 직후 두 곳에서 `terminateIfGovernanceBlocked()`를 불러, 소스의 **저장된** 값이 규칙에 걸리면 `KbSourcesService.cancelRunAndRelease(…, failureCode = GOVERNANCE_*)`로 실행을 끝낸다(실행 CANCELLED · 대기 작업 CANCELLED(`CONFIG_CHANGED`) · SUBMITTED 작업 UNKNOWN · 슬롯 해제 · 문서 `activeIngestJobId` 정리 · 소스 선점 해제가 한 트랜잭션). 판정은 러너 자신의 설정(`DATA_GOVERNANCE_MODE`·`KB_ALLOW_RAW_FILE_INGEST`)으로 하며 `governance/**` import 0(KB-13). 이미 적재된 문서 행·`externalFileName`은 건드리지 않고, 이미 SUBMITTED인 작업은 외부에서 계속된다(K-18과 같은 한계). ~~이 종결은 로그 1줄뿐 감사 기록이 없다(§20 K-22 · §25.5 U-3).~~ **[pass 10 — §25 I-95 · U-3 채택]** 종결은 `KbSourcesService.terminateRunForGovernance()`가 맡는다 — `cancelRunAndRelease` CAS에 이긴 인스턴스만 감사 `STATUS_CHANGE` `[적재 차단] ${governanceViolationMessage(…)}` 1건(고정 문구 · URL·본문·비밀 0 — 예약 건너뜀과 같은 방식)을 남기고 러너는 로그 1줄. 러너에 감사 서비스를 주입하지 않은 것은 §25.5 U-3 대안과 다른 점이다(`KbSource` 쓰기 유일 파일 `kb-sources.service.ts`에 모아 봉인 KB-9·KB-13·KB-15와 정합).
- **[pass 9·10 — §25 I-91·I-96] 적재 단계 범위 방어 · 홉별 타임아웃**: `submitJob()`이 재수집 **전에** 문서 URL을 **현재** 소스 범위(허용 호스트·**허용 출처 host:port(pass 12 — §25 I-104)**·경로 접두·제외 패턴·쿼리 허용 — 깊이는 0)로 다시 확인해 밖이면 요청·제출 없이 `SKIPPED(EXCLUDED_AT_INGEST)` — 위 2단계 "범위 밖 = SKIPPED"의 실제 구현(이전에는 재수집 리다이렉트 홉만 검사) · 범위를 줄인 뒤 남은 옛 작업·FULL_RESEND 대상이 범위 밖 페이지를 보내지 않는다. 재수집 타임아웃은 홉 URL별(파일 URL = ×4 — 크롤과 같은 규칙) · 리다이렉트 홉의 인증 헤더는 시작 URL과 같은 호스트+포트일 때만(§6.9).
- **구현(§25 I-14 — 적재 단계)**: 재수집 후 추출 예외는 그 작업만 `SKIPPED(EXCLUDED_AT_INGEST)`로 끝낸다. `WorkerEntryMissingError`는 위로 올리기 전에 `revertSubmissionClaim()`으로 SUBMITTING → PENDING(백오프 없음 · `attemptCount` −1로 선점 시 +1을 상쇄 = 순증 0)으로 되돌리고, `KbIngestRunner.runFragment()`가 예외를 가둬 `false`를 돌려준다.
- **구현(§25 I-19)**: 429·503 응답의 `Retry-After`(해석값 `retryAfterMs`, 상한 30분)가 있으면 고정 백오프(1·5·30분) 대신 그 값으로 `nextAttemptAt`을 정한다.
- **구현(§25 I-35 — pass 4)**: 선점(`claimJobForSubmission` — PENDING → SUBMITTING · `attemptCount + 1`)이 재수집보다 **먼저**다. 재수집 실패(네트워크 = `NETWORK_ERROR` · 404·410 외 비2xx = `UPSTREAM_ERROR`)는 제출 실패와 같은 `handleFailureOrRetry()` — 백오프 1·5·30분 · 3회 소진 시 FAILED(이전 구현은 고정 1분 재시도를 횟수 제한 없이 반복했다).
- **구현(§25 I-46 — pass 4)**: 백오프 기준 시각·`completedAt`·`finishedAt`·`not_found` 재전송 시각은 tick의 **주입 시계 `now`**다(`Date.now()`/`new Date()`가 아니다 — `pickNextPendingJob(now)`와 같은 시계). 크롤 단계의 임대·종결 시각은 여전히 `new Date()`다.

### 9.6 진행률 · 예상 시간 (FR-KB5-5 · NFR-KBA1)

- 진행률 = **완료 작업 수 / 전체 작업 수**(완료 = 종단 상태) — 외부 `progress`는 읽지 않는다. 크롤 단계는 "방문 N · 대기 M"(프런티어 행 수).
- 예상 남은 시간 `eta.ts`(순수) = 남은 작업 수 × 최근 성공 작업 20건의 평균 소요(제출→완료, HTML·파일 분리) ÷ 슬롯 수 · 표본이 없으면 가정치(HTML 45초 · 파일 150초 — §4.10 추정). BULK가 시간창 밖이면 `waitingReason = BULK_WINDOW`.
- **구현(§25 I-10)**: `etaSeconds` = 순수 `lib/eta.ts` `computeEtaSeconds()` — ⌈(남은 HTML 작업 × HTML 평균 + 남은 파일 작업 × 파일 평균) ÷ 슬롯 수(`KB_INGEST_CONCURRENCY`)⌉ · 표본 = 전역 최근 성공 작업(`completedAt` 내림차순) 종류별 최대 20건 · 표본 없으면 가정치 45초/150초 · 남은 작업 0이면 0 · 슬롯 ≤ 0이면 null. 조립은 `lib/build-run-view.ts` 1곳(실행 상세·목록·소스 `activeRun` 공유)이며 실행 상태가 `INGESTING`·`SUCCEEDED`·`PARTIAL`일 때만 계산한다 — 적재 작업이 없는 PREVIEW는 종결 시 **0**, 크롤 단계(`QUEUED`·`CRAWLING`)는 null.
- **구현(§25 I-43 — pass 4 · 대기 사유)**: 순수 `decideWaitingReason()`(`build-run-view.ts`) — 실행이 `INGESTING` ∧ 대기(PENDING) > 0 ∧ 진행(SUBMITTING+SUBMITTED) = 0일 때만 사유를 낸다: 외부 RAG 준비 = `false`면 `RAG_NOT_READY` · 시간창 닫힘 ∧ 대기 작업이 전부 BULK면 `BULK_WINDOW` · 그 밖 null. **`RATE_LIMIT`은 내지 않는다**(인스턴스 버킷은 메모리 상태라 조회한 인스턴스가 알 수 없다 — enum 값은 계약에 남김 · §25.1 RG-14). 입력은 `KbRunStore.getWaitingContext(runIds)` = `INGEST_STATUS` 행 캐시(`vllmReady`·`checkedAt`) + 실행별 대기 BULK 수 `groupBy` 1회 — 실행 상세 쿼리가 2개 늘어난다. BULK 레인 선택도 같은 `isWithinBulkWindow(KB_INGEST_BULK_WINDOW, now)`를 쓴다(`pickNextPendingJob(now, bulkAllowed)`).
- **구현(§25 I-40 — pass 4)**: 진행 중 실행의 `crawl`은 저장값이 `{}`라 응답에서 계약 모양(`KbRunCrawlCounts` — 전 필드 0 · `excluded: {}`)으로 채운다.
- 콘솔은 실행 상세를 5초마다 다시 읽는다(서버 푸시 없음 — FR-KB7-6). 응답은 인덱스 조회 3개(실행 1 · 작업 `groupBy` 1 · 최근 성공 평균 1).

### 9.7 대량 첫 적재 (수 시간) 처리 방침 (R-22)

| 문제 | 방침 |
|---|---|
| 500쪽 첫 적재 = 4~8시간(추정 — Q-6) | 작업은 DB 행이라 재시작·배포를 넘어 이어진다(슬롯 임대 · 조회 인계). 콘솔은 "312개 중 120개 완료 · 약 3시간 남음"을 보여 준다 |
| 대량 뒤에 다른 소스의 하루 변경 3건이 몇 시간 줄 섬 | **레인 분리** — 실행의 작업 수가 50 초과이거나 `FULL_RESEND`이거나 소스의 첫 적재면 `BULK`, 아니면 `INCREMENTAL`. 선택은 **INCREMENTAL 먼저** |
| 대량 적재가 외부 vLLM을 오래 점유해 업무 시간 챗봇 답변이 느려짐 | 선택 시간창 `KB_INGEST_BULK_WINDOW`(예: `19:00-08:00` KST) — 밖이면 BULK를 고르지 않는다(INCREMENTAL은 항상). 기본 빈 값(항상 — 시연·개발 편의), 운영 설치 권장값은 설치 가이드 |
| 도중 외부 RAG 재시작 | `not_found` 1회 재전송(§5.6) — 덮어쓰기라 결과 동일(부하만 — K-13) |
| 관리자가 중간에 범위를 잘못 잡은 것을 발견 | 실행 중지 → PENDING 작업 CANCELLED · 이미 들어간 문서는 "정리 필요"가 아니라 그대로(외부에서 운영자가 정리) — 미리보기가 1차 방어선(P-4) |
| 처리량 기본값 | 착수 직후 실측 1회로 `KB_INGEST_CONCURRENCY`(1~3)·시간창 권장값 확정(운영 문서 §5.7) |

### 9.8 첫 동기화 · 승인 · 적재 대기열 (P-4 · FR-KB5-3 · R-9)

- **`configVersion`을 올리는 필드**: 시작 주소·사이트맵·경로 접두·제외·잡음 패턴·쿼리 허용·깊이·최대 페이지·파일 형식·파일 상한·스코프 3단·`piiMask`·`allowRawFileIngest`. 올리지 않는 필드: 이름·주기·인증(헤더 이름·참조)·요청 간격·`enabled`. [구현 — §25 I-38: 순수 `detectConfigChange()`가 저장된 현재 값과 **다를 때만** 올린다 — 목록은 집합 비교(순서만 바뀐 저장은 변경 아님) · 숫자는 서버 상한 적용 후 저장값 비교 · 본문에 없는 필드는 비교하지 않음 · `409 KB_SOURCE_BUSY`도 실제 변경일 때만]
- `ingestApproved` = `approvedConfigVersion === configVersion` ∧ `reviewRequiredReason = null`. 새 소스·범위를 바꾼 소스·강등된 소스는 **승인 전까지 모든 실행이 PREVIEW**(예약 포함).
- **스코프(3단)가 바뀌면** 이전에 적재된 ACTIVE 문서에 `cleanupReason = SCOPE_CHANGED`를 단다 — 같은 파일 이름을 다른 스코프로 다시 넣을 때 외부의 옛 스코프 청크가 어떻게 되는지 확인되지 않았기 때문이다(Q-4 · K-9). [구현 — §25 I-45: `KbRunStore.markScopeChanged()` — `state = ACTIVE ∧ lastIngestedAt ≠ null ∧ cleanupReason = null`만(다른 정리 사유 보존) · 수정 저장 직후 1회]
- `POST …/approve-ingest { previewRunId }`: 그 실행이 `PREVIEW` ∧ `SUCCEEDED` ∧ `configVersion` 일치 ∧ ACK 있음 ∧ RAG 설정됨 ∧ **[pass 11 — §25 I-102 · L-B]** (소스에 `reviewRequiredReason`이 있으면) 미리보기 종료 시각 ≥ 강등을 만든 가장 최근 실행의 종료 시각(`KbRunStore.findLatestDemotionFinishedAt` — SYNC·FULL_RESEND의 모든 강등 + PREVIEW의 NEW_RATIO 강등만 · PREVIEW `AUTH_WALL`은 기록만이라 제외 · 그런 실행 행이 보존 정리로 없으면 조건 생략)이어야 한다(아니면 `409 KB_INGEST_NOT_ALLOWED` + 사유 — 강등 시각 조건은 `details[0] = { field: 'previewRunId', message: 'PREVIEW_STALE' }` 재사용 · 새 오류 코드 0 · 콘솔 표시는 §25.7 RG-27 → **웹 해소(§25 I-108)**: 확실할 때 "적재 시작" 사전 비활성 + 409 수신 시 서버 문구 표시) → 승인 기록 + **곧바로 SYNC 실행 1건**(trigger `APPROVAL` — 크롤 약 10분 뒤 적재 · **[pass 10 — §25 I-94]** 이 실행은 새로 비율 가드를 면제받는다 — 인증 벽 가드는 적용). 미리보기와 승인 사이에 사이트가 바뀌었을 수 있으므로 미리보기 결과로 바로 적재하지 않고 다시 크롤한다(크롤 비용 ≪ 적재 비용).
- **적재 대기열 등록 시점 = 크롤 종결**(가드 판정 뒤 일괄) — 크롤 중 발견 즉시 넣으면 새로 비율·인증 벽 가드가 이미 늦다. 크롤은 적재의 수십 분의 1이라 파이프라인 병행의 이득이 작다.
- `FULL_RESEND { acknowledgeCleanup }`: 승인 필요 · 크롤 후 ACTIVE 전부(**[pass 7 — §25 I-76 · N-2]** 정확히는 ACTIVE ∧ (한 번이라도 적재함 ∨ 이번 실행에서 내용을 관측함(`observedChange` NEW·CHANGED·UNCHANGED)) — 리다이렉트 원래 행(방문 표시만)을 빼 원본·목적지 두 이름으로 중복 적재하지 않는다 · ~~도입 전 원본 URL 이름으로 이미 적재된 행은 대상에 남는다~~ · **[pass 9 — §25 I-91 · M-3]** 현재 대상 = `ACTIVE ∧ seenRunId = 이번 실행 ∧ (lastIngestedAt ≠ null ∨ observedChange ∈ {NEW, CHANGED, UNCHANGED}) ∧ 리다이렉트 원래 행(observedHash가 R:·RL:) 아님` — 두 갈래 모두 이번 실행에서 다시 발견·방문한 행만(범위 축소로 이번에 발견되지 않은 옛 적재 문서를 다시 보내지 않는다 · 304 확인 행도 이번 실행 행이다) · 예전에 적재된 뒤 리다이렉트 원래 행이 된 행도 빠진다(옛 이름의 외부 사본은 남음 — §20 K-21) · 리다이렉트 원래 지문은 `seedFrontier()`가 실행마다 null로 비우므로 다음 실행에서 200으로 복귀한 행은 다시 대상이 된다 · 적재 단계도 범위를 다시 확인한다(§9.5) · **[pass 11 기록 — §20 K-27 · R6 L-D]** `seenRunId` 조건 때문에 `maxPages` 도달로 이번 실행 프런티어에 오르지 못한 적재 문서는 대상에서 빠진다)를 BULK 작업으로(해시 무시 — [pass 6 · §25 I-64] 적재 단계의 해시 동일 건너뛰기도 적용하지 않는다. 이전 구현은 변경 없는 문서를 전부 `UNCHANGED_AT_INGEST`로 건너뛰어 "전체 다시 적재"가 바뀐 문서만 보냈다) · `acknowledgeCleanup = true`면 **시작 전에** `GONE` 문서 행 삭제 + `SHRUNK`·`SCOPE_CHANGED`·`FORMAT_CHANGED`·`ROBOTS_DISALLOWED` 표시 해제("외부 RAG에서 정리했다"는 관리자 확인 — 감사 기록 · R-18).

### 9.9 중지 · 일시중지 · 삭제 (FR-KB1-9 · EX-KB-14 · EX-KB-19 · AC-KB5-4)

- 중지(`POST …/runs/:runId/cancel`): `cancelRequestedAt` 기록 → 크롤 조각은 다음 URL 경계에서 멈춤 → CANCELLED · PENDING 작업 CANCELLED · SUBMITTED 작업은 조회를 멈추고 `UNKNOWN`(외부 취소 호출 0) · 슬롯 해제 · `activeRunId` 해제. [구현 — §25 I-44: `cancelRun()`이 PENDING·SUBMITTED 작업의 문서 `activeIngestJobId`를 풀고 SUBMITTED 작업의 슬롯을 놓는다 · 연속 실패 수 불변 · [pass 5 — I-49·I-52·I-56] 실행 `failureCode = CANCELLED_BY_USER` · 크롤 조각은 다음 URL 경계의 임대 갱신 실패로 멈춤 · 중지·작업 정리·선점 해제는 `KbSourcesService.cancelRunAndRelease()` 한 트랜잭션 · 잔여 경합 §25.2 RG-19 — pass 6 해소(§25 I-69)]
- 일시중지(`PATCH enabled=false`): 진행 중 실행을 같은 방식으로 중지 + 예약 정지(`nextRunAt` 유지 · 재개 시 과거면 1회 따라잡기). [구현 — §25 I-45: `enabled`가 실제로 바뀔 때 `STATUS_CHANGE` 감사(`[일시중지]`·`[재개]`) · 끌 때 진행 중 실행이 있으면 `cancelRunAndRelease(…, 'SOURCE_DISABLED')`(pass 5 — 한 트랜잭션 · 실행 `failureCode = SOURCE_DISABLED` · 그 실행의 PENDING 작업 `resultCode`는 [pass 6 — §25 I-70③] `CONFIG_CHANGED`(관리자 중지만 `CANCELLED_BY_USER` · 종단 실행 정리 경로의 예외는 §25.4 RG-22④) — §25.2 RG-20)]
- 설정 수정 중 실행 진행: `configVersion`을 올리는 필드 변경 = `409 KB_SOURCE_BUSY`(먼저 중지) · 그 밖 필드는 허용(다음 실행부터 — R-14).
- 소스 삭제: 진행 중이면 `409 KB_SOURCE_BUSY` · 아니면 한 트랜잭션에서 `KbDocument` 행 삭제(store 경유) → `KbSource` 삭제 · 실행 이력·적재 작업은 로그로 남는다(보존 기간에 파기 — R-29). **외부 RAG 삭제 호출 0** — 확인 문구 "외부 RAG에 넣은 문서는 지워지지 않습니다"(AC-KB7-4).

---

## 10. 개인정보 · 보안 (P-6 · J-18 · C-10)

| 항목 | 규칙 |
|---|---|
| HTML 추출 텍스트 | 적재 전 `maskPii(text, { mode: PII_MASK_MODE })` **기본 켜짐** — 제목·본문·머리 줄 전부(**[pass 10 해소 — §25 I-93 · 이전 §25.5 RG-25]** 제목은 작업 스레드 `sanitizeTitle()`이 본문과 같은 규칙으로 마스킹한 **뒤** 코드 포인트 200자로 자른다 — 건수는 `piiMaskedCount`에 합산 · 저장(`KbDocument.title`)·전송(머리 줄 `제목:`·HTML `<title>`)이 같은 값 · 머리 줄 `출처:` URL은 마스킹하지 않는다 — §20 K-25). 건수를 실행 요약·문서 행(`observedPiiMasked`)에 기록 |
| 소스별 마스킹 끄기 | 거버넌스 모드 ON이면 **저장 거부**(`400 VALIDATION_FAILED` + `details: [{ field: 'piiMask', message: 'GOVERNANCE_MASK_REQUIRED' }]` — AC-KB6-3 · 구현 위치: 등록·수정 공통 `assertGovernanceFlags()` — 수정은 본문에 실린 필드만 검사 · §25 I-12·I-37). OFF에서도 끄면 목록·데이터 지도에 "마스킹 꺼짐" 표시 · **[pass 8 — 아래 "거버넌스 모드 전환 뒤 기존 소스" 행]** |
| 원본 파일 전달 | 소스 옵션 `allowRawFileIngest`(기본 꺼짐). 거버넌스 ON에서 켜려면 `KB_ALLOW_RAW_FILE_INGEST=true` 필요(없으면 저장 거부 — `400 VALIDATION_FAILED` + `details: [{ field: 'allowRawFileIngest', message: 'GOVERNANCE_RAW_FILE_NOT_ALLOWED' }]` · AC-KB6-2 · 구현 위치: 등록·수정 공통 `assertGovernanceFlags()` — 수정은 본문에 실린 필드만 검사 · §25 I-12·I-37 · 아래 사전 검사·`PII_IN_RAW_FILE` 제외는 pass 5에서 구현 — §25 I-55 · 단 `PII_IN_RAW_FILE`로 제외한 파일은 건수를 `observedPiiMasked`에 기록하지 않는다 — §25.2 RG-20). 켜져 있으면 **사전 검사**로 PII 형식 건수를 세어 미리보기에 "마스킹 없이 전송될 개인정보 형식 N건"을 보여 주고, **거버넌스 ON이면 1건 이상인 파일은 `PII_IN_RAW_FILE`로 제외**(R-17) |
| **거버넌스 모드 전환 뒤 기존 소스**(pass 8 · **PM 결정 2026-09-28** — 저장 시점 거부만 있던 이 절·AC-KB6-2·3의 범위를 **실행·적재 시점 차단으로 확장**) | 모드를 켜기 **전에** 마스킹 끔·원본 파일 전달(서버 허용 없음)로 저장된 소스는 저장 검증(`assertGovernanceFlags()` — 수정은 본문에 실린 필드만 검사)을 다시 거치지 않으므로, 같은 규칙(`lib/governance-flags.ts` `governanceViolation()` — 저장 검증 함수는 그대로)을 세 지점에서 다시 본다: ① **실행 시작**(`claimAndCreateRun()` 트랜잭션 맨 앞 — 수동 실행·적재 승인·예약 · **PREVIEW 포함**) → `409 KB_INGEST_NOT_ALLOWED` + `details[{ field, message: GOVERNANCE_* }]` · 문구 "거버넌스 모드에서는 개인정보 마스킹을 끌 수 없습니다. 소스를 수정해 마스킹을 켜 주세요."(원본 파일 사유는 서버 설정·운영자 요청 안내) ② **예약**(스케줄러 사전 판정 → 이번 예약 건너뜀 · `nextRunAt` = 다음 예약 시각 · 감사 `[예약 실행 건너뜀]` 예약 시각당 1건) ③ **적재 제출 직전**(`terminateIfGovernanceBlocked()` — 실행 CANCELLED + `failureCode` `GOVERNANCE_*` · 외부 호출 0 · 감사 `[적재 차단]` 1건 — pass 10 · §25 I-95). 근거: 원문 유출은 되돌릴 수 없고 문서 1건 삭제 API가 없다(K-1). 이미 적재된 문서·외부 파일 이름은 불변 · 이미 접수된 외부 작업은 계속(K-18) · 해소 = 소스를 수정해 마스킹을 켜거나 원본 파일 전달을 끔(`configVersion` 증가 → 다시 미리보기) · 사용자 결정 대기는 §25.5 U-1·U-2(현행 유지 확인 대기 — §25.6) · U-3은 pass 10 채택 완료 |
| 금지어 | 적재 문서에 적용하지 않는다(근거 원문 보존 — 최종 답변은 기존 출구 금지어 필터 — EX-KB-12) |
| ADR-0013 적용 지점 | **7번째 = 지식베이스 적재 송신**(함수 1벌 · 순서 불변 — 저장 경로가 아니라 외부 송신) |
| 원문 저장 | DB·디스크 0(FR-0-210 · KB-10) — 제목만 마스킹 후 ≤200 **[pass 10 해소 — §25 I-93: 마스킹 먼저 → 200자(코드 포인트 · 서로게이트 쌍 보존) 절단 · `piiMask = false` 소스는 절단만 · 문서 목록 API는 저장값(마스킹됨) 그대로 · 파일 형식(PDF·OOXML)은 제목 추출·저장·전송 경로 없음(원본 바이트 · 파일 이름은 해시)]** |
| 로그 | `kb-sync/**`의 로그는 `kbLogLine({ host, path, code })` 1형식만(쿼리·헤더·본문·오류 원문 0 — 호스트는 소문자, 경로는 120자 절단) · 외부 RAG 오류 원문(`error`) 저장·로그 0(KB-15 · AC-KB6-4) · **구현(§25 I-41)**: 예외는 `kbLogLine({ …, code: kbErrorCode(e) })`로 오류 코드/클래스명만(`e.message`·`${e}`·`String(e)` 금지 — 템플릿 문자열 포함) · 부팅 점검 실패 로그는 고정 문구 |
| 응답 해석 | 스크립트 실행 0 · DOCTYPE/엔티티 거부 · 압축 해제 상한 · 작업 스레드 샌드박스(§7) |
| 권리 확인 | 등록 시 `rightsConfirmed: true` 필수 · 확인자·시각 저장 + 감사(FR-KB1-7) |
| 법적 | robots 항상 준수 · 식별 UA · 운영 가이드에 "자사·계약상 이용 권한이 있는 사이트만" 명시(FR-KB9-2) |

---

## 11. API (FR-KB7 · §4.8 확정)

| 메서드 · 경로 | 권한 | 설명 |
|---|---|---|
| `GET /kb-sources` | `security:read` | 목록(이름·스코프·주기·마지막 실행·다음 실행·정리 필요·반복 실패·활성) · 페이지네이션 |
| `GET /kb-sources/meta` ⚠ `:id`보다 **먼저 선언** | `security:read` | 전송 전제·RAG 상태·형식·상한·허용 목록 설정 여부·거버넌스 모드·실패 소스 수(메뉴 배지) |
| `POST /kb-sources` | `security:write` | 등록(권리 확인 필수 · 호스트 검증 · 소스 ≤50 `LIMIT_EXCEEDED` · 이름 중복 `DUPLICATE_NAME`) |
| `GET /kb-sources/:id` | `security:read` | 상세(+ 진행 중 실행 요약) |
| `PATCH /kb-sources/:id` | `security:write` | 부분 수정(범위 필드의 **실제 값**이 바뀔 때만 `configVersion+1` · 그때 실행 중이면 `409 KB_SOURCE_BUSY` — 구현 §25 I-38 · 서버 상한·거버넌스 검사는 등록과 같이 적용 — I-37 · `enabled=false`는 진행 중 실행 중지 — I-45) |
| `DELETE /kb-sources/:id` | `security:write` | 우리 기록만 삭제(실행 중 `409`) |
| `POST /kb-sources/:id/runs` `{ kind, acknowledgeCleanup? }` | `security:write` | 수동 실행(`SYNC`·`FULL_RESEND`는 승인·ACK 필요 → `409 KB_INGEST_NOT_ALLOWED` · [pass 8 — §10] 거버넌스 규칙 위반 소스는 **모든 종류(PREVIEW 포함)** `409 KB_INGEST_NOT_ALLOWED`(`GOVERNANCE_*`)) · `202 { runId }` |
| `POST /kb-sources/:id/approve-ingest` `{ previewRunId }` | `security:write` | 미리보기 확인 후 적재 시작(§9.8 · [pass 8] 거버넌스 규칙 위반 = `409 KB_INGEST_NOT_ALLOWED`(`GOVERNANCE_*`) — 승인 기록 없음) · `202 { runId }` |
| `POST /kb-sources/:id/runs/:runId/cancel` | `security:write` | 중지 |
| `GET /kb-sources/:id/runs` | `security:read` | 실행 이력(최근 순 · 페이지네이션) |
| `GET /kb-sources/:id/runs/:runId` | `security:read` | 실행 상세(진행률·예상 시간·대기 사유) |
| `GET /kb-sources/:id/documents` | `security:read` | 문서 목록(상태·정리 필요·실행별 관측·제외 사유 필터 · 페이지네이션 필수) |
| `GET /chatbots/:chatbotId/kb-status` | `chatbot:read` | 답변 설정 화면 읽기 카드(이 챗봇 스코프로 적재하는 소스 — 이름·마지막 동기화·정리 필요 수 · URL·호스트 미노출) |

- 총 **13 핸들러 · 컨트롤러 2** · `@Public()` **0**(FR-0-207) · 공개 대화 요청·응답 스키마 불변.
- `KB_SYNC_ENABLED=false`면 13개 모두 `404 NOT_FOUND`(OMNI 선례 — 콘솔은 `meta` 404로 메뉴·카드를 숨긴다 · R-20).
- 챗봇 카드의 매칭: 소스 `scopeCompany = ragCompany` ∧ (챗봇 `ragCategory` 없음 ∨ 같음) ∧ (챗봇 `ragSubcategory` 없음 ∨ 같음) — 챗봇 **초안의 답변 설정** 기준(스코프는 스냅샷에도 있으나 외부 문서는 버전이 없다 — J-15). 챗봇 스코프 규약(교차 404 · `ARCHIVED` 조회 허용)을 따른다. 구현: 서브카테고리 조건이 빠져 있던 버그를 고쳐 3단 모두 적용한다(챗봇 값이 있을 때만 조건 추가 — §25 I-22).
- 새 `ApiErrorCode` 3종(§4). 호스트 거버넌스 차단 = 기존 `EGRESS_HOST_NOT_ALLOWED` · 형식 = `VALIDATION_FAILED` · 없음·꺼짐 = `NOT_FOUND`.

---

## 12. 관리자 콘솔 (ui-designer / frontend-implementer 인계)

| # | 화면 | 핵심 |
|---|---|---|
| 1 | 메뉴 "지식베이스 동기화"(보안·연동 영역, API 연결 옆) | `security:read`만 · `meta` 404면 숨김 · 배지 "동기화 실패 N"(색 + 텍스트) |
| 2 | 소스 목록 | 이름 · 적재 위치(회사/카테고리/서브카테고리) · 주기 · 마지막 실행(상태 텍스트 병기) · 다음 실행 · 정리 필요 · 반복 실패 · 활성 · "미리보기 필요" 표식 |
| 3 | 소스 등록·수정 폼 | 라벨·도움말·오류 연결 · 용어 풀이(robots.txt = "사이트가 정한 수집 허용 규칙", 사이트맵, 깊이, 잡음 줄) · 사설 주소 거부 시 "서버 운영자에게 사설망 허용을 요청하세요" · 인증 = 헤더 이름 + 비밀 참조 이름(값 입력란 없음) · 개인정보 옵션(거버넌스 ON이면 끄기 비활성 + 사유) · 권리 확인 체크(필수) · 스코프 경고(같은 3단을 다른 소스가 사용 · 이 스코프를 읽는 챗봇 없음 — 저장 응답 `warnings[]`) · 범위 필드 변경 시 "저장하면 다시 미리보기가 필요합니다" |
| 4 | 미리보기 결과 · 적재 시작 확인 | 적재 예정(새로·바뀜) · 변경 없음 · 제외(사유별 · 목록) · 마스킹 건수 · 원본 파일 PII 건수 · 최대 페이지 도달 경고 · 강등 사유 · **"적재 시작"** — 전송 전제 미충족·RAG 미설정이면 비활성 + 사유 텍스트 · 확인 대화상자(문서 수 × 평균 시간 = 예상 소요) |
| 5 | 실행 이력 · 진행 | "312개 중 120개 완료 · 약 3시간 남음" 텍스트 · 대기 사유("외부 RAG 준비 안 됨", "야간 적재 시간 대기") · 5초 재조회 · **상태가 바뀔 때만** `aria-live="polite"` 알림(UIUX 준수기준 §비동기 대기·실시간 갱신 규칙) · 중지 버튼 |
| 6 | 문서 목록 | 표시 URL(경로까지) · 상태 · 정리 필요 사유 · 마지막 변경·적재 · 외부 파일 이름(외부 RAG에서 정리할 때 찾는 키) · 필터(상태·사유·실행) |
| 7 | 정리 필요 안내 · 전체 다시 적재 | S-3 문구 · 서브카테고리 이름 복사 버튼 · "외부 RAG에서 정리했습니다" 체크(= `acknowledgeCleanup`) · 확인 대화상자(포커스 가두기 · Esc · 예상 시간) |
| 8 | 챗봇 답변 설정(RAG 영역) 읽기 카드 | `chatbot:read` · 소스 N개 · 마지막 동기화 · 정리 필요 N · 환경 모드 챗봇이면 "지식베이스 동기화는 환경과 무관하게 즉시 반영됩니다" |
| 9 | 데이터 지도 | 새 절 "지식베이스 동기화"(소스별 호스트·판정·마스킹·원본 파일 허용·스코프 회사·전송 전제) · 출구 라벨 `KB_CRAWL` |

- 신규 UIUX 규칙 없음 — 기존 "비동기 대기 패턴"(시각 + 텍스트 · 상한 대기 후 종료 문구)·"실시간 목록 갱신"(포커스·스크롤 유지 · 새 사건 1회 알림)·폼 규칙으로 충족한다.

---

## 13. 권한 · 감사 (P-8 · FR-KB1-8 · FR-0-209)

- **신규 권한·역할 0**(`Permission` 18 · 역할 4 불변). 관리 = `security:write`(No.26 전역 연결과 같은 등급 — 새 외부 출구를 여는 전역 설정) · 조회 = `security:read` · 챗봇 카드 = `chatbot:read`(EDITOR·AGENT·VIEWER 포함 — URL 미노출이라 안전).
- 감사(`AuditTargetType` **`KbSource`** — 33 → 34 · `AuditAction` 추가 0):

| 동작 | 액션 | 비고 |
|---|---|---|
| 등록 | `CREATE` | after = 화이트리스트(헤더 **이름**·비밀 **참조 이름**까지 · 값 0) · 권리 확인자·시각 |
| 수정 | `UPDATE` | before/after · `configVersion` 증가 여부 요약 |
| 삭제 | `DELETE` | 문서 행 수 요약 |
| 일시중지·재개 | `STATUS_CHANGE` | summary `[일시중지]`·`[재개]` — `enabled`가 실제로 바뀔 때만 · 일시중지는 진행 중 실행 중지 포함(구현 §25 I-45) |
| 수동 실행(종류)·중지 | `STATUS_CHANGE` | summary `[수동 실행] 미리보기` 등 |
| 적재 시작(승인) | `STATUS_CHANGE` | 미리보기 실행 id · 적재 예정 수 |
| 전체 다시 적재 | `STATUS_CHANGE` | `acknowledgeCleanup` 여부 · 대상 수 |

- 예약 실행·자동 강등·작업 전이는 감사가 아니다(실행 이력에 남는다 — No.41 발송 1건 선례).
- `AUDIT_FIELDS.KbSource` = `name, seedUrls, sitemapUrls, pathPrefixes, excludePatterns, noisePatterns, allowQueryUrls, maxDepth, maxPages, fileTypes, maxFileBytes, minIntervalMs, scopeCompany, scopeCategory, scopeSubcategory, scheduleKind, scheduleTime, scheduleWeekday, authKind, authHeaderName, authSecretRef, piiMask, allowRawFileIngest, enabled, configVersion` — 값 비밀 필드는 존재하지 않는다.

---

## 14. 환경(No.40) · 버전 · 영구삭제 · 자산 이전

- **지식베이스는 환경 밖 자원**이다(J-15) — 외부 RAG 문서는 버전이 없고 적재 즉시 그 스코프를 읽는 **모든 챗봇·모든 환경**의 답변이 바뀐다. 챗봇 카드가 안내한다(EX-KB-20).
- 소스·문서·실행은 **스냅샷·복원·복사·토픽 분리·자산 이전 대상이 아니다**(전역 · 챗봇 FK 0).
- 챗봇 영구삭제: 사전검사 16종·동반 삭제 24테이블 **불변**(KB 테이블에 챗봇 참조 없음).
- 답변 설정의 스코프(`ragCompany` 등)는 기존대로 스냅샷에 포함된다 — 이 그룹은 답변 설정 스키마를 바꾸지 않는다.

---

## 15. 봉인 · 정적 검사 — `apps/api/src/kb-sync/lib/kb-sync-sealing.spec.ts`

(검사 대상: 운영 코드 `*.ts` — `*.spec.ts`·`src/integration/**` 제외, 주석 줄 제외 · 스캔 0건 아님 가드 · 주요 단언은 **역검증 픽스처** 포함 · 금지 문자열은 **조각 조립**(`rag-allowlist.spec.ts` 규약).)

| # | 단언 |
|---|---|
| KB-1 | `Object.keys(RAG_PATHS)` = {`QUERY`,`STATUS`,`DOCUMENT_METADATA`,`INGEST`,`TASK_STATUS`} 정확히 · `INGEST`·`TASK_STATUS` 값 리터럴 일치 |
| KB-2 | 저장소 스캔 루트(`rag-allowlist.spec.ts`와 같은 6곳)에 작업 목록(`'/api/async_ta' + 'sks'`)·작업 취소(`'/api/async_task_ca' + 'ncel'`) 문자열 0 · 역검증: `'/api/async_task_status/'`는 두 패턴에 걸리지 않는다 |
| KB-3 | `file_path`·`force_sync` 문자열(조각 조립) — `rag/rag-http.client.ts`·`rag/lib/rag-paths.ts`·`kb-sync/**`·`shared-types/src/kb-sync.ts`에 0 · `apps/api/src` 운영 코드의 `file_path` 보유 파일 = {`rag/lib/rag-response.schema.ts`, `rag/lib/sanitize-sources.ts`} 정확히 |
| KB-4 | `rag-http.client.ts`: `fetch(` 1회 · `assertEgressAllowed(` 1회(앞) · 공개 메서드 이름 집합 = {`isConfigured`,`query`,`status`,`documentMetadata`,`ingest`,`taskStatus`} · `'DELETE'` 리터럴 0 · `.append(` 첫 인자 = {`'file'`,`'company'`,`'category'`,`'subcategory'`} 각 1회 · `send(`의 첫 매개변수 타입 `RagPathKey` |
| KB-5 | `TASK_STATUS` 경로 결합은 `RagTaskId` 브랜드 값만 — `rag-task-id.ts` 밖에서 `as RagTaskId` 0 · 런타임: 비UUID·대문자 혼합·경로 문자(`../`) 입력에 `fetch` 호출 0 |
| KB-6 | `EGRESS_REGISTRY`에 `KB_CRAWL`(files ⊇ fetcher) · `kb-sync/**`의 `transport.request(` 보유 파일 = fetcher 1개 · fetcher의 `checkEgress('KB_CRAWL'`가 `this.transport.request(`보다 앞 · `ingest(`·`taskStatus(` 호출 파일 = `kb-ingest.runner.ts` 1개 |
| KB-7 | `kb-sync/**`에 `fetch(`·`node:http`·`node:https`·`node:dns`·`axios` 0 · `LegacyApiHttpClient`·`ValidatedLegacyRequest`·`LEGACY_API_SECRET` 심볼 0 · `legacy-api/` import ⊆ {`transport/legacy-transport.port`, `transport/node-http.transport`, `transport/node-dns.resolver`, `lib/ip-policy`} |
| KB-8 | `@Public()` — `kb-sync/**` 0 · 전체 8 · `Permission.options.length === 18` · `kb-sync/**` `@RequirePermission(` 인자 ⊆ {`security:read`, `security:write`, `chatbot:read`} |
| KB-9 | `kbSource`의 `create｜createMany｜update｜updateMany｜upsert｜delete｜deleteMany` 호출 파일 = {`kb-sync/kb-sources.service.ts`} · `kbDocument`·`kbJobLease` 쓰기 = {`kb-sync/core/kb-run.store.ts`} · `kbSyncRun`·`kbIngestJob` 쓰기 = {`kb-run.store.ts`, `governance/writer/governance-data.writer.ts`(deleteMany만)} |
| KB-10 | `schema.prisma`의 `KbDocument`·`KbSyncRun`·`KbIngestJob`·`KbJobLease` 블록에 `body｜content｜html｜text｜bytes｜raw｜payload｜header` 이름의 컬럼 0(허용: `contentHash`·`textLength`·`title`) · `KbSource`에 `secret`·`authHeaderValue`류 컬럼 0 |
| KB-11 | `KB_SECRET__` 문자열 보유 파일 = `kb-sync/crawl/kb-secret.resolver.ts` 1개(`env.validation.ts`에도 없음) |
| KB-12 | `PollingLoop` 사용 = `kb-sync/engine/kb-sync.job.ts` 1개 · `kb-sync/**` `setInterval(` 0 · `jest.isolate-env.js`에 `process.env.KB_SYNC_ENABLED = 'false';` 존재 |
| KB-13 | `kb-sync/**`에 `governance/`·`job-lease`·`governance-data.writer` import 0(G-10 보강) |
| KB-14 | 마이그레이션 `20260927150000_kb_crawling` SQL에 `DROP`·`ALTER TABLE`·`WHERE` 0 · `CREATE TABLE` 5 · `$queryRaw`·`$executeRaw` 보유 파일 수 불변 · (통합) 적용 DB 부분 인덱스 4 · **[pass 6]** 두 번째 마이그레이션 `20260928100000_kb_document_parent`(`ALTER TABLE … ADD COLUMN` 1 + `CREATE INDEX` 1)는 이 정적 검사 대상 밖 — 정식 검사 KB-14b(아래 — pass 8) |
| KB-14b | [pass 8 — §25 I-87 · 이전 §25.4 RG-22⑤] `20260927150000_kb_crawling` **이후**의 KB 마이그레이션(디렉터리 이름이 첫 파일보다 뒤 ∧ `kb_` 포함) 각 SQL은 주석 제외 문장이 전부 ⓐ `ALTER TABLE "kb_…" ADD COLUMN "…" <타입>`(nullable — `NOT NULL`이면 `DEFAULT` 필수) 또는 ⓑ `CREATE INDEX "kb_…" ON "kb_…"(…)`뿐 · `DROP`·`DELETE`·`UPDATE`·`INSERT`·`WHERE`·`PRAGMA`·테이블 재정의 0 · 대상 목록에 `20260928100000_kb_document_parent`·`20260928120000_kb_document_observed_hash`가 있어야 함(검사 0건 방지) · 역검증 픽스처(`UPDATE … WHERE`·`DROP COLUMN`·`DEFAULT` 없는 `NOT NULL`·SQLite 재정의 4문장·`kb_` 밖 테이블 = 위반) |
| KB-15 | `kb-sync/**`의 `logger.(log｜warn｜error｜debug)(` 인자는 `kbLogLine(` 호출뿐 · `kbLogLine` 입력 타입에 `url`·`headers`·`body`·`query` 필드 0 · (런타임) 로그 캡처 시험 — 가짜 비밀 값·쿼리 토큰·본문 문장이 로그·응답·감사 행에 0 · **[구현 강화 — §25 I-41]** `kb-sync/**`와 `rag/rag-http.client.ts`의 logger 인자에 `.message`·`${e}`·`String(e)`(템플릿 문자열 포함) 0 + 역검증 픽스처 · 예외 표기 = `kbErrorCode(e)` |
| KB-16 | `kb-sync/**`·`extract.worker.ts`에 `eval(`·`new Function(`·`node:vm`·`jsdom`·`puppeteer`·`playwright` 0 · `pdfjs-dist` import 파일 = `kb-sync/lib/pdf-text.ts` 1개 · 그 파일에 `isEvalSupported: false` 존재 · `extract.worker.ts`의 import ⊆ `kb-sync/lib/*`·`@chat-bot/pii-mask`·`node:worker_threads`·`node:crypto`·`node:zlib` · (구현: `common/lib/import-esm.ts`의 상수 인자 `new Function`은 검사 범위 `kb-sync/**`·`extract.worker.ts` 밖 — §25 I-1) |
| KB-17 | `sitemap-parse.ts`에 `xmlMode: true` 존재 · (런타임) `<!DOCTYPE`·`<!ENTITY` 포함 픽스처 거부 · 해제 51MB gzip 픽스처 → 오류(프로세스 정상) |
| KB-18 | `packages/dialogue-engine/src`·`apps/widget/src`·`apps/ml-worker`·`conversation/**`에 `KbSource｜KB_SYNC｜KB_CRAWL｜kb-sync` 0 |
| KB-19 | `kb-sync/**`에 `ragCallLog`·`RagGateService`·`RagCallLogService`·`RagAnswerService` 심볼 0 |
| KB-20 | (런타임) `buildExternalFileName` 결과가 `^kb_[0-9a-f]{8}_[0-9a-f]{16}\.(docx\|txt\|html\|pdf\|xlsx\|pptx)$` · 같은 입력 = 같은 이름(속성 시험 1,000건) · 파일 이름 생성 함수 보유 파일 1개 |
| KB-21 | `governance-map.service.ts`의 `exits` 제외 목록에 `'KB_CRAWL'` 존재 · (런타임) 소스 0개 설치의 데이터 지도 응답에 `kbSources` 키 없음 |
| KB-22 | `kb-sync/**`의 `z.coerce.boolean(` 0(쿼리 = `queryBoolean()`) · `env.validation.ts`의 `KB_*` boolean 2종이 `envBoolean(` |

---

## 16. 성능 예산 (NFR-KBP)

| 항목 | 예산 | 근거·측정 |
|---|---|---|
| 공개 대화(기능 꺼짐·소스 0) | 지연·응답·쿼리 수 **불변** | 루프 미시작 · 경로 공유 0 |
| 공개 대화(크롤·적재 진행 중) | P95 증가 **< 10%** · 이벤트 루프 차단 ≤ 5ms/문서 | 해석·해시 작업 스레드 · 실측 기록(500쪽 크롤 + 적재 중 부하 시험) |
| 유휴 tick | **쿼리 2개**/주기(10초) | §2.3 |
| 크롤 | 500쪽 · 간격 1초 ≈ **10분**(네트워크 제외 처리 ≤ 50ms/쪽 — 작업 스레드) **[pass 6 — §25 I-67: 조각 안 대기 + 실행별 예산 분할로 tick 크롤 예산(25초)을 요청 간격으로 채운다 → 예산 충족 예상 · 500쪽 실측 전(재측정 필요) · 이전 pass 5 = 500쪽 ≈ 85분 이상(§25.2 RG-17)]** **[pass 7 — §25 I-75 · K-19]** 리다이렉트 홉의 강제 대기로 문서 1건이 조각 예산을 최악 (홉 수 × 실효 간격)만큼 넘길 수 있다(실효 상한 300초 · 최대 약 900초 — 그동안 같은 인스턴스·같은 tick의 다른 실행·적재 조각이 밀린다 · 기본 간격 1초면 수 초). **[pass 9 해소 — §25 I-92]** 강제 대기 제거 — 리다이렉트 진행 상태를 저장해 조각마다 한 홉씩 진행하므로 문서 1건이 조각 예산을 넘겨 점유하지 않는다(500쪽 예산 실측은 여전히 필요). | NFR-KBP2 |
| 메모리 | 크롤러 전체 ≤ **256MB**(작업 스레드 힙 192MB + 버퍼) | §7.3 |
| DB 쓰기 | 방문 URL당 1(+ 링크 배치 1) · 적재 작업 전이당 1~2 | — |
| 외부 RAG 호출 | ≤ `KB_RAG_CALLS_PER_MIN`(30/분 — 외부 한도 200의 15%) · 슬롯 1 기준 실제 ≈ 8/분 | NFR-KBP3 |
| 변경 없는 재실행 | 외부 적재 호출 **0** | AC-KB3-1 |
| 관리 API | 소스 목록 P95 300ms(소스 50 · 쿼리 ≤4 고정) · 실행 상세 200ms(쿼리 3) · 문서 목록 300ms(문서 5,000 · 페이지 50) · 챗봇 카드 100ms(쿼리 2) | — |
| 데이터 지도 | 소스 0 = 쿼리 +1(존재 확인 `count`) · 소스 ≥1 = +2 · P95 1초 유지 | ADR-0040 예산 |
| 파기 | 기존 배치 500·양보 200ms 규약 안에서 2모델 추가 | — |

- 예산 미달을 이유로 상한(쪽 수·파일 크기·간격·주기)을 조용히 바꾸지 않는다 — 설계 문서 갱신 후 조정.

---

## 17. 시험 전략 (test-automation 인계)

### 17.1 층별 핵심

| 층 | 핵심 |
|---|---|
| 순수 함수 | ★ `url-normalize`(프래그먼트·기본 포트·`..`·쿼리 정렬·대소문자·퍼센트 인코딩·IDN) · `scope-match`(하위 도메인 비포함 · 경로 접두 · 글롭 · 깊이) · `glob-match`(선형 시간 — 병적 입력 10만 자 ≤ 10ms) · ★ `robots`(그룹 선택·최장 일치·`Allow` 우선·`*`/`$`·`Crawl-delay`·4xx=허용·5xx=중단·512KB) · `sitemap-parse`(색인 1단계·DOCTYPE/ENTITY 거부·50MB) · `redirect-policy`(3회·4번째 거부·범위 밖·https→http 거부·순환) · `html-extract`(제거 요소·`main`·제목 접미·200자 미만·noindex/nofollow·canonical) · `charset`(EUC-KR 픽스처 · 대체 문자 비율) · ★ `change-detect`(304·해시·지문·축소 50%) · ★ `missing-detect`(2회 규칙·복귀·5xx 미산입·PREVIEW 미산입·상한 도달 미산입·aborted host) · `run-guards`(새로 비율 20·50% 경계 · 인증 벽 80%) · `external-file-name`(KB-20) · `ingest-document`(머리 3줄·마스킹 건수·쿼리 제거) · `docx-writer`(결정적 바이트 · 제어 문자 · 이스케이프 — 생성물을 `fflate`로 다시 풀어 XML 검증) · `container-guard`(항목 수·비율·총량·경로·매크로·OLE2) · `schedule-next`(KST 경계·주 경계·따라잡기 1회) · `backoff` · `ingest-lane` · `eta` · ★ `parseIngestResponse`·`parseTaskStatus`·`judgeIngestResultText` — **`API_RAG.md` 248~285·472~528행 응답 예시를 그대로 픽스처**(NFR-KBM3) · `toRagTaskId` |
| 전송·출구 | 가짜 전송·가짜 DNS: ★ AC-KB2-1(사설 IP 허용 목록 유/무 · `169.254.169.254`는 목록에 있어도 거부) · ★ AC-KB2-4(B 호스트로 302 거부 · A 안 3회 추종 · 4번째 중단) · 재바인딩(두 번째 DNS 응답이 사설이어도 고정 주소로만 연결) · 헤더는 시작 호스트에만 · 전송 선택 필드 기본값 = 현행(레거시·웹훅 기존 spec 무수정 통과) |
| RAG 클라이언트 | `fetch` 목: 멀티파트 필드 4개·`file` 이름·`Content-Type` 미지정 · JSON 경로 바이트 불변 · 모드 ON 출구 차단 · 비UUID `taskStatus` 송신 0 |
| 서비스(목) | 저장 검증(권리 확인·스코프 3단·호스트 판정·거버넌스 ON 마스킹 끄기 거부·원본 파일 허용 거부) · `configVersion` 증가 필드 표 · 실행 중 수정 409 · 승인 조건 5종 · 감사 1건씩(헤더 값 0) |
| 엔진(통합 · `migrate deploy` DB · 가짜 전송·가짜 외부 RAG) | ★ AC-KB3-1(두 번째 SYNC 적재 호출 0) · ★ AC-KB4-1(작업 3개 · 동시 진행 항상 1 · 잡 인스턴스 2개 동시 `tick()`) · ★ AC-KB4-2(`completed`+"실패." → FAILED 경로) · ★ AC-KB4-3(`not_found` 1회 재전송 · 두 번째 FAILED) · AC-KB4-4(vLLM false → 제출 0) · AC-KB4-5(429 백오프 3회 · 400 재시도 0) · ★ AC-KB4-8(ACK 없음 → PREVIEW 성공 · 승인·SYNC 409 · 외부 호출 0) · ★ AC-KB5-2(두 인스턴스 같은 tick → 실행 1) · ★ AC-KB5-3(크롤 중 임대 만료 → 다른 인스턴스가 남은 QUEUED부터 · SUBMITTED 작업은 같은 taskId 계속 조회 · 성공 문서 재전송 0) · AC-KB5-4(중지 → UNKNOWN · 취소 호출 0) · AC-KB5-5(보존 파기 — 종단 행만) · EX-KB-5 강등 · EX-KB-7 인증 벽 · 적재 시점 재수집 404 → SKIPPED |
| 개인정보·보안 | ★ AC-KB6-1(휴대전화 번호 HTML → 적재 파일(DOCX를 풀어 확인) 마스킹 · `piiMasked ≥ 1`) · AC-KB6-2·3 · ★ AC-KB6-4(로그 캡처: 가짜 비밀 값·`?token=`·본문 문장 0) · AC-KB6-5(XXE·gzip 폭탄) · AC-KB6-6(데이터 지도 `kbSources`) · zip bomb OOXML 픽스처 · 매크로 DOCM 이름 위장 픽스처 · 암호 PDF |
| 회귀 | ★ AC-KB1-1(기능 꺼짐 — 전 시험 X 목록 외 무수정 · 데이터 지도·공개 대화 응답 바이트 비교) · 소스 0개 + 기능 켜짐 — 지도 `kbSources` 없음 · 공개 대화 쿼리 수 불변 |
| 콘솔(vitest) | 폼 라벨·오류 연결 · 거버넌스 ON 비활성 사유 · 미리보기 "적재 시작" 비활성 사유 · 진행률 텍스트 · 상태 변화 시에만 live 알림 · 확인 대화상자 포커스 가두기·Esc · 메뉴 배지 · 챗봇 카드 · 데이터 지도 새 절 |
| 봉인 | KB-1~KB-22 + 기존 G·W·L·RM·O·H·F·T·S·V·E·D·R 봉인 불변 |

### 17.2 시험 작성 원칙

- **★ 상대 시각**: 예약·임대·백오프·보존·ETA 시험의 시각은 전부 **`now` 기준 상대값**(`new Date(now.getTime() − 11 * 60_000)` 등)으로 만든다 — 절대 날짜 리터럴 금지. KST 경계 시험도 "오늘 KST 03:00"을 계산해서 쓴다. 순수 함수는 `now`를 인자로 받고 `Date.now()`를 부르지 않는다(`schedule-next`·`backoff`·`eta`·`missing-detect`).
- **루프 시험**: `process.env.KB_SYNC_ENABLED = 'true'` 등을 **먼저** 설정하고 `await import('../app.module')`(동적 import) — 정적 import spec의 `beforeAll` 설정은 무시된다(CLAUDE.md). 루프 타이머를 기다리지 않고 **`KbSyncJob.tick()` 직접 호출**로 한 단계씩 진행한다.
- **다중 인스턴스**: 같은 프로세스에서 `KbSyncJob`(및 store·임대) 인스턴스 2개를 서로 다른 `instanceId`로 만들고 `Promise.all([a.tick(), b.tick()])`.
- **통합 DB = `prisma migrate deploy`**(부분 인덱스 4 확인 포함 — `db push` 금지).
- **가짜 외부 RAG**: `RagHttpClient`를 목으로 바꾸지 않고 **전역 `fetch` 목**으로 `API_RAG.md` 예시 본문을 돌려준다(클라이언트의 멀티파트 조립·판정까지 시험 범위에 넣는다).
- **가짜 사이트**: 전송 포트(`KB_TRANSPORT`)·DNS(`KB_DNS_RESOLVER`) 토큰을 가짜로 — 실제 네트워크 0. 작업 스레드는 `InProcessExtractor`.
- **boolean**: 쿼리 `queryBoolean()` · 환경변수 `envBoolean()` — `z.coerce.boolean()` 금지(KB-22).
- 외부 RAG 실측(Q-6)은 자동 시험이 아니라 운영 절차다(시험 결과에 의존하지 않는다).

### 17.3 ★ 의도된 기존 시험 기대값 변경 (닫힌 목록 — FR-0-212 확정)

| # | 파일 | 변경 | 이유 | 커밋 |
|---|---|---|---|---|
| **X-1** | `apps/api/src/rich-messages/lib/rich-message-sealing.spec.ts`(196~198행 RM-8) | `EgressExitId.options.length` 기대값 **6 → 7** · 제목 "6종 그대로다(서버 출구 추가 0)" → "7종(No.43 `KB_CRAWL` 추가 — 리치 메시지 서버 출구는 여전히 0)" · 같은 describe의 첫 단언(리치 메시지 파일의 출구 심볼 0)은 불변 | 7번째 출구 클래스 | ① |
| **X-2** | `apps/api/src/common/auth/public-decorator-count.spec.ts`(112·170행 부근) | 전수 스캔 목록 +`KbSourcesController`·`ChatbotKbStatusController`(import·목록·제목 문자열 **46 → 48**) · `@Public()` 8 단언 **불변** | 신규 컨트롤러 2 | ③ |
| **X-3** | `apps/api/src/rag/rag-answer.service.spec.ts`(17·20행 결과 헬퍼) · `rag/rag-http.client.spec.ts`(114·122·130·209행) · `rag/lib/parse-ingest-response.spec.ts` · `rag/lib/parse-task-status.spec.ts`(뒤의 둘은 이 그룹 커밋 ①에서 만든 파일) | 결과 기대 객체에 `retryAfterMs`(`null` 또는 해석값)를 더한다 — 기계적 변경(단언 대상의 의미 변화 없음) | `RagSendResult`·`parseIngestResponse`·`parseTaskStatus` 결과 타입에 `retryAfterMs` 추가(§25 I-19) — **구현 단계에서 추가**(설계 시점 닫힌 목록 밖 · 오케스트레이터 승인) | I-19를 도입한 커밋 |

- **요구사항 FR-0-212가 예상했으나 변경이 필요 없는 항목**: `RAG_PATHS` 개수 단언(존재하지 않음 — `rag-allowlist.spec.ts`는 참조 파일만 검사 · 무수정) · 레지스트리 파일 집합 G-1(레지스트리에서 동적으로 읽음 — 제목 문자열 "6파일"은 서술이라 무수정) · 데이터 지도 응답 스냅샷(소스 0 = `kbSources` 생략 · `exits[]`에서 `KB_CRAWL` 제외 → 바이트 동일) · 영구삭제 사전검사·동반 삭제(챗봇 참조 없음).
- **확인 항목(변경 예상 0)**: `rag-allowlist.spec.ts` · ~~`rag-http.client.spec.ts`(공개 메서드 호출만 — 전송 바이트 불변)~~(→ X-3) · `governance-sealing.spec.ts` G-1·G-2(fetcher 등록·가드 선행)·G-9(대상 4모델 패턴에 KB 모델 없음)·G-10(`kb-sync` → governance import 0) · `workflow-sealing.spec.ts` W-2(`transport.request(` 파일 ⊆ 레지스트리)·W-12·W-17 · `legacy-api-sealing.spec.ts` L-2(`node:http(s)`·`node:dns` import 파일 불변) · `inbox-sealing.spec.ts` O-17·O-20 · `rich-message-sealing.spec.ts` RM-12(부분 인덱스 4)·RM-15(이 그룹 키는 `RICH_*`가 아님) · `topic-sealing.spec.ts` T-10(`AuditAction` 16) · `permission-matrix` 18 · `env.validation.spec.ts`(새 키는 전부 기본값) · `ip-policy.spec.ts`(라벨 기본값 = 현행 문구) · 전송 spec(선택 필드 기본값) · `data-governance-off.integration.spec.ts`(지도 바이트 동일).
- **그 밖의 spec이 깨지면 회귀로 취급하고 멈춘다**(커밋 ①·②·④에서 깨지면 즉시 보고).

### 17.4 커밋 분할안

§2.6 ①~④ — 각 커밋 단독으로 전 시험 통과 · X-n은 표의 커밋에서만(① X-1 · ③ X-2 · X-3은 `retryAfterMs`를 도입한 커밋).

**[pass 12·웹 후속 이후 갱신 — 2026-09-28 · 현재 파일 구성 기준]** 이 그룹은 백엔드 pass 1~12·웹 여러 차례 수정이 모두 미커밋이므로 **최종 파일을 층별로 나눠** 4커밋으로 올린다(중간 pass 이력은 커밋으로 남기지 않는다 — 이력은 §25 편차 기록). §2.6과 달라진 점: ① 의존성(`apps/api/package.json`·`pnpm-lock.yaml`)을 ②에서 **①로** 옮긴다 — `kb-sync/lib`의 순수 함수(`html-extract`·`sitemap-parse`·`ooxml-text` = `htmlparser2` · `gzip-guard`·`container-guard`·`docx-writer` = `fflate` · `pdf-text`)가 ①에서 컴파일·시험되기 때문 ② `apps/web/src/constants/messages.ts`는 파일 하나라 ①에 통째로 넣는다(라벨 사전이 계약 enum에 대한 망라 타입이라 ①의 계약과 같은 커밋이어야 웹 `tsc`가 통과 — 화면 문구도 함께 들어가지만 참조 0) ③ 봉인 `kb-sync/lib/kb-sync-sealing.spec.ts`는 모듈 전체 파일을 검사하므로 ③으로.

| 커밋 | 파일(현재 구성) | 게이트 |
|---|---|---|
| ① 계약·순수 함수 | `packages/shared-types/src/kb-sync.ts`(+ 색인 export·출구·데이터 종류 등 이 그룹의 계약 변경) · `apps/api/src/kb-sync/lib/**`(봉인 spec 제외 — `allowed-origins`·`observed-hash`·`parse-source-row`·`governance-flags`·`run-guards` 등 + 단위 spec) · `apps/api/src/rag/lib/`의 새 파서(`parse-ingest-response`·`parse-task-status`·`judge-ingest-result-text`·`rag-task-id` 등 + spec) · `apps/api/package.json`·`pnpm-lock.yaml` · `apps/web/src/constants/messages.ts` · X-1 `rich-messages/lib/rich-message-sealing.spec.ts` · **`audit-logs/lib/audit-snapshot.ts`**(`AUDIT_FIELDS`가 `AuditTargetType` 망라 타입이라 ①의 `audit.ts`가 `KbSource`를 추가하면 같은 커밋에 항목이 있어야 api `tsc` 통과 — 2026-09-29 ③에서 이동) · **`kb-sync/extract/kb-extractor.port.ts`**(`kb-sync/lib`의 `inspect-raw-file`·`run-extract-job`이 import — import 0인 포트라 ①에 둠, 2026-09-29 ②에서 이동) | shared-types build → api `tsc`·jest(X-1만) · web `tsc`·vitest |
| ② 전송·출구·RAG 클라이언트 | `legacy-api/transport/legacy-transport.port.ts`·`node-http.transport.ts` · `legacy-api/lib/ip-policy.ts` · `common/egress/egress-registry.ts` · `rag/lib/rag-paths.ts` · `rag/rag-http.client.ts` · `kb-sync/crawl/**`(fetcher·`kb-redirect-follow`·`kb-host-pacer`·`kb-secret.resolver` + spec) · `kb-sync/extract/**`(작업 스레드 추출기 + spec — 포트 `kb-extractor.port.ts`는 ①) · X-3 `rag/rag-answer.service.spec.ts`·`rag/rag-http.client.spec.ts` | 모듈 미등록이라 관측 변화 0 · X-3만 |
| ③ 저장·엔진·관리 API | `apps/api/prisma/schema.prisma` · 마이그레이션 3개(`20260927150000_kb_crawling`·`20260928100000_kb_document_parent`·`20260928120000_kb_document_observed_hash`) · `kb-sync/core/**`·`engine/**`·서비스·컨트롤러·가드·매퍼·`kb-sync.module.ts` + spec · `kb-sync/lib/kb-sync-sealing.spec.ts` · `app.module.ts` · `config/env.validation.ts`(+spec) · `jest.isolate-env.js` · `governance/governance-map.service.ts`·`governance/writer/governance-data.writer.ts` · ~~`audit-logs/lib/audit-snapshot.ts`~~(→ ①로 이동) · X-2 `common/auth/public-decorator-count.spec.ts` · 통합 시험 `integration/kb-*.integration.spec.ts`(pass 11·12·13 포함) + 하네스 `integration/helpers/kb-crawl-db-harness.ts`(2026-09-29 명시) · ~~No.42 시험 안정화 `integration/omnichannel-inbox.integration.spec.ts`(I-88 · 기대값 변경 0)~~ → 시험 안정화 커밋 ⓪으로 이동(§25.8) | `prisma migrate deploy` 후 api 전체 jest · X-2만 |
| ④ 콘솔·문서 | `apps/web/src/pages/settings/kb-crawling/**`(`governanceBlock.tsx` 포함) · `App.tsx` · `components/AsyncJobProgress.tsx` · `components/KebabMenu.tsx`(`describedBy?`) · `components/security/SystemSettingsMenu.tsx` · `pages/chatbot-detail/answer-settings/AnswerSettingsPage.tsx` · `pages/settings/data-governance/DataGovernanceMapPage.tsx` + spec · 문서(`docs/02-spec/kb-crawling-설계.md`·`kb-crawling-patches.md`·`kb-crawling-impl-patches.md`·ADR-0044·갱신 ADR 0013/0022/0034/0040/0041·`개발명세서.md`·`nlu-rag-answering-설계.md` · `docs/03-design/kb-crawling-ui-spec.md` · `docs/01-requirements/기능요구사항.md` · `docs/requirements/kb-crawling.md` · `docs/05-ops/자동배포.md` · `docs/04-test/**` No.43 절) | web 전체 vitest · 기대값 변경 0 |

- changelog append는 선행 그룹처럼 별도 문서 커밋(No.46 `a1a66a9` 선례). `CLAUDE.md`의 미커밋 변경은 이 그룹 산출물이 아니다 — **2026-09-29 결정: ④에서 빼고 changelog 커밋에 함께 넣는다**(문구가 "No.43 아직 커밋되지 않았다"라 ④ 직후 거짓이 되므로 커밋 뒤 완료 상태로 고쳐 커밋). 실제 커밋은 ⓪ 시험 안정화 → ① → ② → ③ → ④ → changelog(+CLAUDE.md) 6개이며, 백업 ref(`backup/pre-kbsplit-a1a66a9`)와 최종 트리 동일성(`git diff backup main` 공백)으로 분할 전후 트리가 같음을 확인한다. **중간 커밋 ①·②·③이 각각 단독으로 통과하는지는 개별 검증하지 않았다**(검증된 것은 최종 트리 — api `tsc` 0 · 347 suites / 5,116 passed / 1 skipped, 웹 `tsc` 0 · 198 files / 1,073 tests; import 그래프 검사로 ①이 ②·③을 import하지 않음만 확인).
- git-manager 확인 사항: ① 위 목록은 파일 탐색 기준이다 — 커밋 전 `git status`로 목록 밖 변경(`packages/shared-types`의 색인·다른 계약 파일, `rag/lib`의 새 파일, 웹 spec)을 대조한다 ② 각 커밋 단독 통과(§18 기준선)는 커밋 단위로 작업 트리를 나눠 확인한다 ③ 통합 시험 DB는 `prisma migrate deploy` ~~④ §25.7 RG-28(커밋 전 수정 대상)이 반영된 뒤 분할한다.~~ ④ **[pass 13]** RG-28 반영 완료(§25 I-107) — 분할 착수 가능 ⑤ **[2026-09-29]** 이전 그룹 시험의 간헐 실패 안정화 변경(test-automation — api 통합 시험 16개·`polling-loop.spec.ts`·헬퍼 2개 · 웹 spec 3개)은 No.43이 아니므로 ①~④에 섞지 않고 별도 커밋 ⓪으로 분리한다(구성·순서·사전 확인은 §25.8).

---

## 18. ★ 기능을 쓰지 않을 때 동작 불변 보장 (FR-0-203 · AC-KB1-1 · S-10)

| 경로 | `KB_SYNC_ENABLED=false`(기본) 또는 소스 0개 | 보장 장치 |
|---|---|---|
| 공개 대화·RAG 질의 | 코드 경로·응답·로그·쿼리 수 동일(`RagHttpClient` 기존 3메서드 전송 바이트 동일) | KB-18 · 기존 RAG spec 무수정 |
| 백그라운드 | 루프 미시작(꺼짐) · 소스 0이면 유휴 tick 1쿼리 | `jest.isolate-env.js` · KB-12 |
| 관리 API | 꺼짐 = KB 경로 `404` · 기존 경로 불변 | — |
| 데이터 지도 | `exits[]` 불변(`KB_CRAWL` 제외) · `kbSources` 키 없음 | KB-21 · 통합 바이트 비교 |
| 거버넌스 파기 | KB 테이블 0행이면 추가 쿼리 2(빈 결과)만 · 결과·이력 동일 | writer 단위 시험 |
| 레거시·업무 자동화 | 전송 선택 필드 기본값 = 현행 | 기존 spec 무수정 |
| 통계·학습·설문·평가·상담·인박스·환경·버전 | 불변(테이블·경로 공유 0) | — |
| 영구삭제 | 사전검사 16·동반 삭제 24 불변 | — |
| 기동 | 새 기동 실패 조건 = `ACK=TLS ∧ RAG http`뿐(값을 설정한 경우만) | env 시험 |

- **기준선**: 커밋 ① 적용 후 X-1 외 전 시험 무수정 통과 · ②는 기대값 변경 0 · ③은 X-2만 · ④는 0. (구현 단계 추가: X-3 — `retryAfterMs` 도입 커밋 · §17.3)

---

## 19. 요구사항 추적표 (요약)

| 요구사항 | 설계 |
|---|---|
| FR-0-203 · AC-KB1-1 | §18 · KB-21 |
| FR-0-204 · AC-KB1-2 · NFR-KBS1 | §5.3 · KB-1~KB-5 (R-3) |
| FR-0-205 · AC-KB1-5 | §9.1 · KB-12 |
| FR-0-206 · AC-KB1-3 | §2.4 · KB-18 |
| FR-0-207 | §11 · KB-8 |
| FR-0-208 · AC-KB1-4 | §6.1 · §3.4 · KB-6 · KB-21 (R-2) |
| FR-0-209 | §13 · KB-8 |
| FR-0-210 | §3.1 · §7.2 · KB-10 |
| FR-0-211 | §3.5 · §3.4 |
| FR-0-212 | §17.3 X-1·X-2·X-3 |
| FR-0-213 · FR-KB9-\* | §6.5 · §10 |
| FR-0-214 · FR-KB7-\* · NFR-KBA | §12 |
| FR-KB1-\* · AC-KB2-1·2 | §4 · §6.2 · §6.9 · §9.8 · §13 |
| FR-KB2-\* · AC-KB2-3~8 | §6 · §7.4 · §7.5 · §9.3 |
| FR-KB3-\* · AC-KB3-\* | §8 |
| FR-KB4-\* · AC-KB4-\* | §5 · §9.4 · §9.5 |
| FR-KB5-\* · AC-KB5-\* | §3.3 · §9 · §3.4 |
| FR-KB6-\* · AC-KB6-\* | §5.7 · §6.2 · §10 · §3.4 |
| NFR-KBP | §16 |
| NFR-KBR1~4 | §9.2 · §9.4 · §5.6 · §9.1 |
| NFR-KBM1~3 | §2.1 lib · §17.1 |
| EX-KB-1~22 | §5.6 · §6 · §7 · §8.4 · §9.9 · §10 · §14 |

---

## 20. 알려진 제한

| # | 제한 | 수용 근거 |
|---|---|---|
| K-1 | 사라지거나 짧아진 페이지의 옛 내용이 외부 RAG에 남아 답변에 쓰일 수 있다 | P-3 — 문서 1건 삭제 API 부재 · "정리 필요" 표시 · 재구축 2차 |
| K-2 | 답변 출처(`showSources`)에 `kb_…` 파일 이름이 보인다 | 공개 대화 경로 변경 0(FR-0-206) · 문서 첫 줄 제목·URL로 보완 · 이름 → 제목 매핑은 2차 |
| K-3 | 로그인·SSO·SPA 사이트 미지원 | P-2 · 본문 없음·인증 벽 감지로 드러낸다 |
| K-4 | 첫 적재가 수 시간 | 외부 RAG 처리 속도(Q-6) · 레인·시간창·ETA로 운영 |
| K-5 | 호스트 속도 제한은 인스턴스 메모리 — 다중 인스턴스에서 근사 | 호스트 겹치는 소스 동시 크롤 금지 · 실행당 1인스턴스 · [pass 6] 겹침 금지 판정이 크롤 시작 게이트(DB)라 인스턴스 수와 무관(§6.8 · §25 I-68) — 남는 근사는 같은 실행이 인스턴스를 옮길 때 페이서 상태가 이어지지 않는 것(간격 1회 분량) |
| K-6 | 원본 파일은 마스킹할 수 없다 | P-6 기본 꺼짐 · 사전 검사 건수 표시 · 거버넌스 ON이면 PII 파일 제외 |
| K-7 | `INTERNAL_NETWORK`·`AUTHENTICATED`는 운영자 선언(검증 불가) | TLS만 URL로 검증 · 설치 가이드 확인 절차 |
| K-8 | 변환 형식을 바꾸면 옛 파일이 외부에 남는다 | 확장자가 이름의 일부 · `FORMAT_CHANGED` 표시 · 설치 시 1회 결정 |
| K-9 | 스코프를 바꾸면 옛 스코프 청크가 남을 수 있다 | Q-4 미확인 · `SCOPE_CHANGED` 표시 |
| K-10 | `RagHttpClient.send()`는 응답 전체 수신 · 모드 OFF 리다이렉트 추종(기존) | ADR-0022 No.26 보강 제안 그대로 — 적재·조회 응답은 작다 |
| K-11 | robots 캐시가 인스턴스 메모리(재시작 시 재조회) | 호스트당 하루 수 회 요청 — 영향 미미 |
| K-12 | 다국어 개인정보 형식 마스킹 없음 | `pii-mask` 한국 형식 위주(No.45 2차) |
| K-13 | `not_found` 재전송은 외부에서 끝나 가던 작업과 겹칠 수 있다 | 같은 이름 덮어쓰기라 결과 동일 · 부하만 |
| K-14 | 미리보기와 승인 사이 사이트 변경은 승인 후 크롤에서 반영된다(미리보기 목록과 실제 적재 목록이 다를 수 있음) | 승인 시 재크롤 + 새로 비율 가드가 급변을 다시 막는다 **[pass 10 정정 — §25 I-94]** 승인 SYNC는 새로 비율을 면제하므로 미리보기~승인 사이의 급증은 다시 막지 않는다(인증 벽 가드는 계속 · 다음 예약·수동 SYNC부터 새로 비율도 다시 적용) — 방금 사람이 확인했다는 전제의 절충이며, 면제하지 않으면 승인 루프(RG-23)가 된다 |
| K-15 | [pass 6] 부모 포인터(`discoveredFromId`)는 문서당 1개(그 실행에서 처음 발견시킨 부모)다 — 기록된 부모 A가 200으로 링크를 지웠고 같은 자식을 가리키는 다른 부모 B가 304면, 자식은 이어 방문되지 않아 "다시 발견되지 않음"으로 세어진다(연속 2회 → GONE · 적재된 적 있으면 "정리 필요") | 드문 조합(링크 이동 + 다른 부모 불변) · B가 200을 한 번 주면 복구 · 다대다 링크 표(행 수 = 링크 수)는 2차 |
| K-16 | [pass 6] `discoveredFromId` 도입 전 행은 부모 포인터가 null이라, 부모가 계속 304면 그 자식은 이어 방문되지 않는다(도입 전과 같은 H-2 결함이 그 행들에 남음 — 부모가 200을 주거나 다른 부모가 링크를 다시 보여 주면 채워짐) | 미배포 기능이라 운영 데이터 없음 · 이 그룹 커밋 전 코드로 크롤한 개발·시연 DB는 검증자 1회 초기화 또는 DB 재생성(§25.4) |
| K-17 | [pass 6] pdf.js 내부 자원(FlateDecode 스트림 팽창·폰트·이미지 해석)은 우리 코드가 계수하지 못한다 | 작업 스레드 힙 192MB · 작업 30초 상한이 최후 방어(초과 = `FILE_UNSAFE` · 스레드 재생성) · 텍스트 누적 2MB · 쪽당 20만 조각 · 300쪽 |
| K-18 | [pass 6 확인] 중지해도 이미 외부에 접수된 적재 작업은 외부에서 계속 돈다 | 외부 RAG 취소 API 부재 · AC-KB5-4("외부 취소 호출 0 · 결과 불명")가 정한 의도된 절충 · 같은 이름 덮어쓰기라 결과는 멱등 |
| K-19 | [pass 7] 리다이렉트 홉(홉 ≥ 1)은 조각 예산을 넘겨서라도 호스트 간격을 기다린다 — 간격이 큰 호스트(실효 최대 300초)에서 리다이렉트 문서 1건이 조각을 최악 (홉 수 × 실효 간격, 약 900초)만큼 넘기고, 그동안 같은 인스턴스의 같은 tick에서 다른 실행의 크롤·적재 조각(작업 조회 포함)이 밀린다 | 진행 보장(라이브락 제거 — R4 N-1)이 우선 · 대기 중 임대 갱신·중지 확인(1초 슬라이스)·안전 상한(310초) · 다른 인스턴스는 영향 없음 · 기본 간격(1초)에서는 수 초 · 2차 개선 = 강제 대기 실행을 tick 밖으로 빼거나 홉 상태를 프런티어에 저장해 다음 조각이 홉 N부터 잇기 **[pass 9 해소 — §25 I-92: 강제 대기 제거 · 홉 상태를 인스턴스 메모리에 저장해 다음 조각이 홉 N부터 잇는다 — 이 제한은 더 이상 없다 · 남은 비용은 K-24]** |
| K-20 | [pass 8] 인증 벽 가드의 오탐·미탐 — ① 스크립트로 그리는 빈 셸(SPA)은 `NO_BODY`로 제외되면서도 같은 해시를 남기므로 10쪽 이상이면 `AUTH_WALL`로 강등되고, 모든 쪽이 같은 정적 페이지인 사이트도 같다(다음 예약은 PREVIEW · 승인 뒤 SYNC도 가드를 다시 받아 같은 사이트면 다시 강등 — 관리자 우회 없음) ② 문서 파일 URL이 로그인 페이지로 리다이렉트되는 경우(파일 행은 분모 밖)는 감지하지 않는다 ③ 관측 해시를 남긴 HTML이 10쪽 미만인 소스는 판정하지 않는다 **[pass 9 갱신 — §25 I-89]** ①의 빈 셸은 이제 지문을 남기지 않아(본문이 공백뿐이면 미기록) 강등되지 않는다 — 단 짧지만 비어 있지 않은 공통 문구("Loading…" 등)만 있는 셸·모든 쪽이 같은 정적 페이지인 사이트는 그대로 · ③ 하한은 이제 "판정용 지문 행 ≥ 10"이고 비율 분모는 방문 HTML 전체 · ④ 로그인 신호는 URL(호스트·경로)에서만 찾는다 — login류 이름이 없는 로그인 페이지(`/docs/entrance`)나 신호 없는 SSO 호스트로의 3xx 수렴은 `R:`(분포 제외)·미기록이 되어 잡지 못한다(대신 200 로그인 폼이 여러 URL에서 같은 본문이면 본문 지문으로 잡힘) · 반대로 경로 토큰에 `sso`·`auth` 등이 있는 정상 안내 페이지(`/docs/sso-guide`)로의 대량 통합 리다이렉트는 `RL:` 수렴으로 오탐될 수 있다 ⑤ 짧은 공통 문구뿐인 페이지가 대량인 **첫 크롤**은 `AUTH_WALL`로 기록될 수 있다(첫 크롤은 PREVIEW라 승인 유지 · 기록만) **[pass 11 갱신 — §25 I-100·I-101]** 쿼리 허용 소스의 페이지별 return 파라미터(`/login?next=…`)로 벽을 놓치던 미탐 해소(`RL:` 쿼리 제거 · 목적지 행 `RD:` 분자·분모 제외) · 로그인 신호의 문서 경로 오탐 축소(하이픈 조각 + 문서 단어 사전 · `signin` 뒤 `g` · `sign-in`류 앞 영문자) — 잔여: 부분 일치 `login`·`logon`은 앞 경계를 보지 않는다(`/catalogindex`처럼 단어 안에 든 `login`도 신호) · 사전 밖 단어로 이어진 문서 경로(`/docs/sso-walkthrough`)는 여전히 신호 · `help`·`support`는 사전에서 뺐으므로 `/docs/sso-help` 같은 안내 페이지도 신호 | SPA는 원래 수집 대상 밖(K-3 — 적재할 본문도 없어 실손 0 · 사유 표시가 "로그인 필요"로 보일 뿐) · 오탐은 적재를 멈추는 안전한 방향 · 파일의 로그인 리다이렉트는 종류 전환 판정(`RAW_FILE_OFF`·`EXCLUDED_AT_INGEST`)이 대부분 적재를 막는다 · 우회 수단은 §25.5 U-4 |
| K-21 | [pass 7] FULL_RESEND 대상에서 리다이렉트 원래 행은 빠지지만, 리다이렉트 추종 도입(pass 6) 전에 원래 URL 이름으로 이미 적재된 행(`lastIngestedAt` 있음)은 대상에 남는다 — 같은 내용이 옛 이름·목적지 이름으로 외부에 둘 남는 기존 중복은 정리되지 않는다(새 중복은 만들지 않음) **[pass 9 갱신 — §25 I-91]** 이제 이번 실행에서 리다이렉트 원래 행(`R:`·`RL:`)이 된 행은 `lastIngestedAt`이 있어도 FULL_RESEND 대상에서 빠진다 — 옛 이름으로 다시 보내지 않을 뿐, 외부의 옛 사본은 그대로 남고 "정리 필요" 표시도 붙지 않는다(원래 행은 이번 실행에 방문돼 삭제 감지 대상이 아님 · 2차: 적재 이력이 있는 행이 리다이렉트 원래 행이 되면 `cleanupReason` 표시 검토) | 미배포 기능이라 운영 데이터 없음 · 개발·시연 DB만 해당(DB 재생성 권장) · 외부 삭제 API 부재(K-1) |
| K-22 | [pass 8 · **pass 10 부분 해소 — §25 I-95: 감사 `[적재 차단]` 추가(CAS 승자 1건) — 아래 "감사 기록 없음"은 pass 8 시점 기록**] 거버넌스 적재 게이트로 끝난 실행 — 감사 기록 없음(로그 1줄 + 실행 `failureCode`만 · 적재 러너에 감사 서비스 없음) · 이미 SUBMITTED인 작업은 UNKNOWN으로 표시되지만 외부에서 계속된다 · 이미 적재된 문서는 그대로다 | 실행 이력에 사유 코드가 남아 콘솔에서 보인다 · 외부 취소 API 부재(K-18) · 감사 추가 여부는 §25.5 U-3(pass 10 채택 · 남은 제한 = 외부 접수 작업 계속·기적재 문서 불변) |
| K-23 | [pass 8 관찰] `apps/api` 전체 jest가 부하에 민감하다 — 기본 워커(`jest.config.js` `maxWorkers: '50%'`)로 8회 중 5회가 서로 다른 **무관한** 시간 의존 시험(`hybrid-cs`·`polling-loop`·`survey-management`·`legacy-api-integration` 회로 차단·`version-history-reindex`)에서 간헐 실패 · `--maxWorkers=6`은 2회 통과 · 이후 기본 워커 1회 337 suites / 4,871 tests 통과. No.43 시험 자체의 실패는 아니다 | 기존 그룹 시험의 타이밍 의존 설계(`docs/04-test/자동시험_전략.md` §13.x·§16.5·§19 선례와 같은 부류) · No.43이 스위트를 키워 부하가 늘었다 · test-automation 단계에서 반복 실행 결과·실패 파일을 자동시험 전략에 기록하고 폴링 전환 후속을 배정(§25.5) **[pass 10 관찰]** 전체 api 343 suites / 5,005 passed / 1 skipped · 웹 198 파일 / 1,041 tests. 부하 시 간헐 실패 재확인: api `hybrid-cs` G-8(공개 메시지 직후 `live-sessions`를 곧바로 읽는데 대화 로그 `record()`가 발사 후 망각이라 세션이 아직 없음) · 웹 `HandoffHistoryDetailPage.spec.tsx` — 둘 다 단독 통과 · 미변경 spec · No.43 무관(`omnichannel-inbox`는 pass 7에서 폴링 헬퍼로 고정 — I-88). 간헐 실패 목록과 고정 방침(발사 후 망각 경합 = 폴링 헬퍼 · 부하 상한 = `--maxWorkers`)의 `docs/04-test/자동시험_전략.md` 기록은 test-automation 후속 |
| K-24 | [pass 9] 리다이렉트 재개 상태(`redirectResume`)는 인스턴스 메모리다 — 재시작·다른 인스턴스 인수·임대 상실·30분 경과·시작 URL 변경이면 버리고 홉 0부터 다시 요청한다(리다이렉트 원래 URL에 GET 1회 중복 · 정확성 무관) · 상한 200을 넘으면 가장 오래된 상태부터 밀려난다 | **코드 판단(상한 초과로 홉 0 재요청이 반복되는가 — 현재 한도에서는 아니다)**: 살아 있는 상태는 "이 인스턴스가 임대를 쥔 CRAWLING 실행의 프런티어 머리 문서"뿐이다 — 미루면 조각을 곧바로 끝내고(`processLoop` `break`) 다음 조각이 너비 우선 순서(`nextQueuedDocument`)로 같은 문서를 먼저 꺼내 상태를 소비(응답을 받으면 삭제)하므로 실행당 1개 이하 · 실행 수 ≤ 소스 상한 50(`KB_SYNC_LIMITS.maxSources`) < 200. 남는 항목은 다른 인스턴스가 끝낸 실행이나 응답 없이 처리된 머리 문서(중단 호스트 등)의 잔재뿐이고, `setBounded`가 삽입 순(다시 쓰면 최신)으로 오래된 것부터 버리므로 살아 있는 상태보다 먼저 밀려난다 · 잔재는 실행 종결(`forgetRun`)·임대 재획득 때도 지워진다. 소스 상한을 200 이상으로 올리거나 한 실행이 여러 문서를 동시에 미루게 바꾸면 재검토(상한을 `maxSources × 2` 이상으로 연동) |
| K-25 | [pass 10] 적재 파일 머리 줄의 `출처:` URL(쿼리·프래그먼트만 제거)은 마스킹하지 않는다 — URL 경로에 개인정보(예: `/staff/010-1234-5678`)가 있는 사이트는 그 값이 외부 RAG로 간다(DB `KbDocument.url`도 원문) | AC-KB6-1("휴대전화 번호가 있는 HTML → 적재 파일 본문에서 마스킹")은 본문·제목 기준으로 충족 · URL 경로의 개인정보는 드묾 · 마스킹하면 출처 링크가 깨져 K-2(출처 보완) 목적과 충돌 · 후속 검토: 경로 세그먼트 단위 마스킹 또는 개인정보 형식이 보이는 URL은 제외 — 2차 |
| K-26 | [pass 10] 새로 비율 분모 `k`는 종결 조각 시작 때 센다 — 한 실행이 여러 조각에 걸치면 앞 조각에서 GONE → ACTIVE로 복귀한 문서가 "실행 전 ACTIVE"에 들어갈 수 있다 | 복귀 문서는 최종적으로 ACTIVE라 분모 과대가 작고 방향은 강등을 덜 하는 쪽(개편 급증은 여전히 큰 비율) · 정확히 하려면 실행 시작 때 `k`를 실행 행 `counts`에 저장(2차) **[pass 11 해소 — §25 I-99: 첫 조각에서 `counts.priorActiveIngested`로 고정 · 반대 방향(앞 조각의 EXCLUDED·GONE 전환으로 분모 감소 → 가드 꺼짐)의 더 큰 결함도 함께 해소]** |
| K-27 | [pass 11 기록 · R6 L-D] FULL_RESEND 대상의 `seenRunId = 실행` 조건 때문에, `maxPages`에 닿아 이번 실행 프런티어에 오르지 못한 **이미 적재된** 문서는 복구 재전송에서 빠지고, 같은 실행은 상한 도달이라 삭제 감지도 꺼져 그 문서는 ACTIVE로 남는다(외부 사본은 옛 내용 그대로 · "정리 필요" 표시 없음) — `maxPages`를 낮춘 뒤에도 같다 | 상한 도달 자체가 실행 요약·미리보기의 경고 대상(`maxPagesReached`)이고, 범위 축소 뒤 옛 문서를 다시 보내지 않는 것이 M-3(pass 9)의 목적이라 방향은 보수적 · 해소 경로: 경로 접두·제외로 범위를 상한 아래로 줄이면 다음 SYNC부터 삭제 감지가 켜져 2회 뒤 GONE/정리 필요 · 2차: 상한 도달 실행에서 "이번에 확인하지 못한 적재 문서 수"를 요약에 표시 |
| K-28 | [pass 12 확인 · 기존 동작] URL 정규화는 스킴을 유지하고 출처 비교는 스킴을 보지 않는다 — 같은 호스트의 `http://`·`https://` 주소가 리다이렉트 없이 같은 내용을 주면 서로 다른 문서(다른 `urlHash`·외부 파일 이름)로 두 번 적재될 수 있다 | 대부분의 사이트는 `http→https` 리다이렉트를 주므로 원래 행(`R:`)이 되어 적재되지 않는다 · 2차: 시작 주소 스킴과 다른 스킴의 같은 출처 링크를 시작 주소 스킴으로 정규화~~(인증 헤더 쪽은 커밋 전 수정 대상 §25.7 RG-28)~~ **[pass 13 — 인증 헤더 쪽 해소(§25 I-107): 평문 `http:` 요청에는 `http:`로 명시한 출처에만 헤더]** · 남는 것(코드 확인): ① 두 스킴 중복 적재(위 — 범위·URL 정규화는 pass 13에서도 바꾸지 않았다 · 2차 그대로) ② [pass 13 부수 효과] `https:`로만 등록한 인증 소스가 같은 호스트의 `http:` 링크를 내놓고 사이트가 그 주소를 리다이렉트 없이 직접 제공하면 헤더 없이 요청되어 401/403(실패 행) 또는 로그인 페이지(인증 벽 지문)가 될 수 있다 — 사이트가 `http→https` 리다이렉트를 주면 홉 1의 `https:` 요청에 헤더가 실려 정상(단위 `allowed-origins.spec.ts` 확인). 대처: 사이트의 링크를 https로 고치거나, 평문 전송을 받아들일 때만 그 `http://` 주소를 시작 주소·사이트맵에 명시(운영 안내 — `docs/05-ops/자동배포.md` §5.7 항목 2) |
| K-29 | [웹 RG-27 · 서버 pass 11 공통] 강등 뒤 승인 안내 문구가 새로 비율 강등 기준이다 — 서버 409 문구("내용이 크게 바뀌어 적재가 보류된 뒤에…")와 콘솔 사전 비활성 문구(`MESSAGES.kbRuns.approveDisabledAfterDemotion` "내용이 크게 바뀌어 적재가 보류되었습니다…")가 모두 "내용이 크게 바뀌어"로 시작해 SYNC·FULL_RESEND의 인증 벽(`AUTH_WALL`) 강등에는 원인이 맞지 않는다 · 콘솔 사전 비활성은 실행 이력 첫 페이지(20건) 안의 강등만 보므로, 강등 실행이 창 밖이면 버튼이 활성으로 보이고 누른 뒤 409(서버 문구)로 안내된다 | 해결 방법(미리보기 다시 실행)은 두 원인에 같고, 개요의 강등 배너(§3.3 "강등됨" — `reviewRequiredReason` 사유 라벨)가 실제 원인을 함께 보여 준다 · 서버가 막으므로 안전 · 2차: 서버 문구를 사유별로 나누거나 중립화("자동 점검으로 적재가 보류된 뒤…")하고 콘솔은 `reviewRequiredReason`으로 문구를 고른다(계약 변경 0으로 가능) |

---

## 21. 요구사항 대비 해석 (architect 판단)

| # | 요구사항 | 해석·조정 |
|---|---|---|
| R-1 | §10·§12 "ADR-0044(신규 가번호)" | **ADR-0044 확정**(다음 빈 번호가 우연히 일치) |
| R-2 | J-11·FR-0-208 "적재 = `RAG_INGEST` 분리 권고" | **RAG 클래스 유지** + 데이터 종류 `DOCUMENT_BODY`는 데이터 지도 `kbSources` 절(소스 단위) — 같은 호스트·파일·가드라 판정이 같고, 분리하면 `exits[]` 행이 늘어 미사용 설치 바이트가 바뀐다 |
| R-3 | FR-0-204 "`file_path` 저장소 0건" | 성립 불가(질의 응답 파서 2파일이 이미 보유) → **송신·`kb-sync` 0 + 보유 파일 2개 고정**(KB-3) |
| R-4 | FR-KB4-4 후보 순서 `.txt → .html → .docx` | 실측 **순서**는 유지하되 **확인 전 기본값은 DOCX**(지원 표에 명시된 유일한 후보) — `KB_HTML_INGEST_FORMAT` |
| R-5 | FR-KB2-10 "다음 실행은 처음부터 다시 방문" | 중단(임대 만료)은 **DB 프런티어로 이어서** · 사용자 중지(CANCELLED)만 다음 실행이 처음부터 |
| R-6 | FR-KB5-1 "DB 제약 — 부분 유니크 인덱스면 migrate deploy" | **소스 행 CAS**(`activeRunId`) — 부분 유니크 4 보존(RM-12) |
| R-7 | FR-KB4-5 "DB 선점으로 전역 직렬" | **슬롯 임대 행**(`KbJobLease` · 1~3) — 동시성 설정을 일반화 |
| R-8 | FR-KB5-4 `INTERRUPTED` 상태 | **저장하지 않고 조회 시점 판정**(임대 만료 ∧ 진행 단계) — 재개 시 되돌리는 쓰기 제거 |
| R-9 | §1.11 흐름(발견 즉시 대기열) | **크롤 종결 후 일괄 등록** — 새로 비율·인증 벽 가드가 적재 전에 판정 |
| R-10 | FR-0-210 원문 비저장 | 적재 시점 **재수집** — 감지와 적재 사이에 바뀌었으면 새 내용으로 적재(해시도 새 값) |
| R-11 | §5.4 `KB_SYNC_INTERVAL_MS` 60,000 | **10,000**(조각 실행 처리량·작업 조회 간격) · 유휴 쿼리 2/주기 |
| R-12 | FR-KB1-5 "환경변수 이름 참조"(예 `KB_SECRET_HR`) | **`KB_SECRET__<REF>` 접두 규약**(No.26·No.41과 같음 — 임의 환경변수 읽기 금지 · 리졸버 1파일) |
| R-13 | FR-KB1-1 제외·잡음 "패턴" | **글롭(`*`·`?`)만** — 관리자 정규식 ReDoS 방지 |
| R-14 | EX-KB-14 "거부 또는 다음 실행부터" | 범위 영향 필드 = `409 KB_SOURCE_BUSY` · 나머지 = 즉시 저장(다음 실행부터) |
| R-15 | (ADR-0041 트리거) 세 번째 공유 출구 → 부품 이동 | **발동 확인 · 이동 연기**(동작 0 변경인데 spec 9개 경로 변경) — 독립 리팩터로 사용자 결정 |
| R-16 | NFR-KBP2 "처리 ≤ 50ms/쪽" | 해석·해시·마스킹·변환을 **작업 스레드**에서 — 공개 대화 이벤트 루프 보호 |
| R-17 | P-6 "원본 파일 그대로" | + **PII 사전 검사**(건수 표시 · 거버넌스 ON이면 PII 파일 제외) — 텍스트는 보내지 않는다 |
| R-18 | FR-KB7-4 "전체 다시 적재" | `acknowledgeCleanup` 옵션으로 "정리 필요" 해소(GONE 행 삭제 · 표시 해제 · 감사) |
| R-19 | §4.8 가칭 경로 | 13 핸들러 확정 + `GET /kb-sources/meta`(전제·배지) · 챗봇 카드는 별도 컨트롤러 |
| R-20 | (없음) 기능 꺼짐 응답 | KB 경로 전부 `404`(OMNI 선례) |
| R-21 | FR-KB3-5 삭제 감지 | SYNC·FULL_RESEND ∧ 상한 미도달 ∧ 중단 호스트 제외 ∧ 중지 아님일 때만 · PREVIEW 미산입 |
| R-22 | §4.10 처리량 · "대량 첫 적재" | BULK/INCREMENTAL 레인 + 선택 시간창 + ETA |
| R-23 | FR-KB2-1 robots 실패 규칙 | robots 리다이렉트는 허용 호스트 안 3회만 · 밖이면 **호스트 중단**(RFC 9309의 권한 넘어 추종보다 보수적) |
| R-24 | FR-KB3-4 "적재 성공 뒤에만 해시 갱신" | **검증자(ETag·Last-Modified)도 같은 규칙** — 304 함정 방지 |
| R-25 | (없음) 마스킹 강도·형식 변경 | 적재 지문으로 자동 재적재 |
| R-26 | FR-KB7-5 챗봇 카드 | URL·호스트 미노출(이름·시각·건수만) |
| R-27 | FR-KB1-8 감사 | `AuditTargetType` +`KbSource` · `AuditAction` 0 · 예약 실행은 감사 아님 |
| R-28 | (없음) 오류 코드 | `ApiErrorCode` +3 |
| R-29 | FR-KB1-9 "우리 쪽 기록만 삭제" | 소스·문서 행 삭제 · **실행 이력·적재 작업은 로그로 남김**(FK 없음 · `CALL_LOGS` 파기) |
| R-30 | FR-KB5-3 "범위·스코프를 바꾼 소스는 다시 PREVIEW" | 스코프 변경 시 기존 적재 문서에 `SCOPE_CHANGED` 표시 추가(Q-4 미확인 방어) |

---

## 22. GPU · 배포 형태 (P-12)

- **GPU 1**(카탈로그 4 → 1): HTTP 수집·본문 추출·해시·마스킹·DOCX 생성·DB 기록뿐 — 모델·학습·추론·임베딩 0 · ml-worker 변경 0. 청킹·임베딩·키워드 추출·답변 생성은 외부 RAG(자체 GPU·vLLM)가 한다. 3050(4GB) 개발 환경 제약과 무관.
- **구축형 ○(전제 필요)**: 크롤러가 고객 사내망 사이트에 닿는다. 전제 = 외부 RAG 전송 구간이 내부망·인증·TLS 중 하나(`KB_INGEST_TRANSPORT_ACK`) + 사설 대역 허용(`KB_CRAWL_PRIVATE_ALLOWLIST`) + 거버넌스 모드면 출구 허용 목록.
- **구독형 △**: 클라우드에서 고객 사내망에 들어갈 수 없어 **공개 웹사이트만** 수집한다. 외부 RAG 전송 구간 TLS 필요. 구독형 다고객 서버에서는 소스가 전역이라 고객 간 소스 목록이 보인다(멀티테넌시 그룹과 함께 재검토 — ADR-0041 감수 비용 8과 같은 성격).

---

## 23. 외부 RAG 담당자 확인 사항 · 확인 전 가정치

| # | 확인할 것 | 확인 전 가정(이 설계의 동작) | 확인 결과에 따른 변경 |
|---|---|---|---|
| **Q-1** | ★ 웹 페이지를 `.txt`·`.html`로 적재할 수 있나(지원 표 "등"의 범위) | **미지원 가정 → DOCX**(명시 형식) | 지원이면 `KB_HTML_INGEST_FORMAT=TXT` 권장(빠름) — **첫 적재 전에** 정할 것(K-8) |
| **Q-2** | 외부 RAG에 크롤링·동기화 API가 따로 있나 | **없음**(명세 21행 · P-1 (c) 불가) | 있으면 P-1 (c) 전환 검토(재검토 트리거) |
| **Q-3** | ★ 운영 배포 시 전송 구간이 내부망·인증·TLS 중 무엇인가 | **미정 → ACK 없음 = 적재 불가**(미리보기만) | 결정값을 `KB_INGEST_TRANSPORT_ACK`에 설정 |
| **Q-4** | ★ 같은 파일 이름을 **다른 company/category/subcategory**로 다시 적재하면 옛 청크의 메타데이터가 바뀌나, 옛 스코프에 남나 | **남는다 가정** → 스코프 변경 시 `SCOPE_CHANGED` 정리 필요 표시 | 바뀐다면 표시 제거(재적재만으로 충분) |
| **Q-5** | 파일 이름 제약(길이·문자) · `uploads/`를 다른 이용자와 공유하나 | ASCII 36자 이내면 안전 · 공유 가정(접두 `kb_` + 소스 id로 충돌 회피) | — |
| **Q-6** | ★ 처리 시간 실측(HTML 10쪽 · PDF 5개 — 형식별) · 동시 적재 허용 수 | HTML 30~60초/건 · PDF 143초/4쪽 · **직렬 1** | `KB_INGEST_CONCURRENCY`·시간창 기본값 확정 |
| **Q-7** | 적재가 vLLM을 점유할 때 챗봇 질의 지연·품질 영향 · 업무 시간 대량 적재 허용 여부 | **영향 있음 가정** → BULK 시간창 권장(운영 설치) | 영향 없으면 시간창 불필요 |
| **Q-8** | `task_info.result` 성공/실패 문자열 전체 목록 · `error` 형식 | "…성공." / "…실패." 접미 | 목록이 다르면 `judgeIngestResultText` 갱신 |
| **Q-9** | 분당 200회 한도가 IP 단위인가 — 챗봇 서버와 크롤러가 같은 IP면 공동 한도 | **공동 가정** → 크롤러 30/분(15%) | 전용 한도 가능하면 상향 |
| **Q-10** | 파일 이름 접두 `kb_`를 우리 동기화 전용으로 예약해 줄 수 있나(운영자 직접 업로드와 충돌 방지) | 운영 가이드로 "kb_로 시작하는 이름 직접 업로드 금지" 안내 | 예약되면 안내 강화 |

---

## 24. 범위 밖 · 2차 (재검토 트리거는 요구사항 §9 · ADR-0044)

수동 업로드 화면(No.48 — 계속 종결) · 외부 RAG 문서 삭제·소스 재구축(범위 삭제 — 삭제 봉인 재설계 필요) · 우리 쪽 문서 저장소·임베딩 색인·자체 RAG · 외부 RAG 자체 크롤링 기능 호출(Q-2) · 로그인·SSO·쿠키 세션 사이트 · 헤드리스 브라우저(SPA) · 파일 서버·SharePoint·드라이브 커넥터(No.39) · HWP 변환 · **동기화 실패 알림(웹훅·메신저 — No.41 운영 이벤트 2차 묶음)** · 매번 승인 모드 · 1시간 미만 주기·변경 통지 수신(`@Public()` +1) · robots 무시 옵션(채택 안 함) · 다국어 PII · 적재 문서 품질 점검(TC 연계) · 답변 출처의 파일 이름 → 제목 매핑(K-2) · 공유 전송 부품 `common/outbound/` 이동(R-15 — 독립 리팩터).

## 25. 구현 편차 기록(I-n)

(구현 단계에서 backend-implementer·frontend-implementer가 기록한다.)

코드 리뷰 R2 통과 후(2026-09-27) system-architect가 실제 코드를 확인해 I-1~I-32를 기록했고, 백엔드 pass 4 후(2026-09-28) 다시 코드를 확인해 I-33~I-48을 더하고 pass 4로 바뀐 I-4·I-6·I-7·I-12·I-15·I-19·I-20·I-21의 서술·근거 위치를 고쳤다. 모두 오케스트레이터 승인 사항이며 **새 결정이 아니라 이미 구현된 사실**이다(2026-09-28 현재 미커밋). 파일 경로는 `apps/api/src/` 기준(다른 워크스페이스는 경로를 모두 적음). 근거 위치는 pass 4에서 바뀐 파일(`kb-sync/core/kb-run.store.ts`·`kb-sync/engine/*`·`kb-sync/kb-sources.service.ts`·`kb-sync/kb-runs.service.ts`·`kb-sync/kb-status.service.ts`·`kb-sync/lib/build-run-view.ts`·`rag/lib/parse-task-status.ts`)은 **메서드 이름**으로, 그 밖은 2026-09-27 작업 트리의 라인으로 적었다. 분류: 의존성 I-1~I-3 · 소스 CAS·실행 관리 I-4~I-8 · 계약 I-9~I-12 · 추출기·작업 스레드 I-13~I-15 · 전송·크롤 I-16~I-22 · 기존 시험 I-23 · 콘솔 I-24~I-32(화면 설계서 §14와 같은 내용) · **pass 4**: 적재 슬롯·조회·재시도·vLLM I-33~I-36 · 저장 검증·configVersion I-37~I-38 · 실행 생성·집계·로그 I-39~I-41 · 사이트맵 I-42 · 대기 사유·BULK 시간창 I-43 · 작업 정리 I-44 · 스코프·일시중지 I-45 · 실패 코드·프런티어·시계 I-46 · 내부 API I-47 · Prisma where I-48. **백엔드 pass 5 후(2026-09-28)** 다시 코드를 확인해 I-49~I-61을 더했다(같은 원칙 — 이미 구현된 사실 · 미커밋 · 근거 위치는 메서드 이름): 실행 실패·중지 코드 I-49 · 실행 행 표식 I-50 · 크롤 429·503 I-51 · 종결 원자성·자가 치유 I-52 · 축소 I-53 · 원본 파일 꺼짐·사전 검사 I-54~I-55 · 크롤 임대 I-56 · GONE 해제·`markVisited` 의미 I-57 · HTML 부가 판정·적재 noindex I-58 · 공유 전송 포트(No.26 파일) I-59 · 결함 수정 I-60 · 시험 I-61. 미구현으로 남은 항목은 §25.1 "알려진 잔여 갭(RG-n)"(pass 4 시점 기록) · §25.2(pass 5 현재 상태 · 신규 갭 RG-16~RG-20) · §25.3(호스트 겹침 실행 권장안)이다. **백엔드 pass 6 후(2026-09-28)** 다시 코드를 확인해 I-62~I-74를 더했다(같은 원칙 — 이미 구현된 사실 · 미커밋 · 근거 위치는 메서드 이름): 링크 중복 제거·시작 주소 판정 I-62 · 부모→자식 링크·이어 방문(**스키마 변경**) I-63 · FULL_RESEND 해시 무시 I-64 · 압축 해제 조각 I-65 · 리다이렉트 공용 헬퍼 I-66 · 조각 안 대기·예산 분할 I-67 · 크롤 시작 게이트 I-68 · 종결 경합·제출 게이트 I-69 · 정합성 묶음 I-70 · robots·경로 정준형 I-71 · 범위·링크·시작 주소 판정(**경로 접두 의미 변경**) I-72 · 임대·동시성 I-73 · 시험 I-74. pass 6 현재 상태와 신규 갭 RG-21~RG-22는 §25.4다. **백엔드 pass 7·8 후(2026-09-28)** 다시 코드를 확인해 I-75~I-88을 더했다(같은 원칙 — 이미 구현된 사실 · 미커밋 · 근거 위치는 메서드 이름): 리다이렉트 라이브락·실효 간격 상한 I-75 · FULL_RESEND 대상 I-76 · `maxPages` 의미 I-77 · 홉별 상한·타임아웃·종류 전환 I-78 · 크롤 예산 분모·후보 창 I-79 · 이어 방문 GONE 제외 I-80 · 적재 후보 선택 I-81 · 부분 검사 파일 I-82 · 임대 교차 검증·갱신 지점 I-83 · 경로 글롭 문자 단위 I-84 · 인증 벽 가드 재작업(**스키마 변경**) I-85 · 거버넌스 실행·적재 차단(**PM 결정 · 계약 변경**) I-86 · 작업 결과 코드·봉인 KB-14b I-87 · 시험 I-88. 현재 상태·신규 갭 RG-23~RG-25·사용자 결정 대기는 §25.5다.

| # | 내용 | 근거 | 영향 파일 |
|---|---|---|---|
| I-1 | [의존성] `common/lib/import-esm.ts` 신설(§2.1 파일 목록 추가) — `importEsm(specifier)` = 인자가 상수인 `new Function('specifier', 'return import(specifier)')` 1곳으로 네이티브 동적 `import()`를 보존한다. 호출부는 `kb-sync/lib/pdf-text.ts`의 빌드타임 상수 지정자 1곳뿐이다(크롤 결과·사용자 입력 문자열을 받지 않는다). KB-16(`eval`·`new Function` 0)의 검사 범위(`kb-sync/**`·`extract.worker.ts`) 밖이다 | `pdfjs-dist@4.2.67`의 `legacy/build/pdf.mjs`는 최상위 `await`를 가진 순수 ESM이고, `module: commonjs` 트랜스파일은 `import()`를 `require()`로 낮춰 로드가 실패한다 | `common/lib/import-esm.ts:1-20` · `kb-sync/lib/pdf-text.ts:1·50` · `kb-sync/lib/kb-sync-sealing.spec.ts`(KB-16) |
| I-2 | [의존성] `htmlparser2`를 `^9.1.0`으로 고정한다(`fflate` `^0.8.3` · `pdfjs-dist` `4.2.67` 정확 고정) | `htmlparser2` v12는 ESM 전용이라 CommonJS로 빌드하는 `apps/api`에서 쓸 수 없다 | `apps/api/package.json:32·34·35` |
| I-3 | [의존성] `pnpm-workspace.yaml`의 `allowBuilds`에 `canvas: false`를 두어 `canvas` 빌드 스크립트를 실행하지 않는다 | `canvas@2.11.2`는 `pdfjs-dist@4.2.67`의 선택 의존성(`optionalDependencies`)으로 들어온다. 텍스트 추출에는 필요 없고, §7.1 "네이티브 빌드 0" 원칙을 지킨다 | `pnpm-workspace.yaml:8` · `pnpm-lock.yaml:6766-6769` |
| I-4 | [소스 CAS] 소스 CAS 4종(`claimForRun`·`releaseActiveRun`·`demoteReview`·`approveConfigVersion`)과 pass 4의 `claimAndCreateRun()`(I-39)은 모두 `KbSourcesService`가 가진다. 스케줄러·크롤러·적재기·`KbRunsService`는 이 서비스를 호출하고, `kb-run.store.ts`는 `kbSource`를 읽기만 한다 | KB-9 문자 그대로 — "`kbSource` 쓰기 파일 = `kb-sync/kb-sources.service.ts` 1개" | `kb-sync/kb-sources.service.ts`(`claimForRun`·`claimAndCreateRun`·`releaseActiveRun`·`demoteReview`·`approveConfigVersion`) · `kb-sync/engine/kb-scheduler.ts`(`scheduleDueSources`) · `kb-sync/engine/kb-crawl.runner.ts`(`processLoop`·`failRun`) · `kb-sync/engine/kb-ingest.runner.ts`(`finalizeIngestingRuns`) · `kb-sync/kb-runs.service.ts`(`createRun`·`approveIngest`·`cancelRun`) · `kb-sync/core/kb-run.store.ts`(머리 주석) · `kb-sync-sealing.spec.ts`(KB-9) |
| I-5 | [임대] `core/kb-job-lease.ts`는 만들지 않았다. 크롤 임대(`claimCrawlLease`·`renewCrawlLease`)·적재 슬롯 임대(`ensureLeaseRow`·`claimAnySlot`·`releaseSlot`·`renewSlot`)·상태 행(`getLeaseState`·`setLeaseState`·`getWaitingContext`)을 `kb-run.store.ts`에 통합했다. `governance/**` import 0(KB-13)은 그대로다 | KB-9가 `kbJobLease` 쓰기 파일을 `kb-run.store.ts` 1개로 고정하므로 별도 파일을 두면 봉인과 충돌한다 | `kb-sync/core/kb-run.store.ts`(위 메서드) · `kb-sync-sealing.spec.ts`(KB-9) |
| I-6 | [실행 생성] `KbRunStore.createRun()`은 `id`를 **필수 인자**로 받는다(`@default(uuid())`에 맡기지 않는다). R2 시점에는 호출부가 `claimForRun()`과 `createRun()`을 **별도 호출**했으나, **pass 4에서 `KbSourcesService.claimAndCreateRun()`의 한 트랜잭션으로 바뀌었다(I-39)** — `createRun()`은 선택 인자 `tx`로 같은 트랜잭션 클라이언트를 받는다 | id가 다르면 `KbSource.activeRunId`가 존재하지 않는 실행을 가리켜 해제 CAS(`releaseActiveRun`)가 영원히 실패한다 | `kb-sync/core/kb-run.store.ts`(`createRun`) · `kb-sync/kb-sources.service.ts`(`claimAndCreateRun`) |
| I-7 | [삭제 감지] 크롤 종결 시 `kind ≠ PREVIEW ∧ maxPagesReached = false`이면 `findStaleDocuments()`(이번 실행에서 다시 보지 못한 ACTIVE·EXCLUDED 문서)를 `NOT_REDISCOVERED`로 관측해 `applyMissingUpdate()`로 기록한다(중단 호스트의 문서는 건너뜀). 종결 집계는 DB에서 다시 조회한다(pass 4에서 범위가 넓어졌다 — I-40) | 조각 실행(§9.3)은 여러 tick에 걸쳐 이어져 tick 지역 변수가 남지 않는다. 304로 건너뛴 부모 페이지가 링크를 다시 내놓지 않아도 사라진 자식 페이지를 잡아야 한다(R-21) | `kb-sync/core/kb-run.store.ts`(`findStaleDocuments`·`applyMissingUpdate`·`countRunObservations`) · `kb-sync/engine/kb-crawl.runner.ts`(`processLoop`) |
| I-8 | [유휴 판정] `KbIngestRunner.runFragment()`는 `Promise<boolean>`(이번 호출에서 실제 조회·제출을 했는가)을 돌려주고, `KbSyncJob.tick()`은 `false`가 나오면 적재 반복을 멈춘다 | 시각 추정으로 유휴를 판정하면 유휴 tick이 예산 30초를 다 쓰는 회귀가 생긴다 | `kb-sync/engine/kb-ingest.runner.ts`(`runFragment`) · `kb-sync/engine/kb-sync.job.ts`(`tick`) |
| I-9 | [계약] `KbSourceResponse` 필드 추가 — ① `activeDocumentCount`(state=ACTIVE 문서 수 — 전체 다시 적재 확인 문구용) ② `previewStale`(가장 최근 성공 PREVIEW의 `configVersion` ≠ 현재면 true · PREVIEW가 없으면 false. 판정 함수 `lib/preview-stale.ts` `isPreviewConfigStale()`을 `approve-ingest`의 `PREVIEW_STALE` 검사와 공유. 목록은 `kbSyncRun.groupBy({ by: sourceId, _max: configVersion })` 1회로 구한다) ③ `warnings?: { code }[]`(등록·수정 **저장 응답에만** · 코드 `SCOPE_SHARED_WITH_OTHER_SOURCE`·`SCOPE_NOT_READ_BY_ANY_CHATBOT` · 판정은 순수 함수 `lib/scope-warnings.ts`, DB 조회는 서비스). 목록 조회의 소스별 집계 4종은 groupBy 배치로 구한다 | §12 화면 3의 "저장 응답 `warnings[]`"와 §9.8 승인 조건을 계약으로 드러낸다(R1 리뷰 M-1) | `packages/shared-types/src/kb-sync.ts:209-213·247-259` · `kb-sync/lib/preview-stale.ts:6-8` · `kb-sync/lib/scope-warnings.ts:13-18` · `kb-sync/kb-sources.service.ts`(`scopeWarnings`·`create`·`update`·`list`·`toResponse`) · `kb-sync/core/kb-run.store.ts`(`latestSuccessfulPreviewConfigVersions`) · `kb-sync/kb-runs.service.ts`(`approveIngest`) |
| I-10 | [계약] `etaSeconds` = `lib/eta.ts` `computeEtaSeconds()`(⌈(남은 HTML × HTML 평균 + 남은 파일 × 파일 평균) ÷ 슬롯 수⌉ · 최근 성공 작업 종류별 최대 20건 표본 · 표본 없으면 가정치 HTML 45초·파일 150초 · 남은 0이면 0 · 슬롯 ≤ 0이면 null). 조립은 `lib/build-run-view.ts` 1곳이며 `INGESTING`·`SUCCEEDED`·`PARTIAL`일 때만 계산한다 — 적재 작업이 없는 PREVIEW는 종결 시 0, 크롤 단계는 null. 슬롯 수 = `KB_INGEST_CONCURRENCY` | 실행 상세와 소스 `activeRun` 두 곳에 `null`이 하드코딩돼 있던 것을 한 함수로 모았다(§9.6) | `kb-sync/lib/eta.ts:10-42` · `kb-sync/lib/build-run-view.ts`(`buildRunView`) · `kb-sync/core/kb-run.store.ts`(`getEtaInputsBatch`·`recentIngestDurationSamples`) |
| I-11 | [계약] 승인되지 않은 소스에 `SYNC`·`FULL_RESEND`를 요청하면 `409 KB_INGEST_NOT_ALLOWED`의 `details[].message`를 강등 사유(`reviewRequiredReason`)가 있으면 `REVIEW_REQUIRED`, 없으면 `PREVIEW_REQUIRED`로 나눈다(문구도 다르다). enum은 §4 그대로다 | 강등은 "다시 확인하라"는 뜻이라 안내 문구가 달라야 한다 | `kb-sync/kb-runs.service.ts`(`createRun`) |
| I-12 | [계약] 거버넌스 모드 ON의 저장 거부(`400 VALIDATION_FAILED`)에 `details`를 붙인다 — 마스킹 끄기 `[{ field: 'piiMask', message: 'GOVERNANCE_MASK_REQUIRED' }]` · 서버가 허용하지 않은 원본 파일 전달 `[{ field: 'allowRawFileIngest', message: 'GOVERNANCE_RAW_FILE_NOT_ALLOWED' }]`. 검사는 `assertGovernanceFlags()` 1곳이며 **pass 4부터 등록·수정 양쪽**에서 부른다 — 수정은 본문에 실린 필드만 검사한다(I-37). 콘솔은 `details[].field`로 필드별 인라인 오류를 표시한다 | 필드별 인라인 오류(UIUX §7) | `kb-sync/kb-sources.service.ts`(`assertGovernanceFlags`·`create`·`update`) · `apps/web/src/pages/settings/kb-crawling/KbSourceEditModal.tsx:206-211` · `integration/kb-sources-governance-validation.integration.spec.ts` |
| I-13 | [추출기] 운영 기본 추출기 = `WorkerThreadExtractor`(개발·운영 공통 DI 기본값). 진입점은 `__dirname/extract.worker.js`이고, 없으면 경로의 `src`를 `dist`로 바꾼 후보를 쓴다 → **dev·ts-jest에서도 최초 1회 `pnpm build`가 필요**하다. 둘 다 없으면 인프로세스로 대체하지 않고 `WorkerEntryMissingError`를 던진다. `KB_SYNC_ENABLED=true`면 부팅 때 `checkAvailability()`를 호출하고 실패하면 루프를 시작하지 않는다(실패 로그는 고정 문구 — I-41). 통합 spec은 `overrideProvider(KB_EXTRACTOR)`로 `InProcessExtractor`를 쓴다 | 샌드박스 격리는 보안 요건이다(§7.2) — 조용한 인프로세스 대체 금지. 부팅 점검은 매 tick 오류 반복 대신 가장 이른 시점에 한 번 알린다(R1 M-2) | `kb-sync/kb-sync.module.ts:29-47` · `kb-sync/extract/worker-thread.extractor.ts:14-59` · `kb-sync/engine/kb-sync.job.ts`(`onApplicationBootstrap`) · `integration/kb-sync*.integration.spec.ts`(5파일) |
| I-14 | [추출 실패 격리] 크롤 단계 추출 예외 = 그 문서만 `EXCLUDED(FILE_UNSAFE)` · 적재 단계 추출 예외 = 그 작업만 `SKIPPED(EXCLUDED_AT_INGEST)`. `WorkerEntryMissingError`는 전역 오류로 위로 올린다 — 적재 단계는 올리기 전에 `revertSubmissionClaim()`으로 SUBMITTING → PENDING(백오프 없음 · `attemptCount` −1로 선점 시 +1을 상쇄 = 순증 0). `KbCrawlRunner.runFragment()`·`KbIngestRunner.runFragment()`·`KbSyncJob.tick()`의 실행 루프가 각각 실행 단위로 예외를 가둔다 | 예외가 작업을 SUBMITTING에 영구히 가두거나, 문서를 QUEUED로 남겨 매 tick 같은 실패를 반복하거나, 같은 tick의 다른 실행을 멈추는 문제(R1 H-2 · R2) | `kb-sync/engine/kb-crawl.runner.ts`(`runFragment`·`visitOne`) · `kb-sync/engine/kb-ingest.runner.ts`(`runFragment`·`submitJob`) · `kb-sync/core/kb-run.store.ts`(`revertSubmissionClaim`) · `kb-sync/engine/kb-sync.job.ts`(`tick`) · `integration/kb-sync-extraction-failure.integration.spec.ts` |
| I-15 | [SUBMITTING 정리] `sweepExpiredSubmittingJobs(leaseMs, now)` — 적재 조각 첫머리에서 **멈춘** SUBMITTING 작업을 정리한다. 멈춤 판정(pass 4 개정): 작업 슬롯 키 형식 오류 ∨ 슬롯 행 없음 ∨ 슬롯 `claimToken` 비었음 ∨ **슬롯 토큰 ≠ 작업 키의 토큰** ∨ 임대 만료(`isLeaseExpired` · `KB_SYNC_LEASE_MS`). `externalFileName`이 비어 있으면 PENDING(`revertSubmissionClaim`), 채워져 있으면 `UNKNOWN`(재전송 안 함) + 문서 표식 해제 | 프로세스 크래시 등으로 SUBMITTING에 남은 작업의 방어선. `recordSubmissionMeta()`(→ `externalFileName`)는 `ragClient.ingest()` 직전에만 기록되므로 비어 있으면 전송 전 중단이 확실하다(R2). 토큰 불일치를 멈춤으로 보는 것은 다른 보유자가 슬롯을 가져간 뒤에는 이 작업을 쥔 쪽이 이미 슬롯을 잃었기 때문이다(pass 4) | `kb-sync/core/kb-run.store.ts`(`sweepExpiredSubmittingJobs`·`revertSubmissionClaim`) · `kb-sync/engine/kb-ingest.runner.ts`(`runFragment`) · `kb-sync/core/kb-run.store.sweep.spec.ts` |
| I-16 | [DNS] fetcher 인스턴스 메모리에 호스트별 TTL 5분 캐시. 빈 결과(조회 실패)는 캐시하지 않는다. 주소 판정(절대 차단·사설 허용 목록)은 캐시 여부와 무관하게 매 요청 수행하고, 핀 연결(`pinnedAddresses`)은 판정한 같은 배열을 쓴다 | 요청마다 DNS를 치지 않되, 판정 생략과 일시 실패의 5분 고착은 막는다(R1 M-3 · §6.2) | `kb-sync/crawl/kb-crawl-http.fetcher.ts:33-36·52·64-73·90-110` |
| I-17 | [robots] robots.txt 요청 스킴은 그 문서 URL의 스킴을 따른다 — 순수 `lib/url-scheme.ts` `httpOrHttpsScheme()`(파싱 실패 시에만 `https:`) | https 하드코딩 때문에 http만 쓰는 사내 사이트의 robots.txt를 받지 못했다(R1 L-2) | `kb-sync/lib/url-scheme.ts:6-12` · `kb-sync/engine/kb-crawl.runner.ts`(`processLoop`·`getRobots`) · `integration/kb-sync-robots-scheme.integration.spec.ts` |
| I-18 | [호출 한도] 토큰 버킷 `lib/kb-rag-call-limiter.ts` — 인스턴스별 직전 60초 슬라이딩 창(`KB_RAG_CALLS_PER_MIN`, 기본 30) · DI 토큰 `KB_RAG_CALL_LIMITER`. 적재 제출(`claimJobForSubmission` 전에 확인 — 한도 초과가 시도 수를 소모하지 않음)·작업 조회(초과 시 상태 변경 없이 이번 tick 건너뜀)·vLLM 상태 확인(초과 시 캐시값 사용) 3곳에서 `tryAcquire()` | §5.8 호출 한도의 구현 | `kb-sync/lib/kb-rag-call-limiter.ts:1-32` · `kb-sync/kb-sync.module.ts:48` · `kb-sync/engine/kb-ingest.runner.ts`(`vllmReady`·`pollDue`·`trySubmitOne`) |
| I-19 | [Retry-After] 순수 `rag/lib/retry-after.ts` `parseRetryAfterMs()`(초 또는 HTTP-date · 과거·파싱 실패 = null · 상한 30분). `RagHttpClient.send()`가 429·503 응답에서 해석해 `RagSendResult.retryAfterMs`(`number \| null`)로 싣고, `parseIngestResponse`(429·503)·`parseTaskStatus`(429 — pass 4부터 `POLL_AGAIN`의 `retryAfterMs`로 다음 조회 연기에 쓴다 · I-34)가 넘기며, 적재기는 제출 실패에서 값이 있으면 고정 백오프 대신 그 값을 쓴다(길이 비교 없음) | §5.8 "`Retry-After` 반영"의 구현 — 상한은 백오프 최댓값(30분)과 같다 | `rag/lib/retry-after.ts:5-20` · `rag/rag-http.client.ts:28·139-140` · `rag/lib/parse-ingest-response.ts:28·43-44` · `rag/lib/parse-task-status.ts`(`parseTaskStatus`) · `kb-sync/engine/kb-ingest.runner.ts`(`handleFailureOrRetry`·`pollDue`) · X-3 |
| I-20 | [gzip] 사이트맵 gzip 해제는 `lib/gzip-guard.ts` `safeGunzip()` — `zlib.gunzipSync` 대신 `fflate` `Gunzip` 스트리밍으로 해제 바이트를 실시간 계수해 50MB를 넘으면 `GzipGuardViolation(SIZE_EXCEEDED)`(디코딩 실패 = `DECODE_ERROR`). URL이 `.gz`로 끝나거나 본문이 gzip 매직 바이트(`1F 8B`)면 적용하고, 위반은 "사이트맵 무시" 경로로 흡수한다. pass 4에서 호출 위치가 크롤러 메인 스레드에서 작업 스레드(`run-extract-job.ts`의 `SITEMAP`)로 옮겨졌다(I-42) | 압축 헤더가 아니라 실제 해제량으로 폭탄을 막는다(KB-17 · `container-guard.ts`와 같은 원칙) | `kb-sync/lib/gzip-guard.ts:1-64` · `kb-sync/lib/run-extract-job.ts`(`SITEMAP`) · `kb-sync/lib/gzip-guard.spec.ts` |
| I-21 | [하드닝] `claimAnySlot()`의 CAS를 단순 동등 비교 `where: { name, claimToken: row?.claimToken ?? null }` 1개로 명시했다. 이전 `OR: [{ claimToken: null }, { claimToken: row?.claimToken ?? undefined }]`는 빈 슬롯에서 `undefined` 갈래를 Prisma가 조건에서 빼(가지치기) **우연히** 안전했을 뿐이다(I-48 실측). 동작 변경은 없다 | "읽은 값과 같을 때만 쓴다"는 CAS 불변식이 코드만 보고도 드러나야 한다(R1 H-1) | `kb-sync/core/kb-run.store.ts`(`claimAnySlot`) · `integration/kb-sync-multi-instance.integration.spec.ts` · `kb-sync/core/kb-run.store.cas.spec.ts` |
| I-22 | [버그 수정] 챗봇 카드(`GET /chatbots/:chatbotId/kb-status`)의 소스 매칭에 서브카테고리 조건이 빠져 있던 것을 §11 규칙대로 3단 모두 적용하게 고쳤다(챗봇 값이 있을 때만 조건 추가) | §11 매칭 규칙 | `kb-sync/kb-status.service.ts`(챗봇 카드 매칭) |
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
| I-33 | [적재 슬롯 — pass 4] 슬롯은 작업이 **종단 상태가 되거나 백오프로 PENDING에 돌아갈 때까지** 유지된다(SUBMITTED 동안 유지). 작업 행 `slotToken` = 슬롯 키 `"<이름>:<토큰>"`. 제출 결과가 SUBMITTED면 `trySubmitOne()`이 슬롯을 놓지 않고(`keepSlot`), 전이 메서드가 전이 CAS 성공 시 놓는다 — 종단(`succeedJob`·`failJob`·`timeoutJob`·`markSkipped`) · PENDING 복귀(`retryJob`·`resubmitNotFound`·`revertSubmissionClaim`). 조회(`markPolled`)마다 `renewSlot(now)`로 임대를 연장한다. 죽은 인스턴스의 만료 슬롯을 `claimAnySlot()`이 잡으면 그 슬롯의 SUBMITTED 작업 `slotToken`을 새 키로 CAS 재바인딩하고(같은 `taskId` 계속 조회) 그 슬롯은 새 제출에 쓰지 않는다. 스윕은 슬롯 토큰 불일치도 멈춘 작업으로 본다(I-15) | 이전 구현은 제출 직후 슬롯을 놓아, 외부에서 진행 중인 작업 수가 슬롯 수(기본 1)를 넘을 수 있었다(FR-KB4-5 · AC-KB4-1). 최대 3시간 걸리는 SUBMITTED가 임대(기본 10분) 만료로 슬롯을 잃으면 안 된다 | `kb-sync/core/kb-run.store.ts`(`claimAnySlot`·`releaseSlot`·`renewSlot`·`markPolled`·`slotKeyOf`·전이 메서드 7종·`sweepExpiredSubmittingJobs`) · `kb-sync/engine/kb-ingest.runner.ts`(`trySubmitOne`·`submitJob`·`pollDue`) · `kb-sync/core/kb-run.store.slot.spec.ts` · `kb-sync/core/kb-run.store.sweep.spec.ts` |
| I-34 | [작업 조회 — pass 4] `parseTaskStatus()` 결과에 `POLL_AGAIN { rateLimited, retryAfterMs }` 추가 — 네트워크 오류·5xx·429. 작업 상태를 바꾸지 않고 재조회만 한다(재전송 0): 429면 다음 조회를 max(`KB_INGEST_POLL_MS`×2, `Retry-After`) 뒤로, 그 밖은 `KB_INGEST_POLL_MS` 뒤로(`markPolled`에 미래 기준 시각 · 슬롯 연장은 항상 `now`). 끝없는 재조회는 제출 후 3시간 `TIMEOUT`이 끊는다. `not_found` 재전송은 **즉시**(`nextAttemptAt = now`)·**1회**(`resubmitNotFound()` CAS가 `notFoundResubmitted = false`일 때만 성공) · 두 번째 `not_found`는 `TASK_LOST` FAILED. 조회의 그 밖 비2xx(4xx)는 `UPSTREAM_ERROR` 재시도 | 조회의 일시 실패를 제출 실패처럼 재시도(재전송)하면 이미 접수돼 진행 중인 작업이 중복 적재된다(§5.6 · §5.8 "작업 상태는 바꾸지 않음") | `rag/lib/parse-task-status.ts`(`ParsedTaskStatus`·`parseTaskStatus`) · `kb-sync/engine/kb-ingest.runner.ts`(`pollDue`) · `kb-sync/core/kb-run.store.ts`(`markPolled`·`resubmitNotFound`) · `rag/lib/parse-task-status.spec.ts` |
| I-35 | [재수집 실패 — pass 4] 적재 단계의 재수집 실패(네트워크 = `NETWORK_ERROR` · 404·410 외 비2xx = `UPSTREAM_ERROR`)도 제출 실패와 같은 `handleFailureOrRetry()` — 백오프 1·5·30분 · `attemptCount` 3회 소진 시 FAILED. 선점(SUBMITTING · `attemptCount + 1`)이 재수집보다 먼저다 | 이전 구현은 고정 1분 재시도를 횟수 제한 없이 반복해, 사이트가 계속 죽어 있으면 작업이 PENDING에서 영원히 못 벗어났다(NFR-KBR3) | `kb-sync/engine/kb-ingest.runner.ts`(`submitJob`·`handleFailureOrRetry`) · `kb-sync/lib/backoff.ts` |
| I-36 | [vLLM 판정 — pass 4 · 버그 수정] 적재 전 준비 판정 = `status()` 응답 **최상위** `vllm_ready === true`(`API_RAG.md` §0-5). 결과는 `KbJobLease('INGEST_STATUS').state = { checkedAt, vllmReady }`에 저장해 60초 캐시로 쓴다(모든 인스턴스 공유 — 인스턴스 메모리 캐시 없음). 호출 한도 초과 시 캐시값. 확인은 대기 작업이 있을 때만, 슬롯 선점 **전**에 한다 | 이전 구현은 최상위에 없는 `vllm.status`를 읽어 실제 서버에서는 늘 "준비 안 됨"이 되어 적재가 한 건도 나가지 않았다(시험은 가짜 응답이라 통과). `services.vllm.status`는 보조 정보라 쓰지 않는다 | `kb-sync/engine/kb-ingest.runner.ts`(`vllmReady`·`trySubmitOne`) |
| I-37 | [저장 검증 — pass 4] ① 거버넌스 검사 `assertGovernanceFlags()`를 등록·**수정** 양쪽에서 부른다 — 수정은 본문에 실린 필드만 검사한다(거버넌스를 나중에 켠 기존 소스의 이름 변경·일시중지까지 막지 않기 위해 — 저장된 값이 이미 규칙 위반이어도 그 필드를 보내지 않으면 통과한다). ② 서버 상한 `clampLimits()`(`maxDepth` ≤ 5 · `maxPages` ≤ `KB_CRAWL_MAX_PAGES_CAP` · `maxFileBytes` ≤ `KB_CRAWL_MAX_FILE_BYTES` · `minIntervalMs` ≥ 하한)을 PATCH에도 적용한다 | 이전 구현은 수정 경로에 검사가 없어 `PATCH { piiMask: false }`로 AC-KB6-3이 우회됐고, 상한을 넘는 값이 그대로 저장됐다 | `kb-sync/kb-sources.service.ts`(`assertGovernanceFlags`·`clampLimits`·`create`·`update`) |
| I-38 | [configVersion — pass 4] 순수 `lib/config-change.ts` `detectConfigChange(current, next)` — 본문에 있는 범위 필드만, 저장된 현재 값과 **다를 때만** 변경으로 본다. 목록(시작 주소·사이트맵·경로 접두·제외·잡음·파일 형식)은 **집합** 비교, 숫자(`maxDepth`·`maxPages`·`maxFileBytes`)는 서버 상한으로 잘라 낸 **저장될 값**으로 비교, 스코프 3단은 각각(`scopeChanged` 별도 반환). 실제 변경일 때만 `configVersion + 1`이고, `409 KB_SOURCE_BUSY`(실행 중 범위 수정)도 실제 변경일 때만 낸다 | 이전 구현은 범위 필드가 본문에 **있기만** 하면(값이 같아도) 올려, 콘솔이 폼 전체를 다시 보내면 이름만 바꿔도 승인이 무효가 되고 실행 중에는 409가 났다 | `kb-sync/lib/config-change.ts` · `kb-sync/lib/config-change.spec.ts` · `kb-sync/kb-sources.service.ts`(`update`·`snapshotOf`) |
| I-39 | [실행 생성 — pass 4] `KbSourcesService.claimAndCreateRun()` — 한 `$transaction` 안에서 `claimForRun(tx)`(소스 행 CAS) → (승인 경로만) `approveConfigVersion(tx)` → `KbRunStore.createRun({ id, … }, tx)`. id는 이 메서드가 `randomUUID()`로 만든다. 스케줄러·수동 실행·`approve-ingest` 세 경로가 모두 이것만 부른다. 선점 실패 = `null`(승인 기록도 없음). 트랜잭션 안에서는 `tx`만 쓴다 | §9.2 "실행 행 생성과 CAS는 한 트랜잭션" — 따로 하면 선점 뒤 실행 행 생성 전 실패·종료 시 `activeRunId`가 없는 실행을 가리켜 소스가 영구히 "실행 중"이 된다. SQLite는 연결이 하나라 트랜잭션 안에서 `this.prisma`를 부르면 교착한다 | `kb-sync/kb-sources.service.ts`(`claimAndCreateRun`·`claimForRun`·`approveConfigVersion`) · `kb-sync/core/kb-run.store.ts`(`createRun`) · `kb-sync/engine/kb-scheduler.ts`(`scheduleDueSources`) · `kb-sync/kb-runs.service.ts`(`createRun`·`approveIngest`) |
| I-40 | [크롤 집계 — pass 4] 종결 `counts` = `countRunObservations()`(added·changed·unchanged·visitedHtml) + `countRunOutcomes()`(`seenRunId = 실행` 행 — discovered = VISITED+QUEUED · visited · missing = ACTIVE ∧ `missingStreak > 0` · gone · needsCleanup · piiMasked = `observedPiiMasked` 합 · excluded = 사유별 `groupBy`) + 삭제 감지 스윕이 바꾼 몫(missing·gone·needsCleanup). `outOfScopeLinks`는 행이 없어 크롤 중 `addOutOfScopeLinks()`가 실행 행 `counts` JSON에 누적(CRAWLING일 때만 · 읽기-수정-쓰기)하고 종결 때 이어받는다. 진행 중 실행의 응답 `crawl`은 저장값 `{}`를 계약 모양(전 필드 0)으로 채운다 | 이전 구현은 종결 때 discovered·visited·gone·excluded 등을 0으로 써서 실행 요약이 늘 비었고, 진행 중 `{}`는 `KbRunCrawlCounts` 계약 위반이었다 | `kb-sync/core/kb-run.store.ts`(`countRunOutcomes`·`countRunObservations`·`addOutOfScopeLinks`) · `kb-sync/engine/kb-crawl.runner.ts`(`processLoop`·`visitOne`) · `kb-sync/lib/build-run-view.ts`(`parseCrawlCounts`) |
| I-41 | [로그 — pass 4] 예외 로그는 `kbLogLine({ host, path, code: kbErrorCode(e) })`만 — `kbErrorCode()`는 대문자 오류 코드(`ECONNRESET`·`P2002` 형식)가 있으면 그것, 없으면 클래스명, 둘 다 식별자 형식이 아니면 `UnknownError`. `e.message`·`${e}`·`String(e)` 금지(템플릿 문자열 포함). 부팅 점검 실패 로그는 고정 문구. 봉인 KB-15 강화: `kb-sync/**`와 `rag/rag-http.client.ts`의 logger 인자에 오류 원문 패턴 0 + 역검증 픽스처 | 오류 원문에는 URL·경로·응답 조각·비밀이 섞일 수 있다(§10 · AC-KB6-4) | `kb-sync/lib/kb-log-line.ts`(`kbErrorCode`) · `kb-sync/engine/kb-crawl.runner.ts`·`kb-ingest.runner.ts`·`kb-sync.job.ts` · `kb-sync/lib/kb-sync-sealing.spec.ts`(KB-15) · `kb-sync/engine/kb-sync-log-leak.spec.ts` · `kb-sync/lib/kb-log-line.spec.ts` |
| I-42 | [사이트맵 — pass 4] gzip 해제(50MB)·문자 해석·XML 파싱을 작업 스레드에서 한다 — 추출 요청 종류 `SITEMAP { bytes, contentType, gzipped }` · 결과 `sitemap: { kind, locs }`(위반·오류는 `REJECTED`로 수렴 · 예외 없음). `<sitemapindex>`는 1단계만 추적(자식 안의 색인 무시) · 파일 50개는 자식 포함 실행당 · 파일당 압축 10MB(`fetchWithRedirects`의 `maxBytes`). 크롤러는 `Buffer`의 복사본(`new Uint8Array(buf)`)을 넘긴다. `WorkerEntryMissingError`만 위로 올린다 | 이전 구현은 메인 스레드에서 해제·파싱해 최대 50MB·10만 URL 처리가 공개 대화 이벤트 루프를 막을 수 있었고(§7.2), 색인의 `<loc>`(자식 사이트맵 주소)을 페이지 URL로 넣었다. `Buffer`는 공유 풀을 가리킬 수 있어 그대로 이전(transfer)하면 풀 전체가 분리된다 | `kb-sync/extract/kb-extractor.port.ts`(`KbExtractRequest`·`KbExtractResult.sitemap`) · `kb-sync/lib/run-extract-job.ts` · `kb-sync/engine/kb-crawl.runner.ts`(`ensureSeeded`·`loadSitemapLocs`·`fetchAndParseSitemap`) · `kb-sync/lib/run-extract-job.sitemap.spec.ts` · `kb-sync/engine/kb-crawl.runner.sitemap.spec.ts` |
| I-43 | [BULK 시간창·대기 사유 — pass 4] 적재기가 `isWithinBulkWindow(KB_INGEST_BULK_WINDOW, now)`로 `pickNextPendingJob(now, bulkAllowed)`를 불러 시간창 밖에서는 BULK를 고르지 않는다(INCREMENTAL은 항상). `waitingReason` = 순수 `decideWaitingReason()` — `INGESTING` ∧ 대기 > 0 ∧ 진행 0일 때만: `RAG_NOT_READY`(캐시된 준비 = false) · `BULK_WINDOW`(시간창 닫힘 ∧ 대기가 전부 BULK). `RATE_LIMIT`은 미구현(인스턴스 메모리 상태 — RG-14). 입력 `KbRunStore.getWaitingContext(runIds)`. `GET /kb-sources/meta`의 `ragReady`·`ragCheckedAt`도 같은 `INGEST_STATUS` 캐시로 채운다 | 이전 구현은 시간창을 무시했고 `waitingReason`·`ragCheckedAt`이 늘 null이었다(AC-KB4-4 "실행 화면 '외부 RAG 준비 안 됨'") | `kb-sync/engine/kb-ingest.runner.ts`(`trySubmitOne`) · `kb-sync/core/kb-run.store.ts`(`pickNextPendingJob`·`getWaitingContext`) · `kb-sync/lib/build-run-view.ts`(`decideWaitingReason`) · `kb-sync/kb-runs.service.ts`·`kb-sync/kb-sources.service.ts`(`toResponse`)·`kb-sync/kb-status.service.ts`(meta) · `kb-sync/lib/build-run-view.spec.ts` |
| I-44 | [작업 정리·연속 실패 수 — pass 4] `consecutiveIngestFailures`는 FAILED·TIMEOUT 전이에서만 +1(`releaseDocumentActiveJob(id, true)`) · SKIPPED·설정 변경 취소(`CONFIG_CHANGED`)·중지는 올리지 않는다 · 성공 시 0. `cancelRun()`은 PENDING → CANCELLED · SUBMITTED → UNKNOWN(슬롯 해제) · 문서 `activeIngestJobId` 해제(`clearDocumentActiveJobs`). 스윕의 UNKNOWN 전이도 문서 표식을 푼다 | 이전 구현은 "변경 없음 건너뜀" 3회가 "반복 실패" 배지를 띄웠고(EX-KB-3 오탐), 중지된 실행의 작업이 슬롯(임대 만료까지)·문서 표식(영구)을 붙잡아 다음 실행이 그 문서를 적재 대상으로 삼지 못했다 | `kb-sync/core/kb-run.store.ts`(`releaseDocumentActiveJob`·`clearDocumentActiveJobs`·`markSkipped`·`cancelJobConfigChanged`·`cancelRun`·`failJob`·`timeoutJob`·`sweepExpiredSubmittingJobs`) · `kb-sync/core/kb-run.store.slot.spec.ts` |
| I-45 | [스코프 변경·일시중지 — pass 4] ① 수정으로 스코프 3단 중 하나라도 바뀌면(`detectConfigChange().scopeChanged`) 저장 직후 `KbRunStore.markScopeChanged()` — `state = ACTIVE ∧ lastIngestedAt ≠ null ∧ cleanupReason = null` 문서에 `SCOPE_CHANGED`(다른 정리 사유는 보존). ② `enabled`가 실제로 바뀌면 `STATUS_CHANGE` 감사(`[일시중지]`·`[재개]`)를 남기고, `false`로 바꿀 때 진행 중 실행이 있으면 `cancelRun()` → `releaseActiveRun(CANCELLED)` | §9.8(Q-4 · K-9) · §9.9 · §13 설계대로 — 이전 구현에 없던 동작 | `kb-sync/kb-sources.service.ts`(`update`) · `kb-sync/core/kb-run.store.ts`(`markScopeChanged`·`cancelRun`) · `kb-sync/core/kb-run.store.slot.spec.ts` |
| I-46 | [실행 실패 코드·프런티어·시계 — pass 4] ① 실행 수준 실패 코드 3종 구현: `SECRET_MISSING`(크롤 시작 전 — `STATIC_HEADER` ∧ 비밀 없음 · `failRun()`) · `INGEST_NOT_ACKNOWLEDGED`·`RAG_NOT_CONFIGURED`(크롤 종결 시 SYNC·FULL_RESEND — 적재 작업 0 · FAILED · 집계 기록). ② `seedFrontier()`가 재방문 행을 QUEUED로 되돌릴 때 `observedChange = null`. ③ 적재 단계의 백오프·완료·종결·재전송 시각은 tick 주입 시계 `now`(크롤 단계는 여전히 `new Date()`) | ① §3.3·§5.7·§6.9 설계대로 ② 방문하지 못한 행(상한·중지)이 지난 실행의 NEW·CHANGED로 적재 후보에 잡히는 버그 ③ `pickNextPendingJob(now)`와 시계를 맞춰 시계 주입 시험이 결정적이 된다 | `kb-sync/engine/kb-crawl.runner.ts`(`processLoop`·`failRun`) · `kb-sync/core/kb-run.store.ts`(`seedFrontier`·`finishCrawl`) · `kb-sync/engine/kb-ingest.runner.ts`(`handleFailureOrRetry`·`pollDue`·`finalizeIngestingRuns`) |
| I-47 | [신규 내부 API — pass 4 목록] `KbRunStore`: `getWaitingContext(runIds)` · `countRunOutcomes(sourceId, runId)` · `addOutOfScopeLinks(runId, n)` · `markScopeChanged(sourceId)` · `renewSlot(slotKey, now)` · `createRun(data, tx?)` · `markPolled(id, lastPolledAt, now?)` · 전이 메서드의 `now` 인자. `KbSourcesService`: `claimAndCreateRun(input)` · `claimForRun(…, tx?)` · `approveConfigVersion(…, tx?)`. `lib/kb-log-line.ts`: `kbErrorCode(e)`. 신규 파일 `lib/config-change.ts`(`detectConfigChange` · `KbConfigSnapshot` · `KbConfigChange`). `rag/lib/parse-task-status.ts`: 결과 `POLL_AGAIN` | 모듈 export 0은 그대로(모두 `kb-sync` 안 · `rag/lib`은 순수 함수) — 외부 계약(shared-types·HTTP) 변경 0 | 위 각 파일 |
| I-48 | [Prisma where 의미 — pass 4 실측] 필드 값 `undefined` = 그 조건 제거 · `null` = `IS NULL` · `OR` 배열 안의 `undefined` 갈래 = 가지치기(실측 `kb-run.store.cas.spec.ts`). 그래서 CAS 조건에 `?? undefined`를 쓰지 않고(I-21), `releaseSlot()`·`renewSlot()`은 `parseSlotKey()`로 `이름:토큰` 형식을 먼저 확인해 틀리면 아무것도 하지 않는다. 스윕도 형식 오류 키를 멈춘 작업으로 본다 | 토큰이 `undefined`로 새면 `where: { name }`만 남아 남의 슬롯을 놓거나 연장한다 — CAS 불변식이 조건 생략으로 조용히 깨진다 | `kb-sync/core/kb-run.store.ts`(`parseSlotKey`·`releaseSlot`·`renewSlot`·`claimAnySlot`·`sweepExpiredSubmittingJobs`) · `kb-sync/core/kb-run.store.cas.spec.ts` |
| I-49 | [실행 실패·중지 코드 — pass 5 · RG-1] 크롤 종결에서 `!maxPagesReached ∧ !seedReached`면 삭제 감지 스윕·자동 강등·적재 작업 생성을 **모두 건너뛰고** `FAILED`로 끝낸다(PREVIEW도 같음). 코드: 허용 호스트 **전부**가 중단 호스트이고 그중 429·503 연속 중단(인스턴스 메모리 `throttleAborted`)이 하나도 없으면 `ROBOTS_UNREACHABLE`, 아니면 `ALL_SEEDS_UNREACHABLE`. 시작 주소 도달(`seedReached`) = 깊이 0 행(시작 주소 + 사이트맵 URL) 중 하나라도 실패가 아닌 결과. 실패 = 전송 오류·출구 차단·범위 밖 리다이렉트(`ERROR`) · 404·410 외 비2xx · 429·503 재시도 소진·호스트 중단 · 중단 호스트의 문서. 도달 = 2xx·304·404·410·robots 차단·제외(SIZE·NOINDEX·NO_BODY·파일 검사) — `RAW_FILE_OFF`는 요청 없이도 도달로 센다(§25.2 RG-20). 중지 = `cancelRunAndRelease(…, 'CANCELLED_BY_USER')`(관리자 중지) · `'SOURCE_DISABLED'`(수정으로 `enabled = false`) — **`failureCode`가 있는 `CANCELLED`**(§3.3 원안 "failureCode 없음"과 다름). 중지된 실행의 PENDING 작업 `resultCode`는 두 경우 모두 `CANCELLED_BY_USER`다 | AC-KB3-4 "5xx는 카운트하지 않음"이 사이트 단위 장애에서 깨지던 문제(이전 RG-1①). 중지 원인을 실행 이력에 남기는 편이 운영에 유용하고 계약 enum에 이미 있는 값이라 계약 변경 0 | `kb-sync/engine/kb-crawl.runner.ts`(`processLoop`·`noteSeedResult`·`abortHost`) · `kb-sync/kb-sources.service.ts`(`finishCrawlAndRelease`·`cancelRunAndRelease`·`update`) · `kb-sync/kb-runs.service.ts`(`cancelRun`) · `kb-sync/core/kb-run.store.ts`(`cancelRun`) · `integration/kb-crawl-rg-gaps.integration.spec.ts`(RG-1) |
| I-50 | [실행 행 표식 — pass 5] ① `abortedHosts`를 종결 때만이 아니라 **실행 중에도** 실행 행에 누적하고(`KbRunStore.addAbortedHost()` — `status = CRAWLING`일 때만 · 읽기-수정-쓰기) 조각 시작 때 다시 읽는다 — robots 5xx·429·503 중단 호스트가 tick·인스턴스가 바뀌어도 그 실행 동안 유지된다. ② `seedReached` 표식을 실행 행 `counts` JSON에 1회 기록(`markSeedReached()`)하고, 종결 때는 계약 키만으로 `counts`를 다시 쓴다. 진행 중 조회의 `parseCrawlCounts()`는 계약 키(`EMPTY_CRAWL_COUNTS`의 키)만 싣는다 — 응답 계약 변경 0 | 조각 실행(§9.3)에는 tick 지역 변수가 남지 않는다. 새 컬럼 대신 기존 `abortedHosts`·`counts` 열을 재사용해 마이그레이션 0. 두 쓰기 모두 "크롤 임대 보유자 1명만 쓴다"는 전제이며 I-56이 그 전제를 보장한다 | `kb-sync/core/kb-run.store.ts`(`addAbortedHost`·`markSeedReached`) · `kb-sync/engine/kb-crawl.runner.ts`(`processLoop`·`readSeedReached`) · `kb-sync/lib/build-run-view.ts`(`parseCrawlCounts`) |
| I-51 | [크롤 429·503 — pass 5 · RG-4] `visitOne()`은 429·503을 기록하지 않고 `THROTTLED { retryAfter }`로 올린다. 호출부: 호스트 연속 횟수 +1(키 `실행|호스트` · 인스턴스 메모리) — 5회(`HOST_THROTTLE_ABORT_STREAK`)면 그 호스트 중단(`abortedHosts`) + 이 문서 `TRANSIENT` · 그 전이면 이 문서의 첫 429·503은 **QUEUED로 남겨** 1회 재시도(재시도 여부 = 인스턴스 메모리 `retriedDocs`) · 두 번째는 `TRANSIENT`(삭제 감지 미산입). 페이서의 다음 요청 가능 시각은 순수 `lib/throttle-delay.ts` `throttleDelayMs()` = `Retry-After`(초·HTTP-date) 또는 간격×4, 하한 = 정상 간격, 상한 60초 — tick은 기다리지 않고(비차단) 조각을 끝내 다음 조각에서 다시 시도한다. 연속 횟수는 재시도 응답까지 센다(응답 기준) · `ERROR`는 연속을 끊지도 늘리지도 않고 그 밖 응답은 0으로 되돌린다 | §6.8 · FR-KB2-5(사이트 부하 예의) | `kb-sync/lib/throttle-delay.ts` · `kb-sync/engine/kb-crawl.runner.ts`(`processLoop`·`visitOne`) · `kb-sync/crawl/kb-host-pacer.ts` · `kb-sync/lib/throttle-delay.spec.ts` · `integration/kb-crawl-rg-gaps.integration.spec.ts`(RG-4 — 조각 넘김 포함) |
| I-52 | [종결 원자성·자가 치유 — pass 5 · RG-5] `KbSourcesService`에 `finishCrawlAndRelease()`(크롤 종결 — 다음 상태가 INGESTING이 아니면 선점 해제까지) · `finishIngestingAndRelease()` · `cancelRunAndRelease()` — 각각 한 `$transaction`(`TX_OPTIONS`)에서 `KbRunStore` 전이 CAS(`finishCrawl`·`finishIngesting`·`cancelRun` — 선택 인자 `tx`)가 성공할 때만 `releaseActiveRun(tx)`. 스케줄러 tick 첫머리 `healOrphanedActiveRuns()` — `activeRunId`가 종단 상태(또는 부재) 실행을 가리키면 CAS로 해제(부재면 `FAILED`·현재 시각 기록 · 예외는 로그만 남기고 예약은 계속). `FULL_RESEND { acknowledgeCleanup }`의 GONE 삭제·정리 표시 해제는 `claimAndCreateRun()`의 선택 인자로 **선점 성공 트랜잭션 안**. 재종결 멱등: ① `findStaleDocuments(sourceId, runId, untouchedSince = 실행 startedAt)`이 실행 시작 뒤 바뀐 행을 빼 같은 행을 두 번 세지 않는다 ② 이번에 만든 작업이 0이어도 그 실행의 작업이 이미 있으면(`countJobsByRun`) INGESTING으로 간다 | NFR-KBR2 — 종결과 해제 사이 사망 시 소스가 영구히 "실행 중"이 되던 문제. §9.2(선점 + 실행 생성 한 트랜잭션)와 같은 원칙으로 해제도 쌍으로 원자화하고, 과거 잔여 상태는 자가 치유가 덮는다 | `kb-sync/kb-sources.service.ts`(`finishCrawlAndRelease`·`finishIngestingAndRelease`·`cancelRunAndRelease`·`healOrphanedActiveRuns`·`claimAndCreateRun`) · `kb-sync/core/kb-run.store.ts`(`finishCrawl`·`finishIngesting`·`cancelRun`·`findStaleDocuments`·`applyCleanupAcknowledge`) · `kb-sync/engine/kb-scheduler.ts`(`scheduleDueSources`) · `kb-sync/engine/kb-ingest.runner.ts`(`finalizeIngestingRuns`) · `kb-sync/kb-runs.service.ts`(`createRun`) · `integration/kb-ingest-rg-gaps.integration.spec.ts`(RG-5) |
| I-53 | [축소 — pass 5 · RG-6] `succeedJob()`이 문서 갱신 **전에** 이전 `textLength`·`byteSize`·`lastIngestedAt`·`cleanupReason`을 읽어 순수 `isShrunk()`(`lib/change-detect.ts`)로 판정 — 이전에 적재됐고 이번 값(작업 행 — HTML은 `textLength`, 파일은 `byteSize`)이 이전 × 0.5 미만이면 같은 갱신에서 `cleanupReason = SHRUNK`(다른 사유가 이미 있으면 보존). 크롤 단계의 `decideChange().shrunk`는 쓰지 않는다 | AC-KB3-5 · "적재된 내용"은 적재 성공 시점에만 바뀌므로 판정 위치로 맞다(스키마 변경 0) | `kb-sync/core/kb-run.store.ts`(`succeedJob`) · `kb-sync/lib/change-detect.ts`(`isShrunk`) · `kb-sync/lib/change-detect.spec.ts` · `integration/kb-ingest-rg-gaps.integration.spec.ts`(RG-6) |
| I-54 | [원본 파일 꺼짐 — pass 5 · RG-7] `processLoop()`가 페이서·robots **앞에서** `kind ≠ HTML ∧ !allowRawFileIngest`면 요청 없이(페이서 대기 0) `EXCLUDED(RAW_FILE_OFF)`로 기록한다(`SourceConfig.allowRawFileIngest` 추가 — `lib/parse-source-row.ts`). 적재 단계의 "원본 전달 꺼짐 → `SKIPPED(EXCLUDED_AT_INGEST)`" 방어는 그대로 둔다 | AC-KB6-2 · AC-KB7-2 · §6.7 | `kb-sync/engine/kb-crawl.runner.ts`(`processLoop`) · `kb-sync/lib/parse-source-row.ts` · `integration/kb-crawl-rg-gaps.integration.spec.ts`(RG-7) |
| I-55 | [원본 파일 사전 검사 — pass 5 · RG-8] `lib/inspect-raw-file.ts` `inspectRawFile(extractor, kind, bytes)` — 작업 스레드 `PDF`·`OOXML` 추출(복사본 전달)로 `FILE_ENCRYPTED`(암호 — `encrypted` 또는 플래그) · `FILE_UNSAFE`(컨테이너 가드·매크로·추출 실패·예외·알 수 없는 형식) · 통과 시 `piiMaskedCount`. **크롤 방문**(원본 전달 켜짐): 파일 상한 초과 = `SIZE` → 검사 불합격 = 그 사유로 EXCLUDED → 거버넌스 ON ∧ 건수 ≥ 1 = `EXCLUDED(PII_IN_RAW_FILE)` → 통과 = `observedPiiMasked` = 건수. **적재 재수집 뒤**(해시가 바뀐 경우만): 같은 검사 · 걸리면 `SKIPPED(EXCLUDED_AT_INGEST)` · 통과 시 작업 `piiMaskedCount`. `WorkerEntryMissingError`는 올린다(적재는 `revertSubmissionClaim()` 뒤). 추출 텍스트는 보내지 않는다(원본 바이트 그대로). 미구현: 파일 제목 추출 · 스캔 PDF(텍스트 0) 경고(§7.1 ②③ — §25.2 RG-11 잔여) | §7.3 · ADR-0044 §10 · R-17 | `kb-sync/lib/inspect-raw-file.ts` · `kb-sync/engine/kb-crawl.runner.ts`(`visitOne`) · `kb-sync/engine/kb-ingest.runner.ts`(`submitJob`) · `kb-sync/lib/inspect-raw-file.spec.ts` · `integration/kb-crawl-rg-gaps.integration.spec.ts`(RG-8) · `integration/kb-ingest-rg-gaps.integration.spec.ts`(RG-8) |
| I-56 | [크롤 임대 — pass 5 · RG-9·RG-15] `KbCrawlRunner`는 **자기가 획득한** 토큰만 인스턴스 메모리(`leaseTokens: Map<runId, token>` · 200개 상한)에 둔다. `acquireLease()` = 쥔 토큰이 있으면 그 토큰으로 `renewCrawlLease()`(실패하면 버림) → 없으면 `claimCrawlLease()`(QUEUED 선점 · 만료된 CRAWLING 인수 · 유효한 남의 임대면 `null` = 이번 tick 처리 안 함). `processLoop()`는 **URL마다** 자기 토큰으로 갱신하고, 실패하면(중지 — `cancelRun()`이 `claimToken`을 비움 · 다른 인스턴스 인수 · 종결) 새 요청 없이 `LOST`로 끝낸다 — 진행 중 요청 1개만 마무리(AC-KB5-4). 종결 직전에도 한 번 더 갱신한다. `DONE`·`LOST`면 그 실행의 메모리 상태(`leaseTokens`·`retriedDocs`·`throttleStreaks`·`throttleAborted`)를 버린다. DB에서 읽은 남의 토큰으로 갱신하던 `tryRenewAndProcess()` 경로는 없어졌다 | NFR-KBR1 · §6.8(K-5 완화 전제 "실행당 1인스턴스") · AC-KB5-4 | `kb-sync/engine/kb-crawl.runner.ts`(`runFragment`·`acquireLease`·`forgetRun`·`processLoop`) · `kb-sync/core/kb-run.store.ts`(`claimCrawlLease`·`renewCrawlLease`) · `integration/kb-sync-multi-instance.integration.spec.ts`(RG-9) · `integration/kb-crawl-rg-gaps.integration.spec.ts`(RG-9·RG-15) |
| I-57 | [GONE 해제·`markVisited` 의미 — pass 5 · RG-10] `markVisited(data.cleanupReason)`: `undefined` = 유지 · `null` = 해제 · 문자열 = 그 값(Prisma where가 아니라 data의 `undefined` = 미변경 의미 — I-48과 같은 규칙). pass 4까지는 304 경로가 `null`(해제)을 넘겨도 실제로 해제되지 않았다(결함 수정). 200(HTML·파일)·304 경로 모두 `nextMissingState(SEEN_OK)`의 `cleanupReason`(GONE이면 해제 · 다른 사유 보존 — `seenOkCleanupReason()`)을 넘긴다. `finalizeExcluded()`는 넘기지 않는다(유지) | §8.3 "복귀 시 GONE 해제" | `kb-sync/core/kb-run.store.ts`(`markVisited`) · `kb-sync/engine/kb-crawl.runner.ts`(`seenOkCleanupReason`·`visitOne`·`finalizeMissing`) · `integration/kb-crawl-rg-gaps.integration.spec.ts`(RG-10) |
| I-58 | [HTML 부가 판정·적재 noindex — pass 5 · RG-11 일부 · RG-12] 크롤: HTML 응답은 min(소스 `maxFileBytes`, 2MB)에서 스트림을 끊고 `RESPONSE_TOO_LARGE`는 일시 오류가 아니라 `EXCLUDED(SIZE)`(파일 상한 초과도 같음) · 추출 플래그 `NO_BODY`(텍스트 200자 미만)면 `EXCLUDED(NO_BODY)`하되 nofollow가 아니면 링크는 계속 따라간다(EX-KB-6) · 순수 `lib/x-robots-tag.ts` `parseXRobotsTag(value, productToken)` — `noindex`·`nofollow`·`none` · `<봇 이름>:` 접두 지시는 우리 제품 토큰일 때만(다른 봇 지시 무시 · 알려진 지시어 이름은 봇 이름으로 보지 않음) · 쉼표로 합쳐진 값 처리 — 메타 `robots`와 OR. 적재: 재수집 HTML의 메타 `noindex` ∨ `X-Robots-Tag` noindex → `SKIPPED(EXCLUDED_AT_INGEST)`(§9.5 2단계). 적재 단계의 "범위 밖" 재검사는 두지 않는다 — 문서 URL은 크롤 때 범위 판정을 거쳤고, 범위가 바뀌면 `configVersion` 불일치로 작업이 `CONFIG_CHANGED` 취소된다 | §7.3 · EX-KB-6 · §6.5 · §9.5 | `kb-sync/engine/kb-crawl.runner.ts`(`visitOne`·`followLinks`) · `kb-sync/lib/x-robots-tag.ts` · `kb-sync/engine/kb-ingest.runner.ts`(`submitJob`) · `kb-sync/lib/x-robots-tag.spec.ts` · `integration/kb-crawl-rg-gaps.integration.spec.ts`(RG-11) · `integration/kb-ingest-rg-gaps.integration.spec.ts`(RG-12) |
| I-59 | [공유 전송 포트 — pass 5 · **No.26 파일**] `LegacyTransportRequest.captureHeaders` 닫힌 목록에 `'retry-after'`를 더했다(6 → 7 · §6.3 · §2.5). `node-http.transport.ts`의 헤더 캡처는 값이 배열이면 `', '`로 합친다(이전 = 첫 값). `captureHeaders` 미지정의 기본 동작(결과에 `headers` 키 없음)은 그대로라 레거시·웹훅 호출부와 그 spec은 무수정이다. 참고: Node `http`는 `etag`·`last-modified`·`location`·`content-length`·`retry-after`의 중복 줄을 버리고 `x-robots-tag`·`content-encoding`은 이미 `', '`로 합쳐 주므로(배열은 `set-cookie`뿐) 현 닫힌 목록에서 배열 분기는 실질 동작 변화가 없는 방어 코드다. 결과 최상위 `retryAfter`(No.26 기존 필드)가 이미 있지만 크롤러는 `headers['retry-after']` 한 경로로 읽는다 | I-51의 `Retry-After` · 다중 `X-Robots-Tag` 방어 | `legacy-api/transport/legacy-transport.port.ts`(`captureHeaders`) · `legacy-api/transport/node-http.transport.ts`(헤더 캡처) · `kb-sync/crawl/kb-crawl-http.fetcher.ts`(`fetchOnce`) · `kb-sync/crawl/kb-crawl-http.fetcher.spec.ts` · ADR-0034 갱신 각주 |
| I-60 | [결함 수정 — pass 5] ① `KbCrawlHttpFetcher.fetchOnce()`가 **304를 3xx 리다이렉트로 분류**해(`Location` 없음 → 크롤러가 오류로 처리) 조건부 요청(`If-None-Match`·`If-Modified-Since`)이 한 번도 "변경 없음"으로 끝나지 못했다 → 3xx 중 `!== 304`만 `REDIRECT`. pass 4까지의 실제 영향: 검증자가 저장된 문서의 재실행 304가 `TRANSIENT`로 기록돼 변경 없음 집계·304 경로 GONE 해제가 동작하지 않았다(적재 0 · AC-KB3-1은 유지). pass 5의 RG-1 판정에서는 시작 주소 304가 "접속 실패"로 잡혀 멀쩡한 사이트가 `ALL_SEEDS_UNREACHABLE`가 될 수 있었다. ② robots.txt 그룹 선택과 `X-Robots-Tag` 접두 비교를 `KB_CRAWL_USER_AGENT` 전체 문자열(`ChatBotKBCrawler/1.0`)이 아니라 **제품 토큰**(`/` 앞 · 소문자 — `chatbotkbcrawler`)으로 한다(§6.5 설계대로 — 이전 구현은 우리 이름의 그룹을 찾지 못해 `*` 그룹만 적용했다) | §8.2 R-24 · §6.5 | `kb-sync/crawl/kb-crawl-http.fetcher.ts`(`fetchOnce`) · `kb-sync/engine/kb-crawl.runner.ts`(`productToken`·`getRobots`) · `kb-sync/engine/kb-ingest.runner.ts`(`productToken`) · `kb-sync/crawl/kb-crawl-http.fetcher.spec.ts` |
| I-61 | [시험 — pass 5] 신규: `integration/kb-crawl-rg-gaps.integration.spec.ts`(RG-1·4·7·8·9·10·11·15) · `integration/kb-ingest-rg-gaps.integration.spec.ts`(RG-5·6·8·12) · `integration/helpers/kb-crawl-db-harness.ts`(실제 SQLite + 실제 `KbRunStore`·`KbSourcesService` — 소스는 `KbSourcesService.create()`로만 만든다 · KB-9 준수) · `kb-sync-multi-instance.integration.spec.ts` RG-9 절 · 순수 spec `throttle-delay`·`x-robots-tag`·`inspect-raw-file`·`change-detect`(`isShrunk`)·`kb-crawl-http.fetcher`(`retry-after` 캡처). `NO_BODY` 활성화로 이 그룹이 만든 통합 spec 4개(`kb-sync`·`kb-sync-redirect-scope`·`kb-sync-phase8`·`kb-sync-ingest-retry-outcomes`)의 목 페이지에 본문 분량(200자 이상)을 더했다 — 기대값이 아니라 픽스처 보강이고 이 그룹 이전부터 있던 시험이 아니므로 §17.3 X-n(닫힌 목록) 대상이 아니다. RG-5 자가 치유 시험 1곳은 고아 상태를 만들려고 spec 안에서 `kbSource`를 직접 갱신한다(봉인 KB-9 스캔은 `*.spec.ts` 제외) | FR-0-212 · KB-9 | 위 각 파일 |
| I-62 | [링크 중복 제거·시작 주소 판정 — pass 6 · R3 H-1] `followLinks()`가 정규화 뒤 URL을 중복 제거하고(`/docs/a`와 `/docs/a#intro`) `seedFrontier()`도 배치 안 같은 `urlHash`는 먼저 나온 것만 남긴다 — 이전에는 한 배치에 같은 `(sourceId, urlHash)`가 둘 들어가 `createMany`가 유니크 위반(P2002)으로 **그 쪽의 링크 배치 전체**를 잃었다. `visitOne()`은 응답을 받은 시점에 판정을 `ctx.verdict`(`REACHED`·`FAILED`)에 먼저 적고, 그 뒤 링크 발견·기록에서 예외가 나도 `processLoop()`가 그 판정으로 시작 주소 표식을 남긴 뒤 예외를 올린다(링크 발견 예외가 시작 주소 판정을 오염시키지 않음) | §6.7 · §9.3 · AC-KB3-4 | `kb-sync/engine/kb-crawl.runner.ts`(`followLinks`·`processLoop`·`visitOne`) · `kb-sync/core/kb-run.store.ts`(`seedFrontier`) |
| I-63 | [부모→자식 링크·이어 방문 — pass 6 · R3 H-2 · **스키마 변경**] `KbDocument.discoveredFromId String?`(FK 없음 · 인덱스 `[sourceId, discoveredFromId]`) = 그 문서를 링크로 발견시킨 부모 문서 id. 새 행은 생성 때, 기존 행은 그 실행에서 처음 다시 발견될 때(`seedFrontier()` 재방문 갱신) **그 실행의 첫 발견 부모**로 덮어쓴다(시작 주소·사이트맵 URL = null · 리다이렉트 최종 URL의 부모 = 리다이렉트한 문서). `carryChildren(doc)`: 부모가 이번 실행에서 링크를 얻지 못했으면 — 304 · 전송 오류·비2xx·429·503 재시도 소진(`TRANSIENT`) · robots 차단(직접·리다이렉트 홉) · `SIZE` · 추출 예외(`FILE_UNSAFE`) · 범위 밖 리다이렉트 · 중단 호스트 — `findChildDocuments()`로 지난번 자식 URL을 읽어 `followLinks(…, { countOutOfScope: false })`로 범위를 다시 판정해 프런티어에 넣는다(HTML 부모 ∧ 깊이 < `maxDepth`일 때만 · 자식은 다른 호스트일 수 있음). 자식은 각자 200·304·404로 판정된다. **의도적 nofollow(메타·`X-Robots-Tag`)와 404·410 부모는 이어 넣지 않는다**(자식은 미발견으로 셈). 해결한 결함: ① 부모가 304면 자식이 "다시 발견되지 않음"으로 세어져 연속 2회면 멀쩡한 문서가 GONE·정리 필요(적재된 적 없는 행은 삭제)가 됐다 ② 304 부모 아래 자식은 재방문되지 않아 **자식의 변경이 영영 감지되지 않았다**. 마이그레이션 `20260928100000_kb_document_parent`(`ALTER TABLE "kb_documents" ADD COLUMN "discoveredFromId" TEXT` + `CREATE INDEX` 1 · 백필 0 · 기존 행 null — §3.2 · 한계 §20 K-15·K-16) | §8.3 · FR-KB3 · AC-KB3-4("멀쩡한 문서"가 없어짐으로 세어지지 않음) | `apps/api/prisma/schema.prisma`(`KbDocument`) · `apps/api/prisma/migrations/20260928100000_kb_document_parent/migration.sql` · `kb-sync/core/kb-run.store.ts`(`seedFrontier`·`findChildDocuments`) · `kb-sync/engine/kb-crawl.runner.ts`(`carryChildren`·`followLinks`·`adoptRedirectTarget`·`processLoop`·`visitOne`) |
| I-64 | [FULL_RESEND 해시 무시 — pass 6 · R3 H-3] 적재 단계 3단계의 "문서의 현재 해시·지문과 같으면 `SKIPPED(UNCHANGED_AT_INGEST)`"를 `reason = FULL_RESEND` 작업에는 적용하지 않는다(`forceResend`). 이전에는 변경 없는 문서가 전부 건너뛰어져 "전체 다시 적재"가 사실상 SYNC와 같았다(외부에서 정리한 뒤 다시 채울 수 없음) | §9.8 "해시 무시" · R-18 | `kb-sync/engine/kb-ingest.runner.ts`(`submitJob`) |
| I-65 | [압축 폭탄 조각 해제 — pass 6 · R3 H-4] `lib/push-in-chunks.ts` `pushInChunks()` — 해제기(`fflate` `Unzip`·`Gunzip`)에 입력을 **4KB 조각**(`DECOMPRESS_PUSH_CHUNK_BYTES`)으로 밀고 조각마다 위반 표식을 확인해 즉시 멈춘다. fflate의 `push()`는 받은 입력을 끝까지 해제하고 동기 스트림에는 `terminate()`가 없어, 이전 방식(위반 표식만 세우고 return)은 폭탄을 멈추지 못했다(실측: 300KB → 300MB · 2MB → 2GB). 조각 크기 근거(실측): 64KB 조각 = 조각당 출력 최대 약 67MB · 16KB = 17MB · 4KB ≈ 4.2MB — 위반 시 한도 + 8MB 이내에서 중단. 적용: `container-guard.ts` `safeUnzipEntries()`(OOXML) · `gzip-guard.ts` `safeGunzip()`(사이트맵). PDF: 추출 텍스트 누적 2MB(`MAX_PDF_TEXT_BYTES`) · 쪽당 텍스트 조각 20만 개(`MAX_PDF_ITEMS_PER_PAGE`) — 순수 `takeWithinBudget()`. pdf.js 내부 자원은 §20 K-17 | §7.3 · AC-KB6-5 · ADR-0044 §10 | `kb-sync/lib/push-in-chunks.ts` · `kb-sync/lib/container-guard.ts` · `kb-sync/lib/gzip-guard.ts` · `kb-sync/lib/pdf-text.ts`(`takeWithinBudget`) |
| I-66 | [리다이렉트 공용 헬퍼 — pass 6 · RG-16] `crawl/kb-redirect-follow.ts` `fetchFollowingRedirects()` — 크롤러(문서·사이트맵·robots.txt)와 적재기(재수집)가 같은 규칙을 쓴다: 최대 3회 · 순환 중단 · `https→http` 하향 거부 · **홉마다** 범위(허용 호스트·경로 접두·제외·쿼리 — 깊이 0으로 판정) 재검증 · 출구·주소 판정은 `fetchOnce()`가 요청마다. 범위 밖·하향·4번째 홉·순환 = `REDIRECT_OUT_OF_SCOPE`(그 요청은 나가지 않음) · `Location` 없음·해석 불가 = `ERROR`(→ `TRANSIENT`). 호출부 훅 `beforeRequest`(`DEFERRED`·`VETOED` 반환 가능)·`afterRequest`(예외여도 페이서 해제). **크롤**: `EXCLUDED(REDIRECT_OUT_OF_SCOPE)`(시작 주소 도달로 셈) · 최종 URL ≠ 원래 URL이면 최종 URL(정규화)을 같은 깊이 · 부모 = 원래 문서로 프런티어에 올리고(`adoptRedirectTarget`) 받은 응답을 그 행에 바로 기록 — **원래 URL 행은 `ACTIVE`·방문 표시만(`observedChange = null` · 적재 후보 아님)** · 최종 URL이 이번 실행에서 이미 처리됐으면 원래 행만 표시 · 최종 URL이 비대상 형식이면 원래 행 `EXCLUDED(TYPE)` · 상대 링크는 최종 URL 기준 · 홉마다 robots 재확인(차단 = `EXCLUDED(ROBOTS)`)·페이싱 · 조건부 헤더는 첫 요청에만 · 인증 헤더는 리다이렉트 홉에서 **시작 호스트**로 가는 요청에만. **적재**: 같은 헬퍼(훅 없음 — 홉 페이싱·robots 재확인 없음) · 범위 밖 리다이렉트·응답 상한 초과 = `SKIPPED(EXCLUDED_AT_INGEST)`(재시도 없음). **robots.txt**: 같은 호스트 안 최대 3회(`http→https` 상향 허용) · 타 호스트·하향·초과 = 호스트 중단. **사이트맵**: 허용 호스트 안이면 추종(경로 접두는 사이트맵 파일 위치에 적용하지 않음) | §6.4 · §6.5 · AC-KB2-4 · FR-KB2-7 | `kb-sync/crawl/kb-redirect-follow.ts` · `kb-sync/lib/redirect-policy.ts` · `kb-sync/engine/kb-crawl.runner.ts`(`visitOne`·`adoptRedirectTarget`·`requestHooks`·`getRobots`·`fetchAndParseSitemap`) · `kb-sync/engine/kb-ingest.runner.ts`(`submitJob`) · `integration/kb-sync-redirect-scope.integration.spec.ts` |
| I-67 | [조각 안 대기·예산 분할 — pass 6 · RG-17] `KbHostPacer` 공개 API 확장: `msUntilReady(host, now)`(다른 요청이 호스트를 쥐고 있으면 50ms) · `now`·`sleep` 필드(시험이 가짜 시계로 교체 — 운영은 실시계) · `isReady()` = `msUntilReady() ≤ 0` · `release()`는 항목 500 초과 시 지난 항목 정리. 크롤러 `waitForHost()`: 남은 지연이 이 실행의 조각 기한 안이면 중지 요청을 확인하며 최대 1초씩 조각 안에서 기다린 뒤 계속하고, 넘으면 `DEFERRED`로 조각을 끝낸다(문서는 QUEUED 유지). 요청 훅이 페이지·리다이렉트 홉·**robots.txt 요청**을 모두 페이싱한다 — robots 요청 간격 = 소스 간격(그 호스트 Crawl-delay는 아직 모름) · 429·503이면 다음 요청까지 `throttleDelayMs()`. `KbSyncJob.tick()`: 크롤 예산 = tick 예산 30초 − 적재 몫 5초(`INGEST_RESERVE_MS`) · 실행별 기한 = 남은 크롤 예산 ÷ (병렬 상한 − 처리한 실행 수) — 앞 실행이 일찍 끝나면 남은 시간을 뒤 실행이 이어 쓴다. 영향: robots 요청도 간격 1칸을 쓰므로 호스트마다 첫 조각의 페이싱 대상 요청 수가 늘어난다(처리량 소폭 감소 · 사이트 부하 예의 쪽) · 사이트맵 요청은 페이싱하지 않는다(기존 동작 — §25.4 RG-22③) | §6.8 · NFR-KBP2 · AC-KB2-8 | `kb-sync/crawl/kb-host-pacer.ts` · `kb-sync/engine/kb-crawl.runner.ts`(`waitForHost`·`requestHooks`) · `kb-sync/engine/kb-sync.job.ts`(`tick`) |
| I-68 | [크롤 시작 게이트 — pass 6 · RG-18 · **§25.3 B안 채택**] `claimCrawlLease()` QUEUED 분기: `findHostOverlapBlockers(run, START)` — 허용 호스트가 겹치는 **다른 소스**의 CRAWLING 실행 전부 + 나보다 먼저 만든(`createdAt`, 같으면 id) QUEUED 실행 — 가 있으면 시작하지 않는다(`null`). 전이 CAS(QUEUED → CRAWLING) 뒤 `AFTER_START` 사후 확인: 겹치는 CRAWLING 중 나보다 먼저 만들었거나 먼저 크롤을 시작한(`claimedAt`이 더 이른) 것이 있으면 QUEUED로 되돌린다(`claimToken`·`claimedAt`·`startedAt` 비움 — 아주 좁은 경합에서는 둘 다 물러났다가 다음 tick에 순서대로). 소스 행이 없거나 허용 호스트가 비면 막지 않는다. `KbSyncJob.tick()`은 후보를 max(20, 병렬 상한 × 10)개 읽고, `KbCrawlRunner.runFragment()`가 **boolean**(이 인스턴스가 크롤 임대를 쥐고 처리했는가)을 돌려주며 `false`(다른 인스턴스 보유 · 게이트 대기 · 이미 종단)는 병렬 상한에 세지 않는다. 스케줄러 사전 필터(`findActiveCrawlHosts` — 겹치는 CRAWLING이 있으면 실행 생성 자체를 미룸)는 유지. 콘솔은 기존 `QUEUED`("대기 중") 표시 — 계약 변경 0 | §6.8 결정 · K-5 · FR-KB2-5 · ADR-0044 속도 제한(판정 시점 = 크롤 시작으로 갱신) | `kb-sync/core/kb-run.store.ts`(`claimCrawlLease`·`findHostOverlapBlockers`·`findActiveRunsForCrawl`) · `kb-sync/engine/kb-crawl.runner.ts`(`runFragment`·`acquireLease`) · `kb-sync/engine/kb-sync.job.ts`(`tick`) · `kb-sync/engine/kb-scheduler.ts`(`scheduleDueSources`) |
| I-69 | [종결 경합·제출 게이트 — pass 6 · RG-19 · M-1] ① 크롤러 `finishCrawl()`: `finishCrawlAndRelease()`가 `false`(종결 CAS 실패 — 그 사이 중지·다른 인스턴스가 먼저 끝냄)면 `cancelPendingJobsOfTerminatedRun(runId)` — 실행이 **종단 상태일 때만** 그 실행의 PENDING 작업을 CANCELLED(`CANCELLED_BY_USER`) + 문서 표식 해제(QUEUED·CRAWLING·INGESTING이면 다른 인스턴스가 쓸 작업이라 건드리지 않음). ② 적재기 `trySubmitOne()`: 외부 RAG 준비 확인(상태 조회 호출)보다 **먼저** `runGate()` — INGESTING = 진행 · **종단 = 작업 CANCELLED(`CANCELLED_BY_USER`) + 문서 표식 해제(외부 호출 0)** · **QUEUED·CRAWLING = 취소도 제출도 하지 않고 대기(`WAIT`)** — 크롤 종결은 작업을 먼저 만들고(`createIngestJobsBulk` — 종결 트랜잭션 밖) 그 뒤 INGESTING으로 전이하므로 그 사이의 정상 작업을 보호한다. 슬롯을 잡은 뒤 한 번 더 같은 판정. ③ [M-1] 자동 강등(`demoteReview`)을 `finishCrawlAndRelease()` 트랜잭션 안(종결 CAS 성공 시에만)으로 옮겼다 — 이전에는 종결 전에 반영해, 그 사이 중지된 실행이 소스 승인을 해제할 수 있었다 | AC-KB5-4 · §9.9 · §8.4 | `kb-sync/engine/kb-crawl.runner.ts`(`finishCrawl`) · `kb-sync/engine/kb-ingest.runner.ts`(`trySubmitOne`·`runGate`) · `kb-sync/core/kb-run.store.ts`(`cancelPendingJobsOfTerminatedRun`·`cancelJobRunTerminated`) · `kb-sync/kb-sources.service.ts`(`finishCrawlAndRelease`·`demoteReview`) |
| I-70 | [정합성 묶음 — pass 6 · RG-20②~⑦] ② `PII_IN_RAW_FILE`로 제외해도 건수를 `observedPiiMasked`에 기록(`finalizeExcluded(…, 건수)`) · `seedFrontier()`가 재방문 행의 `observedPiiMasked`도 null로 초기화 ③ 소스 일시중지로 멈춘 실행의 PENDING 작업 `resultCode` = `CONFIG_CHANGED`(관리자 중지 = `CANCELLED_BY_USER` · `cancelRun()`) — 작업 enum에 `SOURCE_DISABLED`가 없어, 소스 비활성으로 제출을 취소하는 기존 경로와 같은 값 ④ `parseXRobotsTag()` 보수화 — 쉼표 조각마다 판정하고 `봇이름:`(알려진 지시어 이름이 아닌 것) 접두 조각만 그 봇 몫, **접두 없는 조각은 늘 우리에게 적용**. 결과: `googlebot: noindex, nofollow`(한 줄)의 `nofollow`도 우리에게 적용될 수 있다(RFC상 googlebot 전용일 수 있음 — 과적용은 덜 적재·덜 추종일 뿐인 안전한 방향으로 수용) ⑤ 삭제 감지 스윕 몫을 실행 행 `counts.sweep`에 저장(`saveSweepCounts`)하고 재종결 때 이어받아 스윕을 다시 하지 않는다 ⑥ 적재 재수집 HTML 상한 = min(`maxFileBytes`, 2MB)(공유 상수 `HTML_MAX_BYTES`) ⑦ `lib/bounded-map.ts` `setBounded()`(가장 오래된 항목부터 제거) — `leaseTokens`·`retriedDocs`·`throttleAborted`(실행 200) · `throttleStreaks`(1,000) · robots 캐시(500) · 페이서는 500 초과 시 지난 항목 정리. ①(`RAW_FILE_OFF` 중립)은 I-72④ | §8.3 · §6.5 · §9.5 · §9.9 · K-11 | `kb-sync/engine/kb-crawl.runner.ts` · `kb-sync/core/kb-run.store.ts`(`seedFrontier`·`cancelRun`·`saveSweepCounts`) · `kb-sync/lib/x-robots-tag.ts` · `kb-sync/lib/bounded-map.ts` · `kb-sync/engine/kb-ingest.runner.ts`(`submitJob`) · `kb-sync/lib/x-robots-tag.spec.ts` · `kb-sync/lib/bounded-map.spec.ts` |
| I-71 | [robots·경로 정준형 — pass 6 · M-3·M-4] robots: 4xx(429 제외) `ALLOW_ALL`도 24시간 캐시(이전에는 캐시하지 않아 문서마다 robots.txt를 다시 요청) · robots 요청도 호스트 페이서를 거침 · **429 = 호스트 중단**(`robotsFetchOutcome` — 4xx 허용에서 제외). `lib/path-canon.ts` `canonicalizePathForMatch()` — 비ASCII 문자는 UTF-8 퍼센트 인코딩으로, 이미 적힌 `%xx`는 대문자로 맞춘 정준형으로 robots 규칙·`pathPrefixes`·제외 글롭과 URL 경로를 비교(이전: `Disallow: /관리`가 무시되고 `pathPrefixes: ['/규정']`이 늘 범위 밖). robots 매칭 대상에 쿼리 포함(`/a?x=1` — RFC 9309) | §6.5 · §6.7 · FR-KB2-1 · AC-KB2-3 | `kb-sync/lib/robots.ts`(`robotsFetchOutcome`) · `kb-sync/lib/path-canon.ts` · `kb-sync/lib/scope-match.ts` · `kb-sync/engine/kb-crawl.runner.ts`(`getRobots`·`pathAndQuery`) · `kb-sync/lib/robots.spec.ts` · `kb-sync/lib/scope-match.spec.ts` |
| I-72 | [범위·링크·시작 주소 판정 — pass 6 · Low-5 · §6.7 · M-5 · M-8 · Low-1] ① **경로 접두 의미 변경**(Low-5 — 사용자 설정 해석이 바뀐다 · §25.4): 문자열 접두 → **경로 세그먼트 접두**(`pathMatchesPrefix`) — `/docs`는 `/docs`·`/docs/…`만, `/`로 끝나는 접두(`/docs/`)는 그 아래만 통과하고 `/docsecret`·`/docs-v2`·`/docs.html`은 범위 밖 ② `followLinks()`가 `detectKind()` = null(비대상 확장자·소스 `fileTypes` 밖 형식)인 링크는 행을 만들지 않고 요청하지 않는다(§6.7이 원래 요구한 동작) — 그 수는 `outOfScopeLinks`에 합산 ③ [M-5] `noindex`만 있는 페이지(메타·헤더)도 nofollow가 아니면 링크를 따라간다 ④ [M-8 · RG-20①] 시작 주소 판정 표식 3종(`markSeedFlag` — `seedReached`·`seedFailed`·`seedNeutral`) · 요청 없이 제외한 시작 주소(`RAW_FILE_OFF`)는 중립 · 종결 시 미도달 = 도달 없음 ∧ (실패 있음 ∨ 중립 없음) ⑤ [Low-1] 중단 호스트의 문서는 방문 표시만 — 상태·제외 사유·연속 수 보존(이전: ACTIVE로 덮고 제외 사유를 지움) | §6.7 · §8.3 · EX-KB-6 · AC-KB3-4 | `kb-sync/lib/path-canon.ts`(`pathMatchesPrefix`) · `kb-sync/lib/scope-match.ts` · `kb-sync/engine/kb-crawl.runner.ts`(`followLinks`·`visitOne`·`processLoop`·`readSeedState`) · `kb-sync/core/kb-run.store.ts`(`markSeedFlag`) · `kb-sync/lib/scope-match.spec.ts` |
| I-73 | [임대·동시성 — pass 6 · M-7 · Low-3 · Low-4 · Low-6] ① [M-7] 크롤 임대 만료 인수(`claimCrawlLease` CRAWLING 분기)와 적재 슬롯 선점(`claimAnySlot`)의 CAS where에 **읽은 `claimedAt`**을 더했다 — 토큰만 비교하면 읽은 뒤 보유자가 갱신(토큰 동일 · `claimedAt`만 전진)해도 낚아챘다 ② [Low-3] `KB_SYNC_LEASE_MS` 최소 60,000 → **300,000**(기본 600,000 불변 · 300,000 미만은 **기동 실패**) · 적재 재수집(최대 60초 × 홉)·해석(30초)·외부 전송(120초) 구간 앞마다 슬롯 임대 갱신(`renewSlotLease`) ③ [Low-4] `scheduleDueSources()`를 소스 단위로 예외 격리 ④ [Low-6] `discoveredSeq`는 **소스 전체** 최대값 다음부터(이전: 배치의 기존 행 최대값만 봐 신규 행이 낮은 번호를 재사용 — 너비 우선 순서 왜곡) | NFR-KBR1 · §9.2 · §9.4 · §3.5 | `kb-sync/core/kb-run.store.ts`(`claimCrawlLease`·`claimAnySlot`·`seedFrontier`) · `config/env.validation.ts`(`KB_SYNC_LEASE_MS`) · `config/env.validation.spec.ts` · `kb-sync/engine/kb-ingest.runner.ts`(`renewSlotLease`) · `kb-sync/engine/kb-scheduler.ts`(`scheduleDueSources`) |
| I-74 | [시험 — pass 6] 신규·보강: `integration/kb-crawl-pass6.integration.spec.ts` · `integration/kb-ingest-pass6.integration.spec.ts` · `kb-sync/crawl/kb-host-pacer.spec.ts` · `kb-sync/engine/kb-sync.job.budget.spec.ts` · `kb-sync/lib/bounded-map.spec.ts` · `config/env.validation.spec.ts`(임대 최소값) · **`legacy-api/transport/node-http.transport.spec.ts`(Low-8 — 실제 `NodeHttpTransport`를 로컬 HTTP 서버에 연결해 헤더 캡처·`redirectMode: 'REPORT'`를 확인 · 전송 코드 무수정 · 이전 시험은 통합 시험의 가짜 전송만 거쳤다)**. 이 그룹이 만든 spec의 픽스처·기대값 보강은 §17.3 X-n(닫힌 목록) 대상이 아니다(이 그룹 이전부터 있던 시험이 아님) | FR-0-212 | 위 각 파일 |
| I-75 | [리다이렉트 라이브락·실효 간격 상한 — pass 7 · R4 N-1] ① 요청 훅 `beforeRequest(url, hop)`: `hop > 0`이면 `waitForHost(…, force = true)` — 조각 기한을 넘겨서라도 간격을 기다린다(홉 사이 robots 조회도 강제) · 강제 대기 안전 상한 = `MAX_HOST_INTERVAL_MS + FORCED_WAIT_GRACE_MS`(300초 + 10초 — 넘으면 `DEFERRED`) · 홉 0은 종전대로 기한을 넘으면 `DEFERRED` ② 대기 중 `ctx.renewLease(10초 간격)`·요청 직전 `ctx.renewLease(2초 간격)` — 실패(중지·인수)하면 그 요청을 보내지 않는다(AC-KB5-4) · 중지 요청은 1초 슬라이스마다 확인 ③ `lib/crawl-limits.ts` `MAX_HOST_INTERVAL_MS = 300_000` — `hostIntervalMs()` = min(300초, max(소스 간격, Crawl-delay)) · robots 요청 간격도 min(소스 간격, 300초). 계약(`KB_SYNC_LIMITS.minIntervalMsFloor` 하한만)은 변경 0 — 저장값은 300초를 넘을 수 있고 실효값만 잘린다. RG-3(`CRAWL_DELAY_TOO_LONG` 호스트 중단)은 여전히 미구현이며 클램프가 임시 대체 ④ 429·503 지연 = max(정상 간격, `throttleDelayMs(…)`) | §6.4 · §6.8 · FR-KB2-5 · AC-KB2-8 · 비용 §20 K-19 | `kb-sync/engine/kb-crawl.runner.ts`(`waitForHost`·`requestHooks`·`hostIntervalMs`·`getRobots`) · `kb-sync/lib/crawl-limits.ts` |
| I-76 | [FULL_RESEND 대상 — pass 7 · N-2] `findAllActiveDocuments` → `findFullResendDocuments(sourceId, runId)` = `state = ACTIVE ∧ (lastIngestedAt ≠ null ∨ (seenRunId = 실행 ∧ observedChange ∈ {NEW, CHANGED, UNCHANGED}))`. 리다이렉트 원래 행(방문 표시만 · 적재 이력 없음)이 빠져 같은 내용이 원본·목적지 두 이름으로 중복 적재되지 않는다. 304로 확인만 한 문서는 `lastIngestedAt`으로 계속 대상 · 한계 §20 K-21 | §9.8 · R-18 | `kb-sync/core/kb-run.store.ts`(`findFullResendDocuments`) · `kb-sync/engine/kb-crawl.runner.ts`(`processLoop`) |
| I-77 | [`maxPages` 의미 — pass 7 · N-3 · 구현을 설계 §9.3에 맞춤] `seedFrontier(…, maxRows)` — 이번 실행 행 수가 상한에 닿으면 새 행을 넣지 않는다(이미 이번 실행 행인 항목은 세지 않음) · 링크 발견·`carryChildren`·리다이렉트 목적지(원본+목적지 2행)에 모두 적용 · `processLoop()`는 이미 넣은 행을 모두 방문하고, 프런티어 소진 시 `countFrontier().total ≥ maxPages`면 `maxPagesReached = true`. 이전: 방문+대기 행 수가 상한에 닿는 순간 방문을 멈춰(`maxPages` 5 · 루트 링크 4개 → 방문 1) 미리보기가 과소 표시됐다 | §9.3 · AC-KB2-5 | `kb-sync/core/kb-run.store.ts`(`seedFrontier`·`countFrontier`) · `kb-sync/engine/kb-crawl.runner.ts`(`processLoop`·`followLinks`·`carryChildren`·`adoptRedirectTarget`) |
| I-78 | [홉별 상한·타임아웃·종류 전환 — pass 7 · N-4 · N-6] ① `FollowRequest.maxBytes`·`timeoutMs` = `number ｜ (url, hop) => number` — 크롤은 홉 URL이 파일(`isFileUrl`)이면 `maxFileBytes`·타임아웃 ×4, 아니면 min(`maxFileBytes`, 2MB)·×1(이전: 크롤 파일 요청도 ×1 — 설계 §6.8·적재기와 불일치). 적재 재수집은 문서 종류(`doc.kind`) 기준 1값(RG-24③) ② 크롤: 리다이렉트 최종 응답이 문서 파일인데 `allowRawFileIngest = false` → `EXCLUDED(RAW_FILE_OFF)` · 파일 URL → HTML 리다이렉트는 HTML 상한 2MB(초과 `SIZE`) ③ 적재: 재수집 최종 URL의 `detectKind()` ≠ `doc.kind` → `SKIPPED(EXCLUDED_AT_INGEST)` ④ `lib/detect-kind.ts` 신설 — `detectKind()`를 크롤러에서 옮기고 `isFileUrl()` 추가(씨앗 넣기·크롤·적재 공유) | §6.4 · §6.8 · §9.5 · AC-KB6-2 | `kb-sync/crawl/kb-redirect-follow.ts`(`FollowRequest`) · `kb-sync/lib/detect-kind.ts` · `kb-sync/engine/kb-crawl.runner.ts`(`visitOne`) · `kb-sync/engine/kb-ingest.runner.ts`(`submitJob`) |
| I-79 | [크롤 예산 분모·후보 창 — pass 7 N-5 · pass 8 N-11] `KbSyncJob.tick()`: 실행별 기한 = 남은 크롤 예산 ÷ min(남은 병렬 자리, 남은 후보 수)(이전: 병렬 상한으로만 나눠 단독 실행이 예산 절반만 썼다) · 후보 창 = max(`KB_SYNC_LIMITS.maxSources`(50), 병렬 상한 × 10)(이전 max(20, …) — 같은 호스트 소스가 20개를 넘으면 뒤의 다른 호스트 실행이 굶었다). 호스트 겹침 그룹별 조회는 미구현(소스 상한 50이라 창이 전 활성 실행을 덮는다) | §6.8 · §9.1 · NFR-KBP2 | `kb-sync/engine/kb-sync.job.ts`(`tick`·`CRAWL_CANDIDATE_MIN`) · `kb-sync/engine/kb-sync.job.budget.spec.ts` |
| I-80 | [이어 방문 GONE 제외 — pass 7 · N-7] `findChildDocuments()`가 `state ≠ GONE`인 자식만 돌려준다 — 삭제 카운트 중인 ACTIVE 자식(`missingStreak ≥ 1`)은 계속 이어 방문해 GONE에 이른다. 부모가 200으로 링크를 다시 내면 일반 발견 경로가 GONE 행을 QUEUED로 되돌리고 200이면 ACTIVE 복귀(RG-10 규칙) | §8.3 · AC-KB3-4 | `kb-sync/core/kb-run.store.ts`(`findChildDocuments`) |
| I-81 | [적재 후보 선택 — pass 7 · N-8 · 이전 §25.4 RG-22①] `pickNextPendingJob()`이 QUEUED·CRAWLING 실행 id를 먼저 읽어 그 작업을 후보에서 뺀다(`runId notIn`) — 크롤 종결 창 또는 그 창에서 크롤 인스턴스가 죽어 남은 작업이 레인별 머리를 막아 **모든 소스의 적재가 임대 만료까지 멈추던** 문제 해소. 종단 실행의 고아 작업은 계속 골라 `runGate`가 정리한다(RG-19 불변). RG-22① 권장("INGESTING 실행만")과 다른 것은 이 종단 정리를 살리기 위한 의도된 선택 · `runGate`의 `WAIT`는 방어용 | §9.4 · §9.5 · AC-KB4-1 | `kb-sync/core/kb-run.store.ts`(`pickNextPendingJob`) · `kb-sync/engine/kb-ingest.runner.ts`(`runGate`) |
| I-82 | [부분 검사 파일 — pass 7 · N-9] `inspectRawFile(extractor, kind, bytes, { governanceOn })` → 결과 `truncated`(PDF 300쪽 초과 또는 추출 텍스트 2MB 초과로 일부만 검사). 거버넌스 ON ∧ truncated = `FILE_UNSAFE`(크롤 `EXCLUDED` · 적재 `SKIPPED(EXCLUDED_AT_INGEST)`) — 검사하지 못한 부분의 개인정보가 마스킹 없이 나가는 것을 막는다(R-17 보수 적용) · OFF는 종전대로 | §7.3 · §10 · R-17 | `kb-sync/lib/inspect-raw-file.ts` · `kb-sync/engine/kb-crawl.runner.ts`(`visitOne`) · `kb-sync/engine/kb-ingest.runner.ts`(`submitJob`) |
| I-83 | [임대 교차 검증·갱신 지점 — pass 7 N-10 · pass 8] ① `validate()` 교차 검사 `KB_SYNC_LEASE_MS ≥ KB_CRAWL_TIMEOUT_MS × 4 + 120,000` — 미만이면 기동 실패(기본 15초·600초 · 최소 300초 불변 · 타임아웃 45초 초과 설치만 영향) ② 적재 재수집 리다이렉트 홉 사이 슬롯 임대 갱신(`beforeRequest` 훅 · 홉 > 0) ③ 크롤: 호스트 간격 대기 중·요청 직전 갱신(I-75) ④ [pass 8] `ensureSeeded()`가 사이트맵 파일 요청 직전마다 `renewLease(0)` — 실패 시 프런티어를 만들지 않고 `LOST`로 물러남(다음 소유자가 처음부터) · `processLoop()`는 `renewLease` 클로저를 만든 뒤 `ensureSeeded()`를 부른다. 운영 영향 `docs/05-ops/자동배포.md` §5.7 | NFR-KBR1 · §3.5 · §9.2 | `config/env.validation.ts` · `config/env.validation.spec.ts` · `kb-sync/engine/kb-ingest.runner.ts`(`submitJob`) · `kb-sync/engine/kb-crawl.runner.ts`(`ensureSeeded`·`loadSitemapLocs`·`processLoop`) |
| I-84 | [경로 글롭 문자 단위 — pass 7 · N-13] `path-canon.ts` `splitPathUnits()`(정준형 경로를 "문자 1개" 단위로 — 한글 1자 = `%XX` 3개 · `%2F` 1단위) · `globMatchPath(pattern, path)`(양쪽 정준화 후 단위 매칭 — `glob-match.ts`의 선형 매처 재사용)를 `scope-match.ts`의 제외 글롭이 쓴다. 이전: `?`가 바이트 1개만 맞아 `/규?` 같은 패턴이 한글과 맞지 않았다. 시험 `path-canon.spec.ts` 신설 · 두 인스턴스 크롤 시작 게이트 시험을 "정확히 1개 시작"으로 강화 | §6.7 · R-13 | `kb-sync/lib/path-canon.ts` · `kb-sync/lib/glob-match.ts` · `kb-sync/lib/scope-match.ts` · `kb-sync/lib/path-canon.spec.ts` |
| I-85 | [인증 벽 가드 재작업 — pass 8 · 이전 §25.4 RG-21 · **스키마 변경**] ① `KbDocument.observedHash String?` + 마이그레이션 `20260928120000_kb_document_observed_hash`(nullable `ADD COLUMN` 1 · 백필 0 · 인덱스 0) · `seedFrontier()` 재방문 때 null 초기화 ② 기록: HTML 본문을 추출한 모든 경로(NEW·CHANGED·UNCHANGED·`NO_BODY`·`NOINDEX`) = 정규화 본문 sha256 · 리다이렉트 원래 행(방문 표시·`TYPE` 제외 포함) = `R:` + 정규화 최종 URL 해시 · 범위 밖 리다이렉트 행 = `X:` + 목적지 **호스트(포트 포함)+경로** 해시(쿼리 제외 — `REDIRECT_OUT_OF_SCOPE` 결과에 `target?: string` 추가 · 스킴 하향은 목적지가 없어 기록 없음). **권장안(호스트만)과의 편차** — 서로 다른 경로로 이사한 정상 문서를 수렴으로 오판하지 않게 ③ 판정: 종결 시 `countObservedHashDistribution()`(이번 실행 · HTML · 해시 있음 — `count` + `groupBy` 최빈 1) · 조각 지역 `hashCounts` 삭제 · `countRunObservations().visitedHtml` 제거 · `RunGuardInput.visitedHtmlCount` → `observedHtmlCount` · 임계 불변(≥ 10 ∧ ≥ 80%) ④ 적용: SYNC·FULL_RESEND = 강등(적재 작업 0 · 승인 해제 · 사유) · PREVIEW = 실행 `demotedReason = AUTH_WALL`만 기록, 소스 승인 유지(`finishCrawlAndRelease(…, { demoteReview: false })`) · NEW_RATIO는 무변경(모든 종류 강등 — §8.4 정리) ⑤ 원문 비저장 불변(해시만 — KB-10 금지어 `content` 회피) | §8.4 · EX-KB-7 · ADR-0044 §7 · 한계 §20 K-20 | `apps/api/prisma/schema.prisma`(`KbDocument`) · `apps/api/prisma/migrations/20260928120000_kb_document_observed_hash/migration.sql` · `kb-sync/lib/run-guards.ts` · `kb-sync/core/kb-run.store.ts`(`countObservedHashDistribution`·`seedFrontier`·`markVisited`) · `kb-sync/engine/kb-crawl.runner.ts`(`visitOne`·`processLoop`·`redirectConvergenceFingerprint`·`redirectTargetFingerprint`) · `kb-sync/crawl/kb-redirect-follow.ts` · `kb-sync/kb-sources.service.ts`(`finishCrawlAndRelease`) |
| I-86 | [거버넌스 실행·적재 차단 — pass 8 · **PM 결정 2026-09-28** · **계약 변경**] 저장 시점 거부(§10 · AC-KB6-2·3 · I-12·I-37)만으로는 모드를 켜기 **전에** 저장된 소스(마스킹 끔 · 서버 허용 없는 원본 파일 전달)가 모드 ON 뒤에도 비마스킹 원문을 적재했다(사용자는 처음 "저장 시점만"을 선호했다가 이 결정으로 번복). ① 순수 `lib/governance-flags.ts` — `governanceViolation(env, source)`·`governanceViolationMessage()`·`governanceViolationField()`(저장 검증 `assertGovernanceFlags()`와 같은 규칙 · 그 함수는 그대로) ② 실행 시작: `KbSourcesService.claimAndCreateRun()` 트랜잭션 맨 앞에서 저장값 판정 → `ApiException('KB_INGEST_NOT_ALLOWED', 409, 문구, [{ field, message }])` — 실행 행·선점·승인 기록 롤백 · 세 경로 공통 · **PREVIEW 포함**(설계에 없던 결정 — §25.5 U-1) ③ 스케줄러: `KbScheduler`가 소스 단위 사전 판정 → `skipScheduledRunForGovernance()`(`nextRunAt` CAS = 다음 예약 시각 · 승자만 로그 1줄 + 감사 `STATUS_CHANGE` `[예약 실행 건너뜀] …`) ④ 적재 제출 직전: `KbIngestRunner.terminateIfGovernanceBlocked()` — `runGate` 직후(외부 상태 조회 전)와 슬롯 획득·소스 재조회 직후 · `cancelRunAndRelease(…, failureCode)` 한 트랜잭션 · 러너 자신의 설정으로 판정(`governance/**` import 0 — KB-13) · 감사 없음(로그 1줄 — K-22) ⑤ 계약: `KbRunFailureCode` +`GOVERNANCE_MASK_REQUIRED`·`GOVERNANCE_RAW_FILE_NOT_ALLOWED`(`CONFIG_CHANGED` 재사용은 원인·해결을 알려 주지 못해 UIUX §7 위반) · `ApiErrorCode` 변경 0(기존 `KB_INGEST_NOT_ALLOWED` — `details[].message`는 저장 검증과 같은 이름) · 콘솔 `messages.ts` `failureCodeLabel` +2 ⑥ 기존 시험 2건(`kb-ingest-pass7` "거버넌스 ON + truncated" · `kb-ingest-rg-gaps` "RG-8: 거버넌스 ON + 개인정보 1건 이상")은 거버넌스 ON + `allowRawFileIngest = true`인데 `KB_ALLOW_RAW_FILE_INGEST`가 없던 셋업이 새 정책과 모순이라 설정에 `KB_ALLOW_RAW_FILE_INGEST: true`를 더했다(이 그룹이 만든 spec — X-n 대상 아님) | §9.2 · §9.5 · §10 · AC-KB6-2·3(범위 확장) · ADR-0040 갱신 5 · ADR-0044 §10 | `kb-sync/lib/governance-flags.ts` · `kb-sync/kb-sources.service.ts`(`claimAndCreateRun`·`governanceViolationOf`·`skipScheduledRunForGovernance`) · `kb-sync/engine/kb-scheduler.ts`(`scheduleDueSources`) · `kb-sync/engine/kb-ingest.runner.ts`(`trySubmitOne`·`terminateIfGovernanceBlocked`) · `packages/shared-types/src/kb-sync.ts`(`KbRunFailureCode`) · `apps/web/src/constants/messages.ts`(`failureCodeLabel`) |
| I-87 | [작업 결과 코드·봉인 — pass 8 · 이전 §25.4 RG-22④⑤] ④ `cancelJobResultCode(runFailureCode)` — `cancelRun()`·`cancelPendingJobsOfTerminatedRun()`·`cancelJobRunTerminated()` 세 경로가 실행 `failureCode`를 읽어 `SOURCE_DISABLED`·`GOVERNANCE_*`면 작업 `resultCode = CONFIG_CHANGED`, 그 밖(관리자 중지 등)은 `CANCELLED_BY_USER` ⑤ 봉인 KB-14b(§15) — 두 번째 이후 KB 마이그레이션 정적 검사 + 역검증 픽스처. KB-14b는 nullable `ADD COLUMN` 외에 `DEFAULT`가 있는 `NOT NULL` `ADD COLUMN`도 허용한다(SQLite가 재작성 없이 적용하는 형태 — "nullable만"보다 넓다는 사실 기록 · 필요하면 좁힌다) | §9.9 · §15 · §3.2 | `kb-sync/core/kb-run.store.ts`(`cancelJobResultCode`·`cancelRun`·`cancelPendingJobsOfTerminatedRun`·`cancelJobRunTerminated`) · `kb-sync/lib/kb-sync-sealing.spec.ts`(KB-14b) |
| I-88 | [시험 — pass 7·8] 신규: `integration/kb-crawl-pass7.integration.spec.ts` · `integration/kb-ingest-pass7.integration.spec.ts` · `integration/kb-crawl-pass8.integration.spec.ts` · `integration/kb-pass8-residual.integration.spec.ts` · `kb-sync/lib/path-canon.spec.ts` · 보강: `kb-sync/lib/kb-sync-sealing.spec.ts`(KB-14b) · `config/env.validation.spec.ts`(임대 교차 검사) · `kb-sync/engine/kb-sync.job.budget.spec.ts`(분모·후보 창) · `integration/kb-ingest-rg-gaps.integration.spec.ts`·`kb-ingest-pass7`(거버넌스 셋업 — I-86⑥). **다른 그룹 시험 1건 수정**: No.42 `integration/omnichannel-inbox.integration.spec.ts`의 간헐 실패(대화 로그 `record()` 발사 후 망각 직후 live-sessions 조회)를 `waitForSessionRef` 폴링으로 고정 — **시험 파일만 · 기대값 변경 0**이라 §17.3 X-n(기대값 변경 닫힌 목록)에 넣지 않는다(시험 안정화 — No.24·No.27 선례). 전체 스위트 부하 민감성 관찰은 §20 K-23 | FR-0-212 | 위 각 파일 |
| I-89 | [인증 벽 재정의 — pass 9 · R5 H-1] ① 지문 규칙을 순수 `lib/observed-hash.ts`로 이동(`bodyObservedHash`·`redirectOriginHash`·`outOfScopeTargetHash`·`hasLoginSignal`·`isRedirectOriginHash`·`countsTowardConvergence` — 크롤러의 `redirectConvergenceFingerprint`·`redirectTargetFingerprint` 대체) ② 빈 본문(공백뿐) = 지문 없음 · 리다이렉트 원래 행 = 목적지 로그인 신호 있으면 `RL:` 없으면 `R:`(분포 제외 — 원래 행 표식) · 범위 밖 리다이렉트 = 로그인 신호 있을 때만 `X:`(호스트+포트+경로) ③ 로그인 신호 = URL 호스트·경로만(부분 일치 7어 · 토큰 일치 13어 — `lesson`·`authors`·`casual` 비신호) — 추출기가 폼·비밀번호 입력 정보를 주지 않아 "200 로그인 폼 신호"는 미채택 ④ `countObservedHashDistribution()` → `{ visited, hashed, max }`(visited = 방문 HTML 전체 · `R:` 그룹은 hashed·max에서 제외) · `RunGuardInput.hashedHtmlCount` 신설 · 조건 `hashed ≥ 10 ∧ max ÷ visited ≥ 0.8` ⑤ NEW_RATIO는 계속 모든 종류에 적용(§8.4 pass 8 정정 그대로) · 스키마·계약 변경 0 | §8.4 · EX-KB-7 · 한계 §20 K-20 | `kb-sync/lib/observed-hash.ts` · `kb-sync/lib/observed-hash.spec.ts` · `kb-sync/lib/run-guards.ts` · `kb-sync/core/kb-run.store.ts`(`countObservedHashDistribution`) · `kb-sync/engine/kb-crawl.runner.ts`(`visitOne`·`processLoop`) |
| I-90 | [강등 → 스윕 순서 — pass 9 · L-1] 종결에서 강등 판정(`evaluateRunGuards`)을 삭제 감지 스윕보다 먼저 하고 `demotedReason`이 있으면 스윕을 건너뛴다(`AUTH_WALL`·`NEW_RATIO` 모두). 이전: 스윕 뒤 판정이라 강등된(신뢰할 수 없는) 크롤이 적재 문서의 `missingStreak`·요약 `missing`/`gone`을 올렸다. 판정 입력은 `seenRunId = 실행` 행 · 스윕은 `≠ 실행` 행이라 판정값 불변 | §8.3 · §8.4 · §9.3 · AC-KB3-4 | `kb-sync/engine/kb-crawl.runner.ts`(`processLoop` 종결부) |
| I-91 | [FULL_RESEND 대상 좁힘 · 적재 범위 방어 — pass 9 · M-3·L-4] ① `findFullResendDocuments()` = `ACTIVE ∧ seenRunId = 실행 ∧ (lastIngestedAt ≠ null ∨ observedChange ∈ {NEW, CHANGED, UNCHANGED})` 뒤 `isRedirectOriginHash(observedHash)` 행 제외(I-76의 `lastIngestedAt` 갈래에 `seenRunId` 조건이 없어 범위 축소로 이번에 발견되지 않은 옛 적재 문서를 다시 보냈다) ② `KbIngestRunner.submitJob()`이 재수집 전에 `normalizeUrl` + `isInScope(url, 0, 현재 소스 범위)` — 밖이면 요청 0·제출 0으로 `SKIPPED(EXCLUDED_AT_INGEST)`(§9.5 2단계 "범위 밖 = SKIPPED"의 실제 구현) ③ 리다이렉트 원래 지문은 `seedFrontier()`가 실행마다 null로 비워 다음 실행에서 200으로 복귀한 행은 다시 대상 | §9.5 · §9.8 · R-18 · 한계 §20 K-21 | `kb-sync/core/kb-run.store.ts`(`findFullResendDocuments`) · `kb-sync/engine/kb-ingest.runner.ts`(`submitJob`) |
| I-92 | [리다이렉트 재개 — pass 9 · M-4 · L-3 · pass 7 N-1 강제 대기 대체] ① 강제 대기 제거(`waitForHost(…, force)`·`FORCED_WAIT_GRACE_MS` 삭제) — 모든 요청은 `now + wait > ctx.deadline`이면 `DEFERRED` ② `FollowRequest.resume`·`FollowResult.DEFERRED.resume`(`FollowResume = { url, hop, visited }`) — 홉 ≥ 1에서 미루면 진행 상태 반환, 넘기면 그 홉부터(순환 검사·최대 3회 규칙 이어짐) ③ 크롤러 인스턴스 메모리 `redirectResume`(키 `실행 id｜문서 id` · `setBounded` 상한 200 `MAX_TRACKED_RESUMES` · `REDIRECT_RESUME_TTL_MS` 30분 · `startUrl`·`savedAt`) — `takeResume()`이 시작 URL·유효 시간 확인 · 응답을 받으면 삭제 · `acquireLease()`의 임대 상실·새 획득과 `forgetRun()`에서 그 실행 상태 폐기(`dropResumeStates`) ④ 요청 직전 임대 갱신은 항상(`LEASE_RENEW_BEFORE_REQUEST_GAP_MS` 제거 — 중지 직후 최대 2초 요청 창 제거) · 대기 중 갱신 간격 10초(`LEASE_RENEW_WAIT_GAP_MS`)는 유지 ⑤ 효과: 실효 간격 최대 300초에서도 문서 1건이 tick 예산을 넘겨 점유하지 않고 라이브락 없음 — K-19 해소 · 스키마·계약 변경 0 · 한계 K-24 | §6.4 · §6.8 · §9.3 · AC-KB5-4 · NFR-KBP2 | `kb-sync/crawl/kb-redirect-follow.ts` · `kb-sync/crawl/kb-redirect-follow.spec.ts` · `kb-sync/engine/kb-crawl.runner.ts`(`waitForHost`·`requestHooks`·`takeResume`·`visitOne`·`acquireLease`·`forgetRun`) |
| I-93 | [제목 마스킹·절단 — pass 10 · 이전 §25.5 RG-25] `runExtractJob()` HTML 분기 `sanitizeTitle(title, piiMask, mode)` — 마스킹 **먼저**(본문과 같은 `maskText`), 그 뒤 코드 포인트 기준 200자 절단(`Array.from` — 서로게이트 쌍 보존 · 먼저 자르면 경계의 전화번호 조각이 원문으로 남는다) · 제목 마스킹 건수를 `piiMaskedCount`에 합산 · `piiMask = false`(거버넌스 OFF에서만 가능)면 절단만. 한 곳 수정으로 저장(`KbDocument.title` — 크롤 `markVisited`)과 전송(적재 머리 줄 `제목:`·HTML `<title>` — `buildIngestDocument`)이 같은 값 · 문서 목록 API는 저장값(마스킹됨) 그대로 · 파일 형식은 제목 경로 없음 · 지문(`ingestFingerprint`)은 본문 기준이라 불변(이미 적재된 문서의 제목 교정은 다음 CHANGED 또는 FULL_RESEND) · 시험 공백: 적재 형식이 DOCX일 때 머리 줄을 압축 해제해 확인하는 시험 없음(같은 `buildIngestDocument` 경유) · 남은 한계 `출처:` URL 비마스킹(K-25) | §3.1 · §10 · AC-KB6-1 · ADR-0040 갱신 4 | `kb-sync/lib/run-extract-job.ts` · `kb-sync/lib/run-extract-job.title.spec.ts` · `integration/kb-crawl-pass10.integration.spec.ts` |
| I-94 | [승인 SYNC 새로 비율 면제 — pass 10 · 이전 §25.5 RG-23] ① `RunGuardInput.approvedByUser?`(선택 · 생략 = false) — `true`면 NEW_RATIO만 면제, AUTH_WALL은 면제 없음 ② 크롤 종결이 이미 읽은 실행 행으로 `approvedByUser = run.kind === 'SYNC' ∧ finishRow.trigger === 'APPROVAL'`(기존 `KbSyncRun.trigger` 열 — `approveIngest`만 `APPROVAL`로 만든다) · `runFragment` 시그니처·계약·스키마 변경 0 — §25.5 권장안("`runFragment`에 `trigger` 전달")과 **방식만 다름** ③ `countPreviouslyIngested()` = `state = ACTIVE ∧ lastIngestedAt ≠ null`(§8.4 문언) ④ "첫 적재"(대량 레인) 판정은 `hasEverIngested()`(상태 무관 적재 이력)로 분리 — 분모를 ACTIVE로 좁혀도 문서가 전부 GONE인 소스를 첫 적재로 오판하지 않게 · 잔여 K-26 | §8.4 · §9.8 · EX-KB-5 · K-14 | `kb-sync/lib/run-guards.ts` · `kb-sync/core/kb-run.store.ts`(`countPreviouslyIngested`·`hasEverIngested`) · `kb-sync/engine/kb-crawl.runner.ts`(종결부) · `kb-sync/kb-runs.service.ts`(`approveIngest` — 기존) |
| I-95 | [적재 차단 감사 — pass 10 · U-3 채택] `KbSourcesService.terminateRunForGovernance(sourceId, runId, now, violation)` — `cancelRunAndRelease(…, violation)` 성공(CAS 승자)일 때만 감사 `STATUS_CHANGE`(`targetType = KbSource` · `summary = [적재 차단] ${governanceViolationMessage(violation)}`) 1건(고정 문구 · URL·본문·비밀 0) · 이미 종단이면 `false`(감사 없음). `KbIngestRunner.terminateIfGovernanceBlocked()`는 이 메서드를 부르고 로그 1줄만 — 러너에 `AuditLogService`를 주입하는 §25.5 U-3 대안과 다른 점(`KbSource` 쓰기 유일 파일에 모아 봉인 KB-9·KB-13·KB-15와 정합 · 예약 건너뜀 `skipScheduledRunForGovernance`와 같은 모양) · 계약 변경 0 | §9.5 · §10 · §13 · K-22 | `kb-sync/kb-sources.service.ts`(`terminateRunForGovernance`) · `kb-sync/engine/kb-ingest.runner.ts`(`terminateIfGovernanceBlocked`) |
| I-96 | [리다이렉트 잔여 ①③ — pass 10 · 이전 §25.5 RG-24①③] ① `url-normalize.ts` `urlHostPort()`(= `URL.host` 소문자 — 스킴 기본 포트 제외 · 해석 불가 = 빈 문자열)·`isSameHostPort(start, hop)`(빈 값끼리는 다름) — 크롤·적재의 `headersFor`가 홉 ≥ 1에서 이 판정일 때만 인증 헤더(`http→https` 상향·`:443` 명시 = 유지 · `:8443` 등 = 미전송 · 요청은 나감) ② 적재 재수집 `timeoutMs = (url) => KB_CRAWL_TIMEOUT_MS × (isFileUrl(url) ? 4 : 1)`(크롤과 같은 규칙 · `maxBytes`는 `doc.kind` 기준 1값 유지) ③ **미포함**: 홉 0(링크로 발견한 같은 호스트 다른 포트 URL)의 헤더 판정(`applyAuthHeader`·`applyAuth` — `allowedHosts.includes(urlHostname(url))`)과 범위·fetcher 허용 호스트 검사는 여전히 호스트 이름만 — §25.6 RG-26 · RG-24②(원래 URL 검증자) 미해소 | §6.4 · §6.9 · FR-KB1-5 | `kb-sync/lib/url-normalize.ts` · `kb-sync/engine/kb-crawl.runner.ts`(`visitOne`) · `kb-sync/engine/kb-ingest.runner.ts`(`submitJob`) |
| I-97 | [콘솔 — pass 9·10 · 오케스트레이터 직접 수정] ① `messages.ts` `failureCodeLabel.GOVERNANCE_RAW_FILE_NOT_ALLOWED`에 "꼭 필요하다면 서버 운영자에게 허용을 요청해 주세요." 추가(서버 409 문구와 정합 · 환경변수 이름 비노출 — §25.5 문서 정합 ⑤ 해소) ② `KbSourceOverviewPage.tsx` `resolveApproveErrorText()` — 승인 409 `details[0].message`를 `approveButtonDisabledReason` → `failureCodeLabel` → 서버 `e.message` → 일반 오류 문구 순으로 해석(`hasOwnProperty` 조회) · 미리보기 카드에 `latestPreviewRun.demotedReason` 경고(`role="status"` · 소스 배너와 같은 사유면 생략) ③ `KbStringListField` — 여러 목록 필드가 같은 입력 id(`k0-input`)를 쓰던 접근성 결함을 `useId()` 접두로 수정 · 도움말 `aria-describedby` 연결(사이트맵 도움말 포함). 거버넌스 규칙 위반 버튼 사전 비활성·실행 이력 PREVIEW 강등 구분 문구는 아직 frontend 후속(화면 설계서 §14) | 화면 설계서 §3.2 · §3.3 · §14 · UIUX §2·§7 | `apps/web/src/constants/messages.ts` · `apps/web/src/pages/settings/kb-crawling/KbSourceOverviewPage.tsx` · `apps/web/src/pages/settings/kb-crawling/KbStringListField.tsx` |
| I-98 | [시험 — pass 9·10] 신규: `integration/kb-crawl-pass9.integration.spec.ts`(H-1 6 · M-3 7 · L-1 2 · M-4 6 · L-3 2) · `integration/kb-crawl-pass10.integration.spec.ts`(RG-25 · RG-23 · U-3 · RG-24①③) · `kb-sync/lib/observed-hash.spec.ts` · `kb-sync/crawl/kb-redirect-follow.spec.ts` · `kb-sync/lib/run-extract-job.title.spec.ts` · `kb-sync/lib/detect-kind.spec.ts`(37건 · L-7). 조정: `kb-crawl-pass7.integration.spec.ts` N-10 시험의 조각 수 12 → 40(강제 대기 제거로 조각마다 한 홉씩 진행 — 검증 의도 "대기 중 임대 갱신 간격 ≤ 12초"는 유지 · 기대값이 아닌 반복 횟수라 §17.3 X-n 대상 아님). 전체: api 343 suites / 5,005 passed / 1 skipped · 웹 198 파일 / 1,041 tests. 부하 시 간헐 실패(무관·미변경 spec) = §20 K-23 | FR-0-212 | 위 각 파일 |
| I-99 | [새로 비율 분모 고정 — pass 11 · R6 M-A] `KbRunStore.fixPriorActiveIngested(sourceId, runId)` — 실행 행 `counts` JSON에 `priorActiveIngested`가 있으면 그 값, 없으면 `countPreviouslyIngested()`(ACTIVE ∧ 적재됨)로 세어 실행이 `CRAWLING`일 때만 기록하고 돌려준다(기록 못 하면 센 값 그대로) · `processLoop()`가 조각 시작마다 호출하고 종결 판정이 그 값을 쓴다. 이전: 조각마다 다시 세어 앞 조각에서 이 실행이 EXCLUDED·GONE으로 바꾼 문서만큼 분모가 줄고 가드가 꺼졌다. 새 컬럼·마이그레이션 0 · 종결 때 계약 키만 다시 써 값이 남지 않음 · 응답(`parseCrawlCounts`) 비노출 · `hasEverIngested` 무관 · K-26 해소 | §8.4 · EX-KB-5 · AC-KB5-8 · K-26 | `kb-sync/core/kb-run.store.ts`(`fixPriorActiveIngested`·`countPreviouslyIngested`) · `kb-sync/engine/kb-crawl.runner.ts`(`processLoop`) |
| I-100 | [인증 벽 목적지 행 `RD:` · `RL:` 쿼리 제거 — pass 11 · R6 M-B] ① `redirectOriginHash()`의 로그인 목적지 = `RL:` + `urlHash(host+path)`(쿼리 제거 — `X:`와 통일) ② `REDIRECT_TARGET_PREFIX = 'RD:'` · `redirectLoginTargetHash(finalUrl)` — `visitOne()`이 로그인 신호 목적지로 리다이렉트를 따라 기록하는 목적지 행에 본문 해시 대신 남긴다 ③ `countsTowardConvergence()` = `R:`·`RD:` 제외 · `isRedirectTargetHash()` ④ `countObservedHashDistribution()`의 `visited` = `kind = HTML ∧ visitState = VISITED` 행 수 − `RD:` 행 수(`NOT LIKE`의 NULL 탈락을 피한 빼기) ⑤ 리뷰어 권고 두 안 불채택(§8.4 pass 11 ④ — 작은 사이트 오탐 · 로그인 폼 본문의 return 값) ⑥ `schema.prisma` `KbDocument.observedHash` 주석 갱신(구조 변경 0 · `prisma migrate diff` 무차이) | §8.4 · EX-KB-7 · AC-KB5-7 · K-20 | `kb-sync/lib/observed-hash.ts` · `kb-sync/core/kb-run.store.ts`(`countObservedHashDistribution`) · `kb-sync/engine/kb-crawl.runner.ts`(`visitOne`) · `apps/api/prisma/schema.prisma`(주석) |
| I-101 | [로그인 신호 개정 — pass 11 · R6 L-A] `hasLoginSignal()`: 호스트(`.`로 나눈 라벨)·경로(`/`로 나눈 조각)마다 영숫자 아닌 문자로 단어를 나눠 토큰 13어를 찾고, 단어가 1개인 조각이거나 문서 단어 사전(`DOC_WORDS` 약 60개 · `help`·`support` 제외)에 든 단어가 없을 때만 신호 · 정규식 `/signin(?!g)/`·`/(?<![a-z])(?:sign\|log)[-_]in/` · 부분 일치 7개(`login`·`logon`·`로그인`·`로그온`·`j_spring_security_check`·`j_security_check`·`j_acegi_security_check`) · `safeDecode()` 예외 시 원문. 리뷰어 문언("`signin` 뒤 영문자 제외")은 `/signinForm` 미탐으로 불채택 · 잔여 K-20 | §8.4 · K-20 | `kb-sync/lib/observed-hash.ts`(`hasLoginSignal`) · `kb-sync/lib/observed-hash.spec.ts` |
| I-102 | [강등 뒤 승인 조건 — pass 11 · R6 L-B] `approveIngest()`: 소스 `reviewRequiredReason` ∧ 미리보기 `finishedAt` < `KbRunStore.findLatestDemotionFinishedAt(sourceId)`(`demotedReason ≠ null ∧ finishedAt ≠ null ∧ (kind ≠ PREVIEW ∨ demotedReason = NEW_RATIO)` 중 최신)이면 `409 KB_INGEST_NOT_ALLOWED`(`details: [{ field: 'previewRunId', message: 'PREVIEW_STALE' }]` · 문구 "…적재가 보류된 뒤에 확인한 미리보기가 아닙니다. 미리보기를 다시 실행해…") — 기존 코드 재사용 · 새 오류 코드 0 · 동시각(그 미리보기 자신이 강등)은 통과 · `lastRunFinishedAt` 불채택(강등 뒤 새 미리보기가 마지막 실행이 되어 정상 흐름이 막힘). 서버 문구가 "내용이 크게 바뀌어"로 시작해 인증 벽 강등에는 원인이 맞지 않는다(~~콘솔은 이 문구를 쓰지 않음 — RG-27~~ **웹 RG-27 해소(I-108) 뒤 콘솔은 409 `PREVIEW_STALE`에서 이 서버 문구를 그대로 보인다** — 인증 벽 강등 문구 불일치는 §20 K-29) | §8.4 · §9.8 · EX-KB-5 · AC-KB5-8 · 화면 설계서 §3.3.1 · RG-27 | `kb-sync/kb-runs.service.ts`(`approveIngest`) · `kb-sync/core/kb-run.store.ts`(`findLatestDemotionFinishedAt`) |
| I-103 | [재개 홉 범위 재검사 · 시험 주석 — pass 11 · R6 L-C·L-E] ① `fetchFollowingRedirects()`가 `req.resume`이 있으면 요청 전에 `normalizeUrl` + `isInScope(…, 0, opts.scope)` — 밖이면 `REDIRECT_OUT_OF_SCOPE`(`SCOPE` · `target` = 재개 URL) · 러너가 재개 상태 폐기 · `X:` 지문 규칙 그대로 ② `detect-kind.spec.ts`의 "Content-Type 인자는 아직 판정에 쓰지 않는다" 시험은 RG-11 미구현 갭의 현재 상태를 고정하는 것이라는 주석 | §6.4 · AC-KB2-4 · RG-11 | `kb-sync/crawl/kb-redirect-follow.ts` · `kb-sync/lib/detect-kind.spec.ts` |
| I-104 | [허용 출처 host:port — pass 12 · RG-26 해소 · U-5 (b) PM 기본안] ① 새 순수 파일 `lib/allowed-origins.ts` — `computeAllowedOrigins(seedUrls, sitemapUrls)`(`urlHostPort` 집합 · 사이트맵 `<loc>`은 넓히지 못함) · `isAllowedOrigin` · `canSendAuthTo(allowedOrigins, url, startUrl?)`(첫 요청 = 허용 출처 일치 · 홉 = + `isSameHostPort(startUrl, hop)` — **[pass 13] 시그니처 `(origins: AuthOrigins, url, startUrl?)`로 변경 · 평문 `http:` 조건 추가 — I-107**) ② `parseSourceRow()`가 `allowedOrigins`를 실행 시점에 계산(저장 0 · `configVersion` 변경 시 다음 tick부터) · `ScopeConfig`·`KbFetchRequest`·`FollowRequest`에 **필수** 필드 ③ `isInScope`·fetcher 허용 호스트 단계(`HOST_NOT_ALLOWED`)·적재 `submitJob` 범위 방어·크롤 `applyAuthHeader`·적재 `applyAuth`가 모두 사용 ④ **설계에 없던 추가 수정**: robots.txt를 출처(스킴+host:port) 단위로 — `getRobots(pageUrl, …)`·`robotsKey(scheme, hostPort)`·`hostIntervalMs(url, …)` · robots 요청 범위 = 그 출처 1개 · 자격증명 없음(이전: 비기본 포트 시작 주소의 robots가 기본 포트로 나가 허용 출처 밖 → `ABORT_HOST`) ⑤ 페이서·`abortedHosts`·429/503 연속 횟수는 호스트 이름 단위 유지(보수적) ⑥ `allowedHosts` 저장 형식·`deriveAllowedHosts`·호스트 겹침 판정·데이터 지도 불변 · 스키마·계약·마이그레이션 0 ⑦ 잔여: ~~출처가 스킴을 보지 않아 `http://` 링크 첫 요청에 헤더(RG-28)~~(pass 13 해소 — I-107) · 두 스킴 중복(K-28) | §3.1 · §6.2 · §6.4 · §6.5 · §6.8 · §6.9 · §9.5 · FR-KB1-2·5 · AC-KB2-9 | `kb-sync/lib/allowed-origins.ts`(+spec) · `kb-sync/lib/parse-source-row.ts` · `kb-sync/lib/scope-match.ts` · `kb-sync/crawl/kb-crawl-http.fetcher.ts` · `kb-sync/crawl/kb-redirect-follow.ts` · `kb-sync/engine/kb-crawl.runner.ts`(`applyAuthHeader`·`getRobots`·`robotsKey`·`hostIntervalMs`·사이트맵 조회) · `kb-sync/engine/kb-ingest.runner.ts`(`applyAuth`·`submitJob`) |
| I-105 | [콘솔 — 웹 후속] ① `governanceBlock.tsx` `clientGovernanceViolation(meta, source)` — 서버 `governanceViolation()`과 같은 규칙·순서(거버넌스 ON ∧ `piiMask === false` → `GOVERNANCE_MASK_REQUIRED` · 아니면 `allowRawFileIngest === true` ∧ `rawFileIngestAllowedByServer === false` → `GOVERNANCE_RAW_FILE_NOT_ALLOWED` · 메타 없음 등 모르면 `null` = 활성 유지 + 서버 409 배너 폴백) · `KbGovernanceBlockedHint`(⚠ `aria-hidden` + `failureCodeLabel.GOVERNANCE_*` 보이는 텍스트) ② 적용: 소스 목록 행 케밥 "지금 실행"(`KebabMenuItem.describedBy?` 선택 필드 신설) · 개요 "지금 미리보기 실행"·"적재 시작"(기존 사유와 함께면 두 id를 `aria-describedby`에) · 문서 목록 "전체 다시 적재"(`useOutletContext`에서 `meta`) — 모두 `disabled`(기존 "적재 시작" 비활성 방식과 일관 · 비활성 버튼은 Tab 포커스를 받지 않으므로 사유는 항상 보이는 텍스트) · 쓰기 권한 없으면 사유 없음 · 이미 승인되어 개요에 실행 버튼이 없으면 사유도 없음(명세에 없는 새 상태를 만들지 않음) ③ `KbRunTable` `demotedText()` — `kind = PREVIEW ∧ demotedReason = AUTH_WALL`이면 `MESSAGES.kbRuns.previewWarningReasonLabel.AUTH_WALL`("미리보기 경고 — 로그인 필요로 보임(승인은 유지됩니다)") · 그 밖은 기존 강등 문구 · 화면 설계서 §14 pass 9·10 행의 frontend 후속 2건 해소 · 계약 변경 0(메타 필드는 기존) | 화면 설계서 §3.1·§3.3·§3.3.1·§3.4.1·§3.5·§14 · UIUX §2·§4·§7 | `apps/web/src/pages/settings/kb-crawling/governanceBlock.tsx` · `KbSourcesPage.tsx` · `KbSourceOverviewPage.tsx` · `KbDocumentListPage.tsx` · `KbRunTable.tsx` · `apps/web/src/components/KebabMenu.tsx` · `apps/web/src/constants/messages.ts` |
| I-106 | [시험 — pass 11·12] 신규: `integration/kb-crawl-pass11.integration.spec.ts`(M-A 다중 tick 분모 · L-B 강등 뒤 승인 · M-B 재현표) · `integration/kb-crawl-pass12.integration.spec.ts`((a) 링크 다른 포트 범위 밖 · (b) 시작 주소 명시 포트 범위 안 + 헤더 · (c) 헤더 있는 소스의 다른 포트 요청 0 · (d) 사이트맵 명시 포트 허용 · (e) `:443` 명시·생략 같은 출처 · (f) 적재 단계 다른 포트 `SKIPPED` · AC-KB6-1 DOCX 머리 줄 `제목:` 마스킹(크롤→적재 끝까지 · 기본 DOCX · `fflate`로 `word/document.xml`을 풀어 원문 0 · 대조 `piiMask = false`는 원문) · 설정 변경 시 허용 출처 재계산) · `kb-sync/lib/allowed-origins.spec.ts` · `observed-hash.spec.ts` 보강. 조정: pass 10 RG-24① 시험 입력 — 시작 주소에 8443 명시(새 규칙상 시작 주소 없는 8443 리다이렉트는 범위 밖이라 요청 자체가 없음 · 본래 단언 "홉에는 헤더 없음" 유지 · 이 그룹이 만든 spec이라 §17.3 X-n 대상 아님). DOCX 시험 = 구현 결함 없음 · §25.6 "커밋 전 권장(시험)" 해소. 전체(pass 12 시점): api 346 suites / 5,096 passed / 1 skipped · 웹 198 파일 / 1,062 tests · `tsc` 오류 0 — **최종 수치는 I-108** | FR-0-212 · AC-KB6-1 · AC-KB2-9 | 위 각 파일 |
| I-107 | [인증 헤더 평문 조건 — pass 13 · RG-28 해소] ① `lib/allowed-origins.ts` `computePlainHttpOrigins(seedUrls, sitemapUrls)` 신설 — 시작 주소·소스에 등록한 사이트맵 URL 중 `http:`로 등록된 URL의 host:port 집합(저장 안 함 · `parseSourceRow()`가 실행 시점마다 계산 → `ParsedSourceConfig.plainHttpOrigins` · 크롤 `SourceConfig`에도 필수 필드) ② `canSendAuthTo` 시그니처 `(allowedOrigins, url, startUrl?)` → `(origins: AuthOrigins, url, startUrl?)` — `AuthOrigins = { allowedOrigins, plainHttpOrigins }` 두 필드 **필수**(빠뜨리면 컴파일 오류 — 헤더가 나가는 쪽으로 조용히 실패하지 않게) ③ 판정 3단계: 허용 출처 아님 → 거부 · 홉(≥ 1)이면 `isSameHostPort` · 요청이 `http:`면 그 host:port ∈ `plainHttpOrigins`(홉에서 시작 URL `https:` → 요청 `http:` 하향은 평문 출처가 명시돼도 무조건 거부 — 설계에 없던 이중 방어 · §6.4가 하향 리다이렉트를 이미 거부하므로 동작 변화 0) · `https:` 요청은 종전 그대로(`http→https` 상향 유지) ④ 정책: 사이트맵 파일 안 `<loc>`·페이지 링크의 `http:` URL은 명시로 치지 않음 · 명시는 그 host:port 한정 · `https:`만 명시한 출처의 `http:` URL은 범위 안(수집 가능)이나 헤더 없음 ⑤ 범위 판정 `isAllowedOrigin`·`isInScope`·`computeAllowedOrigins`(반환 `string[]` · 스킴 무관) 불변 ⑥ 헤더를 붙이는 곳은 크롤 `applyAuthHeader`·적재 `applyAuth`(각각 첫 요청·홉)의 `KbSecretResolver.get` 두 곳뿐이며 둘 다 `canSendAuthTo`만 거친다(크롤 시작 때 비밀 존재 확인 `get`은 헤더를 만들지 않음) · robots·사이트맵 요청은 `headersFor: () => ({})` ⑦ §25.7 권장안("호출부 무변경")과 달리 시그니처를 바꿔 호출부 2곳이 함께 바뀌었다 — 필수 필드로 누락을 컴파일 시점에 막는 편이 낫다(수용) ⑧ 스키마·계약·마이그레이션·환경변수 0 ⑨ 시험: 신규 `integration/kb-crawl-pass13.integration.spec.ts` 10건(★ 9 + 대조 1 · 크롤·적재 양쪽 — (a) https 시작 + `http://a/x` 헤더 없음 · 대조 https 헤더 있음 (b) 사이트맵 URL이 `http://a/…`를 명시하면 그 http 문서·링크 헤더 있음 · 사이트맵 파일·robots 요청에는 없음 (c) http 시작 주소 소스의 http 요청 헤더 있음 (d) `http→https` 상향 링크·리다이렉트 홉 헤더 있음 (e) `https://a:443` 명시 → 포트 없는 https 링크 헤더 있음 · 같은 호스트 http는 없음) · `kb-sync/lib/allowed-origins.spec.ts` +9건(`computePlainHttpOrigins` · 평문 조건 · host:port 한정 · 홉 하향 이중 방어 · 기본 포트 표기) · 되돌림 검증(http 조건만 무력화하면 신규 ★ 7건 실패) · §25.7 RG-28 시험 ①②③ 고정 | §6.2 · §6.4 · §6.9 · FR-KB1-5 · AC-KB2-9 · RG-28 · K-28 | `kb-sync/lib/allowed-origins.ts`(+spec) · `kb-sync/lib/parse-source-row.ts` · `kb-sync/engine/kb-crawl.runner.ts`(`SourceConfig`·`applyAuthHeader`) · `kb-sync/engine/kb-ingest.runner.ts`(`applyAuth`) · `integration/kb-crawl-pass13.integration.spec.ts` |
| I-108 | [콘솔 강등 뒤 승인 — 웹 · RG-27 해소] ① (a) 409 `PREVIEW_STALE` 문구: `resolveApproveErrorText`는 코드가 `PREVIEW_STALE`이고 서버 `e.message`가 비지 않았으며 원인 없는 기본 문구("유효한 미리보기 실행이 아닙니다." — 웹 상수 `MESSAGES.kbRuns.approveGenericInvalidPreviewServerMessage`와 비교)가 아니면 서버 문구를 그대로 표시 · 기본·빈 문구면 종전 `approveButtonDisabledReason.PREVIEW_STALE`("설정이 바뀌어…") · 다른 코드의 조회 순서(게이트 표 → `failureCodeLabel` → 서버 문구 → 일반 문구) 불변. 서버 코드가 두 원인(설정 변경 / 강등 뒤 미리보기 없음)에 공통이라 계약 변경 없이 문구로 구분한다 — 서버 기본 문구를 웹 상수로 복제한 결합이 생긴다(서버 기본 문구가 바뀌면 설정 변경 409에도 서버 문구가 그대로 보인다 — 그 문구도 서버가 쓴 안내라 안전한 방향) ② (b) 사전 비활성: 새 순수 함수 `previewAfterDemotion.ts` `isPreviewOlderThanDemotion(source, runs, previewRun)` — 서버 `approveIngest`·`findLatestDemotionFinishedAt`과 같은 규칙(`reviewRequiredReason`이 있어야 검사 · SYNC·FULL_RESEND의 모든 강등 + PREVIEW의 `NEW_RATIO` 강등만 셈 · PREVIEW `AUTH_WALL` 제외 · 미리보기 `finishedAt` < 강등 종료 시각일 때만 참 · 같으면 통과)을 실행 이력 첫 페이지(`listRuns(id, 1, 20)` — `KbRunView`의 `kind`·`demotedReason`·`finishedAt`)로 계산. 소스 계약(`KbSourceResponse`)에 강등 시각 필드가 없어, 창 안에서 찾은 가장 늦은 강등 종료 시각(= 서버 값의 하한)보다 먼저 끝난 미리보기일 때만 비활성으로 확정 · 창 안에 강등 실행 없음·강등 실행이나 미리보기의 `finishedAt` null·`reviewRequiredReason` 없음은 "모름" = 활성 유지(서버 409 + ①의 서버 문구로 폴백) ③ 개요 `disabledReason`에 웹 로컬 키 `PREVIEW_AFTER_DEMOTION_REQUIRED`(계약 enum 아님) — 우선순위 전송 전제 → RAG 미설정 → 미리보기 없음 → `previewStale`(설정 변경) → 강등 뒤 미리보기 없음 · 사유 = ⚠(`aria-hidden`) + 보이는 텍스트 + `aria-describedby`(거버넌스 사유와 함께면 두 id) ④ 문구 `approveDisabledAfterDemotion` = "내용이 크게 바뀌어 적재가 보류되었습니다. 그 뒤에 확인한 미리보기가 없으니 미리보기를 다시 실행해 결과를 확인한 뒤 적재를 시작하세요."(화면 설계서 §3.3.1 권장 문구 "적재가 보류된 뒤 새 미리보기가 필요합니다…"를 원인·해결 방법으로 구체화 · 인증 벽 강등에 맞지 않는 점은 서버 문구와 같은 한계 — §20 K-29) ⑤ §25.7 권장안과의 차이: 409 수신 때 `reviewRequiredReason` 여부로 문구를 고르는 대신 서버 문구를 우선했다(원인은 서버가 가장 정확히 안다 · 소스 재조회 전 상태에 의존하지 않음 — 수용) ⑥ 계약 변경 0 ⑦ 시험: `KbSourceOverviewPage.spec.tsx` 24 → 34건(신규 · 기존 `PREVIEW_STALE` 시험은 서버 기본 문구 입력으로 수정 — 이 그룹이 만든 spec이라 §17.3 X-n 대상 아님) · 되돌림 검증은 (a)·(b) · `previewAfterDemotion.ts` 단독 spec 없음(페이지 spec으로 검증) ⑧ **최종 전체(pass 13·웹 RG-27 후)**: api 347 suites / 5,116 passed / 1 skipped · 웹 198 파일 / 1,073 tests · `tsc` 오류 0 | 화면 설계서 §3.3·§3.3.1·§14 · UIUX §2·§7 · AC-KB7-2 · EX-KB-5 · AC-KB5-8 · RG-27 · I-102 · K-29 | `apps/web/src/pages/settings/kb-crawling/KbSourceOverviewPage.tsx`(+spec) · `previewAfterDemotion.ts` · `apps/web/src/constants/messages.ts` |

### 25.1 알려진 잔여 갭(RG-n) — 미구현 · 후속 처리 방침 (2026-09-28 · system-architect)

백엔드 pass 4 코드를 이 설계와 대조해 찾은 **미구현** 항목이다. **[갱신 — pass 5(2026-09-28)] RG-1·RG-4~RG-10·RG-12·RG-15는 해소됐고 RG-11은 일부 해소됐다(§25 I-49~I-58). 이 절의 목록·표는 pass 4 시점 기록으로 남기며, 현재 상태와 신규 갭(RG-16~RG-20)은 §25.2가 기준이다.** "AC 판정"은 요구사항 AC-KB1~KB7에 직접 걸리는지이며, **걸리는 항목은 커밋 전 구현 재작업 대상**이다. 걸리지 않는 항목도 설계 결정과 다르므로, 후속 처리 전까지는 이 표가 본문보다 우선하는 사실 기록이다(본문의 해당 위치에 "[미구현 — RG-n]" 표시).

- **[pass 4 시점 — 아래 3줄의 항목은 RG-2·3·13·14와 RG-11 일부를 빼고 pass 5에서 처리됨 · 현재 목록은 §25.2]** **AC에 걸려 커밋 전 재작업이 필요한 항목**: RG-1①(AC-KB3-4) · RG-6(AC-KB3-5) · RG-7(AC-KB6-2 · AC-KB7-2) · RG-15(AC-KB5-4).
- **AC 밖이지만 재작업을 강력 권장**: RG-5(NFR-KBR2 — 자동 복구 수단 없음) · RG-8(§7.3 · ADR-0044 §10 — 문서 파일 사전 검사 미집행) · RG-9(NFR-KBR1 — 크롤 임대 상호 배제 결함 · RG-15와 같은 수정).
- **1차 권장(작은 수정)**: RG-4 · RG-10 · RG-11(2MB·`NO_BODY`·`X-Robots-Tag`) · RG-12. **2차 가능**: RG-2 · RG-3 · RG-13 · RG-14.

| # | 잔여 갭(현재 동작) | AC 판정 | 후속 처리 방침 |
|---|---|---|---|
| RG-1 **[해소 — pass 5 · §25 I-49·I-50]** | 실행 실패 코드 `ALL_SEEDS_UNREACHABLE`·`ROBOTS_UNREACHABLE`·`SOURCE_DISABLED`·`CANCELLED_BY_USER`·`CONFIG_CHANGED`(실행 수준)를 쓰지 않는다. 시작 주소가 전부 5xx·연결 실패여도 robots가 받아지면 실행이 SUCCEEDED로 끝나고, **SYNC·FULL_RESEND면 삭제 감지 스윕이 이번에 발견하지 못한 기존 문서 전부를 `NOT_REDISCOVERED`로 센다** → 사이트 장애가 2회 이어지면 멀쩡한 문서가 GONE·"정리 필요"가 되고 적재된 적 없는 행은 지워진다. robots 5xx는 호스트 중단(수집 0)이라 코드만 없다. 일시중지·중지된 실행은 `failureCode` 없이 CANCELLED | **① AC-KB3-4 위반(간접) — "5xx는 카운트하지 않음"이 사이트 단위 장애에서 깨진다 → 재작업 필요**. ② 코드 표시 자체(`ROBOTS_UNREACHABLE`·`SOURCE_DISABLED`·`CANCELLED_BY_USER`)는 AC 비해당 | ① **필수**: 크롤 종결 시 시작 주소(깊이 0 행)가 전부 `TRANSIENT`·차단이면 삭제 감지 스윕을 건너뛰고 `FAILED(ALL_SEEDS_UNREACHABLE)` ② 허용 호스트 전부가 `abortedHosts`면 `FAILED(ROBOTS_UNREACHABLE)` ③ `cancelRun()`에 실패 코드 인자를 더해 `CANCELLED_BY_USER`·`SOURCE_DISABLED` 기록 — 모두 `kb-crawl.runner.ts`·`kb-run.store.ts`·`kb-sources.service.ts` 안(봉인·계약 변경 0) |
| RG-2 | 실행 시점 호스트·출구 재판정(EX-KB-18): 요청마다 재판정해 **송신은 0**이지만, 차단된 요청은 `TRANSIENT`로만 기록되고 실행 `failureCode`(`EGRESS_BLOCKED`·`HOST_NOT_ALLOWED`)·목록 배지가 없다(robots 요청이 막히면 호스트 중단이라 실행은 SUCCEEDED · 수집 0) | AC 비해당(AC-KB2-2는 저장 시 거부 — 구현됨). 보안 불변식(송신 0)은 지켜진다 | fetcher의 `BLOCKED.reason`을 조각 결과로 올려, 허용 호스트 전부가 `EGRESS_BLOCKED`·`HOST_NOT_ALLOWED`로 막히면 `FAILED(<코드>)` · 목록 배지는 `lastRunStatus` + 코드로 표시 — 2차 가능 |
| RG-3 **[부분 완화 — pass 7 · §25 I-75: 실효 간격 300초 클램프 · 호스트 중단·사유 코드는 미구현]** | `Crawl-delay` > 300초 호스트 중단(`CRAWL_DELAY_TOO_LONG`) 미구현 — 간격은 max(소스 간격, Crawl-delay)로 지켜지지만 긴 지연이면 실행이 매우 오래 소스를 점유한다 | AC 비해당(AC-KB2-8 간격 준수는 충족) | `getRobots()` 결과의 `crawlDelaySec > 300`이면 `abortedHosts` + 실행 요약 코드 — 1파일 · 2차 가능 |
| RG-4 **[해소 — pass 5 · §25 I-51]** | 크롤 단계 429·503의 URL 1회 재시도(간격 ×4 또는 `Retry-After` · 최대 60초)와 호스트 연속 5회 중단(§6.8) 미구현 — 현재 `TRANSIENT`로 기록만 하고 다음 URL로 간다(삭제 감지 미산입은 지켜진다) | AC 비해당 | `KbHostPacer`에 호스트별 연속 429·503 수와 다음 가능 시각(`Retry-After`)을 두고 5회면 `abortedHosts` — 사이트 부하 예의(FR-KB2-5) 차원에서 1차 권장 |
| RG-5 **[해소 — pass 5 · §25 I-52 · 잔여 경합 §25.2 RG-19]** | `finishCrawl()`·`finishIngesting()`·`cancelRun()`과 `releaseActiveRun()`이 별도 호출이다(비원자). 그 사이에 프로세스가 죽으면 실행은 종단 상태인데 소스 `activeRunId`가 남아 **영구히 "실행 중"** — 예약 제외 · 수동 실행·범위 수정·삭제 409 · 중지는 종단 실행이라 CAS 실패로 해제 경로가 없다(DB 수동 수정 필요). `KbRunsService.createRun()`의 `applyCleanupAcknowledge()`도 선점 트랜잭션 밖이다 | AC 직접 비해당(AC-KB5-3의 이어받기는 크롤 중 사망만 다룬다) — 그러나 **NFR-KBR2(재시작 뒤 이어받기) 취지 위반 · 자동 복구 수단 없음 → 재작업 강력 권장** | 권장안: 스케줄러 tick 첫머리의 **자가 치유 스윕** — `activeRunId`가 가리키는 실행이 종단 상태(또는 부재)면 `releaseActiveRun(run.status, run.finishedAt ?? now)`(CAS · 해당 없으면 쿼리 1개) → 호출 경로 4곳을 한 번에 덮는다. 대안(`claimAndCreateRun` 방식으로 종결+해제를 한 트랜잭션)은 호출 경로 4곳 수정. `applyCleanupAcknowledge`는 `claimAndCreateRun`의 선택 인자로 트랜잭션 안에 넣는다 |
| RG-6 **[해소 — pass 5 · §25 I-53]** | 축소 감지 `SHRUNK` 미구현 — `decideChange().shrunk`를 크롤러·`succeedJob()` 어디도 쓰지 않아 "정리 필요(짧아짐)"가 달리지 않는다 | **AC-KB3-5 위반 → 재작업 필요** | 스키마 변경 없이 `succeedJob()`에서 판정 권장 — 문서 갱신 **전에** 이전 `textLength`·`byteSize`·`lastIngestedAt`을 읽어, 이전에 적재됐고 작업 행 값(제출 직전 기록)이 이전 값 × 0.5 미만이면 같은 갱신에서 `cleanupReason = SHRUNK`(이미 다른 사유가 있으면 보존). 순수 판정은 `change-detect.ts` 재사용 |
| RG-7 **[해소 — pass 5 · §25 I-54]** | `allowRawFileIngest = false` 소스의 문서 파일(PDF·OOXML)을 크롤 단계에서 **내려받아** 해시하고 ACTIVE·NEW로 기록한다(미리보기 "적재 예정"에 포함) — 적재 단계에서 다시 받은 뒤 `SKIPPED(EXCLUDED_AT_INGEST)`. 적재는 0이지만 "제외(원본 파일 전달 꺼짐 — `RAW_FILE_OFF`)"가 보이지 않고, 해시가 갱신되지 않아 매 SYNC마다 같은 파일을 두 번 받는다 | **AC-KB6-2(전반부 "제외(원본 파일 전달 꺼짐)") · AC-KB7-2(미리보기 제외 사유별) 위반 → 재작업 필요** | 크롤러 `visitOne()`의 파일 분기 앞에서 `!allowRawFileIngest`면 요청 없이 `EXCLUDED(RAW_FILE_OFF)`(§6.7) — `parse-source-row.ts`의 `SourceConfig`에 `allowRawFileIngest` 추가 |
| RG-8 **[해소 — pass 5 · §25 I-55 · 제목·스캔 PDF 경고는 RG-11 잔여]** | 문서 파일 사전 검사 미적용 — 추출 요청 `PDF`·`OOXML`(컨테이너 가드·매크로·암호·PII 건수)을 크롤·적재 어디서도 부르지 않는다. `allowRawFileIngest = true`면 압축 폭탄·매크로·암호 문서 여부와 개인정보 건수 확인 없이 원본 바이트를 보낸다(`FILE_UNSAFE`·`FILE_ENCRYPTED`·`PII_IN_RAW_FILE` 미집행 · R-17 · 원본 파일 PII 건수 미표시) | AC 직접 비해당(AC-KB6-5는 사이트맵만) — 그러나 **§7.3 · ADR-0044 §10 보안 결정 위반 · 거버넌스 ON + `KB_ALLOW_RAW_FILE_INGEST=true` 설치에서 R-17 미집행 → 재작업 강력 권장**(최소한 재작업 전까지 거버넌스 ON에서는 원본 파일 적재를 막는다) | 크롤 방문(파일 · 원본 전달 켜짐)에서 작업 스레드 `PDF`·`OOXML` 추출 → `ok = false`면 사유별 EXCLUDED · `piiMaskedCount`를 `observedPiiMasked`로 기록 · 거버넌스 ON ∧ 건수 ≥ 1이면 `PII_IN_RAW_FILE` · 적재 단계 재수집 뒤에도 같은 검사(내용이 바뀌었을 수 있음) |
| RG-9 **[해소 — pass 5 · §25 I-56]** | 크롤 임대 상호 배제 결함 — `claimCrawlLease()`가 "임대 유효"로 `null`을 주면 `tryRenewAndProcess()`가 DB에서 읽은 **보유자의 `claimToken`**으로 갱신하고 그대로 처리한다. 다중 인스턴스에서 두 인스턴스가 같은 실행을 동시에 크롤할 수 있다(호스트 간격 2배 · `seedFrontier` 유니크 충돌 예외 · `addOutOfScopeLinks` 읽기-수정-쓰기 경합). 조각 안에서 URL마다 임대를 갱신하지도 않는다 | AC 직접 비해당(AC-KB5-2는 실행 생성 1건 — 충족 · AC-KB2-8은 단일 인스턴스) — **NFR-KBR1 · §6.8(K-5 완화 전제 "실행당 1인스턴스") 위반 → 재작업 권장(높음)** | 인스턴스가 자기 토큰을 메모리(`Map<runId, token>`)에 들고, 자기 토큰이 없으면 처리하지 않는다(임대 만료 시 `claimCrawlLease`의 인수 경로만 사용) · URL마다 `renewCrawlLease(runId, 자기 토큰)` — 실패하면(중지로 `claimToken = null`이 된 경우 포함) 즉시 조각 종료 |
| RG-10 **[해소 — pass 5 · §25 I-57]** | 사라졌던 페이지가 **200**으로 돌아오면 `state = ACTIVE`·`missingStreak = 0`이 되지만 `cleanupReason = GONE`이 남는다(304 경로만 `nextMissingState(SEEN_OK)`로 해제) | AC-KB3-4 문언("`ACTIVE`로 복귀")은 충족 — §8.3 "복귀 시 GONE 해제"와 불일치 · 정리 필요 오표시 → 재작업 권장(작음) | `visitOne()`의 200 경로도 `nextMissingState(SEEN_OK)` 결과의 `cleanupReason`을 `markVisited()`에 넘긴다 |
| RG-11 **[일부 해소 — pass 5 · §25 I-58: 2MB·`NO_BODY`·`X-Robots-Tag` · 잔여는 §25.2]** | HTML 부가 판정 미적용 — 추출 텍스트 200자 미만 `NO_BODY` 제외(EX-KB-6 · 플래그만 계산) · `X-Robots-Tag` 헤더 `noindex`(메타는 구현) · `canonical` 기준 URL · 응답 `Content-Type` + 확장자 형식 판정(현재 확장자만) · HTML 응답 2MB 상한(현재 소스 `maxFileBytes`) · `Content-Encoding` → `ENCODING` 제외 | AC 비해당(AC-KB2-6은 메타 `noindex` — 충족) | 크롤러 `visitOne()`에 추가 — 2MB·`NO_BODY`·`X-Robots-Tag`는 1차 권장(SPA 대량 적재·폭주 방지), canonical·Content-Type은 2차 가능 |
| RG-12 **[해소 — pass 5 · §25 I-58]** | 적재 단계 재수집의 범위 밖·`noindex` 재검사(§9.5 2단계 · `EXCLUDED_AT_INGEST`) 미구현 — 404·410·해시 동일만 SKIPPED | AC 비해당 | `submitJob()`의 HTML 추출 뒤 `extracted.noindex`면 `SKIPPED(EXCLUDED_AT_INGEST)` — 1차 권장 |
| RG-13 | 변환 형식 변경 `FORMAT_CHANGED` 표시 미구현(K-8) — 형식을 바꾸면 새 이름으로 재적재되지만 옛 파일이 외부에 남는다는 표시가 없다 | AC 비해당 | 적재 성공 시 문서의 이전 `externalFileName` ≠ 새 이름이면 `cleanupReason = FORMAT_CHANGED` — `succeedJob()` 안 · 2차 가능 |
| RG-14 | `RATE_LIMIT` 대기 사유 미구현(인스턴스 메모리 버킷 — 조회 인스턴스가 알 수 없다) | AC 비해당(AC-KB4-4는 `RAG_NOT_READY` — 충족) | 계약 enum은 유지. 필요하면 `INGEST_STATUS` 행에 마지막 한도 초과 시각을 기록해 판정 — 2차 |
| RG-15 **[해소 — pass 5 · §25 I-56]** | 중지(CANCELLED)된 CRAWLING 실행을 크롤 조각이 URL 경계마다 확인하지 않아, 그 tick 예산(최대 30초) 동안 새 요청·문서 기록이 이어진다(종결 CAS만 실패) | **AC-KB5-4("진행 중 요청 1개 뒤 `CANCELLED`") 크롤 단계 위반 → 재작업 필요** | RG-9 수정(URL마다 자기 토큰으로 `renewCrawlLease` — `cancelRun()`이 `claimToken`을 비우므로 다음 URL 전에 실패 → 즉시 종료)으로 함께 해소 |

### 25.2 백엔드 pass 5 반영 — 현재 상태 · 신규 갭(RG-16~RG-20) (2026-09-28 · system-architect)

pass 5 코드(`apps/api/src/kb-sync/**` · `legacy-api/transport/*`)를 다시 대조했다. "AC 판정"의 뜻은 §25.1과 같다(**걸리면 커밋 전 재작업 대상**).

- **[pass 5 시점 — 아래 4줄의 RG-16~RG-20은 pass 6에서 해소 · 현재 목록은 §25.4]** **AC에 걸려 커밋 전 재작업이 필요한 항목**: **RG-16**(AC-KB2-4 "제외(리다이렉트 범위 밖)" + 리다이렉트되는 문서 적재 불가) · **RG-19**(AC-KB5-4 — 종결 직전 중지 경합의 고아 작업 제출 · 수정 1~2줄).
- **AC 밖이지만 재작업을 강력 권장**: **RG-17**(NFR-KBP2 크롤 처리량 — 500쪽 10분 예산 대비 약 8배 이상) · **RG-18**(호스트 겹침 동시 크롤 — §25.3 권장안 확정 후).
- **작은 정합성 묶음(1차 권장 · AC 밖)**: RG-20.
- **2차 가능(그대로)**: RG-2 · RG-3 · RG-13 · RG-14 · RG-11 잔여.

**pass 4 잔여 갭의 현재 상태**

| # | pass 5 상태 | 남은 것 |
|---|---|---|
| RG-1 | 해소(I-49·I-50) | `ROBOTS_UNREACHABLE`와 429·503 중단의 구분이 인스턴스 메모리(`throttleAborted`) 근사 — 조각이 다른 인스턴스로 넘어가면 429·503 중단 호스트도 robots 불가로 세어 `ROBOTS_UNREACHABLE`로 표시될 수 있다(표시만 다름 · 스윕을 건너뛰는 안전측 동작은 같음). `RAW_FILE_OFF` 도달 판정은 RG-20 |
| RG-2 · RG-3 | 미해소 | §25.1 그대로(2차) |
| RG-4 | 해소(I-51) | 재시도 여부·연속 횟수는 인스턴스 메모리(잃으면 1회 더 재시도할 뿐) · 중단 호스트는 실행 행(I-50) |
| RG-5 | 해소(I-52) | `createIngestJobsBulk()`는 종결 트랜잭션 밖(재종결 멱등으로 흡수 — 문서당 진행 중 1건 CAS + 기존 작업이 있으면 INGESTING) · 중지 경합은 RG-19 |
| RG-6 · RG-7 | 해소(I-53 · I-54) | — |
| RG-8 | 해소(I-55) | `PII_IN_RAW_FILE` 제외 시 건수 미기록(RG-20) · 파일 제목·스캔 PDF 경고(RG-11 잔여) |
| RG-9 · RG-15 | 해소(I-56) | 종결 직전 경합(RG-19) |
| RG-10 | 해소(I-57) | — |
| RG-11 | 일부 해소(I-58) | **잔여(2차 가능)**: `canonical` 기준 URL · 응답 `Content-Type` + 확장자 형식 판정(현재 확장자만) · `Content-Encoding` → `ENCODING` 제외 · 파일 제목 추출 · 스캔 PDF(텍스트 0) 경고(§7.1 ②③) |
| RG-12 | 해소(I-58) | "범위 밖" 재검사는 설계상 불필요로 정리(I-58 근거) |
| RG-13 · RG-14 | 미해소 | §25.1 그대로(2차) |

**신규 갭**

| # | 잔여 갭(현재 동작) | AC 판정 | 후속 처리 방침 |
|---|---|---|---|
| RG-16 **[해소 — pass 6 · §25 I-66]** | **리다이렉트 처리 불완전(§6.4 · §6.5)** — ① `fetchWithRedirects()`가 범위 밖 호스트·`https→http` 하향·4번째 hop·순환을 모두 `ERROR`로 돌려 `visitOne()`이 `TRANSIENT`(ACTIVE 유지)로 기록한다. 계약 enum `REDIRECT_OUT_OF_SCOPE`를 쓰는 코드가 없다(요청 차단은 지켜진다 — `kb-sync-redirect-scope` 통합 시험은 "요청 안 나감"·"제목 없음"만 단언). ② 최종 URL로 문서를 기록하지 않고 원래 URL 행에 최종 내용(제목·해시)을 기록한다. ③ 적재 단계 재수집은 `fetchOnce()`(리다이렉트 미추종)라 3xx를 `NETWORK_ERROR`로 보고 백오프 재시도 → 3회 소진 시 FAILED — **리다이렉트되는 모든 문서(예: `/docs` → `/docs/`)가 적재되지 않고** 연속 실패 수가 올라 "반복 실패" 배지가 뜬다. ④ robots.txt 3xx는 따라가지 않고 곧바로 호스트 중단(`robotsFetchOutcome(null)` = `ABORT_HOST`) | **① AC-KB2-4("제외(리다이렉트 범위 밖)") 위반 → 재작업 필요**. ③은 AC 밖이지만 FR-KB2-7·FR-KB4 기능 결함(리다이렉트 문서 적재 0) → 함께 재작업 | ① `fetchWithRedirects()` 결과에 `REDIRECT_OUT_OF_SCOPE`(범위 밖·하향·4번째 hop·순환)를 따로 두고 `visitOne()`이 `EXCLUDED(REDIRECT_OUT_OF_SCOPE)`로 기록(시작 주소 도달로 셈 — 사이트는 응답했다). ② 최종 URL ≠ 원래 URL이면 최종 URL(정규화 · 범위 안)을 같은 깊이로 프런티어에 넣고 원래 행은 `VISITED`·`observedChange = null`만(§6.4 원안) — 같은 문서 두 번 적재 방지. ③ 리다이렉트 추종을 크롤러·적재기 공용 헬퍼(`crawl/` 안 · 단계마다 재검증)로 옮겨 적재 재수집도 같은 규칙으로 따른다(최종 URL이 범위 밖이면 `SKIPPED(EXCLUDED_AT_INGEST)`). ④ robots.txt도 같은 헬퍼로 같은 호스트 안 최대 3회 — 모두 `kb-sync/**` 안(봉인·계약 변경 0) |
| RG-17 **[해소 — pass 6 · §25 I-67 · 500쪽 실측 전]** | **크롤 처리량·머리 막힘(§6.8 · §16)** — `processLoop()`가 다음 문서의 호스트 페이서가 준비되지 않으면 조각을 끝낸다(`break`). 방문 직후 `release()`가 다음 가능 시각을 now + 간격으로 두므로, 간격(하한 500ms)이 반복당 DB 처리 시간보다 길면 **실행당 tick마다 URL 약 1개**만 처리된다(tick 주기 `KB_SYNC_INTERVAL_MS` 10초 → 500쪽 ≈ 85분 이상 · 예산 10분). 다음 문서의 호스트만 보고 멈추므로 다른 호스트 문서도 함께 막힌다. 같은 인스턴스에서 같은 호스트를 쓰는 두 실행은 `findActiveRunsForCrawl()`이 `createdAt` 오름차순이라 오래된 실행이 매 tick 먼저 간격을 차지해 뒤 실행이 굶는다 | AC 비해당(AC-KB2-8 간격 준수는 충족) — **NFR-KBP2 위반 → 재작업 강력 권장** | `processLoop()`: 페이서 대기 시간이 이 실행의 남은 조각 예산 안이면 `stopping()`을 확인하며 그만큼 기다린 뒤 계속하고, 넘으면 조각을 끝낸다. `KbSyncJob.tick()`: 크롤 예산을 실행 수로 나눠 실행별 조각 기한을 주고 적재 조각용 최소 예산(예: 5초)을 남긴다. 같은 인스턴스 굶김은 이 분할로 해소되고, 다중 인스턴스 겹침은 RG-18(§25.3)이 맡는다. 예상: tick 예산 대부분을 요청 간격으로 채워 500쪽 ≈ 10~12분 |
| RG-18 **[해소 — pass 6 · §25 I-68 · §25.3 B안 채택]** | **호스트 겹침 동시 크롤(§6.8 K-5 완화)** — 스케줄러 판정(`findActiveCrawlHosts`)이 `CRAWLING` 실행만 보므로 같은 tick에 함께 예약된(`QUEUED`) 겹침 소스는 함께 시작된다. 수동 실행·적재 승인 경로는 겹침을 검사하지 않는다. 같은 인스턴스면 RG-17의 굶김, 다른 인스턴스면 인스턴스 메모리 페이서가 따로라 같은 호스트에 두 배 속도가 된다 | AC 비해당 — §6.8 결정과 불일치 · 사이트 부하 예의(FR-KB2-5) → **§25.3 권장안 확정 후 재작업** | §25.3 |
| RG-19 **[해소 — pass 6 · §25 I-69 · 권장 ①의 문구는 §25.4에서 정정]** | **종결 직전 중지 경합의 고아 작업 제출** — 크롤 종결은 마지막 임대 갱신 뒤 스윕·집계·`createIngestJobsBulk()`(작업 1건당 쿼리 3개 — 수천 건이면 수 초 이상)를 하고 나서 `finishCrawlAndRelease()`로 전이한다. 그 사이 중지되면 `cancelRun()`은 아직 없던 작업을 정리하지 못하고 종결 CAS는 실패한다 → CANCELLED 실행에 PENDING 작업과 문서 `activeIngestJobId`가 남는다. `pickNextPendingJob()`·`trySubmitOne()`은 실행 상태를 보지 않으므로(소스 `enabled`·`configVersion`만) **중지 뒤에도 그 작업이 외부로 제출된다**(관리자 중지는 소스가 `enabled`라 막히지 않는다) | **AC-KB5-4(중지 뒤 요청 1개 이후 CANCELLED · 외부 호출 없음) 위반 — 좁은 경합이지만 문서 수에 비례해 창이 커진다 → 재작업 필요(작음)** | ① **[pass 6 정정 — §25.4: "INGESTING이 아니면 취소"는 틀린 권장이었다 · 종단 실행만 취소하고 QUEUED·CRAWLING은 대기가 맞다]** `trySubmitOne()`: 선택한 작업의 실행이 `INGESTING`이 아니면 제출하지 않고 작업 CANCELLED(`CANCELLED_BY_USER`) + 문서 표식 해제(`cancelJobConfigChanged`와 같은 형태) ② `finishCrawlAndRelease()`가 `false`(종결 CAS 실패)를 돌려주면 그 실행의 PENDING 작업을 같은 방식으로 정리 — 둘 다 `kb-sync/**` 안 |
| RG-20 **[해소 — pass 6 · ① §25 I-72 · ②~⑦ I-70]** | **작은 정합성 묶음** — ① `RAW_FILE_OFF`(요청 없음)를 시작 주소 "도달"로 센다 → 시작 주소가 원본 전달 꺼진 문서 파일뿐인 소스는 사이트 장애여도 삭제 감지 스윕이 돈다(AC-KB3-4 시나리오의 드문 변형) ② `PII_IN_RAW_FILE`로 제외한 파일은 건수를 `observedPiiMasked`에 기록하지 않는다(실행 요약 "개인정보 N건"에 빠짐) · `observedPiiMasked`는 실행마다 초기화되지 않아(`seedFrontier`는 `observedChange`만 초기화) 이번에 다시 재지 않은 행(304·오류·제외)의 지난 값이 합계에 섞인다 ③ 소스 일시중지로 중지된 실행의 PENDING 작업 `resultCode`도 `CANCELLED_BY_USER` ④ `X-Robots-Tag`가 여러 줄이라 쉼표로 합쳐졌을 때 `googlebot: noindex` 줄 **뒤의** 접두 없는 `noindex` 줄이 googlebot 몫으로 해석돼 무시된다(안전하지 않은 쪽 — 우리에게 준 noindex 누락) ⑤ 재종결 시 이미 스윕한 행이 `untouchedSince`로 빠져 두 번째 종결 요약의 없어짐·GONE 수가 줄어든다(표시만) ⑥ 적재 재수집의 HTML 크기 상한이 2MB가 아니라 소스 `maxFileBytes` ⑦ `retriedDocs`·`throttleStreaks`·`throttleAborted`는 상한이 없다(`leaseTokens`만 200 — 다른 인스턴스가 끝낸 실행의 항목이 남는다) | AC 비해당(①은 AC-KB3-4의 드문 변형) | ① 요청을 보낸 깊이 0 문서가 1개 이상이고 그 전부가 실패일 때만 미도달(`RAW_FILE_OFF`·중단 호스트 건너뜀은 중립) ② 제외 경로에서도 `observedPiiMasked` 기록 · `seedFrontier()`가 재방문 행의 `observedPiiMasked`도 `null`로 초기화 ③ `cancelRun()`의 작업 `resultCode`에 실행 코드 전달(작업 enum에 `SOURCE_DISABLED`가 없으면 `CANCELLED_BY_USER` 유지로 확정하고 문서화) ④ `parseXRobotsTag()`가 쉼표 조각 중 `봇이름:` 접두가 없는 조각을 "모든 봇"으로 되돌림(RFC 형식은 헤더 줄 단위라 합쳐진 값에서 경계를 복원할 수 없다 — 보수적으로 접두 없는 지시는 늘 우리에게 적용) ⑤ 표시만이라 그대로 둘 수 있음 ⑥ `submitJob()`의 HTML `maxBytes` = min(`maxFileBytes`, 2MB) ⑦ 크기 상한 또는 `forgetRun` 시각 기준 정리 — 모두 1파일 내외 |

### 25.3 호스트 겹침 실행 — 권장안 (RG-17·RG-18 · 제안 · 오케스트레이터 승인 후 ADR-0044 §속도 제한 갱신) — [pass 6: **B안 채택·구현**(§25 I-67·I-68) · ADR-0044 결정 문구 갱신]

**문제**: 호스트가 겹치는 두 소스의 실행이 동시에 CRAWLING이 되는 경로가 셋 있다(같은 tick 예약 · 수동 실행 · 적재 승인). 같은 인스턴스에서는 뒤 실행이 굶고(RG-17), 다른 인스턴스에서는 호스트 간격이 절반이 된다(K-5).

| 선택지 | 내용 | 장점 | 단점 |
|---|---|---|---|
| A. 수동·승인도 거부 | `POST …/runs`·`approve-ingest`에서 겹침이면 `409 KB_SOURCE_BUSY` + `details: [{ field: 'allowedHosts', message: 'HOST_BUSY' }]`(오류 코드 enum 추가 없음) | 가장 작다(서비스 2곳) | 같은 사이트를 섹션별 소스로 나눈 설치에서 수동 실행이 자주 실패 · 사용자가 다시 눌러야 함 · 같은 tick 예약 구멍은 그대로 · 판정과 선점이 다른 쿼리라 다중 인스턴스 경합은 남음 |
| **B. 크롤 시작 게이트(대기열) — 권장** | 실행 생성은 지금처럼(소스 선점만 · 409는 같은 소스일 때만). **QUEUED → CRAWLING 전이**(`claimCrawlLease()`의 QUEUED 분기)에 게이트: "허용 호스트가 겹치는 **다른 소스의 CRAWLING 실행이 없고**, 겹치는 **더 오래된(`createdAt`) QUEUED 실행도 없을 때**"만 전이한다(FIFO). 전이 CAS 뒤 한 번 더 확인해 자기보다 오래된 겹침 CRAWLING이 생겼으면 QUEUED로 되돌린다(낙관적 시작 + 사후 확인 — 판정·CAS가 다른 문장이어도 다중 인스턴스에서 안전). `findActiveRunsForCrawl()`은 넉넉히 읽어(예: 20) CRAWLING + 게이트 통과 QUEUED 중 N개를 고른다(대기 중인 QUEUED가 앞자리를 막아 다른 소스가 굶지 않게). 스케줄러의 사전 필터는 그대로 둬도 되고(겹치면 실행 생성 자체를 미룸 — 현행 동작) 없애도 된다(게이트가 같은 일을 한다) | 세 경로·다중 인스턴스·같은 tick을 **한 곳(DB 판정)**에서 해결 — K-5 완화가 인스턴스 수와 무관해진다 · FIFO라 굶김·교착 없음(생성 순서가 전순서) · 계약 변경 0(콘솔은 기존 `QUEUED` = "대기 중" 표시) · 호스트당 동시 크롤 1이라 RG-17의 같은 인스턴스 굶김도 구조적으로 사라진다 | 수동 실행이 즉시 시작되지 않을 수 있다(대기 표시로 흡수 — 사유 표시가 필요하면 2차로 `waitingReason`에 `HOST_BUSY` 추가 검토 = 계약 enum 변경) · 크롤 선점 쿼리 +1~2(겹침 판정 — 소스 `allowedHosts` JSON을 읽음) · QUEUED 실행이 오래 머물 수 있다(앞 실행의 크롤 시간만큼 — 크롤 단계만 막고 적재 단계는 막지 않는다) |
| C. 페이서 공정 분배만 | 같은 인스턴스에서 겹침 실행을 라운드로빈 | 굶김만 해소 | 다른 인스턴스의 두 배 속도(K-5)는 그대로 — 단독으로는 불충분 |

**권장: B + RG-17의 실행별 예산 분할.** 근거 — ① §6.8의 원래 결정("호스트가 겹치는 소스는 동시에 크롤하지 않는다")을 예약 경로에만 두면 구멍이 남는다. 규칙을 "누가 실행을 만들었나"가 아니라 **"크롤을 시작하는 순간"**에 두면 경로 수와 인스턴스 수에 무관해진다. ② 사용자가 누른 수동 실행을 거부(A)하는 것보다 "대기 중"으로 받아 두는 편이 콘솔 경험과 FR-KB5(수동 실행)의 취지에 맞다. ③ `KbSource.activeRunId`(소스당 1)는 그대로라 기존 선점·자가 치유(I-52)·중지(I-56)와 충돌이 없다 — 게이트는 크롤 임대 CAS 앞에 붙는 조건일 뿐이다. ④ 시험: 같은 호스트 두 소스를 수동 실행 → 뒤 실행이 QUEUED로 대기 → 앞 실행 크롤 종결 뒤 CRAWLING · 두 인스턴스 동시 tick에서 같은 호스트 요청 간격 ≥ 소스 간격 · 같은 tick 예약 2건 중 1건만 CRAWLING.
- 수정 범위(예상): `kb-sync/core/kb-run.store.ts`(`claimCrawlLease` 게이트 · `findActiveRunsForCrawl` 선택) · `kb-sync/engine/kb-sync.job.ts`(예산 분할) · `kb-sync/engine/kb-crawl.runner.ts`(페이서 대기) — 봉인·계약·마이그레이션 변경 0. A는 B 도입 전 임시 방편으로만 의미가 있다.

### 25.4 백엔드 pass 6 반영 — 현재 상태 · 신규 갭(RG-21~RG-22) · 사용자 설정·마이그레이션 영향 (2026-09-28 · system-architect)

pass 6 코드(`apps/api/src/kb-sync/**` · `apps/api/prisma/**` · `config/env.validation.ts` · `legacy-api/transport/**`)를 다시 대조했다. "AC 판정"의 뜻은 §25.1과 같다(**걸리면 커밋 전 재작업 대상**).

- **[pass 6 시점 — 아래 4줄의 RG-21·RG-22①④⑤는 pass 7·8에서 해소 · 현재 목록은 §25.5]** **AC에 걸려 커밋 전 재작업이 필요한 항목: 없음.** pass 5의 AC 갭 RG-16(AC-KB2-4)·RG-19(AC-KB5-4)는 해소됐다.
- **AC 밖이지만 커밋 전 재작업을 강력 권장(사실상 필수)**: **RG-21**(인증 벽 가드 사문화 — EX-KB-7 · §8.4 · ADR-0044 결정 미집행. 인증 헤더 비밀·세션 만료 시 외부 적재본을 같은 파일 이름으로 로그인 화면으로 덮어쓸 수 있고, 문서 1건 삭제 API가 없어 되돌릴 수 없다 — K-1).
- **1차 권장(작음 · AC 밖)**: RG-22.
- **2차 가능(그대로)**: RG-2 · RG-3 · RG-11 잔여 · RG-13 · RG-14.

**pass 5 갭의 현재 상태**

| # | pass 6 상태 | 남은 것 |
|---|---|---|
| RG-1 | 해소(pass 5 · I-49) | `ROBOTS_UNREACHABLE` 구분의 인스턴스 메모리 근사(§25.2 그대로 — 표시만) |
| RG-16 | 해소(I-66) | 적재 단계 홉의 robots 재확인·페이싱 없음(RG-22②) |
| RG-17 | 해소(I-67) | 500쪽 10분 예산(NFR-KBP2)은 실측 전 · 사이트맵 요청 비페이싱(RG-22③) |
| RG-18 | 해소(I-68 · §25.3 B안) | 겹침 대기 사유 표시 없음(콘솔 "대기 중" — 2차 `waitingReason = HOST_BUSY` 검토 = 계약 enum 변경) · 스케줄러 사전 필터와 게이트가 이중(의도 — 무해) |
| RG-19 | 해소(I-69) | 대기(`WAIT`) 작업의 전역 대기열 머리 막힘(RG-22①) · 권장 문구 정정(아래) |
| RG-20 | 해소(① I-72 · ②~⑦ I-70) | 종단 실행 정리 경로의 `resultCode`(RG-22④) |
| RG-2 · RG-3 · RG-11 잔여 · RG-13 · RG-14 | 미해소 | §25.1·§25.2 그대로(2차) |

**RG-19 문구 정합 판단** — §25.2 RG-19 권장 ①("선택한 작업의 실행이 `INGESTING`이 아니면 … 취소")은 **틀린 권장이었고, 구현(종단 실행만 취소 · QUEUED·CRAWLING은 대기)이 정합한다.** 근거: 크롤 종결은 `createIngestJobsBulk()`로 작업을 먼저 만들고(종결 트랜잭션 밖 — §9.3 종결 순서 · I-52) 그 뒤 `finishCrawlAndRelease()`로 INGESTING에 전이한다. 그 사이(작업 수에 비례 — 수 초) 다른 인스턴스의 적재기가 그 작업을 고르면 권장 문구대로는 **정상 작업이 취소**돼 이번 실행의 적재가 빠진다(해시 미갱신이라 다음 실행이 다시 잡지만 한 주기를 잃는다). 중지 경합의 본래 목표(AC-KB5-4 — 중지된 실행의 작업은 외부 호출 0)는 "종단이면 취소"만으로 충족된다. QUEUED 실행에 작업이 있는 경우는 정상 흐름에 없다(게이트 되돌림은 작업 생성 전) — 방어적 대기다. 이 판단으로 확정하고 §25.2 RG-19 행에 정정 표시를 달았다. 남는 비용은 RG-22①.

**신규 갭**

| # | 잔여 갭(현재 동작) | AC 판정 | 후속 처리 방침 |
|---|---|---|---|
| RG-21 **[해소 — pass 8 · §25 I-85 · `X:` = 호스트+경로(권장안 편차) · PREVIEW는 기록만]** | **인증 벽 가드 사문화(§8.4 · EX-KB-7)** — 가드 `evaluateRunGuards()`의 입력이 결함: ① 분자(`hashCounts` — 같은 해시 최다 수)는 `visitOne()` 결과가 `HTML_VISITED`일 때만 센다 — `HTML_VISITED`는 **UNCHANGED**일 때만 나오고(NEW·CHANGED = `ADDED_TO_INGEST`), 파일 UNCHANGED(바이트 해시)도 같은 맵에 섞인다 ② 분자는 `processLoop()`의 **조각 지역 변수**라 종결 조각에서 방문한 것만 남는다(여러 tick에 걸친 크롤은 앞 조각 몫 소실 — 코드 주석은 "과소 탐지 = 안전측"이라 적었지만 강등 누락은 위험측이다) ③ 분모(`visitedHtml`)는 DB의 이번 실행 VISITED HTML 전체(304·제외·리다이렉트 원래 행 포함)라 분자와 기준이 다르다 ④ 가드를 PREVIEW·FULL_RESEND에도 적용한다(§8.4 "SYNC에만"과 다름 — PREVIEW에서 강등되면 `demoteReview`가 승인을 해제한다). 결과 — 로그인 화면으로 수렴한 사이트를 잡지 못한다: (가) **200 + 로그인 폼**(세션 만료 · `STATIC_HEADER` 비밀 만료의 전형): 모든 쪽이 같은 해시의 CHANGED → 분자 0 → 강등 없음 → **같은 파일 이름으로 외부 적재본을 로그인 화면으로 덮어쓴다**(NEW_RATIO는 NEW만 세므로 못 잡는다 · 첫 적재 전에는 P-4 미리보기가 사람 검토로 막는다) (나) **같은 호스트·범위 안 로그인 페이지로 3xx**: I-66으로 최종 URL 1행만 기록되고 원래 행은 방문 표시만 — 로그인 페이지 1건만 NEW(200자 미만이면 `NO_BODY`) · 원래 문서는 `ACTIVE`로 남아 경고 없이 옛 적재본 유지 (다) **경로 접두 밖·타 호스트(SSO)로 3xx**: 전부 `EXCLUDED(REDIRECT_OUT_OF_SCOPE)` — 적재는 없지만 "인증 필요로 보임" 경고도 없다 | **AC-KB1~KB7 어디에도 직접 걸리지 않는다**(인증 벽 판정을 요구하는 AC가 없다 — AC-KB7-2는 미리보기 표시, AC-KB3-1은 변경 없음 재실행). 그러나 **요구사항 EX-KB-7("모든 페이지가 같은 해시로 수렴하면 '인증 필요로 보임' 경고 · 적재 보류")과 설계 §8.4·ADR-0044 결정을 위반**하고 (가)는 되돌릴 수 없는 외부 데이터 손상이다 → **커밋 전 재작업 강력 권장** | 권장안(스키마 nullable 컬럼 +1 · 계약 변경 0): ① **관측 해시를 행에 남긴다** — `KbDocument.observedHash String?`(그 실행의 관측 · `observedChange`처럼 `seedFrontier()` 재방문 때 null 초기화 · 이름은 봉인 KB-10 금지어 `content`를 피한다 · 값은 정규화 본문의 sha256이라 원문 비저장 원칙 유지). HTML 본문을 추출한 모든 경로(NEW·CHANGED·UNCHANGED · `NO_BODY` · `NOINDEX`)에서 기록하고, 리다이렉트 원래 행에는 `R:` + 최종 URL 해시, 범위 밖 리다이렉트 행에는 `X:` + 대상 호스트(헬퍼 결과에 대상을 싣는다 — 어려우면 `X:*`)를 기록해 "여러 URL이 한 목적지로 수렴"도 같은 분포로 잡는다 ② 종결 때 DB에서 `groupBy(observedHash)`(이번 실행 · HTML) 최빈 수 ÷ `observedHash`가 있는 HTML 행 수 → 기존 임계(≥ 10쪽 ∧ ≥ 80%) — 조각 지역 `hashCounts` 삭제(파일 해시 혼입도 사라짐) ③ 적용 대상 = SYNC·FULL_RESEND(전량 덮어쓰기인 FULL_RESEND가 가장 위험 — §8.4 문구를 "SYNC·FULL_RESEND"로 정정) · PREVIEW는 강등(승인 해제) 대신 `demotedReason`만 기록해 미리보기 화면에 경고 ④ 시험: 200 로그인 폼 12쪽 → SYNC 강등(`AUTH_WALL`) · 작업 0 · 외부 호출 0 / 같은 호스트 `/login` 3xx 12쪽 → 강등 / 여러 조각에 걸친 크롤에서도 판정 / FULL_RESEND도 강등. 마이그레이션: 새 파일(예: `20260928120000_kb_document_observed_hash` — `ALTER TABLE … ADD COLUMN` nullable 1 · 백필 0) 권장 — 아직 미커밋인 `20260928100000_kb_document_parent`에 합치면 그 파일을 이미 적용한 개발 DB에서 체크섬 불일치가 난다. 대안(마이그레이션 0 — 실행 행 `counts` JSON에 해시 분포 누적)은 쪽마다 최대 수백 KB JSON을 다시 쓰므로 비권장 |
| RG-22 **[① 해소 — pass 7 · I-81(권장안과 다른 방식) · ④⑤ 해소 — pass 8 · I-87 · ②③ 부분 · ⑥ 잔여 — §25.5]** | **작은 잔여 묶음** — ① 제출 게이트 `WAIT`의 머리 막힘: `pickNextPendingJob()`은 레인별 가장 오래된 PENDING 1건만 고르므로 그 작업의 실행이 아직 CRAWLING이면 `trySubmitOne()`이 `false`로 그 tick의 적재를 끝낸다 — 정상 창(작업 생성 ~ 전이, 수 초)은 무해하지만 그 창에서 크롤 인스턴스가 죽으면 임대 만료(≥ 300초 · 기본 600초)와 인수·재종결까지 **모든 소스의 적재가 멈춘다** ② 적재 단계 재수집의 리다이렉트 홉은 robots 재확인·페이싱이 없다(크롤 단계는 있음 — 크롤 때 통과한 경로라 영향 작음) ③ 사이트맵 요청은 호스트 페이서를 거치지 않는다(기존 — 실행당 최대 50개) ④ 종단 실행 정리(`cancelPendingJobsOfTerminatedRun`·`cancelJobRunTerminated`)의 작업 `resultCode`는 실행이 소스 일시중지(`SOURCE_DISABLED`)로 끝났어도 `CANCELLED_BY_USER`(I-70③의 `CONFIG_CHANGED`와 불일치 — 표시만) ⑤ 봉인 KB-14는 첫 마이그레이션 파일만 검사 — 두 번째 마이그레이션(`ALTER TABLE`)은 정적 검사 밖 ⑥ `outOfScopeLinks`("범위 밖 링크 수")에 비대상 형식 링크가 합쳐져 의미가 넓어졌다(콘솔 표시 없음) | AC 비해당 | ① `pickNextPendingJob()`이 INGESTING 실행의 작업만 고르게(INGESTING 실행 id 선조회 1쿼리 + `runId in`) — `runGate`는 방어로 유지 ② 필요 시 적재기에도 `beforeRequest` 훅(robots 캐시 재사용 · 2차) ③ 그대로(2차) ④ 두 메서드가 실행 `failureCode`를 읽어 `SOURCE_DISABLED`면 `CONFIG_CHANGED` ⑤ `kb-sync-sealing.spec.ts`에 KB-14b — `20260928100000_kb_document_parent` SQL = `ALTER TABLE … ADD COLUMN` 1 · `CREATE INDEX` 1 · `DROP`·`WHERE`·`UPDATE` 0(통합 부분 인덱스 4는 기존 검사가 덮음) ⑥ §4 계약 필드 설명 갱신(표시만 · 2차) |

**알려진 한계(pass 6 · §20에 K-15~K-18로 등록)** — K-15 부모 포인터 1개(다중 부모) · K-16 마이그레이션 이전 행의 부모 포인터 없음 · K-17 pdf.js 내부 자원은 작업 스레드 힙 192MB·30초 상한에 의존 · K-18 중지 시 외부 RAG 작업은 계속(취소 API 부재 — 의도된 절충).

**사용자 설정 영향 — 경로 접두 의미 변경(I-72①)**

- 영향: `/docs`로 적은 소스는 `/docs-guide`·`/docs.html`·`/docsecret`을 더 이상 수집하지 않는다. 그런 문서가 이미 있으면 다음 SYNC부터 "다시 발견되지 않음" → 연속 2회 뒤 GONE(적재된 적 있으면 "정리 필요", 없으면 행 삭제). 저장된 설정 값은 그대로라 `configVersion`이 오르지 않고 승인도 유지된다(재미리보기 없이 SYNC로 진행).
- 방향 판단: 의도치 않은 형제 경로(`/docsecret`) 수집을 막는 안전한 쪽이다 — 수용한다.
- **데이터 마이그레이션·백필: 불요** — 이 기능은 미커밋·미배포라 운영 설치에 저장된 소스가 없다. 배포 뒤였다면 저장된 접두를 옛 의미로 보존하는 이행(또는 `configVersion` 증가 + 재미리보기 강제)이 필요했다는 원칙을 남긴다.
- **화면 명세: 안내문 추가 필요**(동작·검증 변경 없음) — 경로 접두 입력에 비교 규칙을 알리는 도움말을 단다(화면 설계서 §3 구현 메모 · frontend 후속 — `messages.ts` 1키).
- 변경 알림: 이 그룹 커밋 안내(changelog)에 "경로 접두는 경로 단위로 비교" 1줄.

**마이그레이션 영향(I-63)** — `20260928100000_kb_document_parent`: nullable `ADD COLUMN` + 인덱스 1 · 백필 0 · 기존 행 null · 원시 부분 유니크 4 보존 · 롤백 = 코드만 되돌림(컬럼 방치 가능). 기존 행 null의 영향은 K-16 — 운영 데이터는 없으므로 이행 불요. 이 그룹 커밋 전 코드로 크롤한 **개발·시연 DB**는 다음 중 하나를 권장: ① 검증자 1회 초기화 `UPDATE "kb_documents" SET "etag" = NULL, "lastModified" = NULL WHERE "kind" = 'HTML'` — 다음 실행이 200으로 받아 부모 포인터를 채우고, 해시 비교로 UNCHANGED가 되어 적재 0·검증자 복구(R-24 · AC-KB3-1 유지) ② DB 재생성. `KB_SYNC_LEASE_MS`를 300,000 미만으로 둔 환경은 기동이 실패하므로 값을 올린다(`docs/05-ops/자동배포.md` §5.7).

### 25.5 백엔드 pass 7·8 반영 — 현재 상태 · 신규 갭(RG-23~RG-25) · §8.4 적용 대상 정리 · 거버넌스 결정 번복 · 사용자 결정 대기 (2026-09-28 · system-architect)

> **[pass 9·10 갱신]** 이 절은 pass 8 시점 기록이다. 현재 상태는 §25.6 — RG-23·RG-25 해소(§25 I-93·I-94) · RG-24①③ 해소(I-96) · U-3 채택·구현(I-95) · K-19 해소(I-92) · 신규 RG-26 · 사용자 결정 U-5.

pass 7(R4 지적 N-1~N-10·N-13)과 pass 8(RG-21 재작업 · 거버넌스 실행·적재 차단 · N-11 · RG-22④⑤ · 사이트맵 임대) 코드(`apps/api/src/kb-sync/**` · `apps/api/prisma/**` · `packages/shared-types/src/kb-sync.ts` · `config/env.validation.ts` · 콘솔 `messages.ts` `failureCodeLabel`)를 다시 대조했다. "AC 판정"의 뜻은 §25.1과 같다(**걸리면 커밋 전 재작업 대상**).

- **AC에 걸려 커밋 전 재작업이 필요한 항목: RG-25**(HTML 제목 비마스킹 — 제목에 개인정보가 있으면 AC-KB6-1 위반 · 이번 대조에서 새로 찾음). → **pass 10 해소(§25 I-93)**
- **커밋 전 재작업 권장(작음 · AC 밖)**: **RG-23**(새로 비율 강등이 승인으로 풀리지 않는 루프 — EX-KB-5). → **pass 10 해소(§25 I-94)**
- **1차 권장(작음)**: RG-24①(같은 호스트 다른 포트로 인증 헤더 동행). → **pass 10 리다이렉트 홉 해소(§25 I-96) · 링크 경로 잔여는 §25.6 RG-26②**
- **2차 가능(그대로)**: RG-2 · RG-3(클램프로 부분 완화) · RG-11 잔여 · RG-13 · RG-14 · RG-22②③⑥ · RG-24②③.

**pass 6 갭의 현재 상태**

| # | pass 8 상태 | 남은 것 |
|---|---|---|
| RG-21 | 해소(I-85) | 오탐·미탐 한계 K-20 · `X:` = 호스트+경로(권장안 편차 — 기록) |
| RG-22① | 해소(I-81 — QUEUED·CRAWLING 제외 방식) | — |
| RG-22② | 부분(I-83 — 적재 홉 사이 슬롯 임대 갱신만) | 적재 홉의 robots 재확인·페이싱 없음(2차) |
| RG-22③ | 부분(pass 8 — 사이트맵 요청 직전 임대 갱신) | 사이트맵 요청 비페이싱(2차) |
| RG-22④⑤ | 해소(I-87 · §15 KB-14b) | — |
| RG-22⑥ | 미해소 | `outOfScopeLinks` 의미 확장의 계약 설명(2차) |
| RG-3 | 부분 완화(I-75 — 실효 간격 300초 클램프) | 호스트 중단·`CRAWL_DELAY_TOO_LONG` 사유 표시(계약 enum 추가 필요 — 2차) |
| RG-17 잔여 | 그대로 | 500쪽 10분 예산 실측 전 + 리다이렉트 강제 대기 비용(K-19 — pass 9 해소 · §25 I-92) |

**§8.4 적용 대상 정리(판단 — 구현을 기준으로 문서를 정정 · 코드 변경 0)** — 원 설계 "SYNC에만"과 구현(인증 벽: SYNC·FULL_RESEND 강등 / PREVIEW 기록만 · 새로 비율: 모든 종류 강등)이 달랐다.
- **인증 벽**: FULL_RESEND는 전량 덮어쓰기라 가장 위험하므로 강등 대상에 넣는다(§25.4 RG-21③ 권장대로). PREVIEW는 외부 송신이 0이고 사람이 결과를 보고 승인하므로 승인을 해제할 이유가 없다(미승인 소스는 해제할 승인도 없다) — 실행 이력에 사유만 남겨 화면이 경고한다. 승인 뒤 SYNC가 가드를 다시 받으므로 인증 벽이 계속되면 거기서 강등된다.
- **새로 비율**: 모든 종류에 강등을 유지한다. ① FULL_RESEND도 새 문서를 대량 적재한다 — 개편 직후 "전체 다시 적재"가 검토 없이 새 URL 수백 개를 보내는 것을 막는 쪽이 EX-KB-5 취지다 ② PREVIEW에서의 강등은 "승인 해제 + 사유"일 뿐이고 그 미리보기를 승인하면 풀린다 — 승인된 소스에 수동 미리보기를 돌려 개편이 감지되면 다음 예약 SYNC도 어차피 강등되므로 미리 해제하는 편이 일관적이다. **단 이 판단은 RG-23(승인 뒤 재강등 루프) 해소를 전제로 한다** — 지금은 승인해도 SYNC가 다시 강등된다. **[pass 10 — 전제 충족(§25 I-94)]**

**거버넌스 결정의 번복 반영** — 이전 설계(§10 · AC-KB6-2·3 · I-12·I-37)는 거버넌스 규칙을 **저장 시점**에만 강제했다(수정은 본문에 실린 필드만 검사). §25.4에는 "저장 시점만"이라는 별도 결정 문장이 없었고, 이 공백이 곧 "모드를 켜기 전에 저장된 소스"의 누수였다. 2026-09-28 PM 결정(사용자가 처음 "저장 시점만"을 선호했다가 번복)으로 **실행 시작·예약·적재 제출 직전 차단**을 더했다(§10 새 행 · §9.2 ⑥ · §9.5 · I-86). 저장 시점 거부는 그대로다(두 겹). 정합: ADR-0040 갱신 5("거버넌스 ON이면 소스의 HTML 마스킹을 끌 수 없고")는 더 강하게 집행된다(결정 1~7 불변 — ADR-0040·ADR-0044 §10에 각주). **요구사항 문서(`docs/requirements/kb-crawling.md` AC-KB6-2·3)는 문언상 "저장 거부"만 있어 확장 문장이 필요하다**(PM·requirements-analyst 소관 — 이 적용기는 고치지 않는다).

**신규 갭**

| # | 잔여 갭(현재 동작) | AC 판정 | 후속 처리 방침 |
|---|---|---|---|
| RG-23 | **[pass 10 해소 — §25 I-94 · 방식: 실행 행 `trigger` 직접 읽기 · 아래는 pass 8 시점 기록]** **새로 비율 강등이 승인으로 풀리지 않음(루프)** — `evaluateRunGuards()`는 실행의 `trigger`를 모른다(`KbSyncJob.tick()`이 `runFragment`에 `{ id, sourceId, kind }`만 넘김). 강등 뒤 관리자가 미리보기를 확인·승인하면 곧바로 SYNC(`trigger = APPROVAL`)가 돌지만 ① `priorActiveIngestedCount`(`countPreviouslyIngested()`)는 `lastIngestedAt ≠ null`인 행을 **상태 무관**하게 센다(§8.4 "실행 전 ACTIVE·적재됨"과 다름 — GONE이 된 옛 URL도 분모에 남음) ② NEW 문서는 적재되기 전까지 계속 NEW다(미리보기는 해시를 갱신하지 않음 — R-24) → 같은 비율로 다시 `NEW_RATIO` 강등. 20쪽 이상 적재된 사이트가 50% 넘게 커지거나 URL이 전면 개편되면 **관리자가 몇 번 승인해도 적재가 시작되지 않는다** | AC 직접 비해당(새로 비율을 요구하는 AC 없음 — 기존 시험은 강등까지만 검사). 그러나 EX-KB-5("관리자 확인 요청" = 확인 뒤 진행)와 §8.4 "다시 '적재 시작'을 눌러야 한다"(= 누르면 진행)의 취지 위반 · K-14의 "승인 시 재크롤 + 새로 비율 가드"가 무한 반복이 된다 → **커밋 전 재작업 권장(작음)** | 권장안(계약·스키마 변경 0): ① `runFragment`에 `trigger`를 넘기고 `trigger = APPROVAL`인 SYNC는 **새로 비율만** 면제(방금 사람이 미리보기를 보고 승인했다 — 인증 벽은 계속 적용) ② `countPreviouslyIngested()`를 `state = ACTIVE ∧ lastIngestedAt ≠ null`로(§8.4 문언) ③ 시험: 20쪽 적재 → 30쪽 추가 → SYNC 강등(NEW_RATIO) → PREVIEW → 승인 → SYNC가 적재 작업 생성 · 같은 흐름에서 로그인 폼이면 승인 SYNC도 AUTH_WALL 강등 |
| RG-24 | **[pass 10: ①③ 해소 — §25 I-96 · ②만 미해소 · ①의 링크 경로 잔여는 §25.6 RG-26②]** **리다이렉트 잔여** — ① 인증 헤더 동행 판정(`visitOne` `headersFor`)이 `urlHostname`(포트 제외)만 비교해 같은 호스트의 **다른 포트**로 가는 홉에도 고정 헤더가 붙는다(R4 N-12 — 같은 머신의 다른 서비스로 자격증명 전달 · 둘 다 허용 호스트 안이라 출구·주소 판정은 통과) ② 리다이렉트 원래 URL 행은 검증자가 없고 목적지 요청(홉 ≥ 1)에는 조건부 헤더를 보내지 않아 매 실행 목적지 본문을 다시 받는다(해시로 걸러져 적재 0 — 대역폭·간격만) ③ 적재 재수집 타임아웃은 홉별이 아니라 문서 종류 기준 1값(HTML 문서가 파일로 리다이렉트되면 파일에 ×1 — 대개 `NETWORK_ERROR` 재시도로 흡수) | AC 비해당(AC-KB6-4는 로그·응답 무유출 — 충족) · ①은 §6.9 "시작 주소와 같은 호스트일 때만"의 문언은 지키지만 "자격증명 누출 방지" 취지에 못 미친다 | ① 1차 권장: `new URL(u).host`(포트 포함) 비교로 바꾼다(1줄 — 기본 포트는 정규화로 빠지므로 `http→https` 상향 홉은 `host`가 같아 헤더 유지) ② 2차: 목적지 행의 검증자를 홉 1 요청에 싣는 방식 검토 ③ 2차: 적재 `timeoutMs`도 크롤과 같은 `(url) =>` 함수로 |
| RG-25 | **[pass 10 해소 — §25 I-93 · 아래는 pass 8 시점 기록]** **HTML 제목 비마스킹·무절단(이번 대조에서 새로 찾음)** — `run-extract-job.ts`는 본문(`normalizedText`)만 `maskPii`로 마스킹하고 `title`은 `extractHtml()`의 `<title>` 원문을 그대로 돌려준다. 그 값이 ① `KbDocument.title`에 **마스킹·200자 절단 없이** 저장되고(크롤 `markVisited` · 문서 목록 API로 노출) ② 적재 파일 머리 줄 `제목: …`과 HTML 형식의 `<title>`로 **외부 RAG에 비마스킹 전송**된다(`kb-ingest.runner.ts` → `buildIngestDocument`). `piiMask = true`·거버넌스 ON이어도 같다 | **AC-KB6-1 위반(제목에 개인정보가 있을 때 — "적재 파일 본문에서 마스킹")** · 요구사항 데이터 모델("`title`은 … 마스킹 후 저장") · 이 설계 §3.1·§10 · ADR-0040 갱신 4("제목은 마스킹 후 저장") 미집행 → **커밋 전 재작업 필요** | 권장안(계약·스키마 변경 0): 작업 스레드 `runExtractJob()`의 HTML 분기에서 `req.piiMask`면 제목도 같은 `maskText()`로 마스킹하고 건수를 `piiMaskedCount`에 합산 · 마스킹 여부와 무관하게 **200자 절단**(요구 "≤200") · 크롤 저장·적재 머리 줄이 같은 값을 쓰므로 한 곳 수정으로 두 경로가 맞춰진다 · 지문(`ingestFingerprint`)은 본문 해시 기준이라 불변(이미 적재된 문서의 제목 교정은 다음 CHANGED 때 반영 — 즉시 교정이 필요하면 FULL_RESEND) · 시험: 제목에 휴대전화 번호 → DB `title`·적재 DOCX 머리 줄 모두 마스킹 · 300자 제목 → 200자 |

**사용자 결정 대기(오케스트레이터 → 사용자)**

| # | 결정할 것 | 현재 동작 | 대안 | architect 권장 |
|---|---|---|---|---|
| U-1 | 거버넌스 차단에 **PREVIEW까지** 포함할지 | 포함 — 수동·예약 PREVIEW도 `409`·건너뜀 | PREVIEW만 허용(외부 RAG 송신 0) | **현행 유지** — PREVIEW도 크롤 결과(제목 등)를 DB에 남기고, 마스킹 끔 소스면(RG-25 수정 뒤에도) 비마스킹 제목이 저장된다. 해소 경로(마스킹 켜기)가 어차피 `configVersion`을 올려 새 미리보기를 요구하므로 차단 비용이 작다 |
| U-2 | 예약 대기 정책 | 걸린 예약은 건너뛰고 `nextRunAt` = 다음 예약 시각 — 설정을 고쳐도 다음 예약까지 대기(수동 실행은 즉시) | 소스를 규칙에 맞게 저장하면 `nextRunAt`을 지금으로 당겨 다음 tick에 실행 | **현행 유지** — 마스킹·원본 파일 설정 변경은 `configVersion`을 올려 다음 실행이 어차피 PREVIEW(사람 확인)라 즉시 재예약의 이득이 작다 · 수동 실행으로 즉시 가능 |
| U-3 | 적재 게이트 종결(`terminateIfGovernanceBlocked`)에 **감사 기록**을 더할지 | 로그 1줄 + 실행 `failureCode`(K-22) | 감사 `STATUS_CHANGE` `[적재 차단] …` 실행당 1건(`cancelRunAndRelease` 성공 인스턴스만) — 적재 러너에 `AuditLogService` 주입(`audit-logs` 모듈 — KB-13 `governance/**` 금지와 무관) | **추가 권장 → pass 10 채택·구현 완료**(§25 I-95 — 러너에 감사 주입 대신 `KbSourcesService.terminateRunForGovernance()`가 CAS 승자만 기록) — 예약 건너뜀은 감사가 있는데 적재 차단은 없어 거버넌스 모드 설치의 추적이 비대칭이다(작은 수정 · 계약 변경 0) |
| U-4 | 인증 벽 **오탐 우회** 수단 | 없음 — 승인 뒤 SYNC도 가드를 받아 같은 사이트면 다시 강등(K-20) | (a) 승인 SYNC는 인증 벽도 면제 (b) 소스별 "인증 벽 판정 끄기" 옵션(계약 변경) | **현행 유지(1차)** — 오탐은 적재를 멈추는 안전한 방향이고 대표 사례(SPA 빈 셸)는 원래 수집 대상 밖이다. 실제 오탐 사례가 나오면 (b)를 2차로 |

**알려진 한계(pass 7·8 · §20에 K-19~K-23으로 등록)** — K-19 리다이렉트 강제 대기 비용(최대 약 900초 조각 초과 — pass 9 해소) · K-20 인증 벽 오탐·미탐 · K-21 FULL_RESEND 기존 중복 행 · K-22 적재 게이트 종결 감사 없음(pass 10 해소) · K-23 시험 스위트 부하 민감성.

**시험 안정성 기록 판단** — 부하 민감성은 No.43 제품 결함이 아니라 기존 그룹 시험의 타이밍 의존 설계 문제(자동시험 전략 §13.x·§16.5·§19와 같은 부류)이므로 이 설계서에는 K-23으로만 남긴다. 반복 실행 결과·실패 파일 목록·후속 배정은 이 그룹의 test-automation 단계가 `docs/04-test/자동시험_전략.md`의 No.43 절에 기록한다(시험 문서는 test-automation 소관).

**문서 간 정합 확인 결과** — ① §8.4 적용 대상: 위 정리로 확정(본문 정정) ② §6.8·§3.5의 "파일 ×4(최대 60초)": 기본값에서만 맞는 서술이라 정정 ③ §10 저장 시점 결정: 확장(번복) 반영 · 요구사항 AC-KB6-2·3 문언 보완 필요(PM) ④ ADR-0044 §7·§10·결과·구현 상태, ADR-0040 갱신 5: 각주 반영 ⑤ 화면 설계서: 실패 코드 라벨 2 · 실행 시작 409(`GOVERNANCE_*`) 사전 비활성 · PREVIEW 인증 벽 경고 표기 — frontend 후속(화면 설계서 §14 pass 7·8 행) · 콘솔 원본 파일 라벨("…원본 파일 전달을 꺼 주세요")이 서버 409 문구("…끄거나 서버 운영자에게 허용을 요청해 주세요")와 달라 정합 권장 ⑥ `기능요구사항.md` 비고: 갱신 ⑦ 봉인 KB-14b는 이 설계의 "nullable만" 서술보다 넓게(`DEFAULT` 있는 `NOT NULL` 허용) 구현됐다 — 사실 기록(I-87).

**마이그레이션 영향(I-85)** — `20260928120000_kb_document_observed_hash`: nullable `ADD COLUMN` 1 · 인덱스 0 · 백필 0 · 기존 행 null(= 이번 실행 관측 없음 — 호환 문제 0) · 원시 부분 유니크 4 보존 · 롤백 = 코드만 되돌림. 개발·시연 DB는 `prisma migrate deploy`만 하면 된다(데이터 초기화 불요 — 다음 실행이 채운다).

### 25.6 백엔드 pass 9·10 반영 — 현재 상태 · RG-23·RG-25 해소 · 신규 갭 RG-26 · 사용자 결정 · 잔여 갭 요약표 (2026-09-28 · system-architect)

> **[pass 11·12·웹 후속 갱신]** 이 절은 pass 10 시점 기록이다. 현재 상태는 §25.7 — RG-26 해소(U-5 (b) 채택 · §25 I-104) · K-26 해소(I-99) · "커밋 전 권장(시험)" DOCX 제목 시험 해소(I-106) · "후속(화면)" 2건 해소(I-105) · 신규 RG-27(콘솔 승인 거절 문구)·RG-28(`http://` 링크 첫 요청 인증 헤더) · K-27·K-28. **[pass 13·웹 RG-27 — RG-27(I-108)·RG-28(I-107) 해소 · 현재 판정은 §25.8]**

pass 9(R5 지적 H-1·L-1·M-3·M-4·L-3·L-7)와 pass 10(RG-25·RG-23·U-3·RG-24①③) 코드(`kb-sync/lib/observed-hash.ts`·`run-guards.ts`·`run-extract-job.ts`·`url-normalize.ts`·`scope-match.ts`·`bounded-map.ts` · `kb-sync/core/kb-run.store.ts` · `kb-sync/crawl/kb-redirect-follow.ts` · `kb-sync/engine/kb-crawl.runner.ts`·`kb-ingest.runner.ts` · `kb-sync/kb-sources.service.ts` · 콘솔 `KbSourceOverviewPage.tsx`·`KbStringListField.tsx`·`messages.ts`)를 다시 대조했다. "AC 판정"의 뜻은 §25.1과 같다.

- **AC에 걸려 커밋 전 재작업이 필요한 항목: 없음.** RG-25(AC-KB6-1)는 해소 — 제목이 본문과 같은 규칙으로 마스킹된 뒤 저장·전송되고 건수가 `piiMasked`에 합산된다(`kb-crawl-pass10` RG-25 시험). AC-KB6-1("휴대전화 번호가 있는 HTML → 적재 파일 본문에서 마스킹 · `piiMasked ≥ 1`")의 대상(본문·제목)은 충족이고, 남는 `출처:` URL 비마스킹(K-25)은 AC 문언(HTML 내용) 밖이다. 단 적재 형식이 DOCX일 때 머리 줄을 압축 해제해 확인하는 시험이 없으므로 test-automation 단계에서 AC-KB6-1 시험에 "DOCX 형식 머리 줄 `제목:` 마스킹" 1건 보강을 권장한다.
- **커밋 전 권장(작음 · AC 밖)**: **RG-26②**(링크로 발견한 같은 호스트 다른 포트 URL의 첫 요청에 인증 헤더 동행 — pass 10의 RG-24① 수정은 리다이렉트 홉만 덮는다). U-5에서 (b)를 채택하면 함께 닫힌다.
- **사용자 결정**: RG-26①(범위에 포트를 넣을지 — U-5) · U-1·U-2·U-4 현행 유지 확인.
- **2차 가능(그대로)**: RG-2 · RG-3(클램프로 부분 완화) · RG-11 잔여 · RG-13 · RG-14 · RG-17 잔여(500쪽 실측) · RG-22②③⑥ · RG-24②.

**pass 8 갭·한계의 현재 상태**

| # | pass 10 상태 | 남은 것 |
|---|---|---|
| RG-23 | 해소(I-94 — 승인 SYNC 새로 비율 면제 · 분모 ACTIVE · 첫 적재 판정 분리) | 조각 간 분모 변동(K-26) · 미리보기~승인 사이 급증 재검사 없음(K-14 정정) |
| RG-24① | 리다이렉트 홉 해소(I-96) | 홉 0(링크)·범위는 포트 무구분 → RG-26 |
| RG-24② | 미해소 | 리다이렉트 원래 URL 검증자(2차) |
| RG-24③ | 해소(I-96) | `maxBytes`는 `doc.kind` 기준 1값 — 종류가 바뀌면 어차피 `SKIPPED(EXCLUDED_AT_INGEST)`(I-78③)라 영향 없음 |
| RG-25 | 해소(I-93) | `출처:` URL 비마스킹(K-25) · DOCX 머리 줄 시험 보강 권장 |
| RG-17 잔여 | 강제 대기 비용(K-19) 해소(I-92) | 500쪽 10분 예산 실측 |
| K-19 | 해소(I-92) | 재개 상태 유실 시 GET 1회 중복(K-24) |
| K-20 | 갱신(I-89 — 빈 본문 미기록 · 로그인 신호 · 분모 = 방문 HTML 전체) | URL만 보는 로그인 신호의 미탐·오탐 · 첫 크롤 짧은 공통 문구(PREVIEW 기록만) |
| K-21 | 갱신(I-91) | 리다이렉트 원래 행이 된 옛 적재 문서의 외부 사본 정리 표시 없음(2차) |
| K-22 | 부분 해소(I-95 — 감사 추가) | 외부 접수 작업 계속·기적재 문서 불변(K-18과 같음) |

**R5 지적(pass 9) 반영 판단** — ① H-1: 분모를 "방문 HTML 전체"로 되돌린 것은 증분 크롤에서 304 정상 문서가 분포를 희석해야 한다는 점에서 타당하다(세션 만료면 조건부 요청이 304가 아니라 200 로그인 화면·3xx를 받으므로 벽은 여전히 지문으로 잡힌다). 하한 `hashed ≥ 10`은 지문이 거의 없는 실행(대부분 304)에서 소수 지문이 판정을 좌우하지 않게 하는 이중 장치다. `R:`를 분포에서 뺀 것은 정상 통합 리다이렉트 오탐 제거이며, 대가인 "로그인 신호 없는 로그인 페이지로의 3xx 수렴" 미탐은 K-20에 기록했다 ② L-1: 강등 크롤의 스윕 오염 제거 — AC-KB3-4(2회 규칙)를 강화하는 방향 ③ M-3: FULL_RESEND 범위 축소 + 적재 범위 방어 = §9.5 원 설계 이행 ④ M-4: 라이브락 해소 방식을 강제 대기에서 진행 상태 저장으로 바꿔 K-19 비용을 없앴고 스키마 변경도 없다 — 인스턴스 메모리라 인스턴스를 옮기면 홉 0 재요청 1회(K-24) · 상한 200 축출은 현재 한도에서 반복 재요청을 만들지 않는다(K-24 코드 판단).

**신규 갭**

| # | 잔여 갭(현재 동작) | AC 판정 | 후속 처리 방침 |
|---|---|---|---|
| RG-26 | **[pass 12 해소 — §25 I-104 · U-5 (b) · 아래는 pass 10 시점 기록]** **포트가 범위·인증 헤더 판정에 들어가지 않음(§6.2 1단계 "포트는 시작 주소에 명시된 것만" 미구현)** — ① `allowedHosts`는 `deriveAllowedHosts()`가 `URL.hostname`만 저장하고, 범위 검사(`isInScope` — `url.hostname`)·fetcher 허용 호스트 검사·첫 요청 인증 헤더 판정(크롤 `applyAuthHeader`·적재 `applyAuth` — `urlHostname`)이 모두 포트를 비교하지 않는다 → 같은 호스트의 다른 포트로 가는 **링크·리다이렉트가 범위 안**으로 처리되어 방문·적재된다(출구 게이트·DNS 주소 판정은 요청마다 적용되므로 SSRF 방어선은 그대로 — 허용 주소의 다른 서비스 포트가 열릴 뿐) ② 그 결과 **링크로 발견한 다른 포트 URL의 첫 요청(홉 0)에는 인증 헤더가 실린다** — pass 10의 `isSameHostPort()`는 리다이렉트 홉(≥ 1)에만 적용(`kb-crawl-pass10` 시험도 "다른 포트 홉은 헤더 없이 요청은 나간다"를 확인) | AC 비해당 — 요구사항 FR-KB1-2("호스트 집합")·FR-KB1-5("같은 호스트로만")·AC-KB2-4("호스트 B로 302")는 호스트 이름 단위라 문언상 충족. 그러나 ①은 이 설계 §6.2·§3.1(`호스트[:포트]`)과 불일치, ②는 §6.9 "자격증명 누출 방지" 취지와 R4 N-12(같은 머신 다른 서비스로 자격증명)를 절반만 해소 → ② **커밋 전 권장(작음)** · ① **사용자 결정(U-5)** | ② 권장안(스키마·계약 0 · 2파일 + 시험 1): 인증 헤더 판정을 "시작 주소·사이트맵 URL의 `urlHostPort` 집합에 속함"으로 바꾼다(홉 0 포함 · 크롤 `applyAuthHeader`·적재 `applyAuth` — 집합은 소스의 `seedUrls`·`sitemapUrls`에서 런타임 파생) · 시험: 시작 주소 `https://a/`, 링크 `https://a:8443/x` → 요청은 나가도 헤더 없음 · ① 선택지는 U-5 |

**사용자 결정(오케스트레이터 → 사용자)** — pass 10 기준 갱신

| # | 결정할 것 | 현재 동작 | 대안 | architect 권장 |
|---|---|---|---|---|
| U-1 | 거버넌스 차단에 PREVIEW까지 포함할지 | 포함(변경 없음) | PREVIEW만 허용 | **현행 유지 확인 요청** — RG-25 해소 뒤에도 `piiMask = false` 소스는 제목이 절단만 되고 비마스킹으로 저장되므로, 거버넌스 ON에서 그 저장을 막는 지점은 PREVIEW 차단뿐이다 |
| U-2 | 예약 대기 정책 | 걸린 예약은 건너뛰고 다음 예약 시각까지 대기(변경 없음) | 규칙에 맞게 저장하면 즉시 재예약 | **현행 유지 확인 요청**(근거 §25.5 그대로) |
| U-3 | 적재 차단 감사 | **pass 10 채택·구현 완료(I-95)** | — | 결정 불요 |
| U-4 | 인증 벽 오탐 우회 수단 | 없음(승인 SYNC도 인증 벽은 면제 없음) | (a) 승인 SYNC는 인증 벽도 면제 (b) 소스별 판정 끄기 옵션(계약 변경) | **현행 유지 확인 요청** — pass 9 재정의로 대표 오탐(빈 SPA 셸·정상 통합 리다이렉트)이 줄었다. 남은 오탐(짧은 공통 문구 셸 · `sso`·`auth` 토큰이 든 안내 페이지로의 통합 리다이렉트)은 드물고 적재를 멈추는 안전한 방향 — 실제 사례가 나오면 (b)를 2차로 |
| U-5 | **[pass 12 — (b) 채택·구현(PM 기본안) · §25 I-104]** **범위에 포트를 넣을지(RG-26①)** | 호스트 이름만 — 같은 호스트의 다른 포트도 범위 안(리다이렉트 홉 헤더만 포트 구분) | (a) 현행 유지 + 설계 §6.2·§3.1 문구를 구현에 맞춤(RG-26②만 수정) (b) **런타임 파생**: `parseSourceRow()`가 `seedUrls`·`sitemapUrls`에서 허용 출처(`host[:port]` — `URL.host`) 집합을 만들어 `ScopeConfig`에 더하고 `isInScope`·fetcher 허용 검사·인증 헤더 판정이 `URL.host`로 비교 — 스키마·계약·마이그레이션 0 · `allowedHosts`(호스트 이름)는 호스트 겹침 판정·데이터 지도·저장 검증용으로 그대로 (c) `allowedHosts` 저장 형식을 `host[:port]`로 변경 — 저장값·호스트 겹침 판정·데이터 지도·거버넌스 출구 허용 목록 대조가 연쇄로 바뀜(기존 행 재계산 필요) | **(b) 권장** — 원 설계(§6.2 · 기존 결정)를 가장 작은 변경으로 이행하고 RG-26②도 함께 닫힌다(범위 밖 포트는 요청 자체가 없음 · 다른 포트로의 리다이렉트는 `REDIRECT_OUT_OF_SCOPE`). 영향: 같은 호스트의 다른 포트 문서를 일부러 수집하던 소스는 그 포트 URL을 시작 주소나 사이트맵에 넣어야 한다(미배포라 운영 데이터 영향 0 · 개발 DB의 다른 포트 행은 다음 SYNC에서 "다시 발견되지 않음" → 2회 뒤 GONE/정리 필요). (b)를 채택해도 pass 10의 `isSameHostPort()`는 방어 중복으로 남겨도 무방 |

**문서 간 정합 확인 결과** — ① 설계 §6.2·§3.1 "포트" 서술 ↔ 구현(호스트 이름만): 불일치 — RG-26으로 기록하고 문구에 미구현 표시 ② §8.4 인증 벽: pass 8 분모 서술을 pass 9 재정의로 대체 표시 ③ §8.3·§9.3 종결 순서(스윕 → 가드)를 가드 → 스윕으로 정정 ④ §6.4 pass 7·8 ① 강제 대기와 §16·§20 K-19 비용: 폐기·해소 표시(§6.8 RG-3 임시 대체 클램프는 유지) ⑤ §10·§3.1·ADR-0040 갱신 5 각주 ⓒ의 RG-25 결함: 해소 표시 ⑥ §9.5·§10·§20 K-22·§25.5 U-3: 해소·채택 표시 ⑦ §9.8 FULL_RESEND 대상: M-3로 갱신 · §20 K-21 갱신 ⑧ §20 K-14 "승인 시 새로 비율 가드가 급변을 다시 막는다"는 RG-23 해소로 더 이상 사실이 아님 — 정정 ⑨ 화면 설계서 §3.2(목록 입력 id·도움말 연결)·§3.3(미리보기 강등 경고·승인 오류 해석)·§14(pass 9·10 행) 반영 · 콘솔 원본 파일 라벨 ↔ 서버 409 문구 정합(§25.5 ⑤ 해소) · 거버넌스 버튼 사전 비활성과 실행 이력 PREVIEW 강등 구분 문구는 여전히 frontend 후속 ⑩ **요구사항 문서(`docs/requirements/kb-crawling.md`)** — EX-KB-5 "관리자 확인" 뒤 승인 SYNC의 새로 비율 면제, AC-KB6-2·3의 실행·적재 시점 확장(§25.5)은 requirements-analyst 소관(이 적용기는 고치지 않음) ⑪ `기능요구사항.md` 비고·ADR-0044 §7 각주·구현 상태·`docs/05-ops/자동배포.md` §5.7(적재 차단 감사) 갱신.

**마이그레이션 영향** — pass 9·10은 스키마·마이그레이션·계약(shared-types)·환경변수 변경 0(새 값 `REDIRECT_RESUME_TTL_MS`·`MAX_TRACKED_RESUMES`는 코드 상수). 기존 `KbSyncRun.trigger` 열을 새 용도(승인 SYNC 면제)로 읽을 뿐 값 체계는 불변. `observedHash` 값 체계가 바뀌었지만(`RL:` 추가 · 빈 본문·신호 없는 범위 밖 리다이렉트 미기록) 매 실행 `seedFrontier()`가 다시 방문하는 행을 비우고 다시 채우며 판정은 `seenRunId = 실행` 행만 보므로 기존 DB 호환 문제 0(초기화 불요).

**잔여 갭 요약표(§25 이후 전체 — 커밋 전 필수 / 권장 / 사용자 결정 / 후속)**

| 구분 | 항목 | AC | 담당 · 처리 |
|---|---|---|---|
| 커밋 전 필수 | 없음 | — | — |
| 커밋 전 권장(작음 · 코드) | RG-26② 링크로 발견한 다른 포트 URL 첫 요청의 인증 헤더 | 비해당(FR-KB1-5 취지 · §6.9) | backend-implementer 1회(2파일 + 시험 1) — U-5 (b) 채택 시 함께 닫힘 |
| 커밋 전 권장(시험) | AC-KB6-1 — DOCX 형식 적재 파일 머리 줄 `제목:` 마스킹 확인 1건 | AC-KB6-1 시험 보강 | test-automation |
| 사용자 결정 | U-5(RG-26① 포트 범위) · U-1·U-2·U-4 현행 유지 확인 | 비해당 | 오케스트레이터 → 사용자 |
| 후속(요구사항) | AC-KB6-2·3 실행·적재 시점 확장 문장 · EX-KB-5 승인 SYNC 새로 비율 면제 명시 | — | requirements-analyst(병렬 수정 중인 요구사항 문서) |
| 후속(시험 문서) | `docs/04-test/자동시험_전략.md` No.43 절 — 간헐 실패 목록(`hybrid-cs` G-8 · 웹 `HandoffHistoryDetailPage.spec.tsx` · pass 8 관찰 5종)과 고정 방침(발사 후 망각 경합 = 폴링 헬퍼 · 부하 상한 = `--maxWorkers`) — §20 K-23 | — | test-automation |
| 후속(화면) | 거버넌스 규칙 위반 버튼 사전 비활성 + 보이는 사유 · 실행 이력 PREVIEW 강등 구분 문구(화면 설계서 §14 pass 7·8 행 ②③) | 비해당 | frontend-implementer |
| 2차 | RG-2 · RG-3(클램프 부분 완화) · RG-11 잔여 · RG-13 · RG-14 · RG-17 잔여(500쪽 실측) · RG-22②③⑥ · RG-24② · K-21 옛 이름 사본 정리 표시 · K-24(상한 연동) · K-25(`출처:` URL 마스킹) · K-26(분모 고정) | 비해당 | 재검토 트리거 |

### 25.7 백엔드 pass 11·12 · 웹 후속 반영 — 현재 상태 · RG-26 해소 · `observedHash` 값 체계 · 신규 갭 RG-27·RG-28 · 최종 판정 (2026-09-28 · system-architect)

pass 11(R6 지적 M-A·M-B·L-A·L-B·L-C·L-E · 기록만 L-D)·pass 12(RG-26 / U-5 (b) — PM 기본안)·웹 후속 코드(`kb-sync/lib/allowed-origins.ts`·`observed-hash.ts`·`parse-source-row.ts`·`scope-match.ts`·`url-normalize.ts`·`run-guards.ts` · `kb-sync/core/kb-run.store.ts` · `kb-sync/crawl/kb-redirect-follow.ts`·`kb-crawl-http.fetcher.ts` · `kb-sync/engine/kb-crawl.runner.ts`·`kb-ingest.runner.ts` · `kb-sync/kb-runs.service.ts` · 콘솔 `governanceBlock.tsx`·`KbSourcesPage.tsx`·`KbSourceOverviewPage.tsx`·`KbDocumentListPage.tsx`·`KbRunTable.tsx`·`components/KebabMenu.tsx`·`constants/messages.ts` · `schema.prisma` 주석)를 다시 대조했다. "AC 판정"의 뜻은 §25.1과 같다.

**최종 판정**

- **[pass 13 해소 — 현재 판정은 §25.8: 커밋 전 필수 0건]** ~~커밋 전 필수: 1건 — RG-28~~(아래 신규 갭). AC 문언상 명백한 위반은 아니지만(AC-KB2-9는 리다이렉트 경로이고, `https→http` 하향 리다이렉트는 거부되어 충족), FR-KB1-5가 "같은 출처 = 스킴별 기본 포트를 채운 호스트+포트"로 정의해 `https://a`(a:443)와 `http://a`(a:80)를 다른 출처로 보는데 구현은 둘을 같게 보고, 그 결과 **자격증명이 평문 HTTP로 나갈 수 있다**(§6.9 "자격증명 누출 방지"의 정면 위반 · 사내 사이트의 `http://` 절대 링크는 흔하다). 수정이 작고(순수 함수 1개 + 시험) 스키마·계약 변경이 없으므로 커밋 전에 닫는다.
- **[웹 RG-27 해소 — §25 I-108]** ~~커밋 전 권장(작음 · 웹)~~: RG-27(강등 뒤 옛 미리보기 승인 거절의 콘솔 사전 비활성·문구).
- **닫힌 것**: RG-26 ①②(I-104 — 범위·fetcher·첫 요청 헤더가 host:port 구분) · U-5 → (b) 채택 · RG-24① 링크 경로 잔여(I-104) · K-26(I-99) · §25.6 "커밋 전 권장(시험)" DOCX 제목 마스킹 시험(I-106 — 구현 결함 없음) · §25.6 "후속(화면)" 거버넌스 사전 비활성·PREVIEW 경고 구분(I-105) · R6 M-A·M-B·L-A·L-B·L-C·L-E(I-99~I-103).
- **2차(그대로)**: RG-2 · RG-3(클램프 부분 완화) · RG-11 잔여(Content-Type 판정 — L-E 주석으로 현재 상태 고정) · RG-13 · RG-14 · RG-17 잔여(500쪽 실측) · RG-22②③⑥ · RG-24② · K-21 · K-24 · K-25 · K-27 표시 · K-28 스킴 정규화.

**R6 지적(pass 11) 반영 판단** — ① M-A: 분모를 실행 시작 값으로 고정한 것은 §8.4 문언("실행 전")의 이행이며 새 컬럼 없이 실행 행 JSON의 내부 키로 처리해 계약·마이그레이션 영향이 없다. 첫 조각이 `CRAWLING`이 아닐 때(경합)는 기록하지 못하고 다음 조각이 다시 세지만, 그 시점에는 아직 문서 전환이 없으므로 값이 같다 ② M-B: 목적지 행을 분모에서 빼고 원래 행만 세는 방식이 리뷰어 두 안보다 낫다(§8.4 pass 11 ④의 반례 2개 — 시험으로 고정). 분모 정의가 "방문 HTML 전체"에서 "− `RD:` 행"으로 바뀐 것은 이중 계수 제거일 뿐 희석 원리(304 정상 문서)는 그대로다 ③ L-A: 오탐을 줄이면서 미탐을 늘리지 않는 쪽(단독 조각·문서 단어 없는 조각은 신호 유지 · `help`·`support` 제외)으로 판단이 일관된다 — 남는 오탐·미탐은 K-20 ④ L-B: 새 오류 코드 없이 기존 `PREVIEW_STALE`를 재사용한 것은 계약 보존 면에서 타당하나, 콘솔이 그 코드를 "설정이 바뀌어…"로 해석해 원인이 틀리게 보인다(RG-27) ⑤ L-C: 재개 경로도 새 홉과 같은 범위 검사를 받게 되어 §6.4 "매 단계 재검증"과 일치 ⑥ L-D: 기록만 — K-27.

**`observedHash` 값 체계(현재 · 한 곳 정리 — `lib/observed-hash.ts`·`schema.prisma` 주석과 같음)**

| 값(접두) | 기록하는 행 | 만드는 함수 | 해시 입력 | 분자·하한(`hashed`·`max`) | 분모(`visited`) | 다른 용도 |
|---|---|---|---|---|---|---|
| (접두 없음) 본문 sha256 | HTML 본문을 추출한 행(NEW·CHANGED·UNCHANGED·`NO_BODY`·`NOINDEX`) — 본문이 비면(공백뿐) 기록 안 함 | `bodyObservedHash` | 정규화 본문 | 셈 | 셈 | — |
| `RL:` | 리다이렉트 원래 행 · 최종 목적지에 로그인 신호 있음 | `redirectOriginHash` | 목적지 host(포트 포함)+path — **쿼리 제거**(pass 11) | 셈 | 셈 | 원래 행 표식(FULL_RESEND 제외 — `isRedirectOriginHash`) |
| `R:` | 리다이렉트 원래 행 · 목적지에 로그인 신호 없음(정상 통합·개편 · `TYPE` 제외 원래 행 포함) | `redirectOriginHash` | 정규화 최종 URL(쿼리 허용 소스는 쿼리 포함) | **제외** | 셈 | 원래 행 표식(FULL_RESEND 제외) |
| `RD:`(pass 11 신설) | 로그인 신호 목적지에 리다이렉트로 도달해 그 자리에서 기록된 **목적지 행** | `redirectLoginTargetHash` | 목적지 host+path — 쿼리 제거 | **제외** | **제외**(방문 HTML − `RD:`) | 본문 해시 대신 기록 |
| `X:` | 범위 밖 리다이렉트 행 · 목적지에 로그인 신호 있음 | `outOfScopeTargetHash` | 목적지 host(포트 포함)+path — 쿼리 제거 | 셈 | 셈 | 로그인 신호 없으면 미기록 |
| (null) | 파일 행 · 304 · 오류 · 빈 본문 · 신호 없는 범위 밖 리다이렉트 · 하향 리다이렉트 · 이번 실행 미방문 | — | — | 제외 | HTML 방문 행이면 셈(파일 행은 `kind = HTML` 조건 밖) | — |

- 판정: `hashed ≥ 10 ∧ max ÷ visited ≥ 0.8` → `AUTH_WALL`. `visited` = 이번 실행(`seenRunId`) `kind = HTML ∧ visitState = VISITED` 행 수 − `RD:` 행 수 · `hashed` = 분자 대상 지문 행 수 · `max` = 분자 대상 지문의 최빈 수. 적용 대상(§8.4 pass 8 정정): SYNC·FULL_RESEND 강등 · PREVIEW 기록만 · 승인 SYNC도 면제 없음.
- 매 실행 `seedFrontier()`가 재방문 행을 null로 비우고 방문이 다시 채운다 · 값은 해시뿐(원문 비저장 — KB-10).

**신규 갭**

| # | 잔여 갭(현재 동작) | AC 판정 | 후속 처리 방침 |
|---|---|---|---|
| RG-27 | **[해소 — 웹 · §25 I-108 · §25.8 — 아래는 발견 시점 기록 · 409 문구는 권장안(`reviewRequiredReason`으로 선택) 대신 서버 문구 우선으로 구현]** **강등 뒤 승인 조건(I-102)의 콘솔 미반영** — 소스가 SYNC·FULL_RESEND로 강등되면 개요의 "최근 성공 미리보기"는 강등 전 실행인데 "적재 시작"이 활성으로 보이고(화면 설계서 §3.3.1 "자동 강등 → 활성" 행 그대로), 누르면 서버 409 `PREVIEW_STALE`을 콘솔 `resolveApproveErrorText()`가 `approveButtonDisabledReason.PREVIEW_STALE` "설정이 바뀌어 이전 미리보기가 유효하지 않습니다…"로 보여 준다 — 해결 방법(미리보기 다시 실행)은 맞지만 원인(설정 변경)은 틀림. 서버 문구도 "내용이 크게 바뀌어…"로 시작해 인증 벽 강등에는 맞지 않는다 | 비해당 — AC-KB7-2는 전송 전제 미충족 비활성만 요구 · 서버가 막으므로 안전. UIUX §7(오류 원인 안내) 정확성 문제 | **커밋 전 권장(작음 · 웹)**: `KbSourceOverviewPage` — `source.reviewRequiredReason`이 있고 실행 목록(최근 20건 — 강등 실행이 미리보기보다 나중이면 목록 안에 있다)에서 강등을 만든 실행(SYNC·FULL_RESEND의 `demotedReason` 있음 · PREVIEW의 `NEW_RATIO`)의 `finishedAt`이 `latestPreviewRun.finishedAt`보다 늦으면 "적재 시작" 비활성 + 보이는 사유(웹 로컬 사유 키 1개 — 예: "적재가 보류된 뒤 새 미리보기가 필요합니다. 지금 미리보기를 실행해 결과를 확인하세요.") · 409 `PREVIEW_STALE` 수신 시 `reviewRequiredReason`이 있으면 같은 문구 · 시험 1~2 · 계약 변경 0. 선택: 서버 문구를 "자동 점검으로 적재가 보류된 뒤에 확인한 미리보기가 아닙니다…"로 중립화(문구 1줄 — 콘솔은 사용하지 않음) |
| RG-28 | **[해소 — pass 13 · §25 I-107 · §25.8 — 아래는 발견 시점 기록 · 권장안의 "호출부 무변경"과 달리 시그니처를 `(origins: AuthOrigins, url, startUrl?)`로 바꿔 호출부 2곳이 함께 바뀌었다]** **출처 비교가 스킴을 보지 않아 평문 `http://` 첫 요청에 인증 헤더가 실린다** — `urlHostPort()` = `URL.host`는 스킴 기본 포트를 지우므로 `https://a/`(a:443)와 `http://a/`(a:80)가 같은 값 `a`가 된다. `https://a/` 시작 주소의 `STATIC_HEADER` 소스에서 페이지·사이트맵이 같은 호스트의 `http://a/x`를 내놓으면 범위 안(스킴은 범위 조건이 아님)이고 `canSendAuthTo()`도 통과해 **첫 요청(홉 0)에 헤더가 평문으로** 나간다(크롤 `applyAuthHeader` · 적재 재수집 `applyAuth` 모두). 하향 리다이렉트(`https→http`)는 §6.4에서 거부되므로 리다이렉트 경로는 해당 없음. pass 12 이전(호스트 이름 비교)부터 있던 동작이며 이번 대조에서 새로 찾음 | FR-KB1-5 정의(스킴별 기본 포트를 채운 호스트+포트) 위반 · AC-KB2-9②가 `http://a.example/…`를 "다른 출처"로 명시(리다이렉트 문맥이라 문언상 충족) · §6.9 자격증명 누출 방지 취지 위반 → **커밋 전 필수(architect 판정)** | 권장안(스키마·계약 0 · `lib/allowed-origins.ts` 1파일 — 호출부 무변경 + 시험 3): `canSendAuthTo()`에 "요청 URL이 `http:`이면 시작 주소·사이트맵 중 **같은 출처의 `http:` URL이 명시돼 있을 때만**" 조건 추가(허용 출처와 나란히 평문 허용 출처 집합을 계산하거나 `scheme//host` 집합을 함께 계산) — `https:` 요청은 현행(`http→https` 상향 유지 — §6.4·§6.9 설계 결정) · 홉 조건(`isSameHostPort`) 유지. 시험: ① 시작 `https://a/` · 링크 `http://a/x` → 요청은 나가도 헤더 없음(크롤·적재 각 1) ② 시작 `http://a/`(운영자가 평문으로 명시 등록) → `http://a/x` 헤더 있음 ③ 시작 `http://a/` → `https://a/` 상향 홉 헤더 유지. **[pass 13 — ①②③ 모두 단위(`allowed-origins.spec.ts`)·통합(`kb-crawl-pass13` (a)·(c)·(d) — 크롤·적재 양쪽)으로 고정 · 추가로 (b) 사이트맵 URL `http:` 명시 · (e) `:443` 표기 · 홉 하향 이중 방어]** 범위(스킴 무관)는 바꾸지 않는다(중복 적재 K-28은 2차). 요구사항 FR-KB1-5 문구 정합은 아래 ⑤ |

**사용자 결정 · PM 확인 현황(오케스트레이터 → 사용자)**

| # | 결정할 것 | 현재 동작 | architect 권장 |
|---|---|---|---|
| U-1 | 거버넌스 차단에 PREVIEW 포함 | 포함 | 현행 유지 확인 요청(§25.6 근거 그대로) |
| U-2 | 예약 대기 정책 | 걸린 예약은 다음 예약 시각까지 대기 | 현행 유지 확인 요청 |
| U-3 | 적재 차단 감사 | 채택·구현 완료(I-95) | 결정 불요 |
| U-4 | 인증 벽 오탐 우회 수단 | 없음 | 현행 유지 확인 요청 — pass 11 로그인 신호 개정(I-101)으로 문서 경로 오탐이 더 줄었다 |
| U-5 | 범위에 포트를 넣을지 | **(b) 채택·구현 완료(I-104)** | 결정 불요 |
| PQ-1 | 수동 SYNC·FULL_RESEND의 인증 벽·새로 비율 가드 적용 범위 | 두 가드 모두 적용(예약과 같음) — 면제는 승인 SYNC(`trigger = APPROVAL`)의 새로 비율뿐 | 현행 유지 — 수동 실행은 사람이 결과를 미리 보지 않은 실행이다. 요구사항 AC-KB5-7①·AC-KB5-8은 "예약 실행·적재 승인"만 말하므로 "수동 동기화·전체 다시 적재 = 예약과 같음" 한 줄 보완 필요(요구사항 담당) |
| PQ-2 | 소스 수정 뒤 재개 시 미리보기부터 다시 | `configVersion` 필드(범위·스코프·`piiMask`·`allowRawFileIngest`·`maxPages` 등) 변경이면 승인 해제 → 예약 포함 PREVIEW부터 · 거버넌스 위반 해소 수정(마스킹 켬·원본 파일 끔)도 이 필드라 미리보기부터 · 일시중지→재개(`enabled`)·이름·주기·인증·간격 변경은 승인 유지 · 예약은 U-2대로 다음 예약 시각까지(수동 미리보기는 즉시) | 현행 유지 — 설정이 바뀐 소스는 사람이 다시 본다(P-4). FR-KB6-9·EX-KB-23 "소스 수정 뒤 다시 동작"이 "미리보기부터"라는 점 명시 필요(요구사항 담당) |
| PQ-3 | FULL_RESEND와 304 | 크롤의 조건부 요청은 종류 무관 → 304 행은 이번 실행의 UNCHANGED라 대상에 포함 → 적재 단계가 조건 없이 다시 받아 해시 동일 건너뛰기 없이 재전송(AC-KB5-9 충족) · 비용은 문서당 GET 1회 추가 | 현행 유지 — 정확성 같고 드문 수동 작업이다(대안 "FULL_RESEND 크롤은 조건부 생략"은 요약·변경 감지 의미가 바뀐다) |
| PQ-4 | `maxPages`를 낮춘 뒤 동작 | `configVersion` 필드라 미리보기부터 → 상한까지만 행 등록(등록 행은 모두 방문) → 상한 도달이면 삭제 감지 꺼짐 → 상한 밖으로 밀린 기존 적재 문서는 ACTIVE로 남고 GONE·정리 필요로 가지 않으며 FULL_RESEND에서도 빠진다(K-27) · 콘솔은 최대 페이지 도달 경고 | 현행 유지 + 운영 안내(범위를 줄일 때는 경로 접두·제외로 상한 아래가 되게) · 2차로 "상한 때문에 확인하지 못한 적재 문서 수" 표시 |

**문서 간 정합 확인 결과** — ① 설계 §3.1·§6.2·§6.4·§6.5·§6.8·§6.9·§9.5의 포트 서술: pass 12로 갱신(RG-26 해소 표시 · robots 출처 단위 추가) ② §8.4 새로 비율 분모 고정 · 인증 벽 분모 정의(`RD:` 제외)·로그인 신호 · 강등 뒤 승인 조건, §9.8 승인 조건·FULL_RESEND 한계 반영 ③ §20 K-20·K-26 갱신 · K-27·K-28 신설 ④ 화면 설계서: §3.3 상태표(거버넌스 사전 비활성)·§3.3.1(거버넌스 행 · 강등 행에 L-B 반영 필요 표시 — RG-27)·§3.4.1(PREVIEW 경고 문구)·§14(pass 9·10 행 후속 해소 표시 · 새 행) ⑤ **요구사항 문서(`docs/requirements/kb-crawling.md` — 이 적용기는 수정하지 않음 · 요구사항 담당 보완 필요)**: (가) FR-KB1-5·AC-KB2-9 — "같은 출처 = 스킴별 기본 포트를 채운 호스트+포트" 정의가 설계·구현(`http→https` 상향은 같은 출처로 헤더 유지)과 다르다 → RG-28 수정 방향에 맞춰 "호스트+포트(기본 포트 정규화) 일치 · 평문 `http` 요청에는 시작 주소·사이트맵이 `http`로 명시한 경우만 · 첫 요청은 시작 주소·**사이트맵**에 명시된 출처"로 정정 (나) FR-KB1-2 — 범위의 허용 단위가 호스트가 아니라 출처(호스트+포트)이며 다른 포트는 시작 주소·사이트맵에 명시해야 함 (다) AC-KB5-7·AC-KB5-8 — 수동 SYNC·FULL_RESEND 적용 범위(PQ-1) (라) EX-KB-5·AC-KB5-8 — 강등 뒤 승인에는 강등 이후에 끝난 미리보기가 필요(I-102) (마) FR-KB6-9·EX-KB-23 — "다시 동작 = 미리보기부터"(PQ-2) (바) FR-KB2-2·AC-KB2-5 — 상한 도달 시 밖으로 밀린 적재 문서 처리(K-27·PQ-4) ⑥ ADR-0044 구현 상태 · `기능요구사항.md` 비고 · `docs/05-ops/자동배포.md` §5.7(포트 설치 안내) · 패치 계획 문서 기록 ⑦ §17.4 커밋 분할을 현재 파일 구성으로 갱신(§2.6과 달라진 점: 의존성·`messages.ts`를 ①로, 봉인 spec을 ③으로).

**마이그레이션 영향** — pass 11·12·웹 후속은 스키마 구조·마이그레이션·계약(shared-types)·환경변수 변경 0(`schema.prisma`는 `observedHash` 주석만 — `prisma migrate diff` 무차이). `counts.priorActiveIngested`는 실행 행 JSON의 내부 키로 크롤 중에만 존재한다(종결 때 계약 키만 다시 씀 — 기존 행 영향 0). `observedHash`의 `RD:` 추가·`RL:` 입력 변경은 매 실행 `seedFrontier()`가 비우고 다시 채우므로 초기화 불요. 허용 출처는 저장하지 않으므로 기존 소스 행 재계산 불요이고 `configVersion`도 오르지 않는다(설정이 아니라 규칙 변경 — 승인된 소스는 승인 유지). 링크로만 발견되던 다른 포트 문서는 다음 SYNC부터 "다시 발견되지 않음" → 2회 뒤 GONE(적재 이력이 있으면 정리 필요) — 미배포라 운영 데이터 영향 0.

**잔여 갭 최종 요약표(§25 이후 전체)**

| 구분 | 항목 | AC | 담당 · 처리 |
|---|---|---|---|
| ~~커밋 전 필수~~ 해소(pass 13 · I-107) | RG-28 `http://` 링크·사이트맵 URL 첫 요청의 인증 헤더(평문) | FR-KB1-5 정의 위반 · AC-KB2-9② 취지(리다이렉트 경로는 충족) | backend-implementer 1회(`lib/allowed-origins.ts` + 시험 3 · 스키마·계약 0) |
| ~~커밋 전 권장(작음 · 웹)~~ 해소(웹 · I-108) | RG-27 강등 뒤 옛 미리보기 승인 거절의 콘솔 사전 비활성·문구 | 비해당(UIUX §7) | frontend-implementer 1회 + 화면 설계서 §3.3.1 정정 |
| 사용자 결정 | U-1·U-2·U-4 현행 유지 확인 · PQ-1~PQ-4 현행 유지 확인 | 비해당 | 오케스트레이터 → 사용자 |
| 후속(요구사항) | 위 정합 ⑤ (가)~(바) | — | requirements-analyst |
| 후속(시험 문서) | `docs/04-test/자동시험_전략.md` No.43 절 — K-23 간헐 실패·고정 방침 · pass 11·12 시험 반영 | — | test-automation(병렬 진행 중) |
| 2차 | RG-2 · RG-3 · RG-11 잔여 · RG-13 · RG-14 · RG-17 잔여(500쪽 실측) · RG-22②③⑥ · RG-24② · K-21 · K-24 · K-25 · K-27 표시 · K-28 | 비해당 | 재검토 트리거 |

### 25.8 백엔드 pass 13 · 웹 RG-27 반영 — RG-28·RG-27 해소 · 최종 판정 · 최종 시험 수치 · 커밋 분할 재점검 (2026-09-29 · system-architect)

pass 13(RG-28)·웹 RG-27 코드(`kb-sync/lib/allowed-origins.ts`(+spec)·`parse-source-row.ts`·`url-normalize.ts` · `kb-sync/engine/kb-crawl.runner.ts`·`kb-ingest.runner.ts` · `integration/kb-crawl-pass13.integration.spec.ts` · 콘솔 `KbSourceOverviewPage.tsx`(+spec)·`previewAfterDemotion.ts`·`constants/messages.ts` · 서버 `kb-sync/kb-runs.service.ts`의 409 문구)를 대조했다. 스키마·마이그레이션·계약(shared-types)·환경변수 변경 0.

**최종 판정 — 커밋 전 필수 0건 · 커밋 전 권장 0건**

- **RG-28 해소**(§25 I-107): 평문 `http:` 요청의 인증 헤더는 시작 주소·사이트맵에 `http:`로 명시한 host:port에만 싣는다. FR-KB1-5 "같은 출처 = 스킴별 기본 포트를 채운 호스트+포트"의 취지(자격증명 관점에서 `https://a`와 `http://a`는 다른 출처)를 헤더 판정에서 충족하고, 수집 범위 판정은 스킴 무관 그대로다(설계 결정 — §6.2 · `http→https` 상향 유지). AC-KB2-9② 충족 유지.
- **RG-27 해소**(§25 I-108): 확실할 때 "적재 시작" 사전 비활성 + 409 `PREVIEW_STALE`에서 서버 문구 표시 — UIUX §7(원인·해결 안내) 충족. 남는 문구 한계는 §20 K-29(2차).
- **커밋을 막지 않는 남은 일**: 사용자 확인(U-1·U-2·U-4 · PQ-1~PQ-4 — 현재 동작이 PM 기본안 · 결정이 바뀌면 후속 수정) · 요구사항 문서 정합(§25.7 정합 ⑤ (가)~(바) — requirements-analyst · (가)는 이제 I-107 규칙 그대로 적으면 된다: "평문 `http` 요청의 헤더는 시작 주소·사이트맵이 `http`로 명시한 출처에만 · `http→https` 상향은 같은 출처") · 시험 문서 수치 정정(`docs/04-test`의 346/5,096·1,062 → 아래 최종 수치 — 오케스트레이터) · 2차 목록.

**잔여 갭 최종 표(RG)**

| 상태 | 항목 |
|---|---|
| 이번에 닫힘 | RG-27(I-108) · RG-28(I-107) |
| 앞선 pass에서 닫힘 | 아래 2차 목록에 없는 RG-1~RG-26 전부(§25.1~§25.7 기록 — RG-23·RG-25 = pass 9·10 · RG-24① = pass 10·12 · RG-26 = pass 12) |
| 2차(커밋 비차단 · 재검토 트리거) | RG-2 · RG-3(클램프 부분 완화) · RG-11 잔여(Content-Type 판정) · RG-13 · RG-14 · RG-17 잔여(500쪽 실측) · RG-22②③⑥ · RG-24② |
| 커밋 전 필수 · 권장 | **없음** |

알려진 제한: K-28 갱신(인증 헤더 쪽 해소 · 두 스킴 중복 적재와 `https:` 전용 등록 소스의 평문 링크 무헤더 요청이 남음) · K-29 신설(강등 문구 · 이력 창 20건) — §20. 2차 K: K-21 · K-24 · K-25 · K-27 표시 · K-28 · K-29.

**최종 시험 수치(pass 13·웹 RG-27 후)** — api 347 suites / 5,116 passed / 1 skipped · 웹 198 파일 / 1,073 tests · `tsc` 오류 0(§25 I-106의 346/5,096·1,062는 pass 12 시점 값).

**마이그레이션·운영 영향** — 데이터 영향 0(허용 출처·평문 허용 출처 모두 저장하지 않음 · `configVersion` 불변 — 승인된 소스는 승인 유지). 동작 변화: `https:`로만 등록한 인증 소스에서 같은 호스트의 `http:` 문서 요청은 헤더 없이 나간다(K-28 ②) — 운영 안내를 `docs/05-ops/자동배포.md` §5.7 항목 2에 추가했다.

**커밋 분할 재점검(§17.4 갱신 — 현재 파일 구성 기준)**

§17.4 ①~④ 구성은 그대로 유효하다 — pass 13의 `allowed-origins.ts`(+spec)·`parse-source-row.ts`는 ①(`kb-sync/lib/**`), 엔진 두 파일은 ③(`engine/**`), `kb-crawl-pass13` 통합 시험은 ③(`integration/kb-*.integration.spec.ts`), 웹 `previewAfterDemotion.ts`·`KbSourceOverviewPage.tsx`(+spec)는 ④(`kb-crawling/**`), `messages.ts`의 새 문구 2개는 ①(파일 통째 — ①에서는 참조 0이라 단독 `tsc` 통과). 바뀐 점 두 가지:

1. **③에 하네스 명시**: `apps/api/src/integration/helpers/kb-crawl-db-harness.ts`(kb 통합 시험 전용 — `kb-*` 패턴 밖이라 목록에서 빠져 있었다).
2. **이전 그룹 시험 안정화는 No.43이 아니므로 별도 커밋 ⓪으로 분리**(§17.4 ③에 있던 `omnichannel-inbox`(I-88)도 여기로 옮긴다).

| 커밋 | 파일 | 게이트 |
|---|---|---|
| ⓪ 시험 안정화(`test:` — 이전 그룹 시험의 간헐 실패 고정 · 기대값 변경 0) | api `integration/helpers/eventual.helper.ts`·`tmp-dir.helper.ts`(신규) · `integration/`의 16개(`chatbot-operations`·`dialogue-design`·`hybrid-cs`·`hybrid-cs-hardening`·`hybrid-cs-hardening-multi-instance`·`integrated-stats`·`learning-augmentation`·`legacy-api-integration`·`nlu-rag-answering`·`omnichannel-inbox`·`quality-channel`·`security-audit`·`stats-learning`·`survey-management`·`version-history-reindex`·`workflow-automation` — 각 `.integration.spec.ts`) · `common/polling/polling-loop.spec.ts` · 웹 `pages/handoff-console/HandoffHistoryDetailPage.spec.tsx`·`pages/learning/ResolveModal.spec.tsx`·`pages/learning/BulkResolveModal.spec.tsx` · 문서 `docs/04-test/자동시험_전략.md` §20(간헐 실패 방침 — 원인 분류·고정 방침·재현 방법·고친 시험 목록) | HEAD(`a1a66a9`) + ⓪만으로 `prisma migrate deploy` 후 api 전체 jest · web 전체 vitest |
| ①~④ | §17.4 표 그대로(위 1·2 반영) | §17.4 |
| 문서(changelog) | 선행 그룹 선례(No.46 `a1a66a9`) | — |

- **순서 — ⓪을 먼저 권장**: 두 헬퍼는 No.43 코드를 쓰지 않고 kb 통합 시험·`kb-crawl-db-harness`는 두 헬퍼를 import하지 않는다(코드 확인 — 헬퍼 사용처 13개는 모두 이전 그룹 spec). ⓪이 먼저 들어가야 ①~④ 각 커밋의 전체 시험 게이트가 간헐 실패(§20 K-23) 없이 판정된다.
- **git-manager 사전 확인(필수)**: 16개 spec의 `git diff`에 No.43 변경에 기대는 줄이 없는지 본다 — 특히 `legacy-api-integration`(가짜 `LegacyTransport` — 포트 인터페이스가 ②에서 바뀜), `nlu-rag-answering`(RAG 클라이언트 ② · X-3), `security-audit`(감사 스냅샷 ③), `omnichannel-inbox`(I-88). 기대는 줄이 있으면 그 hunk만 `git add -p`로 해당 No.43 커밋에 넣거나, ⓪을 ④ 뒤(⑤)로 옮긴다(이때 ①~④ 게이트의 간헐 실패는 K-23 재실행 방침).
- **`docs/04-test/**` 소속**: `자동시험_전략.md` §20(시험 안정화)은 ⓪, No.43 시험 절(시험계획·시험항목·시험데이터 · 자동시험_전략의 No.43 결과 부분)과 오케스트레이터의 최종 수치 정정은 ④. 한 파일 안에서 두 종류를 hunk로 나누기 어려우면 그 파일은 통째로 ④에 넣는다(문서라 게이트 영향 없음 — ⓪ 메시지에 "방침 문서는 No.43 커밋에 포함"이라고 적는다).
- `apps/api/jest.isolate-env.js`는 ③ 그대로(변경은 `KB_SYNC_ENABLED` 기본 끔 1곳 — No.43 소속).
- 커밋 전 `git status`로 목록 밖 변경을 대조한다(§17.4 확인 사항 ①). `CLAUDE.md`의 미커밋 변경은 어느 커밋에도 자동으로 넣지 않는다(사용자 확인).
