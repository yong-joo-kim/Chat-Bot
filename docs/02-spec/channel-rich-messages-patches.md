# No.46 채널별 리치 메시지 컴포넌트 — 기존 문서 패치 목록

> 작성: system-architect · 2026-09-27 · 근거: `docs/02-spec/channel-rich-messages-설계.md`, `docs/02-spec/decisions/ADR-0043-channel-rich-messages-carousel-quick-reply-output-profile-and-degrade-ladder.md`
> **적용 상태**: ✅ **적용 완료(2026-09-27, 81건)** — 오케스트레이터 세션이 항목마다 "찾을 원문 정확히 1회"를 확인한 뒤 기계적으로 적용한다.
> **적용 방법**: 각 항목의 "찾을 원문"을 대상 파일에서 **정확히 1회** 찾아 "바꿀 내용"으로 교체한다. 모든 원문은 2026-09-27 시점 파일(No.42 옴니채널 통합 인박스 패치 적용 후 · 커밋 `9113b1d`)에서 복사했고, 문자열 검색(Grep count)으로 대상 파일 안 유일성을 확인했다. "바꿀 내용"이 원문을 그대로 포함하는 항목은 append다(취소선 표기 항목은 원문을 `~~…~~`로 감싸 보존한다).
> **줄바꿈 주의**: 대상 파일은 CRLF일 수 있다. 모든 "찾을 원문"은 **한 줄 안의 부분 문자열**(줄바꿈 미포함)로 잡았다. "바꿀 내용"의 줄바꿈은 대상 파일의 줄바꿈으로 정규화한다.
> **순서 독립**: 어떤 "바꿀 내용"도 다른 항목의 "찾을 원문"을 새로 만들지 않는다. 같은 줄에 앵커가 둘인 항목은 없다.
> 코드 변경은 이 파일의 범위가 아니다 — 설계서 §2.5·§15 체크리스트와 §18.3(의도된 시험 기대값 변경 닫힌 목록)을 따른다. `CLAUDE.md`는 이 패치의 대상이 아니다(작업 트리의 미커밋 수정 보존).
> 항목 수: 개발명세서 31 · ADR 8 · 기능요구사항 4 · 리치 메시지 요구사항(PM 결정 기록 + 설계 반영) 23 · 선행 요구사항 인계 정정 7 · No.42 설계서 3 · UIUX 준수기준 4 · 운영 문서 1 = **81건**

---

## A. `docs/02-spec/개발명세서.md`

### A-1. [개발명세서 `docs/02-spec/개발명세서.md`] §2 워크스페이스 상태 표 — `rich-messages` 행 추가

**찾을 원문**
````text
봉투 스키마 불변 · widget 변경(식별 토큰 입력 — vanilla 유지)**(ADR-0042) |
````
**바꿀 내용**
````text
봉투 스키마 불변 · widget 변경(식별 토큰 입력 — vanilla 유지)**(ADR-0042) |
| **`apps/api/src/rich-messages`**(+ `packages/shared-types` `rich-url`·`rich-degrade`·`rich-message`) | **채널별 리치 메시지 Phase에 신설**(No.46) — 캐러셀(새 아웃풋 타입 `CAROUSEL` — 카드 2~10장·카드당 버튼 ≤3)·바로연결(기존 `BUTTON`의 선택 키 `display: 'QUICK_REPLY'`) · 채널 출력 능력 프로필(`CHANNEL_CAPABILITIES[*].outputs` — WEB 실측·카카오톡 가정치·나머지 텍스트만) · 3단 강등 순수 함수 1벌(zod 무의존 — api·콘솔 공유) · 구버전 위젯(`rich-v1` 미선언) 서버 강등 · 새 컴포넌트 https 전용·`@` 차단 · 챗봇별 허용 도메인 목록(`ChatbotRichUrlPolicy` — 컨트롤러 1·핸들러 2·export 0). **`packages/dialogue-engine` 분기 추가만(`outputs.ts`·`design-validator.ts` — 새 파일·export 0) · ml-worker 변경 0 · `@Public()` 8 유지 · 신규 권한·역할·환경변수 0 · 봉투 스키마 불변 · widget 변경(캐러셀·바로연결 렌더 — vanilla 유지)**(ADR-0043) |
````

### A-2. [개발명세서 `docs/02-spec/개발명세서.md`] §2.2 기능그룹별 모듈 배치 표 — No.46 행 추가

**찾을 원문**
````text
`apps/widget`(식별 토큰 입력) | **설계 완료 → `omnichannel-inbox-설계.md`** |
````
**바꿀 내용**
````text
`apps/widget`(식별 토큰 입력) | **설계 완료 → `omnichannel-inbox-설계.md`** |
| **채널별 리치 메시지 (No.46)** | **`rich-messages`(신규 — 허용 도메인 목록 2 핸들러(컨트롤러 1) · ★쓰기 유일 `rich-url-policy.service.ts` · 순수 lib `collect-rich-urls`·`rich-url-issues` · export 0)** + `packages/shared-types`(`CAROUSEL`·`BUTTON.display`·`rich-url`·`rich-degrade`·능력표 `outputs`·`WIDGET_FEATURE_RICH_V1`·`degradePreview` 합집합·설계 점검 코드 +2) · `packages/dialogue-engine`(분기 추가만 — 실행 `case`·`never` 망라·BUTTON 재조립 스프레드·캐러셀 치환·참조·URL 점검) · `conversation`(어댑터 `renderOutbound(outputs, ctx?)`·능력표 파생·공개 서비스 1줄) · `banned-words`(전 타입 명시) · `dialog-nodes`(바로연결 배치 단언·허용 목록 검사·점검 병합·참조) · `asset-transfer`(트림) · `inbox`(`degradePreview`) · `chatbots`(동반 삭제 +1) · `audit-logs`(화이트리스트 +1) · `apps/widget`(캐러셀·바로연결) | **설계 완료 → `channel-rich-messages-설계.md`** |
````

### A-3. [개발명세서 `docs/02-spec/개발명세서.md`] §2.2 주석 블록 — 엔진 수정의 의도된 예외(No.46) · 모듈 의존 방향(No.46)

**찾을 원문**
````text
(거버넌스는 Prisma 읽기 + writer 쓰기만 — ADR-0042).
````
**바꿀 내용**
````text
(거버넌스는 Prisma 읽기 + writer 쓰기만 — ADR-0042).
>
> **엔진 수정의 의도된 예외(채널별 리치 메시지 No.46)**: 이 그룹은 `packages/dialogue-engine`의 **기존 2파일에 분기만 더한다**(FR-0-196) — `outputs.ts`(`CAROUSEL` 실행 `case` · `switch` `default`의 `never` 망라 · `{api.*}` 치환의 BUTTON 재조립을 `{ ...payload, text, buttons }` 스프레드로 바꿔 선택 키 `display` 보존 · 내부 함수 캐러셀 치환 — 1장만 남으면 `CARD`) · `design-validator.ts`(`getOutgoingNodeRefs`의 캐러셀 카드 버튼 · URL 필드 점검). **새 파일·새 export 0**이라 엔진 표면 골든(`environment-sealing.spec.ts` E-5)이 불변이다. 엔진은 채널을 모른다 — 채널·강등·프로필·`QUICK_REPLY` 심볼 0을 정적 검사가 단언하며, 채널별 모습은 API 계층 어댑터와 shared-types 순수 함수가 정한다. 봉투 스키마·`CONVERSATION_STATE_VERSION` 불변 · 기존 엔진 시험 무수정(ADR-0043 §2).
>
> **모듈 의존 방향(No.46)**: `rich-messages → chatbots(ChatbotScopeService) · audit-logs · prisma · config` 단방향이고 **export는 0개**다. 노드 저장 검증은 허용 목록을 Prisma로 직접 읽고(1쿼리) `rich-messages/lib`의 순수 함수 파일만 import한다 — 모듈 순환 없음. 공개 대화·인박스는 shared-types의 능력표·강등 순수 함수만 쓰며 새 모듈을 import하지 않는다. 공개 대화 경로는 허용 목록 테이블을 읽지 않는다(ADR-0043 §7).
````

### A-4. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 `DialogNode` 행 — `CAROUSEL`·`BUTTON.display`

**찾을 원문**
````text
(ADR-0041 §1·§2)** | 5, 26, 27, 41 |
````
**바꿀 내용**
````text
(ADR-0041 §1·§2)** **[No.46] 아웃풋 14종째 `CAROUSEL`(v1 `{ version: 1, text?: ≤300, cards[2~10]: { title, description?, imageUrl?(https 전용·`@` 차단), altText?(이미지 있으면 필수), buttons[≤3] } }` — 표시용 비종결) · `BUTTON` 선택 키 `display?: 'QUICK_REPLY'`(바로연결 — MESSAGE·NODE만 · 노드당 1개·표시 아웃풋 맨 끝). 두 스키마 모두 `.default()` 없음 — 기존 노드 스냅샷 해시 바이트 동일 · 스키마 버전 1(ADR-0043 §1)** | 5, 26, 27, 41, 46 |
````

### A-5. [개발명세서 `docs/02-spec/개발명세서.md`] §3 엔터티 표 — `ChatbotRichUrlPolicy` 행 추가

**찾을 원문**
````text
되돌린 시각. FK 없음 · 본문 0 | 42 |
````
**바꿀 내용**
````text
되돌린 시각. FK 없음 · 본문 0 | 42 |
| **`ChatbotRichUrlPolicy`** | **챗봇별 리치 메시지(캐러셀) 이미지·링크 허용 도메인 목록(1:1 · 행 없음/빈 목록 = 모든 https 허용, No.46 — ADR-0043 §7).** `hosts` JSON(≤50 · `{ host(소문자 ASCII), includeSubdomains }`) · 마지막 변경자(FK 없음). **환경 밖**(공개 대화 경로는 읽지 않는다 — 노드 편집 API 저장 시점만 검사) · 스냅샷·복사·토픽 분리 대상 아님 · 쓰기 1파일 · 변경 감사(`UPDATE Chatbot` 전후 목록) · 영구삭제 동반 삭제 | 46 |
````

### A-6. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 머리 — 19건 → 20건

**찾을 원문**
````text
미도입 결정 19건
````
**바꿀 내용**
````text
미도입 결정 20건
````

### A-7. [개발명세서 `docs/02-spec/개발명세서.md`] §3 미도입 결정 ⑳ 신설 — 리치 메시지 관련 미도입

**찾을 원문**
````text
외부 채널은 2차(**ADR-0042**).
````
**바꿀 내용**
````text
외부 채널은 2차(**ADR-0042**).
> ⑳ **이미지 업로드 저장소·공개 파일 경로 · 채널 능력표 DB 테이블(관리자 편집) · 카드/버튼 단위 클릭 로그 컬럼·링크 클릭 공개 경로 · 채널별 수동 대체 응답 필드 · 강등 미리보기 API · 이미지 주소 서버 사전 조회** — 이미지는 최종 사용자 브라우저가 외부(또는 사내) 주소에서 직접 받고, 채널 규격은 플랫폼이 정하는 코드 상수(`CHANNEL_CAPABILITIES`)이며, 클릭은 기존 버튼 턴(`inputKind`)으로 충분하다(P-6). 강등은 순수 함수라 콘솔이 직접 계산하고, 서버가 이미지 주소에 접속하면 새 출구(SSRF 표면)가 생긴다. 새 저장소는 허용 도메인 목록 1:1 테이블뿐이다(**ADR-0043**).
````

### A-8. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 참조 무결성 — 캐러셀 카드 버튼 참조

**찾을 원문**
````text
동등성 시험이 단언한다(K-2 — ADR-0005 갱신 각주).**
````
**바꿀 내용**
````text
동등성 시험이 단언한다(K-2 — ADR-0005 갱신 각주).** **[No.46] 캐러셀 카드 버튼 NODE는 새 참조 종류가 아니라 기존 "버튼 → 노드" 참조의 새 위치다 — ①(`node-target-refs.ts` — 필드 경로 `outputs.i.payload.cards.j.buttons.k.value`)·②(`getOutgoingNodeRefs` `buttonTargets`)만 갱신하면 ③④⑤가 ②를 호출해 자동 반영된다. 자산 이전 트림(`system-node-trim.ts`)과 URL 필드 점검(엔진 ⑦)도 함께 갱신하며, 동등성 시험에 캐러셀 픽스처를 더한다(ADR-0043 §2 · `channel-rich-messages-설계.md` §15).**
````

