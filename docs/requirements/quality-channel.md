# 품질/채널 (기능그룹) — 요구사항 정의서

> **대상 기능**: `docs/01-requirements/기능요구사항.md` §2 기본기능 No.10~11
> | No | 기능 그룹 | 기능명 | GPU | 구축형 | 구독형 |
> |---|---|---|---|---|---|
> | 10 | 품질 관리 | 응답 테스트/시뮬레이션 | 1 | ○ | ○ |
> | 11 | 채널/연동 | 다양한 채널 제공 | 1 | ○ | ○ |
>
> **선행 문서**: `docs/01-requirements/기능요구사항.md`, `docs/02-spec/개발명세서.md`(§1 아키텍처, §2.1 계층규약, §3 데이터모델, §4 API 공통규약, §5 비기능, §6 결정사항), `docs/03-design/UIUX_준수기준.md`
> **선행 그룹**: `docs/requirements/chatbot-operations.md`(No.1~4), `docs/requirements/dialogue-design.md`(No.5~9), `docs/02-spec/chatbot-operations-설계.md`, `docs/02-spec/dialogue-design-설계.md`(4계층 규약·ADR-0001~0008) — 본 문서는 그 규약을 **상속**한다.
> **선행 산출물(구현 완료분)**: `packages/dialogue-engine`(`resolveResponse`/`executeOutputs`/`buildDialogueIndex`/`validateDialogueDesign`/`buildFlowTree`), `packages/shared-types/src/dialogue-engine.ts`, `apps/api/prisma/schema.prisma`의 `Channel`·`ConversationLog`, `apps/api/src/chatbots/embed-code.service.ts`
> **작성일**: 2026-09-20 · **다음 단계**: `system-architect` → `ui-designer` → `backend-implementer` → `frontend-implementer` → `code-reviewer` → `test-automation`

---

## 1. 배경 / 목적

### 1.1 배경

1차 개발 범위(기본기능 No.1~15) 중 두 그룹이 `main`(커밋 `7e19c40`)에 병합되었다.

- **No.1~4(챗봇 운영관리)**: `Chatbot` 루트 엔터티, 4계층 모듈 컨벤션, 오류 봉투, 삭제 정책, **임베드 코드 생성**까지.
- **No.5~9(대화 설계)**: 의도/키워드/동음이의어/컨텍스트/FAQ/대화노드 CRUD와 **대화 해석 엔진 `resolveResponse()`**(ADR-0008)까지.

그 결과 현재 시스템은 **"말할 내용은 전부 갖췄는데 말할 통로가 없는" 상태**다. 구체적으로 세 가지 공백이 남아 있다.

| 공백 | 현재 상태 | 이 그룹이 메우는 방식 |
|---|---|---|
| ① 엔진을 부를 HTTP 경로가 없다 | `resolveResponse()`는 완성됐으나 이를 호출하는 REST 엔드포인트가 **0개**다(직전 그룹이 "No.10 몫"으로 명시적으로 미뤘다). 현재 엔진을 건드리는 API는 `POST /homonyms/test`와 `POST /dialog-nodes/validate` 둘뿐이다 | No.10 시뮬레이션 API + No.11 공개 대화 API |
| ② 임베드 코드가 가리키는 대상이 없다 | `EmbedCodeService`가 `{WIDGET_BASE_URL}/widget.js` 스니펫을 생성·복사까지 제공하지만 **`apps/widget`이 스캐폴딩조차 안 돼 있어** 붙여넣으면 404다(FR-4-15가 "위젯 Phase에서 검증"으로 유보) | No.11 — `apps/widget` 최소 버전 + WEB 채널 종단 연결 |
| ③ `ConversationLog`를 쓰는 주체가 없다 | No.2 대시보드는 "로그 0건이 정상 시나리오"로 구현됐고, ADR-0001의 `sessionId` 컬럼도 seed에만 값이 있다 | No.11 공개 대화 API가 **최초의 로그 생산자**가 된다 |

즉 이 그룹은 신규 CRUD를 늘리는 그룹이 아니라, **이미 만든 자산을 실제로 동작하는 하나의 제품으로 잇는 그룹**이다.

### 1.2 목적

1. 챗봇 관리자가 배포 전에 **실시간으로 대화를 테스트**하고, "왜 이 응답이 나왔는지"(판정 근거)를 확인하게 한다(No.10).
2. 저장하지 않은 편집 내용을 **미리보기**하고, 저장본과 **나란히 비교**해 회귀를 조기에 발견하게 한다(No.10).
3. 챗봇을 **채널 단위로 켜고 끄며 배포**하게 하고, 그중 **WEB 채널만큼은 최종 사용자가 실제로 대화할 수 있는 종단 경로**를 완성한다(No.11).
4. 채널이 늘어나도 대화 처리 코드가 갈라지지 않도록 **채널 무관 단일 파이프라인 + 어댑터 계약**을 지금 확정한다(`개발명세서.md` §1).

### 1.3 이 문서의 핵심 판단 3건 (⚠ PM 확인 항목)

기준 목록의 문구를 현재 시스템 상태에 맞게 스코프다운한 결정이다. 근거는 각 절에 상세히 기술한다.

| # | 기준 목록 문구 | 이번 Phase 결정 | 근거 요약 |
|---|---|---|---|
| **J-1** | No.10 "**운영 챗봇 vs 학습 중 챗봇 실시간 비교**" | **"저장본(A) vs 저장본+미저장 변경(B)" 비교로 재해석**한다. 버전/학습 스냅샷 간 비교는 Out of scope | 이 문구는 **확장기능 No.20(학습영향도 TEST)의 정의와 사실상 동일**하고, 성립 전제인 "학습"(No.16 DLE)·"버전 스냅샷"(No.25)이 둘 다 범위 밖이다. §4.1.3 |
| **J-2** | No.11 "웹/모바일/카카오톡/라인/페이스북/네이버톡톡/앱/키오스크 **배포**" | **WEB 채널만 종단 구현**, 나머지 7종은 **설정 저장은 가능하나 활성화 불가("준비 중")** | 외부 채널은 자격증명·공개 HTTPS 수신 엔드포인트·플랫폼 검수가 필요해 **수용기준을 쓸 수 없다**. §4.2.1 |
| **J-3** | `apps/widget` 스캐폴딩 여부 | **이번 Phase에 최소 버전으로 스캐폴딩한다**(대화창 UI + 공개 대화 API 연동) | 위젯 없이는 No.11이 "설정 화면만 있는 기능"이 되고, 이미 배포 중인 임베드 코드가 계속 404다(공백 ②③). 축소 경로는 §4.3.1에 병기 | 

---

## 2. 사용자 역할 및 시나리오

### 2.1 역할

| 역할 | 이 그룹에서의 활동 |
|---|---|
| 챗봇 관리자(Admin) | 응답 테스트·미리보기·비교 실행, 채널 활성화/설정, 임베드 배포 |
| 운영 모니터(Viewer) | 응답 테스트 조회·실행(쓰기 없음), 채널 상태 조회 |
| **최종 사용자(End User)** | **이 그룹에서 처음으로 직접 사용자가 된다** — 웹 위젯으로 챗봇과 대화 |
| 웹 개발자(고객사) | 임베드 스니펫을 자사 페이지에 삽입, 허용 도메인 확인 |

> 인증·RBAC은 No.12 범위다. 관리자 API에는 `@RequirePermission('simulation:read'｜'channel:read'｜'channel:write')` 데코레이터만 부착하고 가드는 no-op을 유지한다(`개발명세서.md` §4.1). **단 공개 대화 API는 처음부터 인증이 없는 경로이므로 RBAC이 아니라 §6.2의 레이트리밋·CORS·Origin 검증으로 보호한다.**

### 2.2 사용자 시나리오

**S-1. 만들자마자 바로 테스트 (관리자, No.10)**
관리자가 `배송조회_응답` 노드를 저장한 뒤 상단 `응답 테스트` 탭을 연다. 입력창에 "배송 조회"를 넣고 전송하면 실제 위젯과 같은 모양으로 텍스트+버튼 아웃풋이 표시된다.

**S-2. "왜 이 답이 나왔지?" (관리자, No.10)**
기대한 노드가 아니라 FAQ 답변이 나왔다. 메시지 옆 `판정 근거` 토글을 펼치면 단계별 trace가 표: "노드 평가 12건 → 조건 불충족 / FAQ 매칭: '영업시간 알려주세요'". 관리자는 노드의 의도 조건이 잘못 걸려 있음을 파악하고 해당 노드 편집 화면으로 바로 이동한다.

**S-3. 멀티턴 폼 테스트 (관리자, No.10)**
`커피주문` 컨텍스트를 테스트한다. "커피 주문할게요" → "어떤 메뉴로 하시겠어요?" → "아메리카노" → "사이즈는요?" 순으로 대화가 이어지고, 우측 패널에 현재 세션 상태(슬롯 2/3, 재시도 0회)가 표시된다. `대화 초기화`를 누르면 세션이 사라지고 처음부터 다시 시작된다.

**S-4. 저장 전 미리보기와 비교 (관리자, No.10 — J-1)**
노드의 답변 문구를 고치는 중인데 저장하기가 불안하다. 편집 폼에서 `이 설정으로 테스트`를 누르면 저장하지 않은 상태 그대로 응답이 나온다. 이어서 `저장본과 비교`를 누르고 문장 5개("배송 조회", "환불", "영업시간"…)를 넣으면 좌(현재 저장본)/우(수정본) 2단으로 응답이 나란히 표시되고, 달라진 2건에 `변경됨` 배지가 붙는다. 관리자는 의도치 않게 바뀐 1건을 되돌린 뒤 저장한다.

**S-5. 폴백만 나오는 챗봇 진단 (관리자, No.10)**
새 챗봇이 무엇을 물어도 "이해하지 못했어요"만 답한다. 테스트 화면 상단에 "이 챗봇에는 활성 노드 0건 / 의도 0건이 있습니다"라는 빈 상태 안내와 `대화설계로 이동` 링크가 표시된다.

**S-6. 웹에 배포하기 (관리자 → 웹개발자, No.11)**
`채널` 탭에서 `웹(WEB)` 카드의 활성화 토글을 켠다. 허용 도메인에 `https://www.example.co.kr`을 추가하고 인사말을 "무엇을 도와드릴까요?"로 저장한다. 같은 카드의 `임베드 코드 보기`로 이동해 스니펫을 복사하고 사내 웹개발자에게 전달한다. 개발자가 붙여넣자 홈페이지 우하단에 상담 버튼이 뜨고 실제로 대화가 된다.

**S-7. 카카오톡을 켜려다 (관리자, No.11 — J-2)**
`카카오톡` 카드에는 `준비 중` 배지와 "이 채널은 설정을 미리 기록해 둘 수 있으나, 실제 메시지 연동은 다음 버전에서 제공됩니다"라는 안내가 있고 활성화 토글은 비활성 상태다. 관리자는 메모란에 "2분기 오픈빌더 심사 예정"만 적어 저장한다.

**S-8. 최종 사용자의 대화 (End User, No.11)**
방문자가 키보드 Tab만으로 상담 버튼에 진입해 Enter로 패널을 연다. 입력창에 질문을 치고 Enter로 전송하면 "응답 생성 중" 표시 후 답변이 나오고, 새 메시지가 스크린리더로 읽힌다. `Esc`를 누르면 패널이 닫히고 포커스가 상담 버튼으로 돌아간다.

**S-9. 되묻기 버튼 누르기 (End User, No.11)**
"배 언제 와요?"라고 묻자 "어떤 '배'를 말씀하시는 건가요?"와 함께 `과일`/`선박` 버튼이 뜬다. `선박`을 누르면 선박 의미로 확정된 답변이 이어진다. *(→ 현재 엔진 구현으로는 이 시나리오가 성립하지 않는다. §4.4 FR-E2-2 참고)*

**S-10. 긴급 중단 (관리자, No.11)**
잘못된 답변이 나간다는 제보를 받고 `채널` 탭에서 WEB 토글을 끈다. 즉시(캐시 TTL 무관) 위젯은 "현재 상담을 이용할 수 없습니다" 안내로 바뀌고, 임베드 코드는 그대로 둔 채 서비스만 멈춘다.

**S-11. 대시보드가 살아난다 (관리자, 연계 효과)**
대화가 쌓인 다음 날 대시보드를 열면 접속수·응답률·인기질문이 처음으로 0이 아닌 값으로 표시된다. 인기질문에 전화번호가 그대로 노출되지 않는다(마스킹).

---

## 3. 공통 기능 요구사항 (FR-0)

`chatbot-operations.md` §3(FR-0-1~8)과 `dialogue-design.md` §3(FR-0-9~16)을 **그대로 상속**하며, 이 그룹 고유 규약을 추가한다.

