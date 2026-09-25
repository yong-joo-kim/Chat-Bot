# 피드백 기반 개선 루프 (No.44) — 화면 설계서

> **대상 기능**: No.44 피드백 기반 개선 루프 — 위젯 봇 답변 👍/👎 → 공개 평가 API → 평가 원장 → 👎 학습현황(No.15) 큐 자동 편입(`NEGATIVE_FEEDBACK` 소스) → 챗봇 스코프 만족도 통계(No.14 섹션). 사유 코드·통합 통계·자유 텍스트는 범위 밖(2차/후속).
> **입력 문서**: `docs/requirements/feedback-loop.md`(T-1~T-10, J-1~J-19, FR-0-138~148, FR-FB1~FB10, NFR-FBP/FBS/FBA/FBM, AC-FB1~FB8, EX-FB-1~26, PM 결정 §11), `docs/02-spec/feedback-loop-설계.md`(§5~§13 도메인 설계, §14~§20 권한·API·봉인·콘솔/위젯 인계), `docs/02-spec/decisions/ADR-0038-*.md`
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`(전 항목 + §6 최소 보강 1건 — 근거는 §6 참고)
> **선례 참고**: `docs/03-design/topic-system-ui-spec.md`(최신 문서 형식), `docs/03-design/stats-learning-ui-spec.md`(§3 S1 기본 통계 · §4 L1 학습현황 — 이번 작업이 확장하는 원본), `docs/03-design/hybrid-cs-ui-spec.md`(§4 위젯 설계 형식 — `core/`·`ui/` 분리 기술 방식), `docs/03-design/quality-channel-ui-spec.md`(§4.4 CH1 채널 카드 — WEB 설정 폼에 스위치 추가)
> **실제 코드 확인**: `apps/widget/src/ui/message-list.ts`(`addBotOutputs`/`addBotAnswer` — `messageId` 미전달·`_messageId` 미사용 확인), `apps/widget/src/ui/app.ts`(`handleSend`·`pollPendingAnswer` — `res.messageId` 미사용 확인), `apps/widget/src/ui/panel.ts`(`#cb-status` = `panel.setStatusText`), `apps/widget/src/constants/messages.ts`(문구 네임스페이스 구조), `apps/web/src/constants/messages.ts`(`channels`/`learning` 네임스페이스 — 557·1703행), `apps/web/src/pages/ChatbotDetailLayout.tsx`·`apps/web/src/pages/chatbot-detail/TabNav.tsx`·`apps/web/src/pages/stats/StatsShell.tsx`·`apps/web/src/pages/stats/AnswerFeedbackSection.tsx`·`apps/web/src/pages/stats/chartSummary.ts`(구현 리뷰 R2 근거 — §3.4.2/§3.5)
> **작성**: ui-designer · 2026-09-25(구현 리뷰 R2 반영, §10) · **다음 단계**: `backend-implementer`(① 큐 소스 분리 준비 커밋 — 동작 불변 → ② 본체) → `frontend-implementer`(웹+위젯) → `code-reviewer` → `test-automation`
> **범위 경계**: 실제 React/TS 컴포넌트 코드는 작성하지 않는다. 사유 코드 선택형(2차)·통합/의도별 통계(2차)·자유 텍스트(후속)·👎 상담 경고 연동(후속)·평가 취소(범위 밖)는 다루지 않는다(요구사항 §9).

---

## 0. 전제와 연계 확인

1. **PM 확정 사항(2026-09-25)을 그대로 따른다**(요구사항 §11). 이 문서가 화면으로 구체화할 뿐 재론하지 않는 핵심만 다시 적는다.
   - 1차 범위 = 위젯 👍/👎(WEB·챗봇별·기본 꺼짐) + 공개 평가 API + 평가 원장 + **👎 큐 자동 편입**(소스 분리·매칭 대상 표시·직접 수정 완료) + 챗봇 스코프 만족도 섹션. 사유 코드·그룹/전역 통계는 2차, 자유 텍스트는 후속(No.45).
   - 평가는 **메시지당 24시간·5회까지 변경 가능, 취소(해제)는 없다.** 선택된 버튼을 다시 누르면 무동작.
   - 👍는 통계에만 반영한다(큐 비반영, 1차).
   - **기존 "미응답 대기 n건" 배지·숫자는 의미를 바꾸지 않는다(미응답만).** 부정 피드백 건수는 **별도 배지**로 표시한다 — §3.5에서 구체화.
   - **참여율은 하한값**이다(대기 중 폐기된 RAG 턴 등이 분모에 포함) — 도움말로 상시 안내한다.
   - 상담 턴·상담원 메시지·설문 소비 턴·금지어 BLOCK 턴은 평가 대상이 아니다(버튼 자체가 없다). 평가 기능 스위치는 WEB 채널 설정 `feedbackEnabled`(기본 꺼짐).
2. **신규 최상위 라우트 0개.** 이번 그룹은 기존 화면 4곳(WEB 채널 설정 · 위젯 · 학습현황 L1 · 기본 통계 S1)을 확장할 뿐이다. `StatsShell`/`DialogueShell`/`TabNav` 구조를 바꾸지 않는다. 다만 학습 요약(`GET .../unanswered-questions/summary`) 상태의 **소유 위치**는 `StatsShell`에서 `ChatbotDetailLayout`으로 바뀐다(구현 리뷰 R2 확정 — §3.5) — 라우트·화면 구성·컴포넌트 트리 자체는 그대로이고 "누가 이 데이터를 들고 있는가"만 바뀐다.
3. **위젯 변경이 필수다**(J-14) — 이번 그룹 이전에는 "위젯에 평가 버튼을 넣지 않는다"였다(`quality-channel.md` 622행, 이번에 뒤집힘). `apps/widget`은 vanilla TS·런타임 의존성 0·gzip 100KB 게이트를 유지한다(현재 11.16KB, 예상 증가 +1~2KB).
4. **버튼 표시는 서버가 결정한다.** 위젯은 스스로 "이 말풍선은 평가 가능하다"를 추정하지 않는다 — 응답에 `feedback: { rateable: true }`가 있는 봇 말풍선에만 버튼을 붙인다(FR-FB9-3). 이 표시가 없는 말풍선(인사말·대기 문구·시스템·오류·상담원·설문 문항)에는 평가 버튼이 없다.
5. **`messageId` 결합 검증** — 평가는 "서버가 나에게만 돌려준 `messageId` + 내 `sessionId`"로만 성립한다(토큰 없음). 화면 설계 관점에서는 "이 말풍선이 평가 가능하다고 서버가 말했을 때만 버튼을 보여준다"는 원칙 하나로 요약된다 — 위조 방어 자체는 이 문서의 관심사가 아니다(API 계층 책임).
6. **UIUX 보강 최소 1건** — 로그 영역(`role="log"`) 안의 보조 버튼(평가 버튼) 상태 변화가 새 노드를 추가하지 않고 속성 변경 + `#cb-status` 1회 안내로만 전달되어야 한다는 규칙은 `UIUX_준수기준.md`에 아직 명시돼 있지 않다 — §6에서 실제 보강 문구를 제안하고 반영한다(설계서 §20 "보강 후보" 채택).

---

## 1. 화면 목록 및 라우트

| ID | 화면/컴포넌트 | 라우트 | 성격 | 진입 경로 | 필요 권한 |
|---|---|---|---|---|---|
| FB-CH | WEB 채널 설정 — "답변 평가 받기" 스위치 | `/chatbots/:chatbotId/channels`(기존 CH1, WEB 카드 인라인 폼 확장) | 폼 확장 | CH1 WEB 카드 "설정 열기"(기존) | 조회 `channel:read`(CH1 상속) / 저장 `channel:write` |
| FB-W | 위젯 평가 막대(`FeedbackBar`) | 라우트 없음 — `apps/widget` DOM 컴포넌트 | 위젯 컴포넌트 | 평가 가능 봇 말풍선 렌더 직후 | 없음(공개, 결합 검증) |
| FB-L1 | 학습현황 목록 — 소스 탭·필터·배지 확장 | `/chatbots/:chatbotId/stats/learning`(기존 L1) | 목록+모달 확장 | `StatsSubNav` "학습현황"(기존) | 조회 `dialogue:read` / 처리 `dialogue:write` |
| FB-L1D | 학습현황 펼침 상세 — 부정 평가 전용 필드 확장 | L1 내부(행 펼침, 신규 라우트 없음) | 상세 패널 확장 | L1 행의 `▸` 펼침(기존) | 〃 |
| FB-S1 | 기본 통계 — "답변 만족도" 섹션(신규 4번째 패널) | `/chatbots/:chatbotId/stats/overview`(기존 S1) | 페이지 확장(신규 독립 API 1개) | S1 스크롤 하단(순위 패널 다음) | `chatbot:read` |
| FB-NAV | 탭 배지 — 부정 피드백 전용 배지 | `StatsSubNav`(학습현황 항목) · `TabNav`(통계 탭) | 배지 확장 | 기존 배지 옆 | 조회 권한 상속(배지는 읽기 전용 표시) |

**신규 최상위 라우트는 0개다.** 신규 컴포넌트는 전부 기존 화면 안에 삽입되거나(FB-CH/FB-L1/FB-L1D/FB-S1/FB-NAV) 위젯 DOM에 추가된다(FB-W).

---

## 2. 공통 UI 요소(신규)

### 2.1 배지류 (색상 + 텍스트 병행, UIUX §1)

