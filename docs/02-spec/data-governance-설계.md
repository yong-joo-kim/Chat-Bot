# 데이터 거버넌스 세부 설계서 (No.45 — 규제산업向 데이터 레지던시 / 감사 강화)

> **요구사항**: `docs/requirements/data-governance.md`(T-1~20, J-1~J-20, FR-0-161~171, FR-DG1-\*~FR-DG9-\*, NFR-DGP/DGS/DGA/DGM, AC-DG1~DG8, EX-DG-1~24, 제약 C-1~C-9, P-1~P-12)
> **상위 문서**: `docs/02-spec/개발명세서.md` §2·§2.1·§2.2·§3·§3.1·§4·§4.1·§5·§5.1·§6(**결정 41 신설**)·§7
> **신규 ADR**: **ADR-0040**(데이터 거버넌스 = 서버 단위 모드 · 출구 레지스트리 + 공통 게이트 · 필드 AES-256-GCM 봉투(키 id·AAD) + 환경변수 키링 + 커서 재암호화 잡 · **텍스트 소거형 보존**(행·수치 보존 — 롤업 불필요) · 감사 해시 체인(헤드 CAS · 앵커 · 검증) · 열람 감사 = 선언적 데코레이터 · 완화는 환경변수만 · 거버넌스 런타임 = 부트스트랩 1회 설치 프로세스 전역 불변 상태 · **ADR-0016 대안표 "조회 이력 기록 기각"·"보존기간 정책 도입 기각" 부분 대체 · ADR-0033 §2 L3 "로그 `update*` 0건"의 소거 1파일 예외**)
> **갱신 ADR(각주만)**: ADR-0002(동반 삭제 +1) · ADR-0013(`PII_MASK_MODE` · 저장 직전 암호화 순서) · ADR-0015(신규 권한 0 · AUDITOR 2차 트리거) · ADR-0016(체인 · `VIEW`/`EXPORT` · 대상 6종 · 무한 증가 해소) · ADR-0022(출구 게이트 공통 적용) · ADR-0026(증강 2출구 게이트) · ADR-0033(소거 1파일 · `LOG_DELETION_ALLOWLIST` 빈 배열 유지) · ADR-0034(`EGRESS_BLOCKED` · 호스트 허용 목록은 주소 검사에 **더한다**) · ADR-0036(상담 텍스트 암호화 · 보존 소거 · 물리 잔존 = 디스크 암호화 전제)
> **작성일**: 2026-09-26 · **GPU**: **1 유지**(AES-GCM·SHA-256/HMAC·호스트 문자열 비교·배치 UPDATE/DELETE뿐 — 새 모델·학습·추론·임베딩 호출 0 · ml-worker 변경 0) — §25
> **기존 파일 수정 목록**: 문서는 `docs/02-spec/data-governance-patches.md`, 코드는 이 문서 §2.5.

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

카탈로그 No.45는 "데이터 저장 위치 제한, 필드 단위 암호화, 감사로그 보존기간 정책화 등 금융/공공 규제 대응 **옵션**"이다. 이 설계는 **대화 엔진·위젯·ml-worker를 한 줄도 바꾸지 않고, 기본값(모드 꺼짐·정책 무기한·키 없음)에서 모든 응답·통계가 바이트 단위로 같게** 다음을 만든다. ① **거버넌스 모드**(`DATA_GOVERNANCE_MODE=OFF|ON`, 서버 단위)와 **기동 검증**(저장 경로·출구 호스트·키링·"옛 키 필요 행") ② **출구 게이트** — 서버의 외부 HTTP 출구 5클래스(임베딩·RAG·Gemini·로컬 증강·레거시)를 코드 상수 레지스트리 1곳에 등록하고, 각 출구 파일이 송신 직전 `assertEgressAllowed()`/`checkEgress()`를 부른다(모드 OFF = 즉시 통과) ③ **필드 암호화 1차** — `HandoffMessage.rawText`·`HandoffMessage.text`·`SurveyAnswer.textValue` 3필드를 `enc:v1:<keyId>:<base64(iv‖ct‖tag)>` 봉투(AES-256-GCM · AAD = 테이블:컬럼:행 id)로 저장하고, 백필·키 교체는 커서 기반 잡이 CAS로 재작성한다 ④ **보존 정책 + 파기 잡** — 전역 + 챗봇 재정의(대화 원천 4종) · 대화 원천은 **텍스트만 소거**(`textPurgedAt` 표식 — 행·수치·`sessionId` 보존 → 롤업 불필요, `LOG_DELETION_ALLOWLIST` 빈 배열 유지) · 호출 로그 2종·감사로그는 행 삭제 · 파기 이력 `RetentionRun` ⑤ **감사 해시 체인** — `AuditLogService.record()` 1곳에서 싱글턴 헤드 행을 **CAS**로 전진시키며 `seq`·`prevHash`·`rowHash`를 같은 트랜잭션에 쓴다(커밋된 행에만 번호) · 제네시스/파기 앵커 · 검증 API ⑥ **열람·내보내기 감사** — `EXPORT`는 항상(3곳), `VIEW`는 모드 ON에서만(8핸들러 닫힌 목록 · (열람자·대상·KST 일)당 1건) ⑦ **데이터 지도**(읽기 전용 · 모드 OFF에서도 제공) ⑧ `PII_MASK_MODE=FULL`.
> 이 설계가 코드에서 **추가로 찾은 제약 7건**: **① 로그 `update*` 0건 봉인이 R-10(`stats-retention-sealing.spec.ts` 179행)과 F-10(`feedback-sealing.spec.ts` 307행) 두 곳**이다 — 소거 1파일 예외를 두 검사에 같이 반영해야 한다(§21.2 X-2·X-3) · **② `UnansweredQuestion`의 유일 키가 `(chatbotId, source, questionNormalized)`**(`schema.prisma` 652행)라 종결 항목의 정규화 문장을 `""`로 소거하면 두 번째 소거 행부터 유일 제약 위반이다 — 소거값은 행마다 다른 **대문자 센티넬 `#PURGED#<id>`**(정규화 결과는 소문자라 충돌 불가 — `normalizeText()` `common.ts` 212행)로 둔다(§9.2) · **③ 감사 기록은 현재 `prisma.auditLog.create` 1회이고 `createdAt`이 DB 기본값**(`audit-log.service.ts` 80행 · `schema.prisma` 428행) — 해시 입력이 되려면 앱이 `createdAt`을 **명시**해야 한다(§10.2) · **④ 출구 5클래스 중 3곳이 DI 밖 클래스**(`HttpEmbeddingProvider.connect()` 정적 생성 · Gemini/로컬 증강은 팩토리가 `new`)다 — 가드를 생성자 주입하면 생성자·팩토리·기존 spec이 같이 바뀐다 → **부트스트랩이 1회 설치하는 프로세스 전역 불변 정책**으로 둔다(§2.3) · **⑤ 개발명세서 §2.1의 "외부 HTTP 출구 4곳"에 `local-augmentation.provider.ts`(`fetch` 2곳 — 40·61행)가 빠져 있다** — 실제 출구는 5클래스·6파일(레거시 DNS 파일 포함)이다(§6.1) · **⑥ `SurveyAnswer.textValue` 목록은 `textValue: { not: null }`로 거른다**(`survey-results.service.ts` 124행) — 소거값을 `null`로 두면 "파기됨" 표시 없이 목록에서 사라지고 건수가 바뀐다 → 소거값은 `""`(§9.2) · **⑦ 부정 평가 큐 편입은 빈 입력을 `EMPTY`로 이미 제외한다**(`learning/lib/collect-decision.ts` 23행) — 평가 변경 기한(최대 168시간)과 대화 보존 하한(7일)이 겹쳐도 소거된 로그의 👎가 빈 질문으로 큐에 들어가지 않는다(코드 변경 0 — §19).

---

## 1. PM 확정 사항 (2026-09-26 — P-1~P-12 전부 추천안)

| # | 확정 내용 | 이 문서에서의 반영 |
|---|---|---|
| **P-1 (d)** | 레지던시 = **기동 시 저장 경로 검증 + 외부 전송 통제**(출구 5클래스 허용 목록·차단) **+ 운영 문서 + 콘솔 데이터 지도**. 물리 리전·백업 위치는 인프라 책임 | §5 · §6 · §13 · `docs/05-ops/자동배포.md` §5.3(patches F-1) |
| **P-2 (b)** | 1차 필드 암호화 = **`HandoffMessage.rawText`(상담 원문) · `HandoffMessage.text`(상담 메시지) · `SurveyAnswer.textValue`(설문 자유 텍스트)**. 대화로그·미응답 큐 본문은 2차(블라인드 인덱스) | §7 |
| **P-3 (a)** | 보존기간 경과 대화 원천 = **텍스트만 소거**(행·통계 수치 보존). `LOG_DELETION_ALLOWLIST` 봉인(빈 배열)·ADR-0033 규약 유지 | §9 · §16 G-7·G-8 · ADR-0040 §4 |
| **P-4 (1)** | 권한 = 기존 `security:read/write`·`audit:read` 재사용. **완화 방향 변경(하한 우회·출구 개방·암호화 끄기·모드 끄기·마스킹 약화)은 환경변수로만** | §14 |
| P-5 | 보존 = 전역 + 챗봇별 재정의(대화 원천 4종) · 하한 대화 7일·감사 365일(환경변수 기본값) · 단축은 유예 7일 후 적용 | §8 |
| P-6 | 감사 해시 체인 = HMAC(키 있을 때) + 앵커 + 검증 · **모드 무관 항상** | §10 |
| P-7 | 키 = 환경변수 키링 + 재암호화 잡 · KMS는 2차(`KeyProvider` 교체 지점 1곳) | §7.3 · §7.6 |
| P-8 | 켤 때 백필 잡 · 끄기 = 환경변수(기존 암호문은 키로 계속 읽음) | §7.6 · §7.7 |
| P-9 | `PII_MASK_MODE=PARTIAL｜FULL`(기본 PARTIAL) | §12 |
| P-10 | `EXPORT` 항상 · `VIEW`는 거버넌스 모드에서만 · (열람자·리소스·KST 일)당 1건 | §11 |
| P-11 | 2차 = 대화로그 본문 암호화·KMS·정보주체 파기·SIEM·감사 역할 · 2인 승인은 No.36 · 멀티테넌시는 별도 그룹 | §26 |
| P-12 | 데이터 지도는 모드 OFF에서도 읽기 제공 · GPU 1 · 구축형 ○ · 구독형 △ | §13 · §25 |
| (architect) | 거버넌스 런타임(모드·출구 정책·암호화 켜짐)·마스킹 강도 = **부트스트랩 1곳이 1회 설치하는 프로세스 전역 불변 상태**(기본 = 현행 동작). 키 값은 `env-key.provider.ts` 1파일만 `process.env`에서 읽는다 | §2.3 · ADR-0040 §1 |
| (architect) | 출구 게이트 = 레지스트리 상수 1곳 + 출구 파일마다 송신 직전 호출(파일 내 송신 호출 수 ≤ 가드 호출 수) · 와일드카드는 선행 `*.` 접미 일치만 · **루프백 자동 허용 없음** · 레거시는 호스트 검사를 **DNS 전에 추가**하고 주소 검사(ADR-0034)는 그대로 | §6 |
| (architect) | 암호화 함수 위치 = `apps/api/src/common/crypto/`(패키지 신설 기각 — 소비자 `apps/api` 1곳) · 키 id 집계 = **기동 1회 접두 검색**(카운트 캐시 테이블 기각) | §7 |
| (architect) | 소거 표식 = 4테이블 `textPurgedAt DateTime?` · 쓰기 = **`governance/writer/governance-data.writer.ts` 1파일**(미export) · `secure_delete` = 기존 `handoff-secure-delete.query.ts` 재사용(원시 SQL 보유 파일 4 불변) | §9 |
| (architect) | 체인 = 싱글턴 헤드 행 CAS(Postgres 잠금 불필요) · 정규 직렬화 = 고정 순서 **배열** JSON · `rowHash` 접두로 방식 표기(`s1:`/`h1:<keyId>:`) · 재시도 초과 시 **체인 없이 기록(폴백)** + 경고 | §10 · §24 R-6 |
| (architect) | 파기 감사 = 기존 `PURGE` 재사용(대상 `RetentionRun`) — `AuditAction` 14 → **16**(`VIEW`·`EXPORT`만) | §11 · §10 |
| (architect) | 열람 감사 = **선언적 데코레이터 `@AuditView()` + 인터셉터 1개**(8핸들러 닫힌 목록) · 내보내기 감사 = 서비스 3곳의 `recordExport()` | §11 · ADR-0040 §7 |
| (architect) | 감사 CSV = 기존 8열 뒤에 `seq`·`rowHash` 2열 + **파일 끝 표식 행 2개**(`#CHAIN_HEAD`·`#CHAIN_VERIFY` — 열 수 동일) | §11.4 |
| (architect) | 신규 `ApiErrorCode` **2종**(`EGRESS_HOST_NOT_ALLOWED`·`RETENTION_OUT_OF_RANGE`) — 확인 불일치는 기존 `CONFIRM_NAME_MISMATCH`, 검증 범위 초과는 기존 `AUDIT_RANGE_TOO_WIDE` 재사용 | §15.3 |
| (architect) | 기대값 변경 닫힌 목록 X-1~X-8 | §21.2 |

---

## 2. 아키텍처 배치

### 2.1 모듈 구조

기존 4계층 규약(개발명세서 §2.1)을 따른다. NestJS 모듈 **1개**(`governance`)를 신설하고, 횡단 부품 3개(`common/governance`·`common/egress`·`common/crypto`)는 **Nest 모듈이 아니라 순수 모듈 + 프로세스 전역 설치 상태**로 둔다(§2.3). 감사 체인·열람 감사는 기존 `audit-logs`(전역 모듈)를 확장한다.

```
apps/api/src/
├── governance/
│   ├── governance.module.ts                      # [신규] controllers 2 · providers(아래) · exports 0개
│   ├── governance.controller.ts                  # [신규] /governance/* 7 핸들러(§15.1) — @Public() 0
│   ├── chatbot-retention.controller.ts           # [신규] /chatbots/:chatbotId/retention* 4 핸들러
│   ├── governance-map.service.ts                 # [신규] 데이터 지도 조립(읽기 전용 — §13)
│   ├── retention-policy.service.ts               # [신규] 정책 조회·저장·미리보기·유예 취소(§8) — RetentionPolicy 쓰기 유일 파일
│   ├── retention-run-query.service.ts            # [신규] 파기 이력 조회(읽기 전용)
│   ├── bootstrap/
│   │   ├── governance-bootstrap.service.ts       # [신규] ★ onModuleInit — 기동 검증(§5) + 런타임 설치 유일 파일 + 행 보장
│   │   └── lib/{residency-check.ts, egress-boot-check.ts, key-usage-plan.ts}   # 순수 함수
│   ├── jobs/
│   │   ├── retention.job.ts                      # [신규] PollingLoop 소비자 — 파기·주간 체인 검증·v1 토큰 점검(§9) · tick() public
│   │   ├── field-crypto.job.ts                   # [신규] PollingLoop 소비자 — 백필·재암호화·통계(§7.6) · tick() public
│   │   └── job-lease.ts                          # [신규] GovernanceJobState 임대 선점·갱신·해제(CAS)
│   ├── writer/
│   │   └── governance-data.writer.ts             # ★ 소거·재암호화·호출로그/감사로그 삭제·파기 앵커 쓰기 유일 파일(미export — jobs/**만 import)
│   └── lib/
│       ├── retention-policy.ts                   # 순수 — 정책 파싱·유효 일수(유예 반영)·단축 판정·하한/상한 검사·기준 시각(KST 자정)
│       ├── retention-window.ts                   # 순수 — "HH:MM-HH:MM" KST 창 판정(자정 넘김 지원)
│       ├── purge-targets.ts                      # 상수 — RetentionTargetKind별 테이블·기준 컬럼·소거 데이터 빌더
│       └── governance-sealing.spec.ts            # §16 G-1~G-18
├── common/
│   ├── governance/governance-runtime.ts          # [신규] installGovernanceRuntime()/governanceRuntime()/resetGovernanceRuntimeForTest() — 기본 = OFF
│   ├── egress/
│   │   ├── egress-registry.ts                    # [신규] ★ 출구 5클래스 상수(파일·설정 키·송신 데이터·마스킹) — 데이터 지도·정적 검사 공용
│   │   └── egress-guard.ts                       # [신규] parseAllowlist · matchHost(순수) · checkEgress() · assertEgressAllowed() · EgressBlockedError
│   └── crypto/
│       ├── field-envelope.ts                     # [신규] 순수 — 봉투 포맷/파싱 · AES-256-GCM 봉인/개봉(키·AAD 주입)
│       ├── encrypted-fields.ts                   # [신규] ★ 암호화 대상 3필드 상수(테이블·컬럼·AAD 접두)
│       ├── field-crypto.ts                       # [신규] sealField()/openField() — 런타임(켜짐)+키링 사용 · 실패 폴백
│       └── env-key.provider.ts                   # [신규] ★ DATA_ENCRYPTION_KEYS·AUDIT_CHAIN_KEY 읽기 유일 파일(KeyProvider 1차 구현 · 지연 1회 파싱)
├── audit-logs/
│   ├── audit-log.service.ts                      # [수정] record() 체인 트랜잭션(§10.3) · recordView()/recordExport()(§11) · 헤드·제네시스 보장
│   ├── audit-logs.service.ts                     # [수정] 상세 chain 필드 · export 2열+표식 행 + recordExport
│   ├── audit-logs.controller.ts                  # [수정] POST /audit-logs/verify(+1) · @AuditView 2곳(목록·상세)
│   ├── chain/
│   │   ├── audit-chain.ts                        # [신규] 순수 — 정규 직렬화 v1 · rowHash 계산 · 방식 접두 파싱
│   │   ├── audit-chain-verifier.service.ts       # [신규] 구간 검증(읽기 전용 · 배치 5,000행) — export: governance 잡·컨트롤러
│   │   └── lib/verify-segment.ts                 # [신규] 순수 — 행 배열 + 시작 해시 → 결과 코드
│   ├── access/
│   │   ├── audit-view.decorator.ts               # [신규] @AuditView({ targetType, idParam?, chatbotParam?, label }) = SetMetadata + UseInterceptors
│   │   ├── access-view.interceptor.ts            # [신규] 성공 응답 후 recordView() — 모드 OFF = 통과
│   │   └── view-audit-targets.ts                 # [신규] ★ VIEW 닫힌 목록 상수(8) — 정적 검사가 데코레이터 부착 위치와 1:1 대조
│   ├── lib/audit-snapshot.ts                     # [수정] AUDIT_FIELDS +6 대상
│   └── audit-logs.module.ts                      # [수정] providers += AuditChainVerifier · exports += AuditChainVerifier
├── handoff/
│   ├── handoff-thread.service.ts                 # [수정] 메시지 create 4곳: id 선발급 + sealField(text/rawText) — 마스킹 순서 불변
│   ├── handoff-transcript.service.ts             # [수정] openField(text) · 원문은 표시 판정 통과 행만 openField(rawText) · purged 표식
│   ├── handoff-history.service.ts · handoff-public-poll.service.ts · handoff-gate.service.ts · handoff-hints.service.ts   # [수정] openField(text) 1곳씩 · 소거 행 표식/제외
│   ├── live-sessions.controller.ts               # [수정] @AuditView 2(진행 중 목록·대화 보기)
│   └── handoffs.controller.ts                    # [수정] @AuditView 1(상담 상세)
├── survey-responses/survey-response.service.ts   # [수정] answer 행 id 선발급 + sealField(textValue)
├── stats/
│   ├── lib/question-ranking-filter.ts            # [수정] { surveyTurn:false, handoffTurn:false, textPurgedAt:null }
│   ├── surveys/survey-results.service.ts         # [수정] openField(textValue) · purged 표식 · export recordExport(생성자 +1: AuditLogService)
│   ├── surveys/lib/survey-display.ts · survey-csv.ts   # [수정] 소거 셀 = "보존기간 경과로 파기됨"(개봉은 서비스가 끝낸 값)
│   └── surveys/survey-results.controller.ts      # [수정] @AuditView 2(응답 목록·자유 텍스트)
├── learning/
│   ├── unanswered-questions.service.ts           # [수정] 목록·상세 purged 표식 · lastFeedback 소거 표식
│   └── unanswered-questions.controller.ts        # [수정] @AuditView 1(상세)
├── validation/test-run.service.ts                # [수정] export recordExport(생성자 +1: AuditLogService — 끝)
├── embedding/providers/http-embedding.provider.ts   # [수정] postJson·fetchHealth try 안 assertEgressAllowed('EMBEDDING', url)
├── rag/rag-http.client.ts                        # [수정] send() try 안 assertEgressAllowed('RAG', url)
├── augmentation/providers/{gemini,local}-augmentation.provider.ts   # [수정] fetch 직전 assertEgressAllowed(...) · Gemini 기본 호스트 상수 export
├── legacy-api/
│   ├── legacy-api-http.client.ts                 # [수정] DNS 조회 전 checkEgress('LEGACY_API') → { kind:'ERROR', outcome:'EGRESS_BLOCKED' }
│   ├── transport/node-http.transport.ts          # [수정] transport.request 직전 checkEgress(방어 이중화)
│   ├── lib/outcome-class.ts                      # [수정] NEUTRAL += EGRESS_BLOCKED
│   └── legacy-api.service.ts                     # [수정] guidanceFor case 1개
├── api-connections/api-connections.service.ts    # [수정] 생성·수정 시 baseUrl 호스트 checkEgress → 400 EGRESS_HOST_NOT_ALLOWED
├── api-connections/catalog/lib/mock-outcome.ts   # [수정] FAILURE_ONLY_OUTCOMES += EGRESS_BLOCKED(시뮬레이터 재현)
├── chatbots/chatbots.service.ts                  # [수정] 영구삭제 동반 삭제 +1(retentionPolicy) — 사전검사 15종 불변
├── config/env.validation.ts                      # [수정] 선택 18종 + 교차 검사(§3.4)
└── app.module.ts                                 # [수정] imports 끝에 GovernanceModule
```