### A-9. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 참조 무결성 예외 — 허용 목록 관계

**찾을 원문**
````text
`ChatbotInboxSetting → Chatbot`)는 전부 `Restrict`(ADR-0042).
````
**바꿀 내용**
````text
`ChatbotInboxSetting → Chatbot`)는 전부 `Restrict`(ADR-0042). **[No.46] `ChatbotRichUrlPolicy → Chatbot`도 `Restrict`이고 `updatedById`는 FK를 걸지 않는다(사실 기록 — ADR-0043).**
````

### A-10. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 파생 데이터 동반 삭제 — 허용 목록

**찾을 원문**
````text
전역이라 챗봇 영구삭제와 무관하다(ADR-0002 갱신 각주, ADR-0042).**
````
**바꿀 내용**
````text
전역이라 챗봇 영구삭제와 무관하다(ADR-0002 갱신 각주, ADR-0042).** **[No.46] `ChatbotRichUrlPolicy`(허용 도메인 목록 — 설정 데이터)는 동반 삭제다(23 → 24테이블). 사전검사 16종은 불변이다(ADR-0002 갱신 각주, ADR-0043).**
````

### A-11. [개발명세서 `docs/02-spec/개발명세서.md`] §3.1 인덱스 — No.46

**찾을 원문**
````text
원시 부분 유니크 4개가 보존된다(ADR-0042).**
````
**바꿀 내용**
````text
원시 부분 유니크 4개가 보존된다(ADR-0042).** **[No.46] `chatbot_rich_url_policies`는 PK(`chatbotId`)만 둔다(챗봇 단위 1행 조회). 마이그레이션 `20260927120000_channel_rich_messages`는 `CREATE TABLE` 1개뿐이라 원시 부분 유니크 4개가 보존된다(적용 후 `sqlite_master` 4행 확인 — ADR-0043).**
````

### A-12. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 대화 설계 행에 No.46

**찾을 원문**
````text
import 계열) | 5~9 |
````
**바꿀 내용**
````text
import 계열) **[No.46] 노드 아웃풋 `CAROUSEL`·`BUTTON.display` 저장(스키마 확장만 — 새 경로 0 · 바로연결 배치 위반 `400 OUTPUT_PAYLOAD_INVALID` · 허용 목록 밖 주소 `400 VALIDATION_FAILED`) · 설계 점검 +2(`RICH_URL_NOT_ALLOWED`·`RICH_URL_SUSPICIOUS`) · `GET·PUT /chatbots/:chatbotId/rich-url-policy`(허용 도메인 목록 — `chatbot:read`/`chatbot:write` · 전체 교체)** | 5~9, 46 |
````

### A-13. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 공개 대화 행에 기능 선언 `rich-v1`

**찾을 원문**
````text
새 공개 경로 0)** | 11, 24, 30, 42, 44 |
````
**바꿀 내용**
````text
새 공개 경로 0)** · **[No.46] `POST …/messages` 요청 `features`에 `'rich-v1'`(위젯 기능 선언 — 없으면 서버가 캐러셀을 `CARD` 여러 개로 강등하고 바로연결은 일반 버튼) · 응답 `outputs`에 `CAROUSEL`·`BUTTON.display`(선언한 위젯만) · 요청·응답 스키마 정의 불변 · 새 공개 경로 0** | 11, 24, 30, 42, 44, 46 |
````

### A-14. [개발명세서 `docs/02-spec/개발명세서.md`] §4 API 표 — 통합 인박스 행에 `degradePreview`

**찾을 원문**
````text
공개 대화 요청 본문·응답 스키마 불변** | 42 |
````
**바꿀 내용**
````text
공개 대화 요청 본문·응답 스키마 불변** **[No.46] 시뮬레이션 응답 `degradePreview` = 채널별 강등 미리보기 객체(`{ channelType, source, outputs, changes }` — 스키마는 `'NOT_DEFINED'`과의 합집합)** | 42, 46 |
````

### A-15. [개발명세서 `docs/02-spec/개발명세서.md`] §4 정정 이력 — 2026-09-27 항목 추가

**찾을 원문**
````text
공개 경로 8곳 그대로(`omnichannel-inbox-설계.md` §14).
````
**바꿀 내용**
````text
공개 경로 8곳 그대로(`omnichannel-inbox-설계.md` §14).
> **정정 이력(2026-09-27 — 채널별 리치 메시지)**: ① 요구사항 가칭 `POST …/dialog-nodes/output-preview`는 **만들지 않는다** — 강등은 zod 무의존 순수 함수라 콘솔이 직접 계산한다(채널별 미리보기·저장 경고). ② 허용 도메인 목록은 챗봇 스코프 설정 자원 `/chatbots/:chatbotId/rich-url-policy`(GET·PUT 전체 교체)로 확정했다. ③ 공개 표면 변화는 요청 `features`의 값 1개(`rich-v1`)뿐이다. 신규 `ApiErrorCode` 0종 · 공개 경로 8곳 그대로(`channel-rich-messages-설계.md` §9.3).
````

### A-16. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 챗봇 스코프 — 허용 목록 `ARCHIVED` 규칙

**찾을 원문**
````text
연결·시뮬레이션을 요청하면 `400 VALIDATION_FAILED`다 |
````
**바꿀 내용**
````text
연결·시뮬레이션을 요청하면 `400 VALIDATION_FAILED`다 **[No.46] 리치 메시지 허용 도메인 목록은 조회를 `ARCHIVED`에서도 허용하고 저장은 `409 CHATBOT_ARCHIVED`다(인박스 참여 설정과 같은 규칙)** |
````

### A-17. [개발명세서 `docs/02-spec/개발명세서.md`] §4.1 권한 — No.46 권한 보론

**찾을 원문**
````text
식별 비밀 참조 = `security:write`(ADR-0042 §7) |
````
**바꿀 내용**
````text
식별 비밀 참조 = `security:write`(ADR-0042 §7) **[No.46] 캐러셀·바로연결 저장 = 기존 `dialogue:write` · 채널별 미리보기 = 콘솔 계산(권한 추가 0) · 허용 도메인 목록 = `chatbot:read｜write`(신규 권한 0 — ADR-0043 §10)** |
````

### A-18. [개발명세서 `docs/02-spec/개발명세서.md`] §5 성능 — No.46 항목 추가

**찾을 원문**
````text
병합 200ms · 위젯 gzip +1.5KB 이하(ADR-0042).
````
**바꿀 내용**
````text
병합 200ms · 위젯 gzip +1.5KB 이하(ADR-0042).
  - **[신규 2026-09-27 — 채널별 리치 메시지] 새 컴포넌트를 쓰지 않는 노드는 `rich-v1` 선언 여부와 무관하게 공개 대화 지연·응답 바이트·요청 경로 쿼리 수가 불변**이다(강등 = 입력 객체 참조 그대로 반환). 캐러셀 10장 강등 ≤1ms · 응답 ≤40KB · 공개 경로 추가 DB 조회 0(허용 목록은 저장 시점만) · 노드 저장 +1쿼리(새 컴포넌트 URL이 있을 때만) · 허용 목록 조회 P95 300ms(초안 노드 2,000개 스캔) · 콘솔 미리보기 서버 호출 0 · 위젯 gzip +6KB 이하(ADR-0043).
````

### A-19. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 새 컴포넌트 주소 정책

**찾을 원문**
````text
(재생 이득 제한 — ADR-0042 §2·§3·§6).
````
**바꿀 내용**
````text
(재생 이득 제한 — ADR-0042 §2·§3·§6). **[No.46] 캐러셀 이미지·링크는 https 전용 + 사용자정보(`@`)·제어 문자·공백·역슬래시·2,048자 초과 거부(순수 판정 `inspectRichUrl` 1벌 — 서버 스키마·콘솔·위젯 공유 · 위젯은 렌더 시 재검증) · 퓨니코드·IP·단축 URL 경고 · 챗봇별 허용 도메인 목록(선택). 기존 타입의 `SafeUrlSchema`(http 허용)는 하위 호환으로 불변이다. 위젯은 이미지 `referrerPolicy=no-referrer`·링크 `noopener noreferrer`·`textContent`만 쓴다. 이미지·링크는 최종 사용자 브라우저가 가져가므로 서버 출구가 아니다(`EgressExitId` 6 불변 · 서버가 그 주소에 접속하는 코드 0 — ADR-0043 §7·§8).**
````

### A-20. [개발명세서 `docs/02-spec/개발명세서.md`] §5 보안 — 리치 메시지 봉인 항목 추가

**찾을 원문**
````text
동의·고지는 호스트 책임.
````
**바꿀 내용**
````text
동의·고지는 호스트 책임. **[No.46] ① 엔진에 채널·강등·프로필 심볼 0 · `CAROUSEL` 보유 엔진 파일 2 ② BUTTON 재조립은 스프레드(필드 나열 재조립 0) ③ 금지어·로그·강등 후처리의 `default` 통과 0(`never` 망라) ④ 강등·URL 판정 모듈 zod 무의존 ⑤ WEB 어댑터 타입 리터럴 목록 0(능력표 파생) ⑥ 허용 목록 쓰기 1파일 ⑦ 서버 출구·새 루프·환경변수·권한 0 ⑧ 새 스키마 `.default()` 0 + 골든 해시 — `rich-message-sealing.spec.ts` **RM-1~RM-18**. **[알려진 한계]** 허용 목록은 노드 편집 API 저장 시점만 강제(복원·이전 경로는 설계 점검 경고) · 퓨니코드는 경고만 · 사용자 브라우저가 외부 이미지 호스트에 접속한다(IP 노출 — 고지 사항).**
````

### A-21. [개발명세서 `docs/02-spec/개발명세서.md`] §5 접근성/UI 품질 — 캐러셀·바로연결 원칙

**찾을 원문**
````text
식별 공간"은 짧은 풀이와 함께만).**
````
**바꿀 내용**
````text
식별 공간"은 짧은 풀이와 함께만).** **[No.46] 캐러셀 = 자동 넘김 0 · 모든 카드 DOM 유지(숨김 슬라이드 0) · "이전 카드"/"다음 카드" 텍스트 버튼(끝에서 `aria-disabled` — 포커스 유지) · 카드 `aria-label` "N개 중 K번째: 제목" · 위치 안내는 상태 영역 1회 · `prefers-reduced-motion` 존중. 바로연결 칩 = 사용 후 `hidden`(새 노드 0 · 포커스는 입력창으로). 콘솔 채널별 미리보기의 가정치·기본값은 "예상 모습" 라벨(색 + 텍스트) · 카드 순서 변경은 버튼으로도(UIUX 준수기준 §1·§3·§8 신설 규칙).**
````

### A-22. [개발명세서 `docs/02-spec/개발명세서.md`] §5 DB 이식성 — 허용 목록 테이블

**찾을 원문**
````text
지정 대상에 추가한다(재검토 트리거).**
````
**바꿀 내용**
````text
지정 대상에 추가한다(재검토 트리거).** **[No.46] 허용 목록 1:1 테이블은 `CREATE TABLE`만(재정의 0 — 부분 유니크 4개 보존)이며 `hosts`는 기존 JSON 문자열 컬럼 규약을 따른다(ADR-0043).**
````

### A-23. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 16(ADR-0011) — No.46 갱신 각주

**찾을 원문**
````text
2차 외부 채널 ADR의 교체 지점(ADR-0011 갱신 각주, ADR-0042 §1·§2).
````
**바꿀 내용**
````text
2차 외부 채널 ADR의 교체 지점(ADR-0011 갱신 각주, ADR-0042 §1·§2).
    - **갱신(2026-09-27 — No.46)**: 속성 표 `CHANNEL_CAPABILITIES`에 아웃풋 능력 프로필(`outputs` — WEB 실측·카카오톡 가정치·나머지 텍스트만)을 더하고 `WebChannelAdapter.supportedOutputTypes`는 표에서 파생한다(능력 목록 이중화 해소). 어댑터 계약에 선택 인자 `renderOutbound(outputs, ctx?)`(위젯 기능 선언)를 더해 `rich-v1`이 없는 위젯은 표 밖 가상 프로필(구버전 웹 위젯)로 강등한다. `degradeOutputs`는 3단 사다리 순수 함수로 확장하되 기존 텍스트 문구·"WEB 변환 0" 규약은 그대로다(ADR-0011 갱신 각주, ADR-0043 §4~§6).
