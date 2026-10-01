# AI 거버넌스·가드레일 세부 설계서 (No.36)

> **요구사항**: `docs/requirements/ai-guardrails.md`(J-1~J-12, R-1~R-6, FR-0-298~309, FR-AG1-\*~FR-AG5-\*·FR-AG9-\*, NFR-AGP/AGS/AGR/AGA/AGM, AC-AG1~AG6, EX-AG-1~20, P-1~P-12). **FR-AG6(규모 B 오프라인 점검)·FR-AG7(규모 C 런타임 근거 점검)은 사용자가 "하지 않음"으로 확정**했고, **FR-AG8(AI 답변 고지)은 법무 확인 전 구현하지 않는다**(P-11).
> **상위 문서**: `docs/02-spec/개발명세서.md` §2·§2.2·§3·§3.1·§4·§5·§5.1·§6(**결정 49 신설**)·§7 · `docs/01-requirements/기능요구사항.md` 19·78·94행 · ADR-0013·0015·0022·0023·0031·0039 · `data-governance-설계.md` · `environment-separation-설계.md` · `scheduled-deploy-설계.md` · `docs/05-ops/자동배포.md` — 반영 문구는 **`docs/02-spec/ai-guardrails-patches.md`**(찾기/바꾸기 55건 · ⏳ 미적용 — 오케스트레이터가 적용. 대상 파일이 CRLF라 전체 재작성 대신 패치로 남긴다).
> **신규 ADR**: **ADR-0048**(규칙 기반 입구·출구 검사 · 출구 전용 개인정보 종류 선택 인자 · 운영 전환 2인 승인은 전환 서비스 1곳에서 강제). `decisions/`의 현재 최대 번호는 **0047**이고 `docs/` 전체(미커밋 보류 초안 `plugin-marketplace.md`·`connector-hub.md`·`nocode-scenario-design.md`·`nlg-bot-to-bot.md`·`ai-guardrails.md` 포함)에서 `ADR-0048` 이상은 0건이다.
> **갱신 ADR(각주)**: ADR-0013(출구 전용 선택 인자) · ADR-0015(복원 승인 재검토 판정) · ADR-0022(프롬프트 봉인 불변 · 시뮬레이터 RAG 답 미리보기) · ADR-0023(가드레일 대체의 `FAILED` 수렴) · ADR-0031(복원은 2인 승인 대상 아님 — 판정 완료) · ADR-0039(2인 승인 이행 · 끄기 차단 · 롤백 예외 범위)
> **작성일**: 2026-09-30 · **GPU**: **5 → 1 + 각주**(P-10 권고 채택) · 구축형 ○ · 구독형 △(+ 각주)
> **구현 담당**: `backend-implementer`(전부 — 가드레일 모듈·입구/출구·`pii-mask` 선택 인자·승인 상태 기계·전환 서비스 강제·예약 오류 분류·감사·지도) + `ui-designer`(화면 3 + 기존 화면 보강 상세) + `frontend-implementer`. **`ml-engineer` 작업 없음**(§19.3).
> **표기**: 봉인 **AG-1~AG-18**(정적 검사 GR-1~GR-14) · 의도된 기존 시험 기대값 변경 **닫힌 목록(FR-0-309) = 3건 + 조건부 1건**(§18.5) · 코드에서 찾은 제약 **C-1~C-14** · 알려진 제한 **K-1~K-14** · 요구사항 대비 해석·조정 **R-1~R-22** · 새로 발견한 기존 결함·관찰 **D-1~D-4** · 사용자 확인 필요 **U-1~U-8** · 구현 편차는 구현 후 §26에 **I-n**으로 기록

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

관리자는 챗봇마다 **위험 응답 규칙**(표현 목록 → 기록만 / 안전 문구로 대체 / AI로 보내지 않음)을 만든다. **사용자 질문**은 공개 대화 서비스의 한 지점(설문 예측 직후·의미 점수 전)에서 규칙과 대조되고 — 대체면 엔진·RAG를 부르지 않고 안전 문구를 즉시 돌려주며, "AI로 보내지 않음"이면 엔진 결과는 그대로 두고 외부 RAG 진입만 막는다. **외부 RAG 답**은 `RagAnswerService`의 성공 분기 한 지점(2,000자 절단 직후·출구 금지어 전)에서 규칙과 대조된 뒤 **주민등록번호·카드번호 형식**(챗봇별로 계좌·전화·이메일 추가)이 `pii-mask`의 **새 선택 인자**로 가려진다 — 대체되면 기존 실패 수렴(`FAILED`)으로 끝나 위젯은 한 줄도 바뀌지 않는다. 모든 판정은 메모리 사전 매칭·정규식뿐이라 **모델·임베딩 호출 0**, 규칙이 없는 챗봇은 **추가 쿼리·정규화 0**이다. 결과는 문장이 없는 **이벤트**와 대화 기록의 **표식 컬럼 1개**로 남고 통계 정의는 바뀌지 않는다. 환경 모드 챗봇에서 **운영 전환 2인 승인**을 켜면, 운영 포인터를 쓰는 유일한 서비스(`ProdSwitchService.switch()`)가 "요청자와 다른 관리자의 승인"이 없는 전환·비직전 롤백·예약 전환 실행을 거부하고, 승인은 **포인터 CAS와 요청 선점을 한 트랜잭션**으로 실행한다. 직전 운영 버전 롤백은 예외(즉시 · 표식 · 감사)이며, 정책이 켜진 동안 환경 모드 끄기는 막힌다. **엔진·위젯·채널 어댑터·공개 스키마·`@Public()`·권한·출구 클래스·ml-worker는 한 줄도 바뀌지 않는다.**

> 이 설계가 코드에서 **추가로 찾은 제약 14건**(요구사항 §0.2 외):
> **C-1 금지어 `detect()`는 입력 사전의 항목 객체를 그대로 돌려준다**(`banned-words/lib/banned-word-filter.ts` 17~32행 — `matches.push(entry)`). 규칙 표현을 같은 모양의 항목으로 컴파일하면 **파일 수정 없이** 역참조(`Map<항목, 규칙 id[]>`)로 재사용할 수 있다. 단 `EXACT`는 **공백으로 자른 토큰 집합**과 비교하므로 여러 단어 표현은 영원히 맞지 않는다 → 저장 시 거부(R-12).
> **C-2 금지어 필터 서비스는 사전 적재 실패 시 예외를 던진다**(`banned-word-filter.service.ts` 20~33행 — try 없음). 가드레일 캐시는 이 모양을 따르지 않고 **stale-on-error**로 둔다(NFR-AGR1 — 입구는 통과).
> **C-3 공개 턴 쿼리 수가 고정값으로 시험된다** — `data-governance-query-count-{off,on}.integration.spec.ts`(`EXPECTED_TURN_QUERY_COUNT` · "신규 챗봇의 첫 턴" 측정) · `environment-query-count.integration.spec.ts`(A/B 동일). 챗봇별 캐시 1층만 두면 규칙 없는 챗봇도 첫 턴 +1쿼리 → **전역 색인 캐시**를 둔다(§4.4 · 기대값 변경 0).
> **C-4 설문 턴 판정(`willSurveyConsumeInput`)에는 번들이 필요하다**(`public-conversation.service.ts` 286행). FR-AG2-7(설문 턴 제외)을 지키려면 입구 판정은 `loadServing()` 뒤에만 둘 수 있다 → 버전 읽기 실패 폴백 턴에서는 판정하지 않는다(K-6).
> **C-5 시뮬레이터는 외부 RAG를 직접 부르지만 답 문장을 돌려주지 않는다**(`simulation.service.ts` 374~426행 — `ragUsed`·지연·출처 수만). ADR-0022가 감수 비용으로 적은 "실제 답변 품질은 시뮬레이터에서 수동 확인"이 **현재 불가능** → D-2 · 이번에 `ragPreview`로 보완(§9).
> **C-6 TC 실행기의 RAG 결과는 `TestRunResult`에 `ragAttempted`·지연·출처 수만 저장한다**(`test-run-rag.service.ts` · `schema.prisma` 986~988행). 판정 표시를 넣으려면 결과 테이블·실행기·봉인을 바꿔야 한다 → 규모 B로 이월(R-1).
> **C-7 위젯은 보류 답변 `FAILED`에서 `outputs`를 말풍선으로 그리고 상태 문구 "지금은 답변을 준비하지 못했어요."를 띄우며, 관찰 창을 연다**(`apps/widget/src/ui/app.ts` 491·524행 · `core/handoff-poll.ts` 82행 · `constants/messages.ts` 27행). 출구 대체 = `FAILED` 수렴이면 위젯 변경 0으로 FR-AG3-3이 성립한다(상태 문구 불일치는 K-5).
> **C-8 운영 포인터 쓰기는 `environment-pointer.writer.ts` 1파일 · 호출은 `ProdSwitchService.switch()`만**(ADR-0039 E-1). 2인 승인 강제 지점으로 가장 작다.
> **C-9 `prod/rollback`은 임의의 운영 이력 버전을 대상으로 받고, `ROLLBACK`은 게이트 BLOCK을 WARN으로 낮춘다**(`switch-rules.ts` 15행 · `gate.ts` 33행). 정책이 켜진 챗봇에서 "롤백 전부 예외"는 1인 우회로 → 예외를 `pickRollbackTarget()` 결과로 좁힌다(R-8 · D-1).
> **C-10 환경 모드 끄기는 `PROMOTE_DRAFT`로 초안을 즉시 라이브로 만들고, `KEEP_PROD`도 이후 편집이 곧 라이브다**(`environment/lib/disable-plan.ts`). 승인 관문 전체의 옆문 → 정책이 켜진 동안 끄기 거부(R-7).
> **C-11 `EnvironmentModule`이 `DeploySchedulesModule`을 import한다**(`environment.module.ts` 36행). 예약 생성 트랜잭션 안에서 승인 요청을 만들려면 순환 의존이 생긴다 → 예약 생성은 그대로 두고 **실행 시 강제**(R-6).
> **C-12 `@RequirePermission('chatbot:deploy')` 사용 파일을 `environment.controller.ts` 1개로 단언하는 봉인이 있다**(`environment-sealing.spec.ts` E-14 354~358행) → 승인 컨트롤러 2개 = 닫힌 목록 X-1.
> **C-13 관리 콘솔에 "대화 기록 1건 열람" 전용 화면이 없다** — 대화 원천을 보는 곳은 상담 진행 목록·대화 보기(`live-sessions`)·인박스 스레드뿐이다(`cs:read`). FR-AG4-2 "적중 행 → 해당 대화 기록 열람"은 **이벤트 목록 응답에 로그 마스킹본을 함께 싣는** 방식으로 한다(열람 감사 +1 — R-13).
> **C-14 `ConversationLogService.record()`의 미응답 수집기는 `isAnswered=false`·`blockedByFilter=false`·텍스트 턴이면 질문을 큐에 넣는다**(`conversation-log.service.ts` 119~129행). 가드레일로 막힌 턴은 큐에 들어간다 — 수집기를 바꾸지 않는다(K-8).

---

## 1. PM 확정 사항 (2026-09-30)

| # | 확정 내용 | 요구사항 권고와의 관계 | 이 문서 반영 |
|---|---|---|---|
| **P-1** | 규모 **A**: 위험 응답 규칙(사용자 질문·외부 RAG 답 · 동작 3종 · 새 규칙 기본 "기록만" · 관리자가 쓴 답에는 출구 규칙 미적용) + RAG 답 개인정보 가림 + 운영 전환 2인 승인. **편향·환각 점검 도구(B)·런타임 근거 점검(C)은 하지 않음** | 권고 A | 전체 · §2.2 AG-3 |
| **P-2** | "환각 탐지"의 대상 = 외부 RAG 답만 — 단 이번 범위에서는 판정하지 않는다(규모 C 제외) | 권고 (a) | K-2 · 화면 문구 금지(AG-16) |
| **P-3** | 입구 + 출구 · 동작 3종 · 새 규칙 "기록만" · 관리자 답 미적용 | 권고 (a) | §4~§6 |
| **P-4** | 모델·LLM 판정 0 — 3050/운영 모델 무관 · 개발 PC에서 합격 판정 | 권고 (a) | FR-0-299·301 · §16 |
| **P-5** | 운영 전환(예약 포함)에 챗봇별 2인 승인 · 요청자 ≠ 승인자 · 기본 꺼짐 · 롤백 예외 · 만료(권고 24시간) · 자기 승인 금지 · **기존 승인 절차 현황 정리** | 권고 (b) | §10 · §11 |
| **P-6** | 출구 가림 기본 = **주민등록번호·카드번호만**, 계좌·전화·이메일은 챗봇별 선택 · 출구용은 `pii-mask`의 **별도 선택 인자** · 저장 마스킹 결과 바이트 불변 · 기존 저장 경로 동작 불변 | 권고 (a) | §7 |
| P-7 | (B 선택 시) — 해당 없음 | — | — |
| P-8 | 규칙 범위 = **챗봇별**(금지어는 전역 그대로) | 권고 | §4.1 |
| P-9 | 규칙 관리 = **ADMIN(`security:write`)** | 권고 | §14 |
| P-10 | GPU **5 → 1 + 각주** | 권고 | 패치 B-1·B-3 |
| P-11 | AI 답변 고지 — **법무 확인 전 구현하지 않음** | 권고 | K-14 · §20 |
| P-12 | 원본 PDF 재확인 권고 — 이 설계는 결과를 기다리지 않는다(원본에 관련 화면이 있으면 표시 문구만 보완) | 권고 | K-13 |
| 원칙 | 승인 없는 자산 변경 0 · 동기 대화 턴 모델·임베딩 호출 추가 0(공개 API 500ms · 임베딩 300ms 불변 · 출구 검사는 RAG 백그라운드 경로에서만) · 위젯·대화 엔진 변경 0 | FR-0-298~300 | AG-1~AG-5 |

---

## 2. 범위

### 2.1 바뀌는 것

| 영역 | 변경 | 근거 |
|---|---|---|
| `apps/api/src/guardrails/**` | **신설** — 관리 모듈(컨트롤러 1 · 13 핸들러) + 런타임 모듈(판정·캐시·이벤트 적재 — export 1) · §2.3 | §4·§5·§6·§8 |
| `apps/api/src/environment/approval/**` | **신설**(`EnvironmentModule` 안) — 승인 서비스·저장소 1파일·컨트롤러 2(9 핸들러) | §10 |
| `apps/api/src/environment/core/prod-switch.service.ts` | 2인 승인 **강제 지점**(`switch()` — 정책 판정 · 승인 호출 검증 · 트랜잭션 안 선점 콜백 · 예약 승인 확인 · 직전 롤백 예외 표식) · `preview()` 선택 필드 `approval?` | §10.5·§10.8 |
| `apps/api/src/environment/core/environment-pointer.writer.ts` | 메서드 +1(`updateApprovalPolicy`) · `switchProd` 입력 선택 필드 2(`approvalRequestId`·`approvalMode`) | §10.2 |
| `apps/api/src/environment/core/environment-read.service.ts` | `PointerStatus.approval`(읽기 필드 — 같은 `findUnique` 행) | §10.2 |
| `apps/api/src/environment/core/lib/approval-policy.ts` | **신설** 순수 함수(승인 필요 판정 · 직전 롤백 판정) | §10.8 |
| `apps/api/src/environment/environment-mode.service.ts` | 끄기·끄기 미리보기에 정책 판정 1조건 | §10.9 |
| `apps/api/src/environment/environment.module.ts` | 승인 서비스·저장소·컨트롤러 2 등록 · `BannedWordsModule` import(사유 마스킹) | §10 |
| `apps/api/src/conversation/public-conversation.service.ts` | ③.6 입구 판정 1지점 · RAG 진입 결합 1줄 · 선택 생성자 인자 20번째(끝) | §5 |
| `apps/api/src/conversation/conversation-log.service.ts` | `record()` 선택 파라미터 `guardrailStage` → 컬럼 | §8.2 |
| `apps/api/src/conversation/conversation.module.ts` | `GuardrailRuntimeModule` import | §5 |
| `apps/api/src/rag/rag-answer.service.ts` | 성공 분기 출구 판정 1지점 · `finishAsFallback` 선택 인자 · 선택 생성자 인자 6번째(끝) | §6 |
| `apps/api/src/rag/conversation-log.port.ts` · `rag.module.ts` | 포트 선택 필드 1 · 런타임 모듈 import | §6 |
| `apps/api/src/simulation/simulation.service.ts` · `simulation.module.ts` | 입구 판정 표시 · RAG 답 미리보기 + 출구 판정 표시(이벤트 0) · 선택 생성자 인자 1 | §9 |
| `apps/api/src/deploy-schedules/lib/outcome-classifier.ts` | 오류 코드 → 영구 실패 `APPROVAL_MISSING` 1분기 | §10.7 |
| `apps/api/src/chatbots/chatbots.service.ts` | 영구삭제 동반 삭제 +4(30 → 34테이블) | §12.4 |
| `apps/api/src/audit-logs/lib/audit-snapshot.ts` · `access/view-audit-targets.ts` | `AUDIT_FIELDS` 2대상 신설 + 2대상 필드 추가 · 열람 감사 +1(12 → 13) | §14 |
| `apps/api/src/governance/governance-map.service.ts` | 데이터 지도 선택 키 `guardrails?`(0건이면 생략 — 바이트 동일) | §8.6 |
| `apps/api/src/config/env.validation.ts` · `app.module.ts` | 선택 환경변수 5 · `GuardrailsModule` 등록 | §15 |
| `apps/api/prisma/schema.prisma` + 마이그레이션 1 | 신규 4테이블 + 기존 3테이블 `ADD COLUMN` 5 · `Chatbot` 역참조 3줄(DB 컬럼 0) | §12 |
| `packages/pii-mask/src/index.ts` | 선택 인자 2(`kinds`·`preserveDates`) · 타입 `PiiKind` export · 기존 본문 불변 | §7 |
| `packages/shared-types` | 신설 `guardrails.ts`·`prod-switch-approval.ts` · `ApiErrorCode` +6 · `AuditTargetType` +2 · `DeployScheduleFailureReason` +1 · 전환/끄기 미리보기·시뮬레이터·데이터 지도 선택 필드 | §13 |
| `apps/web` | 화면 3(위험 응답 규칙·시험하기 · 가드레일 현황 · 승인 대기) + 기존 화면 보강(환경 탭 · 예약 배포 폼/목록 · 시뮬레이터 결과 패널) | §17 |
| 문서 | 이 설계서 · ADR-0048 · 패치 목록 | §24 |

### 2.2 바뀌지 않는 것 (봉인 — code-reviewer·정적 검사 대상)

| # | 봉인 | 확인 방법 |
|---|---|---|
| **AG-1** | `packages/dialogue-engine`·`apps/widget`·채널 어댑터(`conversation/adapters/**`)·`apps/ml-worker` 변경 0 · 공개 대화 요청/응답·보류 폴링 스키마(`PublicMessageRequestDto`·`PublicMessageResponse`·`PendingAnswerPollResponse`) 변경 0 · `@Public()` **9** 불변 | `git diff --stat` · `validation-sealing` 7)(9개) 무수정 통과 · 엔진 골든 스냅샷(E-5) 무수정 |
| **AG-2** | `EgressExitId` **7** · `Permission` **18** · `AuditAction` **16** 불변 | 기존 단언(`rich-message-sealing`·`proactive-sealing`·`kb-sync-sealing`·`topic-sealing`) 무수정 |
| **AG-3** | `guardrails/**`·`environment/approval/**`에 모델·임베딩·LLM·외부 호출 심볼 0 — `EmbeddingProviderFactory`·`QueryEmbeddingService`·`SemanticMatchService`·`AugmentationProvider`·`ClusterNameSuggester`·`RagHttpClient`·`LegacyApi`·`fetch(` 0 | GR-1(신규 봉인) |
| **AG-4** | 쓰기 유일 파일 — `guardrailRule` = `core/guardrail-rule.store.ts` · `chatbotGuardrailSetting` = `core/guardrail-setting.store.ts` · `guardrailEvent`(create류) = `runtime/guardrail-event.writer.ts` · `prodSwitchApprovalRequest` = `environment/approval/switch-approval.store.ts` · 네 모델의 `delete*`는 위 파일 + `chatbots/chatbots.service.ts`(영구삭제)만 | GR-2 |
| **AG-5** | **자산 변경 0** — `guardrails/**`·`environment/approval/**`에 `intent`·`keyword`·`faqEntry`·`dialogNode`·`topic`·`homonymDictionary`·`contextVariable`·`chatbotAnswerSetting`·`bannedWord` 쓰기 호출 0 · 자산 서비스 심볼(`IntentsService`·`FaqsService`·`DialogNodesService`·`LearningApplyService`·`VersionRestoreService`) 0 | GR-3 |
| **AG-6** | `GuardrailEvent`·`ProdSwitchApprovalRequest` 모델에 `userMessage`·`botResponse`·`text`·`answer`·`question`·`body` 컬럼 0(요청 `reason`·`decisionNote`는 마스킹 메모 ≤200 — 예외 명시) | GR-4(schema 스캔) |
| **AG-7** | `maskPii()` **기존 본문 불변** — 선택 인자 없는 호출 결과가 도입 전 골든과 바이트 동일(PARTIAL·FULL) · `kinds:`/`preserveDates:` 인자를 넘기는 운영 코드 파일 = `guardrails/lib/exit-pii.ts` 1개 · 기존 `pii-mask` 시험 무수정 — ⚠ **2026-10-01 개정(ADR-0049 §4)**: 바이트 불변은 **독립 날짜 구간을 제외하고**(생년월일 문맥 날짜는 v1과 동일하게 가림) 유지(규칙 v2 · `preserveDates` 생략 = true · v1 동결 골든 + 차분 시험 — `pm-decisions-2026-10-01-설계.md` §5) | GR-5 + 골든 시험 |
| **AG-8** | (`guardrails/**` 밖의) 입구 판정 호출 `guardrails?.evaluateInbound(` = `public-conversation.service.ts` 정확히 1회 + `simulation.service.ts` 1회 · 출구 판정 `evaluateOutbound(` = `rag-answer.service.ts` 1회 + `simulation.service.ts` 1회 · `recordEvents(` 호출 파일 = {`public-conversation.service.ts`, `rag-answer.service.ts`}(시뮬레이터 0) | GR-6 |
| **AG-9** | 외부 RAG 봉인 불변 — `rag-allowlist.spec.ts` 무수정 · `guardrails/**`에 `prompt`·`/api/rag/settings`·`rag_paragraph_detail` 문자열 0 | 기존 + GR-7 |
| **AG-10** | `packages/dialogue-engine/src`·`apps/widget/src`·`apps/ml-worker`에 `guardrail`·`approval` 토큰 0(대소문자 무시) | GR-8 |
| **AG-11** | 2인 승인 강제 지점 1곳 — `writer.switchProd(` 호출 파일 = `prod-switch.service.ts` 1개(기존) · 그 파일의 `switchProd(` 호출 **앞**에 `assertApprovalSatisfied(`(private 메서드) 호출이 있고 **같은 `$transaction` 콜백 안에** `claim(` 호출이 있다 | GR-9 |
| **AG-12** | `prodSwitchApprovalRequest`의 상태 전이 `update*` 호출은 전부 `where`에 `status: 'PENDING'`을 포함한다(CAS) — 저장소 1파일 안 정규식 검사 | GR-10 |
| **AG-13** | 로그 인자 — `guardrails/**`·`environment/approval/**`의 `logger.(log|warn|error|debug)(` 줄에 `text`·`reason`·`note`·`expression`·`replacement`·`answer`·`question`·`userMessage` 식별자 0(E-13 확장) | GR-11 + E-13 무수정 |
| **AG-14** | 규칙은 대화 자산이 아니다 — `versions/**`(스냅샷·복원·해시)·`asset-transfer/**`·`topics/topic-split*`·`chatbots.service.ts`의 `copy`·`environment/staging-promotion.service.ts`에 `guardrailRule`·`GuardrailRule` 토큰 0(영구삭제 `deleteMany`는 예외) | GR-12 |
| **AG-15** | `deploy-schedules/**` 변경은 `lib/outcome-classifier.ts` 1파일(분기 1)만 — `deploySchedule` 쓰기 봉인(D-1) 무수정 · 예약 모듈에 `approval` 쓰기 0 | `deploy-schedule-sealing.spec.ts` 무수정 + GR-13 |
| **AG-16** | 콘솔 이 기능 화면 문자열에 "환각"·"hallucination"·"편향 없음" 0 | web vitest |
| **AG-17** | `EnvironmentCoreModule` exports = {`ProdSwitchService`, `EnvironmentReadService`} 불변 · `EnvironmentPointerWriter` 미export 불변 | E-15 무수정 |
| **AG-18** | 금지어 모듈 무수정 — `banned-words/**` diff 0(가드레일은 `detect()`를 import만) | `git diff` · GR-14 |