| ID | 요구사항 | 비고 |
|---|---|---|
| FR-0-17 | 이 그룹의 API는 **관리자 API**와 **공개 API** 두 종류로 명확히 분리한다. 관리자 API는 `/api/v1/chatbots/:chatbotId/...`(챗봇 스코프 규약 상속), 공개 API는 **`/api/v1/public/...`** 프리픽스를 쓴다. 두 계열은 컨트롤러·DTO·오류 메시지를 공유하지 않는다. | NFR-S1 |
| FR-0-18 | **공개 API 응답에는 내부 식별자·판정 근거를 포함하지 않는다.** `trace`, `matchedNodeId`, `matchedIntentId`, `matchedFaqId`, `unsupportedOutputs`는 관리자 API 전용이다. | 구조 노출 방지 |
| FR-0-19 | 대화 해석은 **반드시 `packages/dialogue-engine`의 `resolveResponse()` 한 경로**만 사용한다. 시뮬레이션·공개 대화·향후 채널 어댑터가 각자 매칭 로직을 갖지 않는다(엔진 2벌 금지). | ADR-0008 |
| FR-0-20 | 엔진 입력 번들(`DialogueBundle`) 조립은 **`DialogueBundleService` 단일 진입점**에서만 수행한다. 캐시·무효화도 이 서비스의 책임이다. | 설계서 §7.8 예고분 |
| FR-0-21 | 이 그룹은 **대화 자산(의도/노드/FAQ 등)을 생성·수정·삭제하지 않는다.** 시뮬레이션·미리보기·비교는 모두 **읽기 전용**이며 어떤 경우에도 DB 상태를 바꾸지 않는다. 유일한 쓰기는 `Channel`(설정)과 `ConversationLog`(로그 적재)다. | AC-10-14 |
| FR-0-22 | 챗봇 상태가 `ARCHIVED`이면 **채널 쓰기 API는 `409`(`CHATBOT_ARCHIVED`)**, 시뮬레이션은 **허용**한다(읽기 성격, FR-0-21). | FR-0-11 정합 |
| FR-0-23 | 관리자 콘솔·위젯의 모든 UI 문구는 한국어 고정이며, 문자열은 각 앱의 상수 파일 한 곳(`MESSAGES`)에 모은다. i18n은 범위 밖. | FR-0-8 상속 |

---

## 4. 기능별 요구사항

### 4.1 No.10 — 응답 테스트/시뮬레이션

기준 목록의 기능 설명은 3요소다: **(a) 실시간 대화 테스트 · (b) 학습 중 미리보기 · (c) 운영 챗봇 vs 학습 중 챗봇 실시간 비교.** 이번 Phase의 대응은 (a) 전면 구현 / (b) **"저장 전 미리보기"로 재해석해 구현** / (c) **"저장본 vs 미저장 변경 비교"로 스코프다운해 구현**이다.

#### 4.1.1 실시간 대화 테스트 (a)

| ID | 요구사항 |
|---|---|
| FR-10-1 | 관리자가 임의의 문장을 입력해 해당 챗봇의 응답을 즉시 확인할 수 있다. 요청: `{ message, state?, overlay? }`, 응답: 엔진의 `DialogueResolution` + 서버 부가 필드(FR-10-8). |
| FR-10-2 | 시뮬레이션은 **챗봇 상태와 무관하게 허용**한다(`DRAFT`/`ACTIVE`/`ARCHIVED` 모두). `ARCHIVED`인 경우 화면 상단에 "보관된 챗봇입니다" 안내 배너를 표시한다. |
| FR-10-3 | **대화 상태는 요청-응답 왕복으로 주고받는다.** 서버는 세션을 저장하지 않는다(DD-10 승계 — §5.2 DD-18에 재확인 근거 기재). 응답의 `state`를 클라이언트가 보관했다가 다음 요청에 그대로 실어 보낸다. |
| FR-10-4 | 서버는 수신한 `state`를 **신뢰하지 않는다**. ① zod 스키마 검증 실패 → 상태를 버리고 새 대화로 처리(오류 아님) ② `contextVariableId`가 해당 챗봇 번들에 없으면 상태 폐기 후 안내 문구 ③ `startedAt`이 현재보다 미래이거나 **24시간 이전이면 폐기**. 어떤 경우에도 `500`을 내지 않는다. |
| FR-10-5 | **시뮬레이션은 `ConversationLog`·`UnansweredQuestion`을 기록하지 않는다.** 관리자 테스트가 운영 통계(No.2/No.14/No.15)를 오염시키면 안 된다. 화면에 "테스트 대화는 통계에 반영되지 않습니다" 캡션을 표시한다. |
| FR-10-6 | 응답 아웃풋은 **최종 사용자 위젯과 동일한 렌더러**로 표시한다(TEXT/CARD/IMAGE/BUTTON/LINK/PAUSE/PHONE_CALL). 렌더러를 두 벌 만들지 않는다(NFR-M1). |
| FR-10-7 | 아웃풋 내 버튼을 **실제로 클릭해 대화를 이어갈 수 있다**. 버튼 액션별 동작은 FR-W-6과 동일 규격을 따른다. |
| FR-10-8 | 서버는 엔진 결과에 다음을 덧붙여 반환한다: `matchedNodeName`, `matchedIntentName`, `matchedFaqQuestion`(이름 해석 — 프런트가 ID로 재조회하지 않게), `elapsedMs`, `resolvedAt`, `assetCounts`(노드/의도/FAQ 활성 건수). |
| FR-10-9 | **판정 근거(trace) 패널**을 제공한다. `TraceStep`의 `stage`/`code`를 한국어 레이블로 변환해 순서대로 표시하고, `targetId`가 있으면 해당 편집 화면으로 이동하는 링크(`href` 기반)를 제공한다. 기본은 접힘 상태이며 키보드로 펼칠 수 있다. |
| FR-10-10 | `unsupportedOutputs`가 비어 있지 않으면 "이번 버전에서는 실행되지 않는 아웃풋 N종(SCENARIO/SURVEY/API_CONDITION)이 포함되어 있습니다"를 **안내(INFO)** 로 표시한다(FR-5-15 연계). **[갱신 No.26·No.27]** 대상은 `SCENARIO`·v1(이전 형식) `API_CONDITION`·v1(이전 형식) `SURVEY`뿐이다 — v2 `SURVEY`는 실행되며 시뮬레이터 결과 패널의 `설문 단계`로 표시된다(`survey-management-설계.md` §7.2) |
| FR-10-11 | 현재 세션 상태를 우측 패널에 표시한다: 진행 중 컨텍스트명, `슬롯 n/m`, 채워진 값(값은 마스킹 없이 관리자에게만 표시), `retryCount`, 상태 배지. 세션이 없으면 "진행 중인 폼 없음". |
| FR-10-12 | `대화 초기화` 버튼으로 메시지 목록과 상태를 모두 비운다(확인 모달 없이 즉시, 되돌리기 불필요한 로컬 동작). |
| FR-10-13 | 입력은 최대 1,000자이며 잔여 글자 수를 실시간 표시한다. 초과 입력은 전송 버튼을 비활성화한다(엔진의 절단 동작에 의존하지 않고 클라이언트에서 먼저 막는다). |
| FR-10-14 | 전송 버튼 연타 시 요청은 1회만 발생하고, 응답 대기 중에는 "응답 생성 중" 인디케이터를 표시한다(UIUX §4, §8). |
| FR-10-15 | 빈 문자열/공백만 입력하면 요청을 보내지 않고 입력창에 인라인 안내를 표시한다. |
| FR-10-16 | 대화 자산이 0건인 챗봇에서는 화면 상단에 빈 상태 안내와 `대화설계로 이동` 링크를 표시한다. 테스트 자체는 동작해야 하며(기본 폴백 문구 반환) 오류 화면이 아니다. |
| FR-10-17 | 응답 테스트는 **대화설계 화면에서도 열 수 있어야 한다**(노드/FAQ 편집 중 이탈 없이 검증). 상세 탭 진입과 사이드 패널(드로어) 진입 **두 경로**를 제공하며 동일 컴포넌트를 재사용한다. |

#### 4.1.2 저장 전 미리보기 — 오버레이 (b)

> 기준 목록의 "학습 중 미리보기"를 이 시스템의 대응물인 **"저장 전 미리보기"** 로 재해석한다. 현재 저장은 곧 반영이므로(배포 단계 없음), 관리자가 "반영 전에 확인"할 수 있는 유일한 지점이 편집 폼의 미저장 상태다.

| ID | 요구사항 |
|---|---|
| FR-10-18 | 시뮬레이션 요청에 **`overlay`(선택)** 를 실을 수 있다. 구조: `{ dialogNodes?, intents?, keywords?, homonyms?, contexts?, faqs?, deletedIds?: { dialogNodes?: string[], ... } }`. |
| FR-10-19 | 서버는 저장본 번들에 오버레이를 **`id` 기준 upsert**로 병합한다. ① 기존 `id`와 일치 → 교체 ② `draft-`로 시작하는 임시 `id` → 신규 추가 ③ `deletedIds`에 포함 → 제거. 병합은 **DB 무의존 순수 함수**(`mergeOverlay(bundle, overlay)`)로 구현한다. |
| FR-10-20 | 오버레이 항목은 **저장 API와 동일한 zod 스키마**로 검증한다. 검증 실패 시 `400`과 함께 `details[].field`에 `overlay.dialogNodes[0].outputs[1].payload.text` 형태의 경로를 담는다. |
| FR-10-21 | 오버레이 상한: 종류별 최대 20건, 요청 본문 전체 **1MB**. 초과 시 `400`(`LIMIT_EXCEEDED`). |
| FR-10-22 | **오버레이는 절대 저장되지 않는다.** 이 요청으로 인한 DB 변경은 0건이어야 한다(FR-0-21). |
| FR-10-23 | 노드 편집 폼(`NodeFormPage`)·FAQ 편집 모달·컨텍스트 편집 폼에 `이 설정으로 테스트` 액션을 제공한다. 현재 폼 상태를 오버레이로 직렬화해 전송하며, **저장하지 않은 상태에서도 이탈 경고 없이** 실행된다. |
| FR-10-24 | 오버레이가 적용된 대화에는 메시지 영역에 `미저장 변경 적용됨` 배지(색상+텍스트 병기)를 상시 표시해, 저장본 테스트와 혼동하지 않게 한다. |

#### 4.1.3 비교 실행 (c) — J-1 결정

**결정: "운영 챗봇 vs 학습 중 챗봇 실시간 비교"는 이번 Phase에서 "저장본(A) vs 저장본+미저장 변경(B)"의 동일 입력 응답 비교로 재해석한다. 버전·학습 스냅샷 간 비교는 Out of scope(§9.2)다.** 근거는 다음 넷이다.

1. **전제 기능이 둘 다 범위 밖이다.** "학습 중 챗봇"이 성립하려면 ① 학습 파이프라인(**No.16 DLE**, 확장기능) 또는 ② 편집본을 운영본과 분리해 보관하는 **버전 스냅샷**(**No.25**, 확장기능) 중 하나가 필요하다. 현재 `Chatbot.status`는 `DRAFT/ACTIVE/ARCHIVED` 3단계뿐이고 이는 *생명주기 상태*이지 *동시에 존재하는 두 벌의 대화 자산*이 아니다. 즉 비교할 대상 B가 시스템에 **존재하지 않는다**.
2. **기준 목록 자체에 같은 기능이 이미 확장기능으로 등재돼 있다.** `기능요구사항.md` §3 **No.20(학습영향도 TEST) = "운영 챗봇 vs 추가학습 챗봇 응답 비교, 재학습 회귀 리스크 관리"** 는 No.10의 해당 문구와 사실상 동일한 정의다. 본격적인 회귀 비교의 본체는 No.20이며, 기본기능 No.10에 그 전체를 끌어오면 그룹 경계가 무너진다.
3. **대안(챗봇 2개를 비교)은 현재 성립하지 않는다.** "운영용 챗봇 A와 검수용 사본 B를 비교"하는 방식도 검토했으나, **No.1의 챗봇 복사는 하위 대화 자산을 복제하지 않는다**(FR-1-14, 명시적 결정). 대상 B를 만들 수단이 없으므로 기능이 공회전한다. 대화 자산 포함 복제(deep copy)를 이번에 추가하는 것은 **No.25 버전 스냅샷의 설계를 선점**하게 되어 부적절하다.
4. **그럼에도 원래 가치(회귀 조기 발견)는 지킬 수 있다.** 관리자가 실제로 불안해하는 순간은 "지금 이 수정이 기존 답변을 망가뜨리지 않는가"이며, 오버레이(§4.1.2)가 바로 그 "수정본"을 제공한다. A/B 두 번들을 같은 입력으로 돌려 나란히 보여주면 이 가치의 대부분이 달성된다.

| ID | 요구사항 |
|---|---|
| FR-10-25 | 비교 실행 API를 제공한다. 요청: `{ messages: string[](1~20건, 각 1~1000자), overlay, stateA?, stateB? }`. 응답: 턴별 `{ message, a: TurnResult, b: TurnResult, diff }`. |
| FR-10-26 | A는 **저장본 번들**, B는 **저장본 + 오버레이 번들**이다. 두 계열은 **독립된 대화 상태**를 유지해 멀티턴 비교가 가능해야 한다(같은 문장 순서를 각각 처음부터 재생). |
| FR-10-27 | 차이 판정 `diff`: ① `outputsChanged`(아웃풋 배열을 정규화 직렬화해 비교) ② `matchChanged`(`matchedNodeId`/`matchedFaqId`/`matchedIntentId` 중 하나라도 변경) ③ 종합 `status`: `SAME`/`DIFFERENT`. 판정 로직은 순수 함수로 분리한다. |
| FR-10-28 | 화면은 좁은 화면에서 세로 스택, 넓은 화면에서 좌/우 2단으로 표시하고 차이 행에 `변경됨` 배지(색상+텍스트 병기)를 붙인다. 달라진 행만 보기 필터를 제공한다. |
| FR-10-29 | 입력 문장은 줄바꿈 구분 다건 입력을 허용한다(붙여넣기 지원). **엑셀 업로드 기반 대량 회귀 검증은 No.19(대화검증시스템/TC 테스트) 범위**이므로 이번에는 제공하지 않으며, 화면에 그 사실을 안내한다. |
| FR-10-30 | 비교 실행도 **로그를 남기지 않고 DB를 변경하지 않는다**(FR-0-21, FR-10-5). |
| FR-10-31 | 오버레이가 비어 있으면 A와 B가 동일하므로, 비교 실행 전에 "비교할 변경 내용이 없습니다" 안내를 표시하고 실행을 막는다(`400` 또는 클라이언트 차단). |

