# 통계/분석(No.14~15) 시험 결과 보고서

> **대상**: `docs/requirements/stats-learning.md`(No.14 기본 통계, No.15 학습현황·관리자 보조 재학습) + `docs/02-spec/stats-learning-설계.md`(DD-49~67, K-1~K-6 인계 계약) + `docs/03-design/stats-learning-ui-spec.md`
> **시험 수행일**: 2026-09-22 · **수행**: test-automation
> **선행 상태**: backend-implementer(`apps/api` stats 확장 + learning 신규모듈, `packages/shared-types`)/frontend-implementer(`apps/web` 통계 탭 2종 + 학습현황 화면) 구현 완료, code-reviewer **1차(Medium 2건 → frontend-implementer 수정 완료) + 2차(확인, Critical/High 0건)** 리뷰 완료. 2차 리뷰가 인계한 시험 공백 6건을 이번 시험에서 처리했다.
> **범위**: `apps/api`(통합 스펙 8개 `it` 순증 + 신규 단위 스펙 2개, 6 tests), `apps/web`(신규 컴포넌트 스펙 2개, 16 tests), `packages/dialogue-engine`/`apps/widget`(회귀 재확인만, 변경 없음)

---

## 1. 요약

| 구분 | 이전(baseline) | 이후 | 비고 |
|---|---|---|---|
| `apps/api` 테스트 | 39 suites / 342 tests, 전부 Pass | **41 suites / 356 tests**, 전부 Pass | `stats-learning.integration.spec.ts` +8 tests(net), 신규 `unanswered-collector.service.spec.ts`(5) + `learning-apply-invalidate-callsite.spec.ts`(1) |
| `apps/web` 테스트 | 33 files / 137 tests, 전부 Pass | **35 files / 153 tests**, 전부 Pass | 신규 파일 2개(16 tests) — `LearningQueuePage.spec.tsx`(6, M-1 회귀) + `ResolveModal.spec.tsx`(10, M-2 회귀) |
| `packages/dialogue-engine` 테스트 | 10 suites / 72 tests, 전부 Pass | 10 suites / **72 tests**, 전부 Pass | 변경 없음(J-5 — 엔진 무수정 재확인) |
| `apps/widget` 테스트 | 5 suites / 26 tests, 전부 Pass | 5 suites / **26 tests**, 전부 Pass | 변경 없음(F-13 — 위젯 무영향 재확인) |
| 타입체크 | — | `apps/api`/`apps/web` 둘 다 clean | 신규 스펙의 타입 오류 0건 |
| **합계** | 87 suites/files, 577 tests | **91 suites/files, 607 tests** | 전부 Pass, **실패 0건** |

**결론**: 이번 시험에서 **실제 코드 결함(버그)은 발견되지 않았다.** code-reviewer가 인계한 6개 공백(① AC 전량 대조 확장 ② M-1/M-2 전용 회귀 테스트 부재 ③ `BulkResolveModal` 100건 제한 기록 ④ 감사로그 경계 검증 보강 ⑤ DD-55 K-1 구조적 회귀 장치 ⑥ dayBucket/hourBucket 백필 검증)를 전부 처리했다. 그 과정에서 기존 구현이 요구사항·설계 문서와 정확히 일치함을 확인했다. **③ 은 code-reviewer가 이미 Medium 백로그로 남긴 알려진 이슈**이며 이번 시험에서도 코드는 수정하지 않고 `시험항목.md`에 재확인·기록만 했다(§4).

---

## 2. 실행 커맨드 및 결과

```
pnpm --filter @chat-bot/api test               # 41 suites, 356 tests, 전부 Pass (~25s)
pnpm --filter @chat-bot/api typecheck           # clean
pnpm --filter @chat-bot/web test                # 35 files, 153 tests, 전부 Pass (~15s)
pnpm --filter @chat-bot/web typecheck            # clean
pnpm --filter @chat-bot/dialogue-engine test    # 10 suites, 72 tests, 전부 Pass (~6s)
pnpm --filter @chat-bot/widget test             # 5 suites, 26 tests, 전부 Pass (~2s)
```

실패 0건 / 스킵 0건. 이 그룹은 `apps/api`·`apps/web` 2개 워크스페이스에 코드를 추가했고, `packages/dialogue-engine`·`apps/widget`은 이번 그룹에서 코드를 변경하지 않았으므로(J-5, F-13) 재실행은 "영향 없음"을 확인하는 목적이다.

---

## 3. 코드리뷰 인계 공백 처리 (요청받은 6개 항목)