### 2.2 모듈 의존 방향

```
governance            → audit-logs(AuditLogService·AuditChainVerifier) · chatbots(ChatbotScopeService) · prisma · common/{governance,egress,crypto,polling}
governance/jobs       → governance/writer(★ 유일 import처) · audit-logs(AuditChainVerifier)
audit-logs            → common/governance(모드 읽기) · common/crypto(env-key.provider — 체인 키) · prisma          (governance import 0)
handoff｜survey-responses｜stats/surveys｜learning → common/crypto(sealField/openField) · audit-logs(@AuditView)   (governance import 0)
embedding｜rag｜augmentation｜legacy-api｜api-connections → common/egress                                            (governance import 0)
common/**             → Nest·Prisma import 0(egress·crypto·governance-runtime은 순수 모듈)
```

- **`GovernanceModule`의 export는 0개**다. 어떤 도메인 모듈도 `governance/**`를 import하지 않으므로 공개 대화·상담·설문·통계·학습의 DI 그래프에 **소거·재암호화·감사 삭제 경로가 없다**. 쓰기 유일 파일 `governance-data.writer.ts`는 `governance/jobs/**`만 import한다(정적 검사 G-10).
- **`audit-logs`는 `governance`를 import하지 않는다.** 체인 검증기(`AuditChainVerifier`)는 `audit-logs`가 소유하고 `governance`가 가져다 쓴다(순환 없음). 파기 잡의 감사 행 삭제·파기 앵커 갱신은 writer가 직접 Prisma로 한다(G-11 — 헤드 쓰기는 `audit-log.service.ts` 1파일 유지).
- `GovernanceModule`은 `AppModule` imports **맨 끝**에 둔다 — `onModuleInit` 순서상 Prisma 연결 뒤에 기동 검증이 돈다.

### 2.3 ★ 거버넌스 런타임 = 부트스트랩 1곳이 1회 설치하는 프로세스 전역 불변 상태

| 상태 | 위치 | 기본값(미설치) | 설치 | 읽는 곳 |
|---|---|---|---|---|
| `{ mode, egress: { allowlist, enforce }, encryptionEnabled }` | `common/governance/governance-runtime.ts` | `mode='OFF'` · `enforce=false` · `encryptionEnabled=false` | `installGovernanceRuntime()` — `governance-bootstrap.service.ts` 1곳 | `egress-guard.ts` · `field-crypto.ts` · `audit-log.service.ts`(VIEW 모드 판정) · 데이터 지도 |
| 마스킹 강도 `PARTIAL｜FULL` | `packages/pii-mask`(모듈 변수) | `PARTIAL`(= 현행) | `configurePiiMaskMode()` — 같은 1곳 | `maskPii()` 기본값 |
| 키링(암호화·체인) | `common/crypto/env-key.provider.ts`(지연 1회 파싱·메모) | 빈 키링 | 설치 없음(최초 호출 시 `process.env` 1회 읽기) | `field-crypto.ts` · `audit-log.service.ts` · 기동 검증 |

- **이 방식을 택한 이유**(ADR-0040 §1): 출구 5클래스 중 3곳이 DI 밖 클래스이고(C-④), 복호화 지점이 서비스 6곳이며, 그중 `HandoffHintsService`·`TestRunService`·`UnansweredQuestionsService`·`LegacyApiHttpClient`·`RagHttpClient`·`ApiConnectionsService`는 기존 spec이 생성자를 직접 호출한다. 생성자 주입은 이 spec 전부와 팩토리 3개를 바꾸고, 주입 누락이 **런타임 `undefined` 크래시**가 된다. 전역 상태는 **미설치 기본값 = 현행 동작**이라 AppModule을 띄우지 않는 단위 시험·기존 spec이 전부 무수정 통과한다.
- **통제**: ① 설치 함수 호출 파일 = 부트스트랩 1개(G-3) ② 설치 후 `Object.freeze` — 재설치는 `resetGovernanceRuntimeForTest()`(함수명에 `ForTest`, 운영 코드 호출 0 — G-3) ③ Jest는 **spec 파일마다 모듈 레지스트리가 새로** 만들어지므로 파일 간 누수 없음 ④ 같은 파일에서 앱 2개를 띄우는 다중 인스턴스 시험은 설정이 같으므로 영향 없음.
- **키 값은 이 상태에 들어가지 않는다** — 키 바이트는 `env-key.provider.ts` 모듈 스코프에만 있고, 다른 파일은 봉인·개봉·서명 함수를 통해서만 쓴다(키 바이트를 반환하는 export 0 — G-4).

### 2.4 엔진·위젯·ml-worker · 워크스페이스 영향

| 워크스페이스 | 변경 |
|---|---|
| `packages/dialogue-engine` · `apps/widget` · `apps/ml-worker` | **0건**(FR-0-162 — G-13이 거버넌스 심볼 0건 단언) |
| `packages/pii-mask` | `maskPii(text, options?: { mode?: PiiMaskMode })` · `configurePiiMaskMode(mode)` · `type PiiMaskMode` — 인자 없는 호출은 설치값(기본 PARTIAL)을 쓰며 **PARTIAL 결과는 현행과 바이트 동일**. FULL: 전화 `[전화번호]`·이메일 `[이메일]` 전량 치환(나머지 3종은 원래 전량) |
| `packages/shared-types` | **`governance.ts` 신설**(§4.1 — `common.ts`만 의존) · `audit.ts`(액션 +2 · 대상 +6 · 상세 `chain?` · 검증 스키마) · `legacy-api.ts`(`ApiCallOutcome` +`EGRESS_BLOCKED` → 19) · `common.ts`(`ApiErrorCode` +2) · `handoff.ts`·`survey.ts`·`learning.ts`(`purged?: true` 선택 키 — §9.5) · `index.ts` |
| `apps/web` | 설정 > 데이터 거버넌스(데이터 지도·보존 정책·파기 이력) · 감사로그 무결성 검증·액션 필터 · "파기됨" 표시 · 챗봇 설정 보존 탭 · `Record<ApiCallOutcome,…>`/`Record<AuditAction,…>`/`Record<AuditTargetType,…>` 라벨(컴파일 강제) — §20 |

### 2.5 기존 코드 변경 목록 (구현자 체크리스트)

| 파일 | 변경 | 근거 |
|---|---|---|
| `prisma/schema.prisma` + 마이그레이션 1개 | §3.1 — 컬럼 추가 7 · 인덱스 3 · 유일 인덱스 1 · 신규 테이블 5 · `Chatbot` 역참조 1 — **새 컬럼은 모델 끝** | §3 |
| `packages/shared-types/src/{governance(신규),audit,legacy-api,common,handoff,survey,learning,index}.ts` | §4 | — |
| `packages/pii-mask/src/index.ts` | §12 — 기존 export·기본 동작 불변 | P-9 |
| `config/env.validation.ts` | 선택 18종 + `validate()` 교차 검사 3건(§3.4) — **키 2종은 스키마에 넣지 않는다**(zod가 걸러 `ConfigService`에 키 값이 실리지 않게 — `LEGACY_API_SECRET__` 선례) | FR-0-170 |
| `audit-logs/audit-log.service.ts` | `record()`: 스냅샷 계산 → 인스턴스 로컬 직렬화 큐 → `$transaction`(헤드 읽기 → `createdAt` 명시 · seq/prevHash/rowHash 계산 → 헤드 CAS `updateMany` → `auditLog.create`) · 경합 재시도 5회 · 초과 시 체인 없이 `create` 폴백 + `warn` · `isBulkSummary` += `EXPORT` · `recordView()`·`recordExport()` · `ensureChainHead()`(부트스트랩이 호출) | §10 · §11 |
| `audit-logs/audit-logs.service.ts` · `audit-log.mapper.ts` | 상세에 `chain?` 키(값 있을 때만) · export 2열 + 표식 행 2 + `recordExport` | §11.4 |
| `audit-logs/audit-logs.controller.ts` | `POST verify`(`audit:read`) · `@AuditView` list·findOne | §15 |
| `audit-logs/lib/audit-snapshot.ts` | `AUDIT_FIELDS` += `ConversationLog: []`·`UnansweredQuestion: []`·`AuditLog: []`·`TestRun: []`·`RetentionPolicy: [...]`·`RetentionRun: [...]`(§11.1) | 컴파일 강제 |
| `handoff/handoff-thread.service.ts` | 메시지 `create` 4곳(연결 알림·사용자·상담원·종료/인수 SYSTEM): `const id = randomUUID()` → `data.id = id` · `text: sealField('HANDOFF_TEXT', id, masked)` · 사용자 원문 `rawText: rawText === null ? null : sealField('HANDOFF_RAW_TEXT', id, rawText)`. `masked !== rawInput` 비교·반환값 `maskedText`(평문)·원문 소거 `updateMany`는 **무변경** | §7.4 |
| `survey-responses/survey-response.service.ts` | `createMany` 직전 행마다 `id` 선발급 + `textValue` 있으면 `sealField('SURVEY_TEXT_VALUE', id, v)` | §7.4 |
| `handoff/handoff-{transcript,history,public-poll,gate,hints}.service.ts` · `stats/surveys/survey-results.service.ts`(개봉 6파일) · `stats/surveys/lib/{survey-display,survey-csv}.ts`(소거 문구만) | `openField()` 1곳씩 · 소거 표식(§9.5) · 원문은 표시 판정 통과 행만 개봉 | §7.5 |
| `stats/lib/question-ranking-filter.ts` | `textPurgedAt: null` 1키 추가(5곳 공유 상수 — 소거 전 수치 불변) | §9.6 |
| `learning/unanswered-questions.service.ts` | 목록·상세 `purged?` · `lastFeedback.botResponse` 소거 표식 | §9.5 |
| `embedding/providers/http-embedding.provider.ts` · `rag/rag-http.client.ts` · `augmentation/providers/{gemini,local}-augmentation.provider.ts` | 각 `fetch(` 직전(기존 `try` 블록 안) `assertEgressAllowed(exitId, url)` — 차단 예외는 **기존 catch가 그대로 흡수**(§6.3) | §6 |
| `legacy-api/legacy-api-http.client.ts` · `transport/node-http.transport.ts` · `lib/outcome-class.ts` · `legacy-api.service.ts` | §6.5 | FR-DG3-3 |
| `api-connections/api-connections.service.ts` · `catalog/lib/mock-outcome.ts` | §6.5 | — |
| `handoff/live-sessions.controller.ts`(2) · `handoff/handoffs.controller.ts`(1) · `stats/surveys/survey-results.controller.ts`(2) · `learning/unanswered-questions.controller.ts`(1) · `audit-logs/audit-logs.controller.ts`(2) | `@AuditView(...)` 부착(닫힌 목록 §11.3) — 핸들러 본문 무변경 | §11 |
| `validation/test-run.service.ts` · `stats/surveys/survey-results.service.ts` | 생성자 끝 +1 `AuditLogService` · `export()` 끝에 `recordExport()` | §11.2 |
| `chatbots/chatbots.service.ts` | 동반 삭제 트랜잭션 `tx.retentionPolicy.deleteMany({ where: { chatbotId: id } })` 1줄(챗봇 삭제 직전) — 19 → 20테이블, 사전검사 15종 불변 | §3.1 |
| `app.module.ts` | imports 끝 `GovernanceModule` | §2.2 |
| `jest.isolate-env.js` | `DATA_RETENTION_JOB_ENABLED='false'` · `DATA_REENCRYPT_JOB_ENABLED='false'` 2줄(기존 루프 규약) | CLAUDE.md |
| 시험 파일 | §21.2 닫힌 목록 | FR-0-169 |

> **이 목록에 없는 파일은 바꾸지 않는다.** 특히 `packages/dialogue-engine/**` · `apps/widget/**` · `apps/ml-worker/**` · `conversation/conversation-log.service.ts`(적재 경로 — 대화로그는 1차 암호화 대상 아님) · `learning/unanswered-collector.service.ts`·`decomposed-resolve.service.ts` · `feedback/**` · `stats/stats.service.ts`·`stats/integrated/**`(필터 상수만 바뀐다) · `versions/**` · `environment/**` · `deploy-schedules/**` · `handoff/handoff-secure-delete.query.ts`(재사용만) · `legacy-api/transport/node-dns.resolver.ts`.

### 2.6 커밋 분리 단위

| 커밋 | 범위 | 독립성 · 게이트 |
|---|---|---|
| **① 기반(관측 응답 불변)** | 마이그레이션 `20260926120000_data_governance`(§3.2 전부) · shared-types 추가(값 추가·선택 키만) · `pii-mask` 선택 인자 · `common/{governance,egress,crypto}` · 출구 파일 가드 삽입(미설치 = 통과) · 쓰기 2파일 id 선발급 + `sealField`(미설치 = 평문 그대로) · 개봉 6파일 `openField`(키링 없음 = 입력 그대로) · 랭킹 필터 1키 · `jest.isolate-env.js` 2줄 | 런타임을 설치하는 부트스트랩이 **없으므로** 모든 동작이 현행과 같다. **기존 시험이 수정 없이 전부 통과**해야 한다(여기서 깨지면 멈추고 보고). FR-0-161 "바이트 동일" 기준선을 **① 적용 후**로 잡는다 |
| **② 감사 체인·열람/내보내기** | `record()` 체인 트랜잭션 · 헤드/제네시스 보장 · 검증기 · `POST /audit-logs/verify` · 상세 `chain?` · CSV 2열+표식 · `EXPORT`/`VIEW` 액션·대상 추가 · `recordExport` 3곳 · `@AuditView` + 인터셉터(모드 판정은 런타임 — 아직 OFF) | 기대값 변경 = X-1만(+ `test-run.service.spec.ts` 픽스처 인자). 목록 API 응답 모양 불변 |
| **③ 거버넌스 본체** | `governance` 모듈(부트스트랩·정책·지도·잡 2·writer) · 레거시 `EGRESS_BLOCKED` · 연결 저장 검사 · 동반 삭제 +1 · 봉인 G-1~G-18 | X-2~X-8 |

> ①을 먼저 배포하면 이후 생기는 상담 메시지·설문 답 행은 **앱이 발급한 id**를 가진다(AAD에 필요). 기존 행은 Prisma 기본 uuid이며 둘 다 v4라 구분이 필요 없다.

---

## 3. 데이터 모델 · 마이그레이션

### 3.1 Prisma 변경안

```prisma
model Chatbot {
  // ... 기존 필드·역참조 불변
  /// [신규 No.45] 보존기간 재정의(없으면 전역 따름). 스냅샷·복사·토픽 분리 대상 아님 · 영구삭제 동반 삭제.
  retentionPolicy RetentionPolicy?
}

model AuditLog {
  // ... 기존 컬럼 불변(createdAt은 이제 record()가 명시한다 — 기본값은 폴백·구버전 호환용으로 유지)
  /// [신규 No.45] 체인 순번 — 커밋된 행에만 부여(헤드 CAS와 같은 트랜잭션). null = 체인 도입 전 행 · 체인 폴백 행 · 구버전 인스턴스 행
  seq      Int?    @unique
  /// [신규 No.45] 직전 체인 행의 rowHash(seq=1이면 제네시스 해시 "g1:genesis")
  prevHash String?
  /// [신규 No.45] "s1:<sha256 hex>" | "h1:<keyId>:<hmac-sha256 hex>" — 접두가 방식이다(행 단위 — 키 추가·교체 후에도 과거 행 검증 가능)
  rowHash  String?
}

model ConversationLog {
  // ... 기존 불변
  /// [신규 No.45] 보존기간 파기로 userMessage·botResponse를 ""로 소거한 시각. 쓰기 = governance-data.writer.ts 1파일.
  /// 행·수치·버킷·sessionId·groupId·매칭 id는 변경하지 않는다(ADR-0040 §4). null = 소거 전.
  textPurgedAt DateTime?
  @@index([chatbotId, textPurgedAt, createdAt])   // 파기 대상 탐색(소거된 행을 다시 훑지 않게)
}

model UnansweredQuestion {
  // ... 기존 불변
  /// [신규 No.45] 종결(RESOLVED·IGNORED) 항목의 questionText·variants·questionNormalized 소거 시각.
  /// questionNormalized 소거값은 "#PURGED#<id>"(대문자 — normalizeText 결과와 충돌 불가 · 유일 키 보존).
  textPurgedAt DateTime?
}

model SurveyAnswer {
  // ... 기존 불변(textValue = 마스킹본 또는 암호 봉투)
  /// [신규 No.45] 자유 텍스트 소거 시각(textValue → ""). 선택·척도 행은 대상 아님.
  textPurgedAt DateTime?
  @@index([surveyId, textPurgedAt, answeredAt])
}

model HandoffMessage {
  // ... 기존 불변(text·rawText = 평문 또는 암호 봉투)
  /// [신규 No.45] 종료된 상담 메시지의 text 소거 시각(text → ""). rawText 소거(ADR-0036)와 별개.
  textPurgedAt DateTime?
  @@index([chatbotId, textPurgedAt, createdAt])
}

/// [신규 No.45] 보존기간 정책 — 전역 1행(scopeKey="GLOBAL", chatbotId=null) + 챗봇 재정의 N행(scopeKey=chatbotId).
/// 쓰기 = retention-policy.service.ts 1파일. 행 없음 = 전부 무기한(전역) / 전역 따름(챗봇).
model RetentionPolicy {
  scopeKey       String   @id
  chatbotId      String?  @unique
  chatbot        Chatbot? @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// JSON { [RetentionTargetKind]: number | null } — 전역: 키 없음 = 무기한 · 챗봇: 키 없음 = 전역 따름, null = 무기한(대화 원천 4종만)
  days           String   @default("{}")
  /// JSON { [kind]: { days: number | null | "GLOBAL", effectiveAt: ISO } } — 단축 유예 대기분(적용 시각 도래 후 유효 계산에 반영)
  pending        String   @default("{}")
  updatedById    String?
  updatedByEmail String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@map("retention_policies")
}

/// [신규 No.45] 파기·백필·재암호화·체인 검증 실행 이력. ★ 본문·행 id 목록·sessionId 컬럼 없음(정적 검사 G-16).
/// 쓰기 = governance-data.writer.ts 1파일. 보존 = AUDIT_LOGS 정책과 같은 기한으로 행 삭제.
model RetentionRun {
  id            String    @id @default(uuid())
  /// 같은 tick 실행의 묶음 id(요약 1행 + 대상별 행)
  runId         String
  /// PURGE | BACKFILL | REENCRYPT | CHAIN_VERIFY
  kind          String
  /// RetentionTargetKind | EncryptedFieldId | null(요약 행)
  target        String?
  /// null = 전역·요약
  chatbotId     String?
  days          Int?
  cutoff        DateTime?
  affectedCount Int       @default(0)
  /// SUCCEEDED | PARTIAL | FAILED
  status        String
  /// WINDOW_ENDED | MAX_ROWS | LEASE_LOST | HASH_MISMATCH | SEQ_GAP | TAIL_MISSING | KEY_UNAVAILABLE | ANCHOR_MISSING | DB_ERROR ...
  resultCode    String?
  headSeq       Int?
  headHash      String?
  anchorSeq     Int?
  instanceId    String
  startedAt     DateTime
  finishedAt    DateTime?

  @@index([kind, startedAt])
  @@index([chatbotId, startedAt])
  @@map("retention_runs")
}

/// [신규 No.45] 감사 체인 머리(싱글턴 id="HEAD"). ★ 쓰기 = audit-log.service.ts 1파일(record()의 CAS · 최초 생성).
model AuditChainHead {
  id        String   @id
  headSeq   Int
  headHash  String
  updatedAt DateTime @updatedAt

  @@map("audit_chain_heads")
}

/// [신규 No.45] 체인 앵커 — "GENESIS"(도입 시 1회) · "RETENTION"(보존 파기로 앞부분 삭제 시 마지막 삭제 행 — 최신 1행 갱신).
/// 쓰기 = audit-log.service.ts(GENESIS) · governance-data.writer.ts(RETENTION).
model AuditChainAnchor {
  id                   String    @id
  seq                  Int
  hash                 String
  /// 제네시스 전용 — 체인 도입 전 행 수·최대 createdAt
  preChainRows         Int?
  preChainMaxCreatedAt DateTime?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  @@map("audit_chain_anchors")
}

/// [신규 No.45] 거버넌스 잡 상태(jobName = "RETENTION" | "FIELD_CRYPTO"). 임대(claimToken·claimedAt CAS) +
/// 진행 상태 JSON(재암호화 커서·암호화 통계·v1 토큰 점검 결과 — 본문 0). 쓰기 = job-lease.ts · 잡 2파일.
model GovernanceJobState {
  jobName          String    @id
  claimToken       String?
  claimedAt        DateTime?
  /// KST YYYY-MM-DD — 그날 파기를 끝까지 완료했는가(PARTIAL이면 갱신하지 않는다)
  lastCompletedDay String?
  state            String    @default("{}")
  updatedAt        DateTime  @updatedAt

  @@map("governance_job_states")
}
```