---

### 4.2 No.11 — 다양한 채널 제공

#### 4.2.1 채널 관리 (CRUD) — J-2 결정

**결정: 8종 채널 모두 화면에 노출하고 설정(메모)을 저장할 수 있게 하되, 실제 활성화(`enabled=true`)는 어댑터가 구현된 채널(WEB)에만 허용한다.** 근거:

- 외부 채널(카카오톡/라인/페이스북/네이버톡톡)은 **플랫폼 계정·자격증명·공개 HTTPS Webhook 수신 엔드포인트·플랫폼 심사**가 전제다. 이 중 어느 것도 현재 개발 환경(SQLite + localhost)에서 확보할 수 없고, **수용기준(AC)을 작성할 수 없는 기능은 이번 Phase에 넣지 않는다**는 기준을 적용한다.
- 그렇다고 "켜지기는 하는데 아무 일도 안 일어나는 토글"을 두는 것은 더 위험하다. 관리자가 카카오톡을 켜둔 채 "왜 문의가 안 들어오지?"라고 오인하는 **운영 사고**를 만든다. 따라서 **활성화 자체를 막고 `준비 중` 상태를 정직하게 표시**한다.
- 원본 매뉴얼의 취지("한 번의 구축으로 여러 채널에 배포")는 **채널 무관 단일 대화 파이프라인 + 어댑터 계약**(FR-11-17~19)으로 구조적으로 보전한다. 어댑터만 추가하면 채널이 늘어나는 형태를 지금 확정한다.
- **자격증명 입력란은 아예 제공하지 않는다.** 평문 저장은 `dialogue-design.md` NFR-S5가 이미 문제로 지목한 사안이며, 저장할 곳(암호화·시크릿 관리)이 없는 상태에서 입력을 받는 것은 보안 부채다.

| ID | 요구사항 |
|---|---|
| FR-11-1 | 채널은 챗봇당 **타입별 최대 1건**이다(`(chatbotId, type)` 유일). |
| FR-11-2 | 채널 목록 조회는 레코드 유무와 무관하게 **8종 전부**를 반환한다. 미설정 타입은 `{ type, configured: false, enabled: false, implementation }`로 표현한다(프런트가 목록을 하드코딩하지 않게). |
| FR-11-3 | 각 채널은 서버가 내려주는 **구현 상태(`implementation`)** 를 갖는다: `IMPLEMENTED`(대화 종단 동작) / `CONFIG_ONLY`(설정만 가능, 준비 중). 이번 Phase 값 — `WEB: IMPLEMENTED`, 나머지 7종: `CONFIG_ONLY`. 이 매핑은 **서버 상수**이며 프런트에 중복 정의하지 않는다. |
| FR-11-4 | `CONFIG_ONLY` 채널을 `enabled=true`로 전환하려는 요청은 **`409`(`CHANNEL_NOT_IMPLEMENTED`)** 로 거부하고, 화면에서는 토글을 비활성화 + `준비 중` 배지 + 사유 안내를 표시한다. |
| FR-11-5 | **`WEB` 타입의 정의를 "PC/모바일 웹 임베드"로 확정**한다. `MOBILE` 타입은 "모바일 앱 내 웹뷰/네이티브 SDK"로 의미를 좁혀 `CONFIG_ONLY`로 둔다. 기존 임베드 코드가 같은 `widget.js`를 `data-mode`만 달리해 쓰므로(EmbedCodeService) **PC/모바일 웹을 두 채널로 쪼개지 않는다.** `ChannelType` enum은 변경하지 않는다. |
| FR-11-6 | `WEB` 채널의 `config` 규격: `{ allowedOrigins: string[](최대 20, 각 스킴+호스트 형태), greetingMessage?(최대 200자), quickReplies?: string[](최대 5, 각 20자), launcherPosition?: 'RIGHT'｜'LEFT', showLauncher?: boolean }`. |
| FR-11-7 | `CONFIG_ONLY` 채널의 `config` 규격: `{ note?: string(최대 500자) }` **뿐이다.** 토큰·시크릿·Webhook URL 등 자격증명 필드는 스키마에 존재하지 않는다(NFR-S7). |
| FR-11-8 | `config`는 DB에 JSON 직렬화 문자열로 저장하고 API 경계에서는 항상 객체로 송수신한다. 파싱 실패 시 기본값 폴백 + 경고 로그(§3.1 데이터 규약 상속). |
| FR-11-9 | `allowedOrigins`가 빈 배열이면 **모든 출처 허용**으로 동작하되, 화면에 "모든 도메인에서 호출 가능" 주의 배지를 표시한다. 값이 있으면 CORS·Origin 검증에 사용한다(FR-11-14). |
| FR-11-10 | 채널 설정 변경(활성화 포함)은 **즉시 반영**되어야 한다 — 번들/채널 캐시를 쓰기 시점에 무효화한다(TTL 만료를 기다리지 않는다). |
| FR-11-11 | 채널 레코드를 삭제할 수 있다(설정 초기화). 참조 제약이 없으므로 확인 모달 후 `204`. 과거 `ConversationLog.channelType`은 문자열 값이라 영향받지 않는다. |
| FR-11-12 | 채널 화면은 8종 카드(채널명 + 구현 상태 배지 + 활성 배지 + 요약)로 구성하고, `WEB` 카드에는 **임베드 코드 탭 바로가기**와 공개 URL 미리보기를 제공한다. |
| FR-11-13 | 채널 쓰기 동작은 서비스 계층 단일 진입점을 유지해 향후 `AuditLog`(No.13) 기록 지점이 되게 한다(FR-0-7 상속). |

#### 4.2.2 공개 대화 API (채널 무관 파이프라인)

| ID | 요구사항 |
|---|---|
| FR-11-14 | **`GET /api/v1/public/chatbots/:slug/config`** — 위젯 부팅용. 반환: `{ name, avatarUrl, skin: { primaryColor, headerTitle, logoUrl }, greetingMessage, quickReplies, launcherPosition, showLauncher }`. **그룹/상태/통계/대화자산 등 내부 정보는 포함하지 않는다.** |
| FR-11-15 | **`POST /api/v1/public/chatbots/:slug/messages`** — 대화 1턴. 요청: `{ sessionId, message?, buttonAction?, state? }`. 응답: `{ outputs, state, messageId }`. `trace`·내부 ID는 반환하지 않는다(FR-0-18). |
| FR-11-16 | **접근 조건**: 챗봇 `status === 'ACTIVE'` **AND** `WEB` 채널 `enabled === true`. 판정 결과별 응답 — 존재하지 않는 `slug`: `404`(`NOT_FOUND`) / 존재하지만 비활성: **`403`** (`CHATBOT_NOT_PUBLISHED` 또는 `CHANNEL_DISABLED`). <br>**404가 아니라 403을 쓰는 근거**: `slug`는 공개 URL(`/c/{slug}`)의 구성요소라 이미 공개 값이므로 존재 은닉의 실익이 없고, 개발자가 "왜 위젯이 안 뜨는지"를 판별할 수 있어야 한다(관리자 API의 `404` 규약 FR-0-9와 목적이 다르다). |
| FR-11-17 | **채널 어댑터 계약**을 정의한다: `normalizeInbound(raw) → { message?, buttonAction?, state, sessionId }`, `renderOutbound(outputs) → ChannelMessage[]`. 대화 처리 코어는 채널을 모르며, 채널별 차이는 어댑터에서만 흡수한다(`개발명세서.md` §1). |
| FR-11-18 | 이번 Phase에 구현하는 어댑터는 **`WebChannelAdapter` 1종**이다. 나머지 채널 어댑터는 **파일조차 만들지 않는다**(빈 구현체는 "구현됐다"는 착시를 만든다). 확장 지점은 인터페이스와 팩토리 분기 1곳으로 충분히 표현된다. |
| FR-11-19 | 어댑터는 **채널이 지원하지 않는 아웃풋 타입을 텍스트로 격하(degrade)** 하는 규칙을 가진다. WEB은 전 타입을 지원하므로 이번에는 규칙만 정의하고 격하가 발생하지 않는다. |
| FR-11-20 | **모든 공개 대화 1턴은 `ConversationLog` 1행**으로 적재한다: `chatbotId`, `channelType`(채널 enum 값), `sessionId`(요청값), `userMessage`(마스킹 적용), `botResponse`, `matchedIntentId`, `isAnswered`. |
| FR-11-21 | `isAnswered` 판정 규칙: `trace`의 마지막 단계가 `FALLBACK_NODE`/`FALLBACK_FAQ`/`FALLBACK_DEFAULT` 또는 `EMPTY_INPUT`이면 `false`, 그 외(노드/FAQ/의도/세션 진행)는 `true`. 판정은 순수 함수로 분리해 단위 테스트한다. |
| FR-11-22 | `botResponse`에는 **아웃풋의 텍스트 표현**을 저장한다(TEXT는 본문, 그 외는 `[카드] 제목`처럼 타입 요약). 최대 2,000자로 절단한다. |
| FR-11-23 | **PII 마스킹**: `userMessage`·`botResponse`는 저장 **전**에 전화번호·이메일·카드번호·주민등록번호 패턴을 치환한다(예: `010-****-5678`, `a***@example.com`). 원문은 어디에도 저장·로깅하지 않는다. `chatbot-operations.md` NFR-S4가 "대화 처리 Phase의 책임"으로 지정한 항목을 이번에 이행한다. |
| FR-11-24 | **로그 적재 실패가 대화 응답을 실패시키지 않는다.** 응답을 먼저 반환하고 적재는 best-effort로 처리하며, 실패 시 서버 경고 로그만 남긴다. |
| FR-11-25 | 버튼 액션 처리: 요청의 `buttonAction`이 `{ kind: 'NODE', nodeId }`이면 해당 노드의 아웃풋을 실행하고, `{ kind: 'MESSAGE', text }`이면 그 텍스트를 일반 입력으로 처리한다. `LINK`는 클라이언트에서만 처리되며 서버로 오지 않는다(FR-W-6). |
| FR-11-26 | `state`(대화 상태 봉투) 취급은 FR-10-3·FR-10-4와 **동일 규칙**을 적용한다. 서버는 저장하지 않으며 수신값을 재검증한다. |
| FR-11-27 | 번들 캐시: 챗봇 단위로 조립한 `DialogueBundle` + `DialogueIndex`를 **TTL 60초 + 쓰기 시 무효화**로 캐시한다. 캐시 저장소는 인터페이스로 추상화해(단일 인스턴스는 메모리) 다중 인스턴스 전환 시 교체 가능하게 한다(ADR-0007의 `ImportStagingStore` 패턴 재사용). |

---

### 4.3 위젯 (`apps/widget`) — J-3 결정

#### 4.3.1 범위 결정

**결정: 이번 Phase에 `apps/widget`을 최소 버전으로 스캐폴딩한다.** 근거:

1. **이미 배포된 약속이 지켜지지 않고 있다.** `EmbedCodeService`는 `{WIDGET_BASE_URL}/widget.js` 스니펫을 생성하고 화면은 복사까지 제공하지만 그 URL에는 아무것도 없다. AC-4-7~4-10이 "문자열 생성"만 검증해 통과한 상태이며, 이는 **관리자에게 동작하지 않는 코드를 배포하게 만드는** 상태다.
2. **No.11의 정체성이 "배포"다.** 위젯이 없으면 이 그룹은 채널 설정 CRUD로 끝나고, 8종 중 **종단 동작하는 채널이 0개**가 된다. 기능 설명("웹/모바일 … 등 배포")을 충족하지 못한다.
3. **후속 그룹의 전제다.** No.14(기본 통계)·No.15(학습현황)·No.24(하이브리드 CS)·No.44(피드백 루프)는 전부 실제 대화 데이터를 소비한다. 데이터 생산자가 없으면 그 그룹들도 같은 "빈 상태" 문제를 반복한다.
4. 반면 위젯의 **위험 요소는 범위 확장**이다. 따라서 아래 §9.3에 위젯 관련 제외 항목(아이프레임 완전 격리, 파일 첨부, 음성, 상담원 전환, 대화 이력 복원, 다국어 등)을 명시적으로 잠근다.

> **축소 경로(PM이 일정상 선택 가능)**: 위젯을 제외하고 **공개 대화 API까지만** 구현한 뒤 콘솔의 응답 테스트 화면으로 검증하는 안. 이 경우 **No.11의 AC 중 AC-W 전체와 AC-P의 브라우저 통합 항목이 미검증으로 남고, `ConversationLog`는 여전히 0건**이므로 §1.1의 공백 ②③이 그대로 이월된다는 점을 명시한다. 본 문서는 이 안을 **권고하지 않는다**.

#### 4.3.2 위젯 기능 요구사항