### 2.3 파일 구조

```
apps/api/src/guardrails/
  guardrails.module.ts                imports: GuardrailRuntimeModule · BannedWordsModule · ChatbotsModule(ChatbotScopeService)
                                               · AuditLogsModule · AnswerSettingsModule(RAG 사용 여부 표시)   exports: 없음
  guardrails.controller.ts            13 핸들러(§13.1) — 권한 데코레이터·zod 파이프 · listEvents에 @AuditView
  guardrail-rules.service.ts          규칙 CRUD·켜기/끄기·이동 · 검증(lib) · 감사 · 캐시 무효화
  guardrail-settings.service.ts       출구 개인정보 설정 조회/저장 · 거버넌스 하한 · 감사(대상 Chatbot)
  guardrail-test.service.ts           문장으로 시험하기(저장 0 · 감사 0 · 초안 규칙/초안 설정 선택 반영)
  guardrail-overview.service.ts       현황 집계 · 이벤트 목록(로그 마스킹본 조인)
  guardrail.mapper.ts                 행 ↔ DTO(JSON 파싱 폴백)
  core/guardrail-rule.store.ts        ★GuardrailRule 쓰기 유일 파일
  core/guardrail-setting.store.ts     ★ChatbotGuardrailSetting 쓰기 유일 파일
  runtime/guardrail-runtime.module.ts exports: GuardrailRuntimeService 1개(ConversationModule·RagModule·SimulationModule·GuardrailsModule이 import)
  runtime/guardrail-runtime.service.ts  evaluateInbound · evaluateOutbound · recordEvents · invalidate(chatbotId)
  runtime/guardrail-profile.cache.ts  전역 색인(단일 슬롯) · 챗봇 규칙 프로필 · 챗봇 출구 설정 — TTL + 즉시 무효화 + stale-on-error
  runtime/guardrail-profile.loader.ts Prisma 읽기 3쿼리(색인·규칙·설정)
  runtime/guardrail-event.writer.ts   ★GuardrailEvent 적재 유일 파일(createMany · fire-and-forget · 예외 삼킴)
  lib/                                순수 함수(DB·Nest 무의존 — NFR-AGM1)
    rule-validate.ts        표현 정규화·중복 제거·길이·EXACT 다단어 거부 · 대체 문구 텍스트 검사(HTML·URL)
    compile-profile.ts      규칙[] → 입구/출구 사전(BannedWordEntry 모양) + 역참조 맵 + 요약 플래그
    evaluate-rules.ts       ★판정 교체 지점(NFR-AGM2) — (텍스트, 사전, 단계) → 적중·최종 동작·대체 문구·결정 규칙
    strongest-action.ts     REPLACE > NO_RAG > MONITOR · 동률 = sortOrder → createdAt → id
    exit-pii.ts             ★`maskPii(text, { kinds, preserveDates })` 호출 유일 파일 · 토큰만 남음 판정
    verdict-events.ts       판정 → 이벤트 행 목록(문장 0)
    overview-aggregate.ts   이벤트·로그 집계 → 현황 DTO
  lib/guardrail-sealing.spec.ts       봉인 GR-1~GR-14
  eval/measure-guardrail-latency.ts   성능 측정 도구(CI 밖 — §18.3)

apps/api/src/environment/approval/
  switch-approval.service.ts          정책 조회/변경 · 요청 생성 · 승인 · 반려 · 취소 · 지연 만료 · 목록
  switch-approval.store.ts            ★ProdSwitchApprovalRequest 쓰기 유일 파일(전이는 전부 PENDING CAS · claim 콜백 제공)
  switch-approvals.controller.ts      챗봇 스코프 7 핸들러
  environment-approvals-global.controller.ts   전역 2 핸들러(대기 목록·요약)
  switch-approval.mapper.ts
  lib/approval-state.ts               순수 함수 — 유효 상태(만료·기준 변경·예약 비활성 판정) · 만료 시각 계산 · 승인 가능 여부
apps/api/src/environment/core/lib/approval-policy.ts   순수 함수 — requiresApproval(policy, kind, isDirectRollback)
```

---

## 3. 구성도

```
[입구 — 동기 공개 턴]  POST /public/chatbots/:slug/messages
  ① access.resolve → ①.5 식별(No.42)
  ②.5 입구 금지어 ──BLOCK──▶ 안내 문구(기존) · 가드레일 0
  ②.7 상담 게이트 ──HANDLED──▶ 사람 대화(기존) · 가드레일 0
  ③ loadServing(번들·설정)      (버전 읽기 실패 → 고정 폴백 · 가드레일 0 — K-6)
  ③.5 설문 소비 예측(willSurveyConsumeInput)
  ③.6 ★ guardrails.evaluateInbound(chatbotId, filterableText)   ← 설문 소비 예정·NODE 버튼이면 건너뜀
        │  (전역 색인에 없음 → PASS · 쿼리 0 · 정규화 0)
        ├─ REPLACE ─▶ 대체 문구 TEXT 1(+G-8 전치) → 출구 금지어 → 응답(상태 보존 · 관찰 창 힌트)
        │              → 로그(isAnswered=false · guardrailStage=INBOUND) · 이벤트(void)
        ├─ NO_RAG  ─▶ 엔진 그대로 · ⑦ RAG 진입 = false(슬롯 소비 0) · 이벤트
        └─ MONITOR/PASS ─▶ 흐름 변화 0 · (MONITOR면) 이벤트
  ③④ 의미 점수 → 엔진 → … → ⑦ RAG 분기(기존)

[출구 — RAG 백그라운드]  RagAnswerService.run()
  외부 응답 → judgeRagResponse(4조건) → 출처 정제 → truncateAnswer(2,000자)
  ★ guardrails.evaluateOutbound(chatbotId, answerText)   ← 예외 없음(내부 수렴)
        ├─ REPLACE ─▶ callLog(SUCCESS) → finishAsFallback(대체 문구, OUTBOUND) → FAILED(위젯 관찰 창)
        ├─ FALLBACK(개인정보만 남음 · 판정 오류 · 프로필 미확보) ─▶ finishAsFallback(기존 폴백 문구, OUTBOUND)
        └─ PASS/MONITOR/MASKED ─▶ 가린 텍스트 → 출구 금지어 → complete(READY) → 로그 → 이벤트
  (관리자 답·API 값·상담원 메시지는 이 경로가 아니다 — 출구 규칙 0)

[2인 승인]
  콘솔 ─(정책 켜짐)─▶ POST …/environment/approval/requests ─▶ ProdSwitchApprovalRequest(PENDING · pendingLock)
  다른 ADMIN ─▶ POST …/requests/:id/approve
        └▶ ProdSwitchService.switch(…, { approval: { requestId, approverId, claim } })
               검증(요청자≠승인자 · 기준=현재 · 대상 허용 · 게이트 재평가 · 경고 확인)
               $transaction { writer.switchProd(CAS · 이력 approvalMode=APPROVED) ; claim(tx) = PENDING→APPROVED CAS }
  예약 실행기 ─▶ ProdSwitchService.switch(…, { deployScheduleId }) ─▶ 승인된 요청 확인 · 없으면 409 → APPROVAL_MISSING
  prod/switch(기존) ─(정책 켜짐)─▶ 409 ENV_APPROVAL_REQUIRED
  prod/rollback(기존) ─ 직전 버전 ─▶ 즉시(approvalMode=SOLO_ROLLBACK) / 그 외 ─▶ 409
  environment/disable(기존) ─(정책 켜짐)─▶ 409 ENV_APPROVAL_REQUIRED(POLICY_ACTIVE)
```

---

## 4. 위험 응답 규칙 — 모델·검증·매칭·캐시

### 4.1 규칙 데이터(요약 — Prisma 초안은 §12.1)

| 필드 | 제약 | 비고 |
|---|---|---|
| `name` | 1~50자 · `nameNormalized`(= `normalizeText`) 챗봇 안 유일 | ADR-0006 · 중복 `409 DUPLICATE_NAME` |
| `category` | 닫힌 8종 `CRISIS_SELF_HARM`·`MEDICAL_ADVICE`·`LEGAL_ADVICE`·`FINANCIAL_ADVICE`·`PERSONAL_INFO_REQUEST`·`PROMPT_INJECTION`·`DISCRIMINATION_HATE`·`OTHER` | 표시 라벨은 shared-types 상수(위기·자해 / 의료 조언 / 법률 조언 / 투자·재무 조언 / 개인정보 요구 / 지시 무시 시도 / 차별·혐오 / 기타) |
| `expressions` | 1~100개 · 각 1~50자(원문 trim) · 정규화 뒤 **2자 이상**(EX-AG-1) · 정규화 기준 중복 제거 · JSON 문자열 배열 | 원문 저장(관리자 설정값) · 정규식 금지 |
| `matchType` | `CONTAINS`(기본)｜`EXACT` — `BannedWordMatchType` 재사용 · `EXACT`인데 정규화 표현에 공백이 있으면 거부(C-1) | |
| `appliesTo` | `INBOUND`｜`OUTBOUND`｜`BOTH` | 필수(기본값 없음 — 관리자가 고른다) |
| `action` | `MONITOR`(기본)｜`REPLACE`｜`NO_RAG` · `NO_RAG`는 `appliesTo=INBOUND`에서만(AC-AG2-4 · `BOTH`도 거부) | FR-AG1-3 |
| `replacementText` | `REPLACE`면 필수 1~300자 · 아니면 저장 값 `null`(입력돼도 버림) · 텍스트만(§4.2) · 금지어 검사 통과 | FR-AG1-5 |
| `enabled` | 기본 `true` | 새 규칙은 켜진 "기록만" = 관찰 시작 |
| `sortOrder` | 생성 시 맨 뒤 · 위/아래 이동 | FR-AG1-4 동률 기준 |
| 상한 | 챗봇당 규칙 `GUARDRAIL_MAX_RULES_PER_CHATBOT`(50) · 표현 총합 `GUARDRAIL_MAX_EXPRESSIONS_PER_CHATBOT`(2,000) — 초과 `409 LIMIT_EXCEEDED` | 꺼진 규칙도 센다 |

- **대화 자산이 아니다**: 버전 스냅샷·복원·토픽 분리·스테이징 승격·챗봇 복사·가져오기/내보내기 대상이 아니다(AG-14). 환경 모드 챗봇에서도 초안/운영 구분 없이 저장 즉시 적용된다. 규칙 내보내기/가져오기(챗봇 간 복사)는 2차(요구사항 권고).
- **보관(`ARCHIVED`) 챗봇**: 조회만 허용(쓰기 `409 CHATBOT_ARCHIVED` — EX-AG-10). 영구삭제 시 동반 삭제.

### 4.2 저장 검증 순서(`lib/rule-validate.ts` + 서비스)

1. zod(형식·길이·교차 조건 — §13.2).
2. 표현 정규화 → 빈 값·2자 미만 거부(`400 VALIDATION_FAILED`, `details[].field = expressions.<i>`, 메시지 코드 `TOO_SHORT`) → 중복 제거(첫 등장 유지 · 응답에 제거 수 표시) → `EXACT` 다단어 거부(`EXACT_MULTI_TOKEN`).
3. 대체 문구 텍스트 검사: `<`·`>`로 둘러싼 태그 모양 · `http://`·`https://`·`www.` · `javascript:` 포함 시 거부(`400 VALIDATION_FAILED` 코드 `NOT_PLAIN_TEXT`). 줄바꿈은 허용(최대 5줄).
4. 대체 문구 금지어 검사 — `BannedWordFilterService.test(text)`의 `matches.length > 0`(정책 무관)이면 `400 BANNED_WORD_BLOCKED`(details에 걸린 단어 — 관리자 화면 전용).
5. 상한(규칙 수·표현 총합 — 트랜잭션 안에서 다시 셈).
6. 저장(store) → 감사 → `runtime.invalidate(chatbotId)`(커밋 뒤 · 전역 색인 포함).

- 목록 응답은 규칙마다 `replacementBannedHit`(현재 금지어 사전 기준 — 저장 후 금지어가 추가된 경우 EX-AG-9 경고)와 최근 7일 적중 수를 싣는다.
- 세션 만료 중 저장은 전역 가드가 `401`로 거부한다(부분 저장 0 — EX-AG-15, 트랜잭션 1개).

### 4.3 매칭 — 금지어 `detect()` 무수정 재사용(C-1 · AG-18)

- 컴파일(`compile-profile.ts`): 켜진 규칙을 단계별로 나눠(`INBOUND`=`INBOUND|BOTH`, `OUTBOUND`=`OUTBOUND|BOTH`) 표현마다 `{ word, wordNormalized, matchType, policy: 'WARN' }` 항목을 만든다. **같은 `(wordNormalized, matchType)`는 항목 1개**로 합치고 `Map<항목, RuleRef[]>`에 규칙을 모은다(`policy` 필드는 `detect()`가 읽지 않는 자리채움 상수).
- 판정(`evaluate-rules.ts`): `detect(text, dict)` → 돌아온 항목 객체로 맵을 조회 → 적중 규칙 집합(규칙당 1회 · 적중 표현 목록 포함) → `strongest-action.ts`로 최종 동작(REPLACE > NO_RAG > MONITOR) · 대체 문구 = REPLACE 규칙 중 `sortOrder` → `createdAt` → `id` 최소 1개 · 결정 규칙 id.
- 입력 텍스트 = 금지어 입구 필터와 **같은 값**(`resolveFilterableInboundText` — `message` 또는 `MESSAGE` 버튼 텍스트 · `NODE` 버튼은 `undefined` = 판정 생략, FR-AG2-2 · AC-AG3-5).
- 한계: 정규화(`NFKC`·소문자·공백 축약)가 금지어와 같다 — 띄어쓰기 삽입·은어·다른 언어는 표현 목록에 있어야 맞는다(EX-AG-2·3 → K-1).

### 4.4 캐시(`runtime/guardrail-profile.cache.ts`)

| 층 | 키 | 적재 쿼리 | TTL | 무효화 | 실패 시 |
|---|---|---|---|---|---|
| ① 전역 색인 | 단일 슬롯 | `guardrailRule.findMany({ where: { enabled: true }, select: { chatbotId: true }, distinct: ['chatbotId'] })` 1개 | `GUARDRAIL_CACHE_TTL_MS`(60초) | 규칙 쓰기마다 즉시 | 직전 값 유지(+5초 재시도 지연) · 한 번도 없으면 "색인 미확보" |
| ② 규칙 프로필 | `chatbotId` | `guardrailRule.findMany({ where: { chatbotId, enabled: true }, orderBy: [sortOrder, createdAt, id] })` 1개 — **①에 있는 챗봇만** | 같음 | 그 챗봇 규칙 쓰기 | 직전 값 유지 · 없으면 "프로필 미확보" |
| ③ 출구 설정 | `chatbotId` | `chatbotGuardrailSetting.findUnique` 1개 — **출구 경로·시험·시뮬레이터에서만** | 같음 | 설정 저장 | 직전 값 유지 · 없으면 "미확보" |

- 상한: ②·③ 각 5,000항목(초과 시 가장 오래 적재된 것부터 제거 — FIFO). 항목은 작다(규칙 50 × 표현 100 이하).
- **규칙 없는 챗봇의 공개 턴 비용**: ① 적중(메모리) → 없음 → `PASS` — **쿼리 0 · 정규화 0**(FR-AG2-6). 첫 턴에 ①이 비어 있으면 **프로세스 전체에서 1회** 적재된다(금지어 전역 캐시와 같은 성질 — 시험의 예열 턴이 흡수, C-3).
- **입구에서 색인 미확보**(콜드 + DB 장애)면 `PASS`(대화 중단 금지 — NFR-AGR1) + 경고 로그.
- **다중 인스턴스**: 즉시 무효화는 같은 프로세스만이다 — 다른 인스턴스는 TTL 뒤 반영(K-4 · 금지어 캐시와 같은 수준). AC-AG2-5는 단일 인스턴스 기준으로 판정한다.
- `GUARDRAILS_ENABLED=false`면 런타임 판정 3종이 캐시를 조회하지 않고 즉시 `PASS`(가림 포함 전부 꺼짐 — 서버 긴급 스위치 · §15).

### 4.5 판정 결과 타입(런타임 서비스 공개 계약 — 개념)

```ts
type GuardrailStage = 'INBOUND' | 'OUTBOUND';
interface RuleHit { ruleId: string; ruleName: string; category: GuardrailCategory; action: GuardrailAction; sortOrder: number; matched: string[] /* 원문 표현 — 이벤트·로그에 싣지 않는다 */ }
interface InboundVerdict { action: 'PASS' | 'MONITOR' | 'NO_RAG' | 'REPLACE'; replacementText?: string; decisiveRuleId?: string; hits: RuleHit[] }
interface OutboundVerdict {
  kind: 'PASS' | 'MONITOR' | 'MASKED' | 'REPLACE' | 'FALLBACK';
  text: string;                        // PASS·MONITOR·MASKED일 때 사용자에게 나갈 텍스트(출구 금지어 전)
  replacementText?: string;            // REPLACE
  fallbackReason?: 'PII_ONLY' | 'ERROR' | 'PROFILE_UNAVAILABLE';
  hits: RuleHit[];
  piiCounts: Partial<Record<GuardrailPiiKind, number>>;
  errorCode?: string;                  // 예외 클래스 이름 수준(메시지·문장 0)
}
```

- `evaluateInbound`·`evaluateOutbound`는 **예외를 던지지 않는다**(내부 try/catch — 입구 오류 = `PASS` + 경고 로그 · 출구 오류 = §6.3 규칙). `recordEvents(ctx, verdict, effect)`는 `void`(fire-and-forget).

---

## 5. 입구 적용 — 사용자 질문

### 5.1 삽입 지점(정확한 위치)

`apps/api/src/conversation/public-conversation.service.ts` `sendMessage()`:

- **③.6(신설)** = 286행 `const surveyExpected = willSurveyConsumeInput(inbound.state, bundle, now);` **직후**, 288행 `③④ 1단계 의미 유사도` 주석 **직전**.
- 조건: `this.guardrails`가 주입됨 ∧ `!surveyExpected` ∧ `filterableText !== undefined`. 아니면 `PASS`(판정 호출 0).
- 금지어 BLOCK(②.5)·상담 HANDLED(②.7)·버전 읽기 실패(③ catch)는 이미 반환했으므로 이 지점에 오지 않는다 — FR-AG2-1·FR-AG2-7 · AC-AG3-2·3.
- 생성자: 20번째(끝) 선택 인자 `private readonly guardrails?: GuardrailRuntimeService` — 기존 19인자 호출(단위 시험) 무수정 통과(No.35 선례).
- 이 파일의 기존 봉인(E-9 `bundleSourceOf(`·`.getCached(`·`versionBundles.get(` 각 1회 · PA-8 `proactive` 토큰 범위 · O-14 식별 1회 · 리치 메시지 `renderOutbound(` 1회)을 건드리지 않는다 — 새 메서드·식별자 이름에 `getCached`·`proactive`를 쓰지 않는다.

### 5.2 동작별 처리

| 판정 | 처리 | 응답 | 대화 기록 | 이벤트 |
|---|---|---|---|---|
| `PASS` | 변화 0 | 현행과 바이트 동일 | 현행 | 0 |
| `MONITOR` | 변화 0 | 현행과 동일 | 현행 | 적중 규칙마다 1(`effect=NONE`) |
| `NO_RAG` | 엔진 정상 실행. ⑦에서 `ragEligible = apiTurn ? false : evaluateRagEligibility(…)` · **`shouldTryRag = ragEligible && action !== 'NO_RAG'`** — `ragGate.tryAcquire()` 미호출(슬롯 소비 0 · AC-AG3-4) · `shouldRunRag()` 순수 함수 무수정 | 엔진 결과(답했으면 답 · 못 했으면 기존 폴백) | 현행 | 적중마다 1 · 결정 규칙 `effect = ragEligible ? CHANGED : NONE` |
| `REPLACE` | **엔진·의미 점수·설문·RAG·워크플로 미호출** · `messageId = randomUUID()` · `outputs = maskOutbound([...handoffPrependOutputs, TEXT(대체 문구)])` | `{ messageId, outputs, state: 보존, stateReset: false, handoff: buildWatchHint(…, isAnswered=false) }` — 평가 표식 없음(BLOCK 선례) | `rawBotResponse = buildBotResponseText(outputs)` · `isAnswered=false` · `inputKind` · `servedVersionId` · **`guardrailStage='INBOUND'`** · `feedbackOffered=false` | 적중마다 1 · 결정 규칙 `effect=CHANGED` |

