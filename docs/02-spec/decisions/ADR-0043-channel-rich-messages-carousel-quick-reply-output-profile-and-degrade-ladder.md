# ADR-0043 — 채널별 리치 메시지 = `CAROUSEL` 새 타입 1 + `BUTTON.display` 선택 키 · 채널 출력 능력 프로필(속성 표 1곳) · 3단 강등 순수 함수 1벌 · 구버전 위젯 `rich-v1` · 새 컴포넌트 https 전용

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-27
- **결정자**: system-architect (범위·방식 12건은 PM 확정 — 요구사항 §11 P-1~P-12 전부 추천안, 2026-09-27)
- **관련**: `docs/requirements/channel-rich-messages.md` T-1~T-6, J-1~J-16, FR-0-194~202, FR-RM1-\*~FR-RM8-\*, NFR-RMP/RMS/RMR/RMA/RMM, AC-RM1~RM7, EX-RM-1~20, C-1~C-13, P-1~P-12 / **ADR-0011(채널 구현 등급 · 어댑터 계약 · `degradeOutputs` · 속성 표 보론)** · **ADR-0012(위젯 스택 — Preact 재검토 트리거)** · **ADR-0042(시뮬레이션 채널 · `degradePreview` — R-18)** · ADR-0034(재조립 경로 결함 선례) · ADR-0031(스냅샷 해시) · ADR-0039(엔진 표면 골든) · ADR-0038(위젯 기능 선언 · `.default()` 금지) · ADR-0005(노드 참조) · ADR-0040(외부 출구 게이트) · ADR-0002(영구삭제)
- **번호 주의**: 요구사항 문서가 제안한 "ADR-0046"은 기능 번호(No.46)와 혼동된 가번호다. `docs/02-spec/decisions/`의 현재 최대 번호가 0042이므로 이 결정은 **ADR-0043**이다.
- **Supersedes(부분)**: 없음. ADR-0011 §3(어댑터 계약)·58행(`degradeOutputs` 경로 상시 실행)은 **확장**하며 결정 문장은 바꾸지 않는다(파일 끝 갱신 절).
- **영향 범위**: `packages/shared-types/src/{dialogue, common, channel, conversation, inbox, dialogue-engine, output-view, rich-url(신규·zod 무의존), rich-degrade(신규·zod 무의존), rich-message(신규), index}.ts` · **`packages/dialogue-engine/src/{outputs, design-validator}.ts`(분기 추가만 — 새 파일·새 export 0)** · `apps/api/prisma/schema.prisma`(+ 마이그레이션 1 — `CREATE TABLE` 1) · `apps/api/src/{rich-messages(신규), conversation(어댑터·공개 서비스·강등 래퍼), banned-words/lib, dialog-nodes, asset-transfer/lib, inbox/manage, chatbots, audit-logs/lib, app.module}` · `apps/widget`(캐러셀·바로연결 렌더 · `rich-v1`) · `apps/web`(편집기·채널별 미리보기·시뮬레이터·인박스 미리보기·허용 도메인 설정). **`apps/ml-worker` 변경 0**
- **세부 설계**: `docs/02-spec/channel-rich-messages-설계.md`

## 맥락

카탈로그 No.46은 "카카오톡 바로연결버튼·캐러셀 등 채널 고유 UI 컴포넌트를 대화그래프 아웃풋에서 선택 가능"이다. 그러나 1차에 **실제로 대화가 오가는 채널은 WEB 하나**이고(ADR-0011 · ADR-0042 §1) 카카오 규격은 확인되지 않았다. 코드 확인 결과 결정할 것은 여덟 가지다.