- **FK**: `RetentionPolicy.chatbotId → Chatbot`만 `Restrict`(1:1 설정 — `ChatbotHandoffSetting` 선례, 영구삭제 동반 삭제). `RetentionRun.chatbotId`·앵커·헤드는 FK 없음(로그 규약).
- **`Chatbot` 테이블은 재정의되지 않는다** — 역참조 필드는 컬럼이 아니다. `AuditLog.seq @unique`는 `CREATE UNIQUE INDEX`(SQLite·Postgres 모두 NULL 다중 허용).
- **JSON 컬럼 3개**(`days`·`pending`·`state`)는 zod 파싱 후 사용한다(파싱 실패 = 빈 객체 + 경고 — 정책은 "무기한"으로 안전 측 폴백).

### 3.2 마이그레이션 (1개 — `20260926120000_data_governance`)

생성된 SQL에 다음만 있어야 한다(구현자가 `migrate dev` 결과를 대조 — ❌가 보이면 수동 편집):

| 구문 | 비고 |
|---|---|
| `ALTER TABLE "audit_logs" ADD COLUMN "seq" INTEGER` · `"prevHash" TEXT` · `"rowHash" TEXT` + `CREATE UNIQUE INDEX "audit_logs_seq_key"` | 재작성 없음 |
| `ALTER TABLE "conversation_logs" ADD COLUMN "textPurgedAt" DATETIME` + `CREATE INDEX "conversation_logs_chatbotId_textPurgedAt_createdAt_idx"` | 100만 행 기준 인덱스 생성 소요 실측·기록(§17) |
| `ALTER TABLE "unanswered_questions" ADD COLUMN "textPurgedAt" DATETIME` | 인덱스 없음(소규모 — 기존 `(chatbotId, lastOccurredAt)` 사용) |
| `ALTER TABLE "survey_answers" ADD COLUMN "textPurgedAt" DATETIME` + 인덱스 1 | |
| `ALTER TABLE "handoff_messages" ADD COLUMN "textPurgedAt" DATETIME` + 인덱스 1 | |
| `CREATE TABLE "retention_policies"`(FK `chatbots` Restrict) · `"retention_runs"` · `"audit_chain_heads"` · `"audit_chain_anchors"` · `"governance_job_states"` + 인덱스 | 데이터 INSERT 없음(행 보장은 부트스트랩 — §5.1 7단계) |
| ❌ `PRAGMA foreign_keys=OFF` / `CREATE TABLE "new_…"` / `DROP INDEX` | **테이블 재정의 0** — 부분 유니크 4종(`test_runs_chatbotId_active_key` · `deploy_schedules` 2종 · `handoff_sessions` 1종) 보존 |

- **적용 후 확인 쿼리**: `sqlite_master`에서 부분 유니크 4종 존재 · 신규 테이블 5 · 신규 인덱스 4(유일 1 포함) · `PRAGMA foreign_key_check` 0행 · `SELECT COUNT(*) FROM audit_logs WHERE seq IS NOT NULL` = 0(아직 체인 없음).
- **통합 시험 DB는 `prisma migrate deploy`로 만든다**(CLAUDE.md — `db push`는 부분 유니크를 만들지 않는다).
- **백필 없음.** 기존 행: `textPurgedAt` null(소거 전) · `seq` null(체인 이전 — 제네시스 앵커가 건수로 기록).

### 3.3 seed

변경 없음. 데모 설치는 모드 OFF · 정책 없음 · 키 없음이다(감사 체인은 기동 시 헤드만 생긴다).

### 3.4 환경변수 — 선택 18종(zod) + 키 2종(스키마 밖) · 전부 기본값 · **모드 OFF에서 기동 조건 아님**

| 변수 | 기본 | 검증 | 용도 |
|---|---|---|---|
| `DATA_GOVERNANCE_MODE` | `OFF` | `z.enum(['OFF','ON'])` | 서버 단위 스위치 |
| `DATA_RESIDENCY_ALLOWED_DIRS` | `''` | 쉼표 목록(절대 경로) | SQLite 파일 허용 디렉터리 |
| `DATA_RESIDENCY_ALLOWED_DB_HOSTS` | `''` | 쉼표 목록 | 원격 DB 호스트 허용(Postgres 대비) |
| `DATA_AT_REST_ENCRYPTION_DECLARED` | `false` | `envBoolean` | 디스크 암호화 **운영 자기 신고**(검출 불가 명시) |
| `DATA_EGRESS_ALLOWED_HOSTS` | `''` | 쉼표 목록 `host[:port]`·`*.suffix[:port]` | 출구 허용 목록(모드 ON에서만 집행) |
| `DATA_ENCRYPTION_ENABLED` | `false` | `envBoolean` | 필드 암호화 신규 쓰기 |
| `DATA_REENCRYPT_JOB_ENABLED` | `true` | `envBoolean` | 백필·재암호화 잡(키링이 있을 때만 시작) |
| `DATA_REENCRYPT_BATCH_SIZE` | `500` | int 50~5000 | 배치 행 수 |
| `RETENTION_MIN_DAYS_CONVERSATION` | `7` | int ≥1 | 대화 원천 4종 하한 |
| `RETENTION_MIN_DAYS_AUDIT` | `365` | int ≥1 | 감사로그(+파기 이력) 하한 |
| `RETENTION_MAX_DAYS` | `3650` | int ≥1 | 상한 |
| `RETENTION_SHORTEN_GRACE_DAYS` | `7` | int 0~90 | 단축 유예 |
| `DATA_RETENTION_JOB_ENABLED` | `true` | `envBoolean` | 파기 잡 |
| `DATA_RETENTION_WINDOW` | `02:00-05:00` | `^\d{2}:\d{2}-\d{2}:\d{2}$` · KST · 자정 넘김 허용 | 실행 창 |
| `DATA_RETENTION_BATCH_SIZE` | `500` | int 50~5000 | 트랜잭션당 행 수 |
| `DATA_RETENTION_BATCH_PAUSE_MS` | `200` | int 0~10000 | 배치 간 양보 |
| `DATA_RETENTION_MAX_ROWS_PER_RUN` | `500000` | int ≥1000 | 1회 실행 상한(넘으면 `PARTIAL` → 다음 tick/창) |
| `PII_MASK_MODE` | `PARTIAL` | `z.enum(['PARTIAL','FULL'])` | 마스킹 강도(강화라 모드 무관 허용) |
| **`DATA_ENCRYPTION_KEYS`** | 없음 | **스키마 밖** — `env-key.provider.ts`가 `<id>:<base64 32B>` 쉼표 목록 파싱(첫 항목 = 쓰기 키 · id `^[a-z0-9]{1,8}$` · 중복·길이 오류 = 기동 실패, 값 미출력) | 필드 암호화 키링 |
| **`AUDIT_CHAIN_KEY`** | 없음 | **스키마 밖** — 같은 키링 형식(첫 항목 = 서명 키, 나머지 = 검증 전용) | HMAC 체인 |

- **`validate()` 교차 검사**: ① `RETENTION_MIN_DAYS_CONVERSATION > RETENTION_MAX_DAYS` 또는 `RETENTION_MIN_DAYS_AUDIT > RETENTION_MAX_DAYS` → 기동 실패 ② `RETENTION_MIN_DAYS_AUDIT < 365` → `console.warn`(EX-DG-17 — 허용·경고, 데이터 지도에도 표시) ③ `DATA_ENCRYPTION_ENABLED=true` ∧ `DATA_GOVERNANCE_MODE=OFF` → 기동 실패("필드 암호화는 거버넌스 모드 ON 필요").
- **boolean은 전부 `envBoolean()`**(CLAUDE.md — `z.coerce.boolean()` 금지). 이 그룹은 **쿼리 boolean을 만들지 않는다**(추가 시 `queryBoolean()`).
- 시험: `jest.isolate-env.js`가 잡 2종을 `false`로 고정. 모드·암호화·잡을 켜는 spec은 **값을 먼저 설정한 뒤 `await import('../app.module')`**(동적 import)로 앱을 만들고, 잡은 `tick()` 직접 호출로 검증한다.

### 3.5 배포 순서 · 롤백

1. 마이그레이션 적용 → 2. API 배포(커밋 ①~③) → 3. (선택) 환경변수로 모드·정책·키 설정 후 재기동.
- **API 롤백**: 구버전 API는 `seq` 없이 감사 행을 쓴다(검증기가 "체인 밖 행"으로 보고 — 손실 아님). **암호화를 켠 뒤 구버전으로 롤백하면 구버전은 봉투를 평문처럼 표시한다** → **암호화를 켠 설치는 롤백 금지(전진 수정만)** 를 운영 문서에 명시한다(patches F-1).
- 다중 인스턴스 롤링 배포 중 구·신 인스턴스가 섞이면 구 인스턴스의 감사 행이 체인 밖으로 남는다 — 단일 서버(SQLite)는 해당 없음, 운영 문서에 "전 인스턴스 동시 교체" 권고.

---

## 4. shared-types 스키마

### 4.1 `governance.ts`(신설 — `common.ts`만 의존)

```ts
export const GovernanceMode = z.enum(['OFF', 'ON']);
export const PiiMaskModeSchema = z.enum(['PARTIAL', 'FULL']);

export const EgressExitId = z.enum(['EMBEDDING', 'RAG', 'AUGMENT_GEMINI', 'AUGMENT_LOCAL', 'LEGACY_API']);
/** 송신 데이터 종류 — 화면 문구는 web 라벨 */
export const EgressDataKind = z.enum(['QUERY_RAW', 'QUESTION_MASKED', 'SEED_MASKED', 'SEED_UNMASKED', 'FORM_SLOT']);
export const EgressDecision = z.enum(['ALLOWED', 'BLOCKED', 'NOT_CONFIGURED', 'NOT_ENFORCED']); // NOT_ENFORCED = 모드 OFF

export const EncryptedFieldId = z.enum(['HANDOFF_RAW_TEXT', 'HANDOFF_TEXT', 'SURVEY_TEXT_VALUE']);

export const RetentionTargetKind = z.enum(['CONVERSATION_TEXT', 'UNANSWERED_CLOSED', 'SURVEY_FREE_TEXT', 'HANDOFF_TEXT', 'CALL_LOGS', 'AUDIT_LOGS']);
export const CONVERSATION_RETENTION_KINDS = ['CONVERSATION_TEXT', 'UNANSWERED_CLOSED', 'SURVEY_FREE_TEXT', 'HANDOFF_TEXT'] as const;
export const RetentionDays = z.number().int().min(1).max(36500).nullable();          // null = 무기한 · 서버 하한/상한은 서비스가 검사
export const GlobalRetentionUpdateSchema = z.object({
  days: z.object({ CONVERSATION_TEXT: RetentionDays, UNANSWERED_CLOSED: RetentionDays, SURVEY_FREE_TEXT: RetentionDays,
                   HANDOFF_TEXT: RetentionDays, CALL_LOGS: RetentionDays, AUDIT_LOGS: RetentionDays }).strict(),
  confirmText: z.string().trim().max(100).optional(),                               // 단축 포함 시 "보존기간 단축"
});
const ChatbotRetentionValue = z.union([RetentionDays, z.literal('GLOBAL')]);
export const ChatbotRetentionUpdateSchema = z.object({
  days: z.object({ CONVERSATION_TEXT: ChatbotRetentionValue, UNANSWERED_CLOSED: ChatbotRetentionValue,
                   SURVEY_FREE_TEXT: ChatbotRetentionValue, HANDOFF_TEXT: ChatbotRetentionValue }).strict(),
  confirmText: z.string().trim().max(100).optional(),                               // 단축 포함 시 챗봇 이름
});
export const RetentionKindView = z.object({
  kind: RetentionTargetKind,
  days: z.number().int().nullable(),                  // 지금 유효한 값(유예 반영 · 하한 클램프 전 저장값)
  source: z.enum(['GLOBAL', 'CHATBOT', 'DEFAULT']),    // DEFAULT = 행 없음(무기한)
  pending: z.object({ days: z.number().int().nullable(), effectiveAt: z.coerce.date() }).optional(),
  belowServerMinimum: z.literal(true).optional(),      // 저장값 < 현재 하한(환경변수가 올라간 경우) — 실행은 하한 적용
});
export const RetentionPolicyResponseSchema = z.object({
  scope: z.enum(['GLOBAL', 'CHATBOT']), chatbotId: z.string().optional(),
  kinds: z.array(RetentionKindView),
  bounds: z.object({ minConversationDays: z.number(), minAuditDays: z.number(), maxDays: z.number(), shortenGraceDays: z.number() }),
  updatedAt: z.coerce.date().nullable(), updatedByEmail: z.string().nullable(),
});
export const RetentionPreviewResponseSchema = z.object({
  items: z.array(z.object({ kind: RetentionTargetKind, currentDays: z.number().nullable(), newDays: z.number().nullable(),
    shortening: z.boolean(), affectedCount: z.number().int().nullable(), firstPurgeAt: z.coerce.date().nullable() })),
  requiresConfirm: z.boolean(), confirmHint: z.string().optional(),   // "보존기간 단축" 또는 챗봇 이름
});
export const RetentionRunKind = z.enum(['PURGE', 'BACKFILL', 'REENCRYPT', 'CHAIN_VERIFY']);
export const RetentionRunItemSchema = z.object({ id, runId, kind, target: z.string().nullable(), chatbotId: z.string().nullable(),
  days, cutoff, affectedCount, status: z.enum(['SUCCEEDED','PARTIAL','FAILED']), resultCode, headSeq, headHash, anchorSeq, startedAt, finishedAt });
export const RetentionRunListQuerySchema = PaginationQuerySchema.extend({ kind: csvEnumArray(RetentionRunKind), chatbotId: z.string().optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional() });

export const GovernanceMapResponseSchema = z.object({
  mode: GovernanceMode, generatedAt: z.coerce.date(),
  storage: z.object({ kind: z.enum(['SQLITE_FILE', 'REMOTE_DB']), location: z.string(),          // 경로 또는 호스트 — 자격증명·쿼리 제거
    residency: z.enum(['NOT_CONFIGURED', 'ALLOWED', 'NOT_ENFORCED']), allowedDirs: z.array(z.string()), allowedDbHosts: z.array(z.string()),
    atRestEncryptionDeclared: z.boolean() }),
  egress: z.object({ allowedHosts: z.array(z.string()),
    exits: z.array(z.object({ exitId: EgressExitId, configured: z.boolean(), host: z.string().nullable(), dataKind: EgressDataKind,
      masked: z.enum(['YES', 'NO', 'PER_CONNECTION']), decision: EgressDecision, rawTextOffHost: z.literal(true).optional() })),
    legacyConnections: z.array(z.object({ connectionId: z.string(), name: z.string(), host: z.string(), enabled: z.boolean(),
      decision: EgressDecision, allowRawPersonalData: z.boolean(), blockedLast24h: z.number().int() })) }),
  encryption: z.object({ enabled: z.boolean(), writeKeyId: z.string().nullable(), keyIds: z.array(z.string()),
    fields: z.array(z.object({ field: EncryptedFieldId, plaintextRows: z.number().int(), byKey: z.record(z.string(), z.number().int()),
      unknownKeyRows: z.number().int() })),
    statsComputedAt: z.coerce.date().nullable(), passInProgress: z.boolean() }),
  retention: z.object({ global: z.array(RetentionKindView), chatbotOverrideCount: z.number().int(), nextWindowStartAt: z.coerce.date().nullable(),
    jobEnabled: z.boolean(), lastRuns: z.array(RetentionRunItemSchema), bounds: RetentionPolicyResponseSchema.shape.bounds,
    auditMinimumLowered: z.literal(true).optional() }),
  auditChain: z.object({ method: z.enum(['SHA256', 'HMAC']), signingKeyId: z.string().nullable(),
    head: z.object({ seq: z.number().int(), hash: z.string() }).nullable(),
    lastVerification: z.object({ at: z.coerce.date(), status: z.string(), checkedRows: z.number().int() }).nullable() }),
  risks: z.object({ v1PlainHeaderNodes: z.number().int(), v1PlainHeaderSnapshots: z.number().int().nullable(), snapshotScanAt: z.coerce.date().nullable(),
    rawPersonalDataConnections: z.number().int(), externalLlmAugmentation: z.boolean(), piiMaskMode: PiiMaskModeSchema }),
});
```

### 4.2 기존 스키마 확장 (전부 값 추가·선택 키 — 하위 호환)

| 파일 | 변경 |
|---|---|
| `audit.ts` | `AuditAction` += `VIEW`(라벨 "열람")·`EXPORT`("내보내기") — 14 → **16**, 파괴적 목록 불변 · `AuditTargetType` += `ConversationLog`("대화")·`UnansweredQuestion`("학습 항목")·`AuditLog`("이력")·`TestRun`("검증 실행")·`RetentionPolicy`("보존 정책")·`RetentionRun`("보존기간 파기") — 21 → **27** · `AuditLogDetailSchema` += `chain: z.object({ seq, prevHash, rowHash, method: z.enum(['SHA256','HMAC']) }).optional()` · **`AuditLogListItemSchema` 불변** · `AuditChainVerifyRequestSchema = { from, to }` · `AuditChainVerifyResponseSchema = { status: z.enum(['OK','EMPTY','HASH_MISMATCH','SEQ_GAP','TAIL_MISSING','ANCHOR_MISSING','KEY_UNAVAILABLE']), firstBadSeq?, gap?: { fromSeq, toSeq }, range: { fromSeq, toSeq } \| null, checkedRows, preChainRows, outOfChainRows, head: { seq, hash }, methods: { sha256: n, hmac: n }, verifiedAt }` · `AUDIT_CHAIN_LIMITS = { verifyMaxRows: 200_000, verifyBatch: 5_000 }` |
| `legacy-api.ts` | `ApiCallOutcome` += `EGRESS_BLOCKED`(18 → 19) |
| `common.ts` | `ApiErrorCode` += `EGRESS_HOST_NOT_ALLOWED` · `RETENTION_OUT_OF_RANGE`(주석: "데이터 거버넌스(No.45) — 2종") |
| `handoff.ts` | `TranscriptEntry` BOT_TURN·HANDOFF에 `purged: z.literal(true).optional()` · 이력 상세 메시지 동일 |
| `survey.ts` | `SurveyTextAnswerItem`·응답 목록 답 항목에 `purged?: true` |
| `learning.ts` | 목록·상세 항목 `purged?: true` · `lastFeedback.purged?: true` |

> 선택 키는 **값이 있을 때만** 응답에 넣는다(키 생략 = 기존 바이트 동일 — No.40/44 규약).

---

## 5. 거버넌스 모드와 기동 검증 (`GovernanceBootstrapService.onModuleInit`)

### 5.1 순서 (어느 단계든 실패 = 예외 → Nest 앱 생성 실패 = 기동 실패)

| # | 단계 | 모드 OFF | 모드 ON |
|---|---|---|---|
| 1 | 키링 파싱(`env-key.provider.ts` — 값 설정 시에만) | 형식 오류면 실패(설정한 값이 틀린 것은 모드와 무관한 설정 오류) | 동일 |
| 2 | 교차 검사: `ENCRYPTION_ENABLED ⇒ 쓰기 키 존재` | (zod `validate()`가 모드 조건 선검사) | 키 없으면 실패 |
| 3 | 저장 위치 검사(§5.2) | 건너뜀 | `ALLOWED_DIRS`/`DB_HOSTS` 설정 시 실패 가능 |
| 4 | 출구 기동 검사(§6.4) | 건너뜀 | 설정된 기본 URL 호스트가 목록 밖이면 실패 |
| 5 | 키 사용 행 검사(§5.3) | **키링 설정 시에만** | 항상 |
| 6 | 런타임 설치: `installGovernanceRuntime()` · `configurePiiMaskMode()` | OFF 값 설치(= 기본) | ON 값 설치 |
| 7 | 행 보장: `AuditLogService.ensureChainHead()`(§10.4) · `GovernanceJobState` 2행 create-if-absent(P2002 무시) | 실행(부팅 쿼리 ≤4) | 동일 |
| 8 | 잡 시작: 파기 잡(`DATA_RETENTION_JOB_ENABLED`) · 암호화 잡(`DATA_REENCRYPT_JOB_ENABLED` ∧ 키링 있음) | 파기 잡만(정책 없으면 할 일 없음) | 동일 |
| 9 | `info` 로그 1줄: 모드 · 출구 판정 요약(호스트만) · 암호화 켜짐/키 id · 체인 방식·머리(seq·해시 앞 12자) · 마스킹 강도 | 동일 | 동일 |