- **상태 보존**: `ConversationStateSchema.safeParse(inbound.state)`(상담 게이트가 갱신한 값) — 실패면 빈 봉투(BLOCK과 같은 코드 모양 · EX-12-26 선례).
- **관찰 창 힌트**: BLOCK은 힌트가 없지만, 대체 턴은 "미응답"이며 출구 대체(`FAILED`)가 관찰 창을 여는 것과 대칭을 맞춘다(위기 질문 → 상담 연결이 가능한 챗봇이면 연결 제안). R-5.
- **연속 미응답(EX-AG-4)**: `isAnswered=false`로 적재되므로 No.24 연속 미응답 경고·No.41 `TURN_LOGGED` 판정에 기존 규약대로 반영된다(권고 채택).
- 이벤트 적재는 로그 `record()`와 같이 `await` 없이 호출한다(NFR-AGP4).

### 5.3 비용

- 규칙 없는 챗봇: 메모리 조회 1회(`Set.has`) — 쿼리 0 · 정규화 0.
- 규칙 있는 챗봇(캐시 적중): 정규화 1회 + `includes` ≤ 고유 표현 수(≤2,000) → **P95 1ms 이하 목표**(NFR-AGP1 · AC-AG3-6 측정).
- 규칙 있는 챗봇(캐시 콜드): 규칙 쿼리 1개(TTL당 1회).

---

## 6. 출구 적용 — 외부 RAG 답

### 6.1 삽입 지점(정확한 위치)

`apps/api/src/rag/rag-answer.service.ts` `run()` 성공 분기:

- 142행 `const answerText = truncateAnswer(judgement.response.result);` **직후**, 143행 `const outputs = await this.bannedWordFilter.maskOutbound(...)` **직전**에 `const verdict = this.guardrails ? await this.guardrails.evaluateOutbound(input.chatbotId, answerText) : null;`
- 판정은 절단 뒤 텍스트(EX-AG-5 — 절단 순서 유지)에 한다. 출처 정제·스코프 경고(137~141행)는 판정 전 그대로 계산하되, 대체·폴백이면 쓰지 않는다(출처 0).
- 생성자: 6번째(끝) 선택 인자 `private readonly guardrails?: GuardrailRuntimeService`(`rag-answer.service.spec.ts` 5인자 호출 무수정).

### 6.2 판정별 처리

| `verdict.kind` | `RagCallLog` | 보류 답변 | 대화 기록 | 이벤트 |
|---|---|---|---|---|
| (가드레일 미주입 · `null`) | 현행 | 현행 | 현행 | 0 |
| `PASS` | `SUCCESS`(현행) | `READY` · `outputs = maskOutbound(TEXT(verdict.text))` · 출처(현행) | 현행(`rawBotResponse = verdict.text`) | 0 |
| `MONITOR` | `SUCCESS` | 현행과 같음 | 현행 | 적중마다 1(`NONE`) |
| `MASKED` | `SUCCESS` | `READY` · 가린 텍스트 · 출처(현행) | `rawBotResponse = 가린 텍스트`(저장 마스킹은 토큰에 숫자가 없어 멱등) · `answeredByRag=true` | 개인정보 종류마다 1(`kind=PII` · `appliedAction=MASK` · 건수) + 적중 규칙마다 1 |
| `REPLACE` | `SUCCESS`(외부 호출 자체는 성공 — 호출 품질 기록) | **`FAILED`** · `outputs = maskOutbound(TEXT(대체 문구))` · 출처 없음 | `finishAsFallback(…, { text: 대체 문구, guardrailStage: 'OUTBOUND' })` → `isAnswered=false` · `answeredByRag=false` | 적중마다 1 · 결정 규칙 `CHANGED` |
| `FALLBACK` | `SUCCESS` | **`FAILED`** · 기존 폴백 문구(`input.fallbackText`) | `finishAsFallback(…, { text: input.fallbackText, guardrailStage: 'OUTBOUND' })` | `PII_ONLY` → 개인정보 종류별 이벤트(`appliedAction=FALLBACK`) · `ERROR`·`PROFILE_UNAVAILABLE` → `kind=ERROR`·`appliedAction=FALLBACK` 1 |

- `finishAsFallback(input, logPort, maskedQuestion, override?)` — 4번째 선택 인자 `{ text: string; guardrailStage: 'OUTBOUND' }`. 없으면 현행과 같다(기존 호출 4곳 무수정).
- `ConversationLogPort.record()`에 선택 필드 `guardrailStage?: 'INBOUND' | 'OUTBOUND'`(값이 있을 때만 키 — 조건부 전개 · 기존 `objectContaining` 단언 불변).
- 이벤트의 `messageId` = `input.messageId`(보류 답변 id = 대화 기록 id).
- 위젯: `FAILED` → 말풍선 + 상태 문구 + (상담 켜진 챗봇 · 기능 선언 시) 관찰 창 — 변경 0(C-7 · AC-AG4-1).
- **`EX-AG-8` 개인정보만 남은 답**: 가린 텍스트에서 마스킹 토큰(`[주민등록번호]`·`[카드번호]`·`[계좌번호]`·`[전화번호]`·`[이메일]`·부분 마스킹 모양)·공백·문장부호를 지웠을 때 남는 글자가 0이면 `FALLBACK(PII_ONLY)`(권고 채택).

### 6.3 오류·미확보 시 수렴(FR-AG3-6 · EX-AG-6·7 · NFR-AGR1)

| 상황 | 결과 | 근거 |
|---|---|---|
| 규칙 프로필·설정 적재 실패, 직전 값 있음 | 직전 값으로 정상 판정 + 경고 로그(챗봇 id·오류 이름만) | stale-on-error |
| 한 번도 적재 못 함(콜드 + DB 장애) | **`FALLBACK(PROFILE_UNAVAILABLE)`** | RAG는 선택 단계 — 폴백 비용이 작다 · 가림 기본 켜짐이라 확인 못 한 답을 내보내지 않는다(R-3) |
| 판정·가림 중 예외, 그 챗봇에 출구 `REPLACE` 규칙이 있거나 개인정보 가림이 켜져 있음(기본) | **`FALLBACK(ERROR)`** | 요구사항은 "대체 규칙이 있으면"이었으나 가림 기본 켜짐까지 넓혔다(R-2) |
| 판정 중 예외, 출구 대체 규칙 없음 ∧ 가림 꺼짐 | 원답 `PASS` + `kind=ERROR` 이벤트(`appliedAction=MONITOR`) | FR-AG3-6 |
| 전역 색인 미확보 | 출구는 ②를 직접 적재 시도(색인 우회) — 그것도 실패면 위 "한 번도 적재 못 함" | 출구는 백그라운드라 쿼리 1개 추가 허용 |

### 6.4 적용하지 않는 곳(FR-AG3-2 · AC-AG4-3)

- 공개 대화 동기 경로의 엔진 출력(의도·FAQ·노드 답) · 레거시 API 값 치환(④.5) · 상담원 메시지(`handoff/**`) · 선제 말풍선(`proactive/**`) · 시뮬레이터 엔진 출력 · 관리자 화면 AI 제안(증강·묶음 이름). 출구 판정 호출 파일이 `rag-answer.service.ts`·`simulation.service.ts`뿐임을 GR-6이 단언한다.

---

## 7. RAG 답 개인정보 형식 가림 — `pii-mask` 출구 전용 선택 인자

> ⚠ **2026-10-01 갱신(ADR-0049 §4 · `pm-decisions-2026-10-01-설계.md` §5)**: PM 결정 L-5로 **저장·송신 경로(인자 없는 기본 호출)도 독립 날짜 `YYYY-MM-DD`를 계좌 후보에서 제외**한다. 이 절의 "기존 본문 한 글자도 바꾸지 않는다"(§7.2-1)·"저장 결과 바이트 불변"(§7.3)은 **날짜 구간을 제외하고** 유효하다 — 기본 경로 변경은 계좌 치환 콜백 1곳 + `preserveDates` 기본값 해석 1줄로 한정. `preserveDates` 생략 = **true**(구 동작은 `false`). 선택 경로 진입 조건은 `kinds` 유무만. 출구 동작(명시 boolean을 넘기는 `exit-pii.ts`)은 **생년월일 문맥 예외 외에는** 변화 0 — 계좌번호 켬 + 날짜 보호 켬 챗봇에서 같은 줄의 `생년`·`생일`·`출생`·`탄생일`·`birth`·`dob`·두 낱말 `birth date`(닫힌 목록)으로 시작하는 낱말 바로 뒤(구분 문자 6개 이하·`(양력)`류 주석 1개 허용 — 2차 확장) 날짜는 v1과 같이 `[계좌번호]`로 가린다(U-1 확정 · ADR-0049 §4 · `pm-decisions-2026-10-01-설계.md` §5.2-B·§5.4).

### 7.1 공개 서명(`packages/pii-mask/src/index.ts`)

```ts
/** [신규 No.36] `PiiMaskCounts`의 키 = 종류 이름. */
export type PiiKind = keyof PiiMaskCounts; // 'rrn' | 'card' | 'account' | 'phone' | 'email'

export interface PiiMaskOptions {
  mode?: PiiMaskMode;
  /** [신규 No.36 — 출구 전용] 주어지면 이 종류만 치환한다. 생략 = 5종 전부(기존 본문 그대로 실행 — 바이트 불변). */
  kinds?: readonly PiiKind[];
  /** [신규 No.36 — 출구 전용] true면 `YYYY-MM-DD` 날짜를 계좌번호 후보에서 제외한다. 생략/false = 기존. */
  preserveDates?: boolean;
}
export function maskPii(text: string, options?: PiiMaskOptions): PiiMaskResult;  // 서명 불변(선택 필드 추가만)
```

- shared-types의 `GuardrailPiiKind`(`RRN`·`CARD`·`ACCOUNT`·`PHONE`·`EMAIL`)와 `PiiKind`의 대응은 `exit-pii.ts` 안 상수 1곳이다.

### 7.2 구현 규칙(바이트 불변을 구조로 보장)

1. **함수 첫 줄의 분기**: `options?.kinds === undefined && !options?.preserveDates`이면 **기존 본문(현 94~122행)을 한 글자도 바꾸지 않고** 실행한다. 기존 본문을 새 함수로 옮기거나 리팩터링하지 않는다(code-reviewer 확인 항목 — diff에서 기존 5개 `replace` 문장·`mode` 계산·`counts` 초기화가 변경 0).
2. 그 외에는 내부 함수 `maskPiiSelective(text, mode, kinds, preserveDates)`:
   - 같은 순서 **주민번호 → 카드 → 전화 → 계좌 → 이메일**, 같은 정규식 상수, 같은 치환 모양(`mode` 반영 — FULL이면 전화·이메일 전량 토큰).
   - 선택되지 않은 종류의 일치 구간은 **자리표시**(사설 영역 문자 `U+E000` + 일련 문자(`U+E100`+i) + `U+E001` — 숫자·하이픈·`@`·영문 없음)로 바꿔 두어 뒤 단계 정규식이 가져가지 못하게 한다 → 기존 "앞 종류 우선" 분류가 선택과 무관하게 보존된다(예: 전화 끔 + 계좌 켬에서도 `010-1234-5678`은 계좌로 가려지지 않는다).
   - `preserveDates`면 계좌 단계 **직전**에 `(?<![\d-])(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?![\d-])` 구간을 자리표시로 보호한다(계좌 정규식만 날짜를 오인한다 — 주민번호·카드·전화 정규식은 `YYYY-MM-DD`와 겹치지 않음을 시험으로 고정).
   - 끝에서 자리표시를 원문으로 되돌린다. `counts`는 선택된 종류만 증가한다.
   - **입력에 `U+E000`~`U+E1FF` 문자가 이미 있으면** 자리표시 충돌을 피하려고 **기존 본문(5종 전부)**으로 처리한다(과탐 쪽 — fail-closed · K-11).
3. 동등성: `maskPii(s, { kinds: ['rrn','card','phone','account','email'] })` === `maskPii(s)`(같은 `mode`) — 선택 경로가 기존 경로와 같은 결과를 내는지 말뭉치로 증명한다.

### 7.3 바이트 불변 시험 방법(AC-AG1-6 · AG-7)

| # | 시험 | 방법 |
|---|---|---|
| 1 | **골든 선행 커밋** | 구현 커밋보다 **먼저** `packages/pii-mask/src/__golden__/storage-corpus.json`(합성 ≥200문장 — 5종 단독·혼합·날짜·버전 `1-2-3`·국제 전화·하이픈 없는 번호·연속 16자리·이메일 변형·빈 문자열·한글만)과 **현행 함수로 생성한 기대값**(PARTIAL·FULL 2벌)을 커밋한다. 이후 `index.golden.spec.ts`가 옵션 없는 호출을 골든과 비교한다 |
| 2 | 동등성 | 같은 말뭉치에서 `kinds=5종` 선택 경로 = 기존 경로(PARTIAL·FULL) |
| 3 | 기존 시험 무수정 | `packages/pii-mask`의 기존 spec 파일 diff 0 |
| 4 | 저장 경로 통합 | `ConversationLog` 적재 시험(기존 — PII 입력 턴)이 무수정 통과 · 가드레일 켜짐/꺼짐에서 **같은 입력의 `userMessage` 저장 바이트가 같다**(신규 통합 시험 1건) |
| 5 | 호출 파일 봉인 | `kinds:`·`preserveDates:` 속성을 가진 `maskPii(` 호출 파일 = `guardrails/lib/exit-pii.ts` 1개(GR-5) |

### 7.4 챗봇별 설정 · 기본값 · 거버넌스

| 항목 | 값 |
|---|---|
| 저장 | `ChatbotGuardrailSetting`(1:1 · 행 없음 = 기본값) — `piiExitKinds`(JSON · `GuardrailPiiKind[]`) · `piiPreserveDates` |
| 기본값 | 종류 **`['RRN','CARD']`** · 날짜 보호 **켬**(계좌를 켰을 때만 의미 — FR-AG3-5 권고 채택) |
| 끄기 | 종류를 빈 배열로 저장 = 출구 가림 꺼짐(`AC-AG4-6` — 현행과 동일) |
| 계좌 선택 시 경고 | 화면: "날짜(예: 2026-09-30)·일부 번호가 계좌번호로 오인되어 가려질 수 있습니다" + 날짜 보호 체크박스(켬이면 "연-월-일 형식 날짜는 가리지 않습니다" — 2026-10-01: 켬이어도 생년월일·생일 등 바로 뒤 날짜는 가린다 · 레이블 문자열은 불변(ADR-0049 §4)) |
| 비정형 한계 | 화면 상시 안내: "형식이 정해진 번호만 가립니다. 이름·주소 등은 가리지 못합니다(적재 문서 정리를 대신하지 않습니다)" — NFR-AGS6 |
| 강도 | `PII_MASK_MODE`를 따른다(FULL 서버 = 전화·이메일도 전량 토큰) — 종류는 챗봇별, 강도는 서버별(EX-AG-20 해석 · R-11) |
| 거버넌스 하한 | 거버넌스 모드 ON이면 `RRN`·`CARD`를 끌 수 없다(저장 `400 VALIDATION_FAILED` 코드 `GOVERNANCE_FLOOR` · 런타임도 합집합으로 강제 — 모드를 나중에 켠 챗봇 방어) — No.45 "마스킹 약화는 환경변수만"(R-10) |
| 감사 | `UPDATE Chatbot` · `AUDIT_FIELDS.Chatbot`에 `guardrailPiiExit`(종류·날짜 보호 — 문장 0) |
| 적용 대상 | 외부 RAG 답 출구 1곳 + 시험하기·시뮬레이터 표시. **저장 마스킹(`record()`)·송신 마스킹(RAG 질의·증강·레거시·웹훅·인박스·KB 적재)은 무관**(인자 없는 기존 호출 그대로 — ⚠ 2026-10-01부터 기본 호출도 독립 날짜 제외(생년월일 문맥 예외) · ADR-0049 §4) |

---

## 8. 기록 · 현황

### 8.1 `GuardrailEvent`(문장 0 · FK 0)

| 컬럼 | 내용 |
|---|---|
| `chatbotId` | 챗봇(FK 없음 — 로그 규약 · `RagCallLog` 선례 · 영구삭제 동반 삭제) |
| `messageId` | 대화 기록 id(= 공개 `messageId`) — FK 없음. 대화 기록이 보존기간 파기로 텍스트 소거되거나 없어도 이벤트는 수치로 남는다(FR-AG4-3 권고 채택) |
| `stage` | `INBOUND`｜`OUTBOUND` |
| `kind` | `RULE`｜`PII`｜`ERROR` |
| `ruleId`·`ruleName`·`category`·`ruleAction` | 규칙 적중일 때(규칙 삭제 후에도 이름 스냅샷으로 표시) |
| `appliedAction` | 그 턴에 적용된 최종 동작 `MONITOR`｜`REPLACE`｜`NO_RAG`｜`MASK`｜`FALLBACK` |
| `decisive` | 이 규칙이 최종 동작을 정했는가(적중 규칙 중 1개만 true) |
| `effect` | `CHANGED`｜`NONE`(기록만·RAG를 어차피 안 탔을 NO_RAG) |
| `piiKind`·`piiCount` | 개인정보 이벤트일 때(종류별 1행) |
| `errorCode` | 오류 이벤트일 때(예외 이름 수준) |
| `dayBucket`·`createdAt` | KST 일 버킷(적재 시점 확정 — ADR-0017) |

- 쓰기: `runtime/guardrail-event.writer.ts` 1파일 · 턴당 `createMany` 1회 · `void`(응답 대기 0) · 실패는 경고 로그(챗봇 id·오류 이름)만.
- 보존: 문장이 없으므로 No.45 보존 종류가 아니다 · 자동 삭제 없음(K-10) · 영구삭제 동반 삭제.

### 8.2 대화 기록 표식 `ConversationLog.guardrailStage`

- nullable `INBOUND｜OUTBOUND` — 가드레일이 **그 턴의 답을 막은** 경우(입구 대체 · 출구 대체 · 출구 폴백)만 값. 기록만·AI로 안 보냄·가림(`MASKED`)은 null(답을 막지 않았다 — 이벤트로 추적).
- 쓰기 주체 `ConversationLogService.record()` 1곳(`params.guardrailStage ?? null`) · 적재 후 불변 · 인덱스 없음 · 백필 없음(기존 행 = null이 사실). 금지어 `blockedByFilter`와 별개(R-19).

### 8.3 통계 분류 규약(FR-AG4-4 · AC-AG5-3)

| 턴 | `isAnswered` | `answeredByRag` | 응답출처(`classifyResponseSource`) | 미응답 큐 | 비고 |
|---|---|---|---|---|---|
| 입구 대체 | false | false | `FALLBACK` | 수집됨(C-14) | 불변식 `bySource.FALLBACK === unansweredCount` 유지 |
| 출구 대체·폴백 | false | false | `FALLBACK` | 수집됨 | 기존 RAG 실패 턴과 같다 |
| 출구 가림(`MASKED`) | true | true | `RAG` | — | RAG 성공 |
| AI로 안 보냄 | 엔진 판정 | false | 엔진 판정 | 엔진 판정 | 기존 폴백 턴과 같다 |

→ No.14·29 통계 코드·쿼리·응답 정의 변경 0. 가드레일 수치는 **가드레일 현황에서만** 본다.

### 8.4 현황 집계(`GET …/guardrails/overview?from=&to=`)

- 기간: `dayBucket` 범위 · 최대 90일(`GUARDRAIL_LIMITS.overviewMaxRangeDays` — shared-types) · 초과 `400 STATS_RANGE_TOO_WIDE`(기존 코드 재사용).
- 쿼리(고정 ≤6): ① 이벤트 `groupBy(['stage','kind','appliedAction','effect'])` ② 이벤트 규칙별 `groupBy(['ruleId','ruleName','category','stage','appliedAction'])` ③ 개인정보 종류별 합(`groupBy(['piiKind'])` sum `piiCount`) ④ 대화 기록 `answeredByRag=true` 수 ⑤ 대화 기록 `guardrailStage='OUTBOUND'` 수 ⑥ 알림 — `EnvironmentSwitchLog` `approvalMode='SOLO_ROLLBACK'`(기간 UTC 경계).
- 응답: 합계(입구·출구 적중 · 대체·AI로 안 보냄·기록만 · 가림 답 수 · 오류 폴백 수) · 규칙별 행(규칙 현재 동작 + 기간 적중·효과) · 개인정보 종류별 · RAG 답 `{ delivered, replaced, masked, fallbackOnError, replacedRatio }`(분모 = delivered + replaced + fallbackOnError, 0이면 null) · 알림 목록(단독 롤백) · `hitl: { envModeOn, approvalRequired }`.
- 합계 = 이벤트 합(AC-AG5-2 — 같은 쿼리 결과에서 파생).

### 8.5 이벤트 목록(`GET …/guardrails/events`) — "적중 행 → 대화 보기"(C-13 · R-13)

- 필터: 기간(필수) · `ruleId?` · `stage?` · `appliedAction?` · 페이지(기본 50 · 최대 100) · `createdAt desc`.
- 각 행에 대화 기록 **마스킹본**(`userMessage`·`botResponse` — 저장값 그대로 · `textPurgedAt`이면 `textPurged: true`·본문 빈 값 · 행 없으면 `conversation: null`)을 싣는다 — 쿼리 2개(이벤트 1 + `conversationLog.findMany({ where: { id: { in } } })` 1).
- 권한 `security:read` · **거버넌스 모드에서 `VIEW` 감사**(`@AuditView('ConversationLog')` — 열람 감사 닫힌 목록 12 → 13 · X-2). 모드 OFF는 기존 규약대로 감사 없음.
- 원문 경로 0(ADR-0013 — 상담 원문 `rawText` 미조회).