### 3.1 공백 ① — `apps/api` 통합테스트가 핵심 항목만 커버(AC 전량 대조)

`docs/requirements/stats-learning.md` §7의 AC 전량(AC-14A-1~13, AC-14B-1~9, AC-15A-1~11, AC-15B-1~19, AC-UI-1~10, AC-X-1~7)과 §8의 EX 전량(EX-14-1~12, EX-15-1~15)을 기존 통합 스펙(30개 `it`)과 대조했다. 자동화가 비어 있던 항목 중 **비용 대비 가치가 높은 5건**을 이번 시험에서 신규로 채웠다:

| AC | 신규 케이스 |
|---|---|
| AC-14A-3 | MONTH 단위 합계 = DAY 합계 총합 일치 |
| AC-14A-4 | KST 자정 경계(23:50/00:10) 로그가 서로 다른 일 버킷으로 집계 |
| AC-14A-5 | WEEK 버킷 월요일 시작 + `2026-W39(09/21~09/27)` 라벨 형식 |
| AC-14A-8 | 기간 미지정 시 단위별 기본기간(일30/주12/월12) |
| AC-15B-11 | 두 관리자의 동시 반영 요청 — 한쪽만 성공(200/409), 예문 중복 추가 없음(DD-63 CAS 검증) |

나머지 미자동화 항목(AC-14A-12, AC-14B-1/3/6/7/8 부분, AC-15A-4/8/10 부분, AC-15B-1, AC-UI-2/3/4/8, EX 일부)은 전부 "테스트 인프라 비용/우선순위" 사유이며 코드 리뷰·기존 단위시험으로 간접 확인했다 — 전체 매핑은 `시험항목.md`의 "통계/분석(No.14~15) 상세 시험항목" 표를 참고. 이 매핑표는 향후 `test-automation` 재투입 시 추가 자동화의 출발점이 된다.

### 3.2 공백 ② — M-1/M-2 코드리뷰 수정사항 전용 회귀 테스트 부재

| 수정사항 | 신규 파일 | 검증 내용 |
|---|---|---|
| **M-1** — `LearningQueuePage`의 하이라이트 카드 분기(목록에 있으면 미노출/없으면 액션 포함 렌더) | `apps/web/src/pages/learning/LearningQueuePage.spec.tsx`(6 tests) | 목록에 이미 있는 항목은 카드 미노출(중복 방지) / 없으면 반영·무시 버튼과 함께 노출(EDITOR) / PENDING이 아니면 되돌리기만 노출 / VIEWER는 액션 숨김(FR-C-6) / 카드에서 무시 클릭 → `refreshHighlightIfMatch()`로 상세 재조회되어 상태 갱신(IGNORED로 전환 확인) / `highlightId` 쿼리가 없으면 카드 자체가 렌더되지 않음 |
| **M-2** — `ResolveModal`의 디바운스 서버 검색(초기 100건 밖 의도 매칭 + 경쟁 조건 방지) | `apps/web/src/pages/learning/ResolveModal.spec.tsx`(10 tests) | 빈 입력 시 미검색 / 300ms 디바운스(그 전엔 호출 없음) / 검색 결과로 100건 밖 의도도 "기존 의도" 매칭 / **경쟁 조건 방지**(느린 1차 응답이 이미 표시 중인 2차 검색 결과를 덮어쓰지 않음, `latestSearchTermRef` 가드 검증) / 검색어 삭제 시 초기 목록 복귀 / 검색 실패 시 초기 목록 폴백 / 제출(기존 의도 intentId·신규 의도 intentName) / `LIMIT_EXCEEDED` 배너 / `ALREADY_RESOLVED` → `onAlreadyResolved` |

두 파일 모두 `vi.useFakeTimers({ shouldAdvanceTime: true })` + `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` 조합으로 디바운스 타이밍을 결정적으로 제어했다(§자동시험_전략.md §3.7.2 참고).

### 3.3 공백 ③ — `BulkResolveModal.tsx`의 의도 100개 제한 이슈

**코드는 수정하지 않았다**(지시사항 준수). `ResolveModal.tsx`는 M-2로 디바운스 서버 검색을 얻었지만 `BulkResolveModal.tsx`는 상위(`LearningQueuePage`)에서 1회 로드한 초기 100건 `intentOptions`로만 매칭한다 — 101번째 이후 의도를 대상으로 일괄 반영하면 이미 존재하는 의도를 "새 의도"로 오판해 **중복 생성될 수 있다**. `시험항목.md`의 "통계/분석(No.14~15) 상세 시험항목" 표 하단에 "⚠ 알려진 미해결 이슈"로 명시 기록했다(Medium, code-reviewer 2차 리뷰 백로그 유지).