- 오류 메시지 규약: 경로·호스트·키 **id**·행 수만 — **비밀번호·키 값·쿼리 문자열·Gemini `?key=` 0**(NFR-DGS1).
- 요청 경로의 추가 조회는 0이다 — 위 쿼리는 전부 부팅 1회(FR-0-161).

### 5.2 저장 위치 검사 (순수 함수 `checkResidency(databaseUrl, allowedDirs, allowedDbHosts, fs)`)

- `file:`(SQLite): **상대 경로면 실패**("거버넌스 모드에서는 절대 경로 필요" — Prisma의 상대 경로 기준이 `prisma/` 디렉터리라 운영자 오인이 잦다). 파일이 있으면 `realpath`, 없으면 부모 디렉터리 `realpath` + 파일명. 허용 디렉터리도 `realpath`. 판정 = `path.relative(allowed, target)`가 `..`로 시작하지 않고 절대 경로가 아님. **Windows는 대소문자 무시 비교.** 심볼릭 링크로 밖을 가리키면 실패(AC-DG2-1).
- 원격(`postgresql://` 등): `new URL()`의 `hostname`(자격증명 제거)을 `DATA_RESIDENCY_ALLOWED_DB_HOSTS`와 정확 일치(대소문자 무시).
- 두 목록이 모두 비면 검사 생략 + 데이터 지도 `residency: 'NOT_CONFIGURED'` 경고(FR-DG2-3).

### 5.3 키 사용 행 검사 (FR-DG4-9 · NFR-DGP6 — 기동 1회 접두 검색)

- 대상 3필드마다: `findFirst({ where: { col: { startsWith: 'enc:v1:' }, AND: known.map(k => ({ NOT: { col: { startsWith: `enc:v1:${k}:` } } })) }, select: { id, col } })` → 행이 있으면 그 키 id를 파싱해 `count({ col startsWith 'enc:v1:<id>:' })` → 알려진 목록에 임시 추가 후 반복(최대 10회).
- 미지 키가 1개라도 있으면 **실패**: "키 `k1`이 필요한 행 12,033개(상담 메시지·설문 자유 텍스트) — 키링에서 제거하기 전에 재암호화를 완료하세요".
- 비용: 필드당 `LIKE 'enc:v1:%'` 풀스캔 1~2회(인덱스 없음). 기준 규모(암호문 100만 행)에서 합계 ≤2초를 실측·기록한다(§17). 카운트 캐시 테이블은 **기각** — 쓰기 경로(상담·설문 적재)마다 카운터 갱신이 붙고 소거·재암호화와 정합을 맞춰야 한다(ADR-0040 대안표).

---

## 6. 외부 전송 통제 (출구 게이트)

### 6.1 출구 레지스트리 5클래스 (`common/egress/egress-registry.ts` — 코드 상수 1곳)

| exitId | 파일(정적 검사 대조 대상) | 설정 | 송신 데이터 | 마스킹 | 차단 시 기존 흐름 |
|---|---|---|---|---|---|
| `EMBEDDING` | `embedding/providers/http-embedding.provider.ts`(fetch 2) | `EMBEDDING_BASE_URL` | **공개 대화 질의 원문**(`QUERY_RAW`) + 자산·TC·힌트(마스킹본) 문장 | ❌(질의) | `EmbeddingProviderUnavailableError` → 의미 매칭 저하(규칙 매칭) |
| `RAG` | `rag/rag-http.client.ts`(fetch 1) | `RAG_BASE_URL` | 마스킹 질문(`QUESTION_MASKED`) | ✅ | `{ networkError: true }` → RAG 실패 분기 |
| `AUGMENT_GEMINI` | `augmentation/providers/gemini-augmentation.provider.ts`(fetch 1) | `AUGMENTATION_PROVIDER=gemini` ∧ 키 ∧ `AUGMENTATION_GEMINI_BASE_URL`(기본 `https://generativelanguage.googleapis.com` — 상수 export) | 예문 시드(`SEED_MASKED`) | ✅ | 빈 배열 → G1 폴백 |
| `AUGMENT_LOCAL` | `augmentation/providers/local-augmentation.provider.ts`(fetch 2) | `AUGMENTATION_PROVIDER=local` ∧ `AUGMENTATION_LOCAL_BASE_URL` | 예문 시드(`SEED_UNMASKED` — 관리자 자산 + 이미 마스킹된 학습 반영 예문) | ❌ | 빈 배열 → G1 폴백 · `healthy()=false` |
| `LEGACY_API` | `legacy-api/legacy-api-http.client.ts`(DNS 전 판정) · `legacy-api/transport/node-http.transport.ts`(`request` 직전 재판정) · `legacy-api/transport/node-dns.resolver.ts`(DNS — 호스트명만) | `ApiConnection.baseUrl`(DB) | 폼 슬롯 값(`FORM_SLOT`) | 연결별(`allowRawPersonalData`) | `{ kind:'ERROR', outcome:'EGRESS_BLOCKED' }` → 실패 분기 · `ApiCallLog.outcome=EGRESS_BLOCKED` |

- 개발 도구 `classifier/eval/**`(수동 스크립트)는 **명시 제외 목록**이다(G-1).
- 웹훅·메일·SMS 출구는 없다. 브라우저가 부르는 외부 리소스는 서버 출구가 아니다(범위 밖).

### 6.2 허용 목록 문법 · 판정 (`egress-guard.ts` — 순수)

- 항목 = `host` | `host:port` | `*.suffix` | `*.suffix:port`. 공백 제거·소문자·중복 제거. IPv6는 `[::1]:8000` 형식. 잘못된 항목(스킴·경로 포함 등)은 **기동 실패**(zod refine — 조용한 무시 금지).
- 대상 = `new URL(url)`의 `hostname`(IDN은 punycode로 정규화됨) + 유효 포트(명시 포트 또는 스킴 기본 80/443).
- 일치 = 정확 일치 또는 `*.suffix`의 **접미 일치**(`a.b.suffix` ✅ · `suffix` 자체 ❌ — 루트 도메인은 별도 항목 필요). 항목에 포트가 있으면 포트도 일치해야 한다.
- **루프백·사설 주소 자동 허용 없음**(EX-DG-3) — 같은 서버 ml-worker도 `127.0.0.1:8000`을 적어야 한다. "데이터가 어디로 가는가"를 목록 하나로 설명하기 위해서다.
- 모드 OFF(`enforce=false`): `checkEgress()`가 **URL 파싱도 하지 않고** `ALLOWED`를 돌려준다(FR-DG3-6 · AC-DG2-5).

### 6.3 가드 위치 · 차단 시 동작 · 폴백

```ts
// egress-guard.ts
export function checkEgress(exitId: EgressExitId, url: string): 'ALLOWED' | 'BLOCKED';           // enforce=false면 즉시 ALLOWED
export function assertEgressAllowed(exitId: EgressExitId, url: string): void;                     // BLOCKED면 throw new EgressBlockedError(exitId, host)
export class EgressBlockedError extends Error { /* message = `EGRESS_BLOCKED exit=${exitId} host=${host}` — URL·쿼리·키 없음 */ }
```

- **임베딩**: `postJson()`·`fetchHealth()`의 기존 `try` 안, `fetch(` 바로 앞. 예외는 기존 `catch`가 `EmbeddingProviderUnavailableError('ml-worker 호출 실패')`로 수렴 → 호출부 저하 모드(대화 계속). `connect()` 단계에서 막히면 provider가 만들어지지 않아 의미 매칭 비활성(기존 "ml-worker 미기동"과 동일 경로).
- **RAG**: `send()`의 `try` 안. 기존 `catch`가 `warn`(메시지에 호스트만) + `{ networkError: true }`.
- **Gemini**: `callGemini()`에서 `fetch` 직전(URL에 `?key=`가 있으므로 가드는 **`baseUrl`로 판정**하고 오류 메시지에 호스트만). 예외는 `generate()` catch → `recordFailure()` + `[]`(G1 폴백).
- **로컬 증강**: `generate()`·`healthy()` 각 `try` 안 → `[]`/`false`.
- **레거시**: §6.5.
- **런타임 차단은 사실상 레거시에서만 발생한다** — 나머지 4클래스의 호스트는 환경변수라 기동 검사(§6.4)가 이미 막는다. 4클래스의 런타임 가드는 **봉인 일관성과 방어 이중화**를 위한 것이며, 차단 건수는 레거시만 `ApiCallLog`로 집계한다(별도 차단 로그 테이블 기각 — ADR-0040 대안표).

### 6.4 기동 검사 (모드 ON)

| 조건 | 판정 대상 URL | 실패 메시지 예 |
|---|---|---|
| `EMBEDDING_BASE_URL` 설정 | 그 값 | "외부 전송 허용 목록에 없는 호스트(10.0.0.5:8000) — 임베딩(질의 원문 송신)" |
| `RAG_BASE_URL` 설정 | 그 값 | "… — 외부 RAG" |
| `AUGMENTATION_PROVIDER=gemini` ∧ API 키 설정 | `AUGMENTATION_GEMINI_BASE_URL` ?? 기본 상수 | "… (generativelanguage.googleapis.com) — 증강 생성기" (S-1) |
| `AUGMENTATION_PROVIDER=local` ∧ URL 설정 | 그 값 | "… — 로컬 증강 생성기" |
| 허용 목록 비어 있음(EX-DG-1) | 위 설정이 하나라도 있으면 실패 · 없으면 기동 + 지도 "외부 전송 없음" | |

- 레거시 연결은 기동 실패 사유가 아니다(DB 데이터 — 콘솔이 고칠 수 있어야 한다). 지도에 연결별 `BLOCKED`로 표시한다.

### 6.5 레거시 — 저장 시 검사 · 호출 시 차단 · 주소 방어는 그대로

- **저장**(`ApiConnectionsService` 생성·수정 — `baseUrl`이 바뀌는 수정만): `checkEgress('LEGACY_API', baseUrl) === 'BLOCKED'` → `400 EGRESS_HOST_NOT_ALLOWED`("외부 전송 허용 목록에 없는 호스트입니다(서버 설정 필요)" · `details[0].field='baseUrl'`). 기존 사용 중지(`enabled=false`)·삭제는 허용.
- **호출**(`LegacyApiHttpClient.send()` 첫 줄 — **DNS 조회 전**): 차단이면 `{ kind: 'ERROR', outcome: 'EGRESS_BLOCKED' }` 반환 → 서비스는 기존 오류 결과 처리(실패 분기·고정 문구 · 회로 분류 `NEUTRAL` — 인프라 실패로 세지 않는다) · `ApiCallLog.outcome='EGRESS_BLOCKED'`. **송신 0**(전송 목 호출 0 — AC-DG2-3).
- `NodeHttpTransport.request()`는 `transport.request` 직전에 한 번 더 `checkEgress()`(차단 시 `{ kind:'ERROR', outcome:'NETWORK_ERROR', errorCode:'EGRESS_BLOCKED' }`) — 클라이언트 우회 경로 방어.
- **호스트 허용은 주소 검사를 대체하지 않는다**(NFR-DGS4 · EX-DG-2): 허용 호스트라도 DNS 결과가 절대 차단 대역·비허용 사설 대역이면 기존 `BLOCKED_ADDRESS`.
- 시뮬레이터 목(`mock-outcome.ts`)은 `EGRESS_BLOCKED`를 실패 재현 값으로 받는다(1줄). `guidanceFor()`에 안내 문구 1개.

### 6.6 ★ 임베딩 출구의 질의 원문 송신 (C-9 — P-1 지시 사항)

현황: 공개 대화 질의가 `semantic-match.service.ts` 39행에서 **마스킹 없이** `EMBEDDING_BASE_URL`로 간다(의미 매칭 품질 — 마스킹하면 전화·주문번호 질의의 의미가 깨진다). 이 그룹의 처리는 **"숨기지 않고 드러내고, 통제 안에 둔다"** 이다.

1. **분류**: 레지스트리에서 `dataKind='QUERY_RAW'`·`masked='NO'` — 5클래스 중 사용자 원문을 보내는 **유일한 상시 출구**로 명시.
2. **통제**: 모드 ON이면 호스트가 허용 목록에 있어야 기동한다(§6.4) — 운영자가 "원문이 이 호스트로 간다"를 설정으로 승인하는 구조.
3. **경고**: 호스트가 루프백(`127.0.0.0/8`·`::1`·`localhost`)이 아니면 지도에 `rawTextOffHost: true`("질의 원문이 이 서버 밖으로 전송됩니다") + 기동 `warn` 1줄. (사설 대역도 "서버 밖"이다 — 같은 서버가 아니면 경고한다.)
4. **하지 않는 것**: 질의 마스킹(품질 저하 — 요구사항 §9 범위 밖 · 재검토 트리거 "ml-worker가 원격이어야 하는 규제 고객") · 임베딩 캐시 암호화(메모리 LRU — 프로세스 밖으로 나가지 않는다).
5. 로컬 증강의 `SEED_UNMASKED`는 사용자 원문이 아니라 자산 문장이다(학습 반영 예문은 수집 시 이미 마스킹 — ADR-0013). 지도에는 "마스킹 없음"으로만 표시(EX-DG-22).

### 6.7 ml-worker 모델 내려받기

애플리케이션 통제 밖이다(ml-worker 코드 변경 0). 운영 문서(patches F-1)에 "거버넌스 모드 설치는 모델을 사전 배치하고 `HF_HUB_OFFLINE=1`"을 명시한다(FR-DG3-8).

---

## 7. 필드 암호화

### 7.1 대상 (P-2 (b) — `common/crypto/encrypted-fields.ts` 상수 1곳)

| `EncryptedFieldId` | 모델.컬럼(테이블.컬럼) | 쓰기 파일 | 읽기(개봉) 파일 |
|---|---|---|---|
| `HANDOFF_RAW_TEXT` | `HandoffMessage.rawText` (`handoff_messages.rawText`) | `handoff-thread.service.ts` | `handoff-transcript.service.ts`(표시 판정 통과 행만) |
| `HANDOFF_TEXT` | `HandoffMessage.text` | 동일(4 create) | transcript · history · public-poll · gate(구버전 편승 전달) · hints |
| `SURVEY_TEXT_VALUE` | `SurveyAnswer.textValue` | `survey-response.service.ts` | `survey-results.service.ts`(목록·자유 텍스트·CSV — CSV·표시 lib에는 개봉된 값을 넘긴다) |

- **개봉 파일은 6개**(handoff 5 + `survey-results.service.ts`) + 재암호화 시 writer. 대화로그·미응답 큐 본문은 2차(블라인드 인덱스 — C-2). 스냅샷·목 응답·감사 before/after는 대상 아님.

### 7.2 봉투 포맷 · 알고리즘 · AAD

- 형식: **`enc:v1:<keyId>:<base64(iv‖ciphertext‖tag)>`** — `v1` = 봉투 버전 태그, `keyId` = `^[a-z0-9]{1,8}$`, IV 12바이트(무작위, `crypto.randomBytes`) · 태그 16바이트 · 표준 base64(`:` 미포함). Node 내장 `crypto`의 `aes-256-gcm`(신규 의존성 0).
- **AAD = `<테이블>:<컬럼>:<행 id>`**(예 `handoff_messages:rawText:6f1…`) — 암호문을 다른 행·컬럼에 붙이면 태그 검증이 실패한다(AC-DG3-2). 이를 위해 쓰기 파일이 **행 id를 앱에서 선발급**한다(`randomUUID()` → `data.id`).
- 평문 판별: `enc:v1:` 접두가 없으면 평문(기존 행·암호화 끔 상태 — P-8).
- 빈 문자열(`''` — 소거값)은 암호화하지 않는다(`sealField('')` = `''`).
- UTF-8 왕복(한글·이모지·결합 문자) 픽스처 시험(EX-DG-19).

### 7.3 키링 · `KeyProvider` (P-7)

```ts
// env-key.provider.ts — ★ DATA_ENCRYPTION_KEYS · AUDIT_CHAIN_KEY 읽기 유일 파일(G-4). KMS·HSM(2차)은 이 파일의 구현체 교체.
export interface KeyProvider { writeKeyId(): string | null; hasKey(id: string): boolean; keyIds(): string[];
  aesGcmSeal(aad: string, plaintext: string): string; aesGcmOpen(keyId: string, aad: string, payload: Buffer): string; }
export function fieldKeyProvider(): KeyProvider;          // 지연 1회 파싱 · 형식 오류는 KeyringFormatError(키 id·원인만)
export function auditChainSigner(): { keyId: string | null; sign(input: string): string; verify(keyId: string, input: string): string | null };
```

- 키 바이트를 반환하는 export는 없다. 오류·로그·응답·지도에는 **키 id와 행 수만**(NFR-DGS1).
- 첫 항목 = 쓰기 키, 나머지 = 읽기 전용. 키 교체 = 새 키를 **앞에** 추가 후 재기동 → 신규 쓰기는 새 키 → 잡이 옛 키 행을 재암호화 → 지도 "옛 키 행 0" 확인 후 제거·재기동(S-8). 먼저 지우면 §5.3이 막는다(AC-DG3-4).
- **키 분실 = 영구 손실**(EX-DG-6) — 키 백업·교체 절차는 운영 문서(patches F-1).

### 7.4 쓰기 경로 (`sealField`) — 순서: 금지어 → PII 마스킹 → **암호화**(저장 직전 마지막)

```ts
export function sealField(field: EncryptedFieldId, rowId: string, plaintext: string): string;
// 규칙: plaintext === '' → '' · runtime.encryptionEnabled → 쓰기 키로 봉인 ·
//       꺼짐 ∧ 키링 있음 ∧ plaintext.startsWith('enc:') → 봉인(평문이 봉투로 오독되는 것 방지) · 그 밖 → 평문 그대로(미설치 = 현행)
```

- `handoff-thread.service.ts`: 사용자 메시지 — `masked`(평문) 계산·`rawText = masked !== rawInput ? rawInput : null` 비교는 **평문 기준 그대로**, `data`에만 봉인값. 반환 `{ seq, maskedText: masked }` 불변(상담원 화면·위젯 응답은 평문). 상담원·SYSTEM(연결·종료·실패·인수 사유) 메시지도 `text`를 봉인한다(필드 단위 규칙을 단순하게 — 행마다 판단하지 않는다).
- `survey-response.service.ts`: `buildAnswerRows()` 결과에 `id`를 붙이고 `textValue !== null`이면 봉인. 멱등 키 `(responseId, questionKey, choiceKey)`와 무관(재적재 시 P2002 흡수 로직 불변).
- 금지어·PII 순서 봉인(H-13·S-11)은 그대로 통과한다 — 봉인은 그 뒤에 붙는다.

### 7.5 읽기 경로 (`openField`) · 실패 처리

```ts
export function openField(field: EncryptedFieldId, rowId: string, stored: string | null): string | null;
// 키링 없음 → stored 그대로(파싱 0 — 모드 OFF 바이트 동일) · 평문 → 그대로 · 봉투 → 개봉 ·
// 실패(키 없음·태그 불일치·손상) → DECRYPT_FAILED_TEXT("[복호화 실패]") + warn(필드·행 id·키 id만) — 요청은 성공(FR-DG4-4)
```

- 응답 모양·값은 암호화 전과 **동일**하다(AC-DG3-1). 개봉 평문은 응답·CSV 외에 캐시·로그·trace·감사에 남기지 않는다(NFR-DGS2).
- 상담 힌트: `lastHandoffMsg.text`를 개봉한 마스킹본이 기존대로 의미 매칭 입력이 된다(원문 아님).
- 공개 상담 폴링·구버전 편승 전달: 상담원·SYSTEM 메시지 `text`를 개봉해 위젯에 보낸다(응답 바이트 불변).

### 7.6 백필 · 재암호화 잡 (`FieldCryptoJob` — P-8 · FR-DG4-7/8)