### 8.6 데이터 지도(FR-AG4-5)

`GovernanceMapResponseSchema` 선택 키 `guardrails?` — 규칙 ≥1 ∨ 이벤트 ≥1 ∨ 가림 설정 행 ≥1 ∨ 승인 정책 켜진 챗봇 ≥1일 때만(0이면 키 생략 = 바이트 동일 · No.21·35 선례):

```ts
guardrails?: {
  chatbotsWithRules: number; rules: number; enabledRules: number;
  events: number; eventsStoreText: false;          // 리터럴 — 문장 0
  exits: [];                                       // 리터럴 빈 배열 — 새 출구 0
  piiExitDefaultKinds: ['RRN', 'CARD'];            // 기본값 표기
  piiExitCustomizedChatbots: number;
  approvalPolicyChatbots: number;                  // 2인 승인 켜진 챗봇 수
  serverEnabled: boolean;                          // GUARDRAILS_ENABLED
}
```

---

## 9. 시뮬레이터 표시 (FR-AG3-7 · AC-AG4-8) — TC 실행은 이월

- `SimulationService`에 선택 생성자 인자 `guardrails?: GuardrailRuntimeService`(14번째 — 기존 호출 무수정).
- **입구**: 텍스트 턴이고 설문이 소비하지 않을 턴이면 `evaluateInbound()` → 결과가 `PASS`가 아니면 응답 최상위에 `guardrailInbound?: { action, ruleNames[], replacementText? }`(없으면 키 생략). 시뮬레이터는 **엔진 결과를 그대로 보여 준다**(무엇에 매칭됐는지 관리자가 알아야 한다) — 대신 "운영이면 이 질문에 대체 문구가 나갑니다" 배너. `REPLACE`·`NO_RAG`면 `useRag`여도 RAG를 부르지 않는다(운영과 같은 흐름 — `canTryRag` 조건에 결합).
- **출구**: `buildMatchTrace()`에서 `judgement.ok`면 같은 절단(2,000자) 후 `evaluateOutbound()` → `matchTrace.ragPreview?`:

```ts
ragPreview?: {
  outcome: 'PASS' | 'MONITOR' | 'MASKED' | 'REPLACED' | 'FALLBACK';
  finalText: string;              // 운영이면 사용자에게 나갈 텍스트(대체 문구·폴백 문구·가린 답 — 출구 금지어 적용 후)
  originalMasked?: string;        // REPLACED·FALLBACK일 때 원답을 "저장 마스킹"(금지어 → maskPii 기본)한 본 — 원문 개인정보 비노출(R-4)
  ruleNames: string[];
  piiCounts: Partial<Record<GuardrailPiiKind, number>>;
}
```
- 가드레일이 주입되지 않은 기존 단위 시험에서는 두 키가 생기지 않는다(조건부 전개 — `simulation.service.spec.ts` 무수정).
- **이벤트 기록 0**(`recordEvents(` 호출 0 — GR-6) · `RagCallLog`·`ConversationLog` 0(기존 규약).
- 이로써 ADR-0022 "실제 답변 품질은 시뮬레이터에서 수동 확인" 전제가 처음으로 성립한다(D-2).
- **TC 실행 표시는 하지 않는다**(R-1): `TestRunResult`에 컬럼·실행기 분기·봉인 변경이 필요하고, 의미상 규모 B "안전 점검 세트"(기대 결과: 대체됨/AI로 안 보냄/통과)와 함께 설계해야 한다.

---

## 10. 운영 전환 2인 승인

### 10.1 대상 · 비대상 · 옆문 차단

| 동작 | 정책 켜짐일 때 | 근거 |
|---|---|---|
| 즉시 운영 전환 `POST …/environment/prod/switch` | **`409 ENV_APPROVAL_REQUIRED`** — 승인 요청 경로 사용 | FR-AG5-2 |
| 예약 운영 전환(`SWITCH_PROD_VERSION`) 실행 | 승인된 요청이 묶여 있어야 실행 · 없으면 영구 실패 `APPROVAL_MISSING` | FR-AG5-5 |
| 운영 롤백 — **직전 운영 버전**(`pickRollbackTarget()` 결과 = 대상 생략 시의 기본 대상) | **즉시 실행**(예외) · 이력 `approvalMode='SOLO_ROLLBACK'` · 감사 접두 · 현황 알림 | FR-AG5-6 |
| 운영 롤백 — 그 밖의 운영 이력 버전 | `409 ENV_APPROVAL_REQUIRED` — 요청(`PROD_ROLLBACK`) 필요 | R-8 · C-9 |
| 환경 모드 끄기(`KEEP_PROD`·`PROMOTE_DRAFT`) | **`409 ENV_APPROVAL_REQUIRED`**(`details.reason='POLICY_ACTIVE'`) — 정책을 먼저 끈다 | R-7 · C-10 |
| 환경 모드 켜기 | 해당 없음(정책은 모드가 켜진 챗봇에만 존재) | — |
| 스테이징 승격 · 초안 편집 · 버전 복원(모드 켜짐 = 초안만) · 게이트 설정 · 챗봇 켜기/끄기 · 거버넌스 설정 · 예약 PUBLISH·SET_WEB_CHANNEL | 대상 아님 | FR-AG5-7 · J-6 |

### 10.2 정책 저장(`ChatbotEnvironment` + 2컬럼)

- `approvalRequired Boolean @default(false)` · `approvalTtlHours Int @default(24)`(1~168). 운영 전환 게이트와 같은 "운영 전환의 조건"이라 같은 행에 둔다(ADR-0048 §5). 쓰기 = `EnvironmentPointerWriter.updateApprovalPolicy(db, chatbotId, { required, ttlHours })`(E-1 봉인 유지 · `upsert` — 게이트 선례).
- 읽기 = `EnvironmentReadService.getPointerStatus()`의 `approval: { required, ttlHours }`(같은 `findUnique` — 쿼리 추가 0).
- **켜기**(`PUT …/environment/approval` `{ required: true, ttlHours }`, `chatbot:deploy`): 모드 켜짐(`prodVersionId` 있음) ∧ 활성 `chatbot:deploy` 보유자 ≥ 2(`user.count({ status: 'ACTIVE', role: { in: ROLE_PERMISSIONS에서 chatbot:deploy를 가진 역할 } })`) — 아니면 `409 APPROVAL_POLICY_UNAVAILABLE`(`details.reason = ENV_MODE_DISABLED｜NOT_ENOUGH_APPROVERS`) · AC-AG6-1·10.
- **끄기**: `ENV_APPROVAL_OFF_LOCKED=true`면 `409 APPROVAL_POLICY_UNAVAILABLE`(`OFF_LOCKED`). 아니면 한 트랜잭션에서 ① 정책 끔 ② 대기 요청 CAS → `CANCELLED(POLICY_OFF)`(자동 실행 0 — FR-AG5-8 · AC-AG6-9). 감사: 정책 `UPDATE ChatbotEnvironment` 1 + 취소된 요청마다 `STATUS_CHANGE` 1.
- **TTL 변경**은 새 요청부터 적용(기존 요청의 만료 시각 고정).
- **승인 가능자가 1명으로 줄어도 자동으로 끄지 않는다**(FR-AG5-8) — 조회 응답의 `otherApproverCount`(나 제외)가 0이면 화면이 "승인할 수 있는 다른 관리자가 없습니다 — 정책 끄기를 검토하세요"를 표시한다(EX-AG-12).

### 10.3 상태 기계(`ProdSwitchApprovalRequest`)

```
             요청 생성(chatbot:deploy · 정책 켜짐 · 대기 0)
                          │
                          ▼
                     ┌─────────┐  요청자 취소 ───────────────▶ CANCELLED(REQUESTER)
                     │ PENDING │  정책 끔 ───────────────────▶ CANCELLED(POLICY_OFF)
                     └─────────┘  기준(운영 포인터) 변경 감지 ─▶ CANCELLED(BASE_CHANGED)      ← 지연 판정
                      │   │   │   예약 취소·실행·시각 경과 ─▶ CANCELLED(SCHEDULE_INACTIVE)  ← 지연 판정
                      │   │   └── now ≥ expiresAt ────────▶ EXPIRED                        ← 지연 판정
                      │   └────── 다른 관리자 반려 ────────▶ REJECTED(decisionNote)
                      └────────── 다른 관리자 승인
                                   ├ 즉시(PROD_SWITCH·PROD_ROLLBACK): 전환과 같은 트랜잭션 ▶ APPROVED/APPLIED
                                   │                        확정 실패(게이트·대상·보관·모드) ▶ APPROVED/FAILED(code)
                                   └ 예약(SCHEDULED_PROD_SWITCH): 선점만 ▶ APPROVED/SCHEDULED → 실행은 예약 시각
```

- 모든 전이 = `updateMany({ where: { id, status: 'PENDING' }, data: { status, …, pendingLock: null } })` — 0행이면 "이미 처리됨"(`409 APPROVAL_NOT_PENDING`, `details.status` = 현재 상태). 저장소 1파일(GR-10).
- **챗봇당 대기 1건** = `pendingLock String? @unique`(대기일 때 `chatbotId` · 종결 시 null) — 동시 요청 두 번째는 `P2002` → `409 APPROVAL_PENDING_EXISTS`(`details.requestId`). 원시 부분 인덱스 0(§12.2).
- **지연 판정(루프 없음 — NFR-AGR3)**: `lib/approval-state.ts`가 `effectiveStatus(row, now, pointer, schedule)`를 계산한다 — 유효 상태가 종결이면 **그 조회·변경 요청 안에서** CAS로 종결하고 감사 1건(주체 system)을 남긴다. 호출 지점 = 챗봇 승인 현황 조회 · 요청 상세 · 전역 대기 목록 · 요청 생성 · 승인 · 반려 · 취소. 서버 재시작과 무관하다(DB 상태).
- 요청자 계정이 비활성화돼도 요청은 유지되고 승인 가능하다(EX-AG-11 · 화면에 "요청자 비활성" 표시).

### 10.4 요청 생성(`POST …/environment/approval/requests`)

| 동작(`action`) | 입력 | 검사 | 저장 |
|---|---|---|---|
| `PROD_SWITCH` | `targetVersionId` · `expectedProdVersionId` · `acknowledgeWarnings?` · `reason?`(≤200) | 챗봇 존재·비보관 · 정책 켜짐(아니면 `409 APPROVAL_POLICY_UNAVAILABLE` `NOT_REQUIRED`) · 대기 지연 종결 후 대기 0 · `ProdSwitchService.preview({ kind:'SWITCH', target })`의 `blockers` 없음(있으면 해당 409 — `TARGET_NOT_ALLOWED`→`ENV_TARGET_NOT_STAGING` · `GATE_BLOCKED`→`ENV_GATE_NOT_PASSED` · `CHATBOT_ARCHIVED` · `ENV_MODE_DISABLED` · 그 외 → `404 NOT_FOUND`) · `expectedProdVersionId` = 미리보기 기준(아니면 `409 ENV_POINTER_STALE`) · 경고 있으면 `acknowledgeWarnings=true` 필수(`400`) | 대상·기준 버전 id·번호 · 게이트 결과 스냅샷(JSON) · 경고 코드 목록 · 차이 수 · 사유(금지어 → PII 마스킹) · `expiresAt = now + TTL` |
| `PROD_ROLLBACK` | `targetVersionId?`(생략 = 직전) · 나머지 같음 | 위와 같되 `kind:'ROLLBACK'` 미리보기 · 직전 롤백이어도 요청 가능(승인 없이 할 수 있음을 화면이 안내) | 같음 |
| `SCHEDULED_PROD_SWITCH` | `deployScheduleId` · `reason?` | 예약이 같은 챗봇 · 동작 `SWITCH_PROD_VERSION` · 상태 `PENDING｜HELD` · `scheduledAt > now` · **요청자 = 예약 작성자(`createdById`)**(아니면 `403 FORBIDDEN`) — 승인자가 예약 작성자가 되는 우회 차단 | 대상 = 예약 대상 · 기준 = 예약의 기준(`expectedContentHash` 재사용 컬럼 — 운영 버전 id) · `expiresAt = min(now + TTL, scheduledAt)` |

- 감사 `CREATE ProdSwitchApprovalRequest`(대상 이름 "운영 전환 요청 v12 → v13" · after = 동작·대상·기준 번호·만료·게이트 판정 — 사유 본문 0).

### 10.5 승인 실행(`POST …/requests/:id/approve` `{ acknowledgeWarnings? }`)

**공통 선검사**(순서 고정): 요청 조회(챗봇 스코프 · 교차 404) → 지연 종결(만료·정책 끔·기준 변경·예약 비활성이면 종결 후 `409 APPROVAL_NOT_PENDING`/`APPROVAL_BASE_CHANGED`) → **승인자 = 요청자면 `403 APPROVAL_SELF_FORBIDDEN`** + 감사 `PERMISSION_DENIED`(AC-AG6-3 · 서버 강제 — NFR-AGS3).

**즉시(`PROD_SWITCH`·`PROD_ROLLBACK`)**:
1. `ProdSwitchService.switch(chatbotId, { targetVersionId, expectedProdVersionId: base, acknowledgeWarnings, reason: 요청 사유 }, kind, { actor: 승인자, auditSummaryPrefix: '[2인 승인 · 요청 <요청자 이메일>]', approval: { requestId, approverId, claim: (tx) => store.claimApplied(tx, requestId, approver, now) } })`.
2. `switch()` 안(§10.8의 강제 로직): NOOP(대상 = 현재 운영)이면 승인 호출에서는 `ENV_POINTER_STALE`로 취급 → 대상 허용 → **게이트 재평가**(차단 → `ENV_GATE_NOT_PASSED`) → 경고 재계산(`acknowledgeWarnings` 필요 시 `400`) → `approval` 검증(요청 행 `PENDING` · 같은 챗봇·대상·기준 · `requestedById ≠ approverId` · 미만료) → **`$transaction`: ① `writer.switchProd`(CAS · 이력 `approvalRequestId`·`approvalMode='APPROVED'`) → 0행이면 `ENV_POINTER_STALE` ② `claim(tx)` → 0행이면 `409 APPROVAL_NOT_PENDING` throw(①까지 롤백)**.
3. 성공: 커밋 후 기존 절차(캐시 이벤트 · 벡터 보존 · 전환 감사 — 요약에 접두) + 요청 감사 `STATUS_CHANGE`(PENDING → APPROVED · APPLIED) · 컨트롤러가 `versionBundles.warm()`(기존 `prodSwitchConfirm` 선례). 응답 `{ request, switch: ProdSwitchResponse }` · AC-AG6-4.
4. 실패 분류(승인 서비스):

| `switch()` 결과 | 요청 처리 | 응답 |
|---|---|---|
| `400 VALIDATION_FAILED`(경고 미확인) | 대기 유지 | 400 — 승인자가 확인 후 재시도 |
| `409 ENV_SWITCH_BUSY` | 대기 유지 | 409 — 재시도(자동 재시도 0) |
| `409 APPROVAL_NOT_PENDING`(선점 경합 — 다른 승인·취소가 먼저) | 변경 없음(이미 종결) | 409 |
| `409 ENV_POINTER_STALE`(기준 변경) | CAS → `CANCELLED(BASE_CHANGED)` + 감사 | `409 APPROVAL_BASE_CHANGED` "대상이 바뀌었습니다"(AC-AG6-5) |
| `409 ENV_GATE_NOT_PASSED`·`ENV_TARGET_NOT_STAGING`·`404 NOT_FOUND`·`409 CHATBOT_ARCHIVED`·`409 ENV_MODE_DISABLED` | CAS → `APPROVED` · `outcome=FAILED` · `failureCode` + 감사 | 원래 오류(`details.requestStatus='APPROVED'`·`outcome='FAILED'`) — EX-AG-14 · NFR-AGR2(포인터 불변) |

**예약(`SCHEDULED_PROD_SWITCH`)**: 예약 재검사(같은 챗봇·`SWITCH_PROD_VERSION`·`PENDING｜HELD`·`scheduledAt > now`·대상 같음·예약 기준 = 요청 기준 — 아니면 `CANCELLED(SCHEDULE_INACTIVE｜BASE_CHANGED)` + 409) → CAS `PENDING → APPROVED`·`outcome=SCHEDULED` + 감사. 전환은 하지 않는다.

### 10.6 반려 · 취소 · 만료

- **반려** `POST …/requests/:id/reject { note? }`: 승인자 ≠ 요청자(요청자는 취소만 — `403 APPROVAL_SELF_FORBIDDEN`) · CAS → `REJECTED` · 메모(≤200 · 금지어 → PII 마스킹) · 감사(메모 본문 0).
- **취소** `POST …/requests/:id/cancel`: 요청자만(다른 관리자 `403 FORBIDDEN`) · CAS → `CANCELLED(REQUESTER)` · 감사.
- **만료**: §10.3 지연 판정 · 승인 시도 시 `409 APPROVAL_NOT_PENDING`(`details.status='EXPIRED'`) · AC-AG6-6.
- 승인과 취소가 동시에 오면 먼저 커밋된 CAS 하나만 유효하다(EX-AG-13) — 즉시 승인의 선점은 전환 트랜잭션 안이라 취소가 먼저면 전환도 롤백된다.

### 10.7 예약 전환 결합(No.28 · C-11 · R-6)

- **예약 생성 경로는 바꾸지 않는다**(`deploy-schedules` 쓰기 봉인 D-1 · 순환 회피). 정책이 켜진 챗봇에서 콘솔은 `SWITCH_PROD_VERSION` 예약 생성 성공 직후 **같은 화면 흐름에서** `SCHEDULED_PROD_SWITCH` 승인 요청을 보낸다(예약 작성자 = 요청자). 두 번째 호출이 실패하면 예약 행에 "승인 요청 필요 — 요청하기" 버튼을 보인다(예약 목록이 승인 현황 조회로 상태를 합성).
- **실행 시 강제**: 예약 실행기(`SwitchProdVersionExecutor.execute`) → `ProdSwitchService.switch(…, { deployScheduleId })` → 정책 켜짐이면 `prodSwitchApprovalRequest.findFirst({ where: { chatbotId, deployScheduleId, status: 'APPROVED', outcome: 'SCHEDULED', targetVersionId, baseProdVersionId: expectedProdVersionId } })` + 그 요청 id로 이미 쓰인 전환 이력이 없음(1회용) → 없으면 `409 ENV_APPROVAL_REQUIRED`.
- `deploy-schedules/lib/outcome-classifier.ts`에 1분기: `ENV_APPROVAL_REQUIRED` → `{ kind: 'PERMANENT', reason: 'APPROVAL_MISSING' }` · `DeployScheduleFailureReason` +1(`APPROVAL_MISSING` — 13 → 14종). 예약은 `FAILED`("확인 필요" 배지 — 기존)로 끝나고 실행 0 — "승인 없음 종결"(AC-AG6-7). 실행 성공 시 전환 이력에 `approvalRequestId`·`approvalMode='APPROVED'`가 남는다(요청 행은 추가 쓰기 0 — 표시가 이력 조인으로 "실행됨"을 판정).
- 체인 예약(앞 예약이 `APPROVAL_MISSING`으로 실패하면 뒤 예약은 기존 규칙대로 `HELD(PREDECESSOR_FAILED)`) · 재개(`resume`)로 기준이 바뀌면 기존 승인은 기준 불일치로 무효 → 새 요청(K-9).

### 10.8 강제 지점 — `ProdSwitchService.switch()` 변경 명세

`SwitchInvocation`에 선택 필드 `approval?: { requestId: string; approverId: string; claim: (tx: Prisma.TransactionClient) => Promise<number> }`.

기존 흐름(313~347행) 중 **`isSwitchTargetAllowed` 통과 직후(339행 뒤) · `evaluateGate` 전(341행 앞)**에 `await this.assertApprovalSatisfied(chatbotId, dto, kind, invocation, pointer, historyDesc)`:

```
policy = pointer.approval                      // getPointerStatus가 이미 읽음(추가 쿼리 0)
if (!policy.required) → 통과(현행과 동일 — 정책 꺼짐 챗봇 동작 불변)
isDirect = kind === 'ROLLBACK' && pickRollbackTarget(historyDesc, prod, 존재 버전 id 집합) === dto.targetVersionId   // 버전 id 조회 1쿼리(정책 켜짐 ∧ ROLLBACK일 때만)
need = requiresApproval(policy, kind, isDirect)   // lib/approval-policy.ts 순수 함수
if (!need) → 통과 · 표식 approvalMode='SOLO_ROLLBACK'(이 호출에 한함)
if (invocation?.approval) → 요청 행 검증(읽기) — 실패는 409 APPROVAL_NOT_PENDING / 403 APPROVAL_SELF_FORBIDDEN
else if (invocation?.deployScheduleId) → §10.7 승인 확인(읽기) — 없으면 409 ENV_APPROVAL_REQUIRED
else → 409 ENV_APPROVAL_REQUIRED
```

- NOOP 조기 반환(321~329행)은 현행대로 두되, `invocation.approval`이 있으면 NOOP 대신 `409 ENV_POINTER_STALE`을 던진다(요청 시점에 대상 ≠ 기준이었으므로 NOOP는 기준이 바뀌었다는 뜻).
- 트랜잭션(364~377행)에 `approval`이 있으면 `writer.switchProd` 뒤 `const claimed = await invocation.approval.claim(tx); if (claimed === 0) throw new ApiException('APPROVAL_NOT_PENDING', 409, …)`(GR-9 · E-16 "tx 안 `Promise.all` 0" 준수).
- `writer.switchProd` 입력에 `approvalRequestId`·`approvalMode`(`APPROVED`｜`SOLO_ROLLBACK`｜생략) — 정책 꺼짐이면 둘 다 null(현행 이력과 같은 값).
- 감사 요약: 단독 롤백이면 접두 `[2인 승인 예외 — 직전 버전 단독 롤백]`.
- **`preview()`**: 정책 켜짐이면 응답에 `approval: { required: true, soloRollbackAllowed?: boolean }`(ROLLBACK 미리보기에서 대상이 직전이면 true) — 정책 꺼짐이면 키 생략(바이트 동일). 콘솔이 버튼 문구("운영 전환" ↔ "승인 요청")를 이 값으로 고른다.

### 10.9 환경 모드 끄기 차단(R-7)