| ID | 요구사항 |
|---|---|
| FR-W-1 | `apps/widget`을 pnpm 워크스페이스 앱으로 추가한다(`pnpm-workspace.yaml`의 `apps/*`에 자동 포함). 빌드 산출물은 임베드 로더 **`widget.js`** 와 정적 자산이며, 개발명세서 §2의 **경량 번들(gzip 100KB 이내)** 목표를 따른다. |
| FR-W-2 | **기존 임베드 스니펫 계약을 변경하지 않는다.** `data-chatbot`(slug), `data-api-base`, `data-mode`(`desktop`/`mobile`), `data-fullscreen`을 그대로 읽어 동작한다. `EmbedCodeService`의 문자열을 수정해야 한다면 FR-4-9·AC-4-7~4-9의 기존 테스트 영향도를 함께 검토한다. |
| FR-W-3 | 전체화면 경로 **`/c/:slug`** 도 제공한다(FR-3-9의 공개 URL 미리보기가 실제로 열려야 한다). |
| FR-W-4 | 런처 버튼 + 대화 패널 토글 구조. 부팅 시 `GET /public/chatbots/:slug/config`로 스킨·인사말·퀵리플라이를 받아 적용한다(`primaryColor`, `headerTitle`, `logoUrl`). |
| FR-W-5 | 아웃풋 렌더러: `TEXT`/`CARD`/`IMAGE`/`BUTTON`/`LINK`/`PAUSE`/`PHONE_CALL` 7종을 렌더한다. `CONTEXT_FORM`/`DIALOG_MOVE`는 서버에서 이미 처리되어 결과 아웃풋으로 치환되므로 렌더 대상이 아니며, 미지원 3종은 서버가 응답에서 제외한다(FR-E-7). |
| FR-W-6 | 버튼 액션 처리 규격(시뮬레이터와 공유): <br>`MESSAGE` → `value`를 사용자 메시지로 전송(말풍선에도 표시) <br>`LINK` → 새 탭으로 이동(`rel="noopener noreferrer"`), 서버 호출 없음 <br>`NODE` → `buttonAction: { kind: 'NODE', nodeId }`로 서버에 전송(FR-11-25, FR-E2-1) |
| FR-W-7 | `PAUSE` 아웃풋은 이후 아웃풋 렌더를 `durationMs`만큼 지연시키고 그동안 타이핑 인디케이터를 표시한다. 총 지연은 한 턴당 최대 5초로 제한한다. |
| FR-W-8 | 대화 세션: `sessionId`는 클라이언트가 생성(`crypto.randomUUID()`)해 **`sessionStorage`** 에 보관하고, 대화 상태 봉투(`state`)도 함께 보관한다. 탭을 닫으면 사라진다(대화 이력 복원은 범위 밖). 호스트 페이지의 쿠키·localStorage를 사용하지 않는다. |
| FR-W-9 | 응답 대기 중 "응답 생성 중" 상태를 표시하고, 전송 버튼 연타로 중복 요청이 발생하지 않게 한다(UIUX §4, §8). |
| FR-W-10 | 오류 상태별 사용자 문구를 구분한다: 네트워크 실패 → "일시적인 오류가 발생했어요. 다시 시도해 주세요." + `재시도` 버튼 / `429` → "요청이 많습니다. 잠시 후 다시 시도해 주세요." / `403` → "현재 상담을 이용할 수 없습니다." (패널은 열리되 입력 비활성) / `404` → 런처 자체를 렌더하지 않고 콘솔 경고만 남긴다. |
| FR-W-11 | **모든 응답 텍스트는 `textContent`로 삽입**하고 HTML/마크다운을 렌더링하지 않는다(FR-9-11 상속). 이미지·링크 URL은 `http`/`https` 스킴만 허용하며 위반 시 렌더를 생략한다. |
| FR-W-12 | 호스트 페이지 CSS와 충돌하지 않도록 스타일을 격리한다(Shadow DOM 또는 강제 네임스페이스 — 구체 방식은 `system-architect` 결정). 호스트 페이지의 DOM/데이터를 읽지 않는다. |
| FR-W-13 | 위젯은 **공개 API 2개만** 호출한다. 관리자 API(`/api/v1/chatbots/...`)를 호출하지 않는다. |
| FR-W-14 | 위젯 UI 문구는 한국어 고정이며 문자열 상수 1곳에 모은다(FR-0-23). |
| FR-W-15 | 인사말(`greetingMessage`)은 패널을 처음 열 때 봇 말풍선으로 1회 표시한다. 퀵리플라이는 인사말 아래 버튼으로 표시하고 `MESSAGE` 액션과 동일하게 동작한다. |
| FR-W-16 | 위젯의 렌더러·상태 전이 로직은 **DOM 무의존 단위 테스트가 가능한 형태**로 분리한다(브라우저 E2E 없이도 AC-W 다수를 검증할 수 있어야 한다). |

#### 4.3.3 위젯 접근성 (UIUX_준수기준 (a) 대상 — 이번 Phase가 최초 적용)

| ID | 요구사항 |
|---|---|
| FR-W-17 | 메시지 입력창에 **레이블을 제공**한다(플레이스홀더로 대체 금지, §5). 입력 길이 제한(1,000자) 시 잔여 글자 수를 실시간 표시한다. |
| FR-W-18 | 전송 버튼은 동사형 레이블("전송")과 **터치 영역 44×44px 이상**을 보장한다(§4). |
| FR-W-19 | 런처 → 패널 → 메시지 영역 → 입력창 → 전송 버튼 순으로 Tab 진입이 가능하고, Shift+Tab 역순이 동작한다(§3). 패널을 열면 포커스가 입력창으로 이동하고, `Esc`로 닫으면 **런처로 포커스가 복귀**한다. |
| FR-W-20 | `Enter`로 전송, `Shift+Enter`로 줄바꿈. 버튼형 아웃풋은 마우스 클릭과 키보드 `Enter`/`Space`가 동일하게 동작한다(§3). |
| FR-W-21 | 새 봇 메시지는 `aria-live="polite"` 영역으로 알린다. "응답 생성 중" 상태도 스크린리더에 전달한다(§8). |
| FR-W-22 | 스킨의 `primaryColor` 위에 올라가는 텍스트 색을 **대비 4.5:1 이상이 되도록 자동 전환**(흰색/검정)한다. No.4의 대비 계산 로직(FR-4-6)을 재사용한다(§1). |
| FR-W-23 | 복사/붙여넣기를 제한하지 않으며, 메시지 영역은 내용 초과 시 세로 스크롤이 생기고 휠/방향키로 스크롤된다(§5). |
| FR-W-24 | 색상만으로 정보를 전달하지 않는다 — 오류/대기/완료 상태는 아이콘 또는 텍스트를 병기한다(§1). |

---

### 4.4 엔진 보강 (FR-E2) — 이번 Phase에 발견된 실행 공백

> `resolveResponse()`는 **텍스트 입력 1건**을 전제로 설계되어 있다. 실제 대화 클라이언트가 붙는 이번 Phase에 와서야 드러나는 공백 2건이며, 둘 다 `packages/dialogue-engine`에서 **순수 함수**로 해결한다.

| ID | 요구사항 |
|---|---|
| FR-E2-1 | **버튼 `NODE` 액션을 실행할 진입점이 없다.** `ButtonItemSchema`는 `action: 'NODE'` + `value: nodeId(uuid)`를 허용하지만(`packages/shared-types/src/dialogue.ts`), 엔진 진입점은 `resolveResponse(input, ...)` 하나뿐이라 노드 ID로 대화를 이어갈 방법이 없다. **`resolveByNodeId(nodeId, state, bundle, now, options)` 를 추가**해 해당 노드의 `outputs`를 `executeOutputs`로 실행하고 동일한 `DialogueResolution`을 반환한다. 노드가 없거나 `enabled=false`면 예외 대신 폴백 경로를 탄다(FR-E-9 일관). |
| FR-E2-2 | **동음이의어 되묻기가 종결되지 않는다.** `buildClarifyOutput()`은 의미 label을 `action: 'MESSAGE'`, `value: label` 버튼으로 만들지만(예: `선박`), `resolveHomonym()`은 **입력에 원래 단어(`배`)가 포함될 때만** 동작한다. 따라서 사용자가 `선박` 버튼을 눌러도 동음이의어 경로를 타지 못하고, 해당 의미의 `intentId`와 무관한 일반 매칭 → 대개 폴백으로 끝난다(S-9 시나리오 미성립). <br>**해결 방향(권고)**: 대화 상태 봉투에 **`pendingClarify?: { homonymId, word, askedAt }`** 를 추가하고, 되묻기 아웃풋을 반환할 때 이를 함께 내려보낸다. 다음 턴 입력이 해당 사전의 의미 `label`과 정규화 일치하면 그 의미로 **확정**한 뒤(= `intentId` 부스트) 해석을 재개한다. 불일치하면 `pendingClarify`를 버리고 일반 해석한다. 최종 방식은 `system-architect`가 확정한다. |
| FR-E2-3 | FR-E2-1·E2-2는 **기존 `resolveResponse` 시그니처와 `simulate` 하위호환을 깨지 않아야 한다**(FR-E-4, AC-E-11). 상태 봉투 확장은 기존 필드를 유지한 채 선택 필드 추가로 처리한다. |
| FR-E2-4 | 두 보강 모두 **DB·NestJS 무의존 순수 함수**이며 단위 테스트를 1차 타깃으로 한다(NFR-M1 상속). |
| FR-E2-5 | 엔진은 여전히 **손상된 데이터에 예외를 던지지 않는다**(FR-E-9). 없는 `nodeId`, 만료된 `pendingClarify`, 구조가 바뀐 세션 모두 `trace` 경고 + 폴백으로 처리한다. |
| FR-E2-6 | `TraceCodeEnum`에 이번 경로용 코드를 추가한다(예: `NODE_BY_ID`, `NODE_BY_ID_NOT_FOUND`, `CLARIFY_RESOLVED`, `CLARIFY_DISCARDED`). enum 추가는 하위호환 변경이다. |

---

## 5. 데이터 요구사항

### 5.1 기존 자산 (재사용)

| 자산 | 위치 | 이번 Phase에서의 처리 |
|---|---|---|
| `resolveResponse`, `executeOutputs`, `buildDialogueIndex`, `advanceContextSession` | `packages/dialogue-engine` | **그대로 사용**. FR-E2로 진입점 2종만 보강 |
| `DialogueBundleSchema`, `DialogueResolutionSchema`, `TraceStepSchema`, `ContextSessionStateSchema`, `HomonymResolutionSchema` | `shared-types/src/dialogue-engine.ts` | 재사용 + 상태 봉투 신설(§5.3) |
| `DialogOutputSchema`(12종 판별 유니온), `ButtonItemSchema` | `shared-types/src/dialogue.ts` | **변경 없음**. 위젯/시뮬레이터 렌더러의 입력 계약 |
| `ChannelType`, `ChannelSchema`, `CreateChannelSchema` | `shared-types/src/channel.ts` | **Phase 0 초안 — 재정비 필요**(§5.3) |
| Prisma `Channel` | `apps/api/prisma/schema.prisma` | 제약·필드 보강(§5.2 DD-19) |
| Prisma `ConversationLog`(+`sessionId`, `(chatbotId, createdAt)` 인덱스) | 동일 | **최초의 쓰기 주체가 생긴다**. 스키마 변경 최소(§5.2 DD-20) |
| `EmbedCodeService`, `WIDGET_BASE_URL`, `PUBLIC_API_BASE_URL` | `apps/api/src/chatbots/`, `config/env.validation.ts` | 스니펫 계약 유지, 위젯이 이 계약을 구현(FR-W-2) |
| `ChatbotSkinSchema`, 대비 계산 로직(FR-4-6) | `shared-types`, `apps/web` | 위젯이 재사용(FR-W-22) — 공용 위치 이동 여부는 아키텍트 판단 |
| `UnsavedGuardContext`, `ConfirmDialog`, `Toast`, `MESSAGES`, `SeverityBadge`, `EmptyState` | `apps/web` | 관리자 화면에서 재사용 |

### 5.2 데이터 모델 변경 제안 (`system-architect` 판단 필요)

> 번호는 `dialogue-design-설계.md`의 DD-17에 이어 **DD-18**부터 부여한다.

| ID | 대상 | 제안 | 근거 |
|---|---|---|---|
| **DD-18** | 세션 영속화 | **테이블을 만들지 않는 DD-10 결정을 유지**한다. 시뮬레이터·위젯 모두 **요청-응답 왕복**으로 상태를 주고받는다(FR-10-3, FR-11-26). <br>*재검토 근거*: DD-10은 "No.10 시뮬레이터가 왕복으로 상태를 주고받는다"를 전제로 내린 결정인데(설계서 §7.6), 이번에 **공개 대화 API라는 새 소비자**가 생겼으므로 전제가 바뀌었는지 확인했다. 결론은 유지다 — ① 상태가 슬롯 값과 인덱스뿐이라 크기가 작고 ② 서버가 상태를 신뢰하지 않고 매 턴 재검증하므로(FR-10-4) 조작 이득이 없으며 ③ 테이블을 만들면 **만료 정리 배치**가 동반돼 범위가 커진다. 단 §9.3에 "상담원 인계(No.24)·옴니채널 통합 인박스(No.42) 도입 시 재검토"를 명시한다. |
| **DD-19** | `Channel` | ① **`@@unique([chatbotId, type])` 추가**(FR-11-1 — 현재 제약 없음) ② `updatedAt DateTime @updatedAt` 추가(현재 `createdAt`만 있어 정렬·감사 불가) ③ `@@index([chatbotId])` 추가 ④ `type`은 기존대로 `String` + zod enum 단일 소스(§3.1 규약) | FR-11-1, FR-11-13 |
| **DD-20** | `ConversationLog` | ① **`matchedNodeId String?` 추가 검토** — 현재 `matchedIntentId`만 있어 "어떤 노드가 답했는지" 추적이 불가능하다. No.15(학습현황)·No.24(하이브리드 CS)·오류 분석에 직접 쓰인다. **ADR-0004의 선례**("쓰기 주체가 없는 컬럼은 만들지 않는다")를 이번에는 **통과한다** — 이 Phase에 쓰기 주체(공개 대화 API)가 생기기 때문이다. ② `@@index([chatbotId, isAnswered, createdAt])` 추가 검토(미응답 목록 조회, No.15 선행) | FR-11-20, No.15 대비 |
| **DD-21** | 마스킹 구현 위치 | PII 마스킹(FR-11-23)을 ① `apps/api/src/.../lib/pii-mask.ts` 순수 함수 vs ② `packages/pii-mask` 신규 패키지 중 선택. **①을 권장**(현재 소비자가 1곳뿐). 형제 프로젝트 `Auto QA`의 `packages/pii-mask` 패턴은 소비자가 늘 때 승격 대상으로 기록한다(`개발명세서.md` §5). | FR-11-23 |
| **DD-22** | 번들 캐시 저장소 | `DialogueBundleService`의 캐시를 ① 프로세스 메모리 Map + TTL ② 캐시 인터페이스 추상화 후 메모리 구현. **②를 권장**(ADR-0007 `ImportStagingStore`와 동일 패턴, 다중 인스턴스 전환 시 교체 지점 1곳). Redis 도입은 범위 밖. | FR-11-27, NFR-P1 |
| **DD-23** | 레이트리밋 구현 | `@nestjs/throttler` 도입 vs 자체 토큰버킷 `lib/`. 공개 API에만 적용해야 하므로 **컨트롤러 단위 적용이 가능한 방식**을 택한다. 신규 런타임 의존성 추가 여부는 아키텍트 판단(현재 신규 의존성은 `exceljs` 1건뿐). | NFR-S2 |
| **DD-24** | 아웃풋 렌더러 공유 | 위젯과 관리자 콘솔이 **동일 렌더러**를 써야 한다(FR-10-6, NFR-M1). ① `packages/` 신규 UI 패키지 ② 각 앱에 복제 ③ 순수 로직(아웃풋→표시 모델 변환)만 공유하고 마크업은 앱별. **③ 권장** — 위젯은 번들 100KB 제약과 스타일 격리 요건이 있어 콘솔용 React 컴포넌트를 그대로 쓰기 어렵다. | NFR-M1, FR-W-1 |
| **DD-25** | 위젯 기술 스택 | `apps/web`과 동일한 React+Vite vs 의존성 없는 순수 TS + Vite 라이브러리 모드. **번들 100KB(gzip) 목표와 호스트 페이지 침투 최소화 관점에서 후자를 검토**할 것을 권고하되, 팀 컨벤션 일관성(`개발명세서.md` §2)과의 트레이드오프는 아키텍트가 판단한다. | FR-W-1, FR-W-12 |