1. **무엇을 새로 만드나** — 예시 두 개(캐러셀·바로연결)는 사실 채널 중립 개념이다. 새 타입을 몇 개 만들고, 기존 타입을 어떻게 확장하나.
2. **엔진이 새 타입을 조용히 버린다** — `executeOutputs`의 `switch (o.type)`에 `default`가 없어 `case`가 없는 타입은 출력되지 않고 "빈 출력 → 기본 폴백 문구"로 바뀐다(`outputs.ts` 150~278행).
3. **`{api.*}` 치환의 BUTTON 재조립이 선택 키를 버린다** — `{ text, buttons }`로 새로 조립한다(`outputs.ts` 56~65행). ADR-0034 결함 유형의 재발 지점이다.
4. **출력 후처리 3종이 모르는 타입을 `default`로 흘린다** — 금지어 마스킹(보안 누락) · 로그 텍스트화(빈 `botResponse`) · 강등 텍스트(`[지원하지 않는 응답]`).
5. **채널 능력이 두 곳에 있다** — `CHANNEL_CAPABILITIES`(shared-types)와 `WebChannelAdapter.supportedOutputTypes`(api). 콘솔 미리보기는 api 어댑터를 import할 수 없다.
6. **구버전 위젯은 새 타입을 걸러 버린다**(`toOutputViews` · 렌더러 `default: return null`) — 빈 말풍선.
7. **주소 규칙** — `SafeUrlSchema`는 `http`와 `@` 사용자정보 형식을 허용한다. 기존 데이터 호환을 깨지 않으면서 새 컴포넌트만 강화해야 한다. 이미지는 **최종 사용자 브라우저가** 가져가므로 No.45 서버 출구 게이트와의 관계를 정리해야 한다.
8. **쓰지 않는 설치의 바이트 동일** — 스냅샷 해시(ADR-0031)·엔진 표면 골든(ADR-0039)·공개 응답을 지킨다.

## 결정

### 1. 컴포넌트 = `CAROUSEL` 새 타입 1개 + `BUTTON.display?: 'QUICK_REPLY'` 선택 키 1개 — 닫힌 목록 (P-2 · P-5)

- **`CAROUSEL`**(판별 유니온 14번째): `{ version: 1, text?: ≤300, cards: 카드[2~10] }`. 카드 = 기존 `CARD` 필드 재사용(`title` 1~100 · `description?` ≤500 · `imageUrl?` · 이미지가 있으면 `altText` 필수 ≤200) + **카드당 버튼 0~3**(P-7). 버튼 = 기존 `ButtonItemSchema`(MESSAGE·LINK·NODE) — 새 버튼 동작 0.
- **바로연결** = 기존 `BUTTON` 페이로드의 선택 키 `display: 'QUICK_REPLY'`. 키 없음 = 지금의 일반 버튼(바이트 동일). 바로연결이면 **MESSAGE·NODE만**(LINK 거부) · 노드당 1개 · 표시 아웃풋 맨 끝(뒤에는 `DIALOG_MOVE`·`WORKFLOW`만) — 배치 규칙은 노드 저장 서비스 검증(`400 OUTPUT_PAYLOAD_INVALID`).
- 두 스키마 어디에도 **`.default()`를 쓰지 않는다** — 기존 노드를 다시 파싱해도 키가 생기지 않으므로 **기존 스냅샷 `contentHash`가 바이트 동일**하다(No.44 `feedbackEnabled` 선례 · 골든 해시 시험). 새 컴포넌트를 쓴 노드만 해시가 바뀐다. `SNAPSHOT_SCHEMA_VERSION` 1 유지 · 업캐스터 불필요.
- 제3자가 만드는 렌더 컴포넌트는 No.47(마켓플레이스)이다 — 이 목록은 **닫혀 있다**.

### 2. 엔진 = 기존 2파일의 분기 추가만 — 새 파일·새 export 0 → 엔진 표면 골든(E-5) 불변

닫힌 목록(설계서 §5): ① `executeOutputs`에 `case 'CAROUSEL'`(표시용 비종결 — `IMAGE`·`LINK`와 같은 분류, `apiVariables`가 있으면 치환) ② `switch`의 **`default`에 `never` 대입**(컴파일 시 망라 검출 — 런타임 도달 0) ③ BUTTON 재조립을 **`{ ...output.payload, text, buttons }`**로 바꿔 `display` 보존(치환 없는 턴은 기존대로 원본 객체 통과) ④ 내부 함수 `applyApiVariablesToCarousel`(export 안 함) — 안내 문구·카드 제목·설명·버튼 라벨만 치환 · URL·버튼 값 비치환(AC-L3-9) · 제목이 빈 카드는 제거 · 0장이면 아웃풋 제거 · **1장이면 `CARD` 1개(+ 안내 문구 `TEXT`)로 바꾼다**(엔진 출력은 언제나 `DialogOutputSchema`를 통과한다는 불변식) — 모두 `API_VALUE_DROPPED` trace ⑤ `getOutgoingNodeRefs()`에 캐러셀 카드 버튼 NODE ⑥ 설계 점검 ⑦(URL 필드 `{api.*}`)에 캐러셀 이미지·LINK 버튼.