- `EnvironmentModeService.disable()` 진입부(모드 켜짐 확인 직후): `pointer.approval.required`면 `409 ENV_APPROVAL_REQUIRED`(`details.reason='POLICY_ACTIVE'`, 메시지 "운영 전환 2인 승인이 켜져 있어 환경 분리를 끌 수 없습니다. 먼저 2인 승인을 꺼 주세요.").
- `disablePreview()` 응답에 `approvalPolicyActive?: true`(켜짐일 때만 — 바이트 동일).

### 10.10 동시성 표

| 경합 | 결과 | 장치 |
|---|---|---|
| 같은 챗봇 요청 2건 동시 | 1건만 생성 · 두 번째 `409 APPROVAL_PENDING_EXISTS` | `pendingLock` 유일 |
| 승인 A·승인 B 동시 | 먼저 커밋된 쪽만 전환 · 뒤쪽은 ① 포인터 CAS 0행(`ENV_POINTER_STALE`)이거나 ② 선점 0행 → 요청 이미 `APPROVED`라 종결 CAS 0행(무해) · `409` | 포인터 CAS + 요청 CAS(같은 tx) |
| 승인 vs 요청자 취소 | 먼저 커밋된 쪽만 · 취소가 먼저면 승인 tx 롤백(포인터 불변) | 같은 tx 선점 |
| 승인 vs 정책 끄기 | 끄기가 먼저면 요청 `CANCELLED(POLICY_OFF)` → 승인 선점 0행 → 롤백 | 같음 |
| 승인 vs 단독 롤백·다른 전환 | 포인터 CAS 0행 → `BASE_CHANGED` 종결 | 포인터 CAS |
| 예약 실행 vs 승인 | 승인 전 도래 = `APPROVAL_MISSING`(실행 0) · 승인 후 도래 = 정상 | 실행 시 확인 |
| 서버 재시작 | 대기·만료는 DB 상태 · 즉시 승인은 tx 원자 — "승인됐는데 미실행" 상태가 존재하지 않음 | 설계 |

### 10.11 권한 판단 — 신규 권한 불필요

| 동작 | 권한 | 근거 |
|---|---|---|
| 챗봇 승인 현황 조회 `GET …/environment/approval` · 요청 상세 | `chatbot:read` + `dialogue:read` | 환경 현황(`GET …/environment`)과 같은 등급 |
| 정책 변경 · 요청 · 승인 · 반려 · 취소 | `chatbot:deploy` | 운영 전환 권한(ADR-0039) — 2인 승인의 "두 사람"은 이 권한 보유자 두 명 |
| 전역 대기 목록 · 요약 | `chatbot:deploy` | 승인할 수 있는 사람만 본다 |

- ADMIN만 `chatbot:deploy`를 가지므로 **활성 ADMIN 2명 이상**이 전제다(R-4 통제). `Permission` 18 불변(AG-2). `E-14` 봉인 갱신(X-1).

### 10.12 감사(FR-AG9-1)

| 사건 | 액션 · 대상 | 주체 |
|---|---|---|
| 정책 켜기/끄기·TTL 변경 | `UPDATE ChatbotEnvironment`(after `approvalRequired`·`approvalTtlHours`) | 요청자 |
| 요청 생성 | `CREATE ProdSwitchApprovalRequest` | 요청자 |
| 승인(성공·실패)·반려·취소 | `STATUS_CHANGE ProdSwitchApprovalRequest`(before/after 상태·결과·실패 코드) | 승인자/요청자 |
| 만료·기준 변경·예약 비활성·정책 끔 종결 | `STATUS_CHANGE ProdSwitchApprovalRequest` | system(`actorOverride` — 파기 잡 선례) |
| 자기 승인 시도 | `PERMISSION_DENIED`(targetType `Session` — 예약 선례) | 시도자 |
| 전환 실행 | 기존 `UPDATE ChatbotEnvironment`(요약 접두 `[2인 승인 · 요청 …]`) | 승인자 |
| 단독 롤백 | 기존 `UPDATE ChatbotEnvironment`(요약 접두 `[2인 승인 예외 — 직전 버전 단독 롤백]`) | 실행자 |
| 끄기 차단·전환 차단(409) | 감사 없음(상태 변화 0 — 기존 409 규약) | — |

---

## 11. 기존 사람 승인(HITL) 절차 현황표 (FR 문서 기준 · FR-AG4-6)

> 이 표가 가드레일 현황 화면 안내(§17.2)의 원천이다. "✅"는 코드로 확인한 현행이다(2026-09-30).

| # | 절차 | 사람이 확인하는 것 | 누가(권한) | 근거 문서 · ADR | 자동 반영 0 보증 | 2인 승인 |
|---|---|---|---|---|---|---|
| H-1 | AI 예문 후보 → 의도 예문(No.16/23) | 생성 후보를 관리자가 골라 승인(≤50 · 부분 성공) | `dialogue:write` | `requirements/learning-augmentation.md` · ADR-0025 · `learning-augmentation-설계.md` | 승격 경로 1곳 봉인(`asset-write-sealing` S-2) ✅ | 없음(대상 아님) |
| H-2 | 묶음 발화 → 의도 예문(No.21) | 고른 발화만 확인 화면 후 반영(≤50) | `dialogue:write` | `requirements/deep-clustering.md` · ADR-0047 §6 | 반영 1파일(DC-4) ✅ | 없음 |
| H-3 | 미응답·👎(RAG 답 포함) → 검토 큐(No.15/44) | 관리자가 예문 반영·"직접 수정 완료"·무시 | `dialogue:write` | `requirements/stats-learning.md` · `requirements/feedback-loop.md` · ADR-0019·0038 | 큐 → 자산은 관리자 동작만 ✅ | 없음 |
| H-4 | 초안 → 운영 전환(No.40) | 차이·경고·TC 게이트(경고/차단) 확인 후 확정 | `chatbot:deploy` | `requirements/environment-separation.md` · ADR-0039 | 포인터 쓰기 1파일 ✅ | **이번 추가 — 챗봇별 선택(§10)** |
| H-5 | 예약 운영 전환(No.28·40) | 미리보기·경고 확인 후 예약 · 실행 시 게이트 재평가 | `chatbot:deploy` | `requirements/scheduled-deploy.md` · ADR-0032·0039 | 예약 모듈 쓰기 봉인(D-1) ✅ | **이번 추가 — 승인된 예약만 실행** |
| H-6 | 버전 복원(No.25) | 복원 미리보기(차이·백업) 확인 후 확정 · 모드 켜짐이면 초안만 | `dialogue:write`+`chatbot:write` | `requirements/version-history.md` · ADR-0031 | 복원 호출 2곳(E-3) ✅ | 대상 아님(운영에 닿지 않음 — J-6) |
| H-7 | 실시간 대화 사람 개입(No.24) | 연속 미응답 경고 → 상담원 개입 · RAG 실패·가드레일 대체 턴 → 관찰 창(상담 연결) | `cs:read`/`cs:write` | `requirements/hybrid-cs.md` · ADR-0036 | 상담 중 봇 자동 응답 0 ✅ | 해당 없음 |
| H-8 | 업무 자동화 발송(No.41) | 발송 대상 등록·원문 허용은 ADMIN · 실패 재발송은 관리자 | `security:write`·`chatbot:write` | `requirements/workflow-automation.md` · ADR-0041 | 고객 업무 결재는 외부 도구 소관 | 범위 밖(No.41) |
| H-9 | 지식베이스 첫 적재(No.43) | 첫 회 미리보기 확인 후 적재 승인 | `security:write` | `requirements/kb-crawling.md` · ADR-0044 | 승인 전 적재 0 ✅ | 없음 |
| H-10 | 외부 RAG 답(No.30·36) | 답 자체는 사전 승인 불가(실시간) — **위험 응답 규칙**(이번)·👎 → H-3 | `security:write` | 이 문서 · ADR-0048 | 가드레일은 자산 변경 0(AG-5) | 해당 없음 |

- **진짜 공백은 H-4·H-5의 "요청자 ≠ 승인자" 하나였다** — 이번에 챗봇별로 켤 수 있게 채운다(J-5).

---

## 12. 데이터 모델 · 마이그레이션

### 12.1 Prisma 초안

```prisma
model GuardrailRule {
  id              String   @id @default(uuid())
  chatbotId       String
  chatbot         Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  name            String
  nameNormalized  String
  category        String                       // GuardrailCategory
  /// 원문 표현 JSON 배열(관리자 설정값 · 1~100 · 각 ≤50)
  expressions     String
  matchType       String   @default("CONTAINS") // BannedWordMatchType
  appliesTo       String                       // INBOUND | OUTBOUND | BOTH
  action          String   @default("MONITOR") // MONITOR | REPLACE | NO_RAG
  replacementText String?
  enabled         Boolean  @default(true)
  sortOrder       Int
  createdById     String?
  createdByEmail  String?
  updatedById     String?
  updatedByEmail  String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([chatbotId, nameNormalized])
  @@index([chatbotId, sortOrder])
  @@index([enabled, chatbotId])                 // 전역 색인(distinct chatbotId)
  @@map("guardrail_rules")
}

model ChatbotGuardrailSetting {
  chatbotId        String   @id
  chatbot          Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// GuardrailPiiKind[] JSON — 행 없음 = ["RRN","CARD"]
  piiExitKinds     String   @default("[\"RRN\",\"CARD\"]")
  piiPreserveDates Boolean  @default(true)
  updatedById      String?
  updatedByEmail   String?
  updatedAt        DateTime @updatedAt
  @@map("chatbot_guardrail_settings")
}

model GuardrailEvent {
  id            String   @id @default(uuid())
  chatbotId     String                          // FK 없음(로그 규약)
  messageId     String                          // ConversationLog.id — FK 없음
  stage         String                          // INBOUND | OUTBOUND
  kind          String                          // RULE | PII | ERROR
  ruleId        String?                         // FK 없음(삭제 후에도 남는 사실 기록)
  ruleName      String?
  category      String?
  ruleAction    String?
  appliedAction String                          // MONITOR | REPLACE | NO_RAG | MASK | FALLBACK
  decisive      Boolean  @default(false)
  effect        String                          // CHANGED | NONE
  piiKind       String?
  piiCount      Int?
  errorCode     String?
  dayBucket     String
  createdAt     DateTime @default(now())

  @@index([chatbotId, dayBucket])
  @@index([chatbotId, ruleId, dayBucket])
  @@index([chatbotId, createdAt])
  @@index([messageId])
  @@map("guardrail_events")
}

model ProdSwitchApprovalRequest {
  id                String    @id @default(uuid())
  chatbotId         String
  chatbot           Chatbot   @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  action            String                      // PROD_SWITCH | PROD_ROLLBACK | SCHEDULED_PROD_SWITCH
  targetVersionId   String                      // FK 없음(ADR-0039 버전 id 규약)
  targetVersionNo   Int
  baseProdVersionId String
  baseProdVersionNo Int
  deployScheduleId  String?                     // FK 없음
  gateSnapshot      String                      // GateEvaluation JSON
  warningCodes      String                      // string[] JSON
  diffChangedCount  Int
  reason            String?                     // ≤200 · 금지어 → PII 마스킹본
  status            String                      // PENDING | APPROVED | REJECTED | CANCELLED | EXPIRED
  outcome           String?                     // APPLIED | NOOP | FAILED | SCHEDULED (APPROVED일 때)
  failureCode       String?
  closedReason      String?                     // REQUESTER | POLICY_OFF | BASE_CHANGED | SCHEDULE_INACTIVE (CANCELLED일 때)
  decisionNote      String?                     // 반려 메모 ≤200 · 마스킹본
  requestedById     String                      // FK 없음 + 이메일 스냅샷
  requestedByEmail  String
  decidedById       String?
  decidedByEmail    String?
  decidedAt         DateTime?
  expiresAt         DateTime
  /// 대기일 때만 chatbotId — 챗봇당 대기 1건(nullable 유일 · 원시 부분 인덱스 0)
  pendingLock       String?   @unique
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([chatbotId, createdAt])
  @@index([status, expiresAt])
  @@index([deployScheduleId])
  @@map("prod_switch_approval_requests")
}

// 기존 모델 컬럼 추가
model ConversationLog     { /* … */ guardrailStage String?                 /* INBOUND | OUTBOUND — record() 1곳 · 적재 후 불변 · 인덱스 없음 */ }
model EnvironmentSwitchLog { /* … */ approvalRequestId String?  approvalMode String?   /* APPROVED | SOLO_ROLLBACK — FK 없음 */ }
model ChatbotEnvironment   { /* … */ approvalRequired Boolean @default(false)  approvalTtlHours Int @default(24) }
model Chatbot              { /* 역참조 3줄 — DB 컬럼 0 */ guardrailRules GuardrailRule[]  guardrailSetting ChatbotGuardrailSetting?  switchApprovalRequests ProdSwitchApprovalRequest[] }
```

### 12.2 마이그레이션 영향

| 항목 | 내용 |
|---|---|
| 이름 | `…_ai_guardrails`(1개) |
| DDL | `CREATE TABLE` 4 + `CREATE INDEX`/`CREATE UNIQUE INDEX` · `ALTER TABLE … ADD COLUMN` 5(`conversation_logs.guardrailStage` nullable · `environment_switch_logs.approvalRequestId`/`approvalMode` nullable · `chatbot_environments.approvalRequired NOT NULL DEFAULT false`/`approvalTtlHours NOT NULL DEFAULT 24`) |
| 테이블 재정의 | **0** — SQLite `ADD COLUMN`(nullable 또는 상수 기본값)은 재정의가 필요 없다. 생성된 SQL에 `PRAGMA foreign_keys=OFF`·`CREATE TABLE "new_…"`·`INSERT INTO "new_…"`·`DROP TABLE`·`DROP INDEX`가 보이면 **적용 중단**(원시 부분 유니크 4개 소실 위험 — `test_runs` 1 · `deploy_schedules` 2 · `handoff_sessions` 1) |
| 부분 유니크 | 새 원시 부분 인덱스 0 — 대기 1건은 nullable `@unique`(§10.3). 적용 후 `sqlite_master`에서 원시 부분 유니크 **4행 그대로** 확인 |
| 백필 | 0 — 기존 행의 새 컬럼 값(null · false · 24)이 사실과 같다(과거에 가드레일·승인 없음) |
| 기존 데이터 호환 | 규칙 0개 · 승인 정책 꺼짐 = 현행 동작. **단 출구 개인정보 가림은 기본 켜짐**(행 없음 = 주민번호·카드) — 배포 즉시 모든 챗봇 RAG 답에서 그 형식이 가려진다(의도된 변화 · U-1) |
| 시험 DB | `prisma migrate deploy`로 생성(CLAUDE.md 규약 — `db push`는 부분 유니크를 만들지 않는다 · 이번 신규 제약은 `db push`로도 생긴다) |
| 되돌리기 | 코드 롤백 시 새 컬럼·테이블은 남아도 무해(읽는 코드 없음). 컬럼 제거가 필요하면 별도 마이그레이션(재정의 발생 — 원시 부분 유니크 재생성 SQL 동반) |

### 12.3 참조 무결성

- `GuardrailRule → Chatbot` · `ChatbotGuardrailSetting → Chatbot` · `ProdSwitchApprovalRequest → Chatbot` = `Restrict`(전 관계 명시 규약).
- FK를 걸지 않는 것(사실 기록 · 이름 스냅샷 동반): `GuardrailEvent`의 `chatbotId`·`messageId`·`ruleId` · `ProdSwitchApprovalRequest`의 `targetVersionId`·`baseProdVersionId`·`deployScheduleId`·`requestedById`·`decidedById` · `EnvironmentSwitchLog.approvalRequestId` · `GuardrailRule`의 `createdById`·`updatedById`.

### 12.4 영구삭제 동반 삭제(30 → 34테이블)

`chatbots.service.ts` 영구삭제 트랜잭션에 `guardrailEvent.deleteMany` · `guardrailRule.deleteMany` · `chatbotGuardrailSetting.deleteMany` · `prodSwitchApprovalRequest.deleteMany`(순서 무관 — 서로 FK 없음 · `chatbot.delete` 전). **사전검사(409) 16종 불변** — 설정·파생·사실 기록 데이터다. `chatbots.service.spec.ts` 트랜잭션 목 +4(X-3).

---

## 13. API 계약 · shared-types

### 13.1 엔드포인트

**가드레일(`GuardrailsController` — `/chatbots/:chatbotId/guardrails` · 13 핸들러)**

| 메서드 · 경로 | 권한 | 요청 → 응답 | 오류 |
|---|---|---|---|
| `GET …/rules` | `security:read` | → `{ items: GuardrailRule[], meta: { ragActive, serverEnabled, limits: { maxRules, maxExpressions, usedRules, usedExpressions } } }`(sortOrder 순 · 규칙별 최근 7일 적중 · `replacementBannedHit`) | 404(교차) |
| `POST …/rules` | `security:write` | `CreateGuardrailRuleDto` → `201 GuardrailRule`(맨 뒤) | 400 `VALIDATION_FAILED`·`BANNED_WORD_BLOCKED` · 409 `DUPLICATE_NAME`·`LIMIT_EXCEEDED`·`CHATBOT_ARCHIVED` |
| `GET …/rules/:ruleId` | `security:read` | → `GuardrailRule`(표현 전체) | 404 |
| `PUT …/rules/:ruleId` | `security:write` | 전체 교체(`UpdateGuardrailRuleDto` = 생성과 같은 본문) → `GuardrailRule` | 위와 같음 + 404 |
| `DELETE …/rules/:ruleId` | `security:write` | → `204`(이벤트는 남음) | 404 · 409 `CHATBOT_ARCHIVED` |
| `POST …/rules/:ruleId/enable`·`/disable` | `security:write` | → `GuardrailRule`(멱등) | 404 · 409 `CHATBOT_ARCHIVED` |
| `POST …/rules/:ruleId/move` | `security:write` | `{ direction: 'UP'｜'DOWN' }` → `GuardrailRule[]` | 404 · 409 `CHATBOT_ARCHIVED` |
| `POST …/test` | `security:read` | `GuardrailTestRequest` → `GuardrailTestResponse` — **저장 0 · 감사 0 · 이벤트 0** | 400 |
| `GET …/settings` | `security:read` | → `{ piiExit: { kinds, preserveDates }, isDefault, governanceFloor: GuardrailPiiKind[] }` | 404 |
| `PUT …/settings` | `security:write` | `{ piiExit: { kinds, preserveDates } }` → 같은 응답 | 400 `VALIDATION_FAILED`(`GOVERNANCE_FLOOR`) · 409 `CHATBOT_ARCHIVED` |
| `GET …/overview?from=&to=` | `security:read` | → `GuardrailOverview`(§8.4) | 400 `STATS_RANGE_TOO_WIDE`·`INVALID_PERIOD` |
| `GET …/events?from=&to=&ruleId=&stage=&appliedAction=&page=&pageSize=` | `security:read` · 거버넌스 모드 `VIEW` 감사 | → `Paginated<GuardrailEventItem>`(§8.5) | 400 |

- 라우트: `test`·`settings`·`overview`·`events`는 `rules/:ruleId`와 경로가 겹치지 않는다(선언 순서 제약 없음).
- `ARCHIVED` 챗봇: 조회·시험하기 허용 · 쓰기 `409 CHATBOT_ARCHIVED`.

**2인 승인(`SwitchApprovalsController` — `/chatbots/:chatbotId/environment/approval` · 7 + `EnvironmentApprovalsGlobalController` — `/environment-approvals` · 2)**

| 메서드 · 경로 | 권한 | 요청 → 응답 | 오류 |
|---|---|---|---|
| `GET /chatbots/:chatbotId/environment/approval` | `chatbot:read`+`dialogue:read` | → `ApprovalPolicyStatus`(정책 · 모드 · 승인 가능자 수 · 끄기 잠금 · 대기 요청 · 최근 20건) — 지연 종결 수행 | 404 |
| `PUT …/approval` | `chatbot:deploy` | `{ required, ttlHours }` → `ApprovalPolicyStatus` | 409 `APPROVAL_POLICY_UNAVAILABLE` |
| `POST …/approval/requests` | `chatbot:deploy` | `CreateProdSwitchApprovalDto`(판별 유니온 §13.2) → `201 ProdSwitchApprovalSummary` | 409 `APPROVAL_PENDING_EXISTS`·`APPROVAL_POLICY_UNAVAILABLE`·`ENV_*` · 400 · 403 · 404 |
| `GET …/approval/requests/:requestId` | `chatbot:read`+`dialogue:read` | → `ProdSwitchApprovalDetail`(대기면 `livePreview` = 현재 운영 기준 `ProdSwitchService.preview()` — 차이·게이트·경고 · 실행됐으면 전환 이력 요약) | 404 |
| `POST …/approval/requests/:requestId/approve` | `chatbot:deploy` | `{ acknowledgeWarnings? }` → `{ request, switch: ProdSwitchResponse｜null }` | 403 `APPROVAL_SELF_FORBIDDEN` · 409 `APPROVAL_NOT_PENDING`·`APPROVAL_BASE_CHANGED`·`ENV_*` · 400 · 404 |
| `POST …/approval/requests/:requestId/reject` | `chatbot:deploy` | `{ note? }` → `ProdSwitchApprovalSummary` | 403 · 409 · 404 |
| `POST …/approval/requests/:requestId/cancel` | `chatbot:deploy`(요청자만) | → `ProdSwitchApprovalSummary` | 403 `FORBIDDEN` · 409 · 404 |
| `GET /environment-approvals?status=PENDING｜ALL&page=` | `chatbot:deploy` | → `Paginated<ProdSwitchApprovalSummary>`(챗봇 이름 · `canApprove`) — 지연 종결 수행 | — |
| `GET /environment-approvals/summary` | `chatbot:deploy` | → `{ pendingTotal, pendingForMe }`(콘솔 배지 — `pendingForMe` = 내가 요청자가 아닌 대기) | — |

**기존 경로 변화(요청 스키마 불변)**