````

### A-24. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 17(ADR-0012 위젯) — No.46 갱신 각주

**찾을 원문**
````text
증가분 gzip 1.5KB 이하(ADR-0042 §2).
````
**바꿀 내용**
````text
증가분 gzip 1.5KB 이하(ADR-0042 §2).
    - **갱신(2026-09-27 — No.46)**: 캐러셀(CSS 스크롤 스냅 + 이전/다음 버튼 · 모든 카드 DOM 유지 · 자동 넘김 0)·바로연결 칩(사용 후 `hidden`)이 `core/carousel.ts`·`core/quick-reply.ts` + `ui/renderers/*` 신설로 흡수되어, 감수 비용 ③이 남겨 둔 **"리치 상담 메시지(No.46)" 트리거를 점검한 결과 발동하지 않는다** — vanilla·런타임 의존성 0 · 증가분 gzip 6KB 이하 · 요청 `features` +`rich-v1` · 강등 함수는 위젯이 import하지 않는다(서버 강등) · 남은 트리거 = 파일 첨부(No.33)(ADR-0012 갱신 각주, ADR-0043 §9).
````

### A-25. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 32(ADR-0031) — No.46 갱신 각주

**찾을 원문**
````text
이벤트 구독은 환경 밖(ADR-0031 갱신 각주, ADR-0041 §8).
````
**바꿀 내용**
````text
이벤트 구독은 환경 밖(ADR-0031 갱신 각주, ADR-0041 §8).
    - **갱신(2026-09-27 — No.46)**: `CAROUSEL`·`BUTTON.display`는 노드 자산이라 스냅샷에 자동 포함된다(스키마 버전 1 · 업캐스터 0). 두 스키마에 `.default()`가 없어 **기존 노드 `contentHash`는 바이트 동일**하다(도입 전 커밋 기준 골든 해시 시험). 허용 도메인 목록은 스냅샷 밖이다(ADR-0031 갱신 각주, ADR-0043 §1).
````

### A-26. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 35(ADR-0034) — No.46 갱신 각주

**찾을 원문**
````text
(`WORKFLOW_PRIVATE_ALLOWLIST`)(ADR-0034 갱신 각주, ADR-0041 §6).
````
**바꿀 내용**
````text
(`WORKFLOW_PRIVATE_ALLOWLIST`)(ADR-0034 갱신 각주, ADR-0041 §6).
    - **갱신(2026-09-27 — No.46)**: `{api.*}` 치환의 BUTTON 재조립을 스프레드(`{ ...payload, text, buttons }`)로 바꿔 새 선택 키 `display`가 치환 턴에서 사라지지 않게 한다(재조립 결함 유형 재발 방지 — 정적 검사 + 치환 턴 통합 시험). 캐러셀은 `CARD`와 같은 텍스트 필드만 치환하고 URL·버튼 값은 치환하지 않으며, 1장만 남으면 `CARD`로 바꾼다(ADR-0034 갱신 각주, ADR-0043 §2).
````

### A-27. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 36(ADR-0035) — No.46 갱신 각주

**찾을 원문**
````text
(ADR-0035 갱신 각주, ADR-0041 §2·§3).
````
**바꿀 내용**
````text
(ADR-0035 갱신 각주, ADR-0041 §2·§3).
    - **갱신(2026-09-27 — No.46)**: 재검토 트리거 "No.46 착수 → 위젯 전용 설문 컴포넌트"는 **미발동**이다 — No.46 1차는 캐러셀·바로연결뿐이라 설문은 기존 `TEXT`·`BUTTON` 그대로이고 문항 버튼은 바로연결 키를 쓰지 않는다. 트리거는 "다중 선택 이탈률" 조건으로 유지한다(ADR-0035 갱신 각주, ADR-0043).
````

### A-28. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 39(ADR-0038) — No.46 갱신 각주