엔진은 **채널을 모른다** — 채널·강등·프로필·`QUICK_REPLY` 심볼 0(`display`는 스프레드로만 보존). 기존 엔진 시험 무수정 · 봉투 스키마·`CONVERSATION_STATE_VERSION` 불변.

### 3. 출력 후처리 3종 = 전 타입 명시 + `never` 망라 — `default` 통과 금지 (C-3 · C-4 · C-5)

- 금지어 `maskOutputText`: `CAROUSEL`의 안내 문구·카드 제목·설명·대체 텍스트·버튼 라벨 전부 마스킹. 비표시 타입 6종(`CONTEXT_FORM`·`DIALOG_MOVE`·`SCENARIO`·`SURVEY`·`API_CONDITION`·`WORKFLOW`)과 `PAUSE`는 **명시 `case`로** 통과. `default`는 `never` 대입만(정적 검사 RM-3).
- 로그 텍스트화 `outputsToPlainText`: `[캐러셀] (안내 문구 — )제목1 · 제목2 …(5장 초과 시 외 N장)` · 바로연결 `[바로연결] 문구`(문구 없으면 라벨 나열). 일반 `BUTTON`·기존 6종 문구는 **불변**.
- 강등 = 결정 5의 순수 함수(기존 `degradeOutputs(outputs, supported)` 시그니처는 래퍼로 유지 — 기존 시험 무수정).

### 4. 채널 능력의 원천 = `CHANNEL_CAPABILITIES[type].outputs` 1곳 (J-6 · C-8)

- No.42가 만든 속성 표에 **아웃풋 능력 프로필** `outputs: ChannelOutputProfile`을 추가한다(기존 `handoff` 불변): `source`(`MEASURED`·`ASSUMED`·`DEFAULT`) · `types` · `carouselMaxCards` · `carouselCardMaxButtons` · **`cardMaxButtons`(기존 `CARD`용 — 캐러셀 카드와 분리)** · `quickReply{ supported, max }` · `buttonActions` · `image` · `textLimits{ title, description, buttonLabel }`.
- **WEB = `MEASURED`**, 모든 상한 ≥ 스키마 최대치(카드 버튼 5 · 캐러셀 카드 버튼 3 · 캐러셀 10 · 바로연결 5 · 제목 100/설명 500/라벨 40) — **기존 아웃풋이 WEB에서 절대 바뀌지 않는 조건**이다. **KAKAOTALK = `ASSUMED`**(규격 미확인 보수값 — 캐러셀 10 · 카드 버튼 3 · 바로연결 10 · 제목 50/설명 230/라벨 14) · **나머지 6채널 = `DEFAULT`**(텍스트만).
- 가상 프로필 **`LEGACY_WEB_WIDGET_OUTPUT_PROFILE`**(WEB 파생 · `CAROUSEL` 제외 · 바로연결 미지원) — 채널이 아니므로 `ChannelType`·표 밖의 상수다.
- `WebChannelAdapter.supportedOutputTypes`는 표에서 **파생**한다(자기 목록 리터럴 0 — 정적 검사 RM-5). 능력표는 **코드 상수**다(관리자 설정 아님 — 채널 규격은 플랫폼이 정한다). 표 변경은 코드 리뷰 + 이 ADR 갱신.

### 5. 강등 = 3단 사다리 순수 함수 1벌 `degradeForProfile(outputs, profile)` — shared-types `rich-degrade.ts`(zod 무의존) (P-3 · J-7)