### 5.3 `shared-types` 신규/확장 스키마

| 스키마 | 내용 | 근거 |
|---|---|---|
| `ConversationStateSchema` | **대화 상태 봉투** — `{ version: 1, contextSession: ContextSessionState \| null, pendingClarify?: { homonymId, word, askedAt } }`. 기존 `ContextSessionState`를 감싸며 향후 확장 지점이 된다 | FR-10-3, FR-E2-2 |
| `SimulateRequestSchema` / `SimulateResponseSchema` | `{ message, state?, overlay?, buttonAction? }` / `DialogueResolution` + `{ matchedNodeName?, matchedIntentName?, matchedFaqQuestion?, elapsedMs, resolvedAt, assetCounts }` | FR-10-1, FR-10-8 |
| `DialogueOverlaySchema` | 종류별 배열 + `deletedIds`. 각 항목은 기존 도메인 스키마 재사용 | FR-10-18~21 |
| `CompareRequestSchema` / `CompareResponseSchema` | `{ messages[1~20], overlay, stateA?, stateB? }` / 턴별 `{ message, a, b, diff }` | FR-10-25~27 |
| `ButtonActionSchema` | `{ kind: 'MESSAGE', text } \| { kind: 'NODE', nodeId }` | FR-11-25, FR-W-6 |
| `ChannelImplementation` enum | `IMPLEMENTED` \| `CONFIG_ONLY` | FR-11-3 |
| `WebChannelConfigSchema` / `PlaceholderChannelConfigSchema` | FR-11-6 / FR-11-7 규격. `ChannelConfigSchema`는 `type` 기준 **판별 유니온** | FR-11-6~8 |
| `ChannelSchema` 재정비 | `enabled`, `implementation`, `configured`, `config`, `updatedAt` 포함. 기존 Phase 0 초안(`config: z.record(z.unknown())`)은 자유 JSON이라 검증 불가 → 교체 | FR-11-2, FR-11-8 |
| `ChannelListItemSchema` | 미설정 타입까지 포함한 8종 목록 항목 | FR-11-2 |
| `UpdateChannelSchema` | `{ enabled?, config? }`(부분 수정) | FR-11-2 |
| `PublicChatbotConfigSchema` | FR-11-14 응답 | FR-11-14 |
| `PublicMessageRequestSchema` / `PublicMessageResponseSchema` | FR-11-15 요청/응답(**trace·내부 ID 미포함**) | FR-0-18, FR-11-15 |
| `ApiErrorCode` 추가 값 | `CHANNEL_NOT_IMPLEMENTED`, `CHANNEL_DISABLED`, `CHATBOT_NOT_PUBLISHED`, `RATE_LIMITED`, `OVERLAY_INVALID`, `NO_CHANGES_TO_COMPARE` | §8 |
| `TraceCodeEnum` 추가 값 | `NODE_BY_ID`, `NODE_BY_ID_NOT_FOUND`, `CLARIFY_RESOLVED`, `CLARIFY_DISCARDED` | FR-E2-6 |

> 배치 규칙(`개발명세서.md` §6-9)에 따라 시뮬레이션·비교 계약은 `dialogue-engine.ts`에 append, 채널·공개 API 계약은 `channel.ts`에 append한다. 새 파일이 필요할 정도로 비대해지면 `conversation.ts` 신설을 검토한다.

### 5.4 API 엔드포인트 개요

**관리자 API** (`/api/v1/chatbots/:chatbotId` 하위, 챗봇 스코프 규약 상속)

| 메서드 | 경로 | 기능 | 주요 응답 |
|---|---|---|---|
| POST | `/simulate` | 단건 시뮬레이션(세션 왕복, 오버레이 선택) | 200 / 400 / 404 |
| POST | `/simulate/compare` | 저장본 vs 오버레이 비교 | 200 / 400 / 404 |
| GET | `/channels` | 채널 8종 목록(미설정 포함) | 200 / 404 |
| PATCH | `/channels/:type` | 활성화/설정 수정(upsert) | 200 / 400 / 404 / 409 |
| DELETE | `/channels/:type` | 채널 설정 초기화 | 204 / 404 / 409 |

**공개 API** (`/api/v1/public/...`, 인증 없음)

| 메서드 | 경로 | 기능 | 주요 응답 |
|---|---|---|---|
| GET | `/public/chatbots/:slug/config` | 위젯 부팅 설정 | 200 / 403 / 404 |
| POST | `/public/chatbots/:slug/messages` | 대화 1턴 | 200 / 400 / 403 / 404 / 429 |

> **`개발명세서.md` §4 정정 제안**(§10): 현재 표의 `POST /chatbots/:id/simulate`, `/chatbots/:id/compare`는 경로를 `/chatbots/:chatbotId/simulate`, `/chatbots/:chatbotId/simulate/compare`로 통일하고, **`POST /webhooks/:channel`은 "미구현(No.11 후속)"으로 표기**한다. 공개 API 계열(`/public/...`)은 표에 없으므로 신규 행을 추가한다.

---

## 6. 비기능 요구사항

### 6.1 성능

| ID | 요구사항 |
|---|---|
| NFR-P1 | 공개 대화 API 응답 **P95 500ms 이내**(번들 캐시 적중 시). 엔진 `resolveResponse` 자체는 기존 기준 P95 200ms를 유지한다(FR-E-10). |
| NFR-P2 | 번들 캐시 미적중(콜드) 요청은 **P95 1.5초 이내**. 캐시 적중률은 TTL 60초 기준으로 측정 가능해야 한다. |
| NFR-P3 | 관리자 단건 시뮬레이션 **P95 500ms 이내**(오버레이 포함). |
| NFR-P4 | 비교 실행(20문장 × 2번들 = 40회 해석) **P95 3초 이내**. 번들·인덱스는 요청당 1회만 조립해 재사용한다. |
| NFR-P5 | 위젯 `widget.js` **gzip 100KB 이내**, 부팅(설정 조회 포함) 후 첫 렌더 **2초 이내**(일반 회선 기준). |
| NFR-P6 | `ConversationLog` 적재는 **응답 반환을 지연시키지 않는다**(FR-11-24). 적재 지연이 대화 P95에 반영되지 않아야 한다. |
| NFR-P7 | 채널 목록 조회 **P95 300ms 이내**. |

### 6.2 보안

| ID | 요구사항 |
|---|---|
| NFR-S1 | 공개 API는 **관리자 데이터를 일절 반환하지 않는다** — `trace`, 내부 ID, 자산 목록, 그룹·상태·통계 정보 제외(FR-0-18). 응답 스키마를 분리해 실수로 새는 것을 타입으로 막는다. |
| NFR-S2 | 공개 API에 **레이트리밋**을 적용한다. 기본값: `sessionId` 기준 분당 30회, IP 기준 분당 120회. 초과 시 `429` + `Retry-After` 헤더. 값은 환경변수로 조정 가능해야 한다. |
| NFR-S3 | **CORS/Origin 검증**: `WEB` 채널의 `allowedOrigins`가 비어 있지 않으면 해당 출처만 허용한다. 자격증명(쿠키) 기반 요청은 사용하지 않는다(`credentials: 'omit'`). |
| NFR-S4 | 대화 로그 저장 전 **PII 마스킹 필수**(FR-11-23). 마스킹 전 원문은 로그·트레이스·에러 메시지 어디에도 남기지 않는다. |
| NFR-S5 | 대화 상태 봉투는 클라이언트가 보관하므로 **서버는 이를 신뢰하지 않는다**: 스키마 재검증 + 챗봇 스코프 검증 + 최대 수명 24시간 강제(FR-10-4). 봉투에 권한·식별 정보를 담지 않는다. |
| NFR-S6 | 슬롯 값(`filledValues`)은 PII 가능성이 있으므로 서버 로그에 원문을 남기지 않는다(NFR-S9 상속). 단 **관리자 시뮬레이터 화면에는 표시**한다(관리자 본인이 입력한 값이며 디버깅에 필수). |
| NFR-S7 | **채널 자격증명은 저장하지 않는다.** `CONFIG_ONLY` 채널의 config 스키마에 토큰/시크릿 필드를 두지 않으며(FR-11-7), 도입 시점(No.11 후속/No.39)에 암호화 저장·시크릿 관리 방식을 먼저 결정한다. |
| NFR-S8 | 위젯은 응답 텍스트를 **HTML로 렌더링하지 않고**(FR-W-11), URL은 `SafeUrlSchema`(http/https) 기준으로 필터링한다. 호스트 페이지 쿠키·localStorage·DOM에 접근하지 않는다. |
| NFR-S9 | 관리자 API에 `@RequirePermission('simulation:read'｜'channel:read'｜'channel:write')` 데코레이터를 부착한다(가드는 No.12까지 no-op). **공개 API에는 부착하지 않는다.** |
| NFR-S10 | 존재 노출 정책: 관리자 API는 기존대로 교차 챗봇 접근에 `404`. **공개 API는 예외적으로 `403`을 사용**하며 그 근거를 코드 주석·설계서에 남긴다(FR-11-16). |
| NFR-S11 | 금지어/비속어 필터(No.12)의 적용 지점을 표시한다 — **사용자 입력 수신 직후(해석 전)** 와 **응답 반환 직전** 두 곳. 이번 Phase에서는 필터를 적용하지 않는다. |
| NFR-S12 | 공개 대화 API는 사용자 입력을 그대로 외부로 전달하지 않는다(외부 API 호출 아웃풋 3종은 미실행 — FR-E-7). SSRF 표면은 이번 Phase에도 발생하지 않는다. |

### 6.3 접근성/UI 품질 (`UIUX_준수기준.md`)

| ID | 요구사항 |
|---|---|
| NFR-A1 | **위젯은 이 문서의 (a) 대상 그 자체**이므로 §1~§8 전 항목을 충족한다(FR-W-17~24). 관리자 콘솔은 기존 (b) 기준을 유지한다. |
| NFR-A2 | 시뮬레이터/비교 화면의 판정 근거·차이 배지는 **색상 + 텍스트 병기**로 구분한다(§1). |
| NFR-A3 | 채널 카드의 상태(활성/비활성/준비 중)는 배지 + 텍스트로 표시하고, 비활성 토글에는 `aria-disabled`와 사유 안내를 함께 제공한다(§1, §6). |
| NFR-A4 | 시뮬레이션 실행·비교 실행 중 스피너/스켈레톤으로 진행을 명시하고, 완료 시 "N턴 · 차이 M건" 배지로 완료 상태를 구분한다(§8). |
| NFR-A5 | trace 패널·비교 결과 표는 키보드로 탐색 가능해야 하며, 편집 화면 이동 링크는 `href` 기반이다(§9). |
| NFR-A6 | 오류는 제출 시점에 인라인으로 원인 + 해결 방법을 함께 표시한다(§7). |
| NFR-A7 | 신규 탭 추가 시 기존 `TabNav`의 규약(현재 탭을 색상 외 밑줄·굵기로 구분, `href` 기반)을 유지한다(§9). |
| NFR-A8 | 자동 접근성 스캔(axe)에서 위젯·신규 콘솔 화면 모두 대비 4.5:1 미만 요소 0건이어야 한다. |

### 6.4 유지보수/테스트 용이성