### 3.4 공백 ④ — 감사로그 경계 검증(NFR-S8) 보강

기존 통합 스펙에 이미 AC-15B-17/19(resolve는 Intent 감사 1건 + 질문 원문 미포함)·AC-15B-18(ignore/reopen은 감사 기록 없음) 케이스가 있었다. 이번 시험에서 **일괄 처리(bulk-resolve)의 감사 경계**를 신규로 보강했다:

- 신규 케이스("AC-15B-12 보강/NFR-S8"): 미응답 질문 3건을 같은 신규 의도명으로 bulk-resolve하면, ① 첫 건은 의도 생성(CREATE) ② 나머지 2건은 예문 병합(UPDATE)로 **성공 건수(3)만큼 정확히 감사 레코드가 늘어나고**, 모든 레코드의 `summary`가 `"학습현황 일괄 반영"`을 포함하며, 감사 로그 전체 JSON에 미응답 질문 원문(`벌크감사질문...`)이 **전혀 포함되지 않음**을 확인했다.
- 이로써 `resolve`(단건)·`bulk-resolve`(일괄)·`ignore`/`reopen`(기록 없음) 3가지 경로 전부의 감사 경계가 자동시험으로 고정됐다.

### 3.5 공백 ⑤ — DD-55 K-1 구조적 회귀 장치

`apps/api/src/learning/learning-apply-invalidate-callsite.spec.ts`(신규)를 추가했다. `apps/api/src/learning` 디렉터리 전체(스펙 파일·주석 제외)를 재귀 스캔해 `.invalidate(` 호출이 **정확히 1건**이고 그 위치가 `learning-apply.service.ts`인지 구조적으로 검증한다. No.12~13 그룹의 `public-decorator-count.spec.ts` 전수 스캔 선례를 그대로 재사용했으며(신규 런타임 의존성 0건), 향후 `UnansweredQuestionsService` 등에 실수로 `bundleService`가 직접 주입되어 K-2(요청당 1회 호출)·K-4(`appliedImmediately` 하드코딩 금지)가 조용히 깨지는 것을 방지한다.

DD-55의 K-1~K-6 6개 계약 전체의 검증 방법·결과는 `시험항목.md`의 "DD-55 인계 계약(K-1~K-6) 검증" 표에 정리했다 — K-1은 이번에 구조 스캔으로 확정했고, K-3/K-5/K-6은 코드 리뷰(발생 경로 없음/명시적 API 부재 확인), K-2/K-4는 기존·신규 통합 케이스로 부분 검증된다.

### 3.6 공백 ⑥ — dayBucket/hourBucket 백필 검증

`apps/api/src/prisma.conversationLog.create` 직접 호출 2곳(통합테스트)과 `seed.ts`가 버킷을 올바르게 채우는지 확인했다:

1. **적재 시점 검증**(신규): 공개 대화 API로 메시지를 보내면 `ConversationLogService.record()`가 즉시 `dayBucket`(비어있지 않음)·`hourBucket`(0~23)을 채우는지 확인 — 센티넬(`""`/`-1`)이 남지 않는다.
2. **백필 스크립트 실행 검증**(신규): 마이그레이션 이전 상태를 재현하기 위해 센티넬 값(`dayBucket=""`, `hourBucket=-1`)을 가진 로그를 직접 INSERT한 뒤, 실제 `apps/api/prisma/scripts/backfill-conversation-buckets.ts`를 `execSync`로 테스트 DB에 대해 실행하고 `dayBucket`/`hourBucket`이 `toKstDayBucket`/`toKstHourOfDay` 결과로 정확히 채워지는지 확인했다(코드 조각이 아니라 **실제 스크립트 파일을 그대로 실행**).
3. **기존 2곳**(`chatbot-operations.integration.spec.ts:286, 551`)은 `createConversationLog` 헬퍼를 쓰지 않고 여전히 직접 `create()`를 호출하지만, 스키마 기본값(DD-64)이 있어 컴파일·실행 모두 그대로 통과하며 이 두 케이스가 통계 API를 조회하지 않으므로 센티넬이 실제 문제가 되지 않음을 코드 확인했다(NFR-M8 설계 의도 그대로).
4. `seed.ts`는 `toKstDayBucket`/`toKstHourOfDay`를 그대로 import해 사용함을 코드 확인했다(§13.2 설계 규약 그대로 구현됨).