| 항목 | 규칙 |
|---|---|
| 시작 조건 | `DATA_REENCRYPT_JOB_ENABLED` ∧ 키링 있음. `PollingLoop`(60초) · `tick()` public |
| 임대 | `GovernanceJobState('FIELD_CRYPTO')` CAS 선점(`claimToken`, 10분) · 배치마다 갱신 · 실패(count 0) = 임대 상실 → 즉시 중단(C-7) |
| 할 일 판정 | `encryptionEnabled` ∧ (행 = 평문(비어 있지 않음·미소거) ∨ 쓰기 키 아닌 봉투) |
| 순회 | 필드별 **id 오름차순 커서**(`id > cursor`, `take: batch`) — 이미 처리한 행을 다시 훑지 않는다. 커서·`passKeyId`는 `state` JSON. 쓰기 키가 바뀌면 새 패스(커서 초기화) |
| 쓰기 | writer `reencryptBatch(field, rows)`: 한 트랜잭션 — `enableSecureDelete(tx)` → 행마다 `updateMany({ where: { id, [col]: oldValue }, data: { [col]: newEnvelope } })`(**CAS** — 그 사이 정리 루프가 `rawText`를 `null`로 만들었거나 파기가 `""`로 만들었으면 0건 → 건너뜀) |
| 양보 | 배치 간 `DATA_RETENTION_BATCH_PAUSE_MS` · tick당 최대 20,000행(상수) — 공개 대화 로그 적재를 막지 않는다(NFR-DGP3) |
| 재시작 | 커서가 DB에 있어 멱등 재개 · 임대 만료 후 다른 인스턴스 인수(EX-DG-7) |
| 통계 | 패스 완료 시 + 유휴 시 1시간마다: 필드별 평문 행 수 · 키별 행 수 · 미지 키 행 수(`startsWith` count) → `state.stats`·`statsComputedAt`(지도가 읽는다 — 요청 시 풀스캔 0) |
| 이력 | 패스 완료·실패 시 `RetentionRun(kind=BACKFILL｜REENCRYPT, target=field, affectedCount)` |

### 7.7 끄기 · 키 제거 (P-8 · FR-DG4-10)

- `DATA_ENCRYPTION_ENABLED=false` + 재기동: 신규 쓰기 평문 · 기존 암호문은 키가 있는 한 개봉 · 잡은 재작성하지 않고 통계만 갱신 · 지도 "암호문 N행 잔존(키 필요)" 경고. 전량 복호화 스크립트는 2차.
- 콘솔에는 켜기/끄기·키 컨트롤이 **없다**(P-4 · AC-DG8-2).

### 7.8 ★ 상담 원문 표시 정책(No.24 P-9) × 암호화 × 열람 감사

| 관점 | 규칙 |
|---|---|
| 보관 | `rawText`는 여전히 **활성 상담·마스킹본과 다를 때·최대 60분**만 존재한다(ADR-0036 불변). 암호화가 켜져 있으면 그 60분 동안에도 DB에는 봉투만 있다(DB 파일·백업 유출 대비). |
| 소거 | 종료 CAS 트랜잭션·60초 정리 루프·절대 상한의 `rawText=null`(+`secure_delete`)은 **암호화와 무관하게 그대로**(AC-DG3-6). 재암호화 잡은 `rawText` CAS로 소거와 경합해도 소거가 이긴다(§7.6). |
| 개봉 시점 | `handoff-transcript.service.ts`가 기존 `canViewRaw()`(담당자·ADMIN·`cs:write`·상담 중·`includeRaw`) → 행별 `showRaw`(CONNECTED ∧ 만료 전)를 **먼저** 판정하고, **통과한 행만** `openField('HANDOFF_RAW_TEXT', …)`를 부른다 — 표시되지 않을 원문은 메모리에서도 평문이 되지 않는다. |
| 개봉 실패 | 원문을 `"[복호화 실패]"`로 보여 주지 않고 **`rawText` 키를 생략**(마스킹본만 표시) · 그 행은 `anyRawShown` 계산에서 빠진다 → 원문이 실제로 실리지 않았으므로 `RAW_VIEW`도 남지 않는다. |
| 열람 감사 | `RAW_VIEW`(원문 실제 노출 · (상담, 열람자)당 1건 · **모드 무관**)는 불변. 모드 ON에서는 같은 요청이 `@AuditView`로 `VIEW`(대화 보기 = 마스킹본 열람 · (열람자, 세션, KST 일)당 1건)도 남긴다 — **두 기록은 의미가 다르다**(FR-DG8-5). 2초 폴링은 인스턴스 로컬 중복 억제로 DB 조회 1회/일. |
| 보존 파기 | `HANDOFF_TEXT` 소거는 **종료된 상담**의 메시지만(EX-DG-9) — 진행 중 원문 표시와 충돌하지 않는다. |
| 마스킹 강도 | `FULL`이면 전화·이메일이 전량 치환되지만 `masked !== raw`인 메시지(= 원문이 보관되는 메시지)의 범위는 PARTIAL과 같다(PII가 있을 때). 원문 정책은 넓어지지 않는다. |
| 정책 불변 | 원문 열람 권한 위임·60분 연장·상담원 발신 원문은 범위 밖(ADR-0036 재검토 트리거 유지). |

---

## 8. 보존 정책

### 8.1 대상 종류 6 (`RetentionTargetKind`)

| kind | 범위 | 재정의 | 하한 | 방식(§9.2) |
|---|---|---|---|---|
| `CONVERSATION_TEXT` | `ConversationLog` 본문 | 챗봇 | 대화 하한 | 텍스트 소거 |
| `UNANSWERED_CLOSED` | 종결 미응답·부정 평가 항목 텍스트 | 챗봇 | 대화 하한 | 텍스트 소거 |
| `SURVEY_FREE_TEXT` | `SurveyAnswer.textValue` | 챗봇 | 대화 하한 | 텍스트 소거 |
| `HANDOFF_TEXT` | 종료 상담 `HandoffMessage.text` | 챗봇 | 대화 하한 | 텍스트 소거 |
| `CALL_LOGS` | `RagCallLog`+`ApiCallLog` | 전역만 | 1 | 행 삭제 |
| `AUDIT_LOGS` | `AuditLog` + `RetentionRun` | 전역만 | 감사 하한 | 행 삭제 + 앵커 |

- `MessageFeedback`(텍스트 0)·운영 테이블은 1차 대상 아님(§26).

### 8.2 유효 일수 (순수 함수 `resolveEffectiveDays(kind, globalRow, chatbotRow, now, bounds)`)

1. 전역 값 = (전역 `pending[kind]` ∧ `effectiveAt ≤ now` ? pending.days : 전역 `days[kind]`) — 키 없음 = 무기한(null).
2. 챗봇 값(대화 원천 4종) = 같은 규칙으로 챗봇 행에서 — `'GLOBAL'`/키 없음 = 1의 값.
3. 값이 유한이면 `max(값, 하한)`으로 **실행 시 클램프**(환경변수 하한이 저장 후 올라간 경우 — 지도 `belowServerMinimum`).
4. **기준 시각 `cutoff = KST 자정(now) − days × 24h`**(UTC 순간) — 같은 날 몇 번 돌아도 기준이 같고 "04-06 이전"으로 표시된다.

### 8.3 저장 규칙 (`RetentionPolicyService` — `RetentionPolicy` 쓰기 유일 파일)

- 범위: 유한 값은 `[하한, RETENTION_MAX_DAYS]`, 위반 = `400 RETENTION_OUT_OF_RANGE`(`details[].field = kind` · 메시지에 허용 범위). `AUDIT_LOGS` 콘솔 입력은 감사 하한 미만 불가(AC-DG4-2).
- 트랜잭션: 행 읽기 → **도래한 pending을 days로 흡수**(저장 상태 정리) → 종류별 비교:
  - **단축**(새 값 < 현재 유효 값, 무기한 → 유한 포함): `pending[kind] = { days, effectiveAt: now + grace }`(이미 대기 중이면 **교체 + 유예 재시작**).
  - **연장·무기한 전환·동일**: `days[kind]`에 즉시 반영 + 그 kind의 pending 제거(EX-DG-13 — 이미 소거된 텍스트는 복구되지 않음을 응답·화면에 안내).
- 단축이 하나라도 있으면 `confirmText` 필수: 전역 = `"보존기간 단축"`, 챗봇 = 챗봇 이름(정확 일치 · trim) — 불일치 `400 CONFIRM_NAME_MISMATCH`(기존 코드 재사용).
- 감사 1건: `UPDATE`/`RetentionPolicy`(targetId = scopeKey · 챗봇 재정의면 `chatbotId`) — before/after = 종류별 일수 + 대기 종류·적용 시각(§11.1 화이트리스트). summary "보존기간 변경(단축 N종 유예 · 즉시 M종)".
- **유예 취소**(`POST …/pending/cancel`): pending 전체 제거 → 감사 `UPDATE` summary "보존기간 단축 예약 취소". 대기분 없으면 `404`.
- `RETENTION_SHORTEN_GRACE_DAYS=0`이면 단축도 즉시(운영자 선택 — 환경변수).
- 챗봇 복사·토픽 분리·버전 스냅샷은 재정의를 복사하지 않는다(별도 테이블 — `copy()`·캡처 무변경, AC-DG4-5).
- `ARCHIVED` 챗봇: 재정의 조회·저장 허용(거버넌스 설정 — 자산 아님), 파기 대상 포함(EX-DG-18).

### 8.4 미리보기 (`POST /governance/retention/preview` · `POST /chatbots/:chatbotId/retention/preview` — DB 변경 0)

- 종류별 `affectedCount` = 새 일수 기준 cutoff 이전 · 미소거 행 수(전역 미리보기는 **전역을 따르는 챗봇만** 합산 — 재정의 챗봇 제외) · `firstPurgeAt` = 단축이면 `effectiveAt` 이후 첫 창 시작, 즉시면 다음 창 시작 · `requiresConfirm`·`confirmHint`.
- 5초 초과 = `503 AGGREGATION_TIMEOUT`(기존 `runWithAggregationTimeout` 재사용).

### 8.5 챗봇 재정의 규칙

- 대화 원천 4종만 · 값 = 일수 | `null`(무기한) | `'GLOBAL'`(전역 따름 — 키 제거). 전역보다 긴 재정의도 허용(범위 안).
- 챗봇 재정의 행 = 영구삭제 동반 삭제(설정 데이터 — 사전검사 15종 불변).

---

## 9. 파기 잡 (`RetentionJob`)

### 9.1 실행 모델

| 항목 | 규칙 |
|---|---|
| 루프 | `PollingLoop`(ADR-0032 부품 — 세 번째 소비자) 5분 간격(상수) · `DATA_RETENTION_JOB_ENABLED` · `tick()` public(CLAUDE.md) |
| 창 | `isWithinKstWindow(now, DATA_RETENTION_WINDOW)` 밖이면 아무것도 하지 않는다(AC-DG5-7) · 자정 넘김 창 지원 |
| 선점 | `GovernanceJobState('RETENTION')` 임대 CAS(10분) — 1인스턴스만 실행(AC-DG5-4) · 배치마다 갱신 · 상실 시 `PARTIAL(LEASE_LOST)` |
| 하루 1회 | `lastCompletedDay == KST 오늘`이면 건너뜀 · `PARTIAL`이면 갱신하지 않아 같은 창의 다음 tick 또는 다음 날 창에서 **이어서**(AC-DG5-5) |
| 순서 | ① 대화 원천 4종(챗봇별 — ARCHIVED 포함) ② `CALL_LOGS` ③ `AUDIT_LOGS`(+ `RetentionRun`) ④ 주간 체인 검증(마지막 `CHAIN_VERIFY` ≥ 7일) ⑤ v1 평문 토큰 스냅샷 점검(주 1회 — §13) ⑥ 요약 기록 |
| 중단 | 창 종료·`stopping()`·1회 상한(`DATA_RETENTION_MAX_ROWS_PER_RUN`) 도달 → 현재 배치 커밋 후 `PARTIAL` |
| 정책 없음 | 전부 무기한이면 ①~③ 쿼리 0(정책 읽기 1회) — 모드 OFF 기본 설치의 부하는 5분마다 창 판정 + 창 안에서 정책 1회 읽기뿐 |

### 9.2 대상별 파기 (쓰기 = `governance-data.writer.ts` 1파일)

| kind | 선택(`findMany select id take batch orderBy 기준 asc`) | 한 배치 트랜잭션 |
|---|---|---|
| `CONVERSATION_TEXT` | `{ chatbotId, textPurgedAt: null, createdAt: { lt: cutoff } }` — 인덱스 `(chatbotId, textPurgedAt, createdAt)` | `enableSecureDelete(tx)` → `conversationLog.updateMany({ where: { id: { in }, textPurgedAt: null }, data: { userMessage: '', botResponse: '', textPurgedAt: now } })` |
| `UNANSWERED_CLOSED` | `{ chatbotId, status: { in: ['RESOLVED','IGNORED'] }, textPurgedAt: null, lastOccurredAt: { lt: cutoff } }` | 행마다 `updateMany({ where: { id, textPurgedAt: null }, data: { questionText: '', variants: '[]', questionNormalized: '#PURGED#' + id, textPurgedAt: now } })`(유일 키 보존 — C-②) · `PENDING`은 대상 아님(EX-DG-10) |
| `SURVEY_FREE_TEXT` | `{ surveyId: { in: 챗봇 설문 id }, textPurgedAt: null, textValue: { not: null }, answeredAt: { lt: cutoff } }` | `surveyAnswer.updateMany({ …, data: { textValue: '', textPurgedAt: now } })` — 선택·척도 행 불변 |
| `HANDOFF_TEXT` | `{ chatbotId, textPurgedAt: null, createdAt: { lt: cutoff }, handoffSession: { status: 'ENDED' } }` | `handoffMessage.updateMany({ …, data: { text: '', rawText: null, textPurgedAt: now } })`(rawText는 이미 null — 방어) |
| `CALL_LOGS` | `ragCallLog`·`apiCallLog` `{ createdAt: { lt: cutoff } }` id 배치 | `deleteMany({ where: { id: { in } } })`(봉인 대상 아님 — 영구삭제 동반 삭제 선례) |
| `AUDIT_LOGS` | ⓐ 체인 이전·폴백 행: `{ seq: null, createdAt: { lt: cutoff } }` ⓑ 체인 행: `S = (createdAt ≥ cutoff인 최소 seq) − 1`(없으면 헤드 seq) → `seq ≤ S` 오름차순 배치 | ⓐ `deleteMany` ⓑ 배치 마지막 행의 `(seq, rowHash)` 읽기 → `deleteMany({ seq: { gte, lte } })` + `auditChainAnchor.upsert({ id: 'RETENTION', seq, hash })` **같은 트랜잭션**(FR-DG7-4 · AC-DG5-3) · `retentionRun` `{ startedAt: { lt: cutoff } }` 삭제 |

- **행 삭제 0**: 대화 원천 4계열(`conversationLog`·`unansweredQuestion`·`surveyAnswer`/`surveyResponse`·`handoffMessage`/`handoffSession`·`messageFeedback`)의 `delete*`는 여전히 0건(R-1·R-2·S-1·H-1·F-1 불변 · FR-0-166). `LOG_DELETION_ALLOWLIST`는 **빈 배열 그대로**다.
- 모든 `updateMany`는 `textPurgedAt: null` CAS라 두 번 적용돼도 결과가 같다(멱등 · EX-DG-8).
- 체인 seq 기준 삭제는 **앞부분 연속 구간만** 지운다(중간 결손을 만들지 않는다). 시계 편차로 `createdAt < cutoff`인데 `seq > S`인 행은 다음 날 지워진다(보수적).
- 금지어 BLOCK 턴(`blockedByFilter`)도 동일하게 소거 대상이다(EX-DG-20).

### 9.3 배치 · 양보 · `secure_delete`

- 배치 = `DATA_RETENTION_BATCH_SIZE`(500) · 배치 간 `DATA_RETENTION_BATCH_PAUSE_MS`(200ms) — SQLite 단일 작성자에서 공개 대화 로그 적재(`record()` — fire-and-forget)가 배치 사이에 끼어든다(NFR-DGP3 · EX-DG-23).
- 소거·재암호화 트랜잭션은 **기존 `handoff/handoff-secure-delete.query.ts`의 `enableSecureDelete(tx)`를 import해 재사용**한다 — 원시 SQL 보유 파일 4개 불변(R-7). 행 삭제(호출 로그·감사)에는 적용하지 않는다(텍스트 없음 · 감사 before/after는 화이트리스트 요약).
- 저널·WAL·백업·파일시스템 잔존은 애플리케이션이 보증하지 않는다 — **디스크 암호화가 거버넌스 모드의 운영 전제**(C-8 · 데이터 지도 자기 신고 · patches F-1).

### 9.4 파기 이력 · 감사 · 체인 머리 기록

- `RetentionRun`: 실행마다 요약 1행(`target=null`) + **처리 건수 > 0 또는 실패**인 (대상, 챗봇) 행만(챗봇 수 × 종류의 빈 행 폭증 방지). 요약 행에 `headSeq`·`headHash`(체인 머리) · 감사 파기 시 `anchorSeq`.
- 감사 1건(유한 정책이 하나라도 있던 실행만): `PURGE` / `RetentionRun`(targetId = runId) · 주체 `system`(`actorOverride { id:null, email:'system', role:null }`) · after = `{ kind:'PURGE', status, affectedByKind: {…number}, headSeq, anchorSeq }` · summary "보존기간 파기" — **본문·행 id·`sessionId` 0**(FR-0-165 · AC-DG5-6).
- 서버 로그 `info` 1줄: 결과·종류별 건수·체인 머리(seq·해시 앞 12자) — 외부 대조용(FR-DG7-7).

### 9.5 소거 행의 표시 규칙 (API 표면 — FR-DG6-6)

| 화면(서비스) | 규칙 |
|---|---|
| 질문 순위(대시보드·No.14·통합 — `QUESTION_RANKING_LOG_FILTER` 5곳) | `textPurgedAt: null` 조건으로 **집계 제외**(빈 문자열 항목 생성 불가 · AC-DG5-2) |
| 대화 보기(transcript) | BOT_TURN `userText:''`·`botText:''` + `purged: true` · HANDOFF 동일 |
| 상담 이력 상세 | 메시지·봇 턴 `purged: true` |
| 설문 응답 목록·자유 텍스트 목록 | 해당 답 `purged: true`(행·건수 유지) |
| 설문 CSV(RESPONSES) | 소거 셀 = `보존기간 경과로 파기됨` |
| 미응답·부정 평가 목록/상세 | 종결 소거 항목 `purged: true` · `lastFeedback.purged: true`(EX-DG-11) |
| 상담 힌트 | 최근 로그가 소거면(`''`) 후보에서 제외(기존 빈 텍스트 경로) · 진행 중 목록 마지막 발화 동일(EX-DG-12) |
| 공개 API | 영향 없음(소거는 종료·오래된 데이터만) |

### 9.6 ★ 통계 수치 불변 논증 (AC-DG5-2)

- 소거가 바꾸는 컬럼은 `userMessage`·`botResponse`·`textValue`·`HandoffMessage.text/rawText`·UQ `questionText/variants/questionNormalized` + `textPurgedAt`뿐이다(G-8이 data 키를 정적으로 제한).
- 턴·세션·응답률·출처·시간대·그룹(`isAnswered`·`blockedByFilter`·`matched*`·`answeredByRag`·`dayBucket`·`hourBucket`·`sessionId`·`channelType`·`groupId`·`surveyTurn`·`handoffTurn`)은 **읽는 컬럼이 그대로**다. 설문 분포(`kind`·`choiceKey`·`numericValue`·`isHead`)·상담 건수(`HandoffSession`)·평가 원장도 동일.
- 텍스트를 읽는 통계는 질문 순위뿐이며 소거 행은 제외된다(소거 전 수치 = 필터 추가 전 수치 — 모든 기존 행의 `textPurgedAt`은 null).
- 알려진 차이: 종결 UQ 소거 후 같은 질문이 다시 들어오면 **새 PENDING 항목**이 생긴다(병합 키가 센티넬로 바뀌었다 — `recurredCount` 증가 대신). §23 L-3.

---

## 10. 감사 해시 체인 (P-6 — 모드 무관 항상)

### 10.1 구성

- `AuditLog.seq`(유일)·`prevHash`·`rowHash` · 싱글턴 `AuditChainHead('HEAD')` · 앵커 `GENESIS`/`RETENTION`.
- **번호는 커밋된 행에만** 부여된다 — 헤드 전진과 행 삽입이 한 트랜잭션이라 실패하면 둘 다 롤백된다(FR-DG7-6 · EX-DG-14 "번호 결손 없음"). 따라서 **`seq` 결손 = 삭제의 증거**다.

### 10.2 정규 직렬화 v1 · 해시

```ts
// audit-chain.ts (순수)
canonicalV1(row) = JSON.stringify(['cb-audit-v1', id, seq, createdAt.toISOString(), actorId, actorEmail, actorRole, action,
                                  targetType, targetId, targetName, chatbotId, beforeValue, afterValue, summary, ip, userAgent])   // 없는 값 = null
rowHash = signer.keyId ? `h1:${keyId}:${HMAC-SHA256(key, prevHash + '\n' + canonical)}` : `s1:${SHA-256(prevHash + '\n' + canonical)}`
```