| ID | 요구사항 |
|---|---|
| NFR-M1 | 아웃풋 → 표시 모델 변환, 버튼 액션 판정, 차이 판정, `isAnswered` 판정, PII 마스킹, 오버레이 병합은 **전부 순수 함수**로 두고 DB·DOM 없이 단위 테스트한다. |
| NFR-M2 | 채널 어댑터는 인터페이스 1개 + 구현 1개(WEB)로 시작한다. 분기는 **팩토리 1곳**에만 존재해야 한다(컨트롤러·서비스에 `if (type === 'KAKAOTALK')` 류 분기 금지). |
| NFR-M3 | `DialogueBundleService`가 번들 조립·캐시·무효화의 단일 진입점이다. 시뮬레이션·비교·공개 대화가 모두 이를 통한다. |
| NFR-M4 | `apps/widget` 추가로 루트 스크립트(`build`/`lint`/`test`)와 CI 대상이 늘어난다. 기존 워크스페이스 스크립트 규약을 깨지 않도록 동일 명령어 세트를 제공한다. |
| NFR-M5 | seed에 이 그룹의 데이터를 추가한다 — **WEB 채널이 활성화된 `ACTIVE` 챗봇 1개**(위젯 수동 검증용), **채널이 하나도 없는 챗봇 1개**(빈 상태 검증용), 공개 대화로 생성될 로그와 구분되도록 기존 seed 로그는 유지. |
| NFR-M6 | 배포 형태 중립 유지 — 위젯/공개 API base URL은 환경변수로만 주입한다(NFR-M1 상속). 신규 환경변수가 필요하면 `env.validation.ts`에 부팅 검증을 추가한다. |
| NFR-M7 | DB 이식성 유지 — 로그 적재/조회에 원시 SQL을 쓰지 않는다. |

---

## 7. 수용기준 (Acceptance Criteria)

### AC-10. 응답 테스트/시뮬레이션 (No.10)

- **AC-10-1** Given 의도 `주문_배송조회`를 조건으로 하는 노드가 존재, When 시뮬레이션에 "배송 조회"를 전송하면, Then `200`과 함께 그 노드의 아웃풋이 반환되고 `matchedNodeId`·`matchedNodeName`이 채워진다.
- **AC-10-2** Given 동일 요청, When 응답을 검사하면, Then `trace` 배열이 비어 있지 않고 각 항목이 `TraceStepSchema`를 통과한다.
- **AC-10-3** Given `DRAFT` 챗봇, When 시뮬레이션을 실행하면, Then `200`으로 정상 동작한다. `ARCHIVED` 챗봇도 `200`이며 화면에 보관 안내 배너가 표시된다.
- **AC-10-4** Given `커피주문` 컨텍스트를 시작시키는 노드, When "커피 주문"을 전송하면, Then 첫 슬롯 질문이 출력되고 응답 `state.contextSession.status === 'IN_PROGRESS'`, `currentSlotIndex === 0`이다.
- **AC-10-5** Given 위 응답의 `state`를 그대로 실어 "아메리카노"를 전송하면, Then `filledValues.메뉴 === "아메리카노"`가 되고 두 번째 슬롯 질문이 출력된다.
- **AC-10-6** Given `state`를 보내지 않고 "아메리카노"만 전송하면, Then 세션이 없는 새 대화로 해석된다(오류 아님).
- **AC-10-7** Given 조작되거나 스키마에 맞지 않는 `state`, When 전송하면, Then `500`이 아니라 `200`이 반환되고 상태를 버린 새 대화로 처리된다.
- **AC-10-8** Given `startedAt`이 25시간 전인 `state`, When 전송하면, Then 상태가 폐기되고 새 대화로 처리된다.
- **AC-10-9** Given 다른 챗봇의 `contextVariableId`를 담은 `state`, When 전송하면, Then 상태가 폐기되며 그 챗봇의 자산 정보가 응답에 노출되지 않는다.
- **AC-10-10** Given 시뮬레이션을 10회 실행, When `ConversationLog`를 조회하면, Then **신규 행이 0건**이고 `UnansweredQuestion`도 증가하지 않는다.
- **AC-10-11** Given 대화 자산이 0건인 챗봇, When 아무 문장이나 전송하면, Then `200`과 기본 폴백 문구가 반환되고 화면에 빈 상태 안내 + `대화설계로 이동` 링크가 표시된다.
- **AC-10-12** Given `SURVEY` 아웃풋만 가진 노드가 매칭되는 입력, When 전송하면, Then `unsupportedOutputs`에 `SURVEY`가 담기고 화면에 미실행 안내가 표시되며 최소 1건의 대체 응답이 표시된다. **[No.27 한정]** 이 기준은 **v1(이전 형식) `SURVEY`** 에 대해 그대로 유지된다(바이트 동일 — AC-SV1-1). v2 `SURVEY`는 설문을 시작하거나, 참여할 수 없으면 설문 고정 문구("지금은 참여할 수 있는 설문이 없어요." 등)로 응답한다(`unsupportedOutputs` 비어 있음 — AC-SV2-8/9)
- **AC-10-13** Given 전송 버튼, When 빠르게 3회 클릭하면, Then 요청은 1회만 발생한다.
- **AC-10-14** Given 시뮬레이션 전후, When DB 스냅샷을 비교하면, Then `Channel`/`ConversationLog`를 포함해 **어떤 테이블도 변경되지 않았다**.
- **AC-10-15** Given `BUTTON` 아웃풋이 포함된 응답, When 화면의 버튼을 키보드 `Enter`로 실행하면, Then 해당 액션이 실행되고 대화가 이어진다.
- **AC-10-16** Given 1,001자 입력, When 입력하면, Then 전송 버튼이 비활성화되고 잔여 글자 수 표시가 초과 상태를 나타낸다.
- **AC-10-17** Given 노드 편집 화면, When 사이드 패널로 응답 테스트를 열면, Then 편집 중 내용이 유실되지 않고 이탈 경고도 뜨지 않는다.

### AC-10B. 미리보기(오버레이)와 비교

- **AC-10B-1** Given 저장본 노드의 응답이 "A", When 같은 노드의 텍스트를 "B"로 바꾼 오버레이로 시뮬레이션하면, Then 응답이 "B"이고 **DB의 저장본은 여전히 "A"** 다.
- **AC-10B-2** Given `draft-1` 임시 ID를 가진 신규 노드 오버레이, When 그 조건에 맞는 입력을 전송하면, Then 신규 노드가 매칭되어 아웃풋이 반환된다.
- **AC-10B-3** Given `deletedIds.dialogNodes`에 기존 노드 ID를 담은 오버레이, When 그 노드 조건에 맞는 입력을 전송하면, Then 해당 노드는 매칭되지 않고 후순위 경로(FAQ/폴백)로 응답한다.
- **AC-10B-4** Given `IMAGE` 아웃풋에 `altText`가 없는 오버레이 노드, When 전송하면, Then `400`이 반환되고 `details[].field`가 오버레이 내 위치를 가리킨다.
- **AC-10B-5** Given 종류별 21건짜리 오버레이, When 전송하면, Then `400`(`LIMIT_EXCEEDED`)이 반환된다.
- **AC-10B-6** Given 오버레이가 적용된 대화, When 화면을 보면, Then `미저장 변경 적용됨` 배지가 색상+텍스트로 표시된다.
- **AC-10B-7** Given 문장 5건 + 응답 문구 1건만 바꾼 오버레이, When 비교를 실행하면, Then 5행이 반환되고 변경된 1행만 `status: 'DIFFERENT'`, 나머지는 `'SAME'`이다.
- **AC-10B-8** Given 매칭 대상이 노드 → FAQ로 바뀌는 오버레이, When 비교를 실행하면, Then 해당 행의 `diff.matchChanged === true`다(응답 문구가 우연히 같더라도).
- **AC-10B-9** Given 멀티턴 문장 3건("커피 주문", "아메리카노", "라지"), When 비교를 실행하면, Then A/B 각각 독립 세션으로 3턴이 진행되어 서로의 슬롯 값이 섞이지 않는다.
- **AC-10B-10** Given 빈 오버레이, When 비교를 실행하면, Then 실행이 차단되고 "비교할 변경 내용이 없습니다" 안내가 표시된다.
- **AC-10B-11** Given 21개 문장, When 비교를 요청하면, Then `400`과 상한 안내가 반환된다.
- **AC-10B-12** Given 비교 실행 후, When `ConversationLog`를 조회하면, Then 신규 행이 0건이다.

### AC-11. 채널 관리 (No.11)

- **AC-11-1** Given 채널 레코드가 0건인 챗봇, When 채널 목록을 조회하면, Then `200`과 함께 **8종 전부**가 반환되고 모두 `configured: false`, `enabled: false`다.
- **AC-11-2** Given 위 상태, When `WEB` 채널을 `enabled: true`로 PATCH하면, Then `200`이고 레코드가 생성되며 `implementation: 'IMPLEMENTED'`다.
- **AC-11-3** Given `KAKAOTALK` 채널, When `enabled: true`로 PATCH하면, Then **`409`(`CHANNEL_NOT_IMPLEMENTED`)** 가 반환되고 레코드의 `enabled`는 변하지 않는다.
- **AC-11-4** Given `KAKAOTALK` 채널, When `config: { note: "2분기 예정" }`만 PATCH하면, Then `200`으로 저장된다.
- **AC-11-5** Given `KAKAOTALK` 채널, When `config`에 `accessToken` 같은 미정의 필드를 보내면, Then strip 모드로 무시되거나 `400`이 반환되며 **어떤 경우에도 DB에 저장되지 않는다**.
- **AC-11-6** Given 같은 챗봇에 `WEB` 채널이 이미 존재, When 같은 타입을 다시 생성 시도하면, Then 중복 레코드가 생기지 않는다(upsert 또는 `409`).
- **AC-11-7** Given `WEB` 채널의 `allowedOrigins`가 빈 배열, When 화면을 보면, Then "모든 도메인에서 호출 가능" 주의 배지가 표시된다.
- **AC-11-8** Given `allowedOrigins`에 21건을 넣으면, Then `400`과 상한 안내가 반환된다.
- **AC-11-9** Given `ARCHIVED` 챗봇, When 채널을 PATCH하면, Then `409`(`CHATBOT_ARCHIVED`)가 반환된다. 목록 조회는 `200`이다.
- **AC-11-10** Given 채널 설정을 저장한 뒤, When 채널을 삭제하면, Then `204`이고 목록에서 다시 `configured: false`로 표시된다.
- **AC-11-11** Given 채널 화면, When `WEB` 카드를 보면, Then 임베드 코드 탭 바로가기와 공개 URL이 함께 표시된다.
- **AC-11-12** Given `CONFIG_ONLY` 채널 카드, When 키보드로 탐색하면, Then 토글이 비활성(`aria-disabled`)이고 준비 중 사유가 읽힌다.

### AC-P. 공개 대화 API

- **AC-P-1** Given `ACTIVE` 챗봇 + `WEB` 채널 활성, When `GET /public/chatbots/:slug/config`를 호출하면, Then `200`과 스킨·인사말이 반환되고 **내부 ID·상태·통계 필드는 포함되지 않는다**.
- **AC-P-2** Given 존재하지 않는 slug, When 호출하면, Then `404`가 반환된다.
- **AC-P-3** Given `DRAFT` 챗봇, When 공개 API를 호출하면, Then `403`(`CHATBOT_NOT_PUBLISHED`)이 반환된다.
- **AC-P-4** Given `ACTIVE` 챗봇이지만 `WEB` 채널이 비활성, When 호출하면, Then `403`(`CHANNEL_DISABLED`)이 반환된다.
- **AC-P-5** Given 정상 조건, When `POST /public/chatbots/:slug/messages`로 "배송 조회"를 전송하면, Then `200`과 아웃풋이 반환되고 응답에 **`trace`·`matchedNodeId`·`matchedIntentId`가 존재하지 않는다**.
- **AC-P-6** Given 위 요청 후, When `ConversationLog`를 조회하면, Then 1행이 추가되고 `channelType='WEB'`, `sessionId`가 요청값과 일치하며 `isAnswered=true`다.
- **AC-P-7** Given 아무것도 매칭되지 않는 입력, When 전송하면, Then 폴백 응답이 반환되고 로그의 `isAnswered=false`다.
- **AC-P-8** Given 사용자가 "제 번호는 010-1234-5678이에요"를 전송, When 로그를 조회하면, Then `userMessage`에 원본 전화번호가 **저장되어 있지 않다**(마스킹됨).
- **AC-P-9** Given 위 로그가 쌓인 뒤, When No.2 대시보드를 조회하면, Then `visitCount`/`responseRate`/`topQuestions`가 0이 아닌 값으로 반환되고 인기질문에 원본 PII가 노출되지 않는다.
- **AC-P-10** Given 로그 적재가 실패하도록 강제한 상황, When 대화를 요청하면, Then 사용자는 **정상 응답을 받는다**(대화가 실패하지 않음).
- **AC-P-11** Given `allowedOrigins`에 `https://a.example.com`만 등록, When `https://evil.example.com`에서 호출하면, Then CORS로 차단된다.
- **AC-P-12** Given 같은 `sessionId`로 1분 내 31회 요청, When 31번째를 호출하면, Then `429`와 `Retry-After` 헤더가 반환된다.
- **AC-P-13** Given `buttonAction: { kind: 'NODE', nodeId }`, When 전송하면, Then 해당 노드의 아웃풋이 반환된다. 존재하지 않는 `nodeId`면 예외 없이 폴백 응답이 반환된다.
- **AC-P-14** Given 채널을 비활성화한 직후(캐시 TTL 이내), When 대화를 요청하면, Then 즉시 `403`이 반환된다(캐시 만료를 기다리지 않음).
- **AC-P-15** Given 동일 입력을 시뮬레이션 API와 공개 API로 각각 호출, When 아웃풋을 비교하면, Then **동일하다**(엔진 단일 경로 보장, FR-0-19).

### AC-W. 위젯 (`apps/widget`)