| 컴포넌트 | 용도 | 규칙 |
|---|---|---|
| `FeedbackSourceBadge` | FB-L1 행의 "출처" 표시 | `UNANSWERED` → "답변 못함"(회색, 기존 `UnansweredStatusBadge`와 다른 축 — 출처이지 상태가 아님) / `NEGATIVE_FEEDBACK` → "부정 평가"(주황 텍스트, 아이콘 👎 병기 — 색상 단독 아님) |
| `CurrentMatchBadge` | FB-L1D `SuggestionList`의 추천 후보 중 `lastFeedback.matchedIntentId`와 같은 항목 | "현재 매칭"(파랑 텍스트 + 아이콘) — `suggestion.intentId === lastFeedback.matchedIntentId`일 때만, 콘솔이 클라이언트에서 비교해 렌더(서버 필드 추가 0, D-21) |
| `ResolvedDirectlyBadge` | FB-L1 행 상태 열 | 기존 `UnansweredStatusBadge`의 `RESOLVED` 라벨을 `resolvedDirectly === true`일 때만 "반영 완료(직접 수정)"로 교체(같은 색·아이콘, 괄호만 추가 — 새 상태값이 아니라 기존 배지의 표시 분기) |
| `NegativeFeedbackNavBadge` | `StatsSubNav`/`TabNav`의 부정 피드백 전용 배지 | 기존 `NavPendingBadge`(미응답 전용, §3.5)와 **나란히** 배치되는 별도 인스턴스 — 색상(주황)·아이콘(👎)·`aria-label`("대기 중인 부정 평가 N건")로 기존 배지와 명확히 구분 |
| `SourceTabStrip` 항목 카운트 | FB-L1 상단 탭 | 탭 라벨에 괄호 숫자 병기("부정 평가 (12)") — `NegativeFeedbackNavBadge`와 같은 값을 공유(같은 API 1회 호출 — 호출 주체는 `ChatbotDetailLayout`, §3.5) |

### 2.2 콘솔 전용 컴포넌트(신규)

| 컴포넌트 | props / 용도 | 규칙 |
|---|---|---|
| `FeedbackEnabledField` | `value: boolean`, `onChange`, `disabled?` | FB-CH — 체크박스 1개(`<label>` 필수, UIUX §5). 저장 시 기존 WEB `config` 객체 전체와 함께 전송(§3.1 ⚠) |
| `SourceTabStrip` | `counts: { all, unanswered, negativeFeedback }`, `value`, `onChange` | FB-L1 상단 — 세그먼트형 탭 3개("전체" / "답변 못함 (n)" / "부정 평가 (n)"). URL 쿼리 `source`와 동기화. 값 변경은 목록 재조회를 트리거하지만 "필터 재조회"이므로 UIUX §6(값 변경 자동 제출 금지)의 금지 대상이 아니다(`GranularityPeriodControl` 선례와 동일 해석) |
| `NegativeFeedbackLimitBanner` | `count`, `limit`(2000) | FB-L1 상단, 기존 `PendingLimitBanner`(미응답 5,000건 상한)와 **별도 인스턴스**로 병기(동시에 뜰 수 있음). "부정 평가 질문이 상한(2,000건)에 도달했습니다. 검토 후 정리해 주세요." |
| `LastFeedbackAnswerPanel` | `botResponse`(마스킹본·2,000자 절단), `turnAt`, `target: FeedbackTargetRef` | FB-L1D — "당시 봇 답변" 인용 블록 + 매칭 대상 유형·이름(삭제 시 "삭제됨") |
| `FeedbackTargetEditLink` | `target: FeedbackTargetRef` | FB-L1D — FAQ/노드/의도면 해당 편집 화면 href 링크. RAG·폴백·삭제됨이면 링크 없음(FR-FB7-7) |
| `CounterpartLink` | `counterpart: { id, source, status }` | FB-L1D — "같은 질문의 {답변 못함\|부정 평가} 항목({상태}) →" 링크, 클릭 시 L1을 그 항목으로 필터+하이라이트 이동(기존 `highlightId` 쿼리 패턴 재사용, S1과 동일) |
| `MarkAddressedButton` | `questionId`, `disabled?`, `disabledReason?` | FB-L1D — "직접 수정 완료" 버튼. `NEGATIVE_FEEDBACK` ∧ `PENDING`일 때만 활성, 그 외에는 렌더하되 비활성 + 사유 텍스트("답변 못함 항목은 반영(예문 추가)으로 처리해 주세요." 또는 "이미 처리되었습니다") |
| `AnswerFeedbackSection` | `chatbotId`, `granularity/from/to`(S1과 공유 상태) | FB-S1 — 신규 4번째 패널. `GET /stats/feedback` 독립 호출(F-3과 동일 원칙 — 다른 패널 로딩/오류와 무관하게 렌더) |
| `ParticipationRateHelp` | — | FB-S1 — 물음표 아이콘 + 툴팁/인라인 텍스트: "참여율 = 평가 수 ÷ 버튼을 보여준 답변 수. 응답을 기다리다 새 질문으로 넘어가거나 창을 닫은 경우도 분모에 포함되어 실제보다 낮게 보일 수 있습니다(하한값)." |
| `TopNegativeTargetsTable` | `items: TopNegativeTarget[]` | FB-S1 — §3.4.2 |

### 2.3 위젯 전용 컴포넌트(신규)

| 컴포넌트 | 위치 | 규칙 |
|---|---|---|
| `FeedbackBar`(`ui/feedback-bar.ts`) | `.cb-msg` 안, `.cb-bubble` 바로 다음(말풍선 **밖**) | §3.2 상세 |
| `core/feedback.ts` | DOM 무의존 순수 함수 | `planFeedbackAttempt(result, attempt)` — 응답 코드 → 재시도/표시 결정(§3.2.4) |

---

## 3. 화면별 설계

## 3.1 FB-CH — WEB 채널 설정: "답변 평가 받기" 스위치

### 목적
챗봇별로 위젯 평가 버튼 노출 여부를 끄고 켠다(기본 꺼짐).

### 진입
`quality-channel-ui-spec.md` §4.4.3의 기존 WEB 설정 인라인 폼(허용 도메인 → 인사말 → 빠른 응답 → 런처) 마지막에 새 구획을 추가한다.

### 레이아웃 (기존 §4.4.3에 삽입되는 부분만)

```
┌ 웹(WEB) 설정 ──────────────────────────────────────────────────┐
│ … 허용 도메인 / 인사말 / 빠른 응답 / 런처(기존, 변경 없음) …        │
├──────────────────────────────────────────────────────────────────┤
│ ☐ 답변 평가 받기                                                  │
│   켜면 챗봇 답변마다 '도움이 됐어요/도움이 안 됐어요' 버튼이         │
│   보입니다. 새 답변부터 적용돼요.                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                [취소]   [저장]     │
└──────────────────────────────────────────────────────────────────┘
```

### ⚠ config 전체 교체 주의 (backend-implementer·frontend-implementer 공통 필독)

`feedback-loop-설계.md` §5.1·§20이 명시하듯 **WEB 채널 `config`는 부분 수정이 아니라 전체 교체 시맨틱**이다(`PATCH .../channels/WEB { config: {...} }`가 `config` 객체를 통째로 덮어쓴다). 따라서:
- `feedbackEnabled`는 `.optional()` 스키마이며 **누락 = 꺼짐**으로 해석된다.
- WEB 설정 폼은 허용 도메인·인사말·빠른 응답·런처와 **같은 저장 트랜잭션 안에서** `feedbackEnabled` 값을 **항상** 함께 전송해야 한다 — 다른 필드만 바꿔 저장해도 `feedbackEnabled`를 폼 상태에서 누락시키면 스위치가 조용히 꺼진다.
- `frontend-implementer`는 폼 로드 시 `GET .../channels/WEB` 응답의 `config.feedbackEnabled ?? false`로 초기값을 채우고, 저장 시 이 값을 다른 필드들과 함께 단일 `config` 객체로 조립해 보낸다(기존 `quality-channel-ui-spec.md` §4.4.3의 필드 조립 로직에 필드 1개만 추가).

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | 기존 `SkeletonCard`(CH1 카드 스켈레톤에 포함) |
| 정상 | 체크박스 + 설명 텍스트, 초기값 = 저장된 `feedbackEnabled`(없으면 미체크) |
| `channel:write` 없음 | 체크박스 `aria-disabled` + 사유("이 채널을 수정할 권한이 없습니다") — CH1의 기존 권한 규칙 상속 |
| `ARCHIVED` 챗봇 | 기존 CH1 보관 배너 + 체크박스도 `aria-disabled` + 사유("보관된 챗봇은 채널을 변경할 수 없습니다. 먼저 초안으로 복구하세요.") — 기존 토글과 동일 규칙 |
| 저장 중 | `[저장]` 버튼 스피너 + `disabled`(중복 제출 방지) |
| 저장 성공 | `Toast`("저장되었습니다.") + 카드 요약 캡션 갱신(기존 CH1 동작 그대로, 신규 캡션 문구 추가 없음 — 평가 스위치는 CH1 카드 요약에 노출하지 않는다, 정보 과밀 방지) |
| 저장 실패(`409 CHATBOT_ARCHIVED`) | 폼 상단 배너 "보관된 챗봇입니다." |

### 데이터 바인딩

| 항목 | 값 |
|---|---|
| 조회 | `GET /chatbots/:chatbotId/channels`(기존, CH1 초기 로드) → WEB 항목의 `config.feedbackEnabled` |
| 저장 | `PATCH /chatbots/:chatbotId/channels/WEB { config: { allowedOrigins, greetingMessage, quickReplies, launcherPosition, showLauncher, feedbackEnabled } }`(전체 교체 — 필드 1개 추가) |

---

## 3.2 FB-W — 위젯 평가 막대 (`apps/widget`)

> `hybrid-cs-ui-spec.md` §4와 같은 형식(React가 아니므로 DOM 마크업·상태 전이·이벤트 흐름으로 기술). `core/`(순수)와 `ui/`(DOM)의 분리를 그대로 따른다.

### 3.2.1 배치 — 봇 말풍선 아래, 로그 영역의 "새 노드"가 아니게

