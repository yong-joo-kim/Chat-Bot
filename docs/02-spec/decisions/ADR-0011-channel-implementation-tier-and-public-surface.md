# ADR-0011 — 채널 구현 등급(`CONFIG_ONLY`)·어댑터 계약과 공개 API 표면 정책

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-20
- **결정자**: system-architect (스코프 판단 J-2는 PM 승인 완료)
- **관련**: `docs/requirements/quality-channel.md` §1.3 J-2, §4.2, FR-11-1 ~ FR-11-19, NFR-S1, NFR-S3, NFR-S7, NFR-S10, NFR-M2, AC-11-*, AC-P-*, EX-11-*, EX-P-*
- **영향 범위**: `packages/shared-types/src/channel.ts`, `apps/api/prisma/schema.prisma`, `apps/api/src/{channels, conversation}`, `apps/web` 채널 화면
- **관계**: `ADR-0003`(오류 봉투·존재 노출 404 규약)에 **명시적 예외 1건**을 추가한다.

## 맥락

기준 목록 No.11은 "웹/모바일/카카오톡/라인/페이스북/네이버톡톡/앱/키오스크 **등 배포**"다. 그런데 외부 채널 연동은 ① 플랫폼 계정·자격증명 ② 공개 HTTPS Webhook 수신 엔드포인트 ③ 플랫폼 심사가 전제이며, 현재 개발 환경(SQLite + localhost)에서 어느 것도 확보할 수 없다. **수용기준(AC)을 쓸 수 없는 기능은 이번 Phase에 넣지 않는다**는 기준을 적용하면 7종은 범위 밖이다.

그러나 단순히 "빼기"만 하면 두 가지 문제가 남는다.

1. **화면에서 채널이 사라지면** 관리자는 "이 제품은 카카오톡을 지원하지 않는다"고 오해한다. 반대로 토글만 켜지게 두면 "켜뒀는데 왜 문의가 안 들어오지?"라는 **운영 사고**가 난다.
2. **어댑터 계약을 지금 확정하지 않으면**, 나중에 카카오톡을 붙일 때 대화 처리 코어에 채널 분기가 스며들어 "한 번의 구축으로 여러 채널"이라는 제품 명제가 구조적으로 무너진다.

동시에, 이 Phase는 **인증 없는 공개 HTTP 표면**을 이 프로젝트에 처음 도입한다. 기존 규약(교차 접근은 `404`로 존재를 숨긴다, ADR-0003/FR-0-9)이 이 표면에도 그대로 적용되는지 판단해야 한다.

## 결정

### 1. 채널에 **구현 등급**을 부여하고, 활성화 자체를 서버가 막는다

```ts
ChannelImplementation = 'IMPLEMENTED' | 'CONFIG_ONLY'
CHANNEL_IMPLEMENTATION = { WEB: 'IMPLEMENTED', MOBILE|KAKAOTALK|LINE|FACEBOOK|NAVER_TALKTALK|APP|KIOSK: 'CONFIG_ONLY' }
```

- `GET /channels`는 **레코드 유무와 무관하게 8종 전부**를 반환한다(미설정은 `{configured:false, enabled:false}`). 프런트가 목록을 하드코딩하지 않는다.
- `CONFIG_ONLY` 채널을 `enabled=true`로 **전환하려는** 요청만 `409 CHANNEL_NOT_IMPLEMENTED`로 거부한다. `config`만 저장하는 요청과 `enabled:false`는 통과한다.
- **`ChannelType` enum은 변경하지 않는다.** `WEB`의 의미를 "PC/모바일 **웹** 임베드"로 확정하고, `MOBILE`은 "모바일 앱 웹뷰/네이티브 SDK"로 좁혀 `CONFIG_ONLY`로 둔다. 기존 `EmbedCodeService`가 같은 `widget.js`를 `data-mode`만 달리해 쓰고 있으므로(`embed-code.service.ts:32-49`) **PC/모바일 웹을 두 채널로 쪼개지 않는다.**
- `CHANNEL_IMPLEMENTATION`은 `shared-types`에 두되, **프런트는 이 상수가 아니라 API 응답의 `implementation` 값을 렌더한다**(서버/프런트 판정이 갈리는 것을 막는다).