| 경로 | 변화 |
|---|---|
| `POST …/environment/prod/switch` | 정책 켜짐이면 `409 ENV_APPROVAL_REQUIRED` |
| `POST …/environment/prod/rollback` | 정책 켜짐 ∧ 대상이 직전이 아니면 `409 ENV_APPROVAL_REQUIRED` · 직전이면 즉시(표식) |
| `POST …/environment/prod/preview` | 응답 선택 필드 `approval?: { required: true, soloRollbackAllowed?: boolean }` |
| `POST …/environment/disable` · `…/disable/preview` | 정책 켜짐이면 `409 ENV_APPROVAL_REQUIRED` · 미리보기 `approvalPolicyActive?: true` |
| `GET …/environment/history` | 항목 선택 필드 `approvalMode?`(이력 표식) |
| `POST /chatbots/:chatbotId/simulate` | 응답 선택 필드 `guardrailInbound?` · `matchTrace.ragPreview?`(§9) |
| 예약 목록·상세 | `failureReason`에 `APPROVAL_MISSING` 값이 생길 수 있음(스키마 enum +1) |
| `GET /governance/map` | 선택 키 `guardrails?` |
| 공개 대화·보류 폴링·설정 조회·평가 | **스키마 불변** — 값만(대체 문구 · `FAILED`) |

### 13.2 shared-types(개요 — `guardrails.ts` · `prod-switch-approval.ts`)

```ts
// guardrails.ts
export const GuardrailCategory = z.enum(['CRISIS_SELF_HARM','MEDICAL_ADVICE','LEGAL_ADVICE','FINANCIAL_ADVICE','PERSONAL_INFO_REQUEST','PROMPT_INJECTION','DISCRIMINATION_HATE','OTHER']);
export const GUARDRAIL_CATEGORY_LABELS: Record<GuardrailCategory, string>;   // 위기·자해 · 의료 조언 · …
export const GuardrailAppliesTo = z.enum(['INBOUND','OUTBOUND','BOTH']);
export const GuardrailAction = z.enum(['MONITOR','REPLACE','NO_RAG']);
export const GUARDRAIL_ACTION_LABELS = { MONITOR: '기록만', REPLACE: '안전 문구로 대체', NO_RAG: 'AI로 보내지 않음' };
export const GuardrailPiiKind = z.enum(['RRN','CARD','ACCOUNT','PHONE','EMAIL']);
export const GUARDRAIL_PII_DEFAULT_KINDS = ['RRN','CARD'] as const;
export const GUARDRAIL_LIMITS = { nameMax: 50, expressionMax: 50, expressionMinNormalized: 2, expressionsPerRuleMax: 100, replacementMax: 300, replacementMaxLines: 5, testTextMax: 2000, overviewMaxRangeDays: 90, eventsPageMax: 100 } as const;

const GuardrailRuleBodySchema = z.object({
  name: z.string().trim().min(1).max(50),
  category: GuardrailCategory,
  expressions: z.array(z.string().trim().min(1).max(50)).min(1).max(100),
  matchType: BannedWordMatchType.default('CONTAINS'),
  appliesTo: GuardrailAppliesTo,
  action: GuardrailAction.default('MONITOR'),            // AC-AG2-2
  replacementText: z.string().trim().min(1).max(300).nullable().optional(),
  enabled: z.boolean().default(true),
}).superRefine((v, ctx) => {
  // REPLACE ⇒ replacementText 필수 · NO_RAG ⇒ appliesTo === 'INBOUND'(AC-AG2-4)
});
export const CreateGuardrailRuleSchema = GuardrailRuleBodySchema;
export const UpdateGuardrailRuleSchema = GuardrailRuleBodySchema;   // PUT 전체 교체
export const GuardrailRuleSchema = z.object({ id, chatbotId, name, category, expressions: z.array(z.string()), matchType, appliesTo, action, replacementText: z.string().nullable(), enabled, sortOrder, expressionCount, replacementBannedHit: z.boolean(), recentHits7d: z.number().int().nonnegative(), updatedByEmail: z.string().nullable(), createdAt, updatedAt });
export const GuardrailPiiExitSettingsSchema = z.object({ kinds: z.array(GuardrailPiiKind).max(5), preserveDates: z.boolean() });   // 서비스가 중복 제거
export const GuardrailTestRequestSchema = z.object({
  text: z.string().min(1).max(2000), stage: z.enum(['INBOUND','OUTBOUND']),
  draftRule: GuardrailRuleBodySchema.optional(), draftRuleId: z.string().uuid().optional(),  // 편집 중 규칙을 저장 전 시험(같은 id면 저장본 대신)
  draftPiiExit: GuardrailPiiExitSettingsSchema.optional(),
});
export const GuardrailTestResponseSchema = z.object({
  stage, result: z.enum(['PASS','MONITOR','NO_RAG','REPLACE','MASKED','FALLBACK']),
  hits: z.array(z.object({ ruleId: z.string().uuid().nullable(), ruleName, category, action, decisive: z.boolean(), matchedExpressions: z.array(z.string()) })),
  resultText: z.string(),                        // 대체 문구 · 가린 텍스트(출구 금지어 적용 후) · PASS면 입력 그대로
  piiCounts: z.record(GuardrailPiiKind, z.number().int()).partial(),
});
export const GuardrailOverviewQuerySchema / GuardrailOverviewSchema / GuardrailEventListQuerySchema / GuardrailEventItemSchema   // §8.4·§8.5

// prod-switch-approval.ts
export const ProdSwitchApprovalAction = z.enum(['PROD_SWITCH','PROD_ROLLBACK','SCHEDULED_PROD_SWITCH']);
export const ProdSwitchApprovalStatus = z.enum(['PENDING','APPROVED','REJECTED','CANCELLED','EXPIRED']);
export const ProdSwitchApprovalOutcome = z.enum(['APPLIED','NOOP','FAILED','SCHEDULED']);
export const ProdSwitchApprovalClosedReason = z.enum(['REQUESTER','POLICY_OFF','BASE_CHANGED','SCHEDULE_INACTIVE']);
export const APPROVAL_TTL_HOURS = { min: 1, max: 168, default: 24 } as const;
export const UpdateApprovalPolicySchema = z.object({ required: z.boolean(), ttlHours: z.number().int().min(1).max(168) });
export const CreateProdSwitchApprovalSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('PROD_SWITCH'), targetVersionId: z.string().uuid(), expectedProdVersionId: z.string().uuid(), acknowledgeWarnings: z.boolean().optional(), reason: EnvironmentReasonSchema.optional() }),
  z.object({ action: z.literal('PROD_ROLLBACK'), targetVersionId: z.string().uuid().optional(), expectedProdVersionId: z.string().uuid(), acknowledgeWarnings: z.boolean().optional(), reason: EnvironmentReasonSchema.optional() }),
  z.object({ action: z.literal('SCHEDULED_PROD_SWITCH'), deployScheduleId: z.string().uuid(), reason: EnvironmentReasonSchema.optional() }),
]);
export const ApproveProdSwitchSchema = z.object({ acknowledgeWarnings: z.boolean().optional() });
export const RejectProdSwitchSchema = z.object({ note: z.string().trim().max(200).optional() });
export const ProdSwitchApprovalSummarySchema = z.object({
  id, chatbotId, chatbotName, action, status, outcome: ProdSwitchApprovalOutcome.nullable(), failureCode: z.string().nullable(), closedReason: ProdSwitchApprovalClosedReason.nullable(),
  target: z.object({ versionId, versionNo }), base: z.object({ versionId, versionNo }),
  deployScheduleId: z.string().uuid().nullable(), scheduledAt: z.coerce.date().nullable(),
  gateVerdict: z.enum(['PASS','WARN','BLOCK']), warningCodes: z.array(z.string()), diffChangedCount: z.number().int(),
  reason: z.string().nullable(), decisionNote: z.string().nullable(),
  requestedBy: z.object({ id, email, active: z.boolean() }), decidedBy: z.object({ id, email }).nullable(), decidedAt: z.coerce.date().nullable(),
  expiresAt: z.coerce.date(), createdAt: z.coerce.date(),
  canApprove: z.boolean(), canCancel: z.boolean(), executedAt: z.coerce.date().nullable(),
});
export const ProdSwitchApprovalDetailSchema = ProdSwitchApprovalSummarySchema.extend({ livePreview: ProdSwitchPreviewResponseSchema.nullable() });
export const ApprovalPolicyStatusSchema = z.object({ policy: UpdateApprovalPolicySchema, envModeOn: z.boolean(), eligibleApproverCount: z.number().int(), otherApproverCount: z.number().int(), offLocked: z.boolean(), pending: ProdSwitchApprovalSummarySchema.nullable(), recent: z.array(ProdSwitchApprovalSummarySchema).max(20) });
```

- `environment.ts`: `ProdSwitchPreviewResponseSchema`에 `approval: z.object({ required: z.literal(true), soloRollbackAllowed: z.boolean().optional() }).optional()` · `DisableEnvironmentPreviewResponseSchema`에 `approvalPolicyActive: z.literal(true).optional()` · `EnvironmentSwitchLogItemSchema`에 `approvalMode: z.enum(['APPROVED','SOLO_ROLLBACK']).nullable().optional()`(이력 화면 표식).
- `conversation.ts`: `MatchTraceSchema`에 `ragPreview?` · `SimulateResponseSchema`에 `guardrailInbound?`.
- `deploy-schedule.ts`: `DeployScheduleFailureReason` +`APPROVAL_MISSING`(라벨 "승인 없음").
- `audit.ts`: `AuditTargetType` +`GuardrailRule`(규칙)·`ProdSwitchApprovalRequest`(운영 전환 승인 요청) — 36 → 38.
- `governance.ts`: 지도 선택 키 `guardrails?`(§8.6).

### 13.3 오류 코드(`ApiErrorCode` +6 — 이 그룹 신설)

| 코드 | HTTP | 뜻 |
|---|---|---|
| `ENV_APPROVAL_REQUIRED` | 409 | 2인 승인이 켜진 챗봇에서 승인 없이 전환·비직전 롤백·예약 실행·모드 끄기(`details.reason`: `APPROVAL_REQUIRED`｜`POLICY_ACTIVE`) |
| `APPROVAL_SELF_FORBIDDEN` | 403 | 요청자가 자기 요청을 승인·반려 |
| `APPROVAL_NOT_PENDING` | 409 | 이미 승인·반려·취소·만료됨 또는 선점 경합(`details.status`) |
| `APPROVAL_BASE_CHANGED` | 409 | 요청 이후 운영 버전·예약 기준이 바뀜 — 요청 종결 |
| `APPROVAL_PENDING_EXISTS` | 409 | 챗봇에 대기 요청이 이미 있음(`details.requestId`) |
| `APPROVAL_POLICY_UNAVAILABLE` | 409 | 정책 켜기/끄기·요청 불가(`details.reason`: `ENV_MODE_DISABLED`｜`NOT_ENOUGH_APPROVERS`｜`OFF_LOCKED`｜`NOT_REQUIRED`) |

가드레일 관리는 기존 코드 재사용(`VALIDATION_FAILED`·`BANNED_WORD_BLOCKED`·`DUPLICATE_NAME`·`LIMIT_EXCEEDED`·`NOT_FOUND`·`CHATBOT_ARCHIVED`·`STATS_RANGE_TOO_WIDE`·`INVALID_PERIOD`) — 신규 0.

---

## 14. 권한 · 감사 · 거버넌스

- **권한**: §10.11 · 가드레일 = `security:read`/`security:write`(금지어와 같은 ADMIN 등급 — P-9). EDITOR는 시뮬레이터에서 판정 표시(규칙 이름·대체 문구)를 본다(S-9 — 관리자 화면 한정). 신규 권한 0.
- **감사 화이트리스트(`AUDIT_FIELDS`)**:
  - `GuardrailRule`: `name`·`category`·`appliesTo`·`action`·`matchType`·`enabled`·`sortOrder`·`expressionCount`·`hasReplacementText` — **표현·대체 문구 본문은 담지 않는다**(설정값이지만 길고, 감사는 "누가·어떤 규칙·동작 전후"면 충분 — FR-AG1-7).
  - `ProdSwitchApprovalRequest`: `action`·`status`·`outcome`·`failureCode`·`closedReason`·`targetVersionNo`·`baseProdVersionNo`·`expiresAt`·`gateVerdict` — 사유·메모 본문 0.
  - `Chatbot` += `guardrailPiiExit`(종류·날짜 보호) · `ChatbotEnvironment` += `approvalRequired`·`approvalTtlHours`.
- **열람 감사**: `GuardrailsController#listEvents` → `ConversationLog`(12 → 13 · X-2).
- **거버넌스(No.45)**: 새 출구 0 · 새 보존 종류 0 · 새 필드 암호화 대상 0(요청 사유는 마스킹 메모 — 환경 전환 사유 `EnvironmentSwitchLog.reason`과 같은 취급) · 지도 키 · 개인정보 가림 하한(§7.4) · 파기 잡 무관(이벤트에 문장 0).
- **끄기 잠금**: ~~`ENV_APPROVAL_OFF_LOCKED`는 거버넌스 모드와 무관하게 적용한다(R-9)~~ → **2026-10-01 PM 결정(ADR-0049 §2)**: 3상태 — 명시 `true`/`false`는 모드와 무관하게 **우선**, **미설정이면 거버넌스 모드 ON일 때 잠금**(OFF면 현행). 거버넌스 ON + 명시 `false`는 기동 경고 1줄. 판정은 순수 함수 `environment/approval/lib/approval-off-lock.ts` 1곳. 승인 현황 응답 `offLocked`(실효 잠금) + 잠금일 때만 `offLockedBy`(`SERVER_SETTING`｜`GOVERNANCE_MODE`)에 표시. (정정: 데이터 지도에는 잠금 표시가 구현되지 않았고 이번에도 추가하지 않는다.)

---

## 15. 환경변수 · 기본값 (전부 선택 · API 전용 · ml-worker·위젯 변수 0)

| 변수 | 기본값 | 범위 | 설명 |
|---|---|---|---|
| `GUARDRAILS_ENABLED` | `true` | boolean(`envBoolean()`) | 서버 전체 가드레일 런타임 스위치. `false`면 입구·출구·가림 판정이 전부 `PASS`(도입 전 동작) — 관리 API는 동작하며 `serverEnabled=false` 표시(긴급 차단용) |
| `GUARDRAIL_CACHE_TTL_MS` | `60000` | 1000~600000 | 전역 색인·규칙 프로필·출구 설정 캐시 TTL(다중 인스턴스 반영 지연 상한) |
| `GUARDRAIL_MAX_RULES_PER_CHATBOT` | `50` | 1~200 | 챗봇당 규칙 수 상한 |
| `GUARDRAIL_MAX_EXPRESSIONS_PER_CHATBOT` | `2000` | 100~10000 | 챗봇당 표현 총합 상한(성능 목표의 기준값 — 올리면 §16 재측정) |
| `ENV_APPROVAL_OFF_LOCKED` | (미설정) — 실효값 = 거버넌스 모드 ON이면 `true`, OFF면 `false` | boolean(`envBooleanOptional()` — 미설정·빈 값 허용) | `true`면 2인 승인 정책 **끄기**를 거부(켜기·TTL 변경은 허용). **명시값이 거버넌스 연동보다 우선**(2026-10-01 · ADR-0049 §2) |

- 승인 만료 시간은 환경변수가 아니라 **챗봇별 정책**(1~168시간 · 기본 24)이다.
- 하나도 설정하지 않으면: 규칙 0개 → 입구 변화 0 · 출구는 **주민번호·카드 가림 기본 켜짐** · 2인 승인 꺼짐.
- `jest.isolate-env.js`는 수정하지 않는다 — 5개 모두 기본값이 있어 기동 필수 키가 아니다. 선택 기능을 바꿔야 하는 spec은 값을 먼저 설정한 뒤 `await import('../app.module')`(CLAUDE.md 규약).

---

## 16. 성능 예산 (NFR-AGP · FR-0-299)

| 항목 | 예산 | 측정 |
|---|---|---|
| 공개 대화 API P95 | **500ms 불변**(콜드 1.5초 불변) | 기존 회귀 측정 |
| 질의 임베딩 | **300ms 불변** — 가드레일은 임베딩을 부르지 않는다(REPLACE면 오히려 호출 0) | AG-3 |
| 입구 판정 추가 지연 | **P95 ≤ 1ms**(규칙 50 · 표현 2,000 · 입력 500자 · 캐시 적중) | `guardrails/eval/measure-guardrail-latency.ts`(1만 회 · 개발 PC · 결과를 §26 I-n에 장비·일자와 기록 — AC-AG3-6) + CI 느슨한 상한(P95 ≤ 5ms) |
| 규칙 없는 챗봇의 입구 | 메모리 `Set.has` 1회 · **쿼리 0 · 정규화 0** | 쿼리 수 통합 시험(기대값 불변) |
| 출구 판정 + 가림 | **P95 ≤ 5ms**(답 2,000자) — 백그라운드 경로 | 같은 도구 · CI 상한 25ms |
| 턴당 DB 조회 추가(캐시 적중) | **0** · 콜드: 입구 규칙 1(규칙 있는 챗봇만) · 출구 설정 1(백그라운드) | 통합 시험 |
| 이벤트 적재 | 응답 대기 0(`void`) · 턴당 `createMany` 1 | — |
| 관리 API | 규칙 목록 P95 300ms · 저장 P95 300ms · 시험하기 P95 100ms · 현황(90일 · 이벤트 100만 행) P95 2초 · 이벤트 목록 P95 500ms | 통합 시험(규모 픽스처는 수동) |
| 승인 | 요청 생성 = 전환 미리보기 예산 + 50ms · 승인 = 기존 전환 확정 예산 + 50ms(요청 검증 1쿼리 + 선점 1) · 전역 대기 목록 P95 300ms | — |
| 전환 경로(정책 꺼짐) | 추가 쿼리 **0**(정책은 기존 `getPointerStatus` 행에서 읽음) | 환경 통합 시험 |

---

## 17. 화면 정보구조 (상세는 `ui-designer` — `docs/03-design/ai-guardrails-ui-spec.md`)

### 17.1 위험 응답 규칙(챗봇 상세 "검증" 그룹 끝 새 탭 **"안전 가드레일"** — `/chatbots/:id/guardrails` · 하위 탭: 규칙 · 현황)

- 권한 없는(`security:read` 없음) 사용자도 탭 링크는 보이고 페이지에서 `ForbiddenState`(No.41 선례).
- **규칙 목록 표**: 순서(위/아래 버튼) · 이름 · 분류 · 적용 위치(글자) · 동작(글자 배지 — "기록만/안전 문구로 대체/AI로 보내지 않음" · 색 단독 금지) · 표현 수 · 켜짐(스위치 + 글자) · 최근 7일 적중 · 경고(대체 문구 금지어 포함 · 외부 RAG 미사용 챗봇의 출구 규칙 — EX-AG-16·9) · 작업(수정·삭제).
- **규칙 편집(대화상자 또는 페이지)**: 레이블 있는 필드(이름 · 분류 선택 · 표현 목록(한 줄 1개 입력 + 추가/삭제 · 개수 표시) · 매칭 방식 라디오 · 적용 위치 라디오 · 동작 라디오(`AI로 보내지 않음`은 적용 위치가 "사용자 질문"일 때만 활성 + 이유 문구) · 대체 문구(동작이 대체일 때 필수 · 글자 수 · "링크·HTML 불가") · 켜짐). 새 규칙 기본 동작 "기록만" + 안내("지켜본 뒤 강화하세요").
- **문장으로 시험하기 패널**(편집 화면 옆 · 규칙 목록 상단 공용): 문장 입력 · 위치(사용자 질문/AI 답) · 결과(걸린 규칙 · 최종 동작 · 결과 문구 · 가림 건수) — `aria-live="polite"`. 편집 중 규칙은 저장 전 반영(`draftRule`).
- **AI 답 개인정보 가림 설정 절**: 종류 체크박스 5(주민등록번호·카드번호 기본 선택) · 계좌 선택 시 경고 + "날짜는 가리지 않기" 체크 · 비정형 한계 안내 · 거버넌스 하한이면 두 항목 비활성 + 이유.
- 상시 한계 안내: "표현 목록에 있는 말만 찾습니다 — 띄어쓰기·다른 표현은 찾지 못할 수 있습니다 · AI 답이 문서와 다른지는 검사하지 않습니다"(문구에 "환각" 금지 — AG-16).

### 17.2 가드레일 현황(같은 탭 하위 "현황")

- 기간 선택(기존 `PeriodSelector` · ≤90일) · 요약 카드(입구 적중 · 출구 적중 · 대체 · AI로 안 보냄 · 가림 · 오류 폴백 · RAG 답 중 대체 비율) · 규칙별 표(적중·효과) · 개인정보 종류별 표 · **알림 목록**(직전 버전 단독 롤백 — 일시·실행자·버전) · **이벤트 목록**(필터 · 행 펼치면 대화 마스킹본 · 거버넌스 모드 열람 기록 배너).
- **사람 승인 현황 안내**(§11 H-1~H-10 요약 문구 + 각 화면 링크 · 2인 승인 켜짐 여부 글자 표시) — 데이터 변경 0.

### 17.3 운영 전환 승인

- **환경 탭(기존) 보강**: "운영 전환 2인 승인" 절(스위치 + 만료 시간 선택 1~168 · 켜기 불가 사유 · 끄기 잠금 표시 · 승인 가능한 다른 관리자 수) · 정책 켜짐이면 "운영 전환" 버튼 → **"승인 요청"**(사유 입력 · 경고 확인 체크) · 대기 요청 카드(대상·기준·만료까지 남은 시간·요청자·취소 버튼) · 롤백 버튼은 직전 버전이면 "즉시 되돌리기(승인 예외 — 기록됨)" / 아니면 "되돌리기 승인 요청" · 끄기 버튼은 정책 켜짐이면 비활성 + 이유 · 전환 이력 표에 "2인 승인"/"단독 롤백" 글자 표식.
- **전역 "승인 대기" 화면**(상단 내비 — `chatbot:deploy` 보유자만 · 배지 = `pendingForMe`): 목록(챗봇 · 동작 · 대상/기준 버전 · 요청자 · 게이트 판정 · 경고 수 · 만료까지) → 상세(차이 요약 = 기존 전환 미리보기 구성 재사용 · 게이트 · 경고 확인 체크 · 승인/반려(메모) 버튼). **자기 요청은 승인·반려 버튼 비활성 + "본인이 요청한 건은 승인할 수 없습니다"**(서버도 거부).
- **예약 배포 폼/목록(기존) 보강**: 정책 켜짐이면 `SWITCH_PROD_VERSION` 생성 버튼 문구 "예약 + 승인 요청" · 목록 행에 승인 상태(대기/승인됨/반려/없음 — 글자) · "승인 요청 필요" 행의 요청 버튼 · 실패 사유 `APPROVAL_MISSING` 라벨.
- **시뮬레이터 결과 패널(기존) 보강**: 입구 판정 배너 · RAG 답 미리보기(최종 문구 · 대체/폴백이면 원답 마스킹본 접기 · 규칙 이름 · 가림 건수) — "운영이면" 문구.
- UIUX: 모든 폼 레이블 · 키보드 조작(위/아래 이동 버튼 · 스위치 · 표 행 동작) · 상태 글자 표시 · 확인 대화상자(삭제 · 정책 끄기 · 반려 · 단독 롤백) · 결과 `aria-live` · 오류 메시지 필드 연결(`UIUX_준수기준.md`).