- **배열**이라 키 순서 문제가 없다. `createdAt`은 `record()`가 `new Date()`로 **명시**하고 같은 값을 해시에 쓴다(ms 정밀도 — SQLite·Postgres `timestamp(3)` 왕복 동일 · C-③).
- 방식은 행마다 접두로 남는다 — `AUDIT_CHAIN_KEY`를 나중에 넣어도 이전 SHA 행은 SHA로 검증된다. HMAC 키 교체 = 새 키를 앞에, 옛 키는 검증 전용으로 남긴다(제거하면 그 키 행은 `KEY_UNAVAILABLE`).

### 10.3 `record()` 1곳 흐름 · 동시성

```
record(input):                                   // 호출 시점 규약(본 동작 커밋 후 · 실패 흡수) 불변
  스냅샷·직렬화 계산(기존)
  await localSerializer.run(async () =>          // 인스턴스 로컬 Promise 체인 — 같은 프로세스 경합 제거
    for attempt in 1..5:
      try $transaction(async tx =>
        head = tx.auditChainHead.findUnique('HEAD') ?? (ensureChainHead 후 재시도)
        id = randomUUID(); createdAt = new Date(); seq = head.headSeq + 1
        rowHash = hash(head.headHash, canonicalV1({...row, id, seq, createdAt}))
        n = tx.auditChainHead.updateMany({ where: { id:'HEAD', headSeq: head.headSeq }, data: { headSeq: seq, headHash: rowHash } })
        if n.count !== 1 → throw CHAIN_CONTENDED                    // 다른 인스턴스가 먼저 전진
        tx.auditLog.create({ data: { ...row, id, createdAt, seq, prevHash: head.headHash, rowHash } }))
        return
      catch (CHAIN_CONTENDED | P2002(seq) | SQLITE_BUSY) → 지터 5~25ms 후 재시도
    // 재시도 초과(또는 헤드 조회 불가): 체인 없이 기록 — 감사 행을 잃지 않는다
    prisma.auditLog.create({ data: { ...row } })   + warn("AuditLog 체인 기록 실패 — 체인 밖 기록: action=… code=…")
  )
  catch(전체) → 기존 warn(before/after 미포함)
```

- **CAS 헤드**라 Postgres에서도 행 잠금·권고 잠금 없이 정확하다(첫 커밋만 `count=1`). SQLite는 단일 작성자로 자연 직렬화되고 WAL 스냅샷 충돌(BUSY)은 재시도로 흡수한다.
- `auditLog.create` 호출은 여전히 이 파일 1곳이다(NFR-M3 — 폴백 포함 2회 등장, 같은 파일).
- 폴백 행(`seq=null`, 제네시스 이후 `createdAt`)은 검증 결과의 `outOfChainRows`로 **드러난다**(누락 은폐 아님). 요구사항 FR-DG7-8의 "실패 시 경고 로그만"보다 강하다(§24 R-6).
- 지연: 추가 쿼리 = 헤드 읽기 1 + 헤드 갱신 1(+ 트랜잭션) — P95 +5ms 이내(NFR-DGP2 · 실측).

### 10.4 기존 행 · 제네시스

- `ensureChainHead()`(부트스트랩 7단계 + 헤드 부재 시 `record()` 지연 호출): 한 트랜잭션에서 `count`·`max(createdAt)` of `audit_logs where seq is null` → `auditChainHead.create({ id:'HEAD', headSeq: 0, headHash: 'g1:genesis' })` + `auditChainAnchor.create({ id:'GENESIS', seq: 0, hash: 'g1:genesis', preChainRows, preChainMaxCreatedAt })` — `P2002`(다른 인스턴스가 먼저)면 무시.
- 도입 전 행은 체인 밖이며 검증 결과 `preChainRows`로 표시(AC-DG6-4). 제네시스 해시가 상수인 것은 보안상 문제 없다(체인 시작점 표식일 뿐 — 앞 행이 없다).

### 10.5 보존 삭제와 앵커

- 파기 잡이 체인 앞부분을 지우면 **마지막 삭제 행의 `(seq, rowHash)`를 `RETENTION` 앵커로 같은 트랜잭션에** 기록한다(§9.2). 검증은 `max(앵커.seq)`부터 시작한다.
- 앵커 값은 `RetentionRun.anchorSeq`·감사 `PURGE` after·서버 로그에도 남는다 — 앵커 테이블만 조작하는 공격을 교차 대조로 드러낸다.

### 10.6 검증 (`AuditChainVerifier` · `POST /audit-logs/verify` · 주간 자동)

| 단계 | 규칙 |
|---|---|
| 범위 | 요청 `{ from, to }`(기간 상한 `AUDIT_QUERY_MAX_RANGE_DAYS` — 초과 `400 AUDIT_RANGE_TOO_WIDE` 재사용) → 그 기간 체인 행의 `[minSeq, maxSeq]`. 행 수 > `verifyMaxRows`(200,000)면 같은 400. 주간 자동 = 앵커부터 헤드까지 전체(백그라운드 · 요청 스레드 점유 0 — NFR-DGP5) |
| 시작 해시 | `minSeq − 1` 행의 rowHash → 없으면 `seq = minSeq − 1`인 앵커 → 둘 다 없으면 `ANCHOR_MISSING`(삭제된 구간 뒤에서 시작 — 앵커도 없음) |
| 순회 | `seq` 오름차순 5,000행 배치 · 연속성(`seq = 직전+1` 아니면 `SEQ_GAP{fromSeq,toSeq}`) · `prevHash == 직전 rowHash` · `rowHash` 재계산(접두 방식 · HMAC 키 없음 = `KEY_UNAVAILABLE{keyId}`) · 첫 실패에서 중단(`firstBadSeq`) |
| 꼬리 | 전체 검증은 `max(seq) == 헤드.headSeq`까지 확인 — 헤드가 더 크면 `TAIL_MISSING`(최신 행 삭제) |
| 집계 | `checkedRows` · 기간 내 `preChainRows`(seq null ∧ createdAt ≤ 제네시스 `preChainMaxCreatedAt`) · `outOfChainRows`(seq null ∧ 그 이후 — 폴백·구버전) · 방식별 건수 · 헤드 |
| 기록 | 수동 검증은 저장하지 않는다(읽기) · 주간 자동은 `RetentionRun(CHAIN_VERIFY)` + 불일치 시 `warn` |

- 성능: 10만 행 ≤5초(SHA-256 10만 회 + 배치 읽기 20회 — 실측 · NFR-DGP5).

### 10.7 체인 머리의 외부 대조 (FR-DG7-7)

머리 `(headSeq, headHash)`를 ① 부팅 `info` 로그 ② 파기 잡 실행마다 `info` 로그·`RetentionRun` ③ 감사 CSV 표식 행 ④ 데이터 지도에 남긴다. 운영자가 로그 수집·출력물을 보관하면 "키 없는 전체 재계산"(EX-DG-16)을 대조로 탐지할 수 있다. 외부 봉인(WORM·타임스탬프 기관)은 새 외부 출구라 2차.

### 10.8 보증 범위 (NFR-DGS7 — 검증 화면·문서 명시)

- **탐지함**: 기록된 체인 행의 수정·삭제(중간·꼬리)·재배열 · 키가 있으면 키 없는 위조.
- **탐지 못 함**: 기록 자체의 실패(본 동작 성공 + 감사 누락 — ADR-0016 §4 역방향 결손) · 키 없는 설치에서 DB 쓰기 권한자의 전체 재계산(외부 대조로만) · 서버·환경변수 장악.

---

## 11. 열람 · 내보내기 감사 (P-10)

### 11.1 액션 2종 · 대상 6종 · 화이트리스트

| 추가 | 값 | 비고 |
|---|---|---|
| `AuditAction` | `VIEW`(열람) · `EXPORT`(내보내기) | 14 → 16 · 파괴적 목록 불변 · `isBulkSummary += EXPORT`(고정 요약 스키마 — ADR-0016 §7 형식) |
| `AuditTargetType` | `ConversationLog` · `UnansweredQuestion` · `AuditLog` · `TestRun` · `RetentionPolicy` · `RetentionRun` | 21 → 27 · 전부 Prisma 모델명(§9.3 규칙 유지) |
| `AUDIT_FIELDS` | 앞 4종 `[]`(열람·내보내기는 요약만) · `RetentionPolicy: ['conversationTextDays','unansweredClosedDays','surveyFreeTextDays','handoffTextDays','callLogsDays','auditLogsDays','pendingKinds','pendingEffectiveAt']` · `RetentionRun: ['kind','status','affectedByKind','headSeq','anchorSeq']` | 텍스트 필드 0(G-18) |

- `PURGE`(라벨 "영구삭제")를 파기 요약에 재사용한다 — 화면에는 "영구삭제 · 보존기간 파기"로 읽힌다. 신규 `RETENTION` 액션은 기각(판정·필터 차이 0 · 개수만 늘어남 — ADR-0040 대안표).

### 11.2 `EXPORT` — 모드 무관 항상 · 닫힌 목록 3곳 (서비스에서 `AuditLogService.recordExport()`)

| 대상 | 호출 위치 | targetType / targetId | after(요약 — number·날짜·열거값만) |
|---|---|---|---|
| 감사로그 CSV | `AuditLogsService.export()` | `AuditLog` / `'*'` | `{ from, to, rows, truncated, actionFilterCount, headSeq }` |
| 설문 결과 CSV(SUMMARY·RESPONSES) | `SurveyResultsService.export()` | `Survey` / surveyId | `{ kind, from, to, rows, truncated, includeDuplicates, channel }` |
| TC 결과 CSV | `TestRunService.export()` | `TestRun` / runId | `{ rows }` |

- summary = "내보내기 · 설문 '<이름>' · 09-01~09-25 · 3,204행"(설문·세트 이름은 관리자 작성 · **검색어 원문·본문·`sessionId` 0** — NFR-DGS5). 자산 내보내기(FAQ·의도·키워드·TC 세트)는 대상 아님(AC-DG7-1).
- 응답 생성 후, 전송 전에 기록(실패 흡수 — 다운로드는 막지 않는다).

### 11.3 `VIEW` — 모드 ON에서만 · 닫힌 목록 8핸들러 (`@AuditView` 데코레이터)

| # | 핸들러 | targetType | targetId | chatbotId |
|---|---|---|---|---|
| V-1 | `LiveSessionsController#list` `GET /chatbots/:chatbotId/live-sessions`(진행 중 목록 — 마지막 발화 표시) | `ConversationLog` | `'*'` | 경로 |
| V-2 | `LiveSessionsController#transcript` `GET …/live-sessions/:sessionRef/transcript` | `ConversationLog` | `sessionRef`(해시 — 전체 sessionId 아님) | 경로 |
| V-3 | `HandoffsController#detail` `GET /chatbots/:chatbotId/handoffs/:handoffId` | `HandoffSession` | handoffId | 경로 |
| V-4 | `SurveyResultsController#responses` `GET …/surveys/:surveyId/responses` | `Survey` | surveyId | 경로 |
| V-5 | `SurveyResultsController#textAnswers` `GET …/surveys/:surveyId/text-answers` | `Survey` | surveyId(V-4와 같은 키 — 하루 1건) | 경로 |
| V-6 | `UnansweredQuestionsController#detail` `GET /chatbots/:chatbotId/unanswered-questions/:id`(미응답·부정 평가 상세) | `UnansweredQuestion` | id | 경로 |
| V-7 | `AuditLogsController#list` `GET /audit-logs` | `AuditLog` | `'*'` | null |
| V-8 | `AuditLogsController#findOne` `GET /audit-logs/:id` | `AuditLog` | id | null |

- **단위** = (열람자, targetType, targetId, chatbotId, KST 일) 1건(FR-DG8-4 · AC-DG7-2). `recordView()`: 모드 OFF → 즉시 반환(쿼리 0 · AC-DG7-3) → 인스턴스 로컬 LRU(10,000키)에 있으면 반환 → `auditLog.findFirst({ where: { actorId, action:'VIEW', targetType, targetId, createdAt: { gte: KST 오늘 0시 } } })`(인덱스 `(actorId, createdAt)`) → 없으면 `record()` → LRU 기록. 다중 인스턴스 중복은 허용(누락보다 중복 — `RAW_VIEW` 선례).
- 인터셉터는 **2xx 완료 후**에만 기록(권한 거부·404는 기록 없음 — 거부는 기존 `PERMISSION_DENIED`).
- 질문 순위·통계(집계 화면)·자산 화면·데이터 지도 자체는 대상 아님(설정값 요약 — FR-DG1-6).
- **왜 데코레이터·인터셉터인가**: ADR-0016이 쓰기 감사에서 인터셉터를 기각한 근거(① `beforeValue` 불가 ② 경로 파싱 추론 ③ 대량 요약 역추론)가 열람에는 **하나도 해당하지 않는다** — 대상은 데코레이터가 이름으로 지정하고, before/after·요약이 없다. 반면 서비스 6곳에 감사 의존을 넣으면 생성자·spec이 바뀌고(§2.3) 열람 기록이 비즈니스 흐름에 섞인다. 닫힌 목록은 **데코레이터 부착 위치 = `view-audit-targets.ts` 상수**로 정적 검사(G-15)가 1:1 대조한다(ADR-0040 §7). 컨트롤러가 감사를 "아는" 것은 메타데이터 1줄뿐이며 기록 코드는 인터셉터 1파일에 있다.

### 11.4 감사 CSV 체인 동봉 형식 (FR-DG8-6 · AC-DG7-4)

- 기존 8열(`시각…요약`) **뒤에** `seq`·`rowHash` 2열(체인 밖 행은 빈 값). 기존 열 순서 불변.
- 데이터 행 뒤에 **표식 행 2개**(열 수 10 — 파서 호환): `["#CHAIN_HEAD", headSeq, headHash, 생성 시각, "", …]` · `["#CHAIN_VERIFY", status, checkedRows, firstBadSeq ?? "", 구간 fromSeq, toSeq, …]` — 구간 = 내보낸 행들의 `[min seq, max seq]`(필터와 무관한 연속 구간 검증 — 상한 초과면 status `SKIPPED_TOO_MANY`).
- 파일명·`Cache-Control: no-store` 불변. 응답 헤더 방식은 기각(브라우저 다운로드 링크로 받는 파일에 남지 않는다).

---

## 12. PII 마스킹 강도 (P-9)

- `packages/pii-mask`: `maskPii(text, options?)` — `options.mode ?? 설치값(기본 PARTIAL)`. FULL = 전화 `[전화번호]`·이메일 `[이메일]`(주민·카드·계좌는 원래 전량) · `counts` 불변. **함수 1벌**(ADR-0013 감수 비용 ① 이행).
- 적용 지점 4종(저장·RAG·증강·레거시)과 저장 테이블 3종이 **호출부 수정 없이** 같은 모드를 쓴다(설치값). `validate-candidates.ts`의 PII 탐지(`maskPii(raw).maskedText !== raw`)는 두 모드에서 판정이 같다.
- 변경은 **이후 적재분에만** 적용 — 과거 행 재마스킹 없음(FR-DG9-3 · AC-DG8-3). PARTIAL(기본)은 도입 전과 바이트 동일.

---

## 13. 데이터 지도 (`GET /governance/map` — `security:read` · 모드 OFF에서도 제공 · 감사 비대상)

| 절 | 원천 | 비용 |
|---|---|---|
| 모드·저장 위치 | 설정 + 부트스트랩 결과(메모리) | 0 쿼리 |
| 출구 5클래스 | 레지스트리 + 설정 + `checkEgress` 판정(모드 OFF면 `NOT_ENFORCED`) · 임베딩 `rawTextOffHost` | 0 |
| 레거시 연결별 | `apiConnection.findMany`(호스트만) · `apiCallLog.groupBy(['connectionId'], outcome='EGRESS_BLOCKED', 24h)` | 2 |
| 필드 암호화 | 런타임 + 키링 id + `GovernanceJobState('FIELD_CRYPTO').state.stats`(잡이 계산 — 요청 풀스캔 0) | 1 |
| 보존 | 전역 행 · 재정의 수 · 다음 창 시작 · 최근 `RetentionRun` 요약 6건 | 3 |
| 감사 체인 | 헤드 · 최근 `CHAIN_VERIFY` 1건 · 서명 키 id | 2 |
| 잔존 위험 | v1 평문 헤더 노드 수(`dialogNode.findMany({ where: { outputs: { contains: '"API_CONDITION"' } }, select: { outputs } })` → v1 ∧ 헤더 값 있음 판정 — 기존 v1 판정 함수 재사용) · v1 스냅샷 수(**잡의 주간 점검 캐시** — `ChatbotVersionPayload` 본문 스캔은 요청 경로에서 하지 않는다 · 미점검이면 null) · `allowRawPersonalData=true` 연결 수 · 외부 LLM 증강 여부 · 마스킹 강도 | 2 |

- 합계 ≤ 10쿼리 · P95 1초(§17). 화면 상단: 모드 OFF면 "거버넌스 모드 꺼짐 — 외부 전송 통제·필드 암호화·열람 감사가 적용되지 않습니다"(FR-DG1-6). 필드 암호화 절에 **보호 범위/비보호 범위 고정 문구**(NFR-DGS6 — web 상수).
- 저장 위치 문자열: SQLite = 절대 경로(파일명 포함) · 원격 = 호스트만(사용자·비밀번호·쿼리 제거).

---

## 14. 권한 (P-4 (1) — 신규 권한 0 · 신규 역할 0)

| 경로 | 권한 |
|---|---|
| `GET /governance/map` · `GET /governance/retention` · `POST /governance/retention/preview` · `GET /governance/retention/overrides` · `GET /governance/retention-runs` | `security:read` |
| `PUT /governance/retention` · `POST /governance/retention/pending/cancel` | `security:write` |
| `GET /chatbots/:chatbotId/retention` · `POST …/retention/preview` | `chatbot:read` + `security:read`(AND) |
| `PUT /chatbots/:chatbotId/retention` · `POST …/retention/pending/cancel` | `chatbot:read` + `security:write` |
| `POST /audit-logs/verify` · `GET /audit-logs/export`(기존) | `audit:read` |

- 전부 ADMIN 전용(기존 매핑). EDITOR 호출 = `403` + `PERMISSION_DENIED` 감사(AC-DG8-1).
- **환경변수 전용(콘솔 컨트롤 없음 — 읽기 표시만)**: 모드 · 저장 경로 · 출구 허용 목록 · 암호화 켜기/끄기 · 키 · 대화/감사 하한·상한·유예 · 마스킹 강도 · 잡 스위치·창(FR-DG9-2 · AC-DG8-2).
- 감사 전용 역할(AUDITOR — 직무 분리)은 2차(ADR-0015 트리거 기록).

---

## 15. API 계약 요약

### 15.1 신규 엔드포인트 (관리자 12 · `@Public()` 0)

| # | 메서드·경로 | 요청 | 응답 |
|---|---|---|---|
| 1 | `GET /governance/map` | — | `GovernanceMapResponse` |
| 2 | `GET /governance/retention` | — | `RetentionPolicyResponse(scope=GLOBAL)` |
| 3 | `PUT /governance/retention` | `GlobalRetentionUpdate` | `RetentionPolicyResponse` + `appliedNow: kind[]` · `pendingKinds: kind[]` |
| 4 | `POST /governance/retention/preview` | `{ days }` | `RetentionPreviewResponse` |
| 5 | `POST /governance/retention/pending/cancel` | — | `RetentionPolicyResponse` (대기 없음 `404`) |
| 6 | `GET /governance/retention/overrides` | 페이지 | `Paginated<{ chatbotId, chatbotName, status, kinds: RetentionKindView[] }>` |
| 7 | `GET /governance/retention-runs` | `RetentionRunListQuery` | `Paginated<RetentionRunItem>` |
| 8 | `GET /chatbots/:chatbotId/retention` | — | `RetentionPolicyResponse(scope=CHATBOT)` |
| 9 | `PUT /chatbots/:chatbotId/retention` | `ChatbotRetentionUpdate` | 3과 같음 |
| 10 | `POST /chatbots/:chatbotId/retention/preview` | `{ days }` | 4와 같음 |
| 11 | `POST /chatbots/:chatbotId/retention/pending/cancel` | — | 5와 같음 |
| 12 | `POST /audit-logs/verify` | `AuditChainVerifyRequest` | `AuditChainVerifyResponse` |

- 컨트롤러: `GovernanceController`(1~7) · `ChatbotRetentionController`(8~11) · 기존 `AuditLogsController`(+12). 챗봇 경로는 `ChatbotScopeService.assertReadable()`(존재·교차 챗봇 `404` · ARCHIVED 허용).
- 요구사항 §5.4의 `DELETE …/pending`은 **`POST …/pending/cancel`** 로 확정(기존 동작 경로 관례 — 예약 `POST …/cancel`).

### 15.2 기존 경로 확장