### 2. 자격증명은 **스키마에 존재하지 않게** 한다

```ts
WebChannelConfigSchema          = { allowedOrigins, greetingMessage?, quickReplies, launcherPosition, showLauncher }.strict()
PlaceholderChannelConfigSchema  = { note? }.strict()
```

- `CONFIG_ONLY` 채널의 config는 **`note` 1개뿐**이다. 토큰·시크릿·Webhook URL 필드는 어느 분기에도 없다(NFR-S7).
- **`.strict()`를 쓴다.** 전역 파이프는 strip 모드(ADR-0003)라 미정의 필드가 조용히 사라지는데, EX-11-2/AC-11-5는 "저장되지 않았다는 사실을 알 수 있어야 함"을 요구한다. `400`을 돌려주면 "이 시스템은 자격증명을 받지 않는다"가 화면에서 드러난다 — **침묵 삭제보다 정직하다.**
- `Channel.enabled`의 Prisma 기본값을 `true → false`로 바꾼다. **레코드 생성이 곧 배포가 되면 안 된다** — `CONFIG_ONLY` 채널에 메모만 남기려는 요청이 자동으로 활성화 시도가 되어 409를 유발하는 모순도 함께 사라진다.

### 3. 어댑터 계약을 지금 확정하고, 구현체는 **1종만** 만든다

```ts
interface ChannelAdapter {
  readonly type: ChannelType;
  readonly supportedOutputTypes: ReadonlySet<DialogOutputType>;
  normalizeInbound(raw: unknown): InboundTurn;
  renderOutbound(outputs: DialogOutput[]): ChannelMessage[];
}
```

- **나머지 7종의 어댑터 파일은 만들지 않는다**(FR-11-18). 빈 구현체는 "구현됐다"는 착시를 만들고, 나중에 "이미 있으니 대충 채우자"는 압력이 된다.
- `degradeOutputs(outputs, supported)`(순수 함수)로 미지원 아웃풋을 `TEXT`로 격하한다. WEB은 7종 전부 지원하므로 **격하가 0건이지만 경로는 탄다** — 새 채널이 추가될 때 격하 규칙이 이미 동작 중인 상태여야 한다. "변환 0건"을 단위 테스트로 고정한다.
- **채널 타입 분기는 `channel-adapter.factory.ts`와 `channel-config.ts` 2개 파일에만 존재한다**(NFR-M2). 그 외 위치의 분기는 리뷰 차단 사유다.
- **새 채널 추가 비용(설계 목표)**: 어댑터 1개 + 팩토리 1줄 + config 스키마 1줄 + `CHANNEL_IMPLEMENTATION` 값 1개. **대화 처리 코어는 한 줄도 바뀌지 않는다.**

### 4. 공개 API 표면 — ADR-0003의 "404로 존재 은닉" 규약에 **예외 1건**을 둔다

| 상황 | 응답 |
|---|---|
| 존재하지 않는 `slug` | `404 NOT_FOUND` |
| 존재하지만 `status !== 'ACTIVE'` | **`403 CHATBOT_NOT_PUBLISHED`** |
| 존재하지만 WEB 채널 비활성 | **`403 CHANNEL_DISABLED`** |
| Origin 불허 | **`403 ORIGIN_NOT_ALLOWED`** |

- **근거**: `slug`는 공개 URL(`/c/{slug}`)과 임베드 스니펫(`data-chatbot`)의 구성요소라 **이미 공개된 값**이다. 존재를 숨기는 실익이 0인 반면, 고객사 개발자가 "왜 위젯이 안 뜨는지"(챗봇이 초안인가, 채널이 꺼졌는가, 도메인이 안 맞는가)를 판별할 수 없으면 지원 비용이 그대로 발생한다. 관리자 API의 404 규약은 **"다른 조직의 리소스 존재를 노출하지 않는다"** 는 목적인데, 공개 채널에는 그 목적이 존재하지 않는다.
- **단, 사용자 메시지는 3종을 동일하게** 만든다("현재 상담을 이용할 수 없습니다."). 최종 사용자에게 내부 사정을 설명할 필요가 없다. **`code`만 구분**되므로 개발자는 응답 본문으로 원인을 알 수 있다.