---

## 18. 시험 전략

### 18.1 단위(순수 함수 · 서비스 — CI)

| 대상 | 핵심 사례 |
|---|---|
| `rule-validate.ts` | 2자 미만 · 중복 제거 · EXACT 다단어 · 대체 문구 HTML/URL · 경계 길이(50·100·300) |
| `compile-profile.ts`·`evaluate-rules.ts` | 같은 표현 두 규칙 합치기 · 단계 분리(BOTH) · REPLACE > NO_RAG > MONITOR · 동률 sortOrder·createdAt·id · 빈 사전 즉시 PASS(정규화 호출 0 — 스파이) · `detect()` 재사용(금지어 파일 import만) |
| `exit-pii.ts` + `packages/pii-mask` | 골든(§7.3 ①) · 동등성 ② · 기본 종류 · 종류별 단독 · 전화 끔+계좌 켬에서 전화 비오분류 · 날짜 보호 · 날짜 비보호 시 기존 오인 재현(EX-AG-19) · 자리표시 문자 입력 fail-closed · FULL 모드 · 토큰만 남음 판정 |
| `approval-policy.ts`·`approval-state.ts` | 정책 꺼짐 = 불필요 · SWITCH 필요 · 직전 ROLLBACK 불필요 · 비직전 필요 · 만료·기준 변경·예약 비활성 유효 상태 · 예약 요청 만료 = min |
| `GuardrailRuntimeService` | 캐시 3층 · 무효화 · stale-on-error · 콜드 실패 입구 PASS/출구 FALLBACK · 오류 수렴 표(§6.3) · `GUARDRAILS_ENABLED=false` |
| `outcome-classifier` | `ENV_APPROVAL_REQUIRED` → `PERMANENT APPROVAL_MISSING`(신규 사례 — 기존 사례 무수정) |

### 18.2 통합(`apps/api/src/integration/` — 가짜 RAG HTTP 서버 · `prisma migrate deploy` DB)

| 파일 | 내용 |
|---|---|
| `ai-guardrails.integration.spec.ts` | 규칙 CRUD·권한·감사·캐시 즉시 반영 · 입구 4동작 · 출구(가짜 RAG) 대체·기록만·가림·폴백·오류 · 관리자 답 미적용 · 통계 분류 · 이벤트 문장 0 · 현황 합계 · 이벤트 목록 VIEW 감사(거버넌스 ON은 동적 import) · 스냅샷·승격·토픽 분리 비포함 |
| `ai-guardrails-query-count.integration.spec.ts` | 규칙 없는 챗봇 첫 턴 쿼리 수 = 도입 전 고정값(`EXPECTED_TURN_QUERY_COUNT` 공유) · 규칙 있는 챗봇 콜드 +1 · 캐시 적중 +0 |
| `ai-guardrails-byte-parity.integration.spec.ts` | 규칙 0 · 가림 끔(종류 빈 배열) · 정책 꺼짐에서 공개 대화·보류 폴링 응답 바이트 = `GUARDRAILS_ENABLED=false` 인스턴스(동적 import)와 동일 · 저장 `userMessage` 바이트 동일 |
| `prod-switch-approval.integration.spec.ts` | AC-AG6-1~6·8~10 · 동시 요청 · 승인 vs 취소 경합(두 요청 병렬) · 승인 실패 분류 · 끄기 차단 · 비직전 롤백 차단 · 자기 승인 서버 거부 · 감사 건수 |
| `prod-switch-approval-schedule.integration.spec.ts` | 예약 + 요청 → 미승인 도래 `tick()` = `FAILED(APPROVAL_MISSING)` · 승인 후 도래 = 전환 + 이력 `approvalRequestId` · 요청자 ≠ 예약 작성자 거부 · 예약 취소 후 요청 지연 종결(`DEPLOY_SCHEDULE_ENABLED`는 끈 채 `tick()` 직접 호출 — CLAUDE.md 규약) |

### 18.3 성능 측정(수동 기록 · FR-0-308)

- `guardrails/eval/measure-guardrail-latency.ts`: 규칙 50 · 표현 2,000(합성) · 입력 500자 · 답 2,000자 × 1만 회 → P50/P95/P99 · 장비·일자·Node 버전과 함께 §26에 기록. 규칙 기반이라 **개발 PC 측정값으로 합격 판정**(P-4).

### 18.4 회귀

- api `npx jest` 전체 · web `npx vitest run` 전체 · ml-worker pytest(변경 0 확인) · `packages/pii-mask` 시험 · shared-types 빌드 선행(`pnpm --filter @chat-bot/shared-types build`).

### 18.5 의도된 기존 시험 기대값 변경 — 닫힌 목록(FR-0-309)

| # | 파일 · 단언 | 변경 | 사유 |
|---|---|---|---|
| **X-1** | `environment/lib/environment-sealing.spec.ts` E-14 — `@RequirePermission('chatbot:deploy')` 사용 파일 = `environment.controller.ts` 1개 | 허용 집합 = {`environment/environment.controller.ts`, `environment/approval/switch-approvals.controller.ts`, `environment/approval/environment-approvals-global.controller.ts`} · 설명 문구 갱신 | 승인 동작의 권한이 `chatbot:deploy`(C-12) |
| **X-2** | `governance/lib/governance-sealing.spec.ts` G-15 — `VIEW_AUDIT_TARGETS` 12개 · 제목 문구 | 13개(`GuardrailsController#listEvents`) · "(No.42 +3 · No.21 +1 · No.36 +1)" | 이벤트 목록의 대화 마스킹본 열람(R-13) |
| **X-3** | `chatbots/chatbots.service.spec.ts` — 영구삭제 트랜잭션 목·호출 목록(30테이블) | 목에 `guardrailEvent`·`guardrailRule`·`chatbotGuardrailSetting`·`prodSwitchApprovalRequest`의 `deleteMany` 추가 · 기대 테이블 수 30 → 34 · 머리 주석 1줄 | §12.4 |
| **X-4(조건부)** | 대화 기록·전환 이력·환경 행 **전체를 `toEqual`로 비교하는 기존 시험이 있다면** | 새 컬럼 키 추가만 허용(`guardrailStage: null` · `approvalRequestId: null` · `approvalMode: null` · `approvalRequired: false` · `approvalTtlHours: 24`) — 다른 키·값 변경 금지 · 해당 파일을 §26에 I-n으로 기록 | 컬럼 추가의 기계적 반영 |

- **목록에 넣을 수 없는 것**(깨지면 설계 결함 — architect에게 되돌린다): `packages/pii-mask` 기존 시험 · 공개 턴 쿼리 수 고정값(`EXPECTED_TURN_QUERY_COUNT`·A/B 동일) · 공개 응답 골든·바이트 비교 · `rag-answer.service.spec.ts`·`public-conversation.service.spec.ts`·`simulation.service.spec.ts`(선택 인자라 무수정이어야 한다) · 엔진·위젯 시험 · `rag-allowlist.spec.ts` · 예약 봉인 · `Permission`·`EgressExitId`·`AuditAction` 개수 단언 · 통계 불변식 · E-9·PA-8·O-14(공개 대화 서비스 봉인).

### 18.6 AC ↔ 시험 매핑

| AC | 시험 |
|---|---|
| AC-AG1-1 | 전체 회귀 + `ai-guardrails-byte-parity` |
| AC-AG1-2 | `git diff --stat` 검토 + GR-8 + `validation-sealing` 7)(`@Public()` 9) |
| AC-AG1-3 | 기존 개수 단언 무수정(AG-2) |
| AC-AG1-4 | `ai-guardrails.integration` — 적중 턴 다수 전후 자산 6종·답변 설정·RAG 설정 해시 비교 + GR-3 |
| AC-AG1-5 | `rag-allowlist.spec.ts` 무수정 + GR-7 |
| AC-AG1-6 | `pii-mask` 골든·동등성 + byte-parity 저장 비교 + GR-5 |
| AC-AG2-1 | 통합(EDITOR 403 · ADMIN 201 + 감사 1) |
| AC-AG2-2 | shared-types 단위(zod 기본값) + 통합 |
| AC-AG2-3 | 통합(`BANNED_WORD_BLOCKED`) |
| AC-AG2-4 | shared-types 단위 + 통합(400) |
| AC-AG2-5 | 통합(저장 직후 1턴 — 같은 인스턴스) |
| AC-AG2-6 | 통합(시험하기 전후 쓰기 쿼리 0 · 감사 행 수 불변) |
| AC-AG2-7 | 통합(버전 캡처 본문·승격·토픽 분리 결과에 규칙 0) + GR-12 |
| AC-AG3-1 | 통합(TC-36 입구 — 엔진 스파이 0 · RAG 0 · 상태 보존 · 표식 · 이벤트 1) |
| AC-AG3-2 | 통합(금지어 BLOCK 우선 · 이벤트 0) |
| AC-AG3-3 | 통합(상담 개입 세션 — 상담원 전달 · 이벤트 0) |
| AC-AG3-4 | 통합(가짜 RAG 호출 수 0 · `ragGate` 슬롯 스파이 0 · 폴백 답) |
| AC-AG3-5 | 통합(`NODE` 버튼 라벨 = 표현 → 적용 0) |
| AC-AG3-6 | 측정 도구(§18.3) + CI 느슨한 상한 |
| AC-AG4-1 | 통합(가짜 RAG 대체 → `FAILED` · 출처 0 · 로그 · 이벤트) + 위젯 기존 `app.pending.spec.ts`(FAILED 처리 — 무수정 통과가 근거) |
| AC-AG4-2 | 통합(기록만 → `READY` 동일 · 이벤트 1) |
| AC-AG4-3 | 통합(FAQ 답 표현 포함 → 적용 0) |
| AC-AG4-4 | 통합(기본 종류 · 날짜 유지 · 이벤트 종류별 건수) |
| AC-AG4-5 | 통합(계좌 켬 + 날짜 보호) |
| AC-AG4-6 | 통합(종류 빈 배열 = 현행) |
| AC-AG4-7 | 단위(판정 예외 주입) + 통합(판정기 예외 픽스처 — 오류 이벤트 · 폴백) |
| AC-AG4-8 | 통합(시뮬레이터 `ragPreview` · 이벤트 0) |
| AC-AG5-1 | GR-4(schema) + 통합(이벤트 행 전 컬럼에 입력 문장 부분 문자열 0 · 서버 로그 캡처 검사) |
| AC-AG5-2 | 통합(현황 합계 = 이벤트 합) |
| AC-AG5-3 | 통합(대체 턴 포함 기간의 `/stats/distribution` — `FALLBACK = unanswered` 불변식 · 기존 통계 시험 무수정) |
| AC-AG6-1 | 통합(ADMIN 1명 → `409 APPROVAL_POLICY_UNAVAILABLE`(`NOT_ENOUGH_APPROVERS`)) |
| AC-AG6-2 | 통합(`prod/switch` 409 · 요청 생성 · 포인터 불변 · 감사) |
| AC-AG6-3 | 통합(요청자 승인 → 403 + `PERMISSION_DENIED`) |
| AC-AG6-4 | 통합(B 승인 → 게이트 재평가 · 전환 · 이력 표식 · 감사 2) |
| AC-AG6-5 | 통합(요청 후 단독 롤백 → 승인 `409 APPROVAL_BASE_CHANGED`) |
| AC-AG6-6 | 통합(시계 주입 · 만료 → 409 · 상태 `EXPIRED`) |
| AC-AG6-7 | `prod-switch-approval-schedule`(`tick()`) |
| AC-AG6-8 | 통합(직전 롤백 즉시 · `SOLO_ROLLBACK` · 감사 · 현황 알림) |
| AC-AG6-9 | 통합(정책 끔 → 대기 `CANCELLED(POLICY_OFF)` · 전환 0) |
| AC-AG6-10 | 통합(모드 꺼진 챗봇 → `409 APPROVAL_POLICY_UNAVAILABLE`(`ENV_MODE_DISABLED`)) |
| (추가) 끄기 차단·비직전 롤백·동시 요청·승인 경합 | `prod-switch-approval.integration` |

### 18.7 봉인 시험(`guardrails/lib/guardrail-sealing.spec.ts` — GR-1~GR-14)

GR-1(AG-3 모델·외부 심볼 0) · GR-2(AG-4 쓰기 유일 파일) · GR-3(AG-5 자산 쓰기·심볼 0) · GR-4(AG-6 문장 컬럼 0 — schema 파싱) · GR-5(AG-7 `kinds:`·`preserveDates:` 호출 파일 1) · GR-6(AG-8 판정·기록 호출 위치·횟수) · GR-7(AG-9 금지 문자열) · GR-8(AG-10 엔진·위젯·ml-worker 토큰 0) · GR-9(AG-11 강제 지점 순서·tx 안 `claim(`) · GR-10(AG-12 CAS where) · GR-11(AG-13 로그 식별자) · GR-12(AG-14 스냅샷·복사·승격 토큰 0) · GR-13(AG-15 예약 모듈 변경 1파일 — `approval` 쓰기 0) · GR-14(AG-18 `banned-words/**`에 `guardrail` 토큰 0). 각 항목에 **역검증**(위반 픽스처를 헬퍼가 실제로 잡는지 — 기존 봉인 선례) 1개씩.

---

## 19. 구현 체크리스트

> 2026-09-30 구현 완료 — 항목 전부 완료 표시(편차는 §26 I-n 참조).

### 19.1 `backend-implementer`(순서 = 커밋 단위 권고)

**커밋 ① — `pii-mask` 골든 선행 + 선택 인자**
- [x] **먼저** 골든 말뭉치·기대값(PARTIAL·FULL)을 **현행 함수로 생성해 커밋**(구현 변경 0인 커밋) → 그 다음 선택 인자 구현(§7.2 — 기존 본문 무수정 · 첫 줄 분기) · `PiiKind` export · 동등성·골든·출구 시험.

**커밋 ② — 스키마·계약**
- [x] Prisma 4모델 + 컬럼 5 + 역참조 · 마이그레이션 생성 후 SQL 검토(재정의·`DROP INDEX` 0) · `migrate deploy` 적용 · 원시 부분 유니크 4행 확인.
- [x] shared-types: `guardrails.ts`·`prod-switch-approval.ts` · 오류 코드 +6 · 감사 대상 +2(+라벨) · 예약 실패 사유 +1(+라벨) · 미리보기·이력·시뮬레이터·지도 선택 필드 → `pnpm --filter @chat-bot/shared-types build`.
- [x] `env.validation.ts` 5변수(`envBoolean()` · 범위).

**커밋 ③ — 가드레일 런타임·관리**
- [x] `guardrails/lib/*` 순수 함수 + 단위 시험.
- [x] 런타임 모듈(캐시 3층 · 로더 · 이벤트 writer · 서비스 — 예외 비전파).
- [x] 관리 모듈 13 핸들러 · 저장소 2 · 감사 화이트리스트 · `@AuditView` · 열람 감사 목록 +1 · 데이터 지도 키.
- [x] `chatbots.service.ts` 동반 삭제 +4 · X-3.

**커밋 ④ — 대화 경로 결합**
- [x] `public-conversation.service.ts` ③.6 · NO_RAG 결합 · 20번째 선택 인자 · `conversation.module.ts` import.
- [x] `conversation-log.service.ts` `guardrailStage` · `conversation-log.port.ts` 선택 필드.
- [x] `rag-answer.service.ts` 출구 1지점 · `finishAsFallback` 선택 인자 · 6번째 선택 인자 · `rag.module.ts` import.
- [x] `simulation.service.ts` 입구·출구 표시 · 선택 인자 · 모듈 import.
- [x] 통합 시험(가드레일 · 쿼리 수 · 바이트 동일).

**커밋 ⑤ — 2인 승인**
- [x] `environment/core`: `approval-policy.ts` · `getPointerStatus.approval` · writer `updateApprovalPolicy`·`switchProd` 선택 필드 · `ProdSwitchService` 강제 지점·tx 선점·`preview.approval` · 이력 조회 `approvalMode`.
- [x] `environment-mode.service.ts` 끄기 차단·미리보기 필드.
- [x] `environment/approval/**` 서비스·저장소·컨트롤러 2 · 모듈 등록(+`BannedWordsModule`) · 감사.
- [x] `deploy-schedules/lib/outcome-classifier.ts` 1분기.
- [x] X-1(E-14) · 통합 시험 2파일 · 봉인 GR-9·GR-10·GR-13.

**공통**
- [x] 봉인 `guardrail-sealing.spec.ts`(GR-1~GR-14 + 역검증) · X-2.
- [x] 로그 규약(AG-13 · E-13) · 서버 로그에 문장·표현·사유 0.
- [x] 성능 측정 도구 실행·기록(§18.3).

### 19.2 `frontend-implementer`

- [x] ui-spec 확정 후: 안전 가드레일 탭(규칙 목록·편집·시험하기·가림 설정 · 현황·이벤트) · 환경 탭 보강(정책·요청·대기 카드·롤백/끄기 버튼 분기·이력 표식) · 전역 승인 대기 화면 + 내비 배지 · 예약 폼/목록 보강 · 시뮬레이터 패널 보강 · 메시지 상수(분류·동작·상태·실패 사유·감사 대상 라벨).
- [x] 접근성(NFR-AGA) · 문구 "환각" 0(AG-16 vitest) · 자기 요청 버튼 비활성 + 이유.

### 19.3 `ml-engineer` — **불필요**

- 규모 A는 모델·임베딩·생성 호출이 0이고(P-1·P-4), ml-worker 코드·계약·설정 변경이 0이다(AG-1). 규모 B·C(판정자)는 사용자가 하지 않기로 확정했다.

### 19.4 `test-automation`

- [x] §18.2 통합 5파일 · §18.6 매핑 전부 자동화 · X-4 해당 파일 발견 시 기록 · §18.3 측정 결과 기록 · 시험 문서(패치 M-1·M-2) 반영.

---

## 20. 알려진 제한

| # | 제한 | 완화 |
|---|---|---|
| K-1 | 표현 목록 매칭이라 띄어쓰기 삽입·은어·오타·다른 언어 우회를 막지 못한다(EX-AG-2·3) | 화면 한계 안내 · 관찰 후 표현 추가 · 의미 기반 탐지는 재검토 트리거 |
| K-2 | 환각(답이 근거와 다른 내용)을 판정하지 않는다 | 규모 C 제외(사용자 확정) · 화면·영업 문구 금지 · 👎 검토 큐(H-3) |
| K-3 | 카드 정규식은 14~16자리 연속 숫자(주문번호·고객번호)도 `[카드번호]`로 가린다 — 출구 가림 기본 켜짐이라 RAG 답에서도 발생 | 챗봇별로 카드 종류를 끌 수 있다(거버넌스 모드 제외) · U-1 |
| K-4 | 다중 인스턴스에서 규칙 변경은 다른 인스턴스에 TTL(기본 60초) 뒤 반영 | 금지어 캐시와 같은 수준 · TTL 설정 |
| K-5 | 출구 대체 턴에 위젯 상태 문구 "지금은 답변을 준비하지 못했어요."가 함께 보인다 | 위젯 변경 0 원칙 — 위젯 개정 시 문구 분기 재검토 |
| K-6 | 버전 읽기 실패 폴백 턴(모드 켜짐 · 드묾)에서는 입구 판정을 하지 않는다(C-4) | 그 턴은 엔진·RAG도 부르지 않는 고정 문구라 위험 답 경로가 없다 |
| K-7 | 출구 규칙·"AI로 보내지 않음"은 규칙 기반 답(관리자 답)을 막지 않는다 — 위험 질문이 FAQ에 매칭되면 FAQ 답이 나간다(입구 "대체"만 엔진 전에 막는다) | 입구 규칙을 "대체"로 두면 엔진 전 차단 |
| K-8 | 가드레일로 막힌 질문도 미응답 큐에 들어간다(C-14) | 관리자가 무시 처리 또는 안전한 FAQ 작성(해결 경로) |
| K-9 | 예약 재개(`resume`)로 기준이 바뀌면 기존 승인이 무효 — 새 요청 필요 | 화면 안내 |
| K-10 | 이벤트 자동 삭제 없음 | 문장 0 · 행 수 문제 시 재검토 |
| K-11 | 입력에 사설 영역 문자(U+E000~U+E1FF)가 있으면 선택 가림이 5종 전부 가림으로 떨어진다 | 실데이터에 거의 없음 · 과탐 쪽 |
| K-12 | 승인 정책 끄기는 1인 동작(감사) — 악의적 관리자 방어가 아니다 | `ENV_APPROVAL_OFF_LOCKED` · 감사 · 현황 표시 · **2026-10-01: 거버넌스 모드 ON 기본 잠금(ADR-0049 §2)** |
| K-13 | 원본 PDF(ROCHA)에 가드레일·승인 관련 화면이 있는지 미확인(요구사항 조사 한계 ①) | 확인되면 표시 문구만 보완(저장 구조 무관) |
| K-14 | 생성형 AI 고지(FR-AG8) 없음 | 법무 확인 후 결정(P-11) |

---

## 21. 요구사항 대비 해석 · 조정