```
┌ (bot bubble) ──────────────────────────────────┐
│ 해외 배송은 국가에 따라 3~5영업일이 소요됩니다.    │
└──────────────────────────────────────────────────┘
  👍 도움이 됐어요    👎 도움이 안 됐어요
```

- `FeedbackBar`는 `addBotOutputs`/`addBotAnswer`가 말풍선을 렌더하는 **같은 호출 안에서** `.cb-msg`(부모, `#cb-messages` 자식) 안에 `.cb-bubble` 다음 형제로 붙는다 — 말풍선이 `#cb-messages`(`role="log" aria-relevant="additions"`)에 추가되는 **단일 DOM 삽입 동작**의 일부이므로, 스크린리더는 말풍선+버튼 막대를 한 번의 "추가" 이벤트로 인지한다(말풍선당 최대 1회 낭독 — NFR-FBA2).
- 이후 버튼 클릭에 따른 상태 변화(`aria-pressed`, `disabled`, 안내 문구)는 **기존 노드의 속성/텍스트만** 바꾼다 — `#cb-messages`에 새 자식을 추가하지 않으므로 `aria-relevant="additions"`가 재낭독을 일으키지 않는다(AC-FB7-2).
- 표시 대상은 응답에 `feedback: { rateable: true }`가 있는 봇 말풍선뿐이다(FR-FB9-3): 일반 답변·폴백(미응답)·API 고정 문구·`NODE`/`MESSAGE` 버튼 턴·RAG 최종 답변(`READY`/`FAILED`)은 **표시 대상**, 인사말·퀵리플라이·대기 문구(`addPendingIndicator`)·로컬 정리 문구(`EXPIRED`/`TIMEOUT`)·시스템 안내(`stateResetNotice` 등)·오류 말풍선·상담원 말풍선(`addAgentText`)·설문 문항 말풍선은 **표시 대상이 아니다**.

### 3.2.2 마크업

```html
<div class="cb-msg cb-msg-bot">
  <div class="cb-bubble"> … 답변 아웃풋 … </div>
  <div class="cb-feedback-bar" role="group" aria-label="답변 평가">
    <button type="button" class="cb-feedback-btn cb-feedback-up" aria-pressed="false">
      <span class="cb-feedback-icon" aria-hidden="true">👍</span>
      <span class="cb-feedback-label">도움이 됐어요</span>
    </button>
    <button type="button" class="cb-feedback-btn cb-feedback-down" aria-pressed="false">
      <span class="cb-feedback-icon" aria-hidden="true">👎</span>
      <span class="cb-feedback-label">도움이 안 됐어요</span>
    </button>
    <span class="cb-feedback-note" aria-hidden="true"></span>
  </div>
</div>
```

- `role="group" aria-label="답변 평가"`로 버튼 2개를 하나의 위젯으로 묶는다(NFR-FBA1).
- `.cb-feedback-icon`은 `aria-hidden="true"` — 접근 가능한 이름은 `.cb-feedback-label`의 보이는 텍스트로만 제공한다(UIUX §4 "기호만으로 의미를 전달하지 않는다" 원칙을 대화형 설문 버튼과 동일하게 적용).
- `.cb-feedback-note`(예: "저장하지 못했어요")는 **`aria-hidden="true"`인 시각 전용 텍스트**다 — 스크린리더 안내는 전부 `#cb-status`(1회)로만 전달한다(설계서 §13.4, 이중 낭독 방지). 텍스트는 처음부터 존재하는 빈 `<span>`의 `textContent`만 바꾼다(새 노드 추가 없음).
- 아이콘은 이모지(👍/👎)를 기본으로 하되, 스킨 대비 검증(NFR-FBA1, 아이콘 3:1)에서 문제가 확인되면 `currentColor` 기반 인라인 SVG로 교체할 수 있도록 `.cb-feedback-icon` 클래스로 분리해 둔다(구현 재량, axe 검증 필수).

### 3.2.3 시각 상태 (색상 단독 금지, UIUX §1)

| 상태 | 시각 표시(2중 이상) | `aria-pressed` | 상호작용 |
|---|---|---|---|
| 기본(미선택) | 회색 아웃라인 테두리 | `false` (양쪽 다) | 클릭 가능 |
| 선택됨(낙관적 표시 포함) | 배경 채움(스킨 강조색) + 굵은 테두리 + 체크 표시(`::before` 아이콘, `aria-hidden`) | 선택된 쪽 `true`, 반대쪽 `false` | 선택된 버튼 재클릭 = 무동작(FR-FB9-6). 반대 버튼 클릭 = 변경 요청 |
| 요청 중 | 스피너 오버레이 + 흐림(opacity) | 요청 전 값 유지(낙관적) | `aria-busy="true"`, 두 버튼 모두 클릭 무시 |
| 실패(재시도 후에도) — 저장 실패 | 회색으로 복귀(직전 확정값) + `.cb-feedback-note` = "저장하지 못했어요" | 직전 확정값으로 복귀 | 다시 클릭 가능(재시도) |
| 잠김 — 평가 불가(404) | 두 버튼 회색 + `disabled` + `.cb-feedback-note` = "지금은 의견을 받을 수 없어요" | `false`(선택 해제) | 클릭 불가 |
| 잠김 — 변경 한도 초과(409) | 마지막 확정값 유지 + `disabled` + `.cb-feedback-note` = "더 이상 바꿀 수 없어요" | 마지막 확정값 유지 | 클릭 불가 |
| 429(조용히 무시) | 직전 확정값으로 조용히 복귀(별도 문구 없음) | 직전 확정값 | 다시 클릭 가능 |

터치 영역은 버튼당 최소 44×44px(UIUX §4), 두 버튼 사이 간격 확보. 포커스는 표준 `:focus-visible` 윤곽선(스킨과 무관한 고정 대비, 4.5:1 이상).

### 3.2.4 동작·재시도 (`core/feedback.ts`)

| 서버 결과 | 1회차 | 2회차 | `#cb-status` 안내(1회, polite) |
|---|---|---|---|
| `200` | 완료 | — | "의견을 보내 주셔서 고마워요" |
| `404`(기능 꺼짐·평가 불가 턴·미존재) | **1초 뒤 자동 재시도**(READY 직후 로그 적재 경쟁 C-1 흡수) | 실패 확정 | "지금은 의견을 받을 수 없어요" |
| 네트워크 오류·5xx | 1초 뒤 재시도 | 실패 확정(직전 값 복귀) | "저장하지 못했어요" |
| `409`(변경 한도·기한 초과) | 재시도 없음 | — | "더 이상 바꿀 수 없어요" |
| `429` | 재시도 없음 | — | (문구 없음 — 조용히 직전 값 복귀) |
| `403`(비공개·채널 닫힘) | 재시도 없음 | — | "지금은 의견을 받을 수 없어요" |

- 클릭 → **즉시 선택 표시**(낙관적) → 결과 반영. 모달·오류 말풍선·입력창 잠금 없음(대화 전송은 평가와 완전히 독립).
- 평가 후 **포커스 이동 없음**(입력창 포커스 유지) — 사용자가 계속 대화를 이어갈 수 있다.
- 평가 요청은 사용자 클릭에만 발생한다(폴링 0).

### 3.2.5 위젯 문구 전체 목록 (`constants/messages.ts` 추가)

| 키 | 값 |
|---|---|
| `feedback.groupLabel` | "답변 평가"(`role="group" aria-label`) |
| `feedback.up` | "도움이 됐어요" |
| `feedback.down` | "도움이 안 됐어요" |
| `feedback.thanks` | "의견을 보내 주셔서 고마워요" |
| `feedback.saveFailed` | "저장하지 못했어요" |
| `feedback.unavailable` | "지금은 의견을 받을 수 없어요" |
| `feedback.locked` | "더 이상 바꿀 수 없어요" |

이 7개 문자열이 위젯이 사용자에게 보여주는 평가 관련 **모든** 문구다(§8에 웹 콘솔 문구와 함께 재기재).

### 3.2.6 접근성 실측 남은 항목

버튼 레이블을 "보이는 텍스트"로 확정한다(시각적 숨김 텍스트 대안 채택 안 함) — UIUX §4의 "기호만으로 의미를 전달하지 않는다" 원칙을 가장 직접적으로 충족하고, 별도 CSS 은닉 클래스 없이 구현 복잡도가 낮다. 스크린리더(NVDA/VoiceOver)별로 말풍선+버튼 막대가 실제로 1회만 낭독되는지는 `frontend-implementer`/`test-automation` 단계에서 실측한다 — 중복 낭독이 확인되면 `.cb-feedback-label`을 시각적 숨김 텍스트로 전환하는 대안을 선택할 수 있다(설계서 §13.4가 열어둔 재량).

**로빙 탭(roving tabindex)은 도입하지 않는다.** 말풍선당 버튼은 2개뿐이라 표준 Tab 순서의 이동 부담이 이미 작고, 대화는 세로 스크롤이 자연스러운 탐색 방식이라 로빙 탭 구현의 접근성 리스크(포커스 관리 버그)가 이득보다 크다(NFR-FBA3 판단 — 사용 패턴상 문제가 확인되면 재검토).

---

## 3.3 FB-L1 — 학습현황 목록 확장 (소스 탭·필터·배지)

### 목적
`stats-learning-ui-spec.md` §4의 L1(미응답 검토)에 **부정 평가**라는 두 번째 입력 소스를 추가한다. 미응답 수집·반영 흐름은 바이트 단위로 불변이며(FR-0-139), 이 절은 **추가되는 것만** 기술한다.