### 5. Origin 인가는 **CORS 헤더가 아니라 서버 가드**로 판정한다 (DD-30)

- `PublicOriginGuard`가 `allowedOrigins`와 대조해 `403 ORIGIN_NOT_ALLOWED`를 반환한다. 빈 배열이면 전체 허용(FR-11-9, 화면에 주의 배지). `Origin` 헤더 부재(서버 간 호출·동일 출처)는 통과.
- 전역 `app.enableCors()`는 **현행 유지**(변경 0줄). 프리플라이트를 통과시켜 위젯이 `403` 본문을 읽고 사용자 문구를 고를 수 있게 한다(FR-W-10).
- **AC-P-11의 해석을 고정한다**: "CORS로 차단된다" → "허용되지 않은 `Origin` 헤더를 실은 요청이 `403 ORIGIN_NOT_ALLOWED`를 받는다"로 검증한다(`test-automation` 인계).

### 6. 공개 응답은 **별도 스키마**로 분리한다

`PublicChatbotConfigSchema` / `PublicMessageResponseSchema`에는 `trace`·`matchedNodeId`·`matchedIntentId`·`matchedFaqId`·`unsupportedOutputs`·`id`·`groupId`·`status`·통계가 **타입상 들어갈 수 없다**(NFR-S1). 관리자 DTO를 재사용하지 않는다. 내부 필드가 추가되면 계약 테스트가 실패한다(AC-C-5).

## 근거

- **"켜지지만 아무 일도 안 일어나는 토글"이 가장 나쁜 선택지다.** 기능 부재는 불편이지만, 켜져 있는데 동작하지 않는 것은 **관리자가 고객 문의를 놓치는 운영 사고**다. 정직한 `준비 중` 표시가 빈 기능보다 낫다.
- **자격증명 필드를 "나중에 쓰려고" 미리 두지 않는 이유**는 ADR-0004·DD-2와 같다: 쓰기 주체가 없는 구조는 만들지 않는다. 게다가 여기서는 **평문 저장이라는 보안 부채**까지 추가된다(`dialogue-design.md` NFR-S5가 이미 지목한 사안).
- **어댑터 계약만 미리 만드는 것은 위 원칙의 예외가 아니다.** 인터페이스는 "쓰기 주체 없는 데이터"가 아니라 **이번 Phase에 실제로 사용되는 경계**(WEB 어댑터가 이를 구현하고, 공개 대화 서비스가 이를 통해 호출한다)다. 소비자가 오늘 존재한다.
- **CORS를 인가 수단으로 쓰지 않는 이유**: CORS는 브라우저 정책이다. `curl`·서버 대 서버 호출은 CORS를 통과하므로, CORS만으로는 보호가 성립하지 않는다. 또한 CORS delegate에서 DB를 매 프리플라이트마다 조회하면 성능상 캐시가 강제되고, 그러면 `allowedOrigins` 변경의 즉시 반영(FR-11-10)이 깨진다. 서버 판정은 **브라우저 없이 테스트 가능**하다는 부수 이익도 있다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| 7종 채널을 화면에서 아예 숨긴다 | 관리자가 "지원하지 않는 제품"으로 오해한다. 로드맵 가시성 상실 |
| 7종도 `enabled=true`를 허용하되 동작하지 않음을 안내 문구로만 표시 | 운영 사고를 문서로 막으려는 시도. 토글 상태와 실제 동작이 불일치하는 UI는 어떤 안내로도 구제되지 않는다 |
| `ChannelType` enum에서 미구현 7종을 제거 | 기존 `ConversationLog.channelType` 값·seed·타 문서와 어긋나고, 다시 추가할 때 마이그레이션이 필요하다. **등급은 값이 아니라 속성**이다 |
| `WEB`/`MOBILE_WEB`을 분리 | `EmbedCodeService`가 이미 `data-mode`로 같은 스크립트를 재사용한다. 채널을 쪼개면 관리자가 같은 위젯을 두 번 설정해야 한다 |
| 자격증명 필드를 두고 암호화 저장 | 키 관리(구축형: 어디에 두나 / 구독형: 테넌트별 분리)가 새 설계 과제다. 연동을 실제로 만드는 Phase에 함께 결정하는 것이 옳다 |
| config를 strip 모드로 두고 미정의 필드를 조용히 버린다 | 관리자는 토큰을 저장했다고 믿는다. **침묵 실패는 보안 맥락에서 최악**이다 |
| 공개 API도 전부 `404`로 통일 | 고객사 개발자가 원인을 판별할 수 없다. `slug`가 이미 공개 값이라 은닉 실익이 0 |
| 어댑터 없이 공개 API가 엔진을 직접 호출 | 두 번째 채널이 붙는 순간 컨트롤러·서비스에 분기가 퍼진다. **이 Phase에만 잠깐 단순한** 구조다 |
| 7종 어댑터를 `throw new NotImplemented()` 스텁으로 미리 생성 | "파일이 있다 = 구현됐다"는 착시. 팩토리 분기 1곳이 확장 지점을 충분히 표현한다 |