| 경로 | 확장 |
|---|---|
| `GET /audit-logs/:id` | `chain?`(값 있을 때만) · `VIEW` 기록(모드 ON) |
| `GET /audit-logs` | 응답 불변(AC-DG6-5) · 액션 필터에 `VIEW`·`EXPORT`(기존 `csvEnumArray`가 자동 수용) · `VIEW` 기록 |
| `GET /audit-logs/export` | 2열 + 표식 행 2 · `EXPORT` 기록 |
| 설문 결과 CSV · TC 결과 CSV | `EXPORT` 기록(응답 불변 — 소거 셀 문구만) |
| 대화 보기·진행 중 목록·상담 상세·설문 응답/자유 텍스트·미응답 상세 | `purged?` 선택 키 · `VIEW` 기록(모드 ON) |
| `POST/PATCH /api-connections` | 모드 ON · 목록 밖 호스트 `400 EGRESS_HOST_NOT_ALLOWED` |
| 호출 로그 목록·요약 | `outcome` 값 `EGRESS_BLOCKED` |

### 15.3 오류 코드 (`ApiErrorCode` 신규 2종)

| 코드 | 상태 | 상황 |
|---|---|---|
| `EGRESS_HOST_NOT_ALLOWED` | 400 | 모드 ON · 레거시 연결 `baseUrl` 호스트가 허용 목록 밖 |
| `RETENTION_OUT_OF_RANGE` | 400 | 보존 일수가 서버 하한 미만 또는 상한 초과(요구사항 `RETENTION_BELOW_MINIMUM`을 상·하한 겸용으로 확정) |
| (재사용) `CONFIRM_NAME_MISMATCH` | 400 | 단축 확인 문자열 불일치(요구사항 `RETENTION_CONFIRM_MISMATCH` 대체) |
| (재사용) `AUDIT_RANGE_TOO_WIDE` | 400 | 검증 기간·행 수 초과(요구사항 `AUDIT_CHAIN_RANGE_TOO_WIDE` 대체) |
| (미도입) `GOVERNANCE_MODE_DISABLED` | — | 모드 전용 **콘솔** 설정이 없어(모드 의존 설정은 전부 환경변수) 쓰일 곳이 없다 |

- 오류 봉투 형식 불변(ADR-0003). 공개 대화 경로는 이 코드들을 쓰지 않는다.

---

## 16. 봉인 · 정적 검사 — `apps/api/src/governance/lib/governance-sealing.spec.ts`

(검사 대상: `apps/api/src/**/*.ts` 중 `*.spec.ts`·`src/integration/**` 제외, 주석 줄 제외 — 기존 `*-sealing.spec.ts` 형식. 주요 단언은 **역검증 픽스처** 포함.)

| # | 단언 |
|---|---|
| G-1 | `fetch(`·`http.request(`/`https.request(`/`transport.request(`·`from 'node:dns'`를 포함하는 파일 집합 = `EGRESS_REGISTRY`의 파일 집합(6파일) — 명시 제외 `classifier/eval/**` |
| G-2 | 레지스트리 각 파일: `assertEgressAllowed(`+`checkEgress(` 호출 수 ≥ `fetch(`+`.request(` 호출 수 · 역검증(가드 호출을 지운 픽스처 = 실패) |
| G-3 | `installGovernanceRuntime(`·`configurePiiMaskMode(` 호출 파일 = `governance/bootstrap/governance-bootstrap.service.ts` 1개 · `ForTest(` 운영 코드 호출 0 |
| G-4 | 문자열 `DATA_ENCRYPTION_KEYS`·`AUDIT_CHAIN_KEY` 보유 파일 = `common/crypto/env-key.provider.ts` 1개(`env.validation.ts`에도 없음) · 그 파일 export에 키 바이트(Buffer) 반환 함수 0 |
| G-5 | `sealField(` 호출 파일 = {`handoff/handoff-thread.service.ts`, `survey-responses/survey-response.service.ts`, `governance/writer/governance-data.writer.ts`} · `openField(` 호출 파일 = §7.1 개봉 6파일(`handoff-{transcript,history,public-poll,gate,hints}.service.ts`·`survey-results.service.ts`) + writer |
| G-6 | `handoff-thread.service.ts`의 `handoffMessage.create` 블록마다 `sealField(`가 있다 · `survey-response.service.ts`의 `surveyAnswer.createMany` 직전 블록에 `sealField(` |
| G-7 | `conversationLog.update*` 호출 파일 = writer 1개(R-10·F-10 개정과 같은 목록) · `textPurgedAt:` 대입 파일 = writer 1개 · `unansweredQuestion` 쓰기 파일에 writer 포함(F-9 4파일) |
| G-8 | writer의 `updateMany` data 키: `conversationLog` ⊆ {userMessage, botResponse, textPurgedAt} · `handoffMessage` ⊆ {text, rawText, textPurgedAt} · `surveyAnswer` ⊆ {textValue, textPurgedAt} · `unansweredQuestion` ⊆ {questionText, variants, questionNormalized, textPurgedAt} — 소거 메서드의 텍스트 값은 `''`·`'[]'`·`'#PURGED#'` 접두·`null`, 재암호화 메서드는 `sealField(` 결과만 |
| G-9 | `delete`/`deleteMany`: writer = {ragCallLog, apiCallLog, auditLog, retentionRun}만 · `auditLog.delete*` 다른 파일 0 · 대화 원천 4계열 삭제 0(기존 R/S/H/F와 중복 확인) |
| G-10 | writer 파일 import처 = `governance/jobs/**`만 · `governance.module.ts` exports 0 · `governance/**` import하는 파일 = `app.module.ts` + `governance/**` 내부만 |
| G-11 | `auditChainHead` 쓰기 파일 = `audit-logs/audit-log.service.ts` 1개 · `auditChainAnchor` 쓰기 = {그 파일, writer} · `auditLog.create` = 그 파일 1개(기존 NFR-M3 재확인) |
| G-12 | `@Public()` 총 8 · `governance/**`·`audit-logs/**` 0 |
| G-13 | `packages/dialogue-engine/src`·`apps/widget/src`·`apps/ml-worker`에 `egress`·`sealField`·`openField`·`textPurgedAt`·`DATA_GOVERNANCE`·`retention` 심볼 0 |
| G-14 | `governance/**`·`common/crypto/**`·`common/egress/**` logger 인자에 `plaintext`·`rawText`·`textValue`·`userMessage`·`key\b`·`.message` 식별자 0(휴리스틱) · `EgressBlockedError` 메시지 생성부에 `url` 식별자 0 |
| G-15 | `@AuditView(` 부착 (컨트롤러#핸들러) 집합 = `VIEW_AUDIT_TARGETS` 상수 8개 · `recordExport(` 호출 파일 = 3개(§11.2) · `recordView(` 호출 파일 = 인터셉터 1개 |
| G-16 | `schema.prisma`: 신규 5모델 `Cascade`/`SetNull` 0 · `RetentionRun`·`AuditChainAnchor`·`GovernanceJobState` 컬럼 허용 목록(텍스트 본문·`sessionId`·`userMessage` 류 없음) · `textPurgedAt` 4모델 존재 |
| G-17 | writer의 소거·재암호화 메서드 블록마다 `enableSecureDelete(` · `$queryRaw` 보유 파일 수 4 불변(R-7 재확인) · `$executeRaw` 계열 0 |
| G-18 | `AUDIT_FIELDS.RetentionPolicy`·`RetentionRun`·`ConversationLog`·`UnansweredQuestion`·`AuditLog`·`TestRun`에 `text`·`message`·`sessionId`·`question`·`body` 필드명 0 |

---

## 17. 성능 예산 (NFR-DGP)

| 항목 | 예산 | 근거·측정 |
|---|---|---|
| 모드 OFF — 공개 대화·관리자 API | 지연 증가 0(오차 범위) · 요청 경로 추가 쿼리 **0** | 가드·개봉·인터셉터가 설치값 판정만 · 랭킹 필터는 같은 쿼리의 조건 1개 |
| 모드 ON — 출구 판정 | ≤0.1ms/호출 · 공개 대화 P95 +1% 이하 | 문자열 비교 |
| 감사 기록(체인) | P95 +5ms 이내 · "감사가 API 응답을 20% 이상 늘리지 않는다"(개발명세서 §5) 유지 | 헤드 읽기·CAS 1쌍 |
| 복호화 | 설문 목록 50행·상담 스레드 +5ms 이내 · CSV 10,000행 ≤1초 | AES-GCM µs/필드 |
| 파기·재암호화 중 | 공개 대화 P95 증가 <20% · **로그 적재 유실 0** · 100만 행 소거 ≤30분(기준 규모 실측·기록) | 배치 500 + 양보 200ms |
| 체인 검증 | 10만 행 ≤5초 · 전체는 백그라운드 | 배치 5,000 |
| 기동 검사 | 합계 ≤2초(암호문 100만 행) | 접두 검색 3~6회 |
| 데이터 지도 | P95 1초 | ≤10쿼리 · 풀스캔 0 |
| 마이그레이션 | 100만 로그 행 DB에서 인덱스 생성 소요 실측·기록 | `ADD COLUMN` 재작성 없음 |

- **예산 미달을 이유로 배치·양보 기본값을 조용히 바꾸지 않는다** — 설계 문서 갱신 후 조정(선행 그룹 규약).

---

## 18. ★ 기능이 꺼진 상태(기본값)에서 동작 불변을 보장하는 방법 (FR-0-161 · AC-DG1-1)

| 경로 | 기본값 동작 | 보장 장치 |
|---|---|---|
| 외부 출구 5클래스 | `checkEgress()`가 `enforce=false`에서 **파싱 없이** 통과 · 기존 catch 경로 불변 | 단위 시험(AC-DG2-5) · 기존 provider/client spec 무수정 통과 |
| 상담·설문 쓰기 | `sealField()` = 평문 그대로(`encryptionEnabled=false`) · 달라지는 것은 **행 id를 앱이 발급**한다는 점뿐(값 형식 동일 uuid v4) | 기존 시험 무수정 |
| 상담·설문 읽기 | `openField()` = 키링 없으면 입력 그대로(파싱 0) | 동일 |
| 마스킹 | 설치값 PARTIAL = 현행 함수 경로 | `pii-mask` 기존 시험 + PARTIAL 바이트 동일 시험 |
| 질문 순위 | `textPurgedAt: null` — 기존 행 전부 null이라 결과 동일 | 기존 통계 시험 무수정 |
| 열람 감사 | 인터셉터가 모드 OFF에서 `next.handle()` 그대로 | 쿼리 수 시험 |
| 내보내기 감사 | **기록이 1건 추가된다**(P-10 "항상") — CSV 응답 바이트는 감사 CSV의 2열·표식 행을 빼면 불변 | 의도된 변경(해당 CSV 내용·감사 건수를 단언하는 기존 시험 0건 확인 — §21.2 확인 항목) |
| 감사 기록 | 행에 `seq`·`prevHash`·`rowHash`가 채워지고 `createdAt`을 앱이 정한다 — 목록·상세(키 추가 제외)·필터 응답 불변 | AC-DG6-5 |
| 보존 | 행 없음 = 무기한 — 파기 잡은 창 안에서 정책 1회 읽기 후 종료 | `jest.isolate-env.js`가 잡을 끔 |
| 암호화 잡 | 키링 없으면 시작 자체를 하지 않는다 | — |
| 기동 | 모드 OFF · 키 없음이면 새 기동 실패 조건 0(설정한 값이 틀린 경우만) · 부팅 쿼리 ≤4(헤드·제네시스·잡 상태 보장) | 기존 통합 시험 무수정 |
| 엔진·위젯·ml-worker | 변경 0 | G-13 |

- **기준선**: 커밋 ①(런타임 미설치) 적용 후 전 시험이 무수정 통과해야 하며, 커밋 ②·③은 §21.2 X 목록 외의 기존 시험을 바꾸지 않는다.

---

## 19. 다른 기능과의 경계

| 기능 | 경계 |
|---|---|
| No.36 AI 거버넌스 | 응답 안전성·HITL·2인 승인은 No.36 · 이 그룹은 저장·전송·보존·감사만 |
| No.12 금지어 · ADR-0013 | 금지어 불변 · 마스킹 함수 1벌·순서 불변 · FULL 옵션 추가 · 원문 예외 확대 없음 |
| No.24 상담 | 원문 60분·소거·`RAW_VIEW` 불변 · 텍스트 암호화·종료 상담 보존 소거 추가 · §7.8 |
| No.26 레거시 | 시크릿 저장 방식 불변(환경변수) · 연결 호스트 허용 목록 · `EGRESS_BLOCKED` · 호출 로그 보존 |
| No.27 설문 | 자유 텍스트 암호화·소거 · 내보내기 감사 · 작은 표본 비공개는 범위 밖 |
| No.29 통합 통계 | 수치 불변 · 질문 순위 소거 제외 · 로그 포함 영구삭제는 **여전히 불허**(행이 남아 409 유지 — EX-DG-18) |
| No.44 피드백 | 원장 1차 보존 대상 아님 · 소거된 로그의 👎는 기존 `EMPTY` 규칙으로 큐 제외(C-⑦) · 자유 텍스트 사유(2차)는 이 그룹 규약(마스킹 → 암호화 → 보존 소거)을 따르면 받을 수 있다(트리거 충족) |
| No.25/40 버전·환경 | 스냅샷은 암호화·파기 대상 아님(대화 원천 없음) · v1 평문 토큰 점검만(자동 스크럽 없음 — ADR-0034 §7) · 재정의는 복사·스냅샷 밖 |
| No.28 예약 | 예약 행 정리·NOOP 감사는 범위 밖 · 파기 창과 예약 실행이 겹치면 배치 양보로 지연 ≤ 배치 1개(EX-DG-23) |
| No.13 이력 | 기록 위치·커밋 후 기록·화이트리스트 규약 불변 · 체인·열람/내보내기·보존이 더해짐 |
| 멀티테넌시(T-15) | 범위 밖 — 별도 그룹 |

---

## 20. 관리자 콘솔 (ui-designer / frontend-implementer 인계)

1. **설정 > 데이터 거버넌스**(ADMIN — `security:read`): 탭 ① 데이터 지도(저장·출구·암호화·보존·체인·잔존 위험 — 상태는 텍스트 라벨 필수, 색만으로 구분 금지 · 모드 꺼짐 배너 · 필드 암호화 보호/비보호 범위 고정 문구 · "디스크 암호화: 운영자 신고값(애플리케이션이 검출하지 못함)") ② 보존 정책(전역 — 6종 입력 · 하한/상한 안내 · 미리보기 표 · 단축 시 확인 창(초점 가두기·`Esc`·재입력 필드 라벨·버튼 "보존기간 180일로 단축") · 유예 "적용 예정 10-03" + 취소 · 챗봇 재정의 목록) ③ 파기 이력(필터 kind·챗봇·기간 · 결과 텍스트).
2. **챗봇 설정 > 보존기간 탭**: 4종 · "전역 따름/일수/무기한" 라디오 · 미리보기·확인(챗봇 이름 재입력).
3. **감사로그**: 무결성 검증(기간 선택 → 결과 · 보증 범위 문구 NFR-DGS7) · 액션 필터 "열람·내보내기" · 상세 체인 정보.
4. **"파기됨" 표시**: `purged` 항목은 회색 글자만이 아니라 텍스트 "보존기간 경과로 파기됨"(NFR-DGA4).
5. 레거시 연결 편집: `EGRESS_HOST_NOT_ALLOWED` 필드 오류 표시 · 호출 로그 `EGRESS_BLOCKED` 라벨 "외부 전송 차단".
6. 문구 통일(FR-0-171): "데이터 거버넌스·데이터 지도·보존기간·파기·외부 전송·필드 암호화·무결성 검증" — "AAD·앵커·블라인드 인덱스·CAS" 금지. 저장 결과는 `aria-live="polite"` 1회.
7. 위젯 변경 0.

---

## 21. 시험 설계 포인트 (test-automation 인계)

### 21.1 층별 핵심

| 층 | 핵심 |
|---|---|
| 순수 함수 | 허용 목록 파싱·접미 일치·포트·IDN · 저장 위치(상대 경로 거부·심볼릭 링크·Windows 대소문자) · 봉투 왕복(한글·이모지)·AAD 교차 실패·키 id 형식 · 유효 일수(유예·하한 클램프·GLOBAL) · KST cutoff(자정 경계) · 창(자정 넘김) · 체인 직렬화·해시·검증 결과 코드 전부 |
| 서비스(목) | `record()` CAS 경합 재시도·폴백 · `recordView` 모드 OFF 쿼리 0·LRU·일 경계 · 정책 저장(단축/연장/혼합·확인 문자열·범위) · writer 배치 CAS 멱등 |
| 통합(`migrate deploy` DB · 동적 import) | ★ AC-DG1-1(모드 OFF 무변경 — 전 시험 세트 + 공개 경로 쿼리 수) · ★ AC-DG2-1/2(기동 실패 — 앱 생성 예외 단언) · ★ AC-DG2-3(레거시 차단: 전송 목 호출 0 · `ApiCallLog.outcome`) · ★ AC-DG3-1(DB 원시값 봉투 · 응답 동일) · ★ AC-DG3-4(키 교체: 재암호화 `tick()` 반복 → 전부 k2 → k1 제거 재기동 성공 · 선제거 기동 실패) · ★ AC-DG5-1/2(소거 후 행·버킷·세션·그룹·매칭 불변 · 대시보드·통합·설문 분포·상담 건수 수치 동일 · 질문 순위 빈 항목 없음) · ★ AC-DG5-8(파기 중 공개 대화 부하 — 로그 유실 0 측정) · ★ AC-DG6-1/3(DB 직접 수정 → `HASH_MISMATCH` · 중간 삭제 → `SEQ_GAP` · 병렬 50건 seq 중복·결손 0) · ★ AC-DG7-2(같은 상세 10회 + 폴링 100회 → `VIEW` 1건) · ★ AC-DG1-3(봉인 G-1~G-18) |
| 다중 인스턴스 | 앱 2개(동적 import) 동시 `tick()` → 파기 1인스턴스 · 동시 감사 기록 → 헤드 CAS 정합 |

- 모드·암호화·잡을 켜는 spec은 **`process.env` 설정 후 `await import('../app.module')`**, 잡은 `tick()` 직접 호출(CLAUDE.md). 키 픽스처는 시험 전용 무작위 32바이트(저장소에 실제 키 커밋 금지).
- 시각은 KST로 다루되 주입 시계(`Clock` — `common/polling/clock.ts`)로 창·cutoff·일 경계를 고정한다.

### 21.2 ★ 의도된 기존 시험 기대값 변경 (닫힌 목록 — FR-0-169 확정)

| # | 파일 | 변경 | 이유 |
|---|---|---|---|
| **X-1** | `topics/lib/topic-sealing.spec.ts` T-10 | `AuditAction.options.length` 14 → **16** | `VIEW`·`EXPORT` |
| **X-2** | `stats/lib/stats-retention-sealing.spec.ts` R-10 | "`conversationLog.update*` 0건" → "`update*` 호출 파일 ⊆ {`governance/writer/governance-data.writer.ts`}" (R-1~R-4·R-9 불변 — **`LOG_DELETION_ALLOWLIST` 빈 배열 유지**) | 텍스트 소거 1파일(P-3 (a)) |
| **X-3** | `feedback/lib/feedback-sealing.spec.ts` F-10 · F-9 | F-10 X-2와 같은 허용 파일 · F-9 쓰기 파일 3 → **4**(writer 추가) | 종결 항목 소거 |
| **X-4** | `handoff/lib/handoff-sealing.spec.ts` H-2 | 쓰기 파일 1 → **2**(writer 추가 — H-3·H-13은 `handoff-thread.service.ts` 한정이라 불변) | 소거·재암호화 |
| **X-5** | `stats/lib/survey-sealing.spec.ts` S-2 | 쓰기 파일 1 → **2**(writer 추가) | 동일 |
| **X-6** | `chatbots/chatbots.service.spec.ts` | 트랜잭션 목 +`retentionPolicy.deleteMany` · "19개 테이블" → **20** | 동반 삭제 |
| **X-7** | `common/auth/public-decorator-count.spec.ts` | 등록 컨트롤러 35 → **37**(`GovernanceController`·`ChatbotRetentionController`) · `@Public()` 8 목록 불변 | 신규 컨트롤러 |
| **X-8** | `jest.isolate-env.js`(시험 인프라) | `DATA_RETENTION_JOB_ENABLED='false'` · `DATA_REENCRYPT_JOB_ENABLED='false'` | 백그라운드 루프 규약 |

- **픽스처 보강(단언 불변)**: `validation/test-run.service.spec.ts` — 생성자 끝 인자(`AuditLogService` 목) 1개 추가(TS 인자 수). 그 밖의 spec이 생성자 변경으로 깨지면 **회귀로 취급**하고 멈춘다.
- **확인 항목(변경 예상 0)**: `rag-allowlist.spec.ts`(RAG 클라이언트 `fetch(` 유지) · `legacy-api-sealing.spec.ts` L-2/L-7 · `validation-sealing.spec.ts` 4) · `version-sealing.spec.ts` V-3 · `environment-sealing.spec.ts` · `permission-matrix.spec.ts`(권한 18 불변) · 통합 spec의 감사 건수 단언(`scheduled-deploy.integration.spec.ts` 497·506행 — 내보내기·열람 경로 없음) · 웹 `badges.spec.tsx`(추가만).