### 레이아웃 (기존 §4.3에 삽입·변경되는 부분만)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [StatsSubNav]  기본 통계 | 학습현황 (●3 · 부정평가 ●2)                       │
├───────────────────────────────────────────────────────────────────────────┤
│ ⚠ 노드 미연결 항목이 있습니다 …(기존, 변경 없음)                     [모두 닫기]│
├───────────────────────────────────────────────────────────────────────────┤
│ ℹ 미응답 질문이 상한(5,000건)에 도달했습니다. …(기존, 변경 없음)             │
│ ℹ 부정 평가 질문이 상한(2,000건)에 도달했습니다. 검토 후 정리해 주세요.     │  ← 신규, 독립 배너
├───────────────────────────────────────────────────────────────────────────┤
│ [전체]  [답변 못함 (5)]  [부정 평가 (2)]                                    │  ← 신규 SourceTabStrip
├───────────────────────────────────────────────────────────────────────────┤
│ 검색 [질문 내용_____]  상태 ☑대기 ☐반영완료 ☐무시됨  ☐반영 후 재발생만      │  (기존, 변경 없음)
│ 정렬 [발생 횟수 많은 순 ▾]                                                   │
├───────────────────────────────────────────────────────────────────────────┤
│ ☐ 질문             출처     발생  최초발생  최근발생   상태    추천의도  액션│  ← "출처" 열 신규
│ ▸☐해외배송도 되나요? 답변못함  12   09-01     3시간 전   대기    배송문의  ⋮ │
│ ▸☐환불 얼마나 걸리나요 부정평가 3   09-11     10분 전    대기    환불안내  ⋮ │
│    당시 답변: FAQ '환불 안내'                                                │
└───────────────────────────────────────────────────────────────────────────┘
```

- `SourceTabStrip`은 `q`/상태 필터와 **독립적으로 공존**한다 — "전체" 탭에서는 두 소스가 섞여 나오며 각 행에 `FeedbackSourceBadge`로 구분한다(기존 목록 필터 무지정 호출과 결과 동일, AC-FB5-1).
- `NEGATIVE_FEEDBACK` 행에는 목록 단계에서도 "당시 답변: {대상유형} '{이름}'" 한 줄을 질문 아래 보조 텍스트로 미리 보여준다(펼치지 않아도 원인을 가늠할 수 있게 — 답변 본문 자체는 목록에 없다, FR-FB7-2).
- `StatsSubNav`의 "학습현황" 배지는 두 숫자로 나뉜다 — §3.5에서 상세.

### 펼침 상세 (부정 평가 행, `NEGATIVE_FEEDBACK` 전용 확장)

```
▾ 환불 얼마나 걸리나요?  출처: 부정 평가  발생 3  최초 09-11  최근 10분 전  대기
  ┌───────────────────────────────────────────────────────────────────────┐
  │ 당시 봇 답변                                                            │
  │  "환불은 영업일 기준 3일 이내 처리됩니다." (FAQ '환불 안내')  [FAQ 편집] │
  ├───────────────────────────────────────────────────────────────────────┤
  │ 추천 의도 후보                                                          │
  │  환불안내 0.71 [현재 매칭]  (예문: "환불 얼마나 걸려요")  [이 의도로 반영]│
  │  환불절차문의 0.35          (예문: "환불 절차 알려줘")    [이 의도로 반영]│
  │  ⚠ '환불안내'를 선택하면: 지금도 이 의도로 답하고 있어요 — 답변 내용      │
  │    수정이 필요할 수 있어요                                              │
  ├───────────────────────────────────────────────────────────────────────┤
  │ ⓘ 같은 질문의 답변 못함 항목(반영 완료)이 있습니다 →                     │
  ├───────────────────────────────────────────────────────────────────────┤
  │ 👎 추이(원장 기반, 정확) [표로 보기]                                    │
  │  ▁▂▁▁▃                                                                 │
  ├───────────────────────────────────────────────────────────────────────┤
  │                          [반영]   [직접 수정 완료]   [무시]             │
  └───────────────────────────────────────────────────────────────────────┘