- ① 원형(프로필이 지원) → ② 대체 컴포넌트(`CAROUSEL → 안내 TEXT + CARD N개` · `QUICK_REPLY → 일반 BUTTON(display 제거)`) → ③ 텍스트(`CAROUSEL → "1) 제목 — 설명 50자 / 라벨: https://…"` · `BUTTON → "다음 중 입력해 주세요: A / B"`). 초과 카드·버튼은 잘라내고, 이미지 미지원은 `[이미지: 대체 텍스트]`를 설명 앞에, 글자 수 초과는 코드 포인트 절단 + `…`. 기존 5종의 텍스트 강등 문구(`[카드] 제목` 등)는 **불변**.
- 결과 = `{ outputs, changes[] }`(바뀐 점 11종 — 공개 응답에는 싣지 않는다). **불변식**: 결과 아웃풋은 항상 `DialogOutputSchema` 통과 · 바뀌지 않은 아웃풋은 **입력 객체 참조 그대로**(WEB·구버전 위젯의 기존 노드 = 바이트 동일) · 예외 0(모르는 입력 = `[지원하지 않는 응답]`) · 멱등.
- 소비자: **api**(어댑터 `renderOutbound` · 인박스 시뮬레이션 `degradePreview`) · **콘솔**(노드 편집기 채널별 미리보기 · 저장 시 경고). **위젯은 import하지 않는다** — 강등은 서버가 한다(번들 절약).
- 설계 점검(엔진)에 채널 규칙을 넣지 않는다 — 저장 시 채널 경고는 콘솔이 같은 순수 함수로 계산해 **비차단**으로 표시한다(새 API 0).

### 6. 구버전 위젯 = 기능 선언 `rich-v1` 없으면 서버가 강등 — 어댑터 계약에 선택 인자 1개 (P-8)

- 위젯이 요청 `features`에 **`'rich-v1'`**을 더한다(`handoff-v1`·`feedback-v1`에 이어 3개 · 상한 5). 선언이 없으면 WEB 어댑터가 `LEGACY_WEB_WIDGET_OUTPUT_PROFILE`로 강등한다 → 캐러셀은 **CARD 여러 개**(빈 말풍선 0), 바로연결은 일반 버튼.
- 계약: `renderOutbound(outputs, ctx?: ChannelRenderContext)` — `ctx = { features?: readonly string[] }`. 인자가 없으면 구버전으로 취급(안전측). 공개 서비스는 `dto.features`를 넘기기만 한다(분기 0). 강등은 **출구 금지어 필터 앞**이라 강등으로 만든 텍스트도 마스킹된다.
- 로그 `botResponse`는 **실제로 나간 아웃풋의 요약**이다(신버전 = `[캐러셀] …` · 구버전 = `[카드] …` 줄들). 인박스 시뮬레이션 기록은 원형 기준 요약 그대로(ADR-0042 기록 규약).

### 7. 주소 = 새 컴포넌트만 https 전용 + 위험 형식 차단 + 선택 허용 도메인 목록 — 기존 `SafeUrlSchema` 불변 (P-4)

- 순수 판정 `inspectRichUrl()`(`rich-url.ts` · zod 무의존 — 서버 스키마·콘솔·위젯이 공유): `https://`로 시작 · 2,048자 이하 · 제어 문자·공백·역슬래시 0 · **사용자정보(`@`) 0**(원문 권한부 검사 + 파서 `username/password` 이중 검사) · 호스트 필수 → 거부. 퓨니코드(`xn--`)·IP 호스트·알려진 단축 URL은 **경고**(저장 허용).
- 새 스키마 `RichHttpsUrlSchema`는 캐러셀 카드 이미지·캐러셀 카드 LINK 버튼에만 적용한다. 기존 `CARD`·`IMAGE`·`LINK`·`BUTTON`의 `http` 허용은 **불변**(기존 저장 데이터가 갑자기 무효가 되지 않게 — 확대는 2차).
- **챗봇별 허용 도메인 목록**(선택 · 행 없음/빈 목록 = 모든 https 허용 · ≤50 · `{ host, includeSubdomains }`) = 신규 1:1 테이블 **`ChatbotRichUrlPolicy`**(마이그레이션 1 — `CREATE TABLE`만 · 원시 부분 유니크 4종 보존). 환경 밖 · 스냅샷·복사·토픽 분리 밖 · 영구삭제 동반 삭제(23 → 24) · 쓰기 1파일 · 변경 감사(`UPDATE Chatbot` — 전후 목록). 검사는 **노드 편집 API 저장 시점만**(공개 대화 경로 DB 조회 0) — 복원·자산 이전·복사·분리로 들어온 노드는 설계 점검 `RICH_URL_NOT_ALLOWED`(WARNING)와 설정 화면의 "목록 밖 주소를 쓰는 노드 N개"로 알린다.
- 위젯은 서버 검증과 별개로 **https만 렌더**(방어 심층) · 링크 `noopener noreferrer` · 이미지 `referrerPolicy="no-referrer"`·`loading="lazy"`·`decoding="async"` · `textContent`만 · 사용자 값 CSS `url()` 0.