- **AC-W-1** Given 임베드 스니펫을 붙인 테스트 HTML, When 페이지를 열면, Then 런처 버튼이 렌더되고 콘솔 오류가 없다.
- **AC-W-2** Given 런처, When 클릭(또는 키보드 Enter)하면, Then 패널이 열리고 포커스가 입력창으로 이동하며 인사말이 1회 표시된다.
- **AC-W-3** Given 열린 패널, When `Esc`를 누르면, Then 패널이 닫히고 포커스가 런처로 복귀한다.
- **AC-W-4** Given 입력창, When 문장을 입력하고 `Enter`를 누르면, Then 사용자 말풍선이 즉시 표시되고 "응답 생성 중" 후 봇 응답이 표시된다. `Shift+Enter`는 줄바꿈이다.
- **AC-W-5** Given 봇 응답 도착, When 스크린리더를 사용하면, Then `aria-live` 영역으로 새 메시지가 읽힌다.
- **AC-W-6** Given `CARD`/`IMAGE`/`BUTTON`/`LINK`/`PHONE_CALL` 아웃풋, When 렌더되면, Then 각 타입이 규격대로 표시되고 이미지에는 `alt`가 적용된다.
- **AC-W-7** Given 응답 텍스트에 `<script>alert(1)</script>`가 포함, When 렌더되면, Then 스크립트가 실행되지 않고 문자 그대로 표시된다.
- **AC-W-8** Given `PAUSE` 아웃풋이 포함된 응답, When 렌더되면, Then 지정 시간만큼 타이핑 인디케이터가 표시된 뒤 다음 아웃풋이 나타난다.
- **AC-W-9** Given 버튼 `MESSAGE` 액션, When 클릭하면, Then 해당 텍스트가 사용자 메시지로 전송되고 말풍선에 표시된다.
- **AC-W-10** Given 버튼 `LINK` 액션, When 클릭하면, Then 새 탭이 열리고 **서버 호출은 발생하지 않는다**.
- **AC-W-11** Given 멀티턴 폼, When 페이지를 새로고침하지 않고 대화를 이어가면, Then 슬롯이 순서대로 채워지고 완료 메시지가 출력된다.
- **AC-W-12** Given 네트워크 오류, When 전송하면, Then 오류 말풍선과 `재시도` 버튼이 표시되고 위젯이 깨지지 않는다.
- **AC-W-13** Given 챗봇이 비활성화된 상태(`403`), When 위젯을 열면, Then "현재 상담을 이용할 수 없습니다" 안내가 표시되고 입력창이 비활성화된다.
- **AC-W-14** Given `primaryColor`가 밝은 색(`#FFF176`), When 헤더가 렌더되면, Then 텍스트 색이 자동으로 어두운 색으로 전환되어 대비 4.5:1을 만족한다.
- **AC-W-15** Given 위젯 전체, When 마우스를 쓰지 않고 키보드만으로 조작하면, Then 열기→입력→전송→버튼 선택→닫기까지 전 과정을 완료할 수 있다.
- **AC-W-16** Given axe 스캔, When 위젯 페이지를 검사하면, Then 대비 4.5:1 미만 요소가 0건이다.
- **AC-W-17** Given 빌드 산출물, When `widget.js` 크기를 측정하면, Then gzip 100KB 이내다.
- **AC-W-18** Given `/c/:slug` 경로, When 브라우저로 직접 열면, Then 전체화면 대화 화면이 표시된다.

### AC-E2. 엔진 보강

- **AC-E2-1** Given `action: 'NODE'` 버튼을 포함한 응답, When 그 `nodeId`로 `resolveByNodeId`를 호출하면, Then 해당 노드의 아웃풋이 반환되고 `trace`에 `NODE_BY_ID`가 남는다.
- **AC-E2-2** Given 존재하지 않거나 `enabled=false`인 `nodeId`, When 호출하면, Then 예외 없이 폴백 응답이 반환되고 `trace`에 `NODE_BY_ID_NOT_FOUND`가 남는다.
- **AC-E2-3** Given `ASK` 정책 동음이의어 `배`, When "배 얼마예요?"를 전송하면, Then 되묻기 버튼이 반환되고 응답 `state.pendingClarify`가 채워진다.
- **AC-E2-4** Given 위 상태를 실어 "선박"을 전송하면, Then **선박 의미로 확정**되어 연결 의도 기반 응답이 나오고 `trace`에 `CLARIFY_RESOLVED`가 남는다(현행 구현에서 깨져 있던 경로).
- **AC-E2-5** Given 위 상태에서 전혀 다른 문장을 전송하면, Then `pendingClarify`가 폐기되고 일반 해석이 수행되며 `trace`에 `CLARIFY_DISCARDED`가 남는다.
- **AC-E2-6** Given 기존 엔진 단위 테스트 전체(`matcher.spec.ts`, `resolver.spec.ts` 등), When 보강 후 실행하면, Then **전부 통과한다**(하위호환, AC-E-11 연장).

### AC-C. 공통/횡단

- **AC-C-1** 모든 엔드포인트 응답이 대응하는 zod 스키마 파싱을 통과한다(계약 테스트).
- **AC-C-2** 관리자 화면(응답 테스트·채널) 전 과정을 **마우스 없이 키보드만으로** 완료할 수 있다.
- **AC-C-3** 신규 탭 2개를 추가한 뒤에도 기존 4개 탭의 라우팅·이탈 경고(`UnsavedGuardContext`)가 정상 동작한다.
- **AC-C-4** 영문/일문/이모지가 포함된 입력이 시뮬레이션·공개 대화·로그 저장에서 깨지지 않는다.
- **AC-C-5** 공개 API 응답 스키마에 내부 필드가 추가되면 타입 검사 또는 계약 테스트가 실패한다(NFR-S1의 회귀 방지).
- **AC-C-6** 채널 삭제·비활성화 확인 모달에서 `Esc`로 취소하면 아무 변경도 발생하지 않고 포커스가 트리거로 복귀한다.

---

## 8. 예외 케이스 정리

### 8.1 시뮬레이션·비교

| ID | 상황 | 기대 동작 |
|---|---|---|
| EX-10-1 | 빈 문자열/공백/제어문자만 입력 | 요청을 보내지 않고 인라인 안내. 서버에 도달하면 엔진의 `EMPTY_INPUT` 경로로 정상 응답(`400` 아님) |
| EX-10-2 | 1,000자 초과 입력 | 클라이언트에서 전송 차단. 서버 도달 시 앞 1,000자만 사용하고 `trace`에 `INPUT_TRUNCATED` |
| EX-10-3 | 손상·조작된 `state` | 상태 폐기 후 새 대화로 처리. `500` 금지(FR-10-4) |
| EX-10-4 | 다른 챗봇의 `contextVariableId`를 담은 `state` | 상태 폐기. 타 챗봇 자산 정보 노출 금지 |
| EX-10-5 | 24시간 초과 `state` | 폐기 + "대화가 만료되어 새로 시작합니다" 안내 |
| EX-10-6 | 시뮬레이션 중 다른 관리자가 자산을 수정 | 다음 요청에서 최신 번들로 해석(캐시 무효화). 진행 중 세션의 슬롯 구조가 바뀌면 엔진의 `SESSION_DEFINITION_CHANGED` 경로로 재시작 안내 |
| EX-10-7 | 오버레이 항목이 스키마 위반 | `400` + 오버레이 내 경로를 포함한 `details` |
| EX-10-8 | 오버레이 `deletedIds`가 존재하지 않는 ID를 지정 | 오류 아님. 무시하고 진행 |
| EX-10-9 | 오버레이 노드가 존재하지 않는 의도를 참조 | 엔진이 끊어진 참조로 무시 + `trace` 경고(FR-E-9). 화면에 경고 표시 |
| EX-10-10 | 비교 중 한쪽만 예외적으로 길어짐(hop limit 등) | 양쪽 모두 정상 응답. 해당 행은 `DIFFERENT`로 표시되고 `trace`로 사유 확인 가능 |
| EX-10-11 | `SCENARIO`/`SURVEY`/`API_CONDITION`만 가진 노드가 매칭 | `unsupportedOutputs`에 기록 + 안내 문구로 폴백(EX-D-6 상속) |
| EX-10-12 | 관리자 세션 만료(No.12 도입 후) | `401` 수신 시 입력 내용을 보존한 채 재로그인 유도. 이번엔 훅 자리만 |

### 8.2 채널

| ID | 상황 | 기대 동작 |
|---|---|---|
| EX-11-1 | `CONFIG_ONLY` 채널 활성화 시도 | `409`(`CHANNEL_NOT_IMPLEMENTED`) + 준비 중 안내 |
| EX-11-2 | 자격증명 필드를 임의로 전송 | strip 또는 `400`. **DB 저장 금지**(NFR-S7) |
| EX-11-3 | 동일 타입 채널 중복 생성 | 유일 제약으로 차단(upsert로 처리하거나 `409`) |
| EX-11-4 | `allowedOrigins`에 잘못된 형식(`example.com`, `*`, `javascript:`) | `400` + 허용 형식 안내(스킴 + 호스트) |
| EX-11-5 | `ARCHIVED` 챗봇의 채널 수정 | `409`(`CHATBOT_ARCHIVED`) |
| EX-11-6 | WEB 채널을 끈 상태에서 임베드 코드 조회 | 코드 조회는 허용(FR-4-12 정책 일관). 화면에 "채널이 비활성화되어 있어 현재 동작하지 않습니다" 안내 추가 |
| EX-11-7 | 채널 레코드를 삭제한 뒤 과거 로그 조회 | 로그의 `channelType` 문자열은 그대로 유지(참조 아님) |
| EX-11-8 | 두 관리자가 동시에 같은 채널을 수정 | last-write-wins(EX-X-2 상속). 응답의 `updatedAt`으로 화면 갱신 |

### 8.3 공개 대화 API

| ID | 상황 | 기대 동작 |
|---|---|---|
| EX-P-1 | 존재하지 않는 slug | `404` |
| EX-P-2 | `DRAFT`/`ARCHIVED` 챗봇 | `403`(`CHATBOT_NOT_PUBLISHED`) + 위젯은 이용 불가 안내 |
| EX-P-3 | WEB 채널 비활성 | `403`(`CHANNEL_DISABLED`) |
| EX-P-4 | 허용되지 않은 Origin | CORS 차단(브라우저 레벨) + 서버 로그 경고 |
| EX-P-5 | 레이트리밋 초과 | `429` + `Retry-After` + 위젯 전용 안내 문구 |
| EX-P-6 | `sessionId` 누락/형식 오류 | `400`. 위젯은 새 `sessionId`를 발급해 재시도 |
| EX-P-7 | 같은 `sessionId`로 여러 탭에서 동시 대화 | 서버는 상태를 보관하지 않으므로 각 탭의 `state`가 독립 동작한다. 로그는 같은 세션으로 집계됨을 문서로 고지 |
| EX-P-8 | 로그 적재 실패(DB 오류) | 대화 응답은 성공. 서버 경고 로그만 남김(FR-11-24) |
| EX-P-9 | 번들 조립 실패(자산 JSON 손상) | 엔진 규약대로 손상 항목 무시 + 폴백 응답. `500` 금지 |
| EX-P-10 | 대화 중 관리자가 챗봇을 `ARCHIVED`로 전환 | 다음 요청부터 `403`. 위젯은 이용 불가 안내로 전환 |
| EX-P-11 | 금지어/비속어 입력 | 이번 Phase는 필터링하지 않음. No.12 적용 지점만 표시(NFR-S11) |
| EX-P-12 | 다국어(영문/일문) 입력 | UTF-8 정상 처리. 단 매칭은 정규화 문자열 비교이므로 매칭률 한계는 알려진 제약(EX-X-5 상속) |
| EX-P-13 | 응답 생성 중 사용자가 페이지 이탈 | 서버는 로그를 남기고 종료. 클라이언트 상태는 `sessionStorage`에 남지 않음(탭 종료 시 소멸) |

### 8.4 위젯

| ID | 상황 | 기대 동작 |
|---|---|---|
| EX-W-1 | `WIDGET_BASE_URL` 미설정으로 스니펫이 잘못된 URL을 가리킴 | 부팅 시 env 검증 실패로 API가 기동하지 않음(EX-4-3 상속). 위젯 측에서는 콘솔 경고만 |
| EX-W-2 | 호스트 페이지 CSS가 위젯 스타일을 덮어씀 | 스타일 격리로 방지(FR-W-12). 최소한 글꼴·색·레이아웃이 깨지지 않아야 함 |
| EX-W-3 | 호스트 페이지에 이미 다른 위젯이 있음 | 전역 네임스페이스 충돌 금지(단일 전역 심볼만 사용) |
| EX-W-4 | 스니펫이 같은 페이지에 2회 삽입됨 | 중복 초기화 방지 — 두 번째 삽입은 무시하고 경고 로그 |
| EX-W-5 | 아웃풋 이미지 URL이 깨짐 | 대체 텍스트로 폴백, 레이아웃이 무너지지 않음 |
| EX-W-6 | 응답 아웃풋이 0건(이론상) | "잠시 후 다시 시도해 주세요" 기본 문구 표시. 빈 말풍선 금지 |
| EX-W-7 | `sessionStorage` 사용 불가(프라이빗 모드 등) | 메모리 상태로 폴백. 대화는 계속 가능하며 새로고침 시 초기화 |
| EX-W-8 | 매우 긴 응답(2,000자) | 말풍선이 세로 스크롤 또는 자연 줄바꿈으로 표시되고 화면이 깨지지 않음 |

---

## 9. Out of scope (이번 Phase 제외)

### 9.1 실제 외부 채널 프로토콜 연동 — 명시적 제외 (J-2)