**찾을 원문**
````text
→ **ADR-0038**(+ ADR-0002·0011·0012·0015·0019·0023·0033 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0038**(+ ADR-0002·0011·0012·0015·0019·0023·0033 갱신 각주)
    - **갱신(2026-09-27 — No.46)**: 위젯 기능 선언 3번째 `'rich-v1'`(3/5) — 선언이 없으면 서버가 캐러셀을 카드 여러 개로 강등한다(`feedback-v1`과 같은 "선언 없으면 구버전 경로 바이트 동일" 규약). `.default()` 금지 규약(§5)을 새 아웃풋 스키마에도 적용했다(ADR-0038 갱신 각주, ADR-0043 §6).
````

### A-29. [개발명세서 `docs/02-spec/개발명세서.md`] §6 결정 43(ADR-0042) 갱신 각주 + 결정 44 신설

**찾을 원문**
````text
→ **ADR-0042**(+ ADR-0001·0002·0009·0011·0013·0016·0036·0040·0041 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0042**(+ ADR-0001·0002·0009·0011·0013·0016·0036·0040·0041 갱신 각주)
    - **갱신(2026-09-27 — No.46)**: 설계서 R-18을 이행했다 — 시뮬레이션 응답 `degradePreview`가 채널별 강등 미리보기 객체(`{ channelType, source, outputs, changes }` — 스키마는 `'NOT_DEFINED'`과의 합집합)로 채워진다. 시뮬레이션은 여전히 어댑터가 아닌 콘솔 기능이고 스레드 기록은 원형 요약 그대로다(ADR-0042 갱신 각주, ADR-0043 §5).

44. **채널별 리치 메시지 컴포넌트(No.46)의 컴포넌트·엔진 영향·채널 능력·강등·구버전 위젯·주소 정책·위젯 렌더·권한 확정(2026-09-27 — PM 확정, P-1~P-12 추천안)**: **① 1차 = WEB 위젯 실제 렌더 + 8채널 출력 능력표 + 추정 미리보기**(카카오 전용 모델링·실연동 2차 — P-1 (a)). **② 컴포넌트 = `CAROUSEL` 새 타입 1(카드 2~10장 · 카드당 버튼 ≤3 · CARD 필드 재사용) + `BUTTON.display?: 'QUICK_REPLY'` 선택 키 1(MESSAGE·NODE만 · 노드당 1개·표시 아웃풋 맨 끝)** — 닫힌 목록 · `.default()` 0으로 기존 스냅샷 해시 바이트 동일(P-2·P-5·P-7). **③ 엔진 = 기존 2파일 분기 추가만**(실행 `case` · `never` 망라 · BUTTON 재조립 스프레드 · 캐러셀 치환(1장 → CARD) · 참조·URL 점검 — 새 파일·export 0 → 엔진 표면 골든 불변). **④ 후처리 3종(금지어·로그·강등) 전 타입 명시 + `never`** — `default` 통과 0. **⑤ 채널 능력 = `CHANNEL_CAPABILITIES[*].outputs` 1곳**(WEB 실측 — 상한 = 스키마 최대 · 카카오톡 가정치 보수값 · 나머지 텍스트만 · 표 밖 구버전 위젯 프로필) · WEB 어댑터는 표에서 파생. **⑥ 강등 = 3단 사다리 순수 함수 1벌(zod 무의존 — api·콘솔)** · 콘솔 채널별 미리보기·저장 경고(비차단) · No.42 `degradePreview` 채움(P-3). **⑦ 구버전 위젯 = `rich-v1` 없으면 서버 강등**(캐러셀 → CARD N개 · 바로연결 → 일반 버튼) · 어댑터 `renderOutbound(outputs, ctx?)`(P-8). **⑧ 주소 = 새 컴포넌트만 https 전용 + `@`·제어 문자 차단 + 퓨니코드·IP·단축 URL 경고 + 챗봇별 허용 도메인 목록(선택 · 신규 1:1 테이블 · 노드 편집 저장 시점 검사)** · 기존 `SafeUrlSchema` 불변 · 이미지는 브라우저가 가져가므로 서버 출구 아님(`EgressExitId` 6 불변)(P-4). **⑨ 위젯 = vanilla · 증가 ≤6KB · Preact 트리거 미발동** · 캐러셀 자동 넘김 0·모든 카드 DOM·`aria-disabled` 끝 버튼 · 칩 사용 후 `hidden`(P-9). **⑩ 신규 권한·역할 0 · 클릭 기록 기존 수준**(P-6·P-10). 신규 테이블 1(`ChatbotRichUrlPolicy` — 마이그레이션 1 · `CREATE`만) · 컨트롤러 +1(핸들러 2) · `@Public()` 8 · `ApiErrorCode`·환경변수 0 · 설계 점검 코드 +2 · ml-worker 변경 0. GPU **1 유지**(P-12). → **ADR-0043**(+ ADR-0002·0011·0012·0031·0034·0035·0038·0042 갱신 각주)
````

### A-30. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — 설계서 행 추가

**찾을 원문**
````text
요구사항: `docs/requirements/omnichannel-inbox.md` |
````
**바꿀 내용**
````text
요구사항: `docs/requirements/omnichannel-inbox.md` |
| **`channel-rich-messages-설계.md`** | **채널별 리치 메시지(No.46) — 모듈 배치(`rich-messages` export 0 · 허용 목록 쓰기 유일 · 순수 lib) · 공개 파이프라인 ⑤ 렌더 문맥 · Prisma 변경안(`ChatbotRichUrlPolicy` 1테이블 — 마이그레이션 1 · `CREATE`만 · 부분 유니크 4 보존) · 스냅샷 해시 바이트 동일(`.default()` 0 · 골든) · shared-types(`CAROUSEL`·`BUTTON.display`·`rich-url`·`rich-degrade`·능력표·`degradePreview` 합집합) · ★엔진 변경 닫힌 목록 EN-1~EN-6(새 파일·export 0) · ★후처리 3종 `never` 망라 · ★능력표 값·3단 강등 사다리·텍스트 형식·바뀐 점 11종·불변식 I-1~I-7 · 어댑터 계약·구버전 위젯 · 주소 판정·허용 목록 API·No.45 출구 관계 · 저장 검증·설계 점검 · 콘솔·위젯 렌더(캐러셀·바로연결 접근성) · 권한·감사 · 버전·자산 이전 · ★새 아웃풋 타입 수정 지점 22곳 · **봉인 RM-1~RM-18** · 성능 예산 · 시험 전략(★상대 시각 원칙)·**의도된 기대값 변경 4건(닫힌 목록)** · 미사용 동작 불변 보장 · 알려진 제한 12건 · 요구사항 대비 해석 24건** | 요구사항: `docs/requirements/channel-rich-messages.md` |
````

### A-31. [개발명세서 `docs/02-spec/개발명세서.md`] §7 인덱스 — ADR-0043 행 추가

**찾을 원문**
````text
FR-OC1-\*~FR-OC9-\*, AC-OC1~OC6 |
````
**바꿀 내용**
````text
FR-OC1-\*~FR-OC9-\*, AC-OC1~OC6 |
| **`decisions/ADR-0043-channel-rich-messages-carousel-quick-reply-output-profile-and-degrade-ladder.md`** | **채널별 리치 메시지 = `CAROUSEL` 새 타입 1 + `BUTTON.display` 선택 키 1(닫힌 목록 · `.default()` 0)(새 타입 2개·묶음 타입·CARD 확장 기각) · 엔진 분기 추가만(1장 → CARD · 재조립 스프레드) · 후처리 `never` 망라 · 채널 출력 능력 프로필 = 속성 표 1곳(어댑터 목록 기각 · 카드/캐러셀 카드 버튼 상한 분리) · 3단 강등 순수 함수 1벌(미리보기 API 기각) · 구버전 위젯 `rich-v1` · 새 컴포넌트 https 전용 + 허용 도메인 목록(SafeUrl 강화·출구 목록 공유·턴마다 검사 기각) · 이미지 = 서버 출구 아님 · vanilla 유지(Preact 트리거 미발동) · 신규 권한 0** | 요구사항 J-1~J-16, FR-0-194~202, FR-RM1-\*~FR-RM8-\*, AC-RM1~RM7 |
````

---

## B. 기존 ADR (결정 본문은 수정하지 않는다 — 파일 끝 append)

### B-1. [ADR-0002] `docs/02-spec/decisions/ADR-0002-permanent-delete-referential-integrity.md` — 허용 목록 동반 삭제 · 사전검사 불변 (append)

**찾을 원문**
````text
시험 고객 삭제는 시험 데이터 행 삭제다(보존 대상 아님).
````
**바꿀 내용**
````text
시험 고객 삭제는 시험 데이터 행 삭제다(보존 대상 아님).


---

## 갱신 (2026-09-27 — No.46: 리치 메시지 허용 도메인 목록 동반 삭제 · 사전검사 16종 불변)

채널별 리치 메시지(No.46, **ADR-0043 §7**). 결정 1~6은 불변이다.

- `ChatbotRichUrlPolicy`(챗봇별 캐러셀 이미지·링크 허용 도메인 목록 1:1 — 설정 데이터)는 `ChatbotInboxSetting` 선례로 **동반 삭제**다(23 → 24테이블). 사전검사 16종은 불변이다.
- 캐러셀 카드 버튼의 노드 참조는 새 참조 종류가 아니라 기존 "버튼 → 노드" 참조의 새 위치다 — 노드 삭제 사전검사(`409`)가 `getOutgoingNodeRefs()`로 그대로 막는다.
````

### B-2. [ADR-0011] `docs/02-spec/decisions/ADR-0011-channel-implementation-tier-and-public-surface.md` — 능력표 아웃풋 프로필 · 어댑터 파생 · 렌더 문맥 · 강등 3단 (append)

**찾을 원문**
````text
1차는 두 번째 어댑터가 없어 바꾸지 않았다.
````
**바꿀 내용**
````text
1차는 두 번째 어댑터가 없어 바꾸지 않았다.


---

## 갱신 (2026-09-27 — No.46: 능력표 아웃풋 프로필 · WEB 어댑터 표 파생 · `renderOutbound` 렌더 문맥 · 강등 3단)

채널별 리치 메시지(No.46, **ADR-0043 §4~§6**). §1(구현 등급)·§2(자격증명 미저장)·§3(어댑터 1종·스텁 금지·분기 2파일)·§4~§6은 **불변**이다.

1. **속성 표 확장**: `CHANNEL_CAPABILITIES[type]`에 아웃풋 능력 프로필 `outputs`(출처 `MEASURED`·`ASSUMED`·`DEFAULT` · 지원 타입 · 캐러셀 카드 수 · 카드/캐러셀 카드 버튼 수 · 바로연결 · 버튼 동작 · 이미지 · 글자 수 상한)를 더한다. WEB = 실측(모든 상한 = 스키마 최대치) · 카카오톡 = 가정치(규격 미확인 보수값) · 나머지 6채널 = 텍스트만. 표는 코드 상수이며 관리자 설정이 아니다.
2. **목록 이중화 해소**: `WebChannelAdapter.supportedOutputTypes`는 자기 리터럴 목록을 버리고 표에서 파생한다(정적 검사 RM-5). 채널 능력의 원천은 shared-types 표 1곳이다 — 콘솔 미리보기와 서버 강등이 같은 표를 읽는다.
3. **§3 계약 확장**: `renderOutbound(outputs, ctx?: ChannelRenderContext)` — `ctx.features`(위젯 기능 선언). WEB 어댑터는 `'rich-v1'`이 있으면 WEB 프로필, 없으면 표 밖 가상 프로필 `LEGACY_WEB_WIDGET_OUTPUT_PROFILE`(캐러셀 미지원)로 강등한다. 인자가 없으면 구버전으로 취급한다(안전측). 공개 서비스는 `features`를 넘기기만 한다(분기 0).
4. **58행 `degradeOutputs` 확장**: "타입 → 텍스트 한 줄" 1단이던 규칙을 shared-types 순수 함수 `degradeForProfile()`(zod 무의존)의 **3단 사다리**(원형 → 대체 컴포넌트 → 텍스트)로 확장한다. 기존 5종 텍스트 문구·"경로는 항상 실행"·"WEB 변환 0건" 규약은 그대로이며(WEB 프로필 상한 ≥ 스키마 최대치 — 기존 아웃풋은 입력 참조 그대로 반환), 기존 시그니처(`degradeOutputs(outputs, supported)`)는 래퍼로 유지한다. 외부 채널이 붙으면 그 어댑터가 같은 함수를 자기 프로필로 부른다.
5. 공개 경로 8곳·요청/응답 스키마 정의는 불변이다 — 바뀌는 것은 요청 `features`의 값 하나(`rich-v1`)와 응답 `outputs` 원소의 스키마 확장분(`CAROUSEL`·`BUTTON.display`)뿐이다.
````

### B-3. [ADR-0012] `docs/02-spec/decisions/ADR-0012-widget-stack-and-shared-view-logic.md` — 감수 비용 ③ "No.46" 트리거 점검 = 미발동 (append)

**찾을 원문**
````text
증가분(예상 2KB 이하)은 빌드 로그로 보고한다.
````
**바꿀 내용**
````text
증가분(예상 2KB 이하)은 빌드 로그로 보고한다.


---

## 갱신 (2026-09-27 — No.46: 캐러셀·바로연결 렌더 · vanilla 유지 · 감수 비용 ③ 트리거 점검 = 미발동)

채널별 리치 메시지(No.46, **ADR-0043 §9**). 스택·격리·서브패스 공유 결정은 **불변**이다.

1. 감수 비용 ③이 남겨 둔 트리거 "리치 상담 메시지(No.46)"를 **점검했고 발동하지 않는다** — 캐러셀은 CSS 스크롤 스냅 + 이전/다음 `<button>` 2개, 바로연결은 버튼 묶음 + `hidden` 속성으로 충분하다. 순수 판단은 `core/carousel.ts`(위치·가장 가까운 카드)·`core/quick-reply.ts`(마지막 바로연결 선택), DOM은 `ui/renderers/carousel.ts`·`quick-reply.ts`로 나눈다.
2. 위젯이 요청 `features`에 `'rich-v1'`을 더 싣는다(3/5). 강등 함수(`rich-degrade`)는 위젯이 import하지 않는다 — 서버가 강등한다. 위젯은 zod 무의존 `rich-url`(https·`@` 판정)만 `output-view` 서브패스로 공유해 렌더 시 재검증한다.
3. 런타임 의존성 0 · gzip 100KB 게이트 유지 · **이 그룹 증가분 ≤6KB**(빌드 로그 보고). 남은 Preact 재검토 트리거 = **파일 첨부(No.33)**.
````

### B-4. [ADR-0031] `docs/02-spec/decisions/ADR-0031-chatbot-version-snapshot-and-id-preserving-restore.md` — 새 타입·선택 키 스냅샷 포함 · 해시 바이트 동일 (append)

**찾을 원문**
````text
`WorkflowSubscription`은 스냅샷 밖**(환경 밖 — 저장 즉시 운영 반영)이며 챗봇 복사·토픽 분리 대상이 아니다.
````
**바꿀 내용**
````text
`WorkflowSubscription`은 스냅샷 밖**(환경 밖 — 저장 즉시 운영 반영)이며 챗봇 복사·토픽 분리 대상이 아니다.


---

## 갱신 (2026-09-27 — No.46: `CAROUSEL`·`BUTTON.display`는 스냅샷 포함 · `.default()` 금지로 기존 해시 바이트 동일 · 허용 목록은 스냅샷 밖)

채널별 리치 메시지(No.46, **ADR-0043 §1**). 스냅샷 범위·ID 보존 복원·단일 트랜잭션·해시 규칙은 **불변**이다.

1. 새 아웃풋 타입 `CAROUSEL`과 `BUTTON` 선택 키 `display`는 노드 자산이라 **스냅샷·차이·복원·환경 포인터에 자동 포함**된다. `SNAPSHOT_SCHEMA_VERSION = 1` 유지 · **업캐스터 불필요**(읽기 스키마에 타입·선택 키 추가뿐).
2. 두 스키마 어디에도 **`.default()`를 두지 않는다** — 기존 노드를 다시 파싱해도 키가 생기지 않으므로 **기존 스냅샷 `contentHash`가 바이트 동일**하다(No.44 `feedbackEnabled` 선례). 도입 전 커밋으로 계산한 골든 해시 시험이 이를 고정한다(설계서 §3.3 · RM-16).
3. 캐러셀 카드 이미지·링크는 https 전용 스키마라 복원 검증도 같은 규칙을 쓴다(새 타입이라 과거 데이터 없음). 기존 타입의 `SafeUrlSchema`는 불변 — 과거 스냅샷 복원이 새 규칙에 걸리지 않는다.
4. **`ChatbotRichUrlPolicy`(허용 도메인 목록)는 스냅샷 밖**(환경 밖 설정 — 복원 대상 아님)이며 챗봇 복사·토픽 분리 대상이 아니다. 복원으로 목록 밖 주소가 들어오면 설계 점검 `RICH_URL_NOT_ALLOWED`로 알린다(차단 아님).
````

### B-5. [ADR-0034] `docs/02-spec/decisions/ADR-0034-legacy-api-connection-registry-and-engine-suspension.md` — BUTTON 재조립 결함 재발 방지 · 캐러셀 치환 (append)

**찾을 원문**
````text
`common/outbound/`로 이동(L-2 경로 갱신).
````
**바꿀 내용**
````text
`common/outbound/`로 이동(L-2 경로 갱신).


---

## 갱신 (2026-09-27 — No.46: BUTTON 재조립 결함 재발 방지 · 캐러셀 치환 규약)

채널별 리치 메시지(No.46, **ADR-0043 §2**). 결정 1~11은 불변이다.

1. `{api.*}` 치환의 `BUTTON` 분기가 페이로드를 `{ text, buttons }`로 **필드 나열 재조립**하던 코드는 새 선택 키 `display`(바로연결)를 **치환이 있는 턴에서만** 조용히 잃는다 — 요구사항이 선례로 든 재조립 경로 결함(이 ADR 계열 · No.41 C-4)과 같은 유형이다. `{ ...output.payload, text, buttons }` **스프레드**로 바꾸고 정적 검사(RM-2 — 필드 나열 재조립 0)와 v2 `API_CONDITION` 성공 분기 뒤 실제 공개 대화 통합 시험(`resumeAfterApiCall` 경로)으로 고정한다.
2. 캐러셀 치환 대상은 `CARD`와 같은 텍스트 필드(안내 문구·카드 제목·설명·버튼 라벨)뿐이고 URL·버튼 값은 치환하지 않는다(AC-L3-9 규약). 제목이 빈 카드는 제거하고 0장이면 아웃풋 제거, **1장이면 `CARD`로 바꾼다**(엔진 출력은 항상 스키마를 통과 — 캐러셀은 2~10장) — 모두 `API_VALUE_DROPPED` trace.
3. 새 재검토 트리거: 아웃풋 페이로드에 선택 키를 더할 때는 엔진·금지어·자산 이전 트림의 재조립 지점이 스프레드인지 먼저 확인한다(`channel-rich-messages-설계.md` §15 체크리스트).
````

### B-6. [ADR-0035] `docs/02-spec/decisions/ADR-0035-survey-dialogue-session-and-server-response-ledger.md` — 트리거 "No.46 착수" 점검 = 미발동 (append)

**찾을 원문**
````text
선택·척도 답(key·정수)만 구독 옵션으로 싣는다.
````
**바꿀 내용**
````text
선택·척도 답(key·정수)만 구독 옵션으로 싣는다.


---

## 갱신 (2026-09-27 — No.46: 재검토 트리거 "No.46 착수 → 위젯 전용 설문 컴포넌트" 점검 = 미발동)

채널별 리치 메시지(No.46, **ADR-0043**). 결정 1~12는 불변이다.

- No.46이 착수됐지만 1차 범위(PM 확정 P-2)는 **캐러셀·바로연결 버튼**뿐이다. 설문 전용 위젯 컴포넌트(체크박스·별점 아이콘·한 화면 폼)는 만들지 않으므로 설문은 계속 기존 `TEXT`·`BUTTON`으로 진행하며 설문 엔진·봉투·적재는 불변이다.
- 설문 문항 버튼은 바로연결 키(`display`)를 쓰지 않는다(FR-RM2-5 — 엔진이 만드는 버튼 불변).
- 트리거는 "다중 선택 이탈률이 다른 유형보다 현저히 높음" 조건으로 **유지**한다. 발동 시 No.46의 캐러셀 렌더 구조(`core/`·`ui/` 분리 · 기능 선언으로 구버전 강등)를 설문 컴포넌트의 선례로 쓴다.
````

### B-7. [ADR-0038] `docs/02-spec/decisions/ADR-0038-answer-feedback-message-capability-ledger-and-queue-source-split.md` — 기능 선언 3번째 `rich-v1` (append)

**찾을 원문**
````text
(`feedbackEnabled`는 WEB 설정에 그대로 둔다).
````
**바꿀 내용**
````text
(`feedbackEnabled`는 WEB 설정에 그대로 둔다).


---

## 갱신 (2026-09-27 — No.46: 위젯 기능 선언 3번째 `rich-v1`)

채널별 리치 메시지(No.46, **ADR-0043 §6**). 결정 1~8은 불변이다.

- 위젯 요청 `features`에 `'rich-v1'`이 더해진다(`handoff-v1`·`feedback-v1`에 이어 3/5). 선언이 없으면 서버가 캐러셀을 카드 여러 개로 강등한다 — `feedback-v1`과 같은 "선언 없으면 구버전 경로 바이트 동일" 규약이다. 평가 가능 판정(`isFeedbackOffered`)·원장은 불변이며 캐러셀·바로연결 턴도 기존 규칙으로 평가 표식을 받는다.
- `.default()` 금지 규약(§5)을 새 아웃풋 스키마(`CAROUSEL`·`BUTTON.display`)에도 적용했다.
- 새 재검토 트리거: 기능 선언이 상한 5에 닿으면 선언을 버전 문자열 하나로 합치는 방식을 검토한다.
- 기존 트리거 "비WEB 채널(No.46·No.11) 평가"는 **미발동** — No.46 1차는 능력표·미리보기뿐이고 외부 채널 실연동은 2차다.
````

### B-8. [ADR-0042] `docs/02-spec/decisions/ADR-0042-omnichannel-inbox-signed-identity-customer-thread-and-record-channels.md` — R-18 이행 (append)

**찾을 원문**
````text
이름 검색을 블라인드 인덱스로.
````
**바꿀 내용**
````text
이름 검색을 블라인드 인덱스로.


---

## 갱신 (2026-09-27 — No.46: R-18 이행 — `degradePreview`를 채널별 강등 미리보기로 채운다)

채널별 리치 메시지(No.46, **ADR-0043 §4·§5**). 결정 1~8은 불변이다.

1. 설계서 R-18("지원 목록 미정의 → 격하 0 + `degradePreview: 'NOT_DEFINED'` · No.46이 채운다")을 **이행**한다. 채널 능력표(`CHANNEL_CAPABILITIES[type].outputs`)와 3단 강등 순수 함수(`degradeForProfile`)가 생겨 시뮬레이션 응답의 `degradePreview`는 `{ channelType, source(MEASURED｜ASSUMED｜DEFAULT), outputs(강등 결과), changes(바뀐 점) }` 객체가 된다. 가상 채널이 WEB이면 `changes`는 빈 목록이다.
2. 응답 스키마는 `'NOT_DEFINED' ∪ 미리보기 객체`의 **합집합**이다 — 옛 값은 하위 호환용으로 스키마에만 남기고 서비스는 항상 객체를 돌려준다.
3. 시뮬레이션은 여전히 **어댑터가 아닌 콘솔 기능**이다 — 강등 함수를 호출할 뿐 팩토리 분기·어댑터 파일을 더하지 않는다(ADR-0011 스텁 금지 준수). 카카오톡 등 미연동 채널은 가정치·기본값 프로필이며 콘솔은 항상 "예상 모습" 라벨을 단다.
4. 인박스 스레드 기록(`SIM_BOT` 항목 — 마스킹 텍스트)은 **원형 기준 요약** 그대로다(기록 규약 불변 — 캐러셀은 `[캐러셀] …` 요약).
````

---

## C. `docs/01-requirements/기능요구사항.md`

### C-1. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 No.46 행 — PM 확정 · 설계 완료 반영

**찾을 원문**
````text
| 46 | 채널 특화 UI | 채널별 리치 메시지 컴포넌트 | 카카오톡 바로연결버튼·캐러셀 등 채널 고유 UI 컴포넌트를 대화그래프 아웃풋에서 선택 가능 | 1 | ○ | ○ | 카카오 i 오픈빌더 벤치마킹. 5번(대화그래프 아웃풋 12종 이상)을 채널별로 특화하는 개념 **[2026-09-26 No.42 설계 완료] 통합 인박스 시뮬레이션 채널의 "이 채널에서는 이렇게 보입니다" 격하 미리보기는 채널별 지원 목록이 정의될 때(이 기능) 켜진다 — 1차는 격하 0(ADR-0042)** |
````
**바꿀 내용**
````text
| 46 | 채널 특화 UI | 채널별 리치 메시지 컴포넌트 | 대화그래프 아웃풋에서 **캐러셀**(카드 2~10장 옆으로 넘겨 보기 · 카드당 버튼 ≤3)과 **바로연결 버튼**(답 아래 빠른 선택 칩 — 기존 버튼의 표시 방식)을 선택 · **8채널 출력 능력표**(웹 실측 · 카카오톡 가정치 · 나머지 텍스트만)와 **자동 강등**(원형 → 단순 컴포넌트 → 텍스트) · 콘솔 채널별 미리보기("예상 모습" 라벨) · 통합 인박스 시뮬레이션 미리보기 · 새 컴포넌트 이미지·링크 https 전용 + 피싱 형식 차단 + 챗봇별 허용 도메인 목록 | 1 | ○ | ○ | **✅ PM 도입 확정(2026-09-25) · 범위·방식 확정(2026-09-27 — P-1~P-12 전부 추천안) · 설계 완료(`docs/02-spec/channel-rich-messages-설계.md` · ADR-0043).** 1차 실제 렌더 = 웹 위젯(구버전 위젯은 카드 여러 개로 자동 강등) · 카카오톡 실연동·카카오 전용 버튼·목록형/상품 카드·이미지 업로드·클릭 통계·채널별 수동 대체 응답은 2차 · 엔진은 기존 2파일 분기 추가만(새 파일·export 0) · `@Public()` 8 유지 · 신규 권한 0 · 허용 목록 테이블 1(마이그레이션 1) · GPU 1 유지. 카카오 i 오픈빌더 벤치마킹. 5번(대화그래프 아웃풋 12종 이상)을 채널별로 특화하는 개념 **[2026-09-26 No.42 설계 완료] 통합 인박스 시뮬레이션 채널의 "이 채널에서는 이렇게 보입니다" 격하 미리보기는 채널별 지원 목록이 정의될 때(이 기능) 켜진다 — 1차는 격하 0(ADR-0042)** **[2026-09-27 No.46 설계 완료] 위 미리보기를 채운다(`degradePreview` 객체 — ADR-0043)** |
````

### C-2. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §4-1 사용자 확인 결과(106행) — No.46 범위·방식 확정

**찾을 원문**
````text
§11 P-1~P-12 전부 추천안 · 설계 `docs/02-spec/omnichannel-inbox-설계.md` · ADR-0042).**
````
**바꿀 내용**
````text
§11 P-1~P-12 전부 추천안 · 설계 `docs/02-spec/omnichannel-inbox-설계.md` · ADR-0042).** **[2026-09-27 갱신] No.46 채널별 리치 메시지 컴포넌트도 범위·방식까지 확정(요구사항 `docs/requirements/channel-rich-messages.md` §11 P-1~P-12 전부 추천안 · 설계 `docs/02-spec/channel-rich-messages-설계.md` · ADR-0043).**
````