### 8. No.45 출구 게이트와의 관계 = 이미지·링크는 서버 출구가 아니다 — `EgressExitId` 6 불변

- 외부 출구 게이트(ADR-0040 §2)는 **우리 서버가 밖으로 보내는 요청**의 통제다. 캐러셀 이미지·링크는 **최종 사용자 브라우저가 직접** 접속하며 서버는 그 주소에 **한 번도 접속하지 않는다**(존재 확인·썸네일·프록시 0 — 정적 검사 RM-8). 따라서 출구 클래스·데이터 지도·`DATA_EGRESS_ALLOWED_HOSTS`는 불변이고, 허용 도메인 목록은 출구 허용 목록과 **다른 주체(브라우저)·다른 목적(콘텐츠 정책)**이라 재사용하지 않는다.
- 거버넌스 모드가 켜져 있고 허용 목록이 비어 있으면 설정 화면에 경고 배지를 둔다. "사용자 브라우저가 외부 이미지 호스트에 접속한다(IP·브라우저 정보 노출 — Referer는 막음)"는 연동 가이드·개인정보 처리방침 고지 사항이다.

### 9. 위젯 = vanilla 유지 · 증가 ≤6KB — ADR-0012 Preact 재검토 트리거 **미발동** (P-9)

- 캐러셀 = CSS 스크롤 스냅 + 이전/다음 `<button>` 2개 · 모든 카드 DOM 유지(숨김 슬라이드·`aria-hidden` 카드 0) · **자동 넘김 0** · 위치 "K / N" + 상태 영역(`#cb-status`) 1회 안내 · 끝 버튼 = `aria-disabled`(포커스 유지). 바로연결 = 봇 메시지 아래 칩 묶음 · 다음 입력 시 `hidden`(새 DOM 노드 0 · 포커스가 칩에 있었으면 입력창으로) · 한 턴에 여럿이면 마지막 1개만 칩 · 새로고침 시 칩 없음(메시지 이력 비복원 — ADR-0009 트리거 ③).
- 순수 판단(마지막 바로연결 선택·위치 계산·가장 가까운 카드)은 `core/`, DOM은 `ui/`. 남은 Preact 트리거 = 파일 첨부(No.33).

### 10. 권한 · 공개 표면 · 통계

- **신규 권한·역할 0**: 노드 편집 = 기존 `dialogue:write` · 허용 목록 조회 `chatbot:read`/변경 `chatbot:write`. **`@Public()` 8 불변** · 신규 `ApiErrorCode` 0(`VALIDATION_FAILED`·`OUTPUT_PAYLOAD_INVALID` 재사용) · 신규 환경변수 0 · 새 루프 0.
- 클릭 기록은 **기존 수준**(P-6): 카드 버튼·칩의 MESSAGE·NODE는 기존 버튼 턴(`inputKind`)으로 기록 · 어느 카드/버튼인지·링크 클릭은 기록하지 않는다. 통계 정의 불변.

## 근거