- **카카오톡 / 라인 / 페이스북 메신저 / 네이버 톡톡 / 모바일 앱 SDK / 키오스크**의 **Webhook 수신·서명 검증·메시지 포맷 변환·아웃바운드 발신 어댑터**를 전부 제외한다. `POST /webhooks/:channel`(`개발명세서.md` §4) 경로는 **만들지 않는다.**
- 제외 사유: ① 플랫폼 계정·자격증명·공개 HTTPS 엔드포인트·플랫폼 심사가 전제이며 현재 개발 환경에서 확보 불가 ② 따라서 **수용기준(AC)을 작성할 수 없다** ③ 자격증명 저장을 위한 암호화·시크릿 관리 방식이 미결정이다(NFR-S7).
- 이번 Phase가 남기는 것: **채널 설정 CRUD**(FR-11-1~13) + **채널 어댑터 계약**(FR-11-17~19) + **채널 무관 단일 대화 파이프라인**. 새 채널 추가는 "어댑터 1개 + 팩토리 분기 1줄 + config 스키마 1개"로 끝나야 한다.
- 채널별 리치 메시지 컴포넌트(카카오 캐러셀·바로연결버튼 등)는 **No.46**(보완 제안, 미확정) 범위다.

### 9.2 확장기능 — 명시적 제외

- **No.16 딥러닝 학습엔진(DLE)**: 증강학습·재학습 파이프라인은 범위 밖이다. 이번 그룹의 "학습 중 미리보기"는 **학습이 아니라 "저장 전 미리보기"** 이며(§4.1.2), 매칭은 여전히 **정규화 기반 규칙 매칭**만 사용한다. 의미 유사도(No.18)·군집분석(No.21)·생성형 RAG(No.30)도 도입하지 않는다.
- **No.25 챗봇 복원/버전 이력관리**: 버전 스냅샷·롤백·업데이트 히스토리는 범위 밖이다. 따라서 **"버전 간 응답 비교"는 제공하지 않는다**(J-1).
- **No.19 대화검증시스템 & TC 테스트**: 엑셀 대량 문장 업로드 기반 일괄 검증·버전 비교는 범위 밖이다. 이번 비교는 **최대 20문장 직접 입력**까지다(FR-10-29).
- **No.20 학습영향도 TEST**: 운영 vs 추가학습 챗봇의 회귀 비교 본체는 이 항목이며, No.10의 비교는 그 **축소 대체물**임을 명시한다.
- **No.24 하이브리드 CS**(실시간 모니터링·상담원 개입·응답힌트), **No.42 옴니채널 통합 인박스**: 상담원 관점 기능 전체 제외. 단 이들이 도입되면 DD-18(세션 비영속) 결정을 재검토해야 함을 기록한다.
- **No.27 설문관리 / No.26 레거시 API 연동**: `SURVEY`·`SCENARIO`·`API_CONDITION` 아웃풋은 이번에도 **실행하지 않는다**(`unsupportedOutputs`로 보고, FR-E-7).
- **No.40 Dev/Staging/Prod 환경 분리 + 시뮬레이터**, **No.28 운영 예약 배포**: 환경 분리·트래픽 전환·예약 반영은 범위 밖.
- **No.44 피드백 기반 개선 루프**(👍/👎 수집): 위젯에 평가 버튼을 넣지 않는다.
- **No.12 회원·권한·금지어 필터**, **No.13 이력관리(AuditLog)**, **No.14/15 통계·학습현황**: 각 그룹의 Phase. 이번엔 권한 데코레이터·AuditLog 기록 지점·금지어 필터 적용 지점만 표시한다.

### 9.3 기타 제외 항목

| 항목 | 제외 사유 / 이관 대상 |
|---|---|
| 대화 상태의 **서버 영속화**(세션 테이블/Redis)와 만료 정리 배치 | DD-18 유지. 상담원 인계(No.24)·옴니채널(No.42) 도입 시 재검토 |
| **WebSocket/SSE 실시간 전송** | 이번 대화는 요청-응답(REST) 1턴 단위. 스트리밍 응답은 생성형 AI(No.30) 도입 시 검토 |
| 위젯의 **대화 이력 복원**(새로고침·재방문 시 이전 대화 표시) | 서버 세션 영속화 전제. 범위 밖(FR-W-8) |
| 위젯 **파일 첨부·이미지 업로드·음성 입출력** | No.32(음성 AI), No.33(멀티모달) |
| 위젯 **다국어(i18n)**, RTL 지원 | 한국어 고정(FR-0-23) |
| 위젯 **아이프레임 완전 격리 / CSP 세밀 제어 / SRI** | 최소 버전 범위 밖. 스타일 격리(FR-W-12)까지만 |
| 위젯 **테마 고급 커스터마이징**(폰트·말풍선 모양·다크모드·위치 미세조정) | `ChatbotSkinSchema` 3필드 범위 유지(No.4 정책 승계) |
| 채널별 **발송량·전환율 통계** | No.14(기본 통계)·No.29(통합 통계) |
| 챗봇 **대화 자산 포함 복제(deep copy)** | FR-1-14 정책 유지. 필요해지면 No.25 버전 스냅샷과 함께 설계(§4.1.3 근거 3) |
| **부하 테스트·오토스케일링·다중 인스턴스 캐시 동기화** | 캐시·레이트리밋을 인터페이스로 추상화(DD-22, DD-23)하는 것까지. 실제 분산 전환은 배포 Phase |
| 낙관적 잠금·동시 편집 충돌 해결 | last-write-wins 유지(EX-11-8) |
| CI 연동·실제 배포 | `docs/05-ops/자동배포.md` §1 — 사용자가 플랫폼/자격증명을 명시하기 전 착수 금지 |

---

## 10. `기능요구사항.md` 및 상위 문서 갱신 제안

기준 목록(`docs/01-requirements/기능요구사항.md` §2)과 대조한 결과 **기능 항목의 추가·삭제는 불필요**하다. 아래 설명 보강 3건·각주 2건과 상위 명세서 정정 2건을 제안한다(반영 여부는 PM 확인 후 결정).

| 대상 | 현재 문구 | 제안 |
|---|---|---|
| §2 No.10 | "실시간 대화 테스트, 학습 중 미리보기, **운영 챗봇 vs 학습 중 챗봇 실시간 비교**(intro.txt FEATURE 4)" | 동일 + 비고 "**1차 범위는 (a) 실시간 대화 테스트 (b) 저장 전 미리보기(오버레이) (c) 저장본 vs 미저장 변경 비교**까지다. **'운영 vs 학습중' 비교의 본체는 확장기능 No.20(학습영향도 TEST)** 이며, 전제 기능인 학습(No.16)·버전 스냅샷(No.25)이 확장 범위이므로 기본기능에서는 축소 구현한다 — `quality-channel.md` §4.1.3" |
| §2 No.10 | — | **각주 추가**: "시뮬레이션은 `ConversationLog`를 기록하지 않는다(운영 통계 오염 방지). 대화 상태는 서버에 저장하지 않고 요청-응답 왕복으로 유지한다(DD-10/DD-18)" |
| §2 No.11 | "웹/모바일/카카오톡/라인/페이스북/네이버톡톡/앱/키오스크 등 배포" | 동일 + 비고 "**1차 범위는 (a) 8종 채널 설정 CRUD (b) WEB 채널의 종단 동작(`apps/widget` + 공개 대화 API)** 이며, 나머지 7종은 **설정 저장만 가능하고 활성화는 차단**된다(`CONFIG_ONLY`). 외부 채널 Webhook 어댑터는 자격증명·플랫폼 심사가 전제라 후속 Phase. `WEB`은 PC/모바일 웹 임베드를 모두 포괄하고 `MOBILE`은 앱 웹뷰/SDK로 의미를 좁힌다 — `quality-channel.md` §4.2.1" |
| §2 No.11 | — | **각주 추가**: "이 그룹에서 `ConversationLog`의 최초 쓰기 주체가 생긴다. 따라서 No.2(대시보드)·No.14(기본 통계)·No.15(학습현황)의 데이터 공급이 여기서 시작되며, 저장 전 PII 마스킹이 이 Phase의 책임이다" |
| §2 No.12 | "회원(그룹)관리, 권한관리, 로그인 정책, 금지어/비속어 필터" | 동일 + 비고 "금지어 필터의 적용 지점은 **공개 대화 입력 수신 직후 / 응답 반환 직전** 2곳이다(`quality-channel.md` NFR-S11)" |
| `개발명세서.md` §4 | 품질/시뮬레이션 행 `POST /chatbots/:id/simulate`, `/chatbots/:id/compare` / 채널 행 `POST /webhooks/:channel`, `/channels` | 경로를 `/chatbots/:chatbotId/simulate`, `/chatbots/:chatbotId/simulate/compare`, `/chatbots/:chatbotId/channels`로 정정하고, **`/webhooks/:channel`은 "미구현(외부 채널 Phase)"으로 표기**. **공개 API 계열(`/api/v1/public/chatbots/:slug/config｜messages`) 행 신설** |
| `개발명세서.md` §2.2 | 품질/채널/보안/통계(No.10~15) 모듈: `simulation`, `channels`, … "미착수" | `simulation`, `channels`, **`conversation`(공개 대화 파이프라인·번들 서비스·어댑터)** 로 갱신하고 상태를 "설계 완료 → `quality-channel-설계.md`"로 변경 |

`docs/04-test/시험항목.md`에는 이 그룹 케이스가 없으므로 **TC-10(응답 테스트)·TC-10B(미리보기/비교)·TC-11(채널 관리)·TC-P(공개 대화 API)·TC-W(위젯 접근성/렌더링)** 추가를 `test-automation` 단계에서 제안한다.

---

## 11. 다음 단계 인계 사항

| 대상 에이전트 | 확인/결정 필요 사항 |
|---|---|
| `system-architect` | ① **§1.3 J-1/J-2/J-3 세 판단의 확정**(PM 승인 전제) ② **DD-18 세션 비영속 유지 재확인**(공개 대화 API라는 새 소비자 반영) ③ DD-19 `Channel` 제약·필드 ④ **DD-20 `ConversationLog.matchedNodeId` 추가 여부**(ADR-0004 선례 대비 판단 근거 명시) ⑤ DD-21 PII 마스킹 위치 ⑥ **DD-22 번들 캐시 전략·무효화 지점**(쓰기 API 6개 모듈 전부가 무효화 트리거) ⑦ DD-23 레이트리밋 구현·신규 의존성 ⑧ **DD-24 아웃풋 렌더러 공유 방식** ⑨ **DD-25 위젯 기술 스택·번들 전략** ⑩ **FR-E2-1/E2-2 엔진 보강 인터페이스 확정**(특히 `pendingClarify` 방식) ⑪ §5.3 신규 zod 스키마 배치 ⑫ §5.4 엔드포인트 확정 + `개발명세서.md` §2.2/§4 정정(§10) ⑬ 공개 API의 `403 vs 404` 정책 예외 승인 ⑭ 신규 환경변수 필요 여부 |
| `ui-designer` | ① **챗봇 상세 탭 구조** — 기존 4탭(dashboard/settings/skin/dialogue)에 `응답 테스트`·`채널` 2탭 추가(총 6탭) 적정성 판단, 과밀하면 그룹핑 대안 제시 ② 응답 테스트 화면(대화 영역 + 세션 상태 패널 + trace 패널 + 오버레이 배지) ③ **사이드 패널(드로어) 진입 경로**(FR-10-17)와 탭 진입의 레이아웃 공유 ④ 비교 화면 2단 레이아웃 + 차이 배지 + 반응형 스택 ⑤ 채널 카드 8종(구현 상태/활성 배지/비활성 토글 + 사유) ⑥ **위젯 전체 디자인**(런처·헤더·말풍선·아웃풋 7종·입력영역·오류/대기 상태) — `UIUX_준수기준.md` (a) 항목 전수 충족 ⑦ 빈 상태 3종(자산 0건/채널 0건/대화 시작 전) |
| `backend-implementer` | §4 FR + §7 AC 기준 NestJS 모듈 구현: `simulation`(시뮬레이션·비교), `channels`(채널 CRUD), `conversation`(공개 API·번들 서비스·어댑터·로그 적재·마스킹). 4계층 규약 준수, 순수 로직은 `lib/*` 분리(NFR-M1). **엔진 보강(FR-E2)은 `packages/dialogue-engine`에서 수행** |
| `frontend-implementer` | `apps/web` 신규 화면 2종 + 탭/라우트 추가(`App.tsx`, `TabNav.tsx`). 기존 `UnsavedGuardContext`·`ConfirmDialog`·`Toast`·`MESSAGES`·`SeverityBadge`·`EmptyState` 재사용. **`apps/widget` 신규 앱 구현**(FR-W-*) — 렌더러는 DD-24 결정에 따라 콘솔과 공유 |
| `test-automation` | §7 AC 전체를 테스트로 전환. 우선순위 — ① **AC-P-15(엔진 단일 경로 동일성)** ② AC-10-14/AC-10B-1(읽기 전용 보장) ③ AC-P-8(PII 마스킹) ④ AC-E2-4(되묻기 종결) ⑤ AC-W 접근성. seed에 NFR-M5 데이터 추가. 위젯은 DOM 무의존 단위 테스트(FR-W-16)를 1차 타깃으로 하고 브라우저 통합은 최소화 |
| `code-reviewer` | 중점 확인 — ① 공개 API 응답에 내부 필드 누출 여부(NFR-S1) ② 매칭 로직이 엔진 밖에 복제되지 않았는지(FR-0-19) ③ 채널 타입 분기가 팩토리 1곳에만 있는지(NFR-M2) ④ 마스킹 이전 원문이 로그에 남지 않는지(NFR-S4) ⑤ 위젯의 `innerHTML` 사용 0건(FR-W-11) |