### C-3. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §2 No.5 행 — 아웃풋 14종 · 바로연결

**찾을 원문**
````text
대화상자이동/API조건 | 1 | ○ | ○ |
````
**바꿀 내용**
````text
대화상자이동/API조건 **[2026-09-27 No.46 설계 완료] 현재 14종(No.41 `WORKFLOW` · No.46 `CAROUSEL` 캐러셀) + 버튼 표시 방식 "바로연결"(ADR-0043)** | 1 | ○ | ○ |
````

### C-4. [기능요구사항 `docs/01-requirements/기능요구사항.md`] §2 No.11 행 — 채널별 표현 능력표

**찾을 원문**
````text
자격증명 ADR — ADR-0042)** | 1 | ○ | ○ |
````
**바꿀 내용**
````text
자격증명 ADR — ADR-0042)** **[2026-09-27 No.46 설계 완료] 채널별 표현 능력표(WEB 실측 · 카카오톡 가정치 · 나머지 텍스트만)와 3단 강등 규칙은 No.46(ADR-0043)** | 1 | ○ | ○ |
````

---

## D. `docs/requirements/channel-rich-messages.md` — PM 결정 기록 · 설계 반영

### D-1. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] 머리 "도입 상태" — 범위·방식 확정

**찾을 원문**
````text
이 문서는 도입 여부를 묻지 않고 **범위와 방식만** 묻는다(§11).
````
**바꿀 내용**
````text
이 문서는 도입 여부를 묻지 않고 **범위와 방식만** 묻는다(§11). **[범위·방식 확정(2026-09-27, 추천안)] PM이 §11 P-1~P-12를 전부 추천안으로 확정했다 — 설계: `docs/02-spec/channel-rich-messages-설계.md` · ADR-0043(이 문서의 가번호 ADR-0046을 정정).**
````

### D-2. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] 머리 "다음 단계" — 완료 표식 · ADR 번호 정정

**찾을 원문**
````text
**다음 단계**: PM이 §11 핵심 4건(P-1~P-4)을 결정 → `system-architect`(ADR-0046 신규 · ADR-0011/0012/0042 갱신)
````
**바꿀 내용**
````text
**다음 단계**: **[2026-09-27 PM 결정·architect 설계 완료 — 다음은 `ui-designer`]** 원 계획: ~~PM이 §11 핵심 4건(P-1~P-4)을 결정~~(완료) → `system-architect`(~~ADR-0046~~ **ADR-0043** 신규 · ADR-0011/0012/0042 갱신 — 완료)
````

### D-3. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] §1.10 핵심 판단 표 머리 — PM 결정 표기

**찾을 원문**
````text
### 1.10 이 문서의 핵심 판단 16건 (⚠ = PM 확인 필요)
````
**바꿀 내용**
````text
### 1.10 이 문서의 핵심 판단 16건 (⚠ = PM 확인 필요)

> **PM 결정(2026-09-27)** — ⚠ 표시 항목을 포함해 아래 "결정(제안)" 열이 **전부 추천안대로 확정**되었다(§11 P-1~P-12). architect 확정·조정은 설계서 §1·§22에 있다: ADR 번호 0043(R-1) · 치환 뒤 1장 → `CARD`(R-2) · 구버전 강등 시 `display` 제거(R-3) · 카드/캐러셀 카드 버튼 상한 분리(R-4) · 카카오 보수값(R-5) · 기존 문구 유지·`PAUSE` 제거(R-6) · 바뀐 점 11종(R-7) · 위젯은 강등 함수 미사용(R-8) · 미리보기 API 미채택(R-9) · **허용 목록 신규 테이블 → 마이그레이션 1개(R-10)** · 끝 버튼 `aria-disabled`(R-12) · 새로고침 칩 복원 없음(R-13) · 엑셀 가져오기 해당 없음(R-14) · 배치 규칙 = 서비스 단언(R-15) · 로그 = 실제로 나간 모습의 요약(R-16).
````

### D-4. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] FR-0-201 — 기대값 변경 닫힌 목록 확정