| # | 요구사항 | 이 설계 | 이유 |
|---|---|---|---|
| **R-1** | FR-AG3-7 "시뮬레이션·**TC 실행**에서 같은 판정 표시" | **시뮬레이터만** · TC 실행 표시는 규모 B로 이월 | 검증 실행기·결과 테이블·봉인 변경이 필요하고, 의미상 안전 점검 세트(규모 B — 제외 확정)와 함께 설계해야 한다(C-6) · **U-4** |
| **R-2** | FR-AG3-6 "대체 규칙이 켜진 챗봇은 폴백, 아니면 원답 + 오류 이벤트" | + **개인정보 가림이 켜진 챗봇(기본)도 폴백** | 가림을 확인 못 한 답을 내보내는 것도 같은 위험 · 가림 기본 켜짐(P-6) |
| R-3 | (규정 없음) 한 번도 적재 못 한 프로필 | 입구 통과 · **출구 폴백** | NFR-AGR1(입구 통과) + RAG는 선택 단계라 폴백 비용이 작다 |
| **R-4** | FR-AG3-7 "미리보기에서 원답도 함께" | 원답은 **저장 마스킹본**으로 표시 | 원문 개인정보를 관리자 화면에 새로 노출하지 않는다(ADR-0013) |
| **R-5** | FR-AG2-3 "금지어 BLOCK 선례" | 상태·로그는 BLOCK 모양 + **관찰 창 힌트 추가** | 출구 대체(`FAILED`)가 관찰 창을 여는 것과 대칭 · 위기 질문의 상담 연결 · **U-5** |
| **R-6** | FR-AG5-5 "예약 생성이 요청이 된다" | 예약 생성은 그대로 + **콘솔이 이어서 승인 요청** · 실행 시 강제(없으면 `APPROVAL_MISSING`) · 요청자 = 예약 작성자 | 순환 의존·예약 쓰기 봉인(C-11) · fail-closed라 안전성 동일 |
| **R-7** | (요구사항에 없음) | 정책이 켜진 동안 **환경 모드 끄기 거부** | 끄는 순간 초안이 라이브(C-10) — 승인 관문의 옆문 · **U-2** |
| **R-8** | FR-AG5-6 "직전 운영 버전 롤백은 예외" | 예외 = `pickRollbackTarget()` 결과와 같은 대상만 · 그 밖의 이력 버전 롤백은 요청 필요 | 기존 롤백 API가 임의 이력 버전을 받고 게이트 BLOCK을 면제한다(C-9) · **U-3** |
| **R-9** | FR-AG9-2 "거버넌스 모드에서 끄기를 환경변수로 막을 수 있게" | `ENV_APPROVAL_OFF_LOCKED`는 **모드와 무관** | 운영자가 명시적으로 켜는 잠금 — 모드에 묶을 이유 없음 · **U-7** · ⚠ **2026-10-01 부분 번복**: 미설정일 때의 기본값은 거버넌스 모드에 연동(ON = 잠금) · 명시값 우선(ADR-0049 §2) — FR-AG9-2 원문에 더 가까워짐 |
| **R-10** | (요구사항에 없음) | 거버넌스 모드 ON이면 **주민번호·카드 출구 가림을 끌 수 없음** | No.45 P-4 "마스킹 약화는 환경변수만" · **U-6** |
| R-11 | EX-AG-20 "저장 강도와 출구 가림은 독립" | **종류는 챗봇별 · 강도는 `PII_MASK_MODE`** | FULL 서버의 의도(더 강하게)를 출구에서 약화하지 않는다 |
| R-12 | EX-AG-1 "2글자 미만 거부 권고" | 채택 + **EXACT 다단어 표현 거부** | `detect()` 토큰 비교 성질(C-1) — 영원히 맞지 않는 규칙 방지 |
| **R-13** | FR-AG4-2 "적중 행 → 기존 대화 기록 열람으로 이동" | 이벤트 목록 응답에 **로그 마스킹본을 싣고** 거버넌스 모드 `VIEW` 감사 | 기존에 대화 1건 열람 화면이 없다(C-13) |
| R-14 | FR-0-298 "가림 꺼짐이면 바이트 동일" | 가림 **기본 켜짐** — 기본 상태에서 RAG 답에 주민번호·카드 형식이 있으면 바뀐다(의도된 변화) · 가림을 끄면(빈 배열) 바이트 동일 | P-6 확정 · 바이트 동일 시험은 "종류 빈 배열" 조건으로 |
| R-15 | AC-AG2-5 "TTL을 기다리지 않고" | 같은 인스턴스 기준 | K-4 |
| R-16 | FR-AG5-4 "챗봇당 대기 최대 1건(권고)" | 예약 전환 요청 포함 **1건** | 단순성(ADR-0048 감수 비용 9) |
| R-17 | NFR-AGR3 "조회 시 판정 또는 예약 루프" | **조회·변경 시 판정 + CAS 종결**(루프 0) · 만료 감사는 종결 시점 | 새 루프·다중 인스턴스 경합 회피 |
| R-18 | (요구사항에 없음) | 서버 스위치 `GUARDRAILS_ENABLED` | 운영 사고 시 긴급 차단(선제 안내 `PROACTIVE_ENABLED` 선례) |
| R-19 | FR-AG2-3 "표식 방식 architect — `blockedByFilter`와 구분" | 새 컬럼 `guardrailStage`(단계 값) | 금지어 차단 의미(큐 제외·평가 제외) 오염 방지 |
| R-20 | FR-AG5-3 "승인 시 게이트 재평가" | + **경고 재계산 · 승인자가 경고 확인** | 승인자가 본 적 없는 경고로 전환하지 않는다(기존 `acknowledgeWarnings` 규약) |
| R-21 | FR-AG5-2 "요청 = 전환 API가 202로 응답(architect)" | **별도 요청 경로** · 기존 전환 API는 409 | 기존 응답 스키마 불변 · 프런트 분기 단순 |
| R-22 | (요구사항에 없음) 예약 요청 만료 | `min(요청 + TTL, 예약 시각)` | 예약 시각 뒤 승인은 의미 없음 |

---

## 22. 새로 발견한 기존 결함 · 관찰

| # | 내용 | 영향 | 처리 |
|---|---|---|---|
| **D-1** | `POST …/environment/prod/rollback`이 **운영 이력의 아무 버전**을 대상으로 받고(`isSwitchTargetAllowed` ROLLBACK 분기), `ROLLBACK`은 게이트 BLOCK을 WARN으로 낮춘다(`gate.ts` 33행) — "롤백"이라는 이름으로 수 단계 전 버전으로 **차단 게이트 없이** 전환할 수 있다 | 2인 승인이 없는 챗봇에서도 차단 게이트의 우회로(의도는 "긴급 복귀") | 이번 그룹은 정책 켜진 챗봇에서만 좁힌다(R-8). 정책 꺼진 챗봇의 롤백 대상 범위 재검토는 No.40 후속 과제로 인계(U-8) |
| **D-2** | 시뮬레이터가 외부 RAG를 부르면서 **답 문장을 돌려주지 않는다**(`MatchTraceSchema` — `ragUsed`·지연·출처 수만). ADR-0022 "실제 답변 품질은 시뮬레이터에서 수동 확인해야 한다"는 전제가 성립하지 않았다 | 관리자가 RAG 답 품질을 볼 수단 0 | 이번 `ragPreview`로 해소(§9) — ADR-0022 갱신 각주 |
| **D-3** | 환경 모드 끄기 `PROMOTE_DRAFT`는 초안을 **TC 게이트 평가 없이** 즉시 라이브로 만든다(`disable-plan.ts` — 게이트는 전환에만) | 차단 게이트를 켠 챗봇도 "끄기"로 게이트를 건너뛸 수 있다 | 이번 그룹은 2인 승인 켜진 동안 끄기 차단(R-7). 게이트 관점의 재검토는 No.40 후속 인계(U-8) |
| **D-4** | 위젯의 보류 `FAILED` 상태 문구가 사유와 무관하게 "지금은 답변을 준비하지 못했어요."로 고정 — 가드레일 대체(정상적인 안전 안내)에도 뜬다 | 문구 어색함(기능 결함 아님) | K-5 · 위젯 개정 시 |

---

## 23. 사용자 확인이 필요한 판단

| # | 판단 | 이 설계의 기본 | 다른 선택 |
|---|---|---|---|
| **U-1** | 출구 가림 기본 켜짐이 **배포 즉시 모든 챗봇**에 적용 · 카드 정규식이 14~16자리 연속 숫자(주문번호 등)도 가림 | 그대로(P-6) | 기존 챗봇은 가림 꺼짐으로 시작(마이그레이션 시 기존 챗봇 행에 빈 배열 기록) |
| **U-2** | 2인 승인 켜진 동안 **환경 모드 끄기 금지** | 금지(옆문 차단) | 끄기 허용 + 감사만 |
| **U-3** | 롤백 예외 = **직전 운영 버전만** | 직전만 | 운영 이력 전체 예외(요구사항 문자 그대로 — 1인 우회로 남음) |
| **U-4** | TC 실행의 가드레일 판정 표시를 이월(시뮬레이터만) | 이월 | 이번에 포함(검증 실행기·결과 테이블 변경 · 개발량 +소) |
| **U-5** | 입구 대체 턴에 상담 관찰 창 힌트 제공 | 제공 | 금지어처럼 힌트 없음 |
| **U-6** | 거버넌스 모드에서 주민번호·카드 출구 가림 끄기 금지 | 금지 | 허용 |
| **U-7** | `ENV_APPROVAL_OFF_LOCKED`를 거버넌스 모드와 무관하게 적용 | 무관 → **2026-10-01 PM: 명시값은 무관 · 미설정 기본값은 거버넌스 모드 ON이면 잠금**(ADR-0049 §2) | 거버넌스 모드일 때만 |
| **U-8** | D-1·D-3(정책 꺼진 챗봇의 롤백 범위·끄기 게이트 우회)을 No.40 후속으로 고칠지 | 인계만(이번 변경 0) | 이번에 롤백 대상 제한·끄기 게이트 평가 추가 |

---

## 24. 상위 문서 패치

`docs/02-spec/ai-guardrails-patches.md`(55건) — 개발명세서(§2·§2.2·§3·§3.1·§4·§5·§5.1·§6 결정 21·27 갱신 + 결정 49·§7) · 기능요구사항(19·78·94행) · ADR-0013·0015·0022·0023·0031·0039 · `data-governance-설계.md` · `environment-separation-설계.md` · `scheduled-deploy-설계.md` · `자동배포.md` §5.10 · (test-automation 소관) 시험항목·시험데이터 · (선택) 선행 요구사항 문서 종결 표시 · (선택) 요구사항 PM 확정 기록. **`CLAUDE.md`는 대상이 아니다.**

---

## 25. 변경 이력

- **2026-09-30 작성** — system-architect. 사용자 확정(규모 A · 2인 승인 범위 · 가림 기본 주민번호·카드 · 모델 0) 반영. 코드 확인으로 제약 14건(C-1~C-14) · 기존 결함·관찰 4건(D-1~D-4) 발견. 결정: `detect()` 무수정 재사용 + 캐시 3층(규칙 없는 챗봇 쿼리 0) · 입구 ③.6 / 출구 절단 직후 · 대체 = `FAILED` 수렴 · 이벤트 + `guardrailStage` · `pii-mask` 선택 인자 2(기존 본문 미경유 분기 · 골든 선행) · 2인 승인 = `ProdSwitchService.switch()` 1곳 강제 · 포인터 CAS + 요청 선점 같은 tx · 직전 롤백 예외 · 정책 켜짐 중 끄기 차단 · 예약은 실행 시 강제(`APPROVAL_MISSING`) · 신규 권한 0 · 감사 대상 +2 · 오류 코드 +6 · 환경변수 5 · 닫힌 목록 3 + 조건부 1 · GPU 5 → 1.

## 26. 구현 편차 기록 (구현 후 작성)

> backend/frontend 구현 중 이 설계와 달라진 점을 **I-n**으로 기록한다(성능 측정 결과 · X-4 해당 파일 포함).

### 26.1 백엔드 구현 편차 (I-1 ~ I-12)

| ID | 항목 | 구현 결과 | 사유 |
|---|---|---|---|
| I-1 | `SwitchApprovalService` 시각 원천 | `CLOCK` 포트 사용. `EnvironmentModule`에 `{ provide: CLOCK, useClass: SystemClock }` 추가 | 예약 실행기와 만료·예약 판정 시각을 한 오버라이드로 맞추기 위함 |
| I-2 | `ProdSwitchService` 헬퍼 | `isDirectRollbackTarget` 추가 | `preview.approval.soloRollbackAllowed` 산출용 |
| I-3 | 현황 집계 쿼리 수 | 8개(설계는 6개 이하). 규칙 목록(현재 이름·동작)·`chatbotEnvironment`(hitl) 추가, `groupBy` 키에 `decisive`·`effect` 추가. 개인정보 이벤트는 턴당 첫 행만 `decisive=true`로 두어 '가려진 답 수'를 턴 기준으로 집계 | 이름·동작은 현재값 표시, 턴 단위 중복 집계 방지 |
| I-4 | `toRagPreview` 조립 위치 | 런타임 서비스에 두고 `GuardrailRuntimeModule`이 `BannedWordsModule`(잎 모듈)을 import. 시뮬레이터는 `evaluateOutbound(` 1회 + `toRagPreview(` 호출(GR-6 횟수 유지) | 순환 의존 회피 · 봉인 유지 |
| I-5 | `GuardrailTestResponse.resultText` | 출구 판정이 `FALLBACK`이면 빈 문자열 | ui-spec §17.1 가정과 일치 |
| I-6 | 오류 세부 규약 | `ApiException.details`는 `[{field,message}]` — `field`는 `reason`·`status`·`requestId`·`requestStatus`·`outcome`, `message`가 값. 검증 오류 코드 `TOO_SHORT`·`EXACT_MULTI_TOKEN`·`NOT_PLAIN_TEXT`·`TOO_MANY_LINES`·`GOVERNANCE_FLOOR`는 `message`가 `<CODE>: 설명` 형식(프런트는 `startsWith`로 분기) | 기존 details 형식 재사용 |
| I-7 | `EnvironmentStatus.approval` | 정책이 켜졌을 때만 키가 실림(꺼짐이면 키 생략 → 기존 응답 바이트 동일). 꺼짐 상태 TTL은 `GET …/environment/approval` | 바이트 동일 원칙 |
| I-8 | 전환 이력 항목 | `approvalMode`·`approvalRequestId`는 값이 있을 때만 키가 실림 | 바이트 동일 원칙 |
| I-9 | `ConversationLog.guardrailStage` | `record()`에서 `?? null`로 항상 씀 | 컬럼 기본값 의존 제거 |
| I-10 | 성능 실측(§18.3) | 개발 PC, Node v24.19.0 win32, 2026-09-30, 규칙 50·표현 2,000·입력 500자·답 2,000자, 1만 회. 입구 P50 0.40 / P95 0.46 / P99 0.59ms(목표 P95 ≤ 1ms), 출구(가림 포함) P50 0.98 / P95 1.12 / P99 1.33ms(목표 ≤ 5ms) — **합격**. CI 상한 시험은 입구 5ms·출구 25ms. 규칙 없는 챗봇 첫 턴 쿼리 17 불변, 규칙 있는 챗봇 콜드 첫 턴은 가드레일 조회 2건, 캐시 적중 턴 0건 | — |
| I-11 | 선택 권고 처리 | A-3(설정 `serverEnabled?`, 현황 `serverEnabled`; `ragActive`는 규칙 목록 meta만)·A-8·A-9 적용. **A-7(예약 항목 `approvalState`)은 봉인 AG-15(변경은 `outcome-classifier` 1파일)와 충돌해 미적용** — 프런트가 `GET …/environment/approval`의 `recent`·`pending`과 요청 상세로 합성 | 봉인 우선 |
| I-12 | `pii-mask` | 선택 인자 `kinds`·`preserveDates`. 골든 말뭉치(306문장)는 구현 전 함수로 먼저 생성 — HEAD 구현과 대조 시 불일치 0건(코드 리뷰 검증). 자리표시 문자는 사설영역(U+E000~E1FF)이며 입력에 사설영역 문자가 있으면 `null`을 반환해 기존 5종 전체 가림으로 fail-closed | 골든 선행 원칙 · 자리표시 충돌 방지 |

**커밋 순서 주의(I-22)**: `pii-mask` 골든 말뭉치를 구현보다 먼저 커밋한다(또는 같은 커밋에 묶고 '골든이 HEAD 구현과 306건 일치' 검증을 커밋 메시지에 남긴다).

**의도된 기존 시험 변경 확인(§18.5)**: `environment-sealing` E-14(승인 컨트롤러 2개 허용) · `governance-sealing` G-15(12→13) · `chatbots.service.spec`(30→34). 조건부 새 컬럼 키 추가 시험(X-4)은 해당 파일이 없어 변경 0건.

### 26.2 프런트 구현 편차 (I-13 ~ I-17)

| ID | 항목 | 구현 결과 |
|---|---|---|
| I-13 | `Modal.tsx` 공용 수정 | `onClose`·`closeOnEsc`·`initialFocusSelector`를 ref로 들고, 초기 포커스는 열릴 때·대상이 뒤늦게 나타날 때만 이동(모달 안 입력 중 포커스가 취소로 돌아가던 기존 결함 수정). 회귀 시험 `Modal.focus.spec.tsx` |
| I-14 | 화면 문구 | '가드레일'은 탭·페이지 제목 1곳만. 설계서 §3.2·§3.3·§9.4·§10.2 문구를 원칙에 맞게 변경(서버 꺼짐 배너·셸 로드 실패·단독 롤백 안내·데이터 지도 제목). 문자열 스캔 시험이 가드레일·환각·hallucination·편향 없음·RAG·PII·마스킹·이벤트·입구·출구 0건을 단언 |
| I-15 | 제목·접근성 | 셸 h1 하나, 하위 화면 제목은 `h2 tabIndex=-1`. 이메일 라벨은 shared-types 상수('이메일'). 토스트가 aria-live이므로 삭제·가림 저장·승인 정책 변경은 별도 sr-only 알림을 겹치지 않음. `useApprovalPolicy`는 공유 캐시 없이 화면별 조회 |
| I-16 | AP-2 상세 라우트 | `chatbot:deploy` 대신 `chatbot:read`로 감쌈(API 조회 권한과 일치), 승인·반려·취소 컨트롤은 화면 안에서 `chatbot:deploy`로 재차 가림. 이력에 '요청 보기' 링크(`approvalRequestId` 존재·배포 권한 시에만, §9.11 링크 금지 조정) |
| I-17 | 현황 규칙별 표 | `appliesTo`·기록만 횟수가 응답에 없어 [규칙·현재 동작·사용자 질문에서 걸린 횟수·AI 답변에서 걸린 횟수·답이 바뀐 횟수·걸린 기록 보기]로 구성. 승인 유효 시간 변경 버튼은 끄기 잠금 중에도 표시 |

### 26.3 미해결 · 후속 (I-18 ~ I-21 — ADR-0048 '알려진 한계'와 동일)

- **I-18 (M-1)** 정책 끄기가 1인 동작이라 `chatbot:deploy` 보유자가 끄고 → 직접 전환 → 켜기로 우회 가능(절차 통제이며 악의적 관리자 방어 아님, 감사·현황 표시는 남음). 후속: 거버넌스 모드 ON에서 `ENV_APPROVAL_OFF_LOCKED` 기본 잠금 또는 끄기 감사 알림 강화. → **2026-10-01 해소(PM 결정 · ADR-0049 §2 · `pm-decisions-2026-10-01-설계.md` §3)** — 거버넌스 ON 기본 잠금 · 명시값 우선.
- **I-19 (M-2)** 우회 표현 방어가 약함: `normalizeText`는 NFKC·소문자·공백 축약만이라 제로폭 문자(U+200B~200D, U+FEFF)·삽입 문자로 CONTAINS 매칭 회피 가능(띄어쓰기 삽입은 설계 K-1·EX-AG-2 한계). 금지어와 정규화를 공유하는 원칙이라 금지어 정규화 개선과 함께 후속.
- **I-20 (L-1~L-5)** L-1 GET 조회(`summary`·`getStatus`·`listGlobal`)가 만료 sweep으로 쓰기를 일으키고 `ApprovalNavLink`가 60초마다 전역 목록을 읽음(챗봇 수가 크게 늘면 부하). L-2 직전 버전 단독 롤백은 A↔B 반복 토글 가능(`SOLO_ROLLBACK` 감사·경고는 남음, 설계 U-3 수용 · **2026-10-01 PM 수용 — 코드 변경 없음**, ADR-0049 §3). L-3 시뮬레이터 미리보기의 2,000자 절단이 `rag-answer.service`의 비공개 `truncateAnswer`와 중복. L-4 `Modal` 두 번째 이펙트가 `initialFocusSelector`가 있는 대화상자에서 포커스가 밖(중첩 포털)으로 나간 상태로 재렌더되면 되돌림. L-5 챗봇 영구삭제 시 가드레일 캐시가 TTL(60초)까지 남음(영향 없음). 또한 이벤트·대화 기록이 독립적 fire-and-forget이라 한쪽만 실패하면 이벤트 목록의 `conversation`이 null(화면은 null 처리).
- **I-21** H9(지식베이스 첫 적재) 바로가기는 기능 꺼짐 여부를 확인하지 않고 `security:read`만으로 링크(§7.5 미구현). TC 실행·회귀 화면의 가드레일 표시는 규모 B로 이월.

## 27. 갱신 (2026-10-01 — PM 결정 · ADR-0049)

세부: `docs/02-spec/pm-decisions-2026-10-01-설계.md` §3(N36-1) · §4(L-2) · §5(L-5).

| # | 항목 | 변경 |
|---|---|---|
| X-1 | 끄기 잠금(§14 · §15 · R-9 · U-7 · K-12 · I-18) | 3상태 · 명시값 우선 · 미설정 + 거버넌스 ON = 잠금 · `offLockedBy?` · 기존 시험 기대값 변경 1건(`env.validation.guardrails.spec.ts` 기본값) |
| X-2 | `pii-mask` 바이트 불변(AG-7 · §7) | 날짜 구간 제외(생년월일 문맥 예외 — U-1 확정 2026-10-01) · `preserveDates` 생략 = true · 기존 시험 기대값 변경 4건(문맥 예외 반영 후 재산정 — 증감 없음)(골든 JSON 날짜 케이스 · `index.selective.spec.ts` 1줄 · `ai-guardrails-parity.golden.ts` 1값 · 골든 시험 주석) |
| X-3 | L-2(I-20) | PM 수용 · 변경 0 |
| X-4 | §18.5 닫힌 목록 | 이 갱신의 변경은 §18.5에 더하지 않고 `pm-decisions-2026-10-01-설계.md` §3.8 · §5.11을 기준으로 한다 |