```

- **당시 봇 답변**(`LastFeedbackAnswerPanel`) — 마스킹본, 2,000자 초과 시 "…(더 보기)" 없이 절단 표시(FR-FB7-2). 대상 유형이 FAQ/노드/의도면 `FeedbackTargetEditLink`("FAQ 편집"/"노드 편집"/"의도 편집") 동반, RAG/폴백/삭제됨이면 링크 없음.
- **추천 의도 후보**는 기존 `SuggestionList`(미응답과 동일 컴포넌트·동일 우선순위 — 분류기 → 문자 유사도, 신규 연산 0)를 재사용하되, `lastFeedback.matchedIntentId`와 일치하는 항목에 `CurrentMatchBadge`("현재 매칭")를 붙인다. 그 항목으로 `[이 의도로 반영]`을 누르면 기존 `ResolveModal`이 열리되 상단에 비차단 경고 문구를 추가로 표시한다(FR-FB7-4).
- **`CounterpartLink`** — 같은 정규화 질문의 다른 소스 항목이 있을 때만 렌더. 클릭하면 L1을 그 항목의 소스 탭으로 전환하고 해당 행을 하이라이트한다(EX-FB-22).
- **추이(`TrendMiniChart`)** — 부정 평가 항목은 원장(`MessageFeedback`) 기반으로 **정확히** 집계되므로(`trendSource: 'FEEDBACK_LEDGER'`) 기존 미응답 항목의 "표기 변형 근사" 캡션(`trendApproximated`)을 표시하지 않는다. 이 차이를 `TrendMiniChart` 캡션으로 명시: "이 소스는 정확한 집계입니다."(미응답 항목의 "일부 발생이 집계에서 빠졌을 수 있습니다" 문구 대신).
- **액션 3종**: `[반영]`은 기존 `ResolveModal` 그대로(예문 추가 — "잘못 매칭"일 때). `[직접 수정 완료]`는 신규 `MarkAddressedButton`("내용은 맞는데 답변이 틀렸을 때" — 관리자가 먼저 대상 편집 화면에서 FAQ/노드/의도 내용을 고친 뒤 돌아와 누른다). `[무시]`는 기존과 동일.

### 직접 수정 완료 흐름

1. 관리자가 `FeedbackTargetEditLink`로 FAQ/노드/의도 편집 화면으로 이동해 답변 내용을 고친다(별도 화면, 기존 편집 흐름 그대로).
2. L1로 돌아와 `[직접 수정 완료]` 클릭 → 확인 대화상자 없이 즉시 `POST .../unanswered-questions/:id/mark-addressed` 호출(재오픈 가능해 되돌릴 수 있으므로 확인 단계를 생략 — 설계서 §20 근거).
3. 성공 → 행이 `반영 완료(직접 수정)`로 즉시 갱신 + `aria-live="polite"` 1회 안내("직접 수정 완료로 처리되었습니다.") + `StatsSubNav`·`TabNav`의 부정 평가 배지 수 1 감소(단일 공유 상태이므로 `refreshLearningSummary` 한 번으로 두 곳이 함께 갱신된다, §3.5).
4. 실패(`400 INVALID_STATUS_TRANSITION`, 미응답 항목에 잘못 호출된 경우) → 인라인 오류 "답변 못함 항목은 반영(예문 추가)으로 처리해 주세요."(정상적으로는 버튼 자체가 미응답 행에서 비활성이라 도달하지 않는다 — 경합 대비 방어).
5. 실패(`409 ALREADY_RESOLVED`) → "다른 관리자가 먼저 처리했습니다. 목록을 새로고침합니다." + 자동 재조회(기존 `ResolveModal`의 동시 경합 패턴과 동일).
6. `VIEWER`/`AGENT`(=`dialogue:write` 없음) → 버튼 자체를 렌더하지 않는다(기존 §5.1 "권한 없으면 렌더 자체 안 함" 원칙 상속).

### 기존 반영·무시·재오픈과의 관계

- `[반영]`(예문 추가)·`[무시]`·재오픈·**일괄 반영/무시**·요소분해 반영(No.23)은 `NEGATIVE_FEEDBACK` 항목에도 **그대로** 동작한다(FR-FB7-8) — 새 컴포넌트가 필요 없다. 일괄 처리(`BulkResolveModal`/`BulkIgnoreConfirmDialog`)는 소스가 섞인 선택도 지원한다(서버가 항목별로 처리).
- `[직접 수정 완료]`만 **부정 평가 전용 신규 액션**이며 1차는 **단건만**(일괄 지원 없음 — FR-FB7-6 D-13). 체크박스로 여러 건을 선택해도 `BulkActionBar`에 "직접 수정 완료" 일괄 버튼은 없다(운영 요청이 있으면 2차 후보).

### 상태별 UI (추가분만 — 기존 §4.9는 그대로 유지)

| 상태 | UI |
|---|---|
| 부정 평가 `PENDING` 상한(2,000) 도달 | `NegativeFeedbackLimitBanner` 상시 노출(닫기 불가) — 기존 미응답 상한 배너와 **동시에** 뜰 수 있다 |
| 소스 탭 "부정 평가" 선택 + 결과 0건(과거 처리 이력도 없음) | `EmptyState`: "부정 평가로 들어온 질문이 없습니다." + 설명 "답변 평가 기능을 켜면 👎를 받은 답변이 여기로 모입니다." (+ EDITOR/ADMIN이면 "채널 설정으로 이동" 링크) |
| 소스 탭 "부정 평가" + 기본 필터(`PENDING`) 0건, 처리 이력 있음 | 기존 "빈 상태 ③"과 동일 패턴("모두 처리되었습니다." + "처리된 항목 보기") |
| 기능이 아직 한 번도 켜진 적 없는 챗봇 | 소스 탭 자체는 항상 렌더하되 "부정 평가 (0)"로 시작 — 별도 안내 없음(기능 자체가 없다는 오해를 막기 위해 탭을 숨기지 않는다) |

---

## 3.4 FB-S1 — 통계 화면 "답변 만족도" 섹션

### 목적
챗봇 답변에 대한 사용자 만족도(👍/👎 비율·참여율·추이·👎가 몰린 답변)를 본다(S-7).

### 위치와 로딩 독립성

기존 S1(`stats-learning-ui-spec.md` §3)의 레이아웃 맨 아래(인기 질문/미응답 질문 순위 패널 다음)에 **4번째 독립 패널**로 추가한다. 기존 3개 API(`summary`/`distribution`/`questions`)와 마찬가지로 `GET /stats/feedback`도 **독립적으로 로딩·완료**된다(F-3 원칙 확장) — 이 섹션이 느리거나 실패해도 위쪽 3개 패널 렌더에 영향이 없고, 반대도 마찬가지다. `GranularityPeriodControl`(기간·단위)은 **기존 컨트롤을 그대로 공유**한다(신규 기간 컨트롤을 만들지 않는다 — FR-FB8-1이 요구하는 "No.14 규약 상속"과 정확히 일치).

### 레이아웃 (ASCII)

```
├───────────────────────────────────────────────────────────────────────────┤
│ 답변 만족도                                                                 │
│ ┌────────┐ ┌──────────────────┐ ┌───────────────────────────┐             │
│ │평가 수  │ │긍정률             │ │참여율                    ⓘ│             │
│ │ 412건  │ │ 71%              │ │ 6.3%                       │             │
│ │👍294 👎118│ │표본 412건        │ │버튼 노출 6,540건 중 · 하한값│             │
│ └────────┘ └──────────────────┘ └───────────────────────────┘             │
│ 일별 추이                                             [표로 보기]           │
│ ⓘ 최근 30일간 긍정률은 68%에서 71%로 상승했습니다.                          │
│  ▂▃▅▇█▆  (👍=파랑 / 👎=사선 hatch 패턴 누적 막대 — 선 오버레이 없음)        │
│  범례: ■ 👍  ▦ 👎(사선 패턴)                                               │
├───────────────────────────────────────────────────────────────────────────┤
│ 👎가 많이 모인 답변 (상위 10)                            [표로 보기]        │
│ 유형    이름              👎    👍    이동                                 │
│ FAQ     환불 안내         38    12    부정 평가 큐 보기 →                  │
│ 노드    배송 조회         21     5    부정 평가 큐 보기 →                  │
│ 문서 답변(RAG)            9      3    부정 평가 큐 보기 →                  │
│ 답변 못함(폴백)           7      1    부정 평가 큐 보기 →                  │
└───────────────────────────────────────────────────────────────────────────┘
```

### 3.4.1 지표 카드

| 카드 | 값 | 캡션 |
|---|---|---|
| 평가 수 | `ratedCount` | "👍{upCount} 👎{downCount}" |
| 긍정률 | `positiveRate`(％, `null`이면 "—") | "표본 {ratedCount}건" + `lowSample === true`일 때 "표본이 적어요" 추가(기존 `stats-learning` L1의 저표본 캡션 패턴과 동일 톤) |
| 참여율 | `participationRate`(％, `null`이면 "—") | "버튼 노출 {offeredCount}건 중 · 하한값" + `ParticipationRateHelp`(§2.2) |

세 카드 모두 기존 `MetricCard`(3-prop: `label`/`value`/`caption`)를 **변경 없이** 재사용한다(S1의 기존 5카드와 동일 원칙, FR-C-10 상속).

### 3.4.2 일별 추이 · 👎 상위 대상

**이탈 확정 (구현 리뷰 R2, 2026-09-25)**: 설계 초안의 "막대 + 긍정률 선" 오버레이는 구현하지 않는다. 코드베이스에 라인 차트 SVG 프리미티브가 없고(`BarChartSvg`는 막대 전용 — 다른 통계 패널·`UnansweredTable`의 발생 추이와 공유하는 유일한 차트 프리미티브다), 이 그룹 하나만을 위해 신규 라인 프리미티브를 도입하지 않기로 확정했다. **라인 오버레이는 라인 프리미티브가 도입되면 후속 검토한다.**

- 추이는 기존 `ChartFrame`(§2.5 `stats-learning-ui-spec.md`) + `BarChartSvg`를 그대로 재사용한다 — 표 보기 토글·SVG `aria-hidden` 규칙은 §2.5 그대로 적용한다. 시각화는 **👍(파랑)/👎(사선 hatch 패턴) 누적 막대뿐**이다(선 오버레이 없음).
- 긍정률의 변화는 막대 위 선이 아니라 `ChartFrame`의 **`role="img"` 요약 문장**으로 전달한다: `buildTrendSummary`(§2.5의 공용 조립 규칙과 동일한 함수)가 일별 `positiveRate` 중 **유효값(널 제외)의 첫 값과 마지막 값을 비교**해 "최근 {N}일간 긍정률은 {A}%에서 {B}%로 {상승/하락/유지}했습니다" 문장을 조립한다(유효 버킷이 1개면 "선택한 기간의 긍정률은 {A}%입니다"). 새 집계값을 만들지 않는 표시 전용 조립이므로 NFR-M2("서버 값을 표시만 한다")를 위반하지 않는다.
- `표로 보기` 표에는 날짜별 👍 수·👎 수 옆에 **긍정률 열**을 추가한다 — 막대와 요약 문장만으로는 보이지 않는 일자별 수치를 표에서 확인할 수 있게 한다.
- 범례는 색상 단독이 아니다: `■ 👍`(파랑 채움) / `▦ 👎(사선 패턴)`(해치 패턴) — 문구는 `MESSAGES.stats.feedbackLegendUp`('👍')/`feedbackLegendDown`('👎(사선 패턴)')(§8). 선이 없으므로 "─ 긍정률" 범례 항목은 두지 않는다.
- `TopNegativeTargetsTable`: 유형(텍스트, `FEEDBACK_TARGET_KIND_LABELS` 라벨 — "노드"/"FAQ"/"의도"/"문서 답변"/"답변 못함(폴백)"/"연동 안내"/"기타") · 이름(삭제된 자산은 "삭제됨", 링크 없음) · 👎 수 · 👍 수 · "부정 평가 큐 보기 →" 링크.
- **질문 문장은 어디에도 없다**(원장에 텍스트 컬럼 자체가 없다, FR-FB8-4 — 구조적 보장). "부정 평가 큐 보기" 링크는 `/chatbots/:id/stats/learning?source=NEGATIVE_FEEDBACK`으로 이동한다 — **특정 대상으로 좁혀진 필터가 아니다**(큐 API에 대상별 필터가 없다는 알려진 제약, backend-implementer 인계 메모 §9). 행 옆에 작은 안내 없이 링크 라벨 자체로 이 사실을 전달한다("큐 보기"이지 "이 답변의 큐 보기"가 아님).

### 3.4.3 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | 카드 자리 `SkeletonCard` × 3, 추이/표 자리 `SkeletonRow` |
| **빈 상태 ① — 기간 내 `offeredCount === 0`**(평가 버튼을 보여준 적이 없음) | `EmptyState`: "이 기간에는 답변 평가가 없습니다." + 설명 "채널 설정에서 '답변 평가 받기'를 켜면 평가를 모을 수 있습니다." + (EDITOR/ADMIN만) "채널 설정으로 이동" 링크(VIEWER/AGENT는 링크 없이 설명만) |
| **빈 상태 ② — `offeredCount > 0` ∧ `ratedCount === 0`**(버튼은 노출됐지만 평가가 없음) | `EmptyState`: "평가 버튼은 노출되었지만 아직 남겨진 평가가 없습니다." |
| 저표본(`lowSample === true`, `ratedCount > 0`) | 빈 상태 아님 — 데이터는 그대로 표시하되 긍정률 카드에 "표본이 적어요" 캡션 |
| 분모 0(개별 지표) | 해당 카드 값 "—"(긍정률·참여율 각각 독립적으로 `null` 처리 가능 — 예: `offeredCount=0`이지만 이론상 `ratedCount>0`인 경우는 없음, AC-FB6-1 픽스처 기준 `participationRate ≤ 1` 보장) |
| 기간 상한 초과 | 기존 `GranularityPeriodControl` 인라인 오류 공유(S1과 동일 메커니즘, 별도 처리 없음) |
| 부분 실패(이 섹션만 오류, 다른 3패널은 정상) | 이 섹션에만 `ErrorState` + 다시 시도(F-3 확장 원칙) |
| 집계 타임아웃(`503`) | "집계에 시간이 오래 걸리고 있습니다. 잠시 후 다시 시도해 주세요." + 다시 시도(S1 기존 문구 재사용) |

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `AnswerFeedbackSection` | `chatbotId`, `granularity/from/to`(S1 상위 상태 공유) → `GET /stats/feedback?chatbotId&from&to&topN` 독립 훅 |
| `MetricCardRow`(재사용) | `totals` → 카드 3장(§3.4.1) |
| `ChartFrame`+`BarChartSvg`(재사용) | 일별 추이(§3.4.2) — 막대만, 선 프리미티브 없음 |
| `TopNegativeTargetsTable`(신규) | `topNegativeTargets[]` → §3.4.2 |
| `ParticipationRateHelp`(신규) | 고정 텍스트(§2.2) |

---

## 3.5 FB-NAV — 탭 배지: 부정 피드백 전용 배지

### 설계 판단 (backend/설계서 §20이 남긴 갭 해소)

`feedback-loop-설계.md` §11.2·§20은 요약 API의 `pendingCount`가 **두 소스 합계**로 바뀐다는 점, 그리고 "대시보드의 '미응답 대기' 표시가 요약 `pendingCount`를 쓰면 부정 평가가 섞인다"는 문제를 이미 지적하며 ui-designer 판단에 맡겼다. 이 문서의 결정은 다음과 같다.

> **기존 `NavPendingBadge`(StatsSubNav "학습현황" 항목·TabNav "통계" 탭)는 `summary.bySource.UNANSWERED.pendingCount`를 쓴다(합계 `pendingCount` 아님).** 의미가 "미응답만"으로 **바이트 단위까지는 아니어도 값 단위로 불변**이다(PM 결정 그대로). 새로 만든 `NegativeFeedbackNavBadge`가 `summary.bySource.NEGATIVE_FEEDBACK.pendingCount`를 **별도로** 표시한다.

### 상태 소유 위치 — `ChatbotDetailLayout`로 끌어올림 (이탈 확정, 구현 리뷰 R2·2026-09-25)

`TabNav`는 `StatsShell`(따라서 `Outlet`) **밖**에 있다 — `ChatbotDetailLayout`이 헤더·상태 전환 컨트롤 다음에 `<TabNav .../>`를 렌더하고, 그 아래 별도로 `<div className="tab-content"><Outlet .../></div>`를 렌더하는 **형제 구조**다(`apps/web/src/pages/ChatbotDetailLayout.tsx`). `StatsShell`이 `useOutletContext`로 하위(`LearningQueuePage` 등)에 값을 내려주는 방식은 `Outlet` 안쪽에서만 유효하므로 `TabNav`에는 닿지 않는다.

이에 따라 learning summary(`GET .../unanswered-questions/summary`) 상태는 **`TabNav`와 `Outlet`의 공통 부모인 `ChatbotDetailLayout`**으로 끌어올린다:

- `ChatbotDetailLayout`이 챗봇 상세가 마운트될 때(챗봇 로드 성공 후) **1회**, `dialogue:read` 권한이 있을 때만 `learningApi.summary(chatbotId)`를 호출해 `learningSummary`/`refreshLearningSummary`를 소유한다.
- `TabNav`는 이 값을 **prop**으로 받아 배지를 그린다 — 더 이상 자체적으로 `learningApi.summary`를 호출하지 않는다. `TabNav` 배지는 기존과 동일하게 `NavPendingBadge`(미응답)와 `NegativeFeedbackNavBadge`를 **나란히** 두는 형태다(색·아이콘·`aria-label`로 구분, §2.1).
- `StatsShell`은 이 값을 `ChatbotDetailLayout`으로부터 그대로 전달받아(자체 재조회 없이) `StatsSubNav` 배지에 쓰고, 기존과 같은 `Outlet context`로 `LearningQueuePage`(`SourceTabStrip` 카운트)까지 내려보낸다.
- **`TabNav` 배지 · `StatsSubNav` 배지 · `SourceTabStrip` 카운트는 동일한 단일 상태를 공유한다** — 세 곳이 각자 조회하지 않는다.
- `[직접 수정 완료]`/`[반영]`/`[무시]` 등 처리 액션 후에는 `refreshLearningSummary`(이제 `ChatbotDetailLayout` 소유)가 이 **세 곳을 한 번에** 갱신한다(§3.3).

### API 호출 규모 정정 (이탈 확정)

설계 초안의 "API 호출 추가 0"은 "`StatsShell` 마운트 시 1회 호출하는 기존 API가 필드만 더 반환한다"는 전제였다. 그 전제는 **상태를 `StatsShell`이 소유하는 한**에서만 맞다 — `TabNav`가 `StatsShell`/`Outlet` 밖에 있다는 사실이 구현 리뷰에서 확인되며, 상태를 `ChatbotDetailLayout`으로 끌어올리는 이번 결정에 따라 실제 호출 시점이 바뀐다.

- **이전(설계 원안)**: `learningApi.summary` 호출은 사용자가 통계 탭(`/stats/*`)에 들어가 `StatsShell`이 마운트될 때만 발생했다.
- **지금(구현 리뷰 R2 확정)**: 호출은 **챗봇 상세 화면이 마운트되는 시점**(대시보드/설계/검증/배포 등 어느 탭이든) `ChatbotDetailLayout`에서 1회 발생한다. 사용자가 끝내 통계 탭에 들어가지 않아도 `dialogue:read` 권한만 있으면 이 호출은 일어난다.
- 그러므로 **"API 호출 추가 0"은 더 이상 정확하지 않다 — 정정: 챗봇 상세 진입당 신규 API 호출 1회 추가**(통계 탭 진입 여부와 무관, `dialogue:read` 권한이 있을 때만). 엔드포인트·응답 스키마·필드(`bySource`) 자체는 변경이 없다(그 부분은 원래 판단대로 "신규 API 0개, 필드만 더 반환"이 맞다) — **바뀐 것은 "몇 번 언제 부르는가"이지 "무엇을 부르는가"가 아니다.**
- 부수 효과로, 이번 정정은 이탈 확정 이전의 실제 버그도 함께 없앤다: 정정 전 구현은 `TabNav`가 **별도로** `learningApi.summary`를 호출하고 있어(자체 `useEffect`) `StatsShell`의 호출과 **중복**되고 있었다(같은 챗봇 상세 화면에서 통계 탭에 들어가면 2회 호출). 상태를 한 곳(`ChatbotDetailLayout`)으로 모으면 이 중복이 사라지고, 순수 합계로는 "탭 이동과 무관하게 챗봇 상세당 정확히 1회"가 된다.

### 배치

```
[StatsSubNav]  기본 통계 | 학습현황 (●3 · 부정평가 ●2)
[TabNav]       … | 통계(●3 · ●2) | …
```

- 두 배지는 **시각적으로 붙어 있지만 서로 다른 색·아이콘·`aria-label`**을 가진 별개의 `<span>`이다(1개의 병합 숫자가 아니다) — 스크린리더는 "대기 중인 미응답 질문 3건, 대기 중인 부정 평가 2건"으로 순서대로 듣는다.
- `count === 0`인 배지는 렌더하지 않는다(기존 `NavPendingBadge` 규칙 그대로, §2.2 `stats-learning-ui-spec.md`) — 미응답 0건·부정 평가 2건이면 "학습현황 (부정평가 ●2)"만 보인다.
- 999건 초과 시 "999+"로 자르고 `aria-label`에는 정확한 값(기존 규칙 상속).
- 데이터 원본: `ChatbotDetailLayout`이 챗봇 상세 마운트 시 1회 호출하는 `GET .../unanswered-questions/summary` 응답의 `bySource`(FR-FB6-7)를 `TabNav`·`StatsShell`·`LearningQueuePage`(`SourceTabStrip`)가 함께 쓴다(위 "상태 소유 위치" 참고). 호출 횟수에 대한 정확한 서술은 위 "API 호출 규모 정정" 절을 따른다("API 호출 추가 0"이라는 이전 문구는 폐기).

---

## 4. 권한별 UI 변화 규칙

원칙(F-7·기존 학습현황/통계 권한 상속): 쓰기 액션은 권한이 없으면 **렌더 자체를 하지 않는다**(숨김, 비활성 아님). 서버가 최종 판정자다.

| 화면/동작 | VIEWER | EDITOR | AGENT | ADMIN |
|---|---|---|---|---|
| FB-CH 스위치 조회 | 표시(`channel:read`) | 표시 | 접근 불가(CH1 자체가 `dialogue`/`channel` 권한 밖) | 표시 |
| FB-CH 스위치 저장 | **숨김**(체크박스 `aria-disabled`) | 가능(`channel:write`) | — | 가능 |
| FB-W 위젯 평가 버튼(최종 사용자) | — | — | — | — (공개, 역할 무관) |
| FB-L1 목록/필터/탭/펼침 상세/추천 조회 | 표시(`dialogue:read`) | 표시 | **접근 불가**(`dialogue:read` 없음 — 기존 L1 규칙 상속) | 표시 |
| FB-L1 반영/무시/`[직접 수정 완료]`/체크박스·일괄 액션 | **숨김** | 표시(`dialogue:write`) | — | 표시 |
| FB-S1 "답변 만족도" 섹션 | 표시(`chatbot:read`) | 표시 | 표시(`chatbot:read` 보유 — AC-FB8-1) | 표시 |
| FB-NAV 배지(양쪽) | 표시(조회 권한만 있으면) | 표시 | 숨김(학습현황 자체 접근 불가이므로 그 배지도 렌더 안 함) | 표시 |

`AGENT`는 기존 하이브리드 CS 그룹에서 확정된 대로 `chatbot:read`로 열리는 화면(FB-S1)에는 접근하지만 `dialogue:*` 화면(FB-L1)에는 접근하지 못한다 — 이 그룹이 그 경계를 바꾸지 않는다.

---

## 5. 사용자 인터랙션 흐름 (제출 → 로딩 → 결과, 오류 포함)

### 5.1 평가 남기기 → 변경 (S-1, S-2, 최종 사용자)

```
봇 답변 렌더(feedback.rateable === true)
  → FeedbackBar 렌더(같은 삽입 동작, 재낭독 없음)
사용자 👎 클릭
  → 즉시 aria-pressed="true"(낙관적) + 요청 전송
  → 200 성공 → #cb-status "의견을 보내 주셔서 고마워요"(1회) → 2초 뒤 #cb-status 비움
  → (백그라운드) 첫 👎면 큐 편입 시도(사용자에게 보이지 않음)
사용자가 마음이 바뀌어 👍 클릭(변경, 24시간·5회 이내)
  → aria-pressed 두 버튼 모두 즉시 갱신(👍=true, 👎=false)
  → 200 성공 → 같은 안내 1회(큐 기여는 이미 발생했으므로 유지 — 통계만 현재값 👍로 반영)
선택된 버튼 다시 클릭
  → 무동작(요청 없음, 취소 불가)
```

### 5.2 저장 실패 → 재시도 (EX-FB-3, EX-FB-4)

```
👎 클릭 → 요청 실패(404 — 예: 보류 RAG READY 직후 로그 적재 전)
  → 1초 대기 → 자동 재시도(사용자 조작 없음, aria-busy 유지)
  → 재시도 성공 → 정상 완료 흐름
  → 재시도도 실패 → 두 버튼 disabled + "지금은 의견을 받을 수 없어요"(#cb-status 1회 + .cb-feedback-note)
```

### 5.3 부정 평가 큐 검토 → 처리 (S-3~S-6, EDITOR/ADMIN)

```
StatsSubNav "학습현황" 배지에 "부정평가 ●2" 확인
  → L1 진입 → SourceTabStrip "부정 평가" 탭 클릭(목록 재조회, 페이지 이동 아님)
  → 목록에서 "환불 얼마나 걸리나요?" 행(출처: 부정평가) 확인, "당시 답변: FAQ '환불 안내'" 보조 텍스트 확인
  → 행 펼침(▸, Enter/Space) → LastFeedbackAnswerPanel + SuggestionList + CurrentMatchBadge 확인
분기 A: 잘못 매칭(추천 후보 중 더 적합한 의도가 있음)
  → [이 의도로 반영] → ResolveModal(기존) → 저장 → 항목 '반영 완료'로 전환
분기 B: 매칭은 맞지만 내용이 틀림(CurrentMatchBadge가 붙은 의도가 맞음)
  → [FAQ 편집] 링크로 이동 → 답변 내용 수정 → 저장 → L1로 복귀
  → [직접 수정 완료] 클릭 → 즉시 처리(확인 대화상자 없음) → 항목 '반영 완료(직접 수정)'로 전환
  → aria-live="polite" 1회 "직접 수정 완료로 처리되었습니다."
```

### 5.4 기능 켜기 (S-9, EDITOR/ADMIN)

```
CH1 진입 → WEB 카드 "설정 열기" → FeedbackEnabledField 체크
  → [저장] → PATCH .../channels/WEB(config 전체, feedbackEnabled 포함)
  → 성공 → Toast "저장되었습니다."
  → (이후) 새로 시작되는 대화부터 위젯 평가 버튼이 보인다. 이미 열려 있던 대화창의 과거 말풍선에는 소급 적용되지 않는다.
```

### 5.5 오류 처리 총괄

| 상황 | 처리 |
|---|---|
| FB-CH 저장 중 채널이 보관됨(`409`) | 폼 상단 배너, 체크박스 값은 유지(재시도 가능) |
| FB-L1 `[직접 수정 완료]` 경합 실패 | §3.3 참고(자동 재조회 또는 인라인 오류) |
| FB-L1 반영 시 "현재 매칭"과 같은 의도 선택 | 저장은 성공, 비차단 경고만(기존 `ResolveModal` 패턴 재사용) |
| FB-S1 집계 타임아웃 | 해당 섹션만 재시도 버튼, 다른 패널 영향 없음 |
| FB-W 429 | 조용히 직전 값 복귀(사용자에게 오류로 보이지 않음 — 의도적으로 소음 최소화) |

---

## 6. `UIUX_준수기준.md` 체크리스트 매핑

### 6.1 공통(전 신규 화면 + 위젯)

| 기준 | 항목 | 적용 |
|---|---|---|
| §1 색상대비 | 텍스트 4.5:1 / 비텍스트 3:1, 색상 단독 금지 | `FeedbackSourceBadge`/`CurrentMatchBadge`/`NegativeFeedbackNavBadge`/`FeedbackBar` 선택 상태 전부 색+텍스트+아이콘 3중(§3.2.3) |
| §3 키보드접근성 | Tab 순차, Enter/Space 실행, 포커스 순서 | `FeedbackBar` 버튼 2개는 네이티브 `<button>`(Tab 순차, Enter/Space 즉시 실행) · L1 `[직접 수정 완료]`도 네이티브 버튼 |
| §4 버튼 | 동사형 레이블, 중복 실행 방지, 터치 44×44px | "직접 수정 완료"(동사형) · `FeedbackBar` 요청 중 `aria-busy`로 중복 클릭 방지 · 버튼 44×44px(§3.2.3) |
| §5 텍스트 입력 | 해당 없음(이 그룹은 신규 텍스트 입력 필드가 없다 — 자유 텍스트 사유 1차 미포함, FR-FB5-2) | — |
| §6 폼 컨트롤 | 단일선택=라디오/셀렉트, 값 변경 자동 제출 금지 | `FeedbackEnabledField`(체크박스, 기본값 임의 사전선택 없음 — 저장된 값 그대로) · `SourceTabStrip`은 세그먼트 탭(값 변경이 "필터 재조회"이므로 예외 해석, §2.2 각주) |
| §7 오류 메시지 | 원인+해결방법, 제출 시점 표시 | `NegativeFeedbackLimitBanner`("도달 + 검토 후 정리") · 위젯 상태별 문구 전부 "원인을 알 수 있는 짧은 문장"(§3.2.4) |
| §8 로딩/상태 | 스켈레톤/스피너, 완료 시 배지 | FB-S1 4번째 패널 독립 스켈레톤/오류(§3.4.3) · `FeedbackBar` `aria-busy` 스피너 |
| §9 내비게이션 | href 기반, 페이지네이션 이중 표시 | `CounterpartLink`/`FeedbackTargetEditLink`/"부정 평가 큐 보기" 전부 href 기반 라우팅(새 탭 강제 없음) |

### 6.2 화면별 특기 사항

| 화면 | UIUX 항목 | 적용 지점 |
|---|---|---|
| FB-W | §1 + §4 | 버튼 2개, 텍스트 접근 이름 필수(아이콘 단독 금지) — 대화형 설문 버튼 규칙(UIUX §4)과 동일 원칙을 평가 버튼에도 적용 |
| FB-L1 소스 탭 | §3 + §6 | `SourceTabStrip` 키보드 좌우 이동은 필수 아님(표준 Tab만으로도 각 탭에 순차 도달 가능하게 구현 — 3개뿐이라 로빙 탭 불필요) |
| FB-S1 차트 | §1 + `ChartFrame` 재사용 | 표 보기 토글·`role="img"` 요약 그대로 상속(§2.5 `stats-learning-ui-spec.md`) — 막대만(사선 패턴), 선 오버레이 없음(§3.4.2) |
| FB-NAV 배지 | §1 | 두 배지 색상 구분 + `aria-label`로 의미 구분(색만으로 "미응답"과 "부정평가"를 구분하지 않음) |

### 6.3 UIUX_준수기준.md 신규 보강 1건 (§8 로딩/상태 피드백)

기존 10개 카테고리에 "로그 영역 안의 보조 버튼 상태 변화가 새 노드를 만들지 않고 속성 변경 + 상태 영역 1회 안내로 전달되어야 한다"는 규칙이 명시돼 있지 않았다(`FeedbackBar`가 처음으로 이 패턴을 요구하는 케이스). §8에 아래 항목을 추가했다(파일 반영 완료, 날짜 2026-09-25):

> **대화 로그 안의 보조 버튼 상태 변화(예: 답변 평가 버튼)**: 대화 메시지 목록(`role="log"`)처럼 `aria-live`로 자동 낭독되는 영역 안에 있는 보조 상호작용 요소(토글 버튼 등)의 상태 변화는 **새 DOM 노드를 추가하지 않고** 기존 요소의 속성(`aria-pressed`/`disabled`)과 텍스트만 바꾼다. 사용자에게 들려줄 안내는 그 영역의 `aria-live` 재낭독에 맡기지 않고 **별도의 상태 알림 영역에서 1회만** 전달한다(토글 버튼은 `aria-pressed` + 아이콘이 아닌 텍스트 이름을 항상 함께 제공). → 챗봇 위젯의 답변 평가 버튼(`feedback-loop-ui-spec.md` §3.2).

### 6.4 자동화 연계

axe(위젯 `FeedbackBar`·L1 신규 요소·S1 신규 섹션) 대비 위반 0, 키보드만으로 "평가 → 변경 → 목록 필터 → 직접 수정 완료" 완주(AC-FB7-6)는 `test-automation` 검증 대상이며, 이 문서의 배지 색+텍스트 병기·`ChartFrame` 재사용·네이티브 버튼 사용 규칙이 그 전제 조건이다.

---

## 7. 반응형 고려사항

### 7.1 관리자 콘솔(`apps/web`)

| 브레이크포인트 | 레이아웃 변화 |
|---|---|
| 데스크톱 ≥1024px | FB-CH: 기존 WEB 폼 레이아웃 그대로(필드 1개 추가). FB-L1: `SourceTabStrip` 가로 3탭, "출처" 열 포함 6열 표. FB-S1: 카드 3장 가로 1줄, 추이/표 각 전체 폭 1단 |
| 태블릿 640–1023px | FB-L1: 표 열 폭 축소(기존 §10 규칙과 동일 — 추천 의도 열을 펼침 상세로 이동). FB-S1: 카드 3장 2~3열 줄바꿈 |
| 모바일 <640px | FB-CH: 체크박스 풀폭. FB-L1: 기존 §10의 `UnansweredCard`(카드 리스트) 안에 "출처" 라벨+값 스택 추가, `SourceTabStrip`은 가로 스크롤 가능한 세그먼트(3개뿐이라 줄바꿈 없이 스크롤로 충분). FB-S1: 카드 세로 스택, 추이 차트는 기본값을 "표 보기"로 전환(기존 S1 §10 규칙 상속) |

공통: `NegativeFeedbackLimitBanner`는 모바일에서도 문서 흐름 상단 고정(sticky 아님, 기존 배너류와 동일).

### 7.2 위젯(`apps/widget`)

- `FeedbackBar`의 두 버튼은 기본 가로 배치, 패널 폭이 좁으면(`mode: 'mobile'`, `/c/:slug` 전체화면 포함) `flex-wrap`으로 자연스럽게 줄바꿈되어 **세로 스택**으로 전환된다(레이아웃 붕괴 없음, 별도 상태 분기 불필요 — CSS만으로 처리).
- 버튼 최소 터치 영역 44×44px은 데스크톱·모바일 동일하게 유지한다(UIUX §4).
- `.cb-feedback-note`(시각 전용 안내 텍스트)는 좁은 화면에서 버튼 아래로 줄바꿈된다.

---

## 8. `messages.ts` 신규 키 목록

### 8.1 `apps/web/src/constants/messages.ts`

`MESSAGES.channels`에 추가:

```
feedbackEnabledLabel: '답변 평가 받기'
feedbackEnabledDesc: "켜면 챗봇 답변마다 '도움이 됐어요/도움이 안 됐어요' 버튼이 보입니다. 새 답변부터 적용돼요."
```

`MESSAGES.learning`에 추가:

```
sourceTabAll: '전체'
sourceTabUnanswered: (n: number) => `답변 못함 (${n})`
sourceTabNegativeFeedback: (n: number) => `부정 평가 (${n})`
sourceBadgeUnanswered: '답변 못함'
sourceBadgeNegativeFeedback: '부정 평가'
resolvedDirectlyLabel: '반영 완료(직접 수정)'
negativeFeedbackCountLabel: (n: number) => `부정 평가 ${n}회`
negativeFeedbackLimitBanner: (n: number) => `부정 평가 질문이 상한(${n}건)에 도달했습니다. 검토 후 정리해 주세요.`
lastFeedbackAnswerTitle: '당시 봇 답변'
currentMatchBadge: '현재 매칭'
currentMatchWarning: '지금도 이 의도로 답하고 있어요 — 답변 내용 수정이 필요할 수 있어요'
counterpartLink: (sourceLabel: string, statusLabel: string) => `같은 질문의 ${sourceLabel} 항목(${statusLabel})이 있습니다 →`
targetEditLinkFaq: 'FAQ 편집'
targetEditLinkNode: '노드 편집'
targetEditLinkIntent: '의도 편집'
targetDeletedLabel: '삭제됨'
markAddressedAction: '직접 수정 완료'
markAddressedSuccess: '직접 수정 완료로 처리되었습니다.'
markAddressedDisabledUnanswered: '답변 못함 항목은 반영(예문 추가)으로 처리해 주세요.'
markAddressedDisabledResolved: '이미 처리되었습니다.'
trendSourceLedger: '이 소스는 정확한 집계입니다.'
emptyNoneNegativeFeedbackTitle: '부정 평가로 들어온 질문이 없습니다.'
emptyNoneNegativeFeedbackDesc: '답변 평가 기능을 켜면 👎를 받은 답변이 여기로 모입니다.'
```

`MESSAGES.stats`에 추가(FB-S1):

```
feedbackSectionTitle: '답변 만족도'
feedbackRatedCountLabel: '평가 수'
feedbackPositiveRateLabel: '긍정률'
feedbackParticipationRateLabel: '참여율'
feedbackParticipationHelp: '참여율 = 평가 수 ÷ 버튼을 보여준 답변 수. 응답을 기다리다 새 질문으로 넘어가거나 창을 닫은 경우도 분모에 포함되어 실제보다 낮게 보일 수 있습니다(하한값).'
feedbackLowSampleCaption: '표본이 적어요'
feedbackSampleCaption: (n: number) => `표본 ${n}건`
feedbackOfferedCaption: (n: number) => `버튼 노출 ${n}건 중 · 하한값`
feedbackTrendTitle: '일별 추이'
feedbackLegendUp: '👍'
feedbackLegendDown: '👎(사선 패턴)'
feedbackTopNegativeTitle: '👎가 많이 모인 답변'
feedbackTopNegativeColumnKind: '유형'
feedbackTopNegativeColumnName: '이름'
feedbackTopNegativeQueueLink: '부정 평가 큐 보기 →'
feedbackEmptyNoOfferTitle: '이 기간에는 답변 평가가 없습니다.'
feedbackEmptyNoOfferDesc: "채널 설정에서 '답변 평가 받기'를 켜면 평가를 모을 수 있습니다."
feedbackEmptyNoOfferAction: '채널 설정으로 이동'
feedbackEmptyNoRatingTitle: '평가 버튼은 노출되었지만 아직 남겨진 평가가 없습니다.'
feedbackTargetKind: { NODE: '노드', FAQ: 'FAQ', INTENT: '의도', RAG: '문서 답변', FALLBACK: '답변 못함(폴백)', API_NOTICE: '연동 안내', OTHER: '기타' }
```

`feedbackLegendUp`/`feedbackLegendDown`은 FB-S1 일별 추이 차트의 범례 문구다(§3.4.2 이탈 확정 — "막대 + 긍정률 선"이 아니라 👍/👎 누적 막대만 그리므로, 선 범례("─ 긍정률")는 없다).

`StatsSubNav`/`TabNav` 배지 관련(§2.1 상속 네임스페이스에 추가):

```
negativeFeedbackBadgeLabel: (n: number) => `대기 중인 부정 평가 ${n}건`
```

### 8.2 `apps/widget/src/constants/messages.ts`

§3.2.5와 동일(재기재):

```
feedback: {
  groupLabel: '답변 평가',
  up: '도움이 됐어요',
  down: '도움이 안 됐어요',
  thanks: '의견을 보내 주셔서 고마워요',
  saveFailed: '저장하지 못했어요',
  unavailable: '지금은 의견을 받을 수 없어요',
  locked: '더 이상 바꿀 수 없어요',
}
```

위젯이 평가와 관련해 사용자에게 보여주는 문구는 **이 7개가 전부**다.

---

## 9. `frontend-implementer`/위젯 구현자 인계 메모

1. **FB-CH는 config 전체 교체다** — `feedbackEnabled`를 다른 WEB 필드와 별도로 저장하면 안 되고, 항상 같은 `PATCH` 요청 안에 포함한다(§3.1 ⚠, 빠뜨리면 스위치가 조용히 꺼진다).
2. **위젯 버튼은 서버 표시가 있을 때만** 렌더한다 — 위젯이 턴 유형을 보고 스스로 평가 가능 여부를 추정하지 않는다(`res.feedback?.rateable`만 본다).
3. **`#cb-messages`에 새 노드를 추가하지 않는다** — `FeedbackBar`는 말풍선과 **같은 삽입 동작**으로 붙이고, 이후 상태 변화는 속성/텍스트만 바꾼다(재낭독 방지, §3.2.1).
4. **스크린리더 안내는 `#cb-status` 1회만** — `.cb-feedback-note`는 `aria-hidden="true"` 시각 전용 텍스트다(이중 낭독 금지, §3.2.2).
5. **취소 없음** — 선택된 버튼 재클릭은 완전 무동작(요청조차 보내지 않는다).
6. **404는 1초 뒤 1회만 자동 재시도**(사용자 조작 없이) — 보류 RAG `READY` 직후 로그 경쟁을 흡수하기 위한 장치다.
7. **FB-L1 `[직접 수정 완료]`는 `NEGATIVE_FEEDBACK` ∧ `PENDING`에서만 활성** — 그 외에는 버튼을 숨기지 말고 비활성 + 사유 텍스트로 렌더한다(권한 없으면 숨김, 상태가 안 맞으면 비활성 — 두 규칙을 혼동하지 않는다).
8. **FB-NAV 배지는 `bySource`를 쓴다** — 합계 `pendingCount`를 기존 "미응답" 배지에 쓰면 의미가 바뀐다(§3.5). **상태는 `ChatbotDetailLayout`이 1회 소유**하고 `TabNav`/`StatsShell`/`LearningQueuePage`(`SourceTabStrip`)가 이를 공유한다 — `TabNav`가 자체적으로 `learningApi.summary`를 다시 호출하면 `StatsShell`의 호출과 중복된다(이탈 확정 이전 실제로 있었던 버그, §3.5 "API 호출 규모 정정" 참고).
9. **위젯 gzip 100KB 게이트** — 빌드 로그에 증가분을 남긴다(예상 +1~2KB).
10. **FB-S1 신규 섹션은 독립 API 호출** — 다른 3패널의 로딩/오류와 서로 영향을 주지 않게 구현한다(F-3 확장).
11. **FB-S1 추이 차트에 라인 프리미티브를 새로 만들지 않는다** — 👍/👎 누적 막대(`BarChartSvg`, 사선 hatch 패턴)와 `ChartFrame`의 `role="img"` 요약 문장(`buildTrendSummary`)으로 충분하다(§3.4.2 이탈 확정). 라인 오버레이 요청이 다시 들어오면 라인 프리미티브 도입을 `system-architect`/`ui-designer`와 먼저 논의한다.

---

## 10. 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-09-25 | 구현 리뷰 R2 반영 — ① §3.4.2/§3.4(ASCII)/§6.2/§8.1 FB-S1 일별 추이: "막대 + 긍정률 선" 오버레이 대신 👍/👎 누적 막대 + `ChartFrame role="img"` 요약(`buildTrendSummary`) + 표 보기 긍정률 열로 확정(라인 프리미티브 부재, 후속 검토로 이관), 범례 문구 `feedbackLegendUp`/`feedbackLegendDown` §8에 추가. ② §0/§2.1/§3.3/§3.5/§9 FB-NAV: learning summary 상태를 `StatsShell`이 아니라 `ChatbotDetailLayout`(TabNav·Outlet의 공통 부모)으로 끌어올려 TabNav 배지·StatsSubNav 배지·SourceTabStrip 카운트가 단일 상태를 공유하도록 확정, "API 호출 추가 0" 전제를 "챗봇 상세 진입당 신규 호출 1회 추가(통계 탭 진입 여부 무관)"로 정정. |