**감수하는 비용**
① `.strict()` 때문에 프런트가 config를 보낼 때 여분 필드를 실수로 섞으면 `400`이 난다 — 프런트가 스키마 파생 타입을 쓰므로 컴파일 단계에서 걸린다.
② `enabled` 기본값 변경은 향후 "채널을 만들면 바로 켜지길" 기대하는 코드와 충돌할 수 있다 — 현재 쓰기 주체가 `PATCH` 하나뿐이고 명시적으로 값을 받으므로 영향 범위가 닫혀 있다.
③ 공개 API의 `403`은 "이 slug의 챗봇이 존재한다"를 알려준다 — §4에서 논증했듯 `slug`는 이미 공개 값이며, 챗봇 **이름·설정·대화자산은 일절 노출되지 않는다**.

## 결과

- `shared-types/src/channel.ts` 전면 재정비: `ChannelImplementation`, `CHANNEL_IMPLEMENTATION`, `CHANNEL_TYPE_ORDER/LABELS`, `AllowedOriginSchema`, `WebChannelConfigSchema`, `PlaceholderChannelConfigSchema`, `channelConfigSchemaFor()`, `ChannelListItemSchema`, `UpdateChannelSchema`. **`CreateChannelSchema`는 삭제**(생성은 `PATCH` upsert로만).
- Prisma `Channel`: `@@unique([chatbotId, type])` + `updatedAt` + `enabled` 기본값 `false`.
- `apps/api/src/channels/`: 컨트롤러 3개 엔드포인트(`GET /channels`, `PATCH|DELETE /channels/:type`). `DELETE`는 **멱등 `204`**(채널은 고정 집합이므로 레코드 부재는 "미존재"가 아니라 "미설정"이다 — 동음이의어 삭제 FR-7-9와 같은 규칙).
- `apps/api/src/conversation/adapters/`: `channel-adapter.ts`(계약) / `channel-adapter.factory.ts`(**유일한 분기 지점**) / `web-channel.adapter.ts`(유일한 구현).
- `ApiErrorCode` 추가: `CHANNEL_NOT_IMPLEMENTED`(409), `CHANNEL_DISABLED`(403), `CHATBOT_NOT_PUBLISHED`(403), `ORIGIN_NOT_ALLOWED`(403), `RATE_LIMITED`(429).
- `code-reviewer` 인계: ① 공개 응답에 내부 필드 누출 여부 ② 채널 타입 분기가 2개 파일 밖에 있는지 ③ config 스키마에 자격증명 성격 필드가 추가되지 않았는지.
- **후속 Phase 인계**: 외부 채널을 실제로 붙일 때는 이 ADR을 Supersedes하지 말고 **확장**한다 — `CHANNEL_IMPLEMENTATION` 값 변경 + 어댑터 추가 + 자격증명 저장 방식 ADR 신규 작성.