- **"채널 고유"의 실체는 컴포넌트가 아니라 한계와 대체 방식이다**: 캐러셀·빠른 선택 칩은 웹·카카오·라인·메신저 모두에 있는 일반 개념이다. 1차에 실제로 그릴 수 있는 곳이 WEB뿐이므로 컴포넌트는 채널 중립으로 만들어 **WEB에서 실제로 전달**하고, 채널 차이는 **능력표 한 행**으로 담는다 — 카카오 계정이 생기면 행 하나를 `ASSUMED → MEASURED`로 바꾸고 어댑터만 더한다.
- **혼합 방식(새 타입 1 + 선택 키 1)**: 바로연결을 새 타입으로 만들면 구버전 위젯에서 사라져 서버 강등이 하나 더 필요하다. 기존 `BUTTON`의 표시 방식으로 두면 구버전 위젯은 키를 모른 채 **일반 버튼으로 자연스럽게** 그린다. 캐러셀은 "카드 1장"의 의미를 흐리지 않도록 새 타입이다.
- **능력표 1곳 · 강등 1벌**: 콘솔 미리보기와 서버 강등이 서로 다른 목록·규칙을 보면 "미리보기와 실제가 다르다"가 생긴다(No.10 시뮬레이터가 존재하는 이유와 같다). shared-types 속성 표 + zod 무의존 순수 함수가 api·콘솔이 함께 쓸 수 있는 유일한 위치다.
- **WEB 상한 ≥ 스키마 최대치**: 능력표를 도입하는 순간 기존 `CARD`(버튼 5)가 캐러셀 카드 상한(3)에 걸려 잘리는 회귀가 가능하다. 두 상한을 분리하고 WEB을 스키마 최대치로 두면 기존 아웃풋이 WEB에서 바뀔 경로 자체가 없다.
- **엔진 1장 → CARD 변환**: 캐러셀 스키마는 2~10장이다. 치환으로 1장만 남은 캐러셀을 그대로 내보내면 공개 응답이 계약(`PublicMessageResponseSchema`)을 어긴다. 엔진이 내보내는 모든 아웃풋이 스키마를 통과한다는 불변식을 지키는 가장 작은 변환이다.
- **재조립은 스프레드로**: 페이로드를 필드 나열로 다시 만드는 코드는 선택 키가 늘 때마다 조용히 키를 잃는다(ADR-0034 결함 유형). `{ ...payload, 바꾼 필드 }`로 쓰면 미래의 선택 키도 보존된다 — 정적 검사(RM-2)와 API 치환 턴 통합 시험으로 고정한다.
- **허용 목록 = 저장 시점만**: 공개 대화 경로에서 매 턴 목록을 읽으면 조회가 늘고 캐시 무효화 문제가 생긴다. 주소는 관리자가 쓰는 정적 콘텐츠이므로 쓰는 순간 검사하고, 쓰기 API를 거치지 않는 경로는 점검 경고로 드러낸다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| 카카오 실연동(오픈빌더 스킬 서버) 1차 포함(P-1 (c)) | 계정·심사·공개 HTTPS·자격증명 ADR·No.42 2차(채널 매개변수화) 선행 조건이 하나도 없다 |
| 카카오 전용 버튼 동작(상담원 연결·채널 추가·공유) 모델링(P-1 (b)) | 원형을 볼 곳이 없는 데이터 · 규격 미확인으로 재작업 가능성 · 구버전 위젯의 "모르는 action = MESSAGE" 오인 위험(`output-view.ts` 23~31행) |
| 새 타입 2개(`CAROUSEL`·`QUICK_REPLY`) | 바로연결까지 구버전 위젯에서 사라진다 — 서버 강등 대상이 둘 |
| 단일 묶음 타입 `RICH { kind }` | 판별 유니온 안의 판별 유니온 — 금지어·로그·편집기·강등이 한 단계씩 깊어진다 |
| `CARD`에 `cards[]` 추가 | 구버전은 첫 장만 보이고 나머지 소실 · `title` 필수와 충돌 |
| 능력 목록을 어댑터에 유지(콘솔은 별도 복제) | 목록 이중화(C-8) — 미리보기와 실제가 갈라진다 |
| 단일 `maxButtons` 상한 | WEB 캐러셀 카드 3에 맞추면 기존 `CARD`(5)가 잘리는 회귀 |
| 치환 후 1장 캐러셀 그대로 허용 | 공개 응답 스키마 위반(카드 2~10) — 계약 시험 실패 |
| 강등 미리보기 API(`POST …/output-preview`) | 순수 함수라 콘솔이 직접 계산 가능 — 경로·권한·시험만 는다 |
| 설계 점검(엔진)에 채널 강등 경고 | 엔진이 채널을 알게 된다 · 번들에 채널 정보 없음 — 콘솔 비차단 경고로 충분 |
| 구버전 위젯에 `display` 키를 남김 | 관측 차이는 없지만 "지원하지 않는 기능 키"를 내보내 강등 사다리 규칙이 예외를 갖는다 — 제거가 일관적 |
| `SafeUrlSchema` 자체를 https 전용·`@` 차단으로 강화 | 기존 `http` 이미지·링크 노드가 수정 시 저장 불가·복원 검증 실패 — 2차(현황 조사 + 이관 도구와 함께) |
| 허용 목록 필수(P-4 (b)) | 첫 사용 전 목록 등록 강제 — 도입 마찰 |
| 허용 목록을 WEB 채널 설정 JSON에 저장(마이그레이션 회피) | 채널 설정은 채널별이고 목록은 챗봇 콘텐츠 정책이다 · WEB 행이 없으면 저장 불가 · 채널 설정 전체 교체 규약과 충돌 |
| 허용 목록을 `DATA_EGRESS_ALLOWED_HOSTS`와 공유 | 주체(서버 vs 브라우저)·목적(데이터 반출 vs 콘텐츠 정책)·범위(전역 vs 챗봇)가 다르다 |
| 공개 턴마다 허용 목록 재검사 | 턴당 DB 조회 +1 · 캐시 무효화 — 저장 시점 검사 + 점검 경고로 충분 |
| 이미지 업로드·자체 호스팅(P-4 (c)) | 저장소·공개 파일 경로(`@Public()` +1)·악성 파일 검사·보존 정책 — 2차 |
| 서버가 이미지 주소를 미리 조회해 검증 | 새 서버 출구(SSRF 표면) — 브라우저가 가져가는 자원을 서버가 가져올 이유가 없다 |
| Preact 도입 | 캐러셀·칩은 순수 DOM + CSS 스크롤 스냅으로 충분(예상 +3KB) — 트리거 미발동 |
| 끝 버튼 `disabled` | 포커스가 사라진다(키보드 사용자가 "다음"을 누르다 끝에서 포커스 상실) — `aria-disabled` |
| 바로연결을 새로고침 뒤 복원 | 위젯은 메시지 이력 자체를 복원하지 않는다(ADR-0009 트리거 ③) |
| 카드·버튼 단위 클릭 기록(P-6 확장) | 로그 컬럼·공개 경로 추가 · 통계 정의 변경 — 2차(No.29 확장) |