**찾을 원문**
````text
WEB 어댑터 지원 타입 7 → 8 · 엔진 `switch` 망라 시험) | 회귀 방지 |
````
**바꿀 내용**
````text
WEB 어댑터 지원 타입 7 → 8 · 엔진 `switch` 망라 시험) **[확정 2026-09-27 — 설계서 §18.3 닫힌 목록 X-1~X-4: 위젯 요청 `features` 단언 2곳(X-1·X-2) · `@Public()` 전수 스캔 컨트롤러 45 → 46(X-3) · 영구삭제 트랜잭션 목 동반 삭제 +1(X-4). 괄호 안 나머지 예상 항목(타입 개수·`degradePreview` 리터럴·WEB 지원 타입 7 단언·엔진 망라 시험)은 해당 기존 시험이 없어 변경 0]** | 회귀 방지 |
````

### D-5. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] FR-RM1-5 — 1장 남은 캐러셀 처리 확정

**찾을 원문**
````text
(`API_VALUE_DROPPED` trace · 1장만 남으면 캐러셀 그대로 1장 표시 허용). |
````
**바꿀 내용**
````text
(`API_VALUE_DROPPED` trace · 1장만 남으면 ~~캐러셀 그대로 1장 표시 허용~~ **[확정 — `CARD` 1개(+ 안내 문구 `TEXT`)로 바꾼다: 캐러셀 스키마 2~10장 · 공개 응답 계약 유지 — 설계서 §5.3 · R-2]**). |
````

### D-6. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] FR-RM2-3 — 배치 규칙 강제 방식 확정

**찾을 원문**
````text
(아니면 저장 거부 — "바로연결은 응답 맨 끝에 한 번만 둘 수 있습니다").
````
**바꿀 내용**
````text
(아니면 저장 거부 — "바로연결은 응답 맨 끝에 한 번만 둘 수 있습니다"). **[확정 — 노드 저장 서비스 단언 `400 OUTPUT_PAYLOAD_INVALID` · 바로연결 뒤에 올 수 있는 타입 = `DIALOG_MOVE`·`WORKFLOW` — 설계서 §10.1 · R-15]**
````

### D-7. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] FR-RM3-2 — 버튼 상한 분리 확정

**찾을 원문**
````text
캐러셀 10장 · 카드 버튼 3 · 바로연결 5개.
````
**바꿀 내용**
````text
캐러셀 10장 · 카드 버튼 3 · 바로연결 5개. **[확정 — 캐러셀 카드 버튼(3)과 기존 `CARD` 버튼(5) 상한을 분리하고 WEB의 모든 상한 = 스키마 최대치(기존 CARD가 WEB에서 잘리지 않게) — 설계서 §7.1 · R-4]**
````

### D-8. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] FR-RM3-3 — 카카오 글자 수 보수값 확정

**찾을 원문**
````text
글자 수 상한은 architect가 공개 문서 확인 후 기입(확인 못 하면 보수값).
````
**바꿀 내용**
````text
글자 수 상한은 architect가 공개 문서 확인 후 기입(확인 못 하면 보수값). **[확정 — 확인 불가 → 보수값: 제목 50 · 설명 230 · 버튼 라벨 14 · 카드 버튼 3 · 캐러셀 10 · 바로연결 10 — 설계서 §7.1 · R-5]**
````

### D-9. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] FR-RM4-2 — 기존 문구 · PAUSE 처리 확정

**찾을 원문**
````text
(`output-degrade.ts` 15~31행)은 **문구 불변**. |
````
**바꿀 내용**
````text
(`output-degrade.ts` 15~31행)은 **문구 불변**. **[확정 — 기존 5종 문구 불변 · 텍스트로 바뀌며 잃는 링크 주소·노드 이동은 `ACTION_LOST`로 보고 · `PAUSE`는 빈 텍스트 대신 제거 — 설계서 §7.2 · R-6]** |
````

### D-10. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] FR-RM4-3 — 바뀐 점 종류 확정

**찾을 원문**
````text
콘솔 경고·미리보기 설명·시뮬레이션 응답에 쓴다. 공개 응답에는 싣지 않는다. |
````
**바꿀 내용**
````text
콘솔 경고·미리보기 설명·시뮬레이션 응답에 쓴다. 공개 응답에는 싣지 않는다. **[확정 — 바뀐 점 11종(`OUTPUT_TO_TEXT`·`OUTPUT_REMOVED` 추가) — 설계서 §7.4 · R-7]** |
````

### D-11. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] FR-RM4-4 — `display` 처리 · 어댑터 계약 확정

**찾을 원문**
````text
(architect 판단 — 응답 바이트 최소 변경 권고: 제거하지 않음). 어댑터 계약에 선택 인자(예: 렌더 문맥) 1개를 더하는 방식은 architect가 정한다. |
````
**바꿀 내용**
````text
(~~architect 판단 — 응답 바이트 최소 변경 권고: 제거하지 않음~~ **[확정 — 제거한다(`QUICK_REPLY_TO_BUTTON` — 강등 사다리 일관성 · 구버전은 키를 무시하므로 관측 차이 0) — 설계서 §8 · R-3]**). 어댑터 계약에 선택 인자(예: 렌더 문맥) 1개를 더하는 방식은 architect가 정한다. **[확정 — `renderOutbound(outputs, ctx?: { features? })` · 인자 없음 = 구버전 — 설계서 §8.1]** |
````

### D-12. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] FR-RM5-3 — 저장 경고 계산 위치 확정

**찾을 원문**
````text
설정만 된 채널이면 정보 표시. |
````
**바꿀 내용**
````text
설정만 된 채널이면 정보 표시. **[확정 — 콘솔 순수 함수(비차단 · 새 API 0) · 엔진 설계 점검에 채널 규칙 0 — 설계서 §11.4 · R-9]** |
````

### D-13. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] FR-RM6-4 — 허용 목록 저장 위치 · 검사 시점 확정

**찾을 원문**
````text
감사 기록 · 환경 밖 자산(No.40 규약)이며 스냅샷 밖. |
````
**바꿀 내용**
````text
감사 기록 · 환경 밖 자산(No.40 규약)이며 스냅샷 밖. **[확정 — 신규 1:1 테이블 `ChatbotRichUrlPolicy`(마이그레이션 1개 — `CREATE TABLE`만) · 검사 = 노드 편집 API 저장 시점(공개 경로 조회 0) · 복원·이전·복사·분리 경로는 설계 점검 `RICH_URL_NOT_ALLOWED` 경고 · `GET·PUT /chatbots/:chatbotId/rich-url-policy` — 설계서 §9.3 · R-10]** |
````

### D-14. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] FR-RM8-2 — 끝 버튼 처리 확정

**찾을 원문**
````text
위치 표시 "2 / 5"(텍스트). **자동 넘김 없음**. |
````
**바꿀 내용**
````text
위치 표시 "2 / 5"(텍스트). **자동 넘김 없음**. **[확정 — 끝 버튼은 `disabled` 대신 `aria-disabled="true"` + 시각 표시(포커스 유지) — 설계서 §12.1 · R-12]** |
````

### D-15. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] FR-RM8-4 — 새로고침 칩 복원 확정

**찾을 원문**
````text
새로고침 복원 시 마지막 봇 턴의 칩만 다시 보인다(store 규약 — architect). |
````
**바꿀 내용**
````text
~~새로고침 복원 시 마지막 봇 턴의 칩만 다시 보인다(store 규약 — architect).~~ **[확정 — 새로고침 시 칩 없음: 위젯은 메시지 이력을 저장·복원하지 않는다(ADR-0009 트리거 ③) — 설계서 §12.2 · R-13]** |
````

### D-16. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] §4.9 API — 미리보기 API 미채택

**찾을 원문**
````text
| `POST /chatbots/:id/dialog-nodes/output-preview`(가칭) |
````
**바꿀 내용**
````text
| ~~`POST /chatbots/:id/dialog-nodes/output-preview`(가칭)~~ **미채택(콘솔 순수 함수 — 설계서 R-9)** |
````

### D-17. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] §4.9 API — 허용 목록 경로 확정

**찾을 원문**
````text
| `GET·PUT /chatbots/:id/rich-url-policy`(가칭) |
````
**바꿀 내용**
````text
| `GET·PUT /chatbots/:chatbotId/rich-url-policy` **(확정 — 설계서 §9.3)** |
````

### D-18. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] §5.4 신규 저장소 — 마이그레이션 판단

**찾을 원문**
````text
| 챗봇별 허용 도메인 목록 | 챗봇 1:1 설정
````
**바꿀 내용**
````text
| 챗봇별 허용 도메인 목록 | **[확정 2026-09-27 — 신규 1:1 테이블 `ChatbotRichUrlPolicy` · 마이그레이션 1개(`CREATE TABLE`만 · 부분 유니크 4 보존) — 설계서 §3 · R-10]** 챗봇 1:1 설정
````

### D-19. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] EX-RM-17 — 해당 없음 확정

**찾을 원문**
````text
기존 아웃풋 가져오기 규약(JSON 형태)을 따른다 · 지원 여부는 architect |
````
**바꿀 내용**
````text
~~기존 아웃풋 가져오기 규약(JSON 형태)을 따른다 · 지원 여부는 architect~~ **해당 없음 — 대량 가져오기 자원에 대화 노드가 없다(`INTENT｜KEYWORD｜FAQ｜TEST_CASE` — 설계서 R-14)** |
````

### D-20. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] §10 상위 문서 갱신 제안 — ADR 번호 정정

**찾을 원문**
````text
| **ADR-0046(신규)** |
````
**바꿀 내용**
````text
| ~~ADR-0046(신규)~~ **ADR-0043(신규 — 번호 정정 · 작성 완료)** |
````

### D-21. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] §11 PM 확인 항목 — P 절 확정 표기

**찾을 원문**
````text
## 11. PM 확인이 필요한 항목
````
**바꿀 내용**
````text
## 11. PM 확인이 필요한 항목

> **PM 결정(2026-09-27) — 확정(2026-09-27, 추천안).** No.46 도입(2026-09-25) · P-1~P-12 전부 권고안 채택.
> - **P-1 (a)** 확정(2026-09-27, 추천안): WEB 위젯에서 캐러셀·바로연결을 실제 렌더 · 8채널 능력표(WEB 실측 · 카카오톡 가정치 · 나머지 텍스트만) · 다른 채널은 추정 미리보기 · 카카오 전용 모델링·실연동은 2차
> - **P-2 (a)** 확정(2026-09-27, 추천안): 캐러셀 + 바로연결 버튼(닫힌 목록)
> - **P-3 (a)** 확정(2026-09-27, 추천안): 3단 자동 강등 · 콘솔 채널별 미리보기 · 저장 시 경고(비차단) · No.42 `degradePreview`를 실제 값으로
> - **P-4 (a)** 확정(2026-09-27, 추천안): 새 컴포넌트 https 전용 · 피싱 형식(`@` 사용자정보 등) 차단 · 허용 도메인 목록(선택) · 이미지 업로드 2차
> - **P-5** 확정(2026-09-27, 추천안): `CAROUSEL` 새 타입 · 바로연결 = `BUTTON.display?: 'QUICK_REPLY'`(구 위젯에서는 일반 버튼)
> - **P-6** 확정(2026-09-27, 추천안): 클릭 기록 기존 수준
> - **P-7** 확정(2026-09-27, 추천안): 카드 2~10장 · 카드당 버튼 ≤3
> - **P-8** 확정(2026-09-27, 추천안): `rich-v1` 기능 선언이 없는 위젯에는 서버가 캐러셀을 CARD 여러 개로 강등
> - **P-9** 확정(2026-09-27, 추천안): 위젯 vanilla 유지 · 증가 ≤6KB · ADR-0012 Preact 재검토 트리거 미발동
> - **P-10** 확정(2026-09-27, 추천안): 신규 권한 0
> - **P-11** 확정(2026-09-27, 추천안): 1차/2차 분리 = §9 목록대로
> - **P-12** 확정(2026-09-27, 추천안): GPU 1 유지 · 구축형 ○ · 구독형 ○
>
> 표 아래 architect 확정 항목의 결정은 설계서 §1 "(architect)" 행과 §22(R-1~R-24)를 따른다. ⚠ 이 문서의 가번호 "ADR-0046"은 **ADR-0043**으로 정정했다(decisions 폴더의 다음 빈 번호).
````