---

## 22. 요구사항 추적표 (요약)

| 요구 | 설계 |
|---|---|
| FR-DG1-\* 데이터 지도 | §13 |
| FR-DG2-\* 저장 위치 | §5.2 · patches F-1 |
| FR-DG3-\* 출구 | §6 · G-1/G-2 |
| FR-DG4-\* 암호화 | §7 · §5.3 · G-4~G-6 |
| FR-DG5-\* 보존 정책 | §8 |
| FR-DG6-\* 파기 잡·이력 | §9 · G-7~G-9 · G-17 |
| FR-DG7-\* 체인 | §10 |
| FR-DG8-\* 열람·내보내기 | §11 · G-15 |
| FR-DG9-\* 권한·마스킹·봉인 | §14 · §12 · §16 |
| FR-0-161~171 | §18 · §2.4 · G-12/G-13 · G-14 · FR-0-165(§9.4) · FR-0-166(§9.2) · FR-0-167(§14) · FR-0-168(§15.3) · FR-0-169(§21.2) · FR-0-170(§3.4) · FR-0-171(§20) |
| NFR-DGP1~6 | §17 |
| NFR-DGS1~7 | §5.1 · §7.3 · §7.5 · §9.3 · §6.5 · §11.2 · §13 · §10.8 |
| NFR-DGA1~4 | §20 |
| NFR-DGM1~3 | lib 순수 함수 · 상수 4종(레지스트리·암호화 대상·보존 대상·열람 대상) · ADR-0040 재검토 트리거 |
| AC-DG1~DG8 | §21 |
| EX-DG-1~24 | §6.4(1) · §6.5(2) · §6.2(3) · §7.3(4·6) · §7.5(5) · §7.6(7) · §9.2(8·9·10·20) · §9.5(11·12) · §8.3(13) · §10.3(14) · §10.6(15·16) · §3.4(17) · §8.3(18) · §7.2(19) · (21 영향 없음) · §6.6(22) · §9.3(23) · §5.3(24) |

---

## 23. 알려진 제한

| # | 제한 | 완화 |
|---|---|---|
| L-1 | 필드 암호화는 서버·환경변수 장악을 막지 못한다(키와 DB가 같은 호스트 — C-6) | 화면·문서 명시 · KMS 2차 |
| L-2 | 체인은 기록 누락을 증명하지 못한다 · 키 없는 설치는 전체 재계산을 외부 대조로만 탐지 | HMAC 키 권고 · 머리 로그 보관 |
| L-3 | 종결 UQ 소거 후 같은 질문 재유입 = 새 PENDING 항목(재발생 카운트 연속성 끊김) | 화면 "파기된 항목" 표시 · 2차 블라인드 인덱스 |
| L-4 | `secure_delete`는 DB 페이지만 — 저널·WAL·백업 잔존 | 디스크 암호화 운영 전제 |
| L-5 | 평문으로 적재된 기존 텍스트가 우연히 `enc:v1:<유효 키 id>:<유효 base64>` 형태면 개봉 실패로 표시된다 | 사실상 0 — 키링이 있을 때만 파싱 |
| L-6 | 구버전 인스턴스·체인 폴백 행은 체인 밖(검증 `outOfChainRows`) | 전 인스턴스 동시 교체 권고 |
| L-7 | 레거시 이외 출구의 런타임 차단 건수는 집계하지 않는다(기동 검사로 사전 차단) | 지도에 판정 표시 |
| L-8 | 행과 `sessionId`(가명 난수)는 보존기간 뒤에도 남는다 — "행 자체 삭제" 규제 해석이면 2차(소거 후 더 긴 기한의 롤업 + 행 삭제) | ADR-0040 재검토 트리거 |
| L-9 | 암호화를 켠 설치의 API 롤백은 봉투를 평문처럼 표시한다 | 전진 수정만(운영 문서) |
| L-10 | 데이터 지도의 v1 평문 토큰 스냅샷 수는 주간 점검 캐시(최대 7일 지연) | 점검 시각 표시 |

---

## 24. 요구사항 대비 해석 (architect 판단)

| # | 요구사항 | 이 설계 | 이유 |
|---|---|---|---|
| R-1 | FR-DG4-2 암호화 함수 위치 "패키지 또는 common/crypto" | `apps/api/src/common/crypto` | 소비자 1곳 — 승격 규약(소비자 2곳) 미충족 |
| R-2 | FR-DG4-9 키 id 집계 방식 | 기동 1회 접두 검색(카운트 테이블 기각) | 쓰기 경로 카운터 부담·정합 비용 |
| R-3 | FR-DG5-3 `RETENTION_BELOW_MINIMUM` · FR-DG5-5 확인 불일치 코드 · FR-DG7-5 `AUDIT_CHAIN_RANGE_TOO_WIDE` · FR-0-168 `GOVERNANCE_MODE_DISABLED` | `RETENTION_OUT_OF_RANGE`(상·하한 겸용) · 기존 `CONFIRM_NAME_MISMATCH`·`AUDIT_RANGE_TOO_WIDE` 재사용 · 모드 코드 미도입 | 판정 차이 0인 코드 증설 회피 — 신규 2종 |
| R-4 | FR-DG5-7 챗봇 재정의 감사 대상 `Chatbot` | `RetentionPolicy`(targetId = scopeKey, chatbotId 채움) | 전역·챗봇 정책을 한 필터로 조회 · 대상 = 모델명 규칙 |
| R-5 | §5.2 `RetentionPolicy` 가칭 · `EgressBlockLog`(선택) | `RetentionPolicy` 단일 모델(scopeKey PK) · 차단 로그 테이블 미도입(레거시 = `ApiCallLog`) | 런타임 차단은 레거시만 발생 |
| R-6 | FR-DG7-8 "재시도 초과 시 경고 로그(본 동작 무영향)" | **체인 없이 기록 + 경고**(폴백) | 감사 행 손실보다 체인 밖 행이 낫다 — 검증이 드러낸다 |
| R-7 | FR-DG8-3 열람 닫힌 목록(5종) | 8핸들러(진행 중 목록 V-1 추가 · 설문 2경로 · 감사 목록/상세 2) | 진행 중 목록이 사용자 마지막 발화를 보여 준다 |
| R-8 | FR-DG8-6 CSV 동봉 "주석 행 또는 헤더" | 2열 + 열 수 동일 표식 행 2 | 다운로드 파일에 남고 파서가 깨지지 않는다 |
| R-9 | §5.4 `DELETE …/pending` | `POST …/pending/cancel` | 동작 경로 관례 |
| R-10 | FR-DG6-2 소거값 "빈 값(`""`)" | `ConversationLog`·`HandoffMessage`·`SurveyAnswer` = `""` · UQ `questionNormalized` = `#PURGED#<id>` | 유일 키(C-②) · 목록 필터(C-⑥) |
| R-11 | FR-DG6-8 파기 감사 액션 | `PURGE` 재사용 | 신규 액션 판정 차이 0 |
| R-12 | FR-DG3-1 와일드카드 · EX-DG-3 루프백 | 선행 `*.` 접미만 · 루프백 자동 허용 없음 | 권고안 확정 |
| R-13 | FR-DG1-5 스냅샷 평문 토큰 수 | 주간 잡 캐시(요청 시 본문 스캔 없음) | 스냅샷 본문 최대 20MB × N |
| R-14 | FR-DG6-1 파기 잡 폴링 간격(미지정) | 5분 상수(환경변수 아님) | 창 판정만 — 운영 조정 불필요 |
| R-15 | 암호화 대상 `HandoffMessage.text` | 발신자 무관(사용자·상담원·SYSTEM) 전부 | 필드 단위 규칙 단순화 |

---

## 25. GPU · 배포 형태

- **GPU 1 유지**(P-12): AES-GCM·SHA-256/HMAC·호스트 비교·배치 UPDATE/DELETE뿐. 모델·학습·추론·임베딩 호출 0 · ml-worker 변경 0.
- **구축형 ○**: 단일 서버에서 "저장 경로 + 출구 5클래스"가 데이터 흐름의 전부 — 기동 검증 + 데이터 지도로 레지던시를 **증명**한다. 키·디스크 암호화·백업은 고객 운영 통제.
- **구독형 △**: 저장 위치 = 우리 인프라 리전(리전별 배포 필요) · 고객별 키 분리 없음(KMS·테넌트 키 2차) · 보존은 챗봇 재정의로 일부 충족 · 출구 통제는 동일 동작.

## 26. 범위 밖 (재검토 트리거는 요구사항 §9 · ADR-0040)

대화로그·미응답 큐 본문 암호화(블라인드 인덱스) · KMS/HSM/Vault·테넌트 키 · 정보주체 파기 요청 · SIEM·외부 봉인 · 감사 전용 역할 · 2인 승인(No.36) · 멀티테넌시(별도 그룹) · DB 계층 암호화 · 물리 리전 보증·백업 자동화 · 로그 포함 챗봇 영구삭제 · 질의 임베딩 마스킹 · 작은 표본 비공개 · 운영 테이블 정리 · 과거 행 재마스킹 · 평가 원장 보존·자유 텍스트 사유 · 전량 복호화 스크립트 · 레거시 시크릿 DB 암호화.

## 27. 구현 편차 기록(backend-implementer, 2026-09-26 — I-1~I-12)

> 1차 구현 보고 후 PM/coordinator 지시로 설계서 전 범위(챗봇별 보존 API·데이터 지도 실계산·전체 봉인·
> 동시성/키 교체 통합 시험)를 완성했다. 이 절은 그 2차 완성 과정에서 생긴 **의도된 편차**만 기록한다
> (1차 보고의 "축소"는 전부 해소됐으므로 별도 취소선 없이 이 표로 대체한다).

| # | 편차 | 사유 | 관련 |
|---|---|---|---|
| I-1 | `CurrentUser`(shared-types `security.ts`)에 `governanceModeOn: boolean` 필드 추가 — `GET /auth/me`·`POST /auth/login` 응답(`AuthService.toCurrentUser()` 1곳이 채운다) | PM 결정(화면설계 D-6) — `security:read` 없는 역할(AGENT·EDITOR)도 거버넌스 모드 ON에서 "열람이 기록됩니다" 배너를 표시해야 하는데 `GET /governance/map`은 호출할 수 없어, 인증 사용자 전원이 받는 `/auth/me`에 최소 정보만 얹었다 | §4.2 CurrentUserSchema 갱신 필요(별도) |
| I-2 | `FieldCryptoJob.tick()`은 `DATA_REENCRYPT_JOB_ENABLED`와 **무관하게** 동작한다(자동 루프 시작 여부만 그 변수가 결정) | §7.6 "시작 조건" 표가 `tick()` 자체의 게이트처럼 읽힐 수 있었다 — 다른 잡(`RetentionJob`·`DeploySchedulesEngine`·`HandoffSweeperService`)과 같은 규약(CLAUDE.md "잡은 tick() 직접 호출로 검증")으로 통일했다. 동시성·키 교체 통합 시험 작성 중 발견 | `governance/jobs/field-crypto.job.ts` |
| I-3 | `AuditLogService.record()`에 인스턴스 로컬 직렬화 큐(Promise 체인, §10.3의 서술)를 실제로 구현했다(1차 구현에서는 서술만 있고 코드가 없어, 같은 프로세스에서 50건을 `Promise.all`로 동시 기록하면 Prisma `$transaction` 대기열 폭주로 사실상 멈췄다 — AC-DG6-3 통합 시험으로 발견) | 버그 수정 — 다중 인스턴스 간 경합은 여전히 헤드 CAS+재시도(DB 수준)가 처리하고, 같은 프로세스 안 경합만 이 큐가 없앤다 | `audit-logs/audit-log.service.ts` |
| I-4 | v1 평문 헤더 스냅샷 스캔(§13 위험 지표)을 `RetentionJob`이 주 1회 수행하고 `GovernanceJobState('RETENTION').state.v1TokenCheck`에 캐시한다 — `ChatbotVersionPayload`를 읽는 **5번째 소비자**가 되어 `version-sealing.spec.ts`(V-7)·`environment-sealing.spec.ts`(E-4) 허용 목록에 `governance/jobs/retention.job.ts`를 추가했다 | §13 표가 "잡의 주간 점검 캐시"라고만 적고 소유 잡을 명시하지 않아 architect 재량으로 `RetentionJob`(창·주기 규약을 이미 가진 잡)에 배치했다 | `governance/jobs/retention.job.ts`, `governance/lib/v1-token-scan.ts` |
| I-5 | `ChatbotRetentionController`는 `ARCHIVED` 챗봇에도 `ChatbotScopeService.assertWritable()`(409)을 쓰지 않고 존재만 확인한다(`RetentionPolicyService.assertChatbotExists()`) | §8.3 "ARCHIVED 챗봇: 재정의 조회·저장 허용(거버넌스 설정 — 자산 아님)"과 `assertWritable()`의 기존 ARCHIVED 차단이 충돌해, 이 컨트롤러만 전용 존재 확인 헬퍼를 쓴다 | `governance/chatbot-retention.controller.ts`, `governance/retention-policy.service.ts` |
| I-6 | `POST .../retention/preview`의 `firstPurgeAt`(단축 아님)을 `DATA_RETENTION_WINDOW`를 실제 파싱해(`nextWindowStart()`) 계산한다 — 이미 창 안이면 `now`, 창 밖이면 KST 기준 오늘/내일 시작 시각 | 1차 구현의 "지금+24시간" 근사를 설계대로 되돌렸다 | `governance/lib/retention-window.ts` |
| I-7 | 데이터 지도 `risks.v1PlainHeaderNodes`(실시간)·`v1PlainHeaderSnapshots`/`snapshotScanAt`(주간 캐시 읽기)·레거시 연결별 `blockedLast24h`(`ApiCallLog.groupBy`)·`encryption.fields`(필드별 평문/키별 행 수 — `FieldCryptoJob`이 계산)를 전부 실제 값으로 채웠다 | 1차 구현의 상수 0/빈 배열을 설계대로 되돌렸다 | `governance/governance-map.service.ts`, `governance/jobs/field-crypto.job.ts` |
| I-8 | 봉인 정적 검사 G-5~G-8·G-11·G-14~G-16·G-18을 추가해 G-1~G-18 전부를 `governance-sealing.spec.ts` 1파일에서 검사한다 | 1차 구현의 부분 커버리지를 완성했다 | `governance/lib/governance-sealing.spec.ts` |
| I-9 | `ChatbotRetentionController`(5개 엔드포인트) 등록으로 `public-decorator-count.spec.ts`의 전수 스캔 컨트롤러 수가 설계서 X-7 그대로 **35→37**로 확정됐다(1차 구현의 35→36 조정을 되돌림) | 1차 구현에서 미구현이던 컨트롤러가 추가됨에 따른 자연 결과 | `common/auth/public-decorator-count.spec.ts` |
| I-10 | `RetentionRunItem.resultCode`의 값 집합을 `kind`별로 명문화했다 — `CHAIN_VERIFY`는 `AuditChainVerifyStatus`와 **정확히 같음**(`OK`·`EMPTY`·`HASH_MISMATCH`·`SEQ_GAP`·`TAIL_MISSING`·`ANCHOR_MISSING`·`KEY_UNAVAILABLE`), `PURGE`는 `'MAX_ROWS'`\|`null`뿐(설계서 §3.1의 `WINDOW_ENDED`·`LEASE_LOST`·`DB_ERROR`는 이번 구현이 별도 코드로 구분하지 않는 알려진 한계), `BACKFILL`\|`REENCRYPT`는 항상 `null` | coordinator 프론트 계약 질의 — 프런트가 `kind`로 먼저 분기해서 `resultCode`를 읽어야 함을 명시 | `packages/shared-types/src/governance.ts`(`RetentionRunItemSchema.resultCode` JSDoc) |
| I-12 | ui-spec §3.7(G5 — 파기 표시)이 "진행 중 목록의 마지막 발화(`LiveSessionListPage`)"도 소거 시 `PurgedFieldNotice`로 표시하라고 명시했는데, `LiveSessionRowSchema`(shared-types `handoff.ts`)에는 이를 알릴 필드가 없었다. `lastUserTextPurged: z.literal(true).optional()`을 추가하고(`TranscriptBotTurnSchema.purged`·`UnansweredQuestionListItem.purged`와 같은 명명·직렬화 규약 — 소거 아니면 키 생략), `LiveSessionsService.list()`가 마지막 발화 원천 행을 조회하는 기존 쿼리(③, 세션 수 고정 3 유지)의 `select`에 `textPurgedAt`만 얹어 판정한다(추가 쿼리 0). `ConversationLog.userMessage`는 필드 암호화 대상이 아니라(`HANDOFF_TEXT`·`HANDOFF_RAW_TEXT`·`SURVEY_TEXT_VALUE` 3종만 암호화) `[복호화 실패]` 표시와 충돌할 일이 없다 | coordinator 지시(계약 누락 보완) — 최초 구현 시 진행 중 목록이 §3.7 표의 적용 대상에서 누락됨 | `packages/shared-types/src/handoff.ts`(`LiveSessionRowSchema`), `handoff/live-sessions.service.ts`, `integration/data-governance.integration.spec.ts`(AC-DG5-4) |
| I-11 | 코드 리뷰 R1 반영(M-1·M-2·L-1·시험 공백) — ① **M-1**: 5클래스 중 `fetch()` 기반 4클래스(임베딩·RAG·Gemini·로컬 증강, 6개 호출 지점)에 `egress-guard.ts`의 신규 함수 `egressRedirectMode()`(모드 ON=`enforce`일 때만 `redirect:'manual'`, OFF는 기존 `follow` 유지)·`assertNoRedirectResponse()`(3xx 응답이면 `EgressBlockedError`를 던져 각 출구의 **기존 실패 경로**로 흡수 — 임베딩/로컬 증강 `!res.ok` 분기, RAG는 `networkError:true`, Gemini는 `generate()`의 catch→`[]`)를 추가했다. **모드 OFF에서는 적용하지 않는다** — §2.6 "① 기반(관측 응답 불변)" 원칙(런타임 미설치 = 현행 동작 바이트 동일, FR-0-161 기준선)이 리다이렉트 추종(`follow`) 동작에도 그대로 적용되어야 한다고 판단했다(설계서에 리다이렉트 관련 명시 규정이 없어 이 원칙으로 대신 판단 — Node `fetch`(undici)는 `redirect:'manual'`이어도 브라우저의 opaque-redirect 필터링 없이 실제 status·헤더를 그대로 노출하므로 판정에 문제가 없음을 확인했다). 레거시(`NodeHttpTransport`)는 애초에 `node:http`/`node:https`를 직접 써서 리다이렉트를 절대 따라가지 않으므로(`REDIRECT_NOT_ALLOWED`, 모드 무관) 대상 아님 — 이번 수정으로 "리다이렉트를 따라가지 않는다"는 통일 규약이 **모드 ON 한정**으로 5클래스 전체에 적용된다. ② **M-2**: `governance-bootstrap.service.ts`의 `checkEgressBootOrThrow()`가 자체 구현하던 매칭 로직(포트를 사실상 무시하던 버그 — 항목의 포트를 항상 잘라내고 호스트만 비교)을 지우고 `common/egress/egress-guard.ts`의 순수 함수 `parseAllowlist`·`matchHost`·`parseEgressTarget`을 그대로 재사용하도록 바꿔, 기동 판정과 런타임 판정(`checkEgress()`)이 포트 포함 항목에서도 항상 일치하게 했다. ③ **L-1**: `checkKeyUsageOrThrow()`의 attempt<10 루프가 미지 키 발견 즉시 throw해 2회차 이후가 죽은 코드였던 것을 고쳐, 미지 keyId를 최대 10개까지 모은 뒤 한 번에 보고하도록 바꿨다(기동 실패 자체는 그대로 — 키 값은 메시지에 포함하지 않는다). ④ 시험 공백: `governance-sealing.spec.ts` G-2에 "가드 호출이 같은 파일의 송신 호출보다 코드상 앞선다"는 순서 검사(+ 역검증 픽스처)를 추가했다(기존 G-2는 개수만 비교해 순서가 뒤바뀐 경우를 놓쳤다) | 코드 리뷰 R1 지적사항 반영(coordinator 지시) | `common/egress/egress-guard.ts`, `embedding/providers/http-embedding.provider.ts`(+`.spec.ts`), `rag/rag-http.client.ts`(+`.spec.ts`), `augmentation/providers/{gemini,local}-augmentation.provider.ts`(+ 신규 `*.redirect.spec.ts` 2개), `governance/bootstrap/governance-bootstrap.service.ts`(+ 신규 `.spec.ts`), `governance/lib/governance-sealing.spec.ts` |