## 감수하는 비용

1. **카카오톡 모습은 가정치다** — 콘솔·시뮬레이션은 항상 "예상 모습" 라벨을 단다. 실제 규격과 다를 수 있으며 실연동 시 행을 실측으로 바꾼다.
2. **구버전 위젯에서 캐러셀 10장은 세로 카드 10개로 길어진다** — 정보 손실 0을 우선한다.
3. **로그 요약이 위젯 버전에 따라 다르다** — 같은 노드라도 `[캐러셀] …`/`[카드] …` 줄들. "사용자가 실제로 본 것"의 기록이다.
4. **허용 목록은 편집 API 저장 시점만 강제한다** — 복원·이전으로 들어온 목록 밖 주소는 경고로만 드러난다.
5. **퓨니코드·IP·단축 URL은 경고일 뿐 차단하지 않는다** — 동형 문자 피싱은 운영자 확인에 의존한다(허용 목록이 최종 통제).
6. **사용자 브라우저가 외부 이미지 호스트에 접속한다** — Referer는 막지만 IP·브라우저 정보는 호스트에 노출된다(고지 사항 · 폐쇄망은 사내 이미지 서버).
7. **1장으로 줄어든 캐러셀은 카드로 바뀐다** — 위치 표시·넘김 버튼이 없어진다(요구사항 원안의 "1장 캐러셀"과 다름).
8. **마이그레이션 1개**(허용 목록 저장) — 요구사항의 "마이그레이션 없음" 예상과 다르다(`CREATE TABLE`만 · 재정의 0).