---

## 갱신 (2026-09-23 — 공개 전환 원자 경로 `ChatbotPublicationService` · 채널 활성화 규칙의 순수 함수 추출)

운영 예약 배포(No.28, ADR-0032)가 **"공개 = 상태 `ACTIVE` AND WEB 채널 `enabled`"**(§4 공개 접근 조건)를 지정 시각에 전환한다. 이 ADR의 결정(구현 등급 · WEB만 활성화 가능 · 공개 API 403/404 · Origin 인가 · 자격증명 미저장)은 **불변**이다.

1. **`channels/publication.service.ts`(`ChatbotPublicationService`) 신설** — `publish(chatbotId, { enableWebChannel })`은 `DRAFT → ACTIVE`와 WEB 채널 활성화를 **한 쓰기 트랜잭션**으로 처리하고(둘 다 적용되거나 둘 다 적용되지 않는다), `setWebChannel(chatbotId, enabled)`은 WEB 채널만 전환한다. 감사는 커밋 후 기존 형식(`STATUS_CHANGE` "상태 변경: …" · `Channel UPDATE｜CREATE` "사용 여부 변경: …") 그대로이며 예약 실행 주체를 `actorOverride`로 받는다. 이미 목표 상태면 쓰기·감사 0건(NOOP).
2. **판정 규칙은 복제하지 않는다** — 상태 전이는 `evaluateStatusTransition()`을, `IMPLEMENTED` 채널만 활성화 가능 규칙은 `ChannelsService.upsert()`에서 **`channels/lib/channel-enable-rule.ts` 순수 함수로 이동**해 두 경로가 같은 함수를 호출한다(`upsert()` 동작 불변). 채널 행이 없을 때는 기존 `defaultChannelConfig()`로 생성한다.
3. **관리자 즉시 경로(`PATCH …/status`, `PATCH …/channels/:type`)는 무변경**이다 — 트랜잭션 인자를 추가하지 않는다(두 메서드 모두 쓰기 직후 감사를 기록하므로 tx 인자를 받으면 "감사를 미룰지" 분기가 생긴다).
4. `PublicAccessService`는 여전히 캐시하지 않으므로 전환은 **다음 공개 요청부터 즉시** 반영된다(무효화 호출 불필요).
5. **후속 Phase 인계 보강**: 외부 채널을 실제로 붙일 때 예약 동작 `SET_WEB_CHANNEL`은 `SET_CHANNEL(type)`으로 **새 동작 유형을 추가**해 일반화한다(기존 동작은 호환 유지 — ADR-0032 §1 레지스트리).


---

## 갱신 (2026-09-25 — No.24: 공개 경로 7번째 = 상담 폴링 · 폴링 전용 버킷 · 프리플라이트 캐시)

하이브리드 CS(No.24, **ADR-0036 §2·§3**)가 공개 표면을 1개 늘린다. §4(404/403)·§5(Origin 인가 = 서버 가드)·§6(공개 응답 별도 스키마)은 **불변**이다.

1. **`GET /public/chatbots/:slug/handoff`** — 공개 대화 컨트롤러의 4번째 핸들러이며 `@Public()` 전체는 **7곳**이다. 레이트리밋 → Origin 가드 순서·`404`/`403` 규약·`Cache-Control: no-store`를 상속한다.
2. **§6 확장**: `HandoffPollResponse`·`PublicHandoffState`에는 상담원 이름·이메일·사용자 id·상담 내부 id·전체 `sessionId`·원문이 **타입상 들어갈 수 없다**(키 집합 정적 검사 — `handoff-sealing.spec.ts` H-14).
3. **§5 보론**: 세션 식별자와 상담 토큰을 URL이 아니라 **요청 헤더**(`x-cb-session-id`·`x-cb-handoff-token`)로 받는다(접근 로그 유출 방지). 커스텀 헤더는 CORS 프리플라이트를 유발하므로 **공개 표면 분기의 CORS 옵션에 `maxAge: 600`만 추가**한다 — `origin: '*'`·무자격증명·공개 경로 판정은 그대로이며, 인가는 여전히 서버 가드다.
4. **레이트리밋**: 폴링 경로(보류 답변 포함)는 기존 `ip`·`session` 버킷을 소비하지 않고 **`poll-ip`(600/분) + 경로 키 버킷**만 소비한다 — 같은 NAT 뒤 폴링이 일반 대화 전송을 `429`로 만드는 것을 막는다.