### D-22. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] §11 architect 확정 사항 문단 — 완료 표식

**찾을 원문**
````text
> **architect 확정 사항**(권고안 제시):
````
**바꿀 내용**
````text
> **[2026-09-27 완료 — 설계서 §1 "(architect)" 행 · §22 R-1~R-24]** **architect 확정 사항**(권고안 제시):
````

### D-23. [리치 메시지 요구사항 `docs/requirements/channel-rich-messages.md`] §12 인계 — system-architect 행 완료 표식

**찾을 원문**
````text
| **`system-architect`** | ① **ADR-0046** 작성
````
**바꿀 내용**
````text
| **`system-architect`** | **[2026-09-27 완료 — `docs/02-spec/channel-rich-messages-설계.md` · ADR-0043]** ① ~~**ADR-0046**~~ **ADR-0043** 작성
````

---

## E. 선행 요구사항 문서 — No.46 인계 정정

### E-1. [통합 인박스 요구사항 `docs/requirements/omnichannel-inbox.md`] FR-OC7-3(394행) — 격하 미리보기 규칙 정의 결과

**찾을 원문**
````text
(채널별 지원 목록이 없으면 격하 0 — 규칙 정의는 No.46). |
````
**바꿀 내용**
````text
(채널별 지원 목록이 없으면 격하 0 — 규칙 정의는 No.46). **[2026-09-27 No.46 설계 완료] 규칙 정의 — 능력표 `CHANNEL_CAPABILITIES[*].outputs` + 3단 강등 순수 함수 · `degradePreview`가 `{ channelType, source, outputs, changes }` 객체로 채워진다(`channel-rich-messages-설계.md` §11.6 · ADR-0043)** |
````

### E-2. [통합 인박스 요구사항 `docs/requirements/omnichannel-inbox.md`] 범위 밖(636행) — 채널별 리치 출력 변환 규칙 결과

**찾을 원문**
````text
| **채널별 리치 출력 변환 규칙** | 채널별 지원 목록 정의 | **No.46** |
````
**바꿀 내용**
````text
| **채널별 리치 출력 변환 규칙** | 채널별 지원 목록 정의 | **No.46** — **[2026-09-27 설계 완료 — ADR-0043]** |
````

### E-3. [대화설계 요구사항 `docs/requirements/dialogue-design.md`] 범위 밖(659행) — 리치 메시지 컴포넌트 확정

**찾을 원문**
````text
| 채널별 리치 메시지 컴포넌트(카카오 캐러셀 등) | No.46(보완 제안, 미확정) |
````
**바꿀 내용**
````text
| 채널별 리치 메시지 컴포넌트(카카오 캐러셀 등) | No.46 — **[2026-09-27 도입·범위 확정 · 설계 완료] `CAROUSEL` 새 타입 + `BUTTON.display`(바로연결) — 아웃풋 14종(`channel-rich-messages-설계.md` · ADR-0043)** |
````

### E-4. [품질/채널 요구사항 `docs/requirements/quality-channel.md`] 범위 밖(611행) — No.46 확정

**찾을 원문**
````text
**No.46**(보완 제안, 미확정) 범위다.
````
**바꿀 내용**
````text
**No.46** 범위다 **[2026-09-27 도입·범위 확정 · 설계 완료 — 캐러셀·바로연결을 WEB에서 렌더 · 8채널 능력표(카카오톡 가정치) · 3단 강등 · ADR-0043]**.
````

### E-5. [설문관리 요구사항 `docs/requirements/survey-management.md`] 범위 밖(811행) — 위젯 설문 컴포넌트 트리거 점검

**찾을 원문**
````text
· No.46 착수 · 다중 선택 이탈률이 다른 유형보다 현저히 높을 때 |
````
**바꿀 내용**
````text
· No.46 착수 · 다중 선택 이탈률이 다른 유형보다 현저히 높을 때 **[2026-09-27 No.46 착수 점검 — 1차는 캐러셀·바로연결만(설문 전용 컴포넌트 범위 밖) · 트리거 유지 — ADR-0035 갱신 각주]** |
````

### E-6. [하이브리드 CS 요구사항 `docs/requirements/hybrid-cs.md`] 범위 밖(784행) — 상담원 리치 컨텐츠 경계

**찾을 원문**
````text
| **상담원 메시지 리치 컨텐츠**(버튼·이미지·파일·링크) | 위젯·검증·XSS 재설계 | No.46 |
````
**바꿀 내용**
````text
| **상담원 메시지 리치 컨텐츠**(버튼·이미지·파일·링크) | 위젯·검증·XSS 재설계 | No.46 **[2026-09-27 No.46 설계 완료 — 1차는 봇 노드 아웃풋(캐러셀·바로연결)만 · 상담원 메시지 리치 컨텐츠는 범위 밖(No.24 후속 · 파일은 No.33)]** |
````

### E-7. [피드백 루프 요구사항 `docs/requirements/feedback-loop.md`] 범위 밖(694행) — 비WEB 평가 경계

**찾을 원문**
````text
| **비WEB 채널(카카오 등) 평가** | 채널별 UI 없음 | No.46 · No.11 채널 구현 |
````
**바꿀 내용**
````text
| **비WEB 채널(카카오 등) 평가** | 채널별 UI 없음 | No.46 · No.11 채널 구현 **[2026-09-27 No.46 설계 완료 — 1차는 능력표·미리보기뿐(카카오톡 실연동 2차) → 비WEB 평가는 여전히 채널 실연동 이후]** |
````

---

## G. `docs/02-spec/omnichannel-inbox-설계.md` — R-18 이행 반영

### G-1. [통합 인박스 설계서 `docs/02-spec/omnichannel-inbox-설계.md`] §10.2 4번 — 시뮬레이션 응답 `degradePreview`

**찾을 원문**
````text
4. 응답: `outputs`(격하 미리보기 없음 — 채널별 지원 목록 미정의 · `degradePreview: 'NOT_DEFINED'` · No.46 착수 시 `degradeOutputs(outputs, 지원 목록)`로 교체 — R-18) · `state`(다음 봉투) · 저장된 항목 2건.
````
**바꿀 내용**
````text
4. ~~응답: `outputs`(격하 미리보기 없음 — 채널별 지원 목록 미정의 · `degradePreview: 'NOT_DEFINED'` · No.46 착수 시 `degradeOutputs(outputs, 지원 목록)`로 교체 — R-18) · `state`(다음 봉투) · 저장된 항목 2건.~~ **[2026-09-27 No.46 이행]** 응답: `outputs`(원형) · `degradePreview`(가상 채널 프로필로 강등한 미리보기 객체 `{ channelType, source, outputs, changes }` — `inbox/manage/lib/degrade-preview.ts` · `channel-rich-messages-설계.md` §11.6) · `state`(다음 봉투) · 저장된 항목 2건(원형 요약 — 불변).
````

### G-2. [통합 인박스 설계서 `docs/02-spec/omnichannel-inbox-설계.md`] §24 R-18 — 이행 표기

**찾을 원문**
````text
| R-18 | FR-OC7-3 격하 미리보기 | 지원 목록 미정의 → 격하 0 + `degradePreview: 'NOT_DEFINED'`(No.46이 채운다) |
````
**바꿀 내용**
````text
| R-18 | FR-OC7-3 격하 미리보기 | 지원 목록 미정의 → 격하 0 + `degradePreview: 'NOT_DEFINED'`(No.46이 채운다) **[2026-09-27 이행 — No.46: 능력표 + 3단 강등 순수 함수로 `degradePreview` 객체를 채운다 · 스키마 = 합집합(ADR-0043 · ADR-0042 갱신 각주)]** |
````

### G-3. [통합 인박스 설계서 `docs/02-spec/omnichannel-inbox-설계.md`] §26 범위 밖 — 채널별 리치 출력 완료

**찾을 원문**
````text
· 채널별 리치 출력(No.46) ·
````
**바꿀 내용**
````text
· ~~채널별 리치 출력(No.46)~~ **(2026-09-27 No.46 설계 완료 — ADR-0043)** ·
````

---

## U. `docs/03-design/UIUX_준수기준.md` — 캐러셀 · 일시 선택지 · 추정 미리보기 규칙 신설

### U-1. [UIUX 준수기준 `docs/03-design/UIUX_준수기준.md`] §1 — 추정 미리보기 "예상 모습" 라벨 규칙

**찾을 원문**
````text
`원문 보기` 토글(`hybrid-cs-ui-spec.md` §3.3).
````
**바꿀 내용**
````text
`원문 보기` 토글(`hybrid-cs-ui-spec.md` §3.3).
- **추정 미리보기 표기("예상 모습")**: 실제로 확인되지 않은 규격(미연동 채널의 가정치·기본값)으로 만든 미리보기는 실제 모습과 같은 무게로 보이지 않게 **항상 "예상 모습(실제 규격 확인 전 추정)" 라벨을 색 + 텍스트로** 붙이고, 원래 모습과 달라진 점(잘린 카드·빠진 이미지·텍스트로 바뀐 버튼)을 문장 목록으로 함께 보인다. 확인된 규격(실측)과 추정(가정치)을 같은 탭 목록 안에서 섞어 보여 줄 때는 탭 이름 자체에 "(예상)"을 넣는다(색상만으로 구분 금지 — 위 원칙과 같다). → (b) 노드 편집기 채널별 미리보기·통합 인박스 시뮬레이션 미리보기(`channel-rich-messages-ui-spec.md`).
````

### U-2. [UIUX 준수기준 `docs/03-design/UIUX_준수기준.md`] §3 — 캐러셀 키보드·화면낭독 규칙

**찾을 원문**
````text
`SortableBreakdownTable`).
````
**바꿀 내용**
````text
`SortableBreakdownTable`).
- **캐러셀(여러 카드를 옆으로 넘겨 보는 묶음)**: ① **자동 넘김 금지**(움직이는 콘텐츠의 일시정지 요구를 원천 회피) ② **모든 카드를 DOM에 둔다** — 보이지 않는 카드를 `aria-hidden`·`display:none`으로 숨기지 않아 화면낭독기가 모든 카드를 선형으로 읽는다 ③ "이전 카드"/"다음 카드"는 텍스트 이름이 있는 `<button>`(44×44px 이상) — 끝에 닿으면 `disabled` 대신 `aria-disabled="true"` + 시각 표시로 **포커스를 잃지 않게** 한다 ④ 묶음은 `role="group"` + `aria-roledescription="캐러셀"`, 카드마다 `aria-label="N개 중 K번째: 제목"` ⑤ 버튼으로 이동했을 때만 "N개 중 K번째" 위치를 별도 상태 알림 영역에서 1회 안내한다(손가락 스크롤·Tab 이동은 낭독하지 않음) ⑥ `prefers-reduced-motion`이면 부드러운 스크롤을 끈다 ⑦ 위치를 텍스트("2 / 5")로도 보인다(점 모양만으로 표시하지 않음). → (a) 챗봇 위젯 캐러셀(`channel-rich-messages-ui-spec.md`). 관리자 편집기에서 카드·항목 순서를 바꿀 때는 드래그 외에 **위/아래 이동 버튼**으로도 가능해야 한다 → (b) 캐러셀 카드 편집기.
````

### U-3. [UIUX 준수기준 `docs/03-design/UIUX_준수기준.md`] §8 — 일시 선택지(바로연결 칩) 규칙

**찾을 원문**
````text
→ (a) 챗봇 위젯의 답변 평가 버튼(`feedback-loop-ui-spec.md` §3.2).
````
**바꿀 내용**
````text
→ (a) 챗봇 위젯의 답변 평가 버튼(`feedback-loop-ui-spec.md` §3.2).
- **일시 선택지(답 아래 빠른 선택 칩)**: 다음 입력 전까지만 유효한 선택지는 봇 메시지 아래 라벨 있는 묶음(`role="group"`)의 `<button>`으로 두고, 사용자가 **다음 입력을 보내는 순간**(칩 클릭·직접 입력 모두) 새 DOM 노드를 추가하지 않고 기존 묶음에 `hidden`을 준다. 그때 포커스가 칩에 있었으면 입력창으로 옮긴다(포커스 유실 금지). 한 응답에 여러 개가 오면 마지막 묶음만 칩으로 보인다. → (a) 챗봇 위젯 바로연결 버튼(`channel-rich-messages-ui-spec.md`).
````