## 결과

- shared-types: `DialogOutputType` 13 → **14**(`CAROUSEL`) · `ButtonOutputPayloadSchema.display?` · `CarouselOutputPayloadV1Schema`·`CAROUSEL_LIMITS`·`findQuickReplyPlacementIssues()` · `RichHttpsUrlSchema` · 신규 `rich-url.ts`·`rich-degrade.ts`(zod 무의존) · `rich-message.ts`(허용 목록 계약) · `CHANNEL_CAPABILITIES[*].outputs` + `LEGACY_WEB_WIDGET_OUTPUT_PROFILE` · `WIDGET_FEATURE_RICH_V1` · `SimulateInboxResponse.degradePreview` = `'NOT_DEFINED' ∪ DegradePreview` · `DesignIssueCode` +2(`RICH_URL_NOT_ALLOWED`·`RICH_URL_SUSPICIOUS` — API 계층 산출).
- 엔진: `outputs.ts`·`design-validator.ts` 분기 추가만 — 파일 목록·export 골든 불변.
- api: 신규 모듈 `rich-messages`(컨트롤러 1 · 핸들러 2 · export 0) · 신규 테이블 1(`ChatbotRichUrlPolicy`) · 마이그레이션 1(`CREATE TABLE`만) · 동반 삭제 23 → 24 · 컨트롤러 45 → 46 · `@Public()` 8 · 권한 18 · `EgressExitId` 6 · `ApiErrorCode` 추가 0 · 환경변수 0.
- 위젯: `rich-v1` · 캐러셀·바로연결 렌더러 · gzip 증가 ≤6KB. 콘솔: 캐러셀 편집 · 표시 방식 · 채널별 미리보기 · 저장 경고 · 인박스 미리보기 · 허용 도메인 설정.
- 정적 검사 `apps/api/src/rich-messages/lib/rich-message-sealing.spec.ts` RM-1~RM-18 · 의도된 기존 시험 기대값 변경 X-1~X-4(설계서 §18.3 닫힌 목록).
- GPU **1 유지**(P-12) · 구축형 ○ · 구독형 ○.

## 재검토 트리거

- **첫 외부 채널(카카오톡) 계정 확보 · No.42 2차 착수** → 능력표 KAKAOTALK `ASSUMED → MEASURED`(실제 계정 1개로 규격 확인) + 어댑터 렌더(오픈빌더 응답 변환) — 강등 사다리는 그대로 쓴다.
- **카카오 전용 버튼 동작(상담원 연결·채널 추가·공유) 요구** → 버튼 동작 확장 ADR(구버전 위젯 오인 방지 기능 선언 포함 · No.24 상담 연결과 함께).
- **목록형 카드·상품 카드 요구** → 설계서 §15(새 타입 수정 지점 닫힌 목록)를 체크리스트로 타입 추가.
- **자동 강등이 부족하다는 실측 근거** → 채널별 수동 대체 응답(스냅샷·자산 이전·토픽 분할 전 경로의 새 필드).
- **기존 타입 `http` 사용 현황 조사 완료** → `SafeUrlSchema` https 전용 확대 + 이관 도구.
- **폐쇄망 고객의 이미지 업로드 요구 · No.33 착수** → 파일 저장소·공개 파일 경로 ADR.
- **컴포넌트별 노출·클릭률 통계 요구** → No.29 확장(로그 컬럼 · 링크 클릭 공개 경로 판단).
- **위젯 기능 선언이 5개 상한에 닿음** → 기능 선언을 버전 문자열 1개로 합치는 방식 재검토(ADR-0038 규약).
- **위젯 파일 첨부(No.33)** → ADR-0012 Preact 재검토(남은 유일한 트리거).