---

## 갱신 (2026-09-25 — No.44: 공개 경로 8번째 = 답변 평가 · 평가 전용 버킷 · WEB 설정 스위치)

피드백 기반 개선 루프(No.44, **ADR-0038 §2·§5·§6**). §4(404/403)·§5(Origin 인가 = 서버 가드)·§6(공개 응답 별도 스키마)은 **불변**이다.

1. **`PUT /public/chatbots/:slug/messages/:messageId/feedback`** — 공개 대화 컨트롤러의 5번째 핸들러이며 `@Public()` 전체는 **8곳**이다. 레이트리밋 → Origin 가드 순서·`404`/`403` 규약·`Cache-Control: no-store`를 상속한다. 쓰기 경로이지만 **대화 데이터를 돌려주지 않는다**(응답 = 평가값 에코).
2. **§4 보론 — 단일 404**: 슬러그 미존재·비공개·채널 닫힘은 기존 규약(404/403)이다. 그 뒤의 기능 꺼짐·비UUID·로그 없음·챗봇/세션 불일치·평가 불가 턴은 **전부 같은 `404 FEEDBACK_TARGET_NOT_FOUND`** 다 — 공개 표면이지만 "남의 메시지 존재"는 슬러그와 달리 공개 값이 아니므로 ADR-0003의 은닉 규약을 그대로 적용한다.
3. **§6 확장**: `PublicFeedbackRequest`(`sessionId`·`rating`) · `PublicFeedbackResponse`(`rating`) · 응답 선택 필드 `feedback`(`rateable`)의 키 집합은 정적 검사가 **정확히** 단언한다(내부 id·텍스트·집계가 타입상 들어갈 수 없다).
4. **§2 보론 — WEB config 선택 키 `feedbackEnabled`**: 자격증명 성격이 아닌 표시 설정이며 `.strict()` 스키마에 선택 키로 추가한다(없음 = 꺼짐). `.default(false)`를 쓰지 않아 기존 채널 응답·파싱 결과 바이트가 바뀌지 않는다.
5. **레이트리밋**: 평가는 기존 `ip`·`session`·`poll-ip` 버킷을 소비하지 않고 **`fb-ip`(120/분) + `fb-key:msg:{messageId}`(10/분)**만 소비한다.


---

## 갱신 (2026-09-25 — No.40: 공개 경로 8 유지 · 운영 버전 서빙 · 표시 설정 출처)

환경 분리/버전관리(No.40, **ADR-0039 §2**). §3(404/403)·§4·§5·§6과 "공개 판정 캐시 없음"은 **불변**이다.

1. **`@Public()` 8곳 그대로** — 스테이징 외부 미리보기 링크는 만들지 않는다(P-2). 공개 요청에 대상·버전 입력 필드가 없어 공개 요청으로 초안·스테이징에 도달하는 경로가 없다.
2. 모드 켜진 챗봇은 `resolve()`가 읽은 챗봇 행의 `prodVersionId`로 운영 버전을 서빙한다 — 추가 조회 0 · 포인터 캐시 없음(전환 다음 요청부터 전 인스턴스 반영 — 긴급 중단을 캐시 없이 처리한 것과 같은 이유).
3. `GET …/config`: 모드 켜짐이면 이름·아바타·스킨 = 운영 버전 표시 설정, 인사말·퀵리플라이·런처 = WEB 채널 config(현재 값). 응답 스키마 불변.
4. 운영 버전 본문을 읽지 못하면 대화는 초안으로 대체하지 않고 폴백 턴으로 응답한다(공개 판정은 통과한 상태 — `403`/`404` 규약과 별개).