### U-4. [UIUX 준수기준 `docs/03-design/UIUX_준수기준.md`] 참고(원문 근거 위치) — 2026-09-27 추가분

**찾을 원문**
````text
`docs/03-design/feedback-loop-ui-spec.md` §3.2·§6.3
````
**바꿀 내용**
````text
`docs/03-design/feedback-loop-ui-spec.md` §3.2·§6.3
- 캐러셀(자동 넘김 금지 · 모든 카드 DOM 유지 · `aria-disabled` 끝 버튼 · 위치 1회 안내) · 일시 선택지(사용 후 `hidden` · 포커스 이동) · 추정 미리보기 "예상 모습" 라벨 규칙(2026-09-27 추가): `docs/requirements/channel-rich-messages.md` NFR-RMA1~5·FR-RM8-2~4·FR-RM5-2, `docs/02-spec/decisions/ADR-0043-channel-rich-messages-carousel-quick-reply-output-profile-and-degrade-ladder.md` §9, `docs/02-spec/channel-rich-messages-설계.md` §12
````

---

## F. 운영 문서

### F-1. [자동배포 `docs/05-ops/자동배포.md`] §5.6 신설 — 채널별 리치 메시지(No.46) 운영 요구

**찾을 원문**
````text
연동 가이드: `docs/05-ops/통합인박스_연동가이드.md`(deployment-engineer 작성 예정).
````
**바꿀 내용**
````text
연동 가이드: `docs/05-ops/통합인박스_연동가이드.md`(deployment-engineer 작성 예정).

### 5.6 채널별 리치 메시지(No.46) 운영 요구 (2026-09-27 추가)

`channel-rich-messages-설계.md` · ADR-0043. 캐러셀·바로연결을 쓰는 설치의 **운영 책임**이다.

1. **마이그레이션**: `20260927120000_channel_rich_messages`(`CREATE TABLE` 1개) 적용 뒤 원시 부분 유니크 인덱스 개수가 4 그대로인지 · 신규 테이블 1(`chatbot_rich_url_policies`) · 외래 키 점검 0행을 확인한다.
2. **위젯 교체와 구버전**: `widget.js` 교체 직후 브라우저 캐시(`max-age=300` — 최대 5분)나 고객사가 복사해 둔 구 스크립트는 기능 선언 `rich-v1`을 보내지 않으므로 캐러셀이 **카드 여러 개(세로)**로 보인다 — 서버 강등으로 정상이며 빈 말풍선은 없다.
3. **호스트 페이지 CSP**: 캐러셀 이미지를 쓰려면 고객사 페이지 CSP `img-src`에 이미지 호스트를 넣어야 한다. 막히면 이미지 자리에 대체 텍스트가 보인다(연동 가이드에 안내).
4. **개인정보 고지**: 캐러셀 이미지는 **최종 사용자 브라우저가 이미지 호스트에 직접 접속**해 받는다(IP·브라우저 정보가 그 호스트에 노출 — Referer는 보내지 않는다). 외부 이미지 호스트를 쓰는 고객사는 처리방침에 고지한다. 폐쇄망·거버넌스 모드 설치는 **사내 이미지 서버 + 챗봇 설정 "리치 메시지 주소 허용 목록"**을 권장한다(목록이 비어 있으면 모든 https 주소 허용).
5. **배포 후 확인**: 위젯 번들 gzip 증가 ≤6KB(빌드 로그) · 신버전 위젯의 메시지 요청 `features` 3개 · 챗봇 설정 "리치 메시지 주소 허용 목록" 화면(목록 밖 주소 노드 수 표시).
````

---

## Z. 적용 후 확인 체크리스트

- [ ] A-1~A-31 · B-1~B-8 · C-1~C-4 · D-1~D-23 · E-1~E-7 · G-1~G-3 · U-1~U-4 · F-1 각 "찾을 원문"이 적용 전 대상 파일에서 **정확히 1회** 검색되는지(0회 = 파일이 그 사이 바뀜 → 이 문서를 갱신 후 적용). 특히 A-6의 `미도입 결정 19건`이 머리 1곳뿐인지, A-24의 `증가분 gzip 1.5KB 이하(ADR-0042 §2).`가 §6 결정 17 줄 1곳뿐인지(§5 성능의 `위젯 gzip +1.5KB 이하(ADR-0042).`와 다른 줄 — A-18), A-27의 `(ADR-0035 갱신 각주, ADR-0041 §2·§3).`가 결정 36 줄 1곳뿐인지, D-21의 `## 11. PM 확인이 필요한 항목`이 요구사항 문서 645행 1곳뿐인지, D-3의 `### 1.10 …`이 183행 1곳뿐인지, U-2의 `` `SortableBreakdownTable`). ``이 UIUX §3 줄 1곳뿐인지 확인한다.
- [ ] 개발명세서 §2 표(A-1 — 2열)·§2.2 표(A-2 — 3열)·§3 표(A-4·A-5 — 3열)·§4 표(A-12~A-14 — 3열)·§4.1 표(A-16·A-17 — 2열 셀 안 append)·§7 표(A-30·A-31 — 3열)의 행이 열 개수를 유지하는지. A-12 대응 기능 열 `5~9, 46` · A-13 `11, 24, 30, 42, 44, 46` · A-14 `42, 46` · A-4 `5, 26, 27, 41, 46`.
- [ ] 개발명세서 §3 엔터티 표에 `ChatbotRichUrlPolicy` 행이 `CustomerMerge` 행 바로 뒤에 있는지 · §3 "미도입 결정 20건" 머리와 ⑳ 항목이 함께 있는지 · §6에 결정 44가 43 바로 뒤에 있는지 · §6 결정 16·17·32·35·36·39·43 아래 "갱신(2026-09-27 — No.46)" 각주가 각 1개인지 · §7 인덱스에 설계서·ADR-0043 행이 각 1개인지.
- [ ] `docs/01-requirements/기능요구사항.md` No.46 행(8열 — GPU 1)·No.5·No.11 행(§2 — 7열)의 열 개수가 표 머리와 같은지 · §4-1 사용자 확인 결과 인용 블록 끝에 "No.46 … 범위·방식까지 확정" 문장이 1개인지(C-2).
- [ ] `docs/requirements/channel-rich-messages.md` 머리 도입 상태(D-1)·다음 단계(D-2)·§1.10 머리(D-3)·§11 머리의 **P-1~P-12 "확정(2026-09-27, 추천안)" 표기(D-21)**가 있는지 · FR 표(FR-0-201, FR-RM1-5·RM2-3·RM3-2·RM3-3·RM4-2·RM4-3·RM4-4·RM5-3·RM6-4·RM8-2·RM8-4)·§4.9·§5.4·EX-RM-17·§10·§11 architect 문단·§12 표의 셀 구조가 깨지지 않는지 · 취소선이 셀 구조를 깨지 않는지 · 가번호 "ADR-0046"이 적용 후 남는 곳이 **취소선 안(D-2·D-20·D-23)과 정정 안내 문장(D-1·D-21)뿐**인지(적용 전 원문의 16·634·697행 3곳이 모두 처리됨).
- [ ] ADR-0002·0011·0012·0031·0034·0035·0038·0042 끝에 "갱신 (2026-09-27 — No.46 …)" 절이 각 1개인지. ADR-0002·0011은 No.42 절 다음, ADR-0012는 No.44 절 다음(No.24·No.42 갱신은 본문·개발명세서 각주에만 있음), ADR-0031·0034·0035는 No.41 절 다음, ADR-0038·0042는 재검토 트리거 목록 다음에 붙는 것이 정상이다.
- [ ] `docs/02-spec/omnichannel-inbox-설계.md` §10.2 4번(G-1)이 번호 목록을 유지하는지(`4. ~~…~~ **[…]** 응답: …`) · R-18 표 행(G-2)의 열 개수 3 유지.
- [ ] `docs/03-design/UIUX_준수기준.md` §1(U-1)·§3(U-2)·§8(U-3) 새 글머리 기호가 각 절의 마지막 기존 항목 바로 뒤에 있는지 · 참고 목록(U-4) 마지막 항목 뒤에 1줄 추가됐는지.
- [ ] `docs/05-ops/자동배포.md` §5.6이 §5.5 다음, 파일 끝 "⚠ §4의 헬스체크 기준" 주석(있다면) 앞에 있는지.
- [ ] **⚠ 사용자 확인 필요(설계 판단 — 구현 착수 전)**: ① **마이그레이션 1개 발생**(허용 도메인 목록 1:1 테이블 — 요구사항은 "마이그레이션 없음"을 예상; 허용 목록을 1차에서 빼면 마이그레이션 0) ② **치환 뒤 1장 남은 캐러셀 → `CARD` 변환**(요구사항 원안 "1장 캐러셀 허용"과 다름 — R-2) ③ **구버전 위젯 강등 시 `display` 제거**(요구사항 권고 "제거하지 않음"과 다름 — 관측 차이 0, R-3) ④ **카카오톡 글자 수 상한은 보수값**(규격 미확인 — R-5) ⑤ **새로고침 시 바로연결 칩 복원 없음**(요구사항 FR-RM8-4와 다름 — R-13). 사용자가 원안을 고수하면 설계서 해당 절·R-n·ADR-0043 해당 문장·D-5·D-11·D-15·D-18을 되돌린다.
- [ ] `CLAUDE.md`의 "구현 완료 기능"·"다음 단계"·"보완 8종 … 사용자 확인 대기 중" 문구는 **이 패치의 범위가 아니다** — 에이전트는 `CLAUDE.md`를 수정하지 않으며(작업 트리의 미커밋 수정 보존), 반영 여부는 사용자가 직접 결정한다.
- [ ] 화면 명세 `docs/03-design/channel-rich-messages-ui-spec.md`(위젯 캐러셀·바로연결 · 노드 편집기 캐러셀 카드 편집·표시 방식 · 채널별 미리보기·"예상 모습" 라벨 · 저장 경고 · 인박스 시뮬레이션 미리보기 · 허용 도메인 목록 설정)는 **ui-designer 단계**에서 한다(UIUX 준수기준 원칙은 U-1~U-3으로 먼저 기록했다).
- [ ] `docs/04-test/시험항목.md`에 TC-46(AC-RM1~RM7)을 추가하고, 도입 전 커밋 기준 골든 해시 픽스처 · `inspectRichUrl` 판정 표 · 4프로필 × 최대 크기 강등 픽스처 · v2 `API_CONDITION` 치환 턴 시나리오 · 위젯 번들 크기 보고 절차를 `시험데이터.md`·`자동시험_전략.md`에 추가하는 일은 **test-automation 단계**에서 한다.
- [ ] 연동 가이드(호스트 페이지 CSP `img-src` · 외부 이미지 호스트 접속 고지 문구 예시 · 사내 이미지 서버 + 허용 목록 권장 · 구버전 위젯 강등 설명)는 **deployment-engineer 단계**에서 작성한다(F-1 §5.6이 요구 사항을 먼저 기록했다).
- [ ] 코드 쪽 기대값 변경(설계서 §18.3 X-1~X-4)은 **구현 단계에서** 반영한다. 그 밖의 기존 시험이 깨지면 회귀로 취급한다(커밋 ①·④에서 깨지면 멈추고 보고).
- [ ] 코드 쪽 주석(`channel-adapter.ts` 머리 "구현체 1종"(렌더 문맥 병기) · `web-channel.adapter.ts` 머리 "WEB은 12종 중 실행 지원 7종"(→ 능력표 파생 8종) · `output-degrade.ts` 머리(3단 사다리) · `output-text-fields.ts` 머리 "`default` 분기로 통과"(→ 전 타입 명시) · `output-view.ts` `OutputView` 주석 "7종" · `public-decorator-count.spec.ts` 제목(45 → 46) · `chatbots.service.ts` 동반 삭제 주석(23 → 24테이블) · `dialogue.ts` "(f) 아웃풋 12종" 머리 주석)은 **구현 단계에서** No.46 내용으로 갱신한다.