---

## 4. 발견사항 (등급 분류)

| # | 발견 | 등급 | 근거 |
|---|---|---|---|
| 1 | `BulkResolveModal.tsx`의 100건 의도 제한(101번째 이후 의도로 일괄 반영 시 의도 중복 생성 가능) | **Medium**(기존 code-reviewer 2차 리뷰 백로그, 이번 시험은 재확인·기록만) | 사용률이 낮은 시나리오(의도 100개 초과 보유 챗봇의 일괄 반영)이며, 우회 수단(개별 반영은 M-2로 이미 해결됨)이 존재한다. 데이터 무결성을 깨뜨리지 않으나(중복 의도가 생길 뿐 예문 손실은 없음) 운영 혼란을 유발할 수 있어 Critical/High는 아니다. |

**Critical/High 결함은 0건이다.** implementer 재호출이 필요한 항목은 없다. 위 Medium 항목은 이미 code-reviewer 백로그에 있으므로 재분류가 필요 없으며, 사용자가 우선순위를 판단해 `frontend-implementer`를 재호출할지 결정하면 된다.

`docs/04-test/오류검출_프로세스.md` 기준의 신규 등급 분류 대상 결함은 이 1건 외에는 발견되지 않았다.

---

## 5. 남은 시험 커버리지 공백 (다음 순위)

`시험항목.md`의 "미자동화/부분 자동화 항목 요약"과 `자동시험_전략.md` §4.6에 정리했다. 우선순위가 높은 항목:

1. **`/stats/questions`·`/stats/distribution`의 정확한 수치 조합 전용 HTTP 케이스**(AC-14B-1/3/6/7/8) — 현재는 No.2 그룹의 기존 단위시험(`dashboard-aggregator.spec.ts`)으로 간접 커버.
2. **`BulkResolveModal.tsx` 100건 제한 수정 후 회귀 테스트**(§3.3) — 수정이 이뤄지면 `BulkResolveModal.spec.tsx`(현재 전용 스펙 없음) 신설 필요.
3. **`ChartFrame`(표 보기 토글·요약 문장) 전용 컴포넌트 시험** — 현재는 axe 스캔 목적의 렌더 시험만 있다.
4. **AC-14A-12(5초 타임아웃)의 결정적 재현** — `AGGREGATION_TIMEOUT_MS` 환경변수화는 `system-architect` 판단이 필요한 설계 변경이라 이번 시험 범위 밖이다.
5. **K-2(요청당 정확히 1회 무효화 호출)의 정량 검증** — `jest.spyOn(bundleService, 'invalidate')` 기반 호출 횟수 단언 추가 권고.

---

## 6. 커밋 전 사용자가 알아야 할 사항

- **Critical/High 결함 0건.** 회귀 0건(api 356 / web 153 / dialogue-engine 72 / widget 26, 총 607 tests 전부 Pass).
- 이번 시험은 **테스트 코드만** 추가했다 — `apps/api/src/integration/stats-learning.integration.spec.ts`에 `it` 8건(net) 추가, `apps/api/src/learning/unanswered-collector.service.spec.ts`(신규, 5 tests), `apps/api/src/learning/learning-apply-invalidate-callsite.spec.ts`(신규, 1 test), `apps/web/src/pages/learning/LearningQueuePage.spec.tsx`(신규, 6 tests), `apps/web/src/pages/learning/ResolveModal.spec.tsx`(신규, 10 tests). **프로덕션 코드는 한 줄도 수정하지 않았다**(디버그용 임시 `console.error` 1줄을 `unanswered-collector.service.ts`에 추가했다가 원인 규명 직후 즉시 원복 완료 — 최종 diff는 0).
- §4의 Medium 발견사항(`BulkResolveModal` 100건 제한)은 code-reviewer가 이미 알고 있는 백로그이며, 이번 시험에서 코드는 건드리지 않고 재확인·문서화만 했다.
- `docs/04-test/시험항목.md`/`시험데이터.md`/`자동시험_전략.md`를 이 그룹 몫으로 확장했다(전면 재작성 없음, 기존 4개 그룹 섹션은 그대로 유지). `시험항목.md`의 기본기능 표 TC-14/TC-15 문구도 `stats-learning.md` §10 정정 제안대로 갱신했다("재학습 Job 생성" → "예문 반영 + 캐시 무효화").
- 다음 단계(`git-manager` 커밋)는 사용자 승인 시 진행된다.
